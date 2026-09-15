import * as path from 'node:path';
import { createCloneSource } from '../helpers/repos';
import { test, expect } from '../helpers/fixtures';

test('工作台克隆后任务列表出现克隆任务', async ({ app }) => {
  const { dir: src } = await createCloneSource();
  const dest = path.join(app.tmp, 'cloned');
  const { page } = app;

  await page.getByRole('button', { name: '克隆到本地' }).click();
  await expect(page.getByRole('dialog', { name: '克隆到本地' })).toBeVisible();
  await page.getByPlaceholder(/github.com/).fill(src);
  await page.getByPlaceholder(/本地空目录/).fill(dest);

  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/jobs/clone') && r.request().method() === 'POST'),
    page.getByRole('button', { name: '开始克隆' }).click()
  ]);
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as { job: { kind: string; status: string } };
  expect(body.job.kind).toBe('clone');
  expect(body.job.status).toBe('running');

  await page.locator('.dock-btn', { hasText: '任务' }).click();
  await expect(page).toHaveURL(/#\/jobs/);
  const row = page.locator('.job-row').filter({ hasText: '克隆' }).first();
  await expect(row).toBeVisible();
  await expect(row).toContainText(/进行中|成功/);
});
