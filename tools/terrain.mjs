// node tools/terrain.mjs [--force] [--preview] — 개방 구역(field.json open) 조각들의 지형 마스크를 그림 색으로 만든다.
//
// 결과: src/assets/world/masks/mask_rR_cC.png (조각과 같은 크기). 채널 하나에 지형 하나 (src/field-draw.ts 가 읽는 형식):
//   R = 막힘  — 생성기는 칠하지 않는다 (사용자 결정 2026-10-06: 절벽·바위도 막지 않는다. 손으로 칠하면 여전히 막힌다)
//   G = 숲 (도끼)   B = 물 (배)   A = 다리 — 투명한 곳 (있던 마스크의 다리는 그대로 가져온다. 손으로 칠한 것이라 생성기는 만들지 않는다)
//   셋 다 검정·불투명 = 걷기.  겹치면 다리 > 막힘 > 물 > 숲.
// 규칙:
//   - 개방 구역 조각들을 한 장으로 이어 붙여 반 해상도(칸 하나 = 원본 2px)에서 판정한다 — 조각 경계에 걸친 섬·배도 한 덩어리로 본다.
//   - 높은 구조물(바위·배·나무·집)이 물이나 숲을 가리면 그 밑은 원래 지형이다 (사용자 요청):
//       물·숲을 닫기(팽창 → 침식)로 메워 폭이 좁은 끼어듦을 지우고, 바다 한가운데 풀·모래가 거의 없는 작은 덩어리(바위섬·배)는 물로 본다.
//     나무 널빤지(선착장)는 닫기에 안 먹힌다 — 걸어 들어갈 수 있어야 한다.
//   - 작은 물(분수·웅덩이·오아시스 · 반 해상도 4000칸 = 원본 약 126×126 미만)은 배를 탈 물이 아니다 → 걷기.
//     다리로 끊긴 강은 다리 너머 물과 한 덩어리로 센다 (다리 사이 강 토막이 작은 물로 지워지지 않게).
//   - 작은 숲 조각(600칸 미만 — 야자수 몇 그루·소나무 두어 그루)은 숲이 아니다 → 걷기 (잠깐 스치며 도끼를 꺼내지 않게).
//   - 시작점·워프·돌아올 자리 둘레(원본 30px)는 무조건 걷기.
// 마스크가 이미 칠해져 있으면 덮어쓰지 않고 멈춘다 (--force). --preview 는 지금 마스크로 미리보기만 (마스크는 그대로).
// 미리보기: tools/out/terrain-preview.png (그림 위에 숲 분홍 · 물 하늘색 · 막힘 빨강 · 다리 노랑)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = new URL('../', import.meta.url);
const TILES = new URL('src/assets/world/tiles/', ROOT);
const MASKS = new URL('src/assets/world/masks/', ROOT);
const PREVIEW = new URL('tools/out/terrain-preview.png', ROOT);
const field = JSON.parse(fs.readFileSync(new URL('src/data/field.json', ROOT), 'utf8'));
const [COLS, ROWS] = field.grid;
const [FW, FH] = field.size;
const tileW = (c) => (c === COLS - 1 ? FW - Math.floor((FW * c) / COLS) : Math.floor((FW * (c + 1)) / COLS) - Math.floor((FW * c) / COLS));
const tileY = (r) => Math.floor((FH * r) / ROWS);
const tileH = (r) => (r === ROWS - 1 ? FH - tileY(r) : tileY(r + 1) - tileY(r));
const open = field.open;
const rr = [open.r[0], open.r[1]];
const cc = [open.c[0], open.c[1]];
const X0 = Math.floor((FW * cc[0]) / COLS);
const Y0 = tileY(rr[0]);
const W = Math.floor((FW * (cc[1] + 1)) / COLS) - X0;
const H = tileY(rr[1]) + tileH(rr[1]) - Y0;
const preview = process.argv.includes('--preview');
const force = process.argv.includes('--force');

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );
const tiles = [];
for (let r = rr[0]; r <= rr[1]; r++)
  for (let c = cc[0]; c <= cc[1]; c++) {
    const name = `r${r}_c${c}`;
    const mask = new URL(`mask_${name}.png`, MASKS);
    tiles.push({
      name,
      x: Math.floor((FW * c) / COLS) - X0,
      y: tileY(r) - Y0,
      w: tileW(c),
      h: tileH(r),
      tile: fs.readFileSync(new URL(`tile_${name}.webp`, TILES)).toString('base64'),
      mask: fs.existsSync(mask) ? fs.readFileSync(mask).toString('base64') : null,
    });
  }
