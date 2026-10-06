// 샌드보드 그리기 — art/sandboarding 시트(배경 3장 · 장애물 · 장식 · 치즈 주행/동작 · 효과)로. 치즈는 화면 아래쪽에서 위(앞)를 보고 달리고,
// 비탈은 원근으로 그린다: 앞(화면 위)으로 갈수록 좁아지는 사다리꼴 — 멀리 있는 건 작고, 가까운 건 크다.
//   배율 sc(dd) = 1 / (1 + dd / D), 화면 y = y0 − ppm·D·ln(1 + dd / D)  (dd = 치즈보다 앞쪽 거리 m, D = 원근 거리 — 화면 맨 위가 FAR 배율이 되게 잡는다)
//   배경은 세 장을 이어 붙인 띠를 화면 4px 높이의 가로 조각으로 잘라 조각마다 그 거리의 배율로 그린다 (양옆은 좌우를 뒤집은 띠로 채운다).
//   조각이 두꺼우면 가장자리의 비스듬한 선이 계단이 된다 — 화면 가장자리에서 조각 사이 어긋남이 2px 를 넘지 않게 얇게.
// 양옆은 밧줄 울타리 · 깃발 · 장식, 출발점은 천막·보드 거치대, 결승선은 체크무늬 + 스핑크스·피라미드.
// 좌표 · 피벗은 src/data/sandboard-atlas.json (tools/assets.mjs 가 art/sandboarding/sprites.json 에서 만든다). 로직은 sandboard.ts.
import atlas from './data/sandboard-atlas.json' with { type: 'json' };
import { drawEmote } from './emote.ts';
import { clock, drawCard, drawLeave, miniLayout, type MiniButton } from './mini-draw.ts';
import { FX_TIME, OBS, SAND, type SandState } from './sandboard.ts';

type Frame = [string, number, number, number, number, number, number];
const FR = atlas.frames as unknown as Record<string, Frame>;
const BG = atlas.bg;
/** 불러올 그림 (배경 조각 + 시트) */
export const SAND_IMAGES = [...new Set([...BG.tiles, ...Object.values(FR).map((f) => f[0])])];
export type SandArt = Record<string, CanvasImageSource>;
export type SandViewOpts = { t: number; touch: boolean; hover: MiniButton; best: number | null };
/** 캔버스 픽셀 기준: 주행 폭 가운데 x · 치즈 자리의 반폭 · 치즈 y · 치즈 자리의 m 당 px · 원근 거리 D (검증 도구용 — 앞이 화면 위) */
export const sandView = { cx: 0, half: 1, y0: 0, ppm: 1, D: 1 };

/** 배경 px 로 1m · 그림 배율 (배경 px / 시트 px) */
const M = 16;
const OB_K = 0.46;
const RIDE_K = 0.6;
const ACT_K = 0.48;
const DECO_K = 0.4;
const FX_K = 0.55;
/** 화면 맨 위(가장 먼 곳)의 배율 · 배경 조각 높이(화면 px) */
const FAR = 0.55;
const STRIP_PX = 4;
const PLAY_C = (BG.playX[0] + BG.playX[1]) / 2;
const PLAY_HALF = (BG.playX[1] - BG.playX[0]) / 2;

