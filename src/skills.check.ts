// node src/skills.check.ts  (npm run check) — 웨이브 · 생선뼈(경험치) · 레벨 업 카드 · 기술 16가지가 제 일을 하는지,
// 그리고 대충 하는 자동 플레이어로 방 13개를 돌려 웨이브 수·몬스터 수가 알맞은지(시간·낮잠·레벨)를 본다
import assert from 'node:assert/strict';
import { makeBag } from './bag.ts';
import { hitPlayer, makeDungeon, maxHp, pick, PLAYER, strike, updateDungeon, WAVES, waveKinds, type Dungeon } from './dungeon.ts';
import { ENEMY_DEFS, makeEnemy, type Enemy } from './enemy.ts';
import { room, ROOMS } from './iso.ts';
import { gainXp, learn, MAX_LV, need, rollCards, SKILL_IDS, SKILLS, XP, type SkillId } from './skills.ts';

const sheets = {} as never;
const DT = 1 / 60;
const still = { mx: 0, my: 0, punch: false, dash: false };
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const run = (d: Dungeon, secs: number, input = still) => {
  for (let i = 0; i < Math.round(secs / DT); i++) updateDungeon(d, input, DT);
};

// 1) 경험치: 레벨 L → L+1 에 first + grow×(L−1). 한꺼번에 여러 레벨도
{
  assert.deepEqual([1, 2, 3, 4].map(need), [XP.first, XP.first + XP.grow, XP.first + 2 * XP.grow, XP.first + 3 * XP.grow]);
  const d = makeDungeon(sheets, 'alley');
  assert.equal(gainXp(d.run, need(1) - 1), 0);
  assert.equal(gainXp(d.run, 1 + need(2)), 2, '두 레벨');
  assert.equal(d.run.level, 3);
  assert.equal(d.run.pending, 2);
}

// 2) 카드: 3장은 서로 다르고, 다 배운(최대) 기술은 안 나온다. 가진 기술이 더 잘 나온다. 다 배웠으면 간식
{
  const d = makeDungeon(sheets, 'alley');
  const rng = seeded(1);
  for (let i = 0; i < 50; i++) {
    const c = rollCards(d.run, rng);
    assert.equal(new Set(c.map((x) => x.id)).size, 3);
  }
  for (let i = 0; i < MAX_LV; i++) learn(d.run, 'yarn_ball');
  learn(d.run, 'spool');
  let spool = 0;
  let other = 0;
  for (let i = 0; i < 2000; i++)
    for (const c of rollCards(d.run, rng)) {
      assert.notEqual(c.id, 'yarn_ball', '최대 레벨은 안 나온다');
      if (c.id === 'spool') {
        spool++;
        assert.equal(c.lv, 2, '가진 기술은 다음 레벨로');
      } else if (c.id === 'hairball') other++;
    }
  assert.ok(spool > other * 1.8, `가진 기술이 더 잘 나온다 (${spool} vs ${other})`);
  for (const id of SKILL_IDS) d.run.skills[id] = MAX_LV;
  assert.deepEqual(rollCards(d.run, rng), [{ id: 'heal', lv: 0 }]);
  // 모든 기술: 레벨 5개 · 이름 · 그림
  for (const id of SKILL_IDS) assert.ok(SKILLS[id].levels.length === MAX_LV && SKILLS[id].name && SKILLS[id].anim, id);
}

/** 기술만 보는 무대: 장비 없이, 웨이브 없이, 몬스터는 (종류, 고양이 기준 x, z) 에 체력 999 */
function arena(skills: Partial<Record<SkillId, number>>, mons: [string, number, number][]) {
  const d = makeDungeon(sheets, 'alley', { ...makeBag(), equip: {} }, { auto: false }); // 기술 피해만 재게 자동 냥펀치는 끈다
  d.wave = null;
  d.enemies = mons.map(([k, dx, dz]) => Object.assign(makeEnemy(k, sheets, d.P.x + dx, d.P.z + dz), { hp: 999 }));
  for (const [id, n] of Object.entries(skills) as [SkillId, number][]) for (let i = 0; i < n; i++) learn(d.run, id);
  return d;
}
const lost = (e: Enemy) => 999 - e.hp;

