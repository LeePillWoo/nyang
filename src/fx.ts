import fxUrl from './assets/fx-hit.png';

// 2048x768, 256px 3행 8열. 이펙트는 위치가 정확할 필요가 없어 균등 격자로 자른다.
const SIZE = 256;
const COLS = 8;

/** 0 반짝 · 1 베기 · 2 큰 폭발 */
export const FX_ROW = { spark: 0, slash: 1, burst: 2 };
export const FX_LIFE = 0.27; // 8프레임 30fps

export type Fx = { x: number; z: number; row: number; t: number; size: number; rot: number };

export const fxImage = new Image();
export const fxReady = new Promise<void>((ok) => {
  fxImage.onload = () => ok();
});
fxImage.src = fxUrl;

export function drawFx(
  ctx: CanvasRenderingContext2D,
  f: Fx,
  sx: number,
  sy: number,
) {
  const col = Math.min(COLS - 1, Math.floor((f.t / FX_LIFE) * COLS));
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(f.rot);
  ctx.drawImage(fxImage, col * SIZE, f.row * SIZE, SIZE, SIZE, -f.size / 2, -f.size / 2, f.size, f.size);
  ctx.restore();
}
