// node src/sandboard.check.ts  (npm run check) — 늘 지나갈 길이 있고, 점프로 넘고, 부딪히면 느려지고, 끝까지 가면 완주
import assert from 'node:assert/strict';
import { makeSandboard, SAND, updateSandboard, type Ob, type SandState } from './sandboard.ts';

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const DT = 1 / 60;
const still = { mx: 0, jump: false };
const solid = (o: Ob) => o.kind === 'rock' || o.kind === 'cactus' || o.kind === 'armadillo';

// 1) 코스: 장애물 줄마다 레인 하나는 비어 있다 (30판, 끝까지 깔아 본다 — 지나간 건 지워지니 모아 둔다)
for (let seed = 1; seed <= 30; seed++) {
  const s = makeSandboard(seeded(seed));
  const all = new Set<Ob>();
  while (s.nextAt < SAND.length - 20) {
    s.d += 40;
    updateSandboard(s, still, 0);
    for (const o of s.obs) all.add(o);
  }
  const rows = new Map<number, Ob[]>();
  for (const o of all) if (solid(o)) rows.set(o.d, [...(rows.get(o.d) ?? []), o]);
  assert.ok(rows.size >= 10, `seed ${seed}: 장애물 줄 ${rows.size}`);
  for (const [d, obs] of rows) {
    const free = SAND.lanes.filter((l) => obs.every((o) => Math.abs(o.x - l) >= o.r + 0.13 || o.kind === 'armadillo'));
    assert.ok(free.length >= 1, `seed ${seed} ${d}m: 빈 레인이 있다`);
  }
  const kinds = new Set([...all].map((o) => o.kind));
  assert.ok(kinds.has('coin') && kinds.has('ramp') && kinds.has('armadillo'), `seed ${seed}: 냥코인·점프대·아르마딜로가 있다 (${[...kinds].join(',')})`);
}

/** 앞 d m 에 x 자리로 장애물을 둔다 */
const ahead = (s: SandState, kind: Ob['kind'], d: number, x = s.x): Ob => {
  const o: Ob = { kind, x, d: s.d + d, r: kind === 'coin' ? 0.14 : 0.17, anim: 0 };
  s.obs.push(o);
  return o;
};
const clean = (s: SandState) => (s.obs = s.obs.filter((o) => o.kind === 'coin' && false)); // 깔린 코스를 비운다
const until = (s: SandState, f: () => boolean, input = still, max = 10) => {
  for (let t = 0; t < max && !f(); t += DT) updateSandboard(s, input, DT);
};

// 2) 바위: 그냥 가면 부딪혀 느려지고 잠깐 조작이 안 된다. 점프하면 넘는다. 냥코인은 지나가며 줍는다
{
  const s = makeSandboard(seeded(2));
  clean(s);
  s.nextAt = 9999;
  const v0 = s.v;
  const rock = ahead(s, 'rock', 8);
  until(s, () => rock.hit === true);
  assert.ok(rock.hit && s.v < v0 * 0.6 && s.dizzy > 0 && s.crashes === 1, `부딪히면 느려진다 (${v0.toFixed(1)} → ${s.v.toFixed(1)})`);
  const x0 = s.x;
  updateSandboard(s, { mx: 1, jump: false }, DT);
  assert.equal(s.x, x0, '어지러운 동안은 조작이 안 된다');
  until(s, () => s.dizzy <= 0);
  updateSandboard(s, { mx: 1, jump: false }, DT);
  assert.ok(s.x > x0, '회복하면 다시 움직인다');

  const j = makeSandboard(seeded(2));
  clean(j);
  j.nextAt = 9999;
  const rock2 = ahead(j, 'rock', 6);
  updateSandboard(j, { mx: 0, jump: true }, DT);
  assert.ok(j.air > 0 && j.events.some((e) => e.type === 'jump'));
  until(j, () => j.d > rock2.d + 2);
  assert.ok(!rock2.hit && j.crashes === 0, '점프하면 바위를 넘는다');
  assert.ok(j.events.length === 0 || j.air === 0, '내려온다');

  const c = makeSandboard(seeded(2));
  clean(c);
  c.nextAt = 9999;
  const coin = ahead(c, 'coin', 5);
  until(c, () => c.d > coin.d + 2);
  assert.ok(coin.got && c.coins === 1, '냥코인 줍기');
  // 옆 레인의 바위는 안 부딪힌다
  const r3 = ahead(c, 'rock', 6, c.x + 0.6);
  until(c, () => c.d > r3.d + 2);
  assert.ok(!r3.hit, '옆 레인은 비켜 간다');
}

