/**
 * 스프라이트 시트 슬라이서.
 *
 * 시트가 균등 격자에 정렬돼 있지 않아서 고정 크기로 자르면 발이 잘리고 위치가 튄다.
 * 그래서 알파를 훑어 실제 칸을 찾고, 다시 두 가지를 보정한다.
 *
 *  1) 앵커  — 가로는 프레임마다 몸 무게중심(전체 픽셀 x 의 중앙값)에 맞춘다. 꼬리·칼·주먹처럼
 *             가는 부분은 거의 영향이 없어서, 공격 때 몸이 앞으로 밀려나오지 않고 돌아설 때도
 *             몸이 제자리에서 뒤집힌다. 세로는 행 단위 발바닥 중앙값으로 고정해 땅에 붙인다.
 *  2) 배율  — 행마다 캐릭터 크기가 다르다(이 시트는 151~181px, 17% 차이). 행별 유효 높이로
 *             정규화해서 모션이 바뀔 때 크기가 점프하지 않게 한다.
 *  3) 배     — 배 시트는 무게중심 대신 선체(바닥 쪽 가장 긴 가로줄) 가운데를 기준으로 잡는다.
 *             고양이가 배로 뛰어들고 내리는 동안 무게중심을 쓰면 배가 좌우로 미끄러진다.
 *
 * 칸은 직선(빈 줄)으로 가르지만, 픽셀은 이어진 덩어리 단위로 주인 칸을 정한다. 칼끝·볏·혀처럼 옆 칸 범위로
 * 넘어간 부분도 몸과 이어져 있으니 제 칸으로 간다 (직선으로만 자르면 잘려서 옆 컷 가장자리에 붙는다).
 * 그런 시트는 칸마다 자기 픽셀만 새 캔버스에 옮겨 담아 그린다. 두 컷이 실제로 맞붙은 곳만 직선으로 가르고 joined 로 알린다.
 */
const ALPHA = 40;
/** 한 덩어리가 두 칸에 이만큼 넘게 걸쳐 있으면 두 컷이 맞붙은 것 (칼끝·볏은 몇 %) */
const JOINED = 0.3;

export type Frame = { sx: number; sy: number; sw: number; sh: number; ox: number; oy: number };
export type Sheet = {
  /** 그릴 그림 — 칸 범위를 넘은 그림이 있는 시트는 칸마다 자기 픽셀만 옮겨 담은 캔버스 */
  img: CanvasImageSource;
  frames: Frame[][];
  base: number;
  /** 행별 크기 보정. 기준 행(0) 대비 배율 */
  rowScale: number[];
  /** 기준 행(0)의 캐릭터 키 (원본 px). 시트끼리 같은 키로 맞출 때 쓴다 */
  bodyH: number;
  /** 그림이 옆 컷과 실제로 맞붙어 직선으로 가른 칸 [행, 열] — 그림을 고쳐야 깨끗해진다 (npm run verify 가 알린다) */
  joined: [number, number][];
};

export type SheetOptions = { anchor?: 'mass' | 'hull' };

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

/**
 * 내용이 이어지는 구간을 찾아 want 개로 맞춘다.
 * - 여백의 점 노이즈(보통 조각의 15% 미만)는 버린다.
 * - 그래도 많으면 한 프레임이 떨어진 조각으로 나뉜 것이다 (배에서 내려 옆에 선 고양이처럼).
 *   버리지 않고 가장 가까운 이웃끼리 합친다.
 */
/**
 * cover[i] = i 번째 줄(열)의 알파 픽셀 수. 알파가 있는 구간을 찾아 want 개로 맞춘다.
 * - 많으면: 점 노이즈(보통 폭의 15% 미만)를 버리고, 그래도 많으면 가장 가까운 구간끼리 합친다.
 * - 가는 조각(효과선 등, 보통 폭의 35% 미만)은 가까운 옆 구간에 붙인다 — 그대로 두면 한 칸을 차지하고
 *   대신 진짜 두 컷이 한 칸으로 합쳐진다 (갈매기 선원 공격 행).
 * - 모자라면: 가장 넓은 구간을 가운데 절반에서 알파가 가장 적은 줄로 가른다 — 칼끝·주먹·볏이 옆 칸에
 *   닿으면 사이에 빈 줄이 없다 (칼 쥐·뚱보 쥐 공격 행, 얼음볏 펭귄 행).
 */
