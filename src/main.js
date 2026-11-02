(function () {
  'use strict';
  const bridge = window.LocalWikiFS.createBridge();
  const operations = window.LocalWikiOperationGuard.create();
  const $ = id => document.getElementById(id);
  const ui = {
    notice: $('notice'), open: $('open-folder'), readonly: $('open-readonly'), picker: $('directory-input'),
    refresh: $('refresh'), reload: $('reload'), save: $('save'), tree: $('tree'), editor: $('editor'),
    preview: $('preview'), filename: $('filename'), dirty: $('dirty'), search: $('search'),
    mode: $('mode'), rootName: $('root-name'), count: $('count'), grid: $('editor-grid')
  };
  const editor = window.LocalWikiEditor.make(ui.editor);
  const wikiIndex = window.LocalWikiIndex.createIndex(bridge);
  let indexPromise = null;
  let activePath = null, originalText = '', fingerprint = null, lineEnding = '\n', hasBOM = false;
  let expanded = new Set(['']), renderTimer = null, renderSequence = 0;
  let blobURLs = [], selectedMode = 'split';
  const SAFE_IMAGE = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
  function notice(message, variant = '') {
    ui.notice.textContent = message;
    ui.notice.className = `notice ${variant}`.trim();
  }
  function beginOperation(name) {
    if (!operations.acquire(name)) {
      notice(`Probíhá operace „${operations.currentOperation()}“. Nejprve ji dokonči.`, 'error');
      return false;
    }
    // Prevent editing a document that may be replaced by a move, open or refresh.
    // Saving is the exception: edits made while a write is in progress remain dirty.
    if (name !== 'save') editor.setReadOnly(true);
    redrawDirty();
    return true;
  }
  function endOperation(name) {
    operations.release(name);
    editor.setReadOnly(bridge.getMode() !== 'readwrite' || !activePath);
    redrawDirty();
  }
  function isDirty() { return activePath !== null && editor.getValue() !== originalText; }
  function confirmDiscard() {
    return !isDirty() || window.confirm('Aktuální soubor obsahuje neuložené změny. Zahodit je?');
  }
  function redrawDirty() {
    const dirty = isDirty();
    ui.dirty.textContent = dirty ? '● Neuloženo' : '';
    ui.save.disabled = operations.isBusy() || bridge.getMode() !== 'readwrite' || !dirty;
    $('save-status').textContent = dirty ? 'Změny nejsou uloženy na disk' : activePath ? 'Soubor beze změn' : 'Žádný soubor';
    $('stats').textContent = `${editor.getValue().length} znaků · ${editor.getValue() ? editor.getValue().split('\n').length : 0} řádků`;
  }
  function releaseImages() { blobURLs.forEach(url => URL.revokeObjectURL(url)); blobURLs = []; }
  function clearEditor() {
    renderSequence++; clearTimeout(renderTimer); // Cancel delayed render/image updates.
    activePath = null; originalText = ''; fingerprint = null; hasBOM = false;
    editor.setValue(''); editor.setReadOnly(true);
    ui.filename.textContent = 'Žádný otevřený soubor';
    $('rename-file').disabled = true;
    ui.reload.disabled = true; ui.preview.replaceChildren();
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
      notice(`Nadpis v poznámce nebyl nalezen: ${anchor}`, 'error');
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
        img.replaceWith(document.createTextNode(`[obrázek nenalezen nebo nejednoznačný: ${img.alt || raw || '?'}]`));
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
        if (sequence === renderSequence) img.replaceWith(document.createTextNode(`[obrázek nelze načíst: ${raw}]`));
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
        const parts = [stats.rendered ? `Diagramy/noty: ${stats.rendered}` : '',
          stats.pending ? `Vykreslování: ${stats.pending}` : '',
          stats.missing ? `Chybí knihovny: ${stats.missing}` : '',
          stats.failed ? `Chyby renderu: ${stats.failed}` : ''];
        $('render-status').textContent = [baseStatus, ...parts].filter(Boolean).join(' · ');
      };
      const result = window.LocalWikiRender.render(editor.getValue(), ui.preview, { onDiagramUpdate: report });
      baseStatus = [result.expressions ? `Math: ${result.expressions}` : '',
        result.callouts ? `Callouty: ${result.callouts}` : ''].filter(Boolean).join(' · ') || 'Offline Markdown';
      report(result.diagrams);
      buildToc();
      void loadImages(result.imageNodes, activePath, sequence);
    } catch (err) {
      const p = document.createElement('p'); p.textContent = `Náhled selhal: ${err.message}`;
      ui.preview.replaceChildren(p);
      $('render-status').textContent = 'Chyba náhledu';
    }
  }
  function scheduleRender() { clearTimeout(renderTimer); renderTimer = setTimeout(renderPreview, 170); }
  async function selectFile(path, options = {}) {
    if (path === activePath && !options.force) return true;
    if (operations.isBusy()) { notice('Probíhá zápis nebo jiná disková operace; přepnutí dokumentu je dočasně zakázané.', 'error'); return false; }
    if (!options.skipConfirm && !confirmDiscard()) return false;
    const ticket = operations.beginRead();
    const formerPath = activePath, formerText = editor.getValue();
    try {
      const result = await bridge.read(path);
      if (!operations.isCurrentRead(ticket)) return false;
      if (activePath !== formerPath || editor.getValue() !== formerText) {
        notice('Během načítání se změnil editor. Přepnutí bylo zrušeno kvůli neuloženým úpravám.', 'error');
        return false;
      }
      activePath = path; fingerprint = result.fingerprint; hasBOM = Boolean(result.hasBOM);
      lineEnding = result.text.includes('\r\n') ? '\r\n' : '\n';
      const normalizedText = result.text.replace(/\r\n?/g, '\n');
      originalText = normalizedText; editor.setValue(normalizedText);
      editor.setReadOnly(bridge.getMode() !== 'readwrite');
      ui.filename.textContent = path; ui.reload.disabled = false;
      $('rename-file').disabled = bridge.getMode() !== 'readwrite';
      $('backlinks-results').textContent = 'Klikni na „Zjistit odkazy na tuto stránku“. '; 
      redrawDirty(); renderTree(); renderPreview();
      ui.preview.scrollTop = 0;
      notice(`Otevřen soubor: ${path}`, 'success');
      return true;
    } catch (err) {
      if (operations.isCurrentRead(ticket)) notice(`Soubor nelze otevřít: ${err.message}`, 'error');
      return false;
    }
  }
  async function reloadActive() {
    if (!activePath || !confirmDiscard()) return;
    await selectFile(activePath, { force: true, skipConfirm: true });
  }
  function filteredNode(node, needle) {
    if (!needle) return true;
    if (node.kind === 'file') return node.path.toLocaleLowerCase('cs').includes(needle);
    return node.children.some(child => filteredNode(child, needle));
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
      row.setAttribute('aria-label', node.path || node.name);
      const open = expanded.has(node.path) || Boolean(needle);
      const glyph = document.createElement('span'); glyph.className = 'glyph';
      glyph.textContent = node.kind === 'directory' ? (open ? '▾' : '▸') : '◦';
      const label = document.createElement('span'); label.textContent = node.name;
      row.append(glyph, label); parent.append(row);
      if (node.kind === 'file') row.addEventListener('click', () => void selectFile(node.path));
      else {
        row.addEventListener('click', () => { if (open) expanded.delete(node.path); else expanded.add(node.path); renderTree(); });
        if (open) {
          const nested = document.createElement('div'); nested.className = 'tree-children';
          parent.append(nested); node.children.forEach(child => make(child, nested));
        }
      }
    };
    make(root, ui.tree);
    const count = node => node.kind === 'file' ? 1 : node.children.reduce((n, child) => n + count(child), 0);
    ui.count.textContent = `${count(root)} .md`;
    ui.rootName.textContent = root.name;
  }
  function showScanProgress(progress) {
    notice('Načítám adresáře… ' + progress.directories + ' složek, ' + progress.files + ' poznámek' +
      (progress.skipped ? ' · nepřístupné složky: ' + progress.skipped : '') + ' (prosím vyčkej)');
  }
  function applyOpen(result) {
    operations.invalidateReads();
    clearEditor(); expanded = new Set(['']); ui.search.value = '';
    ui.mode.textContent = result.mode === 'readwrite' ? 'Čtení + zápis' : 'Jen pro čtení';
    ui.refresh.disabled = result.mode !== 'readwrite';
    $('new-file').disabled = result.mode !== 'readwrite';
    $('new-folder').disabled = result.mode !== 'readwrite';
    wikiIndex.invalidate(); indexPromise = null;
    $('fulltext-results').replaceChildren(); $('backlinks-results').replaceChildren();
    $('fulltext-status').textContent = 'Index bude vytvořen při prvním hledání. Žádná data neopustí počítač.';
    renderTree();
    const skipped = result.scanInfo?.skipped || 0;
    if (skipped) {
      const sample = (result.scanInfo.skippedPaths || []).join(', ');
      notice('Wiki otevřena, ale ' + skipped + ' podsložek se nepodařilo přečíst' +
        (sample ? ' (např. ' + sample + ')' : '') + '. Jejich obsah se nezobrazuje; ostatní složky fungují.', 'error');
    } else {
      notice(result.mode === 'readwrite'
        ? 'Wiki otevřena pro čtení i zápis (' + (result.scanInfo?.files ?? '?') + ' poznámek). Soubor se přepisuje až po kliknutí na Uložit.'
        : 'Wiki otevřena jen pro čtení. Náhled a odkazy fungují i bez práva zápisu.', 'success');
    }
  }
  function invalidateWikiIndex() {
    wikiIndex.invalidate(); indexPromise = null;
    $('fulltext-status').textContent = 'Po změně stromu bude fulltext vytvořen při dalším hledání.';
    $('fulltext-results').replaceChildren();
    $('backlinks-results').replaceChildren();
  }
  async function createNew(kind) {
    if (bridge.getMode() !== 'readwrite' || operations.isBusy()) return;
    if (kind === 'file' && !confirmDiscard()) return;
    const parent = activePath && activePath.includes('/') ? activePath.slice(0, activePath.lastIndexOf('/') + 1) : '';
    const suggested = parent + (kind === 'file' ? 'Nová poznámka.md' : 'Nová složka');
    const path = window.prompt(kind === 'file'
      ? 'Cesta poznámky od kořene wiki, např. /knowledge/pivo.md. Nové složky lze potvrdit v dalším kroku:'
      : 'Cesta nové složky od kořene wiki, např. /knowledge/novaslozka:', suggested);
    if (path === null || !path.trim()) return;
    let createParents = false;
    try {
      const missing = await bridge.missingParents(path, kind);
      if (missing) {
        createParents = window.confirm('Složka „' + missing + '“ neexistuje.\n\n' +
          'Vytvořit chybějící podsložky uvnitř vybrané wiki a pokračovat?');
        if (!createParents) { notice('Vytvoření bylo zrušeno; žádná složka nebyla založena.'); return; }
      }
    } catch (error) { notice('Neplatná cesta: ' + error.message, 'error'); return; }
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
        notice(`Vytvořena složka: ${directory}`, 'success');
      }
    } catch (err) { notice(`Nelze vytvořit položku: ${err.message}`, 'error'); }
    finally { endOperation('create'); }
    if (createdPath) {
      clearEditor(); // User explicitly approved discarding old edits before creation.
      if (await selectFile(createdPath)) notice(`Vytvořena poznámka: ${createdPath}. Nyní ji můžeš upravovat.`, 'success');
    }
  }
  async function renameActive() {
    if (!activePath || bridge.getMode() !== 'readwrite') return;
    if (isDirty()) {
      notice('Před přesunem nejprve ulož nebo vrať neuložené změny.', 'error'); return;
    }
    const oldPath = activePath;
    const requested = window.prompt('Nová relativní cesta souboru v rámci wiki (.md):', oldPath);
    if (requested === null || !requested.trim() || !beginOperation('rename')) return;
    $('rename-file').disabled = true;
    let moved = null, summaryNotice = '';
    try {
      const newPath = bridge.normalizeDestination(requested);
      if (newPath === oldPath) return;
      notice('Kontroluji odkazy napříč wiki…');
      const snapshots = await window.LocalWikiMigration.snapshotAll(bridge);
      const plan = window.LocalWikiMigration.plan(snapshots, oldPath, newPath);
      // A transaction spanning multiple disk files is not available in the
      // browser; request explicit user confirmation with the computed scope.
      const examples = plan.changes.slice(0, 6).map(x => `• ${x.path} (${x.links})`).join('\n');
      const more = plan.affectedFiles > 6 ? `\n…a ${plan.affectedFiles - 6} dalších` : '';
      const summary = `Přesunout ${oldPath} → ${newPath}?\n\n` +
        `Předběžně nalezeno ${plan.totalLinks} odkazů k opravě v ${plan.affectedFiles} souborech.` +
        (examples ? `\n${examples}${more}` : '') +
        '\n\nOpravují se jen jednoznačně rozpoznané Markdown a [[wiki]] odkazy. ' +
        'Nepodporované zápisy zůstanou beze změny. Operace více souborů není atomická. ' +
        'Než začneš, měj zálohu wiki. Pokračovat?';
      if (!window.confirm(summary)) { notice('Přesun byl zrušen.'); return; }
      const result = await window.LocalWikiMigration.execute(bridge, plan, snapshots);
      invalidateWikiIndex();
      for (const prefix of newPath.split('/').slice(0, -1).map((_, i, all) => all.slice(0, i + 1).join('/'))) expanded.add(prefix);
      moved = result.moved;
      summaryNotice = `Přesun dokončen: ${oldPath} → ${newPath}. Upraveno ${result.links} odkazů v ${result.updated} dokumentech.`;
    } catch (err) {
      notice(`Přesun se nepodařil: ${err.message}`, 'error');
      // Partial write errors may create a target copy. Re-scan in all cases.
      try {
        await bridge.refresh();
        invalidateWikiIndex(); renderTree();
        if (!bridge.hasFile(activePath)) clearEditor();
      } catch (_) { /* Error message above is the authoritative status. */ }
    } finally {
      endOperation('rename');
      $('rename-file').disabled = !activePath || bridge.getMode() !== 'readwrite';
    }
    if (moved) {
      clearEditor();
      if (await selectFile(moved)) notice(summaryNotice, 'success');
    }
  }
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
    if (!activePath) { target.textContent = 'Otevři poznámku.'; return; }
    const heads = ui.preview.querySelectorAll('h1,h2,h3,h4,h5,h6');
    if (!heads.length) { target.textContent = 'Dokument neobsahuje nadpisy.'; return; }
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
    if (bridge.getMode() === 'none') { notice('Nejprve otevři složku wiki.', 'error'); return false; }
    const status = $('fulltext-status');
    indexPromise = wikiIndex.rebuild((done, total) => {
      status.textContent = `Indexuji lokální wiki: ${done} / ${total} souborů…`;
    }).then(result => {
      if (result.stale) return false;
      status.textContent = `Připraveno: ${result.indexed} z ${result.total} souborů. Index je pouze v paměti prohlížeče.`;
      return true;
    }).catch(err => {
      status.textContent = `Indexování selhalo: ${err.message}`;
      return false;
    }).finally(() => { indexPromise = null; });
    return indexPromise;
  }
  // Search results preserve the selected editor/preview layout.
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
        notice('Soubor je otevřen v náhledu, ale přesný hledaný text nebyl ve vykresleném Markdownu nalezen (může být ve zdrojové syntaxi).');
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
    if (!query) { $('fulltext-status').textContent = 'Zadej hledaný text.'; return; }
    $('fulltext-run').disabled = true;
    try {
      if (!await ensureIndex()) return;
      const results = wikiIndex.search(query, 100);
      const area = $('fulltext-results'); area.replaceChildren();
      for (const hit of results) addResult(area, `${hit.path}:${hit.line}`, hit.snippet,
        () => void openResult(hit.path, hit.line, query));
      if (!results.length) area.textContent = 'Nic nenalezeno.';
      $('fulltext-status').textContent = `${results.length} shod${results.length === 1 ? 'a' : ''} (max. 3 na soubor, nejvýše 100 výsledků).`;
    } finally { $('fulltext-run').disabled = false; }
  }
  async function doBacklinks() {
    if (!activePath) { $('backlinks-results').textContent = 'Nejdřív otevři poznámku.'; return; }
    const path = activePath;
    $('backlinks-run').disabled = true;
    $('backlinks-results').textContent = 'Načítám odkazy…';
    try {
      if (!await ensureIndex()) return;
      if (path !== activePath) return;
      const refs = wikiIndex.backlinks(path);
      const area = $('backlinks-results'); area.replaceChildren();
      if (!refs.length) area.textContent = 'Na tento dokument zatím neodkazuje žádná další poznámka.';
      else refs.forEach(from => addResult(area, from, 'Odkazuje na tento soubor', () => void openResult(from)));
    } finally { $('backlinks-run').disabled = false; }
  }
  document.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', () => setSideTab(b.dataset.side)));
  $('fulltext-run').addEventListener('click', () => void doFulltext());
  $('fulltext-query').addEventListener('keydown', e => { if (e.key === 'Enter') void doFulltext(); });
  $('backlinks-run').addEventListener('click', () => void doBacklinks());
  // Directory bookmarks are strictly opt-in. Only the handle is stored in IndexedDB.
  // The browser retains control of read/write permission. No automatic requestPermission on load.
  const recent = window.LocalWikiRecent;
  const restoreButton = $('restore-last'), forgetButton = $('forget-last');
  const rememberCheckbox = $('remember-root');
  let rememberedHandle = null;
  async function checkRemembered() {
    try {
      rememberedHandle = await recent.restoreHandle();
      restoreButton.disabled = !rememberedHandle;
      forgetButton.disabled = !rememberedHandle;
    } catch (err) {
      rememberedHandle = null;
      restoreButton.disabled = true; forgetButton.disabled = true;
      notice(`Nelze přečíst poslední složku: ${err.message}`, 'error');
    }
  }
  void checkRemembered();
  restoreButton.addEventListener('click', async () => {
    if (!rememberedHandle || !confirmDiscard() || !beginOperation('restore')) return;
    try {
      // Requesting permission is deliberately user-initiated. Browser may decline
      // the request; in that case the old bookmark is not used and nothing is written.
      if (!await recent.ensurePermission(rememberedHandle, true)) {
        throw new Error('Prohlížeč neudělil přístup. Otevři složku znovu tlačítkem Otevřít složku.');
      }
      applyOpen(await bridge.openExisting(rememberedHandle, showScanProgress));
    } catch (err) { notice(`Poslední wiki nelze otevřít: ${err.message}`, 'error'); }
    finally { endOperation('restore'); }
  });
  forgetButton.addEventListener('click', async () => {
    try {
      await recent.forget();
      rememberedHandle = null;
      restoreButton.disabled = true; forgetButton.disabled = true;
      rememberCheckbox.checked = false;
      notice('Zapamatovaný výběr byl smazán z prohlížeče. Otevřená wiki zůstává beze změny.', 'success');
    } catch (err) { notice(`Výběr nelze smazat: ${err.message}`, 'error'); }
  });
  ui.open.addEventListener('click', async () => {
    if (!confirmDiscard() || !beginOperation('open')) return;
    try {
      applyOpen(await bridge.openWritable(showScanProgress));
      if (rememberCheckbox.checked) {
        try {
          await recent.remember(bridge.getRootHandle());
          await checkRemembered();
          if (bridge.getTree()) restoreButton.disabled = false;
        } catch (err) {
          notice(`Wiki je otevřená, ale výběr se nepodařilo zapamatovat: ${err.message}`, 'error');
        }
      }
    }
    catch (err) { if (err.name !== 'AbortError') notice(`Otevření selhalo: ${err.message}`, 'error'); }
    finally { endOperation('open'); }
  });
  ui.readonly.addEventListener('click', () => {
    if (!operations.isBusy() && confirmDiscard()) {
      notice('Zvol složku pro nezapisovatelný režim. Náhled v něm funguje, ale změny nelze ukládat.');
      ui.picker.click();
    }
  });
  ui.picker.addEventListener('change', () => {
    if (operations.isBusy()) { ui.picker.value = ''; return; }
    try { applyOpen(bridge.openReadOnly(ui.picker.files)); }
    catch (err) { notice(err.message, 'error'); }
    ui.picker.value = '';
  });
  ui.refresh.addEventListener('click', async () => {
    if (!confirmDiscard() || !beginOperation('refresh')) return;
    const old = activePath;
    try { applyOpen(await bridge.refresh(showScanProgress)); }
    catch (err) { notice(`Obnovení selhalo: ${err.message}`, 'error'); }
    finally { endOperation('refresh'); }
    if (old && bridge.hasFile(old)) await selectFile(old);
  });
  ui.reload.addEventListener('click', () => void reloadActive());
  $('rename-file').addEventListener('click', () => void renameActive());
  $('new-file').addEventListener('click', () => void createNew('file'));
  $('new-folder').addEventListener('click', () => void createNew('directory'));
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
        if (editor.getValue() === savedText) notice(`Uloženo do původního souboru: ${path}`, 'success');
        else notice(`Uložena předchozí verze ${path}. Novější úpravy v editoru stále čekají na další uložení.`, 'success');
      }
    } catch (err) {
      notice(`Uložení zastaveno: ${err.message} Text zůstal v editoru.`, 'error');
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
    evt.preventDefault(); notice(`Odkaz nelze otevřít: ${href} (soubor ve wiki nebyl nalezen).`, 'error');
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
  $('diag-api').textContent = `${location.protocol} · ${typeof window.showDirectoryPicker === 'function' ? 'File System API ✓' : 'File System API nedostupné'}`;
  setView(selectedMode);

  // Diagnostics reflect actual loaded UMD objects, not the existence of placeholder files.
  $('renderer-check').addEventListener('click', () => {
    const status = window.LocalWikiDiagrams.capabilities();
    const details = $('renderer-details'); details.replaceChildren();
    const items = [
      ['Markdown (marked)', !!window.marked],
      ['Matematika (MathJax)', !!(window.MathJax && window.MathJax.Hub)],
      ['Mermaid diagramy', status.mermaid],
      ['ABC notový zápis', status.abc]
    ];
    for (const [name, available] of items) {
      const row = document.createElement('p'); row.className = 'renderer-detail';
      row.textContent = `${available ? '✓' : '✕'} ${name}: ${available ? 'připraven' : 'chybí knihovna'}`;
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
    output.textContent = 'Provádím lokální test vykreslení diagramu a not…';
    try {
      const result = await window.LocalWikiRendererSmoke.run();
      const symbols = { ok: '✓', missing: '–', failed: '✕' };
      output.replaceChildren();
      for (const [label, status] of [['Mermaid', result.mermaid], ['ABCjs', result.abc]]) {
        const row = document.createElement('p');
        row.textContent = `${symbols[status.status]} ${label}: ${status.message}`;
        output.appendChild(row);
      }
    } catch (error) { output.textContent = `Test nelze dokončit: ${error.message}`; }
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
    status.textContent = 'Vyber složku aplikace obsahující index.html (ne wiki).';
    try {
      const result = await window.LocalWikiRendererInstaller.install({
        onProgress: message => { status.textContent = message; }
      });
      if (result.installed.length) {
        status.textContent = `Nainstalováno: ${result.installed.join(', ')}. Obnov stránku (Ctrl+R), aby se knihovny načetly. K prohlížení wiki už nebude potřeba internet.`;
        notice('Knihovny jsou uložené vedle aplikace. Po obnovení stránky budou fungovat offline.', 'success');
      } else status.textContent = 'Obě knihovny už jsou přibalené. Pokud se nezobrazují, obnov stránku.';
    } catch (err) {
      status.textContent = `Doplnění rendererů se nezdařilo: ${err.message || err}. Zápis se týká jen zvoleného adresáře aplikace.`;
      notice('Doplnění rendererů nebylo dokončeno. Otevři Renderery pro podrobnosti.', 'error');
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
      ? `Vybráno ${count} souborů. Klikni na „Uložit vybrané JS offline“ a potvrď složku aplikace, nikoli wiki.`
      : 'Soubory nejsou vybrány.';
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
        ? `Knihovny ${result.installed.join(', ')} uloženy. Obnov stránku (Ctrl+R). Internet nyní není potřeba.`
        : 'Knihovny už byly přítomny a ověřeny. Nic jsem nepřepsal.';
      notice('Dokončen lokální import rendererů.', 'success');
    } catch (error) {
      status.textContent = `Import nebyl dokončen: ${error?.message || error}`;
      notice('Import rendererů selhal. Zdrojové soubory wiki zůstaly beze změny.', 'error');
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
    notice('Diagnostický soubor byl připraven ke stažení. Neobsahuje obsah ani názvy souborů.', 'success');
  });

  window.LocalWikiDebug = { bridge, editor, operations, wikiIndex, selectFile, renderPreview, findDoc, setSideTab, createNew, renameActive }; // For reproducible offline smoke tests.
})();
