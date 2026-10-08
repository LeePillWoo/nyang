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
const WAVE_DATA = readJson('../src/data/waves.json');
const PLAYER_DATA = readJson('../src/data/player.json');
const SKILL_DATA = readJson('../src/data/skills.json');
const SHOP_DATA = readJson('../src/data/shop.json');
const { OBS: SAND_OBS, SAND: SAND_CFG, coast: sandCoast, center: sandCenter, width: sandWidth } = await import('../src/sandboard.ts');
/** 개방 구역(field.json open) 안의 워프 — 잠긴 구역 밖 워프는 갈 수 없는 게 맞다 */
const inOpen = (x, y) => {
  const c = Math.min(FIELD.grid[0] - 1, Math.floor((x * FIELD.grid[0]) / FIELD.size[0]));
  const r = Math.min(FIELD.grid[1] - 1, Math.floor((y * FIELD.grid[1]) / FIELD.size[1]));
  return FIELD.open[r]?.[c] === 'o';
};
const OPEN_WARPS = FIELD.warps.filter((w) => inOpen(w.at[0], w.at[1]));
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
  const q =
    where === 'dungeon' ? '&dungeon' + (room ? '=' + room : '') : where === 'fishing' ? '&fishing' + (room ? '=' + room : '') : ['maze', 'sandboard', 'timber', 'chase', 'village'].includes(where) ? '&' + where : '';
  await page.goto(base + '?trace' + q + extra, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
  return { page, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 레벨 업 카드가 뜨면 저절로 첫 장을 고른다 (기술과 상관없는 던전 검사용) */
const autoPick = (page) => page.evaluate(() => setInterval(() => __game.dungeon?.choose && __game.pick(0), 40));
/** 마우스로 (x, y) 누르기 */
const click2 = async (page, p) => {
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.up();
};
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
  const caught = await page.waitForFunction(until, { polling: 'raf', timeout: 15000 }).then(() => true, () => false);
  for (const k of release) await page.keyboard.up(k); // 순간을 잡았으면 더 가지 않게 키를 뗀다
  if (!caught) return check(false, `연속 촬영 ${file.pathname.split('/').pop()}: 15초 안에 그 순간이 오지 않았다`);
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
 * 지금 미로(__game.maze)를 BFS 로 풀어 모퉁이마다 WASD 로 걸어 출구까지 간다. 세 번째 모퉁이에서 shot 화면을 찍는다.
 * 돌려주는 것: 걸음 수
 */
async function solveMaze(page, shot) {
  const m = await page.evaluate(() => ({ w: __game.maze.w, h: __game.maze.h, solid: __game.maze.grid.solid, exit: __game.maze.exit }));
  const W = m.w;
  const dist = new Int32Array(W * m.h).fill(-1);
  const q = [1 * W + 1];
  dist[q[0]] = 0;
  for (let h = 0; h < q.length; h++) {
    const c = q[h];
    const x = c % W;
    const z = (c - x) / W;
    for (const [nx, nz] of [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]])
      if (nx >= 0 && nz >= 0 && nx < W && nz < m.h && !m.solid[nz * W + nx] && dist[nz * W + nx] < 0) {
        dist[nz * W + nx] = dist[c] + 1;
        q.push(nz * W + nx);
      }
  }
  const path = [m.exit];
  for (let [x, z] = m.exit; dist[z * W + x] > 0; ) {
    [x, z] = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]].find(([nx, nz]) => nx >= 0 && nz >= 0 && nx < W && nz < m.h && !m.solid[nz * W + nx] && dist[nz * W + nx] === dist[z * W + x] - 1);
    path.push([x, z]);
  }
  path.reverse();
  const corners = path.filter((p, i) => i === path.length - 1 || (i > 0 && path[i - 1][0] !== path[i + 1][0] && path[i - 1][1] !== path[i + 1][1]));
  const mazeKeys = (p, t) => [
    ...(t[0] - p.x > 0.08 ? ['KeyD'] : t[0] - p.x < -0.08 ? ['KeyA'] : []),
    ...(t[1] - p.y > 0.08 ? ['KeyS'] : t[1] - p.y < -0.08 ? ['KeyW'] : []),
  ];
  const mazePos = () => ({ x: __game.maze.x / 2, y: __game.maze.z / 2 });
  for (const [i, [cx, cz]] of corners.entries()) {
    const done = eval(`() => __game.maze.phase === 'done' || Math.hypot(__game.maze.x / 2 - ${cx + 0.5}, __game.maze.z / 2 - ${cz + 0.5}) < 0.12`);
    await walk(page, mazePos, [cx + 0.5, cz + 0.5], mazeKeys, done, 6000);
    if (i === 3 && shot) await page.screenshot({ path: fsPath(new URL(shot, OUT)) });
  }
  return path.length - 1;
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
  // 같은 종류가 여럿이면(웨이브) 몬스터마다 따로 잇는다 — uid
  const pairs = [];
  const prev = new Map();
  for (const r of L) {
    const k = r.uid ?? 0;
    if (prev.has(k)) pairs.push([prev.get(k), r]);
    prev.set(k, r);
  }
  for (const [a, b] of pairs) {
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
      .waitForFunction(([x, y]) => Math.hypot(__game.field.x - x, __game.field.y - y) < 4, { timeout: 4000 }, target.back)
      .then(() => true, () => false);
    check(arrived, '큰 화면에서 피라미드 포탈을 누르면 고양이가 그 포탈 앞(이정표 옆, 워프 밖)으로 워프');
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
    // 워프해 내린 자리에서 포탈 쪽으로 한 걸음이면 들어간다 (나갔다 다시 들어올 필요 없음)
    await click(await page.evaluate(() => __game.portalScreen('pyramid')));
    await page.waitForFunction(([x, y]) => Math.hypot(__game.field.x - x, __game.field.y - y) < 4, { timeout: 4000 }, target.back).catch(() => {});
    await sleep(300);
    await page.keyboard.down('KeyW'); // 포탈 위까지 한 걸음 걷고 멈춰 선다 (포탈은 머물러야 들어간다)
    await page.waitForFunction(([x, y]) => Math.hypot(__game.field.x - x, __game.field.y - y) < 5, { timeout: 3000 }, target.at).catch(() => {});
    await page.keyboard.up('KeyW');
    const walkedIn = await page.waitForFunction(() => __game.scene === 'maze', { timeout: 5000 }).then(() => true, () => false);
    check(walkedIn, '워프한 자리에서 포탈로 걸어 들어가면 바로 들어간다');
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
      const food = await page.evaluate(() => __game.bag.slots.reduce((t, v) => t + (v?.id === 'cook_fish' ? v.n : 0), 0));
      check(end.catch?.food >= 1 && food === end.catch.food, `낚은 물고기는 요리 재료 생선 ${food}마리로 가방에`);
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
    // 조이스틱은 모서리에서 조금 안쪽에 쉬고, 왼쪽 아래 영역 어디를 눌러도 그 자리에 생긴다 — 손가락이 멀어지면 받침이 따라온다
    const st = on.c.stick;
    check(st.x - st.r >= 40 && PHONE.height - (st.y + st.r) >= 30, `조이스틱이 구석에서 안쪽으로 (왼쪽 ${(st.x - st.r) | 0}px · 아래 ${(PHONE.height - st.y - st.r) | 0}px 떨어짐)`);
    const at = { x: (st.zone.x0 + st.zone.x1) * 0.6, y: st.zone.y0 + (st.zone.y1 - st.zone.y0) * 0.5 };
    const q0 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    const tt = await hold(page, at, { x: at.x + st.r * 3, y: at.y }, 700);
    const held = await page.evaluate(() => __game.stick);
    const q1 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await tt.end();
    check(
      !!held && Math.abs(held.bx - (at.x + st.r * 2)) < 4 && Math.abs(held.by - at.y) < 4 && q1[0] - q0[0] > 20,
      `영역 안 다른 곳을 눌러도 조이스틱이 그 자리에 생기고 손가락을 따라온다 (받침 ${held ? held.bx.toFixed(0) : '없음'} · 고양이 +${(q1[0] - q0[0]) | 0})`,
    );
    await sleep(300);
    // 조이스틱 영역 안이어도 움직이지 않고 톡 누른 자리가 포탈이면 워프
    const harbor = FIELD.warps.find((w) => w.id === 'cat_harbor');
    await page.evaluate(([x, y]) => Object.assign(__game.field, { x, y, camX: x, camY: y }), [harbor.at[0] + 120, harbor.at[1] - 60]);
    await sleep(400);
    const ps = await page.evaluate(() => __game.portalScreen('cat_harbor'));
    const inZone = ps.x >= st.zone.x0 && ps.x <= st.zone.x1 && ps.y >= st.zone.y0 && ps.y <= st.zone.y1;
    await tap(page, ps);
    const warped = await page.waitForFunction((b) => Math.hypot(__game.field.x - b[0], __game.field.y - b[1]) < 3, { timeout: 2500 }, harbor.back).then(() => true, () => false);
    check(inZone && warped, `조이스틱 영역 안의 포탈도 톡 누르면 워프 (포탈 ${ps.x | 0}, ${ps.y | 0})`);
    await sleep(300);

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
    await autoPick(page); // 자동 냥펀치로 쓰러뜨리면 레벨 업 카드가 뜬다 — 이 검사는 조작만 본다
    await tap(page, { x: 422, y: 60 }); // 터치 UI 켜기 (던전에서 화면 누르기는 아무것도 안 한다 — 냥펀치는 자동)
    await sleep(900);
    const c = await page.evaluate(() => __game.controls);
    check(!!c.stick && !c.buttons.some((b) => b.id === 'punch') && c.buttons.some((b) => b.id === 'dash'), '던전: 조이스틱 · 구르기 버튼 (냥펀치 버튼 없음 — 자동)');
    const dashB = c.buttons.find((b) => b.id === 'dash');
    check(PHONE.width - (dashB.x + dashB.r) >= 40 && PHONE.height - (dashB.y + dashB.r) >= 30, `구르기 버튼도 구석에서 안쪽으로 (오른쪽 ${(PHONE.width - dashB.x - dashB.r) | 0}px)`);
    const x0 = await page.evaluate(() => __game.cat.x);
    const t = await hold(page, c.stick, { x: c.stick.x + c.stick.r * 0.9, y: c.stick.y }, 300);
    // 조이스틱으로 움직이는 동안 몬스터가 타격 범위에 들어오면 저절로 냥펀치
    await page.evaluate(() => {
      const d = __game.dungeon;
      const e = d.enemies.find((v) => v.state !== 'pop');
      if (e) Object.assign(e, { x: d.P.x + 1.2, z: d.P.z });
    });
    const punched = await page.waitForFunction(() => __game.dungeon.P.punchT > 0, { polling: 'raf', timeout: 2000 }).then(() => true, () => false);
    check(punched, '움직이는 중 몬스터가 가까우면 저절로 냥펀치 (버튼 없이)');
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
    // 낮잠: 잠깐 뒤 결과창(진 판) → '필드로' 버튼을 누르면 필드로
    await page.evaluate(() => (__game.dungeon.phase = 'napped'));
    const lost = await page.waitForFunction(() => __game.dungeon.result && !__game.dungeon.result.win, { timeout: 3000 }).then(() => true, () => false);
    check(lost, '낮잠에 빠지면 결과창 (진 판)');
    await sleep(300);
    await page.screenshot({ path: fsPath(new URL('dungeon-result-nap-phone.png', OUT)) });
    await tap(page, await page.evaluate(() => __game.resultPoint('leave')));
    const home = await page.waitForFunction(() => __game.scene === 'field', { timeout: 3000 }).then(() => true, () => false);
    check(home, "결과창의 '필드로' 를 누르면 필드로");
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
    await tap(page, await page.evaluate(() => __game.fishButton('dex'))); // 도감 판 (화면 왼쪽 위)
    const dex = await page.evaluate(() => ({ open: __game.dexOpen, tab: __game.dexTab }));
    check(dex.open && dex.tab === SPOT_IDS[0], `낚시터 도감 판을 누르면 그 낚시터 탭으로 도감 (${dex.tab})`);
    await sleep(400);
    await page.screenshot({ path: fsPath(new URL('touch-fishing-dex.png', OUT)) });
    await tap(page, (await page.evaluate(() => __game.dexScreen())).close);
    check(!(await page.evaluate(() => __game.dexOpen)), '도감 ✕ 를 누르면 닫힌다');
    await tap(page, await page.evaluate(() => __game.fishButton('leave'))); // 돌아가기 (화면 오른쪽 위)
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
  {
    // 샌드보드 (휴대폰 가로): ◀ · 점프 · ▶ 가 한 줄로 (왼쪽 · 가운데 · 오른쪽), 구석에서 안쪽
    const { page, errors } = await open('sandboard', '', PHONE, '&touch');
    await sleep(600);
    const b = Object.fromEntries((await page.evaluate(() => __game.controls)).buttons.map((v) => [v.id, v]));
    check(
      b.left && b.jump && b.right && b.left.x < b.jump.x && b.jump.x < b.right.x && Math.abs(b.left.y - b.jump.y) < 1 && Math.abs(b.right.y - b.jump.y) < 1 && Math.abs(b.jump.x - PHONE.width / 2) < 2,
      `샌드보드 버튼 ◀ · 점프 · ▶ 순서로 한 줄 (${['left', 'jump', 'right'].map((k) => b[k]?.x | 0).join(' · ')})`,
    );
    check(b.left.x - b.left.r >= 40 && PHONE.width - (b.right.x + b.right.r) >= 40, '샌드보드 ◀ ▶ 도 구석에서 안쪽으로');
    const pressedRight = page.waitForFunction(() => __game.sandboard.vx > 0.05 || __game.sandboard.x > 0.05, { polling: 'raf', timeout: 2500 }).then(() => true, () => false);
    const fr = await page.touchscreen.touchStart(b.right.x, b.right.y);
    check(await pressedRight, '▶ 를 누르면 오른쪽으로');
    await fr.end();
    await page.screenshot({ path: fsPath(new URL('touch-sandboard.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    // 세로 휴대폰 던전: 방이 너무 작아지지 않게 확대하고(고양이 키 약 70px), 고양이를 따라 방이 움직여 고양이가 화면 밖으로 안 나간다
    const PORTRAIT = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
    const { page, errors } = await open('dungeon', '', PORTRAIT, '&touch');
    await autoPick(page);
    await page.evaluate(() => setInterval(() => (__game.dungeon.P.invT = 1), 50));
    const v0 = await page.evaluate(() => __game.dungeonCat);
    const far = await page.evaluate(() => {
      const d = __game.dungeon;
      const g = d.room.grid;
      let best = null;
      for (let z = 0; z < g.h; z++) for (let x = 0; x < g.w; x++) if (!g.solid[z * g.w + x]) {
        const p = d.room.toScreen((x + 0.5) * 2, (z + 0.5) * 2);
        if (!best || p.sx > best.sx) best = { sx: p.sx, x: (x + 0.5) * 2, z: (z + 0.5) * 2 };
      }
      Object.assign(d.P, { x: best.x, z: best.z });
      return best;
    });
    await sleep(300);
    const v1 = await page.evaluate(() => __game.dungeonCat);
    check(v0.scale >= 0.36, `세로 휴대폰 던전: 방 1px = ${v0.scale.toFixed(2)} CSS px (고양이 약 ${(190 * v0.scale) | 0}px)`);
    check(v1.x > 0 && v1.x < PORTRAIT.width && far.sx > 0, `방 오른쪽 끝으로 가도 고양이가 화면 안에 (x ${v1.x | 0}px)`);
    await page.screenshot({ path: fsPath(new URL('touch-dungeon-portrait.png', OUT)) });
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
    for (const where of ['field', 'dungeon', 'fishing', 'maze', 'sandboard']) {
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
    // 몬스터를 한 대에 쓰러지게 하고 고양이 앞으로 데려오면 자동 냥펀치로 쓰러진다 (웨이브는 건너뛰고, 레벨 업 카드는 저절로 고른다 — 기술은 [웨이브 · 기술] 에서)
    await autoPick(page);
    await page.evaluate(() => {
      __game.skipWaves();
      __game.dungeon.enemies.forEach((e) => (e.hp = 1));
    });
    let lootShot = false;
    for (let i = 0; i < 60 && (await page.evaluate(() => __game.dungeon.phase)) === 'playing'; i++) {
      await page.evaluate(() => {
        const d = __game.dungeon;
        const e = d.enemies.find((v) => v.state !== 'pop');
        if (e) Object.assign(e, { x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9 });
      });
      await sleep(120);
      if (!lootShot && (await page.evaluate(() => __game.dungeon.loot.length > 1))) {
        lootShot = true;
        await page.screenshot({ path: fsPath(new URL('bag-drops.png', OUT)) });
      }
    }
    check(lootShot, '자동 냥펀치로 쓰러뜨리면 냥코인·아이템이 떨어진다');
    await sleep(1500);
    const cleared = await page.evaluate(() => ({ phase: __game.dungeon.phase, loot: __game.dungeon.loot.length, coins: __game.bag.coins }));
    check(cleared.phase === 'cleared' && cleared.loot === 0 && cleared.coins > 0, `방을 깨면 남은 게 날아와 가방에 (냥코인 ${cleared.coins})`);
    // 결과창 (이긴 판) → R 다시 도전 (이어지는 검사는 새 방에서)
    const won = await page.waitForFunction(() => __game.dungeon.result?.win, { timeout: 4000 }).then(() => true, () => false);
    check(won, '모든 웨이브를 깨면 결과창 (이긴 판)');
    await page.keyboard.press('KeyR');
    const again = await page.waitForFunction(() => !__game.dungeon.result && __game.dungeon.phase === 'playing', { timeout: 3000 }).then(() => true, () => false);
    check(again, 'R 로 다시 도전 — 방이 처음부터');
    await sleep(300);

    const ids = ['equipment_12', 'curios_01', 'curios_14'];
    await page.evaluate((ids) => {
      const d = __game.dungeon;
      for (const id of ids) d.loot.push({ id, n: 1, x: d.P.x + 0.6, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 });
    }, ids);
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL('bag-toasts.png', OUT)) });
    const got = await page.evaluate((ids) => ids.map((id) => __game.bag.slots.some((s) => s?.id === id)), ids);
    check(got.every(Boolean), '다가가면 아이템을 줍는다 (주운 것 알림)');
    // 가방이 가득 차면 장비(모자)는 빨려 오지 않고 그 자리에 — "가방 가득" 꼬리표, 밟으면 알림, 자리가 나면 줍는다 (화면 dungeon-bag-full.png)
    const savedSlots = await page.evaluate(() => JSON.stringify(__game.bag.slots));
    await page.evaluate(() => {
      const d = __game.dungeon;
      d.enemies.forEach((e) => Object.assign(e, { x: d.P.x - 6, z: d.P.z - 6, def: { ...e.def, speed: 0 } })); // 방해하지 않게 멀리
      for (let i = 0; i < d.bag.slots.length; i++) if (!d.bag.slots[i]) d.bag.slots[i] = { id: 'equipment_02', n: 1 };
      d.loot.push({ id: 'equipment_18', n: 1, x: d.P.x + 1.6, z: d.P.z, h: 0, vh: 0, vx: 0, vz: 0, t: 1 });
      window.__hat0 = [d.P.x + 1.6, d.P.z];
    });
    await sleep(1200);
    const hat = await page.evaluate(() => {
      const l = __game.dungeon.loot.find((v) => v.id === 'equipment_18');
      return l ? { moved: Math.hypot(l.x - window.__hat0[0], l.z - window.__hat0[1]), full: !!l.full } : null;
    });
    check(!!hat && hat.full && hat.moved < 0.05, `가방이 가득 차면 모자는 빨려 오지 않고 그 자리에 ("가방 가득" 표시, 움직인 거리 ${hat ? hat.moved.toFixed(2) : '없음'}m)`);
    await page.screenshot({ path: fsPath(new URL('dungeon-bag-full.png', OUT)) });
    await page.evaluate(() => Object.assign(__game.dungeon.P, { x: window.__hat0[0], z: window.__hat0[1] })); // 모자를 밟는다
    await sleep(800);
    const onHat = await page.evaluate(() => ({ n: __game.dungeon.loot.filter((v) => v.id === 'equipment_18').length, toast: __game.dungeon.toasts.some((q) => q.id === 'full') }));
    check(onHat.n === 1 && onHat.toast, '밟아도 미끄러져 나가지 않고 "가방이 가득" 알림');
    await page.evaluate((saved) => __game.bag.slots.splice(0, __game.bag.slots.length, ...JSON.parse(saved)), savedSlots);
    await sleep(800);
    check(await page.evaluate(() => __game.bag.slots.some((v) => v?.id === 'equipment_18')), '가방에 자리가 나면 빨려 와 줍는다');

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

    // 장비 공격력 +8 이 냥펀치에: 냥펀치 피해 + 8
    await page.keyboard.press('KeyR');
    await sleep(300);
    await autoPick(page);
    await page.evaluate(() => {
      const d = __game.dungeon;
      d.enemies = d.enemies.slice(0, 1);
      Object.assign(d.enemies[0], { x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9, hp: 99 });
    });
    await sleep(250);
    const dmg = await page.evaluate(() => __game.dungeon.pops.map((q) => q.text));
    check(dmg.includes(String(PLAYER_DATA.punch.damage + 8)), `장비 공격력이 냥펀치에 (${PLAYER_DATA.punch.damage} + 8 — 피해 ${dmg.join(',')})`);

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
    await click((await scr()).cells[SHOP_DATA.stock.indexOf('curios_01')]); // 작은 회복 물약 30냥
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
    await autoPick(page);
    await page.evaluate(() => {
      const d = __game.dungeon;
      const e = d.enemies.find((v) => v.kind === 'sword');
      Object.assign(e, { hp: 1, x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9 });
    });
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

  // 3-9) 미개방 구역 · 미니게임 (실제 키·마우스):
  //  개방 구역 가장자리에서 밖으로 밀어도 못 넘어간다 · 잠긴 포탈은 눌러도 워프하지 않는다 (화면 field-locked.png) →
  //  피라미드 포탈 → 미로: 길을 BFS 로 풀어 모퉁이마다 WASD 로 걸어 출구까지, 보너스 냥코인·기록, 돌아가기 →
  //  모래 미끄럼틀 포탈 → 샌드보드: 빈 레인으로 A/D, 바위 앞에서 Space, 완주·점수·기록, 다시 타기, Esc
  console.log('\n[미개방 구역 · 미니게임]');
  {
    const { page, errors } = await open('field');
    // 시작점 줄에서 열린 조각 왼쪽이 닫힌 곳
    const y = FIELD.start[1];
    const r = Math.floor((y * FIELD.grid[1]) / FIELD.size[1]);
    const c = [...FIELD.open[r]].findIndex((ch, c) => ch === 'o' && c > 0 && FIELD.open[r][c - 1] !== 'o');
    const x0 = Math.floor((c * FIELD.size[0]) / FIELD.grid[0]);
    // 가장자리 안쪽에서 걸을 수 있는 자리를 찾아 선다
    const sx = await page.evaluate(
      ([x0, y]) => {
        for (let x = x0 + 24; x < x0 + 300; x += 4) if (__game.terrain(x, y) === 0) return x;
        return -1;
      },
      [x0, y],
    );
    check(sx > 0, `개방 구역 왼쪽 가장자리 안쪽에 설 자리 (${sx}, ${y})`);
    await page.evaluate(([x, y]) => Object.assign(__game.field, { x, y, camX: x, camY: y, armed: true, mode: 'walk' }), [sx, y]);
    await page.keyboard.down('KeyA');
    await sleep(1500);
    await page.keyboard.up('KeyA');
    const fx = await page.evaluate(() => __game.field.x);
    check(fx >= x0 - 1 && fx <= sx, `왼쪽(미개방)으로 1.5초 밀어도 가장자리에서 멈춘다 (x ${fx | 0}, 경계 ${x0})`);
    await page.screenshot({ path: fsPath(new URL('field-locked.png', OUT)) });
    const locked = FIELD.warps.find((w) => w.id === 'autumn_fishing_pond');
    check(locked.to && !inOpen(locked.at[0], locked.at[1]), '가을 낚시 연못(가을 낚시터)은 잠긴 구역');
    const click = async (p) => {
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.up();
    };
    await click(await page.evaluate(() => __game.minimapPoint('autumn_fishing_pond')));
    await sleep(1200);
    const before = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await click(await page.evaluate(() => __game.portalScreen('autumn_fishing_pond')));
    await sleep(1500);
    const after = await page.evaluate(() => [__game.field.x, __game.field.y, __game.scene]);
    check(after[0] === before[0] && after[1] === before[1] && after[2] === 'field', '잠긴 포탈은 눌러도 워프하지 않는다');
    await page.screenshot({ path: fsPath(new URL('field-locked-look.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('field');
    const w = FIELD.warps.find((v) => v.to === 'maze');
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), w.at);
    const inMaze = await page.waitForFunction(() => __game.scene === 'maze', { timeout: 6000 }).then(() => true, () => false);
    check(inMaze, `${w.label} 포탈에 서 있으면 미로`);
    const coins0 = await page.evaluate(() => __game.bag.coins);
    const m = await page.evaluate(() => ({ w: __game.maze.w, h: __game.maze.h, seen: __game.maze.seen.reduce((a, b) => a + b, 0) }));
    check(m.seen < m.w * m.h * 0.12, `처음엔 횃불 둘레만 보인다 (${m.seen}/${m.w * m.h}칸)`);
    const steps = await solveMaze(page, 'maze-fog.png');
    const end = await page.evaluate(() => ({ phase: __game.maze.phase, got: __game.maze.got, bonus: __game.maze.bonus, t: __game.maze.t, coins: __game.bag.coins, best: __game.records.maze }));
    check(end.phase === 'done', `길을 따라 걸으면 출구에서 탈출 (${steps}걸음, ${end.t.toFixed(1)}초)`);
    check(end.coins === coins0 + end.got + end.bonus && end.bonus >= 5, `냥코인: 주운 ${end.got} + 탈출 보너스 ${end.bonus}`);
    check(end.best !== null && end.best <= end.t + 0.1, `최고 기록 저장 (${end.best}초)`);
    await sleep(400);
    await page.screenshot({ path: fsPath(new URL('maze-done.png', OUT)) });
    await click2(page, (await page.evaluate(() => __game.miniScreen())).back);
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    const pos = await page.evaluate(() => [__game.field.x, __game.field.y]);
    check(out && Math.hypot(pos[0] - w.back[0], pos[1] - w.back[1]) < 5, '돌아가기 → 피라미드 포탈 앞');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  // 고래 — 앞바다: 고양이 항구 앞바다에서도 그림자가 나오고, 낚시 물고기처럼 물 위에서만 배 둘레를 헤엄쳐 다닌다 (화면 whale-harbor.png)
  {
    const { page, errors } = await open('field');
    const HARBOR = [3250, 1720];
    await page.evaluate(([x, y]) => Object.assign(__game.field, { x, y, camX: x, camY: y, mode: 'boat', armed: true }), HARBOR);
    const lurk = await page.waitForFunction(() => __game.field.whale.phase === 'lurk', { timeout: 6000 }).then(() => true, () => false);
    check(lurk, '고양이 항구 앞바다에서도 고래 그림자가 나온다');
    await page.evaluate(() => (__game.field.whale.hold = 99));
    await sleep(1200);
    const track = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 40; i++) {
        const w = __game.field.whale;
        out.push([w.sx, w.sy, __game.terrain(w.sx, w.sy)]);
        await new Promise((r) => setTimeout(r, 100));
      }
      return out;
    });
    const path = track.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - track[i][0], p[1] - track[i][1]), 0);
    check(track.every((p) => p[2] === 2) && path > 30, `그림자는 물 위에서 배 둘레를 헤엄쳐 다닌다 (4초에 ${path.toFixed(0)}px)`);
    await page.screenshot({ path: fsPath(new URL('whale-harbor.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  // 고래 (실제 키): 바다 한가운데 배를 세워 두면 3초 뒤 그림자가 맴돌고, 움직이면 흐려져 사라진다 → 다시 세워 두면 3~8초 뒤 솟구쳐 삼킨다
  // (솟구치는 동안 키를 눌러도 안 움직인다) → 고래 배 속 미로를 BFS 로 풀어 숨구멍으로 탈출 · 기록 · R 로 다시 안 됨 →
  // 가운데 '바다로' 버튼 → 삼켰던 자리에서 배째 뱉어 낸다 → 나온 뒤 10초 동안은 가만히 있어도 안 나온다 (화면 whale-*.png)
  {
    const { page, errors } = await open('field');
    const SEA = [3700, 1600];
    const phase = () => page.evaluate(() => __game.field.whale.phase);
    const until = (fn, ms) => page.waitForFunction(fn, { polling: 'raf', timeout: ms }).then(() => true, () => false);
    await page.evaluate(([x, y]) => Object.assign(__game.field, { x, y, camX: x, camY: y, mode: 'boat', armed: true }), SEA);
    const t0 = Date.now();
    const lurk = await until(() => __game.field.whale.phase === 'lurk', 6000);
    check(lurk && Date.now() - t0 > 2500, `바다에 배를 3초 세워 두면 고래 그림자가 맴돈다 (${((Date.now() - t0) / 1000).toFixed(1)}초)`);
    await sleep(1300);
    await page.screenshot({ path: fsPath(new URL('whale-shadow.png', OUT)) });
    await page.keyboard.down('KeyW');
    await sleep(300);
    const leaving = await phase();
    await sleep(1700);
    await page.keyboard.up('KeyW');
    check(leaving === 'leave' && (await phase()) === 'none', `배가 움직이면 그림자가 흐려져 사라진다 (${leaving} → ${await phase()})`);
    // 다시 세워 두면 그림자 → 3~8초 맴돌고 솟구친다
    await page.evaluate(([x, y]) => Object.assign(__game.field, { x, y }), SEA); // 처음 자리(넓은 바다)로
    check(await until(() => __game.field.whale.phase === 'lurk', 6000), '다시 세워 두면 그림자가 돌아온다');
    const hold = await page.evaluate(() => __game.field.whale.hold);
    const rose = await until(() => __game.field.whale.phase === 'rise', 10000);
    check(rose && hold >= 3 && hold <= 8, `그림자가 ${hold.toFixed(1)}초(3~8초 무작위) 맴돌다 솟구친다`);
    const pos0 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await page.keyboard.down('KeyA');
    await until(() => __game.field.whale.phase !== 'rise' || __game.field.whale.t >= 2.35, 5000);
    await page.screenshot({ path: fsPath(new URL('whale-gulp.png', OUT)) });
    const pos1 = await page.evaluate(() => [__game.field.x, __game.field.y]);
    await page.keyboard.up('KeyA');
    check(pos1[0] === pos0[0] && pos1[1] === pos0[1], '솟구쳐 삼키는 동안은 키를 눌러도 안 움직인다');
    const inBelly = await until(() => __game.scene === 'maze' && __game.maze.theme === 'whale', 8000);
    check(inBelly, '삼켜지면 고래 배 속 미로');
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL('whale-maze.png', OUT)) });
    const coins0 = await page.evaluate(() => __game.bag.coins);
    const steps = await solveMaze(page, 'whale-maze-fog.png');
    const end = await page.evaluate(() => ({ phase: __game.maze.phase, got: __game.maze.got, bonus: __game.maze.bonus, t: __game.maze.t, coins: __game.bag.coins, best: __game.records.whale, w: __game.maze.w }));
    check(end.phase === 'done' && end.w === 19, `숨구멍까지 걸어 탈출 (${steps}걸음, ${end.t.toFixed(1)}초)`);
    check(end.coins === coins0 + end.got + end.bonus && end.best !== null && end.best <= end.t + 0.1, `냥코인 ${end.got} + 보너스 ${end.bonus} · 고래 기록 ${end.best}초`);
    await page.keyboard.press('KeyR');
    await sleep(600);
    check((await page.evaluate(() => __game.maze.phase)) === 'done', '고래 배 속은 R 로 다시 할 수 없다');
    await page.screenshot({ path: fsPath(new URL('whale-done.png', OUT)) });
    await click2(page, (await page.evaluate(() => __game.miniScreen())).solo);
    const out = await until(() => __game.scene === 'field' && __game.field.whale.phase === 'spit', 4000);
    const back = await page.evaluate(() => ({ x: __game.field.x, y: __game.field.y, mode: __game.field.mode }));
    check(out && back.x === SEA[0] && back.y === SEA[1] && back.mode === 'boat', `'바다로' → 삼켰던 자리에서 배째 뱉어 낸다 (${back.x | 0}, ${back.y | 0})`);
    await until(() => __game.field.whale.phase !== 'spit' || __game.field.whale.t >= 1.4, 4000);
    await page.screenshot({ path: fsPath(new URL('whale-spit.png', OUT)) });
    await until(() => __game.field.whale.phase === 'none', 5000);
    const cool = await page.evaluate(() => __game.field.whale.cool);
    await sleep(7000);
    check(cool > 9 && (await phase()) === 'none', `나온 뒤 10초 동안은 가만히 있어도 안 나온다 (${cool.toFixed(1)}초 · 7초 뒤 ${await phase()})`);
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('field');
    const w = FIELD.warps.find((v) => v.to === 'sandboard');
    // 들어간 직후 멈칫(처음 렉) 재기: 프레임마다 게임 콜백 시간 · 프레임 간격 (2026-10-07 — 첫 프레임 318ms + 0.3초 멈춤이었다:
    // 굵은 한글 · 이모지 글꼴을 처음 쓰고, 큰 그림을 처음 그리며 풀고 올리고, 바닥 무늬 · 보드 자리를 그 자리에서 만들었다)
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__enter = [];
      let last = 0;
      window.requestAnimationFrame = (cb) =>
        raf((ts) => {
          const t0 = performance.now();
          cb(ts);
          if (window.__game.scene === 'sandboard') window.__enter.push([performance.now() - t0, last ? ts - last : 0]);
          last = ts;
        });
    });
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), w.at);
    const inSand = await page.waitForFunction(() => __game.scene === 'sandboard', { timeout: 10000 }).then(() => true, () => false);
    check(inSand, `${w.label} 포탈에 서 있으면 샌드보드`);
    // 브라우저 자동 조종은 키 반응이 늦어(15ms 마다 보고 누름) 촘촘한 장애물에 가끔 부딪힌다 — 하트를 넉넉히 줘서 끝까지 가는 흐름만 본다
    // (늘 빠져나갈 길이 있는지는 sandboard.check 의 자동 조종이 40판으로 본다)
    await page.evaluate(() => (__game.sandboard.hearts = 6));
    const coins0 = await page.evaluate(() => __game.bag.coins);
    // 그리기 감시: 이동(translate)이 NaN·무한이면 캔버스가 무시해서 그림이 왼쪽 위(0,0)에 그려진다 — 원근 뒤쪽 물건 버그
    await page.evaluate(() => {
      window.__badDraw = [];
      const T = CanvasRenderingContext2D.prototype.translate;
      CanvasRenderingContext2D.prototype.translate = function (x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) window.__badDraw.push(Math.round(__game.sandboard.d));
        return T.call(this, x, y);
      };
      const D = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...a) {
        if (a.length === 9 && !a.slice(5).every(Number.isFinite)) window.__badDraw.push(Math.round(__game.sandboard.d));
        return D.apply(this, a);
      };
    });
    // 자동 조종: 빈 레인으로 A/D, 6m 안의 낮은 장애물은 Space 로 점프 (높은 것·구덩이는 피하기만). 길이 지그재그라 레인은 그 거리의 길 가운데 기준
    const roles = Object.fromEntries(Object.entries(SAND_OBS).map(([k, o]) => [k, [o.role, o.r]]));
    let held = null;
    let shot = false;
    let xLo = 0;
    let xHi = 0;
    let off = 0;
    const t0 = Date.now();
    await page.evaluate(() => {
      window.__scrapes = 0;
      const s = __game.sandboard;
      // 울타리에 쓸린 횟수 (사건은 프레임마다 지워지니 그리기 때마다 센다)
      const loop = () => {
        window.__scrapes += __game.sandboard.events.filter((e) => e.type === 'scrape').length;
        if (__game.sandboard === s && s.phase === 'play') requestAnimationFrame(loop);
      };
      loop();
    });
    while (Date.now() - t0 < 120000) {
      const s = await page.evaluate((roles) => {
        const s = __game.sandboard;
        const bad = (o) => ['hit', 'tall', 'pit'].includes(roles[o.kind][0]) && !o.hit;
        const sx = __game.sandScreen(s.x, s.d).x / innerWidth;
        return { phase: s.phase, x: s.x, vx: s.vx, yaw: s.yaw, yawV: s.yawV, d: s.d, v: s.v, t: s.t, air: s.air, sx, course: s.course, obs: s.obs.filter((o) => bad(o) && o.d > s.d && o.d < s.d + 22).map((o) => [o.x, o.d, roles[o.kind][1], roles[o.kind][0]]) };
      }, roles);
      if (s.phase !== 'play') break;
      xLo = Math.min(xLo, s.x);
      xHi = Math.max(xHi, s.x);
      if (s.sx < 0.15 || s.sx > 0.85) off++;
      const C = (d) => sandCenter(s.course, d);
      const w = sandWidth(s.course, s.d + 10).w;
      const lanes = [-0.8, -0.4, 0, 0.4, 0.8].map((l) => l * w);
      const lane = lanes.map((l) => ({ l, bad: s.obs.filter(([x, d, r]) => Math.abs(x - C(d) - l) < r + 0.2).length + Math.abs(l - (s.x - C(s.d))) * 0.01 })).sort((a, b) => a.bad - b.bad)[0].l;
      // 지금 떼면 0.4초 뒤 자리 (드리프트로 더 미끄러지는 만큼, 굽이면 길이 옆으로 가는 만큼) — 그때의 길 가운데 기준
      const pred = sandCoast(s, 0.4) - C(s.d + s.v * 0.4);
      const want = Math.abs(lane - pred) < 0.04 ? null : lane > pred ? 'KeyD' : 'KeyA';
      if (want !== held) {
        if (held) await page.keyboard.up(held);
        if (want) await page.keyboard.down(want);
        held = want;
      }
      if (s.air <= 0 && s.obs.some(([x, d, r, role]) => role === 'hit' && d - s.d < 6 && Math.abs(x - s.x) < r + 0.11)) await page.keyboard.press('Space');
      if (!shot && s.t > 5) {
        shot = true;
        await page.screenshot({ path: fsPath(new URL('sandboard-run.png', OUT)) });
      }
      await sleep(15); // 촘촘히 — 꺾이는 길에서 키를 늦게 떼면 부딪힌다
    }
    if (held) await page.keyboard.up(held);
    const enter = await page.evaluate(() => window.__enter.slice(0, 100)); // 들어간 뒤 처음 100프레임 (약 1.7초)
    const worstCb = Math.max(...enter.map(([c]) => c));
    const worstGap = Math.max(...enter.slice(1).map(([, g]) => g));
    check(worstCb < 40 && worstGap < 150, `들어간 직후 멈칫하지 않는다 (처음 ${enter.length}프레임 중 가장 긴 콜백 ${worstCb.toFixed(1)}ms · 간격 ${worstGap.toFixed(0)}ms)`);
    const end = await page.evaluate(() => ({ fell: __game.sandboard.fell, hearts: __game.sandboard.hearts, phase: __game.sandboard.phase, coins: __game.sandboard.coins, crashes: __game.sandboard.crashes, score: __game.sandboard.score, t: __game.sandboard.t, bag: __game.bag.coins, best: __game.records.sandboard }));
    const scrapes = await page.evaluate(() => window.__scrapes);
    check(end.phase === 'done' && !end.fell, `피하고 점프하며 끝까지 가면 완주 (${end.t.toFixed(1)}초 · 냥코인 ${end.coins} · 부딪힘 ${end.crashes} · 하트 ${end.hearts} · 울타리 쓸림 ${scrapes} · 점수 ${end.score})`);
    check(xHi - xLo > 0.6, `커브 구간에서 길을 따라 옆으로 오간다 (가로 자리 ${xLo.toFixed(1)} ~ ${xHi.toFixed(1)})`);
    check(off === 0, `카메라가 따라가 고양이는 늘 화면 가운데 70% 안 (벗어난 때 ${off}번)`);
    check(end.coins > 0 && end.bag === coins0 + end.coins, '주운 냥코인이 가방에');
    const bad = await page.evaluate(() => window.__badDraw);
    check(bad.length === 0, `끝까지 달리는 동안 NaN 좌표로 그린 것 ${bad.length}번 (뒤쪽 장식이 왼쪽 위에 모이던 버그)${bad.length ? ' — 처음 ' + bad[0] + 'm' : ''}`);
    check(end.best !== null && end.best >= end.score, `최고 점수 저장 (${end.best})`);
    // 결승 뒤: 그 속도로 미끄러지다 서고, 카드는 cardDelay 초 뒤에 뜬다 (넘는 순간 딱 멈추고 카드가 바로 덮던 것)
    await page.waitForFunction(() => __game.sandboard.doneT > 1.3, { timeout: 5000 }).catch(() => {});
    const glide = await page.evaluate((L) => __game.sandboard.d - L, SAND_CFG.length);
    check(glide > 10, `결승을 넘으면 미끄러지다 선다 (${glide.toFixed(1)}m)`);
    await page.screenshot({ path: fsPath(new URL('sandboard-done.png', OUT)) });
    await click2(page, (await page.evaluate(() => __game.miniScreen())).again);
    const again = await page.waitForFunction(() => __game.sandboard.phase === 'play' && __game.sandboard.d < 30, { timeout: 4000 }).then(() => true, () => false);
    check(again, '다시 타기');
    await sleep(700); // 화면 전환(페이드)이 끝난 뒤에 — 전환 중 키는 무시된다
    await page.keyboard.press('Escape');
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    const pos = await page.evaluate(() => [__game.field.x, __game.field.y]);
    check(out && Math.hypot(pos[0] - w.back[0], pos[1] - w.back[1]) < 5, 'Esc → 모래 미끄럼틀 포탈 앞');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-10) 숲 (실제 키·마우스·터치, 2026-10-07 · 10-08): 숲 미니게임장 두 곳은 열린 구역 숲 속 임의 워프 (강아지마을 위 · 해바라기밭 아래).
  //  장작 패기 공터 → 장작 패기: 가지가 없는 쪽 A/D 로 40토막 → 일부러 한쪽만 패다 가지에 콩 → 카드(냥코인 · 통나무 · 기록) → 다시 패기 → Esc → 포탈 앞.
  //  다람쥐 잡기 숲 → 다람쥐 잡기: 키로 쫓아가 잡기 → 시간 끝 → 카드(냥코인 · 도토리 · 기록) → 다시 잡기 → Esc → 포탈 앞.
  //  숲에서 부스럭 수풀로 걸어 들어가면 도끼질에 열려 가방에 · 수풀에서 튀어나온 다람쥐를 키로 쫓아가 잡는다.
  //  휴대폰: 장작 패기 ◀ ▶ 버튼 · 화면 반쪽, 다람쥐 잡기 조이스틱. 화면 timber-*.png · chase-*.png · forest-*.png · touch-timber.png · touch-chase.png
  console.log('\n[숲 · 장작 패기]');
  {
    const { page, errors } = await open('field');
    await page.evaluate(() => __game.bag.slots.fill(null)); // 앞 검사가 가방을 채워 뒀을 수 있다
    const w = FIELD.warps.find((v) => v.to === 'timber');
    check(inOpen(w.at[0], w.at[1]), `${w.label} 포탈이 열린 구역에`);
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), w.at);
    const inTimber = await page.waitForFunction(() => __game.scene === 'timber', { timeout: 6000 }).then(() => true, () => false);
    check(inTimber, `${w.label} 포탈에 서 있으면 장작 패기`);
    await sleep(700);
    await page.screenshot({ path: fsPath(new URL('timber-ready.png', OUT)) });
    const logsOf = () => page.evaluate(() => __game.bag.slots.reduce((t, v) => t + (v?.id === 'materials_01' ? v.n : 0), 0));
    const coins0 = await page.evaluate(() => __game.bag.coins);
    const logs0 = await logsOf();
    // 가지가 없는 쪽(지금 토막 · 다음 토막)으로 키를 누른다
    for (let i = 0; i < 40; i++) {
      const side = await page.evaluate(() => {
        const t = __game.timber;
        const ok = (v) => t.segs[0] !== v && t.segs[1] !== v;
        return ok(t.side) ? t.side : -t.side;
      });
      await page.keyboard.press(side < 0 ? 'KeyA' : 'KeyD');
      await sleep(110);
      if (i === 25) await page.screenshot({ path: fsPath(new URL('timber-play.png', OUT)) });
    }
    const mid = await page.evaluate(() => ({ score: __game.timber.score, phase: __game.timber.phase, time: __game.timber.time }));
    check(mid.score === 40 && mid.phase === 'play', `가지를 피해 A/D 로 40토막 (${mid.score}토막 · 남은 시간 ${mid.time.toFixed(1)}초)`);
    for (let i = 0; i < 80 && (await page.evaluate(() => __game.timber.phase)) !== 'done'; i++) {
      await page.keyboard.press('KeyD');
      await sleep(110);
    }
    const end = await page.evaluate(() => ({ phase: __game.timber.phase, why: __game.timber.why, score: __game.timber.score, coins: __game.timber.coins, logs: __game.timber.logs, bag: __game.bag.coins, best: __game.records.timber }));
    check(end.phase === 'done' && end.why === 'hit', `한쪽만 패다 가지에 콩 (${end.score}토막)`);
    await sleep(250);
    await page.screenshot({ path: fsPath(new URL('timber-hit.png', OUT)) });
    await page.waitForFunction(() => __game.timber.doneT > 1, { timeout: 4000 }).catch(() => {});
    await page.screenshot({ path: fsPath(new URL('timber-done.png', OUT)) });
    const logs1 = await logsOf();
    check(end.bag === coins0 + end.coins && logs1 === logs0 + end.logs && end.logs === Math.min(6, Math.floor(end.score / 15)), `냥코인 ${end.coins} · 통나무 ${end.logs} 가 가방에`);
    check(end.best !== null && end.best >= end.score, `최고 기록 저장 (${end.best}토막)`);
    await click2(page, (await page.evaluate(() => __game.miniScreen())).again);
    const again = await page.waitForFunction(() => __game.timber.phase === 'ready' && __game.timber.score === 0, { timeout: 4000 }).then(() => true, () => false);
    check(again, '다시 패기');
    await sleep(700);
    await page.keyboard.press('Escape');
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    const pos = await page.evaluate(() => [__game.field.x, __game.field.y]);
    check(out && Math.hypot(pos[0] - w.back[0], pos[1] - w.back[1]) < 5, `Esc → ${w.label} 포탈 앞`);
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('field');
    await page.evaluate(() => __game.bag.slots.fill(null));
    const C = FIELD.catBody;
    // 강아지마을 북쪽 숲 한가운데 (둘레도 숲)
    const spot = await page.evaluate(() => {
      for (let y = 1790; y < 1950; y += 6)
        for (let x = 2280; x < 2900; x += 6)
          if ([[0, 0], [40, 0], [-40, 0], [80, 0], [0, 25], [0, -25], [40, 25]].every(([dx, dy]) => __game.terrain(x + dx, y + dy) === 1)) return [x, y];
      return null;
    });
    check(!!spot, `강아지마을 북쪽에 숲이 있다 (${spot})`);
    await page.waitForFunction(() => !!__game.sheets.acorn_squirrel, { timeout: 8000 }).catch(() => {});
    // 1) 부스럭 수풀 — 고양이 오른쪽 2.5칸. 걸어 들어가면 도끼질에 열려 무언가 나와 가방에 (다람쥐는 쿨다운으로 막아 둔다)
    const R = [spot[0] + C * 2.5, spot[1]];
    await page.evaluate(([x, y, rx, ry]) => {
      Object.assign(__game.field, { x, y, camX: x, camY: y, armed: true, mode: 'axe' });
      __game.field.woods.cool = 99;
      __game.rustle(rx, ry);
    }, [...spot, ...R]);
    await sleep(900);
    await page.screenshot({ path: fsPath(new URL('forest-rustle.png', OUT)) });
    const found0 = await page.evaluate(() => Object.values(__game.bag.found).reduce((a, b) => a + b, 0));
    await page.keyboard.down('KeyD');
    const opened = await page
      .waitForFunction(([rx, ry]) => !__game.field.rustles.some((r) => Math.abs(r.x - rx) < 1 && Math.abs(r.y - ry) < 1), { timeout: 6000 }, R)
      .then(() => true, () => false);
    await page.keyboard.up('KeyD');
    await sleep(250);
    await page.screenshot({ path: fsPath(new URL('forest-find.png', OUT)) });
    const found1 = await page.evaluate(() => Object.values(__game.bag.found).reduce((a, b) => a + b, 0));
    check(opened && found1 > found0, `부스럭 수풀로 걸어 들어가면 도끼질에 열려 가방에 (얻은 수 ${found0} → ${found1})`);
    // 2) 다람쥐 — 바로 앞 수풀에서 튀어나온다. 키(8방향)로 쫓아가 잡으면 도토리 · 냥코인 (놓치면 다시, 세 번까지)
    const acornsOf = () => page.evaluate(() => __game.bag.slots.reduce((t, v) => t + (v?.id === 'materials_05' ? v.n : 0), 0));
    let caught = false;
    let tries = 0;
    let land = true;
    let ran = false;
    for (; tries < 3 && !caught; tries++) {
      const a0 = await acornsOf();
      const c0 = await page.evaluate(() => __game.bag.coins);
      await page.evaluate(([x, y]) => {
        Object.assign(__game.field, { x, y, camX: x, camY: y, armed: true, mode: 'axe' });
        __game.field.woods.cool = 0;
        __game.field.squirrel.phase = 'none';
        __game.squirrel(x + 17, y);
      }, spot);
      if (tries === 0) {
        await sleep(200);
        await page.screenshot({ path: fsPath(new URL('forest-squirrel.png', OUT)) });
      }
      let held = [];
      const t0 = Date.now();
      let shot = tries > 0;
      while (Date.now() - t0 < 12000) {
        const st = await page.evaluate(() => {
          const f = __game.field;
          const q = f.squirrel;
          return { x: f.x, y: f.y, qx: q.x, qy: q.y, phase: q.phase, t: __game.terrain(q.x, q.y), mode: f.mode, moving: f.moving };
        });
        if (st.phase === 'caught' || st.phase === 'gone' || st.phase === 'none') {
          caught = st.phase === 'caught';
          break;
        }
        if (st.t === 2 || st.t === 3) land = false;
        if (st.mode === 'axe' && st.moving && st.phase === 'run') ran = true;
        const dx = st.qx - st.x;
        const dy = (st.qy - st.y) / FIELD.vertical;
        const want = [...(dx > 4 ? ['KeyD'] : dx < -4 ? ['KeyA'] : []), ...(dy > 4 ? ['KeyS'] : dy < -4 ? ['KeyW'] : [])];
        for (const k of held) if (!want.includes(k)) await page.keyboard.up(k);
        for (const k of want) if (!held.includes(k)) await page.keyboard.down(k);
        held = want;
        if (!shot && Date.now() - t0 > 1200) {
          shot = true;
          await page.screenshot({ path: fsPath(new URL('forest-chase.png', OUT)) });
        }
        await sleep(25);
      }
      for (const k of held) await page.keyboard.up(k);
      if (caught) {
        await sleep(400);
        await page.screenshot({ path: fsPath(new URL('forest-caught.png', OUT)) });
        const a1 = await acornsOf();
        const c1 = await page.evaluate(() => __game.bag.coins);
        check(a1 >= a0 + 3 && c1 >= c0 + 10, `잡으면 도토리 ${a1 - a0}개 · 냥코인 ${c1 - c0}`);
      }
      await sleep(800);
    }
    check(caught, `튀어나온 다람쥐를 키로 쫓아가 잡는다 (${tries}번째)`);
    check(land, '다람쥐는 물 · 막힌 곳으로 안 간다');
    check(ran, '쫓는 동안 숲에서도 도끼질로 멈추지 않고 달린다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    const { page, errors } = await open('field');
    await page.evaluate(() => __game.bag.slots.fill(null));
    const w = FIELD.warps.find((v) => v.to === 'chase');
    check(inOpen(w.at[0], w.at[1]), `${w.label} 포탈이 열린 구역에`);
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'axe' }), w.at);
    const inChase = await page.waitForFunction(() => __game.scene === 'chase', { timeout: 8000 }).then(() => true, () => false);
    check(inChase, `${w.label} 포탈에 서 있으면 다람쥐 잡기`);
    await sleep(700);
    await page.screenshot({ path: fsPath(new URL('chase-ready.png', OUT)) });
    check((await page.evaluate(() => __game.chase.phase)) === 'ready', '움직이기 전엔 시간이 안 간다');
    const coins0 = await page.evaluate(() => __game.bag.coins);
    // 가장 가까운 다람쥐 쪽으로 WASD (25ms 마다)
    let held = [];
    let shot = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 16000) {
      const st = await page.evaluate(() => {
        const c = __game.chase;
        return { x: c.cat.x, y: c.cat.y, caught: c.caught, live: c.runners.filter((r) => ['throw', 'run', 'rest'].includes(r.q.phase)).map((r) => [r.q.x, r.q.y]) };
      });
      if (st.caught >= 2 && Date.now() - t0 > 8000) break;
      let want = held.length ? held : ['KeyD'];
      if (st.live.length) {
        const [tx, ty] = st.live.sort((a, b) => Math.hypot(a[0] - st.x, a[1] - st.y) - Math.hypot(b[0] - st.x, b[1] - st.y))[0];
        const dx = tx - st.x;
        const dy = (ty - st.y) / FIELD.vertical;
        want = [...(dx > 3 ? ['KeyD'] : dx < -3 ? ['KeyA'] : []), ...(dy > 3 ? ['KeyS'] : dy < -3 ? ['KeyW'] : [])];
      }
      for (const k of held) if (!want.includes(k)) await page.keyboard.up(k);
      for (const k of want) if (!held.includes(k)) await page.keyboard.down(k);
      held = want;
      if (!shot && st.live.length && Date.now() - t0 > 3000) {
        shot = true;
        await page.screenshot({ path: fsPath(new URL('chase-play.png', OUT)) });
      }
      await sleep(25);
    }
    for (const k of held) await page.keyboard.up(k);
    const mid = await page.evaluate(() => ({ caught: __game.chase.caught, points: __game.chase.points, t: __game.chase.t }));
    check(mid.caught >= 1, `키로 쫓아가 다람쥐를 잡는다 (${mid.t.toFixed(1)}초에 ${mid.caught}마리 · ${mid.points}점)`);
    await page.evaluate(() => (__game.chase.t = 59.6)); // 시간 끝으로
    const done = await page.waitForFunction(() => __game.chase.phase === 'done' && __game.chase.doneT > 0.9, { timeout: 4000 }).then(() => true, () => false);
    const end = await page.evaluate(() => ({ points: __game.chase.points, caught: __game.chase.caught, coins: __game.chase.coins, acorns: __game.chase.acorns, bag: __game.bag.coins, best: __game.records.chase, acornBag: __game.bag.slots.reduce((t, v) => t + (v?.id === 'materials_05' ? v.n : 0), 0) }));
    await page.screenshot({ path: fsPath(new URL('chase-done.png', OUT)) });
    check(done && end.coins === end.points * 2 && end.bag === coins0 + end.coins && end.acornBag === end.acorns && end.acorns === Math.min(20, end.caught), `시간 끝 → 냥코인 ${end.coins} · 도토리 ${end.acorns} 가 가방에`);
    check(end.best !== null && end.best >= end.points, `최고 기록 저장 (${end.best}점)`);
    await click2(page, (await page.evaluate(() => __game.miniScreen())).again);
    const again = await page.waitForFunction(() => __game.chase.phase === 'ready' && __game.chase.points === 0, { timeout: 4000 }).then(() => true, () => false);
    check(again, '다시 잡기');
    await sleep(700);
    await page.keyboard.press('Escape');
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    const pos = await page.evaluate(() => [__game.field.x, __game.field.y]);
    check(out && Math.hypot(pos[0] - w.back[0], pos[1] - w.back[1]) < 5, `Esc → ${w.label} 포탈 앞`);
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL('forest-venues.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    // 휴대폰 가로 다람쥐 잡기: 떠다니는 조이스틱으로 움직이면 시작 · 공터를 고양이 따라 크게
    const PH = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
    const { page, errors } = await open('chase', '', PH, '&touch');
    await sleep(600);
    const c = await page.evaluate(() => __game.controls);
    check(!!c.stick, '다람쥐 잡기엔 조이스틱');
    const x0 = await page.evaluate(() => __game.chase.cat.x);
    const fr = await page.touchscreen.touchStart(c.stick.x, c.stick.y);
    await page.touchscreen.touchMove(c.stick.x + 50, c.stick.y);
    await sleep(600);
    const st = await page.evaluate(() => ({ phase: __game.chase.phase, x: __game.chase.cat.x }));
    await fr.end();
    check(st.phase === 'play' && st.x > x0 + 10, `조이스틱을 밀면 시작하고 그쪽으로 (${(st.x - x0).toFixed(0)}px)`);
    await page.screenshot({ path: fsPath(new URL('touch-chase.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    // 휴대폰 가로: ◀ ▶ 버튼 (구석에서 안쪽) · 누르면 그쪽에서 팬다 · 화면 반쪽을 눌러도
    const PH = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
    const { page, errors } = await open('timber', '', PH, '&touch');
    await sleep(600);
    const b = Object.fromEntries((await page.evaluate(() => __game.controls)).buttons.map((v) => [v.id, v]));
    check(b.left && b.right && b.left.x < PH.width / 2 && b.right.x > PH.width / 2 && b.left.x - b.left.r >= 40, `장작 패기 버튼 ◀ ▶ (${b.left?.x | 0} · ${b.right?.x | 0})`);
    const side0 = await page.evaluate(() => __game.timber.segs.slice(0, 2));
    // 가지가 없는 쪽 버튼을 누른다
    const pick = side0.includes(1) ? b.left : b.right;
    await page.touchscreen.tap(pick.x, pick.y);
    await sleep(200);
    const one = await page.evaluate(() => ({ score: __game.timber.score, side: __game.timber.side }));
    check(one.score === 1 && one.side === (pick === b.left ? -1 : 1), `${pick === b.left ? '◀' : '▶'} 를 누르면 그쪽에서 팬다`);
    const seg = await page.evaluate(() => __game.timber.segs.slice(0, 2));
    const half = seg.includes(-1) ? [PH.width * 0.7, PH.height * 0.5, 1] : [PH.width * 0.3, PH.height * 0.5, -1];
    await page.touchscreen.tap(half[0], half[1]);
    await sleep(200);
    const two = await page.evaluate(() => ({ score: __game.timber.score, side: __game.timber.side }));
    check(two.score === 2 && two.side === half[2], '화면 반쪽을 눌러도 그쪽에서 팬다');
    await page.screenshot({ path: fsPath(new URL('touch-timber.png', OUT)) });
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(400);
    await page.screenshot({ path: fsPath(new URL('screen-timber-portrait.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-11) 고양이마을 (2026-10-08, 실제 키·마우스·터치): 고양이마을 포탈 → 마을 (전투 없음, 처음엔 코코 할머니 인사) →
  //  요리 가판대를 눌러 걸어가 창 → 생선 꼬치(바늘이 노란 칸일 때 Space → 별만큼 그릇이 가방에, 재료는 빠짐) →
  //  우유를 눌러 걸어가 먹여 주기 → 하트 하나 → 선물 카드(새 요리법) → 코코 곁에서 E → 부탁한 요리가 먼저 골라져 있고 들어주면 냥코인 →
  //  Esc 로 포탈 앞 → 새로 고쳐도 친구 기록이 남는다. 가방 96칸 = 4쪽: ▶ 버튼 · ← → 키 · 둘째 쪽 칸 고르기 · 휴대폰 밀어 넘기기.
  //  휴대폰: 친구를 눌러 걸어가 창 → 칸 → 먹여 주기 버튼 → ✕ → 가판대 창. 화면 village-*.png · touch-village*.png · screen-village-portrait*.png · bag-page2.png
  console.log('\n[고양이마을 · 요리 · 친구 · 가방 쪽]');
  {
    const { page, errors } = await open('field');
    await page.evaluate(() => localStorage.removeItem('nyang.village.v1'));
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
    await page.evaluate(() => __game.bag.slots.fill(null));
    const w = FIELD.warps.find((v) => v.to === 'village');
    check(inOpen(w.at[0], w.at[1]), `${w.label} 포탈이 열린 구역에`);
    await page.evaluate((at) => Object.assign(__game.field, { x: at[0], y: at[1], camX: at[0], camY: at[1], armed: true, mode: 'walk' }), w.at);
    const inVillage = await page.waitForFunction(() => __game.scene === 'village', { timeout: 8000 }).then(() => true, () => false);
    check(inVillage, `${w.label} 포탈에 서 있으면 고양이마을`);
    await sleep(800);
    const hi = await page.evaluate(() => ({ met: __game.villageSave.met, say: __game.village.townies[0].say }));
    check(hi.met && hi.say.includes('요리'), '처음 오면 코코 할머니가 인사');
    await page.screenshot({ path: fsPath(new URL('village-start.png', OUT)) });
    const countOf = (id) => page.evaluate((id) => __game.bag.slots.reduce((t, v) => t + (v?.id === id ? v.n : 0), 0), id);
    await page.evaluate(() => {
      const b = __game.bag;
      for (const [id, n] of [['cook_fish', 4], ['materials_02', 4], ['materials_06', 2], ['cook_milk', 2]]) b.slots[b.slots.findIndex((s) => !s)] = { id, n };
    });
    // 요리 가판대를 누르면 걸어가서 창
    await click2(page, await page.evaluate(() => __game.villageScreen(2128, 1528)));
    const atKitchen = await page.waitForFunction(() => __game.villageView.panel?.kind === 'kitchen', { timeout: 8000 }).then(() => true, () => false);
    check(atKitchen, '요리 가판대를 누르면 걸어가서 가판대 창');
    await sleep(200);
    await page.screenshot({ path: fsPath(new URL('village-kitchen.png', OUT)) });
    const recipe = await page.evaluate(() => __game.villageView.recipe);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => __game.villageView.panel?.kind === 'cook', { timeout: 2000 }).catch(() => {});
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL('village-cook.png', OUT)) });
    // 바늘이 노란 칸(가운데) 안으로 들어오면 Space
    await page
      .waitForFunction(() => {
        const c = __game.villageView.panel?.cook;
        return c && c.phase === 'stir' && Math.abs(c.pos - c.c) < c.w * 0.1;
      }, { polling: 'raf', timeout: 6000 })
      .catch(() => {});
    await page.keyboard.press('Space');
    await sleep(300);
    const cooked = await page.evaluate(() => ({ phase: __game.villageView.panel?.cook?.phase, stars: __game.villageView.panel?.cook?.stars, saved: __game.villageSave.cooked }));
    const dishes = await countOf(recipe);
    const fish = await countOf('cook_fish');
    check(recipe === 'dish_01' && cooked.phase === 'done' && cooked.stars >= 2 && dishes === cooked.stars && cooked.saved === dishes && fish === 3, `바늘이 노란 칸일 때 Space → ${'★'.repeat(cooked.stars ?? 0)} 생선 꼬치 ${dishes}그릇이 가방에 (생선 4 → ${fish})`);
    await page.screenshot({ path: fsPath(new URL('village-cooked.png', OUT)) });
    await page.keyboard.press('Escape'); // 결과 → 가판대
    await page.keyboard.press('Escape'); // 가판대 닫기
    check((await page.evaluate(() => __game.villageView.panel)) === null, 'Esc 로 창을 닫는다 (마을은 그대로)');
    // 우유: 하트 하나 바로 앞 → 누르면 걸어가 친구 창 → Enter 로 먹여 주기 → 하트 하나 · 선물 카드(새 요리법)
    await page.evaluate(() => (__game.villageSave.friends.milk.pts = 19));
    await click2(page, await page.evaluate(() => ((t) => __game.villageScreen(t.x, t.y - 8))(__game.village.townies[1])));
    const atMilk = await page.waitForFunction(() => __game.villageView.panel?.kind === 'friend' && __game.villageView.panel.i === 1, { timeout: 8000 }).then(() => true, () => false);
    check(atMilk, '우유를 누르면 걸어가서 친구 창');
    await sleep(200);
    await page.keyboard.press('Enter');
    await sleep(300);
    const fed = await page.evaluate(() => ({ milk: __game.villageSave.friends.milk, gifts: __game.villageView.gifts.length, recipes: __game.villageSave.recipes, line: __game.villageView.line }));
    check(fed.milk.pts === 20 && fed.milk.seen.dish_01 === 'dislike' && fed.milk.meals.length === 1 && fed.gifts === 1 && fed.recipes.includes('dish_05'), `Enter 로 생선 꼬치를 먹여 주면 하트 하나 → 선물 카드 · 새 요리법 치즈 오믈렛 ("${fed.line}")`);
    await page.screenshot({ path: fsPath(new URL('village-gift.png', OUT)) });
    await page.keyboard.press('Enter');
    await sleep(200);
    check((await page.evaluate(() => __game.villageView.gifts.length)) === 0, '선물 카드는 Enter 로 닫는다');
    await page.screenshot({ path: fsPath(new URL('village-friend.png', OUT)) });
    await page.keyboard.press('Escape');
    // 코코의 부탁: 곁에 서서 E → 부탁한 요리가 먼저 골라져 있다 → 먹여 주면 냥코인 · 점수 5 + 부탁 10
    await page.evaluate(() => {
      __game.villageSave.friends.coco.ask = 'dish_01';
      const t = __game.village.townies[0];
      Object.assign(__game.village.cat, { x: t.x + 12, y: t.y + 6 });
    });
    await page.waitForFunction(() => __game.village.near?.kind === 'friend' && __game.village.near.i === 0, { timeout: 3000 }).catch(() => {});
    await sleep(300);
    await page.screenshot({ path: fsPath(new URL('village-ask.png', OUT)) });
    await page.keyboard.press('KeyE');
    const atCoco = await page.waitForFunction(() => __game.villageView.panel?.kind === 'friend' && __game.villageView.panel.i === 0, { timeout: 3000 }).then(() => true, () => false);
    const pick = await page.evaluate(() => __game.villageView.pick);
    check(atCoco && pick === 'dish_01', `코코 곁에서 E → 친구 창 · 부탁한 요리(${pick})가 먼저 골라져 있다`);
    const coins0 = await page.evaluate(() => __game.bag.coins);
    await page.keyboard.press('Enter');
    await sleep(200);
    const req = await page.evaluate(() => ({ coins: __game.bag.coins, coco: __game.villageSave.friends.coco }));
    const got = req.coins - coins0;
    check(req.coco.ask === null && got >= 25 && got <= 45 && req.coco.pts === 15 && req.coco.askAt > Date.now() + 80000, `부탁을 들어주면 냥코인 +${got} · 점수 ${req.coco.pts} · 다음 부탁은 나중에`);
    await page.screenshot({ path: fsPath(new URL('village-request.png', OUT)) });
    await page.keyboard.press('Escape');
    await sleep(100);
    await page.keyboard.press('Escape');
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 4000 }).then(() => true, () => false);
    const pos = await page.evaluate(() => [__game.field.x, __game.field.y]);
    check(out && Math.hypot(pos[0] - w.back[0], pos[1] - w.back[1]) < 5, `Esc → ${w.label} 포탈 앞`);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
    const kept = await page.evaluate(() => ({ s: __game.villageSave, dish: __game.bag.slots.reduce((t, v) => t + (v?.id === 'dish_01' ? v.n : 0), 0) }));
    check(kept.s.friends.milk.pts === 20 && kept.s.friends.coco.pts === 15 && kept.s.recipes.includes('dish_05') && kept.s.met && kept.s.fed === 2 && kept.dish === dishes - 2, '새로 고쳐도 친구 · 요리법 · 요리가 남아 있다');
    // 가방 96칸 = 4쪽 — ▶ 버튼 · ← → 키 · 둘째 쪽 칸 고르기
    await page.evaluate(() => {
      const b = __game.bag;
      for (let i = 0; i < 30; i++) b.slots[i] = { id: i === 27 ? 'cook_egg' : 'materials_01', n: 1 };
    });
    await page.keyboard.press('KeyI');
    const bag = () => page.evaluate(() => __game.bagScreen());
    const pg = () => page.evaluate(() => __game.bagView.page);
    const size = await page.evaluate(() => __game.bag.slots.length);
    const p0 = await pg();
    await click2(page, (await bag()).next);
    const p1 = await pg();
    await click2(page, (await bag()).cells[27 - 24]);
    await sleep(150);
    const picked = await page.evaluate(() => __game.bagView.pick);
    await page.screenshot({ path: fsPath(new URL('bag-page2.png', OUT)) });
    await page.keyboard.press('ArrowRight');
    const p2 = await pg();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    const p3 = await pg();
    check(size === 96 && p0 === 0 && p1 === 1 && picked?.i === 27 && p2 === 2 && p3 === 0, `가방 ${size}칸 = 4쪽: ▶ 로 둘째 쪽 · 그 쪽 칸을 고른다 (${picked?.i}번) · ← → 키로 넘긴다`);
    await page.keyboard.press('Escape');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    // 휴대폰 가로: 친구를 눌러 걸어가 창 → 칸 → 먹여 주기 버튼 → ✕ → 가판대를 눌러 창 · 가방은 밀어서 넘긴다
    const PH = { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true };
    const tap = async (page, p) => (await page.touchscreen.touchStart(p.x, p.y)).end();
    const { page, errors } = await open('village', '', PH, '&touch');
    await sleep(800);
    await page.screenshot({ path: fsPath(new URL('touch-village.png', OUT)) });
    await page.evaluate(() => {
      const b = __game.bag;
      b.slots.fill(null); // 앞 검사의 가방(생선 꼬치 — 크림이 싫어한다)이 남아 있다
      b.slots[0] = { id: 'dish_03', n: 2 };
    });
    const before = await page.evaluate(() => __game.villageSave.friends.cream.pts);
    await tap(page, await page.evaluate(() => ((t) => __game.villageScreen(t.x, t.y - 8))(__game.village.townies[4])));
    const atCream = await page.waitForFunction(() => __game.villageView.panel?.kind === 'friend' && __game.villageView.panel.i === 4, { timeout: 8000 }).then(() => true, () => false);
    await sleep(200);
    const P = await page.evaluate(() => __game.villagePoints());
    await tap(page, P.cells[0]);
    await tap(page, P.feed);
    await sleep(250);
    await page.screenshot({ path: fsPath(new URL('touch-village-friend.png', OUT)) });
    const after = await page.evaluate(() => __game.villageSave.friends.cream);
    check(atCream && after.pts > before && after.seen.dish_03, `크림을 눌러 걸어가 창 → 칸 → 먹여 주기 버튼 (점수 ${before} → ${after.pts})`);
    await tap(page, P.close);
    const closed = (await page.evaluate(() => __game.villageView.panel)) === null;
    await tap(page, await page.evaluate(() => __game.villageScreen(2128, 1528)));
    const atKitchen = await page.waitForFunction(() => __game.villageView.panel?.kind === 'kitchen', { timeout: 8000 }).then(() => true, () => false);
    await sleep(200);
    await page.screenshot({ path: fsPath(new URL('touch-village-kitchen.png', OUT)) });
    check(closed && atKitchen, '✕ 로 닫고 · 가판대를 누르면 걸어가서 가판대 창');
    await tap(page, P.close);
    // 가방 버튼 → 밀어서 넘기기
    await tap(page, (await page.evaluate(() => __game.controls)).buttons.find((b) => b.id === 'bag'));
    const opened = await page.evaluate(() => __game.bagOpen);
    const sw = await page.touchscreen.touchStart(PH.width * 0.6, PH.height * 0.5);
    await page.touchscreen.touchMove(PH.width * 0.4, PH.height * 0.5);
    await page.touchscreen.touchMove(PH.width * 0.25, PH.height * 0.52);
    await sw.end();
    const page1 = await page.evaluate(() => __game.bagView.page);
    check(opened && page1 === 1, `마을에서도 가방 버튼 · 옆으로 밀면 다음 쪽 (${page1 + 1}쪽)`);
    await page.screenshot({ path: fsPath(new URL('touch-bag-swipe.png', OUT)) });
    // 세로 화면
    await tap(page, (await page.evaluate(() => __game.bagScreen())).close);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await sleep(500);
    await page.screenshot({ path: fsPath(new URL('screen-village-portrait.png', OUT)) });
    await page.evaluate(() => {
      const t = __game.village.townies[2];
      Object.assign(__game.village.cat, { x: t.x - 12, y: t.y + 8 });
    });
    await page.waitForFunction(() => __game.village.near?.kind === 'friend', { timeout: 3000 }).catch(() => {});
    await page.keyboard.press('KeyE');
    await sleep(400);
    await page.screenshot({ path: fsPath(new URL('screen-village-portrait-friend.png', OUT)) });
    await page.keyboard.press('Escape');
    await page.evaluate(() => Object.assign(__game.village.cat, { x: 2092, y: 1556 }));
    await sleep(200);
    await page.keyboard.press('KeyE');
    await sleep(400);
    await page.screenshot({ path: fsPath(new URL('screen-village-portrait-kitchen.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-8) 웨이브 · 기술 (실제 키·마우스·터치): 웨이브 1 = 방 몬스터 + 가장자리에서 더 → 쓰러뜨리면 생선뼈 → 레벨 업 카드 → 1 키로 고른다 →
  //  다시 레벨 업 → 마우스로 두 번째 카드 → 기술 여럿을 켜고 싸워도 NaN 그리기·에러 없음 → 웨이브 2 · 마지막 웨이브 정예 → 휴대폰 카드 터치.
  //  화면 dungeon-wave.png · dungeon-cards.png · dungeon-skills.png · dungeon-elite.png · dungeon-cards-phone.png
  console.log('\n[웨이브 · 기술]');
  {
    const { page, errors } = await open('dungeon');
    await page.evaluate(() => {
      window.__badDraw = 0;
      const T = CanvasRenderingContext2D.prototype.translate;
      CanvasRenderingContext2D.prototype.translate = function (x, y) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) window.__badDraw++;
        return T.call(this, x, y);
      };
      const D = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function (...a) {
        if (a.slice(1).some((v) => typeof v === 'number' && !Number.isFinite(v))) window.__badDraw++;
        return D.apply(this, a);
      };
    });
    const w0 = await page.evaluate(() => ({ n: __game.dungeon.enemies.length, q: __game.dungeon.wave.queue.length, total: __game.dungeon.wave.total }));
    check(w0.n + w0.q === WAVE_DATA.counts[0] && w0.total === WAVE_DATA.counts.length, `웨이브 1: 방 몬스터 ${w0.n} + 가장자리에서 ${w0.q} (웨이브 ${w0.total}개)`);
    await page.evaluate(() => setInterval(() => (__game.dungeon.P.invT = 1), 50)); // 이 검사에선 안 다친다
    const spawned = await page.waitForFunction((n) => __game.dungeon.enemies.length > n, { timeout: 6000 }, w0.n).then(() => true, () => false);
    const far = await page.evaluate(() => {
      const d = __game.dungeon;
      return d.enemies.slice(3).every((e) => Math.hypot(e.x - d.P.x, e.z - d.P.z) > 3.5);
    });
    check(spawned && far, '가장자리에서 예고 뒤 몬스터가 더 나온다 (고양이 가까이는 아니다)');
    await page.screenshot({ path: fsPath(new URL('dungeon-wave.png', OUT)) });
    // 자동 냥펀치로 쓰러뜨려 생선뼈 → 레벨 업 카드
    for (let i = 0; i < 40 && !(await page.evaluate(() => !!__game.dungeon.choose)); i++) {
      await page.evaluate(() => {
        const d = __game.dungeon;
        const e = d.enemies.find((v) => v.state !== 'pop');
        if (e) Object.assign(e, { hp: 1, x: d.P.x + d.P.faceX * 0.9, z: d.P.z + d.P.faceZ * 0.9 });
      });
      await sleep(150);
    }
    const lv = await page.evaluate(() => ({ choose: __game.dungeon.choose?.length ?? 0, level: __game.dungeon.run.level }));
    check(lv.choose === 3 && lv.level >= 2, `쓰러뜨리고 생선뼈를 먹으면 레벨 업 카드 3장 (Lv ${lv.level})`);
    const frozen = await page.evaluate(async () => {
      const d = __game.dungeon;
      const e = d.enemies.find((v) => v.state !== 'pop');
      const x = e?.x;
      await new Promise((r) => setTimeout(r, 400));
      return !e || e.x === x;
    });
    check(frozen, '카드를 고르는 동안은 멈춘다');
    await sleep(200);
    await page.screenshot({ path: fsPath(new URL('dungeon-cards.png', OUT)) });
    const first = await page.evaluate(() => __game.dungeon.choose[0].id);
    await page.keyboard.press('Digit1');
    await sleep(150);
    const got1 = await page.evaluate((id) => ({ open: !!__game.dungeon.choose, lv: __game.dungeon.run.skills[id] ?? 0 }), first);
    check(!got1.open && got1.lv >= 1, `1 키로 첫 카드를 고른다 (${first})`);
    // 다시 레벨 업 → 마우스로 두 번째 카드
    await page.evaluate(() => (__game.dungeon.run.pending = 1));
    await page.waitForFunction(() => __game.dungeon.choose, { timeout: 2000 });
    const second = await page.evaluate(() => __game.dungeon.choose[1].id);
    const pt = await page.evaluate(() => __game.cardPoint(1));
    await click2(page, pt);
    await sleep(150);
    const got2 = await page.evaluate((id) => ({ open: !!__game.dungeon.choose, lv: __game.dungeon.run.skills[id] ?? 0 }), second);
    check(!got2.open && got2.lv >= 1, `마우스로 두 번째 카드를 고른다 (${second})`);
    // 기술 16가지를 다 켜고 4초 — 효과가 그려지고 에러·NaN 없음
    await page.evaluate(() => {
      for (const id of ['yarn_ball', 'spool', 'hairball', 'snare', 'catnip_cloud', 'zoom', 'tail_swirl', 'paw_combo', 'box_orbit', 'box_drop', 'loaf_shield', 'hiss', 'red_dot', 'pounce', 'claw', 'wind_mouse']) __game.learnSkill(id, 3);
      setInterval(() => __game.dungeon.choose && __game.pick(0), 40);
    });
    // 4초 동안 가장 많았던 날아가는 것 · 효과 (한 순간만 세면 적이 다 쓰러진 쉬는 시간에 0 이 나온다)
    await page.evaluate(() => {
      window.__most = { ents: 0, fx: 0 };
      setInterval(() => {
        const r = __game.dungeon.run;
        window.__most.ents = Math.max(window.__most.ents, r.ents.length);
        window.__most.fx = Math.max(window.__most.fx, r.fx.length);
      }, 50);
    });
    await page.keyboard.down('Space');
    await sleep(300);
    await page.keyboard.up('Space');
    await sleep(1800);
    await page.screenshot({ path: fsPath(new URL('dungeon-skills.png', OUT)) });
    await sleep(2000);
    const fx = await page.evaluate(() => ({ ...window.__most, skills: Object.keys(__game.dungeon.run.skills).length }));
    check(fx.skills === 16 && fx.ents + fx.fx > 0, `기술 16가지 (날아가는 것 ${fx.ents} · 효과 ${fx.fx})`);
    // 웨이브가 넘어간다 → 마지막 웨이브엔 정예
    const w1 = await page.waitForFunction(() => __game.dungeon.wave.i >= 1, { timeout: 30000 }).then(() => true, () => false);
    check(w1, '웨이브 1 을 깨면 웨이브 2');
    await page.evaluate(() => {
      const d = __game.dungeon;
      d.enemies.forEach((e) => (e.hp = 1));
      Object.assign(d.wave, { i: d.wave.total - 2, state: 'break', t: 99, queue: [], marks: [] });
    });
    const elite = await page.waitForFunction(() => __game.dungeon.enemies.some((e) => e.elite), { timeout: 20000 }).then(() => true, () => false);
    check(elite, '마지막 웨이브엔 정예가 나온다');
    await sleep(600);
    await page.screenshot({ path: fsPath(new URL('dungeon-elite.png', OUT)) });
    // 끝까지: 마지막 웨이브의 남은 것을 다 쓰러뜨리면 결과창 — 기록(쓰러뜨린 수 · 냥코인 · 준 피해 · 기술)
    await page.evaluate(() => {
      const d = __game.dungeon;
      d.wave.queue = [];
      d.wave.marks = [];
      d.enemies.forEach((e) => (e.hp = 1));
    });
    const res = await page.waitForFunction(() => __game.dungeon.result?.win, { timeout: 20000 }).then(() => true, () => false);
    const st = await page.evaluate(() => ({ ...__game.dungeon.stats, skills: Object.keys(__game.dungeon.run.skills).length }));
    check(res && st.kills > 5 && st.dealt > 0 && st.skills > 0, `결과창: 쓰러뜨린 ${st.kills} · 준 피해 ${st.dealt} · 냥코인 ${st.coins} · 기술 ${st.skills}`);
    await sleep(300);
    await page.screenshot({ path: fsPath(new URL('dungeon-result.png', OUT)) });
    const resultFrozen = await page.evaluate(async () => {
      const x = __game.dungeon.P.x;
      await new Promise((r) => setTimeout(r, 300));
      return __game.dungeon.P.x === x;
    });
    check(resultFrozen, '결과창이 떠 있으면 멈춘다');
    const bad = await page.evaluate(() => window.__badDraw);
    check(bad === 0, `NaN 좌표로 그린 것 ${bad}번`);
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }
  {
    // 휴대폰 세로: 카드는 세로로 쌓이고, 손가락으로 누른다 (가로 휴대폰은 가로 카드를 줄여서)
    const { page, errors } = await open('dungeon', '', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, '&touch');
    await page.evaluate(() => (__game.dungeon.run.pending = 1));
    await page.waitForFunction(() => __game.dungeon.choose, { timeout: 3000 });
    await sleep(300);
    await page.screenshot({ path: fsPath(new URL('dungeon-cards-phone.png', OUT)) });
    const id = await page.evaluate(() => __game.dungeon.choose[2].id);
    const pt = await page.evaluate(() => __game.cardPoint(2));
    await page.touchscreen.tap(pt.x, pt.y);
    await sleep(200);
    const got = await page.evaluate((id) => ({ open: !!__game.dungeon.choose, lv: __game.dungeon.run.skills[id] ?? 0 }), id);
    check(!got.open && got.lv >= 1, `휴대폰: 세 번째 카드를 눌러 고른다 (${id})`);
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-8-0) 빨간 점: 평소엔 아무것도 없고, 쏠 때만 조준선(가는 점선 + 조여드는 조준경) → 레이저 빔. 화면 dungeon-laser-aim.png · dungeon-laser-fire.png
  //  기술 칸: 5가지를 배우면 카드엔 가진 기술 레벨 업만 (위에 "기술 칸 5/5"), 오른쪽 위엔 빈 칸 점선. 화면 dungeon-cards-full.png
  {
    const { page, errors } = await open('dungeon');
    await page.evaluate(() => {
      setInterval(() => (__game.dungeon.P.invT = 1), 40);
      __game.dungeon.auto = false; // 냥펀치로 먼저 쓰러뜨리지 않게
      __game.dungeon.enemies.forEach((e) => (e.hp = 9999));
      __game.learnSkill('red_dot', 3);
    });
    const seen = await page.evaluate(async () => {
      const out = [];
      const t0 = performance.now();
      while (performance.now() - t0 < 3200) {
        const ls = __game.dungeon.run.ents.filter((e) => e.k === 'laser' && e.t >= 0);
        const k = ls.length ? (ls[0].t < ls[0].aim ? 'aim' : 'fire') : '-';
        if (out[out.length - 1] !== k) out.push(k);
        await new Promise((r) => requestAnimationFrame(r));
      }
      return out;
    });
    const cycle = seen.join(' ');
    check(/- aim fire -.*aim fire/.test(cycle), `빨간 점: 평소엔 없고 쏠 때만 조준 → 발사, 되풀이 (${cycle})`);
    await page.waitForFunction(() => __game.dungeon.run.ents.some((e) => e.k === 'laser' && e.t > 0.15 && e.t < e.aim), { polling: 'raf', timeout: 4000 });
    await page.screenshot({ path: fsPath(new URL('dungeon-laser-aim.png', OUT)) });
    await page.waitForFunction(() => __game.dungeon.run.ents.some((e) => e.k === 'laser' && e.t > e.aim + 0.15), { polling: 'raf', timeout: 4000 });
    await page.screenshot({ path: fsPath(new URL('dungeon-laser-fire.png', OUT)) });
    // 기술 칸을 다 채운다 (빨간 점 + 나머지)
    await page.evaluate((slots) => {
      for (const id of ['yarn_ball', 'spool', 'hairball', 'snare'].slice(0, slots - 1)) __game.learnSkill(id, 1);
      __game.dungeon.run.pending = 1;
    }, SKILL_DATA.slots);
    await page.waitForFunction(() => __game.dungeon.choose, { timeout: 3000 });
    const cards = await page.evaluate(() => ({ ids: __game.dungeon.choose.map((c) => c.id), owned: Object.keys(__game.dungeon.run.skills) }));
    check(cards.owned.length === SKILL_DATA.slots && cards.ids.every((id) => cards.owned.includes(id)), `기술 ${SKILL_DATA.slots}가지면 카드엔 가진 기술만 (${cards.ids.join(', ')})`);
    await sleep(250);
    await page.screenshot({ path: fsPath(new URL('dungeon-cards-full.png', OUT)) });
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-8-1) 나가는 칸: 밟자마자 나가지 않고 3초 서 있어야 나간다 (머리 위에 남은 시간 고리). 화면 dungeon-exit-gauge.png
  {
    const { page, errors } = await open('dungeon');
    await autoPick(page);
    await page.evaluate((e) => {
      setInterval(() => (__game.dungeon.P.invT = 1), 40);
      Object.assign(__game.dungeon.P, { x: e[0], z: e[1] });
    }, EXIT);
    await sleep(1500);
    const mid = await page.evaluate(() => ({ scene: __game.scene, exitT: __game.dungeon.exitT }));
    check(mid.scene === 'dungeon' && mid.exitT > 1, `나가는 칸을 밟아도 바로 나가지 않는다 (1.5초 뒤 ${mid.exitT.toFixed(1)}초 서 있음)`);
    await page.screenshot({ path: fsPath(new URL('dungeon-exit-gauge.png', OUT)) });
    const out = await page.waitForFunction(() => __game.scene === 'field', { timeout: 3500 }).then(() => true, () => false);
    check(out, '3초 서 있으면 밖으로 나간다');
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-9) 샌드보드 미끄러짐 연속 촬영 (sandboard-drift.png): 오른쪽으로 눌러 미끄러지기 시작 → 놓기 → 왼쪽으로 홱.
  //  보드가 먼저 꺾이고(넘쳤다 돌아옴) 몸은 늦게 따라오고, 꼬리에서 모래가 튀는지 눈으로 본다. 컷이 바뀌어도 보드가 튀지 않는지(보드 중심 위치)도 잰다
  console.log('\n[샌드보드 미끄러짐]');
  {
    const { page, errors } = await open('sandboard');
    await page.evaluate(() => {
      const s = __game.sandboard;
      s.obs = [];
      s.nextAt = 9999;
      s.course = { segs: [{ d0: -1e9, d1: 1e9, c0: 0, s0: 0, s1: 0, kind: 'start' }], widths: [{ d: 0, w: 1 }] }; // 곧은 길에서 (울타리에 밀려 각도가 섞이지 않게)
    });
    await sleep(1600);
    const shots = [];
    const snap = async (label) => {
      const m = await page.evaluate(() => {
        const s = __game.sandboard;
        return { ...__game.sandScreen(s.x, s.d), yaw: s.yaw, slip: s.slip, lane: s.x };
      });
      shots.push({ img: await page.screenshot({ type: 'jpeg', quality: 90, encoding: 'base64' }), meta: { ...m, label } });
    };
    await page.keyboard.down('KeyD');
    for (let i = 0; i < 6; i++) await snap('→ 누름');
    await page.keyboard.up('KeyD');
    for (let i = 0; i < 3; i++) await snap('놓음');
    await page.keyboard.down('KeyA');
    for (let i = 0; i < 3; i++) await snap('← 홱');
    await page.keyboard.up('KeyA');
    const yaws = shots.map((s) => s.meta.yaw);
    check(Math.max(...yaws) > 0.3 && Math.min(...yaws.slice(9)) < Math.max(...yaws), `보드가 꺾인다 (최대 ${((Math.max(...yaws) * 180) / Math.PI).toFixed(0)}°)`);
    check(Math.max(...shots.map((s) => s.meta.slip)) > 0.3, '미끄러지기 시작할 때 미끄러짐이 커진다 (모래가 튄다)');
    const p2 = await browser.newPage();
    await p2.setViewport({ width: 1240, height: 1000 });
    await p2.setContent('<body style="margin:0;background:#222"><canvas id=c width=1240 height=1000></canvas></body>');
    await p2.evaluate(async (shots) => {
      const c = document.getElementById('c').getContext('2d');
      c.font = '14px sans-serif';
      for (let i = 0; i < shots.length; i++) {
        const { img, meta } = shots[i];
        const im = new Image();
        im.src = 'data:image/jpeg;base64,' + img;
        await im.decode();
        const x = (i % 4) * 310;
        const y = Math.floor(i / 4) * 330;
        c.drawImage(im, meta.x - 120, meta.y - 200, 240, 260, x + 5, y + 5, 300, 300 * (260 / 240));
        c.fillStyle = '#fff';
        c.fillText(`${i} ${meta.label} · 보드 ${((meta.yaw * 180) / Math.PI).toFixed(0)}° · 미끄러짐 ${meta.slip.toFixed(2)}`, x + 8, y + 326);
      }
    }, shots);
    await p2.screenshot({ path: fsPath(new URL('sandboard-drift.png', OUT)) });
    await p2.close();
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 3-10) 샌드보드 결승 앞 프레임 비용: 결승 앞도 평면 구간처럼 가볍게 그린다 (2026-10-07 — 예전엔 결승 앞만 원근으로 말며 바닥을 1px 줄마다
  //  따로 칠해 한 프레임이 0.7 → 3~9ms 로 늘어 고해상도 · 고주사율 화면에서 결승 앞 길이 빤짝거렸다. 지금은 결승까지 평면).
  //  큰 고해상도 화면(1920×1000 배율 2)에서 게임 rAF 콜백(갱신 + 그리기) 시간의 중간값을 평면 구간과 견준다
  console.log('\n[샌드보드 결승 앞 프레임 비용]');
  {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1000, deviceScaleFactor: 2 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.evaluateOnNewDocument(() => {
      const raf = window.requestAnimationFrame.bind(window);
      window.__cost = [];
      window.requestAnimationFrame = (cb) =>
        raf((ts) => {
          const t0 = performance.now();
          cb(ts);
          const s = window.__game?.sandboard;
          if (s) window.__cost.push([s.d, performance.now() - t0]);
        });
    });
    await page.goto(base + '?trace&sandboard', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__sheets && window.__game?.sandboard, { timeout: 60000 });
    const r = await page.evaluate(async (L) => {
      const s = __game.sandboard;
      s.obs = [];
      s.nextAt = 1e9;
      setInterval(() => (s.hearts = 3), 50);
      s.d = 250;
      await new Promise((res) => setTimeout(res, 2500));
      s.d = L - 55;
      await new Promise((res) => setTimeout(res, 2200));
      const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
      const flat = window.__cost.filter(([d]) => d > 255 && d < 300).map(([, t]) => t);
      const curl = window.__cost.filter(([d]) => d > L - 50 && d < L - 1).map(([, t]) => t);
      return { flat: med(flat), curl: med(curl), n: [flat.length, curl.length] };
    }, SAND_CFG.length);
    check(r.curl <= r.flat * 2 + 1.5, `결승 앞도 평면 구간처럼 가볍게 그린다 (한 프레임 중간값: 평면 ${r.flat.toFixed(2)}ms · 결승 앞 ${r.curl.toFixed(2)}ms, ${r.n.join('/')}프레임)`);
    check(errors.length === 0, `페이지 에러 ${errors.length}건${errors.length ? ': ' + errors[0] : ''}`);
    await page.close();
  }

  // 4) 왕복: 필드에서 시작 → 골목 던전 포탈(돌다리 — 고양이마을은 2026-10-08 마을이 됐다) 앞으로 → 포탈로 걸어가 머문다 → 던전 → 나가는 칸으로 걸어 나간다 → 필드
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
    // 클리어하기 전에는 나가는 칸까지 걸어가면 나갈 수 있다 (도망) — 여기선 실제 게임처럼 다 깨고 결과창 → Enter 로 필드
    await page.evaluate(() => {
      __game.skipWaves();
      __game.dungeon.enemies = [];
    });
    await page.waitForFunction(() => __game.dungeon.phase === 'cleared', { timeout: 3000 });
    const shown = await page.waitForFunction(() => __game.dungeon.result?.win, { timeout: 4000 }).then(() => true, () => false);
    check(shown, '방을 다 깨면 결과창');
    await page.keyboard.press('Enter');
    const left = await page.waitForFunction(() => __game.scene === 'field', { timeout: 3000 }).then(() => true, () => false);
    check(left, '결과창에서 Enter 로 필드로 나온다');
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
    }, FIELD.start, OPEN_WARPS);
    check(cut.length === 0, `시작점에서 개방 구역의 모든 워프까지 갈 수 있다 (워프 ${OPEN_WARPS.length}개${cut.length ? ', 막힌 워프: ' + cut.join(', ') : ''})`);
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
    } else console.log('       막힌 곳 없음 — 절벽·바위도 걷는다 (사용자 결정 2026-10-06). 손으로 R 을 칠하면 여기서 다시 검사한다');

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
    // 돌다리 연속 촬영 (출발점은 위 '돌다리: 위 강 → 아래 강' 횡단과 같은 자리)
    await page.evaluate(() => {
      Object.assign(__game.field, { x: 1110 + 1672, y: 470 + 941, camX: 1110 + 1672, camY: 470 + 941, mode: 'boat', modeT: 1 });
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
  // 몬스터 공격 모션을 찍는다 — 자동 냥펀치는 맞은 몬스터를 움찔하게 해 공격 예고를 끊으니 끈다
  await page.evaluate(() => (__game.dungeon.auto = false));
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
