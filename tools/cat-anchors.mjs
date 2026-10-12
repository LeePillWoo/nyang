// node tools/cat-anchors.mjs — 치즈 시트 컷마다 꾸미기 소품을 붙일 기준점을 재서 src/data/cat-anchors.json 에 둔다 (2026-10-13).
//   귀: 귀 안쪽 분홍(248,144,120 언저리) 덩어리 둘 → 가운데 m · 사이 d · 기울기 a (머리 소품은 여기에 붙는다 — 머리가 기울면 같이 기운다)
//   (눈은 윤곽선과 같은 검정이라 못 가른다 — 얼굴 소품도 귀 기준으로 붙인다)
//   몸: 실루엣을 열기(침식 → 팽창, 반지름 OPEN)로 꼬리 · 가는 다리를 지우고 머리 원을 뺀 범위 b (옷 · 등 소품 — 상자에 맞춰 늘인다)
// 게임과 같은 칸 자르기(loadSheet)를 쓰려고 vite 개발 서버 + Chrome 으로 돌린다. 확인 그림 tools/out/cat-anchors.png (귀 분홍 점 · 몸 상자 파랑 · 머리 원 회색).
// 다른 치즈 시트(도끼 · 배 · 눈밭 · 낚시)도 나중에 같은 식으로 (SHEETS 에 더한다).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { createServer } from 'vite';

