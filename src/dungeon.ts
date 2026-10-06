/**
 * 던전 전투 로직 — 플레이어 이동·냥펀치·구르기·피격·부활, 몬스터·화살, 웨이브, 기술(skills.ts)·생선뼈(경험치)·레벨 업,
 * 데미지 숫자·이펙트·화면 흔들기 목록. 그림을 불러오지 않는 순수 로직이라 node 에서 체크할 수 있다. 그리기는 dungeon-draw.ts · skills-draw.ts,
 * 소리는 events 로 내보내고 main.ts 가 재생한다 (필드의 field.ts / field-draw.ts 와 같은 모양).
 *
 * 플레이어 스탯은 src/data/player.json, 방(배경·바닥·충돌 맵·몬스터 배치)은 src/data/rooms.json, 웨이브는 waves.json, 기술은 skills.json.
 * 장비 능력치(가방 bag.ts)가 공격·체력·방어·이동·행운에 더해진다. 쓰러진 몬스터는 냥코인·아이템과 생선뼈를 떨어뜨리고,
 * 고양이가 다가가면 빨려 온다 (냥코인·아이템은 가방에, 생선뼈는 경험치로). 웨이브를 깨면 생선뼈가, 방을 깨면 남은 게 전부 날아온다.
 * 레벨이 오르면 choose 에 카드가 뜨고 고를 때까지 멈춘다 (pick).
 * 냥펀치는 자동 (auto) — 타격 범위 안에 몬스터가 있으면 저절로 나간다. 손으로 누르는 punch 입력은 체크용으로 남겨 둔다.
 * 모든 웨이브를 깨거나 낮잠에 빠지면 결과창(result)이 뜨고 멈춘다 — 이번 판 기록은 stats (main 이 필드로 · 다시를 고른다).
 */
