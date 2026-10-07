// 장작 패기 그리기 — 옆에서 본 숲 속 공터 · 가운데 나무 기둥(토막 · 가지 · 그루터기) · 양옆에서 도끼질하는 치즈 ·
// 날아가는 토막 · 나무 부스러기 · 위 가운데 점수와 시간 막대 · 미니게임 공용 HUD(알약 · 돌아가기 · 결과 카드).
// 전용 그림이 없어 캔버스로 그린다 — 그림이 오면 drawBackdrop · drawSeg · drawBranch · drawStump · drawLog 만 바꾼다. 로직은 timber.ts.
import { AXE_FPS, AXE_ROW, CAT_ROW } from './cat.ts';
import { drawEmote } from './emote.ts';
import { drawCard, drawLeave, drawPill, miniLayout, type MiniButton } from './mini-draw.ts';
import { drawFrame, type Sheet } from './sheet.ts';
import { TIMBER, type Seg, type Side, type TimberEvent, type TimberState } from './timber.ts';

export type TimberViewOpts = { t: number; dt: number; touch: boolean; hover: MiniButton; best: number | null };
export type TimberSheets = { axe: Sheet; cat: Sheet };

/** 자리 (CSS px): 토막 높이 sh · 기둥 폭 tw · 가운데 cx · 땅 gy · 그루터기 윗면 · 고양이 키 */
export function timberLayout(w: number, h: number) {
  const sh = Math.max(38, Math.min(90, Math.min(w * 0.13, h * 0.105)));
  const gy = h * (h > w ? 0.8 : 0.83);
  return { sh, tw: sh * 1.25, cx: w / 2, gy, top: gy - sh * 0.32, catH: sh * 1.35 };
}
type Layout = ReturnType<typeof timberLayout>;
/** 고양이가 서는 가로 자리 */
export const catX = (L: Layout, side: Side) => L.cx + side * (L.tw * 0.5 + L.catH * 0.4);

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

