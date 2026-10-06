// node src/sandboard.check.ts  (npm run check) — 늘 지나갈 길이 있고, 점프로 넘고(높은 건 점프대로만), 부딪히면 하트를 잃고,
// 방패·자석·하트·가속·구덩이·둔덕이 제 일을 하고, 끝까지 가면 완주 / 하트를 다 잃으면 넘어져 끝
import assert from 'node:assert/strict';
import { makeSandboard, OBS, SAND, solid, updateSandboard, type Ob, type ObKind, type SandState } from './sandboard.ts';

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const DT = 1 / 60;
const still = { mx: 0, jump: false };

// 1) 코스: 장애물 줄마다 레인 하나는 비어 있다. 물건이 고루 나온다 (30판, 지나간 건 지워지니 모아 둔다)
const seen = new Set<ObKind>();
for (let seed = 1; seed <= 30; seed++) {
  const s = makeSandboard(seeded(seed));
  const all = new Set<Ob>();
  while (s.nextAt < SAND.length - 25) {
    s.d += 40;
    updateSandboard(s, still, 0);
    s.phase = 'play';
    for (const o of s.obs) all.add(o);
  }
  const rows = new Map<number, Ob[]>();
  for (const o of all) if (solid(o.kind)) rows.set(o.d, [...(rows.get(o.d) ?? []), o]);
  assert.ok(rows.size >= 10, `seed ${seed}: 장애물 줄 ${rows.size}`);
  for (const [d, obs] of rows) {
    const free = SAND.lanes.filter((l) => obs.every((o) => Math.abs(o.x - l) >= OBS[o.kind].r + SAND.catR));
    assert.ok(free.length >= 1, `seed ${seed} ${d}m: 빈 레인이 있다`);
  }
  for (const o of all) seen.add(o.kind);
}
const missing = (Object.keys(OBS) as ObKind[]).filter((k) => !seen.has(k));
assert.equal(missing.length, 0, `30판에 모든 물건이 나온다 (안 나온 것: ${missing.join(', ')})`);

/** 깔린 코스를 비우고 앞 d m · x 자리에 물건 하나 */
const fresh = (seed = 2) => {
  const s = makeSandboard(seeded(seed));
  s.obs = [];
  s.nextAt = 9999;
  return s;
};
const ahead = (s: SandState, kind: ObKind, d: number, x = s.x): Ob => {
  const o: Ob = { kind, x, d: s.d + d };
  s.obs.push(o);
  return o;
};
const until = (s: SandState, f: () => boolean, input = still, max = 10) => {
  for (let t = 0; t < max && !f() && s.phase === 'play'; t += DT) updateSandboard(s, input, DT);
};

// 2) 바위: 그냥 가면 부딪혀 하트 하나 · 느려지고 잠깐 넘어진다. 점프하면 넘는다. 옆 레인은 비켜 간다
{
  const s = fresh();
  const v0 = s.v;
  const rock = ahead(s, 'small_rock', 8);
  until(s, () => rock.hit === true);
  assert.ok(s.v < v0 * 0.6 && s.dizzy > 0 && s.hearts === SAND.hearts - 1 && s.crashes === 1, `부딪히면 하트 -1 · 느려짐 (${v0.toFixed(1)} → ${s.v.toFixed(1)})`);
  const x0 = s.x;
  updateSandboard(s, { mx: 1, jump: false }, DT);
  assert.equal(s.x, x0, '넘어진 동안은 조작이 안 된다');
  until(s, () => s.dizzy <= 0);
  updateSandboard(s, { mx: 1, jump: false }, DT);
  assert.ok(s.x > x0, '일어나면 다시 움직인다');

  const j = fresh();
  const rock2 = ahead(j, 'wood_barrier', 6);
  updateSandboard(j, { mx: 0, jump: true }, DT);
  assert.ok(j.air > 0 && j.events.some((e) => e.type === 'jump') && j.fx.some((f) => f.id === 'jump_puff'));
  until(j, () => j.d > rock2.d + 2 && j.air <= 0);
  assert.ok(!rock2.hit && j.crashes === 0, '점프하면 울타리를 넘는다');
  assert.ok(j.fx.some((f) => f.id === 'land_burst'), '내려오면 착지 효과');

  const side = fresh();
  const r3 = ahead(side, 'wide_rock', 6, side.x + 0.4);
  until(side, () => side.d > r3.d + 2);
  assert.ok(!r3.hit, '옆 레인은 비켜 간다');
}

