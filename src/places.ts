// 포탈이 가는 곳의 종류 — 미니맵 점 · 필드 포탈 색과 아이콘 · 도감 지도가 같이 쓴다 (node 로 체크된다).
// 동굴 입구(…_cave)는 던전이 아니다 — 2026-10-08 사용자: 돌다리 · 동굴 구역은 던전에서 빼고 나중에 다른 콘텐츠로.
import { SPOTS } from './fishing.ts';

export type PlaceKind = 'village' | 'shop' | 'dungeon' | 'fish' | 'mini' | 'cave' | 'none';
export const MINI_IDS = ['maze', 'sandboard', 'timber', 'chase'];
/** 포탈 id · 가는 곳 → 종류. 연결 전(to 없음)인 동굴 입구(…_cave)는 '동굴' — 수정 동굴 입구처럼 낚시터로 이어진 것은 그 종류 */
export const placeKind = (to: string, id = ''): PlaceKind =>
  !to ? (id.endsWith('_cave') ? 'cave' : 'none') : SPOTS[to] ? 'fish' : to === 'shop' ? 'shop' : to === 'village' ? 'village' : MINI_IDS.includes(to) ? 'mini' : 'dungeon';
export const PLACE_COLOR: Record<PlaceKind, string> = {
  village: '#7fdc8c',
  shop: '#ff8fc8',
  dungeon: '#ffd84a',
  fish: '#6fd3ff',
  mini: '#b48cff',
  cave: '#c9ab8a',
  none: 'rgba(225,225,225,0.9)',
};
export const PLACE_ICON: Record<PlaceKind, string> = { village: '🏡', shop: '🛒', dungeon: '⚔️', fish: '🎣', mini: '🎮', cave: '🕳️', none: '🚧' };
export const PLACE_NAME: Record<PlaceKind, string> = { village: '마을', shop: '상점', dungeon: '던전', fish: '낚시터', mini: '미니게임', cave: '동굴', none: '준비 중' };
