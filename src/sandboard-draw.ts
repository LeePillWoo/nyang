// 샌드보드 그리기 — 위에서 내려다본 비탈이 위로 흘러간다 (고양이는 화면 위쪽에서 아래로 미끄러진다).
// 모래 결 · 가장자리 모래언덕과 선인장 · 장애물(바위 = 아이템 아이콘, 선인장 = 캔버스, 점프대, 냥코인, 아르마딜로 = 몬스터 시트) ·
// 엉덩이 미끄럼 컷의 고양이(점프는 구르기 컷, 어지러우면 피격 컷) + 보드 · 모래 보라 · HUD. 로직은 sandboard.ts.
import { drawCoin, drawIcon } from './bag-draw.ts';
import { CAT_FPS, CAT_ROW, SNOW_ROW } from './cat.ts';
import { drawEmote } from './emote.ts';
import { clock, drawCard, drawLeave, drawPill, miniLayout, type MiniButton } from './mini-draw.ts';
import { SAND, type Ob, type SandState } from './sandboard.ts';
import { drawFrame, type Sheet } from './sheet.ts';

export type SandViewOpts = { t: number; dt: number; touch: boolean; hover: MiniButton; best: number | null };
export type SandSheets = { cat: Sheet; snow: Sheet; armadillo?: Sheet };
/** 캔버스 픽셀 기준: 비탈 가운데 x · 반폭 · 고양이 y · m 당 px (검증 도구용) */
export const sandView = { cx: 0, half: 1, y0: 0, ppm: 1 };

let spray: { x: number; y: number; vx: number; vy: number; t: number }[] = [];
export function resetSandFx() {
  spray = [];
}

/** 선인장 — 둥근 몸통 + 팔 둘 (캔버스 픽셀) */
function cactus(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#5e9e4a';
  const w = h * 0.34;
  const arm = (dx: number, dy: number) => {
    ctx.beginPath();
    ctx.roundRect(x + dx - w * 0.3, y - dy, w * 0.6, h * 0.4, w * 0.3);
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(dx < 0 ? x + dx - w * 0.3 : x, y - dy + h * 0.25, Math.abs(dx) + w * 0.3, w * 0.5, w * 0.25);
    ctx.fill();
  };
  arm(-w * 1.1, h * 0.75);
  arm(w * 1.1, h * 0.6);
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, w / 2);
  ctx.fill();
  ctx.fillStyle = '#3f7a33';
  ctx.beginPath();
  ctx.roundRect(x + w * 0.1, y - h + w * 0.3, w * 0.22, h - w * 0.6, w * 0.1);
  ctx.fill();
  ctx.restore();
}

