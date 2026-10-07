// node src/sandboard.check.ts  (npm run check) — 곧은 길에 장애물이 촘촘하고 커브는 두세 번만 짧게(따라갈 수 있게), 늘 지나갈 길이 있고,
// 점프로 넘고(높은 건 점프대로만), 부딪히면 하트를 잃고, 안쪽으로 오는 울타리에 밀리면 느려지고, 방패·자석·하트·가속·구덩이·둔덕이 제 일을 하고,
// 끝까지 가면 완주 / 하트를 다 잃으면 넘어져 끝
import assert from 'node:assert/strict';
import {
  center,
  coast,
  curvy,
  CURVE_SPAN,
  fences,
  makeSandboard,
  OBS,
  SAND,
  slope,
  solid,
  STRAIGHT,
  updateSandboard,
  width,
  type Course,
  type Ob,
  type ObKind,
  type SandState,
} from './sandboard.ts';

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const DT = 1 / 60;
const still = { mx: 0, jump: false };

// 0) 코스 모양: 조각이 끊김 없이 이어지고(가운데가 튀지 않음), 대부분 곧은 길에 커브 구간은 curves 번만 — 짧게(CURVE_SPAN 안),
//    출발 80m 뒤부터, 결승 앞 finish m 는 곧게. 다리는 왼쪽 · 오른쪽 번갈아, 기울기 · 폭은 한도 안.
//    slope() 는 center() 의 기울기, dw 는 폭의 기울기와 같다 (울타리가 미는 빠르기 · 자동 조종이 쓴다). 30판에 지그재그 · 시케인이 다 나온다
const kinds: Record<string, number> = {};
let curveSum = 0;
for (let seed = 1; seed <= 30; seed++) {
  const s = makeSandboard(seeded(seed));
  const C = SAND.course;
  const segs = s.course.segs;
  const groups: { d0: number; d1: number }[] = [];
  segs.forEach((g, i) => {
    kinds[g.kind] = (kinds[g.kind] ?? 0) + 1;
    if (curvy(g)) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last.d1 - g.d0) < 1e-6) last.d1 = g.d1;
      else groups.push({ d0: g.d0, d1: g.d1 });
    }
    if (!i) return;
    assert.ok(Math.abs(g.d0 - segs[i - 1].d1) < 1e-9, `seed ${seed}: 조각이 이어진다`);
    assert.ok(Math.abs(center(s.course, g.d0 - 1e-7) - g.c0) < 1e-5, `seed ${seed} ${g.d0.toFixed(0)}m: 가운데가 튀지 않는다`);
  });
  curveSum += groups.length;
  assert.ok(groups.length >= C.curves[0] && groups.length <= C.curves[1], `seed ${seed}: 커브 구간 ${groups.length}번`);
  for (const g of groups) {
    assert.ok(g.d1 - g.d0 <= CURVE_SPAN + 1e-9, `seed ${seed}: 커브 구간은 짧게 (${(g.d1 - g.d0).toFixed(0)}m)`);
    assert.ok(g.d0 >= C.start + 80 - 1e-9 && g.d1 <= SAND.length - C.finish + 1e-9, `seed ${seed}: 커브는 출발 80m 뒤 ~ 결승 곧은 길 앞 (${g.d0.toFixed(0)}~${g.d1.toFixed(0)}m)`);
  }
  const legs = segs.filter((g) => g.s0 === g.s1 && g.s1 !== 0);
  legs.forEach((g, i) => i && assert.notEqual(Math.sign(g.s1), Math.sign(legs[i - 1].s1), `seed ${seed} ${g.d0.toFixed(0)}m: 왼쪽 · 오른쪽 번갈아`));
  for (let d = -10; d <= SAND.length + 20; d += 0.25) {
    const k = slope(s.course, d);
    const { w, dw } = width(s.course, d);
    assert.ok(Math.abs(k) <= Math.max(C.zigzag.slope[1], C.chicane.slope) + 1e-9, `seed ${seed} ${d}m: 기울기 ${k}`);
    assert.ok(w >= C.narrow - 1e-9 && w <= 1 + 1e-9, `seed ${seed} ${d}m: 폭 ${w}`);
    if (d <= C.start) assert.ok(center(s.course, d) === 0 && w === 1, '처음은 곧게');
    if (d >= SAND.length - C.finish) assert.ok(k === 0 && w === 1, `seed ${seed} ${d}m: 결승 앞은 곧게`);
    const num = (center(s.course, d + 0.01) - center(s.course, d - 0.01)) / 0.02;
    assert.ok(Math.abs(num - k) < 1e-4, `seed ${seed} ${d}m: slope = center 의 기울기 (${num} · ${k})`);
    const numW = (width(s.course, d + 0.01).w - width(s.course, d - 0.01).w) / 0.02;
    assert.ok(Math.abs(numW - dw) < 1e-3, `seed ${seed} ${d}m: dw = 폭의 기울기 (${numW} · ${dw})`);
  }
}
for (const k of ['run', 'leg', 'corner', 'chicane']) assert.ok((kinds[k] ?? 0) >= 3, `30판에 ${k} 가 나온다 (${kinds[k] ?? 0})`);
console.log(`  코스 30판: 커브 구간 판마다 평균 ${(curveSum / 30).toFixed(1)}번 · 조각 ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · ')}`);

