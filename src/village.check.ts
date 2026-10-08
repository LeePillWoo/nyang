// node src/village.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { count, ITEMS, makeBag, obtain } from './bag.ts';
import field from './data/field.json' with { type: 'json' };
import shop from './data/shop.json' with { type: 'json' };
import CATS from './data/village-cats.json' with { type: 'json' };
import { FIELD, warpLocked } from './field.ts';
import { placeKind } from './places.ts';
import { shortcut } from './sources.ts';
import {
  baseAnim,
  BLOCKS,
  C,
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
  ONE_SHOT,
  play,
  prefOf,
  RECIPES,
  serve,
  setAnim,
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
const T0 = 1_000_000_000_000;

// 1) 데이터: 친구 여덟 — 시트가 있고(village-cats.json), 대사가 다 있다. 요리 · 재료 · 입맛 · 선물이 다 있는 것을 가리킨다.
//    처음 아는 요리 셋, 나머지는 친구가 하트로 알려 준다. 요리마다 좋아하는 친구가 있다. 가게 재료(우유 · 밀가루 · 달걀 · 쌀)는 고등어 상점에서 판다
{
  assert.equal(FRIENDS.length, 8, '친구 여덟');
  for (const r of RECIPES) {
    assert.ok(ITEMS[r.id]?.type === 'food' && ITEMS[r.id].emoji, `${r.id} 는 먹을 것 (emoji 아이콘)`);
    for (const [id] of r.need) assert.ok(ITEMS[id], `${r.id} 재료 ${id}`);
    assert.ok(r.start || teacher(r.id), `${ITEMS[r.id].name} — 처음부터 알거나 누군가 알려 준다`);
    assert.ok(FRIENDS.some((f) => f.love.includes(r.id) || f.like.includes(r.id)), `${ITEMS[r.id].name} 를 좋아하는 친구가 있다`);
  }
  assert.equal(RECIPES.filter((r) => r.start).length, 3, '처음 아는 요리 셋');
  const sheets = CATS as Record<string, { anims: Record<string, { fps: number; f: number[][] }> }>;
  for (const f of FRIENDS) {
    const sh = sheets[f.sheet];
    assert.ok(sh && ['idle', 'solo_play', 'angry', 'affection', 'hungry', 'bored', 'sulk', 'sleep'].every((a) => sh.anims[a]?.f.length === 6), `${f.name} 시트 ${f.sheet} — 동작 8줄 × 6컷`);
    assert.ok(f.size > 0.5 && f.size < 1.5 && f.at.length === 2, `${f.name} 크기 · 자리`);
    for (const d of [...f.love, ...f.like, ...f.dislike]) assert.ok(RECIPES.some((r) => r.id === d), `${f.name} 입맛 ${d}`);
    assert.ok(f.love.length >= 1, `${f.name} 는 아주 좋아하는 요리가 있다`);
    assert.equal(f.hello.length, 6, `${f.name} 하트마다 인사`);
    assert.ok(f.play && f.full && f.ask.includes('{dish}') && f.thanks && f.hint, `${f.name} 대사`);
    for (const [k, r] of Object.entries(f.rewards)) {
      assert.ok(Number(k) >= 1 && Number(k) <= 5 && r.say, `${f.name} ♥${k} 선물`);
      for (const id of [r.item, ...(r.items ?? []).map(([i]) => i as string)].filter(Boolean)) assert.ok(ITEMS[id as string], `${f.name} 선물 ${id}`);
    }
    assert.equal(Object.keys(f.rewards).length, 5, `${f.name} 하트 다섯 선물`);
  }
  for (const id of ['cook_milk', 'cook_flour', 'cook_egg', 'cook_rice', 'materials_02']) assert.ok(shop.stock.includes(id), `${ITEMS[id].name} 는 상점에서 판다`);
  assert.ok(VILLAGE.snacks.every((id) => ITEMS[id]?.type === 'food') && feedable('dish_03') && feedable('curios_07') && !feedable('curios_01'), '요리 · 간식만 먹여 준다 (물약은 아니다)');
}

// 2) 저장: 새 기록 · 이상한 값은 버리고 · 저장했다 불러와도 그대로
{
  const s = makeVillageSave(T0);
  assert.deepEqual(knownRecipes(s).map((r) => r.id), ['dish_01', 'dish_02', 'dish_03']);
  assert.deepEqual(fromVillageSave(null, T0), s);
  const f1 = FRIENDS[1].id;
  const odd = fromVillageSave({ friends: { [f1]: { pts: 9999, meals: ['x'], seen: { dish_03: 'love', nope: 'love' }, ask: 'nope', got: [1, 9], playedAt: 'x' } }, recipes: ['dish_05', 'zzz'], cooked: -3 }, T0);
  assert.deepEqual(odd.friends[f1], { pts: 100, meals: [], seen: { dish_03: 'love' }, ask: null, askAt: T0 + VILLAGE.request.first * 1000, got: [1], playedAt: 0 }, '이상한 값은 버린다');
  assert.deepEqual(odd.recipes, ['dish_01', 'dish_02', 'dish_03', 'dish_05']);
  assert.equal(odd.cooked, 0);
  s.friends[f1].pts = 37;
  s.friends[f1].playedAt = T0;
  s.friends[f1].meals = [T0 - 5000];
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
  for (let i = 0; i < 240; i++) {
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
  g.pos = g.c + (g.w / 2) * 0.8;
  assert.equal(stopCook(g), 2, 'good 칸이면 ★★');
  const m = startCook(bag, soup, seeded(3))!;
  m.pos = m.c + g.w;
  assert.equal(stopCook(m), 1, '바깥이면 ★');
  const b = makeBag();
  obtain(b, 'materials_06', 2);
  obtain(b, 'cook_milk', 1);
  const burnt = startCook(b, soup)!;
  let over = false;
  for (let i = 0; i < 1000 && !over; i++) over = updateCook(burnt, 1 / 60);
  assert.ok(over && Math.abs(burnt.t - VILLAGE.cook.limit) < 0.05 && stopCook(burnt, true) === 1, `${VILLAGE.cook.limit}초 안에 안 누르면 탄다 ★`);
  const full = makeBag();
  obtain(full, 'materials_06', 2);
  obtain(full, 'cook_milk', 1);
  const ck = startCook(full, soup)!;
  full.slots.forEach((v, i) => {
    if (!v) full.slots[i] = { id: 'materials_01', n: 1 }; // 재료가 빠진 뒤 빈칸을 다 채운다
  });
  ck.pos = ck.c;
  stopCook(ck);
  assert.ok(serve(makeVillageSave(T0), full, ck) === 0 && ck.lost === 3, '가방이 가득이면 못 넣는다');
}

// 4) 먹여 주기: 입맛마다 친해지는 만큼 · 세 그릇이면 배부름 · 내려가면 또 먹는다 · 먹여 본 입맛을 기억한다 · 가방에 없으면 못 준다
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  const f = FRIENDS.find((v) => v.love.length && v.dislike.length)!;
  const loved = f.love[0];
  const hated = f.dislike[0];
  const plain = RECIPES.map((r) => r.id).find((id) => prefOf(f, id) === 'normal')!;
  for (const id of [loved, hated, plain]) obtain(bag, id, 5);
  const P = VILLAGE.points;
  const r1 = feed(save, bag, f, loved, T0);
  assert.ok(r1.ok && r1.pref === 'love' && r1.gain === P.love && r1.line === f.react.love && r1.hearts === 0 && !r1.up, `${f.name} 아주 좋아하는 ${ITEMS[loved].name} → ${P.love}점`);
  const r2 = feed(save, bag, f, hated, T0 + 1000);
  assert.ok(r2.ok && r2.pref === 'dislike' && r2.gain === P.dislike && r2.line === f.react.dislike, '싫어하는 건 1점');
  const r3 = feed(save, bag, f, plain, T0 + 2000);
  assert.ok(r3.ok && r3.pref === 'normal' && r3.gain === P.normal, '보통은 5점');
  assert.equal(save.friends[f.id].pts, P.love + P.dislike + P.normal);
  assert.deepEqual(save.friends[f.id].seen, { [loved]: 'love', [hated]: 'dislike', [plain]: 'normal' }, '먹여 본 입맛을 기억한다');
  const no = feed(save, bag, f, loved, T0 + 3000);
  assert.ok(!no.ok && no.why === 'full' && no.line === f.full && count(bag, loved) === 4, '세 그릇이면 배불러서 안 먹는다 (그릇은 그대로)');
  assert.equal(fullness(save.friends[f.id], T0 + VILLAGE.digest * 1000 + 500), 2, '한 그릇씩 내려간다');
  assert.ok(feed(save, bag, f, loved, T0 + VILLAGE.digest * 1000 + 500).ok, '내려가면 또 먹는다');
  const none = feed(makeVillageSave(T0), makeBag(), f, loved, T0);
  assert.ok(!none.ok && none.why === 'none', '가방에 없으면 못 준다');
  assert.ok(!feed(makeVillageSave(T0), bag, f, 'curios_01', T0).ok, '물약은 못 먹인다');
}

// 5) 부탁: first 초 뒤 아는 요리 중 좋아하는 것을 부탁 · 들어주면 더 친해지고 냥코인, 다음 부탁은 every 초 뒤 · 인사 대신 부탁을 말한다
{
  const save = makeVillageSave(T0);
  tickRequests(save, T0 + 1000, seeded(4));
  assert.ok(FRIENDS.every((f) => save.friends[f.id].ask === null), '처음엔 부탁이 없다');
  tickRequests(save, T0 + VILLAGE.request.first * 1000 + 1, seeded(4));
  for (const f of FRIENDS) {
    const ask = save.friends[f.id].ask;
    assert.ok(ask && save.recipes.includes(ask) && !f.dislike.includes(ask), `${f.name} 는 아는 요리를 부탁한다 (${ask})`);
    assert.ok(hello(save, f).includes(ITEMS[ask].name), `${f.name} 인사 대신 부탁`);
  }
  const f = FRIENDS[2];
  const ask = save.friends[f.id].ask!;
  const bag = makeBag();
  obtain(bag, ask, 1);
  const coins0 = bag.coins;
  const now = T0 + VILLAGE.request.first * 1000 + 5000;
  const r = feed(save, bag, f, ask, now, seeded(5));
  assert.ok(r.ok && r.asked && r.gain === VILLAGE.points[prefOf(f, ask)] + VILLAGE.points.request && r.line === f.thanks, '부탁을 들어주면 더 친해진다');
  assert.ok(r.ok && r.coins >= VILLAGE.request.coins[0] && r.coins <= VILLAGE.request.coins[1] && bag.coins === coins0 + r.coins, `냥코인 +${r.ok ? r.coins : 0}`);
  const next = save.friends[f.id].askAt - now;
  assert.ok(save.friends[f.id].ask === null && next >= VILLAGE.request.every[0] * 1000 && next <= VILLAGE.request.every[1] * 1000, '다음 부탁은 조금 뒤에');
}

// 6) 하트 · 선물: 친해질수록 하트가 늘고, 하트마다 한 번씩 선물 (요리법 · 물건 · 냥코인) — 여덟 친구와 다 친해지면 요리법 11가지를 다 안다
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  const gifts: string[] = [];
  for (const f of FRIENDS) {
    const dish = f.love[0];
    let now = T0;
    let ups = 0;
    while (hearts(save.friends[f.id].pts) < 5) {
      obtain(bag, dish, 1);
      const r = feed(save, bag, f, dish, now, seeded(6));
      assert.ok(r.ok, `${f.name} 먹여 주기`);
      if (r.ok) {
        if (r.up) ups++;
        for (const g of r.rewards) gifts.push(`${f.id}:${g.level}`);
      }
      now += VILLAGE.digest * 1000 + 1;
    }
    assert.equal(ups, 5, `${f.name} 하트 다섯 번 늘었다`);
    assert.deepEqual(save.friends[f.id].got.sort(), [1, 2, 3, 4, 5], `${f.name} 하트 다섯 — 선물 다섯`);
  }
  assert.equal(new Set(gifts).size, gifts.length, '선물은 한 번씩만');
  assert.equal(knownRecipes(save).length, RECIPES.length, '모두와 친해지면 요리법을 다 안다');
}

