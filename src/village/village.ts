/**
 * 고양이마을 — 전투 대신 요리 · 친구 (2026-10-08 사용자 요청). 전용 배경 그림(1536×1024, 좌표 = 그 그림 px)의 마을을 걸어 다니며
 * 요리집 앞 가판대에서 재료로 요리하고(바늘 타이밍 — 잘 멈출수록 그릇이 더 나온다), 주민 친구 여덟에게 먹여 주며 친해진다.
 * 친구마다 아주 좋아하는 · 좋아하는 · 싫어하는 요리가 있고(먹여 봐야 안다), 가끔 먹고 싶은 요리를 부탁한다 (들어주면 냥코인).
 * 놀아 줄 수도 있다 — 미니게임 셋(toys.ts: 깃털 흔들기 · 상자 숨바꼭질 · 털실 공 굴리기), 별만큼 친해지고 좋아하는 놀이면 더.
 * 부탁은 요리만이 아니라 "놀아 줘"도 (2026-10-08 밤 사용자 — 다들 밥만 달라고 하고 배부르면 자 버린다): 배부르면 조금 뒤 놀자고 한다.
 * 하트가 늘면 요리법 · 선물 · 냥코인을 준다. 한 번에 full 그릇까지 먹고, 한 그릇은 digest 초면 내려간다.
 * 주민은 자기 자리에서 동작 시트(대기 · 놀이 · 화남 · 애정 · 배고픔 · 심심 · 삐짐 · 잠)로 반응한다 — 걷는 시트가 없어 서성이지 않는다.
 * 친구 기록(VillageSave)은 main 이 localStorage 에 둔다. 시간은 now(ms)로 받아 node 에서 체크된다 (그리기는 village-draw.ts). 수치는 data/village.json.
 */
import { count, ITEMS, obtain, take, type Bag } from '../bag/bag.ts';
import field from '../data/field.json' with { type: 'json' };
import data from '../data/village.json' with { type: 'json' };
import { isToy, TOY_IDS, TOYS, type ToyId } from './toys.ts';

export const VILLAGE = data;
export type Pref = 'love' | 'like' | 'normal' | 'dislike';
type RewardDef = { say: string; recipe?: string; item?: string; items?: (string | number)[][]; coins?: number };
/** 주민 친구 — 시트(village-cats.json id) · 키 배율 size · 입맛(love · like · dislike 요리 목록) · 좋아하는 놀이 toy · 대사(hello 하트별 · react 입맛별 · hint · full · ask · askPlay · thanks · play) · 하트 선물(rewards) */
export type Friend = {
  id: string;
  name: string;
  sheet: string;
  size: number;
  about: string;
  at: number[];
  love: string[];
  like: string[];
  dislike: string[];
  hint: string;
  hello: string[];
  react: Record<Pref, string>;
  full: string;
  ask: string;
  thanks: string;
  play: string;
  toy: ToyId;
  askPlay: string;
  rewards: Record<string, RewardDef>;
};
/** 요리법 — need 재료 [id, 개수] · speed 바늘 빠르기 · zone good 칸 폭 · start 처음부터 안다 */
export type Recipe = { id: string; need: [string, number][]; speed: number; zone: number; start?: boolean };
export const FRIENDS = data.friends as unknown as Friend[];
export const RECIPES = data.recipes as unknown as Recipe[];
export type Reward = { level: number; say: string; recipe?: string; items: [string, number][]; coins: number };

// ── 친구 기록 (저장) ──
/** pts 친해진 점수 · meals 최근에 먹은 때(ms) · seen 먹여 봐서 아는 입맛 · ask 부탁(요리 id 또는 놀이 id, 없으면 null) · askAt 다음 부탁할 때 · got 받은 하트 선물 ·
 *  playedAt 마지막으로 놀아 준 때 · games 놀이마다 놀아 준 수 (좋아하는 놀이는 한 번 해 보면 안다) */
