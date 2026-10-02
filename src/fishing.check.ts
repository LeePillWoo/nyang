// node src/fishing.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import atlas from './data/fishing-atlas.json' with { type: 'json' };
import {
  clampWater,
  commitBite,
  debugBite,
  FISH,
  inWaterBy,
  makeFishing,
  record,
  RULES,
  spawnFish,
  SPOTS,
  updateFishing,
  type BiteKind,
  type BitePattern,
  type FishInput,
  type FishingState,
} from './fishing.ts';

/** 시드 고정 난수 (mulberry32) — 실패하면 같은 판으로 다시 볼 수 있다 */
function seeded(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const DT = 1 / 60;
const SPOT = 'lake_island_fishing';
const at = (x: number, y: number, down = false): FishInput => ({ x, y, down, pressed: false, released: false });
/** 한 프레임 */
const step = (s: FishingState, i: FishInput) => {
  updateFishing(s, i, DT);
  return s.events.slice();
};
const tap = (s: FishingState, x = 1160, y = 535) => step(s, { x, y, down: true, pressed: true, released: false });
/** n 초 동안 같은 입력 */
function hold(s: FishingState, seconds: number, i: FishInput, until?: () => boolean) {
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    updateFishing(s, i, DT);
    if (until?.()) return true;
  }
  return false;
}
const empty = (s: FishingState) => {
  s.fishes = [];
  s.spawnIn = 999;
};

// 던지기: 링이 가장 작을 때(ringPeriod 의 절반) 떼면 겨눈 곳 가까이, 막 눌렀다 떼면 크게 빗나갈 수 있다
{
  let near = 0;
  let far = 0;
  for (let seed = 1; seed <= 20; seed++) {
    for (const wait of [RULES.ringPeriod / 2 - DT, 0]) {
      const s = makeFishing(SPOT, {}, seeded(seed));
      empty(s);
      tap(s, 1200, 480);
      hold(s, wait, at(1200, 480, true));
      step(s, { ...at(1200, 480), released: true });
      assert.equal(s.phase, 'cast');
      const miss = Math.hypot(s.castX - 1200, s.castY - 480);
      if (wait) near = Math.max(near, miss);
      else far = Math.max(far, miss);
      hold(s, RULES.flight + 0.05, at(1200, 480));
      assert.equal(s.phase, 'wait');
    }
  }
  assert.ok(near <= RULES.ringMin + 3, `링이 작을 때 떼면 정확하다: 최대 ${near.toFixed(1)}px 빗나감`);
  assert.ok(far > 40, `막 눌렀다 떼면 크게 빗나간다: 최대 ${far.toFixed(1)}px`);
}

// 물고기 바로 위에 던지면 놀라 도망가고, 앞쪽 가까이에 던지면 다가와 문다
{
  const s = makeFishing(SPOT, {}, seeded(7));
  empty(s);
  const f = spawnFish(s, 'golden_crucian', [1200, 480], 1);
  s.phase = 'cast';
  s.t = 0;
  [s.castX, s.castY] = [1205, 482];
  hold(s, RULES.flight + 0.05, at(0, 0));
  assert.equal(f.mode, 'flee', '바로 위에 떨어지면 도망간다');

  const g = makeFishing(SPOT, {}, seeded(8));
  empty(g);
  const h = spawnFish(g, 'golden_crucian', [1200, 480], 1);
  g.phase = 'cast';
  g.t = 0;
  [g.castX, g.castY] = [1290, 480];
  hold(g, RULES.flight + 0.05, at(0, 0));
  h.mode = 'swim';
  const bit = hold(g, 30, at(0, 0), () => g.phase === 'bite');
  assert.ok(bit, '앞쪽 가까이에 던지면 결국 입질이 온다');
  assert.equal(g.bite, h);
}

