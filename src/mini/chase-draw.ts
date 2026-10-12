// 다람쥐 잡기 그리기 — 사용자 그림(backgrounds/chase/chase_clearing_v1 — 나무 구멍 다섯 · 수풀이 둘러싼 숲 속 공터, 2026-10-08 밤) ·
// 곧 튀어나올 굴 표시(나무 구멍 속 눈 반짝 · 수풀은 (( )) 부스럭) · 치즈 · 다람쥐(필드와 같은 그리기) · 황금 다람쥐 빛 · 떠오르는 점수 ·
// 위 가운데 남은 시간과 잡은 점수 · 미니게임 공용 HUD(알약 · 돌아가기 · 결과 카드). 좌표는 필드처럼 px (고양이 키 catBody), 공터 가운데가 (0, 0) —
// 그림은 CHASE.center 가 (0, 0) 에, 그림 px CHASE.k 개가 1px. 로직은 chase.ts.
import { image } from '../shared/assets.ts';
import { CAT_FPS, CAT_ROW } from '../shared/cat.ts';
import { CHASE, fromImage, left, type Bush, type ChaseEvent, type ChaseState } from './chase.ts';
import data from '../data/field.json' with { type: 'json' };
import { drawEmote } from '../shared/emote.ts';
import { drawAcorn, drawSquirrel } from '../field/squirrel-draw.ts';
import { drawCard, drawLeave, drawPill, miniLayout, type MiniButton } from '../shared/mini-draw.ts';
import { drawWorn } from '../shared/cosmetics-draw.ts';
import { drawFrame, type Sheet } from '../shared/sheet.ts';
import { active } from '../shared/squirrel.ts';

export type ChaseViewOpts = { t: number; dt: number; touch: boolean; hover: MiniButton; best: number | null };
export type ChaseSheets = { cat: Sheet; squirrel?: Sheet };

const C = data.catBody;
const RX = CHASE.rx * C;
const RY = CHASE.ry * C;
/** 둘레 나무까지 보이는 판 크기 (px) */
const BOX = { w: RX * 2.4, h: RY * 2.5 };
/** 그림이 덮는 곳 (좌표 px) — 화면이 이 밖을 보지 않게 */
const IMG = 1254;
const [IX0, IY0] = fromImage(0, 0);
const [IX1, IY1] = fromImage(IMG, IMG);
/** 들어가기 전에 그림을 불러 둔다 (main 의 enterChase · ?chase) */
export const chaseReady = () => image(CHASE.image).ready;
/** 화면 배율이 이보다 작아지게는 줄이지 않는다 (CSS px / px — 고양이 약 27px) — 넘치면 고양이를 따라간다 */
const SC_MIN = 1.6;
/** 캔버스 픽셀 기준 변환 (검증 도구가 화면 위치를 찾을 때 쓴다): 화면 = o + 좌표 × sc */
export const chaseView = { sc: 1, ox: 0, oy: 0 };

