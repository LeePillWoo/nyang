/**
 * 강아지마을 (2026-10-12 사용자 요청) — 고양이마을처럼 걸어 들어가는 마을. 강아지 주민 여덟이 저마다 일을 맡는다:
 * 대장(모험가 길드 — guild.ts) · 무쇠(대장간 — forge.ts) · 고등어 아저씨(고등어 상점 — 상점 창) · 우체(우체국 — 배달) · 킁킁(탐험가 — 보물 지도) ·
 * 교관(훈련장 — mini/training.ts) · 버나드(구조대 — 출동 · rope.ts) · 뽀송(미용실 — 준비 중, 꾸미기 리소스가 오면 연다).
 * 주민은 자기 자리에서 시트 동작(대기 · 인사 · 일 A/B/C · 애정)으로 반응한다 — 고양이가 곁에 오면 인사, 가끔 자기 일.
 * 걷기 · 말 걸기는 고양이마을과 같은 town.ts. 기록(DogSave)은 main 이 localStorage 에 둔다. 시간은 now(ms)로 받아 node 에서 체크된다 (그리기는 dogtown-draw.ts).
 */
import { count, isEquip, ITEMS, obtain, take, type Bag } from '../bag/bag.ts';
import data from '../data/dogtown.json' with { type: 'json' };
import cats from '../data/village.json' with { type: 'json' };
import { fillBoard, QUESTS, questDone, type GuildSave } from './guild.ts';
import { type RescueKind } from './rope.ts';
import { gapTo, makeTownCat, townC, V, walkableIn, walkCat, type TownCat, type TownDef } from './town.ts';

export const DOGTOWN = data;
const TOWN = data as unknown as TownDef;
/** 고양이 키 (마을 그림 px) */
export const DC = townC(TOWN);
export const walkableDog = (x: number, y: number) => walkableIn(TOWN, x, y);
export type Job = 'guild' | 'forge' | 'shop' | 'post' | 'explorer' | 'training' | 'rescue' | 'salon';
export type Dog = { id: string; name: string; sheet: string; size: number; about: string; job: Job; at: number[]; sign: number[]; label: string; hello: string[] };
export const DOGS = data.dogs as Dog[];
/** 그 일을 맡은 주민 번호 */
export const dogOf = (job: Job) => DOGS.findIndex((d) => d.job === job);

// ── 기록 (저장) ──
/** 배달 주문 — to 받는 이 ('cat:<고양이마을 친구 id>' · 'dog:<주민 id>') · item n 개 · coins 삯 · at 맡은 때 (ms, 맡기 전엔 0) */
export type Order = { item: string; n: number; to: string; coins: number; at: number };
export type Call = { id: string; kind: RescueKind; title: string; place: string; at: number[] };
export type DogSave = {
  met: boolean;
  guild: GuildSave;
  /** 우체국: 걸려 있는 주문 하나 · 맡은 배달 (post.slots 개까지) · 마친 배달 수 */
  offer: Order | null;
  parcels: Order[];
  posted: number;
  /** 탐험가: 표시한 보물 자리 (explorer.spots 번호) · 다음 냄새 지도 때 (ms) · 판 보물 수 */
  dig: number | null;
  sniffAt: number;
  dug: number;
  /** 구조대: 들어온 출동 (rescue.calls 번호 · 나섰나) · 다음 출동 때 (ms) · 구조한 수 */
  call: { i: number; on: boolean } | null;
  callAt: number;
  rescued: number;
  /** 망치질 수 · 훈련 판 수 */
  forged: number;
  trained: number;
};
const CAT_FRIENDS = cats.friends as { id: string; name: string }[];
export const CALLS = data.rescue.calls as Call[];
const SPOTS = data.explorer.spots;
/** 배달 받는 이 — 고양이마을 친구 여덟 · 우체를 뺀 강아지 주민 */
export const RECIPIENTS = [...CAT_FRIENDS.map((f) => `cat:${f.id}`), ...DOGS.filter((d) => d.job !== 'post').map((d) => `dog:${d.id}`)];
/** 받는 이 이름 · 사는 마을 */
export function recipient(to: string) {
  const [k, id] = to.split(':');
  const name = k === 'cat' ? CAT_FRIENDS.find((f) => f.id === id)?.name : DOGS.find((d) => d.id === id)?.name;
  return { name: name ?? '???', town: k === 'cat' ? '고양이마을' : '강아지마을' };
}

