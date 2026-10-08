// 게임 뼈대 — 캔버스·입력·장면 전환(필드 ↔ 던전 · 낚시터)·소리·감정·불러오기.
// 필드는 field.ts(로직) / field-draw.ts(그리기), 던전은 dungeon.ts / dungeon-draw.ts, 낚시는 fishing.ts / fishing-draw.ts.
import { assetUrl, image } from './assets.ts';
import { bagLayout, bagTap, bagView, coinReady, drawBag, drawShop, flipPage, itemIconsReady, resetBagView, resetShopView, shopLayout, shopTap, shopView } from './bag-draw.ts';
import { count, fromSave, ITEMS, obtain, PAGE, stats, tickBuffs, type Bag } from './bag.ts';
import { bookLayout, bookTap, bookView, drawBook, groupOf, mapPoints, openBook, ungrouped, type BookData } from './book-draw.ts';
import shopData from './data/shop.json' with { type: 'json' };
import {
  sfxBite,
  sfxCast,
  sfxCatch,
  sfxCoin,
  sfxChop,
  sfxDrag,
  sfxDunk,
  sfxFull,
  sfxHit,
  sfxHurt,
  sfxJump,
  sfxSlide,
  sfxRush,
  sfxNibble,
  sfxPlop,
  sfxPickup,
  sfxPop,
  sfxReel,
  sfxRow,
  sfxSnap,
  sfxSplash,
  sfxBone,
  sfxBoom,
  sfxBox,
  sfxHiss,
  sfxLevel,
  sfxRing,
  sfxShield,
  sfxSnack,
  sfxSnare,
  sfxSpawn,
  sfxSwirl,
  sfxThrow,
  sfxThud,
  sfxWave,
  sfxZap,
  sfxWhale,
  sfxBreach,
  sfxGulp,
  sfxSpit,
  sfxRustle,
  sfxChirp,
  sfxBonk,
  unlockAudio,
} from './audio.ts';
import { cardAt, cardRects, drawCards, drawResult, resultButtonAt, resultPoint, skillFxReady, type ResultButton } from './skills-draw.ts';
import { learn as learnSkill, type SkillId } from './skills.ts';
import { loadAxe, loadBoat, loadCat, loadSnow } from './cat.ts';
import { drawDungeon, dungeonReady, roomReady, roomView } from './dungeon-draw.ts';
import { makeDungeon, maxHp, pick, resetDungeon, skipWaves, updateDungeon, type Dungeon, type DungeonEvent } from './dungeon.ts';
import { emotesReady, quiet, say, saying, tickEmote, type EmoteId } from './emote.ts';
import { ENEMY_DEFS, type Kind } from './enemy.ts';
import { biomeAt, drawField, fieldFx, fieldReady, fieldView, terrainAt, terrainReady } from './field-draw.ts';
import { backFrom, FIELD, inWarp, makeFieldState, spawnSquirrel, updateField, warpLocked, whaleSpit, type FieldEvent, type FieldState, type Warp } from './field.ts';
import {
  dexReady,
  drawFishing,
  fishingButtonAt,
  fishingButtonCenter,
  fishingFx,
  fishingHelp,
  fishingReady,
  fishingView,
  resetFishingFx,
  type FishingButton,
} from './fishing-draw.ts';
import { again, debugBite, makeFishing, normalizeDex, SPOTS, updateFishing, type Dex, type FishEvent, type FishingState } from './fishing.ts';
import { ROOMS } from './iso.ts';
import { drawMinimap, fromMini, inMinimap, minimapPick, minimapRect, toMini } from './minimap.ts';
import { drawMaze, mazeView } from './maze-draw.ts';
import { makeMaze, updateMaze, type MazeEvent, type MazeState } from './maze.ts';
import { miniButtonAt, miniLayout, type MiniButton } from './mini-draw.ts';
import { drawSandboard, SAND_IMAGES, sandPoint, warmSandboard, type SandArt } from './sandboard-draw.ts';
import { makeSandboard, SAND, updateSandboard, type SandEvent, type SandState } from './sandboard.ts';
import { loadSheet, type Sheet } from './sheet.ts';
import { drawTimber, timberFx } from './timber-draw.ts';
import { chaseFx, chaseView, drawChase } from './chase-draw.ts';
import { burn, drawVillage, drawVillagePanel, friendSheet, openVillagePanel, resetVillageView, villageKey, villagePoints, villageReady, villageTap, villageView, type VillageAct } from './village-draw.ts';
import { FRIENDS, fromVillageSave, hello, makeVillage, targetAtPoint, tickRequests, updateCook, updateVillage, walkTo, type VillageSave, type VillageState } from './village.ts';
import { CHASE, makeChase, updateChase, type ChaseEvent, type ChaseState } from './chase.ts';
import { makeTimber, TIMBER, updateTimber, type Side, type TimberEvent, type TimberState } from './timber.ts';
import { buttonAt, controls, drawControls, followStick, onStick, safe, stickBase, stickVector, ui, type ButtonId } from './touch.ts';

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
/** 레벨 업 카드에 마우스가 올라간 카드 · 결과창 버튼 */
let cardHover = -1;
let resultHover: ResultButton | null = null;
/** 샌드보드 점프 (이번 프레임) */
let jumpQueued = false;
/** 장작 패기 — 이번 프레임에 누른 쪽들 (차례대로) */
const chops: Side[] = [];
/** 마을: E · Space (이번 프레임에 말 걸기) */
let villageAct = false;
/** 가방 · 상점 창을 옆으로 밀어 쪽 넘기기 */
let panelSwipe: { id: number; x: number; y: number } | null = null;
addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.code === 'Space') e.preventDefault();
  // 도감 (B) · 가방 (I) — 열려 있는 동안은 다른 키를 먹는다 (Esc 는 창만 닫는다)
  const want = e.code === 'KeyB' ? 'dex' : e.code === 'KeyI' ? 'bag' : null;
  if (want && !e.repeat) {
    if (panel === want) return closePanel();
    if (!panel && (want === 'dex' ? dexAllowed() : bagAllowed())) return openPanel(want);
  }
  if (panel) {
    if (e.code === 'Escape') closePanel();
    else if ((panel === 'bag' || panel === 'shop') && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      if (flipPage(bag, e.code === 'ArrowLeft' ? -1 : 1) && panel === 'shop') shopView.pick = null;
    }
    return;
  }
  // 마을 창 (친구 · 가판대 · 요리 · 선물 카드) — 열려 있으면 키를 먹는다
  if (scene === 'village' && (villageView.panel || villageView.gifts.length)) {
    if (!e.repeat) onVillageAct(villageKey(e.code, village, vsave, bag, Date.now()));
    return;
  }
  // 결과창: Enter · Space · E · Esc = 필드로, R = 다시 도전 (다른 키는 먹는다)
  if (scene === 'dungeon' && dungeon.result) {
    if (['Enter', 'NumpadEnter', 'Space', 'KeyE', 'Escape'].includes(e.code)) backToField();
    else if (e.code === 'KeyR') retryRoom();
    return;
  }
  // 레벨 업 카드: 1 · 2 · 3 (숫자패드도). 고르는 동안 다른 키는 R(방 다시)만
  if (scene === 'dungeon' && dungeon.choose) {
    const n = /^(?:Digit|Numpad)([1-9])$/.exec(e.code)?.[1];
    if (n && pick(dungeon, Number(n) - 1)) {
      sfxPickup();
      cardHover = -1;
    }
    if (e.code !== 'KeyR') return;
  }
  keys.add(e.code);
  if (e.code === 'KeyG') debug = !debug;
  if (e.code === 'KeyT') showTerrain = !showTerrain;
  if (e.code === 'KeyM') showMap = !showMap;
  // R = 방 다시 (낮잠이면 곧 결과창이 뜬다 — 거기서 고른다)
  if (e.code === 'KeyR' && scene === 'dungeon' && dungeon.phase !== 'napped') retryRoom();
  if (scene === 'fishing') {
    if (e.code === 'Escape') backToField();
    if (e.code === 'Space' && !e.repeat) {
      fishKey = true;
      fishIn.pressed = true;
    }
  }
  if (scene === 'village') {
    if (e.code === 'Escape') backToField();
    else if (!e.repeat && (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter')) villageAct = true;
  }
  if (scene === 'timber') {
    if (e.code === 'Escape') backToField();
    else if (e.code === 'KeyR' && !e.repeat) restartMini();
    else if (!e.repeat && (e.code === 'KeyA' || e.code === 'ArrowLeft')) chops.push(-1);
    else if (!e.repeat && (e.code === 'KeyD' || e.code === 'ArrowRight')) chops.push(1);
  }
  if (scene === 'maze' || scene === 'sandboard' || scene === 'chase') {
    if (e.code === 'Escape') backToField();
    else if (e.code === 'KeyR' && !e.repeat && !inWhale()) restartMini(); // 고래 배 속은 다시 들어갈 수 없다
    else if (scene === 'sandboard' && (e.code === 'Space' || e.code === 'KeyW' || e.code === 'ArrowUp') && !e.repeat) jumpQueued = true;
  }
});
addEventListener('keyup', (e) => {
  keys.delete(e.code);
  if (e.code === 'Space' && fishKey) {
    fishKey = false;
    fishIn.released = true;
  }
});
addEventListener('blur', () => {
  keys.clear();
  fishKey = false;
  fishPtr = null;
  stick = null;
  pressing.clear();
});