export type FriendSave = { pts: number; meals: number[]; seen: Record<string, Pref>; ask: string | null; askAt: number; got: number[]; playedAt: number; games: Record<string, number> };
/** recipes 아는 요리법 · cooked 만든 그릇 · fed 먹여 준 그릇 · met 처음 인사를 들었나 */
export type VillageSave = { friends: Record<string, FriendSave>; recipes: string[]; cooked: number; fed: number; met: boolean };

const freshFriend = (now: number): FriendSave => ({ pts: 0, meals: [], seen: {}, ask: null, askAt: now + data.request.first * 1000, got: [], playedAt: 0, games: {} });
export function makeVillageSave(now: number): VillageSave {
  return {
    friends: Object.fromEntries(FRIENDS.map((f) => [f.id, freshFriend(now)])),
    recipes: RECIPES.filter((r) => r.start).map((r) => r.id),
    cooked: 0,
    fed: 0,
    met: false,
  };
}
const PREFS: Pref[] = ['love', 'like', 'normal', 'dislike'];
/** 저장해 둔 값을 믿을 만한 것만 골라 (모르는 친구 · 요리 · 이상한 숫자는 버린다) */
export function fromVillageSave(v: unknown, now: number): VillageSave {
  const s = makeVillageSave(now);
  if (!v || typeof v !== 'object') return s;
  const o = v as Partial<VillageSave>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  for (const f of FRIENDS) {
    const g = o.friends?.[f.id];
    if (!g || typeof g !== 'object') continue;
    const d = s.friends[f.id];
    d.pts = Math.max(0, Math.min(maxPts(), num(g.pts, 0)));
    d.meals = Array.isArray(g.meals) ? g.meals.filter((t) => typeof t === 'number' && Number.isFinite(t)).slice(-data.full) : [];
    if (g.seen && typeof g.seen === 'object') for (const [id, p] of Object.entries(g.seen)) if (ITEMS[id] && PREFS.includes(p)) d.seen[id] = p;
    d.ask = typeof g.ask === 'string' && (ITEMS[g.ask] || isToy(g.ask)) ? g.ask : null;
    d.askAt = num(g.askAt, d.askAt);
    d.got = Array.isArray(g.got) ? g.got.filter((n) => Number.isInteger(n) && n >= 1 && n <= 5) : [];
    d.playedAt = Math.max(0, num(g.playedAt, 0));
    if (g.games && typeof g.games === 'object') for (const t of TOY_IDS) if (num(g.games[t], 0) > 0) d.games[t] = Math.floor(num(g.games[t], 0));
  }
  if (Array.isArray(o.recipes)) for (const id of o.recipes) if (RECIPES.some((r) => r.id === id) && !s.recipes.includes(id)) s.recipes.push(id);
  s.cooked = Math.max(0, num(o.cooked, 0));
  s.fed = Math.max(0, num(o.fed, 0));
  s.met = o.met === true;
  return s;
}

const maxPts = () => data.heart * 5;
/** 하트 수 (0~5) */
export const hearts = (pts: number) => Math.min(5, Math.floor(pts / data.heart));
/** 이 요리가 이 친구 입맛에 */
export const prefOf = (f: Friend, dish: string): Pref => (f.love.includes(dish) ? 'love' : f.like.includes(dish) ? 'like' : f.dislike.includes(dish) ? 'dislike' : 'normal');
/** 지금 배 속에 든 그릇 수 */
export const fullness = (fs: FriendSave, now: number) => fs.meals.filter((t) => now - t < data.digest * 1000).length;
/** 다음 한 그릇이 내려가기까지 (초) — 배가 꽉 찼을 때 */
export const digestIn = (fs: FriendSave, now: number) => Math.max(0, Math.ceil((Math.min(...fs.meals.filter((t) => now - t < data.digest * 1000)) + data.digest * 1000 - now) / 1000));
/** 먹여 줄 수 있는 것: 요리 · 간식 */
export const feedable = (id: string) => id.startsWith('dish_') || data.snacks.includes(id);
/** 아는 요리법 (데이터 순서대로) */
export const knownRecipes = (save: VillageSave) => RECIPES.filter((r) => save.recipes.includes(r.id));
/** 이 요리법을 알려 주는 친구 · 하트 (모르는 요리법의 귀띔) */
export function teacher(recipe: string): { friend: Friend; level: number } | null {
  for (const f of FRIENDS)
    for (const [k, r] of Object.entries(f.rewards)) if (r.recipe === recipe) return { friend: f, level: Number(k) };
  return null;
}
/** 재료가 다 있나 */
export const canCook = (bag: Bag, r: Recipe) => r.need.every(([id, n]) => count(bag, id) >= n);

