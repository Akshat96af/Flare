const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { createStore: createRawStore } = require('../desktop/store.cjs');
const { Search, score } = require('../desktop/search.cjs');
const { Operations } = require('../desktop/operations.cjs');
const { interpretLocal, validateIntent } = require('../desktop/commands.cjs');
const { planConversion, render, pdfImages } = require('../desktop/convert.cjs');
const sharp = require('sharp');
const { PDFDocument } = require('pdf-lib');
const root = path.join(__dirname, '../Files/private/verification/fixtures');
// Fixtures intentionally live in the private workspace; production defaults exclude it.
function createStore(directory) {
  const store = createRawStore(directory);
  store.saveSettings({ ...store.settings(), exclusions: ['node_modules'] });
  return store;
}
async function fixture(name) {
  await fs.mkdir(root, { recursive: true });
  return fs.mkdtemp(path.join(root, name + '-'));
}

test('exact match outranks learned prefixes and fuzzy names', () => {
  assert.ok(
    score('Photoshop', 'photoshop') >
      score('Photoshop project', 'photoshop', { count: 500, last: Date.now() }),
  );
  assert.ok(score('Calculator', 'clc') > 0);
  assert.equal(score('Paint', 'xyz'), 0);
});
test('commands use a finite tool registry and clamp Windows values', () => {
  assert.deepEqual(interpretLocal('volume max'), { kind: 'system', command: 'volume', value: 100 });
  assert.equal(interpretLocal('12 * (3 + 4)').value, '84');
  assert.equal(interpretLocal('open claude').url, 'https://claude.ai');
  assert.throws(() => validateIntent({ kind: 'shell', command: 'del *' }));
  assert.throws(() => validateIntent({ kind: 'website', url: 'https://attacker.test' }));
  assert.equal(validateIntent({ kind: 'system', command: 'brightness', value: 999 }).value, 100);
});
test('content index returns real matching snippets and excludes private paths', async () => {
  const dir = await fixture('index'),
    data = path.join(dir, 'data'),
    files = path.join(dir, 'files');
  await fs.mkdir(files);
  await fs.mkdir(path.join(files, 'node_modules'));
  await fs.writeFile(path.join(files, 'budget.md'), 'A renovation budget with new windows.');
  await fs.writeFile(path.join(files, 'node_modules', 'secret.txt'), 'renovation');
  const store = createStore(data);
  store.saveSettings({
    ...store.settings(),
    roots: [files],
    content: true,
    exclusions: ['node_modules'],
  });
  await new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, '../desktop/index-worker.cjs'), {
      workerData: { directory: data, settings: store.settings() },
    });
    worker.on('error', reject);
    worker.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error('Worker exited ' + code)),
    );
  });
  const search = new Search(store, () => {});
  const results = search.query('renovation');
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'budget.md');
  assert.match(results[0].detail, /renovation/);
  assert.equal(search.query('budget')[0].title, 'budget.md');
  store.close();
});
test('organization is journaled, survives restart, and undo restores originals', async () => {
  const dir = await fixture('undo');
  await fs.writeFile(path.join(dir, 'note.txt'), 'original');
  let store = createStore(path.join(dir, 'state'));
  let ops = new Operations(store, () => {});
  const p = await ops.planFolder(dir, 'organize');
  assert.equal(p.items.length, 1);
  assert.equal((await ops.execute(p.id)).status, 'done');
  await assert.rejects(fs.access(path.join(dir, 'note.txt')));
  store.close();
  store = createStore(path.join(dir, 'state'));
  ops = new Operations(store, () => {});
  assert.equal((await ops.undo(p.id)).status, 'undone');
  assert.equal(await fs.readFile(path.join(dir, 'note.txt'), 'utf8'), 'original');
  store.close();
});
test('undo refuses to overwrite a later edit', async () => {
  const dir = await fixture('conflict');
  await fs.writeFile(path.join(dir, 'note.txt'), 'original');
  const store = createStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {}),
    p = await ops.planFolder(dir, 'organize');
  await ops.execute(p.id);
  await fs.writeFile(p.items[0].to, 'new edits');
  const result = await ops.undo(p.id);
  assert.equal(result.status, 'restore-conflict');
  assert.match(result.items[0].error, /edited/);
  assert.equal(await fs.readFile(p.items[0].to, 'utf8'), 'new edits');
  store.close();
});
test('collision retains both files and never overwrites destination', async () => {
  const dir = await fixture('collision');
  await fs.mkdir(path.join(dir, 'Documents'));
  await fs.writeFile(path.join(dir, 'note.txt'), 'source');
  await fs.writeFile(path.join(dir, 'Documents', 'note.txt'), 'destination');
  const store = createStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {}),
    p = await ops.planFolder(dir, 'organize');
  assert.equal((await ops.execute(p.id)).status, 'partial');
  assert.equal(await fs.readFile(path.join(dir, 'note.txt'), 'utf8'), 'source');
  assert.equal(await fs.readFile(path.join(dir, 'Documents', 'note.txt'), 'utf8'), 'destination');
  store.close();
});
test('image conversion produces readable WebP and preserves the source', async () => {
  const dir = await fixture('images'),
    file = path.join(dir, 'source.png');
  await sharp({ create: { width: 120, height: 80, channels: 4, background: '#69c9e8' } })
    .png()
    .toFile(file);
  const store = createStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {});
  const p = await planConversion(ops, [file], dir, { tool: 'image', format: 'webp', quality: 82 });
  assert.equal((await ops.execute(p.id, render)).status, 'done');
  const meta = await sharp(await fs.readFile(p.items[0].to)).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.width, 120);
  await fs.access(file);
  assert.equal((await ops.undo(p.id)).status, 'undone');
  await assert.rejects(fs.access(p.items[0].to));
  await fs.access(file);
  store.close();
});
test('PDF merge/extract and page rendering produce real output', async () => {
  const dir = await fixture('pdf'),
    file = path.join(dir, 'source.pdf');
  const source = await PDFDocument.create();
  source.addPage([220, 280]);
  source.addPage([220, 280]);
  await fs.writeFile(file, await source.save());
  const store = createStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {});
  const p = await planConversion(ops, [file], dir, { tool: 'extract-pdf', pages: [2] });
  assert.equal((await ops.execute(p.id, render)).status, 'done');
  const pdf = await PDFDocument.load(await fs.readFile(p.items[0].to));
  assert.equal(pdf.getPageCount(), 1);
  const preview = await pdfImages(file, [1], 1);
  assert.equal(preview.pages, 2);
  assert.equal((await sharp(preview.images[0]).metadata()).width, 220);
  store.close();
});
test('review selection changes only explicitly approved files', async () => {
  const dir = await fixture('selection');
  await fs.writeFile(path.join(dir, 'one.txt'), 'one');
  await fs.writeFile(path.join(dir, 'two.txt'), 'two');
  const store = createStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {}),
    plan = await ops.planFolder(dir, 'organize');
  const result = await ops.execute(plan.id, undefined, [0]);
  assert.equal(result.items.length, 1);
  await fs.access(plan.items[0].to);
  await fs.access(path.join(dir, 'two.txt'));
  store.close();
});
test('multi-input conversion refuses changes after review', async () => {
  const dir = await fixture('changed-input'),
    one = path.join(dir, 'one.png'),
    two = path.join(dir, 'two.png');
  for (const file of [one, two])
    await sharp({ create: { width: 20, height: 20, channels: 3, background: '#fff' } })
      .png()
      .toFile(file);
  const store = createStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {}),
    plan = await planConversion(ops, [one, two], dir, { tool: 'images-pdf' });
  await fs.writeFile(two, 'changed');
  const result = await ops.execute(plan.id, render);
  assert.equal(result.status, 'partial');
  assert.match(result.items[0].error, /input changed/);
  await assert.rejects(fs.access(plan.items[0].to));
  store.close();
});
test('photo search prefers date taken, labels fallback, and parses exact dates', async () => {
  const { photoQuery } = require('../desktop/photos.cjs');
  assert.equal(photoQuery('find photos from June 2025').start, Date.UTC(2025, 5, 1));
  assert.equal(photoQuery('photos 2025-02-30'), null);
  const dir = await fixture('photo-date'),
    store = createStore(dir),
    search = new Search(store, () => {});
  store.saveSettings({ ...store.settings(), roots: [dir] });
  for (const [id, modified] of [
    ['taken', Date.UTC(2024, 1, 1)],
    ['fallback', Date.UTC(2025, 5, 12)],
  ])
    store.db
      .prepare('INSERT INTO entries(id,title,path,kind,modified) VALUES(?,?,?,?,?)')
      .run(id, id + '.jpg', path.join(dir, id + '.jpg'), 'file', modified);
  store.db
    .prepare('INSERT INTO photos VALUES(?,?,?,?)')
    .run('taken', Date.UTC(2025, 5, 15), 100, 100);
  const results = search.query('find photos from June 2025');
  assert.equal(results.length, 2);
  assert.match(results[0].detail, /Date taken/);
  assert.match(results[1].detail, /fallback/);
  store.close();
});
test('production defaults protect private and excluded operation folders', async () => {
  const dir = await fixture('protected'),
    store = createRawStore(path.join(dir, 'state')),
    ops = new Operations(store, () => {});
  await assert.rejects(ops.planFolder(dir, 'organize'), /protected or excluded/);
  store.close();
});