// 3) 점프대: 더 길게 뜨고 빨라진다. 아르마딜로는 가까워지면 가로질러 굴러온다
{
  const s = makeSandboard(seeded(4));
  clean(s);
  s.nextAt = 9999;
  const ramp = ahead(s, 'ramp', 6);
  const v0 = s.v;
  until(s, () => ramp.hit === true);
  assert.ok(s.air > SAND.jump && s.v > v0 + 1 && s.events.some((e) => e.type === 'ramp'), '점프대');
  const a = makeSandboard(seeded(4));
  clean(a);
  a.nextAt = 9999;
  const arm = ahead(a, 'armadillo', 60, -1.25);
  arm.vx = 1;
  until(a, () => a.d > arm.d - 40);
  assert.equal(arm.x, -1.25, '32m 밖이면 가만히');
  until(a, () => a.d > arm.d - 10);
  assert.ok(arm.x > -1.1, `가까워지면 굴러온다 (${arm.x.toFixed(2)})`);
}

// 4) 완주: 빈 레인으로 피하고 바위 앞에서 점프하는 간단한 조종으로 끝까지. 무사하면 보너스, 부딪히면 없음. 끝난 뒤엔 멈춘다
{
  const drive = (seed: number, jumpy: boolean) => {
    const s = makeSandboard(seeded(seed));
    let t = 0;
    while (s.phase === 'play' && t < 120) {
      const threats = s.obs.filter((o) => solid(o) && !o.hit && o.d > s.d && o.d < s.d + 22);
      const lane = SAND.lanes.map((l) => ({ l, bad: threats.filter((o) => Math.abs(o.x - l) < o.r + 0.2).length + Math.abs(l - s.x) * 0.01 })).sort((p, q) => p.bad - q.bad)[0].l;
      const near = threats.some((o) => o.d - s.d < 7 && Math.abs(o.x - s.x) < o.r + 0.13);
      updateSandboard(s, { mx: Math.abs(lane - s.x) < 0.03 ? 0 : Math.sign(lane - s.x), jump: jumpy && near && s.air <= 0 }, DT);
      t += DT;
    }
    return { s, t };
  };
  const a = drive(7, true);
  const fin = a.s.events.find((e) => e.type === 'finish');
  assert.ok(a.s.phase === 'done' && fin && fin.type === 'finish', '끝까지 가면 완주');
  assert.ok(a.s.coins > 0, `냥코인을 줍는다 (${a.s.coins})`);
  console.log(`  샌드보드 ${SAND.length}m: ${a.t.toFixed(1)}초 · 냥코인 ${a.s.coins} · 부딪힘 ${a.s.crashes} · 점수 ${a.s.score}`);
  if (a.s.crashes === 0) assert.equal(a.s.score, a.s.coins + SAND.cleanBonus, '무사 완주 보너스');
  else assert.equal(a.s.score, a.s.coins);
  const d0 = a.s.d;
  updateSandboard(a.s, { mx: 1, jump: true }, DT);
  assert.ok(a.s.d === d0 && a.s.events.length === 0, '끝난 뒤엔 멈춘다');

  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) if (drive(seed, true).s.phase === 'done') wins++;
  assert.equal(wins, 10, '피하고 점프하면 늘 완주한다');
}

console.log('sandboard.check: ok');
