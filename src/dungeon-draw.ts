// 던전 그리기 — 방 배경, 쥐·고양이·화살·이펙트, 데미지 숫자, HUD, 나가는 곳, 격자(G 키).
// 로직은 dungeon.ts. 여기는 상태를 읽어서 그리기만 한다 (표시용 배율 dispScale 만 갱신).
import fxUrl from './assets/fx-hit.webp';
import roomUrl from './assets/room-alley.webp';
import { CAT_FPS, CAT_ROW } from './cat.ts';
import { CELL } from './collide.ts';
import { PLAYER, POP_LIFE, POP_OUT, type Dungeon } from './dungeon.ts';
import { enemyFrame, type Enemy } from './enemy.ts';
import { drawFx } from './fx.ts';
import { BG_H, BG_W, exits, GRID_H, GRID_W, grid, toScreen } from './iso.ts';
import { drawFrame, type Sheet } from './sheet.ts';

const COLS = 6;

function image(url: string): [HTMLImageElement, Promise<void>] {
  const im = new Image();
  const ready = new Promise<void>((ok) => {
    im.onload = () => ok();
  });
  im.src = url;
  return [im, ready];
}
const [room, roomReady] = image(roomUrl);
const [fxSheet, fxReady] = image(fxUrl);
export const dungeonReady = Promise.all([roomReady, fxReady]);

/** 검증용 그리기 기록 (?trace). main.ts 가 넘긴다 */
export type TraceFn = (
  who: string,
  sheet: Sheet,
  row: number,
  col: number,
  sx: number,
  sy: number,
  size: number,
  flip: number,
  rowScale: number,
  extra: object,
) => void;

export type DungeonView = {
  /** 경과 시간(초) — 깜빡임용 */
  t: number;
  /** 이번 프레임 dt — 표시용 보간용 */
  dt: number;
  fps: number;
  /** G 키 격자 */
  grid: boolean;
  trace?: TraceFn;
};

