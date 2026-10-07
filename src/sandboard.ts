/**
 * 모래 미끄럼틀 샌드보드 — 비탈을 저절로 미끄러져 올라간다(화면 위쪽이 앞). 좌우로 피하고 점프로 뛰어넘고 냥코인을 줍는다.
 * 하트 3개: 부딪힐 때마다 하나씩 잃고(방패가 있으면 막음) 다 잃으면 넘어져 끝. 끝까지 가면 완주 — 한 번도 안 부딪혔으면 보너스.
 * 물건은 art/sandboarding 시트의 id 그대로 (OBS). 좌표: d = 내려온 거리(m), x = 가로 자리 (보통 길 반폭 = 1).
 * 길은 지그재그로 꺾이고 폭도 바뀐다 — 거리 d 의 양쪽 울타리가 fences(d). 물건 · 레인은 그 거리의 길 가운데 · 폭 기준으로 깐다.
 * 그림을 불러오지 않는 순수 로직이라 node 에서 체크된다 (그리기는 sandboard-draw.ts).
 */
export const SAND = {
  length: 900,
  vMin: 13,
  vMax: 24,
  accel: 2.4,
  /**
   * 좌우 = 드리프트. 누르면 보드가 먼저 꺾이고(스프링 — 살짝 넘쳤다 돌아옴), 몸은 늦게 따라 옆으로 흐른다(그립 지연).
   * 보드가 가리키는 쪽과 실제로 가는 쪽의 차이가 미끄러짐(slip) — 모래를 튀기고 속도를 깎는다.
   * steer = 보드가 다 꺾였을 때 가로 속도(가로 자리/초) · yawMax = 보드 최대 각도(라디안, 드리프트 컷의 32°와 같게)
   * yawW·yawZ = 누를 때 각도 스프링(고유 진동수·감쇠) · yawWOut·yawZOut = 뗄 때 (덜 출렁이게)
   * gripIn·gripOut = 가로 속도가 보드 방향을 따라가는 시간 상수 (뗄 때는 엣지를 세워 빨리 선다)
   * 속도: 드리프트 → 카빙. 미끄러지는 동안(slideAt 을 넘으면 "촤악" — slide 사건)은 dragSlip × 미끄러짐 만큼 감속한다.
   *   엣지가 물려(미끄러짐 < gripAt, 기울기 > carveLean) 카빙이 시작되면, 미끄러지며 잃은 속도(촤악 때 속도 − 지금) × carveGain 을
   *   carveTime 동안 붙인다 (carve 사건 — 최고 속도 위로 carveMax 까지). 카빙 없이 보드를 펴면 잃은 채로 끝.
   *   잃은 만큼만 돌려주니 좌우로 흔들어도 끝없이 빨라지지 않는다 (최고 속도 위에선 4 m/s² 로 돌아온다)
   */
  steer: 2.5,
  yawMax: 0.56,
  yawW: 15,
  yawZ: 0.45,
  yawWOut: 17,
  yawZOut: 0.7,
  gripIn: 0.14,
  gripOut: 0.07,
  /**
   * 처음 누를 때 저항 (2026-10-07 사용자 의견 — 누르자마자 휙휙 옆으로 갔다): 누르면 입력이 steerIn 초(시간 상수)에 걸쳐 차오른다 (떼면 바로 0).
   * 보드가 조금 묵직하게 꺾이고 몸도 그만큼 늦게 흐른다 — 0.2초 뒤 옆으로 간 거리가 약 40% 줄고, 촤악 → 카빙 손맛은 그대로.
   * (몸만 늦게 따라오게 하면 미끄러짐이 커져 감속이 너무 컸다)
   */
  steerIn: 0.07,
  dragSlip: 30,
  slideAt: 0.35,
  gripAt: 0.2,
  carveLean: 0.5,
  carveGain: 1.8,
  carveTime: 0.4,
  carveMax: 5,
  edge: 0.92,
  /**
   * 코스 (2026-10-07 사용자 의견 — 일자라 재미없다 → 둥근 굽이도 너무 스무스해 재미없다, 더 다이나믹하게):
   * 비스듬히 곧게 내려가는 다리(leg)와 짧고 날카로운 모퉁이(corner)가 왼쪽 · 오른쪽 번갈아 — 진짜 지그재그.
   * 다리 기울기(길 가운데가 1m 마다 옆으로 가는 양)는 처음 slope[0] → 결승 slope[1], 다리 길이 leg 처음 → 결승(± 35%),
   * 모퉁이 길이 corner 처음 → 결승 — 갈수록 급하고 잦고 날카롭다. 가장 급한 다리도 최고 속도에서 가로 1.5 (보드를 다 꺾은 2.5 의 60%).
   * 다리 대신 가끔: 넓은 직선(straightP — 폭 wide, 점프대 줄 · 슬랄롬 · 가속 발판 줄) · 시케인(chicaneP — 폭 narrow, 짧게 좌우 잇달아).
   * 처음 start m 와 결승 앞 finish m 는 곧게 (결승 앞 원근이 말리는 구간)
   */
  course: {
    start: 40,
    finish: 75,
    slope: [0.035, 0.062],
    leg: [44, 22],
    corner: [16, 8],
    straight: [36, 48],
    straightP: 0.2,
    chicaneP: 0.12,
    chicane: { slope: 0.05, leg: 11, corner: 6, legs: 3 },
    wide: 1.3,
    narrow: 0.8,
  },
  /**
   * 울타리: 넘지 못한다. 길이 꺾이거나 좁아져 울타리가 안쪽으로 밀고 오면 쓸리며 느려진다 (미는 빠르기 × fenceDrag m/s², 하트는 그대로).
   * 길이 가는 쪽 울타리에 대고 누르면 보드가 울타리를 따라 펴져 그냥 미끄러진다 — 다리에선 그쪽으로 붙어 타고, 모퉁이에서 반대로 넘어간다.
   * 쓸려서 느려지는 건 최고 속도의 fenceFloor 까지 (긴 다리를 내내 쓸려도 기어가지 않게)
   */
  fenceDrag: 7,
  fenceFloor: 0.65,
  /** 고양이 가로 반폭 · 앞뒤로 닿는 거리(m) */
  catR: 0.09,
  reach: 1.0,
  /**
   * 공중에선 좌우로 땅의 이만큼만 움직인다 (2026-10-07 사용자 의견 — 점프 중에도 땅과 똑같이 옆으로 가서 어색했다. 아예 못 움직이면 재미가 없어 살짝만).
   * 보드 각도 · 가로 속도는 땅에서처럼 계속 따라가고 옆으로 가는 거리만 줄인다 — 착지하면 끊김 없이 그대로 이어진다
   */
  airSteer: 0.2,
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
  /**
   * 결승선을 넘으면 그 속도로 미끄러지다 runout m/s² 로 서서히 선다 (조작은 안 먹는다), 결과 카드는 cardDelay 초 뒤에
   * (2026-10-07 사용자 의견 — 결승 쪽이 이상하다: 넘는 순간 그 자리에 딱 멈추고 카드가 바로 덮었다)
   */
  runout: 14,
  cardDelay: 0.9,
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

/**
 * 코스 조각 — d0 ~ d1 동안 길 가운데의 기울기(1m 마다 옆으로 가는 양, + = 오른쪽)가 s0 → s1 로 곧게 바뀐다.
 * 다리(leg) = 비스듬히 곧은 길(s0 = s1) · 모퉁이(corner) = 짧게 꺾임 · 시케인(chicane) = 짧은 다리와 모퉁이가 잇달아 ·
 * 넓은 직선(straight · jump — 점프대 줄) · 처음(start) · 결승(finish). kind 는 물건을 깔 때 쓴다
 */
export type SegKind = 'start' | 'leg' | 'corner' | 'chicane' | 'straight' | 'jump' | 'finish';
export type Seg = { d0: number; d1: number; c0: number; s0: number; s1: number; kind: SegKind };
/** 코스 = 조각들(거리 순) + 길 폭(반폭 배율, 1 = 보통)이 바뀌는 곳들 (사이는 부드럽게) */
export type Course = { segs: Seg[]; widths: { d: number; w: number }[] };
/** 곧은 길 (체크용) */
export const STRAIGHT: Course = { segs: [{ d0: -1e9, d1: 1e9, c0: 0, s0: 0, s1: 0, kind: 'start' }], widths: [{ d: 0, w: 1 }] };

/**
 * 코스를 깐다 — 처음은 곧게, 그 뒤 다리 · 모퉁이가 왼쪽 · 오른쪽 번갈아 (가끔 넓은 직선 · 시케인), 결승 앞은 곧게.
 * 폭은 구간이 바뀌는 모퉁이에 걸쳐 바뀐다 (넓은 직선 wide · 시케인 narrow · 나머지 1)
 */
export function makeCourse(rng: () => number): Course {
  const C = SAND.course;
  const segs: Seg[] = [{ d0: -1e9, d1: C.start, c0: 0, s0: 0, s1: 0, kind: 'start' }];
  const widths = [{ d: 0, w: 1 }];
  let d = C.start;
  let c = 0;
  let s = 0;
  let w = 1;
  let dir = rng() < 0.5 ? -1 : 1;
  let last: SegKind = 'start';
  let sinceChicane = 9; // 시케인은 사이에 다른 구간이 둘은 끼게 (몰려 나오지 않게)
  const lerp = (a: readonly number[], t: number) => a[0] + (a[1] - a[0]) * t;
  const push = (len: number, s1: number, kind: SegKind) => {
    segs.push({ d0: d, d1: d + len, c0: c, s0: s, s1, kind });
    c += ((s + s1) / 2) * len;
    s = s1;
    d += len;
  };
  const widen = (to: number) => {
    if (to === w) return;
    widths.push({ d: d - 6, w }, { d: d + 6, w: to });
    w = to;
  };
  const end = SAND.length - C.finish;
  for (;;) {
    const late = Math.min(1, d / SAND.length);
    const corner = lerp(C.corner, late) * (0.8 + 0.4 * rng());
    const r = rng();
    sinceChicane++;
    if (r < C.straightP && last !== 'straight' && last !== 'jump' && d > 120) {
      const len = lerp(C.straight, rng());
      if (d + corner + len + 20 > end) break;
      widen(C.wide);
      push(corner, 0, 'corner');
      last = rng() < 0.45 ? 'jump' : 'straight';
      push(len, 0, last);
    } else if (r < C.straightP + C.chicaneP && sinceChicane > 2 && d > 150) {
      const ch = C.chicane;
      if (d + ch.legs * (ch.corner + ch.leg) + 20 > end) break;
      widen(C.narrow);
      for (let i = 0; i < ch.legs; i++) {
        push(ch.corner, dir * ch.slope, 'chicane');
        push(ch.leg, dir * ch.slope, 'chicane');
        dir = -dir;
      }
      last = 'chicane';
      sinceChicane = 0;
    } else {
      const len = lerp(C.leg, late) * (0.65 + 0.7 * rng());
      if (d + corner + len + 20 > end) break;
      widen(1);
      const sl = dir * lerp(C.slope, late) * (0.85 + 0.15 * rng());
      push(corner, sl, 'corner');
      push(len, sl, 'leg');
      dir = -dir;
      last = 'leg';
    }
  }
  widen(1);
  push(C.corner[0], 0, 'corner');
  segs.push({ d0: d, d1: 1e9, c0: c, s0: 0, s1: 0, kind: 'finish' });
  return { segs, widths };
}
/** 거리 d 를 지나는 조각 */
export function segAt(course: Course, d: number) {
  const g = course.segs;
  let lo = 0;
  let hi = g.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (g[mid].d0 <= d) lo = mid;
    else hi = mid - 1;
  }
  return g[lo];
}
/** 거리 d 의 길 가운데 (가로 자리) */
export function center(course: Course, d: number) {
  const g = segAt(course, d);
  const u = Math.max(0, d - g.d0);
  return g.c0 + g.s0 * u + ((g.s1 - g.s0) * u * u) / (2 * (g.d1 - g.d0));
}
/** 거리 d 에서 길 가운데가 1m 마다 옆으로 가는 양 (+ = 오른쪽으로) */
export function slope(course: Course, d: number) {
  const g = segAt(course, d);
  return g.s0 + ((g.s1 - g.s0) * Math.max(0, d - g.d0)) / (g.d1 - g.d0);
}
/** 거리 d 의 길 폭(반폭 배율)과 1m 마다 바뀌는 양 — 바뀌는 곳 사이는 smoothstep */
export function width(course: Course, d: number) {
  const k = course.widths;
  let i = 0;
  while (i + 1 < k.length && k[i + 1].d <= d) i++;
  const a = k[i];
  const b = k[i + 1];
  if (!b || d <= a.d || a.w === b.w) return { w: a.w, dw: 0 };
  const L = b.d - a.d;
  const t = (d - a.d) / L;
  return { w: a.w + (b.w - a.w) * t * t * (3 - 2 * t), dw: ((b.w - a.w) * 6 * t * (1 - t)) / L };
}
/** 거리 d 의 양쪽 울타리(달릴 수 있는 끝) 가로 자리 · 속도 v 로 내려갈 때 울타리가 옆으로 가는 빠르기 (가로 자리/초) */
export function fences(course: Course, d: number, v = 0) {
  const c = center(course, d);
  const k = slope(course, d);
  const { w, dw } = width(course, d);
  const e = SAND.edge * w;
  return { c, w, lo: c - e, hi: c + e, vLo: (k - SAND.edge * dw) * v, vHi: (k + SAND.edge * dw) * v };
}
export type Fences = ReturnType<typeof fences>;

