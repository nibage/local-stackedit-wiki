---
title: Obsidian compatibility examples
tags: [wiki, test, images]
aliases:
  - Obsidian formats
---
# Obsidian: notes, images, and metadata

This document demonstrates **Obsidian-compatible Markdown**. YAML frontmatter remains in the original `.md` file; expand the Properties panel in the preview to see it.

> [!NOTE] Local Markdown wiki
> This preview renders **Obsidian callouts** and [ordinary links](Programming/Python.md).

> [!TIP] Practical tip
> To work directly with files, open the `demo-wiki` directory in Chrome or Edge.

> [!WARNING]- Collapsed warning
> The hidden text becomes visible when you expand this callout.

## Embedding an image with Obsidian syntax

![[schema.png|300]]

The `schema.png` image is actually stored in the `images/` subdirectory. The application resolves it by its unique filename and loads it locally.

You can also specify its path within the wiki:

![[images/schema.png|180]]

## Syntax that should remain ordinary text

Inline code such as `![[schema.png]]` and a fenced code block:

```md
![[schema.png]]
> [!TIP] This is just source code
```

Embedding another note, for example `![[Python.md]]`, is not yet supported as note transclusion. SVG files are displayed only through the safe local attachment renderer.

## Interactive structured-attachment previews

A normal link such as `[[Attachments/example.canvas]]` opens the referenced file. Add `!` (`![[...]]`) to embed its safe preview inside Markdown.

### Obsidian Bases — table

![[Attachments/example.base]]

### JSON Canvas — graph

![[Attachments/example.canvas]]

### diagrams.net — diagram pages

![[Attachments/example.drawio]]
