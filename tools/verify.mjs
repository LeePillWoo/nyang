// npm run verify — 실제 브라우저로 게임을 돌려 "그려진 결과"를 검사한다.
//
// 헤드리스 스크린샷은 게임 루프가 첫 프레임에서 멈춰서 움직임 버그(순간이동·깜빡임)를
// 못 잡는다. 여기서는 Chrome 을 직접 띄워 루프를 실제로 돌리고, 게임의 ?trace 훅이
// 남긴 프레임별 그리기 기록을 분석한다. 눈으로 볼 연속 촬영은 tools/out/ 에 저장한다.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { preview } from 'vite';

const RUN_SECONDS = 10; // 쥐들이 몇 번씩 공격할 만큼
const JUMP_FAIL_PX = 60; // 이보다 크게 튀면 실패. 돌아설 때 꼬리가 반대편으로 넘어가는 건 정상 범위
const MERGE_RATIO = 1.8; // 평소 폭의 이 배를 넘으면 옆 프레임과 합쳐진 것
const VIEW = { width: 1200, height: 676 };
const OUT = new URL('./out/', import.meta.url);
const fsPath = (u) => fileURLToPath(u);
const readJson = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), 'utf8'));
const FIELD = readJson('../src/data/field.json');
const ROOMS = readJson('../src/data/rooms.json');
const ROOM = ROOMS.alley;
// 던전 나가는 곳(맵의 'E') 첫 칸 가운데, 월드 좌표 m (타일 2m)
const EXIT = ROOM.map.flatMap((row, z) => [...row].flatMap((c, x) => (c === 'E' ? [[x * 2 + 1, z * 2 + 1]] : [])))[0];

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
  // 촬영용 탭을 여는 동안 게임 탭이 뒤로 밀려도 루프가 멈추지 않게
  args: ['--enable-unsafe-swiftshader', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
  defaultViewport: VIEW,
});

