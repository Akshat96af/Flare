const fs = require('node:fs/promises');
const path = require('node:path');
const yauzl = require('yauzl');
const { XMLParser } = require('fast-xml-parser');
const textExtensions = new Set([
  '.txt',
  '.md',
  '.json',
  '.csv',
  '.html',
  '.htm',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.rs',
  '.css',
  '.xml',
  '.yaml',
  '.yml',
  '.log',
  '.c',
  '.cpp',
  '.h',
  '.java',
  '.cs',
]);
async function pdfModule() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}
async function extract(file, size) {
  if (size > 12 * 1024 * 1024) return '';
  const ext = path.extname(file).toLowerCase();
  if (textExtensions.has(ext)) return (await fs.readFile(file, 'utf8')).slice(0, 160000);
  if (ext === '.docx')
    return (await require('mammoth').extractRawText({ path: file })).value.slice(0, 160000);
  if (ext === '.pdf') {
    const pdf = await pdfModule();
    const loading = pdf.getDocument({
        data: new Uint8Array(await fs.readFile(file)),
        isEvalSupported: false,
        useSystemFonts: true,
      }),
      doc = await loading.promise;
    try {
      let text = '';
      for (let i = 1; i <= Math.min(doc.numPages, 150) && text.length < 160000; i++) {
        const page = await doc.getPage(i);
        text += (await page.getTextContent()).items.map((x) => x.str || '').join(' ') + '\n';
      }
      return text.slice(0, 160000);
    } finally {
      await loading.destroy();
    }
  }
  if (ext === '.pptx' || ext === '.xlsx')
    return new Promise((resolve, reject) => {
      const parts = [];
      let total = 0;
      const parser = new XMLParser({ ignoreAttributes: true });
      yauzl.open(file, { lazyEntries: true }, (err, zip) => {
        if (err) return reject(err);
        zip.on('error', reject);
        zip.on('end', () => resolve(parts.join('\n').slice(0, 160000)));
        zip.on('entry', (entry) => {
          const wanted =
            ext === '.pptx'
              ? /^ppt\/slides\/slide\d+\.xml$/.test(entry.fileName)
              : /^xl\/(sharedStrings\.xml|worksheets\/sheet\d+\.xml)$/.test(entry.fileName);
          if (!wanted || entry.uncompressedSize > 2000000 || total > 12000000) {
            zip.readEntry();
            return;
          }
          total += entry.uncompressedSize;
          zip.openReadStream(entry, (e, stream) => {
            if (e) return reject(e);
            const chunks = [];
            stream.on('error', reject);
            stream.on('data', (x) => chunks.push(x));
            stream.on('end', () => {
              const data = parser.parse(Buffer.concat(chunks).toString('utf8'));
              const visit = (x) => {
                if (!x || typeof x !== 'object') return;
                for (const [k, v] of Object.entries(x)) {
                  if (k === 'a:t' || k === 't' || k === 'v') parts.push(String(v));
                  else if (Array.isArray(v)) v.forEach(visit);
                  else visit(v);
                }
              };
              visit(data);
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      });
    });
  return '';
}
module.exports = { extract, textExtensions, pdfModule };
