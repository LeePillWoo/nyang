// 미니게임(미로 · 샌드보드) 공용 HUD — 왼쪽 위 알약, 오른쪽 위 돌아가기, 끝난 뒤 결과 카드. 좌표는 CSS px (HUD 배율·노치 반영).
import { fitText, safe, ui } from './touch.ts';

export type MiniButton = 'leave' | 'again' | null;
type R = { x: number; y: number; w: number; h: number };
const inR = (r: R, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function miniLayout(w: number, h: number) {
  const k = ui(w, h);
  const s = safe();
  const leave: R = { x: w - s.r - (14 + 150) * k, y: s.t + 14 * k, w: 150 * k, h: 40 * k };
  const cw = Math.min(380 * k, w - 32);
  const ch = 280 * k;
  const card: R = { x: w / 2 - cw / 2, y: h / 2 - ch / 2, w: cw, h: ch };
  const again: R = { x: card.x + 20 * k, y: card.y + ch - 66 * k, w: cw / 2 - 30 * k, h: 48 * k };
  const back: R = { x: card.x + cw / 2 + 10 * k, y: again.y, w: cw / 2 - 30 * k, h: 48 * k };
  /** 다시 버튼이 없는 카드의 가운데 버튼 */
  const solo: R = { x: card.x + cw / 2 - (cw / 2 - 30 * k) / 2, y: again.y, w: cw / 2 - 30 * k, h: 48 * k };
  return { k, s, leave, card, again, back, solo };
}

/** 누른 곳 — 돌아가기 · (끝났으면) 다시 · 카드의 돌아가기. solo = 다시 버튼이 없는 카드 */
export function miniButtonAt(w: number, h: number, x: number, y: number, done: boolean, solo = false): MiniButton {
  const L = miniLayout(w, h);
  if (inR(L.leave, x, y)) return 'leave';
  if (done && solo) return inR(L.solo, x, y) ? 'leave' : null;
  if (done) {
    if (inR(L.again, x, y)) return 'again';
    if (inR(L.back, x, y)) return 'leave';
  }
  return null;
}

/** 왼쪽 위 알약 (여러 줄이면 아래로 쌓는다) */
export function drawPill(ctx: CanvasRenderingContext2D, L: ReturnType<typeof miniLayout>, lines: string[]) {
  const k = L.k;
  ctx.font = `bold ${15 * k}px system-ui, sans-serif`;
  const w = Math.max(...lines.map((t) => ctx.measureText(t).width)) + 28 * k;
  const h = (14 + 22 * lines.length) * k;
  ctx.fillStyle = 'rgba(255,250,240,0.88)';
  ctx.beginPath();
  ctx.roundRect(L.s.l + 14 * k, L.s.t + 14 * k, w, h, 16 * k);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.textAlign = 'left';
  lines.forEach((t, i) => ctx.fillText(t, L.s.l + 28 * k, L.s.t + (36 + 22 * i) * k));
}

function button(ctx: CanvasRenderingContext2D, r: R, text: string, on: boolean, main: boolean, k: number) {
  ctx.fillStyle = main ? (on ? '#f08a3c' : '#f5a05a') : on ? '#ffffff' : 'rgba(255,250,240,0.92)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fill();
  if (!main) {
    ctx.strokeStyle = 'rgba(120,85,55,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = main ? '#fff' : '#5b4a3f';
  ctx.textAlign = 'center';
  fitText(ctx, text, r.x + r.w / 2, r.y + r.h / 2 + 6 * k, r.w - 16 * k, 17 * k, 'bold ');
}

export function drawLeave(ctx: CanvasRenderingContext2D, L: ReturnType<typeof miniLayout>, hover: MiniButton, touch: boolean) {
  button(ctx, L.leave, touch ? '돌아가기' : '돌아가기 (Esc)', hover === 'leave', false, L.k);
}

/** 결과 카드: 제목 · 줄들(글, 색) · 다시/돌아가기 (againLabel 이 null 이면 가운데에 backLabel 하나) */
export function drawCard(ctx: CanvasRenderingContext2D, L: ReturnType<typeof miniLayout>, title: string, lines: [string, string][], hover: MiniButton, againLabel: string | null, backLabel = '돌아가기') {
  const { card: c, k } = L;
  ctx.fillStyle = 'rgba(255,250,240,0.96)';
  ctx.strokeStyle = 'rgba(120,85,55,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(c.x, c.y, c.w, c.h, 24 * k);
  ctx.fill();
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, title, c.x + c.w / 2, c.y + 56 * k, c.w - 40 * k, 32 * k, 'bold ');
  lines.forEach(([t, color], i) => {
    ctx.fillStyle = color;
    fitText(ctx, t, c.x + c.w / 2, c.y + (96 + i * 28) * k, c.w - 40 * k, 19 * k, i === 0 ? 'bold ' : '');
  });
  if (againLabel === null) return button(ctx, L.solo, backLabel, hover === 'leave', true, k);
  button(ctx, L.again, againLabel, hover === 'again', true, k);
  button(ctx, L.back, backLabel, hover === 'leave', false, k);
}

/** 초 → 0:12.3 */
export const clock = (secs: number) => `${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, '0')}`;
