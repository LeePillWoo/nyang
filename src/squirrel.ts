/**
 * 다람쥐 — 필드 숲(field.ts)과 다람쥐 잡기 미니게임(chase.ts)이 같이 쓰는 움직임 (2026-10-08 field.ts 에서 옮김).
 * 수풀에서 튀어나와 폴짝 뛰다 돌아서서 도토리를 던지고, 내려앉자마자 달아난다: dash 배/초로 dashT 초 달리고 rest 초 멈춰 돌아보기를 되풀이
 * (멈출 때 throw 확률로 또 던진다). 좋아하는 곳(woods — 고양이가 느린 숲)이 많은 쪽으로 달리고, 설 수 없는 곳 앞에선 방향을 바꾼다.
 * 고양이가 dodge 배 안으로 오면 옆으로 홱(1초에 한 번), catch 배 안이면 잡히고(폴짝 뛰는 동안은 못 잡는다),
 * give 초가 지나거나 far 배 넘게 멀어지면 숨는다(펑). 좌표는 필드처럼 화면 기준 px — 세로는 비스듬한 시점만큼 눌려 있다(vertical).
 * 거리 수치는 고양이 키(unit)의 배수, 수치는 field.json forest.squirrel. 그림을 불러오지 않아 node 에서 체크된다 (그리기는 field-draw.ts).
 */
import data from './data/field.json' with { type: 'json' };

export type SquirrelParams = typeof data.forest.squirrel;
export const SQ: SquirrelParams = data.forest.squirrel;
/**
 * 순서 (초 — 그리기도 같은 시계): 폴짝(뛰다가 turn 에 돌아서서 hopThrow 에 도토리를 던진다) → 달리기 ⇄ 쉬기 (쉴 때 가끔 던지기: 겨눔 aim → 던짐 release → 마무리 throw)
 * · 잡힘(어질어질 → 펑) · 숨음(펑). fly = 도토리가 날아가는 시간. 처음 던지기를 폴짝 안에 넣었다 — 멈춰 서서 던지면 바로 잡혀서 쫓을 틈이 없었다
 */
export const SQ_T = { hop: 0.45, turn: 0.2, hopThrow: 0.28, aim: 0.25, release: 0.32, throw: 0.55, fly: 0.35, caught: 1, gone: 0.5 };
export type Squirrel = {
  /** none 없음 · hop 튀어나와 폴짝 · throw 도토리 던지기 · run 달아남 · rest 멈춰서 돌아봄 · caught 잡힘 · gone 숨음 */
  phase: 'none' | 'hop' | 'throw' | 'run' | 'rest' | 'caught' | 'gone';
  /** 지금 단계에 들어온 뒤 · 나온 뒤 (give 초를 넘으면 숨는다) · 이번 달리기/쉬기 길이 */
  t: number;
  age: number;
  dur: number;
  x: number;
  y: number;
  /** 폴짝 뛰는 출발 · 도착 자리 */
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  /** 달리는 방향 (화면 기준 — 세로는 비스듬한 시점만큼 눌러서 움직인다) */
  ux: number;
  uy: number;
  flip: number;
  /** 마지막으로 홱 피한 뒤 */
  dodgeT: number;
  /** 날아가는 도토리 (출발 → 던질 때 고양이 자리) */
  acorn: { x0: number; y0: number; x1: number; y1: number; t: number } | null;
};
/** appear 튀어나옴 · throw 도토리 던짐 · bonk 고양이가 맞음 · dodge 홱 피함 · caught 잡힘 · escape 숨음 */
export type SquirrelWhat = 'appear' | 'throw' | 'bonk' | 'dodge' | 'caught' | 'escape';
/** 다람쥐가 사는 곳: 설 수 있는 곳 · 좋아하는 곳 · 고양이 키(px) · 세로 눌림 */
export type World = { land: (x: number, y: number) => boolean; woods: (x: number, y: number) => boolean; unit: number; vertical: number };
type Cat = { x: number; y: number };
type Emit = (what: SquirrelWhat, x: number, y: number) => void;

