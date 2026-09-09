import { expect, type Page } from '@playwright/test';

export async function gotoDashboard(page: Page, baseURL: string): Promise<void> {
  await page.goto(`${baseURL}/#/dashboard`);
  await expect(page.getByText('后端已连接')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
}

export async function openRepo(page: Page, repoPath: string): Promise<void> {
  await page.getByPlaceholder(/输入本地 Git 仓库路径/).fill(repoPath);
  await page.getByRole('button', { name: '打开', exact: true }).click();
  await expect(page.locator('.repo-card').first()).toBeVisible({ timeout: 20_000 });
}

export async function enterCurrentRepo(page: Page, action: '进入' | '合并'): Promise<void> {
  await page.locator('.repo-card').first().getByRole('button', { name: action }).click();
}

export function writeDialog(page: Page) {
  return page.locator('.el-overlay:visible .el-dialog').filter({ hasText: '将执行的命令' });
}

export async function expectDryRunCommand(page: Page, expected: string | RegExp): Promise<void> {
  const dialog = writeDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('将执行的命令（dry-run 预览，未实际执行）')).toBeVisible();
  await expect(dialog.locator('pre')).toContainText(expected);
}

export async function confirmWrite(page: Page, expected?: string | RegExp): Promise<void> {
  if (expected) await expectDryRunCommand(page, expected);
  else await expect(writeDialog(page)).toBeVisible();
  await writeDialog(page).getByRole('button', { name: '确认执行' }).click();
  await expect(writeDialog(page)).toHaveCount(0);
}

export async function cancelWrite(page: Page): Promise<void> {
  await writeDialog(page).getByRole('button', { name: '取消' }).click();
  await expect(writeDialog(page)).toHaveCount(0);
}

export async function setMergeMode(page: Page, mode: '单对预演' | '矩阵'): Promise<void> {
  await page.locator('.el-radio-button__inner', { hasText: mode }).click();
}

export async function waitPairBranches(page: Page, into: string, from: string): Promise<void> {
  const bar = page.locator('.filter-card').first();
  await expect(bar).toContainText(into);
  await expect(bar).toContainText(from);
}

export async function runPairPreview(page: Page): Promise<void> {
  const pending = page.waitForResponse(
    (r) => r.url().includes('/merge/rehearse') && r.request().method() === 'GET',
    { timeout: 30_000 }
  );
  await page.getByRole('button', { name: '预演', exact: true }).click();
  const res = await pending;
  if (!res.ok()) {
    throw new Error(`预演失败 HTTP ${res.status()}: ${await res.text()}`);
  }
}

export async function turnOffFetch(page: Page): Promise<void> {
  const sw = page.locator('.filter-card .field-switch .el-switch').first();
  await expect(sw).toBeVisible();
  if (await sw.evaluate((el) => el.classList.contains('is-checked'))) {
    await sw.click();
  }
  await expect(sw).not.toHaveClass(/is-checked/);
}

export async function pickTreeBranches(page: Page, fieldHint: string, names: string[]): Promise<void> {
  const field = page.locator('.field').filter({ hasText: fieldHint });
  await field.locator('.el-select__wrapper').click();
  for (const name of names) {
    const combo = field.getByRole('combobox');
    await combo.fill(name);
    const item = page.getByRole('treeitem', { name, exact: true });
    await expect(item).toBeVisible();
    await item.click({ force: true });
  }
  await page.keyboard.press('Escape');
}

export async function acceptOurs(page: Page): Promise<void> {
  await page.getByRole('button', { name: '≫' }).click();
  await expect(page.getByTitle('已采用线上')).toBeVisible();
}
