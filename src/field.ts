/**
 * 바깥 필드 — 전투 없이 자유롭게 걷는 곳. 좌표는 조각(src/assets/field/)을 이어 붙인 전체 그림의 픽셀.
 * 워프(던전 입구)에 잠시 머물면 그 던전으로 간다. 입구는 src/data/field.json 의 warps 에 추가한다.
 * 포탈은 이정표(docs/signposts.json) 기둥 바로 앞에 있다. to 가 빈 값이면 아직 연결 전이다.
 *
 * 바다에서 배를 타고 가만히 있으면 고래가 나타난다 (그림자 → 솟구쳐 삼킴 → 고래 배 속 미로 → 뱉어 냄, field.json whale).
 * 숲에서 도끼질하면 가끔 재료가 나오고, 부스럭거리는 수풀을 베면 꼭 무언가 나오고, 다람쥐가 튀어나와 달아난다 (field.json forest).
 *
 * 지형(조각마다 src/assets/field/mask_rR_cC.png)에 따라 움직임이 바뀐다.
 *   걷기 · 숲 = 도끼 들고 헤치며 전진 · 물 = 배 · 막힘(암석·절벽) = 못 감
 * 물은 "다음 걸음"으로 판단해서 물 위를 걷거나 땅 위에서 노 젓는 순간이 없다.
 * 숲은 잠깐 스친 걸로는 바뀌지 않는다 (경계에서 모션이 깜빡이지 않게).
 *
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크할 수 있다 (그리기는 field-draw.ts).
 */
import data from './data/field.json' with { type: 'json' };
import { active, makeSquirrel, spawn, SQ, step as stepSquirrelAI, type Squirrel, type SquirrelWhat, type World } from './squirrel.ts';

export const FIELD = data;
export type Warp = (typeof data.warps)[number];

/**
 * 개방 구역 — field.json `open` 은 조각(rR_cC)마다 한 글자 ('o' 열림 · '.' 닫힘, 행 r · 열 c). 밖은 미개방: 막힌 땅처럼 걸어서도 배로도 못 넘어가고,
 * 어둡게 그리고(field-draw · minimap), 그쪽 포탈은 잠긴다. 콘텐츠가 차면 조각을 연다.
 */
export const tileOpen = (r: number, c: number) => data.open[r]?.[c] === 'o';
export function isOpen(x: number, y: number) {
  const [W, H] = data.size;
  const [COLS, ROWS] = data.grid;
  return tileOpen(Math.min(ROWS - 1, Math.floor((y * ROWS) / H)), Math.min(COLS - 1, Math.floor((x * COLS) / W)));
}
/** 개방 구역 테두리 — 열린 조각과 닫힌 조각이 맞닿은 변 [x0, y0, x1, y1] (지도 px, 지도 가장자리는 빼고) */
export function openEdges() {
  const [W, H] = data.size;
  const [COLS, ROWS] = data.grid;
  const X = (c: number) => Math.floor((c * W) / COLS);
  const Y = (r: number) => Math.floor((r * H) / ROWS);
  const out: [number, number, number, number][] = [];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (!tileOpen(r, c)) continue;
      if (r > 0 && !tileOpen(r - 1, c)) out.push([X(c), Y(r), X(c + 1), Y(r)]);
      if (r < ROWS - 1 && !tileOpen(r + 1, c)) out.push([X(c), Y(r + 1), X(c + 1), Y(r + 1)]);
      if (c > 0 && !tileOpen(r, c - 1)) out.push([X(c), Y(r), X(c), Y(r + 1)]);
      if (c < COLS - 1 && !tileOpen(r, c + 1)) out.push([X(c + 1), Y(r), X(c + 1), Y(r + 1)]);
    }
  return out;
}
/** 미개방 구역의 포탈 (워프도 안 되고 빨아들이지도 않는다) */
export const warpLocked = (w: Warp) => !isOpen(w.at[0], w.at[1]);

export const WALK = 0;
export const FOREST = 1;
export const WATER = 2;
export const BLOCK = 3;
/** 다리: 걸어서도 지나가고, 배도 내리지 않고 지나간다 */
export const BRIDGE = 4;
export type Terrain = typeof WALK | typeof FOREST | typeof WATER | typeof BLOCK | typeof BRIDGE;
export type TerrainAt = (x: number, y: number) => Terrain;
const everywhereWalk: TerrainAt = () => WALK;

/** walk 걷기 · axe 숲 · boat 배 · board 배에 오르는 중 · unboard 배에서 내리는 중 */
export type Mode = 'walk' | 'axe' | 'boat' | 'board' | 'unboard';

