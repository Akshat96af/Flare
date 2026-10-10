const { evaluate } = require('mathjs');
const { websites } = require('./search.cjs');
const { services, serviceTarget } = require('./services.cjs');
function interpretLocal(input) {
  if (typeof input !== 'string' || input.length > 2000) return null;
  const text = input.trim().replace(/[.!?]+$/, '');
  const prefix = text.match(/^(spotify|apple music|youtube|google)\s+(.+)$/i);
  const suffix = text.match(
    /^(?:play\s+|find\s+|search(?: for)?\s+)?(.+?)\s+(?:on\s+)?(spotify|apple music|youtube|google)$/i,
  );
  const service = (prefix?.[1] || suffix?.[2] || '').toLowerCase().replace(/\s/g, '');
  const mediaQuery = prefix?.[2] || suffix?.[1];
  if (mediaQuery && !/^open$/i.test(mediaQuery)) {
    if (['spotify', 'applemusic'].includes(service)) {
      const [title, artist = ''] = mediaQuery.replace(/^play\s+/i, '').split(/\s+by\s+/i);
      return validateIntent({ kind: 'music', service, title, artist });
    }
    return validateIntent({ kind: 'service', service, query: mediaQuery });
  }
  let m = text.match(
    /^(?:set\s+)?(?:the\s+)?(volume|brightness)(?:\s+to)?\s+(maximum|max|minimum|min|mute|zero|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|(?:one )?hundred|\d{1,3})(?:\s*%|\s+percent)?$/i,
  );
  if (m)
    return {
      kind: 'system',
      command: m[1].toLowerCase(),
      value: /^max/i.test(m[2])
        ? 100
        : /^min/i.test(m[2])
          ? 0
          : ({
              mute: 0,
              zero: 0,
              ten: 10,
              twenty: 20,
              thirty: 30,
              forty: 40,
              fifty: 50,
              sixty: 60,
              seventy: 70,
              eighty: 80,
              ninety: 90,
              hundred: 100,
              'one hundred': 100,
            }[m[2].toLowerCase()] ?? Math.min(100, Number(m[2]))),
    };
  m = text.match(/^open\s+(.+)$/i);
  if (m) {
    if (/^apple music$/i.test(m[1])) return { kind: 'service', service: 'applemusic', query: '' };
    if (Object.hasOwn(services, m[1].toLowerCase()))
      return { kind: 'service', service: m[1].toLowerCase(), query: '' };
    const site = websites.find(([title]) => title.toLowerCase() === m[1].toLowerCase());
    return { kind: 'launch', query: site?.[0] || m[1] };
  }
  if (/^(?:organize|organise|arrange)\b/i.test(text))
    return { kind: 'tool', tool: 'organize', mode: /month|date/i.test(text) ? 'month' : 'type' };
  if (/^(?:find\s+)?(?:unused\s+files|cleanup|clean up)/i.test(text))
    return { kind: 'tool', tool: 'cleanup' };
  if (/^compress\b/i.test(text)) return { kind: 'tool', tool: 'compress' };
  if (/^convert\b.*\bpdf\b/i.test(text)) return { kind: 'tool', tool: 'images-pdf' };
  if (/^merge\b.*\bpdf/i.test(text)) return { kind: 'tool', tool: 'merge-pdf' };
  if (/^[\d\s.+\-*/()%]+$/.test(text) && /[+\-*/%]/.test(text) && text.length <= 100) {
    try {
      const result = evaluate(text);
      if (typeof result === 'number' && Number.isFinite(result))
        return { kind: 'calculator', value: String(result), query: text };
    } catch {}
  }
  return null;
}
function validateIntent(intent) {
  if (!intent || typeof intent !== 'object' || Array.isArray(intent))
    throw new Error('AI did not return a valid command.');
  if (intent.kind === 'music') {
    if (
      !['spotify', 'applemusic'].includes(intent.service) ||
      typeof intent.title !== 'string' ||
      !intent.title.trim() ||
      intent.title.length > 200 ||
      (intent.artist !== undefined &&
        (typeof intent.artist !== 'string' || intent.artist.length > 200)) ||
      /[\u0000-\u001f]/.test(intent.title + (intent.artist || ''))
    )
      throw new Error('Specify a song title and, if known, its artist.');
    return {
      kind: 'music',
      service: intent.service,
      title: intent.title.trim(),
      artist: (intent.artist || '').trim(),
    };
  }
  if (intent.kind === 'service') {
    serviceTarget(intent.service, intent.query);
    return { kind: 'service', service: intent.service, query: (intent.query || '').trim() };
  }
  if (
    intent.kind === 'launch' &&
    typeof intent.query === 'string' &&
    intent.query.trim() &&
    intent.query.length <= 100 &&
    !/[\\/:\u0000-\u001f]/.test(intent.query)
  )
    return { kind: 'launch', query: intent.query.trim() };
  if (
    intent.kind === 'answer' &&
    typeof intent.text === 'string' &&
    intent.text.trim() &&
    intent.text.length <= 6000
  )
    return { kind: 'answer', text: intent.text.trim() };
  if (intent.kind === 'search' && typeof intent.query === 'string' && intent.query.length <= 500)
    return { kind: 'search', query: intent.query };
  if (
    intent.kind === 'system' &&
    ['volume', 'brightness'].includes(intent.command) &&
    Number.isFinite(intent.value)
  )
    return {
      kind: 'system',
      command: intent.command,
      value: Math.min(100, Math.max(0, Math.round(intent.value))),
    };
  if (
    intent.kind === 'tool' &&
    ['organize', 'cleanup', 'compress', 'images-pdf', 'merge-pdf'].includes(intent.tool)
  )
    return { kind: 'tool', tool: intent.tool, mode: intent.mode === 'month' ? 'month' : 'type' };
  if (intent.kind === 'website') {
    const url = new URL(intent.url);
    if (url.protocol !== 'https:' || !websites.some((x) => new URL(x[1]).origin === url.origin))
      throw new Error('Choose a website from search results.');
    return { kind: 'website', url: url.origin, title: url.hostname };
  }
  throw new Error('That command is not supported yet. Try searching or choosing a built-in tool.');
}
module.exports = { interpretLocal, validateIntent };
