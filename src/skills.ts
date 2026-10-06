/**
 * 던전 기술 (로그라이크) — 쓰러진 몬스터의 생선뼈(경험치)를 모아 레벨이 오르면 카드 3장 중 하나를 골라
 * 새 기술을 배우거나 가진 기술의 레벨을 올린다 (최대 5). 기술은 SLOTS(5) 가지까지 — 다 차면 가진 기술 레벨 업만 나온다.
 * 기술은 그 방에서만 — 나가면 사라진다.
 * 수치는 src/data/skills.json, 효과 그림 이름은 src/data/skill-fx.json (그림은 skills-draw.ts 가 그린다).
 * 던전과는 SkillHost 로만 이야기한다 (고양이 · 몬스터 목록 · 때리기 · 계속 피해 · 효과 · 소리 · 벽). 그림을 안 불러와서 node 에서 체크된다.
 */
import data from './data/skills.json' with { type: 'json' };
import fxData from './data/skill-fx.json' with { type: 'json' };
import type { Enemy } from './enemy.ts';

export type Family = 'yarn' | 'catnip' | 'box' | 'laser';
type Level = Record<string, number | string>;
type SkillDef = { family: Family; name: string; anim: string; desc: string; levels: Level[] };
export type SkillId = keyof typeof data.skills;
export const SKILLS = data.skills as unknown as Record<SkillId, SkillDef>;
export const SKILL_IDS = Object.keys(SKILLS) as SkillId[];
export const FAMILIES = data.families as Record<Family, { name: string; color: string }>;
export const XP = data.xp;
/** 생선 비스킷 — 주우면 바로 먹는 회복 (포인트 아이템) */
export const SNACK = data.snack;
export const MAX_LV = 5;
/** 배울 수 있는 기술 가짓수 — 다 차면 카드엔 가진 기술 레벨 업만 */
export const SLOTS = data.slots;
/** 효과 동작: [시트, 행, fps, 반복, 바닥, 오른쪽 방향] */
export const FX_ANIMS = fxData.anims as unknown as Record<string, [string, number, number, number, number, number]>;

/** 레벨 L 에서 L+1 까지 필요한 생선뼈 */
export const need = (level: number) => XP.first + XP.grow * (level - 1);

export type SkillSound = 'throw' | 'boom' | 'zap' | 'shield' | 'hiss' | 'thud' | 'snare' | 'swirl' | 'ring' | 'box';
/** 카드: 기술 id 와 고르면 될 레벨 (heal = 다 배웠을 때 간식) */
export type Card = { id: SkillId | 'heal'; lv: number };
/** 이어지는 실 (튕긴 털뭉치 · 올가미) — 그리기용, LINK_LIFE 초 동안 남는다 */
export type Link = { x0: number; z0: number; x1: number; z1: number; t: number; kind: 'yarn' | 'snare' };
export const LINK_LIFE = 0.45;
/** 한 번 재생하는 효과 — size 지름(m) · h 높이(m) · follow 면 그 몬스터를 따라간다 */
export type SkillFx = { anim: string; x: number; z: number; t: number; rot: number; size: number; h: number; flip: number; follow?: Enemy };

export type Ent =
  | { k: 'yarn'; x: number; z: number; dx: number; dz: number; tgt: Enemy | null; dmg: number; life: number; bounce: number; t: number }
  | { k: 'spool'; x: number; z: number; dx: number; dz: number; out: boolean; dist: number; range: number; dmg: number; hits: Set<Enemy>; trail: number; t: number }
  | { k: 'hair'; x0: number; z0: number; x1: number; z1: number; t: number; T: number; dmg: number; r: number }
  | { k: 'flame'; x: number; z: number; life: number; max: number; dps: number }
  | { k: 'drop'; x: number; z: number; e: Enemy | null; t: number; T: number; dmg: number; r: number; stun: number }
  /** 빨간 점 레이저: 조준 aim 초(아프지 않다) → 발사 fire 초(초당 dps). 쏠 때만 있다. i = 몇 번째 줄 (줄마다 조금씩 늦게, 나오는 자리도 옆으로) */
  | { k: 'laser'; e: Enemy; t: number; aim: number; fire: number; dps: number; i: number }
  | { k: 'mark'; e: Enemy; t: number; T: number; dmg: number }
  | { k: 'mouse'; x: number; z: number; dx: number; dz: number; tgt: Enemy | null; life: number; dmg: number; r: number; speed: number; t: number }
  | { k: 'snare'; e: Enemy; t: number };