import { makeBag, obtain, rollDrops, room as bagRoom, stats, type Bag } from './bag.ts';
import { CELL, resolveCircle } from './collide.ts';
import player from './data/player.json' with { type: 'json' };
import waves from './data/waves.json' with { type: 'json' };
import {
  aimAt,
  assignSides,
  damageEnemy,
  ENEMY_DEFS,
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
import {
  absorbHit,
  addFx as addSkillFx,
  dashCut,
  gainXp,
  learn,
  makeRun,
  onHurt,
  onPunch,
  punchBonus,
  punchReach,
  rollCards,
  tickSkills,
  SNACK,
  XP,
  type Card,
  type Run,
  type SkillHost,
  type SkillSound,
} from './skills.ts';

export const PLAYER = player;
export const WAVES = waves;
const PUNCH_ARC = (player.punch.arcDeg * Math.PI) / 180;
export const POP_LIFE = 0.85;
/** 쥐가 쓰러진 뒤 뿅 연출이 끝나 목록에서 빠지기까지 */
export const POP_OUT = 0.6;

// 화면 흔들기는 아껴 쓴다 (멀미 방지): 마무리 일격 · 아픈 피격 · 목숨 소모
const SHAKE_FINISH = 9;
const SHAKE_HURT = 15;
const SHAKE_HURT_MIN_DMG = 12;
const SHAKE_LIFE_LOST = 24;

/** 떠오르는 숫자. style: 기술 · 치명타 · 계속 피해 (없으면 냥펀치) */
export type Pop = { x: number; z: number; text: string; t: number; dx: number; hurt: boolean; h: number; style?: 'skill' | 'crit' | 'dot' };
/** 바닥에 떨어진 것. id 'coin' = 냥코인 n 개. h = 공중 높이(m), t = 떨어진 뒤 시간 (0.45초 지나야 주울 수 있다) */
/** 바닥에 떨어진 것. full = 가방에 자리가 없어 빨려 오지 않고 그 자리에 있다 · near = 고양이가 그 위에 서 있다 (가득 알림은 밟을 때 한 번) */
export type Loot = { id: string; n: number; x: number; z: number; h: number; vh: number; vx: number; vz: number; t: number; full?: boolean; near?: boolean };
/** 포인트 아이템: 생선뼈(경험치 v — 정예의 큰 뼈는 3) · 생선 비스킷(snack — 바로 먹는 회복) */
export type Bone = { x: number; z: number; h: number; vh: number; vx: number; vz: number; t: number; v: number; snack?: boolean };
/** 주운 것 알림 (화면 왼쪽). id 'full' = 가방이 가득 참 */
export type Toast = { id: string; n: number; t: number };
export const TOAST_LIFE = 2.4;
/** 이만큼 가까우면 빨려 온다 (m) */
const MAGNET = 1.8;
export type Arrow = { x: number; z: number; dx: number; dz: number; speed: number; dmg: number; life: number };
export type Phase = 'playing' | 'cleared' | 'napped';
/** 웨이브: intro(안내, 가장자리 등장 전) → fight → break(다음 웨이브 전) … → done. marks = 곧 나올 자리(예고) */
export type Wave = {
  i: number;
  total: number;
  state: 'intro' | 'fight' | 'break' | 'done';
  t: number;
  queue: { kind: Kind; elite: boolean }[];
  marks: { kind: Kind; elite: boolean; x: number; z: number; t: number }[];
  spawnT: number;
};
/** 소리용 사건. 한 프레임 동안만 남는다 */
export type DungeonEvent =
  | { type: 'hit'; finish: boolean }
  | { type: 'pop'; kind: Kind }
  | { type: 'hurt' }
  | { type: 'loot'; coin: boolean }
  | { type: 'full' }
  | { type: 'skill'; sound: SkillSound }
  | { type: 'bone' }
  | { type: 'snack'; heal: number }
  | { type: 'level' }
  | { type: 'wave'; i: number; clear: boolean }
  | { type: 'spawn'; elite: boolean }
  | { type: 'result'; win: boolean };
/** 이번 판 기록 (결과창): 싸운 시간 · 쓰러뜨린 수 · 정예 · 주운 냥코인 · 얻은 아이템 · 준 피해 · 받은 피해 */
export type RunStats = { t: number; kills: number; elites: number; coins: number; items: Record<string, number>; dealt: number; taken: number };
/** 결과창 — win = 모든 웨이브 클리어, 아니면 낮잠 */
export type Result = { win: boolean };
/** 결과창이 뜨기까지: 클리어면 떨어진 게 다 날아온 뒤(최소 END_WIN, 길어도 END_WIN_MAX) · 낮잠이면 END_NAP 초 */
const END_WIN = 1;
const END_WIN_MAX = 2.5;
const END_NAP = 1.2;
/** 나가는 칸(노란 매트)에 이만큼 서 있어야 나간다 (초) — 밟자마자 나가지 않게. 벗어나면 처음부터 */
export const EXIT_DWELL = 3;
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
    /** 이번 냥펀치를 겨눈 쪽 (움직이는 쪽과 따로 — 물러나면서 때려도 맞는다) */
    aimX: 0,
    aimZ: 1,
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
  /** 가방 — main 과 같은 것을 쓴다 (주운 게 바로 들어간다) */
  bag: Bag;
  loot: Loot[];
  bones: Bone[];
  toasts: Toast[];
  /** 기술 · 레벨 (방마다 새로) */
  run: Run;
  host: SkillHost;
  /** 웨이브 (classic 이면 없음 — 방의 spawns 만, 생선뼈·기술 없이: 전투 기본 체크용) */
  wave: Wave | null;
  classic: boolean;
  /** 레벨 업 카드 — 있는 동안 멈춘다 */
  choose: Card[] | null;
  /** 자동 냥펀치 (끄면 punch 입력으로만 — 기본 전투 체크용) */
  auto: boolean;
  /** 이번 판 기록 · 결과창 (있는 동안 멈춘다) · 끝난 뒤 시간 */
  stats: RunStats;
  result: Result | null;
  endT: number;
  /** 나가는 칸에 서 있은 시간 (EXIT_DWELL 이 되면 나간다) */
  exitT: number;
};

/** 장비·먹은 것까지 더한 최대 체력 */
export const maxHp = (d: Dungeon) => player.maxHp + stats(d.bag).hp;

const tile = (tx: number, tz: number) => ({ x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });

const addFx = (d: Dungeon, x: number, z: number, id: FxId, size: number) =>
  d.fxs.push({ x, z, id, t: 0, size, rot: Math.random() * Math.PI * 2 });
const addPop = (d: Dungeon, x: number, z: number, n: number, hurt = false, h = 150, style?: Pop['style']) =>
  d.pops.push({ x, z, text: String(n), t: 0, dx: (Math.random() - 0.5) * 40, hurt, h, style });
const shakeBy = (d: Dungeon, v: number) => {
  d.shake = Math.max(d.shake, v);
};