/** 찌 옆에 물고기를 두고 이 패턴으로 노리게 한다 (기다리기 단계) */
function luring(kind: string, pattern: BitePattern, seed: number) {
  const s = makeFishing(SPOT, {}, seeded(seed));
  empty(s);
  s.phase = 'wait';
  s.waitT = 5;
  [s.bobX, s.bobY] = [1160, 535];
  const f = spawnFish(s, kind, [1240, 540], 1);
  commitBite(s, f, pattern);
  return { s, f };
}
/** 진짜 입질(또는 그냥 가 버림)까지 기다리며 나온 신호를 모은다 */
function untilBite(s: FishingState, seconds = 20) {
  const cues: { t: number; type: string }[] = [];
  let t = 0;
  for (let k = 0; k < Math.round(seconds / DT) && s.phase === 'wait' && s.bite; k++) {
    updateFishing(s, at(0, 0), DT);
    t += DT;
    for (const e of s.events) if (e.type === 'nibble' || e.type === 'dunk' || e.type === 'hesitate') cues.push({ t, type: e.type });
  }
  return cues;
}

// 패턴마다 진짜 입질 모양이 정해져 있다: 찌올림 → 떠오름, 끌고 가기 → 끌려감, 나머지 → 쏙
{
  const want: Record<BitePattern, BiteKind> = { peck: 'sink', flurry: 'sink', slam: 'sink', fake: 'sink', hesitant: 'sink', lift: 'lift', drag: 'drag' };
  for (const [p, kind] of Object.entries(want) as [BitePattern, BiteKind][])
    for (let seed = 1; seed <= 6; seed++) {
      const { s } = luring('golden_crucian', p, seed * 13);
      untilBite(s);
      if (p === 'hesitant' && !s.bite) continue; // 망설이다 가 버린 판
      assert.equal(s.phase, 'bite', `${p}: 결국 입질 (seed ${seed})`);
      assert.equal(s.biteKind, kind, `${p}: 입질 모양 ${kind}`);
    }
}

// 박자가 다르다: 연타는 따다닥(0.25초 안), 톡톡은 들쭉날쭉 (간격이 고르지 않다), 한방은 신호 없이 바로
{
  const fl = luring('silver_minnow', 'flurry', 3).s;
  const fc = untilBite(fl);
  const tight = fc.slice(1).filter((c, i) => c.t - fc[i].t < 0.25).length;
  assert.ok(fc.length >= 3 && tight >= 2, `연타: ${fc.length}번 중 ${tight}번이 0.25초 안`);

  const gaps: number[] = [];
  for (let seed = 1; seed <= 12; seed++) {
    const c = untilBite(luring('blue_catfish', 'peck', seed).s);
    for (let i = 1; i < c.length; i++) gaps.push(c[i].t - c[i - 1].t);
  }
  assert.ok(Math.max(...gaps) - Math.min(...gaps) > 0.6, `톡톡 간격이 들쭉날쭉 (${Math.min(...gaps).toFixed(2)}~${Math.max(...gaps).toFixed(2)}초)`);

  const sl = luring('rainbow_trout', 'slam', 5).s;
  assert.equal(untilBite(sl).length, 0, '한방: 가짜 신호 없이 바로 문다');
  assert.equal(sl.phase, 'bite');
}

// 같은 종도 매번 다른 패턴으로 문다 (가중치대로)
{
  const seen = new Set<string>();
  const s = makeFishing(SPOT, {}, seeded(77));
  empty(s);
  for (let i = 0; i < 40; i++) {
    commitBite(s, spawnFish(s, 'golden_crucian', [1200, 500], 1));
    seen.add(s.pattern!);
  }
  assert.deepEqual([...seen].sort(), ['drag', 'lift', 'peck'], `붕어 패턴: ${[...seen].join(', ')}`);
}

