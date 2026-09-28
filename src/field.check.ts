// node src/field.check.ts  (npm run check)
import assert from 'node:assert/strict';
import { backFrom, FIELD, inWarp, makeFieldState, updateField, type FieldState } from './field.ts';

const warp = FIELD.warps[0];
const [wx, wy] = warp.at;
const run = (s: FieldState, mx: number, my: number, secs: number) => {
  let got = null;
  for (let i = 0; i < Math.round(secs / 0.016); i++) got = updateField(s, mx, my, 0.016) ?? got;
  return got;
};
const standOnWarp = () => {
  const s = makeFieldState(FIELD.start); // 밖에서 시작했으니 작동 준비됨
  s.x = wx;
  s.y = wy;
  return s;
};

// 시작점은 워프 밖이고, 워프는 작동 준비가 돼 있다
{
  const s = makeFieldState(FIELD.start);
  assert.ok(!inWarp(warp, FIELD.start[0], FIELD.start[1]), '시작하자마자 빨려 들어가면 안 된다');
  assert.equal(s.armed, true);
}

// 잠깐 스치면 아무 일도 없고, 충분히 머물러야 던전으로 간다
{
  const s = standOnWarp();
  assert.equal(run(s, 0, 0, warp.dwell * 0.5), null, '잠깐은 안 간다');
  assert.equal(run(s, 0, 0, warp.dwell * 0.6)?.to, 'alley', '충분히 머물면 던전으로');
}

// 머물다 나가면 처음부터 다시 센다
{
  const s = standOnWarp();
  run(s, 0, 0, warp.dwell * 0.7);
  s.x = wx + 100;
  run(s, 0, 0, 0.05);
  assert.equal(s.dwell, 0);
  s.x = wx;
  assert.equal(run(s, 0, 0, warp.dwell * 0.5), null, '앞서 머문 시간은 이어지지 않는다');
}

// 워프 안에서 시작하면 한 번 나갔다 들어와야 작동한다
{
  const s = makeFieldState(warp.at);
  assert.equal(s.armed, false);
  assert.equal(run(s, 0, 0, warp.dwell * 3), null, '안에서 시작하면 계속 서 있어도 안 간다');
  s.x = wx + 100;
  run(s, 0, 0, 0.05);
  s.x = wx;
  assert.equal(run(s, 0, 0, warp.dwell + 0.1)?.to, 'alley');
}

// 던전에서 나오면 입구 앞에 서고, 나오자마자 다시 빨려 들어가지 않는다
{
  assert.deepEqual(backFrom('alley'), warp.back);
  assert.ok(!inWarp(warp, warp.back[0], warp.back[1]));
}

// 걷기: 가로는 설정 속도, 세로는 비스듬한 시점만큼 느리다. 그림 밖으로는 못 나간다
{
  const s = makeFieldState([800, 400]);
  run(s, 1, 0, 1);
  assert.ok(Math.abs(s.x - 800 - FIELD.speed) < 4, `가로 속도: ${s.x - 800}`);
  assert.equal(s.flip, 1);
  const y0 = s.y;
  run(s, 0, 1, 1);
  assert.ok(Math.abs(s.y - y0 - FIELD.speed * FIELD.vertical) < 4, `세로 속도: ${s.y - y0}`);
  const e = makeFieldState([30, 30]);
  run(e, -1, -1, 3);
  assert.ok(e.x >= 24 && e.y >= 24, '가장자리에서 멈춘다');
}

console.log('field.check: ok');
