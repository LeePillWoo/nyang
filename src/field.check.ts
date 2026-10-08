// node src/field.check.ts  (npm run check)
import assert from 'node:assert/strict';
import {
  backFrom,
  BLOCK,
  bridging,
  BRIDGE,
  chasing,
  FIELD,
  FOREST,
  inWarp,
  isOpen,
  makeFieldState,
  openEdges,
  spawnSquirrel,
  tileOpen,
  RISE,
  SPIT,
  updateField,
  WHALE,
  whaleSpit,
  warpLocked,
  WALK,
  WATER,
  type FieldState,
  type Mode,
  type TerrainAt,
} from './field.ts';
import { SQ_T } from './squirrel.ts';

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

// 미개방 구역 (field.json open — 조각마다 'o' 열림): 가장자리 밖으로는 걸어서도 배로도 못 가고 'locked' 사건, 그쪽 포탈은 연결돼 있어도 잠겨 있다
{
  const [W, H] = FIELD.size;
  const [COLS, ROWS] = FIELD.grid;
  // 열린 조각 왼쪽이 닫힌 곳 (지금은 r4 — 왼쪽 가을 지역)
  const r = FIELD.open.findIndex((row) => [...row].some((ch, c) => ch === 'o' && c > 0 && row[c - 1] !== 'o'));
  const c = [...FIELD.open[r]].findIndex((ch, c) => ch === 'o' && c > 0 && FIELD.open[r][c - 1] !== 'o');
  const x0 = Math.floor((c * W) / COLS); // 개방 구역 왼쪽 가장자리
  const y = Math.floor(((r + 0.5) * H) / ROWS);
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
  // 숲 지역(r2~3 × c0~1)은 다시 잠갔다 (2026-10-08 사용자 요청) — 숲 미니게임장 두 곳은 열린 구역 숲 속 임의 워프 (이정표 없음, sign = at)
  assert.ok(!tileOpen(2, 0) && !tileOpen(3, 1) && tileOpen(2, 2) && tileOpen(5, 5), '열린 곳은 오른쪽 아래 4×4');
  const to = (id: string) => FIELD.warps.find((w) => w.id === id)!;
  for (const [id, game] of [['forest_timber', 'timber'], ['forest_chase', 'chase']]) {
    const w = to(id);
    assert.ok(w.to === game && !warpLocked(w) && w.sign[0] === w.at[0] && w.sign[1] === w.at[1] && backFrom(game)[0] === w.back[0], `${w.label} → ${game} (열린 구역 · 이정표 없음)`);
  }
  assert.ok(to('woodcutter_hollow').to === 'forest' && warpLocked(to('woodcutter_hollow')), '나무숲 던전은 원래 자리(벌목 쉼터, 잠김)로');
  // 테두리는 열린 조각과 닫힌 조각 사이에만 (지도 가장자리 빼고)
  const edges = openEdges();
  assert.ok(edges.length > 0);
  for (const [x0, y0, x1, y1] of edges) {
    const [mx, my] = [(x0 + x1) / 2, (y0 + y1) / 2];
    const [dx, dy] = x0 === x1 ? [4, 0] : [0, 4];
    assert.ok(mx > 0 && my > 0 && mx < W && my < H && isOpen(mx - dx, my - dy) !== isOpen(mx + dx, my + dy), `테두리 (${x0}, ${y0})~(${x1}, ${y1})`);
  }
}

// 여기부터는 가짜 지도로 움직임만 본다 — 개방 구역을 지도 전체로 넓혀 둔다 (아래 좌표들은 지도 왼쪽 위에 있다)
FIELD.open.fill('o'.repeat(FIELD.grid[0]));
// 숲에서 나오는 것 · 부스럭 수풀 · 다람쥐는 맨 아래 숲 체크에서 따로 본다 (무작위로 끼어들면 움직임 체크가 흔들린다)
const FOREST0 = structuredClone(FIELD.forest);
FIELD.forest.find = 0;
FIELD.forest.rustle.max = 0;
FIELD.forest.squirrel.chance = 0;

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

