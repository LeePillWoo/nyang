/**
 * 고양이마을 — 전투 대신 요리 · 친구 (2026-10-08 사용자 요청). 필드 그림의 마을 광장을 걸어 다니며(좌표 = 필드 지도 px)
 * 요리 가판대에서 재료로 요리하고(바늘 타이밍 — 잘 멈출수록 그릇이 더 나온다), 주민 친구 다섯에게 먹여 주며 친해진다.
 * 친구마다 아주 좋아하는 · 좋아하는 · 싫어하는 요리가 있고(먹여 봐야 안다), 가끔 먹고 싶은 요리를 부탁한다 (들어주면 냥코인).
 * 하트가 늘면 요리법 · 선물 · 냥코인을 준다. 한 번에 full 그릇까지 먹고, 한 그릇은 digest 초면 내려간다.
 * 친구 기록(VillageSave)은 main 이 localStorage 에 둔다. 시간은 now(ms)로 받아 node 에서 체크된다 (그리기는 village-draw.ts). 수치는 data/village.json.
 */
import { count, ITEMS, obtain, take, type Bag } from './bag.ts';
import field from './data/field.json' with { type: 'json' };
import data from './data/village.json' with { type: 'json' };

export const VILLAGE = data;
export type Pref = 'love' | 'like' | 'normal' | 'dislike';
type RewardDef = { say: string; recipe?: string; item?: string; items?: (string | number)[][]; coins?: number };
/** 주민 친구 — 입맛(love · like · dislike 요리 목록) · 대사(hello 하트별 · react 입맛별 · hint · full · ask · thanks) · 하트 선물(rewards) · 털빛(fur 어두운 · 가운데 · 밝은) · 꾸밈(deco) */
export type Friend = {
  id: string;
  name: string;
  about: string;
  fur: string[];
  deco: string;
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
  rewards: Record<string, RewardDef>;
};
/** 요리법 — need 재료 [id, 개수] · speed 바늘 빠르기 · zone good 칸 폭 · start 처음부터 안다 */
export type Recipe = { id: string; need: [string, number][]; speed: number; zone: number; start?: boolean };
export const FRIENDS = data.friends as unknown as Friend[];
export const RECIPES = data.recipes as unknown as Recipe[];
export type Reward = { level: number; say: string; recipe?: string; items: [string, number][]; coins: number };

// ── 친구 기록 (저장) ──
/** pts 친해진 점수 · meals 최근에 먹은 때(ms) · seen 먹여 봐서 아는 입맛 · ask 부탁한 요리(없으면 null) · askAt 다음 부탁할 때 · got 받은 하트 선물 */
export type FriendSave = { pts: number; meals: number[]; seen: Record<string, Pref>; ask: string | null; askAt: number; got: number[] };
/** recipes 아는 요리법 · cooked 만든 그릇 · fed 먹여 준 그릇 · met 처음 인사를 들었나 */
export type VillageSave = { friends: Record<string, FriendSave>; recipes: string[]; cooked: number; fed: number; met: boolean };

const freshFriend = (now: number): FriendSave => ({ pts: 0, meals: [], seen: {}, ask: null, askAt: now + data.request.first * 1000, got: [] });
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
    d.ask = typeof g.ask === 'string' && ITEMS[g.ask] ? g.ask : null;
    d.askAt = num(g.askAt, d.askAt);
    d.got = Array.isArray(g.got) ? g.got.filter((n) => Number.isInteger(n) && n >= 1 && n <= 5) : [];
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

/** 부탁: 부탁할 때가 된 친구는 아는 요리 중 좋아하는 것 하나를 부탁한다 (좋아하는 게 아직 없으면 아는 요리 아무거나, 싫어하는 건 빼고) */
export function tickRequests(save: VillageSave, now: number, rng: () => number = Math.random) {
  const known = save.recipes;
  for (const f of FRIENDS) {
    const fs = save.friends[f.id];
    if (fs.ask || now < fs.askAt) continue;
    const fav = [...f.love, ...f.like].filter((d) => known.includes(d));
    const pool = fav.length ? fav : known.filter((d) => !f.dislike.includes(d));
    if (pool.length) fs.ask = pool[Math.floor(rng() * pool.length)];
  }
}

