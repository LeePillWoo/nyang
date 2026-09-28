// node tools/webp.mjs <in.png> [out.webp] [품질 0~1, 기본 0.9]
//
// PNG → WebP. Chrome 내장 인코더를 쓴다 — 알파를 무손실로 저장해서 스프라이트 시트의
// 칸 자르기(src/sheet.ts, 알파 경계로 찾는다) 결과가 PNG 와 같다. 바꾼 뒤 npm run verify 로 확인.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';

const [inp, out = inp.replace(/\.png$/i, '.webp'), q = '0.9'] = process.argv.slice(2);
if (!inp) {
  console.error('사용법: node tools/webp.mjs <in.png> [out.webp] [품질]');
  process.exit(2);
}
const CHROME =
  process.env.CHROME_PATH ??
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome'].find((p) =>
    fs.existsSync(p),
  );

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
const data = await page.evaluate(
  async (b64, q) => {
    const im = new Image();
    im.src = 'data:image/png;base64,' + b64;
    await im.decode();
    const c = document.createElement('canvas');
    c.width = im.naturalWidth;
    c.height = im.naturalHeight;
    c.getContext('2d').drawImage(im, 0, 0);
    return c.toDataURL('image/webp', q).split(',')[1];
  },
  fs.readFileSync(inp).toString('base64'),
  Number(q),
);
fs.writeFileSync(out, Buffer.from(data, 'base64'));
await browser.close();
console.log(`${out}  ${(fs.statSync(inp).size / 1024) | 0}KB → ${(fs.statSync(out).size / 1024) | 0}KB`);
