// 도감 — 물고기 · 몬스터 · 아이템을 한 화면에. 필드 📖 도감 버튼 · 낚시터 도감 판 · B 키로 연다. ctx 는 CSS px.
// 디자인 좌표(가로 화면 1000×560 · 세로 화면 540×1040)로 그리고 화면에 맞춰 통째로 줄인다 (가방 창과 같은 방식).
//  위: 제목 · 갈래 3개(물고기 · 몬스터 · 아이템, 모은 수) · ✕ → 갈래 안의 탭 (낚시터 · 지역 · 종류) → 내용
//  물고기는 카드, 몬스터·아이템은 칸 + 고른 것 설명. 못 만난(못 얻은) 것은 검은 실루엣과 ???
import { darkOf, drawIcon, RARE, statText, useLines } from './bag-draw.ts';
import { dropTable, ITEMS, sellPrice, STAT_KEYS, TYPE_NAME, type ItemType } from './bag.ts';
import drops from './data/drops.json' with { type: 'json' };
import shop from './data/shop.json' with { type: 'json' };
import { ENEMY_DEFS } from './enemy.ts';
import { fishCard } from './fishing-draw.ts';
import { SPOTS, type Dex } from './fishing.ts';
import { ROOMS } from './iso.ts';
import { drawFrame, type Sheet } from './sheet.ts';
import { fitText, safe, wrapText } from './touch.ts';

export type BookCat = 'fish' | 'monster' | 'item';
/** 도감이 보여 줄 기록. sheet = 몬스터 시트 (아직 안 불러왔으면 null — 부르면 불러오기 시작한다) */
export type BookData = { fish: Dex; monsters: Record<string, number>; found: Record<string, number>; held: (id: string) => number; sheet: (kind: string) => Sheet | null };

// ── 갈래 · 탭 ──
type Tab = { id: string; name: string; ids: string[] };
const SPOT_TABS: Tab[] = Object.entries(SPOTS).map(([id, s]) => ({ id, name: s.short, ids: Object.keys(s.fish) }));
/** 몬스터 지역: 몬스터 id, 없으면 가족 이름(id 앞부분)으로 */
const GROUP_OF: Record<string, string> = {
  sword: 'rat', bow: 'rat', fat: 'rat',
  mushroom: 'forest', beetle: 'forest', sprout: 'forest', moss_boar: 'forest', acorn_squirrel: 'forest',
  frog: 'lake', slime: 'lake', sunflower: 'lake', reed_dragonfly: 'lake', lily_snail: 'lake',
  crab: 'sea', gull: 'sea', turtle: 'sea', otter: 'sea', coral_octopus: 'sea', anchor_seal: 'sea',
  golem: 'mountain', bat: 'mountain', ore_mole: 'mountain', quartz_ram: 'mountain',
  penguin: 'snow', gift: 'snow', snow_hare: 'snow', icicle_hedgehog: 'snow',
  scarab: 'desert', jackal: 'desert', cactus_armadillo: 'desert', sand_scorpion: 'desert',
  chestnut_raccoon: 'autumn', pumpkin_owl: 'autumn',
};
export const groupOf = (kind: string) => GROUP_OF[kind] ?? GROUP_OF[kind.split('_')[0]];
const MON_TABS: Tab[] = [
  ['rat', '쥐 해적단'], ['forest', '숲'], ['lake', '들판·호수'], ['sea', '바다'], ['mountain', '산·동굴'], ['snow', '눈'], ['desert', '사막'], ['autumn', '가을'],
].map(([id, name]) => ({ id, name, ids: Object.keys(ENEMY_DEFS).filter((k) => groupOf(k) === id) }));
const ITEM_TABS: Tab[] = (
  [
    ['equip', '장비', (t: ItemType) => ['weapon', 'head', 'body', 'accessory', 'rod', 'tool'].includes(t)],
    ['material', '재료', (t: ItemType) => t === 'material'],
    ['food', '먹을 것', (t: ItemType) => t === 'food'],
    ['curio', '잡동사니·보물', (t: ItemType) => t === 'junk' || t === 'treasure'],
    ['collect', '수집품', (t: ItemType) => t === 'relic' || t === 'mystery'],
  ] as const
).map(([id, name, ok]) => ({ id, name, ids: Object.keys(ITEMS).filter((k) => ok(ITEMS[k].type)) }));
export const BOOK_TABS: Record<BookCat, Tab[]> = { fish: SPOT_TABS, monster: MON_TABS, item: ITEM_TABS };
const CAT_NAME: Record<BookCat, string> = { fish: '🐟 물고기', monster: '👾 몬스터', item: '🎒 아이템' };
const CATS: BookCat[] = ['fish', 'monster', 'item'];

