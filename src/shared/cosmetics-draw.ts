// 꾸미기 소품 그리기 — 치즈 기본 시트(cat_action_sheet)로 그릴 때 그 컷 위에 걸친 소품을 얹는다.
// 자리는 소품마다 hint(치즈 컷의 그림 범위에 대한 비율 — 가운데 · 너비)로: 컷마다 그림 범위(알파 32 넘는 곳)를 한 번 재 두고 거기에 맞춘다.
// 냥펀치 줄(두 발로 선 자세)은 옷의 두 발 짝(up), 구르기 줄은 소품을 숨긴다 (README — 크게 구르는 동작은 소품 하나로 못 맞춘다).
// 도끼 · 배 · 눈밭 · 낚시 · 샌드보드 시트는 아직 안 얹는다 (그 시트용 자리를 따로 재야 한다). 왼쪽은 치즈와 함께 좌우로 뒤집는다.
import { image } from './assets.ts';
import { CAT_ROW } from './cat.ts';
import { COS, wornList, type CosArt, type CosSlot } from './cosmetics.ts';
import { type Sheet } from './sheet.ts';

let base: Sheet | null = null;
let wardrobe: { worn: Partial<Record<CosSlot, string>> } = { worn: {} };
/** 치즈 기본 시트와 옷장 (main 이 처음에 한 번 — 옷장 객체를 계속 본다) */
export function setCosmetics(sheet: Sheet, w: { worn: Partial<Record<CosSlot, string>> }) {
  base = sheet;
  wardrobe = w;
}

/**
 * 컷마다 소품을 맞출 범위 (시트 원본 px, 컷 왼쪽 위 기준) — 그림 범위를 그대로 쓰면 꼬리가 뻗는 컷마다 범위가 넓어져 소품이 커지고 밀린다.
 * 그래서 머리를 잰다: 위쪽 30% 띠에서 가장 넓게 이어진 가로줄 = 머리 너비 · 그 가운데 = 머리 가운데 (꼬리는 가늘어서 안 걸린다).
 * 소품 hint 는 기준 컷(대기 첫 컷)의 그림 범위 비율이라, 머리 너비 · 가운데 · 정수리 · 발밑으로 "그 컷이었다면 범위가 어땠을지"를 되짚어 쓴다
 */
type Meas = { x0: number; y0: number; w: number; h: number; hcx: number; htop: number; hw: number };
const meas = new Map<string, Meas | null>();
function measure(sheet: Sheet, row: number, col: number): Meas | null {
  const key = `${row},${col}`;
  if (meas.has(key)) return meas.get(key)!;
  const f = sheet.frames[row]?.[col];
  let m: Meas | null = null;
  if (f) {
    const W = Math.max(1, Math.round(f.sw));
    const H = Math.max(1, Math.round(f.sh));
    const c = document.createElement('canvas');
    [c.width, c.height] = [W, H];
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    const on = (x: number, y: number) => d[(y * W + x) * 4 + 3] > 32;
    let [x0, y0, x1, y1] = [W, H, -1, -1];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (on(x, y)) [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    if (x1 >= 0) {
      const h = y1 - y0 + 1;
      // 머리: 위쪽 띠의 줄마다 가장 긴 이어진 칸 (너비 · 가운데)
      const runs: [number, number][] = [];
      for (let y = y0; y < y0 + h * 0.32; y++) {
        let run = 0;
        let best: [number, number] = [0, 0];
        for (let x = x0; x <= x1 + 1; x++) {
          if (x <= x1 && on(x, y)) run++;
          else if (run) {
            if (run > best[0]) best = [run, x - run / 2];
            run = 0;
          }
        }
        if (best[0]) runs.push(best);
      }
      const hw = Math.max(...runs.map((r) => r[0]), 1);
      m = { x0, y0, w: x1 - x0 + 1, h, hcx: 0, htop: y0, hw };
      m.hcx = runs.filter((r) => r[0] >= hw * 0.7).map((r) => r[1]).sort((a, b) => a - b)[0] ?? (x0 + x1) / 2;
    }
  }
  meas.set(key, m);
  return m;
}
/** 소품을 맞출 범위 (컷 원본 px) — 기준 컷과 머리 크기 · 자리가 같아지게 */
function fitBox(sheet: Sheet, row: number, col: number): [number, number, number, number] | null {
  const m = measure(sheet, row, col);
  const r = measure(sheet, 0, 0);
  if (!m || !r || !m.hw || !r.hw) return null;
  const k = 1; // 컷마다 머리 크기는 같다 (앞발이 머리에 붙으면 머리를 크게 재서 재지 않는다)
  const bw = r.w * k;
  const bx = m.hcx - ((r.hcx - r.x0) / r.w) * bw;
  const by = m.htop - (r.htop - r.y0) * k;
  const bh = Math.max(r.h * k * 0.6, m.y0 + m.h - by); // 발밑까지 (웅크린 컷도 너무 납작해지지 않게)
  return [bx, by, bw, bh];
}

/** 칸별 보정 [x, y, 너비 배] — 소품 시트의 hint 는 확정 값이 아니라 출발값이라 치즈 시트에 대 보고 고른 값 (tools/out/cos-peek) */
const TWEAK: Partial<Record<CosSlot, [number, number, number]>> = {
  face: [0, -0.07, 0.78],
  neck: [0, 0.04, 0.82],
};
/** 소품 한 장을 컷 범위(bx, by, bw, bh — 그릴 좌표)에 맞춰 */
function drawArt(ctx: CanvasRenderingContext2D, a: CosArt, bx: number, by: number, bw: number, bh: number, slot?: CosSlot) {
  const im = image(a.sheet).img;
  if (!im.complete || !im.naturalWidth) return;
  const [sx, sy, sw, sh] = a.r;
  const [tx, ty, tk] = (slot && TWEAK[slot]) || [0, 0, 1];
  const [hx, hy, hw] = [a.hint[0] + tx, a.hint[1] + ty, a.hint[2] * tk];
  const w = bw * hw;
  const h = (w * sh) / sw;
  ctx.drawImage(im, sx, sy, sw, sh, bx + bw * hx - w / 2, by + bh * hy - h / 2, w, h);
}

/**
 * 치즈 컷 위에 걸친 소품 — drawFrame 과 같은 인자 (발밑 cx, baseY · size · flip · rowScale). 기본 시트가 아니면 아무것도 안 한다.
 * over = 대신 걸쳐 볼 것 (미용실 미리 보기)
 */
export function drawWorn(
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
  if (sheet !== base || row === CAT_ROW.roll) return;
  const ids = wornList(over ?? wardrobe.worn);
  if (!ids.length) return;
  const r = sheet.frames[row];
  const c = Math.min(col, (r?.length ?? 1) - 1);
  const f = r?.[c];
  const b = f && fitBox(sheet, row, c);
  if (!f || !b) return;
  const s = (size / sheet.base) * rowScale;
  const upright = row === CAT_ROW.punch;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(flip, 1);
  const [bx, by, bw, bh] = [(f.ox + b[0]) * s, (f.oy + b[1]) * s, b[2] * s, b[3] * s];
  for (const id of ids) {
    const it = COS[id];
    drawArt(ctx, upright && it.up ? it.up : it, bx, by, bw, bh, it.slot);
  }
  ctx.restore();
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
