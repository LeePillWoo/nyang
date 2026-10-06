// 샌드보드 그리기 — art/sandboarding 시트(배경 3장 · 장애물 · 장식 · 치즈 주행/동작 · 효과)로. 위에서 내려다본 비탈이 아래로 흘러가고,
// 치즈는 화면 아래쪽에서 위(앞)를 보고 달린다. 양옆은 밧줄 울타리 · 깃발 · 장식, 출발점은 천막·보드 거치대, 결승선은 체크무늬 + 스핑크스·피라미드.
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
/** 캔버스 픽셀 기준: 주행 폭 가운데 x · 반폭 · 고양이 y · m 당 px (검증 도구용 — 앞(d 가 큰 쪽)이 화면 위) */
export const sandView = { cx: 0, half: 1, y0: 0, ppm: 1 };

/** 배경 px 로 1m · 그림 배율 (배경 px / 시트 px) */
const M = 16;
const OB_K = 0.5;
const RIDE_K = 0.6;
const ACT_K = 0.48;
const DECO_K = 0.42;
const FX_K = 0.55;
const PLAY_C = (BG.playX[0] + BG.playX[1]) / 2;
const PLAY_HALF = (BG.playX[1] - BG.playX[0]) / 2;

/** 치즈 얼굴을 (x, y) 가운데에 지름 2r 로 (land_01 칸에서 머리는 피벗 기준 (+22, -155) 쯤, 폭 110px) */
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
const two = (n: number) => `_0${n}`;
const hash = (i: number) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
const DECOS = ['cactus_tall', 'cactus_cluster', 'flower_cactus', 'dry_shrub', 'palm_small', 'palm_large', 'rock_low', 'rock_stack', 'rock_arch', 'ruined_wall', 'pillar_short', 'pillar_cap', 'lantern_post', 'jars', 'bone_skeleton', 'arrow_sign'];
/** 바닥에 깔리는 것 — 고양이·장애물보다 먼저 */
const FLAT = new Set(['sand_pit', 'sand_bump', 'jump_ramp', 'boost_pad']);

