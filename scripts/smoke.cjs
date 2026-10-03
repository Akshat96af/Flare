const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const AxeBuilder = require('@axe-core/playwright').default;
const { expect } = require('@playwright/test');
(async () => {
  const directory = path.resolve('Files/private/verification/desktop-' + Date.now());
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
    audits = [];
  instance.process().stderr.on('data', (x) => {
    const text = x.toString();
    if (!/ExperimentalWarning|electron\/security|Autofill/.test(text)) process.stdout.write(text);
  });
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('combobox', { name: 'Search Flare' }).waitFor();
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    const audit = async (name) => {
      await page.evaluate(async () => {
        const finite = document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
        await Promise.all(finite.map((animation) => animation.finished.catch(() => {})));
      });
      const result = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      audits.push({
        name,
        violations: result.violations,
        incomplete: result.incomplete.map((x) => x.id),
      });
    };
    await audit('empty');
    assert.equal(await page.locator('html').getAttribute('data-glass'), 'on');
    const rail = await page.locator('.search-bar').boundingBox();
    await page.mouse.move(0, 0);
    await page.mouse.move(rail.x + 80, rail.y + rail.height / 2, { steps: 5 });
    await page.waitForFunction(
      () =>
        Number(getComputedStyle(document.querySelector('.glass-sheen')).opacity) === 1 &&
        document.querySelector('.glass-sheen').style.transform !== '',
    );
    const firstHighlight = await page
      .locator('.glass-sheen')
      .evaluate((node) => node.style.transform);
    await page.mouse.move(rail.x + rail.width - 80, rail.y + rail.height / 2, { steps: 5 });
    await page.waitForFunction(
      (previous) => document.querySelector('.glass-sheen').style.transform !== previous,
      firstHighlight,
    );
    await page.screenshot({ path: path.join(directory, '00-glass-reflection.png') });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: path.join(directory, '01-empty-dark.png') });
    if (process.env.FLARE_PUBLIC_SHOTS) {
      await fs.mkdir(path.resolve('docs/images'), { recursive: true });
      await page.locator('.launcher').screenshot({
        path: path.resolve('docs/images/launcher-dark.png'),
        animations: 'disabled',
      });
    }
    await page.getByRole('combobox', { name: 'Search Flare' }).fill('Notepad');
    await page.getByRole('option').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(directory, '02-search.png') });
    const titles = await page.locator('.result-title').allTextContents();
    assert.ok(
      titles.some((x) => /notepad/i.test(x)),
      'Actual Start Menu app result',
    );
    await audit('search-dark');
    const selection = await page.locator('.result.is-selected').boundingBox();
    const textColors = await page.locator('.result.is-selected').evaluate((node) =>
      ['.result-title', '.result-detail', '.result-kind'].map((selector) => ({
        selector,
        color: getComputedStyle(node.querySelector(selector))
          .color.match(/[\d.]+/g)
          .slice(0, 3)
          .map(Number),
      })),
    );
    const pixels = await require('sharp')(
      await page.screenshot({ omitBackground: true, scale: 'css' }),
    )
      .flatten({ background: '#fff' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const backgrounds = [
      [selection.x + 4, selection.y + 9],
      [selection.x + selection.width - 4, selection.y + 9],
      [selection.x + 4, selection.y + selection.height - 9],
      [selection.x + selection.width - 4, selection.y + selection.height - 9],
    ].map(([x, y]) => {
      const offset = (Math.round(y) * pixels.info.width + Math.round(x)) * 3;
      return [...pixels.data.subarray(offset, offset + 3)];
    });
    const luminance = (rgb) => {
      const linear = rgb.map((value) => {
        const s = value / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    };
    const contrast = textColors.map(({ selector, color }) => ({
      selector,
      minimumRatio: Math.min(
        ...backgrounds.map(
          (background) =>
            (Math.max(luminance(color), luminance(background)) + 0.05) /
            (Math.min(luminance(color), luminance(background)) + 0.05),
        ),
      ),
    }));
    await fs.writeFile(
      path.join(directory, 'glass-contrast.json'),
      JSON.stringify({ backgrounds, contrast }, null, 2),
    );
    assert.ok(
      contrast.every((value) => value.minimumRatio >= 4.5),
      JSON.stringify(contrast),
    );
    await page.getByRole('combobox', { name: 'Search Flare' }).fill('');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'light theme' }).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.getByRole('switch', { name: 'Liquid glass' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.glass === 'off');
    assert.equal(
      await page.evaluate(async () => (await window.flare.call('snapshot')).settings.glass),
      false,
    );
    await audit('settings-solid');
    await page.screenshot({ path: path.join(directory, '03-settings-solid.png') });
    await page.getByRole('switch', { name: 'Liquid glass' }).click();
    await page.waitForFunction(() => document.documentElement.dataset.glass === 'on');
    await page.locator('.settings-panel').evaluate((node) => {
      node.scrollTop = 0;
    });
    await audit('settings-light');
    await page.screenshot({ path: path.join(directory, '03-settings-light.png') });
    const headingGeometry = await page
      .getByRole('heading', { name: 'Settings', exact: true })
      .boundingBox();
    assert.ok(
      headingGeometry.y > 80 && headingGeometry.x > 0,
      'Settings heading is visible after glass interaction',
    );
    if (process.env.FLARE_PUBLIC_SHOTS)
      await page.locator('.launcher').screenshot({
        path: path.resolve('docs/images/settings-light.png'),
        animations: 'disabled',
      });
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('button', { name: 'File tools', exact: true }).click();
    await page.getByText('Images to PDF', { exact: true }).click();
    await page.screenshot({ path: path.join(directory, '04-tools-light.png') });
    await audit('tools-light');
    const files = path.join(directory, 'selected'),
      output = path.join(directory, 'outputs');
    await fs.mkdir(files);
    await fs.mkdir(output);
    const source = path.join(files, 'studio-sample.png');
    await require('sharp')({
      create: { width: 640, height: 400, channels: 3, background: '#89dcf3' },
    })
      .png()
      .toFile(source);
    const picker = (paths) =>
      instance.evaluate(({ dialog }, filePaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths });
      }, paths);
    await picker([source]);
    await page.getByRole('button', { name: 'Choose images', exact: true }).click();
    await picker([output]);
    await page.locator('.folder-choice').click();
    await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Include studio-sample.png' }).waitFor();
    await audit('conversion-plan');
    await page.screenshot({ path: path.join(directory, '05-plan.png') });
    await page.getByRole('button', { name: 'Confirm & run' }).click();
    await page.locator('.history-panel').waitFor({ timeout: 30000 });
    const operations = await page.evaluate(() => window.flare.call('history'));
    assert.equal(operations[0].status, 'done');
    const generated = operations[0].items[0].to;
    assert.equal(
      (await require('pdf-lib').PDFDocument.load(await fs.readFile(generated))).getPageCount(),
      1,
    );
    await audit('history');
    await page.screenshot({ path: path.join(directory, '06-history.png') });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await page.waitForFunction(
      async () => (await window.flare.call('history'))[0].status === 'undone',
    );
    await assert.rejects(fs.access(generated));
    await fs.access(source);
    await page.getByRole('button', { name: 'Close history' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Search locations/ }).click();
    await picker([files]);
    await page.getByRole('button', { name: 'Add folder' }).click();
    await page.waitForFunction(
      async () => (await window.flare.call('snapshot')).index.state === 'ready',
      { timeout: 30000 },
    );
    // The fixture is deliberately under Files/private, so indexing must not expose it by default.
    assert.equal(
      (await page.evaluate(() => window.flare.call('search', { query: 'studio-sample' }))).length,
      0,
    );
    await page.evaluate(() => window.flare.call('settings', { exclusions: ['node_modules'] }));
    await page.waitForFunction(
      async () => (await window.flare.call('snapshot')).index.state === 'ready',
      { timeout: 30000 },
    );
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('combobox', { name: 'Search Flare' }).fill('studio-sample');
    await page.getByRole('button', { name: 'Preview studio-sample.png' }).click();
    await page.locator('.file-preview').waitFor();
    await page.getByRole('button', { name: 'File details' }).click();
    await audit('image-preview');
    await page.screenshot({ path: path.join(directory, '07-preview.png') });
    await page.getByTitle('Close preview', { exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Intelligence/ }).click();
    await audit('ai-settings');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await instance.evaluate(({ session }) => {
      session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
    });
    await page.getByRole('button', { name: 'Voice command', exact: true }).click();
    await page.locator('.voice-visual[data-state="error"]').waitFor({ timeout: 30000 });
    await audit('voice-permission-denied');
    await page.screenshot({ path: path.join(directory, '09-voice-denied.png') });
    assert.equal(
      await page
        .locator('.voice-core')
        .evaluate((node) => getComputedStyle(node, '::before').animationName),
      'none',
    );
    await page.getByRole('button', { name: 'Cancel voice' }).click();
    await page.getByRole('combobox', { name: 'Search Flare' }).fill('');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(
      await page
        .locator('.launcher')
        .evaluate((node) => parseFloat(getComputedStyle(node).animationDuration) < 0.001),
    );
    const resized = await instance.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setResizable(true);
      window.setSize(380, 720);
      window.setResizable(false);
      return window.getBounds();
    });
    console.log('Narrow window bounds', resized);
    await page.waitForFunction(() => innerWidth === 380);
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await audit('settings-narrow');
    await page.screenshot({ path: path.join(directory, '08-narrow.png') });
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      scrollX,
      heading: document.querySelector('h2').getBoundingClientRect().toJSON(),
      panel: document.querySelector('.launcher').getBoundingClientRect().toJSON(),
    }));
    await fs.writeFile(path.join(directory, 'geometry.json'), JSON.stringify(geometry, null, 2));
    assert.equal(geometry.width, 380, 'Native window stayed narrow');
    assert.ok(geometry.heading.x >= 0 && geometry.heading.right <= geometry.width);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await fs.writeFile(path.join(directory, 'accessibility.json'), JSON.stringify(audits, null, 2));
    assert.equal(
      audits.reduce((sum, x) => sum + x.violations.length, 0),
      0,
      JSON.stringify(
        audits.map((x) => ({
          name: x.name,
          violations: x.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({ target: n.target, reason: n.failureSummary })),
          })),
        })),
        null,
        2,
      ),
    );
    assert.equal(errors.length, 0, errors.join('\n'));
    const snapshot = await page.evaluate(() => window.flare.call('snapshot'));
    assert.equal(snapshot.settings.theme, 'light');
    assert.ok(snapshot.count > 0);
    console.log(
      JSON.stringify({
        ok: true,
        appResults: titles,
        indexedEntries: snapshot.count,
        screenshots: directory,
        shortcutError: snapshot.shortcutError,
      }),
    );
  } catch (error) {
    const page = await instance.firstWindow();
    await page.screenshot({ path: path.join(directory, 'failure.png') });
    console.log(await page.locator('body').innerText());
    console.log(
      await page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollX,
        scrollY,
        sheen: document.querySelector('.glass-sheen')?.getAttribute('style'),
        search: document.querySelector('.search-bar')?.getBoundingClientRect().toJSON(),
        heading: document.querySelector('h2')?.getBoundingClientRect().toJSON(),
      })),
    );
    console.log(await page.evaluate(() => window.flare.call('snapshot')));
    console.log(await page.evaluate(() => window.flare.call('search', { query: 'studio-sample' })));
    throw error;
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
