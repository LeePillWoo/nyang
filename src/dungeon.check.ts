// node src/dungeon.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { addItem, makeBag, type Bag } from './bag.ts';
import { CELL } from './collide.ts';
import { EXIT_DWELL, hitPlayer, makeDungeon, maxHp, PLAYER, updateDungeon, type Dungeon, type DungeonEvent } from './dungeon.ts';
import data from './data/field.json' with { type: 'json' };
import { ENEMY_DEFS, makeEnemy } from './enemy.ts';
import { FX } from './fx.ts';
import { SPOTS } from './fishing.ts';
import { room, ROOMS } from './iso.ts';

const sheets = {} as never; // 로직만 본다 — 그리기는 안 한다
const still = { mx: 0, my: 0, punch: false, dash: false };
/** 장비 없는 맨몸 (기본 능력치 그대로 보려고) */
const bare = (): Bag => ({ ...makeBag(), equip: {} });
// 기본 전투 체크는 웨이브·기술 없이 (classic) — 웨이브·기술은 skills.check.ts
const fresh = (bag = bare()) => makeDungeon(sheets, 'alley', bag, { classic: true, auto: false });

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
  const d = fresh();
  assert.deepEqual(d.enemies.map((e) => e.kind), ['sword', 'bow', 'fat']);
  assert.equal(d.P.hp, PLAYER.maxHp);
  assert.equal(d.phase, 'playing');
}

// 맞으면 체력이 깎이고 무적 시간 동안은 다시 안 맞는다
{
  const d = fresh();
  hitPlayer(d, 12, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp - 12);
  assert.equal(d.P.invT, PLAYER.hitIframe);
  assert.ok(d.P.kx < 0, '맞은 반대쪽으로 밀린다');
  assert.deepEqual(d.events, [{ type: 'hurt' }]);
  assert.ok(d.shake > 0, '12 이상은 화면이 흔들린다');
  hitPlayer(d, 12, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp - 12, '무적 중에는 무시');

  const e = fresh();
  hitPlayer(e, 8, e.P.x + 1, e.P.z);
  assert.equal(e.shake, 0, '약한 피격은 흔들지 않는다');
}

// 구르기 중에는 무적
{
  const d = fresh();
  d.enemies = [];
  run(d, { ...still, dash: true }, 0.016);
  assert.ok(d.P.dashT > 0);
  hitPlayer(d, 30, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp);
}

// 체력이 다 떨어지면 목숨 하나로 반피 부활, 마지막 목숨이면 낮잠
{
  const d = fresh();
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
  const d = fresh();
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
  assert.deepEqual(fin.events, [{ type: 'pop', kind: 'sword' }, { type: 'hit', finish: true }]);
  assert.ok(d.shake > 0);
  run(d, still, 0.7);
  assert.equal(d.enemies.length, 0, '뿅 연출이 끝나면 목록에서 빠진다');
  assert.equal(d.phase, 'cleared');
}

// 장비 능력치: 공격은 냥펀치에, 체력은 최대 체력에, 방어는 받는 피해에(최소 1), 이동은 걷는 속도에
{
  const bag = bare();
  bag.equip = { weapon: 'equipment_12', head: 'equipment_16', body: 'equipment_20', tool: 'equipment_33' }; // 공격 8 · 체력 20+10 · 방어 2 · 이동 15%
  const d = fresh(bag);
  assert.equal(d.P.hp, PLAYER.maxHp + 30);
  assert.equal(maxHp(d), PLAYER.maxHp + 30);
  const rat = makeEnemy('fat', sheets, d.P.x, d.P.z + 1);
  d.enemies = [rat];
  run(d, { ...still, punch: true }, 0.15);
  assert.equal(rat.hp, rat.def.hp - PLAYER.punch.damage - 8, '해적 커틀러스 공격 +8');
  hitPlayer(d, 12, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp + 30 - 10, '방어 2');
  d.P.invT = 0;
  hitPlayer(d, 1, d.P.x + 1, d.P.z);
  assert.equal(d.P.hp, PLAYER.maxHp + 30 - 11, '방어가 커도 최소 1');
  const walked = (b: Bag) => {
    const e = fresh(b);
    e.enemies = [];
    const x0 = e.P.x;
    for (let i = 0; i < 30; i++) updateDungeon(e, { ...still, mx: 1 }, 0.016);
    return e.P.x - x0;
  };
  const r = walked(bag) / walked(bare());
  assert.ok(Math.abs(r - 1.15) < 0.02, `물갈퀴 신발 이동 +15%: ${r.toFixed(3)}`);
  delete bag.equip.head;
  run(d, still, 0.016);
  assert.ok(d.P.hp <= maxHp(d), '체력 장비를 벗으면 체력도 줄어든다');
}

