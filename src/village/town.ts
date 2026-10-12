/**
 * 마을 걷기 엔진 — 고양이마을(village.ts) · 강아지마을(dogtown.ts)이 같이 쓴다 (2026-10-12 강아지마을을 만들며 고양이마을에서 떼어 냄).
 * 좌표는 마을 그림 px. 걷는 땅 = walk 다각형 − blocks(rect · ellipse). 고양이 키 C = catBody × unit, 세로는 field.vertical 만큼 눌려 보인다.
 * 걷기는 WASD · 조이스틱으로만 — 막히면 ±30° · 60° · 90° 로 비켜 간다. node 로 체크된다.
 */
import field from '../data/field.json' with { type: 'json' };

export type Block = { type: 'ellipse'; x: number; y: number; rx: number; ry: number } | { type: 'rect'; x0: number; y0: number; x1: number; y1: number };
/** 마을 한 곳의 땅 — size 그림 크기 · unit 고양이 키 한 칸이 그림 px 로 몇 · walk 걷는 땅 둘레 · blocks 막힌 곳 · start 도착 자리 · reach 말 거는 거리(고양이 키 배) */
export type TownDef = { size: number[]; unit: number; walk: number[][]; blocks: (Block & { name: string })[]; start: number[]; reach: number };
export type TownCat = { x: number; y: number; flip: number; moving: boolean; animT: number };

export const V = field.vertical;
/** 고양이 키 (마을 그림 px) — 거리 · 말 거는 거리 · 치즈 크기가 이 배수 */
export const townC = (d: TownDef) => field.catBody * d.unit;
/** 마을에서 걷는 빠르기 (px/초) — 필드와 같은 몸 길이/초 */
export const townWalk = (d: TownDef) => field.speed * d.unit * 0.9;

/** 다각형 안인가 (짝홀) */
function inPoly(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const blocked = (x: number, y: number, b: Block) => (b.type === 'rect' ? x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 : ((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 <= 1);
/** 걸을 수 있는 곳: 마을 안이고 막힌 곳(집 · 분수 · 텃밭 …)이 아닌 곳 */
export const walkableIn = (d: TownDef, x: number, y: number) => inPoly(x, y, d.walk) && !d.blocks.some((b) => blocked(x, y, b));
export const makeTownCat = (d: TownDef): TownCat => ({ x: d.start[0], y: d.start[1], flip: 1, moving: false, animT: 0 });
/** 걸어서 (ux, uy) 쪽으로 한 걸음 — 막히면 ±30° · 60° · 90° 로 비켜 간다. 움직였으면 true */
export function stepCat(d: TownDef, c: TownCat, ux: number, uy: number, dt: number) {
  const step = townWalk(d) * dt;
  const base = Math.atan2(uy, ux);
  for (const k of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const a = base + k;
    const nx = c.x + Math.cos(a) * step;
    const ny = c.y + Math.sin(a) * step * V;
    if (!walkableIn(d, nx, ny)) continue;
    [c.x, c.y] = [nx, ny];
    if (Math.abs(Math.cos(a)) > 0.2) c.flip = Math.sign(Math.cos(a));
    return true;
  }
  return false;
}
/** 고양이에게서 (x, y) 까지 (고양이 키 배, 세로는 펴서) */
export const gapTo = (d: TownDef, c: TownCat, x: number, y: number) => Math.hypot(x - c.x, (y - c.y) / V) / townC(d);
/** 한 프레임 걷기 (mx, my = 화면 기준 -1..1). 움직였으면 true */
export function walkCat(d: TownDef, c: TownCat, mx: number, my: number, dt: number) {
  c.animT += dt;
  const len = Math.hypot(mx, my);
  c.moving = len > 0 && stepCat(d, c, mx / len, my / len, dt);
  return c.moving;
}
