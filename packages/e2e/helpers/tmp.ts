import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const e2eRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 临时目录放在包内，避开工作区外写限制。 */
export function tmpBase(): string {
  const base = path.resolve(e2eRoot, 'test', 'tmp');
  fs.mkdirSync(base, { recursive: true });
  return base;
}

export function makeTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(tmpBase(), prefix));
}

export function rmQuiet(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* Windows 偶发占用 */
  }
}
