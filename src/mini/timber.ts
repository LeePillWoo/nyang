/**
 * 장작 패기 — 벌목 쉼터 미니게임 (2026-10-07). 높은 나무 기둥을 왼쪽이나 오른쪽에서 팬다.
 * 팰 때마다 맨 아래 토막이 날아가고 기둥이 한 칸 내려온다. 가지가 고양이 쪽으로 내려오거나, 가지 밑으로 옮겨 가면 콩 — 끝.
 * 시간 막대는 계속 줄고 팰 때마다 조금 찬다. 많이 팰수록 빨리 준다 (ramp 토막에서 가장 빠르게).
 * 가지 바로 다음 토막엔 반대쪽 가지가 나지 않는다 — 언제나 피할 쪽이 있다.
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 timber-draw.ts). 무작위는 rng 로 주입한다.
 */
export const TIMBER = {
  /** 시간 막대 (초): 처음 · 가득 */
  start: 4,
  max: 6,
  /** 한 번 팰 때 차는 시간 (초) */
  gain: 0.3,
  /** 줄어드는 빠르기 (초/초): 처음 → ramp 토막을 팼을 때 */
  drain: [0.55, 1.9],
  ramp: 150,
  /** 가지 없는 토막 다음에 가지가 날 확률 · 가지 다음 토막도 같은 쪽 가지일 확률 */
  branch: 0.6,
  twin: 0.25,
  /** 처음 몇 토막은 가지가 없다 */
  clear: 3,
  /** 미리 만들어 두는 토막 수 (세로 화면에 보이는 것보다 넉넉히) */
  ahead: 20,
  /** 보상: 냥코인 = 토막 × coin, 통나무 = 토막 / log (최대 logMax) */
  coin: 0.3,
  log: 15,
  logMax: 6,
  /** 이만큼 팰 때마다 '빨라져요' */
  level: 25,
  /** 끝난 뒤 결과 카드가 뜰 때까지 (초) — 맞는 모습을 보여 준다 */
  cardDelay: 0.8,
};
export type Side = -1 | 1;
/** 토막의 가지: -1 왼쪽 · 1 오른쪽 · 0 없음 */
export type Seg = -1 | 0 | 1;
export type TimberEvent =
  /** 팼다 — seg = 날아간 토막의 가지 */
  | { type: 'chop'; side: Side; seg: Seg }
  /** 가지에 맞았다 */
  | { type: 'hit'; side: Side }
  | { type: 'timeout' }
  /** 빨라졌다 (n 번째) */
  | { type: 'level'; n: number }
  | { type: 'done'; score: number; coins: number; logs: number; why: 'hit' | 'time' };
export type TimberState = {
  /** [0] = 고양이 옆 토막 (다음에 팰 것), 위로 갈수록 뒤 */
  segs: Seg[];
  /** 지금까지 만든 토막 수 (처음 clear 토막은 가지 없이) */
  made: number;
  side: Side;
  score: number;
  /** 남은 시간 (초) */
  time: number;
  /** ready = 첫 도끼질 전 (시간이 안 준다) */
  phase: 'ready' | 'play' | 'done';
  why: 'hit' | 'time' | null;
  t: number;
  /** 끝난 뒤 흐른 시간 · 마지막으로 팬 뒤 (그리기: 휘두르기 · 기둥 내려오기) */
  doneT: number;
  chopT: number;
  coins: number;
  logs: number;
  events: TimberEvent[];
  rng: () => number;
};

/** 다음 토막: 처음엔 없음, 가지 다음엔 없음이나 같은 쪽(twin), 없음 다음엔 branch 확률로 아무 쪽 */
function grow(s: TimberState) {
  while (s.segs.length < TIMBER.ahead) {
    const last = s.segs[s.segs.length - 1] ?? 0;
    let next: Seg = 0;
    if (s.made >= TIMBER.clear) {
      if (last !== 0) next = s.rng() < TIMBER.twin ? last : 0;
      else if (s.rng() < TIMBER.branch) next = s.rng() < 0.5 ? -1 : 1;
    }
    s.segs.push(next);
    s.made++;
  }
}

export function makeTimber(rng: () => number = Math.random): TimberState {
  const s: TimberState = { segs: [], made: 0, side: 1, score: 0, time: TIMBER.start, phase: 'ready', why: null, t: 0, doneT: 0, chopT: 9, coins: 0, logs: 0, events: [], rng };
  grow(s);
  return s;
}

/** 줄어드는 빠르기 (초/초) */
export const drainAt = (score: number) => TIMBER.drain[0] + (TIMBER.drain[1] - TIMBER.drain[0]) * Math.min(1, score / TIMBER.ramp);

function end(s: TimberState, why: 'hit' | 'time') {
  s.phase = 'done';
  s.why = why;
  s.doneT = 0;
  s.coins = Math.floor(s.score * TIMBER.coin);
  s.logs = Math.min(TIMBER.logMax, Math.floor(s.score / TIMBER.log));
  s.events.push({ type: 'done', score: s.score, coins: s.coins, logs: s.logs, why });
}

/** side 쪽으로 가서 한 번 팬다 */
function chop(s: TimberState, side: Side) {
  if (s.phase === 'done') return;
  s.phase = 'play';
  s.side = side;
  s.chopT = 0;
  const hit = () => {
    s.events.push({ type: 'hit', side });
    end(s, 'hit');
  };
  if (s.segs[0] === side) return hit(); // 가지 밑으로 옮겨 갔다
  const seg = s.segs.shift()!;
  s.score++;
  s.time = Math.min(TIMBER.max, s.time + TIMBER.gain);
  s.events.push({ type: 'chop', side, seg });
  grow(s);
  if (s.score % TIMBER.level === 0) s.events.push({ type: 'level', n: s.score / TIMBER.level });
  if (s.segs[0] === side) hit(); // 가지가 내려왔다
}

/** 한 프레임. chops = 이번 프레임에 누른 쪽들 (차례대로) */
export function updateTimber(s: TimberState, chops: Side[], dt: number) {
  s.events.length = 0;
  for (const side of chops) chop(s, side);
  s.chopT += dt;
  if (s.phase === 'done') {
    s.doneT += dt;
    return;
  }
  if (s.phase !== 'play') return;
  s.t += dt;
  s.time -= dt * drainAt(s.score);
  if (s.time <= 0) {
    s.time = 0;
    s.events.push({ type: 'timeout' });
    end(s, 'time');
  }
}

/** 안전한 쪽 (자동 조종 · 체크용): 지금 토막과 다음 토막의 가지가 없는 쪽 — 지금 서 있는 쪽이 괜찮으면 그대로 */
export function safeSide(s: TimberState): Side {
  const ok = (side: Side) => s.segs[0] !== side && s.segs[1] !== side;
  return ok(s.side) ? s.side : s.side === 1 ? -1 : 1;
}