// ── 배경: 하늘 · 먼 숲 · 가까운 숲 · 풀밭 · 공터 · 장작더미 (크기가 바뀔 때만 다시 그린다) ──
let back: HTMLCanvasElement | null = null;
let backKey = '';
function drawBackdrop(w: number, h: number, dpr: number, L: Layout) {
  const key = `${w}x${h}x${dpr}`;
  if (back && backKey === key) return back;
  backKey = key;
  back = document.createElement('canvas');
  back.width = Math.round(w * dpr);
  back.height = Math.round(h * dpr);
  const g = back.getContext('2d')!;
  g.scale(dpr, dpr);
  const rnd = seeded(7);
  const sky = g.createLinearGradient(0, 0, 0, L.gy);
  sky.addColorStop(0, '#bfe3ee');
  sky.addColorStop(1, '#eef7df');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);
  // 숲 줄: 둥근 나무 · 뾰족한 나무를 늘어놓고 그 아래를 메운다
  const woods = (y: number, r0: number, r1: number, round: string, pine: string) => {
    for (let x = -r1; x < w + r1; x += r0 * 1.15) {
      const r = r0 + rnd() * (r1 - r0);
      const yy = y - rnd() * r * 0.6;
      g.fillStyle = rnd() < 0.35 ? pine : round;
      g.beginPath();
      if (g.fillStyle === pine) {
        g.moveTo(x, yy - r * 1.6);
        g.lineTo(x + r * 0.85, yy + r * 0.4);
        g.lineTo(x - r * 0.85, yy + r * 0.4);
      } else g.arc(x, yy, r, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = round;
    g.fillRect(0, y, w, L.gy - y + 4);
  };
  woods(L.gy - h * 0.42, L.sh * 0.7, L.sh * 1.2, '#b4dcc0', '#a4d0b4');
  woods(L.gy - h * 0.25, L.sh * 0.8, L.sh * 1.4, '#8cc690', '#78b783');
  woods(L.gy - L.sh * 0.45, L.sh * 0.35, L.sh * 0.6, '#6fae66', '#5f9f5a');
  // 풀밭 · 공터
  const grass = g.createLinearGradient(0, L.gy - L.sh * 0.2, 0, h);
  grass.addColorStop(0, '#a6d77c');
  grass.addColorStop(1, '#86bf5f');
  g.fillStyle = grass;
  g.fillRect(0, L.gy - L.sh * 0.2, w, h);
  g.fillStyle = '#e2c189';
  g.beginPath();
  g.ellipse(L.cx, L.gy + L.sh * 0.15, Math.min(w * 0.46, L.tw * 4.2), L.sh * 0.55, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(120, 85, 45, 0.14)';
  for (let i = 0; i < 26; i++) g.fillRect(L.cx + (rnd() - 0.5) * L.tw * 7, L.gy + (rnd() - 0.2) * L.sh * 0.6, L.sh * 0.12, L.sh * 0.04);
  // 장작더미 (왼쪽 뒤) · 도끼 꽂힌 받침 (오른쪽 뒤)
  const r = L.sh * 0.2;
  const px = Math.max(r * 4, L.cx - L.tw * 3.4);
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 4 - row; i++) {
      const x = px + (i - (3 - row) / 2) * r * 2.05;
      const y = L.gy - L.sh * 0.2 - r - row * r * 1.8;
      g.fillStyle = '#9a6a3f';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#e8c48c';
      g.beginPath();
      g.arc(x, y, r * 0.72, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(150, 100, 55, 0.6)';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y, r * 0.38, 0, Math.PI * 2);
      g.stroke();
    }
  const bx = Math.min(w - r * 4, L.cx + L.tw * 3.3);
  const by = L.gy - L.sh * 0.15;
  g.fillStyle = '#8a5c34';
  g.fillRect(bx - L.sh * 0.32, by - L.sh * 0.42, L.sh * 0.64, L.sh * 0.42);
  g.fillStyle = '#e2bd84';
  g.beginPath();
  g.ellipse(bx, by - L.sh * 0.42, L.sh * 0.32, L.sh * 0.1, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#6b4526';
  g.lineWidth = L.sh * 0.07;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(bx + L.sh * 0.05, by - L.sh * 0.45);
  g.lineTo(bx + L.sh * 0.32, by - L.sh * 0.95);
  g.stroke();
  g.fillStyle = '#c9ced6';
  g.beginPath();
  g.moveTo(bx - L.sh * 0.06, by - L.sh * 0.42);
  g.lineTo(bx + L.sh * 0.16, by - L.sh * 0.5);
  g.lineTo(bx + L.sh * 0.1, by - L.sh * 0.3);
  g.closePath();
  g.fill();
  return back;
}

// ── 기둥 ──
const BARK = ['#9a6a3f', '#93633a', '#a07247'];
/** 토막 하나 (n = 처음부터 센 번호 — 내려와도 무늬가 따라간다) */
function drawSeg(ctx: CanvasRenderingContext2D, L: Layout, y: number, n: number) {
  const x0 = L.cx - L.tw / 2;
  ctx.fillStyle = BARK[n % 3];
  ctx.fillRect(x0, y, L.tw, L.sh + 1);
  ctx.strokeStyle = 'rgba(70, 40, 20, 0.35)';
  ctx.lineWidth = Math.max(1, L.tw * 0.04);
  ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const gx = x0 + L.tw * (0.2 + 0.3 * i + ((n * 7 + i * 3) % 5) * 0.025);
    ctx.beginPath();
    ctx.moveTo(gx, y + L.sh * 0.12);
    ctx.lineTo(gx + L.tw * 0.025, y + L.sh * 0.88);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(70, 40, 20, 0.18)';
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x0 + L.tw, y + 0.5);
  ctx.stroke();
}
/** 가지: 기둥 옆에서 바깥(dir)으로 살짝 위로, 끝에 잎 뭉치 — 고양이 머리 높이에 오면 맞는다 */
function drawBranch(ctx: CanvasRenderingContext2D, L: Layout, y: number, dir: number) {
  const len = L.tw * 1.35;
  const th = L.sh * 0.24;
  ctx.save();
  ctx.translate(L.cx + dir * L.tw * 0.45, y + L.sh * 0.5);
  ctx.scale(dir, 1);
  ctx.rotate(-0.12);
  ctx.fillStyle = '#7d5230';
  ctx.beginPath();
  ctx.roundRect(0, -th / 2, len, th, th / 2);
  ctx.fill();
  ctx.strokeStyle = '#7d5230';
  ctx.lineWidth = th * 0.45;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(len * 0.5, -th * 0.2);
  ctx.lineTo(len * 0.72, -th * 1.4);
  ctx.stroke();
  for (const [lx, ly, r, c] of [
    [len * 0.62, -th * 1.15, th * 0.75, '#9ad16a'],
    [len * 0.8, -th * 1.7, th * 0.95, '#7cc35a'],
    [len * 1.08, -th * 1.45, th * 0.85, '#4e9a40'],
    [len * 0.97, -th * 0.55, th * 1.1, '#5fae4a'],
  ] as [number, number, number, string][]) {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.ellipse(lx, ly, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
/** 그루터기: 맨 아래 토막이 얹힌 넓은 밑동과 뿌리 */
function drawStump(ctx: CanvasRenderingContext2D, L: Layout) {
  const { cx, tw, top, gy } = L;
  ctx.fillStyle = '#86582f';
  ctx.beginPath();
  ctx.moveTo(cx - tw * 0.5, top);
  ctx.lineTo(cx + tw * 0.5, top);
  ctx.quadraticCurveTo(cx + tw * 0.55, gy - L.sh * 0.05, cx + tw * 0.85, gy + L.sh * 0.05);
  ctx.lineTo(cx - tw * 0.85, gy + L.sh * 0.05);
  ctx.quadraticCurveTo(cx - tw * 0.55, gy - L.sh * 0.05, cx - tw * 0.5, top);
  ctx.fill();
  ctx.fillStyle = 'rgba(60, 35, 15, 0.25)';
  ctx.fillRect(cx + tw * 0.15, top, tw * 0.35, gy - top);
}
/** 날아가는 토막 (가지가 있었으면 같이) */
function drawLog(ctx: CanvasRenderingContext2D, L: Layout, x: number, y: number, rot: number, seg: Seg, n: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  if (seg) drawBranch(ctx, { ...L, cx: 0 }, -L.sh / 2, seg);
  drawSeg(ctx, { ...L, cx: 0 }, -L.sh / 2, n);
  ctx.restore();
}

// ── 날아가는 것 ── 토막(쪼갠 반대쪽으로 빙글빙글) · 나무 부스러기 · '빨라져요'
type Fly = { dir: number; seg: Seg; n: number; t: number };
let flies: Fly[] = [];
type Chip = { x: number; y: number; vx: number; vy: number; t: number; life: number; size: number; color: string };
let chips: Chip[] = [];
let level: { n: number; t: number } | null = null;
/** 이번 프레임 사건 → 날아가는 토막 · 부스러기 (w, h = CSS px) */
export function timberFx(s: TimberState, events: TimberEvent[], w: number, h: number) {
  const L = timberLayout(w, h);
  for (const e of events) {
    if (e.type === 'chop') {
      flies.push({ dir: -e.side, seg: e.seg, n: s.score - 1, t: 0 });
      for (let i = 0; i < 9; i++)
        chips.push({
          x: L.cx + e.side * L.tw * 0.5,
          y: L.top - L.sh * 0.5,
          vx: e.side * (60 + Math.random() * 200),
          vy: -(80 + Math.random() * 220),
          t: 0,
          life: 0.35 + Math.random() * 0.25,
          size: L.sh * (0.05 + Math.random() * 0.06),
          color: Math.random() < 0.5 ? '#f0d29a' : '#d9a86a',
        });
    } else if (e.type === 'level') level = { n: e.n, t: 0 };
  }
}

export function drawTimber(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: TimberState, sheets: TimberSheets, v: TimberViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  const w = cw / dpr;
  const h = ch / dpr;
  const L = timberLayout(w, h);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(drawBackdrop(w, h, dpr, L), 0, 0);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // 기둥: 그루터기 위에 토막을 쌓는다. 막 팼으면 한 칸 위에서 내려온다
  drawStump(ctx, L);
  const fall = s.phase === 'ready' ? 0 : Math.max(0, 1 - s.chopT / 0.07);
  const ys = (i: number) => L.top - L.sh * (i + 1) - L.sh * fall;
  for (let i = 0; i < s.segs.length && ys(i) + L.sh > 0; i++) drawSeg(ctx, L, ys(i), s.score + i);
  const shade = ctx.createLinearGradient(L.cx - L.tw / 2, 0, L.cx + L.tw / 2, 0);
  shade.addColorStop(0, 'rgba(0, 0, 0, 0.16)');
  shade.addColorStop(0.35, 'rgba(255, 255, 255, 0.07)');
  shade.addColorStop(1, 'rgba(0, 0, 0, 0.24)');
  ctx.fillStyle = shade;
  ctx.fillRect(L.cx - L.tw / 2, 0, L.tw, L.top);
  for (let i = 0; i < s.segs.length && ys(i) + L.sh > 0; i++) if (s.segs[i]) drawBranch(ctx, L, ys(i), s.segs[i]);

  // 날아가는 토막 (쪼갠 반대쪽으로 빙글빙글, 고양이 뒤에) · 부스러기
  for (const f of flies) f.t += v.dt;
  flies = flies.filter((f) => f.t < 0.5);
  for (const f of flies) {
    ctx.globalAlpha = Math.min(1, (0.5 - f.t) / 0.15);
    ctx.save();
    ctx.translate(L.cx + f.dir * L.sh * 13 * f.t, L.top - L.sh * 0.5 - L.sh * 2.6 * f.t + L.sh * 12 * f.t * f.t);
    ctx.scale(0.8, 0.8);
    drawLog(ctx, L, 0, 0, f.dir * f.t * 11, f.seg, f.n);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const c of chips) {
    c.t += v.dt;
    c.vy += 900 * v.dt;
    c.x += c.vx * v.dt;
    c.y += c.vy * v.dt;
  }
  chips = chips.filter((c) => c.t < c.life);
  for (const c of chips) {
    ctx.globalAlpha = Math.min(1, (c.life - c.t) / 0.15);
    ctx.fillStyle = c.color;
    ctx.fillRect(c.x - c.size / 2, c.y - c.size / 2, c.size, c.size * 0.6);
  }
  ctx.globalAlpha = 1;

  // 치즈: 기둥 쪽을 보고 선다. 팰 때 휘두르기, 맞으면 움찔하며 밀려난다
  const hit = s.phase === 'done' && s.why === 'hit';
  const back = hit ? Math.min(1, s.doneT / 0.18) * L.sh * 0.35 : 0;
  const x = catX(L, s.side) + s.side * back;
  ctx.fillStyle = 'rgba(70, 50, 30, 0.25)';
  ctx.beginPath();
  ctx.ellipse(x, L.gy, L.catH * 0.32, L.catH * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  const flip = -s.side;
  if (hit) {
    const cat = sheets.cat;
    drawFrame(ctx, cat, CAT_ROW.hurt, Math.min(5, Math.floor(s.doneT * 10)), x, L.gy, (L.catH * cat.base) / cat.bodyH, flip);
  } else {
    const axe = sheets.axe;
    const swing = s.phase !== 'ready' && s.chopT < 0.24;
    const col = swing ? (s.chopT < 0.07 ? 3 : s.chopT < 0.16 ? 4 : 5) : Math.floor(v.t * AXE_FPS.idle) % 6;
    drawFrame(ctx, axe, swing ? AXE_ROW.chop : AXE_ROW.idle, col, x, L.gy, (L.catH * axe.base) / axe.bodyH, flip);
  }
  drawEmote(ctx, x, L.gy - L.catH * 1.15, L.catH * 0.55);
  if (hit && s.doneT < 1.6) {
    // 머리 위를 도는 별
    for (let i = 0; i < 3; i++) {
      const a = s.doneT * 6 + (i * Math.PI * 2) / 3;
      star(ctx, x + Math.cos(a) * L.catH * 0.32, L.gy - L.catH * 1.02 + Math.sin(a) * L.catH * 0.1, L.catH * 0.07);
    }
  }

  // HUD: 알약 · 돌아가기 · 점수 · 시간 막대
  const M = miniLayout(w, h);
  const k = M.k;
  drawPill(ctx, M, ['🪓 장작 패기', v.best !== null ? `최고 기록 ${v.best}토막` : '가지를 피해 패요']);
  drawLeave(ctx, M, v.hover, v.touch);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  const sy = M.s.t + 58 * k;
  ctx.font = `bold ${44 * k}px system-ui, sans-serif`;
  ctx.lineWidth = 6 * k;
  ctx.strokeStyle = 'rgba(91, 74, 63, 0.85)';
  ctx.strokeText(String(s.score), w / 2, sy);
  ctx.fillStyle = '#fffaf0';
  ctx.fillText(String(s.score), w / 2, sy);
  const bw = Math.min(w * 0.5, 320 * k);
  const bh = 16 * k;
  const bx = w / 2 - bw / 2;
  const by = sy + 14 * k;
  const f = s.time / TIMBER.max;
  ctx.fillStyle = 'rgba(91, 74, 63, 0.55)';
  ctx.beginPath();
  ctx.roundRect(bx - 3 * k, by - 3 * k, bw + 6 * k, bh + 6 * k, (bh + 6 * k) / 2);
  ctx.fill();
  ctx.fillStyle = f > 0.5 ? '#7cc35a' : f > 0.25 ? '#f5a05a' : '#e8574a';
  if (f > 0) {
    ctx.beginPath();
    ctx.roundRect(bx, by, Math.max(bh, bw * f), bh, bh / 2);
    ctx.fill();
  }
  // 처음 안내 · 빨라져요
  if (s.phase === 'ready') {
    const y = ys(3) + L.sh * 0.2;
    ctx.font = `bold ${22 * k}px system-ui, sans-serif`;
    ctx.lineWidth = 5 * k;
    const line1 = v.touch ? '◀  ▶  눌러서 패요' : '◀ A  ·  D ▶  로 패요';
    ctx.strokeText(line1, w / 2, y);
    ctx.fillText(line1, w / 2, y);
    ctx.font = `bold ${15 * k}px system-ui, sans-serif`;
    ctx.lineWidth = 4 * k;
    const line2 = '가지가 내 쪽으로 내려오면 콩!';
    ctx.strokeText(line2, w / 2, y + 26 * k);
    ctx.fillText(line2, w / 2, y + 26 * k);
  }
  if (level) {
    level.t += v.dt;
    if (level.t > 1.2) level = null;
    else {
      ctx.globalAlpha = Math.min(1, (1.2 - level.t) / 0.3);
      ctx.font = `bold ${26 * k}px system-ui, sans-serif`;
      ctx.lineWidth = 5 * k;
      ctx.strokeStyle = 'rgba(150, 70, 30, 0.85)';
      ctx.strokeText('빨라져요!', w / 2, by + 52 * k - level.t * 20 * k);
      ctx.fillStyle = '#ffe27a';
      ctx.fillText('빨라져요!', w / 2, by + 52 * k - level.t * 20 * k);
      ctx.globalAlpha = 1;
    }
  }

  // 결과 카드 (맞는 모습을 잠깐 보여 준 뒤)
  if (s.phase === 'done' && s.doneT >= TIMBER.cardDelay) {
    const best = v.best === null || s.score >= v.best;
    drawCard(
      ctx,
      M,
      s.why === 'hit' ? '콩! 가지에 맞았어요' : '시간이 다 됐어요',
      [
        [`${s.score}토막${best && s.score > 0 ? ' · 최고 기록!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.coins}개`, '#c98a1c'],
        [s.logs ? `통나무 ${s.logs}개` : `통나무는 ${TIMBER.log}토막마다 하나`, s.logs ? '#3f95dd' : '#9a7b62'],
        [v.best !== null ? `최고 기록 ${Math.max(v.best, s.score)}토막` : '첫 기록!', '#9a7b62'],
      ],
      v.hover,
      '다시 패기',
      '돌아가기',
    );
  }
}

function star(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = '#ffe27a';
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
}
