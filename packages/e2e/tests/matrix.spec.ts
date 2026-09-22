import { createSurveyRepo } from '../helpers/repos';
import { test, expect } from '../helpers/fixtures';
import {
  acceptOurs,
  confirmWrite,
  enterCurrentRepo,
  openRepo,
  pickTreeBranches,
  setMergeMode,
  turnOffFetch
} from '../helpers/ui';

test('矩阵一格去预演 → 选边落盘 → 回矩阵显示冲突 · 本地临时枝', async ({ app }) => {
  const { dir } = await createSurveyRepo();
  const { page } = app;

  await openRepo(page, dir);
  await enterCurrentRepo(page, '合并');
  await setMergeMode(page, '矩阵');
  await expect(page.getByRole('button', { name: '跑矩阵' })).toBeVisible();

  await pickTreeBranches(page, '合入目标 into', ['main']);
  await pickTreeBranches(page, '我的分支 from', ['feat-c']);
  await expect(page.locator('.chips').filter({ hasText: 'INTO' })).toContainText('main');
  await expect(page.locator('.chips').filter({ hasText: 'FROM' })).toContainText('feat-c');
  await turnOffFetch(page);

  const pending = page.waitForResponse(
    (r) => r.url().includes('/merge/survey') && r.request().method() === 'GET',
    { timeout: 30_000 }
  );
  await page.getByRole('button', { name: '跑矩阵' }).click();
  expect((await pending).ok()).toBeTruthy();

  await expect(page.locator('button.cell.is-conflicts')).toBeVisible();
  await page.locator('button.cell.is-conflicts').click();
  await page.getByRole('button', { name: '去预演' }).click();
  await expect(page.getByText('存在冲突')).toBeVisible();
  await acceptOurs(page);
  await page.getByRole('button', { name: '完成冲突处理' }).click();
  await confirmWrite(page, /worktree add/);

  await expect(page.locator('button.cell.is-stage-local')).toContainText('本地临时枝', { timeout: 30_000 });
});