export function drawSandboard(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: SandState, sheets: SandSheets, v: SandViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  const L = miniLayout(cw / dpr, ch / dpr);
  const cx = cw / 2;
  const half = Math.min(cw * 0.38, ch * 0.5);
  const y0 = ch * 0.32;
  const ppm = ch / 48;
  Object.assign(sandView, { cx, half, y0, ppm });
  const X = (x: number) => cx + x * half;
  const Y = (d: number) => y0 + (d - s.d) * ppm;
  const k = half / 300; // 그림 크기 배율 (비탈 반폭 300px 기준)

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 모래: 바깥은 조금 어둡고, 비탈은 밝다 (가장자리는 부드럽게)
  const sky = ctx.createLinearGradient(0, 0, 0, ch);
  sky.addColorStop(0, '#d4ab6e');
  sky.addColorStop(1, '#c79a5c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, cw, ch);
  const strip = ctx.createLinearGradient(cx - half * 1.15, 0, cx + half * 1.15, 0);
  strip.addColorStop(0, 'rgba(240, 214, 160, 0)');
  strip.addColorStop(0.12, '#f0d6a0');
  strip.addColorStop(0.88, '#f0d6a0');
  strip.addColorStop(1, 'rgba(240, 214, 160, 0)');
  ctx.fillStyle = strip;
  ctx.fillRect(cx - half * 1.15, 0, half * 2.3, ch);
  // 모래 결 (5m 마다 물결 한 줄, 위로 흘러간다)
  ctx.strokeStyle = 'rgba(160, 120, 70, 0.22)';
  ctx.lineWidth = 2 * k;
  for (let d = Math.floor((s.d - 20) / 5) * 5; d < s.d + 50; d += 5) {
    const y = Y(d);
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const x = cx - half + (i / 20) * half * 2;
      const yy = y + Math.sin(i * 1.1 + d * 0.37) * 4 * k;
      if (i) ctx.lineTo(x, yy);
      else ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
  // 가장자리 선인장 (14m 마다 번갈아)
  for (let d = Math.floor((s.d - 20) / 14) * 14; d < s.d + 50; d += 14) {
    const side = (d / 14) % 2 === 0 ? -1 : 1;
    const wob = ((d * 7919) % 100) / 100;
    cactus(ctx, cx + side * (half * 1.08 + wob * half * 0.25), Y(d), (46 + wob * 30) * k, 0.8);
  }

  // 장애물 (멀리 있는 것부터)
  for (const ob of [...s.obs].sort((a, b) => b.d - a.d)) {
    if (ob.got) continue;
    const x = X(ob.x);
    const y = Y(ob.d);
    if (y < -60 * k || y > ch + 60 * k) continue;
    drawOb(ctx, ob, x, y, k, sheets, v.t);
  }

  // 모래 보라: 땅에서 미끄러질 때 뒤(화면 위쪽)로 튄다
  if (s.phase === 'play' && s.air <= 0)
    for (let i = 0; i < 2; i++) spray.push({ x: X(s.x) + (Math.random() - 0.5) * 24 * k, y: y0 + 14 * k, vx: (Math.random() - 0.5) * 60 * k - s.flip * 20 * k, vy: -(90 + Math.random() * 90) * k, t: 0 });
  for (const p of spray) {
    p.t += v.dt;
    p.x += p.vx * v.dt;
    p.y += (p.vy - s.v * ppm * 0.6) * v.dt;
  }
  spray = spray.filter((p) => p.t < 0.5);
  ctx.fillStyle = 'rgba(200, 160, 100, 0.7)';
  for (const p of spray) {
    ctx.globalAlpha = 1 - p.t / 0.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, (3 + p.t * 6) * k, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 고양이: 그림자 → 보드 → 몸 (공중이면 떠오른다)
  const lift = s.air > 0 ? Math.sin(Math.PI * (1 - s.air / s.airMax)) * 70 * k : 0;
  const px = X(s.x);
  ctx.fillStyle = 'rgba(70, 50, 30, 0.28)';
  ctx.beginPath();
  ctx.ellipse(px, y0 + 8 * k, (30 - lift * 0.1) * k, (10 - lift * 0.04) * k, 0, 0, Math.PI * 2);
  ctx.fill();
  const tilt = s.dizzy > 0 ? Math.sin(v.t * 30) * 0.2 : s.flip * Math.min(0.35, Math.abs(s.x) * 0.2);
  ctx.save();
  ctx.translate(px, y0 + 4 * k - lift);
  ctx.rotate(tilt);
  ctx.fillStyle = '#8a5a2b';
  ctx.beginPath();
  ctx.roundRect(-30 * k, -6 * k, 60 * k, 12 * k, 6 * k);
  ctx.fill();
  ctx.fillStyle = '#b8803f';
  ctx.beginPath();
  ctx.roundRect(-26 * k, -4 * k, 52 * k, 4 * k, 2 * k);
  ctx.fill();
  ctx.restore();
  const body = 34 * k;
  let sheet = sheets.snow;
  let row = SNOW_ROW.slide;
  let col = Math.floor(s.animT * 10) % 6;
  if (s.dizzy > 0) {
    sheet = sheets.cat;
    row = CAT_ROW.hurt;
    col = Math.floor(s.animT * CAT_FPS.hurt) % 6;
  } else if (s.air > 0) {
    sheet = sheets.cat;
    row = CAT_ROW.roll;
    col = Math.min(5, Math.floor((1 - s.air / s.airMax) * 6));
  }
  const size = (body / sheet.bodyH) * sheet.base;
  drawFrame(ctx, sheet, row, col, px, y0 - lift, size, s.flip);
  drawEmote(ctx, px, y0 - lift - body * 1.3, body * 0.8);

  // 속도감: 빠르면 가장자리에 흐르는 줄
  if (s.v > 17 && s.phase === 'play') {
    ctx.strokeStyle = `rgba(255,255,255,${Math.min(0.5, (s.v - 17) * 0.1)})`;
    ctx.lineWidth = 2 * k;
    for (let i = 0; i < 6; i++) {
      const x = i < 3 ? cx - half * (1.0 + i * 0.07) : cx + half * (1.0 + (i - 3) * 0.07);
      const y = ((v.t * 900 * k + i * 173) % (ch + 100)) - 50;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 60 * k);
      ctx.stroke();
    }
  }

  // HUD (CSS px): 진행 막대 · 알약 · 돌아가기 · 출발 · 결과
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cw / dpr;
  const kk = L.k;
  const bw = Math.min(260 * kk, W - 380 * kk);
  const bx = W / 2 - bw / 2;
  const by = L.s.t + 22 * kk;
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.beginPath();
  ctx.roundRect(bx - 10 * kk, by - 12 * kk, bw + 20 * kk, 26 * kk, 13 * kk);
  ctx.fill();
  ctx.fillStyle = 'rgba(120,85,55,0.2)';
  ctx.fillRect(bx, by - 3 * kk, bw, 6 * kk);
  ctx.fillStyle = '#f5a05a';
  ctx.fillRect(bx, by - 3 * kk, bw * (s.d / SAND.length), 6 * kk);
  ctx.font = `${14 * kk}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('🏁', bx + bw + 2 * kk, by + 5 * kk);
  ctx.fillText('🐱', bx + bw * (s.d / SAND.length), by + 5 * kk);
  drawPill(ctx, L, [`🪙 ${s.coins} · ${clock(s.t)} · ${Math.round(s.v * 3.6)} km/h`, `${s.crashes ? `💥 ${s.crashes}번 부딪힘` : '무사히 달리는 중'}${v.best !== null ? ` · 최고 점수 ${v.best}` : ''}`]);
  drawLeave(ctx, L, v.hover, v.touch);
  if (s.phase === 'play' && s.t < 1.3) {
    ctx.globalAlpha = Math.min(1, (1.3 - s.t) / 0.4);
    ctx.font = `bold ${44 * kk}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8 * kk;
    ctx.strokeStyle = 'rgba(70,52,42,0.85)';
    ctx.strokeText('출발!', W / 2, (ch / dpr) * 0.55);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText('출발!', W / 2, (ch / dpr) * 0.55);
    ctx.globalAlpha = 1;
  }
  if (s.phase === 'done')
    drawCard(
      ctx,
      L,
      '완주!',
      [
        [`점수 ${s.score}${v.best !== null && s.score >= v.best ? ' · 최고 점수!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.coins}개 · ${clock(s.t)}`, '#c98a1c'],
        [s.crashes === 0 ? `무사 완주 보너스 +${SAND.cleanBonus}` : `${s.crashes}번 부딪혔어요`, s.crashes === 0 ? '#3e9a45' : '#d4574a'],
        [v.best !== null ? `최고 점수 ${Math.max(v.best, s.score)}` : '첫 완주!', '#9a7b62'],
      ],
      v.hover,
      '다시 타기',
    );
}

function drawOb(ctx: CanvasRenderingContext2D, ob: Ob, x: number, y: number, k: number, sheets: SandSheets, t: number) {
  switch (ob.kind) {
    case 'coin':
      drawCoin(ctx, x, y + Math.sin(t * 5 + ob.d) * 3 * k, 13 * k);
      return;
    case 'rock':
      ctx.fillStyle = 'rgba(70, 50, 30, 0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 10 * k, 24 * k, 8 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      drawIcon(ctx, 'materials_07', x, y - 6 * k, 52 * k);
      return;
    case 'cactus':
      ctx.fillStyle = 'rgba(70, 50, 30, 0.25)';
      ctx.beginPath();
      ctx.ellipse(x, y + 4 * k, 18 * k, 6 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      cactus(ctx, x, y + 4 * k, 46 * k);
      return;
    case 'ramp': {
      // 점프대: 아래로 갈수록 높아지는 모래 턱 + 화살표
      const w = 80 * k;
      const g = ctx.createLinearGradient(0, y - 16 * k, 0, y + 16 * k);
      g.addColorStop(0, '#f6e2b4');
      g.addColorStop(1, '#c99a5a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x - w / 2, y - 16 * k, w, 32 * k, 8 * k);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120,85,55,0.45)';
      ctx.lineWidth = 2 * k;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(x - w * 0.4, y + i * 9 * k);
        ctx.lineTo(x + w * 0.4, y + i * 9 * k);
        ctx.stroke();
      }
      ctx.fillStyle = '#fff6d8';
      ctx.font = `bold ${16 * k}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('▲', x, y + 6 * k);
      return;
    }
    case 'armadillo': {
      ctx.fillStyle = 'rgba(70, 50, 30, 0.28)';
      ctx.beginPath();
      ctx.ellipse(x, y + 8 * k, 24 * k, 8 * k, 0, 0, Math.PI * 2);
      ctx.fill();
      const sh = sheets.armadillo;
      if (sh) drawFrame(ctx, sh, 1, Math.floor(ob.anim * 9) % 6, x, y + 8 * k, (40 * k * sh.base) / sh.bodyH, (ob.vx ?? 1) < 0 ? -1 : 1);
      else {
        ctx.fillStyle = '#9a6b45';
        ctx.beginPath();
        ctx.arc(x, y, 18 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
