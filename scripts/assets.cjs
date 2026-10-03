const fs = require('node:fs/promises');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Zap } = require('lucide-react');
const sharp = require('sharp');
(async () => {
  const directory = path.resolve(__dirname, '../desktop/assets');
  await fs.mkdir(directory, { recursive: true });
  const mark = renderToStaticMarkup(
    React.createElement(Zap, { size: 320, x: 96, y: 96, color: '#9ee9ff', strokeWidth: 1.5 }),
  );
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" rx="96" fill="#202326"/>${mark}</svg>`,
  );
  await sharp(svg).png().toFile(path.join(directory, 'flare.png'));
  const png = await sharp(svg).resize(256).png().toBuffer(),
    header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  await fs.writeFile(path.join(directory, 'flare.ico'), Buffer.concat([header, png]));
  console.log('Generated Flare PNG and Windows icon using Lucide Zap.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
