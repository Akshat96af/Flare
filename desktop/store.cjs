const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const defaults = {
  theme: 'system', shortcut: 'Alt+Space', voiceMode: 'auto', startup: false,
  clipboard: false, trust: 'cautious', developer: false, content: true,
  setup: false, roots: [], exclusions: ['node_modules', '.git', 'Windows', 'Program Files', 'Program Files (x86)', 'AppData', '$Recycle.Bin', 'System Volume Information', '.ssh', '.aws', '.cargo', '.cache', 'Files/private'],
  ai: { provider: 'off', model: '', speechCloud: false, localModel: '' },
  recoveryDays: 0, confirmConversions: true
};

function createStore(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'flare.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY,title TEXT NOT NULL,path TEXT NOT NULL,kind TEXT NOT NULL,detail TEXT,modified REAL,size REAL,content TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS entries_kind ON entries(kind);
    CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(id UNINDEXED,title,content);
    CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY,count INTEGER DEFAULT 0,last REAL);
    CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,taken REAL,width INTEGER,height INTEGER);
  `);
  const get = (key, fallback) => {
    const row = db.prepare('SELECT value FROM preferences WHERE key=?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  };
  const set = (key, value) => db.prepare('INSERT OR REPLACE INTO preferences VALUES(?,?)').run(key, JSON.stringify(value));
  return {
    db, directory, get, set,
    settings: () => ({ ...defaults, ...get('settings', {}), ai: { ...defaults.ai, ...get('settings', {}).ai } }),
    saveSettings: value => set('settings', value),
    putOperation: value => db.prepare('INSERT OR REPLACE INTO operations VALUES(?,?)').run(value.id, JSON.stringify(value)),
    operations: () => db.prepare('SELECT data FROM operations ORDER BY rowid DESC LIMIT 100').all().map(row => JSON.parse(row.data)),
    operation: id => { const row = db.prepare('SELECT data FROM operations WHERE id=?').get(id); return row ? JSON.parse(row.data) : null; },
    touch: id => db.prepare('INSERT INTO usage VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1,last=excluded.last').run(id, Date.now()),
    close: () => db.close()
  };
}
module.exports = { createStore, defaults };
