# Architecture

Electron + React + TypeScript + SQLite. This machine has Node 24 but no Rust/MSVC toolchain, so Electron provides the runnable native shell without requiring Tauri prerequisites. Electron is heavier; footprint and idle resources remain optimization work.

- `main.cjs`: native lifecycle, tray, shortcut, typed IPC, permissions, dialogs, credential encryption.
- `search.cjs`: discovery, scope, ranking, watcher/index lifecycle. Separate query and index workers keep scans off the input thread.
- `extract.cjs`/`photos.cjs`: format-aware extraction and EXIF; no generated converter commands.
- `commands.cjs`/`ai.cjs`: deterministic commands and provider adapters. Model output is a validated intent, never shell source.
- `operations.cjs`: selected plans, space checks, journal, verification, conflict-aware undo. Conversion workers stage new outputs before committing.
- `native.cjs`/fixed PowerShell scripts: Windows APIs and English speech. Structured UTF-8 inputs never become script source.
- `src/`: isolated/sandboxed UI, motion, settings, tools, microphone visualization. Renderer cannot access Node/filesystem directly.

Normal storage is Electron's per-user userData directory; portable storage is `FlareData` beside the executable. Index/clipboard data are local but not encrypted. Credentials may need reconnecting after moving computers.

No wake-word listener. Native key state is observed only during an activated shortcut hold. Audio is not retained by default; cloud transcription requires saved consent.

Workers are responsiveness boundaries, not a malicious-parser sandbox. Process isolation, large-index benchmarks, full interruption recovery, assistive technology, and clean-machine distribution testing remain release hardening.
