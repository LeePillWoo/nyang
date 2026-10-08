// node src/village.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { count, ITEMS, makeBag, obtain } from './bag.ts';
import field from './data/field.json' with { type: 'json' };
import shop from './data/shop.json' with { type: 'json' };
import {
  canCook,
  feed,
  feedable,
  FRIENDS,
  fromVillageSave,
  fullness,
  hearts,
  hello,
  knownRecipes,
  makeVillage,
  makeVillageSave,
  prefOf,
  RECIPES,
  serve,
  startCook,
  stopCook,
  targetAt,
  targetAtPoint,
  teacher,
  tickRequests,
  updateCook,
  updateVillage,
  VILLAGE,
  walkable,
  walkTo,
  type Target,
} from './village.ts';

const seeded = (seed: number) => {
  let v = seed >>> 0;
  return () => {
    v = (v * 1664525 + 1013904223) >>> 0;
    return v / 2 ** 32;
  };
};
const T0 = 1_000_000;

// 1) 데이터: 요리 · 재료 · 친구 입맛 · 선물이 다 있는 것을 가리킨다. 처음 아는 요리 셋, 나머지는 친구가 하트로 알려 준다. 요리마다 좋아하는 친구가 있다.
//    가게 재료(우유 · 밀가루 · 달걀 · 쌀)는 고등어 상점에서 판다
{
  for (const r of RECIPES) {
    assert.ok(ITEMS[r.id]?.type === 'food' && ITEMS[r.id].emoji, `${r.id} 는 먹을 것 (emoji 아이콘)`);
    for (const [id] of r.need) assert.ok(ITEMS[id], `${r.id} 재료 ${id}`);
    assert.ok(r.start || teacher(r.id), `${ITEMS[r.id].name} — 처음부터 알거나 누군가 알려 준다`);
    assert.ok(FRIENDS.some((f) => f.love.includes(r.id) || f.like.includes(r.id)), `${ITEMS[r.id].name} 를 좋아하는 친구가 있다`);
  }
  assert.equal(RECIPES.filter((r) => r.start).length, 3, '처음 아는 요리 셋');
  for (const f of FRIENDS) {
    for (const d of [...f.love, ...f.like, ...f.dislike]) assert.ok(RECIPES.some((r) => r.id === d), `${f.name} 입맛 ${d}`);
    assert.equal(f.hello.length, 6, `${f.name} 하트마다 인사`);
    for (const [k, r] of Object.entries(f.rewards)) {
      assert.ok(Number(k) >= 1 && Number(k) <= 5 && r.say, `${f.name} ♥${k} 선물`);
      for (const id of [r.item, ...(r.items ?? []).map(([i]) => i as string)].filter(Boolean)) assert.ok(ITEMS[id as string], `${f.name} 선물 ${id}`);
    }
  }
  for (const id of ['cook_milk', 'cook_flour', 'cook_egg', 'cook_rice', 'materials_02']) assert.ok(shop.stock.includes(id), `${ITEMS[id].name} 는 상점에서 판다`);
  assert.ok(VILLAGE.snacks.every((id) => ITEMS[id]?.type === 'food') && feedable('dish_03') && feedable('curios_07') && !feedable('curios_01'), '요리 · 간식만 먹여 준다 (물약은 아니다)');
}

// 2) 저장: 새 기록 · 이상한 값은 버리고 · 저장했다 불러와도 그대로
{
  const s = makeVillageSave(T0);
  assert.deepEqual(knownRecipes(s).map((r) => r.id), ['dish_01', 'dish_02', 'dish_03']);
  assert.deepEqual(fromVillageSave(null, T0), s);
  assert.deepEqual(fromVillageSave({ friends: { milk: { pts: 9999, meals: ['x'], seen: { dish_03: 'love', nope: 'love' }, ask: 'nope', got: [1, 9] } }, recipes: ['dish_05', 'zzz'], cooked: -3 }, T0).friends.milk, {
    pts: 100,
    meals: [],
    seen: { dish_03: 'love' },
    ask: null,
    askAt: T0 + VILLAGE.request.first * 1000,
    got: [1],
  });
  const bag = makeBag();
  obtain(bag, 'dish_03', 2);
  feed(s, bag, FRIENDS[1], 'dish_03', T0);
  assert.deepEqual(fromVillageSave(JSON.parse(JSON.stringify(s)), T0), s, '저장했다 불러와도 그대로');
}

