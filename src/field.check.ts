// node src/field.check.ts  (npm run check)
import assert from 'node:assert/strict';
import {
  backFrom,
  BLOCK,
  bridging,
  BRIDGE,
  FIELD,
  FOREST,
  inWarp,
  isOpen,
  makeFieldState,
  updateField,
  warpLocked,
  WALK,
  WATER,
  type FieldState,
  type Mode,
  type TerrainAt,
} from './field.ts';

const warp = FIELD.warps.find((w) => w.to)!; // 연결된 첫 포탈 (던전이든 낚시터든)
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
  assert.equal(run(s, 0, 0, warp.dwell * 0.6)?.to, warp.to, '충분히 머물면 그 포탈의 던전·낚시터로');
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
  assert.equal(run(s, 0, 0, warp.dwell + 0.1)?.to, warp.to);
}

// 던전에서 나오면 입구 앞에 서고, 나오자마자 다시 빨려 들어가지 않는다
{
  assert.deepEqual(backFrom(warp.to), warp.back);
  assert.ok(!inWarp(warp, warp.back[0], warp.back[1]));
}

// 미개방 구역 (field.json open): 가장자리 밖으로는 걸어서도 배로도 못 가고 'locked' 사건, 그쪽 포탈은 연결돼 있어도 잠겨 있다
{
  const o = FIELD.open;
  const [W, H] = FIELD.size;
  const [COLS, ROWS] = FIELD.grid;
  const x0 = Math.floor((o.c[0] * W) / COLS); // 개방 구역 왼쪽 가장자리
  const y = Math.floor(((o.r[0] + 0.5) * H) / ROWS);
  assert.ok(isOpen(x0 + 5, y) && !isOpen(x0 - 5, y) && isOpen(FIELD.start[0], FIELD.start[1]), '시작점은 개방 구역 안');
  const s = makeFieldState([x0 + 30, y]);
  assert.equal(run(s, -1, 0, 1), null);
  assert.ok(s.x >= x0 - 1 && s.x < x0 + 30, `가장자리에서 막힌다 (x ${s.x.toFixed(0)}, 경계 ${x0})`);
  let locked = false;
  for (let i = 0; i < 10; i++) {
    updateField(s, -1, 0, 0.016);
    locked ||= s.events.some((e) => e.type === 'locked');
  }
  assert.ok(locked, '미개방 구역으로 밀면 locked 사건');
  const sea: TerrainAt = () => WATER;
  const b = makeFieldState([x0 + 30, y], sea);
  b.mode = 'boat';
  for (let i = 0; i < 60; i++) updateField(b, -1, 0, 0.016, sea);
  assert.ok(b.x >= x0 - 1 && b.mode === 'boat', `배로도 못 넘어간다 (x ${b.x.toFixed(0)})`);
  const lockedWarp = FIELD.warps.find((w) => w.to && warpLocked(w))!;
  const p = makeFieldState(FIELD.start);
  [p.x, p.y] = lockedWarp.at;
  assert.equal(run(p, 0, 0, lockedWarp.dwell * 2), null, `${lockedWarp.id} 는 잠겨서 안 간다`);
  assert.ok(FIELD.warps.some((w) => w.to && !warpLocked(w)), '열린 포탈도 있다');
}

// 여기부터는 가짜 지도로 움직임만 본다 — 개방 구역을 지도 전체로 넓혀 둔다 (아래 좌표들은 지도 왼쪽 위에 있다)
Object.assign(FIELD.open, { r: [0, FIELD.grid[1] - 1], c: [0, FIELD.grid[0] - 1] });

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

// ── 지형별 움직임 ─────────────────────────────────────────────────────────────
// 가짜 지도: x ≥ 500 은 물, (x < 300, y < 300) 은 숲, (350..370, 490..530) 은 막힘, 나머지 걷기
const map: TerrainAt = (x, y) =>
  x >= 500 ? WATER : x < 300 && y < 300 ? FOREST : x >= 350 && x <= 370 && y >= 490 && y <= 530 ? BLOCK : WALK;
const tickT = (s: FieldState, mx: number, my: number, secs: number, at = map) => {
  const seen: Mode[] = [];
  let chops = 0;
  for (let i = 0; i < Math.round(secs / 0.016); i++) {
    updateField(s, mx, my, 0.016, at);
    if (seen[seen.length - 1] !== s.mode) seen.push(s.mode);
    chops += s.events.filter((e) => e.type === 'chop').length;
    // 불변식: 물 위를 걷지 않고, 땅 위에서 배를 타지 않는다
    const t = at(s.x, s.y);
    if (s.mode === 'walk' || s.mode === 'axe') assert.notEqual(t, WATER, `물 위를 걷고 있다 (${s.x.toFixed(0)}, ${s.y.toFixed(0)})`);
    // 다리 위를 지나는 배만 예외
    if ((s.mode === 'boat' || s.mode === 'board' || s.mode === 'unboard') && !bridging(s, at))
      assert.equal(t, WATER, `땅 위에 배가 있다 (${s.x.toFixed(0)}, ${s.y.toFixed(0)})`);
  }
  return { seen, chops };
};

