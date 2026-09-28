// npm run verify — 실제 브라우저로 게임을 돌려 "그려진 결과"를 검사한다.
//
// 헤드리스 스크린샷은 게임 루프가 첫 프레임에서 멈춰서 움직임 버그(순간이동·깜빡임)를
// 못 잡는다. 여기서는 Chrome 을 직접 띄워 루프를 실제로 돌리고, 게임의 ?trace 훅이
// 남긴 프레임별 그리기 기록을 분석한다. 눈으로 볼 연속 촬영은 tools/out/ 에 저장한다.
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const RUN_SECONDS = 10; // 쥐들이 몇 번씩 공격할 만큼
const JUMP_FAIL_PX = 60; // 이보다 크게 튀면 실패. 돌아설 때 꼬리가 반대편으로 넘어가는 건 정상 범위
const MERGE_RATIO = 1.8; // 평소 폭의 이 배를 넘으면 옆 프레임과 합쳐진 것
const VIEW = { width: 1200, height: 676 };
const OUT = new URL('./out/', import.meta.url);

const CHROME =
  process.env.CHROME_PATH ??
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].find((p) => fs.existsSync(p));
if (!CHROME) {
  console.error('Chrome 을 못 찾았다. CHROME_PATH 환경변수로 경로를 알려줘.');
  process.exit(2);
}

const fails = [];
const check = (ok, msg) => {
  console.log(`${ok ? '  ok ' : ' FAIL'}  ${msg}`);
  if (!ok) fails.push(msg);
};

const server = await preview({ preview: { port: 4179 }, logLevel: 'silent' });
const base = server.resolvedUrls.local[0];
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--enable-unsafe-swiftshader', '--no-first-run'],
  defaultViewport: VIEW,
});

async function open() {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?trace', { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
  return { page, errors };
}

try {
  // 1) 시트 슬라이스: 모든 행이 6칸이어야 한다 (모자라면 프레임이 합쳐졌거나 사라진 것)
  const { page, errors } = await open();
  console.log('\n[시트]');
  const sheets = await page.evaluate(() =>
    Object.fromEntries(Object.entries(window.__sheets).map(([k, s]) => [k, s.frames.map((r) => r.length)])),
  );
  for (const [k, rows] of Object.entries(sheets))
    check(rows.length === 5 && rows.every((n) => n === 6), `${k}: 행별 칸 수 ${rows.join('/')}`);

  // 2) 루프가 실제로 도는지
  const raf = await page.evaluate(
    () =>
      new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const f = () => (n++, performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(n));
        requestAnimationFrame(f);
      }),
  );
  console.log('\n[런타임]');
  check(raf >= 30, `rAF ${raf}회/초`);

  // 3) 가만히 서서 맞아 본다 — 쥐들이 다가와 여러 번 공격한다
  await new Promise((r) => setTimeout(r, RUN_SECONDS * 1000));
  const tr = await page.evaluate(() => window.__trace);
  check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);

  for (const who of ['cat', 'sword', 'bow', 'fat']) {
    const L = tr.filter((r) => r.who === who && r.state !== 'pop');
    let worst = 0;
    let at = '';
    for (let i = 1; i < L.length; i++) {
      const a = L[i - 1];
      const b = L[i];
      // 몸 중심이 움직인 양에서 캐릭터 위치가 움직인 양을 뺀 것 = 그림이 혼자 튄 양
      const j = Math.abs((b.left + b.right - a.left - a.right) / 2 - (b.sx - a.sx));
      if (j > worst) {
        worst = j;
        at = `r${a.row}c${a.col}→r${b.row}c${b.col}${a.flip !== b.flip ? ' (돌아섬)' : ''}`;
      }
    }
    const widths = L.map((r) => r.right - r.left).sort((p, q) => p - q);
    const usual = widths[widths.length >> 1];
    const merged = L.filter((r) => r.right - r.left > usual * MERGE_RATIO).length;
    const clamped = L.filter((r) => r.clamped).length;
    const faded = L.filter((r) => r.alpha !== 1).length;
    check(L.length > 0 && clamped === 0, `${who}: 없는 칸 요청 ${clamped}회 (${L.length}프레임 중)`);
    check(faded === 0, `${who}: 반투명으로 그린 프레임 ${faded}회`);
    check(merged === 0, `${who}: 옆 프레임과 합쳐진 프레임 ${merged}회 (평소 폭 ${usual.toFixed(0)}px)`);
    check(worst <= JUMP_FAIL_PX, `${who}: 가장 크게 튄 양 ${worst.toFixed(0)}px ${at}`);
  }
  await page.close();

  // 4) 눈으로 볼 연속 촬영: 공격 순간과 피격 순간
  fs.mkdirSync(OUT, { recursive: true });
  console.log('\n[연속 촬영] tools/out/');
  for (const [who, when, file] of [
    ['fat', 'windup', 'fat-attack.png'],
    ['sword', 'windup', 'sword-attack.png'],
    ['cat', 'hurt', 'cat-hit.png'],
  ]) {
    await burst(who, when, new URL(file, OUT));
    console.log('  saved', file);
  }
} finally {
  await browser.close();
  await server.close();
}

console.log(fails.length ? `\n실패 ${fails.length}건` : '\n모두 통과');
process.exit(fails.length ? 1 : 0);

/** who 가 when 상태에 들어가는 순간부터 16컷을 찍어 한 장짜리 격자로 저장한다 */
async function burst(who, when, file) {
  const { page } = await open();
  await page.waitForFunction(
    (who, when) => {
      const r = [...window.__trace].reverse().find((x) => x.who === who);
      return r && (when === 'hurt' ? r.hurtT > 0.25 : r.state === when);
    },
    { polling: 'raf', timeout: 30000 },
    who,
    when,
  );
  const shots = [];
  for (let i = 0; i < 16; i++) {
    const meta = await page.evaluate((who) => [...window.__trace].reverse().find((x) => x.who === who), who);
    shots.push({ img: await page.screenshot({ type: 'jpeg', quality: 85, encoding: 'base64' }), meta });
  }
  const S = Math.min(VIEW.width / 1672, VIEW.height / 941); // 배경 그림 → 화면 배율
  const oy = (VIEW.height - 941 * S) / 2;
  await page.setViewport({ width: 1240, height: 1300 });
  await page.setContent('<body style="margin:0;background:#222"><canvas id=c width=1240 height=1300></canvas></body>');
  await page.evaluate(
    async (shots, S, oy) => {
      const c = document.getElementById('c').getContext('2d');
      c.font = '14px monospace';
      for (let i = 0; i < shots.length; i++) {
        const { img, meta } = shots[i];
        const im = new Image();
        im.src = 'data:image/jpeg;base64,' + img;
        await im.decode();
        const cx = meta.sx * S;
        const cy = meta.sy * S + oy;
        const x = (i % 4) * 310;
        const y = Math.floor(i / 4) * 325;
        c.drawImage(im, cx - 150, cy - 230, 300, 300, x + 5, y + 5, 300, 300);
        c.strokeStyle = 'rgba(255,0,0,0.6)'; // 캐릭터 기준점
        c.beginPath();
        c.moveTo(x + 155, y + 5);
        c.lineTo(x + 155, y + 305);
        c.stroke();
        c.fillStyle = '#fff';
        c.fillText(`${i} ${meta.state ?? ''} r${meta.row}c${meta.col} flip${meta.flip}`, x + 8, y + 320);
      }
    },
    shots,
    S,
    oy,
  );
  await page.screenshot({ path: decodeURIComponent(file.pathname).replace(/^\/(\w:)/, '$1') });
  await page.close();
}
