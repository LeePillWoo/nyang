// node tools/terrain.mjs — 필드 그림 색으로 지형 마스크 초안을 만든다.
//
// 결과: src/assets/field-terrain.png (필드 그림과 같은 크기). 채널 하나에 지형 하나:
//   R = 막힘 (암석·절벽. 집·분수대는 걷기)   흰색 = 막힘
//   G = 숲 (도끼)                             흰색 = 숲
//   B = 물 (배)                               흰색 = 물
//   A = 다리 — 투명하게 지운 곳이 다리 (걸어서도, 배로도 지나간다)
//   셋 다 검정·불투명 = 걷기.  겹치면 다리 > 막힘 > 물 > 숲.
//   A 를 거꾸로(투명 = 다리) 쓰는 건, 편집기·브라우저가 투명한 픽셀의 RGB 를 버리기 때문이다.
// 초안이라 경계는 거칠다. 그림 편집기에서 필드 위에 겹쳐 놓고 고치면 된다.
// 시작점·워프·던전에서 나오는 자리 주변은 무조건 걷기로 둔다 (src/data/field.json 에서 읽는다).
// 마스크가 이미 있으면 덮어쓰지 않고 멈춘다 (새 초안이 필요할 때만 --force). 확인만 할 땐 --preview.
//
// 미리보기: tools/out/terrain-preview.png (필드 위에 마스크를 반투명으로 겹친 것),
//          tools/out/terrain-channels.png (채널별 흑백, --preview 일 때)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const SRC = new URL('../src/assets/field.webp', import.meta.url);
const OUT = new URL('../src/assets/field-terrain.png', import.meta.url);
const PREVIEW = new URL('./out/terrain-preview.png', import.meta.url);
const CHANNELS = new URL('./out/terrain-channels.png', import.meta.url);

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const b64 = fs.readFileSync(SRC).toString('base64');

