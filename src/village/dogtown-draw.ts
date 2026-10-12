// 강아지마을 그리기 — 전용 배경(backgrounds/village/dog_village_field_v2, 1254×1254)을 크게 보여 주고 고양이를 따라간다 (town-draw — 고양이마을과 같은 카메라).
// 주민 여덟은 전용 시트(characters/npcs/village_dogs — 동작 8줄 × 6컷)로: 대기 · 인사 · 일 A/B/C · 애정. 시트는 오른쪽을 보고 있어 왼쪽은 뒤집는다.
// 시설 간판 · 주민 머리 위 할 일 표지(✅ 보고할 의뢰 · 🚨 구조 요청 · 👃 보물 냄새 · 📦 배달 받을 이) · 대사 말풍선 · HUD.
// 창(디자인 좌표 1000×560 · 540×1040): 주민마다 일 — 길드 게시판 · 대장간(장비 고르기 · 값 · 망치질 카드) · 우체국 · 탐험가 · 훈련장 · 구조대 · 미용실(준비 중).
// 필드에서 쓰는 것도 여기: 보물 ✕ · 구조 ❗ 표시(필드 · 미니맵), 구조 로프 카드. 로직은 dogtown.ts · guild.ts · forge.ts · rope.ts.
import { button, drawCoin, drawIcon, itemCell, statText, toast } from '../bag/bag-draw.ts';
import { count, forgeLevel, ITEMS, itemStats, MAX_FP, SLOT_NAME, STAT_KEYS, type Bag, type Slot } from '../bag/bag.ts';
import DOG_SHEETS from '../data/village-dogs.json' with { type: 'json' };
import { image } from '../shared/assets.ts';
import { drawEmote } from '../shared/emote.ts';
import { drawLeave, drawPill, miniLayout, type MiniButton } from '../shared/mini-draw.ts';
import { CAT_FPS, CAT_ROW } from '../shared/cat.ts';
import { buyCos, COS, COS_SLOT_NAME, COS_TABS, cosPrice, takeOffAll, wearCos, type CosSlot, type Wardrobe } from '../shared/cosmetics.ts';
import { drawCosIcon, drawWorn } from '../shared/cosmetics-draw.ts';
import { drawFrame, type Sheet } from '../shared/sheet.ts';
import { fitText, wrapText } from '../shared/touch.ts';
import {
  acceptOrder,
  acceptRescue,
  CALLS,
  callWait,
  DC,
  digSpot,
  dogLine,
  DOGS,
  DOGTOWN,
  dropOrder,
  dueLeft,
  failedOrder,
  nextOffer,
  postOffer,
  readMap,
  recipient,
  setDogAnim,
  sniffWait,
  type Call,
  type DogSave,
  type DogtownState,
} from './dogtown.ts';
import { applyForge, forgeCost, forgeList, HAMMER, hammerPress, makeHammer, merge, mergeTarget, payForge, refFp, refId, updateHammer, type ForgeRef, type Hammer } from './forge.ts';
import { progressOf, questDef, questDone, rankOf, reroll, turnIn, type TurnIn } from './guild.ts';
import { ROPE, ropeK, type Rope } from './rope.ts';
import { bubble, cardLayout, closeX, drawCut, drawTownCat, drawTownGround, fitX, inR, panelLayout, sheetBg, signLabel, type Atlas, type PL, type R } from './town-draw.ts';

// ── 배경 · 주민 시트 ──
const BG = image(DOGTOWN.image);
const ATLAS = DOG_SHEETS as Record<string, Atlas>;
export const dogtownReady = Promise.all([BG.ready, ...Object.values(ATLAS).map((a) => image(a.file).ready)]);
/** 주민 그림 배율 — 시트 칸(181)에서 강아지가 약 96px: 치즈 키의 1.3배 × 품종 size (고양이마을 주민과 같은 식) */
const dogScale = (i: number) => (DC * 1.3 * DOGS[i].size) / 96;
/** 지금 동작의 컷 — 대기는 되풀이, 나머지는 마지막 컷에서 머문다 */
function frameOf(a: Atlas, anim: string, t: number) {
  const an = a.anims[anim] ?? a.anims.idle;
  const k = Math.floor(t * an.fps);
  return an.f[anim === 'idle' ? k % an.f.length : Math.min(an.f.length - 1, k)];
}
/** 주민 한 마리 (발밑 x, y) — 그림자 · 시트 컷. 돌려주는 것: 정수리 높이 */
function drawDog(ctx: CanvasRenderingContext2D, i: number, p: { anim: string; animT: number; flip: number; hop: number }, x: number, y: number, k = dogScale(i)) {
  const a = ATLAS[DOGS[i].sheet];
  const im = image(a.file).img;
  const z = p.hop > 0 ? Math.sin((p.hop / 0.5) * Math.PI) * DC * 0.35 : 0;
  const size = DOGS[i].size;
  ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, DC * 0.4 * size, DC * 0.14 * size, 0, 0, Math.PI * 2);
  ctx.fill();
  const cut = frameOf(a, p.anim, p.animT);
  drawCut(ctx, im, cut, x, y - z, k, p.flip);
  return y - z - (cut[5] - 30) * k;
}
/** 주민 머리 위 할 일 표지 — 보고할 의뢰 · 구조 요청 · 보물 냄새 · 배달 받을 이 */
function badgeOf(i: number, save: DogSave, bag: Bag, now: number) {
  const d = DOGS[i];
  if (save.parcels.some((p) => p.to === `dog:${d.id}` && !failedOrder(p, now))) return '📦';
  if (d.job === 'guild' && save.guild.quests.some((q) => questDone(q, bag))) return '✅';
  if (d.job === 'rescue' && save.call && !save.call.on) return '🚨';
  if (d.job === 'explorer' && save.dig === null && (sniffWait(save, now) === 0 || count(bag, DOGTOWN.explorer.map) > 0)) return '👃';
  return '';
}

// ── 화면 상태 ──
export type DogPanel =
  | { kind: 'dog'; i: number }
  /** 망치질 — 끝나면 res */
  | { kind: 'hammer'; ref: ForgeRef; id: string; from: number; h: Hammer; res: { stars: number; lv: number; up: boolean } | null }
  | null;
export const dogView = {
  panel: null as DogPanel,
  line: '',
  /** 길드: 고른 의뢰 · 대장간: 고른 장비 (forgeList 번호) */
  sel: 0,
  msg: '',
  msgT: 0,
  /** 미용실: 보는 탭 · 고른 소품 (입어 보기) */
  cosTab: 0,
  cosPick: null as string | null,
  /** 화면 카메라 · 캔버스 변환 (검증용 — town-draw 가 채운다) */
  cam: null as { x: number; y: number } | null,
  sc: 1,
  ox: 0,
  oy: 0,
};
const dsay = (msg: string) => Object.assign(dogView, { msg, msgT: 2.6 });
/** 옷장 (미용실) · 치즈 시트 (모습 원에 입어 보기) — main 이 처음에 한 번 */
let closet: Wardrobe = { owned: [], worn: {} };
let catSheet: Sheet | null = null;
export function setSalon(w: Wardrobe, cat: Sheet) {
  closet = w;
  catSheet = cat;
}
export function resetDogView() {
  Object.assign(dogView, { panel: null, line: '', sel: 0, msg: '', msgT: 0, cam: null });
}