const SHEETS = { cat: 'loadCat' };
const server = await createServer({ server: { port: 5194 }, logLevel: 'silent' });
await server.listen();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('err', e.message));
await page.goto('http://localhost:5194/tools/out/blank.html').catch(() => {});
await page.setContent('<canvas id=c></canvas>');
const out = await page.evaluate(async (SHEETS) => {
  const base = 'http://localhost:5194';
  const catMod = await import(base + '/src/shared/cat.ts');
  const result = {};
  const S = 230;
  const c = document.getElementById('c');
  const g = c.getContext('2d');
  const shots = [];
  for (const [name, loader] of Object.entries(SHEETS)) {
    const sheet = await catMod[loader]();
    const rows = [];
    for (let row = 0; row < sheet.frames.length; row++) {
      const cols = [];
      for (let col = 0; col < sheet.frames[row].length; col++) {
        const f = sheet.frames[row][col];
        const W = Math.round(f.sw), H = Math.round(f.sh);
        const t = document.createElement('canvas');
        t.width = W; t.height = H;
        const tg = t.getContext('2d', { willReadFrequently: true });
        tg.drawImage(sheet.img, f.sx, f.sy, f.sw, f.sh, 0, 0, W, H);
        const d = tg.getImageData(0, 0, W, H).data;
        const N = W * H;
        const sil = new Uint8Array(N), pink = new Uint8Array(N);
        for (let i = 0; i < N; i++) {
          const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], a = d[i * 4 + 3];
          if (a > 32) sil[i] = 1;
          if (a > 200 && r > 225 && gg > 115 && gg < 175 && b > 90 && b < 150 && r - gg > 65 && Math.abs(gg - b) < 45) pink[i] = 1;
        }
        // 형태 연산: 정사각 이웃의 침식(min) · 팽창(max) — 가로 한 번 · 세로 한 번으로 나눠서
        const pass1d = (m, r, want) => {
          const o = new Uint8Array(N);
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
              let v = want;
              for (let dx = -r; dx <= r; dx++) {
                const xx = x + dx;
                const px = xx < 0 || xx >= W ? 0 : m[y * W + xx];
                if (px !== want) { v = 1 - want; break; }
              }
              o[y * W + x] = v;
            }
          const o2 = new Uint8Array(N);
          for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
              let v = want;
              for (let dy = -r; dy <= r; dy++) {
                const yy = y + dy;
                const px = yy < 0 || yy >= H ? 0 : o[yy * W + x];
                if (px !== want) { v = 1 - want; break; }
              }
              o2[y * W + x] = v;
            }
          return o2;
        };
        const erode = (m, r) => pass1d(m, r, 1);
        const dilate = (m, r) => pass1d(m, r, 0);
        const blobs = (m) => {
          const seen = new Uint8Array(N);
          const list = [];
          for (let i = 0; i < N; i++) {
            if (!m[i] || seen[i]) continue;
            const st = [i];
            seen[i] = 1;
            let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
            while (st.length) {
              const p = st.pop();
              const x = p % W, y = (p / W) | 0;
              n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
              for (const q of [p - 1, p + 1, p - W, p + W]) if (q >= 0 && q < N && m[q] && !seen[q]) { seen[q] = 1; st.push(q); }
            }
            list.push({ n, x: sx / n, y: sy / n, x0, y0, x1, y1 });
          }
          return list.sort((a, b) => b.n - a.n);
        };
        // 실루엣 상자
        let bx0 = W, by0 = H, bx1 = -1, by1 = -1;
        for (let i = 0; i < N; i++) if (sil[i]) { const x = i % W, y = (i / W) | 0; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
        const bbox = bx1 < 0 ? null : [bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1];
        // 귀: 분홍 덩어리 중 위쪽 절반에 있는 큰 것 둘 (코는 작고 아래)
        const pk = blobs(pink).filter((b) => b.n >= 25 && bbox && b.y < bbox[1] + bbox[3] * 0.55).slice(0, 2);
        let ears = null;
        if (pk.length === 2) {
          const [L, R] = pk.sort((a, b) => a.x - b.x);
          ears = { m: [(L.x + R.x) / 2, (L.y + R.y) / 2], d: Math.hypot(R.x - L.x, R.y - L.y), a: Math.atan2(R.y - L.y, R.x - L.x), p: [[L.x, L.y], [R.x, R.y]] };
        }
        // 몸: 열기(OPEN px)로 꼬리 · 가는 다리를 지우고 머리 원(귀 가운데 아래쪽)을 뺀 범위
        let body = null;
        const OPEN = Math.round(W * 0.075);
        if (ears) {
          const opened = dilate(erode(sil, OPEN), OPEN);
          const hcx = ears.m[0], hcy = ears.m[1] + ears.d * 0.6, hr = ears.d * 0.9;
          const band = ears.m[1] + ears.d * 0.3; // 귀 줄 언저리(귀 끝)는 뺀다
          let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
          for (let i = 0; i < N; i++) {
            if (!opened[i]) continue;
            const x = i % W, y = (i / W) | 0;
            if (y < band || Math.hypot(x - hcx, y - hcy) < hr) continue;
            n++; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
          }
          if (n > 200) body = [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
        }
        cols.push({ bbox, ears: ears && { m: ears.m.map((v) => +v.toFixed(1)), d: +ears.d.toFixed(1), a: +ears.a.toFixed(3) }, body });
        shots.push({ t, W, H, ears, body, row, col, name });
      }
      rows.push(cols);
    }
    result[name] = rows;
  }
  // 확인 그림
  const rowsN = Math.max(...shots.map((s) => s.row)) + 1;
  c.width = S * 6;
  c.height = S * rowsN * Object.keys(SHEETS).length;
  g.fillStyle = '#dfe9d6';
  g.fillRect(0, 0, c.width, c.height);
  for (const s of shots) {
    const k = Math.min(S / s.W, S / s.H);
    const ox = s.col * S, oy = s.row * S;
    g.drawImage(s.t, ox, oy, s.W * k, s.H * k);
    if (s.body) { g.strokeStyle = 'rgba(0,80,255,0.9)'; g.lineWidth = 2; g.strokeRect(ox + s.body[0] * k, oy + s.body[1] * k, s.body[2] * k, s.body[3] * k); }
    if (s.ears) {
      g.strokeStyle = '#f0f'; g.lineWidth = 2; g.beginPath(); g.moveTo(ox + s.ears.p[0][0] * k, oy + s.ears.p[0][1] * k); g.lineTo(ox + s.ears.p[1][0] * k, oy + s.ears.p[1][1] * k); g.stroke();
      g.fillStyle = '#f0f'; for (const p of s.ears.p) { g.beginPath(); g.arc(ox + p[0] * k, oy + p[1] * k, 4, 0, 7); g.fill(); }
    }
    if (s.ears) { g.strokeStyle = 'rgba(80,80,80,0.6)'; g.lineWidth = 1; g.beginPath(); g.arc(ox + s.ears.m[0] * k, oy + (s.ears.m[1] + s.ears.d * 0.6) * k, s.ears.d * 0.9 * k, 0, 7); g.stroke(); }
    g.fillStyle = '#333'; g.font = '12px monospace';
    g.fillText(`${s.row},${s.col} ${s.ears ? '귀' : '귀X'} ${s.body ? '몸' : '몸X'}`, ox + 4, oy + 14);
  }
  return { result, png: c.toDataURL('image/png') };
}, SHEETS);
fs.writeFileSync('src/data/cat-anchors.json', JSON.stringify(out.result).replace(/\],\[\{/g, '],\n[{') + '\n');
fs.writeFileSync('tools/out/cat-anchors.png', Buffer.from(out.png.split(',')[1], 'base64'));
for (const [name, rows] of Object.entries(out.result)) {
  const flat = rows.flat();
  console.log(`${name}: 컷 ${flat.length} · 귀 ${flat.filter((f) => f.ears).length} · 몸 ${flat.filter((f) => f.body).length} → src/data/cat-anchors.json · tools/out/cat-anchors.png`);
}
await browser.close();
await server.close();
