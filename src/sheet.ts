/**
 * 스프라이트 시트 슬라이서.
 * 시트가 균등 격자에 정렬돼 있지 않아서(캐릭터가 칸 경계를 넘나든다) 고정 크기로 자르면
 * 발이 잘리고 프레임마다 위치가 튄다. 그래서 알파를 훑어 실제 칸 경계를 찾는다.
 */
const ALPHA = 40;

export type Frame = { sx: number; sy: number; sw: number; sh: number };
export type Sheet = { img: HTMLImageElement; frames: Frame[][]; base: number };

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

  const frames = findBands(rowOn, rows).map(([y0, y1]) => {
    const colOn: boolean[] = new Array(w).fill(false);
    for (let y = y0; y <= y1; y++) {
      const off = y * w;
      for (let x = 0; x < w; x++) if (a[off + x]) colOn[x] = true;
    }
    return findBands(colOn, cols).map(([x0, x1]) => {
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
      return { sx: x0, sy: top, sw: x1 - x0 + 1, sh: bot - top + 1 };
    });
  });

  // 크기 기준은 원래 칸 높이. 프레임마다 실제 높이가 달라도 캐릭터 크기는 일정하게 보인다.
  return { img, frames, base: h / rows };
}

/** (cx, baseY) = 발밑. 프레임 실제 경계를 써서 발이 잘리거나 튀지 않는다. */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  sheet: Sheet,
  row: number,
  col: number,
  cx: number,
  baseY: number,
  size: number,
  flip: number,
) {
  const f = sheet.frames[row]?.[col];
  if (!f) return;
  const s = size / sheet.base;
  const w = f.sw * s;
  const h = f.sh * s;
  ctx.save();
  ctx.translate(cx, baseY);
  ctx.scale(flip, 1);
  ctx.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, -w / 2, -h, w, h);
  ctx.restore();
}