/** sheets: 몬스터 종류별 스프라이트 시트 (몬스터가 들고 다닌다. node 체크에선 아무 값이나). classic = 웨이브·기술 없이, auto = 자동 냥펀치 (기본 켬) */
export function makeDungeon(sheets: Record<Kind, Sheet>, roomId = 'alley', bag: Bag = makeBag(), opt: { classic?: boolean; auto?: boolean } = {}): Dungeon {
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
    bag,
    loot: [],
    bones: [],
    toasts: [],
    classic: !!opt.classic,
    choose: null,
    auto: opt.auto ?? true,
  } as unknown as Dungeon;
  d.world = {
    px: 0,
    pz: 0,
    grid: d.room.grid,
    hitPlayer: (dmg, fx, fz) => hitPlayer(d, dmg, fx, fz),
    spawnArrow: (x, z, dx, dz, speed, dmg) => d.arrows.push({ x, z, dx, dz, speed, dmg, life: 3 }),
  };
  d.host = {
    P: d.P,
    get enemies() {
      return d.enemies;
    },
    hit: (e, dmg, fx, fz, push = 4, crit = false) => {
      strike(d, e, dmg, fx, fz, crit ? 'crit' : 'skill', push);
    },
    soak: (e, dmg) => {
      if (e.state !== 'pop') e.dotAcc += dmg;
    },
    sound: (sound) => d.events.push({ type: 'skill', sound }),
    move: (x, z, r) => resolveCircle(d.room.grid, x, z, r),
    rng: Math.random,
  };
  resetDungeon(d);
  return d;
}

/** 방에 새로 들어온 상태로 — 방 가운데에 서고, 몬스터를 다시 배치한다 (웨이브 1). 기술·레벨도 처음부터. roomId 를 주면 그 방으로 옮긴다 */
export function resetDungeon(d: Dungeon, roomId = d.room.id) {
  d.room = room(roomId);
  d.world.grid = d.room.grid;
  const c = tile(Math.floor(d.room.gridW / 2), Math.floor(d.room.gridH / 2));
  Object.assign(d.P, makePlayer(), { x: c.x, z: c.z, hp: maxHp(d) });
  d.loot = [];
  d.bones = [];
  d.toasts = [];
  d.enemies = d.room.def.spawns.map(([k, tx, tz]) => {
    const p = tile(tx as number, tz as number);
    const e = makeEnemy(k as Kind, d.sheets[k as Kind], p.x, p.z);
    return d.classic ? e : waveScale(e, 0); // 방에 서 있던 몬스터도 웨이브 1 배율
  });
  d.arrows = [];
  d.pops = [];
  d.fxs = [];
  d.shake = 0;
  d.phase = 'playing';
  d.events = [];
  d.run = makeRun();
  d.choose = null;
  d.stats = { t: 0, kills: 0, elites: 0, coins: 0, items: {}, dealt: 0, taken: 0 };
  d.result = null;
  d.endT = 0;
  d.exitT = 0;
  d.wave = d.classic ? null : { i: 0, total: WAVES.counts.length, state: 'intro', t: 0, queue: waveKinds(d.room, WAVES.counts[0] - d.enemies.length, WAVES.elites[0] ?? 0), marks: [], spawnT: 0 };
}

/**
 * 웨이브 몬스터 n 마리: 방 spawns 순서를 되풀이 (방마다 비율 그대로), 원거리는 rangedMax 비율까지만, 섞어서.
 * 정예 elites 마리를 웨이브 중간쯤에 끼운다 (근접 중 체력이 가장 큰 종 — 하나면 40%, 둘이면 35% · 75% 자리).
 */
