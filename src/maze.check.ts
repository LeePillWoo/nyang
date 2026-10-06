// node src/maze.check.ts  (npm run check) — 미로가 늘 풀리고, 횃불은 길을 따라서만 보이고, 줍기·탈출·보너스가 맞는지
import assert from 'node:assert/strict';
import { ITEMS } from './bag.ts';
import { CELL, isSolid } from './collide.ts';
import { CHEST, distances, makeMaze, MAZE, updateMaze, WHALE_CHEST, WHALE_MAZE, type MazeState } from './maze.ts';

const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const DT = 1 / 60;
const run = (s: MazeState, mx: number, my: number, secs: number) => {
  for (let i = 0; i < Math.round(secs / DT); i++) updateMaze(s, { mx, my }, DT);
};
const put = (s: MazeState, cx: number, cz: number) => {
  s.x = (cx + 0.5) * CELL;
  s.z = (cz + 0.5) * CELL;
};
/** 시작에서 출구까지 길 (칸 좌표) — 거리 표를 거꾸로 따라간다 */
function solve(s: MazeState) {
  const d = distances(s.grid, s.start[0], s.start[1]);
  const path: [number, number][] = [s.exit];
  let [x, z] = s.exit;
  while (d[z * s.w + x] > 0) {
    const n = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].find(([nx, nz]) => !isSolid(s.grid, nx, nz) && d[nz * s.w + nx] === d[z * s.w + x] - 1)!;
    [x, z] = n;
    path.push([x, z]);
  }
  return path.reverse();
}

// 1) 30판: 완전한 미로 — 길은 다 이어져 있고, 출구는 멀고, 상자는 막다른 길 끝, 냥코인은 서로 떨어져 길 위에
for (let seed = 1; seed <= 30; seed++) {
  const s = makeMaze(seeded(seed));
  const d = distances(s.grid, 1, 1);
  let open = 0;
  let reach = 0;
  let max = 0;
  for (let i = 0; i < d.length; i++) {
    if (!s.grid.solid[i]) open++;
    if (d[i] >= 0) reach++;
    max = Math.max(max, d[i]);
  }
  assert.equal(reach, open, `seed ${seed}: 길이 다 이어져 있다`);
  assert.ok(d[s.exit[1] * s.w + s.exit[0]] === max && max >= 40, `seed ${seed}: 출구는 가장 먼 칸 (${max}걸음)`);
  const c = s.chest;
  assert.ok(!isSolid(s.grid, c.cx, c.cz) && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !isSolid(s.grid, c.cx + dx, c.cz + dz)).length === 1, `seed ${seed}: 상자는 막다른 길`);
  assert.ok(CHEST.some(([id]) => id === c.item) && ITEMS[c.item], `seed ${seed}: 상자 속 ${c.item}`);
  assert.equal(s.coins.length, MAZE.coins);
  for (const a of s.coins) {
    assert.ok(!isSolid(s.grid, a.cx, a.cz));
    for (const b of s.coins) if (a !== b) assert.ok(Math.abs(a.cx - b.cx) + Math.abs(a.cz - b.cz) >= 4, '냥코인은 서로 떨어져');
  }
  assert.equal(solve(s)[0].join(), '1,1');
}

// 2) 횃불: 처음엔 조금만 보이고, 벽 너머는 안 보인다. 걸으면 본 곳이 늘고, 길에서 먼 곳은 끝까지 캄캄하다
{
  const s = makeMaze(seeded(3));
  const seen0 = s.seen.reduce((a, b) => a + b, 0);
  assert.ok(seen0 < s.w * s.h * 0.12, `처음 보이는 칸 ${seen0}`);
  // 횃불이 닿은 길은 전부 시작 칸에서 sight 걸음 안
  const d = distances(s.grid, 1, 1);
  for (let i = 0; i < s.lit.length; i++) if (s.lit[i] && !s.grid.solid[i]) assert.ok(d[i] <= MAZE.sight, '길은 횃불 거리 안에서만 보인다');
  const path = solve(s);
  for (const [x, z] of path) {
    put(s, x, z);
    updateMaze(s, { mx: 0, my: 0 }, DT);
  }
  const seen1 = s.seen.reduce((a, b) => a + b, 0);
  assert.ok(seen1 > seen0 * 3, `걸으면 본 곳이 는다 ${seen0} → ${seen1}`);
  // 길에서 가장 먼 길 칸은 아직 캄캄 (완전 탐색 전엔 다 안 보인다)
  const onPath = new Set(path.map(([x, z]) => z * s.w + x));
  let dark = 0;
  for (let i = 0; i < s.seen.length; i++) if (!s.grid.solid[i] && !onPath.has(i) && !s.seen[i]) dark++;
  assert.ok(dark > 10, `출구 길만 걸으면 못 본 길이 남는다 (${dark}칸)`);
}

