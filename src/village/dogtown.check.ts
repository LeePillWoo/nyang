// node src/village/dogtown.check.ts  (npm run check) — 강아지마을: 길드 · 대장간 · 우체국 · 탐험가 · 구조대 · 로프 · 마을 걷기
import assert from 'node:assert/strict';
import { count, forgeLevel, ITEMS, itemStats, makeBag, MAX_FP, obtain, stats } from '../bag/bag.ts';
import data from '../data/dogtown.json' with { type: 'json' };
import DOG_SHEETS from '../data/village-dogs.json' with { type: 'json' };
import field from '../data/field.json' with { type: 'json' };
import { FIELD, tileOpen } from '../field/field.ts';
import { placeKind } from '../shared/places.ts';
import { shortcut } from '../bag/sources.ts';
import {
  acceptOrder,
  acceptRescue,
  CALLS,
  callWait,
  DC,
  deliver,
  dig,
  digSpot,
  dogAtPoint,
  dogLine,
  DOGS,
  dogTalkTo,
  dropOrder,
  fromDogSave,
  makeDogSave,
  makeDogtown,
  postOffer,
  readMap,
  RECIPIENTS,
  rescueDone,
  rescueSpot,
  sniffWait,
  tickRescue,
  updateDogtown,
  walkableDog,
} from './dogtown.ts';
import { applyForge, forgeCost, forgeList, HAMMER, hammerIn, hammerPress, makeHammer, merge, mergeTarget, payForge, updateHammer } from './forge.ts';
import { fillBoard, noteGuild, progressOf, QUESTS, questDef, rankOf, reroll, turnIn, type GuildEvent } from './guild.ts';
import { makeRope, ROPE, updateRope, type Rope } from './rope.ts';
const ropePress = (r: Rope, side: -1 | 1) => updateRope(r, [side], 0);

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const NOW = 1_000_000;

// 1) 데이터 짝: 주민 여덟(일이 겹치지 않음 · 시트 동작 8줄) · 의뢰 종류 · 재료 · 배달 물건 · 보물 · 출동 · 필드 자리는 열린 구역
{
  assert.equal(DOGS.length, 8);
  assert.equal(new Set(DOGS.map((d) => d.job)).size, 8, '일이 겹치지 않는다');
  const sheets = DOG_SHEETS as Record<string, { anims: Record<string, { f: number[][] }> }>;
  for (const d of DOGS) {
    const a = sheets[d.sheet];
    assert.ok(a, `${d.name} 시트`);
    for (const an of ['idle', 'greet', 'job_a', 'job_b', 'job_c', 'affection']) assert.equal(a.anims[an]?.f.length, 6, `${d.name} ${an} 6컷`);
  }
  const TYPES = ['kill', 'elite', 'clear', 'fish', 'bigfish', 'salvage', 'timber', 'chase', 'maze', 'sand', 'cook', 'item', 'forage', 'rescue', 'post', 'treasure', 'forge', 'train'];
  assert.ok(QUESTS.length >= 10, '의뢰 10가지 넘게');
  for (const q of QUESTS) {
    assert.ok(TYPES.includes(q.type), `의뢰 ${q.id} 종류`);
    assert.ok(q.n > 0 && q.coins > 0 && q.gp > 0, `의뢰 ${q.id} 수치`);
    if (q.type === 'item') assert.ok(ITEMS[q.item!], `의뢰 ${q.id} 물건`);
  }
  assert.equal(new Set(QUESTS.map((q) => q.id)).size, QUESTS.length, '의뢰 id 겹침 없음');
  for (const need of data.forge.need) for (const [id] of need as [string, number][]) assert.ok(ITEMS[id], `대장간 재료 ${id}`);
  assert.equal(data.forge.need.length, 5, '+1 ~ +5');
  for (const [id] of data.post.items as [string, number][]) assert.ok(ITEMS[id], `배달 물건 ${id}`);
  for (const [id] of data.explorer.loot as [string, number][]) assert.ok(ITEMS[id], `보물 ${id}`);
  assert.ok(ITEMS[data.explorer.map], '말린 지도');
  const [W, H] = FIELD.size;
  const [cols, rows] = FIELD.grid;
  const open = (x: number, y: number) => tileOpen(Math.floor((y / H) * rows), Math.floor((x / W) * cols));
  for (const sp of data.explorer.spots) assert.ok(open(sp.at[0], sp.at[1]), `보물 자리 ${sp.hint} 는 열린 구역`);
  for (const c of CALLS) assert.ok(open(c.at[0], c.at[1]) && ['tree', 'boat', 'pit'].includes(c.kind), `출동 ${c.place}`);
  assert.equal(RECIPIENTS.length, 15, '배달 받는 이 — 고양이 여덟 · 총총(우체부)을 뺀 강아지 일곱');
  // 강아지마을 포탈 · 장소 종류 · 상점 재료 바로가기는 강아지마을로
  const w = field.warps.find((v) => v.id === 'dog_village')!;
  assert.equal(w.to, 'dogtown', '강아지마을 포탈은 마을로');
  assert.equal(placeKind('dogtown'), 'village');
  assert.equal(shortcut('cook_milk')!.warp.to, 'dogtown', '우유는 강아지마을 고등어 상점');
}

