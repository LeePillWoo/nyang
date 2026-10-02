// node src/bag.check.ts  (npm run check) — 가방 · 장비 · 쓰기 · 드롭 · 저장, 그리고 데이터가 서로 맞는지
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import enemies from './data/enemies.json' with { type: 'json' };
import icons from './data/item-icons.json' with { type: 'json' };
import {
  addItem,
  BAG_SIZE,
  count,
  dropTable,
  equipAt,
  fromSave,
  isEquip,
  ITEMS,
  makeBag,
  MAX_STACK,
  obtain,
  room,
  buy,
  sellAt,
  sellPrice,
  removeAt,
  rollDrops,
  SLOTS,
  stats,
  tickBuffs,
  unequip,
  useAt,
} from './bag.ts';
import drops from './data/drops.json' with { type: 'json' };
import fishing from './data/fishing.json' with { type: 'json' };
import shop from './data/shop.json' with { type: 'json' };

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// 1) 시작 가방: 나뭇가지 검 · 초보 낚싯대
{
  const b = makeBag();
  assert.equal(b.slots.length, BAG_SIZE);
  assert.equal(stats(b).atk, 2);
  assert.equal(stats(b).reel, 5);
}

// 2) 겹치기·칸 수: 재료는 99개씩, 장비는 한 칸에 하나, 꽉 차면 남은 개수를 돌려준다
{
  const b = makeBag();
  assert.equal(addItem(b, 'materials_05', 150), 0);
  assert.deepEqual(
    b.slots.filter(Boolean).map((s) => s!.n),
    [MAX_STACK, 51],
  );
  assert.equal(addItem(b, 'equipment_13', 3), 0);
  assert.equal(b.slots.filter((s) => s?.id === 'equipment_13').length, 3);
  assert.equal(addItem(b, 'nope', 1), 1, '모르는 아이템은 안 들어간다');
  for (let i = 0; i < 30; i++) addItem(b, 'equipment_02');
  assert.equal(b.slots.every(Boolean), true);
  assert.equal(addItem(b, 'equipment_02'), 1, '꽉 차면 남는다');
  assert.equal(addItem(b, 'materials_05', 48), 0, '꽉 차도 덜 찬 묶음엔 들어간다 (51 → 99)');
  assert.equal(addItem(b, 'materials_05', 1), 1);
}

// 3) 장비: 끼면 능력치가 바뀌고, 끼던 건 그 칸으로 돌아온다
{
  const b = makeBag();
  addItem(b, 'equipment_12'); // 해적 커틀러스 공격 +8
  addItem(b, 'equipment_16'); // 파라오 머리장식 체력 +20 행운 +10
  assert.equal(equipAt(b, 0), null);
  assert.equal(b.equip.weapon, 'equipment_12');
  assert.equal(b.slots[0]?.id, 'equipment_01', '끼던 나뭇가지 검이 그 칸으로');
  assert.equal(equipAt(b, 1), null);
  assert.deepEqual([stats(b).atk, stats(b).hp, stats(b).luck], [8, 20, 10]);
  addItem(b, 'materials_05');
  assert.notEqual(equipAt(b, b.slots.findIndex((s) => s?.id === 'materials_05')), null, '재료는 못 낀다');
  assert.equal(unequip(b, 'head'), null);
  assert.equal(b.equip.head, undefined);
  assert.equal(count(b, 'equipment_16'), 1);
}

// 4) 탐험 배낭: 가방 +6칸. 늘어난 칸에 물건이 있으면 못 벗는다
{
  const b = makeBag();
  addItem(b, 'equipment_31');
  assert.equal(equipAt(b, 0), null);
  assert.equal(b.slots.length, BAG_SIZE + 6);
  b.slots[BAG_SIZE + 3] = { id: 'materials_01', n: 1 };
  assert.notEqual(unequip(b, 'tool'), null, '끝 칸에 물건이 있으면 못 벗는다');
  assert.equal(b.slots.length, BAG_SIZE + 6);
  b.slots[BAG_SIZE + 3] = null;
  assert.equal(unequip(b, 'tool'), null);
  assert.equal(b.slots.length, BAG_SIZE);
  assert.equal(count(b, 'equipment_31'), 1);
  assert.equal(count(b, 'materials_01'), 0);
}

