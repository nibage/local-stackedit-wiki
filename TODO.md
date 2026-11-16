# TODO — Obsidian-compatible files and attachments

Reference: [Obsidian accepted file formats](https://obsidian.md/help/file-formats) and [embedding files](https://obsidian.md/help/embeds). See [docs/OBSIDIAN_ATTACHMENTS.md](docs/OBSIDIAN_ATTACHMENTS.md) for what the app actually does.

## Current coverage (RC6)

| Category | Supported extensions | Status |
|---|---|---|
| Notes | `.md`, `.markdown` | Markdown editing, preview and links |
| Images | `.avif`, `.bmp`, `.gif`, `.jpeg`, `.jpg`, `.png`, `.svg`, `.webp` | Tree, preview, embed, insert and move |
| Audio | `.flac`, `.m4a`, `.mp3`, `.ogg`, `.wav`, `.3gp`, audio `.webm` | Tree, HTML5 controls, embeds, insert, move; codec dependent |
| Video | `.mkv`, `.mov`, `.mp4`, `.ogv`, `.webm` | Tree, HTML5 controls, embeds, insert, move; codec dependent |
| PDF | `.pdf` | Tree, browser PDF preview/embed, insert and move |
| JSON Canvas | `.canvas` | Tree and read-only node/edge summary (not an editor) |
| Bases | `.base` | Tree and read-only YAML preview (not Bases queries) |

## Implemented

- [x] Discover and display supported attachments in nested folders and read-only fallback.
- [x] Open selected attachments in a preview dialog, without network or cloud access.
- [x] Support ordinary Markdown links and Obsidian embeds for images, audio, video and PDF.
- [x] Insert appropriate relative links/embeds into a Markdown note.
- [x] Move binary/structured attachments with byte verification, collision protection and conservative Markdown reference migration.
- [x] Honor read-only mode and use existing explicit confirmation for irreversible deletion.
- [x] Keep untrusted SVG in an image context; display Canvas and Bases through text-only DOM rendering.
- [x] Add automated unit and Chromium tests for file-tree discovery, media previews, links, moving and HTML isolation.

## Remaining / intentionally out of scope

- [ ] Full interactive **Canvas** rendering and editing (JSON Canvas graphs and embedded nodes).
- [ ] Full **Bases** views, query/filter execution and editing.
- [ ] Transclusion of Markdown notes via `![[note.md]]` (currently intentionally not implemented).
- [ ] Rewrite links stored *inside* Canvas and Bases when moving an asset; currently only `.md` references are updated.
- [ ] Rich PDF navigation such as `![[document.pdf#page=3]]` with page-level deep links.
- [ ] Browser codec matrix for all audio/video formats across current Chrome/Edge and platforms. Showing an extension does not guarantee decoding or playback.
- [ ] Manual acceptance tests for all supported types via `file://` in the user's Chrome/Edge. Automated Chromium tests emulate directory handles but cannot guarantee every desktop codec or PDF plugin.
- [ ] Optional support for showing unknown extensions, similar to Obsidian's **Show all file types** setting, with safe read-only fallback and no executable preview.

## Non-goals

Do not execute scripts from attachments, automatically upload media, or rewrite media bytes. Avoid interpreting YAML/JSON file contents as HTML. Keep file handling within the user-selected folder, and do not bypass browser permission prompts.

## Future: richer structured diagrams and database views

- [ ] **Canvas (.canvas):** replace the current read-only node/edge count with a safe, visual graph viewer (cards, text and connections, zoom/pan). Full editing and link updates require separate design and regression tests.
- [ ] **Bases (.base):** the current preview only shows the YAML source. Consider a read-only table backed by local Markdown frontmatter first; implement filtering/formulas/views and property editing only with explicit compatibility and data-safety tests. Do not treat a .base file as a database that stores note rows.
- [ ] **draw.io/diagrams.net:** consider an **offline, read-only .drawio viewer** with page support and robust handling of compressed/uncompressed mxfile XML; likely bundle the official viewer rather than invent a partial SVG converter. Verify its licensing, size and external-resource restrictions. Optionally support already-renderable `.drawio.svg` exports as images. Editing can be a separate feature.
