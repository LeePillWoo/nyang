import bowUrl from './assets/rat-bow.png';
import fatUrl from './assets/rat-fat.png';
import roomUrl from './assets/room-alley.png';
import swordUrl from './assets/rat-sword.png';
import { CAT_FPS, CAT_ROW, loadCat } from './cat.ts';
import { CELL, resolveCircle } from './collide.ts';
import {
  damageEnemy,
  enemyFrame,
  makeEnemy,
  updateEnemy,
  type Enemy,
  type Kind,
  type World,
} from './enemy.ts';
import { BG_H, BG_W, GRID_H, GRID_W, grid, toScreen } from './iso.ts';
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
const PUNCH_RANGE = 1.5;
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
let punchQueued = false;
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyG') debug = !debug;
  if (e.code === 'KeyJ') punchQueued = true;
  if (e.code === 'KeyR') reset();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', () => {
  punchQueued = true;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const held = (...codes: string[]) => codes.some((c) => keys.has(c));
const tile = (tx: number, tz: number) => ({ x: (tx + 0.5) * CELL, z: (tz + 0.5) * CELL });

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
};

let enemies: Enemy[] = [];
let arrows: Arrow[] = [];
let phase: 'playing' | 'cleared' | 'napped' = 'playing';
const sheets = {} as Record<Kind, Sheet>;
let catSheet: Sheet;

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
  enemies = SPAWNS.map(([k, tx, tz]) => {
    const p = tile(tx, tz);
    return makeEnemy(k, sheets[k], p.x, p.z);
  });
  arrows = [];
  phase = 'playing';
}

function hitPlayer(dmg: number, fx: number, fz: number) {
  if (phase !== 'playing' || P.invT > 0 || P.dashT > 0) return; // 구르기 중 무적
  P.hp -= dmg;
  P.hurtT = 0.3;
  const d = Math.hypot(P.x - fx, P.z - fz) || 1;
  P.kx = ((P.x - fx) / d) * 4;
  P.kz = ((P.z - fz) / d) * 4;
  if (P.hp > 0) {
    P.invT = HIT_IFRAME;
    return;
  }
  // 목숨 하나 쓰고 그 자리에서 부활 (GDD 5장 아홉 목숨)
  P.lives -= 1;
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
let fps = 0;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

function update(dt: number) {
  P.animT += dt;
  P.dashCd = Math.max(0, P.dashCd - dt);
  P.invT = Math.max(0, P.invT - dt);
  P.hurtT = Math.max(0, P.hurtT - dt);

  // 화면 기준 입력을 아이소메트릭 축으로 45도 돌린다
  let mx = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
  let my = (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0);
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
      for (const e of enemies) {
        if (e.state === 'pop') continue;
        const dx = e.x - P.x;
        const dz = e.z - P.z;
        const d = Math.hypot(dx, dz);
        if (d > PUNCH_RANGE) continue;
        if ((dx * P.faceX + dz * P.faceZ) / (d || 1) < Math.cos(PUNCH_ARC / 2)) continue;
        damageEnemy(e, PUNCH_DMG, P.x, P.z);
      }
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

  world.px = P.x;
  world.pz = P.z;
  for (const e of enemies) updateEnemy(e, dt, world);
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

  if (phase === 'playing' && enemies.length === 0) phase = 'cleared';
}

function blob(sx: number, sy: number, r: number) {
  ctx.fillStyle = 'rgba(120, 85, 55, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.drawImage(room, 0, 0, BG_W, BG_H);

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
        drawFrame(ctx, e.sheet, f.row, f.col, sx, sy, e.def.size, e.flip);
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
      ctx.save();
      if (P.invT > 0) ctx.globalAlpha = 0.45 + 0.55 * Math.abs(Math.sin(P.invT * 22));
      drawFrame(ctx, catSheet, row, col, ps.sx, ps.sy, CAT_PX, P.flip);
      ctx.restore();
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

  if (debug) drawGrid();
  drawHud();
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
    ctx.fillText('R 키로 다시', W / 2, H / 2 + 30);
    ctx.textAlign = 'left';
  }
  ctx.restore();
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
const step = (t: string) => {
  help.textContent = t + ' 불러오는 중…';
};

(async () => {
  step('배경');
  await roomReady;
  step('고양이 시트');
  catSheet = await loadCat();
  step('칼 쥐');
  sheets.sword = await loadSheet(swordUrl, 6, 5);
  step('활 쥐');
  sheets.bow = await loadSheet(bowUrl, 6, 5);
  step('뚱보 쥐');
  sheets.fat = await loadSheet(fatUrl, 6, 5);
  reset();
  help.textContent = 'WASD 이동 · 클릭/J 냥펀치 · Space 구르기 · R 다시 · G 격자';
  requestAnimationFrame(frame);
})();