// 3) 생선뼈 → 레벨 업 → 카드가 뜨면 멈춘다 → 고르면 배우고 다시 움직인다
{
  const d = makeDungeon(sheets, 'alley');
  d.wave = null;
  const rat = makeEnemy('fat', sheets, d.P.x + 1, d.P.z);
  d.enemies = [rat, makeEnemy('sword', sheets, d.P.x + 6, d.P.z + 6)];
  strike(d, rat, 999, d.P.x, d.P.z);
  assert.equal(d.bones.length, Math.round(ENEMY_DEFS.fat.hp / XP.perHp), '체력만큼 생선뼈');
  const n0 = d.bones.length;
  run(d, 1);
  assert.ok(d.bones.length < n0, '가까운 생선뼈는 빨려 와 먹는다');
  assert.ok(d.run.level >= 2 && d.choose && d.choose.length === 3, '레벨 업 → 카드 3장 (남은 뼈는 고를 때까지 멈춰 있다)');
  const far = d.enemies.find((e) => e.kind === 'sword')!;
  const x0 = far.x;
  run(d, 1);
  assert.equal(far.x, x0, '카드를 고르는 동안은 멈춘다');
  const id = d.choose![0].id as SkillId;
  assert.ok(pick(d, 0) && d.run.skills[id] === 1 && !d.choose, '고르면 배운다');
  run(d, 0.5);
  assert.notEqual(far.x, x0, '다시 움직인다');
  assert.equal(d.bones.length, 0, '남은 생선뼈도 먹었다');
}

