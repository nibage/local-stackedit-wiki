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
- **Move:** toggle the explicit drag-and-drop mode (green outline when enabled). Drag a Markdown note onto a folder. The existing **Move note** dialog opens with a prefilled destination path you can still edit. **The drop does not itself write anything**; click Continue to perform the move. Only existing destination folders are accepted. To move a focused note using the keyboard, press **M** while move mode is enabled.
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
- **Move mode currently supports Markdown notes**, not images or folders as drag sources. Folder rows (including the wiki root) are drop targets. The destination folder must exist.
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