export type Run = {
  level: number;
  xp: number;
  /** 가진 기술 → 레벨 */
  skills: Partial<Record<SkillId, number>>;
  /** 기술마다 다음 발동까지 남은 초 */
  cd: Partial<Record<SkillId, number>>;
  ents: Ent[];
  fx: SkillFx[];
  links: Link[];
  /** 냥냥 펀치 — 맞힌 냥펀치 수 */
  punches: number;
  /** 식빵 보호막 — 남은 겹 · 다시 차오르는 시계 */
  shield: number;
  shieldT: number;
  /** 하악 — 다시 할 수 있을 때까지 */
  hissCd: number;
  /** 빙글 상자 — 도는 각도 */
  boxA: number;
  /** 우다다 잔상 — 구르는 중인가 · 마지막 불꽃 자리 */
  dashOn: boolean;
  zoomX: number;
  zoomZ: number;
  /** 고르지 않은 레벨 업 수 */
  pending: number;
};

/** 던전이 기술에게 빌려주는 것 */
export type SkillHost = {
  P: { x: number; z: number; faceX: number; faceZ: number; dashT: number };
  readonly enemies: Enemy[];
  /** 한 방 피해 (움찔 · 숫자 · 쓰러지면 드롭). crit = 치명타 숫자 */
  hit(e: Enemy, dmg: number, fromX: number, fromZ: number, push?: number, crit?: boolean): void;
  /** 계속 피해 — 모아서 1 이 넘을 때마다 깎는다 (움찔 없음) */
  soak(e: Enemy, dmg: number): void;
  sound(id: SkillSound): void;
  /** 벽에 막히며 움직인 자리 */
  move(x: number, z: number, r: number): { x: number; z: number };
  rng(): number;
};

export function makeRun(): Run {
  return { level: 1, xp: 0, skills: {}, cd: {}, ents: [], fx: [], links: [], punches: 0, shield: 0, shieldT: 0, hissCd: 0, boxA: 0, dashOn: false, zoomX: 0, zoomZ: 0, pending: 0 };
}

/** 그 기술의 지금 레벨 수치 (안 가졌으면 null) */
export function lv(run: Run, id: SkillId): Level | null {
  const n = run.skills[id];
  return n ? SKILLS[id].levels[n - 1] : null;
}
const num = (p: Level, k: string) => (typeof p[k] === 'number' ? (p[k] as number) : 0);

/** 생선뼈를 먹는다. 레벨이 오른 수를 돌려준다 (pending 에 쌓인다) */
export function gainXp(run: Run, n: number) {
  run.xp += n;
  let up = 0;
  while (run.xp >= need(run.level)) {
    run.xp -= need(run.level);
    run.level++;
    run.pending++;
    up++;
  }
  return up;
}

/** 카드 3장: 아직 최대가 아닌 기술 중에서 (가진 기술은 owned 배로 잘 나온다). 기술 칸(SLOTS)이 다 찼으면 가진 기술만, 다 최대면 간식 */
export function rollCards(run: Run, rng: () => number = Math.random, n = 3): Card[] {
  const full = Object.keys(run.skills).length >= SLOTS;
  const pool = SKILL_IDS.filter((id) => (run.skills[id] ?? 0) < MAX_LV && (!full || run.skills[id])).map((id) => ({ id, w: run.skills[id] ? XP.owned : 1 }));
  const out: Card[] = [];
  while (out.length < n && pool.length) {
    let r = rng() * pool.reduce((s, p) => s + p.w, 0);
    let i = 0;
    while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
    const [p] = pool.splice(i, 1);
    out.push({ id: p.id, lv: (run.skills[p.id] ?? 0) + 1 });
  }
  if (!out.length) out.push({ id: 'heal', lv: 0 });
  return out;
}

/** 배운다 (또는 레벨 업). 새로 배운 기술은 곧 발동한다. at = 고양이 자리 (배울 때 효과) */
export function learn(run: Run, id: SkillId, at?: { x: number; z: number }) {
  const was = run.skills[id] ?? 0;
  run.skills[id] = Math.min(MAX_LV, was + 1);
  run.cd[id] = Math.min(run.cd[id] ?? 0.3, 0.3);
  if (id === 'loaf_shield' && !was) run.shield = num(lv(run, id)!, 'charges'); // 처음엔 다 차 있다
  if (id === 'catnip_cloud' && !was && at) addFx(run, 'cloud_spawn', at.x, at.z, { size: num(lv(run, id)!, 'r') * 2 });
}

