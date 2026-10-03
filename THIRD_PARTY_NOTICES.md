# Third-Party Notices

Flare source retains the repository's MIT license. Dependencies retain their own terms. No implementation code or branding from Flow Launcher, PowerToys, Wox, or ConvertX is included.

[Runtime notices](notices/dependencies.txt) contain the copyright and license texts from installed production packages. Regenerate with `npm run notices` after updating dependencies.

Principal components: React (MIT), Lucide (ISC), Koffi (MIT), sharp (Apache-2.0), PDF.js (Apache-2.0), pdf-lib (MIT), Mammoth (BSD-2-Clause), fast-xml-parser (MIT), mathjs (Apache-2.0), exif-reader (MIT), yauzl (MIT), and @napi-rs/canvas (MIT). Supplied notices and the lockfile identify exact versions.

## Native Libraries

sharp bundles libvips 8.18.7 and other imaging libraries, under separate licenses. Included texts: [libvips LGPL-2.1-or-later](notices/libvips-LICENSE.txt) and [native imaging notices](notices/native-imaging-NOTICES.md).

Sources/build scripts: [libvips 8.18.7](https://github.com/libvips/libvips/tree/v8.18.7), [Windows build scripts](https://github.com/libvips/build-win64-mxe), and [sharp-libvips packaging](https://github.com/lovell/sharp-libvips). Flare uses unmodified published binaries. Imaging DLLs stay unpacked and replaceable in `resources/app.asar.unpacked/node_modules/@img/sharp-win32-x64/lib/`. Before public binary distribution, review every native dependency's corresponding-source obligations and retain required sources/build instructions alongside the release.

Electron distributions include Electron's `LICENSE` and Chromium's `LICENSES.chromium.html`; preserve both. The generated app icon uses Lucide Zap, whose notice is included.

## Optional Models

No Ollama binaries or model weights are bundled. The optional [Qwen 2.5 1.5B download](https://ollama.com/library/qwen2.5:1.5b) is Apache-2.0. Other user-selected models and API services have their own terms.