/** got = 주웠다 · hit = 이미 작동했다(부딪힘·뜀) */
export type Ob = { kind: ObKind; x: number; d: number; got?: boolean; hit?: boolean };
/** 그리기용 짧은 효과 (시트의 효과 id) · 떠오르는 글자 */
export type SandFx = { id: 'jump_puff' | 'land_burst' | 'hit_stars' | 'pickup_sparkle' | 'carve_spray'; x: number; d: number; t: number; flip?: number };
export type SandPop = { text: string; x: number; d: number; t: number };
export type SandEvent =
  | { type: 'coin'; n: number }
  | { type: 'jump' }
  | { type: 'land' }
  | { type: 'ramp' }
  | { type: 'bump' }
  | { type: 'boost' }
  | { type: 'pit' }
  /** 굽이 바깥 울타리에 쓸린다 (0.3초마다) */
  | { type: 'scrape' }
  | { type: 'slide'; k: number }
  | { type: 'carve'; gain: number }
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
  /** 보드 각도(라디안, + = 오른쪽) · 각속도 · 가로 속도(가로 자리/초) · 기울기 = 각도 / 최대 · 미끄러짐 0..1 · 기울어진 쪽(-1, 0, 1) */
  yaw: number;
  yawV: number;
  vx: number;
  lean: number;
  slip: number;
  steer: number;
  /** 차오르는 중인 좌우 입력 -1..1 (처음 저항) */
  steerU: number;
  /** 코스 (지그재그 조각들 · 폭) · 다음 쓸림 소리까지 */
  course: Course;
  scrapeT: number;
  /** 미끄러지는 중(촤악 뒤, 카빙 전) · 촤악 때 속도 · 카빙 가속이 남은 시간 · 그 가속(m/s²) */
  sliding: boolean;
  slideV: number;
  carveT: number;
  carveRate: number;
  flip: number;
  t: number;
  hearts: number;
  shield: number;
  magnet: number;
  boost: number;
  phase: 'play' | 'done';
  /** 끝난 뒤 시간 (결승 뒤 미끄러짐 · 결과 카드) */
  doneT: number;
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
    d: 0, x: 0, v: SAND.vMin, air: 0, airMax: 1, landT: 9, dizzy: 0, yaw: 0, yawV: 0, vx: 0, lean: 0, slip: 0, steer: 0, steerU: 0, course: STRAIGHT, scrapeT: 0, sliding: false, slideV: 0, carveT: 0, carveRate: 0, flip: 1, t: 0,
    hearts: SAND.hearts, shield: 0, magnet: 0, boost: 0, phase: 'play', doneT: 0, fell: false, coins: 0, crashes: 0, score: 0,
    obs: [], fx: [], pops: [], nextAt: 30, events: [], rng,
  };
  s.course = makeCourse(rng);
  spawn(s);
  return s;
}