export function drawSandboard(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: SandState, art: SandArt, v: SandViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  // 배경 폭을 화면 폭에 맞추되, 세로 화면에선 주행 폭이 화면 안에 들어오게
  const sc = Math.min(Math.max(cw / BG.w, ch / 1300), cw / 640);
  const cx = cw / 2;
  const half = PLAY_HALF * sc;
  const y0 = ch * 0.78;
  const ppm = M * sc;
  Object.assign(sandView, { cx, half, y0, ppm });
  const X = (x: number) => cx + x * half;
  const Y = (d: number) => y0 - (d - s.d) * ppm;
  const dMin = s.d - (ch - y0) / ppm - 6;
  const dMax = s.d + y0 / ppm + 10;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 배경: 01→02→03 을 이어 붙인 띠가 아래로 흐른다 (1536px 주기). 조각 경계는 정수 px 로 맞추고 1px 겹친다
  const tileH = BG.h * sc;
  const stripH = tileH * BG.tiles.length;
  const left = Math.round(cx - PLAY_C * sc);
  const bw = Math.ceil(BG.w * sc);
  const off = (((s.d * M * sc) % stripH) + stripH) % stripH;
  for (let y = off - stripH; y < ch; y += stripH)
    BG.tiles.forEach((t, i) => {
      const ty = Math.round(y + i * tileH);
      if (ty < ch && ty + tileH > 0) ctx.drawImage(art[t], left, ty, bw, Math.ceil(tileH) + 1);
    });

  // 그릴 것 모으기 (화면 아래쪽 = 가까운 것이 위에)
  const items: { y: number; draw: () => void }[] = [];
  const at = (d: number, draw: () => void) => items.push({ y: Y(d), draw });
  // 양옆 밧줄 울타리: 7m 마다 말뚝, 세 번째마다 깃발. 말뚝 사이에 밧줄
  const POST = 7;
  for (const side of [-1, 1]) {
    const px = X(side * 1.07);
    for (let i = Math.floor(dMin / POST); i * POST < Math.min(dMax, SAND.length + 4); i++) {
      if (i < 0) continue;
      const d = i * POST;
      const flag = i % 3 === 0;
      at(d, () => {
        const y = Y(d);
        const top = y - 70 * sc;
        if (d + POST < SAND.length + 4) {
          // 밧줄: 다음 말뚝까지 늘어진 줄
          const y2 = Y(d + POST) - 70 * sc;
          ctx.strokeStyle = 'rgba(140, 98, 52, 0.95)';
          ctx.lineWidth = 4 * sc;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.quadraticCurveTo(px + side * 16 * sc, (top + y2) / 2, px, y2);
          ctx.stroke();
        }
        spr(ctx, art, flag ? (i % 2 ? 'flag_teal' : 'flag_red') : 'rope_post', px, y, DECO_K * sc * (flag ? 0.8 : 0.7), flag && side > 0 ? -1 : 1);
      });
    }
  }
  // 바깥 장식: 11m 마다 번갈아
  for (let i = Math.max(1, Math.floor(dMin / 11)); i * 11 < Math.min(dMax, SAND.length - 10); i++) {
    const side = i % 2 ? -1 : 1;
    const id = DECOS[Math.floor(hash(i) * DECOS.length)];
    const x = side * (1.22 + hash(i + 50) * 0.32);
    const d = i * 11 + hash(i + 9) * 4;
    at(d, () => spr(ctx, art, id, X(x), Y(d), DECO_K * sc * 0.9, side > 0 && id !== 'arrow_sign' ? -1 : 1));
  }
  // 출발: 천막 · 보드 거치대 · 항아리 / 결승: 스핑크스 · 피라미드 · 등불
  at(6, () => spr(ctx, art, 'tent', X(-1.4), Y(6), DECO_K * sc));
  at(2, () => spr(ctx, art, 'board_rack', X(1.38), Y(2), DECO_K * sc));
  at(-3, () => spr(ctx, art, 'jars', X(-1.25), Y(-3), DECO_K * sc));
  const END = SAND.length;
  at(END + 10, () => spr(ctx, art, 'cat_sphinx', X(-1.45), Y(END + 10), DECO_K * sc * 1.1));
  at(END + 14, () => spr(ctx, art, 'small_pyramid', X(1.5), Y(END + 14), DECO_K * sc * 1.2));
  for (const side of [-1, 1]) at(END, () => spr(ctx, art, 'lantern_post', X(side * 1.0), Y(END), DECO_K * sc * 0.8, side > 0 ? -1 : 1));

  // 결승선 (바닥)
  if (Y(END) > -20 && Y(END) < ch + 20) {
    const y = Y(END);
    const n = 16;
    const w = (half * 2.1) / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < 2; j++) {
        ctx.fillStyle = (i + j) % 2 ? 'rgba(60,45,35,0.85)' : 'rgba(255,250,240,0.9)';
        ctx.fillRect(cx - half * 1.05 + i * w, y - (j + 1) * w * 0.5, w, w * 0.5);
      }
  }

  // 바닥 물건 (구덩이·둔덕·점프대·가속 발판)
  for (const ob of s.obs) {
    if (!FLAT.has(ob.kind) || ob.d < dMin || ob.d > dMax) continue;
    spr(ctx, art, ob.kind, X(ob.x), Y(ob.d), OB_K * sc * OBS[ob.kind].k);
  }
  // 서 있는 물건 · 줍는 것
  for (const ob of s.obs) {
    if (FLAT.has(ob.kind) || ob.got || ob.d < dMin || ob.d > dMax) continue;
    const o = OBS[ob.kind];
    const pickup = o.role !== 'hit' && o.role !== 'tall';
    at(ob.d, () => {
      const x = X(ob.x);
      const y = Y(ob.d);
      if (pickup) {
        // 줍는 것: 그림자 위에서 둥실
        ctx.fillStyle = 'rgba(90,60,30,0.22)';
        ctx.beginPath();
        ctx.ellipse(x, y, 16 * sc * o.k * 2, 5 * sc * o.k * 2, 0, 0, Math.PI * 2);
        ctx.fill();
        spr(ctx, art, ob.kind, x, y - (8 + Math.sin(v.t * 4 + ob.d) * 4) * sc, OB_K * sc * o.k);
      } else {
        ctx.globalAlpha = ob.hit ? 0.55 : 1;
        spr(ctx, art, ob.kind, x, y, OB_K * sc * o.k);
        ctx.globalAlpha = 1;
      }
    });
  }

  // 치즈
  at(s.d, () => drawCat(ctx, art, s, X(s.x), y0, sc, v.t));
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // 짧은 효과 · 떠오르는 글자
  for (const f of s.fx) spr(ctx, art, f.id + two(Math.min(6, Math.floor((f.t / FX_TIME) * 6) + 1)), X(f.x), Y(f.d), FX_K * sc);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const p of s.pops) {
    const a = Math.min(1, (0.9 - p.t) / 0.3);
    ctx.globalAlpha = Math.max(0, a);
    ctx.font = `bold ${Math.round(26 * sc)}px system-ui, sans-serif`;
    ctx.lineWidth = 6 * sc;
    ctx.strokeStyle = 'rgba(110, 70, 30, 0.9)';
    const y = Y(p.d) - (50 + p.t * 70) * sc;
    ctx.strokeText(p.text, X(p.x) + 30 * sc, y);
    ctx.fillStyle = '#ffd84a';
    ctx.fillText(p.text, X(p.x) + 30 * sc, y);
  }
  ctx.globalAlpha = 1;
  // 속도선 (부스트 · 빠를 때)
  if (s.phase === 'play' && (s.boost > 0 || s.v > SAND.vMax + 0.5)) {
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3 * sc;
    for (let i = 0; i < 8; i++) {
      const x = cx + (i < 4 ? -1 : 1) * half * (0.95 + (i % 4) * 0.05);
      const y = ((v.t * 1400 * sc + i * 211) % (ch + 160)) - 80;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y - 90 * sc);
      ctx.stroke();
    }
  }

  drawHud(ctx, cw, ch, dpr, s, art, v);
}