// 5) 쓰기: 회복은 던전에서만 · 잠깐 능력치 · 냥코인 · 열쇠로 상자 열기
{
  const b = makeBag();
  addItem(b, 'curios_01', 2);
  assert.equal(useAt(b, 0, false).ok, false, '다치지 않았으면 회복약을 아낀다');
  const r = useAt(b, 0, true);
  assert.equal(r.ok && r.heal, 40);
  assert.equal(count(b, 'curios_01'), 1);

  addItem(b, 'curios_06'); // 참치 통조림 공격 +5, 45초
  assert.equal(useAt(b, b.slots.findIndex((s) => s?.id === 'curios_06'), false).ok, true, '잠깐 능력치는 어디서나');
  assert.equal(stats(b).atk, 2 + 5);
  assert.equal(stats(b, false).atk, 2, '장비만 볼 땐 빠진다');
  tickBuffs(b, 46);
  assert.equal(stats(b).atk, 2);

  addItem(b, 'curios_23');
  useAt(b, b.slots.findIndex((s) => s?.id === 'curios_23'), false);
  assert.equal(b.coins, 50);

  addItem(b, 'curios_21'); // 작은 잠긴 상자
  const box = () => b.slots.findIndex((s) => s?.id === 'curios_21');
  assert.equal(useAt(b, box(), false).ok, false, '열쇠가 없으면 못 연다');
  addItem(b, 'curios_18');
  const o = useAt(b, box(), false, seeded(3));
  assert.equal(o.ok, true);
  assert.equal(count(b, 'curios_18') + count(b, 'curios_21'), 0, '열쇠와 상자가 없어진다');
  assert.equal(isEquip(o.got![0].id) && count(b, o.got![0].id), 1, '장비가 나와 가방에 들어간다');

  addItem(b, 'materials_05');
  assert.equal(useAt(b, b.slots.findIndex((s) => s?.id === 'materials_05'), true).ok, false, '재료는 못 쓴다');
}

// 6) 드롭: 확률대로 · 행운만큼 더 · 한 마리 최대 2개 · 냥코인은 체력 비례
{
  assert.equal(rollDrops('frog_lily', 22, 0, () => 0).items.length, 2);
  assert.deepEqual(rollDrops('frog_lily', 22, 0, () => 0.9999).items, []);
  const rate = (luck: number) => {
    const rng = seeded(7);
    let n = 0;
    for (let i = 0; i < 20000; i++) if (rollDrops('golem_stack', 60, luck, rng).items.includes('materials_07')) n++;
    return n / 20000;
  };
  const base = rate(0);
  const lucky = rate(50);
  assert.ok(base > 0.36 && base < 0.46, `거친 돌 0.45 언저리 (최대 2개라 조금 깎임): ${base}`);
  assert.ok(lucky > base * 1.25, `행운 50% 면 더 잘 나온다: ${base} → ${lucky}`);
  const c = rollDrops('fat', 60, 0, seeded(1)).coins;
  assert.ok(c >= 5 && c <= 9, `뚱보 쥐 냥코인 5~9: ${c}`);
}

// 7) 저장: 그대로 돌아오고, 이상한 값은 버린다
{
  const b = makeBag();
  addItem(b, 'materials_05', 12);
  addItem(b, 'equipment_31');
  equipAt(b, 1);
  b.coins = 77;
  useAt(b, (addItem(b, 'curios_06'), b.slots.findIndex((s) => s?.id === 'curios_06')), false);
  addItem(b, 'curios_14');
  addItem(b, 'curios_13');
  removeAt(b, b.slots.findIndex((s) => s?.id === 'curios_14')); // 가운데 빈 칸
  const back = fromSave(JSON.parse(JSON.stringify(b)));
  assert.deepEqual(back, b, '자리(빈 칸까지) 그대로 돌아온다');
  const junk = fromSave({ coins: -5, equip: { weapon: 'curios_01', head: 'equipment_13' }, slots: [{ id: 'nope', n: 3 }, { id: 'materials_01', n: 1e9 }, null, 7], buffs: [{ id: 'x', left: 9 }] });
  assert.equal(junk.coins, 0);
  assert.deepEqual(junk.equip, { head: 'equipment_13' });
  assert.equal(count(junk, 'materials_01'), MAX_STACK);
  assert.equal(junk.buffs.length, 0);
  assert.deepEqual(fromSave('garbage'), makeBag());
}

