import { AXE_FPS, AXE_ROW, BOAT_FPS, BOAT_ROW, CAT_FPS, CAT_ROW, SNOW_FPS, SNOW_ROW } from './cat.ts';
import { drawEmote } from './emote.ts';
import { BLOCK, BRIDGE, FIELD, FOREST, WALK, WATER, type FieldEvent, type FieldState, type Terrain, type Warp } from './field.ts';
import { drawFrame, type Sheet } from './sheet.ts';

export type FieldSheets = { cat: Sheet; axe: Sheet; boat: Sheet; snow: Sheet };

// ── 필드 조각 (src/assets/world/tiles/tile_rR_cC.webp · world/masks/mask_rR_cC.png, 원본 art/world/tiles/ → node tools/assets.mjs) ──
// 필드는 grid 칸으로 자른 조각을 바둑판처럼 이어 붙인 한 장이다. 좌표는 이어 붙인 전체 그림의 픽셀.
// 그림은 카메라 근처 조각만 불러온다. 마스크는 처음에 전부 읽는다 (고양이가 어디로 가든 지형을 알아야 한다).
const [W, H] = FIELD.size;
const [COLS, ROWS] = FIELD.grid;
const tileX = (c: number) => Math.floor((c * W) / COLS);
const tileY = (r: number) => Math.floor((r * H) / ROWS);
const TILE_URL = import.meta.glob<string>('./assets/world/tiles/tile_*.webp', { eager: true, query: '?url', import: 'default' });
const MASK_URL = import.meta.glob<string>('./assets/world/masks/mask_*.png', { eager: true, query: '?url', import: 'default' });

type Tile = {
  x: number;
  y: number;
  w: number;
  h: number;
  /** 그림이 없는 칸은 그리지 않고 막힌 곳으로 둔다 */
  url?: string;
  mask?: string;
  img?: HTMLImageElement;
  load?: Promise<void>;
  terrain?: Uint8Array;
  tint?: HTMLCanvasElement;
  /** field.json biomes 의 글자: 's' 눈 지역 · 'd' 사막 지역 · '.' 보통 */
  zone: string;
  /** 1/4 해상도 발밑 판정 (0 보통 · 1 눈 · 2 모래). 그림을 불러온 조각만 */
  biome?: Uint8Array;
};
const tiles: Tile[] = [];
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const n = `r${r}_c${c}`;
    tiles.push({
      x: tileX(c),
      y: tileY(r),
      w: tileX(c + 1) - tileX(c),
      h: tileY(r + 1) - tileY(r),
      url: TILE_URL[`./assets/world/tiles/tile_${n}.webp`],
      mask: MASK_URL[`./assets/world/masks/mask_${n}.png`],
      zone: FIELD.biomes[r]?.[c] ?? '.',
    });
  }

function tileAt(x: number, y: number): Tile {
  let c = Math.min(COLS - 1, Math.floor((x * COLS) / W));
  let r = Math.min(ROWS - 1, Math.floor((y * ROWS) / H));
  // 조각 크기가 나눠떨어지지 않으면(470·471) 경계에서 한 칸 어긋날 수 있다
  if (x < tileX(c)) c--;
  else if (x >= tileX(c + 1)) c++;
  if (y < tileY(r)) r--;
  else if (y >= tileY(r + 1)) r++;
  return tiles[r * COLS + c];
}

const tilesIn = (x0: number, y0: number, x1: number, y1: number) =>
  tiles.filter((t) => t.x < x1 && t.x + t.w > x0 && t.y < y1 && t.y + t.h > y0);

// ponytail: 한 번 불러온 조각은 내리지 않는다 (36장 · 약 56MB). 조각이 크게 늘면 멀어진 조각의 img 를 지운다.
function want(t: Tile) {
  if (!t.load && t.url) {
    const url = t.url;
    t.load = new Promise<void>((ok) => {
      const im = new Image();
      im.onload = () => {
        t.img = im;
        if (t.zone !== '.') t.biome = readBiome(im, t.zone);
        ok();
      };
      im.onerror = () => ok();
      im.src = url;
    });
  }
  return t.load;
}

