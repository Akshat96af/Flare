# Flare

A keyboard and voice command center for Windows. Find things, transform files, and keep control of every change.

**0.1 preview.** Local-first. No account, hosted database, or mandatory AI provider. Initial target: Windows 11 x64.

![Flare in dark mode](docs/images/launcher-dark.png)

## Run

Use the locally generated installer, or extract the entire ZIP and run `Flare Portable.cmd`. Portable data stays in `FlareData` beside the app. Running `Flare.exe` directly uses per-user storage unless passed `--portable`.

Builds are unsigned and may trigger SmartScreen. No release is published automatically. Restore cleanup files before removing application data.

From source, install Node.js 24 or later on Windows:

```powershell
npm ci
npm run assets
npm run build
npm start
```

Use `npm run desktop:dev` for live UI development. `npm run dev` is a browser preview without native file access/search/voice.

## Use

- Tap `Alt+Space` to open; hold for 1 second for English voice. Silence-stop is the default; push-to-talk is available.
- Search apps, files, folders, bookmarks, Windows settings, or calculations. Arrows/Enter navigate; `Ctrl+Space` previews; Escape immediately hides Flare from any panel and cancels microphone/AI input, not ongoing file operations.
- Connected local drives are discovered automatically for filename and location indexing. Document contents require explicit folder access; hidden/system files, reparse points, cloud-only files, credentials, and common caches remain excluded. See [folder access and assistant commands](docs/FILE_ACCESS.md).
- File tools provide image/PDF conversion, image compression, organization, and older-file review. Selected-file previews, durable history, and Undo protect changes. Balanced trust may skip the extra conversion-output review, never move/cleanup approval.
- Clipboard history starts off. Opt-in retains at most 50 text items for up to 7 days, with clear/disable controls and supported sensitive-content markers.
- Liquid-glass edges, pointer reflections, and elastic controls work in light/dark modes. Turn glass off in Settings; reduced-motion preferences are respected.
- Quick Share creates a 10-minute file link and QR code on a trusted local network. Transfers are unencrypted HTTP, require approval, and can be stopped from the panel or tray. No hosting is required.
- File results include Show in folder, Copy path and Share actions.
- Smart File Actions add a format-aware action tray with prefilled conversion, resizing, PDF page tools, summaries, local OCR and sharing. Outputs still use the review and Undo flow.
- Setup includes optional local OCR and offline Whisper (Fast or Balanced English), including their model data. Choose components in the installer; declined components are removed before setup finishes. Whisper's Microsoft support runtime is a separate opt-in. No installation-time model downloads are needed.
- OCR searches image text and scanned PDFs only when enabled in Search locations and only inside content-allowed folders. Filename indexing runs first; OCR follows as a local second pass. Individual Read text actions ask for session access without silently indexing the file.

Examples: `open YouTube`, `volume max`, `brightness 50 percent`, `12 * (3 + 4)`, `find photos from June 2025`, `photos 2025-06-12`, `search drives D and E for invoice`.

## Intelligence

See [voice recording and Whisper setup](docs/VOICE_WHISPER.md) for the repaired microphone pipeline and Groq transcription option. AI answers now reveal progressively, with reduced-motion support.

Connect Gemini, Groq (Whisper voice), OpenRouter (free models), OpenAI, Anthropic, or local Ollama in Settings. API keys use Windows-backed Electron safeStorage and are never returned to the UI. Ordinary interpretation shares command text, not indexed document contents. Selected-document summaries require file-level consent or an explicit assistant-folder grant before sending an excerpt online. File changes remain reviewable.

When no local result matches, enabled Intelligence offers **Ask AI**. Answers are plain text; ordinary interpretation cannot see indexed files or invent file changes. Explicit summaries can read only the permitted document and reject executable responses. Checking a connection only validates model discovery, not generation quota or availability. Ordinary failed AI requests fall back to Google; local file searches and denied document access do not. The explicit Test response action keeps provider errors visible in Intelligence settings. Normal text requests retry HTTP 503 up to twice with bounded backoff; each attempt may count toward provider usage. Connection tests and speech uploads are not automatically retried. Cancellation stops pending retries.

OpenRouter discovers compatible zero-price text models and offers **Automatic (free models)**. Paid model routes are blocked; free availability and rate limits still apply. See [free AI and music setup](docs/FREE_AI_AND_MUSIC.md). Basic commands tolerate conservative spelling corrections (`bightness 100`, `volum 50`, `opne youtube`) without an AI call. Music commands resolve catalogue links, prefer a registered player, and otherwise open the exact web track. Apple Music lookup needs no credentials; Spotify mapping is best-effort. After submission, unresolved music, missing apps, unsupported AI requests and provider failures fall back to Google with the original query unchanged. Nothing searches the web just from typing, and cancellation never triggers fallback. Opening a track does not guarantee autoplay or bypass a music subscription.

ChatGPT/Claude/Gemini consumer subscriptions are not assumed to include API credits. Voice recognition can use Windows only, Windows with online fallback, or online transcription directly. Online modes are separately opt-in and send recorded audio to the selected OpenAI/Gemini/Groq provider. Speech models are independent of the Intelligence model. Local English recognition uses Windows speech; an English speech pack is required. Transcripts are reviewed before Use command submits a finite action. API availability and charges depend on the provider account.

Ollama setup links to the official installer, detects models, and offers an explicitly approved compact-model download with progress/cancel. Nothing is downloaded automatically.

See [Gemini and voice setup](docs/GEMINI_AND_VOICE.md) for connection testing, microphone selection and provider errors. The separate Test response action asks before making a potentially billable generation request. Model choices come from account discovery rather than an assumed list.

## Scope

See [capabilities](docs/capabilities.md), [architecture](docs/architecture.md), and [verification](docs/verification.md).

This is an initial working build, not a finished autonomous assistant. No arbitrary shell execution, AI permanent deletion, universal conversion, or external-monitor DDC brightness. OCR is English, limited to 12 MB inputs, 160,000 characters and the first 10 PDF pages; accuracy varies. Large indexes, unusual documents, live speech, and provider/model compatibility need further validation.

Recovery does not expire automatically. Undo skips later edits and occupied original locations, and cannot recover missing backups. Removing the data folder can destroy recovery availability.

## Development

```powershell
npm test
npm run test:desktop
npm run test:bugs
npm run test:voice
npm run test:ui
npm run test:features
npm run test:ai-music
npm run test:settings-motion
npm run test:assistant
npm run test:launch-motion
npm run test:local-features
npm run format:check
npm run package
```

Packaging creates an NSIS installer and ZIP under `release/`. Initial dependency/packaging downloads need internet. Desktop tests use isolated data and generated private fixtures, not your personal files. Close Flare before testing to release its global shortcut.
`npm run payloads` verifies and caches the optional model data, official Whisper CPU runtime, and Microsoft-signed support installer under ignored `Files/private/`. The full installer is larger because it includes both English voice models. Review Microsoft runtime redistribution terms before publishing binaries. Portable ZIPs include all optional payloads but keep OCR and offline voice off until enabled in Settings.

Private plans/prompts/references/evidence stay in ignored `Files/private/`. Generated dependencies and builds are ignored too. Do not force-add private material.

## License

Flare source: [MIT](LICENSE). Dependencies and models have separate terms; see [third-party notices](THIRD_PARTY_NOTICES.md) before redistribution.