// 3) 요리: 재료가 모자라면 못 하고, 하면 재료가 빠진다. 바늘은 0..1 을 오간다. 가운데 ★★★ · good 칸 ★★ · 바깥 ★ · 너무 오래 끌면 탄다 ★. 별만큼 그릇
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  const soup = RECIPES.find((r) => r.id === 'dish_03')!;
  assert.ok(!canCook(bag, soup) && startCook(bag, soup) === null, '재료가 없으면 못 한다');
  obtain(bag, 'materials_06', 6);
  obtain(bag, 'cook_milk', 3);
  const c = startCook(bag, soup, seeded(1))!;
  assert.ok(c && count(bag, 'materials_06') === 4 && count(bag, 'cook_milk') === 2, '재료가 빠진다');
  let lo = 1;
  let hi = 0;
  for (let i = 0; i < 300; i++) {
    updateCook(c, 1 / 120);
    lo = Math.min(lo, c.pos);
    hi = Math.max(hi, c.pos);
  }
  assert.ok(lo < 0.02 && hi > 0.98 && lo >= 0 && hi <= 1, `바늘은 끝에서 끝까지 (${lo.toFixed(2)} ~ ${hi.toFixed(2)})`);
  c.pos = c.c;
  assert.equal(stopCook(c), 3, '가운데에 멈추면 ★★★');
  assert.equal(serve(save, bag, c), 3, '★★★ → 세 그릇');
  assert.equal(count(bag, 'dish_03'), 3);
  const g = startCook(bag, soup, seeded(2))!;
  g.pos = g.c + g.w * 0.45;
  assert.equal(stopCook(g), 2, 'good 칸이면 ★★');
  const m = startCook(bag, soup, seeded(3))!;
  m.pos = m.c + g.w * 0.8;
  assert.equal(stopCook(m), 1, '바깥이면 ★');
  const b = makeBag();
  obtain(b, 'materials_06', 2);
  obtain(b, 'cook_milk', 1);
  const burnt = startCook(b, soup)!;
  let over = false;
  for (let i = 0; i < 1000 && !over; i++) over = updateCook(burnt, 1 / 60);
  assert.ok(over && Math.abs(burnt.t - VILLAGE.cook.limit) < 0.05 && stopCook(burnt, true) === 1, `${VILLAGE.cook.limit}초 안에 안 누르면 탄다 ★`);
  // 가방이 가득이면 못 넣은 그릇은 잃는다
  const full = makeBag();
  obtain(full, 'materials_06', 2);
  obtain(full, 'cook_milk', 1);
  const ck = startCook(full, soup)!;
  for (let i = 0; i < full.slots.length; i++) if (!full.slots[i]) full.slots[i] = { id: 'equipment_02', n: 1 };
  ck.pos = ck.c;
  stopCook(ck);
  assert.ok(serve(makeVillageSave(T0), full, ck) === 0 && ck.lost === 3, '가방이 가득이면 못 넣는다');
}

// 4) 먹여 주기: 입맛마다 친해지는 만큼 · 세 그릇이면 배부름 · 내려가면 또 먹는다 · 먹여 본 입맛을 기억한다 · 가방에 없으면 못 준다
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  const milk = FRIENDS.find((f) => f.id === 'milk')!;
  for (const id of ['dish_03', 'dish_02', 'dish_06', 'dish_01']) obtain(bag, id, 3);
  const pts = (d: string) => {
    const s2 = makeVillageSave(T0);
    const b2 = makeBag();
    obtain(b2, d, 1);
    const r = feed(s2, b2, milk, d, T0);
    return r.ok ? r.gain : -1;
  };
  assert.deepEqual(
    ['dish_03', 'dish_02', 'dish_06', 'dish_01'].map(pts),
    [VILLAGE.points.love, VILLAGE.points.like, VILLAGE.points.normal, VILLAGE.points.dislike],
    '아주 좋아함 > 좋아함 > 보통 > 싫어함',
  );
  assert.equal(prefOf(milk, 'dish_03'), 'love');
  for (let i = 0; i < VILLAGE.full; i++) assert.ok(feed(save, bag, milk, 'dish_02', T0 + i * 1000).ok);
  const no = feed(save, bag, milk, 'dish_02', T0 + 5000);
  assert.ok(!no.ok && no.why === 'full' && no.line === milk.full && count(bag, 'dish_02') === 0, '세 그릇이면 배불러서 안 먹는다 (그릇은 그대로)');
  assert.equal(fullness(save.friends.milk, T0 + VILLAGE.digest * 1000 + 1500), 1, '한 그릇씩 내려간다');
  assert.ok(feed(save, bag, milk, 'dish_03', T0 + VILLAGE.digest * 1000 + 1500).ok, '내려가면 또 먹는다');
  assert.equal(save.friends.milk.seen.dish_03, 'love', '먹여 본 입맛을 기억한다');
  const none = feed(makeVillageSave(T0), makeBag(), milk, 'dish_03', T0);
  assert.ok(!none.ok && none.why === 'none', '가방에 없으면 못 준다');
}

