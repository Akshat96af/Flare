const { test } = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../desktop/ai.cjs');
const { validateIntent } = require('../desktop/commands.cjs');

async function withFetch(mock, run) {
  const previous = global.fetch;
  global.fetch = mock;
  try {
    await run();
  } finally {
    global.fetch = previous;
  }
}
const response = (data) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('Gemini canonicalizes model resources and sends POST with room for reasoning', async () => {
  await withFetch(
    async (url, options) => {
      assert.equal(
        url,
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      );
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['x-goog-api-key'], 'fixture-key');
      assert.ok(JSON.parse(options.body).generationConfig.maxOutputTokens >= 2048);
      assert.deepEqual(JSON.parse(options.body).generationConfig.responseSchema.required, ['kind']);
      return response({
        candidates: [{ content: { parts: [{ text: '{"kind":"search","query":"invoices"}' }] } }],
      });
    },
    async () => {
      assert.deepEqual(
        await ai.plan(
          'find my invoices',
          { provider: 'gemini', model: ' models/gemini-2.5-flash ' },
          'fixture-key',
        ),
        { kind: 'search', query: 'invoices' },
      );
    },
  );
});

test('model catalogue separates discovered speech models from command models', async () => {
  await withFetch(async () => response({ models: [
    { name: 'models/gemini-3.6-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-transcribe', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-flash-live', supportedGenerationMethods: ['generateContent'] },
  ] }), async () => {
    const data = await ai.catalogue('gemini', 'fixture-key');
    assert.deepEqual(data.models, ['gemini-3.6-flash']);
    assert.deepEqual(data.speechModels, ['gemini-3.5-transcribe', 'gemini-3.6-flash']);
  });
});
test('blocked Gemini responses never reach the command executor', async () => {
  await withFetch(async () => response({ candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: '{"kind":"system","command":"volume","value":100}' }] } }] }), async () => {
    await assert.rejects(ai.plan('test', { provider: 'gemini', model: 'gemini-3.6-flash' }, 'fixture-key'), /Rephrase/);
  });
});
test('Gemini ignores thought parts and accepts a safe textual answer', async () => {
  await withFetch(
    async () =>
      response({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: 'private reasoning' },
                { text: '```json\n{"kind":"answer","text":"Four."}\n```' },
              ],
            },
          },
        ],
      }),
    async () => {
      assert.deepEqual(
        await ai.plan(
          'what is two plus two',
          { provider: 'gemini', model: 'gemini-2.5-flash' },
          'fixture-key',
        ),
        { kind: 'answer', text: 'Four.' },
      );
    },
  );
});
test('405 errors identify the method and redact a key echoed by a provider', async () => {
  await withFetch(
    async () =>
      new Response(JSON.stringify({ error: { message: 'Bad request fixture-secret' } }), {
        status: 405,
      }),
    async () => {
      await assert.rejects(
        ai.models('gemini', 'fixture-secret'),
        (error) =>
          /405/.test(error.message) &&
          /GET/.test(error.message) &&
          !/fixture-secret/.test(error.message),
      );
    },
  );
});
test('Gemini model discovery follows pagination and excludes non-text models', async () => {
  let count = 0;
  await withFetch(
    async (url, options) => {
      assert.equal(options.method, 'GET');
      count++;
      return count === 1
        ? response({
            models: [
              { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
              {
                name: 'models/gemini-2.5-flash-image',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
            nextPageToken: 'next page',
          })
        : response({
            models: [
              { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
            ],
          });
    },
    async () => {
      assert.deepEqual(await ai.models('gemini', 'fixture-key'), [
        'gemini-2.5-flash',
        'gemini-2.5-pro',
      ]);
      assert.equal(count, 2);
    },
  );
});
test('missing keys and invalid model routes are rejected before any network request', async () => {
  await withFetch(
    async () => {
      throw new Error('network should not be reached');
    },
    async () => {
      await assert.rejects(ai.models('gemini', ''), /API key/i);
      await assert.rejects(
        ai.plan('hello', { provider: 'gemini', model: 'https://example.com/test' }, 'fixture-key'),
        /model/i,
      );
    },
  );
});
test('safe answers are bounded and do not expand the executable tool registry', () => {
  assert.deepEqual(validateIntent({ kind: 'answer', text: 'Hello.' }), {
    kind: 'answer',
    text: 'Hello.',
  });
  assert.throws(() => validateIntent({ kind: 'answer', text: 'x'.repeat(6001) }));
  assert.throws(() => validateIntent({ kind: 'shell', command: 'erase C:' }));
});

test('unavailable models and busy providers give actionable errors without retries', async () => {
  for (const [status, message] of [
    [404, /another text model/],
    [503, /busy|temporarily unavailable/],
  ]) {
    let calls = 0;
    await withFetch(
      async () => {
        calls++;
        return new Response('{}', { status });
      },
      async () => {
        await assert.rejects(
          ai.plan('hello', { provider: 'gemini', model: 'gemini-fixture-flash' }, 'fixture-key'),
          message,
        );
        assert.equal(calls, 1);
      },
    );
  }
});

test('truncated Gemini output is rejected without executing partial intent', async () => {
  await withFetch(
    async () =>
      response({
        candidates: [
          {
            finishReason: 'MAX_TOKENS',
            content: { parts: [{ text: '{"kind":"system","command":"volume","value":100}' }] },
          },
        ],
      }),
    async () => {
      await assert.rejects(
        ai.plan('hello', { provider: 'gemini', model: 'gemini-fixture-flash' }, 'fixture-key'),
        /response space/,
      );
    },
  );
});

test('AI cancellation aborts transport and never retries', async () => {
  const controller = new AbortController();
  let calls = 0;
  await withFetch(
    async (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Cancelled', 'AbortError')),
          { once: true },
        ),
      );
    },
    async () => {
      const pending = ai.plan(
        'hello',
        { provider: 'gemini', model: 'gemini-fixture-flash' },
        'fixture-key',
        controller.signal,
      );
      controller.abort();
      await assert.rejects(pending, /cancelled/);
      assert.equal(calls, 1);
    },
  );
});