/** 시트의 칸 하나를 피벗이 (x, y) 에 오게 */
function spr(ctx: CanvasRenderingContext2D, art: SandArt, id: string, x: number, y: number, k: number, flipX = 1, flipY = 1) {
  const f = FR[id];
  if (!f) return;
  const [sheet, fx, fy, fw, fh, px, py] = f;
  ctx.save();
  ctx.translate(x, y);
  if (flipX < 0 || flipY < 0) ctx.scale(flipX, flipY);
  ctx.drawImage(art[sheet], fx, fy, fw, fh, -px * k, -py * k, fw * k, fh * k);
  ctx.restore();
}
/** 치즈 얼굴을 (x, y) 가운데에 지름 2r 로 (land_01 칸에서 머리는 피벗 기준 (−30, −140) 쯤, 폭 150px) */
function face(ctx: CanvasRenderingContext2D, art: SandArt, x: number, y: number, r: number) {
  const q = (2 * r) / 150;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#ffe2b8';
  ctx.fill();
  ctx.clip();
  spr(ctx, art, 'land_01', x - 30 * q, y + 140 * q, q);
  ctx.restore();
}
const two = (n: number) => `_0${n}`;
const hash = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const DECOS = ['cactus_tall', 'cactus_cluster', 'flower_cactus', 'dry_shrub', 'palm_small', 'palm_large', 'rock_low', 'rock_stack', 'rock_arch', 'ruined_wall', 'pillar_short', 'pillar_cap', 'lantern_post', 'jars', 'bone_skeleton', 'arrow_sign'];
/** 바닥에 깔리는 것 — 고양이·장애물보다 먼저 */
const FLAT = new Set(['sand_pit', 'sand_bump', 'jump_ramp', 'boost_pad']);

/** 배경 띠: [뒤집음][원본][뒤집음] × 세 장 세로 — 한 번 만들어 둔다 */
let strip: { art: SandArt; canvas: HTMLCanvasElement } | null = null;
function bgStrip(art: SandArt) {
  if (strip?.art === art) return strip.canvas;
  const c = document.createElement('canvas');
  c.width = BG.w * 3;
  c.height = BG.h * BG.tiles.length;
  const g = c.getContext('2d')!;
  BG.tiles.forEach((t, i) => {
    g.drawImage(art[t], BG.w, i * BG.h, BG.w, BG.h);
    g.save();
    g.scale(-1, 1);
    g.drawImage(art[t], -BG.w, i * BG.h, BG.w, BG.h); // 왼쪽 (x: 0..W 가 거울)
    g.drawImage(art[t], -BG.w * 3, i * BG.h, BG.w, BG.h); // 오른쪽
    g.restore();
  });
  strip = { art, canvas: c };
  return c;
}

