const { test } = require('node:test');
const assert = require('node:assert/strict');
const { interpretLocal, validateIntent } = require('../desktop/commands.cjs');
const { googleFallbackTarget } = require('../desktop/services.cjs');

test('system commands tolerate missing, extra, swapped and mistyped letters', () => {
  for (const query of [
    'bightness 100',
    'brighness 100',
    'brightnes 100',
    'brighntess 100',
    'brightness bightness 100',
    'set the bightness to 100 percent',
    'please bightness 100 please',
    'could you please set bightness to 100',
  ])
    assert.deepEqual(
      interpretLocal(query),
      { kind: 'system', command: 'brightness', value: 100 },
      query,
    );
  for (const query of ['volum 50', 'vloume 50', 'volmue 50', 'voulme 50'])
    assert.deepEqual(
      interpretLocal(query),
      { kind: 'system', command: 'volume', value: 50 },
      query,
    );
  for (const [query, value] of [
    ['volume max', 100],
    ['brightness minimum', 0],
    ['volume mute', 0],
    ['volume 999', 100],
    ['volume fifty', 50],
  ])
    assert.equal(interpretLocal(query).value, value);
});

test('launch and music typos preserve song and artist spelling', () => {
  assert.deepEqual(interpretLocal('opne youtub'), {
    kind: 'service',
    service: 'youtube',
    query: '',
  });
  assert.deepEqual(interpretLocal('open cloude'), { kind: 'launch', query: 'Claude' });
  assert.deepEqual(interpretLocal('spotfy DIL mera by Yashraj'), {
    kind: 'music',
    service: 'spotify',
    title: 'DIL mera',
    artist: 'Yashraj',
  });
  assert.deepEqual(interpretLocal('play DIL mera by Yashraj on spotfy'), {
    kind: 'music',
    service: 'spotify',
    title: 'DIL mera',
    artist: 'Yashraj',
  });
  assert.deepEqual(interpretLocal('spotify Song by Googel'), {
    kind: 'music',
    service: 'spotify',
    title: 'Song',
    artist: 'Googel',
  });
});

test('every supported local command family still routes to its finite action', () => {
  for (const [query, kind, tool] of [
    ['organise files by month', 'tool', 'organize'],
    ['arrange files', 'tool', 'organize'],
    ['compres images', 'tool', 'compress'],
    ['convet images to pdf', 'tool', 'images-pdf'],
    ['merge pdf files', 'tool', 'merge-pdf'],
    ['cleanup', 'tool', 'cleanup'],
    ['find unused files', 'tool', 'cleanup'],
    ['youtube new music', 'service'],
    ['google weather', 'service'],
    ['open notepad', 'launch'],
    ['12 * (3 + 4)', 'calculator'],
  ]) {
    const value = interpretLocal(query);
    assert.equal(value?.kind, kind, query);
    if (tool) assert.equal(value.tool, tool, query);
  }
  for (const query of [
    'do not set brightness 100',
    'what is spotify',
    'volume invoice',
    'brightness -50',
    'delete all files',
    'format drive D',
    'open Spotify and then delete files',
  ])
    assert.equal(interpretLocal(query), null, query);
});

test('Google fallback preserves exactly the submitted query without URL injection', () => {
  for (const query of [
    '  spotfy Dil Mera by Yashraj  ',
    '"a & b" + c#d? / music',
    'हिन्दी song spotify',
  ]) {
    const url = new URL(googleFallbackTarget(query));
    assert.equal(url.origin, 'https://www.google.com');
    assert.equal(url.pathname, '/search');
    assert.equal(url.searchParams.get('q'), query);
    assert.equal([...url.searchParams].length, 1);
  }
  for (const query of ['', null, 'a'.repeat(2001), 'bad\nquery'])
    assert.throws(() => googleFallbackTarget(query));
  assert.deepEqual(validateIntent({ kind: 'fallback', query: 'rewritten by AI' }), {
    kind: 'fallback',
  });
});
