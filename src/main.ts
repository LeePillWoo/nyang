import bowUrl from './assets/rat-bow.webp';
import fatUrl from './assets/rat-fat.webp';
import roomUrl from './assets/room-alley.webp';
import swordUrl from './assets/rat-sword.webp';
import { sfxChop, sfxHit, sfxHurt, sfxPop, sfxRow, sfxSplash, unlockAudio } from './audio.ts';
import { CAT_FPS, CAT_ROW, loadAxe, loadBoat, loadCat } from './cat.ts';
import { CELL, resolveCircle } from './collide.ts';
import {
  aimAt,
  assignSides,
  damageEnemy,
  enemyFrame,
  makeEnemy,
  punchTargets,
  separate,
  updateEnemy,
  type Enemy,
  type Kind,
  type World,
} from './enemy.ts';
import { drawField, fieldFx, fieldReady, fieldView, terrainAt, terrainReady } from './field-draw.ts';
import { backFrom, FIELD, makeFieldState, updateField, type FieldEvent, type FieldState } from './field.ts';
import { drawFx, FX_LIFE, FX_ROW, fxReady, type Fx } from './fx.ts';
import { BG_H, BG_W, exits, GRID_H, GRID_W, grid, toScreen } from './iso.ts';
import { drawFrame, loadSheet, type Sheet } from './sheet.ts';

// GDD 5장 스탯
const SPEED = 5;
const RADIUS = 0.45;
const DASH_DIST = 3;
const DASH_TIME = 0.2;
const DASH_CD = 0.5;
const MAX_HP = 100;
const START_LIVES = 3;
const PUNCH_DMG = 10;
const PUNCH_RANGE = 1.7;
const PUNCH_ARC = Math.PI * 0.7;
const PUNCH_TIME = 0.28;
const PUNCH_HIT = 0.1; // 시작 후 판정까지
const HIT_IFRAME = 0.8;
const REVIVE_IFRAME = 1.5;
const CAT_PX = 190;
const COLS = 6;

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
document.body.appendChild(canvas);

const room = new Image();
const roomReady = new Promise<void>((ok) => {
  room.onload = () => ok();
});
room.src = roomUrl;

let scale = 1;
let ox = 0;
let oy = 0;
function layout() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
  scale = Math.min(canvas.width / BG_W, canvas.height / BG_H);
  ox = (canvas.width - BG_W * scale) / 2;
  oy = (canvas.height - BG_H * scale) / 2;
}
layout();
addEventListener('resize', layout);

const keys = new Set<string>();
let debug = location.search.includes('grid');
let showTerrain = location.search.includes('terrain'); // 필드 지형 보기 (T 키)

