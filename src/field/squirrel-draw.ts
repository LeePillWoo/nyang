// 숲 다람쥐 · 도토리 그리기 — 필드 숲(field-draw)과 다람쥐 잡기(mini/chase-draw)가 같이 쓴다.
// 장면 폴더끼리 가져오는 건 이것 하나뿐 (tools/check.mjs EXCEPTIONS). 움직임은 shared/squirrel.ts.
import { drawIcon } from '../bag/bag-draw.ts';
import data from '../data/field.json' with { type: 'json' };
import { drawFrame, MON_ROW, type Sheet } from '../shared/sheet.ts';
import { SQ_T, type Squirrel } from '../shared/squirrel.ts';

/** 다람쥐 (던전 몬스터 시트: 대기 · 이동 · 예고 · 던지기 · 움찔/어질/펑) — 폴짝 뛸 땐 포물선, 달릴 땐 통통 */
export function drawSquirrel(ctx: CanvasRenderingContext2D, q: Squirrel, sheet: Sheet | undefined, t: number) {
  if (q.phase === 'none' || !sheet) return;
  const C = data.catBody;
  const body = data.forest.squirrel.size * C;
  const size = (body * sheet.base) / sheet.bodyH;
  const span = (row: number, from: number, n: number, k: number): [number, number] => [row, from + Math.min(n - 1, Math.max(0, Math.floor(k * n)))];
  let rc: [number, number];
  let z = 0;
  if (q.phase === 'hop') {
    // 뛰어오르다 돌아서서 던진다
    rc = q.t < SQ_T.turn ? [MON_ROW.move, Math.floor(t * 16) % 6] : span(MON_ROW.attack, 0, 6, (q.t - SQ_T.turn) / (SQ_T.hop - SQ_T.turn));
    z = Math.sin(Math.PI * Math.min(1, q.t / SQ_T.hop)) * C * 1.1;
  } else if (q.phase === 'throw') rc = q.t < SQ_T.aim ? span(MON_ROW.telegraph, 0, 6, q.t / SQ_T.aim) : span(MON_ROW.attack, 0, 6, (q.t - SQ_T.aim) / (SQ_T.throw - SQ_T.aim));
  else if (q.phase === 'run') {
    rc = [MON_ROW.move, Math.floor(t * 16) % 6];
    z = Math.abs(Math.sin(t * 14)) * C * 0.15;
  } else if (q.phase === 'rest') rc = [MON_ROW.idle, Math.floor(t * 8) % 6];
  else if (q.phase === 'caught') rc = q.t < 0.5 ? [MON_ROW.retreat, 2] : span(MON_ROW.retreat, 4, 2, (q.t - 0.5) / 0.5);
  else rc = span(MON_ROW.retreat, 4, 2, q.t / SQ_T.gone);
  ctx.fillStyle = 'rgba(70, 60, 40, 0.25)';
  ctx.beginPath();
  ctx.ellipse(q.x, q.y, body * 0.42 * (1 - z / (C * 3)), body * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  drawFrame(ctx, sheet, rc[0], rc[1], q.x, q.y - z, size, q.flip);
}

/** 날아가는 도토리 — 다람쥐 손에서 고양이 머리 쪽으로 포물선, 빙글빙글 */
export function drawAcorn(ctx: CanvasRenderingContext2D, q: Squirrel) {
  const a = q.acorn;
  if (!a) return;
  const C = data.catBody;
  const k = Math.min(1, a.t / SQ_T.fly);
  const x = a.x0 + (a.x1 - a.x0) * k;
  const y = a.y0 + (a.y1 - C * 0.8 - a.y0) * k - Math.sin(Math.PI * k) * C * 1.1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a.t * 14);
  drawIcon(ctx, 'materials_05', 0, 0, C * 0.55);
  ctx.restore();
}
