# Local StackEdit Wiki

**A self-contained offline Markdown wiki editor for Chrome and Edge.** Open `index.html` directly from disk; no server, cloud account or installation is required.

## Quick start

1. Unzip the **complete offline distribution** into its own folder.
2. Double-click `index.html` in Chrome or Edge.
3. Optionally check **Open read-only**, then click **Open folder** and select the root of a test wiki (for example the included `demo-wiki`).
4. Navigate the file tree, edit `.md` notes, and click **Save**. Changes are written directly to the chosen files. Keep a backup of important notes before your first write.

Chrome/Edge may ask to grant access to a folder when reopening it. Local storage and IndexedDB are scoped to the full `index.html` installation path so separate installs keep independent settings.

## Editing and navigation

- **Files / Full-text / Links:** browse notes and images, search note contents, view a document outline and backlinks.
- **+ Note / + Folder:** enter the new name inline in the tree; Enter confirms, Escape cancels. Double-click a note in the tree to rename it.
- **Move:** toggle drag-and-drop mode (green outline when enabled). Drag a Markdown note **or image** onto an existing folder to move it immediately, without a confirmation. Matching Markdown and Obsidian references are updated where unambiguous; if a conflict is detected, the operation is blocked. Use **M** on a focused Markdown note to enter a destination manually. Keep a backup: updating multiple linked notes is not atomic.
- **Refresh:** rebuilds the folder tree and reloads the current note (asks before discarding unsaved edits).
- **Editor / Side by side / Preview:** choose how to view Markdown.
- **Theme:** System, Light or Dark; changes are remembered for this installation.
- **Open read-only:** open notes without write access. Moving, creating, editing and deleting are disabled.
- **Delete:** a confirmation is required. Deleting a nonempty folder may require two confirmations and is **permanent**; this is not a recycle bin. Always keep a backup.

## Offline rendering

The complete offline distribution bundles **marked, CodeMirror, MathJax, Mermaid, ABCjs and Prism**. Markdown, mathematics, diagrams, musical notation and syntax highlighting work without internet access. Images inside the wiki are visible in the file tree and can be inserted as relative Markdown links.

Developer/source checkouts can contain placeholder renderer files instead of bundled Mermaid and ABCjs distributions. Use `.github/workflows/offline-release.yml` to build an audited complete offline ZIP. Details: [`docs/RENDERERS.md`](docs/RENDERERS.md). Do not confuse a development checkout with the complete offline ZIP.

## Safety and limitations

- File moves update unambiguous Markdown and Obsidian wiki links. Multi-file operations cannot be truly atomic through the browser File System Access API; keep a backup.
- **Move mode supports Markdown notes and PNG/JPG/JPEG/WebP/GIF/BMP/AVIF images** as drag sources. Folder rows (including the wiki root) are drop targets. The destination folder must already exist; other file types are not draggable. Image formats are not converted when moved. SVG is not currently supported as a local image asset.
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

Audio, video and PDF embedding are not yet implemented in this app. Obsidian supports additional file formats, but they should not be assumed to work here until separately implemented and tested.

## Roadmap

Future attachment support, matching Obsidian's official file format list, is tracked in [TODO.md](TODO.md). The checklist covers file-tree visibility, safe local previews, Markdown/Obsidian embeds, moves and links, and browser compatibility. The TODO does **not** mean these formats already work in this app.
