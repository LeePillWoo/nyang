/**
 * 모래 미끄럼틀 샌드보드 — 비탈을 저절로 미끄러져 내려간다. 좌우로 피하고(바위·선인장·굴러오는 아르마딜로), 점프로 뛰어넘고,
 * 냥코인을 줍고, 점프대를 타면 공중 냥코인. 부딪히면 느려지고 잠깐 어지럽다. 끝까지 가면 완주 — 한 번도 안 부딪혔으면 보너스.
 * 좌표: d = 내려온 거리(m), x = 비탈 가로 자리(-1..1). 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 sandboard-draw.ts).
 */
export const SAND = {
  length: 900,
  vMin: 13,
  vMax: 22,
  accel: 0.6,
  /** 좌우 조작 속도 (가로 자리/초) */
  steer: 2.4,
  edge: 0.92,
  /** 점프 공중 시간 · 점프대 공중 시간과 속도 보탬 */
  jump: 0.55,
  rampJump: 0.95,
  rampBoost: 3,
  /** 부딪히면 속도가 이만큼으로, 이 시간 동안 조작 불가 */
  crash: 0.4,
  dizzy: 0.7,
  /** 장애물 줄 사이 거리 (m) */
  gap: [15, 26],
  lanes: [-0.8, -0.4, 0, 0.4, 0.8],
  /** 이만큼 앞까지 미리 깔아 둔다 (m) */
  ahead: 110,
  cleanBonus: 10,
};

export type ObKind = 'rock' | 'cactus' | 'ramp' | 'coin' | 'armadillo';
/** r = 가로 반폭 (비탈 단위). armadillo 는 vx 로 가로질러 굴러간다 (고양이가 32m 안에 오면) */
export type Ob = { kind: ObKind; x: number; d: number; r: number; got?: boolean; hit?: boolean; vx?: number; anim: number };
export type SandEvent =
  | { type: 'coin' }
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'ramp' }
  | { type: 'crash'; kind: ObKind }
  | { type: 'finish'; coins: number; secs: number; clean: boolean; score: number };
