import { CELL, type Grid } from './collide.ts';

export const BG_W = 1672;
export const BG_H = 941;

/**
 * 배경 그림 안 바닥의 네 꼭짓점 (그림 픽셀 좌표).
 * 배경이 원근으로 렌더돼서 위아래 타일 크기가 다르다 — 단순 격자 대신 원근 변환으로 맞춘다.
 * 배경을 새로 그리면 이 네 점만 다시 찍으면 된다 (G 키 / ?grid 로 확인).
 */
export const CORNERS = {
  n: [845, 163], // 타일 (0, 0)
  e: [1592, 487], // 타일 (GRID_W, 0)
  s: [838, 936], // 타일 (GRID_W, GRID_H)
  w: [86, 505], // 타일 (0, GRID_H)
} as const;

// '.' 이동 가능  '#' 막힘(벽·소품). 바깥은 자동으로 막힌다.
const MAP = [
  '..##.....',
  '.........',
  '.........',
  '.........',
  '.........',
  '........#',
  '.........',
  '.........',
  '.......##',
];

export const GRID_W = MAP[0].length;
export const GRID_H = MAP.length;

export const grid: Grid = {
  w: GRID_W,
  h: GRID_H,
  solid: MAP.flatMap((row) => [...row].map((ch) => ch !== '.')),
};

// 단위 정사각형 → 네 꼭짓점 원근 변환 (Heckbert). 한 번만 계산한다.
const H = (() => {
  const [x0, y0] = CORNERS.n;
  const [x1, y1] = CORNERS.e;
  const [x2, y2] = CORNERS.s;
  const [x3, y3] = CORNERS.w;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dy1 * dx2;
  const a13 = (dx3 * dy2 - dy3 * dx2) / den;
  const a23 = (dx1 * dy3 - dy1 * dx3) / den;
  return {
    a11: x1 - x0 + a13 * x1,
    a21: x3 - x0 + a23 * x3,
    a31: x0,
    a12: y1 - y0 + a13 * y1,
    a22: y3 - y0 + a23 * y3,
    a32: y0,
    a13,
    a23,
  };
})();

/** 월드 좌표(m) → 배경 그림 픽셀 좌표 */
export function toScreen(wx: number, wz: number): { sx: number; sy: number } {
  const u = wx / (GRID_W * CELL);
  const v = wz / (GRID_H * CELL);
  const d = H.a13 * u + H.a23 * v + 1;
  return {
    sx: (H.a11 * u + H.a21 * v + H.a31) / d,
    sy: (H.a12 * u + H.a22 * v + H.a32) / d,
  };
}
