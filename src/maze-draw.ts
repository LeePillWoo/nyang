// 미로 그리기 — 벽 · 빛(보이는 칸만 밝게, 본 적 있는 칸은 어둡게, 나머지는 캄캄) · 냥코인 · 보물 상자 · 출구 · 고양이 · HUD.
// 피라미드는 사암 벽과 횃불, 고래 배 속(theme 'whale')은 분홍 살 벽·갈비뼈와 플랑크톤 빛, 출구는 숨구멍.
// 미로를 화면에 맞춰 통째로 줄이고(칸 = px), 전용 그림이 없어 캔버스로 그린다. 로직은 maze.ts.
import { drawCoin, drawIcon } from './bag-draw.ts';
import { ITEMS } from './bag.ts';
import { CAT_FPS, CAT_ROW } from './cat.ts';
import { CELL, isSolid } from './collide.ts';
import { drawEmote } from './emote.ts';
import { MAZE, type MazeState } from './maze.ts';
import { clock, drawCard, drawLeave, drawPill, miniLayout, type MiniButton } from './mini-draw.ts';
import { drawFrame, type Sheet } from './sheet.ts';

export type MazeViewOpts = { t: number; dt: number; touch: boolean; hover: MiniButton; best: number | null };
/** 캔버스 픽셀 기준: 칸 크기와 원점 (검증 도구가 칸의 화면 위치를 찾을 때 쓴다) */
export const mazeView = { px: 1, ox: 0, oy: 0 };

const LOOK = {
  pyramid: {
    bg: '#1b130b',
    floor: '#e6c58c',
    spot: 'rgba(120,85,55,0.1)',
    wall: '#b8894f',
    top: '#d6ac70',
    side: '#8d6537',
    dark: 'rgba(27,19,11,0.6)',
    glow: 'rgba(255, 200, 110, 0.22)',
    shade: 'rgba(70, 50, 30, 0.3)',
    chest: 'curios_22',
  },
  whale: {
    bg: '#2a0d14',
    floor: '#f2b0b8',
    spot: 'rgba(160,50,75,0.13)',
    wall: '#b54a62',
    top: '#de7a8c',
    side: '#7c2a40',
    dark: 'rgba(42,13,20,0.62)',
    glow: 'rgba(150, 230, 255, 0.24)',
    shade: 'rgba(110, 30, 50, 0.3)',
    chest: 'curios_24',
  },
};

