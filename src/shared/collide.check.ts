// node src/collide.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { CELL, resolveCircle, type Grid } from './collide.ts';

// 5x5 방: 테두리는 벽, 가운데 칸 (2,2) 는 기둥. 안쪽 바닥은 월드 2~8m.
const W = 5;
const H = 5;
const solid: boolean[] = [];
for (let z = 0; z < H; z++)
  for (let x = 0; x < W; x++)
    solid[z * W + x] = x === 0 || z === 0 || x === W - 1 || z === H - 1 || (x === 2 && z === 2);
const g: Grid = { w: W, h: H, solid };

const R = 0.4;
const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} != ${b}`);

// 빈 곳은 그대로
let p = resolveCircle(g, 3, 3, R);
near(p.x, 3, 'free x');
near(p.z, 3, 'free z');

// 서쪽 벽을 파고들면 벽면 + 반지름으로 밀려난다
p = resolveCircle(g, 2.1, 3, R);
near(p.x, CELL + R, 'wall push x');
near(p.z, 3, 'wall push keeps z');

// 벽을 따라 미끄러질 때 진행 축(z)은 건드리지 않는다
p = resolveCircle(g, 1.9, 6.7, R);
near(p.x, CELL + R, 'slide x');
near(p.z, 6.7, 'slide z');

// 기둥 모서리는 대각선으로 밀려나 정확히 r 만큼 떨어진다
p = resolveCircle(g, 6.2, 6.2, R);
near(Math.hypot(p.x - 6, p.z - 6), R, 'corner distance');

// 벽 두 개가 만나는 안쪽 코너도 두 패스로 해결
p = resolveCircle(g, 2.1, 2.1, R);
near(p.x, CELL + R, 'inner corner x');
near(p.z, CELL + R, 'inner corner z');

// 칸 안에 완전히 박히면 가장 가까운 면으로 탈출 (기둥 x 4~6, z 4~6 의 서쪽 면)
p = resolveCircle(g, 4.5, 5, R);
near(p.x, 4 - R, 'deep escape x');
near(p.z, 5, 'deep escape z');

console.log('collide.check: ok');
