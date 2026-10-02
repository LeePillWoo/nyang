// 가방 · 장비 · 냥코인 · 드롭 — 순수 로직 (node 로 체크된다). 그리기는 bag-draw.ts.
// 아이템 정의는 data/items.json (이름·종류·설명·능력치·쓰기 효과), 드롭 표는 data/drops.json, 아이콘 좌표는 data/item-icons.json.
import dropData from './data/drops.json' with { type: 'json' };
import itemData from './data/items.json' with { type: 'json' };

/** 능력치. speed·luck·reel·line 은 %, bag 은 가방 칸 */
export type Stats = { atk: number; hp: number; def: number; speed: number; luck: number; reel: number; line: number; bag: number };
export const STAT_KEYS = ['atk', 'hp', 'def', 'speed', 'luck', 'reel', 'line', 'bag'] as const;
export const STAT_NAME: Record<keyof Stats, string> = { atk: '공격', hp: '체력', def: '방어', speed: '이동', luck: '행운', reel: '감기', line: '줄 강도', bag: '가방' };
const zero = (): Stats => ({ atk: 0, hp: 0, def: 0, speed: 0, luck: 0, reel: 0, line: 0, bag: 0 });

export type Slot = 'weapon' | 'head' | 'body' | 'accessory' | 'rod' | 'tool';
export const SLOTS: Slot[] = ['weapon', 'head', 'body', 'accessory', 'rod', 'tool'];
export const SLOT_NAME: Record<Slot, string> = { weapon: '무기', head: '머리', body: '몸', accessory: '장신구', rod: '낚시', tool: '도구' };
export type ItemType = Slot | 'material' | 'food' | 'junk' | 'treasure' | 'relic' | 'mystery';
export const TYPE_NAME: Record<ItemType, string> = {
  ...SLOT_NAME,
  material: '재료',
  food: '먹을 것',
  junk: '잡동사니',
  treasure: '보물',
  relic: '수집품',
  mystery: '정체불명',
};
/** 쓰기 효과: 체력 회복 · 잠깐 능력치(time 초) · 냥코인 · 열면 나오는 것(open 중 하나, key 가 있으면 그 아이템 하나를 쓴다) */
export type Use = { heal?: number; buff?: Partial<Stats>; time?: number; coins?: number; open?: string[]; key?: string };
export type ItemDef = { name: string; type: ItemType; desc: string; rare?: number; stats?: Partial<Stats>; use?: Use };
export const ITEMS = itemData as Record<string, ItemDef>;
export const isEquip = (id: string) => SLOTS.includes(ITEMS[id]?.type as Slot);

export type Stack = { id: string; n: number };
export type Buff = { id: string; stats: Partial<Stats>; left: number };
export type Bag = {
  coins: number;
  /** 가방 칸 (null = 빈 칸). 길이 = 기본 칸 + 장비의 bag */
  slots: (Stack | null)[];
  equip: Partial<Record<Slot, string>>;
  buffs: Buff[];
};
export const BAG_SIZE = 24;
export const MAX_STACK = 99;

/** 새 가방 — 나뭇가지 검과 초보 낚싯대를 들고 시작한다 */
export function makeBag(): Bag {
  return { coins: 0, slots: Array(BAG_SIZE).fill(null), equip: { weapon: 'equipment_01', rod: 'equipment_25' }, buffs: [] };
}

/** 장비 능력치 합 (+ buffs 면 먹은 것의 잠깐 능력치도) */
export function stats(b: Bag, buffs = true): Stats {
  const s = zero();
  const add = (o?: Partial<Stats>) => {
    for (const k of STAT_KEYS) s[k] += o?.[k] ?? 0;
  };
  for (const id of Object.values(b.equip)) if (id) add(ITEMS[id]?.stats);
  if (buffs) for (const f of b.buffs) add(f.stats);
  return s;
}
/** 가방 칸 수 — 장비 바꿀 때 칸이 줄면 넘치는 칸이 생기지 않게 slots 길이를 맞춘다 */
const capacity = (b: Bag) => BAG_SIZE + stats(b, false).bag;
function fit(b: Bag) {
  const n = capacity(b);
  while (b.slots.length < n) b.slots.push(null);
  while (b.slots.length > n && b.slots[b.slots.length - 1] === null) b.slots.pop();
}

