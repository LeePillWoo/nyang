// node src/chase.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { CHASE, inArena, left, makeChase, maxAt, updateChase, type ChaseState, type Runner } from './chase.ts';
import data from './data/field.json' with { type: 'json' };
import { active, SQ_T } from './squirrel.ts';

const C = data.catBody;
const V = data.vertical;
const DT = 1 / 60;
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
/**
 * 한 판을 돌린다. mode: 'still' 가만히(첫 걸음만) · 'perfect' 가장 가까운 다람쥐를 바로 · 'human' 0.3초 늦게 본 자리를 키보드 8방향으로.
 * 매 프레임 불변식(고양이 · 다람쥐는 공터 안, 한꺼번에 나온 수)을 본다
 */
function play(seed: number, mode: 'still' | 'perfect' | 'human', onFrame?: (s: ChaseState) => void) {
  const s = makeChase(seeded(seed));
  const trail = new Map<Runner, number[][]>();
  let frame = 0;
  while (s.phase !== 'done' && frame < 70 / DT) {
    let mx = 0;
    let my = 0;
    if (frame === 0) mx = 1; // 첫 걸음 (시간이 가기 시작한다)
    const live = s.runners.filter((r) => active(r.q) && r.q.phase !== 'hop');
    for (const r of s.runners) trail.set(r, [...(trail.get(r) ?? []), [r.q.x, r.q.y]].slice(-19));
    if (mode !== 'still' && live.length) {
      const near = live.sort((a, b) => Math.hypot(a.q.x - s.cat.x, a.q.y - s.cat.y) - Math.hypot(b.q.x - s.cat.x, b.q.y - s.cat.y))[0];
      const [tx, ty] = mode === 'human' ? trail.get(near)![0] : [near.q.x, near.q.y];
      const dx = tx - s.cat.x;
      const dy = (ty - s.cat.y) / V;
      if (mode === 'human') {
        const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        [mx, my] = Math.hypot(dx, dy) > 3 ? [Math.round(Math.cos(a)), Math.round(Math.sin(a))] : [0, 0];
      } else {
        const d = Math.hypot(dx, dy) || 1;
        [mx, my] = [dx / d, dy / d];
      }
    }
    updateChase(s, { mx, my }, DT);
    onFrame?.(s);
    frame++;
  }
  return s;
}

// 1) 첫 걸음 전엔 시간이 안 가고 다람쥐도 안 나온다
{
  const s = makeChase(seeded(1));
  for (let i = 0; i < 120; i++) updateChase(s, { mx: 0, my: 0 }, DT);
  assert.ok(s.phase === 'ready' && left(s) === CHASE.time && s.runners.length === 0, '첫 걸음 전엔 그대로');
  updateChase(s, { mx: 1, my: 0 }, DT);
  assert.equal(s.phase, 'play', '걸으면 시작');
}

// 2) 한 판: 고양이 · 다람쥐는 공터 안, 한꺼번에 나온 수는 maxAt 까지, 수풀이 warn 초 흔들린 뒤 튀어나온다,
//    고양이 가까운 수풀에선 안 나온다, 10초 남으면 hurry, 60초에 끝 · 남은 다람쥐는 숨는다 · 보상
{
  let hurry = 0;
  const rustled = new Map<string, number>();
  const s = play(3, 'human', (s) => {
    assert.ok(inArena(s.cat.x, s.cat.y, 0.95), '고양이는 공터 안');
    if (s.phase === 'play') {
      assert.ok(s.runners.length + s.bushes.filter((b) => b.warn > 0).length <= maxAt(s.t), `한꺼번에 ${maxAt(s.t)}마리까지`);
      for (const r of s.runners) if (active(r.q) && r.q.phase !== 'hop') assert.ok(inArena(r.q.x, r.q.y, 0.95), `다람쥐는 공터 안 (${r.q.phase})`);
    }
    for (const e of s.events) {
      if (e.type === 'hurry') hurry++;
      if (e.type === 'rustle') {
        rustled.set(`${e.x},${e.y}`, s.t);
        assert.ok(Math.hypot(e.x - s.cat.x, (e.y - s.cat.y) / V) > CHASE.near * C, '고양이 가까운 수풀에선 안 나온다');
      }
      if (e.type === 'squirrel' && e.what === 'appear') {
        const t0 = rustled.get(`${e.x},${e.y}`);
        assert.ok(t0 !== undefined && Math.abs(s.t - t0 - CHASE.warn) < 0.05, `수풀이 ${CHASE.warn}초 흔들린 뒤 튀어나온다`);
      }
    }
  });
  assert.ok(s.phase === 'done' && Math.abs(s.t - CHASE.time) < 0.05, `${CHASE.time}초에 끝 (${s.t.toFixed(2)})`);
  assert.equal(hurry, 1, '10초 남으면 한 번 알린다');
  assert.ok(s.runners.every((r) => r.q.phase === 'gone' || r.q.phase === 'caught'), '끝나면 남은 다람쥐는 숨는다');
  assert.ok(s.coins === s.points * CHASE.coin && s.acorns === Math.min(CHASE.acornMax, s.caught), '보상: 냥코인 = 점수 × coin · 도토리 = 잡은 수');
  for (let i = 0; i < SQ_T.gone / DT + 2; i++) updateChase(s, { mx: 1, my: 0 }, DT);
  assert.ok(s.runners.length === 0 && s.cat.moving === false, '끝난 뒤엔 고양이가 안 움직이고 다람쥐는 사라진다');
}