/** 연출용 사건. 한 프레임 동안만 남는다 (소리·파티클이 가져간다) */
export type FieldEvent =
  | { type: 'chop'; x: number; y: number; flip: number }
  | { type: 'splash'; x: number; y: number }
  | { type: 'ripple'; x: number; y: number }
  | { type: 'stroke'; x: number; y: number }
  /** 미개방 구역으로 밀고 들어가려 했다 (막힘) */
  | { type: 'locked' }
  /** 고래: near 그림자가 나타남 · gone 그림자가 사라짐 · rise 솟구치기 시작 · breach 물 위로 · gulp 꿀꺽 · in 배 속으로 · spit 퉤 · dive 잠수 */
  | { type: 'whale'; what: WhaleWhat; x: number; y: number }
  /** 숲에서 나온 것 (도끼질 · 부스럭 수풀). main 이 가방에 넣고 full(못 넣음)을 적는다 — 그리기가 그걸 보고 고양이에게 날아오거나 떨어뜨린다 */
  | { type: 'forage'; id: string; x: number; y: number; full?: boolean }
  /** 부스럭 수풀: start 생김 · open 베어서 열림 */
  | { type: 'rustle'; what: 'start' | 'open'; x: number; y: number }
  /** 다람쥐: appear 튀어나옴 · throw 도토리 던짐 · bonk 고양이가 맞음 · dodge 홱 피함 · caught 잡힘(stash 를 내놓는다 — main 이 가방에, full 도 적는다) · escape 숨음 */
  | { type: 'squirrel'; what: SquirrelWhat; x: number; y: number; stash?: Stash; full?: boolean }
  /** 다람쥐를 쫓으며 숲을 헤치고 달린다 (나뭇잎만) */
  | { type: 'brush'; x: number; y: number; flip: number };
export type WhaleWhat = 'near' | 'gone' | 'rise' | 'breach' | 'gulp' | 'in' | 'spit' | 'dive';
/** 잡힌 다람쥐가 내놓는 것 */
export type Stash = { items: string[]; coins: number };

export const WHALE = data.whale;
/** 고래가 솟구쳐 삼키는 순서 (초, 그리기도 같은 시계): 그림자가 배 밑으로 → 물 위로 → 입 벌림 → 꿀꺽(배가 입속으로) → 입 다묾 → 냠냠 → 배 속으로 */
export const RISE = { dash: 0.6, emerge: 1.4, open: 2.1, gulp: 2.7, close: 3.1, end: 3.9 };
/** 뱉어 내는 순서: 솟구침 → 입 벌림 → 퉤(배가 날아 나온다) → 물에 떨어짐(여기서부터 움직일 수 있다) → 입 다묾 → 잠수 */
export const SPIT = { emerge: 0.5, open: 1.1, out: 1.2, land: 1.8, close: 2.2, end: 3.3 };
export type Whale = {
  /** none 없음 · lurk 그림자가 맴돈다 · leave 배가 움직여 흐려진다 · rise 솟구쳐 삼킨다 · gulped 삼켰다(main 이 배 속으로) · spit 뱉어 낸다 */
  phase: 'none' | 'lurk' | 'leave' | 'rise' | 'gulped' | 'spit';
  /** 바다 위에 가만히 있던 시간 */
  still: number;
  /** 지금 단계에 들어온 뒤 흐른 시간 */
  t: number;
  /** 이번 그림자가 맴돌 시간 (hold 범위에서 무작위) */
  hold: number;
  /** 그림자 진하기 0..1 */
  alpha: number;
  /** 다시 나올 수 있을 때까지 (초) */
  cool: number;
  /** 고래가 솟는 자리 (배가 있던 곳) */
  x: number;
  y: number;
  /** 그림자 — 낚시 물고기처럼 배 둘레의 목표(tx, ty)로 부드럽게 헤엄친다: 자리 · 속도 · 바라보는 쪽 · 다음 목표까지 · 꼬리 흔들기 시계 */
  sx: number;
  sy: number;
  vx: number;
  vy: number;
  hx: number;
  hy: number;
  tx: number;
  ty: number;
  retarget: number;
  anim: number;
};

export const FOREST_DATA = data.forest;
/** 숲에서 오래 기억하는 것 — 필드를 새로 만들어도(던전에서 나와도) 이어 간다: 숲 시계 · 칸마다 다시 나올 때 · 다람쥐 쿨다운 */
export type Woods = { t: number; rest: Map<number, number>; cool: number };
/** 부스럭거리는 수풀 */
export type Rustle = { x: number; y: number; t: number };

const EDGE = 24; // 그림 가장자리 여백
const CAM_EASE = 8; // 카메라가 따라오는 속도
const SEEK = 40; // 물가·뭍을 찾아볼 거리 (px)
// 캐릭터 크기에 딸린 거리는 전부 고양이 키(catBody)의 배수다 — 키를 바꾸면 같이 줄고 는다
const PUSH = data.catBody * 0.3; // 배는 물가에서 이만큼 더 안쪽에, 내릴 땐 뭍 안쪽에 선다