const pick = <T>(s: SandState, list: readonly T[]) => list[Math.floor(s.rng() * list.length)];

/**
 * 앞쪽에 깐다. 갈수록 장애물이 잦고 많아진다. 부딪히는 것끼리는 서로 다른 레인 — 늘 지나갈 길이 있다.
 * 레인은 그 거리의 길 가운데 · 폭 기준. 구간마다 다르게: 모퉁이(와 그 8m 앞)는 비우고, 시케인은 길 가운데를 따라 냥코인,
 * 넓은 직선은 점프대 줄(모든 레인 — 구덩이 줄을 건너뛴다) · 슬랄롬(높은 장애물 좌우 번갈아, 반대쪽에 냥코인) · 가속 발판 줄,
 * 다리는 줄마다 장애물 · 냥코인 · 보상 (가끔 길이 가는 쪽 울타리 가까이에 냥코인 줄). 점프대 하나짜리는 처음 · 결승의 곧은 길에서만
 */
function spawn(s: SandState) {
  while (s.nextAt < s.d + SAND.ahead && s.nextAt < SAND.length - 25) {
    const d = s.nextAt;
    const late = d / SAND.length; // 0 → 1
    const g = segAt(s.course, d);
    const w = width(s.course, d).w;
    const lanes = SAND.lanes.map((l) => l * w);
    const add = (kind: ObKind, x: number, dd = d) => {
      const f = fences(s.course, dd);
      s.obs.push({ kind, x: f.c + clamp(x, -SAND.edge * f.w, SAND.edge * f.w), d: dd });
    };
    const coins = (x0: number, d0: number, n: number, slant = 0) => {
      for (let i = 0; i < n; i++) add('paw_coin', x0 + slant * i, d0 + i * 3);
    };
    const gap = SAND.gap[0] + s.rng() * (SAND.gap[1] - SAND.gap[0]) * (1 - late * 0.25);
    if (g.kind === 'chicane') {
      // 시케인: 꺾이는 길 가운데를 따라 냥코인 (장애물 없이 좌우로 잇달아 꺾기)
      let end = g.d1;
      for (const q of s.course.segs) if (q.kind === 'chicane' && q.d0 >= end - 1e-6 && q.d0 <= end + 1e-6) end = q.d1;
      for (let dd = d; dd < end - 2; dd += 3) add('paw_coin', 0, dd);
      s.nextAt = end; // 이어지는 모퉁이는 아래 모퉁이 규칙이 비운다
      continue;
    }
    // 모퉁이 · 시케인과 그 8m 앞, 모퉁이 12m 뒤는 장애물을 두지 않는다 — 꺾으며 길을 가로지르는 동안 피할 틈이 없다
    const turn = s.course.segs.find((q) => q.d0 < d + 8 && ((q.kind === 'corner' && q.d1 + 12 > d) || (q.kind === 'chicane' && q.d1 > d)));
    if (turn) {
      s.nextAt = turn.kind === 'chicane' ? turn.d0 : turn.d1 + 12;
      continue;
    }
    if (g.kind === 'jump' || g.kind === 'straight') {
      const d0 = g.d0 + 6; // 직선 처음부터 — 공중에 뜬 채 다음 모퉁이로 넘어가지 않게
      if (g.kind === 'jump') {
        // 점프대 줄: 모든 레인 → 크게 떠서 구덩이 줄을 건너뛰고 공중 냥코인 세 줄, 내려앉는 곳에 냥코인 더미
        for (const x of lanes) add('jump_ramp', x, d0);
        for (const x of lanes) add('sand_pit', x, d0 + 10);
        for (const x of [-0.5 * w, 0, 0.5 * w]) for (let i = 0; i < 4; i++) add('paw_coin', x, d0 + 5 + i * 4);
        add('coin_pile', 0, d0 + 25);
      } else if (s.rng() < 0.55) {
        // 슬랄롬: 높은 장애물(점프로 못 넘는다)이 좌우 번갈아, 반대쪽에 냥코인 — 다 주우려면 이리저리 꺾는다 (모퉁이 12m 뒤부터)
        let side = s.rng() < 0.5 ? -1 : 1;
        for (let dd = g.d0 + 12; dd < g.d1 - 8; dd += 10) {
          add(pick(s, TALL), side * 0.4 * w, dd);
          add('paw_coin', -side * 0.45 * w, dd);
          side = -side;
        }
      } else {
        // 가속 발판 줄: 가운데 세 레인 → 빨라진 채 냥코인 줄
        for (const x of [-0.4 * w, 0, 0.4 * w]) add('boost_pad', x, d0);
        coins(0, d0 + 8, 6);
      }
      s.nextAt = g.d1;
      continue;
    }
    const r = s.rng();
    const calm = g.kind === 'start' || g.kind === 'finish';
    if (g.kind === 'leg' && s.rng() < 0.25) {
      // 길이 가는 쪽 울타리 가까이에 냥코인 줄 — 그쪽으로 붙어 타면 줍는다. 가끔 반대쪽에 장애물 하나
      const lead = Math.sign(g.s1);
      coins(lead * 0.76 * w, d, 5);
      if (s.rng() < 0.3 + late * 0.3) add(pick(s, HIT), -lead * 0.45 * w);
    } else if (r < 0.36 + late * 0.12) {
      // 장애물 1~3개 (3개는 후반에만, 두 레인은 비운다)
      const n = s.rng() < 0.5 ? 1 : late > 0.45 && s.rng() < 0.35 ? 3 : 2;
      const at = [...lanes].sort(() => s.rng() - 0.5).slice(0, n);
      for (const x of at) add(s.rng() < 0.22 + late * 0.15 ? pick(s, TALL) : pick(s, HIT), x + (s.rng() - 0.5) * 0.06);
      // 빈 레인에 냥코인 한 줄 (가끔)
      if (s.rng() < 0.35) coins(pick(s, lanes.filter((l) => !at.includes(l))), d - 4, 3);
    } else if (r < 0.62) {
      coins(pick(s, lanes), d, 5, s.rng() < 0.4 ? (s.rng() < 0.5 ? -0.12 : 0.12) : 0);
    } else if (r < 0.71 && calm) {
      // 점프대 → 공중 냥코인 + 끝에 냥코인 더미
      const x0 = lanes[1 + Math.floor(s.rng() * 3)];
      add('jump_ramp', x0);
      for (let i = 0; i < 4; i++) add('paw_coin', x0, d + 6 + i * 3);
      if (s.rng() < 0.5) add('coin_pile', x0, d + 19);
    } else if (r < 0.78) {
      // 낮은 나무 울타리: 뛰어넘거나 가장자리로 돌아간다
      add('wood_barrier', pick(s, [-0.35, 0, 0.35]) * w);
    } else if (r < 0.84) {
      add('sand_pit', pick(s, lanes));
      if (s.rng() < 0.5) add('sand_pit', pick(s, lanes), d + 8);
    } else if (r < 0.89) {
      // 모래 둔덕 → 작은 뜀 + 냥코인
      const x0 = pick(s, lanes);
      add('sand_bump', x0);
      coins(x0, d + 5, 3);
    } else if (r < 0.94) {
      // 가속 발판 → 빨라진 채 냥코인 줄
      const x0 = lanes[1 + Math.floor(s.rng() * 3)];
      add('boost_pad', x0);
      coins(x0, d + 6, 6);
    } else {
      // 보상 하나: 자석 · 방패 · 하트 · 보물상자
      const p = s.rng();
      add(p < 0.35 ? 'magnet_pickup' : p < 0.65 ? 'shield_pickup' : p < 0.85 ? 'heart_pickup' : 'treasure_chest', pick(s, lanes));
    }
    s.nextAt += gap;
  }
}

