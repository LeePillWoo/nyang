// node src/mini/training.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { ballIn, makeTraining, timeLeft, TRAIN, updateTraining, type Dir, type TrainEvent, type TrainState } from './training.ts';

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const dt = 1 / 60;
/** 한 프레임 — 치기 · 구르기 · 아무것도 */
const step = (s: TrainState, punches: Dir[] = [], roll = false) => updateTraining(s, { punches, roll }, dt);
const trainPunch = (s: TrainState, d: Dir) => step(s, [d]);
const trainRoll = (s: TrainState) => step(s, [], true);
/** 끝날 때까지 — react = 빛난 뒤 몇 초에 치나(null 이면 안 침) · dodge = 공이 닿기 몇 초 전에 구르나(null 이면 안 구름) */
function play(s: TrainState, react: number | null, dodge: number | null, secs = 60) {
  const ev: TrainEvent[] = [];
  step(s, [s.lit!.dir]); // 첫 주먹으로 시작
  ev.push(...s.events);
  for (let i = 0; i < secs * 60 && s.phase !== 'done'; i++) {
    const hit = react !== null && s.lit && s.lit.t >= Math.min(react, s.lit.life - 0.02) ? [s.lit.dir] : [];
    const b = ballIn(s);
    step(s, hit, dodge !== null && b <= dodge && b > dodge - 0.05);
    ev.push(...s.events);
  }
  return ev;
}

// 1) 첫 주먹 전엔 시간이 안 가고 빛난 허수아비도 안 꺼진다
{
  const s = makeTraining(seeded(1));
  assert.ok(s.lit && (s.lit.dir === 1 || s.lit.dir === 3), '처음부터 옆 허수아비 하나가 빛난다 (위는 안내 글이 가린다)');
  for (let i = 0; i < 300; i++) step(s);
  assert.equal(s.phase, 'ready');
  assert.equal(s.t, 0);
  assert.ok(s.lit && s.lit.t === 0, '안 꺼진다');
  assert.equal(s.ball, null, '공도 없다');
}

// 2) 빨리 치면 딱(2점), 늦게 치면 1점 · 친 허수아비는 꺼지고 쉬었다 다음 (바로 앞과 다른 방향)
{
  const s = makeTraining(seeded(2));
  const d0 = s.lit!.dir;
  trainPunch(s, d0);
  assert.equal(s.score, 2, '바로 치면 딱!');
  assert.equal(s.lit, null);
  let n = 0;
  while (!s.lit && n++ < 120) step(s);
  assert.ok(s.lit && s.lit.dir !== d0, '다음 허수아비는 다른 방향');
  while (s.lit.t < s.lit.life * 0.8) step(s);
  trainPunch(s, s.lit.dir);
  assert.equal(s.score, 3, '늦게 치면 1점');
  assert.equal(s.combo, 2);
}

// 3) 헛손질: 연속이 끊기고 잠깐 멈칫 (그동안은 쳐도 안 된다) · 놓치면 연속이 끊긴다
{
  const s = makeTraining(seeded(3));
  trainPunch(s, s.lit!.dir);
  while (!s.lit) step(s);
  const wrong = ((s.lit.dir + 1) % 4) as 0 | 1 | 2 | 3;
  trainPunch(s, wrong);
  assert.equal(s.combo, 0, '헛손질이면 연속 끊김');
  assert.ok(s.stun > 0);
  trainPunch(s, s.lit.dir);
  assert.equal(s.hits, 1, '멈칫 동안은 안 쳐진다');
  for (let i = 0; i < TRAIN.whiff * 60 + 2; i++) step(s);
  while (!s.lit) step(s);
  trainPunch(s, s.lit.dir);
  assert.equal(s.hits, 2, '멈칫이 풀리면 쳐진다');
  const m = makeTraining(seeded(4));
  trainPunch(m, m.lit!.dir);
  let missed = false;
  for (let i = 0; i < 240 && !missed; i++) {
    step(m);
    missed = m.events.some((e) => e.type === 'miss');
  }
  assert.ok(missed && m.combo === 0, '빛이 꺼질 때까지 안 치면 놓침');
}

// 4) 연속 combo 번마다 보너스
{
  const s = makeTraining(seeded(5));
  const ev = play(s, 0.1, 0.2, 12);
  assert.ok(ev.some((e) => e.type === 'bonus'), '연속 보너스');
}

// 5) 공: 닿기 직전에 구르면 피하고, 너무 일찍 구르면 맞는다 · 구르는 동안은 못 친다
{
  const s = makeTraining(seeded(6));
  trainPunch(s, s.lit!.dir);
  while (!s.ball) step(s);
  while (ballIn(s) > TRAIN.roll * 0.6) step(s);
  trainRoll(s);
  if (s.lit) {
    const hits = s.hits;
    trainPunch(s, s.lit.dir);
    assert.equal(s.hits, hits, '구르는 동안은 못 친다');
  }
  let ev: TrainEvent[] = [];
  while (s.ball && !s.ball.done) {
    step(s);
    ev = ev.concat(s.events);
  }
  assert.ok(ev.some((e) => e.type === 'dodge'), '피함');
  assert.equal(s.hearts, TRAIN.hearts);
  const e = makeTraining(seeded(6));
  trainPunch(e, e.lit!.dir);
  while (!e.ball) step(e);
  while (ballIn(e) > TRAIN.roll + 0.2) step(e);
  trainRoll(e);
  while (e.ball && !e.ball.done) step(e);
  assert.equal(e.hearts, TRAIN.hearts - 1, '너무 일찍 구르면 맞는다');
}

// 6) 가만히 있으면 공에 맞아 하트를 다 잃고 일찍 끝난다 · 잘하는 플레이어는 시간을 다 채운다 · 보상
{
  for (let seed = 1; seed <= 20; seed++) {
    const s = makeTraining(seeded(seed));
    play(s, null, null);
    assert.equal(s.why, 'hearts', `seed ${seed}: 가만히 있으면 하트를 다 잃는다`);
    assert.ok(s.t < TRAIN.time, '시간 전에 끝');
  }
  const scores: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const s = makeTraining(seeded(seed));
    const ev = play(s, 0.3, 0.25);
    assert.equal(s.why, 'time', `seed ${seed}: 시간을 다 채운다`);
    assert.equal(s.hearts, TRAIN.hearts, `seed ${seed}: 공을 다 피한다`);
    assert.equal(timeLeft(s), 0);
    assert.ok(ev.some((e) => e.type === 'hurry'), '10초 알림');
    const done = ev.find((e) => e.type === 'done');
    assert.ok(done && done.type === 'done' && done.coins === Math.round(s.score * TRAIN.coin), '냥코인 = 점수 × coin');
    scores.push(s.score);
  }
  const slow: number[] = [];
  for (let seed = 1; seed <= 20; seed++) {
    const s = makeTraining(seeded(seed));
    play(s, 0.6, 0.25);
    slow.push(s.score);
    assert.ok(s.quicks <= 2, '늦게 치면 딱이 거의 없다');
  }
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  console.log(`training: 0.3초에 치면 평균 ${avg(scores).toFixed(0)}점 · 0.6초에 치면 ${avg(slow).toFixed(0)}점 (냥코인 × ${TRAIN.coin})`);
  assert.ok(avg(scores) > 120 && avg(scores) < 200, '0.3초에 치면 120~200점');
  assert.ok(avg(slow) > 40 && avg(slow) < 100, '0.6초에 치면 40~100점 (길드 훈련 의뢰 40점은 넘는다)');
}
console.log('training.check: ok');
