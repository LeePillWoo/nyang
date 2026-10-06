// 던전 기술 그리기 — 기술 효과(art/effects/skills_8x8 — 128px 8×8 균등 격자, 동작 이름은 src/data/skill-fx.json),
// 생선뼈·생선 비스킷, 몬스터 등장 예고, 정예 표시, 기술에 걸린 몬스터(묶임·기절), 레벨 업 카드, HUD(경험치·가진 기술·웨이브).
// 좌표는 던전 그림 px (dungeon-draw.ts 가 방 배경과 같은 변환을 걸어 둔 상태). 로직은 skills.ts · dungeon.ts.
import { image } from './assets.ts';
import { drawIcon } from './bag-draw.ts';
import fxData from './data/skill-fx.json' with { type: 'json' };
import { WAVES, type Dungeon } from './dungeon.ts';
import type { Enemy } from './enemy.ts';
import { FAMILIES, FX_ANIMS, fxLife, lv, MAX_LV, need, orbitBoxes, SKILLS, SNACK, type Card, type SkillFx, type SkillId } from './skills.ts';
import { fitText, wrapText } from './touch.ts';

const CELL = fxData.cell;
const SHEETS = fxData.sheets as Record<string, string>;
const imgs = Object.fromEntries(Object.entries(SHEETS).map(([k, p]) => [k, image(p).img])) as Record<string, HTMLImageElement>;
/** 기술 효과 시트 5장 (던전에 들어갈 때 기다린다) */
export const skillFxReady = Promise.all(Object.values(SHEETS).map((p) => image(p).ready));

/** 효과 지름(m) 기본값 — 그림 속 효과는 칸의 약 78% 를 차지한다 */
const SIZE: Record<string, number> = {
  yarn_fly: 0.8, yarn_hit: 1.3, spool_boomerang: 0.95, thread_trail: 1.2, hairball_spit: 0.9, hairball_burst: 3, yarn_snare: 1.5, snare_release: 1.6,
  cloud_spawn: 3.6, cloud_idle: 3.6, zoom_trail: 2.2, green_flame: 0.95, tail_swirl: 4.4, wind_fragments: 3.2, paw_punch: 1.2, shock_ring: 4,
  box_spin: 0.85, box_hit: 1.2, fall_shadow: 2.6, box_land: 2.9, dizzy_stars: 0.9, loaf_shield: 2.1, shield_break: 2.3, hiss_wave: 4.8,
  red_dot: 0.7, target_spawn: 1.3, critical_hit: 1.7, pounce_land: 2, claw_slash: 1.4, clockwork_mouse: 0.95, mouse_burst: 2.2,
  xp_fishbone: 0.62, fishbone_pickup: 1, level_up: 2.4,
};
const FILL = 0.78;

type ToScreen = (x: number, z: number) => { sx: number; sy: number };
/** 그 자리에서 1m 가 화면 가로로 몇 px (아이소메트릭이라 화면 오른쪽 = 월드 (1, −1)/√2) */
function pxPerM(to: ToScreen, x: number, z: number) {
  const a = to(x, z);
  const b = to(x + Math.SQRT1_2, z - Math.SQRT1_2);
  return Math.hypot(b.sx - a.sx, b.sy - a.sy);
}
/** 월드 방향 (dx, dz) 의 화면 각도 */
const screenAngle = (to: ToScreen, x: number, z: number, dx: number, dz: number) => {
  const a = to(x, z);
  const b = to(x + dx * 0.5, z + dz * 0.5);
  return Math.atan2(b.sy - a.sy, b.sx - a.sx);
};

/** 효과 한 칸: 가운데 (cx, cy), 지름 sizePx. rot 라디안 · flip 좌우 */
function drawAnim(ctx: CanvasRenderingContext2D, anim: string, frame: number, cx: number, cy: number, sizePx: number, rot = 0, flip = 1, alpha = 1) {
  const a = FX_ANIMS[anim];
  if (!a) return;
  const [sheet, row] = a;
  const w = sizePx / FILL;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(cx, cy);
  if (rot) ctx.rotate(rot);
  if (flip < 0) ctx.scale(-1, 1);
  ctx.drawImage(imgs[sheet], (frame % 8) * CELL, row * CELL, CELL, CELL, -w / 2, -w / 2, w, w);
  ctx.restore();
}
/** 동작의 지금 칸 */
const frameAt = (anim: string, t: number) => {
  const a = FX_ANIMS[anim];
  const f = Math.floor(t * (a?.[2] ?? 10));
  return a?.[3] ? f % 8 : Math.min(7, f);
};
const isFloor = (anim: string) => FX_ANIMS[anim]?.[4] === 1;
const isRight = (anim: string) => FX_ANIMS[anim]?.[5] === 1;