/** 가방에 넣는다. 못 넣고 남은 개수를 돌려준다 (장비는 한 칸에 하나, 나머지는 99개까지 겹친다) */
export function addItem(b: Bag, id: string, n = 1): number {
  if (!ITEMS[id]) return n;
  const max = isEquip(id) ? 1 : MAX_STACK;
  for (const s of b.slots)
    if (n > 0 && s && s.id === id && s.n < max) {
      const k = Math.min(n, max - s.n);
      s.n += k;
      n -= k;
    }
  for (let i = 0; i < b.slots.length && n > 0; i++)
    if (!b.slots[i]) {
      const k = Math.min(n, max);
      b.slots[i] = { id, n: k };
      n -= k;
    }
  return n;
}
/** 가방에 이 아이템이 몇 개 있나 */
export const count = (b: Bag, id: string) => b.slots.reduce((t, s) => t + (s?.id === id ? s.n : 0), 0);
/** i 번 칸에서 n 개 뺀다 (기본: 전부) */
export function removeAt(b: Bag, i: number, n = Infinity) {
  const s = b.slots[i];
  if (!s) return;
  s.n -= Math.min(n, s.n);
  if (s.n <= 0) b.slots[i] = null;
}
/** 어느 칸에서든 id 를 하나 뺀다 */
function takeOne(b: Bag, id: string) {
  const i = b.slots.findIndex((s) => s?.id === id);
  if (i >= 0) removeAt(b, i, 1);
  return i >= 0;
}

/** i 번 칸의 장비를 낀다 — 끼고 있던 건 그 칸으로. 안 되면 까닭을 돌려준다 */
export function equipAt(b: Bag, i: number): string | null {
  const s = b.slots[i];
  if (!s || !isEquip(s.id)) return '장비가 아니에요';
  const slot = ITEMS[s.id].type as Slot;
  const old = b.equip[slot];
  b.equip[slot] = s.id;
  b.slots[i] = old ? { id: old, n: 1 } : null;
  if (overflow(b)) {
    // 배낭을 벗어 칸이 줄었는데 넘치는 칸에 물건이 있다 → 되돌린다
    b.slots[i] = s;
    b.equip[slot] = old;
    fit(b);
    return '가방 끝 칸을 먼저 비워 주세요';
  }
  fit(b);
  return null;
}
/** 장비를 벗어 가방에 넣는다 */
export function unequip(b: Bag, slot: Slot): string | null {
  const id = b.equip[slot];
  if (!id) return null;
  delete b.equip[slot];
  if (overflow(b)) {
    b.equip[slot] = id;
    return '가방 끝 칸을 먼저 비워 주세요';
  }
  fit(b);
  if (addItem(b, id) > 0) {
    b.equip[slot] = id;
    fit(b);
    return '가방이 가득 찼어요';
  }
  return null;
}
/** 칸 수보다 뒤에 물건이 남았나 */
const overflow = (b: Bag) => b.slots.slice(capacity(b)).some((s) => s);