// 2) 길드: 게시판 세 칸(서로 다름) · 다른 장면의 일로 진행 · 다 되면 보고 → 냥코인 · 점수 · 새 의뢰 · 납품은 물건을 가져간다 · 바꾸기 · 등급
{
  const g = { gp: 0, done: 0, quests: [] as { id: string; p: number }[] };
  fillBoard(g, seeded(1));
  assert.equal(g.quests.length, data.guild.board);
  assert.equal(new Set(g.quests.map((q) => q.id)).size, g.quests.length, '게시판 의뢰는 서로 다르다');
  const bag = makeBag();
  const set = (...ids: string[]) => (g.quests = ids.map((id) => ({ id, p: 0 })));
  set('hunt', 'elite', 'fish');
  for (let i = 0; i < 14; i++) noteGuild(g, { type: 'kill', elite: false }, bag);
  assert.deepEqual(noteGuild(g, { type: 'kill', elite: true }, bag), ['던전 몬스터 퇴치', '정예 사냥'], '15마리째 · 정예 → 둘 다 완료 알림');
  assert.equal(progressOf(g.quests[1], bag), 1);
  noteGuild(g, { type: 'fish', big: true }, bag);
  assert.equal(g.quests[2].p, 1, '월척도 물고기');
  set('bigfish', 'timber', 'logs');
  noteGuild(g, { type: 'fish', big: false }, bag);
  assert.equal(g.quests[0].p, 0, '보통 물고기는 월척 의뢰에 안 센다');
  noteGuild(g, { type: 'timber', score: 18 }, bag);
  noteGuild(g, { type: 'timber', score: 12 }, bag);
  assert.equal(g.quests[1].p, 18, '한 판 점수는 가장 좋은 판');
  assert.deepEqual(noteGuild(g, { type: 'timber', score: 31 }, bag), ['장작 쌓기']);
  obtain(bag, 'materials_01', 3);
  assert.equal(progressOf(g.quests[2], bag), 3, '납품은 가방에 있는 개수');
  const no = turnIn(g, bag, 2, seeded(2));
  assert.ok(!no.ok, '모자라면 보고 못 함');
  obtain(bag, 'materials_01', 4);
  const coins = bag.coins;
  const ok = turnIn(g, bag, 2, seeded(2));
  assert.ok(ok.ok && ok.coins === questDef('logs').coins && ok.gp === questDef('logs').gp);
  assert.equal(count(bag, 'materials_01'), 2, '납품하면 길드가 가져간다');
  assert.equal(bag.coins, coins + questDef('logs').coins);
  assert.equal(g.done, 1);
  assert.equal(g.quests.length, 3);
  assert.ok(!g.quests.some((q) => q.id === 'logs'), '방금 마친 의뢰는 바로 다시 안 걸린다');
  // 바꾸기: 냥코인 · 그 자리에 다른 의뢰
  const before = g.quests.map((q) => q.id);
  bag.coins = 5;
  assert.ok(reroll(g, bag, 1, seeded(3)), '냥코인이 모자라면 못 바꾼다');
  bag.coins = 50;
  assert.equal(reroll(g, bag, 1, seeded(3)), null);
  assert.equal(bag.coins, 50 - data.guild.reroll);
  assert.equal(g.quests[0].id, before[0]);
  assert.equal(g.quests[2].id, before[2]);
  assert.notEqual(g.quests[1].id, before[1], '그 자리만 바뀐다');
  // 등급: 견습 0 · 동 50 · 은 150 · 금 350 · 전설 700 — 점수만 (구역 개방 같은 보상은 아직 없다)
  assert.deepEqual([0, 49, 50, 150, 349, 350, 700, 2000].map((p) => rankOf(p).name), ['견습', '견습', '동', '은', '은', '금', '전설', '전설']);
  assert.equal(rankOf(120).next, 30);
  assert.equal(rankOf(900).next, null);
  set('clear', 'post', 'treasure');
  g.gp = 45;
  noteGuild(g, { type: 'clear' }, bag);
  const up = turnIn(g, bag, 0, seeded(4));
  assert.ok(up.ok && up.rankUp === '동', '점수가 넘으면 등급이 오른다');
  // 모든 종류가 진행된다 (한 판 점수 의뢰는 n 을 넘는 점수 한 번이면)
  const evs: Record<string, GuildEvent> = {
    hunt: { type: 'kill', elite: false }, elite: { type: 'kill', elite: true }, clear: { type: 'clear' }, fish: { type: 'fish', big: false }, bigfish: { type: 'fish', big: true },
    salvage: { type: 'salvage' }, timber: { type: 'timber', score: 99 }, chase: { type: 'chase', score: 99 }, maze: { type: 'maze' }, sand: { type: 'sand', clean: true },
    cook: { type: 'cook', n: 1 }, forage: { type: 'forage' }, rescue: { type: 'rescue' }, post: { type: 'post' }, treasure: { type: 'treasure' }, forge: { type: 'forge' }, train: { type: 'train', score: 99 },
  };
  for (const q of QUESTS.filter((d) => d.type !== 'item')) {
    const h = { gp: 0, done: 0, quests: [{ id: q.id, p: 0 }] };
    for (let i = 0; i < q.n; i++) noteGuild(h, evs[q.id], bag);
    assert.equal(progressOf(h.quests[0], bag), q.n, `의뢰 ${q.id} 진행`);
  }
  const sand = { gp: 0, done: 0, quests: [{ id: 'sand', p: 0 }] };
  noteGuild(sand, { type: 'sand', clean: false }, bag);
  assert.equal(sand.quests[0].p, 0, '넘어지면 샌드보드 의뢰에 안 센다');
}