// ?trace — tools/verify.mjs 가 쓴다. 프레임마다 실제로 그린 사각형을 남겨 튐·사라짐을 잡는다.
const trace: Record<string, unknown>[] | null = location.search.includes('trace') ? [] : null;
if (trace) Object.assign(window, { __trace: trace });
function traceDraw(who: string, sh: Sheet, row: number, col: number, sx: number, sy: number, size: number, flip: number, rs: number, extra: object) {
  if (!trace) return;
  const r = sh.frames[row] ?? [];
  const f = r[Math.min(col, r.length - 1)];
  if (!f) return;
  const k = (size / sh.base) * rs;
  const a = sx + flip * f.ox * k;
  const b = sx + flip * (f.ox + f.sw) * k;
  trace.push({ t: performance.now(), who, row, col, clamped: col >= r.length, flip, sx, sy, left: Math.min(a, b), right: Math.max(a, b), alpha: ctx.globalAlpha, ...extra });
}
let punchQueued = false;
addEventListener('keydown', (e) => {
  unlockAudio();
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyG') debug = !debug;
  if (e.code === 'KeyT') showTerrain = !showTerrain;
  if (e.code === 'KeyJ') punchQueued = true;
  if (e.code === 'KeyR' && scene === 'dungeon') {
    if (phase === 'napped') leaveDungeon(); // GDD: 목숨을 다 쓰면 마을에서 깨어난다
    else reset();
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', () => {
  unlockAudio();
  punchQueued = true;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const held = (...codes: string[]) => codes.some((c) => keys.has(c));
/** 화면 기준 방향 입력 -1..1 */
const input = () => ({
  mx: (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0),
  my: (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0),
});
const tile = (tx: number, tz: number) => ({ x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });

type Pop = { x: number; z: number; text: string; t: number; dx: number; hurt: boolean; h: number };
const POP_LIFE = 0.85;

type Arrow = {
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  dmg: number;
  life: number;
};

const P = {
  x: 0,
  z: 0,
  hp: MAX_HP,
  lives: START_LIVES,
  faceX: 0,
  faceZ: 1,
  flip: 1,
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
  dispScale: 1,
};

let enemies: Enemy[] = [];
let arrows: Arrow[] = [];
let pops: Pop[] = [];
let fxs: Fx[] = [];
let shake = 0;
const addFx = (x: number, z: number, row: number, size: number) =>
  fxs.push({ x, z, row, t: 0, size, rot: Math.random() * Math.PI * 2 });
/** 화면 흔들기. 모든 타격이 아니라 마무리 일격·아픈 피격에만 (멀미 방지) */
const shakeBy = (v: number) => {
  shake = Math.max(shake, v);
};
const addPop = (x: number, z: number, n: number, hurt = false, h = 150) =>
  pops.push({ x, z, text: String(n), t: 0, dx: (Math.random() - 0.5) * 40, hurt, h });
let phase: 'playing' | 'cleared' | 'napped' = 'playing';
const sheets = {} as Record<Kind, Sheet>;
let catSheet: Sheet;

// 장면: 필드(시작) ↔ 던전. ?dungeon 이면 던전에서 바로 시작한다 (검증용)
let scene: 'field' | 'dungeon' = location.search.includes('dungeon') ? 'dungeon' : 'field';
let field: FieldState = makeFieldState(FIELD.start);
let roomId = 'alley'; // 지금 들어가 있는 던전
let axeSheet: Sheet;
let boatSheet: Sheet;
if (trace)
  Object.assign(window, {
    __game: {
      get scene() { return scene; },
      get field() { return field; },
      get cat() { return { x: P.x, z: P.z }; },
      terrain: terrainAt,
      /** 필드 고양이의 화면 위치 (CSS px) */
      get catScreen() {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fieldView.ox + field.x * fieldView.sc) / d, y: (fieldView.oy + field.y * fieldView.sc) / d };
      },
    },
  });

/** 필드 연출 사건 → 소리 */
function fieldSound(e: FieldEvent) {
  if (e.type === 'chop') sfxChop();
  else if (e.type === 'splash') sfxSplash();
  else if (e.type === 'stroke') sfxRow();
}

// 장면 전환: 크림색으로 덮은 순간 장면을 바꾸고 다시 걷어낸다
const FADE = 0.28;
let fade = 0;
let fadeTo: (() => void) | null = null;
const goTo = (swap: () => void) => {
  if (!fadeTo && fade === 0) fadeTo = swap;
};
const enterDungeon = (to: string) =>
  goTo(() => {
    scene = 'dungeon';
    roomId = to;
    reset();
    sayHelp();
  });
const leaveDungeon = () =>
  goTo(() => {
    scene = 'field';
    field = makeFieldState(backFrom(roomId), terrainAt);
    sayHelp();
  });
const onExit = (x: number, z: number) =>
  exits.some(([tx, tz]) => tx === Math.floor(x / CELL) && tz === Math.floor(z / CELL));

const SPAWNS: [Kind, number, number][] = [
  ['sword', 2, 2],
  ['bow', 7, 2],
  ['fat', 6, 6],
];

function reset() {
  const c = tile(Math.floor(GRID_W / 2), Math.floor(GRID_H / 2));
  P.x = c.x;
  P.z = c.z;
  P.hp = MAX_HP;
  P.lives = START_LIVES;
  P.dashT = 0;
  P.dashCd = 0;
  P.punchT = 0;
  P.invT = 0;
  P.hurtT = 0;
  P.kx = 0;
  P.kz = 0;
  P.dispScale = 1;
  enemies = SPAWNS.map(([k, tx, tz]) => {
    const p = tile(tx, tz);
    return makeEnemy(k, sheets[k], p.x, p.z);
  });
  arrows = [];
  pops = [];
  fxs = [];
  shake = 0;
  phase = 'playing';
}

function hitPlayer(dmg: number, fx: number, fz: number) {
  if (phase !== 'playing' || P.invT > 0 || P.dashT > 0) return; // 구르기 중 무적
  P.hp -= dmg;
  P.hurtT = 0.3;
  addPop(P.x, P.z, dmg, true, CAT_PX);
  addFx(P.x, P.z, FX_ROW.slash, 263);
  sfxHurt();
  if (dmg >= 12) shakeBy(15); // 아픈 공격만
  const d = Math.hypot(P.x - fx, P.z - fz) || 1;
  P.kx = ((P.x - fx) / d) * 4;
  P.kz = ((P.z - fz) / d) * 4;
  if (P.hp > 0) {
    P.invT = HIT_IFRAME;
    return;
  }
  // 목숨 하나 쓰고 그 자리에서 부활 (GDD 5장 아홉 목숨)
  P.lives -= 1;
  shakeBy(24);
  if (P.lives <= 0) {
    P.hp = 0;
    phase = 'napped';
  } else {
    P.hp = MAX_HP * 0.5;
    P.invT = REVIVE_IFRAME;
  }
}

const world: World = {
  px: 0,
  pz: 0,
  grid,
  hitPlayer,
  spawnArrow: (x, z, dx, dz, speed, dmg) => arrows.push({ x, z, dx, dz, speed, dmg, life: 3 }),
};

let last = performance.now();
let lastDt = 1 / 60; // 표시용 보간에 쓴다
let fps = 0;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  lastDt = dt;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;
  if (fadeTo) {
    fade = Math.min(1, fade + dt / FADE);
    if (fade >= 1) {
      fadeTo();
      fadeTo = null;
    }
  } else if (fade > 0) fade = Math.max(0, fade - dt / FADE);

  // 덮이는 동안은 멈춘다
  if (!fadeTo) {
    if (scene === 'field') {
      const { mx, my } = input();
      const w = updateField(field, mx, my, dt, terrainAt);
      field.events.forEach(fieldSound);
      fieldFx(field.events);
      if (w) enterDungeon(w.to);
      punchQueued = false;
    } else update(dt);
  }
  if (scene === 'field') drawFieldScene();
  else draw();
  drawFade();
  requestAnimationFrame(frame);
}