// 물가로 걸어가면 배에 오르고, 다 오르면 노를 젓는다
{
  const s = makeFieldState([460, 400], map);
  const { seen } = tickT(s, 1, 0, 0.6);
  assert.deepEqual(seen, ['walk', 'board'], '걷다가 물가에서 배에 오른다');
  assert.equal(s.flip, 1, '오른쪽 물이면 오른쪽을 보고 뛰어든다');
  tickT(s, 0, 0, FIELD.boardTime);
  assert.equal(s.mode, 'boat');
  const x0 = s.x;
  let strokes = 0;
  for (let i = 0; i < 60; i++) {
    updateField(s, 1, 0, 0.016, map);
    strokes += s.events.filter((e) => e.type === 'stroke').length;
  }
  assert.ok(s.x > x0 + 100, '배로 나아간다');
  assert.ok(strokes > 0, '노를 저을 때마다 물소리 사건');

  // 뭍으로 돌아오면 내린다. 왼쪽 뭍이면 시트 그대로(고양이가 배 왼쪽에 내려선다)
  const back = tickT(s, -1, 0, 3);
  assert.ok(back.seen.includes('unboard'), '뭍에 닿으면 내린다');
  assert.equal(s.mode, 'walk');
  assert.ok(s.x < 500, '뭍에 서 있다');
}

// 오른쪽 뭍에 내릴 땐 시트를 뒤집어 고양이가 배 오른쪽에 내려선다
{
  const lake: TerrainAt = (x) => (x < 500 ? WATER : WALK);
  const s = makeFieldState([520, 400], lake);
  s.x = 470;
  s.mode = 'boat';
  tickT(s, 1, 0, 0.3, lake);
  assert.equal(s.mode, 'unboard');
  assert.equal(s.flip, -1);
}

// 숲: 잠깐 스치면 그대로 걷고, 머물면 도끼를 든다. 숲에선 느리고, 걸으면 도끼질을 한다
{
  const s = makeFieldState([310, 200], map);
  tickT(s, -1, 0, 0.1); // 숲 경계를 막 넘었다
  assert.equal(s.mode, 'walk', '잠깐 스친 걸로는 안 바뀐다');
  const { chopEvery, chopTime } = FIELD.modes.axe;
  const { chops } = tickT(s, -1, 0.3, 3.2); // 한 주기 = 걷기 chopEvery + 휘두르기 chopTime
  assert.equal(s.mode, 'axe');
  const want = Math.floor((3.2 - 0.3) / (chopEvery + chopTime)) - 1; // 숲에 들어가는 데 걸린 시간·끝자락은 빼고
  assert.ok(chops >= want, `걷는 동안 도끼질: ${chops}회 (적어도 ${want}회)`);
  const x0 = s.x;
  tickT(s, 1, 0, 0.5);
  const forestPace = s.x - x0;
  const w = makeFieldState([400, 400], map);
  tickT(w, 1, 0, 0.5);
  assert.ok(forestPace < (w.x - 400) * 0.7, '숲에선 느리다');
}

// 숲 경계를 따라 지그재그로 걸어도 모션이 깜빡이지 않는다
{
  const s = makeFieldState([300, 250], map);
  let changes = 0;
  let last = s.mode;
  for (let i = 0; i < 120; i++) {
    updateField(s, i % 10 < 5 ? -1 : 1, 0, 0.016, map); // 0.08초마다 경계를 넘나든다
    if (s.mode !== last) {
      changes++;
      last = s.mode;
    }
  }
  assert.ok(changes <= 1, `경계에서 모션이 ${changes}번 바뀌었다`);
}

// 숲에서 지그재그로 걸어도(방향을 바꿀 때마다 잠깐 멈춤) 도끼질은 이어진다
{
  const s = makeFieldState([150, 150], map);
  // 한 방향으로 걷는 시간을 도끼질 간격보다 짧게 — 멈출 때마다 타이머가 0 이 되면 한 번도 못 휘두른다
  const frames = Math.max(1, Math.floor((FIELD.modes.axe.chopEvery * 0.6) / 0.016));
  let chops = 0;
  for (let seg = 0; seg < 40; seg++) {
    updateField(s, 0, 0, 0.016, map); // 방향을 바꾸는 한 프레임 멈춤
    for (let i = 0; i < frames; i++) {
      updateField(s, seg % 2 ? -1 : 1, 0, 0.016, map);
      chops += s.events.filter((e) => e.type === 'chop').length;
    }
  }
  assert.ok(chops >= 2, `지그재그로 걸어도 도끼질 ${chops}회`);
}

