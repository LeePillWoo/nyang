// 고양이마을 그리기 — 필드 그림의 마을 광장(조각 r2_c2 · r3_c2)을 크게 보여 주고 고양이를 따라간다.
// 주민 친구는 고양이 시트를 털빛만 바꾸고(fur 세 색 — 밝기 따라) 꾸밈(요리사 모자 · 꽃 · 모자 · 턱받이 · 리본)을 단다.
// 이름표 · 하트 · 부탁 말풍선 · 대사 말풍선 · 말 걸 수 있으면 "E 말 걸기" · 요리 가판대 표지 · HUD.
// 창: 친구(먹여 주기 · 이야기) · 요리 가판대(요리법) · 요리(바늘 타이밍) · 하트 선물 카드. 창은 가방처럼 디자인 좌표
// (가로 1000×560 · 세로 540×1040)로 그리고 화면에 맞춰 줄인다. 로직은 village.ts.
import { image } from './assets.ts';
import { button, drawCoin, drawIcon, header, itemCell, toast, useLines } from './bag-draw.ts';
import { count, ITEMS, type Bag } from './bag.ts';
import { CAT_FPS, CAT_ROW } from './cat.ts';
import field from './data/field.json' with { type: 'json' };
import { drawEmote } from './emote.ts';
import { drawLeave, drawPill, miniLayout, type MiniButton } from './mini-draw.ts';
import { drawFrame, type Sheet } from './sheet.ts';
import { fitText, safe, wrapText } from './touch.ts';
import {
  canCook,
  digestIn,
  feed,
  feedable,
  FRIENDS,
  fullness,
  hearts,
  hello,
  knownRecipes,
  RECIPES,
  serve,
  startCook,
  stopCook,
  targetAt,
  teacher,
  VILLAGE,
  type Cook,
  type FeedResult,
  type Friend,
  type Pref,
  type Reward,
  type VillageSave,
  type VillageState,
} from './village.ts';

const C = field.catBody;
const V = field.vertical;
type R = { x: number; y: number; w: number; h: number };
const inR = (r: R, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ── 배경: 필드 그림 조각 두 장 (마을 광장) ──
const TILES: [string, number, number][] = [
  ['world/tiles/tile_r2_c2', 1672, 941],
  ['world/tiles/tile_r3_c2', 1672, 1411],
];
export const villageReady = Promise.all(TILES.map(([p]) => image(p).ready));

// ── 주민 털빛: 고양이 시트의 밝기를 세 색(어두운 · 가운데 · 밝은)으로 다시 칠한다. 분홍(코 · 귀 · 발바닥)은 그대로 ──
const furSheets = new Map<string, Sheet>();
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export function friendSheet(cat: Sheet, f: Friend): Sheet {
  let sh = furSheets.get(f.id);
  if (sh) return sh;
  const src = cat.img as HTMLImageElement | HTMLCanvasElement;
  const w = src instanceof HTMLImageElement ? src.naturalWidth : src.width;
  const h = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(src, 0, 0);
  const im = g.getImageData(0, 0, w, h);
  const d = im.data;
  const [dk, md, lt] = f.fur.map(hex);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const [r, gr, b] = [d[i], d[i + 1], d[i + 2]];
    if (r > gr + 25 && b > gr - 10 && b > 120) continue; // 분홍
    const L = (0.3 * r + 0.59 * gr + 0.11 * b) / 255;
    const t = Math.max(0, Math.min(1, (L - 0.1) / 0.82));
    const [p, q, k] = t < 0.62 ? [dk, md, t / 0.62] : [md, lt, (t - 0.62) / 0.38];
    d[i] = p[0] + (q[0] - p[0]) * k;
    d[i + 1] = p[1] + (q[1] - p[1]) * k;
    d[i + 2] = p[2] + (q[2] - p[2]) * k;
  }
  g.putImageData(im, 0, 0);
  sh = { ...cat, img: c };
  furSheets.set(f.id, sh);
  return sh;
}