/** 갈래마다 모은 것 */
const got = (d: BookData, cat: BookCat, id: string) => (cat === 'fish' ? !!d.fish[id] : cat === 'monster' ? (d.monsters[id] ?? 0) > 0 : (d.found[id] ?? 0) > 0);

// ── 화면 상태 ──
export const bookView = { cat: 'fish' as BookCat, tab: { fish: SPOT_TABS[0].id, monster: MON_TABS[0].id, item: ITEM_TABS[0].id } as Record<BookCat, string>, pick: null as string | null };
/** 연다 — 낚시터에서 열면 그 낚시터 물고기 */
export function openBook(cat?: BookCat, tab?: string) {
  if (cat) bookView.cat = cat;
  if (cat && tab) bookView.tab[cat] = tab;
  bookView.pick = null;
}

type R = { x: number; y: number; w: number; h: number };
const inR = (r: R, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function bookLayout(w: number, h: number) {
  const wide = w >= h;
  const DW = wide ? 1000 : 540;
  const DH = wide ? 560 : 1040;
  const sf = safe();
  const aw = w - sf.l - sf.r;
  const ah = h - sf.t - sf.b;
  const k = Math.min(1.25, (aw - 24) / DW, (ah - 24) / DH);
  const cat = bookView.cat;
  const tabs = BOOK_TABS[cat];
  // 갈래: 가로 화면은 제목 줄 오른쪽에, 세로 화면은 제목 밑 한 줄
  const chips = CATS.map((_, i): R => (wide ? { x: 270 + i * 205, y: 20, w: 195, h: 50 } : { x: 20 + i * 168, y: 92, w: 160, h: 48 }));
  const tabRow = wide ? tabs.length : 4;
  const tabTop = wide ? 88 : 150;
  const tw = (DW - 40 - 6 * (tabRow - 1)) / tabRow;
  const tabRects = tabs.map((_, i): R => ({ x: 20 + (i % tabRow) * (tw + 6), y: tabTop + Math.floor(i / tabRow) * 62, w: tw, h: 56 }));
  const top = tabTop + Math.ceil(tabs.length / tabRow) * 62 + 10;
  const ids = tabs.find((t) => t.id === bookView.tab[cat])!.ids;
  // 칸 (몬스터 · 아이템) + 설명
  const cell = cat === 'monster' ? (wide ? 80 : 92) : wide ? 60 : 76;
  const gap = cat === 'monster' ? 6 : 7;
  const gw = wide ? 600 : 500;
  const cols = Math.floor((gw + gap) / (cell + gap));
  const cells = ids.map((_, i): R => ({ x: 20 + (i % cols) * (cell + gap), y: top + Math.floor(i / cols) * (cell + gap), w: cell, h: cell }));
  const detail: R = wide ? { x: 636, y: top, w: 344, h: DH - 20 - top } : { x: 20, y: 798, w: 500, h: 222 };
  return { wide, DW, DH, k, ox: sf.l + (aw - DW * k) / 2, oy: sf.t + (ah - DH * k) / 2, close: { x: DW - 84, y: 8, w: 76, h: 76 }, chips, tabs: tabRects, top, ids, cells, detail };
}

/** 도감을 눌렀다 — 'close' 면 닫는다 */
export function bookTap(w: number, h: number, x: number, y: number): 'close' | null {
  const L = bookLayout(w, h);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inR(L.close, px, py)) return 'close';
  const c = L.chips.findIndex((r) => inR(r, px, py));
  if (c >= 0) return openBook(CATS[c]), null;
  const t = L.tabs.findIndex((r) => inR(r, px, py));
  if (t >= 0) {
    bookView.tab[bookView.cat] = BOOK_TABS[bookView.cat][t].id;
    bookView.pick = null;
    return null;
  }
  if (bookView.cat !== 'fish') {
    const i = L.cells.findIndex((r) => inR(r, px, py));
    if (i >= 0) bookView.pick = L.ids[i];
  }
  return null;
}

