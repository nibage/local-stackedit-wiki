# Obsidian-style attachments (RC6)

This is a lightweight offline browser-based wiki, **not the Obsidian application**. It recognizes the extensions listed on [Obsidian's accepted file formats page](https://obsidian.md/help/file-formats) and additionally supports diagrams.net's `.drawio` files. Full feature parity with either editor is not claimed.

| Type | Extensions | Tree | Preview | Embed in `.md` |
|---|---|---|---|---|
| Markdown | `.md`, `.markdown` | Yes | Markdown editor & preview | Markdown links, Obsidian wiki links; note transclusion not implemented |
| Images | `.avif` `.bmp` `.gif` `.jpeg` `.jpg` `.png` `.svg` `.webp` | Yes | Image dialog, HTML image embeds | `![caption](file.ext)` or `![[file.ext]]` |
| Audio | `.flac` `.m4a` `.mp3` `.ogg` `.wav` `.3gp` (and audio `.webm` by MIME) | Yes | Local `<audio controls>` | `![[file.ext]]` |
| Video | `.mkv` `.mov` `.mp4` `.ogv` `.webm` | Yes | Local `<video controls>` | `![[file.ext]]` |
| PDF | `.pdf` | Yes | Native browser PDF viewer | `![[file.pdf]]` |
| JSON Canvas | `.canvas` | Yes | Read-only visual graph with cards, groups, arrows, zoom/pan and local thumbnails | `![[file.canvas]]` inline graph, or `[[file.canvas]]` to open dialog |
| Bases | `.base` | Yes | Read-only Markdown/frontmatter table (restricted filters) | `![[file.base]]` inline table, or `[[file.base]]` to open dialog |
| diagrams.net | `.drawio` | Yes | Read-only XML graph with page tabs, zoom/pan, compressed pages (basic shapes) | `![[file.drawio]]` inline diagram, or `[[file.drawio]]` / `[diagram](file.drawio)` to open dialog |

Both `.webm` audio and video are detected as `.webm` files in the tree. If the file's MIME type begins with `audio/`, the preview uses the audio player; otherwise the video player. **Recognizing a file is not a promise that its codec is supported** by Chrome/Edge.

## Safety and offline behavior

- Works with a selected local folder through the browser File System Access API, with no required server or cloud.
- Binary file contents are not decoded as Markdown. File moves verify copied bytes and block existing destinations; link migration only rewrites unambiguous references in Markdown notes.
- SVG is shown only through a browser image element. We do not insert raw SVG markup into the HTML document or execute scripts found in SVG files.
- Canvas and Bases previews build only safe DOM text for untrusted labels and content. Oversized structured files are not parsed (2 MB limit). Canvas graphs cap at 400 nodes / 1000 edges, external links are inert text, and only vault-local image thumbnails load as isolated images. Bases YAML is parsed using a restricted safe subset; unsupported filters withhold rows and formula expressions are never evaluated. Viewing never modifies Canvas or Bases data.
- draw.io XML is parsed without document type declarations or external entities; Base64/DEFLATE pages have explicit size limits. The preview constructs only inert SVG elements/text. Custom stencils and images may be approximated, not downloaded.
- Object URLs for local media are revoked when the preview changes/closes. The application does not upload attachments.
- File deletion is permanent (not a recycle bin). Test in `demo-wiki` and maintain backups.
- References inside `.canvas`, `.base` and `.drawio` are **not** updated automatically when moving an asset. Check those files if they contain embedded asset paths.
- Canvas editing, full Bases expression/formula evaluation and property editing, and Markdown-note transclusion remain future features.

## Basic examples

```md
![Screenshot](Images/screen.webp)
![[Images/diagram.svg]]
![[Audio/meeting.mp3]]
![[Videos/tutorial.mp4]]
![[Documents/manual.pdf]]
![[Boards/project.canvas]]
![[Data/issues.base]]
![[Diagrams/flow.drawio]]
```

Click a file in the tree and select **Insert into note** to create a link/embedding automatically. `Move` mode can drag attachments into a different **existing** folder. Ordinary `[file](path)` links can open attachment previews; all resolution stays within the selected wiki.

## Validation

`node --test tests/*.test.cjs` checks all accepted extensions, moves, bytes and link migration. `tests/obsidian-attachments-ui-smoke.py` verifies real DOM media elements and user interactions in Chromium (with mocked File System Access API). Final double-click `file://` behavior and codec playback still depend on your local Chrome/Edge installation.

### Structured-file embeds

Use `![[Attachments/example.canvas]]`, `![[Attachments/example.base]]` and
`![[Attachments/example.drawio]]` to display safe interactive read-only inline
previews within Markdown notes. Ordinary `[[...]]` links still open the larger
viewer when clicked. The tree's **Insert into note** action now inserts these
embeds. A note is limited to six structured embeds for responsiveness; previews
retain the same 2 MB file cap and offline restrictions as the dialogs.
