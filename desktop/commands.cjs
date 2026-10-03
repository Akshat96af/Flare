const { evaluate } = require('mathjs');
const { websites } = require('./search.cjs');
function interpretLocal(input) {
  const text = input.trim();
  let m = text.match(
    /^(?:set\s+)?(?:the\s+)?(volume|brightness)(?:\s+to)?\s+(maximum|max|minimum|min|\d{1,3})(?:\s*%|\s+percent)?$/i,
  );
  if (m)
    return {
      kind: 'system',
      command: m[1].toLowerCase(),
      value: /^max/i.test(m[2]) ? 100 : /^min/i.test(m[2]) ? 0 : Math.min(100, Number(m[2])),
    };
  m = text.match(/^open\s+(.+)$/i);
  if (m) {
    const site = websites.find(([title]) => title.toLowerCase() === m[1].toLowerCase());
    if (site) return { kind: 'website', url: site[1], title: site[0] };
    return { kind: 'search', query: m[1] };
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