// 속임수: 헛잠김(반쯤 잠겼다 떠오름)에 채면 너무 빠르다 — 무엇에 속았는지 알려 준다
{
  const { s } = luring('blue_catfish', 'fake', 9);
  let dunked = false;
  for (let k = 0; k < 60 * 20 && s.phase === 'wait' && !dunked; k++) {
    updateFishing(s, at(0, 0), DT);
    dunked = s.events.some((e) => e.type === 'dunk');
  }
  assert.ok(dunked, '헛잠김 신호가 온다');
  tap(s);
  assert.equal(s.fail, 'early');
  assert.equal(s.failHint, 'dunk');

  const t = luring('golden_crucian', 'peck', 21).s;
  untilBite(t, 0.01);
  tap(t);
  assert.equal(t.failHint, 'approach', '다가오는 중에 채면 그렇다고 알려 준다');
}

// 끌고 가기: 입질 동안 찌가 옆으로 끌려간다. 늦으면 "끌고 갈 때 채야 해요"
{
  const { s } = luring('green_perch', 'drag', 4);
  untilBite(s);
  assert.equal(s.biteKind, 'drag');
  const [x0, y0] = [s.bobX, s.bobY];
  hold(s, s.biteWindow * 0.9, at(0, 0));
  assert.ok(Math.hypot(s.bobX - x0, s.bobY - y0) > 15, `찌가 끌려간다 (${Math.hypot(s.bobX - x0, s.bobY - y0).toFixed(0)}px)`);
  hold(s, 1, at(0, 0));
  assert.equal(s.fail, 'late');
  assert.equal(s.failHint, 'drag');

  const l = luring('golden_crucian', 'lift', 6).s;
  untilBite(l);
  assert.equal(l.biteKind, 'lift');
  hold(l, 0.15, at(0, 0));
  tap(l);
  assert.equal(l.phase, 'hook', '찌가 떠오를 때 채면 걸린다');
}

// 망설임: 물러났다 다시 오고, 가끔은 그냥 가 버린다 (실패는 아니다)
{
  let left = 0;
  let bit = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { s } = luring('sunset_koi', 'hesitant', seed);
    const c = untilBite(s);
    assert.ok(c.some((v) => v.type === 'hesitate'), '물러났다 온다');
    if (s.phase === 'bite') bit++;
    else if (s.phase === 'wait' && !s.bite) left++;
  }
  assert.ok(left > 0 && bit > left, `망설이다 가 버림 ${left} · 문다 ${bit}`);
}

// 챔질: 톡톡일 때 누르면 너무 빠르다, 입질 뒤 시간 안이면 걸린다, 늦으면 미끼만 먹고 간다
{
  const { s } = luring('golden_crucian', 'peck', 3);
  for (let k = 0; k < 60 * 10 && !s.events.some((e) => e.type === 'nibble'); k++) updateFishing(s, at(0, 0), DT);
  tap(s);
  assert.equal(s.phase, 'fail');
  assert.equal(s.fail, 'early');
  assert.equal(s.failHint, 'tap');

  const g = makeFishing(SPOT, {}, seeded(4));
  empty(g);
  debugBite(g, 'golden_crucian');
  hold(g, 0.1, at(0, 0));
  const ev = tap(g);
  assert.equal(g.phase, 'hook');
  assert.ok(ev.some((e) => e.type === 'hook' && e.perfect), '빨리 채면 완벽한 챔질');
  hold(g, RULES.hookTime + 0.05, at(0, 0, true));
  assert.equal(g.phase, 'reel');

  const h = makeFishing(SPOT, {}, seeded(5));
  empty(h);
  debugBite(h, 'sunset_koi');
  hold(h, 0.5, at(0, 0)); // 비단잉어 챔질 시간은 0.45초
  assert.equal(h.phase, 'fail');
  assert.equal(h.fail, 'late');
}

/** 입질에서 바로 채고 당기기로. 이후 hold 로 당긴다 */
function hooked(kind: string, seed: number, gear = { reel: 0, line: 0 }) {
  const s = makeFishing(SPOT, {}, seeded(seed), gear);
  empty(s);
  debugBite(s, kind);
  // 실제처럼 찌에서 멀리 떨어진 곳에서 끌어오게 물고기를 옮긴다
  [s.bite!.x, s.bite!.y] = [1400, 450];
  tap(s);
  hold(s, RULES.hookTime + 0.05, at(0, 0, true));
  assert.equal(s.phase, 'reel');
  return s;
}

