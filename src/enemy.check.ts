// node src/enemy.check.ts  (npm run check)
import assert from 'node:assert/strict';
import type { Grid } from './collide.ts';
import { aimAt, assignSides, damageEnemy, enemyFrame, makeEnemy, punchTargets, separate, updateEnemy, type World } from './enemy.ts';

const grid: Grid = { w: 9, h: 9, solid: new Array(81).fill(false) };
const sheet = null as never; // 로직만 본다 — 그리기는 안 한다

function world(px: number, pz: number) {
  const log = { hits: 0, arrows: 0, damage: 0 };
  const w: World = {
    px,
    pz,
    grid,
    hitPlayer: (d) => {
      log.hits++;
      log.damage += d;
    },
    spawnArrow: () => log.arrows++,
  };
  return { w, log };
}

const tick = (e: Parameters<typeof updateEnemy>[0], w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / 0.016); i++) updateEnemy(e, 0.016, w);
};

// 멀리 있으면 플레이어 쪽으로 다가온다
{
  const { w } = world(4, 4);
  const e = makeEnemy('sword', sheet, 12, 4);
  const before = Math.hypot(e.x - w.px, e.z - w.pz);
  tick(e, w, 0.5);
  const after = Math.hypot(e.x - w.px, e.z - w.pz);
  assert.ok(after < before - 1, `접근해야 한다: ${before} -> ${after}`);
  assert.equal(e.state, 'chase');
}

// 사거리 안이면 예고(windup) 를 거친 뒤에야 때린다
{
  const { w, log } = world(4, 4);
  const e = makeEnemy('sword', sheet, 4.8, 4);
  tick(e, w, 0.2); // windup(0.45s) 중간
  assert.equal(e.state, 'windup');
  assert.equal(log.hits, 0, '예고 중에는 맞지 않는다');
  tick(e, w, 0.4);
  assert.equal(log.hits, 1, '예고가 끝나면 한 번 때린다');
  assert.equal(log.damage, 12);
  assert.equal(e.state, 'recover');
}

// 쿨다운 동안에는 다시 때리지 않는다
{
  const { w, log } = world(4, 4);
  const e = makeEnemy('sword', sheet, 4.8, 4);
  tick(e, w, 1.0);
  const first = log.hits;
  tick(e, w, 0.5); // 쿨다운 1.1s 안
  assert.equal(log.hits, first, '쿨다운 중에는 추가 타격 없음');
}

// 활 쥐는 붙지 않고 화살을 쏜다
{
  const { w, log } = world(4, 4);
  const e = makeEnemy('bow', sheet, 10, 4);
  tick(e, w, 2.0);
  assert.ok(log.arrows > 0, '화살을 쏴야 한다');
  assert.equal(log.hits, 0, '원거리는 직접 때리지 않는다');
  assert.ok(Math.hypot(e.x - w.px, e.z - w.pz) > 3, '적정 거리를 유지한다');
}

// 피격 → 넉백, 체력 0 → 쓰러짐
{
  const { w } = world(4, 4);
  const e = makeEnemy('sword', sheet, 6, 4);
  damageEnemy(e, 10, 4, 4);
  assert.equal(e.state, 'hurt');
  assert.equal(e.hp, 20);
  const x0 = e.x;
  updateEnemy(e, 0.016, w);
  assert.ok(e.x > x0, '플레이어 반대쪽으로 밀려난다');
  damageEnemy(e, 100, 4, 4);
  assert.equal(e.state, 'pop');
  tick(e, w, 1.0);
  assert.equal(e.state, 'pop', '쓰러진 뒤에는 다시 움직이지 않는다');
}

console.log('enemy.check: ok');

// 냥펀치 판정: 앞쪽만 맞고 뒤쪽·사거리 밖은 안 맞는다
{
  const list = [
    makeEnemy('sword', sheet, 5.2, 4), // 바로 앞
    makeEnemy('bow', sheet, 2.8, 4), // 등 뒤
    makeEnemy('fat', sheet, 9, 4), // 멀리
  ];
  const hit = punchTargets(list, 4, 4, 1, 0, 1.5, Math.PI * 0.7);
  assert.equal(hit.length, 1, '앞쪽 한 마리만 맞는다');
  assert.equal(hit[0].kind, 'sword');
}

