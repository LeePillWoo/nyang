/**
 * 바깥 필드 — 전투 없이 자유롭게 걷는 곳. 좌표는 배경 그림 픽셀 그대로 쓴다.
 * 워프(던전 입구)에 잠시 머물면 그 던전으로 간다. 입구는 src/data/field.json 의 warps 에 추가한다.
 *
 * 지형(src/assets/field-terrain.png)에 따라 움직임이 바뀐다.
 *   걷기 · 숲 = 도끼 들고 헤치며 전진 · 물 = 배 · 검정 = 못 감
 * 물은 "다음 걸음"으로 판단해서 물 위를 걷거나 땅 위에서 노 젓는 순간이 없다.
 * 숲은 잠깐 스친 걸로는 바뀌지 않는다 (경계에서 모션이 깜빡이지 않게).
 *
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크할 수 있다 (그리기는 field-draw.ts).
 */
import data from './data/field.json' with { type: 'json' };

export const FIELD = data;
export type Warp = (typeof data.warps)[number];

export const WALK = 0;
export const FOREST = 1;
export const WATER = 2;
export const BLOCK = 3;
export type Terrain = typeof WALK | typeof FOREST | typeof WATER | typeof BLOCK;
export type TerrainAt = (x: number, y: number) => Terrain;
const everywhereWalk: TerrainAt = () => WALK;

/** walk 걷기 · axe 숲 · boat 배 · board 배에 오르는 중 · unboard 배에서 내리는 중 */
export type Mode = 'walk' | 'axe' | 'boat' | 'board' | 'unboard';

/** 연출용 사건. 한 프레임 동안만 남는다 (소리·파티클이 가져간다) */
export type FieldEvent =
  | { type: 'chop'; x: number; y: number; flip: number }
  | { type: 'splash'; x: number; y: number }
  | { type: 'ripple'; x: number; y: number }
  | { type: 'stroke'; x: number; y: number };

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
};

/** 바닥에 눕힌 타원 안인가 (필드는 비스듬히 내려다본 그림이라 세로가 눌려 있다) */
export const inWarp = (w: Warp, x: number, y: number) =>
  ((x - w.at[0]) / w.r) ** 2 + ((y - w.at[1]) / (w.r * data.vertical)) ** 2 <= 1;

const warpAt = (x: number, y: number) => data.warps.find((w) => inWarp(w, x, y)) ?? null;
const clampX = (x: number) => Math.min(data.size[0] - EDGE, Math.max(EDGE, x));
const clampY = (y: number) => Math.min(data.size[1] - EDGE, Math.max(EDGE, y));

export function makeFieldState([x, y]: number[], terrainAt: TerrainAt = everywhereWalk): FieldState {
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

/** 한 프레임 진행. 워프에 충분히 머물렀으면 그 워프를 돌려준다. mx, my 는 화면 기준 -1..1 */
export function updateField(
  s: FieldState,
  mx: number,
  my: number,
  dt: number,
  at: TerrainAt = everywhereWalk,
): Warp | null {
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

  const len = Math.hypot(mx, my);
  const ux = len ? mx / len : 0;
  const uy = len ? my / len : 0;
  s.moving = len > 0;
  if (mx !== 0) s.flip = Math.sign(mx);

  const M = FIELD.modes;
  let speed = FIELD.speed * M[s.mode === 'boat' ? 'boat' : s.mode === 'axe' ? 'axe' : 'walk'].speed;
  if (s.mode === 'axe' && s.chopping > 0) speed = FIELD.speed * M.axe.chopSpeed;

  if (s.moving) {
    const nx = clampX(s.x + ux * speed * dt);
    const ny = clampY(s.y + uy * speed * FIELD.vertical * dt);
    const next = at(nx, ny);
    const afloat = s.mode === 'boat';
    // 배는 크니 뱃머리가 먼저 뭍에 닿는다
    const reach = M.boat.bow * FIELD.catBody;
    const bow = at(clampX(nx + ux * reach), clampY(ny + uy * reach * FIELD.vertical));
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
      // 막힌 곳: 한 축으로라도 미끄러져 본다
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
        s.events.push({ type: 'chop', x: s.x + s.flip * b * 0.26, y: s.y - b * 0.18, flip: s.flip });
      }
    } else if (s.moving) {
      s.chopT += dt;
      if (s.chopT >= M.axe.chopEvery) {
        s.chopT = 0;
        s.chopping = M.axe.chopTime;
      }
    } else s.chopT = 0;
  }

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
