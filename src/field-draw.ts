import fieldUrl from './assets/field.webp';
import terrainUrl from './assets/field-terrain.png';
import { AXE_FPS, AXE_ROW, BOAT_FPS, BOAT_ROW, CAT_FPS, CAT_ROW } from './cat.ts';
import { BLOCK, BRIDGE, FIELD, FOREST, WALK, WATER, type FieldEvent, type FieldState, type Terrain, type Warp } from './field.ts';
import { drawFrame, type Sheet } from './sheet.ts';

export type FieldSheets = { cat: Sheet; axe: Sheet; boat: Sheet };

const [W, H] = FIELD.size;

export const fieldImage = new Image();
export const fieldReady = new Promise<void>((ok) => {
  fieldImage.onload = () => ok();
});
fieldImage.src = fieldUrl;

// ── 지형 마스크 (src/assets/field-terrain.png). 반 해상도로 읽어 둔다 ──────────────────────
// 채널 하나에 지형 하나: R 막힘 · G 숲 · B 물 · A 다리(투명 = 다리). 셋 다 검정·불투명이면 걷기.
// 겹치면 다리 > 막힘 > 물 > 숲. 채널마다 절반(128)을 넘으면 칠한 것으로 본다.
// A 를 거꾸로 쓰는 건, 편집기·브라우저가 투명한 픽셀의 RGB 를 버리기 때문이다 (다리 몇 곳만 투명하면 잃을 게 없다).
const TW = Math.ceil(W / 2);
const TH = Math.ceil(H / 2);
let terrain: Uint8Array | null = null;
let terrainTint: HTMLCanvasElement | null = null;

export const terrainReady = new Promise<void>((ok) => {
  const im = new Image();
  im.onload = () => {
    const c = document.createElement('canvas');
    c.width = TW;
    c.height = TH;
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingEnabled = false;
    g.drawImage(im, 0, 0, TW, TH);
    const d = g.getImageData(0, 0, TW, TH).data;
    terrain = new Uint8Array(TW * TH);
    for (let i = 0; i < terrain.length; i++) {
      const o = i * 4;
      terrain[i] =
        d[o + 3] < 128 ? BRIDGE : d[o] >= 128 ? BLOCK : d[o + 2] >= 128 ? WATER : d[o + 1] >= 128 ? FOREST : WALK;
    }
    ok();
  };
  im.onerror = () => ok(); // 마스크가 없으면 어디든 걷는다
  im.src = terrainUrl;
});

export const terrainAt = (x: number, y: number): Terrain => {
  if (!terrain) return WALK;
  const tx = Math.min(TW - 1, Math.max(0, (x / 2) | 0));
  const ty = Math.min(TH - 1, Math.max(0, (y / 2) | 0));
  return terrain[ty * TW + tx] as Terrain;
};

/** T 키 지형 보기: 숲 분홍 · 물 하늘색 · 막힘 빨강 · 다리 노랑 */
function tint(): HTMLCanvasElement | null {
  if (terrainTint || !terrain) return terrainTint;
  const c = document.createElement('canvas');
  c.width = TW;
  c.height = TH;
  const g = c.getContext('2d')!;
  const img = g.createImageData(TW, TH);
  const col: Record<number, number[]> = {
    [FOREST]: [255, 0, 170, 110],
    [WATER]: [0, 210, 255, 100],
    [BLOCK]: [255, 40, 40, 140],
    [BRIDGE]: [255, 230, 0, 160],
  };
  for (let i = 0; i < terrain.length; i++) if (col[terrain[i]]) img.data.set(col[terrain[i]], i * 4);
  g.putImageData(img, 0, 0);
  return (terrainTint = c);
}

// ── 연출 파티클 ─────────────────────────────────────────────────────────────────────────
type Part = {
  kind: 'leaf' | 'drop' | 'ring';
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
};
let parts: Part[] = [];
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const LEAVES = ['#5fae4a', '#7cc35a', '#3f8f45', '#9ad16a', '#c9d86a'];
/** 파티클 값은 고양이 키 34px 에서 맞췄다. 키에 비례해 크기·거리·속도·중력을 같이 줄인다 */
const U = FIELD.catBody / 34;

const ring = (x: number, y: number, size: number, life = 0.9) =>
  parts.push({ kind: 'ring', x, y, vx: 0, vy: 0, t: 0, life, size, rot: 0, vr: 0, color: '' });

