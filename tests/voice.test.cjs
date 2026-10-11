const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transcribe } = require('../desktop/ai.cjs');
const { validatedWav } = require('../desktop/speech-audio.cjs');

test('local recognition accepts only bounded mono 16kHz PCM recordings', () => {
  const wave = Buffer.alloc(46);
  wave.write('RIFF');
  wave.writeUInt32LE(38, 4);
  wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(16000, 24);
  wave.writeUInt32LE(32000, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write('data', 36);
  wave.writeUInt32LE(2, 40);
  assert.deepEqual(validatedWav([...wave]), wave);
  for (const offset of [0, 4, 8, 12, 16, 20, 22, 24, 28, 32, 34, 36, 40]) {
    const malformed = [...wave];
    malformed[offset] ^= 1;
    assert.throws(() => validatedWav(malformed), /PCM/);
  }
  assert.throws(() => validatedWav([]), /Invalid/);
  assert.throws(() => validatedWav([...wave, 300]), /Invalid/);
  assert.throws(() => validatedWav(new Array(960046).fill(0)), /Invalid/);
});

test('Groq Whisper uploads the captured file with English and deterministic decoding', async () => {
  const previous = global.fetch;
  global.fetch = async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(options.headers.Authorization, 'Bearer fixture-key');
    assert.equal(options.body.get('model'), 'whisper-large-v3-turbo');
    assert.equal(options.body.get('language'), 'en');
    assert.equal(options.body.get('temperature'), '0');
    return new Response(JSON.stringify({ text: 'brightness one hundred' }));
  };
  try {
    assert.equal(
      await transcribe(
        [1, 2, 3],
        'audio/webm',
        { provider: 'groq', speechCloud: true },
        'fixture-key',
      ),
      'brightness one hundred',
    );
  } finally {
    global.fetch = previous;
  }
});

test('Gemini uses the dedicated speech model without changing the reasoning model', async () => {
  const original = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'open Claude' }] } }] }),
    );
  };
  try {
    const settings = {
      provider: 'gemini',
      model: 'gemini-3.6-flash',
      speechModel: 'gemini-3.5-transcribe',
      speechCloud: true,
    };
    assert.equal(
      await transcribe([1, 2, 255], 'audio/webm;codecs=opus', settings, 'fixture-key'),
      'open Claude',
    );
    assert.match(request.url, /gemini-3.5-transcribe:generateContent$/);
    assert.equal(
      request.body.contents[0].parts.find((x) => x.inlineData).inlineData.mimeType,
      'audio/webm',
    );
    assert.deepEqual(request.body.generationConfig.audioTranscriptionConfig.languageCodes, [
      'en-US',
      'en-IN',
    ]);
    assert.equal(settings.model, 'gemini-3.6-flash');
  } finally {
    global.fetch = original;
  }
});

test('OpenAI supports a dedicated modern transcription model with English vocabulary hints', async () => {
  const original = global.fetch;
  let body;
  global.fetch = async (_url, options) => {
    body = options.body;
    return new Response(JSON.stringify({ text: 'volume max' }));
  };
  try {
    assert.equal(
      await transcribe(
        [1, 2, 3],
        'audio/webm',
        { provider: 'openai', speechCloud: true, speechModel: 'gpt-4o-transcribe' },
        'fixture-key',
      ),
      'volume max',
    );
    assert.equal(body.get('model'), 'gpt-4o-transcribe');
    assert.equal(body.get('language'), 'en');
    assert.match(body.get('prompt'), /Claude/);
    assert.deepEqual([...new Uint8Array(await body.get('file').arrayBuffer())], [1, 2, 3]);
  } finally {
    global.fetch = original;
  }
});

test('online voice rejects unapproved or malformed recordings without HTTP', async () => {
  const original = global.fetch;
  global.fetch = async () => {
    throw new Error('Unexpected network call');
  };
  try {
    const settings = { provider: 'gemini', model: 'gemini-3.6-flash', speechCloud: true };
    await assert.rejects(transcribe([], 'audio/webm', settings, 'fixture-key'), /No valid audio/);
    await assert.rejects(
      transcribe([300], 'audio/webm', settings, 'fixture-key'),
      /No valid audio/,
    );
    await assert.rejects(
      transcribe([1], 'text/html', settings, 'fixture-key'),
      /Unsupported recording/,
    );
    await assert.rejects(
      transcribe([1], 'audio/webm', { ...settings, speechCloud: false }, 'fixture-key'),
      /Enable online/,
    );
  } finally {
    global.fetch = original;
  }
});

test('empty speech results are rejected and an in-flight upload is cancellable without retry', async () => {
  const original = global.fetch;
  const settings = { provider: 'openai', speechCloud: true, speechModel: 'gpt-4o-mini-transcribe' };
  try {
    global.fetch = async () => new Response(JSON.stringify({ text: ' ' }));
    await assert.rejects(transcribe([1], 'audio/webm', settings, 'fixture-key'), /No speech/);
    let calls = 0;
    global.fetch = (_url, options) => {
      calls++;
      return new Promise((_resolve, reject) =>
        options.signal.addEventListener(
          'abort',
          () => reject(new DOMException('Aborted', 'AbortError')),
          { once: true },
        ),
      );
    };
    const controller = new AbortController();
    const result = transcribe([1], 'audio/webm', settings, 'fixture-key', controller.signal);
    controller.abort();
    await assert.rejects(result, /cancelled/);
    assert.equal(calls, 1);
  } finally {
    global.fetch = original;
  }
});
