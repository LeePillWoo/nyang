import roomUrl from './assets/room-alley.png';
import { ANIM, catSheet, COLS, drawCatFrame } from './cat.ts';
import { CELL, resolveCircle } from './collide.ts';
import { BG_H, BG_W, GRID_H, GRID_W, grid, toScreen } from './iso.ts';

// GDD 5장 스탯
const SPEED = 5; // m/s
const RADIUS = 0.45;
const DASH_DIST = 3;
const DASH_TIME = 0.2;
const DASH_CD = 0.5;
const CAT_PX = 190; // 배경 그림 픽셀 기준 스프라이트 한 칸 크기

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
document.body.appendChild(canvas);

const room = new Image();
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
  // 배경 그림을 화면에 맞춰 넣고, 그 안에서는 그림 픽셀 좌표를 그대로 쓴다
  scale = Math.min(canvas.width / BG_W, canvas.height / BG_H);
  ox = (canvas.width - BG_W * scale) / 2;
  oy = (canvas.height - BG_H * scale) / 2;
}
layout();
addEventListener('resize', layout);

const keys = new Set<string>();
let debug = location.search.includes('grid'); // ?grid 로도 켤 수 있다
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyG') debug = !debug;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const held = (...codes: string[]) => codes.some((c) => keys.has(c));

// 월드 좌표(m). 맵 중앙에서 시작
let px = (GRID_W * CELL) / 2;
let pz = (GRID_H * CELL) / 2;
let faceX = 0;
let faceZ = 1;
let flip = 1;
let dashX = 0;
let dashZ = 0;
let dashT = 0;
let dashCd = 0;
let animT = 0;
let last = performance.now();
let fps = 0;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;
  dashCd = Math.max(0, dashCd - dt);

  // 화면 기준 입력을 아이소메트릭 축으로 45도 돌린다
  let mx = (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0);
  let my = (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0);
  const len = Math.hypot(mx, my);
  if (len > 0) {
    mx /= len;
    my /= len;
    faceX = (mx + my) * Math.SQRT1_2;
    faceZ = (my - mx) * Math.SQRT1_2;
    if (mx !== 0) flip = Math.sign(mx);
  }

  if (keys.has('Space') && dashT <= 0 && dashCd <= 0) {
    dashX = faceX;
    dashZ = faceZ;
    dashT = DASH_TIME;
    dashCd = DASH_TIME + DASH_CD;
  }

  let vx = len > 0 ? (mx + my) * Math.SQRT1_2 * SPEED : 0;
  let vz = len > 0 ? (my - mx) * Math.SQRT1_2 * SPEED : 0;
  if (dashT > 0) {
    dashT -= dt;
    vx = dashX * (DASH_DIST / DASH_TIME);
    vz = dashZ * (DASH_DIST / DASH_TIME);
  }

  const p = resolveCircle(grid, px + vx * dt, pz + vz * dt, RADIUS);
  px = p.x;
  pz = p.z;
  animT += dt;

  draw(len > 0);
  requestAnimationFrame(frame);
}

function draw(moving: boolean) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, ox, oy);
  ctx.drawImage(room, 0, 0, BG_W, BG_H);

  const { sx, sy } = toScreen(px, pz);

  // 발밑 그림자
  ctx.fillStyle = 'rgba(120, 85, 55, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, CAT_PX * 0.28, CAT_PX * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();

  const anim = dashT > 0 ? ANIM.roll : moving ? ANIM.run : ANIM.idle;
  // 구르기는 대시 길이에 맞춰 한 바퀴만 돈다
  const frame =
    dashT > 0
      ? Math.min(COLS - 1, Math.floor((1 - dashT / DASH_TIME) * COLS))
      : Math.floor(animT * anim.fps) % COLS;
  drawCatFrame(ctx, anim, frame, sx, sy, CAT_PX, flip);

  if (debug) drawGrid();

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#4a3b33';
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillText(`${fps.toFixed(0)} fps`, 12, 24);
}

const corner = (tx: number, tz: number) => toScreen(tx * CELL, tz * CELL);

function drawGrid() {
  ctx.lineWidth = 1;
  ctx.font = '11px monospace';
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
      const blocked = grid.solid[tz * GRID_W + tx];
      ctx.fillStyle = blocked ? 'rgba(220,60,60,0.35)' : 'rgba(60,140,255,0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,120,0.6)';
      ctx.stroke();
      ctx.fillStyle = 'rgba(20,60,120,0.75)';
      ctx.fillText(`${tx},${tz}`, (a.sx + c.sx) / 2 - 12, (a.sy + c.sy) / 2 + 4);
    }
  }
}

Promise.all([room.decode(), catSheet.decode()]).then(() => {
  document.getElementById('help')!.textContent = 'WASD 이동 · Space 구르기 · G 격자';
  requestAnimationFrame(frame);
});