// 3) 대장간: 값(냥코인 + 재료, 모자란 재료는 값에 사서) · 가진 재료부터 · 별만큼 점수 · +1 마다 능력치 · +5 까지 · 합치기 · 끼고 있는 장비도
{
  const b = makeBag();
  b.coins = 1000;
  const list = forgeList(b);
  assert.deepEqual(list[0], { at: 'slot', slot: 'weapon' }, '끼고 있는 장비 먼저');
  assert.ok(list.some((r) => r.at === 'slot' && r.slot === 'rod'), '낚싯대도');
  const W = { at: 'slot', slot: 'weapon' } as const;
  const c0 = forgeCost(b, W);
  assert.equal(c0.lv, 0);
  assert.equal(c0.coins, data.forge.coins[0]);
  assert.equal(c0.buy, 2 * ITEMS.materials_07.price, '재료가 없으면 값에 사서 채운다');
  obtain(b, 'materials_07', 1);
  assert.equal(forgeCost(b, W).buy, ITEMS.materials_07.price, '가진 만큼은 안 산다');
  const atk0 = stats(b).atk;
  assert.equal(payForge(b, W), null);
  assert.equal(count(b, 'materials_07'), 0, '가진 재료를 쓴다');
  assert.equal(b.coins, 1000 - data.forge.coins[0] - ITEMS.materials_07.price);
  assert.equal(applyForge(b, W, 3).up, true, '★★★ = 3점 = +1');
  assert.equal(forgeLevel(b.fp.weapon), 1);
  assert.ok(stats(b).atk > atk0, '+1 이면 공격이 오른다');
  b.coins = 0;
  assert.ok(payForge(b, W), '냥코인이 모자라면 못 한다');
  b.coins = 99999;
  for (let i = 0; i < 20; i++) if (!forgeCost(b, W).max) (payForge(b, W), applyForge(b, W, 2));
  assert.equal(b.fp.weapon, MAX_FP, '+5 까지');
  assert.ok(forgeCost(b, W).max && payForge(b, W), '+5 면 더 못 한다');
  const lv5 = itemStats(b.equip.weapon!, MAX_FP).atk!;
  assert.ok(lv5 >= (ITEMS[b.equip.weapon!].stats!.atk ?? 0) + 5, '+5 면 적어도 +5');
  // 합치기: 같은 장비 두 점 → 하나 (높은 쪽 + 한 단계)
  const m = makeBag();
  m.coins = 100;
  obtain(m, 'equipment_13');
  obtain(m, 'equipment_13');
  const i0 = m.slots.findIndex((s) => s?.id === 'equipment_13');
  const r = { at: 'bag', i: i0 } as const;
  applyForge(m, r, 2);
  assert.ok(mergeTarget(m, r), '같은 장비가 하나 더 있다');
  assert.equal(merge(m, r), null);
  assert.equal(m.slots.filter((s) => s?.id === 'equipment_13').length, 1, '하나로');
  assert.equal(m.slots[i0]!.fp, 2 + 3, '높은 쪽 + 한 단계');
  assert.equal(m.coins, 100 - data.forge.merge);
  assert.ok(merge(m, r), '하나뿐이면 못 합친다');
  // 망치질: 딱 맞게 세 번 → ★★★, 안 누르면(식어 버림) ★, 비슷하게 → ★★
  const hit = (aim: number) => {
    const h = makeHammer();
    for (let i = 0; i < 600 && h.phase !== 'done'; i++) {
      if (h.phase === 'hit' && hammerIn(h) <= aim) hammerPress(h);
      updateHammer(h, 1 / 120);
    }
    return h;
  };
  const best = hit(0);
  assert.equal(best.results.length, HAMMER.strikes);
  assert.deepEqual(best.results, ['perfect', 'perfect', 'perfect']);
  assert.equal(best.stars, 3);
  assert.equal(hit(-9).stars, 1, '안 누르면 ★');
  assert.equal(hit(-9).results.join(), 'miss,miss,miss');
  const good = hit(0.06 * HAMMER.dur[0]);
  assert.equal(good.stars, 2, `비슷하면 ★★ (${good.results})`);
  const early = makeHammer();
  hammerPress(early);
  assert.equal(early.results[0], 'miss', '너무 일찍 두드리면 헛망치');
}

