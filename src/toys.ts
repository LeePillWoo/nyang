/**
 * 놀아 주기 미니게임 셋 (2026-10-08 밤 사용자 요청 — "지금은 놀아 주면 시트 몇 개 나오고 끝, 깃털 흔들어서 잡기 같은 간단한 미니게임 3개 정도"):
 *  🪶 깃털 흔들기 — 깃털을 흔들어(친구 앞에서 움직이면) 신나게 → 가득 차면 엉덩이를 씰룩(!) → 그동안 깃털을 멈춰 두면 덮쳐서 잡는다. 15초, 잡은 수.
 *  📦 상자 숨바꼭질 — 친구가 상자 셋 중 하나에 쏙 → 상자가 섞인다(판마다 더 많이 · 빨리) → 어느 상자인지 고른다. 세 판, 맞힌 수.
 *  🧶 털실 공 굴리기 — 오가는 힘 막대를 멈춰 공을 굴린다 → 친구 앞 칸(던질 때마다 자리가 바뀌고 좁아진다)에 서면 덮친다. 세 번, 맞힌 수.
 * 점수 → 별 1~3 (했으면 적어도 ★). 별을 친해지는 점수로 바꾸는 건 village.ts playToy. 그림을 불러오지 않는 순수 로직 (그리기는 toys-draw.ts),
 * 무작위는 rng 로 넣어 node 에서 체크된다. 좌표: 깃털 · 친구는 놀이판 가로 -1..1, 상자는 자리 0 · 1 · 2, 공은 굴러간 거리 0..1.
 */
export type ToyId = 'feather' | 'box' | 'yarn';
export const TOY_IDS: ToyId[] = ['feather', 'box', 'yarn'];
export const TOYS: Record<ToyId, { name: string; emoji: string; how: string }> = {
  feather: { name: '깃털 흔들기', emoji: '🪶', how: '친구 앞에서 깃털을 흔들어 신나게 해 줘요. 엉덩이를 씰룩이면(!) 멈춰서 잡게!' },
  box: { name: '상자 숨바꼭질', emoji: '📦', how: '친구가 숨은 상자를 잘 보세요. 상자가 섞인 뒤 골라요' },
  yarn: { name: '털실 공 굴리기', emoji: '🧶', how: '힘 막대를 멈춰 털실 공을 굴려요. 친구 앞 노란 칸에 서면 덮쳐요' },
};
export const isToy = (id: string | null): id is ToyId => !!id && id in TOYS;

/** 깃털: 시간 · 키로 움직이는 빠르기(판/초) · 손가락을 따라가는 빠르기 · 친구가 보는 범위 · 흔든 만큼 차오름 · 가만히 · 멀면 줄어듦 · 씰룩 · 덮치기 · 잡았다고 칠 거리 · 끝나고 쉬는 시간 ·
 *  이만큼 놓치면 씰룩일 때 "지금 멈추세요!" 말풍선 (2026-10-12 사용자 — 멈춰서 잡는 규칙을 잘 모르겠다) */
export const FEATHER = { time: 15, speed: 2.4, follow: 14, range: 0.75, gain: 0.32, decay: 0.3, still: 0.1, crouch: 0.7, pounce: 0.35, hold: 0.22, after: 0.9, tip: 2 };
/** 상자: 판 수 · 숨는 모습 · 판마다 섞는 수 · 한 번 섞는 시간 · 열어 보이는 시간 */
export const BOX = { rounds: 3, show: 1.1, swaps: [3, 5, 7], swapT: [0.55, 0.42, 0.32], reveal: 1.3 };
/** 공: 던지는 수 · 힘 막대 빠르기(왕복/초 — 2026-10-12 사용자 "좀 빠르다", 0.9 · 1.15 · 1.4 에서 줄임) · 친구 앞 칸 폭 · 친구 자리 · 굴러가는 시간 · 보고 넘어가는 시간 */
export const YARN = { throws: 3, speed: [0.6, 0.75, 0.9], zone: [0.22, 0.17, 0.13], spots: [0.55, 0.82, 0.38], roll: 1.1, after: 1.2 };