// 자동 조준: 멈춰서 때려도 가장 가까운 적을 향한다
{
  const list = [makeEnemy('sword', sheet, 4, 6), makeEnemy('fat', sheet, 4, 9)];
  const aim = aimAt(list, 4, 4, 3);
  assert.ok(aim, '사거리 안 적을 찾아야 한다');
  assert.ok(Math.abs(aim!.z - 1) < 1e-6 && Math.abs(aim!.x) < 1e-6, '가까운 쪽 방향');
  // 그 방향으로 때리면 실제로 맞는다
  assert.equal(punchTargets(list, 4, 4, aim!.x, aim!.z, 2.5, Math.PI * 0.7).length, 1);
  assert.equal(aimAt(list, 4, 4, 1), null, '사거리 밖이면 없음');
}

console.log('punch.check: ok');

// 공격 모션: 예고 중엔 준비 3칸만, 타격 3칸은 딱 한 번, 쿨다운 동안엔 대기 자세
{
  const e = makeEnemy('fat', sheet, 6, 4);
  e.state = 'windup';
  const cols = (t: number) => ((e.t = t), enemyFrame(e, 6));
  assert.deepEqual(cols(0), { row: 2, col: 0 });
  assert.deepEqual(cols(e.def.windup * 0.5), { row: 2, col: 1 });
  assert.deepEqual(cols(e.def.windup * 0.99), { row: 2, col: 2 });
  e.state = 'recover';
  assert.deepEqual(cols(0), { row: 2, col: 3 }, '타격 시작');
  assert.deepEqual(cols(0.23), { row: 2, col: 5 }, '타격 끝');
  assert.equal(cols(0.5).row, 0, '쿨다운엔 공격 모션을 반복하지 않는다');
  assert.equal(cols(1.5).row, 0);
}

// 바라보는 방향은 화면 좌우 기준 — 월드 x 가 같아도 z 차이로 화면 좌우가 갈린다
{
  const { w } = world(4, 8); // 플레이어가 월드 z 로만 떨어져 있다 → 화면에선 왼쪽 아래
  const e = makeEnemy('sword', sheet, 4, 2);
  updateEnemy(e, 0.016, w);
  assert.equal(e.flip, -1, '화면 왼쪽에 있는 플레이어를 봐야 한다');
}

console.log('attack-anim.check: ok');

// 근접 쥐는 고양이 위·아래가 아니라 화면 옆자리로 붙어서 때린다 (몸을 가리지 않게)
{
  const { w, log } = world(8, 8);
  const e = makeEnemy('fat', sheet, 11, 11); // 화면상 고양이 바로 아래에서 출발
  tick(e, w, 4);
  const h = (w.px - e.x - (w.pz - e.z)) * Math.SQRT1_2; // 화면 가로 거리
  const v = (w.px - e.x + (w.pz - e.z)) * Math.SQRT1_2; // 화면 세로 거리
  assert.ok(log.hits > 0, '옆자리에 붙은 뒤 때려야 한다');
  assert.ok(Math.abs(v) < 0.7, `세로로 겹치면 안 된다: ${v.toFixed(2)}`);
  assert.ok(Math.abs(h) > 1.2, `옆으로 떨어져 서야 한다: ${h.toFixed(2)}`);
}

// 몸끼리 겹치면 비켜선다: 고양이는 그대로, 쥐만 밀린다
{
  const a = makeEnemy('sword', sheet, 4.3, 4);
  const b = makeEnemy('fat', sheet, 4.4, 4.1);
  separate([a, b], 4, 4, grid);
  assert.ok(Math.hypot(a.x - 4, a.z - 4) >= 0.999, '고양이와 1m 이상');
  assert.ok(Math.hypot(b.x - 4, b.z - 4) >= 0.999);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 1.0, '쥐끼리도 떨어진다');
}

console.log('spacing.check: ok');

// 근접 쥐 둘이 같은 쪽에서 오면 한 마리는 반대편 옆자리로 간다
{
  const near = makeEnemy('sword', sheet, 6, 3); // 둘 다 고양이의 화면 오른쪽
  const far = makeEnemy('fat', sheet, 8, 2);
  const bow = makeEnemy('bow', sheet, 7, 1);
  assignSides([far, bow, near], 4, 4);
  assert.equal(near.side, 1, '가까운 쥐가 자기 쪽을 잡는다');
  assert.equal(far.side, -1, '다음 쥐는 비어 있는 반대쪽');
  assert.equal(bow.side, 0, '원거리 쥐는 자리를 안 받는다');
}

console.log('sides.check: ok');
