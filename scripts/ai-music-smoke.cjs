const { _electron: electron } = require('playwright');
const { expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  const directory = path.resolve('Files/private/verification/ai-music-' + Date.now());
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
    page.on('pageerror', (error) => errors.push(error.message));
    await expect
      .poll(() => page.evaluate(async () => (await window.flare.call('snapshot')).ready), {
        timeout: 60000,
      })
      .toBe(true);
    await app.evaluate(({ shell, app, ipcMain }) => {
      global.musicFixture = {
        opened: [],
        requests: [],
        native: false,
        failMusic: false,
        spotify: true,
        aiMode: 'music',
        waiting: false,
      };
      const original = ipcMain._invokeHandlers.get('flare:call');
      ipcMain.removeHandler('flare:call');
      ipcMain.handle('flare:call', (event, method, data) => {
        if (method === 'search' && data.query.startsWith('fixture ')) return [];
        return original(event, method, data);
      });
      shell.openExternal = async (url) => {
        global.musicFixture.opened.push(url);
      };
      app.getApplicationNameForProtocol = () =>
        global.musicFixture.native ? 'Fixture Player' : '';
      global.fetch = async (url, options = {}) => {
        const state = global.musicFixture;
        const parsed = new URL(url);
        state.requests.push(parsed.origin + parsed.pathname);
        const json = (data) => new Response(JSON.stringify(data));
        if (parsed.hostname === 'openrouter.ai' && parsed.pathname.endsWith('/models'))
          return json({
            data: [
              {
                id: 'fixture/small:free',
                pricing: { prompt: '0', completion: '0' },
                architecture: { output_modalities: ['text'] },
                supported_parameters: ['response_format'],
              },
            ],
          });
        if (parsed.hostname === 'openrouter.ai' && parsed.pathname.endsWith('/completions')) {
          if (state.aiMode === 'error') return new Response('{}', { status: 500 });
          if (state.aiMode === 'wait') {
            state.waiting = true;
            return new Promise((_resolve, reject) =>
              options.signal.addEventListener(
                'abort',
                () => reject(new DOMException('Cancelled', 'AbortError')),
                { once: true },
              ),
            );
          }
          const intents = {
            music: { kind: 'music', service: 'applemusic', title: 'Dil Mera', artist: 'Yashraj' },
            fallback: { kind: 'fallback' },
            answer: { kind: 'answer', text: 'A fixture answer.' },
            search: { kind: 'search', query: 'fixture missing file' },
          };
          return json({
            choices: [
              {
                message: {
                  content: JSON.stringify(intents[state.aiMode]),
                },
              },
            ],
          });
        }
        if (parsed.hostname === 'itunes.apple.com') {
          if (state.failMusic) return new Response('{}', { status: 500 });
          return json({
            results: [
              {
                kind: 'song',
                trackName: 'Dil Mera (feat. Yashraj)',
                artistName: 'OAFF, Savera & Burrah',
                trackViewUrl: 'https://music.apple.com/us/album/dil-mera/1696127956?i=1696127959',
              },
            ],
          });
        }
        if (parsed.hostname === 'song.link')
          return new Response(
            `<html><body><script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { pageData: { entityUniqueId: 'itunes|song|1696127959', sections: [{ links: state.spotify ? [{ platform: 'spotify', url: 'https://open.spotify.com/track/0123456789ABCDEFGHIJKL' }] : [] }] } } } })}</script></body></html>`,
          );
        throw new Error('Unexpected network request in isolated test');
      };
    });
    await page.getByTitle('Settings', { exact: true }).click();
    await page.getByRole('button', { name: /Intelligence/ }).click();
    await page.getByLabel('Use a model', { exact: true }).selectOption('openrouter');
    await page.getByLabel('API key', { exact: true }).fill('fixture-key');
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await expect(
      page.getByRole('option', { name: 'Automatic (free models)', exact: true }),
    ).toHaveCount(1);
    await page.screenshot({ path: path.join(directory, 'free-model-settings.png') });
    await page.evaluate(() =>
      window.flare.call('ai-save', {
        provider: 'openrouter',
        model: 'openrouter/free',
        key: 'fixture-key',
      }),
    );
    await page.reload();
    await expect(page.getByPlaceholder('Search anything...')).toBeVisible();
    const music = { kind: 'music', service: 'applemusic', title: 'Dil Mera', artist: 'Yashraj' };
    const resolve = (intent) =>
      page.evaluate((intent) => window.flare.call('music-resolve', intent), intent);
    const open = (id) => page.evaluate((id) => window.flare.call('open', { id }), id);
    const apple = await resolve(music);
    assert.equal(apple.kind, 'track');
    await open(apple.id);
    assert.deepEqual(await app.evaluate(() => global.musicFixture.opened), [
      'https://music.apple.com/us/album/dil-mera/1696127956?i=1696127959',
    ]);
    await assert.rejects(open(apple.id), /expired|again/i);
    const cancelled = await resolve(music);
    await page.evaluate(() => window.flare.call('ai-cancel'));
    await assert.rejects(open(cancelled.id), /expired|again/i);
    await app.evaluate(() => {
      global.musicFixture.native = true;
    });
    await open((await resolve({ ...music, service: 'spotify' })).id);
    assert.equal(
      (await app.evaluate(() => global.musicFixture.opened)).at(-1),
      'spotify:track:0123456789ABCDEFGHIJKL',
    );
    await app.evaluate(() => {
      global.musicFixture.spotify = false;
    });
    assert.equal((await resolve({ ...music, service: 'spotify' })).kind, 'answer');
    await page.evaluate(() => window.flare.call('ai-plan', { query: 'volume max' }));
    assert.equal(
      (await app.evaluate(() => global.musicFixture.requests)).filter((url) =>
        url.endsWith('/completions'),
      ).length,
      0,
    );
    await app.evaluate(({ BrowserWindow }) => {
      global.musicFixture.failMusic = true;
      BrowserWindow.getAllWindows()[0].show();
    });
    await page.getByPlaceholder('Search anything...').fill('fixture play Dil Mera by Yashraj');
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expect.poll(() => app.evaluate(() => global.musicFixture.opened.length)).toBe(3);
    assert.equal(
      new URL((await app.evaluate(() => global.musicFixture.opened)).at(-1)).searchParams.get('q'),
      'fixture play Dil Mera by Yashraj',
    );
    const reopen = async () => {
      await page.reload();
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].show();
      });
      await page.getByPlaceholder('Search anything...').waitFor();
    };
    for (const mode of ['fallback', 'error', 'search']) {
      await reopen();
      await app.evaluate((_, mode) => {
        global.musicFixture.aiMode = mode;
      }, mode);
      const original = 'fixture ' + mode + ' Speling & Exact  Text';
      const count = await app.evaluate(() => global.musicFixture.opened.length);
      await page.getByPlaceholder('Search anything...').fill(original);
      await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
      await expect
        .poll(() => app.evaluate(() => global.musicFixture.opened.length))
        .toBe(count + 1);
      assert.equal(
        new URL((await app.evaluate(() => global.musicFixture.opened)).at(-1)).searchParams.get(
          'q',
        ),
        original,
      );
    }
    await reopen();
    await app.evaluate(() => {
      global.musicFixture.aiMode = 'answer';
    });
    const count = await app.evaluate(() => global.musicFixture.opened.length);
    await page.getByPlaceholder('Search anything...').fill('fixture normal question');
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expect(page.getByText('A fixture answer.', { exact: true })).toBeVisible();
    assert.equal(await app.evaluate(() => global.musicFixture.opened.length), count);
    await app.evaluate(() => {
      global.musicFixture.aiMode = 'wait';
    });
    await page.getByPlaceholder('Search anything...').fill('fixture cancelled request');
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expect.poll(() => app.evaluate(() => global.musicFixture.waiting)).toBe(true);
    await page.getByPlaceholder('Search anything...').fill('fixture replacement');
    await expect(page.getByRole('button', { name: 'Ask AI', exact: true })).toBeEnabled();
    assert.equal(await app.evaluate(() => global.musicFixture.opened.length), count);
    await page.evaluate(() => window.flare.call('ai-save', { provider: 'off', model: '' }));
    await reopen();
    await page.getByPlaceholder('Search anything...').fill('fixture No AI original words');
    await expect(page.locator('.empty')).toContainText('No results');
    await page.getByPlaceholder('Search anything...').press('Enter');
    await expect.poll(() => app.evaluate(() => global.musicFixture.opened.length)).toBe(count + 1);
    assert.equal(
      new URL((await app.evaluate(() => global.musicFixture.opened)).at(-1)).searchParams.get('q'),
      'fixture No AI original words',
    );
    const corrected = await page.evaluate(() =>
      window.flare.call('search', { query: 'bightness 100' }),
    );
    assert.deepEqual(corrected[0].intent, { kind: 'system', command: 'brightness', value: 100 });
    assert.equal(corrected[0].detail, 'Brightness 100%');
    for (const [query, tool] of [
      ['compres images', 'compress'],
      ['convet images to pdf', 'images-pdf'],
      ['merge pdf', 'merge-pdf'],
      ['organise files', 'organize'],
      ['cleanup', 'cleanup'],
    ]) {
      const result = await page.evaluate(
        (query) => window.flare.call('open', { id: 'command:' + query }),
        query,
      );
      assert.equal(result.intent.tool, tool);
    }
    await page.evaluate(() => window.flare.call('open', { id: 'command:opne youtub' }));
    assert.equal(
      (await app.evaluate(() => global.musicFixture.opened)).at(-1),
      'https://www.youtube.com/',
    );
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify({
        passed: true,
        directory,
        checks: [
          'OpenRouter picker',
          'Real preload music IPC',
          'Apple exact web link',
          'Single-use and cancelled tokens',
          'Spotify native exact link',
          'Missing Spotify mapping',
          'Local command avoids AI',
          'Failed music lookup searches the exact original request on Google',
          'Unsupported, failed AI and empty file searches preserve original query',
          'Normal answers and cancellations never open Google',
          'Enter without AI opens Google only after submission',
          'Typo command previews and every built-in file-tool route',
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
