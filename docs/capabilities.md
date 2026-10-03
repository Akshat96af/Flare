# Capabilities

| Area | Implemented | Limits |
| --- | --- | --- |
| Launcher | Global shortcut/hold detection, tray, single instance, light/dark/system | Physical release ordering and mixed-DPI need manual checks |
| Apps | Start Menu shortcuts, Windows Store IDs and Shell icons | Generic icon fallback if Windows cannot resolve an icon |
| Files/folders | Selected locations, SQLite, exact/fuzzy ranking, usage learning | No elevation; network shares not validated |
| Windows Search | Scoped filename fallback | Depends on Windows service and existing coverage |
| Changes | Watcher-triggered scans reuse unchanged extraction; 10-minute fallback | Not a USN-journal index; metadata is rescanned |
| Content | Text/code/Markdown, PDF text, DOCX/XLSX/PPTX | 12 MB input, 160,000 characters, 150 PDF pages; no OCR |
| Photos | Month/year and ISO dates; EXIF preferred | Labeled modified-date fallback; UTC calendar date fields |
| Bookmarks | Read-only Chrome/Edge Default/Profile N | No Firefox, browser sync, or live watcher |
| Clipboard | Opt-in, 50 text items/7 days, clear/disable | Database not encrypted; no perfect secret detection |
| Voice | English Windows speech, amplitude animation, transcript review, silence/push modes | Speech pack and microphone required; not Whisper |
| AI | BYOK text-model discovery, safe commands/answers, empty-search Ask AI, Ollama | No indexed file access, embeddings, file summaries, or arbitrary automation; discovery does not guarantee generation access |
| Local setup | Official installer link, model detection, approved download with progress/cancel | Installation user-managed; canceled chunks may remain |
| System | Default output volume and laptop brightness | No DDC/CI external-monitor control |
| Organization | Chosen folder's immediate regular files by type/month | 500 candidates; no recursive AI renames |
| Cleanup | Selected files modified over 90 days ago moved to recovery | Age is not proof of disuse; no permanent purge |
| Undo | Durable per-item journal and hashes, global/history restore | Not atomic; missing files/later edits create conflicts; no auto-expiry |

## Conversion

- Image conversion/compression: JPEG, PNG, WebP, AVIF, GIF, TIFF outputs. BMP/HEIC support is not promised.
- Images to PDF; PDF pages to PNG; PDF merge/split/extract. Unencrypted PDFs only; split/render up to 200 pages.
- Images, PDF first page, and document text previews with metadata.
- Up to 100 regular inputs under 100 MB each. Decode pixels and worker time are bounded.
- Originals retained; unique exclusive outputs. Actual achieved sizes are shown. Target compression is best effort and adjusts quality only for JPEG/WebP/AVIF.
- Animation is flattened, EXIF/source metadata is stripped, orientation applied, and JPEG/PDF can lose transparency. Not an archival pipeline.
- No audio/video conversion, Office-to-PDF, archives, or PDF compression.

Same-volume Windows moves use native non-overwriting rename; cross-volume moves copy, hash-verify, then remove the source. Free-space checks are conservative estimates, not final-size guarantees.
