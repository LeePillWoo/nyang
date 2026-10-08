// 고양이마을 그리기 — 전용 배경(backgrounds/village, 1536×1024)을 크게 보여 주고 고양이를 따라간다 (2026-10-08 저녁 — 필드 조각 광장에서 바꿈).
// 주민 친구 여덟은 전용 시트(characters/npcs/village_cats — 품종마다 한 장, 동작 8줄 × 6컷, 효과까지 그림에 들어 있다)로 그린다:
// 대기 · 장난감 놀이 · 화남 · 애정(하트) · 배고픔(생선 생각풍선) · 심심 · 삐짐(먹구름) · 잠(Z). 시트는 오른쪽을 보고 있어 왼쪽은 뒤집는다.
// 이름표 · 하트 · 부탁 말풍선 · 대사 말풍선 · 요리 가판대 표지 · HUD. (곁에 가서 누르면 말을 건다 — 안내 말풍선은 없다)
// 창: 친구(먹여 주기 · 놀아 주기 · 이야기) · 요리 가판대(요리법 · 부족한 재료 바로가기) · 요리(바늘 타이밍) · 하트 선물 카드. 창은 가방처럼 디자인 좌표
// (가로 1000×560 · 세로 540×1040)로 그리고 화면에 맞춰 줄인다. 로직은 village.ts.
import { image } from './assets.ts';
import { button, drawCoin, drawIcon, header, itemCell, toast, useLines } from './bag-draw.ts';
import { count, ITEMS, type Bag } from './bag.ts';
import { CAT_FPS, CAT_ROW } from './cat.ts';
import field from './data/field.json' with { type: 'json' };
import CATS from './data/village-cats.json' with { type: 'json' };
import { drawEmote } from './emote.ts';
import { drawLeave, drawPill, miniLayout, type MiniButton } from './mini-draw.ts';
import { drawFrame, type Sheet } from './sheet.ts';
import { shortcut, type Shortcut } from './sources.ts';
import { fitText, safe, wrapText } from './touch.ts';
import {
  BLOCKS,
  C,
  canCook,
  digestIn,
  feed,
  feedable,
  FRIENDS,
  fullness,
  hearts,
  hello,
  knownRecipes,
  ONE_SHOT,
  play,
  reactAnim,
  RECIPES,
  serve,
  setAnim,
  startCook,
  stopCook,
  teacher,
  VILLAGE,
  type Cook,
  type FeedResult,
  type Friend,
  type PlayResult,
  type Pref,
  type Recipe,
  type Reward,
  type Townie,
  type VillageSave,
  type VillageState,
} from './village.ts';

