// 마을 그리기 공용 — 고양이마을(village-draw) · 강아지마을(dogtown-draw)이 같이 쓴다 (2026-10-12 고양이마을에서 떼어 냄):
// 카메라(필드처럼 고양이를 따라가고 그림 밖은 안 보이게) · 배경 · G 디버그 · 치즈 · 주민 시트 한 컷 · 말풍선 · 간판 · 창 틀(디자인 좌표 1000×560 · 540×1040).
import { CAT_FPS, CAT_ROW } from '../shared/cat.ts';
import { drawCatFrame } from '../shared/cosmetics-draw.ts';
import { type Sheet } from '../shared/sheet.ts';
import { safe, wrapText } from '../shared/touch.ts';
import { blockShape, townC, type TownCat, type TownDef } from './town.ts';

export type R = { x: number; y: number; w: number; h: number };
export const inR = (r: R, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
/** 화면에 보이는 곳 (지도 px) */
export type View = { x0: number; y0: number; x1: number; y1: number };
/** 가운데 x, 반폭 half 인 것을 화면 안으로 (가장자리 pad) */
export const fitX = (vw: View, x: number, half: number, pad: number) => Math.max(vw.x0 + half + pad, Math.min(vw.x1 - half - pad, x));

/** 주민 시트 한 장 (village-cats.json · village-dogs.json 의 한 마리) — 동작마다 컷 [sx, sy, sw, sh, 발 px, 발 py] */
export type Atlas = { name: string; file: string; anims: Record<string, { fps: number; loop: boolean; f: number[][] }> };
/** 시트 컷 하나를 발밑 (x, y) 에 배율 k 로 (flip 1 = 시트 그대로 오른쪽) */
export function drawCut(ctx: CanvasRenderingContext2D, im: HTMLImageElement, cut: number[], x: number, y: number, k: number, flip: number) {
  if (!im.complete || !im.naturalWidth) return;
  const [sx, sy, sw, sh, px, py] = cut;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip, 1);
  ctx.drawImage(im, sx, sy, sw, sh, -px * k, -py * k, sw * k, sh * k);
  ctx.restore();
}

/** 치즈 (발밑 x, y · 키 k px) — 필드 고양이 시트. 돌려주는 것: 정수리 높이 */
export function drawTownCat(ctx: CanvasRenderingContext2D, sh: Sheet, x: number, y: number, k: number, flip: number, moving: boolean, animT: number) {
  const row = moving ? CAT_ROW.run : CAT_ROW.idle;
  const col = Math.floor(animT * (moving ? CAT_FPS.run : CAT_FPS.idle)) % 6;
  const size = (k * sh.base) / sh.bodyH;
  ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, k * 0.34, k * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  drawCatFrame(ctx, sh, row, col, x, y, size, flip);
  const f = sh.frames[row]?.[col];
  const s = (size / sh.base) * (sh.rowScale[row] ?? 1);
  return f ? y + f.oy * s : y - k;
}

/** 말풍선 — 머리 위(꼬리 끝 x, y)에. 화면 위로 넘치면 발밑(꼬리 끝 x, y2)에, 옆으로 넘치면 화면 안으로 당긴다 */
export function bubble(ctx: CanvasRenderingContext2D, vw: View, x: number, y: number, y2: number, text: string, maxW: number, px: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.font = `bold ${px}px system-ui, sans-serif`;
  const lines = wrapText(ctx, text, maxW);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + px * 1.2;
  const h = lines.length * px * 1.3 + px * 0.8;
  const cx = fitX(vw, x, w / 2, px * 0.3);
  const up = y - px * 0.6 - h >= vw.y0 + px * 0.3;
  const by = up ? y - px * 0.6 - h : y2 + px * 0.6;
  const tx = Math.max(cx - w / 2 + px, Math.min(cx + w / 2 - px, x));
  const [tip, base] = up ? [y, by + h] : [y2, by];
  ctx.fillStyle = 'rgba(255, 252, 244, 0.97)';
  ctx.strokeStyle = 'rgba(120, 85, 55, 0.5)';
  ctx.lineWidth = Math.max(1, px * 0.1);
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, by, w, h, px * 0.6);
  ctx.moveTo(tx - px * 0.4, base);
  ctx.lineTo(tx, tip);
  ctx.lineTo(tx + px * 0.4, base);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5b4a3f';
  ctx.textAlign = 'center';
  lines.forEach((l, i) => ctx.fillText(l, cx, by + px * 1.25 + i * px * 1.3));
  ctx.restore();
}

/** 카메라 상태 (부드럽게 따라간다) · 캔버스 변환 (검증용 — 마을 좌표 ↔ 화면) */
export type TownView = { cam: { x: number; y: number } | null; sc: number; ox: number; oy: number };
/**
 * 마을 장면 바닥: 화면에서 고양이 키 = catCss × 화면 배율(0.95, 짧은 변 < 500 은 1.15, 큰 화면은 그림이 들어가는 만큼 · 최대 1.4) CSS px, 그림 1px = 그 ÷ C
 * (2026-10-08 밤 사용자 — "마을이 꽉 차 보이게 그림을 확대해서 크롭, 캐릭터는 지금 크기"). 카메라는 필드처럼 고양이(몸 가운데)를 따라가고(CAM_EASE 8) 그림 밖은 안 보이게 붙는다.
 * 배경 · G 디버그(걷는 땅 파랑 · 막힌 곳 빨강)까지 그리고, 마을 좌표로 그리게 변환을 걸어 둔다. 돌려주는 것: 화면에 보이는 곳 seen · 가장자리 pad · CSS 배율 sc
 */