const fx = (s: SandState, id: SandFx['id'], x = s.x, d = s.d, flip?: number) => s.fx.push({ id, x, d, t: 0, flip });

type Lateral = Pick<SandState, 'x' | 'vx' | 'yaw' | 'yawV'>;
/** 울타리가 안쪽으로 미는 빠르기 (닿은 쪽 −1 왼쪽 · 1 오른쪽) — 0 이면 안 민다 */
const pushOf = (f: Fences, at: number) => (at > 0 ? Math.max(0, -f.vHi) : at < 0 ? Math.max(0, f.vLo) : 0);
/**
 * 좌우 한 걸음 (u = 누르는 쪽 -1..1). 보드 각도 스프링 → 그립 지연으로 가로 속도 → 자리. 미끄러짐을 돌려준다.
 * f = 이 거리의 양쪽 울타리와 울타리가 옆으로 가는 빠르기. 울타리에선 선다 — 울타리 쪽으로 계속 누르면 보드가 울타리를 따라 펴지고
 * 미끄러짐은 0 (벽에 대고 누른다고 모래를 튀기며 느려지지 않게). 안쪽으로 오는 울타리(꺾이는 길 · 좁아지는 길)는 고양이를 밀고 간다
 */
function lateral(l: Lateral, u: number, dt: number, move: number, f: Fences) {
  // 울타리 쪽(-1, 0, 1). 여유 0.03: 펴진 보드가 살짝 넘쳐 울타리를 벗어났다 다시 꺾이기를 되풀이하지 않게 (떨림)
  const side = (x: number) => (x >= f.hi - 0.03 ? 1 : x <= f.lo + 0.03 ? -1 : 0);
  const at0 = side(l.x);
  const pinned = at0 !== 0 && Math.sign(u) === at0;
  const pressed = u !== 0;
  // 울타리에 눌려 보드가 펴질 땐 뗄 때 스프링으로 (덜 출렁이게 — 넘쳐 반대로 꺾이면 울타리에서 튕겨 나와 다시 촤악 했다).
  // 펴지는 방향은 그 울타리를 따라 (곧은 길이면 똑바로)
  const w = pressed && !pinned ? SAND.yawW : SAND.yawWOut;
  const z = pressed && !pinned ? SAND.yawZ : SAND.yawZOut;
  const aim = pinned ? clamp((at0 > 0 ? f.vHi : f.vLo) / SAND.steer, -1, 1) : u;
  l.yawV += (w * w * (aim * SAND.yawMax - l.yaw) - 2 * z * w * l.yawV) * dt;
  l.yaw += l.yawV * dt;
  const lean = l.yaw / SAND.yawMax;
  l.vx += (lean * SAND.steer - l.vx) * (1 - Math.exp(-dt / (pressed ? SAND.gripIn : SAND.gripOut)));
  l.x += l.vx * dt * move; // 공중이면 옆으로 가는 거리만 airSteer 배
  // 울타리는 못 넘는다. 길이 꺾이면 울타리와 같이 옆으로 간다
  if (l.x >= f.hi) {
    l.x = f.hi;
    l.vx = Math.min(f.vHi, l.vx);
  } else if (l.x <= f.lo) {
    l.x = f.lo;
    l.vx = Math.max(f.vLo, l.vx);
  }
  // 울타리로 밀고 있거나 울타리에 밀려 가면 미끄러짐 0 — 닿는 순간에도 "촤악" 하지 않는다 (밀려 가며 느려지는 건 울타리 몫)
  const at = side(l.x);
  return pinned || (at !== 0 && (Math.sign(l.yaw) === at || pushOf(f, at) > 0)) ? 0 : Math.min(1, Math.abs(lean - l.vx / SAND.steer));
}