/** 효과 하나 (life 는 그림 길이 — 반복 동작은 life 를 따로 준다) */
export function addFx(run: Run, anim: string, x: number, z: number, o: Partial<Pick<SkillFx, 'rot' | 'size' | 'h' | 'flip' | 'follow'>> = {}) {
  run.fx.push({ anim, x, z, t: 0, rot: o.rot ?? 0, size: o.size ?? 0, h: o.h ?? 0, flip: o.flip ?? 1, follow: o.follow });
}
/** 효과 하나의 길이 (8칸 / fps) */
export const fxLife = (anim: string) => 8 / (FX_ANIMS[anim]?.[2] ?? 10);

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const live = (e: Enemy | null | undefined): e is Enemy => !!e && e.state !== 'pop';

/** 냥펀치 피해에 더할 것 (냥냥 펀치) · 냥펀치 사거리에 더할 것 (발톱) · 구르기 쿨다운 줄이기 (우다다) */
export const punchBonus = (run: Run) => num(lv(run, 'paw_combo') ?? {}, 'bonus');
export const punchReach = (run: Run) => num(lv(run, 'claw') ?? {}, 'reach');
export const dashCut = (run: Run) => num(lv(run, 'zoom') ?? {}, 'cut');

/** 냥펀치가 맞았을 때 (hits = 맞은 몬스터, fx·fz = 펀치 방향) — 냥냥 펀치 충격파 · 발톱 따끔 */
export function onPunch(run: Run, h: SkillHost, hits: Enemy[], fx: number, fz: number) {
  if (!hits.length) return;
  run.punches++;
  const paw = lv(run, 'paw_combo');
  if (paw) {
    addFx(run, 'paw_punch', hits[0].x, hits[0].z, { h: 0.8 });
    if (run.punches % num(paw, 'every') === 0) {
      const r = num(paw, 'r');
      for (const e of h.enemies) if (live(e) && dist(e.x, e.z, h.P.x, h.P.z) <= r) h.hit(e, num(paw, 'ring'), h.P.x, h.P.z, 6);
      addFx(run, 'shock_ring', h.P.x, h.P.z, { size: r * 2 });
      h.sound('ring');
    }
  }
  const claw = lv(run, 'claw');
  if (claw)
    for (const e of hits) {
      e.stingT = num(claw, 'dur');
      e.sting = num(claw, 'dps');
      addFx(run, 'claw_slash', e.x, e.z, { h: 0.7, rot: Math.atan2(fz, fx) });
    }
}

/** 맞기 직전: 식빵 보호막이 있으면 막는다 (true) */
export function absorbHit(run: Run, h: SkillHost) {
  if (run.shield <= 0) return false;
  run.shield--;
  run.shieldT = 0;
  addFx(run, 'shield_break', h.P.x, h.P.z, { h: 0.7 });
  h.sound('shield');
  const burst = num(lv(run, 'loaf_shield') ?? {}, 'burst');
  if (burst) for (const e of h.enemies) if (live(e) && dist(e.x, e.z, h.P.x, h.P.z) <= 2.2) h.hit(e, burst, h.P.x, h.P.z, 8);
  return true;
}

/** 맞았을 때 (보호막으로 막은 것 포함) — 하악 */
export function onHurt(run: Run, h: SkillHost) {
  if (run.skills.hiss && run.hissCd <= 0) hiss(run, h);
}
function hiss(run: Run, h: SkillHost) {
  const p = lv(run, 'hiss')!;
  const r = num(p, 'r');
  for (const e of h.enemies) if (live(e) && dist(e.x, e.z, h.P.x, h.P.z) <= r) h.hit(e, num(p, 'dmg'), h.P.x, h.P.z, num(p, 'push'));
  addFx(run, 'hiss_wave', h.P.x, h.P.z, { size: r * 2 });
  h.sound('hiss');
  run.hissCd = num(p, 'cd');
}

/** 빙글 상자의 자리 (그리기도 쓴다) */
export function orbitBoxes(run: Run, P: { x: number; z: number }) {
  const p = lv(run, 'box_orbit');
  if (!p) return [];
  const n = num(p, 'n');
  const r = num(p, 'r');
  return Array.from({ length: n }, (_, i) => {
    const a = run.boxA + (i * Math.PI * 2) / n;
    return { x: P.x + Math.cos(a) * r, z: P.z + Math.sin(a) * r, a };
  });
}