// ── 낚시 입력 ── 화면을 누르고 있기 = Space 를 누르고 있기. 좌표는 낚시 배경 그림 좌표
const fishIn = { x: 0, y: 0, down: false, pressed: false, released: false };
/** 낚시에서 누르고 있는 손가락·마우스 (pointerId) */
let fishPtr: number | null = null;
let fishKey = false;
let fishHover: FishingButton = null;
/** 미니게임(미로 · 샌드보드) 버튼 위에 마우스 */
let miniHover: MiniButton = null;
const miniDone = () =>
  scene === 'maze'
    ? maze.phase === 'done'
    : scene === 'timber'
      ? timber.phase === 'done' && timber.doneT >= TIMBER.cardDelay // 장작 패기는 맞는 모습을 보여 준 뒤
      : scene === 'chase'
        ? chase.phase === 'done' && chase.doneT >= CHASE.cardDelay
      : sand.phase === 'done' && sand.doneT >= SAND.cardDelay; // 샌드보드는 결승 뒤 미끄러지다 카드가 뜬 뒤부터
/** 고래 배 속 미로 — 결과 카드에 다시 버튼이 없다 */
const inWhale = () => scene === 'maze' && maze.theme === 'whale';
const toFishing = (p: { x: number; y: number }) => ({
  x: (p.x * pxRatio() - fishingView.ox) / fishingView.sc,
  y: (p.y * pxRatio() - fishingView.oy) / fishingView.sc,
});

// ── 터치 ── 손가락을 한 번이라도 대면(또는 ?touch) 조이스틱·버튼을 띄운다. 손가락마다(pointerId) 따로 쫓는다
let touchOn = query.has('touch');
if (touchOn) document.body.classList.add('touch');
/**
 * 조이스틱을 쥔 손가락과 그 위치 · 조이스틱 받침 자리 (CSS px) — 누른 자리에 생기고 손가락이 멀어지면 따라온다.
 * sx, sy · t0 · moved = 처음 누른 자리 · 때 · 움직였나 (필드: 움직이지 않고 톡 누른 자리가 포탈이면 워프)
 */
let stick: { id: number; x: number; y: number; bx: number; by: number; sx: number; sy: number; t0: number; moved: boolean } | null = null;
const grabStick = (c: ReturnType<typeof ctl>, id: number, p: { x: number; y: number }) =>
  (stick = { id, ...p, ...stickBase(c, p.x, p.y, innerWidth, innerHeight), sx: p.x, sy: p.y, t0: performance.now(), moved: false });
/** 버튼을 누르고 있는 손가락 → 버튼 */
const pressing = new Map<number, ButtonId>();
const ctl = () => controls(innerWidth, innerHeight, scene, touchOn);

