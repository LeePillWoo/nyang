// node src/timber.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { drainAt, makeTimber, safeSide, TIMBER, updateTimber, type Side, type TimberState } from './timber.ts';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
/** fps 번 나눠 secs 초 동안 hz 번씩 pick 쪽을 팬다 */
function play(s: TimberState, pick: (s: TimberState) => Side, hz: number, secs: number) {
  const dt = 1 / 60;
  let acc = 0;
  for (let i = 0; i < secs * 60 && s.phase !== 'done'; i++) {
    acc += hz * dt;
    const chops: Side[] = [];
    while (acc >= 1) {
      acc--;
      chops.push(pick(s));
    }
    updateTimber(s, chops, dt);
  }
}

// 1) 기둥: 처음 clear 토막은 가지가 없고, 가지 바로 다음 토막엔 반대쪽 가지가 없다 (언제나 피할 쪽이 있다). 가지는 적당히
{
  let branches = 0;
  let segs = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = makeTimber(seeded(seed));
    assert.deepEqual(s.segs.slice(0, TIMBER.clear), Array(TIMBER.clear).fill(0), '처음 토막은 가지 없이');
    const seen = [...s.segs];
    for (let i = 0; i < 300; i++) {
      updateTimber(s, [safeSide(s)], 1 / 60);
      seen.push(s.segs[s.segs.length - 1]);
      if (s.phase === 'done') break;
    }
    for (let i = 1; i < seen.length; i++) assert.ok(!(seen[i - 1] && seen[i] === -seen[i - 1]), `seed ${seed}: ${i} 번째 토막 — 가지 바로 다음에 반대쪽 가지`);
    branches += seen.filter((v) => v).length;
    segs += seen.length;
  }
  const k = branches / segs;
  assert.ok(k > 0.3 && k < 0.6, `가지 비율 ${(k * 100).toFixed(0)}%`);
}

// 2) 한 번 패기: 맨 아래 토막이 빠지고 한 칸 내려온다 · 점수 +1 · 시간 +gain (가득 max 까지) · 첫 도끼질 전엔 시간이 안 준다
{
  const s = makeTimber(seeded(3));
  updateTimber(s, [], 2);
  assert.equal(s.time, TIMBER.start, '첫 도끼질 전엔 시간이 안 준다');
  const before = [...s.segs];
  updateTimber(s, [1], 1 / 60);
  assert.equal(s.score, 1);
  assert.deepEqual(s.segs.slice(0, before.length - 1), before.slice(1), '맨 아래 토막이 빠지고 기둥이 내려온다');
  assert.ok(s.events.some((e) => e.type === 'chop' && e.side === 1), 'chop 사건');
  assert.ok(Math.abs(s.time - (TIMBER.start + TIMBER.gain - drainAt(1) / 60)) < 1e-9, `시간 +${TIMBER.gain}`);
  for (let i = 0; i < 40; i++) updateTimber(s, [safeSide(s)], 0);
  assert.equal(s.time, TIMBER.max, '시간은 가득(max)까지만');
}

// 3) 콩: 가지 밑으로 옮겨 가거나(지금 토막) 가지가 내 쪽으로 내려오면(다음 토막) 끝
{
  const s = makeTimber(seeded(5));
  s.segs = [0, 1, 0, 0, 0, 0];
  s.side = 1;
  updateTimber(s, [1], 1 / 60);
  assert.ok(s.phase === 'done' && s.why === 'hit' && s.events.some((e) => e.type === 'hit'), '가지가 내 쪽으로 내려오면 콩');
  const m = makeTimber(seeded(5));
  m.segs = [-1, 0, 0, 0];
  m.side = 1;
  updateTimber(m, [-1], 1 / 60);
  assert.ok(m.phase === 'done' && m.why === 'hit' && m.score === 0, '가지 밑으로 옮겨 가면 콩 (패지도 못한다)');
  const ok = makeTimber(seeded(5));
  ok.segs = [-1, 0, 1, 0];
  ok.side = 1;
  updateTimber(ok, [1], 1 / 60);
  assert.ok(ok.phase === 'play' && ok.score === 1, '반대쪽 가지는 괜찮다');
  updateTimber(ok, [1], 1 / 60);
  assert.ok(ok.phase === 'done', '…다음 토막의 가지가 내 쪽이면 콩');
  updateTimber(ok, [-1, -1], 1 / 60);
  assert.equal(ok.score, 2, '끝난 뒤엔 안 팬다 (맞기 직전에 팬 것까지)');
}

// 4) 늘 피하는 쪽을 고르면 가지에 안 맞는다 (200판 · 초당 5번) — 끝은 시간 · 한쪽만 패면 금방 맞는다
{
  const scores: number[] = [];
  let sameSide = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = makeTimber(seeded(seed));
    play(s, safeSide, 5, 600);
    assert.equal(s.why, 'time', `seed ${seed}: 피하면 가지에 안 맞는다 (${s.score}토막)`);
    scores.push(s.score);
    const d = makeTimber(seeded(seed));
    play(d, () => 1, 5, 60);
    sameSide += d.score;
  }
  const avg = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  assert.ok(avg(scores) > 100 && avg(scores) < 260, `초당 5번이면 평균 ${avg(scores).toFixed(0)}토막에서 시간이 다 된다`);
  assert.ok(sameSide / 200 < 12, `한쪽만 패면 평균 ${(sameSide / 200).toFixed(1)}토막에서 콩`);
  // 느리게(초당 1번) 패면 시간이 다 된다
  const slow = makeTimber(seeded(9));
  play(slow, safeSide, 1, 120);
  assert.ok(slow.why === 'time' && slow.t < 30, `초당 1번이면 ${slow.t.toFixed(1)}초 · ${slow.score}토막에서 시간이 다 된다`);
  console.log(`  장작 패기: 초당 5번 평균 ${avg(scores).toFixed(0)}토막 (최소 ${Math.min(...scores)} · 최대 ${Math.max(...scores)}) · 한쪽만 ${(sameSide / 200).toFixed(1)}토막 · 초당 1번 ${slow.score}토막`);
}

// 5) 보상 · 빨라짐 알림: 냥코인 = 토막 × coin, 통나무 = 토막 / log (최대 logMax), level 토막마다 level 사건
{
  const s = makeTimber(seeded(11));
  const levels: number[] = [];
  for (let i = 0; i < 100 && s.phase !== 'done'; i++) {
    updateTimber(s, [safeSide(s)], 0);
    for (const e of s.events) if (e.type === 'level') levels.push(e.n);
  }
  assert.deepEqual(levels, [1, 2, 3, 4], `${TIMBER.level} 토막마다 빨라진다`);
  s.time = 0.001;
  updateTimber(s, [], 0.1);
  const done = s.events.find((e) => e.type === 'done');
  assert.ok(done && done.type === 'done' && done.score === 100 && done.coins === 30 && done.logs === 6 && done.why === 'time', `100토막 → 냥코인 30 · 통나무 6 (${JSON.stringify(done)})`);
  assert.ok(drainAt(0) < drainAt(TIMBER.ramp) && drainAt(TIMBER.ramp * 2) === drainAt(TIMBER.ramp), '팰수록 빨리 준다 (ramp 에서 가장 빠르게)');
}

console.log('timber.check: ok');
