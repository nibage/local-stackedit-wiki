(function () {
  'use strict';
  const bridge = window.LocalWikiFS.createBridge();
  const operations = window.LocalWikiOperationGuard.create();
  const $ = id => document.getElementById(id);
  const ui = {
    notice: $('notice'), open: $('open-folder'), readonlyToggle: $('read-only-toggle'), picker: $('directory-input'),
    refresh: $('refresh'), save: $('save'), tree: $('tree'), editor: $('editor'),
    preview: $('preview'), filename: $('filename'), dirty: $('dirty'), search: $('search'),
    mode: $('mode'), rootName: $('root-name'), count: $('count'), grid: $('editor-grid')
  };
  const editor = window.LocalWikiEditor.make(ui.editor);
  const wikiIndex = window.LocalWikiIndex.createIndex(bridge);
  let indexPromise = null;
  let activePath = null, originalText = '', fingerprint = null, lineEnding = '\n', hasBOM = false;
  let expanded = new Set(['']), renderTimer = null, renderSequence = 0;
  let inlineDraft = null, imageDialogURL = null, pendingMovePath = null;
  let selectedFolder = '', treeClickTimer = null;
  let moveEnabled = false, draggedPath = null;
  let blobURLs = [], selectedMode = 'split';
  const SIDEBAR_MIN = 190, SIDEBAR_MAX = 520, SIDEBAR_DEFAULT = 255;
  const SAFE_IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
  // Browser file:// origins may share storage across *different* index.html paths.
  // Never read legacy unscoped keys from another copy of the app.
  function safeStored(key, fallback) {
    try { return localStorage.getItem(window.LocalWikiScope.storageKey(key)) || fallback; } catch (_) { return fallback; }
  }
  function safeStore(key, value) {
    try { localStorage.setItem(window.LocalWikiScope.storageKey(key), value); } catch (_) { /* file:// storage may be unavailable */ }
  }
  const themeSelect = $('theme-select');
  const mediaDark = window.matchMedia('(prefers-color-scheme: dark)');
  const initialTheme = safeStored('local-wiki-theme', 'system');
  themeSelect.value = ['light', 'dark', 'system'].includes(initialTheme) ? initialTheme : 'system';
  function applyTheme() {
    document.documentElement.dataset.theme = themeSelect.value === 'system'
      ? (mediaDark.matches ? 'dark' : 'light') : themeSelect.value;
  }
  themeSelect.addEventListener('change', () => { safeStore('local-wiki-theme', themeSelect.value); applyTheme(); });
  if (mediaDark.addEventListener) mediaDark.addEventListener('change', applyTheme);
  applyTheme();
  const resizer = $('sidebar-resizer');
  function setSidebarWidth(width) {
    const value = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, Math.round(width)));
    document.documentElement.style.setProperty('--sidebar-width', value + 'px');
    resizer.setAttribute('aria-valuenow', String(value));
    safeStore('local-wiki-sidebar-width', String(value));
  }
  const storedWidth = Number(safeStored('local-wiki-sidebar-width', String(SIDEBAR_DEFAULT)));
  setSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : SIDEBAR_DEFAULT);
  resizer.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault();
    resizer.setPointerCapture(event.pointerId);
    resizer.classList.add('dragging');
  });
  resizer.addEventListener('pointermove', event => {
    if (resizer.hasPointerCapture(event.pointerId)) setSidebarWidth(event.clientX - document.querySelector('.workspace').getBoundingClientRect().left);
  });
  const endDrag = event => {
    if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId);
    resizer.classList.remove('dragging');
  };
  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);
  resizer.addEventListener('dblclick', () => setSidebarWidth(SIDEBAR_DEFAULT));
  resizer.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = Number(resizer.getAttribute('aria-valuenow')) || SIDEBAR_DEFAULT;
    const next = event.key === 'Home' ? SIDEBAR_MIN : event.key === 'End' ? SIDEBAR_MAX :
      current + (event.key === 'ArrowRight' ? 20 : -20);
    setSidebarWidth(next);
  });
  function updateMoveModeUI() {
    const toggle = $('rename-file');
    const allowed = bridge.getMode() === 'readwrite' && !operations.isBusy();
    if (bridge.getMode() !== 'readwrite') moveEnabled = false;
    toggle.disabled = !allowed;
    toggle.classList.toggle('move-enabled', moveEnabled);
    toggle.setAttribute('aria-pressed', String(moveEnabled));
    toggle.setAttribute('aria-label', moveEnabled ? 'Disable drag and drop mode' : 'Enable drag and drop mode');
    toggle.title = moveEnabled
      ? 'Drag and drop a Markdown note or image onto a folder to move immediately. Existing destinations and unsaved edits are protected. Press M on a focused note to enter a destination path manually.'
      : 'Enable drag and drop file moves';
    ui.tree.classList.toggle('move-mode-enabled', moveEnabled);
  }
  function clearDragHighlights() {
    ui.tree.querySelectorAll('.tree-drop-target,.tree-drag-source').forEach(
      row => row.classList.remove('tree-drop-target', 'tree-drag-source'));
  }
  function showMoveDialog(path, destination = path) {
    if (!path || !bridge.hasFile(path) || bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    pendingMovePath = path;
    $('move-description').textContent = 'Source note: ' + path;
    $('move-destination').value = destination;
    $('move-dialog').showModal();
    requestAnimationFrame(() => $('move-destination').focus());
  }
  function notice(message, variant = '') {
    ui.notice.textContent = message;
    ui.notice.className = `notice ${variant}`.trim();
  }
  function beginOperation(name) {
    if (!operations.acquire(name)) {
      notice(`An operation is in progress: ${operations.currentOperation()}. Please complete it first.`, 'error');
      return false;
    }
    // Prevent editing a document that may be replaced by a move, open or refresh.
    // Saving is the exception: edits made while a write is in progress remain dirty.
    if (name !== 'save') editor.setReadOnly(true);
    redrawDirty(); updateMoveModeUI();
    return true;
  }
  function endOperation(name) {
    operations.release(name);
    editor.setReadOnly(bridge.getMode() !== 'readwrite' || !activePath);
    redrawDirty(); updateMoveModeUI();
  }
  function isDirty() { return activePath !== null && editor.getValue() !== originalText; }
  function confirmDiscard() {
    return !isDirty() || window.confirm('The current note has unsaved changes. Discard them?');
  }
  function redrawDirty() {
    const dirty = isDirty();
    ui.dirty.textContent = dirty ? '● Unsaved' : '';
    ui.save.disabled = operations.isBusy() || bridge.getMode() !== 'readwrite' || !dirty;
    $('save-status').textContent = dirty ? 'Unsaved changes' : activePath ? 'No unsaved changes' : 'No file';
    $('stats').textContent = `${editor.getValue().length} characters · ${editor.getValue() ? editor.getValue().split('\n').length : 0} lines`;
  }
  function releaseImages() { blobURLs.forEach(url => URL.revokeObjectURL(url)); blobURLs = []; }
  function clearEditor() {
    renderSequence++; clearTimeout(renderTimer); // Cancel delayed render/image updates.
    activePath = null; originalText = ''; fingerprint = null; hasBOM = false;
    editor.setValue(''); editor.setReadOnly(true);
    ui.filename.textContent = 'No note open';
    updateMoveModeUI();
    ui.preview.replaceChildren();
    releaseImages(); redrawDirty();
    $('toc').replaceChildren(); $('backlinks-results').replaceChildren();
  }
  function resolvePathFrom(source, path) {
    try { path = decodeURIComponent(path); } catch (_) { /* Preserve unescaped path. */ }
    return window.LocalWikiFS.relativePath(source, path);
  }
  function findDoc(href) {
    if (!href) return null;
    const parsed = window.LocalWikiNavigation.splitTarget(href);
    if (parsed.anchor !== null && !parsed.path) return activePath;
    const paths = bridge.getFilePaths();
    if (parsed.isWiki) {
      const wanted = parsed.path.trim().replace(/\\/g, '/');
      if (!wanted) return null;
      const withMd = /\.(md|markdown)$/i.test(wanted) ? wanted : `${wanted}.md`;
      const relative = resolvePathFrom(activePath, withMd);
      if (relative && bridge.hasFile(relative)) return relative;
      const exact = paths.find(path => path.toLocaleLowerCase('cs') === withMd.toLocaleLowerCase('cs'));
      if (exact) return exact;
      // Basename-only links are valid only when unique. Never silently choose
      // the first of two identically named notes in different directories.
      const candidates = paths.filter(path =>
        path.split('/').pop().toLocaleLowerCase('cs') === withMd.split('/').pop().toLocaleLowerCase('cs'));
      return candidates.length === 1 ? candidates[0] : null;
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(parsed.path) || parsed.path.startsWith('//')) return null;
    const bare = parsed.path.split('?')[0];
    if (!bare) return null;
    const resolved = resolvePathFrom(activePath, bare);
    if (resolved && bridge.hasFile(resolved)) return resolved;
    if (resolved && !/\.(md|markdown)$/i.test(resolved) && bridge.hasFile(`${resolved}.md`)) return `${resolved}.md`;
    return null;
  }
  function jumpToHeading(anchor) {
    if (anchor === null || anchor === '') return true;
    const h = window.LocalWikiNavigation.findHeading(ui.preview, anchor);
    if (!h) {
      notice(`Heading not found in note: ${anchor}`, 'error');
      return false;
    }
    if (selectedMode === 'edit') setView('split');
    h.scrollIntoView({ behavior: 'instant', block: 'start' });
    return true;
  }
  async function loadImages(imageNodes, sourcePath, sequence) {
    for (const img of imageNodes) {
      const raw = img.dataset.localSource;
      let path = null;
      if (raw && raw.startsWith('obsidian-asset:')) {
        const payload = raw.slice('obsidian-asset:'.length);
        const [targetEncoded, query = ''] = payload.split('?');
        let target;
        try { target = decodeURIComponent(targetEncoded); } catch (_) { target = null; }
        if (target && SAFE_IMAGE.test(target) && !/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(target)) {
          // Obsidian embeds may use a path relative to the note, the wiki root,
          // or just a basename. Basename resolution must be unambiguous.
          const relative = window.LocalWikiFS.relativePath(sourcePath, target);
          if (relative && bridge.hasAsset(relative)) path = relative;
          else if (bridge.hasAsset(target)) path = target;
          else {
            const lowered = target.toLocaleLowerCase('cs');
            const matches = bridge.getAssetPaths().filter(candidate =>
              candidate.toLocaleLowerCase('cs') === lowered ||
              (!target.includes('/') && candidate.split('/').pop().toLocaleLowerCase('cs') === lowered));
            if (matches.length === 1) path = matches[0];
          }
        }
        const width = /^width=(\d{2,4})$/.exec(query);
        if (width && Number(width[1]) >= 32 && Number(width[1]) <= 1600) img.style.width = `${Number(width[1])}px`;
      } else if (raw && !/^([a-z][a-z\d+.-]*:|\/\/|\/)/i.test(raw)) {
        path = resolvePathFrom(sourcePath, raw.split('#')[0].split('?')[0]);
      }
      if (!path || !SAFE_IMAGE.test(path) || !bridge.hasAsset(path)) {
        img.replaceWith(document.createTextNode(`[image missing or ambiguous: ${img.alt || raw || '?'}]`));
        continue;
      }
      try {
        const blob = await bridge.readAsset(path);
        if (sequence !== renderSequence) return;
        const url = URL.createObjectURL(blob);
        blobURLs.push(url);
        img.src = url;
        img.title = path;
      } catch (_) {
        if (sequence === renderSequence) img.replaceWith(document.createTextNode(`[unable to load image: ${raw}]`));
      }
    }
  }
  function renderPreview() {
    clearTimeout(renderTimer);
    renderSequence++;
    const sequence = renderSequence;
    releaseImages();
    if (!activePath) return;
    try {
      let baseStatus = 'Offline Markdown';
      const report = stats => {
        if (sequence !== renderSequence) return;
        const parts = [stats.rendered ? `Diagrams/notation: ${stats.rendered}` : '',
          stats.pending ? `Rendering: ${stats.pending}` : '',
          stats.missing ? `Missing libraries: ${stats.missing}` : '',
          stats.failed ? `Render failures: ${stats.failed}` : ''];
        $('render-status').textContent = [baseStatus, ...parts].filter(Boolean).join(' · ');
      };
      const result = window.LocalWikiRender.render(editor.getValue(), ui.preview, { onDiagramUpdate: report });
      baseStatus = [result.expressions ? `Math: ${result.expressions}` : '',
        result.callouts ? `Callouts: ${result.callouts}` : ''].filter(Boolean).join(' · ') || 'Offline Markdown';
      report(result.diagrams);
      buildToc();
      void loadImages(result.imageNodes, activePath, sequence);
    } catch (err) {
      const p = document.createElement('p'); p.textContent = `Preview failed: ${err.message}`;
      ui.preview.replaceChildren(p);
      $('render-status').textContent = 'Preview error';
    }
  }
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 170); }
  async function selectFile(path, options = {}) {
    if (path === activePath && !options.force) return true;
    if (operations.isBusy()) { notice('A file operation is in progress; switching notes is temporarily disabled.', 'error'); return false; }
    if (!options.skipConfirm && !confirmDiscard()) return false;
    const ticket = operations.beginRead();
    const formerPath = activePath, formerText = editor.getValue();
    try {
      const result = await bridge.read(path);
      if (!operations.isCurrentRead(ticket)) return false;
      if (activePath !== formerPath || editor.getValue() !== formerText) {
        notice('The editor changed during loading. Switching was cancelled to protect unsaved changes.', 'error');
        return false;
      }
      activePath = path; selectedFolder = parentPath(path); fingerprint = result.fingerprint; hasBOM = Boolean(result.hasBOM);
      lineEnding = result.text.includes('\r\n') ? '\r\n' : '\n';
      const normalizedText = result.text.replace(/\r\n?/g, '\n');
      originalText = normalizedText; editor.setValue(normalizedText);
      editor.setReadOnly(bridge.getMode() !== 'readwrite');
      ui.filename.textContent = path;
      updateMoveModeUI();
      $('backlinks-results').textContent = 'Click Find incoming links.'; 
      redrawDirty(); renderTree(); renderPreview();
      ui.preview.scrollTop = 0;
      notice(`Opened note: ${path}`, 'success');
      return true;
    } catch (err) {
      if (operations.isCurrentRead(ticket)) notice(`Cannot open note: ${err.message}`, 'error');
      return false;
    }
  }
  function filteredNode(node, needle) {
    if (!needle) return true;
    if (node.kind !== 'directory') return node.path.toLocaleLowerCase('cs').includes(needle);
    return node.children.some(child => filteredNode(child, needle));
  }
  function parentPath(path) { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
  function basename(path) { return path.split('/').pop(); }
  function combinePath(parent, name) { return parent ? parent + '/' + name : name; }
  function showImage(path) {
    const dialog = $('image-dialog');
    const img = $('image-dialog-preview');
    if (imageDialogURL) { URL.revokeObjectURL(imageDialogURL); imageDialogURL = null; }
    $('image-dialog-path').textContent = path;
    $('image-dialog-title').textContent = basename(path);
    $('image-insert').disabled = bridge.getMode() !== 'readwrite' || !activePath || operations.isBusy();
    $('image-insert').onclick = () => {
      if (imageDialogURL === null || !activePath || bridge.getMode() !== 'readwrite') return;
      const base = parentPath(activePath).split('/').filter(Boolean);
      const target = path.split('/');
      while (base.length && target.length && base[0] === target[0]) { base.shift(); target.shift(); }
      const relative = [...base.map(() => '..'), ...target].join('/');
      const encoded = relative.split('/').map(segment => encodeURIComponent(segment)).join('/');
      editor.cm.replaceSelection('![' + basename(path).replace(/\.(?:png|jpe?g|gif|webp|bmp|avif)$/i, '') + '](' + encoded + ')');
      editor.focus(); dialog.close();
    };
    bridge.readAsset(path).then(file => {
      if (!dialog.open || $('image-dialog-path').textContent !== path) return;
      imageDialogURL = URL.createObjectURL(file);
      img.src = imageDialogURL;
    }).catch(err => notice('Cannot display image: ' + err.message, 'error'));
    dialog.showModal();
  }
  $('image-dialog').addEventListener('close', () => {
    $('image-dialog-preview').removeAttribute('src');
    if (imageDialogURL) { URL.revokeObjectURL(imageDialogURL); imageDialogURL = null; }
  });
  $('image-close').addEventListener('click', () => $('image-dialog').close());
  async function completeDraft(draft, value) {
    if (!inlineDraft || inlineDraft !== draft || draft.finished) return;
    draft.finished = true;
    inlineDraft = null;
    const trimmed = value.trim();
    if (!trimmed) { renderTree(); return; }
    if (draft.kind === 'file' && !confirmDiscard()) { renderTree(); return; }
    // Inline editor accepts a single filename. Paths are composed only from
    // the folder where the draft is visually placed, never from unchecked input.
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      notice('Enter a name only. Create the parent folder first.', 'error');
      renderTree(); return;
    }
    const path = combinePath(draft.parent, trimmed);
    if (!beginOperation('create')) { renderTree(); return; }
    let created = null;
    try {
      if (draft.kind === 'file') created = await bridge.createFile(path);
      else created = await bridge.createDirectory(path);
      invalidateWikiIndex();
      expanded.add(draft.parent);
      if (draft.kind === 'directory') { expanded.add(created); selectedFolder = created; }
      renderTree();
    } catch (err) { notice('Cannot create item: ' + err.message, 'error'); renderTree(); }
    finally { endOperation('create'); }
    if (created) {
      if (draft.kind === 'file') {
        clearEditor(); // Discard was explicitly confirmed before file creation.
        if (await selectFile(created)) notice('Note created: ' + created, 'success');
      } else notice('Folder created: ' + created, 'success');
    }
  }
  function startDraft(kind) {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    const folder = selectedFolder;
    inlineDraft = { parent: folder, kind, finished: false };
    ui.search.value = '';
    setSideTab('files');
    const parts = folder.split('/').filter(Boolean);
    for (let i = 0; i <= parts.length; i++) expanded.add(parts.slice(0, i).join('/'));
    renderTree();
  }
  function startInlineRename(node) {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy() || node.kind !== 'file') return;
    inlineDraft = { kind: 'rename', path: node.path, parent: parentPath(node.path), finished: false };
    ui.search.value = ''; setSideTab('files'); renderTree();
  }
  function makeNameInput(draft, parent) {
    const input = document.createElement('input');
    input.className = 'tree-name-input'; input.type = 'text'; input.spellcheck = false;
    input.setAttribute('aria-label', draft.kind === 'rename' ? 'Rename file' : 'New item name');
    input.value = draft.kind === 'rename' ? basename(draft.path) : (draft.kind === 'file' ? 'New note.md' : 'New folder');
    let cancelled = false;
    input.addEventListener('click', event => event.stopPropagation());
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); cancelled = true; draft.finished = true; inlineDraft = null; renderTree(); }
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    });
    input.addEventListener('blur', () => {
      if (cancelled || draft.finished) return;
      if (draft.kind === 'rename') {
        draft.finished = true; inlineDraft = null;
        const next = input.value.trim();
        renderTree();
        if (next && next !== basename(draft.path)) {
          if (next.includes('/') || next.includes('\\')) notice('Inline renaming accepts only the filename.', 'error');
          else void renamePath(draft.path, combinePath(draft.parent, next));
        }
      } else void completeDraft(draft, input.value);
    });
    parent.append(input);
    requestAnimationFrame(() => {
      if (!input.isConnected) return;
      input.focus();
      const dot = input.value.lastIndexOf('.');
      input.setSelectionRange(0, draft.kind !== 'directory' && dot > 0 ? dot : input.value.length);
    });
  }
  function renderTree() {
    const root = bridge.getTree();
    const needle = ui.search.value.trim().toLocaleLowerCase('cs');
    ui.tree.replaceChildren();
    const make = (node, parent) => {
      if (!filteredNode(node, needle)) return;
      const row = document.createElement('button');
      row.type = 'button'; row.className = 'tree-row';
      if (node.kind === 'file' && node.path === activePath) row.classList.add('selected');
      if (node.kind === 'directory' && node.path && node.path === selectedFolder) row.classList.add('selected-folder');
      row.setAttribute('aria-label', node.path || node.name);
      const open = expanded.has(node.path) || Boolean(needle);
      const glyph = document.createElement('span'); glyph.className = 'glyph';
      glyph.textContent = node.kind === 'directory' ? (open ? '▾' : '▸') : node.kind === 'image' ? '▧' : '◦';
      const label = document.createElement('span'); label.textContent = node.name;
      row.append(glyph, label);
      const entry = document.createElement('div'); entry.className = 'tree-entry';
      entry.append(row);
      if (node.kind === 'image') row.classList.add('tree-image');
      // Native HTML5 DnD is enabled only in explicit move mode. The source
      // comes from this tree, never from untrusted external drops.
      if ((node.kind === 'file' || node.kind === 'image') && moveEnabled && bridge.getMode() === 'readwrite') {
        row.draggable = true;
        row.classList.add('tree-draggable');
        row.title = 'Drag to a folder to move immediately' + (node.kind === 'file' ? ', or press M for a manual move' : '');
        row.addEventListener('dragstart', event => {
          if (!moveEnabled || operations.isBusy()) { event.preventDefault(); return; }
          draggedPath = node.path;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', node.path);
          row.classList.add('tree-drag-source');
        });
        row.addEventListener('dragend', () => { draggedPath = null; clearDragHighlights(); });
        row.addEventListener('keydown', event => {
          if (event.key.toLowerCase() === 'm' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault(); showMoveDialog(node.path);
          }
        });
      }
      if (node.kind === 'directory') {
        row.addEventListener('dragover', event => {
          if (!moveEnabled || !draggedPath || !(bridge.hasFile(draggedPath) || bridge.hasAsset(draggedPath)) || operations.isBusy()) return;
          event.preventDefault(); event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          clearDragHighlights(); row.classList.add('tree-drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('tree-drop-target'));
        row.addEventListener('drop', event => {
          if (!moveEnabled || !draggedPath || !(bridge.hasFile(draggedPath) || bridge.hasAsset(draggedPath)) || operations.isBusy()) return;
          event.preventDefault(); event.stopPropagation();
          const source = draggedPath;
          draggedPath = null;
          clearDragHighlights();
          // Explicit move mode and a deliberate drop authorize the move.
          // Keep collision/external-change checks, but no confirm/modal for a drop.
          void renamePath(source, combinePath(node.path, basename(source)), { directDrop: true });
        });
      }
      if (node.path && bridge.getMode() === 'readwrite') {
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'tree-delete'; remove.textContent = '×';
        remove.setAttribute('aria-label', `Delete ${node.kind === 'directory' ? 'folder' : 'file'} ${node.path}`);
        remove.title = 'Permanently delete (confirmation required)';
        remove.addEventListener('click', () => void deleteItem(node.path, node.kind));
        entry.append(remove);
      }
      parent.append(entry);
      if (node.kind === 'file') {
        row.addEventListener('click', event => {
          if (event.detail > 1) return;
          clearTimeout(treeClickTimer);
          treeClickTimer = setTimeout(() => void selectFile(node.path), 265);
        });
        row.addEventListener('dblclick', event => {
          event.preventDefault(); clearTimeout(treeClickTimer); startInlineRename(node);
        });
      } else if (node.kind === 'image') {
        row.addEventListener('click', () => showImage(node.path));
      } else {
        row.addEventListener('click', () => { selectedFolder = node.path; if (open) expanded.delete(node.path); else expanded.add(node.path); renderTree(); });
        if (open) {
          const nested = document.createElement('div'); nested.className = 'tree-children';
          parent.append(nested); node.children.forEach(child => make(child, nested));
          if (inlineDraft && inlineDraft.parent === node.path && inlineDraft.kind !== 'rename') makeNameInput(inlineDraft, nested);
        }
      }
      if (inlineDraft && inlineDraft.kind === 'rename' && inlineDraft.path === node.path) {
        row.hidden = true;
        makeNameInput(inlineDraft, entry);
      }
    };
    make(root, ui.tree);
    const count = node => node.kind === 'file' ? 1 : node.kind === 'directory' ? node.children.reduce((n, child) => n + count(child), 0) : 0;
    ui.count.textContent = `${count(root)} .md · ${bridge.getAssetPaths().length} images`;
    ui.rootName.textContent = root.name;
  }
  function showScanProgress(progress) {
    notice(`Scanning folders… ${progress.directories} folders, ${progress.files} notes` +
      (progress.skipped ? ` · inaccessible folders: ${progress.skipped}` : '') + ' (please wait)');
  }
  function applyOpen(result) {
    operations.invalidateReads();
    if ($('image-dialog').open) $('image-dialog').close();
    clearEditor(); inlineDraft = null; selectedFolder = ''; expanded = new Set(['']); ui.search.value = '';
    ui.mode.textContent = result.mode === 'readwrite' ? 'Read/write' : 'Read-only';
    ui.refresh.disabled = !bridge.getRootHandle();
    ui.readonlyToggle.checked = result.mode === 'readonly';
    $('new-file').disabled = result.mode !== 'readwrite';
    $('new-folder').disabled = result.mode !== 'readwrite';
    draggedPath = null; moveEnabled = false; updateMoveModeUI();
    wikiIndex.invalidate(); indexPromise = null;
    $('fulltext-results').replaceChildren(); $('backlinks-results').replaceChildren();
    $('fulltext-status').textContent = 'The search index will be built on first use. No content leaves your computer.';
    renderTree();
    const skipped = result.scanInfo?.skipped || 0;
    if (skipped) {
      const sample = (result.scanInfo.skippedPaths || []).join(', ');
      notice(`Wiki opened, but ${skipped} subfolders could not be read` +
        (sample ? ` (e.g. ${sample})` : '') + '. These contents are not shown; other folders are available.', 'error');
    } else {
      notice(result.mode === 'readwrite'
        ? `Wiki opened with read/write access (${result.scanInfo?.files ?? '?'} notes). Notes are written to disk only when you click Save.`
        : 'Wiki opened read-only. Preview and links remain available.', 'success');
    }
  }
  function invalidateWikiIndex() {
    wikiIndex.invalidate(); indexPromise = null;
    $('fulltext-status').textContent = 'The full-text index will be rebuilt on the next search.';
    $('fulltext-results').replaceChildren();
    $('backlinks-results').replaceChildren();
  }
  async function createNew(kind) {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    if (kind === 'file' && !confirmDiscard()) return;
    const parent = activePath && activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/') + 1) : '';
    const suggested = parent + (kind === 'file' ? 'New note.md' : 'New folder');
    const path = window.prompt(kind === 'file'
      ? 'Note path from wiki root, e.g. /knowledge/beer.md. You can confirm creation of missing folders next:'
      : 'New folder path from wiki root, e.g. /knowledge/new-folder:', suggested);
    if (path === null || !path.trim()) return;
    let createParents = false;
    try {
      const missing = await bridge.missingParents(path, kind);
      if (missing) {
        createParents = window.confirm('Folder "' + missing + '" does not exist.\n\n' +
          'Create missing folders inside this wiki and continue?');
        if (!createParents) { notice('Creation cancelled; no folders were created.'); return; }
      }
    } catch (error) { notice('Invalid path: ' + error.message, 'error'); return; }
    if (!beginOperation('create')) return;
    let createdPath = null;
    try {
      if (kind === 'file') {
        createdPath = await bridge.createFile(path, { createParents });
        invalidateWikiIndex();
        const segments = createdPath.split('/');
        for (let i = 1; i < segments.length; i++) expanded.add(segments.slice(0, i).join('/'));
      } else {
        const directory = await bridge.createDirectory(path, { createParents });
        invalidateWikiIndex();
        const segments = directory.split('/');
        for (let i = 1; i <= segments.length; i++) expanded.add(segments.slice(0, i).join('/'));
        renderTree();
        notice(`Folder created: ${directory}`, 'success');
      }
    } catch (err) { notice(`Cannot create item: ${err.message}`, 'error'); }
    finally { endOperation('create'); }
    if (createdPath) {
      clearEditor(); // User explicitly approved discarding old edits before creation.
      if (await selectFile(createdPath)) notice(`Note created: ${createdPath}. You can edit it now.`, 'success');
    }
  }
  async function deleteItem(path, kind) {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    if (!confirmDiscard()) return;
    if (!beginOperation('delete')) return;
    try {
      const snapshot = await bridge.deletionSnapshot(path, kind);
      let message = kind === 'file' ? `Permanently delete note "${path}"?` :
        `Permanently delete folder "${path}" and all of its contents?\n\n` +
        `Contains ${snapshot.files} files and ${Math.max(0, snapshot.directories - 1)} subfolders. ` +
        `This includes non-Markdown files. This action cannot be undone.`;
      if (!window.confirm(message)) { notice('Deletion cancelled.'); return; }
      if (kind === 'directory' && snapshot.files > 0 &&
          !window.confirm('Final confirmation: permanently delete the entire folder "' + path + '" and all ' + snapshot.files + ' files?')) {
        notice('Folder deletion cancelled.'); return;
      }
      await bridge.deleteEntry(path, kind, snapshot);
      invalidateWikiIndex();
      if (activePath === path || (kind === 'directory' && activePath?.startsWith(path + '/'))) clearEditor();
      renderTree();
      notice(`Deleted: ${path}`, 'success');
    } catch (err) { notice('Deletion failed: ' + err.message, 'error'); }
    finally { endOperation('delete'); }
  }
  async function renamePath(oldPath, requested, options = {}) {
    if (!oldPath || bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    if (isDirty()) {
      notice('Save or discard unsaved changes before moving a note.', 'error'); return;
    }
    if (!requested || !requested.trim() || !beginOperation('rename')) return;
    updateMoveModeUI();
    let moved = null, summaryNotice = '';
    try {
      const movingImage = bridge.hasAsset(oldPath);
      const newPath = movingImage ? bridge.normalizeAssetDestination(requested) : bridge.normalizeDestination(requested);
      if (newPath === oldPath) return;
      notice('Checking links across the wiki…');
      const snapshots = await window.LocalWikiMigration.snapshotAll(bridge);
      const plan = movingImage
        ? window.LocalWikiMigration.planAsset(snapshots, oldPath, newPath, bridge.getAssetPaths())
        : window.LocalWikiMigration.plan(snapshots, oldPath, newPath);
      // A transaction spanning multiple disk files is not available in the
      // browser; request explicit user confirmation with the computed scope.
      const examples = plan.changes.slice(0, 6).map(x => `• ${x.path} (${x.links})`).join('\n');
      const more = plan.affectedFiles > 6 ? `\n…and ${plan.affectedFiles - 6} more` : '';
      const summary = `Move ${oldPath} → ${newPath}?\n\n` +
        `Found ${plan.totalLinks} links to update across ${plan.affectedFiles} files.` +
        (examples ? `\n${examples}${more}` : '') +
        '\n\nOnly unambiguous Markdown and [[wiki]] links will be updated. ' +
        'Unsupported syntax is left unchanged. Multi-file operations are not atomic. ' +
        'Keep a backup of your wiki. Continue?';
      if (!options.directDrop && plan.totalLinks > 0 && !window.confirm(summary)) { notice('Move cancelled.'); return; }
      const result = movingImage
        ? await window.LocalWikiMigration.executeAsset(bridge, plan, snapshots, await bridge.assetFingerprint(oldPath))
        : await window.LocalWikiMigration.execute(bridge, plan, snapshots);
      invalidateWikiIndex();
      for (const prefix of newPath.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))) expanded.add(prefix);
      moved = result.moved;
      summaryNotice = `Moved: ${oldPath} → ${newPath}. Updated ${result.links} links in ${result.updated} documents.`;
    } catch (err) {
      notice(`Move failed: ${err.message}`, 'error');
      // Partial write errors may create a target copy. Re-scan in all cases.
      try {
        await bridge.refresh();
        invalidateWikiIndex(); renderTree();
        if (!activePath || !bridge.hasFile(activePath)) clearEditor();
      } catch (_) { /* Error message above is the authoritative status. */ }
    } finally {
      endOperation('rename');
      updateMoveModeUI();
    }
    if (moved) {
      // Re-read the active document even if another note was renamed: the link
      // migration may have changed its bytes, invalidating the fingerprint.
      const next = activePath === oldPath ? moved : activePath;
      clearEditor();
      if (next && bridge.hasFile(next)) await selectFile(next);
      notice(summaryNotice, 'success');
    }
  }
  function renameActive() { showMoveDialog(activePath); }
  $('move-cancel').addEventListener('click', () => $('move-dialog').close());
  $('move-form').addEventListener('submit', evt => {
    evt.preventDefault();
    const target = $('move-destination').value.trim();
    const source = pendingMovePath;
    $('move-dialog').close();
    if (source && target) void renamePath(source, target);
  });
  $('move-dialog').addEventListener('close', () => { pendingMovePath = null; });
  function setView(mode) {
    selectedMode = mode; ui.grid.dataset.layout = mode;
    for (const button of document.querySelectorAll('.view-switch button')) button.classList.toggle('active', button.dataset.view === mode);
    if (mode !== 'preview') requestAnimationFrame(() => editor.refresh());
  }
  function setSideTab(tab) {
    for (const b of document.querySelectorAll('[data-side]')) b.classList.toggle('active', b.dataset.side === tab);
    for (const id of ['files', 'search', 'links']) $(`side-${id}`).hidden = id !== tab;
    if (tab === 'links') buildToc();
  }
  function addResult(parent, path, detail, click) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'result-item';
    const label = document.createElement('strong'); label.textContent = path;
    const info = document.createElement('span'); info.className = 'snippet'; info.textContent = detail;
    row.append(label, info); row.addEventListener('click', click); parent.append(row);
  }
  function buildToc() {
    const target = $('toc'); target.replaceChildren();
    if (!activePath) { target.textContent = 'Open a note.'; return; }
    const heads = ui.preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
    if (!heads.length) { target.textContent = 'No headings in this note.'; return; }
    heads.forEach(h => {
      const b = document.createElement('button'); b.className = 'toc-item'; b.type = 'button';
      const depth = Number(h.tagName.slice(1)); b.style.paddingLeft = `${8 + (depth - 1) * 10}px`;
      b.textContent = h.textContent.trim(); b.addEventListener('click', () => {
        if (selectedMode === 'edit') setView('split');
        h.scrollIntoView({ behavior: 'instant', block: 'nearest' });
      });
      target.append(b);
    });
  }
  async function ensureIndex() {
    if (wikiIndex.isReady()) return true;
    if (indexPromise) return indexPromise;
    if (bridge.getMode() === 'none') { notice('Open a wiki folder first.', 'error'); return false; }
    const status = $('fulltext-status');
    indexPromise = wikiIndex.rebuild((done, total) => {
      status.textContent = `Indexing local wiki: ${done} / ${total} files…`;
    }).then(result => {
      if (result.stale) return false;
      status.textContent = `Ready: ${result.indexed} of ${result.total} files. The index is kept in browser memory only.`;
      return true;
    }).catch(err => {
      status.textContent = `Indexing failed: ${err.message}`;
      return false;
    }).finally(() => { indexPromise = null; });
    return indexPromise;
  }
  // Search results respect the user's view. In preview, locate a visible
  // occurrence without opening the editor; in edit/split navigate the source.
  function highlightPreviewQuery(query) {
    ui.preview.querySelectorAll('mark.wiki-search-hit').forEach(mark => {
      mark.replaceWith(document.createTextNode(mark.textContent));
    });
    ui.preview.normalize();
    const term = String(query || '').trim().split(/\s+/)[0];
    if (!term) return false;
    const walker = document.createTreeWalker(ui.preview, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.parentElement || node.parentElement.closest('svg,script,style,.preview-placeholder')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node;
    while ((node = walker.nextNode())) {
      const at = node.textContent.toLocaleLowerCase('cs').indexOf(term.toLocaleLowerCase('cs'));
      if (at < 0) continue;
      const range = document.createRange();
      range.setStart(node, at); range.setEnd(node, at + term.length);
      const mark = document.createElement('mark'); mark.className = 'wiki-search-hit';
      range.surroundContents(mark);
      mark.scrollIntoView({ behavior: 'instant', block: 'center' });
      return true;
    }
    return false;
  }
  async function openResult(path, line, query = '') {
    const opened = await selectFile(path);
    if (!opened || activePath !== path) return;
    if (selectedMode === 'preview') {
      if (!highlightPreviewQuery(query)) {
        notice('The note is open in preview, but the exact term was not found in rendered Markdown (it may occur only in source syntax).');
      }
      return;
    }
    if (Number.isInteger(line)) {
      editor.cm.setCursor(Math.max(0, line - 1), 0);
      editor.cm.scrollIntoView({ line: Math.max(0, line - 1), ch: 0 }, 70);
      editor.focus();
    }
    if (selectedMode === 'split' && query) highlightPreviewQuery(query);
  }
  async function doFulltext() {
    const query = $('fulltext-query').value.trim();
    if (!query) { $('fulltext-status').textContent = 'Enter a search term.'; return; }
    $('fulltext-run').disabled = true;
    try {
      if (!await ensureIndex()) return;
      const results = wikiIndex.search(query, 100);
      const area = $('fulltext-results'); area.replaceChildren();
      for (const hit of results) addResult(area, `${hit.path}:${hit.line}`, hit.snippet,
        () => void openResult(hit.path, hit.line, query));
      if (!results.length) area.textContent = 'Nic nenalezeno.';
      $('fulltext-status').textContent = `${results.length} matches (up to 3 per file, maximum 100 results).`;
    } finally { $('fulltext-run').disabled = false; }
  }
  async function doBacklinks() {
    if (!activePath) { $('backlinks-results').textContent = 'Open a note first.'; return; }
    const path = activePath;
    $('backlinks-run').disabled = true;
    $('backlinks-results').textContent = 'Loading links…';
    try {
      if (!await ensureIndex()) return;
      if (path !== activePath) return;
      const refs = wikiIndex.backlinks(path);
      const area = $('backlinks-results'); area.replaceChildren();
      if (!refs.length) area.textContent = 'No other notes link to this document.';
      else refs.forEach(from => addResult(area, from, 'Odkazuje na tento file', () => void openResult(from)));
    } finally { $('backlinks-run').disabled = false; }
  }
  document.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => setSideTab(b.dataset.side)));
  $('fulltext-run').addEventListener('click', () => void doFulltext());
  $('fulltext-query').addEventListener('keydown', e => { if (e.key === 'Enter') void doFulltext(); });
  $('backlinks-run').addEventListener('click', () => void doBacklinks());
  // Remember the last folder automatically, but never prompt for permission
  // during page load. Chrome remains in full control of the permission grant.
  const recent = window.LocalWikiRecent;
  async function rememberCurrent() {
    const handle = bridge.getRootHandle();
    if (!handle) return;
    try { await recent.remember(handle); }
    catch (err) { notice('Wiki opened, but remembering it failed: ' + err.message, 'error'); }
  }
  async function restoreQuietly() {
    try {
      const handle = await recent.restoreHandle();
      if (!handle || bridge.getMode() !== 'none' || operations.isBusy()) return;
      const writable = await recent.ensurePermission(handle, false);
      const readable = writable || await recent.ensurePermission(handle, false, true);
      if (!readable) {
        notice('The previous wiki is remembered. Chrome needs renewed permission; use Open folder.');
        return;
      }
      if (!beginOperation('restore')) return;
      try { applyOpen(await bridge.openExisting(handle, showScanProgress, !writable)); }
      finally { endOperation('restore'); }
    } catch (err) {
      notice('Automatic reopening of your wiki failed: ' + err.message, 'error');
    }
  }
  void restoreQuietly();
  ui.open.addEventListener('click', async () => {
    if (!confirmDiscard() || !beginOperation('open')) return;
    try {
      applyOpen(await bridge.openWritable(showScanProgress, ui.readonlyToggle.checked));
      await rememberCurrent();
    } catch (err) {
      if (err.name !== 'AbortError') notice(`Could not open folder: ${err.message}`, 'error');
    } finally { endOperation('open'); }
  });
  // Input fallback is retained only for browsers without File System Access API.
  ui.picker.addEventListener('change', () => {
    if (operations.isBusy()) { ui.picker.value = ''; return; }
    try { applyOpen(bridge.openReadOnly(ui.picker.files)); }
    catch (err) { notice(err.message, 'error'); }
    ui.picker.value = '';
  });
  ui.refresh.addEventListener('click', async () => {
    if (!confirmDiscard() || !beginOperation('refresh')) return;
    const old = activePath;
    let refreshed = false;
    try { applyOpen(await bridge.refresh(showScanProgress)); refreshed = true; }
    catch (err) { notice(`Refresh failed: ${err.message}`, 'error'); }
    finally { endOperation('refresh'); }
    if (refreshed && old && bridge.hasFile(old)) await selectFile(old);
  });
  $('rename-file').addEventListener('click', () => {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    moveEnabled = !moveEnabled;
    draggedPath = null; clearDragHighlights();
    updateMoveModeUI(); renderTree();
    notice(moveEnabled
      ? 'Move mode enabled. Drag a Markdown file to a folder to move it immediately; press M for manual entry. Unsaved edits and collisions still block the move.'
      : 'Move mode disabled. File dragging is off.');
  });
  $('new-file').addEventListener('click', () => startDraft('file'));
  $('new-folder').addEventListener('click', () => startDraft('directory'));
  editor.onChange(() => { redrawDirty(); scheduleRender(); });
  document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => editor.format(button.dataset.format)));
  ui.search.addEventListener('input', renderTree);
  document.querySelectorAll('.view-switch button').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  ui.save.addEventListener('click', async () => {
    if (!activePath || !isDirty() || !beginOperation('save')) return;
    // Capture the full write context before the first await. An edit that is
    // typed while saving belongs to the *next* save, not the in-flight one.
    const path = activePath, savedText = editor.getValue();
    const expected = fingerprint, bom = hasBOM, eol = lineEnding;
    try {
      const result = await bridge.write(path, (bom ? '\uFEFF' : '') + savedText.replace(/\n/g, eol), expected);
      if (activePath === path) {
        originalText = savedText;
        fingerprint = result.fingerprint;
        wikiIndex.update(path, savedText);
        if (editor.getValue() === savedText) notice(`Saved to original file: ${path}`, 'success');
        else notice(`Saved an earlier version of ${path}. Newer edits in the editor still need saving.`, 'success');
      }
    } catch (err) {
      notice(`Save blocked: ${err.message} The text remains in the editor.`, 'error');
    } finally { endOperation('save'); }
  });
  ui.preview.addEventListener('click', evt => {
    const a = evt.target.closest('a');
    if (!a || !ui.preview.contains(a)) return;
    const href = a.getAttribute('href') || '';
    const parsed = window.LocalWikiNavigation.splitTarget(href);
    const doc = findDoc(href);
    if (doc) {
      evt.preventDefault();
      // Do not scroll if switching documents was cancelled due to unsaved text.
      void selectFile(doc).then(opened => { if (opened) jumpToHeading(parsed.anchor); });
      return;
    }
    if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
      evt.preventDefault(); window.open(href, '_blank', 'noopener,noreferrer'); return;
    }
    evt.preventDefault(); notice(`Cannot open link: ${href} (file not found in the wiki).`, 'error');
  });
  document.addEventListener('keydown', evt => {
    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 'n') {
      evt.preventDefault(); if (!$('new-file').disabled) $('new-file').click();
    }
    if ((evt.ctrlKey || evt.metaKey) && evt.key.toLowerCase() === 's') {
      evt.preventDefault(); if (!ui.save.disabled) ui.save.click();
    }
  });
  window.addEventListener('beforeunload', evt => { if (isDirty()) { evt.preventDefault(); evt.returnValue = ''; } });
  $('diag-api').textContent = `${location.protocol} · ${typeof window.showDirectoryPicker === 'function' ? 'File System API ✓' : 'File System API unavailable'}`;
  setView(selectedMode);

  // A complete offline release already has both libraries; no installer button is needed.
  const bundledRenderers = window.LocalWikiDiagrams.capabilities();
  if (bundledRenderers.mermaid && bundledRenderers.abc) $('renderer-check').hidden = true;

  // Diagnostics reflect actual loaded UMD objects, not the existence of placeholder files.
  $('renderer-check').addEventListener('click', () => {
    const status = window.LocalWikiDiagrams.capabilities();
    const details = $('renderer-details'); details.replaceChildren();
    const items = [
      ['Markdown (marked)', !!window.marked],
      ['Math (MathJax)', !!(window.MathJax && window.MathJax.Hub)],
      ['Mermaid diagrams', status.mermaid],
      ['ABC music notation', status.abc]
    ];
    for (const [name, available] of items) {
      const row = document.createElement('p'); row.className = 'renderer-detail';
      row.textContent = `${available ? '✓' : '✕'} ${name}: ${available ? 'ready' : 'library missing'}`;
      details.appendChild(row);
    }
    const dialog = $('renderer-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open','');
  });
  // This exercises genuine UMD runtime behavior; a present script tag is not enough.
  $('renderer-smoke').addEventListener('click', async () => {
    const button = $('renderer-smoke');
    const output = $('renderer-smoke-result');
    if (button.disabled) return;
    button.disabled = true;
    output.textContent = 'Running local diagram and notation rendering test…';
    try {
      const result = await window.LocalWikiRendererSmoke.run();
      const symbols = { ok: '✓', missing: '–', failed: '✕' };
      output.replaceChildren();
      for (const [label, status] of [['Mermaid', result.mermaid], ['ABCjs', result.abc]]) {
        const row = document.createElement('p');
        row.textContent = `${symbols[status.status]} ${label}: ${status.message}`;
        output.appendChild(row);
      }
    } catch (error) { output.textContent = `Test failed: ${error.message}`; }
    finally { button.disabled = false; }
  });
  $('renderer-close').addEventListener('click', () => {
    const dialog = $('renderer-dialog');
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  });

  // Optional, explicit, one-time download; normal wiki browsing never uses the network.
  $('renderer-install').addEventListener('click', async () => {
    const btn = $('renderer-install');
    const status = $('renderer-install-status');
    if (btn.disabled) return;
    btn.disabled = true;
    status.textContent = 'Select the application folder containing index.html, not your wiki.';
    try {
      const result = await window.LocalWikiRendererInstaller.install({
        onProgress: message => { status.textContent = message; }
      });
      if (result.installed.length) {
        status.textContent = `Installed: ${result.installed.join(', ')}. Reload the page (Ctrl+R) to load the libraries. Internet access is no longer required.`;
        notice('Libraries were installed next to the application. Reload to use them offline.', 'success');
      } else status.textContent = 'Both libraries are bundled. If rendering is missing, reload the page.';
    } catch (err) {
      status.textContent = `Renderer installation failed: ${err.message || err}. Writes were limited to the selected application folder.`;
      notice('Renderer installation did not complete. Open Renderers for details.', 'error');
    } finally { btn.disabled = false; }
  });

  // Alternative to CDN/CORS downloads: choose already downloaded official
  // distribution files. No network access and no changes to wiki documents.
  const vendorFilesInput = $('renderer-local-files');
  const vendorFilesButton = $('renderer-install-local');
  vendorFilesInput.addEventListener('change', () => {
    const count = vendorFilesInput.files?.length || 0;
    vendorFilesButton.disabled = count === 0;
    $('renderer-install-status').textContent = count
      ? `Selected ${count} files. Click Install selected JS offline and choose the application folder, not your wiki.`
      : 'No files selected.';
  });
  vendorFilesButton.addEventListener('click', async () => {
    if (vendorFilesButton.disabled) return;
    const status = $('renderer-install-status');
    vendorFilesButton.disabled = true;
    try {
      const result = await window.LocalWikiRendererInstaller.installFromFiles({
        files: vendorFilesInput.files,
        onProgress: message => { status.textContent = message; }
      });
      status.textContent = result.installed.length
        ? `Libraries ${result.installed.join(', ')} saved. Reload the page (Ctrl+R). Internet is no longer needed.`
        : 'Libraries were already installed and verified; nothing was overwritten.';
      notice('Local renderer import completed.', 'success');
    } catch (error) {
      status.textContent = `Import did not complete: ${error?.message || error}`;
      notice('Renderer import failed. Wiki source files remain unchanged.', 'error');
    } finally { vendorFilesButton.disabled = !(vendorFilesInput.files?.length); }
  });

  $('diagnostics-export').addEventListener('click', () => {
    const report = window.LocalWikiDiagnostics.collect({
      mode: bridge.getMode(),
      count: bridge.getFilePaths().length,
      dirty: isDirty(),
      busy: operations.isBusy(),
      indexed: wikiIndex.indexedCount()
    });
    window.LocalWikiDiagnostics.download(report);
    notice('Diagnostic JSON is ready to download. No wiki content or filenames are included.', 'success');
  });

  window.LocalWikiDebug = { bridge, editor, operations, wikiIndex, selectFile, renderPreview, findDoc, setSideTab, createNew, renameActive, showMoveDialog, updateMoveModeUI }; // For reproducible offline smoke tests.
})();
