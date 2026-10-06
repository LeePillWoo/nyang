/**
 * 피라미드 미로찾기 — 횃불 빛이 닿는 길만 보이는 미로에서 출구를 찾는다. 길에 떨어진 냥코인, 막다른 길 끝의 보물 상자.
 * 고래 배 속(theme 'whale') — 바다에서 고래에게 삼켜지면 같은 규칙의 조금 작은 미로. 빛은 플랑크톤, 출구는 숨구멍, 상자엔 바다 보물.
 * 빨리 나올수록 탈출 보너스 냥코인이 크다. 좌표는 던전처럼 월드 단위 (길 한 칸 = CELL), 화면 기준 WASD 로 그대로 움직인다.
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 maze-draw.ts). 무작위는 rng 로 주입한다.
 */
import { CELL, isSolid, resolveCircle, type Grid } from './collide.ts';
import player from './data/player.json' with { type: 'json' };

export const MAZE = {
  /** 칸 수 (홀수 — 홀수 칸이 길, 사이가 벽) */
  w: 21,
  h: 15,
  /** 횃불: 길을 따라 이 칸 수까지 보인다 */
  sight: 4,
  coins: 8,
  speed: player.speed * 0.95,
  radius: 0.42,
  /** 탈출 보너스 냥코인: bonusMax − 초/2, 최소 5 */
  bonusMax: 40,
};
export type MazeTheme = 'pyramid' | 'whale';
/** 고래 배 속 미로 크기 (바다를 가다 잠깐 들르는 곳이라 피라미드보다 작다) */
export const WHALE_MAZE = { w: 19, h: 13 };
/** 고래 배 속 보물 상자 → 비율 (고래가 삼킨 바다 것들) */
export const WHALE_CHEST: [string, number][] = [
  ['curios_24', 5],
  ['materials_20', 4],
  ['materials_21', 4],
  ['curios_19', 3],
  ['curios_23', 2],
  ['curios_16', 2],
  ['equipment_23', 0.6],
  ['equipment_17', 0.4],
];
/** 보물 상자에서 나오는 것 → 비율 (사막다운 것들) */
export const CHEST: [string, number][] = [
  ['curios_23', 5],
  ['materials_10', 4],
  ['materials_15', 4],
  ['curios_28', 3],
  ['curios_27', 2],
  ['equipment_11', 0.6],
  ['equipment_16', 0.4],
];

export type MazeEvent = { type: 'coin' } | { type: 'chest'; item: string } | { type: 'exit'; secs: number; bonus: number };
export type MazeInput = { mx: number; my: number };
export type Pickup = { cx: number; cz: number; got: boolean };
export type MazeState = {
  theme: MazeTheme;
  w: number;
  h: number;
  grid: Grid;
  x: number;
  z: number;
  flip: number;
  moving: boolean;
  animT: number;
  start: [number, number];
  exit: [number, number];
  coins: Pickup[];
  chest: Pickup & { item: string };
  /** 칸마다 0 = 아직 못 본 곳 · 1 = 본 적 있는 곳 (어둡게 남는다) */
  seen: Uint8Array;
  /** 지금 횃불이 닿는 칸 (매 프레임 다시) */
  lit: Uint8Array;
  t: number;
  phase: 'play' | 'done';
  got: number;
  bonus: number;
  events: MazeEvent[];
  rng: () => number;
};

/** 시작 칸에서 길을 따라 각 칸까지 걸음 수 (-1 = 못 가는 곳) */
export function distances(g: Grid, sx: number, sz: number) {
  const d = new Int32Array(g.w * g.h).fill(-1);
  const q = [sz * g.w + sx];
  d[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % g.w;
    const z = (c - x) / g.w;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]])
      if (!isSolid(g, nx, nz) && d[nz * g.w + nx] < 0) {
        d[nz * g.w + nx] = d[c] + 1;
        q.push(nz * g.w + nx);
      }
  }
  return d;
}

const openNeighbors = (g: Grid, x: number, z: number) => [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dz]) => !isSolid(g, x + dx, z + dz)).length;

