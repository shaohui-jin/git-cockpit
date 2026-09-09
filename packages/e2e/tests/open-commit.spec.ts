import { createDirtyRepo } from '../helpers/repos';
import { test, expect } from '../helpers/fixtures';
import { cancelWrite, confirmWrite, enterCurrentRepo, expectDryRunCommand, openRepo } from '../helpers/ui';

test('打开仓 → 状态页暂存 → 提交 dry-run 可见 git 命令', async ({ app }) => {
  const { dir } = await createDirtyRepo();
  const { page } = app;

  await openRepo(page, dir);
  await enterCurrentRepo(page, '进入');
  await expect(page).toHaveURL(/#\/status/);
  await expect(page.getByText('a.txt').first()).toBeVisible();

  await page.getByRole('button', { name: '暂存全部', exact: true }).click();
  await confirmWrite(page, /git add -- \./);
  await expect(page.getByText('git_add 执行成功')).toBeVisible();

  await page.getByRole('button', { name: '提交 Commit' }).click();
  await page.getByPlaceholder('输入提交信息（message）').fill('e2e: stage and commit preview');
  await page.getByRole('button', { name: '下一步（dry-run 预览）' }).click();
  await expectDryRunCommand(page, /git commit -m e2e: stage and commit preview/);
  await cancelWrite(page);
});