// 피라미: 그냥 계속 감아도 낚인다
{
  const s = hooked('silver_minnow', 11);
  const done = hold(s, 30, at(0, 0, true), () => s.phase !== 'reel');
  assert.ok(done && s.phase === 'caught', `피라미는 계속 감으면 낚인다 (결과 ${s.phase} ${s.fail ?? ''})`);
  assert.equal(s.catch?.kind, 'silver_minnow');
  assert.ok(s.catch?.isNew);
  assert.equal(s.dex.silver_minnow.count, 1);
}

// 밸런스 (종마다 10판, 사람 반응을 흉내 낸다 — 날뛰기 0.3초 뒤에 떼고, 끝나고 0.2초 뒤에 다시 감는다):
//  모든 종은 날뛸 때 놓으면 낚인다 · 별 1~2 는 계속 감아도 낚인다 · 별 3 이상은 계속 감으면 끊어진다.
//  당기는 모양(잔걸음·지그재그·묵직함·점프)을 바꿔도 이 약속이 지켜져야 한다
{
  const fight = (kind: string, seed: number, smart: boolean) => {
    const s = hooked(kind, seed);
    let runAge = 0;
    let endAge = 9;
    let t = 0;
    while (s.phase === 'reel' && t < 90) {
      if (s.run > 0) {
        runAge += DT;
        endAge = 0;
      } else {
        runAge = 0;
        endAge += DT;
      }
      const down = !smart || !(runAge > 0.3 || endAge < 0.2);
      updateFishing(s, at(0, 0, down), DT);
      t += DT;
    }
    return { s, t };
  };
  for (const [kind, def] of Object.entries(FISH)) {
    let smartWin = 0;
    let holdWin = 0;
    let time = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const a = fight(kind, seed, true);
      if (a.s.phase === 'caught') {
        smartWin++;
        time += a.t;
      }
      if (fight(kind, seed, false).s.phase === 'caught') holdWin++;
    }
    const tag = `${def.name}(${def.fight}): 놓을 줄 알면 ${smartWin}/10 (평균 ${(time / Math.max(1, smartWin)).toFixed(1)}초) · 계속 감기 ${holdWin}/10`;
    assert.ok(smartWin >= 9, tag);
    if (def.stars <= 2) assert.ok(holdWin >= 9, tag);
    else assert.ok(holdWin <= 1, tag);
    console.log('  ' + tag);
  }
}

// 낚시 장비(가방의 낚싯대·릴): 감기 % 만큼 빨리 감기고, 줄 강도 % 만큼 끊어지기까지 오래 버틴다
{
  const until = (kind: string, gear: { reel: number; line: number }) => {
    const s = hooked(kind, 11, gear);
    let t = 0;
    while (s.phase === 'reel' && t < 60) {
      updateFishing(s, at(0, 0, true), DT);
      t += DT;
    }
    return { t, phase: s.phase, fail: s.fail };
  };
  const base = until('silver_minnow', { reel: 0, line: 0 });
  const fast = until('silver_minnow', { reel: 50, line: 0 });
  assert.ok(base.phase === 'caught' && fast.phase === 'caught' && fast.t < base.t * 0.85, `감기 +50%: ${base.t.toFixed(2)}초 → ${fast.t.toFixed(2)}초`);
  const strong = Object.keys(SPOTS[SPOT].fish).find((k) => FISH[k].stars >= 3)!;
  const snap = until(strong, { reel: 0, line: 0 });
  const tough = until(strong, { reel: 0, line: 200 });
  assert.equal(snap.fail, 'snap');
  assert.ok(tough.t > snap.t, `줄 강도 +200%: ${FISH[strong].name} 끊어지기까지 ${snap.t.toFixed(2)}초 → ${tough.t.toFixed(2)}초 (${tough.phase} ${tough.fail ?? ''})`);
}

