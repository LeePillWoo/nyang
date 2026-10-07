// 샌드보드 그리기 — art/sandboarding 시트(배경 3장 · 장애물 · 장식 · 치즈 주행/동작 · 효과)로. 치즈는 화면 아래쪽에서 위(앞)를 보고 달리고,
// 길은 지그재그로 휜다 (sandboard.ts 의 center). 카메라는 앞쪽 길 가운데와 치즈 사이를 부드럽게 따라가 다가오는 굽이를 미리 보여 준다.
// 시점: 달리는 동안은 왜곡 없는 평면(위에서 내려다본 그대로), 결승 CURL_FROM m 앞부터 원근이 서서히 들어와 결승선에선 앞으로 갈수록
//   좁아지며 살짝 말린다 (2026-10-07 사용자 의견 — 원근이 내내 있으면 멀미가 났다. 둥글게 말린 원근 · 곧은 사다리꼴 둘 다).
//   원근 식: 배율 sc = 1 / (1 + dd/D), 화면 y = y0 − ppm·D·ln(1 + dd/D)  (dd = 치즈보다 앞쪽 거리 m). D = ∞ 이면 평면(배율 1, y = y0 − ppm·dd),
//   결승선에선 화면 맨 위가 FAR 배율이 되는 D. 그 사이는 D = D(결승) / 말린 정도 라서 평면 → 원근이 끊김 없이 이어진다
// 바닥: 배경 세 장(위에서 아래로 01→02→03)의 가운데 — 장식 없는 모래 — 만 잘라 좌우로 [그림 | 거울] 이어 붙인 무늬라 길이 어디로 휘어도 깔린다.
//   앞으로 갈수록(화면 위로) 무늬의 위쪽 줄 — 거꾸로 읽으면 그림이 위아래로 뒤집힌다(2026-10-06 에 그랬다). 평면이면 한 번에 칠하고,
//   원근이면 화면 1px(기기 픽셀) 가로 조각마다 그 거리의 배율로 (4px 조각은 조각 사이가 어긋나 톱니로 보였다).
// 길은 밝은 모래 띠 + 양옆 밧줄 울타리 · 깃발, 바깥엔 장식(그림 그대로 — 뒤집지 않는다), 굽이 앞 바깥쪽엔 굽는 쪽을 가리키는 표지판.
// 출발점은 천막·보드 거치대, 결승선은 체크무늬 + 스핑크스·피라미드.
// 좌표 · 피벗은 src/data/sandboard-atlas.json (tools/assets.mjs 가 art/sandboarding/sprites.json 에서 만든다). 로직은 sandboard.ts.
import atlas from './data/sandboard-atlas.json' with { type: 'json' };
import { drawEmote } from './emote.ts';
import { clock, drawCard, drawLeave, miniLayout, type MiniButton } from './mini-draw.ts';
import { center, FX_TIME, OBS, SAND, type SandState } from './sandboard.ts';

type Frame = [string, number, number, number, number, number, number];
const FR = atlas.frames as unknown as Record<string, Frame>;
const BG = atlas.bg;
/** 불러올 그림 (배경 조각 + 시트) */
export const SAND_IMAGES = [...new Set([...BG.tiles, ...Object.values(FR).map((f) => f[0])])];
export type SandArt = Record<string, CanvasImageSource>;
export type SandViewOpts = { t: number; touch: boolean; hover: MiniButton; best: number | null };
/** 캔버스 픽셀 기준: 화면 가운데 x · 길 반폭 · 치즈 y · m 당 px · 원근 거리 D (∞ = 평면) · 화면 가운데의 가로 자리(카메라) (검증 도구용 — 앞이 화면 위) */
export const sandView = { cx: 0, half: 1, y0: 0, ppm: 1, D: Infinity, cam: 0 };
/** 원근 거리 D 의 배율 · 화면 y — D = ∞ 면 왜곡 없는 평면 */
const scAt = (dd: number, D: number) => (D === Infinity ? 1 : 1 / (1 + dd / D));
const yAt = (dd: number, D: number, y0: number, ppm: number) => y0 - ppm * (D === Infinity ? dd : D * Math.log1p(dd / D));
/** 가로 자리 x · 치즈보다 앞쪽 거리 dd(m) 의 화면 자리 (캔버스 px) */
export const sandPoint = (x: number, dd: number) => ({
  x: sandView.cx + (x - sandView.cam) * sandView.half * scAt(dd, sandView.D),
  y: yAt(dd, sandView.D, sandView.y0, sandView.ppm),
});

