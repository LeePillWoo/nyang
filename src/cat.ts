import sheetUrl from './assets/cat-sheet.png';

export const FRAME = 229; // 시트 한 칸 (1374x1145 = 6x5)
export const COLS = 6;

/** 행 2 = 냥펀치, 행 4 = 피격·표정. M1 전투 붙일 때 쓴다. */
export const ANIM = {
  idle: { row: 0, fps: 8 },
  run: { row: 1, fps: 12 },
  roll: { row: 3, fps: 30 },
} as const;

export type Anim = (typeof ANIM)[keyof typeof ANIM];

export const catSheet = new Image();
catSheet.src = sheetUrl;

/** 시트에서 한 칸을 (cx, baseY) 기준으로 그린다. baseY 가 발밑. */
export function drawCatFrame(
  ctx: CanvasRenderingContext2D,
  anim: Anim,
  frame: number,
  cx: number,
  baseY: number,
  size: number,
  flip: number,
) {
  ctx.save();
  ctx.translate(cx, baseY - size / 2);
  ctx.scale(flip, 1);
  ctx.drawImage(
    catSheet,
    (frame % COLS) * FRAME,
    anim.row * FRAME,
    FRAME,
    FRAME,
    -size / 2,
    -size / 2,
    size,
    size,
  );
  ctx.restore();
}
