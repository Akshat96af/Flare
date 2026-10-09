const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

(async () => {
  const directory = path.resolve('Files/private/verification/floating-glass-' + Date.now());
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
  const errors = [],
    checks = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    const rail = page.locator('.search-bar'),
      face = page.locator('.search-surface');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'dark theme' }).click();
    await page.getByTitle('Close settings', { exact: true }).click();
    const settle = async () => {
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
      await expect(rail).toHaveAttribute('data-hover-motion', 'idle');
    };
    await page.mouse.move(0, 0);
    await settle();
    let box = await rail.boundingBox();
    const originalBox = { ...box };
    const idle = await face.evaluate((node) => getComputedStyle(node).transform);
    const before = await rail.screenshot();
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.2, { steps: 8 });
    await settle();
    const tilted = await face.evaluate((node) => getComputedStyle(node).transform);
    assert.notEqual(tilted, idle);
    assert.deepEqual(await rail.boundingBox(), originalBox, 'Outer hover target never moves');
    const after = await rail.screenshot();
    const a = await sharp(before).ensureAlpha().raw().toBuffer();
    const b = await sharp(after).ensureAlpha().raw().toBuffer();
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 12) changed++;
    assert.ok(changed > 800, 'Hover visibly changes rendered pixels');
    await page.screenshot({ path: path.join(directory, 'dark-left.png') });
    await page.mouse.move(box.x + box.width * 0.72, box.y + box.height * 0.7, { steps: 8 });
    await settle();
    const opposite = await face.evaluate((node) => getComputedStyle(node).transform);
    assert.notEqual(opposite, tilted, 'Tilt follows both pointer axes');
    await page.screenshot({ path: path.join(directory, 'dark-right.png') });
    await page.mouse.down();
    await settle();
    assert.notEqual(
      await face.evaluate((node) => getComputedStyle(node).transform),
      opposite,
      'Pressure compresses the surface',
    );
    await page.mouse.up();
    await settle();
    await page.mouse.move(0, 0);
    await settle();
    assert.equal(
      await face.evaluate((node) => getComputedStyle(node).transform),
      idle,
      'Return ends exactly at rest',
    );
    checks.push('Pixel-visible lift, two-axis tilt, pressure, fixed hit region and exact return');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.mouse.move(box.x + 120, box.y + 30);
    await settle();
    assert.equal(await face.evaluate((node) => getComputedStyle(node).transform), idle);
    await page.mouse.move(0, 0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'light theme' }).click();
    await page.getByTitle('Close settings', { exact: true }).click();
    await settle();
    await page.mouse.move(box.x + box.width * 0.6, box.y + 30);
    await settle();
    await page.screenshot({ path: path.join(directory, 'light.png') });
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setResizable(true);
      win.setSize(380, 500);
      win.setResizable(false);
    });
    await page.mouse.move(0, 0);
    await settle();
    box = await rail.boundingBox();
    await page.mouse.move(box.x + 140, box.y + 50);
    await settle();
    assert.equal(
      await page.locator('.launcher').evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await page.getByRole('combobox', { name: 'Search Flare' }).fill('responsive');
    await expect(page.getByRole('combobox', { name: 'Search Flare' })).toHaveValue('responsive');
    await page.screenshot({ path: path.join(directory, 'compact.png') });
    checks.push('Reduced motion, light theme, compact layout and typing remain usable');
    assert.equal(
      await page.locator('.glass-sheen, .glass-wake, .glass-sculpture, canvas').count(),
      0,
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ directory, checks, errors }, null, 2));
  } catch (error) {
    await (await app.firstWindow()).screenshot({ path: path.join(directory, 'failure.png') });
    throw error;
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