/** 한 번 재생 효과 하나 */
function drawOne(ctx: CanvasRenderingContext2D, to: ToScreen, f: SkillFx) {
  const p = to(f.x, f.z);
  const m = pxPerM(to, f.x, f.z);
  const size = (f.size || SIZE[f.anim] || 1) * m;
  const fade = Math.min(1, (fxLife(f.anim) - f.t) / 0.15);
  drawAnim(ctx, f.anim, frameAt(f.anim, f.t), p.sx, p.sy - f.h * m * 1.4, size, isRight(f.anim) ? screenAngle(to, f.x, f.z, Math.cos(f.rot), Math.sin(f.rot)) : 0, f.flip, fade);
}

/** 바닥에 깔리는 것 (캐릭터보다 먼저): 캣닢 구름 · 불꽃 · 빨간 점 · 떨어질 상자 그림자 · 몬스터 등장 예고 · 정예 둘레 · 바닥 효과 */
export function drawSkillFloor(ctx: CanvasRenderingContext2D, d: Dungeon, t: number) {
  const to = d.room.toScreen;
  const P = d.P;
  const run = d.run;
  const cloud = lv(run, 'catnip_cloud');
  if (cloud) {
    const p = to(P.x, P.z);
    drawAnim(ctx, 'cloud_idle', frameAt('cloud_idle', t), p.sx, p.sy, (cloud.r as number) * 2 * 1.08 * pxPerM(to, P.x, P.z), 0, 1, 0.85);
  }
  for (const en of run.ents) {
    if (en.k === 'flame') {
      const p = to(en.x, en.z);
      const m = pxPerM(to, en.x, en.z);
      drawAnim(ctx, 'green_flame', frameAt('green_flame', t + en.x), p.sx, p.sy - 0.35 * m * 1.4, SIZE.green_flame * m, 0, 1, Math.min(1, en.life / 0.4));
    } else if (en.k === 'dot') {
      const p = to(en.x, en.z);
      drawAnim(ctx, 'red_dot', frameAt('red_dot', t), p.sx, p.sy, SIZE.red_dot * pxPerM(to, en.x, en.z));
    } else if (en.k === 'drop') {
      const p = to(en.x, en.z);
      const k = Math.min(1, en.t / en.T);
      drawAnim(ctx, 'fall_shadow', Math.min(7, Math.floor(k * 8)), p.sx, p.sy, en.r * 2 * pxPerM(to, en.x, en.z), 0, 1, 0.85);
    }
  }
  // 몬스터 등장 예고: 바닥에 소용돌이 원이 커진다
  for (const mk of d.wave?.marks ?? []) {
    const p = to(mk.x, mk.z);
    const m = pxPerM(to, mk.x, mk.z);
    const k = Math.min(1, mk.t / WAVES.telegraph);
    const r = (mk.elite ? 1.1 : 0.75) * m * (0.4 + 0.6 * k);
    ctx.save();
    ctx.fillStyle = mk.elite ? `rgba(255, 196, 64, ${0.18 + 0.3 * k})` : `rgba(90, 60, 110, ${0.15 + 0.3 * k})`;
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = mk.elite ? 'rgba(255, 230, 140, 0.9)' : 'rgba(255, 240, 255, 0.7)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.lineDashOffset = -t * 40;
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
  // 정예: 발밑에 금빛 둘레
  for (const e of d.enemies)
    if (e.elite && e.state !== 'pop') {
      const p = to(e.x, e.z);
      const r = e.def.size * 0.42;
      ctx.save();
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t * 5);
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, r, r * 0.38, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  for (const f of run.fx) if (isFloor(f.anim)) drawOne(ctx, to, f);
}

/** 캐릭터와 같이 앞뒤를 가려 그릴 것: 생선뼈·비스킷 · 빙글 상자 · 태엽 쥐 · 묶인 몬스터의 올가미 · 고양이 보호막 */
export function skillItems(d: Dungeon, t: number): { sy: number; go: (ctx: CanvasRenderingContext2D) => void }[] {
  const to = d.room.toScreen;
  const out: { sy: number; go: (ctx: CanvasRenderingContext2D) => void }[] = [];
  for (const b of d.bones) {
    const p = to(b.x, b.z);
    out.push({
      sy: p.sy,
      go: (ctx) => {
        const m = pxPerM(to, b.x, b.z);
        const bob = b.h > 0 ? 0 : Math.sin(t * 4 + b.x * 3) * 0.06;
        const y = p.sy - (b.h + 0.28 + bob) * m * 1.4;
        ctx.fillStyle = 'rgba(120, 85, 55, 0.22)';
        ctx.beginPath();
        ctx.ellipse(p.sx, p.sy, 0.22 * m, 0.08 * m, 0, 0, Math.PI * 2);
        ctx.fill();
        if (b.snack) {
          ctx.fillStyle = 'rgba(255, 200, 120, 0.35)';
          ctx.beginPath();
          ctx.arc(p.sx, y, 0.42 * m, 0, Math.PI * 2);
          ctx.fill();
          drawIcon(ctx, SNACK.item, p.sx, y, 0.7 * m);
        } else drawAnim(ctx, 'xp_fishbone', frameAt('xp_fishbone', t + b.x), p.sx, y, SIZE.xp_fishbone * m * (b.v > 1 ? 1.45 : 1));
      },
    });
  }
  const P = d.P;
  for (const b of orbitBoxes(d.run, P)) {
    const p = to(b.x, b.z);
    out.push({ sy: p.sy, go: (ctx) => drawAnim(ctx, 'box_spin', frameAt('box_spin', t * 1.5 + b.a), p.sx, p.sy - 0.55 * pxPerM(to, b.x, b.z) * 1.4, SIZE.box_spin * pxPerM(to, b.x, b.z)) });
  }
  for (const en of d.run.ents) {
    if (en.k === 'mouse') {
      const p = to(en.x, en.z);
      const flip = screenAngle(to, en.x, en.z, en.dx, en.dz);
      out.push({ sy: p.sy, go: (ctx) => drawAnim(ctx, 'clockwork_mouse', frameAt('clockwork_mouse', en.t), p.sx, p.sy - 0.3 * pxPerM(to, en.x, en.z) * 1.4, SIZE.clockwork_mouse * pxPerM(to, en.x, en.z), 0, Math.cos(flip) >= 0 ? 1 : -1) });
    } else if (en.k === 'snare' && en.e.state !== 'pop') {
      const e = en.e;
      const p = to(e.x, e.z);
      out.push({ sy: p.sy + 0.5, go: (ctx) => drawAnim(ctx, 'yarn_snare', frameAt('yarn_snare', t), p.sx, p.sy - e.def.size * 0.18, e.def.size * 0.62, 0, 1, 0.9) });
    }
  }
  if (d.run.shield > 0) {
    const p = to(P.x, P.z);
    out.push({ sy: p.sy + 0.5, go: (ctx) => drawAnim(ctx, 'loaf_shield', frameAt('loaf_shield', t), p.sx, p.sy - 0.75 * pxPerM(to, P.x, P.z) * 1.4, SIZE.loaf_shield * pxPerM(to, P.x, P.z), 0, 1, 0.5) });
  }
  return out;
}

/** 위에 뜨는 것 (캐릭터 뒤에): 털뭉치 · 실타래 · 헤어볼 · 떨어지는 상자 · 노림 표식 · 레이저 빔 · 기절 별 · 정예 이름 · 효과 */
export function drawSkillAir(ctx: CanvasRenderingContext2D, d: Dungeon, t: number) {
  const to = d.room.toScreen;
  const P = d.P;
  for (const en of d.run.ents) {
    switch (en.k) {
      case 'yarn': {
        const p = to(en.x, en.z);
        const m = pxPerM(to, en.x, en.z);
        drawAnim(ctx, 'yarn_fly', frameAt('yarn_fly', en.t), p.sx, p.sy - 0.8 * m * 1.4, SIZE.yarn_fly * m, screenAngle(to, en.x, en.z, en.dx, en.dz));
        break;
      }
      case 'spool': {
        const p = to(en.x, en.z);
        const m = pxPerM(to, en.x, en.z);
        drawAnim(ctx, 'spool_boomerang', frameAt('spool_boomerang', en.t * 1.6), p.sx, p.sy - 0.8 * m * 1.4, SIZE.spool_boomerang * m);
        break;
      }
      case 'hair': {
        const k = Math.min(1, en.t / en.T);
        const x = en.x0 + (en.x1 - en.x0) * k;
        const z = en.z0 + (en.z1 - en.z0) * k;
        const p = to(x, z);
        const m = pxPerM(to, x, z);
        const hgt = 0.6 + 2.2 * Math.sin(Math.PI * k);
        drawAnim(ctx, 'hairball_spit', Math.min(7, Math.floor(k * 8)), p.sx, p.sy - hgt * m * 1.4, SIZE.hairball_spit * m, screenAngle(to, x, z, en.x1 - en.x0, en.z1 - en.z0));
        break;
      }
      case 'drop': {
        const p = to(en.x, en.z);
        const m = pxPerM(to, en.x, en.z);
        const k = Math.min(1, en.t / en.T);
        const hgt = 7 * (1 - k * k);
        ctx.save();
        ctx.globalAlpha = Math.min(1, k * 3);
        drawAnim(ctx, 'box_spin', frameAt('box_spin', en.t * 2), p.sx, p.sy - (hgt + 0.4) * m * 1.4, SIZE.box_spin * m * 1.5);
        ctx.restore();
        break;
      }
      case 'mark': {
        if (en.e.state === 'pop') break;
        const p = to(en.e.x, en.e.z);
        drawAnim(ctx, 'target_spawn', Math.min(7, Math.floor((en.t / en.T) * 8)), p.sx, p.sy - en.e.def.size * 0.42, en.e.def.size * 0.7);
        break;
      }
      case 'dot': {
        // 레이저 빔: 고양이 앞발에서 점까지
        const a = to(P.x, P.z);
        const m = pxPerM(to, P.x, P.z);
        const ax = a.sx;
        const ay = a.sy - 0.9 * m * 1.4;
        const b = to(en.x, en.z);
        const len = Math.hypot(b.sx - ax, b.sy - ay);
        const [bx, by, bw, bh] = fxData.beam;
        const [sheet, row] = FX_ANIMS.laser_beam;
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.translate(ax, ay);
        ctx.rotate(Math.atan2(b.sy - ay, b.sx - ax));
        ctx.drawImage(imgs[sheet], (frameAt('laser_beam', t) % 8) * CELL + bx, row * CELL + by, bw, bh, 0, -5, len, 10);
        ctx.restore();
        break;
      }
    }
  }
  for (const e of d.enemies) {
    if (e.state === 'pop') continue;
    const p = to(e.x, e.z);
    if (e.stunT > 0) drawAnim(ctx, 'dizzy_stars', frameAt('dizzy_stars', t), p.sx, p.sy - e.def.size * 0.9, e.def.size * 0.42);
    if (e.elite) eliteTag(ctx, e, p.sx, p.sy);
  }
  for (const f of d.run.fx) if (!isFloor(f.anim)) drawOne(ctx, to, f);
}

function eliteTag(ctx: CanvasRenderingContext2D, e: Enemy, sx: number, sy: number) {
  const y = sy - e.def.size * 0.92 - 16;
  ctx.save();
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(86, 58, 44, 0.85)';
  ctx.strokeText(`👑 ${e.def.name}`, sx, y);
  ctx.fillStyle = '#ffd34d';
  ctx.fillText(`👑 ${e.def.name}`, sx, y);
  ctx.restore();
}

// ── HUD (dungeon-draw.ts 의 HUD 좌표 — 배율·노치 반영된 단위) ──

/** 체력 판 안: 레벨 + 경험치 막대 (x 14..250, y 80..100) */
export function drawXpBar(ctx: CanvasRenderingContext2D, d: Dungeon) {
  const run = d.run;
  ctx.font = 'bold 14px system-ui, sans-serif';
  ctx.fillStyle = '#5b4a3f';
  ctx.textAlign = 'left';
  ctx.fillText(`Lv ${run.level}`, 22, 101);
  ctx.fillStyle = '#e4d6c4';
  ctx.beginPath();
  ctx.roundRect(70, 90, 166, 12, 6);
  ctx.fill();
  ctx.fillStyle = '#f5c35a';
  ctx.beginPath();
  ctx.roundRect(70, 90, Math.max(12, (166 * run.xp) / need(run.level)), 12, 6);
  ctx.fill();
  drawAnim(ctx, 'xp_fishbone', 0, 70, 96, 22);
}

/** 오른쪽 위: 가진 기술 (아이콘 + 레벨 점) — 오른쪽 끝 x = right, 위 y = top */
export function drawSkillIcons(ctx: CanvasRenderingContext2D, d: Dungeon, right: number, top: number, t: number) {
  const owned = Object.entries(d.run.skills) as [SkillId, number][];
  const S = 42;
  const per = 6;
  owned.forEach(([id, n], i) => {
    const x = right - (S + 6) * ((i % per) + 1);
    const y = top + Math.floor(i / per) * (S + 14);
    const fam = FAMILIES[SKILLS[id].family];
    ctx.fillStyle = 'rgba(255,250,240,0.88)';
    ctx.strokeStyle = fam.color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(x, y, S, S, 10);
    ctx.fill();
    ctx.stroke();
    drawAnim(ctx, SKILLS[id].anim, iconFrame(SKILLS[id].anim, t), x + S / 2, y + S / 2, S * 0.78);
    for (let k = 0; k < MAX_LV; k++) {
      ctx.fillStyle = k < n ? fam.color : 'rgba(120,85,55,0.25)';
      ctx.beginPath();
      ctx.arc(x + 7 + k * 7, y + S + 5, 2.6, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}
/** 아이콘으로 보기 좋은 칸 (반복 동작은 돌고, 한 번 재생은 가운데 칸) */
const iconFrame = (anim: string, t: number) => (FX_ANIMS[anim]?.[3] ? frameAt(anim, t) : 4);

/** 가운데 위: 웨이브 n / 전체 · 남은 적 (방 이름 밑) + 웨이브 안내 큰 글자 */
export function drawWaveHud(ctx: CanvasRenderingContext2D, d: Dungeon, W: number, H: number, nameX: number, nameW: number) {
  const w = d.wave;
  if (!w) return;
  const left = d.enemies.filter((e) => e.state !== 'pop').length + w.marks.length + (w.state === 'done' ? 0 : w.queue.length);
  const text = w.state === 'done' ? '모든 웨이브 클리어!' : `웨이브 ${w.i + 1} / ${w.total} · 남은 적 ${left}`;
  ctx.font = 'bold 14px system-ui, sans-serif';
  const tw = ctx.measureText(text).width + 24;
  const cx = nameX + nameW / 2;
  ctx.fillStyle = 'rgba(70, 52, 42, 0.78)';
  ctx.beginPath();
  ctx.roundRect(cx - tw / 2, 50, tw, 26, 13);
  ctx.fill();
  ctx.fillStyle = '#fff6d8';
  ctx.textAlign = 'center';
  ctx.fillText(text, cx, 68);
  // 큰 안내: 웨이브 시작 · 웨이브 클리어
  let big = '';
  let a = 0;
  if (w.state === 'intro') {
    big = w.i === w.total - 1 ? `마지막 웨이브!` : `웨이브 ${w.i + 1}`;
    a = Math.min(1, w.t / 0.25, (WAVES.intro - w.t) / 0.35);
  } else if (w.state === 'break') {
    big = '웨이브 클리어!';
    a = Math.min(1, w.t / 0.25, (WAVES.break - w.t) / 0.4);
  }
  if (big && a > 0) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(70, 52, 42, 0.85)';
    ctx.strokeText(big, W / 2, H * 0.32);
    ctx.fillStyle = w.state === 'break' ? '#a8e07a' : w.i === w.total - 1 ? '#ffb35a' : '#ffd84a';
    ctx.fillText(big, W / 2, H * 0.32);
    if (w.state === 'intro' && w.i === w.total - 1) {
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.lineWidth = 6;
      ctx.strokeText('👑 정예가 나타나요', W / 2, H * 0.32 + 38);
      ctx.fillStyle = '#ffd34d';
      ctx.fillText('👑 정예가 나타나요', W / 2, H * 0.32 + 38);
    }
    ctx.restore();
  }
  ctx.textAlign = 'left';
}

// ── 레벨 업 카드 (CSS px — 화면 전체) ──

type R = { x: number; y: number; w: number; h: number };
/** 카드 자리: 폭 600 이상이면 가로로 3장 (240×320 을 화면에 맞게 줄인다 — s), 좁으면(세로 휴대폰) 세로로 쌓은 가로 카드 */
const CARD = { w: 240, h: 320, gap: 22 };
export function cardRects(w: number, h: number, n: number): { title: number; cards: R[]; wide: boolean; s: number } {
  const wide = w >= 600;
  if (wide) {
    const s = Math.min(1, (w - 60) / (n * CARD.w + (n - 1) * CARD.gap), (h - 116) / CARD.h);
    const cw = CARD.w * s;
    const ch = CARD.h * s;
    const gap = CARD.gap * s;
    const x0 = w / 2 - (n * cw + (n - 1) * gap) / 2;
    const y = h / 2 - ch / 2 + 34 * Math.min(1, s * 1.2);
    return { title: y - 50 * s - 6, wide, s, cards: Array.from({ length: n }, (_, i) => ({ x: x0 + i * (cw + gap), y, w: cw, h: ch })) };
  }
  const cw = Math.min(520, w - 32);
  const ch = Math.min(118, (h - 150) / n - 12);
  const y0 = h / 2 - (n * (ch + 12)) / 2 + 36;
  return { title: y0 - 48, wide, s: 1, cards: Array.from({ length: n }, (_, i) => ({ x: w / 2 - cw / 2, y: y0 + i * (ch + 12), w: cw, h: ch })) };
}
export const cardAt = (w: number, h: number, x: number, y: number, n: number) =>
  cardRects(w, h, n).cards.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);

/** 레벨 업 카드 (게임은 멈춰 있다). hover = 마우스가 올라간 카드 */
export function drawCards(ctx: CanvasRenderingContext2D, cw: number, ch: number, d: Dungeon, hover: number, t: number, touch: boolean) {
  const cards = d.choose;
  if (!cards) return;
  const dpr = Math.min(devicePixelRatio, 2);
  const W = cw / dpr;
  const H = ch / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = 'rgba(40, 28, 22, 0.58)';
  ctx.fillRect(0, 0, W, H);
  const L = cardRects(W, H, cards.length);
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.font = `bold ${Math.round(34 * Math.max(0.75, L.s))}px system-ui, sans-serif`;
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(70, 52, 42, 0.9)';
  const title = `레벨 업! Lv ${d.run.level - d.run.pending + 1}`;
  ctx.strokeText(title, W / 2, L.title);
  ctx.fillStyle = '#ffd84a';
  ctx.fillText(title, W / 2, L.title);
  ctx.font = '16px system-ui, sans-serif';
  ctx.fillStyle = '#fff6e4';
  ctx.fillText(touch ? '기술 하나를 눌러 골라요' : '기술 하나를 골라요 (1 · 2 · 3 또는 클릭)', W / 2, L.title + 28);
  cards.forEach((c, i) => {
    const r = L.cards[i];
    if (!L.wide) return drawCard(ctx, r, c, i, i === hover, false, t, d);
    // 가로 카드는 240×320 으로 그려 화면에 맞게 줄인다
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.scale(L.s, L.s);
    drawCard(ctx, { x: 0, y: 0, w: CARD.w, h: CARD.h }, c, i, i === hover, true, t, d);
    ctx.restore();
  });
  ctx.textAlign = 'left';
}

function drawCard(ctx: CanvasRenderingContext2D, r: R, c: Card, i: number, on: boolean, wide: boolean, t: number, d: Dungeon) {
  const heal = c.id === 'heal';
  const def = heal ? null : SKILLS[c.id as SkillId];
  const color = def ? FAMILIES[def.family].color : '#f5a05a';
  const lift = on ? -6 : 0;
  ctx.save();
  ctx.translate(0, lift);
  ctx.shadowColor = 'rgba(40, 25, 15, 0.35)';
  ctx.shadowBlur = on ? 22 : 12;
  ctx.fillStyle = on ? '#fffdf7' : 'rgba(255, 250, 240, 0.97)';
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 18);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = on ? color : 'rgba(120, 85, 55, 0.35)';
  ctx.lineWidth = on ? 4 : 2;
  ctx.stroke();
  // 계열 띠
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, wide ? r.w : 14, wide ? 30 : r.h, wide ? [18, 18, 0, 0] : [18, 0, 0, 18]);
  ctx.fill();
  const name = heal ? '생선 간식' : def!.name;
  const badge = heal ? '' : c.lv === 1 ? '새 기술' : `Lv ${c.lv - 1} → ${c.lv}`;
  const what = heal ? '체력 30 회복' : String(def!.levels[c.lv - 1].text);
  const desc = heal ? '배울 기술을 다 배웠어요' : def!.desc;
  const anim = def?.anim;
  const icon = (cx: number, cy: number, s: number) => {
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(cx, cy, s / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
    if (anim) drawAnim(ctx, anim, iconFrame(anim, t), cx, cy, s * 0.82);
    else drawIcon(ctx, SNACK.item, cx, cy, s * 0.7);
  };
  if (wide) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 15px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(heal ? '간식' : FAMILIES[def!.family].name, r.x + 14, r.y + 21);
    ctx.textAlign = 'right';
    ctx.fillText(`${i + 1}`, r.x + r.w - 14, r.y + 21);
    ctx.textAlign = 'center';
    icon(r.x + r.w / 2, r.y + 30 + 62, 104);
    ctx.fillStyle = '#5b4a3f';
    fitText(ctx, name, r.x + r.w / 2, r.y + 178, r.w - 24, 21, 'bold ');
    if (badge) {
      ctx.font = 'bold 13px system-ui, sans-serif';
      const bw = ctx.measureText(badge).width + 18;
      ctx.fillStyle = c.lv === 1 ? '#5aa654' : color;
      ctx.beginPath();
      ctx.roundRect(r.x + r.w / 2 - bw / 2, r.y + 188, bw, 22, 11);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(badge, r.x + r.w / 2, r.y + 204);
    }
    ctx.fillStyle = '#5b4a3f';
    ctx.font = 'bold 15px system-ui, sans-serif';
    const wl = wrapText(ctx, what, r.w - 28).slice(0, 2);
    wl.forEach((l, k) => ctx.fillText(l, r.x + r.w / 2, r.y + 236 + k * 20));
    ctx.fillStyle = '#9a7b62';
    ctx.font = '13px system-ui, sans-serif';
    const dl = wrapText(ctx, desc, r.w - 28).slice(0, 3);
    dl.forEach((l, k) => ctx.fillText(l, r.x + r.w / 2, r.y + 236 + wl.length * 20 + 8 + k * 17));
  } else {
    const s = Math.min(78, r.h - 22);
    icon(r.x + 26 + s / 2, r.y + r.h / 2, s);
    const tx = r.x + 40 + s;
    const tw = r.w - (tx - r.x) - 14;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5b4a3f';
    ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(name, tx, r.y + 30);
    if (badge) {
      const nw = ctx.measureText(name).width;
      ctx.font = 'bold 12px system-ui, sans-serif';
      const bw = ctx.measureText(badge).width + 14;
      ctx.fillStyle = c.lv === 1 ? '#5aa654' : color;
      ctx.beginPath();
      ctx.roundRect(tx + nw + 8, r.y + 15, bw, 20, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(badge, tx + nw + 15, r.y + 30);
    }
    ctx.fillStyle = '#5b4a3f';
    ctx.font = 'bold 14px system-ui, sans-serif';
    wrapText(ctx, what, tw)
      .slice(0, 2)
      .forEach((l, k) => ctx.fillText(l, tx, r.y + 54 + k * 18));
    ctx.fillStyle = '#9a7b62';
    ctx.font = '12px system-ui, sans-serif';
    if (r.h > 96) ctx.fillText(wrapText(ctx, desc, tw)[0] ?? '', tx, r.y + r.h - 14);
  }
  ctx.restore();
  void d;
}