/** 한 프레임: 기술 발동 · 날아가는 것 · 상태(따끔) · 효과 시계 */
export function tickSkills(run: Run, h: SkillHost, dt: number) {
  const P = h.P;
  const alive = () => h.enemies.filter(live);
  const near = (x: number, z: number, max = Infinity, skip?: Set<Enemy>) =>
    alive()
      .filter((e) => !skip?.has(e) && dist(x, z, e.x, e.z) <= max)
      .sort((a, b) => dist(x, z, a.x, a.z) - dist(x, z, b.x, b.z));
  const within = (x: number, z: number, r: number) => alive().filter((e) => dist(x, z, e.x, e.z) <= r);
  /** 발동할 때가 됐나 (됐으면 cd 를 다시 채우는 건 쏜 쪽에서) */
  const due = (id: SkillId) => (run.cd[id] = (run.cd[id] ?? 0) - dt) <= 0;
  const rearm = (id: SkillId, p: Level) => (run.cd[id] = num(p, 'cd'));

  for (const id of Object.keys(run.skills) as SkillId[]) {
    const p = lv(run, id)!;
    switch (id) {
      case 'yarn_ball': {
        if (!due(id)) break;
        const tg = near(P.x, P.z, 9).slice(0, num(p, 'n'));
        if (!tg.length) break;
        const n = num(p, 'n');
        for (let i = 0; i < n; i++) {
          const e = tg[i % tg.length];
          const a = Math.atan2(e.z - P.z, e.x - P.x) + (i - (n - 1) / 2) * 0.3;
          run.ents.push({ k: 'yarn', x: P.x, z: P.z, dx: Math.cos(a), dz: Math.sin(a), tgt: e, dmg: num(p, 'dmg'), life: 1.6, bounce: num(p, 'bounce'), t: 0 });
        }
        h.sound('throw');
        rearm(id, p);
        break;
      }
      case 'spool': {
        if (!due(id)) break;
        const e = near(P.x, P.z, num(p, 'range') + 2)[0];
        if (!e) break;
        const a0 = Math.atan2(e.z - P.z, e.x - P.x);
        const n = num(p, 'n');
        const spread = n === 1 ? [0] : n === 2 ? [-0.35, 0.35] : [-0.5, 0, 0.5];
        for (const s of spread)
          run.ents.push({ k: 'spool', x: P.x, z: P.z, dx: Math.cos(a0 + s), dz: Math.sin(a0 + s), out: true, dist: 0, range: num(p, 'range'), dmg: num(p, 'dmg'), hits: new Set(), trail: 0, t: 0 });
        h.sound('throw');
        rearm(id, p);
        break;
      }
      case 'hairball': {
        if (!due(id)) break;
        const r = num(p, 'r');
        const cands = near(P.x, P.z, 8);
        if (!cands.length) break;
        const used: Enemy[] = [];
        for (let i = 0; i < num(p, 'n'); i++) {
          // 둘레에 적이 가장 많은 놈 (같으면 가까운 놈), 두 번째는 앞의 폭발 범위 밖에서
          const pick = cands
            .filter((c) => used.every((u) => dist(u.x, u.z, c.x, c.z) > r))
            .map((c) => ({ c, n: cands.filter((o) => dist(o.x, o.z, c.x, c.z) <= r).length }))
            .sort((a, b) => b.n - a.n)[0]?.c;
          if (!pick) break;
          used.push(pick);
          run.ents.push({ k: 'hair', x0: P.x, z0: P.z, x1: pick.x, z1: pick.z, t: 0, T: 0.45 + dist(P.x, P.z, pick.x, pick.z) * 0.04, dmg: num(p, 'dmg'), r });
        }
        h.sound('throw');
        rearm(id, p);
        break;
      }
      case 'snare': {
        if (!due(id)) break;
        const tg = near(P.x, P.z, num(p, 'range')).filter((e) => e.rootT <= 0).slice(0, num(p, 'n'));
        if (!tg.length) break;
        for (const e of tg) {
          e.rootT = num(p, 'dur');
          h.hit(e, num(p, 'dmg'), P.x, P.z, 0);
          run.ents.push({ k: 'snare', e, t: num(p, 'dur') });
          run.links.push({ x0: P.x, z0: P.z, x1: e.x, z1: e.z, t: 0, kind: 'snare' });
        }
        h.sound('snare');
        rearm(id, p);
        break;
      }
      case 'catnip_cloud': {
        for (const e of within(P.x, P.z, num(p, 'r'))) {
          e.slowT = 0.2;
          e.slowK = num(p, 'slow');
          h.soak(e, num(p, 'dps') * dt);
        }
        break;
      }
      case 'zoom': {
        if (P.dashT > 0) {
          if (!run.dashOn) {
            run.dashOn = true;
            run.zoomX = P.x;
            run.zoomZ = P.z;
            addFx(run, 'zoom_trail', P.x, P.z, { h: 0.4, rot: Math.atan2(P.faceZ, P.faceX) });
          }
          if (dist(P.x, P.z, run.zoomX, run.zoomZ) >= 0.45) {
            run.ents.push({ k: 'flame', x: P.x, z: P.z, life: num(p, 'life'), max: num(p, 'life'), dps: num(p, 'dps') });
            run.zoomX = P.x;
            run.zoomZ = P.z;
          }
        } else run.dashOn = false;
        break;
      }
      case 'tail_swirl': {
        if (!due(id)) break;
        const r = num(p, 'r');
        const tg = within(P.x, P.z, r);
        if (!tg.length) break;
        for (const e of tg) h.hit(e, num(p, 'dmg'), P.x, P.z, num(p, 'push'));
        addFx(run, 'tail_swirl', P.x, P.z, { size: r * 2 });
        addFx(run, 'wind_fragments', P.x, P.z, { size: r * 1.6, h: 0.5 });
        h.sound('swirl');
        rearm(id, p);
        break;
      }
      case 'box_orbit': {
        run.boxA += num(p, 'spin') * dt;
        for (const b of orbitBoxes(run, P))
          for (const e of alive())
            if (e.boxT <= 0 && dist(b.x, b.z, e.x, e.z) < 0.8) {
              h.hit(e, num(p, 'dmg'), P.x, P.z, 5);
              e.boxT = 0.5;
              addFx(run, 'box_hit', e.x, e.z, { h: 0.6 });
              h.sound('box');
            }
        break;
      }
      case 'box_drop': {
        if (!due(id)) break;
        const cands = near(P.x, P.z, 9);
        if (!cands.length) break;
        // 가까운 적 몇 중에서 골고루 (같은 자리에 겹치지 않게)
        const tg: Enemy[] = [];
        for (const e of cands.sort(() => h.rng() - 0.5)) if (tg.length < num(p, 'n') && tg.every((u) => dist(u.x, u.z, e.x, e.z) > num(p, 'r'))) tg.push(e);
        for (const e of tg) run.ents.push({ k: 'drop', x: e.x, z: e.z, e, t: 0, T: 0.75, dmg: num(p, 'dmg'), r: num(p, 'r'), stun: num(p, 'stun') });
        rearm(id, p);
        break;
      }
      case 'loaf_shield': {
        if (run.shield < num(p, 'charges')) {
          run.shieldT += dt;
          if (run.shieldT >= num(p, 'cd')) {
            run.shield++;
            run.shieldT = 0;
            addFx(run, 'loaf_shield', P.x, P.z, { h: 0.7 });
          }
        } else run.shieldT = 0;
        break;
      }
      case 'hiss': {
        run.hissCd -= dt;
        if (run.hissCd <= 0 && within(P.x, P.z, 1.8).length >= num(p, 'crowd')) hiss(run, h);
        break;
      }
      case 'red_dot': {
        // 쏠 때만 보인다 (2026-10-06 사용자 의견 — 늘 떠다니던 점): 가까운 적 n 마리를 조준했다가 지진다.
        // 적이 n 보다 적으면 남는 줄도 같은 적에게 (정예처럼 혼자 남은 센 적에게 몰린다)
        if (!due(id)) break;
        const tg = near(P.x, P.z, num(p, 'range')).slice(0, num(p, 'n'));
        if (!tg.length) break;
        for (let i = 0; i < num(p, 'n'); i++)
          run.ents.push({ k: 'laser', e: tg[i % tg.length], t: -0.08 * i, aim: num(p, 'aim'), fire: num(p, 'fire'), dps: num(p, 'dps'), i });
        rearm(id, p);
        break;
      }
      case 'pounce': {
        if (!due(id)) break;
        const marked = new Set(run.ents.flatMap((e) => (e.k === 'mark' ? [e.e] : [])));
        const tg = near(P.x, P.z, num(p, 'range'))
          .filter((e) => !marked.has(e))
          .sort((a, b) => b.hp - a.hp)
          .slice(0, num(p, 'n'));
        if (!tg.length) break;
        for (const e of tg) run.ents.push({ k: 'mark', e, t: 0, T: 0.6, dmg: num(p, 'dmg') });
        rearm(id, p);
        break;
      }
      case 'wind_mouse': {
        if (!due(id)) break;
        const tg = near(P.x, P.z, 10);
        if (!tg.length) break;
        for (let i = 0; i < num(p, 'n'); i++) {
          const e = tg[i % tg.length];
          const a = Math.atan2(e.z - P.z, e.x - P.x) + (i - (num(p, 'n') - 1) / 2) * 0.6;
          run.ents.push({ k: 'mouse', x: P.x, z: P.z, dx: Math.cos(a), dz: Math.sin(a), tgt: e, life: 3.5, dmg: num(p, 'dmg'), r: num(p, 'r'), speed: num(p, 'speed'), t: 0 });
        }
        h.sound('throw');
        rearm(id, p);
        break;
      }
    }
  }

  // 따끔(발톱): 남은 동안 초당 sting
  for (const e of alive())
    if (e.stingT > 0) {
      e.stingT -= dt;
      h.soak(e, e.sting * dt);
    }

  // 날아가는 것 · 땅에 남은 것
  const out: Ent[] = [];
  for (const en of run.ents) if (step(run, h, en, dt, near, within)) out.push(en);
  run.ents = out;

  for (const l of run.links) l.t += dt;
  run.links = run.links.filter((l) => l.t < LINK_LIFE);
  for (const f of run.fx) {
    f.t += dt;
    if (f.follow) {
      f.x = f.follow.x;
      f.z = f.follow.z;
    }
  }
  run.fx = run.fx.filter((f) => f.t < fxLife(f.anim));
}