// 너무 오래 놓고 있으면 바늘이 빠진다
{
  const s = hooked('golden_crucian', 41);
  hold(s, 10, at(0, 0, false), () => s.phase !== 'reel');
  assert.equal(s.fail, 'slack');
}

// 도감: 처음은 NEW, 더 큰 걸 잡으면 기록
{
  const dex = {};
  assert.deepEqual(record(dex, 'green_perch', 20), { isNew: true, record: false });
  assert.deepEqual(record(dex, 'green_perch', 18), { isNew: false, record: false });
  assert.deepEqual(record(dex, 'green_perch', 25.5), { isNew: false, record: true });
  assert.deepEqual(dex, { green_perch: { count: 3, best: 25.5 } });
}

// 아무도 안 물었을 때 누르면 그냥 다시 감는다 (실패 아님)
{
  const s = makeFishing(SPOT, {}, seeded(51));
  empty(s);
  s.phase = 'wait';
  s.t = 0;
  tap(s);
  assert.equal(s.phase, 'ready');
}

// 얼음 구멍(다각형 물): 물고기는 헤엄치고 놀라 달아나도 늘 구멍 안에 있고, 구멍 밖을 겨눠도 찌는 구멍 안에 떨어진다
{
  const s = makeFishing('ice_fishing', {}, seeded(61));
  const spot = s.spot;
  let out = 0;
  for (let k = 0; k < 60 * 30; k++) {
    if (k % 90 === 0 && s.fishes[0]) s.fishes.forEach((f) => (f.scared = 0)); // 가끔 다시 다가오게
    if (k % 240 === 0) {
      // 아무 데나 던져 물고기를 놀라게 한다
      s.phase = 'cast';
      s.t = 0;
      [s.castX, s.castY] = clampWater(spot, 900 + (k % 600), 400 + (k % 300));
    }
    updateFishing(s, at(0, 0), DT);
    for (const f of s.fishes) if (!inWaterBy(spot, f.x, f.y, 0)) out++;
  }
  assert.equal(out, 0, `얼음 위로 나간 물고기 프레임 ${out}`);
  for (const [x, y] of [[1600, 200], [700, 500], [1200, 900], [860, 345]]) {
    const [cx, cy] = clampWater(spot, x, y);
    assert.ok(inWaterBy(spot, cx, cy, 19), `(${x},${y}) → (${cx.toFixed(0)},${cy.toFixed(0)}) 이 구멍 안`);
  }
}

// 데이터가 서로 맞는지: 낚시터의 물고기는 fish.json · 시트 좌표(fishing-atlas.json)에 있고, 배경·시트 WebP 가 실제로 있다
// (리소스 폴더를 옮기거나 이름을 바꾸면 여기서 잡힌다)
{
  const has = (p: string) => existsSync(new URL(`./assets/${p}.webp`, import.meta.url));
  const A = atlas as unknown as { cat: { sheet: string }; shadow: { sheet: string; states: Record<string, unknown> }; fx: { sheet: string }; catch: Record<string, { sheet: string }> };
  for (const k of ['cat', 'shadow', 'fx'] as const) assert.ok(has(A[k].sheet), `공용 시트 없음: ${A[k].sheet}`);
  for (const [id, spot] of Object.entries(SPOTS)) {
    assert.ok(has(spot.image), `${id}: 배경 없음 ${spot.image}`);
    for (const k of Object.keys(spot.fish)) {
      assert.ok(FISH[k], `${id}: fish.json 에 없는 물고기 ${k}`);
      assert.ok(A.catch[k] && has(A.catch[k].sheet), `${id}: ${k} 의 잡은 물고기 시트가 없다`);
      assert.ok(A.shadow.states[FISH[k].shadow], `${k}: 없는 그림자 모양 ${FISH[k].shadow}`);
    }
  }
}

console.log('fishing.check: ok');
