/* Local Wiki file-system adapter. Browser classic script, compatible with file://. */
(function (global) {
  'use strict';
  const SKIP_DIRS = new Set(['.git', '.obsidian', '.github', '.vscode', '.venv', 'node_modules', '_viewer', '.stackedit-data']);
  const MD_EXTENSION = /\.(md|markdown)$/i;
  const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|bmp|avif)$/i;
  const collator = new Intl.Collator('cs', { numeric: true, sensitivity: 'base' });
  function sortEntries(a, b) {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return collator.compare(a.name, b.name);
  }
  function normalizePath(input) {
    const out = [];
    for (const segment of String(input).replace(/\\/g, '/').split('/')) {
      if (!segment || segment === '.') continue;
      if (segment === '..') { if (!out.length) return null; out.pop(); }
      else out.push(segment);
    }
    return out.join('/');
  }
  function relativePath(base, target) {
    if (/^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith('//') || target.startsWith('/')) return null;
    const parts = base ? base.split('/').slice(0, -1) : [];
    return normalizePath([...parts, target.split('#')[0].split('?')[0]].join('/'));
  }
  function createTree(name) { return { kind: 'directory', name, path: '', children: [] }; }
  function insertNode(root, path) {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      const kind = idx === parts.length - 1 ? 'file' : 'directory';
      let child = node.children.find(x => x.kind === kind && x.name === part);
      if (!child) {
        child = { kind, name: part, path: parts.slice(0, idx + 1).join('/') };
        if (kind === 'directory') child.children = [];
        node.children.push(child);
      }
      node = child;
    });
  }
  function sortTree(node) {
    if (node.kind === 'directory') { node.children.sort(sortEntries); node.children.forEach(sortTree); }
  }
  function createBridge() {
    let rootHandle = null;
    let tree = createTree('Wiki');
    let mode = 'none';
    const fileHandles = new Map();
    const assetHandles = new Map();

    // Report progress during large recursive scans. An inaccessible child
    // must not prevent its accessible sibling directories from opening.
    async function scan(handle, onProgress) {
      const nextTree = createTree(handle.name);
      const nextFiles = new Map();
      const nextAssets = new Map();
      const stats = { directories: 0, entries: 0, files: 0, images: 0, skipped: 0 };
      const skippedPaths = [];
      let lastReport = 0;
      function report(force = false) {
        if (typeof onProgress !== 'function') return;
        const now = Date.now();
        if (force || now - lastReport >= 200) {
          lastReport = now;
          onProgress({ ...stats });
        }
      }
      async function maybeYield() {
        if (typeof global.setTimeout === 'function') {
          await new Promise(resolve => global.setTimeout(resolve, 0));
        }
      }
      async function walkDirectory(dirHandle, prefix, parent) {
        const entries = [];
        try {
          for await (const entry of dirHandle.values()) {
            entries.push(entry);
            stats.entries++;
            if (stats.entries % 128 === 0) {
              report(true);
              await maybeYield();
            } else report();
          }
        } catch (error) {
          if (!prefix) {
            throw new Error('Kořenovou složku nelze přečíst: ' + (error.message || error));
          }
          stats.skipped++;
          if (skippedPaths.length < 3) skippedPaths.push(prefix);
          report(true);
          return false;
        }
        stats.directories++;
        entries.sort(sortEntries);
        for (const entry of entries) {
          const path = prefix ? prefix + '/' + entry.name : entry.name;
          if (entry.kind === 'directory') {
            if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
            const folder = { kind: 'directory', name: entry.name, path, children: [] };
            parent.children.push(folder);
            if (!await walkDirectory(entry, path, folder)) parent.children.pop();
          } else if (entry.kind === 'file' && MD_EXTENSION.test(entry.name)) {
            nextFiles.set(path, entry);
            parent.children.push({ kind: 'file', name: entry.name, path });
            stats.files++;
          } else if (entry.kind === 'file' && IMAGE_EXTENSION.test(entry.name)) {
            nextAssets.set(path, entry);
            stats.images++;
          }
          report();
        }
        return true;
      }
      report(true);
      await walkDirectory(handle, '', nextTree);
      report(true);
      return { nextTree, nextFiles, nextAssets, scanInfo: { ...stats, skippedPaths } };
    }
    function applyScanned(result) {
      tree = result.nextTree;
      fileHandles.clear(); result.nextFiles.forEach((h, k) => fileHandles.set(k, h));
      assetHandles.clear(); result.nextAssets.forEach((h, k) => assetHandles.set(k, h));
      return { tree, mode, scanInfo: result.scanInfo || null };
    }
    async function openWritable(onProgress) {
      if (typeof global.showDirectoryPicker !== 'function') throw new Error('V tomto prostředí není dostupné showDirectoryPicker().');
      // Picker must remain directly inside user click's async chain.
      const handle = await global.showDirectoryPicker({ id: 'local-wiki-root', mode: 'readwrite' });
      const found = await scan(handle, onProgress);
      rootHandle = handle; mode = 'readwrite';
      return applyScanned(found);
    }
    async function openExisting(handle, onProgress) {
      if (!handle || handle.kind !== 'directory') throw new Error('Uložená složka není platný adresář.');
      const found = await scan(handle, onProgress);
      rootHandle = handle; mode = 'readwrite';
      return applyScanned(found);
    }
    function openReadOnly(files) {
      const list = Array.from(files || []);
      if (!list.length) throw new Error('Ve vybrané složce nejsou žádné soubory.');
      const first = list[0].webkitRelativePath || list[0].name;
      const rootName = first.split('/')[0] || 'Wiki';
      const nextTree = createTree(rootName), nextFiles = new Map(), nextAssets = new Map();
      for (const file of list) {
        const parts = (file.webkitRelativePath || file.name).split('/');
        if (parts[0] === rootName && parts.length > 1) parts.shift();
        if (parts.slice(0, -1).some(x => SKIP_DIRS.has(x))) continue;
        const path = normalizePath(parts.join('/'));
        if (!path) continue;
        if (MD_EXTENSION.test(path)) { nextFiles.set(path, file); insertNode(nextTree, path); }
        else if (IMAGE_EXTENSION.test(path)) nextAssets.set(path, file);
      }
      sortTree(nextTree);
      rootHandle = null; mode = 'readonly';
      return applyScanned({ nextTree, nextFiles, nextAssets });
    }
    // A content-aware fingerprint protects against external edits that happen
    // to have the same byte length and modification time. These checksums are
    // for accidental change detection, not an adversarial/cryptographic trust boundary.
    function fingerprintBytes(bytes, lastModified) {
      let fnv = 2166136261, a = 1, b = 0;
      for (const value of bytes) {
        fnv = Math.imul(fnv ^ value, 16777619) >>> 0;
        a = (a + value) % 65521;
        b = (b + a) % 65521;
      }
      const adler = ((b << 16) | a) >>> 0;
      return `${bytes.length}:${lastModified}:${fnv.toString(16)}:${adler.toString(16)}`;
    }
    async function fileSnapshot(file) {
      // Blob.text() silently replaces malformed UTF-8, which would corrupt
      // files on save. Decode strictly and preserve the BOM explicitly.
      const bytes = new Uint8Array(await file.arrayBuffer());
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch (_) { throw new Error('Soubor není platný UTF-8. Nebude otevřen k úpravám, aby nedošlo k poškození dat.'); }
      const hasBOM = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      return { text, hasBOM, fingerprint: fingerprintBytes(bytes, file.lastModified), bytes };
    }
    async function readRaw(path) {
      const handle = fileHandles.get(path);
      if (!handle) throw new Error(`Soubor nebyl nalezen: ${path}`);
      const file = typeof handle.getFile === 'function' ? await handle.getFile() : handle;
      const { text, fingerprint } = await fileSnapshot(file);
      // Raw migration must retain U+FEFF, CRLF and all other source bytes.
      return { text, fingerprint };
    }
    async function read(path) {
      const handle = fileHandles.get(path);
      if (!handle) throw new Error(`Soubor nebyl nalezen: ${path}`);
      const file = typeof handle.getFile === 'function' ? await handle.getFile() : handle;
      const { text, hasBOM, fingerprint } = await fileSnapshot(file);
      // BOM is metadata rather than a visible character in the editor.
      return { text: hasBOM ? text.slice(1) : text, hasBOM, fingerprint };
    }
    async function readAsset(path) {
      const handle = assetHandles.get(path);
      if (!handle) throw new Error(`Obrázek nebyl nalezen: ${path}`);
      return typeof handle.getFile === 'function' ? handle.getFile() : handle;
    }
    async function write(path, text, expectedFingerprint) {
      if (mode !== 'readwrite') throw new Error('Složka je otevřená pouze pro čtení.');
      const handle = fileHandles.get(path);
      if (!handle || typeof handle.createWritable !== 'function') throw new Error('Chybí právo zápisu.');
      const current = await handle.getFile();
      if (expectedFingerprint !== (await fileSnapshot(current)).fingerprint) {
        const err = new Error('Soubor byl mezitím upraven mimo aplikaci. Zápis je zablokován.');
        err.code = 'EXTERNAL_CHANGE'; throw err;
      }
      const writable = await handle.createWritable();
      try { await writable.write(text); await writable.close(); }
      catch (error) { try { await writable.abort(); } catch (_) {} throw error; }
      const saved = await handle.getFile();
      return { fingerprint: (await fileSnapshot(saved)).fingerprint };
    }
    // Create operations never infer a path outside the authorized root. Existing
    // files are never overwritten, and intermediate directories must already exist.
    function creationSegments(raw, kind) {
      if (typeof raw !== 'string') throw new Error('Cesta musí být text.');
      let value = raw.trim();
      // A single leading slash denotes a path relative to the wiki root.
      if (value.startsWith('/') && !value.startsWith('//')) value = value.slice(1);
      if (!value || /^[/\\]/.test(value) || /[\u0000-\u001f]/.test(value)) {
        throw new Error('Zadej platnou relativní cestu uvnitř wiki.');
      }
      value = value.replace(/\\/g, '/');
      if (value.endsWith('/')) throw new Error('Cesta nesmí končit lomítkem.');
      const parts = value.split('/');
      if (parts.some(x => !x || x === '.' || x === '..' || /[<>:"|?*]/.test(x) || /[. ]$/.test(x) || SKIP_DIRS.has(x.toLocaleLowerCase('cs')) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))) {
        throw new Error('Cesta obsahuje nepovolený nebo rezervovaný název.');
      }
      if (kind === 'file') {
        let name = parts[parts.length - 1];
        if (!/\.(?:md|markdown)$/i.test(name)) {
          if (name.includes('.')) throw new Error('Nový dokument musí být .md nebo .markdown.');
          name += '.md';
          parts[parts.length - 1] = name;
        }
      }
      return parts;
    }
    // All path segments are validated before any filesystem writes.
    async function parentFor(parts, options = {}) {
      let dir = rootHandle;
      const parents = parts.slice(0, -1);
      for (let i = 0; i < parents.length; i++) {
        const segment = parents[i];
        let existing = null;
        for await (const item of dir.values()) {
          if (item.name.toLocaleLowerCase('cs') === segment.toLocaleLowerCase('cs')) {
            existing = item; break;
          }
        }
        if (existing) {
          if (existing.kind !== 'directory' || existing.name !== segment) {
            throw new Error(`Kolize názvu nadřazené složky: ${segment}`);
          }
          dir = await dir.getDirectoryHandle(segment, { create: false });
        } else if (options.createParents) {
          dir = await dir.getDirectoryHandle(segment, { create: true });
        } else {
          const error = new Error(`Nadřazená složka neexistuje: ${parents.slice(0, i + 1).join('/')}`);
          error.code = 'MISSING_PARENT';
          error.missingPath = parents.slice(0, i + 1).join('/');
          throw error;
        }
      }
      return dir;
    }
    async function missingParents(raw, kind = 'file') {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Vytváření vyžaduje oprávnění k zápisu.');
      const parts = creationSegments(raw, kind);
      let dir = rootHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        let found = null;
        for await (const item of dir.values()) {
          if (item.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs')) { found = item; break; }
        }
        if (!found) return parts.slice(0, i + 1).join('/');
        if (found.kind !== 'directory' || found.name !== name) throw new Error(`Kolize názvu nadřazené složky: ${name}`);
        dir = await dir.getDirectoryHandle(name, { create: false });
      }
      return null;
    }
    async function assertNotExists(parent, name) {
      for await (const item of parent.values()) {
        if (item.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs')) {
          throw new Error(`Soubor nebo složka již existuje: ${name}`);
        }
      }
    }
    async function createFile(raw, options = {}) {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Vytváření vyžaduje oprávnění k zápisu.');
      const parts = creationSegments(raw, 'file');
      const parent = await parentFor(parts, options);
      const name = parts[parts.length - 1];
      await assertNotExists(parent, name);
      // FileSystemDirectoryHandle currently has no exclusive-create operation;
      // this existence check guards ordinary mistakes, not concurrent OS races.
      await parent.getFileHandle(name, { create: true });
      applyScanned(await scan(rootHandle));
      return parts.join('/');
    }
    async function createDirectory(raw, options = {}) {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Vytváření vyžaduje oprávnění k zápisu.');
      const parts = creationSegments(raw, 'directory');
      const parent = await parentFor(parts, options);
      const name = parts[parts.length - 1];
      await assertNotExists(parent, name);
      await parent.getDirectoryHandle(name, { create: true });
      applyScanned(await scan(rootHandle));
      return parts.join('/');
    }
    // Chrome/Edge do not provide a portable, atomic rename between folders.
    // Copy the *original bytes* to the target, verify them, then remove the source.
    // A failed copy never deletes the original. If deletion fails, retain both.
    async function renameFile(oldPath, rawDestination, expectedFingerprint) {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Přejmenování vyžaduje oprávnění k zápisu.');
      if (!fileHandles.has(oldPath)) throw new Error('Původní soubor již není v otevřené wiki.');
      const parts = creationSegments(rawDestination, 'file');
      const newPath = parts.join('/');
      if (newPath === oldPath) return newPath;
      const sourceHandle = fileHandles.get(oldPath);
      const sourceFile = await sourceHandle.getFile();
      const currentFingerprint = (await fileSnapshot(sourceFile)).fingerprint;
      if (expectedFingerprint !== currentFingerprint) {
        const err = new Error('Původní poznámka se mezitím změnila na disku. Přejmenování je zastaveno.');
        err.code = 'EXTERNAL_CHANGE'; throw err;
      }
      const parent = await parentFor(parts);
      const name = parts[parts.length - 1];
      await assertNotExists(parent, name);
      // Keep the copy in memory to avoid re-reading a changed source in mid-copy.
      const originalBytes = new Uint8Array(await sourceFile.arrayBuffer());
      const targetHandle = await parent.getFileHandle(name, { create: true });
      try {
        const output = await targetHandle.createWritable();
        try { await output.write(originalBytes); await output.close(); }
        catch (err) { try { await output.abort(); } catch (_) {} throw err; }
        // Verify every byte before touching the original. Preserve BOM, CRLF and UTF-8.
        const targetFile = await targetHandle.getFile();
        const copied = new Uint8Array(await targetFile.arrayBuffer());
        if (copied.length !== originalBytes.length || copied.some((b, i) => b !== originalBytes[i])) {
          throw new Error('Kontrola kopie neprošla; původní soubor zůstal zachován.');
        }
      } catch (err) {
        try { await parent.removeEntry(name); } catch (_) { /* A partial copy may remain for manual recovery. */ }
        throw err;
      }
      // Never remove the source if it changed while we were copying.
      const latest = await sourceHandle.getFile();
      if ((await fileSnapshot(latest)).fingerprint !== currentFingerprint) {
        applyScanned(await scan(rootHandle));
        throw new Error('Původní soubor se během kopírování změnil. Obě kopie zůstaly na disku; zkontroluj je ručně.');
      }
      try {
        const sourceParts = oldPath.split('/');
        const sourceParent = await parentFor(sourceParts);
        await sourceParent.removeEntry(sourceParts[sourceParts.length - 1]);
      } catch (err) {
        applyScanned(await scan(rootHandle));
        throw new Error(`Kopie vznikla, ale původní soubor nelze odstranit: ${err.message}. Obě kopie zůstaly na disku.`);
      }
      applyScanned(await scan(rootHandle));
      return newPath;
    }
    async function refresh(onProgress) {
      if (!rootHandle || mode !== 'readwrite') throw new Error('Obnovení vyžaduje oprávnění ke složce.');
      return applyScanned(await scan(rootHandle, onProgress));
    }
    return {
      openWritable, openExisting, openReadOnly, read, readRaw, write, readAsset, refresh, createFile, createDirectory, missingParents, renameFile,
      normalizeDestination: raw => creationSegments(raw, 'file').join('/'),
      getTree: () => tree, getMode: () => mode, getRootHandle: () => rootHandle,
      hasFile: path => fileHandles.has(path), hasAsset: path => assetHandles.has(path),
      getFilePaths: () => Array.from(fileHandles.keys()), getAssetPaths: () => Array.from(assetHandles.keys())
    };
  }
  global.LocalWikiFS = { createBridge, normalizePath, relativePath };
})(typeof window !== 'undefined' ? window : globalThis);
