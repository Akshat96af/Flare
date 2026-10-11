const crypto = require('node:crypto');
const MAX_IMAGE = 12 * 1024 * 1024;
const MAX_MEMORY = 32 * 1024 * 1024;
const LIFETIME = 7 * 86400000;
class ClipboardHistory {
  constructor(store, put, notify = () => {}) {
    this.store = store;
    this.put = put;
    this.notify = notify;
    this.images = new Map();
    this.last = '';
    // Screenshot bytes are session-only; never leave stale entries after restart.
    store.db
      .prepare("DELETE FROM entries WHERE kind='clipboard' AND id LIKE 'clip:%:image:%'")
      .run();
    this.prune();
  }
  prune(now = Date.now()) {
    this.store.db
      .prepare(
        "DELETE FROM entries WHERE kind='clipboard' AND (CAST(substr(id,6) AS INTEGER)<? OR id NOT IN (SELECT id FROM entries WHERE kind='clipboard' ORDER BY id DESC LIMIT 50))",
      )
      .run(now - LIFETIME);
    const ids = new Set(
      this.store.db
        .prepare("SELECT id FROM entries WHERE kind='clipboard'")
        .all()
        .map((x) => x.id),
    );
    for (const id of this.images.keys()) if (!ids.has(id)) this.images.delete(id);
  }
  clear() {
    this.images.clear();
    this.last = '';
    this.store.db.prepare("DELETE FROM entries WHERE kind='clipboard'").run();
    this.notify();
  }
  image(id) {
    if (!this.store.settings().clipboard) throw new Error('Enable clipboard history first.');
    this.prune();
    const image = this.images.get(id);
    if (!image) throw new Error('This screenshot expired or was cleared. Copy it again.');
    return image;
  }
  capture(clipboard, now = Date.now()) {
    if (!this.store.settings().clipboard) return;
    this.prune(now);
    if (
      clipboard.has('ExcludeClipboardContentFromMonitorProcessing') ||
      (clipboard.has('CanIncludeInClipboardHistory') &&
        clipboard.readBuffer('CanIncludeInClipboardHistory').every((x) => x === 0))
    )
      return;
    const image = clipboard.readImage();
    let bytes, size, text;
    if (!image.isEmpty()) {
      size = image.getSize();
      if (!size.width || !size.height || size.width * size.height > 20000000) return;
      bytes = image.toPNG();
      if (!bytes.length || bytes.length > MAX_IMAGE) return;
    } else {
      text = clipboard.readText();
      if (!text || text.length > 20000) return;
    }
    const hash = crypto
      .createHash('sha256')
      .update(bytes || text)
      .digest('hex');
    if (hash === this.last) return;
    this.last = hash;
    const id = 'clip:' + now + (bytes ? ':image:' : ':text:') + crypto.randomUUID();
    if (bytes) {
      while (
        [...this.images.values()].reduce((sum, item) => sum + item.bytes.length, 0) + bytes.length >
        MAX_MEMORY
      ) {
        const oldest = this.images.keys().next().value;
        this.images.delete(oldest);
        this.store.db.prepare('DELETE FROM entries WHERE id=?').run(oldest);
      }
      const title = 'Screenshot ' + new Date(now).toLocaleString();
      const scale = Math.min(1, 48 / size.width, 48 / size.height);
      this.images.set(id, {
        bytes,
        size,
        title,
        icon:
          'data:image/png;base64,' +
          image
            .resize({
              width: Math.max(1, Math.round(size.width * scale)),
              height: Math.max(1, Math.round(size.height * scale)),
            })
            .toPNG()
            .toString('base64'),
      });
      this.put({
        id,
        title,
        path: 'clipboard-image:' + id,
        kind: 'clipboard',
        detail: `Screenshot / ${size.width} x ${size.height} / session only`,
      });
    } else {
      this.put({
        id,
        title: text.replace(/\s+/g, ' ').slice(0, 90),
        path: text,
        kind: 'clipboard',
        detail: 'Clipboard',
      });
    }
    this.prune(now);
    this.notify();
    return id;
  }
  decorate(item) {
    const image = this.images.get(item.id);
    return image ? { ...item, clipboardImage: true, icon: image.icon } : item;
  }
}
module.exports = { ClipboardHistory, MAX_IMAGE, MAX_MEMORY };
