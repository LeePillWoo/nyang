import { assetUrl } from './assets.ts';
import { loadSheet } from './sheet.ts';

export const CAT_ROW = { idle: 0, run: 1, punch: 2, roll: 3, hurt: 4 };
export const CAT_FPS = { idle: 8, run: 12, punch: 16, roll: 30, hurt: 10 };

/** 도끼 시트 (1536×1024, 6×4): 대기 · 걷기 · 뛰기 · 휘두르기 */
export const AXE_ROW = { idle: 0, walk: 1, run: 2, chop: 3 };
export const AXE_FPS = { idle: 6, walk: 10, run: 14 };

/** 배 시트 (1536×1024, 6×4): 가만히(흔들림) · 노 젓기 · 오르기 · 내리기 */
export const BOAT_ROW = { idle: 0, row: 1, board: 2, unboard: 3 };
export const BOAT_FPS = { idle: 5, row: 9 };

/** 눈·모래 시트 (1536×1024, 6×4): 눈밭 높이 걷기 · 빙판 미끄러짐 · 모래밭 힘주어 걷기 · 모래언덕 엉덩이 미끄럼 */
export const SNOW_ROW = { snow: 0, slip: 1, sand: 2, slide: 3 };
export const SNOW_FPS = { snow: 9, sand: 8 };

const P = 'characters/player/';
export const loadCat = () => loadSheet(assetUrl(P + 'cat_action_sheet_v1'), 6, 5);
export const loadAxe = () => loadSheet(assetUrl(P + 'cheese_axe_v1'), 6, 4);
// 배는 선체를 기준으로 잡아야 고양이가 뛰어들 때 배가 미끄러지지 않는다
export const loadBoat = () => loadSheet(assetUrl(P + 'cheese_boat_v1'), 6, 4, { anchor: 'hull' });
export const loadSnow = () => loadSheet(assetUrl(P + 'cheese_snow_sand_v1'), 6, 4);
