const path = require('node:path');
const image = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.tiff', '.bmp']);
const document = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.txt', '.md', '.csv', '.json']);
function fileActions(file) {
  const ext = path.extname(file).toLowerCase();
  const actions = [
    { id: 'preview', title: 'Preview', icon: 'preview' },
    { id: 'share', title: 'Quick Share', icon: 'share' },
    { id: 'reveal', title: 'Show in folder', icon: 'folder' },
    { id: 'copy-path', title: 'Copy path', icon: 'copy' },
  ];
  if (document.has(ext)) actions.unshift({ id: 'summary', title: 'Summarize', icon: 'sparkles' });
  if (image.has(ext))
    actions.unshift(
      { id: 'ocr', title: 'Read text', icon: 'text' },
      { id: 'image', title: 'Convert image', icon: 'image', tool: 'image' },
      { id: 'resize', title: 'Resize image', icon: 'resize', tool: 'resize' },
      { id: 'compress', title: 'Compress image', icon: 'compress', tool: 'compress' },
      { id: 'images-pdf', title: 'Create PDF', icon: 'pdf', tool: 'images-pdf' },
    );
  if (ext === '.pdf')
    actions.unshift(
      { id: 'ocr', title: 'Read scanned text', icon: 'text' },
      { id: 'extract-pdf', title: 'Extract pages', icon: 'pdf', tool: 'extract-pdf' },
      { id: 'split-pdf', title: 'Split PDF', icon: 'split', tool: 'split-pdf' },
      { id: 'pdf-images', title: 'Export images', icon: 'image', tool: 'pdf-images' },
    );
  return actions;
}
module.exports = { fileActions, ocrImages: image };