// 3) 높은 것은 점프로 못 넘고 점프대로는 넘는다
{
  const s = fresh();
  const tall = ahead(s, 'tall_rock', 6);
  updateSandboard(s, { mx: 0, jump: true }, DT);
  until(s, () => tall.hit === true || s.d > tall.d + 2);
  assert.ok(tall.hit && s.crashes === 1, '높은 바위는 점프로 못 넘는다');

  const r = fresh();
  const ramp = ahead(r, 'jump_ramp', 4);
  const tall2 = ahead(r, 'spiky_cactus', 12);
  const v0 = r.v;
  until(r, () => ramp.hit === true);
  assert.ok(r.air > SAND.jump && r.v > v0 + 1 && r.events.some((e) => e.type === 'ramp'), '점프대: 더 길게 뜨고 빨라진다');
  until(r, () => r.d > tall2.d + 2);
  assert.ok(!tall2.hit && r.crashes === 0, '점프대로 뜨면 높은 선인장도 넘는다');

  const b = fresh();
  const bump = ahead(b, 'sand_bump', 4);
  until(b, () => bump.hit === true);
  assert.ok(b.air > 0 && b.airMax === SAND.bump, '모래 둔덕은 작게 뜬다');
}

// 4) 줍기 · 보상: 냥코인 1 · 더미 5 · 상자 15, 하트 +1(최대 3), 방패는 한 번 막고 사라짐, 자석은 옆 레인 냥코인도 끌어온다
{
  const c = fresh();
  ahead(c, 'paw_coin', 4);
  ahead(c, 'coin_pile', 8);
  ahead(c, 'treasure_chest', 12);
  until(c, () => c.d > c.obs[2].d + 2);
  assert.equal(c.coins, 21, '냥코인 1 + 더미 5 + 상자 15');
  assert.ok(c.pops.length > 0 && c.fx.some((f) => f.id === 'pickup_sparkle'), '줍기 글자 · 반짝임');

  const h = fresh();
  h.hearts = 1;
  ahead(h, 'heart_pickup', 4);
  ahead(h, 'heart_pickup', 8);
  ahead(h, 'heart_pickup', 12);
  until(h, () => h.obs.every((o) => o.got));
  assert.equal(h.hearts, SAND.hearts, '하트는 최대 3개까지');

  const sh = fresh();
  ahead(sh, 'shield_pickup', 4);
  const r1 = ahead(sh, 'barrel', 9);
  const r2 = ahead(sh, 'barrel', 16);
  until(sh, () => sh.d > r2.d + 2);
  assert.ok(r1.hit && r2.hit && sh.crashes === 1 && sh.hearts === SAND.hearts - 1, '방패는 한 번만 막는다');

  const m = fresh();
  ahead(m, 'magnet_pickup', 3);
  const far = ahead(m, 'paw_coin', 12, m.x + 0.8);
  until(m, () => m.d > far.d + 3);
  assert.ok(far.got && m.coins === 1, '자석: 옆 레인 냥코인도 끌어온다');
  const n = fresh();
  const far2 = ahead(n, 'paw_coin', 12, n.x + 0.8);
  until(n, () => n.d > far2.d + 3);
  assert.ok(!far2.got, '자석이 없으면 옆 레인 냥코인은 못 줍는다');
}

// 5) 가속 발판은 잠깐 최고 속도를 넘기고, 모래 구덩이는 느려지지만 하트는 그대로
{
  const s = fresh();
  ahead(s, 'boost_pad', 4);
  until(s, () => s.boost > 0);
  assert.ok(s.v > SAND.vMax, '가속 발판');
  until(s, () => s.boost <= 0);
  until(s, () => s.v <= SAND.vMax + 0.01, still, 5);
  assert.ok(s.v <= SAND.vMax + 0.01, '가속이 끝나면 최고 속도로 돌아온다');

  const p = fresh();
  p.v = 20;
  const pit = ahead(p, 'sand_pit', 4);
  until(p, () => pit.hit === true);
  assert.ok(p.v < 12 && p.hearts === SAND.hearts && p.crashes === 0, '모래 구덩이: 느려지지만 하트는 그대로');
}