// 1) 물건: 장애물 줄마다 레인 하나는 비어 있다(레인은 그 거리의 길 가운데 · 폭 기준). 가까운(22m 안) 다음 줄은 빈 레인이 앞 줄의 빈 레인과 이웃한다.
//    물건은 모두 울타리 안. 부딪히는 것은 커브 구간과 그 8m 앞 · 12m 뒤에 없다 (꺾으며 가로지를 틈). 점프대 줄은 모든 레인을 덮는다.
//    곧은 길엔 장애물이 촘촘하다. 고루 나온다 (30판, 지나간 건 지워지니 모아 둔다)
const seen = new Set<ObKind>();
const rowCounts: number[] = [];
const rampRows: { seed: number; d: number }[] = [];
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
  rowCounts.push(rows.size);
  assert.ok(rows.size >= 18, `seed ${seed}: 장애물 줄 ${rows.size} (촘촘하게)`);
  const freeOf = (d: number, obs: Ob[]) => {
    const f = fences(s.course, d);
    return SAND.lanes.map((l) => l * f.w).filter((l) => obs.every((o) => Math.abs(o.x - f.c - l) >= OBS[o.kind].r + SAND.catR));
  };
  let prev: { d: number; free: number[] } | null = null;
  for (const [d, obs] of [...rows].sort((p, q) => p[0] - q[0])) {
    const free = freeOf(d, obs);
    assert.ok(free.length >= 1, `seed ${seed} ${d}m: 빈 레인이 있다`);
    if (prev && d - prev.d < 22 && obs.length > 1)
      assert.ok(
        free.some((x) => prev!.free.some((p) => Math.abs(x - p) <= 0.45 * fences(s.course, d).w)),
        `seed ${seed} ${d.toFixed(0)}m: 빈 레인이 앞 줄(${(d - prev.d).toFixed(0)}m 전)의 빈 레인과 이웃한다`,
      );
    prev = { d, free };
  }
  for (const o of all) {
    const f = fences(s.course, o.d);
    assert.ok(o.x >= f.lo - 1e-9 && o.x <= f.hi + 1e-9, `seed ${seed} ${o.d.toFixed(0)}m ${o.kind}: 울타리 안`);
    if (!solid(o.kind)) continue;
    const bad = s.course.segs.find((q) => curvy(q) && o.d > q.d0 - 8 && o.d < q.d1 + 12);
    assert.ok(!bad, `seed ${seed} ${o.d.toFixed(1)}m ${o.kind}: 커브 둘레엔 장애물이 없다 (${bad?.kind} ${bad?.d0.toFixed(0)}~${bad?.d1.toFixed(0)}m)`);
  }
  const ramps = [...all].filter((o) => o.kind === 'jump_ramp');
  for (const d of new Set(ramps.map((o) => o.d))) {
    const row = ramps.filter((o) => o.d === d);
    if (row.length < 4) continue; // 점프대 하나짜리
    rampRows.push({ seed, d });
    const f = fences(s.course, d);
    for (let x = f.lo; x <= f.hi; x += 0.02)
      assert.ok(row.some((o) => Math.abs(o.x - x) < OBS.jump_ramp.r + SAND.catR), `seed ${seed} ${d.toFixed(0)}m: 점프대 줄이 모든 자리를 덮는다 (${(x - f.c).toFixed(2)})`);
  }
  for (const o of all) seen.add(o.kind);
}
const missing = (Object.keys(OBS) as ObKind[]).filter((k) => !seen.has(k));
assert.equal(missing.length, 0, `30판에 모든 물건이 나온다 (안 나온 것: ${missing.join(', ')})`);
assert.ok(rampRows.length >= 3, `30판에 점프대 줄 ${rampRows.length}번`);
console.log(`  장애물 줄: 판마다 ${Math.min(...rowCounts)} ~ ${Math.max(...rowCounts)} (평균 ${(rowCounts.reduce((x, y) => x + y, 0) / rowCounts.length).toFixed(1)}) · 점프대 줄 30판에 ${rampRows.length}번`);

