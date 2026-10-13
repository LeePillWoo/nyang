// 꾸미기 소품 그리기 — 치즈 기본 시트(cat_action_sheet)로 그릴 때 그 컷 위(등 소품은 뒤)에 걸친 소품을 얹는다 (2026-10-13 기준점 방식으로 다시).
// 자리는 tools/cat-anchors.mjs 가 컷마다 미리 재 둔 기준점(src/data/cat-anchors.json)으로:
//   · 머리 소품(모자 · 얼굴 · 목 · 무늬): 귀 안쪽 둘을 이은 줄 — 기준 컷(대기 첫 컷)에서 소품이 귀 줄에서 얼마나 떨어졌나를 재 두고, 컷마다 귀 줄의 자리 · 길이 · 기울기에 맞춰 옮기고 키우고 돌린다
//   · 몸 소품(옷 · 등): 머리 · 꼬리를 뺀 몸통 상자 — 기준 컷 상자에 대한 비율로 자리를 잡고 상자 크기에 맞춰 늘인다 (달릴 때 길어진 몸)
//   · clip 소품(옷 · 목 · 무늬)은 실루엣(2px 넉넉히) 밖을 잘라 낸다 — 몸 윤곽 밖으로 삐져나오지 않게. 컷 · 소품마다 한 번 만들어 둔다
//   · behind 1(날개)은 치즈 뒤에. behind 2(가방 — 꼬리보다 앞 · 머리보다 뒤 · 몸통 위)는 뒤에 한 번 그리고, 치즈 위에 "실루엣에서 머리(귀 줄 둘레 원 · 귀)를 뺀 곳"만 한 번 더 —
//     몸 · 꼬리 위로는 가방이 보이고 머리엔 가려진다 (뒤에만 그리면 대기 자세에선 큰 머리와 꼬리에 거의 다 가려졌다)
//   · 냥펀치 줄(두 발)은 옷의 두 발 짝(up, 기준 컷 = 냥펀치 첫 컷), 구르기 줄은 귀가 안 보여 자동으로 숨는다
// 소품마다 보정(src/data/cosmetics-fit.json — dx · dy · k · rot · anchor · clip · behind · r)은 cosmetics.ts fitOf. 왼쪽은 치즈와 함께 좌우로 뒤집는다.
// 도끼 · 배 · 눈밭/모래 시트도 컷마다 재 두었다 (기준 컷은 늘 기본 시트 대기 첫 컷 — 귀 줄 길이 비로 시트마다 다른 그림 배율도 맞는다). 낚시 · 샌드보드 시트는 아직.
import anchorsData from '../data/cat-anchors.json' with { type: 'json' };
import { image } from './assets.ts';
import { CAT_ROW } from './cat.ts';
import { COS, fitOf, fitVersion, wornList, type CosArt, type CosSlot, type Fit } from './cosmetics.ts';
import { drawFrame, type Sheet } from './sheet.ts';

type FrameAnchor = { bbox: number[] | null; ears: { m: number[]; d: number; a: number } | null; body: number[] | null };
const ANCHORS = anchorsData as Record<string, FrameAnchor[][]>;
/** 기준점을 재 둔 시트 → cat-anchors.json 의 이름 */
const keyOf = new Map<Sheet, string>();
let wardrobe: { worn: Partial<Record<CosSlot, string>> } = { worn: {} };
/** 치즈 시트(key = cat-anchors.json 의 이름)와 옷장 (main 이 불러올 때 시트마다 — 옷장 객체를 계속 본다) */
export function setCosmetics(sheet: Sheet, w: { worn: Partial<Record<CosSlot, string>> }, key = 'cat') {
  keyOf.set(sheet, key);
  wardrobe = w;
}