// node tools/terrain.mjs --preview : 마스크는 건드리지 않고 지금 마스크로 미리보기만 다시 만든다 (직접 고친 뒤 확인용)
if (process.argv.includes('--preview')) {
  const mask64 = fs.readFileSync(OUT).toString('base64');
  const out = await page.evaluate(async (b64, mask64) => {
    const load = async (src) => {
      const im = new Image();
      im.src = src;
      await im.decode();
      return im;
    };
    const im = await load('data:image/webp;base64,' + b64);
    const mk = await load('data:image/png;base64,' + mask64);
    const W = im.naturalWidth;
    const H = im.naturalHeight;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingEnabled = false;
    g.drawImage(mk, 0, 0, W, H);
    const m = g.getImageData(0, 0, W, H);

    // 채널별 흑백 보기 (2×2: R 막힘 · G 숲 / B 물 · A 다리). A 는 투명 = 다리라 뒤집어 보여 준다
    const HW = W >> 1;
    const HH = H >> 1;
    const ch = document.createElement('canvas');
    ch.width = HW * 2;
    ch.height = HH * 2;
    const chg = ch.getContext('2d');
    const panels = [
      ['R 막힘 (암석·절벽)', 0, false],
      ['G 숲', 1, false],
      ['B 물', 2, false],
      ['A 다리 (투명한 곳 = 흰색으로 표시)', 3, true],
    ];
    panels.forEach(([label, k, invert], n) => {
      const img = chg.createImageData(HW, HH);
      for (let y = 0; y < HH; y++)
        for (let x = 0; x < HW; x++) {
          const v = m.data[((y * 2) * W + x * 2) * 4 + k];
          const g2 = invert ? 255 - v : v;
          img.data.set([g2, g2, g2, 255], (y * HW + x) * 4);
        }
      chg.putImageData(img, (n % 2) * HW, (n >> 1) * HH);
      chg.fillStyle = '#e33';
      chg.font = 'bold 22px sans-serif';
      chg.fillText(label, (n % 2) * HW + 12, (n >> 1) * HH + 30);
    });
    chg.strokeStyle = '#e33';
    chg.lineWidth = 2;
    chg.strokeRect(0, 0, HW, HH);
    chg.strokeRect(HW, 0, HW, HH);
    chg.strokeRect(0, HH, HW, HH);
    chg.strokeRect(HW, HH, HW, HH);

    const count = [0, 0, 0, 0, 0];
    // 게임(src/field-draw.ts)과 같은 판정
    for (let i = 0; i < W * H; i++) {
      const r = m.data[i * 4];
      const gg = m.data[i * 4 + 1];
      const b = m.data[i * 4 + 2];
      const a = m.data[i * 4 + 3];
      const t = a < 128 ? 4 : r >= 128 ? 3 : b >= 128 ? 2 : gg >= 128 ? 1 : 0;
      count[t]++;
      const tint = [null, [255, 0, 170, 110], [0, 210, 255, 90], [255, 30, 30, 150], [255, 230, 0, 170]][t];
      m.data.set(tint ?? [0, 0, 0, 0], i * 4);
    }
    g.putImageData(m, 0, 0);
    const p = document.createElement('canvas');
    p.width = W;
    p.height = H;
    const pg = p.getContext('2d');
    pg.drawImage(im, 0, 0);
    pg.drawImage(c, 0, 0);
    const pct = (n) => ((100 * n) / (W * H)).toFixed(1) + '%';
    return { png: p.toDataURL('image/png').split(',')[1], channels: ch.toDataURL('image/png').split(',')[1], stats: `물 ${pct(count[2])} · 숲 ${pct(count[1])} · 막힘 ${pct(count[3])} · 다리 ${pct(count[4])}` };
  }, b64, mask64);
  fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
  fs.writeFileSync(PREVIEW, Buffer.from(out.png, 'base64'));
  fs.writeFileSync(CHANNELS, Buffer.from(out.channels, 'base64'));
  await browser.close();
  console.log(`preview ${fileURLToPath(PREVIEW)}  (${out.stats}) — 마스크는 그대로`);
  console.log(`channels ${fileURLToPath(CHANNELS)}`);
  process.exit(0);
}
// 직접 다듬은 마스크를 실수로 덮어쓰지 않게 — 이미 있으면 --force 없이는 멈춘다
if (fs.existsSync(OUT) && !process.argv.includes('--force')) {
  await browser.close();
  console.error(`${fileURLToPath(OUT)} 이 이미 있다. 덮어쓰면 직접 고친 내용이 사라진다.`);
  console.error('미리보기만: node tools/terrain.mjs --preview   /   정말 새 초안으로: node tools/terrain.mjs --force');
  process.exit(1);
}
const field = JSON.parse(fs.readFileSync(new URL('../src/data/field.json', import.meta.url), 'utf8'));
// 막혀서는 안 되는 곳: 시작점, 워프, 던전에서 나오는 자리
const keep = [field.start, ...field.warps.flatMap((w) => [w.at, w.back])];