export function makeMaze(rng: () => number = Math.random, theme: MazeTheme = 'pyramid'): MazeState {
  const { w, h } = theme === 'whale' ? WHALE_MAZE : MAZE;
  const solid: boolean[] = Array(w * h).fill(true);
  const carve = (x: number, z: number) => (solid[z * w + x] = false);
  // 되돌아가기(recursive backtracker): (1,1) 에서 두 칸씩 뚫으며 막히면 되돌아온다 — 길이 하나뿐인 미로
  const stack: [number, number][] = [[1, 1]];
  carve(1, 1);
  while (stack.length) {
    const [x, z] = stack[stack.length - 1];
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([dx, dz]) => x + dx > 0 && z + dz > 0 && x + dx < w - 1 && z + dz < h - 1 && solid[(z + dz) * w + x + dx]);
    if (!dirs.length) {
      stack.pop();
      continue;
    }
    const [dx, dz] = dirs[Math.floor(rng() * dirs.length)];
    carve(x + dx / 2, z + dz / 2);
    carve(x + dx, z + dz);
    stack.push([x + dx, z + dz]);
  }
  const grid: Grid = { w, h, solid };
  const dist = distances(grid, 1, 1);
  const rooms: [number, number][] = [];
  for (let z = 1; z < h; z += 2) for (let x = 1; x < w; x += 2) rooms.push([x, z]);
  const far = [...rooms].sort((a, b) => dist[b[1] * w + b[0]] - dist[a[1] * w + a[0]]);
  // 출구 = 가장 먼 칸, 상자 = 그다음으로 먼 막다른 길 (출구 가는 길에서 벗어난 곳)
  const exit = far[0];
  const chestAt = far.slice(1).find(([x, z]) => openNeighbors(grid, x, z) === 1) ?? far[1];
  // 냥코인: 시작·출구·상자가 아닌 칸에 서로 떨어뜨려 놓는다
  const coins: Pickup[] = [];
  const taken = new Set([`1,1`, exit.join(','), chestAt.join(',')]);
  for (let tries = 0; coins.length < MAZE.coins && tries < 400; tries++) {
    const [x, z] = rooms[Math.floor(rng() * rooms.length)];
    if (taken.has(`${x},${z}`) || dist[z * w + x] < 3) continue;
    if (coins.some((c) => Math.abs(c.cx - x) + Math.abs(c.cz - z) < 4)) continue;
    taken.add(`${x},${z}`);
    coins.push({ cx: x, cz: z, got: false });
  }
  const table = theme === 'whale' ? WHALE_CHEST : CHEST;
  let r = rng() * table.reduce((a, [, v]) => a + v, 0);
  const item = table.find(([, v]) => (r -= v) < 0)?.[0] ?? table[0][0];
  const s: MazeState = {
    theme,
    w,
    h,
    grid,
    x: 1.5 * CELL,
    z: 1.5 * CELL,
    flip: 1,
    moving: false,
    animT: 0,
    start: [1, 1],
    exit,
    coins,
    chest: { cx: chestAt[0], cz: chestAt[1], got: false, item },
    seen: new Uint8Array(w * h),
    lit: new Uint8Array(w * h),
    t: 0,
    phase: 'play',
    got: 0,
    bonus: 0,
    events: [],
    rng,
  };
  light(s);
  return s;
}

/** 횃불: 고양이 칸에서 길을 따라 sight 칸까지 밝힌다 (벽 너머는 안 보인다). 밝힌 길에 붙은 벽도 같이 보인다 */
function light(s: MazeState) {
  s.lit.fill(0);
  const { w, h, grid } = s;
  const cx = Math.min(w - 1, Math.max(0, Math.floor(s.x / CELL)));
  const cz = Math.min(h - 1, Math.max(0, Math.floor(s.z / CELL)));
  const q: [number, number, number][] = [[cx, cz, 0]];
  s.lit[cz * w + cx] = 1;
  for (let i = 0; i < q.length; i++) {
    const [x, z, d] = q[i];
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= w || nz >= h || s.lit[nz * w + nx]) continue;
        if (isSolid(grid, nx, nz)) s.lit[nz * w + nx] = 1; // 벽은 보이기만
        else if ((dx === 0 || dz === 0) && d < MAZE.sight) {
          s.lit[nz * w + nx] = 1;
          q.push([nx, nz, d + 1]);
        }
      }
  }
  for (let i = 0; i < s.seen.length; i++) if (s.lit[i]) s.seen[i] = 1;
}

const near = (s: MazeState, p: Pickup) => Math.hypot(s.x - (p.cx + 0.5) * CELL, s.z - (p.cz + 0.5) * CELL) < CELL * 0.6;

/** 한 프레임. mx, my 는 화면 기준 -1..1 */
export function updateMaze(s: MazeState, input: MazeInput, dt: number) {
  s.events.length = 0;
  if (s.phase !== 'play') return;
  s.t += dt;
  s.animT += dt;
  const len = Math.hypot(input.mx, input.my);
  s.moving = len > 0;
  if (len > 0) {
    if (input.mx !== 0) s.flip = Math.sign(input.mx);
    const p = resolveCircle(s.grid, s.x + (input.mx / len) * MAZE.speed * dt, s.z + (input.my / len) * MAZE.speed * dt, MAZE.radius);
    s.x = p.x;
    s.z = p.z;
  }
  light(s);
  for (const c of s.coins)
    if (!c.got && near(s, c)) {
      c.got = true;
      s.got++;
      s.events.push({ type: 'coin' });
    }
  if (!s.chest.got && near(s, s.chest)) {
    s.chest.got = true;
    s.events.push({ type: 'chest', item: s.chest.item });
  }
  if (Math.floor(s.x / CELL) === s.exit[0] && Math.floor(s.z / CELL) === s.exit[1]) {
    s.phase = 'done';
    s.bonus = Math.max(5, Math.round(MAZE.bonusMax - s.t / 2));
    s.events.push({ type: 'exit', secs: s.t, bonus: s.bonus });
  }
}
