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
- 장면: **바깥 필드**(시작, 전투 없이 자유 이동) ↔ **던전**(전투). 필드 워프에 머물면 던전, 던전 노란 매트로 나오면 필드.
  필드는 지형에 따라 걷기 · 숲은 도끼로 헤치기 · 물은 배로 바뀐다.
- 던전 배경: 방마다 렌더된 그림 1장. 바닥 네 꼭짓점을 찍어 원근 변환으로 좌표를 맞춘다 (src/iso.ts).
- 필드 배경: **6×6 조각(청크)을 이어 붙인 5016×2823 지도** (2026-10-01). 조각은 836×470 / 836×471 (짝수 행 470, 홀수 행 471).
  좌표는 이어 붙인 전체 그림의 픽셀. 화면에는 `field.json` 의 `view`(836×470, 조각 한 장 크기)만큼 보이게 확대한다.
  그림은 카메라 근처 조각만 불러오고, 보이는 조각을 1:1 로 한 장에 붙인 뒤 확대한다 (조각마다 확대하면 경계에 실금).
  원본은 `art/field/tile_rR_cC.png` (git 에 안 올림) → `node tools/tiles.mjs` → `src/assets/field/tile_rR_cC.webp`.
  한 장 지도 시절의 지도는 가운데 판(r2–r3 × c2–c3, 원점 1672, 941)에 그대로 들어 있다.
- 필드 지형: 조각마다 `src/assets/field/mask_rR_cC.png` (조각과 같은 크기), **채널 하나에 지형 하나** —
  R 막힘(암석·절벽) · G 숲(도끼) · B 물(배) · A 다리(**투명 = 다리**, 편집기가 투명 픽셀의 RGB 를 버려서 거꾸로 쓴다).
  각 채널 흰색 = 칠함(128 이상). 셋 다 검정·불투명 = 걷기. 겹치면 다리 > 막힘 > 물 > 숲.
  **막는 건 암석·절벽뿐, 집·분수대는 걷기** (사용자 결정). 배는 물 아니면 다리 위에만 서고, 다리는 내리지 않고 넘어간다.
  지금은 가운데 4조각만 기존 마스크(손으로 칠한 다리 포함)를 잘라 넣었고, 나머지 32조각은 빈 마스크(검정 = 전부 걷기)다.
  **사용자가 요청할 때까지 마스크를 만들지 않는다.**
  사용자가 마스크를 직접 고쳐 올린다 — 받으면 `npm run verify`.
  초안 생성기 `tools/terrain.mjs` 는 아직 한 장 지도 기준이라 **지금은 못 쓴다** (마스크 요청 때 조각 기준으로 고친다).
- 그림은 전부 WebP (Chrome 인코더는 알파를 무손실로 저장해서 시트 칸 자르기가 PNG 와 같다). 지형 마스크만 PNG.
- 캐릭터·적·이펙트: 스프라이트 시트 (src/sheet.ts 가 알파를 훑어 칸을 찾는다).
- 충돌은 자체 구현 (원·AABB + 그리드), 저장은 IndexedDB (아직 없음).
- 타격음은 Web Audio 합성 (src/audio.ts). 효과음 에셋이 생기면 Howler 로 교체.

## 규칙

- 게임 데이터(적, 장난감, 방 템플릿)는 `src/data/` JSON 으로 분리한다.
  적 `enemies.json`, 방 `rooms.json`(네 꼭짓점·충돌 맵·나가는 곳 `E`·쥐 배치 `spawns`),
  플레이어 `player.json`(체력·목숨·펀치·구르기·무적 시간),
  필드 `field.json`(지도 크기 `size`·조각 수 `grid`·화면 넓이 `view`·시작점·워프·고양이 키 `catBody`·지형별 속도와 타이밍 `modes`).
- 장면마다 **로직 `<장면>.ts` + 그리기 `<장면>-draw.ts`** 로 나눈다 (필드, 던전). 로직 파일은 그림을 불러오지 않아서
  node 로 체크된다. 소리는 로직이 `events` 로 내보내고 `main.ts` 가 재생한다. `main.ts` 는 입력·장면 전환·불러오기만.
- 폴더는 아직 나누지 않는다 (GDD 10장의 레이어별 폴더·ECS 는 따르지 않음). 세 번째 장면(거점·미니게임)이 생길 때 장면별 폴더로.
- 필드 캐릭터 크기는 `catBody` 한 값으로 정한다. 캐릭터에 딸린 거리·파티클은 전부 이 값의 배수로 쓴다 (픽셀 고정값 금지).
- 던전 입구를 늘릴 땐 `field.json` 의 `warps` 에 항목을 추가한다 (좌표는 이어 붙인 전체 지도 픽셀 — 조각 rR_cC 안의 (x, y) 는 (c×836 + x, ⌊r×470.5⌋ + y)).
- 낚시 미니게임은 추후 추가. `MiniGame` 인터페이스, `fishing_spot` 방 타입, 세이브의
  `rodRestore`·`fishDex` 필드는 v1부터 자리만 유지한다 (GDD 10장). → 저장을 붙이는 M2 에서 만든다.
