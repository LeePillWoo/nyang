/**
 * 던전 전투 로직 — 플레이어 이동·냥펀치·구르기·피격·부활, 쥐·화살, 데미지 숫자·이펙트·화면 흔들기 목록.
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크할 수 있다. 그리기는 dungeon-draw.ts,
 * 소리는 events 로 내보내고 main.ts 가 재생한다 (필드의 field.ts / field-draw.ts 와 같은 모양).
 *
 * 플레이어 스탯은 src/data/player.json, 방(배경·바닥·충돌 맵·몬스터 배치)은 src/data/rooms.json.
 */
import { CELL, resolveCircle } from './collide.ts';
import player from './data/player.json' with { type: 'json' };
import {
  aimAt,
  assignSides,
  damageEnemy,
  makeEnemy,
  punchTargets,
  separate,
  updateEnemy,
  type Enemy,
  type Kind,
  type World,
} from './enemy.ts';
import { FX_LIFE, type Fx, type FxId } from './fx.ts';
import { room, type Room } from './iso.ts';
import type { Sheet } from './sheet.ts';

export const PLAYER = player;
const PUNCH_ARC = (player.punch.arcDeg * Math.PI) / 180;
export const POP_LIFE = 0.85;
/** 쥐가 쓰러진 뒤 뿅 연출이 끝나 목록에서 빠지기까지 */
export const POP_OUT = 0.6;

// 화면 흔들기는 아껴 쓴다 (멀미 방지): 마무리 일격 · 아픈 피격 · 목숨 소모
const SHAKE_FINISH = 9;
const SHAKE_HURT = 15;
const SHAKE_HURT_MIN_DMG = 12;
const SHAKE_LIFE_LOST = 24;

export type Pop = { x: number; z: number; text: string; t: number; dx: number; hurt: boolean; h: number };
export type Arrow = { x: number; z: number; dx: number; dz: number; speed: number; dmg: number; life: number };
export type Phase = 'playing' | 'cleared' | 'napped';
/** 소리용 사건. 한 프레임 동안만 남는다 */
export type DungeonEvent = { type: 'hit'; finish: boolean } | { type: 'pop' } | { type: 'hurt' };
/** 화면 기준 입력. mx, my 는 -1..1 */
export type DungeonInput = { mx: number; my: number; punch: boolean; dash: boolean };

function makePlayer() {
  return {
    x: 0,
    z: 0,
    hp: player.maxHp,
    lives: player.startLives,
    faceX: 0,
    faceZ: 1,
    flip: 1,
    /** 방향키를 누르고 있나 (달리기 모션) */
    moving: false,
    dashX: 0,
    dashZ: 0,
    dashT: 0,
    dashCd: 0,
    punchT: 0,
    punchHit: false,
    invT: 0,
    hurtT: 0,
    kx: 0,
    kz: 0,
    animT: 0,
    /** 모션이 바뀔 때 크기를 부드럽게 잇는 표시용 배율 (그리기가 갱신한다) */
    dispScale: 1,
  };
}
export type Player = ReturnType<typeof makePlayer>;

export type Dungeon = {
  P: Player;
  enemies: Enemy[];
  arrows: Arrow[];
  pops: Pop[];
  fxs: Fx[];
  shake: number;
  phase: Phase;
  events: DungeonEvent[];
  /** 몬스터 종류별 시트. 방에 들어가기 전에 그 방 몬스터 것을 채워 둔다 (node 체크에선 빈 객체) */
  sheets: Record<Kind, Sheet>;
  world: World;
  room: Room;
};

const tile = (tx: number, tz: number) => ({ x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });

const addFx = (d: Dungeon, x: number, z: number, id: FxId, size: number) =>
  d.fxs.push({ x, z, id, t: 0, size, rot: Math.random() * Math.PI * 2 });
const addPop = (d: Dungeon, x: number, z: number, n: number, hurt = false, h = 150) =>
  d.pops.push({ x, z, text: String(n), t: 0, dx: (Math.random() - 0.5) * 40, hurt, h });
const shakeBy = (d: Dungeon, v: number) => {
  d.shake = Math.max(d.shake, v);
};