export type ToyEvent = { type: 'crouch' | 'pounce' | 'catch' | 'miss' | 'hide' | 'swap' | 'pick' | 'right' | 'wrong' | 'roll' | 'hit' | 'short' | 'long' | 'done' };
type Base = { phase: 'play' | 'done'; t: number; score: number; stars: number; events: ToyEvent[]; rng: () => number };
export type FeatherGame = Base & {
  id: 'feather';
  /** 깃털 자리 · 빠르기 */
  fx: number;
  vx: number;
  /** 신남 0..1 */
  ex: number;
  /** 친구: 보기 · 씰룩 · 덮치기 · 잡음 · 놓침 — ct 그 단계 시간, aim 노린 자리, catX 친구 자리, px0 뛰기 시작한 자리 */
  cat: 'watch' | 'crouch' | 'pounce' | 'catch' | 'miss';
  ct: number;
  aim: number;
  catX: number;
  px0: number;
  /** 놓친 수 — FEATHER.tip 번이면 씰룩일 때 말풍선 */
  misses: number;
};
export type BoxGame = Base & {
  id: 'box';
  round: number;
  stage: 'show' | 'shuffle' | 'pick' | 'reveal';
  st: number;
  /** 상자 → 자리 (0 · 1 · 2), 친구가 든 상자, 이번 판에 섞을 자리 짝, 지금 섞는 차례 */
  slots: number[];
  cat: number;
  swaps: [number, number][];
  si: number;
  /** 고른 자리 · 맞혔나 · 키보드 고르기 칸 */
  picked: number | null;
  right: boolean;
  sel: number;
};
export type YarnGame = Base & {
  id: 'yarn';
  n: number;
  stage: 'aim' | 'roll' | 'after';
  st: number;
  /** 힘 0..1 (오간다) · 오가는 쪽 · 굴린 힘 · 친구 자리 · 칸 폭 · 결과 */
  power: number;
  dir: number;
  dist: number;
  spot: number;
  zone: number;
  res: 'hit' | 'short' | 'long' | null;
};
export type ToyGame = FeatherGame | BoxGame | YarnGame;

const base = (rng: () => number): Base => ({ phase: 'play', t: 0, score: 0, stars: 0, events: [], rng });
/** 점수 → 별 (했으면 적어도 하나) */
export const starsOf = (score: number) => (score >= 3 ? 3 : score === 2 ? 2 : 1);

export function makeToy(id: ToyId, rng: () => number = Math.random): ToyGame {
  if (id === 'feather') return { ...base(rng), id, fx: 0.6, vx: 0, ex: 0, cat: 'watch', ct: 0, aim: 0, catX: 0, px0: 0, misses: 0 };
  if (id === 'box') return newRound({ ...base(rng), id, round: 0, stage: 'show', st: 0, slots: [0, 1, 2], cat: 0, swaps: [], si: 0, picked: null, right: false, sel: 1 });
  return { ...base(rng), id, n: 0, stage: 'aim', st: 0, power: 0, dir: 1, dist: 0, spot: YARN.spots[0], zone: YARN.zone[0], res: null };
}
function finish(g: ToyGame) {
  g.phase = 'done';
  g.stars = starsOf(g.score);
  g.events.push({ type: 'done' });
}

// ── 상자 ──
/** 새 판: 친구가 아무 상자에나 쏙 (상자 자리는 그대로) · 섞을 짝을 미리 정한다 */
function newRound(g: BoxGame): BoxGame {
  g.stage = 'show';
  g.st = 0;
  g.cat = Math.floor(g.rng() * 3);
  g.picked = null;
  g.right = false;
  g.si = 0;
  const pairs: [number, number][] = [[0, 1], [1, 2], [0, 2]];
  g.swaps = Array.from({ length: BOX.swaps[g.round] }, () => pairs[Math.floor(g.rng() * 3)]);
  g.events.push({ type: 'hide' });
  return g;
}
/** 지금 섞는 중이면 그 짝과 진행 (0..1) — 그리기가 쓴다 */
export function swapNow(g: BoxGame): { a: number; b: number; k: number } | null {
  if (g.stage !== 'shuffle' || g.si >= g.swaps.length) return null;
  const T = BOX.swapT[g.round];
  return { a: g.swaps[g.si][0], b: g.swaps[g.si][1], k: Math.min(1, (g.st - g.si * T) / T) };
}
/** 상자를 고른다 (자리 0 · 1 · 2) */
export function toyPick(g: ToyGame, slot: number) {
  if (g.id !== 'box' || g.phase !== 'play' || g.stage !== 'pick' || slot < 0 || slot > 2) return;
  g.picked = slot;
  g.right = g.slots[g.cat] === slot;
  if (g.right) g.score++;
  g.stage = 'reveal';
  g.st = 0;
  g.events.push({ type: 'pick' }, { type: g.right ? 'right' : 'wrong' });
}
/** 키보드로 고르는 칸 옮기기 */
export function toyMove(g: ToyGame, d: number) {
  if (g.id === 'box' && g.stage === 'pick') g.sel = Math.max(0, Math.min(2, g.sel + d));
}

