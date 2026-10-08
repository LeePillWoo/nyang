/**
 * 다람쥐 잡기 — 숲 미니게임장 (2026-10-08 사용자 요청: 해바라기밭 포탈 아래 숲). 숲 속 공터에서 60초 동안, 둘레 수풀에서 튀어나오는
 * 다람쥐를 쫓아가 잡는다. 다람쥐 움직임은 필드 숲과 같다(squirrel.ts) — 튀어나와 도토리를 던지고(맞으면 잠깐 멍), 달아나고, 다가가면 홱 피하고,
 * 오래 못 잡으면 숨는다. 가끔 황금 다람쥐(3마리 몫, 조금 빠름). 갈수록 한꺼번에 더 많이 나온다. 첫 걸음을 떼야 시간이 간다.
 * 좌표는 필드처럼 px (고양이 키 catBody, 세로는 비스듬한 시점만큼 눌림), 공터 가운데가 (0, 0).
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 chase-draw.ts). 무작위는 rng 로 주입한다.
 */
import data from './data/field.json' with { type: 'json' };
import { makeSquirrel, spawn, SQ, step, type Squirrel, type SquirrelParams, type SquirrelWhat, type World } from './squirrel.ts';

const C = data.catBody;
const V = data.vertical;
export const CHASE = {
  /** 제한 시간 (초) */
  time: 60,
  /** 공터 반지름 (고양이 키 배 — 가로 · 세로, 세로는 화면에서 눌린 크기) */
  rx: 10,
  ry: 5.5,
  /** 둘레 수풀 수 */
  bushes: 9,
  /** 한꺼번에 나와 있는 수: 처음 → 끝 (step 초마다 하나씩 늘어난다) */
  max: [1, 3],
  step: 15,
  /** 다음 다람쥐까지 (초) */
  every: [1.2, 2.4],
  /** 수풀이 흔들리고 튀어나오기까지 (초) — 고양이에게서 near 배보다 먼 수풀만 */
  warn: 0.7,
  near: 5,
  /** 고양이 빠르기 (걷기 배) · 도토리에 맞으면 멍한 시간 (초) */
  speed: 0.92,
  stun: 0.5,
  /** 황금 다람쥐: 확률 · 몫 · 빠르기 배 */
  gold: 0.12,
  goldPoints: 3,
  goldSpeed: 1.15,
  /** 다람쥐가 버티는 시간 (초) — 지나면 수풀로 숨는다 */
  give: 7,
  /** 보상: 냥코인 = 점수 × coin · 도토리 = 잡은 마리 (최대 acornMax) */
  coin: 2,
  acornMax: 20,
  /** 끝난 뒤 결과 카드가 뜰 때까지 (초) */
  cardDelay: 0.7,
};
/** 수풀 — warn > 0 이면 흔들리는 중 (곧 튀어나온다) */
export type Bush = { x: number; y: number; warn: number; gold: boolean };
export type Runner = { q: Squirrel; gold: boolean };
export type ChaseEvent =
  | { type: 'squirrel'; what: SquirrelWhat; x: number; y: number; gold: boolean; points?: number }
  | { type: 'rustle'; x: number; y: number }
  /** 10초 남음 */
  | { type: 'hurry' }
  | { type: 'done'; points: number; caught: number; golds: number; coins: number; acorns: number };
export type ChaseState = {
  /** ready = 첫 걸음 전 (시간이 안 간다) */
  phase: 'ready' | 'play' | 'done';
  /** 놀이 시간 · 끝난 뒤 */
  t: number;
  doneT: number;
  cat: { x: number; y: number; flip: number; moving: boolean; animT: number; stun: number };
  bushes: Bush[];
  runners: Runner[];
  /** 다음 다람쥐까지 */
  next: number;
  points: number;
  caught: number;
  golds: number;
  coins: number;
  acorns: number;
  events: ChaseEvent[];
  rng: () => number;
};

/** 공터 안인가 (k = 반지름 배율) */
export const inArena = (x: number, y: number, k = 1) => (x / (CHASE.rx * C)) ** 2 + (y / (CHASE.ry * C)) ** 2 <= k * k;
/** 다람쥐가 사는 공터: 가장자리 조금 안쪽까지 서고, 수풀 가까운 바깥 둘레를 좋아한다 */
const ARENA: World = { land: (x, y) => inArena(x, y, 0.94), woods: (x, y) => !inArena(x, y, 0.7), unit: C, vertical: V };
/** 공터 다람쥐 수치 — 오래 못 잡으면 give 초에 숨고(멀어져서 숨지는 않는다), 황금은 조금 빠르다 */
const params = (r: Runner): SquirrelParams => ({ ...SQ, give: CHASE.give, far: 99, dash: SQ.dash * (r.gold ? CHASE.goldSpeed : 1) });
const between = ([a, b]: number[], rng: () => number) => a + rng() * (b - a);
/** 고양이에게서 (x, y) 까지 (세로는 펴서) */
const dist = (s: ChaseState, [x, y]: number[]) => Math.hypot(x - s.cat.x, (y - s.cat.y) / V);
/** 지금 한꺼번에 나와 있어도 되는 수 */
export const maxAt = (t: number) => Math.min(CHASE.max[1], CHASE.max[0] + Math.floor(t / CHASE.step));
/** 남은 시간 */
export const left = (s: ChaseState) => Math.max(0, CHASE.time - s.t);

