// 훈련장 그리기 — 위에서 본 훈련장(모래 마당 · 나무 울타리) 가운데 치즈, 둘레 네 방향 허수아비, 굴러오는 훈련 공, 옆에서 지켜보는 교관(강아지 시트).
// 전용 그림이 없어 캔버스로 그린다 — 그림이 오면 drawYard · drawDummy · drawBall 만 바꾼다. 떠오르는 글(딱! · 놓침 · 피했다!)과 교관 동작은 trainFx 가 사건으로.
// HUD: 미니게임 공용(알약 · 돌아가기 · 결과 카드) + 위 가운데 남은 시간 · 점수 · 하트 · 연속. 로직은 training.ts.
import DOG_SHEETS from '../data/village-dogs.json' with { type: 'json' };
import { image } from '../shared/assets.ts';
import { CAT_FPS, CAT_ROW } from '../shared/cat.ts';
import { drawEmote } from '../shared/emote.ts';
import { drawCard, drawLeave, drawPill, miniLayout, type MiniButton } from '../shared/mini-draw.ts';
import { drawWorn } from '../shared/cosmetics-draw.ts';
import { drawFrame, type Sheet } from '../shared/sheet.ts';
import { timeLeft, TRAIN, type Dir, type TrainEvent, type TrainState } from './training.ts';

export type TrainViewOpts = { t: number; dt: number; touch: boolean; hover: MiniButton; best: number | null };
type Cut = number[];
type Atlas = { file: string; anims: Record<string, { fps: number; f: Cut[] }> };
const COACH = (DOG_SHEETS as Record<string, Atlas>).instructor;
export const trainingReady = () => image(COACH.file).ready;

/** 자리 (CSS px): 가운데 · 허수아비까지 거리 R · 고양이 키 · 허수아비 발밑 (위 · 오른쪽 · 아래 · 왼쪽) */
export function trainLayout(w: number, h: number) {
  const cx = w / 2;
  const cy = h * 0.6;
  const R = Math.min(w * 0.3, h * 0.25, 240);
  const dummy: [number, number][] = [
    [cx, cy - R * 0.78],
    [cx + R, cy],
    [cx, cy + R * 0.78],
    [cx - R, cy],
  ];
  return { cx, cy, R, catH: R * 0.42, dummy };
}
/** 누른 곳의 허수아비 (CSS px) — 몸 둘레, 없으면 null */
export function dummyAt(w: number, h: number, x: number, y: number): Dir | null {
  const L = trainLayout(w, h);
  let best: Dir | null = null;
  let bd = L.R * 0.45;
  L.dummy.forEach(([dx, dy], i) => {
    const d = Math.hypot(x - dx, y - (dy - L.catH * 0.55));
    if (d < bd) [best, bd] = [i as Dir, d];
  });
  return best;
}
/** 허수아비 가운데 (CSS px) — 검증용 */
export const dummyPoint = (w: number, h: number, d: Dir) => {
  const L = trainLayout(w, h);
  return { x: L.dummy[d][0], y: L.dummy[d][1] - L.catH * 0.55 };
};

// ── 떠오르는 글 · 교관 동작 · 부스러기 (사건으로) ──
type Label = { text: string; x: number; y: number; t: number; color: string; big: boolean };
let labels: Label[] = [];
let straws: { x: number; y: number; vx: number; vy: number; t: number }[] = [];
const coach = { anim: 'idle', t: 0 };
let wob = [0, 0, 0, 0];
export function resetTrainFx() {
  labels = [];
  straws = [];
  wob = [0, 0, 0, 0];
  Object.assign(coach, { anim: 'job_b', t: 0 }); // 시작: 공격 시범
}
export function trainFx(s: TrainState, events: TrainEvent[], w: number, h: number) {
  const L = trainLayout(w, h);
  // 허수아비 머리 위 (아래 허수아비는 발밑 — 고양이를 가리지 않게)
  const at = (d: Dir) => [L.dummy[d][0], d === 2 ? L.dummy[d][1] + L.catH * 0.95 : L.dummy[d][1] - L.catH * 1.6] as const;
  const say = (text: string, x: number, y: number, color: string, big = false) => labels.push({ text, x, y, t: 0, color, big });
  for (const e of events) {
    if (e.type === 'hit') {
      const [x, y] = at(e.dir);
      say(e.quick ? '딱!' : '좋아', x, y, e.quick ? '#ffe27a' : '#ffffff', e.quick);
      wob[e.dir] = 1;
      for (let i = 0; i < 7; i++) straws.push({ x, y: y + L.catH * 0.5, vx: (Math.random() - 0.5) * L.R * 1.6, vy: -Math.random() * L.R * 1.4, t: 0 });
    } else if (e.type === 'miss') say('놓침', ...at(e.dir), '#c9c2b8');
    else if (e.type === 'whiff') say('헛손질', ...at(e.dir), '#ff9a8a');
    else if (e.type === 'bonus') say(`연속 ${s.combo}! +${e.n}`, L.cx, L.cy - L.R * 1.05, '#ffd23a', true);
    else if (e.type === 'warn') Object.assign(coach, { anim: 'job_a', t: 0 }); // 훈련 지시 — 공을 굴린다
    else if (e.type === 'dodge') say('피했다!', L.cx, L.cy - L.catH * 1.6, '#9fe3ff', true);
    else if (e.type === 'bonk') say('콩!', L.cx, L.cy - L.catH * 1.6, '#ffe27a', true);
    else if (e.type === 'done') Object.assign(coach, { anim: e.score >= 40 ? 'affection' : 'job_c', t: 0 });
  }
}

