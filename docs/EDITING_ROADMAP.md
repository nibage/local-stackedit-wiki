# Editing roadmap — Canvas, Bases and draw.io

This file records the implementation plan for later work. **Current shipped viewers are read-only**, including the **Open larger ↗** dialogs. Opening a dialog does not imply that its file can be edited.

## First: keep the current renderer safe

Before adding editors, complete the preview scrolling and tree-navigation fixes (see TODO). Preserve the static `file://` offline runtime, immutable source during read-only previews, bounded file sizes, and the verified GitHub Actions ZIP.

## Stage 1 — Canvas editor inside Open larger

**First stage implemented on `feature/canvas-editor-stage1`:** independent JSON draft with unknown-field preservation, writable-only large-dialog editing, card move/resize and property fields, new cards and connections, Undo/Redo, Save/Discard, and content-fingerprint conflict blocking. The inline viewer stays read-only. Further keyboard, touch, connector and interaction polish remains open; manual `file://` acceptance is still required.

A separate **Edit canvas** action becomes available only in writable mode, not inside a Markdown inline embed.

1. **Lossless document model:** parse the raw JSON Canvas 1.0 object and preserve unknown top-level, node and edge fields. The current `LocalWikiCanvas.cleanGraph` intentionally normalizes/skips unsupported items for display; **do not serialize that display model over the original**.
2. **Draft mode:** editing works on an in-memory structured clone. Preview and edit modes are explicit, with **Save**, **Discard**, unsaved-changes indicator and leaving/closing confirmation.
3. **Minimum interactions:** select/move/resize nodes; add text, file, link, and group cards; edit card text/color; create/delete connectors; ensure stable IDs, correct edge endpoints and non-overlapping controls. Zoom/pan remains operational and does not silently modify document coordinates.
4. **Undo and redo:** command history for user transformations; keyboard shortcuts, selection handling, deletion confirmation.
5. **Safe file writes:** extend the File System Access bridge with a bounded `writeAsset(path, text, expectedFingerprint)` and `readAssetSnapshot(path)`. Compare original fingerprint and bytes before writing; refuse an externally changed file and offer Reload / Save as. Preserve other fields and avoid partial writes. Existing asset moves and note autosave must not race edits.
6. **Verification:** unit tests of JSON Canvas round trips (unknown fields retained), invalid/dangling edges, write conflict, file permission, UTF-8 and size limits; Chromium tests for dragging, resizing, adding connections, undo/redo, Save/Discard, reopening and read-only mode. No execution of embedded scripts or network requests.

Follow-up: snap-to-grid, align/distribute, copy/paste, keyboard navigation, richer media preview.

## Stage 2 — Bases interaction, then editor

**Stage 2a implemented in `feature/bases-table-interactions`:** per-view temporary widths (drag, keyboard or auto-fit), safe in-memory filter builder, AND/OR/NOT, header sorting and Reset; source YAML and note frontmatter are never modified. A dedicated guarded YAML editor is still a separate stage.

Remember: `.base` describes **views**, while the **rows are Markdown notes with YAML frontmatter**. Saving a table property therefore modifies the corresponding `.md` file, not a database table inside the `.base`.

**Stage 2a: non-destructive interaction**

1. Let users drag header edges to resize a column, and double-click to auto-fit. Keep widths in per-view client settings first; avoid silently editing the `.base`.
2. Add an explicit **Filter** toolbar with property, operator and value, supporting AND/OR/NOT combinations for the existing safe filter subset. Distinguish temporary table filtering from saved `.base` filters.
3. Add simple sorting and a **Reset filters** command, plus clear status for unsupported formulas or expressions. No expression `eval`.
4. Implement in both the large viewer and inline read-only embeds only when safe for keyboard and focus; embedded previews must never write automatically.

**Stage 2b: write support in Open larger**

1. Add **Edit Base** for table view configurations, with Save/Discard and conflict detection on the `.base` fingerprint. Preserve comments, quoting, unknown fields and unsupported YAML when making changes: use a reviewed local YAML concrete-syntax-tree parser or narrow source-preserving edits. The existing safe subset parser is a **reader**, not a round-trip YAML serializer.
2. Support adding/editing/removing global and per-view filters, displayed columns, view names and sort rules, while retaining unfamiliar sections untouched.
3. For property cell edits, load the source Markdown note, preserve its frontmatter and body, require expected-fingerprint write, and reject conflicts. Don't rewrite unrelated notes or properties.
4. Test multiple views, mixed YAML quoting/comments, date/numeric/text/boolean/tags properties, unknown formulas, invalid filters, read-only mode, simultaneous edits and rollback/error reporting.

## draw.io — keep view-only in this wiki

Embedding the full diagrams.net editing application is **not currently recommended**. The first-stage viewer intentionally supports a safe offline subset of mxGraph XML, while the complete editor has a much larger asset/stencil/runtime and a different security surface. A custom partial editor would risk damaging advanced diagrams and compressed multipage files.

Prefer an **Open/edit externally** user flow with the official offline [draw.io Desktop](https://www.drawio.com/docs/security/diagrams-offline/) application. The browser should display the path and instructions or offer a downloaded copy; browsers cannot reliably launch a specific desktop executable directly from `file://`. After the external edit, use **Refresh** to reread the diagram.

Only reconsider an embedded official editor if there is a strong use case and a separate architecture, licensing and offline-isolation review, with full fidelity/round-trip regression tests.

## Acceptance policy

- Never overwrite unrecognized source constructs to approximate parity.
- Keep the user's content in their selected wiki folder, not a remote backend.
- Read-only mode always disables writing.
- Any save operation checks external modification, handles failure visibly and leaves a recoverable original.
- Preserve the project's lean release ZIP and existing offline renderer/SVG safety checks.
- Prefer one focused PR per stage. All unit tests, full Chromium smoke suite and offline release audit must be green before merge.