export type FieldState = {
  x: number;
  y: number;
  flip: number;
  moving: boolean;
  animT: number;
  camX: number;
  camY: number;
  mode: Mode;
  /** 지금 모드에 들어온 뒤 흐른 시간 */
  modeT: number;
  /** 숲↔길 이 바뀐 채로 머문 시간 (forestDelay 넘으면 모드를 바꾼다) */
  pendT: number;
  /** 숲에서 걸은 시간 (chopEvery 마다 한 번 휘두른다) */
  chopT: number;
  /** 휘두르는 중이면 남은 시간 */
  chopping: number;
  /** 지금까지 도끼로 친 횟수 (검증용) */
  chops: number;
  strokeT: number;
  /** 배에서 내려 설 곳 */
  landX: number;
  landY: number;
  events: FieldEvent[];
  /** 지금 서 있는 워프 */
  warp: Warp | null;
  /** 워프 안에 머문 시간 */
  dwell: number;
  /** 워프 안에서 시작했으면 한 번 나갔다 들어와야 작동한다 (도착하자마자 되돌아가지 않게) */
  armed: boolean;
  whale: Whale;
  woods: Woods;
  rustles: Rustle[];
  /** 다음 부스럭 수풀까지 (초) */
  rustleT: number;
  squirrel: Squirrel;
  /** 쫓으며 숲을 헤칠 때 나뭇잎 시계 */
  brushT: number;
};

/** 바닥에 눕힌 타원 안인가 (필드는 비스듬히 내려다본 그림이라 세로가 눌려 있다) */
export const inWarp = (w: Warp, x: number, y: number) =>
  ((x - w.at[0]) / w.r) ** 2 + ((y - w.at[1]) / (w.r * data.vertical)) ** 2 <= 1;

/** 아직 던전이 연결되지 않은 포탈(to 가 빈 값)과 미개방 구역의 포탈은 그려지기만 하고 빨아들이지 않는다 */
const warpAt = (x: number, y: number) => data.warps.find((w) => w.to && !warpLocked(w) && inWarp(w, x, y)) ?? null;
/** 미개방 구역은 막힌 땅으로 본다 */
const gated = (at: TerrainAt): TerrainAt => (x, y) => (isOpen(x, y) ? at(x, y) : BLOCK);
const clampX = (x: number) => Math.min(data.size[0] - EDGE, Math.max(EDGE, x));
const clampY = (y: number) => Math.min(data.size[1] - EDGE, Math.max(EDGE, y));

/** keep = 이전 필드 — 숲에서 오래 기억하는 것(나온 자리 · 다람쥐 쿨다운)을 이어 간다 */
export function makeFieldState([x, y]: number[], terrainAt0: TerrainAt = everywhereWalk, keep?: FieldState): FieldState {
  const terrainAt = gated(terrainAt0);
  return {
    x,
    y,
    flip: 1,
    moving: false,
    animT: 0,
    camX: x,
    camY: y,
    mode: terrainAt(x, y) === FOREST ? 'axe' : 'walk',
    modeT: 0,
    pendT: 0,
    chopT: 0,
    chopping: 0,
    chops: 0,
    strokeT: 0,
    landX: x,
    landY: y,
    events: [],
    warp: null,
    dwell: 0,
    armed: !warpAt(x, y),
    whale: { phase: 'none', still: 0, t: 0, hold: 0, alpha: 0, cool: 0, x, y, sx: x, sy: y, vx: 0, vy: 0, hx: 1, hy: 0, tx: x, ty: y, retarget: 0, anim: 0 },
    woods: keep?.woods ?? { t: 0, rest: new Map(), cool: 0 },
    rustles: [],
    rustleT: 2,
    squirrel: makeSquirrel(x, y),
    brushT: 0,
  };
}

const setMode = (s: FieldState, m: Mode) => {
  s.mode = m;
  s.modeT = 0;
  s.pendT = 0;
  s.chopT = 0;
  s.chopping = 0;
};

/** (x, y) 에서 (ux, uy) 쪽으로 가며 want 지형이 처음 나오는 곳. 못 찾으면 null */
function seek(s: FieldState, ux: number, uy: number, want: (t: Terrain) => boolean, at: TerrainAt) {
  for (let d = 1; d <= SEEK; d++) {
    const x = clampX(s.x + ux * d);
    const y = clampY(s.y + uy * d * data.vertical);
    if (want(at(x, y))) {
      // 조금 더 안쪽으로. 너무 좁아서 넘어가 버리면 처음 찾은 곳
      const px = clampX(x + ux * PUSH);
      const py = clampY(y + uy * PUSH * data.vertical);
      return want(at(px, py)) ? { x: px, y: py } : { x, y };
    }
  }
  return null;
}

/**
 * 배로 넘어갈 다리인가: 가는 쪽으로 bridge px 안에서 다리(노랑)를 지나 다시 물이 나온다.
 * 다리가 아닌 땅(풀밭·모래·바위)이 끼면 넘어가지 않고 내린다 — 좁은 풀밭은 다리가 아니다.
 * 마스크 경계는 색이 섞여 한두 칸 튀니 다리 아닌 땅 4px 까지는 봐준다.
 */