/** 배경 px 로 1m · 그림 배율 (배경 px / 시트 px) */
const M = 16;
const OB_K = 0.46;
const RIDE_K = 0.6;
const ACT_K = 0.48;
const DECO_K = 0.4;
const FX_K = 0.55;
/** 결승선에서 화면 맨 위(가장 먼 곳)의 배율 · 원근이 들어오기 시작하는 결승 앞 거리(m) · 원근일 때 바닥 조각 높이(화면 px) */
const FAR = 0.72;
const CURL_FROM = 70;
const STRIP_PX = 1;
/** 길 반폭 (배경 px — 배경 그림의 주행 폭) · 바닥 무늬로 쓰는 배경 가운데(장식 없는 모래)의 x · 폭 */
const PLAY_HALF = (BG.playX[1] - BG.playX[0]) / 2;
const SAND_X = 300;
const SAND_W = 424;
/**
 * 카메라: 화면에 보이는 앞 거리의 LOOK 비율만큼 앞의 길 가운데를 LOOK_K 만큼(나머지는 치즈) 따라간다 — 다가오는 굽이가 화면 안에 들어오게
 * (가로 화면 약 16m, 앞이 훨씬 많이 보이는 세로 화면은 더 멀리). CAM_T = 따라가는 시간 상수(초), 치즈는 화면 가운데에서 화면 폭의 CAM_ROOM 안
 * (휙 움직여 멀미 나지 않게 부드럽게)
 */
const LOOK = 0.45;
const LOOK_K = 0.7;
const CAM_T = 0.45;
const CAM_ROOM = 0.3;

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
const DECOS = ['cactus_tall', 'cactus_cluster', 'flower_cactus', 'dry_shrub', 'palm_small', 'palm_large', 'rock_low', 'rock_stack', 'rock_arch', 'ruined_wall', 'pillar_short', 'pillar_cap', 'lantern_post', 'jars', 'bone_skeleton'];
/** 바닥에 깔리는 효과 — 치즈를 덮지 않게 먼저 그린다 */
const GROUND_FX = new Set(['carve_spray', 'land_burst', 'jump_puff']);
/** 바닥에 깔리는 것 — 고양이·장애물보다 먼저 */
const FLAT = new Set(['sand_pit', 'sand_bump', 'jump_ramp', 'boost_pad']);

/** 바닥 무늬: 배경 세 장의 가운데를 위에서 아래로 01 → 02 → 03, 좌우로는 [그림 | 거울] — 어느 쪽으로 이어도 이음매가 없다. 한 번 만들어 둔다 */
let ground: { art: SandArt; ctx: CanvasRenderingContext2D; pat: CanvasPattern } | null = null;
function groundPattern(ctx: CanvasRenderingContext2D, art: SandArt) {
  if (ground?.art === art && ground.ctx === ctx) return ground.pat;
  const c = document.createElement('canvas');
  c.width = SAND_W * 2;
  c.height = BG.h * BG.tiles.length;
  const g = c.getContext('2d')!;
  BG.tiles.forEach((t, i) => {
    g.drawImage(art[t], SAND_X, 0, SAND_W, BG.h, 0, i * BG.h, SAND_W, BG.h);
    g.save();
    g.translate(SAND_W * 2, i * BG.h);
    g.scale(-1, 1);
    g.drawImage(art[t], SAND_X, 0, SAND_W, BG.h, 0, 0, SAND_W, BG.h);
    g.restore();
  });
  ground = { art, ctx, pat: ctx.createPattern(c, 'repeat')! };
  return ground.pat;
}
/** 카메라 가로 자리 (새 판이면 그 자리에서 바로) */
const cam = { run: null as SandState | null, x: 0, t: 0 };

