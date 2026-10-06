/**
 * 모래 미끄럼틀 샌드보드 — 비탈을 저절로 미끄러져 올라간다(화면 위쪽이 앞). 좌우로 피하고 점프로 뛰어넘고 냥코인을 줍는다.
 * 하트 3개: 부딪힐 때마다 하나씩 잃고(방패가 있으면 막음) 다 잃으면 넘어져 끝. 끝까지 가면 완주 — 한 번도 안 부딪혔으면 보너스.
 * 물건은 art/sandboarding 시트의 id 그대로 (OBS). 좌표: d = 내려온 거리(m), x = 주행 폭 가로 자리(-1..1).
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 sandboard-draw.ts).
 */
export const SAND = {
  length: 900,
  vMin: 13,
  vMax: 22,
  accel: 0.6,
  /** 좌우 조작 속도 (가로 자리/초) */
  steer: 2.4,
  edge: 0.92,
  /** 고양이 가로 반폭 · 앞뒤로 닿는 거리(m) */
  catR: 0.09,
  reach: 1.0,
  /** 공중 시간: 점프 · 모래 둔덕 · 점프대(+ 속도) */
  jump: 0.6,
  bump: 0.45,
  rampJump: 1.0,
  rampBoost: 3,
  /** 가속 발판: 최고 속도 위로 이만큼, 이 시간 */
  boost: 6,
  boostTime: 2.2,
  /** 부딪히면 속도가 이만큼으로, 이 시간 동안 넘어졌다 일어난다(조작 불가) */
  crash: 0.45,
  dizzy: 0.9,
  /** 모래 구덩이: 속도가 이만큼으로 (하트는 안 잃는다) */
  pit: 0.55,
  hearts: 3,
  /** 자석: 시간 · 끌어오는 거리(가로 자리, m) · 방패: 시간 (한 번 막으면 사라진다) */
  magnet: 8,
  magnetX: 0.9,
  magnetD: 10,
  shield: 10,
  /** 장애물 줄 사이 거리 (m) */
  gap: [15, 24],
  lanes: [-0.8, -0.4, 0, 0.4, 0.8],
  /** 이만큼 앞까지 미리 깔아 둔다 (m) */
  ahead: 110,
  cleanBonus: 10,
};

/**
 * 시트의 물건 id → 하는 일 · 가로 반폭 r(주행 폭 단위) · 그림 배율 k(기본 그림 크기에 곱함).
 * hit = 부딪힘(점프로 넘음) · tall = 높아서 점프로는 못 넘음(점프대로만) · pit = 느려짐 · bump/ramp = 뜀 · boost = 가속 · 나머지는 줍기
 */
export const OBS = {
  small_rock: { role: 'hit', r: 0.12, k: 1 },
  wide_rock: { role: 'hit', r: 0.19, k: 1 },
  rock_cluster: { role: 'hit', r: 0.18, k: 1 },
  round_cactus: { role: 'hit', r: 0.13, k: 1 },
  fallen_pillar: { role: 'hit', r: 0.19, k: 1 },
  wood_crate: { role: 'hit', r: 0.14, k: 1 },
  barrel: { role: 'hit', r: 0.12, k: 1 },
  clay_jar: { role: 'hit', r: 0.13, k: 1 },
  broken_cart: { role: 'hit', r: 0.17, k: 1 },
  wood_barrier: { role: 'hit', r: 0.3, k: 1.45 },
  tall_rock: { role: 'tall', r: 0.15, k: 1 },
  spiky_cactus: { role: 'tall', r: 0.14, k: 1 },
  standing_pillar: { role: 'tall', r: 0.15, k: 1 },
  sand_pit: { role: 'pit', r: 0.2, k: 1 },
  sand_bump: { role: 'bump', r: 0.18, k: 0.95 },
  jump_ramp: { role: 'ramp', r: 0.2, k: 1 },
  boost_pad: { role: 'boost', r: 0.19, k: 1 },
  paw_coin: { role: 'coin', r: 0.09, k: 0.42, n: 1 },
  coin_pile: { role: 'coin', r: 0.13, k: 0.62, n: 5 },
  treasure_chest: { role: 'coin', r: 0.15, k: 0.7, n: 15 },
  heart_pickup: { role: 'heart', r: 0.11, k: 0.5 },
  shield_pickup: { role: 'shield', r: 0.11, k: 0.5 },
  magnet_pickup: { role: 'magnet', r: 0.11, k: 0.5 },
} as const;
export type ObKind = keyof typeof OBS;
type Role = (typeof OBS)[ObKind]['role'];
const HIT: ObKind[] = ['small_rock', 'wide_rock', 'rock_cluster', 'round_cactus', 'fallen_pillar', 'wood_crate', 'barrel', 'clay_jar', 'broken_cart'];
const TALL: ObKind[] = ['tall_rock', 'spiky_cactus', 'standing_pillar'];
const role = (k: ObKind): Role => OBS[k].role;
/** 부딪히는 것 (줄마다 하나는 비워 둬야 하는 것) */
export const solid = (k: ObKind) => role(k) === 'hit' || role(k) === 'tall';