export function drawTownGround(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  d: TownDef & { catCss: number },
  bg: HTMLImageElement,
  cat: TownCat,
  view: TownView,
  dt: number,
  debug = false,
) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cw / dpr;
  const h = ch / dpr;
  const [W, H] = d.size;
  const C = townC(d);
  const catCss = d.catCss * Math.min(1.4, Math.max(Math.min(w, h) < 500 ? 1.15 : 0.95, Math.min(w / W, h / H)));
  const sc = catCss / C;
  const vw = w / sc;
  const vh = h / sc;
  const cam = (view.cam ??= { x: cat.x, y: cat.y - C * 0.5 });
  const k = 1 - Math.exp(-8 * dt);
  cam.x += (cat.x - cam.x) * k;
  cam.y += (cat.y - C * 0.5 - cam.y) * k;
  const cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, cam.x));
  const cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, cam.y));
  const ox = w / 2 - cx * sc;
  const oy = h / 2 - cy * sc;
  Object.assign(view, { sc: sc * dpr, ox: ox * dpr, oy: oy * dpr });
  const seen: View = { x0: -ox / sc, y0: -oy / sc, x1: (w - ox) / sc, y1: (h - oy) / sc };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#9fcf7a';
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(sc * dpr, 0, 0, sc * dpr, ox * dpr, oy * dpr);
  ctx.imageSmoothingQuality = 'high';
  if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, 0, 0, W, H);
  if (debug) {
    ctx.strokeStyle = 'rgba(0,160,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    d.walk.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,40,40,0.9)';
    for (const raw of d.blocks) {
      const b = blockShape(raw);
      ctx.beginPath();
      if (b.type === 'rect') ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      else ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  return { seen, pad: 4 / sc, sc, dpr, w, h };
}

/** 간판 이름표 (마을 좌표 x, y 가운데 · 화면 밖으로 안 잘리게) — 요리 가판대 · 강아지마을 시설 */
export function signLabel(ctx: CanvasRenderingContext2D, seen: View, pad: number, x: number, y: number, C: number, label: string, t: number, color = '#c0582c') {
  const glow = 0.6 + 0.4 * Math.sin(t * 3);
  ctx.font = `bold ${C * 0.42}px system-ui, sans-serif`;
  const lw = ctx.measureText(label).width + C * 0.5;
  const lx = fitX(seen, x, lw / 2, pad);
  ctx.fillStyle = `rgba(255, 246, 220, ${0.85 + 0.1 * glow})`;
  ctx.beginPath();
  ctx.roundRect(lx - lw / 2, y - C * 0.36, lw, C * 0.68, C * 0.34);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(label, lx, y + C * 0.14);
}

// ── 창 틀 ── 가방처럼 디자인 좌표 (가로 1000×560 · 세로 540×1040) 로 그리고 화면에 맞춰 줄인다
export function panelLayout(w: number, h: number) {
  const wide = w >= h;
  const DW = wide ? 1000 : 540;
  const DH = wide ? 560 : 1040;
  const sf = safe();
  const aw = w - sf.l - sf.r;
  const ah = h - sf.t - sf.b;
  const k = Math.min(1.25, (aw - 24) / DW, (ah - 24) / DH);
  return { wide, DW, DH, k, ox: sf.l + (aw - DW * k) / 2, oy: sf.t + (ah - DH * k) / 2, close: { x: DW - 84, y: 8, w: 76, h: 76 } as R };
}
export type PL = ReturnType<typeof panelLayout>;
/** 가운데 카드 (요리 · 선물 · 놀이 · 망치질 · 구조) 와 확인 버튼 · 막대 자리 */
export function cardLayout(L: PL) {
  const w = L.wide ? 640 : 500;
  const h = L.wide ? 500 : 760;
  const card: R = { x: (L.DW - w) / 2, y: (L.DH - h) / 2, w, h };
  const ok: R = { x: card.x + w / 2 - 130, y: card.y + h - 76, w: 260, h: 58 };
  const bar: R = { x: card.x + 50, y: card.y + h - (L.wide ? 170 : 250), w: w - 100, h: 40 };
  return { card, ok, bar };
}
/** 창 바탕 (둥근 크림색 판) */
export function sheetBg(ctx: CanvasRenderingContext2D, L: PL) {
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(0, 0, L.DW, L.DH, 28);
  ctx.fill();
}
/** 창 오른쪽 위 ✕ */
export function closeX(ctx: CanvasRenderingContext2D, L: PL) {
  const c = L.close;
  ctx.fillStyle = 'rgba(120,85,55,0.14)';
  ctx.beginPath();
  ctx.arc(c.x + c.w / 2, c.y + c.h / 2, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✕', c.x + c.w / 2, c.y + c.h / 2 + 11);
}
/** 하트 줄 ♥♥♡♡♡ */
export const heartText = (n: number) => '♥'.repeat(n) + '♡'.repeat(5 - n);
