// 게임 뼈대 — 캔버스·입력·장면 전환(필드 ↔ 던전)·소리·불러오기.
// 필드는 field.ts(로직) / field-draw.ts(그리기), 던전은 dungeon.ts / dungeon-draw.ts.
import bowUrl from './assets/rat-bow.webp';
import fatUrl from './assets/rat-fat.webp';
import swordUrl from './assets/rat-sword.webp';
import { sfxChop, sfxHit, sfxHurt, sfxPop, sfxRow, sfxSplash, unlockAudio } from './audio.ts';
import { loadAxe, loadBoat, loadCat } from './cat.ts';
import { drawDungeon, dungeonReady } from './dungeon-draw.ts';
import { makeDungeon, resetDungeon, updateDungeon, type Dungeon, type DungeonEvent } from './dungeon.ts';
import type { Kind } from './enemy.ts';
import { drawField, fieldFx, fieldReady, fieldView, terrainAt, terrainReady } from './field-draw.ts';
import { backFrom, FIELD, makeFieldState, updateField, type FieldEvent, type FieldState } from './field.ts';
import { loadSheet, type Sheet } from './sheet.ts';

const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d')!;
document.body.appendChild(canvas);

function layout() {
  const dpr = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(innerWidth * dpr);
  canvas.height = Math.round(innerHeight * dpr);
  canvas.style.width = `${innerWidth}px`;
  canvas.style.height = `${innerHeight}px`;
}
layout();
addEventListener('resize', layout);

const keys = new Set<string>();
let debug = location.search.includes('grid');
let showTerrain = location.search.includes('terrain'); // 필드 지형 보기 (T 키)