// ── 창: 물고기 도감 (필드 버튼 · 낚시터 도감 판 · B) · 가방 (필드·던전 버튼 · I). 열려 있는 동안 게임은 멈춘다
// 'dex' = 도감 (물고기 · 몬스터 · 아이템), 'shop' = 고등어 상점 (필드 강아지마을 포탈)
let panel: 'dex' | 'bag' | 'shop' | null = null;
const dexAllowed = () => !fadeTo && (scene !== 'fishing' || dexReady(fishing));
const bagAllowed = () => !fadeTo && (scene === 'field' || scene === 'dungeon' || (scene === 'village' && !villageView.panel && !villageView.gifts.length));
function openPanel(p: 'dex' | 'bag' | 'shop') {
  if (p === 'dex') scene === 'fishing' ? openBook('fish', fishing.spotId) : scene === 'dungeon' ? openBook('monster', groupOf(dungeon.enemies[0]?.kind ?? 'sword')) : openBook();
  if (p === 'bag') resetBagView();
  if (p === 'shop') resetShopView();
  panel = p;
  // 누르고 있던 것은 놓은 걸로
  keys.clear();
  fishKey = false;
  fishPtr = null;
  stick = null;
  drag = null;
  mapDrag = null;
  help.hidden = true; // 안내줄이 창을 덮지 않게
}
function closePanel() {
  panel = null;
  sayHelp();
}
/** 가방에서 먹은 회복약 — 던전 안에서 다쳤을 때만 */
const bagEnv = () => ({
  canHeal: scene === 'dungeon' && dungeon.phase !== 'napped' && dungeon.P.hp < maxHp(dungeon),
  heal: (n: number) => (dungeon.P.hp = Math.min(maxHp(dungeon), dungeon.P.hp + n)),
});
// ── 필드 둘러보기 ── 큰 화면을 끌면 지도가 밀리고, 미니맵을 누르거나 끌면 카메라가 그쪽으로 슬라이드한다.
// 포탈(빛 원)을 누르면(끌지 않고) 고양이가 그 포탈로 워프. 둘러보는 중에 방향키를 누르면 카메라가 고양이에게 돌아온다.
/** 카메라가 보는 곳 (null = 고양이를 따라감). t = 슬라이드 목표, home = 고양이에게 돌아가는 중 */
let look: { x: number; y: number; tx: number; ty: number; home: boolean } | null = null;
/** 큰 화면을 끄는 손가락·마우스 */
let drag: { id: number; x: number; y: number; moved: boolean } | null = null;
/** 미니맵을 끄는 손가락·마우스 */
let mapDrag: number | null = null;
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
      (w) => !warpLocked(w) && Math.abs(p.x - w.at[0]) < w.r * 1.4 && p.y > w.at[1] - 46 && p.y < w.at[1] + w.r * FIELD.vertical + 14,
    ) ?? null
  );
}
/** 캔버스 기준 포인터 위치 (CSS px) */
const pos = (e: PointerEvent) => {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
};
type Pt = { x: number; y: number };
const mapRect = () => minimapRect(innerWidth, innerHeight);
const onMap = (p: Pt) => scene === 'field' && showMap && inMinimap(mapRect(), p.x, p.y);
const mapPoint = (p: Pt) => {
  const [x, y] = fromMini(mapRect(), p.x, p.y);
  slideTo(x, y);
};
// 마우스·손가락·펜을 포인터 이벤트 하나로 받는다. 누른 포인터를 캔버스가 붙잡아서(capture) 밖에서 떼도 여기로 온다
canvas.addEventListener('pointerdown', (e) => {
  unlockAudio();
  if (e.pointerType === 'touch' && !touchOn) {
    touchOn = true;
    document.body.classList.add('touch');
    sayHelp();
  }
  canvas.setPointerCapture(e.pointerId);
  const p = pos(e);
  if (panel === 'dex') {
    if (bookTap(innerWidth, innerHeight, p.x, p.y) === 'close') closePanel();
    return;
  }
  if (scene === 'dungeon' && dungeon.result) {
    const b = resultButtonAt(innerWidth, innerHeight, p.x, p.y, Object.keys(dungeon.run.skills).length);
    if (b === 'leave') backToField();
    else if (b === 'retry') retryRoom();
    return;
  }
  if (scene === 'dungeon' && dungeon.choose) {
    const i = cardAt(innerWidth, innerHeight, p.x, p.y, dungeon.choose.length);
    if (i >= 0 && pick(dungeon, i)) {
      sfxPickup();
      cardHover = -1;
    }
    return;
  }
  if (panel === 'bag' || panel === 'shop') panelSwipe = { id: e.pointerId, ...p };
  if (panel === 'shop') {
    const r = shopTap(innerWidth, innerHeight, p.x, p.y, bag, SHOP.stock);
    if (r === 'close') closePanel();
    else if (r === 'changed') saveBag();
    return;
  }
  if (panel === 'bag') {
    const r = bagTap(innerWidth, innerHeight, p.x, p.y, bag, bagEnv());
    if (r === 'close') closePanel();
    else if (r === 'changed') saveBag();
    return;
  }
  if (scene === 'fishing') {
    if (fishPtr !== null) return; // 두 번째 손가락은 무시
    const f = toFishing(p);
    const btn = fishingButtonAt(fishing, f.x, f.y);
    if (btn === 'leave') backToField();
    else if (btn === 'again') again(fishing);
    else if (btn === 'dex') openPanel('dex');
    else {
      Object.assign(fishIn, f);
      fishPtr = e.pointerId;
      fishIn.pressed = true;
    }
    return;
  }
  if (scene === 'village') {
    if (villageView.panel || villageView.gifts.length) return onVillageAct(villageTap(innerWidth, innerHeight, p.x, p.y, village, vsave, bag, Date.now()));
    if (miniButtonAt(innerWidth, innerHeight, p.x, p.y, false) === 'leave') return backToField();
    const c = ctl();
    const b = buttonAt(c, p.x, p.y);
    if (b) {
      pressing.set(e.pointerId, b.id);
      if (b.id === 'bag' && bagAllowed()) openPanel('bag');
      return;
    }
    if (!stick && onStick(c, p.x, p.y)) return void grabStick(c, e.pointerId, p);
    return villageWalk(p);
  }
  if (scene === 'timber') {
    const btn = miniButtonAt(innerWidth, innerHeight, p.x, p.y, miniDone());
    if (btn === 'leave') return backToField();
    if (btn === 'again') return restartMini();
    const b = buttonAt(ctl(), p.x, p.y);
    if (b) pressing.set(e.pointerId, b.id);
    // ◀ ▶ 버튼, 아니면 누른 쪽 절반
    if (b?.id === 'left' || b?.id === 'right') chops.push(b.id === 'left' ? -1 : 1);
    else if (!b) chops.push(p.x < innerWidth / 2 ? -1 : 1);
    return;
  }
  if (scene === 'maze' || scene === 'sandboard' || scene === 'chase') {
    const btn = miniButtonAt(innerWidth, innerHeight, p.x, p.y, miniDone(), inWhale());
    if (btn === 'leave') return backToField();
    if (btn === 'again') return restartMini();
    const c = ctl();
    const b = buttonAt(c, p.x, p.y);
    if (b) {
      pressing.set(e.pointerId, b.id);
      if (b.id === 'jump') jumpQueued = true;
      return;
    }
    if (!stick && onStick(c, p.x, p.y)) {
      grabStick(c, e.pointerId, p);
      return;
    }
    if (scene === 'sandboard') jumpQueued = true; // 화면 아무 데나 누르면 점프
    return;
  }
  const c = ctl();
  const b = buttonAt(c, p.x, p.y);
  if (b) {
    pressing.set(e.pointerId, b.id);
    if (b.id === 'dex' && dexAllowed()) openPanel('dex');
    else if (b.id === 'bag' && bagAllowed()) openPanel('bag');
    return;
  }
  if (!stick && onStick(c, p.x, p.y)) {
    grabStick(c, e.pointerId, p);
    return;
  }
  if (scene === 'dungeon') return; // 냥펀치는 자동 · 낮잠이면 결과창의 버튼으로
  if (onMap(p)) {
    mapDrag = e.pointerId;
    mapPoint(p);
  } else if (!drag) drag = { id: e.pointerId, ...p, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  const p = pos(e);
  if (stick?.id === e.pointerId) {
    Object.assign(stick, p);
    if (Math.hypot(p.x - stick.sx, p.y - stick.sy) > DRAG_PX) stick.moved = true;
    followStick(ctl(), stick);
    return;
  }
  if (panel) return;
  if (scene === 'dungeon' && dungeon.result) {
    resultHover = resultButtonAt(innerWidth, innerHeight, p.x, p.y, Object.keys(dungeon.run.skills).length);
    if (e.pointerType === 'mouse') canvas.style.cursor = resultHover ? 'pointer' : '';
    return;
  }
  if (scene === 'dungeon' && dungeon.choose) {
    cardHover = cardAt(innerWidth, innerHeight, p.x, p.y, dungeon.choose.length);
    if (e.pointerType === 'mouse') canvas.style.cursor = cardHover >= 0 ? 'pointer' : '';
    return;
  }
  if (scene === 'fishing') {
    if (fishPtr !== null && fishPtr !== e.pointerId) return;
    const f = toFishing(p);
    Object.assign(fishIn, f);
    fishHover = fishingButtonAt(fishing, f.x, f.y);
    canvas.style.cursor = fishHover ? 'pointer' : '';
    return;
  }
  if (scene === 'maze' || scene === 'sandboard' || scene === 'timber' || scene === 'chase' || scene === 'village') {
    miniHover = miniButtonAt(innerWidth, innerHeight, p.x, p.y, miniDone(), inWhale());
    if (e.pointerType === 'mouse') canvas.style.cursor = miniHover ? 'pointer' : '';
    return;
  }
  if (scene !== 'field') return;
  if (mapDrag === e.pointerId) mapPoint(p);
  else if (drag?.id === e.pointerId) {
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_PX) return;
    drag.moved = true;
    drag.x = p.x;
    drag.y = p.y;
    const k = pxRatio() / fieldView.sc;
    const from = look ?? toWorld(innerWidth / 2, innerHeight / 2);
    slideTo(from.x - dx * k, from.y - dy * k, true);
  }
  const overMap = onMap(p);
  mapHover = overMap ? minimapPick(mapRect(), p.x, p.y) : null;
  if (e.pointerType === 'mouse')
    canvas.style.cursor = drag?.moved ? 'grabbing' : overMap || buttonAt(ctl(), p.x, p.y) || portalAt(p.x, p.y) ? 'pointer' : 'grab';
});
function release(e: PointerEvent) {
  if (stick?.id === e.pointerId) {
    // 필드: 조이스틱 영역이어도 움직이지 않고 톡 누른 자리가 포탈이면 워프 (영역 안에서도 포탈을 누를 수 있게)
    const tap = !stick.moved && performance.now() - stick.t0 < 350 && e.type === 'pointerup';
    const at = { x: stick.sx, y: stick.sy };
    stick = null;
    const w = tap && scene === 'field' ? portalAt(at.x, at.y) : null;
    if (w) warpTo(w);
    if (tap && scene === 'village') villageWalk(at); // 조이스틱 자리라도 톡 누르면 그리로 걸어간다
  }
  if (panelSwipe?.id === e.pointerId) {
    const q = pos(e);
    const [dx, dy] = [q.x - panelSwipe.x, q.y - panelSwipe.y];
    if (e.type === 'pointerup' && (panel === 'bag' || panel === 'shop') && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (flipPage(bag, dx < 0 ? 1 : -1) && panel === 'shop') shopView.pick = null;
    }
    panelSwipe = null;
  }
  pressing.delete(e.pointerId);
  if (fishPtr === e.pointerId) {
    fishPtr = null;
    fishIn.released = true;
  }
  if (drag?.id === e.pointerId) {
    // 끌지 않고 뗐으면 포탈 누르기 = 워프
    if (!drag.moved && scene === 'field' && e.type === 'pointerup') {
      const w = portalAt(pos(e).x, pos(e).y);
      if (w) warpTo(w);
    }
    drag = null;
  }
  if (mapDrag === e.pointerId) mapDrag = null;
  if (e.pointerType !== 'mouse') mapHover = null; // 손가락은 떼면 가리킨 이름도 지운다
}
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
/** 매 프레임: 슬라이드 · 방향키를 누르면 고양이에게 돌아가기 */
function stepLook(dt: number, moving: boolean) {
  if (!look) return;
  if (moving && !drag && mapDrag === null) look.home = true;
  if (look.home) Object.assign(look, ((c) => ({ tx: c.x, ty: c.y }))(clampCam(field.camX, field.camY)));
  const k = 1 - Math.exp(-10 * dt);
  look.x += (look.tx - look.x) * k;
  look.y += (look.ty - look.y) * k;
  if (look.home && Math.hypot(look.tx - look.x, look.ty - look.y) < 1) look = null;
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

const held = (...codes: string[]) => codes.some((c) => keys.has(c));
/** 화면 기준 방향 입력 -1..1 — 키보드 + 조이스틱 */
function input() {
  const v = stick ? stickVector(ctl(), stick) : { mx: 0, my: 0 };
  const clamp = (a: number) => Math.max(-1, Math.min(1, a));
  const btn = [...pressing.values()];
  return {
    mx: clamp((held('KeyD', 'ArrowRight') || btn.includes('right') ? 1 : 0) - (held('KeyA', 'ArrowLeft') || btn.includes('left') ? 1 : 0) + v.mx),
    my: clamp((held('KeyS', 'ArrowDown') ? 1 : 0) - (held('KeyW', 'ArrowUp') ? 1 : 0) + v.my),
  };
}

/** 몬스터 시트 — 방에 들어갈 때 그 방 몬스터 것만 불러온다 (65종을 처음에 다 받으면 25MB) */
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
const prepareRoom = (id: string) => Promise.all([roomReady(id), skillFxReady, ...ROOMS[id].spawns.map(([k]) => enemySheet(k as Kind))]);

let catSheet: Sheet;
let axeSheet: Sheet;
let boatSheet: Sheet;
let snowSheet: Sheet;
let dungeon: Dungeon;

// 장면: 필드(시작) ↔ 던전 · 낚시터. ?dungeon 이면 골목 던전에서, ?dungeon=<방 id> 면 그 방에서,
// ?fishing 이면 호수섬 낚시터에서 바로 시작한다 (검증용)
// ?maze · ?sandboard 면 그 미니게임에서 바로 시작한다 (검증용)
const startRoom = query.get('dungeon') || 'alley';
const startSpot = query.get('fishing') || 'lake_island_fishing';
let scene: 'field' | 'dungeon' | 'fishing' | 'maze' | 'sandboard' | 'timber' | 'chase' | 'village' = query.has('dungeon')
  ? 'dungeon'
  : query.has('fishing')
    ? 'fishing'
    : query.has('maze')
      ? 'maze'
      : query.has('sandboard')
        ? 'sandboard'
        : query.has('timber')
          ? 'timber'
          : query.has('chase')
            ? 'chase'
            : query.has('village')
              ? 'village'
              : 'field';
let field: FieldState = makeFieldState(FIELD.start);
// 지금 들어가 있는 던전·낚시터·미니게임 (나오면 그 포탈 앞으로)
let roomId = scene === 'fishing' ? startSpot : scene === 'maze' || scene === 'sandboard' || scene === 'timber' || scene === 'chase' || scene === 'village' ? scene : startRoom;
let maze: MazeState = makeMaze();
let sand: SandState = makeSandboard();
let timber: TimberState = makeTimber();
let chase: ChaseState = makeChase();
let village: VillageState = makeVillage();

// 고양이마을 친구 기록 — 하트 · 입맛 · 부탁 · 아는 요리법. ponytail: localStorage (저장 M2 때 세이브로)
const VILLAGE_KEY = 'nyang.village.v1';
const vsave: VillageSave = (() => {
  try {
    return fromVillageSave(JSON.parse(localStorage.getItem(VILLAGE_KEY) ?? 'null'), Date.now());
  } catch {
    return fromVillageSave(null, Date.now());
  }
})();
function saveVillage() {
  try {
    localStorage.setItem(VILLAGE_KEY, JSON.stringify(vsave));
  } catch {
    // 이번 판만
  }
}

// 낚시 도감 — ponytail: 브라우저 localStorage. 저장(IndexedDB, M2)을 붙이면 세이브의 fishDex 로 옮긴다 (GDD 10장)
const DEX_KEY = 'nyang.fishDex.v1';
function loadDex(): Dex {
  try {
    return normalizeDex(JSON.parse(localStorage.getItem(DEX_KEY) ?? '{}') as Dex);
  } catch {
    return {};
  }
}
function saveDex(d: Dex) {
  try {
    localStorage.setItem(DEX_KEY, JSON.stringify(d));
  } catch {
    // 저장이 막힌 창(시크릿 등)이면 이번 판만 기억한다
  }
}
/** 도감 — 한 번 읽어 낚시터들과 도감 화면이 같이 쓴다 (낚으면 바로 보인다) */
const dex = loadDex();

// 가방 (냥코인·아이템·장비·먹은 것) — 도감처럼 localStorage. 던전이 같은 가방에 주운 걸 넣는다
const BAG_KEY = 'nyang.bag.v1';
const bag: Bag = (() => {
  try {
    return fromSave(JSON.parse(localStorage.getItem(BAG_KEY) ?? 'null'));
  } catch {
    return fromSave(null);
  }
})();
function saveBag() {
  try {
    localStorage.setItem(BAG_KEY, JSON.stringify(bag));
  } catch {
    // 저장이 막힌 창이면 이번 판만
  }
}
// 몬스터 도감 — 종마다 쓰러뜨린 수
const MON_KEY = 'nyang.monsters.v1';
const monDex: Record<string, number> = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(MON_KEY) ?? '{}');
    return Object.fromEntries(Object.entries(v).filter(([k, n]) => ENEMY_DEFS[k] && Number.isFinite(n) && (n as number) > 0)) as Record<string, number>;
  } catch {
    return {};
  }
})();
function saveMonDex() {
  try {
    localStorage.setItem(MON_KEY, JSON.stringify(monDex));
  } catch {
    // 이번 판만
  }
}
const SHOP = shopData as { name: string; greet: string; stock: string[] };
/** 도감이 보는 기록 — 몬스터 그림은 처음 볼 때 불러온다 */
const bookData = (): BookData => ({
  fish: dex,
  monsters: monDex,
  found: bag.found,
  held: (id) => count(bag, id) + (Object.values(bag.equip).includes(id) ? 1 : 0),
  sheet: (k) => sheets[k] ?? (enemySheet(k), null),
  records,
  village: vsave,
  here: [field.x, field.y],
});

