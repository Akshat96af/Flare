const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createCanvas } = require('@napi-rs/canvas');
const { PDFDocument } = require('pdf-lib');
const { fileActions } = require('../desktop/file-actions.cjs');
const { createRecognizer, readOcr } = require('../desktop/ocr.cjs');
const { OfflineWhisper, download, digest } = require('../desktop/offline-whisper.cjs');
const { createStore } = require('../desktop/store.cjs');
const { Search } = require('../desktop/search.cjs');
const { Operations } = require('../desktop/operations.cjs');
const { planConversion, render } = require('../desktop/convert.cjs');
async function fixture() {
  const root = path.resolve('Files/private/verification/local-features');
  await fs.mkdir(root, { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, 'case-'));
  const canvas = createCanvas(1000, 220), context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, 1000, 220);
  context.fillStyle = '#000'; context.font = '40px Arial';
  context.fillText('FLARE INVOICE 82741', 45, 110);
  const image = path.join(directory, 'receipt.png');
  await fs.writeFile(image, canvas.toBuffer('image/png'));
  return { directory, image };
}
test('context actions match file formats without inventing unsupported operations', () => {
  assert.ok(fileActions('image.png').some((x) => x.id === 'resize'));
  assert.ok(fileActions('scan.pdf').some((x) => x.id === 'ocr'));
  assert.ok(fileActions('document.docx').some((x) => x.id === 'summary'));
  assert.ok(!fileActions('app.exe').some((x) => x.id === 'ocr' || x.tool));
});
test('local OCR reads image pixels and scanned PDF pages with bounded excerpts', async () => {
  const { directory, image } = await fixture();
  const recognizer = createRecognizer();
  try {
    const result = await readOcr(image, (await fs.stat(image)).size, { recognizer });
    assert.match(result.text, /FLARE INVOICE 82741/);
    const pdf = await PDFDocument.create(), bitmap = await pdf.embedPng(await fs.readFile(image));
    for (let i = 0; i < 2; i++) pdf.addPage([1000, 220]).drawImage(bitmap, { x: 0, y: 0, width: 1000, height: 220 });
    const file = path.join(directory, 'scan.pdf'); await fs.writeFile(file, await pdf.save());
    const scan = await readOcr(file, (await fs.stat(file)).size, { recognizer, maxPages: 1 });
    assert.match(scan.text, /82741/); assert.equal(scan.truncated, true);
    await assert.rejects(readOcr(image, 13 * 1024 * 1024, { recognizer }), /below 12 MB/);
  } finally { await recognizer.close(); }
});
test('OCR indexing respects folder permission and purges text immediately when disabled', async () => {
  const { directory, image } = await fixture();
  const store = createStore(path.join(directory, 'data'));
  const settings = { ...store.settings(), roots: [directory], allDrives: false, contentRoots: [], exclusions: ['data'], ocr: true };
  const index = async (settings) => {
    store.saveSettings(settings);
    const worker = new Worker(path.resolve('desktop/index-worker.cjs'), { workerData: { directory: store.directory, settings, force: true } });
    await new Promise((resolve, reject) => { worker.on('message', (value) => { if (value.state === 'ready') resolve(); if (value.state === 'error') reject(new Error(value.current)); }); worker.on('error', reject); });
    await worker.terminate();
  };
  try {
    await index(settings);
    assert.equal(store.db.prepare('SELECT content FROM entries WHERE path=?').get(image).content, '');
    await index({ ...settings, contentRoots: [directory] });
    const search = new Search(store, () => {});
    assert.ok(search.query('82741', 'file').some((item) => item.path === image));
    store.saveSettings({ ...store.settings(), ocr: false });
    assert.ok(!search.query('82741', 'file').some((item) => item.path === image));
    search.close();
  } finally { store.close(); }
});
test('image resizing creates a reviewed copy and undo preserves the source', async () => {
  const { directory, image } = await fixture();
  const store = createStore(path.join(directory, 'data'));
  try {
    const ops = new Operations(store, () => {});
    const before = await digest(image);
    const plan = await planConversion(ops, [image], directory, { tool: 'resize', format: 'png', quality: 90, width: 500 });
    await ops.execute(plan.id, render);
    assert.equal((await require('sharp')(plan.items[0].to).metadata()).width, 500);
    await ops.undo(plan.id);
    assert.equal(await digest(image), before);
  } finally { store.close(); }
});
test('offline voice rejects arbitrary models, missing consent and malformed audio before execution', async () => {
  const { directory } = await fixture();
  const voice = new OfflineWhisper(directory);
  assert.throws(() => voice.model('../../evil'), /supported/);
  await assert.rejects(voice.install('tiny.en', false), /Confirm/);
  await assert.rejects(voice.transcribe([1, 2], 'tiny.en', new AbortController().signal), /Invalid voice/);
});
test('a declined installer component never triggers a background model download', async () => {
  const { directory } = await fixture();
  const voice = new OfflineWhisper(directory, () => {}, path.join(directory, 'missing-components'));
  const previous = global.fetch;
  global.fetch = async () => { throw new Error('Unexpected network request'); };
  try { await assert.rejects(voice.install('tiny.en', true), /Flare Setup/); }
  finally { global.fetch = previous; }
});
test('download integrity rejects wrong bytes even when the size matches', async () => {
  const { directory } = await fixture(); const previous = global.fetch;
  global.fetch = async () => new Response(Buffer.from('bad'));
  try {
    await assert.rejects(download({ url: 'https://example.invalid', size: 3, sha256: '0'.repeat(64) }, path.join(directory, 'part'), new AbortController().signal, () => {}), /checksum/);
  } finally { global.fetch = previous; }
});
