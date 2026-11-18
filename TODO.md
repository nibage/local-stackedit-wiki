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
4. [x] **Canvas editing (first stage)**: large-dialog draft editor, cards/connectors, move/resize, metadata-preserving JSON, Undo/Redo, guarded Save/Discard. [ ] Further polish: snap/alignment, keyboard accessibility, advanced source compatibility and comprehensive manual file:// acceptance.
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

## Small usability fixes (November 2026)

- [x] Add an original, local SVG favicon matching the Wiki app branding.
- [x] Preserve preview scroll during live Markdown rendering, following the ending paragraphs when the cursor is near the end, and respect manual preview scrolling.
- [x] After **Expand all**, scroll the tree to the currently selected note or folder.
- [x] Bases interactive table stage: adjustable widths, temporary AND/OR/NOT filter builder, and header sorting. [x] Guarded source YAML editing in the large dialog; [ ] graphical persistence of view configuration and frontmatter updates.

The future Canvas/Bases editing design and the draw.io non-goal are explained in [docs/EDITING_ROADMAP.md](docs/EDITING_ROADMAP.md).

## Editing stability and deletion UX (November 2026)

- [x] Preview renders three seconds after the last editor change; do not rebuild media while the user is continuously typing.
- [x] Cache local image blob URLs and image geometry while the note is open, and follow the editor caret paragraph when rendering.
- [x] Switching between Markdown notes saves dirty text first and blocks on write errors or external changes, without a discard confirm dialog.
- [x] Delete confirms through a centered color-themed dialog, with explicit extra acknowledgement for nonempty folders, no browser confirm.
- [x] Remove residual green focus/box-shadow styling when Delete mode is toggled off with a pointer.

## Current UI and marketing capture (November 2026)

- [x] Use Unicode 📁 closed folder / 📂 expanded folder, 📄 other Markdown notes and 📝 active Markdown note; preserve other attachment icons.
- [x] Darken the light-mode header banner to a calmer burgundy tone.
- [x] Replace 10 old docs screenshots with one genuine current dark-mode screenshot including two real offline Mermaid diagrams. Capture script verifies rendering in Chromium.
- [x] Keep only `docs/app-dark-diagrams.jpg` in README and the lean offline ZIP.

## Canvas editor first-stage implementation (November 2026)

- [x] Writable-only **Edit canvas** in Open larger; Markdown inline embeds remain read-only.
- [x] Add/edit/delete text, file, link and group cards; move/resize; connect/remove edges.
- [x] Undo/Redo, Save/Discard, dirty indicator and confirmation before closing an unsaved draft.
- [x] Keep unknown JSON fields in the source document and protect against external file edits using a content fingerprint.
- [x] Add unit tests and Chromium regression coverage for editor state and guarded writes.
- [ ] Next Canvas refinement: coordinate-preserving zoom during edits, touch/keyboard navigation, richer connector routing and alignment/grid tools.
- [ ] Bases editor remains the next independent stage; draw.io authoring stays external.

## Bases table interaction stage (November 2026)

- [x] Drag and keyboard-resize headers; double-click grips to auto-fit, with per-view temporary widths.
- [x] Temporary property/operator/value filters combined by AND/OR/NOT; Reset filters and sort.
- [x] Sort by clicking table headers without modifying source .base YAML or Markdown notes.
- [x] Chromium smoke and unit tests for filtering, resizing and source immutability.
- [x] Source-preserving `.base` YAML edit mode with explicit Save/Discard, safe subset validation and fingerprint checks.
- [ ] Next: GUI persistence of view configuration and filters; separately guarded per-note Markdown frontmatter property editing. No automatic bulk rewriting.

## Preview export and layout selection (November 2026)

- [x] Highlight the active Editor / Side by side / Preview button in green, including accessible pressed state.
- [x] Compact Export ▾ dropdown anchored to the right side of the live preview pane header.
- [x] Self-contained HTML export of already-rendered DOM with inline computed styles, local image/media data URLs and SVG diagrams; no network calls.
- [x] PDF print-preview route based on that same HTML, with background-color preservation and browser Save as PDF (no extra PDF library or cloud dependency).
- [x] Chromium regression for layout selection, HTML file content, offline reopening and PDF print document.
- [ ] Further fidelity audit for very complex MathJax/Canvas/Bases structures and optional print pagination controls; browser-native PDF/embedded media plugins can vary.

## Editor usability follow-up (November 2026)

