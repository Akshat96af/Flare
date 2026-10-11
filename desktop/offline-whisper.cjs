const fs = require('node:fs/promises');
const { createReadStream, createWriteStream, existsSync } = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Readable, Transform } = require('node:stream');
const { spawn } = require('node:child_process');
const yauzl = require('yauzl');
const { validatedWav } = require('./speech-audio.cjs');
const revision = '5359861c739e955e79d9a303bcbc70fb988958b1';
const runtime = {
  version: '1.8.4',
  size: 4078768,
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.4/whisper-bin-x64.zip',
  sha256: '74f973345cb52ef5ba3ec9e7e7af8e48cc8c71722d1528603b80588a11f82e3e',
  files: {
    'whisper-cli.exe': 'd4c598cf97de103f888d1a53b8abddc85bf27ab752f785ca69318cedc8a2cf64',
    'whisper.dll': 'ce1958796ebd9d03aafc56cdc2f04c21f214a9c7623889a0a23bc6c162976e87',
    'ggml.dll': '9f2b124cbe1d002dc25de9a5ff9813c4fec7ef9f3bb9f41035fc6b46fb77bfa0',
    'ggml-base.dll': '138a2b1a03b7dd757d764f60b39a8b32a08137e21fce4d3d78fbac6c5e716f9d',
    'ggml-cpu.dll': '9a74d977527dbac38d96900fd7ce422aebbf96001aff5be6a05d7c547dcb9bcb',
  },
};
const catalogue = [
  {
    id: 'tiny.en',
    title: 'Fast',
    size: 77704715,
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
  },
  {
    id: 'base.en',
    title: 'Balanced',
    size: 147964211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  },
].map((model) => ({
  ...model,
  url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${revision}/ggml-${model.id}.bin`,
}));
async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function verified(file, hash, size) {
  try {
    const stat = await fs.lstat(file);
    return (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      (!size || stat.size === size) &&
      (await digest(file)) === hash
    );
  } catch {
    return false;
  }
}
async function download(asset, destination, signal, emit) {
  const response = await fetch(asset.url, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15 * 60000)]),
  });
  if (!response.ok || !response.body) throw new Error('Download unavailable. Try again later.');
  let completed = 0,
    lastEmit = 0;
  const hash = createHash('sha256');
  const meter = new Transform({
    transform(chunk, _encoding, callback) {
      completed += chunk.length;
      if (completed > asset.size)
        return callback(new Error('Download exceeded its verified size.'));
      hash.update(chunk);
      if (Date.now() - lastEmit > 150) {
        emit({ completed, total: asset.size });
        lastEmit = Date.now();
      }
      callback(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body),
    meter,
    createWriteStream(destination, { flags: 'wx' }),
    { signal },
  );
  if (completed !== asset.size || hash.digest('hex') !== asset.sha256)
    throw new Error('Download checksum did not match. Nothing was installed.');
  emit({ completed, total: asset.size });
}
async function unpack(zipFile, destination) {
  await fs.mkdir(destination, { recursive: true });
  await new Promise((resolve, reject) =>
    yauzl.open(zipFile, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      zip.on('error', reject);
      zip.on('end', resolve);
      zip.on('entry', (entry) => {
        const name = path.posix.basename(entry.fileName);
        if (!Object.hasOwn(runtime.files, name)) return zip.readEntry();
        if (entry.uncompressedSize > 2000000) {
          zip.close();
          return reject(new Error('Invalid runtime archive.'));
        }
        zip.openReadStream(entry, async (error, stream) => {
          if (error) {
            zip.close();
            return reject(error);
          }
          try {
            await pipeline(
              stream,
              createWriteStream(path.join(destination, name), { flags: 'wx' }),
            );
            zip.readEntry();
          } catch (error) {
            zip.close();
            reject(error);
          }
        });
      });
      zip.readEntry();
    }),
  );
  for (const [name, hash] of Object.entries(runtime.files))
    if (!(await verified(path.join(destination, name), hash)))
      throw new Error('Runtime verification failed.');
}
class OfflineWhisper {
  constructor(directory, emit = () => {}, bundledDirectory = '') {
    this.root = path.join(directory, 'offline-voice');
    this.engine = path.join(this.root, 'runtime-' + runtime.version);
    this.bundle = bundledDirectory;
    if (
      bundledDirectory &&
      existsSync(path.join(bundledDirectory, 'runtime-' + runtime.version, 'whisper-cli.exe'))
    )
      this.engine = path.join(bundledDirectory, 'runtime-' + runtime.version);
    this.emit = emit;
    this.installing = null;
  }
  model(id) {
    const model = catalogue.find((x) => x.id === id);
    if (!model) throw new Error('Choose a supported offline voice model.');
    return model;
  }
  modelPath(id) {
    const name = 'ggml-' + this.model(id).id + '.bin';
    if (this.bundle && existsSync(path.join(this.bundle, name)))
      return path.join(this.bundle, name);
    return path.join(this.root, name);
  }
  async runtimeReady() {
    for (const [name, hash] of Object.entries(runtime.files))
      if (!(await verified(path.join(this.engine, name), hash))) return false;
    return true;
  }
  async info() {
    const engineReady = await this.runtimeReady();
    const models = await Promise.all(
      catalogue.map(async (model) => ({
        id: model.id,
        title: model.title,
        size: model.size + runtime.size,
        ready: engineReady && (await verified(this.modelPath(model.id), model.sha256, model.size)),
      })),
    );
    return {
      supported: process.platform === 'win32' && process.arch === 'x64',
      models,
      downloading: !!this.installing,
    };
  }
  async install(id, confirm) {
    if (confirm !== true) throw new Error('Confirm the offline model download first.');
    if (process.platform !== 'win32' || process.arch !== 'x64')
      throw new Error('Offline voice currently supports Windows x64.');
    const model = this.model(id);
    if (this.installing) throw new Error('An offline model download is already running.');
    if (this.bundle) {
      if (
        (await this.runtimeReady()) &&
        (await verified(this.modelPath(id), model.sha256, model.size))
      )
        return this.info();
      throw new Error(
        'This voice model was not installed or failed verification. Select Offline Whisper in Flare Setup.',
      );
    }
    const controller = new AbortController();
    this.installing = controller;
    let staging;
    const signal = controller.signal;
    try {
      await fs.mkdir(this.root, { recursive: true });
      staging = await fs.mkdtemp(path.join(this.root, 'install-'));
      const emit = (status) => (progress) =>
        this.emit('offline-download', { model: id, status, ...progress });
      const space = await fs.statfs(this.root);
      if (space.bavail * space.bsize < model.size * 2 + 20000000)
        throw new Error('Not enough free storage for this download.');
      if (!(await this.runtimeReady())) {
        const zip = path.join(staging, 'runtime.zip');
        await download(runtime, zip, signal, emit('Downloading voice engine'));
        await unpack(zip, path.join(staging, 'runtime'));
        signal.throwIfAborted();
        await fs.rm(this.engine, { recursive: true, force: true });
        await fs.rename(path.join(staging, 'runtime'), this.engine);
      }
      if (!(await verified(this.modelPath(id), model.sha256, model.size))) {
        const file = path.join(staging, 'model.bin');
        await download(model, file, signal, emit('Downloading English voice model'));
        signal.throwIfAborted();
        await fs.rm(this.modelPath(id), { force: true });
        await fs.rename(file, this.modelPath(id));
      }
      signal.throwIfAborted();
      this.emit('offline-download', {
        model: id,
        status: 'Ready',
        completed: model.size,
        total: model.size,
      });
    } finally {
      if (this.installing === controller) this.installing = null;
      if (staging) await fs.rm(staging, { recursive: true, force: true });
    }
    return this.info();
  }
  cancel() {
    this.installing?.abort();
  }
  async transcribe(bytes, id, signal) {
    const audio = validatedWav(bytes),
      model = this.model(id);
    signal.throwIfAborted();
    if (
      !(await this.runtimeReady()) ||
      !(await verified(this.modelPath(id), model.sha256, model.size))
    )
      throw new Error('Set up offline Whisper in Voice settings first.');
    signal.throwIfAborted();
    await fs.mkdir(this.root, { recursive: true });
    const directory = await fs.mkdtemp(path.join(this.root, 'recording-'));
    try {
      const wav = path.join(directory, 'recording.wav'),
        output = path.join(directory, 'transcript');
      await fs.writeFile(wav, audio, { flag: 'wx' });
      await new Promise((resolve, reject) => {
        const child = spawn(
          path.join(this.engine, 'whisper-cli.exe'),
          [
            '-m',
            this.modelPath(id),
            '-f',
            wav,
            '-l',
            'en',
            '-nt',
            '-otxt',
            '-of',
            output,
            '-t',
            '4',
            '--no-gpu',
          ],
          { cwd: this.engine, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let error = '',
          timedOut = false;
        const abort = () => child.kill();
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill();
        }, 90000);
        child.stderr.on('data', (chunk) => {
          error = (error + chunk).slice(-2000);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          if (signal.aborted) reject(new Error('Voice recognition cancelled.'));
          else if (timedOut) reject(new Error('Offline voice took too long. Try the Fast model.'));
          else if (code !== 0)
            reject(
              new Error(
                'Offline voice could not run. The official engine may require Microsoft Visual C++ 2015-2022 x64 Runtime. ' +
                  error.slice(-200),
              ),
            );
          else resolve();
        });
      });
      signal.throwIfAborted();
      const text = (await fs.readFile(output + '.txt', 'utf8')).trim().slice(0, 2000);
      if (!text || /^\[.*\]$/.test(text))
        throw new Error('No clear speech detected. Listen to the recording and try again.');
      return text;
    } finally {
      await fs.rm(directory, { recursive: true, force: true });
    }
  }
}
module.exports = { OfflineWhisper, catalogue, runtime, digest, verified, download, unpack };
