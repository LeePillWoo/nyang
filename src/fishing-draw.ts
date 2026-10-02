// 낚시 그리기 — 배경, 그림자 물고기, 물결·물튀김, 낚싯줄, 고양이, 찌, 조준 링, 잡은 물고기 팝업, 도감·장력 게이지·안내.
// 로직은 fishing.ts. 좌표는 낚시 배경 그림 픽셀 (화면에 맞춰 통째로 줄인다 — UI 도 같은 좌표계).
// 그리는 순서는 리소스의 layout.json 대로: 배경 → 그림자 → 물결 → 줄 → 고양이 → 찌 → 반짝임 → 잡은 물고기 → UI.
import { image } from './assets.ts';
import atlas from './data/fishing-atlas.json' with { type: 'json' };
import { drawEmote } from './emote.ts';
import { FISH, fishLen, mouth, RULES, SPOTS, type Dex, type FailHint, type FailReason, type Fish, type FishEvent, type FishingState } from './fishing.ts';
import { fitText, safe } from './touch.ts';

/** 칸마다 [x, y, w, h, 내용 x, y, w, h] — 고양이는 뒤에 [발 x, y, 낚싯대 끝 x, y] (칸 기준) */
type St = { name: string; fps: number; loop: boolean; frames: number[][] };
type Sh = { sheet: string; states: Record<string, St> };
/** 공용 시트 셋 (fishing/common) + 낚시터마다의 물고기 시트 — 물고기는 id 로 바로 찾는다 */
const A = atlas as unknown as { cat: Sh; shadow: Sh; fx: Sh; catch: Record<string, St & { sheet: string }> };
const IMG = (k: 'cat' | 'shadow' | 'fx') => image(A[k].sheet).img;

/** 낚시터 배경 + 공용 시트 + 그곳 물고기 시트 */
export const fishingReady = (spotId: string) =>
  Promise.all([
    image(SPOTS[spotId].image).ready,
    ...(['cat', 'shadow', 'fx'] as const).map((k) => image(A[k].sheet).ready),
    ...[...new Set(Object.keys(SPOTS[spotId].fish).map((k) => A.catch[k].sheet))].map((p) => image(p).ready),
  ]);
const catchImg = (kind: string) => image(A.catch[kind].sheet).img;

/** 검은 실루엣 시트 — 시트마다 한 번 만든다. ctx.filter 는 iOS 사파리 17 이하에서 무시돼서 못 잡은 물고기가 다 보였다 */
const darkSheets = new Map<HTMLImageElement, HTMLCanvasElement>();
/** 잡은 종은 그림 그대로, 못 잡은 종은 실루엣. 아직 불러오는 중이면 null */
function fishImg(kind: string, caught: boolean): CanvasImageSource | null {
  const img = catchImg(kind);
  if (!img.complete || !img.naturalWidth) return null;
  if (caught) return img;
  let c = darkSheets.get(img);
  if (!c) {
    c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillRect(0, 0, c.width, c.height); // 그린 곳만 검게
    darkSheets.set(img, c);
  }
  return c;
}

/** 캔버스 픽셀 기준 변환 (마우스 → 그림 좌표에 쓴다) */
export const fishingView = { sc: 1, ox: 0, oy: 0 };

const at = (st: St, t: number) => {
  const i = Math.floor(Math.max(0, t) * st.fps);
  const n = st.frames.length;
  return st.frames[st.loop ? i % n : Math.min(n - 1, i)];
};