/** 곧은 길에 깔린 물건을 비우고 (앞 d m · x 자리에 물건 하나씩 놓고 시험) */
const fresh = (seed = 2) => {
  const s = makeSandboard(seeded(seed));
  s.course = STRAIGHT;
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
  console.log(`    처음 저항  0.2초 뒤 옆으로 ${at(0.2).x.toFixed(3)} (저항 없을 땐 약 0.13)`);
  assert.ok(yaw90 >= 0.15 && yaw90 <= 0.3, `보드는 조금 묵직하게, 그래도 빨리 꺾인다 (${yaw90})`);
  assert.ok(over > 0.04 && over < 0.2, `살짝 넘쳤다 돌아온다 (${over})`);
  assert.ok(kick.yaw > SAND.yawMax * 0.35 && kick.x < 0.03, '처음엔 보드가 먼저 꺾이고 몸은 거의 그대로 (드리프트 시작)');
  assert.ok(at(0.2).x < 0.1, `처음 저항: 누르자마자 휙 가지 않는다 (0.2초 뒤 ${at(0.2).x.toFixed(3)})`);
  assert.ok(vx90 > yaw90 + 0.1 && vx90 < 0.5, `몸은 늦게 따라온다 (${vx90})`);
  assert.ok(peakSlip > SAND.slideAt && 20 - low.v > 1.8 && 20 - low.v < 4 && low.t < 0.4, `드리프트: 미끄러지며 확 느려진다 (${low.v.toFixed(2)} @ ${low.t.toFixed(2)})`);
  assert.ok(high.v > 20 + 1 && high.t - low.t < 0.6, `카빙: 엣지가 물리면 처음보다 빨라진다 (${high.v.toFixed(2)} @ ${high.t.toFixed(2)})`);
  assert.ok(out > 0.2 && out < 0.4 && restT < 0.6, `떼면 한 레인 안에서 미끄러지다 선다 (${out}, ${restT})`);
  assert.ok(Math.abs(pred - r.x) < 0.01, '떼면 멈출 자리를 미리 셀 수 있다 (자동 조종이 쓴다)');
  const t1 = tap(0.15);
  const t2 = tap(0.3);
  assert.ok(t1 > 0.12 && t1 < 0.3, `0.15초 톡 = 반 레인쯤 (${t1.toFixed(2)})`);
  assert.ok(t2 > 0.35 && t2 < 0.6, `0.3초 = 한 레인쯤 (${t2.toFixed(2)})`);

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
  // 공중에선 좌우로 땅의 airSteer(20%) 만큼만 간다 — 같은 조작을 땅과 공중에서 0.5초. 착지하면 끊김 없이 다시 그대로
  const ground = fresh();
  const air = fresh();
  air.air = air.airMax = 0.7;
  for (let k = 0; k < 30; k++) {
    updateSandboard(ground, { mx: 1, jump: false }, DT);
    updateSandboard(air, { mx: 1, jump: false }, DT);
  }
  const ratio = air.x / ground.x;
  assert.ok(Math.abs(ratio - SAND.airSteer) < 0.01, `점프 중엔 좌우로 ${(ratio * 100).toFixed(0)}% 만 (땅 ${ground.x.toFixed(2)} · 공중 ${air.x.toFixed(2)})`);
  until(air, () => air.air <= 0, { mx: 1, jump: false });
  const nudge = (q: SandState) => {
    const x0 = q.x;
    updateSandboard(q, { mx: 1, jump: false }, DT);
    return q.x - x0;
  };
  const vNow = air.vx;
  assert.ok(Math.abs(nudge(air) - vNow * DT) < 0.002, '착지하면 바로 땅에서처럼 (옆으로 튀지 않는다)');
  const airPred = coast({ ...air, air: 0.5 });
  const fly = { ...air, air: 0.5, airMax: 0.5, events: [], fx: [], pops: [], obs: [] } as SandState;
  for (let k = 0; k < 60; k++) updateSandboard(fly, still, DT);
  assert.ok(Math.abs(airPred - fly.x) < 0.01, `공중에서 떼도 멈출 자리를 미리 셀 수 있다 (${airPred.toFixed(3)} · ${fly.x.toFixed(3)})`);
}

