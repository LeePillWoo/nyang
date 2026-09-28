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
- 필드 배경: 그림 1장, 좌표는 그림 픽셀 그대로. 확대해서 고양이를 따라간다 (src/field.ts).
- 필드 지형: `src/assets/field-terrain.png` 마스크 (흰 걷기 · 초록 숲=도끼 · 파랑 물=배 · 검정 못 감).
  초안은 `node tools/terrain.mjs` 가 색으로 만든다. **직접 고친 마스크 위에 다시 돌리면 덮어쓴다.**
- 그림은 전부 WebP (Chrome 인코더는 알파를 무손실로 저장해서 시트 칸 자르기가 PNG 와 같다). 지형 마스크만 PNG.
- 캐릭터·적·이펙트: 스프라이트 시트 (src/sheet.ts 가 알파를 훑어 칸을 찾는다).
- 충돌은 자체 구현 (원·AABB + 그리드), 저장은 IndexedDB (아직 없음).
- 타격음은 Web Audio 합성 (src/audio.ts). 효과음 에셋이 생기면 Howler 로 교체.

## 규칙

- 게임 데이터(적, 장난감, 방 템플릿)는 `src/data/` JSON 으로 분리한다.
  적 `enemies.json`, 방 `rooms.json`(네 꼭짓점·충돌 맵·나가는 곳 `E`),
  필드 `field.json`(시작점·워프·고양이 키 `catBody`·지형별 속도와 타이밍 `modes`).
- 필드 캐릭터 크기는 `catBody` 한 값으로 정한다. 캐릭터에 딸린 거리·파티클은 전부 이 값의 배수로 쓴다 (픽셀 고정값 금지).
- 던전 입구를 늘릴 땐 `field.json` 의 `warps` 에 항목을 추가한다 (좌표는 필드 그림 픽셀).
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
| `npm run check` | 로직 자체 체크 (충돌, 적 AI, 펀치 판정, 공격 모션, 간격, 필드 워프, 지형별 움직임) |
| `npm run verify` | 빌드 후 Chrome 으로 실제로 돌려 그리기 검사 + 필드↔던전 왕복 + 필드 지형(배·도끼) + 연속 촬영(`tools/out/`) |
| `npm run build` | 타입 체크 + 빌드 (`--base=./` 상대 경로) |
| `node tools/terrain.mjs` | 필드 그림 색으로 지형 마스크 초안 생성 (미리보기 `tools/out/terrain-preview.png`) |

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
src/main.ts        게임 루프, 입력, 장면 전환(페이드) · 던전: 플레이어·전투·렌더·HUD
src/field.ts       필드 로직 (걷기·도끼·배 모드, 배 오르내리기, 워프 머물기) — 순수 로직이라 node 로 체크된다
src/field-draw.ts  필드 그리기 (카메라, 지형 마스크 읽기, 모드별 스프라이트, 수풀·물결·나뭇잎, 워프 임시 그래픽)
src/enemy.ts       쥐 AI (접근·옆자리·예고·공격·쿨다운), 펀치 판정, 몸 간격
src/sheet.ts       스프라이트 시트 슬라이서 (칸 찾기·병합 분리·앵커·행 배율)
src/iso.ts         던전 배경 그림 ↔ 월드 좌표 원근 변환, 충돌 맵·나가는 곳
src/collide.ts     원-AABB 그리드 충돌
src/cat.ts         고양이 시트 행 배정 (기본 · 도끼 · 배)
src/fx.ts          타격 이펙트 시트
src/audio.ts       합성 타격음
src/data/          enemies.json · rooms.json · field.json
src/*.check.ts     npm run check 로 도는 자체 체크
tools/verify.mjs   실제 브라우저 검증
tools/terrain.mjs  필드 지형 마스크 초안 생성
tools/webp.mjs     PNG → WebP (알파 무손실)
```
