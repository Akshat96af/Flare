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
    await app.evaluate(({ shell, app }) => {
      global.musicFixture = {
        opened: [],
        requests: [],
        native: false,
        failMusic: false,
        spotify: true,
      };
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
        if (parsed.hostname === 'openrouter.ai' && parsed.pathname.endsWith('/completions'))
          return json({
            choices: [
              {
                message: {
                  content:
                    '{"kind":"music","service":"applemusic","title":"Dil Mera","artist":"Yashraj"}',
                },
              },
            ],
          });
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
    await page
      .getByPlaceholder('Search anything...')
      .fill('Could you play Dil Mera by Yashraj on Apple Music');
    await page.getByRole('button', { name: 'Ask AI', exact: true }).click();
    await expect(
      page.getByText('Music lookup is unavailable. Try again later.', { exact: true }),
    ).toBeVisible();
    await page.screenshot({ path: path.join(directory, 'music-error-visible.png') });
    assert.equal((await app.evaluate(() => global.musicFixture.opened)).length, 2);
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
          'AI music errors visible',
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
