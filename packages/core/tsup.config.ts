export default {
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  outDir: 'dist',
  // node:sqlite 必须保持前缀（tsup/esbuild 内置列表不含新的内建模块，会剥离 node: 前缀
  // 导致产物变成 import "sqlite" 而无法运行）
  external: ['node:sqlite']
};