/** 치즈: 땅에선 뒷모습 주행(좌우 누르면 드리프트, 가끔 고개 돌림) · 공중은 점프 · 내려오면 착지 · 부딪히면 넘어졌다 일어남 */
function drawCat(ctx: CanvasRenderingContext2D, art: SandArt, s: SandState, x: number, y: number, sc: number, t: number) {
  const p = s.air > 0 ? 1 - s.air / s.airMax : 0;
  const height = s.airMax >= SAND.rampJump ? 95 : s.airMax <= SAND.bump ? 38 : 60;
  const lift = s.air > 0 ? Math.sin(Math.PI * p) * height * sc : 0;
  // 그림자
  ctx.fillStyle = 'rgba(90,60,30,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y - 4 * sc, (34 - lift / sc / 8) * sc, (11 - lift / sc / 20) * sc, 0, 0, Math.PI * 2);
  ctx.fill();
  const ground = s.air <= 0 && s.dizzy <= 0 && s.phase === 'play';
  // 보드 뒤 모래 꼬리(아래로) · 드리프트면 옆으로 튀는 모래
  if (ground) {
    ctx.globalAlpha = 0.9;
    spr(ctx, art, 'sand_trail' + two((Math.floor(s.t * 8) % 6) + 1), x, y - 4 * sc, FX_K * sc, 1, -1);
    if (s.steer !== 0) spr(ctx, art, 'carve_spray' + two((Math.floor(s.steerT * 8) % 6) + 1), x, y + 6 * sc, FX_K * sc * 0.8, -s.steer);
    ctx.globalAlpha = 1;
  }
  let id: string;
  let k = ACT_K * sc;
  let flip = s.flip;
  if (s.dizzy > 0 || (s.phase === 'done' && s.fell)) {
    const q = s.phase === 'done' ? 0 : Math.min(11, Math.floor((1 - s.dizzy / SAND.dizzy) * 12));
    id = s.phase === 'done' ? 'fall_06' : q < 6 ? 'fall' + two(q + 1) : 'get_up' + two(q - 5);
  } else if (s.air > 0) id = 'jump' + two(Math.min(6, Math.floor(p * 6) + 1));
  else if (s.landT < 0.5) id = 'land' + two(Math.min(6, Math.floor(s.landT * 12) + 1));
  else {
    k = RIDE_K * sc;
    flip = 1;
    const ph = s.t % 6;
    const c = Math.floor(s.t / 6);
    if (s.steer !== 0) id = (s.steer < 0 ? 'drift_left' : 'drift_right') + two(Math.min(6, Math.floor(s.steerT * 8) + 1));
    else if (s.phase === 'play' && c % 3 !== 0 && ph < 0.75) id = (c % 2 ? 'look_left' : 'look_right') + two(Math.floor(ph * 8) + 1);
    else id = 'ride' + two((Math.floor(s.t * 8) % 6) + 1);
  }
  spr(ctx, art, id, x, y - lift, k, flip);
  // 방패: 둥근 막 · 자석: 머리 위 자석
  if (s.shield > 0) {
    const blink = s.shield < 2 ? 0.5 + 0.5 * Math.sin(t * 20) : 1;
    ctx.globalAlpha = 0.16 * blink;
    ctx.fillStyle = '#7cc8ff';
    ctx.strokeStyle = '#e8f6ff';
    ctx.lineWidth = 3 * sc;
    ctx.beginPath();
    ctx.ellipse(x, y - lift - 55 * sc, 52 * sc, 66 * sc, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.55 * blink;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  if (s.magnet > 0) {
    ctx.globalAlpha = s.magnet < 2 ? 0.5 + 0.5 * Math.sin(t * 20) : 1;
    spr(ctx, art, 'magnet_pickup', x + Math.sin(t * 6) * 4 * sc, y - lift - 112 * sc, OB_K * sc * 0.3);
    ctx.globalAlpha = 1;
  }
  drawEmote(ctx, x, y - lift - 140 * sc, 50 * sc);
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
  // 가운데 이름판 + 시간
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
  // 오른쪽 위: 냥코인 (돌아가기 왼쪽)
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
