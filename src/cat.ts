import catUrl from './assets/cat-sheet.png';
import { loadSheet } from './sheet.ts';

export const CAT_ROW = { idle: 0, run: 1, punch: 2, roll: 3, hurt: 4 };
export const CAT_FPS = { idle: 8, run: 12, punch: 16, roll: 30, hurt: 10 };

export const loadCat = () => loadSheet(catUrl, 6, 5);
