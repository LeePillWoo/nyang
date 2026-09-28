/**
 * 바깥 필드 — 전투 없이 자유롭게 걷는 곳. 좌표는 배경 그림 픽셀 그대로 쓴다.
 * 워프(던전 입구)에 잠시 머물면 그 던전으로 간다. 입구는 src/data/field.json 의 warps 에 추가한다.
 *
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크할 수 있다 (그리기는 field-draw.ts).
 */
import data from './data/field.json' with { type: 'json' };

export const FIELD = data;
export type Warp = (typeof data.warps)[number];

const EDGE = 24; // 그림 가장자리 여백
const CAM_EASE = 8; // 카메라가 따라오는 속도

export type FieldState = {
  x: number;
  y: number;
  flip: number;
  moving: boolean;
  animT: number;
  camX: number;
  camY: number;
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

export function makeFieldState([x, y]: number[]): FieldState {
  return { x, y, flip: 1, moving: false, animT: 0, camX: x, camY: y, warp: null, dwell: 0, armed: !warpAt(x, y) };
}

/** 한 프레임 진행. 워프에 충분히 머물렀으면 그 워프를 돌려준다. mx, my 는 화면 기준 -1..1 */
export function updateField(s: FieldState, mx: number, my: number, dt: number): Warp | null {
  const len = Math.hypot(mx, my);
  s.moving = len > 0;
  s.animT += dt;
  if (len > 0) {
    s.x += (mx / len) * data.speed * dt;
    s.y += (my / len) * data.speed * data.vertical * dt;
    if (mx !== 0) s.flip = Math.sign(mx);
  }
  s.x = Math.min(data.size[0] - EDGE, Math.max(EDGE, s.x));
  s.y = Math.min(data.size[1] - EDGE, Math.max(EDGE, s.y));

  const k = 1 - Math.exp(-CAM_EASE * dt);
  s.camX += (s.x - s.camX) * k;
  s.camY += (s.y - s.camY) * k;

  s.warp = warpAt(s.x, s.y);
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