/** 칸 가운데를 (x, y) 에 맞춰 그린다 */
function cell(ctx: CanvasRenderingContext2D, img: CanvasImageSource, f: number[], x: number, y: number, scale: number, flip = 1, rot = 0, alpha = 1) {
  const [sx, sy, sw, sh] = f;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(flip * scale, scale);
  ctx.globalAlpha *= alpha;
  ctx.drawImage(img, sx, sy, sw, sh, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
}

// ── 연출 (로직 사건 → 한 번 재생하는 이펙트·잔물결·알림 글자) ──
type Shot = { st: St; x: number; y: number; t: number; scale: number };
type Ripple = { x: number; y: number; t: number; life: number; r: number };
let shots: Shot[] = [];
let ripples: Ripple[] = [];
let banner: { text: string; color: string; t: number } | null = null;
let rippleT = 0;
/** 물 위에 떠올랐다 사라지는 짧은 말 (펄쩍! 휙!) */
let words: { text: string; x: number; y: number; t: number; color: string }[] = [];

const shot = (id: string, x: number, y: number, scale: number) => shots.push({ st: A.fx.states[id], x, y, t: 0, scale });
const ripple = (x: number, y: number, r: number, life = 0.9) => ripples.push({ x, y, t: 0, life, r });
const say = (text: string, color: string) => {
  banner = { text, color, t: 0 };
};
/** 실패 글자 — 무엇에 속았는지 / 무엇을 놓쳤는지 알려 줘서 패턴을 배우게 한다 */
function failText(reason: FailReason, hint: FailHint) {
  if (reason === 'early')
    return hint === 'approach'
      ? '아직 다가오는 중이었어요!'
      : hint === 'dunk'
        ? '헛잠김이었어요! 쏙 잠겨서 안 올라올 때 채요'
        : hint === 'flurry'
          ? '따다닥 연타는 맛보기예요, 조금 더!'
          : '톡톡은 맛보기예요, 조금 더 기다려요';
  if (reason === 'late')
    return hint === 'lift' ? '찌가 쑥 떠오른 게 입질이었어요!' : hint === 'drag' ? '찌를 끌고 갈 때 채야 해요!' : '미끼만 먹고 도망갔어요…';
  return reason === 'snap' ? '줄이 끊어졌어요!' : '바늘이 빠졌어요…';
}
const word = (text: string, x: number, y: number, color = '#fff6d8') => words.push({ text, x, y, t: 0, color });

/** 낚시터에 들어올 때 연출을 비운다 */
export function resetFishingFx() {
  shots = [];
  ripples = [];
  words = [];
  banner = null;
}

export function fishingFx(s: FishingState, events: FishEvent[]) {
  for (const e of events)
    switch (e.type) {
      case 'splash':
        shot('cast_splash', e.x, e.y - 10, 0.55);
        ripple(e.x, e.y, 30, 1.2);
        break;
      case 'nibble':
        ripple(s.bobX, s.bobY, e.strength > 0.7 ? 18 : 11, e.strength > 0.7 ? 0.8 : 0.5);
        break;
      case 'dunk':
        ripple(s.bobX, s.bobY, 22, 0.8);
        break;
      case 'hesitate':
        ripple(e.x, e.y, 20, 0.8);
        break;
      case 'abandon':
        say('그냥 가 버렸어요… 망설이는 녀석이었네', '#fff6d8');
        break;
      case 'bite':
        ripple(s.bobX, s.bobY, 26, 0.9);
        if (e.kind === 'sink') shot('cast_splash', s.bobX, s.bobY - 8, 0.3);
        break;
      case 'jump':
        shot('cast_splash', e.x, e.y - 14, 0.95);
        ripple(e.x, e.y, 40, 1);
        word('펄쩍!', e.x, e.y - 50, '#ffd84a');
        break;
      case 'zig':
        shot('cast_splash', e.x, e.y - 8, 0.3);
        word('휙!', e.x, e.y - 34);
        break;
      case 'hook':
        if (e.perfect) say('완벽한 챔질!', '#ffd84a');
        break;
      case 'run':
        shot('cast_splash', e.x, e.y - 8, 0.42);
        break;
      case 'tired':
        say('지쳤다! 쭉 감아요', '#8be08b');
        break;
      case 'caught':
        shot('cast_splash', e.x, e.y - 10, 0.7);
        banner = null; // 팝업을 가리지 않게
        break;
      case 'fail':
        shot('escape_wake', e.x, e.y, 0.75);
        say(failText(e.reason, e.hint), '#ff9083');
        break;
      case 'legend':
        say('반짝이는 그림자가 나타났다!', '#ffd84a');
        break;
      case 'bored':
        say('물고기 앞쪽에 다시 던져 볼까?', '#fff6d8');
        break;
      case 'reelin':
        ripple(s.bobX, s.bobY, 18, 0.6);
        break;
    }
}

// ── 버튼 (그림 좌표) ──
type Rect = { x: number; y: number; w: number; h: number };
const inRect = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const exitBtn = (s: FishingState): Rect => ({ x: s.spot.size[0] - 24 - 250, y: 22, w: 250, h: 62 });
/** 왼쪽 위 도감 판 */
const DEX_PANEL: Rect = { x: 24, y: 22, w: 520, h: 182 };
const POPUP = { w: 480, h: 440 };
function popupBox(s: FishingState) {
  const [cx, cy] = s.spot.popup;
  return { x: cx - POPUP.w / 2, y: cy - 150, w: POPUP.w, h: POPUP.h };
}
function popupButtons(s: FishingState) {
  const b = popupBox(s);
  return {
    again: { x: b.x + 30, y: b.y + b.h - 84, w: 200, h: 62 },
    leave: { x: b.x + b.w - 230, y: b.y + b.h - 84, w: 200, h: 62 },
  };
}

// 작은 화면(휴대폰)에선 그림째 줄어든 UI 판을 다시 키운다 — 그림 1px 이 화면에서 0.55 CSS px 은 되게 (최대 1.8배).
// 판마다 붙박이 점(도감 = 왼쪽 위, 돌아가기 = 오른쪽 위, 장력 = 아래, 팝업 = 가운데)을 두고 그 점 기준으로 키운다.
let uiK = 1;
const grow = (r: Rect, ax: number, ay: number): Rect => ({ x: ax + (r.x - ax) * uiK, y: ay + (r.y - ay) * uiK, w: r.w * uiK, h: r.h * uiK });
function zoom(ctx: CanvasRenderingContext2D, ax: number, ay: number) {
  ctx.translate(ax, ay);
  ctx.scale(uiK, uiK);
  ctx.translate(-ax, -ay);
}
const popupCenter = (s: FishingState) => ((b) => [b.x + b.w / 2, b.y + b.h / 2] as const)(popupBox(s));
/** 장력 판의 붙박이 점 (판 아래 가운데) */
const tensionAnchor = (s: FishingState) => [s.spot.size[0] / 2 + 75, 882] as const;

/** 도감을 열 수 있는 때 (던지기·기다리기·당기기 중엔 누르는 게 낚시라서 안 연다) */
export const dexReady = (s: FishingState) => s.phase === 'ready' || s.phase === 'caught' || s.phase === 'fail';
export type FishingButton = 'again' | 'leave' | 'dex' | null;
/** 그림 좌표 (x, y) 에 있는 버튼 */
export function fishingButtonAt(s: FishingState, x: number, y: number): FishingButton {
  if (inRect(grow(exitBtn(s), s.spot.size[0] - 24, 22), x, y)) return 'leave';
  if (s.phase === 'caught') {
    const b = popupButtons(s);
    const [cx, cy] = popupCenter(s);
    if (inRect(grow(b.again, cx, cy), x, y)) return 'again';
    if (inRect(grow(b.leave, cx, cy), x, y)) return 'leave';
  }
  if (dexReady(s) && inRect(grow(DEX_PANEL, DEX_PANEL.x, DEX_PANEL.y), x, y)) return 'dex';
  return null;
}

// ── 그리기 ──
/** touch = 터치 화면 (버튼 글자에서 키 안내를 뺀다) */
export type FishingViewOpts = { t: number; dt: number; hover: FishingButton; touch: boolean };

export function drawFishing(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: FishingState, v: FishingViewOpts) {
  const spot = s.spot;
  const [W, H] = spot.size;
  const sc = Math.min(cw / W, ch / H);
  const ox = (cw - W * sc) / 2;
  const oy = (ch - H * sc) / 2;
  Object.assign(fishingView, { sc, ox, oy });
  uiK = Math.max(1, Math.min(1.8, 0.55 / (sc / Math.min(devicePixelRatio, 2))));
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#58b6dd'; // 화면 비율이 달라 남는 곳은 물빛으로
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(sc, 0, 0, sc, ox, oy);
  ctx.drawImage(image(spot.image).img, 0, 0, W, H);

  stepFx(s, v.dt);

  // 얼음 구멍처럼 물이 일부뿐인 곳은 물 영역 밖으로 그림자·물결·찌가 나가지 않게 자른다
  const clip = (on: boolean) => {
    if (!spot.clip) return;
    if (!on) return ctx.restore();
    ctx.save();
    ctx.beginPath();
    spot.water.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
  };

  // 그림자 물고기
  clip(true);
  for (const f of s.fishes) drawShadow(ctx, s, f, v.t);

  // 물결 · 한 번 재생 이펙트 (물에 붙은 것)
  for (const r of ripples) {
    const p = r.t / r.life;
    ctx.strokeStyle = `rgba(255,255,255,${(1 - p) * 0.55})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(r.x, r.y, r.r * (0.35 + p), r.r * (0.35 + p) * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  for (const sh of shots) {
    if (sh.st === A.fx.states.catch_sparkle) continue;
    cell(ctx, IMG('fx'), at(sh.st, sh.t), sh.x, sh.y, sh.scale);
  }
  clip(false);

  // 고양이 프레임을 먼저 골라 낚싯대 끝을 안다 → 줄 → 고양이 → 찌
  const cf = catFrame(s, v.t);
  const k = spot.catScale;
  const [csx, csy, csw, csh, cbx, cby, cbw, , fx, fy, tx, ty] = cf;
  const cox = spot.seat[0] - fx * k;
  const coy = spot.seat[1] - fy * k;
  const tipX = cox + tx * k;
  const tipY = coy + ty * k;
  const end = lineEnd(s, tipX, tipY);
  if (end) drawLine(ctx, s, tipX, tipY, end.x, end.y, v.t);
  ctx.drawImage(IMG('cat'), csx, csy, csw, csh, cox, coy, csw * k, csh * k);
  // 날아가는 찌는 자르지 않는다 (공중)
  if (s.phase !== 'cast') clip(true);
  drawBobber(ctx, s, end, v.t);
  if (s.phase !== 'cast') clip(false);
  drawAim(ctx, s, tipX, tipY);
  drawEmote(ctx, cox + (cbx + cbw * 0.42) * k, coy + cby * k - 2, 72);

  // 펄쩍! 휙!
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = 'bold 30px system-ui, sans-serif';
  for (const w of words) {
    const a = Math.min(1, (0.9 - w.t) / 0.3);
    ctx.globalAlpha = Math.max(0, a);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(70,52,42,0.8)';
    ctx.strokeText(w.text, w.x, w.y - w.t * 40);
    ctx.fillStyle = w.color;
    ctx.fillText(w.text, w.x, w.y - w.t * 40);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';

  if (s.phase === 'caught' && s.catch) drawCatch(ctx, s, v);
  for (const sh of shots) if (sh.st === A.fx.states.catch_sparkle) cell(ctx, IMG('fx'), at(sh.st, sh.t), sh.x, sh.y, sh.scale);
  drawUi(ctx, s, v);
}

function stepFx(s: FishingState, dt: number) {
  for (const sh of shots) sh.t += dt;
  shots = shots.filter((sh) => sh.t * sh.st.fps < sh.st.frames.length); // 단발 효과는 끝나면 숨긴다
  for (const r of ripples) r.t += dt;
  ripples = ripples.filter((r) => r.t < r.life);
  if (banner && (banner.t += dt) > 1.8) banner = null;
  for (const w of words) w.t += dt;
  words = words.filter((w) => w.t < 0.9);
  // 걸린 물고기 둘레엔 물결이 계속 인다 (날뛸 땐 더 자주)
  rippleT += dt;
  const f = s.hooked;
  if (f && rippleT > (s.run > 0 ? 0.14 : 0.32)) {
    rippleT = 0;
    const m = mouth(f);
    ripple(m.x, m.y, s.run > 0 ? 26 : 16, 0.7);
  }
  // 끌려가는 찌 뒤로 물결 꼬리
  if (s.phase === 'bite' && s.biteKind === 'drag' && rippleT > 0.12) {
    rippleT = 0;
    ripple(s.bobX, s.bobY, 12, 0.7);
  }
}

function drawShadow(ctx: CanvasRenderingContext2D, s: FishingState, f: Fish, t: number) {
  const st = A.shadow.states[f.def.shadow];
  const hooked = f === s.hooked;
  const fr = at(st, f.anim * (hooked && s.run > 0 ? 2.2 : 1));
  const scale = fishLen(f) / st.frames[0][6]; // 내용 폭을 몸길이로
  const flip = f.hx < 0 ? -1 : 1;
  let rot = (flip > 0 ? Math.atan2(f.hy, f.hx) : -Math.atan2(f.hy, -f.hx)) * 0.6;
  if (hooked && s.run > 0) rot += Math.sin(t * 32) * 0.16; // 날뛸 땐 몸부림
  // 펄쩍 뛰어 물 밖에 있는 동안은 그림자가 옅다
  const air = hooked && s.jumpT > 0 ? 0.3 : 1;
  const base = s.spot.shadowAlpha ?? 0.32;
  cell(ctx, IMG('shadow'), fr, f.x, f.y, scale, flip, rot, (hooked ? base + 0.13 : base) * f.alpha * air);
  // 전설 물고기는 가끔 반짝인다 — 알아보고 노리게
  if (f.def.legendary && f.mode !== 'leave') {
    const lt = (t + f.id * 0.7) % 2.4;
    const sp = A.fx.states.catch_sparkle;
    if (lt < sp.frames.length / sp.fps) cell(ctx, IMG('fx'), at(sp, lt), f.x, f.y - 6, 0.34, 1, 0, f.alpha);
  }
}

function catFrame(s: FishingState, t: number): number[] {
  const C = A.cat.states;
  switch (s.phase) {
    case 'ready':
      return C.cast.frames[0];
    case 'aim':
      return C.cast.frames[s.t < 0.12 ? 1 : 2]; // 낚싯대를 뒤로 젖힌다
    case 'cast':
      return C.cast.frames[Math.min(5, 3 + Math.floor((s.t / RULES.flight) * 3))];
    case 'wait':
    case 'bite':
      return at(C.wait, t);
    case 'hook':
      return at(C.hook, s.t);
    case 'reel':
      return at({ ...C.reel, fps: s.run > 0 ? 14 : C.reel.fps }, t);
    case 'caught':
      return at(C.success, s.t);
    default:
      return at(C.failure, s.t);
  }
}

/** 줄 끝 (찌 또는 걸린 물고기 입). 줄이 없으면 null */
function lineEnd(s: FishingState, tipX: number, tipY: number) {
  switch (s.phase) {
    case 'cast': {
      const p = Math.min(1, s.t / RULES.flight);
      return { x: tipX + (s.castX - tipX) * p, y: tipY + (s.castY - tipY) * p - Math.sin(Math.PI * p) * 150, flying: true };
    }
    case 'wait':
    case 'bite':
      return { x: s.bobX, y: s.bobY - 4 - liftUp(s), flying: false };
    case 'hook':
    case 'reel':
      return s.hooked ? { ...mouth(s.hooked), flying: false } : null;
    default:
      return null;
  }
}

function drawLine(ctx: CanvasRenderingContext2D, s: FishingState, x0: number, y0: number, x1: number, y1: number, t: number) {
  // 기다릴 땐 느슨하게 처지고, 당길수록 팽팽하게 곧아진다
  const sag =
    s.phase === 'cast' ? 8 : s.phase === 'wait' ? 55 : s.phase === 'bite' ? 28 : s.phase === 'hook' ? 8 : 40 * (1 - Math.min(1, s.tension / 0.6));
  const danger = s.phase === 'reel' && s.tension > 0.85;
  const jx = danger ? Math.sin(t * 60) * 2 : 0;
  ctx.strokeStyle = danger ? '#ff8a7a' : '#fff5d7';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + jx, (y0 + y1) / 2 + sag, x1, y1);
  ctx.stroke();
}

/** 찌올림: 찌가 쑥 떠오른 높이 (줄 끝도 따라 올라간다) */
const liftUp = (s: FishingState) => (s.phase === 'bite' && s.biteKind === 'lift' ? Math.min(1, s.reactT / 0.3) * 20 : 0);

function drawBobber(ctx: CanvasRenderingContext2D, s: FishingState, end: { x: number; y: number; flying: boolean } | null, t: number) {
  const F = A.fx.states;
  const img = IMG('fx');
  const k = 0.45;
  const lift = 26; // 찌 그림의 물에 닿는 곳이 칸 가운데보다 아래라 올려 그린다
  if (s.phase === 'cast' && end) cell(ctx, img, F.bobber_idle.frames[0], end.x, end.y - lift * 0.8, k * 0.8);
  else if (s.phase === 'wait') {
    if (s.dunkT > 0) {
      // 헛잠김: 잠기기 시작하는 앞 세 칸을 갔다가 되돌아온다 (반쯤 잠겼다 떠오름)
      const p = 1 - s.dunkT / 0.36;
      const sub = F.bobber_submerge.frames;
      cell(ctx, img, sub[Math.min(2, Math.floor((p < 0.5 ? p : 1 - p) * 2 * 3))], s.bobX, s.bobY - lift, k);
    } else if (s.nibbleT > 0) {
      // 톡: 짧은 톡은 빨리, 큰 톡은 천천히 한 번
      const nb = F.bobber_nibble.frames;
      cell(ctx, img, nb[Math.min(nb.length - 1, Math.floor((1 - s.nibbleT / s.nibbleLen) * nb.length))], s.bobX, s.bobY - lift, k);
    } else cell(ctx, img, at(F.bobber_idle, t), s.bobX, s.bobY - lift, k);
  } else if (s.phase === 'bite') {
    if (s.biteKind === 'lift') {
      // 찌올림: 쑥 떠오르면서 옆으로 눕는다
      const up = liftUp(s);
      const lie = Math.min(1, Math.max(0, (s.reactT - 0.1) / 0.3)) * 1.2;
      cell(ctx, img, F.bobber_idle.frames[0], s.bobX, s.bobY - lift - up, k, 1, -lie);
    } else if (s.biteKind === 'drag') {
      // 끌려간다: 끌리는 쪽으로 기울어 미끄러진다
      cell(ctx, img, F.bobber_idle.frames[Math.floor(t * 12) % 6], s.bobX, s.bobY - lift, k, 1, Math.sign(s.dragX || 1) * 0.45);
    } else cell(ctx, img, at(F.bobber_submerge, s.reactT), s.bobX, s.bobY - lift, k);
  }
}

function drawAim(ctx: CanvasRenderingContext2D, s: FishingState, tipX: number, tipY: number) {
  if (s.phase !== 'ready' && s.phase !== 'aim') return;
  const aim = s.phase === 'aim';
  ctx.save();
  // 날아갈 길 (점선 포물선)
  if (aim) {
    ctx.setLineDash([6, 10]);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const p = i / 24;
      const x = tipX + (s.aimX - tipX) * p;
      const y = tipY + (s.aimY - tipY) * p - Math.sin(Math.PI * p) * 150;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const r = aim ? s.ring : 18;
  const good = aim && s.ring < 16;
  ctx.strokeStyle = good ? '#8be08b' : 'rgba(255,255,255,0.85)';
  ctx.lineWidth = good ? 4 : 2.5;
  ctx.beginPath();
  ctx.ellipse(s.aimX, s.aimY, r, r * 0.55, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = good ? '#8be08b' : '#fff';
  ctx.beginPath();
  ctx.arc(s.aimX, s.aimY, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCatch(ctx: CanvasRenderingContext2D, s: FishingState, v: FishingViewOpts) {
  const c = s.catch!;
  const b = popupBox(s);
  const p = Math.min(1, s.t / 0.25);
  const pop = (1 + 0.12 * Math.sin(p * Math.PI) - 0.12 * (1 - p)) * uiK; // 톡 튀어나온다
  ctx.save();
  ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
  ctx.scale(pop, pop);
  ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
  ctx.globalAlpha = Math.min(1, s.t / 0.15);
  ctx.fillStyle = 'rgba(255,250,240,0.96)';
  ctx.strokeStyle = 'rgba(120,85,55,0.35)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, 30);
  ctx.fill();
  ctx.stroke();

  const cx = b.x + b.w / 2;
  const fy = b.y + 138;
  const sp = A.fx.states.catch_sparkle;
  cell(ctx, IMG('fx'), at(sp, s.t % (sp.frames.length / sp.fps)), cx, fy, 1.5, 1, 0, 0.9);
  const st = A.catch[c.kind];
  cell(ctx, catchImg(c.kind), at(st, s.t), cx, fy, 220 / st.frames[0][6]);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 38px system-ui, sans-serif';
  ctx.fillText(c.name, cx, b.y + 255);
  ctx.font = '30px system-ui, sans-serif';
  ctx.fillStyle = '#f0b429';
  ctx.fillText('★'.repeat(c.stars) + '☆'.repeat(5 - c.stars), cx, b.y + 293);
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 32px system-ui, sans-serif';
  ctx.fillText(`${c.cm.toFixed(1)} cm`, cx, b.y + 330);
  const badge = c.isNew ? ['NEW!', '#ef6b5e'] : c.record ? ['최고 기록!', '#f0b429'] : null;
  if (badge) {
    ctx.font = 'bold 26px system-ui, sans-serif';
    const w = ctx.measureText(badge[0]).width + 30;
    ctx.fillStyle = badge[1];
    ctx.beginPath();
    ctx.roundRect(b.x + 22, b.y + 20, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(badge[0], b.x + 22 + w / 2, b.y + 52);
  }
  const btn = popupButtons(s);
  button(ctx, btn.again, '다시 낚시', v.hover === 'again', 'main');
  button(ctx, btn.leave, '돌아가기', v.hover === 'leave', 'soft');
  ctx.restore();
}

/** main = 주황 (주 버튼) · soft = 크림 판 위의 옅은 버튼 · plain = 배경 위에 뜨는 불투명 크림 버튼 */
function button(ctx: CanvasRenderingContext2D, r: Rect, text: string, hover: boolean, style: 'main' | 'soft' | 'plain') {
  const main = style === 'main';
  ctx.fillStyle = main
    ? hover ? '#f08a3c' : '#f5a05a'
    : style === 'soft' ? hover ? 'rgba(120,85,55,0.25)' : 'rgba(120,85,55,0.14)'
    : hover ? '#ffffff' : 'rgba(255,250,240,0.92)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
  ctx.fill();
  if (style === 'plain') {
    ctx.strokeStyle = 'rgba(120,85,55,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.fillStyle = main ? '#fff' : '#5b4a3f';
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 10);
}

function drawUi(ctx: CanvasRenderingContext2D, s: FishingState, v: FishingViewOpts) {
  const [W] = s.spot.size;
  ctx.save();
  ctx.textAlign = 'left';
  // 도감 판 (누르면 전체 도감)
  ctx.save();
  zoom(ctx, DEX_PANEL.x, DEX_PANEL.y);
  const kinds = Object.keys(s.spot.fish);
  const got = kinds.filter((k) => s.dex[k]).length;
  ctx.fillStyle = v.hover === 'dex' ? 'rgba(255,255,255,0.96)' : 'rgba(255,250,240,0.88)';
  ctx.beginPath();
  ctx.roundRect(DEX_PANEL.x, DEX_PANEL.y, DEX_PANEL.w, DEX_PANEL.h, 24);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.fillText(`${s.spot.name} · 낚시`, 46, 64);
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillText(`도감 ${got}/${kinds.length} · 이번에 ${s.caughtCount}마리`, 46, 98);
  if (dexReady(s)) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c0703a';
    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.fillText('📖 전체 도감 ›', DEX_PANEL.x + DEX_PANEL.w - 20, 98);
    ctx.textAlign = 'left';
  }
  kinds.forEach((k, i) => {
    const st = A.catch[k];
    const x = 46 + i * 80 + 36;
    const y = 150;
    ctx.fillStyle = 'rgba(120,85,55,0.1)';
    ctx.beginPath();
    ctx.roundRect(x - 36, y - 34, 72, 68, 14);
    ctx.fill();
    const im = fishImg(k, !!s.dex[k]);
    if (im) cell(ctx, im, st.frames[0], x, y, 64 / st.frames[0][6], 1, 0, s.dex[k] ? 1 : 0.3);
    if (s.dex[k]) {
      ctx.fillStyle = '#5b4a3f';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${s.dex[k].best.toFixed(0)}cm`, x, y + 30);
      ctx.textAlign = 'left';
    }
  });
  ctx.restore();

  // 돌아가기
  ctx.save();
  zoom(ctx, W - 24, 22);
  button(ctx, exitBtn(s), v.touch ? '돌아가기' : '돌아가기 (Esc)', v.hover === 'leave' && s.phase !== 'caught', 'plain');
  ctx.restore();

  // 장력 게이지
  if (s.phase === 'reel' || s.phase === 'hook') {
    ctx.save();
    zoom(ctx, ...tensionAnchor(s));
    drawTension(ctx, s, v.t);
    ctx.restore();
  }

  // 알림 글자
  if (banner) {
    const a = Math.min(1, (1.8 - banner.t) / 0.3);
    ctx.globalAlpha = a;
    zoom(ctx, W * 0.66, 300);
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8;
    ctx.strokeStyle = 'rgba(70,52,42,0.85)';
    const y = 300 - Math.min(1, banner.t / 0.2) * 20;
    ctx.strokeText(banner.text, W * 0.66, y);
    ctx.fillStyle = banner.color;
    ctx.fillText(banner.text, W * 0.66, y);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawTension(ctx: CanvasRenderingContext2D, s: FishingState, t: number) {
  const [W] = s.spot.size;
  const w = 600;
  const h = 30;
  const x = W / 2 - w / 2 + 120;
  const y = 812;
  ctx.fillStyle = 'rgba(255,250,240,0.9)';
  ctx.beginPath();
  ctx.roundRect(x - 120, y - 58, w + 150, 128, 22);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('장력', x - 96, y + 23);
  ctx.font = '18px system-ui, sans-serif';
  ctx.fillText('물고기 힘', x - 96, y + 56);
  // 느슨 · 좋음 · 위험 구간
  const z = (a: number, b: number, c: string) => {
    ctx.fillStyle = c;
    ctx.fillRect(x + w * a, y, w * (b - a), h);
  };
  z(0, RULES.slackBelow, '#9cc4d6');
  z(RULES.slackBelow, 0.85, '#8fd18a');
  z(0.85, 1, '#ef7b6b');
  const T = Math.min(1.04, s.tension);
  const shake = s.tension > 0.9 ? Math.sin(t * 70) * 3 : 0;
  ctx.fillStyle = '#4a3b33';
  ctx.fillRect(x + w * T - 3 + shake, y - 8, 6, h + 16);
  ctx.beginPath();
  ctx.moveTo(x + w * T + shake, y - 8);
  ctx.lineTo(x + w * T - 10 + shake, y - 22);
  ctx.lineTo(x + w * T + 10 + shake, y - 22);
  ctx.fill();
  // 물고기 기운
  ctx.fillStyle = 'rgba(120,85,55,0.18)';
  ctx.fillRect(x, y + 44, w, 12);
  ctx.fillStyle = s.tired ? '#8fd18a' : '#f5a05a';
  ctx.fillRect(x, y + 44, w * s.stamina, 12);
  // 할 일
  const hint = s.run > 0 && s.reeling ? ['놓아요!', '#ef6b5e'] : s.slack > 0.7 ? ['감아요!', '#3d8fd1'] : s.tired ? ['쭉 감아요!', '#4caf50'] : null;
  if (hint && Math.sin(t * 14) > -0.4) {
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = hint[1];
    ctx.fillText(hint[0], x + w / 2, y - 26);
  }
}

/** 낚시 안내 (화면 아래 안내줄). 터치 화면에선 키 안내를 빼고, 당기는 동안은 장력 판과 겹쳐서 비운다 (판이 할 일을 알려 준다) */
export function fishingHelp(s: FishingState, touch = false) {
  switch (s.phase) {
    case 'ready':
    case 'aim':
      return '물 위를 누르고 있다가 링이 가장 작을 때 떼면 던져요 · 그림자 물고기 앞쪽에 던지면 잘 물어요' + (touch ? '' : ' · B 도감 · Esc 돌아가기');
    case 'cast':
    case 'wait':
    case 'bite':
      return '톡톡·연타·헛잠김엔 기다리고 — 찌가 쏙 잠기거나, 쑥 떠오르거나, 옆으로 끌려가면 누르세요! · 아무도 안 물 때 누르면 다시 감아요';
    case 'hook':
    case 'reel':
      return touch ? '' : '누르고 있으면 감아요 · 물고기가 날뛰면 손을 떼요 (줄이 끊어져요) · 너무 오래 놓으면 바늘이 빠져요';
    case 'caught':
      return touch ? '화면을 누르면 다시 낚시' : '클릭/Space 다시 낚시 · B 도감 · Esc 돌아가기';
    default:
      return '다시 던져 봐요';
  }
}

// ── 물고기 도감 (전체 화면) ── 필드의 도감 버튼 · 낚시터의 도감 판 · B 키로 연다. ctx 는 CSS px.
// 디자인 좌표(가로 화면 1000×560 카드 3열 · 세로 화면 540×1040 카드 2열, 탭 2줄)로 그리고 화면에 맞춰 통째로 줄인다.
const PATTERN_NAME: Record<string, string> = { peck: '톡톡', flurry: '연타', lift: '찌올림', drag: '끌고가기', slam: '한방', fake: '헛잠김', hesitant: '망설임' };
const FIGHT_NAME: Record<string, string> = { steady: '꾸준', dart: '잔걸음', zigzag: '지그재그', heavy: '묵직', jump: '점프' };
const SPOT_IDS = Object.keys(SPOTS);

export function dexLayout(w: number, h: number) {
  const wide = w >= h;
  const L = wide ? { DW: 1000, DH: 560, cols: 3, tabRow: 7 } : { DW: 540, DH: 1040, cols: 2, tabRow: 4 };
  const sf = safe();
  const aw = w - sf.l - sf.r;
  const ah = h - sf.t - sf.b;
  const k = Math.min(1.25, (aw - 24) / L.DW, (ah - 24) / L.DH);
  const tw = (L.DW - 40 - 6 * (L.tabRow - 1)) / L.tabRow;
  const tabs = SPOT_IDS.map((_, i): Rect => ({ x: 20 + (i % L.tabRow) * (tw + 6), y: 88 + Math.floor(i / L.tabRow) * 62, w: tw, h: 56 }));
  const top = 88 + Math.ceil(SPOT_IDS.length / L.tabRow) * 62 + 10;
  return { ...L, k, ox: sf.l + (aw - L.DW * k) / 2, oy: sf.t + (ah - L.DH * k) / 2, tabs, top, close: { x: L.DW - 84, y: 8, w: 76, h: 76 } };
}

/** 도감 화면에서 누른 것 — 닫기(바깥·✕) · 탭 */
export function dexHit(w: number, h: number, x: number, y: number): 'close' | { tab: string } | null {
  const L = dexLayout(w, h);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inRect(L.close, px, py)) return 'close';
  const i = L.tabs.findIndex((r) => inRect(r, px, py));
  return i >= 0 ? { tab: SPOT_IDS[i] } : null;
}


