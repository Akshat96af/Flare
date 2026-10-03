# Verification

Local evidence stays in ignored `Files/private/verification/`. Implementation and validation are separate.

`npm test` covers ranking/command rejection, content snippets/exclusions, protected locations, organization/restart/undo, collisions/later edits, selected approvals, changed multi-input rejection, actual WebP/PDF output/rendering, and EXIF preference/fallback.

`npm run test:desktop` launches real Electron with isolated data. It exercises app discovery, themes, conversion review/output/undo, private-location exclusions, image preview, and narrow layout. Native chooser responses are replaced with generated fixture paths; file processing/indexing/IPC are real. Selected states receive axe-core WCAG A/AA scans. Passing does not establish full accessibility conformance.

Set `FLARE_SMOKE_EXE` to an absolute packaged `Flare.exe` path to test the distributed binary in portable mode. Build checks TypeScript; `format:check` checks formatting. Runtime advisory checks use `npm audit --omit=dev`, not a full Electron/native security audit.

## Before Public Release

- Physical tap/hold, repeat/release order, rebinding/conflicts, focus and Escape.
- Human speech/microphones, denied permission/noise/silence, push-to-talk, microphone release.
- Live provider/model calls and consented audio with an explicit testing budget.
- Windows 100/125/150/200 percent scaling, mixed-DPI, high contrast, NVDA/Narrator, sleep/resume.
- Large drives, disconnects, cloud placeholders, malformed files, encrypted PDFs, low disk space, locked files, cross-volume and every journal-interruption phase.
- Clean-machine installer/uninstaller/portable retention and complete native-library/source obligations.

This is a preview until these checks are completed. Compilation/screenshots are not performance or data-loss guarantees.
