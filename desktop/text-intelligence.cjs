const ai = require('./ai.cjs');
const tasks = {
  summary: {
    label: 'Summarize',
    prompt:
      'Give a concise summary, key facts, dates and amounts. State when the excerpt is incomplete.',
  },
  cleanup: {
    label: 'Clean up text',
    prompt:
      'Correct obvious OCR spacing and broken line wraps. Preserve names, dates, numbers and meaning. Do not guess unreadable words; mark uncertainty explicitly. Return the cleaned text.',
  },
  'action-items': {
    label: 'Extract action items',
    prompt:
      'List only action items explicitly supported by this excerpt, with owners and deadlines only when stated. If none exist, say so. Do not execute any action.',
  },
};
async function enhance(excerpt, task, settings, key, signal) {
  if (!Object.hasOwn(tasks, task)) throw new Error('Unsupported text action.');
  if (typeof excerpt.text !== 'string' || !excerpt.text.trim())
    throw new Error('No readable text to process.');
  return ai.plan(tasks[task].prompt, settings, key, signal, {
    document: {
      name: excerpt.name,
      text: excerpt.text.slice(0, 16000),
      truncated: excerpt.truncated || excerpt.text.length > 16000,
    },
    textTask: task,
  });
}
module.exports = { tasks, enhance };
