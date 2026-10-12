// 미션 창 (2026-10-13 사용자 — "미션을 도감 밑에 버튼 달아서 바로 알아볼 수 있게, 아이템 구하기 같은 건 워프 지점으로 바로 가는 버튼") —
// 필드 · 마을의 📜 미션 버튼 · Q 키. 길드 의뢰 셋 · 맡은 배달 · 보물 ✕ · 구조 ❗ 를 한 창에, 줄마다 📍 바로가기(그 일을 할 수 있는 열린 포탈 앞으로).
// 배달은 그만두기 · 시간이 지나면 실패. 디자인 좌표는 마을 창과 같은 1000×560 · 540×1040. 로직은 village/guild.ts · dogtown.ts.
import { count, ITEMS, type Bag } from './bag.ts';
import { button, drawIcon } from './bag-draw.ts';
import { shortcut } from './sources.ts';
import { FIELD, warpLocked, type Warp } from '../field/field.ts';
import { placeKind } from '../shared/places.ts';
import { fitText } from '../shared/touch.ts';
import { CALLS, digSpot, dueLeft, failedOrder, recipient, rescueSpot, type DogSave } from '../village/dogtown.ts';
import { progressOf, questDef, questDone, rankOf, type QuestType } from '../village/guild.ts';
import { closeX, inR, panelLayout, sheetBg, type R } from '../village/town-draw.ts';

const openWarps = () => FIELD.warps.filter((w) => w.to && !warpLocked(w));
const dist = (w: Warp, at: number[]) => Math.hypot(w.at[0] - at[0], w.at[1] - at[1]);
const nearest = (list: Warp[], at: number[]) => [...list].sort((a, b) => dist(a, at) - dist(b, at))[0] ?? null;
const byTo = (to: string) => openWarps().find((w) => w.to === to) ?? null;
/** 의뢰 종류 → 그 일을 하러 갈 포탈 (here = 지금 자리 — 같은 종류면 가까운 곳) */
function questWarp(type: QuestType, item: string | undefined, here: number[]): Warp | null {
  const kind = (k: string) => nearest(openWarps().filter((w) => placeKind(w.to, w.id) === k), here);
  if (type === 'item') return shortcut(item!, here)?.warp ?? null;
  if (type === 'kill' || type === 'elite' || type === 'clear') return kind('dungeon');
  if (type === 'fish' || type === 'bigfish' || type === 'salvage') return kind('fish');
  if (type === 'timber' || type === 'chase' || type === 'maze') return byTo(type);
  if (type === 'sand') return byTo('sandboard');
  if (type === 'cook') return byTo('village');
  if (type === 'forage') return nearest(openWarps().filter((w) => w.to === 'timber' || w.to === 'chase'), here);
  return byTo('dogtown'); // 구조 · 배달 · 보물 · 망치질 · 훈련은 강아지마을에서
}

type Row = { icon: string; emoji: boolean; title: string; sub: string; subColor: string; go: Warp | null; drop?: { k: number; label: string } };
function rows(save: DogSave, bag: Bag, here: number[], now: number): Row[] {
  const out: Row[] = [];
  for (const q of save.guild.quests) {
    const d = questDef(q.id);
    const done = questDone(q, bag);
    out.push({
      icon: done ? '✅' : '📜',
      emoji: true,
      title: d.title,
      sub: done ? '다 했어요 — 강아지마을 모험가 길드에 보고해요' : `${d.desc.replaceAll('{n}', String(d.n))} · ${progressOf(q, bag)}/${d.n}`,
      subColor: done ? '#3e9a45' : '#7a6656',
      go: done ? byTo('dogtown') : questWarp(d.type, d.item, here),
    });
  }
  save.parcels.forEach((p, k) => {
    const who = recipient(p.to);
    const have = count(bag, p.item);
    const failed = failedOrder(p, now);
    const left = dueLeft(p, now);
    out.push({
      icon: p.item,
      emoji: false,
      title: `배달: ${who.name}(${who.town})에게 ${ITEMS[p.item].name} ×${p.n}`,
      sub: failed ? '⏱ 시간 초과 — 배달 실패' : `⏱ ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 남음 · 가방에 ${have}/${p.n}`,
      subColor: failed ? '#d4574a' : have >= p.n ? '#3e9a45' : '#c98a1c',
      go: failed ? null : have < p.n ? (shortcut(p.item, here)?.warp ?? null) : byTo(p.to.startsWith('cat:') ? 'village' : 'dogtown'),
      drop: { k, label: failed ? '실패' : '그만두기' },
    });
  });
  const sp = digSpot(save);
  if (sp) out.push({ icon: '🧭', emoji: true, title: `보물 ✕ — ${sp.hint}`, sub: '그 자리에 잠깐 서 있으면 파요 (미니맵의 ✕)', subColor: '#7a6656', go: nearest(openWarps(), sp.at) });
  const call = rescueSpot(save);
  if (call) out.push({ icon: '⛑️', emoji: true, title: `구조 ❗ — ${call.title}`, sub: `${call.place} · 가서 로프를 당겨요 (미니맵의 ❗)`, subColor: '#d4574a', go: nearest(openWarps(), call.at) });
  else if (save.call) out.push({ icon: '🚨', emoji: true, title: `구조 요청 — ${CALLS[save.call.i].title}`, sub: '강아지마을 구조대 버나드에게 출동을 받아요', subColor: '#d4574a', go: byTo('dogtown') });
  return out;
}