/** where: 'dungeon' 이면 던전에서 바로 시작, 'field' 면 게임처럼 필드에서 시작. view = 화면 (휴대폰 터치 등), extra = 덧붙일 URL 옵션 */
async function open(where = 'dungeon', room = '', view = null, extra = '') {
  const page = await browser.newPage();
  if (view) await page.setViewport(view);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const q = where === 'dungeon' ? '&dungeon' + (room ? '=' + room : '') : where === 'fishing' ? '&fishing' + (room ? '=' + room : '') : '';
  await page.goto(base + '?trace' + q + extra, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
  return { page, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHEET_ROWS = { axe: 4, boat: 4, snow: 4 }; // 나머지 시트는 5행

/** 필드: 화면 기준 방향키 */
const fieldKeys = (p, t) => [
  ...(t[0] - p.x > 5 ? ['KeyD'] : t[0] - p.x < -5 ? ['KeyA'] : []),
  ...(t[1] - p.y > 4 ? ['KeyS'] : t[1] - p.y < -4 ? ['KeyW'] : []),
];
const fieldPos = () => ({ x: __game.field.x, y: __game.field.y });

/**
 * 필드 연속 촬영: until() 이 참이 되는 순간부터 12컷을 고양이 주변만 잘라 한 장으로 붙인다.
 * 필드는 2배 확대라 고양이가 작아서 한 번 더 2배로 키워 붙인다.
 */
async function fieldBurst(page, until, file, release = []) {
  await page.waitForFunction(until, { polling: 'raf', timeout: 15000 });
  for (const k of release) await page.keyboard.up(k); // 순간을 잡았으면 더 가지 않게 키를 뗀다
  const shots = [];
  for (let i = 0; i < 12; i++) {
    const meta = await page.evaluate(() => ({ ...__game.catScreen, mode: __game.field.mode, chop: __game.field.chopping > 0 }));
    shots.push({ img: await page.screenshot({ type: 'jpeg', quality: 90, encoding: 'base64' }), meta });
  }
  const view = page.viewport();
  const p2 = await browser.newPage();
  await p2.setViewport({ width: 1240, height: 980 });
  await p2.setContent('<body style="margin:0;background:#222"><canvas id=c width=1240 height=980></canvas></body>');
  await p2.evaluate(async (shots) => {
    const c = document.getElementById('c').getContext('2d');
    c.font = '14px monospace';
    for (let i = 0; i < shots.length; i++) {
      const { img, meta } = shots[i];
      const im = new Image();
      im.src = 'data:image/jpeg;base64,' + img;
      await im.decode();
      const x = (i % 4) * 310;
      const y = Math.floor(i / 4) * 325;
      c.drawImage(im, meta.x - 50, meta.y - 70, 100, 100, x + 5, y + 5, 300, 300);
      c.fillStyle = '#fff';
      c.fillText(`${i} ${meta.mode}${meta.chop ? ' 휘두름' : ''}`, x + 8, y + 320);
    }
  }, shots);
  await p2.screenshot({ path: fsPath(file) });
  await p2.close();
  await page.setViewport(view);
  await page.bringToFront();
}

/**
 * 키를 눌러 목표까지 걸어간다. 40ms 마다 위치를 다시 보고 누를 키를 고친다 (쥐에게 밀려도 따라간다).
 * keysFor(pos, target) → 누를 키 코드 배열. done() 이 참이 되거나 시간이 다 되면 멈춘다.
 */
async function walk(page, getPos, target, keysFor, done, ms = 8000) {
  let held = [];
  const set = async (want) => {
    for (const k of held) if (!want.includes(k)) await page.keyboard.up(k);
    for (const k of want) if (!held.includes(k)) await page.keyboard.down(k);
    held = want;
  };
  const t0 = Date.now();
  while (Date.now() - t0 < ms && !(await page.evaluate(done))) {
    await set(keysFor(await page.evaluate(getPos), target));
    await sleep(40);
  }
  await set([]);
  return page.evaluate(done);
}

/**
 * 필드에서 지형 마스크를 따라 목표까지 걸어간다. 걸을 수 있는 칸(걷기·숲) 위로 BFS 길을 찾아
 * 경유점을 하나씩 밟는다 — 암벽·바위이 가로막아도 돌아간다. 마스크를 고쳐도 그대로 쓸 수 있다.
 */
async function walkField(page, target, done, ms = 20000) {
  const route = await page.evaluate((tx, ty) => {
    const S = 6; // 칸 크기 (px)
    const [FW, FH] = __game.size;
    const W = Math.ceil(FW / S);
    const H = Math.ceil(FH / S);
    const ok = (cx, cy) => {
      const t = __game.terrain(cx * S + S / 2, cy * S + S / 2);
      return t === 0 || t === 1;
    };
    const s = __game.field;
    const start = Math.floor(s.y / S) * W + Math.floor(s.x / S);
    const goal = Math.floor(ty / S) * W + Math.floor(tx / S);
    const from = new Int32Array(W * H).fill(-1);
    from[start] = start;
    const q = [start];
    for (let h = 0; h < q.length && from[goal] < 0; h++) {
      const c = q[h];
      const cx = c % W;
      const cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        const n = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || from[n] >= 0 || !ok(nx, ny)) continue;
        if (dx && dy && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue; // 모서리 대각선 금지
        from[n] = c;
        q.push(n);
      }
    }
    if (from[goal] < 0) return null;
    const pts = [];
    for (let c = goal; c !== start; c = from[c]) pts.push([(c % W) * S + S / 2, ((c / W) | 0) * S + S / 2]);
    // 칸 가운데는 목표와 몇 px 어긋나니 마지막 경유점은 목표 좌표 그대로
    return [...pts.reverse().filter((_, i) => i % 3 === 2), [tx, ty]];
  }, target[0], target[1]);
  if (!route) return false;
  const t0 = Date.now();
  for (const p of route) {
    if (await page.evaluate(done)) break;
    const left = ms - (Date.now() - t0);
    if (left <= 0) break;
    await page.evaluate(([x, y]) => Object.assign(window, { __px: x, __py: y }), p);
    await walk(page, fieldPos, p, fieldKeys, () => {
      const s = __game.field;
      return Math.abs(s.x - window.__px) < 5 && Math.abs(s.y - window.__py) < 4;
    }, Math.min(left, 2500));
  }
  return page.evaluate(done);
}

/** 한 캐릭터의 그리기 기록 검사: 없는 칸 요청 · 반투명 · 프레임 병합 · 그림이 혼자 튄 양 */
function motionCheck(tr, who, prefix = '') {
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
  const usual = widths[widths.length >> 1] ?? 0;
  const merged = L.filter((r) => r.right - r.left > usual * MERGE_RATIO).length;
  const clamped = L.filter((r) => r.clamped).length;
  const faded = L.filter((r) => r.alpha !== 1).length;
  const w = prefix + who;
  check(L.length > 0 && clamped === 0, `${w}: 없는 칸 요청 ${clamped}회 (${L.length}프레임 중)`);
  check(faded === 0, `${w}: 반투명으로 그린 프레임 ${faded}회`);
  check(merged === 0, `${w}: 옆 프레임과 합쳐진 프레임 ${merged}회 (평소 폭 ${usual.toFixed(0)}px)`);
  check(worst <= JUMP_FAIL_PX, `${w}: 가장 크게 튄 양 ${worst.toFixed(0)}px ${at}`);
}

try {
  // 1) 시트 슬라이스: 모든 행이 6칸이어야 한다 (모자라면 프레임이 합쳐졌거나 사라진 것)
  const { page, errors } = await open('dungeon');
  console.log('\n[시트]');
  const sheets = await page.evaluate(() =>
    Object.fromEntries(Object.entries(window.__sheets).map(([k, s]) => [k, s.frames.map((r) => r.length)])),
  );
  for (const [k, rows] of Object.entries(sheets))
    check(rows.length === (SHEET_ROWS[k] ?? 5) && rows.every((n) => n === 6), `${k}: 행별 칸 수 ${rows.join('/')}`);

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

  for (const who of ['cat', 'sword', 'bow', 'fat']) motionCheck(tr, who);
  await page.close();
  fs.mkdirSync(OUT, { recursive: true });

  // 3-1) 몬스터 시트 전부 (방에 들어갈 때만 불러오니 여기서 한꺼번에 불러 본다)
  console.log('\n[몬스터 시트]');
  {
    const { page } = await open('dungeon');
    const all = await page.evaluate(() => window.__allEnemySheets());
    const bad = Object.entries(all).filter(([, s]) => s.rows.length !== 5 || s.rows.some((n) => n !== 6));
    check(bad.length === 0, `몬스터 ${Object.keys(all).length}종 모두 5행 x 6칸${bad.length ? ': ' + bad.map(([k, s]) => `${k}(${s.rows.join('/')})`).join(', ') : ''}`);
    // 그림이 옆 컷과 실제로 맞붙은 칸 — 직선으로 갈라서 붙은 끝이 잘린다. 실패로 치지 않고, 고칠 그림을 알린다
    const enemies = readJson('../src/data/enemies.json');
    const sheets = await page.evaluate(() => Object.fromEntries(Object.entries(window.__sheets).map(([k, s]) => [k, s.joined])));
    const joined = [...Object.entries(sheets), ...Object.entries(all).map(([k, s]) => [k, s.joined])].filter(([, j]) => j.length);
    for (const [k, j] of joined) {
      const rows = [...new Set(j.map(([r]) => r))].map((r) => `${r + 1}행 ${j.filter(([v]) => v === r).map(([, c]) => c + 1).sort().join('·')}번째 컷`);
      console.log(`  주의  ${enemies[k]?.sheet?.split('/').pop() ?? k}: 그림이 옆 컷과 붙어 있음 (${rows.join(', ')}) — 몇 px 띄우면 깨끗해진다`);
    }
    if (!joined.length) console.log('  ok   그림이 옆 컷과 붙은 시트 없음');
    await page.close();
  }

  // 3-2) 방마다: 들어가서 잠깐 맞아 본다 — 그림 튐·빠진 칸·에러. 화면은 tools/out/room-<id>.png
  console.log('\n[방]');
  for (const id of Object.keys(ROOMS).filter((k) => k !== 'alley')) {
    const { page, errors } = await open('dungeon', id);
    await sleep(4000);
    const tr = await page.evaluate(() => window.__trace);
    const name = await page.evaluate(() => __game.dungeon.room.def.name);
    check(errors.length === 0 && name === ROOMS[id].name, `${id} (${name}): 페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    for (const who of ['cat', ...new Set(ROOMS[id].spawns.map(([k]) => k))]) motionCheck(tr, who, id + ' ');
    await page.screenshot({ path: fsPath(new URL(`room-${id}.png`, OUT)) });
    await page.close();
  }
  // 3-3) 미니맵·둘러보기 (실제 마우스·키로):
  //  미니맵을 누르면 카메라만 그쪽으로 간다(고양이는 그대로) → 큰 화면에서 포탈을 누르면 고양이가 워프 →
  //  큰 화면을 끌면 지도가 밀린다(워프 아님) → 방향키를 누르면 카메라가 고양이에게 돌아온다
  console.log('\n[미니맵 · 둘러보기]');
  {
    const { page, errors } = await open('field');
    const click = async (p) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    const target = FIELD.warps.find((w) => w.id === 'pyramid');
    const start = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await click(await page.evaluate(() => __game.minimapPoint('pyramid')));
    await sleep(1200);
    const seen = await page.evaluate(() => ({ cat: [__game.field.x, __game.field.y], look: __game.look && [__game.look.x, __game.look.y] }));
    check(seen.cat[0] === start[0] && seen.cat[1] === start[1], '미니맵을 눌러도 고양이는 그 자리에 있다');
    const far = seen.look ? Math.hypot(seen.look[0] - target.at[0], seen.look[1] - target.at[1]) : Infinity;
    check(far < 500, `미니맵을 누르면 카메라가 그쪽으로 간다 (피라미드까지 ${far | 0}px)`);

    await click(await page.evaluate(() => __game.portalScreen('pyramid')));
    const arrived = await page
      .waitForFunction(([x, y]) => Math.hypot(__game.field.x - x, __game.field.y - y) < 4, { timeout: 4000 }, target.at)
      .then(() => true, () => false);
    check(arrived, '큰 화면에서 피라미드 포탈을 누르면 고양이가 그 포탈로 워프');
    await sleep(1500);
    check((await page.evaluate(() => __game.scene)) === 'field', '워프한 자리에서 바로 던전으로 빨려 들어가지 않는다');

    const cat0 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await page.mouse.move(600, 400);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(600 - i * 25, 400 - i * 12);
    await page.mouse.up();
    await sleep(300);
    const dragged = await page.evaluate(() => ({ cat: [__game.field.x, __game.field.y], look: !!__game.look, scene: __game.scene }));
    check(dragged.look && dragged.cat[0] === cat0[0] && dragged.scene === 'field', '큰 화면을 끌면 지도가 밀린다 (워프 아님)');

    await page.keyboard.down('KeyA');
    const home = await page.waitForFunction(() => __game.look === null, { timeout: 3000 }).then(() => true, () => false);
    await page.keyboard.up('KeyA');
    check(home, '둘러보다가 방향키를 누르면 카메라가 고양이에게 돌아온다');

    await page.keyboard.press('KeyM');
    check(!(await page.evaluate(() => __game.showMap)), 'M 키로 미니맵을 끈다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.screenshot({ path: fsPath(new URL('minimap.png', OUT)) });
    await page.close();
  }

  // 3-4) 낚시 (실제 마우스로, 미리 정해 둔 입질 없이):
  //  가까운 물고기 앞쪽을 겨눠 링이 작을 때 던진다 → 저절로 오는 입질을 기다려 챈다 → 날뛸 땐 놓고 아니면 감는다 →
  //  낚음 팝업 · 도감 → Space 로 다시 낚시 → Esc 로 필드 (호수섬 포탈 앞). 그리고 필드의 호수섬 포탈로 들어가면 낚시터
  console.log('\n[낚시]');
  {
    const { page, errors } = await open('fishing');
    const st = () => page.evaluate(() => ({ phase: __game.fishing.phase, run: __game.fishing.run > 0, fail: __game.fishing.fail }));
    check((await page.evaluate(() => __game.scene)) === 'fishing', '?fishing 으로 낚시터에서 시작');
    // 이 시험은 물고기 흐름만 본다 — 가라앉은 물건(건지기)은 끄고 치운다 (건지기는 [상점 · 건지기 · 도감] 에서)
    await page.evaluate(() => {
      __game.fishing.spot.salvage = undefined;
      __game.fishing.fishes = __game.fishing.fishes.filter((f) => !f.item);
    });
    let bit = false;
    let miss = Infinity;
    for (let tries = 0; tries < 4 && !bit; tries++) {
      await page.waitForFunction(() => __game.fishing.phase === 'ready', { timeout: 8000 });
      // 찌를 놀라지 않을 만큼 물고기 머리 앞에 (경계 넘으면 물 안으로)
      const aim = await page.evaluate(() => {
        const s = __game.fishing;
        const [dx, dy] = s.spot.defaultCast;
        const f = s.fishes.filter((v) => v.mode === 'swim' && v.alpha >= 1).sort((a, b) => Math.hypot(a.x - dx, a.y - dy) - Math.hypot(b.x - dx, b.y - dy))[0];
        const [x0, y0, x1, y1] = [1000, 250, 1520, 715];
        const x = f ? Math.min(x1, Math.max(x0, f.x + f.hx * (f.def.scare * f.size + 45))) : dx;
        const y = f ? Math.min(y1, Math.max(y0, f.y + f.hy * (f.def.scare * f.size + 45))) : dy;
        return { x, y, at: __game.fishScreen(x, y) };
      });
      await page.mouse.move(aim.at.x, aim.at.y);
      await page.mouse.down();
      await sleep(530); // 링이 가장 작을 때 (ringPeriod 의 절반)
      await page.mouse.up();
      await page.waitForFunction(() => __game.fishing.phase === 'wait', { timeout: 3000 });
      const landed = await page.evaluate(() => [__game.fishing.castX, __game.fishing.castY]);
      miss = Math.min(miss, Math.hypot(landed[0] - aim.x, landed[1] - aim.y));
      bit = await page.waitForFunction(() => __game.fishing.phase === 'bite', { polling: 'raf', timeout: 30000 }).then(() => true, () => false);
      if (!bit) {
        // 안 물었으면 다시 감고 다시 던진다
        await page.mouse.down();
        await page.mouse.up();
      }
    }
    check(miss < 30, `링이 작을 때 떼면 겨눈 곳 가까이 떨어진다 (${miss.toFixed(0)}px)`);
    check(bit, '물고기 앞쪽에 던지면 저절로 입질이 온다');
    if (bit) {
      await page.mouse.down();
      await page.screenshot({ path: fsPath(new URL('fishing-bite.png', OUT)) }); // 찌가 팍 — 번쩍 고리·느낌표가 아직 남아 있을 때
      await page.waitForFunction(() => __game.fishing.phase === 'reel', { timeout: 3000 });
      let isDown = true;
      for (let i = 0; i < 1500; i++) {
        const s = await st();
        if (s.phase !== 'reel') break;
        if (i === 25) await page.screenshot({ path: fsPath(new URL('fishing-reel.png', OUT)) }); // 힘 ●●○○○
        if (s.run && isDown) {
          await page.mouse.up();
          isDown = false;
        } else if (!s.run && !isDown) {
          await page.mouse.down();
          isDown = true;
        }
        await sleep(30);
      }
      if (isDown) await page.mouse.up();
      const end = await page.evaluate(() => ({ phase: __game.fishing.phase, fail: __game.fishing.fail, catch: __game.fishing.catch, dex: __game.fishing.dex }));
      check(end.phase === 'caught', `날뛸 땐 놓고 아니면 감아서 낚았다 (${end.catch ? `${end.catch.name} ${end.catch.cm}cm` : end.phase + ' ' + end.fail})`);
      check(!!end.catch && end.dex[end.catch.kind]?.count === 1 && end.catch.isNew, '처음 잡은 종은 도감에 들어가고 NEW');
      await sleep(500);
      await page.screenshot({ path: fsPath(new URL('fishing-caught.png', OUT)) });
      await sleep(300);
      await page.keyboard.press('Space');
      const again = await page.waitForFunction(() => __game.fishing.phase === 'ready', { timeout: 2000 }).then(() => true, () => false);
      check(again, 'Space 로 다시 낚시');
    }
    await page.keyboard.press('Escape');
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    const lake = FIELD.warps.find((w) => w.id === 'lake_island');
    const back = await page.evaluate(() => [__game.field.x, __game.field.y]);
    check(out && Math.hypot(back[0] - lake.back[0], back[1] - lake.back[1]) < 5, `Esc 로 필드의 호수섬 포탈 앞으로 나온다 (${back.map((v) => v | 0).join(', ')})`);

    // 필드의 호수섬 포탈에 서 있으면 낚시터로 들어간다
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), lake.at);
    const inFish = await page.waitForFunction(() => __game.scene === 'fishing', { timeout: 5000 }).then(() => true, () => false);
    check(inFish, '필드의 호수섬 정박지 포탈로 들어가면 낚시터');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-5) 낚시터마다: 열린다 · 실제 마우스로 던진 찌가 그곳 물 안에 떨어진다 · 물고기가 물 밖(얼음 위)으로 안 나간다 · 에러 없음.
  //  화면은 tools/out/fishing-<낚시터>.png
  console.log('\n[낚시터]');
  for (const id of Object.keys(readJson('../src/data/fishing.json').spots)) {
    const { page, errors } = await open('fishing', id);
    await page.waitForFunction((id) => __game.scene === 'fishing' && __game.fishing.spotId === id, { timeout: 8000 }, id);
    const spot = await page.evaluate(() => __game.fishing.spot);
    const at = await page.evaluate(([x, y]) => __game.fishScreen(x, y), spot.defaultCast);
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    await sleep(530);
    await page.mouse.up();
    const landed = await page.waitForFunction(() => __game.fishing.phase === 'wait', { timeout: 3000 }).then(() => true, () => false);
    // 2초 동안 물고기 위치를 지켜본다
    const outside = await page.evaluate(
      () =>
        new Promise((done) => {
          const s = __game.fishing;
          const inPoly = (x, y) => {
            let r = false;
            const p = s.spot.water;
            for (let i = 0, j = p.length - 1; i < p.length; j = i++)
              if (p[i][1] > y !== p[j][1] > y && x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) r = !r;
            return r;
          };
          let bad = inPoly(s.bobX, s.bobY) ? 0 : 1000;
          const t0 = performance.now();
          const f = () => {
            for (const v of s.fishes) if (!inPoly(v.x, v.y)) bad++;
            if (performance.now() - t0 < 2000) requestAnimationFrame(f);
            else done(bad);
          };
          f();
        }),
    );
    check(landed && outside === 0 && errors.length === 0, `${id} (${spot.name}): 찌가 물 안에 · 물고기 물 밖 ${outside >= 1000 ? '찌가 밖!' : outside + '프레임'} · 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.screenshot({ path: fsPath(new URL(`fishing-${id}.png`, OUT)) });
    await page.close();
  }

  // 3-6) 터치 (휴대폰 가로 844×390, 실제 터치 입력): 손가락을 대면 터치 UI 가 켜진다 · 조이스틱으로 필드 고양이가 움직인다 ·
  //  도감 버튼 → 탭 바꾸기 → 바깥 눌러 닫기 · 던전에서 조이스틱 + 냥펀치를 두 손가락으로 같이 · 구르기 버튼 · 낮잠은 화면을 눌러 깨기 ·
  //  낚시: 누르고 있다 떼면 던진다 · 도감 판 → 그 낚시터 탭 → ✕ · 돌아가기 버튼. 화면은 tools/out/touch-*.png
  console.log('\n[터치 · 도감]');
  const PHONE = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
  const SPOT_IDS = Object.keys(readJson('../src/data/fishing.json').spots);
  /** 손가락 하나로 (x, y) 를 누르고 to 로 끌어 ms 동안 있다가 뗀다 */
  const hold = async (page, p, to, ms) => {
    const t = await page.touchscreen.touchStart(p.x, p.y);
    for (let i = 1; i <= 4; i++) await t.move(p.x + ((to.x - p.x) * i) / 4, p.y + ((to.y - p.y) * i) / 4);
    await sleep(ms);
    return t;
  };
  const tap = async (page, p) => (await page.touchscreen.touchStart(p.x, p.y)).end();
  {
    const { page, errors } = await open('field', '', PHONE);
    check(!(await page.evaluate(() => __game.touch)), '처음엔 터치 UI 가 아니다');
    // 미니맵을 눌러 켠다 (큰 화면을 누르면 그 밑 포탈로 워프할 수 있어서). 카메라만 그쪽으로 갔다가 조이스틱을 밀면 돌아온다
    await tap(page, await page.evaluate(() => __game.minimapPoint('pyramid')));
    await sleep(500);
    const on = await page.evaluate(() => ({ touch: __game.touch, cls: document.body.classList.contains('touch'), c: __game.controls }));
    check(on.touch && on.cls && !!on.c.stick, '손가락을 대면 터치 UI 가 켜진다 (조이스틱)');

    const s = on.c.stick;
    const p0 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    const t = await hold(page, s, { x: s.x + s.r * 0.9, y: s.y }, 1000);
    const p1 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await page.screenshot({ path: fsPath(new URL('touch-field.png', OUT)) });
    await t.end();
    await sleep(300);
    const p2 = await page.evaluate(() => [__game.field.x, __game.field.y, __game.field.moving]);
    check(p1[0] - p0[0] > 30 && Math.abs(p1[1] - p0[1]) < 15, `조이스틱을 오른쪽으로 밀면 고양이가 오른쪽으로 간다 (${(p1[0] - p0[0]) | 0}, ${(p1[1] - p0[1]) | 0})`);
    check(!p2[2], '조이스틱에서 손을 떼면 멈춘다');

    await tap(page, on.c.buttons.find((b) => b.id === 'dex'));
    check(await page.evaluate(() => __game.dexOpen), '필드의 도감 버튼을 누르면 도감');
    const ds = await page.evaluate(() => __game.dexScreen());
    await tap(page, ds.tabs[3]);
    check((await page.evaluate(() => __game.dexTab)) === SPOT_IDS[3], `도감 탭을 누르면 그 낚시터 (${SPOT_IDS[3]})`);
    const paused = await page.evaluate(async () => {
      const a = __game.field.camX;
      await new Promise((r) => setTimeout(r, 300));
      return a === __game.field.camX;
    });
    check(paused, '도감을 보는 동안 게임이 멈춘다');
    await sleep(600); // 그림 불러오기
    await page.screenshot({ path: fsPath(new URL('touch-dex.png', OUT)) });
    await tap(page, { x: 20, y: 200 });
    check(!(await page.evaluate(() => __game.dexOpen)), '도감 바깥을 누르면 닫힌다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('dungeon', '', PHONE);
    await tap(page, { x: 422, y: 60 }); // 터치 UI 켜기 (던전에선 냥펀치)
    await sleep(900);
    const c = await page.evaluate(() => __game.controls);
    check(!!c.stick && c.buttons.some((b) => b.id === 'punch') && c.buttons.some((b) => b.id === 'dash'), '던전: 조이스틱 · 냥펀치 · 구르기 버튼');
    const x0 = await page.evaluate(() => __game.cat.x);
    const t = await hold(page, c.stick, { x: c.stick.x + c.stick.r * 0.9, y: c.stick.y }, 300);
    // 조이스틱을 쥔 채 다른 손가락으로 냥펀치
    const punch = c.buttons.find((b) => b.id === 'punch');
    const punched = page.waitForFunction(() => __game.dungeon.P.punchT > 0, { polling: 'raf', timeout: 2000 }).then(() => true, () => false);
    await tap(page, punch);
    check(await punched, '조이스틱을 쥔 채 다른 손가락으로 냥펀치 (두 손가락)');
    await page.screenshot({ path: fsPath(new URL('touch-dungeon.png', OUT)) });
    await sleep(400);
    const x1 = await page.evaluate(() => __game.cat.x);
    await t.end();
    check(x1 > x0, `조이스틱으로 던전 고양이가 움직인다 (x ${x0.toFixed(1)} → ${x1.toFixed(1)})`);
    await sleep(500);
    const dashed = page.waitForFunction(() => __game.dungeon.P.dashT > 0, { polling: 'raf', timeout: 2000 }).then(() => true, () => false);
    const d = await page.touchscreen.touchStart(c.buttons.find((b) => b.id === 'dash').x, c.buttons.find((b) => b.id === 'dash').y);
    check(await dashed, '구르기 버튼');
    await d.end();
    // 낮잠: 쓰러지고 1초 뒤 화면을 누르면 집(필드)으로
    await page.evaluate(() => (__game.dungeon.phase = 'napped'));
    await sleep(1300);
    await tap(page, { x: 422, y: 200 });
    const home = await page.waitForFunction(() => __game.scene === 'field', { timeout: 3000 }).then(() => true, () => false);
    check(home, '낮잠 중 화면을 누르면 집에서 깨어난다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('fishing', '', PHONE);
    await page.waitForFunction(() => __game.fishing.phase === 'ready', { timeout: 8000 });
    const cast = await page.evaluate(() => __game.fishScreen(...__game.fishing.spot.defaultCast));
    const t = await hold(page, cast, cast, 530);
    await t.end();
    const landed = await page.waitForFunction(() => __game.fishing.phase === 'wait', { timeout: 3000 }).then(() => true, () => false);
    check(landed, '낚시: 누르고 있다 떼면 던진다 (터치)');
    await page.screenshot({ path: fsPath(new URL('touch-fishing.png', OUT)) });
    // ★1 피라미를 물리고 손가락을 대고 있기만 해도 낚인다 (장력 판·낚음 팝업이 휴대폰에서 커졌는지 화면으로 본다)
    await page.evaluate(() => __game.bite('silver_minnow'));
    const reel = await hold(page, cast, cast, 1200);
    await page.screenshot({ path: fsPath(new URL('touch-fishing-reel.png', OUT)) });
    await page.waitForFunction(() => !['bite', 'hook', 'reel'].includes(__game.fishing.phase), { timeout: 30000 }).catch(() => {});
    await reel.end();
    const got = await page.evaluate(() => __game.fishing.phase);
    check(got === 'caught', `터치로 계속 감아 ★1 피라미를 낚았다 (${got})`);
    await sleep(600);
    await page.screenshot({ path: fsPath(new URL('touch-fishing-caught.png', OUT)) });
    await tap(page, await page.evaluate(() => __game.fishScreen(70, 70))); // 도감 판
    const dex = await page.evaluate(() => ({ open: __game.dexOpen, tab: __game.dexTab }));
    check(dex.open && dex.tab === SPOT_IDS[0], `낚시터 도감 판을 누르면 그 낚시터 탭으로 도감 (${dex.tab})`);
    await sleep(400);
    await page.screenshot({ path: fsPath(new URL('touch-fishing-dex.png', OUT)) });
    await tap(page, (await page.evaluate(() => __game.dexScreen())).close);
    check(!(await page.evaluate(() => __game.dexOpen)), '도감 ✕ 를 누르면 닫힌다');
    await tap(page, await page.evaluate(() => __game.fishScreen(__game.fishing.spot.size[0] - 50, 45))); // 돌아가기
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    check(out, '낚시터 돌아가기 버튼 (터치)');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  // 키보드: B 로 도감, Esc 는 도감만 닫는다 (낚시터를 나가지 않는다)
  {
    const { page, errors } = await open('fishing');
    await page.waitForFunction(() => __game.fishing.phase === 'ready', { timeout: 8000 });
    await page.keyboard.press('KeyB');
    const opened = await page.evaluate(() => __game.dexOpen);
    await page.keyboard.press('Escape');
    await sleep(500);
    const st = await page.evaluate(() => ({ open: __game.dexOpen, scene: __game.scene }));
    check(opened && !st.open && st.scene === 'fishing', 'B 로 도감, Esc 는 도감만 닫는다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  // 화면 크기별 모습 (눈으로 보는 용): 휴대폰 세로 · 태블릿 가로/세로 — tools/out/screen-*.png
  for (const [name, view] of [
    ['phone-portrait', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['tablet', { width: 1024, height: 768, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }],
    ['tablet-portrait', { width: 768, height: 1024, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    const errs = [];
    for (const where of ['field', 'dungeon', 'fishing']) {
      const { page, errors } = await open(where, '', view, '&touch');
      await sleep(800);
      await page.screenshot({ path: fsPath(new URL(`screen-${name}-${where}.png`, OUT)) });
      if (where === 'field') {
        await page.keyboard.press('KeyB');
        await sleep(600);
        await page.screenshot({ path: fsPath(new URL(`screen-${name}-dex.png`, OUT)) });
      }
      errs.push(...errors);
      await page.close();
    }
    check(errs.length === 0, `${name} 화면: 페이지 에러 ${errs.length}건${errs.length ? ': ' + errs[0] : ''}`);
  }

  // 3-7) 가방 · 드롭 (실제 키·마우스): 실제 냥펀치로 쓰러뜨리면 냥코인·아이템이 떨어지고, 방을 깨면 날아와 가방에 →
  //  다가가면 줍는다(알림) → I 로 가방 → 칸 누르고 장착(끼던 건 가방으로) · 벗기 · 다쳤을 때 회복약 · 버리기는 두 번 →
  //  장비 공격력이 냥펀치에 → 새로 고쳐도 남는다 → 휴대폰: 필드 가방 버튼. 화면은 tools/out/bag-*.png
  console.log('\n[가방 · 드롭]');
  {
    const { page, errors } = await open('dungeon');
    await page.evaluate(() => localStorage.removeItem('nyang.bag.v1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
    // 몬스터를 한 대에 쓰러지게 하고 고양이 앞으로 데려와 J 로 때린다
    await page.evaluate(() => __game.dungeon.enemies.forEach((e) => (e.hp = 1)));
    let lootShot = false;
    for (let i = 0; i < 60 && (await page.evaluate(() => __game.dungeon.phase)) === 'playing'; i++) {
      await page.evaluate(() => {
        const d = __game.dungeon;
        const e = d.enemies.find((v) => v.state !== 'pop');
        if (e) Object.assign(e, { x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9 });
      });
      await page.keyboard.press('KeyJ');
      await sleep(120);
      if (!lootShot && (await page.evaluate(() => __game.dungeon.loot.length > 1))) {
        lootShot = true;
        await page.screenshot({ path: fsPath(new URL('bag-drops.png', OUT)) });
      }
    }
    check(lootShot, '실제 냥펀치로 쓰러뜨리면 냥코인·아이템이 떨어진다');
    await sleep(1500);
    const cleared = await page.evaluate(() => ({ phase: __game.dungeon.phase, loot: __game.dungeon.loot.length, coins: __game.bag.coins }));
    check(cleared.phase === 'cleared' && cleared.loot === 0 && cleared.coins > 0, `방을 깨면 남은 게 날아와 가방에 (냥코인 ${cleared.coins})`);

    const ids = ['equipment_12', 'curios_01', 'curios_14'];
    await page.evaluate((ids) => {
      const d = __game.dungeon;
      for (const id of ids) d.loot.push({ id, n: 1, x: d.P.x + 0.6, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 });
    }, ids);
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL('bag-toasts.png', OUT)) });
    const got = await page.evaluate((ids) => ids.map((id) => __game.bag.slots.some((s) => s?.id === id)), ids);
    check(got.every(Boolean), '다가가면 아이템을 줍는다 (주운 것 알림)');

    await page.evaluate(() => (__game.dungeon.P.hp = 40));
    await page.keyboard.press('KeyI');
    check(await page.evaluate(() => __game.bagOpen), 'I 로 가방을 연다 (게임은 멈춘다)');
    const scr = () => page.evaluate(() => __game.bagScreen());
    const click = async (p) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    const idx = (id) => page.evaluate((id) => __game.bag.slots.findIndex((s) => s?.id === id), id);
    await click((await scr()).cells[await idx('equipment_12')]);
    await sleep(100);
    await page.screenshot({ path: fsPath(new URL('bag-desktop-pick.png', OUT)) });
    await click((await scr()).main);
    const eq = await page.evaluate(() => ({ w: __game.bag.equip.weapon, old: __game.bag.slots.some((s) => s?.id === 'equipment_01') }));
    check(eq.w === 'equipment_12' && eq.old, '해적 커틀러스를 눌러 장착 → 끼던 나뭇가지 검은 가방으로');
    await sleep(100);
    await page.screenshot({ path: fsPath(new URL('bag-desktop.png', OUT)) });
    await click((await scr()).main); // 장착하면 장비 칸이 골라져 있다 → 벗기
    check(!(await page.evaluate(() => __game.bag.equip.weapon)), '장비 칸을 눌러 벗기');
    await click((await scr()).cells[await idx('equipment_12')]);
    await click((await scr()).main);
    await click((await scr()).cells[await idx('curios_01')]);
    await click((await scr()).main);
    const hp = await page.evaluate(() => __game.dungeon.P.hp);
    check(hp === 80, `다쳤을 때 작은 회복 물약을 먹으면 체력 40 → ${hp}`);
    await click((await scr()).cells[await idx('curios_14')]);
    await click((await scr()).drop);
    const kept = (await idx('curios_14')) >= 0;
    await click((await scr()).drop);
    check(kept && (await idx('curios_14')) < 0, '버리기는 한 번 더 눌러야 버린다');
    await page.keyboard.press('Escape');
    check(!(await page.evaluate(() => __game.bagOpen)), 'Esc 로 가방을 닫는다');

    // 장비 공격력 +8 이 냥펀치에: 10 + 8 = 18
    await page.keyboard.press('KeyR');
    await sleep(300);
    await page.evaluate(() => {
      const d = __game.dungeon;
      d.enemies = d.enemies.slice(0, 1);
      Object.assign(d.enemies[0], { x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9, hp: 99 });
    });
    await page.keyboard.press('KeyJ');
    await sleep(250);
    const dmg = await page.evaluate(() => __game.dungeon.pops.map((q) => q.text));
    check(dmg.includes('18'), `장비 공격력이 냥펀치에 (피해 ${dmg.join(',')})`);

    const before = await page.evaluate(() => JSON.stringify([__game.bag.coins, Object.entries(__game.bag.equip).sort(), __game.bag.slots]));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
    const after = await page.evaluate(() => JSON.stringify([__game.bag.coins, Object.entries(__game.bag.equip).sort(), __game.bag.slots]));
    check(before === after, '새로 고쳐도 가방·장비·냥코인이 남아 있다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  for (const [name, view] of [
    ['phone', PHONE],
    ['phone-portrait', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ]) {
    const { page, errors } = await open('field', '', view, '&touch');
    await tap(page, (await page.evaluate(() => __game.controls)).buttons.find((b) => b.id === 'bag'));
    const opened = await page.evaluate(() => __game.bagOpen);
    const cell = (await page.evaluate(() => __game.bagScreen())).cells[0];
    await tap(page, cell);
    await sleep(200);
    await page.screenshot({ path: fsPath(new URL(`bag-${name}.png`, OUT)) });
    await tap(page, (await page.evaluate(() => __game.bagScreen())).close);
    check(opened && !(await page.evaluate(() => __game.bagOpen)) && errors.length === 0, `${name}: 필드 가방 버튼으로 열고 ✕ 로 닫기 · 에러 ${errors.length}건`);
    await page.close();
  }

  // 3-8) 상점 · 건지기 · 도감: 강아지마을 포탈에 서면 고등어 상점 → 사기 1개 · 5개 · 팔기(모두) · 닫으면 그 자리에서 다시 안 열린다 →
  //  낚시: 가라앉은 물건을 물리고 감으면 건져서 가방에 (물고기 도감엔 안 센다) → 던전에서 쓰러뜨리면 몬스터 도감 → B 로 도감
  //  (던전에선 몬스터 갈래) · 갈래·탭·칸 누르기 · 휴대폰 세로. 화면은 tools/out/shop-*.png · book-*.png · fishing-salvage.png
  console.log('\n[상점 · 건지기 · 도감]');
  {
    const { page, errors } = await open('field');
    await page.evaluate(() => ['nyang.bag.v1', 'nyang.monsters.v1'].forEach((k) => localStorage.removeItem(k)));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
    await page.evaluate(() => (__game.bag.coins = 500));
    const shopWarp = FIELD.warps.find((w) => w.to === 'shop');
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), shopWarp.at);
    const opened = await page.waitForFunction(() => __game.shopOpen, { timeout: 4000 }).then(() => true, () => false);
    check(opened, `${shopWarp.label} 포탈에 서 있으면 고등어 상점이 열린다`);
    const scr = () => page.evaluate(() => __game.shopScreen());
    const click = async (p) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    const potions = () => page.evaluate(() => __game.bag.slots.reduce((t, s) => t + (s?.id === 'curios_01' ? s.n : 0), 0));
    await click((await scr()).cells[0]); // 첫 물건 = 작은 회복 물약 30냥
    await click((await scr()).main);
    await click((await scr()).drop); // 5개 사기
    await sleep(100);
    await page.screenshot({ path: fsPath(new URL('shop-desktop.png', OUT)) });
    const bought = await page.evaluate(() => __game.bag.coins);
    check((await potions()) === 6 && bought === 500 - 6 * 30, `사기 1개 + 5개 → 물약 ${await potions()}개 · 냥코인 ${bought}`);
    await click((await scr()).modes[1]);
    await click((await scr()).cells[await page.evaluate(() => __game.bag.slots.findIndex((s) => s?.id === 'curios_01'))]);
    await sleep(100);
    await page.screenshot({ path: fsPath(new URL('shop-sell.png', OUT)) });
    await click((await scr()).drop); // 모두 팔기
    const sold = await page.evaluate(() => ({ coins: __game.bag.coins, found: __game.bag.found.curios_01 }));
    check((await potions()) === 0 && sold.coins === bought + 6 * 15 && sold.found === 6, `모두 팔기 → 반값 6 × 15냥 = ${sold.coins - bought} · 도감엔 6개 그대로`);
    await page.keyboard.press('Escape');
    await sleep(1500);
    check(!(await page.evaluate(() => __game.shopOpen)), '닫으면 포탈 위에 있어도 다시 안 열린다 (한 번 벗어났다 와야)');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('fishing');
    await page.waitForFunction(() => __game.fishing.phase === 'ready', { timeout: 8000 });
    const id = 'curios_19'; // 쪽지 든 병
    await page.evaluate((id) => __game.bite(id), id);
    await page.mouse.move(600, 400);
    await page.mouse.down();
    const done = await page.waitForFunction(() => !['bite', 'hook', 'reel'].includes(__game.fishing.phase), { timeout: 20000 }).then(() => true, () => false);
    await page.mouse.up();
    await sleep(600);
    await page.screenshot({ path: fsPath(new URL('fishing-salvage.png', OUT)) });
    const r = await page.evaluate((id) => ({ c: __game.fishing.catch, has: __game.bag.slots.some((s) => s?.id === id), dex: Object.keys(__game.fishing.dex).length }), id);
    check(done && r.c?.item && r.c.kind === id && r.has, `가라앉은 물건을 물리고 감으면 건져서 가방에 (${r.c?.name})`);
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('dungeon');
    await page.evaluate(() => localStorage.removeItem('nyang.monsters.v1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
    await page.evaluate(() => {
      const d = __game.dungeon;
      const e = d.enemies.find((v) => v.kind === 'sword');
      Object.assign(e, { hp: 1, x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9 });
    });
    await page.keyboard.press('KeyJ');
    await sleep(300);
    const mon = await page.evaluate(() => ({ n: __game.monsters.sword, saved: JSON.parse(localStorage.getItem('nyang.monsters.v1') ?? '{}').sword }));
    check(mon.n === 1 && mon.saved === 1, '쓰러뜨리면 몬스터 도감에 센다 (저장도)');
    check((await page.evaluate(() => __game.ungrouped())).length === 0, '모든 몬스터가 도감 지역에 들어 있다');
    await page.keyboard.press('KeyB');
    const book = await page.evaluate(() => ({ open: __game.dexOpen, cat: __game.book.cat, tab: __game.book.tab.monster }));
    check(book.open && book.cat === 'monster' && book.tab === 'rat', `던전에서 B → 도감 몬스터 갈래 · 그 방 지역 (${book.cat} ${book.tab})`);
    const ds = () => page.evaluate(() => __game.dexScreen());
    const click = async (p) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    await click((await ds()).cells[0]);
    await sleep(500); // 몬스터 그림 불러오기
    await page.screenshot({ path: fsPath(new URL('book-monster.png', OUT)) });
    check((await page.evaluate(() => __game.book.pick)) === 'sword', '몬스터 칸을 누르면 설명');
    await click((await ds()).chips[2]);
    await click((await ds()).cells[0]);
    await sleep(200);
    await page.screenshot({ path: fsPath(new URL('book-item.png', OUT)) });
    const it = await page.evaluate(() => ({ cat: __game.book.cat, pick: __game.book.pick }));
    check(it.cat === 'item' && it.pick === 'equipment_01', `아이템 갈래 · 칸 (${it.pick})`);
    await click((await ds()).chips[0]);
    check((await page.evaluate(() => __game.book.cat)) === 'fish', '물고기 갈래');
    await click((await ds()).close);
    check(!(await page.evaluate(() => __game.dexOpen)) && errors.length === 0, `✕ 로 닫기 · 페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  for (const [name, view] of [['phone-portrait', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }], ['phone', PHONE]]) {
    const { page, errors } = await open('field', '', view, '&touch');
    await page.keyboard.press('KeyB');
    await tap(page, (await page.evaluate(() => __game.dexScreen())).chips[1]);
    await tap(page, (await page.evaluate(() => __game.dexScreen())).cells[0]);
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL(`book-${name}.png`, OUT)) });
    await tap(page, (await page.evaluate(() => __game.dexScreen())).close);
    const shopWarp = FIELD.warps.find((w) => w.to === 'shop');
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), shopWarp.at);
    await page.waitForFunction(() => __game.shopOpen, { timeout: 4000 }).catch(() => {});
    await tap(page, (await page.evaluate(() => __game.shopScreen())).cells[3]);
    await sleep(200);
    await page.screenshot({ path: fsPath(new URL(`shop-${name}.png`, OUT)) });
    check(errors.length === 0, `${name}: 도감·상점 화면 · 페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 4) 왕복: 필드에서 시작 → 골목 던전 포탈(고양이마을) 앞으로 → 포탈로 걸어가 머문다 → 던전 → 나가는 칸으로 걸어 나간다 → 필드
  console.log('\n[필드 ↔ 던전 왕복]');
  {
    const { page, errors } = await open('field');
    const game = await page.evaluate(() => ({ scene: __game.scene, x: __game.field.x, y: __game.field.y }));
    check(game.scene === 'field', `필드에서 시작 (장면 ${game.scene})`);

    await page.keyboard.down('KeyD');
    await sleep(400);
    await page.keyboard.up('KeyD');
    const moved = await page.evaluate(() => __game.field.x);
    check(moved > game.x + 20, `D 키로 오른쪽으로 걷는다 (${game.x.toFixed(0)} → ${moved.toFixed(0)})`);

    const ALLEY = FIELD.warps.find((w) => w.to === 'alley');
    await page.evaluate(([x, y]) => Object.assign(__game.field, { x, y, camX: x, camY: y, armed: true, mode: 'walk' }), ALLEY.back);
    await sleep(300);
    const warp = await page.evaluate(() => __game.field.warp ?? null);
    await walk(page, fieldPos, ALLEY.at, fieldKeys, () => __game.field.dwell > 0.3);
    await page.screenshot({ path: fsPath(new URL('field-warp.png', OUT)) });
    const entered = await page.waitForFunction(() => __game.scene === 'dungeon', { timeout: 4000 }).then(() => true, () => false);
    check(entered && warp === null, '워프에 머물면 던전으로 들어간다');

    await sleep(500); // 덮개가 걷히길 기다린다
    await page.screenshot({ path: fsPath(new URL('dungeon-exit.png', OUT)) });
    // 던전: 원하는 월드 방향 → 화면 방향키 (아이소메트릭 45도)
    const dungeonKeys = (p, t) => {
      const fx = t[0] - p.x;
      const fz = t[1] - p.z;
      const d = Math.hypot(fx, fz) || 1;
      const mx = ((fx - fz) / d) * Math.SQRT1_2;
      const my = ((fx + fz) / d) * Math.SQRT1_2;
      return [...(mx > 0.35 ? ['KeyD'] : mx < -0.35 ? ['KeyA'] : []), ...(my > 0.35 ? ['KeyS'] : my < -0.35 ? ['KeyW'] : [])];
    };
    // 실제 게임처럼 방을 비운 뒤(클리어) 걸어 나간다 — 클리어하면 못 움직이던 버그가 있었다
    await page.evaluate(() => {
      __game.dungeon.enemies = [];
    });
    await page.waitForFunction(() => __game.dungeon.phase === 'cleared', { timeout: 3000 });
    const left = await walk(page, () => __game.cat, EXIT, dungeonKeys, () => __game.scene === 'field', 10000);
    check(left, '방을 클리어한 뒤 나가는 칸까지 걸어가 필드로 나온다');
    await sleep(500);
    const back = await page.evaluate(() => ({ x: __game.field.x, y: __game.field.y, armed: __game.field.armed }));
    const [bx, by] = ALLEY.back;
    // 도착 순간 아직 누르고 있던 키로 몇 픽셀 걸을 수 있다 (게임에서도 정상 동작)
    check(Math.abs(back.x - bx) < 15 && Math.abs(back.y - by) < 15, `들어갔던 포탈 앞으로 돌아온다 (${back.x.toFixed(0)}, ${back.y.toFixed(0)})`);
    await sleep(1500);
    check((await page.evaluate(() => __game.scene)) === 'field', '돌아오자마자 다시 빨려 들어가지 않는다');
    await page.screenshot({ path: fsPath(new URL('field-back.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 5) 필드 지형: 바다로 걸어가 배를 타고, 뭍으로 돌아와 내리고, 숲에서 도끼질한다
  console.log('\n[필드 지형: 걷기 · 배 · 도끼]');
  {
    const { page, errors } = await open('field');
    // 매 프레임 불변식 감시: 물 위를 걷거나 땅 위에서 배를 타면 기록한다
    await page.evaluate(() => {
      window.__viol = [];
      window.__bridged = false;
      window.__modes = [];
      const f = () => {
        if (__game.scene === 'field') {
          const s = __game.field;
          const afloat = s.mode === 'boat' || s.mode === 'board' || s.mode === 'unboard';
          const t = __game.terrain(s.x, s.y);
          if (t === 3) __viol.push(`막힌 곳 위 ${s.mode} @ ${s.x | 0},${s.y | 0}`);
          // 배가 땅 위에 있어도 되는 건 다리(노랑) 위뿐
          else if (afloat !== (t === 2) && !(s.mode === 'boat' && t === 4)) __viol.push(`${s.mode} @ ${s.x | 0},${s.y | 0} (지형 ${t})`);
          if (s.mode === 'boat' && t === 4) __bridged = true;
          if (__modes[__modes.length - 1] !== s.mode) __modes.push(s.mode);
        }
        requestAnimationFrame(f);
      };
      f();
    });
    const start = await page.evaluate(fieldPos);

    // 바다: 선착장에서 남쪽으로
    await page.keyboard.down('KeyS');
    await fieldBurst(page, () => __game.field.mode === 'board', new URL('field-board.png', OUT), ['KeyS']);
    const boarded = await page.waitForFunction(() => __game.field.mode === 'boat', { timeout: 3000 }).then(() => true, () => false);
    check(boarded, '물가로 걸어가면 배에 오른다');
    await page.keyboard.down('KeyS');
    await sleep(350);
    await page.keyboard.up('KeyS');
    const rowed = await page.evaluate(fieldPos);
    check((await page.evaluate(() => __game.field.mode)) === 'boat' && rowed.y > start.y + 25, `배로 나아간다 (y ${start.y | 0} → ${rowed.y | 0})`);

    // 뭍: 다시 북쪽으로
    await page.keyboard.down('KeyW');
    await fieldBurst(page, () => __game.field.mode === 'unboard', new URL('field-unboard.png', OUT), ['KeyW']);
    const landed = await page.waitForFunction(() => __game.field.mode === 'walk' || __game.field.mode === 'axe', { timeout: 3000 }).then(() => true, () => false);
    check(landed, '뭍에 닿으면 배에서 내린다');

    // 숲: 좌우로 50px 를 오가도 숲을 벗어나지 않는 가까운 곳을 지형 마스크에서 찾아 그리로 걸어간다.
    // (가장자리에서 한쪽으로 계속 걸리면 방향에 따라 도끼질 주기 전에 숲을 빠져나간다)
    const woods = await page.evaluate(() => {
      const s = __game.field;
      const deep = (x, y) => {
        for (let d = 0; d <= 56; d += 4)
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 0.5], [0, -0.5]])
            if (__game.terrain(x + dx * d, y + dy * d) !== 1) return false;
        return true;
      };
      let best = null;
      const [FW, FH] = __game.size;
      for (let y = 40; y < FH - 40; y += 6)
        for (let x = 60; x < FW - 60; x += 6) {
          if (__game.terrain(x, y) !== 1 || !deep(x, y)) continue;
          const d = Math.hypot(x - s.x, y - s.y);
          if (!best || d < best.d) best = { x, y, d };
        }
      return best;
    });
    check(!!woods, `가까운 깊은 숲 (${woods ? `${woods.x}, ${woods.y}` : '없음'})`);
    if (woods) {
      await page.evaluate((x, y) => Object.assign(window, { __wx: x, __wy: y }), woods.x, woods.y);
      const near = await walkField(page, [woods.x, woods.y], () => {
        const s = __game.field;
        return s.mode === 'axe' && Math.hypot(s.x - window.__wx, s.y - window.__wy) < 14;
      }, 30000);
      check(near && (await page.evaluate(() => __game.field.mode)) === 'axe', '숲에 들어가면 도끼를 든다');
      // 그 자리에서 좌우로 오가며 걷는다 — 촬영과 동시에
      let stop = false;
      const pace = (async () => {
        for (let right = true; !stop; right = !right) {
          const k = right ? 'KeyD' : 'KeyA';
          await page.keyboard.down(k);
          await sleep(500);
          await page.keyboard.up(k);
        }
      })();
      await fieldBurst(page, () => __game.field.chopping > 0, new URL('field-chop.png', OUT));
      await sleep(1500);
      stop = true;
      await pace;
      const chops = await page.evaluate(() => __game.field.chops);
      check(chops >= 2, `숲을 걸으면 도끼질을 한다 (${chops}회)`);
    }

    // 조각 이음: 모든 줄·모든 칸이 어느 조각에서든 지형을 돌려줘야 한다 (조각 높이 470·471 이 섞여 경계 계산이 어긋나기 쉽다)
    const holes = await page.evaluate(() => {
      const [FW, FH] = __game.size;
      let n = 0;
      for (const x of [0, 835, 836, FW - 1]) for (let y = 0; y < FH; y++) if (__game.terrain(x, y) === undefined) n++;
      for (const y of [0, 469, 470, 471, 940, 941, 1411, FH - 1]) for (let x = 0; x < FW; x++) if (__game.terrain(x, y) === undefined) n++;
      return n;
    });
    check(holes === 0, `조각 경계에서 지형을 못 읽는 픽셀 ${holes}개`);

    // 갈 수 있는가: 시작점에서 모든 워프까지 (물은 배로 건너니 검정만 벽이다). 마스크를 고치다 입구를 막으면 여기서 잡힌다
    const cut = await page.evaluate((start, warps) => {
      const S = 4;
      const [FW, FH] = __game.size;
      const W = Math.ceil(FW / S);
      const H = Math.ceil(FH / S);
      const open = (c) => __game.terrain((c % W) * S + S / 2, ((c / W) | 0) * S + S / 2) !== 3;
      const s0 = Math.floor(start[1] / S) * W + Math.floor(start[0] / S);
      const seen = new Uint8Array(W * H);
      seen[s0] = 1;
      const q = [s0];
      for (let h = 0; h < q.length; h++) {
        const c = q[h];
        const x = c % W;
        for (const n of [c - 1, c + 1, c - W, c + W])
          if (n >= 0 && n < W * H && !seen[n] && Math.abs((n % W) - x) <= 1 && open(n)) {
            seen[n] = 1;
            q.push(n);
          }
      }
      return warps.filter((w) => !seen[Math.floor(w.at[1] / S) * W + Math.floor(w.at[0] / S)]).map((w) => w.id);
    }, FIELD.start, FIELD.warps);
    check(cut.length === 0, `시작점에서 모든 워프까지 갈 수 있다 (워프 ${FIELD.warps.length}개${cut.length ? ', 막힌 워프: ' + cut.join(', ') : ''})`);
    // 워프는 뭍(걷기·숲)에서만 작동한다 — 포탈 한가운데가 물·막힘·다리면 연결해도 못 들어간다
    const wet = await page.evaluate((warps) => warps.filter((w) => __game.terrain(w.at[0], w.at[1]) > 1).map((w) => `${w.id}(지형 ${__game.terrain(w.at[0], w.at[1])})`), FIELD.warps);
    check(wet.length === 0, `모든 포탈이 뭍 위에 있다${wet.length ? ': ' + wet.join(', ') : ''}`);
    // 던전·낚시터에서 나오면 back 에 선다 — 거기도 뭍이어야 한다
    const wetBack = await page.evaluate((warps) => warps.filter((w) => w.to && __game.terrain(w.back[0], w.back[1]) > 1).map((w) => w.id), FIELD.warps);
    check(wetBack.length === 0, `연결된 포탈의 돌아올 자리가 모두 뭍이다${wetBack.length ? ': ' + wetBack.join(', ') : ''}`);

    // 막힘: 가장 가까운 암벽·바위 덩어리 한가운데를 향해 3초 동안 밀고 들어가 본다
    const wall = await page.evaluate(() => {
      const s = __game.field;
      const solid = (x, y) => [[0, 0], [10, 0], [-10, 0], [0, 8], [0, -8]].every(([dx, dy]) => __game.terrain(x + dx, y + dy) === 3);
      let best = null;
      const [FW, FH] = __game.size;
      for (let y = 30; y < FH - 30; y += 5)
        for (let x = 30; x < FW - 30; x += 5) {
          if (!solid(x, y)) continue;
          const d = Math.hypot(x - s.x, y - s.y);
          if (!best || d < best.d) best = { x, y, d };
        }
      return best;
    });
    if (wall) {
      await walk(page, fieldPos, [wall.x, wall.y], fieldKeys, () => false, 3000);
      const at = await page.evaluate(() => ({ ...{ x: __game.field.x, y: __game.field.y }, t: __game.terrain(__game.field.x, __game.field.y) }));
      const gap = Math.hypot(at.x - wall.x, at.y - wall.y);
      check(at.t !== 3 && gap < wall.d, `암벽·바위로 밀고 들어가면 가장자리에서 멈춘다 (목표 ${wall.x},${wall.y} 까지 ${wall.d | 0} → ${gap | 0}px 에서 멈춤)`);
    } else check(false, '지형 마스크에 막힌 곳이 없다');

    // 다리: 배로 강을 따라가다 다리를 만나도 내리지 않고 지나간다 (필드 그림 픽셀 좌표, 양방향).
    // 마스크를 고치다 다리(노랑)를 끊으면 여기서 잡힌다
    // 좌표는 한 장 지도 시절에 잰 값 + 그 지도가 들어간 자리(6x6 조각의 가운데 판 = 1672, 941)
    const CROSSINGS = [
      ['서쪽 나무다리: 호수 → 강', [905, 318], ['KeyS']],
      ['서쪽 나무다리: 강 → 호수', [915, 380], ['KeyW']],
      ['돌다리: 위 강 → 아래 강', [1110, 470], ['KeyS', 'KeyD']],
      ['돌다리: 아래 강 → 위 강', [1190, 525], ['KeyW', 'KeyA']],
    ].map(([name, [x, y], keys]) => [name, [x + 1672, y + 941], keys]);
    for (const [name, [x, y], keys] of CROSSINGS) {
      await page.evaluate(([x, y]) => {
        Object.assign(__game.field, { x, y, camX: x, camY: y, mode: 'boat', modeT: 1, chopping: 0 });
        window.__bridged = false;
        window.__modes = ['boat'];
      }, [x, y]);
      for (const k of keys) await page.keyboard.down(k);
      // 다리를 지나 다시 물 위에 뜨면 바로 멈춘다 (계속 가면 건너편 강둑에 닿아 내린다)
      const across = await page
        .waitForFunction(() => __bridged && __game.terrain(__game.field.x, __game.field.y) === 2, { polling: 'raf', timeout: 4000 })
        .then(() => true, () => false);
      for (const k of keys) await page.keyboard.up(k);
      const after = await page.evaluate(() => ({ mode: __game.field.mode, modes: __modes }));
      check(across && after.mode === 'boat' && !after.modes.includes('unboard'), `${name} — 배로 그대로 지나간다 (${after.modes.join(' → ')})`);
    }
    // 돌다리 연속 촬영
    await page.evaluate(() => {
      Object.assign(__game.field, { x: 1100 + 1672, y: 463 + 941, camX: 1100 + 1672, camY: 463 + 941, mode: 'boat', modeT: 1 });
      window.__bridged = false;
    });
    await page.keyboard.down('KeyS');
    await page.keyboard.down('KeyD');
    await fieldBurst(page, () => __bridged, new URL('field-bridge.png', OUT));
    await page.keyboard.up('KeyS');
    await page.keyboard.up('KeyD');

    const viol = await page.evaluate(() => __viol);
    check(viol.length === 0, `물 위를 걷거나, 땅 위에서 배를 타거나, 막힌 곳 위에 선 프레임 ${viol.length}개${viol.length ? ': ' + viol[0] : ''}`);
    console.log('       지나간 모드:', (await page.evaluate(() => __modes)).join(' → '));
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 6) 눈으로 볼 연속 촬영: 공격 순간과 피격 순간
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
  await page.screenshot({ path: fsPath(file) });
  await page.close();
}