export function drawSandboard(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: SandState, art: SandArt, v: SandViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  // 치즈 자리의 배율(배경 px → 화면 px): 주행 폭이 화면의 2/3 쯤. 세로 화면은 주행 폭이 화면 안에 들어오게
  const k = Math.max(cw / 870, Math.min(ch / 1300, cw / 640));
  const cx = cw / 2;
  const half = PLAY_HALF * k;
  const y0 = ch * 0.78;
  const ppm = M * k;
  const D = Math.min(160, Math.max(25, y0 / (ppm * Math.log(1 / FAR))));
  Object.assign(sandView, { cx, half, y0, ppm, D });
  const sc = (d: number) => 1 / (1 + (d - s.d) / D);
  const Y = (d: number) => y0 - ppm * D * Math.log(1 + (d - s.d) / D);
  const X = (x: number, d: number) => cx + x * half * sc(d);
  const dAt = (y: number) => s.d + D * (Math.exp((y0 - y) / (ppm * D)) - 1);
  const dMin = dAt(ch) - 2;
  const dMax = dAt(0) + 2;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 배경: 화면 아래(가까운 곳)부터 STRIP_PX 씩 올라가며, 그 줄에 해당하는 띠의 가로 조각을 그 거리의 배율로 (조각 경계는 살짝 겹친다)
  const bg = bgStrip(art);
  const stripH = bg.height;
  const slice = (rowA: number, rowB: number, ya: number, yb: number, q: number) =>
    ctx.drawImage(bg, 0, rowA, bg.width, rowB - rowA, cx - (BG.w + PLAY_C) * q, ya, bg.width * q, yb - ya + 0.6);
  for (let y = ch; y > 0; y -= STRIP_PX) {
    const ya = Math.max(0, y - STRIP_PX);
    const da = dAt(y);
    const db = dAt(ya);
    const q = sc((da + db) / 2) * k;
    const rowA = (((da * M) % stripH) + stripH) % stripH;
    const rowB = rowA + (db - da) * M;
    if (rowB <= stripH) slice(rowA, rowB, ya, y, q);
    else {
      // 띠가 한 바퀴 도는 줄: 둘로 나눠 그린다
      const yw = Y(da + (stripH - rowA) / M);
      slice(rowA, stripH, yw, y, q);
      slice(0, rowB - stripH, ya, yw, q);
    }
  }

  // 그릴 것 모으기 (화면 아래쪽 = 가까운 것이 위에)
  const items: { y: number; draw: () => void }[] = [];
  const at = (d: number, draw: () => void) => items.push({ y: Y(d), draw });
  // 양옆 밧줄 울타리: 7m 마다 말뚝, 세 번째마다 깃발. 말뚝 사이에 밧줄 (원근이라 앞으로 갈수록 모인다)
  const POST = 7;
  const POST_H = 70;
  for (const side of [-1, 1]) {
    for (let i = Math.max(0, Math.floor(dMin / POST)); i * POST < Math.min(dMax, SAND.length + 4); i++) {
      const d = i * POST;
      const flag = i % 3 === 0;
      at(d, () => {
        const q = sc(d);
        const px = X(side * 1.07, d);
        const y = Y(d);
        if (d + POST < SAND.length + 4) {
          const d2 = d + POST;
          const q2 = sc(d2);
          const px2 = X(side * 1.07, d2);
          const y2 = Y(d2) - POST_H * k * q2;
          const top = y - POST_H * k * q;
          ctx.strokeStyle = 'rgba(140, 98, 52, 0.95)';
          ctx.lineWidth = 4 * k * q;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.quadraticCurveTo((px + px2) / 2 + side * 8 * k * q, (top + y2) / 2, px2, y2);
          ctx.stroke();
        }
        spr(ctx, art, flag ? (i % 2 ? 'flag_teal' : 'flag_red') : 'rope_post', px, y, DECO_K * k * q * (flag ? 0.8 : 0.7), flag && side > 0 ? -1 : 1);
      });
    }
  }
  // 바깥 장식: 11m 마다 번갈아
  for (let i = Math.max(1, Math.floor(dMin / 11)); i * 11 < Math.min(dMax, SAND.length - 10); i++) {
    const side = i % 2 ? -1 : 1;
    const id = DECOS[Math.floor(hash(i) * DECOS.length)];
    const x = side * (1.24 + hash(i + 50) * 0.36);
    const d = i * 11 + hash(i + 9) * 4;
    at(d, () => spr(ctx, art, id, X(x, d), Y(d), DECO_K * k * sc(d) * 0.9, side > 0 && id !== 'arrow_sign' ? -1 : 1));
  }
  // 출발: 천막 · 보드 거치대 · 항아리 / 결승: 스핑크스 · 피라미드 · 등불
  const deco = (id: string, x: number, d: number, m = 1, flip = 1) => at(d, () => spr(ctx, art, id, X(x, d), Y(d), DECO_K * k * sc(d) * m, flip));
  deco('tent', -1.4, 6);
  deco('board_rack', 1.38, 2);
  deco('jars', -1.25, -3);
  const END = SAND.length;
  deco('cat_sphinx', -1.45, END + 10, 1.1);
  deco('small_pyramid', 1.5, END + 14, 1.2);
  for (const side of [-1, 1]) deco('lantern_post', side * 1.0, END, 0.8, side > 0 ? -1 : 1);

  // 결승선 (바닥, 사다리꼴)
  if (END > dMin && END < dMax) {
    const n = 16;
    for (let j = 0; j < 2; j++) {
      const d1 = END + j * 0.6;
      const d2 = END + (j + 1) * 0.6;
      for (let i = 0; i < n; i++) {
        const xa = -1.05 + (2.1 * i) / n;
        const xb = xa + 2.1 / n;
        ctx.fillStyle = (i + j) % 2 ? 'rgba(60,45,35,0.85)' : 'rgba(255,250,240,0.9)';
        ctx.beginPath();
        ctx.moveTo(X(xa, d1), Y(d1));
        ctx.lineTo(X(xb, d1), Y(d1));
        ctx.lineTo(X(xb, d2), Y(d2));
        ctx.lineTo(X(xa, d2), Y(d2));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // 바닥 물건 (구덩이·둔덕·점프대·가속 발판)
  for (const ob of s.obs) {
    if (!FLAT.has(ob.kind) || ob.d < dMin || ob.d > dMax) continue;
    spr(ctx, art, ob.kind, X(ob.x, ob.d), Y(ob.d), OB_K * k * sc(ob.d) * OBS[ob.kind].k);
  }
  // 서 있는 물건 · 줍는 것
  for (const ob of s.obs) {
    if (FLAT.has(ob.kind) || ob.got || ob.d < dMin || ob.d > dMax) continue;
    const o = OBS[ob.kind];
    const pickup = o.role !== 'hit' && o.role !== 'tall';
    at(ob.d, () => {
      const q = k * sc(ob.d);
      const x = X(ob.x, ob.d);
      const y = Y(ob.d);
      if (pickup) {
        // 줍는 것: 그림자 위에서 둥실
        ctx.fillStyle = 'rgba(90,60,30,0.22)';
        ctx.beginPath();
        ctx.ellipse(x, y, 32 * q * o.k, 10 * q * o.k, 0, 0, Math.PI * 2);
        ctx.fill();
        spr(ctx, art, ob.kind, x, y - (8 + Math.sin(v.t * 4 + ob.d) * 4) * q, OB_K * q * o.k);
      } else {
        ctx.globalAlpha = ob.hit ? 0.55 : 1;
        spr(ctx, art, ob.kind, x, y, OB_K * q * o.k);
        ctx.globalAlpha = 1;
      }
    });
  }

  // 치즈
  at(s.d, () => drawCat(ctx, art, s, X(s.x, s.d), y0, k, v.t));
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // 짧은 효과 · 떠오르는 글자
  for (const f of s.fx) spr(ctx, art, f.id + two(Math.min(6, Math.floor((f.t / FX_TIME) * 6) + 1)), X(f.x, f.d), Y(f.d), FX_K * k * sc(f.d));
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const p of s.pops) {
    const q = k * sc(p.d);
    const a = Math.min(1, (0.9 - p.t) / 0.3);
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = `bold ${Math.round(26 * q)}px system-ui, sans-serif`;
    ctx.lineWidth = 6 * q;
    ctx.strokeStyle = 'rgba(110, 70, 30, 0.9)';
    const y = Y(p.d) - (50 + p.t * 70) * q;
    ctx.strokeText(p.text, X(p.x, p.d) + 30 * q, y);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(p.text, X(p.x, p.d) + 30 * q, y);
  }
  ctx.globalAlpha = 1;
  // 속도선 (부스트 · 빠를 때) — 주행 폭 바깥, 원근을 따라 모인다
  if (s.phase === 'play' && (s.boost > 0 || s.v > SAND.vMax + 0.5)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3 * k;
    for (let i = 0; i < 8; i++) {
      const x = (i < 4 ? -1 : 1) * (1.0 + (i % 4) * 0.06);
      const yb = ((v.t * 1400 * k + i * 211) % (ch + 160)) - 80;
      const ya = yb - 90 * k;
      ctx.beginPath();
      ctx.moveTo(X(x, dAt(yb)), yb);
      ctx.lineTo(X(x, dAt(ya)), ya);
      ctx.stroke();
    }
  }

  drawHud(ctx, cw, ch, dpr, s, art, v);
}

/** 치즈: 땅에선 뒷모습 주행(기울면 드리프트 컷, 가끔 고개 돌림) · 공중은 점프 · 내려오면 착지 · 부딪히면 넘어졌다 일어남 */
function drawCat(ctx: CanvasRenderingContext2D, art: SandArt, s: SandState, x: number, y: number, k: number, t: number) {
  const p = s.air > 0 ? 1 - s.air / s.airMax : 0;
  const height = s.airMax >= SAND.rampJump ? 95 : s.airMax <= SAND.bump ? 38 : 60;
  const lift = s.air > 0 ? Math.sin(Math.PI * p) * height * k : 0;
  // 그림자
  ctx.fillStyle = 'rgba(90,60,30,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y - 4 * k, (34 - lift / k / 8) * k, (11 - lift / k / 20) * k, 0, 0, Math.PI * 2);
  ctx.fill();
  const ground = s.air <= 0 && s.dizzy <= 0 && s.phase === 'play';
  // 보드 뒤 모래 꼬리(아래로) · 기울어 미끄러지면 옆으로 튀는 모래 (기울수록 진하게)
  if (ground) {
    ctx.globalAlpha = 0.9;
    spr(ctx, art, 'sand_trail' + two((Math.floor(s.t * 8) % 6) + 1), x, y - 4 * k, FX_K * k, 1, -1);
    if (s.steer !== 0) {
      ctx.globalAlpha = Math.min(1, Math.abs(s.lean) * 1.3);
      spr(ctx, art, 'carve_spray' + two((Math.floor(s.t * 8) % 6) + 1), x, y + 6 * k, FX_K * k * (0.6 + Math.abs(s.lean) * 0.5), -s.steer);
    }
    ctx.globalAlpha = 1;
  }
  let id: string;
  let q = ACT_K * k;
  let flip = s.flip;
  if (s.dizzy > 0 || (s.phase === 'done' && s.fell)) {
    const f = s.phase === 'done' ? 0 : Math.min(11, Math.floor((1 - s.dizzy / SAND.dizzy) * 12));
    id = s.phase === 'done' ? 'fall_06' : f < 6 ? 'fall' + two(f + 1) : 'get_up' + two(f - 5);
  } else if (s.air > 0) id = 'jump' + two(Math.min(6, Math.floor(p * 6) + 1));
  else if (s.landT < 0.5) id = 'land' + two(Math.min(6, Math.floor(s.landT * 12) + 1));
  else {
    q = RIDE_K * k;
    flip = 1;
    const ph = s.t % 6;
    const c = Math.floor(s.t / 6);
    // 기울기가 셀수록 드리프트 컷이 깊어진다 (1~6)
    if (s.steer !== 0) id = (s.steer < 0 ? 'drift_left' : 'drift_right') + two(Math.min(6, Math.floor(Math.abs(s.lean) * 6) + 1));
    else if (s.phase === 'play' && c % 3 !== 0 && ph < 0.75) id = (c % 2 ? 'look_left' : 'look_right') + two(Math.floor(ph * 8) + 1);
    else id = 'ride' + two((Math.floor(s.t * 8) % 6) + 1);
  }
  spr(ctx, art, id, x, y - lift, q, flip);
  // 방패: 둥근 막 · 자석: 머리 위 자석
  if (s.shield > 0) {
    const blink = s.shield < 2 ? 0.5 + 0.5 * Math.sin(t * 20) : 1;
    ctx.globalAlpha = 0.16 * blink;
    ctx.fillStyle = '#7cc8ff';
    ctx.strokeStyle = '#e8f6ff';
    ctx.lineWidth = 3 * k;
    ctx.beginPath();
    ctx.ellipse(x, y - lift - 55 * k, 52 * k, 66 * k, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55 * blink;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (s.magnet > 0) {
    ctx.globalAlpha = s.magnet < 2 ? 0.5 + 0.5 * Math.sin(t * 20) : 1;
    spr(ctx, art, 'magnet_pickup', x + Math.sin(t * 6) * 4 * k, y - lift - 112 * k, OB_K * k * 0.3);
    ctx.globalAlpha = 1;
  }
  drawEmote(ctx, x, y - lift - 140 * k, 50 * k);
}

/** HUD (CSS px): 왼쪽 위 얼굴 + 하트 + 지금 켜진 보상 · 가운데 이름판 + 시간 · 오른쪽 위 냥코인 + 돌아가기 · 오른쪽 세로 진행 막대 · 결과 */
function drawHud(ctx: CanvasRenderingContext2D, cw: number, ch: number, dpr: number, s: SandState, art: SandArt, v: SandViewOpts) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cw / dpr;
  const H = ch / dpr;
  const L = miniLayout(W, H);
  const k = L.k;
  const plate = (x: number, y: number, w: number, h: number, fill = 'rgba(255,248,232,0.94)') => {
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(140,100,60,0.55)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
  };
  // 얼굴 + 하트
  const x0 = L.s.l + 14 * k;
  const y0 = L.s.t + 14 * k;
  const r = 27 * k;
  plate(x0, y0, 210 * k, 2 * r + 8 * k);
  face(ctx, art, x0 + 4 * k + r, y0 + 4 * k + r, r);
  for (let i = 0; i < SAND.hearts; i++) {
    const on = i < s.hearts;
    ctx.globalAlpha = on ? 1 : 0.3;
    ctx.filter = on ? 'none' : 'grayscale(1)';
    spr(ctx, art, 'heart_pickup', x0 + 2 * r + (30 + i * 40) * k, y0 + 4 * k + r + 17 * k, 0.2 * k);
  }
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  // 켜진 보상: 아이콘 + 남은 시간 막대
  const powers: [string, number, number][] = [];
  if (s.shield > 0) powers.push(['shield_pickup', s.shield, SAND.shield]);
  if (s.magnet > 0) powers.push(['magnet_pickup', s.magnet, SAND.magnet]);
  if (s.boost > 0) powers.push(['boost_pad', s.boost, SAND.boostTime]);
  powers.forEach(([id, left, max], i) => {
    const px = x0 + i * 58 * k;
    const py = y0 + 2 * r + 16 * k;
    plate(px, py, 52 * k, 52 * k);
    spr(ctx, art, id, px + 26 * k, py + 44 * k, 0.17 * k);
    ctx.fillStyle = 'rgba(120,85,55,0.25)';
    ctx.fillRect(px + 8 * k, py + 46 * k, 36 * k, 3 * k);
    ctx.fillStyle = '#f08a3c';
    ctx.fillRect(px + 8 * k, py + 46 * k, 36 * k * (left / max), 3 * k);
  });
  // 가운데 이름판 + 시간 (좁은 화면은 이름판을 빼고 시간은 하트 판 밑, 냥코인은 돌아가기 밑)
  ctx.textAlign = 'center';
  ctx.font = `bold ${17 * k}px system-ui, sans-serif`;
  const narrow = W < 700;
  const title = '🐾 모래 미끄럼틀 🐾';
  const tw = ctx.measureText(title).width + 40 * k;
  if (!narrow) {
    plate(W / 2 - tw / 2, y0, tw, 34 * k, 'rgba(240,222,190,0.96)');
    ctx.fillStyle = '#6b4a2f';
    ctx.fillText(title, W / 2, y0 + 23 * k);
  }
  const ty = narrow ? y0 + 2 * r + 16 * k + (powers.length ? 60 * k : 0) : y0 + 40 * k;
  ctx.font = `bold ${18 * k}px system-ui, sans-serif`;
  const clk = `⏱ ${clock(s.t)}`;
  const cwid = ctx.measureText(clk).width + 32 * k;
  ctx.fillStyle = 'rgba(90,64,46,0.92)';
  ctx.beginPath();
  const tx = narrow ? x0 + cwid / 2 : W / 2;
  ctx.roundRect(tx - cwid / 2, ty, cwid, 32 * k, 16 * k);
  ctx.fill();
  ctx.fillStyle = '#fff6e4';
  ctx.fillText(clk, tx, ty + 22 * k);
  // 오른쪽 위: 냥코인
  ctx.font = `bold ${20 * k}px system-ui, sans-serif`;
  const coinTxt = String(s.coins);
  const coinW = ctx.measureText(coinTxt).width + 64 * k;
  const coinX = narrow ? L.leave.x + L.leave.w - coinW : L.leave.x - coinW - 10 * k;
  const coinY = narrow ? L.leave.y + L.leave.h + 8 * k : L.leave.y;
  plate(coinX, coinY, coinW, L.leave.h);
  spr(ctx, art, 'paw_coin', coinX + 22 * k, coinY + L.leave.h - 5 * k, 0.2 * k);
  ctx.fillStyle = '#5b4a3f';
  ctx.textAlign = 'left';
  ctx.fillText(coinTxt, coinX + 44 * k, coinY + L.leave.h / 2 + 7 * k);
  drawLeave(ctx, L, v.hover, v.touch);
  // 오른쪽 세로 진행 막대: 아래 출발 → 위 결승 깃발
  const bx = W - L.s.r - 30 * k;
  const top = coinY + L.leave.h + 44 * k;
  const bottom = H - L.s.b - (v.touch ? 190 : 70) * k;
  if (bottom - top > 80 * k) {
    ctx.strokeStyle = 'rgba(255,248,232,0.9)';
    ctx.lineCap = 'round';
    ctx.lineWidth = 10 * k;
    ctx.beginPath();
    ctx.moveTo(bx, top);
    ctx.lineTo(bx, bottom);
    ctx.stroke();
    const py = bottom - (bottom - top) * (s.d / SAND.length);
    ctx.strokeStyle = '#f5a05a';
    ctx.lineWidth = 6 * k;
    ctx.beginPath();
    ctx.moveTo(bx, bottom);
    ctx.lineTo(bx, py);
    ctx.stroke();
    ctx.lineCap = 'butt';
    // 체크무늬 깃발
    ctx.fillStyle = '#6b4a2f';
    ctx.fillRect(bx - 1.5 * k, top - 30 * k, 3 * k, 30 * k);
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 3; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#3d2f26' : '#fffaf0';
        ctx.fillRect(bx + 1.5 * k + i * 5 * k, top - 30 * k + j * 5 * k, 5 * k, 5 * k);
      }
    // 고양이 표시
    ctx.fillStyle = '#fff8ec';
    ctx.strokeStyle = 'rgba(140,100,60,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, py, 14 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    face(ctx, art, bx, py, 13 * k);
  }
  // 출발! · 결과
  if (s.phase === 'play' && s.t < 1.3) {
    ctx.globalAlpha = Math.min(1, (1.3 - s.t) / 0.4);
    ctx.font = `bold ${44 * k}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 8 * k;
    ctx.strokeStyle = 'rgba(70,52,42,0.85)';
    ctx.strokeText('출발!', W / 2, H * 0.45);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText('출발!', W / 2, H * 0.45);
    ctx.globalAlpha = 1;
  }
  if (s.phase === 'done')
    drawCard(
      ctx,
      L,
      s.fell ? '넘어졌어요' : '완주!',
      [
        [`점수 ${s.score}${v.best !== null && s.score >= v.best && s.score > 0 ? ' · 최고 점수!' : ''}`, '#5b4a3f'],
        [`냥코인 ${s.coins}개 · ${clock(s.t)}${s.fell ? ` · ${Math.round(s.d)}m` : ''}`, '#c98a1c'],
        [s.fell ? '하트를 다 잃었어요' : s.crashes === 0 ? `무사 완주 보너스 +${SAND.cleanBonus}` : `${s.crashes}번 부딪혔어요`, !s.fell && s.crashes === 0 ? '#3e9a45' : '#d4574a'],
        [v.best !== null ? `최고 점수 ${Math.max(v.best, s.score)}` : '첫 기록!', '#9a7b62'],
      ],
      v.hover,
      '다시 타기',
    );
}