// ?trace — tools/verify.mjs 가 쓴다. 프레임마다 실제로 그린 사각형을 남겨 튐·사라짐을 잡는다.
const trace: Record<string, unknown>[] | null = location.search.includes('trace') ? [] : null;
if (trace) Object.assign(window, { __trace: trace });
function traceDraw(who: string, sh: Sheet, row: number, col: number, sx: number, sy: number, size: number, flip: number, rs: number, extra: object) {
  if (!trace) return;
  const r = sh.frames[row] ?? [];
  const f = r[Math.min(col, r.length - 1)];
  if (!f) return;
  const k = (size / sh.base) * rs;
  const a = sx + flip * f.ox * k;
  const b = sx + flip * (f.ox + f.sw) * k;
  trace.push({ t: performance.now(), who, row, col, clamped: col >= r.length, flip, sx, sy, left: Math.min(a, b), right: Math.max(a, b), ...extra });
}
let punchQueued = false;
addEventListener('keydown', (e) => {
  unlockAudio();
  keys.add(e.code);
  if (e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyG') debug = !debug;
  if (e.code === 'KeyT') showTerrain = !showTerrain;
  if (e.code === 'KeyJ') punchQueued = true;
  if (e.code === 'KeyR' && scene === 'dungeon') {
    if (dungeon.phase === 'napped') leaveDungeon(); // GDD: 목숨을 다 쓰면 마을에서 깨어난다
    else resetDungeon(dungeon);
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
canvas.addEventListener('mousedown', () => {
  unlockAudio();
  punchQueued = true;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const held = (...codes: string[]) => codes.some((c) => keys.has(c));
/** 화면 기준 방향 입력 -1..1 */
const input = () => ({
  mx: (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0),
  my: (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0),
});

const sheets = {} as Record<Kind, Sheet>;
let catSheet: Sheet;
let axeSheet: Sheet;
let boatSheet: Sheet;
let dungeon: Dungeon;

// 장면: 필드(시작) ↔ 던전. ?dungeon 이면 던전에서 바로 시작한다 (검증용)
let scene: 'field' | 'dungeon' = location.search.includes('dungeon') ? 'dungeon' : 'field';
let field: FieldState = makeFieldState(FIELD.start);
let roomId = 'alley'; // 지금 들어가 있는 던전
if (trace)
  Object.assign(window, {
    __game: {
      get scene() { return scene; },
      get field() { return field; },
      get cat() { return { x: dungeon.P.x, z: dungeon.P.z }; },
      terrain: terrainAt,
      /** 필드 고양이의 화면 위치 (CSS px) */
      get catScreen() {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fieldView.ox + field.x * fieldView.sc) / d, y: (fieldView.oy + field.y * fieldView.sc) / d };
      },
    },
  });

/** 필드 연출 사건 → 소리 */
function fieldSound(e: FieldEvent) {
  if (e.type === 'chop') sfxChop();
  else if (e.type === 'splash') sfxSplash();
  else if (e.type === 'stroke') sfxRow();
}
/** 던전 사건 → 소리 */
function dungeonSound(e: DungeonEvent) {
  if (e.type === 'hit') sfxHit(e.finish);
  else if (e.type === 'pop') sfxPop();
  else if (e.type === 'hurt') sfxHurt();
}

// 장면 전환: 크림색으로 덮은 순간 장면을 바꾸고 다시 걷어낸다
const FADE = 0.28;
let fade = 0;
let fadeTo: (() => void) | null = null;
const goTo = (swap: () => void) => {
  if (!fadeTo && fade === 0) fadeTo = swap;
};
const enterDungeon = (to: string) =>
  goTo(() => {
    scene = 'dungeon';
    roomId = to;
    resetDungeon(dungeon);
    sayHelp();
  });
const leaveDungeon = () =>
  goTo(() => {
    scene = 'field';
    field = makeFieldState(backFrom(roomId), terrainAt);
    sayHelp();
  });

let last = performance.now();
let lastDt = 1 / 60; // 표시용 보간에 쓴다
let fps = 0;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  lastDt = dt;
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.1;
  if (fadeTo) {
    fade = Math.min(1, fade + dt / FADE);
    if (fade >= 1) {
      fadeTo();
      fadeTo = null;
    }
  } else if (fade > 0) fade = Math.max(0, fade - dt / FADE);

  // 덮이는 동안은 멈춘다
  if (!fadeTo) {
    if (scene === 'field') {
      const { mx, my } = input();
      const w = updateField(field, mx, my, dt, terrainAt);
      field.events.forEach(fieldSound);
      fieldFx(field.events);
      if (w) enterDungeon(w.to);
    } else {
      const out = updateDungeon(dungeon, { ...input(), punch: punchQueued, dash: keys.has('Space') }, dt);
      dungeon.events.forEach(dungeonSound);
      if (out === 'exit') leaveDungeon();
    }
    punchQueued = false;
  }
  if (scene === 'field') drawFieldScene();
  else drawDungeon(ctx, canvas.width, canvas.height, dungeon, catSheet, { t: last / 1000, dt: lastDt, fps, grid: debug, trace: trace ? traceDraw : undefined });
  drawFade();
  requestAnimationFrame(frame);
}

/** 필드 장면 + 지역 이름표 */
function drawFieldScene() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawField(ctx, canvas.width, canvas.height, field, { cat: catSheet, axe: axeSheet, boat: boatSheet }, last / 1000, lastDt, showTerrain);
  const s = Math.min(devicePixelRatio, 2);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.font = 'bold 15px system-ui, sans-serif';
  const w = ctx.measureText(FIELD.name).width + 28;
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.beginPath();
  ctx.roundRect(14, 14, w, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.fillText(FIELD.name, 28, 36);
}

/** 장면 전환 덮개 */
function drawFade() {
  if (fade <= 0) return;
  const k = fade * fade * (3 - 2 * fade);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = `rgba(255, 246, 232, ${k})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

const help = document.getElementById('help')!;
const HELP = {
  field: 'WASD 이동 · 숲은 도끼로, 물은 배로 · 집 앞 빛나는 원에 잠시 서 있으면 던전 · T 지형 보기',
  dungeon: 'WASD 이동 · 클릭/J 냥펀치 · Space 구르기 · 노란 매트로 나가기 · G 격자',
};
function sayHelp() {
  help.textContent = HELP[scene];
}
const step = (t: string) => {
  help.textContent = t + ' 불러오는 중…';
};

(async () => {
  step('배경');
  await Promise.all([dungeonReady, fieldReady]);
  step('고양이 시트');
  catSheet = await loadCat();
  step('도끼·배 시트');
  [axeSheet, boatSheet] = await Promise.all([loadAxe(), loadBoat()]);
  step('지형');
  await terrainReady;
  field = makeFieldState(FIELD.start, terrainAt);
  step('칼 쥐');
  sheets.sword = await loadSheet(swordUrl, 6, 5);
  step('활 쥐');
  sheets.bow = await loadSheet(bowUrl, 6, 5);
  step('뚱보 쥐');
  sheets.fat = await loadSheet(fatUrl, 6, 5);
  dungeon = makeDungeon(sheets);
  if (trace) Object.assign(window, { __sheets: { cat: catSheet, axe: axeSheet, boat: boatSheet, ...sheets } });
  sayHelp();
  requestAnimationFrame(frame);
})();
