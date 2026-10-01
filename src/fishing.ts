/**
 * 낚시 로직 (GDD 10장 낚시 확장) — 고정 화면, 고양이는 움직이지 않는다. 좌표는 낚시 배경 그림 픽셀.
 *
 *   준비 → 조준 (누르고 있으면 링이 줄었다 커졌다, 가장 작을 때 떼면 정확히 날아간다)
 *   → 던지기 → 기다리기 (그림자 물고기가 찌를 보고 다가와 톡톡 — 이때 채면 "너무 빨랐다")
 *   → 입질 (찌가 쏙 잠김 — 종마다 정해진 시간 안에 눌러야 챔질, 빨리 누를수록 완벽한 챔질)
 *   → 당기기 (누르고 있으면 감긴다. 물고기가 날뛸 때 계속 감으면 줄이 끊어지고, 오래 놓으면 바늘이 빠진다)
 *   → 낚음 / 놓침
 *
 * 물고기는 그림자로 보인다 (클수록 크거나 귀하다). 찌를 물고기 바로 위에 떨어뜨리면 놀라 도망간다 — 앞쪽 가까이에 던진다.
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 fishing-draw.ts). 무작위는 rng 로 주입한다.
 */
import fishDefs from './data/fish.json' with { type: 'json' };
import data from './data/fishing.json' with { type: 'json' };

export type FishDef = {
  name: string;
  stars: number;
  biome: string;
  /** 그림자 모양 (fishing-atlas.json 의 shadow 상태 이름)과 화면 폭(px) */
  shadow: string;
  shadowW: number;
  cm: number[];
  /** 헤엄 속도 px/s */
  swim: number;
  /** 찌를 알아채는 거리, 놀라는 거리 (px) */
  notice: number;
  scare: number;
  /** 다가올 마음 (0..1) */
  bold: number;
  /** 톡톡 패턴에서 진짜 입질 전에 건드리는 횟수 [최소, 최대] */
  nibbles: number[];
  /** 입질 패턴 가중치 (BitePattern → 숫자). 같은 종도 매번 다르게 문다 */
  patterns: Record<string, number>;
  /** 당길 때 날뛰는 모양 */
  fight: FightStyle;
  /** 입질 뒤 챔질할 수 있는 시간 (초) */
  window: number;
  /** 날뛰는 힘 (0..1) · 기운 · 날뛰는 간격과 길이 (초) · 날뛰는 속도 */
  pull: number;
  stamina: number;
  runGap: number[];
  run: number[];
  runSpeed: number;
  legendary: boolean;
};
export const FISH = fishDefs as Record<string, FishDef>;
export type SpotDef = (typeof data.spots)['lake_island_fishing'];
export const SPOTS = data.spots as Record<string, SpotDef>;
export const RULES = data.rules;

export type Phase = 'ready' | 'aim' | 'cast' | 'wait' | 'bite' | 'hook' | 'reel' | 'caught' | 'fail';
export type FailReason = 'early' | 'late' | 'snap' | 'slack';
/**
 * 입질 패턴 — 진짜 입질 전에 어떤 가짜 신호를 주고, 진짜 입질이 어떤 모양인지.
 *   peck 톡톡(들쭉날쭉) → 쏙 · flurry 따다닥 연타 → 쏙 · lift 찌올림 · drag 끌고 가기 · slam 다가오자마자 쏙 ·
 *   fake 헛잠김(반쯤 잠겼다 떠오름) 섞고 → 쏙 · hesitant 톡 하고 물러났다 다시 옴 (가끔 그냥 감) → 쏙
 */