// 7-2) 얻기·상점: 얻으면 도감에 센다(팔아도 줄지 않는다) · 자리만큼만 · 냥코인이 모자라면 못 산다 · 팔면 절반
{
  const b = makeBag();
  assert.equal(obtain(b, 'materials_05', 3), 0);
  assert.equal(b.found.materials_05, 3);
  assert.equal(room(b, 'materials_05'), MAX_STACK - 3 + (BAG_SIZE - 1) * MAX_STACK);
  assert.equal(room(b, 'equipment_13'), BAG_SIZE - 1);
  assert.equal(buy(b, 'curios_01'), '냥코인이 모자라요');
  b.coins = 100;
  assert.equal(buy(b, 'curios_01', 5), null, '있는 만큼만 산다');
  assert.equal(count(b, 'curios_01'), 3, '30냥 × 3개');
  assert.equal(b.coins, 10);
  assert.equal(b.found.curios_01, 3);
  const i = b.slots.findIndex((s) => s?.id === 'curios_01');
  assert.equal(sellAt(b, i, 2), 2);
  assert.equal(b.coins, 10 + 2 * sellPrice('curios_01'));
  assert.equal(sellPrice('curios_01'), 15);
  assert.equal(b.found.curios_01, 3, '팔아도 도감은 그대로');
  for (let k = 0; k < 40; k++) addItem(b, 'equipment_02');
  b.coins = 9999;
  assert.equal(buy(b, 'equipment_13'), '가방에 자리가 없어요');
  // 도감 전 저장(found 없음)은 가진 것으로 채운다
  const old = fromSave({ coins: 1, equip: { weapon: 'equipment_12' }, slots: [{ id: 'materials_05', n: 4 }] });
  assert.deepEqual(old.found, { materials_05: 4, equipment_12: 1 });
}

// 8) 데이터: 아이템마다 아이콘 · 그림 파일 · 종류별 필수 값, 드롭 표의 아이템이 있고, 몬스터마다 드롭 표, 장비는 다 얻을 길이 있다
{
  const ids = Object.keys(ITEMS);
  assert.deepEqual(ids.sort(), Object.keys(icons).sort(), 'items.json 과 아이콘 좌표가 같은 108종');
  for (const [id, [sheet]] of Object.entries(icons as Record<string, [string]>)) assert.ok(existsSync(new URL(`./assets/${sheet}.webp`, import.meta.url)), `${id} 그림 ${sheet}`);
  for (const [id, d] of Object.entries(ITEMS)) {
    assert.ok(d.name && d.desc, `${id} 이름·설명`);
    if (isEquip(id)) assert.ok(d.stats && Object.keys(d.stats).length, `${id} 장비 능력치`);
    if (d.type === 'food') assert.ok(d.use?.heal || d.use?.buff, `${id} 먹을 것 효과`);
    for (const o of [...(d.use?.open ?? []), ...(d.use?.key ? [d.use.key] : [])]) assert.ok(ITEMS[o], `${id} 상자 속 ${o}`);
  }
  for (const [k, t] of Object.entries(drops)) if (!k.startsWith('_c')) for (const [id, p] of t as [string, number][]) assert.ok(ITEMS[id] && p > 0 && p < 1, `${k} 드롭 ${id} ${p}`);
  for (const k of Object.keys(enemies)) assert.ok(dropTable(k).length, `${k} 드롭 표`);
  const sources = new Set([
    ...Object.values(makeBag().equip),
    ...Object.entries(drops).flatMap(([k, t]) => (k.startsWith('_c') ? [] : (t as [string, number][]).map(([id]) => id))),
    ...Object.values(ITEMS).flatMap((d) => d.use?.open ?? []),
  ]);
  for (const id of ids.filter(isEquip)) assert.ok(sources.has(id), `${id} ${ITEMS[id].name} 얻을 길`);
  assert.equal(new Set(ids.filter(isEquip).map((id) => ITEMS[id].type)).size, SLOTS.length, '칸마다 장비가 있다');
  for (const [id, d] of Object.entries(ITEMS)) assert.ok(Number.isInteger(d.price) && d.price > 0, `${id} 값`);
  for (const id of shop.stock) assert.ok(ITEMS[id], `상점 ${id}`);
  // 상자·주머니를 팔면 여는 것보다 비싸지 않다 (열어서 나오는 냥코인 ≥ 판 값)
  for (const [id, d] of Object.entries(ITEMS)) if (d.use?.coins && !d.use.open) assert.ok(d.use.coins >= sellPrice(id), `${id} 팔기 ${sellPrice(id)} > 열기 ${d.use.coins}`);
  // 낚시터마다 건질 것
  for (const [k, s] of Object.entries(fishing.spots)) {
    assert.ok(s.salvage?.length, `${k} 건질 것`);
    for (const [id] of s.salvage as [string, number][]) assert.ok(ITEMS[id], `${k} 건질 것 ${id}`);
  }
}

console.log('bag.check: ok');