/** 꾸밈 — (hx, top) = 머리 가운데 · 정수리, k = 고양이 키 (px), flip = 보는 쪽 */
function deco(ctx: CanvasRenderingContext2D, kind: string, hx: number, top: number, k: number, flip: number) {
  ctx.save();
  if (kind === 'chef') {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = 'rgba(90, 80, 70, 0.6)';
    ctx.lineWidth = k * 0.03;
    ctx.beginPath();
    ctx.roundRect(hx - k * 0.2, top - k * 0.12, k * 0.4, k * 0.2, k * 0.04);
    ctx.fill();
    ctx.stroke();
    for (const [dx, r] of [[-0.14, 0.13], [0, 0.16], [0.14, 0.13]]) {
      ctx.beginPath();
      ctx.arc(hx + dx * k, top - k * 0.2, r * k, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === 'flower') {
    const [fx, fy] = [hx - flip * k * 0.2, top + k * 0.04];
    ctx.fillStyle = '#ff9ec4';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(fx + Math.cos(a) * k * 0.07, fy + Math.sin(a) * k * 0.07, k * 0.065, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#ffe27a';
    ctx.beginPath();
    ctx.arc(fx, fy, k * 0.05, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'cap') {
    ctx.fillStyle = '#3a6fb5';
    ctx.beginPath();
    ctx.ellipse(hx, top + k * 0.06, k * 0.22, k * 0.14, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#2d5a96';
    ctx.beginPath();
    ctx.ellipse(hx + flip * k * 0.2, top + k * 0.07, k * 0.14, k * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'bib') {
    ctx.fillStyle = '#ef6b5e';
    ctx.beginPath();
    ctx.moveTo(hx - k * 0.17, top + k * 0.5);
    ctx.lineTo(hx + k * 0.17, top + k * 0.5);
    ctx.lineTo(hx, top + k * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hx, top + k * 0.57, k * 0.035, 0, Math.PI * 2);
    ctx.fill();
  } else if (kind === 'ribbon') {
    const [bx, by] = [hx + flip * k * 0.16, top + k * 0.02];
    ctx.fillStyle = '#ff6fa8';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + s * k * 0.16, by - k * 0.09);
      ctx.lineTo(bx + s * k * 0.16, by + k * 0.09);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(bx, by, k * 0.05, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** 고양이 한 마리 (발밑 x, y · 키 k px) — 털빛 시트 · 꾸밈. 돌려주는 것: 정수리 높이 */
function drawCat(ctx: CanvasRenderingContext2D, sh: Sheet, x: number, y: number, k: number, flip: number, moving: boolean, animT: number, hop: number, kind = '') {
  const row = moving ? CAT_ROW.run : CAT_ROW.idle;
  const col = Math.floor(animT * (moving ? CAT_FPS.run : CAT_FPS.idle)) % 6;
  const size = (k * sh.base) / sh.bodyH;
  const z = hop > 0 ? Math.sin((hop / 0.5) * Math.PI) * k * 0.35 : 0;
  ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, k * 0.34, k * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  drawFrame(ctx, sh, row, col, x, y - z, size, flip);
  const f = sh.frames[row]?.[col];
  const s = (size / sh.base) * (sh.rowScale[row] ?? 1);
  const top = f ? y - z + f.oy * s : y - k;
  if (kind && f) deco(ctx, kind, x + flip * (f.ox + f.sw * 0.58) * s, top + k * 0.04, k, flip);
  return top;
}

/** 화면에 보이는 곳 (지도 px) */
type View = { x0: number; y0: number; x1: number; y1: number };
/** 가운데 x, 반폭 half 인 것을 화면 안으로 (가장자리 pad) */
const fitX = (vw: View, x: number, half: number, pad: number) => Math.max(vw.x0 + half + pad, Math.min(vw.x1 - half - pad, x));
/** 말풍선 — 머리 위(꼬리 끝 x, y)에. 화면 위로 넘치면 발밑(꼬리 끝 x, y2)에, 옆으로 넘치면 화면 안으로 당긴다 */
function bubble(ctx: CanvasRenderingContext2D, vw: View, x: number, y: number, y2: number, text: string, maxW: number, px: number, alpha = 1) {
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

/** 하트 줄 ♥♥♡♡♡ */
const heartText = (n: number) => '♥'.repeat(n) + '♡'.repeat(5 - n);
const PREF_MARK: Record<Pref, string> = { love: '❤', like: '👍', normal: '🙂', dislike: '💧' };

// ── 화면 상태 (창 · 고른 것 · 알림 · 선물 카드) ──
export type Panel = { kind: 'friend'; i: number } | { kind: 'kitchen' } | { kind: 'cook'; cook: Cook } | null;
export const villageView = {
  panel: null as Panel,
  /** 친구 창: 고른 먹을 것 · 대사 / 가판대: 고른 요리법 */
  pick: null as string | null,
  line: '',
  recipe: RECIPES[0].id,
  msg: '',
  msgT: 0,
  /** 하트 선물 카드 (차례로) */
  gifts: [] as { friend: Friend; r: Reward }[],
  /** 화면 카메라 (부드럽게 따라간다) · 캔버스 변환 (검증용) */
  cam: null as { x: number; y: number } | null,
  sc: 1,
  ox: 0,
  oy: 0,
};
const vsay = (msg: string) => Object.assign(villageView, { msg, msgT: 2.4 });
/** 마을에 들어올 때 */
export function resetVillageView() {
  Object.assign(villageView, { panel: null, pick: null, line: '', msg: '', msgT: 0, gifts: [], cam: null });
}

/** 장면 그리기 (창은 drawVillagePanel) */
export function drawVillage(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: VillageState, save: VillageSave, cat: Sheet, v: { t: number; dt: number; touch: boolean; hover: MiniButton }) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cw / dpr;
  const h = ch / dpr;
  const A = VILLAGE.area;
  // 광장(약 400×240)이 화면에 들어오게, 단 고양이가 너무 작지 않게(2배 아래로는 안 줄인다) — 넘치면 고양이를 따라간다
  const sc = Math.min(3.2, Math.max(Math.min(w / 400, h / 240), 2, w / (A.x1 - A.x0), h / (A.y1 - A.y0)));
  const vw = w / sc;
  const vh = h / sc;
  // 광장 가운데를 보다가 고양이가 화면 가장자리에 가까워지면 따라간다 (넓은 화면은 친구 다섯이 다 보인다)
  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
  const mx = Math.max(0, vw / 2 - C * 2.5);
  const my = Math.max(0, vh / 2 - C * 2);
  const fx = clamp(VILLAGE.walk.x, s.cat.x - mx, s.cat.x + mx);
  const fy = clamp(VILLAGE.walk.y - C * 0.7, s.cat.y - C * 0.5 - my, s.cat.y - C * 0.5 + my);
  const want = { x: clamp(fx, A.x0 + vw / 2, A.x1 - vw / 2), y: clamp(fy, A.y0 + vh / 2, A.y1 - vh / 2) };
  const cam = (villageView.cam ??= { ...want });
  const k = 1 - Math.exp(-6 * v.dt);
  cam.x += (want.x - cam.x) * k;
  cam.y += (want.y - cam.y) * k;
  const ox = w / 2 - cam.x * sc;
  const oy = h / 2 - cam.y * sc;
  Object.assign(villageView, { sc: sc * dpr, ox: ox * dpr, oy: oy * dpr });
  // 화면에 보이는 곳 (지도 px) — 이름표 · 말풍선 · 표지 · 안내가 화면 밖으로 잘리지 않게 안으로 당긴다
  const seen: View = { x0: -ox / sc, y0: -oy / sc, x1: (w - ox) / sc, y1: (h - oy) / sc };
  const pad = 4 / sc;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#9fcf7a';
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(sc * dpr, 0, 0, sc * dpr, ox * dpr, oy * dpr);
  ctx.imageSmoothingQuality = 'high';
  for (const [p, x, y] of TILES) {
    const im = image(p).img;
    if (im.complete && im.naturalWidth) ctx.drawImage(im, x, y);
  }
  // 요리 가판대 표지 — 빨간 줄무늬 차양 위에 간판처럼
  const [kx, ky] = [2126, 1508];
  const glow = 0.6 + 0.4 * Math.sin(v.t * 3);
  ctx.font = `bold ${C * 0.5}px system-ui, sans-serif`;
  const label = '🍳 요리 가판대';
  const lw = ctx.measureText(label).width + C * 0.6;
  const lx = fitX(seen, kx, lw / 2, pad);
  ctx.fillStyle = `rgba(255, 246, 220, ${0.85 + 0.1 * glow})`;
  ctx.beginPath();
  ctx.roundRect(lx - lw / 2, ky - C * 0.42, lw, C * 0.8, C * 0.4);
  ctx.fill();
  ctx.fillStyle = '#c0582c';
  ctx.textAlign = 'center';
  ctx.fillText(label, lx, ky + C * 0.17);

  // 주민 · 고양이 (아래 것을 나중에)
  type Thing = { y: number; draw: () => void };
  const things: Thing[] = s.townies.map((p, i) => ({
    y: p.y,
    draw: () => {
      if (p.x < seen.x0 - C * 0.6 || p.x > seen.x1 + C * 0.6) return; // 화면 밖 친구는 이름표도 끌어오지 않는다
      const f = FRIENDS[i];
      const top = drawCat(ctx, friendSheet(cat, f), p.x, p.y, C * 1.0, p.flip, p.moving, p.animT, p.hop, f.deco);
      const fs = save.friends[f.id];
      // 이름표 · 하트
      ctx.font = `bold ${C * 0.5}px system-ui, sans-serif`;
      const tag = `${f.name} ${heartText(hearts(fs.pts))}`;
      const tw = ctx.measureText(tag).width + C * 0.5;
      const tx = fitX(seen, p.x, tw / 2, pad);
      ctx.fillStyle = 'rgba(70, 52, 42, 0.78)';
      ctx.beginPath();
      ctx.roundRect(tx - tw / 2, top - C * 0.95, tw, C * 0.72, C * 0.36);
      ctx.fill();
      ctx.fillStyle = '#fff6d8';
      ctx.textAlign = 'center';
      ctx.fillText(tag, tx, top - C * 0.43);
      // 부탁 (먹고 싶은 요리) · 대사
      if (p.sayT > 0) bubble(ctx, seen, p.x, top - C * 1.05, p.y + C * 0.2, p.say, C * 7, C * 0.55, Math.min(1, p.sayT / 0.3));
      else if (fs.ask) {
        const bob = Math.sin(v.t * 4 + i) * C * 0.08;
        ctx.fillStyle = 'rgba(255, 252, 244, 0.97)';
        ctx.strokeStyle = '#ef6b5e';
        ctx.lineWidth = C * 0.06;
        ctx.beginPath();
        ctx.roundRect(p.x - C * 0.75, top - C * 2.05 + bob, C * 1.5, C * 0.95, C * 0.4);
        ctx.fill();
        ctx.stroke();
        drawIcon(ctx, fs.ask, p.x - C * 0.22, top - C * 1.58 + bob, C * 0.72);
        ctx.fillStyle = '#ef6b5e';
        ctx.font = `bold ${C * 0.62}px system-ui, sans-serif`;
        ctx.fillText('!', p.x + C * 0.42, top - C * 1.36 + bob);
      }
    },
  }));
  things.push({
    y: s.cat.y,
    draw: () => {
      drawCat(ctx, cat, s.cat.x, s.cat.y, C * 1.0, s.cat.flip, s.cat.moving, s.cat.animT, 0);
      drawEmote(ctx, s.cat.x, s.cat.y - C * 1.25, C * 0.8);
    },
  });
  things.sort((a, b) => a.y - b.y).forEach((o) => o.draw());
  // 저절로 걸어가는 곳 표시
  if (s.goal && !s.goal.then) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = C * 0.06;
    ctx.beginPath();
    ctx.ellipse(s.goal.x, s.goal.y, C * 0.4, C * 0.4 * V, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 말 걸 수 있는 것: E 말 걸기 · E 요리하기
  if (s.near && !villageView.panel) {
    const [nx, ny] = targetAt(s, s.near);
    const text = `${v.touch ? '눌러서' : 'E'} ${s.near.kind === 'kitchen' ? '요리하기' : '말 걸기'}`;
    ctx.font = `bold ${C * 0.55}px system-ui, sans-serif`;
    const pw = ctx.measureText(text).width + C * 0.6;
    const qx = fitX(seen, nx, pw / 2, pad);
    const py = (s.near.kind === 'kitchen' ? ny - C * 0.4 : ny + C * 0.85) + Math.sin(v.t * 5) * C * 0.05;
    ctx.fillStyle = '#f08a3c';
    ctx.beginPath();
    ctx.roundRect(qx - pw / 2, py, pw, C * 0.78, C * 0.39);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(text, qx, py + C * 0.56);
  }

  // HUD
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = miniLayout(w, h);
  const friends = FRIENDS.filter((f) => hearts(save.friends[f.id].pts) >= 1).length;
  drawPill(ctx, L, ['🏡 고양이마을', `친해진 친구 ${friends}/${FRIENDS.length} · 요리법 ${knownRecipes(save).length}/${RECIPES.length}`]);
  drawLeave(ctx, L, v.hover, v.touch);
}

// ── 창 ──
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
type PL = ReturnType<typeof panelLayout>;
/** 친구 창 자리 */
function friendLayout(L: PL) {
  const cols = L.wide ? 8 : 6;
  const cw = L.wide ? 74 : 76;
  const chh = L.wide ? 84 : 88;
  const gx = L.wide ? 320 : 22;
  const gy = L.wide ? 196 : 470;
  const cells = Array.from({ length: cols * 3 }, (_, i): R => ({ x: gx + (i % cols) * (cw + 8), y: gy + Math.floor(i / cols) * (chh + 8), w: cw, h: chh }));
  return {
    portrait: L.wide ? { x: 150, y: 150, r: 100 } : { x: 120, y: 150, r: 92 },
    info: L.wide ? { x: 150, y: 290 } : { x: 360, y: 96 },
    bubble: (L.wide ? { x: 320, y: 24, w: 590, h: 104 } : { x: 20, y: 296, w: 500, h: 104 }) as R,
    ask: (L.wide ? { x: 320, y: 138, w: 660, h: 46 } : { x: 20, y: 412, w: 500, h: 46 }) as R,
    cells,
    feed: (L.wide ? { x: 320, y: 492, w: 400, h: 54 } : { x: 20, y: 770, w: 310, h: 60 }) as R,
    talk: (L.wide ? { x: 736, y: 492, w: 244, h: 54 } : { x: 346, y: 770, w: 174, h: 60 }) as R,
  };
}
/** 가판대 창 자리 */
function kitchenLayout(L: PL) {
  const cards = RECIPES.map((_, i): R =>
    L.wide ? { x: 20 + (i % 2) * 316, y: 96 + Math.floor(i / 2) * 76, w: 308, h: 70 } : { x: 20, y: 92 + i * 64, w: 500, h: 58 },
  );
  const detail: R = L.wide ? { x: 660, y: 96, w: 320, h: 444 } : { x: 20, y: 802, w: 500, h: 224 };
  const cook: R = L.wide ? { x: 676, y: 470, w: 288, h: 56 } : { x: 290, y: 956, w: 214, h: 56 };
  return { cards, detail, cook };
}
/** 요리 · 선물 카드 자리 */
function cardLayout(L: PL) {
  const w = L.wide ? 640 : 500;
  const h = L.wide ? 500 : 760;
  const card: R = { x: (L.DW - w) / 2, y: (L.DH - h) / 2, w, h };
  const ok: R = { x: card.x + w / 2 - 130, y: card.y + h - 76, w: 260, h: 58 };
  const bar: R = { x: card.x + 50, y: card.y + h - (L.wide ? 170 : 250), w: w - 100, h: 40 };
  return { card, ok, bar };
}
/** 창에서 누를 곳 가운데 (CSS px) — 검증용 */
export function villagePoints(w: number, h: number) {
  const L = panelLayout(w, h);
  const mid = (r: R) => ({ x: L.ox + (r.x + r.w / 2) * L.k, y: L.oy + (r.y + r.h / 2) * L.k });
  const F = friendLayout(L);
  const K = kitchenLayout(L);
  return { close: mid(L.close), cells: F.cells.map(mid), feed: mid(F.feed), talk: mid(F.talk), recipes: K.cards.map(mid), cook: mid(K.cook), ok: mid(cardLayout(L).ok) };
}
/** 친구 창에 보이는 먹을 것 (가방에 있는 요리 · 간식, 부탁한 것 먼저) */
function dishes(b: Bag, ask: string | null) {
  const ids = [...new Set(b.slots.filter((x) => x && feedable(x.id)).map((x) => x!.id))];
  return ids.sort((p, q) => Number(q === ask) - Number(p === ask) || p.localeCompare(q));
}

export type VillageAct =
  | { kind: 'close' }
  | { kind: 'fed'; res: FeedResult; friend: Friend }
  | { kind: 'talk' }
  | { kind: 'cook'; cook: Cook }
  | { kind: 'served'; cook: Cook }
  | { kind: 'gift' }
  | { kind: 'pick' }
  | null;

/** 친구 창 · 가판대 창 열기 */
export function openVillagePanel(target: { kind: 'friend'; i: number } | { kind: 'kitchen' }, s: VillageState, save: VillageSave, b: Bag) {
  villageView.panel = target;
  if (target.kind === 'friend') {
    const f = FRIENDS[target.i];
    villageView.line = hello(save, f, s.rng);
    villageView.pick = dishes(b, save.friends[f.id].ask)[0] ?? null;
  } else {
    const known = knownRecipes(save);
    villageView.recipe = known.find((r) => canCook(b, r))?.id ?? known[0].id;
  }
}

/** 창을 눌렀다 (x, y = CSS px) */
export function villageTap(w: number, h: number, x: number, y: number, s: VillageState, save: VillageSave, b: Bag, now: number): VillageAct {
  const L = panelLayout(w, h);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  const P = villageView.panel;
  // 선물 카드 → 다음 카드
  if (villageView.gifts.length) {
    villageView.gifts.shift();
    return { kind: 'gift' };
  }
  if (P?.kind === 'cook') {
    const c = P.cook;
    if (c.phase === 'stir') return press(save, b);
    villageView.panel = { kind: 'kitchen' }; // 다 됐으면 어디를 눌러도 가판대로
    return { kind: 'pick' };
  }
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inR(L.close, px, py)) {
    villageView.panel = null;
    return { kind: 'close' };
  }
  if (P?.kind === 'friend') {
    const F = friendLayout(L);
    const f = FRIENDS[P.i];
    const list = dishes(b, save.friends[f.id].ask);
    const c = F.cells.findIndex((r) => inR(r, px, py));
    if (c >= 0 && list[c]) {
      villageView.pick = list[c];
      return { kind: 'pick' };
    }
    if (inR(F.talk, px, py)) {
      villageView.line = hello(save, f, s.rng);
      return { kind: 'talk' };
    }
    if (inR(F.feed, px, py)) return feedPick(s, save, b, now);
    return null;
  }
  if (P?.kind === 'kitchen') {
    const K = kitchenLayout(L);
    const c = K.cards.findIndex((r) => inR(r, px, py));
    if (c >= 0) {
      villageView.recipe = RECIPES[c].id;
      return { kind: 'pick' };
    }
    if (inR(K.cook, px, py)) return cookPick(save, b);
  }
  return null;
}
/** 고른 것을 먹여 준다 */
function feedPick(s: VillageState, save: VillageSave, b: Bag, now: number): VillageAct {
  const P = villageView.panel;
  if (P?.kind !== 'friend') return null;
  const f = FRIENDS[P.i];
  const id = villageView.pick;
  if (!id) return vsay('먹여 줄 요리가 없어요. 가판대에서 만들어 와요'), null;
  const res = feed(save, b, f, id, now, s.rng);
  if (!res.ok) {
    if (res.why === 'full') {
      villageView.line = res.line;
      vsay(`${f.name}는 배불러요 · ${Math.ceil(digestIn(save.friends[f.id], now) / 60)}분 뒤에 또 먹어요`);
    }
    return { kind: 'fed', res, friend: f };
  }
  villageView.line = res.line;
  if (res.coins) vsay(`부탁을 들어줬어요! 냥코인 +${res.coins}`);
  for (const r of res.rewards) villageView.gifts.push({ friend: f, r });
  if (!count(b, id)) villageView.pick = dishes(b, save.friends[f.id].ask)[0] ?? null;
  const p = s.townies[P.i];
  Object.assign(p, { hop: 0.5, say: res.line, sayT: 2.6 });
  return { kind: 'fed', res, friend: f };
}
/** 고른 요리법으로 요리를 시작한다 */
function cookPick(save: VillageSave, b: Bag): VillageAct {
  const r = RECIPES.find((x) => x.id === villageView.recipe)!;
  if (!save.recipes.includes(r.id)) return vsay('아직 모르는 요리법이에요'), null;
  const c = startCook(b, r);
  if (!c) return vsay('재료가 모자라요'), null;
  villageView.panel = { kind: 'cook', cook: c };
  return { kind: 'cook', cook: c };
}
/** 요리 바늘 멈추기 (Space · Enter · 누르기) */
function press(save: VillageSave, b: Bag): VillageAct {
  const P = villageView.panel;
  if (P?.kind !== 'cook' || P.cook.phase !== 'stir') return null;
  stopCook(P.cook);
  serve(save, b, P.cook);
  return { kind: 'served', cook: P.cook };
}
/** 요리가 탈 때까지 안 누르면 (main 이 updateCook 이 true 일 때 부른다) */
export function burn(save: VillageSave, b: Bag): VillageAct {
  const P = villageView.panel;
  if (P?.kind !== 'cook' || P.cook.phase !== 'stir') return null;
  stopCook(P.cook, true);
  serve(save, b, P.cook);
  return { kind: 'served', cook: P.cook };
}

/** 창 키: Esc 닫기 · Enter/Space 먹여 주기 · 요리 · 멈추기 · ←/→ ↑/↓ 고르기 */
export function villageKey(code: string, s: VillageState, save: VillageSave, b: Bag, now: number): VillageAct {
  const P = villageView.panel;
  const go = code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'KeyE';
  if (villageView.gifts.length && (go || code === 'Escape')) {
    villageView.gifts.shift();
    return { kind: 'gift' };
  }
  if (P?.kind === 'cook') {
    if (P.cook.phase === 'stir') return go ? press(save, b) : null;
    if (go || code === 'Escape') {
      villageView.panel = { kind: 'kitchen' };
      return { kind: 'pick' };
    }
    return null;
  }
  if (code === 'Escape') {
    villageView.panel = null;
    return { kind: 'close' };
  }
  const step = code === 'ArrowRight' || code === 'KeyD' || code === 'ArrowDown' || code === 'KeyS' ? 1 : code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowUp' || code === 'KeyW' ? -1 : 0;
  if (P?.kind === 'friend') {
    if (go) return feedPick(s, save, b, now);
    const list = dishes(b, save.friends[FRIENDS[P.i].id].ask);
    if (step && list.length) {
      const i = Math.max(0, list.indexOf(villageView.pick ?? ''));
      villageView.pick = list[(i + step + list.length) % list.length];
      return { kind: 'pick' };
    }
  }
  if (P?.kind === 'kitchen') {
    if (go) return cookPick(save, b);
    if (step) {
      const i = RECIPES.findIndex((r) => r.id === villageView.recipe);
      villageView.recipe = RECIPES[(i + step + RECIPES.length) % RECIPES.length].id;
      return { kind: 'pick' };
    }
  }
  return null;
}

/** 창 그리기 (장면 위에) */
export function drawVillagePanel(ctx: CanvasRenderingContext2D, w: number, h: number, s: VillageState, save: VillageSave, b: Bag, cat: Sheet, t: number, dt: number, now: number, touch: boolean) {
  const P = villageView.panel;
  villageView.msgT = Math.max(0, villageView.msgT - dt);
  if (!P && !villageView.gifts.length) return;
  const L = panelLayout(w, h);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.5)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  if (P?.kind === 'friend') drawFriend(ctx, L, P.i, s, save, b, cat, t, now);
  else if (P?.kind === 'kitchen') drawKitchen(ctx, L, save, b);
  else if (P?.kind === 'cook') drawCook(ctx, L, P.cook, t, touch);
  if (villageView.gifts.length) drawGift(ctx, L, villageView.gifts[0], cat, t);
  const ty = P?.kind === 'kitchen' ? kitchenLayout(L).cook.y - 52 : friendLayout(L).ask.y;
  toast(ctx, { wide: false, DW: L.DW, DH: L.DH, detail: { x: 0, y: ty + 54, w: 0, h: 0 } }, villageView.msg, villageView.msgT);
  ctx.restore();
}

function sheetBg(ctx: CanvasRenderingContext2D, L: PL) {
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(0, 0, L.DW, L.DH, 28);
  ctx.fill();
}
function closeX(ctx: CanvasRenderingContext2D, L: PL) {
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

function drawFriend(ctx: CanvasRenderingContext2D, L: PL, i: number, s: VillageState, save: VillageSave, b: Bag, cat: Sheet, t: number, now: number) {
  const f = FRIENDS[i];
  const fs = save.friends[f.id];
  const F = friendLayout(L);
  sheetBg(ctx, L);
  closeX(ctx, L);
  // 모습 · 이름 · 하트 · 다음 하트까지 · 배부름
  const pt = F.portrait;
  ctx.fillStyle = '#f3e3c9';
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
  ctx.fill();
  const p = s.townies[i];
  drawCat(ctx, friendSheet(cat, f), pt.x, pt.y + pt.r * 0.62, pt.r * 1.25, 1, false, t, p.hop, f.deco);
  const n = hearts(fs.pts);
  const I = F.info;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, f.name, I.x, I.y, 280, 34, 'bold ');
  ctx.fillStyle = '#9a7b62';
  fitText(ctx, f.about, I.x, I.y + 30, L.wide ? 290 : 330, 16);
  ctx.fillStyle = '#ef6b5e';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(heartText(n), I.x, I.y + 70);
  const bw = 220;
  const into = n >= 5 ? 1 : (fs.pts - n * VILLAGE.heart) / VILLAGE.heart;
  ctx.fillStyle = 'rgba(120,85,55,0.15)';
  ctx.beginPath();
  ctx.roundRect(I.x - bw / 2, I.y + 82, bw, 12, 6);
  ctx.fill();
  ctx.fillStyle = '#ef6b5e';
  ctx.beginPath();
  ctx.roundRect(I.x - bw / 2, I.y + 82, Math.max(12, bw * into), 12, 6);
  ctx.fill();
  const full = fullness(fs, now);
  ctx.fillStyle = '#9a7b62';
  ctx.font = 'bold 17px system-ui, sans-serif';
  const belly = `배부름 ${'●'.repeat(full)}${'○'.repeat(Math.max(0, VILLAGE.full - full))}`;
  ctx.fillText(full >= VILLAGE.full ? `${belly} · ${Math.ceil(digestIn(fs, now) / 60)}분 뒤 또 먹어요` : belly, I.x, I.y + 124);
  // 대사
  const B = F.bubble;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(120,85,55,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(B.x, B.y, B.w, B.h, 22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5b4a3f';
  ctx.textAlign = 'left';
  ctx.font = 'bold 21px system-ui, sans-serif';
  wrapText(ctx, villageView.line, B.w - 40)
    .slice(0, 3)
    .forEach((l, k) => ctx.fillText(l, B.x + 20, B.y + 38 + k * 28));
  // 부탁
  const A = F.ask;
  ctx.fillStyle = fs.ask ? 'rgba(239,107,94,0.12)' : 'rgba(120,85,55,0.06)';
  ctx.beginPath();
  ctx.roundRect(A.x, A.y, A.w, A.h, 14);
  ctx.fill();
  ctx.fillStyle = fs.ask ? '#d4574a' : '#b09a85';
  ctx.font = 'bold 17px system-ui, sans-serif';
  if (fs.ask) {
    drawIcon(ctx, fs.ask, A.x + 26, A.y + A.h / 2, 32);
    fitText(ctx, `부탁: ${ITEMS[fs.ask].name} 먹고 싶대요 · 들어주면 더 친해지고 냥코인`, A.x + 50, A.y + 29, A.w - 60, 17, 'bold ');
  } else fitText(ctx, '지금은 부탁이 없어요 · 요리를 먹여 주면 친해져요', A.x + 16, A.y + 29, A.w - 30, 17, 'bold ');
  // 먹을 것 칸 (입맛 표시 — 먹여 본 것만)
  const list = dishes(b, fs.ask);
  F.cells.forEach((r, k) => {
    const id = list[k] ?? null;
    itemCell(ctx, r, id, id ? count(b, id) : 0, !!id && villageView.pick === id);
    if (!id) return;
    const seen = fs.seen[id];
    ctx.font = 'bold 18px "Segoe UI Emoji", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5b4a3f';
    ctx.fillText(seen ? PREF_MARK[seen] : '?', r.x + 6, r.y + r.h - 8);
    if (id === fs.ask) {
      ctx.strokeStyle = '#ef6b5e';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6, 12);
      ctx.stroke();
    }
  });
  if (!list.length) {
    ctx.fillStyle = '#b09a85';
    ctx.textAlign = 'center';
    ctx.font = '19px system-ui, sans-serif';
    const g = F.cells[0];
    const gw = F.cells[F.cells.length - 1].x + F.cells[0].w - g.x;
    ctx.fillText('먹여 줄 요리가 없어요 — 요리 가판대에서 만들어 와요', g.x + gw / 2, g.y + 120);
  }
  const pick = villageView.pick;
  button(ctx, F.feed, pick ? `${ITEMS[pick].name} 먹여 주기` : '먹여 주기', pick ? 'main' : 'soft');
  button(ctx, F.talk, '이야기하기', 'soft');
}

function drawKitchen(ctx: CanvasRenderingContext2D, L: PL, save: VillageSave, b: Bag) {
  const K = kitchenLayout(L);
  sheetBg(ctx, L);
  header(ctx, { DW: L.DW, close: L.close }, '🍳 요리 가판대', b.coins);
  RECIPES.forEach((r, i) => {
    const c = K.cards[i];
    const known = save.recipes.includes(r.id);
    const ok = known && canCook(b, r);
    const on = villageView.recipe === r.id;
    ctx.fillStyle = on ? '#fff1dc' : known ? '#ffffff' : 'rgba(120,85,55,0.07)';
    ctx.beginPath();
    ctx.roundRect(c.x, c.y, c.w, c.h, 14);
    ctx.fill();
    ctx.strokeStyle = on ? '#f08a3c' : ok ? '#7cc35a' : 'rgba(120,85,55,0.2)';
    ctx.lineWidth = on ? 3.5 : 2;
    ctx.stroke();
    drawIcon(ctx, r.id, c.x + c.h / 2, c.y + c.h / 2, c.h * 0.72, !known);
    const tx = c.x + c.h + 4;
    ctx.textAlign = 'left';
    ctx.fillStyle = known ? '#5b4a3f' : '#b09a85';
    if (!known) {
      const who = teacher(r.id);
      fitText(ctx, '??? 아직 모르는 요리', tx, c.y + 27, c.w - c.h - 12, 18, 'bold ');
      ctx.fillStyle = '#c98a1c';
      fitText(ctx, who ? `${who.friend.name}와 ♥${who.level} 이 되면 알려 줘요` : '', tx, c.y + 52, c.w - c.h - 12, 15, 'bold ');
      return;
    }
    fitText(ctx, ITEMS[r.id].name, tx, c.y + 26, c.w - c.h - 12, 19, 'bold ');
    // 재료: 아이콘 · 가진 수/필요한 수
    let x = tx;
    for (const [id, n] of r.need) {
      drawIcon(ctx, id, x + 12, c.y + c.h - 20, 22);
      const have = count(b, id);
      ctx.fillStyle = have >= n ? '#3e9a45' : '#d4574a';
      ctx.font = 'bold 14px system-ui, sans-serif';
      const label = `${Math.min(have, 99)}/${n}`;
      ctx.fillText(label, x + 25, c.y + c.h - 14);
      x += 30 + ctx.measureText(label).width;
    }
  });
  // 고른 요리법
  const r = RECIPES.find((x) => x.id === villageView.recipe)!;
  const D = K.detail;
  ctx.fillStyle = 'rgba(120,85,55,0.07)';
  ctx.beginPath();
  ctx.roundRect(D.x, D.y, D.w, D.h, 18);
  ctx.fill();
  const known = save.recipes.includes(r.id);
  const big = L.wide ? { x: D.x + D.w / 2, y: D.y + 70, s: 96 } : { x: D.x + 60, y: D.y + 62, s: 84 };
  drawIcon(ctx, r.id, big.x, big.y, big.s, !known);
  const tx = L.wide ? D.x + D.w / 2 : D.x + 120;
  const tw = L.wide ? D.w - 24 : D.w - 136;
  let y = L.wide ? D.y + 150 : D.y + 40;
  ctx.textAlign = L.wide ? 'center' : 'left';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, known ? ITEMS[r.id].name : '???', tx, y, tw, 24, 'bold ');
  y += 28;
  if (known) {
    ctx.fillStyle = '#3f7fbf';
    ctx.font = 'bold 16px system-ui, sans-serif';
    for (const l of useLines(ITEMS[r.id])) {
      fitText(ctx, l, tx, y, tw, 16, 'bold ');
      y += 22;
    }
    // 좋아하는 친구 (먹여 봐서 아는 것만)
    const fans = FRIENDS.filter((f) => {
      const p = save.friends[f.id].seen[r.id];
      return p === 'love' || p === 'like';
    }).map((f) => `${f.name} ${PREF_MARK[save.friends[f.id].seen[r.id]]}`);
    ctx.fillStyle = '#9a7b62';
    fitText(ctx, fans.length ? `좋아하는 친구: ${fans.join(' · ')}` : '먹여 본 친구의 입맛이 여기에 적혀요', tx, y + 4, tw, 15, '');
    y += 28;
    ctx.fillStyle = '#7a6656';
    ctx.font = '15px system-ui, sans-serif';
    for (const l of wrapText(ctx, ITEMS[r.id].desc, tw).slice(0, L.wide ? 4 : 2)) {
      ctx.fillText(l, tx, y);
      y += 20;
    }
  } else {
    const who = teacher(r.id);
    ctx.fillStyle = '#c98a1c';
    fitText(ctx, who ? `${who.friend.name}와 친해지면(♥${who.level}) 알려 줘요` : '', tx, y, tw, 16, 'bold ');
  }
  const ok = known && canCook(b, r);
  button(ctx, K.cook, !known ? '아직 몰라요' : ok ? '요리하기' : '재료가 모자라요', ok ? 'main' : 'soft');
}

/** 요리: 냄비 · 재료가 퐁당 · 바늘 막대 (good 칸 초록 · 가운데 perfect 금색) → 별 · 그릇 */
function drawCook(ctx: CanvasRenderingContext2D, L: PL, c: Cook, t: number, touch: boolean) {
  const { card, ok, bar } = cardLayout(L);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.w, card.h, 28);
  ctx.fill();
  const cx = card.x + card.w / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, `${ITEMS[c.recipe.id].name} ${c.phase === 'done' ? '완성!' : '만드는 중'}`, cx, card.y + 52, card.w - 40, 28, 'bold ');
  // 냄비 · 불 · 김
  const py = card.y + (L.wide ? 210 : 280);
  const pw = L.wide ? 170 : 190;
  for (let i = 0; i < 5; i++) {
    const fx = cx + (i - 2) * pw * 0.18;
    const fh = 22 + 10 * Math.sin(t * 11 + i * 1.7);
    ctx.fillStyle = i % 2 ? '#ffb04a' : '#ff7a3a';
    ctx.beginPath();
    ctx.moveTo(fx - 12, py + pw * 0.42);
    ctx.quadraticCurveTo(fx, py + pw * 0.42 - fh * 2, fx + 12, py + pw * 0.42);
    ctx.fill();
  }
  ctx.fillStyle = '#4a4a52';
  ctx.beginPath();
  ctx.ellipse(cx, py, pw / 2, pw * 0.42, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = '#5c5c66';
  ctx.beginPath();
  ctx.ellipse(cx, py, pw / 2, pw * 0.13, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.phase === 'done' && c.stars === 1 ? '#7a5a3a' : '#f3c56b';
  ctx.beginPath();
  ctx.ellipse(cx, py + 2, pw / 2 - 10, pw * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 3; i++) {
    const k = (t * 0.7 + i / 3) % 1;
    ctx.fillStyle = `rgba(255,255,255,${0.55 * (1 - k)})`;
    ctx.beginPath();
    ctx.arc(cx + Math.sin(t * 2 + i * 2) * 26, py - 20 - k * 80, 14 + k * 14, 0, Math.PI * 2);
    ctx.fill();
  }
  // 재료가 퐁당 (처음 0.7초)
  c.recipe.need.forEach(([id], i) => {
    const k = Math.min(1, Math.max(0, (c.t - i * 0.15) / 0.5));
    if (k >= 1) return;
    drawIcon(ctx, id, cx + (i - (c.recipe.need.length - 1) / 2) * 60 * (1 - k), py - 150 + k * 150, 52);
  });
  if (c.phase === 'stir') {
    // 바늘 막대
    ctx.fillStyle = 'rgba(120,85,55,0.15)';
    ctx.beginPath();
    ctx.roundRect(bar.x, bar.y, bar.w, bar.h, bar.h / 2);
    ctx.fill();
    const gx = bar.x + (c.c - c.w / 2) * bar.w;
    ctx.fillStyle = '#9ad16a';
    ctx.fillRect(gx, bar.y + 4, c.w * bar.w, bar.h - 8);
    const pf = c.w * VILLAGE.cook.perfect;
    ctx.fillStyle = '#ffd23a';
    ctx.fillRect(bar.x + (c.c - pf / 2) * bar.w, bar.y + 4, pf * bar.w, bar.h - 8);
    const nx = bar.x + c.pos * bar.w;
    ctx.fillStyle = '#5b4a3f';
    ctx.beginPath();
    ctx.moveTo(nx, bar.y - 4);
    ctx.lineTo(nx - 11, bar.y - 22);
    ctx.lineTo(nx + 11, bar.y - 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(nx - 2.5, bar.y - 4, 5, bar.h + 8);
    ctx.fillStyle = '#5b4a3f';
    ctx.font = 'bold 22px system-ui, sans-serif';
    fitText(ctx, touch ? '노란 칸에서 화면을 누르세요!' : '노란 칸에서 Space!', cx, bar.y + bar.h + 44, card.w - 40, 22, 'bold ');
    const left = Math.max(0, VILLAGE.cook.limit - c.t);
    ctx.fillStyle = left < 2 ? '#d4574a' : '#9a7b62';
    ctx.font = '16px system-ui, sans-serif';
    ctx.fillText(`${left.toFixed(1)}초 뒤 타요`, cx, bar.y + bar.h + 72);
    return;
  }
  // 다 됐다: 별 · 한마디 · 그릇
  const words = ['', '앗, 조금 탔어요…', '맛있게 됐어요!', '완벽해요! 냄새가 끝내줘요'];
  ctx.font = 'bold 48px system-ui, sans-serif';
  ctx.fillStyle = '#ffc93a';
  ctx.fillText('★'.repeat(c.stars) + '☆'.repeat(3 - c.stars), cx, bar.y + 2);
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, words[c.stars], cx, bar.y + 42, card.w - 40, 24, 'bold ');
  ctx.fillStyle = c.lost ? '#d4574a' : '#3f95dd';
  fitText(ctx, c.lost ? `${ITEMS[c.recipe.id].name} ${c.served}그릇 · 가방이 가득해 ${c.lost}그릇은 못 담았어요` : `${ITEMS[c.recipe.id].name} ${c.served}그릇을 가방에 담았어요`, cx, bar.y + 72, card.w - 40, 19, 'bold ');
  button(ctx, ok, '좋아요', 'main');
}

/** 하트 선물 카드 */
function drawGift(ctx: CanvasRenderingContext2D, L: PL, g: { friend: Friend; r: Reward }, cat: Sheet, t: number) {
  const { card, ok } = cardLayout(L);
  ctx.fillStyle = 'rgba(40,28,20,0.35)';
  ctx.fillRect(0, 0, L.DW, L.DH);
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = '#ef6b5e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.w, card.h, 28);
  ctx.fill();
  ctx.stroke();
  const cx = card.x + card.w / 2;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ef6b5e';
  ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(heartText(g.r.level), cx, card.y + 62);
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, g.r.level >= 5 ? `${g.friend.name}와 단짝이 됐어요!` : `${g.friend.name}와 더 친해졌어요`, cx, card.y + 106, card.w - 40, 28, 'bold ');
  drawCat(ctx, friendSheet(cat, g.friend), cx, card.y + (L.wide ? 236 : 300), L.wide ? 104 : 130, 1, false, t, (t % 1.2) < 0.5 ? t % 1.2 : 0, g.friend.deco);
  ctx.fillStyle = '#7a6656';
  ctx.font = 'bold 19px system-ui, sans-serif';
  const lines = wrapText(ctx, `“${g.r.say}”`, card.w - 60);
  let y = card.y + (L.wide ? 280 : 360);
  for (const l of lines.slice(0, 3)) {
    ctx.fillText(l, cx, y);
    y += 26;
  }
  // 받은 것
  const got: [string | null, string][] = [
    ...(g.r.recipe ? [[g.r.recipe, `새 요리법: ${ITEMS[g.r.recipe].name}`] as [string, string]] : []),
    ...g.r.items.map(([id, n]) => [id, `${ITEMS[id].name}${n > 1 ? ` ×${n}` : ''}`] as [string, string]),
    ...(g.r.coins ? [[null, `냥코인 +${g.r.coins}`] as [null, string]] : []),
  ];
  y += 14;
  for (const [id, text] of got) {
    if (id) drawIcon(ctx, id, cx - 130, y - 8, 34);
    else drawCoin(ctx, cx - 130, y - 8, 14);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#c98a1c';
    fitText(ctx, text, cx - 104, y, card.w / 2 + 40, 20, 'bold ');
    ctx.textAlign = 'center';
    y += 40;
  }
  button(ctx, ok, '고마워!', 'main');
}
