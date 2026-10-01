// node tools/tiles.mjs — 필드 조각 원본(art/field/tile_rR_cC.png)을 게임용으로 바꾼다.
//
// - 그림: src/assets/field/tile_rR_cC.webp (Chrome 인코더, 품질 0.9). 원본을 바꿨으면 다시 돌리면 된다.
// - 마스크: src/assets/field/mask_rR_cC.png 가 없을 때만 빈 마스크(검정·불투명 = 전부 걷기)를 만든다.
//   **이미 있는 마스크는 건드리지 않는다** (손으로 칠한 마스크 보호).
// 조각 크기와 배치는 src/data/field.json 의 size · grid 와 맞아야 한다 (어긋나면 멈춘다).
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const SRC = new URL('../art/field/', import.meta.url);
const OUT = new URL('../src/assets/field/', import.meta.url);
const FIELD = JSON.parse(fs.readFileSync(new URL('../src/data/field.json', import.meta.url), 'utf8'));
const [W, H] = FIELD.size;
const [COLS, ROWS] = FIELD.grid;
const tileX = (c) => Math.floor((c * W) / COLS);
const tileY = (r) => Math.floor((r * H) / ROWS);

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );

fs.mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000 });
const page = await browser.newPage();
let bad = 0;
let made = 0;
let total = 0;
for (let r = 0; r < ROWS; r++)
  for (let c = 0; c < COLS; c++) {
    const name = `r${r}_c${c}`;
    const src = new URL(`tile_${name}.png`, SRC);
    const w = tileX(c + 1) - tileX(c);
    const h = tileY(r + 1) - tileY(r);
    if (!fs.existsSync(src)) {
      console.log(`  없음  tile_${name}.png (빈칸 — 그리지 않고 막힌 곳으로 둔다)`);
      continue;
    }
    const png = fs.readFileSync(src);
    const [pw, ph] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    if (pw !== w || ph !== h) {
      console.log(` FAIL  tile_${name}.png 크기 ${pw}x${ph}, 자리 크기 ${w}x${h}`);
      bad++;
      continue;
    }
    const webp = await page.evaluate(async (b64) => {
      const im = new Image();
      im.src = 'data:image/png;base64,' + b64;
      await new Promise((ok) => (im.onload = ok));
      const cv = document.createElement('canvas');
      cv.width = im.naturalWidth;
      cv.height = im.naturalHeight;
      cv.getContext('2d').drawImage(im, 0, 0);
      return cv.toDataURL('image/webp', 0.9).split(',')[1];
    }, png.toString('base64'));
    fs.writeFileSync(new URL(`tile_${name}.webp`, OUT), Buffer.from(webp, 'base64'));
    total += Buffer.byteLength(webp, 'base64');

    const mask = new URL(`mask_${name}.png`, OUT);
    if (!fs.existsSync(mask)) {
      const blank = await page.evaluate((w, h) => {
        const cv = document.createElement('canvas');
        cv.width = w;
        cv.height = h;
        const g = cv.getContext('2d');
        g.fillStyle = '#000';
        g.fillRect(0, 0, w, h);
        return cv.toDataURL('image/png').split(',')[1];
      }, w, h);
      fs.writeFileSync(mask, Buffer.from(blank, 'base64'));
      made++;
    }
  }
await browser.close();
console.log(`그림 ${(total / 1024 / 1024).toFixed(1)}MB · 새 빈 마스크 ${made}장${bad ? ` · 크기 안 맞음 ${bad}장` : ''}`);
process.exit(bad ? 1 : 0);
