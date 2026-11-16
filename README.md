# Local StackEdit Wiki

**A self-contained offline Markdown wiki editor for Chrome and Edge.** Open `index.html` directly from disk; no server, cloud account or installation is required.

## Quick start

1. Unzip the **complete offline distribution** into its own folder.
2. Double-click `index.html` in Chrome or Edge.
3. Optionally check **Open read-only**, then click **Open folder** and select the root of a test wiki (for example the included `demo-wiki`).
4. Navigate the file tree, edit `.md` notes, and click **Save**. Changes are written directly to the chosen files. Keep a backup of important notes before your first write.

Chrome/Edge may ask to grant access to a folder when reopening it. Local storage and IndexedDB are scoped to the full `index.html` installation path so separate installs keep independent settings.

## Editing and navigation

- **Files / Full-text / Links:** browse notes and Obsidian-compatible attachments, search note contents, view a document outline and backlinks.
- **+ Note / + Folder:** enter the new name inline in the tree; Enter confirms, Escape cancels. Double-click a note in the tree to rename it.
- **Move:** toggle drag-and-drop mode (green outline when enabled). Drag a Markdown note **or supported attachment** onto an existing folder to move it immediately, without a confirmation. Matching Markdown and Obsidian references are updated where unambiguous; if a conflict is detected, the operation is blocked. Use **M** on a focused Markdown note to enter a destination manually. Keep a backup: updating multiple linked notes is not atomic.
- **Refresh:** rebuilds the folder tree and reloads the current note (asks before discarding unsaved edits).
- **Editor / Side by side / Preview:** choose how to view Markdown.
- **Theme:** System, Light or Dark; changes are remembered for this installation.
- **Open read-only:** open notes without write access. Moving, creating, editing and deleting are disabled.
- **Delete:** a confirmation is required. Deleting a nonempty folder may require two confirmations and is **permanent**; this is not a recycle bin. Always keep a backup.

## Offline rendering

The complete offline distribution bundles **marked, CodeMirror, MathJax, Mermaid, ABCjs and Prism**. Markdown, mathematics, diagrams, musical notation and syntax highlighting work without internet access. Images, audio, video, PDFs, JSON Canvas and Bases files inside the selected wiki are visible in the tree. Open a file to preview it and insert a relative link into a Markdown note. Obsidian-style embeds such as `![[audio.mp3]]`, `![[movie.mp4]]` and `![[manual.pdf]]` use local browser viewers. SVG images are displayed using `<img>`, never injected as executable SVG markup. See [`docs/OBSIDIAN_ATTACHMENTS.md`](docs/OBSIDIAN_ATTACHMENTS.md).

Developer/source checkouts can contain placeholder renderer files instead of bundled Mermaid and ABCjs distributions. Use `.github/workflows/offline-release.yml` to build an audited complete offline ZIP. Details: [`docs/RENDERERS.md`](docs/RENDERERS.md). Do not confuse a development checkout with the complete offline ZIP.

## Safety and limitations

- File moves update unambiguous Markdown and Obsidian wiki links. Multi-file operations cannot be truly atomic through the browser File System Access API; keep a backup.
- **Move mode supports Markdown notes and all listed Obsidian attachments**, including SVG, audio, video, PDF, Canvas and Bases. Folder rows (including the wiki root) are drop targets. The destination folder must already exist. Extension changes and destination collisions are blocked. Only unambiguous Markdown references are updated; references inside Canvas/Bases are not rewritten. The operation is not atomic.
- The source notes are never sent to a server. The application is designed to run over `file://` on supported Chrome/Edge installations.
- Browser support for directory writing varies. Check `tools/test-file-access.html` if opening a folder fails.
- The editor uses CodeMirror rather than the original StackEdit `cledit` editor.

## Development and validation

```sh
node --test tests/*.test.cjs
python tests/offline-release-build.test.py
python tests/rc5-ui-smoke.py
python tests/real-renderers-release-smoke.py --zip local-stackedit-wiki-offline.zip
```

Playwright and a Chromium binary are required for browser smoke tests, not for ordinary use. The GitHub Actions release workflow performs the complete offline build and its mandatory renderer, layout and interaction tests.

Historical development notes in Czech are preserved in [`docs/CHANGELOG_LEGACY_CS.md`](docs/CHANGELOG_LEGACY_CS.md).

## RC5.1: Using a Git checkout offline

The pull request that adds RC5.1 also includes a dedicated GitHub Actions workflow
(`vendor-offline-renderers.yml`) which fetches the **exact pinned** Mermaid 8.9.2
and ABCjs 6.4.4 bundles, validates npm SHA-512 and the pinned Mermaid SHA-512,
then commits the real assets to the pull request branch. Do not merge the PR
until this workflow completes and the files in `vendor/` have realistic sizes
(around 848 KB for Mermaid and 483 KB for ABCjs, rather than ~210-byte stubs).