/**
 * 부탁: 부탁할 때가 된 친구는 — 배가 부르면 놀자고(좋아하는 놀이가 잘 나온다), 아니면 askPlay 확률로 놀자고 · 나머지는 아는 요리 중 좋아하는 것 하나를
 * (좋아하는 게 아직 없으면 아는 요리 아무거나, 싫어하는 건 빼고)
 */
export function tickRequests(save: VillageSave, now: number, rng: () => number = Math.random) {
  const known = save.recipes;
  for (const f of FRIENDS) {
    const fs = save.friends[f.id];
    if (fs.ask || now < fs.askAt) continue;
    if (fullness(fs, now) >= data.full || rng() < data.play.ask) {
      fs.ask = rng() < data.play.favAsk ? f.toy : TOY_IDS[Math.floor(rng() * TOY_IDS.length)];
      continue;
    }
    const fav = [...f.love, ...f.like].filter((d) => known.includes(d));
    const pool = fav.length ? fav : known.filter((d) => !f.dislike.includes(d));
    if (pool.length) fs.ask = pool[Math.floor(rng() * pool.length)];
  }
}
/** 부탁을 들어줬다 — 냥코인을 주고 다음 부탁은 every 초 뒤 */
function askDone(fs: FriendSave, bag: Bag, now: number, rng: () => number) {
  const [a, b] = data.request.coins;
  const coins = a + Math.floor(rng() * (b - a + 1));
  bag.coins += coins;
  fs.ask = null;
  const [e0, e1] = data.request.every;
  fs.askAt = now + (e0 + rng() * (e1 - e0)) * 1000;
  return coins;
}

export type FeedResult =
  | { ok: false; why: 'full' | 'none' | 'cant'; line: string }
  | { ok: true; pref: Pref; gain: number; line: string; coins: number; asked: boolean; rewards: Reward[]; hearts: number; up: boolean };