/** got = 주웠다 · hit = 이미 작동했다(부딪힘·뜀) */
export type Ob = { kind: ObKind; x: number; d: number; got?: boolean; hit?: boolean };
/** 그리기용 짧은 효과 (시트의 효과 id) · 떠오르는 글자 */
export type SandFx = { id: 'jump_puff' | 'land_burst' | 'hit_stars' | 'pickup_sparkle'; x: number; d: number; t: number };
export type SandPop = { text: string; x: number; d: number; t: number };
export type SandEvent =
  | { type: 'coin'; n: number }
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'ramp' }
  | { type: 'bump' }
  | { type: 'boost' }
  | { type: 'pit' }
  | { type: 'crash'; kind: ObKind }
  | { type: 'block' }
  | { type: 'power'; kind: 'heart' | 'shield' | 'magnet' }
  | { type: 'finish'; coins: number; secs: number; clean: boolean; fell: boolean; score: number };
export type SandInput = { mx: number; jump: boolean };
export type SandState = {
  d: number;
  x: number;
  v: number;
  /** 공중에 남은 시간 · 이번 뜀의 길이 · 땅에 닿은 뒤 시간 */
  air: number;
  airMax: number;
  landT: number;
  /** 넘어져 있는 남은 시간 */
  dizzy: number;
  /** 지금 누르는 좌우(-1, 0, 1) · 그쪽으로 누른 시간 (드리프트 모션) */
  steer: number;
  steerT: number;
  flip: number;
  t: number;
  hearts: number;
  shield: number;
  magnet: number;
  boost: number;
  phase: 'play' | 'done';
  fell: boolean;
  coins: number;
  crashes: number;
  score: number;
  obs: Ob[];
  fx: SandFx[];
  pops: SandPop[];
  /** 다음 줄을 깔 거리 */
  nextAt: number;
  events: SandEvent[];
  rng: () => number;
};

export const FX_TIME = 0.75; // 6프레임 8fps
const POP_TIME = 0.9;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function makeSandboard(rng: () => number = Math.random): SandState {
  const s: SandState = {
    d: 0, x: 0, v: SAND.vMin, air: 0, airMax: 1, landT: 9, dizzy: 0, steer: 0, steerT: 0, flip: 1, t: 0,
    hearts: SAND.hearts, shield: 0, magnet: 0, boost: 0, phase: 'play', fell: false, coins: 0, crashes: 0, score: 0,
    obs: [], fx: [], pops: [], nextAt: 30, events: [], rng,
  };
  spawn(s);
  return s;
}

const pick = <T>(s: SandState, list: readonly T[]) => list[Math.floor(s.rng() * list.length)];

