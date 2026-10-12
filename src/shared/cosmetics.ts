/**
 * 꾸미기 소품 (강아지마을 뽀송 미용실, 2026-10-13 사용자 — 소품 시트 art/cosmetics/salon, 털 염색은 하지 않는다).
 * 몸에 걸치는 칸 여섯: 머리 · 얼굴 · 목 · 옷 · 등 · 무늬 — 칸마다 하나. 능력치와 상관없는 겉모습 전용(가방 장비와 따로).
 * 미용실에서 사서(냥코인) 갖고, 입고 · 벗는다. 기록(옷장)은 main 이 localStorage nyang.cosmetics.v1 에. node 로 체크된다 (그리기는 cosmetics-draw.ts).
 */
import data from '../data/cosmetics.json' with { type: 'json' };
import fitData from '../data/cosmetics-fit.json' with { type: 'json' };

export type CosSlot = 'head' | 'face' | 'neck' | 'body' | 'back' | 'marking';
/** 그리는 차례 (뒤 → 앞) — 무늬는 털에 있으니 옷 밑 */
export const COS_SLOTS: CosSlot[] = ['back', 'marking', 'body', 'neck', 'face', 'head'];
export const COS_SLOT_NAME: Record<CosSlot, string> = { head: '머리', face: '얼굴', neck: '목', body: '옷', back: '등', marking: '무늬' };
/** 소품 한 장 — sheet 그림 · r 그림이 있는 범위 [x, y, w, h] · hint [가운데 x, 가운데 y, 너비] (치즈 컷 범위에 대한 비율) */
export type CosArt = { sheet: string; r: number[]; hint: number[] };
/** 소품 — up: 두 발 자세(냥펀치) 짝 · head: 머리까지 덮는 옷 (모자는 안 보인다) */
export type CosItem = CosArt & { name: string; slot: CosSlot; up?: CosArt; head?: number };
export const COS = data.items as Record<string, CosItem>;
/** 미용실 탭 [이름, 소품 id …] */
export const COS_TABS = data.tabs as [string, string[]][];
/** 값 (냥코인) — 칸마다 */
export const COS_PRICE: Record<CosSlot, number> = { head: 80, face: 60, neck: 60, body: 150, back: 120, marking: 40 };
export const cosPrice = (id: string) => COS_PRICE[COS[id].slot];

// ── 자리 보정 (src/data/cosmetics-fit.json — 칸 기본 + 소품마다) ──
export type Anchor = 'head' | 'body';
/** dx · dy 자리(hint 단위) · k 너비 배 · rot 도 · anchor 귀 줄/몸통 상자 · clip 실루엣 밖 자르기 · behind 몸 뒤 · r 시트 px 로 그림 일부만 */
export type Fit = { dx: number; dy: number; k: number; rot: number; anchor: Anchor; clip: number; behind: number; r?: number[] };
type FitPatch = Partial<Fit>;
const FIT = fitData as unknown as { slot: Record<CosSlot, FitPatch>; item: Record<string, FitPatch> };
let version = 0;
/** 보정이 바뀔 때마다 오른다 (그리기 쪽이 잘라 둔 그림을 버리는 신호) */
export const fitVersion = () => version;
/** 칸 기본 보정 (소품 보정을 덧씌우기 전) */
export const fitBase = (id: string): Fit => ({ dx: 0, dy: 0, k: 1, rot: 0, anchor: 'head', clip: 0, behind: 0, ...FIT.slot[COS[id].slot] });
export const fitOf = (id: string): Fit => ({ ...fitBase(id), ...FIT.item[id] });
/** 소품 보정을 바꾼다 (조절 도구 tools/cos-fit.html) — 저장은 안 한다, 파일에 옮겨 적는다 */
export function setFit(id: string, patch: FitPatch) {
  FIT.item[id] = { ...FIT.item[id], ...patch };
  version++;
}
export const fitItems = () => FIT.item;

/** 옷장 — owned 가진 소품 · worn 칸마다 걸친 소품 */
export type Wardrobe = { owned: string[]; worn: Partial<Record<CosSlot, string>> };
export const makeWardrobe = (): Wardrobe => ({ owned: [], worn: {} });
/** 저장해 둔 값을 믿을 만한 것만 (모르는 소품 · 안 가진 것 · 칸이 안 맞는 것은 버린다) */
export function fromWardrobe(v: unknown): Wardrobe {
  const w = makeWardrobe();
  if (!v || typeof v !== 'object') return w;
  const o = v as Partial<Wardrobe>;
  if (Array.isArray(o.owned)) w.owned = [...new Set(o.owned.filter((id) => typeof id === 'string' && COS[id]))];
  if (o.worn && typeof o.worn === 'object')
    for (const slot of COS_SLOTS) {
      const id = o.worn[slot];
      if (typeof id === 'string' && COS[id]?.slot === slot && w.owned.includes(id)) w.worn[slot] = id;
    }
  return w;
}
/** 산다 (냥코인). 안 되면 까닭 */
export function buyCos(w: Wardrobe, wallet: { coins: number }, id: string): string | null {
  if (!COS[id]) return '없는 소품이에요';
  if (w.owned.includes(id)) return '이미 가지고 있어요';
  if (wallet.coins < cosPrice(id)) return `냥코인이 모자라요 (${cosPrice(id)}냥)`;
  wallet.coins -= cosPrice(id);
  w.owned.push(id);
  return null;
}
/** 걸친다 — 같은 칸의 것은 벗는다. 이미 걸친 것이면 벗는다. 안 가졌으면 까닭 */
export function wearCos(w: Wardrobe, id: string): string | null {
  if (!w.owned.includes(id)) return '먼저 사야 해요';
  const slot = COS[id].slot;
  if (w.worn[slot] === id) delete w.worn[slot];
  else w.worn[slot] = id;
  return null;
}
export const takeOffAll = (w: Wardrobe) => void (w.worn = {});
/** 그릴 소품 (그리는 차례대로) — 머리까지 덮는 옷이면 머리 칸은 안 그린다 */
export function wornList(worn: Partial<Record<CosSlot, string>>): string[] {
  const hood = worn.body && COS[worn.body]?.head;
  return COS_SLOTS.filter((s) => worn[s] && !(s === 'head' && hood)).map((s) => worn[s]!);
}
