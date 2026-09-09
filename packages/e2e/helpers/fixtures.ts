import * as path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startDaemon, type Daemon } from './daemon';
import { makeTmpDir, rmQuiet } from './tmp';
import { gotoDashboard } from './ui';

export interface AppFixture {
  page: Page;
  baseURL: string;
  tmp: string;
}

export const test = base.extend<{ app: AppFixture }>({
  app: async ({ page }, use) => {
    const tmp = makeTmpDir('run-');
    const daemon: Daemon = await startDaemon(path.join(tmp, 'data'));
    try {
      await gotoDashboard(page, daemon.baseURL);
      await use({ page, baseURL: daemon.baseURL, tmp });
    } finally {
      await daemon.stop();
      rmQuiet(tmp);
    }
  }
});

export { expect };