// 드롭: 쓰러지면 냥코인(+아이템)이 튀어나오고, 0.45초 뒤 가까우면 빨려 와 가방에. 멀면 그대로, 방을 깨면 다 날아온다
{
  const d = fresh();
  const rat = makeEnemy('fat', sheets, d.P.x, d.P.z + 1);
  const far = makeEnemy('sword', sheets, d.P.x + 6, d.P.z + 6);
  d.enemies = [rat, far];
  rat.hp = 1;
  run(d, { ...still, punch: true }, 0.15);
  const coin = d.loot.find((l) => l.id === 'coin');
  assert.ok(coin && coin.n >= Math.ceil(rat.def.hp / 12), '냥코인이 떨어진다');
  assert.equal(d.bag.coins, 0, '바로 줍지는 않는다');
  const got = run(d, still, 1);
  assert.equal(d.loot.length, 0, '가까운 건 빨려 와 주워진다');
  assert.ok(d.bag.coins >= coin.n && got.events.some((e) => e.type === 'loot'));
  assert.ok(d.toasts.some((q) => q.id === 'coin'), '주운 것 알림');

  d.loot.push({ id: 'materials_05', n: 2, x: d.P.x + 5, z: d.P.z + 5, h: 0, vh: 0, vx: 0, vz: 0, t: 1 });
  run(d, still, 0.5);
  assert.equal(d.loot.length, 1, '멀리 있는 건 그대로');
  d.enemies = [];
  run(d, still, 1.5);
  assert.equal(d.phase, 'cleared');
  assert.equal(d.loot.length, 0, '방을 깨면 남은 게 날아온다');
  assert.equal(d.bag.slots.find((s) => s?.id === 'materials_05')?.n, 2);
}

// 가방이 가득 차면 못 줍고(알림 한 번) 바닥에 남는다. 나가는 칸을 밟으면 남은 것도 챙긴다
{
  const d = fresh();
  d.enemies = [];
  for (let i = 0; i < d.bag.slots.length; i++) addItem(d.bag, 'equipment_02');
  d.loot.push({ id: 'equipment_13', n: 1, x: d.P.x, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 });
  const r = run(d, still, 1);
  assert.equal(d.loot.length, 1, '가득 차면 남는다');
  assert.equal(r.events.filter((e) => e.type === 'full').length, 1, '가득 찼다는 알림은 한 번');
  d.bag.slots[0] = null;
  d.loot.push({ id: 'coin', n: 7, x: 1, z: 1, h: 0, vh: 0, vx: 0, vz: 0, t: 0 });
  const [tx, tz] = d.room.exits[0];
  Object.assign(d.P, { x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });
  assert.equal(run(d, still, EXIT_DWELL + 0.05).out, 'exit');
  assert.equal(d.bag.coins, 7, '나갈 때 남은 냥코인도');
  assert.equal(d.bag.slots[0]?.id, 'equipment_13', '나갈 때 남은 장비도 빈 칸에');
}
// 가방이 가득 차면 떨어진 장비(모자)는 빨려 오지 않고 그 자리에 있다 — 전엔 빨려 오다 못 넣고 그 속도로 고양이를 지나쳐 미끄러져 나갔다.
// 밟으면 가득 알림, 자리가 나면 빨려 와 줍는다
{
  const d = fresh();
  d.enemies = [];
  for (let i = 0; i < d.bag.slots.length; i++) addItem(d.bag, 'equipment_02');
  const hat = { id: 'equipment_18', n: 1, x: d.P.x + 1.2, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 };
  d.loot.push(hat);
  let r = run(d, still, 1);
  assert.ok(Math.abs(hat.x - (d.P.x + 1.2)) < 0.01 && Math.abs(hat.z - d.P.z) < 0.01 && hat.full, '가득 차면 빨려 오지 않고 그 자리에');
  assert.equal(r.events.filter((e) => e.type === 'full').length, 0, '밟기 전엔 알림 없음');
  d.P.x = hat.x;
  r = run(d, still, 1);
  assert.ok(d.loot.length === 1 && Math.hypot(hat.x - d.P.x, hat.z - d.P.z) < 0.3, '밟아도 미끄러져 나가지 않는다');
  assert.equal(r.events.filter((e) => e.type === 'full').length, 1, '밟으면 가득 알림 한 번');
  d.P.x -= 1.5;
  d.bag.slots[3] = null;
  run(d, still, 1);
  assert.ok(d.loot.length === 0 && d.bag.slots[3]?.id === 'equipment_18', '자리가 나면 빨려 와 줍는다');
}

