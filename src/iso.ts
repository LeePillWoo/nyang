import { CELL, type Grid } from './collide.ts';
import rooms from './data/rooms.json' with { type: 'json' };

/**
 * 던전 방 (src/data/rooms.json). 방마다 렌더된 배경 그림 1장 + 그 안 바닥의 네 꼭짓점 + 충돌 맵.
 * 배경이 원근으로 렌더돼서 위아래 타일 크기가 다르다 — 단순 격자 대신 원근 변환으로 맞춘다.
 * 배경을 새로 그리면 네 점만 다시 찍으면 된다 (G 키 / ?grid 로 확인).
 * n = 타일 (0, 0), e = (GRID_W, 0), s = (GRID_W, GRID_H), w = (0, GRID_H)
 *
 * 맵 글자: '.' 바닥  '#' 막힘(벽·소품)  'E' 나가는 곳(밟을 수 있다). 바깥은 자동으로 막힌다.
 */
export type RoomDef = {
  name: string;
  /** 배경 그림 (src/assets/ 기준, 확장자 없이) */
  image: string;
  size: number[];
  corners: { n: number[]; e: number[]; s: number[]; w: number[] };
  map: string[];
  /** [몬스터 id, 타일 x, 타일 z] */
  spawns: (string | number)[][];
  /** 몬스터가 쓰러질 때 이펙트 (fx.ts 의 FX) — 없으면 기본 폭발 */
  popFx?: string;
  /** 들어갈 때 고양이 감정 (emotions.json) */
  mood?: string;
};
export const ROOMS = rooms as Record<string, RoomDef>;

export type Room = {
  id: string;
  def: RoomDef;
  W: number;
  H: number;
  gridW: number;
  gridH: number;
  grid: Grid;
  /** 밟으면 필드로 나가는 타일 */
  exits: [number, number][];
  /** 월드 좌표(m) → 배경 그림 픽셀 좌표 */
  toScreen(wx: number, wz: number): { sx: number; sy: number };
};

const cache = new Map<string, Room>();

export function room(id: string): Room {
  const hit = cache.get(id);
  if (hit) return hit;
  const def = ROOMS[id];
  if (!def) throw new Error('방 없음: ' + id);
  const MAP = def.map;
  const gridW = MAP[0].length;
  const gridH = MAP.length;
  // 단위 정사각형 → 네 꼭짓점 원근 변환 (Heckbert). 방마다 한 번만 계산한다.
  const [x0, y0] = def.corners.n;
  const [x1, y1] = def.corners.e;
  const [x2, y2] = def.corners.s;
  const [x3, y3] = def.corners.w;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const dy3 = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dy1 * dx2;
  const a13 = (dx3 * dy2 - dy3 * dx2) / den;
  const a23 = (dx1 * dy3 - dy1 * dx3) / den;
  const a11 = x1 - x0 + a13 * x1;
  const a21 = x3 - x0 + a23 * x3;
  const a12 = y1 - y0 + a13 * y1;
  const a22 = y3 - y0 + a23 * y3;
  const r: Room = {
    id,
    def,
    W: def.size[0],
    H: def.size[1],
    gridW,
    gridH,
    grid: { w: gridW, h: gridH, solid: MAP.flatMap((row) => [...row].map((ch) => ch === '#')) },
    exits: MAP.flatMap((row, z) => [...row].flatMap((ch, x): [number, number][] => (ch === 'E' ? [[x, z]] : []))),
    toScreen(wx, wz) {
      const u = wx / (gridW * CELL);
      const v = wz / (gridH * CELL);
      const d = a13 * u + a23 * v + 1;
      return { sx: (a11 * u + a21 * v + x0) / d, sy: (a12 * u + a22 * v + y0) / d };
    },
  };
  cache.set(id, r);
  return r;
}