function update(dt: number) {
  P.animT += dt;
  P.dashCd = Math.max(0, P.dashCd - dt);
  P.invT = Math.max(0, P.invT - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);

  // 화면 기준 입력을 아이소메트릭 축으로 45도 돌린다
  let { mx, my } = input();
  const len = Math.hypot(mx, my);
  const alive = phase === 'playing';
  if (len > 0 && alive) {
    mx /= len;
    my /= len;
    P.faceX = (mx + my) * Math.SQRT1_2;
    P.faceZ = (my - mx) * Math.SQRT1_2;
    if (mx !== 0) P.flip = Math.sign(mx);
  }

  if (alive && punchQueued && P.punchT <= 0 && P.dashT <= 0) {
    const aim = aimAt(enemies, P.x, P.z, PUNCH_RANGE);
    if (aim) {
      P.faceX = aim.x;
      P.faceZ = aim.z;
      P.flip = aim.x - aim.z >= 0 ? 1 : -1; // 아이소메트릭에선 x-z 가 화면 좌우
    }
    P.punchT = PUNCH_TIME;
    P.punchHit = false;
    P.animT = 0;
  }
  punchQueued = false;

  if (alive && keys.has('Space') && P.dashT <= 0 && P.dashCd <= 0) {
    P.dashX = P.faceX;
    P.dashZ = P.faceZ;
    P.dashT = DASH_TIME;
    P.dashCd = DASH_TIME + DASH_CD;
    P.punchT = 0;
  }

  // 냥펀치 판정: 전방 부채꼴 안의 적 전부
  if (P.punchT > 0) {
    P.punchT -= dt;
    if (!P.punchHit && PUNCH_TIME - P.punchT >= PUNCH_HIT) {
      P.punchHit = true;
      const targets = punchTargets(enemies, P.x, P.z, P.faceX, P.faceZ, PUNCH_RANGE, PUNCH_ARC);
      let finish = false;
      for (const e of targets) {
        damageEnemy(e, PUNCH_DMG, P.x, P.z);
        addPop(e.x, e.z, PUNCH_DMG, false, e.def.size);
        const down = e.state === 'pop';
        addFx(e.x, e.z, down ? FX_ROW.burst : FX_ROW.spark, down ? 333 : 219);
        if (down) {
          finish = true;
          sfxPop();
        }
      }
      if (targets.length) sfxHit(finish);
      if (finish) shakeBy(9);
    }
  }

  let vx = 0;
  let vz = 0;
  if (alive) {
    const slow = P.punchT > 0 ? 0.4 : 1;
    vx = len > 0 ? (mx + my) * Math.SQRT1_2 * SPEED * slow : 0;
    vz = len > 0 ? (my - mx) * Math.SQRT1_2 * SPEED * slow : 0;
    if (P.dashT > 0) {
      P.dashT -= dt;
      vx = P.dashX * (DASH_DIST / DASH_TIME);
      vz = P.dashZ * (DASH_DIST / DASH_TIME);
    }
  }
  vx += P.kx;
  vz += P.kz;
  const decay = Math.exp(-10 * dt);
  P.kx *= decay;
  P.kz *= decay;

  const p = resolveCircle(grid, P.x + vx * dt, P.z + vz * dt, RADIUS);
  P.x = p.x;
  P.z = p.z;
  if (phase !== 'napped' && onExit(P.x, P.z)) leaveDungeon();

  world.px = P.x;
  world.pz = P.z;
  assignSides(enemies, P.x, P.z);
  for (const e of enemies) updateEnemy(e, dt, world);
  separate(enemies, P.x, P.z, grid);
  enemies = enemies.filter((e) => !(e.state === 'pop' && e.t > 0.6));

  for (const a of arrows) {
    a.life -= dt;
    a.x += a.dx * a.speed * dt;
    a.z += a.dz * a.speed * dt;
    const hit = resolveCircle(grid, a.x, a.z, 0.12);
    if (hit.x !== a.x || hit.z !== a.z) a.life = 0;
    if (Math.hypot(a.x - P.x, a.z - P.z) < RADIUS + 0.2) {
      hitPlayer(a.dmg, a.x, a.z);
      a.life = 0;
    }
  }
  arrows = arrows.filter((a) => a.life > 0);

  for (const q of pops) q.t += dt;
  pops = pops.filter((q) => q.t < POP_LIFE);

  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < FX_LIFE);
  shake = Math.max(0, shake - dt * 46);

  if (phase === 'playing' && enemies.length === 0) phase = 'cleared';
}

