// 가방 · 장비 화면 + 아이템 아이콘 그리기. 로직은 bag.ts.
// 디자인 좌표(가로 화면 1000×560 · 세로 화면 540×1040)로 그리고 화면에 맞춰 통째로 줄인다 (도감과 같은 방식). ctx 는 CSS px.
//  가로: 왼쪽 장비 6칸 + 능력치 · 가운데 가방 6열 · 오른쪽 고른 물건 설명과 버튼
//  세로: 위 장비 한 줄 + 능력치 · 가운데 가방 · 아래 설명과 버튼
import { image } from './assets.ts';
import {
  buy,
  count,
  equipAt,
  isEquip,
  ITEMS,
  removeAt,
  sellAt,
  sellPrice,
  SLOT_NAME,
  SLOTS,
  STAT_KEYS,
  STAT_NAME,
  stats,
  TYPE_NAME,
  unequip,
  useAt,
  type Bag,
  type ItemDef,
  type Slot,
  type Stats,
} from './bag.ts';
import player from './data/player.json' with { type: 'json' };
import icons from './data/item-icons.json' with { type: 'json' };
import { fitText, safe, wrapText } from './touch.ts';

// ── 아이콘 ──
const ICON = icons as unknown as Record<string, [string, number, number, number, number]>;
/** 아이템 시트 3장 */
export const itemIconsReady = Promise.all([...new Set(Object.values(ICON).map((v) => v[0]))].map((p) => image(p).ready));
/** 아이콘을 (cx, cy) 가운데, box 안에 맞춰. dark = 검은 실루엣 (도감에서 아직 못 얻은 것) */
export function drawIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, box: number, dark = false) {
  const v = ICON[id];
  const img = v && image(v[0]).img;
  if (!img || !img.complete || !img.naturalWidth) return;
  const [, x, y, w, h] = v;
  const k = box / Math.max(w, h);
  const a = ctx.globalAlpha;
  if (dark) ctx.globalAlpha = a * 0.3; // 물고기·몬스터 실루엣처럼 옅게
  ctx.drawImage(dark ? darkOf(img) : img, x, y, w, h, cx - (w * k) / 2, cy - (h * k) / 2, w * k, h * k);
  ctx.globalAlpha = a;
}
/** 검은 실루엣판 — 그림마다 한 번 만든다 (ctx.filter 는 iOS 사파리 17 이하에서 무시된다) */
const darks = new Map<object, HTMLCanvasElement>();
export function darkOf(img: HTMLImageElement | HTMLCanvasElement): HTMLCanvasElement {
  let c = darks.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
    c.height = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillRect(0, 0, c.width, c.height);
    darks.set(img, c);
  }
  return c;
}
/** 냥코인 (그림이 없어 그린다) */
export function drawCoin(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.fillStyle = '#e8a92e';
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffd45a';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.74, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c98a1c';
  ctx.font = `bold ${r * 1.1}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('냥', cx, cy + r * 0.38);
  ctx.restore();
}
/** 희귀도 색 — 1 보통 · 2 고급 · 3 희귀 · 4 전설 */
export const RARE = [
  { name: '보통', color: '#b7a58f' },
  { name: '보통', color: '#b7a58f' },
  { name: '고급', color: '#59b25e' },
  { name: '희귀', color: '#3f95dd' },
  { name: '전설', color: '#ee9a24' },
];
const rareOf = (d: ItemDef) => RARE[d.rare ?? 1];

/** 능력치 한 줄: 공격 +8 · 이동 +15% · 가방 +6칸 */
export function statText(k: keyof Stats, v: number) {
  const unit = k === 'bag' ? '칸' : k === 'atk' || k === 'hp' || k === 'def' ? '' : '%';
  return `${STAT_NAME[k]} ${v > 0 ? '+' : '−'}${Math.abs(v)}${unit}`;
}

// ── 화면 상태 ──
type Pick = { at: 'bag'; i: number } | { at: 'slot'; slot: Slot } | null;
const bagView = { pick: null as Pick, sure: false, msg: '', msgT: 0 };
/** 열 때마다 처음 상태로 */
export function resetBagView() {
  Object.assign(bagView, { pick: null, sure: false, msg: '', msgT: 0 });
}
const say = (msg: string) => Object.assign(bagView, { msg, msgT: 2.2 });

type R = { x: number; y: number; w: number; h: number };
const inR = (r: R, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function bagLayout(w: number, h: number, size: number) {
  const wide = w >= h;
  const DW = wide ? 1000 : 540;
  const DH = wide ? 560 : 1040;
  const sf = safe();
  const aw = w - sf.l - sf.r;
  const ah = h - sf.t - sf.b;
  const k = Math.min(1.25, (aw - 24) / DW, (ah - 24) / DH);
  const cell = wide ? 72 : 76;
  const gap = 8;
  const grid = { x: wide ? 290 : 22, y: wide ? 112 : 290 };
  const cells = Array.from({ length: size }, (_, i): R => ({ x: grid.x + (i % 6) * (cell + gap), y: grid.y + Math.floor(i / 6) * (cell + gap), w: cell, h: cell }));
  const slots = SLOTS.map((_, i): R => (wide ? { x: 20 + (i % 2) * 133, y: 112 + Math.floor(i / 2) * 96, w: 117, h: 86 } : { x: 20 + i * 85, y: 100, w: 77, h: 86 }));
  const detail: R = wide ? { x: 780, y: 100, w: 200, h: 440 } : { x: 20, y: 716, w: 500, h: 306 };
  // 버튼: 가로 화면은 설명 아래에 위아래로, 세로 화면은 나란히
  const main: R = wide ? { x: detail.x, y: detail.y + detail.h - 96, w: detail.w, h: 44 } : { x: detail.x, y: detail.y + detail.h - 52, w: 240, h: 50 };
  const drop: R = wide ? { x: detail.x, y: detail.y + detail.h - 44, w: detail.w, h: 40 } : { x: detail.x + 260, y: detail.y + detail.h - 52, w: 240, h: 50 };
  return {
    wide,
    DW,
    DH,
    k,
    ox: sf.l + (aw - DW * k) / 2,
    oy: sf.t + (ah - DH * k) / 2,
    close: { x: DW - 84, y: 8, w: 76, h: 76 },
    cells,
    slots,
    statsBox: (wide ? { x: 20, y: 408, w: 250, h: 132 } : { x: 20, y: 196, w: 500, h: 72 }) as R,
    detail,
    main,
    drop,
    gridLabelY: grid.y - 12,
  };
}

/** 고른 것의 아이템 id (없으면 null) */
function picked(b: Bag): string | null {
  const p = bagView.pick;
  if (!p) return null;
  return p.at === 'bag' ? (b.slots[p.i]?.id ?? null) : (b.equip[p.slot] ?? null);
}
/** 고른 것에 맞는 큰 버튼 글자 (없으면 버튼 없음) */
function mainLabel(b: Bag): string | null {
  const id = picked(b);
  if (!id) return null;
  if (bagView.pick?.at === 'slot') return '벗기';
  if (isEquip(id)) return '장착';
  const u = ITEMS[id].use;
  if (!u) return null;
  return u.heal || u.buff ? '먹기' : '열기';
}

export type BagEnv = { canHeal: boolean; heal: (n: number) => void };
/**
 * 가방 화면을 눌렀다. 'close' = 닫기, 'changed' = 가방이 바뀜(저장), null = 고르기만
 */
export function bagTap(w: number, h: number, x: number, y: number, b: Bag, env: BagEnv): 'close' | 'changed' | null {
  const L = bagLayout(w, h, b.slots.length);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inR(L.close, px, py)) return 'close';
  const id = picked(b);
  if (id && inR(L.main, px, py) && mainLabel(b)) {
    bagView.sure = false;
    const p = bagView.pick!;
    if (p.at === 'slot') {
      const err = unequip(b, p.slot);
      if (err) return say(err), null;
      say(`${ITEMS[id].name}을(를) 벗었어요`);
      const i = b.slots.findIndex((s) => s?.id === id);
      bagView.pick = i >= 0 ? { at: 'bag', i } : null;
      return 'changed';
    }
    if (isEquip(id)) {
      const err = equipAt(b, p.i);
      if (err) return say(err), null;
      say(`${ITEMS[id].name}을(를) 장착했어요`);
      bagView.pick = { at: 'slot', slot: ITEMS[id].type as Slot };
      return 'changed';
    }
    const r = useAt(b, p.i, env.canHeal);
    say(r.msg);
    if (!r.ok) return null;
    if (r.heal) env.heal(r.heal);
    if (!b.slots[p.i]) bagView.pick = null;
    return 'changed';
  }
  if (id && bagView.pick?.at === 'bag' && inR(L.drop, px, py)) {
    if (!bagView.sure) {
      bagView.sure = true;
      return null;
    }
    const s = b.slots[bagView.pick.i]!;
    removeAt(b, bagView.pick.i);
    say(`${ITEMS[s.id].name}${s.n > 1 ? ` ${s.n}개` : ''}을(를) 버렸어요`);
    Object.assign(bagView, { pick: null, sure: false });
    return 'changed';
  }
  const i = L.cells.findIndex((r) => inR(r, px, py));
  const si = L.slots.findIndex((r) => inR(r, px, py));
  bagView.sure = false;
  if (i >= 0) bagView.pick = b.slots[i] ? { at: 'bag', i } : null;
  else if (si >= 0) bagView.pick = b.equip[SLOTS[si]] ? { at: 'slot', slot: SLOTS[si] } : null;
  return null;
}

/** 칸 하나: 바탕(희귀도 테두리) · 아이콘 · 개수 */
function itemCell(ctx: CanvasRenderingContext2D, r: R, id: string | null, n: number, on: boolean, label = '', labelColor = '#9a7b62') {
  const d = id ? ITEMS[id] : null;
  ctx.fillStyle = d ? '#ffffff' : 'rgba(120,85,55,0.08)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 14);
  ctx.fill();
  if (d) {
    ctx.strokeStyle = rareOf(d).color;
    ctx.lineWidth = d.rare && d.rare > 1 ? 3 : 1.5;
    ctx.stroke();
  }
  const iy = label ? r.y + (r.h - 20) / 2 + 2 : r.y + r.h / 2;
  if (id) drawIcon(ctx, id, r.x + r.w / 2, iy, Math.min(r.w, r.h - (label ? 22 : 0)) * 0.78);
  if (n > 1) {
    ctx.font = 'bold 17px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    const ny = label ? r.y + 22 : r.y + r.h - 6; // 아래에 글(값·칸 이름)이 있으면 개수는 위로
    ctx.strokeText(String(n), r.x + r.w - 6, ny);
    ctx.fillStyle = '#5b4a3f';
    ctx.fillText(String(n), r.x + r.w - 6, ny);
  }
  if (label) {
    ctx.textAlign = 'center';
    ctx.fillStyle = id ? labelColor : 'rgba(120,85,55,0.45)';
    fitText(ctx, label, r.x + r.w / 2, id ? r.y + r.h - 6 : r.y + r.h / 2 + 6, r.w - 8, id ? 14 : 17, id ? '' : 'bold ');
  }
  if (on) {
    ctx.strokeStyle = '#f08a3c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 16);
    ctx.stroke();
  }
}

/** 큰 버튼 */
function button(ctx: CanvasRenderingContext2D, r: R, text: string, style: 'main' | 'soft' | 'warn') {
  ctx.fillStyle = style === 'main' ? '#f5a05a' : style === 'warn' ? '#ef6b5e' : 'rgba(120,85,55,0.14)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fill();
  ctx.fillStyle = style === 'soft' ? '#5b4a3f' : '#fff';
  ctx.textAlign = 'center';
  fitText(ctx, text, r.x + r.w / 2, r.y + r.h / 2 + 7, r.w - 16, 20, 'bold ');
}

/** 쓰기 효과 설명 줄 */
export function useLines(d: ItemDef): string[] {
  const u = d.use;
  if (!u) return [];
  const out: string[] = [];
  if (u.heal) out.push(`체력 ${u.heal} 회복`);
  if (u.buff) out.push(`${u.time ?? 30}초 동안 ` + STAT_KEYS.filter((k) => u.buff![k]).map((k) => statText(k, u.buff![k]!)).join(' · '));
  if (u.open) out.push(u.open.length === 1 ? `열면 ${ITEMS[u.open[0]].name}` : `열면 ${u.open.every(isEquip) ? '장비' : '무언가'} 하나`);
  if (u.key) out.push(`${ITEMS[u.key].name} 필요`);
  if (u.coins) out.push(`냥코인 +${u.coins}`);
  return out;
}

export function drawBag(ctx: CanvasRenderingContext2D, w: number, h: number, b: Bag, dt: number) {
  const L = bagLayout(w, h, b.slots.length);
  bagView.msgT = Math.max(0, bagView.msgT - dt);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(0, 0, L.DW, L.DH, 28);
  ctx.fill();

  header(ctx, L, '🎒 가방', b.coins);

  const pick = bagView.pick;
  // 장비 칸
  SLOTS.forEach((slot, i) => itemCell(ctx, L.slots[i], b.equip[slot] ?? null, 1, pick?.at === 'slot' && pick.slot === slot, SLOT_NAME[slot]));

  // 능력치: 기본 + 장비·먹은 것 (더해진 만큼 초록)
  const st = stats(b);
  const base: Record<keyof Stats, number> = { atk: player.punch.damage, hp: player.maxHp, def: 0, speed: 100, luck: 0, reel: 0, line: 0, bag: 24 };
  const S = L.statsBox;
  const cols = L.wide ? 2 : 4;
  const cw = S.w / cols;
  STAT_KEYS.forEach((k, i) => {
    const x = S.x + (i % cols) * cw;
    const y = S.y + 22 + Math.floor(i / cols) * (L.wide ? 33 : 32);
    const pct = k === 'speed' || k === 'luck' || k === 'reel' || k === 'line';
    const total = base[k] + st[k];
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9a7b62';
    ctx.font = '17px system-ui, sans-serif';
    ctx.fillText(STAT_NAME[k], x, y);
    ctx.fillStyle = st[k] > 0 ? '#3e9a45' : st[k] < 0 ? '#d4574a' : '#5b4a3f';
    fitText(ctx, `${k === 'luck' || k === 'reel' || k === 'line' ? (total >= 0 ? '+' : '') : ''}${total}${pct ? '%' : k === 'bag' ? '칸' : ''}`, x + (L.wide ? 66 : 64), y, cw - 70, 18, 'bold ');
  });

  // 가방
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9a7b62';
  ctx.font = 'bold 18px system-ui, sans-serif';
  ctx.fillText(`가방 ${b.slots.filter(Boolean).length}/${b.slots.length}`, L.cells[0].x, L.gridLabelY);
  if (L.wide) ctx.fillText('장비', 20, L.gridLabelY);
  b.slots.forEach((s, i) => itemCell(ctx, L.cells[i], s?.id ?? null, s?.n ?? 0, pick?.at === 'bag' && pick.i === i));

  // 고른 것
  drawDetail(ctx, L, b);

  toast(ctx, L, bagView.msg, bagView.msgT);
  ctx.restore();
}

/** 설명 칸 바탕 + 아무것도 안 골랐을 때 안내 */
function detailBox(ctx: CanvasRenderingContext2D, D: R, empty: string | null) {
  ctx.fillStyle = 'rgba(120,85,55,0.07)';
  ctx.beginPath();
  ctx.roundRect(D.x, D.y, D.w, D.h, 18);
  ctx.fill();
  if (empty === null) return;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#b09a85';
  ctx.font = '18px system-ui, sans-serif';
  const lines = wrapText(ctx, empty, D.w - 40);
  lines.forEach((l, i) => ctx.fillText(l, D.x + D.w / 2, D.y + D.h / 2 - (lines.length - 1) * 12 + i * 24));
}

/**
 * 아이템 설명: 아이콘 · 이름 · 종류 · 능력치·효과 + extra 줄 · 설명 (bottom 위까지).
 * 가로 화면(좁은 칸)은 위에서 아래로 쌓고, 세로 화면은 아이콘 오른쪽에 글
 */
function itemInfo(ctx: CanvasRenderingContext2D, D: R, wide: boolean, id: string, extra: [string, string][], bottom: number) {
  const d = ITEMS[id];
  const r = rareOf(d);
  const icon = wide ? { x: D.x + D.w / 2, y: D.y + 54, s: 84 } : { x: D.x + 64, y: D.y + 64, s: 96 };
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(icon.x, icon.y, icon.s * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = r.color;
  ctx.lineWidth = 3;
  ctx.stroke();
  drawIcon(ctx, id, icon.x, icon.y, icon.s);
  const tx = wide ? D.x + D.w / 2 : D.x + 134;
  const tw = wide ? D.w - 16 : D.w - 146;
  let y = wide ? D.y + 136 : D.y + 44;
  ctx.textAlign = wide ? 'center' : 'left';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, d.name, tx, y, tw, 24, 'bold ');
  y += 26;
  ctx.fillStyle = r.color;
  fitText(ctx, `${TYPE_NAME[d.type]}${d.rare && d.rare > 1 ? ' · ' + r.name : ''}`, tx, y, tw, 16, 'bold ');
  y += 28;
  const lines: [string, string][] = [];
  if (d.stats) for (const k of STAT_KEYS) if (d.stats[k]) lines.push([statText(k, d.stats[k]!), d.stats[k]! > 0 ? '#3e9a45' : '#d4574a']);
  for (const l of useLines(d)) lines.push([l, '#3f7fbf']);
  for (const [text, color] of [...lines, ...extra]) {
    ctx.fillStyle = color;
    ctx.font = 'bold 17px system-ui, sans-serif';
    for (const l of wrapText(ctx, text, tw)) {
      ctx.fillText(l, tx, y);
      y += 22;
    }
  }
  // 설명 — 세로 화면은 아이콘 밑에서부터 넓게
  const dx = wide ? tx : D.x + 16;
  const dw = wide ? tw : D.w - 32;
  y = wide ? y + 6 : Math.max(y, D.y + 136) + 4;
  ctx.textAlign = wide ? 'center' : 'left';
  ctx.fillStyle = '#7a6656';
  ctx.font = '16px system-ui, sans-serif';
  for (const l of wrapText(ctx, d.desc, dw)) {
    if (y > bottom) break;
    ctx.fillText(l, dx, y);
    y += 21;
  }
}

function drawDetail(ctx: CanvasRenderingContext2D, L: ReturnType<typeof bagLayout>, b: Bag) {
  const id = picked(b);
  detailBox(ctx, L.detail, id ? null : '물건이나 장비를 누르면 여기에 설명이 나와요');
  if (!id) return;
  // 장비를 고르면 지금 낀 것과 비교
  const extra: [string, string][] = [];
  const d = ITEMS[id];
  const now = isEquip(id) && bagView.pick?.at === 'bag' ? b.equip[d.type as Slot] : undefined;
  if (now) {
    const diff = STAT_KEYS.map((k) => [k, (d.stats?.[k] ?? 0) - (ITEMS[now].stats?.[k] ?? 0)] as const).filter(([, v]) => v);
    extra.push([`지금 ${ITEMS[now].name}보다 ` + (diff.length ? diff.map(([k, v]) => statText(k, v)).join(' · ') : '같아요'), '#9a7b62']);
  }
  itemInfo(ctx, L.detail, L.wide, id, extra, L.main.y - 8);
  const label = mainLabel(b);
  if (label) button(ctx, L.main, label, 'main');
  if (bagView.pick?.at === 'bag') button(ctx, L.drop, bagView.sure ? '정말 버릴까요?' : '버리기', bagView.sure ? 'warn' : 'soft');
}

/** 창 위의 알림 한 줄 (가방 · 상점) */
function toast(ctx: CanvasRenderingContext2D, L: { wide: boolean; DW: number; DH: number; detail: R }, msg: string, msgT: number) {
  if (msgT <= 0) return;
  ctx.globalAlpha = Math.min(1, msgT / 0.3);
  ctx.font = 'bold 20px system-ui, sans-serif';
  const mw = Math.min(L.DW - 60, ctx.measureText(msg).width + 40);
  const my = L.wide ? L.DH - 70 : L.detail.y - 54;
  ctx.fillStyle = 'rgba(70,52,42,0.9)';
  ctx.beginPath();
  ctx.roundRect(L.DW / 2 - mw / 2, my, mw, 42, 21);
  ctx.fill();
  ctx.fillStyle = '#fff6d8';
  ctx.textAlign = 'center';
  fitText(ctx, msg, L.DW / 2, my + 28, mw - 24, 20, 'bold ');
  ctx.globalAlpha = 1;
}

/** 창 머리: 제목 · 냥코인 · ✕ */
function header(ctx: CanvasRenderingContext2D, L: { DW: number; close: R }, title: string, coins: number) {
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(title, 28, 58);
  const tw = ctx.measureText(title).width;
  drawCoin(ctx, 28 + tw + 34, 46, 15);
  ctx.fillStyle = '#c98a1c';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(`${coins.toLocaleString()} 냥코인`, 28 + tw + 56, 56);
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

// ── 고등어 상점 ── 필드 강아지마을 포탈(to: "shop"). 사기 = 상점 물건(data/shop.json stock)을 값에, 팔기 = 가방 물건을 절반 값에.
// 화면은 가방 창과 같은 틀: 제목·냥코인·✕ · 사기/팔기 탭 · 칸 (값 표시) · 고른 것 설명과 버튼
export const shopView = { mode: 'buy' as 'buy' | 'sell', pick: null as number | null, sure: false, msg: '', msgT: 0 };
export function resetShopView() {
  Object.assign(shopView, { mode: 'buy', pick: null, sure: false, msg: '', msgT: 0 });
}
const shopSay = (msg: string) => Object.assign(shopView, { msg, msgT: 2.2 });

export function shopLayout(w: number, h: number, size: number) {
  const L = bagLayout(w, h, 0);
  const cols = L.wide ? 9 : 6;
  const cw = 76;
  const ch = 90;
  const gap = 7;
  const gx = L.wide ? 20 : 22;
  const cells = Array.from({ length: size }, (_, i): R => ({ x: gx + (i % cols) * (cw + gap), y: 160 + Math.floor(i / cols) * (ch + gap), w: cw, h: ch }));
  const modes = [0, 1].map((i): R => ({ x: 20 + i * 146, y: 100, w: 138, h: 48 }));
  return { ...L, cells, modes };
}

/** 지금 칸에 보이는 것: 사기 = 상점 물건, 팔기 = 가방 칸 */
const shopItems = (b: Bag, stock: string[]): (string | null)[] => (shopView.mode === 'buy' ? stock : b.slots.map((s) => s?.id ?? null));

/** 상점을 눌렀다. 'close' = 닫기, 'changed' = 가방이 바뀜(저장) */
export function shopTap(w: number, h: number, x: number, y: number, b: Bag, stock: string[]): 'close' | 'changed' | null {
  const items = shopItems(b, stock);
  const L = shopLayout(w, h, items.length);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inR(L.close, px, py)) return 'close';
  const m = L.modes.findIndex((r) => inR(r, px, py));
  if (m >= 0) {
    Object.assign(shopView, { mode: m ? 'sell' : 'buy', pick: null, sure: false });
    return null;
  }
  const i = shopView.pick;
  const id = i === null ? null : items[i];
  const many = !!id && !isEquip(id);
  const main = inR(L.main, px, py);
  if (id && i !== null && (main || (many && inR(L.drop, px, py)))) {
    if (shopView.mode === 'buy') {
      const before = count(b, id);
      const err = buy(b, id, main ? 1 : 5);
      if (err) return shopSay(err), null;
      shopSay(`${ITEMS[id].name} ${count(b, id) - before}개를 샀어요`);
      return 'changed';
    }
    // 귀한 장비는 한 번 더 눌러야 판다
    if ((ITEMS[id].rare ?? 1) >= 3 && !shopView.sure) {
      shopView.sure = true;
      return null;
    }
    const before = b.coins;
    const k = sellAt(b, i, main ? 1 : b.slots[i]!.n);
    shopSay(`${ITEMS[id].name} ${k}개를 팔아 냥코인 +${b.coins - before}`);
    Object.assign(shopView, { sure: false, pick: b.slots[i] ? i : null });
    return 'changed';
  }
  const c = L.cells.findIndex((r) => inR(r, px, py));
  Object.assign(shopView, { pick: c >= 0 && items[c] ? c : null, sure: false });
  return null;
}

export function drawShop(ctx: CanvasRenderingContext2D, w: number, h: number, b: Bag, shop: { name: string; greet: string; stock: string[] }, dt: number) {
  const items = shopItems(b, shop.stock);
  const L = shopLayout(w, h, items.length);
  shopView.msgT = Math.max(0, shopView.msgT - dt);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(0, 0, L.DW, L.DH, 28);
  ctx.fill();
  header(ctx, L, `🐟 ${shop.name}`, b.coins);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9a7b62';
  fitText(ctx, shop.greet, 28, 88, L.DW - 140, 16);
  // 사기 / 팔기
  (['사기', '팔기'] as const).forEach((t, i) => {
    const r = L.modes[i];
    const on = (i === 0) === (shopView.mode === 'buy');
    ctx.fillStyle = on ? '#f5a05a' : 'rgba(120,85,55,0.1)';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    ctx.fill();
    ctx.fillStyle = on ? '#fff' : '#5b4a3f';
    ctx.textAlign = 'center';
    fitText(ctx, t, r.x + r.w / 2, r.y + 31, r.w - 16, 20, 'bold ');
  });
  // 칸: 아이콘 + 값 (사기 = 값, 팔기 = 받을 값)
  const buyMode = shopView.mode === 'buy';
  items.forEach((id, i) => {
    const n = buyMode ? 0 : (b.slots[i]?.n ?? 0);
    itemCell(ctx, L.cells[i], id, n, shopView.pick === i, id ? `${buyMode ? ITEMS[id].price : sellPrice(id)}냥` : '', '#c98a1c');
  });
  // 고른 것
  const i = shopView.pick;
  const id = i === null ? null : items[i];
  detailBox(ctx, L.detail, id ? null : buyMode ? '사고 싶은 물건을 누르세요' : '팔 물건을 누르세요');
  if (id && i !== null) {
    const n = b.slots[i]?.n ?? 0;
    const extra: [string, string][] = [[buyMode ? `값 ${ITEMS[id].price}냥 · 가진 것 ${count(b, id)}개` : `팔면 ${sellPrice(id)}냥 · 도감엔 남아요`, '#c98a1c']];
    itemInfo(ctx, L.detail, L.wide, id, extra, L.main.y - 8);
    if (buyMode) {
      button(ctx, L.main, `사기 ${ITEMS[id].price}냥`, 'main');
      if (!isEquip(id)) button(ctx, L.drop, `5개 사기 ${ITEMS[id].price * 5}냥`, 'soft');
    } else {
      button(ctx, L.main, shopView.sure ? '정말 팔까요?' : `1개 팔기 +${sellPrice(id)}냥`, shopView.sure ? 'warn' : 'main');
      if (!isEquip(id) && n > 1) button(ctx, L.drop, `모두 팔기 +${sellPrice(id) * n}냥`, 'soft');
    }
  }
  toast(ctx, L, shopView.msg, shopView.msgT);
  ctx.restore();
}
