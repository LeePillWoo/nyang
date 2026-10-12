// npm run check [이름…] — src/**/*.check.ts 를 차례로 돌린다 (로직 자체 체크, node 만으로).
// 이름을 주면 그것만: npm run check -- 숲 마을 (체크 이름 field · village … 또는 한글 별명). 없으면 전부.
// 맨 앞에 deps.check — 파일 폴더 규칙 (2026-10-12 사용자 — 서로 꼬이는 일이 없게):
//   · import 순환 없음
//   · shared/ 는 shared/ 와 data/ 만 가져온다 (맨 밑 층)
//   · 장면 폴더(field · dungeon · fishing · village · mini)끼리는 가져오지 않는다 — shared · bag · data 만 (예외는 EXCEPTIONS)
//   · bag/(가방 · 도감 · 출처)과 main.ts 는 어디서나 가져올 수 있다 (도감 · 출처는 모든 장면을 모은다)
//   · *.check.ts 는 규칙 밖 (순환만 본다)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const SCENES = ['field', 'dungeon', 'fishing', 'village', 'mini'];
/** 장면 폴더끼리 가져와도 되는 것 — 이유와 함께 */
const EXCEPTIONS = {
  'mini/chase-draw.ts → field/squirrel-draw.ts': '다람쥐 잡기는 필드 숲 다람쥐 · 도토리 그리기를 그대로 쓴다',
};
const ORDER = ['collide', 'enemy', 'field', 'dungeon', 'fishing', 'bag', 'maze', 'sandboard', 'timber', 'chase', 'village', 'skills'];
/** 한글 별명 → 체크 이름 (field.check 는 지형 · 다리 · 고래 · 숲까지, skills.check 는 웨이브까지) */
const ALIAS = {
  충돌: 'collide', 몬스터: 'enemy', 적: 'enemy', 펀치: 'enemy',
  필드: 'field', 지형: 'field', 다리: 'field', 고래: 'field', 숲: 'field', 도끼: 'field',
  던전: 'dungeon', 낚시: 'fishing', 가방: 'bag', 상점: 'bag', 미로: 'maze', 샌드보드: 'sandboard',
  장작: 'timber', 다람쥐: 'chase', 마을: 'village', 놀이: 'village', 요리: 'village', 기술: 'skills', 웨이브: 'skills',
};

/** src 아래 .ts 전부 (assets · data 는 뺀다) — 'shared/sheet.ts' 꼴 */
const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return ['assets', 'data'].includes(e.name) ? [] : walk(path.join(dir, e.name));
    return e.name.endsWith('.ts') ? [path.relative(SRC, path.join(dir, e.name)).split(path.sep).join('/')] : [];
  });

// 1) deps.check
{
  const files = walk(SRC);
  const deps = {};
  for (const f of files) {
    const dir = path.posix.dirname(f);
    deps[f] = [...fs.readFileSync(SRC + f, 'utf8').matchAll(/from\s+'(\.{1,2}\/[^']+\.ts)'/g)].map((m) => path.posix.normalize(path.posix.join(dir, m[1])));
  }
  const bad = [];
  // 순환
  const done = new Set();
  const stack = [];
  const dfs = (f) => {
    const i = stack.indexOf(f);
    if (i >= 0) return bad.push('순환: ' + [...stack.slice(i), f].join(' → '));
    if (done.has(f)) return;
    stack.push(f);
    for (const d of deps[f] ?? []) dfs(d);
    stack.pop();
    done.add(f);
  };
  for (const f of files) dfs(f);
  // 폴더 규칙
  const folderOf = (f) => (f.includes('/') ? f.split('/')[0] : 'root');
  for (const f of files) {
    if (f.endsWith('.check.ts')) continue;
    const from = folderOf(f);
    for (const d of deps[f]) {
      const to = folderOf(d);
      const edge = `${f} → ${d}`;
      if (from === 'shared' && to !== 'shared') bad.push(`shared 는 shared 만: ${edge}`);
      else if (SCENES.includes(from) && SCENES.includes(to) && from !== to && !(edge in EXCEPTIONS)) bad.push(`장면 폴더끼리: ${edge}`);
    }
  }
  if (bad.length) {
    console.error('deps.check: 폴더 규칙에 어긋난다 (tools/check.mjs 머리말) —\n  ' + bad.join('\n  '));
    process.exit(1);
  }
  console.log(`deps.check: ok (파일 ${files.length}개 · 순환 없음 · 장면 폴더끼리 import 없음, 예외 ${Object.keys(EXCEPTIONS).length})`);
}

// 2) 체크 파일들 — 이름 → 어느 폴더에 있든 찾는다
const checks = Object.fromEntries(walk(SRC).filter((f) => f.endsWith('.check.ts')).map((f) => [path.posix.basename(f, '.check.ts'), f]));
const args = process.argv.slice(2);
const names = args.length ? [...new Set(args.map((a) => ALIAS[a] ?? a))] : ORDER;
const unknown = names.filter((n) => !checks[n]);
if (unknown.length) {
  console.error(`모르는 체크: ${unknown.join(', ')}\n고를 수 있는 것: ${ORDER.join(' ')}\n별명: ${Object.keys(ALIAS).join(' ')}`);
  process.exit(2);
}
for (const name of ORDER.filter((o) => names.includes(o))) {
  const r = spawnSync(process.execPath, [SRC + checks[name]], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (args.length) console.log(`(${names.join(' · ')} 만 — 전부는 인자 없이)`);
