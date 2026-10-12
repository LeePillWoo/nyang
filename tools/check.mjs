// npm run check [이름…] — src/*.check.ts 를 차례로 돌린다 (로직 자체 체크, node 만으로).
// 이름을 주면 그것만: npm run check -- 숲 마을 (파일 이름 field · village … 또는 한글 별명). 없으면 전부.
// 맨 앞에 import 순환 검사 — 파일끼리 서로 가져오면(꼬임) 여기서 바로 잡힌다 (2026-10-12 사용자 — 서로 꼬이는 일이 없게).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const ORDER = ['collide', 'enemy', 'field', 'dungeon', 'fishing', 'bag', 'maze', 'sandboard', 'timber', 'chase', 'village', 'skills'];
/** 한글 별명 → 체크 파일 (field.check 는 지형 · 다리 · 고래 · 숲까지, skills.check 는 웨이브까지) */
const ALIAS = {
  충돌: 'collide', 몬스터: 'enemy', 적: 'enemy', 펀치: 'enemy',
  필드: 'field', 지형: 'field', 다리: 'field', 고래: 'field', 숲: 'field', 도끼: 'field',
  던전: 'dungeon', 낚시: 'fishing', 가방: 'bag', 상점: 'bag', 미로: 'maze', 샌드보드: 'sandboard',
  장작: 'timber', 다람쥐: 'chase', 마을: 'village', 놀이: 'village', 요리: 'village', 기술: 'skills', 웨이브: 'skills',
};

// 1) import 순환 — src/*.ts 가 서로를 가져오는 고리가 있으면 실패
{
  const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.ts'));
  const deps = Object.fromEntries(files.map((f) => [f, [...fs.readFileSync(SRC + f, 'utf8').matchAll(/from\s+'\.\/([^']+\.ts)'/g)].map((m) => m[1])]));
  const cycles = [];
  const done = new Set();
  const stack = [];
  const dfs = (f) => {
    const i = stack.indexOf(f);
    if (i >= 0) return cycles.push([...stack.slice(i), f].join(' → '));
    if (done.has(f)) return;
    stack.push(f);
    for (const d of deps[f] ?? []) dfs(d);
    stack.pop();
    done.add(f);
  };
  for (const f of files) dfs(f);
  if (cycles.length) {
    console.error('import 순환 (서로 가져온다 — 한쪽을 공용 파일로 빼거나 main 에서 잇는다):\n  ' + cycles.join('\n  '));
    process.exit(1);
  }
  console.log(`deps.check: ok (파일 ${files.length}개, 순환 없음)`);
}

// 2) 체크 파일들
const args = process.argv.slice(2);
const names = args.length ? [...new Set(args.map((a) => ALIAS[a] ?? a))] : ORDER;
const bad = names.filter((n) => !ORDER.includes(n));
if (bad.length) {
  console.error(`모르는 체크: ${bad.join(', ')}\n고를 수 있는 것: ${ORDER.join(' ')}\n별명: ${Object.keys(ALIAS).join(' ')}`);
  process.exit(2);
}
for (const name of ORDER.filter((o) => names.includes(o))) {
  const r = spawnSync(process.execPath, [`${SRC}${name}.check.ts`], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
}
if (args.length) console.log(`(${names.join(' · ')} 만 — 전부는 인자 없이)`);
