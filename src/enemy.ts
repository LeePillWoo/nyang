import { CELL, isSolid, resolveCircle, type Grid } from './collide.ts';
import defs from './data/enemies.json' with { type: 'json' };
import type { Sheet } from './sheet.ts';

export const RAT_ROW = { idle: 0, move: 1, attack: 2, hurt: 3, down: 4 };
export const RAT_FPS = { idle: 6, move: 12, hurt: 10, down: 8 };
/** 공격 행 6칸 = 앞 3칸 준비 동작 + 뒤 3칸 타격. 타격 3칸을 보여주는 시간 */
const STRIKE_TIME = 0.24;
/** 근접 쥐가 공격을 시작해도 되는 화면 세로 오차(m). 위·아래로 붙으면 스프라이트가 겹쳐 몸을 가린다 */
const SIDE_TOL = 0.7;
/** 근접 쥐가 서는 옆자리 거리 (사거리 대비) */
const SLOT = 0.85;

export type Kind = keyof typeof defs;
export type Def = (typeof defs)[Kind];
export const ENEMY_DEFS = defs as Record<Kind, Def>;

export type State = 'idle' | 'chase' | 'windup' | 'recover' | 'hurt' | 'pop';

export type Enemy = {
  kind: Kind;
  def: Def;
  sheet: Sheet;
  x: number;
  z: number;
  hp: number;
  state: State;
  t: number; // 현재 상태 경과
  anim: number;
  flip: number;
  kx: number; // 넉백 속도
  kz: number;
  /** 모션이 바뀔 때 크기를 부드럽게 잇기 위한 표시용 배율 */
  dispScale: number;
  /** 근접 쥐가 설 고양이 옆자리 (화면 오른쪽 1 / 왼쪽 -1, 0 = 아직 없음) */
  side: number;
};

/** AI 가 바깥에 요청하는 것들 */
export type World = {
  px: number;
  pz: number;
  grid: Grid;
  hitPlayer(damage: number, fromX: number, fromZ: number): void;
  spawnArrow(x: number, z: number, dx: number, dz: number, speed: number, damage: number): void;
};

export function makeEnemy(kind: Kind, sheet: Sheet, x: number, z: number): Enemy {
  const def = ENEMY_DEFS[kind];
  return {
    kind,
    def,
    sheet,
    x,
    z,
    hp: def.hp,
    state: 'idle',
    t: 0,
    anim: 0,
    flip: 1,
    kx: 0,
    kz: 0,
    dispScale: 1,
    side: 0,
  };
}

export function damageEnemy(e: Enemy, dmg: number, fromX: number, fromZ: number) {
  if (e.state === 'pop') return;
  e.hp -= dmg;
  const d = Math.hypot(e.x - fromX, e.z - fromZ) || 1;
  const push = e.hp <= 0 ? 6 : 4;
  e.kx = ((e.x - fromX) / d) * push;
  e.kz = ((e.z - fromZ) / d) * push;
  e.state = e.hp <= 0 ? 'pop' : 'hurt';
  e.t = 0;
  e.anim = 0;
}