export function makeDogSave(now: number, rng: () => number = Math.random): DogSave {
  const guild: GuildSave = { gp: 0, done: 0, quests: [] };
  fillBoard(guild, rng);
  return { met: false, guild, offer: null, parcels: [], posted: 0, dig: null, sniffAt: now, dug: 0, call: null, callAt: now + data.rescue.first * 1000, rescued: 0, forged: 0, trained: 0 };
}
/** 저장해 둔 값을 믿을 만한 것만 골라 (모르는 의뢰 · 물건 · 받는 이 · 이상한 숫자는 버린다) */
export function fromDogSave(v: unknown, now: number, rng: () => number = Math.random): DogSave {
  const s = makeDogSave(now, rng);
  if (!v || typeof v !== 'object') return s;
  const o = v as Partial<DogSave>;
  const num = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const cnt = (x: unknown) => Math.max(0, Math.floor(num(x, 0)));
  const order = (x: unknown): Order | null => {
    const p = x as Partial<Order> | null;
    if (!p || typeof p !== 'object' || typeof p.item !== 'string' || !ITEMS[p.item] || typeof p.to !== 'string' || !RECIPIENTS.includes(p.to)) return null;
    return { item: p.item, n: Math.max(1, cnt(p.n)), to: p.to, coins: cnt(p.coins), at: Math.max(0, num(p.at, 0)) };
  };
  s.met = o.met === true;
  const g = o.guild;
  if (g && typeof g === 'object') {
    s.guild.gp = cnt(g.gp);
    s.guild.done = cnt(g.done);
    if (Array.isArray(g.quests)) {
      const qs = g.quests.filter((q) => q && QUESTS.some((d) => d.id === q.id)).map((q) => ({ id: q.id, p: cnt(q.p) }));
      s.guild.quests = qs.filter((q, i) => qs.findIndex((x) => x.id === q.id) === i).slice(0, data.guild.board);
      fillBoard(s.guild, rng);
    }
  }
  s.offer = order(o.offer);
  s.parcels = Array.isArray(o.parcels) ? (o.parcels.map(order).filter(Boolean) as Order[]).slice(0, data.post.slots) : [];
  s.posted = cnt(o.posted);
  s.dig = Number.isInteger(o.dig) && o.dig! >= 0 && o.dig! < SPOTS.length ? o.dig! : null;
  s.sniffAt = num(o.sniffAt, s.sniffAt);
  s.dug = cnt(o.dug);
  const c = o.call;
  s.call = c && typeof c === 'object' && Number.isInteger(c.i) && c.i >= 0 && c.i < CALLS.length ? { i: c.i, on: c.on === true } : null;
  s.callAt = num(o.callAt, s.callAt);
  s.rescued = cnt(o.rescued);
  s.forged = cnt(o.forged);
  s.trained = cnt(o.trained);
  return s;
}