export function waveKinds(r: Room, n: number, elites: number, rng: () => number = Math.random) {
  const pool = r.def.spawns.map(([k]) => k as Kind);
  const ranged = (k: Kind) => ENEMY_DEFS[k].arrowSpeed > 0;
  const maxR = Math.floor(n * WAVES.rangedMax);
  const out: { kind: Kind; elite: boolean }[] = [];
  let nr = 0;
  for (let i = 0; out.length < n && i < n * 4; i++) {
    const k = pool[i % pool.length];
    if (ranged(k) && nr >= maxR) continue;
    if (ranged(k)) nr++;
    out.push({ kind: k, elite: false });
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  if (elites > 0) {
    // 정예는 웨이브 중간쯤 — 안내가 뜨고 너무 늦게 나오지 않게
    const melee = pool.filter((k) => !ranged(k));
    const best = (melee.length ? melee : pool).reduce((a, b) => (ENEMY_DEFS[b].hp > ENEMY_DEFS[a].hp ? b : a));
    const n0 = out.length;
    for (let j = elites - 1; j >= 0; j--) {
      const at = elites === 1 ? 0.4 : 0.35 + (0.4 * j) / (elites - 1);
      out.splice(Math.floor(n0 * at), 0, { kind: best, elite: true });
    }
  }
  return out;
}

/** 웨이브가 갈수록 세다 — 웨이브 i 의 체력·공격 배율을 건다 (waves.json hp · damage) */
function waveScale(e: Enemy, i: number) {
  const hk = WAVES.hp[i] ?? 1;
  const dk = WAVES.damage[i] ?? 1;
  if (hk !== 1 || dk !== 1) e.def = { ...e.def, hp: Math.max(1, Math.round(e.def.hp * hk)), damage: Math.max(1, Math.round(e.def.damage * dk)) };
  e.hp = e.def.hp;
  return e;
}

/** 웨이브를 건너뛴다 (검증용 — 마지막 웨이브를 깬 것으로) */
export function skipWaves(d: Dungeon) {
  if (!d.wave) return;
  Object.assign(d.wave, { i: d.wave.total - 1, state: 'fight', queue: [], marks: [] });
}

/** 몬스터가 나올 자리: 고양이와 minDist 밖, 막히지 않은 칸 — 가장자리 칸(옆이 벽·바깥)을 먼저 */
function spawnPoint(d: Dungeon) {
  const r = d.room;
  const open = (x: number, z: number) => x >= 0 && z >= 0 && x < r.gridW && z < r.gridH && !r.grid.solid[z * r.gridW + x];
  const exit = (x: number, z: number) => r.exits.some(([ex, ez]) => ex === x && ez === z);
  const far: { x: number; z: number; edge: boolean }[] = [];
  for (let z = 0; z < r.gridH; z++)
    for (let x = 0; x < r.gridW; x++) {
      if (!open(x, z) || exit(x, z)) continue;
      const c = tile(x, z);
      if (Math.hypot(c.x - d.P.x, c.z - d.P.z) < WAVES.minDist) continue;
      far.push({ ...c, edge: !open(x + 1, z) || !open(x - 1, z) || !open(x, z + 1) || !open(x, z - 1) });
    }
  const edge = far.filter((p) => p.edge);
  const list = edge.length ? edge : far;
  const p = list.length ? list[Math.floor(Math.random() * list.length)] : tile(0, 0);
  return resolveCircle(r.grid, p.x + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8, 0.4);
}

/** 웨이브 진행: 안내 → 가장자리에서 예고 뒤 등장 (살아 있는 수는 maxAlive 까지) → 다 쓰러뜨리면 쉬고 다음 웨이브 → 마지막이면 방 클리어 */
function updateWave(d: Dungeon, dt: number) {
  const W = d.wave!;
  W.t += dt;
  const alive = d.enemies.filter((e) => e.state !== 'pop').length;
  if (W.state === 'intro') {
    if (W.t >= WAVES.intro) {
      W.state = 'fight';
      W.t = 0;
    }
  } else if (W.state === 'fight') {
    W.spawnT -= dt;
    if (W.queue.length && W.spawnT <= 0 && alive + W.marks.length < WAVES.maxAlive) {
      const q = W.queue.shift()!;
      W.marks.push({ ...q, ...spawnPoint(d), t: 0 });
      W.spawnT = WAVES.spawnGap;
    }
    for (const m of W.marks) {
      m.t += dt;
      if (m.t < WAVES.telegraph) continue;
      const e = waveScale(makeEnemy(m.kind, d.sheets[m.kind], m.x, m.z), W.i);
      if (m.elite) {
        const E = WAVES.elite;
        e.def = { ...e.def, hp: Math.round(e.def.hp * E.hp), damage: Math.round(e.def.damage * E.damage), size: Math.round(e.def.size * E.size), speed: e.def.speed * E.speed, name: `${E.name} ${e.def.name}` };
        e.hp = e.def.hp;
        e.elite = true;
      }
      d.enemies.push(e);
      addFx(d, m.x, m.z, 'pirate_smoke', m.elite ? 340 : 240);
      d.events.push({ type: 'spawn', elite: m.elite });
    }
    W.marks = W.marks.filter((m) => m.t < WAVES.telegraph);
    if (!W.queue.length && !W.marks.length && alive === 0) {
      d.events.push({ type: 'wave', i: W.i, clear: true });
      if (W.i + 1 < W.total) {
        W.state = 'break';
        W.t = 0;
      } else {
        W.state = 'done';
        d.phase = 'cleared';
      }
    }
  } else if (W.state === 'break' && W.t >= WAVES.break) {
    W.i++;
    W.state = 'intro';
    W.t = 0;
    W.queue = waveKinds(d.room, WAVES.counts[W.i], WAVES.elites[W.i] ?? 0);
    d.events.push({ type: 'wave', i: W.i, clear: false });
  }
}

export function hitPlayer(d: Dungeon, dmg: number, fx: number, fz: number) {
  const P = d.P;
  if (d.phase !== 'playing' || P.invT > 0 || P.dashT > 0) return; // 구르기 중 무적
  if (absorbHit(d.run, d.host)) {
    // 식빵 보호막이 막았다 — 잠깐 무적, 하악은 그대로
    P.invT = 0.5;
    onHurt(d.run, d.host);
    return;
  }
  dmg = Math.max(1, dmg - stats(d.bag).def); // 방어만큼 덜 아프다 (최소 1)
  d.stats.taken += Math.min(dmg, Math.max(0, P.hp));
  P.hp -= dmg;
  P.hurtT = 0.3;
  addPop(d, P.x, P.z, dmg, true, player.size);
  addFx(d, P.x, P.z, 'slash', 263);
  d.events.push({ type: 'hurt' });
  if (dmg >= SHAKE_HURT_MIN_DMG) shakeBy(d, SHAKE_HURT); // 아픈 공격만
  const dist = Math.hypot(P.x - fx, P.z - fz) || 1;
  P.kx = ((P.x - fx) / dist) * 4;
  P.kz = ((P.z - fz) / dist) * 4;
  onHurt(d.run, d.host);
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
    P.hp = maxHp(d) * player.reviveHp;
    P.invT = player.reviveIframe;
  }
}

