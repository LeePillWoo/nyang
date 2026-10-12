// 놀아 주기 미니게임 그리기 (2026-10-08 밤) — 마을 창의 카드(요리 카드와 같은 자리) 안에 놀이판 · 친구 · 장난감 · 안내 · 끝나면 결과.
// 친구 모습은 마을 그리기가 넘겨주는 pose(동작 줄 · 컷)로 그린다 — 시트의 장난감 놀이 줄엔 품종마다 제 장난감(쥐 · 생선 · 공 …)이 그려져 있어
// 놀이 장난감과 겹치지 않게 다른 줄을 쓴다: 씰룩 = 심심 줄의 기지개 컷(엎드려 엉덩이를 든 자세), 잡음 · 맞힘 = 애정(하트), 놓침 = 심심(한숨), 엿보기 = 대기의 물음표 컷.
// 덮치기는 대기 컷을 포물선 따라 기울인다. 장난감(깃털 · 상자 · 털실 공)은 캔버스로.
// 디자인 좌표 (마을 창과 같은 1000×560 · 540×1040 판 안). 로직은 toys.ts.
import { button } from '../bag/bag-draw.ts';
import { fitText } from '../shared/touch.ts';
import { ballAt, BOX, FEATHER, swapNow, TOYS, YARN, type BoxGame, type FeatherGame, type ToyGame, type YarnGame } from './toys.ts';

type R = { x: number; y: number; w: number; h: number };
/** 친구 그리기: 발밑 (x, y) · 키 h(px) · 동작 줄 · 컷 · 보는 쪽 */
export type Pose = (ctx: CanvasRenderingContext2D, x: number, y: number, h: number, anim: string, frame: number, flip?: number) => void;
/** 결과 (마을이 점수를 매긴 뒤) */
export type ToyResult = { stars: number; gain: number; fav: boolean; asked: boolean; coins: number; line: string } | null;

/** 놀이판 (카드 안) · 끝난 뒤 확인 버튼 */
export function toyLayout(card: R) {
  const area: R = { x: card.x + 30, y: card.y + 92, w: card.w - 60, h: card.h - 92 - 104 };
  const ok: R = { x: card.x + card.w / 2 - 130, y: card.y + card.h - 76, w: 260, h: 58 };
  return { area, ok };
}
/** 깃털 · 친구 가로 자리 (-1..1) ↔ 판 x */
const toX = (A: R, u: number) => A.x + A.w / 2 + u * A.w * 0.42;
export const fromX = (A: R, x: number) => Math.max(-1, Math.min(1, (x - A.x - A.w / 2) / (A.w * 0.42)));
/** 상자 자리 0 · 1 · 2 의 가운데 x · 바닥 y · 상자 크기 */
export const boxSpot = (A: R, slot: number) => ({ x: A.x + A.w * (0.2 + slot * 0.3), y: A.y + A.h * 0.78, w: Math.min(A.w * 0.22, A.h * 0.36) });
/** 판 x 에 가장 가까운 상자 자리 */
export const slotAt = (A: R, x: number) => [0, 1, 2].sort((a, b) => Math.abs(boxSpot(A, a).x - x) - Math.abs(boxSpot(A, b).x - x))[0];