export function updateEnemy(e: Enemy, dt: number, w: World) {
  e.t += dt;
  e.anim += dt;

  // 넉백은 상태와 무관하게 감쇠시킨다
  if (e.kx || e.kz) {
    const k = Math.exp(-9 * dt);
    const p = resolveCircle(w.grid, e.x + e.kx * dt, e.z + e.kz * dt, 0.4);
    e.x = p.x;
    e.z = p.z;
    e.kx *= k;
    e.kz *= k;
    if (Math.hypot(e.kx, e.kz) < 0.05) e.kx = e.kz = 0;
  }

  if (e.state === 'pop') return;

  const dx = w.px - e.x;
  const dz = w.pz - e.z;
  const dist = Math.hypot(dx, dz) || 1;
  // 화면 좌우로 바라본다 — 아이소메트릭에선 화면 x 가 월드 (x - z) 방향이다
  if (e.state !== 'windup') e.flip = dx - dz >= 0 ? 1 : -1;

  switch (e.state) {
    case 'hurt':
      if (e.t > 0.25) {
        e.state = 'chase';
        e.t = 0;
      }
      break;

    case 'recover':
      if (e.t > e.def.cooldown) {
        e.state = 'chase';
        e.t = 0;
      }
      break;

    case 'windup':
      if (e.t >= e.def.windup) {
        if (e.def.arrowSpeed > 0) {
          w.spawnArrow(e.x, e.z, dx / dist, dz / dist, e.def.arrowSpeed, e.def.damage);
        } else if (dist <= e.def.range + 0.5) {
          w.hitPlayer(e.def.damage, e.x, e.z);
        }
        e.state = 'recover';
        e.t = 0;
        e.anim = 0;
      }
      break;

    default: {
      const melee = e.def.arrowSpeed === 0;
      const vert = (dx + dz) * Math.SQRT1_2; // 화면 세로 방향 거리
      if (dist <= e.def.range && (!melee || Math.abs(vert) < SIDE_TOL)) {
        e.state = 'windup';
        e.t = 0;
        e.anim = 0;
        break;
      }
      // 근접은 고양이 옆(화면 좌우) 자리로 간다 — 지금 있는 쪽, 막혀 있으면 반대쪽.
      // 원거리는 고양이 쪽으로 가되 너무 가까우면 물러난다.
      let tx = w.px;
      let tz = w.pz;
      let v = e.def.speed;
      if (melee) {
        const slot = e.def.range * SLOT;
        const at = (side: number) => ({
          x: w.px + side * slot * Math.SQRT1_2,
          z: w.pz - side * slot * Math.SQRT1_2,
        });
        const side = e.side || (dx - dz <= 0 ? 1 : -1);
        let g = at(side);
        if (isSolid(w.grid, Math.floor(g.x / CELL), Math.floor(g.z / CELL))) g = at(-side);
        tx = g.x;
        tz = g.z;
      } else if (e.def.keepDist > 0 && dist < e.def.keepDist) {
        v = -v;
      }
      const gx = tx - e.x;
      const gz = tz - e.z;
      const gd = Math.hypot(gx, gz);
      if (gd > 0.05) {
        const step = v > 0 ? Math.min(v * dt, gd) : v * dt;
        const p = resolveCircle(w.grid, e.x + (gx / gd) * step, e.z + (gz / gd) * step, 0.4);
        e.x = p.x;
        e.z = p.z;
      }
      e.state = 'chase';
    }
  }
}

/** 상태에 맞는 시트 행과 프레임 */
export function enemyFrame(e: Enemy, cols: number): { row: number; col: number } {
  const pick = (row: number, fps: number, once = false) => {
    const f = Math.floor(e.anim * fps);
    return { row, col: once ? Math.min(cols - 1, f) : f % cols };
  };
  switch (e.state) {
    case 'pop':
      return pick(RAT_ROW.down, RAT_FPS.down, true);
    case 'hurt':
      return pick(RAT_ROW.hurt, RAT_FPS.hurt, true);
    case 'windup':
      // 예고: 준비 동작 3칸을 예고 시간에 걸쳐 딱 한 번
      return { row: RAT_ROW.attack, col: Math.min(2, Math.floor((e.t / e.def.windup) * 3)) };
    case 'recover':
      // 타격 3칸을 짧게 한 번 보여주고, 쿨다운 동안은 대기 자세로 쉰다.
      // (전에는 쿨다운 내내 공격 모션을 반복해서 때린 뒤에도 계속 앞으로 튀어나왔다)
      if (e.t < STRIKE_TIME)
        return { row: RAT_ROW.attack, col: 3 + Math.min(2, Math.floor((e.t / STRIKE_TIME) * 3)) };
      return pick(RAT_ROW.idle, RAT_FPS.idle);
    case 'chase':
      return pick(RAT_ROW.move, RAT_FPS.move);
    default:
      return pick(RAT_ROW.idle, RAT_FPS.idle);
  }
}