/** 하트가 늘었으면 그 하트의 선물 (요리법 · 물건 · 냥코인) */
function giveRewards(save: VillageSave, bag: Bag, f: Friend, fs: FriendSave): Reward[] {
  const rewards: Reward[] = [];
  for (let L = 1; L <= hearts(fs.pts); L++) {
    if (fs.got.includes(L)) continue;
    fs.got.push(L);
    const r = f.rewards[String(L)];
    if (!r) continue;
    const items: [string, number][] = [...(r.item ? [[r.item, 1] as [string, number]] : []), ...(r.items ?? []).map(([id, n]) => [id as string, n as number] as [string, number])];
    for (const [id, n] of items) obtain(bag, id, n);
    if (r.coins) bag.coins += r.coins;
    if (r.recipe && !save.recipes.includes(r.recipe)) save.recipes.push(r.recipe);
    rewards.push({ level: L, say: r.say, recipe: r.recipe, items, coins: r.coins ?? 0 });
  }
  return rewards;
}
/** 친구(f) 에게 dish 하나를 먹여 준다 — 가방에서 빼고, 입맛 · 부탁만큼 친해지고, 하트가 늘면 선물을 받는다 */
export function feed(save: VillageSave, bag: Bag, f: Friend, dish: string, now: number, rng: () => number = Math.random): FeedResult {
  const fs = save.friends[f.id];
  if (!feedable(dish)) return { ok: false, why: 'cant', line: '' };
  if (fullness(fs, now) >= data.full) return { ok: false, why: 'full', line: f.full };
  if (take(bag, dish, 1) !== 1) return { ok: false, why: 'none', line: '' };
  const pref = prefOf(f, dish);
  const asked = fs.ask === dish;
  const before = hearts(fs.pts);
  const gain = data.points[pref] + (asked ? data.points.request : 0);
  fs.pts = Math.min(maxPts(), fs.pts + gain);
  fs.meals = [...fs.meals.filter((t) => now - t < data.digest * 1000), now];
  fs.seen[dish] = pref;
  save.fed++;
  const coins = asked ? askDone(fs, bag, now, rng) : 0;
  // 배가 부르면 곧 놀자고 한다 (잠만 자지 않게)
  if (fullness(fs, now) >= data.full && !fs.ask) fs.askAt = Math.min(fs.askAt, now + data.play.afterMeal * 1000);
  const rewards = giveRewards(save, bag, f, fs);
  return { ok: true, pref, gain, line: asked ? f.thanks : f.react[pref], coins, asked, rewards, hearts: hearts(fs.pts), up: hearts(fs.pts) > before };
}
/** 놀 수 있나 — 놀자고 부탁했으면 언제든, 아니면 마지막으로 논 뒤 play.every 초가 지나야. 기다릴 초 (0 = 지금) */
export const playWait = (fs: FriendSave, now: number) => (isToy(fs.ask) ? 0 : Math.max(0, Math.ceil((fs.playedAt + data.play.every * 1000 - now) / 1000)));
export type PlayResult = { stars: number; gain: number; fav: boolean; asked: boolean; coins: number; line: string; rewards: Reward[]; hearts: number; up: boolean };
/** 놀이(toy)를 별 stars 로 마쳤다 — 별만큼(play.points) 친해지고 좋아하는 놀이면 play.fav 배, 놀자는 부탁이 그 놀이면 points.request · 냥코인. 하트가 늘면 선물 */
export function playToy(save: VillageSave, bag: Bag, f: Friend, toy: ToyId, stars: number, now: number, rng: () => number = Math.random): PlayResult {
  const fs = save.friends[f.id];
  const fav = f.toy === toy;
  const asked = fs.ask === toy;
  const before = hearts(fs.pts);
  const gain = Math.round(data.play.points[Math.max(1, Math.min(3, stars))] * (fav ? data.play.fav : 1)) + (asked ? data.points.request : 0);
  fs.pts = Math.min(maxPts(), fs.pts + gain);
  fs.playedAt = now;
  fs.games[toy] = (fs.games[toy] ?? 0) + 1;
  const coins = asked ? askDone(fs, bag, now, rng) : 0;
  const rewards = giveRewards(save, bag, f, fs);
  const line = asked ? f.thanks : fav && stars >= 2 ? f.play : data.play.lines[stars];
  return { stars, gain, fav, asked, coins, line, rewards, hearts: hearts(fs.pts), up: hearts(fs.pts) > before };
}
/** 인사 한 줄 (하트 수에 따라). 좋아하는 걸 아직 모르면 가끔 귀띔 */
export function hello(save: VillageSave, f: Friend, rng: () => number = Math.random) {
  const fs = save.friends[f.id];
  if (isToy(fs.ask)) return f.askPlay.replaceAll('{toy}', TOYS[fs.ask].name);
  if (fs.ask) return f.ask.replaceAll('{dish}', ITEMS[fs.ask].name);
  const knowsLove = f.love.some((d) => fs.seen[d] === 'love');
  if (!knowsLove && rng() < 0.5) return f.hint;
  return f.hello[hearts(fs.pts)];
}

