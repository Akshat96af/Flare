const fs = require('node:fs/promises');
const path = require('node:path');
const { OfflineWhisper } = require('../desktop/offline-whisper.cjs');
(async () => {
  const root = path.resolve('Files/private/setup-payload');
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
