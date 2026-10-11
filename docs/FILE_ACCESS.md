# Search, folder access and assistant commands

Flare discovers connected fixed and removable Windows drives on startup and once per minute. Filename and path indexes stay local. Windows access-denied folders, protected locations, hidden files, reparse points, offline cloud objects and excluded paths are skipped; Flare does not elevate to bypass filesystem permissions.

## Folder access

In Settings > Search locations, connected drives supply names and locations. Add individual locations when you prefer a smaller index, or disable connected-drive search.

Allowed folders have three levels:

- Names only: no content extraction, visual preview or photo metadata reading.
- Local contents: read and search text locally; preview supported files. Online summaries still ask for consent.
- Assistant allowed: local contents plus permission to send selected documents to the configured AI provider and prepare file tasks. File modifications retain review, original-file protection and recovery. It is not unrestricted shell access or silent deletion.

An untrusted file's preview shows metadata and offers session-only reading or a folder grant. Cloud consent for an individual document applies to that summary request, not every file in the folder. Native dialogs default to Cancel. Folder grants can be revoked immediately; extracted text, FTS snippets and cached photo metadata are purged. Grants reset when the profile moves to a different computer, and drive grants are removed if a discovered volume changes or disconnects.

## Document summaries

Search for a document, open its preview, and choose Summarize document. `summarize budget.pdf` resolves a unique indexed document; ambiguous names stay in local search for selection. `summarize this document` uses the open preview or asks for a file. Text, PDF, DOCX, PPTX, XLSX and CSV extraction is supported. Scanned PDFs without a text layer need OCR elsewhere. Input is capped at 12 MB, extraction at 150 PDF pages and 160,000 characters, and the AI excerpt at 48,000 characters. Summaries disclose excerpt truncation. Document text is untrusted data; the summary route rejects executable model output.

## Commands

Keyboard requests and reviewed voice transcripts use the same finite action registry. Examples:

- `open browser`, `open chrome`, `open youtube`
- `find budget.pdf`, `search inside files for renovation`
- `summarize budget.pdf`
- `play Dil Mera by Yashraj on Spotify`
- `play Shape of You by Ed Sheeran on Apple Music`
- `pause music on spotify`, `resume music on apple music`, `next song`
- `brightness 70`, `volume 30`

Voice's Use command button submits the reviewed transcript, including supported commands when AI is off. Unknown local file searches remain local; unresolved track links retain the original-request Google fallback.

Music lookups verify exact public catalogue links, prefer installed app protocols and otherwise open the web track. Native playback is requested only for the matching player, song title and artist through Windows media sessions. Pause/resume/next/previous target the requested player or the current system session. An unavailable player or declined playback is reported, not guessed. Opening a web track does not guarantee autoplay: browser interaction, login and subscriptions may still be required. Flare does not bypass DRM or subscriptions, and it does not require a Spotify developer secret.

References: [Windows media sessions](https://learn.microsoft.com/en-us/uwp/api/windows.media.control.globalsystemmediatransportcontrolssession.tryplayasync), [Spotify playback API restrictions](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback), [Apple Music subscriptions](https://support.apple.com/guide/music-windows/subscribe-to-apple-music-mus89c4e3d1a/windows).

## Opening motion

Alt+Space resets the hidden renderer and measures its settled height before showing the native window. A ticket prevents cancelled or superseded activations from reopening it. The opening has one monotonic fade/translation, with no glass scaling or independent search-bar movement. Reduced motion bypasses it.