function findBands(cover: Int32Array, want: number): [number, number][] {
  let raw: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= cover.length; i++) {
    const hit = i < cover.length && cover[i] > 0;
    if (hit && s < 0) s = i;
    if (!hit && s >= 0) {
      raw.push([s, i - 1]);
      s = -1;
    }
  }
  const width = ([a, b]: [number, number]) => b - a + 1;
  if (raw.length > want) {
    const usual = median(raw.map(width));
    raw = raw.filter((r) => width(r) >= usual * 0.15);
  }
  while (raw.length > want) {
    let gi = 0;
    for (let i = 1; i < raw.length - 1; i++)
      if (raw[i + 1][0] - raw[i][1] < raw[gi + 1][0] - raw[gi][1]) gi = i;
    raw.splice(gi, 2, [raw[gi][0], raw[gi + 1][1]]);
  }
  const usual = median(raw.map(width));
  for (let i = 0; i < raw.length && raw.length > 1; ) {
    if (width(raw[i]) >= usual * 0.35) {
      i++;
      continue;
    }
    const gapL = i > 0 ? raw[i][0] - raw[i - 1][1] : Infinity;
    const gapR = i < raw.length - 1 ? raw[i + 1][0] - raw[i][1] : Infinity;
    const j = gapL <= gapR ? i - 1 : i + 1;
    raw[j] = [Math.min(raw[j][0], raw[i][0]), Math.max(raw[j][1], raw[i][1])];
    raw.splice(i, 1);
    if (j < i) i--;
  }
  while (raw.length < want && raw.length) {
    let wi = 0;
    for (let i = 1; i < raw.length; i++) if (width(raw[i]) > width(raw[wi])) wi = i;
    const [b0, b1] = raw[wi];
    const q = Math.floor((b1 - b0) / 4);
    let cut = b0 + q;
    for (let x = b0 + q; x <= b1 - q; x++) if (cover[x] < cover[cut]) cut = x;
    raw.splice(wi, 1, [b0, cut - 1], [cut, b1]);
  }
  return raw;
}