// ── 요리 (바늘 타이밍) ──
export type Cook = {
  recipe: Recipe;
  /** 바늘 자리 0..1 · 가는 쪽 · 흐른 시간 */
  pos: number;
  dir: number;
  t: number;
  /** good 칸 가운데 · 폭 (막대 비율) */
  c: number;
  w: number;
  phase: 'stir' | 'done';
  stars: number;
  /** 나온 그릇 · 가방이 가득해 못 넣은 그릇 */
  served: number;
  lost: number;
};
/** 재료를 넣고(가방에서 뺀다) 바늘을 돌리기 시작한다. 재료가 모자라면 null */
export function startCook(bag: Bag, r: Recipe, rng: () => number = Math.random): Cook | null {
  if (!canCook(bag, r)) return null;
  for (const [id, n] of r.need) take(bag, id, n);
  const c = 0.2 + rng() * 0.6;
  return { recipe: r, pos: 0, dir: 1, t: 0, c, w: r.zone, phase: 'stir', stars: 0, served: 0, lost: 0 };
}
/** 바늘 한 프레임 — 끝에서 끝까지 speed 번/초로 오간다. limit 초를 넘기면 탄다 */
export function updateCook(c: Cook, dt: number) {
  if (c.phase !== 'stir') return false;
  c.t += dt;
  c.pos += c.dir * c.recipe.speed * dt;
  if (c.pos > 1) [c.pos, c.dir] = [2 - c.pos, -1];
  if (c.pos < 0) [c.pos, c.dir] = [-c.pos, 1];
  return c.t >= data.cook.limit;
}
/** 멈춘다 → 별 (가운데 perfect 칸 ★★★ · good 칸 ★★ · 나머지 ★) */
export function stopCook(c: Cook, burnt = false) {
  if (c.phase !== 'stir') return c.stars;
  const d = Math.abs(c.pos - c.c);
  c.stars = burnt ? 1 : d <= (c.w / 2) * data.cook.perfect ? 3 : d <= c.w / 2 ? 2 : 1;
  c.phase = 'done';
  return c.stars;
}
/** 별만큼 그릇을 가방에 (가득이면 남는 건 못 넣는다) */
export function serve(save: VillageSave, bag: Bag, c: Cook) {
  c.lost = obtain(bag, c.recipe.id, c.stars);
  c.served = c.stars - c.lost;
  save.cooked += c.served;
  return c.served;
}