// 미니게임 기록 — 미로 최단 시간(초) · 고래 배 속 최단 시간(초) · 샌드보드 최고 점수 · 장작 패기 최고 토막 · 다람쥐 잡기 최고 점수
const REC_KEY = 'nyang.minigames.v1';
const records: { maze: number | null; whale: number | null; sandboard: number | null; timber: number | null; chase: number | null } = (() => {
  const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);
  try {
    const v = JSON.parse(localStorage.getItem(REC_KEY) ?? '{}') as Partial<Record<'maze' | 'whale' | 'sandboard' | 'timber' | 'chase', unknown>>;
    return { maze: num(v.maze), whale: num(v.whale), sandboard: num(v.sandboard), timber: num(v.timber), chase: num(v.chase) };
  } catch {
    return { maze: null, whale: null, sandboard: null, timber: null, chase: null };
  }
})();
function saveRecords() {
  try {
    localStorage.setItem(REC_KEY, JSON.stringify(records));
  } catch {
    // 이번 판만
  }
}

/** 낚싯대·릴의 감기·줄 강도 */
const gear = () => ((s) => ({ reel: s.reel, line: s.line, luck: s.luck }))(stats(bag));

let fishing: FishingState = makeFishing(startSpot, dex, Math.random, gear());
[fishIn.x, fishIn.y] = fishing.spot.defaultCast;
if (trace)
  Object.assign(window, {
    __game: {
      get scene() { return scene; },
      get field() { return field; },
      get cat() { return { x: dungeon.P.x, z: dungeon.P.z }; },
      get dungeon() { return dungeon; },
      /** 레벨 업 카드 고르기 · 웨이브 건너뛰기 · 기술 배우기 (검증용) */
      pick: (i: number) => pick(dungeon, i),
      skipWaves: () => skipWaves(dungeon),
      learnSkill: (id: SkillId, n = 1) => {
        for (let i = 0; i < n; i++) learnSkill(dungeon.run, id);
      },
      /** 결과창 버튼 가운데 (CSS px) */
      resultPoint: (id: ResultButton) => resultPoint(innerWidth, innerHeight, id, Object.keys(dungeon.run.skills).length),
      /** 카드 i 의 가운데 (CSS px) */
      cardPoint: (i: number) => {
        const r = cardRects(innerWidth, innerHeight, dungeon.choose?.length ?? 3).cards[i];
        return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      },
      get emote() { return saying(); },
      get sheets() { return sheets; },
      terrain: terrainAt,
      /** 미니맵에서 이정표 점의 화면 위치 (CSS px) */
      minimapPoint: (id: string) => {
        const w = FIELD.warps.find((v) => v.id === id)!;
        const [x, y] = toMini(mapRect(), w.at[0], w.at[1]);
        return { x, y };
      },
      /** 조이스틱·버튼 자리 (CSS px) */
      get controls() { return ctl(); },
      /** 쥐고 있는 조이스틱 (손가락 x, y · 받침 bx, by — CSS px) */
      get stick() { return stick; },
      /** 던전 고양이의 화면 위치 (CSS px) — 작은 화면에선 방이 고양이를 따라 움직인다 */
      get dungeonCat() {
        const d = Math.min(devicePixelRatio, 2);
        const v = roomView(canvas.width, canvas.height, dungeon);
        const p = dungeon.room.toScreen(dungeon.P.x, dungeon.P.z);
        return { x: (v.ox + p.sx * v.scale) / d, y: (v.oy + p.sy * v.scale) / d, scale: v.scale / d };
      },
      get touch() { return touchOn; },
      get dexOpen() { return panel === 'dex'; },
      get bagOpen() { return panel === 'bag'; },
      get shopOpen() { return panel === 'shop'; },
      /** 도감에서 지금 보는 물고기 낚시터 탭 */
      get dexTab() { return bookView.tab.fish; },
      book: bookView,
      dex,
      bag,
      monsters: monDex,
      get maze() { return maze; },
      get sandboard() { return sand; },
      get timber() { return timber; },
      get chase() { return chase; },
      get village() { return village; },
      villageSave: vsave,
      villageView,
      /** 마을 지도 좌표 (x, y) 의 화면 위치 (CSS px) */
      villageScreen: (x: number, y: number) => {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (villageView.ox + x * villageView.sc) / d, y: (villageView.oy + y * villageView.sc) / d };
      },
      /** 가방 화면 상태 (보는 쪽 page · 고른 것 pick) */
      bagView,
      /** 마을 창에서 누를 곳 (CSS px) */
      villagePoints: () => villagePoints(innerWidth, innerHeight),
      /** 다람쥐 잡기 공터 좌표 (x, y) 의 화면 위치 (CSS px) */
      chaseScreen: (x: number, y: number) => {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (chaseView.ox + x * chaseView.sc) / d, y: (chaseView.oy + y * chaseView.sc) / d };
      },
      /** 장작 패기 한 번 (검증용 — 키 대신) */
      chop: (side: Side) => chops.push(side),
      /** (x, y) 수풀에서 다람쥐가 튀어나온다 · 부스럭 수풀을 하나 둔다 (검증용) */
      squirrel: (x: number, y: number) => spawnSquirrel(field, x, y, terrainAt, Math.random),
      rustle: (x: number, y: number) => field.rustles.push({ x, y, t: 0 }),
      records,
      /** 미로 칸 (cx, cz) 가운데의 화면 위치 (CSS px) */
      mazeScreen: (cx: number, cz: number) => {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (mazeView.ox + (cx + 0.5) * mazeView.px) / d, y: (mazeView.oy + (cz + 0.5) * mazeView.px) / d };
      },
      /** 샌드보드 가로 자리 x · 거리 dd 의 화면 위치 (CSS px — sandboard-draw.ts 와 같은 식, 카메라 포함) */
      sandScreen: (x: number, dd: number) => {
        const d = Math.min(devicePixelRatio, 2);
        const p = sandPoint(x, dd - sand.d);
        return { x: p.x / d, y: p.y / d };
      },
      /** 미니게임 버튼(돌아가기 · 다시 · 카드의 돌아가기) 가운데 (CSS px) */
      miniScreen: () => {
        const L = miniLayout(innerWidth, innerHeight);
        const mid = (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
        return { leave: mid(L.leave), again: mid(L.again), back: mid(L.back), solo: mid(L.solo) };
      },
      /** 지역이 없어 도감에 안 나오는 몬스터 */
      ungrouped,
      /** 가방 화면의 칸 · 장비 칸 · 버튼 · 닫기 가운데 (CSS px) */
      bagScreen: () => {
        const L = bagLayout(innerWidth, innerHeight, bag.slots.length);
        const mid = (r: { x: number; y: number; w: number; h: number }) => ({ x: L.ox + (r.x + r.w / 2) * L.k, y: L.oy + (r.y + r.h / 2) * L.k });
        return { cells: L.cells.map(mid), slots: L.slots.map(mid), main: mid(L.main), drop: mid(L.drop), close: mid(L.close), prev: mid(L.prev), next: mid(L.next) };
      },
      /** 도감 화면의 갈래 · 탭 · 칸 · 닫기 가운데 (CSS px) */
      dexScreen: () => {
        const L = bookLayout(innerWidth, innerHeight);
        const mid = (r: { x: number; y: number; w: number; h: number }) => ({ x: L.ox + (r.x + r.w / 2) * L.k, y: L.oy + (r.y + r.h / 2) * L.k });
        return { chips: L.chips.map(mid), tabs: L.tabs.map(mid), cells: L.cells.map(mid), close: mid(L.close) };
      },
      /** 도감 지도 갈래의 장소 점 · 판의 줄 · 목록으로 버튼 (CSS px) */
      mapPoints: () => mapPoints(innerWidth, innerHeight),
      /** 상점 화면의 사기/팔기 · 칸 · 버튼 · 닫기 가운데 (CSS px) */
      shopScreen: () => {
        const L = shopLayout(innerWidth, innerHeight, shopView.mode === 'buy' ? SHOP.stock.length : bag.slots.slice(bagView.page * PAGE, (bagView.page + 1) * PAGE).length);
        const mid = (r: { x: number; y: number; w: number; h: number }) => ({ x: L.ox + (r.x + r.w / 2) * L.k, y: L.oy + (r.y + r.h / 2) * L.k });
        return { modes: L.modes.map(mid), cells: L.cells.map(mid), main: mid(L.main), drop: mid(L.drop), close: mid(L.close) };
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
      get fishing() { return fishing; },
      /** 낚시 배경 그림 좌표 → 화면 위치 (CSS px) */
      fishScreen: (x: number, y: number) => {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fishingView.ox + x * fishingView.sc) / d, y: (fishingView.oy + y * fishingView.sc) / d };
      },
      /** 낚시 버튼 가운데 (CSS px) — 판이 화면 모서리에 붙어 그림 좌표만으론 못 찾는다 */
      fishButton: (id: 'leave' | 'dex' | 'again' | 'popupLeave') => {
        const [x, y] = fishingButtonCenter(fishing, id);
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fishingView.ox + x * fishingView.sc) / d, y: (fishingView.oy + y * fishingView.sc) / d };
      },
      /** 이 종(또는 아이템 = 가라앉은 물건)이 지금 찌를 문다 — 찌가 팍 잠기는 순간 (검증용) */
      bite: (kind: string) => debugBite(fishing, kind),
      /** 필드 고양이의 화면 위치 (CSS px) */
      get catScreen() {
        const d = Math.min(devicePixelRatio, 2);
        return { x: (fieldView.ox + field.x * fieldView.sc) / d, y: (fieldView.oy + field.y * fieldView.sc) / d };
      },
    },
    /** 모든 몬스터 시트를 불러와 행별 칸 수 · 그림이 옆 컷과 맞붙은 칸을 돌려준다 (검증용) */
    __allEnemySheets: async () =>
      Object.fromEntries(
        await Promise.all(
          Object.keys(ENEMY_DEFS).map(async (k) => {
            const s = await enemySheet(k);
            return [k, { rows: s.frames.map((r) => r.length), joined: s.joined }];
          }),
        ),
      ),
  });