// ── 공 ──
/** 누르기 (Space · Enter · 화면) — 공은 굴리기, 상자는 고른 칸 열기 */
export function toyPress(g: ToyGame) {
  if (g.phase !== 'play') return;
  if (g.id === 'box') return toyPick(g, g.sel);
  if (g.id !== 'yarn' || g.stage !== 'aim') return;
  g.dist = g.power;
  g.stage = 'roll';
  g.st = 0;
  g.events.push({ type: 'roll' });
}
/** 굴러간 자리 (0..1) — 처음엔 빠르고 멈출 때 느리게, 멈춘 뒤엔 그 자리 (after 에서 st 가 0 부터 다시 세어 공이 한 번 더 굴러 보였다) */
export const ballAt = (g: YarnGame) => (g.stage === 'aim' ? 0 : g.stage === 'after' ? g.dist : g.dist * (1 - (1 - Math.min(1, g.st / YARN.roll)) ** 2));

/** 한 프레임. x = 깃털을 둘 자리(손가락 · 마우스, 없으면 null), dir = 키 (-1 · 0 · 1) */
export function updateToy(g: ToyGame, input: { x: number | null; dir: number }, dt: number) {
  g.events.length = 0;
  if (g.phase !== 'play') return;
  g.t += dt;
  if (g.id === 'feather') return stepFeather(g, input, dt);
  if (g.id === 'box') {
    g.st += dt;
    if (g.stage === 'show' && g.st >= BOX.show) [g.stage, g.st] = ['shuffle', 0];
    if (g.stage === 'shuffle') {
      const T = BOX.swapT[g.round];
      while (g.si < g.swaps.length && g.st >= (g.si + 1) * T) {
        const [a, b] = g.swaps[g.si];
        g.slots = g.slots.map((s) => (s === a ? b : s === b ? a : s));
        g.si++;
        g.events.push({ type: 'swap' });
      }
      if (g.si >= g.swaps.length) [g.stage, g.st] = ['pick', 0];
    }
    if (g.stage === 'reveal' && g.st >= BOX.reveal) {
      g.round++;
      if (g.round >= BOX.rounds) finish(g);
      else newRound(g);
    }
    return;
  }
  // 공
  g.st += dt;
  if (g.stage === 'aim') {
    g.power += g.dir * YARN.speed[g.n] * 2 * dt;
    if (g.power > 1) [g.power, g.dir] = [2 - g.power, -1];
    if (g.power < 0) [g.power, g.dir] = [-g.power, 1];
  } else if (g.stage === 'roll' && g.st >= YARN.roll) {
    const d = g.dist - g.spot;
    g.res = Math.abs(d) <= g.zone / 2 ? 'hit' : d < 0 ? 'short' : 'long';
    if (g.res === 'hit') g.score++;
    g.events.push({ type: g.res });
    [g.stage, g.st] = ['after', 0];
  } else if (g.stage === 'after' && g.st >= YARN.after) {
    g.n++;
    if (g.n >= YARN.throws) return finish(g);
    Object.assign(g, { stage: 'aim', st: 0, power: 0, dir: 1, dist: 0, res: null, spot: YARN.spots[g.n], zone: YARN.zone[g.n] });
  }
}

function stepFeather(g: FeatherGame, input: { x: number | null; dir: number }, dt: number) {
  const F = FEATHER;
  const was = g.fx;
  if (input.dir) g.fx += input.dir * F.speed * dt;
  else if (input.x !== null) g.fx += (input.x - g.fx) * Math.min(1, F.follow * dt);
  g.fx = Math.max(-1, Math.min(1, g.fx));
  g.vx = (g.fx - was) / Math.max(dt, 1e-6);
  g.ct += dt;
  if (g.cat === 'watch') {
    g.catX += (0 - g.catX) * Math.min(1, 2 * dt); // 제자리로
    const near = Math.abs(g.fx - g.catX) <= F.range;
    const moving = Math.abs(g.vx) > F.still;
    g.ex = Math.max(0, Math.min(1, g.ex + (near && moving ? Math.abs(g.vx) * F.gain : -F.decay) * dt));
    if (g.t >= F.time) return finish(g); // 시간이 끝나면 (덮치는 중이면 그것까지 보고)
    if (g.ex >= 1) {
      Object.assign(g, { cat: 'crouch', ct: 0, aim: g.fx });
      g.events.push({ type: 'crouch' });
    }
  } else if (g.cat === 'crouch' && g.ct >= F.crouch) {
    Object.assign(g, { cat: 'pounce', ct: 0, px0: g.catX });
    g.events.push({ type: 'pounce' });
  } else if (g.cat === 'pounce') {
    g.catX = g.px0 + (g.aim - g.px0) * Math.min(1, g.ct / F.pounce);
    if (g.ct >= F.pounce) {
      const got = Math.abs(g.fx - g.aim) <= F.hold;
      if (got) g.score++;
      else g.misses++;
      Object.assign(g, { cat: got ? 'catch' : 'miss', ct: 0, ex: got ? 0 : 0.35 });
      g.events.push({ type: got ? 'catch' : 'miss' });
    }
  } else if ((g.cat === 'catch' || g.cat === 'miss') && g.ct >= F.after) Object.assign(g, { cat: 'watch', ct: 0 });
}
