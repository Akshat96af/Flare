const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;
(async () => {
  const directory = path.resolve('Files/private/verification/settings-motion-' + Date.now());
  await fs.mkdir(directory, { recursive: true });
  const env = { ...process.env, FLARE_DATA_DIR: path.join(directory, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: process.env.FLARE_SMOKE_EXE || require('electron'),
    args: process.env.FLARE_SMOKE_EXE ? ['--portable'] : ['.'],
    env,
    cwd: path.resolve('.'),
    timeout: 60000,
  });
  const errors = [];
  try {
    const page = await app.firstWindow();
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    page.on('pageerror', (e) => errors.push(e.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await app.evaluate(() => {
      global.fetch = async () => {
        throw new Error('No network allowed in settings test');
      };
    });
    assert.equal(await page.evaluate(() => CSS.supports('appearance', 'base-select')), true);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const settle = () =>
      page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
    const signature = page.locator('.maker-signature');
    await expect(signature).toHaveText('Crafted by Akshat96af');
    for (const theme of ['dark', 'light']) {
      await page.getByRole('button', { name: theme + ' theme' }).click();
      await signature.scrollIntoViewIfNeeded();
      await settle();
      assert.equal(
        await signature.evaluate(
          (node) => !!node.previousElementSibling.querySelector('[aria-label="Developer mode"]'),
        ),
        true,
        'Credit is below Developer mode',
      );
      const copy = page.locator('.maker-copy');
      const before = await copy.boundingBox();
      await signature.hover();
      await settle();
      assert.deepEqual(
        await copy.boundingBox(),
        before,
        'Signature text stays stationary on hover',
      );
      await expect
        .poll(() =>
          page.locator('.maker-mark').evaluate((node) => getComputedStyle(node).transform),
        )
        .not.toBe('none');
      const audit = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      assert.deepEqual(
        audit.violations.map((v) => v.id),
        [],
      );
      await page.screenshot({ path: path.join(directory, `signature-${theme}.png`) });
    }
    await page.getByRole('button', { name: /Intelligence/ }).click();
    const provider = page.getByLabel('Use a model', { exact: true });
    await provider.focus();
    assert.equal(
      await page
        .locator('.settings-panel')
        .evaluate(
          (node) =>
            node
              .getAnimations({ subtree: true })
              .filter((a) => a.id === 'flare-panel' && a.playState === 'running').length,
        ),
      0,
      'Focus settles the moving form before the menu opens',
    );
    for (const theme of ['dark', 'light']) {
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      await provider.click();
      await expect(provider).toHaveJSProperty('value', 'off');
      assert.equal(await provider.evaluate((node) => node.matches(':open')), true);
      assert.equal(
        await provider.evaluate((node) =>
          node.getAnimations().some((a) => a.effect.getKeyframes().some((frame) => frame.scale)),
        ),
        false,
        'Picker must not bounce on click',
      );
      const option = page.getByRole('option', { name: 'OpenRouter (free models)', exact: true });
      await expect(option).toBeVisible();
      await settle();
      const box = await option.boundingBox();
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= viewport.width &&
          box.y + box.height <= viewport.height,
      );
      await page.screenshot({ path: path.join(directory, `picker-${theme}.png`) });
      await page.keyboard.press('Escape');
      await expect.poll(() => provider.evaluate((node) => node.matches(':open'))).toBe(false);
      assert.equal(
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
        true,
        'Escape closes picker before launcher',
      );
    }
    await provider.click();
    await page.getByRole('option', { name: 'OpenRouter (free models)', exact: true }).click();
    await expect(provider).toHaveValue('openrouter');
    await expect(page.getByLabel('API key', { exact: true })).toBeVisible();
    for (const value of ['gemini', 'openai', 'anthropic', 'off']) {
      await provider.selectOption(value);
      await expect(provider).toHaveValue(value);
    }
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setResizable(true);
      win.setSize(380, 730);
      win.setResizable(false);
    });
    await provider.click();
    await settle();
    await page.screenshot({ path: path.join(directory, 'picker-narrow.png') });
    await page.keyboard.press('Escape');
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    const audit = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => v.id),
      [],
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await provider.evaluate(
        (node) => getComputedStyle(node, '::picker(select)').transitionDuration,
      ),
      '0s',
    );
    await page.getByTitle('Back', { exact: true }).click();
    await signature.scrollIntoViewIfNeeded();
    await expect(signature).toBeVisible();
    assert.equal(
      await page.locator('.maker-copy').evaluate((node) => getComputedStyle(node).animationName),
      'none',
    );
    await signature.hover();
    assert.equal(
      await page.locator('.maker-mark').evaluate((node) => getComputedStyle(node).transform),
      'none',
    );
    assert.equal(await signature.evaluate((node) => node.scrollWidth > node.clientWidth), false);
    await page.getByRole('switch', { name: 'Developer mode', exact: true }).click();
    await signature.scrollIntoViewIfNeeded();
    assert.equal(
      await signature.evaluate((node) => node.previousElementSibling.className),
      'diagnostic',
    );
    await page.getByRole('switch', { name: 'Liquid glass', exact: true }).click();
    await signature.scrollIntoViewIfNeeded();
    await expect(signature).toBeVisible();
    await page.screenshot({ path: path.join(directory, 'signature-compact-reduced.png') });
    await page.getByTitle('Close settings').click();
    await page.keyboard.press('Escape');
    assert.equal(
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()),
      false,
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        directory,
        checks: [
          'Stable picker anchor',
          'No select bounce',
          'Dark/light menus',
          'Option selection',
          '380px layout',
          'Keyboard Escape',
          'Reduced motion',
          'Accessibility',
          'Maker credit below Developer mode, stable hover, dark/light contrast, compact and reduced-motion fallbacks',
        ],
      }),
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
