const fs = require('node:fs/promises');
const path = require('node:path');
(async () => {
  const root = path.resolve(__dirname, '..'),
    lock = JSON.parse(await fs.readFile(path.join(root, 'package-lock.json'), 'utf8')),
    sections = [];
  for (const [location, metadata] of Object.entries(lock.packages).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (!location.startsWith('node_modules/') || metadata.dev) continue;
    const directory = path.join(root, location);
    let names;
    try {
      names = await fs.readdir(directory);
    } catch {
      continue;
    }
    const pkg = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
    let section = `\n${pkg.name} ${pkg.version}\nLicense: ${metadata.license || pkg.license || 'See package notices'}\n`;
    for (const name of names.filter((x) =>
      /^(license|licence|copying|notice|third.party.notices)/i.test(x),
    )) {
      try {
        section +=
          '\n' + name + '\n' + (await fs.readFile(path.join(directory, name), 'utf8')) + '\n';
      } catch {}
    }
    sections.push(section);
  }
  await fs.mkdir(path.join(root, 'notices'), { recursive: true });
  await fs.writeFile(
    path.join(root, 'notices/dependencies.txt'),
    'Flare third-party runtime notices\nGenerated from the installed production dependency tree.\n' +
      sections.join('\n-----------------------------\n'),
  );
  console.log('Collected ' + sections.length + ' runtime dependency notices.');
  for(const [file,url] of [
    ['libvips-LICENSE.txt','https://raw.githubusercontent.com/libvips/libvips/v8.18.7/LICENSE'],
    ['native-imaging-NOTICES.md','https://raw.githubusercontent.com/lovell/sharp-libvips/main/THIRD-PARTY-NOTICES.md'],
  ]){const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Could not retrieve native library notices: '+url);await fs.writeFile(path.join(root,'notices',file),await response.text());}
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
