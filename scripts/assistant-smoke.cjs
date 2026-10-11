const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const AxeBuilder = require('@axe-core/playwright').default;

(async () => {
  const directory = path.resolve('Files/private/verification/assistant-' + Date.now());
  const folder = path.join(directory, 'documents');
  await fs.mkdir(folder, { recursive: true });
  const file = path.join(folder, 'budget.md');
  await fs.writeFile(
    file,
    'Orchid renovation budget. Decision: keep costs below 500. Action: request quotes.',
  );
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
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await instance.evaluate(({ dialog, shell }, folder) => {
      global.assistantFixture = { decision: 1, consent: 0, posts: 0, opened: [] };
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      dialog.showMessageBox = async () => {
        global.assistantFixture.consent++;
        return { response: global.assistantFixture.decision };
      };
      shell.openExternal = async (url) => {
        global.assistantFixture.opened.push(url);
      };
      global.fetch = async (_url, options) => {
        if (options.method === 'GET')
          return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-20b' }] }));
        global.assistantFixture.posts++;
        const body = JSON.parse(options.body);
        if (!body.messages[1].content.includes('Orchid renovation budget'))
          throw new Error('Missing document context');
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    kind: 'answer',
                    text: 'Budget below 500. Request renovation quotes.',
                  }),
                },
              },
            ],
          }),
        );
      };
    }, folder);
    await page.evaluate(async () => {
      const [folder] = await window.flare.call('pick', { kind: 'folder' });
      await window.flare.call('settings', {
        roots: [folder],
        allDrives: false,
        exclusions: [],
        setup: true,
      });
      await window.flare.call('ai-save', {
        provider: 'groq',
        key: 'fixture-key',
        model: 'openai/gpt-oss-20b',
      });
    });
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).index.state), {
        timeout: 30000,
      })
      .toBe('ready');
    const id = 'file:' + file;
    const initial = await page.evaluate((id) => window.flare.call('preview', { id }), id);
    assert.equal(initial.contentAllowed, false);
    assert.equal(initial.text, undefined);
    assert.equal(
      (await page.evaluate(() => window.flare.call('search', { query: 'orchid', kind: 'file' })))
        .length,
      0,
    );
    const input = page.getByRole('combobox', { name: 'Search Flare' });
    await input.fill('budget.md');
    await page.getByRole('button', { name: 'Preview budget.md' }).click();
    await expect(page.getByText('Contents are private', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Allow this file', exact: true }).click();
    await expect(page.locator('.preview-panel pre')).toContainText('Orchid renovation budget');
    await instance.evaluate(() => {
      global.assistantFixture.decision = 0;
    });
    await page.getByRole('button', { name: 'Summarize document', exact: true }).click();
    await expect(page.getByText(/File access cancelled/)).toBeVisible();
    assert.equal(await instance.evaluate(() => global.assistantFixture.posts), 0);
    await instance.evaluate(() => {
      global.assistantFixture.decision = 1;
    });
    await page.getByRole('button', { name: 'Summarize document', exact: true }).click();
    await expect(page.locator('.typed-answer')).toHaveText(
      'Budget below 500. Request renovation quotes.',
    );
    assert.equal(await instance.evaluate(() => global.assistantFixture.posts), 1);
    checks.push(
      'Names-only preview, explicit local permission, cancelled cloud request sends nothing, accepted summary has actual document text',
    );
    await page.evaluate(
      (folder) => window.flare.call('folder-permission', { folder, level: 'content' }),
      folder,
    );
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).index.state), {
        timeout: 30000,
      })
      .toBe('ready');
    assert.equal(
      (await page.evaluate(() => window.flare.call('search', { query: 'orchid', kind: 'file' })))[0]
        .title,
      'budget.md',
    );
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: /^Search locations/ }).click();
    await expect(page.getByLabel('Access for ' + folder)).toHaveValue('content');
    await page.screenshot({ path: path.join(directory, 'folder-permissions.png') });
    const audit = await new AxeBuilder({ page })
      .setLegacyMode(true)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    assert.equal(
      audit.violations.length,
      0,
      JSON.stringify(audit.violations.map((item) => item.id)),
    );
    await page.getByLabel('Access for ' + folder).selectOption('names');
    await expect(page.getByLabel('Access for ' + folder)).toHaveCount(0);
    assert.equal(
      (await page.evaluate(() => window.flare.call('search', { query: 'orchid', kind: 'file' })))
        .length,
      0,
    );
    checks.push(
      'Local content indexing is explicit, settings show grants, revocation immediately removes cached content results',
    );
    await page.evaluate(
      (folder) => window.flare.call('folder-permission', { folder, level: 'assistant' }),
      folder,
    );
    const before = await instance.evaluate(() => global.assistantFixture.consent);
    const summary = await page.evaluate((id) => window.flare.call('document-summary', { id }), id);
    assert.equal(summary.kind, 'answer');
    assert.equal(await instance.evaluate(() => global.assistantFixture.consent), before);
    await assert.rejects(
      page.evaluate(
        (folder) => window.flare.call('settings', { trustedRoots: [folder + '-other'] }),
        folder,
      ),
      /permission dialog/,
    );
    checks.push('Assistant folder grant removes repetitive prompts without allowing forged grants');
    await page.getByTitle('Close settings', { exact: true }).click();
    await input.fill('open browser');
    await page.getByRole('option').first().click();
    await expect.poll(() => instance.evaluate(() => global.assistantFixture.opened.length)).toBe(1);
    assert.equal(
      await instance.evaluate(() => global.assistantFixture.opened[0]),
      'https://www.google.com/',
    );
    checks.push('Browser command opens the default browser without an AI request');
    assert.deepEqual(errors, []);
    const report = { checks, errors, violations: audit.violations, paidRequests: 0 };
    await fs.writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ directory, ...report }, null, 2));
  } finally {
    await instance.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