function waterPast(s: FieldState, ux: number, uy: number, at: TerrainAt) {
  let bridge = false;
  let other = 0;
  for (let d = 2; d <= FIELD.modes.boat.bridge; d += 2) {
    const t = at(clampX(s.x + ux * d), clampY(s.y + uy * d * data.vertical));
    if (t === BLOCK) return false;
    if (t === WATER) {
      if (bridge) return true;
      continue;
    }
    if (t === BRIDGE) bridge = true;
    else if ((other += 2) > 4) return false;
  }
  return false;
}

/** 배가 다리 위를 지나는 중인가 (그때만 배가 땅 위에 있어도 된다) */
export const bridging = (s: FieldState, at: TerrainAt) => s.mode === 'boat' && at(s.x, s.y) === BRIDGE;

/** 고래가 나오는 바다: whale.sea 조각 안의 물이고, 둘레 room×catBody 도 다 물이다 (앞바다는 되고, 강·호수·물가 바로 옆은 안 된다) */
export function whaleSea(x: number, y: number, at: TerrainAt) {
  const c = Math.floor((x * data.grid[0]) / data.size[0]);
  const r = Math.floor((y * data.grid[1]) / data.size[1]);
  if (!WHALE.sea.some(([sr, sc]) => sr === r && sc === c) || at(x, y) !== WATER) return false;
  const R = WHALE.room * data.catBody;
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    if (at(x + Math.cos(a) * R, y + Math.sin(a) * R * data.vertical) !== WATER) return false;
  }
  return true;
}

/** 그림자가 물 위에만 오게 — 몸이 들어갈 타원(머리·꼬리 끝까지, 양옆 · 대각선)이 다 물인 곳 (선착장 널빤지·물가에 걸치지 않게) */
function shadowWet(x: number, y: number, at: TerrainAt) {
  const L = WHALE.shadow * data.catBody * 0.55;
  const W = L * 0.45 * data.vertical;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    if (at(x + Math.cos(a) * L, y + Math.sin(a) * W) !== WATER) return false;
  }
  return at(x, y) === WATER;
}
/** 배 둘레 r0..r1 (catBody 배) 안에서 그림자가 다 물 위에 오는 한 점 — from 에서 가는 길(가운데)도 물. 못 찾으면 null */
function aroundBoat(s: FieldState, r0: number, r1: number, at: TerrainAt, rng: () => number, from?: { x: number; y: number }): [number, number] | null {
  for (let i = 0; i < 24; i++) {
    const a = rng() * Math.PI * 2;
    const r = (r0 + rng() * (r1 - r0)) * data.catBody;
    const x = s.x + Math.cos(a) * r;
    const y = s.y + Math.sin(a) * r * data.vertical;
    if (shadowWet(x, y, at) && (!from || shadowWet((x + from.x) / 2, (y + from.y) / 2, at))) return [x, y];
  }
  return null;
}
/** 낚시 물고기처럼 목표로 부드럽게 헤엄친다 (가까우면 천천히, 바라보는 쪽은 속도를 따라). grip 이 크면 방향을 빨리 튼다 */
function swim(w: Whale, tx: number, ty: number, speed: number, dt: number, grip = 2.5) {
  const dx = tx - w.sx;
  const dy = ty - w.sy;
  const d = Math.hypot(dx, dy) || 1;
  const want = Math.min(speed, d * 2.5);
  const k = 1 - Math.exp(-grip * dt);
  w.vx += ((dx / d) * want - w.vx) * k;
  w.vy += ((dy / d) * want - w.vy) * k;
  w.sx += w.vx * dt;
  w.sy += w.vy * dt;
  const v = Math.hypot(w.vx, w.vy);
  if (v > 3) {
    w.hx = w.vx / v;
    w.hy = w.vy / v;
  }
  w.anim += dt * (0.5 + Math.min(1.5, v / (WHALE.swim * data.catBody))); // 빨리 헤엄칠수록 꼬리를 빨리
}