export function drawToyGame(ctx: CanvasRenderingContext2D, card: R, g: ToyGame, pose: Pose, res: ToyResult, t: number, touch: boolean) {
  const { area: A, ok } = toyLayout(card);
  // 카드 · 제목 · 진행
  ctx.fillStyle = '#fffaf0';
  ctx.beginPath();
  ctx.roundRect(card.x, card.y, card.w, card.h, 28);
  ctx.fill();
  const cx = card.x + card.w / 2;
  const toy = TOYS[g.id];
  ctx.textAlign = 'center';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, `${toy.emoji} ${toy.name}`, cx, card.y + 46, card.w - 40, 28, 'bold ');
  const prog =
    g.id === 'feather'
      ? `남은 ${Math.max(0, Math.ceil(FEATHER.time - g.t))}초 · 잡았다 ${g.score}`
      : g.id === 'box'
        ? `${Math.min(BOX.rounds, g.round + 1)} / ${BOX.rounds}판 · 맞힘 ${g.score}`
        : `${Math.min(YARN.throws, g.n + 1)} / ${YARN.throws}번째 · 맞힘 ${g.score}`;
  ctx.fillStyle = '#9a7b62';
  fitText(ctx, prog, cx, card.y + 76, card.w - 40, 17, 'bold ');
  // 놀이판 바닥
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(A.x, A.y, A.w, A.h, 20);
  ctx.clip();
  const sky = ctx.createLinearGradient(0, A.y, 0, A.y + A.h);
  sky.addColorStop(0, '#fff3dc');
  sky.addColorStop(0.62, '#fbe6c4');
  sky.addColorStop(0.63, '#cfe7a8');
  sky.addColorStop(1, '#b9db8e');
  ctx.fillStyle = sky;
  ctx.fillRect(A.x, A.y, A.w, A.h);
  if (g.id === 'feather') drawFeather(ctx, A, g, pose, t);
  else if (g.id === 'box') drawBoxes(ctx, A, g, pose, t);
  else drawYarn(ctx, A, g, pose, t);
  ctx.restore();
  // 안내 · 결과
  ctx.textAlign = 'center';
  if (g.phase === 'play') {
    ctx.fillStyle = '#5b4a3f';
    fitText(ctx, hint(g, touch), cx, card.y + card.h - 62, card.w - 40, 19, 'bold ');
    ctx.fillStyle = '#b09a85';
    fitText(ctx, touch ? '✕ 그만하기는 창 밖을 눌러요' : 'Esc 그만하기', cx, card.y + card.h - 30, card.w - 40, 14, '');
    return;
  }
  // 끝: 별 · 대사 · 얻은 것 · 확인
  ctx.fillStyle = 'rgba(255, 250, 240, 0.9)';
  ctx.fillRect(A.x, A.y + A.h * 0.38, A.w, A.h * 0.62);
  ctx.font = 'bold 46px system-ui, sans-serif';
  ctx.fillStyle = '#ffc93a';
  ctx.fillText('★'.repeat(g.stars) + '☆'.repeat(3 - g.stars), cx, A.y + A.h * 0.55);
  if (res) {
    ctx.fillStyle = '#5b4a3f';
    fitText(ctx, `“${res.line}”`, cx, A.y + A.h * 0.55 + 42, A.w - 30, 20, 'bold ');
    const got = [`+${res.gain} 친해짐`, ...(res.fav ? ['❤ 좋아하는 놀이'] : []), ...(res.coins ? [`냥코인 +${res.coins}`] : [])].join(' · ');
    ctx.fillStyle = '#c0582c';
    fitText(ctx, got, cx, A.y + A.h * 0.55 + 74, A.w - 30, 18, 'bold ');
  }
  button(ctx, ok, '좋아요', 'main');
}

function hint(g: ToyGame, touch: boolean) {
  if (g.id === 'feather') {
    if (g.cat === 'crouch') return '지금! 깃털을 멈춰요 — 덮친다!';
    if (g.cat === 'catch') return '잡았다!';
    if (g.cat === 'miss') return '앗, 놓쳤어요. 다시 흔들어요';
    return touch ? '친구 앞에서 깃털을 좌우로 흔들어요 (화면을 문질러요)' : '마우스를 좌우로 · A D 로 깃털을 흔들어요';
  }
  if (g.id === 'box') {
    if (g.stage === 'show') return '어느 상자에 숨는지 잘 봐요';
    if (g.stage === 'shuffle') return '섞는 중… 눈을 떼지 마요';
    if (g.stage === 'pick') return touch ? '어느 상자일까? 눌러서 열어요' : '어느 상자일까? 1 · 2 · 3 또는 ← → Space';
    return g.right ? '찾았다!' : '여기 없네… 저기 있었어요';
  }
  if (g.stage === 'aim') return touch ? '친구 앞 노란 칸에 맞게 — 눌러서 굴려요' : '친구 앞 노란 칸에 맞게 — Space 로 굴려요';
  if (g.stage === 'roll') return '데굴데굴…';
  return g.res === 'hit' ? '덮쳤다!' : '아쉬워요… 다음엔 꼭!'; // 짧다 · 길다를 따지지 않고 (2026-10-12 사용자 — 그냥 아쉬운 느낌으로)
}
/** 작은 말풍선 — 꼬리(len) 끝이 (x, y), 판 안으로 당긴다 */
function tip(ctx: CanvasRenderingContext2D, A: R, x: number, y: number, text: string, t: number, len = 10) {
  ctx.font = 'bold 16px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 24;
  const h = 32;
  const bx = Math.max(A.x + 6, Math.min(A.x + A.w - 6 - w, x - w / 2));
  const by = Math.max(A.y + 4, y - len - h - Math.abs(Math.sin(t * 5)) * 4);
  const tx = Math.max(bx + 14, Math.min(bx + w - 14, x));
  ctx.fillStyle = '#fffdf6';
  ctx.strokeStyle = '#ef6b5e';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 12);
  ctx.moveTo(tx - 6, by + h);
  ctx.lineTo(tx, y);
  ctx.lineTo(tx + 6, by + h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d4483b';
  ctx.textAlign = 'center';
  ctx.fillText(text, bx + w / 2, by + h / 2 + 6);
}

