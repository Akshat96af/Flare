const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const AxeBuilder = require('@axe-core/playwright').default;

(async () => {
  const directory = path.resolve('Files/private/verification/ui-' + Date.now());
  await fs.mkdir(directory, { recursive: true });
  const env = { ...process.env, FLARE_DATA_DIR: path.join(directory, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({
    executablePath: process.env.FLARE_SMOKE_EXE || require('electron'),
    args: process.env.FLARE_SMOKE_EXE ? ['--portable'] : ['.'],
    cwd: path.resolve('.'),
    env,
    timeout: 60000,
  });
  const errors = [],
    checks = [],
    audits = [];
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    // Intercept only this isolated test process. No app launches, mutations or AI calls.
    await instance.evaluate(({ ipcMain }) => {
      const original = ipcMain._invokeHandlers.get('flare:call');
      global.uiFixture = { opened: [], previews: 0, searches: [], release: null };
      global.fetch = async () => {
        throw new Error('Network disabled in UI smoke test');
      };
      ipcMain.removeHandler('flare:call');
      ipcMain.handle('flare:call', async (event, method, data) => {
        const state = global.uiFixture;
        if (method === 'open') {
          state.opened.push(data);
          return { message: 'Fixture opened' };
        }
        if (method === 'search') {
          state.searches.push(data.query);
          if (data.query === 'second') {
            await new Promise((resolve) => {
              state.release = resolve;
            });
            return [];
          }
          return [
            {
              id: 'fixture:file',
              kind: 'file',
              title: 'Art direction.md',
              detail: 'Design / Flare / Art direction.md',
            },
          ];
        }
        if (method === 'preview') {
          state.previews++;
          await new Promise((resolve) => {
            state.release = resolve;
          });
          return {
            name: 'Art direction.md',
            text: 'A fixture preview.',
            size: 42,
            type: 'Markdown',
            path: 'fixture',
            modified: Date.now(),
            created: Date.now(),
          };
        }
        return original(event, method, data);
      });
    });
    const input = page.getByRole('combobox', { name: 'Search Flare' });
    const settings = page.getByRole('button', { name: 'Settings', exact: true });
    const settle = () =>
      page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
    const release = () =>
      instance.evaluate(() => {
        global.uiFixture.release?.();
        global.uiFixture.release = null;
      });
    await settle();
    await input.fill('first');
    await page.getByRole('option', { name: /Art direction/ }).waitFor();
    await settings.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert.equal(await instance.evaluate(() => global.uiFixture.opened.length), 0);
    checks.push('Enter on a toolbar control does not also open a search result');
    await page.getByTitle('Close settings', { exact: true }).click();
    await page.getByRole('option').waitFor();
    await input.fill('second');
    await input.press('Enter');
    assert.equal(await instance.evaluate(() => global.uiFixture.opened.length), 0);
    await expect
      .poll(() => instance.evaluate(() => global.uiFixture.searches.includes('second')))
      .toBe(true);
    await release();
    await page.getByText('No results', { exact: true }).waitFor();
    checks.push('Changing a query immediately invalidates old results and Enter cannot open them');
    await input.fill('first');
    await page.getByRole('option').waitFor();
    await page.getByRole('tab', { name: 'All', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: 'Apps', exact: true })).toBeFocused();
    await expect(page.getByRole('tab', { name: 'Apps', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('button', { name: 'Preview Art direction.md' }).click();
    await expect.poll(() => instance.evaluate(() => global.uiFixture.previews)).toBe(1);
    await settings.click();
    await release();
    await page.getByTitle('Close settings', { exact: true }).click();
    await page.getByRole('option').waitFor();
    assert.equal(await page.locator('.preview-panel').count(), 0);
    checks.push('Late preview cannot reappear after navigating away; filter tabs support arrows');
    await page.getByRole('button', { name: 'Preview Art direction.md' }).click();
    await expect.poll(() => instance.evaluate(() => global.uiFixture.previews)).toBe(2);
    await release();
    await page.locator('.preview-panel').waitFor();
    await page.getByRole('button', { name: 'File details' }).click();
    await expect(page.getByRole('button', { name: 'File details' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await settle();
    await page.screenshot({ path: path.join(directory, '01-glass-search.png') });
    const audit = async (name) => {
      await settle();
      const result = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      audits.push({ name, violations: result.violations });
      assert.equal(result.violations.length, 0, name + ' accessibility');
    };
    await audit('search and metadata');
    await settings.click();
    await page.getByRole('button', { name: 'light theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await settle();
    await page.locator('.settings-panel').evaluate((panel) => {
      panel.scrollTop = 0;
    });
    await page.screenshot({ path: path.join(directory, '02-light-settings.png') });
    await audit('light settings');
    await page.getByRole('button', { name: /^Intelligence/ }).click();
    await page.getByLabel('Use a model', { exact: true }).selectOption('gemini');
    await settle();
    await page.screenshot({ path: path.join(directory, '03-model-picker.png') });
    await page.getByTitle('Back', { exact: true }).click();
    await page.getByRole('button', { name: 'dark theme' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const glassFlash = await page.getByRole('button', { name: 'dark theme' }).evaluate((button) => {
      button.click();
      return (
        Number(getComputedStyle(button, '::after').opacity) > 0 &&
        getComputedStyle(button).opacity === '1'
      );
    });
    assert.equal(glassFlash, true, 'Click illuminates only the glass edge, not the whole control');
    await settle();
    await expect
      .poll(() =>
        page
          .getByRole('button', { name: 'dark theme' })
          .evaluate((button) => getComputedStyle(button, '::after').opacity),
      )
      .toBe('0');
    const press = await page.getByRole('switch', { name: 'Liquid glass' }).evaluate((button) => {
      button.click();
      return button.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.scale));
    });
    assert.equal(press, true, 'Click creates bounded scale feedback');
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'off');
    await page.getByRole('switch', { name: 'Liquid glass' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-glass', 'on');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await settle();
    assert.equal(
      await page.getByRole('button', { name: 'dark theme' }).evaluate((button) => {
        button.click();
        return button.getAnimations().some((a) => a.effect.getKeyframes().some((k) => k.scale));
      }),
      false,
      'Reduced motion disables JS feedback',
    );
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await instance.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setResizable(true);
      win.setSize(380, 760);
      win.setResizable(false);
    });
    await settle();
    await page.screenshot({ path: path.join(directory, '04-narrow-settings.png') });
    await audit('380px settings');
    assert.equal(
      await page.locator('.launcher').evaluate((el) => el.scrollWidth > el.clientWidth),
      false,
    );
    await page.getByTitle('Close settings', { exact: true }).click();
    await input.fill('');
    await page.evaluate(() => {
      const settings = document.querySelector('button[aria-label="Settings"]');
      for (let i = 0; i < 20; i++) settings.click();
    });
    await settle();
    assert.equal(
      await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === 'running').length,
      ),
      0,
    );
    checks.push(
      'Press feedback, reduced motion, glass opt-out, narrow layout and rapid-click settling',
    );
    await page.keyboard.press('Escape');
    assert.equal(
      await instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false,
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ checks, audits, errors }, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          directory,
          checks,
          audits: audits.map((x) => ({ name: x.name, violations: x.violations.length })),
        },
        null,
        2,
      ),
    );
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
