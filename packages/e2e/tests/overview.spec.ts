import { createDirtyRepo } from '../helpers/repos';
import { test, expect } from '../helpers/fixtures';
import { openRepo } from '../helpers/ui';

test('工作台 overview 脏计数：卡片显示更改、筛选有更改', async ({ app }) => {
  const { dir } = await createDirtyRepo();
  const { page } = app;

  await openRepo(page, dir);
  const card = page.locator('.repo-card').first();
  await expect(card).toBeVisible();
  await expect(card.getByText(/1 更改/)).toBeVisible();

  await page.getByRole('button', { name: /有更改 1/ }).click();
  await expect(card).toBeVisible();
  await expect(card.getByText(/1 更改/)).toBeVisible();
});
