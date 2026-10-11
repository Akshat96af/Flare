const fs = require('node:fs/promises');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { OfflineWhisper } = require('../desktop/offline-whisper.cjs');
(async () => {
  const root = path.resolve('Files/private/setup-payload');
  await fs.mkdir(path.join(root, 'support'), { recursive: true });
  const support = path.join(root, 'support/vc_redist.x64.exe');
  try {
    await fs.access(support);
  } catch {
    const response = await fetch('https://aka.ms/vs/17/release/vc_redist.x64.exe', {
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok || !response.body) throw new Error('Microsoft runtime download unavailable.');
    let size = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        size += chunk.length;
        callback(
          size > 40000000 ? new Error('Support runtime exceeds expected size.') : null,
          chunk,
        );
      },
    });
    try {
      await pipeline(
        Readable.fromWeb(response.body),
        limit,
        createWriteStream(support, { flags: 'wx' }),
      );
    } catch (error) {
      await fs.rm(support, { force: true });
      throw error;
    }
  }
  const signature = JSON.parse(
    (
      await promisify(execFile)(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-File',
          path.resolve('scripts/verify-runtime.ps1'),
          support,
        ],
        { windowsHide: true },
      )
    ).stdout,
  );
  if (!signature.valid) {
    await fs.rm(support, { force: true });
    throw new Error('Microsoft runtime signature verification failed.');
  }
  console.log(
    'Verified Microsoft-signed support runtime. Redistribution is subject to Microsoft license terms.',
  );
  const cache = path.resolve('Files/private/setup-cache');
  const voice = new OfflineWhisper(cache, (_event, data) => {
    if (data.completed === data.total) console.log(data.status);
  });
  for (const model of ['tiny.en', 'base.en']) await voice.install(model, true);
  await fs.mkdir(path.join(root, 'ocr'), { recursive: true });
  await fs.copyFile(
    require('../desktop/ocr.cjs').languageFile(),
    path.join(root, 'ocr/eng.traineddata.gz'),
  );
  await fs.mkdir(path.join(root, 'voice'), { recursive: true });
  await fs.cp(voice.engine, path.join(root, 'voice', path.basename(voice.engine)), {
    recursive: true,
  });
  for (const model of ['tiny.en', 'base.en'])
    await fs.copyFile(
      voice.modelPath(model),
      path.join(root, 'voice', path.basename(voice.modelPath(model))),
    );
  console.log(
    'Verified offline setup payloads: OCR, Whisper runtime, Fast and Balanced English models.',
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