/** 고래 한 프레임. 솟구치는 동안 · 뱉어 내다 배가 물에 떨어지기 전까지는 true (조작을 받지 않는다) */
function stepWhale(s: FieldState, input: boolean, dt: number, at: TerrainAt, rng: () => number): boolean {
  const w = s.whale;
  const emit = (what: WhaleWhat) => s.events.push({ type: 'whale', what, x: w.x, y: w.y });
  const was = w.t;
  w.t += dt;
  const passed = (k: number) => was < k && w.t >= k;
  const C = data.catBody;
  if (w.phase === 'rise') {
    if (w.t < RISE.dash) swim(w, w.x, w.y, WHALE.swim * 6 * C, dt, 9); // 배 밑으로 돌진
    if (passed(RISE.dash)) emit('breach');
    if (passed(RISE.gulp)) emit('gulp');
    if (w.t >= RISE.end) {
      w.phase = 'gulped';
      emit('in');
    }
    return true;
  }
  if (w.phase === 'gulped') return true; // main 이 고래 배 속(미로)으로 데려간다
  if (w.phase === 'spit') {
    if (passed(SPIT.out)) emit('spit');
    if (passed(SPIT.land)) s.events.push({ type: 'splash', x: s.x, y: s.y });
    if (passed(SPIT.close)) emit('dive');
    if (w.t >= SPIT.end) Object.assign(w, { phase: 'none', cool: WHALE.cooldown, still: 0, alpha: 0 });
    return w.t < SPIT.land;
  }
  if (w.cool > 0) w.cool = Math.max(0, w.cool - dt);
  const sea = s.mode === 'boat' && whaleSea(s.x, s.y, at);
  w.still = sea && !input ? w.still + dt : 0;
  if (w.phase === 'none') {
    if (w.still >= WHALE.still && w.cool <= 0) {
      // 조금 떨어진 물에서 나타나 배 쪽으로 헤엄쳐 온다
      const [h0, h1] = WHALE.hold;
      const [sx, sy] = aroundBoat(s, WHALE.from[0], WHALE.from[1], at, rng) ?? aroundBoat(s, WHALE.near[0], WHALE.near[1], at, rng) ?? [s.x, s.y];
      const [tx, ty] = aroundBoat(s, WHALE.near[0], WHALE.near[1], at, rng, { x: sx, y: sy }) ?? [sx, sy];
      Object.assign(w, { phase: 'lurk', t: 0, x: s.x, y: s.y, hold: h0 + rng() * (h1 - h0), sx, sy, vx: 0, vy: 0, tx, ty, retarget: 2 + rng() * 2, alpha: 0 });
      emit('near');
    }
  } else if (w.phase === 'lurk') {
    // 배 둘레를 얼쩡거린다: 둘레의 물 위 한 점으로 헤엄쳐 가고, 닿거나 잠시 뒤엔 다른 점으로 (가끔 배 밑으로도)
    w.alpha = Math.min(1, w.alpha + dt / WHALE.fadeIn);
    w.retarget -= dt;
    if (w.retarget <= 0 || Math.hypot(w.tx - w.sx, w.ty - w.sy) < 0.5 * C) {
      [w.tx, w.ty] = aroundBoat(s, WHALE.near[0], WHALE.near[1], at, rng, { x: w.sx, y: w.sy }) ?? [w.tx, w.ty];
      w.retarget = 1.6 + rng() * 2;
    }
    swim(w, w.tx, w.ty, WHALE.swim * C, dt);
    if (!sea || input) {
      // 배가 움직이면 배에서 먼 쪽으로 헤엄쳐 가며 흐려진다
      const dx = w.sx - s.x;
      const dy = w.sy - s.y;
      const d = Math.hypot(dx, dy) || 1;
      Object.assign(w, { phase: 'leave', t: 0, tx: w.sx + (dx / d) * 8 * C, ty: w.sy + (dy / d) * 8 * C });
    } else if (w.t >= w.hold) {
      Object.assign(w, { phase: 'rise', t: 0, x: s.x, y: s.y });
      emit('rise');
      return true;
    }
  } else if (w.phase === 'leave') {
    swim(w, w.tx, w.ty, WHALE.swim * 2 * C, dt);
    w.alpha = Math.max(0, w.alpha - dt / WHALE.fadeOut);
    if (w.alpha <= 0) {
      w.phase = 'none';
      emit('gone');
    }
  }
  return false;
}

/** 고래 배 속에서 나왔다 — 삼켰던 자리에서 배를 탄 채로 뱉어 낸다 (나온 뒤 cooldown 초는 고래가 안 나온다) */
export function whaleSpit(s: FieldState) {
  Object.assign(s.whale, { phase: 'spit', t: 0, x: s.x, y: s.y, alpha: 0, still: 0 });
  setMode(s, 'boat');
  s.moving = false;
}

// ── 숲: 도끼질에 나오는 것 · 부스럭 수풀 · 다람쥐 (field.json forest) ─────────────────────────
const between = ([a, b]: number[], rng: () => number) => a + rng() * (b - a);
const int = ([a, b]: number[], rng: () => number) => a + Math.floor(rng() * (b - a + 1));
/** [id, 비율] 표에서 하나 */
function pickFrom(table: (string | number)[][], rng: () => number) {
  let r = rng() * table.reduce((a, [, w]) => a + (w as number), 0);
  return (table.find(([, w]) => (r -= w as number) < 0) ?? table[0])[0] as string;
}
/** 고양이에게서 (x, y) 까지 (catBody 배 — 세로는 비스듬한 시점만큼 펴서 잰다) */
const gap = (s: FieldState, x: number, y: number) => Math.hypot(x - s.x, (y - s.y) / data.vertical) / data.catBody;
/** 다람쥐가 설 수 있는 곳: 열린 뭍 (걷기 · 숲 · 다리) */
const landAt = (x: number, y: number, at: TerrainAt) => {
  const t = at(x, y);
  return t === WALK || t === FOREST || t === BRIDGE;
};
/** 수풀이 생길 숲 안쪽 — 둘레도 숲 (숲 가장자리에 걸치지 않게) */
const deepWoods = (x: number, y: number, at: TerrainAt) =>
  [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => at(x + dx * 0.8 * data.catBody, y + dy * 0.6 * data.catBody) === FOREST);