// 3) 잡기 · 황금 다람쥐 3마리 몫 · 도토리에 맞으면 멍해서 잠깐 못 움직인다
{
  const s = makeChase(seeded(7));
  updateChase(s, { mx: 1, my: 0 }, DT);
  for (let i = 0; i < 6 / DT && !s.runners.some((r) => r.q.phase === 'run' || r.q.phase === 'rest'); i++) updateChase(s, { mx: 0, my: 0 }, DT);
  const r = s.runners.find((r) => r.q.phase === 'run' || r.q.phase === 'rest')!;
  assert.ok(r, '다람쥐가 나온다');
  r.gold = true;
  [s.cat.x, s.cat.y] = [r.q.x, r.q.y];
  updateChase(s, { mx: 0, my: 0 }, DT);
  assert.ok(r.q.phase === 'caught' && s.points === CHASE.goldPoints && s.golds === 1 && s.caught === 1, `황금 다람쥐는 ${CHASE.goldPoints}점`);
  s.cat.stun = 0;
  s.events.length = 0;
  s.cat.stun = CHASE.stun;
  const x0 = s.cat.x;
  for (let i = 0; i < 10; i++) updateChase(s, { mx: 1, my: 0 }, DT);
  assert.equal(s.cat.x, x0, '멍한 동안은 못 움직인다');
  for (let i = 0; i < CHASE.stun / DT + 2; i++) updateChase(s, { mx: 1, my: 0 }, DT);
  assert.ok(s.cat.x > x0, '멍이 풀리면 움직인다');
}

// 4) 손맛: 사람처럼(0.3초 늦게 · 키보드 8방향) 쫓으면 60초에 10마리 안팎, 바로 쫓으면 더, 가만히 있으면 거의 못 잡는다
{
  const avg = (mode: 'still' | 'perfect' | 'human') => {
    let p = 0;
    let n = 0;
    let spawned = 0;
    for (let seed = 1; seed <= 30; seed++) {
      let appear = 0;
      const s = play(seed, mode, (s) => (appear += s.events.filter((e) => e.type === 'squirrel' && e.what === 'appear').length));
      p += s.points;
      n += s.caught;
      spawned += appear;
    }
    return { points: p / 30, caught: n / 30, spawned: spawned / 30 };
  };
  const human = avg('human');
  const perfect = avg('perfect');
  const still = avg('still');
  assert.ok(human.caught >= 7 && human.caught <= 18, `사람처럼 쫓으면 60초에 ${human.caught.toFixed(1)}마리`);
  assert.ok(perfect.caught > human.caught, `바로 쫓으면 더 (${perfect.caught.toFixed(1)})`);
  assert.ok(still.caught < 1.5, `가만히 있으면 ${still.caught.toFixed(1)}마리`);
  console.log(
    `  다람쥐 잡기 30판: 나온 다람쥐 평균 ${human.spawned.toFixed(1)} · 사람처럼 ${human.caught.toFixed(1)}마리 (${human.points.toFixed(1)}점) · 바로 쫓으면 ${perfect.caught.toFixed(1)}마리 · 가만히 ${still.caught.toFixed(1)}마리`,
  );
}

console.log('chase.check: ok');
