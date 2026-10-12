/**
 * 구조 로프 당기기 (강아지마을 구조대 출동, 2026-10-12) — 필드의 ❗ 자리에 가면 버나드와 함께 로프를 당긴다.
 * 왼쪽 · 오른쪽을 번갈아 누를 때만 한 번 당겨진다 (같은 쪽을 두 번 누르면 미끄러짐). need 번 당기면 구조 — time 초 안에.
 * 남은 시간이 three 초 이상이면 ★★★ · two 초 이상이면 ★★ · 그 밖 ★. 시간이 다 되면 놓침(다시 하기). node 로 체크된다.
 * 키: A · ← / D · →, 터치: 화면 왼쪽 · 오른쪽 절반 (main).
 */
export type RescueKind = 'tree' | 'boat' | 'pit';
export const ROPE = { time: 10, need: 24, three: 4, two: 2 };
export type Rope = {
  kind: RescueKind;
  phase: 'ready' | 'pull' | 'done' | 'fail';
  t: number;
  pulls: number;
  /** 마지막에 누른 쪽 (-1 왼쪽 · 1 오른쪽 · 0 아직) */
  last: -1 | 0 | 1;
  stars: number;
  events: { type: 'pull' | 'slip' | 'done' | 'fail' }[];
};
export const makeRope = (kind: RescueKind): Rope => ({ kind, phase: 'ready', t: 0, pulls: 0, last: 0, stars: 0, events: [] });
/** 당긴 만큼 (0..1) */
export const ropeK = (r: Rope) => Math.min(1, r.pulls / ROPE.need);
/** 한 번 누르기 — 처음 누르면 시간이 간다 */
function press(r: Rope, side: -1 | 1) {
  if (r.phase === 'done' || r.phase === 'fail') return;
  if (r.phase === 'ready') r.phase = 'pull';
  if (side === r.last) {
    r.events.push({ type: 'slip' });
    return;
  }
  r.last = side;
  r.pulls++;
  r.events.push({ type: 'pull' });
  if (r.pulls >= ROPE.need) {
    const left = ROPE.time - r.t;
    r.stars = left >= ROPE.three ? 3 : left >= ROPE.two ? 2 : 1;
    r.phase = 'done';
    r.events.push({ type: 'done' });
  }
}
/** 한 프레임 — presses = 이번 프레임에 누른 쪽들 (차례대로) */
export function updateRope(r: Rope, presses: (-1 | 1)[], dt: number) {
  r.events.length = 0;
  for (const side of presses) press(r, side);
  if (r.phase !== 'pull') return;
  r.t += dt;
  if (r.t >= ROPE.time) {
    r.phase = 'fail';
    r.events.push({ type: 'fail' });
  }
}
