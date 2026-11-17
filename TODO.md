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
| JSON Canvas | `.canvas` | Tree and read-only visual graph (not an editor) |
| Bases | `.base` | Tree and read-only Markdown/frontmatter tables with restricted filters |
| diagrams.net | `.drawio` | Tree, read-only multi-page XML graph (basic shapes; no editor) |

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
- [ ] Rewrite references stored *inside* Canvas, Bases and draw.io when moving an asset; currently only `.md` references are updated.
- [ ] Rich PDF navigation such as `![[document.pdf#page=3]]` with page-level deep links.
- [ ] Browser codec matrix for all audio/video formats across current Chrome/Edge and platforms. Showing an extension does not guarantee decoding or playback.
- [ ] Manual acceptance tests for all supported types via `file://` in the user's Chrome/Edge. Automated Chromium tests emulate directory handles but cannot guarantee every desktop codec or PDF plugin.
- [ ] Optional support for showing unknown extensions, similar to Obsidian's **Show all file types** setting, with safe read-only fallback and no executable preview.

## Non-goals

Do not execute scripts from attachments, automatically upload media, or rewrite media bytes. Avoid interpreting YAML/JSON file contents as HTML. Keep file handling within the user-selected folder, and do not bypass browser permission prompts.

## Future: richer structured diagrams and database views

- [x] **Canvas (.canvas):** read-only visual graph with cards, connections, groups and zoom/pan. [x] Safe Markdown card formatting; [x] vault-local Markdown note excerpts inside file cards. Editing/link updates require separate design and regression tests.
- [x] **Bases (.base):** read-only tables backed by local Markdown frontmatter, multiple table views and basic filters. [ ] Full expression/formula compatibility, alternative view layouts and property editing. A .base file is not a database storing note rows.
- [x] **draw.io/diagrams.net first-stage:** offline read-only `.drawio` graph with multipage UI and decompression of the official compressed format. Basic shapes/connections are drawn as safe SVG, no network or embedded code. [ ] Full-fidelity official viewer integration after security/license/size audit (current upstream bundle ~4.9 MB and can refer to hosted assets); complex stencils/layout currently approximate. `.drawio.svg` / `.drawio.png` remain normal images. **No draw.io editing is planned.**

## Ordered implementation roadmap — advance in these stages when requested

1. [x] **Canvas read-only viewer (first stage)**: graph cards, groups, edges, labels/colors, pan and zoom, vault-local image thumbnails, no remote content. Sanitized Markdown is displayed in text cards. Next: richer note-file content previews.
2. [x] **Bases read-only table (first stage)**: safe subset YAML, local Markdown/frontmatter, table views, columns, limits, supported filters and sorting; unsupported formulas and expressions identified.
3. [x] **draw.io/diagrams.net read-only first stage**: local `.drawio` graph with pages, compressed/uncompressed mxfile support and no remote/script loading; compatibility of advanced stencils is limited and tracked above.
4. [ ] **Canvas editing** (optional, after the viewers): manipulate cards and edges and save JSON Canvas safely with conflict checks and undo/redo.
5. [ ] **Bases editing** (optional): modify table views/properties without unsafe bulk rewrites, preserving Markdown/frontmatter and migration semantics.

**Explicit non-goal:** do not build a `.drawio` editor; keep authoring in the official diagrams.net desktop/web application. Do not implement editors just because the read-only format is supported.

## Other planned improvements

- [x] Make MathJax mathematics selectable directly using the browser's native MathML text renderer; retain MathJax context menu. [ ] Review differences in fonts/complex formulas and optional fallback on older browsers.
- [ ] Evaluate optional `.md` OS associations via an installable offline PWA (HTTPS origin and File Handling API) or small signed native wrapper for Windows/Linux. Retain support for plain portable `file://` and don't seize default associations without an explicit user choice.

## Sidebar navigation refinements (November 2026)

- [x] Make delete a single right-pinned, accessible trash icon in the tree viewport, independent of long filenames and nesting depth.
- [x] Separate **Contents** from **Links**; show **Out-links** and **In-links** with individual source positions and contextual Back navigation.
- [x] Use consistent neutral sidebar text colors, gray light-mode active tabs, a distinctive note star, and a simple ASCII arrow on Move.
- [ ] Extend link-position matching to nonstandard Markdown constructs (nested links, complex HTML) and build an optional dedicated external-URLs list.

## Release and usability cleanup (November 2026)

- [x] Lean GitHub Actions release ZIP: app runtime, renderer licenses, README and selected real screenshots only; no tests, dev tooling, demo vault or historic reports.
- [x] README marketing overview with authentic project screenshots, followed by install/technical documentation.
- [x] Renderer status/diagnostics are concise when all dependencies are already bundled.
- [x] Contents jumps to the editor cursor even from Preview-only, without relying on the previous clicked heading.
- [x] Opt-in hover trash via **- Delete**; green highlight and existing confirmations retained.
- [x] Guarded folder drag/drop moves with byte verification and conservative note-link migration.
- [x] Canvas local Markdown file cards display bounded, sanitized note excerpts.
- [ ] Full Canvas editor: separate design, save conflicts, undo/redo and change tracking.
- [ ] Full Bases editor: safe property updates across Markdown frontmatter with explicit conflict handling.

## Embedded previews and sidebar actions (November 2026)

- [x] All four file action buttons share a single row, including narrow sidebar layouts.
- [x] Safe inline read-only Canvas, Bases and draw.io previews use Obsidian embed syntax `![[path]]` with a larger viewer action; ordinary links still open the dialog.
- [x] Include all three embeddable formats in demo-wiki and Insert into note.