/**
 * 몬스터를 때린다 (냥펀치 · 기술 공통): 피해 숫자 · 이펙트 · 쓰러지면 뿅 · 드롭 · 생선뼈. 쓰러뜨렸으면 true.
 * how: punch(움찔·불꽃) · skill · crit(큰 숫자) · dot(계속 피해 — 움찔·밀림 없음, 숫자는 모아서 따로)
 */
export function strike(d: Dungeon, e: Enemy, dmg: number, fromX: number, fromZ: number, how: 'punch' | 'skill' | 'crit' | 'dot' = 'skill', push = 4) {
  if (e.state === 'pop' || dmg <= 0) return false;
  dmg = Math.round(dmg);
  d.stats.dealt += Math.min(dmg, Math.max(0, e.hp));
  damageEnemy(e, dmg, fromX, fromZ, how === 'dot' ? 0 : push, how !== 'dot');
  if (how !== 'dot') addPop(d, e.x, e.z, dmg, false, e.def.size, how === 'punch' ? undefined : how);
  const down = (e.state as string) === 'pop'; // damageEnemy 가 바꾼다
  if (down) {
    d.stats.kills++;
    if (e.elite) d.stats.elites++;
    addFx(d, e.x, e.z, (d.room.def.popFx as FxId) ?? 'burst', e.elite ? 480 : 333);
    d.events.push({ type: 'pop', kind: e.kind });
    dropLoot(d, e);
    dropBones(d, e);
    if (e.elite) shakeBy(d, SHAKE_FINISH);
  } else if (how === 'punch') addFx(d, e.x, e.z, 'spark', 219);
  return down;
}

/** 계속 피해(구름·불꽃·점·따끔)를 모아 1 이 넘을 때마다 깎고, 숫자는 0.45초마다 모아서 띄운다 */
function flushDots(d: Dungeon, dt: number) {
  for (const e of d.enemies) {
    if (e.state === 'pop') continue;
    if (e.dotAcc >= 1) {
      const n = Math.floor(e.dotAcc);
      e.dotAcc -= n;
      e.dotShow += n;
      strike(d, e, n, e.x, e.z, 'dot');
    }
    e.dotT += dt;
    if (e.dotShow > 0 && (e.dotT >= 0.45 || (e.state as string) === 'pop')) {
      addPop(d, e.x, e.z, e.dotShow, false, e.def.size, 'dot');
      e.dotShow = 0;
      e.dotT = 0;
    }
  }
}

/** 쓰러진 몬스터가 냥코인·아이템을 흩뿌린다 */
function dropLoot(d: Dungeon, e: Enemy) {
  const r = rollDrops(e.kind, e.def.hp, stats(d.bag).luck);
  const out = [...(r.coins ? [{ id: 'coin', n: r.coins }] : []), ...r.items.map((id) => ({ id, n: 1 }))];
  out.forEach((o, i) => {
    const a = Math.random() * Math.PI * 2;
    const v = 1.2 + i * 0.5;
    d.loot.push({ ...o, x: e.x, z: e.z, h: 0.4, vh: 3.2, vx: Math.cos(a) * v, vz: Math.sin(a) * v, t: 0 });
  });
}

