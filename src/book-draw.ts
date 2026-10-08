// 도감 — 물고기 · 몬스터 · 아이템 · 지도를 한 화면에. 필드 📖 도감 버튼 · 낚시터 도감 판 · B 키로 연다. ctx 는 CSS px.
// 디자인 좌표(가로 화면 1000×560 · 세로 화면 540×1040)로 그리고 화면에 맞춰 통째로 줄인다 (가방 창과 같은 방식).
//  위: 제목 · 갈래 4개(물고기 · 몬스터 · 아이템, 모은 수 · 지도, 장소 수) · ✕ → 갈래 안의 탭 (낚시터 · 지역 · 종류 · 장소 종류) → 내용
//  물고기는 카드, 몬스터·아이템은 칸 + 고른 것 설명. 못 만난(못 얻은) 것은 검은 실루엣과 ???
//  지도(2026-10-08 사용자 요청 — "마을 던전 컨텐츠 등등 한눈에 알아볼 수 있는 사이트맵"): 열린 구역 지도에 장소 점(종류 색 · 아이콘) + 옆 판
//  (전체 = 사이트맵 · 종류 탭 = 장소 목록 · 고른 곳 = 설명 — 나오는 몬스터 · 잡은 물고기 · 최고 기록 · 친구 하트)
import { image } from './assets.ts';
import { button, darkOf, drawIcon, RARE, statText, useLines } from './bag-draw.ts';
import { dropTable, ITEMS, sellPrice, STAT_KEYS, TYPE_NAME, type ItemType } from './bag.ts';
import shop from './data/shop.json' with { type: 'json' };
import { ENEMY_DEFS } from './enemy.ts';
import { FIELD, tileOpen, warpLocked } from './field.ts';
import { fishCard } from './fishing-draw.ts';
import { FISH, SPOTS, type Dex } from './fishing.ts';
import { ROOMS } from './iso.ts';
import { PLACE_COLOR, PLACE_ICON, PLACE_NAME, placeKind, type PlaceKind } from './places.ts';
import { drawFrame, type Sheet } from './sheet.ts';
import { ROOMS_OF, SOURCES } from './sources.ts';
import { fitText, safe, wrapText } from './touch.ts';
import { FRIENDS, hearts, knownRecipes, RECIPES, type VillageSave } from './village.ts';

export type BookCat = 'fish' | 'monster' | 'item' | 'map';
/** 도감이 보여 줄 기록. sheet = 몬스터 시트 (아직 안 불러왔으면 null — 부르면 불러오기 시작한다).
 *  지도 갈래: records 미니게임 기록 · village 고양이마을 기록 · here 고양이가 있는 곳 (필드 지도 px) */
export type BookData = {
  fish: Dex;
  monsters: Record<string, number>;
  found: Record<string, number>;
  held: (id: string) => number;
  sheet: (kind: string) => Sheet | null;
  records: Record<string, number | null>;
  village: VillageSave;
  here: number[];
  /** 지도의 장소로 바로 가기 (필드 · 마을 · 낚시터에서만 — 없으면 버튼이 안 보인다) */
  travel?: (id: string) => void;
};

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