export type BitePattern = 'peck' | 'flurry' | 'lift' | 'drag' | 'slam' | 'fake' | 'hesitant';
/** 진짜 입질의 모양: 쏙 잠김 · 쑥 떠올라 눕기(찌올림) · 옆으로 끌려감 */
export type BiteKind = 'sink' | 'lift' | 'drag';
/** 진짜 입질 전 신호. at = 물고기가 찌에 붙어 있던 시간 기준 */
export type Cue = { at: number; kind: 'tap' | 'big' | 'dunk' | 'away' | 'abandon' };
/** 당길 때: steady 꾸준 · dart 짧고 잦게 · zigzag 날뛰다 방향을 홱 · heavy 길고 묵직하게 · jump 펄쩍 (그 순간 장력이 확) */
export type FightStyle = 'steady' | 'dart' | 'zigzag' | 'heavy' | 'jump';
/** 너무 일찍 / 늦게 챘을 때 무엇 때문이었는지 (알려 주는 글자) */
export type FailHint = 'approach' | 'tap' | 'flurry' | 'dunk' | 'sink' | 'lift' | 'drag' | null;
export type Catch = { kind: string; name: string; stars: number; cm: number; isNew: boolean; record: boolean };
/** 소리·감정·이펙트용 사건. 한 프레임 동안만 남는다 */
export type FishEvent =
  | { type: 'cast' }
  | { type: 'splash'; x: number; y: number }
  | { type: 'nibble'; strength: number }
  | { type: 'dunk' }
  | { type: 'hesitate'; x: number; y: number }
  | { type: 'abandon' }
  | { type: 'bite'; kind: BiteKind }
  | { type: 'hook'; perfect: boolean }
  | { type: 'run'; x: number; y: number }
  | { type: 'jump'; x: number; y: number }
  | { type: 'zig'; x: number; y: number }
  | { type: 'tired' }
  | { type: 'reelin' }
  | { type: 'caught'; catch: Catch; x: number; y: number }
  | { type: 'fail'; reason: FailReason; hint: FailHint; x: number; y: number }
  | { type: 'legend' }
  | { type: 'bored' };

export type FishMode = 'swim' | 'flee' | 'approach' | 'nibble' | 'hesitate' | 'hooked' | 'leave';
export type Fish = {
  id: number;
  kind: string;
  def: FishDef;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 머리 방향 (단위 벡터) */
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  retarget: number;
  mode: FishMode;
  modeT: number;
  life: number;
  alpha: number;
  cm: number;
  /** 그림자 배율 0.8..1.2 (같은 종이라도 큰 개체는 크게 보인다) */
  size: number;
  scared: number;
  anim: number;
};
/** 도감: 종마다 잡은 수와 가장 큰 크기 (세이브의 fishDex 자리, GDD 10장) */
export type Dex = Record<string, { count: number; best: number }>;
/** 화면 기준 입력. (x, y) 는 배경 그림 좌표, down = 누르고 있음, pressed/released = 이번 프레임에 누름/뗌 */
export type FishInput = { x: number; y: number; down: boolean; pressed: boolean; released: boolean };

export type FishingState = {
  spotId: string;
  spot: SpotDef;
  phase: Phase;
  /** 지금 단계에 들어온 뒤 시간 */
  t: number;
  fishes: Fish[];
  nextId: number;
  spawnIn: number;
  aimX: number;
  aimY: number;
  ring: number;
  castX: number;
  castY: number;
  bobX: number;
  bobY: number;
  waitT: number;
  bored: boolean;
  /** 찌를 노리는 물고기 (다가오는 중 · 톡톡 · 입질) */
  bite: Fish | null;
  /** 이번 물고기의 입질 패턴과 남은 신호, 찌에 붙어 있던 시간, 진짜 입질 시각과 모양 */
  pattern: BitePattern | null;
  cues: Cue[];
  cueT: number;
  biteAt: number;
  biteKind: BiteKind;
  /** 이번 입질에서 챔질할 수 있는 시간 (종 · 입질 모양에 따라) */
  biteWindow: number;
  lastCue: Cue['kind'] | null;
  /** 톡톡 애니메이션 남은 시간과 길이 (짧은 톡 · 큰 톡), 헛잠김 남은 시간 */
  nibbleT: number;
  nibbleLen: number;
  dunkT: number;
  /** 끌고 가는 방향 */
  dragX: number;
  dragY: number;
  reactT: number;
  hooked: Fish | null;
  tension: number;
  stamina: number;
  over: number;
  slack: number;
  run: number;
  runIn: number;
  runX: number;
  runY: number;
  tired: boolean;
  /** 아직 첫 날뜀 전 */
  firstRun: boolean;
  /** 지그재그로 방향을 틀 때까지 · 펄쩍 뛰어 장력이 솟는 남은 시간 */
  zigT: number;
  jumpT: number;
  reeling: boolean;
  perfect: boolean;
  fail: FailReason | null;
  failHint: FailHint;
  catch: Catch | null;
  caughtCount: number;
  dex: Dex;
  events: FishEvent[];
  rng: () => number;
};

const between = (s: FishingState, [a, b]: number[]) => a + (b - a) * s.rng();
const randInt = (s: FishingState, [a, b]: number[]) => a + Math.floor(s.rng() * (b - a + 1));

