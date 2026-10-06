// node src/sandboard.check.ts  (npm run check) — 늘 지나갈 길이 있고, 점프로 넘고(높은 건 점프대로만), 부딪히면 하트를 잃고,
// 방패·자석·하트·가속·구덩이·둔덕이 제 일을 하고, 끝까지 가면 완주 / 하트를 다 잃으면 넘어져 끝
import assert from 'node:assert/strict';
import { coast, makeSandboard, OBS, SAND, solid, updateSandboard, type Ob, type ObKind, type SandState } from './sandboard.ts';

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

// 6-1) 미끄러짐 손맛 (드리프트 → 카빙): 누르면 보드가 먼저 꺾이고(살짝 넘쳤다 돌아옴) 몸은 늦게 옆으로 흐른다.
//      시작할 때 미끄러짐이 커서 "촤악"(slide) 하고 모래를 튀기며 확 느려지고, 엣지가 물리면(carve) 잃은 것보다 더 빨라진다.
//      떼면 한 레인 안에서 미끄러지다 선다.
//      숫자를 바꾸면 여기 표가 손맛을 보여 준다 — 범위를 벗어나면 실패
{
  const s = fresh();
  s.v = 20;
  const rows: { t: number; yaw: number; vx: number; x: number; slip: number; v: number }[] = [];
  const step = (mx: number, secs: number) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      updateSandboard(s, { mx, jump: false }, DT);
      rows.push({ t: rows.length * DT + DT, yaw: s.yaw, vx: s.vx, x: s.x, slip: s.slip, v: s.v });
    }
  };
  step(1, 1);
  const at = (sec: number) => rows[Math.round(sec / DT) - 1];
  // 속도: 가장 느려지는 때 · 카빙으로 가장 빨라지는 때 (누른 지 1초 안)
  const low = rows.reduce((m, r) => (r.v < m.v ? r : m));
  // 카빙이 끝나는 때(가장 느린 때 + 카빙 시간)의 속도 — 그 뒤로는 그냥 가속이라 재지 않는다
  const high = at(Math.round((low.t + SAND.carveTime + 0.05) / DT) * DT);
  const yaw90 = rows.find((r) => r.yaw >= SAND.yawMax * 0.9)!.t;
  const over = Math.max(...rows.map((r) => r.yaw)) / SAND.yawMax - 1;
  const vx90 = rows.find((r) => r.vx >= SAND.steer * 0.9)!.t;
  const kick = at(0.1);
  const peakSlip = Math.max(...rows.map((r) => r.slip));
  const lost = 20 - at(0.3).v;
  // 떼기: 왼쪽 끝에서 0.6초 오른쪽으로 달리다 뗀다 (1초를 누르면 가장자리에 닿아 버린다)
  const r = fresh();
  r.x = -0.9;
  for (let k = 0; k < 36; k++) updateSandboard(r, { mx: 1, jump: false }, DT);
  const x0 = r.x;
  const pred = coast(r);
  let restT = 0;
  for (let k = 1; k <= 60; k++) {
    updateSandboard(r, still, DT);
    if (!restT && Math.abs(r.vx) < 0.02) restT = k * DT;
  }
  const out = r.x - x0;
  const tap = (secs: number) => {
    const q = fresh();
    for (let k = 0; k < Math.round(secs / DT); k++) updateSandboard(q, { mx: 1, jump: false }, DT);
    for (let k = 0; k < 72; k++) updateSandboard(q, still, DT);
    return q.x;
  };
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0) + '°';
  console.log('  미끄러짐 손맛:');
  console.log(`    보드 각도  최대 ${deg(SAND.yawMax)} · 90% 까지 ${yaw90.toFixed(2)}초 · 넘침 ${(over * 100).toFixed(0)}% (살짝 넘쳤다 돌아옴)`);
  console.log(`    0.1초 뒤   보드 ${deg(kick.yaw)} 꺾였는데 옆으로는 ${kick.x.toFixed(2)} 만 — 보드가 먼저, 몸은 나중`);
  console.log(`    가로 속도  90% 까지 ${vx90.toFixed(2)}초 · 최대 미끄러짐 ${peakSlip.toFixed(2)}`);
  console.log(`    앞 속도    20 m/s → 드리프트로 ${low.v.toFixed(1)} (${low.t.toFixed(2)}초) → 카빙으로 ${high.v.toFixed(1)} (${high.t.toFixed(2)}초) · 0.3초 감속 ${lost.toFixed(1)}`);
  console.log(`    떼면       ${out.toFixed(2)} 더 미끄러지고 ${restT.toFixed(2)}초 만에 섬 (한 레인 = 0.4) · 미리 셈 ${pred.toFixed(2)} → 실제 ${r.x.toFixed(2)}`);
  console.log(`    톡 누르기  0.1초 → ${tap(0.1).toFixed(2)} · 0.15초 → ${tap(0.15).toFixed(2)} · 0.25초 → ${tap(0.25).toFixed(2)}`);
  assert.ok(yaw90 >= 0.1 && yaw90 <= 0.2, `보드는 빨리 꺾인다 (${yaw90})`);
  assert.ok(over > 0.04 && over < 0.2, `살짝 넘쳤다 돌아온다 (${over})`);
  assert.ok(kick.yaw > SAND.yawMax * 0.6 && kick.x < 0.05, '처음엔 보드만 꺾이고 몸은 거의 그대로 (드리프트 시작)');
  assert.ok(vx90 > yaw90 + 0.1 && vx90 < 0.5, `몸은 늦게 따라온다 (${vx90})`);
  assert.ok(peakSlip > SAND.slideAt && 20 - low.v > 1.8 && 20 - low.v < 4 && low.t < 0.4, `드리프트: 미끄러지며 확 느려진다 (${low.v.toFixed(2)} @ ${low.t.toFixed(2)})`);
  assert.ok(high.v > 20 + 1 && high.t - low.t < 0.6, `카빙: 엣지가 물리면 처음보다 빨라진다 (${high.v.toFixed(2)} @ ${high.t.toFixed(2)})`);
  assert.ok(out > 0.2 && out < 0.4 && restT < 0.6, `떼면 한 레인 안에서 미끄러지다 선다 (${out}, ${restT})`);
  assert.ok(Math.abs(pred - r.x) < 0.01, '떼면 멈출 자리를 미리 셀 수 있다 (자동 조종이 쓴다)');
  const t1 = tap(0.15);
  assert.ok(t1 > 0.25 && t1 < 0.45, `0.15초 톡 = 한 레인쯤 (${t1})`);

  // "촤악"(slide): 시작할 때 한 번, 엣지가 물려 카빙(carve)이 되기 전엔 다시 안 난다. 반대로 홱 틀면 또 난다 (가장자리에 안 닿게 왼쪽 끝에서 출발)
  const c = fresh();
  c.x = -0.9;
  let carves = 0;
  let boosts = 0;
  const run = (mx: number, secs: number) => {
    for (let k = 0; k < Math.round(secs / DT); k++) {
      updateSandboard(c, { mx, jump: false }, DT);
      carves += c.events.filter((e) => e.type === 'slide').length;
      boosts += c.events.filter((e) => e.type === 'carve').length;
    }
  };
  run(1, 0.5);
  assert.equal(carves, 1, '누르면 촤악 한 번');
  assert.equal(boosts, 1, '이어서 엣지가 물리며 카빙 한 번');
  assert.ok(c.fx.some((f) => f.id === 'carve_spray' && f.flip === -1), '오른쪽으로 틀면 모래는 왼쪽(뒤집음)으로');
  run(-1, 0.4);
  assert.equal(carves, 2, '반대로 홱 틀면 또 촤악');
  // 가장자리에선 서고, 계속 바깥으로 눌러도 보드가 펴져서 미끄러지며 느려지지 않는다
  run(1, 2);
  const vEdge = c.v;
  run(1, 0.5);
  assert.ok(c.x >= SAND.edge - 0.03 && Math.abs(c.vx) < 0.01 && Math.abs(c.yaw) < 0.02 && c.slip === 0 && c.v >= vEdge, `가장자리: 멈추고 보드가 펴진다 (자리 ${c.x.toFixed(3)}, 각도 ${c.yaw.toFixed(3)})`);
  assert.equal(carves, 3, '가장자리에 닿을 땐 촤악 안 함 (오른쪽으로 다시 틀 때 한 번만)');
  // 좌우로 흔들어도(0.3초씩 6번) 끝없이 빨라지지 않는다 — 잃은 만큼만 돌려주니 오히려 느려진다
  const w = fresh();
  w.v = SAND.vMax;
  let wmax = 0;
  for (let i = 0; i < 6; i++)
    for (let k = 0; k < 18; k++) {
      updateSandboard(w, { mx: i % 2 ? -1 : 1, jump: false }, DT);
      wmax = Math.max(wmax, w.v);
    }
  assert.ok(wmax <= SAND.vMax + SAND.carveMax && w.v < SAND.vMax, `흔들기는 이득이 없다 (최고 ${wmax.toFixed(1)}, 끝 ${w.v.toFixed(1)})`);
  // 톡 치고 바로 펴면 카빙이 짧다 — 길게 그은 것보다 덜 빨라진다
  const short = fresh();
  short.v = 20;
  for (let k = 0; k < 9; k++) updateSandboard(short, { mx: 1, jump: false }, DT);
  let smax = 0;
  for (let k = 0; k < 60; k++) {
    updateSandboard(short, still, DT);
    smax = Math.max(smax, short.v);
  }
  assert.ok(smax < high.v, `톡 친 것보다 길게 그은 카빙이 더 빠르다 (${smax.toFixed(1)} < ${high.v.toFixed(1)})`);
  // 공중에선 감속·촤악이 없다
  const a = fresh();
  a.air = a.airMax = 1;
  const v0 = a.v;
  for (let k = 0; k < 20; k++) updateSandboard(a, { mx: 1, jump: false }, DT);
  assert.ok(a.v >= v0 && !a.fx.some((f) => f.id === 'carve_spray'), '공중에선 미끄러지지 않는다');
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
      const pred = coast(s); // 지금 떼면 멈출 자리 (드리프트로 더 미끄러지는 만큼)
      updateSandboard(s, { mx: Math.abs(lane - pred) < 0.04 ? 0 : Math.sign(lane - pred), jump: near && s.air <= 0 }, DT);
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
