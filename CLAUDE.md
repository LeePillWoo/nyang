# cats-never-fail

크롬 브라우저용 고양이 주인공 탑다운 액션 로그라이크 (가제: 고양이는 실패하지 않아).

- 데모: https://leepillwoo.github.io/nyang/
- 저장소: https://github.com/LeePillWoo/nyang

## 참고 문서 — 작업 전에 먼저 읽을 것

- **docs/PROGRESS.md** — 진행 상황, 결정 기록, 남은 일. 작업을 마치면 여기를 갱신한다.
- **docs/GDD.md** — 기획서. 관련 장을 먼저 읽는다. 단 3·10·11장의 3D 관련 내용은
  2026-09-28 비주얼 전환으로 현재 구현과 다르다 (PROGRESS.md 결정 기록 참고).

## 기술 스택 (현재)

- Canvas 2D + TypeScript + Vite. **Three.js 는 쓰지 않는다** (2026-09-28 에 걷어냄).
- 배경: 방마다 렌더된 그림 1장. 바닥 네 꼭짓점을 찍어 원근 변환으로 좌표를 맞춘다 (src/iso.ts).
- 캐릭터·적·이펙트: 스프라이트 시트 (src/sheet.ts 가 알파를 훑어 칸을 찾는다).
- 충돌은 자체 구현 (원·AABB + 그리드), 저장은 IndexedDB (아직 없음).
- 타격음은 Web Audio 합성 (src/audio.ts). 효과음 에셋이 생기면 Howler 로 교체.

## 규칙

- 게임 데이터(적, 장난감, 방 템플릿)는 `src/data/` JSON 으로 분리한다.
- 낚시 미니게임은 추후 추가. `MiniGame` 인터페이스, `fishing_spot` 방 타입, 세이브의
  `rodRestore`·`fishDex` 필드는 v1부터 자리만 유지한다 (GDD 10장). → 저장을 붙이는 M2 에서 만든다.
- **움직임·애니메이션 버그는 `npm run verify` 로 실제 브라우저에서 확인한 뒤 고치고 보고한다.**
  헤드리스 스크린샷은 게임 루프가 첫 프레임에서 멈춰서 순간이동·깜빡임을 못 잡는다.
  정지 화면만 보고 추측으로 고치지 않는다.
- 새 스프라이트 시트를 넣으면 `npm run verify` 로 모든 행이 6칸인지 확인한다.
- 사용자에게는 한국어 존댓말. 커밋 메시지도 한국어.

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run check` | 로직 자체 체크 (충돌, 적 AI, 펀치 판정, 공격 모션, 간격) |
| `npm run verify` | 빌드 후 Chrome 으로 실제로 돌려 그리기 검사 + 연속 촬영(`tools/out/`) |
| `npm run build` | 타입 체크 + 빌드 (`--base=./` 상대 경로) |

URL 옵션: `?grid` 바닥 격자·막힌 칸 표시 (게임 중 G 키), `?trace` 검증용 그리기 기록.

### 배포 (GitHub Pages, gh-pages 브랜치)

Actions 워크플로는 토큰에 `workflow` 권한이 없어 못 쓴다. 빌드 결과를 gh-pages 에 직접 올린다.

```sh
npm run build
git worktree add -B gh-pages <임시폴더> origin/gh-pages
rm -rf <임시폴더>/assets && cp -r dist/. <임시폴더>/ && touch <임시폴더>/.nojekyll
git -C <임시폴더> add -A && git -C <임시폴더> commit -m "배포: ..." && git -C <임시폴더> push origin gh-pages
git worktree remove <임시폴더>
```

Pages 는 10분 캐시한다. 확인은 Ctrl+Shift+R.

## 파일 지도

```
src/main.ts        게임 루프, 입력, 플레이어, 전투, 렌더, HUD
src/enemy.ts       쥐 AI (접근·옆자리·예고·공격·쿨다운), 펀치 판정, 몸 간격
src/sheet.ts       스프라이트 시트 슬라이서 (칸 찾기·병합 분리·앵커·행 배율)
src/iso.ts         배경 그림 ↔ 월드 좌표 원근 변환, 방 충돌 맵
src/collide.ts     원-AABB 그리드 충돌
src/cat.ts         고양이 시트 행 배정
src/fx.ts          타격 이펙트 시트
src/audio.ts       합성 타격음
src/data/          enemies.json (쥐 스탯)
src/*.check.ts     npm run check 로 도는 자체 체크
tools/verify.mjs   실제 브라우저 검증
```