export async function loadSheet(url: string, cols: number, rows: number, opts: SheetOptions = {}): Promise<Sheet> {
  const img = new Image();
  // decode() 는 큰 PNG 에서 간헐적으로 멈춘다. onload 로 기다린다.
  await new Promise<void>((ok, fail) => {
    img.onload = () => ok();
    img.onerror = () => fail(new Error('시트 로드 실패: ' + url));
    img.src = url;
  });

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);

  // 알파만 1바이트 배열로 뽑아 둔다 — RGBA 를 매번 건너뛰며 읽으면 훨씬 느리다
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const a = new Uint8Array(w * h);
  for (let i = 0, j = 3; i < a.length; i++, j += 4) a[i] = rgba[j] > ALPHA ? 1 : 0;

  const rowCover = new Int32Array(h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w; x++) rowCover[y] += a[off + x];
  }

  // 칸 = 행 구간 × (행마다) 열 구간. cellAt(p) = 픽셀 p 가 든 칸 (없으면 -1)
  type Cell = { r: number; x0: number; x1: number; y0: number; y1: number };
  const cells: Cell[] = [];
  const byRow: number[][] = [];
  const rowOf = new Int16Array(h).fill(-1);
  const cellOfX: Int16Array[] = [];
  // 빈 줄 없이 붙은 구간 (findBands 가 맞닿은 곳을 가른 것). 빈 줄로 나뉜 곳은 덩어리가 넘을 수 없으니
  // 덩어리는 맞닿은 행에서만 찾는다 (행끼리 맞닿았으면 시트 전체)
  const adjacent = (bs: [number, number][]) => bs.some((b, i) => i > 0 && bs[i - 1][1] + 1 === b[0]);
  const rowBands = findBands(rowCover, rows);
  const tightRows: [number, number][] = [];
  rowBands.forEach(([y0, y1], r) => {
    for (let y = y0; y <= y1; y++) rowOf[y] = r;
    const cover = new Int32Array(w);
    for (let y = y0; y <= y1; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) cover[x] += a[off + x];
    }
    const m = new Int16Array(w).fill(-1);
    const bands = findBands(cover, cols);
    if (adjacent(bands)) tightRows.push([y0, y1]);
    byRow.push(
      bands.map(([x0, x1]) => {
        for (let x = x0; x <= x1; x++) m[x] = cells.length;
        cells.push({ r, x0, x1, y0, y1 });
        return cells.length - 1;
      }),
    );
    cellOfX.push(m);
  });
  const cellAt = (p: number) => {
    const r = rowOf[(p / w) | 0];
    return r < 0 ? -1 : cellOfX[r][p % w];
  };

  // 픽셀 덩어리(8방향으로 이어진 불투명 픽셀)마다 주인 칸 = 가장 많이 들어 있는 칸. 맞닿은 곳이 없으면 든 칸 그대로
  const owner = new Int16Array(w * h).fill(-1);
  let seen = new Uint8Array(0);
  const joined = new Set<number>();
  let moved = false; // 제 칸 범위 밖에 있는 픽셀이 있다 → 칸마다 다시 담는다
  const px: number[] = [];
  for (let y = 0; y < h; y++) {
    if (rowOf[y] < 0) continue;
    const m = cellOfX[rowOf[y]];
    for (let x = 0, p = y * w; x < w; x++, p++) if (a[p]) owner[p] = m[x];
  }
  // 덩어리를 찾을 곳: 열끼리 맞닿은 행 + 서로 맞닿은 두 행
  const search = [...tightRows, ...rowBands.flatMap((b, i) => (i > 0 && rowBands[i - 1][1] + 1 === b[0] ? [[rowBands[i - 1][0], b[1]]] : []))];
  const count = new Int32Array(cells.length + 1); // 칸마다 픽셀 수 ([0] = 칸 밖)
  const group = (p0: number) => {
    px.length = 0;
    px.push(p0);
    seen[p0] = 1;
    count.fill(0);
    for (let i = 0; i < px.length; i++) {
      const p = px[i];
      count[owner[p] + 1]++;
      const x = p % w;
      const y = (p - x) / w;
      const xa = x > 0 ? x - 1 : 0;
      const xb = x < w - 1 ? x + 1 : x;
      for (let ny = y > 0 ? y - 1 : 0; ny <= (y < h - 1 ? y + 1 : y); ny++)
        for (let q = ny * w + xa, qe = ny * w + xb; q <= qe; q++)
          if (a[q] && !seen[q]) {
            seen[q] = 1;
            px.push(q);
          }
    }
    let best = 0;
    for (let k = 1; k < count.length; k++) if (count[k] > count[best]) best = k;
    if (best === 0) return; // 거의 칸 밖인 점 노이즈 — 든 칸 그대로
    let second = -1;
    for (let k = 1; k < count.length; k++) if (k !== best && (second < 0 || count[k] > count[second])) second = k;
    if (second > 0 && count[second] >= px.length * JOINED) {
      joined.add(best - 1).add(second - 1); // 두 컷이 맞붙었다 — 칸 경계(직선)로 가른 그대로 둔다
      return;
    }
    for (const p of px) {
      if (owner[p] !== best - 1) moved = true;
      owner[p] = best - 1;
    }
  };
  if (search.length) seen = new Uint8Array(w * h);
  for (const [ya, yb] of search) for (let p = ya * w; p < (yb + 1) * w; p++) if (a[p] && !seen[p]) group(p);

  // 칸마다 자기 픽셀의 경계 상자
  const box = cells.map((c) => ({ left: w, right: -1, top: h, bot: -1, c }));
  for (let y = 0; y < h; y++)
    for (let x = 0, p = y * w; x < w; x++, p++) {
      const k = owner[p];
      if (k < 0) continue;
      const b = box[k];
      if (x < b.left) b.left = x;
      if (x > b.right) b.right = x;
      if (y < b.top) b.top = y;
      if (y > b.bot) b.bot = y;
    }

  const frames: Frame[][] = [];
  const rowH: number[] = [];
  for (const ids of byRow) {
    // 1차: 프레임마다 실루엣 경계와 발 위치를 잰다
    const raw = ids.map((k) => {
      const b = box[k];
      if (b.right < 0) Object.assign(b, { left: b.c.x0, right: b.c.x1, top: b.c.y0, bot: b.c.y1 }); // 빈 칸
      const { left: x0, right: x1, top, bot } = b;

      // 무게중심 x: 프레임 전체 픽셀의 x 중앙값. 꼬리·칼처럼 가는 부분은 거의 영향이 없다
      const all = new Int32Array(x1 - x0 + 1);
      let n = 0;
      for (let y = top; y <= bot; y++) {
        const off = y * w;
        for (let x = x0; x <= x1; x++)
          if (owner[off + x] === k) {
            all[x - x0]++;
            n++;
          }
      }
      let massX = (x0 + x1) / 2;
      for (let i = 0, c = 0; i < all.length; i++) {
        c += all[i];
        if (c * 2 >= n) {
          massX = x0 + i;
          break;
        }
      }

      // 배 시트: 바닥 40% 안에서 줄마다 가장 긴 가로 구간(선체)을 찾아 그 가운데의 중앙값
      let anchorX = massX;
      if (opts.anchor === 'hull') {
        const centers: number[] = [];
        for (let y = Math.round(bot - (bot - top) * 0.4); y <= bot; y++) {
          const off = y * w;
          let best = 0;
          let at = 0;
          let run = 0;
          for (let x = x0; x <= x1 + 1; x++) {
            if (x <= x1 && owner[off + x] === k) run++;
            else {
              if (run > best) {
                best = run;
                at = x - run / 2;
              }
              run = 0;
            }
          }
          if (best > (x1 - x0) * 0.25) centers.push(at);
        }
        if (centers.length) anchorX = median(centers);
      }

      return { k, x0, x1, top, bot, anchorX, h: bot - top + 1 };
    });

    // 2차: 세로 바닥은 행 중앙값으로 고정한다 (프레임마다 재면 지면이 출렁인다)
    const anchorY = median(raw.map((r) => r.bot));
    rowH.push(median(raw.map((r) => r.h)));

    frames.push(
      raw.map((r) => ({
        sx: r.x0,
        sy: r.top,
        sw: r.x1 - r.x0 + 1,
        sh: r.bot - r.top + 1,
        ox: r.x0 - r.anchorX,
        oy: r.top - anchorY,
      })),
    );
  }

  const baseH = rowH[0] || 1;
  return {
    img: moved ? repack(rgba, w, owner, cellAt, frames, byRow) : img,
    frames,
    base: h / rows,
    rowScale: rowH.map((v) => baseH / (v || 1)),
    bodyH: baseH,
    joined: [...joined].map((k) => [cells[k].r, byRow[cells[k].r].indexOf(k)] as [number, number]),
  };
}

