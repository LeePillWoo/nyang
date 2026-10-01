// 필드 미니맵 — 화면 오른쪽 위. 이정표(포탈) 34곳을 점으로 찍고, 점을 누르면 그 이정표로 워프한다.
// 배경은 조각 36장을 1/8 로 줄인 한 장 (src/assets/world/minimap.webp, tools/assets.mjs 가 만든다).
// 좌표는 CSS 픽셀 (캔버스 실제 픽셀이 아니라) — 마우스 좌표와 바로 맞댄다.
import { image } from './assets.ts';
import { FIELD, type FieldState, type Warp } from './field.ts';

const MAP = image('world/minimap');
const [W, H] = FIELD.size;
const MARGIN = 14;
/** 점을 누를 수 있는 거리 (CSS px) */
const PICK = 9;

export type Rect = { x: number; y: number; w: number; h: number };

/** cssW = 화면 폭 (CSS px). 좁은 화면에선 폭의 30% 까지만 */
export function minimapRect(cssW: number): Rect {
  const w = Math.round(Math.min(260, cssW * 0.3));
  return { x: cssW - w - MARGIN, y: MARGIN, w, h: Math.round((w * H) / W) };
}

/** 월드 좌표 → 미니맵 위 CSS 좌표 */
export const toMini = (r: Rect, x: number, y: number) => [r.x + (x / W) * r.w, r.y + (y / H) * r.h];

export const inMinimap = (r: Rect, px: number, py: number) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;

/** 가장 가까운 이정표 (누를 수 있는 거리 안) */
export function minimapPick(r: Rect, px: number, py: number): Warp | null {
  let best: Warp | null = null;
  let bd = PICK;
  for (const w of FIELD.warps) {
    const [mx, my] = toMini(r, w.at[0], w.at[1]);
    const d = Math.hypot(mx - px, my - py);
    if (d < bd) {
      bd = d;
      best = w;
    }
  }
  return best;
}

/**
 * ctx 는 CSS px 좌표계로 맞춘 상태로 넘긴다. view = 지금 화면에 보이는 월드 범위.
 * 연결된 포탈은 금색, 아직 연결 전은 회색. 고양이는 주황 점.
 */
export function drawMinimap(ctx: CanvasRenderingContext2D, r: Rect, s: FieldState, view: Rect, hover: Warp | null, t: number) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.beginPath();
  ctx.roundRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8, 10);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 6);
  ctx.clip();
  if (MAP.img.complete && MAP.img.naturalWidth) ctx.drawImage(MAP.img, r.x, r.y, r.w, r.h);
  else {
    ctx.fillStyle = '#9cc9dd';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  // 지금 화면
  const [vx, vy] = toMini(r, view.x, view.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 1;
  ctx.strokeRect(vx, vy, (view.w / W) * r.w, (view.h / H) * r.h);

  for (const w of FIELD.warps) {
    const [mx, my] = toMini(r, w.at[0], w.at[1]);
    const big = w === hover;
    ctx.beginPath();
    ctx.arc(mx, my, big ? 5 : w.to ? 3.2 : 2.4, 0, Math.PI * 2);
    ctx.fillStyle = w.to ? '#ffd84a' : 'rgba(225,225,225,0.9)';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(70,52,42,0.9)';
    ctx.stroke();
  }

  const [cx, cy] = toMini(r, s.x, s.y);
  ctx.beginPath();
  ctx.arc(cx, cy, 3.5 + 0.8 * Math.sin(t * 5), 0, Math.PI * 2);
  ctx.fillStyle = '#ff8a2a';
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();

  // 가리킨 이정표 이름 — 미니맵 아래에
  if (hover) {
    const label = hover.to ? hover.label : `${hover.label} (준비 중)`;
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(label).width + 16;
    const lx = Math.min(r.x + r.w - tw / 2, Math.max(r.x + tw / 2, toMini(r, hover.at[0], 0)[0]));
    ctx.fillStyle = 'rgba(70,52,42,0.88)';
    ctx.beginPath();
    ctx.roundRect(lx - tw / 2, r.y + r.h + 8, tw, 22, 11);
    ctx.fill();
    ctx.fillStyle = '#fff6d8';
    ctx.fillText(label, lx, r.y + r.h + 23);
    ctx.textAlign = 'left';
  }
}