type Placed = { cx: number; cy: number; w: number; h: number; rot: number };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** 소품 자리 (컷 안 px) — 기준 컷에서의 자리를 이 컷의 귀 줄 · 몸통 상자로 옮긴다. 기준점이 없는 컷(구르기)이면 null */
function place(key: string, row: number, col: number, art: CosArt, fit: Fit, up: boolean): Placed | null {
  const F = ANCHORS[key]?.[row]?.[col];
  const R = ANCHORS.cat[up ? CAT_ROW.punch : 0]?.[0]; // 기준 컷은 늘 기본 시트
  if (!F?.ears || !R?.ears || !R.bbox) return null;
  const B = R.bbox;
  const cx = B[0] + (art.hint[0] + fit.dx) * B[2];
  const cy = B[1] + (art.hint[1] + fit.dy) * B[3];
  const w = art.hint[2] * fit.k * B[2];
  const r = fit.r ?? art.r;
  const h = (w * r[3]) / r[2];
  const k = F.ears.d / R.ears.d; // 머리 크기 비 (컷마다 거의 1)
  if (fit.anchor === 'body') {
    // 가로는 몸통 상자에 맞춰 늘이고(달리면 길어진다), 세로는 상자 꼭대기(등선)에서 기준 컷만큼 떨어진 자리에 (다리를 뻗어도 안 늘어나게)
    if (!F.body || !R.body) return null;
    const sx = clamp(F.body[2] / R.body[2], 0.7, 1.4);
    return { cx: F.body[0] + ((cx - R.body[0]) / R.body[2]) * F.body[2], cy: F.body[1] + (cy - R.body[1]) * k, w: w * sx, h: h * k, rot: (fit.rot * Math.PI) / 180 };
  }
  const da = F.ears.a - R.ears.a;
  const ox = cx - R.ears.m[0];
  const oy = cy - R.ears.m[1];
  const c = Math.cos(da);
  const s = Math.sin(da);
  return { cx: F.ears.m[0] + (ox * c - oy * s) * k, cy: F.ears.m[1] + (ox * s + oy * c) * k, w: w * k, h: h * k, rot: da + (fit.rot * Math.PI) / 180 };
}
/** 소품 그림 한 장을 (cx, cy) 가운데 · w × h · rot 으로 — 그리는 쪽이 변환을 걸어 둔 좌표계에 (k = 그 좌표계의 px 배율) */
function blit(ctx: CanvasRenderingContext2D, art: CosArt, r: number[], p: Placed, k: number) {
  const im = image(art.sheet).img;
  if (!im.complete || !im.naturalWidth) return false;
  ctx.save();
  ctx.translate(p.cx * k, p.cy * k);
  ctx.rotate(p.rot);
  ctx.drawImage(im, r[0], r[1], r[2], r[3], (-p.w * k) / 2, (-p.h * k) / 2, p.w * k, p.h * k);
  ctx.restore();
  return true;
}

// ── 잘라 둔 소품: 컷 안 좌표(원본 px)로 소품을 그리고 마스크로 잘라 둔 캔버스 (컷 · 소품 · 보정 판마다 하나, 컷 크기 — 실루엣 밖은 어차피 안 남는다) ──
const masks = new Map<string, HTMLCanvasElement>();
const cut = new Map<string, HTMLCanvasElement>();
let cacheVersion = -1;
/** 실루엣 (2px 넉넉히). body 면 거기서 머리(귀 줄 둘레 원 + 귀 띠)를 뺀 것 */
function maskOf(sheet: Sheet, key: string, row: number, col: number, body: boolean) {
  const id = `${key}:${row},${col}:${body ? 'b' : 's'}`;
  let m = masks.get(id);
  if (m) return m;
  const f = sheet.frames[row][col];
  m = document.createElement('canvas');
  m.width = Math.max(1, Math.round(f.sw));
  m.height = Math.max(1, Math.round(f.sh));
  const g = m.getContext('2d')!;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, dx, dy, m.width, m.height);
  const e = ANCHORS[key]?.[row]?.[col]?.ears;
  if (body && e) {
    g.globalCompositeOperation = 'destination-out';
    g.beginPath();
    g.arc(e.m[0], e.m[1] + e.d * 0.6, e.d * 0.95, 0, Math.PI * 2);
    g.rect(e.m[0] - e.d * 0.8, e.m[1] - e.d * 0.5, e.d * 1.6, e.d);
    g.fill();
  }
  masks.set(id, m);
  return m;
}
/** 소품을 마스크(실루엣 · 머리 뺀 실루엣)로 잘라 둔 캔버스 (그림을 아직 안 불러왔으면 null — 다음에) */
function cutOf(sheet: Sheet, key: string, row: number, col: number, id: string, art: CosArt, r: number[], p: Placed, body: boolean) {
  if (cacheVersion !== fitVersion()) {
    cut.clear();
    cacheVersion = fitVersion();
  }
  const ck = `${key}:${row},${col}:${id}`;
  const done = cut.get(ck);
  if (done) return done;
  const im = image(art.sheet).img;
  if (!im.complete || !im.naturalWidth) return null;
  const m = maskOf(sheet, key, row, col, body);
  const c = document.createElement('canvas');
  c.width = m.width;
  c.height = m.height;
  const g = c.getContext('2d')!;
  blit(g, art, r, p, 1);
  g.globalCompositeOperation = 'destination-in';
  g.drawImage(m, 0, 0);
  cut.set(ck, c);
  return c;
}