// ── 그림 ──
function drawYard(ctx: CanvasRenderingContext2D, w: number, h: number, L: ReturnType<typeof trainLayout>) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#9fd27e');
  g.addColorStop(1, '#7fbf5f');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // 모래 마당
  ctx.fillStyle = '#e6c98f';
  ctx.beginPath();
  ctx.ellipse(L.cx, L.cy, L.R * 1.55, L.R * 1.22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(150, 110, 60, 0.12)';
  ctx.beginPath();
  ctx.ellipse(L.cx, L.cy, L.R * 0.42, L.R * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // 울타리 기둥 · 가로대 (둘레)
  ctx.strokeStyle = '#a8784a';
  ctx.lineWidth = Math.max(2, L.R * 0.025);
  ctx.beginPath();
  ctx.ellipse(L.cx, L.cy, L.R * 1.62, L.R * 1.3, 0, 0, Math.PI * 2);
  ctx.stroke();
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const x = L.cx + Math.cos(a) * L.R * 1.62;
    const y = L.cy + Math.sin(a) * L.R * 1.3;
    ctx.fillStyle = '#8a5a35';
    ctx.fillRect(x - L.R * 0.025, y - L.R * 0.12, L.R * 0.05, L.R * 0.14);
  }
}
/** 허수아비 (발밑 x, y) — 나무 기둥 · 짚 몸통 · 머리 · 과녁. lit = 빛나는 중 (k = 남은 빛 0..1, quick = 딱 칸) */
function drawDummy(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, lit: { k: number; quick: boolean } | null, wobble: number, t: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.sin(t * 40) * 0.25 * wobble);
  ctx.fillStyle = 'rgba(60,45,30,0.25)';
  ctx.beginPath();
  ctx.ellipse(0, 0, s * 0.32, s * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  if (lit) {
    ctx.fillStyle = `rgba(255, 226, 90, ${0.35 + 0.2 * Math.sin(t * 12)})`;
    ctx.beginPath();
    ctx.ellipse(0, -s * 0.55, s * 0.62, s * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#8a5a35';
  ctx.fillRect(-s * 0.05, -s * 0.9, s * 0.1, s * 0.9);
  ctx.fillRect(-s * 0.36, -s * 0.72, s * 0.72, s * 0.08);
  ctx.fillStyle = '#e3c46b';
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.55, s * 0.26, s * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -s * 1.0, s * 0.17, 0, Math.PI * 2);
  ctx.fill();
  for (const [r, c] of [[0.17, '#ef6b5e'], [0.11, '#ffffff'], [0.05, '#ef6b5e']] as const) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(0, -s * 0.55, s * r, 0, Math.PI * 2);
    ctx.fill();
  }
  if (lit) {
    ctx.strokeStyle = lit.quick ? '#ffd23a' : '#f08a3c';
    ctx.lineWidth = s * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, -s * 0.55, s * 0.42, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * lit.k);
    ctx.stroke();
  }
  ctx.restore();
}
function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number) {
  ctx.fillStyle = 'rgba(60,45,30,0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.35, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x, y - r);
  ctx.rotate(spin);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#4a90e2';
  ctx.beginPath();
  ctx.arc(0, 0, r, -0.5, 0.5);
  ctx.arc(0, 0, r * 0.2, 0.5, -0.5, true);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, r, Math.PI - 0.5, Math.PI + 0.5);
  ctx.arc(0, 0, r * 0.2, Math.PI + 0.5, Math.PI - 0.5, true);
  ctx.fill();
  ctx.restore();
}
const DIRV: [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];
let flip = 1;

