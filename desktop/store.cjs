const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { purgeContent } = require('./scope.cjs');
const { DatabaseSync } = require('node:sqlite');

const defaults = {
  theme: 'system',
  glass: true,
  shortcut: 'Alt+Space',
  voiceMode: 'auto',
  startup: false,
  clipboard: false,
  trust: 'cautious',
  developer: false,
  content: true,
  setup: false,
  roots: [],
  allDrives: true,
  driveRoots: [],
  driveVolumes: {},
  contentRoots: [],
  trustedRoots: [],
  exclusions: [
    'node_modules',
    '.git',
    'Windows',
    'Program Files',
    'Program Files (x86)',
    'AppData',
    '$Recycle.Bin',
    'System Volume Information',
    '.ssh',
    '.aws',
    '.cargo',
    '.cache',
    'Files/private',
  ],
  ai: {
    provider: 'off',
    model: '',
    speechCloud: false,
    speechMode: 'fallback',
    speechModel: '',
    localModel: '',
  },
  recoveryDays: 0,
  confirmConversions: true,
};

function createStore(directory, { machine = os.hostname() + '|' + os.homedir() } = {}) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'flare.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT,modified REAL,size REAL,content TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS entries_kind ON entries(kind);
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(id UNINDEXED,title,content);
    CREATE VIRTUAL TABLE IF NOT EXISTS name_fts USING fts5(id UNINDEXED,title,path);
    CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,count INTEGER DEFAULT 0,last REAL);
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,taken REAL,width INTEGER,height INTEGER);
  `);
  const get = (key, fallback) => {
    const row = db.prepare('SELECT value FROM preferences WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const set = (key, value) =>
    db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run(key, JSON.stringify(value));
  if (get('permission-machine', '') !== machine) {
    const saved = get('settings', {});
    set('settings', {
      ...saved,
      contentRoots: [],
      trustedRoots: [],
      driveRoots: [],
      driveVolumes: {},
    });
    db.exec(
      "DELETE FROM content_fts; DELETE FROM photos; DELETE FROM name_fts; DELETE FROM entries WHERE kind IN ('file','folder')",
    );
    set('permission-machine', machine);
  }
  if (get('name-index-version', 0) !== 1) {
    db.exec(
      'DELETE FROM name_fts; INSERT INTO name_fts(id,title,path) SELECT id,title,path FROM entries',
    );
    set('name-index-version', 1);
  }
  return {
    db,
    directory,
    get,
    set,
    settings: () => ({
      ...defaults,
      ...get('settings', {}),
      ai: { ...defaults.ai, ...get('settings', {}).ai },
    }),
    saveSettings: (value) => {
      const previous = get('settings', {});
      set('settings', value);
      if (
        [
          'content',
          'roots',
          'exclusions',
          'allDrives',
          'driveRoots',
          'contentRoots',
          'trustedRoots',
        ].some((key) => JSON.stringify(previous[key]) !== JSON.stringify(value[key]))
      )
        purgeContent(db, { ...defaults, ...value });
    },
    putOperation: (value) =>
      db
        .prepare('INSERT OR REPLACE INTO operations VALUES(?,?)')
        .run(value.id, JSON.stringify(value)),
    operations: () =>
      db
        .prepare('SELECT data FROM operations ORDER BY rowid DESC LIMIT 100')
        .all()
        .map((row) => JSON.parse(row.data)),
    operation: (id) => {
      const row = db.prepare('SELECT data FROM operations WHERE id=?').get(id);
      return row ? JSON.parse(row.data) : null;
    },
    touch: (id) =>
      db
        .prepare(
          'INSERT INTO usage VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1,last=excluded.last',
        )
        .run(id, Date.now()),
    close: () => db.close(),
  };
}
module.exports = { createStore, defaults };