export type SandInput = { mx: number; jump: boolean };
export type SandState = {
  d: number;
  x: number;
  v: number;
  /** 공중에 남은 시간 · 이번 점프의 길이 */
  air: number;
  airMax: number;
  dizzy: number;
  t: number;
  animT: number;
  flip: number;
  phase: 'play' | 'done';
  coins: number;
  crashes: number;
  score: number;
  obs: Ob[];
  /** 다음 장애물 줄을 깔 거리 */
  nextAt: number;
  events: SandEvent[];
  rng: () => number;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function makeSandboard(rng: () => number = Math.random): SandState {
  const s: SandState = { d: 0, x: 0, v: SAND.vMin, air: 0, airMax: 1, dizzy: 0, t: 0, animT: 0, flip: 1, phase: 'play', coins: 0, crashes: 0, score: 0, obs: [], nextAt: 30, events: [], rng };
  spawn(s);
  return s;
}

/** 앞쪽에 장애물 줄을 깐다: 바위·선인장 1~2개(서로 다른 레인 — 늘 지나갈 길이 있다) · 냥코인 다섯 · 점프대 + 공중 냥코인 · 아르마딜로 */
function spawn(s: SandState) {
  while (s.nextAt < s.d + SAND.ahead && s.nextAt < SAND.length - 20) {
    const d = s.nextAt;
    const r = s.rng();
    const lane = () => SAND.lanes[Math.floor(s.rng() * SAND.lanes.length)];
    if (r < 0.45) {
      const used = new Set<number>();
      for (let i = s.rng() < 0.55 ? 1 : 2; i > 0; i--) {
        let x = lane();
        while (used.has(x)) x = lane();
        used.add(x);
        s.obs.push({ kind: s.rng() < 0.5 ? 'rock' : 'cactus', x: x + (s.rng() - 0.5) * 0.1, d, r: 0.17, anim: 0 });
      }
    } else if (r < 0.65) {
      const x0 = lane();
      const slant = s.rng() < 0.4 ? (s.rng() < 0.5 ? -0.15 : 0.15) : 0;
      for (let i = 0; i < 5; i++) s.obs.push({ kind: 'coin', x: clamp(x0 + slant * i, -0.9, 0.9), d: d + i * 3.5, r: 0.14, anim: 0 });
    } else if (r < 0.8) {
      const x0 = SAND.lanes[1 + Math.floor(s.rng() * 3)];
      s.obs.push({ kind: 'ramp', x: x0, d, r: 0.22, anim: 0 });
      for (let i = 0; i < 4; i++) s.obs.push({ kind: 'coin', x: x0, d: d + 7 + i * 3.5, r: 0.14, anim: 0 });
    } else {
      const dir = s.rng() < 0.5 ? 1 : -1;
      s.obs.push({ kind: 'armadillo', x: -dir * 1.25, d, r: 0.2, vx: dir * (0.7 + s.rng() * 0.4), anim: 0 });
    }
    s.nextAt += SAND.gap[0] + s.rng() * (SAND.gap[1] - SAND.gap[0]);
  }
}

/** 한 프레임. mx = 좌우 -1..1, jump = 이번 프레임에 눌렀다 */
export function updateSandboard(s: SandState, input: SandInput, dt: number) {
  s.events.length = 0;
  if (s.phase !== 'play') return;
  s.t += dt;
  s.animT += dt;
  spawn(s);
  s.v = Math.min(SAND.vMax, s.v + SAND.accel * dt);
  s.dizzy = Math.max(0, s.dizzy - dt);
  if (s.air > 0 && (s.air -= dt) <= 0) {
    s.air = 0;
    s.events.push({ type: 'land' });
  }
  if (input.jump && s.air <= 0 && s.dizzy <= 0) {
    s.air = s.airMax = SAND.jump;
    s.events.push({ type: 'jump' });
  }
  const steer = s.dizzy > 0 ? 0 : clamp(input.mx, -1, 1);
  if (steer !== 0) s.flip = Math.sign(steer);
  s.x = clamp(s.x + steer * SAND.steer * dt, -SAND.edge, SAND.edge);
  s.d += s.v * dt;

  for (const ob of s.obs) {
    ob.anim += dt;
    if (ob.kind === 'armadillo' && ob.vx && ob.d - s.d < 32 && ob.d > s.d - 6) ob.x += ob.vx * dt;
    if (ob.got || ob.hit) continue;
    if (Math.abs(ob.d - s.d) >= 1.1 || Math.abs(ob.x - s.x) >= ob.r + 0.13) continue;
    if (ob.kind === 'coin') {
      ob.got = true;
      s.coins++;
      s.events.push({ type: 'coin' });
    } else if (ob.kind === 'ramp') {
      if (s.air <= 0) {
        ob.hit = true;
        s.air = s.airMax = SAND.rampJump;
        s.v = Math.min(SAND.vMax + SAND.rampBoost, s.v + SAND.rampBoost);
        s.events.push({ type: 'ramp' });
      }
    } else if (s.air <= 0) {
      // 바위·선인장·아르마딜로: 공중이면 뛰어넘는다
      ob.hit = true;
      s.v = Math.max(SAND.vMin * 0.5, s.v * SAND.crash);
      s.dizzy = SAND.dizzy;
      s.crashes++;
      s.events.push({ type: 'crash', kind: ob.kind });
    }
  }
  s.obs = s.obs.filter((o) => o.d > s.d - 12);

  if (s.d >= SAND.length) {
    s.d = SAND.length;
    s.phase = 'done';
    const clean = s.crashes === 0;
    s.score = s.coins + (clean ? SAND.cleanBonus : 0);
    s.events.push({ type: 'finish', coins: s.coins, secs: s.t, clean, score: s.score });
  }
}