// 4) 우체국: 주문 → 맡기(slots 개까지) → 받는 이에게 가면 가방 물건을 건네고 삯 (마감이 지나면 실패) · 물건이 모자라면 안 됨 · 그만두기
{
  const s = makeDogSave(NOW, seeded(5));
  const bag = makeBag();
  const rng = seeded(6);
  const o = postOffer(s, rng);
  assert.ok(ITEMS[o.item] && RECIPIENTS.includes(o.to) && o.coins > 0);
  assert.equal(acceptOrder(s, NOW, rng), null);
  assert.equal(acceptOrder(s, NOW, rng), null);
  assert.ok(acceptOrder(s, NOW, rng), `${data.post.slots}개까지`);
  assert.notEqual(s.parcels[0].to, s.parcels[1].to, '같은 받는 이에게 두 번 겹치지 않는다');
  assert.ok(!s.parcels.some((p) => p.to === s.offer!.to), '걸려 있는 주문도 다른 이에게');
  assert.equal(deliver(s, bag, 'dog:nobody', NOW), null, '맡은 배달이 없으면 아무 일 없다');
  const p = s.parcels[0];
  const no = deliver(s, bag, p.to, NOW + 1000);
  assert.ok(no && !no.ok, '물건이 모자라면 못 건넨다');
  obtain(bag, p.item, p.n);
  const coins = bag.coins;
  const fast = deliver(s, bag, p.to, NOW + 1000);
  assert.ok(fast?.ok && fast.coins === p.coins, '마감 안에 배달하면 삯');
  assert.equal(count(bag, p.item), 0, '물건을 건넨다');
  assert.equal(bag.coins, coins + fast.coins);
  assert.equal(s.posted, 1);
  const q = s.parcels[0];
  obtain(bag, q.item, q.n);
  const late = deliver(s, bag, q.to, NOW + data.post.due * 1000 + 5000);
  assert.ok(late && !late.ok && s.parcels.includes(q) && s.posted === 1, '마감이 지나면 실패 — 건넬 수 없고 남아 있다 (실패를 눌러 지운다)');
  dropOrder(s, s.parcels.indexOf(q));
  acceptOrder(s, NOW, rng);
  dropOrder(s, 0);
  assert.equal(s.parcels.length, 0, '그만두기');
}