// 막힌 곳(검정)으로는 못 들어간다
{
  const s = makeFieldState([330, 510], map);
  tickT(s, 1, 0, 1);
  assert.ok(s.x < 350, `막힌 곳을 뚫었다: ${s.x.toFixed(0)}`);
}

// 배 위에서는 워프가 작동하지 않는다
{
  const sea: TerrainAt = () => WATER;
  const s = makeFieldState(FIELD.start, sea);
  s.mode = 'boat';
  s.x = wx;
  s.y = wy;
  let got = null;
  for (let i = 0; i < 200; i++) got = updateField(s, 0, 0, 0.016, sea) ?? got;
  assert.equal(got, null);
}

// 무작위로 20초 조작해도 불변식이 깨지지 않는다 (호수 둘, 숲, 막힌 곳이 섞인 지도)
{
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const mixed: TerrainAt = (x, y) =>
    Math.hypot(x - 700, y - 400) < 120 || Math.hypot(x - 1100, y - 500) < 80
      ? WATER
      : Math.hypot(x - 900, y - 250) < 90
        ? FOREST
        : Math.abs(x - 880) < 12 && Math.abs(y - 520) < 30
          ? BLOCK
          : WALK;
  const s = makeFieldState([900, 420], mixed);
  const modes = new Set<Mode>();
  for (let i = 0; i < 25; i++) {
    const mx = Math.round(rnd() * 2 - 1);
    const my = Math.round(rnd() * 2 - 1);
    tickT(s, mx, my, 0.8, mixed);
    modes.add(s.mode);
  }
  assert.ok(modes.size >= 2, `여러 지형을 지나갔다: ${[...modes].join(',')}`);
}

console.log('terrain.check: ok');

// 다리: 강을 배로 가다 좁은 땅(다리)을 만나면 내리지 않고 넘어간다
{
  // 강 x < 500 · 다리 500..540 · 강 540..900 · 그 뒤 넓은 뭍
  const river: TerrainAt = (x) => (x >= 500 && x < 540 ? BRIDGE : x > 900 ? WALK : WATER);
  const s = makeFieldState([450, 400], river);
  s.mode = 'boat';
  const { seen } = tickT(s, 1, 0, 1.2, river);
  assert.ok(s.x > 560, `다리를 넘어가야 한다: ${s.x.toFixed(0)}`);
  assert.deepEqual(seen, ['boat'], `내리지 않고 배로 넘어간다: ${seen.join(' → ')}`);

  // 넓은 뭍(다리 폭보다 넓다)에서는 내린다
  assert.ok(FIELD.modes.boat.bridge < 1672 - 900, '테스트 전제: 뒤쪽 뭍은 다리 폭보다 넓다');
  const t2 = tickT(s, 1, 0, 4, river);
  assert.ok(t2.seen.includes('unboard'), `넓은 뭍에 닿으면 내린다: ${t2.seen.join(' → ')}`);

  // 같은 폭이라도 다리가 아닌 풀밭이면 넘어가지 않고 내린다
  const grass: TerrainAt = (x) => (x >= 500 && x < 540 ? WALK : WATER);
  const gs = makeFieldState([450, 400], grass);
  gs.mode = 'boat';
  const gl = tickT(gs, 1, 0, 1.2, grass);
  assert.ok(gl.seen.includes('unboard'), `좁은 풀밭에서는 내린다: ${gl.seen.join(' → ')}`);

  // 바위가 낀 다리는 넘어가지 않는다
  const rocky: TerrainAt = (x) => (x >= 500 && x < 520 ? BLOCK : x >= 520 && x < 540 ? BRIDGE : WATER);
  const r = makeFieldState([450, 400], rocky);
  r.mode = 'boat';
  tickT(r, 1, 0, 1.2, rocky);
  assert.ok(r.x < 500, `바위를 넘어가면 안 된다: ${r.x.toFixed(0)}`);

  // 다리 위에서 다리를 따라 옆으로는 안 가고, 되돌아가면 물로 돌아간다
  const b = makeFieldState([450, 400], river);
  b.mode = 'boat';
  for (let i = 0; i < 400 && river(b.x, b.y) === WATER; i++) updateField(b, 1, 0, 0.016, river);
  assert.ok(bridging(b, river), '다리 위에 올라섰다');
  const y0 = b.y;
  tickT(b, 0, 1, 0.5, river);
  assert.equal(b.y, y0, '다리를 따라 배가 땅 위로 가지 않는다');
  assert.equal(b.mode, 'boat');
  tickT(b, -1, 0, 0.5, river);
  assert.equal(river(b.x, b.y), WATER, '되돌아가면 물 위');
}

console.log('bridge.check: ok');