/** 시트 칸을 첫 칸의 내용 크기로 box 안에 맞춰 (x, y) 가운데에 — 칸마다 같은 배율·같은 자리라 꿈틀대는 게 자연스럽다 */
function fitSprite(ctx: CanvasRenderingContext2D, img: CanvasImageSource | null, st: St, f: number[], x: number, y: number, box: number, alpha: number) {
  if (!img) return; // 아직 불러오는 중
  const [, , , , cx, cy, cw, chh] = st.frames[0];
  const k = Math.min(box / cw, box / chh);
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, f[0], f[1], f[2], f[3], x - (cx + cw / 2) * k, y - (cy + chh / 2) * k, f[2] * k, f[3] * k);
  ctx.globalAlpha = 1;
}

export function drawDex(ctx: CanvasRenderingContext2D, w: number, h: number, dex: Dex, tab: string, t: number) {
  const L = dexLayout(w, h);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.55)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(0, 0, L.DW, L.DH, 28);
  ctx.fill();

  // 제목 · 전체 몇 종 · 닫기
  const all = Object.keys(FISH);
  const title = '📖 물고기 도감';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 34px system-ui, sans-serif';
  ctx.fillText(title, 28, 58);
  const tw = ctx.measureText(title).width;
  ctx.fillStyle = '#9a7b62';
  ctx.font = '24px system-ui, sans-serif';
  ctx.fillText(`${all.filter((k) => dex[k]).length} / ${all.length}`, 28 + tw + 14, 58);
  const c = L.close;
  ctx.fillStyle = 'rgba(120,85,55,0.14)';
  ctx.beginPath();
  ctx.arc(c.x + c.w / 2, c.y + c.h / 2, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.font = 'bold 30px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('✕', c.x + c.w / 2, c.y + c.h / 2 + 11);

  // 낚시터 탭 — 다 모으면 금색 ★
  L.tabs.forEach((r, i) => {
    const id = SPOT_IDS[i];
    const kinds = Object.keys(SPOTS[id].fish);
    const n = kinds.filter((k) => dex[k]).length;
    const on = id === tab;
    ctx.fillStyle = on ? '#f5a05a' : 'rgba(120,85,55,0.1)';
    ctx.beginPath();
    ctx.roundRect(r.x, r.y, r.w, r.h, 16);
    ctx.fill();
    ctx.fillStyle = on ? '#fff' : '#5b4a3f';
    fitText(ctx, SPOTS[id].short, r.x + r.w / 2, r.y + 26, r.w - 10, 22, 'bold ');
    ctx.fillStyle = on ? '#fff' : n === kinds.length ? '#e0a000' : '#9a7b62';
    fitText(ctx, `${n === kinds.length ? '★ ' : ''}${n}/${kinds.length}`, r.x + r.w / 2, r.y + 48, r.w - 10, 17);
  });

  // 물고기 카드
  const kinds = Object.keys(SPOTS[tab].fish);
  const rows = Math.ceil(kinds.length / L.cols);
  const cw = (L.DW - 40 - 12 * (L.cols - 1)) / L.cols;
  const ch = (L.DH - L.top - 20 - 12 * (rows - 1)) / rows;
  kinds.forEach((id, i) =>
    dexCard(ctx, id, dex[id], { x: 20 + (i % L.cols) * (cw + 12), y: L.top + Math.floor(i / L.cols) * (ch + 12), w: cw, h: ch }, t + i * 0.37),
  );
  ctx.restore();
}