// ── 얻는 곳 (아이템) — 한 번만 모은다 ──
const SOURCES: Record<string, { monsters: string[]; all: boolean; spots: string[]; shop: boolean; boxes: string[]; start: boolean }> = {};
for (const id of Object.keys(ITEMS)) SOURCES[id] = { monsters: [], all: false, spots: [], shop: false, boxes: [], start: false };
for (const k of Object.keys(ENEMY_DEFS)) for (const [id] of dropTable(k)) SOURCES[id].monsters.push(k);
for (const [id] of (drops as unknown as Record<string, [string, number][]>)._all) SOURCES[id].all = true;
for (const [sid, s] of Object.entries(SPOTS)) for (const [id] of s.salvage ?? []) SOURCES[id].spots.push(sid);
for (const id of shop.stock) SOURCES[id].shop = true;
for (const [bid, d] of Object.entries(ITEMS)) for (const id of d.use?.open ?? []) SOURCES[id].boxes.push(bid);
for (const id of ['equipment_01', 'equipment_25']) SOURCES[id].start = true;
/** 몬스터가 나오는 방 이름 */
const ROOMS_OF: Record<string, string[]> = {};
for (const r of Object.values(ROOMS)) for (const [k] of r.spawns) if (!(ROOMS_OF[k as string] ??= []).includes(r.name)) ROOMS_OF[k as string].push(r.name);

// ── 그리기 ──
export function drawBook(ctx: CanvasRenderingContext2D, w: number, h: number, d: BookData, t: number) {
  const L = bookLayout(w, h);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(0, 0, L.DW, L.DH, 28);
  ctx.fill();

  // 제목 · 전체 모은 수 · 닫기
  const all = CATS.flatMap((c) => BOOK_TABS[c].flatMap((tb) => tb.ids.map((id) => got(d, c, id))));
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText('📖 도감', 28, 58);
  const tw = ctx.measureText('📖 도감').width;
  ctx.fillStyle = '#9a7b62';
  ctx.font = '20px system-ui, sans-serif';
  ctx.fillText(`${all.filter(Boolean).length}/${all.length}`, 28 + tw + 10, 56);
  const c = L.close;
  ctx.fillStyle = 'rgba(120,85,55,0.14)';
  ctx.beginPath();
  ctx.arc(c.x + c.w / 2, c.y + c.h / 2, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✕', c.x + c.w / 2, c.y + c.h / 2 + 11);

  // 갈래 (모은 수)
  CATS.forEach((cat, i) => {
    const r = L.chips[i];
    const ids = BOOK_TABS[cat].flatMap((tb) => tb.ids);
    const n = ids.filter((id) => got(d, cat, id)).length;
    const on = cat === bookView.cat;
    ctx.fillStyle = on ? '#5b4a3f' : 'rgba(120,85,55,0.1)';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
    ctx.fill();
    ctx.fillStyle = on ? '#fff6d8' : '#5b4a3f';
    fitText(ctx, `${CAT_NAME[cat]} ${n}/${ids.length}`, r.x + r.w / 2, r.y + r.h / 2 + 7, r.w - 16, 19, 'bold ');
  });

  // 탭 (모은 수, 다 모으면 금색 ★)
  const tabs = BOOK_TABS[bookView.cat];
  tabs.forEach((tb, i) => {
    const r = L.tabs[i];
    const n = tb.ids.filter((id) => got(d, bookView.cat, id)).length;
    const on = tb.id === bookView.tab[bookView.cat];
    ctx.fillStyle = on ? '#f5a05a' : 'rgba(120,85,55,0.1)';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 16);
    ctx.fill();
    ctx.fillStyle = on ? '#fff' : '#5b4a3f';
    fitText(ctx, tb.name, r.x + r.w / 2, r.y + 26, r.w - 10, 22, 'bold ');
    ctx.fillStyle = on ? '#fff' : n === tb.ids.length ? '#e0a000' : '#9a7b62';
    fitText(ctx, `${n === tb.ids.length ? '★ ' : ''}${n}/${tb.ids.length}`, r.x + r.w / 2, r.y + 48, r.w - 10, 17);
  });

  if (bookView.cat === 'fish') {
    // 물고기 카드 (가로 3열 · 세로 2열)
    const cols = L.wide ? 3 : 2;
    const rows = Math.ceil(L.ids.length / cols);
    const cw = (L.DW - 40 - 12 * (cols - 1)) / cols;
    const ch = (L.DH - L.top - 20 - 12 * (rows - 1)) / rows;
    L.ids.forEach((id, i) =>
      fishCard(ctx, id, d.fish[id], { x: 20 + (i % cols) * (cw + 12), y: L.top + Math.floor(i / cols) * (ch + 12), w: cw, h: ch }, t + i * 0.37),
    );
  } else {
    L.ids.forEach((id, i) => {
      const r = L.cells[i];
      const ok = got(d, bookView.cat, id);
      const rare = bookView.cat === 'item' ? (ITEMS[id].rare ?? 1) : 1;
      ctx.fillStyle = ok ? '#ffffff' : 'rgba(120,85,55,0.08)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      if (ok && bookView.cat === 'item') {
        ctx.strokeStyle = RARE[rare].color;
        ctx.lineWidth = rare > 1 ? 3 : 1.5;
        ctx.stroke();
      }
      if (bookView.cat === 'item') drawIcon(ctx, id, r.x + r.w / 2, r.y + r.h / 2, r.w * 0.78, !ok);
      else monster(ctx, d, id, r.x + r.w / 2, r.y + r.h - 6, r.w * 0.8, r.h * 0.8, ok ? t : 0, !ok);
      if (bookView.pick === id) {
        ctx.strokeStyle = '#f08a3c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.roundRect(r.x - 2, r.y - 2, r.w + 4, r.h + 4, 14);
        ctx.stroke();
      }
    });
    detail(ctx, L, d, t);
  }
  ctx.restore();
}

