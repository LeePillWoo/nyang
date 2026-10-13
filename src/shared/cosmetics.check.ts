// node src/shared/cosmetics.check.ts  (npm run check) — 꾸미기 소품: 데이터 · 사기 · 입기/벗기 · 머리까지 덮는 옷 · 저장
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { buyCos, COS, COS_HIDDEN, COS_SLOTS, COS_TABS, cosPrice, fromWardrobe, makeWardrobe, takeOffAll, wearCos, wornList } from './cosmetics.ts';

// 데이터: 소품 100개 · 탭마다 20개 이하 (미용실 칸 5 × 4) · 그림이 있다 · 옷은 두 발 짝이 있다
const ids = Object.keys(COS);
assert.equal(ids.length, 100);
for (const [name, list] of COS_TABS) {
  assert.ok(list.length && list.length <= 20, `탭 ${name} ${list.length}개`);
  for (const id of list) assert.ok(COS[id], `${name} ${id}`);
}
assert.equal(new Set(COS_TABS.flatMap(([, l]) => l)).size, ids.filter((id) => !COS_HIDDEN.includes(COS[id].slot)).length, '안 쓰는 칸을 뺀 모든 소품이 탭 하나에');
assert.ok(!COS_TABS.some(([, l]) => l.some((id) => COS_HIDDEN.includes(COS[id].slot))), '안 쓰는 칸(옷 · 등)은 미용실에 없다');
for (const [id, it] of Object.entries(COS)) {
  assert.ok(COS_SLOTS.includes(it.slot), `${id} 칸`);
  assert.ok(it.r.length === 4 && it.r[2] > 0 && it.r[3] > 0 && it.hint.length === 3, `${id} 범위 · hint`);
  for (const sh of [it.sheet, it.up?.sheet].filter(Boolean)) assert.ok(existsSync(new URL(`../assets/${sh}.webp`, import.meta.url)), `${id} 그림 ${sh}`);
  if (it.slot === 'body') assert.ok(it.up, `${id} 옷은 두 발 자세 짝`);
}

// 사기 · 입기 · 벗기
const w = makeWardrobe();
const wallet = { coins: 100 };
const hat = COS_TABS[0][1][0];
assert.ok(wearCos(w, hat), '안 산 건 못 입는다');
assert.equal(buyCos(w, wallet, hat), null);
assert.equal(wallet.coins, 100 - cosPrice(hat));
assert.ok(buyCos(w, wallet, hat), '두 번은 못 산다');
const coat = Object.keys(COS).find((id) => COS[id].slot === 'body')!;
assert.ok(buyCos(w, wallet, coat), '냥코인이 모자라면 못 산다');
assert.equal(wearCos(w, hat), null);
assert.equal(w.worn.head, hat);
const hat2 = COS_TABS[0][1][1];
wallet.coins = 1000;
buyCos(w, wallet, hat2);
wearCos(w, hat2);
assert.equal(w.worn.head, hat2, '같은 칸은 바꿔 입는다');
wearCos(w, hat2);
assert.equal(w.worn.head, undefined, '걸친 걸 다시 고르면 벗는다');
// 머리까지 덮는 옷이면 모자는 안 그린다
const hood = Object.keys(COS).find((id) => COS[id].head)!;
buyCos(w, wallet, hood);
wearCos(w, hat);
wearCos(w, hood);
assert.deepEqual(wornList(w.worn), COS_HIDDEN.includes('body') ? [hat] : [hood], '머리까지 덮는 옷 + 모자 = 옷만 (옷 칸을 안 쓰면 모자만)');
takeOffAll(w);
assert.deepEqual(w.worn, {});
// 저장: 왕복 · 이상한 값 버림
wearCos(w, hat);
assert.deepEqual(fromWardrobe(JSON.parse(JSON.stringify(w))), w, '왕복 그대로');
const junk = fromWardrobe({ owned: ['nope', hat, hat], worn: { head: 'nope', face: hat, neck: hood } });
assert.deepEqual(junk.owned, [hat]);
assert.deepEqual(junk.worn, {}, '모르는 것 · 칸이 안 맞는 것 · 안 가진 것은 버린다');
console.log('cosmetics.check: ok');