/** 다람쥐가 사는 필드: 열린 뭍(걷기 · 숲 · 다리)에 서고 숲을 좋아한다 (숲에선 고양이가 느리다) */
const fieldWorld = (at: TerrainAt): World => ({ land: (x, y) => landAt(x, y, at), woods: (x, y) => at(x, y) === FOREST, unit: data.catBody, vertical: data.vertical });

/** 다람쥐가 나와 있다 — 고양이는 숲에서도 멈춰 도끼질하지 않고 달린다 */
export const chasing = (s: FieldState) => active(s.squirrel);

/** (x, y) 수풀에서 다람쥐가 튀어나와 고양이 반대쪽 뭍으로 폴짝 (폴짝 뛰는 동안은 못 잡는다) */
export function spawnSquirrel(s: FieldState, x: number, y: number, at0: TerrainAt, rng: () => number) {
  spawn(s.squirrel, s, x, y, fieldWorld(gated(at0)), rng);
  s.chopping = 0; // 휘두르다 말고 쫓아간다
  s.events.push({ type: 'squirrel', what: 'appear', x, y });
}

/** 도끼로 친 순간: 가까운 부스럭 수풀을 열거나, 다람쥐가 튀어나오거나, 가끔 무언가 나온다 (나온 자리는 rest 초 동안 쉰다) */
function onChop(s: FieldState, x: number, y: number, at: TerrainAt, rng: () => number) {
  const F = data.forest;
  const free = s.squirrel.phase === 'none' && s.woods.cool <= 0;
  const i = s.rustles.findIndex((r) => gap(s, r.x, r.y) < F.rustle.reach);
  if (i >= 0) {
    const [r] = s.rustles.splice(i, 1);
    s.events.push({ type: 'rustle', what: 'open', x: r.x, y: r.y });
    if (free && rng() < F.rustle.squirrel) spawnSquirrel(s, r.x, r.y, at, rng);
    else s.events.push({ type: 'forage', id: pickFrom(F.rustle.finds, rng), x: r.x, y: r.y });
    return;
  }
  if (free && rng() < SQ.chance) return spawnSquirrel(s, x, y, at, rng);
  const cell = Math.floor(x / (F.cell * data.catBody)) + Math.floor(y / (F.cell * data.catBody)) * 4096;
  if ((s.woods.rest.get(cell) ?? -1) > s.woods.t || rng() >= F.find) return;
  s.woods.rest.set(cell, s.woods.t + F.rest);
  s.events.push({ type: 'forage', id: pickFrom(F.finds, rng), x, y });
}

/** 부스럭 수풀: 뭍에 있으면 every 초마다 고양이 둘레 숲 안쪽에 하나 (max 개까지). 오래되거나 멀어지면 사라진다 */
function stepRustles(s: FieldState, dt: number, at: TerrainAt, rng: () => number) {
  const R = data.forest.rustle;
  for (const r of s.rustles) r.t += dt;
  s.rustles = s.rustles.filter((r) => r.t < R.life && gap(s, r.x, r.y) < 16);
  if (s.mode !== 'walk' && s.mode !== 'axe') return;
  if ((s.rustleT -= dt) > 0 || s.rustles.length >= R.max) return;
  s.rustleT = between(R.every, rng);
  for (let k = 0; k < 16; k++) {
    const a = rng() * Math.PI * 2;
    const d = between(R.near, rng) * data.catBody;
    const x = s.x + Math.cos(a) * d;
    const y = s.y + Math.sin(a) * d * data.vertical;
    if (!deepWoods(x, y, at) || s.rustles.some((r) => Math.hypot(r.x - x, r.y - y) < 3 * data.catBody)) continue;
    s.rustles.push({ x, y, t: 0 });
    s.events.push({ type: 'rustle', what: 'start', x, y });
    return;
  }
}