/** updateField 가 남긴 사건으로 파티클을 만든다 */
export function fieldFx(events: FieldEvent[]) {
  for (const e of events) {
    if (e.type === 'chop') {
      for (let i = 0; i < 8; i++)
        parts.push({
          kind: 'leaf',
          x: e.x + rand(-3, 3) * U,
          y: e.y + rand(-4, 2) * U,
          vx: (e.flip * rand(8, 42) + rand(-12, 12)) * U,
          vy: rand(-58, -22) * U,
          t: 0,
          life: rand(0.55, 0.85),
          size: rand(1.5, 2.7) * U,
          rot: rand(0, Math.PI),
          vr: rand(-9, 9),
          color: LEAVES[(Math.random() * LEAVES.length) | 0],
        });
    } else if (e.type === 'splash') {
      ring(e.x, e.y, 14 * U, 0.7);
      for (let i = 0; i < 9; i++)
        parts.push({ kind: 'drop', x: e.x + rand(-6, 6) * U, y: e.y - 2 * U, vx: rand(-30, 30) * U, vy: rand(-70, -35) * U, t: 0, life: rand(0.35, 0.55), size: rand(0.9, 1.6) * U, rot: 0, vr: 0, color: 'rgba(235, 250, 255, 0.95)' });
    } else if (e.type === 'ripple') ring(e.x, e.y, 16 * U, 1);
    else if (e.type === 'stroke') {
      ring(e.x + rand(-4, 4) * U, e.y + 2 * U, 7 * U, 0.8);
      for (let i = 0; i < 3; i++)
        parts.push({ kind: 'drop', x: e.x + rand(-5, 5) * U, y: e.y, vx: rand(-15, 15) * U, vy: rand(-35, -15) * U, t: 0, life: 0.35, size: 0.9 * U, rot: 0, vr: 0, color: 'rgba(235, 250, 255, 0.9)' });
    }
  }
}