// 4) 기술마다 제 일을 하는지
const one = (id: SkillId, lvl: number, mons: [string, number, number][], secs: number, input = still) => {
  const d = arena({ [id]: lvl }, mons);
  run(d, secs, input);
  return d;
};
{
  let d = one('yarn_ball', 1, [['sword', 4, 0]], 1.0);
  assert.equal(lost(d.enemies[0]), 9, '털뭉치: 가까운 적에게 9');
  d = one('yarn_ball', 5, [['sword', 4, 0], ['fat', 5, 1]], 0.9);
  assert.ok(lost(d.enemies[1]) > 0, '털뭉치 5: 튕겨서 옆 적도');
  d = one('spool', 1, [['fat', 2.5, 0]], 1.6);
  assert.equal(lost(d.enemies[0]), 24, '실타래: 갈 때 한 번,올 때 한 번');
  d = one('hairball', 1, [['fat', 5, 0], ['fat', 5.6, 0.5], ['sword', 5.2, -0.6]], 1.2);
  assert.ok(d.enemies.every((e) => lost(e) >= 14), '헤어볼: 모인 적 셋 다');
  d = one('snare', 1, [['fat', 3, 0]], 0.35); // 새로 배운 기술은 0.3초 뒤 처음 발동
  const sx = d.enemies[0].x;
  assert.ok(d.enemies[0].rootT > 1, '올가미: 묶인다');
  run(d, 1);
  assert.ok(Math.abs(d.enemies[0].x - sx) < 0.3, '묶이면 못 다가온다');
  d = one('catnip_cloud', 1, [['fat', 1.2, 0]], 1);
  assert.ok(d.enemies[0].slowT > 0 && d.enemies[0].slowK === 0.7 && lost(d.enemies[0]) >= 5, `캣닢 구름: 느려지고 초당 6 (${lost(d.enemies[0])})`);
  d = arena({ zoom: 2 }, [['fat', 2, 0]]);
  d.P.faceX = 1;
  d.P.faceZ = 0;
  run(d, 0.3, { ...still, dash: true });
  assert.ok(d.run.ents.filter((e) => e.k === 'flame').length >= 4, '우다다: 구른 자리에 불꽃');
  run(d, 1);
  assert.ok(lost(d.enemies[0]) > 0, '불꽃에 닿은 적이 아프다');
  assert.ok(Math.abs(d.P.dashCd) < 1e-9 || d.P.dashCd < PLAYER.dash.time + PLAYER.dash.cooldown, '구르기 쿨다운이 줄었다');
  d = one('tail_swirl', 1, [['fat', 1.5, 0], ['sword', -1, 1]], 0.4);
  assert.ok(d.enemies.every((e) => lost(e) === 12) && Math.hypot(d.enemies[0].x - d.P.x, d.enemies[0].z - d.P.z) > 1.8, '꼬리 회오리: 둘레를 치고 밀쳐낸다');
}
{
  // 냥냥 펀치: 냥펀치 +3, 3번째마다 충격파 (펀치가 안 닿는 등 뒤 적도)
  const d = arena({ paw_combo: 1 }, [['fat', 1, 0], ['sword', -1.4, 0]]);
  d.P.faceX = 1;
  d.P.faceZ = 0;
  for (let i = 0; i < 3; i++) {
    run(d, 0.016, { ...still, punch: true });
    run(d, 0.6);
  }
  assert.equal(lost(d.enemies[0]), 3 * (PLAYER.punch.damage + 3) + 12, '냥펀치 13 × 3 + 충격파 12');
  assert.equal(lost(d.enemies[1]), 12, '등 뒤 적은 충격파만');
}
{
  let d = one('box_orbit', 1, [['fat', 1.7, 0]], 2.5);
  assert.ok(lost(d.enemies[0]) >= 8, '빙글 상자: 둘레에서 부딪힌다');
  d = one('box_drop', 1, [['fat', 4, 0]], 1.1); // 0.3초 뒤 그림자 → 0.75초 뒤 쿵
  assert.ok(lost(d.enemies[0]) === 20 && d.enemies[0].stunT > 0.5, '상자 낙하: 20 + 기절');
  const sx = d.enemies[0].x;
  run(d, 0.5);
  assert.ok(Math.abs(d.enemies[0].x - sx) < 0.2, '기절하면 못 움직인다');
}
{
  // 식빵 보호막: 한 대를 막고, cd 뒤에 다시 찬다
  const d = arena({ loaf_shield: 1 }, []);
  assert.equal(d.run.shield, 1, '처음엔 차 있다');
  hitPlayer(d, 20, d.P.x + 1, d.P.z);
  assert.ok(d.P.hp === maxHp(d) && d.run.shield === 0, '막았다');
  d.P.invT = 0;
  hitPlayer(d, 20, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, maxHp(d) - 20, '두 번째는 아프다');
  run(d, 9.1);
  assert.equal(d.run.shield, 1, '9초 뒤 다시 찬다');
}
{
  // 하악: 맞으면 둘레를 밀쳐내고, 3마리에 둘러싸여도
  let d = arena({ hiss: 1 }, [['fat', 1.2, 0]]);
  hitPlayer(d, 10, d.P.x + 1, d.P.z);
  assert.ok(lost(d.enemies[0]) === 10 && d.enemies[0].kx > 3, '맞으면 하악');
  d = arena({ hiss: 1 }, [['fat', 1.2, 0], ['sword', -1.2, 0], ['bow', 0, 1.3]]);
  run(d, 0.05);
  assert.ok(d.enemies.every((e) => lost(e) === 10), '둘러싸이면 하악');
}
{
  let d = one('red_dot', 1, [['fat', 4, 0]], 2);
  assert.ok(lost(d.enemies[0]) >= 8, `빨간 점: 쫓아가 지진다 (${lost(d.enemies[0])})`);
  d = arena({ pounce: 1 }, [['sword', 3, 0], ['fat', -3, 0]]);
  d.enemies[1].hp = 1500; // 가장 튼튼한 적
  run(d, 1.0); // 0.3초 뒤 찍고 0.6초 뒤 치명타
  assert.ok(d.enemies[1].hp === 1500 - 30 && lost(d.enemies[0]) === 0, '사냥 덮치기: 가장 튼튼한 적에게 치명타 30');
  assert.ok(d.pops.some((q) => q.style === 'crit'), '치명타 숫자');
  d = arena({ claw: 3 }, [['fat', PLAYER.punch.range + 0.2, 0]]);
  d.P.faceX = 1;
  d.P.faceZ = 0;
  run(d, 0.2, { ...still, punch: true });
  assert.equal(lost(d.enemies[0]), PLAYER.punch.damage, '발톱 3: 냥펀치가 더 멀리 닿는다');
  run(d, 2);
  assert.ok(lost(d.enemies[0]) >= PLAYER.punch.damage + 15, `발톱: 맞은 뒤 따끔따끔 (${lost(d.enemies[0])})`);
  d = one('wind_mouse', 1, [['fat', 5, 0]], 2);
  assert.ok(lost(d.enemies[0]) === 22, `태엽 쥐: 달려가 펑 (${lost(d.enemies[0])})`);
}

