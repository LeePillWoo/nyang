// 게임 뼈대 — 캔버스·입력·장면 전환(필드 ↔ 던전)·소리·감정·불러오기.
// 필드는 field.ts(로직) / field-draw.ts(그리기), 던전은 dungeon.ts / dungeon-draw.ts.
import { assetUrl } from './assets.ts';
import { sfxChop, sfxHit, sfxHurt, sfxPop, sfxRow, sfxSplash, unlockAudio } from './audio.ts';
import { loadAxe, loadBoat, loadCat, loadSnow } from './cat.ts';
import { drawDungeon, dungeonReady, roomReady } from './dungeon-draw.ts';
import { makeDungeon, PLAYER, resetDungeon, updateDungeon, type Dungeon, type DungeonEvent } from './dungeon.ts';
import { emotesReady, quiet, say, saying, tickEmote, type EmoteId } from './emote.ts';
import { ENEMY_DEFS, type Kind } from './enemy.ts';
import { biomeAt, drawField, fieldFx, fieldReady, fieldView, terrainAt, terrainReady } from './field-draw.ts';
import { backFrom, FIELD, inWarp, makeFieldState, updateField, type FieldEvent, type FieldState, type Warp } from './field.ts';
import { ROOMS } from './iso.ts';
import { drawMinimap, fromMini, inMinimap, minimapPick, minimapRect, toMini } from './minimap.ts';
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
const query = new URLSearchParams(location.search);
let debug = query.has('grid');
let showTerrain = query.has('terrain'); // 필드 지형 보기 (T 키)
let showMap = true; // 필드 미니맵 (M 키)
let mapHover: Warp | null = null;

