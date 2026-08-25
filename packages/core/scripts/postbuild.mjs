/**
 * 构建后修复：tsup 会把 external 的 node:sqlite 剥离成裸 "sqlite"（它假定消费者兼容性
 * 而不认识新的内置模块列表）。该脚本将 dist 产物中的裸 sqlite 引用还原为 node:sqlite，
 * 使产物可被 Node 直接解析。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let fixed = 0;

for (const f of readdirSync(dist)) {
  if (!/\.(js|mjs|cjs)$/.test(f)) continue;
  const p = join(dist, f);
  const before = readFileSync(p, 'utf8');
  const after = before
    .replace(/\bfrom\s+['"]sqlite['"]/g, 'from "node:sqlite"')
    .replace(/\bimport\s+['"]sqlite['"]\s*;/g, 'import "node:sqlite";')
    .replace(/\brequire\(\s*['"]sqlite['"]\s*\)/g, 'require("node:sqlite")')
    .replace(/\bimport\(\s*['"]sqlite['"]\s*\)/g, 'import("node:sqlite")');
  if (after !== before) {
    writeFileSync(p, after, 'utf8');
    fixed += 1;
    console.log(`[postbuild] fixed ${f}`);
  }
}

console.log(`[postbuild] done, ${fixed} file(s) fixed`);