// 5) 웨이브: 웨이브 1 = 방 몬스터 + 가장자리에서 더 → 다 쓰러뜨리면 쉬고 웨이브 2 → … (4번째에 정예 하나, 마지막에 둘) → 방 클리어 → 결과창
{
  const d = makeDungeon(sheets, 'alley');
  const W = d.wave!;
  assert.equal(d.enemies.length + W.queue.length, WAVES.counts[0], '웨이브 1 수');
  let seen = d.enemies.length;
  let maxAlive = 0;
  const clearAll = () => {
    for (const e of d.enemies) strike(d, e, 9999, e.x, e.z);
  };
  const waves: number[] = [];
  let elite: Enemy | null = null;
  const elitesAt: number[] = [];
  for (let t = 0; t < 240 && d.phase === 'playing'; t += DT) {
    const before = d.enemies.length;
    d.P.invT = 1; // 웨이브 흐름만 본다 — 고양이는 안 맞는다
    updateDungeon(d, still, DT);
    d.choose = null;
    d.run.pending = 0;
    for (const e of d.enemies.slice(before)) {
      seen++;
      assert.ok(Math.hypot(e.x - d.P.x, e.z - d.P.z) >= WAVES.minDist - 0.6, '고양이 가까이에선 안 나온다');
      if (e.elite) {
        elite = e;
        elitesAt.push(W.i);
      }
    }
    maxAlive = Math.max(maxAlive, d.enemies.filter((e) => e.state !== 'pop').length + W.marks.length);
    for (const ev of d.events) if (ev.type === 'wave' && !ev.clear) waves.push(ev.i);
    // 더 나올 수 없으면(다 나왔거나 한꺼번에 maxAlive) 쓰러뜨린다
    const alive = d.enemies.filter((e) => e.state !== 'pop').length;
    if (W.state === 'fight' && !W.marks.length && (!W.queue.length || alive >= WAVES.maxAlive)) clearAll();
  }
  assert.equal(d.phase, 'cleared', '마지막 웨이브를 깨면 방 클리어');
  assert.deepEqual(waves, WAVES.counts.slice(1).map((_, i) => i + 1), '웨이브 2 부터 안내');
  const nElites = WAVES.elites.reduce((a, b) => a + b, 0);
  assert.equal(seen, WAVES.counts.reduce((a, b) => a + b) + nElites, `몬스터 수 (정예 ${nElites} 포함) ${seen}`);
  assert.deepEqual(elitesAt, WAVES.elites.flatMap((n, i) => Array(n).fill(i)), `정예가 나오는 웨이브 ${elitesAt.map((i) => i + 1).join(',')}`);
  assert.ok(maxAlive <= WAVES.maxAlive, `한꺼번에 ${maxAlive} ≤ ${WAVES.maxAlive}`);
  const lastK = WAVES.hp[WAVES.counts.length - 1];
  assert.ok(elite && elite.def.hp === Math.round(Math.round(ENEMY_DEFS[elite.kind].hp * lastK) * WAVES.elite.hp), '정예는 그 웨이브 배율 × 정예 배율');
  // 결과창: 떨어진 게 다 날아온 뒤 뜨고, 뜨면 멈춘다. 기록은 쓰러뜨린 수 · 정예
  for (let t = 0; t < 4 && !d.result; t += DT) {
    updateDungeon(d, still, DT);
    if (d.choose) pick(d, 0);
  }
  assert.ok(d.result?.win && d.loot.length === 0 && d.bones.length === 0, '모든 웨이브를 깨면 결과창 (떨어진 게 다 날아온 뒤)');
  assert.equal(d.stats.kills, seen, `결과: 쓰러뜨린 수 ${d.stats.kills}`);
  assert.equal(d.stats.elites, nElites, '결과: 정예');
  assert.ok(d.stats.dealt > 0 && d.stats.t > 10, '결과: 준 피해 · 시간');
  const x0 = d.P.x;
  updateDungeon(d, { ...still, mx: 1 }, 0.5);
  assert.equal(d.P.x, x0, '결과창이 떠 있으면 멈춘다');
  // 원거리 비율 · 정예는 근접 중 가장 튼튼한 종, 웨이브 중간쯤 (둘이면 35% · 75%)
  for (const id of Object.keys(ROOMS)) {
    const ks = waveKinds(room(id), 14, 2, seeded(3));
    const nr = ks.filter((k) => !k.elite && ENEMY_DEFS[k.kind].arrowSpeed > 0).length;
    assert.ok(nr <= Math.floor(14 * WAVES.rangedMax), `${id}: 원거리 ${nr}`);
    const el = ks.map((k, i) => (k.elite ? i : -1)).filter((i) => i >= 0);
    assert.ok(el.length === 2 && el.every((i) => ENEMY_DEFS[ks[i].kind].arrowSpeed === 0 && i > 2 && i < ks.length - 2), `${id}: 정예 둘 · 근접 · 웨이브 중간 (${el})`);
  }
}

