const fs = require('node:fs/promises');
const path = require('node:path');
const { ocrImages } = require('./file-actions.cjs');

function languageFile() {
  if (process.resourcesPath && __dirname.includes('app.asar'))
    return path.join(process.resourcesPath, 'optional/ocr/eng.traineddata.gz');
  return path.join(
    path.dirname(require.resolve('@tesseract.js-data/eng')),
    '4.0.0_best_int/eng.traineddata.gz',
  );
}
async function available() {
  try {
    await fs.access(languageFile());
    return true;
  } catch {
    return false;
  }
}
function createRecognizer() {
  let worker;
  async function recognize(image) {
    if (!worker) {
      const file = languageFile();
      try {
        await fs.access(file);
      } catch {
        throw new Error('OCR was not installed. Select Local OCR in Flare Setup.');
      }
      worker = await require('tesseract.js').createWorker('eng', 1, {
        langPath: path.dirname(file),
        cacheMethod: 'none',
        workerPath: require.resolve('tesseract.js/src/worker-script/node/index.js').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
      });
    }
    const bytes = await require('sharp')(image, { limitInputPixels: 20000000 })
      .rotate()
      .resize(2400, 2400, { fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#fff' })
      .png()
      .toBuffer();
    return (await worker.recognize(bytes)).data.text.trim().slice(0, 160000);
  }
  return {
    recognize,
    async close() {
      await worker?.terminate();
      worker = null;
    },
  };
}

async function readOcr(file, size, { recognizer, maxPages = 10, progress = () => {} } = {}) {
  if (size > 12 * 1024 * 1024) throw new Error('Choose an image or PDF below 12 MB.');
  const own = !recognizer;
  recognizer ||= createRecognizer();
  try {
    if (ocrImages.has(path.extname(file).toLowerCase())) {
      progress({ page: 1, pages: 1 });
      return { text: await recognizer.recognize(file), pages: 1, truncated: false };
    }
    if (path.extname(file).toLowerCase() !== '.pdf')
      throw new Error('OCR supports images and PDFs.');
    const { pdfImages } = require('./convert.cjs');
    let text = '',
      pages = 1;
    for (let page = 1; page <= Math.min(pages, maxPages) && text.length < 160000; page++) {
      const rendered = await pdfImages(file, [page], 1.75);
      pages = rendered.pages;
      progress({ page, pages: Math.min(pages, maxPages) });
      text += (page === 1 ? '' : '\n\n') + (await recognizer.recognize(rendered.images[0]));
    }
    return {
      text: text.slice(0, 160000),
      pages,
      truncated: pages > maxPages || text.length >= 160000,
    };
  } finally {
    if (own) await recognizer.close();
  }
}
module.exports = { createRecognizer, readOcr, available, languageFile };