const { mask, preview, stats } = await page.evaluate(async (b64, keep) => {
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
  const rock = new Uint8Array(N);
  const roof = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const r = px[i * 4];
    const gg = px[i * 4 + 1];
    const b = px[i * 4 + 2];
    const L = 0.3 * r + 0.59 * gg + 0.11 * b;
    const sat = Math.max(r, gg, b) - Math.min(r, gg, b);
    // 암벽·바위: 따뜻한 회베이지 (실측 채도 6~45, 초록/빨강 0.84~1.02). 광장 돌바닥·돌다리도 같은 색이라
    // 여기서는 후보만 잡고, 아래에서 울퉁불퉁함과 다리 규칙으로 가른다
    rock[i] = sat < 48 && gg > r * 0.84 && gg < r * 1.03 && L > 95 && L < 240 ? 1 : 0;
    // 지붕: 주황. 실측 빨강−파랑 115~137 (선착장 나무 101~105), 노란 해바라기는 초록이 높아 빠진다
    roof[i] = (r > 180 && r - b > 112 && gg < r * 0.75 && gg > b) || (r > 170 && r - b > 90 && gg < r * 0.6) ? 1 : 0;
    water[i] = b > r + 35 && b > gg - 25 && b > 110 ? 1 : 0;
    // 나무: 초록이 앞서고, 풀밭보다 어둡거나 푸른 기가 돈다 (풀밭은 밝은 연두)
    // 진한 청록 침엽수는 파랑이 초록만큼 높아서 따로 잡는다
    tree[i] = (gg > r + 8 && gg > b + 5 && (L < 135 || r < gg * 0.55)) || (L < 115 && gg > r + 5 && gg >= b - 15) ? 1 : 0;
    // 흙길·모래: 붉은 기 > 초록 > 파랑, 밝다
    // (주황 지붕도 붉은 기 > 초록 > 파랑이라 초록 비율로 뺀다: 흙길·모래 0.8 이상, 지붕 0.75 미만)
    path[i] = r >= gg && gg > b && r - b > 45 && L > 150 && gg > r * 0.78 ? 1 : 0;
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

  // 막힘: 바위는 작은 조각을 버리고(자갈·표지판) 틈을 메운다.
  // 지붕은 아래로 벽 높이(원본 약 24px)만큼 늘려 집 전체를 덮는다 — 그림에서 집 밑동은 지붕 아래에 있다
  // 울퉁불퉁함: 주변 9×9 칸(원본 18px) 밝기 표준편차. 암벽·바위는 그림자와 금으로 크고, 광장 바닥은 평평하다
  const lum = new Float32Array(N);
  for (let i = 0; i < N; i++) lum[i] = 0.3 * px[i * 4] + 0.59 * px[i * 4 + 1] + 0.11 * px[i * 4 + 2];
  const rough = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!rock[y * w + x]) continue;
      let s = 0;
      let s2 = 0;
      let n = 0;
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          const v = lum[yy * w + xx];
          s += v;
          s2 += v * v;
          n++;
        }
      rough[y * w + x] = Math.sqrt(Math.max(0, s2 / n - (s / n) ** 2)) > 16 ? 1 : 0;
    }
  // 얼룩덜룩하면 보이지 않는 돌멩이에 걸리듯 툭툭 멈춘다 → 점은 지우고 틈은 메워 덩어리로 만든다.
  // (흙길은 막힘보다 우선이라 메워도 길은 안 막힌다)
  const stone = open(close(open(rough, 1), 3), 2);
  // 다리: 한 축 양쪽이 물이고(난간·아치가 두꺼워 원본 48px 까지 본다) 수직 축 양 끝이 물이 아니면 다리다 (걷기).
  // 바다 한가운데 바위는 사방이 물이라 다리가 아니다.
  // 계단: 한 축 양쪽이 흙길이면 길 사이에 놓인 돌계단이다 (걷기). 길 한쪽에 붙은 바위는 그대로 막힌다.
  const isWet = (x, y) => x >= 0 && y >= 0 && x < w && y < h && wet[y * w + x] === 1;
  const reach = (x, y, dx, dy) => {
    for (let k = 1; k <= 24; k++) if (isWet(x + dx * k, y + dy * k)) return true;
    return false;
  };
  const road = (x, y, dx, dy) => {
    for (let k = 1; k <= 12; k++) {
      const xx = x + dx * k;
      const yy = y + dy * k;
      if (xx >= 0 && yy >= 0 && xx < w && yy < h && path[yy * w + xx]) return true;
    }
    return false;
  };
  const axes = [[[1, 0], [0, 1]], [[0, 1], [1, 0]], [[1, 1], [1, -1]], [[1, -1], [1, 1]]];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!stone[i]) continue;
      for (const [[ax, ay], [bx, by]] of axes)
        if (
          (reach(x, y, ax, ay) && reach(x, y, -ax, -ay) && !isWet(x + bx * 10, y + by * 10) && !isWet(x - bx * 10, y - by * 10)) ||
          (road(x, y, ax, ay) && road(x, y, -ax, -ay))
        ) {
          stone[i] = 0;
          break;
        }
    }
  // 집: 지붕 밝은 면은 색으로 다 안 잡혀서, 한 집에서 잡힌 조각들을 묶어(원본 10px 안이면 한 덩어리)
  // 그 조각들을 감싸는 사각형을 벽 높이(원본 24px)만큼 아래로 늘려 집 전체를 막는다
  const house = new Uint8Array(N);
  const rf = open(roof, 1);
  const blob = morph(rf, 5, true);
  const seen = new Uint8Array(N);
  for (let s0 = 0; s0 < N; s0++) {
    if (!blob[s0] || seen[s0]) continue;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
    const stack = [s0];
    seen[s0] = 1;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      if (rf[i]) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      for (const j of [i - 1, i + 1, i - w, i + w])
        if (j >= 0 && j < N && !seen[j] && blob[j] && Math.abs((j % w) - x) <= 1) {
          seen[j] = 1;
          stack.push(j);
        }
    }
    if (n < 25) continue; // 지붕이라기엔 작다 (화분·간판)
    for (let y = y0; y <= Math.min(h - 1, y1 + 12); y++) for (let x = x0; x <= x1; x++) house[y * w + x] = 1;
  }
  // 막는 건 암석·절벽뿐이다. 집·분수대는 걷기 (사용자 결정).
  // - 집: 크림색 벽·창틀이 울퉁불퉁한 회색이라 바위 규칙에 걸린다 → 집 영역은 바위에서 뺀다
  // - 작은 물: 분수대·파란 차양은 배를 탈 물이 아니다 → 걷기, 그 둘레 돌도 바위에서 뺀다.
  //   단 절벽에 붙은 작은 물(폭포)은 절벽이다 → 막힘
  const houses = close(morph(house, 1, true), 2);
  const rocks = new Uint8Array(N);
  for (let i = 0; i < N; i++) rocks[i] = stone[i] && !path[i] && !houses[i] ? 1 : 0;
  const rockSolid = close(rocks, 2);
  const nearRock = morph(rockSolid, 3, true);
  const pondWalk = new Uint8Array(N);
  const pondBlock = new Uint8Array(N);
  {
    const seen = new Uint8Array(N);
    for (let s0 = 0; s0 < N; s0++) {
      if (!wet[s0] || seen[s0]) continue;
      const comp = [s0];
      seen[s0] = 1;
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k];
        const x = i % w;
        for (const j of [i - 1, i + 1, i - w, i + w])
          if (j >= 0 && j < N && !seen[j] && wet[j] && Math.abs((j % w) - x) <= 1) {
            seen[j] = 1;
            comp.push(j);
          }
      }
      if (comp.length >= 1500) continue; // 반 해상도 1500칸 = 원본 6000px² 넘으면 배를 타는 물
      const cliff = comp.filter((i) => nearRock[i]).length > comp.length * 0.3;
      for (const i of comp) (cliff ? pondBlock : pondWalk)[i] = 1;
    }
  }
  const fountain = morph(pondWalk, 8, true); // 분수 테두리 돌은 바위가 아니다
  for (let i = 0; i < N; i++) if (fountain[i]) rockSolid[i] = 0;
  const inKeep = new Uint8Array(N);
  for (const [kx, ky] of keep)
    for (let y = Math.max(0, (ky >> 1) - 15); y <= Math.min(h - 1, (ky >> 1) + 15); y++)
      for (let x = Math.max(0, (kx >> 1) - 15); x <= Math.min(w - 1, (kx >> 1) + 15); x++)
        if (Math.hypot(x - kx / 2, y - ky / 2) <= 15) inKeep[y * w + x] = 1;

  // 다리: 배가 내리지 않고 지나가는 좁은 땅. 모양만으로는 좁은 풀밭과 구별이 안 돼서 색도 본다.
  //  - 한 축으로 양쪽(원본 48px 안)이 배 타는 물이고
  //  - 수직 축 양 끝(원본 20px)은 물이 아니고 (양쪽 땅을 잇는다. 사방이 물인 바다 바위는 다리가 아니다)
  //  - 초록이 아니다 (풀·나무가 아닌 나무판자·돌)
  const sea = new Uint8Array(N);
  for (let i = 0; i < N; i++) sea[i] = wet[i] && !pondWalk[i] && !pondBlock[i] ? 1 : 0;
  const seaAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && sea[y * w + x] === 1;
  const seaWithin = (x, y, dx, dy) => {
    for (let k = 1; k <= 24; k++) if (seaAt(x + dx * k, y + dy * k)) return true;
    return false;
  };
  const span = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (sea[i]) continue;
      const r = px[i * 4];
      const gg = px[i * 4 + 1];
      if (gg > r + 8) continue; // 풀·나무
      for (const [[ax, ay], [bx, by]] of axes)
        if (seaWithin(x, y, ax, ay) && seaWithin(x, y, -ax, -ay) && !seaAt(x + bx * 10, y + by * 10) && !seaAt(x - bx * 10, y - by * 10)) {
          span[i] = 1;
          break;
        }
    }
  // 덩어리마다 걸러낸다: 작아야 하고(반 해상도 900칸 = 원본 3600px² 이하),
  // 서로 떨어진(원본 30px 이상) 두 곳에서 땅에 닿아야 한다 — 땅과 땅을 잇는 게 다리다.
  // 바다 바위는 땅에 안 닿고, 등대·방파제는 한쪽에서만 닿는다.
  const cand = close(open(span, 1), 2);
  const bridge = new Uint8Array(N);
  {
    const seen = new Uint8Array(N);
    const landAt = (j) => !sea[j] && !cand[j];
    for (let s0 = 0; s0 < N; s0++) {
      if (!cand[s0] || seen[s0]) continue;
      const comp = [s0];
      seen[s0] = 1;
      const touch = [];
      for (let k = 0; k < comp.length; k++) {
        const i = comp[k];
        const x = i % w;
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          if (j < 0 || j >= N || Math.abs((j % w) - x) > 1) continue;
          if (cand[j] && !seen[j]) {
            seen[j] = 1;
            comp.push(j);
          } else if (landAt(j)) touch.push(j);
        }
      }
      if (comp.length < 20 || comp.length > 900 || !touch.length) continue;
      let far = 0;
      const t0 = touch[0];
      for (const j of touch) far = Math.max(far, Math.hypot((j % w) - (t0 % w), ((j / w) | 0) - ((t0 / w) | 0)));
      // 첫 접점에서 가장 먼 접점까지가 15칸 넘으면 양 끝이 땅에 닿은 것
      if (far < 15) continue;
      for (const i of comp) bridge[i] = 1;
    }
  }

  // 합치기: (보호 구역은 걷기) > 큰 물 > 폭포(막힘) > 다리 > 분수·길(걷기) > 암석·절벽 > 숲 > 걷기
  const cls = new Uint8Array(N);
  let nWater = 0;
  let nForest = 0;
  let nBlock = 0;
  let nBridge = 0;
  for (let i = 0; i < N; i++) {
    cls[i] = inKeep[i]
      ? 0
      : sea[i]
        ? 2
        : pondBlock[i]
          ? 3
          : bridge[i]
            ? 4
            : pondWalk[i] || path[i]
              ? 0
              : rockSolid[i]
                ? 3
                : forest[i]
                  ? 1
                  : 0;
    if (cls[i] === 2) nWater++;
    if (cls[i] === 1) nForest++;
    if (cls[i] === 3) nBlock++;
    if (cls[i] === 4) nBridge++;
  }

  // 원본 크기로 (최근접) 색 칠하기
  const mc = document.createElement('canvas');
  mc.width = W;
  mc.height = H;
  const mg = mc.getContext('2d');
  const md = mg.createImageData(W, H);
  // 채널 하나에 지형 하나: R 막힘 · G 숲 · B 물 · A 다리(투명 = 다리). 걷기는 셋 다 0, 불투명
  const pack = [
    [0, 0, 0, 255], // 걷기
    [0, 255, 0, 255], // 숲
    [0, 0, 255, 255], // 물
    [255, 0, 0, 255], // 막힘
    [0, 0, 0, 0], // 다리
  ];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) md.data.set(pack[cls[(y >> 1) * w + (x >> 1)]], (y * W + x) * 4);
  mg.putImageData(md, 0, 0);

  const pc = document.createElement('canvas');
  pc.width = W;
  pc.height = H;
  const pg = pc.getContext('2d');
  pg.drawImage(im, 0, 0);
  // 한눈에 보이게: 숲 = 분홍, 물 = 하늘색, 막힘 = 빨강, 다리 = 노랑 반투명
  const ov = pg.createImageData(W, H);
  const tint = [null, [255, 0, 170, 110], [0, 210, 255, 90], [255, 30, 30, 150], [255, 230, 0, 170]];
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
    stats: { water: ((100 * nWater) / N).toFixed(1) + '%', forest: ((100 * nForest) / N).toFixed(1) + '%', block: ((100 * nBlock) / N).toFixed(1) + '%', bridge: ((100 * nBridge) / N).toFixed(2) + '%' },
  };
}, b64, keep);

fs.writeFileSync(OUT, Buffer.from(mask, 'base64'));
fs.mkdirSync(new URL('./out/', import.meta.url), { recursive: true });
fs.writeFileSync(PREVIEW, Buffer.from(preview, 'base64'));
await browser.close();
console.log(`saved ${fileURLToPath(OUT)} (${(fs.statSync(OUT).size / 1024) | 0}KB)  물 ${stats.water} · 숲 ${stats.forest} · 막힘 ${stats.block} · 다리 ${stats.bridge}`);
console.log(`preview ${fileURLToPath(PREVIEW)}`);
