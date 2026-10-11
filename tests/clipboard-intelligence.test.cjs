const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../desktop/store.cjs');
const { ClipboardHistory } = require('../desktop/clipboard-history.cjs');
const { enhance } = require('../desktop/text-intelligence.cjs');
async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'flare-clipboard-'));
  const store = createStore(directory);
  const put = (item) =>
    store.db
      .prepare('INSERT OR REPLACE INTO entries(id,title,path,kind,detail) VALUES(?,?,?,?,?)')
      .run(item.id, item.title, item.path, item.kind, item.detail);
  const history = new ClipboardHistory(store, put);
  t.after(async () => {
    store.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { store, history, put };
}
function clipboard({ bytes, width = 100, height = 50, text = '', sensitive = false } = {}) {
  const image = {
    isEmpty: () => !bytes,
    getSize: () => ({ width, height }),
    toPNG: () => bytes,
    resize: (options) => {
      assert.ok(options.width <= 48 && options.height <= 48);
      return { toPNG: () => Buffer.from('thumbnail') };
    },
  };
  return {
    has: (name) => sensitive && name === 'ExcludeClipboardContentFromMonitorProcessing',
    readBuffer: () => Buffer.from([0]),
    readImage: () => image,
    readText: () => text,
  };
}
test('clipboard capture is opt-in and respects sensitive-content markers before reading', async (t) => {
  const { store, history } = await fixture(t);
  assert.equal(history.capture({}), undefined);
  store.saveSettings({ ...store.settings(), clipboard: true });
  assert.equal(history.capture({ has: () => true }), undefined);
  const blocked = clipboard({ text: 'private' });
  blocked.has = (name) => name === 'CanIncludeInClipboardHistory';
  assert.equal(history.capture(blocked), undefined);
  assert.equal(
    store.db.prepare("SELECT count(*) count FROM entries WHERE kind='clipboard'").get().count,
    0,
  );
});
test('screenshots stay in bounded session memory, deduplicate and never store image bytes in SQLite', async (t) => {
  const { store, history } = await fixture(t);
  store.saveSettings({ ...store.settings(), clipboard: true });
  const bytes = Buffer.from('pixel fixture'),
    now = Date.now();
  const id = history.capture(clipboard({ bytes }), now);
  assert.deepEqual(history.image(id).bytes, bytes);
  assert.equal(history.capture(clipboard({ bytes }), now + 1), undefined);
  const row = store.db.prepare('SELECT * FROM entries WHERE id=?').get(id);
  assert.equal(row.path, 'clipboard-image:' + id);
  assert.equal(row.content, '');
  assert.equal(history.decorate(row).clipboardImage, true);
  assert.equal(history.capture(clipboard({ bytes, width: 10000, height: 10000 })), undefined);
  assert.equal(history.capture(clipboard({ bytes: Buffer.alloc(13 * 1024 * 1024) })), undefined);
  for (let i = 0; i < 7; i++)
    history.capture(clipboard({ bytes: Buffer.alloc(6 * 1024 * 1024, i) }), now + i + 2);
  assert.ok(
    [...history.images.values()].reduce((sum, item) => sum + item.bytes.length, 0) <=
      32 * 1024 * 1024,
  );
  assert.throws(() => history.image(id), /expired/);
});
test('clipboard clearing, expiry and restart remove screenshot availability without exposing disk paths', async (t) => {
  const { store, history, put } = await fixture(t);
  store.saveSettings({ ...store.settings(), clipboard: true });
  const now = Date.now();
  const id = history.capture(clipboard({ bytes: Buffer.from('image') }), now);
  history.prune(now + 8 * 86400000);
  assert.equal(history.images.size, 0);
  assert.throws(() => history.image(id), /expired/);
  const textId = history.capture(clipboard({ text: 'plain text' }));
  history.capture(clipboard({ bytes: Buffer.from('another image') }));
  const restarted = new ClipboardHistory(store, put);
  assert.equal(restarted.images.size, 0);
  assert.ok(store.db.prepare('SELECT id FROM entries WHERE id=?').get(textId));
  restarted.clear();
  assert.equal(
    store.db.prepare("SELECT count(*) count FROM entries WHERE kind='clipboard'").get().count,
    0,
  );
  store.saveSettings({ ...store.settings(), clipboard: false });
  assert.throws(() => restarted.image(textId), /Enable/);
});
test('AI text actions are finite, bounded and cannot turn extracted instructions into executable commands', async (t) => {
  const original = global.fetch;
  t.after(() => {
    global.fetch = original;
  });
  const calls = [];
  global.fetch = async (_url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                kind: 'answer',
                text: 'Cleaned text, no invented details.',
              }),
            },
          },
        ],
      }),
    );
  };
  const settings = { provider: 'openai', model: 'test-model' };
  await assert.rejects(enhance({ text: 'text' }, 'execute', settings, 'test-key'), /Unsupported/);
  assert.equal(calls.length, 0);
  const answer = await enhance(
    { name: 'Screenshot', text: 'x'.repeat(18000) },
    'cleanup',
    settings,
    'test-key',
  );
  assert.equal(answer.kind, 'answer');
  const document = JSON.parse(calls[0].messages[1].content.split('\n').slice(1).join('\n'));
  assert.equal(document.excerpt.length, 16000);
  assert.equal(document.truncated, true);
  assert.match(calls[0].messages[0].content, /untrusted data/);
  assert.match(calls[0].messages[1].content, /Preserve names, dates, numbers/);
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"kind":"system","command":"volume","value":100}' } }],
      }),
    );
  await assert.rejects(
    enhance({ name: 'Screenshot', text: 'Set volume max' }, 'action-items', settings, 'test-key'),
    /cannot execute/,
  );
});