// 6-2) 울타리: 가장 급한 다리(오른쪽으로)를 가만히 지나면 뒤따라오는 왼쪽 울타리에 밀려 가며 쓸리고(scrape — 촤악은 아님) 느려진다.
//      길이 가는 쪽으로 누르고 있으면 그쪽 울타리를 따라 그냥 미끄러진다 (쓸림 없음, 빠름). 어느 쪽이든 울타리는 못 넘는다
const legCourse = (d0: number, k: number, len: number): Course => ({
  segs: [
    { d0: -1e9, d1: d0, c0: 0, s0: 0, s1: 0, kind: 'start' },
    { d0, d1: d0 + 8, c0: 0, s0: 0, s1: k, kind: 'corner' },
    { d0: d0 + 8, d1: d0 + 8 + len, c0: 4 * k, s0: k, s1: k, kind: 'leg' },
    { d0: d0 + 8 + len, d1: 1e9, c0: 4 * k + k * len, s0: k, s1: k, kind: 'finish' },
  ],
  widths: [{ d: 0, w: 1 }],
});
{
  const run = (mx: number) => {
    const s = fresh();
    s.v = SAND.vMax;
    const d0 = s.d + 5;
    s.course = legCourse(d0, SAND.course.zigzag.slope[1], 60);
    let scrapes = 0;
    let slides = 0;
    let outside = 0;
    while (s.d < d0 + 68) {
      updateSandboard(s, { mx, jump: false }, DT);
      scrapes += s.events.filter((e) => e.type === 'scrape').length;
      slides += s.events.filter((e) => e.type === 'slide').length;
      const f = fences(s.course, s.d);
      assert.ok(s.x >= f.lo - 1e-9 && s.x <= f.hi + 1e-9, `울타리는 못 넘는다 (${(s.x - f.c).toFixed(3)})`);
      if (s.x <= f.lo + 1e-6) outside += DT;
    }
    return { s, scrapes, slides, outside };
  };
  const loose = run(0);
  const held = run(1);
  console.log(
    `  울타리: 가장 급한 다리(오른쪽)를 가만히 → 왼쪽 울타리에 ${loose.outside.toFixed(1)}초 · 쓸림 ${loose.scrapes}번 · ${SAND.vMax} → ${loose.s.v.toFixed(1)} m/s` +
      ` / 오른쪽 누르고 → 쓸림 ${held.scrapes}번 · ${held.s.v.toFixed(1)} m/s`,
  );
  assert.ok(loose.outside > 1 && loose.scrapes >= 3 && loose.slides === 0, '가만히 있으면 뒤따라오는 울타리에 밀려 가며 쓸린다 (촤악은 아님)');
  assert.ok(loose.s.v < SAND.vMax - 3, `울타리에 쓸리면 느려진다 (${loose.s.v.toFixed(1)})`);
  assert.ok(held.scrapes === 0 && held.s.v > SAND.vMax - 1, `길이 가는 쪽으로 누르면 안 쓸리고 빠르다 (${held.s.v.toFixed(1)})`);
}