/** 숲에서 나온 것 → 가방 (못 넣으면 full — 그리기가 보고 떨어뜨린다) · 잡힌 다람쥐가 내놓은 냥코인 */
function fieldLoot(e: FieldEvent) {
  if (e.type === 'forage') e.full = obtain(bag, e.id) > 0;
  else if (e.type === 'squirrel' && e.what === 'caught' && e.stash) {
    bag.coins += e.stash.coins;
    e.full = e.stash.items.map((id) => obtain(bag, id)).some((left) => left > 0);
  } else return;
  saveBag();
}
/** 필드 연출 사건 → 소리 */
function fieldSound(e: FieldEvent) {
  if (e.type === 'chop') sfxChop();
  else if (e.type === 'forage') (e.full ? sfxFull : sfxPickup)();
  else if (e.type === 'rustle' && e.what === 'start') sfxRustle();
  else if (e.type === 'squirrel') {
    if (e.what === 'appear') sfxChirp();
    else if (e.what === 'throw') sfxThrow();
    else if (e.what === 'bonk') sfxBonk();
    else if (e.what === 'caught') sfxCatch();
    else if (e.what === 'escape') sfxPop();
  }
  else if (e.type === 'splash') sfxSplash();
  else if (e.type === 'stroke') sfxRow();
  else if (e.type === 'whale') {
    if (e.what === 'near') sfxWhale();
    else if (e.what === 'breach') sfxBreach();
    else if (e.what === 'gulp') sfxGulp();
    else if (e.what === 'spit') sfxSpit();
    else if (e.what === 'dive') sfxSplash();
  }
}
/** 던전 사건 → 소리 */
function dungeonSound(e: DungeonEvent) {
  if (e.type === 'hit') sfxHit(e.finish);
  else if (e.type === 'pop') {
    sfxPop();
    monDex[e.kind] = (monDex[e.kind] ?? 0) + 1; // 몬스터 도감
    saveMonDex();
  }
  else if (e.type === 'hurt') sfxHurt();
  else if (e.type === 'loot') (e.coin ? sfxCoin : sfxPickup)();
  else if (e.type === 'full') sfxFull();
  else if (e.type === 'skill') once(e.sound, SKILL_SFX[e.sound]);
  else if (e.type === 'bone') once('bone', sfxBone);
  else if (e.type === 'snack') sfxSnack();
  else if (e.type === 'level') sfxLevel();
  else if (e.type === 'wave') sfxWave(e.clear);
  else if (e.type === 'spawn') once(e.elite ? 'elite' : 'spawn', () => sfxSpawn(e.elite));
  else if (e.type === 'result' && e.win) sfxLevel();
}
/** 같은 소리가 한꺼번에 몰리지 않게 (70ms 에 한 번) */
const lastSfx = new Map<string, number>();
function once(id: string, play: () => void) {
  const now = performance.now();
  if (now - (lastSfx.get(id) ?? 0) < 70) return;
  lastSfx.set(id, now);
  play();
}
const SKILL_SFX = { throw: sfxThrow, boom: sfxBoom, zap: sfxZap, shield: sfxShield, hiss: sfxHiss, thud: sfxThud, snare: sfxSnare, swirl: sfxSwirl, ring: sfxRing, box: sfxBox };
/** 낚시 사건 → 소리 · 감정 */
function fishingEvent(e: FishEvent) {
  switch (e.type) {
    case 'cast':
      sfxCast();
      break;
    case 'splash':
      sfxPlop();
      say('focus', 1.5);
      break;
    case 'nibble':
      sfxNibble(e.strength);
      break;
    case 'dunk':
      sfxDunk();
      break;
    case 'abandon':
      say('sweat', 1.4);
      break;
    case 'nudge':
      sfxDrag();
      break;
    case 'bite':
      sfxBite();
      say('surprise', 0.8);
      break;
    case 'jump':
      sfxSplash();
      say('surprise', 0.7);
      break;
    case 'zig':
      sfxRow();
      break;
    case 'hook':
      sfxSplash();
      if (e.perfect) say('determination', 1.2);
      break;
    case 'run':
      sfxSplash();
      say('exertion', 1);
      break;
    case 'tired':
      say('idea', 1.2);
      break;
    case 'reelin':
      sfxReel();
      break;
    case 'caught':
      sfxCatch();
      if (e.catch.item) {
        // 건진 물건 → 가방 (팝업이 같은 catch 를 보고 NEW · 가득 참을 그린다)
        e.catch.isNew = !bag.found[e.catch.kind];
        e.catch.full = obtain(bag, e.catch.kind) > 0;
        saveBag();
        say(e.catch.full ? 'frustration' : e.catch.isNew ? 'treasure_temptation' : 'pride', 2.4);
      } else {
        say(e.catch.isNew ? 'delight' : 'pride', 2.4);
        saveDex(dex);
        // 낚은 물고기는 요리 재료로 (월척은 둘) — 고양이마을 요리 가판대에서 쓴다
        const n = e.catch.big ? 2 : 1;
        const left = obtain(bag, 'cook_fish', n);
        Object.assign(e.catch, { food: n - left, foodFull: left > 0 });
        saveBag();
      }
      break;
    case 'fail':
      if (e.reason === 'snap') sfxSnap();
      else sfxSplash();
      say('frustration', 1.8);
      break;
    case 'legend':
      sfxPop();
      say('dazzled', 2);
      break;
    case 'bored':
      say('question', 1.6);
      break;
  }
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
  /** 미개방 구역에 부딪혀 갸웃한 때 (초) */
  lockT: -9,
  /** 부스럭 소리에 귀 쫑긋한 때 (초) */
  rustleT: -9,
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
  // 숲: 부스럭 소리엔 귀 쫑긋(가끔) · 나오면 반가움(귀한 건 반짝) · 다람쥐엔 깜짝 · 콩 맞으면 버럭 · 잡으면 뿌듯 · 놓치면 분함
  for (const e of field.events) {
    if (e.type === 'rustle' && e.what === 'start' && now - mood.rustleT > 8) {
      say('listening', 1.4);
      mood.rustleT = now;
    } else if (e.type === 'forage') say(e.full ? 'frustration' : (ITEMS[e.id]?.price ?? 0) >= 30 ? 'treasure_temptation' : 'delight', 1.4);
    else if (e.type === 'squirrel') {
      if (e.what === 'appear') say('surprise', 1);
      else if (e.what === 'bonk') say('anger', 1.2);
      else if (e.what === 'caught') say('pride', 2);
      else if (e.what === 'escape') say('frustration', 1.6);
    }
  }
  // 포탈 위: 낚시터면 군침, 던전이면 의욕, 아직 연결 전이면 갸웃
  const w = FIELD.warps.find((v) => inWarp(v, field.x, field.y));
  if (w && w.id !== mood.portal)
    say(SPOTS[w.to] ? 'hunger' : w.to === 'shop' || w.to === 'village' ? 'delight' : w.to === 'maze' ? 'idea' : w.to === 'sandboard' ? 'rhythm' : w.to === 'timber' ? 'exertion' : w.to === 'chase' ? 'suspicion' : w.to ? 'determination' : 'question', 1.6);
  mood.portal = w?.id ?? '';
  // 미개방 구역으로 밀면 갸웃 (2.5초에 한 번)
  if (field.events.some((e) => e.type === 'locked') && now - mood.lockT > 2.5) {
    say('question', 1.4);
    mood.lockT = now;
  }
  // 고래: 그림자엔 갸웃(수상해) · 사라지면 휴 · 솟구치면 깜짝 · 뱉어 내면 어질어질
  for (const e of field.events)
    if (e.type === 'whale') {
      if (e.what === 'near') say('suspicion', 2.4);
      else if (e.what === 'gone') say('relief', 1.5);
      else if (e.what === 'rise') say('surprise', 1.4);
      else if (e.what === 'spit') say('dizzy', 2.6);
    }
  // 고래가 맴도는 동안은 졸지 않는다
  mood.stillT = field.moving || field.whale.phase !== 'none' ? 0 : mood.stillT + dt;
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
    else if (e.type === 'level') say('delight', 1.6);
    else if (e.type === 'wave') say(e.clear ? 'pride' : 'determination', 1.6);
    else if (e.type === 'spawn' && e.elite) say('danger', 2);
    else if (e.type === 'snack') say('heart', 1.2);
    else if (e.type === 'result' && e.win) say('pride', 99);
  }
  if (P.lives < mood.lives) say('dizzy', 2);
  mood.lives = P.lives;
  if (P.hp > 0 && P.hp < maxHp(dungeon) * 0.3 && !mood.scared) {
    say('fear', 2);
    mood.scared = true;
  } else if (P.hp >= maxHp(dungeon) * 0.3) mood.scared = false;
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
const enterFishing = (to: string) =>
  goTo(async () => {
    step(SPOTS[to].name + ' 낚시터');
    await fishingReady(to);
    scene = 'fishing';
    roomId = to;
    canvas.style.cursor = '';
    fishing = makeFishing(to, dex, Math.random, gear());
    [fishIn.x, fishIn.y] = fishing.spot.defaultCast; // 마우스를 안 움직이고 Space 로 던지면 여기로
    resetFishingFx();
    quiet();
    say((fishing.spot.mood ?? 'focus') as EmoteId, 1.6);
    sayHelp();
  });
