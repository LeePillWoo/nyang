/** 2m 그리드 위 원-AABB 충돌 (GDD 10장: 물리엔진 없이 자체 구현). */

export const CELL = 2;

/** row-major. solid[z * w + x] === true 면 막힌 칸. */
export type Grid = { w: number; h: number; solid: boolean[] };

export function isSolid(g: Grid, cx: number, cz: number): boolean {
  if (cx < 0 || cz < 0 || cx >= g.w || cz >= g.h) return true; // 맵 바깥은 벽
  return g.solid[cz * g.w + cx];
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 반지름 r 인 원을 막힌 칸 밖으로 밀어낸다.
 * 겹친 칸 중 가장 깊은 것부터 밀어내는 걸 2회 반복 — 벽을 따라 미끄러지고 코너에서 멈춘다.
 * ponytail: 2패스 최대깊이 방식. 코너에 끼는 게 보이면 축 분리 이동으로 올린다.
 */
export function resolveCircle(g: Grid, x: number, z: number, r: number): { x: number; z: number } {
  for (let pass = 0; pass < 2; pass++) {
    let depth = 0;
    let nx = 0;
    let nz = 0;

    const cx0 = Math.floor((x - r) / CELL);
    const cx1 = Math.floor((x + r) / CELL);
    const cz0 = Math.floor((z - r) / CELL);
    const cz1 = Math.floor((z + r) / CELL);

    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        if (!isSolid(g, cx, cz)) continue;

        const minX = cx * CELL;
        const minZ = cz * CELL;
        let dx = x - clamp(x, minX, minX + CELL);
        let dz = z - clamp(z, minZ, minZ + CELL);
        let d = Math.hypot(dx, dz);
        let pen: number;

        if (d > 0) {
          if (d >= r) continue;
          pen = r - d;
          dx /= d;
          dz /= d;
        } else {
          // 중심이 칸 안 — 가장 가까운 면으로 밀어낸다
          const toL = x - minX;
          const toR = minX + CELL - x;
          const toU = z - minZ;
          const toD = minZ + CELL - z;
          const m = Math.min(toL, toR, toU, toD);
          dx = m === toL ? -1 : m === toR ? 1 : 0;
          dz = dx !== 0 ? 0 : m === toU ? -1 : 1;
          pen = m + r;
        }

        if (pen > depth) {
          depth = pen;
          nx = dx;
          nz = dz;
        }
      }
    }

    if (depth === 0) break;
    x += nx * depth;
    z += nz * depth;
  }
  return { x, z };
}