// ── 눈밭·모래 (걷는 모션만 바뀐다) ── 지역은 조각 단위로 field.json 에 적고, 그 안에서 발밑 색으로 가른다:
// 눈 지역에선 밝고 무채색인 곳만 눈 (흙길·풀은 보통 걷기), 사막 지역에선 모래색이면 모래.
const BQ = 4;
function readBiome(im: HTMLImageElement, zone: string) {
  const w = Math.ceil(im.naturalWidth / BQ);
  const h = Math.ceil(im.naturalHeight / BQ);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) {
    const [r, gr, b] = [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]];
    const hi = Math.max(r, gr, b);
    const lo = Math.min(r, gr, b);
    if (zone === 's') out[i] = (r + gr + b) / 3 > 200 && hi - lo < 45 ? 1 : 0;
    else out[i] = r > 170 && r >= gr && gr > b && r - b > 40 && gr > 120 ? 2 : 0;
  }
  return out;
}
export type Biome = '' | 'snow' | 'sand';
export function biomeAt(x: number, y: number): Biome {
  const px = Math.min(W - 1, Math.max(0, x | 0));
  const py = Math.min(H - 1, Math.max(0, y | 0));
  const t = tileAt(px, py);
  if (!t.biome) return '';
  const v = t.biome[(((py - t.y) / BQ) | 0) * Math.ceil(t.w / BQ) + (((px - t.x) / BQ) | 0)];
  return v === 1 ? 'snow' : v === 2 ? 'sand' : '';
}

/** 시작점 주변 조각 (첫 화면이 비어 보이지 않게) */
const [V0, V1] = FIELD.view;
export const fieldReady = Promise.all(
  tilesIn(FIELD.start[0] - V0, FIELD.start[1] - V1, FIELD.start[0] + V0, FIELD.start[1] + V1).map(want),
);

// ── 지형 마스크. 조각마다 하나, 조각과 같은 크기 ────────────────────────────────────────────
// 채널 하나에 지형 하나: R 막힘 · G 숲 · B 물 · A 다리(투명 = 다리). 셋 다 검정·불투명이면 걷기.
// 겹치면 다리 > 막힘 > 물 > 숲. 채널마다 절반(128)을 넘으면 칠한 것으로 본다.
// A 를 거꾸로 쓰는 건, 편집기·브라우저가 투명한 픽셀의 RGB 를 버리기 때문이다 (다리 몇 곳만 투명하면 잃을 게 없다).
function loadMask(t: Tile) {
  return new Promise<void>((ok) => {
    if (!t.mask) return ok(); // 마스크가 없으면 어디든 걷는다
    const im = new Image();
    im.onload = () => {
      const c = document.createElement('canvas');
      c.width = t.w;
      c.height = t.h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.imageSmoothingEnabled = false;
      g.drawImage(im, 0, 0, t.w, t.h);
      const d = g.getImageData(0, 0, t.w, t.h).data;
      const a = new Uint8Array(t.w * t.h);
      for (let i = 0; i < a.length; i++) {
        const o = i * 4;
        a[i] = d[o + 3] < 128 ? BRIDGE : d[o] >= 128 ? BLOCK : d[o + 2] >= 128 ? WATER : d[o + 1] >= 128 ? FOREST : WALK;
      }
      t.terrain = a;
      ok();
    };
    im.onerror = () => ok();
    im.src = t.mask;
  });
}
export const terrainReady = Promise.all(tiles.map(loadMask));

export const terrainAt = (x: number, y: number): Terrain => {
  const px = Math.min(W - 1, Math.max(0, x | 0));
  const py = Math.min(H - 1, Math.max(0, y | 0));
  const t = tileAt(px, py);
  if (!t.url) return BLOCK;
  if (!t.terrain) return WALK;
  return t.terrain[(py - t.y) * t.w + (px - t.x)] as Terrain;
};

/** T 키 지형 보기: 숲 분홍 · 물 하늘색 · 막힘 빨강 · 다리 노랑 */
function tint(t: Tile): HTMLCanvasElement | null {
  if (t.tint || !t.terrain) return t.tint ?? null;
  const c = document.createElement('canvas');
  c.width = t.w;
  c.height = t.h;
  const g = c.getContext('2d')!;
  const img = g.createImageData(t.w, t.h);
  const col: Record<number, number[]> = {
    [FOREST]: [255, 0, 170, 110],
    [WATER]: [0, 210, 255, 100],
    [BLOCK]: [255, 40, 40, 140],
    [BRIDGE]: [255, 230, 0, 160],
  };
  for (let i = 0; i < t.terrain.length; i++) if (col[t.terrain[i]]) img.data.set(col[t.terrain[i]], i * 4);
  g.putImageData(img, 0, 0);
  return (t.tint = c);
}