// 5) 부탁: first 초 뒤 아는 요리 중 좋아하는 것을 부탁 · 들어주면 더 친해지고 냥코인, 다음 부탁은 every 초 뒤 · 인사 대신 부탁을 말한다
{
  const save = makeVillageSave(T0);
  tickRequests(save, T0 + 1000, seeded(4));
  assert.ok(FRIENDS.every((f) => save.friends[f.id].ask === null), '처음엔 부탁이 없다');
  tickRequests(save, T0 + VILLAGE.request.first * 1000, seeded(4));
  for (const f of FRIENDS) {
    const ask = save.friends[f.id].ask!;
    assert.ok(ask && save.recipes.includes(ask) && !f.dislike.includes(ask), `${f.name} 는 아는 요리를 부탁한다 (${ask})`);
    assert.ok(hello(save, f).includes(ITEMS[ask].name), `${f.name} 인사 대신 부탁`);
  }
  const ink = FRIENDS.find((f) => f.id === 'ink')!;
  const ask = save.friends.ink.ask!;
  const bag = makeBag();
  obtain(bag, ask, 1);
  const coins0 = bag.coins;
  const r = feed(save, bag, ink, ask, T0 + 20_000, seeded(5));
  assert.ok(r.ok && r.asked && r.gain === VILLAGE.points[prefOf(ink, ask)] + VILLAGE.points.request && r.line === ink.thanks, '부탁을 들어주면 더 친해진다');
  assert.ok(r.ok && r.coins >= VILLAGE.request.coins[0] && r.coins <= VILLAGE.request.coins[1] && bag.coins === coins0 + r.coins, `냥코인 +${r.ok ? r.coins : 0}`);
  const next = save.friends.ink.askAt - (T0 + 20_000);
  assert.ok(save.friends.ink.ask === null && next >= VILLAGE.request.every[0] * 1000 && next <= VILLAGE.request.every[1] * 1000, '다음 부탁은 조금 뒤에');
}

// 6) 하트 · 선물: 친해질수록 하트가 늘고, 하트마다 한 번씩 선물 (요리법 · 물건 · 냥코인) — 다섯 친구와 다 친해지면 요리법 11가지를 다 안다
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  let now = T0;
  const gifts: string[] = [];
  for (const f of FRIENDS) {
    const dish = f.love[0];
    while (hearts(save.friends[f.id].pts) < 5) {
      obtain(bag, dish, 1);
      now += VILLAGE.digest * 1000;
      const r = feed(save, bag, f, dish, now);
      assert.ok(r.ok, `${f.name} 먹여 주기`);
      if (r.ok) for (const w of r.rewards) gifts.push(`${f.id}${w.level}`);
    }
    assert.deepEqual(save.friends[f.id].got.sort(), [1, 2, 3, 4, 5], `${f.name} 하트 다섯 — 선물 다섯`);
  }
  assert.equal(new Set(gifts).size, gifts.length, '선물은 한 번씩만');
  assert.equal(knownRecipes(save).length, RECIPES.length, '모두와 친해지면 요리법을 다 안다');
  assert.ok(count(bag, 'curios_06') === 3 && Object.values(bag.equip).length + bag.slots.filter((s) => s && ITEMS[s.id].type !== 'food').length >= 5, '선물이 가방에');
  assert.equal(hearts(save.friends.milk.pts + 999), 5, '하트는 다섯까지');
}