export function makeChase(rng: () => number = Math.random): ChaseState {
  const bushes: Bush[] = [];
  for (let i = 0; i < CHASE.bushes; i++) {
    const a = ((i + 0.5) / CHASE.bushes) * Math.PI * 2;
    bushes.push({ x: Math.cos(a) * CHASE.rx * C * 0.97, y: Math.sin(a) * CHASE.ry * C * 0.97, warn: 0, gold: false });
  }
  return {
    phase: 'ready',
    t: 0,
    doneT: 0,
    cat: { x: 0, y: CHASE.ry * C * 0.25, flip: 1, moving: false, animT: 0, stun: 0 },
    bushes,
    runners: [],
    next: 0.6,
    points: 0,
    caught: 0,
    golds: 0,
    coins: 0,
    acorns: 0,
    events: [],
    rng,
  };
}

/** 다람쥐들 한 프레임 (끝난 뒤에도 펑 하고 숨는 연출은 이어 간다) */
function stepRunners(s: ChaseState, dt: number) {
  const c = s.cat;
  for (const r of s.runners)
    step(
      r.q,
      c,
      dt,
      ARENA,
      s.rng,
      (what, x, y) => {
        if (what === 'caught') {
          const points = r.gold ? CHASE.goldPoints : 1;
          s.points += points;
          s.caught++;
          if (r.gold) s.golds++;
          return void s.events.push({ type: 'squirrel', what, x, y, gold: r.gold, points });
        }
        if (what === 'bonk') c.stun = CHASE.stun;
        s.events.push({ type: 'squirrel', what, x, y, gold: r.gold });
      },
      params(r),
    );
  s.runners = s.runners.filter((r) => r.q.phase !== 'none');
}

/** 흔들리던 수풀에서 튀어나오고, 자리가 나면 다음 수풀을 흔든다 (고양이에게서 먼 수풀) */
function stepBushes(s: ChaseState, dt: number) {
  for (const b of s.bushes) {
    if (b.warn <= 0 || (b.warn -= dt) > 0) continue;
    // 공터 안쪽으로 폴짝 — 안쪽 ±40° 중 고양이에게서 가장 먼 쪽
    const r: Runner = { q: makeSquirrel(), gold: b.gold };
    const inward = Math.atan2(-b.y / V, -b.x);
    const land = (a: number) => [b.x + Math.cos(a) * SQ.hop * C, b.y + Math.sin(a) * SQ.hop * C * V];
    const dir = [-0.7, -0.35, 0, 0.35, 0.7].map((k) => inward + k).sort((p, q) => dist(s, land(q)) - dist(s, land(p)))[0];
    spawn(r.q, s.cat, b.x, b.y, ARENA, s.rng, params(r), dir);
    s.runners.push(r);
    s.events.push({ type: 'squirrel', what: 'appear', x: b.x, y: b.y, gold: r.gold });
  }
  if ((s.next -= dt) > 0 || s.runners.length + s.bushes.filter((b) => b.warn > 0).length >= maxAt(s.t)) return;
  const far = s.bushes.filter((b) => b.warn <= 0 && Math.hypot(b.x - s.cat.x, (b.y - s.cat.y) / V) > CHASE.near * C);
  if (!far.length) return;
  const b = far[Math.floor(s.rng() * far.length)];
  b.warn = CHASE.warn;
  b.gold = s.rng() < CHASE.gold;
  s.next = between(CHASE.every, s.rng);
  s.events.push({ type: 'rustle', x: b.x, y: b.y });
}

/** 한 프레임. mx, my 는 화면 기준 -1..1 */
export function updateChase(s: ChaseState, input: { mx: number; my: number }, dt: number) {
  s.events.length = 0;
  const c = s.cat;
  c.animT += dt;
  if (s.phase === 'done') {
    s.doneT += dt;
    c.moving = false;
    stepRunners(s, dt);
    return;
  }
  const len = Math.hypot(input.mx, input.my);
  if (s.phase === 'ready' && len === 0) return;
  s.phase = 'play';
  const was = left(s);
  s.t += dt;
  // 고양이 — 멍하면 못 움직인다. 공터 가장자리에서 멈춘다
  c.stun = Math.max(0, c.stun - dt);
  c.moving = len > 0 && c.stun <= 0;
  if (c.moving) {
    const v = data.speed * CHASE.speed;
    c.x += (input.mx / len) * v * dt;
    c.y += (input.my / len) * v * V * dt;
    if (input.mx !== 0) c.flip = Math.sign(input.mx);
    const k = Math.hypot(c.x / (CHASE.rx * C), c.y / (CHASE.ry * C));
    if (k > 0.94) [c.x, c.y] = [(c.x * 0.94) / k, (c.y * 0.94) / k];
  }
  stepRunners(s, dt);
  stepBushes(s, dt);
  if (was > 10 && left(s) <= 10) s.events.push({ type: 'hurry' });
  if (left(s) > 0) return;
  // 끝 — 남은 다람쥐는 펑 하고 숨는다
  s.phase = 'done';
  s.doneT = 0;
  for (const r of s.runners) if (r.q.phase !== 'caught') Object.assign(r.q, { phase: 'gone', t: 0, acorn: null });
  for (const b of s.bushes) b.warn = 0;
  s.coins = s.points * CHASE.coin;
  s.acorns = Math.min(CHASE.acornMax, s.caught);
  s.events.push({ type: 'done', points: s.points, caught: s.caught, golds: s.golds, coins: s.coins, acorns: s.acorns });
}
