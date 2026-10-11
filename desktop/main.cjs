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
const { createHold } = require('./shortcut.cjs');
const { QuickShare } = require('./share.cjs');
const { openService, googleFallbackTarget } = require('./services.cjs');
const { resolveMusic, openTrack } = require('./music.cjs');
const { randomUUID } = require('node:crypto');
const { FilePermissions } = require('./permissions.cjs');
const { OfflineWhisper } = require('./offline-whisper.cjs');
const { searchRoots, within, excluded } = require('./scope.cjs');
const tracks = new Map();
const external = {
  hasProtocol: (url) => !!app.getApplicationNameForProtocol(url),
  openExternal: (url) => shell.openExternal(url),
  requestPlayback: (track) =>
    powershell(
      'media',
      {
        action: 'play',
        service: track.service,
        title: track.title,
        artist: track.artist,
        waitMs: 6000,
      },
      12000,
    ),
};

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
  voiceRequest,
  holding,
  aiRequest,
  sharing,
  permissions,
  offlineVoice,
  fileRequest,
  ocrWorker,
  driveTimer,
  openingTimer,
  activationId = 0,
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
function show(mode = 'search') {
  if (mode !== 'settings') mode = 'search';
  position();
  const ticket = ++activationId;
  clearTimeout(openingTimer);
  const animate = !win.isVisible();
  send('activation', {
    mode,
    ticket,
    animate,
    contentHeight: Math.max(
      100,
      Math.min(560, screen.getDisplayMatching(win.getBounds()).workArea.height - 340),
    ),
  });
  openingTimer = setTimeout(() => {
    if (ticket !== activationId || win.isDestroyed()) return;
    win.show();
    win.focus();
    send('shown', { animate: false });
  }, 1200);
}
function register(shortcut) {
  globalShortcut.unregisterAll();
  if (holding) {
    clearInterval(holding.timer);
    holding = null;
  }
  const ok = globalShortcut.register(shortcut, () => {
    if (holding) return;
    show();
    const start = Date.now();
    const hold = createHold(store.settings().voiceMode);
    holding = {
      hold,
      timer: setInterval(() => {
        for (const event of hold.advance(chordHeld(shortcut), Date.now() - start))
          send(event.event, event.data);
        if (hold.done) {
          clearInterval(holding.timer);
          holding = null;
        }
      }, 40),
    };
  });
  shortcutError = ok ? '' : 'Shortcut is already in use. Choose another in Settings.';
  return ok;
}
function hideLauncher() {
  activationId++;
  clearTimeout(openingTimer);
  permissions?.clear();
  tracks.clear();
  holding?.hold.cancel();
  send('hold', { progress: 0 });
  stopVoice(true);
  aiRequest?.abort();
  fileRequest?.abort();
  send('dismiss', {});
  win.hide();
}
function stopVoice(cancel = false) {
  if (cancel) voiceRequest?.abort();
  if (!voice) return;
  if (cancel) {
    voice.kill();
    voice = null;
  } else voice.stdin.end('\n');
}
async function localVoice(bytes) {
  stopVoice(true);
  const controller = new AbortController();
  voiceRequest = controller;
  if (store.settings().speechEngine === 'whisper') {
    try {
      return await offlineVoice.transcribe(bytes, store.settings().whisperModel, controller.signal);
    } finally {
      if (voiceRequest === controller) voiceRequest = null;
    }
  }
  const directory = await fs.mkdtemp(path.join(app.getPath('temp'), 'flare-speech-'));
  const file = path.join(directory, 'recording.wav');
  try {
    const audio = require('./speech-audio.cjs').validatedWav(bytes);
    await fs.writeFile(file, audio);
    controller.signal.throwIfAborted();
    return await new Promise((resolve, reject) => {
      const child = spawn(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          scriptPath('speech.ps1'),
          '-AudioFile',
          file,
          ...(store.settings().voiceMode === 'push' ? ['-PushToTalk'] : []),
        ],
        { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
      );
      voice = child;
      const abort = () => child.kill();
      controller.signal.addEventListener('abort', abort, { once: true });
      let out = '',
        err = '';
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill();
      }, 35000);
      let notified = false;
      child.stdout.on('data', (x) => {
        out += x;
        if (!notified && out.includes('FLARE_SPEECH_READY')) {
          notified = true;
          if (voice === child) send('voice-ready', {});
        }
      });
      child.stderr.on('data', (x) => (err += x));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        controller.signal.removeEventListener('abort', abort);
        clearTimeout(timer);
        if (voice === child) voice = null;
        if (code !== 0)
          return reject(
            new Error(
              timedOut
                ? 'Voice recognition timed out.'
                : err.trim().slice(0, 300) || 'Local speech stopped.',
            ),
          );
        try {
          resolve(JSON.parse(out.replace('FLARE_SPEECH_READY', '').trim()).text || '');
        } catch {
          reject(new Error('Local speech returned no transcript.'));
        }
      });
    });
  } finally {
    if (voiceRequest === controller) voiceRequest = null;
    await fs.rm(directory, { recursive: true, force: true });
  }
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
  const file = await approvedFile(id);
  const { stat } = await permissions.validate(file);
  if (!stat.isFile() || stat.size > 100 * 1024 * 1024)
    throw new Error('This preview is unavailable.');
  const result = {
    id,
    contentAllowed: permissions.allows(file),
    name: path.basename(file),
    path: file,
    size: stat.size,
    modified: stat.mtimeMs,
    created: stat.birthtimeMs,
    type: path.extname(file).slice(1).toUpperCase(),
  };
  if (!result.contentAllowed) return result;
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
async function readFileText(id) {
  const file = await approvedFile(id);
  fileRequest?.abort();
  const controller = new AbortController();
  fileRequest = controller;
  const generation = permissions.generation;
  try {
    const checked = await permissions.request(file);
    controller.signal.throwIfAborted();
    if (generation !== permissions.generation) throw new Error('File access changed. Try again.');
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, 'ocr-worker.cjs'), {
        workerData: { file: checked.file, size: checked.stat.size },
      });
      ocrWorker = worker;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', abort);
        if (ocrWorker === worker) ocrWorker = null;
        worker.terminate();
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(new Error('Text reading cancelled.'));
      const timer = setTimeout(
        () => finish(new Error('Text reading took too long. Try a smaller file.')),
        120000,
      );
      controller.signal.addEventListener('abort', abort, { once: true });
      worker.on('message', (value) => {
        if (value.progress) send('ocr-progress', { id, ...value.progress });
        else finish(value.error ? new Error(value.error) : null, value.result);
      });
      worker.on('error', (error) => finish(error));
      worker.on('exit', () => {
        if (!settled) finish(new Error('Text reading stopped.'));
      });
    });
    controller.signal.throwIfAborted();
    if (generation !== permissions.generation)
      throw new Error('File access changed. Nothing was saved.');
    return { id, name: path.basename(file), ...result };
  } finally {
    if (fileRequest === controller) fileRequest = null;
  }
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
      detail:
        intent.kind === 'calculator'
          ? 'Calculator'
          : intent.kind === 'system'
            ? `${intent.command === 'brightness' ? 'Brightness' : 'Volume'} ${intent.value}%`
            : 'Built-in command',
      intent,
    });
  const results = list.slice(0, 30);
  const missing = [
    ...new Set(results.filter((x) => x.kind === 'app' && !icons.has(x.path)).map((x) => x.path)),
  ];
  if (missing.length) {
    const pending = (async () => {
      const found = await powershell('app-icons', { paths: missing }).catch(() => []);
      return new Map(
        found
          .filter((x) => x.icon?.startsWith('data:image/png;base64,'))
          .map((x) => [x.path, x.icon]),
      );
    })();
    for (const file of missing)
      icons.set(
        file,
        pending.then((found) => found.get(file) || ''),
      );
    while (icons.size > 512) icons.delete(icons.keys().next().value);
  }
  return Promise.all(
    results.map(async (item) => {
      if (item.kind === 'app') {
        try {
          item.icon = await icons.get(item.path);
          if (!item.icon && !item.path.startsWith('shell:'))
            item.icon = (await app.getFileIcon(item.path, { size: 'normal' })).toDataURL();
        } catch {}
      }
      return item;
    }),
  );
}
async function executeIntent(intent) {
  if (intent.kind === 'content-search') {
    const [folder] = await pick('folder');
    if (!folder) return { intent: { kind: 'answer', text: 'Content search cancelled.' } };
    const settings = await grantFolder(folder, 'content');
    if (!require('./scope.cjs').contentAllowed(folder, settings))
      return {
        intent: { kind: 'answer', text: 'Folder access was not granted. Names remain searchable.' },
      };
    return { intent: { kind: 'search', query: intent.query } };
  }
  if (intent.kind === 'media') {
    const result = await powershell('media', { action: intent.action, service: intent.service });
    if (!result.ok) throw new Error(result.message || 'No controllable music player is active.');
    return { message: result.message || 'Playback updated' };
  }
  if (intent.kind === 'service') {
    const result = await openService(intent, external);
    hideLauncher();
    return result;
  }
  if (intent.kind === 'launch') {
    const normalize = (value) =>
      value
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, '');
    const aliases = { vscode: 'visualstudiocode', chrome: 'googlechrome', edge: 'microsoftedge' };
    const name = aliases[normalize(intent.query)] || normalize(intent.query);
    const apps = store.db.prepare("SELECT id,title FROM entries WHERE kind='app'").all();
    const matchedName = require('./commands.cjs').correctKeyword(
      name,
      apps.map((item) => normalize(item.title)),
    );
    const matches = apps.filter((item) => name && normalize(item.title) === matchedName);
    if (matches.length === 1) return dispatch('open', { id: matches[0].id });
    const site = require('./search.cjs').websites.find(([title]) => normalize(title) === name);
    if (!matches.length && site)
      return executeIntent({ kind: 'website', url: site[1], title: site[0] });
    return {
      intent: matches.length ? { kind: 'search', query: intent.query } : { kind: 'fallback' },
    };
  }
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
    hideLauncher();
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
  for (const key of [
    'startup',
    'clipboard',
    'developer',
    'content',
    'setup',
    'confirmConversions',
    'glass',
    'allDrives',
    'ocr',
    'smartActions',
  ])
    if (patch[key] !== undefined) {
      if (typeof patch[key] !== 'boolean') throw new Error('Invalid setting.');
      next[key] = patch[key];
    }
  if (patch.speechEngine !== undefined) {
    if (!['windows', 'whisper'].includes(patch.speechEngine))
      throw new Error('Invalid voice engine.');
    next.speechEngine = patch.speechEngine;
  }
  if (patch.whisperModel !== undefined) {
    offlineVoice.model(patch.whisperModel);
    next.whisperModel = patch.whisperModel;
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
  for (const key of ['contentRoots', 'trustedRoots']) {
    if (patch[key] === undefined) continue;
    if (!Array.isArray(patch[key]) || patch[key].some((root) => !current[key].includes(root)))
      throw new Error('Grant folder access through its permission dialog.');
    next[key] = patch[key];
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
  const scopeChanged = [
    'roots',
    'content',
    'exclusions',
    'allDrives',
    'contentRoots',
    'trustedRoots',
    'ocr',
  ].some((key) => JSON.stringify(next[key]) !== JSON.stringify(current[key]));
  if (scopeChanged) {
    await search.stop();
    permissions.clear();
    aiRequest?.abort();
    fileRequest?.abort();
    search.nativeCache.clear();
  }
  store.saveSettings(next);
  if (next.clipboard !== current.clipboard && !next.clipboard)
    store.db.prepare("DELETE FROM entries WHERE kind='clipboard'").run();
  if (scopeChanged) {
    await search.stop();
    if (!next.content) {
      store.db.exec("DELETE FROM content_fts; UPDATE entries SET content='' WHERE kind='file'");
    }
    search.start(true);
  }
  return next;
}
async function refreshDrives() {
  if (process.platform !== 'win32') return;
  const found = await powershell('drives');
  const roots = (Array.isArray(found) ? found : found ? [found] : [])
    .map((item) => item.path)
    .filter((root) => typeof root === 'string' && /^[A-Z]:\\$/i.test(root));
  const current = store.settings();
  const volumes = Object.fromEntries(
    (Array.isArray(found) ? found : found ? [found] : []).map((item) => [
      item.path,
      item.volume || '',
    ]),
  );
  if (
    JSON.stringify(roots) === JSON.stringify(current.driveRoots) &&
    JSON.stringify(volumes) === JSON.stringify(current.driveVolumes)
  )
    return;
  const changed = Object.keys(current.driveVolumes).filter(
    (root) => current.driveVolumes[root] !== volumes[root],
  );
  await search.stop();
  permissions.clear();
  aiRequest?.abort();
  fileRequest?.abort();
  search.nativeCache.clear();
  store.saveSettings({
    ...current,
    driveRoots: roots,
    driveVolumes: volumes,
    contentRoots: current.contentRoots.filter(
      (folder) => !changed.some((root) => within(folder, root)),
    ),
    trustedRoots: current.trustedRoots.filter(
      (folder) => !changed.some((root) => within(folder, root)),
    ),
  });
  send('settings', store.settings());
  if (current.setup || !isolated) search.start();
}
async function grantFolder(folder, level) {
  if (!['names', 'content', 'assistant'].includes(level)) throw new Error('Invalid folder access.');
  const real = await fs.realpath(folder);
  const settings = store.settings();
  if (
    (!searchRoots(settings).some((root) => within(real, root)) && !granted.has(real)) ||
    !(await fs.stat(real)).isDirectory() ||
    require('./native.cjs').unsafeFile(real) ||
    excluded(real, settings.exclusions)
  )
    throw new Error('Choose a personal folder from search or the folder picker.');
  if (level !== 'names') {
    const generation = permissions.generation;
    const response = await dialog.showMessageBox(win, {
      type: 'question',
      title: 'Folder access',
      message:
        level === 'assistant'
          ? 'Allow assistant access to this folder?'
          : 'Allow local content search?',
      detail:
        real +
        '\n\n' +
        (level === 'assistant'
          ? 'Flare can search and preview contents, send selected documents to your AI provider, and prepare file tasks. Changes still require review. Excluded and protected files stay blocked.'
          : 'Flare can read and index contents locally. Sending a document to an online AI still asks separately.'),
      buttons: ['Cancel', 'Allow folder'],
      defaultId: 0,
      cancelId: 0,
    });
    if (response.response !== 1 || permissions.generation !== generation) return store.settings();
  }
  if (
    level === 'names' &&
    [...settings.contentRoots, ...settings.trustedRoots].some(
      (root) => root !== real && within(real, root),
    )
  )
    throw new Error('Remove the parent folder permission first.');
  await search.stop();
  permissions.clear();
  aiRequest?.abort();
  const next = {
    ...settings,
    roots: searchRoots(settings).some((root) => within(real, root))
      ? settings.roots
      : [...new Set([...settings.roots, real])],
    setup: true,
    contentRoots: settings.contentRoots.filter((root) =>
      level === 'names' ? !within(root, real) : root !== real,
    ),
    trustedRoots: settings.trustedRoots.filter((root) =>
      level === 'names' ? !within(root, real) : root !== real,
    ),
  };
  if (level === 'content') next.contentRoots.push(real);
  if (level === 'assistant') next.trustedRoots.push(real);
  store.saveSettings(next);
  search.start(true);
  send('settings', next);
  return next;
}
async function summarize(id) {
  const file = await approvedFile(id);
  const selected = store.settings().ai;
  if (selected.provider === 'off')
    throw new Error('Connect an AI model in Intelligence settings first.');
  aiRequest?.abort();
  const controller = new AbortController();
  aiRequest = controller;
  try {
    const checked = await permissions.request(file, selected.provider !== 'local');
    controller.signal.throwIfAborted();
    if (checked.stat.size > 12 * 1024 * 1024) throw new Error('Choose a document below 12 MB.');
    const metadata = {};
    let text = await require('./extract.cjs').extract(checked.file, checked.stat.size, metadata);
    if (!text.trim() && path.extname(file).toLowerCase() === '.pdf') {
      const result = await readFileText(id);
      text = result.text;
      metadata.truncated = result.truncated;
    }
    controller.signal.throwIfAborted();
    if (!text.trim())
      throw new Error('No readable text found. Scanned PDFs need OCR before summarizing.');
    return await ai.plan(
      'Summarize the document, including key points, decisions and any action items. Say when the excerpt is incomplete.',
      selected,
      secret(selected.provider),
      controller.signal,
      {
        document: {
          name: path.basename(file),
          text: text.slice(0, 48000),
          truncated: !!metadata.truncated || text.length > 48000,
        },
      },
    );
  } finally {
    if (aiRequest === controller) aiRequest = null;
  }
}
async function dispatch(method, data = {}) {
  switch (method) {
    case 'launcher-ready': {
      if (data.ticket !== activationId) return false;
      clearTimeout(openingTimer);
      await dispatch('resize', { height: data.height });
      position();
      win.show();
      win.focus();
      send('shown', { animate: !!data.animate });
      return true;
    }
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
    case 'web-fallback': {
      await shell.openExternal(googleFallbackTarget(data.query));
      hideLauncher();
      return { message: 'Opened your original request in Google' };
    }
    case 'open': {
      if (data.id?.startsWith('track:')) {
        const track = tracks.get(data.id);
        tracks.delete(data.id);
        if (!track || track.expires < Date.now())
          throw new Error('This song link expired. Ask again.');
        const result = await openTrack(track, external);
        hideLauncher();
        return result;
      }
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
      hideLauncher();
      return { message: 'Opened ' + item.title };
    }
    case 'preview':
      return preview(data.id);
    case 'file-permission': {
      const file = await approvedFile(data.id);
      if (data.level && data.level !== 'once') await grantFolder(path.dirname(file), data.level);
      else await permissions.request(file);
      return preview(data.id);
    }
    case 'folder-permission':
      return grantFolder(data.folder, data.level);
    case 'document-summary':
      return summarize(data.id);
    case 'file-actions': {
      const file = await approvedFile(data.id);
      await permissions.validate(file);
      const actions = require('./file-actions.cjs').fileActions(file);
      return await require('./ocr.cjs').available() ? actions : actions.filter((action) => action.id !== 'ocr');
    }
    case 'file-ocr':
      return readFileText(data.id);
    case 'file-ocr-cancel':
      fileRequest?.abort();
      return true;
    case 'document-find': {
      const text = require('./commands.cjs').validateIntent({
        kind: 'document',
        query: data.query,
      }).query;
      const results = (await search.queryAsync(text, 'file')).filter(
        (item) => item.kind === 'file' && /\.(txt|md|pdf|docx|pptx|xlsx|csv)$/i.test(item.path),
      );
      if (results.length === 1) return summarize(results[0].id);
      return { kind: 'search', query: text };
    }
    case 'result-action': {
      const item = search.get(data.id);
      if (!item || !['file', 'folder', 'app'].includes(item.kind) || item.path.startsWith('shell:'))
        throw new Error('Choose a local file or folder first.');
      if (data.action === 'copy-path') {
        clipboard.writeText(item.path);
        return { message: 'Path copied' };
      }
      if (data.action === 'reveal') {
        await fs.access(item.path);
        shell.showItemInFolder(item.path);
        return { message: 'Shown in File Explorer' };
      }
      throw new Error('Unsupported file action.');
    }
    case 'share-pick': {
      if (sharing.status().active) throw new Error('Stop sharing before choosing another file.');
      if (data.id) {
        const item = search.get(data.id);
        if (!item || item.kind !== 'file') throw new Error('Choose a file in Flare first.');
        return sharing.select(item.path);
      }
      const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
      return result.canceled ? null : sharing.select(result.filePaths[0]);
    }
    case 'share-start': {
      if (data.confirm !== true) throw new Error('Confirm sharing on your trusted network first.');
      const status = await sharing.start(data.id, data.address);
      return {
        ...status,
        qrDataUrl: await require('qrcode').toDataURL(status.url, { width: 192, margin: 2 }),
      };
    }
    case 'share-status': {
      const status = sharing.status();
      return status.active
        ? {
            ...status,
            qrDataUrl: await require('qrcode').toDataURL(status.url, { width: 192, margin: 2 }),
          }
        : status;
    }
    case 'share-copy': {
      const status = sharing.status();
      if (!status.active) throw new Error('The share has expired.');
      clipboard.writeText(status.url);
      return true;
    }
    case 'share-stop':
      return sharing.stop();
    case 'pick':
      return pick(data.kind);
    case 'drives': {
      await refreshDrives();
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
    case 'model-catalog':
      return ai.catalogue(data.provider, data.key || secret(data.provider));
    case 'ai-test': {
      if (data.confirm !== true) throw new Error('Confirm this short API test first.');
      aiRequest?.abort();
      const controller = new AbortController();
      aiRequest = controller;
      const started = Date.now();
      try {
        await ai.plan(
          'Reply with the answer Ready. Do not perform an action.',
          { provider: data.provider, model: data.model },
          data.key || secret(data.provider),
          controller.signal,
          { retries: 0 },
        );
        return { model: data.model, elapsedMs: Date.now() - started };
      } finally {
        if (aiRequest === controller) aiRequest = null;
      }
    }
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
        !['off', 'openai', 'gemini', 'anthropic', 'local', 'openrouter', 'groq'].includes(
          data.provider,
        ) ||
        typeof data.model !== 'string' ||
        data.model.length > 150
      )
        throw new Error('Choose a valid provider and model.');
      const model = data.provider === 'off' ? '' : ai.normalizeModel(data.provider, data.model);
      const key =
        data.provider === 'off' || data.provider === 'local'
          ? ''
          : ai.credentials(data.provider, data.key?.trim() || secret(data.provider));
      const prefs = store.settings();
      const speechMode = data.speechMode ?? 'fallback';
      if (!['fallback', 'online'].includes(speechMode))
        throw new Error('Choose a valid voice mode.');
      const speechModel = data.speechModel
        ? ai.normalizeModel(data.provider, data.speechModel)
        : '';
      if (
        data.provider === 'openai' &&
        speechModel &&
        !['whisper-1', 'gpt-4o-transcribe', 'gpt-4o-mini-transcribe'].includes(speechModel)
      )
        throw new Error('Choose a supported speech model.');
      if (
        data.provider === 'groq' &&
        speechModel &&
        !['whisper-large-v3', 'whisper-large-v3-turbo'].includes(speechModel)
      )
        throw new Error('Choose a supported Whisper model.');
      if (data.key && key) {
        if (!safeStorage.isEncryptionAvailable())
          throw new Error('Windows credential encryption is unavailable.');
        store.set('key:' + data.provider, safeStorage.encryptString(key).toString('base64'));
      }
      prefs.ai = {
        provider: data.provider,
        model,
        speechCloud: ['gemini', 'openai', 'groq'].includes(data.provider) && !!data.speechCloud,
        speechMode,
        speechModel,
      };
      store.saveSettings(prefs);
      return prefs;
    }
    case 'ai-plan': {
      const settings = store.settings().ai;
      aiRequest?.abort();
      const controller = new AbortController();
      aiRequest = controller;
      try {
        const local = interpretLocal(data.query);
        if (
          local &&
          [
            'music',
            'service',
            'launch',
            'system',
            'tool',
            'document',
            'media',
            'search',
            'content-search',
          ].includes(local.kind)
        )
          return local;
        return await ai.plan(data.query, settings, secret(settings.provider), controller.signal);
      } finally {
        if (aiRequest === controller) aiRequest = null;
      }
    }
    case 'voice-submit': {
      const intent = interpretLocal(data.query);
      if (intent) return intent;
      if (store.settings().ai.provider !== 'off') return dispatch('ai-plan', data);
      if (typeof data.query !== 'string' || data.query.length > 500)
        throw new Error('Keep voice commands short.');
      return { kind: 'search', query: data.query };
    }
    case 'ai-cancel':
      aiRequest?.abort();
      tracks.clear();
      return true;
    case 'music-resolve': {
      const intent = require('./commands.cjs').validateIntent(data);
      if (intent.kind !== 'music') throw new Error('Choose a song first.');
      aiRequest?.abort();
      const controller = new AbortController();
      aiRequest = controller;
      tracks.clear();
      try {
        const track = await resolveMusic(intent, controller.signal);
        controller.signal.throwIfAborted();
        if (track.kind === 'answer') return track;
        const id = 'track:' + randomUUID();
        tracks.set(id, { ...track, expires: Date.now() + 60000 });
        return { kind: 'track', id };
      } finally {
        if (aiRequest === controller) aiRequest = null;
      }
    }
    case 'tool-plan': {
      if (['organize', 'cleanup'].includes(data.tool)) {
        if (
          !granted.has(data.folder) &&
          !require('./scope.cjs').assistantAllowed(data.folder, store.settings())
        )
          throw new Error('Choose or trust a folder first.');
        return operations.planFolder(data.folder, data.tool, data.mode);
      }
      const files = [];
      for (const file of data.files || []) {
        const approved = await approvedFile(file);
        files.push((await permissions.request(approved)).file);
      }
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
    case 'voice-recorded':
      return localVoice(data.bytes);
    case 'voice-start':
      throw new Error('Record microphone audio before recognition.');
    case 'offline-voice-info':
      return offlineVoice.info();
    case 'ocr-info':
      return { available: await require('./ocr.cjs').available() };
    case 'offline-voice-install':
      return offlineVoice.install(data.model, data.confirm);
    case 'offline-voice-cancel':
      offlineVoice.cancel();
      return true;
    case 'voice-status': {
      if (store.settings().speechEngine === 'whisper') {
        const info = await offlineVoice.info();
        return {
          available: info.models.some(
            (model) => model.id === store.settings().whisperModel && model.ready,
          ),
          engine: 'whisper',
        };
      }
      return powershell('speech-capabilities');
    }
    case 'voice-stop':
      stopVoice();
      return true;
    case 'voice-cancel':
      stopVoice(true);
      return true;
    case 'voice-transcribe': {
      if (store.settings().speechEngine === 'whisper')
        throw new Error('Offline voice never uploads recordings.');
      voiceRequest?.abort();
      const controller = new AbortController();
      voiceRequest = controller;
      try {
        return await ai.transcribe(
          data.bytes,
          data.mime,
          store.settings().ai,
          secret(store.settings().ai.provider),
          controller.signal,
        );
      } finally {
        if (voiceRequest === controller) voiceRequest = null;
      }
    }
    case 'hide':
      hideLauncher();
      return true;
    case 'resize': {
      const work = screen.getDisplayMatching(win.getBounds()).workArea;
      const height = Math.round(
        Math.max(130, Math.min(Number(data.height) || 150, work.height - 140, 800)),
      );
      const bounds = win.getBounds();
      if (bounds.height !== height) {
        // Fixed Windows windows otherwise retain their previous minimum height.
        win.setResizable(true);
        win.setSize(bounds.width, height);
        win.setResizable(false);
      }
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
    permissions = new FilePermissions(store, (options) => dialog.showMessageBox(win, options));
    offlineVoice = new OfflineWhisper(
      store.directory,
      send,
      app.isPackaged
        ? path.join(process.resourcesPath, 'optional/voice')
        : path.join(__dirname, '../Files/private/setup-payload/voice'),
    );
    if (app.isPackaged) {
      try {
        const choices = await fs.readFile(
          path.join(process.resourcesPath, 'optional/installed.json'),
          'utf8',
        );
        const selected = JSON.parse(choices);
        if (store.get('setup-components-applied', '') !== choices) {
          store.saveSettings({
            ...store.settings(),
            smartActions: selected.actions === true,
            ocr: selected.ocr === true,
            speechEngine: selected.voice === true ? 'whisper' : 'windows',
            whisperModel: selected.model === 'tiny.en' ? 'tiny.en' : 'base.en',
          });
          store.set('setup-components-applied', choices);
        }
      } catch {
        /* Portable builds keep optional features off until explicitly enabled. */
      }
    }
    operations = new Operations(store, send);
    sharing = new QuickShare((status) => {
      send('share', { active: status.active, downloads: status.downloads });
      tray?.setToolTip(status.active ? 'Flare - Quick Share active' : 'Flare');
    });
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
        backgroundThrottling: false,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        hideLauncher();
      }
    });
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
            show('settings');
          },
        },
        { type: 'separator' },
        { label: 'Stop Quick Share', click: () => sharing.stop() },
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
        hideLauncher();
      }
    });
    nativeTheme.on('updated', () => send('theme', { dark: nativeTheme.shouldUseDarkColors }));
    await search.apps();
    await search.bookmarks();
    if (!isolated) {
      await refreshDrives().catch(() => {});
      store.saveSettings({ ...store.settings(), setup: true });
    }
    if (store.settings().setup) search.start();
    driveTimer = setInterval(() => {
      if (!isolated) refreshDrives().catch(() => {});
    }, 60000);
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
      fileRequest?.abort();
      offlineVoice?.cancel();
      ocrWorker?.terminate();
      aiRequest?.abort();
      sharing.stop();
      search.close();
      require('./local-model.cjs').cancel();
      conversionWorker?.terminate();
      if (holding) clearInterval(holding.timer);
      clearInterval(clipboardTimer);
      clearInterval(rescan);
      clearInterval(driveTimer);
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
