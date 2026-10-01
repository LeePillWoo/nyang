// 고양이 머리 위 감정 아이콘. 한 번에 하나만 — 새 감정이 오면 바꿔 단다.
// 좌표는 src/data/emotions.json (원본 art/metadata/ 의 감정 아틀라스 · 던전 감정 시트에서 옮김).
import { image } from './assets.ts';
import emotions from './data/emotions.json' with { type: 'json' };

type EmoDef = { name: string; sheet: string; frames: number[][] };
const EMO = emotions as Record<string, EmoDef>;
export type EmoteId = keyof typeof emotions;

const FPS = 8;
const state = { id: '' as EmoteId | '', t: 0, life: 0 };

/** 감정 띄우기. 같은 감정이 떠 있으면 시간만 늘린다 */
export function say(id: EmoteId, life = 1.8) {
  if (state.id === id) {
    state.life = Math.max(state.life, state.t + life);
    return;
  }
  state.id = id;
  state.t = 0;
  state.life = life;
}

export const quiet = () => {
  state.id = '';
};
export const saying = () => state.id;

export function tickEmote(dt: number) {
  if (!state.id) return;
  state.t += dt;
  if (state.t >= state.life) state.id = '';
}

/** (x, y) = 아이콘 아래 가운데 (고양이 머리 위), size = 아이콘 크기 */
export function drawEmote(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  if (!state.id) return;
  const d = EMO[state.id];
  const im = image(d.sheet).img;
  if (!im.complete || !im.naturalWidth) return;
  const [sx, sy, sw, sh] = d.frames[Math.floor(state.t * FPS) % d.frames.length];
  // 처음엔 톡 튀어나오고 끝날 땐 흐려진다
  const pop = Math.min(1, state.t / 0.12);
  const fade = Math.min(1, (state.life - state.t) / 0.25);
  const w = size * (0.6 + 0.4 * pop);
  const h = (w * sh) / sw;
  ctx.save();
  ctx.globalAlpha *= Math.max(0, fade);
  ctx.drawImage(im, sx, sy, sw, sh, x - w / 2, y - h, w, h);
  ctx.restore();
}

/** 미리 불러 두기 (첫 감정이 늦게 뜨지 않게) */
export const emotesReady = Promise.all([...new Set(Object.values(EMO).map((d) => d.sheet))].map((s) => image(s).ready));
