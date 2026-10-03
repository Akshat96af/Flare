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

test('glass preference defaults on for older settings and persists an explicit opt-out', async () => {
  const directory = await fixture('glass-preferences');
  let store = createRawStore(directory);
  store.saveSettings({ theme: 'dark' });
  assert.equal(store.settings().glass, true);
  store.saveSettings({ ...store.settings(), glass: false });
  store.db.close();
  store = createRawStore(directory);
  assert.equal(store.settings().glass, false);
  store.db.close();
});

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
async function officeZip(file, parts) {
  const { ZipFile } = require('yazl'),
    zip = new ZipFile();
  for (const [name, content] of Object.entries(parts)) zip.addBuffer(Buffer.from(content), name);
  zip.end();
  const chunks = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  await fs.writeFile(file, Buffer.concat(chunks));
}
test('Office and PDF content extraction reads format-aware fixtures', async () => {
  const dir = await fixture('office'),
    { extract } = require('../desktop/extract.cjs');
  const data = {
    'sample.docx': {
      '[Content_Types].xml':
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      'word/document.xml':
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Orchid renovation budget</w:t></w:r></w:p></w:body></w:document>',
    },
    'sample.xlsx': {
      'xl/sharedStrings.xml': '<sst><si><t>Orchid renovation budget</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<worksheet><sheetData><row><c><v>24000</v></c></row></sheetData></worksheet>',
    },
    'sample.pptx': {
      'ppt/slides/slide1.xml':
        '<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Orchid renovation budget</a:t></a:r></a:p></p:sld>',
    },
  };
  for (const [name, parts] of Object.entries(data)) {
    const file = path.join(dir, name);
    await officeZip(file, parts);
    assert.match(await extract(file, (await fs.stat(file)).size), /Orchid renovation budget/);
  }
  const pdf = await PDFDocument.create(),
    page = pdf.addPage();
  page.drawText('Orchid renovation budget');
  const file = path.join(dir, 'sample.pdf');
  await fs.writeFile(file, await pdf.save());
  assert.match(await extract(file, (await fs.stat(file)).size), /Orchid renovation budget/);
});
test('revoked search locations and disabled content take effect immediately', async () => {
  const dir = await fixture('revoked'),
    store = createStore(path.join(dir, 'state'));
  store.saveSettings({ ...store.settings(), roots: [dir] });
  const search = new Search(store, () => {});
  search.put({
    id: 'file:test',
    title: 'budget.md',
    path: path.join(dir, 'budget.md'),
    kind: 'file',
  });
  store.db.prepare('INSERT INTO content_fts VALUES(?,?,?)').run('file:test', 'budget.md', 'orchid');
  assert.equal(search.query('orchid').length, 1);
  store.saveSettings({ ...store.settings(), content: false });
  assert.equal(search.query('orchid').length, 0);
  store.saveSettings({ ...store.settings(), roots: [] });
  assert.equal(search.query('budget').length, 0);
  assert.equal(search.get('file:test'), null);
  store.close();
});
test('cloud audio uses binary bytes and rejects unapproved uploads', async () => {
  const ai = require('../desktop/ai.cjs'),
    original = global.fetch;
  let uploaded;
  global.fetch = async (_url, options) => {
    uploaded = options.body.get('file');
    return new Response(JSON.stringify({ text: 'open YouTube' }), { status: 200 });
  };
  try {
    await assert.rejects(
      ai.transcribe(
        [1, 2, 255],
        'audio/webm',
        { provider: 'openai', speechCloud: false },
        'fixture-key',
      ),
      /Enable online/,
    );
    assert.equal(
      await ai.transcribe(
        [1, 2, 255],
        'audio/webm',
        { provider: 'openai', speechCloud: true },
        'fixture-key',
      ),
      'open YouTube',
    );
    assert.deepEqual(Array.from(new Uint8Array(await uploaded.arrayBuffer())), [1, 2, 255]);
  } finally {
    global.fetch = original;
  }
});
test('background query worker returns ranked local results', async () => {
  const dir = await fixture('query-worker'),
    store = createStore(dir),
    search = new Search(store, () => {});
  search.put({ id: 'app:fixture', title: 'Orchid', path: 'fixture', kind: 'app' });
  try {
    assert.equal((await search.queryAsync('orchid', 'all'))[0].title, 'Orchid');
  } finally {
    search.close();
    store.close();
  }
});

test('an interrupted search rejects pending work and recovers with a new worker', async () => {
  const dir = await fixture('query-recovery'),
    store = createStore(dir);
  const search = new Search(store, () => {});
  search.put({ id: 'app:recovery', title: 'Recovery', path: 'fixture', kind: 'app' });
  try {
    const pending = search.queryAsync('recovery', 'all');
    const rejected = assert.rejects(pending, /Search restarted/);
    await search.queryWorker.terminate();
    await rejected;
    assert.equal(search.requests.size, 0);
    assert.equal(search.queryWorker, null);
    assert.equal((await search.queryAsync('recovery', 'all'))[0].title, 'Recovery');
  } finally {
    search.close();
    store.close();
  }
});
test('background query sees updated locations and newly indexed files', async () => {
  const dir = await fixture('worker-refresh'),
    store = createStore(path.join(dir, 'state')),
    search = new Search(store, () => {});
  try {
    assert.deepEqual(await search.queryAsync('studio-sample', 'all'), []);
    store.saveSettings({ ...store.settings(), roots: [dir], exclusions: ['node_modules'] });
    search.put({
      id: 'file:fixture',
      title: 'studio-sample.png',
      path: path.join(dir, 'studio-sample.png'),
      kind: 'file',
    });
    assert.equal((await search.queryAsync('studio-sample', 'all'))[0]?.title, 'studio-sample.png');
  } finally {
    search.close();
    store.close();
  }
});