/** sheets: 몬스터 종류별 스프라이트 시트 (몬스터가 들고 다닌다. node 체크에선 아무 값이나) */
export function makeDungeon(sheets: Record<Kind, Sheet>, roomId = 'alley'): Dungeon {
  const d = {
    P: makePlayer(),
    enemies: [],
    arrows: [],
    pops: [],
    fxs: [],
    shake: 0,
    phase: 'playing',
    events: [],
    sheets,
    room: room(roomId),
  } as unknown as Dungeon;
  d.world = {
    px: 0,
    pz: 0,
    grid: d.room.grid,
    hitPlayer: (dmg, fx, fz) => hitPlayer(d, dmg, fx, fz),
    spawnArrow: (x, z, dx, dz, speed, dmg) => d.arrows.push({ x, z, dx, dz, speed, dmg, life: 3 }),
  };
  resetDungeon(d);
  return d;
}

/** 방에 새로 들어온 상태로 — 방 가운데에 서고, 몬스터를 다시 배치한다. roomId 를 주면 그 방으로 옮긴다 */
export function resetDungeon(d: Dungeon, roomId = d.room.id) {
  d.room = room(roomId);
  d.world.grid = d.room.grid;
  const c = tile(Math.floor(d.room.gridW / 2), Math.floor(d.room.gridH / 2));
  Object.assign(d.P, makePlayer(), { x: c.x, z: c.z });
  d.enemies = d.room.def.spawns.map(([k, tx, tz]) => {
    const p = tile(tx as number, tz as number);
    return makeEnemy(k as Kind, d.sheets[k as Kind], p.x, p.z);
  });
  d.arrows = [];
  d.pops = [];
  d.fxs = [];
  d.shake = 0;
  d.phase = 'playing';
  d.events = [];
}

export function hitPlayer(d: Dungeon, dmg: number, fx: number, fz: number) {
  const P = d.P;
  if (d.phase !== 'playing' || P.invT > 0 || P.dashT > 0) return; // 구르기 중 무적
  P.hp -= dmg;
  P.hurtT = 0.3;
  addPop(d, P.x, P.z, dmg, true, player.size);
  addFx(d, P.x, P.z, 'slash', 263);
  d.events.push({ type: 'hurt' });
  if (dmg >= SHAKE_HURT_MIN_DMG) shakeBy(d, SHAKE_HURT); // 아픈 공격만
  const dist = Math.hypot(P.x - fx, P.z - fz) || 1;
  P.kx = ((P.x - fx) / dist) * 4;
  P.kz = ((P.z - fz) / dist) * 4;
  if (P.hp > 0) {
    P.invT = player.hitIframe;
    return;
  }
  // 목숨 하나 쓰고 그 자리에서 부활 (GDD 5장 아홉 목숨)
  P.lives -= 1;
  shakeBy(d, SHAKE_LIFE_LOST);
  if (P.lives <= 0) {
    P.hp = 0;
    d.phase = 'napped';
  } else {
    P.hp = player.maxHp * player.reviveHp;
    P.invT = player.reviveIframe;
  }
}

const onExit = (r: Room, x: number, z: number) =>
  r.exits.some(([tx, tz]) => tx === Math.floor(x / CELL) && tz === Math.floor(z / CELL));