// ── 지도 (사이트맵) — 열린 구역의 포탈을 종류별로. 잠긴 구역은 지도 틀 밖이라 개수만 센다 ──
type Place = { id: string; label: string; to: string; kind: PlaceKind; at: number[]; open: boolean };
const PLACES: Place[] = FIELD.warps.map((w) => ({ id: w.id, label: w.label, to: w.to, kind: placeKind(w.to, w.id), at: w.at, open: !warpLocked(w) }));
const PLACE: Record<string, Place> = Object.fromEntries(PLACES.map((p) => [p.id, p]));
const KIND_ICON = PLACE_ICON;
const KIND_NAME = PLACE_NAME;
/** 미니게임 — 이름 · 한 줄 설명 · 최고 기록 글 */
const MINI_INFO: Record<string, { name: string; about: string; best: (v: number) => string }> = {
  maze: { name: '피라미드 미로찾기', about: '횃불이 닿는 길만 보여요. 냥코인과 보물 상자를 찾아 빨리 탈출할수록 보너스', best: (v) => `${v}초` },
  sandboard: { name: '모래 미끄럼틀 샌드보드', about: '630m 모래 비탈을 미끄러져 내려가요. 바위 · 선인장을 피하고 점프대로 날아올라요', best: (v) => `${v}점` },
  timber: { name: '장작 패기', about: '나무를 왼쪽 · 오른쪽에서 패요. 가지가 내 쪽으로 내려오면 콩!', best: (v) => `${v}토막` },
  chase: { name: '다람쥐 잡기', about: '60초 동안 수풀에서 튀어나오는 다람쥐를 쫓아가 잡아요. 황금 다람쥐는 3점', best: (v) => `${v}점` },
};
/** 장소 이름 — 던전 · 낚시터는 안의 이름, 미니게임 · 상점은 그 이름, 마을은 포탈 이름 */
const placeName = (p: Place) =>
  p.kind === 'dungeon' ? ROOMS[p.to].name : p.kind === 'fish' ? SPOTS[p.to].name : p.kind === 'mini' ? MINI_INFO[p.to].name : p.kind === 'shop' ? shop.name : p.label;
const openIds = (kinds: PlaceKind[]) => PLACES.filter((p) => p.open && kinds.includes(p.kind)).map((p) => p.id);
const MAP_TABS: Tab[] = [
  { id: 'all', name: '전체', ids: openIds(['village', 'shop', 'dungeon', 'fish', 'mini']) },
  { id: 'home', name: '마을·상점', ids: openIds(['village', 'shop']) },
  { id: 'dungeon', name: '던전', ids: openIds(['dungeon']) },
  { id: 'fish', name: '낚시터', ids: openIds(['fish']) },
  { id: 'mini', name: '미니게임', ids: openIds(['mini']) },
];
/** 지도 틀 = 열린 조각을 감싼 사각형 (필드 지도 px) */
const BOX = (() => {
  const [C, RW] = FIELD.grid;
  const [W, H] = FIELD.size;
  let [c0, r0, c1, r1] = [C, RW, 0, 0];
  for (let r = 0; r < RW; r++)
    for (let c = 0; c < C; c++) if (tileOpen(r, c)) [c0, r0, c1, r1] = [Math.min(c0, c), Math.min(r0, r), Math.max(c1, c + 1), Math.max(r1, r + 1)];
  return { x0: (c0 * W) / C, y0: (r0 * H) / RW, x1: (c1 * W) / C, y1: (r1 * H) / RW };
})();
const MINIMAP = image('world/minimap');
const kindCount = (k: PlaceKind) => openIds([k]).length;
const lockedCount = (k: PlaceKind) => PLACES.filter((p) => !p.open && p.kind === k).length;
/** 열린 낚시터의 물고기 · 열린 던전의 몬스터 종류 */
const openFish = () => MAP_TABS[3].ids.flatMap((id) => Object.keys(SPOTS[PLACE[id].to].fish));
const roomKinds = (room: string) => [...new Set(ROOMS[room].spawns.map(([k]) => k as string))];
const openMonsters = () => [...new Set(MAP_TABS[2].ids.flatMap((id) => roomKinds(PLACE[id].to)))];
const friendsMade = (v: VillageSave) => FRIENDS.filter((fr) => hearts(v.friends[fr.id].pts) >= 1).length;
/** 전체 탭의 사이트맵 — 줄을 누르면 그 탭으로 (필드 · 잠긴 곳은 글만) */
const SITE: { icon: string; tab?: string; title: () => string; line: (d: BookData) => string }[] = [
  { icon: '🏡', tab: 'home', title: () => '마을 · 고양이마을', line: (d) => `요리 · 친구 사귀기 · 친해진 친구 ${friendsMade(d.village)}/${FRIENDS.length} · 요리법 ${knownRecipes(d.village).length}/${RECIPES.length}` },
  { icon: '🛒', tab: 'home', title: () => `상점 · ${shop.name}`, line: () => `강아지마을 · 물건 ${shop.stock.length}가지 · 요리 재료도` },
  {
    icon: '⚔️',
    tab: 'dungeon',
    title: () => `던전 ${kindCount('dungeon')}곳`,
    line: (d) => `웨이브 전투 · 기술 · 드롭 · 쓰러뜨린 몬스터 ${openMonsters().filter((k) => (d.monsters[k] ?? 0) > 0).length}/${openMonsters().length}종`,
  },
  { icon: '🎣', tab: 'fish', title: () => `낚시터 ${kindCount('fish')}곳`, line: (d) => `잡은 물고기 ${openFish().filter((k) => d.fish[k]).length}/${openFish().length}종 · 가끔 보물 건지기` },
  {
    icon: '🎮',
    tab: 'mini',
    title: () => `미니게임 ${kindCount('mini')}곳`,
    line: (d) => `미로 · 샌드보드 · 장작 패기 · 다람쥐 잡기 · 기록 ${MAP_TABS[4].ids.filter((id) => d.records[PLACE[id].to] != null).length}/${kindCount('mini')}`,
  },
  { icon: '🌍', title: () => '필드', line: () => '숲 도끼질 · 부스럭 수풀 · 다람쥐 · 바다 한가운데 고래' },
  { icon: '🕳️', title: () => `동굴 ${PLACES.filter((p) => p.kind === 'cave').length}곳 · 준비 중`, line: () => `열린 구역에 ${PLACES.filter((p) => p.open && p.kind === 'cave').length}곳 — 던전이 아니라 나중에 다른 놀이가 들어와요` },
  { icon: '🔒', title: () => '잠긴 지역 · 준비 중', line: () => `잠긴 던전 ${lockedCount('dungeon')} · 낚시터 ${lockedCount('fish')} · 지도의 회색 점 ${PLACES.filter((p) => p.open && p.kind === 'none').length}곳은 아직 연결 전` },
];