export type FeedResult =
  | { ok: false; why: 'full' | 'none' | 'cant'; line: string }
  | { ok: true; pref: Pref; gain: number; line: string; coins: number; asked: boolean; rewards: Reward[]; hearts: number; up: boolean };
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
  let coins = 0;
  if (asked) {
    const [a, b] = data.request.coins;
    coins = a + Math.floor(rng() * (b - a + 1));
    bag.coins += coins;
    fs.ask = null;
    const [e0, e1] = data.request.every;
    fs.askAt = now + (e0 + rng() * (e1 - e0)) * 1000;
  }
  // 하트가 늘면 그 하트의 선물 (요리법 · 물건 · 냥코인)
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
  return { ok: true, pref, gain, line: asked ? f.thanks : f.react[pref], coins, asked, rewards, hearts: hearts(fs.pts), up: hearts(fs.pts) > before };
}
/** 인사 한 줄 (하트 수에 따라). 좋아하는 걸 아직 모르면 가끔 귀띔 */
export function hello(save: VillageSave, f: Friend, rng: () => number = Math.random) {
  const fs = save.friends[f.id];
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

// ── 광장 걷기 ──
const C = field.catBody;
const V = field.vertical;
/** 마을에서 걷는 빠르기 (px/초) */
export const WALK = field.speed * 0.9;
type Ell = { x: number; y: number; rx: number; ry: number };
const inEll = (x: number, y: number, e: Ell) => ((x - e.x) / e.rx) ** 2 + ((y - e.y) / e.ry) ** 2 <= 1;
/** 걸을 수 있는 곳: 광장 안이고 막힌 곳(분수 · 가판대 · 집 앞)이 아닌 곳 */
export const walkable = (x: number, y: number) => inEll(x, y, data.walk) && !data.blocks.some((b) => inEll(x, y, b));
export type Target = { kind: 'friend'; i: number } | { kind: 'kitchen' };
/** 마을 주민 (화면에서 움직이는 모습) — 집 앞(home)에서 조금씩 서성인다 */
export type Townie = { x: number; y: number; hx: number; hy: number; tx: number; ty: number; flip: number; animT: number; moving: boolean; wait: number; hop: number; say: string; sayT: number };
export type VillageState = {
  cat: { x: number; y: number; flip: number; moving: boolean; animT: number };
  /** 누른 곳으로 저절로 걸어간다 — then 이 있으면 닿았을 때 그걸 연다 */
  goal: { x: number; y: number; then: Target | null; stuck: number } | null;
  townies: Townie[];
  /** 말 걸 수 있는 거리 안의 가장 가까운 것 */
  near: Target | null;
  /** 이번 프레임에 연 것 (E · 누르기 · 걸어가 닿음) — main 이 창을 연다 */
  open: Target | null;
  t: number;
  rng: () => number;
};
export function makeVillage(rng: () => number = Math.random): VillageState {
  const [x, y] = data.start;
  return {
    cat: { x, y, flip: 1, moving: false, animT: 0 },
    goal: null,
    townies: FRIENDS.map((f) => ({ x: f.at[0], y: f.at[1], hx: f.at[0], hy: f.at[1], tx: f.at[0], ty: f.at[1], flip: f.at[0] < 2032 ? 1 : -1, animT: rng() * 3, moving: false, wait: 1 + rng() * 3, hop: 0, say: '', sayT: 0 })),
    near: null,
    open: null,
    t: 0,
    rng,
  };
}
/** 고양이에게서 (x, y) 까지 (고양이 키 배, 세로는 펴서) */
const gap = (s: VillageState, x: number, y: number) => Math.hypot(x - s.cat.x, (y - s.cat.y) / V) / C;
/** 대상의 자리 */
export const targetAt = (s: VillageState, t: Target): [number, number] => (t.kind === 'kitchen' ? [data.kitchen[0], data.kitchen[1]] : [s.townies[t.i].x, s.townies[t.i].y]);
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

/** 한 프레임. mx, my = 화면 기준 -1..1 (누르면 저절로 걷기는 멈춘다), act = E · Space (가까운 것에 말 걸기) */
export function updateVillage(s: VillageState, input: { mx: number; my: number; act: boolean }, dt: number) {
  s.t += dt;
  s.open = null;
  const c = s.cat;
  c.animT += dt;
  // 누른 친구 · 가판대에 닿았으면 연다 — 이미 곁이면 바로 (누른 때 열면 이 프레임 처음에 지워졌다)
  if (s.goal?.then && gap(s, ...targetAt(s, s.goal.then)) < data.reach) {
    s.open = s.goal.then;
    s.goal = null;
  }
  const len = Math.hypot(input.mx, input.my);
  if (len > 0) s.goal = null;
  c.moving = false;
  if (len > 0) c.moving = stepToward(s, input.mx / len, input.my / len, dt);
  else if (s.goal) {
    const g = s.goal;
    const [tx, ty] = g.then ? targetAt(s, g.then) : [g.x, g.y];
    const dx = tx - c.x;
    const dy = (ty - c.y) / V;
    if (!g.then && Math.hypot(dx, dy) < 2) s.goal = null;
    else {
      c.moving = stepToward(s, dx, dy, dt);
      g.stuck = c.moving ? 0 : g.stuck + dt;
      if (g.stuck > 0.6) {
        // 더는 못 가면 거기서 멈춘다 (가까우면 그래도 연다)
        if (g.then && Math.hypot(dx, dy) < data.reach * C * 1.4) s.open = g.then;
        s.goal = null;
      }
    }
  }
  // 주민: 집 앞에서 서성이다, 고양이가 가까이 오면 멈춰서 쳐다본다
  for (const p of s.townies) {
    p.animT += dt;
    p.hop = Math.max(0, p.hop - dt);
    p.sayT = Math.max(0, p.sayT - dt);
    const close = gap(s, p.x, p.y) < 4;
    p.moving = false;
    if (close) p.flip = c.x >= p.x ? 1 : -1;
    else if ((p.wait -= dt) <= 0) {
      const a = s.rng() * Math.PI * 2;
      const r = s.rng() * C * 0.8;
      [p.tx, p.ty] = [p.hx + Math.cos(a) * r, p.hy + Math.sin(a) * r * V];
      p.wait = 2 + s.rng() * 4;
    }
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (!close && d > 1) {
      const v = Math.min(d, C * 1.4 * dt);
      p.x += (dx / d) * v;
      p.y += (dy / d) * v;
      p.flip = dx >= 0 ? 1 : -1;
      p.moving = true;
    }
  }
  // 말 걸 수 있는 것 — 가장 가까운 것
  const all: Target[] = [{ kind: 'kitchen' }, ...s.townies.map((_, i) => ({ kind: 'friend' as const, i }))];
  const reach = all.map((t) => [t, gap(s, ...targetAt(s, t))] as const).filter(([, d]) => d < data.reach).sort((a, b) => a[1] - b[1]);
  s.near = reach[0]?.[0] ?? null;
  if (input.act && s.near) s.open = s.near;
}

/** 누른 곳(지도 px)으로 걸어간다. 대상(친구 · 가판대) 위면 닿았을 때 연다 — 이미 곁이면 다음 프레임에 바로 */
export function walkTo(s: VillageState, x: number, y: number, then: Target | null) {
  s.goal = { x, y, then, stuck: 0 };
}
/** 누른 곳(지도 px)의 대상 — 친구(몸 · 이름표 · 머리 위 말풍선 둘레, 겹치면 가로로 가장 가까운 친구) · 가판대 둘레.
 *  곁에 있는 것(near)은 고양이를 눌러도 그것 — 근처에 가서 누르면 말을 건다 */
export function targetAtPoint(s: VillageState, x: number, y: number): Target | null {
  let i = -1;
  let best = C * 1.2;
  s.townies.forEach((p, k) => {
    const dx = Math.abs(x - p.x);
    if (dx < best && y < p.y + C * 0.6 && y > p.y - C * 3.2) [i, best] = [k, dx];
  });
  if (i >= 0) return { kind: 'friend', i };
  if (Math.hypot(x - 2128, (y - 1520) / 0.7) < C * 3) return { kind: 'kitchen' };
  if (s.near && Math.hypot(x - s.cat.x, (y - s.cat.y + C * 0.5) / V) < C * 1.5) return s.near;
  return null;
}
