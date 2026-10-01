// 이펙트 시트 — 셋 다 2048x768, 256px 3행 8열. 이펙트는 위치가 정확할 필요가 없어 균등 격자로 자른다.
// 그림은 불러오지 않는다 (던전 로직이 node 에서도 이 상수를 쓴다). 시트 이미지는 그리는 쪽이 넘긴다.
const SIZE = 256;
const COLS = 8;

/** 이펙트 시트 (src/assets/ 기준) */
export const FX_SHEETS = {
  hit: 'effects/hit_effects_v1',
  biome: 'effects/biome_impacts_v1',
  events: 'effects/dungeon_events_v1',
};
export type FxSheet = keyof typeof FX_SHEETS;

/** 이펙트 이름 → [시트, 행]. rooms.json 의 popFx 도 이 이름을 쓴다 */
export const FX = {
  spark: ['hit', 0],
  slash: ['hit', 1],
  burst: ['hit', 2],
  ice_impact: ['biome', 0],
  sand_puff: ['biome', 1],
  crystal_impact: ['biome', 2],
  gift_confetti: ['events', 0],
  pirate_smoke: ['events', 1],
  portal_activation: ['events', 2],
} satisfies Record<string, [FxSheet, number]>;
export type FxId = keyof typeof FX;
export const FX_LIFE = 0.27; // 8프레임 30fps

export type Fx = { x: number; z: number; id: FxId; t: number; size: number; rot: number };

export function drawFx(ctx: CanvasRenderingContext2D, sheets: Record<FxSheet, CanvasImageSource>, f: Fx, sx: number, sy: number) {
  const [sheet, row] = FX[f.id];
  const col = Math.min(COLS - 1, Math.floor((f.t / FX_LIFE) * COLS));
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(f.rot);
  ctx.drawImage(sheets[sheet], col * SIZE, row * SIZE, SIZE, SIZE, -f.size / 2, -f.size / 2, f.size, f.size);
  ctx.restore();
}

