const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interpretLocal, validateIntent } = require('../desktop/commands.cjs');
const { resolveMusic, trackTarget, openTrack, spotifyFromPage } = require('../desktop/music.cjs');
const { serviceTarget, openService } = require('../desktop/services.cjs');

const song = {
  kind: 'song',
  trackName: 'Dil Mera (feat. Yashraj)',
  artistName: 'OAFF, Savera & Burrah',
  trackViewUrl: 'https://music.apple.com/us/album/dil-mera/1696127956?i=1696127959&uo=4',
};
const intent = { kind: 'music', service: 'applemusic', title: 'Dil Mera', artist: 'Yashraj' };
const spotify = 'https://open.spotify.com/track/0123456789ABCDEFGHIJKL';
async function withFetch(mock, run) {
  const previous = global.fetch;
  global.fetch = mock;
  try {
    await run();
  } finally {
    global.fetch = previous;
  }
}
const response = (data) => new Response(JSON.stringify(data));
const page = (url, entity = 'itunes|song|1696127959') =>
  `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { pageData: { entityUniqueId: entity, sections: [{ links: [{ platform: 'spotify', url }] }] } } } })}</script></body></html>`;

test('music shortcuts preserve the song and artist across supported word orders', () => {
  for (const input of [
    'apple music dil mera by yashraj',
    'play dil mera by yashraj on apple music',
    'dil mera by yashraj apple music',
  ])
    assert.deepEqual(interpretLocal(input), { ...intent, title: 'dil mera', artist: 'yashraj' });
  assert.deepEqual(interpretLocal('spotify dil mera by yashraj'), {
    ...intent,
    service: 'spotify',
    title: 'dil mera',
    artist: 'yashraj',
  });
  for (const input of [
    'what is spotify?',
    'how do I use apple music',
    'open Spotify and then delete downloads',
    'open C:\\Windows',
    'spotify ' + 'a'.repeat(201),
  ])
    assert.equal(interpretLocal(input), null, input);
  assert.throws(() => validateIntent({ ...intent, service: 'shell' }));
  assert.throws(() => validateIntent({ ...intent, title: 'x\nopen something' }));
});

test('music targets only accept exact tracks on the expected host', () => {
  assert.equal(
    trackTarget('spotify', spotify + '?si=tracking').native,
    'spotify:track:0123456789ABCDEFGHIJKL',
  );
  assert.equal(
    trackTarget('applemusic', song.trackViewUrl).web,
    song.trackViewUrl.replace('&uo=4', ''),
  );
  for (const value of [
    spotify.replace('https:', 'http:'),
    spotify.replace('open.spotify.com', 'open.spotify.com.attacker.test'),
    spotify.replace('/track/', '/search/'),
    spotify.replace('https://', 'https://user:pass@'),
    spotify.replace('.com/', '.com:444/'),
    'spotify:track:0123456789ABCDEFGHIJKL',
  ])
    assert.throws(() => trackTarget('spotify', value));
  assert.throws(() => trackTarget('applemusic', 'https://music.apple.com/us/album/dil-mera/123'));
  assert.throws(() => serviceTarget('spotify', 'Dil Mera'));
  assert.throws(() => serviceTarget('__proto__'));
  assert.equal(
    new URL(serviceTarget('youtube', 'a & b').web).searchParams.get('search_query'),
    'a & b',
  );
});

test('Apple lookup resolves featured artists and strips tracking parameters', async () => {
  await withFetch(
    async (url, options) => {
      assert.equal(url.origin, 'https://itunes.apple.com');
      assert.equal(url.searchParams.get('term'), 'Dil Mera Yashraj');
      assert.equal(options.redirect, 'error');
      return response({ results: [song] });
    },
    async () => {
      const track = await resolveMusic(intent);
      assert.equal(track.web, song.trackViewUrl.replace('&uo=4', ''));
      assert.equal(track.title, song.trackName);
    },
  );
});

test('ambiguous or unverified matches never open a guessed song', async () => {
  for (const results of [
    [],
    [{ ...song, trackName: 'Wrong song' }],
    [song, { ...song, artistName: 'Someone else', trackName: 'Dil Mera' }],
  ]) {
    await withFetch(
      async () => response({ results }),
      async () => {
        const value = await resolveMusic({ ...intent, artist: '' });
        assert.equal(value.kind, 'answer');
        assert.equal(value.web, undefined);
      },
    );
  }
});

test('public Spotify mapping must belong to the exact catalogue track', () => {
  assert.equal(spotifyFromPage(page(spotify), '1696127959').web, spotify);
  assert.equal(spotifyFromPage(page(spotify, 'itunes|song|different'), '1696127959'), null);
  assert.equal(spotifyFromPage(page(undefined), '1696127959'), null);
  assert.equal(spotifyFromPage('<html><body>Changed layout</body></html>', '1696127959'), null);
  assert.throws(() => spotifyFromPage(page('https://attacker.test/'), '1696127959'));
});

test('Spotify uses only public metadata and reports unavailable mappings honestly', async () => {
  for (const link of [spotify, undefined]) {
    const urls = [];
    await withFetch(
      async (url) => {
        urls.push(String(url));
        return urls.length === 1 ? response({ results: [song] }) : new Response(page(link));
      },
      async () => {
        const result = await resolveMusic({ ...intent, service: 'spotify' });
        assert.equal(urls[1], 'https://song.link/i/1696127959');
        if (link) assert.equal(result.web, spotify);
        else {
          assert.equal(result.kind, 'answer');
          assert.match(result.text, /Nothing was opened/);
        }
      },
    );
  }
});

test('cancelled music lookups do not return launchable tracks', async () => {
  const controller = new AbortController();
  await withFetch(
    async () => {
      controller.abort();
      return response({ results: [song] });
    },
    async () =>
      await assert.rejects(resolveMusic(intent, controller.signal), { name: 'AbortError' }),
  );
});

test('track opening prefers the app and otherwise opens only its exact web track', async () => {
  for (const mode of ['native', 'missing', 'broken']) {
    const opened = [];
    const result = await openTrack(
      { service: 'spotify', web: spotify, title: 'Song', artist: 'Artist' },
      {
        hasProtocol: async () => mode !== 'missing',
        openExternal: async (url) => {
          if (mode === 'broken' && url.startsWith('spotify:')) throw new Error('handler failed');
          opened.push(url);
        },
      },
    );
    assert.deepEqual(opened, [
      mode === 'native' ? 'spotify:track:0123456789ABCDEFGHIJKL' : spotify,
    ]);
    assert.doesNotMatch(result.message, /playing/i);
  }
  const opened = [];
  await openService(
    { service: 'spotify', query: '' },
    { hasProtocol: async () => false, openExternal: async (url) => opened.push(url) },
  );
  assert.deepEqual(opened, ['https://open.spotify.com/']);
});