export function drawTraining(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: TrainState, cat: Sheet, v: TrainViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cw / dpr;
  const h = ch / dpr;
  const L = trainLayout(w, h);
  const k = Math.min(1.25, Math.max(0.8, Math.min(w, h) / 600));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawYard(ctx, w, h, L);
  // 교관 (마당 왼쪽 위에서 지켜본다)
  coach.t += v.dt;
  const an = COACH.anims[coach.anim] ?? COACH.anims.idle;
  if (coach.anim !== 'idle' && coach.t > 2) Object.assign(coach, { anim: 'idle', t: 0 });
  const fi = Math.floor(coach.t * an.fps);
  const cut = an.f[coach.anim === 'idle' ? fi % an.f.length : Math.min(an.f.length - 1, fi)];
  const im = image(COACH.file).img;
  if (im.complete && im.naturalWidth) {
    const ck = (L.catH * 1.25) / 96;
    const [sx, sy, sw, sh, px, py] = cut;
    const x0 = L.cx - L.R * 1.38;
    const y0 = L.cy - L.R * 0.62;
    ctx.fillStyle = 'rgba(60,45,30,0.25)';
    ctx.beginPath();
    ctx.ellipse(x0, y0, L.catH * 0.4, L.catH * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(im, sx, sy, sw, sh, x0 - px * ck, y0 - py * ck, sw * ck, sh * ck);
  }
  // 허수아비 · 공 · 고양이 (아래 것을 나중에)
  wob = wob.map((x) => Math.max(0, x - v.dt * 2.5));
  type Thing = { y: number; draw: () => void };
  const things: Thing[] = L.dummy.map(([x, y], d) => ({
    y,
    draw: () => {
      const lit = s.lit?.dir === d ? { k: 1 - s.lit.t / s.lit.life, quick: s.lit.t <= s.lit.life * TRAIN.quick } : null;
      drawDummy(ctx, x, y, L.catH * 1.25, lit, wob[d], v.t);
    },
  }));
  if (s.ball) {
    const b = s.ball;
    const fly = b.t - TRAIN.warn;
    const span = L.R * 1.6;
    if (fly < 0) {
      // 예고: 그쪽 가장자리에서 깜빡이는 ! 와 굴러올 길
      const ex = L.cx + b.side * span;
      if (Math.floor(v.t * 8) % 2 === 0) {
        ctx.font = `bold ${Math.round(L.catH * 0.9)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ef4b3e';
        ctx.fillText('!', ex, L.cy - L.catH * 0.4);
      }
      ctx.setLineDash([L.R * 0.06, L.R * 0.05]);
      ctx.strokeStyle = 'rgba(239,75,62,0.55)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex, L.cy + 4);
      ctx.lineTo(L.cx, L.cy + 4);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      const x = L.cx + b.side * span * (1 - fly / TRAIN.fly);
      things.push({ y: L.cy + 1, draw: () => drawBall(ctx, x, L.cy + L.catH * 0.05, L.catH * 0.2, -b.side * fly * 12) });
    }
  }
  things.push({
    y: L.cy,
    draw: () => {
      const hurt = s.hurtT < TRAIN.hurt;
      const roll = s.rollT < TRAIN.roll;
      const punch = s.punch && s.punch.t < 0.25 ? s.punch : null;
      if (punch && DIRV[punch.dir][0]) flip = DIRV[punch.dir][0];
      const row = hurt ? CAT_ROW.hurt : roll ? CAT_ROW.roll : punch ? CAT_ROW.punch : CAT_ROW.idle;
      const tt = hurt ? s.hurtT : roll ? s.rollT : punch ? punch.t : v.t;
      const fps = hurt ? CAT_FPS.hurt : roll ? 6 / TRAIN.roll : punch ? CAT_FPS.punch * 1.5 : CAT_FPS.idle;
      const col = Math.min(5, Math.floor(tt * fps)) % 6;
      const lunge = punch ? (1 - punch.t / 0.25) * L.R * 0.16 : 0;
      const [dx, dy] = punch ? DIRV[punch.dir] : [0, 0];
      const x = L.cx + dx * lunge;
      const y = L.cy + dy * lunge * 0.78;
      ctx.fillStyle = 'rgba(60, 45, 30, 0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y, L.catH * 0.34, L.catH * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      const cc = hurt || roll || punch ? col : Math.floor(v.t * CAT_FPS.idle) % 6;
      drawFrame(ctx, cat, row, cc, x, y, (L.catH * cat.base) / cat.bodyH, flip);
      drawWorn(ctx, cat, row, cc, x, y, (L.catH * cat.base) / cat.bodyH, flip);
      drawEmote(ctx, x, y - L.catH * 1.25, L.catH * 0.8);
    },
  });
  things.sort((a, b) => a.y - b.y).forEach((o) => o.draw());
  // 짚 부스러기 · 떠오르는 글
  for (const p of straws) {
    p.t += v.dt;
    p.vy += L.R * 3 * v.dt;
    p.x += p.vx * v.dt;
    p.y += p.vy * v.dt;
  }
  straws = straws.filter((p) => p.t < 0.6);
  ctx.fillStyle = '#e8cf7a';
  for (const p of straws) ctx.fillRect(p.x, p.y, L.R * 0.04, L.R * 0.012);
  for (const l of labels) l.t += v.dt;
  labels = labels.filter((l) => l.t < 1);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const l of labels) {
    ctx.globalAlpha = Math.min(1, (1 - l.t) / 0.3);
    ctx.font = `bold ${Math.round(L.catH * (l.big ? 0.62 : 0.48))}px system-ui, sans-serif`;
    ctx.lineWidth = L.catH * 0.12;
    ctx.strokeStyle = 'rgba(50, 38, 28, 0.85)';
    const y = l.y - Math.min(1, l.t / 0.8) * L.catH * 0.6;
    ctx.strokeText(l.text, l.x, y);
    ctx.fillStyle = l.color;
    ctx.fillText(l.text, l.x, y);
  }
  ctx.globalAlpha = 1;

  // HUD: 알약 · 돌아가기 · 남은 시간 · 점수 · 하트 · 연속
  const M = miniLayout(w, h);
  drawPill(ctx, M, ['🎯 훈련장', v.best !== null ? `최고 기록 ${v.best}점` : '허수아비 치기 · 공 피하기']);
  drawLeave(ctx, M, v.hover, v.touch);
  const secs = Math.ceil(timeLeft(s));
  const hurry = s.phase === 'play' && secs <= TRAIN.hurry;
  const pulse = hurry ? 1 + 0.08 * Math.max(0, Math.sin(v.t * 10)) : 1;
  const out = (text: string, x: number, y: number, px: number, color: string) => {
    ctx.font = `bold ${Math.round(px * k)}px system-ui, sans-serif`;
    ctx.lineWidth = 5 * k;
    ctx.strokeStyle = 'rgba(91, 74, 63, 0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  };
  ctx.textAlign = 'center';
  const ty = M.s.t + 52 * M.k;
  out(String(secs), w / 2, ty, 40 * pulse, hurry ? '#ff8a6a' : '#fffaf0');
  const hearts = '♥'.repeat(Math.max(0, s.hearts)) + '♡'.repeat(TRAIN.hearts - Math.max(0, s.hearts));
  ctx.textAlign = 'right';
  out(`🎯 ${s.score}점`, w / 2 + 4 * k, ty + 28 * k, 20, '#ffe9a8');
  ctx.textAlign = 'left';
  out(hearts, w / 2 + 14 * k, ty + 28 * k, 20, '#ff8a8a');
  ctx.textAlign = 'center';
  if (s.combo >= 3) out(`연속 ${s.combo}`, w / 2, ty + 52 * k, 16, '#ffd23a');
  if (s.phase === 'ready') {
    // 안내 (처음 빛나는 허수아비는 옆이라 위 허수아비를 가려도 된다 — training.ts makeTraining)
    const lines = [
      v.touch ? '빛나는 허수아비를 눌러 시작!' : '빛나는 허수아비 쪽 방향키(WASD · ←↑→↓)로 시작!',
      v.touch ? `공이 오면 닿기 직전에 구르기 버튼 · ${TRAIN.time}초 · 하트 ${TRAIN.hearts}개` : `공이 오면 닿기 직전에 Space 로 구르기 · ${TRAIN.time}초 · 하트 ${TRAIN.hearts}개`,
    ];
    const y0 = ty + 44 * k;
    const bw = Math.min(w - 24, 470 * k);
    ctx.fillStyle = 'rgba(60, 45, 35, 0.55)';
    ctx.beginPath();
    ctx.roundRect(w / 2 - bw / 2, y0, bw, 62 * k, 16 * k);
    ctx.fill();
    lines.forEach((t, i) => out(t, w / 2, y0 + (26 + i * 24) * k, i ? 14 : 18, '#fffaf0'));
  }
  if (s.phase === 'done' && s.doneT >= TRAIN.cardDelay) {
    const best = v.best === null || s.score >= v.best;
    drawCard(
      ctx,
      M,
      s.why === 'hearts' ? '하트를 다 잃었어요' : '훈련 끝!',
      [
        [`${s.score}점 · 허수아비 ${s.hits}번 (딱! ${s.quicks})${best && s.score > 0 ? ' · 최고 기록!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.coins}개`, '#c98a1c'],
        [`가장 긴 연속 ${s.bestCombo}번`, '#3f95dd'],
        [v.best !== null ? `최고 기록 ${Math.max(v.best, s.score)}점` : '첫 기록!', '#9a7b62'],
      ],
      v.hover,
      '다시 하기',
      '마을로',
    );
  }
}