// 6-3) 좁아지는 길: 넓은 직선(1.3)에서 오른쪽 끝에 붙어 있다가 길이 0.8 로 좁아지면 울타리가 안쪽으로 밀고 온다 — 못 넘고, 쓸린다
{
  const s = fresh();
  s.v = SAND.vMax;
  const d0 = s.d + 10;
  s.course = { segs: STRAIGHT.segs, widths: [{ d: 0, w: 1.3 }, { d: d0, w: 1.3 }, { d: d0 + 12, w: 0.8 }] };
  s.x = SAND.edge * 1.3;
  let scrapes = 0;
  while (s.d < d0 + 20) {
    updateSandboard(s, { mx: 1, jump: false }, DT);
    scrapes += s.events.filter((e) => e.type === 'scrape').length;
    const f = fences(s.course, s.d);
    assert.ok(s.x <= f.hi + 1e-9, `좁아지는 울타리도 못 넘는다 (${s.x.toFixed(3)} > ${f.hi.toFixed(3)})`);
  }
  assert.ok(Math.abs(s.x - SAND.edge * 0.8) < 0.01 && scrapes >= 1, `좁아지면 안쪽으로 밀려 들어오며 쓸린다 (${s.x.toFixed(3)} · 쓸림 ${scrapes})`);
}

// 6-4) 점프대 줄: 곧은 길의 점프대 줄은 어느 자리로 지나가도 크게 떠서 구덩이 줄을 건너뛴다
{
  const { seed, d: rowD } = rampRows[0];
  for (const off of [-0.9, -0.62, -0.2, 0.21, 0.7]) {
    const q = makeSandboard(seeded(seed));
    while (q.nextAt <= rowD) {
      q.d += 40;
      updateSandboard(q, still, 0); // 그 줄까지 깐다
      q.phase = 'play';
    }
    q.obs = q.obs.filter((o) => o.d >= rowD - 0.5 && o.d < rowD + 30);
    const f = fences(q.course, rowD);
    Object.assign(q, { d: rowD - 3, x: f.c + off * (f.hi - f.c), vx: 0, yaw: 0, yawV: 0, v: SAND.vMax, phase: 'play', crashes: 0, hearts: SAND.hearts, dizzy: 0, air: 0, nextAt: 9999 });
    const seenEv = new Set<string>();
    while (q.d < rowD + 14) {
      updateSandboard(q, still, DT);
      for (const ev of q.events) seenEv.add(ev.type);
    }
    assert.ok(seenEv.has('ramp') && !seenEv.has('pit') && q.crashes === 0, `점프대 줄 (${off}): 떠서 구덩이를 건너뛴다 (${[...seenEv].join(',')})`);
  }
}

