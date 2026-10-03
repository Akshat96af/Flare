const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const AxeBuilder = require('@axe-core/playwright').default;
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
    await page.waitForFunction(async () => (await window.flare.call('snapshot')).ready, {
      timeout: 60000,
    });
    const audit = async (name) => {
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
    await page.screenshot({ path: path.join(directory, '01-empty-dark.png') });
    if (process.env.FLARE_PUBLIC_SHOTS) {
      await fs.mkdir(path.resolve('docs/images'), { recursive: true });
      await page
        .locator('.launcher')
        .screenshot({
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
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'light theme' }).click();
    await page.screenshot({ path: path.join(directory, '03-settings-light.png') });
    await audit('settings-light');
    if (process.env.FLARE_PUBLIC_SHOTS)
      await page
        .locator('.launcher')
        .screenshot({
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
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Intelligence/ }).click();
    await audit('ai-settings');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await page.getByRole('combobox', { name: 'Search Flare' }).fill('');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.ok(
      await page
        .locator('.launcher')
        .evaluate((node) => parseFloat(getComputedStyle(node).animationDuration) < 0.001),
    );
    await instance.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(380, 720),
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await audit('settings-narrow');
    await page.screenshot({ path: path.join(directory, '08-narrow.png') });
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
    console.log(await page.evaluate(() => window.flare.call('snapshot')));
    throw error;
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
