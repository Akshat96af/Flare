const fs = require('node:fs/promises');
const path = require('node:path');
const { unsafeFile } = require('./native.cjs');
const { contentAllowed, assistantAllowed, excluded } = require('./scope.cjs');

class FilePermissions {
  constructor(store, confirm) {
    this.store = store;
    this.confirm = confirm;
    this.readOnce = new Set();
    this.generation = 0;
  }
  clear() {
    this.generation++;
    this.readOnce.clear();
  }
  async validate(file) {
    const canonical = await fs.realpath(file);
    const stat = await fs.lstat(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      unsafeFile(file) ||
      canonical.toLowerCase() !== path.resolve(file).toLowerCase() ||
      path.basename(file).startsWith('.') ||
      excluded(canonical, this.store.settings().exclusions)
    )
      throw new Error(
        'This file is protected, linked or excluded. Choose a regular personal file.',
      );
    return { file: canonical, stat };
  }
  allows(file, cloud = false) {
    return cloud
      ? assistantAllowed(file, this.store.settings())
      : contentAllowed(file, this.store.settings()) || this.readOnce.has(file);
  }
  async request(file, cloud = false) {
    const checked = await this.validate(file);
    if (this.allows(checked.file, cloud)) return checked;
    const generation = this.generation;
    const allowed = await this.confirm({
      type: 'question',
      title: cloud ? 'Allow AI to read this document?' : 'Allow Flare to read this file?',
      message: path.basename(checked.file),
      detail:
        checked.file +
        '\n\n' +
        (cloud
          ? 'The text will be sent to your selected AI provider for this request. File instructions cannot run commands. No folder permission is saved.'
          : 'Allow local reading for this session. Other files remain names-only.'),
      buttons: ['Cancel', 'Allow this file'],
      defaultId: 0,
      cancelId: 0,
    });
    if (generation !== this.generation || allowed.response !== 1)
      throw new Error('File access cancelled. Nothing was read or uploaded.');
    this.readOnce.add(checked.file);
    return checked;
  }
}
module.exports = { FilePermissions };
