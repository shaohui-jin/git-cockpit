/**
 * 把目录拷成对别人机器可用的实体文件。
 * pnpm 的 junction / .pnpm 打进安装包后会变成空壳，daemon 就会报找不到 fastify。
 */
const fs = require('node:fs');
const path = require('node:path');

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function copySolid(src, dest) {
  if (!fs.existsSync(src)) {
    throw new Error(`[desktop] 没有可拷的目录：${src}`);
  }
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  walk(src, dest, new Set());
}

function walk(from, to, stack) {
  const real = fs.realpathSync(from);
  if (stack.has(real)) return;
  const next = new Set(stack);
  next.add(real);
  const st = fs.statSync(real);
  if (st.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const name of fs.readdirSync(real)) {
      if (name === '.bin' || name === '.modules.yaml' || name === '.pnpm') continue;
      walk(path.join(real, name), path.join(to, name), next);
    }
    return;
  }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(real, to);
}

function assertRealPackage(root, name) {
  const dir = path.join(root, 'node_modules', ...name.split('/'));
  const pkg = path.join(dir, 'package.json');
  if (!fs.existsSync(pkg) || isLink(dir)) {
    throw new Error(`[desktop] ${name} 不是实体包：${pkg}`);
  }
}

module.exports = { copySolid, isLink, assertRealPackage };
