// node tools/terrain.mjs — 필드 그림 색으로 지형 마스크 초안을 만든다.
//
// 결과: src/assets/field-terrain.png (필드 그림과 같은 크기, 색 네 가지)
//   흰색 = 걷기, 초록 = 숲(도끼), 파랑 = 물(배), 검정 = 못 감(초안엔 없음. 직접 칠하면 막힌다)
// 초안이라 숲 경계는 거칠다. 그림 편집기에서 필드 위에 겹쳐 놓고 고치면 된다.
// ⚠ 직접 고친 뒤 이 스크립트를 다시 돌리면 덮어쓴다. 필드 그림을 바꿨을 때만 다시 돌린다.
//
// 미리보기: tools/out/terrain-preview.png (필드 위에 마스크를 반투명으로 겹친 것)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const SRC = new URL('../src/assets/field.webp', import.meta.url);
const OUT = new URL('../src/assets/field-terrain.png', import.meta.url);
const PREVIEW = new URL('./out/terrain-preview.png', import.meta.url);

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const b64 = fs.readFileSync(SRC).toString('base64');

const { mask, preview, stats } = await page.evaluate(async (b64) => {
  const im = new Image();
  im.src = 'data:image/webp;base64,' + b64;
  await im.decode();
  const W = im.naturalWidth;
  const H = im.naturalHeight;
  // 반 해상도에서 판정한다 (칸 하나 = 원본 2px). 평균 색이 노이즈를 줄여 준다.
  const w = Math.ceil(W / 2);
  const h = Math.ceil(H / 2);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(im, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;

  const N = w * h;
  const water = new Uint8Array(N);
  const tree = new Uint8Array(N);
  const path = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4];
    const gg = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const L = 0.3 * r + 0.59 * gg + 0.11 * b;
    water[i] = b > r + 35 && b > gg - 25 && b > 110 ? 1 : 0;
    // 나무: 초록이 앞서고, 풀밭보다 어둡거나 푸른 기가 돈다 (풀밭은 밝은 연두)
    // 진한 청록 침엽수는 파랑이 초록만큼 높아서 따로 잡는다
    tree[i] = (gg > r + 8 && gg > b + 5 && (L < 135 || r < gg * 0.55)) || (L < 115 && gg > r + 5 && gg >= b - 15) ? 1 : 0;
    // 흙길·모래: 붉은 기 > 초록 > 파랑, 밝다
    path[i] = r >= gg && gg > b && r - b > 45 && L > 150 ? 1 : 0;
  }

  // 사각 반경 rad 의 팽창/침식 (가로 한 번, 세로 한 번)
  const morph = (src, rad, grow) => {
    const tmp = new Uint8Array(N);
    const out = new Uint8Array(N);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let k = -rad; k <= rad; k++) {
          const xx = Math.min(w - 1, Math.max(0, x + k));
          v = grow ? v | src[y * w + xx] : v & src[y * w + xx];
        }
        tmp[y * w + x] = v;
      }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let v = grow ? 0 : 1;
        for (let k = -rad; k <= rad; k++) {
          const yy = Math.min(h - 1, Math.max(0, y + k));
          v = grow ? v | tmp[yy * w + x] : v & tmp[yy * w + x];
        }
        out[y * w + x] = v;
      }
    return out;
  };
  const open = (m, r) => morph(morph(m, r, false), r, true);
  const close = (m, r) => morph(morph(m, r, true), r, false);

  // 물: 작은 파란 조각은 버리고(차양·지붕), 물속 작은 구멍(거품·말뚝·연잎)은 메운다. 다리는 남는 폭.
  const wet = close(open(water, 2), 3);

  // 숲: 주변 (2R+1)² 안에 나무 픽셀이 45% 넘으면 숲. 들판의 나무 한 그루로는 숲이 안 된다.
  const R = 12;
  const sum = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      sum[(y + 1) * (w + 1) + x + 1] = tree[y * w + x] + sum[y * (w + 1) + x + 1] + sum[(y + 1) * (w + 1) + x] - sum[y * (w + 1) + x];
  const dense = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - R);
      const y0 = Math.max(0, y - R);
      const x1 = Math.min(w, x + R + 1);
      const y1 = Math.min(h, y + R + 1);
      const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0];
      dense[y * w + x] = s / ((x1 - x0) * (y1 - y0)) >= 0.45 ? 1 : 0;
    }
  const forest = open(dense, 2);

  // 합치기: 물 > 길 > 숲 > 걷기
  const WALK = [255, 255, 255];
  const FOREST = [31, 157, 58];
  const WATER = [30, 111, 224];
  const cls = new Uint8Array(N);
  let nWater = 0;
  let nForest = 0;
  for (let i = 0; i < N; i++) {
    cls[i] = wet[i] ? 2 : path[i] ? 0 : forest[i] ? 1 : 0;
    if (cls[i] === 2) nWater++;
    if (cls[i] === 1) nForest++;
  }

  // 원본 크기로 (최근접) 색 칠하기
  const mc = document.createElement('canvas');
  mc.width = W;
  mc.height = H;
  const mg = mc.getContext('2d');
  const md = mg.createImageData(W, H);
  const pal = [WALK, FOREST, WATER];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const col = pal[cls[(y >> 1) * w + (x >> 1)]];
      const o = (y * W + x) * 4;
      md.data[o] = col[0];
      md.data[o + 1] = col[1];
      md.data[o + 2] = col[2];
      md.data[o + 3] = 255;
    }
  mg.putImageData(md, 0, 0);

  const pc = document.createElement('canvas');
  pc.width = W;
  pc.height = H;
  const pg = pc.getContext('2d');
  pg.drawImage(im, 0, 0);
  // 한눈에 보이게: 숲 = 분홍, 물 = 하늘색 반투명
  const ov = pg.createImageData(W, H);
  const tint = [null, [255, 0, 170, 110], [0, 210, 255, 90]];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = tint[cls[(y >> 1) * w + (x >> 1)]];
      if (!t) continue;
      const o = (y * W + x) * 4;
      ov.data.set(t, o);
    }
  const oc = document.createElement('canvas');
  oc.width = W;
  oc.height = H;
  oc.getContext('2d').putImageData(ov, 0, 0);
  pg.drawImage(oc, 0, 0);

  return {
    mask: mc.toDataURL('image/png').split(',')[1],
    preview: pc.toDataURL('image/png').split(',')[1],
    stats: { water: ((100 * nWater) / N).toFixed(1) + '%', forest: ((100 * nForest) / N).toFixed(1) + '%' },
  };
}, b64);

fs.writeFileSync(OUT, Buffer.from(mask, 'base64'));
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(PREVIEW, Buffer.from(preview, 'base64'));
await browser.close();
console.log(`saved ${fileURLToPath(OUT)} (${(fs.statSync(OUT).size / 1024) | 0}KB)  물 ${stats.water} · 숲 ${stats.forest}`);
console.log(`preview ${fileURLToPath(PREVIEW)}`);