// 7) 완주: 빈 레인으로 피하고, 낮은 건 점프로 넘는 간단한 조종으로 지그재그 코스를 끝까지. 무사하면 보너스. 끝난 뒤엔 멈춘다
{
  const drive = (seed: number) => {
    const s = makeSandboard(seeded(seed));
    let t = 0;
    let scrapes = 0;
    while (s.phase === 'play' && t < 120) {
      const rel = (o: Ob) => o.x - center(s.course, o.d); // 레인은 그 거리의 길 가운데 · 폭 기준
      const threats = s.obs.filter((o) => (solid(o.kind) || OBS[o.kind].role === 'pit') && !o.hit && o.d > s.d && o.d < s.d + 22);
      const here = s.x - center(s.course, s.d);
      const w = width(s.course, s.d + 10).w;
      const lane = SAND.lanes
        .map((l) => l * w)
        .map((l) => ({ l, bad: threats.filter((o) => Math.abs(rel(o) - l) < OBS[o.kind].r + 0.16).length + Math.abs(l - here) * 0.01 }))
        .sort((p, q) => p.bad - q.bad)[0].l;
      const near = threats.some((o) => o.d - s.d < 6 && Math.abs(o.x - s.x) < OBS[o.kind].r + SAND.catR + 0.02 && OBS[o.kind].role === 'hit');
      // 지금 떼면 0.4초 뒤 자리 (드리프트로 더 미끄러지는 만큼, 굽이면 길이 옆으로 가는 만큼) — 그때의 길 가운데 기준
      const pred = coast(s, 0.4) - center(s.course, s.d + s.v * 0.4);
      updateSandboard(s, { mx: Math.abs(lane - pred) < 0.04 ? 0 : Math.sign(lane - pred), jump: near && s.air <= 0 }, DT);
      scrapes += s.events.filter((e) => e.type === 'scrape').length;
      t += DT;
    }
    return { s, t, scrapes };
  };
  const a = drive(7);
  const fin = a.s.events.find((e) => e.type === 'finish');
  assert.ok(a.s.phase === 'done' && fin && !a.s.fell, '끝까지 가면 완주');
  assert.ok(a.s.coins > 0, `냥코인을 줍는다 (${a.s.coins})`);
  console.log(`  샌드보드 ${SAND.length}m (커브 두세 번): ${a.t.toFixed(1)}초 · 냥코인 ${a.s.coins} · 부딪힘 ${a.s.crashes} · 울타리 쓸림 ${a.scrapes} · 점수 ${a.s.score}`);
  if (a.s.crashes === 0) assert.equal(a.s.score, a.s.coins + SAND.cleanBonus, '무사 완주 보너스');
  else assert.equal(a.s.score, a.s.coins);
  // 결승 뒤: 조작은 안 먹고(점프 · 좌우 없음) 그 속도로 미끄러지다 서서히 선다, 반짝임 · 골인 글자. 카드는 cardDelay 초 뒤 (그리기)
  assert.ok(a.s.fx.some((f) => f.id === 'pickup_sparkle') && a.s.pops.some((p) => p.text === '골인!'), '골인: 결승선에 반짝임');
  const d0 = a.s.d;
  const v0 = a.s.v;
  let ev = 0;
  for (let k = 0; k < 4 / DT; k++) {
    updateSandboard(a.s, { mx: 1, jump: true }, DT);
    ev += a.s.events.length;
  }
  const glide = a.s.d - d0;
  console.log(`  결승 뒤: ${v0.toFixed(1)} m/s 로 넘어 ${glide.toFixed(1)}m 미끄러지다 선다`);
  assert.ok(ev === 0 && a.s.v === 0 && glide > 10 && glide < 30 && a.s.air <= 0, `끝난 뒤엔 조작 없이 미끄러지다 선다 (${glide.toFixed(1)}m)`);
  const d1 = a.s.d;
  updateSandboard(a.s, { mx: 1, jump: true }, DT);
  assert.ok(a.s.d === d1 && a.s.events.length === 0 && a.s.doneT > SAND.cardDelay, '선 뒤엔 그대로');

  let wins = 0;
  for (let seed = 1; seed <= 10; seed++) if (!drive(seed).s.fell) wins++;
  assert.ok(wins >= 9, `피하고 점프하면 거의 늘 완주한다 (${wins}/10)`);
}

console.log('sandboard.check: ok');
