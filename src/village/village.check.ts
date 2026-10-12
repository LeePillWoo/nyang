// node src/village.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { count, ITEMS, makeBag, obtain } from '../bag/bag.ts';
import field from '../data/field.json' with { type: 'json' };
import shop from '../data/shop.json' with { type: 'json' };
import CATS from '../data/village-cats.json' with { type: 'json' };
import { FIELD, warpLocked } from '../field/field.ts';
import { placeKind } from '../shared/places.ts';
import { shortcut } from '../bag/sources.ts';
import { ballAt, BOX, FEATHER, isToy, makeToy, starsOf, TOY_IDS, TOYS, toyPick, toyPress, updateToy, YARN, type BoxGame, type FeatherGame, type YarnGame } from './toys.ts';
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
  playToy,
  playWait,
  prefOf,
  RECIPES,
  serve,
  setAnim,
  startCook,
  stopCook,
  talkTo,
  targetAt,
  targetAtPoint,
  teacher,
  tickRequests,
  updateCook,
  updateVillage,
  VILLAGE,
  walkable,
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
/** 고르게 섞인 무작위 (확률을 세는 시험용 — 위 seeded 는 이어지는 값이 서로 닮아 비율이 틀어진다) */
const mixed = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

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
  assert.ok(TOY_IDS.every((t) => FRIENDS.some((f) => f.toy === t)), '놀이마다 좋아하는 친구가 있다');
  const sheets = CATS as Record<string, { anims: Record<string, { fps: number; f: number[][] }> }>;
  for (const f of FRIENDS) {
    const sh = sheets[f.sheet];
    assert.ok(sh && ['idle', 'solo_play', 'angry', 'affection', 'hungry', 'bored', 'sulk', 'sleep'].every((a) => sh.anims[a]?.f.length === 6), `${f.name} 시트 ${f.sheet} — 동작 8줄 × 6컷`);
    assert.ok(f.size > 0.5 && f.size < 1.5 && f.at.length === 2, `${f.name} 크기 · 자리`);
    for (const d of [...f.love, ...f.like, ...f.dislike]) assert.ok(RECIPES.some((r) => r.id === d), `${f.name} 입맛 ${d}`);
    assert.ok(f.love.length >= 1, `${f.name} 는 아주 좋아하는 요리가 있다`);
    assert.equal(f.hello.length, 6, `${f.name} 하트마다 인사`);
    assert.ok(f.play && f.full && f.ask.includes('{dish}') && f.thanks && f.hint, `${f.name} 대사`);
    assert.ok(TOY_IDS.includes(f.toy) && f.askPlay.includes('{toy}'), `${f.name} 좋아하는 놀이 ${f.toy} · 놀자 대사`);
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
  const odd = fromVillageSave({ friends: { [f1]: { pts: 9999, meals: ['x'], seen: { dish_03: 'love', nope: 'love' }, ask: 'nope', got: [1, 9], playedAt: 'x', games: { feather: 2, nope: 5, box: 'x' } } }, recipes: ['dish_05', 'zzz'], cooked: -3 }, T0);
  assert.deepEqual(odd.friends[f1], { pts: 100, meals: [], seen: { dish_03: 'love' }, ask: null, askAt: T0 + VILLAGE.request.first * 1000, got: [1], playedAt: 0, games: { feather: 2 } }, '이상한 값은 버린다');
  assert.equal(fromVillageSave({ friends: { [f1]: { ask: 'box' } } }, T0).friends[f1].ask, 'box', '놀자는 부탁도 저장된다');
  assert.deepEqual(odd.recipes, ['dish_01', 'dish_02', 'dish_03', 'dish_05']);
  assert.equal(odd.cooked, 0);
  s.friends[f1].pts = 37;
  s.friends[f1].playedAt = T0;
  s.friends[f1].meals = [T0 - 5000];
  s.friends[f1].games = { yarn: 3 };
  s.friends[f1].ask = 'feather';
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

// 5) 부탁: first 초 뒤 — 아는 요리 중 좋아하는 것 또는 놀자 (play.ask 확률) · 들어주면 더 친해지고 냥코인, 다음 부탁은 every 초 뒤 · 인사 대신 부탁을 말한다
//    (2026-10-08 밤 사용자: 다들 밥만 달라고 하고 배부르면 자 버린다 — 놀자고도 한다, 배가 부르면 늘 놀자)
{
  const save = makeVillageSave(T0);
  tickRequests(save, T0 + 1000, seeded(4));
  assert.ok(FRIENDS.every((f) => save.friends[f.id].ask === null), '처음엔 부탁이 없다');
  let food = 0;
  let toys = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const v = makeVillageSave(T0);
    tickRequests(v, T0 + VILLAGE.request.first * 1000 + 1, mixed(seed));
    for (const f of FRIENDS) {
      const ask = v.friends[f.id].ask;
      if (isToy(ask)) {
        toys++;
        assert.ok(hello(v, f).includes(TOYS[ask].name), `${f.name} 인사 대신 놀자`);
      } else {
        food++;
        assert.ok(ask && v.recipes.includes(ask) && !f.dislike.includes(ask), `${f.name} 는 아는 요리를 부탁한다 (${ask})`);
        assert.ok(hello(v, f).includes(ITEMS[ask].name), `${f.name} 인사 대신 부탁`);
      }
    }
  }
  const share = toys / (food + toys);
  assert.ok(Math.abs(share - VILLAGE.play.ask) < 0.1, `부탁 중 놀자는 ${(share * 100).toFixed(0)}% (play.ask ${VILLAGE.play.ask * 100}%)`);
  // 배가 부르면 늘 놀자고 한다
  const full = makeVillageSave(T0);
  for (const f of FRIENDS) full.friends[f.id].meals = [T0, T0, T0];
  tickRequests(full, T0 + VILLAGE.request.first * 1000 + 1, seeded(9));
  assert.ok(FRIENDS.every((f) => isToy(full.friends[f.id].ask)), '배가 부르면 놀자고 한다');
  // 요리 부탁을 들어주기 — 요리를 부탁한 친구로
  tickRequests(save, T0 + VILLAGE.request.first * 1000 + 1, seeded(4));
  const f = FRIENDS.find((v) => { const a = save.friends[v.id].ask; return !!a && !isToy(a); })!;
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

// 7) 놀아 주기 미니게임 (2026-10-08 밤 — 깃털 흔들기 · 상자 숨바꼭질 · 털실 공 굴리기): 별(1~3) → 친해짐 play.points, 좋아하는 놀이면 play.fav 배,
//    놀자는 부탁이 그 놀이면 points.request · 냥코인, 한 친구와 play.every 초에 한 번 (놀자고 부탁했으면 언제든), 놀아 본 놀이를 센다, 배부르면 곧 놀자고 한다
{
  const save = makeVillageSave(T0);
  const bag = makeBag();
  const f = FRIENDS[3];
  const other = TOY_IDS.find((t) => t !== f.toy)!;
  assert.equal(playWait(save.friends[f.id], T0), 0, '처음엔 바로 놀 수 있다');
  const r1 = playToy(save, bag, f, other, 2, T0);
  assert.ok(r1.gain === VILLAGE.play.points[2] && !r1.fav && !r1.asked && r1.coins === 0 && save.friends[f.id].games[other] === 1 && r1.line === VILLAGE.play.lines[2], `★★ 다른 놀이 → +${r1.gain} · "${r1.line}"`);
  const wait = playWait(save.friends[f.id], T0 + 1000);
  assert.ok(wait > 0 && wait <= VILLAGE.play.every, `바로 또는 못 논다 (${wait}초 뒤)`);
  assert.equal(playWait(save.friends[f.id], T0 + VILLAGE.play.every * 1000 + 1), 0, '시간이 지나면 또');
  const r2 = playToy(save, bag, f, f.toy, 3, T0 + VILLAGE.play.every * 1000 + 1);
  assert.ok(r2.fav && r2.gain === Math.round(VILLAGE.play.points[3] * VILLAGE.play.fav) && r2.line === f.play, `★★★ 좋아하는 놀이 → +${r2.gain} · "${r2.line}"`);
  // 놀자는 부탁: 쉬는 중이어도 · 그 놀이를 하면 냥코인 · 부탁 점수
  save.friends[f.id].ask = other;
  assert.equal(playWait(save.friends[f.id], T0 + VILLAGE.play.every * 1000 + 2), 0, '놀자고 부탁했으면 언제든');
  const coins0 = bag.coins;
  const r3 = playToy(save, bag, f, other, 1, T0 + VILLAGE.play.every * 1000 + 3, seeded(3));
  assert.ok(r3.asked && r3.gain === VILLAGE.play.points[1] + VILLAGE.points.request && r3.coins >= VILLAGE.request.coins[0] && bag.coins === coins0 + r3.coins && save.friends[f.id].ask === null, `놀자는 부탁을 들어주면 +${r3.gain} · 냥코인 ${r3.coins}`);
  // 하트가 늘면 선물
  const g = makeVillageSave(T0);
  g.friends[f.id].pts = VILLAGE.heart - 1;
  const up = playToy(g, makeBag(), f, f.toy, 1, T0);
  assert.ok(up.up && up.rewards.length === 1 && up.rewards[0].level === 1, '놀다가 하트가 늘면 선물');
  // 배부르면 곧 놀자고 한다 (잠만 자지 않게)
  const m = makeVillageSave(T0);
  const fm = FRIENDS[0];
  const mb = makeBag();
  obtain(mb, fm.love[0], 3);
  for (let i = 0; i < VILLAGE.full; i++) feed(m, mb, fm, fm.love[0], T0 + i * 1000);
  assert.ok(m.friends[fm.id].askAt <= T0 + (VILLAGE.full - 1) * 1000 + VILLAGE.play.afterMeal * 1000, '배가 부르면 afterMeal 초 뒤 부탁');
  tickRequests(m, T0 + VILLAGE.full * 1000 + VILLAGE.play.afterMeal * 1000, seeded(2));
  assert.ok(isToy(m.friends[fm.id].ask), `배부른 ${fm.name}는 놀자고 한다 (${m.friends[fm.id].ask})`);
}

// 7-2) 미니게임 셋 — 잘하면 ★★★, 못하면 ★ (했으면 적어도 하나)
{
  assert.deepEqual([0, 1, 2, 3, 5].map(starsOf), [1, 1, 2, 3, 3], '점수 → 별');
  const DT = 1 / 60;
  // 깃털: 친구 앞에서 흔들어 신나게 → 씰룩이면 멈춰 두면 잡는다 / 씰룩일 때 홱 빼면 놓친다
  const feather = (hold: boolean) => {
    const g = makeToy('feather', seeded(1)) as FeatherGame;
    let crouches = 0;
    let frames = 0;
    while (g.phase === 'play' && frames++ < 40 / DT) {
      let x: number | null = 0.3 * Math.sin(g.t * 9); // 친구 앞에서 흔들기
      if (g.cat === 'crouch' || g.cat === 'pounce') x = hold ? g.aim : g.aim > 0 ? -1 : 1;
      updateToy(g, { x, dir: 0 }, DT);
      crouches += g.events.filter((e) => e.type === 'crouch').length;
    }
    return { g, crouches };
  };
  const good = feather(true);
  assert.ok(good.g.phase === 'done' && good.g.t >= FEATHER.time && good.g.score >= 3 && good.g.stars === 3, `깃털: 흔들다 멈춰 주면 ${good.g.score}번 잡는다 (씰룩 ${good.crouches}번)`);
  const bad = feather(false);
  assert.ok(bad.g.score === 0 && bad.crouches >= 3 && bad.g.stars === 1, `씰룩일 때 빼면 못 잡는다 (씰룩 ${bad.crouches}번)`);
  // 놓친 수를 센다 — FEATHER.tip 번 놓치면 그다음 씰룩부터 "지금 멈추세요!" 말풍선 (그리기는 toys-draw)
  assert.ok(bad.g.misses === bad.crouches && good.g.misses === 0 && bad.g.misses > FEATHER.tip, `놓친 수 ${bad.g.misses} (잘 잡으면 ${good.g.misses})`);
  const still = makeToy('feather', seeded(1)) as FeatherGame;
  for (let i = 0; i < 20 / DT && still.phase === 'play'; i++) updateToy(still, { x: 0, dir: 0 }, DT);
  assert.ok(still.score === 0 && still.ex === 0, '가만히 두면 신나지 않는다');
  const keys = makeToy('feather', seeded(1)) as FeatherGame;
  for (let i = 0; i < 30; i++) updateToy(keys, { x: null, dir: -1 }, DT);
  assert.ok(keys.fx < 0.6 - FEATHER.speed * 0.4, '키로도 움직인다');
  // 상자: 친구가 든 상자를 끝까지 따라가면 다 맞힌다 · 늘 1번이면 우연만큼
  const box = (follow: boolean, seed: number) => {
    const g = makeToy('box', seeded(seed)) as BoxGame;
    let swaps = 0;
    for (let i = 0; i < 60 / DT && g.phase === 'play'; i++) {
      updateToy(g, { x: null, dir: 0 }, DT);
      swaps += g.events.filter((e) => e.type === 'swap').length;
      if (g.stage === 'pick') toyPick(g, follow ? g.slots[g.cat] : 0);
    }
    return { g, swaps };
  };
  const b1 = box(true, 3);
  assert.ok(b1.g.phase === 'done' && b1.g.score === BOX.rounds && b1.g.stars === 3 && b1.swaps === BOX.swaps.reduce((a, b) => a + b, 0), `상자: 따라가면 ${b1.g.score}/${BOX.rounds} (섞기 ${b1.swaps}번)`);
  let lucky = 0;
  for (let seed = 1; seed <= 30; seed++) lucky += box(false, seed).g.score;
  assert.ok(lucky / 30 > 0.5 && lucky / 30 < 1.6, `아무거나 고르면 우연만큼 (${(lucky / 30).toFixed(2)}판)`);
  // 공: 힘을 친구 자리에서 멈추면 덮친다 · 너무 약하면 짧고 · 세면 지나친다
  const yarn = (at: (g: YarnGame) => number) => {
    const g = makeToy('yarn', seeded(5)) as YarnGame;
    const res: string[] = [];
    for (let i = 0; i < 40 / DT && g.phase === 'play'; i++) {
      if (g.stage === 'aim' && Math.abs(g.power - at(g)) < 0.02) toyPress(g);
      updateToy(g, { x: null, dir: 0 }, DT);
      for (const e of g.events) if (e.type === 'hit' || e.type === 'short' || e.type === 'long') res.push(e.type);
    }
    return { g, res };
  };
  const y1 = yarn((g) => g.spot);
  assert.ok(y1.g.phase === 'done' && y1.g.score === YARN.throws && y1.g.stars === 3, `공: 친구 자리에서 멈추면 ${y1.res.join(' ')}`);
  assert.deepEqual(yarn(() => 0.05).res, ['short', 'short', 'short'], '약하면 짧다');
  assert.deepEqual(yarn(() => 0.99).res, ['long', 'long', 'long'], '세면 지나친다');
  const roll = makeToy('yarn', seeded(1)) as YarnGame;
  roll.power = 0.6;
  toyPress(roll);
  updateToy(roll, { x: null, dir: 0 }, YARN.roll / 2);
  assert.ok(ballAt(roll) > 0.3 && ballAt(roll) < 0.6, '공은 굴러가며 느려진다');
  updateToy(roll, { x: null, dir: 0 }, YARN.roll / 2 + 0.01);
  const stops: number[] = [];
  for (let i = 0; i < 10 && roll.stage === 'after'; i++) {
    stops.push(ballAt(roll));
    updateToy(roll, { x: null, dir: 0 }, YARN.after / 12);
  }
  assert.ok(stops.length > 5 && stops.every((d) => d === roll.dist), `멈춘 공은 그 자리 — 한 번 더 굴러 보이지 않는다 (${stops.map((d) => d.toFixed(2)).join(' ')})`);
  // 힘 막대: 한쪽 끝에서 다른 끝까지 가장 빠른 판도 0.5초 넘게 (2026-10-12 사용자 — 빠르다)
  assert.ok(1 / (2 * Math.max(...YARN.speed)) > 0.5, `힘 막대 0 → 1 이 ${(1 / (2 * Math.max(...YARN.speed))).toFixed(2)}초 넘게`);
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
  fs.ask = 'feather';
  assert.equal(baseAnim(fs, T0 + 1000), 'bored', '놀자고 하면 심심 (배불러도 자지 않는다)');
  fs.ask = 'dish_01';
  const s = makeVillage(seeded(7));
  const p = s.townies[0];
  setAnim(p, 'sulk');
  for (let i = 0; i < 60; i++) updateVillage(s, { mx: 0, my: 0, act: false }, 1 / 60, save, T0 + 1000);
  assert.equal(p.anim, 'sulk', '한 번 하는 동작은 끝날 때까지');
  for (let i = 0; i < 60 * (ONE_SHOT.sulk ?? 2) + 5; i++) updateVillage(s, { mx: 0, my: 0, act: false }, 1 / 60, save, T0 + 1000);
  assert.equal(p.anim, 'sleep', '끝나면 바탕 동작(잠)으로');
  save.friends[FRIENDS[0].id].ask = 'box';
  for (let i = 0; i < 60 * 8; i++) updateVillage(s, { mx: 0, my: 0, act: false }, 1 / 60, save, T0 + 1000);
  assert.ok(p.anim === 'bored' && p.animT < (ONE_SHOT.bored ?? 3) + 0.05, '놀자고 하면 심심 동작을 되풀이한다');
  const q = makeVillage(seeded(8));
  const seen = new Set<string>();
  for (let i = 0; i < 60 * 60; i++) {
    updateVillage(q, { mx: 0, my: 0, act: false }, 1 / 60);
    seen.add(q.townies[1].anim);
  }
  assert.ok(seen.has('idle') && (seen.has('bored') || seen.has('solo_play')), `대기 중 심심하면 혼자 논다 (${[...seen].join(', ')})`);
}

// 9) 마을 걷기: 늘 걸을 수 있는 곳 · 막힌 곳(분수)엔 안 들어간다 · 시작 자리에서 친구 · 가판대 곁까지 걸어서 닿는다 ·
//    누르기 · 클릭은 곁에서 말 걸기만 — 빈 곳이나 먼 것을 누르면 걷지 않는다 (2026-10-12 사용자 — 터치 이동 제거, 걷기는 WASD · 조이스틱으로만)
{
  const s = makeVillage(seeded(9));
  const rng = seeded(10);
  assert.ok(walkable(VILLAGE.start[0], VILLAGE.start[1]), '시작점은 걸을 수 있다');
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
  // 시작 자리에서 걸어서 친구 여덟 · 가판대 곁(말 거는 거리)까지 닿는다 — 걸을 수 있는 16px 칸을 너비 우선으로 퍼뜨려 본다
  const CELL = 16;
  const cols = Math.ceil(VILLAGE.size[0] / CELL);
  const rows = Math.ceil(VILLAGE.size[1] / CELL);
  const reached = [[Math.floor(VILLAGE.start[0] / CELL), Math.floor(VILLAGE.start[1] / CELL)]];
  const seen = new Set([reached[0][1] * cols + reached[0][0]]);
  for (let q = 0; q < reached.length; q++) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [c, r] = [reached[q][0] + dc, reached[q][1] + dr];
      if (c < 0 || r < 0 || c >= cols || r >= rows || seen.has(r * cols + c) || !walkable((c + 0.5) * CELL, (r + 0.5) * CELL)) continue;
      seen.add(r * cols + c);
      reached.push([c, r]);
    }
  }
  const targets: Target[] = [{ kind: 'kitchen' }, ...FRIENDS.map((_, i) => ({ kind: 'friend' as const, i }))];
  const v = makeVillage(seeded(12));
  for (const t of targets) {
    const d = Math.min(
      ...reached.map(([c, r]) => {
        [v.cat.x, v.cat.y] = [(c + 0.5) * CELL, (r + 0.5) * CELL];
        const [x, y] = targetAt(v, t); // 가판대는 그 자리에서 가장 가까운 앞줄 점
        return Math.hypot(v.cat.x - x, (v.cat.y - y) / field.vertical) / C;
      }),
    );
    assert.ok(d < VILLAGE.reach * 0.8, `${t.kind === 'kitchen' ? '가판대' : FRIENDS[t.i].name} 곁까지 걸어서 닿는다 (${d.toFixed(2)}배)`);
  }
  // 요리집 앞에 바짝 붙어 서면 어디서든 E 로 가판대 (2026-10-12 사용자 — 가장 가까이 붙었는데 안 열렸다):
  //  앞줄의 x 마다 요리집 · 화분 안에서 아래로 내려와 처음 걸을 수 있는 자리 (막힌 곳에 딱 붙은 자리)
  const [[kx0, ky], [kx1]] = VILLAGE.kitchen;
  const hug = (x: number) => {
    let y = ky - 40;
    while (!walkable(x, y) && y < ky + 80) y += 1;
    return y;
  };
  for (let x = kx0 - 8; x <= kx1 + 8; x += 6) {
    const e = makeVillage(seeded(13));
    [e.cat.x, e.cat.y] = [x, hug(x)];
    updateVillage(e, { mx: 0, my: 0, act: true }, 1 / 60);
    assert.deepEqual(e.open, { kind: 'kitchen' }, `요리집 앞 (${x}, ${e.cat.y}) 에 바짝 붙어 E 면 가판대`);
  }
  // 요리집 문 옆 구름 곁(오른쪽 · 아래)에선 구름 — 가판대가 가로채지 않는다
  for (const [dx, dy] of [[C * 0.8, C * 0.2], [C * 0.2, C * 0.7]]) {
    const e = makeVillage(seeded(13));
    [e.cat.x, e.cat.y] = [e.townies[0].x + dx, e.townies[0].y + dy];
    updateVillage(e, { mx: 0, my: 0, act: true }, 1 / 60);
    assert.deepEqual(e.open, { kind: 'friend', i: 0 }, `${FRIENDS[0].name} 곁 (+${dx.toFixed(0)}, +${dy.toFixed(0)}) 에선 ${FRIENDS[0].name}`);
  }
  // 곁에 서서 누르기 — 친구 몸 · 머리 · 머리 위 말풍선 자리 · 곁에 있을 땐 고양이를 눌러도 연다, 멀리 맨땅은 아무것도 아니다
  for (const [label, dy] of [['몸', -C * 0.5], ['머리', -C * 1.8], ['머리 위 말풍선', -C * 2.8]] as const) {
    const n = makeVillage(seeded(14));
    const p = n.townies[1];
    [n.cat.x, n.cat.y] = [p.x + C * 0.7, p.y + C * 0.3];
    updateVillage(n, { mx: 0, my: 0, act: false }, 1 / 60);
    const t = targetAtPoint(n, p.x + C * 0.3, p.y + dy);
    assert.deepEqual(t, { kind: 'friend', i: 1 }, `${FRIENDS[1].name}의 ${label}를 누르면 ${FRIENDS[1].name}`);
    talkTo(n, t);
    updateVillage(n, { mx: 0, my: 0, act: false }, 1 / 60);
    assert.deepEqual(n.open, { kind: 'friend', i: 1 }, `곁에서 ${FRIENDS[1].name}의 ${label}를 누르면 바로 말을 건다`);
  }
  const m = makeVillage(seeded(15));
  [m.cat.x, m.cat.y] = [(kx0 + kx1) / 2, hug((kx0 + kx1) / 2)];
  updateVillage(m, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.deepEqual(targetAtPoint(m, m.cat.x, m.cat.y - C * 0.5), { kind: 'kitchen' }, '가판대 곁에선 고양이를 눌러도 가판대');
  assert.equal(targetAtPoint(m, VILLAGE.center[0] - 60, VILLAGE.center[1] + 60), null, '먼 맨땅은 아무것도 아니다');
  // 누르기는 걷지 않는다: 멀리 있는 친구 · 빈 곳을 누르면 그대로, 곁이면 바로 연다
  const far = makeVillage(seeded(16));
  const at0 = [far.cat.x, far.cat.y];
  const went = talkTo(far, { kind: 'friend', i: 1 }) || talkTo(far, targetAtPoint(far, VILLAGE.center[0] - 60, VILLAGE.center[1] + 60));
  for (let i = 0; i < 60; i++) updateVillage(far, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.ok(!went && !far.talk && far.open === null && far.cat.x === at0[0] && far.cat.y === at0[1], '멀리 있는 친구 · 빈 곳을 누르면 걷지 않는다');
  const nb = makeVillage(seeded(17));
  [nb.cat.x, nb.cat.y] = [nb.townies[1].x + C * 0.7, nb.townies[1].y + C * 0.3];
  updateVillage(nb, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.ok(talkTo(nb, targetAtPoint(nb, nb.townies[1].x, nb.townies[1].y - C * 0.5)));
  updateVillage(nb, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.deepEqual(nb.open, { kind: 'friend', i: 1 }, '곁에서 누르면 바로 말을 건다');
}

// 10) 재료 바로가기 · 장소 종류: 요리 재료마다 열린 구역의 가지러 갈 포탈이 있다 (상점 · 낚시터 · 던전 · 숲). 돌다리 · 동굴은 던전이 아니다, 골목은 풍차 밀밭
{
  const need = [...new Set(RECIPES.flatMap((r) => r.need.map(([id]) => id)))];
  for (const id of need) {
    const go = shortcut(id);
    assert.ok(go && !warpLocked(go.warp) && go.warp.to, `${ITEMS[id].name} 가지러 갈 곳 (${go?.warp.label} — ${go?.why})`);
  }
  assert.equal(placeKind(shortcut('cook_fish')!.warp.to), 'fish', `생선은 가까운 낚시터 (${shortcut('cook_fish')!.warp.label})`);
  assert.equal(shortcut('cook_milk')!.warp.to, 'dogtown', '우유는 강아지마을 고등어 상점');
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
