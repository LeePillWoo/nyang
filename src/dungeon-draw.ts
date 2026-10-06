// 던전 그리기 — 방 배경, 몬스터·고양이·화살·이펙트, 기술 효과(skills-draw.ts), 데미지 숫자, 감정, HUD(웨이브·경험치·기술), 레벨 업 카드, 나가는 곳, 격자(G 키).
// 로직은 dungeon.ts. 여기는 상태를 읽어서 그리기만 한다 (표시용 배율 dispScale 만 갱신).
import { image } from './assets.ts';
import { drawCoin, drawIcon, RARE } from './bag-draw.ts';
import { ITEMS } from './bag.ts';
import { CAT_FPS, CAT_ROW } from './cat.ts';
import { CELL } from './collide.ts';
import { maxHp, PLAYER, POP_LIFE, POP_OUT, TOAST_LIFE, type Dungeon } from './dungeon.ts';
import { enemyFrame, type Enemy } from './enemy.ts';
import { drawEmote } from './emote.ts';
import { drawFx, FX_SHEETS, type FxSheet } from './fx.ts';
import { ROOMS, type Room } from './iso.ts';
import { drawFrame, type Sheet } from './sheet.ts';
import { drawPunchArea, drawSkillAir, drawSkillFloor, drawSkillIcons, drawWaveHud, drawXpBar, skillItems } from './skills-draw.ts';
import { safe, ui } from './touch.ts';

const COLS = 6;
/** 몬스터가 쏜 것이 나는 높이 (방 그림 px) */
const ARROW_H = 34;

const FX_IMG = Object.fromEntries(Object.entries(FX_SHEETS).map(([k, p]) => [k, image(p).img])) as Record<FxSheet, HTMLImageElement>;
/** 이펙트 시트 (방 배경은 들어갈 때 roomReady 로 따로 불러온다) */
export const dungeonReady = Promise.all(Object.values(FX_SHEETS).map((p) => image(p).ready));
export const roomReady = (id: string) => image(ROOMS[id].image).ready;

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
  /** 터치 화면 — 낮잠 안내를 '화면을 눌러' 로 */
  touch?: boolean;
};

