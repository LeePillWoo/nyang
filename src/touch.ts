// 화면 크기 대응 · 터치 조작. 좌표는 전부 CSS px (캔버스 실제 픽셀이 아니라) — 포인터 좌표와 바로 맞댄다.
//  - ui(): 화면이 작으면 HUD·버튼을 줄이고 크면 키우는 배율
//  - safe(): 노치·홈 막대를 피할 여백 (CSS env(safe-area-inset-*))
//  - 터치 조작: 왼쪽 아래 동그란 조이스틱(필드·던전), 던전 오른쪽 아래 냥펀치·구르기 버튼
//  - 필드 도감 버튼은 터치가 아니어도 보인다 (마우스로도 누른다)

/** HUD 배율 — 짧은 변이 560px 보다 좁은 화면(휴대폰)에서만 줄인다. 데스크톱·태블릿은 1 (예전 그대로) */
export const ui = (w: number, h: number) => Math.max(0.7, Math.min(1, Math.min(w, h) / 560));

const probe = document.createElement('div');
probe.style.cssText =
  'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
document.body.appendChild(probe);
/** 노치·홈 막대 여백 (CSS px) */
export function safe() {
  const s = getComputedStyle(probe);
  return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 };
}

/** 칸 폭을 넘으면 글자를 줄인다 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, px: number, bold = '') {
  ctx.font = `${bold}${px}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) ctx.font = `${bold}${Math.floor((px * maxW) / w)}px system-ui, sans-serif`;
  ctx.fillText(text, x, y);
}

/** 폭 maxW 로 줄바꿈 (띄어쓰기에서, 한 낱말이 너무 길면 글자에서). ctx.font 를 먼저 맞춰 둔다 */
export function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? line + ' ' + word : word;
    if (ctx.measureText(next).width <= maxW) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = '';
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > maxW && line) {
        lines.push(line);
        line = '';
      }
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export type ButtonId = 'punch' | 'dash' | 'dex' | 'bag';
export type Button = { id: ButtonId; x: number; y: number; r: number; label: string };
/** k = HUD 배율 (그리기용) */
export type Controls = { stick: { x: number; y: number; r: number } | null; buttons: Button[]; k: number };
export type Scene = 'field' | 'dungeon' | 'fishing';

/** 도감 버튼 (알약) 크기 — Button.r 은 폭의 절반 */
const DEX = { w: 84, h: 36 };

/** 이 화면·장면에서 조이스틱과 버튼 자리 */
export function controls(w: number, h: number, scene: Scene, touch: boolean): Controls {
  const k = ui(w, h);
  const s = safe();
  const buttons: Button[] = [];
  // 필드: 지역 이름표(14, 14, 높이 34) 밑 도감 · 가방 버튼, 던전: 체력 판(14, 14, 높이 78) 밑 가방 버튼 — 마우스로도 누른다
  const pill = (id: ButtonId, col: number, top: number, label: string) =>
    buttons.push({ id, x: s.l + (14 + col * (DEX.w + 8) + DEX.w / 2) * k, y: s.t + (top + DEX.h / 2) * k, r: (DEX.w / 2) * k, label });
  if (scene === 'field') {
    pill('dex', 0, 56, '📖 도감');
    pill('bag', 1, 56, '🎒 가방');
  }
  if (scene === 'dungeon') pill('bag', 0, 100, '🎒 가방');
  if (!touch || scene === 'fishing') return { stick: null, buttons, k };
  // 엄지로 누르는 것들은 휴대폰에서도 너무 작아지지 않게
  const tk = Math.max(0.85, k);
  const r = Math.round(60 * tk);
  const pad = 26 * tk;
  const stick = { x: s.l + pad + r, y: h - s.b - pad - r, r };
  if (scene === 'dungeon') {
    const pr = Math.round(48 * tk);
    const px = w - s.r - pad - pr;
    const py = h - s.b - pad - pr;
    buttons.push({ id: 'punch', x: px, y: py, r: pr, label: '냥펀치' });
    buttons.push({ id: 'dash', x: px - pr * 1.95, y: py + pr * 0.28, r: pr * 0.72, label: '구르기' });
  }
  return { stick, buttons, k };
}

