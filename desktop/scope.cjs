const path = require('node:path');
function within(file, root) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  return (
    relative === '' ||
    (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
  );
}
function excluded(file, exclusions) {
  const normalized = file.replace(/\\/g, '/').toLowerCase(),
    parts = normalized.split('/');
  return exclusions.some((value) => {
    const term = value.replace(/\\/g, '/').toLowerCase();
    return term.includes('/') ? normalized.includes(term) : parts.includes(term);
  });
}
function searchRoots(settings) {
  return [
    ...new Set([
      ...(settings.roots || []),
      ...(settings.allDrives ? settings.driveRoots || [] : []),
    ]),
  ];
}
function contentAllowed(file, settings) {
  return (
    !excluded(file, settings.exclusions || []) &&
    [...(settings.contentRoots || []), ...(settings.trustedRoots || [])].some((root) =>
      within(file, root),
    )
  );
}
function assistantAllowed(file, settings) {
  return (
    !excluded(file, settings.exclusions || []) &&
    (settings.trustedRoots || []).some((root) => within(file, root))
  );
}
function purgeContent(db, settings) {
  for (const item of db
    .prepare(
      "SELECT id,path FROM entries WHERE kind='file' AND (content!='' OR id IN (SELECT id FROM photos) OR id IN (SELECT id FROM content_fts))",
    )
    .all()) {
    if (
      settings.content &&
      contentAllowed(item.path, settings) &&
      searchRoots(settings).some((root) => within(item.path, root))
    )
      continue;
    db.prepare("UPDATE entries SET content='' WHERE id=? AND content!=''").run(item.id);
    db.prepare('DELETE FROM content_fts WHERE id=?').run(item.id);
    db.prepare('DELETE FROM photos WHERE id=?').run(item.id);
  }
}
module.exports = { within, excluded, searchRoots, contentAllowed, assistantAllowed, purgeContent };