/** 곧 튀어나올 굴 — 나무 구멍은 속에서 눈 두 개가 깜빡이고, 수풀은 좌우에 (( )) (둘 다 흔들리는 동안만) */
function drawDen(ctx: CanvasRenderingContext2D, b: Bush, t: number) {
  if (b.warn <= 0) return;
  if (b.kind === 'hole') {
    const open = Math.sin(t * 9) > -0.6 ? 1 : 0.15; // 깜빡
    const glow = ctx.createRadialGradient(b.ex, b.ey, 0, b.ex, b.ey, C * 0.55);
    glow.addColorStop(0, b.gold ? 'rgba(255, 220, 90, 0.55)' : 'rgba(255, 245, 200, 0.35)');
    glow.addColorStop(1, 'rgba(255, 245, 200, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(b.ex - C * 0.6, b.ey - C * 0.6, C * 1.2, C * 1.2);
    for (const side of [-1, 1]) {
      ctx.fillStyle = b.gold ? '#ffe27a' : '#fffbe8';
      ctx.beginPath();
      ctx.ellipse(b.ex + side * C * 0.17, b.ey, C * 0.11, C * 0.11 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      if (open > 0.5) {
        ctx.fillStyle = '#2b1d14';
        ctx.beginPath();
        ctx.arc(b.ex + side * C * 0.17 + C * 0.025, b.ey + C * 0.015, C * 0.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  // (( )) — 굴 둘레 (구멍은 튀어나올 자리 위에)
  const x = b.x;
  const y = b.y - C * 0.2;
  const dx = Math.sin(t * 45) * C * 0.06;
  ctx.lineCap = 'round';
  for (const [w, color] of [
    [C * 0.16, 'rgba(60, 45, 30, 0.45)'],
    [C * 0.08, 'rgba(255, 255, 255, 0.95)'],
  ] as [number, string][]) {
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    for (const side of [-1, 1])
      for (const k of [0, 1]) {
        ctx.beginPath();
        const cx = x + dx + side * C * 0.95;
        const R = C * (0.26 + k * 0.2);
        if (side > 0) ctx.arc(cx, y - C * 0.2, R, -0.75, 0.75);
        else ctx.arc(cx, y - C * 0.2, R, Math.PI - 0.75, Math.PI + 0.75);
        ctx.stroke();
      }
  }
}

// ── 연출: 나뭇잎 · 떠오르는 글자 ──
type Leaf = { x: number; y: number; vx: number; vy: number; t: number; life: number; c: string; r: number };
let leaves: Leaf[] = [];
type Label = { text: string; x: number; y: number; t: number; color: string; big: boolean };
let labels: Label[] = [];
const LEAF = ['#5fae4a', '#7cc35a', '#3f8f45', '#9ad16a'];
function burst(x: number, y: number, n: number) {
  for (let i = 0; i < n; i++)
    leaves.push({ x, y, vx: (Math.random() - 0.5) * C * 5, vy: -C * (1.5 + Math.random() * 2.5), t: 0, life: 0.5 + Math.random() * 0.3, c: LEAF[Math.floor(Math.random() * LEAF.length)], r: C * (0.08 + Math.random() * 0.07) });
}
/** 이번 프레임 사건 → 나뭇잎 · 글자 */
export function chaseFx(events: ChaseEvent[]) {
  for (const e of events) {
    if (e.type === 'rustle') burst(e.x, e.y - C * 0.6, 3);
    else if (e.type === 'squirrel') {
      if (e.what === 'appear') burst(e.x, e.y - C * 0.6, 10);
      else if (e.what === 'caught') labels.push({ text: e.gold ? `+${e.points} 황금!` : `+${e.points}`, x: e.x, y: e.y - C * 1.4, t: 0, color: e.gold ? '#ffd23a' : '#ffffff', big: !!e.gold });
      else if (e.what === 'bonk') labels.push({ text: '콩!', x: e.x, y: e.y - C * 1.9, t: 0, color: '#ffe27a', big: false });
      else if (e.what === 'escape') labels.push({ text: '쏙', x: e.x, y: e.y - C * 1.2, t: 0, color: '#d8e6f0', big: false });
    }
  }
}

export function drawChase(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: ChaseState, sheets: ChaseSheets, v: ChaseViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cw / dpr;
  const h = ch / dpr;
  const M = miniLayout(w, h);
  const k = M.k;
  // 판(공터 + 둘레 나무)을 화면(위 HUD 아래)에 맞추되 너무 작아지면 그대로 두고 고양이를 따라간다. 그림은 화면을 다 덮게 (그림 밖은 안 보이게)
  const top = M.s.t + 78 * k;
  const vh = h - top - 8;
  const fit = Math.min(w / BOX.w, vh / BOX.h);
  const sc = Math.max(fit, SC_MIN, w / (IX1 - IX0), h / (IY1 - IY0));
  const follow = (view: number, size: number, at: number) => (size * sc <= view ? 0 : Math.max(-(size - view / sc) / 2, Math.min((size - view / sc) / 2, at)));
  const clampTo = (c: number, lo: number, hi: number) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, c)));
  // 화면 가운데(가로) · HUD 아래 가운데(세로)에 오는 좌표
  const camX = clampTo(follow(w, BOX.w, s.cat.x), IX0 + w / 2 / sc, IX1 - w / 2 / sc);
  const camY = clampTo(follow(vh, BOX.h, s.cat.y), IY0 + (top + vh / 2) / sc, IY1 - (h - top - vh / 2) / sc);
  const cx = w / 2 - camX * sc;
  const cy = top + vh / 2 - camY * sc;
  Object.assign(chaseView, { sc: sc * dpr, ox: cx * dpr, oy: cy * dpr });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#3f7a42';
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(sc * dpr, 0, 0, sc * dpr, cx * dpr, cy * dpr);
  const bg = image(CHASE.image).img;
  ctx.imageSmoothingQuality = 'high';
  if (bg.complete && bg.naturalWidth) ctx.drawImage(bg, IX0, IY0, IX1 - IX0, IY1 - IY0);
  for (const b of s.bushes) drawDen(ctx, b, v.t);

  // 고양이 · 다람쥐 (아래에 있는 것을 나중에) · 황금 다람쥐는 발밑에 금빛
  const cat = s.cat;
  type Thing = { y: number; draw: () => void };
  const things: Thing[] = [
    {
      y: cat.y,
      draw: () => {
        ctx.fillStyle = 'rgba(50, 70, 30, 0.3)';
        ctx.beginPath();
        ctx.ellipse(cat.x, cat.y, C * 0.36, C * 0.13, 0, 0, Math.PI * 2);
        ctx.fill();
        const sh = sheets.cat;
        const [row, fps] = cat.stun > 0 ? [CAT_ROW.hurt, CAT_FPS.hurt] : cat.moving ? [CAT_ROW.run, CAT_FPS.run] : [CAT_ROW.idle, CAT_FPS.idle];
        drawFrame(ctx, sh, row, Math.floor(cat.animT * fps) % 6, cat.x, cat.y, (C * sh.base) / sh.bodyH, cat.flip);
        drawWorn(ctx, sh, row, Math.floor(cat.animT * fps) % 6, cat.x, cat.y, (C * sh.base) / sh.bodyH, cat.flip);
      },
    },
  ];
  for (const r of s.runners)
    things.push({
      y: r.q.y,
      draw: () => {
        if (r.gold && (active(r.q) || r.q.phase === 'caught')) {
          const g = ctx.createRadialGradient(r.q.x, r.q.y - C * 0.4, 0, r.q.x, r.q.y - C * 0.4, C * 1.1);
          g.addColorStop(0, 'rgba(255, 225, 90, 0.75)');
          g.addColorStop(1, 'rgba(255, 225, 90, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(r.q.x - C * 1.2, r.q.y - C * 1.6, C * 2.4, C * 2.4);
        }
        drawSquirrel(ctx, r.q, sheets.squirrel, v.t);
        if (r.gold && active(r.q))
          for (let i = 0; i < 3; i++) {
            const a = v.t * 4 + (i * Math.PI * 2) / 3;
            ctx.fillStyle = '#fff6b0';
            ctx.beginPath();
            ctx.arc(r.q.x + Math.cos(a) * C * 0.7, r.q.y - C * 0.6 + Math.sin(a) * C * 0.35, C * 0.07, 0, Math.PI * 2);
            ctx.fill();
          }
      },
    });
  things.sort((p, q) => p.y - q.y).forEach((o) => o.draw());
  for (const r of s.runners) drawAcorn(ctx, r.q);
  drawEmote(ctx, cat.x, cat.y - C * 1.2, C * 0.8);

  // 나뭇잎 · 떠오르는 글자
  for (const l of leaves) {
    l.t += v.dt;
    l.vy += C * 9 * v.dt;
    l.x += l.vx * v.dt;
    l.y += l.vy * v.dt;
  }
  leaves = leaves.filter((l) => l.t < l.life);
  for (const l of leaves) {
    ctx.globalAlpha = Math.min(1, (l.life - l.t) / 0.2);
    ctx.fillStyle = l.c;
    ctx.beginPath();
    ctx.ellipse(l.x, l.y, l.r, l.r * 0.55, l.t * 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const l of labels) l.t += v.dt;
  labels = labels.filter((l) => l.t < 1.2);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const l of labels) {
    ctx.globalAlpha = Math.min(1, (1.2 - l.t) / 0.35);
    ctx.font = `bold ${Math.round(C * (l.big ? 0.9 : 0.7))}px system-ui, sans-serif`;
    ctx.lineWidth = C * 0.2;
    ctx.strokeStyle = 'rgba(50, 38, 28, 0.85)';
    const y = l.y - Math.min(1, l.t / 0.9) * C;
    ctx.strokeText(l.text, l.x, y);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, y);
  }
  ctx.globalAlpha = 1;

  // HUD: 알약 · 돌아가기 · 남은 시간 · 점수
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawPill(ctx, M, ['🐿️ 다람쥐 잡기', v.best !== null ? `최고 기록 ${v.best}점` : '황금 다람쥐는 3점']);
  drawLeave(ctx, M, v.hover, v.touch);
  const secs = Math.ceil(left(s));
  const hurry = s.phase === 'play' && secs <= 10;
  const pulse = hurry ? 1 + 0.08 * Math.max(0, Math.sin(v.t * 10)) : 1;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = `bold ${Math.round(40 * k * pulse)}px system-ui, sans-serif`;
  ctx.lineWidth = 6 * k;
  ctx.strokeStyle = 'rgba(91, 74, 63, 0.85)';
  const ty = M.s.t + 52 * k;
  ctx.strokeText(String(secs), w / 2, ty);
  ctx.fillStyle = hurry ? '#ff8a6a' : '#fffaf0';
  ctx.fillText(String(secs), w / 2, ty);
  const pts = `🐿️ ${s.points}점`;
  ctx.font = `bold ${Math.round(20 * k)}px system-ui, sans-serif`;
  ctx.lineWidth = 5 * k;
  ctx.strokeText(pts, w / 2, ty + 28 * k);
  ctx.fillStyle = '#ffe9a8';
  ctx.fillText(pts, w / 2, ty + 28 * k);
  if (s.phase === 'ready') {
    const lines = [v.touch ? '조이스틱으로 움직이면 시작!' : 'WASD 로 움직이면 시작!', '나무 구멍 · 수풀에서 튀어나오는 다람쥐를 쫓아가 잡아요', `${CHASE.time}초 · 황금 다람쥐는 ${CHASE.goldPoints}점`];
    lines.forEach((t, i) => {
      ctx.font = `bold ${Math.round((i ? 15 : 21) * k)}px system-ui, sans-serif`;
      ctx.lineWidth = 5 * k;
      const y = h * 0.34 + i * 26 * k;
      ctx.strokeText(t, w / 2, y);
      ctx.fillStyle = '#fffaf0';
      ctx.fillText(t, w / 2, y);
    });
  }
  if (s.phase === 'done' && s.doneT >= CHASE.cardDelay) {
    const best = v.best === null || s.points >= v.best;
    drawCard(
      ctx,
      M,
      '시간 끝!',
      [
        [`${s.caught}마리 · ${s.points}점${best && s.points > 0 ? ' · 최고 기록!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.coins}개`, '#c98a1c'],
        [s.acorns ? `도토리 ${s.acorns}개${s.golds ? ` · 황금 다람쥐 ${s.golds}마리` : ''}` : '다람쥐를 못 잡았어요', s.acorns ? '#3f95dd' : '#9a7b62'],
        [v.best !== null ? `최고 기록 ${Math.max(v.best, s.points)}점` : '첫 기록!', '#9a7b62'],
      ],
      v.hover,
      '다시 잡기',
      '돌아가기',
    );
  }
}