// 보이는 범위의 조각을 1:1 로 한 장에 이어 붙인 것. 조각마다 따로 확대해 그리면 경계에 실금이 생긴다
const view = document.createElement('canvas');
const vg = view.getContext('2d')!;
let viewX = 0;
let viewY = 0;

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
  bg.drawImage(view, sx - viewX, sy - viewY, w, h, 0, 0, w, h);
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
 * 필드 한 장면. 화면에 field.json 의 view 넓이만큼 보이게 확대해 고양이를 따라가고, 지도 바깥은 보이지 않게 카메라를 가둔다.
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
  /** 지도를 끌어 둘러보는 중이면 카메라가 고양이 대신 이곳을 본다 */
  look: { x: number; y: number } | null = null,
) {
  // 화면 넓이 view 를 꽉 채우되, 세로 화면에선 폭 480 은 보이게 (안 그러면 고양이 둘레 200px 만 크게 보인다)
  const sc = Math.min(Math.max(cw / V0, ch / V1), cw / 480);
  const vw = cw / sc;
  const vh = ch / sc;
  const cx = vw >= W ? W / 2 : Math.min(W - vw / 2, Math.max(vw / 2, look ? look.x : s.camX));
  const cy = vh >= H ? H / 2 : Math.min(H - vh / 2, Math.max(vh / 2, look ? look.y : s.camY));
  fieldView.sc = sc;
  fieldView.ox = cw / 2 - cx * sc;
  fieldView.oy = ch / 2 - cy * sc;
  ctx.setTransform(sc, 0, 0, sc, fieldView.ox, fieldView.oy);
  for (const tl of tilesIn(cx - vw * 1.5, cy - vh * 1.5, cx + vw * 1.5, cy + vh * 1.5)) want(tl); // 한 화면 앞까지 미리
  viewX = Math.floor(cx - vw / 2);
  viewY = Math.floor(cy - vh / 2);
  const bw = Math.ceil(vw) + 2;
  const bh = Math.ceil(vh) + 2;
  if (view.width !== bw || view.height !== bh) {
    view.width = bw;
    view.height = bh;
  } else vg.clearRect(0, 0, bw, bh);
  const seen = tilesIn(viewX, viewY, viewX + bw, viewY + bh);
  for (const tl of seen) if (tl.img) vg.drawImage(tl.img, tl.x - viewX, tl.y - viewY);
  ctx.drawImage(view, viewX, viewY);
  if (showTerrain)
    for (const tl of seen) {
      const tc = tint(tl);
      if (tc) ctx.drawImage(tc, tl.x, tl.y);
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
    case 'walk': {
      const b = s.moving ? biomeAt(s.x, s.y) : '';
      if (b) {
        sheet = sheets.snow;
        size = (body * sheets.snow.base) / sheets.snow.bodyH;
        row = b === 'snow' ? SNOW_ROW.snow : SNOW_ROW.sand;
        col = loop(b === 'snow' ? SNOW_FPS.snow : SNOW_FPS.sand);
      } else {
        row = s.moving ? CAT_ROW.run : CAT_ROW.idle;
        col = loop(s.moving ? CAT_FPS.run : CAT_FPS.idle);
      }
      break;
    }
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
  drawEmote(ctx, s.x, s.y - body * (afloat ? 1.5 : 1.2), body * 0.8);
}

/**
 * 포탈 — 바닥에 숨 쉬는 빛 원 + 빛 기둥 + 이름표 (이펙트 시트의 포탈 그림은 너무 강해서 이 단순한 그림을 쓴다).
 * 머무는 동안 바깥 링이 채워진다.
 * 아직 던전이 연결되지 않은 포탈은 흐리게 그린다. 이름표는 포탈 아래 (위쪽엔 이정표 그림이 있다).
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
  if (!w.to) ctx.globalAlpha = 0.45;
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
  ctx.strokeText(w.label, x, y + ry + 11);
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(w.label, x, y + ry + 11);
  ctx.restore();
}