// 5) 탐험가: 말린 지도 · 냄새(기다림) → ✕ 자리 · 파면 냥코인 · 보물 · 한 번에 하나
{
  const s = makeDogSave(NOW, seeded(7));
  const bag = makeBag();
  const rng = seeded(8);
  assert.ok(readMap(s, bag, 'map', NOW, rng), '지도가 없으면 못 읽는다');
  assert.equal(sniffWait(s, NOW), 0, '처음엔 바로 냄새를 맡는다');
  assert.equal(readMap(s, bag, 'sniff', NOW, rng), null);
  assert.ok(digSpot(s), '✕ 자리');
  assert.ok(readMap(s, bag, 'sniff', NOW, rng), '이미 표시한 자리가 있으면 또 못 한다');
  const coins = bag.coins;
  const got = dig(s, bag, rng)!;
  assert.ok(got.coins >= data.explorer.coins[0] && got.coins <= data.explorer.coins[1]);
  assert.equal(bag.coins, coins + got.coins);
  for (const id of got.items) assert.ok(count(bag, id) > 0 || Object.values(bag.equip).includes(id), `보물 ${id} 이 가방에`);
  assert.equal(s.dig, null);
  assert.equal(s.dug, 1);
  assert.ok(readMap(s, bag, 'sniff', NOW + 1000, rng), '냄새는 sniff 초에 한 번');
  assert.equal(sniffWait(s, NOW), data.explorer.sniff);
  obtain(bag, data.explorer.map);
  assert.equal(readMap(s, bag, 'map', NOW + 1000, rng), null, '말린 지도는 언제든');
  assert.equal(count(bag, data.explorer.map), 0, '지도를 쓴다');
  // 여러 번 파 보면 보물이 고루
  let items = 0;
  for (let i = 0; i < 200; i++) {
    s.dig = 0;
    items += dig(s, makeBag(), rng)!.items.length;
  }
  assert.ok(items / 200 > 0.8 && items / 200 < 3, `한 번에 보물 평균 ${(items / 200).toFixed(2)}개`);
}

// 6) 구조대: first 초 뒤 요청 → 출동하면 필드에 ❗ → 구조하면 별만큼 냥코인 · 다음 요청은 every 초 뒤
{
  const s = makeDogSave(NOW, seeded(9));
  const bag = makeBag();
  tickRescue(s, NOW, seeded(1));
  assert.equal(s.call, null, '처음엔 조용');
  assert.equal(callWait(s, NOW), data.rescue.first);
  tickRescue(s, NOW + data.rescue.first * 1000, seeded(1));
  assert.ok(s.call && !s.call.on && !rescueSpot(s), '요청이 들어왔지만 아직 안 나섰다');
  acceptRescue(s);
  assert.ok(rescueSpot(s), '나서면 필드에 ❗');
  const r1 = rescueDone(s, bag, 1, NOW, () => 0.99);
  assert.equal(r1.coins, data.rescue.coins[0]);
  assert.equal(s.call, null);
  assert.equal(s.rescued, 1);
  assert.equal(callWait(s, NOW), data.rescue.every);
  s.call = { i: 0, on: true };
  const r3 = rescueDone(s, bag, 3, NOW, () => 0);
  assert.equal(r3.coins, data.rescue.coins[1], '★★★ 면 가장 많이');
  assert.ok(r3.map && count(bag, data.explorer.map) === 1, '가끔 말린 지도');
}