// 7) 놀아 주기: points.play 점, 한 친구에게 playEvery 초에 한 번 (그 안엔 기다리라고 한다), 하트가 늘면 선물
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  const f = FRIENDS[3];
  const r = play(save, bag, f, T0);
  assert.ok(r.ok && r.gain === VILLAGE.points.play && r.line === f.play && save.friends[f.id].pts === VILLAGE.points.play, '놀아 주면 점수');
  const again = play(save, bag, f, T0 + 1000);
  assert.ok(!again.ok && again.wait > 0 && again.wait <= VILLAGE.playEvery, `바로 또는 안 된다 (${again.ok ? 0 : again.wait}초 뒤)`);
  assert.ok(play(save, bag, f, T0 + VILLAGE.playEvery * 1000 + 1).ok, '시간이 지나면 또');
  save.friends[f.id].pts = VILLAGE.heart - 1;
  const up = play(save, bag, f, T0 + VILLAGE.playEvery * 2000 + 2);
  assert.ok(up.ok && up.up && up.rewards.length === 1 && up.rewards[0].level === 1, '놀다가 하트가 늘면 선물');
}

// 8) 주민 동작: 배부르면 잠 · 부탁이 있으면 배고픔 · 아니면 대기. 한 번 하는 동작(놀이 · 삐짐 …)은 끝나면 바탕으로. 대기 중 심심하면 혼자 논다
{
  const save = makeVillageSave(T0);
  const fs = save.friends[FRIENDS[0].id];
  assert.equal(baseAnim(fs, T0), 'idle');
  fs.ask = 'dish_01';
  assert.equal(baseAnim(fs, T0), 'hungry', '부탁이 있으면 배고픔');
  fs.meals = [T0, T0, T0];
  assert.equal(baseAnim(fs, T0 + 1000), 'sleep', '배부르면 잠');
  assert.equal(baseAnim(fs, T0 + VILLAGE.digest * 1000 + 1), 'hungry', '한 그릇 내려가면 깬다');
  const s = makeVillage(seeded(7));
  const p = s.townies[0];
  setAnim(p, 'sulk');
  for (let i = 0; i < 60; i++) updateVillage(s, { mx: 0, my: 0, act: false }, 1 / 60, save, T0 + 1000);
  assert.equal(p.anim, 'sulk', '한 번 하는 동작은 끝날 때까지');
  for (let i = 0; i < 60 * (ONE_SHOT.sulk ?? 2) + 5; i++) updateVillage(s, { mx: 0, my: 0, act: false }, 1 / 60, save, T0 + 1000);
  assert.equal(p.anim, 'sleep', '끝나면 바탕 동작(잠)으로');
  const q = makeVillage(seeded(8));
  const seen = new Set<string>();
  for (let i = 0; i < 60 * 60; i++) {
    updateVillage(q, { mx: 0, my: 0, act: false }, 1 / 60);
    seen.add(q.townies[1].anim);
  }
  assert.ok(seen.has('idle') && (seen.has('bored') || seen.has('solo_play')), `대기 중 심심하면 혼자 논다 (${[...seen].join(', ')})`);
}

