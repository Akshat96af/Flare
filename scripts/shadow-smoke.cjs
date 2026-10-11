const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

(async () => {
  const directory = path.resolve('Files/private/verification/shadow-' + Date.now());
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
  const checks = [],
    errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await app.evaluate(({ app }) => app.emit('second-instance'));
    await expect(page.locator('.launcher')).toHaveAttribute('data-launch-motion', 'idle');
    for (const width of [760, 380]) {
      await app.evaluate(({ BrowserWindow }, width) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setResizable(true);
        win.setSize(width, win.getBounds().height);
        win.setResizable(false);
      }, width);
      for (const theme of ['dark', 'light']) {
        for (const glass of [true, false]) {
          await page.getByRole('button', { name: 'Settings', exact: true }).click();
          await page.getByRole('button', { name: theme + ' theme' }).click();
          const toggle = page.getByRole('switch', { name: 'Liquid glass', exact: true });
          if ((await toggle.getAttribute('aria-checked')) !== String(glass)) await toggle.click();
          await page.getByTitle('Close settings', { exact: true }).click();
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await expect(page.locator('html')).toHaveAttribute('data-glass', glass ? 'on' : 'off');
          for (const expanded of [false, true]) {
            if (expanded) await page.getByRole('button', { name: 'Settings', exact: true }).click();
            await page.evaluate(async () => {
              await Promise.all(
                document
                  .getAnimations()
                  .filter((a) => a.effect.getComputedTiming().iterations !== Infinity)
                  .map((a) => a.finished.catch(() => {})),
              );
            });
            await page.waitForTimeout(150);
            await expect
              .poll(() =>
                page.evaluate(() => {
                  const height = document.querySelector('.launcher').clientHeight + 74;
                  return Math.abs(window.innerHeight - height);
                }),
              )
              .toBeLessThanOrEqual(2);
            const box = await page.locator('.launcher').boundingBox();
            const name = `${width}-${theme}-${glass ? 'glass' : 'solid'}-${expanded ? 'settings' : 'search'}`;
            const png = await page.screenshot({
              path: path.join(directory, name + '.png'),
              omitBackground: true,
            });
            const { data, info } = await sharp(png)
              .ensureAlpha()
              .raw()
              .toBuffer({ resolveWithObject: true });
            const alpha = (x, y) => data[(y * info.width + x) * 4 + 3];
            let edgeAlpha = 0;
            for (let x = 0; x < info.width; x++) {
              edgeAlpha = Math.max(edgeAlpha, alpha(x, 0), alpha(x, info.height - 1));
            }
            for (let y = 0; y < info.height; y++) {
              edgeAlpha = Math.max(edgeAlpha, alpha(0, y), alpha(info.width - 1, y));
            }
            assert.ok(
              edgeAlpha <= 1,
              `${name}: shadow must fade out before the native window edge (alpha ${edgeAlpha})`,
            );
            const centerX = Math.round(box.x + box.width / 2);
            assert.ok(alpha(centerX, Math.round(box.y + 40)) > 240, `${name}: launcher is visible`);
            assert.ok(
              alpha(centerX, Math.ceil(box.y + box.height) + 3) > 5,
              `${name}: soft shadow remains visible below panel`,
            );
            assert.equal(alpha(0, 0), 0, `${name}: no rectangular canvas background`);
            await sharp(png)
              .flatten({ background: '#bcc5ca' })
              .toFile(path.join(directory, name + '-composite.png'));
            checks.push({ name, edgeAlpha, box });
            if (expanded) await page.getByTitle('Close settings', { exact: true }).click();
          }
        }
      }
    }
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ directory, checks, errors }, null, 2));
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