/** 앞쪽에 줄을 깐다. 갈수록 장애물이 잦고 많아진다. 부딪히는 것끼리는 서로 다른 레인 — 늘 지나갈 길이 있다 */
function spawn(s: SandState) {
  while (s.nextAt < s.d + SAND.ahead && s.nextAt < SAND.length - 25) {
    const d = s.nextAt;
    const late = d / SAND.length; // 0 → 1
    const add = (kind: ObKind, x: number, dd = d) => s.obs.push({ kind, x: clamp(x, -0.92, 0.92), d: dd });
    const coins = (x0: number, d0: number, n: number, slant = 0) => {
      for (let i = 0; i < n; i++) add('paw_coin', x0 + slant * i, d0 + i * 3);
    };
    const r = s.rng();
    if (r < 0.36 + late * 0.12) {
      // 장애물 1~3개 (3개는 후반에만, 두 레인은 비운다)
      const n = s.rng() < 0.5 ? 1 : late > 0.45 && s.rng() < 0.35 ? 3 : 2;
      const lanes = [...SAND.lanes].sort(() => s.rng() - 0.5).slice(0, n);
      for (const x of lanes) add(s.rng() < 0.22 + late * 0.15 ? pick(s, TALL) : pick(s, HIT), x + (s.rng() - 0.5) * 0.06);
      // 빈 레인에 냥코인 한 줄 (가끔)
      if (s.rng() < 0.35) coins(pick(s, SAND.lanes.filter((l) => !lanes.includes(l))), d - 4, 3);
    } else if (r < 0.62) {
      coins(pick(s, SAND.lanes), d, 5, s.rng() < 0.4 ? (s.rng() < 0.5 ? -0.12 : 0.12) : 0);
    } else if (r < 0.71) {
      // 점프대 → 공중 냥코인 + 끝에 냥코인 더미
      const x0 = SAND.lanes[1 + Math.floor(s.rng() * 3)];
      add('jump_ramp', x0);
      for (let i = 0; i < 4; i++) add('paw_coin', x0, d + 6 + i * 3);
      if (s.rng() < 0.5) add('coin_pile', x0, d + 19);
    } else if (r < 0.78) {
      // 낮은 나무 울타리: 뛰어넘거나 가장자리로 돌아간다
      add('wood_barrier', pick(s, [-0.35, 0, 0.35]));
    } else if (r < 0.84) {
      add('sand_pit', pick(s, SAND.lanes));
      if (s.rng() < 0.5) add('sand_pit', pick(s, SAND.lanes), d + 8);
    } else if (r < 0.89) {
      // 모래 둔덕 → 작은 뜀 + 냥코인
      const x0 = pick(s, SAND.lanes);
      add('sand_bump', x0);
      coins(x0, d + 5, 3);
    } else if (r < 0.94) {
      // 가속 발판 → 빨라진 채 냥코인 줄
      const x0 = SAND.lanes[1 + Math.floor(s.rng() * 3)];
      add('boost_pad', x0);
      coins(x0, d + 6, 6);
    } else {
      // 보상 하나: 자석 · 방패 · 하트 · 보물상자
      const p = s.rng();
      add(p < 0.35 ? 'magnet_pickup' : p < 0.65 ? 'shield_pickup' : p < 0.85 ? 'heart_pickup' : 'treasure_chest', pick(s, SAND.lanes));
    }
    s.nextAt += SAND.gap[0] + s.rng() * (SAND.gap[1] - SAND.gap[0]) * (1 - late * 0.25);
  }
}

const fx = (s: SandState, id: SandFx['id'], x = s.x, d = s.d) => s.fx.push({ id, x, d, t: 0 });
const pop = (s: SandState, text: string, x: number, d: number) => s.pops.push({ text, x, d, t: 0 });

function finish(s: SandState, fell: boolean) {
  s.phase = 'done';
  s.fell = fell;
  const clean = !fell && s.crashes === 0;
  s.score = s.coins + (clean ? SAND.cleanBonus : 0);
  s.events.push({ type: 'finish', coins: s.coins, secs: s.t, clean, fell, score: s.score });
}