/** 장면 그리기 (창은 drawDogPanel). debug = 걷는 영역 · 막힌 곳 보기 (G 키) */
export function drawDogtown(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  s: DogtownState,
  save: DogSave,
  bag: Bag,
  cat: Sheet,
  v: { t: number; dt: number; touch: boolean; hover: MiniButton; now: number; debug?: boolean },
) {
  const { seen, pad, dpr, w, h } = drawTownGround(ctx, cw, ch, DOGTOWN as unknown as Parameters<typeof drawTownGround>[3], BG.img, s.cat, dogView, v.dt, v.debug);
  // 시설 간판 (미용실은 회색 — 준비 중)
  DOGS.forEach((d) => signLabel(ctx, seen, pad, d.sign[0], d.sign[1], DC, d.label, v.t, '#c0582c'));
  type Thing = { y: number; draw: () => void };
  const things: Thing[] = s.dogs.map((p, i) => ({
    y: p.y,
    draw: () => {
      if (p.x < seen.x0 - DC * 1.5 || p.x > seen.x1 + DC * 1.5) return; // 화면 밖은 그리지 않는다
      const top = drawDog(ctx, i, p, p.x, p.y);
      if (p.sayT > 0) return bubble(ctx, seen, p.x, top + DC * 0.1, p.y + DC * 0.2, p.say, DC * 5.2, DC * 0.34, Math.min(1, p.sayT / 0.3));
      const b = badgeOf(i, save, bag, v.now);
      if (!b) return;
      const bob = Math.sin(v.t * 4 + i) * DC * 0.05;
      const bx = fitX(seen, p.x - p.flip * DC * 0.4, DC * 0.34, pad);
      const by = top + DC * 0.15 + bob;
      ctx.fillStyle = 'rgba(255, 252, 244, 0.97)';
      ctx.strokeStyle = '#ef6b5e';
      ctx.lineWidth = DC * 0.04;
      ctx.beginPath();
      ctx.arc(bx, by, DC * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `${DC * 0.34}px "Segoe UI Emoji", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(b, bx, by + DC * 0.12);
    },
  }));
  things.push({
    y: s.cat.y,
    draw: () => {
      drawTownCat(ctx, cat, s.cat.x, s.cat.y, DC, s.cat.flip, s.cat.moving, s.cat.animT);
      drawEmote(ctx, s.cat.x, s.cat.y - DC * 1.25, DC * 0.8);
    },
  });
  things.sort((a, b) => a.y - b.y).forEach((o) => o.draw());
  // HUD
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const L = miniLayout(w, h);
  const r = rankOf(save.guild.gp);
  drawPill(ctx, L, ['🐶 강아지마을', `길드 등급 ${r.name} · ${save.guild.gp}점`]);
  drawLeave(ctx, L, v.hover, v.touch);
}

// ── 창 자리 ── 주민 창: 모습 · 이름 · 대사 · 일마다 내용(area)
function dogLayout(L: PL) {
  return L.wide
    ? { portrait: { x: 125, y: 125, r: 92 }, info: { x: 125, y: 256 }, bubble: { x: 250, y: 22, w: 650, h: 92 } as R, area: { x: 250, y: 128, w: 730, h: 412 } as R }
    : { portrait: { x: 112, y: 124, r: 86 }, info: { x: 365, y: 120 }, bubble: { x: 20, y: 226, w: 500, h: 92 } as R, area: { x: 20, y: 334, w: 500, h: 690 } as R };
}
/** 길드: 등급 줄 · 의뢰 카드 셋 (카드마다 보고 · 바꾸기 버튼) */
function guildLayout(A: R, wide: boolean) {
  const top = wide ? 62 : 70;
  const ch = (A.h - top - 20) / 3;
  const cards = [0, 1, 2].map((k): R => ({ x: A.x, y: A.y + top + k * (ch + 10), w: A.w, h: ch }));
  const btn = (c: R): R => (wide ? { x: c.x + c.w - 190, y: c.y + (c.h - 52) / 2, w: 172, h: 52 } : { x: c.x + c.w - 190, y: c.y + c.h - 66, w: 172, h: 52 });
  return { cards, btns: cards.map(btn) };
}
/** 대장간: 장비 칸 (한 쪽 PER 칸) · 쪽 넘기기 · 고른 장비 설명 · 강화 · 합치기 */
const PER = 12;
function forgeLayout(A: R, wide: boolean) {
  const cols = wide ? 4 : 6;
  const cells = Array.from({ length: PER }, (_, k): R => ({ x: A.x + (k % cols) * 84, y: A.y + Math.floor(k / cols) * 92, w: 76, h: 84 }));
  const py = A.y + Math.ceil(PER / cols) * 92;
  const prev: R = { x: A.x, y: py, w: 64, h: 44 };
  const next: R = { x: A.x + cols * 84 - 72, y: py, w: 64, h: 44 };
  const D: R = wide ? { x: A.x + 356, y: A.y, w: A.w - 356, h: A.h } : { x: A.x, y: py + 56, w: A.w, h: A.y + A.h - py - 56 };
  const up: R = { x: D.x + 16, y: D.y + D.h - 64, w: D.w - 32 - 150, h: 52 };
  const join: R = { x: D.x + D.w - 156, y: up.y, w: 140, h: 52 };
  return { cells, prev, next, D, up, join };
}
/** 우체국: 걸린 주문 카드(맡기 · 다른 주문) · 맡은 배달 줄(그만두기) */
function postLayout(A: R, wide: boolean) {
  const O: R = { x: A.x, y: A.y, w: A.w, h: wide ? 150 : 236 };
  const take: R = wide ? { x: O.x + O.w - 200, y: O.y + 20, w: 180, h: 52 } : { x: O.x + 16, y: O.y + O.h - 68, w: O.w / 2 - 24, h: 52 };
  const other: R = wide ? { x: O.x + O.w - 200, y: O.y + 82, w: 180, h: 52 } : { x: O.x + O.w / 2 + 8, y: O.y + O.h - 68, w: O.w / 2 - 24, h: 52 };
  const top = O.y + O.h + 44;
  const rh = wide ? 92 : 150;
  const rows = [0, 1].map((k): R => ({ x: A.x, y: top + k * (rh + 10), w: A.w, h: rh }));
  const drops = rows.map((r): R => (wide ? { x: r.x + r.w - 150, y: r.y + (r.h - 52) / 2, w: 134, h: 52 } : { x: r.x + r.w - 150, y: r.y + r.h - 64, w: 134, h: 52 }));
  return { O, take, other, top, rows, drops };
}
/** 탐험가 · 훈련장 · 구조대 · 미용실: 위에 글 카드, 아래 버튼 (둘이면 나란히 · 세로 화면은 위아래) */
function simpleLayout(A: R, wide: boolean, n: number) {
  const S: R = { x: A.x, y: A.y, w: A.w, h: wide ? 210 : 330 };
  const by = S.y + S.h + 20;
  const btns =
    n === 1 ? [{ x: A.x + A.w / 2 - 170, y: by, w: 340, h: 58 } as R] : wide ? [0, 1].map((k): R => ({ x: A.x + k * (A.w / 2 + 6), y: by, w: A.w / 2 - 6, h: 58 })) : [0, 1].map((k): R => ({ x: A.x, y: by + k * 70, w: A.w, h: 58 }));
  return { S, btns, foot: by + (wide || n === 1 ? 80 : 150) };
}

/** 미용실: 탭 일곱 · 소품 칸 (5 × 4) · 고른 소품 설명 · 사기/입기/벗기 · 모두 벗기 */
function salonLayout(A: R, wide: boolean) {
  const n = COS_TABS.length;
  const tw = A.w / n;
  const tabs = COS_TABS.map((_, k): R => ({ x: A.x + k * tw + 2, y: A.y, w: tw - 4, h: 40 }));
  const cs = wide ? 66 : 86;
  const step = cs + (wide ? 6 : 8);
  const cells = Array.from({ length: 20 }, (_, k): R => ({ x: A.x + (k % 5) * step, y: A.y + 50 + Math.floor(k / 5) * step, w: cs, h: cs }));
  const gy = A.y + 50 + 4 * step;
  const D: R = wide ? { x: A.x + 5 * step + 12, y: A.y + 50, w: A.w - 5 * step - 12, h: A.h - 50 } : { x: A.x, y: gy + 4, w: A.w, h: A.y + A.h - gy - 4 };
  const main: R = wide ? { x: D.x + 14, y: D.y + D.h - 124, w: D.w - 28, h: 54 } : { x: D.x, y: D.y + D.h - 60, w: D.w * 0.6 - 6, h: 54 };
  const off: R = wide ? { x: D.x + 14, y: D.y + D.h - 60, w: D.w - 28, h: 48 } : { x: D.x + D.w * 0.6 + 6, y: main.y, w: D.w * 0.4 - 6, h: 54 };
  return { tabs, cells, D, main, off };
}
/** 창에서 누를 곳 가운데 (CSS px) — 검증용 */
export function dogPoints(w: number, h: number) {
  const L = panelLayout(w, h);
  const mid = (r: R) => ({ x: L.ox + (r.x + r.w / 2) * L.k, y: L.oy + (r.y + r.h / 2) * L.k });
  const D = dogLayout(L);
  const G = guildLayout(D.area, L.wide);
  const F = forgeLayout(D.area, L.wide);
  const P = postLayout(D.area, L.wide);
  const S1 = simpleLayout(D.area, L.wide, 1);
  const S2 = simpleLayout(D.area, L.wide, 2);
  const C = cardLayout(L);
  return {
    close: mid(L.close),
    quests: G.btns.map(mid),
    cells: F.cells.map(mid),
    up: mid(F.up),
    join: mid(F.join),
    take: mid(P.take),
    other: mid(P.other),
    drops: P.drops.map(mid),
    one: mid(S1.btns[0]),
    salon: ((Z) => ({ tabs: Z.tabs.map(mid), cells: Z.cells.map(mid), main: mid(Z.main), off: mid(Z.off) }))(salonLayout(D.area, L.wide)),
    two: S2.btns.map(mid),
    ok: mid(C.ok),
    card: mid(C.card),
  };
}

// ── 주민 창 열기 · 할 일 ──
export type DogAct =
  | { kind: 'close' }
  | { kind: 'shop' }
  | { kind: 'train' }
  | { kind: 'turnin'; res: TurnIn & { ok: true } }
  | { kind: 'paid' }
  | { kind: 'hammer' }
  | { kind: 'strike'; good: boolean }
  | { kind: 'forged'; stars: number; up: boolean }
  | { kind: 'post' }
  | { kind: 'map' }
  | { kind: 'rescue' }
  | { kind: 'fail' }
  /** 미용실에서 사거나 입었다 (옷장 저장) */
  | { kind: 'cos' }
  | { kind: 'pick' }
  | null;
/** 주민 창 열기 — 고등어 아저씨는 상점 창 (main) */
export function openDogPanel(i: number, s: DogtownState, save: DogSave, bag: Bag, now: number): DogAct {
  if (DOGS[i].job === 'shop') return { kind: 'shop' };
  dogView.panel = { kind: 'dog', i };
  dogView.line = dogLine(save, bag, i, now, s.rng);
  dogView.sel = 0;
  dogView.msgT = 0;
  dogView.cosPick = null;
  if (DOGS[i].job === 'post') postOffer(save, s.rng);
  return { kind: 'pick' };
}
const fail = (msg: string): DogAct => (dsay(msg), { kind: 'fail' });
const cheer = (s: DogtownState, i: number, line: string, anim: 'affection' | 'job_a' | 'job_b' | 'job_c' = 'affection') => {
  setDogAnim(s.dogs[i], anim);
  s.dogs[i].hop = 0.5;
  dogView.line = line;
};
const jobOf = (i: number) => DOGS[i].job;

function doReport(k: number, s: DogtownState, save: DogSave, bag: Bag, i: number): DogAct {
  const q = save.guild.quests[k];
  if (!q) return null;
  const res = turnIn(save.guild, bag, k, s.rng);
  if (!res.ok) return fail(res.why === '아직 다 못 했어요' ? `아직이에요 — ${progressOf(q, bag)}/${questDef(q.id).n}` : res.why);
  cheer(s, i, res.rankUp ? `축하하네! 오늘부터 자네는 ${res.rankUp} 등급 모험가다!` : `수고했네! "${res.title}" 보상이다`, res.rankUp ? 'job_b' : 'affection');
  dsay(`냥코인 +${res.coins} · 길드 점수 +${res.gp}${res.rankUp ? ` · 등급 ${res.rankUp}!` : ''}`);
  return { kind: 'turnin', res };
}
function doReroll(k: number, s: DogtownState, save: DogSave, bag: Bag, i: number): DogAct {
  const why = reroll(save.guild, bag, k, s.rng);
  if (why) return fail(why);
  cheer(s, i, '새 의뢰를 붙여 두었네', 'job_c');
  return { kind: 'post' };
}
function doForge(ref: ForgeRef | undefined, s: DogtownState, bag: Bag, i: number): DogAct {
  if (!ref) return fail('강화할 장비가 없어요');
  const id = refId(bag, ref)!;
  const from = forgeLevel(refFp(bag, ref));
  const why = payForge(bag, ref);
  if (why) return fail(why);
  dogView.panel = { kind: 'hammer', ref, id, from, h: makeHammer(), res: null };
  dogView.msgT = 0;
  setDogAnim(s.dogs[i], 'job_a');
  return { kind: 'paid' };
}
function doMerge(ref: ForgeRef | undefined, s: DogtownState, bag: Bag, i: number): DogAct {
  if (!ref) return fail('합칠 장비가 없어요');
  const id = refId(bag, ref)!;
  const why = merge(bag, ref);
  if (why) return fail(why);
  cheer(s, i, `${ITEMS[id].name} 둘을 하나로! +${forgeLevel(refFp(bag, ref))} 이 됐다`, 'job_b');
  return { kind: 'post' };
}
function doTake(s: DogtownState, save: DogSave, i: number, now: number): DogAct {
  const why = acceptOrder(save, now, s.rng);
  if (why) return fail(why);
  const o = save.parcels[save.parcels.length - 1];
  cheer(s, i, `${recipient(o.to).name}에게 ${ITEMS[o.item].name} ${o.n}개! 부탁해요`, 'job_b');
  return { kind: 'post' };
}
function doMap(how: 'map' | 'sniff', s: DogtownState, save: DogSave, bag: Bag, i: number, now: number): DogAct {
  const why = readMap(save, bag, how, now, s.rng);
  if (why) return fail(why);
  cheer(s, i, `킁킁… ${digSpot(save)!.hint}! 필드 지도에 ✕ 를 그려 뒀어`, how === 'map' ? 'job_b' : 'job_a');
  return { kind: 'map' };
}
function doRescue(s: DogtownState, save: DogSave, i: number): DogAct {
  if (!save.call) return fail('지금은 구조 요청이 없어요');
  acceptRescue(save);
  cheer(s, i, `${CALLS[save.call.i].place}(으)로 출동! 필드 지도에 ❗ 를 표시했네`, 'job_a');
  return { kind: 'rescue' };
}
/** 탐험가 · 훈련장 · 구조대 버튼 (누른 버튼 번호 n) */
function doSimple(n: number, s: DogtownState, save: DogSave, bag: Bag, i: number, now: number): DogAct {
  const job = jobOf(i);
  if (job === 'explorer') return doMap(n === 0 ? 'map' : 'sniff', s, save, bag, i, now);
  if (job === 'training') return { kind: 'train' };
  if (job === 'rescue') return save.call && !save.call.on ? doRescue(s, save, i) : null;
  if (job === 'salon') return cosMain();
  return null;
}
/** 미용실 큰 버튼: 안 가졌으면 사기 · 가졌으면 입기 / 벗기 */
function cosMain(): DogAct {
  const id = dogView.cosPick;
  if (!id) return fail('소품을 먼저 골라요');
  if (!closet.owned.includes(id)) {
    const why = buyCos(closet, bagRef, id);
    if (why) return fail(why);
    dsay(`${COS[id].name}을(를) 샀어요! (-${cosPrice(id)}냥)`);
  }
  wearCos(closet, id);
  dogView.line = closet.worn[COS[id].slot] === id ? '어머, 정말 잘 어울려요!' : '벗었어요. 다른 것도 입어 볼래요?';
  return { kind: 'cos' };
}
/** 미용실 살 때 냥코인을 뺄 가방 (dogTap · dogKey 가 넣는다) */
let bagRef: { coins: number } = { coins: 0 };
const closeDog = (): DogAct => ((dogView.panel = null), { kind: 'close' });
/** 망치질 한 프레임 (main) — 두드릴 때마다 무쇠가 망치질, 다 되면 별만큼 강화 점수 */
export function hammerStep(s: DogtownState, save: DogSave, bag: Bag, dt: number): DogAct {
  const P = dogView.panel;
  if (P?.kind !== 'hammer' || P.res) return null;
  updateHammer(P.h, dt);
  return hammerAfter(s, save, bag);
}
function hammerAfter(s: DogtownState, save: DogSave, bag: Bag): DogAct {
  const P = dogView.panel;
  if (P?.kind !== 'hammer' || P.res) return null;
  const fi = DOGS.findIndex((d) => d.job === 'forge');
  for (const e of P.h.events) if (e.type === 'strike') setDogAnim(s.dogs[fi], 'job_a');
  if (P.h.phase !== 'done') {
    const e = P.h.events.find((v) => v.type === 'strike');
    return e ? { kind: 'strike', good: e.grade !== 'miss' } : null;
  }
  const r = applyForge(bag, P.ref, P.h.stars);
  P.res = { stars: P.h.stars, lv: r.lv, up: r.up };
  save.forged++;
  dogView.line = r.up ? `+${r.lv}! 이 녀석, 한층 단단해졌군` : P.h.stars >= 2 ? '좋은 소리다! 조금만 더 두드리면 단계가 오른다' : '쇠가 좀 식었군… 그래도 조금은 단단해졌다';
  setDogAnim(s.dogs[fi], r.up ? 'job_b' : 'job_c');
  return { kind: 'forged', stars: P.h.stars, up: r.up };
}
const strike = (s: DogtownState, save: DogSave, bag: Bag): DogAct => {
  const P = dogView.panel;
  if (P?.kind !== 'hammer' || P.h.phase !== 'hit') return null;
  P.h.events.length = 0;
  hammerPress(P.h);
  return hammerAfter(s, save, bag);
};
const backToForge = (): DogAct => ((dogView.panel = { kind: 'dog', i: DOGS.findIndex((d) => d.job === 'forge') }), { kind: 'pick' });

/** 창을 눌렀다 (x, y = CSS px) */
export function dogTap(w: number, h: number, x: number, y: number, s: DogtownState, save: DogSave, bag: Bag, now: number): DogAct {
  const L = panelLayout(w, h);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  const P = dogView.panel;
  if (P?.kind === 'hammer') {
    if (P.res) return backToForge(); // 다 됐으면 어디를 눌러도 대장간으로
    return strike(s, save, bag);
  }
  if (!P) return null;
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inR(L.close, px, py)) return closeDog();
  const i = P.i;
  const D = dogLayout(L);
  const A = D.area;
  const job = jobOf(i);
  if (job === 'guild') {
    const G = guildLayout(A, L.wide);
    const k = G.btns.findIndex((r) => inR(r, px, py));
    if (k >= 0) return questDone(save.guild.quests[k], bag) ? doReport(k, s, save, bag, i) : doReroll(k, s, save, bag, i);
    const c = G.cards.findIndex((r) => inR(r, px, py));
    if (c >= 0) return (dogView.sel = c), { kind: 'pick' };
  } else if (job === 'forge') {
    const F = forgeLayout(A, L.wide);
    const list = forgeList(bag);
    const page = Math.floor(dogView.sel / PER);
    const c = F.cells.findIndex((r) => inR(r, px, py));
    if (c >= 0 && list[page * PER + c]) return (dogView.sel = page * PER + c), { kind: 'pick' };
    if (inR(F.prev, px, py) && page > 0) return (dogView.sel = (page - 1) * PER), { kind: 'pick' };
    if (inR(F.next, px, py) && (page + 1) * PER < list.length) return (dogView.sel = (page + 1) * PER), { kind: 'pick' };
    if (inR(F.up, px, py)) return doForge(list[dogView.sel], s, bag, i);
    if (inR(F.join, px, py)) return doMerge(list[dogView.sel], s, bag, i);
  } else if (job === 'post') {
    const Q = postLayout(A, L.wide);
    if (inR(Q.take, px, py)) return doTake(s, save, i, now);
    if (inR(Q.other, px, py)) return nextOffer(save, s.rng), { kind: 'post' };
    const k = Q.drops.findIndex((r, j) => save.parcels[j] && inR(r, px, py));
    if (k >= 0) return dsay(failedOrder(save.parcels[k], now) ? '실패한 배달을 지웠어요' : '배달을 그만뒀어요'), dropOrder(save, k), { kind: 'post' };
  } else if (job === 'salon') {
    bagRef = bag;
    const Z = salonLayout(A, L.wide);
    const t = Z.tabs.findIndex((r) => inR(r, px, py));
    if (t >= 0) return Object.assign(dogView, { cosTab: t, cosPick: null }), { kind: 'pick' };
    const ids = COS_TABS[dogView.cosTab][1];
    const c = Z.cells.findIndex((r, k) => ids[k] && inR(r, px, py));
    if (c >= 0) return (dogView.cosPick = ids[c]), { kind: 'pick' };
    if (inR(Z.main, px, py)) return cosMain();
    if (inR(Z.off, px, py)) return takeOffAll(closet), (dogView.line = '모두 벗었어요. 산뜻하네요!'), { kind: 'cos' };
  } else {
    const n = job === 'explorer' ? 2 : 1;
    const S = simpleLayout(A, L.wide, n);
    const k = S.btns.findIndex((r) => inR(r, px, py));
    if (k >= 0) return doSimple(k, s, save, bag, i, now);
  }
  return null;
}
/** 창 키: Esc 닫기 · 길드 ↑↓ 고르기 Enter 보고 R 바꾸기 · 대장간 ←→↑↓ 고르기 Enter 강화 M 합치기 · 우체국 Enter 맡기 N 다른 주문 · Enter 그 밖의 버튼 · 망치질 Space */
export function dogKey(code: string, s: DogtownState, save: DogSave, bag: Bag, now: number): DogAct {
  const P = dogView.panel;
  const go = code === 'Enter' || code === 'NumpadEnter' || code === 'Space' || code === 'KeyE';
  if (P?.kind === 'hammer') {
    if (P.res) return go || code === 'Escape' ? backToForge() : null;
    return go ? strike(s, save, bag) : null;
  }
  if (!P) return null;
  if (code === 'Escape') return closeDog();
  const i = P.i;
  const job = jobOf(i);
  const d = (a: string[], b: string[]) => (a.includes(code) ? -1 : b.includes(code) ? 1 : 0);
  if (job === 'guild') {
    const step = d(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']);
    if (step) return (dogView.sel = (dogView.sel + step + 3) % 3), { kind: 'pick' };
    if (go) return doReport(dogView.sel, s, save, bag, i);
    if (code === 'KeyR') return doReroll(dogView.sel, s, save, bag, i);
  } else if (job === 'forge') {
    const list = forgeList(bag);
    const cols = panelLayout(innerWidth, innerHeight).wide ? 4 : 6;
    const step = d(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) || d(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']) * cols;
    if (step && list.length) return (dogView.sel = Math.max(0, Math.min(list.length - 1, dogView.sel + step))), { kind: 'pick' };
    if (go) return doForge(list[dogView.sel], s, bag, i);
    if (code === 'KeyM') return doMerge(list[dogView.sel], s, bag, i);
  } else if (job === 'post') {
    if (go) return doTake(s, save, i, now);
    if (code === 'KeyN') return nextOffer(save, s.rng), { kind: 'post' };
  } else if (job === 'salon') {
    bagRef = bag;
    const ids = COS_TABS[dogView.cosTab][1];
    const n = /^(?:Digit|Numpad)([1-7])$/.exec(code)?.[1];
    if (n && COS_TABS[Number(n) - 1]) return Object.assign(dogView, { cosTab: Number(n) - 1, cosPick: null }), { kind: 'pick' };
    const step = d(['ArrowLeft', 'KeyA'], ['ArrowRight', 'KeyD']) || d(['ArrowUp', 'KeyW'], ['ArrowDown', 'KeyS']) * 5;
    if (step) {
      const k = Math.max(0, Math.min(ids.length - 1, (dogView.cosPick ? ids.indexOf(dogView.cosPick) : -step) + step));
      return (dogView.cosPick = ids[k]), { kind: 'pick' };
    }
    if (go) return cosMain();
    if (code === 'KeyX') return takeOffAll(closet), { kind: 'cos' };
  } else if (go) return doSimple(job === 'explorer' && !count(bag, DOGTOWN.explorer.map) ? 1 : 0, s, save, bag, i, now);
  return null;
}

// ── 창 그리기 ──
const box = (ctx: CanvasRenderingContext2D, r: R, fill = 'rgba(120,85,55,0.07)', stroke = '', lw = 2, rad = 16) => {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, rad);
  ctx.fill();
  if (!stroke) return;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lw;
  ctx.stroke();
};
const txt = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, px: number, color: string, bold = true, align: CanvasTextAlign = 'left') => {
  ctx.textAlign = align;
  ctx.fillStyle = color;
  fitText(ctx, s, x, y, maxW, px, bold ? 'bold ' : '');
};
/** 글을 폭에 맞춰 줄바꿈해 n 줄까지 — 돌려주는 것: 다음 줄 y */
const para = (ctx: CanvasRenderingContext2D, s: string, x: number, y: number, maxW: number, px: number, color: string, n = 3, lh = px * 1.4) => {
  ctx.font = `${px}px system-ui, sans-serif`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  const lines = wrapText(ctx, s, maxW).slice(0, n);
  lines.forEach((l, k) => ctx.fillText(l, x, y + k * lh));
  return y + lines.length * lh;
};
const bar = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number, color: string) => {
  box(ctx, { x, y, w, h }, 'rgba(120,85,55,0.15)', '', 0, h / 2);
  if (k > 0) box(ctx, { x, y, w: Math.max(h, w * Math.min(1, k)), h }, color, '', 0, h / 2);
};
const mmss = (secs: number) => `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

/** 창 그리기 (장면 위에) */
export function drawDogPanel(ctx: CanvasRenderingContext2D, w: number, h: number, s: DogtownState, save: DogSave, bag: Bag, t: number, dt: number, now: number, touch: boolean) {
  const P = dogView.panel;
  dogView.msgT = Math.max(0, dogView.msgT - dt);
  if (!P) return;
  const L = panelLayout(w, h);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.5)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  if (P.kind === 'hammer') drawHammer(ctx, L, P, s, t, touch);
  else drawDogSheet(ctx, L, P.i, s, save, bag, now, touch);
  toast(ctx, { wide: L.wide, DW: L.DW, DH: L.DH, detail: { x: 0, y: L.wide ? 0 : dogLayout(L).area.y, w: 0, h: 0 } }, dogView.msg, dogView.msgT);
  ctx.restore();
}

function drawDogSheet(ctx: CanvasRenderingContext2D, L: PL, i: number, s: DogtownState, save: DogSave, bag: Bag, now: number, touch: boolean) {
  const d = DOGS[i];
  const D = dogLayout(L);
  sheetBg(ctx, L);
  closeX(ctx, L);
  // 모습 (지금 동작 그대로) · 이름 · 하는 일 · 한 줄 기록
  const pt = D.portrait;
  ctx.fillStyle = '#e9eef6';
  ctx.beginPath();
  ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2);
  ctx.fill();
  const p = s.dogs[i];
  if (d.job === 'salon' && catSheet) {
    // 입어 보기: 걸친 것 + 고른 소품
    const over = { ...closet.worn, ...(dogView.cosPick ? { [COS[dogView.cosPick].slot]: dogView.cosPick } : {}) } as Partial<Record<CosSlot, string>>;
    const col = Math.floor((now / 1000) * CAT_FPS.idle) % 6;
    const size = (pt.r * 1.25 * catSheet.base) / catSheet.bodyH;
    drawFrame(ctx, catSheet, CAT_ROW.idle, col, pt.x, pt.y + pt.r * 0.6, size, 1);
    drawWorn(ctx, catSheet, CAT_ROW.idle, col, pt.x, pt.y + pt.r * 0.6, size, 1, undefined, over);
  } else drawDog(ctx, i, { ...p, flip: 1 }, pt.x, pt.y + pt.r * 0.62, (pt.r * 1.02) / 96);
  const I = D.info;
  txt(ctx, d.name, I.x, I.y, 280, 32, '#5b4a3f', true, 'center');
  txt(ctx, d.about, I.x, I.y + 28, L.wide ? 220 : 300, 15, '#9a7b62', false, 'center');
  const r = rankOf(save.guild.gp);
  const stat: Record<string, string> = {
    guild: `등급 ${r.name} · ${save.guild.gp}점 · 의뢰 ${save.guild.done}건`,
    forge: `망치질 ${save.forged}번`,
    shop: '',
    post: `배달 ${save.posted}번`,
    explorer: `판 보물 ${save.dug}번`,
    training: `훈련 ${save.trained}판`,
    rescue: `구조 ${save.rescued}번`,
    salon: `소품 ${closet.owned.length}/${Object.keys(COS).length}`,
  };
  txt(ctx, stat[d.job], I.x, I.y + 60, L.wide ? 220 : 300, 17, '#3f7fbf', true, 'center');
  // 대사
  const B = D.bubble;
  box(ctx, B, '#ffffff', 'rgba(120,85,55,0.35)', 2, 22);
  para(ctx, dogView.line, B.x + 20, B.y + 36, B.w - 40, 20, '#5b4a3f', 2, 28);
  const A = D.area;
  if (d.job === 'guild') drawGuild(ctx, L, A, save, bag);
  else if (d.job === 'forge') drawForge(ctx, L, A, bag);
  else if (d.job === 'post') drawPost(ctx, L, A, save, bag, now);
  else if (d.job === 'explorer') drawExplorer(ctx, L, A, save, bag, now);
  else if (d.job === 'training') drawTrainingInfo(ctx, L, A, save, touch);
  else if (d.job === 'rescue') drawRescue(ctx, L, A, save, now);
  else drawSalon(ctx, L, A, bag);
}

function drawGuild(ctx: CanvasRenderingContext2D, L: PL, A: R, save: DogSave, bag: Bag) {
  const r = rankOf(save.guild.gp);
  const ranks = DOGTOWN.guild.ranks as [string, number][];
  const lo = ranks[r.i][1];
  const hi = ranks[r.i + 1]?.[1] ?? lo;
  txt(ctx, `🛡️ 등급 ${r.name} · 길드 점수 ${save.guild.gp}${r.next !== null ? ` — ${r.nextName}까지 ${r.next}점` : ' — 가장 높은 등급!'}`, A.x, A.y + 24, A.w, 19, '#5b4a3f');
  bar(ctx, A.x, A.y + 36, A.w, 12, r.next === null ? 1 : (save.guild.gp - lo) / (hi - lo), '#f0b43c');
  const G = guildLayout(A, L.wide);
  save.guild.quests.forEach((q, k) => {
    const c = G.cards[k];
    const def = questDef(q.id);
    const done = questDone(q, bag);
    box(ctx, c, done ? '#f3fbe9' : '#ffffff', dogView.sel === k ? '#f08a3c' : done ? '#7cc35a' : 'rgba(120,85,55,0.2)', dogView.sel === k ? 3.5 : 2, 14);
    const tw = c.w - 220;
    txt(ctx, `${done ? '✅ ' : '📜 '}${def.title}`, c.x + 18, c.y + 30, L.wide ? tw : c.w - 36, 20, '#5b4a3f');
    const desc = def.desc.replaceAll('{n}', String(def.n));
    const y = L.wide ? (txt(ctx, desc, c.x + 18, c.y + 54, tw, 15, '#7a6656', false), c.y + 66) : para(ctx, desc, c.x + 18, c.y + 58, c.w - 36, 15, '#7a6656', 2, 21) - 6;
    const n = progressOf(q, bag);
    const bw = L.wide ? 290 : c.w - 36 - 120;
    bar(ctx, c.x + 18, y, bw, 12, n / def.n, done ? '#7cc35a' : '#f5a05a');
    txt(ctx, `${n}/${def.n}`, c.x + 26 + bw, y + 11, 60, 14, done ? '#3e9a45' : '#9a7b62');
    drawCoin(ctx, c.x + (L.wide ? 30 + bw + 62 : 30), y + (L.wide ? 6 : 40), 9);
    txt(ctx, `${def.coins} · ⭐${def.gp}점`, c.x + (L.wide ? 44 + bw + 62 : 44), y + (L.wide ? 11 : 45), 120, 15, '#c98a1c');
    button(ctx, G.btns[k], done ? '보고하기' : `바꾸기 ${DOGTOWN.guild.reroll}냥`, done ? 'main' : 'soft');
  });
}

function drawForge(ctx: CanvasRenderingContext2D, L: PL, A: R, bag: Bag) {
  const F = forgeLayout(A, L.wide);
  const list = forgeList(bag);
  if (dogView.sel >= list.length) dogView.sel = Math.max(0, list.length - 1);
  const page = Math.floor(dogView.sel / PER);
  F.cells.forEach((r, k) => {
    const ref = list[page * PER + k];
    if (!ref) return itemCell(ctx, r, null, 0, false);
    itemCell(ctx, r, refId(bag, ref), 1, dogView.sel === page * PER + k, ref.at === 'slot' ? SLOT_NAME[ref.slot] : '', '#3f7fbf', forgeLevel(refFp(bag, ref)));
  });
  const pages = Math.max(1, Math.ceil(list.length / PER));
  if (pages > 1) {
    button(ctx, F.prev, '◀', 'soft');
    button(ctx, F.next, '▶', 'soft');
    txt(ctx, `${page + 1}/${pages}`, (F.prev.x + F.next.x + F.next.w) / 2, F.prev.y + 30, 80, 17, '#9a7b62', true, 'center');
  }
  const D = F.D;
  box(ctx, D);
  const ref = list[dogView.sel];
  if (!ref) {
    para(ctx, '강화할 장비가 없어요. 장비를 끼거나 가방에 넣어 오세요', D.x + 20, D.y + 40, D.w - 40, 17, '#9a7b62');
    return;
  }
  const id = refId(bag, ref)!;
  const fp = refFp(bag, ref);
  const lv = forgeLevel(fp);
  const cost = forgeCost(bag, ref);
  drawIcon(ctx, id, D.x + 50, D.y + 50, 64);
  txt(ctx, `${ITEMS[id].name}${lv ? ` +${lv}` : ''}`, D.x + 94, D.y + 40, D.w - 110, 21, '#5b4a3f');
  txt(ctx, `${ref.at === 'slot' ? `끼고 있는 ${SLOT_NAME[ref.slot as Slot]}` : '가방'} · 강화 점수 ${fp}/${MAX_FP}`, D.x + 94, D.y + 64, D.w - 110, 14, '#9a7b62', false);
  bar(ctx, D.x + 94, D.y + 74, D.w - 114, 10, fp / MAX_FP, '#ef8a5e');
  // 능력치: 지금 → 다음 단계
  const now = itemStats(id, fp);
  const nxt = itemStats(id, Math.min(MAX_FP, (lv + 1) * 3));
  let y = D.y + 110;
  const keys = STAT_KEYS.filter((k) => now[k] || nxt[k]);
  for (const k of keys.slice(0, 3)) {
    const a = now[k] ?? 0;
    const b = nxt[k] ?? 0;
    txt(ctx, statText(k, a), D.x + 20, y, D.w / 2 - 20, 16, '#3f7fbf');
    if (!cost.max && b !== a) txt(ctx, `→ ${statText(k, b)}`, D.x + D.w / 2, y, D.w / 2 - 20, 16, '#3e9a45');
    y += 24;
  }
  if (cost.max) {
    txt(ctx, '⭐ 다 올렸어요 (+5)', D.x + 20, y + 8, D.w - 40, 18, '#c98a1c');
  } else {
    txt(ctx, `+${lv + 1} 까지 망치질 ${lv * 3 + 3 - fp}점 — ★ 하나에 1점`, D.x + 20, y + 4, D.w - 40, 14, '#9a7b62', false);
    y += 30;
    // 값: 냥코인 + 재료 (모자란 재료는 사서 채운다)
    drawCoin(ctx, D.x + 30, y - 6, 10);
    txt(ctx, `${cost.coins}냥`, D.x + 46, y, 90, 16, '#c98a1c');
    let x = D.x + 130;
    for (const [mid, n, have] of cost.need) {
      drawIcon(ctx, mid, x + 12, y - 6, 24);
      const label = `${Math.min(have, n)}/${n}`;
      txt(ctx, label, x + 27, y, 60, 15, have >= n ? '#3e9a45' : '#d4574a');
      ctx.font = 'bold 15px system-ui, sans-serif';
      x += 36 + ctx.measureText(label).width;
    }
    if (cost.buy) txt(ctx, `모자란 재료는 무쇠가 채워 줘요 (+${cost.buy}냥)`, D.x + 20, y + 26, D.w - 40, 14, '#d4574a', false);
  }
  const ok = !cost.max && bag.coins >= cost.total;
  button(ctx, F.up, cost.max ? '+5 완성' : `🔨 강화 ${cost.total}냥`, ok ? 'main' : 'soft');
  const join = !!mergeTarget(bag, ref) && !cost.max;
  button(ctx, F.join, `합치기 ${DOGTOWN.forge.merge}냥`, join ? 'main' : 'soft');
  if (!join) txt(ctx, '같은 장비가 둘이면 합쳐요', F.join.x + F.join.w / 2, F.join.y - 8, F.join.w + 40, 12, '#b09a85', false, 'center');
}

function drawPost(ctx: CanvasRenderingContext2D, L: PL, A: R, save: DogSave, bag: Bag, now: number) {
  const Q = postLayout(A, L.wide);
  const O = Q.O;
  box(ctx, O, '#ffffff', '#f08a3c', 2.5, 18);
  const o = save.offer;
  txt(ctx, '📮 새 배달 주문', O.x + 20, O.y + 32, 300, 19, '#c0582c');
  if (o) {
    const who = recipient(o.to);
    drawIcon(ctx, o.item, O.x + 56, O.y + (L.wide ? 92 : 96), 64);
    const tw = L.wide ? O.w - 340 : O.w - 130;
    txt(ctx, `${ITEMS[o.item].name} ×${o.n} → ${who.name}`, O.x + 104, O.y + (L.wide ? 80 : 86), tw, 20, '#5b4a3f');
    txt(ctx, `${who.town} · 가방에 ${count(bag, o.item)}/${o.n}`, O.x + 104, O.y + (L.wide ? 104 : 112), tw, 15, count(bag, o.item) >= o.n ? '#3e9a45' : '#9a7b62', false);
    txt(ctx, `삯 ${o.coins}냥 · ${DOGTOWN.post.due / 60}분 안에 배달 (넘으면 실패)`, O.x + 104, O.y + (L.wide ? 128 : 138), tw, 15, '#c98a1c');
  }
  const full = save.parcels.length >= DOGTOWN.post.slots;
  button(ctx, Q.take, full ? `맡은 배달 가득` : '맡기', full ? 'soft' : 'main');
  button(ctx, Q.other, '다른 주문', 'soft');
  txt(ctx, `맡은 배달 ${save.parcels.length}/${DOGTOWN.post.slots} — 받는 이에게 말을 걸면 건네져요`, A.x, Q.top - 14, A.w, 16, '#9a7b62');
  Q.rows.forEach((r, k) => {
    const p = save.parcels[k];
    if (!p) return box(ctx, r, 'rgba(120,85,55,0.04)', 'rgba(120,85,55,0.12)', 1.5, 14);
    box(ctx, r, '#ffffff', 'rgba(120,85,55,0.25)', 2, 14);
    const who = recipient(p.to);
    const have = count(bag, p.item);
    drawIcon(ctx, p.item, r.x + 40, r.y + (L.wide ? r.h / 2 : 44), 52);
    const tw = L.wide ? r.w - 250 : r.w - 100;
    txt(ctx, `📦 ${who.name}(${who.town})에게 ${ITEMS[p.item].name} ×${p.n}`, r.x + 78, r.y + 30, tw, 17, '#5b4a3f');
    txt(ctx, `가방에 ${have}/${p.n}`, r.x + 78, r.y + 54, 140, 15, have >= p.n ? '#3e9a45' : '#d4574a');
    const left = dueLeft(p, now);
    txt(ctx, left ? `⏱ ${mmss(left)} 남음` : '⏱ 시간 초과 — 배달 실패', r.x + 78 + (L.wide ? 150 : 0), r.y + (L.wide ? 54 : 78), 220, 15, left ? '#c98a1c' : '#d4574a', !left);
    button(ctx, Q.drops[k], left ? '그만두기' : '실패', left ? 'soft' : 'warn');
  });
}

function drawExplorer(ctx: CanvasRenderingContext2D, L: PL, A: R, save: DogSave, bag: Bag, now: number) {
  const S = simpleLayout(A, L.wide, 2);
  box(ctx, S.S, '#ffffff', 'rgba(120,85,55,0.25)', 2, 18);
  const sp = digSpot(save);
  let y = S.S.y + 36;
  txt(ctx, sp ? `✕ 표시: ${sp.hint}` : '🧭 표시한 보물 자리가 없어요', S.S.x + 20, y, S.S.w - 40, 21, sp ? '#d4574a' : '#5b4a3f');
  y = para(ctx, sp ? '필드 지도(미니맵)의 ✕ 자리에 가서 잠깐 서 있으면 파요. 냥코인과 보물이 나와요' : '말린 지도를 가져오거나, 킁킁이 냄새를 맡으면 필드에 보물 자리를 ✕ 로 표시해요', S.S.x + 20, y + 30, S.S.w - 40, 16, '#7a6656', 2, 22);
  txt(ctx, '나올 수 있는 것', S.S.x + 20, y + 14, 200, 14, '#9a7b62');
  const loot = (DOGTOWN.explorer.loot as [string, number][]).map(([id]) => id);
  const per = Math.floor((S.S.w - 40) / 46);
  loot.slice(0, per).forEach((id, k) => drawIcon(ctx, id, S.S.x + 40 + k * 46, y + 44, 38));
  const maps = count(bag, DOGTOWN.explorer.map);
  const wait = sniffWait(save, now);
  button(ctx, S.btns[0], `🗺️ 말린 지도 읽기 (${maps}장)`, maps && !sp ? 'main' : 'soft');
  button(ctx, S.btns[1], wait ? `👃 냄새 맡기 (${Math.ceil(wait / 60)}분 뒤)` : '👃 냄새 맡기', !wait && !sp ? 'main' : 'soft');
}

function drawTrainingInfo(ctx: CanvasRenderingContext2D, L: PL, A: R, save: DogSave, touch: boolean) {
  const S = simpleLayout(A, L.wide, 1);
  box(ctx, S.S, '#ffffff', 'rgba(120,85,55,0.25)', 2, 18);
  let y = S.S.y + 38;
  txt(ctx, '🎯 허수아비 치기 · 공 피하기', S.S.x + 20, y, S.S.w - 40, 22, '#5b4a3f');
  y = para(ctx, touch ? '빛나는 허수아비를 눌러 쳐요 — 빨리 칠수록 딱!(2점). 공이 굴러오면 닿기 직전에 구르기 버튼!' : '빛나는 허수아비를 그쪽 방향키(WASD · ←↑→↓)로 쳐요 — 빨리 칠수록 딱!(2점). 공이 굴러오면 닿기 직전에 Space 로 구르기!', S.S.x + 20, y + 32, S.S.w - 40, 17, '#7a6656', 3, 24);
  para(ctx, '45초 · 하트 3개 · 연속 10번마다 보너스 · 점수에 따라 냥코인', S.S.x + 20, y + 10, S.S.w - 40, 15, '#9a7b62', 2, 21);
  button(ctx, S.btns[0], '🎯 훈련 시작', 'main');
}

function drawRescue(ctx: CanvasRenderingContext2D, L: PL, A: R, save: DogSave, now: number) {
  const S = simpleLayout(A, L.wide, 1);
  const c = save.call;
  box(ctx, S.S, c ? '#fff4ef' : '#ffffff', c ? '#ef6b5e' : 'rgba(120,85,55,0.25)', 2.5, 18);
  let y = S.S.y + 38;
  if (!c) {
    txt(ctx, '⛑️ 지금은 조용해요', S.S.x + 20, y, S.S.w - 40, 22, '#5b4a3f');
    para(ctx, `다음 구조 요청까지 약 ${Math.max(1, Math.ceil(callWait(save, now) / 60))}분. 요청이 오면 버나드 머리 위에 🚨 가 떠요`, S.S.x + 20, y + 32, S.S.w - 40, 17, '#7a6656', 3, 24);
  } else {
    const call = CALLS[c.i];
    txt(ctx, `🚨 ${call.title}`, S.S.x + 20, y, S.S.w - 40, 21, '#d4574a');
    y = para(ctx, `장소: ${call.place}`, S.S.x + 20, y + 32, S.S.w - 40, 17, '#5b4a3f', 1);
    para(ctx, c.on ? '필드 지도(미니맵)의 ❗ 자리로 가면 버나드와 함께 로프를 당겨요 (왼쪽 · 오른쪽 번갈아!)' : '출동하면 필드 지도에 ❗ 가 떠요. 그 자리에 가서 로프를 당겨 구해 줘요', S.S.x + 20, y + 4, S.S.w - 40, 16, '#7a6656', 3, 22);
  }
  button(ctx, S.btns[0], !c ? '요청을 기다려요' : c.on ? '❗ 자리로 가는 중' : '⛑️ 출동!', c && !c.on ? 'main' : 'soft');
}

function drawSalon(ctx: CanvasRenderingContext2D, L: PL, A: R, bag: Bag) {
  const Z = salonLayout(A, L.wide);
  COS_TABS.forEach(([name], k) => {
    const on = dogView.cosTab === k;
    box(ctx, Z.tabs[k], on ? '#f5a05a' : 'rgba(120,85,55,0.1)', '', 0, 14);
    txt(ctx, name, Z.tabs[k].x + Z.tabs[k].w / 2, Z.tabs[k].y + 27, Z.tabs[k].w - 8, 16, on ? '#fff' : '#5b4a3f', true, 'center');
  });
  const ids = COS_TABS[dogView.cosTab][1];
  Z.cells.forEach((r, k) => {
    const id = ids[k];
    if (!id) return;
    const own = closet.owned.includes(id);
    const worn = closet.worn[COS[id].slot] === id;
    box(ctx, r, worn ? '#fff1dc' : '#ffffff', dogView.cosPick === id ? '#f08a3c' : worn ? '#7cc35a' : 'rgba(120,85,55,0.2)', dogView.cosPick === id || worn ? 3.5 : 2, 12);
    drawCosIcon(ctx, id, r.x + r.w / 2, r.y + r.h / 2 - (own ? 0 : 6), r.w * 0.78);
    if (!own) txt(ctx, `${cosPrice(id)}냥`, r.x + r.w / 2, r.y + r.h - 6, r.w - 6, 13, '#c98a1c', true, 'center');
    else if (worn) txt(ctx, '입음', r.x + r.w / 2, r.y + r.h - 6, r.w - 6, 13, '#3e9a45', true, 'center');
  });
  const D = Z.D;
  box(ctx, D);
  const id = dogView.cosPick;
  if (!id) {
    para(ctx, '소품을 누르면 모습 원에서 입어 볼 수 있어요. 사면 언제든 입고 벗어요 (능력치는 없는 꾸미기 전용)', D.x + 16, D.y + 34, D.w - 32, 16, '#7a6656', 4, 23);
  } else {
    const it = COS[id];
    const own = closet.owned.includes(id);
    const worn = closet.worn[it.slot] === id;
    const icon = L.wide ? { x: D.x + D.w / 2, y: D.y + 62, s: 96 } : { x: D.x + 56, y: D.y + 52, s: 84 };
    drawCosIcon(ctx, id, icon.x, icon.y, icon.s);
    const tx = L.wide ? D.x + D.w / 2 : D.x + 112;
    const al: CanvasTextAlign = L.wide ? 'center' : 'left';
    const tw = L.wide ? D.w - 24 : D.w - 124;
    txt(ctx, it.name, tx, L.wide ? D.y + 138 : D.y + 40, tw, 22, '#5b4a3f', true, al);
    txt(ctx, `${COS_SLOT_NAME[it.slot]} · ${own ? (worn ? '입고 있어요' : '가지고 있어요') : `${cosPrice(id)}냥`}${it.head ? ' · 머리까지 덮는 옷' : ''}`, tx, L.wide ? D.y + 166 : D.y + 68, tw, 15, own ? '#3e9a45' : '#c98a1c', true, al);
    const ok = own || bag.coins >= cosPrice(id);
    button(ctx, Z.main, own ? (worn ? '벗기' : '입기') : `사고 입기 ${cosPrice(id)}냥`, ok ? 'main' : 'soft');
  }
  button(ctx, Z.off, '모두 벗기', 'soft');
}

/** 망치질 카드 — 달군 쇠 위로 고리가 줄어든다, 가운데 원에 닿을 때 두드린다. 세 번 → 별 */
function drawHammer(ctx: CanvasRenderingContext2D, L: PL, P: Extract<DogPanel, { kind: 'hammer' }>, s: DogtownState, t: number, touch: boolean) {
  const { card, ok } = cardLayout(L);
  box(ctx, card, '#fffaf0', '', 0, 28);
  const cx = card.x + card.w / 2;
  const h = P.h;
  txt(ctx, `🔨 ${ITEMS[P.id].name} 강화 (+${P.from} → +${P.from + 1})`, cx, card.y + 52, card.w - 40, 26, '#5b4a3f', true, 'center');
  // 모루 · 달군 쇠 · 무쇠
  const ay = card.y + (L.wide ? 250 : 470);
  const R0 = L.wide ? 110 : 130;
  const fi = DOGS.findIndex((d) => d.job === 'forge');
  const ax = L.wide ? cx + 70 : cx; // 모루 가운데 (넓은 화면은 무쇠 자리만큼 오른쪽으로)
  if (L.wide) drawDog(ctx, fi, { ...s.dogs[fi], flip: 1, hop: 0 }, card.x + 120, ay + 50, 140 / 96);
  else drawDog(ctx, fi, { ...s.dogs[fi], flip: 1, hop: 0 }, cx, card.y + 300, 130 / 96); // 세로 화면: 별 밑 · 모루 위
  ctx.fillStyle = '#4a4a52';
  ctx.beginPath();
  ctx.moveTo(ax - 90, ay + 10);
  ctx.lineTo(ax + 110, ay + 10);
  ctx.lineTo(ax + 70, ay + 40);
  ctx.lineTo(ax + 40, ay + 40);
  ctx.lineTo(ax + 40, ay + 70);
  ctx.lineTo(ax - 40, ay + 70);
  ctx.lineTo(ax - 40, ay + 40);
  ctx.lineTo(ax - 70, ay + 40);
  ctx.closePath();
  ctx.fill();
  const glow = 0.6 + 0.4 * Math.sin(t * 9);
  ctx.fillStyle = `rgb(255, ${Math.round(120 + 60 * glow)}, 60)`;
  ctx.beginPath();
  ctx.roundRect(ax - 60, ay - 6, 120, 18, 8);
  ctx.fill();
  // 과녁 (딱 칸 금색 · 좋아 칸 초록) · 줄어드는 고리
  const tr = HAMMER.target * R0;
  const ry = ay - 4;
  ctx.lineWidth = (HAMMER.good * 2 * R0);
  ctx.strokeStyle = 'rgba(124,195,90,0.45)';
  ctx.beginPath();
  ctx.arc(ax, ry, tr, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = HAMMER.perfect * 2 * R0;
  ctx.strokeStyle = 'rgba(255,210,58,0.95)';
  ctx.beginPath();
  ctx.arc(ax, ry, tr, 0, Math.PI * 2);
  ctx.stroke();
  if (h.phase === 'hit') {
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#ef6b5e';
    ctx.beginPath();
    ctx.arc(ax, ry, Math.max(2, h.r * R0), 0, Math.PI * 2);
    ctx.stroke();
  }
  // 두드린 결과 ●
  const label = { perfect: '딱!', good: '좋아', miss: '헛망치' };
  for (let k = 0; k < HAMMER.strikes; k++) {
    const g = h.results[k];
    const x = cx + (k - 1) * 110;
    const y = ay + 120;
    box(ctx, { x: x - 48, y: y - 26, w: 96, h: 40 }, g === 'perfect' ? '#ffe9a8' : g === 'good' ? '#dff3d0' : g === 'miss' ? '#f3e0dc' : 'rgba(120,85,55,0.08)', '', 0, 20);
    txt(ctx, g ? label[g] : `${k + 1}`, x, y + 2, 90, 18, g === 'miss' ? '#d4574a' : '#5b4a3f', true, 'center');
  }
  if (!P.res) {
    txt(ctx, touch ? '고리가 금색 원에 닿을 때 화면을 눌러요!' : '고리가 금색 원에 닿을 때 Space!', cx, card.y + card.h - 40, card.w - 40, 20, '#5b4a3f', true, 'center');
    return;
  }
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffc93a';
  ctx.fillText('★'.repeat(P.res.stars) + '☆'.repeat(3 - P.res.stars), cx, card.y + 106);
  txt(ctx, P.res.up ? `+${P.res.lv} 강화 성공!` : `강화 점수 +${P.res.stars}`, cx, ok.y - 16, card.w - 40, 20, P.res.up ? '#d4574a' : '#3f7fbf', true, 'center');
  button(ctx, ok, '좋아요', 'main');
}

// ── 필드에서: 보물 ✕ · 구조 ❗ (필드 지도 px 로 — main 이 필드 변환을 걸고 부른다) ──
export type FieldMark = { x: number; y: number; kind: 'dig' | 'rescue'; k: number };
export function drawFieldMarks(ctx: CanvasRenderingContext2D, marks: FieldMark[], C: number, t: number) {
  for (const m of marks) {
    const pulse = 1 + 0.12 * Math.sin(t * 5);
    if (m.kind === 'dig') {
      ctx.strokeStyle = 'rgba(200, 40, 30, 0.9)';
      ctx.lineWidth = C * 0.16;
      ctx.lineCap = 'round';
      const r = C * 0.45 * pulse;
      ctx.beginPath();
      ctx.moveTo(m.x - r, m.y - r * 0.6);
      ctx.lineTo(m.x + r, m.y + r * 0.6);
      ctx.moveTo(m.x + r, m.y - r * 0.6);
      ctx.lineTo(m.x - r, m.y + r * 0.6);
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(239, 107, 94, 0.25)';
      ctx.beginPath();
      ctx.ellipse(m.x, m.y, C * 0.9 * pulse, C * 0.5 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `bold ${C * 1.1}px "Segoe UI Emoji", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ef4b3e';
      ctx.fillText('❗', m.x, m.y - C * 0.9 - Math.abs(Math.sin(t * 4)) * C * 0.3);
    }
    if (m.k > 0) {
      ctx.strokeStyle = '#fff6d8';
      ctx.lineWidth = C * 0.12;
      ctx.beginPath();
      ctx.arc(m.x, m.y - C * 0.2, C * 0.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * m.k);
      ctx.stroke();
    }
  }
}
/** 미니맵 위 표시 (CSS px) */
export function drawMiniMarks(ctx: CanvasRenderingContext2D, pts: { x: number; y: number; kind: 'dig' | 'rescue' }[], t: number) {
  for (const p of pts) {
    const r = 6 + Math.sin(t * 5) * 1.2;
    ctx.fillStyle = p.kind === 'dig' ? '#c8281e' : '#ef6b5e';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.kind === 'dig' ? '✕' : '!', p.x, p.y + 3.5);
  }
}

// ── 구조 로프 카드 (필드에서, 버나드와 함께) ──
export type RopeRes = { coins: number; map: boolean } | null;
export function ropeLayout(w: number, h: number) {
  const L = panelLayout(w, h);
  const { card, ok } = cardLayout(L);
  const area: R = { x: card.x + 24, y: card.y + 84, w: card.w - 48, h: card.h - 84 - (L.wide ? 170 : 210) };
  const left: R = { x: card.x + 24, y: card.y + card.h - 96, w: 170, h: 76 };
  const right: R = { x: card.x + card.w - 194, y: left.y, w: 170, h: 76 };
  const retry: R = { x: card.x + 30, y: ok.y, w: card.w / 2 - 45, h: 58 };
  const later: R = { x: card.x + card.w / 2 + 15, y: ok.y, w: card.w / 2 - 45, h: 58 };
  return { L, card, ok, area, left, right, retry, later };
}
export type RopeTap = 'left' | 'right' | 'ok' | 'retry' | 'later' | null;
/** 로프 카드를 눌렀다 — 당기는 동안은 ◀ ▶ 버튼, 아니면 누른 쪽 절반 */
export function ropeTap(w: number, h: number, x: number, y: number, r: Rope): RopeTap {
  const Y = ropeLayout(w, h);
  const px = (x - Y.L.ox) / Y.L.k;
  const py = (y - Y.L.oy) / Y.L.k;
  if (r.phase === 'done') return inR(Y.ok, px, py) ? 'ok' : null;
  if (r.phase === 'fail') return inR(Y.retry, px, py) ? 'retry' : inR(Y.later, px, py) ? 'later' : null;
  if (inR(Y.left, px, py)) return 'left';
  if (inR(Y.right, px, py)) return 'right';
  return x < w / 2 ? 'left' : 'right';
}
export function ropePoints(w: number, h: number) {
  const Y = ropeLayout(w, h);
  const mid = (r: R) => ({ x: Y.L.ox + (r.x + r.w / 2) * Y.L.k, y: Y.L.oy + (r.y + r.h / 2) * Y.L.k });
  return { left: mid(Y.left), right: mid(Y.right), ok: mid(Y.ok), retry: mid(Y.retry), later: mid(Y.later) };
}
export function drawRope(ctx: CanvasRenderingContext2D, w: number, h: number, r: Rope, call: Call, res: RopeRes, t: number, touch: boolean) {
  const Y = ropeLayout(w, h);
  const { L, card, area: A } = Y;
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.45)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  box(ctx, card, '#fffaf0', '#ef6b5e', 4, 28);
  const cx = card.x + card.w / 2;
  txt(ctx, `⛑️ ${call.title}`, cx, card.y + 50, card.w - 40, 24, '#5b4a3f', true, 'center');
  // 그림: 하늘 · 땅, 오른쪽에 구할 것 (나무 위 새끼 고양이 · 떠내려가는 배 · 구덩이 속 강아지), 왼쪽에 버나드
  box(ctx, A, '#d8eef7', '', 0, 18);
  const gy = A.y + A.h * 0.78;
  ctx.fillStyle = call.kind === 'boat' ? '#7cc4e8' : '#a6d77c';
  ctx.fillRect(A.x, gy, A.w, A.y + A.h - gy);
  if (call.kind === 'boat') {
    ctx.fillStyle = '#e6cf9a';
    ctx.fillRect(A.x, gy, A.w * 0.42, A.y + A.h - gy);
  }
  const k = ropeK(r);
  const bi = DOGS.findIndex((d) => d.job === 'rescue');
  const bx = A.x + A.w * 0.18;
  const pull = r.phase === 'done' ? 'affection' : 'job_b';
  drawDog(ctx, bi, { anim: pull, animT: r.phase === 'done' ? t % 2 : (r.pulls % 6) / 5 + 0.01, flip: 1, hop: 0 }, bx, gy + 6, Math.min(A.h * 0.5, A.w * 0.32, 160) / 96);
  let tx = 0;
  let ty = 0;
  const emo = (e: string, x: number, y: number, px: number) => {
    ctx.font = `${px}px "Segoe UI Emoji", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#000';
    ctx.fillText(e, x, y);
  };
  if (call.kind === 'tree') {
    const trx = A.x + A.w * 0.78;
    ctx.fillStyle = '#8a5a35';
    ctx.fillRect(trx - 18, A.y + A.h * 0.2, 36, gy - A.y - A.h * 0.2);
    ctx.fillStyle = '#5fa055';
    ctx.beginPath();
    ctx.arc(trx, A.y + A.h * 0.22, A.h * 0.24, 0, Math.PI * 2);
    ctx.fill();
    [tx, ty] = [trx - 40, A.y + A.h * 0.3 + (gy - A.y - A.h * 0.3 - 30) * k];
    emo('🐱', tx, ty + 14, 40);
  } else if (call.kind === 'boat') {
    [tx, ty] = [A.x + A.w * (0.9 - 0.42 * k), gy - 4 + Math.sin(t * 3) * 4];
    emo('🛶', tx, ty, 54);
  } else {
    const px = A.x + A.w * 0.75;
    ctx.fillStyle = '#5b4031';
    ctx.beginPath();
    ctx.ellipse(px, gy + 8, 70, 18, 0, 0, Math.PI * 2);
    ctx.fill();
    [tx, ty] = [px, gy + 40 - 60 * k];
    ctx.save();
    ctx.beginPath();
    ctx.rect(A.x, A.y, A.w, gy + 10 - A.y);
    ctx.clip();
    emo('🐶', tx, ty, 42);
    ctx.restore();
  }
  // 로프
  ctx.strokeStyle = '#b8864a';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(bx + 30, gy - A.h * 0.25);
  ctx.quadraticCurveTo((bx + tx) / 2, Math.max(gy - A.h * 0.25, ty) + 20 * (1 - k), tx - 10, ty - 10);
  ctx.stroke();
  // 진행 · 남은 시간 · 버튼
  const by = A.y + A.h + 16;
  if (r.phase !== 'done') bar(ctx, card.x + 40, by, card.w - 80, 18, k, '#7cc35a');
  if (r.phase === 'done' && res) {
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffc93a';
    ctx.fillText('★'.repeat(r.stars) + '☆'.repeat(3 - r.stars), cx, by + 30);
    txt(ctx, `구조 성공! 냥코인 +${res.coins}${res.map ? ' · 말린 지도 한 장' : ''}`, cx, by + 62, card.w - 40, 19, '#3e9a45', true, 'center');
    button(ctx, Y.ok, '좋아요', 'main');
  } else if (r.phase === 'fail') {
    txt(ctx, '시간이 다 됐어요… 다시 힘을 내 볼까요?', cx, by + 56, card.w - 40, 19, '#d4574a', true, 'center');
    button(ctx, Y.retry, '다시 당기기', 'main');
    button(ctx, Y.later, '나중에', 'soft');
  } else {
    const left = r.phase === 'ready' ? ROPE.time : Math.max(0, ROPE.time - r.t);
    txt(ctx, `${left.toFixed(1)}초`, cx, by + 50, 200, 26, left < 3 ? '#d4574a' : '#5b4a3f', true, 'center');
    txt(ctx, touch ? '◀ ▶ 를 번갈아 눌러 당겨요!' : 'A · D (← →) 를 번갈아 눌러 당겨요!', cx, by + (L.wide ? 78 : 84), L.wide ? card.w - 400 : card.w - 40, 16, '#7a6656', true, 'center');
    const hint = r.last === 1 ? Y.left : r.last === -1 ? Y.right : null;
    button(ctx, Y.left, '◀', hint === Y.left ? 'main' : 'soft');
    button(ctx, Y.right, '▶', hint === Y.right ? 'main' : 'soft');
  }
  ctx.restore();
}
/** 놀이(망치질) 중인지 — main 이 매 프레임 hammerStep 을 부르는지 본다 */
export const hammering = () => dogView.panel?.kind === 'hammer' && !dogView.panel.res;