/** cw, ch 는 캔버스 실제 픽셀 */
export function drawDungeon(ctx: CanvasRenderingContext2D, cw: number, ch: number, d: Dungeon, cat: Sheet, v: DungeonView) {
  const P = d.P;
  const scale = Math.min(cw / BG_W, ch / BG_H);
  const ox = (cw - BG_W * scale) / 2;
  const oy = (ch - BG_H * scale) / 2;
  /** 모션이 바뀔 때 크기가 툭 튀지 않게 목표값으로 수렴시킨다 (약 0.1초) */
  const ease = (cur: number, target: number) => cur + (target - cur) * (1 - Math.exp(-22 * v.dt));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const jx = d.shake > 0 ? (Math.random() - 0.5) * d.shake : 0;
  const jy = d.shake > 0 ? (Math.random() - 0.5) * d.shake * 0.7 : 0;
  ctx.setTransform(scale, 0, 0, scale, ox + jx, oy + jy);
  ctx.drawImage(room, 0, 0, BG_W, BG_H);
  drawExits(ctx, d, v.t);

  // 공격 예고 데칼 — 색을 하나로 고정해 가독성 확보 (GDD 8장)
  for (const e of d.enemies) {
    if (e.state !== 'windup') continue;
    const { sx, sy } = toScreen(e.x, e.z);
    const t = Math.min(1, e.t / e.def.windup);
    const r = (e.def.arrowSpeed > 0 ? 0.9 : e.def.range) * 70;
    ctx.fillStyle = `rgba(232, 80, 70, ${0.15 + 0.25 * t})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * t, r * t * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 화면 아래(앞)에 있는 것일수록 나중에 그린다
  type Item = { sy: number; go: () => void };
  const items: Item[] = [];

  for (const e of d.enemies) {
    const { sx, sy } = toScreen(e.x, e.z);
    const f = enemyFrame(e, COLS);
    items.push({
      sy,
      go: () => {
        const popping = e.state === 'pop';
        ctx.save();
        if (popping) {
          ctx.globalAlpha = Math.max(0, 1 - e.t / POP_OUT);
          ctx.translate(0, -e.t * 40);
        } else {
          blob(ctx, sx, sy, e.def.size * 0.24);
        }
        e.dispScale = ease(e.dispScale, e.sheet.rowScale[f.row] ?? 1);
        v.trace?.(e.kind, e.sheet, f.row, f.col, sx, sy, e.def.size, e.flip, e.dispScale, { state: e.state, alpha: ctx.globalAlpha });
        drawFrame(ctx, e.sheet, f.row, f.col, sx, sy, e.def.size, e.flip, e.dispScale);
        ctx.restore();
        if (!popping) enemyHpBar(ctx, e, sx, sy);
      },
    });
  }

  const ps = toScreen(P.x, P.z);
  const { dash, punch, size } = PLAYER;
  items.push({
    sy: ps.sy,
    go: () => {
      blob(ctx, ps.sx, ps.sy, size * 0.28);
      const row =
        P.punchT > 0
          ? CAT_ROW.punch
          : P.hurtT > 0
            ? CAT_ROW.hurt
            : P.dashT > 0
              ? CAT_ROW.roll
              : P.moving
                ? CAT_ROW.run
                : CAT_ROW.idle;
      let col: number;
      if (P.dashT > 0) col = Math.min(COLS - 1, Math.floor((1 - P.dashT / dash.time) * COLS));
      else if (P.punchT > 0) col = Math.min(COLS - 1, Math.floor((1 - P.punchT / punch.time) * COLS));
      else col = Math.floor(P.animT * (row === CAT_ROW.run ? CAT_FPS.run : CAT_FPS.idle)) % COLS;
      P.dispScale = ease(P.dispScale, cat.rowScale[row] ?? 1);
      v.trace?.('cat', cat, row, col, ps.sx, ps.sy, size, P.flip, P.dispScale, { hurtT: P.hurtT, alpha: ctx.globalAlpha });
      drawFrame(ctx, cat, row, col, ps.sx, ps.sy, size, P.flip, P.dispScale);
    },
  });

  items.sort((a, b) => a.sy - b.sy);
  for (const it of items) it.go();

  for (const a of d.arrows) {
    const { sx, sy } = toScreen(a.x, a.z);
    ctx.strokeStyle = '#6b4a2f';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(sx - a.dx * 14, sy - 24 - a.dz * 7);
    ctx.lineTo(sx + a.dx * 14, sy - 24 + a.dz * 7);
    ctx.stroke();
  }

  for (const f of d.fxs) {
    const t = toScreen(f.x, f.z);
    drawFx(ctx, fxSheet, f, t.sx, t.sy - f.size * 0.3);
  }

  drawPops(ctx, d);
  if (v.grid) drawGrid(ctx);
  drawHud(ctx, cw, ch, d, v.fps);
}

function blob(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number) {
  ctx.fillStyle = 'rgba(120, 85, 55, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 떠오르며 사라지는 데미지 숫자 */
function drawPops(ctx: CanvasRenderingContext2D, d: Dungeon) {
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = 'bold 34px system-ui, sans-serif';
  for (const q of d.pops) {
    const { sx, sy } = toScreen(q.x, q.z);
    const k = q.t / POP_LIFE;
    ctx.save();
    ctx.globalAlpha = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
    ctx.translate(sx + q.dx, sy - q.h * 0.72 - 54 * (1 - (1 - k) ** 2));
    // 튀어나오는 느낌으로 처음 잠깐 크게
    const pop = k < 0.18 ? 1 + (0.18 - k) * 2.6 : 1;
    ctx.scale(pop, pop);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(86,58,44,0.85)';
    ctx.strokeText(q.text, 0, 0);
    ctx.fillStyle = q.hurt ? '#ff9083' : '#ffd84a';
    ctx.fillText(q.text, 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

function enemyHpBar(ctx: CanvasRenderingContext2D, e: Enemy, sx: number, sy: number) {
  if (e.hp >= e.def.hp) return;
  const w = 62;
  const y = sy - e.def.size * 0.92;
  ctx.fillStyle = 'rgba(60,40,30,0.35)';
  ctx.fillRect(sx - w / 2, y, w, 7);
  ctx.fillStyle = '#e8705a';
  ctx.fillRect(sx - w / 2, y, (w * Math.max(0, e.hp)) / e.def.hp, 7);
}

function drawHud(ctx: CanvasRenderingContext2D, cw: number, ch: number, d: Dungeon, fps: number) {
  const P = d.P;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const s = Math.min(devicePixelRatio, 2);
  ctx.save();
  ctx.scale(s, s);
  const W = cw / s;
  const H = ch / s;

  ctx.fillStyle = 'rgba(255,250,240,0.82)';
  ctx.beginPath();
  ctx.roundRect(14, 14, 236, 78, 14);
  ctx.fill();

  ctx.fillStyle = '#e4d6c4';
  ctx.beginPath();
  ctx.roundRect(60, 25, 176, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#ef6b5e';
  ctx.beginPath();
  ctx.roundRect(60, 25, (176 * Math.max(0, P.hp)) / PLAYER.maxHp, 18, 9);
  ctx.fill();

  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#5b4a3f';
  ctx.fillText('체력', 22, 39);
  ctx.fillText('목숨', 22, 74);

  // 목숨은 발바닥 개수로 (GDD 9장)
  ctx.font = '20px system-ui, sans-serif';
  for (let i = 0; i < PLAYER.startLives; i++) {
    ctx.globalAlpha = i < P.lives ? 1 : 0.2;
    ctx.fillText('\u{1F43E}', 60 + i * 27, 78);
  }
  ctx.globalAlpha = 1;

  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#4a3b33';
  ctx.fillText(`${fps.toFixed(0)} fps`, W - 84, 28);
  ctx.fillText(`쥐 ${d.enemies.filter((e) => e.state !== 'pop').length}`, W - 84, 50);

  if (d.phase !== 'playing') {
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(70,52,42,0.85)';
    ctx.fillText(d.phase === 'cleared' ? '방 클리어!' : '낮잠…', W / 2, H / 2 - 8);
    ctx.font = '20px system-ui, sans-serif';
    ctx.fillText(d.phase === 'cleared' ? '노란 매트로 나가기' : 'R 키로 집에서 깨어나기', W / 2, H / 2 + 30);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

const corner = (tx: number, tz: number) => toScreen(tx * CELL, tz * CELL);

function tilePath(ctx: CanvasRenderingContext2D, tx: number, tz: number) {
  const a = corner(tx, tz);
  const b = corner(tx + 1, tz);
  const c = corner(tx + 1, tz + 1);
  const e = corner(tx, tz + 1);
  ctx.beginPath();
  ctx.moveTo(a.sx, a.sy);
  ctx.lineTo(b.sx, b.sy);
  ctx.lineTo(c.sx, c.sy);
  ctx.lineTo(e.sx, e.sy);
  ctx.closePath();
  return { a, c };
}

/** 나가는 곳(노란 매트) — 바닥을 은은하게 깜빡인다. 방을 비우면 더 밝게 */
function drawExits(ctx: CanvasRenderingContext2D, d: Dungeon, t: number) {
  if (!exits.length) return;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const strong = d.phase === 'cleared';
  let lx = 0;
  let ly = Infinity;
  for (const [tx, tz] of exits) {
    const { a, c } = tilePath(ctx, tx, tz);
    ctx.fillStyle = `rgba(255, 244, 170, ${(strong ? 0.3 : 0.12) + (strong ? 0.2 : 0.1) * pulse})`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + 0.35 * pulse})`;
    ctx.stroke();
    lx += (a.sx + c.sx) / 2 / exits.length;
    ly = Math.min(ly, a.sy);
  }
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(86, 58, 44, 0.8)';
  ctx.strokeText('밖으로', lx, ly - 8);
  ctx.fillStyle = '#fff6d8';
  ctx.fillText('밖으로', lx, ly - 8);
  ctx.textAlign = 'left';
}

/** G 키 — 바닥 격자와 막힌 칸 */
function drawGrid(ctx: CanvasRenderingContext2D) {
  ctx.lineWidth = 1;
  for (let tz = 0; tz < GRID_H; tz++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      tilePath(ctx, tx, tz);
      ctx.fillStyle = grid.solid[tz * GRID_W + tx] ? 'rgba(220,60,60,0.35)' : 'rgba(60,140,255,0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,120,0.5)';
      ctx.stroke();
    }
  }
}
