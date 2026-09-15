/**
 * extraResources 不会把 pnpm junction / .pnpm 打进安装包，
 * 成品里往往只剩 dist，daemon 一 import fastify 就炸。
 * 这里用已经摊平的 runtime/node_modules 覆盖进 unpacked resources。
 */
const path = require('node:path');
const { copySolid, assertRealPackage } = require('./copy-solid.cjs');

async function afterPack(context) {
  const runtimeNm = path.join(__dirname, '..', 'runtime', 'node_modules');
  const destRoot = path.join(context.appOutDir, 'resources', 'mcp-server');
  const destNm = path.join(destRoot, 'node_modules');
  copySolid(runtimeNm, destNm);
  for (const name of ['fastify', '@fastify/cors', '@shaohui_jin/git-cockpit-core', 'simple-git']) {
    assertRealPackage(destRoot, name);
  }
  console.log(`[desktop] afterPack node_modules -> ${destNm}`);
}

module.exports = afterPack;
module.exports.default = afterPack;