/** 한 프레임. mx = 좌우 -1..1, jump = 이번 프레임에 눌렀다 */
export function updateSandboard(s: SandState, input: SandInput, dt: number) {
  s.events.length = 0;
  for (const f of s.fx) f.t += dt;
  for (const p of s.pops) p.t += dt;
  s.fx = s.fx.filter((f) => f.t < FX_TIME);
  s.pops = s.pops.filter((p) => p.t < POP_TIME);
  if (s.phase !== 'play') return;
  s.t += dt;
  spawn(s);
  s.dizzy = Math.max(0, s.dizzy - dt);
  s.shield = Math.max(0, s.shield - dt);
  s.magnet = Math.max(0, s.magnet - dt);
  s.boost = Math.max(0, s.boost - dt);
  const top = SAND.vMax + (s.boost > 0 ? SAND.boost : 0);
  s.v = s.v > top ? Math.max(top, s.v - 4 * dt) : Math.min(top, s.v + SAND.accel * dt);
  s.landT += dt;
  if (s.air > 0 && (s.air -= dt) <= 0) {
    s.air = 0;
    s.landT = 0;
    fx(s, 'land_burst');
    s.events.push({ type: 'land' });
  }
  if (input.jump && s.air <= 0 && s.dizzy <= 0) {
    s.air = s.airMax = SAND.jump;
    fx(s, 'jump_puff');
    s.events.push({ type: 'jump' });
  }
  const steer = s.dizzy > 0 ? 0 : Math.sign(clamp(input.mx, -1, 1));
  s.steerT = steer === s.steer ? s.steerT + dt : 0;
  s.steer = steer;
  if (steer !== 0) s.flip = steer;
  s.x = clamp(s.x + (s.dizzy > 0 ? 0 : clamp(input.mx, -1, 1)) * SAND.steer * dt, -SAND.edge, SAND.edge);
  s.d += s.v * dt;

  for (const ob of s.obs) {
    if (ob.got || ob.hit) continue;
    const o = OBS[ob.kind];
    // 자석: 가까운 냥코인이 고양이 쪽으로 날아온다
    if (o.role === 'coin' && s.magnet > 0 && ob.d - s.d < SAND.magnetD && ob.d > s.d - 1 && Math.abs(ob.x - s.x) < SAND.magnetX) {
      const a = Math.min(1, dt * 7);
      ob.x += (s.x - ob.x) * a;
      ob.d += (s.d - ob.d) * a;
    }
    if (Math.abs(ob.d - s.d) >= SAND.reach || Math.abs(ob.x - s.x) >= o.r + SAND.catR) continue;
    switch (o.role) {
      case 'coin': {
        const n = (o as { n: number }).n;
        ob.got = true;
        s.coins += n;
        fx(s, 'pickup_sparkle', ob.x, ob.d);
        pop(s, `+${n}`, ob.x, ob.d);
        s.events.push({ type: 'coin', n });
        break;
      }
      case 'heart':
      case 'shield':
      case 'magnet':
        ob.got = true;
        if (o.role === 'heart') s.hearts = Math.min(SAND.hearts, s.hearts + 1);
        else if (o.role === 'shield') s.shield = SAND.shield;
        else s.magnet = SAND.magnet;
        fx(s, 'pickup_sparkle', ob.x, ob.d);
        pop(s, o.role === 'heart' ? '하트 +1' : o.role === 'shield' ? '방패!' : '자석!', ob.x, ob.d);
        s.events.push({ type: 'power', kind: o.role });
        break;
      case 'ramp':
      case 'bump':
        if (s.air > 0) break;
        ob.hit = true;
        s.air = s.airMax = o.role === 'ramp' ? SAND.rampJump : SAND.bump;
        if (o.role === 'ramp') s.v = Math.min(top + SAND.rampBoost, s.v + SAND.rampBoost);
        fx(s, 'jump_puff');
        s.events.push({ type: o.role });
        break;
      case 'boost':
        if (s.air > 0) break;
        ob.hit = true;
        s.boost = SAND.boostTime;
        s.v = Math.max(s.v, SAND.vMax + SAND.boost);
        pop(s, '부스트!', ob.x, ob.d);
        s.events.push({ type: 'boost' });
        break;
      case 'pit':
        if (s.air > 0) break;
        ob.hit = true;
        s.v = Math.max(SAND.vMin * 0.5, s.v * SAND.pit);
        fx(s, 'land_burst');
        s.events.push({ type: 'pit' });
        break;
      default: {
        // hit 는 공중이면 넘고, tall 은 점프대로 높이 떠야 넘는다
        if (s.air > 0 && (o.role === 'hit' || s.airMax >= SAND.rampJump)) break;
        ob.hit = true;
        if (s.shield > 0) {
          s.shield = 0;
          fx(s, 'hit_stars', ob.x, ob.d);
          pop(s, '막았다!', ob.x, ob.d);
          s.events.push({ type: 'block' });
          break;
        }
        s.v = Math.max(SAND.vMin * 0.5, s.v * SAND.crash);
        s.dizzy = SAND.dizzy;
        s.air = 0;
        s.crashes++;
        s.hearts--;
        fx(s, 'hit_stars');
        s.events.push({ type: 'crash', kind: ob.kind });
        if (s.hearts <= 0) return finish(s, true);
      }
    }
  }
  s.obs = s.obs.filter((o) => o.d > s.d - 12);

  if (s.d >= SAND.length) {
    s.d = SAND.length;
    finish(s, false);
  }
}
