import fieldUrl from './assets/field.webp';
import { CAT_FPS, CAT_ROW } from './cat.ts';
import { FIELD, type FieldState, type Warp } from './field.ts';
import { drawFrame, type Sheet } from './sheet.ts';

export const fieldImage = new Image();
export const fieldReady = new Promise<void>((ok) => {
  fieldImage.onload = () => ok();
});
fieldImage.src = fieldUrl;

const [W, H] = FIELD.size;

/**
 * 필드 한 장면. 필드 그림은 넓어서 확대해 고양이를 따라가고, 그림 바깥은 보이지 않게 카메라를 가둔다.
 * cw, ch 는 캔버스 실제 픽셀.
 */
export function drawField(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: FieldState, cat: Sheet, t: number) {
  const sc = Math.max(cw / W, ch / H) * FIELD.zoom;
  const vw = cw / sc;
  const vh = ch / sc;
  const cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, s.camX));
  const cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, s.camY));
  ctx.setTransform(sc, 0, 0, sc, cw / 2 - cx * sc, ch / 2 - cy * sc);
  ctx.drawImage(fieldImage, 0, 0, W, H);

  for (const w of FIELD.warps) drawWarp(ctx, w, t, w === s.warp && s.armed ? s.dwell / w.dwell : 0);

  const size = FIELD.catSize;
  const r = size * 0.28;
  ctx.fillStyle = 'rgba(70, 60, 40, 0.28)';
  ctx.beginPath();
  ctx.ellipse(s.x, s.y, r, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
  const row = s.moving ? CAT_ROW.run : CAT_ROW.idle;
  const col = Math.floor(s.animT * (s.moving ? CAT_FPS.run : CAT_FPS.idle)) % 6;
  drawFrame(ctx, cat, row, col, s.x, s.y, size, s.flip);
}

/**
 * 워프 임시 그래픽 — 바닥에 숨 쉬는 빛 원 + 빛 기둥 + 이름표.
 * 머무는 동안 바깥 링이 채워진다. 스프라이트 시트가 오면 이 함수만 바꾸면 된다.
 */
function drawWarp(ctx: CanvasRenderingContext2D, w: Warp, t: number, progress: number) {
  const [x, y] = w.at;
  const rx = w.r;
  const ry = w.r * FIELD.vertical;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const ring = (k: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2);
  };

  ctx.save();
  const beam = ctx.createLinearGradient(x, y, x, y - 46);
  beam.addColorStop(0, `rgba(190, 240, 255, ${0.35 + 0.2 * pulse})`);
  beam.addColorStop(1, 'rgba(190, 240, 255, 0)');
  ctx.fillStyle = beam;
  ctx.fillRect(x - rx * 0.8, y - 46, rx * 1.6, 46);

  ctx.fillStyle = `rgba(160, 230, 255, ${0.3 + 0.15 * pulse})`;
  ring(1);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(110, 200, 255, 0.9)';
  ring(0.55 + 0.15 * pulse);
  ctx.stroke();

  if (progress > 0) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff3a8';
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 1.2, ry * 1.2, 0, -Math.PI / 2, -Math.PI / 2 + Math.min(1, progress) * Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(60, 45, 35, 0.8)';
  ctx.strokeText(w.label, x, y - 50);
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(w.label, x, y - 50);
  ctx.restore();
}
