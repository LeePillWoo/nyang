/**
 * 모험가 길드 (강아지마을 대장, 2026-10-12) — 게시판에 의뢰가 board 개 걸리고, 마치고 보고하면 냥코인 · 길드 점수(gp).
 * 점수가 쌓이면 등급 이름이 오른다 (견습 → 동 → 은 → 금 → 전설) — 사용자: 아직 구역 개방 같은 보상은 없이 점수만 쌓는다.
 * 의뢰 진행은 다른 장면의 일(사냥 · 낚시 · 미니게임 · 요리 · 배달 …)을 main 이 noteGuild 로 알려 준다. 납품(item) 의뢰는 가방에 있는 개수가 곧 진행.
 * node 로 체크된다 (dogtown.check.ts).
 */
import { count, take, type Bag } from '../bag/bag.ts';
import data from '../data/dogtown.json' with { type: 'json' };

export type QuestType = 'kill' | 'elite' | 'clear' | 'fish' | 'bigfish' | 'salvage' | 'timber' | 'chase' | 'maze' | 'sand' | 'cook' | 'item' | 'forage' | 'rescue' | 'post' | 'treasure' | 'forge' | 'train';
export type QuestDef = { id: string; title: string; desc: string; type: QuestType; n: number; coins: number; gp: number; item?: string };
export const QUESTS = data.guild.quests as QuestDef[];
export const questDef = (id: string) => QUESTS.find((q) => q.id === id)!;
/** 게시판의 의뢰 하나 — p = 진행 (수 · 한 판 최고 점수) */
export type Quest = { id: string; p: number };
export type GuildSave = { gp: number; done: number; quests: Quest[] };

/** 다른 장면에서 생긴 일 — kill 은 몬스터 하나(정예면 elite), fish 는 big 이면 월척, 한 판 점수는 score */
export type GuildEvent =
  | { type: 'kill'; elite: boolean }
  | { type: 'clear' | 'salvage' | 'forage' | 'maze' | 'rescue' | 'post' | 'treasure' | 'forge' }
  | { type: 'fish'; big: boolean }
  | { type: 'cook'; n: number }
  | { type: 'sand'; clean: boolean }
  | { type: 'timber' | 'chase' | 'train'; score: number };

/** 등급 — i 번째 · 이름 · 다음 등급까지 남은 점수 (전설이면 null) */
export function rankOf(gp: number) {
  const R = data.guild.ranks as [string, number][];
  let i = 0;
  while (i + 1 < R.length && gp >= R[i + 1][1]) i++;
  return { i, name: R[i][0], next: i + 1 < R.length ? R[i + 1][1] - gp : null, nextName: R[i + 1]?.[0] ?? null };
}
/** 의뢰 진행 (납품은 가방에 있는 개수, 나머지는 쌓인 값) — n 까지 */
export const progressOf = (q: Quest, bag: Bag) => {
  const d = questDef(q.id);
  return Math.min(d.n, d.type === 'item' ? count(bag, d.item!) : q.p);
};
export const questDone = (q: Quest, bag: Bag) => progressOf(q, bag) >= questDef(q.id).n;
/** 게시판 채우기 — 이미 걸린 의뢰와 except(방금 마친 것)는 빼고 아무거나 */
export function fillBoard(g: GuildSave, rng: () => number, except = '') {
  while (g.quests.length < data.guild.board) {
    const pool = QUESTS.filter((d) => d.id !== except && !g.quests.some((q) => q.id === d.id));
    if (!pool.length) break;
    g.quests.push({ id: pool[Math.floor(rng() * pool.length)].id, p: 0 });
  }
}
/** 다른 장면의 일 → 게시판 의뢰 진행. 돌려주는 것: 이번에 다 된 의뢰 제목들 (알림용) */
export function noteGuild(g: GuildSave, ev: GuildEvent, bag: Bag): string[] {
  const doneNow: string[] = [];
  for (const q of g.quests) {
    const d = questDef(q.id);
    const before = progressOf(q, bag);
    const t = d.type;
    const hit =
      ev.type === 'kill' ? t === 'kill' || (t === 'elite' && ev.elite) : ev.type === 'fish' ? t === 'fish' || (t === 'bigfish' && ev.big) : ev.type === 'sand' ? t === 'sand' && ev.clean : ev.type === t;
    if (!hit) continue;
    if (ev.type === 'cook') q.p += ev.n;
    else if ('score' in ev) q.p = Math.max(q.p, ev.score);
    else q.p++;
    if (before < d.n && progressOf(q, bag) >= d.n) doneNow.push(d.title);
  }
  return doneNow;
}
export type TurnIn = { ok: false; why: string } | { ok: true; title: string; coins: number; gp: number; rankUp: string | null };
/** k 번째 의뢰 보고 — 다 됐으면 냥코인 · 점수 (납품이면 물건을 가져간다), 그 자리엔 새 의뢰 */
export function turnIn(g: GuildSave, bag: Bag, k: number, rng: () => number = Math.random): TurnIn {
  const q = g.quests[k];
  if (!q) return { ok: false, why: '의뢰가 없어요' };
  const d = questDef(q.id);
  if (!questDone(q, bag)) return { ok: false, why: '아직 다 못 했어요' };
  if (d.type === 'item' && take(bag, d.item!, d.n) < d.n) return { ok: false, why: '물건이 모자라요' };
  const before = rankOf(g.gp).i;
  bag.coins += d.coins;
  g.gp += d.gp;
  g.done++;
  g.quests.splice(k, 1);
  fillBoard(g, rng, d.id);
  const r = rankOf(g.gp);
  return { ok: true, title: d.title, coins: d.coins, gp: d.gp, rankUp: r.i > before ? r.name : null };
}
/** k 번째 의뢰를 다른 의뢰로 바꾼다 (reroll 냥코인). 안 되면 까닭 */
export function reroll(g: GuildSave, bag: Bag, k: number, rng: () => number = Math.random): string | null {
  if (!g.quests[k]) return '의뢰가 없어요';
  if (bag.coins < data.guild.reroll) return '냥코인이 모자라요';
  bag.coins -= data.guild.reroll;
  const old = g.quests.splice(k, 1)[0];
  fillBoard(g, rng, old.id);
  // 새 의뢰를 그 자리에 (게시판 순서 그대로)
  g.quests.splice(k, 0, g.quests.pop()!);
  return null;
}