export type UseResult = { ok: boolean; msg: string; heal?: number; got?: Stack[] };
/** i 번 칸을 쓴다. canHeal = 지금 체력을 채울 수 있나 (던전 안이고 덜 찼을 때) */
export function useAt(b: Bag, i: number, canHeal: boolean, rng: () => number = Math.random): UseResult {
  const s = b.slots[i];
  const u = s && ITEMS[s.id].use;
  if (!s || !u) return { ok: false, msg: '쓸 수 없는 물건이에요' };
  if (u.heal && !u.buff && !canHeal) return { ok: false, msg: '던전에서 다쳤을 때 먹어요' };
  if (u.key && !count(b, u.key)) return { ok: false, msg: `${ITEMS[u.key].name}가 있어야 열 수 있어요` };
  const got: Stack[] = [];
  if (u.open) got.push({ id: u.open[Math.floor(rng() * u.open.length)], n: 1 });
  // 나올 물건이 들어갈 자리가 있는지 먼저 본다 (상자는 열고 나면 한 칸이 빈다)
  if (got.length && s.n > 1 && !b.slots.some((v) => !v) && !b.slots.some((v) => v?.id === got[0].id && !isEquip(v.id) && v.n < MAX_STACK))
    return { ok: false, msg: '가방이 가득 찼어요' };
  removeAt(b, i, 1);
  if (u.key) takeOne(b, u.key);
  for (const g of got) addItem(b, g.id, g.n);
  if (u.coins) b.coins += u.coins;
  if (u.buff) {
    b.buffs = b.buffs.filter((f) => f.id !== s.id); // 같은 걸 또 먹으면 시간만 새로
    b.buffs.push({ id: s.id, stats: u.buff, left: u.time ?? 30 });
  }
  const name = ITEMS[s.id].name;
  const msg = got.length
    ? `${ITEMS[got[0].id].name}${u.coins ? ` · 냥코인 ${u.coins}` : ''}이(가) 나왔어요!`
    : u.coins
      ? `냥코인 ${u.coins}개를 얻었어요`
      : `${name}을(를) 먹었어요`;
  return { ok: true, msg, heal: canHeal ? u.heal : 0, got };
}
/** 먹은 것의 잠깐 능력치 시간 흐르기 */
export function tickBuffs(b: Bag, dt: number) {
  if (!b.buffs.length) return;
  for (const f of b.buffs) f.left -= dt;
  b.buffs = b.buffs.filter((f) => f.left > 0);
}

// ── 드롭 ──
type Table = [string, number][];
const DROPS = dropData as unknown as Record<string, Table>;
/** 몬스터 id → 드롭 표 (id 그대로, 없으면 가족 이름 frog_lily → frog) */
export const dropTable = (kind: string): Table => DROPS[kind] ?? DROPS[kind.split('_')[0]] ?? [];
/** 쓰러진 몬스터가 떨어뜨리는 것: 아이템 최대 2개 + 냥코인 (체력 비례). luck = 행운 % */
export function rollDrops(kind: string, hp: number, luck: number, rng: () => number = Math.random): { items: string[]; coins: number } {
  const k = 1 + luck / 100;
  const items = [...dropTable(kind), ...DROPS._all].filter(([, p]) => rng() < p * k).map(([id]) => id);
  while (items.length > 2) items.splice(Math.floor(rng() * items.length), 1);
  const lo = Math.ceil(hp / 12);
  const hi = Math.ceil(hp / 7);
  return { items, coins: lo + Math.floor(rng() * (hi - lo + 1)) };
}

// ── 저장 ── ponytail: localStorage. 저장(IndexedDB, M2)을 붙이면 세이브로 옮긴다
/** 저장해 둔 값을 믿을 만한 것만 골라 가방으로 (모르는 아이템·잘못된 칸은 버린다) */
export function fromSave(v: unknown): Bag {
  const b = makeBag();
  if (!v || typeof v !== 'object') return b;
  const o = v as Partial<Bag>;
  if (Number.isFinite(o.coins)) b.coins = Math.max(0, Math.floor(o.coins!));
  if (o.equip && typeof o.equip === 'object') {
    b.equip = {};
    for (const slot of SLOTS) {
      const id = o.equip[slot];
      if (typeof id === 'string' && ITEMS[id]?.type === slot) b.equip[slot] = id;
    }
  }
  fit(b);
  // 자리는 그대로 (빈 칸도). 칸이 모자라면 남는 건 앞의 빈 칸으로
  const ok = (s: Stack | null | undefined): s is Stack => !!s && typeof s.id === 'string' && !!ITEMS[s.id] && Number.isFinite(s.n) && s.n > 0;
  const saved = Array.isArray(o.slots) ? o.slots : [];
  const clean = (s: Stack): Stack => ({ id: s.id, n: Math.min(isEquip(s.id) ? 1 : MAX_STACK, Math.floor(s.n)) });
  saved.forEach((s, i) => {
    if (ok(s) && i < b.slots.length) b.slots[i] = clean(s);
  });
  saved.forEach((s, i) => {
    if (ok(s) && i >= b.slots.length) addItem(b, s.id, clean(s).n);
  });
  if (Array.isArray(o.buffs)) b.buffs = o.buffs.filter((f) => ITEMS[f?.id]?.use?.buff && f.left > 0).map((f) => ({ id: f.id, stats: ITEMS[f.id].use!.buff!, left: f.left }));
  return b;
}