export function drawMaze(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: MazeState, cat: Sheet, v: MazeViewOpts) {
  const whale = s.theme === 'whale';
  const C = LOOK[s.theme];
  const dpr = Math.min(devicePixelRatio, 2);
  const L = miniLayout(cw / dpr, ch / dpr);
  // 위 HUD(약 70px) 와 아래 안내줄을 비우고 가운데에
  const px = Math.floor(Math.min((cw - 24 * dpr) / s.w, (ch - (L.s.t + 72) * dpr - 48 * dpr) / s.h));
  const ox = Math.floor((cw - s.w * px) / 2);
  const oy = Math.floor((L.s.t + 72) * dpr + (ch - (L.s.t + 72) * dpr - 48 * dpr - s.h * px) / 2);
  Object.assign(mazeView, { px, ox, oy });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(1, 0, 0, 1, ox, oy);

  // 칸: 길과 벽 (윗면 밝게 · 아래 그늘, 고래 배 속은 벽에 갈비뼈). 빛: lit 1 · seen 어둡게 · 나머지 안 그림
  for (let z = 0; z < s.h; z++)
    for (let x = 0; x < s.w; x++) {
      const i = z * s.w + x;
      if (!s.seen[i]) continue;
      const X = x * px;
      const Y = z * px;
      if (isSolid(s.grid, x, z)) {
        ctx.fillStyle = C.wall;
        ctx.fillRect(X, Y, px, px);
        ctx.fillStyle = C.top;
        ctx.fillRect(X, Y, px, px * 0.3);
        ctx.fillStyle = C.side;
        ctx.fillRect(X, Y + px * 0.82, px, px * 0.18);
        if (whale && x % 4 === 0) {
          // 갈비뼈: 벽을 세로로 가로지르는 상아색 띠
          ctx.fillStyle = '#d9c3a8';
          ctx.fillRect(X + px * 0.36, Y, px * 0.3, px);
          ctx.fillStyle = '#f6e7d2';
          ctx.fillRect(X + px * 0.38, Y, px * 0.22, px * 0.86);
        }
      } else {
        ctx.fillStyle = C.floor;
        ctx.fillRect(X, Y, px, px);
        if ((x * 7 + z * 13) % 5 === 0) {
          ctx.fillStyle = C.spot;
          ctx.fillRect(X + px * 0.3, Y + px * 0.55, px * 0.4, px * 0.1);
        }
        if (whale && (x * 5 + z * 3) % 7 === 0) {
          // 촉촉하게 반짝이는 살
          ctx.fillStyle = 'rgba(255,255,255,0.22)';
          ctx.beginPath();
          ctx.ellipse(X + px * 0.35, Y + px * 0.3, px * 0.14, px * 0.06, -0.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      if (!s.lit[i]) {
        ctx.fillStyle = C.dark;
        ctx.fillRect(X, Y, px, px);
      }
    }

  // 출구 (본 적 있으면) — 피라미드는 빛나는 노란 매트, 고래는 위에서 빛이 쏟아지는 숨구멍
  const [ex, ez] = s.exit;
  if (s.seen[ez * s.w + ex]) {
    const g = 0.6 + 0.4 * Math.sin(v.t * 4);
    const cx = ex * px + px / 2;
    const cy = ez * px + px / 2;
    if (whale) {
      const r = px * (0.75 + 0.1 * g);
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
      glow.addColorStop(0.45, 'rgba(170, 235, 255, 0.75)');
      glow.addColorStop(1, 'rgba(170, 235, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      // 물방울이 숨구멍으로 솟는다
      for (let k = 0; k < 4; k++) {
        const u = (v.t * 0.9 + k / 4) % 1;
        ctx.fillStyle = `rgba(220, 248, 255, ${0.8 * (1 - u)})`;
        ctx.beginPath();
        ctx.arc(cx + Math.sin(k * 2.1 + v.t * 3) * px * 0.18, cy - u * px * 0.6, px * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = `rgba(255, 230, 120, ${0.55 + 0.3 * g})`;
      ctx.fillRect(ex * px + px * 0.12, ez * px + px * 0.12, px * 0.76, px * 0.76);
    }
    ctx.fillStyle = whale ? '#2c5c78' : '#7a5a20';
    ctx.font = `bold ${Math.max(9, px * (whale ? 0.26 : 0.32))}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(whale ? '숨구멍' : '출구', cx, ez * px + px * (whale ? 0.92 : 0.62));
  }
  // 냥코인 · 상자 (빛이 닿을 때만)
  for (const c of s.coins) if (!c.got && s.lit[c.cz * s.w + c.cx]) drawCoin(ctx, (c.cx + 0.5) * px, (c.cz + 0.5) * px + Math.sin(v.t * 5 + c.cx) * px * 0.05, px * 0.22);
  const ch0 = s.chest;
  if (!ch0.got && s.lit[ch0.cz * s.w + ch0.cx]) {
    ctx.fillStyle = whale ? `rgba(220, 240, 255, ${0.3 + 0.15 * Math.sin(v.t * 5)})` : `rgba(255, 220, 120, ${0.25 + 0.15 * Math.sin(v.t * 5)})`;
    ctx.beginPath();
    ctx.arc((ch0.cx + 0.5) * px, (ch0.cz + 0.5) * px, px * 0.5, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, C.chest, (ch0.cx + 0.5) * px, (ch0.cz + 0.5) * px, px * 0.8);
  }

  // 고양이 (몸 높이 = 1.3칸). 빛 둘레는 살짝 밝게 (고래 배 속은 고양이 둘레를 도는 플랑크톤)
  const X = (s.x / CELL) * px;
  const Z = (s.z / CELL) * px;
  const glow = ctx.createRadialGradient(X, Z, px * 0.3, X, Z, px * 2.6);
  glow.addColorStop(0, C.glow);
  glow.addColorStop(1, C.glow.replace(/[\d.]+\)$/, '0)'));
  ctx.fillStyle = glow;
  ctx.fillRect(X - px * 3, Z - px * 3, px * 6, px * 6);
  if (whale)
    for (let k = 0; k < 7; k++) {
      const a = v.t * (0.6 + k * 0.07) + k * 0.9;
      const r = px * (0.8 + 0.35 * Math.sin(v.t * 0.8 + k));
      ctx.fillStyle = `rgba(170, 240, 255, ${0.45 + 0.35 * Math.sin(v.t * 3 + k * 1.7)})`;
      ctx.beginPath();
      ctx.arc(X + Math.cos(a) * r, Z - px * 0.3 + Math.sin(a) * r * 0.6, px * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  ctx.fillStyle = C.shade;
  ctx.beginPath();
  ctx.ellipse(X, Z + px * 0.42, px * 0.36, px * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  const size = ((px * 1.3) / cat.bodyH) * cat.base;
  const row = s.moving ? CAT_ROW.run : CAT_ROW.idle;
  const col = Math.floor(s.animT * (s.moving ? CAT_FPS.run : CAT_FPS.idle)) % 6;
  drawFrame(ctx, cat, row, col, X, Z + px * 0.42, size, s.flip);
  drawEmote(ctx, X, Z - px * 0.9, px * 0.7);

  // HUD (CSS px)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const left = s.coins.length - s.got;
  drawPill(ctx, L, [
    `${whale ? '🐋 ' : ''}⏱ ${clock(s.t)} · 🪙 ${s.got}/${s.coins.length}${s.chest.got ? (whale ? ' · 🦪' : ' · 📦') : ''}${left === 0 ? ' · 다 모았다!' : ''}`,
    v.best !== null ? `최고 기록 ${clock(v.best)}` : `보너스 ${Math.max(5, Math.round(MAZE.bonusMax - s.t / 2))}냥 (빠를수록 커요)`,
  ]);
  drawLeave(ctx, L, v.hover, v.touch);
  if (s.phase === 'done')
    drawCard(
      ctx,
      L,
      whale ? '퉤! 고래 배 속 탈출!' : '탈출!',
      [
        [`${clock(s.t)}${v.best !== null && s.t <= v.best ? ' · 최고 기록!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.got}개 + 탈출 보너스 ${s.bonus}개`, '#c98a1c'],
        [s.chest.got ? `${whale ? '진주 조개' : '보물 상자'}: ${ITEMS[s.chest.item].name}` : whale ? '진주 조개는 못 찾았어요' : '보물 상자는 못 찾았어요', s.chest.got ? '#3f95dd' : '#9a7b62'],
        [v.best !== null ? `최고 기록 ${clock(Math.min(v.best, s.t))}` : '첫 탈출!', '#9a7b62'],
      ],
      v.hover,
      whale ? null : '다시 도전',
      whale ? '바다로' : '돌아가기',
    );
}