/** 지금 손을 떼면 secs 초 뒤 어디 있나 — 공중이면 남은 공중 시간 동안은 airSteer 만큼만, 울타리에 밀리는 것까지 (자동 조종 · 검증용) */
export function coast(s: Lateral & { air?: number; d?: number; v?: number; course?: Course }, secs = 1) {
  const l = { x: s.x, vx: s.vx, yaw: s.yaw, yawV: s.yawV };
  let air = s.air ?? 0;
  let d = s.d ?? 0;
  const v = s.v ?? 0;
  const course = s.course ?? STRAIGHT;
  for (let i = 0; i < Math.round(secs * 60); i++) {
    // 한 프레임과 같은 차례 — 공중 시간을 줄이고 앞으로 간 뒤 옆으로
    air -= 1 / 60;
    d += v / 60;
    lateral(l, 0, 1 / 60, air > 0 ? SAND.airSteer : 1, fences(course, d, v));
  }
  return l.x;
}
const pop = (s: SandState, text: string, x: number, d: number) => s.pops.push({ text, x, d, t: 0 });

function finish(s: SandState, fell: boolean) {
  s.phase = 'done';
  s.doneT = 0;
  s.fell = fell;
  const clean = !fell && s.crashes === 0;
  s.score = s.coins + (clean ? SAND.cleanBonus : 0);
  s.events.push({ type: 'finish', coins: s.coins, secs: s.t, clean, fell, score: s.score });
  if (fell) return;
  // 골인: 결승선을 따라 반짝임이 터진다
  const f = fences(s.course, s.d);
  for (let i = 0; i < 7; i++) fx(s, 'pickup_sparkle', f.lo + ((f.hi - f.lo) * i) / 6, s.d + 0.6);
  pop(s, '골인!', s.x, s.d);
}

