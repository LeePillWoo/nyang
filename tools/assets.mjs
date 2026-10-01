// node tools/assets.mjs — 원본 리소스(art/)를 게임용(src/assets/)으로 바꾼다. 폴더·파일 이름은 그대로, 확장자만 .webp.
//
//   art/world/tiles/tile_r0_c0.png        → src/assets/world/tiles/tile_r0_c0.webp
//   art/characters/player/cheese_axe_v1.png → src/assets/characters/player/cheese_axe_v1.webp  …
//
// - 원본보다 새 WebP 가 이미 있으면 건너뛴다 (--all 이면 전부 다시). Chrome 인코더, 품질 0.9 (알파 무손실).
// - 월드 조각은 src/data/field.json 의 size · grid 와 크기가 맞는지 본다 (어긋나면 실패).
// - 지형 마스크 src/assets/world/masks/mask_rR_cC.png 가 없는 조각에만 빈 마스크(검정 = 전부 걷기)를 만든다.
//   **이미 있는 마스크는 건드리지 않는다** (손으로 칠한 마스크 보호).
// - 낚시 시트 좌표 art/fishing/common/atlas.json + art/fishing/<낚시터>/atlas.json → src/data/fishing-atlas.json (원본이 바뀌었을 때만).
// - src/assets 에 원본(PNG·JSON·MD)이 들어와 있으면 art/ 로 옮기라고 알려 준다 (지형 마스크 빼고).
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

// 낚시 시트 좌표 → src/data/fishing-atlas.json (게임이 쓰는 값만, art 는 git 밖이라 옮겨 둔다)
//   art/fishing/common/atlas.json — 공용: 고양이(cat) · 그림자(shadow) · 찌·효과(fx)
//   art/fishing/<낚시터>/atlas.json — 그곳 물고기 시트. 물고기 id 는 낚시터를 가리지 않고 하나뿐이라 catch 에 한데 모은다
// 칸마다 [x, y, w, h, 내용 x, y, w, h] — 고양이는 뒤에 [발 x, y, 낚싯대 끝 x, y] (칸 기준)
const FISHING = path.join(ART, 'fishing');
const ATLAS_OUT = path.join(ROOT, 'src/data/fishing-atlas.json');
const atlases = fs.existsSync(FISHING)
  ? fs.readdirSync(FISHING, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(FISHING, e.name, 'atlas.json'))).map((e) => path.join(FISHING, e.name, 'atlas.json'))
  : [];
if (atlases.length && (all || !fs.existsSync(ATLAS_OUT) || atlases.some((a) => fs.statSync(a).mtimeMs > fs.statSync(ATLAS_OUT).mtimeMs))) {
  const NAME = { fishing_cat: 'cat', fishing_shadows: 'shadow', fishing_effects: 'fx' };
  const state = (sh, st) => ({
    name: st.name,
    fps: st.suggestedFps,
    loop: st.loop,
    frames: st.frames.map((i) => {
      const f = sh.frames[i];
      const v = [...f.rect, ...f.contentBounds];
      if (f.suggestedFootPivot) v.push(...f.suggestedFootPivot, ...f.suggestedRodTip);
      return v.map((n) => Math.round(n * 10) / 10);
    }),
  });
  const out = { catch: {} };
  for (const a of atlases.sort())
    for (const sh of JSON.parse(fs.readFileSync(a, 'utf8')).sheets) {
      const sheet = sh.file.replace(/\.png$/, '');
      if (NAME[sh.id]) out[NAME[sh.id]] = { sheet, states: Object.fromEntries(sh.states.map((st) => [st.id, state(sh, st)])) };
      else for (const st of sh.states) out.catch[st.id] = { sheet, ...state(sh, st) }; // 물고기 시트
    }
  fs.writeFileSync(ATLAS_OUT, JSON.stringify(out).replace(/\],\[/g, '],\n[') + '\n');
  console.log(`  낚시 좌표  src/data/fishing-atlas.json (물고기 ${Object.keys(out.catch).length}종)`);
}

// 원본 PNG 는 art/ 에 둔다 — src/assets 는 git 에 올라가는 게임용(WebP)이라 원본이 들어오면 알려 준다 (지형 마스크는 예외)
const stray = [];
(function find(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    const rel = path.relative(OUT, p).split(path.sep).join('/');
    if (e.isDirectory()) find(p);
    else if (/\.(png|json|md)$/i.test(e.name) && !rel.startsWith('world/masks/')) stray.push(rel);
  }
})(OUT);
if (stray.length) console.log(`  알림: src/assets 에 원본처럼 보이는 파일 ${stray.length}개 — art/ 의 같은 자리로 옮기세요: ${stray.slice(0, 5).join(', ')}${stray.length > 5 ? ' …' : ''}`);
console.log(`원본 ${pngs.length}장 · 변환 ${made} · 그대로 ${skipped}${bad ? ` · 크기 안 맞음 ${bad}` : ''}`);
process.exit(bad ? 1 : 0);
