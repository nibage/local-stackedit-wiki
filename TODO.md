# TODO — Obsidian-compatible files and attachments

This is a **future roadmap**, not a list of currently implemented features.
The official reference is [Obsidian's accepted file formats](https://obsidian.md/help/file-formats) and its [embed documentation](https://obsidian.md/help/embeds), checked on 2026-11-04.

## File format coverage

| Category | Obsidian extensions | Local StackEdit Wiki status |
| --- | --- | --- |
| Notes | `.md` | Supported |
| Images | `.avif`, `.bmp`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.svg`, `.webp` | All listed except **SVG** currently visible/rendered; image moves are supported for the non-SVG formats |
| Audio | `.flac`, `.m4a`, `.mp3`, `.ogg`, `.wav`, `.webm`, `.3gp` | TODO |
| Video | `.mkv`, `.mov`, `.mp4`, `.ogv`, `.webm` | TODO |
| Documents | `.pdf` | TODO |
| Structured Obsidian files | `.canvas` (JSON Canvas), `.base` (Bases) | TODO — separate, more complex viewers |

**Important:** A recognized extension does not guarantee playable audio/video. Playback depends on browser/OS codecs. The `.webm` extension can be audio or video; use actual MIME/content information where possible and handle unsupported codecs gracefully.

## Acceptance checklist for each newly supported file type

- [ ] **File tree:** discover and display the type alongside Markdown notes and images in all nested folders, with an appropriate icon and name. Preserve the existing ignored internal directories (`.git`, `.obsidian`, etc.).
- [ ] **Open/preview:** provide a suitable built-in viewer (image, HTML5 audio/video with controls, PDF, or an explicitly scoped viewer for `.canvas`/`.base`), or clearly communicate unsupported playback rather than showing a blank pane.
- [ ] **Embed/link:** support portable relative links and Obsidian-style `![[attachment.ext]]` embeds in Markdown, in addition to ordinary links. Preserve original note text when no change is required.
- [ ] **Insert into note:** offer a simple way to insert a link/embed from a selected file in the tree. Never embed raw binary bytes into Markdown.
- [ ] **Move:** allow moving the attachment via Move mode (or a compatible alternative), preserve binary bytes, block destination collisions, and update only unambiguous references in notes.
- [ ] **Deletion and read-only:** honor read-only mode, verify delete scope includes attachments, and guard against accidental data loss.
- [ ] **Offline:** no cloud, backend, or external CDN; works with `file://` and File System Access API in Chrome/Edge.
- [ ] **Tests:** cover nested trees, all supported extensions, image/audio/video/PDF preview where supported, links and embeds, binary-integrity checks, moving, read-only and error handling. Test actual Chrome/Edge playback when codec support matters.

## Suggested implementation phases

- [ ] **Phase 1 — SVG image support.** Show `.svg` in the tree and preview/embed it safely. SVG may contain scripts, active links, foreign content or external references: treat it as untrusted; prefer safe isolation and a restrictive policy. Do not blindly inject SVG markup into the DOM.
- [ ] **Phase 2 — audio.** Display the listed audio extensions and expose playback controls, a selected-file preview, Obsidian embeds and relative link insertion. Manage/revoke temporary Blob URLs.
- [ ] **Phase 3 — video.** Add the listed video extensions with playback controls and fullscreen support; handle large media files, codecs and unsupported formats gracefully.
- [ ] **Phase 4 — PDF.** Add `.pdf` to the tree and implement a safe embedded preview, including optional Obsidian `#page=N` references; verify that it works under `file://`.
- [ ] **Phase 5 — JSON Canvas and Bases.** Add `.canvas` and `.base` to the file tree. Evaluate their schemas and licensing independently; prefer a safe read-only preview first. Do not claim full Obsidian feature parity without implementation.

## Explicit non-goals for this TODO

- No promise that every codec can play in every browser.
- No changes to source media encoding or user files just to display them.
- No automatic import/copy from outside the selected wiki without user permission.
- No change to the existing markdown/images workflow until the new behavior passes regression tests.

Current baseline (RC5.2): Markdown, math, Mermaid, ABCjs, syntax highlighting, and locally linked PNG/JPG/JPEG/WebP/GIF/BMP/AVIF images. SVG, audio, video, PDF, Canvas and Bases are not yet supported as equivalent previewable attachments.
