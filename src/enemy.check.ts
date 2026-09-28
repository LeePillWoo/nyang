// node src/enemy.check.ts  (npm run check)
import assert from 'node:assert/strict';
import type { Grid } from './collide.ts';
import { damageEnemy, makeEnemy, updateEnemy, type World } from './enemy.ts';

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