// 3) 벽은 못 지나간다, 냥코인·상자를 주우면 사건, 출구에 서면 탈출 + 보너스 (빠를수록 크다)
{
  const s = makeMaze(seeded(5));
  run(s, -1, 0, 1); // 시작 칸 왼쪽은 벽
  assert.ok(s.x >= 1 * CELL + MAZE.radius - 0.01 && s.x < 1.6 * CELL, `벽에 막힌다 (x ${s.x.toFixed(2)})`);
  run(s, 0, -1, 1);
  assert.ok(s.z >= 1 * CELL + MAZE.radius - 0.01, '위쪽 벽에도');
  const c = s.coins[0];
  put(s, c.cx, c.cz);
  updateMaze(s, { mx: 0, my: 0 }, DT);
  assert.ok(c.got && s.got === 1 && s.events.some((e) => e.type === 'coin'), '냥코인 줍기');
  put(s, s.chest.cx, s.chest.cz);
  updateMaze(s, { mx: 0, my: 0 }, DT);
  const ev = s.events.find((e) => e.type === 'chest');
  assert.ok(s.chest.got && ev && ev.type === 'chest' && ev.item === s.chest.item, '상자 열기');
  s.t = 20;
  put(s, s.exit[0], s.exit[1]);
  updateMaze(s, { mx: 0, my: 0 }, DT);
  const ex = s.events.find((e) => e.type === 'exit');
  assert.ok(s.phase === 'done' && ex && ex.type === 'exit' && ex.bonus === MAZE.bonusMax - 10, `20초 탈출 보너스 ${s.bonus}`);
  updateMaze(s, { mx: 1, my: 0 }, DT);
  assert.equal(s.events.length, 0, '끝난 뒤엔 멈춘다');

  const slow = makeMaze(seeded(5));
  slow.t = 500;
  put(slow, slow.exit[0], slow.exit[1]);
  updateMaze(slow, { mx: 0, my: 0 }, DT);
  assert.equal(slow.bonus, 5, '아무리 늦어도 보너스 5');
}

// 4) 실제로 걸어서 풀린다: 길을 따라 칸 가운데를 하나씩 밟아 출구까지 (벽에 끼지 않는다)
{
  const s = makeMaze(seeded(8));
  const path = solve(s);
  let t = 0;
  for (const [x, z] of path.slice(1)) {
    const tx = (x + 0.5) * CELL;
    const tz = (z + 0.5) * CELL;
    for (let i = 0; i < 240 && s.phase === 'play' && Math.hypot(s.x - tx, s.z - tz) > 0.15; i++) {
      updateMaze(s, { mx: Math.sign(Math.round((tx - s.x) * 10)), my: Math.sign(Math.round((tz - s.z) * 10)) }, DT);
      t += DT;
    }
    // 출구 칸은 발을 들이는 순간 끝난다 (가운데까지 안 가도)
    assert.ok(s.phase === 'done' || Math.hypot(s.x - tx, s.z - tz) <= 0.15, `(${x},${z}) 에 닿는다`);
  }
  assert.equal(s.phase, 'done', '출구에 발을 들이면 탈출');
  console.log(`  미로 ${s.w}×${s.h}: 출구까지 ${path.length - 1}걸음, 곧장 걸으면 ${t.toFixed(1)}초`);
}

// 4) 고래 배 속: 같은 규칙의 조금 작은 미로 — 늘 풀리고, 출구(숨구멍)는 가장 먼 칸, 상자엔 바다 보물
for (let seed = 1; seed <= 30; seed++) {
  const s = makeMaze(seeded(seed), 'whale');
  assert.ok(s.theme === 'whale' && s.w === WHALE_MAZE.w && s.h === WHALE_MAZE.h, '고래 배 속 크기');
  const d = distances(s.grid, 1, 1);
  const max = Math.max(...d);
  assert.ok(d[s.exit[1] * s.w + s.exit[0]] === max && max >= 30, `고래 seed ${seed}: 숨구멍은 가장 먼 칸 (${max}걸음)`);
  assert.ok(WHALE_CHEST.some(([id]) => id === s.chest.item) && ITEMS[s.chest.item], `고래 seed ${seed}: 진주 조개 속 ${s.chest.item}`);
  assert.equal(solve(s)[0].join(), '1,1');
}
assert.ok(WHALE_CHEST.every(([id]) => ITEMS[id]), '고래 보물은 다 있는 아이템');

console.log('maze.check: ok');