function stepParts(dt: number) {
  for (const p of parts) {
    p.t += dt;
    if (p.kind === 'leaf') {
      p.vx *= Math.exp(-2.2 * dt); // 공기 저항에 팔랑이며 떨어진다
      p.vy += 75 * U * dt;
      p.vy *= Math.exp(-1.2 * dt);
      p.rot += p.vr * dt;
    } else if (p.kind === 'drop') p.vy += 180 * U * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  parts = parts.filter((p) => p.t < p.life);
}

function drawRings(ctx: CanvasRenderingContext2D) {
  for (const p of parts) {
    if (p.kind !== 'ring') continue;
    const k = p.t / p.life;
    const r = p.size * (0.35 + 0.65 * Math.sqrt(k));
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.55 * (1 - k)})`;
    ctx.lineWidth = Math.max(0.6, U);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawBits(ctx: CanvasRenderingContext2D) {
  for (const p of parts) {
    if (p.kind === 'ring') continue;
    const fade = Math.min(1, (p.life - p.t) / 0.2);
    ctx.globalAlpha = fade;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    if (p.kind === 'leaf') ctx.ellipse(p.x, p.y, p.size, p.size * 0.5, p.rot, 0, Math.PI * 2);
    else ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

// ── 숲에서 발 앞을 가리는 수풀: 발밑의 배경 그림을 고양이 다리 위에 다시 그린다 ─────────────
const bush = document.createElement('canvas');
const bg = bush.getContext('2d')!;
function drawFoliage(ctx: CanvasRenderingContext2D, x: number, y: number, body: number) {
  const w = Math.ceil(body * 1.5);
  const h = Math.ceil(body * 0.5);
  const sx = Math.round(x - w / 2);
  const sy = Math.round(y - h + 4);
  bush.width = w;
  bush.height = h;
  bg.drawImage(fieldImage, sx, sy, w, h, 0, 0, w, h);
  // 가장자리를 타원으로 부드럽게 잘라 배경에 녹인다
  bg.globalCompositeOperation = 'destination-in';
  bg.save();
  bg.translate(w / 2, h);
  bg.scale(w / 2, h);
  const g = bg.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, '#000');
  g.addColorStop(0.55, '#000');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  bg.fillStyle = g;
  bg.fillRect(-1, -1, 2, 1);
  bg.restore();
  bg.globalCompositeOperation = 'source-over';
  ctx.drawImage(bush, sx, sy);
}

/** 캔버스 픽셀 기준 필드 변환. 검증 도구가 고양이 화면 위치를 찾을 때 쓴다 */
export const fieldView = { sc: 1, ox: 0, oy: 0 };
let wakeT = 0;

/**
 * 필드 한 장면. 필드 그림은 넓어서 확대해 고양이를 따라가고, 그림 바깥은 보이지 않게 카메라를 가둔다.
 * cw, ch 는 캔버스 실제 픽셀.
 */
export function drawField(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  s: FieldState,
  sheets: FieldSheets,
  t: number,
  dt: number,
  showTerrain: boolean,
) {
  const sc = Math.max(cw / W, ch / H) * FIELD.zoom;
  const vw = cw / sc;
  const vh = ch / sc;
  const cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, s.camX));
  const cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, s.camY));
  fieldView.sc = sc;
  fieldView.ox = cw / 2 - cx * sc;
  fieldView.oy = ch / 2 - cy * sc;
  ctx.setTransform(sc, 0, 0, sc, fieldView.ox, fieldView.oy);
  ctx.drawImage(fieldImage, 0, 0, W, H);
  if (showTerrain) {
    const tc = tint();
    if (tc) ctx.drawImage(tc, 0, 0, W, H);
  }

  for (const w of FIELD.warps) drawWarp(ctx, w, t, w === s.warp && s.armed ? s.dwell / w.dwell : 0);

  // 배 뒤로 퍼지는 물결
  const afloat = s.mode === 'boat' || s.mode === 'board' || s.mode === 'unboard';
  wakeT += dt;
  if (s.mode === 'boat' && terrainAt(s.x, s.y) === WATER && wakeT > (s.moving ? 0.16 : 1.4)) {
    wakeT = 0;
    ring(s.x - (s.moving ? s.flip * 7 * U : 0), s.y + U, (s.moving ? 11 : 16) * U, s.moving ? 0.9 : 1.6);
  }
  stepParts(dt);
  drawRings(ctx);

  // 시트마다 고양이 키를 맞춘다. 배 시트는 배를 크게 그리느라 고양이가 절반 크기라서,
  // 배 옆에 서 있는 컷(오르기 첫 컷 · 내리기 마지막 컷)의 키로 맞춘다 — 대기 행은 배 높이라 기준이 못 된다
  const body = FIELD.catBody;
  const k = body / sheets.axe.bodyH;
  const bf = sheets.boat.frames;
  const kBoat = body / Math.min(bf[BOAT_ROW.board][0].sh, bf[BOAT_ROW.unboard][5].sh);
  const M = FIELD.modes;
  let sheet = sheets.cat;
  let size = (body * sheets.cat.base) / sheets.cat.bodyH;
  let row: number;
  let col: number;
  let rs: number | undefined;
  let bob = 0;
  const loop = (fps: number) => Math.floor(s.animT * fps) % 6;
  const once = (p: number) => Math.min(5, Math.floor(p * 6));
  switch (s.mode) {
    case 'walk':
      row = s.moving ? CAT_ROW.run : CAT_ROW.idle;
      col = loop(s.moving ? CAT_FPS.run : CAT_FPS.idle);
      break;
    case 'axe':
      sheet = sheets.axe;
      size = k * sheets.axe.base;
      if (s.chopping > 0) {
        row = AXE_ROW.chop;
        col = once(1 - s.chopping / M.axe.chopTime);
      } else {
        row = s.moving ? AXE_ROW.walk : AXE_ROW.idle;
        col = loop(s.moving ? AXE_FPS.walk : AXE_FPS.idle);
      }
      break;
    default:
      sheet = sheets.boat;
      size = kBoat * sheets.boat.base;
      rs = 1; // 배 크기는 행마다 같다 (뛰어드는 고양이 때문에 행 높이가 달라도 배는 그대로)
      bob = Math.sin(t * 2.4) * 0.8;
      if (s.mode === 'board') [row, col] = [BOAT_ROW.board, once(s.modeT / FIELD.boardTime)];
      else if (s.mode === 'unboard') [row, col] = [BOAT_ROW.unboard, once(s.modeT / FIELD.boardTime)];
      else [row, col] = s.moving ? [BOAT_ROW.row, loop(BOAT_FPS.row)] : [BOAT_ROW.idle, loop(BOAT_FPS.idle)];
  }

  if (!afloat) {
    const r = body * 0.36;
    ctx.fillStyle = 'rgba(70, 60, 40, 0.28)';
    ctx.beginPath();
    ctx.ellipse(s.x, s.y, r, r * 0.36, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  drawFrame(ctx, sheet, row, col, s.x, s.y + bob, size, s.flip, rs);
  if (s.mode === 'axe') drawFoliage(ctx, s.x, s.y, body);
  drawBits(ctx);
}

/**
 * 워프 임시 그래픽 — 바닥에 숨 쉬는 빛 원 + 빛 기둥 + 이름표.
 * 머무는 동안 바깥 링이 채워진다. 스프라이트 시트가 오면 이 함수만 바꾸면 된다.
 */
function drawWarp(ctx: CanvasRenderingContext2D, w: Warp, t: number, progress: number) {
  const [x, y] = w.at;
  const rx = w.r;
  const ry = w.r * FIELD.vertical;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const ellipse = (k: number) => {
    ctx.beginPath();
    ctx.ellipse(x, y, rx * k, ry * k, 0, 0, Math.PI * 2);
  };

  ctx.save();
  const beam = ctx.createLinearGradient(x, y, x, y - 46);
  beam.addColorStop(0, `rgba(190, 240, 255, ${0.35 + 0.2 * pulse})`);
  beam.addColorStop(1, 'rgba(190, 240, 255, 0)');
  ctx.fillStyle = beam;
  ctx.fillRect(x - rx * 0.8, y - 46, rx * 1.6, 46);

  ctx.fillStyle = `rgba(160, 230, 255, ${0.3 + 0.15 * pulse})`;
  ellipse(1);
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(110, 200, 255, 0.9)';
  ellipse(0.55 + 0.15 * pulse);
  ctx.stroke();

  if (progress > 0) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#fff3a8';
    ctx.beginPath();
    ctx.ellipse(x, y, rx * 1.2, ry * 1.2, 0, -Math.PI / 2, -Math.PI / 2 + Math.min(1, progress) * Math.PI * 2);
    ctx.stroke();
  }

  ctx.font = 'bold 9px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(60, 45, 35, 0.8)';
  ctx.strokeText(w.label, x, y - 50);
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(w.label, x, y - 50);
  ctx.restore();
}