// 9) 마을 걷기: 늘 걸을 수 있는 곳 · 막힌 곳(분수)엔 안 들어간다 · 누르면 친구 · 가판대까지 걸어가 닿으면 연다 · 곁에서 누르면 바로
{
  const s = makeVillage(seeded(9));
  const rng = seeded(10);
  assert.ok(walkable(VILLAGE.start[0], VILLAGE.start[1]) && walkable(VILLAGE.kitchen[0], VILLAGE.kitchen[1]), '시작점 · 가판대 앞은 걸을 수 있다');
  for (let i = 0; i < 1800; i++) {
    const a = rng() * Math.PI * 2;
    updateVillage(s, { mx: Math.cos(a), my: Math.sin(a), act: false }, 1 / 60);
    assert.ok(walkable(s.cat.x, s.cat.y), `늘 걸을 수 있는 곳 (${s.cat.x.toFixed(0)}, ${s.cat.y.toFixed(0)})`);
  }
  const f = makeVillage(seeded(11));
  const fountain = BLOCKS[0];
  assert.ok(fountain.type === 'ellipse' && fountain.name === '분수');
  if (fountain.type !== 'ellipse') throw new Error('분수');
  [f.cat.x, f.cat.y] = [fountain.x, fountain.y + fountain.ry + C * 1.5];
  for (let i = 0; i < 240; i++) {
    updateVillage(f, { mx: 0, my: -1, act: false }, 1 / 60);
    assert.ok(((f.cat.x - fountain.x) / fountain.rx) ** 2 + ((f.cat.y - fountain.y) / fountain.ry) ** 2 > 1, '분수 안으로는 안 들어간다');
  }
  assert.ok(f.cat.y < fountain.y - fountain.ry, `분수를 비켜 돌아 위로 지나간다 (${f.cat.y.toFixed(0)})`);
  // 누르면 걸어가서 연다 — 친구 여덟 · 가판대, 시작 자리에서
  const targets: Target[] = [{ kind: 'kitchen' }, ...FRIENDS.map((_, i) => ({ kind: 'friend' as const, i }))];
  for (const t of targets) {
    const v = makeVillage(seeded(12));
    const [x, y] = targetAt(v, t);
    walkTo(v, x, y, t);
    let opened: Target | null = v.open;
    let secs = 0;
    for (; secs < 10 && !opened; secs += 1 / 60) {
      updateVillage(v, { mx: 0, my: 0, act: false }, 1 / 60);
      opened = v.open;
    }
    assert.deepEqual(opened, t, `${t.kind === 'kitchen' ? '가판대' : FRIENDS[t.i].name} 까지 걸어가 연다 (${secs.toFixed(1)}초)`);
    const d = Math.hypot(v.cat.x - x, (v.cat.y - y) / field.vertical) / C;
    assert.ok(d < VILLAGE.reach * 1.4, `닿은 자리 (${d.toFixed(1)}배)`);
  }
  // 가까이 서서 E — 가장 가까운 것
  const e = makeVillage(seeded(13));
  [e.cat.x, e.cat.y] = [VILLAGE.kitchen[0], VILLAGE.kitchen[1] + 2];
  updateVillage(e, { mx: 0, my: 0, act: true }, 1 / 60);
  assert.deepEqual(e.open, { kind: 'kitchen' }, '가판대 앞에서 E');
  // 곁에 서서 누르기 — 친구 몸 · 머리 · 머리 위 말풍선 자리 · 곁에 있을 땐 고양이를 눌러도 연다, 멀리 맨땅은 아무것도 아니다
  for (const [label, dy] of [['몸', -C * 0.5], ['머리', -C * 1.8], ['머리 위 말풍선', -C * 2.8]] as const) {
    const n = makeVillage(seeded(14));
    const p = n.townies[1];
    [n.cat.x, n.cat.y] = [p.x + C * 0.7, p.y + C * 0.3];
    updateVillage(n, { mx: 0, my: 0, act: false }, 1 / 60);
    const t = targetAtPoint(n, p.x + C * 0.3, p.y + dy);
    assert.deepEqual(t, { kind: 'friend', i: 1 }, `${FRIENDS[1].name}의 ${label}를 누르면 ${FRIENDS[1].name}`);
    walkTo(n, p.x, p.y, t);
    updateVillage(n, { mx: 0, my: 0, act: false }, 1 / 60);
    assert.deepEqual(n.open, { kind: 'friend', i: 1 }, `곁에서 ${FRIENDS[1].name}의 ${label}를 누르면 바로 말을 건다`);
  }
  const m = makeVillage(seeded(15));
  [m.cat.x, m.cat.y] = [VILLAGE.kitchen[0], VILLAGE.kitchen[1] + 2];
  updateVillage(m, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.deepEqual(targetAtPoint(m, m.cat.x, m.cat.y - C * 0.5), { kind: 'kitchen' }, '가판대 곁에선 고양이를 눌러도 가판대');
  assert.equal(targetAtPoint(m, VILLAGE.center[0] - 60, VILLAGE.center[1] + 60), null, '먼 맨땅은 아무것도 아니다');
}

// 10) 재료 바로가기 · 장소 종류: 요리 재료마다 열린 구역의 가지러 갈 포탈이 있다 (상점 · 낚시터 · 던전 · 숲). 돌다리 · 동굴은 던전이 아니다, 골목은 풍차 밀밭
{
  const need = [...new Set(RECIPES.flatMap((r) => r.need.map(([id]) => id)))];
  for (const id of need) {
    const go = shortcut(id);
    assert.ok(go && !warpLocked(go.warp) && go.warp.to, `${ITEMS[id].name} 가지러 갈 곳 (${go?.warp.label} — ${go?.why})`);
  }
  assert.equal(placeKind(shortcut('cook_fish')!.warp.to), 'fish', `생선은 가까운 낚시터 (${shortcut('cook_fish')!.warp.label})`);
  assert.equal(shortcut('cook_milk')!.warp.to, 'shop', '우유는 상점');
  assert.ok(['dungeon', 'mini'].includes(placeKind(shortcut('materials_05')!.warp.to)), '도토리는 던전이나 다람쥐 잡기');
  const by = (id: string) => FIELD.warps.find((w) => w.id === id)!;
  assert.equal(by('stone_bridge').to, '', '돌다리는 던전에서 뺐다');
  assert.equal(by('windmill_field').to, 'alley', '골목 던전은 풍차 밀밭으로');
  const caves = FIELD.warps.filter((w) => w.id.endsWith('_cave') && !w.to);
  assert.equal(caves.length, 7, '동굴 입구 일곱 — 모두 연결 전');
  for (const w of caves) assert.equal(placeKind(w.to, w.id), 'cave', `${w.label} 은 동굴 (던전 아님)`);
  assert.equal(placeKind('cave_fishing', 'crystal_cave'), 'fish', '수정 동굴 입구는 낚시터로 이어진다');
  assert.equal(placeKind('village'), 'village');
  assert.equal(placeKind('alley'), 'dungeon');
}

console.log('village.check: ok');
