// 화면 크기 대응 · 터치 조작. 좌표는 전부 CSS px (캔버스 실제 픽셀이 아니라) — 포인터 좌표와 바로 맞댄다.
//  - ui(): 화면이 작으면 HUD·버튼을 줄이고 크면 키우는 배율
//  - safe(): 노치·홈 막대를 피할 여백 (CSS env(safe-area-inset-*))
//  - 터치 조작: 왼쪽 아래 영역의 떠다니는 조이스틱(필드·던전·미로 — 그 영역 어디를 눌러도 그 자리에 생긴다), 던전 오른쪽 아래 구르기 버튼 (냥펀치는 자동),
//    샌드보드 ◀ · 점프 · ▶. 모서리에 붙이지 않고 화면 크기에 비례해 조금 안쪽으로 (2026-10-07 사용자 요청 — 엄지로 누르기 편하게)
//  - 필드 도감 버튼은 터치가 아니어도 보인다 (마우스로도 누른다)

/** HUD 배율 — 짧은 변이 500px 보다 좁은 화면(휴대폰)에서만 조금 줄인다 (최소 0.85 — 예전 0.7 은 휴대폰에서 너무 작았다). 데스크톱·태블릿은 1 */
export const ui = (w: number, h: number) => Math.max(0.85, Math.min(1, Math.min(w, h) / 500));

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** 조작이 화면 모서리에서 떨어진 거리 (CSS px) — 화면이 클수록 조금 더 안쪽. 가운데로 모으는 게 아니라 구석을 피하는 만큼 */
export const inset = (w: number, h: number) => ({ x: clamp(w * 0.09, 28, 110), y: clamp(h * 0.09, 22, 80) });

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

export type ButtonId = 'dash' | 'dex' | 'bag' | 'jump' | 'left' | 'right';
export type Button = { id: ButtonId; x: number; y: number; r: number; label: string };
/** 떠다니는 조이스틱: 쉬는 자리(x, y) · 반지름 r · 누르면 조이스틱이 생기는 영역 zone (CSS px) */
export type Stick = { x: number; y: number; r: number; zone: { x0: number; y0: number; x1: number; y1: number } };
/** k = HUD 배율 (그리기용) */
export type Controls = { stick: Stick | null; buttons: Button[]; k: number };
export type Scene = 'field' | 'dungeon' | 'fishing' | 'maze' | 'sandboard' | 'timber';

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
  if (scene === 'dungeon') pill('bag', 0, 122, '🎒 가방'); // 체력·경험치 판(14, 14, 높이 100) 밑
  if (!touch || scene === 'fishing') return { stick: null, buttons, k };
  // 엄지로 누르는 것들은 모서리에서 조금 안쪽으로 (inset)
  const r = Math.round(60 * k);
  const ins = inset(w, h);
  const portrait = h > w;
  const pr = Math.round(48 * k);
  const px = w - s.r - ins.x - pr;
  const py = h - s.b - ins.y - pr;
  if (scene === 'dungeon') buttons.push({ id: 'dash', x: px, y: py, r: pr, label: '구르기' }); // 냥펀치는 자동
  if (scene === 'sandboard') {
    // 샌드보드는 좌우만 — ◀ (왼쪽) · 점프 (가운데) · ▶ (오른쪽), 한 줄로 (2026-10-07 사용자 요청)
    const ar = Math.round(46 * k);
    const jr = Math.round(50 * k);
    const y = h - s.b - ins.y - jr;
    buttons.push({ id: 'left', x: s.l + ins.x + ar, y, r: ar, label: '◀' });
    buttons.push({ id: 'jump', x: (s.l + w - s.r) / 2, y, r: jr, label: '점프' });
    buttons.push({ id: 'right', x: w - s.r - ins.x - ar, y, r: ar, label: '▶' });
    return { stick: null, buttons, k };
  }
  if (scene === 'timber') {
    // 장작 패기는 ◀ · ▶ 두 개 (화면 왼쪽 · 오른쪽 절반을 눌러도 그쪽에서 팬다)
    const ar = Math.round(52 * k);
    const y = h - s.b - ins.y - ar;
    buttons.push({ id: 'left', x: s.l + ins.x + ar, y, r: ar, label: '◀' });
    buttons.push({ id: 'right', x: w - s.r - ins.x - ar, y, r: ar, label: '▶' });
    return { stick: null, buttons, k };
  }
  // 조이스틱은 쉬는 자리에 옅게 떠 있고, 왼쪽 아래 영역 어디를 눌러도 그 자리에 생긴다 (가로: 왼쪽 절반 · 아래 62%, 세로: 왼쪽 62% · 아래 절반)
  const stick: Stick = {
    x: s.l + ins.x + r,
    y: h - s.b - ins.y - r,
    r,
    zone: { x0: s.l, y0: h * (portrait ? 0.5 : 0.38), x1: w * (portrait ? 0.62 : 0.5), y1: h - s.b },
  };
  return { stick, buttons, k };
}