Locally, `python tools/vendor-renderers-for-repo.py --check` verifies these
assets without network access. The download/install mode is intended for
maintainers, not ordinary users. Subsequent `git clone` and `git pull` can
load renderers without a build step or Internet access.

Drag and drop while **Move** mode is enabled now moves immediately, without
an application modal or a browser `confirm`. Existing-file collisions,
external changes, active unsaved edits and migration failures still block
unsafe moves; move-and-backlink updates are not atomic. Keep a Git backup.
Manual path entry (keyboard **M**) still uses its dialog.

## RC5.2: Image moves and media support

Image files can now be dragged to folders in Move mode. Binary bytes are verified before deletion of the source; relative Markdown image links, normal links to an image, and Obsidian image embeds are updated conservatively. Unsupported HTML `src` strings, ambiguous references and references inside code blocks are not rewritten. Keep a Git backup when moving shared assets.

Since RC6, local audio/video/PDF embeds, SVG images and read-only JSON Canvas/Bases previews are supported. Full Canvas editing, Bases queries and cross-file reference rewriting in Canvas/Bases are not supported. Available playback codecs still depend on Chrome/Edge and the operating system. See the attachment guide.

## RC6: Obsidian attachments in the file tree

The following file extensions now appear alongside notes: images (`avif bmp gif jpeg jpg png svg webp`), audio (`flac m4a mp3 ogg wav 3gp`), video (`mkv mov mp4 ogv webm`), PDF (`pdf`), JSON Canvas (`canvas`) and Bases (`base`). Audio-only WebM files are previewed with an audio player when their MIME type identifies them as audio. Double-clicking or selecting an asset opens a local preview dialog. The **Insert into note** button adds a relative Markdown/Obsidian embed or link; new content never leaves the chosen folder.

**Limitations:** The Canvas viewer is a read-only node summary and Bases is a read-only YAML preview (not the full Obsidian editing engine). Audio/video playback depends on installed browser codecs. PDF preview depends on browser PDF support. Moving files updates Markdown links where unambiguous, not cross-references stored inside Canvas/Bases. See [`docs/OBSIDIAN_ATTACHMENTS.md`](docs/OBSIDIAN_ATTACHMENTS.md).

## Tree navigation and automatic saving

Use **Expand all** or **Collapse all** at the bottom of the Files panel to open or close every folder in the navigation tree. Filtering by name temporarily expands matching branches. Folder arrows and note dots are emphasized in both themes.

Markdown edits are saved automatically to the original file every **5 seconds**, provided the wiki is open in read/write mode and a note has changed. You can still press **Ctrl+S** or click **Save**. Autosave uses the same fingerprint/conflict protection as manual saving, never overwrites detected external changes, and does not run while another file operation is in progress. A failed automatic save remains unsaved and is not retried until the text changes or Save is clicked. Read-only mode never autosaves.

Routine "Opened note" banners have been removed; warnings and file-operation messages appear temporarily **beside the Local StackEdit Wiki logo**, never over file controls. Long messages are ellipsized in narrow windows; hover the message to read the full text.

## Large trees and sidebar width (RC6.1)

The Files navigation pane can be resized by dragging its separator, or by focusing the separator and pressing **Home** (minimum), **End** (maximum), or the left/right arrow keys. Double-click resets it to 255 px. Its maximum width is approximately **70% of the workspace**, while leaving at least **390 px** to the editor/preview where the viewport allows. The requested width is remembered when the window is resized.

Long filenames and deeply nested paths stay on a single line. The tree scrolls **vertically and horizontally**, without resizing the editor or the bottom Expand/Collapse controls. Test in `demo-wiki/Test-stromu-a-posouvani`. The Move button's green outline no longer changes the button border thickness or displaces other controls.

## SVG scores, copyable mathematics, and opening Markdown from the OS

The **Save SVG** button below Mermaid diagrams and ABCjs notation exports a standalone SVG with explicit dimensions where the original renderer used responsive sizing. Both downloads are checked in Chromium against actual offline-bundled renderer output. Downloads are not written to the wiki automatically.

MathJax currently uses the **SVG** output renderer: the visible glyphs are vector paths, so browser drag-selection of the rendered letters is not supported. You can right-click a rendered formula and use **Show Math As → TeX Commands** in MathJax's context menu to access and copy its source. Switching to selectable CommonHTML requires bundling and verifying the correct offline fonts (tracked in TODO); it is not yet enabled.

An ordinary `file://` `index.html` cannot register itself as the operating system's handler for `.md`. A future optional installable PWA (secure origin) or a lightweight native desktop wrapper could do that, while retaining offline document storage. See TODO; no new installation or file-handler permissions are introduced in this update.
