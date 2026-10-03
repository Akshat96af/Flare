const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { createReadStream, constants } = require('node:fs');
const { imageExtensions } = require('./search.cjs');
const { unsafeFile,moveNative } = require('./native.cjs');
const { excluded } = require('./scope.cjs');
async function fingerprint(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
async function unlinkRetry(file) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fs.unlink(file);
    } catch (error) {
      if (!['EBUSY', 'EPERM'].includes(error.code) || attempt === 4) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
}
async function moveSafe(from, to, expected) {
  await fs.mkdir(path.dirname(to), { recursive: true });
  if(expected&&await fingerprint(from)!==expected)throw new Error('Source changed before moving.');
  if(moveNative(from,to))return;
  // Exclusive copy prevents races from overwriting files, including across drives.
  await fs.copyFile(from, to, constants.COPYFILE_EXCL);
  const source = await fingerprint(from),
    copy = await fingerprint(to);
  if (source !== copy || (expected && source !== expected))
    throw new Error('Copied file verification failed. Original retained.');
  await unlinkRetry(from);
}
function category(name) {
  const ext = path.extname(name).toLowerCase();
  return imageExtensions.has(ext)
    ? 'Images'
    : ['.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.md'].includes(ext)
      ? 'Documents'
      : ['.mp4', '.mov', '.mkv'].includes(ext)
        ? 'Videos'
        : ['.mp3', '.wav', '.flac'].includes(ext)
          ? 'Audio'
          : ['.zip', '.7z', '.rar'].includes(ext)
            ? 'Archives'
            : 'Other';
}
class Operations {
  constructor(store, emit) {
    this.store = store;
    this.emit = emit;
    this.plans = new Map();
    this.running = false;
    this.cancel = false;
  }
  async planFolder(folder, type, mode = 'type') {
    const base = await fs.realpath(folder);
    const list = await fs.readdir(base, { withFileTypes: true });
    const items = [];
    if (unsafeFile(base) || excluded(base, this.store.settings().exclusions))
      throw new Error('Choose a personal folder, not a protected or excluded location.');
    const id = crypto.randomUUID();
    for (const entry of list) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const from = path.join(base, entry.name),
        stat = await fs.lstat(from);
      if (
        stat.isSymbolicLink() ||
        unsafeFile(from) ||
        excluded(from, this.store.settings().exclusions)
      )
        continue;
      if (type === 'cleanup' && stat.mtimeMs > Date.now() - 90 * 86400000) continue;
      let dir = category(entry.name);
      if (mode === 'month') {
        const date = new Date(stat.mtimeMs);
        dir = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
      }
      const to =
        type === 'cleanup'
          ? path.join(this.store.directory, 'recovery', id, entry.name)
          : path.join(base, dir, entry.name);
      items.push({
        from,
        to,
        size: stat.size,
        modified: stat.mtimeMs,
        status: 'pending',
        parent: await fs.realpath(path.dirname(to)).catch(() => path.dirname(to)),
        reason:
          type === 'cleanup'
            ? 'Modified more than 90 days ago; review whether you still need it.'
            : mode === 'month'
              ? 'Grouped by file modification month.'
              : 'Grouped by file type.',
      });
      if (items.length >= 500) break;
    }
    const plan = {
      id,
      type,
      title: type === 'cleanup' ? 'Review cleanup candidates' : 'Organize ' + path.basename(base),
      created: Date.now(),
      status: 'preview',
      folder: base,
      items,
    };
    this.plans.set(id, plan);
    return plan;
  }
  createOutputPlan(title, items, type = 'convert') {
    const p = {
      id: crypto.randomUUID(),
      type,
      title,
      created: Date.now(),
      status: 'preview',
      items,
    };
    this.plans.set(p.id, p);
    return p;
  }
  async execute(id, render, selection) {
    if (this.running) throw new Error('An operation is already running.');
    const plan = this.plans.get(id);
    if (!plan) throw new Error('This preview expired. Please create a new preview.');
    if (selection !== undefined) {
      if (
        !Array.isArray(selection) ||
        !selection.length ||
        selection.some((x) => !Number.isInteger(x) || x < 0 || x >= plan.items.length) ||
        new Set(selection).size !== selection.length
      )
        throw new Error('Select at least one valid file.');
      plan.items = plan.items.filter((_, i) => selection.includes(i));
    }
    if(!plan.items.length)throw new Error('No files selected.');
    const budget=new Map();for(const item of plan.items){let directory=path.dirname(item.to);while(!await exists(directory)){const parent=path.dirname(directory);if(parent===directory)throw new Error('Output drive is unavailable.');directory=parent;}const volume=path.parse(directory).root;budget.set(volume,{directory,bytes:(budget.get(volume)?.bytes||0)+(plan.type==='convert'?Math.max(item.size*4,16*1024*1024):item.size)});}
    for(const value of budget.values()){const stats=await fs.statfs(value.directory);if(stats.bavail*stats.bsize<value.bytes+64*1024*1024)throw new Error('Not enough free space for this operation and recovery.');}
    this.plans.delete(id);
    this.running = true;
    this.cancel = false;
    plan.status = 'running';
    this.store.putOperation(plan);
    try {
      for (const item of plan.items) {
        if (this.cancel) {
          plan.status = 'canceled';
          break;
        }
        try {
          if (await exists(item.to))
            throw new Error('Destination already exists. Nothing was overwritten.');
          const stat = await fs.lstat(item.from);
          if (!stat.isFile() || stat.isSymbolicLink())
            throw new Error('Source is no longer a regular file.');
          if (unsafeFile(item.from))
            throw new Error('Source is a protected, linked, or cloud-only file.');
          if (
            item.modified !== undefined &&
            (stat.mtimeMs !== item.modified || stat.size !== item.size)
          )
            throw new Error('Source changed since the preview.');
          for (const [i, file] of (plan.inputs || []).entries())
            if (unsafeFile(file) || (await fingerprint(file)) !== plan.inputHashes[i])
              throw new Error('An input changed since the preview. Create a new preview.');
          await fs.mkdir(path.dirname(item.to), { recursive: true });
          if (
            unsafeFile(path.dirname(item.to)) ||
            (item.parent &&
              path.resolve(await fs.realpath(path.dirname(item.to))) !== path.resolve(item.parent))
          )
            throw new Error('Output folder changed or contains a link.');
          item.before = await fingerprint(item.from);
          item.status = 'started';
          this.store.putOperation(plan);
          if (plan.type === 'convert') {
            item.temporary = item.to + '.pending-' + plan.id;
            this.store.putOperation(plan);
            const output = { ...item, to: item.temporary };
            try {
              await render(output, plan);
              for (const [i, file] of plan.inputs.entries())
                if ((await fingerprint(file)) !== plan.inputHashes[i])
                  throw new Error('An input changed during conversion. Output discarded.');
              item.after = await fingerprint(item.temporary);
              this.store.putOperation(plan);
              await fs.copyFile(item.temporary, item.to, constants.COPYFILE_EXCL);
              item.outputSize = (await fs.stat(item.to)).size;
            } finally {
              await unlinkRetry(item.temporary).catch(() => {});
            }
          } else await moveSafe(item.from, item.to, item.before);
          item.after = await fingerprint(item.to);
          item.status = 'done';
        } catch (error) {
          item.status = item.status === 'started' && (await exists(item.to)) ? 'started' : 'failed';
          item.error = error.message;
        }
        this.store.putOperation(plan);
        this.emit('operation', plan);
      }
      if (plan.status === 'running')
        plan.status = plan.items.some((x) => x.status === 'failed' || x.status === 'started')
          ? 'partial'
          : 'done';
      return plan;
    } finally {
      this.running = false;
      this.store.putOperation(plan);
      this.emit('operation', plan);
    }
  }
  async undo(id) {
    if (this.running) throw new Error('Wait for the current operation to finish.');
    const p = this.store.operation(id);
    if (!p) throw new Error('Operation not found.');
    this.running = true;
    try {
      for (const item of [...p.items].reverse()) {
        if (!['done', 'started'].includes(item.status)) continue;
        try {
          if (!(await exists(item.to))) throw new Error('Recovery file is missing.');
          const after = await fingerprint(item.to);
          if (item.after && after !== item.after)
            throw new Error('Destination was edited after this operation. Restore skipped.');
          if (!item.after && after !== item.before)
            throw new Error('Interrupted copy is incomplete. Original retained.');
          if (p.type === 'convert') {
            await unlinkRetry(item.to);
          } else {
            if (await exists(item.from)) {
              if (item.status === 'started' && (await fingerprint(item.from)) === after) {
                await unlinkRetry(item.to);
              } else throw new Error('Original location is occupied. Restore skipped.');
            } else await moveSafe(item.to, item.from, after);
          }
          item.status = 'undone';
          delete item.error;
        } catch (error) {
          item.error = error.message;
        }
        this.store.putOperation(p);
        this.emit('operation', p);
      }
      p.status = p.items.some((x) => ['done', 'started'].includes(x.status))
        ? 'restore-conflict'
        : 'undone';
      this.store.putOperation(p);
      return p;
    } finally {
      this.running = false;
    }
  }
  history() {
    return this.store.operations();
  }
}
module.exports = { Operations, fingerprint, moveSafe, category };
