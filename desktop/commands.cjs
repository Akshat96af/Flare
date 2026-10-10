const { evaluate } = require('mathjs');
const { websites } = require('./search.cjs');
const { services, serviceTarget } = require('./services.cjs');
const { distance } = require('fastest-levenshtein');
const commandWords = ['brightness', 'volume', 'open', 'play', 'find', 'search', 'organize', 'organise', 'arrange', 'compress', 'convert', 'merge', 'cleanup', 'spotify', 'youtube', 'google'];
const serviceWords = ['spotify', 'apple music', 'youtube', 'google'];
function correctKeyword(value, choices) {
  const word = value.toLowerCase();
  if (choices.includes(word)) return word;
  if (word.length < 4 || word.length > 30) return value;
  const scores = [...new Set(choices)].map(candidate => {
    let edits = distance(word, candidate);
    // Treat an adjacent letter swap as one typo, including short verbs like "opne".
    if (edits === 2 && word.length === candidate.length) {
      const differences = [...word].map((char, i) => char === candidate[i] ? -1 : i).filter(i => i >= 0);
      if (differences.length === 2 && differences[1] === differences[0] + 1 &&
          word[differences[0]] === candidate[differences[1]] && word[differences[1]] === candidate[differences[0]]) edits = 1;
    }
    return { candidate, edits };
  }).filter(item => item.edits <= (item.candidate.length >= 8 ? 2 : 1)).sort((a,b) => a.edits-b.edits);
  return scores.length && (scores.length === 1 || scores[0].edits < scores[1].edits) ? scores[0].candidate : value;
}
function normalizeCommand(text) {
  text = text.replace(/^please\s+/i, '').replace(/\s+please$/i, '');
  text = text.replace(/^((?:set\s+)?(?:the\s+)?)([a-z]+)/i, (_match, prefix, word) => prefix + correctKeyword(word, commandWords));
  // Only service positions are corrected. Song titles, artists and file names stay untouched.
  text = text.replace(/^([a-z]+\s+[a-z]+)(?=\s)/i, phrase => correctKeyword(phrase, ['apple music']));
  if (!/^(?:spotify|apple music|youtube|google)\s/i.test(text))
    text = text.replace(/\b([a-z]+(?:\s+music)?)$/i, word => correctKeyword(word, serviceWords));
  text = text.replace(/^(brightness|volume)\s+([a-z]+)(?=\s+(?:\d|maximum|max|minimum|min)\b)/i,
    (match, command, repeated) => correctKeyword(repeated, [command.toLowerCase()]) === command.toLowerCase() ? command : match);
  text = text.replace(/^open\s+(.+)$/i, (_match, target) => 'open ' + correctKeyword(target, [...serviceWords, ...websites.map(([title]) => title.toLowerCase())]));
  return text;
}
function interpretLocal(input) {
  try {
    return parseLocal(input);
  } catch {
    return null;
  }
}
function parseLocal(input) {
  if (typeof input !== 'string' || input.length > 2000) return null;
  let text = input.trim().replace(/[.!?]+$/, '');
  if (
    /^(?:what|why|how|who|where|when|is|are|does|do|can|could|would|should|explain|tell me)\b/i.test(
      text,
    )
  )
    return null;
  text = normalizeCommand(text);
  // Compound requests need interpretation, not partial execution of a local shortcut.
  if (
    /\b(?:and then|then|and (?:open|play|set|delete|find|search|organize|organise))\b/i.test(text)
  )
    return null;
  const prefix = text.match(/^(spotify|apple music|youtube|google)\s+(.+)$/i);
  const suffix = text.match(
    /^(?:play\s+|find\s+|search(?: for)?\s+)?(.+?)\s+(?:on\s+)?(spotify|apple music|youtube|google)$/i,
  );
  const service = (prefix?.[1] || suffix?.[2] || '').toLowerCase().replace(/\s/g, '');
  const mediaQuery = prefix?.[2] || suffix?.[1];
  if (mediaQuery && !/^open$/i.test(mediaQuery)) {
    if (['spotify', 'applemusic'].includes(service)) {
      const song = mediaQuery.replace(/^play\s+/i, '');
      const by = /\s+by\s+/i.exec(song);
      const title = by ? song.slice(0, by.index) : song;
      const artist = by ? song.slice(by.index + by[0].length) : '';
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
    return validateIntent({ kind: 'launch', query: site?.[0] || m[1] });
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
  if (intent.kind === 'fallback') return { kind: 'fallback' };
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
module.exports = { interpretLocal, validateIntent, correctKeyword };