/** 몬스터 대기 모습을 (cx, 발 y) 에 w×h 안에 맞춰. t 로 꿈틀, dark = 실루엣 */
function monster(ctx: CanvasRenderingContext2D, d: BookData, kind: string, cx: number, footY: number, bw: number, bh: number, t: number, dark: boolean) {
  const sh = d.sheet(kind);
  if (!sh) return;
  const f = sh.frames[0]?.[0];
  if (!f) return;
  const rs = sh.rowScale[0] ?? 1;
  const tall = (f.sh * rs) / sh.base;
  const wide = (Math.max(...sh.frames[0].map((v) => v.sw)) * rs) / sh.base;
  const size = Math.min(bh / tall, bw / wide);
  const col = Math.floor(t * 6) % sh.frames[0].length;
  const s = dark ? darkSheet(sh) : sh;
  ctx.save();
  if (dark) ctx.globalAlpha = 0.3;
  drawFrame(ctx, s, 0, dark ? 0 : col, cx, footY, size, 1, rs);
  ctx.restore();
}
const darkSheets = new Map<Sheet, Sheet>();
function darkSheet(sh: Sheet): Sheet {
  let v = darkSheets.get(sh);
  if (!v) darkSheets.set(sh, (v = { ...sh, img: darkOf(sh.img as HTMLImageElement | HTMLCanvasElement) }));
  return v;
}