// ── 우체국 ── 우체가 배달 주문을 하나씩 보여 준다. 맡으면(slots 개까지) 받는 이에게 가서 말을 걸면 가방의 물건을 건네고 삯을 받는다 (due 초 안이면 bonus 만큼 더)
const pickOf = <T>(list: T[], rng: () => number) => list[Math.floor(rng() * list.length)];
export function makeOrder(rng: () => number, not: string[] = []): Order {
  const [item, n] = pickOf(data.post.items as [string, number][], rng);
  const to = pickOf(RECIPIENTS.filter((r) => !not.includes(r)), rng) ?? RECIPIENTS[0];
  const [a, b] = data.post.parcel;
  return { item, n, to, coins: a + Math.floor(rng() * (b - a + 1)) + ITEMS[item].price * n, at: 0 };
}
/** 걸려 있는 주문 (없으면 새로 — 이미 맡은 받는 이는 빼고) */
export const postOffer = (s: DogSave, rng: () => number) => (s.offer ??= makeOrder(rng, s.parcels.map((p) => p.to)));
/** 주문을 맡는다. 안 되면 까닭 */
export function acceptOrder(s: DogSave, now: number, rng: () => number): string | null {
  if (s.parcels.length >= data.post.slots) return `배달은 ${data.post.slots}개까지 맡을 수 있어요`;
  s.parcels.push({ ...postOffer(s, rng), at: now });
  s.offer = makeOrder(rng, s.parcels.map((p) => p.to));
  return null;
}
/** 다른 주문 보기 · 맡은 배달 그만두기 (벌은 없다) */
export const nextOffer = (s: DogSave, rng: () => number) => (s.offer = makeOrder(rng, [...s.parcels.map((p) => p.to), s.offer?.to ?? '']));
export const dropOrder = (s: DogSave, k: number) => void s.parcels.splice(k, 1);
/** 빨리 배달하면 덤을 받는 남은 초 (0 = 덤 끝) */
export const dueLeft = (o: Order, now: number) => Math.max(0, Math.ceil((o.at + data.post.due * 1000 - now) / 1000));
export type Delivery = { ok: true; coins: number; fast: boolean; order: Order } | { ok: false; why: string; order: Order } | null;
/** 받는 이(to)에게 말을 걸었다 — 맡은 배달이 있으면 가방의 물건을 건넨다. 없으면 null */
export function deliver(s: DogSave, bag: Bag, to: string, now: number): Delivery {
  const k = s.parcels.findIndex((p) => p.to === to);
  if (k < 0) return null;
  const o = s.parcels[k];
  const have = count(bag, o.item);
  if (have < o.n) return { ok: false, why: `${ITEMS[o.item].name} ${o.n - have}개가 더 있어야 해요`, order: o };
  take(bag, o.item, o.n);
  const fast = dueLeft(o, now) > 0;
  const coins = Math.round(o.coins * (fast ? 1 + data.post.bonus : 1));
  bag.coins += coins;
  s.parcels.splice(k, 1);
  s.posted++;
  return { ok: true, coins, fast, order: o };
}

// ── 탐험가 ── 말린 지도를 가져오면(또는 sniff 초마다 킁킁이 냄새로) 필드의 보물 자리 하나에 ✕ — 그 자리에 가서 잠깐 서 있으면 판다
const GEAR = Object.keys(ITEMS).filter((id) => isEquip(id) && (ITEMS[id].rare ?? 1) <= 2);
export const sniffWait = (s: DogSave, now: number) => Math.max(0, Math.ceil((s.sniffAt - now) / 1000));
/** 보물 자리를 표시한다 — how: map 말린 지도 한 장 · sniff 냄새(기다려야 한다). 안 되면 까닭 */
export function readMap(s: DogSave, bag: Bag, how: 'map' | 'sniff', now: number, rng: () => number): string | null {
  if (s.dig !== null) return '이미 표시한 보물 자리가 있어요 — 먼저 파 보고 와요';
  if (how === 'map') {
    if (take(bag, data.explorer.map, 1) < 1) return '말린 지도가 없어요';
  } else {
    if (now < s.sniffAt) return `코가 아직 쉬는 중이에요 (${Math.ceil(sniffWait(s, now) / 60)}분 뒤)`;
    s.sniffAt = now + data.explorer.sniff * 1000;
  }
  s.dig = Math.floor(rng() * SPOTS.length);
  return null;
}
/** 표시한 보물 자리 (필드 지도 px · 귀띔) */
export const digSpot = (s: DogSave) => (s.dig === null ? null : SPOTS[s.dig]);
export type Dug = { coins: number; items: string[]; full: string[] };
/** 보물을 판다 — 냥코인 · loot 표(하나씩 굴림) · 가끔 장비. 가방이 가득해 못 넣은 건 full */
export function dig(s: DogSave, bag: Bag, rng: () => number): Dug | null {
  if (s.dig === null) return null;
  const [a, b] = data.explorer.coins;
  const coins = a + Math.floor(rng() * (b - a + 1));
  const items = (data.explorer.loot as [string, number][]).filter(([, p]) => rng() < p).map(([id]) => id);
  if (rng() < data.explorer.gear) items.push(pickOf(GEAR, rng));
  bag.coins += coins;
  const full = items.filter((id) => obtain(bag, id) > 0);
  s.dig = null;
  s.dug++;
  return { coins, items, full };
}