/** 피라미드 미로 — 매번 새 미로 */
const enterMaze = () =>
  goTo(() => {
    scene = 'maze';
    roomId = 'maze';
    canvas.style.cursor = '';
    maze = makeMaze();
    miniHover = null;
    quiet();
    say('focus', 1.6);
    sayHelp();
  });
/** 고래 배 속 미로 — 바다에서 고래에게 삼켜졌다. 나오면(탈출 · 포기) 그 자리로 뱉어 낸다 (backToField) */
const enterWhale = () =>
  goTo(() => {
    scene = 'maze';
    roomId = 'whale';
    canvas.style.cursor = '';
    maze = makeMaze(Math.random, 'whale');
    miniHover = null;
    quiet();
    say('dizzy', 1.8);
    sayHelp();
  });
/**
 * 샌드보드 그림 (배경 3장 + 시트 5장) — 처음 들어갈 때 한 번. 미리 풀어 둔 ImageBitmap 으로 (그냥 Image 는 처음 그리는 순간 풀려서 멈칫했다),
 * 화면이 가려진 동안 warmSandboard 로 바닥 무늬 · 보드 자리 · 그래픽 카드 올리기까지 해 두고 두 프레임 기다린다
 */
const sandArt: SandArt = {};
const loadSandArt = async () => {
  await Promise.all(SAND_IMAGES.map(async (p) => (sandArt[p] ??= await createImageBitmap(await image(p).ready))));
  warmSandboard(ctx, sandArt);
  // 첫 화면을 한 번 미리 그려 둔다 (화면은 가려져 있다) — 큰 그림 · 바닥 무늬를 그래픽 카드에 올리는 게 첫 프레임에 몰리지 않게
  drawSandboard(ctx, canvas.width, canvas.height, sand, sandArt, { t: performance.now() / 1000, touch: touchOn, hover: null, best: records.sandboard });
  for (let i = 0; i < 2; i++) await new Promise((r) => requestAnimationFrame(r));
};
/** 모래 미끄럼틀 샌드보드 — 그림을 먼저 불러온다 */
const enterSandboard = () =>
  goTo(async () => {
    step('모래 미끄럼틀');
    sand = makeSandboard();
    await loadSandArt();
    scene = 'sandboard';
    roomId = 'sandboard';
    canvas.style.cursor = '';
    miniHover = null;
    quiet();
    say('rhythm', 1.6);
    sayHelp();
  });
/** 벌목 쉼터 장작 패기 — 매번 새 나무 */
const enterTimber = () =>
  goTo(() => {
    scene = 'timber';
    roomId = 'timber';
    canvas.style.cursor = '';
    timber = makeTimber();
    chops.length = 0;
    miniHover = null;
    quiet();
    say('exertion', 1.6);
    sayHelp();
  });
/** 고양이마을 — 광장 그림 · 주민 털빛(처음 한 번 다시 칠한다)을 먼저 준비한다. 처음 오면 코코 할머니가 인사 */
const enterVillage = () =>
  goTo(async () => {
    step('고양이마을');
    await villageReady;
    for (const fr of FRIENDS) friendSheet(catSheet, fr);
    scene = 'village';
    roomId = 'village';
    canvas.style.cursor = '';
    village = makeVillage();
    resetVillageView();
    tickRequests(vsave, Date.now());
    miniHover = null;
    quiet();
    say('delight', 1.6);
    if (!vsave.met) {
      Object.assign(village.townies[0], { say: '어서 오렴, 치즈! 요리 가판대에서 요리해서 친구들에게 먹여 주렴. 재료는 고등어 상점에도 있단다', sayT: 7 });
      vsave.met = true;
      saveVillage();
    }
    sayHelp();
  });
/** 숲 미니게임장 다람쥐 잡기 — 다람쥐 시트를 먼저 불러온다 */
const enterChase = () =>
  goTo(async () => {
    step('다람쥐 잡기');
    await enemySheet('acorn_squirrel');
    scene = 'chase';
    roomId = 'chase';
    canvas.style.cursor = '';
    chase = makeChase();
    miniHover = null;
    quiet();
    say('determination', 1.6);
    sayHelp();
  });
/** 미니게임 다시 (R · 결과 카드의 다시) */
const restartMini = () =>
  goTo(() => {
    if (scene === 'maze') maze = makeMaze();
    else if (scene === 'chase') chase = makeChase();
    else if (scene === 'timber') {
      timber = makeTimber();
      chops.length = 0;
    } else sand = makeSandboard();
    miniHover = null;
    quiet();
    sayHelp();
  });