/** 둥근 버튼은 조금 넉넉하게, 도감 알약은 그 모양 그대로 */
export const buttonAt = (c: Controls, x: number, y: number) =>
  c.buttons.find((b) =>
    b.id === 'dex' || b.id === 'bag' ? Math.abs(x - b.x) <= b.r && Math.abs(y - b.y) <= (b.r * DEX.h) / DEX.w : Math.hypot(x - b.x, y - b.y) <= b.r * 1.2,
  ) ?? null;
/** 조이스틱 둘레를 넉넉하게 잡는다 (엄지가 조금 빗나가도) */
export const onStick = (c: Controls, x: number, y: number) => !!c.stick && Math.hypot(x - c.stick.x, y - c.stick.y) <= c.stick.r * 1.8;

/** 조이스틱 방향 (-1..1). 가운데 18% 는 안 움직인 것으로 */
export function stickVector(c: Controls, x: number, y: number) {
  if (!c.stick) return { mx: 0, my: 0, kx: 0, ky: 0 };
  let dx = (x - c.stick.x) / c.stick.r;
  let dy = (y - c.stick.y) / c.stick.r;
  const d = Math.hypot(dx, dy);
  if (d > 1) [dx, dy] = [dx / d, dy / d];
  return d < 0.18 ? { mx: 0, my: 0, kx: dx, ky: dy } : { mx: dx, my: dy, kx: dx, ky: dy };
}

/** ctx 는 CSS px 좌표계로 맞춘 상태로. knob = 조이스틱 손잡이 위치(-1..1), pressed = 누르고 있는 버튼 */
export function drawControls(ctx: CanvasRenderingContext2D, c: Controls, knob: { kx: number; ky: number } | null, pressed: Set<ButtonId>) {
  const k = c.k;
  ctx.save();
  if (c.stick) {
    const { x, y, r } = c.stick;
    ctx.fillStyle = 'rgba(255,250,240,0.22)';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const kx = x + (knob?.kx ?? 0) * r * 0.62;
    const ky = y + (knob?.ky ?? 0) * r * 0.62;
    ctx.fillStyle = knob ? 'rgba(255,250,240,0.95)' : 'rgba(255,250,240,0.7)';
    ctx.strokeStyle = 'rgba(120,85,55,0.45)';
    ctx.beginPath();
    ctx.arc(kx, ky, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  for (const b of c.buttons) {
    const on = pressed.has(b.id);
    if (b.id === 'dex' || b.id === 'bag') {
      // 도감: 이름표 같은 알약
      const w = DEX.w * k;
      const h = DEX.h * k;
      ctx.fillStyle = on ? 'rgba(255,255,255,0.98)' : 'rgba(255,250,240,0.85)';
      ctx.beginPath();
      ctx.roundRect(b.x - w / 2, b.y - h / 2, w, h, h / 2);
      ctx.fill();
      ctx.fillStyle = '#5b4a3f';
      ctx.font = `bold ${15 * k}px system-ui, sans-serif`;
      ctx.fillText(b.label, b.x, b.y + 5 * k);
      continue;
    }
    ctx.fillStyle = on ? 'rgba(240,138,60,0.95)' : 'rgba(255,250,240,0.8)';
    ctx.strokeStyle = 'rgba(120,85,55,0.4)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = on ? '#fff' : '#5b4a3f';
    ctx.font = `bold ${Math.round(b.r * 0.36)}px system-ui, sans-serif`;
    ctx.fillText(b.label, b.x, b.y + b.r * 0.13);
  }
  ctx.restore();
}

/** 세로 화면 안내 (막지는 않는다) — 이름표·도감 버튼·미니맵 밑 */
export function drawRotateHint(ctx: CanvasRenderingContext2D, w: number) {
  const s = safe();
  const text = '📱 가로로 돌리면 더 넓게 보여요';
  ctx.save();
  ctx.font = 'bold 12px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 24;
  const y = s.t + 110;
  ctx.fillStyle = 'rgba(70,52,42,0.78)';
  ctx.beginPath();
  ctx.roundRect(w / 2 - tw / 2, y, tw, 30, 15);
  ctx.fill();
  ctx.fillStyle = '#fff6d8';
  ctx.textAlign = 'center';
  ctx.fillText(text, w / 2, y + 20);
  ctx.restore();
}