export const makeSquirrel = (x = 0, y = 0): Squirrel => ({ phase: 'none', t: 0, age: 0, dur: 0, x, y, fx: x, fy: y, tx: x, ty: y, ux: 1, uy: 0, flip: 1, dodgeT: 9, acorn: null });
/** 나와서 돌아다닌다 (폴짝 · 던지기 · 달리기 · 쉬기) */
export const active = (q: Squirrel) => q.phase === 'hop' || q.phase === 'throw' || q.phase === 'run' || q.phase === 'rest';

const between = ([a, b]: number[], rng: () => number) => a + rng() * (b - a);
/** 고양이에게서 (x, y) 까지 (고양이 키 배 — 세로는 비스듬한 시점만큼 펴서 잰다) */
const gap = (c: Cat, x: number, y: number, w: World) => Math.hypot(x - c.x, (y - c.y) / w.vertical) / w.unit;
/** (x, y) 에서 a 쪽으로 d px 가는 길(가운데 · 끝)에 설 수 있나 */
const clear = (x: number, y: number, a: number, d: number, w: World) =>
  [0.5, 1].every((k) => w.land(x + Math.cos(a) * d * k, y + Math.sin(a) * d * k * w.vertical));

/** (x, y) 수풀에서 튀어나와 고양이 반대쪽(dir 을 주면 그쪽) hop 배 떨어진 곳으로 폴짝 (사건 appear 는 부른 쪽이 낸다) */
export function spawn(q: Squirrel, cat: Cat, x: number, y: number, w: World, rng: () => number, p: SquirrelParams = SQ, dir?: number) {
  const d = p.hop * w.unit;
  const away = dir ?? Math.atan2((y - cat.y) / w.vertical, x - cat.x);
  const a = [0, 0.5, -0.5, 1, -1, 1.6, -1.6].map((k) => away + k + (rng() - 0.5) * 0.4).find((a) => clear(x, y, a, d, w));
  const [tx, ty] = a === undefined ? [x, y] : [x + Math.cos(a) * d, y + Math.sin(a) * d * w.vertical];
  Object.assign(q, { phase: 'hop', t: 0, age: 0, dur: 0, x, y, fx: x, fy: y, tx, ty, flip: tx >= x ? 1 : -1, dodgeT: 9, acorn: null });
}

/** 달아날 방향: 고양이 반대쪽 ±63° 중 뚫린 쪽, 좋아하는 곳이 많은 쪽. 다 막혔으면(몰렸으면) 더 옆으로 · 뒤로. 못 찾으면 null */
function runDir(q: Squirrel, cat: Cat, w: World, rng: () => number, p: SquirrelParams) {
  const away = Math.atan2((q.y - cat.y) / w.vertical, q.x - cat.x);
  const d = p.dash * w.unit * 0.6;
  let best: number | null = null;
  let score = -1;
  for (let i = 0; i < 9; i++) {
    const a = away + (rng() - 0.5) * 2.2;
    if (!clear(q.x, q.y, a, d, w)) continue;
    const woods = [0.33, 0.66, 1].filter((k) => w.woods(q.x + Math.cos(a) * d * k, q.y + Math.sin(a) * d * k * w.vertical)).length;
    const v = woods + rng() * 1.5;
    if (v > score) [best, score] = [a, v];
  }
  for (let i = 0; best === null && i < 12; i++) {
    const a = away + (i % 2 ? 1 : -1) * (1.1 + Math.floor(i / 2) * 0.35);
    if (clear(q.x, q.y, a, d, w)) best = a;
  }
  return best;
}
function startRun(q: Squirrel, cat: Cat, w: World, rng: () => number, p: SquirrelParams) {
  const a = runDir(q, cat, w, rng, p);
  if (a === null) return Object.assign(q, { phase: 'rest', t: 0, dur: between(p.rest, rng) });
  Object.assign(q, { phase: 'run', t: 0, dur: between(p.dashT, rng), ux: Math.cos(a), uy: Math.sin(a), flip: Math.cos(a) >= 0 ? 1 : -1 });
}