// 7) 광장 걷기: 늘 걸을 수 있는 곳 · 막힌 곳(분수)엔 안 들어간다 · 누르면 친구 · 가판대까지 걸어가 닿으면 연다
{
  const C = field.catBody;
  const s = makeVillage(seeded(6));
  assert.ok(walkable(s.cat.x, s.cat.y), '시작 자리는 광장');
  for (let i = 0; i < 400; i++) {
    updateVillage(s, { mx: Math.sin(i * 0.07), my: Math.cos(i * 0.05), act: false }, 1 / 60);
    assert.ok(walkable(s.cat.x, s.cat.y), `늘 광장 안 (${s.cat.x.toFixed(0)}, ${s.cat.y.toFixed(0)})`);
  }
  // 분수로 곧장 걸어가면 안으로 들어가지 않고 옆으로 비켜 돌아간다
  const f = makeVillage(seeded(7));
  [f.cat.x, f.cat.y] = [2020, 1540];
  const [fx, fy, frx, fry] = [VILLAGE.blocks[0].x, VILLAGE.blocks[0].y, VILLAGE.blocks[0].rx, VILLAGE.blocks[0].ry];
  for (let i = 0; i < 120; i++) {
    updateVillage(f, { mx: 0, my: -1, act: false }, 1 / 60);
    assert.ok(((f.cat.x - fx) / frx) ** 2 + ((f.cat.y - fy) / fry) ** 2 > 1, '분수 안으로는 안 들어간다');
  }
  assert.ok(f.cat.y < fy - fry, `분수를 비켜 돌아 위로 지나간다 (${f.cat.y.toFixed(0)})`);
  // 누르면 걸어가서 연다 — 친구 다섯 · 가판대, 시작 자리에서
  const targets: Target[] = [{ kind: 'kitchen' }, ...FRIENDS.map((_, i) => ({ kind: 'friend' as const, i }))];
  for (const t of targets) {
    const v = makeVillage(seeded(8));
    const [x, y] = targetAt(v, t);
    walkTo(v, x, y, t);
    let opened: Target | null = v.open;
    let secs = 0;
    for (; secs < 8 && !opened; secs += 1 / 60) {
      updateVillage(v, { mx: 0, my: 0, act: false }, 1 / 60);
      opened = v.open;
    }
    assert.deepEqual(opened, t, `${t.kind === 'kitchen' ? '가판대' : FRIENDS[t.i].name} 까지 걸어가 연다 (${secs.toFixed(1)}초)`);
    const d = Math.hypot(v.cat.x - x, (v.cat.y - y) / field.vertical) / C;
    assert.ok(d < VILLAGE.reach * 1.4, `닿은 자리 (${d.toFixed(1)}배)`);
  }
  // 가까이 서서 E — 가장 가까운 것
  const e = makeVillage(seeded(9));
  [e.cat.x, e.cat.y] = [VILLAGE.kitchen[0], VILLAGE.kitchen[1] - 2];
  updateVillage(e, { mx: 0, my: 0, act: true }, 1 / 60);
  assert.deepEqual(e.open, { kind: 'kitchen' }, '가판대 앞에서 E');
  // 곁에 서서 누르기 (2026-10-08 휴대폰 — 곁에서 누르면 안 열렸다: 누른 때 연 것을 다음 프레임 처음에 지웠다).
  // 친구 몸 · 이름표 · 머리 위 말풍선 자리 · 곁에 있을 땐 고양이를 눌러도 연다, 멀리 맨땅은 아무것도 아니다
  for (const [label, dy] of [['몸', -C * 0.5], ['이름표', -C * 1.8], ['말풍선', -C * 2.8]] as const) {
    const n = makeVillage(seeded(10));
    const p = n.townies[1];
    [n.cat.x, n.cat.y] = [p.x + 12, p.y + 6];
    updateVillage(n, { mx: 0, my: 0, act: false }, 1 / 60);
    const t = targetAtPoint(n, p.x + C * 0.3, p.y + dy);
    assert.deepEqual(t, { kind: 'friend', i: 1 }, `우유의 ${label}를 누르면 우유`);
    walkTo(n, p.x, p.y, t);
    updateVillage(n, { mx: 0, my: 0, act: false }, 1 / 60);
    assert.deepEqual(n.open, { kind: 'friend', i: 1 }, `곁에서 우유의 ${label}를 누르면 바로 말을 건다`);
  }
  const m = makeVillage(seeded(11));
  [m.cat.x, m.cat.y] = [VILLAGE.kitchen[0], VILLAGE.kitchen[1] - 2];
  updateVillage(m, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.deepEqual(targetAtPoint(m, m.cat.x, m.cat.y - C * 0.5), { kind: 'kitchen' }, '가판대 곁에선 고양이를 눌러도 가판대');
  assert.equal(targetAtPoint(m, 2030, 1540), null, '먼 맨땅(분수 아래)은 아무것도 아니다');
}

console.log('village.check: ok');
