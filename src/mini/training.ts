/**
 * 훈련장 (강아지마을 교관, 2026-10-12 사용자 — 스킬 강화 같은 건 아직 말고 그냥 훈련하는 미니게임).
 * 위에서 본 훈련장 가운데에 고양이, 둘레 네 방향(위 · 오른쪽 · 아래 · 왼쪽)에 허수아비. 빛나는 허수아비를 그쪽으로 친다
 * (방향키 · WASD · 누르기) — 빨리 치면 딱!(2점), 늦으면 1점, 빛이 꺼질 때까지 못 치면 놓침. 안 빛나는 걸 치면 헛손질(잠깐 멈칫).
 * 연속 combo 번마다 보너스. 교관이 가끔 훈련 공을 굴린다 — 옆에서 '!' 예고 뒤 굴러오니 닿기 직전에 구르기(Space · 버튼)로 피한다.
 * 맞으면 하트 -1 (다 잃으면 끝). time 초. 갈수록 빛이 짧아지고 공이 잦다. 점수 × coin 냥코인 · 기록 · 길드 훈련 의뢰.
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 training-draw.ts). 무작위는 rng 로 주입한다.
 */
export const TRAIN = {
  time: 45,
  hearts: 3,
  /** 허수아비가 빛나 있는 시간 (초): 처음 → 끝 · 다음 허수아비까지 쉬는 시간 */
  lit: [1.3, 0.7],
  gap: [0.45, 0.2],
  /** 빛난 뒤 이 비율 안에 치면 딱! (2점) */
  quick: 0.45,
  /** 헛손질 멈칫 (초) */
  whiff: 0.35,
  /** 공: 다음 공까지 (초) 처음 → 끝 · 예고 · 굴러오는 시간 · 구르기 무적 · 다시 구를 때까지 · 맞으면 멈칫 */
  ball: [6, 3],
  warn: 0.9,
  fly: 0.8,
  roll: 0.45,
  rollCd: 0.75,
  hurt: 0.8,
  /** 연속 combo 번마다 보너스 comboBonus 점 */
  combo: 10,
  comboBonus: 3,
  /** 남은 시간이 이만큼이면 알림 */
  hurry: 10,
  /** 보상: 냥코인 = 점수 × coin */
  coin: 0.4,
  /** 끝난 뒤 결과 카드가 뜰 때까지 (초) */
  cardDelay: 0.8,
};
/** 방향: 0 위 · 1 오른쪽 · 2 아래 · 3 왼쪽 */
export type Dir = 0 | 1 | 2 | 3;
export type TrainEvent =
  | { type: 'light'; dir: Dir }
  | { type: 'hit'; dir: Dir; quick: boolean; combo: number }
  | { type: 'bonus'; n: number }
  /** 빛이 꺼질 때까지 못 쳤다 */
  | { type: 'miss'; dir: Dir }
  /** 안 빛나는 허수아비를 쳤다 */
  | { type: 'whiff'; dir: Dir }
  | { type: 'warn'; side: -1 | 1 }
  | { type: 'roll' }
  | { type: 'dodge' }
  | { type: 'bonk' }
  | { type: 'hurry' }
  | { type: 'done'; score: number; coins: number; hits: number; why: 'time' | 'hearts' };