/** 한 프레임 — emit 으로 사건을 알린다 (bonk 는 고양이 자리에서). 잡힘 · 숨음 연출이 끝나 사라지는 프레임엔 true */
export function step(q: Squirrel, cat: Cat, dt: number, w: World, rng: () => number, emit: Emit, p: SquirrelParams = SQ): boolean {
  const C = w.unit;
  const V = w.vertical;
  // 날아가는 도토리 — 떨어질 때 고양이가 그 자리에 있으면 콩
  if (q.acorn && (q.acorn.t += dt) >= SQ_T.fly) {
    if (Math.hypot(cat.x - q.acorn.x1, (cat.y - q.acorn.y1) / V) < 1.2 * C) emit('bonk', cat.x, cat.y);
    q.acorn = null;
  }
  if (q.phase === 'none') return false;
  q.t += dt;
  if (q.phase === 'caught' || q.phase === 'gone') {
    if (q.t < SQ_T[q.phase]) return false;
    q.phase = 'none';
    return true;
  }
  q.age += dt;
  q.dodgeT += dt;
  const d = gap(cat, q.x, q.y, w);
  if (q.phase !== 'hop' && d < p.catch) {
    Object.assign(q, { phase: 'caught', t: 0 });
    emit('caught', q.x, q.y);
    return false;
  }
  if (q.age > p.give || d > p.far) {
    Object.assign(q, { phase: 'gone', t: 0 });
    emit('escape', q.x, q.y);
    return false;
  }
  const face = () => (q.flip = cat.x >= q.x ? 1 : -1);
  const release = () => {
    q.acorn = { x0: q.x + q.flip * 0.3 * C, y0: q.y - 0.55 * C, x1: cat.x, y1: cat.y, t: 0 };
    emit('throw', q.x, q.y);
  };
  if (q.phase === 'hop') {
    const k = Math.min(1, q.t / SQ_T.hop);
    q.x = q.fx + (q.tx - q.fx) * k;
    q.y = q.fy + (q.ty - q.fy) * k;
    if (q.t >= SQ_T.turn) face(); // 뛰다가 돌아서서
    if (q.t - dt < SQ_T.hopThrow && q.t >= SQ_T.hopThrow) release(); // 던지고
    if (k >= 1) startRun(q, cat, w, rng, p); // 내려앉자마자 달아난다
  } else if (q.phase === 'throw') {
    face();
    if (q.t - dt < SQ_T.release && q.t >= SQ_T.release) release();
    if (q.t >= SQ_T.throw) startRun(q, cat, w, rng, p);
  } else if (q.phase === 'run') {
    const s = p.dash * C * dt;
    const nx = q.x + q.ux * s;
    const ny = q.y + q.uy * s * V;
    if (w.land(nx, ny)) [q.x, q.y] = [nx, ny];
    else startRun(q, cat, w, rng, p); // 설 수 없는 곳 앞에서 방향을 바꾼다 (갈 데가 없으면 멈춰 선다)
    // 다 달리면 멈춰 돌아본다 — 가끔은 멈추자마자 또 던진다
    if (q.phase === 'run' && q.t >= q.dur) Object.assign(q, rng() < p.throw ? { phase: 'throw', t: 0 } : { phase: 'rest', t: 0, dur: between(p.rest, rng) });
  } else if (q.phase === 'rest') {
    face();
    if (q.t >= q.dur) startRun(q, cat, w, rng, p);
  }
  // 고양이가 바짝 다가오면 옆으로 홱 (1초에 한 번)
  if ((q.phase === 'run' || q.phase === 'rest') && d < p.dodge && q.dodgeT > 1) {
    const away = Math.atan2((q.y - cat.y) / V, q.x - cat.x);
    const sg = rng() < 0.5 ? 1 : -1;
    const a = [away + sg * 1.3, away - sg * 1.3, away, away + sg * 2, away - sg * 2].find((a) => clear(q.x, q.y, a, p.dash * C * 0.4, w));
    if (a !== undefined) {
      Object.assign(q, { phase: 'run', t: 0, dur: 0.4, ux: Math.cos(a), uy: Math.sin(a), flip: Math.cos(a) >= 0 ? 1 : -1, dodgeT: 0 });
      emit('dodge', q.x, q.y);
    }
  }
  return false;
}
