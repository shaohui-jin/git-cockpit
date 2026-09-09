import { createConflictRepo } from '../helpers/repos';
import { test, expect } from '../helpers/fixtures';
import {
  acceptOurs,
  confirmWrite,
  enterCurrentRepo,
  openRepo,
  runPairPreview,
  turnOffFetch,
  waitPairBranches
} from '../helpers/ui';

test('单对冲突预演 → 选线上 → 落盘（无 remote 不 push）', async ({ app }) => {
  const { dir } = await createConflictRepo();
  const { page } = app;

  await openRepo(page, dir);
  await enterCurrentRepo(page, '合并');
  await expect(page).toHaveURL(/#\/merge/);
  await waitPairBranches(page, 'main', 'feature');

  await turnOffFetch(page);
  await runPairPreview(page);
  await expect(page.getByText('存在冲突')).toBeVisible();
  await acceptOurs(page);
  await page.getByRole('button', { name: '落盘并推送' }).click();
  await confirmWrite(page, /worktree add/);
  await expect(page.getByText('落盘结果')).toBeVisible();
  await expect(page.locator('.apply-card')).toContainText('临时分支');
});