// ── 고래 ── 바다(whale.sea 조각 · 둘레가 다 물)에서 배를 타고 가만히 3초 → 그림자가 맴돈다 → 3~8초 뒤 솟구쳐 삼킨다.
// 움직이면 그림자가 흐려져 사라지고, 뱉어 낸 뒤 cooldown 초 동안은 안 나온다
{
  const ocean: TerrainAt = () => WATER;
  const DT = 1 / 60;
  const sea = (): FieldState => {
    const s = makeFieldState([3760, 1640], ocean); // r3_c4 — 바다 조각
    s.mode = 'boat';
    return s;
  };
  const events: string[] = [];
  const tick = (s: FieldState, secs: number, mx = 0, my = 0, at = ocean, rng: () => number = () => 0.5) => {
    for (let i = 0; i < Math.round(secs / DT); i++) {
      updateField(s, mx, my, DT, at, rng);
      for (const e of s.events) if (e.type === 'whale' || e.type === 'splash') events.push(e.type === 'whale' ? e.what : 'splash');
    }
  };
  // 가만히 3초가 안 되면 아무 일 없고, 넘으면 그림자 (맴돌 시간은 3~8초 중 무작위)
  let s = sea();
  tick(s, WHALE.still - 0.1);
  assert.equal(s.whale.phase, 'none', '3초 전엔 안 나온다');
  tick(s, 0.2);
  assert.ok(s.whale.phase === 'lurk' && events.includes('near'), '바다에 3초 가만히 있으면 그림자가 맴돈다');
  assert.equal(s.whale.hold, WHALE.hold[0] + 0.5 * (WHALE.hold[1] - WHALE.hold[0]));
  for (const r of [0, 0.999]) {
    const q = sea();
    tick(q, WHALE.still + 0.1, 0, 0, ocean, () => r);
    assert.ok(q.whale.hold >= WHALE.hold[0] && q.whale.hold <= WHALE.hold[1], `맴도는 시간 ${q.whale.hold.toFixed(2)} 은 3~8초`);
  }
  // 움직이면 흐려지다 사라진다 (그 뒤로도 움직이는 동안은 안 나온다)
  tick(s, 1);
  assert.ok(s.whale.alpha > 0.7, '그림자가 짙어진다');
  tick(s, 0.1, 1, 0);
  assert.equal(s.whale.phase, 'leave', '배가 움직이면 흐려지기 시작');
  tick(s, WHALE.fadeOut + 0.1, 1, 0);
  assert.ok(s.whale.phase === 'none' && s.whale.alpha === 0 && events.includes('gone'), '서서히 사라진다');
  tick(s, 6, 0.6, 0.6);
  assert.equal(s.whale.phase, 'none', '움직이는 동안은 안 나온다');
  // 맴돌 시간이 다 되면 솟구친다: 조작을 받지 않고 → 물 위로 → 꿀꺽 → 배 속으로 (gulped 에 머문다)
  s = sea();
  events.length = 0;
  tick(s, WHALE.still + 0.05);
  const hold = s.whale.hold;
  tick(s, hold - 0.1);
  assert.equal(s.whale.phase, 'lurk');
  tick(s, 0.15);
  assert.ok(s.whale.phase === 'rise' && events.includes('rise'), '그림자가 hold 초 맴돌면 솟구친다');
  const x0 = s.x;
  tick(s, RISE.end - 0.1, 1, 0);
  assert.equal(s.x, x0, '솟구치는 동안은 못 움직인다');
  assert.deepEqual(events.filter((e) => ['breach', 'gulp', 'in'].includes(e)), ['breach', 'gulp']);
  tick(s, 0.2, 1, 0);
  assert.ok(s.whale.phase === 'gulped' && events.includes('in') && s.x === x0, '삼키면 배 속으로 (main 이 미로로 데려간다)');
  tick(s, 2, 1, 0);
  assert.ok(s.whale.phase === 'gulped' && s.x === x0, '데려갈 때까지 그대로');
  // 뱉어 내기: 배가 물에 떨어질 때까지 못 움직이고, 떨어지면 움직일 수 있다. 다 끝나면 cooldown 초 동안 안 나온다
  events.length = 0;
  whaleSpit(s);
  tick(s, SPIT.land - 0.05, 1, 0);
  assert.ok(s.x === x0 && events.includes('spit') && s.mode === 'boat', '뱉어 내는 동안 못 움직인다 (배를 탄 채)');
  tick(s, 0.1);
  assert.ok(events.includes('splash'), '배가 물에 떨어진다');
  tick(s, 0.3, 1, 0);
  assert.ok(s.x > x0, '떨어지면 다시 움직인다');
  for (let i = 0; i < 300 && s.whale.phase === 'spit'; i++) tick(s, DT);
  assert.ok(s.whale.phase === 'none' && Math.abs(s.whale.cool - WHALE.cooldown) < 0.02 && events.includes('dive'), '잠수하고 cooldown');
  tick(s, WHALE.cooldown - 0.5);
  assert.equal(s.whale.phase, 'none', '나온 뒤 10초 동안은 가만히 있어도 안 나온다');
  tick(s, 1);
  assert.equal(s.whale.phase, 'lurk', '10초가 지나면 다시 나올 수 있다');
  // 좁은 물(강)·바다 조각 밖(호수)·뭍에서는 안 나온다
  const river: TerrainAt = (x) => (Math.abs(x - 3760) < 30 ? WATER : WALK);
  const r = makeFieldState([3760, 1640], river);
  r.mode = 'boat';
  tick(r, 12, 0, 0, river);
  assert.equal(r.whale.phase, 'none', '좁은 물엔 안 나온다');
  const lake = makeFieldState([2900, 700], ocean); // r1_c3 — 바다 조각이 아니다
  lake.mode = 'boat';
  tick(lake, 12, 0, 0, ocean);
  assert.equal(lake.whale.phase, 'none', '바다가 아닌 물엔 안 나온다');
  const land = makeFieldState([3760, 1640]);
  tick(land, 12, 0, 0, () => WALK);
  assert.equal(land.whale.phase, 'none', '뭍에선 안 나온다');
}
// 그림자는 낚시 물고기처럼 헤엄친다: 물 위에서만 · 배 둘레를 돌아다니고(제자리에 있지 않다) · 바라보는 쪽은 움직이는 쪽 ·
// 배가 움직이면 멀어진다. 앞바다(물가에서 room×catBody 넘게 떨어진 곳)에서도 나오고, 물가 바로 옆에선 안 나온다
{
  const DT = 1 / 60;
  const C = FIELD.catBody;
  const shore = 3700; // x 가 이보다 크면 바다, 작으면 뭍 (r3_c4)
  const coast: TerrainAt = (x) => (x >= shore ? WATER : WALK);
  const boat = (x: number): FieldState => {
    const q = makeFieldState([x, 1640], coast);
    q.mode = 'boat';
    return q;
  };
  const near = boat(shore + WHALE.room * C + 8);
  for (let i = 0; i < (WHALE.still + 0.2) / DT; i++) updateField(near, 0, 0, DT, coast);
  assert.equal(near.whale.phase, 'lurk', '앞바다(물가에서 조금 떨어진 곳)에서도 나온다');
  const w = near.whale;
  w.hold = 99; // 오래 지켜본다
  let path = 0;
  let maxD = 0;
  let headingOk = 0;
  let frames = 0;
  for (let i = 0; i < 8 / DT; i++) {
    const [px, py] = [w.sx, w.sy];
    updateField(near, 0, 0, DT, coast);
    assert.equal(coast(w.sx, w.sy), WATER, `그림자는 물 위에서만 (${w.sx.toFixed(0)}, ${w.sy.toFixed(0)})`);
    const step = Math.hypot(w.sx - px, w.sy - py);
    path += step;
    if (i > 3 / DT) maxD = Math.max(maxD, Math.hypot(w.sx - near.x, (w.sy - near.y) / FIELD.vertical) / C);
    if (step > 0.05) {
      frames++;
      if ((w.sx - px) * w.hx + (w.sy - py) * w.hy > 0) headingOk++;
    }
  }
  assert.ok(path > 6 * C, `그림자가 돌아다닌다 — 멈춰 있지 않다 (8초에 ${(path / C).toFixed(1)}칸)`);
  assert.ok(maxD <= WHALE.near[1] + 1, `나타난 뒤엔 배 둘레에 머문다 (가장 멀리 ${maxD.toFixed(1)}칸)`);
  assert.ok(headingOk > frames * 0.9, `바라보는 쪽 = 움직이는 쪽 (${headingOk}/${frames})`);
  const d0 = Math.hypot(w.sx - near.x, w.sy - near.y);
  for (let i = 0; i < 1 / DT; i++) updateField(near, 1, 0, DT, coast);
  assert.ok(w.phase === 'leave' && Math.hypot(w.sx - near.x, w.sy - near.y) > d0, '배가 움직이면 멀어지며 흐려진다');
  const tight = boat(shore + WHALE.room * C * 0.6);
  for (let i = 0; i < 6 / DT; i++) updateField(tight, 0, 0, DT, coast);
  assert.equal(tight.whale.phase, 'none', '물가 바로 옆엔 안 나온다');
}
console.log('whale.check: ok');