/** 다람쥐 한 프레임 (squirrel.ts) — 잡히면 숨겨 둔 것(stash)을 내놓고, 잡힘 · 숨음 연출이 끝나면 cooldown 초 동안 안 나온다 */
function stepSquirrel(s: FieldState, dt: number, at: TerrainAt, rng: () => number) {
  const end = stepSquirrelAI(s.squirrel, s, dt, fieldWorld(at), rng, (what, x, y) => {
    if (what !== 'caught') return void s.events.push({ type: 'squirrel', what, x, y });
    const S = SQ.stash;
    const items = [...Array(int(S.acorns, rng)).fill('materials_05'), ...S.bonus.filter(([, p]) => rng() < (p as number)).map(([id]) => id as string)];
    s.events.push({ type: 'squirrel', what, x, y, stash: { items, coins: int(S.coins, rng) } });
  });
  if (end) s.woods.cool = SQ.cooldown;
}

/** 한 프레임 진행. 워프에 충분히 머물렀으면 그 워프를 돌려준다. mx, my 는 화면 기준 -1..1 */
export function updateField(
  s: FieldState,
  mx: number,
  my: number,
  dt: number,
  at0: TerrainAt = everywhereWalk,
  rng: () => number = Math.random,
): Warp | null {
  const at = gated(at0);
  s.events.length = 0;
  s.animT += dt;
  s.modeT += dt;
  const k = 1 - Math.exp(-CAM_EASE * dt);
  s.camX += (s.x - s.camX) * k;
  s.camY += (s.y - s.camY) * k;

  // 배에 오르고 내리는 동안은 조작을 받지 않는다
  if (s.mode === 'board' || s.mode === 'unboard') {
    s.moving = false;
    const land = FIELD.boardTime * 0.45; // 고양이가 배에 닿는(뛰어내리는) 순간
    if (s.modeT >= land && s.modeT - dt < land) s.events.push({ type: 'splash', x: s.x, y: s.y });
    if (s.modeT >= FIELD.boardTime) {
      if (s.mode === 'board') setMode(s, 'boat');
      else {
        s.events.push({ type: 'ripple', x: s.x, y: s.y }); // 배가 있던 자리 (배는 물결과 함께 사라진다)
        s.x = s.landX;
        s.y = s.landY;
        setMode(s, at(s.x, s.y) === FOREST ? 'axe' : 'walk');
      }
    }
    return null;
  }

  // 고래: 솟구쳐 삼키는 동안 · 뱉어 내는 동안은 조작을 받지 않는다
  if (stepWhale(s, mx !== 0 || my !== 0, dt, at, rng)) {
    s.moving = false;
    return null;
  }

  const len = Math.hypot(mx, my);
  const ux = len ? mx / len : 0;
  const uy = len ? my / len : 0;
  s.moving = len > 0;
  if (mx !== 0) s.flip = Math.sign(mx);

  const M = FIELD.modes;
  // 다람쥐를 쫓는 동안은 숲에서도 멈춰 도끼질하지 않고 달린다
  const chase = chasing(s);
  let speed = FIELD.speed * M[s.mode === 'boat' ? 'boat' : s.mode === 'axe' ? 'axe' : 'walk'].speed;
  if (s.mode === 'axe') speed = FIELD.speed * (chase ? SQ.chase : s.chopping > 0 ? M.axe.chopSpeed : M.axe.speed);

  if (s.moving) {
    const nx = clampX(s.x + ux * speed * dt);
    const ny = clampY(s.y + uy * speed * FIELD.vertical * dt);
    const next = at(nx, ny);
    const afloat = s.mode === 'boat';
    // 배는 크니 뱃머리가 먼저 뭍에 닿는다
    const reach = M.boat.bow * FIELD.catBody;
    const bowX = clampX(nx + ux * reach);
    const bowY = clampY(ny + uy * reach * FIELD.vertical);
    const bow = at(bowX, bowY);
    const ground = (t: Terrain) => t !== WATER && t !== BLOCK;
    if (!afloat && next === WATER) {
      // 물가: 배를 띄우고 올라탄다. 시트 첫 컷은 고양이가 배 왼쪽 offset 만큼에 서 있으니,
      // 배를 그만큼 앞 물 위에 띄우면 고양이가 방금 걷던 자리에서 그대로 뛰어든다
      const face = ux !== 0 ? Math.sign(ux) : s.flip;
      const fx = clampX(s.x + face * M.boat.offset * FIELD.catBody);
      const b = at(fx, s.y) === WATER ? { x: fx, y: s.y } : seek(s, ux, uy, (t) => t === WATER, at);
      if (b) {
        s.x = b.x;
        s.y = b.y;
        s.flip = face;
        s.events.push({ type: 'ripple', x: s.x, y: s.y });
        setMode(s, 'board');
        return null;
      }
    } else if (afloat && (ground(next) || ground(bow)) && (next === WATER || next === BRIDGE) && waterPast(s, ux, uy, at)) {
      // 다리: 다리 너머로 물이 이어지면 내리지 않고 배로 넘어간다 (타고 내리기를 반복하지 않게).
      // 배는 물 아니면 다리 위에만 선다 — 다음 걸음이 다리가 아닌 땅이면 여기로 오지 않고 내린다
      s.x = nx;
      s.y = ny;
    } else if (afloat && at(s.x, s.y) !== WATER && next !== WATER) {
      // 다리 위에서 물로 이어지지 않는 쪽(다리를 따라)으로는 가지 않는다 — 배는 땅에 잠깐만 올라선다
    } else if (afloat && (ground(next) || ground(bow))) {
      // 뭍: 배는 그 자리에 두고 뛰어내린다. 시트는 고양이가 배 왼쪽에 내려서니, 오른쪽 뭍이면 뒤집는다.
      // 마지막 컷에서 고양이가 배 옆 offset 만큼에 서니 그 자리가 뭍이면 거기, 아니면 가까운 뭍
      const face = ux !== 0 ? Math.sign(ux) : s.flip;
      const lx = clampX(s.x + face * M.boat.offset * FIELD.catBody);
      const l = ground(at(lx, s.y)) ? { x: lx, y: s.y } : seek(s, ux, uy, ground, at);
      if (l) {
        s.landX = l.x;
        s.landY = l.y;
        s.flip = -face;
        setMode(s, 'unboard');
        return null;
      }
    } else if (next === BLOCK || (afloat && bow === BLOCK)) {
      // 막힌 곳: 한 축으로라도 미끄러져 본다. 미개방 구역이라 막힌 거면 알린다
      if (!isOpen(nx, ny) || (afloat && !isOpen(bowX, bowY))) s.events.push({ type: 'locked' });
      const tx = clampX(s.x + ux * speed * dt);
      const ty = clampY(s.y + uy * speed * FIELD.vertical * dt);
      const ok = (x: number, y: number) => {
        const t = at(x, y);
        return t !== BLOCK && (t === WATER) === afloat;
      };
      if (ok(tx, s.y)) s.x = tx;
      else if (ok(s.x, ty)) s.y = ty;
    } else {
      s.x = nx;
      s.y = ny;
    }
  }

  // 숲 ↔ 길: 잠깐 스친 걸로는 안 바꾼다
  if (s.mode === 'walk' || s.mode === 'axe') {
    const want: Mode = at(s.x, s.y) === FOREST ? 'axe' : 'walk';
    if (want !== s.mode) {
      s.pendT += dt;
      if (s.pendT >= FIELD.forestDelay) setMode(s, want);
    } else s.pendT = 0;
  }

  // 도끼질: 숲에서 걷는 동안 chopEvery 마다 한 번. 휘두른 지 절반(내려찍는 프레임)에 맞는다
  if (s.mode === 'axe') {
    if (s.chopping > 0) {
      const hit = M.axe.chopTime * 0.5;
      const before = s.chopping;
      s.chopping = Math.max(0, s.chopping - dt);
      if (before > hit && s.chopping <= hit) {
        s.chops++;
        const b = FIELD.catBody;
        const cx = s.x + s.flip * b * 0.26;
        const cy = s.y - b * 0.18;
        s.events.push({ type: 'chop', x: cx, y: cy, flip: s.flip });
        onChop(s, cx, cy, at, rng);
      }
    } else if (s.moving && chase) {
      // 쫓으며 숲을 헤친다 — 나뭇잎만 날린다
      s.brushT += dt;
      if (s.brushT >= 0.22) {
        s.brushT = 0;
        s.events.push({ type: 'brush', x: s.x + s.flip * FIELD.catBody * 0.3, y: s.y - FIELD.catBody * 0.15, flip: s.flip });
      }
    } else if (s.moving) {
      // 멈춰도 타이머는 그대로 둔다 — 방향을 바꾸는 한 프레임 멈춤마다 0 이 되면 지그재그로 걸을 때 도끼를 안 휘두른다
      s.chopT += dt;
      if (s.chopT >= M.axe.chopEvery) {
        s.chopT = 0;
        s.chopping = M.axe.chopTime;
      }
    }
  }

  // 숲: 부스럭 수풀 · 다람쥐
  s.woods.t += dt;
  s.woods.cool = Math.max(0, s.woods.cool - dt);
  stepRustles(s, dt, at, rng);
  stepSquirrel(s, dt, at, rng);

  // 노 젓기: 저을 때마다 물소리
  if (s.mode === 'boat' && s.moving) {
    s.strokeT += dt;
    if (s.strokeT >= M.boat.stroke) {
      s.strokeT = 0;
      s.events.push({ type: 'stroke', x: s.x, y: s.y });
    }
  }

  // 워프는 뭍에서만
  s.warp = s.mode === 'walk' || s.mode === 'axe' ? warpAt(s.x, s.y) : null;
  if (!s.warp) {
    s.armed = true;
    s.dwell = 0;
    return null;
  }
  if (!s.armed) return null;
  s.dwell += dt;
  return s.dwell >= s.warp.dwell ? s.warp : null;
}

/** 던전 to 에서 나왔을 때 필드에 서는 곳 */
export function backFrom(to: string): number[] {
  return data.warps.find((w) => w.to === to)?.back ?? data.start;
}