// 6) 하트를 다 잃으면 넘어져 끝 (점수 = 냥코인, 보너스 없음)
{
  const s = fresh();
  for (let i = 0; i < 3; i++) ahead(s, 'barrel', 6 + i * 14);
  until(s, () => s.phase === 'done', still, 20);
  const fin = s.events.find((e) => e.type === 'finish');
  assert.ok(s.phase === 'done' && s.fell && fin?.type === 'finish' && fin.fell && fin.score === s.coins, '하트 0 → 넘어져 끝');
}

// 6-1) 드리프트: 누르면 가로 속도가 붙고, 떼면 잠깐 미끄러지다 선다 (한 레인 안). 가장자리에선 멈춘다
{
  const s = fresh();
  for (let t = 0; t < 0.3; t += DT) updateSandboard(s, { mx: 1, jump: false }, DT);
  assert.ok(s.vx > SAND.steer * 0.9 && s.lean > 0.9 && s.steer === 1, `누르면 가로 속도가 붙는다 (${s.vx.toFixed(2)})`);
  const x0 = s.x;
  updateSandboard(s, still, DT);
  assert.ok(s.x > x0, '떼도 바로 서지 않는다');
  for (let t = 0; t < 1; t += DT) updateSandboard(s, still, DT);
  const slid = s.x - x0;
  assert.ok(slid > 0.1 && slid < 0.45 && Math.abs(s.vx) < 0.01 && s.steer === 0, `미끄러지다 선다 (${slid.toFixed(2)})`);
  for (let t = 0; t < 2; t += DT) updateSandboard(s, { mx: 1, jump: false }, DT);
  assert.ok(s.x === SAND.edge && s.vx === 0, '가장자리에선 멈춘다');
}

// 7) 완주: 빈 레인으로 피하고, 낮은 건 점프로 넘는 간단한 조종으로 끝까지. 무사하면 보너스. 끝난 뒤엔 멈춘다
{
  const drive = (seed: number) => {
    const s = makeSandboard(seeded(seed));
    let t = 0;
    while (s.phase === 'play' && t < 120) {
      const threats = s.obs.filter((o) => (solid(o.kind) || OBS[o.kind].role === 'pit') && !o.hit && o.d > s.d && o.d < s.d + 22);
      const lane = SAND.lanes
        .map((l) => ({ l, bad: threats.filter((o) => Math.abs(o.x - l) < OBS[o.kind].r + 0.16).length + Math.abs(l - s.x) * 0.01 }))
        .sort((p, q) => p.bad - q.bad)[0].l;
      const near = threats.some((o) => o.d - s.d < 6 && Math.abs(o.x - s.x) < OBS[o.kind].r + SAND.catR + 0.02 && OBS[o.kind].role === 'hit');
      const pred = s.x + s.vx * SAND.steerOut; // 떼면 이만큼 더 미끄러진다
      updateSandboard(s, { mx: Math.abs(lane - pred) < 0.03 ? 0 : Math.sign(lane - pred), jump: near && s.air <= 0 }, DT);
      t += DT;
    }
    return { s, t };
  };
  const a = drive(7);
  const fin = a.s.events.find((e) => e.type === 'finish');
  assert.ok(a.s.phase === 'done' && fin && !a.s.fell, '끝까지 가면 완주');
  assert.ok(a.s.coins > 0, `냥코인을 줍는다 (${a.s.coins})`);
  console.log(`  샌드보드 ${SAND.length}m: ${a.t.toFixed(1)}초 · 냥코인 ${a.s.coins} · 부딪힘 ${a.s.crashes} · 점수 ${a.s.score}`);
  if (a.s.crashes === 0) assert.equal(a.s.score, a.s.coins + SAND.cleanBonus, '무사 완주 보너스');
  else assert.equal(a.s.score, a.s.coins);
  const d0 = a.s.d;
  updateSandboard(a.s, { mx: 1, jump: true }, DT);
  assert.ok(a.s.d === d0 && a.s.events.length === 0, '끝난 뒤엔 멈춘다');

  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) if (!drive(seed).s.fell) wins++;
  assert.ok(wins >= 9, `피하고 점프하면 거의 늘 완주한다 (${wins}/10)`);
}

console.log('sandboard.check: ok');