// ── 물 ── 물 영역은 네 꼭짓점 다각형 (fishing.json water)
export function inWater(spot: SpotDef, x: number, y: number) {
  const p = spot.water;
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const box = (spot: SpotDef) => {
  const xs = spot.water.map((p) => p[0]);
  const ys = spot.water.map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
/** ponytail: 물 영역 바운딩 박스 안으로 가둔다 — 물 다각형이 거의 직사각형이라 충분. 휘어진 물가가 오면 다각형 투영으로 */
export function clampWater(spot: SpotDef, x: number, y: number, m = 20): [number, number] {
  const b = box(spot);
  return [Math.min(b.x1 - m, Math.max(b.x0 + m, x)), Math.min(b.y1 - m, Math.max(b.y0 + m, y))];
}
function randomWater(s: FishingState, m = 40): [number, number] {
  const b = box(s.spot);
  for (let i = 0; i < 30; i++) {
    const x = b.x0 + m + (b.x1 - b.x0 - 2 * m) * s.rng();
    const y = b.y0 + m + (b.y1 - b.y0 - 2 * m) * s.rng();
    if (inWater(s.spot, x, y)) return [x, y];
  }
  return [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
}

// ── 물고기 ──
const pick = (s: FishingState) => pickWeighted(s, s.spot.fish);

export function spawnFish(s: FishingState, kind = pick(s), at?: [number, number], alpha = 0): Fish {
  const def = FISH[kind];
  const [x, y] = at ?? randomWater(s);
  const k = (s.rng() + s.rng()) / 2; // 가운데로 몰린 0..1 — 아주 크거나 작은 건 드물다
  const f: Fish = {
    id: s.nextId++,
    kind,
    def,
    x,
    y,
    vx: 0,
    vy: 0,
    hx: s.rng() < 0.5 ? 1 : -1,
    hy: 0,
    tx: x,
    ty: y,
    retarget: 0,
    mode: 'swim',
    modeT: 0,
    life: 25 + s.rng() * 30,
    alpha,
    cm: Math.round((def.cm[0] + (def.cm[1] - def.cm[0]) * k) * 10) / 10,
    size: 0.8 + 0.4 * k,
    scared: 0,
    anim: s.rng() * 10,
  };
  s.fishes.push(f);
  if (def.legendary) s.events.push({ type: 'legend' });
  return f;
}

/** 그림자 몸길이 (px) */
export const fishLen = (f: Fish) => f.def.shadowW * f.size;

/** 목표로 부드럽게 헤엄친다. 남은 거리를 돌려준다 */
function steer(f: Fish, tx: number, ty: number, speed: number, dt: number) {
  const dx = tx - f.x;
  const dy = ty - f.y;
  const d = Math.hypot(dx, dy) || 1;
  const want = Math.min(speed, d * 2.5); // 목표 가까이선 천천히
  const k = 1 - Math.exp(-2.5 * dt);
  f.vx += ((dx / d) * want - f.vx) * k;
  f.vy += ((dy / d) * want - f.vy) * k;
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  return d;
}

function flee(s: FishingState, f: Fish, fromX: number, fromY: number) {
  let dx = f.x - fromX;
  let dy = f.y - fromY;
  const d = Math.hypot(dx, dy);
  if (d < 1) [dx, dy] = [Math.cos(s.rng() * 7), Math.sin(s.rng() * 7)];
  else [dx, dy] = [dx / d, dy / d];
  [f.tx, f.ty] = clampWater(s.spot, f.x + dx * 240, f.y + dy * 240, 30);
  f.mode = 'flee';
  f.modeT = 0;
  f.scared = 5;
}

/** 찌가 떨어진 곳 둘레의 물고기를 놀라게 한다 (겁 많은 종일수록 멀리서도) */
function scareAround(s: FishingState, x: number, y: number, extra = 0) {
  for (const f of s.fishes)
    if ((f.mode === 'swim' || f.mode === 'approach') && f !== s.hooked && Math.hypot(f.x - x, f.y - y) < f.def.scare * f.size + extra) {
      if (f === s.bite) s.bite = null;
      flee(s, f, x, y);
    }
}

function swimFish(s: FishingState, f: Fish, dt: number) {
  f.anim += dt * (f.mode === 'flee' ? 2.5 : 1);
  f.modeT += dt;
  f.scared = Math.max(0, f.scared - dt);
  if (f.mode !== 'leave') f.alpha = Math.min(1, f.alpha + dt / 1.2);
  switch (f.mode) {
    case 'swim':
      f.life -= dt;
      if (f.life <= 0) {
        f.mode = 'leave';
        break;
      }
      f.retarget -= dt;
      if (f.retarget <= 0 || Math.hypot(f.tx - f.x, f.ty - f.y) < 10) {
        [f.tx, f.ty] = randomWater(s);
        f.retarget = 2 + s.rng() * 4;
      }
      steer(f, f.tx, f.ty, f.def.swim * 0.6, dt);
      break;
    case 'flee':
      steer(f, f.tx, f.ty, f.def.swim * 2 + 80, dt);
      if (f.modeT > 1.2) f.mode = f.life > 0 ? 'swim' : 'leave';
      break;
    case 'leave':
      f.alpha -= dt / 1.5;
      steer(f, f.tx, f.ty, f.def.swim * 0.6, dt);
      break;
  }
  if (Math.hypot(f.vx, f.vy) > 8) {
    const v = Math.hypot(f.vx, f.vy);
    f.hx = f.vx / v;
    f.hy = f.vy / v;
  }
}

// ── 상태 ──
export function makeFishing(spotId: string, dex: Dex = {}, rng: () => number = Math.random): FishingState {
  const spot = SPOTS[spotId];
  if (!spot) throw new Error('낚시터 없음: ' + spotId);
  const s: FishingState = {
    spotId,
    spot,
    phase: 'ready',
    t: 0,
    fishes: [],
    nextId: 1,
    spawnIn: 2,
    aimX: spot.defaultCast[0],
    aimY: spot.defaultCast[1],
    ring: RULES.ringMax,
    castX: spot.defaultCast[0],
    castY: spot.defaultCast[1],
    bobX: spot.defaultCast[0],
    bobY: spot.defaultCast[1],
    waitT: 0,
    bored: false,
    bite: null,
    pattern: null,
    cues: [],
    cueT: 0,
    biteAt: 0,
    biteKind: 'sink',
    biteWindow: 0.6,
    lastCue: null,
    nibbleT: 0,
    nibbleLen: 0.75,
    dunkT: 0,
    dragX: 1,
    dragY: 0,
    reactT: 0,
    hooked: null,
    tension: 0,
    stamina: 1,
    over: 0,
    slack: 0,
    run: 0,
    runIn: 0,
    runX: 1,
    runY: 0,
    tired: false,
    firstRun: false,
    zigT: 0,
    jumpT: 0,
    reeling: false,
    perfect: false,
    fail: null,
    failHint: null,
    catch: null,
    caughtCount: 0,
    dex,
    events: [],
    rng,
  };
  for (let i = 0; i < spot.fishCount; i++) spawnFish(s, undefined, undefined, 1);
  s.events.length = 0; // 처음부터 있던 전설 물고기는 '나타났다' 연출을 하지 않는다
  return s;
}

const enter = (s: FishingState, phase: Phase) => {
  s.phase = phase;
  s.t = 0;
};

function failWith(s: FishingState, reason: FailReason, hint: FailHint = null) {
  const f = s.hooked ?? s.bite;
  const [x, y] = f ? [f.x, f.y] : [s.bobX, s.bobY];
  if (f) {
    f.life = 0; // 놀라 달아난 뒤 사라진다
    f.mode = 'swim';
    flee(s, f, s.bobX, s.bobY);
  }
  s.hooked = null;
  s.bite = null;
  s.fail = reason;
  s.failHint = hint;
  s.events.push({ type: 'fail', reason, hint, x, y });
  enter(s, 'fail');
}

/** 도감에 적는다. 처음 잡은 종인지, 기록을 깼는지 돌려준다 */
export function record(dex: Dex, kind: string, cm: number) {
  const had = dex[kind];
  dex[kind] = { count: (had?.count ?? 0) + 1, best: Math.max(had?.best ?? 0, cm) };
  return { isNew: !had, record: !!had && cm > had.best };
}

function land(s: FishingState) {
  const f = s.hooked!;
  s.fishes = s.fishes.filter((v) => v !== f);
  const r = record(s.dex, f.kind, f.cm);
  s.catch = { kind: f.kind, name: f.def.name, stars: f.def.stars, cm: f.cm, ...r };
  s.caughtCount++;
  s.hooked = null;
  s.events.push({ type: 'caught', catch: s.catch, x: f.x, y: f.y });
  enter(s, 'caught');
}

/** 낚은 뒤 다시 낚시 */
export function again(s: FishingState) {
  s.catch = null;
  enter(s, 'ready');
}

/** 검증용: 이 종이 지금 찌를 물게 한다 (입질 단계로, 입질 모양은 고를 수 있다) */
export function debugBite(s: FishingState, kind: string, biteKind: BiteKind = 'sink') {
  if (s.phase !== 'wait') {
    [s.bobX, s.bobY] = s.spot.defaultCast;
    enter(s, 'wait');
  }
  const f = spawnFish(s, kind, [s.bobX + 30, s.bobY + 6], 1);
  f.mode = 'nibble';
  s.bite = f;
  s.pattern = 'peck';
  s.cues = [];
  startBite(s, f, biteKind);
  s.events.length = 0;
}

/** 물고기 입 (그림자 머리 끝) — 찌·낚싯줄이 붙는 곳 */
export const mouth = (f: Fish) => ({ x: f.x + f.hx * fishLen(f) * 0.42, y: f.y + f.hy * fishLen(f) * 0.42 * 0.6 });

/**
 * 이 물고기가 찌를 노린다: 패턴을 하나 골라(가중치) 신호 순서를 미리 짠다.
 * 시간은 물고기가 찌에 붙어 있는 동안만 흐른다 (물러났다 돌아오는 동안은 멈춤).
 */
export function commitBite(s: FishingState, f: Fish, forced?: BitePattern) {
  const p = forced ?? (pickWeighted(s, f.def.patterns) as BitePattern);
  const cues: Cue[] = [];
  let t = 0.3 + s.rng() * 0.6;
  const push = (kind: Cue['kind'], gap: number) => {
    cues.push({ at: t, kind });
    t += gap;
  };
  const gap = () => 0.45 + s.rng() * 1.25; // 들쭉날쭉 — 박자를 외울 수 없게
  let bite: BiteKind = 'sink';
  switch (p) {
    case 'peck':
      for (let i = randInt(s, f.def.nibbles); i > 0; i--) push(s.rng() < 0.35 ? 'big' : 'tap', gap());
      break;
    case 'flurry':
      for (let b = s.rng() < 0.5 ? 1 : 2; b > 0; b--) {
        for (let i = 3 + Math.floor(s.rng() * 3); i > 0; i--) push('tap', 0.12 + s.rng() * 0.1);
        t += 0.6 + s.rng() * 0.9;
      }
      break;
    case 'lift':
    case 'drag':
      for (let i = randInt(s, [0, 2]); i > 0; i--) push('tap', gap());
      bite = p;
      break;
    case 'slam':
      t = 0.08 + s.rng() * 0.3;
      break;
    case 'fake':
      for (let i = 1 + randInt(s, [0, 2]); i > 0; i--) push(s.rng() < 0.5 ? 'tap' : 'big', gap());
      for (let i = s.rng() < 0.4 ? 2 : 1; i > 0; i--) push('dunk', 0.9 + s.rng() * 0.9);
      break;
    case 'hesitant':
      push('tap', gap());
      push('away', 0.4 + s.rng() * 0.6); // 돌아온 뒤 이만큼 있다가
      if (s.rng() < 0.3) {
        push('abandon', 0);
        break;
      }
      if (s.rng() < 0.5) push('tap', gap());
      break;
  }
  s.bite = f;
  s.pattern = p;
  s.cues = cues;
  s.cueT = 0;
  s.biteAt = t;
  s.biteKind = bite;
  s.lastCue = null;
  f.mode = 'approach';
  f.modeT = 0;
}

function startBite(s: FishingState, f: Fish, kind: BiteKind) {
  s.biteKind = kind;
  s.reactT = 0;
  // 떠오르거나 끌려가는 건 눈에 잘 보이는 대신 조금 느긋하게, 한방은 조금 빡빡하게
  s.biteWindow = f.def.window * (kind === 'drag' ? 1.35 : kind === 'lift' ? 1.15 : s.pattern === 'slam' ? 0.9 : 1);
  if (kind === 'drag') {
    // 미끼를 문 채 돌아서서 옆으로 끌고 간다
    const a = Math.atan2(f.hy, f.hx) + Math.PI + (s.rng() < 0.5 ? -1 : 1) * (0.5 + s.rng() * 0.5);
    [s.dragX, s.dragY] = [Math.cos(a), Math.sin(a)];
  }
  s.events.push({ type: 'bite', kind });
  enter(s, 'bite');
}

function pickWeighted(s: FishingState, w: Record<string, number>) {
  const e = Object.entries(w);
  let r = s.rng() * e.reduce((a, [, v]) => a + v, 0);
  for (const [k, v] of e) if ((r -= v) < 0) return k;
  return e[0][0];
}

export function updateFishing(s: FishingState, input: FishInput, dt: number) {
  s.events.length = 0;
  s.t += dt;
  const R = RULES;

  // 물고기 무리: 찌를 노리거나 걸린 물고기 말고는 제멋대로 헤엄친다. 모자라면 새로 온다
  for (const f of s.fishes) if (f !== s.bite && f !== s.hooked) swimFish(s, f, dt);
  s.fishes = s.fishes.filter((f) => f.alpha > 0 || f.mode !== 'leave');
  if (s.fishes.length < s.spot.fishCount) {
    s.spawnIn -= dt;
    if (s.spawnIn <= 0) {
      spawnFish(s);
      s.spawnIn = 2 + s.rng() * 4;
    }
  }

  switch (s.phase) {
    case 'ready':
      [s.aimX, s.aimY] = clampWater(s.spot, input.x, input.y);
      if (input.pressed) enter(s, 'aim');
      break;

    case 'aim': {
      [s.aimX, s.aimY] = clampWater(s.spot, input.x, input.y);
      // 링: 크게 시작해서 작아졌다가 다시 커진다. 가장 작을 때 떼면 정확하다.
      // |cos| 를 1.6 제곱해 가장 작은 언저리를 조금 길게 — 한두 프레임 어긋나도 작다
      s.ring = R.ringMin + (R.ringMax - R.ringMin) * Math.abs(Math.cos((Math.PI * s.t) / R.ringPeriod)) ** 1.6;
      if (input.released || !input.down) {
        const r = s.ring * Math.sqrt(s.rng());
        const a = s.rng() * Math.PI * 2;
        [s.castX, s.castY] = clampWater(s.spot, s.aimX + Math.cos(a) * r, s.aimY + Math.sin(a) * r);
        s.events.push({ type: 'cast' });
        enter(s, 'cast');
      }
      break;
    }

    case 'cast':
      if (s.t >= R.flight) {
        s.bobX = s.castX;
        s.bobY = s.castY;
        s.events.push({ type: 'splash', x: s.bobX, y: s.bobY });
        scareAround(s, s.bobX, s.bobY);
        s.waitT = 0;
        s.bored = false;
        s.nibbleT = 0;
        s.dunkT = 0;
        enter(s, 'wait');
      }
      break;

    case 'wait': {
      s.waitT += dt;
      s.nibbleT = Math.max(0, s.nibbleT - dt);
      s.dunkT = Math.max(0, s.dunkT - dt);
      const f = s.bite;
      if (input.pressed) {
        if (f) {
          // 무엇에 속았는지: 다가오는 중 · 연타 · 헛잠김 · 톡톡
          const hint: FailHint = !s.lastCue ? 'approach' : s.lastCue === 'dunk' ? 'dunk' : s.pattern === 'flurry' ? 'flurry' : 'tap';
          failWith(s, 'early', hint);
        } else {
          // 아무도 안 물었으면 그냥 다시 감는다 (근처 물고기는 조금 놀란다)
          scareAround(s, s.bobX, s.bobY, 30);
          s.events.push({ type: 'reelin' });
          enter(s, 'ready');
        }
        break;
      }
      if (f && f.mode === 'approach') {
        // 머리를 찌에 댄다: 몸 중심은 찌에서 몸길이 절반쯤 뒤. 한방 패턴은 쏜살같이
        const dx = f.x - s.bobX;
        const dy = f.y - s.bobY;
        const d = Math.hypot(dx, dy) || 1;
        const back = fishLen(f) * 0.45;
        const left = steer(f, s.bobX + (dx / d) * back, s.bobY + (dy / d) * back, f.def.swim * (s.pattern === 'slam' ? 1.6 : 0.7), dt);
        f.anim += dt;
        f.modeT += dt;
        const v = Math.hypot(f.vx, f.vy);
        if (v > 8) [f.hx, f.hy] = [f.vx / v, f.vy / v];
        if (left < 5) {
          f.mode = 'nibble';
          f.modeT = 0;
          // 찌를 바라본다
          const h = Math.hypot(s.bobX - f.x, s.bobY - f.y) || 1;
          [f.hx, f.hy] = [(s.bobX - f.x) / h, (s.bobY - f.y) / h];
        }
      } else if (f && f.mode === 'hesitate') {
        // 망설임: 물러났다가 다시 다가온다
        steer(f, f.tx, f.ty, f.def.swim * 0.8, dt);
        f.anim += dt;
        f.modeT += dt;
        const v = Math.hypot(f.vx, f.vy);
        if (v > 8) [f.hx, f.hy] = [f.vx / v, f.vy / v];
        if (f.modeT > 1.1) {
          f.mode = 'approach';
          f.modeT = 0;
        }
      } else if (f && f.mode === 'nibble') {
        f.anim += dt * 0.5;
        s.cueT += dt;
        while (s.cues.length && s.cues[0].at <= s.cueT && f.mode === 'nibble') {
          const c = s.cues.shift()!;
          s.lastCue = c.kind;
          if (c.kind === 'tap' || c.kind === 'big') {
            s.nibbleLen = s.nibbleT = c.kind === 'big' ? 0.75 : 0.4;
            s.events.push({ type: 'nibble', strength: c.kind === 'big' ? 1 : 0.5 });
          } else if (c.kind === 'dunk') {
            s.dunkT = 0.36;
            s.events.push({ type: 'dunk' });
          } else if (c.kind === 'away') {
            f.mode = 'hesitate';
            f.modeT = 0;
            [f.tx, f.ty] = clampWater(s.spot, f.x - f.hx * 110, f.y - f.hy * 110 * 0.6, 30);
            s.events.push({ type: 'hesitate', x: f.x, y: f.y });
          } else {
            // 그냥 가 버린다 (실패는 아니다 — 다른 물고기를 기다리거나 다시 던진다)
            s.bite = null;
            s.pattern = null;
            f.mode = 'swim';
            f.scared = 6;
            f.retarget = 0;
            s.events.push({ type: 'abandon' });
          }
        }
        if (s.bite === f && f.mode === 'nibble' && !s.cues.length && s.cueT >= s.biteAt) startBite(s, f, s.biteKind);
      } else if (!f && s.waitT > R.settle) {
        // 가까이 있는 물고기일수록, 대담한 종일수록 잘 다가온다
        for (const c of s.fishes) {
          if (c.mode !== 'swim' || c.scared > 0 || c.alpha < 1) continue;
          const d = Math.hypot(c.x - s.bobX, c.y - s.bobY);
          if (d < c.def.notice && s.rng() < c.def.bold * (1 - d / c.def.notice) * 1.2 * dt) {
            commitBite(s, c);
            break;
          }
        }
        if (!s.bored && s.waitT > R.boredTime) {
          s.bored = true;
          s.events.push({ type: 'bored' });
        }
      }
      break;
    }

    case 'bite': {
      s.reactT += dt;
      const f = s.bite!;
      if (s.biteKind === 'drag') {
        // 미끼를 문 채 끌고 간다 — 찌도 따라 미끄러진다
        const sp = 34 + f.def.swim * 0.3;
        [f.x, f.y] = clampWater(s.spot, f.x + s.dragX * sp * dt, f.y + s.dragY * sp * dt * 0.7, 25);
        [f.hx, f.hy] = [s.dragX, s.dragY];
        f.anim += dt * 1.5;
        const m = mouth(f);
        s.bobX = m.x;
        s.bobY = m.y;
      }
      if (input.pressed) {
        s.perfect = s.reactT <= s.biteWindow * R.perfect;
        s.hooked = f;
        s.bite = null;
        f.mode = 'hooked';
        s.tension = 0.35;
        s.stamina = s.perfect ? 0.75 : 1;
        s.tired = false;
        s.over = 0;
        s.slack = 0;
        s.run = 0;
        s.runIn = 0.6 + s.rng() * 0.8; // 첫 날뜀은 곧 — 놓는 법을 바로 배운다
        s.firstRun = true;
        s.jumpT = 0;
        s.events.push({ type: 'hook', perfect: s.perfect });
        enter(s, 'hook');
      } else if (s.reactT > s.biteWindow) failWith(s, 'late', s.biteKind);
      break;
    }

    case 'hook':
      if (s.t >= R.hookTime) enter(s, 'reel');
      break;

    case 'reel':
      reel(s, input, dt);
      break;

    case 'caught':
      if (input.pressed && s.t > 0.6) again(s);
      break;

    case 'fail':
      if (s.t >= R.failTime) {
        s.fail = null;
        enter(s, 'ready');
      }
      break;
  }
}

/**
 * 당기기. 장력 = 감는 힘 + 물고기가 날뛰는 힘. 장력이 1을 넘은 채로 snapGrace 초가 지나면 줄이 끊어지고,
 * 너무 느슨한(slackBelow 밑) 채로 slackTime 초가 지나면 바늘이 빠진다. 장력이 걸려 있는 동안 물고기 기운이 빠지고,
 * 기운이 다하면(tired) 날뛰지 않고 빨리 감긴다. 물고기가 선착장 끝(landing)에 닿으면 낚는다.
 */
function reel(s: FishingState, input: FishInput, dt: number) {
  const R = RULES;
  const f = s.hooked!;
  const d = f.def;
  const reeling = input.down;
  s.reeling = reeling;
  const [Lx, Ly] = s.spot.landing;
  // 날뛰는 모양: 간격 · 길이 · 속도 배율
  const style = d.fight;
  const gapK = style === 'dart' ? 0.55 : style === 'heavy' ? 1.25 : 1;
  const lenK = style === 'dart' ? 0.5 : style === 'heavy' ? 1.6 : 1;
  const spdK = style === 'heavy' ? 0.7 : style === 'dart' ? 1.3 : 1;

  if (s.run > 0) {
    s.run -= dt;
    if (s.run <= 0) s.runIn = between(s, d.runGap) * (0.5 + s.stamina) * gapK;
    // 지그재그: 날뛰는 중에 방향을 홱 튼다 (선착장 쪽으로는 안 튼다)
    if (style === 'zigzag' && s.run > 0 && (s.zigT -= dt) <= 0) {
      let a = Math.atan2(s.runY, s.runX) + (s.rng() < 0.5 ? -1 : 1) * (0.9 + s.rng() * 0.4);
      const away = Math.atan2(f.y - Ly, f.x - Lx);
      if (Math.cos(a - away) < -0.2) a = 2 * away - a; // 선착장 쪽이면 거울처럼 뒤집는다
      [s.runX, s.runY] = [Math.cos(a), Math.sin(a)];
      s.zigT = 0.3 + s.rng() * 0.25;
      s.events.push({ type: 'zig', x: f.x, y: f.y });
    }
  } else if (!s.tired) {
    s.runIn -= dt;
    if (s.runIn <= 0) {
      // 챔질 직후 첫 날뜀은 길다 — 확 달아나며 거리를 벌린다
      s.run = between(s, d.run) * (0.5 + s.stamina * 0.8) * (s.firstRun ? 1.6 : 1) * lenK;
      s.firstRun = false;
      // 선착장 반대쪽으로, 좌우로 조금 비켜서
      const a = Math.atan2(f.y - Ly, f.x - Lx) + (s.rng() - 0.5) * 2.4;
      [s.runX, s.runY] = [Math.cos(a), Math.sin(a)];
      s.zigT = 0.3 + s.rng() * 0.25;
      s.events.push({ type: 'run', x: f.x, y: f.y });
      if (style === 'jump') {
        s.jumpT = 0.4;
        s.events.push({ type: 'jump', x: f.x, y: f.y });
      }
    }
  }
  s.jumpT = Math.max(0, s.jumpT - dt);
  const running = s.run > 0;
  const power = d.pull * (0.45 + 0.55 * s.stamina);
  // 펄쩍 뛰는 순간엔 줄이 확 당겨진다 — 감고 있었으면 더
  const spike = s.jumpT > 0 ? (reeling ? 0.3 : 0.1) : 0;
  const target =
    (reeling ? R.reelTension : 0.08) + (running ? power * (reeling ? 0.9 : 0.35) : 0) - (reeling && s.tired ? 0.12 : 0) + spike;
  s.tension += (target - s.tension) * (1 - Math.exp(-(target > s.tension ? 4 : 3) * dt));

  const lx = Lx - f.x;
  const ly = Ly - f.y;
  const ld = Math.hypot(lx, ly) || 1;
  let vx = 0;
  let vy = 0;
  if (reeling) {
    // 힘센(무거운) 물고기일수록 천천히 감긴다
    const sp = R.reelSpeed * (1.15 - 0.5 * d.pull) * (running ? 0.2 : 1) * (s.tired ? 1.5 : 1);
    vx += (lx / ld) * sp;
    vy += (ly / ld) * sp;
  }
  if (running) {
    const sp = d.runSpeed * power * spdK * (reeling ? 0.35 : 1);
    vx += s.runX * sp;
    vy += s.runY * sp;
  } else if (!reeling) {
    vx -= (lx / ld) * d.swim * 0.25;
    vy -= (ly / ld) * d.swim * 0.25;
  }
  [f.x, f.y] = clampWater(s.spot, f.x + vx * dt, f.y + vy * dt, 10);
  f.vx = vx;
  f.vy = vy;
  // 걸린 물고기는 끌려오는 반대쪽을 본다 (날뛸 땐 달아나는 쪽)
  [f.hx, f.hy] = running ? [s.runX, s.runY] : [-lx / ld, -ly / ld];
  f.anim += dt * (running ? 2.5 : 1.2);
  s.bobX = f.x;
  s.bobY = f.y;

  s.stamina = Math.max(0, s.stamina - dt * (s.tension > 0.25 ? 1 : 0.25) * (R.drain / d.stamina));
  if (!s.tired && s.stamina < R.tired) {
    s.tired = true;
    s.run = 0;
    s.events.push({ type: 'tired' });
  }

  s.over = s.tension >= 1 ? s.over + dt : Math.max(0, s.over - dt * 2);
  if (s.over > R.snapGrace) return failWith(s, 'snap');
  s.slack = s.tension < R.slackBelow ? s.slack + dt : Math.max(0, s.slack - dt * 2);
  if (s.slack > R.slackTime) return failWith(s, 'slack');
  if (ld < R.landRadius) land(s);
}