// ?trace — tools/verify.mjs 가 쓴다. 프레임마다 실제로 그린 사각형을 남겨 튐·사라짐을 잡는다.
const trace: Record<string, unknown>[] | null = query.has('trace') ? [] : null;
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
  if (e.code === 'KeyM') showMap = !showMap;
  if (e.code === 'KeyJ') punchQueued = true;
  if (e.code === 'KeyR' && scene === 'dungeon') {
    if (dungeon.phase === 'napped') leaveDungeon(); // GDD: 목숨을 다 쓰면 마을에서 깨어난다
    else {
      resetDungeon(dungeon);
      enteredRoom();
    }
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
// ── 필드 둘러보기 ── 큰 화면을 끌면 지도가 밀리고, 미니맵을 누르거나 끌면 카메라가 그쪽으로 슬라이드한다.
// 포탈(빛 원)을 누르면(끌지 않고) 고양이가 그 포탈로 워프. 둘러보는 중에 방향키를 누르면 카메라가 고양이에게 돌아온다.
/** 카메라가 보는 곳 (null = 고양이를 따라감). t = 슬라이드 목표, home = 고양이에게 돌아가는 중 */
let look: { x: number; y: number; tx: number; ty: number; home: boolean } | null = null;
let drag: { x: number; y: number; moved: boolean } | null = null;
let mapDrag = false;
const DRAG_PX = 5;
const pxRatio = () => Math.min(devicePixelRatio, 2);
/** 화면(CSS px) → 필드 월드 좌표 */
const toWorld = (px: number, py: number) => ({ x: (px * pxRatio() - fieldView.ox) / fieldView.sc, y: (py * pxRatio() - fieldView.oy) / fieldView.sc });
/** 카메라 중심이 지도 밖을 보지 않게 */
function clampCam(x: number, y: number) {
  const hw = canvas.width / fieldView.sc / 2;
  const hh = canvas.height / fieldView.sc / 2;
  const [W, H] = FIELD.size;
  return { x: Math.min(W - hw, Math.max(hw, x)), y: Math.min(H - hh, Math.max(hh, y)) };
}
function slideTo(x: number, y: number, instant = false) {
  const c = clampCam(x, y);
  if (!look) {
    const now = toWorld(innerWidth / 2, innerHeight / 2);
    look = { x: now.x, y: now.y, tx: c.x, ty: c.y, home: false };
  }
  Object.assign(look, { tx: c.x, ty: c.y, home: false }, instant ? { x: c.x, y: c.y } : {});
}
/** 화면 위치(CSS px)에 있는 포탈 — 빛 원·빛 기둥·이름표 언저리 */
function portalAt(px: number, py: number) {
  const p = toWorld(px, py);
  return (
    FIELD.warps.find(
      (w) => Math.abs(p.x - w.at[0]) < w.r * 1.4 && p.y > w.at[1] - 46 && p.y < w.at[1] + w.r * FIELD.vertical + 14,
    ) ?? null
  );
}
/** 캔버스 기준 마우스 위치 (CSS px). 캔버스 밖에서 버튼을 떼도 맞게 */
const pos = (e: MouseEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
const onMap = (e: MouseEvent) => scene === 'field' && showMap && inMinimap(minimapRect(innerWidth), pos(e).x, pos(e).y);
const mapPoint = (e: MouseEvent) => {
  const [x, y] = fromMini(minimapRect(innerWidth), pos(e).x, pos(e).y);
  slideTo(x, y);
};
canvas.addEventListener('mousedown', (e) => {
  unlockAudio();
  if (scene !== 'field') {
    punchQueued = true;
    return;
  }
  if (onMap(e)) {
    mapDrag = true;
    mapPoint(e);
  } else drag = { x: pos(e).x, y: pos(e).y, moved: false };
});
canvas.addEventListener('mousemove', (e) => {
  if (scene !== 'field') return;
  if (mapDrag) mapPoint(e);
  else if (drag) {
    const dx = pos(e).x - drag.x;
    const dy = pos(e).y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    drag.moved = true;
    drag.x = pos(e).x;
    drag.y = pos(e).y;
    const k = pxRatio() / fieldView.sc;
    const from = look ?? toWorld(innerWidth / 2, innerHeight / 2);
    slideTo(from.x - dx * k, from.y - dy * k, true);
  }
  const overMap = onMap(e);
  mapHover = overMap ? minimapPick(minimapRect(innerWidth), pos(e).x, pos(e).y) : null;
  canvas.style.cursor = drag?.moved ? 'grabbing' : overMap || portalAt(pos(e).x, pos(e).y) ? 'pointer' : 'grab';
});
addEventListener('mouseup', (e) => {
  if (drag && !drag.moved && scene === 'field') {
    const w = portalAt(pos(e).x, pos(e).y);
    if (w) warpTo(w);
  }
  drag = null;
  mapDrag = false;
});
/** 매 프레임: 슬라이드 · 방향키를 누르면 고양이에게 돌아가기 */
function stepLook(dt: number, moving: boolean) {
  if (!look) return;
  if (moving && !drag && !mapDrag) look.home = true;
  if (look.home) Object.assign(look, ((c) => ({ tx: c.x, ty: c.y }))(clampCam(field.camX, field.camY)));
  const k = 1 - Math.exp(-10 * dt);
  look.x += (look.tx - look.x) * k;
  look.y += (look.ty - look.y) * k;
  if (look.home && Math.hypot(look.tx - look.x, look.ty - look.y) < 1) look = null;
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const held = (...codes: string[]) => codes.some((c) => keys.has(c));
/** 화면 기준 방향 입력 -1..1 */
const input = () => ({
  mx: (held('KeyD', 'ArrowRight') ? 1 : 0) - (held('KeyA', 'ArrowLeft') ? 1 : 0),
  my: (held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0),
});

/** 몬스터 시트 — 방에 들어갈 때 그 방 몬스터 것만 불러온다 (51종을 처음에 다 받으면 20MB) */
const sheets = {} as Record<Kind, Sheet>;
const loading = new Map<Kind, Promise<Sheet>>();
function enemySheet(k: Kind) {
  let p = loading.get(k);
  if (!p) {
    p = loadSheet(assetUrl(ENEMY_DEFS[k].sheet), 6, 5).then((s) => (sheets[k] = s));
    loading.set(k, p);
  }
  return p;
}
/** 방 배경 + 그 방 몬스터 시트 */
const prepareRoom = (id: string) => Promise.all([roomReady(id), ...ROOMS[id].spawns.map(([k]) => enemySheet(k as Kind))]);

let catSheet: Sheet;
let axeSheet: Sheet;
let boatSheet: Sheet;
let snowSheet: Sheet;
let dungeon: Dungeon;

// 장면: 필드(시작) ↔ 던전. ?dungeon 이면 골목 던전에서, ?dungeon=<방 id> 면 그 방에서 바로 시작한다 (검증용)
const startRoom = query.get('dungeon') || 'alley';
let scene: 'field' | 'dungeon' = query.has('dungeon') ? 'dungeon' : 'field';
let field: FieldState = makeFieldState(FIELD.start);
let roomId = startRoom; // 지금 들어가 있는 던전
if (trace)
  Object.assign(window, {
    __game: {
      get scene() { return scene; },
      get field() { return field; },
      get cat() { return { x: dungeon.P.x, z: dungeon.P.z }; },
      get dungeon() { return dungeon; },
      get emote() { return saying(); },
      get sheets() { return sheets; },
      terrain: terrainAt,
      /** 미니맵에서 이정표 점의 화면 위치 (CSS px) */
      minimapPoint: (id: string) => {
        const w = FIELD.warps.find((v) => v.id === id)!;
        const [x, y] = toMini(minimapRect(innerWidth), w.at[0], w.at[1]);
        return { x, y };
      },
      get showMap() { return showMap; },
      get look() { return look; },
      /** 포탈의 화면 위치 (CSS px) */
      portalScreen: (id: string) => {
        const w = FIELD.warps.find((v) => v.id === id)!;
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fieldView.ox + w.at[0] * fieldView.sc) / d, y: (fieldView.oy + w.at[1] * fieldView.sc) / d };
      },
      biome: biomeAt,
      size: FIELD.size,
      /** 필드 고양이의 화면 위치 (CSS px) */
      get catScreen() {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fieldView.ox + field.x * fieldView.sc) / d, y: (fieldView.oy + field.y * fieldView.sc) / d };
      },
    },
    /** 모든 몬스터 시트를 불러와 행별 칸 수를 돌려준다 (검증용) */
    __allEnemySheets: async () =>
      Object.fromEntries(await Promise.all(Object.keys(ENEMY_DEFS).map(async (k) => [k, (await enemySheet(k)).frames.map((r) => r.length)]))),
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

// ── 감정 ── 고양이 머리 위 아이콘 (src/emote.ts). 상황이 바뀌는 순간에만 띄운다
const mood = {
  biome: '' as string,
  /** 지역 감정을 마지막으로 띄운 때 (지역마다) */
  biomeT: {} as Record<string, number>,
  boatT: 0,
  seasick: false,
  chops: 0,
  stillT: 0,
  portal: '' as string,
  lives: 0,
  scared: false,
  phase: '' as string,
};
function fieldMood(dt: number, now: number) {
  const b = field.mode === 'walk' || field.mode === 'axe' ? biomeAt(field.x, field.y) : '';
  if (b && b !== mood.biome && now - (mood.biomeT[b] ?? -99) > 20) {
    say(b === 'snow' ? 'cold' : 'heat', 2);
    mood.biomeT[b] = now;
  }
  mood.biome = b;
  if (field.mode === 'boat') {
    mood.boatT += dt;
    if (mood.boatT > 8 && !mood.seasick) {
      say('seasick', 2.2);
      mood.seasick = true;
    }
  } else if (field.mode === 'walk' || field.mode === 'axe') {
    mood.boatT = 0;
    mood.seasick = false;
  }
  for (const e of field.events) if (e.type === 'chop' && ++mood.chops % 5 === 0) say('exertion', 1.2);
  // 포탈 위: 연결된 곳이면 의욕, 아직 아니면 갸웃
  const w = FIELD.warps.find((v) => inWarp(v, field.x, field.y));
  if (w && w.id !== mood.portal) say(w.to ? 'determination' : 'question', 1.6);
  mood.portal = w?.id ?? '';
  mood.stillT = field.moving ? 0 : mood.stillT + dt;
  if (mood.stillT > 7) {
    say('sleep', 3);
    mood.stillT = 4;
  }
}
function dungeonMood() {
  const P = dungeon.P;
  for (const e of dungeon.events) {
    if (e.type === 'hurt') say('sweat', 1.2);
    else if (e.type === 'pop') say('pride', 1.3);
  }
  if (P.lives < mood.lives) say('dizzy', 2);
  mood.lives = P.lives;
  if (P.hp > 0 && P.hp < PLAYER.maxHp * 0.3 && !mood.scared) {
    say('fear', 2);
    mood.scared = true;
  } else if (P.hp >= PLAYER.maxHp * 0.3) mood.scared = false;
  if (dungeon.phase !== mood.phase) {
    if (dungeon.phase === 'cleared') say('delight', 3);
    else if (dungeon.phase === 'napped') say('sleep', 99);
    mood.phase = dungeon.phase;
  }
}
/** 방에 막 들어왔을 때 (리셋 포함) */
function enteredRoom() {
  mood.lives = dungeon.P.lives;
  mood.phase = dungeon.phase;
  mood.scared = false;
  quiet();
  say((dungeon.room.def.mood ?? 'determination') as EmoteId, 2);
}

// 장면 전환: 크림색으로 덮은 순간 장면을 바꾸고 다시 걷어낸다. 바꾸는 일이 불러오기를 기다리면 덮인 채로 기다린다
const FADE = 0.28;
let fade = 0;
let fadeTo: (() => void | Promise<void>) | null = null;
let swapping = false;
const goTo = (swap: () => void | Promise<void>) => {
  if (!fadeTo && fade === 0) fadeTo = swap;
};
const enterDungeon = (to: string) =>
  goTo(async () => {
    step(ROOMS[to].name);
    await prepareRoom(to);
    scene = 'dungeon';
    roomId = to;
    canvas.style.cursor = '';
    resetDungeon(dungeon, to);
    enteredRoom();
    sayHelp();
  });
/** 포탈 워프 — 포탈 위에 내린다. 한 번 벗어났다 들어와야 빨려 들어간다 (그 자리에서 바로 던전으로 가지 않음) */
const warpTo = (w: Warp) =>
  goTo(() => {
    field = makeFieldState(w.at, terrainAt);
    look = null;
    quiet();
    say('surprise', 1.2);
  });
const leaveDungeon = () =>
  goTo(() => {
    scene = 'field';
    field = makeFieldState(backFrom(roomId), terrainAt);
    look = null;
    quiet();
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
    if (fade >= 1 && !swapping) {
      swapping = true;
      const swap = fadeTo;
      Promise.resolve(swap()).finally(() => {
        fadeTo = null;
        swapping = false;
      });
    }
  } else if (fade > 0) fade = Math.max(0, fade - dt / FADE);

  // 덮이는 동안은 멈춘다
  if (!fadeTo) {
    if (scene === 'field') {
      const { mx, my } = input();
      stepLook(dt, mx !== 0 || my !== 0);
      const w = updateField(field, mx, my, dt, terrainAt);
      field.events.forEach(fieldSound);
      fieldFx(field.events);
      fieldMood(dt, now / 1000);
      if (w) enterDungeon(w.to);
    } else {
      const out = updateDungeon(dungeon, { ...input(), punch: punchQueued, dash: keys.has('Space') }, dt);
      dungeon.events.forEach(dungeonSound);
      dungeonMood();
      if (out === 'exit') leaveDungeon();
    }
    punchQueued = false;
    tickEmote(dt);
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
  drawField(ctx, canvas.width, canvas.height, field, { cat: catSheet, axe: axeSheet, boat: boatSheet, snow: snowSheet }, last / 1000, lastDt, showTerrain, look);
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
  if (showMap) {
    const sc = fieldView.sc;
    const view = { x: -fieldView.ox / sc, y: -fieldView.oy / sc, w: canvas.width / sc, h: canvas.height / sc };
    drawMinimap(ctx, minimapRect(innerWidth), field, view, mapHover, last / 1000);
  }
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
  field: 'WASD 이동 · 숲은 도끼로, 물은 배로 · 이정표 앞 포탈에 잠시 서 있으면 던전 · 지도 끌기·미니맵으로 둘러보기, 포탈 클릭 = 워프 · M 미니맵 · T 지형 보기',
  dungeon: 'WASD 이동 · 클릭/J 냥펀치 · Space 구르기 · 빛나는 칸으로 나가기 · G 격자',
};
function sayHelp() {
  help.textContent = HELP[scene];
}
const step = (t: string) => {
  help.textContent = t + ' 불러오는 중…';
};

(async () => {
  step('배경');
  await Promise.all([dungeonReady, fieldReady, emotesReady]);
  step('고양이 시트');
  catSheet = await loadCat();
  step('도끼·배·눈길 시트');
  [axeSheet, boatSheet, snowSheet] = await Promise.all([loadAxe(), loadBoat(), loadSnow()]);
  step('지형');
  await terrainReady;
  field = makeFieldState(FIELD.start, terrainAt);
  step('던전');
  await prepareRoom(startRoom);
  dungeon = makeDungeon(sheets, startRoom);
  if (scene === 'dungeon') enteredRoom();
  if (trace) Object.assign(window, { __sheets: { cat: catSheet, axe: axeSheet, boat: boatSheet, snow: snowSheet, ...sheets } });
  sayHelp();
  requestAnimationFrame(frame);
})();
