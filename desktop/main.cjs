const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  Tray,
  Menu,
  nativeImage,
  nativeTheme,
  shell,
  dialog,
  clipboard,
  safeStorage,
  session,
} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const { createStore } = require('./store.cjs');
const { Search, commonRoots } = require('./search.cjs');
const { Operations } = require('./operations.cjs');
const { interpretLocal } = require('./commands.cjs');
const { chordHeld, foregroundBounds, powershell, scriptPath } = require('./native.cjs');
const ai = require('./ai.cjs');

const isolated = process.env.FLARE_DATA_DIR;
const portable = process.argv.includes('--portable') || !!process.env.PORTABLE_EXECUTABLE_DIR;
if (isolated) app.setPath('userData', isolated);
else if (portable)
  app.setPath(
    'userData',
    path.join(process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')), 'FlareData'),
  );
if (!app.requestSingleInstanceLock()) app.quit();
let win,
  tray,
  store,
  search,
  operations,
  voice,
  holding,
  shortcutError = '',
  quitting = false,
  conversionWorker,
  ready = false;
const granted = new Set(),
  icons = new Map();
const send = (event, data) => {
  if (win && !win.isDestroyed()) win.webContents.send('flare:' + event, data);
};
const secret = (provider) => {
  const value = store.get('key:' + provider, null);
  if (!value) return '';
  try {
    return safeStorage.decryptString(Buffer.from(value, 'base64'));
  } catch {
    throw new Error('Reconnect your AI provider on this computer.');
  }
};
function position() {
  const previous = foregroundBounds();
  const display = previous
    ? screen.getDisplayMatching(previous)
    : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const work = display.workArea;
  win.setBounds({
    x: Math.round(work.x + (work.width - Math.min(760, work.width - 24)) / 2),
    y: work.y + Math.min(100, Math.round(work.height * 0.09)),
    width: Math.min(760, work.width - 24),
    height: Math.min(win.getBounds().height, work.height - 140),
  });
}
function show() {
  position();
  win.show();
  win.focus();
  send('activation', {
    mode: 'search',
    contentHeight: Math.max(
      100,
      Math.min(560, screen.getDisplayMatching(win.getBounds()).workArea.height - 340),
    ),
  });
}
function register(shortcut) {
  globalShortcut.unregisterAll();
  if (holding) {
    clearInterval(holding);
    holding = null;
  }
  let latch = false;
  const ok = globalShortcut.register(shortcut, () => {
    if (latch) return;
    latch = true;
    show();
    const start = Date.now();
    let listening = false;
    holding = setInterval(() => {
      const held = chordHeld(shortcut),
        elapsed = Date.now() - start;
      if (!held) {
        clearInterval(holding);
        holding = null;
        latch = false;
        send('hold', { progress: 0 });
        if (listening && store.settings().voiceMode === 'push') send('voice', { action: 'stop' });
        return;
      }
      if (!listening) {
        send('hold', { progress: Math.min(1, elapsed / 3000) });
        if (elapsed >= 3000) {
          listening = true;
          send('voice', { action: 'start' });
        }
      }
    }, 40);
  });
  shortcutError = ok ? '' : 'Shortcut is already in use. Choose another in Settings.';
  return ok;
}
function stopVoice(cancel = false) {
  if (!voice) return;
  if (cancel) {
    voice.kill();
    voice = null;
  } else voice.stdin.end('\n');
}
function localVoice() {
  stopVoice(true);
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        scriptPath('speech.ps1'),
        ...(store.settings().voiceMode === 'push' ? ['-PushToTalk'] : []),
      ],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    voice = child;
    let out = '',
      err = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Voice recognition timed out.'));
    }, 35000);
    child.stdout.on('data', (x) => (out += x));
    child.stderr.on('data', (x) => (err += x));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (voice === child) voice = null;
      if (code !== 0) return reject(new Error(err.trim().slice(0, 300) || 'Local speech stopped.'));
      try {
        resolve(JSON.parse(out.trim()).text || '');
      } catch {
        reject(new Error('Local speech returned no transcript.'));
      }
    });
  });
}
async function approvedFile(value) {
  const entry = search.get(value),
    file = entry?.path || value;
  if (!entry && !granted.has(file)) throw new Error('Select the file in Flare first.');
  if (entry && !['file', 'app'].includes(entry.kind))
    throw new Error('This item is not a local file.');
  return file;
}
async function pick(kind) {
  const result = await dialog.showOpenDialog(win, {
    properties: kind === 'folder' ? ['openDirectory'] : ['openFile', 'multiSelections'],
    filters:
      kind === 'images'
        ? [
            {
              name: 'Images',
              extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'tiff', 'bmp'],
            },
          ]
        : kind === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [],
  });
  const files = result.canceled ? [] : result.filePaths;
  for (const f of files) granted.add(await fs.realpath(f));
  return files;
}
async function preview(id) {
  const file = await approvedFile(id),
    stat = await fs.stat(file);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024)
    throw new Error('This preview is unavailable.');
  const result = {
    name: path.basename(file),
    path: file,
    size: stat.size,
    modified: stat.mtimeMs,
    created: stat.birthtimeMs,
    type: path.extname(file).slice(1).toUpperCase(),
  };
  if (/\.(jpg|jpeg|png|webp|avif|gif|tiff|bmp)$/i.test(file)) {
    const sharp = require('sharp'),
      bytes = await fs.readFile(file),
      meta = await require('./photos.cjs').photoMetadata(bytes);
    result.width = meta.width;
    result.height = meta.height;
    result.taken = meta.taken;
    result.image =
      'data:image/png;base64,' +
      (
        await sharp(bytes)
          .rotate()
          .resize(1000, 650, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer()
      ).toString('base64');
  } else if (/\.pdf$/i.test(file)) {
    const data = await require('./convert.cjs').pdfImages(file);
    result.image = 'data:image/png;base64,' + data.images[0].toString('base64');
    result.pages = data.pages;
  } else if (stat.size <= 2 * 1024 * 1024) {
    result.text = (await require('./extract.cjs').extract(file, stat.size)).slice(0, 14000);
  }
  return result;
}
async function query(q, kind) {
  if (typeof q !== 'string' || q.length > 500) throw new Error('Search is too long.');
  const intent = interpretLocal(q);
  let list = await search.queryAsync(intent?.kind === 'search' ? intent.query : q, kind);
  if (
    q.trim().length >= 3 &&
    ['all', 'file'].includes(kind) &&
    !intent &&
    !list.some((x) => x.kind === 'file') &&
    !require('./photos.cjs').photoQuery(q)
  ) {
    await search.nativeQuery(q);
    list = await search.queryAsync(q, kind);
  }
  if (intent && intent.kind !== 'search')
    list.unshift({
      id: 'command:' + q,
      title: intent.kind === 'calculator' ? intent.value : q,
      kind: 'command',
      detail: intent.kind === 'calculator' ? 'Calculator' : 'Built-in command',
      intent,
    });
  return Promise.all(
    list.slice(0, 30).map(async (item) => {
      if (item.kind === 'app' && !item.path.startsWith('shell:')) {
        try {
          if (!icons.has(item.path))
            icons.set(item.path, (await app.getFileIcon(item.path, { size: 'small' })).toDataURL());
          item.icon = icons.get(item.path);
        } catch {}
      }
      return item;
    }),
  );
}
async function executeIntent(intent) {
  if (intent.kind === 'system') {
    await powershell(intent.command, { value: intent.value });
    return { message: `${intent.command} set to ${intent.value}%` };
  }
  if (intent.kind === 'calculator') {
    clipboard.writeText(intent.value);
    return { message: 'Result copied' };
  }
  if (intent.kind === 'website') {
    await shell.openExternal(intent.url);
    win.hide();
    return { message: 'Opened ' + intent.title };
  }
  return { intent };
}
async function saveSettings(patch) {
  const current = store.settings(),
    next = { ...current };
  for (const key of ['theme', 'voiceMode', 'trust'])
    if (patch[key] !== undefined) {
      const values = {
        theme: ['system', 'light', 'dark'],
        voiceMode: ['auto', 'push'],
        trust: ['cautious', 'balanced', 'custom'],
      }[key];
      if (!values.includes(patch[key])) throw new Error('Invalid setting.');
      next[key] = patch[key];
    }
  for (const key of ['startup', 'clipboard', 'developer', 'content', 'setup', 'confirmConversions'])
    if (patch[key] !== undefined) {
      if (typeof patch[key] !== 'boolean') throw new Error('Invalid setting.');
      next[key] = patch[key];
    }
  if (patch.shortcut !== undefined) {
    if (
      typeof patch.shortcut !== 'string' ||
      !/^(Alt|Ctrl|Control|Shift|Super)(\+(Alt|Ctrl|Control|Shift|Super))*\+(Space|[A-Z0-9])$/.test(
        patch.shortcut,
      )
    )
      throw new Error('Use a modifier and Space or a letter, e.g. Alt+Space.');
    if (!register(patch.shortcut)) {
      register(current.shortcut);
      throw new Error('That shortcut is already in use.');
    }
    next.shortcut = patch.shortcut;
  }
  if (patch.roots) {
    if (!Array.isArray(patch.roots) || patch.roots.length > 26)
      throw new Error('Invalid search locations.');
    for (const root of patch.roots) {
      if (
        typeof root !== 'string' ||
        (!granted.has(root) && !current.roots.includes(root) && !commonRoots().includes(root))
      )
        throw new Error('Choose locations with the folder picker.');
    }
    next.roots = patch.roots;
  }
  if (patch.exclusions) {
    if (
      !Array.isArray(patch.exclusions) ||
      patch.exclusions.length > 100 ||
      patch.exclusions.some((x) => typeof x !== 'string' || x.length > 500)
    )
      throw new Error('Invalid exclusions.');
    next.exclusions = patch.exclusions;
  }
  if (next.startup !== current.startup) {
    if (portable) throw new Error('Startup registration is unavailable in portable mode.');
    app.setLoginItemSettings({ openAtLogin: next.startup, args: ['--background'] });
  }
  nativeTheme.themeSource = next.theme;
  store.saveSettings(next);
  if (next.clipboard !== current.clipboard && !next.clipboard)
    store.db.prepare("DELETE FROM entries WHERE kind='clipboard'").run();
  if (
    next.roots !== current.roots ||
    next.content !== current.content ||
    next.exclusions !== current.exclusions
  ) {
    await search.stop();
    if (!next.content) {
      store.db.exec("DELETE FROM content_fts; UPDATE entries SET content='' WHERE kind='file'");
    }
    search.start(next.content !== current.content && next.content);
  }
  return next;
}
async function dispatch(method, data = {}) {
  switch (method) {
    case 'snapshot':
      return {
        settings: store.settings(),
        index: search.status,
        count: search.count(),
        version: app.getVersion(),
        portable,
        shortcutError,
        ready,
        contentHeight: Math.max(
          100,
          Math.min(560, screen.getDisplayMatching(win.getBounds()).workArea.height - 340),
        ),
        dark: nativeTheme.shouldUseDarkColors,
        roots: commonRoots(),
      };
    case 'settings':
      return saveSettings(data);
    case 'search':
      return query(data.query, data.kind || 'all');
    case 'open': {
      if (data.intent) return executeIntent(require('./commands.cjs').validateIntent(data.intent));
      if (data.id?.startsWith('command:')) {
        const intent = interpretLocal(data.id.slice(8));
        if (!intent) throw new Error('Command unavailable.');
        return executeIntent(intent);
      }
      const item = search.get(data.id);
      if (!item) throw new Error('This result is no longer available.');
      search.store.touch(item.id);
      if (item.kind === 'clipboard') {
        clipboard.writeText(item.path);
        return { message: 'Copied to clipboard' };
      }
      if (['web', 'bookmark', 'setting'].includes(item.kind)) {
        if (!/^https?:\/\//i.test(item.path) && !item.path.startsWith('ms-settings:'))
          throw new Error('Unsupported link.');
        await shell.openExternal(item.path);
      } else if (item.kind === 'app' && item.path.startsWith('shell:AppsFolder\\')) {
        spawn('explorer.exe', [item.path], {
          windowsHide: true,
          detached: true,
          stdio: 'ignore',
        }).unref();
      } else {
        const error = await shell.openPath(item.path);
        if (error) throw new Error(error);
      }
      win.hide();
      return { message: 'Opened ' + item.title };
    }
    case 'preview':
      return preview(data.id);
    case 'pick':
      return pick(data.kind);
    case 'drives': {
      const drives = await powershell('drives');
      for (const d of drives) granted.add(d.path);
      return drives;
    }
    case 'index':
      if (data.action === 'pause') await search.stop();
      else search.start();
      return search.status;
    case 'clipboard-clear':
      store.db.prepare("DELETE FROM entries WHERE kind='clipboard'").run();
      return true;
    case 'models':
      return ai.models(data.provider, data.key || secret(data.provider));
    case 'local-info':
      return {
        ...require('./local-model.cjs').hardware(),
        catalogue: require('./local-model.cjs').catalogue,
      };
    case 'local-install':
      await shell.openExternal('https://ollama.com/download/windows');
      return true;
    case 'local-pull':
      return require('./local-model.cjs').pull(data.model, send);
    case 'local-cancel':
      require('./local-model.cjs').cancel();
      return true;
    case 'ai-save': {
      if (
        !['off', 'openai', 'gemini', 'anthropic', 'local'].includes(data.provider) ||
        typeof data.model !== 'string' ||
        data.model.length > 150
      )
        throw new Error('Choose a valid provider and model.');
      if (data.key) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('Windows credential encryption is unavailable.');
        store.set('key:' + data.provider, safeStorage.encryptString(data.key).toString('base64'));
      }
      const prefs = store.settings();
      prefs.ai = { provider: data.provider, model: data.model, speechCloud: !!data.speechCloud };
      store.saveSettings(prefs);
      return prefs;
    }
    case 'ai-plan': {
      const settings = store.settings().ai;
      return ai.plan(data.query, settings, secret(settings.provider));
    }
    case 'tool-plan': {
      if (['organize', 'cleanup'].includes(data.tool)) {
        if (!granted.has(data.folder)) throw new Error('Choose a folder first.');
        return operations.planFolder(data.folder, data.tool, data.mode);
      }
      const files = [];
      for (const file of data.files || []) files.push(await approvedFile(file));
      if (!granted.has(data.destination)) throw new Error('Choose an output folder first.');
      return require('./convert.cjs').planConversion(operations, files, data.destination, data);
    }
    case 'execute':
      return operations.execute(
        data.id,
        (item, plan) =>
          new Promise((resolve, reject) => {
            conversionWorker = new Worker(path.join(__dirname, 'conversion-worker.cjs'), {
              workerData: { item, plan },
            });
            const current = conversionWorker;
            const timer = setTimeout(() => {
              current.terminate();
              reject(new Error('Conversion timed out.'));
            }, 120000);
            current.on('message', (value) => {
              clearTimeout(timer);
              if (value.error) reject(new Error(value.error));
              else {
                item.outputSize = value.size;
                resolve();
              }
            });
            current.on('error', (e) => {
              clearTimeout(timer);
              reject(e);
            });
            current.on('exit', (code) => {
              clearTimeout(timer);
              if (conversionWorker === current) conversionWorker = null;
              if (code !== 0) reject(new Error('Conversion stopped.'));
            });
          }),
        data.selection,
      );
    case 'history':
      return operations.history();
    case 'undo':
      return operations.undo(
        data.id ||
          operations
            .history()
            .find((x) => x.items.some((i) => ['done', 'started'].includes(i.status)))?.id,
      );
    case 'cancel':
      operations.cancel = true;
      return true;
    case 'voice-start':
      return localVoice();
    case 'voice-status':
      return powershell('speech-capabilities');
    case 'voice-stop':
      stopVoice();
      return true;
    case 'voice-cancel':
      stopVoice(true);
      return true;
    case 'voice-transcribe':
      return ai.transcribe(
        data.bytes,
        data.mime,
        store.settings().ai,
        secret(store.settings().ai.provider),
      );
    case 'hide':
      stopVoice(true);
      win.hide();
      return true;
    case 'resize': {
      const work = screen.getDisplayMatching(win.getBounds()).workArea;
      const height = Math.round(
        Math.max(130, Math.min(Number(data.height) || 150, work.height - 140, 800)),
      );
      win.setSize(win.getBounds().width, height);
      return true;
    }
    case 'quit':
      quitting = true;
      app.quit();
      return true;
    default:
      throw new Error('Unsupported command.');
  }
}
app
  .whenReady()
  .then(async () => {
    store = createStore(app.getPath('userData'));
    search = new Search(store, send);
    operations = new Operations(store, send);
    nativeTheme.themeSource = store.settings().theme;
    win = new BrowserWindow({
      width: 760,
      height: 160,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      title: 'Flare',
      icon: path.join(__dirname, 'assets/flare.png'),
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    session.defaultSession.setPermissionRequestHandler((contents, permission, callback) =>
      callback(contents === win.webContents && permission === 'media'),
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission) => contents === win.webContents && permission === 'media',
    );
    ipcMain.handle('flare:call', async (event, method, data) => {
      if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
        throw new Error('Untrusted caller.');
      return dispatch(method, data);
    });
    if (process.env.FLARE_DEV_URL) await win.loadURL(process.env.FLARE_DEV_URL);
    else await win.loadFile(path.join(__dirname, '../dist/index.html'));
    register(store.settings().shortcut);
    const trayImage = nativeImage
      .createFromPath(path.join(__dirname, 'assets/flare.png'))
      .resize({ width: 20, height: 20 });
    tray = new Tray(trayImage);
    tray.setToolTip('Flare');
    tray.on('click', show);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Open Flare', click: show },
        {
          label: 'Settings',
          click: () => {
            show();
            send('activation', { mode: 'settings' });
          },
        },
        { type: 'separator' },
        {
          label: 'Quit',
          click: () => {
            quitting = true;
            app.quit();
          },
        },
      ]),
    );
    win.on('close', (event) => {
      if (!quitting) {
        event.preventDefault();
        win.hide();
      }
    });
    nativeTheme.on('updated', () => send('theme', { dark: nativeTheme.shouldUseDarkColors }));
    await search.apps();
    await search.bookmarks();
    if (store.settings().setup) search.start();
    if (!process.argv.includes('--background')) show();
    ready = true;
    let lastClipboard = '';
    const clipboardTimer = setInterval(() => {
      if (!store.settings().clipboard) return;
      const text = clipboard.readText();
      if (!text || text === lastClipboard || text.length > 20000) return;
      lastClipboard = text;
      if (
        clipboard.has('ExcludeClipboardContentFromMonitorProcessing') ||
        (clipboard.has('CanIncludeInClipboardHistory') &&
          clipboard.readBuffer('CanIncludeInClipboardHistory').every((x) => x === 0))
      )
        return;
      const id = 'clip:' + Date.now();
      search.put({
        id,
        title: text.replace(/\s+/g, ' ').slice(0, 90),
        path: text,
        kind: 'clipboard',
        detail: 'Clipboard',
      });
      store.db
        .prepare(
          "DELETE FROM entries WHERE kind='clipboard' AND (CAST(substr(id,6) AS INTEGER)<? OR id NOT IN (SELECT id FROM entries WHERE kind='clipboard' ORDER BY id DESC LIMIT 50))",
        )
        .run(Date.now() - 7 * 86400000);
    }, 1000);
    const rescan = setInterval(() => {
      if (store.settings().setup && !search.worker && search.status.state !== 'paused')
        search.start();
    }, 10 * 60000);
    app.on('before-quit', () => {
      quitting = true;
      stopVoice(true);
      search.close();
      require('./local-model.cjs').cancel();
      conversionWorker?.terminate();
      if (holding) clearInterval(holding);
      clearInterval(clipboardTimer);
      clearInterval(rescan);
      globalShortcut.unregisterAll();
    });
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
app.on('second-instance', () => {
  if (win) show();
});
app.on('window-all-closed', () => {
  if (quitting) app.quit();
});