// ── 마을 걷기 ──
/** 고양이 키 (마을 그림 px) — 거리 · 말 거는 거리 · 치즈 크기가 이 배수 */
export const C = field.catBody * data.unit;
const V = field.vertical;
/** 마을에서 걷는 빠르기 (px/초) — 필드와 같은 몸 길이/초 */
export const WALK = field.speed * data.unit * 0.9;
type Block = { type: 'ellipse'; x: number; y: number; rx: number; ry: number } | { type: 'rect'; x0: number; y0: number; x1: number; y1: number };
export const BLOCKS = data.blocks as unknown as (Block & { name: string })[];
/** 다각형 안인가 (짝홀) */
function inPoly(x: number, y: number, poly: number[][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const blocked = (x: number, y: number, b: Block) => (b.type === 'rect' ? x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 : ((x - b.x) / b.rx) ** 2 + ((y - b.y) / b.ry) ** 2 <= 1);
/** 걸을 수 있는 곳: 마을 안(울타리 · 강 안쪽)이고 막힌 곳(집 · 분수 · 텃밭 · 연못 …)이 아닌 곳 */
export const walkable = (x: number, y: number) => inPoly(x, y, data.walk) && !BLOCKS.some((b) => blocked(x, y, b));
export type Target = { kind: 'friend'; i: number } | { kind: 'kitchen' };
/** 주민 동작 (시트 행) */
export type Anim = 'idle' | 'solo_play' | 'angry' | 'affection' | 'hungry' | 'bored' | 'sulk' | 'sleep';
/** 한 번 하고 바탕 동작으로 돌아가는 동작과 그 길이(초) — 마지막 컷에서 머문다 */
export const ONE_SHOT: Partial<Record<Anim, number>> = { solo_play: 2.6, angry: 1.8, affection: 2.4, bored: 2.4, sulk: 2.2 };
/** 바탕 동작 — 놀자고 하면 심심(한숨 · 기지개), 배부르면 잠, 먹고 싶은 게 있으면 배고픔(생선 생각풍선), 아니면 대기 */
export const baseAnim = (fs: FriendSave | undefined, now: number): Anim =>
  !fs ? 'idle' : isToy(fs.ask) ? 'bored' : fullness(fs, now) >= data.full ? 'sleep' : fs.ask ? 'hungry' : 'idle';
/** 먹여 준 반응 — 좋아하면 애정, 싫어하면 삐짐, 보통은 그대로 */
export const reactAnim = (pref: Pref): Anim => (pref === 'dislike' ? 'sulk' : pref === 'normal' ? 'idle' : 'affection');
/** 마을 주민 — 자기 자리(걷는 시트가 없다)에서 고양이가 오면 돌아보고, 심심하면 혼자 논다. say 는 머리 위 말풍선 */
export type Townie = { x: number; y: number; flip: number; anim: Anim; animT: number; idleT: number; hop: number; say: string; sayT: number };
export type VillageState = {
  cat: { x: number; y: number; flip: number; moving: boolean; animT: number };
  /** 곁에서 누른 친구 · 가판대 — 다음 프레임 처음에 연다 (누른 때 열면 프레임 처음에 지워졌다) */
  talk: Target | null;
  townies: Townie[];
  /** 말 걸 수 있는 거리 안의 가장 가까운 것 */
  near: Target | null;
  /** 이번 프레임에 연 것 (E · 누르기 · 걸어가 닿음) — main 이 창을 연다 */
  open: Target | null;
  t: number;
  rng: () => number;
};
const idleEvery = (rng: () => number) => data.idle.every[0] + rng() * (data.idle.every[1] - data.idle.every[0]);
export function makeVillage(rng: () => number = Math.random): VillageState {
  const [x, y] = data.start;
  return {
    cat: { x, y, flip: 1, moving: false, animT: 0 },
    talk: null,
    townies: FRIENDS.map((f) => ({ x: f.at[0], y: f.at[1], flip: f.at[0] < data.center[0] ? 1 : -1, anim: 'idle', animT: rng() * 3, idleT: idleEvery(rng), hop: 0, say: '', sayT: 0 })),
    near: null,
    open: null,
    t: 0,
    rng,
  };
}
/** 동작 바꾸기 (같은 동작이면 그대로 이어 간다) */
export function setAnim(p: Townie, a: Anim) {
  if (p.anim === a) return;
  p.anim = a;
  p.animT = 0;
}
/** 고양이에게서 (x, y) 까지 (고양이 키 배, 세로는 펴서) */
const gap = (s: VillageState, x: number, y: number) => Math.hypot(x - s.cat.x, (y - s.cat.y) / V) / C;
/** 대상의 자리 — 친구는 서 있는 곳, 가판대는 요리집 앞줄(kitchen 두 점)에서 고양이와 가장 가까운 점
 *  (2026-10-12 사용자 — 바짝 붙었는데 안 열렸다: 한 점이라 앞이 넓은 요리집의 화분 앞 · 건물 밑 끝에선 멀었다) */
export const targetAt = (s: VillageState, t: Target): [number, number] => {
  if (t.kind === 'friend') return [s.townies[t.i].x, s.townies[t.i].y];
  const [[x0, y0], [x1, y1]] = data.kitchen;
  const k = Math.max(0, Math.min(1, ((s.cat.x - x0) * (x1 - x0) + (s.cat.y - y0) * (y1 - y0)) / ((x1 - x0) ** 2 + (y1 - y0) ** 2)));
  return [x0 + (x1 - x0) * k, y0 + (y1 - y0) * k];
};
/** 걸어서 (ux, uy) 쪽으로 한 걸음 — 막히면 ±30° · 60° · 90° 로 비켜 간다. 움직였으면 true */
function stepToward(s: VillageState, ux: number, uy: number, dt: number) {
  const c = s.cat;
  const d = WALK * dt;
  const base = Math.atan2(uy, ux);
  for (const k of [0, 0.5, -0.5, 1, -1, 1.5, -1.5]) {
    const a = base + k;
    const nx = c.x + Math.cos(a) * d;
    const ny = c.y + Math.sin(a) * d * V;
    if (!walkable(nx, ny)) continue;
    [c.x, c.y] = [nx, ny];
    if (Math.abs(Math.cos(a)) > 0.2) c.flip = Math.sign(Math.cos(a));
    return true;
  }
  return false;
}

/** 한 프레임. mx, my = 화면 기준 -1..1 (WASD · 조이스틱), act = E · Space (가까운 것에 말 걸기). save · now 가 있으면 주민 바탕 동작(잠 · 배고픔)을 거기서 본다 */
export function updateVillage(s: VillageState, input: { mx: number; my: number; act: boolean }, dt: number, save?: VillageSave, now = 0) {
  s.t += dt;
  s.open = null;
  const c = s.cat;
  c.animT += dt;
  if (s.talk) {
    s.open = s.talk;
    s.talk = null;
  }
  const len = Math.hypot(input.mx, input.my);
  c.moving = len > 0 && stepToward(s, input.mx / len, input.my / len, dt);
  // 주민: 자기 자리에서 고양이가 가까이 오면 돌아본다. 한 번 하는 동작이 끝나면 바탕 동작으로, 대기 중 심심하면 혼자 논다
  s.townies.forEach((p, i) => {
    p.animT += dt;
    p.hop = Math.max(0, p.hop - dt);
    p.sayT = Math.max(0, p.sayT - dt);
    if (gap(s, p.x, p.y) < 4) p.flip = c.x >= p.x ? 1 : -1;
    const base = baseAnim(save?.friends[FRIENDS[i].id], now);
    const len = ONE_SHOT[p.anim];
    if (len !== undefined) {
      if (p.animT > len) {
        setAnim(p, base);
        if (p.anim === base) p.animT = 0; // 바탕 동작이 한 번 동작(놀자고 심심)이면 되풀이
      }
    } else if (p.anim !== base) setAnim(p, base);
    else if (base === 'idle' && (p.idleT -= dt) <= 0) {
      setAnim(p, s.rng() < 0.5 ? 'bored' : 'solo_play');
      p.idleT = idleEvery(s.rng);
    }
  });
  // 말 걸 수 있는 것 — 가장 가까운 것
  const all: Target[] = [{ kind: 'kitchen' }, ...s.townies.map((_, i) => ({ kind: 'friend' as const, i }))];
  const reach = all.map((t) => [t, gap(s, ...targetAt(s, t))] as const).filter(([, d]) => d < data.reach).sort((a, b) => a[1] - b[1]);
  s.near = reach[0]?.[0] ?? null;
  if (input.act && s.near) s.open = s.near;
}

/** 곁에 있는 친구 · 가판대면 연다 — 누르기 · 클릭은 말 걸기만, 걷기는 WASD · 조이스틱으로만
 *  (2026-10-12 사용자 — 빈 곳을 누르면 그리로 걸어가던 터치 이동을 뺐다, 마우스도 같이). 멀면 아무것도 안 하고 false */
export function talkTo(s: VillageState, t: Target | null) {
  if (!t || gap(s, ...targetAt(s, t)) >= data.reach) return false;
  s.talk = t;
  return true;
}
/** 누른 곳(지도 px)의 대상 — 친구(몸 · 이름표 · 머리 위 말풍선 둘레, 겹치면 가로로 가장 가까운 친구) · 요리집 앞 가판대 둘레.
 *  곁에 있는 것(near)은 고양이를 눌러도 그것 — 근처에 가서 누르면 말을 건다 */
export function targetAtPoint(s: VillageState, x: number, y: number): Target | null {
  let i = -1;
  let best = C * 1.2;
  s.townies.forEach((p, k) => {
    const dx = Math.abs(x - p.x);
    if (dx < best && y < p.y + C * 0.6 && y > p.y - C * 3.2) [i, best] = [k, dx];
  });
  if (i >= 0) return { kind: 'friend', i };
  const [kx0, ky0, kx1, ky1] = data.kitchenArea;
  if (x >= kx0 && x <= kx1 && y >= ky0 && y <= ky1) return { kind: 'kitchen' };
  if (s.near && Math.hypot(x - s.cat.x, (y - s.cat.y + C * 0.5) / V) < C * 1.5) return s.near;
  return null;
}
