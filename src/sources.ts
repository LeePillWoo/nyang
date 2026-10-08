// 아이템을 어디서 얻나 — 도감의 "얻는 곳" 과 요리 가판대의 "부족한 재료 바로가기" 가 같이 쓴다 (node 로 체크된다).
// 2026-10-08: 재료는 콘텐츠마다 나눠 두었다 — 생선은 낚시, 가게 재료(우유 · 밀가루 · 달걀 · 쌀)는 고등어 상점(밀가루는 풍차 밀밭 쥐 해적단 · 달걀은 갈매기 · 쌀은 자칼 항아리도),
// 숲 재료(도토리 · 버섯 · 잎사귀 · 나뭇가지)는 숲 도끼질 · 부스럭 수풀 · 다람쥐(잡기)와 던전 드롭, 해초는 물가 몬스터와 맹그로브 건지기.
import { dropTable, ITEMS } from './bag.ts';
import drops from './data/drops.json' with { type: 'json' };
import fieldData from './data/field.json' with { type: 'json' };
import shop from './data/shop.json' with { type: 'json' };
import villageData from './data/village.json' with { type: 'json' };
import { ENEMY_DEFS } from './enemy.ts';
import { FIELD, warpLocked, type Warp } from './field.ts';
import { SPOTS } from './fishing.ts';
import { ROOMS } from './iso.ts';
import { placeKind } from './places.ts';

export type Sources = {
  monsters: string[];
  all: boolean;
  spots: string[];
  shop: boolean;
  boxes: string[];
  start: boolean;
  cook: boolean;
  fish: boolean;
  forest: boolean;
  /** 다람쥐 잡기 보상 (도토리) */
  chase: boolean;
  gift: string[];
};
export const SOURCES: Record<string, Sources> = {};
for (const id of Object.keys(ITEMS)) SOURCES[id] = { monsters: [], all: false, spots: [], shop: false, boxes: [], start: false, cook: false, fish: false, forest: false, chase: false, gift: [] };
for (const r of villageData.recipes) SOURCES[r.id].cook = true;
SOURCES.cook_fish.fish = true;
SOURCES.materials_05.chase = true;
for (const [id] of [...fieldData.forest.finds, ...fieldData.forest.rustle.finds]) SOURCES[id as string].forest = true;
for (const fr of villageData.friends)
  for (const r of Object.values(fr.rewards) as { item?: string; items?: (string | number)[][] }[])
    for (const id of [r.item, ...(r.items ?? []).map(([i]) => i as string)]) if (id && !SOURCES[id].gift.includes(fr.name)) SOURCES[id].gift.push(fr.name);
for (const k of Object.keys(ENEMY_DEFS)) for (const [id] of dropTable(k)) SOURCES[id].monsters.push(k);
for (const [id] of (drops as unknown as Record<string, [string, number][]>)._all) SOURCES[id].all = true;
for (const [sid, s] of Object.entries(SPOTS)) for (const [id] of s.salvage ?? []) SOURCES[id].spots.push(sid);
for (const id of shop.stock) SOURCES[id].shop = true;
for (const [bid, d] of Object.entries(ITEMS)) for (const id of d.use?.open ?? []) SOURCES[id].boxes.push(bid);
for (const id of ['equipment_01', 'equipment_25']) SOURCES[id].start = true;
/** 몬스터가 나오는 방 id */
export const ROOMS_OF: Record<string, string[]> = {};
for (const [rid, r] of Object.entries(ROOMS)) for (const [k] of r.spawns) if (!(ROOMS_OF[k as string] ??= []).includes(rid)) ROOMS_OF[k as string].push(rid);

const openWarps = () => FIELD.warps.filter((w) => w.to && !warpLocked(w));
const dist = (w: Warp, from: number[]) => Math.hypot(w.at[0] - from[0], w.at[1] - from[1]);
/** 이 몬스터가 이 아이템을 떨어뜨릴 확률 (없으면 0) */
const chance = (kind: string, id: string) => dropTable(kind).find(([v]) => v === id)?.[1] ?? 0;

export type Shortcut = { warp: Warp; why: string };
/**
 * 아이템을 얻으러 갈 가장 좋은 포탈 (열린 구역 안). from = 지금 자리(필드 지도 px) — 같은 종류면 가까운 곳.
 * 상점 물건 → 상점, 생선 → 가까운 낚시터, 던전 드롭 → 그 몬스터가 가장 잘 떨어뜨리는 열린 던전, 숲 재료 → 숲 미니게임장(도토리는 다람쥐 잡기), 건질 것 → 그 낚시터
 */
export function shortcut(id: string, from: number[] = FIELD.warps.find((w) => w.to === 'village')?.at ?? FIELD.start): Shortcut | null {
  const s = SOURCES[id];
  if (!s) return null;
  const open = openWarps();
  const nearest = (list: Warp[]) => list.sort((a, b) => dist(a, from) - dist(b, from))[0];
  if (s.shop) {
    const w = open.find((v) => v.to === 'shop');
    if (w) return { warp: w, why: `${shop.name}에서 팔아요` };
  }
  if (s.fish) {
    const w = nearest(open.filter((v) => placeKind(v.to, v.id) === 'fish'));
    if (w) return { warp: w, why: '물고기를 낚으면' };
  }
  // 던전: 그 아이템을 떨어뜨리는 몬스터가 나오는 열린 방 — 방 안 몬스터들의 확률 합이 가장 큰 곳
  let best: { w: Warp; p: number } | null = null;
  for (const w of open.filter((v) => placeKind(v.to, v.id) === 'dungeon')) {
    const p = ROOMS[w.to].spawns.reduce((t, [k]) => t + chance(k as string, id), 0);
    if (p > 0 && (!best || p > best.p)) best = { w, p };
  }
  if (s.chase) {
    const w = open.find((v) => v.to === 'chase');
    if (w && (!best || best.p < 0.4)) return { warp: w, why: '다람쥐를 잡으면' };
  }
  if (best) {
    const who = ROOMS[best.w.to].spawns.map(([k]) => k as string).filter((k) => chance(k, id) > 0);
    return { warp: best.w, why: `${ENEMY_DEFS[who[0]].name}이(가) 떨어뜨려요` };
  }
  if (s.forest) {
    const w = nearest(open.filter((v) => v.to === 'timber' || v.to === 'chase'));
    if (w) return { warp: w, why: '둘레 숲을 도끼로 헤치면' };
  }
  if (s.spots.length) {
    const w = nearest(open.filter((v) => s.spots.includes(v.to)));
    if (w) return { warp: w, why: '낚시로 건질 때가 있어요' };
  }
  return null;
}
