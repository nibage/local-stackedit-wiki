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
  function insertNode(root, path, leafKind = 'file') {
    const parts = path.split('/');
    let node = root;
    parts.forEach((part, idx) => {
      const kind = idx === parts.length - 1 ? leafKind : 'directory';
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
    // Full recursive scans can take seconds on large wiki roots. Report progress
    // while walking and tolerate unreadable *child* directories; never pretend
    // an unreadable root has been opened successfully.
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
        // A real task (not another microtask) permits Chrome to paint progress.
        // The fallback keeps the bridge usable in non-browser unit test contexts.
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
            throw new Error(`Cannot read root folder: ${error.message || error}`);
          }
          stats.skipped++;
          if (skippedPaths.length < 3) skippedPaths.push(prefix);
          report(true);
          return false;
        }
        stats.directories++;
        entries.sort(sortEntries);
        for (const entry of entries) {
          const path = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.kind === 'directory') {
            if (SKIP_DIRS.has(entry.name.toLowerCase())) continue;
            const folder = { kind: 'directory', name: entry.name, path, children: [] };
            parent.children.push(folder);
            // If one child cannot be read, keep scanning its siblings.
            if (!await walkDirectory(entry, path, folder)) parent.children.pop();
          } else if (entry.kind === 'file' && MD_EXTENSION.test(entry.name)) {
            nextFiles.set(path, entry);
            parent.children.push({ kind: 'file', name: entry.name, path });
            stats.files++;
          } else if (entry.kind === 'file' && IMAGE_EXTENSION.test(entry.name)) {
            nextAssets.set(path, entry);
            parent.children.push({ kind: 'image', name: entry.name, path });
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
    async function openWritable(onProgress, readOnly = false) {
      if (typeof global.showDirectoryPicker !== 'function') throw new Error('showDirectoryPicker() is unavailable in this environment.');
      // Picker must remain directly inside user click's async chain.
      const handle = await global.showDirectoryPicker({ id: 'local-wiki-root', mode: readOnly ? 'read' : 'readwrite' });
      const found = await scan(handle, onProgress);
      rootHandle = handle; mode = readOnly ? 'readonly' : 'readwrite';
      return applyScanned(found);
    }
    async function openExisting(handle, onProgress, readOnly = false) {
      if (!handle || handle.kind !== 'directory') throw new Error('The saved folder is not a valid directory.');
      const found = await scan(handle, onProgress);
      rootHandle = handle; mode = readOnly ? 'readonly' : 'readwrite';
      return applyScanned(found);
    }
    function openReadOnly(files) {
      const list = Array.from(files || []);
      if (!list.length) throw new Error('The selected folder contains no files.');
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
        else if (IMAGE_EXTENSION.test(path)) { nextAssets.set(path, file); insertNode(nextTree, path, 'image'); }
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
      catch (_) { throw new Error('The file is not valid UTF-8. Editing is blocked to prevent data loss.'); }
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
      if (!handle) throw new Error(`Image not found: ${path}`);
      return typeof handle.getFile === 'function' ? handle.getFile() : handle;
    }
    async function write(path, text, expectedFingerprint) {
      if (mode !== 'readwrite') throw new Error('The folder is open read-only.');
      const handle = fileHandles.get(path);
      if (!handle || typeof handle.createWritable !== 'function') throw new Error('Write permission is missing.');
      const current = await handle.getFile();
      if (expectedFingerprint !== (await fileSnapshot(current)).fingerprint) {
        const err = new Error('The file was modified outside this application. Saving is blocked.');
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
      if (typeof raw !== 'string') throw new Error('Path must be text.');
      let value = raw.trim();
      // A single leading slash means 'from the selected wiki root', not OS root.
      // Reject double slashes (UNC/network paths) and all other unsafe segments.
      if (value.startsWith('/') && !value.startsWith('//')) value = value.slice(1);
      if (!value || /^[/\\]/.test(value) || /[\u0000-\u001f]/.test(value)) {
        throw new Error('Enter a valid relative path inside the wiki.');
      }
      value = value.replace(/\\/g, '/');
      if (value.endsWith('/')) throw new Error('Path must not end with a slash.');
      const parts = value.split('/');
      if (parts.some(x => !x || x === '.' || x === '..' || /[<>:"|?*]/.test(x) || /[. ]$/.test(x) || SKIP_DIRS.has(x.toLocaleLowerCase('cs')) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))) {
        throw new Error('Path contains an invalid or reserved name.');
      }
      if (kind === 'file') {
        let name = parts[parts.length - 1];
        if (!/\.(?:md|markdown)$/i.test(name)) {
          if (name.includes('.')) throw new Error('A new note must use the .md or .markdown extension.');
          name += '.md';
          parts[parts.length - 1] = name;
        }
      }
      return parts;
    }
    // A preview is always read-only. Parent creation is opt-in, and all path
    // segments are validated *before* attempting any filesystem writes.
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
            throw new Error(`Parent folder name collision: ${segment}`);
          }
          dir = await dir.getDirectoryHandle(segment, { create: false });
        } else if (options.createParents) {
          dir = await dir.getDirectoryHandle(segment, { create: true });
        } else {
          const error = new Error(`Parent folder does not exist: ${parents.slice(0, i + 1).join('/')}`);
          error.code = 'MISSING_PARENT';
          error.missingPath = parents.slice(0, i + 1).join('/');
          throw error;
        }
      }
      return dir;
    }
    async function missingParents(raw, kind = 'file') {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Creation requires write permission.');
      const parts = creationSegments(raw, kind);
      let dir = rootHandle;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        let found = null;
        for await (const item of dir.values()) {
          if (item.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs')) { found = item; break; }
        }
        if (!found) return parts.slice(0, i + 1).join('/');
        if (found.kind !== 'directory' || found.name !== name) throw new Error(`Parent folder name collision: ${name}`);
        dir = await dir.getDirectoryHandle(name, { create: false });
      }
      return null;
    }
    async function assertNotExists(parent, name) {
      for await (const item of parent.values()) {
        if (item.name.toLocaleLowerCase('cs') === name.toLocaleLowerCase('cs')) {
          throw new Error(`File or folder already exists: ${name}`);
        }
      }
    }
    async function createFile(raw, options = {}) {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Creation requires write permission.');
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
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Creation requires write permission.');
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
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Renaming requires write permission.');
      if (!fileHandles.has(oldPath)) throw new Error('The original note is no longer in the open wiki.');
      const parts = creationSegments(rawDestination, 'file');
      const newPath = parts.join('/');
      if (newPath === oldPath) return newPath;
      const sourceHandle = fileHandles.get(oldPath);
      const sourceFile = await sourceHandle.getFile();
      const currentFingerprint = (await fileSnapshot(sourceFile)).fingerprint;
      if (expectedFingerprint !== currentFingerprint) {
        const err = new Error('The original note changed on disk. Renaming was blocked.');
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
          throw new Error('Copy verification failed; the original file was preserved.');
        }
      } catch (err) {
        try { await parent.removeEntry(name); } catch (_) { /* A partial copy may remain for manual recovery. */ }
        throw err;
      }
      // Never remove the source if it changed while we were copying.
      const latest = await sourceHandle.getFile();
      if ((await fileSnapshot(latest)).fingerprint !== currentFingerprint) {
        applyScanned(await scan(rootHandle));
        throw new Error('The source changed while copying. Both copies remain on disk; inspect them manually.');
      }
      try {
        const sourceParts = oldPath.split('/');
        const sourceParent = await parentFor(sourceParts);
        await sourceParent.removeEntry(sourceParts[sourceParts.length - 1]);
      } catch (err) {
        applyScanned(await scan(rootHandle));
        throw new Error(`The copy was created, but the source could not be removed: ${err.message}. Both copies remain on disk.`);
      }
      applyScanned(await scan(rootHandle));
      return newPath;
    }

    // Images are binary data: never pass them through the UTF-8 note decoder.
    // Moving is byte-for-byte copy, verification, then deletion of the source.
    async function assetFingerprint(path) {
      const file = await readAsset(path);
      const bytes = new Uint8Array(await file.arrayBuffer());
      return fingerprintBytes(bytes, file.lastModified);
    }
    async function moveAsset(oldPath, rawDestination, expectedFingerprint) {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Moving an image requires write permission.');
      if (!assetHandles.has(oldPath)) throw new Error('The original image is no longer in the open wiki.');
      const parts = creationSegments(rawDestination, 'asset');
      const newPath = parts.join('/');
      if (!IMAGE_EXTENSION.test(newPath)) throw new Error('Destination must have a supported image extension.');
      // Moving a file is not format conversion: prevent accidental extension changes.
      const oldExt = oldPath.split('.').pop().toLowerCase();
      const newExt = newPath.split('.').pop().toLowerCase();
      if (oldExt !== newExt) throw new Error('Moving an image cannot change its file format.');
      if (newPath === oldPath) return newPath;
      const sourceHandle = assetHandles.get(oldPath);
      if (typeof sourceHandle.getFile !== 'function') throw new Error('Image is not writable.');
      const sourceFile = await sourceHandle.getFile();
      const originalBytes = new Uint8Array(await sourceFile.arrayBuffer());
      const fingerprint = fingerprintBytes(originalBytes, sourceFile.lastModified);
      if (expectedFingerprint !== fingerprint) {
        const err = new Error('Image changed outside this application. Move blocked.');
        err.code = 'EXTERNAL_CHANGE'; throw err;
      }
      const parent = await parentFor(parts);
      const name = parts.at(-1);
      await assertNotExists(parent, name);
      const targetHandle = await parent.getFileHandle(name, { create: true });
      try {
        const writable = await targetHandle.createWritable();
        try { await writable.write(originalBytes); await writable.close(); }
        catch (err) { try { await writable.abort(); } catch (_) {} throw err; }
        const copy = new Uint8Array(await (await targetHandle.getFile()).arrayBuffer());
        if (copy.length !== originalBytes.length || copy.some((b, i) => b !== originalBytes[i])) {
          throw new Error('Image copy verification failed; original preserved.');
        }
      } catch (error) {
        try { await parent.removeEntry(name); } catch (_) { /* Partial copy might remain. */ }
        throw error;
      }
      // Verify the source bytes again; a concurrent modification must not be deleted.
      const latest = await sourceHandle.getFile();
      const latestBytes = new Uint8Array(await latest.arrayBuffer());
      if (fingerprintBytes(latestBytes, latest.lastModified) !== fingerprint) {
        applyScanned(await scan(rootHandle));
        throw new Error('Source image changed while copying; both copies were preserved.');
      }
      try {
        const fromParts = oldPath.split('/');
        const sourceParent = await parentFor(fromParts);
        await sourceParent.removeEntry(fromParts.at(-1));
      } catch (error) {
        applyScanned(await scan(rootHandle));
        throw new Error('Image copy succeeded, but source deletion failed: ' + error.message + '. Both copies remain.');
      }
      applyScanned(await scan(rootHandle));
      return newPath;
    }

    // Destructive operations are restricted to entries already exposed in the
    // scanned wiki tree. Hidden configuration directories are never deleted.
    function findNode(path, kind) {
      if (!path || typeof path !== 'string') throw new Error('The wiki root cannot be deleted.');
      let node = tree;
      for (const part of path.split('/')) {
        if (!part || part === '.' || part === '..' || !node.children) throw new Error('Invalid path.');
        node = node.children.find(child => child.name === part);
        if (!node) throw new Error('The item is not in the loaded wiki tree. Click Refresh first.');
      }
      if (node.kind !== kind) throw new Error('The item type does not match.');
      return node;
    }
    async function deleteLocation(path, kind) {
      const parts = path.split('/');
      let dir = rootHandle;
      for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: false });
      const name = parts[parts.length - 1];
      const handle = kind === 'directory' ? await dir.getDirectoryHandle(name, { create: false }) : await dir.getFileHandle(name, { create: false });
      return { dir, name, handle };
    }
    async function deletionSnapshot(path, kind) {
      if (mode !== 'readwrite' || !rootHandle) throw new Error('Deletion requires write permission.');
      findNode(path, kind);
      const { handle } = await deleteLocation(path, kind);
      const rows = [];
      async function walk(entry, prefix) {
        if (rows.length >= 2000) throw new Error('The folder is too large for safe deletion; use your file manager.');
        if (entry.kind === 'directory') {
          if (SKIP_DIRS.has(entry.name.toLowerCase())) throw new Error('The folder contains a protected directory: ' + prefix);
          rows.push('D:' + prefix);
          for await (const child of entry.values()) await walk(child, prefix + '/' + child.name);
        } else if (entry.kind === 'file') {
          const file = await entry.getFile();
          // Deletion must also handle binary assets (PNG, PDF, etc.).
          const bytes = new Uint8Array(await file.arrayBuffer());
          rows.push('F:' + prefix + ':' + fingerprintBytes(bytes, file.lastModified));
        }
      }
      await walk(handle, path);
      rows.sort();
      return { path, kind, signature: rows.join('\n'), entries: rows.length,
        files: rows.filter(line => line.startsWith('F:')).length,
        directories: rows.filter(line => line.startsWith('D:')).length };
    }
    async function deleteEntry(path, kind, expected) {
      if (!expected || expected.path !== path || expected.kind !== kind) throw new Error('A confirmed deletion plan is required.');
      const current = await deletionSnapshot(path, kind);
      if (current.signature !== expected.signature) throw new Error('The folder contents changed since confirmation. Refresh and retry.');
      const { dir, name } = await deleteLocation(path, kind);
      await dir.removeEntry(name, { recursive: kind === 'directory' });
      applyScanned(await scan(rootHandle));
      return current;
    }
    async function refresh(onProgress) {
      if (!rootHandle || (mode !== 'readwrite' && mode !== 'readonly')) throw new Error('Refresh requires folder access.');
      return applyScanned(await scan(rootHandle, onProgress));
    }
    return {
      openWritable, openExisting, openReadOnly, read, readRaw, write, readAsset, refresh, createFile, createDirectory, missingParents, renameFile, moveAsset, assetFingerprint, deletionSnapshot, deleteEntry,
      normalizeDestination: raw => creationSegments(raw, 'file').join('/'),
      normalizeAssetDestination: raw => creationSegments(raw, 'asset').join('/'),
      getTree: () => tree, getMode: () => mode, getRootHandle: () => rootHandle,
      hasFile: path => fileHandles.has(path), hasAsset: path => assetHandles.has(path),
      getFilePaths: () => Array.from(fileHandles.keys()), getAssetPaths: () => Array.from(assetHandles.keys())
    };
  }
  global.LocalWikiFS = { createBridge, normalizePath, relativePath };
})(typeof window !== 'undefined' ? window : globalThis);