// ── 구조대 ── every 초마다 출동 요청이 들어온다. 버나드에게 "출동!" 하면 필드에 ❗ — 그 자리에 가면 로프 당기기 (rope.ts)
export function tickRescue(s: DogSave, now: number, rng: () => number) {
  if (!s.call && now >= s.callAt) s.call = { i: Math.floor(rng() * CALLS.length), on: false };
}
export const callWait = (s: DogSave, now: number) => Math.max(0, Math.ceil((s.callAt - now) / 1000));
export const acceptRescue = (s: DogSave) => void (s.call && (s.call.on = true));
/** 나선 출동 (필드에 ❗) */
export const rescueSpot = (s: DogSave): Call | null => (s.call?.on ? CALLS[s.call.i] : null);
/** 구조했다 — 별만큼 냥코인, 가끔 말린 지도 (고마움의 표시). 다음 출동은 every 초 뒤 */
export function rescueDone(s: DogSave, bag: Bag, stars: number, now: number, rng: () => number) {
  const [a, b] = data.rescue.coins;
  const coins = Math.round(a + ((b - a) * (Math.max(1, Math.min(3, stars)) - 1)) / 2);
  bag.coins += coins;
  const map = rng() < data.rescue.map && obtain(bag, data.explorer.map) === 0;
  s.call = null;
  s.callAt = now + data.rescue.every * 1000;
  s.rescued++;
  return { coins, map };
}

// ── 마을 걷기 · 주민 ──
/** 주민 동작 (시트 행) — 대기는 되풀이, 나머지는 한 번 (마지막 컷에서 머물다 대기로) */
export type DogAnim = 'idle' | 'greet' | 'job_a' | 'job_b' | 'job_c' | 'affection';
export const DOG_ONE_SHOT: Record<Exclude<DogAnim, 'idle'>, number> = { greet: 1.6, job_a: 1.9, job_b: 1.9, job_c: 1.9, affection: 1.9 };
export type DogTownie = { x: number; y: number; flip: number; anim: DogAnim; animT: number; idleT: number; hop: number; say: string; sayT: number };
export type DogtownState = {
  cat: TownCat;
  dogs: DogTownie[];
  /** 말 걸 수 있는 가장 가까운 주민 (-1 없음) · 이번 프레임에 연 주민 · 곁에서 누른 주민 (다음 프레임 처음에 연다) */
  near: number;
  open: number;
  talk: number;
  t: number;
  rng: () => number;
};
const idleEvery = (rng: () => number) => data.idle.every[0] + rng() * (data.idle.every[1] - data.idle.every[0]);
/** 주민 앞 걸을 수 있는 자리 (말 걸 수 있는 거리 안) — 훈련장에서 돌아올 때 교관 앞에 선다 */
export function spotNear(i: number): [number, number] {
  const [x, y] = DOGS[i].at;
  for (const r of [1.2, 1.5, 1.8])
    for (const a of [90, 60, 120, 30, 150, 0, 180, 210, 330, 240, 300, 270])
      if (walkableDog(x + Math.cos((a * Math.PI) / 180) * r * DC, y + Math.sin((a * Math.PI) / 180) * r * DC * V))
        return [x + Math.cos((a * Math.PI) / 180) * r * DC, y + Math.sin((a * Math.PI) / 180) * r * DC * V];
  return [data.start[0], data.start[1]];
}
/** from = 그 주민 앞에서 시작 (없으면 아래 발바닥 자리) */
export function makeDogtown(rng: () => number = Math.random, from = -1): DogtownState {
  const cat = makeTownCat(TOWN);
  if (from >= 0) [cat.x, cat.y] = spotNear(from);
  return {
    cat,
    dogs: DOGS.map((d) => ({ x: d.at[0], y: d.at[1], flip: d.at[0] < data.center[0] ? 1 : -1, anim: 'idle', animT: rng() * 3, idleT: idleEvery(rng), hop: 0, say: '', sayT: 0 })),
    near: -1,
    open: -1,
    talk: -1,
    t: 0,
    rng,
  };
}
export function setDogAnim(p: DogTownie, a: DogAnim) {
  p.anim = a;
  p.animT = 0;
}
const gap = (s: DogtownState, x: number, y: number) => gapTo(TOWN, s.cat, x, y);

