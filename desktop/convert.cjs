const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');
sharp.cache(false);
const { PDFDocument } = require('pdf-lib');
const { pdfModule } = require('./extract.cjs');
const { fingerprint } = require('./operations.cjs');
const formats = ['jpeg', 'png', 'webp', 'avif', 'gif', 'tiff'];
async function pdfImages(file, pages = [1], scale = 1.5) {
  const { createCanvas, DOMMatrix, Path2D, ImageData } = require('@napi-rs/canvas');
  global.DOMMatrix ||= DOMMatrix;
  global.Path2D ||= Path2D;
  global.ImageData ||= ImageData;
  const pdf = await pdfModule(),
    loading = pdf.getDocument({
      data: new Uint8Array(await fs.readFile(file)),
      isEvalSupported: false,
      useSystemFonts: true,
    }),
    doc = await loading.promise;
  try {
    const images = [];
    for (const number of pages) {
      if (number < 1 || number > doc.numPages) throw new Error('Page outside this PDF.');
      const page = await doc.getPage(number),
        view = page.getViewport({ scale });
      if (view.width * view.height > 20000000) throw new Error('PDF page is too large to preview.');
      const canvas = createCanvas(Math.ceil(view.width), Math.ceil(view.height));
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: view }).promise;
      images.push(canvas.toBuffer('image/png'));
    }
    return { images, pages: doc.numPages };
  } finally {
    await loading.destroy();
  }
}
async function imageBuffer(file, format, quality = 82, targetKB = 0) {
  if (!formats.includes(format)) throw new Error('Unsupported output format.');
  const pipeline = (q) =>
    sharp(file, { limitInputPixels: 50000000 }).rotate().toFormat(format, { quality: q });
  let buffer = await pipeline(quality).toBuffer();
  if (targetKB > 0 && ['jpeg', 'webp', 'avif'].includes(format)) {
    for (let q = quality - 10; buffer.length > targetKB * 1024 && q >= 10; q -= 10)
      buffer = await pipeline(q).toBuffer();
  }
  return buffer;
}
async function render(item, plan) {
  const options = plan.options,
    inputs = plan.inputs;
  let buffer;
  if (['image', 'compress'].includes(options.tool))
    buffer = await imageBuffer(item.from, options.format, options.quality, options.targetKB);
  else if (options.tool === 'images-pdf') {
    const pdf = await PDFDocument.create();
    for (const file of inputs) {
      const data = await sharp(file).rotate().flatten({ background: '#fff' }).jpeg().toBuffer();
      const img = await pdf.embedJpg(data);
      const page = pdf.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
    buffer = Buffer.from(await pdf.save());
  } else if (['merge-pdf', 'extract-pdf', 'split-pdf'].includes(options.tool)) {
    const pdf = await PDFDocument.create();
    for (const file of inputs) {
      const source = await PDFDocument.load(await fs.readFile(file));
      const indices =
        options.tool === 'merge-pdf'
          ? source.getPageIndices()
          : options.tool === 'split-pdf'
            ? [item.page - 1]
            : options.pages.map((x) => x - 1);
      if (indices.some((x) => x < 0 || x >= source.getPageCount()))
        throw new Error('Selected page is outside this PDF.');
      for (const page of await pdf.copyPages(source, indices)) pdf.addPage(page);
    }
    buffer = Buffer.from(await pdf.save());
  } else if (options.tool === 'pdf-images')
    buffer = (await pdfImages(item.from, [item.page], options.scale || 1.5)).images[0];
  else throw new Error('Conversion not available.');
  // Output is exclusive and originals remain unchanged.
  await fs.writeFile(item.to, buffer, { flag: 'wx' });
  item.outputSize = buffer.length;
}
async function planConversion(operations, files, destination, options) {
  if (!files.length || files.length > 100) throw new Error('Choose between 1 and 100 files.');
  if (
    ![
      'image',
      'compress',
      'images-pdf',
      'merge-pdf',
      'split-pdf',
      'extract-pdf',
      'pdf-images',
    ].includes(options.tool)
  )
    throw new Error('Unsupported tool.');
  options = {
    ...options,
    quality: Math.max(10, Math.min(100, Number(options.quality) || 82)),
    targetKB: Math.max(0, Math.min(100000, Number(options.targetKB) || 0)),
  };
  if (['image', 'compress'].includes(options.tool) && !formats.includes(options.format))
    throw new Error('Choose a supported image format.');
  if (options.tool === 'extract-pdf') {
    if (
      !Array.isArray(options.pages) ||
      !options.pages.length ||
      options.pages.length > 500 ||
      options.pages.some((x) => !Number.isInteger(x) || x < 1)
    )
      throw new Error('Enter valid page numbers.');
  }
  const items = [],
    stamp = Date.now();
  const parent = await fs.realpath(destination);
  for (const [i, file] of files.entries()) {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100 * 1024 * 1024)
      throw new Error('Choose regular files smaller than 100 MB.');
    const base = path.basename(file, path.extname(file));
    if (['split-pdf', 'pdf-images'].includes(options.tool)) {
      const doc = await PDFDocument.load(await fs.readFile(file));
      if (doc.getPageCount() > 200) throw new Error('This tool supports up to 200 pages at once.');
      for (let page = 1; page <= doc.getPageCount(); page++)
        items.push({
          from: file,
          to: path.join(
            destination,
            `${base}-${stamp}-${i + 1}-page-${page}.${options.tool === 'pdf-images' ? 'png' : 'pdf'}`,
          ),
          page,
          size: stat.size,
          modified: stat.mtimeMs,
          status: 'pending',
        });
    } else {
      if (['images-pdf', 'merge-pdf', 'extract-pdf'].includes(options.tool) && i > 0) continue;
      items.push({
        from: file,
        to: path.join(
          destination,
          `${base}-flare-${stamp}-${i + 1}.${['image', 'compress'].includes(options.tool) ? (options.format === 'jpeg' ? 'jpg' : options.format) : 'pdf'}`,
        ),
        size: stat.size,
        modified: stat.mtimeMs,
        status: 'pending',
      });
    }
  }
  for (const item of items) item.parent = parent;
  const plan = operations.createOutputPlan(options.tool.replaceAll('-', ' '), items);
  plan.inputs = files;
  plan.options = options;
  plan.inputHashes = await Promise.all(files.map(fingerprint));
  return plan;
}
module.exports = { formats, render, planConversion, pdfImages, imageBuffer };
