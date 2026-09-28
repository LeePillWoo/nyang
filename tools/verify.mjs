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
const ROOM = readJson('../src/data/rooms.json').alley;
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

/** where: 'dungeon' 이면 던전에서 바로 시작, 'field' 면 게임처럼 필드에서 시작 */
async function open(where = 'dungeon') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + '?trace' + (where === 'dungeon' ? '&dungeon' : ''), { waitUntil: 'load' });
  await page.waitForFunction(() => window.__sheets, { timeout: 60000 });
  return { page, errors };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHEET_ROWS = { axe: 4, boat: 4 }; // 나머지 시트는 5행

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
    const W = Math.ceil(1672 / S);
    const H = Math.ceil(941 / S);
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
  fs.mkdirSync(OUT, { recursive: true });

  // 4) 왕복: 필드에서 시작 → 집 앞 워프로 걸어가 머문다 → 던전 → 노란 매트로 걸어 나간다 → 필드
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

    const warp = await page.evaluate(() => __game.field.warp ?? null);
    const warpAt = FIELD.warps[0].at;
    await walk(page, fieldPos, warpAt, fieldKeys, () => __game.field.dwell > 0.3);
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
    const left = await walk(page, () => __game.cat, EXIT, dungeonKeys, () => __game.scene === 'field', 10000);
    check(left, '노란 매트를 밟으면 필드로 나온다');
    await sleep(500);
    const back = await page.evaluate(() => ({ x: __game.field.x, y: __game.field.y, armed: __game.field.armed }));
    const [bx, by] = FIELD.warps[0].back;
    // 도착 순간 아직 누르고 있던 키로 몇 픽셀 걸을 수 있다 (게임에서도 정상 동작)
    check(Math.abs(back.x - bx) < 15 && Math.abs(back.y - by) < 15, `집 앞으로 돌아온다 (${back.x.toFixed(0)}, ${back.y.toFixed(0)})`);
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
      for (let y = 40; y < 900; y += 6)
        for (let x = 60; x < 1610; x += 6) {
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
      await fieldBurst(page, () => __game.field.chopping > 0.3, new URL('field-chop.png', OUT));
      await sleep(1500);
      stop = true;
      await pace;
      const chops = await page.evaluate(() => __game.field.chops);
      check(chops >= 2, `숲을 걸으면 도끼질을 한다 (${chops}회)`);
    }

    // 갈 수 있는가: 시작점에서 모든 워프까지 (물은 배로 건너니 검정만 벽이다). 마스크를 고치다 입구를 막으면 여기서 잡힌다
    const cut = await page.evaluate((start, warps) => {
      const S = 4;
      const W = Math.ceil(1672 / S);
      const H = Math.ceil(941 / S);
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

    // 막힘: 가장 가까운 암벽·바위 덩어리 한가운데를 향해 3초 동안 밀고 들어가 본다
    const wall = await page.evaluate(() => {
      const s = __game.field;
      const solid = (x, y) => [[0, 0], [10, 0], [-10, 0], [0, 8], [0, -8]].every(([dx, dy]) => __game.terrain(x + dx, y + dy) === 3);
      let best = null;
      for (let y = 30; y < 910; y += 5)
        for (let x = 30; x < 1640; x += 5) {
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
    const CROSSINGS = [
      ['서쪽 나무다리: 호수 → 강', [905, 318], ['KeyS']],
      ['서쪽 나무다리: 강 → 호수', [915, 380], ['KeyW']],
      ['돌다리: 위 강 → 아래 강', [1110, 470], ['KeyS', 'KeyD']],
      ['돌다리: 아래 강 → 위 강', [1190, 525], ['KeyW', 'KeyA']],
    ];
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
      Object.assign(__game.field, { x: 1100, y: 463, camX: 1100, camY: 463, mode: 'boat', modeT: 1 });
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
