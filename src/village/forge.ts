/**
 * 대장간 (강아지마을 무쇠, 2026-10-12) — 장비 강화 · 합치기. 강화 점수(fp)는 가방(bag.ts)이 장비마다 들고 있다 — 3점 = +1, 최대 +5.
 * 강화: 단계마다 냥코인 + 재료(dogtown.json forge.need — 모자란 재료는 그 값에 사서 채운다)를 내고 망치질 놀이를 한다 → 별 1~3 만큼 점수.
 * 망치질 놀이: 달군 쇠 위로 고리가 줄어든다 — 가운데 원에 닿을 때 두드린다 (Space · 누르기). 세 번, 딱 맞으면 2점 · 비슷하면 1점 · 놓치면 0 → 별.
 * 합치기: 같은 장비 두 점 → 하나 (점수가 높은 쪽 + 한 단계). 낚싯대도 같은 방법으로 강화된다 (감기 · 줄 강도 · 행운이 오른다).
 * node 로 체크된다 (dogtown.check.ts).
 */
import { count, FORGE, forgeLevel, isEquip, ITEMS, MAX_FP, SLOTS, take, type Bag, type Slot } from '../bag/bag.ts';
import data from '../data/dogtown.json' with { type: 'json' };

/** 강화할 장비 하나 — 끼고 있는 칸 또는 가방 칸 */
export type ForgeRef = { at: 'slot'; slot: Slot } | { at: 'bag'; i: number };
export const refId = (b: Bag, r: ForgeRef) => (r.at === 'slot' ? (b.equip[r.slot] ?? null) : (b.slots[r.i]?.id ?? null));
export const refFp = (b: Bag, r: ForgeRef) => (r.at === 'slot' ? (b.fp[r.slot] ?? 0) : (b.slots[r.i]?.fp ?? 0));
function setRefFp(b: Bag, r: ForgeRef, fp: number) {
  if (r.at === 'slot') {
    if (fp) b.fp[r.slot] = fp;
    else delete b.fp[r.slot];
  } else if (b.slots[r.i]) b.slots[r.i] = fp ? { ...b.slots[r.i]!, fp } : { id: b.slots[r.i]!.id, n: 1 };
}
/** 대장간에 보이는 장비 — 끼고 있는 것(칸 순서) 먼저, 그다음 가방의 장비 */
export function forgeList(b: Bag): ForgeRef[] {
  const worn: ForgeRef[] = SLOTS.filter((s) => b.equip[s]).map((slot) => ({ at: 'slot', slot }));
  const kept: ForgeRef[] = b.slots.flatMap((s, i) => (s && isEquip(s.id) ? [{ at: 'bag' as const, i }] : []));
  return [...worn, ...kept];
}
/** 지금 단계에서 한 번 강화하는 값 — coins 기본 값 · need 재료 [id, 필요, 가진 것] · buy 모자란 재료를 사는 값 · total 모두 · max 다 올렸나 */
export function forgeCost(b: Bag, r: ForgeRef) {
  const lv = forgeLevel(refFp(b, r));
  if (lv >= FORGE.max) return { lv, coins: 0, need: [] as [string, number, number][], buy: 0, total: 0, max: true };
  const need = (data.forge.need[lv] as [string, number][]).map(([id, n]): [string, number, number] => [id, n, count(b, id)]);
  const buy = need.reduce((t, [id, n, have]) => t + Math.max(0, n - have) * ITEMS[id].price, 0);
  const coins = data.forge.coins[lv];
  return { lv, coins, need, buy, total: coins + buy, max: false };
}
/** 강화 값을 낸다 (가진 재료부터 쓰고 모자란 건 냥코인으로). 안 되면 까닭 */
export function payForge(b: Bag, r: ForgeRef): string | null {
  if (!refId(b, r)) return '장비가 없어요';
  const c = forgeCost(b, r);
  if (c.max) return '더는 강화할 수 없어요 (+5)';
  if (b.coins < c.total) return `냥코인이 모자라요 (${c.total}냥 필요)`;
  for (const [id, n, have] of c.need) take(b, id, Math.min(n, have));
  b.coins -= c.total;
  return null;
}
/** 망치질 별만큼 강화 점수 — 돌려주는 것: 새 점수 · 단계 · 단계가 올랐나 */
export function applyForge(b: Bag, r: ForgeRef, stars: number) {
  const before = forgeLevel(refFp(b, r));
  const fp = Math.min(MAX_FP, refFp(b, r) + Math.max(1, Math.min(3, stars)));
  setRefFp(b, r, fp);
  return { fp, lv: forgeLevel(fp), up: forgeLevel(fp) > before };
}
/** 함께 합칠 수 있는 같은 장비 (가방에서, 자기 말고) */
export function mergeTarget(b: Bag, r: ForgeRef): ForgeRef | null {
  const id = refId(b, r);
  if (!id) return null;
  const i = b.slots.findIndex((s, k) => s?.id === id && !(r.at === 'bag' && r.i === k));
  return i >= 0 ? { at: 'bag', i } : null;
}
/** 같은 장비 두 점을 하나로 — 점수가 높은 쪽 + 한 단계 (merge 냥코인). 다른 하나는 없어진다. 안 되면 까닭 */
export function merge(b: Bag, r: ForgeRef): string | null {
  const other = mergeTarget(b, r);
  if (!other || other.at !== 'bag') return '같은 장비가 하나 더 있어야 해요';
  if (forgeLevel(refFp(b, r)) >= FORGE.max) return '더는 강화할 수 없어요 (+5)';
  if (b.coins < data.forge.merge) return `냥코인이 모자라요 (${data.forge.merge}냥 필요)`;
  b.coins -= data.forge.merge;
  const fp = Math.min(MAX_FP, Math.max(refFp(b, r), refFp(b, other)) + FORGE.per);
  b.slots[other.i] = null;
  setRefFp(b, r, fp);
  return null;
}