/** cw, ch 는 캔버스 실제 픽셀 */
export function drawDungeon(ctx: CanvasRenderingContext2D, cw: number, ch: number, d: Dungeon, cat: Sheet, v: DungeonView) {
  const P = d.P;
  const R = d.room;
  const toScreen = R.toScreen;
  const scale = Math.min(cw / R.W, ch / R.H);
  const ox = (cw - R.W * scale) / 2;
  const oy = (ch - R.H * scale) / 2;
  /** 모션이 바뀔 때 크기가 툭 튀지 않게 목표값으로 수렴시킨다 (약 0.1초) */
  const ease = (cur: number, target: number) => cur + (target - cur) * (1 - Math.exp(-22 * v.dt));

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  const jx = d.shake > 0 ? (Math.random() - 0.5) * d.shake : 0;
  const jy = d.shake > 0 ? (Math.random() - 0.5) * d.shake * 0.7 : 0;
  ctx.setTransform(scale, 0, 0, scale, ox + jx, oy + jy);
  ctx.drawImage(image(R.def.image).img, 0, 0, R.W, R.H);
  drawExits(ctx, d, v.t);
  drawSkillFloor(ctx, d, v.t);
  drawPunchArea(ctx, d, v.t);

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
    if (e.def.arrowSpeed > 0) {
      // 원거리: 쏠 쪽으로 조준선 + 고양이 발밑 과녁 (예고가 끝나면 그쪽으로 쏜다)
      const c = toScreen(P.x, P.z);
      ctx.save();
      ctx.globalAlpha = 0.3 + 0.6 * t;
      ctx.lineCap = 'round';
      ctx.setLineDash([16, 10]);
      ctx.lineDashOffset = -v.t * 80;
      ctx.beginPath();
      ctx.moveTo(sx, sy - ARROW_H);
      ctx.lineTo(c.sx, c.sy - ARROW_H);
      ctx.strokeStyle = 'rgba(70, 30, 25, 0.6)';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.setLineDash([]);
      const rr = 30 * (1.5 - 0.5 * t);
      ctx.beginPath();
      ctx.ellipse(c.sx, c.sy, rr, rr * 0.42, 0, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
    }
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
        v.trace?.(e.kind, e.sheet, f.row, f.col, sx, sy, e.def.size, e.flip, e.dispScale, { state: e.state, alpha: ctx.globalAlpha, uid: e.uid });
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
      drawEmote(ctx, ps.sx, ps.sy - size * 0.7, size * 0.36);
    },
  });

  // 바닥에 떨어진 냥코인·아이템 — 튀어 오르고, 멈추면 살짝 둥실. 귀한 건 빛이 돈다
  for (const l of d.loot) {
    const { sx, sy } = toScreen(l.x, l.z);
    items.push({
      sy,
      go: () => {
        const bob = l.h > 0 ? 0 : Math.sin(v.t * 3 + l.x) * 3;
        const y = sy - 20 - l.h * 70 + bob;
        blob(ctx, sx, sy, l.id === 'coin' ? 20 : 20);
        if (l.id === 'coin') {
          // 냥코인: 빛 무리 위에서 빙글빙글 · 반짝 — 많이 떨어졌으면 여러 닢이 겹쳐 쌓인다
          const R = 26;
          const glow = ctx.createRadialGradient(sx, y, 0, sx, y, R * 2);
          glow.addColorStop(0, `rgba(255, 226, 120, ${0.45 + 0.15 * Math.sin(v.t * 5 + l.x)})`);
          glow.addColorStop(1, 'rgba(255, 226, 120, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, y, R * 2, 0, Math.PI * 2);
          ctx.fill();
          const extra = l.n >= 12 ? 2 : l.n >= 5 ? 1 : 0;
          for (let i = extra; i >= 0; i--) {
            const spin = 0.45 + 0.55 * Math.abs(Math.cos(v.t * 2.6 + l.x * 3 + i * 1.3));
            drawCoin(ctx, sx + (i % 2 ? 1 : -1) * i * R * 0.55, y + i * R * 0.3, R, i ? undefined : v.t, spin);
          }
          return;
        }
        const rare = ITEMS[l.id]?.rare ?? 1;
        if (rare >= 3) {
          ctx.fillStyle = RARE[rare].color + '55';
          ctx.beginPath();
          ctx.arc(sx, y, 34 + Math.sin(v.t * 5) * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        drawIcon(ctx, l.id, sx, y - 8, 58);
      },
    });
  }

  for (const s of skillItems(d, v.t)) items.push({ sy: s.sy, go: () => s.go(ctx) });
  items.sort((a, b) => a.sy - b.sy);
  for (const it of items) it.go();

  // 몬스터가 쏜 것 (원거리): 땅 그림자 · 지나온 꼬리 · 빛나는 화살 — 작고 가늘면 날아오는 게 안 보인다
  for (const a of d.arrows) {
    const p = toScreen(a.x, a.z);
    const q = toScreen(a.x + a.dx * 0.5, a.z + a.dz * 0.5);
    const ang = Math.atan2(q.sy - p.sy, q.sx - p.sx);
    ctx.fillStyle = 'rgba(70, 40, 30, 0.28)';
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, 18, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 4; i >= 1; i--) {
      const b = toScreen(a.x - a.dx * 0.3 * i, a.z - a.dz * 0.3 * i);
      ctx.fillStyle = `rgba(255, 120, 70, ${0.5 - i * 0.1})`;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy - ARROW_H, 14 - i * 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.save();
    ctx.translate(p.sx, p.sy - ARROW_H);
    ctx.rotate(ang);
    ctx.scale(1.5, 1.5);
    ctx.fillStyle = 'rgba(255, 100, 60, 0.45)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 32, 14, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-24, 0);
    ctx.lineTo(14, 0);
    ctx.strokeStyle = '#4a2a20';
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = '#ffb07a';
    ctx.lineWidth = 4.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(28, 0);
    ctx.lineTo(10, -10);
    ctx.lineTo(10, 10);
    ctx.closePath();
    ctx.fillStyle = '#fff3d6';
    ctx.fill();
    ctx.strokeStyle = '#4a2a20';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  for (const f of d.fxs) {
    const t = toScreen(f.x, f.z);
    drawFx(ctx, FX_IMG, f, t.sx, t.sy - f.size * 0.3);
  }

  drawSkillAir(ctx, d, v.t);
  drawPops(ctx, d);
  if (v.grid) drawGrid(ctx, R);
  drawHud(ctx, cw, ch, d, v);
}

function blob(ctx: CanvasRenderingContext2D, sx: number, sy: number, r: number) {
  ctx.fillStyle = 'rgba(120, 85, 55, 0.25)';
  ctx.beginPath();
  ctx.ellipse(sx, sy, r, r * 0.36, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** 떠오르며 사라지는 데미지 숫자 — 냥펀치 노랑 · 기술 연노랑(작게) · 치명타 주황(크게, !) · 계속 피해 연두(작게) · 맞은 고양이 분홍 */
const POP_STYLE = {
  punch: { px: 34, color: '#ffd84a' },
  skill: { px: 26, color: '#fff2a8' },
  crit: { px: 44, color: '#ff8a3d' },
  dot: { px: 22, color: '#b8ef8a' },
};
function drawPops(ctx: CanvasRenderingContext2D, d: Dungeon) {
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const q of d.pops) {
    const st = POP_STYLE[q.style ?? 'punch'];
    ctx.font = `bold ${st.px}px system-ui, sans-serif`;
    const { sx, sy } = d.room.toScreen(q.x, q.z);
    const k = q.t / POP_LIFE;
    ctx.save();
    ctx.globalAlpha = k < 0.65 ? 1 : Math.max(0, 1 - (k - 0.65) / 0.35);
    ctx.translate(sx + q.dx, sy - q.h * 0.72 - 54 * (1 - (1 - k) ** 2));
    // 튀어나오는 느낌으로 처음 잠깐 크게
    const pop = k < 0.18 ? 1 + (0.18 - k) * 2.6 : 1;
    ctx.scale(pop, pop);
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(86,58,44,0.85)';
    const text = q.style === 'crit' ? q.text + '!' : q.text;
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = q.hurt ? '#ff9083' : st.color;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

function enemyHpBar(ctx: CanvasRenderingContext2D, e: Enemy, sx: number, sy: number) {
  if (e.hp >= e.def.hp && !e.elite) return;
  const w = e.elite ? 120 : 62;
  const y = sy - e.def.size * 0.92;
  ctx.fillStyle = 'rgba(60,40,30,0.35)';
  ctx.fillRect(sx - w / 2, y, w, 7);
  ctx.fillStyle = e.elite ? '#f0a83a' : '#e8705a';
  ctx.fillRect(sx - w / 2, y, (w * Math.max(0, e.hp)) / e.def.hp, 7);
}

/** CSS px 기준. 휴대폰에선 HUD 배율(ui)만큼 작게, 노치는 비켜서 */
function drawHud(ctx: CanvasRenderingContext2D, cw: number, ch: number, d: Dungeon, v: DungeonView) {
  const P = d.P;
  const fps = v.fps;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const s = Math.min(devicePixelRatio, 2);
  const sf = safe();
  const k = ui(cw / s, ch / s);
  ctx.save();
  ctx.scale(s, s);
  ctx.translate(sf.l, sf.t);
  ctx.scale(k, k);
  const W = (cw / s - sf.l - sf.r) / k;
  const H = (ch / s - sf.t - sf.b) / k;

  ctx.fillStyle = 'rgba(255,250,240,0.82)';
  ctx.beginPath();
  ctx.roundRect(14, 14, 236, d.classic ? 78 : 100, 14);
  ctx.fill();

  ctx.fillStyle = '#e4d6c4';
  ctx.beginPath();
  ctx.roundRect(60, 25, 176, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#ef6b5e';
  ctx.beginPath();
  ctx.roundRect(60, 25, (176 * Math.max(0, P.hp)) / maxHp(d), 18, 9);
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
  if (!d.classic) drawXpBar(ctx, d, v.t);

  // 먹은 것 효과 (가방 버튼 밑): 아이콘 + 남은 초
  let y = d.classic ? 146 : 172;
  if (d.bag.buffs.length) {
    d.bag.buffs.forEach((f, i) => {
      const x = 14 + i * 50;
      ctx.fillStyle = 'rgba(255,250,240,0.85)';
      ctx.beginPath();
      ctx.roundRect(x, y, 44, 44, 10);
      ctx.fill();
      drawIcon(ctx, f.id, x + 22, y + 18, 28);
      ctx.fillStyle = '#5b4a3f';
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.ceil(f.left)}초`, x + 22, y + 41);
      ctx.textAlign = 'left';
    });
    y += 52;
  }
  // 주운 것 알림 — 들어올 땐 옆에서 미끄러져 오고, 끝날 때 흐려진다
  for (const q of d.toasts) {
    const a = Math.min(1, q.t / 0.15, (TOAST_LIFE - q.t) / 0.5);
    const slide = (1 - Math.min(1, q.t / 0.2)) * -30;
    const full = q.id === 'full';
    const text = full ? '가방이 가득 찼어요' : `${q.id === 'coin' ? '냥코인' : ITEMS[q.id].name} +${q.n}`;
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = 'bold 15px system-ui, sans-serif';
    const tw = ctx.measureText(text).width + (full ? 24 : 54);
    ctx.fillStyle = full ? 'rgba(239,107,94,0.92)' : 'rgba(255,250,240,0.9)';
    ctx.beginPath();
    ctx.roundRect(14 + slide, y, tw, 34, 17);
    ctx.fill();
    if (!full) {
      if (q.id === 'coin') drawCoin(ctx, 34 + slide, y + 17, 10);
      else drawIcon(ctx, q.id, 34 + slide, y + 17, 26);
    }
    ctx.fillStyle = full ? '#fff' : '#5b4a3f';
    ctx.fillText(text, (full ? 26 : 52) + slide, y + 23);
    y += 40;
  }
  ctx.globalAlpha = 1;

  ctx.font = '15px system-ui, sans-serif';
  ctx.fillStyle = '#4a3b33';
  ctx.fillText(`${fps.toFixed(0)} fps`, W - 84, 28);
  if (d.classic) ctx.fillText(`적 ${d.enemies.filter((e) => e.state !== 'pop').length}`, W - 84, 50);
  drawSkillIcons(ctx, d, W - 8, 40, v.t);
  // 방 이름 — 가운데, 좁은 화면(세로)에선 체력 판(14..250) 오른쪽으로 비킨다
  ctx.textAlign = 'center';
  ctx.font = 'bold 15px system-ui, sans-serif';
  const nw = ctx.measureText(d.room.def.name).width + 28;
  const nx = Math.max(W / 2 - nw / 2, 260);
  ctx.fillStyle = 'rgba(255,250,240,0.85)';
  ctx.beginPath();
  ctx.roundRect(nx, 14, nw, 30, 15);
  ctx.fill();
  ctx.fillStyle = '#5b4a3f';
  ctx.fillText(d.room.def.name, nx + nw / 2, 34);
  ctx.textAlign = 'left';
  drawWaveHud(ctx, d, W, H, nx, nw);

  if (d.phase !== 'playing') {
    ctx.textAlign = 'center';
    ctx.font = 'bold 46px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(70,52,42,0.85)';
    if (!d.result) ctx.fillText(d.phase === 'cleared' ? '방 클리어!' : '낮잠…', W / 2, H / 2 - 8);
    if (d.classic && d.phase === 'cleared') {
      ctx.font = '20px system-ui, sans-serif';
      ctx.fillText('노란 매트로 나가기', W / 2, H / 2 + 30);
    }
    ctx.textAlign = 'left';
  }
  ctx.restore();
}

function tilePath(ctx: CanvasRenderingContext2D, r: Room, tx: number, tz: number) {
  const corner = (x: number, z: number) => r.toScreen(x * CELL, z * CELL);
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
  const exits = d.room.exits;
  if (!exits.length) return;
  const pulse = 0.5 + 0.5 * Math.sin(t * 3);
  const strong = d.phase === 'cleared';
  // 붙어 있는 칸끼리 한 출구 — 출구마다 "밖으로" 하나 (출구가 둘인 방)
  const groups: { x: number; y: number; n: number; tiles: [number, number][] }[] = [];
  for (const [tx, tz] of exits) {
    const { a, c } = tilePath(ctx, d.room, tx, tz);
    ctx.fillStyle = `rgba(255, 244, 170, ${(strong ? 0.3 : 0.12) + (strong ? 0.2 : 0.1) * pulse})`;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + 0.35 * pulse})`;
    ctx.stroke();
    let g = groups.find((g) => g.tiles.some(([x, z]) => Math.abs(x - tx) + Math.abs(z - tz) === 1));
    if (!g) groups.push((g = { x: 0, y: Infinity, n: 0, tiles: [] }));
    g.tiles.push([tx, tz]);
    g.x += (a.sx + c.sx) / 2;
    g.n++;
    g.y = Math.min(g.y, a.sy);
  }
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  for (const g of groups) {
    ctx.strokeStyle = 'rgba(86, 58, 44, 0.8)';
    ctx.strokeText('밖으로', g.x / g.n, g.y - 8);
    ctx.fillStyle = '#fff6d8';
    ctx.fillText('밖으로', g.x / g.n, g.y - 8);
  }
  ctx.textAlign = 'left';
}

/** G 키 — 바닥 격자와 막힌 칸 */
function drawGrid(ctx: CanvasRenderingContext2D, r: Room) {
  ctx.lineWidth = 1;
  for (let tz = 0; tz < r.gridH; tz++) {
    for (let tx = 0; tx < r.gridW; tx++) {
      tilePath(ctx, r, tx, tz);
      ctx.fillStyle = r.grid.solid[tz * r.gridW + tx] ? 'rgba(220,60,60,0.35)' : 'rgba(60,140,255,0.1)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20,60,120,0.5)';
      ctx.stroke();
    }
  }
}