/** 모션이 바뀔 때 크기가 툭 튀지 않게 목표값으로 수렴시킨다 (약 0.1초) */
const ease = (cur: number, target: number) => cur + (target - cur) * (1 - Math.exp(-22 * lastDt));

function blob(sx: number, sy: number, r: number) {
  ctx.fillStyle = 'rgba(120, 85, 55, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const jx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
  const jy = shake > 0 ? (Math.random() - 0.5) * shake * 0.7 : 0;
  ctx.setTransform(scale, 0, 0, scale, ox + jx, oy + jy);
  ctx.drawImage(room, 0, 0, BG_W, BG_H);
  drawExits();

  // 공격 예고 데칼 — 색을 하나로 고정해 가독성 확보 (GDD 8장)
  for (const e of enemies) {
    if (e.state !== 'windup') continue;
    const { sx, sy } = toScreen(e.x, e.z);
    const t = Math.min(1, e.t / e.def.windup);
    const r = (e.def.arrowSpeed > 0 ? 0.9 : e.def.range) * 70;
    ctx.fillStyle = `rgba(232, 80, 70, ${0.15 + 0.25 * t})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * t, r * t * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  type Item = { sy: number; go: () => void };
  const items: Item[] = [];

  for (const e of enemies) {
    const { sx, sy } = toScreen(e.x, e.z);
    const f = enemyFrame(e, COLS);
    items.push({
      sy,
      go: () => {
        const popping = e.state === 'pop';
        ctx.save();
        if (popping) {
          ctx.globalAlpha = Math.max(0, 1 - e.t / 0.6);
          ctx.translate(0, -e.t * 40);
        } else {
          blob(sx, sy, e.def.size * 0.24);
        }
        e.dispScale = ease(e.dispScale, e.sheet.rowScale[f.row] ?? 1);
        traceDraw(e.kind, e.sheet, f.row, f.col, sx, sy, e.def.size, e.flip, e.dispScale, { state: e.state });
        drawFrame(ctx, e.sheet, f.row, f.col, sx, sy, e.def.size, e.flip, e.dispScale);
        ctx.restore();
        if (!popping) enemyHpBar(e, sx, sy);
      },
    });
  }

  const ps = toScreen(P.x, P.z);
  items.push({
    sy: ps.sy,
    go: () => {
      blob(ps.sx, ps.sy, CAT_PX * 0.28);
      const moving = held('KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight');
      const row =
        P.punchT > 0
          ? CAT_ROW.punch
          : P.hurtT > 0
            ? CAT_ROW.hurt
            : P.dashT > 0
              ? CAT_ROW.roll
              : moving
                ? CAT_ROW.run
                : CAT_ROW.idle;
      let col: number;
      if (P.dashT > 0) col = Math.min(COLS - 1, Math.floor((1 - P.dashT / DASH_TIME) * COLS));
      else if (P.punchT > 0)
        col = Math.min(COLS - 1, Math.floor((1 - P.punchT / PUNCH_TIME) * COLS));
      else col = Math.floor(P.animT * (row === CAT_ROW.run ? CAT_FPS.run : CAT_FPS.idle)) % COLS;
      P.dispScale = ease(P.dispScale, catSheet.rowScale[row] ?? 1);
      traceDraw('cat', catSheet, row, col, ps.sx, ps.sy, CAT_PX, P.flip, P.dispScale, { hurtT: P.hurtT });
      drawFrame(ctx, catSheet, row, col, ps.sx, ps.sy, CAT_PX, P.flip, P.dispScale);
    },
  });

  items.sort((a, b) => a.sy - b.sy);
  for (const it of items) it.go();

  for (const a of arrows) {
    const { sx, sy } = toScreen(a.x, a.z);
    ctx.strokeStyle = '#6b4a2f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - a.dx * 14, sy - 24 - a.dz * 7);
    ctx.lineTo(sx + a.dx * 14, sy - 24 + a.dz * 7);
    ctx.stroke();
  }

  for (const f of fxs) {
    const t = toScreen(f.x, f.z);
    drawFx(ctx, f, t.sx, t.sy - f.size * 0.3);
  }

  drawPops();
  if (debug) drawGrid();
  drawHud();
}

/** 떠오르며 사라지는 데미지 숫자 */
function drawPops() {
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = 'bold 34px system-ui, sans-serif';
  for (const q of pops) {
    const { sx, sy } = toScreen(q.x, q.z);
    const k = q.t / POP_LIFE;
    ctx.save();
    ctx.globalAlpha = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
    ctx.translate(sx + q.dx, sy - q.h * 0.72 - 54 * (1 - (1 - k) ** 2));
    // 튀어나오는 느낌으로 처음 잠깐 크게
    const pop = k < 0.18 ? 1 + (0.18 - k) * 2.6 : 1;
    ctx.scale(pop, pop);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(86,58,44,0.85)';
    ctx.strokeText(q.text, 0, 0);
    ctx.fillStyle = q.hurt ? '#ff9083' : '#ffd84a';
    ctx.fillText(q.text, 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

function enemyHpBar(e: Enemy, sx: number, sy: number) {
  if (e.hp >= e.def.hp) return;
  const w = 62;
  const y = sy - e.def.size * 0.92;
  ctx.fillStyle = 'rgba(60,40,30,0.35)';
  ctx.fillRect(sx - w / 2, y, w, 7);
  ctx.fillStyle = '#e8705a';
  ctx.fillRect(sx - w / 2, y, (w * Math.max(0, e.hp)) / e.def.hp, 7);
}

function drawHud() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const s = Math.min(devicePixelRatio, 2);
  ctx.save();
  ctx.scale(s, s);
  const W = canvas.width / s;
  const H = canvas.height / s;

  ctx.fillStyle = 'rgba(255,250,240,0.82)';
  ctx.beginPath();
  ctx.roundRect(14, 14, 236, 78, 14);
  ctx.fill();

  ctx.fillStyle = '#e4d6c4';
  ctx.beginPath();
  ctx.roundRect(60, 25, 176, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#ef6b5e';
  ctx.beginPath();
  ctx.roundRect(60, 25, (176 * Math.max(0, P.hp)) / MAX_HP, 18, 9);
  ctx.fill();

  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#5b4a3f';
  ctx.fillText('체력', 22, 39);
  ctx.fillText('목숨', 22, 74);

  // 목숨은 발바닥 개수로 (GDD 9장)
  ctx.font = '20px system-ui, sans-serif';
  for (let i = 0; i < START_LIVES; i++) {
    ctx.globalAlpha = i < P.lives ? 1 : 0.2;
    ctx.fillText('\u{1F43E}', 60 + i * 27, 78);
  }
  ctx.globalAlpha = 1;

  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#4a3b33';
  ctx.fillText(`${fps.toFixed(0)} fps`, W - 84, 28);
  ctx.fillText(`쥐 ${enemies.filter((e) => e.state !== 'pop').length}`, W - 84, 50);

  if (phase !== 'playing') {
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(70,52,42,0.85)';
    ctx.fillText(phase === 'cleared' ? '방 클리어!' : '낮잠…', W / 2, H / 2 - 8);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(phase === 'cleared' ? '노란 매트로 나가기' : 'R 키로 집에서 깨어나기', W / 2, H / 2 + 30);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

/** 필드 장면 + 지역 이름표 */
function drawFieldScene() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawField(ctx, canvas.width, canvas.height, field, { cat: catSheet, axe: axeSheet, boat: boatSheet }, last / 1000, lastDt, showTerrain);
  const s = Math.min(devicePixelRatio, 2);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.font = 'bold 15px system-ui, sans-serif';
  const w = ctx.measureText(FIELD.name).width + 28;
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.beginPath();
  ctx.roundRect(14, 14, w, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.fillText(FIELD.name, 28, 36);
}

/** 나가는 곳(노란 매트) — 바닥을 은은하게 깜빡인다. 방을 비우면 더 밝게 */
function drawExits() {
  const pulse = 0.5 + 0.5 * Math.sin((last / 1000) * 3);
  const strong = phase === 'cleared';
  let lx = 0;
  let ly = Infinity;
  for (const [tx, tz] of exits) {
    const a = corner(tx, tz);
    const b = corner(tx + 1, tz);
    const c = corner(tx + 1, tz + 1);
    const d = corner(tx, tz + 1);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(b.sx, b.sy);
    ctx.lineTo(c.sx, c.sy);
    ctx.lineTo(d.sx, d.sy);
    ctx.closePath();
    ctx.fillStyle = `rgba(255, 244, 170, ${(strong ? 0.3 : 0.12) + (strong ? 0.2 : 0.1) * pulse})`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + 0.35 * pulse})`;
    ctx.stroke();
    lx += (a.sx + c.sx) / 2 / exits.length;
    ly = Math.min(ly, a.sy);
  }
  if (!exits.length) return;
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(86, 58, 44, 0.8)';
  ctx.strokeText('밖으로', lx, ly - 8);
  ctx.fillStyle = '#fff6d8';
  ctx.fillText('밖으로', lx, ly - 8);
  ctx.textAlign = 'left';
}