/**
 * 생선뼈: 체력 perHp 마다 1개 (정예는 큰 뼈 — 값 3). 가끔(정예는 늘) 생선 비스킷.
 * 초반 웨이브는 체력을 낮춰도(배율 < 1) 그 종 원래 체력만큼은 준다 — 쉽게 잡히는 만큼 경험치가 줄면 첫 기술이 늦게 나온다
 */
function dropBones(d: Dungeon, e: Enemy) {
  if (d.classic) return;
  const big = e.elite;
  const n = big ? Math.ceil(WAVES.elite.bones / 3) : Math.max(1, Math.round(Math.max(e.def.hp, ENEMY_DEFS[e.kind].hp) / XP.perHp));
  const toss = (extra: Partial<Bone>) => {
    const a = Math.random() * Math.PI * 2;
    const v = 0.8 + Math.random() * 1.6;
    d.bones.push({ x: e.x, z: e.z, h: 0.3, vh: 2.6 + Math.random(), vx: Math.cos(a) * v, vz: Math.sin(a) * v, t: 0, v: 0, ...extra });
  };
  for (let i = 0; i < n; i++) toss({ v: big ? 3 : 1 });
  if (big || Math.random() < SNACK.chance) toss({ snack: true });
}

/** 줍기: 가방에 넣고 알림. 못 넣은 만큼 남긴다 */
function take(d: Dungeon, l: Loot) {
  const left = l.id === 'coin' ? ((d.bag.coins += l.n), 0) : obtain(d.bag, l.id, l.n);
  const got = l.n - left;
  if (got > 0) {
    if (l.id === 'coin') d.stats.coins += got;
    else d.stats.items[l.id] = (d.stats.items[l.id] ?? 0) + got;
    const last = d.toasts[d.toasts.length - 1];
    if (last && last.id === l.id && last.t < 0.8) last.n += got;
    else d.toasts.push({ id: l.id, n: got, t: 0 });
    d.events.push({ type: 'loot', coin: l.id === 'coin' });
  }
  if (left > 0) {
    bagFull(d);
    // 못 넣은 건 그 자리에 멈춘다 — 빨려 오던 속도가 남으면 고양이를 지나쳐 미끄러져 나간다 (2026-10-06 "모자를 먹으러 가면 날아간다")
    l.vx = 0;
    l.vz = 0;
  }
  l.n = left;
}

/** 가방이 가득 — 알림(소리)은 떠 있는 동안 한 번 */
function bagFull(d: Dungeon) {
  if (d.toasts.some((q) => q.id === 'full')) return;
  d.toasts.push({ id: 'full', n: 0, t: 0 });
  d.events.push({ type: 'full' });
}

/** 튀어 오르고 미끄러지다 멈춘다. 가까우면(또는 pull 이면 어디서든) 고양이에게 빨려 온다 — 닿으면 true */
function fly(d: Dungeon, l: { x: number; z: number; h: number; vh: number; vx: number; vz: number; t: number }, dt: number, magnet: number, pull: boolean, wait = 0.45) {
  const P = d.P;
  l.t += dt;
  l.vh -= 14 * dt;
  l.h += l.vh * dt;
  if (l.h < 0) {
    l.h = 0;
    l.vh = Math.abs(l.vh) > 1.5 ? -l.vh * 0.35 : 0;
  }
  const dist = Math.hypot(P.x - l.x, P.z - l.z);
  let got = false;
  if (l.t > wait && (dist < magnet || pull)) {
    const sp = Math.min(dist / dt, 9 + (magnet / Math.max(dist, 0.3)) * 2);
    l.vx = ((P.x - l.x) / (dist || 1)) * sp;
    l.vz = ((P.z - l.z) / (dist || 1)) * sp;
    got = dist < 0.45;
  } else {
    const f = Math.exp(-3 * dt);
    l.vx *= f;
    l.vz *= f;
  }
  const p = resolveCircle(d.room.grid, l.x + l.vx * dt, l.z + l.vz * dt, 0.15);
  l.x = p.x;
  l.z = p.z;
  return got;
}