/** 한 프레임 진행. 나가는 곳(노란 매트)을 밟았으면 'exit' */
export function updateDungeon(d: Dungeon, input: DungeonInput, dt: number): 'exit' | null {
  const P = d.P;
  d.events.length = 0;
  P.animT += dt;
  P.dashCd = Math.max(0, P.dashCd - dt);
  P.invT = Math.max(0, P.invT - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);

  // 화면 기준 입력을 아이소메트릭 축으로 45도 돌린다
  let { mx, my } = input;
  const len = Math.hypot(mx, my);
  P.moving = len > 0;
  const alive = d.phase === 'playing';
  if (len > 0 && alive) {
    mx /= len;
    my /= len;
    P.faceX = (mx + my) * Math.SQRT1_2;
    P.faceZ = (my - mx) * Math.SQRT1_2;
    if (mx !== 0) P.flip = Math.sign(mx);
  }

  const { dash, punch } = player;
  if (alive && input.punch && P.punchT <= 0 && P.dashT <= 0) {
    const aim = aimAt(d.enemies, P.x, P.z, punch.range);
    if (aim) {
      P.faceX = aim.x;
      P.faceZ = aim.z;
      P.flip = aim.x - aim.z >= 0 ? 1 : -1; // 아이소메트릭에선 x-z 가 화면 좌우
    }
    P.punchT = punch.time;
    P.punchHit = false;
    P.animT = 0;
  }

  if (alive && input.dash && P.dashT <= 0 && P.dashCd <= 0) {
    P.dashX = P.faceX;
    P.dashZ = P.faceZ;
    P.dashT = dash.time;
    P.dashCd = dash.time + dash.cooldown;
    P.punchT = 0;
  }

  // 냥펀치 판정: 전방 부채꼴 안의 적 전부
  if (P.punchT > 0) {
    P.punchT -= dt;
    if (!P.punchHit && punch.time - P.punchT >= punch.hitAt) {
      P.punchHit = true;
      const targets = punchTargets(d.enemies, P.x, P.z, P.faceX, P.faceZ, punch.range, PUNCH_ARC);
      let finish = false;
      for (const e of targets) {
        damageEnemy(e, punch.damage, P.x, P.z);
        addPop(d, e.x, e.z, punch.damage, false, e.def.size);
        const down = e.state === 'pop';
        addFx(d, e.x, e.z, down ? ((d.room.def.popFx as FxId) ?? 'burst') : 'spark', down ? 333 : 219);
        if (down) {
          finish = true;
          d.events.push({ type: 'pop' });
        }
      }
      if (targets.length) d.events.push({ type: 'hit', finish });
      if (finish) shakeBy(d, SHAKE_FINISH);
    }
  }

  let vx = 0;
  let vz = 0;
  if (alive) {
    const slow = P.punchT > 0 ? punch.moveSlow : 1;
    vx = len > 0 ? (mx + my) * Math.SQRT1_2 * player.speed * slow : 0;
    vz = len > 0 ? (my - mx) * Math.SQRT1_2 * player.speed * slow : 0;
    if (P.dashT > 0) {
      P.dashT -= dt;
      vx = P.dashX * (dash.dist / dash.time);
      vz = P.dashZ * (dash.dist / dash.time);
    }
  }
  vx += P.kx;
  vz += P.kz;
  const decay = Math.exp(-10 * dt);
  P.kx *= decay;
  P.kz *= decay;

  const p = resolveCircle(d.room.grid, P.x + vx * dt, P.z + vz * dt, player.radius);
  P.x = p.x;
  P.z = p.z;
  const leave = d.phase !== 'napped' && onExit(d.room, P.x, P.z);

  d.world.px = P.x;
  d.world.pz = P.z;
  assignSides(d.enemies, P.x, P.z);
  for (const e of d.enemies) updateEnemy(e, dt, d.world);
  separate(d.enemies, P.x, P.z, d.room.grid);
  d.enemies = d.enemies.filter((e) => !(e.state === 'pop' && e.t > POP_OUT));

  for (const a of d.arrows) {
    a.life -= dt;
    a.x += a.dx * a.speed * dt;
    a.z += a.dz * a.speed * dt;
    const hit = resolveCircle(d.room.grid, a.x, a.z, 0.12);
    if (hit.x !== a.x || hit.z !== a.z) a.life = 0;
    if (Math.hypot(a.x - P.x, a.z - P.z) < player.radius + 0.2) {
      hitPlayer(d, a.dmg, a.x, a.z);
      a.life = 0;
    }
  }
  d.arrows = d.arrows.filter((a) => a.life > 0);

  for (const q of d.pops) q.t += dt;
  d.pops = d.pops.filter((q) => q.t < POP_LIFE);

  for (const f of d.fxs) f.t += dt;
  d.fxs = d.fxs.filter((f) => f.t < FX_LIFE);
  d.shake = Math.max(0, d.shake - dt * 46);

  if (d.phase === 'playing' && d.enemies.length === 0) d.phase = 'cleared';
  return leave ? 'exit' : null;
}