/** 고른 것 설명 — 몬스터: 모습·이름·지역·체력/공격·쓰러뜨린 수·나오는 곳·떨어뜨리는 것, 아이템: 아이콘·이름·종류·효과·설명·값·얻는 곳·모은 수 */
function detail(ctx: CanvasRenderingContext2D, L: ReturnType<typeof bookLayout>, d: BookData, t: number) {
  const D = L.detail;
  ctx.fillStyle = 'rgba(120,85,55,0.07)';
  ctx.beginPath();
  ctx.roundRect(D.x, D.y, D.w, D.h, 18);
  ctx.fill();
  const id = bookView.pick;
  if (!id) {
    ctx.fillStyle = '#b09a85';
    ctx.font = '18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bookView.cat === 'monster' ? '몬스터를 누르면 여기에 나와요' : '아이템을 누르면 여기에 나와요', D.x + D.w / 2, D.y + D.h / 2);
    return;
  }
  const isMon = bookView.cat === 'monster';
  const ok = got(d, bookView.cat, id);
  // 그림 (왼쪽 위) · 글 (오른쪽)
  const pic = L.wide ? 120 : 110;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(D.x + 12, D.y + 12, pic, pic, 16);
  ctx.fill();
  if (isMon) monster(ctx, d, id, D.x + 12 + pic / 2, D.y + 12 + pic - 8, pic * 0.86, pic * 0.84, ok ? t : 0, !ok);
  else drawIcon(ctx, id, D.x + 12 + pic / 2, D.y + 12 + pic / 2, pic * 0.8, !ok);
  const tx = D.x + pic + 28;
  const tw = D.x + D.w - 12 - tx;
  let y = D.y + 40;
  ctx.textAlign = 'left';
  const line = (text: string, color: string, px = 16, bold = '') => {
    ctx.fillStyle = color;
    fitText(ctx, text, tx, y, tw, px, bold);
    y += px + 7;
  };
  if (isMon) {
    const e = ENEMY_DEFS[id];
    line(ok ? e.name : '???', '#5b4a3f', 23, 'bold ');
    line(MON_TABS.find((tb) => tb.id === groupOf(id))!.name, '#9a7b62', 16, 'bold ');
    line(`체력 ${e.hp} · 공격 ${e.damage}${e.arrowSpeed > 0 ? ' · 원거리' : ''}`, '#5b4a3f', 16);
    line(ok ? `쓰러뜨린 수 ${d.monsters[id]}` : '아직 만나지 못했어요', ok ? '#3e9a45' : '#b09a85', 16, 'bold ');
  } else {
    const it = ITEMS[id];
    const r = RARE[it.rare ?? 1];
    line(ok ? it.name : '???', '#5b4a3f', 23, 'bold ');
    line(`${TYPE_NAME[it.type]}${it.rare && it.rare > 1 ? ' · ' + r.name : ''}`, r.color, 16, 'bold ');
    line(ok ? `지금 ${d.held(id)}개 · 모은 수 ${d.found[id]}` : '아직 얻지 못했어요', ok ? '#3e9a45' : '#b09a85', 16, 'bold ');
    line(`팔면 ${sellPrice(id)}냥${SOURCES[id].shop ? ` · 상점 ${it.price}냥` : ''}`, '#c98a1c', 16, 'bold ');
  }
  // 아래쪽: 넓게 쓰는 줄들
  y = Math.max(y, D.y + pic + 34);
  const bx = D.x + 16;
  const bw = D.w - 32;
  const para = (text: string, color: string, px = 15, bold = '') => {
    ctx.fillStyle = color;
    ctx.font = `${bold}${px}px system-ui, sans-serif`;
    for (const l of wrapText(ctx, text, bw)) {
      if (y > D.y + D.h - 8) return;
      ctx.fillText(l, bx, y);
      y += px + 6;
    }
  };
  if (isMon) {
    const where = ROOMS_OF[id];
    para(`나오는 곳: ${where ? where.join(', ') : '아직 없어요 (가을 던전 준비 중)'}`, '#7a6656');
    para('떨어뜨리는 것', '#9a7b62', 15, 'bold ');
    const list = dropTable(id).map(([v]) => v);
    const s = L.wide ? 40 : 44;
    list.forEach((v, i) => {
      const x = bx + i * (s + 8);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(x, y - 6, s, s, 10);
      ctx.fill();
      if (d.found[v]) drawIcon(ctx, v, x + s / 2, y - 6 + s / 2, s * 0.8);
      else {
        ctx.fillStyle = '#c9b8a3';
        ctx.font = 'bold 20px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('?', x + s / 2, y - 6 + s / 2 + 7);
        ctx.textAlign = 'left';
      }
    });
  } else {
    const it = ITEMS[id];
    const fx = [...(it.stats ? STAT_KEYS.filter((k) => it.stats![k]).map((k) => statText(k, it.stats![k]!)) : []), ...useLines(it)];
    if (ok && fx.length) para(fx.join(' · '), '#3f7fbf', 15, 'bold ');
    if (ok) para(it.desc, '#7a6656');
    const s = SOURCES[id];
    const named = (k: string) => ((d.monsters[k] ?? 0) > 0 ? ENEMY_DEFS[k].name : '???');
    const where = [
      ...(s.start ? ['처음부터'] : []),
      ...(s.monsters.length ? [`몬스터: ${[...new Set(s.monsters.map(named))].join(', ')}`] : []),
      ...(s.all ? ['어느 몬스터나 드물게'] : []),
      ...(s.spots.length ? [`낚시: ${s.spots.map((v) => SPOTS[v].short).join(', ')}`] : []),
      ...(s.shop ? ['고등어 상점'] : []),
      ...(s.boxes.length ? [s.boxes.map((v) => (d.found[v] ? ITEMS[v].name : '???')).join(', ')] : []),
    ];
    para(`얻는 곳: ${where.length ? where.join(' · ') : '아직 몰라요'}`, '#9a7b62', 15);
  }
}

/** 지역이 없는 몬스터 (도감에 안 나온다) — verify 가 본다 */
export const ungrouped = () => Object.keys(ENEMY_DEFS).filter((k) => !groupOf(k));
