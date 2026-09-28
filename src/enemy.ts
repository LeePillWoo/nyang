import { resolveCircle, type Grid } from './collide.ts';
import defs from './data/enemies.json' with { type: 'json' };
import type { Sheet } from './sheet.ts';

export const RAT_ROW = { idle: 0, move: 1, attack: 2, hurt: 3, down: 4 };
export const RAT_FPS = { idle: 6, move: 12, attack: 14, hurt: 10, down: 8 };

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
  return { kind, def, sheet, x, z, hp: def.hp, state: 'idle', t: 0, anim: 0, flip: 1, kx: 0, kz: 0 };
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
  if (e.state !== 'windup') e.flip = dx >= 0 ? 1 : -1;

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
      // 사거리 안이면 예고 모션, 아니면 접근 (원거리는 적정 거리 유지)
      if (dist <= e.def.range) {
        e.state = 'windup';
        e.t = 0;
        e.anim = 0;
        break;
      }
      const away = e.def.keepDist > 0 && dist < e.def.keepDist ? -1 : 1;
      const v = e.def.speed * away;
      const p = resolveCircle(w.grid, e.x + (dx / dist) * v * dt, e.z + (dz / dist) * v * dt, 0.4);
      e.x = p.x;
      e.z = p.z;
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
    case 'recover':
      return pick(RAT_ROW.attack, RAT_FPS.attack, e.state === 'windup');
    case 'chase':
      return pick(RAT_ROW.move, RAT_FPS.move);
    default:
      return pick(RAT_ROW.idle, RAT_FPS.idle);
  }
}
