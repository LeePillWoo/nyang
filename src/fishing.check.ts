// node src/fishing.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { debugBite, makeFishing, record, RULES, spawnFish, updateFishing, type FishInput, type FishingState } from './fishing.ts';

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

// 챔질: 톡톡일 때 누르면 너무 빠르다, 입질 뒤 시간 안이면 걸린다, 늦으면 미끼만 먹고 간다
{
  const s = makeFishing(SPOT, {}, seeded(3));
  empty(s);
  s.phase = 'wait';
  s.waitT = 5;
  const f = spawnFish(s, 'golden_crucian', [1190, 535], 1);
  f.mode = 'nibble';
  f.nibblesLeft = 2;
  f.nextNibble = 0.2;
  s.bite = f;
  hold(s, 0.3, at(0, 0));
  tap(s);
  assert.equal(s.phase, 'fail');
  assert.equal(s.fail, 'early');

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
function hooked(kind: string, seed: number) {
  const s = makeFishing(SPOT, {}, seeded(seed));
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

// 비단잉어: 날뛰는데 계속 감으면 줄이 끊어진다. 날뛸 때만 놓으면 낚인다
{
  let snapped = 0;
  let landed = 0;
  for (let seed = 21; seed <= 30; seed++) {
    const a = hooked('sunset_koi', seed);
    hold(a, 40, at(0, 0, true), () => a.phase !== 'reel');
    if (a.fail === 'snap') snapped++;

    const b = hooked('sunset_koi', seed);
    for (let k = 0; k < 60 * 60 && b.phase === 'reel'; k++) updateFishing(b, at(0, 0, b.run <= 0), DT);
    if (b.phase === 'caught') landed++;
  }
  assert.equal(snapped, 10, `비단잉어를 무작정 감으면 끊어진다 (${snapped}/10)`);
  assert.equal(landed, 10, `날뛸 때 놓으면 낚인다 (${landed}/10)`);
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

console.log('fishing.check: ok');
