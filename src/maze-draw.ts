// 미로 그리기 — 사암 벽 · 횃불 빛(보이는 칸만 밝게, 본 적 있는 칸은 어둡게, 나머지는 캄캄) · 냥코인 · 보물 상자 · 출구 · 고양이 · HUD.
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

const SAND = '#e6c58c';
const WALL = '#b8894f';
const WALL_TOP = '#d6ac70';
const WALL_SIDE = '#8d6537';

export function drawMaze(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: MazeState, cat: Sheet, v: MazeViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  const L = miniLayout(cw / dpr, ch / dpr);
  // 위 HUD(약 70px) 와 아래 안내줄을 비우고 가운데에
  const px = Math.floor(Math.min((cw - 24 * dpr) / s.w, (ch - (L.s.t + 72) * dpr - 48 * dpr) / s.h));
  const ox = Math.floor((cw - s.w * px) / 2);
  const oy = Math.floor((L.s.t + 72) * dpr + (ch - (L.s.t + 72) * dpr - 48 * dpr - s.h * px) / 2);
  Object.assign(mazeView, { px, ox, oy });

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#1b130b';
  ctx.fillRect(0, 0, cw, ch);
  ctx.setTransform(1, 0, 0, 1, ox, oy);

  // 칸: 길은 모래, 벽은 사암 블록 (윗면 밝게 · 아래 그늘). 빛: lit 1 · seen 0.45 · 나머지 안 그림
  for (let z = 0; z < s.h; z++)
    for (let x = 0; x < s.w; x++) {
      const i = z * s.w + x;
      if (!s.seen[i]) continue;
      const X = x * px;
      const Y = z * px;
      if (isSolid(s.grid, x, z)) {
        ctx.fillStyle = WALL;
        ctx.fillRect(X, Y, px, px);
        ctx.fillStyle = WALL_TOP;
        ctx.fillRect(X, Y, px, px * 0.3);
        ctx.fillStyle = WALL_SIDE;
        ctx.fillRect(X, Y + px * 0.82, px, px * 0.18);
      } else {
        ctx.fillStyle = SAND;
        ctx.fillRect(X, Y, px, px);
        if ((x * 7 + z * 13) % 5 === 0) {
          ctx.fillStyle = 'rgba(120,85,55,0.1)';
          ctx.fillRect(X + px * 0.3, Y + px * 0.55, px * 0.4, px * 0.1);
        }
      }
      if (!s.lit[i]) {
        ctx.fillStyle = 'rgba(27,19,11,0.6)';
        ctx.fillRect(X, Y, px, px);
      }
    }

  // 출구 — 빛나는 노란 매트 (본 적 있으면)
  const [ex, ez] = s.exit;
  if (s.seen[ez * s.w + ex]) {
    const g = 0.6 + 0.4 * Math.sin(v.t * 4);
    ctx.fillStyle = `rgba(255, 230, 120, ${0.55 + 0.3 * g})`;
    ctx.fillRect(ex * px + px * 0.12, ez * px + px * 0.12, px * 0.76, px * 0.76);
    ctx.fillStyle = '#7a5a20';
    ctx.font = `bold ${Math.max(9, px * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText('출구', ex * px + px / 2, ez * px + px * 0.62);
  }
  // 냥코인 · 상자 (횃불이 닿을 때만)
  for (const c of s.coins) if (!c.got && s.lit[c.cz * s.w + c.cx]) drawCoin(ctx, (c.cx + 0.5) * px, (c.cz + 0.5) * px + Math.sin(v.t * 5 + c.cx) * px * 0.05, px * 0.22);
  const ch0 = s.chest;
  if (!ch0.got && s.lit[ch0.cz * s.w + ch0.cx]) {
    ctx.fillStyle = `rgba(255, 220, 120, ${0.25 + 0.15 * Math.sin(v.t * 5)})`;
    ctx.beginPath();
    ctx.arc((ch0.cx + 0.5) * px, (ch0.cz + 0.5) * px, px * 0.5, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, 'curios_22', (ch0.cx + 0.5) * px, (ch0.cz + 0.5) * px, px * 0.8);
  }

  // 고양이 (몸 높이 = 1.3칸). 횃불 둘레는 살짝 밝게
  const X = (s.x / CELL) * px;
  const Z = (s.z / CELL) * px;
  const glow = ctx.createRadialGradient(X, Z, px * 0.3, X, Z, px * 2.6);
  glow.addColorStop(0, 'rgba(255, 200, 110, 0.22)');
  glow.addColorStop(1, 'rgba(255, 200, 110, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(X - px * 3, Z - px * 3, px * 6, px * 6);
  ctx.fillStyle = 'rgba(70, 50, 30, 0.3)';
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
  drawPill(ctx, L, [`⏱ ${clock(s.t)} · 🪙 ${s.got}/${s.coins.length}${s.chest.got ? ' · 📦' : ''}${left === 0 ? ' · 다 모았다!' : ''}`, v.best !== null ? `최고 기록 ${clock(v.best)}` : `보너스 ${Math.max(5, Math.round(MAZE.bonusMax - s.t / 2))}냥 (빠를수록 커요)`]);
  drawLeave(ctx, L, v.hover, v.touch);
  if (s.phase === 'done')
    drawCard(
      ctx,
      L,
      '탈출!',
      [
        [`${clock(s.t)}${v.best !== null && s.t <= v.best ? ' · 최고 기록!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.got}개 + 탈출 보너스 ${s.bonus}개`, '#c98a1c'],
        [s.chest.got ? `보물 상자: ${ITEMS[s.chest.item].name}` : '보물 상자는 못 찾았어요', s.chest.got ? '#3f95dd' : '#9a7b62'],
        [v.best !== null ? `최고 기록 ${clock(Math.min(v.best, s.t))}` : '첫 탈출!', '#9a7b62'],
      ],
      v.hover,
      '다시 도전',
    );
}