// 자동 냥펀치: 타격 범위 안에 몬스터가 있으면 누르지 않아도 나간다. 범위 밖 · 없음 · 구르는 중 · 낮잠이면 안 나간다.
// 물러나면서 때려도(움직이는 쪽과 반대) 맞는다. 구르기는 움직이는 쪽으로
{
  const auto = () => makeDungeon(sheets, 'alley', bare(), { classic: true });
  const d = auto();
  const rat = makeEnemy('fat', sheets, d.P.x + 1.5, d.P.z);
  d.enemies = [rat];
  run(d, still, 0.2);
  assert.equal(rat.hp, rat.def.hp - PLAYER.punch.damage, '범위 안이면 저절로 냥펀치');
  const far = auto();
  const r2 = makeEnemy('fat', sheets, far.P.x + PLAYER.punch.range + 0.6, far.P.z);
  r2.def = { ...r2.def, speed: 0, range: 0.1 }; // 다가오지 않게
  far.enemies = [r2];
  run(far, still, 0.5);
  assert.ok(r2.hp === r2.def.hp && far.P.punchT <= 0, '범위 밖이면 안 때린다');
  const none = auto();
  none.enemies = [];
  run(none, still, 0.5);
  assert.equal(none.P.punchT <= 0 && none.pops.length, 0, '몬스터가 없으면 안 때린다');
  const nap = auto();
  const r3 = makeEnemy('fat', sheets, nap.P.x + 1.5, nap.P.z);
  nap.enemies = [r3];
  nap.phase = 'napped';
  run(nap, still, 0.3);
  assert.equal(r3.hp, r3.def.hp, '낮잠이면 안 때린다');
  // 물러나며 때리기: 몬스터는 오른쪽(+x), 고양이는 왼쪽(−x)으로 걷는다 → 그래도 맞는다
  const kite = auto();
  const r4 = makeEnemy('fat', sheets, kite.P.x + 1.6, kite.P.z);
  r4.def = { ...r4.def, speed: 0, range: 0.1 };
  kite.enemies = [r4];
  for (let i = 0; i < 10; i++) updateDungeon(kite, { ...still, mx: -1, my: -1 }, 0.016); // 화면 왼쪽 위 = 월드 −x (몬스터 반대쪽)
  assert.equal(r4.hp, r4.def.hp - PLAYER.punch.damage, '물러나면서 때려도 맞는다');
  // 구르기는 움직이는 쪽으로 (냥펀치가 몬스터 쪽을 겨눠도)
  updateDungeon(kite, { ...still, mx: -1, my: -1, dash: true }, 0.016);
  assert.ok(kite.P.dashX < -0.9, `움직이는 쪽으로 구른다 (${kite.P.dashX.toFixed(2)})`);
}