const BOOK_TABS: Record<BookCat, Tab[]> = { fish: SPOT_TABS, monster: MON_TABS, item: ITEM_TABS, map: MAP_TABS };
const CAT_NAME: Record<BookCat, string> = { fish: '🐟 물고기', monster: '👾 몬스터', item: '🎒 아이템', map: '🗺️ 지도' };
const CATS: BookCat[] = ['fish', 'monster', 'item', 'map'];

/** 갈래마다 모은 것 (지도는 센 것 없음) */
const got = (d: BookData, cat: BookCat, id: string) =>
  cat === 'fish' ? !!d.fish[id] : cat === 'monster' ? (d.monsters[id] ?? 0) > 0 : cat === 'item' ? (d.found[id] ?? 0) > 0 : true;

// ── 화면 상태 ──
export const bookView = {
  cat: 'fish' as BookCat,
  tab: { fish: SPOT_TABS[0].id, monster: MON_TABS[0].id, item: ITEM_TABS[0].id, map: MAP_TABS[0].id } as Record<BookCat, string>,
  pick: null as string | null,
  /** 지도에서 "이동" 을 누른 장소 (포탈 id) */
  go: null as string | null,
};
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
  const chips = CATS.map((_, i): R => (wide ? { x: 248 + i * 166, y: 20, w: 158, h: 50 } : { x: 20 + i * 126, y: 92, w: 120, h: 48 }));
  const tabRow = wide || cat === 'map' ? tabs.length : 4;
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
  // 지도 갈래: 지도(열린 구역 — 가로 화면은 왼쪽, 세로 화면은 위) + 옆 판(사이트맵 · 장소 목록 · 설명)
  const ms = Math.min((wide ? 600 : 500) / (BOX.x1 - BOX.x0), (wide ? DH - 20 - top : 340) / (BOX.y1 - BOX.y0));
  const map: R = { x: 20, y: top, w: (BOX.x1 - BOX.x0) * ms, h: (BOX.y1 - BOX.y0) * ms };
  const board: R = wide ? detail : { x: 20, y: map.y + map.h + 14, w: 500, h: DH - 20 - (map.y + map.h + 14) };
  const site = bookView.tab.map === 'all';
  const rowH = site ? Math.min(46, Math.floor((board.h - 50) / SITE.length)) : 36; // 사이트맵 줄 여덟이 판 안에 들어가게
  const rows = (cat !== 'map' || bookView.pick ? [] : site ? SITE : ids).map((_, i): R => ({ x: board.x + 10, y: board.y + 44 + i * rowH, w: board.w - 20, h: rowH - 5 }));
  const back: R = { x: board.x + board.w - 96, y: board.y + 10, w: 84, h: 38 };
  const go: R = { x: board.x + 16, y: board.y + board.h - 66, w: board.w - 32, h: 52 };
  return { wide, DW, DH, k, ox: sf.l + (aw - DW * k) / 2, oy: sf.t + (ah - DH * k) / 2, close: { x: DW - 84, y: 8, w: 76, h: 76 }, chips, tabs: tabRects, top, ids, cells, detail, map, board, rows, back, go };
}
type BL = ReturnType<typeof bookLayout>;
/** 필드 지도 px → 지도 그림 위 (디자인 좌표) */
const onMap = (M: R, x: number, y: number): [number, number] => [M.x + ((x - BOX.x0) / (BOX.x1 - BOX.x0)) * M.w, M.y + ((y - BOX.y0) / (BOX.y1 - BOX.y0)) * M.h];
/** 지도 위 가장 가까운 장소 점 (18 안) */
function placeAt(L: BL, px: number, py: number): string | null {
  let best: string | null = null;
  let bd = 18;
  for (const id of MAP_TABS[0].ids) {
    const [x, y] = onMap(L.map, PLACE[id].at[0], PLACE[id].at[1]);
    const dd = Math.hypot(x - px, y - py);
    if (dd < bd) [best, bd] = [id, dd];
  }
  return best;
}
/** 지도 갈래의 장소 점 · 판의 줄 · 목록으로 버튼 (CSS px) — 검증용 */
export function mapPoints(w: number, h: number) {
  const L = bookLayout(w, h);
  const css = (x: number, y: number) => ({ x: L.ox + x * L.k, y: L.oy + y * L.k });
  return {
    places: Object.fromEntries(MAP_TABS[0].ids.map((id) => [id, css(...onMap(L.map, PLACE[id].at[0], PLACE[id].at[1]))])),
    rows: L.rows.map((r) => css(r.x + r.w / 2, r.y + r.h / 2)),
    back: css(L.back.x + L.back.w / 2, L.back.y + L.back.h / 2),
    go: css(L.go.x + L.go.w / 2, L.go.y + L.go.h / 2),
  };
}
/** 지도 설명의 "이동" 버튼이 보이는가 (열린 장소 · 갈 수 있는 장면) */
const canGo = (d: BookData, id: string | null) => !!(d.travel && id && PLACE[id]?.open && PLACE[id].to);

