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
module.exports = { within, excluded };