// 7) 로프: 왼쪽 · 오른쪽 번갈아 need 번 → 구조 (남은 시간만큼 별) · 같은 쪽 두 번은 미끄러짐 · 시간이 다 되면 놓침 · 처음 누르기 전엔 시간이 안 간다
{
  const r = makeRope('tree');
  for (let i = 0; i < 120; i++) updateRope(r, [], 1 / 60);
  assert.equal(r.t, 0, '누르기 전엔 그대로');
  ropePress(r, -1);
  ropePress(r, -1);
  assert.equal(r.pulls, 1, '같은 쪽 두 번은 미끄러짐');
  for (let i = 0; r.phase === 'pull'; i++) {
    updateRope(r, [], 1 / 10);
    ropePress(r, i % 2 ? -1 : 1);
  }
  assert.equal(r.phase, 'done');
  assert.equal(r.pulls, ROPE.need);
  assert.equal(r.stars, 3, `초당 열 번이면 ★★★ (${r.t.toFixed(1)}초)`);
  const slow = makeRope('boat');
  for (let i = 0; slow.phase !== 'done' && slow.phase !== 'fail'; i++) {
    ropePress(slow, i % 2 ? -1 : 1);
    updateRope(slow, [], 0.5);
  }
  assert.equal(slow.phase, 'fail', '초당 두 번이면 시간 안에 못 끌어올린다');
  const mid = makeRope('pit');
  for (let i = 0; mid.phase === 'ready' || mid.phase === 'pull'; i++) {
    ropePress(mid, i % 2 ? -1 : 1);
    updateRope(mid, [], 1 / 3.2);
  }
  assert.ok(mid.phase === 'done' && mid.stars < 3, `초당 3.2번이면 구조는 하지만 ★★★ 는 아니다 (★${mid.stars})`);
}