- [x] Relocate preview export dropdown into a narrow arrow immediately beside the Preview layout button, without adding a row to the preview header.
- [x] Export PDF using an isolated, locally styled light-theme snapshot while HTML keeps the selected app theme.
- [x] Bases: horizontal view tabs / tools, inline NOT checkbox, fix 1px sticky column header glyph bleed.
- [x] Canvas: no jump when dragging, live connector lines/labels during node movement and resizing, preserve camera after release, and keep resize grips scoped to their card.
- [x] Draw.io: approximation warning shown as a stable overlay without changing the dialog height.
- [ ] Consider React Flow / Svelte Flow (xyflow, MIT license) as future canvas interaction engines. They require a React/Svelte build and extra dependencies unlike this current vanilla JS, offline `file://` app; evaluate bundled size, accessibility, JSON Canvas 1.0 import/export, security and maintenance before any adoption.
- [ ] Compare alternate lightweight SVG/DOM canvas engines and evaluate Obsidian Canvas parity for multi-select, keyboard move, edge routing, group interactions and editing shortcuts.

## StackEdit-style reading and composition (November 2026)

- [x] Add independent StackEdit-inspired theme with wide centred reading column, larger comfortable editor and preview fonts and minimalist light/dark contrast, while keeping System/Light/Dark.
- [x] Expand the one-row Markdown toolbar with task, ordered/unordered, quote, fenced code, table and link controls.
- [x] Add safe searchable local attachment insertion for image, audio, video, PDF, JSON Canvas, Obsidian Bases and draw.io; no upload/network or fabricated paths.
- [x] Print PDF in light mode in a centred ~470pt column with larger body/headings, page margins and print-friendly wrapping.
- [x] Preserve clickable external links and map within-note heading links to exported anchors.
- [ ] Consider richer keyboard shortcuts, visual toolbar icons and a comprehensive export typography/accessibility review on large mixed-media documents.

## Compact editor workspace follow-up (November 2026)

- [x] Center Markdown editor and rendered preview in System, Light, Dark and StackEdit themes without changing document file contents.
- [x] Make StackEdit-style editor and preview closer to the supplied screenshots with ~990 px reading width, 18 px typography and visible line numbers.
- [x] Move current file, mode, view switch, export, Status, Refresh and Save beside the application name in the top header.
- [x] Remove both editor and preview titles to reclaim vertical space; relocate search/save help and renderer status to the footer.
- [x] Stretch a single formatting toolbar across both panes, with independently scrollable icons and always-visible **Scroll sync On/Off** button.
- [x] Add opt-in per-instance persistent two-way scroll syncing in Side by side mode, guarded against preview re-render scroll restoration.
- [x] Add live Markdown source bytes/words/lines/cursor and HTML markup characters/rendered text words/paragraphs to compact bottom status bar.
- [ ] Review very narrow-screen top-header wrapping and visually verify typography against an actual exported StackEdit HTML stylesheet when available (not present with current screenshots/PDF).
- [ ] Canvas editor spacing to be reviewed later after user collects examples.

## Canvas edit-mode UI polish (November 2026)

- [x] Consolidate Canvas path, saved/unsaved text, card/connection counts and gesture help in one metadata row.
- [x] Combine creation, Connect, Undo, Redo, Save, Preview and zoom controls on one line; show back/undo/redo/save icons.
- [x] Replace tall dirty-close prompt with right-aligned **Discard changes / Keep editing** buttons on the same toolbar, maintaining save protection.
- [x] Replace wide/tall scrolling inspector with compact x/y/width/height, property/color/delete rows and separate adjacent connections controls.
- [x] Clicking the currently selected Canvas card again clears selection, including keyboard activation; empty-space click also deselects.

## TOC, reading controls and Canvas layout (November 2026)

- [x] TOC and heading links retain the active Editor / Side by side / Preview mode; navigate caret and/or reader only as visible.
- [x] Add persistent Center, Show line numbers and Text size controls in the shared toolbar immediately left of Scroll sync for all themes.
- [x] Move Canvas Preview/back to attachment footer beside Insert into note.
- [x] Position Canvas actions then divider then zoom; move Save to right with status immediately above.
- [x] Relocate Canvas card/connection count and gesture hint to a joined bottom-left info row with separator.
- [x] Widen the Canvas file input; constrain color to hex-width; stack equal-width Delete card below Delete connection.
- [x] Add Chromium checks for TOC modes, workspace preferences and Canvas inspector/action layout.
