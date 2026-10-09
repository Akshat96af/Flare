const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;

(async () => {
  const directory = path.resolve('Files/private/verification/features-' + Date.now());
  await fs.mkdir(directory, { recursive: true });
  const fixture = path.join(directory, 'Flare test document.txt');
  await fs.writeFile(fixture, 'Generated Quick Share fixture. No personal information.');
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
    audits = [],
    errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await app.evaluate(({ dialog }, fixture) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixture] });
    }, fixture);
    const audit = async (name) => {
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => {})),
        );
      });
      const report = await new AxeBuilder({ page })
        .setLegacyMode(true)
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
        .analyze();
      audits.push({ name, violations: report.violations });
      await page.screenshot({ path: path.join(directory, name + '.png') });
      assert.equal(report.violations.length, 0, name + ' accessibility');
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        name + ' horizontal overflow',
      );
    };
    await page.getByRole('button', { name: 'Quick Share', exact: true }).click();
    await page.getByRole('button', { name: /Choose a file/ }).click();
    await expect(page.getByRole('button', { name: 'Start sharing' })).toBeDisabled();
    await audit('share-review-dark');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Start sharing' }).click();
    await page.getByLabel('Download link', { exact: true }).waitFor();
    const url = await page.getByLabel('Download link', { exact: true }).inputValue();
    assert.equal(
      await (await fetch(url)).text(),
      'Generated Quick Share fixture. No personal information.',
    );
    await expect(page.getByText('1 completed downloads')).toBeVisible();
    await page.getByRole('button', { name: 'Copy link', exact: true }).click();
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), url);
    const qr = page.locator('.share-qr');
    await qr.evaluate((image) => image.decode());
    const pixels = await require('sharp')(
      Buffer.from((await qr.getAttribute('src')).split(',')[1], 'base64'),
    )
      .raw()
      .toBuffer();
    assert.ok(pixels.includes(0) && pixels.includes(255));
    await audit('share-active-dark');
    await page.getByTitle('Close Quick Share').click();
    await expect(page.getByTitle('Quick Share active')).toBeVisible();
    await page.getByTitle('Quick Share active').click();
    await expect(page.getByLabel('Download link', { exact: true })).toHaveValue(url);
    await page.getByRole('button', { name: 'Stop sharing', exact: true }).click();
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('share-status')).active))
      .toBe(false);
    await assert.rejects(fetch(url));
    checks.push(
      'Native picker, consent, scoped HTTP download, QR pixels, clipboard, reopen, and stop',
    );
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setResizable(true);
      win.setSize(380, 730);
      win.setResizable(false);
    });
    await audit('share-review-narrow');
    await page.getByTitle('Close Quick Share').click();
    await app.evaluate(() => {
      global.aiFixture = { gets: 0, posts: 0 };
      global.fetch = async (_url, options) => {
        if (options.method === 'GET') {
          global.aiFixture.gets++;
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: 'models/gemini-3.6-flash',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-3.5-transcribe',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
          );
        }
        global.aiFixture.posts++;
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"kind":"answer","text":"Ready"}' }] } }],
          }),
        );
      };
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'light theme', exact: true }).click();
    await page.getByRole('button', { name: /^Intelligence/ }).click();
    await page.getByLabel('Use a model', { exact: true }).selectOption('gemini');
    await page.getByLabel('API key', { exact: true }).fill('fixture-key');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('1 models available', { exact: true }).waitFor();
    assert.equal(await app.evaluate(() => global.aiFixture.posts), 0);
    await page.getByRole('button', { name: 'Test response', exact: true }).click();
    assert.equal(await app.evaluate(() => global.aiFixture.posts), 0);
    await page.getByRole('button', { name: 'Run test', exact: true }).click();
    await page.getByText(/Response verified/).waitFor();
    assert.equal(await app.evaluate(() => global.aiFixture.posts), 1);
    await page.getByLabel('Voice recognition', { exact: true }).selectOption('online');
    await expect(page.getByLabel('Speech model', { exact: true })).toHaveValue('');
    await page.getByLabel('Speech model', { exact: true }).selectOption('gemini-3.5-transcribe');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    assert.equal(
      (await page.evaluate(async () => (await window.flare.call('snapshot')).settings.ai))
        .speechCloud,
      true,
    );
    await audit('intelligence-light-narrow');
    checks.push(
      'Model discovery sends no generation; separate consented response test sends exactly one; discovered speech model persists',
    );
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ checks, audits, errors, paidRequests: 0, realMicrophoneAccess: 0 }, null, 2),
    );
    console.log(
      JSON.stringify(
        {
          directory,
          checks,
          audits: audits.map((a) => ({ name: a.name, violations: a.violations.length })),
          errors,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