// 5-1) 결과창 기록: 주운 냥코인 · 아이템 · 받은 피해. 낮잠이면 1.2초 뒤 결과창(진 판)
{
  const d = makeDungeon(sheets, 'alley', { ...makeBag(), equip: {} });
  d.wave = null; // 웨이브 없이 기록만
  d.loot.push({ id: 'coin', n: 9, x: d.P.x, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 }, { id: 'materials_05', n: 2, x: d.P.x, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 });
  run(d, 0.2);
  assert.ok(d.stats.coins === 9 && d.stats.items.materials_05 === 2, `줍기 기록 (냥코인 ${d.stats.coins})`);
  d.enemies = [];
  hitPlayer(d, 15, d.P.x + 1, d.P.z);
  assert.equal(d.stats.taken, 15, '받은 피해');
  for (let i = 0; i < 9; i++) {
    d.P.invT = 0;
    hitPlayer(d, 999, d.P.x + 1, d.P.z);
  }
  assert.equal(d.phase, 'napped');
  run(d, 1);
  assert.equal(d.result, null, '낮잠 바로는 아직');
  run(d, 0.4);
  assert.ok(d.result && !d.result.win, '낮잠 1.2초 뒤 결과창 (진 판)');
}

// 6) 밸런스: 대충 하는 자동 플레이어 (가까운 적을 때리고, 붙으면 물러나고, 아프면 구르고, 카드는 아무거나)로 방 13개 × 3판.
//    너무 쉽거나(1분 40초 안) 너무 길거나(6분 40초 넘게) 너무 자주 낮잠이면 웨이브 수·몬스터 수·배율을 다시 본다
{
  const bot = (id: string, seed: number) => {
    const rng = seeded(seed);
    const saved = Math.random;
    Math.random = rng;
    const d = makeDungeon(sheets, id);
    let t = 0;
    let picks = 0;
    for (; t < 600 && d.phase === 'playing'; t += DT) {
      if (d.choose) {
        pick(d, Math.floor(rng() * d.choose.length));
        picks++;
      }
      const P = d.P;
      const foes = d.enemies.filter((e) => e.state !== 'pop');
      let mx = 0;
      let mz = 0;
      let punch = false;
      let dash = false;
      const near = foes.sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
      if (near) {
        const dx = near.x - P.x;
        const dz = near.z - P.z;
        const dd = Math.hypot(dx, dz);
        const crowd = foes.filter((e) => Math.hypot(e.x - P.x, e.z - P.z) < 1.6).length;
        if (crowd >= 3 || (dd < 1.0 && near.state === 'windup')) {
          mx = -dx;
          mz = -dz;
          dash = P.hp < maxHp(d) * 0.5 && rng() < 0.05;
        } else if (dd > 1.8) {
          mx = dx;
          mz = dz;
        }
        punch = dd < PLAYER.punch.range + 0.2;
      } else if (d.bones.length) {
        mx = d.bones[0].x - P.x;
        mz = d.bones[0].z - P.z;
      }
      // 월드 방향 → 화면 입력 (아이소메트릭 45도 되돌리기)
      const len = Math.hypot(mx, mz) || 1;
      const sx = ((mx - mz) / len) * Math.SQRT1_2;
      const sy = ((mx + mz) / len) * Math.SQRT1_2;
      updateDungeon(d, { mx: mx || mz ? sx : 0, my: mx || mz ? sy : 0, punch, dash }, DT);
    }
    Math.random = saved;
    return { t, napped: d.phase === 'napped', lives: d.P.lives, level: d.run.level, picks, wave: d.wave!.i + 1 };
  };
  console.log('  웨이브 자동 플레이 (방 · 판 2번: 걸린 초 / 남은 목숨 / 레벨):');
  let naps = 0;
  let games = 0;
  const times: number[] = [];
  for (const id of Object.keys(ROOMS)) {
    const rs = [1, 2].map((s) => bot(id, s * 7 + id.length));
    naps += rs.filter((r) => r.napped).length;
    games += rs.length;
    for (const r of rs) if (!r.napped) times.push(r.t);
    console.log(`    ${ROOMS[id].name.padEnd(14)} ${rs.map((r) => (r.napped ? `낮잠(웨이브 ${r.wave})` : `${r.t.toFixed(0)}초/${r.lives}/Lv${r.level}`)).join('  ')}`);
  }
  const avg = times.reduce((a, b) => a + b, 0) / Math.max(1, times.length);
  console.log(`    평균 ${avg.toFixed(0)}초 · 낮잠 ${naps}/${games}`);
  assert.ok(avg > 100 && avg < 400, `한 방 평균 ${avg.toFixed(0)}초`);
  assert.ok(naps <= games * 0.35, `낮잠 ${naps}/${games}`);
}

console.log('skills.check: ok');
