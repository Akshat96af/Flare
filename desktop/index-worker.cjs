const { workerData, parentPort } = require('node:worker_threads');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createStore } = require('./store.cjs');
const { extract } = require('./extract.cjs');
const { unsafeFile, fileAttributes } = require('./native.cjs');
const { excluded, searchRoots, contentAllowed } = require('./scope.cjs');
const { photoMetadata } = require('./photos.cjs');
const { imageExtensions } = require('./search.cjs');
const store = createStore(workerData.directory),
  settings = workerData.settings;
const seen = new Set();
let count = 0,
  failures = 0,
  lastEmit = 0;
const recognizer = settings.ocr ? require('./ocr.cjs').createRecognizer() : null;
async function walk(dir) {
  if (unsafeFile(dir) || excluded(dir, settings.exclusions)) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    failures++;
    return;
  }
  const folderId = 'folder:' + dir;
  seen.add(folderId);
  store.db
    .prepare('INSERT OR REPLACE INTO entries(id,title,path,kind,detail) VALUES(?,?,?,?,?)')
    .run(folderId, path.basename(dir) || dir, dir, 'folder', path.dirname(dir));
  for (const entry of entries) {
    if (
      entry.isSymbolicLink() ||
      entry.name.startsWith('.') ||
      excluded(path.join(dir, entry.name), settings.exclusions)
    )
      continue;
    const file = path.join(dir, entry.name);
    let stat;
    try {
      stat = await fs.lstat(file);
    } catch {
      continue;
    }
    // Reparse/offline cloud objects are not read for extraction.
    if (stat.isSymbolicLink() || unsafeFile(file)) continue;
    if (entry.isDirectory()) {
      await walk(file);
      continue;
    }
    if (!entry.isFile()) continue;
    const id = 'file:' + file;
    seen.add(id);
    const previous = store.db
      .prepare('SELECT rowid,modified,size,content FROM entries WHERE id=?')
      .get(id);
    const readContents = settings.content && contentAllowed(file, settings);
    if (
      workerData.force ||
      !previous ||
      previous.modified !== stat.mtimeMs ||
      previous.size !== stat.size ||
      (!readContents && previous.content) ||
      (readContents &&
        previous.content &&
        !store.db.prepare('SELECT rowid FROM content_fts WHERE rowid=?').get(previous.rowid))
    ) {
      let content = '',
        usedOcr = false;
      try {
        if (readContents && !(fileAttributes(file) & 0x2000)) {
          content = await extract(file, stat.size, { ocr: settings.ocr, recognizer });
          usedOcr =
            !!content && settings.ocr && imageExtensions.has(path.extname(file).toLowerCase());
          if (settings.ocr && !content.trim() && path.extname(file).toLowerCase() === '.pdf') {
            usedOcr = true;
            content = (
              await require('./ocr.cjs').readOcr(file, stat.size, { recognizer, maxPages: 10 })
            ).text;
          }
        }
      } catch {
        failures++;
      }
      store.db
        .prepare('INSERT OR REPLACE INTO entries VALUES(?,?,?,?,?,?,?,?)')
        .run(id, entry.name, file, 'file', path.dirname(file), stat.mtimeMs, stat.size, content);
      const rowid = store.db.prepare('SELECT rowid FROM entries WHERE id=?').get(id).rowid;
      if (usedOcr && content)
        store.db.prepare('INSERT OR REPLACE INTO ocr_entries VALUES(?)').run(id);
      store.db.prepare('DELETE FROM content_fts WHERE rowid=?').run(rowid);
      if (content)
        store.db
          .prepare('INSERT INTO content_fts(rowid,id,title,content) VALUES(?,?,?,?)')
          .run(rowid, id, entry.name, content);
      if (
        readContents &&
        imageExtensions.has(path.extname(file).toLowerCase()) &&
        stat.size < 100 * 1024 * 1024
      ) {
        try {
          const meta = await photoMetadata(file);
          store.db
            .prepare('INSERT OR REPLACE INTO photos VALUES(?,?,?,?)')
            .run(id, meta.taken, meta.width || null, meta.height || null);
        } catch {
          failures++;
        }
      }
    }
    count++;
    if (Date.now() - lastEmit > 300) {
      lastEmit = Date.now();
      parentPort.postMessage({ state: 'indexing', count, current: dir, failures });
    }
  }
}
(async () => {
  const roots = searchRoots(settings).filter(
    (root, i, all) =>
      !all.some(
        (other, j) =>
          j !== i &&
          require('./scope.cjs').within(root, other) &&
          (!require('./scope.cjs').within(other, root) || j < i),
      ),
  );
  for (const root of roots) await walk(root);
  // Sweep only entries in the current scope; disconnected drives retain no live results.
  const old = store.db.prepare("SELECT id FROM entries WHERE kind IN ('file','folder')").all();
  store.db.exec('BEGIN');
  for (const row of old)
    if (!seen.has(row.id)) {
      store.db.prepare('DELETE FROM entries WHERE id=?').run(row.id);
      store.db.prepare('DELETE FROM photos WHERE id=?').run(row.id);
    }
  store.db.exec('COMMIT');
  parentPort.postMessage({ state: 'ready', count, current: '', failures });
  await recognizer?.close();
  store.close();
})().catch(async (error) => {
  await recognizer?.close();
  parentPort.postMessage({ state: 'error', count, current: error.message, failures });
  store.close();
});
