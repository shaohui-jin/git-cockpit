/**
 * vitest 全局清理：保证 `test/tmp` 不残留。
 *
 * 背景：`helpers.ts` 的 `tmpBase()` 按 worker 分目录（`test/tmp/w<N>`）建临时 git 仓库，
 * 各测试文件在 `afterAll` 里只清自己的那个 worker 目录。一旦某次运行中断、超时或崩溃，
 * `afterAll` 没执行到，残留就会一直堆着（实测积累过 888 个文件 / 3.9M）。
 *
 * 这里在**整轮测试前后**各删一次整个 `test/tmp`：
 * - setup 先清上一轮残留，保证每轮从干净状态开始；
 * - teardown 收尾，跑完不留垃圾。
 *
 * globalSetup 运行在主进程、所有 worker 之外，不会与正在使用 tmp 的测试并发冲突。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const tmpDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'tmp');

function clean(): void {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    /* 被占用就留着，不影响测试结果 */
  }
}

export function setup(): void {
  clean();
}

export function teardown(): void {
  clean();
}