/** 둥근 버튼은 조금 넉넉하게, 도감 알약은 그 모양 그대로 */
export const buttonAt = (c: Controls, x: number, y: number) =>
  c.buttons.find((b) =>
    b.id === 'dex' || b.id === 'bag' ? Math.abs(x - b.x) <= b.r && Math.abs(y - b.y) <= (b.r * DEX.h) / DEX.w : Math.hypot(x - b.x, y - b.y) <= b.r * 1.2,
  ) ?? null;
/** 조이스틱 영역 안인가 (쉬는 자리 둘레도 넉넉하게 — 엄지가 조금 빗나가도) */
export const onStick = (c: Controls, x: number, y: number) => {
  const st = c.stick;
  if (!st) return false;
  const z = st.zone;
  return (x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) || Math.hypot(x - st.x, y - st.y) <= st.r * 1.8;
};
/** 누른 자리에 조이스틱을 놓는다 — 둘레가 화면 밖으로 나가지 않게 */
export function stickBase(c: Controls, x: number, y: number, w: number, h: number) {
  const r = c.stick!.r;
  const s = safe();
  return { bx: clamp(x, s.l + r * 0.7, w - s.r - r * 0.7), by: clamp(y, s.t + r * 0.7, h - s.b - r * 0.7) };
}
/** 손가락이 조이스틱 둘레(r) 밖으로 나가면 받침이 따라온다 — 방향을 바꿀 때 손가락을 다시 대지 않아도 되게 */
export function followStick(c: Controls, p: { x: number; y: number; bx: number; by: number }) {
  const r = c.stick!.r;
  const dx = p.x - p.bx;
  const dy = p.y - p.by;
  const d = Math.hypot(dx, dy);
  if (d > r) {
    p.bx = p.x - (dx / d) * r;
    p.by = p.y - (dy / d) * r;
  }
}

/** 조이스틱 방향 (-1..1). 받침(bx, by)에서 손가락(x, y)까지. 가운데 18% 는 안 움직인 것으로 */
export function stickVector(c: Controls, p: { x: number; y: number; bx: number; by: number }) {
  if (!c.stick) return { mx: 0, my: 0, kx: 0, ky: 0 };
  let dx = (p.x - p.bx) / c.stick.r;
  let dy = (p.y - p.by) / c.stick.r;
  const d = Math.hypot(dx, dy);
  if (d > 1) [dx, dy] = [dx / d, dy / d];
  return d < 0.18 ? { mx: 0, my: 0, kx: dx, ky: dy } : { mx: dx, my: dy, kx: dx, ky: dy };
}

/**
 * ctx 는 CSS px 좌표계로 맞춘 상태로. held = 쥐고 있는 조이스틱(받침 자리 bx, by · 손잡이 kx, ky) — 없으면 쉬는 자리에 옅게.
 * pressed = 누르고 있는 버튼
 */
export function drawControls(ctx: CanvasRenderingContext2D, c: Controls, held: { bx: number; by: number; kx: number; ky: number } | null, pressed: Set<ButtonId>) {
  const k = c.k;
  ctx.save();
  if (c.stick) {
    const r = c.stick.r;
    const x = held ? held.bx : c.stick.x;
    const y = held ? held.by : c.stick.y;
    ctx.globalAlpha = held ? 1 : 0.7;
    ctx.fillStyle = 'rgba(255,250,240,0.22)';
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    const kx = x + (held?.kx ?? 0) * r * 0.62;
    const ky = y + (held?.ky ?? 0) * r * 0.62;
    ctx.fillStyle = held ? 'rgba(255,250,240,0.95)' : 'rgba(255,250,240,0.7)';
    ctx.strokeStyle = 'rgba(120,85,55,0.45)';
    ctx.beginPath();
    ctx.arc(kx, ky, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
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
    ctx.font = `bold ${Math.round(b.r * (b.id === 'left' || b.id === 'right' ? 0.62 : 0.36))}px system-ui, sans-serif`;
    ctx.fillText(b.label, b.x, b.y + b.r * 0.13);
  }
  ctx.restore();
}