// ── 깃털 ──
function drawFeather(ctx: CanvasRenderingContext2D, A: R, g: FeatherGame, pose: Pose, t: number) {
  const ground = A.y + A.h * 0.86;
  const H = A.h * 0.42;
  // 신남 게이지 (위)
  const gw = A.w * 0.46;
  const gx = A.x + (A.w - gw) / 2;
  const gy = A.y + 16;
  ctx.fillStyle = 'rgba(120,85,55,0.15)';
  ctx.beginPath();
  ctx.roundRect(gx, gy, gw, 16, 8);
  ctx.fill();
  ctx.fillStyle = g.cat === 'crouch' ? '#ef6b5e' : '#ffb04a';
  ctx.beginPath();
  ctx.roundRect(gx, gy, Math.max(16, gw * g.ex), 16, 8);
  ctx.fill();
  ctx.font = '18px "Segoe UI Emoji", system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#000';
  ctx.fillText('😺', gx - 6, gy + 15);
  // 친구 — 보기 · 씰룩(엉덩이 흔들기) · 덮치기(포물선) · 잡음(뒹굴) · 놓침(한숨)
  const x = toX(A, g.catX);
  const flip = g.fx >= g.catX ? 1 : -1;
  let y = ground;
  let anim = 'idle';
  let frame = Math.floor(t * 4) % 6;
  let dx = 0;
  let tilt = 0;
  if (g.cat === 'crouch') [anim, frame, dx] = ['bored', 3, Math.sin(t * 34) * 3];
  else if (g.cat === 'pounce') {
    // 대기 컷을 포물선 따라 기울인다 — 오를 땐 코가 위로, 내릴 땐 아래로
    const k = Math.min(1, g.ct / FEATHER.pounce);
    [anim, frame, tilt] = ['idle', 0, -0.45 * flip * Math.cos(k * Math.PI)];
    y -= Math.sin(k * Math.PI) * A.h * 0.28;
  } else if (g.cat === 'catch') [anim, frame] = ['affection', 3 + (Math.floor(t * 5) % 2)];
  else if (g.cat === 'miss') [anim, frame] = ['bored', g.ct < 0.45 ? 1 : 5]; // "…" → 한숨 (기지개 컷은 씰룩과 같아 보여서 안 쓴다)
  ctx.fillStyle = 'rgba(60,45,30,0.2)';
  ctx.beginPath();
  ctx.ellipse(x, ground, H * 0.32, H * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.translate(x + dx, y - H * 0.4);
  ctx.rotate(tilt);
  pose(ctx, 0, H * 0.4, H, anim, frame, flip);
  ctx.restore();
  if (g.cat === 'crouch' && g.misses < FEATHER.tip) {
    // 씰룩 "!" (두 번 놓친 뒤엔 그 자리에 말풍선)
    ctx.font = `bold ${Math.round(H * 0.32)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ef6b5e';
    ctx.fillText('!', x, ground - H * 1.05 + Math.sin(t * 20) * 3);
  }
  // 깃털 낚싯대: 위에서 늘어진 줄 끝에 깃털 (잡히면 친구 품으로)
  const caught = g.cat === 'catch';
  const fx = caught ? x + flip * H * 0.12 : toX(A, g.fx);
  const fy = caught ? ground - H * 0.35 : ground - H * 0.62 + Math.sin(t * 3) * 4;
  const sway = Math.max(-0.6, Math.min(0.6, -g.vx * 0.12));
  ctx.strokeStyle = 'rgba(90,70,50,0.7)';
  ctx.lineWidth = 2;
  if (!caught) {
    ctx.beginPath();
    ctx.moveTo(fx - sway * 40, A.y);
    ctx.quadraticCurveTo(fx - sway * 30, (A.y + fy) / 2, fx, fy - 10);
    ctx.stroke();
  }
  ctx.save();
  ctx.translate(fx, fy - 10);
  ctx.rotate(sway + Math.sin(t * 6) * 0.1);
  const vane = ctx.createLinearGradient(0, 0, 0, 46);
  vane.addColorStop(0, '#ff8fc8');
  vane.addColorStop(1, '#a66cff');
  ctx.fillStyle = vane;
  ctx.beginPath();
  ctx.moveTo(0, 4);
  ctx.bezierCurveTo(17, 12, 15, 36, 1, 48);
  ctx.bezierCurveTo(-15, 36, -16, 12, 0, 4);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(0, 12 + i * 7);
    ctx.lineTo(-9 + i * 0.6, 17 + i * 7);
    ctx.moveTo(0, 12 + i * 7);
    ctx.lineTo(9 - i * 0.6, 17 + i * 7);
    ctx.stroke();
  }
  ctx.strokeStyle = '#8a5f34';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 50);
  ctx.stroke();
  ctx.restore();
  // 두 번 놓치면 씰룩일 때 깃털 위에 "지금 멈추세요!"
  if (g.cat === 'crouch' && g.misses >= FEATHER.tip) tip(ctx, A, fx, fy - 14, '지금 멈추세요!', t, H * 0.3);
}

// ── 상자 ──
function drawBoxes(ctx: CanvasRenderingContext2D, A: R, g: BoxGame, pose: Pose, t: number) {
  const sw = swapNow(g);
  const ease = (k: number) => k * k * (3 - 2 * k);
  const H = A.h * 0.38;
  // 상자마다 지금 자리 (섞는 중이면 둘이 반대 높이로 원을 그리며 바뀐다)
  const at = (id: number) => {
    const s = g.slots[id];
    const p = boxSpot(A, s);
    if (sw && (s === sw.a || s === sw.b)) {
      const q = boxSpot(A, s === sw.a ? sw.b : sw.a);
      const k = ease(sw.k);
      return { x: p.x + (q.x - p.x) * k, y: p.y + (s === sw.a ? -1 : 1) * Math.sin(k * Math.PI) * p.w * 0.35, w: p.w };
    }
    return p;
  };
  const order = [0, 1, 2].sort((a, b) => at(a).y - at(b).y);
  const opened = (id: number) => g.stage === 'reveal' && (g.slots[id] === g.picked || (id === g.cat && g.st > 0.5));
  for (const id of order) {
    const p = at(id);
    const bw = p.w;
    const bh = bw * 0.78;
    const top = p.y - bh;
    // 친구: 처음엔 상자 위에서 쏙 들어가고, 열면 튀어나온다 (상자 앞면이 아래를 가린다)
    const catIn = id === g.cat;
    let catY: number | null = null;
    let anim = 'idle';
    let frame = Math.floor(t * 4) % 6;
    if (catIn && g.stage === 'show') {
      const k = Math.min(1, g.st / BOX.show);
      catY = top + (k < 0.45 ? 0 : ((k - 0.45) / 0.55) * H * 0.95);
      [anim, frame] = ['idle', k < 0.45 ? 2 : 0];
    } else if (catIn && opened(id)) {
      const k = Math.min(1, (g.stage === 'reveal' ? g.st - (g.slots[id] === g.picked ? 0 : 0.5) : 0) / 0.35);
      catY = top + H * 0.95 * (1 - k);
      [anim, frame] = g.right ? ['affection', Math.floor(t * 5) % 6] : ['idle', 1];
    }
    if (catY !== null) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x - bw, A.y, bw * 2, top - A.y + bh * 0.25);
      ctx.clip();
      pose(ctx, p.x, catY, H, anim, frame, 1);
      ctx.restore();
    }
    // 상자 (뚜껑 · 몸 · 테이프) — 고르는 칸은 테두리
    const sel = g.stage === 'pick' && g.sel === g.slots[id];
    ctx.fillStyle = 'rgba(60,45,30,0.2)';
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, bw * 0.55, bw * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c99556';
    ctx.strokeStyle = sel ? '#ef6b5e' : '#8a5f34';
    ctx.lineWidth = sel ? 5 : 3;
    ctx.beginPath();
    ctx.roundRect(p.x - bw / 2, top, bw, bh, 6);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#e0b073';
    const lid = opened(id) ? -0.9 : 0;
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.translate(p.x + (side * bw) / 2, top);
      ctx.rotate(side * lid);
      ctx.fillRect(side > 0 ? -bw / 2 : 0, -bh * 0.18, bw / 2, bh * 0.18);
      ctx.restore();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(p.x - bw * 0.08, top, bw * 0.16, bh);
    // 번호 (키보드)
    if (g.stage === 'pick') {
      ctx.fillStyle = sel ? '#ef6b5e' : '#8a5f34';
      ctx.font = `bold ${Math.round(bw * 0.22)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(String(g.slots[id] + 1), p.x, top + bh * 0.65);
    }
    // 틀린 상자: 먼지
    if (g.stage === 'reveal' && !g.right && g.slots[id] === g.picked) {
      ctx.fillStyle = 'rgba(160,140,120,0.5)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(p.x + (i - 1.5) * bw * 0.18, top - 8 - ((g.st * 30 + i * 9) % 26), 5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

// ── 털실 공 ──
function drawYarn(ctx: CanvasRenderingContext2D, A: R, g: YarnGame, pose: Pose, t: number) {
  const ground = A.y + A.h * 0.7;
  const x0 = A.x + 44;
  const W = A.w - 80;
  const H = A.h * 0.36;
  // 친구 앞 칸 (노란)
  const z0 = x0 + (g.spot - g.zone / 2) * W;
  ctx.fillStyle = 'rgba(255, 210, 58, 0.55)';
  ctx.beginPath();
  ctx.roundRect(z0, ground - 6, g.zone * W, 18, 9);
  ctx.fill();
  // 친구 — 칸 바로 뒤 (공이 칸에 서면 덮친다)
  const fxp = x0 + g.spot * W;
  let anim = 'idle';
  let frame = Math.floor(t * 4) % 6;
  if (g.stage === 'after' && g.res === 'hit') [anim, frame] = ['affection', Math.floor(t * 5) % 6];
  else if (g.stage === 'after') [anim, frame] = ['bored', g.st < 0.45 ? 1 : 5]; // 아쉬워서 "…" → 한숨
  pose(ctx, fxp + W * 0.04, ground - 2, H, anim, frame, -1);
  // 공 — 굴러가며 돌고 지나온 자리에 실이 풀린다 (덮치면 친구 품에)
  const d = ballAt(g);
  const bx = g.stage === 'after' && g.res === 'hit' ? fxp - W * 0.03 : x0 + d * W;
  const r = 14;
  ctx.strokeStyle = '#e0a521';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, ground - 3);
  for (let x = x0; x < bx - r * 0.6; x += 8) ctx.lineTo(x + 4, ground - 3 + Math.sin(x * 0.35) * 2);
  ctx.lineTo(bx, ground - r * 0.4);
  ctx.stroke();
  ctx.save();
  ctx.translate(bx, ground - r + 2);
  ctx.fillStyle = '#ffd23a';
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.rotate((d * W) / r);
  ctx.strokeStyle = '#d89a1a';
  ctx.lineWidth = 1.6;
  for (const a of [0.5, -1]) {
    ctx.save();
    ctx.rotate(a);
    for (let k = -2; k <= 2; k++) {
      ctx.beginPath();
      ctx.ellipse(0, k * r * 0.4, r * 1.15, r * 0.3, 0, 0, Math.PI);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = '#b87d12';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // 발바닥 (던지는 자리)
  ctx.font = '26px "Segoe UI Emoji", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#000';
  ctx.fillText('🐾', x0 - 22, ground + 2);
  // 힘 막대 (아래) — 칸과 같은 자리를 노랗게
  const by = ground + 34;
  ctx.fillStyle = 'rgba(120,85,55,0.15)';
  ctx.beginPath();
  ctx.roundRect(x0, by, W, 22, 11);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 210, 58, 0.85)';
  ctx.fillRect(z0, by + 3, g.zone * W, 16);
  const px = x0 + (g.stage === 'aim' ? g.power : g.dist) * W;
  ctx.fillStyle = '#5b4a3f';
  ctx.beginPath();
  ctx.moveTo(px, by - 2);
  ctx.lineTo(px - 9, by - 16);
  ctx.lineTo(px + 9, by - 16);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(px - 2, by - 2, 4, 26);
}