/** 결승 뒤: 조작 없이 그 속도로 미끄러지다 서서히 선다 — 보드는 펴지고 울타리 안에서 */
function runOut(s: SandState, dt: number) {
  s.v = Math.max(0, s.v - SAND.runout * dt);
  s.d += s.v * dt;
  const ease = 1 - Math.exp(-dt / 0.15);
  s.yaw -= s.yaw * ease;
  s.yawV = 0;
  s.vx -= s.vx * ease;
  const f = fences(s.course, s.d);
  s.x = clamp(s.x + s.vx * dt, f.lo, f.hi);
  s.lean = s.yaw / SAND.yawMax;
  s.slip = 0;
}

/** 한 프레임. mx = 좌우 -1..1, jump = 이번 프레임에 눌렀다 */
export function updateSandboard(s: SandState, input: SandInput, dt: number) {
  s.events.length = 0;
  for (const f of s.fx) f.t += dt;
  for (const p of s.pops) p.t += dt;
  s.fx = s.fx.filter((f) => f.t < FX_TIME);
  s.pops = s.pops.filter((p) => p.t < POP_TIME);
  if (s.phase !== 'play') {
    s.doneT += dt;
    if (!s.fell) runOut(s, dt);
    return;
  }
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
  // 앞으로 먼저 — 좌우는 이번 프레임이 끝나는 거리의 울타리에 맞춘다 (그리는 자리와 같게)
  s.d += s.v * dt;
  // 좌우 = 드리프트: 보드가 먼저 꺾이고 몸이 늦게 따라온다. 그 차이(미끄러짐)만큼 모래를 튀기고 속도를 깎는다
  const want = s.dizzy > 0 ? 0 : clamp(input.mx, -1, 1);
  // 처음 저항: 누르면 입력이 steerIn 초에 걸쳐 차오른다 (반대로 누르면 그쪽으로 넘어가며, 떼면 바로 0)
  s.steerU = want === 0 ? 0 : s.steerU + (want - s.steerU) * (1 - Math.exp(-dt / SAND.steerIn));
  const f = fences(s.course, s.d, s.v);
  s.slip = lateral(s, s.steerU, dt, s.air > 0 ? SAND.airSteer : 1, f);
  // 안쪽으로 오는 울타리에 밀려 가면 쓸리며 느려진다 (하트는 그대로) — 0.3초마다 모래 · 소리
  const touch = s.x >= f.hi - 1e-6 ? 1 : s.x <= f.lo + 1e-6 ? -1 : 0;
  const push = pushOf(f, touch);
  if (push > 0.1 && s.air <= 0 && s.dizzy <= 0) {
    s.v -= Math.max(0, Math.min(s.v - SAND.vMax * SAND.fenceFloor, SAND.fenceDrag * push * dt));
    if ((s.scrapeT -= dt) <= 0) {
      s.scrapeT = 0.3;
      fx(s, 'carve_spray', s.x, s.d - 0.6, -touch);
      s.events.push({ type: 'scrape' });
    }
  } else s.scrapeT = 0;
  s.lean = s.yaw / SAND.yawMax;
  s.steer = Math.abs(s.lean) > 0.12 ? Math.sign(s.lean) : 0;
  if (s.steer !== 0) s.flip = s.steer;
  if (s.air <= 0) {
    // 드리프트: 미끄러지는 만큼 깎는다 (넘어진 뒤 느린 속도를 더 깎지는 않는다)
    s.v -= Math.max(0, Math.min(s.v - SAND.vMin * 0.6, SAND.dragSlip * s.slip * dt));
    if (s.slip > SAND.slideAt && !s.sliding) {
      s.sliding = true;
      s.slideV = s.v;
      // 꼬리 뒤 바깥쪽 바닥에 남긴다 (치즈 몸을 덮지 않게)
      const out = -Math.sign(s.yaw) || 1;
      fx(s, 'carve_spray', s.x + out * 0.07, s.d - 0.9, out);
      s.events.push({ type: 'slide', k: s.slip });
    }
    // 카빙: 엣지가 물렸다 — 모아 둔 속도를 더 크게 돌려준다
    if (s.sliding && s.slip < SAND.gripAt && Math.abs(s.lean) > SAND.carveLean) {
      s.sliding = false;
      const gain = Math.max(0, s.slideV - s.v) * SAND.carveGain;
      s.carveRate = gain / SAND.carveTime;
      s.carveT = SAND.carveTime;
      s.events.push({ type: 'carve', gain });
    }
  }
  // 카빙 없이 보드를 폈으면 드리프트는 잃은 채로 끝
  if (s.sliding && s.slip < SAND.slideAt * 0.4 && Math.abs(s.lean) < SAND.carveLean) s.sliding = false;
  if (s.carveT > 0) {
    s.carveT -= dt;
    s.v = Math.min(top + SAND.carveMax, s.v + s.carveRate * dt);
  }

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
        s.vx = s.yaw = s.yawV = 0;
        s.sliding = false;
        s.carveT = 0;
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
