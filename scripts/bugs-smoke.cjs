const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
const AxeBuilder = require('@axe-core/playwright').default;
const { expect } = require('@playwright/test');

(async () => {
  const directory = path.resolve('Files/private/verification/bugs-' + Date.now());
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
    audits = [],
    checks = [];
  try {
    const page = await instance.firstWindow();
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    const input = page.getByRole('combobox', { name: 'Search Flare' });
    await input.waitFor();
    // Settle the initial native activation before entering a search.
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter((x) => x.effect?.getComputedTiming().iterations !== Infinity)
          .map((x) => x.finished.catch(() => {})),
      );
    });
    const visible = () =>
      instance.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible());
    const reopen = () =>
      instance.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.show();
        win.focus();
      });
    const escape = async (label) => {
      await page.keyboard.press('Escape');
      assert.equal(await visible(), false, 'One Escape hides ' + label);
      checks.push('Escape: ' + label);
      await reopen();
    };
    const audit = async (name) => {
      await page.evaluate(async () => {
        await Promise.all(
          document
            .getAnimations()
            .filter((x) => x.effect?.getComputedTiming().iterations !== Infinity)
            .map((x) => x.finished.catch(() => {})),
        );
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
      assert.equal(result.violations.length, 0, name + ' accessibility');
    };
    await input.fill('Notepad');
    try {
      await page
        .getByRole('option')
        .filter({ hasText: /Notepad/i })
        .first()
        .waitFor({ timeout: 30000 });
    } catch (error) {
      console.log(
        'Search diagnostic',
        await page.evaluate(async () => ({
          input: document.querySelector('input').value,
          alerts: [...document.querySelectorAll('[role="alert"]')].map((x) => x.textContent),
          results: (await window.flare.call('search', { query: 'Notepad', kind: 'app' })).map(
            (x) => ({ title: x.title, hasIcon: !!x.icon }),
          ),
        })),
        errors,
      );
      await page.screenshot({ path: path.join(directory, 'failure.png') });
      throw error;
    }
    const icon = page
      .getByRole('option')
      .filter({ hasText: /Notepad/i })
      .first()
      .locator('.result-icon img');
    await icon.waitFor();
    await icon.evaluate(async (image) => {
      await image.decode();
    });
    const imageData = await icon.getAttribute('src');
    const pixels = await require('sharp')(Buffer.from(imageData.split(',')[1], 'base64'))
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(
      pixels.info.width >= 24 && new Set(pixels.data).size > 30,
      'Real nonblank Windows app icon',
    );
    assert.equal(pixels.info.channels, 4, 'Shell icon retains its alpha channel');
    assert.ok(
      pixels.data.some((value, index) => index % 4 === 3 && value < 255),
      'Notepad icon retains transparent edges',
    );
    await page.screenshot({ path: path.join(directory, '01-app-icons.png') });
    checks.push('Native Store application icon decodes and has nonblank pixels');
    await escape('populated search');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('textbox', { name: 'Global shortcut' }).focus();
    await escape('focused settings field');
    await page.getByTitle('Close settings', { exact: true }).click();
    await instance.evaluate(({ session }) => {
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
    });
    await page.getByRole('button', { name: 'Voice command', exact: true }).click();
    await page.getByRole('region', { name: 'Voice command', exact: true }).waitFor();
    await escape('voice preparation');
    await page.locator('.voice-panel').waitFor({ state: 'detached' });
    assert.equal(
      await page.locator('.voice-panel').count(),
      0,
      'Voice unmounts on native dismissal',
    );
    await input.fill('no-such-file-flare-fixture-2026');
    await page.getByText('No results', { exact: true }).waitFor({ timeout: 30000 });
    assert.equal(
      await page.locator('.ask-ai').count(),
      0,
      'No AI invitation when Intelligence is off',
    );
    await instance.evaluate(() => {
      global.flareTest = {
        requests: [],
        status: 200,
        delay: 0,
        answer: 'A concise fixture answer.',
      };
      // All AI traffic in this test is replaced in the native process, never sent online.
      global.fetch = async (url, options = {}) => {
        const state = global.flareTest;
        state.requests.push({ method: options.method, route: new URL(url).pathname });
        if (options.method === 'GET')
          return new Response(
            JSON.stringify({
              models: [
                {
                  name: 'models/gemini-3.6-flash',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-3.7-flash',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-3.8-flash',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/gemini-fixture-flash-image',
                  supportedGenerationMethods: ['generateContent'],
                },
              ],
            }),
          );
        if (state.delay)
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, state.delay);
            options.signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true },
            );
          });
        return new Response(
          JSON.stringify(
            state.status === 200
              ? {
                  candidates: [
                    {
                      content: {
                        parts: [
                          { thought: true, text: 'Do not display this.' },
                          { text: JSON.stringify({ kind: 'answer', text: state.answer }) },
                        ],
                      },
                    },
                  ],
                }
              : { error: { message: 'Do not display provider secrets or request content.' } },
          ),
          { status: state.status },
        );
      };
    });
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /^Intelligence/ }).click();
    await page.getByLabel('Use a model', { exact: true }).selectOption('gemini');
    const modelSelect = page.getByRole('combobox', { name: 'Model', exact: true });
    assert.equal(
      await modelSelect.inputValue(),
      '',
      'New connections do not invent model availability',
    );
    assert.deepEqual(
      await modelSelect.locator('option').evaluateAll((options) => options.map((x) => x.value)),
      [''],
    );
    const connectionBounds = await page
      .getByRole('button', { name: 'Check connection', exact: true })
      .boundingBox();
    const modelBounds = await modelSelect.boundingBox();
    assert.ok(
      modelBounds.y >= connectionBounds.y + connectionBounds.height,
      'Model selection sits below Check connection',
    );
    assert.equal(
      await page.getByRole('textbox', { name: 'Custom model ID', exact: true }).count(),
      0,
      'Minimal settings use a selector, not a technical text field',
    );
    await page.getByLabel('API key', { exact: true }).fill('fixture-key');
    await audit('model selection before connection');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('3 models available', { exact: true }).waitFor();
    assert.deepEqual(
      await page.getByLabel('Model', { exact: true }).locator('option').allTextContents(),
      ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash'],
    );
    assert.equal(
      await modelSelect.inputValue(),
      'gemini-3.6-flash',
      'Checking connection does not override a supported selection',
    );
    await modelSelect.selectOption('gemini-3.7-flash');
    await page.getByRole('button', { name: 'Save connection', exact: true }).click();
    await page.getByText('Saved', { exact: true }).waitFor();
    await page.getByTitle('Close settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /^Intelligence/ }).click();
    assert.equal(
      await modelSelect.inputValue(),
      'gemini-3.7-flash',
      'Selected model persists when settings reopen',
    );
    assert.equal(
      await modelSelect.locator('option').count(),
      1,
      'Saved model remains selected without claiming an undiscovered catalogue',
    );
    await page.screenshot({ path: path.join(directory, '02-model-selection.png') });
    checks.push(
      'Persistent model selector below Check connection, Gemini 3.6+ choices and preserved selection',
    );
    await page.getByTitle('Close settings', { exact: true }).click();
    await page.locator('.ask-ai').click();
    await page.getByRole('region', { name: 'AI answer' }).waitFor();
    assert.equal(await page.locator('.ai-answer p').textContent(), 'A concise fixture answer.');
    await audit('AI answer dark');
    await page.screenshot({ path: path.join(directory, '02-ai-answer.png') });
    checks.push('Empty local search -> explicit Ask AI -> safe plain-text answer');
    assert.equal(
      await instance.evaluate(
        () => global.flareTest.requests.filter((x) => x.method === 'POST').length,
      ),
      1,
    );
    await input.fill('another-unmatched-fixture');
    await page.locator('.ask-ai').waitFor();
    await instance.evaluate(() => {
      global.flareTest.status = 405;
    });
    await page.locator('.ask-ai').click();
    await page
      .getByRole('alert')
      .filter({ hasText: /405 \(POST\)/ })
      .waitFor();
    await audit('AI error dark');
    await page.getByRole('button', { name: 'Intelligence settings', exact: true }).click();
    await page.getByRole('heading', { name: 'Intelligence', exact: true }).waitFor();
    assert.equal(
      await instance.evaluate(
        () => global.flareTest.requests.filter((x) => x.method === 'POST').length,
      ),
      2,
      'Failed generation is not retried',
    );
    await page.getByLabel('API key', { exact: true }).fill('fixture-key');
    await page.getByLabel('Use a model', { exact: true }).selectOption('openai');
    assert.equal(
      await page.getByLabel('API key', { exact: true }).inputValue(),
      '',
      'Provider switch clears unsaved key',
    );
    await page.getByTitle('Close settings', { exact: true }).click();
    checks.push('405 method-aware recovery, no automatic retries, provider-key isolation');
    await instance.evaluate(() => {
      global.flareTest.status = 200;
      global.flareTest.delay = 1500;
    });
    await input.fill('cancelled-ai-fixture');
    await page.locator('.ask-ai').click();
    await page.getByRole('button', { name: 'Asking AI...', exact: true }).waitFor();
    await escape('pending AI request');
    await page.waitForTimeout(1600);
    assert.equal(
      await page.locator('.ai-answer').count(),
      0,
      'Dismissed AI cannot update launcher',
    );
    assert.equal(
      await page.getByRole('alert').count(),
      0,
      'Cancellation does not show a stale error',
    );
    await instance.evaluate(() => {
      global.flareTest.delay = 0;
    });
    await input.fill('keyboard-ai-fixture');
    await page.locator('.ask-ai').waitFor();
    await input.press('Enter');
    await page.getByRole('region', { name: 'AI answer' }).waitFor();
    checks.push('AI cancellation and Enter on an unmatched query');
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'light theme', exact: true }).click();
    await page.getByTitle('Close settings', { exact: true }).click();
    await audit('AI answer light');
    await instance.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setResizable(true);
      win.setSize(380, 700);
      win.setResizable(false);
    });
    await audit('AI answer narrow');
    const geometry = await page
      .locator('.launcher')
      .evaluate((node) => ({ width: node.clientWidth, scroll: node.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.width + 1, 'No horizontal overflow at 380px');
    await page.screenshot({ path: path.join(directory, '03-ai-narrow-light.png') });
    await escape('narrow launcher');
    assert.deepEqual(errors, []);
    await fs.writeFile(
      path.join(directory, 'report.json'),
      JSON.stringify({ checks, audits, errors, paidRequests: 0 }, null, 2),
    );
    console.log(
      JSON.stringify(
        { directory, checks, audits: audits.length, paidRequests: 0, errors },
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