function drawLayer(ctx: CanvasRenderingContext2D, sheet: Sheet, key: string, row: number, col: number, ids: string[], s: number, behind: boolean) {
  const f = sheet.frames[row]?.[col];
  if (!f) return;
  const up = key === 'cat' && row === CAT_ROW.punch;
  for (const id of ids) {
    const it = COS[id];
    const fit = fitOf(id);
    if (behind ? !fit.behind : fit.behind === 1) continue; // behind 2 는 두 번 (뒤에 통째로 · 앞에 몸 부분만)
    const art = up && it.up ? it.up : it;
    const r = art === it && fit.r ? fit.r : art.r;
    const p = place(key, row, col, art, fit, up && !!it.up);
    if (!p) continue;
    ctx.save();
    ctx.translate(f.ox * s, f.oy * s);
    if (behind || !(fit.clip || fit.behind === 2)) blit(ctx, art, r, p, s);
    else {
      const c = cutOf(sheet, key, row, col, id, art, r, p, fit.behind === 2);
      if (c) ctx.drawImage(c, 0, 0, c.width * s, c.height * s);
    }
    ctx.restore();
  }
}

/**
 * 치즈 한 컷 + 걸친 소품 (등 소품 → 치즈 → 나머지) — drawFrame 과 같은 인자. 기준점을 모르는 시트면 치즈만 그린다.
 * over = 대신 걸쳐 볼 것 (미용실 입어 보기)
 */
export function drawCatFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  row: number,
  col: number,
  cx: number,
  baseY: number,
  size: number,
  flip: number,
  rowScale = sheet.rowScale[row] ?? 1,
  over?: Partial<Record<CosSlot, string>>,
) {
  const key = keyOf.get(sheet);
  const ids = key ? wornList(over ?? wardrobe.worn) : [];
  if (!ids.length || !key) return drawFrame(ctx, sheet, row, col, cx, baseY, size, flip, rowScale);
  const r = sheet.frames[row];
  const c = Math.min(col, (r?.length ?? 1) - 1);
  const s = (size / sheet.base) * rowScale;
  for (const behind of [true, false]) {
    if (!behind) drawFrame(ctx, sheet, row, col, cx, baseY, size, flip, rowScale);
    ctx.save();
    ctx.translate(cx, baseY);
    ctx.scale(flip, 1);
    drawLayer(ctx, sheet, key, row, c, ids, s, behind);
    ctx.restore();
  }
}
/** 소품 그림 하나 (미용실 칸 · 아이콘) — 가운데 (x, y) 에 box 크기로 */
export function drawCosIcon(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, box: number, dark = false) {
  const it = COS[id];
  const im = image(it.sheet).img;
  if (!im.complete || !im.naturalWidth) return;
  const [sx, sy, sw, sh] = it.r;
  const k = box / Math.max(sw, sh);
  ctx.save();
  if (dark) ctx.globalAlpha *= 0.45;
  ctx.drawImage(im, sx, sy, sw, sh, x - (sw * k) / 2, y - (sh * k) / 2, sw * k, sh * k);
  ctx.restore();
}
