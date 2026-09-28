/**
 * 스프라이트 시트 슬라이서.
 *
 * 시트가 균등 격자에 정렬돼 있지 않아서 고정 크기로 자르면 발이 잘리고 위치가 튄다.
 * 그래서 알파를 훑어 실제 칸을 찾고, 다시 두 가지를 보정한다.
 *
 *  1) 앵커  — 프레임마다 발바닥(실루엣 하단)을 추정하되, 추정 오차가 그대로 떨림이 되므로
 *             행 단위 중앙값으로 고정한다. 의도된 움직임은 남고 배치 노이즈만 걷힌다.
 *  2) 배율  — 행마다 캐릭터 크기가 다르다(이 시트는 151~181px, 17% 차이). 행별 유효 높이로
 *             정규화해서 모션이 바뀔 때 크기가 점프하지 않게 한다.
 */
const ALPHA = 40;
const FOOT_BAND = 0.15; // 발 위치를 볼 실루엣 하단 비율. 꼬리에 끌려가지 않게 하단만 본다

export type Frame = { sx: number; sy: number; sw: number; sh: number; ox: number; oy: number };
export type Sheet = {
  img: HTMLImageElement;
  frames: Frame[][];
  base: number;
  /** 행별 크기 보정. 기준 행(0) 대비 배율 */
  rowScale: number[];
};

/** 내용이 이어지는 구간을 찾아 want 개만 남긴다 (시트 여백의 점 노이즈는 버린다) */
function findBands(on: boolean[], want: number): [number, number][] {
  const raw: [number, number][] = [];
  let s = -1;
  for (let i = 0; i <= on.length; i++) {
    const hit = i < on.length && on[i];
    if (hit && s < 0) s = i;
    if (!hit && s >= 0) {
      raw.push([s, i - 1]);
      s = -1;
    }
  }
  if (raw.length <= want) return raw;
  return raw
    .map((b) => ({ b, size: b[1] - b[0] }))
    .sort((p, q) => q.size - p.size)
    .slice(0, want)
    .sort((p, q) => p.b[0] - q.b[0])
    .map((x) => x.b);
}

const median = (v: number[]) => [...v].sort((a, b) => a - b)[v.length >> 1];

export async function loadSheet(url: string, cols: number, rows: number): Promise<Sheet> {
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

  const rowOn: boolean[] = new Array(h);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    let hit = false;
    for (let x = 0; x < w; x++)
      if (a[off + x]) {
        hit = true;
        break;
      }
    rowOn[y] = hit;
  }

  const frames: Frame[][] = [];
  const rowH: number[] = [];

  for (const [y0, y1] of findBands(rowOn, rows)) {
    const colOn: boolean[] = new Array(w).fill(false);
    for (let y = y0; y <= y1; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) if (a[off + x]) colOn[x] = true;
    }

    // 1차: 프레임마다 실루엣 경계와 발 위치를 잰다.
    // 가로 기준은 균등 칸 중심으로 잡는다 — bbox 중심을 쓰면 앞으로 뻗는 포즈에서
    // bbox 가 넓어지는 만큼 캐릭터가 밀려 보인다.
    const cellW = w / cols;
    const raw = findBands(colOn, cols).map(([x0, x1], i) => {
      let top = y1;
      let bot = y0;
      for (let y = y0; y <= y1; y++) {
        const off = y * w;
        for (let x = x0; x <= x1; x++)
          if (a[off + x]) {
            if (y < top) top = y;
            if (y > bot) bot = y;
            break;
          }
      }

      // 발 x: 하단 띠에 있는 픽셀들의 x 중앙값
      const band = Math.max(2, Math.round((bot - top) * FOOT_BAND));
      const counts = new Int32Array(x1 - x0 + 1);
      let total = 0;
      for (let y = Math.max(top, bot - band); y <= bot; y++) {
        const off = y * w;
        for (let x = x0; x <= x1; x++)
          if (a[off + x]) {
            counts[x - x0]++;
            total++;
          }
      }
      let acc = 0;
      let footX = (x0 + x1) / 2;
      for (let i = 0; i < counts.length; i++) {
        acc += counts[i];
        if (acc * 2 >= total) {
          footX = x0 + i;
          break;
        }
      }

      return { x0, x1, top, bot, footX, cx: (i + 0.5) * cellW, h: bot - top + 1 };
    });

    // 2차: 가로는 프레임별 발 위치에 그대로 맞춘다 — 공격처럼 몸이 앞으로 뻗는 모션에서
    // 행 대표값 하나로 묶으면 캐릭터가 통째로 밀려 보인다.
    // 세로는 행 중앙값으로 고정한다 (프레임마다 재면 지면이 출렁인다).
    const anchorY = median(raw.map((r) => r.bot));
    rowH.push(median(raw.map((r) => r.h)));

    frames.push(
      raw.map((r) => ({
        sx: r.x0,
        sy: r.top,
        sw: r.x1 - r.x0 + 1,
        sh: r.bot - r.top + 1,
        ox: r.x0 - r.footX,
        oy: r.top - anchorY,
      })),
    );
  }

  const baseH = rowH[0] || 1;
  return {
    img,
    frames,
    base: h / rows,
    rowScale: rowH.map((v) => baseH / (v || 1)),
  };
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
  const f = sheet.frames[row]?.[col];
  if (!f) return;
  const s = (size / sheet.base) * rowScale;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(flip, 1);
  ctx.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, f.ox * s, f.oy * s, f.sw * s, f.sh * s);
  ctx.restore();
}
