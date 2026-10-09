# Verification

Local evidence stays in ignored `Files/private/verification/`. Implementation and validation are separate.

`npm test` covers ranking/command rejection, background query refresh, content snippets/exclusions, Office/PDF text extraction, protected locations, organization/restart/undo, collisions/later edits, selected approvals, changed multi-input rejection, actual WebP/PDF output/rendering, EXIF preference/fallback, and binary cloud-audio construction without network calls.

`npm run test:desktop` launches real Electron with isolated data. It exercises app discovery, themes, glass/solid settings, pointer reflections, conversion review/output/undo, private-location exclusions, image preview, and narrow layout. Native chooser responses are replaced with generated fixture paths; file processing/indexing/IPC are real. Selected stable states receive axe-core WCAG A/AA scans. Passing does not establish full accessibility conformance.

`npm run test:bugs` verifies one-press native Escape with populated search, focused settings and pending AI, decodes a real Windows Store-app icon and checks its pixels, and exercises Ask AI, plain-text answers, provider errors, cancellation and key isolation with mocked native HTTP. It makes no paid requests. Additional unit tests cover the one-second hold threshold/release/cancel state, Gemini pagination/model normalization, thought-part filtering, token bounds and rejected commands.

`npm run test:voice` uses synthetic audio and mocked native speech/HTTP. It checks the Windows readiness handshake, no upload after local success, late microphone-stream cleanup, explicit online routing, a separate speech model, transcript review/retry and cancellation on Escape. It does not access a microphone or establish real-world transcription accuracy. New unit tests cover recording validation, provider transcription requests, empty transcripts and abort signals. Windows speech helper compilation is checked separately without calling its recognition method.

The glass treatment uses static optical highlights and compositor motion. It is not desktop refraction: CSS backdrop filtering cannot sample other applications behind the native window. Native rendering disables that unnecessary blur layer. Optical surfaces use non-scrollable clipping so focus cannot shift the shell's contents.

Set `FLARE_SMOKE_EXE` to an absolute packaged `Flare.exe` path to test the distributed binary in portable mode. Build checks TypeScript; `format:check` checks formatting. Runtime advisory checks use `npm audit --omit=dev`, not a full Electron/native security audit.

`npm run test:ui` uses an isolated native process with deterministic search/preview fixtures. It checks keyboard control isolation, stale-result protection, interrupted preview requests, tab navigation, click feedback, reduced motion, narrow layout, and rapid-click settling. It makes no network or generation requests. Unit tests also terminate a query worker mid-request and verify immediate rejection and recovery. Glass press effects are bounded, cancelled when interrupted, and disabled for reduced motion.

## Before Public Release

- Physical tap/hold, repeat/release order, rebinding/conflicts, focus and Escape.
- Human speech/microphones, denied permission/noise/silence, push-to-talk, microphone release.
- Live provider/model calls and consented audio with an explicit testing budget.
- Windows 100/125/150/200 percent scaling, mixed-DPI, high contrast, NVDA/Narrator, sleep/resume.
- Large drives, disconnects, cloud placeholders, malformed files, encrypted PDFs, low disk space, locked files, cross-volume and every journal-interruption phase.
- Clean-machine installer/uninstaller/portable retention and complete native-library/source obligations.

This is a preview until these checks are completed. Compilation/screenshots are not performance or data-loss guarantees.

## Dependency Review

The most recent runtime advisory check found three moderate entries in the `mammoth -> argparse -> sprintf-js` chain (GHSA-hp3w-g68c-fv3c). The full development-tool audit also has packaging-chain advisories. Do not apply the suggested breaking downgrade blindly. Dependency advisories need separate review before a public release; passing functional tests does not resolve them.

## Quick Share and connection checks

`npm run test:features` exercises the native picker and IPC, explicit sharing approval, a generated dummy-file download, QR pixel rendering, clipboard, panel reopening and share revocation. It uses a temporary private-network listener and closes the app afterward. Gemini HTTP is mocked; a separate test confirmation must precede the one generation request. Dark and compact/light states receive automated accessibility scans. A second physical device, firewall prompts and guest/VPN networks remain manual checks.

Share unit tests use loopback only, reject unknown selections, foreign Host headers and write methods, and verify changed-file rejection and expiry. Voice tests include quieter synthetic input and silence rejection; they do not establish human transcription accuracy.

## Stability regressions

Focused red/green tests reproduce and cover overlapping operation preflight, stopping a share during startup, and preserving selection indices after a failed disk-space check. Native UI checks cover late file-plan responses after dismissal and bounded navigation motion. The speech waveform uses the recorded time-domain signal rather than sparse frequency-bin samples, so quiet input has visible feedback. Voice failures cannot restart from late readiness callbacks.

Release blockers remain: the unresolved runtime dependency advisory, unsigned distribution, live provider/audio verification, clean-machine installation, different microphones/GPUs and cross-device LAN/firewall checks. These changes improve stability but do not establish production readiness by themselves.

## Packaged validation: 2026-10-09

The current Windows installer and portable ZIP were produced, and the unpacked executable was tested with isolated profiles. The packaged backend and frontend assets match the working files; the archive contains no `Files/private` material.

- `npm test`: 44 passed, zero failures.
- Packaged `test:desktop`, `test:ui`, `test:features`, `test:voice`, and `test:bugs`: all passed.
- Formatting and diff whitespace checks passed.
- Native UI tests observed the 300 ms panel animation and verified reduced-motion cancellation, rapid-click settling, keyboard isolation and compact layouts.
- Screenshot review covered light settings, 380 px settings, and active dark Quick Share, including the corrected header inset and ten-minute timer.
- Automated accessibility scans reported no violations in tested states. Some glass contrast checks remain incomplete and need human review.

Evidence directories under ignored `Files/private/verification/`: `desktop-1791553944381`, `ui-1791554006685`, `features-1791554037617`, `voice-1791554082832`, and `bugs-1791554126113`. Voice and provider tests used synthetic audio and mocked responses, with zero real microphone access or paid API requests. Quick Share transferred only a generated fixture; cross-device delivery is not established by this test.

## Motion redesign: 2026-10-09

This later pass replaces the preceding 300 ms panel effect and optical styling. It adds a 680 ms launcher entrance, directional 560 ms navigation with a bounded content cascade, a shared 460 ms hover lens, damped pointer reflections, and new beveled rail/footer materials. Current timings and opaque-surface contrast calculations are in `DESIGN_REVIEW.md`.

Source-build native checks passed for desktop workflows (`desktop-1791555109882`), UI (`ui-1791555186575`), synthetic voice (`voice-1791555252140`), and Quick Share/provider settings (`features-1791555283314`). Build and formatting checks passed. Tested accessibility states reported zero automated violations; this is not full accessibility conformance.

The UI test checks actual changed pixels between paused transition frames, verifies the shared hover lens travels between controls, and changes reduced-motion preferences during an active launcher entrance. It also covers forced colors, rapid clicks, glass opt-out and a 380 px window. The first narrow-window run reproduced invisible hover-lens overflow; resetting its geometry on cancellation and observing launcher resizes fixed it, and the regression check now passes.

A 29-sample animated capture of the actual rendered settings transition is saved privately in `motion-redesign-1791555425238/motion-preview.webp` (the encoder combines identical frames). It samples the animation timeline for review; it is not a recording or benchmark of real-time frame rate. No paid API calls, microphone recordings, or personal-file transfers were used in this visual pass.

The redesigned packaged executable passed the same UI checks in `ui-1791555518782`. Its frontend assets match the final source build, and the archive contains no private reference files.