// 8) 마을 걷기 · 주민: 늘 걸을 수 있는 곳 · 시작 자리에서 주민 여덟 곁까지 걸어서 닿는다 · 곁에 오면 인사 · 누르기는 곁에서만 · 주민 앞 자리
{
  const s = makeDogtown(seeded(10));
  assert.ok(walkableDog(data.start[0], data.start[1]), '시작점은 걸을 수 있다');
  const rng = seeded(11);
  for (let i = 0; i < 1800; i++) {
    const a = rng() * Math.PI * 2;
    updateDogtown(s, { mx: Math.cos(a), my: Math.sin(a), act: false }, 1 / 60);
    assert.ok(walkableDog(s.cat.x, s.cat.y), `늘 걸을 수 있는 곳 (${s.cat.x.toFixed(0)}, ${s.cat.y.toFixed(0)})`);
  }
  const CELL = 12;
  const cols = Math.ceil(data.size[0] / CELL);
  const rows = Math.ceil(data.size[1] / CELL);
  const reached = [[Math.floor(data.start[0] / CELL), Math.floor(data.start[1] / CELL)]];
  const seen = new Set([reached[0][1] * cols + reached[0][0]]);
  for (let q = 0; q < reached.length; q++)
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const [c, r] = [reached[q][0] + dc, reached[q][1] + dr];
      if (c < 0 || r < 0 || c >= cols || r >= rows || seen.has(r * cols + c) || !walkableDog((c + 0.5) * CELL, (r + 0.5) * CELL)) continue;
      seen.add(r * cols + c);
      reached.push([c, r]);
    }
  DOGS.forEach((d) => {
    const g = Math.min(...reached.map(([c, r]) => Math.hypot((c + 0.5) * CELL - d.at[0], ((r + 0.5) * CELL - d.at[1]) / field.vertical) / DC));
    assert.ok(g < data.reach * 0.8, `${d.name} 곁까지 걸어서 닿는다 (${g.toFixed(2)}배)`);
  });
  // 주민 앞 자리(훈련장에서 돌아올 때)는 걸을 수 있고 말 거는 거리 안 — 그 주민이 가장 가깝다
  DOGS.forEach((d, i) => {
    const t = makeDogtown(seeded(12), i);
    assert.ok(walkableDog(t.cat.x, t.cat.y), `${d.name} 앞 자리는 걸을 수 있다`);
    const save = makeDogSave(NOW, seeded(13));
    updateDogtown(t, { mx: 0, my: 0, act: true }, 1 / 60, { save, bag: makeBag(), now: NOW });
    assert.equal(t.open, i, `${d.name} 앞에서 E 면 ${d.name}`);
    assert.equal(t.dogs[i].anim, 'greet', '곁에 오면 인사');
    assert.ok(t.dogs[i].sayT > 0 && t.dogs[i].say, '할 말');
  });
  // 누르기: 곁이면 연다, 멀면 아무 일 없다 (걷지 않는다)
  const n = makeDogtown(seeded(14), 1);
  updateDogtown(n, { mx: 0, my: 0, act: false }, 1 / 60);
  const p = n.dogs[1];
  assert.equal(dogAtPoint(n, p.x, p.y - DC * 1.5), 1, '몸을 누르면 그 주민');
  assert.ok(dogTalkTo(n, 1));
  updateDogtown(n, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.equal(n.open, 1, '곁에서 누르면 바로 말을 건다');
  const at0 = [n.cat.x, n.cat.y];
  assert.ok(!dogTalkTo(n, 6), '멀리 있는 주민은 안 된다');
  for (let i = 0; i < 30; i++) updateDogtown(n, { mx: 0, my: 0, act: false }, 1 / 60);
  assert.deepEqual([n.cat.x, n.cat.y], at0, '누르기로는 걷지 않는다');
  // 가끔 자기 일 (일 A · B · C), 끝나면 대기
  const j = makeDogtown(seeded(15));
  const anims = new Set<string>();
  for (let i = 0; i < 60 * 40; i++) {
    updateDogtown(j, { mx: 0, my: 0, act: false }, 1 / 60);
    anims.add(j.dogs[0].anim);
  }
  assert.ok(anims.has('idle') && ['job_a', 'job_b', 'job_c'].some((a) => anims.has(a)), `대기 중 가끔 자기 일 (${[...anims]})`);
  // 할 일 이야기: 구조 요청 · 보물 자리 · 다 마친 의뢰
  const save = makeDogSave(NOW, seeded(16));
  const bag = makeBag();
  save.call = { i: 0, on: false };
  assert.match(dogLine(save, bag, DOGS.findIndex((d) => d.job === 'rescue'), NOW), /구조 요청/);
  save.dig = 2;
  assert.match(dogLine(save, bag, DOGS.findIndex((d) => d.job === 'explorer'), NOW), new RegExp(data.explorer.spots[2].hint));
  save.guild.quests = [{ id: 'clear', p: 1 }];
  assert.match(dogLine(save, bag, DOGS.findIndex((d) => d.job === 'guild'), NOW), /보고/);
}

// 9) 저장: 왕복 그대로 · 이상한 값은 버린다
{
  const s = makeDogSave(NOW, seeded(17));
  s.guild.gp = 77;
  s.posted = 3;
  s.dig = 4;
  s.call = { i: 1, on: true };
  acceptOrder(s, NOW, seeded(18));
  const back = fromDogSave(JSON.parse(JSON.stringify(s)), NOW);
  assert.deepEqual(back, s, '왕복 그대로');
  const junk = fromDogSave({ guild: { gp: -5, quests: [{ id: 'nope', p: 3 }, { id: 'hunt', p: 2 }, { id: 'hunt', p: 9 }] }, dig: 99, call: { i: 42 }, parcels: [{ item: 'zzz', to: 'cat:x', n: 1 }], posted: 'x' }, NOW, seeded(19));
  assert.equal(junk.guild.gp, 0);
  assert.equal(junk.guild.quests.length, data.guild.board, '모르는 의뢰는 버리고 다시 채운다');
  assert.equal(junk.guild.quests.filter((q) => q.id === 'hunt').length, 1, '같은 의뢰 둘은 하나로');
  assert.equal(junk.dig, null);
  assert.equal(junk.call, null);
  assert.equal(junk.parcels.length, 0);
  assert.equal(junk.posted, 0);
}

console.log('dogtown.check: ok');
