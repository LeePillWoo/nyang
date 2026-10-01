// 게임용 리소스 찾기. src/assets/ 는 원본 art/ 와 같은 폴더 구조다 (tools/assets.mjs 가 만든다).
// 데이터(rooms.json · enemies.json …)에는 확장자 없이 'characters/enemies/core/pirate_rat_v1' 처럼 적는다.
const URLS = import.meta.glob<string>('./assets/**/*.webp', { eager: true, query: '?url', import: 'default' });

export function assetUrl(path: string): string {
  const url = URLS[`./assets/${path}.webp`];
  if (!url) throw new Error('리소스 없음: src/assets/' + path + '.webp');
  return url;
}

const images = new Map<string, { img: HTMLImageElement; ready: Promise<HTMLImageElement> }>();

/** 한 번만 불러오고 같은 그림을 나눠 쓴다 */
export function image(path: string) {
  let e = images.get(path);
  if (!e) {
    const img = new Image();
    const ready = new Promise<HTMLImageElement>((ok, fail) => {
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error('그림 로드 실패: ' + path));
    });
    img.src = assetUrl(path);
    e = { img, ready };
    images.set(path, e);
  }
  return e;
}