/** 떨어진 것: 냥코인·아이템은 가방에 (방을 깨면 어디서든 날아온다). 가방에 자리가 없는 건 빨려 오지 않고 그 자리에 — 밟으면 가득 알림, 자리가 나면 줍는다 */
function updateLoot(d: Dungeon, dt: number) {
  for (const l of d.loot) {
    l.full = l.id !== 'coin' && bagRoom(d.bag, l.id) <= 0;
    if (!l.full) {
      if (fly(d, l, dt, MAGNET, d.phase === 'cleared')) take(d, l);
      continue;
    }
    fly(d, l, dt, 0, false);
    const near = Math.hypot(d.P.x - l.x, d.P.z - l.z) < 0.7;
    if (near && !l.near) bagFull(d);
    l.near = near;
  }
  d.loot = d.loot.filter((l) => l.n > 0);
  for (const q of d.toasts) q.t += dt;
  d.toasts = d.toasts.filter((q) => q.t < TOAST_LIFE).slice(-5);
}

/** 생선뼈: 경험치로 (웨이브를 깨면 어디서든 날아온다). 레벨이 오르면 빛기둥 */
function updateBones(d: Dungeon, dt: number) {
  const pull = d.phase === 'cleared' || (!!d.wave && (d.wave.state === 'break' || d.wave.state === 'done'));
  const keep: Bone[] = [];
  let ate = 0;
  for (const b of d.bones) {
    if (!fly(d, b, dt, XP.magnet, pull, 0.3)) {
      keep.push(b);
      continue;
    }
    if (b.snack) {
      const heal = Math.min(SNACK.heal, maxHp(d) - d.P.hp);
      d.P.hp += heal;
      d.events.push({ type: 'snack', heal: SNACK.heal });
      addSkillFx(d.run, 'fishbone_pickup', d.P.x, d.P.z, { h: 1.1, size: 1.2 });
      continue;
    }
    ate++;
    if (gainXp(d.run, b.v)) {
      d.events.push({ type: 'level' });
      addSkillFx(d.run, 'level_up', d.P.x, d.P.z, { size: 2.4 });
    }
  }
  d.bones = keep;
  if (ate) {
    d.events.push({ type: 'bone' });
    if (!d.run.fx.some((f) => f.anim === 'fishbone_pickup' && f.t < 0.15)) addSkillFx(d.run, 'fishbone_pickup', d.P.x, d.P.z, { h: 1.1, size: 1 });
  }
}

/** 카드를 고른다 (i = 0..). 새 기술이면 배우고, 레벨이면 올린다. 남은 레벨 업이 있으면 다음 프레임에 또 뜬다 */
export function pick(d: Dungeon, i: number) {
  const c = d.choose?.[i];
  if (!c) return false;
  if (c.id === 'heal') d.P.hp = Math.min(maxHp(d), d.P.hp + 30);
  else learn(d.run, c.id, d.P);
  d.run.pending = Math.max(0, d.run.pending - 1);
  d.choose = null;
  return true;
}

const onExit = (r: Room, x: number, z: number) =>
  r.exits.some(([tx, tz]) => tx === Math.floor(x / CELL) && tz === Math.floor(z / CELL));