/** 포탈 → 던전 · 낚시터 · 미니게임, 또는 상점 창 (장면은 그대로 — 한 번 벗어났다 와야 다시 열린다) */
const enterPortal = (to: string) => {
  if (to === 'maze') return enterMaze();
  if (to === 'sandboard') return enterSandboard();
  if (to === 'timber') return enterTimber();
  if (to === 'chase') return enterChase();
  if (to === 'village') return enterVillage();
  if (to !== 'shop') return SPOTS[to] ? enterFishing(to) : enterDungeon(to);
  field.armed = false;
  field.dwell = 0;
  if (bagAllowed()) openPanel('shop');
};
/** 미로 사건 → 보상 · 소리 · 감정 · 기록 */
function mazeEvent(e: MazeEvent) {
  if (e.type === 'coin') {
    bag.coins++;
    sfxCoin();
  } else if (e.type === 'chest') {
    sfxPickup();
    if (obtain(bag, e.item) > 0) say('frustration', 1.5); // 가방이 가득
    else say('treasure_temptation', 2);
    saveBag();
  } else {
    bag.coins += e.bonus;
    sfxCatch();
    say('delight', 3);
    const key = maze.theme === 'whale' ? 'whale' : 'maze';
    if (records[key] === null || e.secs < records[key]) records[key] = Math.round(e.secs * 10) / 10;
    saveRecords();
    saveBag();
  }
}
/** 마을 한 프레임: 창이 열려 있으면 고양이는 서 있고(주민은 그대로 움직인다) 요리 바늘만 돈다 */
let villageNear = '';
function stepVillage(dt: number) {
  const P = villageView.panel;
  const busy = !!P || villageView.gifts.length > 0;
  updateVillage(village, busy ? { mx: 0, my: 0, act: false } : { ...input(), act: villageAct }, dt);
  villageAct = false;
  if (P?.kind === 'cook' && updateCook(P.cook, dt)) onVillageAct(burn(vsave, bag));
  tickRequests(vsave, Date.now());
  // 친구 곁에 가면 그 친구가 인사한다
  const near = village.near?.kind === 'friend' ? FRIENDS[village.near.i].id : '';
  if (near && near !== villageNear && village.near?.kind === 'friend') {
    const p = village.townies[village.near.i];
    if (p.sayT <= 0) Object.assign(p, { say: hello(vsave, FRIENDS[village.near.i], village.rng).split(/[.!?…]/)[0] || '안녕!', sayT: 2.2 });
  }
  villageNear = near;
  if (!busy && village.open) {
    openVillagePanel(village.open, village, vsave, bag);
    if (village.open.kind === 'friend') village.townies[village.open.i].hop = 0.5;
    sfxPickup();
    help.classList.add('choosing');
  }
}
/** 마을 장면을 눌렀다 (CSS px): 친구 · 가판대 위면 걸어가서 열고, 아니면 그리로 걸어간다 */
function villageWalk(p: Pt) {
  const d = Math.min(devicePixelRatio, 2);
  const x = (p.x * d - villageView.ox) / villageView.sc;
  const y = (p.y * d - villageView.oy) / villageView.sc;
  walkTo(village, x, y, targetAtPoint(village, x, y));
}
/** 마을 창에서 한 일 → 소리 · 감정 · 저장 */
function onVillageAct(a: VillageAct) {
  if (!a) return;
  if (a.kind === 'close') help.classList.remove('choosing');
  else if (a.kind === 'fed') {
    if (!a.res.ok) {
      if (a.res.why === 'full') sfxFull();
      return;
    }
    sfxSnack();
    if (a.res.coins) sfxCoin();
    if (a.res.up) sfxLevel();
    say(a.res.pref === 'love' ? 'heart' : a.res.pref === 'dislike' ? 'sweat' : 'delight', 1.4);
    saveBag();
    saveVillage();
  } else if (a.kind === 'cook') {
    sfxSlide(0.4);
    saveBag();
  } else if (a.kind === 'served') {
    (a.cook.stars === 3 ? sfxCatch : a.cook.stars === 2 ? sfxPickup : sfxFull)();
    say(a.cook.stars === 3 ? 'pride' : a.cook.stars === 2 ? 'delight' : 'sweat', 1.4);
    saveBag();
    saveVillage();
  } else if (a.kind === 'gift') sfxPickup();
  if (!villageView.panel && !villageView.gifts.length) help.classList.remove('choosing');
}
/** 다람쥐 잡기 사건 → 소리 · 감정 · 보상 · 기록 */
function chaseEvent(e: ChaseEvent) {
  if (e.type === 'rustle') sfxRustle();
  else if (e.type === 'hurry') sfxWave(false);
  else if (e.type === 'squirrel') {
    if (e.what === 'appear') once('chirp', sfxChirp);
    else if (e.what === 'throw') once('throw', sfxThrow);
    else if (e.what === 'bonk') {
      sfxBonk();
      say('anger', 1);
    } else if (e.what === 'caught') {
      (e.gold ? sfxCatch : sfxPickup)();
      say(e.gold ? 'dazzled' : 'pride', 1);
    } else if (e.what === 'escape') once('pop', sfxPop);
  } else if (e.type === 'done') {
    sfxCatch();
    say(e.caught ? 'delight' : 'frustration', 2.4);
    bag.coins += e.coins;
    if (e.acorns) obtain(bag, 'materials_05', e.acorns);
    if (records.chase === null || e.points > records.chase) records.chase = e.points;
    saveRecords();
    saveBag();
  }
}
/** 장작 패기 사건 → 소리 · 감정 · 보상 · 기록 */
function timberEvent(e: TimberEvent) {
  if (e.type === 'chop') sfxChop();
  else if (e.type === 'hit') {
    sfxBonk();
    sfxHurt();
    say('dizzy', 2.4);
  } else if (e.type === 'timeout') {
    sfxFull();
    say('fatigue', 2.4);
  } else if (e.type === 'level') {
    sfxLevel();
    say('determination', 1);
  } else if (e.type === 'done') {
    bag.coins += e.coins;
    if (e.logs) obtain(bag, 'materials_01', e.logs);
    if (records.timber === null || e.score > records.timber) records.timber = e.score;
    saveRecords();
    saveBag();
  }
}
/** 샌드보드 사건 → 보상 · 소리 · 감정 · 기록 */
function sandEvent(e: SandEvent) {
  switch (e.type) {
    case 'coin':
      bag.coins += e.n;
      if (e.n > 1) sfxPickup();
      else sfxCoin();
      break;
    case 'jump':
    case 'bump':
      sfxJump();
      break;
    case 'ramp':
    case 'boost':
      sfxCast();
      say('exertion', 0.8);
      break;
    case 'pit':
      sfxHurt();
      say('frustration', 0.8);
      break;
    case 'slide':
      sfxSlide(e.k);
      break;
    case 'scrape':
      sfxSlide(0.2);
      break;
    case 'carve':
      if (e.gain > 0.5) sfxRush(e.gain);
      break;
    case 'crash':
      sfxHurt();
      say('dizzy', 1);
      break;
    case 'block':
      sfxCast();
      say('relief', 1);
      break;
    case 'power':
      sfxPickup();
      say('delight', 1);
      break;
    case 'finish':
      if (e.fell) sfxHurt();
      else sfxCatch();
      say(e.fell ? 'frustration' : e.clean ? 'pride' : 'relief', 3);
      if (records.sandboard === null || e.score > records.sandboard) records.sandboard = e.score;
      saveRecords();
      saveBag();
      break;
  }
}
/** 포탈 워프 — 포탈 바로 앞(돌아올 자리, 워프 밖)에 내린다. 한 걸음 들어가면 바로 빨려 들어간다 */
const warpTo = (w: Warp) =>
  goTo(() => {
    field = makeFieldState(w.back, terrainAt, field);
    look = null;
    quiet();
    say('surprise', 1.2);
  });
/** 던전 다시 도전 — 방을 처음부터 (웨이브 · 기술 · 기록 모두) */
const retryRoom = () =>
  goTo(() => {
    resetDungeon(dungeon);
    resultHover = null;
    canvas.style.cursor = '';
    enteredRoom();
    sayHelp();
  });
/** 던전·낚시터에서 필드로 — 들어갔던 포탈 앞으로. 고래 배 속에서 나오면 삼켜졌던 바다 그 자리에서 뱉어 낸다 */
const backToField = () =>
  goTo(() => {
    scene = 'field';
    if (roomId === 'whale') whaleSpit(field);
    else field = makeFieldState(backFrom(roomId), terrainAt, field);
    look = null;
    fishKey = false;
    fishPtr = null;
    canvas.style.cursor = '';
    saveBag(); // 미니게임에서 주운 냥코인
    quiet();
    sayHelp();
  });

let last = performance.now();
let lastDt = 1 / 60; // 표시용 보간에 쓴다
let fps = 0;
let reelTick = 0;

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

  // 덮이는 동안·도감을 보는 동안은 멈춘다
  if (!fadeTo && !panel) {
    if (scene === 'field') {
      const { mx, my } = input();
      stepLook(dt, mx !== 0 || my !== 0);
      const w = updateField(field, mx, my, dt, terrainAt);
      field.events.forEach(fieldLoot);
      field.events.forEach(fieldSound);
      fieldFx(field.events);
      fieldMood(dt, now / 1000);
      if (w) enterPortal(w.to);
      if (field.whale.phase === 'gulped') enterWhale(); // 고래가 삼켰다 (덮개가 내려오는 중이면 다음 프레임에 다시)
    } else if (scene === 'fishing') {
      fishIn.down = fishPtr !== null || fishKey;
      const before = fishing.phase;
      updateFishing(fishing, fishIn, dt);
      fishIn.pressed = fishIn.released = false;
      fishing.events.forEach(fishingEvent);
      fishingFx(fishing, fishing.events);
      if (fishing.phase !== before) sayHelp();
      // 릴 감는 소리
      reelTick += dt;
      if (fishing.phase === 'reel' && fishing.reeling && reelTick > 0.09) {
        reelTick = 0;
        sfxReel();
      }
    } else if (scene === 'maze') {
      updateMaze(maze, input(), dt);
      maze.events.forEach(mazeEvent);
    } else if (scene === 'sandboard') {
      updateSandboard(sand, { mx: input().mx, jump: jumpQueued }, dt);
      sand.events.forEach(sandEvent);
    } else if (scene === 'village') {
      stepVillage(dt);
    } else if (scene === 'chase') {
      updateChase(chase, input(), dt);
      chase.events.forEach(chaseEvent);
      chaseFx(chase.events);
    } else if (scene === 'timber') {
      updateTimber(timber, chops.splice(0), dt);
      timber.events.forEach(timberEvent);
      timberFx(timber, timber.events, innerWidth, innerHeight);
    } else {
      const dash = keys.has('Space') || [...pressing.values()].includes('dash');
      const out = updateDungeon(dungeon, { ...input(), punch: false, dash }, dt); // 냥펀치는 자동
      dungeon.events.forEach(dungeonSound);
      if (dungeon.events.some((e) => e.type === 'loot')) saveBag();
      dungeonMood();
      if (out === 'exit') backToField();
    }
    jumpQueued = false;
    tickEmote(dt);
    tickBuffs(bag, dt);
  }
  if (scene === 'field') drawFieldScene();
  else if (scene === 'fishing') drawFishing(ctx, canvas.width, canvas.height, fishing, { t: last / 1000, dt: lastDt, hover: fishHover, touch: touchOn });
  else if (scene === 'maze') drawMaze(ctx, canvas.width, canvas.height, maze, catSheet, { t: last / 1000, dt: lastDt, touch: touchOn, hover: miniHover, best: records[maze.theme === 'whale' ? 'whale' : 'maze'] });
  else if (scene === 'village') drawVillage(ctx, canvas.width, canvas.height, village, vsave, catSheet, { t: last / 1000, dt: lastDt, touch: touchOn, hover: miniHover });
  else if (scene === 'chase') drawChase(ctx, canvas.width, canvas.height, chase, { cat: catSheet, squirrel: sheets.acorn_squirrel }, { t: last / 1000, dt: lastDt, touch: touchOn, hover: miniHover, best: records.chase });
  else if (scene === 'timber') drawTimber(ctx, canvas.width, canvas.height, timber, { axe: axeSheet, cat: catSheet }, { t: last / 1000, dt: lastDt, touch: touchOn, hover: miniHover, best: records.timber });
  else if (scene === 'sandboard')
    drawSandboard(
      ctx,
      canvas.width,
      canvas.height,
      sand,
      sandArt,
      { t: last / 1000, touch: touchOn, hover: miniHover, best: records.sandboard },
    );
  else
    drawDungeon(ctx, canvas.width, canvas.height, dungeon, catSheet, { t: last / 1000, dt: lastDt, fps, grid: debug, trace: trace ? traceDraw : undefined, touch: touchOn });
  drawOverlay();
  drawFade();
  requestAnimationFrame(frame);
}

