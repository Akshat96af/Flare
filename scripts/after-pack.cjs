const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async (context) => {
  const release = path.resolve(__dirname, '../release'),
    directory = path.resolve(context.appOutDir);
  if (!directory.startsWith(release + path.sep)) throw new Error('Unexpected output directory.');
  await fs.writeFile(
    path.join(directory, 'Flare Portable.cmd'),
    '@echo off\r\nstart "" "%~dp0Flare.exe" --portable\r\n',
  );
  await fs.writeFile(
    path.join(directory, 'Portable Readme.txt'),
    'Run Flare Portable.cmd to keep settings and recovery files in FlareData beside the app.\r\nKeep the whole folder together. Startup registration is disabled in portable mode.\r\nDo not delete FlareData before restoring cleanup files.\r\nThis unsigned preview build may trigger Windows SmartScreen.\r\n',
  );
};