/** 주민이 곁에 온 고양이에게 하는 말 — 할 일이 있으면 그 이야기, 아니면 인사 */
export function dogLine(save: DogSave, bag: Bag, i: number, now: number, rng: () => number = Math.random) {
  const d = DOGS[i];
  const hi = pickOf(d.hello, rng);
  if (d.job === 'guild') return save.guild.quests.some((q) => questDone(q, bag)) ? '다 마친 의뢰가 있군! 보고하고 보상을 받아 가게' : hi;
  if (d.job === 'post') return save.parcels.length ? '배달 잘 부탁해요! 받는 분께 말을 걸면 건네져요' : hi;
  if (d.job === 'explorer') {
    const sp = digSpot(save);
    return sp ? `✕ 자리는 ${sp.hint}! 가서 가만히 서 있으면 파져` : count(bag, data.explorer.map) ? '말린 지도를 가져왔구나! 내가 읽어 줄게' : sniffWait(save, now) === 0 ? '킁킁… 새 보물 냄새가 나!' : hi;
  }
  if (d.job === 'rescue') {
    const c = save.call;
    return c ? (c.on ? `${CALLS[c.i].place}(으)로 가 주게! 필드 지도에 ❗ 표시` : '구조 요청이 들어왔어! 같이 가 줄 텐가?') : hi;
  }
  const to = `dog:${d.id}`;
  if (save.parcels.some((p) => p.to === to)) return '어, 그거 나한테 온 거야?';
  return hi;
}

/** 한 프레임. mx, my = 화면 기준 -1..1 (WASD · 조이스틱), act = E · Space (가까운 주민에게 말 걸기). w 가 있으면 곁에 온 주민이 할 일을 이야기한다 */
export function updateDogtown(s: DogtownState, input: { mx: number; my: number; act: boolean }, dt: number, w?: { save: DogSave; bag: Bag; now: number }) {
  s.t += dt;
  s.open = -1;
  if (s.talk >= 0) {
    s.open = s.talk;
    s.talk = -1;
  }
  const c = s.cat;
  walkCat(TOWN, c, input.mx, input.my, dt);
  s.dogs.forEach((p) => {
    p.animT += dt;
    p.hop = Math.max(0, p.hop - dt);
    p.sayT = Math.max(0, p.sayT - dt);
    if (gap(s, p.x, p.y) < 4) p.flip = c.x >= p.x ? 1 : -1;
    if (p.anim !== 'idle') {
      if (p.animT > DOG_ONE_SHOT[p.anim]) setDogAnim(p, 'idle');
    } else if ((p.idleT -= dt) <= 0) {
      setDogAnim(p, pickOf(['job_a', 'job_b', 'job_c'] as const, s.rng));
      p.idleT = idleEvery(s.rng);
    }
  });
  // 말 걸 수 있는 주민 — 가장 가까운. 새로 곁에 오면 인사
  let near = -1;
  let best: number = data.reach;
  s.dogs.forEach((p, i) => {
    const d = gap(s, p.x, p.y);
    if (d < best) [near, best] = [i, d];
  });
  if (near >= 0 && near !== s.near) {
    const p = s.dogs[near];
    setDogAnim(p, 'greet');
    if (w) Object.assign(p, { say: dogLine(w.save, w.bag, near, w.now, s.rng), sayT: 2.6 });
  }
  s.near = near;
  if (input.act && near >= 0) s.open = near;
}
/** 곁에 있는 주민이면 연다 (누르기 · 클릭은 말 걸기만 — 걷기는 WASD · 조이스틱으로만). 멀면 false */
export function dogTalkTo(s: DogtownState, i: number) {
  if (i < 0 || gap(s, s.dogs[i].x, s.dogs[i].y) >= data.reach) return false;
  s.talk = i;
  return true;
}
/** 누른 곳(지도 px)의 주민 — 몸 · 머리 위 말풍선 둘레 (겹치면 가로로 가장 가까운). 곁에 있는 주민은 고양이를 눌러도 */
export function dogAtPoint(s: DogtownState, x: number, y: number) {
  let i = -1;
  let best = DC * 1.2;
  s.dogs.forEach((p, k) => {
    const dx = Math.abs(x - p.x);
    if (dx < best && y < p.y + DC * 0.6 && y > p.y - DC * 3.2) [i, best] = [k, dx];
  });
  if (i >= 0) return i;
  if (s.near >= 0 && Math.hypot(x - s.cat.x, (y - s.cat.y + DC * 0.5) / V) < DC * 1.5) return s.near;
  return -1;
}
