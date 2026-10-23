import { createDirtyRepo } from '../helpers/repos';
import { test } from '../helpers/fixtures';
import { openRepo } from '../helpers/ui';

test('输入框宽度确认（临时）', async ({ app }) => {
  const { dir } = await createDirtyRepo();
  const { page } = app;
  await openRepo(page, dir);
  await page.waitForTimeout(800);
  const w = await page.locator('.open-input').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  console.log('输入框宽度=' + w);
  await page.screenshot({ path: 'C:/Users/11061092/AppData/Local/Temp/input-wide.png' });
  await page.locator('.open-input').screenshot({ path: 'C:/Users/11061092/AppData/Local/Temp/input-wide-only.png' });
});
