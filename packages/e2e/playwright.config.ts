import { defineConfig } from '@playwright/test';

const channel = process.env.E2E_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : 'chrome');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list']],
  outputDir: './test-results',
  use: {
    channel,
    viewport: { width: 1400, height: 900 },
    locale: 'zh-CN',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