// ── 망치질 놀이 ── 고리가 1 → 0 으로 줄어든다 (dur 초). target 에 닿을 때 누르면: 차이가 perfect 안이면 딱(2점) · good 안이면 좋아(1점) · 아니면 헛망치(0)
export const HAMMER = { strikes: 3, dur: [1.3, 1.15, 1.0], target: 0.3, good: 0.1, perfect: 0.035, pause: 0.55 };
export type Grade = 'perfect' | 'good' | 'miss';
export type Hammer = {
  phase: 'hit' | 'pause' | 'done';
  /** 몇 번째 두드림 · 그 두드림의 시간 · 고리 반지름 (1 → 0) */
  k: number;
  t: number;
  r: number;
  results: Grade[];
  stars: number;
  events: { type: 'strike' | 'done'; grade?: Grade }[];
};
export const makeHammer = (): Hammer => ({ phase: 'hit', k: 0, t: 0, r: 1, results: [], stars: 0, events: [] });
function strike(h: Hammer, g: Grade) {
  h.results.push(g);
  h.events.push({ type: 'strike', grade: g });
  if (h.results.length >= HAMMER.strikes) {
    const pts = h.results.reduce((s, x) => s + (x === 'perfect' ? 2 : x === 'good' ? 1 : 0), 0);
    h.stars = pts >= 5 ? 3 : pts >= 3 ? 2 : 1;
    h.phase = 'done';
    h.events.push({ type: 'done' });
  } else [h.phase, h.t] = ['pause', 0];
}
/** 두드리기 (Space · Enter · 누르기) */
export function hammerPress(h: Hammer) {
  if (h.phase !== 'hit') return;
  const d = Math.abs(h.r - HAMMER.target);
  strike(h, d <= HAMMER.perfect ? 'perfect' : d <= HAMMER.good ? 'good' : 'miss');
}
export function updateHammer(h: Hammer, dt: number) {
  h.events.length = 0;
  if (h.phase === 'done') return;
  h.t += dt;
  if (h.phase === 'pause') {
    if (h.t >= HAMMER.pause) Object.assign(h, { phase: 'hit', k: h.k + 1, t: 0, r: 1 });
    return;
  }
  h.r = Math.max(0, 1 - h.t / HAMMER.dur[Math.min(h.k, HAMMER.dur.length - 1)]);
  if (h.r <= 0) strike(h, 'miss'); // 놓쳤다 (식어 버림)
}
/** 딱 맞는 때까지 남은 초 (자동 검사 · 그리기 안내용) */
export const hammerIn = (h: Hammer) => (h.phase === 'hit' ? (h.r - HAMMER.target) * HAMMER.dur[Math.min(h.k, HAMMER.dur.length - 1)] : Infinity);