export function drawSandboard(ctx: CanvasRenderingContext2D, cw: number, ch: number, s: SandState, art: SandArt, v: SandViewOpts) {
  const dpr = Math.min(devicePixelRatio, 2);
  // 화면 배율(배경 px → 화면 px). CSS px 로 정해 기기 픽셀로: 가로 화면은 길 폭이 화면의 45% 쯤 · 앞이 35m 쯤 보이게
  // (휴대폰 가로처럼 낮은 화면도 치즈가 너무 작아지지 않게 0.75 까지는), 세로 화면은 길 폭이 화면 폭의 80% 쯤
  const W = cw / dpr;
  const H = ch / dpr;
  const k = dpr * (W > H ? Math.max(Math.min(W / 1250, H / 720), Math.min(0.75, H / 520)) : Math.min(W / 720, H / 1100));
  const cx = cw / 2;
  const half = PLAY_HALF * k;
  // 치즈 자리 — 가로 휴대폰(터치)은 아래 가운데에 점프 버튼이 있어 조금 위로
  const y0 = ch * (v.touch && cw > ch ? 0.64 : 0.78);
  const ppm = M * k;
  const C = (d: number) => center(s.course, d);
  // 카메라: 앞쪽 길 가운데 쪽으로 부드럽게 (치즈는 화면 가운데에서 CAM_ROOM 안)
  const want = C(s.d + (LOOK * y0) / ppm) * LOOK_K + s.x * (1 - LOOK_K);
  if (cam.run !== s) Object.assign(cam, { run: s, x: want, t: v.t });
  cam.x += (want - cam.x) * (1 - Math.exp(-Math.min(0.1, Math.max(0, v.t - cam.t)) / CAM_T));
  cam.t = v.t;
  const room = (cw * CAM_ROOM) / half;
  cam.x = Math.max(s.x - room, Math.min(s.x + room, cam.x));
  // 시점: 결승 CURL_FROM m 앞까지는 평면(D = ∞), 그때부터 결승선까지 서서히 말린다 (결승선에서 화면 맨 위 FAR 배율)
  const left = Math.max(0, SAND.length - s.d);
  const p = Math.max(0, Math.min(1, (CURL_FROM - left) / CURL_FROM));
  const curl = p * p * (3 - 2 * p);
  const D = curl > 0.001 ? y0 / (ppm * Math.log(1 / FAR)) / curl : Infinity;
  Object.assign(sandView, { cx, half, y0, ppm, D, cam: cam.x });
  const sc = (d: number) => scAt(d - s.d, D);
  const Y = (d: number) => yAt(d - s.d, D, y0, ppm);
  const X = (x: number, d: number) => cx + (x - cam.x) * half * sc(d);
  const dAt = (y: number) => s.d + (D === Infinity ? (y0 - y) / ppm : D * Math.expm1((y0 - y) / (ppm * D)));
  // 보이는 거리: 화면 아래 끝 너머 6m(말뚝 키만큼) ~ 화면 위 끝 너머 2m. 이 밖은 그리지 않는다 —
  // 원근일 땐 치즈보다 D 이상 뒤에서 log(음수) = NaN 이 되고, 캔버스는 NaN 이동을 무시해 그림을 왼쪽 위(0,0)에 그린다
  const dMin = Math.max(dAt(ch) - 6, s.d - D * 0.8);
  const dMax = dAt(0) + 2;
  const seen = (d: number) => d >= dMin && d <= dMax;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // 바닥 모래: 무늬 1m = M px · 길 반폭 = PLAY_HALF px (배율 k 면 배경 그림 시절과 같은 크기). 무늬 줄 −d·M 이 거리 d 의 화면 y 에 오게
  const pat = groundPattern(ctx, art);
  const place = (q: number, y: number, d: number) => pat.setTransform(new DOMMatrix([q, 0, 0, q, cx - cam.x * PLAY_HALF * q, y + d * M * q]));
  ctx.fillStyle = pat;
  if (D === Infinity) {
    place(k, y0, s.d);
    ctx.fillRect(0, 0, cw, ch);
  } else
    for (let y = 0; y < ch; y += STRIP_PX) {
      const d = dAt(y + STRIP_PX / 2);
      place(k * sc(d), y + STRIP_PX / 2, d);
      ctx.fillRect(0, y, cw, STRIP_PX);
    }
  // 길: 울타리 사이는 밝게, 바깥은 조금 어둡게 (2m 마다 이은 띠)
  ctx.beginPath();
  const dTop = Math.min(dMax, SAND.length + 30);
  for (let d = dMin; d < dTop + 2; d += 2) ctx.lineTo(X(C(d) - 1.04, d), Y(d));
  for (let d = Math.floor(dTop / 2) * 2 + 2; d > dMin - 2; d -= 2) ctx.lineTo(X(C(d) + 1.04, d), Y(d));
  ctx.closePath();
  ctx.fillStyle = 'rgba(255, 247, 230, 0.2)';
  ctx.fill();
  ctx.rect(cw, 0, -cw, ch); // 거꾸로 돈 화면 사각형 — 띠 바깥만 칠한다
  ctx.fillStyle = 'rgba(150, 92, 40, 0.1)';
  ctx.fill();

  // 그릴 것 모으기 (화면 아래쪽 = 가까운 것이 위에)
  const items: { y: number; draw: () => void }[] = [];
  const at = (d: number, draw: () => void) => {
    if (seen(d)) items.push({ y: Y(d), draw });
  };
  // 양옆 밧줄 울타리: 7m 마다 말뚝, 세 번째마다 깃발. 말뚝 사이에 밧줄 — 길을 따라 휜다
  const POST = 7;
  const POST_H = 70;
  for (const side of [-1, 1]) {
    for (let i = Math.max(0, Math.floor(dMin / POST)); i * POST < Math.min(dMax, SAND.length + 30); i++) {
      const d = i * POST;
      const flag = i % 3 === 0;
      at(d, () => {
        const q = sc(d);
        const px = X(C(d) + side * 1.07, d);
        const y = Y(d);
        if (d + POST < SAND.length + 30) {
          const d2 = d + POST;
          const q2 = sc(d2);
          const px2 = X(C(d2) + side * 1.07, d2);
          const y2 = Y(d2) - POST_H * k * q2;
          const top = y - POST_H * k * q;
          ctx.strokeStyle = 'rgba(140, 98, 52, 0.95)';
          ctx.lineWidth = 4 * k * q;
          ctx.beginPath();
          ctx.moveTo(px, top);
          ctx.quadraticCurveTo((px + px2) / 2 + side * 8 * k * q, (top + y2) / 2, px2, y2);
          ctx.stroke();
        }
        spr(ctx, art, flag ? (i % 2 ? 'flag_teal' : 'flag_red') : 'rope_post', px, y, DECO_K * k * q * (flag ? 0.8 : 0.7));
      });
    }
  }
  // 바깥 장식: 양옆 5m 마다 (가끔 비움), 울타리 밖 1.3 ~ 2.6 (그림 그대로 — 뒤집지 않는다)
  for (let i = Math.max(1, Math.floor(dMin / 5)); i * 5 < Math.min(dMax, SAND.length - 10); i++)
    for (const side of [-1, 1]) {
      const h = hash(i * 2 + (side > 0 ? 1 : 0));
      if (h < 0.3) continue;
      const id = DECOS[Math.floor(hash(i * 7 + side) * DECOS.length)];
      const d = i * 5 + hash(i * 3 + side) * 3;
      const x = side * (1.3 + hash(i * 5 + side) * 1.3);
      at(d, () => spr(ctx, art, id, X(C(d) + x, d), Y(d), DECO_K * k * sc(d) * (0.7 + h * 0.35)));
    }
  // 굽이 앞: 바깥쪽에 굽는 쪽을 가리키는 표지판 (그림은 오른쪽을 가리켜서 왼쪽 굽이만 좌우로 뒤집는다)
  for (const b of s.course) {
    const dir = Math.sign(b.c1 - b.c0);
    const d = b.d0 - 6;
    if (dir && d < SAND.length - 20) at(d, () => spr(ctx, art, 'arrow_sign', X(C(d) - dir * 1.32, d), Y(d), DECO_K * k * sc(d) * 0.85, dir));
  }
  // 출발: 천막 · 보드 거치대 · 항아리 / 결승: 스핑크스 · 피라미드 · 등불 (x = 길 가운데에서)
  const deco = (id: string, x: number, d: number, m = 1) => at(d, () => spr(ctx, art, id, X(C(d) + x, d), Y(d), DECO_K * k * sc(d) * m));
  deco('tent', -1.4, 6);
  deco('board_rack', 1.38, 2);
  deco('jars', -1.25, -3);
  const END = SAND.length;
  deco('cat_sphinx', -1.45, END + 10, 1.1);
  deco('small_pyramid', 1.5, END + 14, 1.2);
  for (const side of [-1, 1]) deco('lantern_post', side * 1.0, END, 0.8);

  // 결승선 (바닥, 길을 가로질러)
  if (seen(END)) {
    const n = 16;
    for (let j = 0; j < 2; j++) {
      const d1 = END + j * 0.6;
      const d2 = END + (j + 1) * 0.6;
      const c1 = C(d1);
      const c2 = C(d2);
      for (let i = 0; i < n; i++) {
        const xa = -1.05 + (2.1 * i) / n;
        const xb = xa + 2.1 / n;
        ctx.fillStyle = (i + j) % 2 ? 'rgba(60,45,35,0.85)' : 'rgba(255,250,240,0.9)';
        ctx.beginPath();
        ctx.moveTo(X(c1 + xa, d1), Y(d1));
        ctx.lineTo(X(c1 + xb, d1), Y(d1));
        ctx.lineTo(X(c2 + xb, d2), Y(d2));
        ctx.lineTo(X(c2 + xa, d2), Y(d2));
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  // 바닥 물건 (구덩이·둔덕·점프대·가속 발판)
  for (const ob of s.obs) {
    if (!FLAT.has(ob.kind) || !seen(ob.d)) continue;
    spr(ctx, art, ob.kind, X(ob.x, ob.d), Y(ob.d), OB_K * k * sc(ob.d) * OBS[ob.kind].k);
  }
  // 서 있는 물건 · 줍는 것
  for (const ob of s.obs) {
    if (FLAT.has(ob.kind) || ob.got || !seen(ob.d)) continue;
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

  // 바닥 효과 (촤악 모래 · 착지 파동 · 점프 먼지) — 치즈·물건 밑에
  const fxFrame = (f: SandState['fx'][number]) => f.id + two(Math.min(6, Math.floor((f.t / FX_TIME) * 6) + 1));
  for (const f of s.fx) if (GROUND_FX.has(f.id) && seen(f.d)) spr(ctx, art, fxFrame(f), X(f.x, f.d), Y(f.d), FX_K * k * sc(f.d), f.flip ?? 1);

  // 치즈
  at(s.d, () => drawCat(ctx, art, s, X(s.x, s.d), y0, k, v.t, ppm));
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  // 위에 뜨는 효과 (충돌 별 · 줍기 반짝임) · 떠오르는 글자
  for (const f of s.fx) if (!GROUND_FX.has(f.id) && seen(f.d)) spr(ctx, art, fxFrame(f), X(f.x, f.d), Y(f.d), FX_K * k * sc(f.d), f.flip ?? 1);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  for (const p of s.pops) {
    if (!seen(p.d)) continue;
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
  drawHud(ctx, cw, ch, dpr, s, art, v);
}

/**
 * 주행 컷(ride · look · drift)의 보드: 칸 안의 보드 중심과 그려진 기울기. 그림에서 한 번 잰다 —
 * 보드(나무색·청록 픽셀)의 무게중심과 주축. 드리프트 컷은 보드가 약 32° 꺾여 그려져 있고 기준점도 주행 컷과 달라서,
 * 기준점 대신 보드 중심을 같은 자리에 두고 "물리 각도 − 그려진 기울기" 만큼 돌린다 (컷이 바뀌어도 보드가 튀지 않는다).
 */
type BoardInfo = { cx: number; cy: number; ang: number };
const boards = new Map<string, BoardInfo>();
function board(art: SandArt, id: string): BoardInfo {
  const hit = boards.get(id);
  if (hit) return hit;
  const [sheet, fx, fy, fw, fh, px, py] = FR[id];
  const c = document.createElement('canvas');
  c.width = fw;
  c.height = fh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(art[sheet], fx, fy, fw, fh, 0, 0, fw, fh);
  const d = g.getImageData(0, 0, fw, fh).data;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let j = 0; j < fh; j++)
    for (let i = 0; i < fw; i++) {
      const o = (j * fw + i) * 4;
      if (d[o + 3] < 128) continue;
      const r = d[o];
      const gg = d[o + 1];
      const b = d[o + 2];
      if (!((r > gg && gg > b && r < 170 && r - b > 40) || (b > r + 20 && gg > r))) continue;
      n++;
      sx += i;
      sy += j;
      sxx += i * i;
      syy += j * j;
      sxy += i * j;
    }
  let info: BoardInfo = { cx: px, cy: py - 90, ang: 0 };
  if (n > 200) {
    const mx = sx / n;
    const my = sy / n;
    let a = 0.5 * Math.atan2(2 * (sxy / n - mx * my), sxx / n - mx * mx - (syy / n - my * my)) - Math.PI / 2;
    while (a < -Math.PI / 2) a += Math.PI;
    while (a > Math.PI / 2) a -= Math.PI;
    info = { cx: mx, cy: my, ang: a };
  }
  boards.set(id, info);
  return info;
}
/** 줄(ride · drift_left …)의 평균 기울기 — 컷마다 재면 그림의 작은 흔들림까지 지워 보드가 덜덜 떤다 */
const rowAng = new Map<string, number>();
function rowAngle(art: SandArt, row: string) {
  let a = rowAng.get(row);
  if (a === undefined) {
    a = 0;
    for (let i = 1; i <= 6; i++) a += board(art, row + two(i)).ang / 6;
    rowAng.set(row, a);
  }
  return a;
}

/** 모래 알갱이 (화면 px) — 미끄러질 때 보드 꼬리에서 바깥으로 튄다. 바닥에 떨어진 건 바닥과 함께 아래로 흘러간다 */
let grains: { x: number; y: number; vx: number; vy: number; t: number; life: number; r: number }[] = [];
let grainRun: SandState | null = null;
let grainT = 0;
let grainDebt = 0;
/** 드리프트 컷을 쓰는 중인가 (경계에서 컷이 깜빡이지 않게 들어갈 때 21°, 나올 때 15°) */
let drifting = false;

/** 치즈: 땅에선 뒷모습 주행 — 보드가 물리 각도대로 돌고, 많이 꺾이면 드리프트 컷. 공중은 점프 · 내려오면 착지 · 부딪히면 넘어졌다 일어남 */
function drawCat(ctx: CanvasRenderingContext2D, art: SandArt, s: SandState, x: number, y: number, k: number, t: number, ppm: number) {
  const p = s.air > 0 ? 1 - s.air / s.airMax : 0;
  const height = s.airMax >= SAND.rampJump ? 95 : s.airMax <= SAND.bump ? 38 : 60;
  const lift = s.air > 0 ? Math.sin(Math.PI * p) * height * k : 0;
  const ride = s.dizzy <= 0 && !(s.phase === 'done' && s.fell) && s.air <= 0 && s.landT >= 0.5;
  const q = RIDE_K * k;
  // 보드 중심 (바닥) — 주행 컷에서 보드 중심이 기준점보다 위에 있는 만큼
  const bx = x;
  const by = y - (FR.ride_01[6] - board(art, 'ride_01').cy) * q;
  const yaw = s.yaw;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // 그림자: 주행 중엔 보드 모양으로 보드와 같이 돈다. 공중·동작 컷은 둥근 그림자
  ctx.fillStyle = 'rgba(90,60,30,0.26)';
  ctx.beginPath();
  if (ride) ctx.ellipse(bx + 4 * q, by + 8 * q, 30 * q, 92 * q, yaw, 0, Math.PI * 2);
  else ctx.ellipse(x, y - 4 * k, (34 - lift / k / 8) * k, (11 - lift / k / 20) * k, 0, 0, Math.PI * 2);
  ctx.fill();

  // 모래: 꼬리 뒤로 흐르는 줄 + 미끄러짐만큼 바깥으로 튀는 모래 + 알갱이
  const ground = s.air <= 0 && s.dizzy <= 0 && s.phase === 'play';
  const L = 80 * q;
  const tx = bx - sin * L;
  const ty = by + cos * L;
  const out = -Math.sign(yaw) || 1; // 꼬리가 밀려나는 쪽 = 모래가 튀는 쪽
  const spray = Math.min(1, s.slip * 1.6 + Math.abs(s.lean) * 0.25);
  if (ground) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(tx, ty);
    ctx.rotate(yaw);
    // 카빙으로 빨라지는 동안엔 꼬리가 길게 늘어난다
    const stretch = 1 + (s.carveT > 0 ? 0.7 : 0) + Math.max(0, (s.v - SAND.vMax) / 8);
    ctx.scale(1, stretch);
    spr(ctx, art, 'sand_trail' + two((Math.floor(s.t * 8) % 6) + 1), 0, -6 * q, FX_K * k, 1, -1);
    ctx.restore();
    if (Math.abs(s.lean) > 0.08 || s.slip > 0.08) {
      // 치즈를 가리지 않게: 꼬리 바깥·뒤쪽에, 조금 옅게
      ctx.save();
      ctx.globalAlpha = spray * 0.85;
      ctx.translate(tx + out * 24 * q, ty + 6 * q);
      ctx.rotate(yaw * 0.5);
      spr(ctx, art, 'carve_spray' + two((Math.floor(s.t * 10) % 6) + 1), 0, 0, FX_K * k * (0.35 + 0.45 * spray), out);
      ctx.restore();
    }
  }
  // 알갱이: 새 판이면 비우고, 미끄러짐만큼 뿌린다 (초당 최대 110알)
  if (grainRun !== s) {
    grainRun = s;
    grains = [];
    grainT = t;
  }
  const dt = Math.min(0.05, Math.max(0, t - grainT));
  grainT = t;
  if (ground) {
    grainDebt += (s.slip * 110 + Math.abs(s.lean) * 12) * dt;
    for (; grainDebt >= 1; grainDebt--) {
      const sp = (110 + Math.random() * 170) * k * (0.5 + s.slip);
      grains.push({
        x: tx + (Math.random() - 0.5) * 18 * q,
        y: ty + (Math.random() - 0.5) * 18 * q,
        vx: out * sp * (0.7 + Math.random() * 0.5),
        vy: (Math.random() * 90 - 20) * k,
        t: 0,
        life: 0.35 + Math.random() * 0.3,
        r: (1.6 + Math.random() * 2.2) * k,
      });
    }
  } else grainDebt = 0;
  const flow = s.phase === 'play' ? s.v * ppm : 0;
  ctx.fillStyle = '#e8c48c';
  for (const g of grains) {
    g.t += dt;
    const drag = Math.exp(-4 * dt);
    g.vx *= drag;
    g.vy *= drag;
    g.x += g.vx * dt;
    g.y += (g.vy + flow) * dt;
    ctx.globalAlpha = Math.max(0, 1 - g.t / g.life) * 0.85;
    ctx.beginPath();
    ctx.arc(g.x, g.y, g.r * (1 + g.t * 1.5), 0, Math.PI * 2);
    ctx.fill();
  }
  grains = grains.filter((g) => g.t < g.life);
  ctx.globalAlpha = 1;

  if (ride) {
    // 주행: 많이 꺾이면 드리프트 컷, 아니면 주행 컷(가끔 고개 돌림). 어느 컷이든 보드 중심을 같은 자리에, 물리 각도로
    const a = Math.abs(yaw);
    if (a > 0.37) drifting = true;
    else if (a < 0.26) drifting = false;
    const ph = s.t % 6;
    const c = Math.floor(s.t / 6);
    let row = 'ride';
    let n = (Math.floor(s.t * 8) % 6) + 1;
    if (drifting) row = yaw < 0 ? 'drift_left' : 'drift_right';
    else if (s.phase === 'play' && c % 3 !== 0 && ph < 0.75 && a < 0.12) {
      row = c % 2 ? 'look_left' : 'look_right';
      n = Math.floor(ph * 8) + 1;
    }
    const id = row + two(n);
    const [sheet, fx, fy, fw, fh] = FR[id];
    const b = board(art, id);
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(yaw - rowAngle(art, row));
    ctx.drawImage(art[sheet], fx, fy, fw, fh, -b.cx * q, -b.cy * q, fw * q, fh * q);
    ctx.restore();
  } else {
    let id: string;
    if (s.dizzy > 0 || (s.phase === 'done' && s.fell)) {
      const f = s.phase === 'done' ? 0 : Math.min(11, Math.floor((1 - s.dizzy / SAND.dizzy) * 12));
      id = s.phase === 'done' ? 'fall_06' : f < 6 ? 'fall' + two(f + 1) : 'get_up' + two(f - 5);
    } else if (s.air > 0) id = 'jump' + two(Math.min(6, Math.floor(p * 6) + 1));
    else id = 'land' + two(Math.min(6, Math.floor(s.landT * 12) + 1));
    spr(ctx, art, id, x, y - lift, ACT_K * k, s.flip);
  }
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