// 노란 매트에 EXIT_DWELL(3초) 서 있으면 'exit' — 밟자마자는 아니다. 벗어나면 처음부터. 낮잠 중에는 안 나간다
{
  const d = fresh();
  const [tx, tz] = d.room.exits[0];
  d.enemies = [];
  const onMat = () => Object.assign(d.P, { x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });
  onMat();
  assert.equal(run(d, still, EXIT_DWELL - 0.2).out, null, '3초가 되기 전엔 안 나간다');
  assert.ok(d.exitT > EXIT_DWELL - 0.3, '서 있은 시간을 센다');
  Object.assign(d.P, { x: d.P.x + CELL * 2, z: d.P.z + CELL * 2 }); // 매트에서 내려온다
  run(d, still, 0.05);
  assert.equal(d.exitT, 0, '벗어나면 처음부터');
  onMat();
  assert.equal(run(d, still, EXIT_DWELL + 0.05).out, 'exit', '3초 서 있으면 나간다');

  const n = fresh();
  n.enemies = [];
  Object.assign(n.P, { x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });
  n.phase = 'napped';
  assert.equal(run(n, still, EXIT_DWELL + 0.5).out, null, '낮잠이면 안 나간다');
}

// 클리어한 뒤에도 걸을 수 있다 (나가는 칸까지 걸어가야 한다). 낮잠이면 못 걷는다
{
  const d = fresh();
  d.enemies = [];
  run(d, still, 0.05);
  assert.equal(d.phase, 'cleared');
  const walk = (n: number) => {
    for (let i = 0; i < n; i++) updateDungeon(d, { ...still, mx: 1 }, 0.016);
  };
  const x0 = d.P.x;
  walk(20);
  assert.ok(d.P.x > x0 + 0.3, `클리어 뒤 이동: ${x0} -> ${d.P.x}`);
  d.phase = 'napped';
  const x1 = d.P.x;
  walk(20);
  assert.ok(Math.abs(d.P.x - x1) < 0.01, '낮잠 중엔 못 움직인다');
}

// 방마다: 몬스터 id 가 있고, 배치가 바닥 위이고, 가운데(시작점)에서 나가는 곳까지 걸어갈 수 있다
for (const id of Object.keys(ROOMS)) {
  const r = room(id);
  assert.ok(r.exits.length > 0, `${id}: 나가는 곳(E)이 없다`);
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < r.gridW && z < r.gridH && !r.grid.solid[z * r.gridW + x];
  for (const [k, x, z] of r.def.spawns) {
    assert.ok(ENEMY_DEFS[k as string], `${id}: 없는 몬스터 ${k}`);
    assert.ok(open(x as number, z as number), `${id}: ${k} 가 막힌 칸 (${x},${z}) 에 선다`);
  }
  if (r.def.popFx) assert.ok(r.def.popFx in FX, `${id}: 없는 이펙트 ${r.def.popFx}`);
  const seen = new Set<number>();
  const q = [[Math.floor(r.gridW / 2), Math.floor(r.gridH / 2)]];
  for (const [x, z] of q)
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]])
      if (open(nx, nz) && !seen.has(nz * r.gridW + nx)) {
        seen.add(nz * r.gridW + nx);
        q.push([nx, nz]);
      }
  assert.ok(r.exits.some(([x, z]) => seen.has(z * r.gridW + x)), `${id}: 시작점에서 나가는 곳까지 못 간다`);
}
// 연결된 포탈은 있는 방이나 낚시터, 또는 상점('shop') · 미니게임('maze' · 'sandboard' · 'timber')을 가리킨다
for (const w of data.warps) if (w.to) assert.ok(ROOMS[w.to] || SPOTS[w.to] || ['shop', 'maze', 'sandboard', 'timber'].includes(w.to), `포탈 ${w.id}: 없는 방 ${w.to}`);

console.log('dungeon.check: ok');