- **움직임·애니메이션 버그는 `npm run verify` 로 실제 브라우저에서 확인한 뒤 고치고 보고한다.**
  헤드리스 스크린샷은 게임 루프가 첫 프레임에서 멈춰서 순간이동·깜빡임을 못 잡는다.
  정지 화면만 보고 추측으로 고치지 않는다.
- 새 스프라이트 시트를 넣으면 `npm run verify` 로 모든 행이 6칸인지 확인한다 (행 수가 5가 아니면
  `tools/verify.mjs` 의 `SHEET_ROWS` 에 적는다). 다른 시트와 캐릭터 크기가 맞는지는 나란히 그려서 잰다.
- 사용자에게는 한국어 존댓말. 커밋 메시지도 한국어.

## 명령

| 명령 | 하는 일 |
| --- | --- |
| `npm run dev` | 개발 서버 |
| `npm run check` | 로직 자체 체크 (충돌, 적 AI, 펀치 판정, 공격 모션, 간격, 필드 워프, 지형별 움직임, 다리, 던전 전투 — 피격·무적·부활·낮잠·펀치 타이밍·나가기) |
| `npm run verify` | 빌드 후 Chrome 으로 실제로 돌려 그리기 검사 + 필드↔던전 왕복 + 필드 지형(배·도끼·암벽·다리·워프까지 갈 수 있나) + 연속 촬영(`tools/out/`) |
| `npm run build` | 타입 체크 + 빌드 (`--base=./` 상대 경로) |
| `node tools/tiles.mjs` | 필드 조각 원본(`art/field/`) → WebP. 크기가 자리와 안 맞으면 멈춘다. 마스크가 없는 조각에만 빈 마스크를 만든다 (**있는 마스크는 안 건드린다**) |
| `node tools/terrain.mjs` | (한 장 지도 기준 — 조각 전환 뒤 아직 안 고침, 쓰지 말 것) |

URL 옵션: `?dungeon` 던전에서 바로 시작, `?grid` 바닥 격자·막힌 칸 (던전에서 G 키), `?terrain` 필드 지형 보기 (필드에서 T 키), `?trace` 검증용 기록.

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
src/main.ts        게임 루프, 입력, 장면 전환(페이드), 사건 → 소리, 불러오기, ?trace 기록
src/dungeon.ts     던전 로직 (플레이어 이동·냥펀치·구르기·피격·부활, 쥐·화살, 데미지 숫자·이펙트·흔들기 목록) — node 로 체크된다
src/dungeon-draw.ts 던전 그리기 (방 배경, 공격 예고, 캐릭터 정렬, 화살·이펙트, 데미지 숫자, HUD, 노란 매트, 격자)
src/field.ts       필드 로직 (걷기·도끼·배 모드, 배 오르내리기, 워프 머물기) — 순수 로직이라 node 로 체크된다
src/field-draw.ts  필드 그리기 (조각 불러오기·이어 붙이기, 카메라, 조각별 지형 마스크 읽기, 모드별 스프라이트, 수풀·물결·나뭇잎, 워프 임시 그래픽)
src/enemy.ts       쥐 AI (접근·옆자리·예고·공격·쿨다운), 펀치 판정, 몸 간격
src/sheet.ts       스프라이트 시트 슬라이서 (칸 찾기·병합 분리·앵커·행 배율)
src/iso.ts         던전 배경 그림 ↔ 월드 좌표 원근 변환, 충돌 맵·나가는 곳
src/collide.ts     원-AABB 그리드 충돌
src/cat.ts         고양이 시트 행 배정 (기본 · 도끼 · 배)
src/fx.ts          타격 이펙트 시트 규격·그리기 (그림은 dungeon-draw.ts 가 불러온다)
src/audio.ts       합성 타격음
src/data/          enemies.json · rooms.json · player.json · field.json
src/*.check.ts     npm run check 로 도는 자체 체크
tools/verify.mjs   실제 브라우저 검증
tools/tiles.mjs    필드 조각 원본 → WebP + 빈 마스크
tools/terrain.mjs  필드 지형 마스크 초안 생성 (한 장 지도 기준, 고칠 예정)
tools/webp.mjs     PNG → WebP (알파 무손실)
```
