const normalized = (value) =>
  String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
function matchesSong(item, intent) {
  const featured = [...item.trackName.matchAll(/\((?:feat\.?|ft\.?|featuring)\s+([^)]*)\)/gi)].map(
    (match) => match[1],
  );
  const title = item.trackName.replace(/\s*\((?:feat\.?|ft\.?|featuring)\s+[^)]*\)/gi, '');
  const artists = [item.artistName, ...featured].flatMap((value) =>
    value.split(/\s*(?:,|&|\band\b|\bfeat\.?\s)\s*/i),
  );
  return (
    normalized(title) === normalized(intent.title) &&
    (!intent.artist ||
      artists.some((artist) => normalized(artist) === normalized(intent.artist)) ||
      normalized(item.artistName) === normalized(intent.artist))
  );
}
async function read(url, signal) {
  const response = await fetch(url, {
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(15000)]),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status === 429
        ? 'Music lookup is busy. Wait a minute and try again.'
        : 'Music lookup is unavailable. Try again later.',
    );
  }
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1000000) throw new Error('Music response is too large.');
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  } finally {
    await reader.cancel();
  }
}
async function json(url, signal) {
  return JSON.parse(await read(url, signal));
}
function spotifyFromPage(html, trackId) {
  // Only read the public page's structured links; never execute its scripts.
  const document = new XMLParser({
    ignoreAttributes: false,
    processEntities: false,
    stopNodes: ['*.script', '*.style'],
    unpairedTags: ['meta', 'link', 'img', 'input', 'br', 'hr'],
  }).parse(html);
  const script = [document.html?.body?.script]
    .flat()
    .find((item) => item?.['@_id'] === '__NEXT_DATA__');
  const page = JSON.parse(script?.['#text'] || '{}').props?.pageProps?.pageData;
  if (page?.entityUniqueId !== `itunes|song|${trackId}` || !Array.isArray(page.sections))
    return null;
  const link = page.sections
    .flatMap((section) => (Array.isArray(section.links) ? section.links : []))
    .find((item) => item.platform === 'spotify' && typeof item.url === 'string');
  return link ? trackTarget('spotify', link.url) : null;
}
function trackTarget(service, value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port)
    throw new Error('Invalid music link.');
  if (
    service === 'spotify' &&
    url.hostname === 'open.spotify.com' &&
    /^\/track\/[A-Za-z0-9]{22}$/.test(url.pathname)
  )
    return {
      web: url.origin + url.pathname,
      native: 'spotify:track:' + url.pathname.split('/')[2],
    };
  if (
    service === 'applemusic' &&
    url.hostname === 'music.apple.com' &&
    /^\/[a-z]{2}\/album\//.test(url.pathname) &&
    /^\d+$/.test(url.searchParams.get('i') || '')
  ) {
    url.search = '?i=' + url.searchParams.get('i');
    return { web: url.href, native: url.href.replace(/^https:/, 'music:') };
  }
  throw new Error('No verified song link is available for this player.');
}
async function resolveMusic(intent, signal) {
  intent = require('./commands.cjs').validateIntent(intent);
  if (intent.kind !== 'music') throw new Error('Choose a song first.');
  signal?.throwIfAborted();
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({
    term: [intent.title, intent.artist].filter(Boolean).join(' '),
    entity: 'song',
    limit: '25',
  });
  const data = await json(url, signal);
  const matches = (data.results || []).filter(
    (item) =>
      item.kind === 'song' &&
      typeof item.trackName === 'string' &&
      typeof item.artistName === 'string' &&
      matchesSong(item, intent),
  );
  const distinct = [
    ...new Map(
      matches.map((item) => [
        normalized(item.trackName) + '\0' + normalized(item.artistName),
        item,
      ]),
    ).values(),
  ];
  if (distinct.length !== 1) {
    const candidates = (data.results || []).filter((item) => item.kind === 'song').slice(0, 4);
    return {
      kind: 'answer',
      text:
        distinct.length > 1
          ? 'Which artist do you mean?\n' +
            distinct
              .slice(0, 4)
              .map((item) => `${item.trackName} by ${item.artistName}`)
              .join('\n')
          : 'I could not verify an exact match. Please include the song title and artist.' +
            (candidates.length
              ? '\nPossible matches:\n' +
                candidates.map((item) => `${item.trackName} by ${item.artistName}`).join('\n')
              : ''),
    };
  }
  const song = distinct[0];
  const apple = new URL(song.trackViewUrl);
  if (
    !['itunes.apple.com', 'music.apple.com'].includes(apple.hostname) ||
    apple.protocol !== 'https:' ||
    apple.username ||
    apple.password ||
    apple.port
  )
    throw new Error('The music catalogue returned an invalid link.');
  apple.hostname = 'music.apple.com';
  let target;
  if (intent.service === 'applemusic') target = trackTarget('applemusic', apple.href);
  else {
    const appleTrack = trackTarget('applemusic', apple.href);
    const id = new URL(appleTrack.web).searchParams.get('i');
    try {
      target = spotifyFromPage(await read(`https://song.link/i/${id}`, signal), id);
    } catch {
      signal?.throwIfAborted();
    }
    if (!target)
      return {
        kind: 'answer',
        text: `Found ${song.trackName} by ${song.artistName}, but the free lookup could not verify its exact Spotify link. Nothing was opened. Try this song on Apple Music instead.`,
      };
  }
  signal?.throwIfAborted();
  return { ...target, title: song.trackName, artist: song.artistName, service: intent.service };
}
async function openTrack(track, { hasProtocol, openExternal }) {
  const target = trackTarget(track.service, track.web);
  try {
    if (await hasProtocol(target.native)) {
      await openExternal(target.native);
      return { message: `Opened ${track.title} by ${track.artist} in the app` };
    }
  } catch {
    /* An unregistered or broken native handler falls back to the exact web track. */
  }
  await openExternal(target.web);
  return { message: `Opened ${track.title} by ${track.artist} on the web` };
}
module.exports = { resolveMusic, trackTarget, openTrack, spotifyFromPage };
const { XMLParser } = require('fast-xml-parser');
