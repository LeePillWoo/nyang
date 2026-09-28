import axeUrl from './assets/cat-axe.webp';
import boatUrl from './assets/cat-boat.webp';
import catUrl from './assets/cat-sheet.webp';
import { loadSheet } from './sheet.ts';

export const CAT_ROW = { idle: 0, run: 1, punch: 2, roll: 3, hurt: 4 };
export const CAT_FPS = { idle: 8, run: 12, punch: 16, roll: 30, hurt: 10 };

/** 도끼 시트 (1536×1024, 6×4): 대기 · 걷기 · 뛰기 · 휘두르기 */
export const AXE_ROW = { idle: 0, walk: 1, run: 2, chop: 3 };
export const AXE_FPS = { idle: 6, walk: 10 };

/** 배 시트 (1536×1024, 6×4): 가만히(흔들림) · 노 젓기 · 오르기 · 내리기 */
export const BOAT_ROW = { idle: 0, row: 1, board: 2, unboard: 3 };
export const BOAT_FPS = { idle: 5, row: 9 };

export const loadCat = () => loadSheet(catUrl, 6, 5);
export const loadAxe = () => loadSheet(axeUrl, 6, 4);
// 배는 선체를 기준으로 잡아야 고양이가 뛰어들 때 배가 미끄러지지 않는다
export const loadBoat = () => loadSheet(boatUrl, 6, 4, { anchor: 'hull' });