export type TrainState = {
  /** ready = 첫 주먹 · 구르기 전 (시간이 안 간다, 빛난 허수아비도 안 꺼진다) */
  phase: 'ready' | 'play' | 'done';
  t: number;
  score: number;
  hits: number;
  quicks: number;
  combo: number;
  bestCombo: number;
  hearts: number;
  /** 빛나는 허수아비 (t 빛난 뒤 · life 빛나 있는 시간) · 다음 허수아비까지 */
  lit: { dir: Dir; t: number; life: number } | null;
  wait: number;
  last: Dir;
  /** 마지막 주먹 (그리기) · 헛손질 멈칫 */
  punch: { dir: Dir; t: number; hit: boolean } | null;
  stun: number;
  /** 굴러오는 공 (t = 예고부터, warn + fly 에 고양이에게 닿는다 · done = 피했나 맞았나 정해짐) · 다음 공까지 */
  ball: { side: -1 | 1; t: number; done: 'dodge' | 'bonk' | null } | null;
  nextBall: number;
  /** 구르기 시작부터 · 다시 구를 때까지 · 맞은 뒤 */
  rollT: number;
  rollCd: number;
  hurtT: number;
  hurried: boolean;
  coins: number;
  doneT: number;
  why: 'time' | 'hearts' | null;
  events: TrainEvent[];
  rng: () => number;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export function makeTraining(rng: () => number = Math.random): TrainState {
  const s: TrainState = {
    phase: 'ready',
    t: 0,
    score: 0,
    hits: 0,
    quicks: 0,
    combo: 0,
    bestCombo: 0,
    hearts: TRAIN.hearts,
    lit: null,
    wait: 0,
    last: 0,
    punch: null,
    stun: 0,
    ball: null,
    nextBall: TRAIN.ball[0],
    rollT: Infinity,
    rollCd: 0,
    hurtT: Infinity,
    hurried: false,
    coins: 0,
    doneT: 0,
    why: null,
    events: [],
    rng,
  };
  light(s);
  s.lit!.dir = s.last = rng() < 0.5 ? 1 : 3; // 처음엔 옆 허수아비 (위는 안내 글이 가린다)
  return s;
}
/** 지난 시간 비율 (0 → 1, 갈수록 어려워진다) */
const progress = (s: TrainState) => Math.min(1, s.t / TRAIN.time);
export const timeLeft = (s: TrainState) => Math.max(0, TRAIN.time - s.t);
function light(s: TrainState) {
  const d = ((s.last + 1 + Math.floor(s.rng() * 3)) % 4) as Dir; // 바로 앞과 다른 방향
  s.last = d;
  s.lit = { dir: d, t: 0, life: lerp(TRAIN.lit[0], TRAIN.lit[1], progress(s)) };
  s.events.push({ type: 'light', dir: d });
}
const rolling = (s: TrainState) => s.rollT < TRAIN.roll;
const hurt = (s: TrainState) => s.hurtT < TRAIN.hurt;
const start = (s: TrainState) => void (s.phase === 'ready' && (s.phase = 'play'));
/** 친다 (방향키 · 허수아비 누르기). 구르는 중 · 맞은 뒤 · 헛손질 멈칫 동안은 안 된다 */
function punch(s: TrainState, dir: Dir) {
  if (s.phase === 'done' || s.stun > 0 || rolling(s) || hurt(s)) return;
  start(s);
  const hit = s.lit?.dir === dir;
  s.punch = { dir, t: 0, hit };
  if (!hit) {
    s.combo = 0;
    s.stun = TRAIN.whiff;
    s.events.push({ type: 'whiff', dir });
    return;
  }
  const quick = s.lit!.t <= s.lit!.life * TRAIN.quick;
  s.score += quick ? 2 : 1;
  s.hits++;
  if (quick) s.quicks++;
  s.combo++;
  s.bestCombo = Math.max(s.bestCombo, s.combo);
  s.events.push({ type: 'hit', dir, quick, combo: s.combo });
  if (s.combo % TRAIN.combo === 0) {
    s.score += TRAIN.comboBonus;
    s.events.push({ type: 'bonus', n: TRAIN.comboBonus });
  }
  s.lit = null;
  s.wait = lerp(TRAIN.gap[0], TRAIN.gap[1], progress(s));
}
/** 구른다 (Space · 버튼) — roll 초 동안 공에 안 맞는다 */
function roll(s: TrainState) {
  if (s.phase === 'done' || s.rollCd > 0 || hurt(s)) return;
  start(s);
  s.rollT = 0;
  s.rollCd = TRAIN.rollCd;
  s.events.push({ type: 'roll' });
}
function finish(s: TrainState, why: 'time' | 'hearts') {
  s.phase = 'done';
  s.why = why;
  s.lit = null;
  s.coins = Math.round(s.score * TRAIN.coin);
  s.events.push({ type: 'done', score: s.score, coins: s.coins, hits: s.hits, why });
}
/** 이번 프레임 입력 — 친 방향들(차례대로) · 구르기 */
export type TrainInput = { punches: Dir[]; roll: boolean };
export function updateTraining(s: TrainState, input: TrainInput, dt: number) {
  s.events.length = 0;
  for (const d of input.punches) punch(s, d);
  if (input.roll) roll(s);
  if (s.punch) s.punch.t += dt;
  s.rollT += dt;
  s.hurtT += dt;
  if (s.phase === 'done') {
    s.doneT += dt;
    if (s.ball) s.ball.t += dt;
    return;
  }
  if (s.phase === 'ready') return;
  s.t += dt;
  s.stun = Math.max(0, s.stun - dt);
  s.rollCd = Math.max(0, s.rollCd - dt);
  if (!s.hurried && timeLeft(s) <= TRAIN.hurry) {
    s.hurried = true;
    s.events.push({ type: 'hurry' });
  }
  if (s.t >= TRAIN.time) return finish(s, 'time');
  // 허수아비: 빛이 꺼지면 놓침, 쉬었다가 다음
  if (s.lit) {
    s.lit.t += dt;
    if (s.lit.t > s.lit.life) {
      s.events.push({ type: 'miss', dir: s.lit.dir });
      s.combo = 0;
      s.lit = null;
      s.wait = lerp(TRAIN.gap[0], TRAIN.gap[1], progress(s));
    }
  } else if ((s.wait -= dt) <= 0) light(s);
  // 공: 예고 → 굴러와 닿는 순간 구르는 중이면 피함, 아니면 콩. 지나가면 사라진다
  if (s.ball) {
    s.ball.t += dt;
    if (!s.ball.done && s.ball.t >= TRAIN.warn + TRAIN.fly) {
      s.ball.done = rolling(s) ? 'dodge' : 'bonk';
      if (s.ball.done === 'dodge') s.events.push({ type: 'dodge' });
      else {
        s.hearts--;
        s.combo = 0;
        s.hurtT = 0;
        s.events.push({ type: 'bonk' });
        if (s.hearts <= 0) return finish(s, 'hearts');
      }
    }
    if (s.ball.t >= TRAIN.warn + TRAIN.fly * 2) s.ball = null;
  } else if ((s.nextBall -= dt) <= 0) {
    const side = s.rng() < 0.5 ? -1 : 1;
    s.ball = { side, t: 0, done: null };
    s.events.push({ type: 'warn', side });
    s.nextBall = lerp(TRAIN.ball[0], TRAIN.ball[1], progress(s)) + s.rng();
  }
}
/** 공이 고양이에게 닿기까지 남은 초 (자동 검사 · 그리기) */
export const ballIn = (s: TrainState) => (s.ball && !s.ball.done ? TRAIN.warn + TRAIN.fly - s.ball.t : Infinity);
