import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const OUT = 'D:/_myproject/git-cockpit/.workbuddy-ai/tmp-shots';
const errors = [];

const run = async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  await page.goto(`${BASE}/#/status`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  // 进入当前仓（若尚未打开）
  const entered = await page.evaluate(() => !!document.querySelector('.st-path'));
  if (!entered) {
    console.log('NOT_IN_REPO');
  }

  // ── 1) 工作区：点第一个更改文件，截差异监视器 ──
  const firstFile = page.locator('.chg-row .chg-path').first();
  if (await firstFile.count()) {
    await firstFile.click();
    await page.waitForTimeout(900);
    const mon = page.locator('.monitor-card');
    if (await mon.count()) await mon.screenshot({ path: `${OUT}/live-monitor.png` });
    const info = await page.evaluate(() => {
      const body = document.querySelector('.monitor-body');
      const dlines = body ? body.querySelectorAll('.dline').length : 0;
      const hunks = body ? body.querySelectorAll('.hunk').length : 0;
      const add = body ? body.querySelectorAll('.dline.add').length : 0;
      const del = body ? body.querySelectorAll('.dline.del').length : 0;
      const fh = document.querySelector('.file-head');
      return {
        dlines,
        hunks,
        add,
        del,
        fileHead: fh ? fh.textContent.replace(/\s+/g, ' ').trim() : null,
        monitorFileDup: !!document.querySelector('.monitor-file')
      };
    });
    console.log('MONITOR', JSON.stringify(info));
  } else {
    console.log('NO_CHG_ROWS');
  }

  // ── 2) 历史：切到历史模式，点第一条提交，截详情抽屉 ──
  const histTab = page.locator('.history-tabs button, .st-toolbar button', { hasText: '历史' }).first();
  if (await histTab.count()) {
    await histTab.click();
    await page.waitForTimeout(900);
    const row = page.locator('.commit-row').first();
    if (await row.count()) {
      await row.click();
      await page.waitForTimeout(1100);
      const drawer = page.locator('.ch-detail');
      if (await drawer.count()) await drawer.screenshot({ path: `${OUT}/live-drawer.png` });
      const info = await page.evaluate(() => {
        const d = document.querySelector('.cd-diff');
        return {
          hasDiff: !!d,
          dlines: d ? d.querySelectorAll('.dline').length : 0,
          hunks: d ? d.querySelectorAll('.hunk').length : 0,
          add: d ? d.querySelectorAll('.dline.add').length : 0,
          del: d ? d.querySelectorAll('.dline.del').length : 0,
          firstHunk: d ? (d.querySelector('.hunk')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
          addBg: d ? getComputedStyle(d.querySelector('.dline.add') || d).backgroundColor : null,
          addShadow: d ? getComputedStyle(d.querySelector('.dline.add') || d).boxShadow : null,
          addColor: d ? getComputedStyle(d.querySelector('.dline.add .code') || d).color : null,
          delBg: d ? getComputedStyle(d.querySelector('.dline.del') || d).backgroundColor : null,
          delColor: d ? getComputedStyle(d.querySelector('.dline.del .code') || d).color : null,
          hunkBg: d ? getComputedStyle(d.querySelector('.hunk') || d).backgroundColor : null,
          rngColor: d ? getComputedStyle(d.querySelector('.hunk .rng') || d).color : null,
          fileHead: d ? (d.querySelector('.diff-file-head')?.textContent || '').replace(/\s+/g, ' ').trim() : null
        };
      });
      console.log('DRAWER', JSON.stringify(info));
    } else {
      console.log('NO_COMMIT_ROWS');
    }
  } else {
    console.log('NO_HISTORY_TAB');
  }

  await browser.close();
  if (errors.length) {
    console.log('JS_ERRORS', JSON.stringify(errors.slice(0, 6)));
    process.exitCode = 2;
  } else {
    console.log('NO_JS_ERRORS');
  }
};

run().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
