const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument } = require('pdf-lib');
const AxeBuilder = require('@axe-core/playwright').default;
(async () => {
  const directory = path.resolve('Files/private/verification/local-ui-' + Date.now());
  const folder = path.join(directory, 'documents'),
    output = path.join(directory, 'output');
  await fs.mkdir(folder, { recursive: true });
  await fs.mkdir(output);
  const canvas = createCanvas(1000, 220),
    context = canvas.getContext('2d');
  context.fillStyle = '#fff';
  context.fillRect(0, 0, 1000, 220);
  context.fillStyle = '#000';
  context.font = '40px Arial';
  context.fillText('FLARE INVOICE 82741', 45, 110);
  const image = path.join(folder, 'receipt.png');
  await fs.writeFile(image, canvas.toBuffer('image/png'));
  const pdf = await PDFDocument.create(),
    bitmap = await pdf.embedPng(await fs.readFile(image));
  pdf.addPage([1000, 220]).drawImage(bitmap, { width: 1000, height: 220 });
  await fs.writeFile(path.join(folder, 'scan.pdf'), await pdf.save());
  const env = { ...process.env, FLARE_DATA_DIR: path.join(directory, 'data') };
  delete env.ELECTRON_RUN_AS_NODE;
  const instance = await electron.launch({
    executablePath: process.env.FLARE_SMOKE_EXE || require('electron'),
    args: process.env.FLARE_SMOKE_EXE ? ['--portable'] : ['.'],
    env,
    cwd: path.resolve('.'),
    timeout: 60000,
  });
  const checks = [],
    errors = [];
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', (e) => errors.push(e.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await instance.evaluate(({ dialog }, locations) => {
      global.localFeatures = { consent: 0, decision: 0, picks: [locations.folder, locations.output] };
      dialog.showMessageBox = async () => {
        global.localFeatures.consent++;
        return { response: global.localFeatures.decision };
      };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [global.localFeatures.picks.shift() || locations.output] });
      global.fetch = async () => {
        throw new Error('Local features must not use the network');
      };
    }, { folder, output });
    await page.evaluate(() => window.flare.call('pick', { kind: 'folder' }));
    await page.evaluate(
      (folder) =>
        window.flare.call('settings', {
          roots: [folder],
          allDrives: false,
          setup: true,
          exclusions: [],
          theme: 'dark',
        }),
      folder,
    );
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).index.state), {
        timeout: 60000,
      })
      .toBe('ready');
    await page.reload();
    await instance.evaluate(({ app }) => app.emit('second-instance'));
    const input = page.getByRole('combobox', { name: 'Search Flare' });
    await input.fill('receipt');
    await page.getByRole('button', { name: 'File actions for receipt.png', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resize image', exact: true })).toBeVisible();
    assert.equal(
      await instance.evaluate(() => global.localFeatures.consent),
      0,
      'Listing actions does not read file contents',
    );
    await page.screenshot({ path: path.join(directory, 'image-actions-dark.png') });
    await page.getByRole('button', { name: 'Read text', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('access cancelled');
    await page.getByRole('button', { name: 'Close text recognition' }).click();
    await instance.evaluate(() => {
      global.localFeatures.decision = 1;
    });
    await page.getByRole('button', { name: 'File actions for receipt.png', exact: true }).click();
    await page.getByRole('button', { name: 'Read text', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Recognized text' })).toHaveValue(
      /FLARE INVOICE 82741/,
      { timeout: 60000 },
    );
    await page.screenshot({ path: path.join(directory, 'local-ocr-dark.png') });
    assert.equal(
      await page.evaluate(
        async () => (await window.flare.call('search', { query: '82741', kind: 'file' })).length,
      ),
      0,
      'One-file consent does not silently index contents',
    );
    await page.getByRole('button', { name: 'Close text recognition' }).click();
    await page.getByRole('button', { name: 'File actions for receipt.png', exact: true }).click();
    await page.getByRole('button', { name: 'Resize image', exact: true }).click();
    await expect(page.getByText('receipt.png', { exact: true })).toBeVisible();
    await page.getByRole('spinbutton', { name: 'Image width' }).fill('500');
    await page.getByRole('button', { name: 'Choose an output folder', exact: true }).click();
    await page.getByRole('button', { name: 'Preview changes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm & run' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm & run' }).click();
    await expect
      .poll(async () => (await fs.readdir(output)).some((name) => name.endsWith('.webp')))
      .toBe(true);
    const produced = (await fs.readdir(output)).find((name) => name.endsWith('.webp'));
    assert.equal((await require('sharp')(path.join(output, produced)).metadata()).width, 500);
    await page.evaluate(() => window.flare.call('undo'));
    assert.equal((await fs.readdir(output)).length, 0);
    checks.push(
      'Format-aware file actions, permission-denied OCR, real pixel recognition, prefilled resize, reviewed conversion and undo',
    );
    await page.getByRole('button', { name: 'Close preview' }).click();
    await input.fill('scan');
    await page.getByRole('button', { name: 'File actions for scan.pdf', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Extract pages', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Read scanned text', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Recognized text' })).toHaveValue(/82741/, {
      timeout: 60000,
    });
    await page.getByRole('button', { name: 'Close text recognition' }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /Intelligence/ }).click();
    const engine = page.getByLabel('Local recognition', { exact: true });
    await expect(engine.getByRole('option', { name: 'Offline Whisper', exact: true })).toBeEnabled({
      timeout: 60000,
    });
    await engine.selectOption('whisper');
    await page.getByLabel('Offline voice model', { exact: true }).selectOption('tiny.en');
    await expect(page.getByText('Ready offline', { exact: true })).toBeVisible();
    await assert.rejects(
      page.evaluate(() =>
        window.flare.call('voice-transcribe', { bytes: [1], mime: 'audio/webm' }),
      ),
      /never uploads/,
    );
    await page.screenshot({ path: path.join(directory, 'offline-voice-settings.png') });
    const audit = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.deepEqual(
      audit.violations.map((v) => v.id),
      [],
    );
    await page.getByTitle('Close settings', { exact: true }).click();
    await instance.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setResizable(true);
      win.setSize(380, 500);
      win.setResizable(false);
    });
    await input.fill('receipt');
    await page.getByRole('button', { name: 'File actions for receipt.png', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Resize image', exact: true })).toBeVisible();
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
    });
    assert.equal(
      await page
        .locator('.file-action-tray')
        .evaluate((node) => node.scrollWidth > node.clientWidth),
      false,
    );
    await page.screenshot({ path: path.join(directory, 'image-actions-compact-light.png') });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(
      await page
        .locator('.file-action-tray')
        .evaluate((node) => getComputedStyle(node).animationName),
      'none',
    );
    checks.push(
      'Scanned-PDF OCR, offline model selection with AI off, blocked online uploads, accessibility, 380px layout and reduced motion',
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ checks, errors }, null, 2),
    );
    console.log(JSON.stringify({ directory, checks, errors }, null, 2));
  } catch (error) {
    await (await instance.firstWindow()).screenshot({ path: path.join(directory, 'failure.png') });
    throw error;
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