/**
 * 칸마다 자기 픽셀만 새 캔버스에 옮겨 담는다 (한 행씩 가로로, 2px 틈). frames 의 sx·sy 를 새 자리로 바꾼다.
 * 옅은 픽셀(알파 ALPHA 이하 — 외곽선 번짐)은 바로 옆 불투명 픽셀의 주인을 따른다. 없으면 든 칸.
 */
function repack(rgba: Uint8ClampedArray, w: number, owner: Int16Array, cellAt: (p: number) => number, frames: Frame[][], byRow: number[][]) {
  const PAD = 2;
  const h = rgba.length / 4 / w;
  /** 옅은 픽셀의 주인 */
  const faint = (p: number) => {
    const x = p % w;
    const y = (p - x) / w;
    for (let ny = Math.max(0, y - 1); ny <= Math.min(h - 1, y + 1); ny++)
      for (let nx = Math.max(0, x - 1); nx <= Math.min(w - 1, x + 1); nx++) if (owner[ny * w + nx] >= 0) return owner[ny * w + nx];
    return cellAt(p);
  };
  const W = Math.max(...frames.map((r) => r.reduce((s, f) => s + f.sw + PAD, PAD)));
  const H = frames.reduce((s, r) => s + Math.max(...r.map((f) => f.sh)) + PAD, PAD);
  const out = new ImageData(W, H);
  const d = out.data;
  let y0 = PAD;
  frames.forEach((r, ri) => {
    let x0 = PAD;
    r.forEach((f, ci) => {
      const k = byRow[ri][ci];
      for (let y = 0; y < f.sh; y++)
        for (let x = 0, p = (f.sy + y) * w + f.sx, o = ((y0 + y) * W + x0) * 4; x < f.sw; x++, p++, o += 4) {
          const s = p * 4;
          if (!rgba[s + 3] || (owner[p] >= 0 ? owner[p] : faint(p)) !== k) continue;
          d[o] = rgba[s];
          d[o + 1] = rgba[s + 1];
          d[o + 2] = rgba[s + 2];
          d[o + 3] = rgba[s + 3];
        }
      f.sx = x0;
      f.sy = y0;
      x0 += f.sw + PAD;
    });
    y0 += Math.max(...r.map((f) => f.sh)) + PAD;
  });
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d')!.putImageData(out, 0, 0);
  return c;
}

/**
 * (cx, baseY) = 발밑. rowScale 을 직접 넘기면 모션이 바뀔 때 크기를 부드럽게 이을 수 있다.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  row: number,
  col: number,
  cx: number,
  baseY: number,
  size: number,
  flip: number,
  rowScale = sheet.rowScale[row] ?? 1,
) {
  const r = sheet.frames[row];
  const f = r?.[Math.min(col, r.length - 1)]; // 칸이 모자라도 사라지지 않게
  if (!f) return;
  const s = (size / sheet.base) * rowScale;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(flip, 1);
  ctx.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, f.ox * s, f.oy * s, f.sw * s, f.sh * s);
  ctx.restore();
}
