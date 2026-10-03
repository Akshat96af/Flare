const os = require('node:os');
const catalogue = [
  {
    id: 'qwen2.5:1.5b',
    title: 'Qwen 2.5 / Compact',
    download: 986000000,
    ram: 4 * 1024 ** 3,
    license: 'Apache-2.0',
    url: 'https://ollama.com/library/qwen2.5:1.5b',
  },
];
let controller;
async function pull(model, emit) {
  if (!catalogue.some((x) => x.id === model)) throw new Error('Choose a supported local model.');
  if (controller) throw new Error('A model download is already running.');
  controller = new AbortController();
  const current = controller;
  try {
    const response = await fetch('http://127.0.0.1:11434/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([current.signal, AbortSignal.timeout(30 * 60000)]),
      body: JSON.stringify({ model, stream: true }),
    });
    if (!response.ok) throw new Error('Open Ollama first, then try downloading again.');
    const decoder = new TextDecoder();
    let pending = '',
      success = false,
      lastEmit = 0;
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk, { stream: true });
      if (pending.length > 100000) throw new Error('Invalid download response.');
      let newline;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const value = JSON.parse(pending.slice(0, newline));
        pending = pending.slice(newline + 1);
        if (value.error) throw new Error(value.error);
        if (value.status === 'success') success = true;
        if (Date.now() - lastEmit > 150 || success) {
          emit('model-download', {
            model,
            status: value.status,
            total: value.total || 0,
            completed: value.completed || 0,
          });
          lastEmit = Date.now();
        }
      }
    }
    if (pending.trim()) {
      const value = JSON.parse(pending);
      if (value.error) throw new Error(value.error);
      success ||= value.status === 'success';
    }
    if (!success) throw new Error('Download ended before verification completed.');
    return true;
  } finally {
    if (controller === current) controller = null;
  }
}
function cancel() {
  controller?.abort();
}
module.exports = { catalogue, pull, cancel, hardware: () => ({ memory: os.totalmem() }) };