/** 잡은 종은 꿈틀대는 그림·이름·최고 기록·입질/당기기 버릇, 못 잡은 종은 검은 실루엣·??? (별은 보여 줘서 귀한 걸 안다) */
function dexCard(ctx: CanvasRenderingContext2D, id: string, rec: Dex[string] | undefined, r: Rect, t: number) {
  const def = FISH[id];
  const st = A.catch[id];
  ctx.fillStyle = rec ? '#ffffff' : 'rgba(120,85,55,0.08)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 20);
  ctx.fill();
  if (rec) {
    ctx.strokeStyle = 'rgba(120,85,55,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // 넓은 카드는 그림 왼쪽 · 글 오른쪽, 좁은 카드(세로 화면)는 그림 위 · 글 아래
  const vert = r.w < r.h * 1.3;
  const box = vert ? Math.min(r.w - 40, r.h - 156) : Math.min(r.h - 40, r.w * 0.36);
  const bx = vert ? r.x + r.w / 2 : r.x + 14 + box / 2;
  const by = vert ? r.y + 12 + box / 2 : r.y + r.h / 2;
  ctx.fillStyle = rec ? 'rgba(111,211,255,0.2)' : 'rgba(120,85,55,0.08)';
  ctx.beginPath();
  ctx.arc(bx, by, box / 2, 0, Math.PI * 2);
  ctx.fill();
  fitSprite(ctx, fishImg(id, !!rec), st, rec ? at(st, t) : st.frames[0], bx, by, box * 0.86, rec ? 1 : 0.3);

  const x = vert ? r.x + r.w / 2 : r.x + 28 + box;
  const mw = vert ? r.w - 20 : r.w - 42 - box;
  const y = vert ? r.y + 12 + box + 30 : r.y + r.h / 2 - 42;
  ctx.textAlign = vert ? 'center' : 'left';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, rec ? def.name : '???', x, y, mw, 25, 'bold ');
  ctx.fillStyle = '#f0b429';
  fitText(ctx, '★'.repeat(def.stars) + '☆'.repeat(5 - def.stars), x, y + 28, mw, 20);
  if (rec) {
    ctx.fillStyle = '#5b4a3f';
    fitText(ctx, `최고 ${rec.best.toFixed(1)}cm · ${rec.count}마리`, x, y + 56, mw, 19);
    const top = Object.entries(def.patterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([p]) => PATTERN_NAME[p] ?? p)
      .join('·');
    ctx.fillStyle = '#9a7b62';
    fitText(ctx, `입질 ${top}`, x, y + 81, mw, 17);
    fitText(ctx, `당기기 ${FIGHT_NAME[def.fight] ?? def.fight}`, x, y + 103, mw, 17);
  } else {
    ctx.fillStyle = '#9a7b62';
    fitText(ctx, '아직 못 낚았어요', x, y + 56, mw, 19);
  }
}