// 막혀서는 안 되는 곳 (이어 붙인 그림 기준 좌표)
const keep = [field.start, ...field.warps.flatMap((w) => [w.at, w.back])].map(([x, y]) => [x - X0, y - Y0]).filter(([x, y]) => x >= 0 && y >= 0 && x < W && y < H);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('   ', m.text()));

const result = await page.evaluate(
  async (tiles, keep, W, H, preview) => {
    const load = async (src) => {
      const im = new Image();
      im.src = src;
      await im.decode();
      return im;
    };
    const cv = (w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    };
    // 이어 붙인 그림 (원본 크기) + 있던 마스크 (다리 채널을 가져온다)
    const full = cv(W, H);
    const fg = full.getContext('2d', { willReadFrequently: true });
    const old = cv(W, H);
    const og = old.getContext('2d', { willReadFrequently: true });
    og.imageSmoothingEnabled = false;
    for (const t of tiles) {
      fg.drawImage(await load('data:image/webp;base64,' + t.tile), t.x, t.y, t.w, t.h);
      if (t.mask) og.drawImage(await load('data:image/png;base64,' + t.mask), t.x, t.y, t.w, t.h);
    }
    const oldPx = og.getImageData(0, 0, W, H).data;

    // 반 해상도 판정
    const w = Math.ceil(W / 2);
    const h = Math.ceil(H / 2);
    const N = w * h;
    const half = cv(w, h);
    const hg = half.getContext('2d', { willReadFrequently: true });
    hg.imageSmoothingQuality = 'high';
    hg.drawImage(full, 0, 0, w, h);
    const px = hg.getImageData(0, 0, w, h).data;
    // 있던 마스크의 다리 (반 해상도: 네 칸 중 하나라도 투명이면 다리)
    const bridge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
          const X = x * 2 + dx;
          const Y = y * 2 + dy;
          if (X < W && Y < H && oldPx[(Y * W + X) * 4 + 3] < 128) bridge[y * w + x] = 1;
        }

    let cls;
    const count = [0, 0, 0, 0, 0];
    if (!preview) {
      const water = new Uint8Array(N);
      const tree = new Uint8Array(N);
      const natural = new Uint8Array(N); // 풀·모래·흙길 — 섬다운 땅
      const wood = new Uint8Array(N); // 나무 널빤지 (선착장) — 물이 삼키지 않는다
      for (let i = 0; i < N; i++) {
        const r = px[i * 4];
        const g = px[i * 4 + 1];
        const b = px[i * 4 + 2];
        const L = 0.3 * r + 0.59 * g + 0.11 * b;
        const sat = Math.max(r, g, b) - Math.min(r, g, b);
        water[i] = b > r + 35 && b > g - 25 && b > 110 ? 1 : 0;
        // 나무: 초록이 앞서고 풀밭보다 어둡거나 푸른 기가 돈다. 진한 청록 침엽수는 따로.
        // 단풍(주황·노랑·빨강 캐노피)은 집·해바라기와 색이 겹쳐 잡지 않는다 — 가을 숲은 걷기
        tree[i] = (g > r + 8 && g > b + 5 && (L < 135 || r < g * 0.55)) || (L < 115 && g > r + 5 && g >= b - 15) ? 1 : 0;
        const grass = g > r + 8 && g > b + 20 && L >= 135;
        const sand = r >= g && g > b && r - b > 45 && L > 150 && g > r * 0.78;
        natural[i] = grass || sand || tree[i] ? 1 : 0;
        wood[i] = r > g && g > b && r - b > 50 && L > 70 && L <= 170 && g < r * 0.82 && sat > 40 ? 1 : 0;
      }

      // 사각 반경 rad 의 팽창/침식 (가로 한 번, 세로 한 번). 가장자리 밖은 자기 값으로 본다
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
      const opening = (m, r) => morph(morph(m, r, false), r, true);
      const closing = (m, r) => morph(morph(m, r, true), r, false);
      // 4방향 덩어리 나누기: cb(덩어리 칸 목록, 가장자리에 닿았나)
      const components = (m, cb) => {
        const seen = new Uint8Array(N);
        for (let s0 = 0; s0 < N; s0++) {
          if (!m[s0] || seen[s0]) continue;
          const comp = [s0];
          seen[s0] = 1;
          let edge = false;
          for (let k = 0; k < comp.length; k++) {
            const i = comp[k];
            const x = i % w;
            const y = (i / w) | 0;
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
            for (const j of [i - 1, i + 1, i - w, i + w])
              if (j >= 0 && j < N && !seen[j] && m[j] && Math.abs((j % w) - x) <= 1) {
                seen[j] = 1;
                comp.push(j);
              }
          }
          cb(comp, edge);
        }
      };

      // 물: 파란 점(지붕·차양)은 버리고 작은 구멍(거품·연잎)은 메운다
      let wet = closing(opening(water, 2), 3);
      // 작은 물(분수·웅덩이·오아시스)은 걷기. 다리는 물과 이어진 것으로 보고 센다
      const wetOrBridge = new Uint8Array(N);
      for (let i = 0; i < N; i++) wetOrBridge[i] = wet[i] | bridge[i];
      components(wetOrBridge, (comp) => {
        if (comp.length < 4000) for (const i of comp) wet[i] = 0;
      });
      // 높은 구조물이 물을 가린 곳: 폭 좁은(원본 40px 미만) 끼어듦은 물로 메운다. 널빤지는 그대로
      const closed = closing(wet, 10);
      for (let i = 0; i < N; i++) if (closed[i] && !wet[i] && !wood[i]) wet[i] = 1;
      // 바다 속 작은 덩어리(원본 300×300 안)가 풀·모래가 아니면 바위섬·배 — 물로 본다
      const land = new Uint8Array(N);
      for (let i = 0; i < N; i++) land[i] = wet[i] || bridge[i] ? 0 : 1;
      let islets = 0;
      components(land, (comp, edge) => {
        if (edge || comp.length > 22500) return;
        let nat = 0;
        for (const i of comp) nat += natural[i];
        if (nat < comp.length * 0.25) {
          islets++;
          for (const i of comp) wet[i] = 1;
        }
      });
      console.log(`바위섬·배 ${islets}개를 물로`);

      // 숲: 주변 (2R+1)² 안에 나무 픽셀이 45% 넘으면 숲 (들판의 나무 한 그루는 숲이 아니다). 구조물이 가린 구멍은 닫기로 메운다
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
      const forest = closing(opening(dense, 2), 6);
      components(forest, (comp) => {
        if (comp.length < 600) for (const i of comp) forest[i] = 0;
      });

      const inKeep = new Uint8Array(N);
      for (const [kx, ky] of keep)
        for (let y = Math.max(0, (ky >> 1) - 15); y <= Math.min(h - 1, (ky >> 1) + 15); y++)
          for (let x = Math.max(0, (kx >> 1) - 15); x <= Math.min(w - 1, (kx >> 1) + 15); x++)
            if (Math.hypot(x - kx / 2, y - ky / 2) <= 15) inKeep[y * w + x] = 1;

      cls = new Uint8Array(N);
      for (let i = 0; i < N; i++) cls[i] = inKeep[i] ? 0 : wet[i] ? 2 : forest[i] ? 1 : 0;
    }

    // 원본 크기 마스크: 반 해상도 판정 + 있던 마스크의 다리(투명). 미리보기면 있던 마스크 그대로
    const out = cv(W, H);
    const g = out.getContext('2d', { willReadFrequently: true });
    const img = g.createImageData(W, H);
    const tint = cv(W, H);
    const tg = tint.getContext('2d');
    const timg = tg.createImageData(W, H);
    const colors = [null, [255, 0, 170, 110], [0, 210, 255, 100], [255, 40, 40, 140], [255, 230, 0, 160]];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const o = (y * W + x) * 4;
        let t;
        if (preview) t = oldPx[o + 3] < 128 ? 4 : oldPx[o] >= 128 ? 3 : oldPx[o + 2] >= 128 ? 2 : oldPx[o + 1] >= 128 ? 1 : 0;
        else {
          t = cls[(y >> 1) * w + (x >> 1)];
          if (oldPx[o + 3] < 128) t = 4; // 손으로 칠한 다리는 그대로
        }
        count[t]++;
        img.data[o] = t === 3 ? 255 : 0;
        img.data[o + 1] = t === 1 ? 255 : 0;
        img.data[o + 2] = t === 2 ? 255 : 0;
        img.data[o + 3] = t === 4 ? 0 : 255;
        if (colors[t]) timg.data.set(colors[t], o);
      }
    g.putImageData(img, 0, 0);
    tg.putImageData(timg, 0, 0);
    // 미리보기: 그림 + 색
    const pv = cv(W, H);
    const pg = pv.getContext('2d');
    pg.drawImage(full, 0, 0);
    pg.drawImage(tint, 0, 0);
    // 조각마다 잘라 PNG 로
    const masks = {};
    if (!preview)
      for (const t of tiles) {
        const c = cv(t.w, t.h);
        c.getContext('2d').drawImage(out, t.x, t.y, t.w, t.h, 0, 0, t.w, t.h);
        masks[t.name] = c.toDataURL('image/png').split(',')[1];
      }
    const pct = (n) => ((100 * n) / (W * H)).toFixed(1) + '%';
    return { masks, preview: pv.toDataURL('image/png').split(',')[1], stats: `물 ${pct(count[2])} · 숲 ${pct(count[1])} · 막힘 ${pct(count[3])} · 다리 ${pct(count[4])}` };
  },
  tiles,
  keep,
  W,
  H,
  preview,
);
await browser.close();
fs.mkdirSync(new URL('tools/out/', ROOT), { recursive: true });
fs.writeFileSync(PREVIEW, Buffer.from(result.preview, 'base64'));
if (preview) {
  console.log(`preview ${fileURLToPath(PREVIEW)}  (${result.stats}) — 마스크는 그대로`);
  process.exit(0);
}
// 직접 다듬은 마스크를 실수로 덮어쓰지 않게 — 칠해진 마스크가 있으면 --force 없이는 멈춘다 (빈 마스크는 괜찮다)
const painted = tiles.filter((t) => t.mask && Buffer.from(t.mask, 'base64').length > 2000).map((t) => t.name);
if (painted.length && !force) {
  console.error(`칠해진 마스크가 있다 (${painted.join(', ')}). 덮어쓰면 직접 고친 내용(다리 빼고)이 사라진다 — 정말이면 --force`);
  process.exit(1);
}
for (const [name, b64] of Object.entries(result.masks)) fs.writeFileSync(new URL(`mask_${name}.png`, MASKS), Buffer.from(b64, 'base64'));
console.log(`마스크 ${Object.keys(result.masks).length}장 (${result.stats})  미리보기 ${fileURLToPath(PREVIEW)}`);