// ── 숲 ── 도끼질에 가끔 나오는 것 · 부스럭 수풀 · 다람쥐 (field.json forest)
Object.assign(FIELD.forest, { find: FOREST0.find });
Object.assign(FIELD.forest.rustle, FOREST0.rustle);
Object.assign(FIELD.forest.squirrel, FOREST0.squirrel);
{
  const F = FIELD.forest;
  const C = FIELD.catBody;
  const V = FIELD.vertical;
  const DT = 1 / 60;
  const seeded = (seed: number) => {
    let v = seed >>> 0;
    return () => {
      v = (v * 1664525 + 1013904223) >>> 0;
      return v / 2 ** 32;
    };
  };
  // 넓은 숲 (가운데) + 둘레는 걷기, 오른쪽 아래에 호수
  const woods: TerrainAt = (x, y) => (x > 2600 && y > 1500 ? WATER : x > 200 && x < 2400 && y > 200 && y < 1400 ? FOREST : WALK);
  const finds = new Set(F.finds.map(([id]) => id as string));
  const step = (s: FieldState, mx: number, my: number, rng: () => number, at = woods) => {
    updateField(s, mx, my, DT, at, rng);
    return s.events;
  };

  // 1) 숲을 곧게 헤치면 가끔 무언가 나온다 (finds 표에서) — 다람쥐 · 수풀은 빼고 본다
  {
    F.rustle.max = 0;
    F.squirrel.chance = 0;
    let got = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rng = seeded(seed);
      const s = makeFieldState([300, 800], woods);
      for (let i = 0; i < 60 / DT; i++)
        for (const e of step(s, 1, 0, rng))
          if (e.type === 'forage') {
            assert.ok(finds.has(e.id), `숲에서 나온 것은 finds 표에서 (${e.id})`);
            got++;
          }
    }
    const perMin = got / 20;
    assert.ok(perMin > 2 && perMin < 15, `숲을 1분 헤치면 ${perMin.toFixed(1)}개`);
    // 같은 자리를 오가면 한 번 나온 칸은 rest 초 동안 쉰다 (나올 확률을 1 로 두고)
    F.find = 1;
    const s = makeFieldState([1000, 800], woods);
    const rng = seeded(3);
    let wiggle = 0;
    for (let i = 0; i < 40 / DT; i++) for (const e of step(s, Math.floor(i / 20) % 2 ? -1 : 1, 0, rng)) if (e.type === 'forage') wiggle++;
    assert.ok(wiggle >= 1 && wiggle <= 3, `같은 자리를 40초 오가면 ${wiggle}번만 (칸마다 한 번)`);
    s.woods.t += F.rest;
    let again = 0;
    for (let i = 0; i < 3 / DT; i++) for (const e of step(s, Math.floor(i / 20) % 2 ? -1 : 1, 0, rng)) if (e.type === 'forage') again++;
    assert.ok(again >= 1, 'rest 초가 지나면 다시 나온다');
    const kept = makeFieldState([500, 500], woods, s);
    assert.equal(kept.woods, s.woods, '필드를 새로 만들어도(던전에서 나와도) 숲 기억은 이어 간다');
    F.find = FOREST0.find;
    F.rustle.max = FOREST0.rustle.max;
    F.squirrel.chance = FOREST0.squirrel.chance;
  }

  // 2) 부스럭 수풀: 숲 가까이 있으면 생기고 (숲 안쪽에만 · near 거리 · max 개까지), 오래되면 사라진다. 다가가 도끼질하면 열린다
  {
    F.squirrel.chance = 0;
    const rng = seeded(7);
    const s = makeFieldState([150, 800], woods); // 숲 왼쪽 길가
    let most = 0;
    let started = 0;
    for (let i = 0; i < 70 / DT; i++) {
      for (const e of step(s, 0, 0, rng))
        if (e.type === 'rustle' && e.what === 'start') {
          started++;
          const d = Math.hypot(e.x - s.x, (e.y - s.y) / V) / C;
          assert.ok(woods(e.x, e.y) === FOREST && d >= F.rustle.near[0] - 0.01 && d <= F.rustle.near[1] + 0.01, `수풀은 숲 안 near 거리에 (${d.toFixed(1)})`);
        }
      most = Math.max(most, s.rustles.length);
    }
    assert.ok(started >= 3 && most === F.rustle.max, `70초에 수풀 ${started}번 · 한꺼번에 ${most}개까지`);
    assert.ok(s.rustles.every((r) => r.t < F.rustle.life), '오래된 수풀은 사라진다');
    // 다가가 도끼질 → 열림 → 수풀 표에서 하나 (다람쥐 확률 0) / 다람쥐 확률 1 이면 다람쥐
    const rfinds = new Set(F.rustle.finds.map(([id]) => id as string));
    for (const sq of [0, 1]) {
      F.rustle.squirrel = sq;
      const a = makeFieldState([700, 800], woods);
      a.mode = 'axe';
      a.rustles = [{ x: 760, y: 800, t: 0 }];
      a.rustleT = 99;
      const got: string[] = [];
      for (let i = 0; i < 4 / DT && a.rustles.length; i++)
        for (const e of step(a, 1, 0, seeded(11)))
          got.push(e.type === 'forage' ? 'forage:' + e.id : e.type === 'squirrel' ? 'squirrel:' + e.what : e.type === 'rustle' ? 'rustle:' + e.what : '');
      assert.ok(got.includes('rustle:open'), '다가가 도끼질하면 수풀이 열린다');
      if (sq) assert.ok(got.includes('squirrel:appear') && chasing(a), '수풀에서 다람쥐가 튀어나온다');
      else assert.ok(got.some((g) => g.startsWith('forage:') && rfinds.has(g.slice(7))), `수풀에서 무언가 나온다 (${got.filter(Boolean).join(' ')})`);
    }
    F.rustle.squirrel = FOREST0.rustle.squirrel;
    F.squirrel.chance = FOREST0.squirrel.chance;
  }

  // 3) 다람쥐: 폴짝(못 잡음) → 던지기(가만히 있으면 콩) → 달리기 ⇄ 쉬기. 뭍에만 서고(호수 · 닫힌 곳 안 감), 쫓으면 잡히고 안 쫓으면 숨는다.
  //    쫓는 동안 고양이는 숲에서도 멈춰 도끼질하지 않고 걷기의 chase 배로 달린다. 잡으면 숨겨 둔 것, 끝나면 cooldown 초 동안 안 나온다
  {
    const run1 = (seed: number, mode: 'chase' | 'late' | 'still', at = woods, from = [1300, 900]) => {
      const rng = seeded(seed);
      const s = makeFieldState(from, at);
      s.mode = 'axe';
      spawnSquirrel(s, from[0] + C, from[1], at, rng);
      const trail: number[][] = [];
      const seen: string[] = [];
      let out: { what: string; t: number; stash?: { items: string[]; coins: number } } | null = null;
      for (let i = 0; i < 20 / DT && !out; i++) {
        const q = s.squirrel;
        trail.push([q.x, q.y]);
        // late = 사람처럼: 0.35초 뒤에야 알아채고, 0.3초 늦게 본 자리를 키보드 8방향으로 쫓는다
        const late = mode === 'late';
        const [tx, ty] = late ? trail[Math.max(0, trail.length - 18)] : [q.x, q.y];
        const dx = tx - s.x;
        const dy = (ty - s.y) / V;
        const d = Math.hypot(dx, dy) || 1;
        const a8 = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
        const [mx, my] = mode === 'still' || (late && i < 0.35 / DT) ? [0, 0] : late ? [Math.round(Math.cos(a8)), Math.round(Math.sin(a8))] : [dx / d, dy / d];
        const ev = step(s, mx, my, rng, at);
        if (q.phase !== 'none' && q.phase !== 'caught' && q.phase !== 'gone') {
          const t = at(q.x, q.y);
          assert.ok(t !== WATER && t !== BLOCK, `seed ${seed}: 다람쥐는 뭍에만 (${q.x.toFixed(0)}, ${q.y.toFixed(0)})`);
        }
        for (const e of ev) {
          if (e.type === 'squirrel') seen.push(e.what);
          if (e.type === 'chop') assert.fail(`seed ${seed}: 쫓는 동안은 도끼질하지 않는다`);
          if (e.type === 'squirrel' && (e.what === 'caught' || e.what === 'escape')) out = { what: e.what, t: i * DT, stash: e.stash };
        }
      }
      return { out, seen, s };
    };
    // 폴짝 뛰는 동안은 바로 옆이어도 못 잡는다
    {
      const s = makeFieldState([1300, 900], woods);
      spawnSquirrel(s, 1300 + C * 0.5, 900, woods, seeded(1));
      updateField(s, 0, 0, DT, woods, seeded(1));
      assert.equal(s.squirrel.phase, 'hop', '폴짝 뛰는 동안은 못 잡는다');
      const h = Math.hypot(s.squirrel.tx - s.squirrel.fx, (s.squirrel.ty - s.squirrel.fy) / V) / C;
      assert.ok(Math.abs(h - F.squirrel.hop) < 0.01, `hop 배 떨어진 곳으로 폴짝 (${h.toFixed(2)})`);
    }
    // 가만히 있으면: 던진 도토리에 콩 · 결국 숨는다 (give 초 안에)
    let still = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = run1(seed, 'still');
      assert.ok(r.seen.includes('throw') && r.seen.includes('bonk'), `seed ${seed}: 가만히 있으면 도토리에 콩 (${r.seen.join(' ')})`);
      if (r.out?.what === 'escape' && r.out.t <= F.squirrel.give + 0.1) still++;
    }
    assert.equal(still, 20, '안 쫓으면 숨는다');
    // 쫓으면 잡는다 — 바로 쫓으면 거의 다, 0.3초 늦게 봐도 대부분. 잡으면 숨겨 둔 것 (도토리 · 냥코인 · 가끔 귀한 것)
    const rate = (mode: 'chase' | 'late') => {
      let caught = 0;
      let t = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const r = run1(seed, mode);
        if (r.out?.what !== 'caught') continue;
        caught++;
        t += r.out.t;
        const st = r.out.stash!;
        const acorns = st.items.filter((id) => id === 'materials_05').length;
        assert.ok(acorns >= F.squirrel.stash.acorns[0] && acorns <= F.squirrel.stash.acorns[1], `도토리 ${acorns}개`);
        assert.ok(st.coins >= F.squirrel.stash.coins[0] && st.coins <= F.squirrel.stash.coins[1], `냥코인 ${st.coins}`);
      }
      return { k: caught / 40, t: t / Math.max(1, caught) };
    };
    const fast = rate('chase');
    const late = rate('late');
    assert.ok(fast.k >= 0.85, `바로 쫓으면 ${(fast.k * 100).toFixed(0)}% 잡는다`);
    assert.ok(late.k >= 0.55 && late.k <= 0.92, `사람처럼(0.35초 뒤 알아채고 0.3초 늦게 · 키보드 8방향) 쫓으면 ${(late.k * 100).toFixed(0)}% 잡는다`);
    assert.ok(fast.t > 0.6 && late.t > fast.t, `잡는 데 걸린 시간 ${fast.t.toFixed(1)}초 · 늦게 보면 ${late.t.toFixed(1)}초`);
    console.log(`  다람쥐 40마리: 바로 쫓으면 ${(fast.k * 100).toFixed(0)}% (평균 ${fast.t.toFixed(1)}초) · 사람처럼 쫓으면 ${(late.k * 100).toFixed(0)}% (${late.t.toFixed(1)}초) · 가만히 있으면 0%`);
    // 호숫가에서 쫓아도 다람쥐는 물로 안 들어간다 (run1 이 프레임마다 본다)
    for (let seed = 1; seed <= 10; seed++) run1(seed, 'late', woods, [2560, 1460]);
    // 쫓는 동안 숲에서 걷기의 chase 배로 달린다
    {
      const s = makeFieldState([1300, 900], woods);
      s.mode = 'axe';
      spawnSquirrel(s, 1300 + C * 4, 900, woods, seeded(5));
      Object.assign(s.squirrel, { phase: 'rest', t: 0, dur: 99, x: 1300 + 10 * C, y: 900 });
      const x0 = s.x;
      for (let i = 0; i < 30; i++) updateField(s, 1, 0, DT, woods, seeded(5));
      const v = (s.x - x0) / (30 * DT);
      assert.ok(Math.abs(v - FIELD.speed * F.squirrel.chase) < 2, `쫓을 땐 숲에서도 ${v.toFixed(0)}px/초`);
    }
    // 끝나면 cooldown 초 동안은 안 나온다 (나올 확률 1 로 두고 도끼질해도)
    {
      const r = run1(2, 'still');
      const s = r.s;
      for (let i = 0; i < SQ_T.gone / DT + 2; i++) updateField(s, 0, 0, DT, woods, seeded(2));
      assert.equal(s.squirrel.phase, 'none');
      F.squirrel.chance = 1;
      let appear = 0;
      for (let i = 0; i < (F.squirrel.cooldown - 2) / DT; i++) for (const e of step(s, i % 120 < 60 ? 1 : -1, 0, seeded(i))) if (e.type === 'squirrel' && e.what === 'appear') appear++;
      assert.equal(appear, 0, `${F.squirrel.cooldown}초 동안은 다시 안 나온다`);
      for (let i = 0; i < 4 / DT; i++) for (const e of step(s, i % 120 < 60 ? 1 : -1, 0, seeded(i))) if (e.type === 'squirrel' && e.what === 'appear') appear++;
      assert.ok(appear >= 1, '쿨다운이 지나면 다시 나온다');
      F.squirrel.chance = FOREST0.squirrel.chance;
    }
  }
}
console.log('forest.check: ok');
