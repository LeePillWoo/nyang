import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { CELL, type Grid } from './collide.ts';

// M0 검증용 손그림 방. 절차적 생성은 M2 (GDD 6장).
// '#' 벽  '.' 바닥  'o' 화분  'f' 해바라기  'X' 바닥 없음(보이지 않는 경계).
const MAP = [
  '###XX####XXX#####X',
  '#........o........',
  '#...o.........f...',
  'X.......o.........',
  'X..f.........o....',
  '#........o........',
  '#..o...f.......o..',
  'X.........o.......',
  'X...f.........o...',
  '#.......o.........',
  '#..o.........f....',
  'X........o........',
];

const FLOOR_A = new THREE.Color('#f5e0c2');
const FLOOR_B = new THREE.Color('#ecd0a6');
const WALL = new THREE.Color('#f7e9d7');
const WALL_ALT = new THREE.Color('#efdcc4');

export function buildField(): { group: THREE.Group; grid: Grid; spawn: THREE.Vector2 } {
  const w = MAP[0].length;
  const h = MAP.length;
  const solid = new Array<boolean>(w * h);
  const floorCells: number[] = [];
  const wallCells: number[] = [];
  const potCells: number[] = [];
  const flowerCells: number[] = [];
  const openCells: number[] = [];

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const ch = MAP[z][x];
      const i = z * w + x;
      solid[i] = ch !== '.';
      if (ch === '#') wallCells.push(i);
      else if (ch !== 'X') floorCells.push(i);
      if (ch === 'o') potCells.push(i);
      if (ch === 'f') flowerCells.push(i);
      if (ch === '.') openCells.push(i);
    }
  }

  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 });

  // 방이 통째로 떠 있는 디오라마 받침
  group.add(
    new THREE.Mesh(
      new RoundedBoxGeometry(w * CELL + 0.7, 1.4, h * CELL + 0.7, 2, 0.18).translate(
        (w * CELL) / 2,
        -0.95,
        (h * CELL) / 2,
      ),
      new THREE.MeshStandardMaterial({ color: '#d9bd93', roughness: 1 }),
    ),
  );

  const floor = new THREE.InstancedMesh(
    new RoundedBoxGeometry(CELL - 0.08, 0.4, CELL - 0.08, 2, 0.11),
    mat,
    floorCells.length,
  );
  floor.receiveShadow = true;
  place(floor, floorCells, w, -0.2, (c) => (checker(c, w) ? FLOOR_A : FLOOR_B));

  const walls = new THREE.InstancedMesh(
    new RoundedBoxGeometry(CELL, 3.2, CELL, 3, 0.22),
    mat,
    wallCells.length,
  );
  walls.castShadow = true;
  walls.receiveShadow = true;
  place(walls, wallCells, w, 1.6, (c) => (checker(c, w) ? WALL : WALL_ALT));

  const pots = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.38, 0.28, 0.62, 14).translate(0, 0.31, 0),
    new THREE.MeshStandardMaterial({ color: '#d98b63', roughness: 0.9 }),
    potCells.length,
  );
  const leaves = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.42, 14, 10).scale(1, 0.85, 1).translate(0, 0.8, 0),
    new THREE.MeshStandardMaterial({ color: '#8dc56a', roughness: 0.95 }),
    potCells.length,
  );
  pots.castShadow = leaves.castShadow = true;
  place(pots, potCells, w, 0);
  place(leaves, potCells, w, 0);

  const stems = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.06, 0.08, 1.55, 8).translate(0, 0.775, 0),
    new THREE.MeshStandardMaterial({ color: '#7fb356', roughness: 1 }),
    flowerCells.length,
  );
  const blooms = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.38, 16, 12).scale(1, 1, 0.45).translate(0, 1.68, 0),
    new THREE.MeshStandardMaterial({ color: '#f3c244', roughness: 0.9 }),
    flowerCells.length,
  );
  stems.castShadow = blooms.castShadow = true;
  place(stems, flowerCells, w, 0);
  place(blooms, flowerCells, w, 0);

  group.add(floor, walls, pots, leaves, stems, blooms);

  // 스폰: 방 중앙에서 가장 가까운 빈 칸
  const s = openCells.reduce((best, c) => (dist2(c, w, h) < dist2(best, w, h) ? c : best));
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
  color?: (cell: number) => THREE.Color,
) {
  const m = new THREE.Matrix4();
  for (let i = 0; i < cells.length; i++) {
    m.setPosition(((cells[i] % w) + 0.5) * CELL, y, (Math.floor(cells[i] / w) + 0.5) * CELL);
    mesh.setMatrixAt(i, m);
    if (color) mesh.setColorAt(i, color(cells[i]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (color) mesh.instanceColor!.needsUpdate = true;
}