/** 한 프레임 진행. 나가는 곳(노란 매트)에 EXIT_DWELL 초 서 있었으면 'exit'. 카드를 고르는 동안 · 결과창이 떠 있으면 멈춘다 */
export function updateDungeon(d: Dungeon, input: DungeonInput, dt: number): 'exit' | null {
  const P = d.P;
  d.events.length = 0;
  if (d.choose || d.result) return null;
  P.animT += dt;
  if (d.phase === 'playing') d.stats.t += dt;
  P.dashCd = Math.max(0, P.dashCd - dt);
  P.invT = Math.max(0, P.invT - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);

  // 화면 기준 입력을 아이소메트릭 축으로 45도 돌린다
  let { mx, my } = input;
  const len = Math.hypot(mx, my);
  P.moving = len > 0;
  // 낮잠(목숨 소진)일 때만 못 움직인다. 클리어한 뒤엔 걸어서 나가야 한다
  const alive = d.phase !== 'napped';
  if (len > 0 && alive) {
    mx /= len;
    my /= len;
    P.faceX = (mx + my) * Math.SQRT1_2;
    P.faceZ = (my - mx) * Math.SQRT1_2;
    if (mx !== 0 && P.punchT <= 0) P.flip = Math.sign(mx); // 때리는 동안은 맞는 쪽을 본다
  }

  const { dash, punch } = player;
  const reach = punch.range + punchReach(d.run);
  // 냥펀치: 자동 — 타격 범위(reach) 안에 몬스터가 있으면 저절로 (구르는 중·낮잠엔 안 함). punch 입력은 손으로 (체크용)
  const ready = alive && P.punchT <= 0 && P.dashT <= 0;
  const aim = ready ? aimAt(d.enemies, P.x, P.z, reach) : null;
  if (ready && (input.punch || (d.auto && aim))) {
    P.aimX = aim ? aim.x : P.faceX;
    P.aimZ = aim ? aim.z : P.faceZ;
    if (aim) P.flip = aim.x - aim.z >= 0 ? 1 : -1; // 아이소메트릭에선 x-z 가 화면 좌우
    P.punchT = punch.time;
    P.punchHit = false;
    P.animT = 0;
  }

  if (alive && input.dash && P.dashT <= 0 && P.dashCd <= 0) {
    // 움직이는 쪽으로 구른다 (face 는 움직임만 바꾼다 — 자동 냥펀치가 몬스터 쪽을 겨눠도 피하는 쪽으로)
    P.dashX = P.faceX;
    P.dashZ = P.faceZ;
    P.dashT = dash.time;
    P.dashCd = dash.time + dash.cooldown * (1 - dashCut(d.run));
    P.punchT = 0;
  }

  // 냥펀치 판정: 전방 부채꼴 안의 적 전부
  if (P.punchT > 0) {
    P.punchT -= dt;
    if (!P.punchHit && punch.time - P.punchT >= punch.hitAt) {
      P.punchHit = true;
      // 맞히는 순간 다시 겨눈다 (휘두르는 0.1초 사이에 몬스터도 고양이도 움직였다)
      const re = aimAt(d.enemies, P.x, P.z, reach);
      if (re) {
        P.aimX = re.x;
        P.aimZ = re.z;
      }
      const targets = punchTargets(d.enemies, P.x, P.z, P.aimX, P.aimZ, reach, PUNCH_ARC);
      const dmg = punch.damage + stats(d.bag).atk + punchBonus(d.run);
      let finish = false;
      for (const e of targets) if (strike(d, e, dmg, P.x, P.z, 'punch')) finish = true;
      if (targets.length) d.events.push({ type: 'hit', finish });
      if (finish) shakeBy(d, SHAKE_FINISH);
      onPunch(d.run, d.host, targets, P.aimX, P.aimZ);
    }
  }

  let vx = 0;
  let vz = 0;
  if (alive) {
    const slow = (P.punchT > 0 ? punch.moveSlow : 1) * Math.max(0.5, 1 + stats(d.bag).speed / 100);
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
  // 나가는 칸: EXIT_DWELL 초 서 있어야 나간다 (벗어나면 처음부터 — 싸우다 도망치려면 버텨야 한다)
  const onMat = d.phase !== 'napped' && onExit(d.room, P.x, P.z);
  d.exitT = onMat ? d.exitT + dt : 0;
  const leave = d.exitT >= EXIT_DWELL;

  if (alive && !d.classic) tickSkills(d.run, d.host, dt);
  else {
    for (const f of d.run.fx) f.t += dt;
    d.run.links = [];
  }
  flushDots(d, dt);

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
  P.hp = Math.min(P.hp, maxHp(d)); // 체력 장비를 벗으면

  if (d.wave) {
    if (d.phase === 'playing') updateWave(d, dt);
  } else if (d.phase === 'playing' && d.enemies.length === 0) d.phase = 'cleared';
  updateLoot(d, dt);
  updateBones(d, dt);
  if (leave) for (const l of d.loot) take(d, l); // 나가면서 남은 것도 챙긴다
  // 결과창: 모든 웨이브를 깨고 떨어진 게 다 날아오면(레벨 업 카드를 다 고른 뒤) · 낮잠이면 잠깐 뒤
  // 이긴 판은 웨이브가 다 끝났을 때만 (웨이브 없는 시험 무대에서 몬스터가 없다고 뜨지 않게)
  const over = (d.phase === 'cleared' && d.wave?.state === 'done') || d.phase === 'napped';
  if (!d.classic && over && !d.result && !leave) {
    d.endT += dt;
    const win = d.phase === 'cleared';
    const ready = win ? (d.endT > END_WIN && !d.loot.length && !d.bones.length && !d.run.pending) || d.endT > END_WIN_MAX : d.endT > END_NAP;
    if (ready && !d.run.pending) {
      d.result = { win };
      d.events.push({ type: 'result', win });
    }
  }
  // 레벨이 올랐으면 카드를 띄우고 멈춘다 (낮잠이면 안 띄운다)
  if (d.run.pending > 0 && d.phase !== 'napped' && !leave) d.choose = rollCards(d.run);
  return leave ? 'exit' : null;
}
