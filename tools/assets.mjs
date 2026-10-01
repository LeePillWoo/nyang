// node tools/assets.mjs — 원본 리소스(art/)를 게임용(src/assets/)으로 바꾼다. 폴더·파일 이름은 그대로, 확장자만 .webp.
//
//   art/world/tiles/tile_r0_c0.png        → src/assets/world/tiles/tile_r0_c0.webp
//   art/characters/player/cheese_axe_v1.png → src/assets/characters/player/cheese_axe_v1.webp  …
//
// - 원본보다 새 WebP 가 이미 있으면 건너뛴다 (--all 이면 전부 다시). Chrome 인코더, 품질 0.9 (알파 무손실).
// - 월드 조각은 src/data/field.json 의 size · grid 와 크기가 맞는지 본다 (어긋나면 실패).
// - 지형 마스크 src/assets/world/masks/mask_rR_cC.png 가 없는 조각에만 빈 마스크(검정 = 전부 걷기)를 만든다.
//   **이미 있는 마스크는 건드리지 않는다** (손으로 칠한 마스크 보호).
// - 미니맵 src/assets/world/minimap.webp 를 조각 36장을 1/8 로 줄여 만든다 (조각이 바뀌었을 때만).
// - art/temp/, art/metadata/ 와 PNG 가 아닌 파일은 건너뛴다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ART = path.join(ROOT, 'art');
const OUT = path.join(ROOT, 'src', 'assets');
const all = process.argv.includes('--all');
const FIELD = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/field.json'), 'utf8'));
const [W, H] = FIELD.size;
const [COLS, ROWS] = FIELD.grid;
const tileX = (c) => Math.floor((c * W) / COLS);
const tileY = (r) => Math.floor((r * H) / ROWS);

const pngs = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(ART, p).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (rel !== 'temp' && rel !== 'metadata') walk(p);
    } else if (/\.png$/i.test(e.name)) pngs.push(rel);
  }
})(ART);

const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, protocolTimeout: 600000 });
const page = await browser.newPage();
const encode = (b64) =>
  page.evaluate(async (b64) => {
    const im = new Image();
    im.src = 'data:image/png;base64,' + b64;
    await new Promise((ok) => (im.onload = ok));
    const cv = document.createElement('canvas');
    cv.width = im.naturalWidth;
    cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0);
    return cv.toDataURL('image/webp', 0.9).split(',')[1];
  }, b64);

let made = 0;
let skipped = 0;
let bad = 0;
for (const rel of pngs) {
  const src = path.join(ART, rel);
  const dst = path.join(OUT, rel.replace(/\.png$/i, '.webp'));
  const tile = rel.match(/^world\/tiles\/tile_r(\d+)_c(\d+)\.png$/);
  if (tile) {
    const [r, c] = [Number(tile[1]), Number(tile[2])];
    const png = fs.readFileSync(src);
    const [pw, ph] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    const [w, h] = [tileX(c + 1) - tileX(c), tileY(r + 1) - tileY(r)];
    if (pw !== w || ph !== h) {
      console.log(` FAIL  ${rel} 크기 ${pw}x${ph}, 자리 크기 ${w}x${h}`);
      bad++;
      continue;
    }
    const mask = path.join(OUT, `world/masks/mask_r${r}_c${c}.png`);
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
      fs.mkdirSync(path.dirname(mask), { recursive: true });
      fs.writeFileSync(mask, Buffer.from(blank, 'base64'));
      console.log(`  빈 마스크  ${path.relative(OUT, mask)}`);
    }
  }
  if (!all && fs.existsSync(dst) && fs.statSync(dst).mtimeMs >= fs.statSync(src).mtimeMs) {
    skipped++;
    continue;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, Buffer.from(await encode(fs.readFileSync(src).toString('base64')), 'base64'));
  made++;
}
// 미니맵: 조각 36장을 1/8 로 줄여 한 장으로 (src/assets/world/minimap.webp). 조각이 바뀌었거나 없을 때만
const MINI = path.join(OUT, 'world/minimap.webp');
const tiles = pngs.filter((p) => p.startsWith('world/tiles/'));
if (all || !fs.existsSync(MINI) || tiles.some((p) => fs.statSync(path.join(ART, p)).mtimeMs > fs.statSync(MINI).mtimeMs)) {
  const parts = tiles.map((p) => {
    const [, r, c] = p.match(/tile_r(\d+)_c(\d+)/).map(Number);
    return { x: tileX(c), y: tileY(r), d: fs.readFileSync(path.join(ART, p)).toString('base64') };
  });
  const webp = await page.evaluate(
    async (parts, W, H) => {
      const k = 1 / 8;
      const cv = document.createElement('canvas');
      cv.width = Math.round(W * k);
      cv.height = Math.round(H * k);
      const g = cv.getContext('2d');
      g.imageSmoothingQuality = 'high';
      for (const p of parts) {
        const im = new Image();
        im.src = 'data:image/png;base64,' + p.d;
        await new Promise((ok) => (im.onload = ok));
        g.drawImage(im, p.x * k, p.y * k, im.naturalWidth * k, im.naturalHeight * k);
      }
      return cv.toDataURL('image/webp', 0.85).split(',')[1];
    },
    parts,
    W,
    H,
  );
  fs.writeFileSync(MINI, Buffer.from(webp, 'base64'));
  console.log('  미니맵  world/minimap.webp');
}
await browser.close();
console.log(`원본 ${pngs.length}장 · 변환 ${made} · 그대로 ${skipped}${bad ? ` · 크기 안 맞음 ${bad}` : ''}`);
process.exit(bad ? 1 : 0);