/** 도감을 눌렀다 — 'close' 면 닫는다, 'travel' 이면 bookView.go 의 장소로 간다 (main 이 travel 을 부른다) */
export function bookTap(w: number, h: number, x: number, y: number, d?: BookData): 'close' | 'travel' | null {
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
  if (bookView.cat === 'map') {
    // 지도의 점 → 그곳 설명, 판: 목록으로 · 사이트맵 줄 → 그 탭 · 장소 줄 → 그곳 설명
    const hit = placeAt(L, px, py);
    if (hit) bookView.pick = hit;
    else if (bookView.pick) {
      if (inR(L.back, px, py)) bookView.pick = null;
      else if (d && canGo(d, bookView.pick) && inR(L.go, px, py)) {
        bookView.go = bookView.pick;
        return 'travel';
      }
    } else {
      const i = L.rows.findIndex((r) => inR(r, px, py));
      if (i >= 0 && bookView.tab.map === 'all') bookView.tab.map = SITE[i].tab ?? 'all';
      else if (i >= 0) bookView.pick = L.ids[i];
    }
    return null;
  }
  if (bookView.cat !== 'fish') {
    const i = L.cells.findIndex((r) => inR(r, px, py));
    if (i >= 0) bookView.pick = L.ids[i];
  }
  return null;
}

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
  const all = CATS.filter((c) => c !== 'map').flatMap((c) => BOOK_TABS[c].flatMap((tb) => tb.ids.map((id) => got(d, c, id))));
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
    fitText(ctx, cat === 'map' ? `${CAT_NAME.map} ${MAP_TABS[0].ids.length}곳` : `${CAT_NAME[cat]} ${n}/${ids.length}`, r.x + r.w / 2, r.y + r.h / 2 + 7, r.w - 16, 19, 'bold ');
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
    const place = bookView.cat === 'map';
    ctx.fillStyle = on ? '#fff' : !place && n === tb.ids.length ? '#e0a000' : '#9a7b62';
    fitText(ctx, place ? `${tb.ids.length}곳` : `${n === tb.ids.length ? '★ ' : ''}${n}/${tb.ids.length}`, r.x + r.w / 2, r.y + 48, r.w - 10, 17);
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
  } else if (bookView.cat === 'map') {
    drawMap(ctx, L, d, t);
    mapBoard(ctx, L, d, t);
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
    const where = ROOMS_OF[id]?.map((rid) => ROOMS[rid].name);
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
      ...(s.cook ? ['고양이마을 요리 가판대'] : []),
      ...(s.fish ? ['낚시 (물고기를 낚으면)'] : []),
      ...(s.forest ? ['숲 도끼질 · 부스럭 수풀'] : []),
      ...(s.chase ? ['다람쥐 잡기'] : []),
      ...(s.gift.length ? [`마을 친구 선물: ${s.gift.join(', ')}`] : []),
      ...(s.boxes.length ? [s.boxes.map((v) => (d.found[v] ? ITEMS[v].name : '???')).join(', ')] : []),
    ];
    para(`얻는 곳: ${where.length ? where.join(' · ') : '아직 몰라요'}`, '#9a7b62', 15);
  }
}