/** 장면 전환 덮개 */
function drawFade() {
  if (fade <= 0) return;
  const k = fade * fade * (3 - 2 * fade);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(255, 246, 232, ${k})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

const corner = (tx: number, tz: number) => toScreen(tx * CELL, tz * CELL);

function drawGrid() {
  ctx.lineWidth = 1;
  for (let tz = 0; tz < GRID_H; tz++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      const a = corner(tx, tz);
      const b = corner(tx + 1, tz);
      const c = corner(tx + 1, tz + 1);
      const d = corner(tx, tz + 1);
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.lineTo(c.sx, c.sy);
      ctx.lineTo(d.sx, d.sy);
      ctx.closePath();
      ctx.fillStyle = grid.solid[tz * GRID_W + tx]
        ? 'rgba(220,60,60,0.35)'
        : 'rgba(60,140,255,0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,120,0.5)';
      ctx.stroke();
    }
  }
}

const help = document.getElementById('help')!;
const HELP = {
  field: 'WASD 이동 · 숲은 도끼로, 물은 배로 · 집 앞 빛나는 원에 잠시 서 있으면 던전 · T 지형 보기',
  dungeon: 'WASD 이동 · 클릭/J 냥펀치 · Space 구르기 · 노란 매트로 나가기 · G 격자',
};
function sayHelp() {
  help.textContent = HELP[scene];
}
const step = (t: string) => {
  help.textContent = t + ' 불러오는 중…';
};

(async () => {
  step('배경');
  await Promise.all([roomReady, fxReady, fieldReady]);
  step('고양이 시트');
  catSheet = await loadCat();
  step('도끼·배 시트');
  [axeSheet, boatSheet] = await Promise.all([loadAxe(), loadBoat()]);
  step('지형');
  await terrainReady;
  field = makeFieldState(FIELD.start, terrainAt);
  step('칼 쥐');
  sheets.sword = await loadSheet(swordUrl, 6, 5);
  step('활 쥐');
  sheets.bow = await loadSheet(bowUrl, 6, 5);
  step('뚱보 쥐');
  sheets.fat = await loadSheet(fatUrl, 6, 5);
  reset();
  if (trace) Object.assign(window, { __sheets: { cat: catSheet, axe: axeSheet, boat: boatSheet, ...sheets } });
  sayHelp();
  requestAnimationFrame(frame);
})();