type Near = (x: number, z: number, max?: number, skip?: Set<Enemy>) => Enemy[];
type Within = (x: number, z: number, r: number) => Enemy[];
/** 하나 진행 — 남으면 true */
function step(run: Run, h: SkillHost, en: Ent, dt: number, near: Near, within: Within): boolean {
  const P = h.P;
  switch (en.k) {
    case 'yarn': {
      en.t += dt;
      en.life -= dt;
      // 목표 쪽으로 휘어 간다 (쓰러졌으면 곧장)
      if (live(en.tgt)) {
        const d = dist(en.x, en.z, en.tgt.x, en.tgt.z) || 1;
        const k = 1 - Math.exp(-12 * dt);
        en.dx += ((en.tgt.x - en.x) / d - en.dx) * k;
        en.dz += ((en.tgt.z - en.z) / d - en.dz) * k;
        const n = Math.hypot(en.dx, en.dz) || 1;
        en.dx /= n;
        en.dz /= n;
      }
      en.x += en.dx * 11 * dt;
      en.z += en.dz * 11 * dt;
      const e = within(en.x, en.z, 0.55)[0];
      if (e) {
        h.hit(e, en.dmg, en.x - en.dx, en.z - en.dz, 3);
        addFx(run, 'yarn_hit', e.x, e.z, { h: 0.7 });
        if (en.bounce > 0) {
          const next = near(e.x, e.z, 4, new Set([e]))[0];
          if (next) {
            run.links.push({ x0: e.x, z0: e.z, x1: next.x, z1: next.z, t: 0, kind: 'yarn' });
            en.bounce--;
            en.tgt = next;
            en.life = 1;
            return true;
          }
        }
        return false;
      }
      return en.life > 0;
    }
    case 'spool': {
      en.t += dt;
      const sp = en.out ? 9 : 12;
      if (en.out) {
        en.x += en.dx * sp * dt;
        en.z += en.dz * sp * dt;
        en.dist += sp * dt;
        if (en.dist >= en.range) {
          en.out = false;
          en.hits = new Set(); // 돌아오는 길에 다시 맞힌다
        }
      } else {
        const d = dist(en.x, en.z, P.x, P.z);
        if (d < 0.6) return false;
        en.x += ((P.x - en.x) / d) * sp * dt;
        en.z += ((P.z - en.z) / d) * sp * dt;
      }
      for (const e of within(en.x, en.z, 0.75))
        if (!en.hits.has(e)) {
          en.hits.add(e);
          h.hit(e, en.dmg, en.x, en.z, 3);
          addFx(run, 'yarn_hit', e.x, e.z, { h: 0.7, size: 1 });
        }
      if ((en.trail -= dt) <= 0) {
        en.trail = 0.09;
        const back = en.out ? Math.atan2(en.dz, en.dx) : Math.atan2(P.z - en.z, P.x - en.x);
        addFx(run, 'thread_trail', en.x, en.z, { h: 0.7, rot: back });
      }
      return en.t < 4;
    }
    case 'hair': {
      en.t += dt;
      if (en.t < en.T) return true;
      for (const e of within(en.x1, en.z1, en.r)) h.hit(e, en.dmg, en.x1, en.z1, 5);
      addFx(run, 'hairball_burst', en.x1, en.z1, { size: en.r * 2 });
      h.sound('boom');
      return false;
    }
    case 'flame': {
      en.life -= dt;
      // 1.1m: 고양이는 몬스터와 1m 거리를 두니(separate), 스치며 지나간 적도 닿게
      for (const e of within(en.x, en.z, 1.1)) h.soak(e, en.dps * dt);
      return en.life > 0;
    }
    case 'drop': {
      en.t += dt;
      // 그림자는 떨어지기 0.25초 전까지 목표를 따라간다 (그 뒤엔 자리가 굳어 피할 수 있다)
      if (live(en.e) && en.t < en.T - 0.25) {
        en.x = en.e.x;
        en.z = en.e.z;
      }
      if (en.t < en.T) return true;
      for (const e of within(en.x, en.z, en.r)) {
        h.hit(e, en.dmg, en.x, en.z, 3);
        e.stunT = Math.max(e.stunT, en.stun);
      }
      addFx(run, 'box_land', en.x, en.z, { size: en.r * 2.2 });
      h.sound('thud');
      return false;
    }
    case 'laser': {
      const was = en.t;
      en.t += dt;
      if (!live(en.e)) return false;
      if (was < en.aim && en.t >= en.aim) h.sound('zap');
      // 발사 구간에 걸친 만큼만 (조준하는 동안은 안 아프다)
      const on = Math.min(en.t, en.aim + en.fire) - Math.max(was, en.aim);
      if (on > 0) h.soak(en.e, en.dps * on);
      return en.t < en.aim + en.fire;
    }
    case 'mark': {
      en.t += dt;
      if (!live(en.e)) return false;
      if (en.t < en.T) return true;
      h.hit(en.e, en.dmg, en.e.x, en.e.z - 0.01, 6, true);
      addFx(run, 'critical_hit', en.e.x, en.e.z, { h: 0.9 });
      addFx(run, 'pounce_land', en.e.x, en.e.z, { size: 2 });
      h.sound('zap');
      return false;
    }
    case 'mouse': {
      en.t += dt;
      en.life -= dt;
      if (!live(en.tgt)) en.tgt = near(en.x, en.z, 10)[0] ?? null;
      if (live(en.tgt)) {
        const d = dist(en.x, en.z, en.tgt.x, en.tgt.z) || 1;
        const k = 1 - Math.exp(-6 * dt);
        en.dx += ((en.tgt.x - en.x) / d - en.dx) * k;
        en.dz += ((en.tgt.z - en.z) / d - en.dz) * k;
        const n = Math.hypot(en.dx, en.dz) || 1;
        en.dx /= n;
        en.dz /= n;
      }
      const p = h.move(en.x + en.dx * en.speed * dt, en.z + en.dz * en.speed * dt, 0.25);
      en.x = p.x;
      en.z = p.z;
      if (within(en.x, en.z, 0.6).length || en.life <= 0) {
        for (const e of within(en.x, en.z, en.r)) h.hit(e, en.dmg, en.x, en.z, 6);
        addFx(run, 'mouse_burst', en.x, en.z, { h: 0.2, size: en.r * 2 }); // 실제 폭발 범위 그대로
        h.sound('boom');
        return false;
      }
      return true;
    }
    case 'snare': {
      en.t -= dt;
      if (!live(en.e)) return false;
      if (en.t > 0) return true;
      addFx(run, 'snare_release', en.e.x, en.e.z, { h: 0.5 });
      return false;
    }
  }
}
