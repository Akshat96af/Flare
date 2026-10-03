# Verification

Local evidence stays in ignored `Files/private/verification/`. Implementation and validation are separate.

`npm test` covers ranking/command rejection, background query refresh, content snippets/exclusions, Office/PDF text extraction, protected locations, organization/restart/undo, collisions/later edits, selected approvals, changed multi-input rejection, actual WebP/PDF output/rendering, EXIF preference/fallback, and binary cloud-audio construction without network calls.

`npm run test:desktop` launches real Electron with isolated data. It exercises app discovery, themes, glass/solid settings, pointer reflections, conversion review/output/undo, private-location exclusions, image preview, and narrow layout. Native chooser responses are replaced with generated fixture paths; file processing/indexing/IPC are real. Selected stable states receive axe-core WCAG A/AA scans. Passing does not establish full accessibility conformance.

The glass treatment uses static optical highlights and compositor motion. It is not desktop refraction: CSS backdrop filtering cannot sample other applications behind the native window. Native rendering disables that unnecessary blur layer. Optical surfaces use non-scrollable clipping so focus cannot shift the shell's contents.

Set `FLARE_SMOKE_EXE` to an absolute packaged `Flare.exe` path to test the distributed binary in portable mode. Build checks TypeScript; `format:check` checks formatting. Runtime advisory checks use `npm audit --omit=dev`, not a full Electron/native security audit.

## Before Public Release

- Physical tap/hold, repeat/release order, rebinding/conflicts, focus and Escape.
- Human speech/microphones, denied permission/noise/silence, push-to-talk, microphone release.
- Live provider/model calls and consented audio with an explicit testing budget.
- Windows 100/125/150/200 percent scaling, mixed-DPI, high contrast, NVDA/Narrator, sleep/resume.
- Large drives, disconnects, cloud placeholders, malformed files, encrypted PDFs, low disk space, locked files, cross-volume and every journal-interruption phase.
- Clean-machine installer/uninstaller/portable retention and complete native-library/source obligations.

This is a preview until these checks are completed. Compilation/screenshots are not performance or data-loss guarantees.

## Dependency Review

The local runtime advisory check reported zero vulnerabilities. The full development-tool audit still reports GHSA-ch52-4w7c-c8xp through `http-cache-semantics` in the Electron packaging chain (eight affected transitive packages). Do not apply the suggested breaking downgrade blindly. This dependency was verified absent from the packaged application; the build-tool advisory still needs upstream remediation before a public release.