function layout(w: number, h: number, n: number) {
  const L = panelLayout(w, h);
  const top = L.wide ? 84 : 96;
  const gap = L.wide ? 6 : 8;
  const rh = Math.min(L.wide ? 62 : 124, (L.DH - top - 12) / Math.max(1, n) - gap);
  const list = Array.from({ length: n }, (_, k): R => ({ x: 20, y: top + k * (rh + gap), w: L.DW - 40, h: rh }));
  const go = list.map((r): R => (L.wide ? { x: r.x + r.w - 240, y: r.y + (r.h - 44) / 2, w: 228, h: 44 } : { x: r.x + r.w - 250, y: r.y + r.h - 54, w: 238, h: 44 }));
  const drop = list.map((r, k): R => (L.wide ? { x: go[k].x - 118, y: go[k].y, w: 110, h: 44 } : { x: r.x + 12, y: go[k].y, w: 130, h: 44 }));
  return { L, list, go, drop };
}

export type QuestTap = { kind: 'close' } | { kind: 'travel'; id: string } | { kind: 'drop'; k: number } | null;
export function questTap(w: number, h: number, x: number, y: number, save: DogSave, bag: Bag, here: number[], now: number): QuestTap {
  const R0 = rows(save, bag, here, now);
  const { L, go, drop } = layout(w, h, R0.length);
  const px = (x - L.ox) / L.k;
  const py = (y - L.oy) / L.k;
  if (px < 0 || py < 0 || px > L.DW || py > L.DH || inR(L.close, px, py)) return { kind: 'close' };
  const g = go.findIndex((r, k) => R0[k].go && inR(r, px, py));
  if (g >= 0) return { kind: 'travel', id: R0[g].go!.id };
  const d = drop.findIndex((r, k) => R0[k].drop && inR(r, px, py));
  if (d >= 0) return { kind: 'drop', k: R0[d].drop!.k };
  return null;
}
/** 검증용 — 줄마다 바로가기 · 그만두기/실패 버튼 가운데 (CSS px)와 줄 제목 */
export function questPoints(w: number, h: number, save: DogSave, bag: Bag, here: number[], now: number) {
  const R0 = rows(save, bag, here, now);
  const { L, go, drop } = layout(w, h, R0.length);
  const mid = (r: R) => ({ x: L.ox + (r.x + r.w / 2) * L.k, y: L.oy + (r.y + r.h / 2) * L.k });
  return { close: mid(L.close), rows: R0.map((r, k) => ({ title: r.title, go: r.go?.id ?? null, goAt: mid(go[k]), dropAt: r.drop ? mid(drop[k]) : null, drop: r.drop?.label ?? null })) };
}

export function drawQuests(ctx: CanvasRenderingContext2D, w: number, h: number, save: DogSave, bag: Bag, here: number[], now: number) {
  const R0 = rows(save, bag, here, now);
  const { L, list, go, drop } = layout(w, h, R0.length);
  ctx.save();
  ctx.fillStyle = 'rgba(40,28,20,0.5)';
  ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.scale(L.k, L.k);
  sheetBg(ctx, L);
  closeX(ctx, L);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#5b4a3f';
  fitText(ctx, '📜 미션', 28, 54, 220, 32, 'bold ');
  const r = rankOf(save.guild.gp);
  ctx.fillStyle = '#9a7b62';
  fitText(ctx, `길드 등급 ${r.name} · ${save.guild.gp}점 — 📍 를 누르면 그 일을 할 수 있는 곳으로 바로 가요`, L.wide ? 170 : 28, L.wide ? 52 : 82, L.wide ? 700 : L.DW - 130, L.wide ? 16 : 14, 'bold ');
  R0.forEach((row, k) => {
    const b = list[k];
    ctx.fillStyle = row.subColor === '#d4574a' && row.drop?.label === '실패' ? '#fff1ee' : '#ffffff';
    ctx.strokeStyle = 'rgba(120,85,55,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(b.x, b.y, b.w, b.h, 14);
    ctx.fill();
    ctx.stroke();
    const iy = L.wide ? b.y + b.h / 2 : b.y + 36;
    if (row.emoji) {
      ctx.font = '26px "Segoe UI Emoji", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#000';
      ctx.fillText(row.icon, b.x + 30, iy + 9);
    } else drawIcon(ctx, row.icon, b.x + 30, iy, 38);
    const tw = L.wide ? b.w - 60 - 240 - (row.drop ? 120 : 0) : b.w - 70;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#5b4a3f';
    fitText(ctx, row.title, b.x + 58, b.y + (L.wide ? 25 : 30), tw, 18, 'bold ');
    ctx.fillStyle = row.subColor;
    fitText(ctx, row.sub, b.x + 58, b.y + (L.wide ? 48 : 56), tw, 14, '');
    if (row.go) button(ctx, go[k], `📍 ${row.go.label}`, 'main');
    if (row.drop) button(ctx, drop[k], row.drop.label, row.drop.label === '실패' ? 'warn' : 'soft');
  });
  if (!R0.length) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#b09a85';
    fitText(ctx, '지금은 미션이 없어요 — 강아지마을 모험가 길드에 들러 봐요', L.DW / 2, L.DH / 2, L.DW - 60, 18, 'bold ');
  }
  ctx.restore();
}