/** 필드 장면 + 지역 이름표 */
function drawFieldScene() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawField(ctx, canvas.width, canvas.height, field, { cat: catSheet, axe: axeSheet, boat: boatSheet, snow: snowSheet, squirrel: sheets.acorn_squirrel }, last / 1000, lastDt, showTerrain, look);
  const s = pxRatio();
  const k = ui(innerWidth, innerHeight);
  const sf = safe();
  ctx.setTransform(s * k, 0, 0, s * k, s * sf.l, s * sf.t);
  ctx.textAlign = 'left'; // 다른 장면(미로 등)이 바꿔 둔 정렬이 남아 있을 수 있다
  ctx.font = 'bold 15px system-ui, sans-serif';
  const w = ctx.measureText(FIELD.name).width + 28;
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.beginPath();
  ctx.roundRect(14, 14, w, 34, 17);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.fillText(FIELD.name, 28, 36);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  if (showMap) {
    const sc = fieldView.sc;
    const view = { x: -fieldView.ox / sc, y: -fieldView.oy / sc, w: canvas.width / sc, h: canvas.height / sc };
    drawMinimap(ctx, mapRect(), field, view, mapHover, last / 1000);
  }
}

/** 장면 위에 뜨는 것 — 조이스틱·버튼, 세로 화면 안내, 도감·가방 (CSS px) */
function drawOverlay() {
  const s = pxRatio();
  ctx.setTransform(s, 0, 0, s, 0, 0);
  if (panel === 'dex') return drawBook(ctx, innerWidth, innerHeight, bookData(), last / 1000);
  if (panel === 'shop') return drawShop(ctx, innerWidth, innerHeight, bag, SHOP, lastDt);
  if (panel === 'bag') return drawBag(ctx, innerWidth, innerHeight, bag, lastDt);
  if (scene === 'village' && (villageView.panel || villageView.gifts.length))
    return drawVillagePanel(ctx, innerWidth, innerHeight, village, vsave, bag, catSheet, last / 1000, lastDt, Date.now(), touchOn);
  const c = ctl();
  drawControls(ctx, c, stick && c.stick ? { bx: stick.bx, by: stick.by, ...stickVector(c, stick) } : null, new Set(pressing.values()));
  // 레벨 업 카드는 맨 위에 (조이스틱·버튼도 덮는다). 도움말 줄은 고르는 동안 숨긴다
  if (scene === 'dungeon' && dungeon.choose) drawCards(ctx, canvas.width, canvas.height, dungeon, cardHover, last / 1000, touchOn);
  if (scene === 'dungeon' && dungeon.result) drawResult(ctx, canvas.width, canvas.height, dungeon, resultHover, last / 1000, touchOn, dungeon.room.def.name);
  const hideHelp = scene === 'dungeon' && (!!dungeon.choose || !!dungeon.result);
  if (help.classList.contains('choosing') !== hideHelp) help.classList.toggle('choosing', hideHelp);
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
  field: 'WASD 이동 · 숲은 도끼로 (부스럭거리는 수풀엔 무언가 · 다람쥐는 쫓아가 잡기), 물은 배로 · 이정표 앞 포탈에 잠시 서 있으면 던전 · 바다에서 배를 멈추고 있으면… 고래? · 지도 끌기·미니맵으로 둘러보기, 포탈 클릭 = 워프 · 강아지마을은 고등어 상점 · I 가방 · B 도감 · M 미니맵 · T 지형 보기',
  dungeon: 'WASD 이동 · 냥펀치는 저절로 (몬스터가 가까이 오면) · Space 구르기 · 웨이브 8번을 버티면 클리어 · 생선뼈를 모으면 레벨 업 → 기술 카드 (1·2·3) · I 가방 · 빛나는 칸에 3초 서 있으면 나가기',
  maze: 'WASD 이동 · 횃불이 닿는 길만 보여요 · 냥코인을 줍고 막다른 길 끝의 보물 상자를 찾아 출구로 · 빠를수록 탈출 보너스 · R 새 미로 · Esc 돌아가기',
  whale: '고래에게 삼켜졌다! WASD 이동 · 플랑크톤 빛이 닿는 길만 보여요 · 냥코인과 진주 조개를 찾아 숨구멍으로 · 빠를수록 보너스 · Esc 포기 (그래도 뱉어 줘요)',
  sandboard: 'A/D 좌우 · Space 점프 (높은 바위·선인장·기둥은 점프대로만) · 부딪히면 하트 -1 · 자석·방패·하트·가속 발판 · R 다시 · Esc 돌아가기',
  timber: 'A · ← 왼쪽에서, D · → 오른쪽에서 패요 · 가지가 내 쪽으로 내려오면 콩! · 팰수록 시간이 늘지만 점점 빨리 줄어요 · R 다시 · Esc 돌아가기',
  chase: 'WASD 이동 · 흔들리는 수풀에서 다람쥐가 튀어나와요 · 쫓아가 닿으면 잡기 (황금 다람쥐 3점) · 도토리에 맞으면 잠깐 멍 · 60초 · R 다시 · Esc 돌아가기',
  village: 'WASD 이동 · 친구나 요리 가판대 앞에서 E (또는 누르기) · 재료로 요리해서 친구에게 먹여 주면 친해져요 · 부탁(!)을 들어주면 냥코인 · I 가방 · Esc 돌아가기',
};
const HELP_TOUCH = {
  field: '왼쪽 조이스틱으로 이동 · 숲은 도끼로, 물은 배로 · 포탈에 잠시 서 있으면 던전·낚시터 (강아지마을은 상점) · 화면을 끌어 둘러보고 포탈을 누르면 워프',
  dungeon: '조이스틱 이동 · 냥펀치는 저절로 · 구르기 버튼 · 생선뼈로 레벨 업 → 기술 카드를 눌러 골라요 · 빛나는 칸에 3초 서 있으면 나가기',
  maze: '조이스틱으로 이동 · 횃불이 닿는 길만 보여요 · 냥코인과 보물 상자를 찾아 출구로',
  whale: '고래에게 삼켜졌다! 조이스틱으로 이동 · 냥코인과 진주 조개를 찾아 숨구멍으로',
  sandboard: '◀ ▶ 좌우 · 점프 버튼이나 화면 누르기 = 점프 · 높은 건 피하고 낮은 건 뛰어넘어요 · 하트 3개',
  timber: '◀ ▶ 버튼이나 화면 왼쪽·오른쪽을 눌러 그쪽에서 패요 · 가지가 내 쪽으로 내려오면 콩!',
  chase: '조이스틱으로 쫓아가 다람쥐를 잡아요 · 황금 다람쥐는 3점 · 60초',
  village: '친구나 요리 가판대를 누르면 걸어가서 말을 걸어요 · 요리해서 먹여 주면 친해져요',
};
function sayHelp() {
  const t = scene === 'fishing' ? fishingHelp(fishing, touchOn) : (touchOn ? HELP_TOUCH : HELP)[inWhale() ? 'whale' : scene];
  help.textContent = t;
  help.hidden = !t || (touchOn && scene === 'sandboard'); // 터치 샌드보드는 아래 가운데가 점프 버튼 자리
}
const step = (t: string) => {
  help.textContent = t + ' 불러오는 중…';
  help.hidden = false;
};

(async () => {
  step('배경');
  await Promise.all([dungeonReady, fieldReady, emotesReady, itemIconsReady, coinReady]);
  step('고양이 시트');
  catSheet = await loadCat();
  step('도끼·배·눈길 시트');
  [axeSheet, boatSheet, snowSheet] = await Promise.all([loadAxe(), loadBoat(), loadSnow()]);
  step('지형');
  await terrainReady;
  field = makeFieldState(FIELD.start, terrainAt);
  step('던전');
  await prepareRoom(startRoom);
  dungeon = makeDungeon(sheets, startRoom, bag);
  if (scene === 'dungeon') enteredRoom();
  if (scene === 'sandboard') await loadSandArt();
  if (scene === 'chase') await enemySheet('acorn_squirrel');
  if (scene === 'village') {
    step('고양이마을');
    await villageReady;
    for (const fr of FRIENDS) friendSheet(catSheet, fr);
    tickRequests(vsave, Date.now());
  }
  if (scene === 'fishing') {
    step('낚시터');
    await fishingReady(startSpot);
  }
  if (trace) Object.assign(window, { __sheets: { cat: catSheet, axe: axeSheet, boat: boatSheet, snow: snowSheet, ...sheets } });
  // 소리 장치를 불러오는 동안 미리 만든다 — 처음 키를 누르는 순간 만들면 0.2~0.4초 멈칫했다 (켜기는 브라우저 규칙대로 첫 입력에서)
  unlockAudio();
  sayHelp();
  requestAnimationFrame(frame);
  void enemySheet('acorn_squirrel'); // 숲 다람쥐 (400KB) — 첫 화면이 뜬 뒤 천천히
})();
