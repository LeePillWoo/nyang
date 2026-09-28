
// M0 플레이스홀더. 진짜 스프라이트 시트는 3ds Max 렌더 → 아틀라스 (GDD 11장).
const SIZE = 256;
const CREAM = '#ffdca6';
const STRIPE = '#efa960';
const BELLY = '#fff4e2';
const PINK = '#ffb3b8';
const DARK = '#5a453a';

function drawCat(c: CanvasRenderingContext2D) {
  const ellipse = (x: number, y: number, rx: number, ry: number, fill: string) => {
    c.fillStyle = fill;
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fill();
  };

  // 꼬리
  c.strokeStyle = CREAM;
  c.lineWidth = 17;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(168, 210);
  c.bezierCurveTo(215, 215, 228, 170, 205, 148);
  c.stroke();
  c.strokeStyle = STRIPE;
  c.lineWidth = 6;
  c.beginPath();
  c.moveTo(206, 202);
  c.lineTo(216, 196);
  c.moveTo(220, 176);
  c.lineTo(228, 172);
  c.stroke();

  // 몸통 + 배 + 앞발
  ellipse(128, 196, 54, 42, CREAM);
  ellipse(128, 203, 32, 30, BELLY);
  ellipse(101, 228, 17, 12, BELLY);
  ellipse(155, 228, 17, 12, BELLY);

  // 귀
  for (const s of [-1, 1]) {
    c.fillStyle = CREAM;
    c.beginPath();
    c.moveTo(128 + s * 30, 78);
    c.lineTo(128 + s * 62, 22);
    c.lineTo(128 + s * 70, 84);
    c.closePath();
    c.fill();
    c.fillStyle = PINK;
    c.beginPath();
    c.moveTo(128 + s * 40, 76);
    c.lineTo(128 + s * 58, 42);
    c.lineTo(128 + s * 62, 80);
    c.closePath();
    c.fill();
  }

  // 머리
  ellipse(128, 118, 66, 58, CREAM);

  // 이마 줄무늬 (치즈태비)
  c.strokeStyle = STRIPE;
  c.lineWidth = 7;
  for (const dx of [-16, 0, 16]) {
    c.beginPath();
    c.moveTo(128 + dx, 66);
    c.lineTo(128 + dx * 1.5, 86);
    c.stroke();
  }

  // 눈 · 코 · 입
  ellipse(105, 124, 10, 12, DARK);
  ellipse(151, 124, 10, 12, DARK);
  ellipse(108, 119, 4, 4, '#ffffff');
  ellipse(154, 119, 4, 4, '#ffffff');
  ellipse(94, 145, 11, 7, '#ffc9c2');
  ellipse(162, 145, 11, 7, '#ffc9c2');
  c.fillStyle = PINK;
  c.beginPath();
  c.moveTo(121, 143);
  c.lineTo(135, 143);
  c.lineTo(128, 151);
  c.closePath();
  c.fill();
  c.strokeStyle = DARK;
  c.lineWidth = 3;
  c.beginPath();
  c.arc(120, 154, 8, 0, Math.PI);
  c.arc(136, 154, 8, 0, Math.PI);
  c.stroke();

  // 수염
  c.lineWidth = 2.5;
  c.strokeStyle = '#d9b48f';
  for (const s of [-1, 1]) {
    for (const dy of [-6, 2, 10]) {
      c.beginPath();
      c.moveTo(128 + s * 22, 146 + dy);
      c.lineTo(128 + s * 66, 140 + dy * 1.6);
      c.stroke();
    }
  }
}

/** 오프스크린 캔버스에 고양이를 한 번 그려 둔다. 실제 시트는 3ds Max 렌더로 교체 (GDD 11장). */
export function makeCatSprite(size = SIZE): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.scale(size / SIZE, size / SIZE);
  drawCat(c);
  return canvas;
}