const V = field.vertical;
type R = { x: number; y: number; w: number; h: number };
const inR = (r: R, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

// ── 배경 · 주민 시트 ──
const BG = image(VILLAGE.image);
type CatAtlas = { name: string; file: string; anims: Record<string, { fps: number; loop: boolean; f: number[][] }> };
const ATLAS = CATS as Record<string, CatAtlas>;
export const villageReady = Promise.all([BG.ready, ...Object.values(ATLAS).map((a) => image(a.file).ready)]);
/** 주민 그림 배율 — 시트 칸(181)에서 고양이가 약 96px: 치즈 키 C 의 1.3배 × 품종 size */
const villagerScale = (f: Friend) => (C * 1.3 * f.size) / 96;
/** 지금 동작의 컷 — 대기는 되풀이, 한 번 하는 동작은 마지막 컷에서 머물고, 잠은 3컷 뒤 숨쉬기 되풀이, 배고픔은 생각풍선 컷(1~4)을 오간다 */
function frameOf(a: CatAtlas, p: Townie) {
  const an = a.anims[p.anim] ?? a.anims.idle;
  const n = an.f.length;
  const k = Math.floor(p.animT * an.fps);
  let i: number;
  if (p.anim === 'sleep') i = k < 3 ? k : 3 + ((k - 3) % 3);
  else if (p.anim === 'hungry') i = k < 1 ? 0 : [1, 2, 3, 4, 3, 2][(k - 1) % 6];
  else if (ONE_SHOT[p.anim] !== undefined) i = Math.min(n - 1, k);
  else i = k % n;
  return an.f[Math.min(n - 1, i)];
}
/** 주민 한 마리 (발밑 x, y) — 그림자 · 시트 컷. flip 1 = 오른쪽(시트 그대로). 돌려주는 것: 정수리 높이 */
function drawVillager(ctx: CanvasRenderingContext2D, f: Friend, p: Townie, x: number, y: number, k = villagerScale(f)) {
  const a = ATLAS[f.sheet];
  const im = image(a.file).img;
  const z = p.hop > 0 ? Math.sin((p.hop / 0.5) * Math.PI) * C * 0.35 : 0;
  ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, C * 0.36 * f.size, C * 0.13 * f.size, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!im.complete || !im.naturalWidth) return y - C;
  const [sx, sy, sw, sh, px, py] = frameOf(a, p);
  ctx.save();
  ctx.translate(x, y - z);
  ctx.scale(p.flip, 1);
  ctx.drawImage(im, sx, sy, sw, sh, -px * k, -py * k, sw * k, sh * k);
  ctx.restore();
  return y - z - (py - 34) * k;
}
/** 치즈 (발밑 x, y · 키 k px) — 필드 고양이 시트. 돌려주는 것: 정수리 높이 */
function drawCat(ctx: CanvasRenderingContext2D, sh: Sheet, x: number, y: number, k: number, flip: number, moving: boolean, animT: number) {
  const row = moving ? CAT_ROW.run : CAT_ROW.idle;
  const col = Math.floor(animT * (moving ? CAT_FPS.run : CAT_FPS.idle)) % 6;
  const size = (k * sh.base) / sh.bodyH;
  ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, k * 0.34, k * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();
  drawFrame(ctx, sh, row, col, x, y, size, flip);
  const f = sh.frames[row]?.[col];
  const s = (size / sh.base) * (sh.rowScale[row] ?? 1);
  return f ? y + f.oy * s : y - k;
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

/** 장면 그리기 (창은 drawVillagePanel). debug = 걷는 영역 · 막힌 곳 보기 (G 키) */
export function drawVillage(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: VillageState, save: VillageSave, cat: Sheet, v: { t: number; dt: number; touch: boolean; hover: MiniButton; debug?: boolean }) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cw / dpr;
  const h = ch / dpr;
  const [W, H] = VILLAGE.size;
  // 화면에서 고양이 키(CSS px) — 그림을 확대하기 전 크기 그대로 (휴대폰 · 짧은 변 < 500 은 조금 크게, 아주 큰 화면은 조금 더 크게)
  // 2026-10-08 밤 사용자: "마을이 꽉 차 보이게 그림을 확대해서 크롭, 캐릭터는 지금 크기" — 그림 1px 이 catCss ÷ C 배로 보인다 (unit 이 작을수록 그림이 크다)
  const catCss = VILLAGE.catCss * Math.min(1.4, Math.max(Math.min(w, h) < 500 ? 1.15 : 0.95, Math.min(w / W, h / H)));
  const sc = catCss / C;
  const vw = w / sc;
  const vh = h / sc;
  // 카메라: 필드처럼 고양이를 부드럽게 따라가고(CAM_EASE 8) 그림 밖은 안 보이게 — 넘치는 곳은 걸어가면 보인다
  const cam = (villageView.cam ??= { x: s.cat.x, y: s.cat.y - C * 0.5 });
  const k = 1 - Math.exp(-8 * v.dt);
  cam.x += (s.cat.x - cam.x) * k;
  cam.y += (s.cat.y - C * 0.5 - cam.y) * k;
  const cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, cam.x));
  const cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, cam.y));
  const ox = w / 2 - cx * sc;
  const oy = h / 2 - cy * sc;
  Object.assign(villageView, { sc: sc * dpr, ox: ox * dpr, oy: oy * dpr });
  // 화면에 보이는 곳 (지도 px) — 이름표 · 말풍선 · 표지가 화면 밖으로 잘리지 않게 안으로 당긴다
  const seen: View = { x0: -ox / sc, y0: -oy / sc, x1: (w - ox) / sc, y1: (h - oy) / sc };
  const pad = 4 / sc;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#9fcf7a';
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(sc * dpr, 0, 0, sc * dpr, ox * dpr, oy * dpr);
  ctx.imageSmoothingQuality = 'high';
  if (BG.img.complete && BG.img.naturalWidth) ctx.drawImage(BG.img, 0, 0, W, H);
  if (v.debug) {
    ctx.strokeStyle = 'rgba(0,160,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    VILLAGE.walk.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,40,40,0.9)';
    for (const b of BLOCKS) {
      ctx.beginPath();
      if (b.type === 'rect') ctx.rect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
      else ctx.ellipse(b.x, b.y, b.rx, b.ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // 요리 가판대 표지 — 요리집 앞 간판
  const [kx, ky] = VILLAGE.kitchenSign;
  const glow = 0.6 + 0.4 * Math.sin(v.t * 3);
  ctx.font = `bold ${C * 0.42}px system-ui, sans-serif`;
  const label = '🍳 요리 가판대';
  const lw = ctx.measureText(label).width + C * 0.5;
  const lx = fitX(seen, kx, lw / 2, pad);
  ctx.fillStyle = `rgba(255, 246, 220, ${0.85 + 0.1 * glow})`;
  ctx.beginPath();
  ctx.roundRect(lx - lw / 2, ky - C * 0.36, lw, C * 0.68, C * 0.34);
  ctx.fill();
  ctx.fillStyle = '#c0582c';
  ctx.textAlign = 'center';
  ctx.fillText(label, lx, ky + C * 0.14);

  // 주민 · 고양이 (아래 것을 나중에)
  type Thing = { y: number; draw: () => void };
  const things: Thing[] = s.townies.map((p, i) => ({
    y: p.y,
    draw: () => {
      if (p.x < seen.x0 - C * 1.2 || p.x > seen.x1 + C * 1.2) return; // 화면 밖 친구는 그리지 않는다
      const f = FRIENDS[i];
      const top = drawVillager(ctx, f, p, p.x, p.y);
      const fs = save.friends[f.id];
      // 이름 · 하트는 장면에 안 띄운다 (2026-10-08 밤 사용자 — 정보가 너무 많다, 친구 창에서 본다)
      // 대사 · 부탁 (먹고 싶은 요리 — 작은 말풍선을 머리 옆에, 시트의 생선 생각풍선과 반대쪽)
      if (p.sayT > 0) bubble(ctx, seen, p.x, top + C * 0.1, p.y + C * 0.2, p.say, C * 5.2, C * 0.34, Math.min(1, p.sayT / 0.3)); // 글자 작게 (2026-10-08 밤)
      else if (fs.ask) {
        const bob = Math.sin(v.t * 4 + i) * C * 0.05;
        const bx = fitX(seen, p.x - p.flip * C * 0.42, C * 0.42, pad);
        const by = top + C * 0.22 + bob;
        ctx.fillStyle = 'rgba(255, 252, 244, 0.97)';
        ctx.strokeStyle = '#ef6b5e';
        ctx.lineWidth = C * 0.04;
        ctx.beginPath();
        ctx.roundRect(bx - C * 0.42, by - C * 0.27, C * 0.84, C * 0.54, C * 0.22);
        ctx.fill();
        ctx.stroke();
        drawIcon(ctx, fs.ask, bx - C * 0.13, by, C * 0.42);
        ctx.fillStyle = '#ef6b5e';
        ctx.font = `bold ${C * 0.36}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('!', bx + C * 0.24, by + C * 0.13);
      }
    },
  }));
  things.push({
    y: s.cat.y,
    draw: () => {
      drawCat(ctx, cat, s.cat.x, s.cat.y, C, s.cat.flip, s.cat.moving, s.cat.animT);
      drawEmote(ctx, s.cat.x, s.cat.y - C * 1.25, C * 0.8);
    },
  });
  things.sort((a, b) => a.y - b.y).forEach((o) => o.draw());
  // 저절로 걸어가는 곳 표시
  if (s.goal && !s.goal.then) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.lineWidth = C * 0.05;
    ctx.beginPath();
    ctx.ellipse(s.goal.x, s.goal.y, C * 0.35, C * 0.35 * V, 0, 0, Math.PI * 2);
    ctx.stroke();
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
    feed: (L.wide ? { x: 320, y: 492, w: 300, h: 54 } : { x: 20, y: 770, w: 236, h: 60 }) as R,
    play: (L.wide ? { x: 632, y: 492, w: 170, h: 54 } : { x: 266, y: 770, w: 126, h: 60 }) as R,
    talk: (L.wide ? { x: 814, y: 492, w: 166, h: 54 } : { x: 402, y: 770, w: 118, h: 60 }) as R,
  };
}
/** 가판대 창 자리 — gos = 부족한 재료 바로가기 (최대 3줄) */
function kitchenLayout(L: PL) {
  const cards = RECIPES.map((_, i): R =>
    L.wide ? { x: 20 + (i % 2) * 316, y: 96 + Math.floor(i / 2) * 76, w: 308, h: 70 } : { x: 20, y: 92 + i * 64, w: 500, h: 58 },
  );
  const detail: R = L.wide ? { x: 660, y: 96, w: 320, h: 444 } : { x: 20, y: 802, w: 500, h: 224 };
  const cook: R = L.wide ? { x: 676, y: 470, w: 288, h: 56 } : { x: 290, y: 956, w: 214, h: 56 };
  const gos = [0, 1, 2].map((i): R => (L.wide ? { x: 676, y: 322 + i * 46, w: 288, h: 40 } : { x: 30, y: 870 + i * 46, w: 250, h: 40 }));
  return { cards, detail, cook, gos };
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
  return { close: mid(L.close), cells: F.cells.map(mid), feed: mid(F.feed), play: mid(F.play), talk: mid(F.talk), recipes: K.cards.map(mid), cook: mid(K.cook), gos: K.gos.map(mid), ok: mid(cardLayout(L).ok) };
}
/** 친구 창에 보이는 먹을 것 (가방에 있는 요리 · 간식, 부탁한 것 먼저) */
function dishes(b: Bag, ask: string | null) {
  const ids = [...new Set(b.slots.filter((x) => x && feedable(x.id)).map((x) => x!.id))];
  return ids.sort((p, q) => Number(q === ask) - Number(p === ask) || p.localeCompare(q));
}
/** 요리법에 모자란 재료와 가지러 갈 곳 */
const missing = (b: Bag, r: Recipe) => r.need.filter(([id, n]) => count(b, id) < n).map(([id, n]) => ({ id, have: count(b, id), n, go: shortcut(id) as Shortcut | null }));

export type VillageAct =
  | { kind: 'close' }
  | { kind: 'fed'; res: FeedResult; friend: Friend }
  | { kind: 'played'; res: PlayResult; friend: Friend }
  | { kind: 'talk' }
  | { kind: 'cook'; cook: Cook }
  | { kind: 'served'; cook: Cook }
  | { kind: 'gift' }
  | { kind: 'pick' }
  | { kind: 'travel'; id: string }
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
      s.townies[P.i].hop = 0.5;
      return { kind: 'talk' };
    }
    if (inR(F.play, px, py)) return playPick(s, save, b, now);
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
    const r = RECIPES.find((v) => v.id === villageView.recipe)!;
    if (save.recipes.includes(r.id)) {
      const g = K.gos.findIndex((v) => inR(v, px, py));
      const m = missing(b, r)[g];
      if (g >= 0 && m?.go) return { kind: 'travel', id: m.go.warp.id };
    }
  }
  return null;
}
/** 고른 것을 먹여 준다 */
function feedPick(s: VillageState, save: VillageSave, b: Bag, now: number): VillageAct {
  const P = villageView.panel;
  if (P?.kind !== 'friend') return null;
  const f = FRIENDS[P.i];
  const p = s.townies[P.i];
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
  setAnim(p, reactAnim(res.pref));
  Object.assign(p, { hop: res.pref === 'dislike' ? 0 : 0.5, say: res.line, sayT: 2.6 });
  return { kind: 'fed', res, friend: f };
}
/** 놀아 준다 — 장난감 놀이 동작, playEvery 초에 한 번 점수 */
function playPick(s: VillageState, save: VillageSave, b: Bag, now: number): VillageAct {
  const P = villageView.panel;
  if (P?.kind !== 'friend') return null;
  const f = FRIENDS[P.i];
  const p = s.townies[P.i];
  const res = play(save, b, f, now);
  villageView.line = res.ok ? res.line : `${res.line} (${Math.ceil(res.wait / 60)}분 뒤)`;
  setAnim(p, res.ok ? 'solo_play' : 'bored');
  if (res.ok) for (const r of res.rewards) villageView.gifts.push({ friend: f, r });
  Object.assign(p, { say: res.line, sayT: 2.4 });
  return { kind: 'played', res, friend: f };
}
/** 고른 요리법으로 요리를 시작한다 */
function cookPick(save: VillageSave, b: Bag): VillageAct {
  const r = RECIPES.find((x) => x.id === villageView.recipe)!;
  if (!save.recipes.includes(r.id)) return vsay('아직 모르는 요리법이에요'), null;
  const c = startCook(b, r);
  if (!c) return vsay('재료가 모자라요 — 아래 바로가기로 가지러 가요'), null;
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

/** 창 키: Esc 닫기 · Enter/Space 먹여 주기 · 요리 · 멈추기 · P 놀아 주기 · ←/→ ↑/↓ 고르기 */
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
    if (code === 'KeyP') return playPick(s, save, b, now);
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
export function drawVillagePanel(ctx: CanvasRenderingContext2D, w: number, h: number, s: VillageState, save: VillageSave, b: Bag, _cat: Sheet, t: number, dt: number, now: number, touch: boolean) {
  const P = villageView.panel;
  villageView.msgT = Math.max(0, villageView.msgT - dt);
  if (!P && !villageView.gifts.length) return;
  const L = panelLayout(w, h);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.5)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  if (P?.kind === 'friend') drawFriend(ctx, L, P.i, s, save, b, now);
  else if (P?.kind === 'kitchen') drawKitchen(ctx, L, save, b);
  else if (P?.kind === 'cook') drawCook(ctx, L, P.cook, t, touch);
  if (villageView.gifts.length) drawGift(ctx, L, villageView.gifts[0], t);
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

function drawFriend(ctx: CanvasRenderingContext2D, L: PL, i: number, s: VillageState, save: VillageSave, b: Bag, now: number) {
  const f = FRIENDS[i];
  const fs = save.friends[f.id];
  const F = friendLayout(L);
  sheetBg(ctx, L);
  closeX(ctx, L);
  // 모습(지금 동작 그대로) · 이름 · 하트 · 다음 하트까지 · 배부름
  const pt = F.portrait;
  ctx.fillStyle = '#f3e3c9';
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
  ctx.fill();
  const p = s.townies[i];
  drawVillager(ctx, f, { ...p, flip: 1, hop: p.hop }, pt.x, pt.y + pt.r * 0.62, (pt.r * 1.02) / 96); // 효과(생각풍선 · 하트)까지 원 안에
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
  } else fitText(ctx, '지금은 부탁이 없어요 · 요리를 먹여 주거나 놀아 주면 친해져요', A.x + 16, A.y + 29, A.w - 30, 17, 'bold ');
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
  const canPlay = now - fs.playedAt >= VILLAGE.playEvery * 1000;
  button(ctx, F.play, canPlay ? '🧶 놀아 주기' : '놀았어요', canPlay ? 'main' : 'soft');
  button(ctx, F.talk, '이야기', 'soft');
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
  const big = L.wide ? { x: D.x + D.w / 2, y: D.y + 60, s: 84 } : { x: D.x + 60, y: D.y + 62, s: 84 };
  drawIcon(ctx, r.id, big.x, big.y, big.s, !known);
  const tx = L.wide ? D.x + D.w / 2 : D.x + 120;
  const tw = L.wide ? D.w - 24 : D.w - 136;
  let y = L.wide ? D.y + 128 : D.y + 40;
  ctx.textAlign = L.wide ? 'center' : 'left';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, known ? ITEMS[r.id].name : '???', tx, y, tw, 24, 'bold ');
  y += 26;
  if (known) {
    ctx.fillStyle = '#3f7fbf';
    for (const l of useLines(ITEMS[r.id])) {
      fitText(ctx, l, tx, y, tw, 15, 'bold ');
      y += 20;
    }
    // 좋아하는 친구 (먹여 봐서 아는 것만)
    const fans = FRIENDS.filter((f) => {
      const p = save.friends[f.id].seen[r.id];
      return p === 'love' || p === 'like';
    }).map((f) => `${f.name} ${PREF_MARK[save.friends[f.id].seen[r.id]]}`);
    ctx.fillStyle = '#9a7b62';
    fitText(ctx, fans.length ? `좋아하는 친구: ${fans.join(' · ')}` : '먹여 본 친구의 입맛이 여기에 적혀요', tx, y + 2, tw, 14, '');
    y += 22;
    // 모자란 재료 → 가지러 갈 곳 (2026-10-08 사용자 요청 — 누르면 그 포탈 앞으로)
    const miss = missing(b, r);
    if (!miss.length) {
      ctx.fillStyle = '#7a6656';
      ctx.font = '15px system-ui, sans-serif';
      for (const l of wrapText(ctx, ITEMS[r.id].desc, tw).slice(0, L.wide ? 3 : 2)) {
        ctx.fillText(l, tx, y);
        y += 19;
      }
    } else {
      ctx.fillStyle = '#d4574a';
      fitText(ctx, '모자란 재료 — 누르면 가지러 가요', tx, y, tw, 14, 'bold ');
    }
    miss.slice(0, 3).forEach((m, i) => {
      const g = K.gos[i];
      ctx.fillStyle = m.go ? '#ffffff' : 'rgba(255,255,255,0.5)';
      ctx.strokeStyle = m.go ? '#f08a3c' : 'rgba(120,85,55,0.2)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(g.x, g.y, g.w, g.h, 12);
      ctx.fill();
      ctx.stroke();
      drawIcon(ctx, m.id, g.x + 20, g.y + g.h / 2, 26);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#5b4a3f';
      fitText(ctx, `${ITEMS[m.id].name} ${m.have}/${m.n}`, g.x + 38, g.y + 18, g.w - 44, 13, 'bold ');
      ctx.fillStyle = m.go ? '#c0582c' : '#b09a85';
      fitText(ctx, m.go ? `📍 ${m.go.warp.label} · ${m.go.why}` : '어디서 나는지 몰라요', g.x + 38, g.y + 33, g.w - 44, 12, 'bold ');
    });
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

/** 하트 선물 카드 — 친구는 애정 동작으로 */
function drawGift(ctx: CanvasRenderingContext2D, L: PL, g: { friend: Friend; r: Reward }, t: number) {
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
  const pose: Townie = { x: 0, y: 0, flip: 1, anim: 'affection', animT: t % 3, idleT: 0, hop: 0, say: '', sayT: 0 };
  drawVillager(ctx, g.friend, pose, cx, card.y + (L.wide ? 236 : 300), (L.wide ? 118 : 140) / 96);
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
