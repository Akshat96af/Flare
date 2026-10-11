const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');
const archive = 'release/win-unpacked/resources/app.asar';
const files = [
  'desktop/main.cjs',
  'desktop/ai.cjs',
  'desktop/preload.cjs',
  'desktop/speech-audio.cjs',
  'desktop/speech.ps1',
  'desktop/permissions.cjs',
  'desktop/index-worker.cjs',
  'desktop/store.cjs',
  'desktop/search.cjs',
  'desktop/scope.cjs',
  'desktop/commands.cjs',
  'desktop/extract.cjs',
  'desktop/ocr.cjs',
  'desktop/ocr-worker.cjs',
  'desktop/file-actions.cjs',
  'desktop/offline-whisper.cjs',
  'desktop/music.cjs',
  'desktop/media.ps1',
  'desktop/windows.ps1',
  'dist/index.html',
  ...fs.readdirSync('dist/assets').map((file) => 'dist/assets/' + file),
];
for (const file of files) {
  const packaged = asar.extractFile(archive, path.normalize(file));
  if (!packaged.equals(fs.readFileSync(file))) throw new Error('Stale package: ' + file);
  console.log('Verified ' + file);
}
