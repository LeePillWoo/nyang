// node src/dungeon.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { CELL } from './collide.ts';
import { hitPlayer, makeDungeon, PLAYER, updateDungeon, type Dungeon, type DungeonEvent } from './dungeon.ts';
import { makeEnemy } from './enemy.ts';
import { exits } from './iso.ts';

const sheets = {} as never; // 로직만 본다 — 그리기는 안 한다
const still = { mx: 0, my: 0, punch: false, dash: false };

/** seconds 동안 진행하며 나온 사건을 모은다. 첫 프레임에만 input 을 준다 */
function run(d: Dungeon, input: typeof still, seconds: number) {
  const events: DungeonEvent[] = [];
  let out: string | null = null;
  for (let i = 0; i < Math.round(seconds / 0.016); i++) {
    out = updateDungeon(d, i === 0 ? input : still, 0.016) ?? out;
    events.push(...d.events);
  }
  return { events, out };
}

// 방에 들어오면 rooms.json 의 spawns 대로 쥐가 선다
{
  const d = makeDungeon(sheets);
  assert.deepEqual(d.enemies.map((e) => e.kind), ['sword', 'bow', 'fat']);
  assert.equal(d.P.hp, PLAYER.maxHp);
  assert.equal(d.phase, 'playing');
}

// 맞으면 체력이 깎이고 무적 시간 동안은 다시 안 맞는다
{
  const d = makeDungeon(sheets);
  hitPlayer(d, 12, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp - 12);
  assert.equal(d.P.invT, PLAYER.hitIframe);
  assert.ok(d.P.kx < 0, '맞은 반대쪽으로 밀린다');
  assert.deepEqual(d.events, [{ type: 'hurt' }]);
  assert.ok(d.shake > 0, '12 이상은 화면이 흔들린다');
  hitPlayer(d, 12, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp - 12, '무적 중에는 무시');

  const e = makeDungeon(sheets);
  hitPlayer(e, 8, e.P.x + 1, e.P.z);
  assert.equal(e.shake, 0, '약한 피격은 흔들지 않는다');
}

// 구르기 중에는 무적
{
  const d = makeDungeon(sheets);
  d.enemies = [];
  run(d, { ...still, dash: true }, 0.016);
  assert.ok(d.P.dashT > 0);
  hitPlayer(d, 30, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp);
}

// 체력이 다 떨어지면 목숨 하나로 반피 부활, 마지막 목숨이면 낮잠
{
  const d = makeDungeon(sheets);
  hitPlayer(d, PLAYER.maxHp, d.P.x + 1, d.P.z);
  assert.equal(d.P.lives, PLAYER.startLives - 1);
  assert.equal(d.P.hp, PLAYER.maxHp * PLAYER.reviveHp);
  assert.equal(d.P.invT, PLAYER.reviveIframe);
  for (let i = 1; i < PLAYER.startLives; i++) {
    d.P.invT = 0;
    hitPlayer(d, PLAYER.maxHp, d.P.x + 1, d.P.z);
  }
  assert.equal(d.P.lives, 0);
  assert.equal(d.phase, 'napped');
  hitPlayer(d, 10, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, 0, '낮잠 중에는 더 안 맞는다');
}

// 냥펀치: 판정 시점(hitAt)에 앞의 쥐를 때린다. 마지막 일격이면 뿅 + 흔들기
{
  const d = makeDungeon(sheets);
  const rat = makeEnemy('sword', sheets, d.P.x, d.P.z + 1);
  d.enemies = [rat];
  run(d, { ...still, punch: true }, PLAYER.punch.hitAt - 0.03);
  assert.equal(rat.hp, rat.def.hp, '판정 전에는 안 맞는다');
  const hit = run(d, still, 0.05);
  assert.equal(rat.hp, rat.def.hp - PLAYER.punch.damage);
  assert.deepEqual(hit.events, [{ type: 'hit', finish: false }]);
  assert.equal(d.pops.length, 1);
  assert.equal(d.shake, 0, '보통 타격은 흔들지 않는다');

  run(d, still, 0.4); // 펀치가 끝나고 쥐가 경직에서 풀릴 때까지
  rat.hp = PLAYER.punch.damage;
  const fin = run(d, { ...still, punch: true }, 0.15);
  assert.equal(rat.state, 'pop');
  assert.deepEqual(fin.events, [{ type: 'pop' }, { type: 'hit', finish: true }]);
  assert.ok(d.shake > 0);
  run(d, still, 0.7);
  assert.equal(d.enemies.length, 0, '뿅 연출이 끝나면 목록에서 빠진다');
  assert.equal(d.phase, 'cleared');
}

// 노란 매트를 밟으면 'exit'. 낮잠 중에는 안 나간다
{
  const [tx, tz] = exits[0];
  const d = makeDungeon(sheets);
  d.enemies = [];
  Object.assign(d.P, { x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });
  assert.equal(run(d, still, 0.016).out, 'exit');

  d.phase = 'napped';
  assert.equal(run(d, still, 0.016).out, null);
}

console.log('dungeon.check: ok');