/** 지도 — 열린 구역 그림 · 닫힌 조각 · 준비 중(흐린 점) · 장소 점(지금 탭이 아니면 흐리게) · 고양이 · 고른 곳 이름 */
function drawMap(ctx: CanvasRenderingContext2D, L: BL, d: BookData, t: number) {
  const M = L.map;
  const [W, H] = FIELD.size;
  const [COLS, ROWS] = FIELD.grid;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(M.x, M.y, M.w, M.h, 16);
  ctx.clip();
  const im = MINIMAP.img;
  if (im.complete && im.naturalWidth) {
    const k = im.naturalWidth / W;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(im, BOX.x0 * k, BOX.y0 * k, (BOX.x1 - BOX.x0) * k, (BOX.y1 - BOX.y0) * k, M.x, M.y, M.w, M.h);
  } else {
    ctx.fillStyle = '#9cc9dd';
    ctx.fillRect(M.x, M.y, M.w, M.h);
  }
  ctx.fillStyle = 'rgba(22, 28, 46, 0.62)';
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      if (tileOpen(r, c)) continue;
      const [x0, y0] = onMap(M, (c * W) / COLS, (r * H) / ROWS);
      const [x1, y1] = onMap(M, ((c + 1) * W) / COLS, ((r + 1) * H) / ROWS);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  ctx.restore();
  ctx.strokeStyle = 'rgba(120,85,55,0.35)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(M.x, M.y, M.w, M.h, 16);
  ctx.stroke();
  for (const p of PLACES) {
    if (!p.open || (p.kind !== 'none' && p.kind !== 'cave')) continue;
    const [x, y] = onMap(M, p.at[0], p.at[1]);
    if (p.kind === 'cave') {
      marker(ctx, p, x, y, 0.55, false, t);
      continue;
    }
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(235,235,235,0.75)';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(70,52,42,0.6)';
    ctx.stroke();
  }
  const tab = MAP_TABS.find((tb) => tb.id === bookView.tab.map)!;
  const pick = bookView.pick ? PLACE[bookView.pick] : null;
  for (const id of MAP_TABS[0].ids) if (PLACE[id] !== pick) marker(ctx, PLACE[id], ...onMap(M, PLACE[id].at[0], PLACE[id].at[1]), tab.ids.includes(id) ? 1 : 0.32, false, t);
  // 고양이 (여기)
  const [hx, hy] = d.here;
  if (hx >= BOX.x0 && hx <= BOX.x1 && hy >= BOX.y0 && hy <= BOX.y1) {
    const [x, y] = onMap(M, hx, hy);
    ctx.beginPath();
    ctx.arc(x, y, 6 + Math.sin(t * 5), 0, Math.PI * 2);
    ctx.fillStyle = '#ff8a2a';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    mapTag(ctx, '여기', x, y + 20, M, 'rgba(240,120,40,0.92)');
  }
  if (pick) {
    const [x, y] = onMap(M, pick.at[0], pick.at[1]);
    marker(ctx, pick, x, y, 1, true, t);
    mapTag(ctx, placeName(pick), x, y - 28, M, 'rgba(70,52,42,0.9)');
  }
}
/** 장소 점 — 종류 색 동그라미 + 아이콘 (고른 곳은 크게 · 고리) */
function marker(ctx: CanvasRenderingContext2D, p: Place, x: number, y: number, alpha: number, big: boolean, t: number) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (big) {
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, 19 + 2.5 * Math.sin(t * 4), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, big ? 15 : 11, 0, Math.PI * 2);
  ctx.fillStyle = PLACE_COLOR[p.kind];
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(70,52,42,0.9)';
  ctx.stroke();
  ctx.font = `${big ? 17 : 12}px "Segoe UI Emoji", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000';
  ctx.fillText(KIND_ICON[p.kind], x, y + 1);
  ctx.restore();
}
/** 지도 위 이름표 (지도 안으로 당긴다) */
function mapTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, M: R, bg: string) {
  ctx.font = 'bold 14px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 18;
  const cx = Math.max(M.x + w / 2 + 4, Math.min(M.x + M.w - w / 2 - 4, x));
  const cy = Math.max(M.y + 16, Math.min(M.y + M.h - 16, y));
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2, cy - 13, w, 26, 13);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, cy + 5);
}
/** 목록 줄 오른쪽에 붙는 짧은 글 — 포탈 자리 · 잡은 물고기 · 최고 기록 · 친구 */
function placeNote(p: Place, d: BookData) {
  if (p.kind === 'fish') {
    const ids = Object.keys(SPOTS[p.to].fish);
    return `${ids.filter((k) => d.fish[k]).length}/${ids.length}종 · ${p.label}`;
  }
  if (p.kind === 'mini') {
    const v = d.records[p.to];
    return v == null ? `기록 없음 · ${p.label}` : `최고 ${MINI_INFO[p.to].best(v)}`;
  }
  if (p.kind === 'village') return `친구 ${friendsMade(d.village)}/${FRIENDS.length}`;
  return p.label;
}
/** 지도 옆 판 — 전체: 사이트맵 · 종류 탭: 장소 목록 · 고른 곳: 설명 */
function mapBoard(ctx: CanvasRenderingContext2D, L: BL, d: BookData, t: number) {
  const B = L.board;
  ctx.fillStyle = 'rgba(120,85,55,0.07)';
  ctx.beginPath();
  ctx.roundRect(B.x, B.y, B.w, B.h, 18);
  ctx.fill();
  if (bookView.pick) return placeDetail(ctx, L, PLACE[bookView.pick], d, t);
  const site = bookView.tab.map === 'all';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#9a7b62';
  fitText(ctx, site ? '한눈에 보기 · 줄을 누르면 그 장소들만' : '누르면 설명 · 지도의 점을 눌러도 돼요', B.x + 16, B.y + 30, B.w - 32, 16, 'bold ');
  if (site) {
    SITE.forEach((row, i) => {
      const r = L.rows[i];
      ctx.fillStyle = row.tab ? '#ffffff' : 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, 12);
      ctx.fill();
      ctx.textAlign = 'left';
      ctx.fillStyle = '#000';
      ctx.font = '19px "Segoe UI Emoji", system-ui, sans-serif';
      ctx.fillText(row.icon, r.x + 9, r.y + r.h / 2 + 7);
      ctx.fillStyle = '#5b4a3f';
      fitText(ctx, row.title(), r.x + 40, r.y + 17, r.w - 66, 16, 'bold ');
      ctx.fillStyle = '#9a7b62';
      fitText(ctx, row.line(d), r.x + 40, r.y + r.h - 6, r.w - 66, 13);
      if (row.tab) {
        ctx.fillStyle = '#c9a98a';
        ctx.font = 'bold 22px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('›', r.x + r.w - 10, r.y + r.h / 2 + 8);
      }
    });
    return;
  }
  L.ids.forEach((id, i) => {
    const p = PLACE[id];
    const r = L.rows[i];
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 10);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r.x + 17, r.y + r.h / 2, 11, 0, Math.PI * 2);
    ctx.fillStyle = PLACE_COLOR[p.kind];
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.font = '12px "Segoe UI Emoji", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(KIND_ICON[p.kind], r.x + 17, r.y + r.h / 2 + 4);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5b4a3f';
    fitText(ctx, placeName(p), r.x + 36, r.y + r.h / 2 + 6, r.w * 0.56 - 36, 16, 'bold ');
    ctx.textAlign = 'right';
    ctx.fillStyle = '#9a7b62';
    fitText(ctx, placeNote(p, d), r.x + r.w - 10, r.y + r.h / 2 + 5, r.w * 0.44 - 14, 13);
  });
}
/** 고른 곳 설명 — 머리(점 · 이름 · 종류 · 포탈 자리) + 종류마다: 던전 = 나오는 몬스터, 낚시터 = 물고기, 미니게임 = 최고 기록, 마을 = 친구 하트, 상점 = 물건 */
function placeDetail(ctx: CanvasRenderingContext2D, L: BL, p: Place, d: BookData, t: number) {
  const B = L.board;
  button(ctx, L.back, '‹ 목록', 'soft');
  marker(ctx, p, B.x + 34, B.y + 36, 1, false, t);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, placeName(p), B.x + 56, B.y + 34, B.w - 56 - 104, 21, 'bold ');
  ctx.fillStyle = '#9a7b62';
  fitText(ctx, `${KIND_NAME[p.kind]} · ${p.label}`, B.x + 56, B.y + 56, B.w - 56 - 104, 14, 'bold ');
  let y = B.y + 92;
  const bx = B.x + 16;
  const bw = B.w - 32;
  const go = canGo(d, p.id);
  const bottom = B.y + B.h - (go ? 78 : 8); // 이동 버튼 위에서 멈춘다
  const para = (text: string, color: string, px = 15, bold = '') => {
    ctx.fillStyle = color;
    ctx.font = `${bold}${px}px system-ui, sans-serif`;
    for (const l of wrapText(ctx, text, bw)) {
      if (y > bottom) return;
      ctx.fillText(l, bx, y);
      y += px + 6;
    }
    y += 4;
  };
  if (p.kind === 'dungeon') {
    const kinds = roomKinds(p.to);
    const seen = kinds.filter((k) => (d.monsters[k] ?? 0) > 0);
    para('몰려오는 웨이브를 다 깨면 클리어 · 중간과 마지막엔 👑 정예. 생선뼈를 모아 기술을 배워요', '#7a6656');
    para(`나오는 몬스터 · 쓰러뜨린 종 ${seen.length}/${kinds.length}`, '#9a7b62', 15, 'bold ');
    const s = 54;
    kinds.forEach((k, i) => {
      const x = bx + i * (s + 8);
      const ok = seen.includes(k);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(x, y - 8, s, s, 10);
      ctx.fill();
      monster(ctx, d, k, x + s / 2, y - 8 + s - 4, s * 0.86, s * 0.84, ok ? t : 0, !ok);
    });
    y += s + 6;
    para(kinds.map((k) => (seen.includes(k) ? ENEMY_DEFS[k].name : '???')).join(' · '), '#5b4a3f', 14);
  } else if (p.kind === 'fish') {
    const ids = Object.keys(SPOTS[p.to].fish);
    para(`물고기 ${ids.length}종 · 잡은 종 ${ids.filter((k) => d.fish[k]).length}/${ids.length}`, '#9a7b62', 15, 'bold ');
    para(ids.map((k) => (d.fish[k] ? FISH[k].name : '???')).join(' · '), '#5b4a3f', 15, 'bold ');
    para('가끔 가라앉은 물건을 건져요 · 낚은 물고기는 요리 재료 생선이 돼요', '#7a6656', 14);
  } else if (p.kind === 'mini') {
    const info = MINI_INFO[p.to];
    const v = d.records[p.to];
    para(info.about, '#7a6656');
    para(v == null ? '최고 기록: 아직 없어요' : `최고 기록: ${info.best(v)}`, v == null ? '#b09a85' : '#3e9a45', 16, 'bold ');
    if (p.to === 'maze' && d.records.whale != null) para(`고래 배 속 미로: ${d.records.whale}초`, '#3f7fbf', 15, 'bold ');
  } else if (p.kind === 'village') {
    para(`요리 가판대에서 요리하고, 친구 ${FRIENDS.length}에게 먹여 주거나 놀아 주며 친해져요. 가끔 먹고 싶은 요리를 부탁해요`, '#7a6656');
    para(`친해진 친구 ${friendsMade(d.village)}/${FRIENDS.length} · 요리법 ${knownRecipes(d.village).length}/${RECIPES.length}`, '#3e9a45', 16, 'bold ');
    // 친구 하트 — 두 마리씩 한 줄
    ctx.fillStyle = '#ef6b5e';
    ctx.font = 'bold 14px system-ui, sans-serif';
    for (let i = 0; i < FRIENDS.length && y <= bottom; i += 2) {
      [0, 1].forEach((k) => {
        const fr = FRIENDS[i + k];
        if (!fr) return;
        const n = hearts(d.village.friends[fr.id].pts);
        fitText(ctx, `${fr.name} ${'♥'.repeat(n)}${'♡'.repeat(5 - n)}`, bx + k * (bw / 2), y, bw / 2 - 8, 14, 'bold ');
      });
      y += 21;
    }
  } else if (p.kind === 'shop') {
    para(`강아지마을의 ${shop.name} · 물건 ${shop.stock.length}가지 · 팔 땐 절반 값`, '#7a6656');
    para('요리 재료(우유 · 밀가루 · 달걀 · 쌀 · 나뭇가지 묶음)도 팔아요', '#3f7fbf', 15, 'bold ');
  }
  // 바로 가기 (2026-10-08 사용자 요청) — 필드 · 마을 · 낚시터에서만, 열린 장소만
  if (go) button(ctx, L.go, `📍 ${p.label}(으)로 이동`, 'main');
}

/** 지역이 없는 몬스터 (도감에 안 나온다) — verify 가 본다 */
export const ungrouped = () => Object.keys(ENEMY_DEFS).filter((k) => !groupOf(k));
