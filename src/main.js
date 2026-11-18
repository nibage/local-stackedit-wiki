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
  let inlineDraft = null, imageDialogURL = null, attachmentDialogURL = null, pendingMovePath = null;
  let activeCanvasEditor = null;
  let activeBaseEditor = null;
  let selectedFolder = '', treeClickTimer = null, lastTreeSelection = null;
  let moveEnabled = false, deleteEnabled = false, draggedPath = null, draggedKind = null;
  let noticeTimer = null, autosaveBlocked = null;
  const navigationHistory = [];
  let backlinkRequest = 0, backlinksForPath = null;
  const AUTOSAVE_INTERVAL_MS = 5000;
  let blobURLs = [], selectedMode = 'split';
  const PREVIEW_DEBOUNCE_MS = 3000;
  // A quiet-period redraw prevents empty lines from flashing image/media embeds.
  // Keep existing Blob URLs alive while editing the same open document.
  const previewImageCache = new Map();
  let previewPosition = null, previewPositionObserver = null;
  let previewPositionScheduled = false;
  function stopPreviewPositionTracking() {
    previewPositionObserver?.disconnect();
    previewPositionObserver = null;
    previewPosition = null;
    previewPositionScheduled = false;
  }
  function sourceSearchFragments(lines, line) {
    const candidates = [];
    for (let i = line; i >= Math.max(0, line-5); i--) {
      let value = (lines[i] || '').trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^>\s*/, '')
        .replace(/[*_\x60~]/g,'')
        .replace(/!?\[([^\]]+)\]\(([^)]+)\)/g,'$1')
        .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g,(_,name,alias)=>alias||name);
      if (value.length > 110) value=value.slice(0,110);
      if (value.length >= 4) candidates.push(value);
    }
    return candidates;
  }
  function previewSourceTarget(position) {
    const blocks = Array.from(ui.preview.querySelectorAll(
      'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th'
    ));
    const fraction = position.line / Math.max(1,position.lastLine);
    let fallback = null;
    for (const query of position.fragments) {
      const matches = blocks.map((el,i)=>({el,i})).filter(item=>
        item.el.textContent.includes(query));
      if (matches.length === 1) return matches[0].el;
      if (matches.length && !fallback) {
        // Repeated headings/paragraphs must not always jump to the first
        // occurrence. Prefer the match nearest the caret's source fraction.
        fallback = matches.reduce((best,item) =>
          Math.abs(item.i / Math.max(1,blocks.length-1)-fraction) <
          Math.abs(best.i / Math.max(1,blocks.length-1)-fraction) ? item:best).el;
      }
    }
    return fallback;
  }
  function restorePreviewPosition() {
    const position = previewPosition;
    if (!position || position.sequence !== renderSequence || position.userMoved) return;
    // Do not mistake layout-induced native scroll anchoring for a user scroll.
    // Explicit wheel/pointer/touch/keyboard events below mark user movement.
    const maxTop = Math.max(0, ui.preview.scrollHeight - ui.preview.clientHeight);
    let nextTop = position.top;
    if (position.followBottom) {
      nextTop = maxTop;
    } else {
      const target = previewSourceTarget(position);
      const height = ui.preview.clientHeight;
      if (target) {
        const offset = target.getBoundingClientRect().top -
          ui.preview.getBoundingClientRect().top + ui.preview.scrollTop;
        // Keep the edited paragraph in view, avoiding recenter on image growth.
        if (offset < ui.preview.scrollTop + height*.15 ||
            offset > ui.preview.scrollTop + height*.76)
          nextTop = offset - height*.32;
        else nextTop = ui.preview.scrollTop;
      } else {
        // New empty lines and specialized embeds may have no visible text.
        const proportional = maxTop * Math.min(1, position.line /
          Math.max(1, position.lastLine));
        if (Math.abs(proportional - ui.preview.scrollTop) > height*.75)
          nextTop = proportional;
        else nextTop = ui.preview.scrollTop;
      }
    }
    ui.preview.scrollTop = Math.max(0, Math.min(maxTop, nextTop));
    position.lastApplied = ui.preview.scrollTop;
  }
  function queuePreviewPositionRestore() {
    if (previewPositionScheduled) return;
    previewPositionScheduled = true;
    requestAnimationFrame(() => {
      previewPositionScheduled = false;
      restorePreviewPosition();
    });
  }
  for (const event of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
    ui.preview.addEventListener(event, () => {
      if (previewPosition) previewPosition.userMoved = true;
    }, {passive:true});
  }
  const SIDEBAR_MIN = 190, SIDEBAR_DEFAULT = 255;
  const SIDEBAR_MAX_SHARE = 0.70, MAIN_MIN_WIDTH = 390;
  const types = window.LocalWikiAttachmentTypes;
  const SAFE_IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i;
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
  themeSelect.value = ['light', 'dark', 'system', 'stackedit'].includes(initialTheme) ? initialTheme : 'system';
  function applyTheme() {
    document.documentElement.dataset.theme = themeSelect.value === 'system'
      ? (mediaDark.matches ? 'dark' : 'light') : themeSelect.value;
  }
  themeSelect.addEventListener('change', () => { safeStore('local-wiki-theme', themeSelect.value); applyTheme(); });
  if (mediaDark.addEventListener) mediaDark.addEventListener('change', applyTheme);
  applyTheme();
  // Reader settings are scoped to this offline wiki instance and do not
  // rewrite the Markdown file or change the currently selected layout.
  const centerToggle=$('center-content-toggle');
  const linesToggle=$('line-numbers-toggle');
  const sizeSelect=$('workspace-text-size');
  centerToggle.checked=safeStored('local-wiki-centered','on')!=='off';
  linesToggle.checked=safeStored('local-wiki-line-numbers','on')!=='off';
  const initialSize=safeStored('local-wiki-text-size','default');
  sizeSelect.value=['default','12','14','16','18','20','22','24','26'].includes(initialSize)
    ?initialSize:'default';
  function applyDisplaySettings() {
    document.documentElement.dataset.centered=String(centerToggle.checked);
    document.documentElement.dataset.lineNumbers=String(linesToggle.checked);
    document.documentElement.dataset.wikiTextSize=sizeSelect.value;
    if(sizeSelect.value==='default')
      document.documentElement.style.removeProperty('--wiki-user-text-size');
    else document.documentElement.style.setProperty('--wiki-user-text-size',sizeSelect.value+'px');
    editor.cm.setOption('lineNumbers',linesToggle.checked);
    requestAnimationFrame(()=>editor.refresh());
  }
  centerToggle.addEventListener('change',()=>{
    safeStore('local-wiki-centered',centerToggle.checked?'on':'off');
    applyDisplaySettings();
  });
  linesToggle.addEventListener('change',()=>{
    safeStore('local-wiki-line-numbers',linesToggle.checked?'on':'off');
    applyDisplaySettings();
  });
  sizeSelect.addEventListener('change',()=>{
    safeStore('local-wiki-text-size',sizeSelect.value);
    applyDisplaySettings();
  });
  applyDisplaySettings();
  const resizer = $('sidebar-resizer');
  let preferredSidebarWidth = SIDEBAR_DEFAULT;
  function maxSidebarWidth() {
    // Limit by screen share AND remaining editor/preview space.
    // On very small screens the minimum sidebar takes precedence.
    const workspace = document.querySelector('.workspace');
    const width = workspace?.clientWidth || window.innerWidth;
    return Math.max(SIDEBAR_MIN,
      Math.floor(Math.min(width * SIDEBAR_MAX_SHARE, width - MAIN_MIN_WIDTH - 6)));
  }
  function setSidebarWidth(width, persist = true) {
    if (!Number.isFinite(width)) return;
    preferredSidebarWidth = Math.max(SIDEBAR_MIN, Math.round(width));
    const max = maxSidebarWidth(), value = Math.min(preferredSidebarWidth, max);
    document.documentElement.style.setProperty('--sidebar-width', value + 'px');
    resizer.setAttribute('aria-valuemin', String(SIDEBAR_MIN));
    resizer.setAttribute('aria-valuemax', String(max));
    resizer.setAttribute('aria-valuenow', String(value));
    if (persist) safeStore('local-wiki-sidebar-width', String(preferredSidebarWidth));
  }
  const storedWidth = Number(safeStored('local-wiki-sidebar-width', String(SIDEBAR_DEFAULT)));
  setSidebarWidth(Number.isFinite(storedWidth) ? storedWidth : SIDEBAR_DEFAULT, false);
  window.addEventListener('resize', () => setSidebarWidth(preferredSidebarWidth, false));
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
    const next = event.key === 'Home' ? SIDEBAR_MIN : event.key === 'End' ? maxSidebarWidth() :
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
      ? 'Drag and drop a note, attachment or folder onto another folder. Folder moves require confirmation. Press M on a focused note for a manual path.'
      : 'Enable drag and drop file moves';
    ui.tree.classList.toggle('move-mode-enabled', moveEnabled);
  }
  function updateDeleteModeUI() {
    const button = $('delete-toggle');
    const allowed = bridge.getMode() === 'readwrite' && !operations.isBusy();
    if (bridge.getMode() !== 'readwrite') deleteEnabled = false;
    button.disabled = !allowed;
    button.classList.toggle('move-enabled', deleteEnabled);
    button.setAttribute('aria-pressed', String(deleteEnabled));
    button.title = deleteEnabled
      ? 'Hide trash icons (deleting still requires confirmation)'
      : 'Enable trash icons on hover or keyboard focus';
    if (!deleteEnabled) hideTreeDelete();
  }
  $('delete-toggle').addEventListener('click', event => {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    deleteEnabled = !deleteEnabled;
    updateDeleteModeUI();
    // Pointer activation must not leave a focus outline looking like a
    // still-enabled green underline after the toggle was switched off.
    if (event.detail > 0) event.currentTarget.blur();
  });
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
    clearTimeout(noticeTimer);
    ui.notice.textContent = message;
    ui.notice.title = message; // Full message remains available when header space is limited.
    ui.notice.className = `notice ${variant}`.trim();
    ui.notice.hidden = false;
    // Status and failures live next to the logo, never over file controls.
    if (!message.startsWith('Scanning folders')) {
      noticeTimer = setTimeout(() => { ui.notice.hidden = true; }, variant === 'error' ? 10000 : 4500);
    }
  }
  function beginOperation(name) {
    if (!operations.acquire(name)) {
      notice(`An operation is in progress: ${operations.currentOperation()}. Please complete it first.`, 'error');
      return false;
    }
    // Prevent editing a document that may be replaced by a move, open or refresh.
    // Saving is the exception: edits made while a write is in progress remain dirty.
    if (name !== 'save') editor.setReadOnly(true);
    redrawDirty(); updateMoveModeUI(); updateDeleteModeUI();
    return true;
  }
  function endOperation(name) {
    operations.release(name);
    editor.setReadOnly(bridge.getMode() !== 'readwrite' || !activePath);
    redrawDirty(); updateMoveModeUI(); updateDeleteModeUI();
  }
  function isDirty() { return activePath !== null && editor.getValue() !== originalText; }
  function confirmDiscard() {
    return !isDirty() || window.confirm('The current note has unsaved changes. Discard them?');
  }
  function redrawDirty() {
    const dirty = isDirty();
    ui.dirty.textContent = dirty ? '● Unsaved' : '';
    ui.save.disabled = operations.isBusy() || bridge.getMode() !== 'readwrite' || !dirty;
    const toolsEnabled=Boolean(activePath) && bridge.getMode()==='readwrite' && !operations.isBusy() && selectedMode!=='preview';
    document.querySelectorAll('.format-toolbar .format-tools button').forEach(button=>{button.disabled=!toolsEnabled;});
    $('save-status').textContent = dirty ? (bridge.getMode() === 'readwrite' ? 'Unsaved changes · autosave every 5s' : 'Unsaved changes') : activePath ? 'No unsaved changes' : 'No file';
    updateSourceStats();
  }
  function wordCount(text) {
    const match=String(text||'').trim().match(/\S+/gu);
    return match?match.length:0;
  }
  function updateSourceStats() {
    const source=activePath?editor.getValue():'';
    const cursor=editor.cm.getCursor();
    const bytes=new Blob([source]).size; // UTF-8 byte count, not JS string length.
    const lines=activePath?editor.cm.lineCount():0;
    $('stats').textContent='Markdown '+bytes+' bytes · '+wordCount(source)+' words · '+
      lines+' lines · Ln '+(cursor.line+1)+', Col '+cursor.ch+
      ' · '+source.length+' characters';
  }
  function updateHtmlStats() {
    if (!activePath) {
      $('html-stats').textContent='HTML 0 characters · 0 words · 0 paragraphs';
      return;
    }
    const source=ui.preview.innerHTML||'';
    const visibleText=ui.preview.innerText||ui.preview.textContent||'';
    const paras=ui.preview.querySelectorAll('p').length;
    $('html-stats').textContent='HTML '+source.length+' characters · '+
      wordCount(visibleText)+' words · '+paras+' paragraphs';
  }
  let htmlStatsQueued=false;
  // Renderers, images and nested media may finish after the Markdown pass.
  const htmlStatsObserver=new MutationObserver(()=>{
    if (htmlStatsQueued) return;
    htmlStatsQueued=true;
    requestAnimationFrame(()=>{htmlStatsQueued=false;updateHtmlStats();});
  });
  htmlStatsObserver.observe(ui.preview,{subtree:true,childList:true,attributes:true,characterData:true});
  function disposeStructured(root) {
    root.querySelectorAll('.wiki-canvas-viewer,.wiki-bases-viewer,.wiki-drawio-viewer')
      .forEach(node => node.dispose?.());
  }
  function releaseImages(keepLocalImages = false) {
    // Existing local image URLs remain valid during an ordinary source redraw.
    disposeStructured(ui.preview);
    if (!keepLocalImages) {
      blobURLs.forEach(url => URL.revokeObjectURL(url));
      blobURLs = [];
      previewImageCache.clear();
    }
  }
  function clearEditor() {
    stopPreviewPositionTracking();
    renderSequence++; clearTimeout(renderTimer); // Cancel delayed render/image updates.
    activePath = null; originalText = ''; fingerprint = null; hasBOM = false;
    updatePreviewExportEnabled();
    editor.setValue(''); editor.setReadOnly(true);
    ui.filename.textContent = 'No note open';
    updateMoveModeUI();
    ui.preview.replaceChildren();
    releaseImages(); redrawDirty(); updateHtmlStats(); updateScrollSyncButton();
    $('toc').replaceChildren(); $('backlinks-results').replaceChildren();
    $('outlinks-results').replaceChildren();
    backlinksForPath = null;
  }
  function updateBackButton() {
    for (const id of ['nav-back','toc-back']) {
      $(id).hidden = !navigationHistory.length;
      $(id).disabled = !navigationHistory.length;
    }
  }
  async function navigateTo(path, options = {}) {
    const previous = activePath;
    const opened = await selectFile(path);
    if (opened && previous && previous !== path && !options.history) {
      navigationHistory.push(previous);
      if (navigationHistory.length > 60) navigationHistory.shift();
      updateBackButton();
    }
    return opened;
  }
  async function goBack() {
    const target = navigationHistory.at(-1);
    if (!target) return;
    if (await navigateTo(target, { history: true })) {
      navigationHistory.pop(); updateBackButton();
    }
  }
  for (const id of ['nav-back','toc-back']) $(id).addEventListener('click', () => void goBack());
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
    // Heading links should behave like in-links/out-links: never change
    // the user's chosen Editor / Side by side / Preview layout.
    if (selectedMode !== 'edit')
      h.scrollIntoView({ behavior: 'instant', block: 'start' });
    if (selectedMode !== 'preview') {
      const heads=Array.from(ui.preview.querySelectorAll('h1,h2,h3,h4,h5,h6'));
      const lines=editor.getValue().split('\n');
      const slug=window.LocalWikiNavigation.headingSlug(h.textContent);
      let occurrence=0;
      for(const heading of heads){if(heading===h)break;
        if(window.LocalWikiNavigation.headingSlug(heading.textContent)===slug)occurrence++;
      }
      let count=0,sourceLine=null;
      for(let i=0;i<lines.length;i++){
        const match=/^ {0,3}#{1,6}[ \t]+(.+?)[ \t]*#*[ \t]*$/.exec(lines[i]);
        if(match&&window.LocalWikiNavigation.headingSlug(match[1])===slug){
          if(count++===occurrence){sourceLine=i;break;}
        }
      }
      if(sourceLine!==null){
        editor.cm.setCursor(sourceLine,Math.max(0,lines[sourceLine].search(/\S/)));
        editor.cm.scrollIntoView({line:sourceLine,ch:0},70);
        editor.focus();
      }
    }
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
        let url = previewImageCache.get(path);
        if (!url) {
          const blob = await bridge.readAsset(path);
          if (sequence !== renderSequence) return;
          url = URL.createObjectURL(blob);
          previewImageCache.set(path, url);
          blobURLs.push(url);
        }
        if (sequence !== renderSequence) return;
        img.addEventListener('load', queuePreviewPositionRestore, {once:true});
        img.src = url;
        img.title = path;
      } catch (_) {
        if (sequence === renderSequence) img.replaceWith(document.createTextNode(`[unable to load image: ${raw}]`));
      }
    }
  }
  async function loadAttachments(nodes, sourcePath, sequence) {
    // Avoid accidentally spawning hundreds of viewers or repeated Bases scans.
    const MAX_INLINE_STRUCTURED = 6;
    let structuredCount = 0;
    for (const placeholder of nodes || []) {
      if (sequence !== renderSequence) return;
      let path;
      try { path = resolveAttachment(placeholder.dataset.localAttachment || '', sourcePath, true); }
      catch (_) { path = null; }
      if (!path || !bridge.hasAsset(path)) {
        placeholder.textContent = '[attachment missing or ambiguous]'; continue;
      }
      try {
        const kind = types.kind(path);
        if (['canvas','base','drawio'].includes(kind)) {
          if (++structuredCount > MAX_INLINE_STRUCTURED) {
            placeholder.textContent = 'Too many structured embeds (maximum six per note).';
            continue;
          }
          const header = document.createElement('div');
          header.className = 'structured-embed-header';
          const label = document.createElement('strong');
          label.className = 'attachment-label'; label.textContent = path;
          const open = document.createElement('button'); open.type = 'button';
          open.className = 'structured-embed-open'; open.textContent = 'Open larger ↗';
          open.setAttribute('aria-label', 'Open '+path+' in a larger preview');
          open.addEventListener('click', () => void showAttachment(path));
          header.append(label,open);
          const body = document.createElement('div');
          body.className = 'structured-embed-body';
          body.textContent = 'Loading local '+kind+' preview…';
          placeholder.classList.add('wiki-structured-embed');
          placeholder.replaceChildren(header,body);
          const file = await bridge.readAsset(path);
          if (sequence !== renderSequence || !placeholder.isConnected) return;
          const content = await attachmentTextPreview(file, path);
          if (sequence !== renderSequence || !placeholder.isConnected) {
            disposeStructured(content); return;
          }
          body.replaceChildren(content);
          continue;
        }
        const file = await bridge.readAsset(path);
        if (sequence !== renderSequence) return;
        const label = document.createElement('span'); label.className = 'attachment-label'; label.textContent = path;
        const url = URL.createObjectURL(file); blobURLs.push(url);
        const media = attachmentMedia(path, file, url);
        if (media) placeholder.replaceChildren(label, media);
        else placeholder.textContent = '[unsupported attachment]';
      } catch (error) {
        if (sequence === renderSequence && placeholder.isConnected) {
          placeholder.textContent = '[attachment failed to load: '+(error?.message||'unknown error')+']';
        }
      }
    }
  }
  function renderPreview(fromEditor = false) {
    clearTimeout(renderTimer); renderTimer = null;
    const oldTop = ui.preview.scrollTop;
    const cursorLine = editor.cm.getCursor().line;
    const lastLine = editor.cm.lastLine();
    const lines = editor.getValue().split('\n');
    const followBottom = fromEditor && cursorLine >= Math.max(0,lastLine-2);
    stopPreviewPositionTracking();
    renderSequence++;
    const sequence = renderSequence;
    releaseImages(true);
    if (!activePath) return;
    if (fromEditor) {
      previewPosition = {
        sequence, top:oldTop, followBottom, line:cursorLine, lastLine,
        fragments:sourceSearchFragments(lines,cursorLine),
        lastApplied:null, userMoved:false
      };
    }
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
      const imageDimensions = new Map();
      ui.preview.querySelectorAll('img[data-local-source]').forEach(img => {
        const rect = img.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0)
          imageDimensions.set(img.dataset.localSource, {width:rect.width,height:rect.height});
      });
      const result = window.LocalWikiRender.render(editor.getValue(), ui.preview, { onDiagramUpdate: report });
      // Reserve the same geometry immediately, before browser image decode,
      // so a new blank line cannot shift loaded images up or down.
      result.imageNodes.forEach(img => {
        const size = imageDimensions.get(img.dataset.localSource);
        if (!size) return;
        img.setAttribute('width', String(Math.round(size.width)));
        img.setAttribute('height', String(Math.round(size.height)));
        img.style.aspectRatio = size.width+' / '+size.height;
      });
      if (previewPosition) {
        // MathJax, Mermaid, Canvas and local assets may change the DOM after
        // initial rendering. Coalesce these changes into one animation frame.
        previewPositionObserver = new MutationObserver(queuePreviewPositionRestore);
        previewPositionObserver.observe(ui.preview, {
          childList:true, subtree:true, attributes:true,
          attributeFilter:['src','style','height','width']
        });
        restorePreviewPosition();
      }
      baseStatus = [result.expressions ? `Math: ${result.expressions}` : '',
        result.callouts ? `Callouts: ${result.callouts}` : ''].filter(Boolean).join(' · ') || 'Offline Markdown';
      report(result.diagrams);
      buildToc();
      if (!$('side-links').hidden) buildOutlinks();
      void loadImages(result.imageNodes, activePath, sequence);
      void loadAttachments(result.attachmentNodes, activePath, sequence);
    } catch (err) {
      const p = document.createElement('p'); p.textContent = `Preview failed: ${err.message}`;
      ui.preview.replaceChildren(p);
      $('render-status').textContent = 'Preview error';
    }
  }
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(() => { renderTimer = null; renderPreview(true); }, PREVIEW_DEBOUNCE_MS); }
  async function selectFile(path, options = {}) {
    if (path === activePath && !options.force) return true;
    if (operations.isBusy()) { notice('A file operation is in progress; switching notes is temporarily disabled.', 'error'); return false; }
    if (isDirty()) {
      // Navigation writes through the existing fingerprint guard first. If
      // anything fails, keep the original document and all unsaved text open.
      if (!await saveCurrent(true, true)) {
        notice('Cannot switch notes: unsaved changes could not be saved. The editor was preserved.', 'error');
        return false;
      }
    }
    const ticket = operations.beginRead();
    const formerPath = activePath, formerText = editor.getValue();
    try {
      const result = await bridge.read(path);
      if (!operations.isCurrentRead(ticket)) return false;
      if (activePath !== formerPath || editor.getValue() !== formerText) {
        notice('The editor changed during loading. Switching was cancelled to protect unsaved changes.', 'error');
        return false;
      }
      releaseImages(); // Revoke cached images when switching source notes.
      activePath = path; selectedFolder = parentPath(path); lastTreeSelection = path; fingerprint = result.fingerprint; hasBOM = Boolean(result.hasBOM);
      lineEnding = result.text.includes('\r\n') ? '\r\n' : '\n';
      const normalizedText = result.text.replace(/\r\n?/g, '\n');
      originalText = normalizedText; editor.setValue(normalizedText);
      editor.setReadOnly(bridge.getMode() !== 'readwrite');
      ui.filename.textContent = path;
      updateMoveModeUI();
      $('backlinks-results').replaceChildren();
      $('outlinks-results').replaceChildren();
      backlinksForPath = null;
      redrawDirty(); renderTree(); renderPreview(); updatePreviewExportEnabled(); updateScrollSyncButton();
      if (!$('side-links').hidden) { buildOutlinks(); void doBacklinks(); }
      ui.preview.scrollTop = 0;
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
  function resolveAttachment(target, sourcePath, wikiSyntax = false) {
    let decoded;
    try { decoded = decodeURIComponent(target); } catch (_) { return null; }
    if (!decoded || /^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(decoded)) return null;
    const path = decoded.split(/[?#]/)[0].replace(/\\/g, '/');
    if (!types.isAttachment(path)) return null;
    const relative = window.LocalWikiFS.relativePath(sourcePath, path);
    if (relative && bridge.hasAsset(relative)) return relative;
    if (bridge.hasAsset(path)) return path;
    // Only Obsidian embeds/wiki links support basename lookup, and only
    // when it resolves to a single file in the selected wiki.
    if (wikiSyntax) {
      const lowered = path.toLowerCase();
      const matches = bridge.getAssetPaths().filter(candidate => candidate.toLowerCase() === lowered ||
        (!path.includes('/') && candidate.split('/').pop().toLowerCase() === lowered));
      if (matches.length === 1) return matches[0];
    }
    return null;
  }
  function relativeAssetPath(from, to) {
    const base = parentPath(from).split('/').filter(Boolean);
    const dest = to.split('/');
    while (base.length && dest.length && base[0] === dest[0]) { base.shift(); dest.shift(); }
    return [...base.map(() => '..'), ...dest].join('/');
  }
  function insertAttachment(path) {
    if (!activePath || bridge.getMode() !== 'readwrite' || operations.isBusy()) return false;
    const relative = relativeAssetPath(activePath, path);
    const encoded = relative.split('/').map(segment => encodeURIComponent(segment)).join('/');
    const name = basename(path);
    const markup = types.isImage(path)
      ? `![${name.replace(/\.(?:png|jpe?g|gif|webp|bmp|avif|svg)$/i, '')}](${encoded})`
      : types.isEmbeddable(path) ? `![[${relative}]]` : `[[${relative}]]`;
    editor.cm.replaceSelection(markup);
    editor.focus();
    return true;
  }
  // The viewer is built from DOM nodes with textContent, never from an
  // attachment's HTML/SVG source. Blob URLs are scoped and revoked on close.
  function attachmentMedia(path, file, url) {
    const kind = types.mediaKind(path, file.type);
    let element;
    if (kind === 'image') {
      element = document.createElement('img'); element.alt = basename(path);
      element.src = url;
    } else if (kind === 'audio' || kind === 'video') {
      element = document.createElement(kind);
      element.controls = true;
      element.preload = kind === 'video' ? 'metadata' : 'none';
      if (kind === 'video') element.playsInline = true;
      element.src = url;
      element.addEventListener('error', () => { element.title = 'Browser codec or format may be unsupported'; });
    } else if (kind === 'pdf') {
      element = document.createElement('object');
      element.type = 'application/pdf'; element.data = url;
      element.textContent = 'PDF preview is unavailable in this browser.';
    }
    return element || null;
  }
  async function attachmentTextPreview(file, path) {
    const output = document.createElement('div');
    if (file.size > 2 * 1024 * 1024) {
      output.textContent = 'This structured attachment is larger than 2 MB. Use Obsidian or another local viewer.';
      return output;
    }
    const text = await file.text();
    if (types.kind(path) === 'canvas') {
      try {
        const canvas = JSON.parse(text);
        const graph = window.LocalWikiCanvas.render(canvas, {
          readImage: async target => {
            // JSON Canvas file paths are wiki-root-relative.
            // Never load external files or allow image thumbnails above 8 MB.
            if (!bridge.hasAsset(target) || !types.isImage(target)) return null;
            const image = await bridge.readAsset(target);
            return image.size <= 8 * 1024 * 1024 ? image : null;
          },
          readNote: async target => {
            // Only an already opened wiki note; no traversal, network or writes.
            if (!bridge.hasFile(target) || !(/\.md$|\.markdown$/i.test(target))) return null;
            const source = await bridge.read(target);
            return source.text.length <= 160000 ? source.text : source.text.slice(0,160000);
          }
        });
        output.append(graph);
      } catch (error) {
        output.textContent = 'Invalid JSON Canvas: ' + error.message + ' The file was not modified.';
      }
    } else if (types.kind(path) === 'drawio') {
      try {
        output.append(window.LocalWikiDrawio.render(text));
      } catch (error) {
        output.textContent = 'Cannot preview draw.io: ' + error.message + ' The file was not modified.';
      }
    } else {
      try {
        const allPaths = bridge.getFilePaths();
        const paths = allPaths.slice(0, 500), rows = new Array(paths.length);
        let next = 0, failed = 0;
        await Promise.all(Array.from({ length: Math.min(6, paths.length) }, async () => {
          while (next < paths.length) {
            const i = next++;
            try {
              const note = await bridge.read(paths[i]);
              const properties = window.LocalWikiBases.readFrontmatter(note.text);
              rows[i] = window.LocalWikiBases.fileData(paths[i], properties, note.text.slice(0, 100000));
            } catch (_) { failed++; }
          }
        }));
        const table = window.LocalWikiBases.render(text, rows.filter(Boolean), {
          totalFiles: allPaths.length, failedFiles: failed,
          onOpen: notePath => {
            const dialog = $('attachment-dialog');
            if (dialog.open) dialog.close();
            void navigateTo(notePath);
          }
        });
        output.append(table);
      } catch (error) {
        output.textContent = 'Cannot show Bases table: ' + error.message + ' The file was not modified.';
      }
    }
    return output;
  }
  async function showAttachment(path) {
    if (types.isImage(path)) { showImage(path); return; }
    activeCanvasEditor?.dispose?.();
    activeCanvasEditor = null;
    $('attachment-dialog-canvas-info').replaceChildren();
    $('attachment-dialog-canvas-info').hidden=true;
    activeBaseEditor?.dispose?.();
    activeBaseEditor = null;
    const dialog = $('attachment-dialog');
    const viewer = $('attachment-dialog-viewer');
    viewer.querySelector('.wiki-canvas-viewer')?.dispose?.();
    viewer.querySelector('.wiki-bases-viewer')?.dispose?.();
    viewer.querySelector('.wiki-drawio-viewer')?.dispose?.();
    if (attachmentDialogURL) { URL.revokeObjectURL(attachmentDialogURL); attachmentDialogURL = null; }
    viewer.replaceChildren();
    dialog.classList.toggle('canvas-dialog-open', types.kind(path) === 'canvas');
    dialog.classList.toggle('bases-dialog-open', types.kind(path) === 'base');
    dialog.classList.toggle('drawio-dialog-open', types.kind(path) === 'drawio');
    $('attachment-dialog-title').textContent = basename(path);
    $('attachment-dialog-path').textContent = path;
    const canvasInfo=$('attachment-dialog-canvas-info');
    canvasInfo.replaceChildren();canvasInfo.hidden=true;
    $('attachment-insert').disabled = bridge.getMode() !== 'readwrite' || !activePath || operations.isBusy();
    $('attachment-insert').onclick = () => { if (insertAttachment(path)) dialog.close(); };
    const editCanvas = $('attachment-edit-canvas');
    editCanvas.hidden = types.kind(path) !== 'canvas' || bridge.getMode() !== 'readwrite';
    editCanvas.disabled = operations.isBusy();
    editCanvas.onclick = async () => {
      if (activeCanvasEditor || bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
      editCanvas.disabled = true;
      try {
        const snapshot = await bridge.readAssetSnapshot(path);
        if (!dialog.open || $('attachment-dialog-path').textContent !== path) return;
        const raw = JSON.parse(snapshot.text.replace(/^\uFEFF/,''));
        const canvasEditor = window.LocalWikiCanvasEditor.mount(raw, {
          fingerprint:snapshot.fingerprint,
          readImage:async target => {
            if (!bridge.hasAsset(target) || !types.isImage(target)) return null;
            const image=await bridge.readAsset(target);
            return image.size <= 8*1024*1024 ? image : null;
          },
          readNote:async target => {
            if (!bridge.hasFile(target) || !(/\.md$|\.markdown$/i.test(target))) return null;
            const note=await bridge.read(target);
            return note.text.slice(0,160000);
          },
          onSave:async (data,expected) => {
            if (operations.isBusy()) throw new Error('Finish the current wiki file operation before saving Canvas.');
            const content=(snapshot.hasBOM ? '\uFEFF' : '')+JSON.stringify(data,null,2)+'\n';
            return bridge.writeAsset(path,content,expected);
          },
          onPreview:async () => {
            activeCanvasEditor?.dispose?.();
            activeCanvasEditor=null;
            canvasInfo.replaceChildren();canvasInfo.hidden=true;
            const file=await bridge.readAsset(path);
            const display=await attachmentTextPreview(file,path);
            if (dialog.open && $('attachment-dialog-path').textContent===path) {
              viewer.replaceChildren(display);
              editCanvas.hidden=false;
            } else display.querySelector('.wiki-canvas-viewer')?.dispose?.();
          },
          onClose:() => dialog.close()
        });
        viewer.querySelector('.wiki-canvas-viewer')?.dispose?.();
        activeCanvasEditor=canvasEditor;
        viewer.replaceChildren(canvasEditor.root);
        canvasInfo.replaceChildren();
        canvasInfo.hidden=true;
        $('attachment-insert').after(canvasEditor.previewButton);
        editCanvas.hidden=true;
      } catch (error) {
        viewer.textContent='Cannot edit Canvas: '+error.message+' The file has not been changed.';
      } finally { editCanvas.disabled=false; }
    };
    const editBase = $('attachment-edit-base');
    editBase.hidden = types.kind(path) !== 'base' || bridge.getMode() !== 'readwrite';
    editBase.disabled = operations.isBusy();
    editBase.onclick = async () => {
      if (activeBaseEditor || bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
      editBase.disabled = true;
      try {
        const snapshot = await bridge.readAssetSnapshot(path);
        if (!dialog.open || $('attachment-dialog-path').textContent !== path) return;
        const source = snapshot.text.replace(/^\uFEFF/,'');
        const lineEnding = /\r\n/.test(source) ? '\r\n' : '\n';
        const editor = window.LocalWikiBasesEditor.mount(source.replace(/\r\n?/g,'\n'), {
          fingerprint:snapshot.fingerprint,
          onSave:async (content,expected) => {
            if (operations.isBusy()) throw new Error('Finish the current wiki operation before saving Bases.');
            const bytes=(snapshot.hasBOM ? '\uFEFF' : '')+content.replace(/\n/g,lineEnding);
            return bridge.writeAsset(path,bytes,expected);
          },
          onPreview:async () => {
            activeBaseEditor?.dispose?.();
            activeBaseEditor=null;
            const file=await bridge.readAsset(path);
            const display=await attachmentTextPreview(file,path);
            if (dialog.open && $('attachment-dialog-path').textContent===path) {
              viewer.replaceChildren(display);
              editBase.hidden=false;
              $('attachment-insert').disabled=bridge.getMode()!=='readwrite' || !activePath || operations.isBusy();
            } else display.querySelector('.wiki-bases-viewer')?.dispose?.();
          },
          onClose:()=>dialog.close()
        });
        viewer.querySelector('.wiki-bases-viewer')?.dispose?.();
        activeBaseEditor=editor;
        viewer.replaceChildren(editor.root);
        editBase.hidden=true;
        $('attachment-insert').disabled=true;
      } catch(error) {
        viewer.textContent='Cannot edit Base YAML: '+error.message+' The source file was not modified.';
      } finally { editBase.disabled=false; }
    };
    dialog.showModal();
    try {
      const file = await bridge.readAsset(path);
      if (!dialog.open || $('attachment-dialog-path').textContent !== path) return;
      if (['canvas','base','drawio'].includes(types.kind(path))) {
        const node = await attachmentTextPreview(file, path);
        if (dialog.open && $('attachment-dialog-path').textContent === path) viewer.replaceChildren(node);
        else {
          node.querySelector('.wiki-canvas-viewer')?.dispose?.();
          node.querySelector('.wiki-bases-viewer')?.dispose?.();
          node.querySelector('.wiki-drawio-viewer')?.dispose?.();
        }
        return;
      }
      const url = URL.createObjectURL(file);
      if (!dialog.open || $('attachment-dialog-path').textContent !== path) { URL.revokeObjectURL(url); return; }
      attachmentDialogURL = url;
      const node = attachmentMedia(path, file, url);
      if (node) viewer.replaceChildren(node);
      else viewer.textContent = 'This file type has no built-in viewer.';
    } catch (error) {
      if (dialog.open) viewer.textContent = 'Unable to open attachment: ' + error.message;
    }
  }
  $('attachment-close').addEventListener('click', () => {
    if (activeCanvasEditor && !activeCanvasEditor.requestClose()) return;
    if (activeBaseEditor && !activeBaseEditor.requestClose()) return;
    $('attachment-dialog').close();
  });
  $('attachment-dialog').addEventListener('cancel', event => {
    if (activeCanvasEditor && !activeCanvasEditor.requestClose()) event.preventDefault();
    if (activeBaseEditor && !activeBaseEditor.requestClose()) event.preventDefault();
  });
  $('attachment-dialog').addEventListener('close', () => {
    activeCanvasEditor?.dispose?.();
    activeCanvasEditor = null;
    activeBaseEditor?.dispose?.();
    activeBaseEditor = null;
    $('attachment-edit-base').hidden = true;
    $('attachment-edit-canvas').hidden = true;
    $('attachment-dialog-viewer').querySelector('.wiki-canvas-viewer')?.dispose?.();
    $('attachment-dialog-viewer').querySelector('.wiki-bases-viewer')?.dispose?.();
    $('attachment-dialog-viewer').querySelector('.wiki-drawio-viewer')?.dispose?.();
    $('attachment-dialog-viewer').replaceChildren();
    $('attachment-dialog').classList.remove('canvas-dialog-open', 'bases-dialog-open', 'drawio-dialog-open');
    if (attachmentDialogURL) { URL.revokeObjectURL(attachmentDialogURL); attachmentDialogURL = null; }
  });
  function showImage(path) {
    const dialog = $('image-dialog');
    const img = $('image-dialog-preview');
    if (imageDialogURL) { URL.revokeObjectURL(imageDialogURL); imageDialogURL = null; }
    $('image-dialog-path').textContent = path;
    $('image-dialog-title').textContent = basename(path);
    $('image-insert').disabled = bridge.getMode() !== 'readwrite' || !activePath || operations.isBusy();
    $('image-insert').onclick = () => {
      if (imageDialogURL === null || !activePath || bridge.getMode() !== 'readwrite') return;
      if (insertAttachment(path)) dialog.close();
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
  const floatingDelete = $('tree-delete-overlay');
  let deleteHover = null;
  function hideTreeDelete() { deleteHover = null; floatingDelete.hidden = true; }
  function positionTreeDelete() {
    if (!deleteHover || !deleteEnabled || bridge.getMode() !== 'readwrite' || !deleteHover.row.isConnected) {
      hideTreeDelete(); return;
    }
    const row = deleteHover.row.getBoundingClientRect();
    const viewport = ui.tree.getBoundingClientRect();
    if (row.bottom <= viewport.top + 2 || row.top >= viewport.bottom - 2) {
      floatingDelete.hidden = true; return;
    }
    const panel = $('side-files').getBoundingClientRect();
    const top = Math.max(viewport.top+2, Math.min(row.top+row.height/2-13,viewport.bottom-28));
    floatingDelete.style.top = (top-panel.top)+'px';
    floatingDelete.setAttribute('aria-label',
      'Delete '+(deleteHover.kind === 'directory' ? 'folder ' : 'file ')+deleteHover.path);
    floatingDelete.hidden = false;
  }
  ui.tree.addEventListener('pointerover', event => {
    const row = event.target.closest('.tree-row');
    if (!row || !ui.tree.contains(row) || !row.dataset.deletePath) return;
    deleteHover = {row, path:row.dataset.deletePath, kind:row.dataset.deleteKind};
    positionTreeDelete();
  });
  ui.tree.addEventListener('focusin', event => {
    const row = event.target.closest('.tree-row');
    if (!row || !row.dataset.deletePath) return;
    deleteHover = {row, path:row.dataset.deletePath, kind:row.dataset.deleteKind};
    positionTreeDelete();
  });
  ui.tree.addEventListener('pointerleave', event => {
    if (event.relatedTarget !== floatingDelete && !floatingDelete.contains(event.relatedTarget)) hideTreeDelete();
  });
  ui.tree.addEventListener('scroll', positionTreeDelete, {passive:true});
  floatingDelete.addEventListener('pointerleave', event => {
    if (!ui.tree.contains(event.relatedTarget)) hideTreeDelete();
  });
  floatingDelete.addEventListener('click', event => {
    event.preventDefault();
    const selected=deleteHover;
    hideTreeDelete();
    if (selected && deleteEnabled && bridge.getMode() === 'readwrite') void deleteItem(selected.path,selected.kind);
  });
  function renderTree() {
    hideTreeDelete();
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
      const glyph = document.createElement('span');
      glyph.className = 'glyph ' + (node.kind === 'directory' ? 'glyph-folder' : node.kind === 'file' ? 'glyph-note' : 'glyph-asset');
      const icons = {image:'▧',audio:'♫',video:'▶',pdf:'▤',canvas:'◇',base:'▦',drawio:'⬡'};
      // Unicode folder/document glyphs make hierarchy clearer than stars
      // and triangles. Only the current Markdown note gets the edit glyph.
      // Other attachment-format icons are intentionally unchanged.
      glyph.textContent = node.kind === 'directory' ? (open ? '📂' : '📁') :
        node.kind === 'file' ? (node.path === activePath ? '📝' : '📄') :
        icons[node.kind] || '◆';
      const label = document.createElement('span'); label.textContent = node.name;
      row.append(glyph, label);
      const entry = document.createElement('div'); entry.className = 'tree-entry';
      entry.append(row);
      if (bridge.hasAsset(node.path)) row.classList.add('tree-attachment');
      // Native HTML5 DnD is enabled only in explicit move mode. The source
      // comes from this tree, never from untrusted external drops.
      if ((node.kind === 'file' || bridge.hasAsset(node.path) ||
           (node.kind === 'directory' && node.path)) &&
          moveEnabled && bridge.getMode() === 'readwrite') {
        row.draggable = true;
        row.classList.add('tree-draggable');
        row.title = 'Drag to a folder to move immediately' + (node.kind === 'file' ? ', or press M for a manual move' : '');
        row.addEventListener('dragstart', event => {
          if (!moveEnabled || operations.isBusy()) { event.preventDefault(); return; }
          draggedPath = node.path;
          draggedKind = node.kind;
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', node.path);
          row.classList.add('tree-drag-source');
        });
        row.addEventListener('dragend', () => { draggedPath = null; draggedKind = null; clearDragHighlights(); });
        row.addEventListener('keydown', event => {
          if (event.key.toLowerCase() === 'm' && !event.altKey && !event.ctrlKey && !event.metaKey) {
            event.preventDefault(); showMoveDialog(node.path);
          }
        });
      }
      if (node.kind === 'directory') {
        row.addEventListener('dragover', event => {
          if (!moveEnabled || !draggedPath ||
              !(bridge.hasFile(draggedPath) || bridge.hasAsset(draggedPath) || draggedKind === 'directory') ||
              operations.isBusy() || node.path === draggedPath ||
              node.path.startsWith(draggedPath+'/')) return;
          event.preventDefault(); event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          clearDragHighlights(); row.classList.add('tree-drop-target');
        });
        row.addEventListener('dragleave', () => row.classList.remove('tree-drop-target'));
        row.addEventListener('drop', event => {
          if (!moveEnabled || !draggedPath ||
              !(bridge.hasFile(draggedPath) || bridge.hasAsset(draggedPath) || draggedKind === 'directory') ||
              operations.isBusy() || node.path === draggedPath ||
              node.path.startsWith(draggedPath+'/')) return;
          event.preventDefault(); event.stopPropagation();
          const source = draggedPath, sourceKind = draggedKind;
          draggedPath = null; draggedKind = null;
          clearDragHighlights();
          // Explicit move mode and a deliberate drop authorize the move.
          // Keep collision/external-change checks, but no confirm/modal for a drop.
          void renamePath(source, combinePath(node.path, basename(source)),
            { directDrop: true, sourceKind });
        });
      }
      // One shared trash action stays pinned to the visible tree viewport.
      row.dataset.deletePath = node.path || '';
      row.dataset.deleteKind = node.kind;
      parent.append(entry);
      if (node.kind === 'file') {
        row.addEventListener('click', event => {
          if (event.detail > 1) return;
          clearTimeout(treeClickTimer);
          lastTreeSelection = node.path;
          treeClickTimer = setTimeout(() => void selectFile(node.path), 265);
        });
        row.addEventListener('dblclick', event => {
          event.preventDefault(); clearTimeout(treeClickTimer); startInlineRename(node);
        });
      } else if (bridge.hasAsset(node.path)) {
        row.addEventListener('click', () => void showAttachment(node.path));
      } else {
        row.addEventListener('click', () => { selectedFolder = node.path; lastTreeSelection = node.path; if (open) expanded.delete(node.path); else expanded.add(node.path); renderTree(); });
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
    ui.count.textContent = `${count(root)} .md · ${bridge.getAssetPaths().length} attachments`;
    ui.rootName.textContent = root.name;
  }
  function setExpandedAll(expand) {
    if (bridge.getMode() === 'none') return;
    const directories = new Set(['']);
    if (expand) {
      const visit = node => {
        if (node.kind !== 'directory') return;
        directories.add(node.path);
        node.children.forEach(visit);
      };
      visit(bridge.getTree());
    }
    expanded = directories;
    renderTree();
    if (expand) {
      // Locate the selected file (or explicitly selected folder) inside the
      // expanded tree without changing the active document or editor focus.
      const selectedPath = lastTreeSelection || activePath || selectedFolder;
      requestAnimationFrame(() => {
        if (!selectedPath) return;
        const selected = Array.from(ui.tree.querySelectorAll('.tree-row'))
          .find(row => row.getAttribute('aria-label') === selectedPath);
        if (selected) selected.scrollIntoView({
          behavior:'instant', block:'center', inline:'nearest'
        });
      });
    }
  }
  function showScanProgress(progress) {
    notice(`Scanning folders… ${progress.directories} folders, ${progress.files} notes` +
      (progress.skipped ? ` · inaccessible folders: ${progress.skipped}` : '') + ' (please wait)');
  }
  function applyOpen(result, options = {}) {
    operations.invalidateReads();
    if ($('image-dialog').open) $('image-dialog').close();
    const savedExpanded = options.preserveTree ? new Set(expanded) : new Set(['']);
    const savedFolder = options.preserveTree ? selectedFolder : '';
    const savedFilter = options.preserveTree ? ui.search.value : '';
    clearEditor(); inlineDraft = null;
    selectedFolder = savedFolder; expanded = savedExpanded; ui.search.value = savedFilter;
    if (!options.preserveTree) lastTreeSelection = null;
    if (!options.preserveTree) { navigationHistory.length = 0; updateBackButton(); }
    ui.mode.textContent = result.mode === 'readwrite' ? 'Read/write' : 'Read-only';
    ui.refresh.disabled = !bridge.getRootHandle();
    $('expand-all').disabled = false;
    $('collapse-all').disabled = false;
    ui.readonlyToggle.checked = result.mode === 'readonly';
    $('new-file').disabled = result.mode !== 'readwrite';
    $('new-folder').disabled = result.mode !== 'readwrite';
    draggedPath = null; draggedKind = null; moveEnabled = false; deleteEnabled = false;
    updateMoveModeUI(); updateDeleteModeUI();
    wikiIndex.invalidate(); indexPromise = null;
    $('fulltext-results').replaceChildren(); $('backlinks-results').replaceChildren();
    backlinksForPath = null;
    $('fulltext-status').textContent = 'The search index will be built on first use. No content leaves your computer.';
    renderTree();
    const skipped = result.scanInfo?.skipped || 0;
    if (skipped) {
      const sample = (result.scanInfo.skippedPaths || []).join(', ');
      notice(`Wiki opened, but ${skipped} subfolders could not be read` +
        (sample ? ` (e.g. ${sample})` : '') + '. These contents are not shown; other folders are available.', 'error');
    } else {
      notice(result.mode === 'readwrite'
        ? `Wiki opened with read/write access (${result.scanInfo?.files ?? '?'} notes). Edited notes are automatically saved every 5 seconds (Ctrl+S also works).`
        : 'Wiki opened read-only. Preview and links remain available.', 'success');
    }
  }
  function invalidateWikiIndex() {
    wikiIndex.invalidate(); indexPromise = null;
    $('fulltext-status').textContent = 'The full-text index will be rebuilt on the next search.';
    $('fulltext-results').replaceChildren();
    $('backlinks-results').replaceChildren();
    backlinksForPath = null;
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
  function confirmDeletion(path, kind, snapshot, discardsCurrent) {
    const dialog = $('delete-dialog');
    const folder = kind === 'directory';
    const needsAck = folder && snapshot.files > 0;
    $('delete-dialog-title').textContent = folder ? 'Delete folder permanently?' : 'Delete note permanently?';
    $('delete-dialog-path').textContent = path;
    $('delete-dialog-message').textContent = folder
      ? 'This folder contains '+snapshot.files+' files and '+
        Math.max(0,snapshot.directories-1)+' subfolders, including possible non-Markdown data. This action cannot be undone.'
      : 'This note will be permanently removed from your wiki. This action cannot be undone.';
    $('delete-dialog-ack-group').hidden = !needsAck;
    $('delete-dialog-ack').checked = false;
    $('delete-dialog-confirm').disabled = needsAck;
    if (discardsCurrent) $('delete-dialog-message').textContent +=
      ' Unsaved changes in the selected note will also be lost.';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), {once:true});
      dialog.showModal();
      requestAnimationFrame(() => $('delete-dialog-cancel').focus());
    });
  }
  $('delete-dialog-ack').addEventListener('change', () => {
    $('delete-dialog-confirm').disabled =
      !$('delete-dialog-ack-group').hidden && !$('delete-dialog-ack').checked;
  });
  $('delete-dialog-cancel').addEventListener('click', () => $('delete-dialog').close('cancel'));
  $('delete-dialog-confirm').addEventListener('click', () => {
    if (!$('delete-dialog-confirm').disabled) $('delete-dialog').close('delete');
  });
  async function deleteItem(path, kind) {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    // No native alert on deletion. The centered modal confirms the target.
    // Save unrelated dirty notes first; never discard source changes silently.
    const deletingOpen = activePath === path ||
      (kind === 'directory' && activePath?.startsWith(path + '/'));
    if (isDirty() && !deletingOpen && !await saveCurrent(true,true)) {
      notice('Deletion cancelled: the current note could not be saved.', 'error');
      return;
    }
    if (!beginOperation('delete')) return;
    try {
      const snapshot = await bridge.deletionSnapshot(path, kind);
      if (!await confirmDeletion(path, kind, snapshot, deletingOpen && isDirty())) {
        notice('Deletion cancelled.'); return;
      }
      await bridge.deleteEntry(path, kind, snapshot);
      invalidateWikiIndex();
      if (deletingOpen) clearEditor();
      renderTree();
      notice(`Deleted: ${path}`, 'success');
    } catch (err) { notice('Deletion failed: ' + err.message, 'error'); }
    finally { endOperation('delete'); }
  }
  async function renamePath(oldPath, requested, options = {}) {
    if (!oldPath || bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    if (isDirty()) {
      notice('Save or discard unsaved changes before moving a file.', 'error'); return;
    }
    if (!requested || !requested.trim() || !beginOperation('rename')) return;
    updateMoveModeUI();
    let moved = null, summaryNotice = '';
    try {
      const movingFolder = options.sourceKind === 'directory';
      const movingImage = !movingFolder && bridge.hasAsset(oldPath);
      const newPath = movingFolder ? bridge.normalizeDirectoryDestination(requested) :
        movingImage ? bridge.normalizeAssetDestination(requested) : bridge.normalizeDestination(requested);
      if (newPath === oldPath) return;
      notice('Checking links across the wiki…');
      const snapshots = await window.LocalWikiMigration.snapshotAll(bridge);
      const plan = movingFolder
        ? window.LocalWikiMigration.planDirectory(snapshots, oldPath, newPath, bridge.getAssetPaths())
        : movingImage
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
      // Folder moves affect entire subtrees and arbitrary binary files.
      // Always confirm, even on direct drag and drop.
      if ((movingFolder || (!options.directDrop && plan.totalLinks > 0)) &&
          !window.confirm(summary)) { notice('Move cancelled.'); return; }
      const result = movingFolder
        ? await window.LocalWikiMigration.executeDirectory(bridge, plan, snapshots)
        : movingImage
          ? await window.LocalWikiMigration.executeAsset(bridge, plan, snapshots, await bridge.assetFingerprint(oldPath))
          : await window.LocalWikiMigration.execute(bridge, plan, snapshots);
      invalidateWikiIndex();
      for (const prefix of newPath.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))) expanded.add(prefix);
      moved = result.moved;
      if (movingFolder) {
        expanded = new Set(Array.from(expanded, p => p===oldPath||p.startsWith(oldPath+'/')
          ? newPath+p.slice(oldPath.length) : p));
        if (selectedFolder===oldPath||selectedFolder.startsWith(oldPath+'/'))
          selectedFolder=newPath+selectedFolder.slice(oldPath.length);
      }
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
      const next = options.sourceKind === 'directory' && activePath?.startsWith(oldPath+'/')
        ? moved+activePath.slice(oldPath.length) : activePath === oldPath ? moved : activePath;
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
  let previewExporting=false;
  function closePreviewExportMenu() {
    $('preview-export-options').hidden=true;
    $('preview-export-toggle').setAttribute('aria-expanded','false');
  }
  function updatePreviewExportEnabled() {
    const toggle=$('preview-export-toggle');
    toggle.disabled=!activePath || previewExporting;
    if (toggle.disabled) closePreviewExportMenu();
  }
  $('preview-export-toggle').addEventListener('click',()=>{
    if (previewExporting || !activePath) return;
    const menu=$('preview-export-options');
    menu.hidden=!menu.hidden;
    $('preview-export-toggle').setAttribute('aria-expanded',String(!menu.hidden));
    if (!menu.hidden) $('preview-export-html').focus();
  });
  document.addEventListener('pointerdown',event=>{
    if (!event.target.closest('.preview-export-menu')) closePreviewExportMenu();
  });
  $('preview-export-options').addEventListener('keydown',event=>{
    if (event.key==='Escape'){
      event.preventDefault();closePreviewExportMenu();$('preview-export-toggle').focus();
    }
    if (event.key==='ArrowDown' || event.key==='ArrowUp') {
      event.preventDefault();
      const buttons=Array.from($('preview-export-options').querySelectorAll('button'));
      const index=buttons.indexOf(document.activeElement);
      buttons[(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length].focus();
    }
  });
  async function exportRenderedPreview(kind,popup,path) {
    const exporter=window.LocalWikiPreviewExport;
    // A pending 3-second debounce must never produce an outdated export.
    if (renderTimer) renderPreview(true);
    await exporter.waitForReady(ui.preview,()=>$('render-status').textContent.includes('Rendering:'));
    if (!activePath || activePath!==path)
      throw new Error('The selected note changed during export. Please retry.');
    const html=await exporter.build(ui.preview,{title:basename(path),theme:kind==='pdf'?'light':'current'});
    if (kind==='html') {
      exporter.downloadHtml(html,exporter.fileName(path,'html'));
      notice('Standalone HTML downloaded with inline styles and local preview assets.','success');
    } else {
      await exporter.printHtml(html,popup);
      notice('In the print dialog, choose Save as PDF. PDF always uses the light theme; the app theme stays unchanged.','success');
    }
  }
  function startPreviewExport(kind) {
    closePreviewExportMenu();
    if (!activePath || previewExporting) return;
    const path=activePath;
    let popup=null;
    if (kind==='pdf') {
      try {popup=window.LocalWikiPreviewExport.openPrintWindow();}
      catch(error){notice('Cannot open PDF preview: '+error.message,'error');return;}
    }
    previewExporting=true;updatePreviewExportEnabled();
    void exportRenderedPreview(kind,popup,path).catch(error=>{
      if (popup && !popup.closed) popup.close();
      notice('Preview export failed: '+error.message,'error');
    }).finally(()=>{previewExporting=false;updatePreviewExportEnabled();});
  }
  $('preview-export-html').addEventListener('click',()=>startPreviewExport('html'));
  $('preview-export-pdf').addEventListener('click',()=>startPreviewExport('pdf'));
  let scrollSyncEnabled=safeStored('local-wiki-scroll-sync','off')==='on';
  let scrollSyncLock=false;
  function updateScrollSyncButton() {
    const toggle=$('scroll-sync-toggle');
    toggle.textContent='Scroll sync: '+(scrollSyncEnabled?'On':'Off');
    toggle.setAttribute('aria-pressed',String(scrollSyncEnabled));
    toggle.disabled=selectedMode!=='split'||!activePath;
    toggle.title='Synchronize scrolling in Side by side mode ('+
      (scrollSyncEnabled?'on':'off')+'). It does not move your cursor or edit the note.';
  }
  function synchronizeScroll(origin) {
    if (!scrollSyncEnabled||scrollSyncLock||!activePath||selectedMode!=='split')return;
    // Scrolls triggered by caret-preserving preview refresh are not user input.
    if(origin==='preview'&&previewPosition&&!previewPosition.userMoved)return;
    const info=editor.cm.getScrollInfo();
    const maxEditor=Math.max(0,info.height-info.clientHeight);
    const maxPreview=Math.max(0,ui.preview.scrollHeight-ui.preview.clientHeight);
    scrollSyncLock=true;
    if(origin==='editor') {
      const fraction=maxEditor>0?info.top/maxEditor:0;
      ui.preview.scrollTop=fraction*maxPreview;
    } else {
      const fraction=maxPreview>0?ui.preview.scrollTop/maxPreview:0;
      editor.cm.scrollTo(null,fraction*maxEditor);
    }
    requestAnimationFrame(()=>{scrollSyncLock=false;});
  }
  editor.cm.on('scroll',()=>synchronizeScroll('editor'));
  ui.preview.addEventListener('scroll',()=>synchronizeScroll('preview'),{passive:true});
  $('scroll-sync-toggle').addEventListener('click',()=>{
    if($('scroll-sync-toggle').disabled)return;
    scrollSyncEnabled=!scrollSyncEnabled;
    safeStore('local-wiki-scroll-sync',scrollSyncEnabled?'on':'off');
    updateScrollSyncButton();
  });
  function setView(mode) {
    selectedMode = mode; ui.grid.dataset.layout = mode;
    for (const button of document.querySelectorAll('.view-switch button[data-view]')) {
      const active=button.dataset.view===mode;
      button.classList.toggle('active',active);
      button.setAttribute('aria-pressed',String(active));
    }
    closePreviewExportMenu();
    updateScrollSyncButton();
    redrawDirty();
    if (mode !== 'preview') requestAnimationFrame(() => editor.refresh());
  }
  function setSideTab(tab) {
    for (const b of document.querySelectorAll('[data-side]')) b.classList.toggle('active', b.dataset.side === tab);
    for (const id of ['files','search','links','toc']) $(`side-${id}`).hidden = id !== tab;
    if (tab === 'toc') buildToc();
    if (tab === 'links') { buildOutlinks(); void doBacklinks(); }
    if (tab !== 'files') hideTreeDelete();
  }
  function addResult(parent, path, detail, click) {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'result-item';
    const label = document.createElement('strong'); label.textContent = path;
    const info = document.createElement('span'); info.className = 'snippet'; info.textContent = detail;
    row.append(label, info); row.addEventListener('click', click); parent.append(row);
  }
  function buildOutlinks() {
    const area = $('outlinks-results'); area.replaceChildren();
    if (!activePath) return;
    const outgoing = wikiIndex.outgoing(activePath, editor.getValue());
    for (const link of outgoing) {
      addResult(area, link.target, 'Line '+link.line+' · '+link.label,
        () => void goToLinkOccurrence(link));
    }
  }
  function buildToc() {
    const target = $('toc'); target.replaceChildren();
    if (!activePath) { target.textContent = 'Open a note.'; return; }
    const headings = Array.from(ui.preview.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    if (!headings.length) { target.textContent = 'No headings in this note.'; return; }
    // Resolve heading positions once, in document order. The old lastLine
    // variable changed *on each click*, so navigating backwards could move
    // the source cursor to the wrong occurrence (or nowhere).
    const lines = editor.getValue().split('\n'), positions = [];
    let fence=null;
    for (let i=0;i<lines.length;i++) {
      const line=lines[i],mark=/^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (mark) {
        if (!fence) fence={char:mark[1][0],length:mark[1].length};
        else if(mark[1][0]===fence.char && mark[1].length>=fence.length) fence=null;
        continue;
      }
      if(fence) continue;
      const atx=/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
      if (atx) {
        positions.push({line:i,depth:atx[1].length,
          slug:window.LocalWikiNavigation.headingSlug(atx[2].replace(/[ \t]+#+[ \t]*$/,''))});
        continue;
      }
      if(i>0 && /^ {0,3}(=+|-+)[ \t]*$/.test(line) && lines[i-1].trim()) {
        positions.push({line:i-1,depth:line.trim()[0]==='='?1:2,
          slug:window.LocalWikiNavigation.headingSlug(lines[i-1])});
      }
    }
    const used=new Set();
    headings.forEach((h,index)=>{
      const depth=Number(h.tagName.slice(1));
      const slug=window.LocalWikiNavigation.headingSlug(h.textContent);
      const position=positions.findIndex((p,i)=>!used.has(i)&&p.depth===depth&&p.slug===slug);
      if(position>=0)used.add(position);
      const sourceLine=position>=0?positions[position].line:null;
      const button=document.createElement('button');button.className='toc-item';button.type='button';
      button.style.paddingLeft=`${8+(depth-1)*10}px`;
      button.textContent=h.textContent.trim();
      button.addEventListener('click',()=>{
        // TOC navigation preserves the active layout. Preview-only scrolls
        // the reader; editor-only positions the caret; split updates both.
        if(selectedMode!=='edit')
          h.scrollIntoView({behavior:'instant',block:'center'});
        if(selectedMode!=='preview'){
          if(sourceLine!==null){
            const ch=lines[sourceLine].search(/\S/);
            editor.cm.setCursor(sourceLine,Math.max(0,ch));
            editor.cm.scrollIntoView({line:sourceLine,ch:0},75);
            editor.focus();
          } else {
            notice('This heading is generated by Markdown and has no exact source line.');
          }
        }
      });
      target.append(button);
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
    const opened = await navigateTo(path);
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
      // The results count already says '0 matches'; keep the panel clean.
      $('fulltext-status').textContent = `${results.length} matches (up to 3 per file, maximum 100 results).`;
    } finally { $('fulltext-run').disabled = false; }
  }
  function highlightLinkInPreview(link) {
    ui.preview.querySelectorAll('a.wiki-link-location').forEach(a=>a.classList.remove('wiki-link-location'));
    const matches=Array.from(ui.preview.querySelectorAll('a')).filter(a=>
      findDoc(a.getAttribute('href')||'') === link.target);
    const found = matches[link.ordinal] || matches.find(a=>a.textContent.trim() === link.label);
    if (!found) return false;
    found.classList.add('wiki-link-location');
    found.scrollIntoView({ behavior:'instant', block:'center' });
    return true;
  }
  async function goToLinkOccurrence(link) {
    // Out-links locate the link in this note. In-links first open the source
    // note, then jump to the specific occurrence, even if it is repeated.
    if (!link || !bridge.hasFile(link.path)) return;
    const opened=link.path === activePath || await navigateTo(link.path);
    if (!opened || activePath !== link.path) return;
    if (selectedMode !== 'preview') {
      const line=Math.max(0,link.line-1), ch=Math.max(0,link.column);
      editor.cm.setCursor(line,ch);
      editor.cm.scrollIntoView({line,ch},70);
      editor.focus();
    }
    if (selectedMode !== 'edit' && !highlightLinkInPreview(link)) {
      notice('The source link is at line '+link.line+'; it has no rendered anchor in the preview.');
    }
  }
  async function doBacklinks() {
    const path = activePath, request = ++backlinkRequest;
    const area = $('backlinks-results');
    if (!path) { area.replaceChildren(); return; }
    if (backlinksForPath === path) return;
    area.replaceChildren();
    backlinksForPath = path;
    try {
      if (!await ensureIndex() || path !== activePath || request !== backlinkRequest) {
        if (backlinksForPath === path) backlinksForPath = null;
        return;
      }
      const refs = wikiIndex.incoming(path);
      if (!refs.length) notice('No other notes link to this document.');
      else refs.forEach(link => addResult(area, link.path,
        'Line '+link.line+' · '+link.label, () => void goToLinkOccurrence(link)));
    } catch (error) {
      if (request === backlinkRequest) {
        backlinksForPath = null; notice('Backlink lookup failed: '+error.message,'error');
      }
    }
  }
  document.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => setSideTab(b.dataset.side)));
  $('fulltext-run').addEventListener('click', () => void doFulltext());
  $('fulltext-query').addEventListener('keydown', e => { if (e.key === 'Enter') void doFulltext(); });
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
    try { applyOpen(await bridge.refresh(showScanProgress), { preserveTree: true }); refreshed = true; }
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
      ? 'Move mode enabled. Drag notes or attachments onto a folder. Unsaved edits and collisions still block moves.'
      : 'Move mode disabled. File dragging is off.');
  });
  $('new-file').addEventListener('click', () => startDraft('file'));
  $('new-folder').addEventListener('click', () => startDraft('directory'));
  editor.onChange(() => { redrawDirty(); scheduleRender(); });
  editor.cm.on('cursorActivity',updateSourceStats);
  document.querySelectorAll('[data-format]').forEach(button => button.addEventListener('click', () => editor.format(button.dataset.format)));
  // Local vault chooser for image, media, PDF, Canvas, Base and draw.io
  // toolbar buttons. Paths originate only from the scanned local file tree.
  const assetDialog=$('toolbar-asset-dialog');
  const assetSearch=$('toolbar-asset-search');
  const assetResults=$('toolbar-asset-results');
  let assetKind=null;
  const assetLabels={image:'images',video:'videos',audio:'audio files',
    pdf:'PDF documents',canvas:'JSON Canvas boards',base:'Obsidian Bases',drawio:'draw.io diagrams'};
  function renderAssetChoices() {
    const query=assetSearch.value.trim().toLocaleLowerCase();
    assetResults.replaceChildren();
    if (!assetKind) return;
    const all=bridge.getAssetPaths().filter(path=>types.kind(path)===assetKind);
    const matches=all.filter(path=>path.toLocaleLowerCase().includes(query)).sort((a,b)=>a.localeCompare(b));
    for (const path of matches.slice(0,160)) {
      const button=document.createElement('button');
      button.type='button';button.setAttribute('role','option');
      button.textContent=path;button.title='Insert '+path+' into the current Markdown note';
      button.addEventListener('click',()=>{
        if(insertAttachment(path)) assetDialog.close();
      });
      assetResults.append(button);
    }
    if (!matches.length) {
      const p=document.createElement('p');
      p.className='toolbar-asset-empty';
      p.textContent=all.length
        ? 'No matching '+assetLabels[assetKind]+'. Try another name or path.'
        : 'No '+assetLabels[assetKind]+' found in this wiki. Add a supported file to your local folder first.';
      assetResults.append(p);
    } else if (matches.length>160) {
      const p=document.createElement('p');
      p.className='toolbar-asset-empty';
      p.textContent='Showing the first 160 files. Narrow the search to find more.';
      assetResults.append(p);
    }
  }
  document.querySelectorAll('.format-toolbar [data-asset-kind]').forEach(button=>{
    button.addEventListener('click',()=>{
      if (!activePath || bridge.getMode()!=='readwrite' || operations.isBusy()) return;
      assetKind=button.dataset.assetKind;
      assetSearch.value='';
      $('toolbar-asset-title').textContent='Insert '+(assetLabels[assetKind]||'attachment');
      renderAssetChoices();
      assetDialog.showModal();
      assetSearch.focus();
    });
  });
  assetSearch.addEventListener('input',renderAssetChoices);
  $('toolbar-asset-close').addEventListener('click',()=>assetDialog.close());
  assetDialog.addEventListener('close',()=>{assetKind=null;});
  ui.search.addEventListener('input', renderTree);
  $('expand-all').addEventListener('click', () => setExpandedAll(true));
  $('collapse-all').addEventListener('click', () => setExpandedAll(false));
  document.querySelectorAll('.view-switch button[data-view]').forEach(b => b.addEventListener('click', () => setView(b.dataset.view)));
  async function saveCurrent(automatic = false, force = false) {
    if (!activePath || !isDirty()) return true;
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return false;
    const path = activePath, savedText = editor.getValue();
    // Do not retry a failed autosave forever: the user must make another edit
    // or explicitly press Save. Manual save always remains available.
    if (automatic && !force && autosaveBlocked?.path === path && autosaveBlocked.text === savedText) return false;
    if (!beginOperation('save')) return false;
    // Capture write context before awaiting; later edits remain dirty.
    const expected = fingerprint, bom = hasBOM, eol = lineEnding;
    try {
      const result = await bridge.write(path, (bom ? '\uFEFF' : '') + savedText.replace(/\n/g, eol), expected);
      autosaveBlocked = null;
      if (activePath === path) {
        originalText = savedText;
        fingerprint = result.fingerprint;
        wikiIndex.update(path, savedText);
        // Autosave must be quiet; manual Save retains immediate feedback.
        if (!automatic) {
          notice(editor.getValue() === savedText
            ? `Saved to original file: ${path}`
            : `Saved an earlier version of ${path}. Newer edits still need saving.`, 'success');
        }
      }
      return activePath === path && editor.getValue() === savedText;
    } catch (err) {
      autosaveBlocked = { path, text: savedText };
      notice(`${automatic ? 'Autosave' : 'Save'} blocked: ${err.message} The text remains in the editor.`, 'error');
      return false;
    } finally { endOperation('save'); }
  }
  ui.save.addEventListener('click', () => { void saveCurrent(false); });
  setInterval(() => { void saveCurrent(true); }, AUTOSAVE_INTERVAL_MS);
  ui.preview.addEventListener('click', evt => {
    const a = evt.target.closest('a');
    if (!a || !ui.preview.contains(a)) return;
    const href = a.getAttribute('href') || '';
    const parsed = window.LocalWikiNavigation.splitTarget(href);
    const doc = findDoc(href);
    const attachment = resolveAttachment(parsed.path || href, activePath, Boolean(parsed.isWiki));
    if (doc) {
      evt.preventDefault();
      // Do not scroll if switching documents was cancelled due to unsaved text.
      void navigateTo(doc).then(opened => { if (opened) jumpToHeading(parsed.anchor); });
      return;
    }
    if (attachment) { evt.preventDefault(); void showAttachment(attachment); return; }
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

  // Renderer diagnostics stay accessible even in the complete offline release.

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
    const ready = items.every(([,available])=>available);
    $('renderer-repair-tools').hidden = ready;
    $('renderer-ready-note').hidden = !ready;
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
