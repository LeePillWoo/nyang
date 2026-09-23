import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CELL, type Grid } from './collide.ts';

// M0 검증용 손그림 맵. 절차적 생성은 M2 (GDD 6장).
const MAP = [
  '################',
  '#..............#',
  '#..##....####..#',
  '#..##.......#..#',
  '#...........#..#',
  '#..####........#',
  '#.....#...##...#',
  '#.....#...##...#',
  '#..............#',
  '################',
];

const FLOOR_A = new THREE.Color('#f7e3c0');
const FLOOR_B = new THREE.Color('#efd6ac');
const WALL = new THREE.Color('#a9dcc6');
const WALL_TOP = new THREE.Color('#c3e9d7');

export function buildField(): { group: THREE.Group; grid: Grid; spawn: THREE.Vector2 } {
  const w = MAP[0].length;
  const h = MAP.length;
  const solid = new Array<boolean>(w * h);
  const floorCells: number[] = [];
  const wallCells: number[] = [];

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const isWall = MAP[z][x] === '#';
      solid[z * w + x] = isWall;
      (isWall ? wallCells : floorCells).push(z * w + x);
    }
  }

  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0 });

  // 바닥: 칸 사이를 살짝 띄워 장난감 타일처럼
  const floor = new THREE.InstancedMesh(
    new RoundedBoxGeometry(CELL - 0.06, 0.4, CELL - 0.06, 2, 0.1),
    mat,
    floorCells.length,
  );
  floor.receiveShadow = true;
  place(floor, floorCells, w, -0.2, (i) => (checker(floorCells[i], w) ? FLOOR_A : FLOOR_B));

  const walls = new THREE.InstancedMesh(
    new RoundedBoxGeometry(CELL, 2.4, CELL, 3, 0.22),
    mat,
    wallCells.length,
  );
  walls.castShadow = true;
  walls.receiveShadow = true;
  place(walls, wallCells, w, 1.2, (i) => (checker(wallCells[i], w) ? WALL : WALL_TOP));

  // 타일 틈으로 하늘이 보이지 않게 깔아 두는 바닥판
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(w * CELL, h * CELL)
      .rotateX(-Math.PI / 2)
      .translate((w * CELL) / 2, -0.38, (h * CELL) / 2),
    new THREE.MeshStandardMaterial({ color: '#e2c79e', roughness: 1 }),
  );
  group.add(ground, floor, walls);

  // 스폰: 맵 중앙에서 가장 가까운 빈 칸
  const s = floorCells.reduce((best, c) => (dist2(c, w, h) < dist2(best, w, h) ? c : best));
  const spawn = new THREE.Vector2(((s % w) + 0.5) * CELL, (Math.floor(s / w) + 0.5) * CELL);

  return { group, grid: { w, h, solid }, spawn };
}

const dist2 = (cell: number, w: number, h: number) =>
  ((cell % w) - w / 2) ** 2 + (Math.floor(cell / w) - h / 2) ** 2;

const checker = (cell: number, w: number) => ((cell % w) + Math.floor(cell / w)) % 2 === 0;

function place(
  mesh: THREE.InstancedMesh,
  cells: number[],
  w: number,
  y: number,
  color: (i: number) => THREE.Color,
) {
  const m = new THREE.Matrix4();
  for (let i = 0; i < cells.length; i++) {
    m.setPosition(((cells[i] % w) + 0.5) * CELL, y, (Math.floor(cells[i] / w) + 0.5) * CELL);
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, color(i));
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor!.needsUpdate = true;
}