/** 전방 부채꼴 안에 있는 적 (냥펀치 판정) */
export function punchTargets(
  list: Enemy[],
  px: number,
  pz: number,
  fx: number,
  fz: number,
  range: number,
  arc: number,
): Enemy[] {
  const cosHalf = Math.cos(arc / 2);
  return list.filter((e) => {
    if (e.state === 'pop') return false;
    const dx = e.x - px;
    const dz = e.z - pz;
    const d = Math.hypot(dx, dz);
    if (d > range) return false;
    return (dx * fx + dz * fz) / (d || 1) >= cosHalf;
  });
}

/**
 * 사거리 안에서 가장 가까운 적 쪽 단위벡터.
 * 조준이 없으면 바라보는 방향은 마지막 이동 방향이라, 멈춰서 때리면 엉뚱한 데를 친다.
 */
export function aimAt(
  list: Enemy[],
  px: number,
  pz: number,
  range: number,
): { x: number; z: number } | null {
  let best: Enemy | null = null;
  let bd = Infinity;
  for (const e of list) {
    if (e.state === 'pop') continue;
    const d = Math.hypot(e.x - px, e.z - pz);
    if (d <= range && d < bd) {
      bd = d;
      best = e;
    }
  }
  if (!best || bd === 0) return null;
  return { x: (best.x - px) / bd, z: (best.z - pz) / bd };
}

const GAP_RAT = 1.1; // 쥐끼리
const GAP_CAT = 1.0; // 쥐와 고양이

/**
 * 몸끼리 겹치지 않게 밀어낸다. 고양이는 밀지 않고(조작감) 쥐만 비켜선다.
 * ponytail: 전체 쌍 O(n²). 화면 내 적 40마리면 780쌍이라 충분, 더 늘면 격자 버킷으로.
 */
export function separate(list: Enemy[], px: number, pz: number, grid: Grid) {
  const live = list.filter((e) => e.state !== 'pop');
  // 고양이 쪽 제약과 쥐끼리 제약이 서로 되밀어서 한 번엔 안 풀린다. 몇 번 반복해 수렴시킨다.
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      const cx = a.x - px;
      const cz = a.z - pz;
      const cd = Math.hypot(cx, cz);
      if (cd < GAP_CAT) {
        const [ux, uz] = cd > 1e-4 ? [cx / cd, cz / cd] : [1, 0];
        a.x = px + ux * GAP_CAT;
        a.z = pz + uz * GAP_CAT;
      }
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const ddx = b.x - a.x;
        const ddz = b.z - a.z;
        const d = Math.hypot(ddx, ddz);
        if (d >= GAP_RAT) continue;
        const [ux, uz] = d > 1e-4 ? [ddx / d, ddz / d] : [1, 0];
        const m = (GAP_RAT - d) / 2;
        a.x -= ux * m;
        a.z -= uz * m;
        b.x += ux * m;
        b.z += uz * m;
      }
    }
  }
  for (const e of live) {
    const p = resolveCircle(grid, e.x, e.z, 0.4);
    e.x = p.x;
    e.z = p.z;
  }
}

/**
 * 근접 쥐들에게 고양이 양옆 자리를 나눠 준다. 가까운 쥐부터 자기가 있는 쪽을 잡고,
 * 그쪽이 이미 찼으면 반대쪽으로 보낸다 — 한쪽에 몰리면 앞의 쥐가 뒤의 쥐를 가린다.
 */
export function assignSides(list: Enemy[], px: number, pz: number) {
  const melee = list
    .filter((e) => e.state !== 'pop' && e.def.arrowSpeed === 0)
    .sort((a, b) => Math.hypot(a.x - px, a.z - pz) - Math.hypot(b.x - px, b.z - pz));
  const taken = new Set<number>();
  for (const e of melee) {
    let side = px - e.x - (pz - e.z) <= 0 ? 1 : -1;
    if (taken.has(side) && !taken.has(-side)) side = -side;
    taken.add(side);
    e.side = side;
  }
}
