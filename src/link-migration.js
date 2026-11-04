/* Local Wiki Link Migration — conservative offline planner + recoverable apply.
 * Edits only resolvable .md links and Obsidian wikilinks. No network access.
 * All operations are made against snapshots, then validated again before writing.
 */
(function (global) {
  'use strict';
  const mdExt = /\.(?:md|markdown)$/i;
  const wikiLink = /!?\[\[([^\]\r\n]+)\]\]/g;
  const inlineLink = /(?<!!)\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'))?\s*\)/g;
  const definition = /^[ \t]{0,3}\[[^\]\r\n]+\]:[ \t]*(<[^>\r\n]+>|[^\s\r\n]+)/gm;
  function relative(from, to) {
    const fromDir = from.split('/').slice(0, -1), dest = to.split('/');
    while (fromDir.length && dest.length && fromDir[0] === dest[0]) { fromDir.shift(); dest.shift(); }
    return [...fromDir.map(() => '..'), ...dest].join('/');
  }
  function splitSuffix(target) {
    const idx = target.search(/[?#]/);
    return idx === -1 ? [target, ''] : [target.slice(0, idx), target.slice(idx)];
  }
  function encodePath(path) {
    return path.split('/').map(part => part === '..' ? '..' : encodeURIComponent(part)).join('/');
  }
  function buildProtectedMask(text) {
    const mask = new Uint8Array(text.length);
    function protect(start, end) { mask.fill(1, start, end); }
    const lines = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
    let fence = null;
    for (const m of text.matchAll(lines)) {
      if (!m[0]) continue;
      const row = m[0].replace(/[\r\n]+$/, '');
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(row);
      if (fence) {
        protect(m.index, m.index + m[0].length);
        if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length &&
          new RegExp('^ {0,3}' + (fence[0] === '`' ? '`' : '~') + '{' + fence.length + ',}\\s*$').test(row)) fence = null;
      } else if (marker) {
        fence = marker[1];
        protect(m.index, m.index + m[0].length);
      }
    }
    // Inline backtick spans, including doubled backticks. No edits in code spans.
    for (let i = 0; i < text.length;) {
      if (mask[i] || text[i] !== '`') { i++; continue; }
      let len = 1; while (text[i + len] === '`') len++;
      let end = -1;
      for (let j = i + len; j < text.length; j++) {
        if (mask[j] || text[j] !== '`') continue;
        let n = 1; while (text[j + n] === '`') n++;
        if (n === len) { end = j + n; break; }
        j += n - 1;
      }
      if (end !== -1) { protect(i, end); i = end; } else i += len;
    }
    return mask;
  }
  function rewriteText(text, from, effectiveFrom, oldPath, newPath, beforePaths, afterPaths) {
    const protectedMask = buildProtectedMask(text);
    const patches = [];
    let count = 0;
    function safePatch(offset, original, replacement) {
      if (original === replacement || !original) return;
      if (protectedMask.subarray(offset, offset + original.length).some(Boolean)) return;
      if (patches.some(p => offset < p.end && offset + original.length > p.start)) return;
      patches.push({ start: offset, end: offset + original.length, value: replacement });
      count++;
    }
    const lookup = href => global.LocalWikiIndex.targetFor(href, from, beforePaths);
    const lookupAfter = href => global.LocalWikiIndex.targetFor(href, effectiveFrom, afterPaths);
    for (const m of text.matchAll(wikiLink)) {
      if (protectedMask[m.index]) continue;
      const content = m[1];
      const pipe = content.indexOf('|');
      const left = pipe < 0 ? content : content.slice(0, pipe);
      const match = /^([^#^]*)(.*)$/.exec(left);
      if (!match) continue;
      const target = match[1].trim(), suffix = match[2];
      if (!target) continue;
      const intended = lookup(`wiki:${target}`);
      if (!intended) continue;
      const finalTarget = intended === oldPath ? newPath : intended;
      if (lookupAfter(`wiki:${target}`) === finalTarget) continue;
      let newRef = relative(effectiveFrom, finalTarget).replace(mdExt, '');
      // Use a full path with extension if dropping it would introduce ambiguity.
      if (lookupAfter(`wiki:${newRef}`) !== finalTarget) newRef = relative(effectiveFrom, finalTarget);
      if (lookupAfter(`wiki:${newRef}`) !== finalTarget) continue;
      safePatch(m.index + m[0].indexOf(content), left, newRef + suffix);
    }
    function rewriteMarkdownTarget(m) {
      if (protectedMask[m.index]) return;
      const raw = m[1], angled = raw.startsWith('<') && raw.endsWith('>');
      const target = angled ? raw.slice(1, -1) : raw;
      const [pathname, suffix] = splitSuffix(target);
      if (!pathname || !mdExt.test(pathname)) return;
      const intended = lookup(target);
      if (!intended) return;
      const finalTarget = intended === oldPath ? newPath : intended;
      if (lookupAfter(target) === finalTarget) return;
      const newHref = encodePath(relative(effectiveFrom, finalTarget)) + suffix;
      const newRaw = angled ? `<${newHref}>` : newHref;
      safePatch(m.index + m[0].indexOf(raw), raw, newRaw);
    }
    for (const m of text.matchAll(inlineLink)) rewriteMarkdownTarget(m);
    for (const m of text.matchAll(definition)) rewriteMarkdownTarget(m);
    patches.sort((a, b) => b.start - a.start);
    let output = text;
    for (const p of patches) output = output.slice(0, p.start) + p.value + output.slice(p.end);
    return { text: output, count };
  }
  function plan(snapshots, oldPath, newPath) {
    if (!snapshots.has(oldPath)) throw new Error('Original document is missing from the loaded wiki.');
    if (newPath !== oldPath && snapshots.has(newPath)) throw new Error('Destination document already exists.');
    const beforePaths = new Set(snapshots.keys());
    const afterPaths = new Set(beforePaths); afterPaths.delete(oldPath); afterPaths.add(newPath);
    const changes = [];
    let totalLinks = 0;
    for (const [path, snapshot] of snapshots) {
      const newSource = path === oldPath ? newPath : path;
      const result = rewriteText(snapshot.text, path, newSource, oldPath, newPath, beforePaths, afterPaths);
      if (result.count) {
        changes.push({ oldPath: path, path: newSource, before: snapshot.text, after: result.text,
          fingerprint: snapshot.fingerprint, links: result.count });
        totalLinks += result.count;
      }
    }
    return { oldPath, newPath, changes, totalLinks, affectedFiles: changes.length };
  }
  async function snapshotAll(bridge) {
    const snapshots = new Map();
    for (const path of bridge.getFilePaths()) snapshots.set(path, await bridge.readRaw(path));
    return snapshots;
  }
  async function execute(bridge, migration, snapshots) {
    // Preflight protects against edits after the review dialog; fingerprint checks
    // are repeated by every write and by renameFile itself.
    for (const [path, old] of snapshots) {
      const fresh = await bridge.readRaw(path);
      if (fresh.fingerprint !== old.fingerprint || fresh.text !== old.text) {
        throw new Error(`Soubor ${path} changed during preparation; nothing was moved.`);
      }
    }
    const original = snapshots.get(migration.oldPath);
    await bridge.renameFile(migration.oldPath, migration.newPath, original.fingerprint);
    const committed = [];
    try {
      for (const change of migration.changes) {
        const fresh = await bridge.readRaw(change.path);
        const expected = change.oldPath === migration.oldPath ? original.text : change.before;
        if (fresh.text !== expected) throw new Error(`Soubor ${change.path} changed in the meantime.`);
        const saved = await bridge.write(change.path, change.after, fresh.fingerprint);
        committed.push({ path: change.path, before: change.before, after: change.after, fingerprint: saved.fingerprint });
      }
      return { moved: migration.newPath, updated: committed.length, links: migration.totalLinks };
    } catch (error) {
      const problems = [];
      // Best effort rollback: never overwrite edits that changed again externally.
      for (const change of committed.reverse()) {
        try {
          const fresh = await bridge.readRaw(change.path);
          if (fresh.text !== change.after) throw new Error('content changed in the meantime');
          await bridge.write(change.path, change.before, fresh.fingerprint);
        } catch (err) { problems.push(`${change.path}: ${err.message}`); }
      }
      try {
        const moved = await bridge.readRaw(migration.newPath);
        if (moved.text !== original.text) throw new Error('content cannot be safely restored');
        await bridge.renameFile(migration.newPath, migration.oldPath, moved.fingerprint);
      } catch (err) { problems.push(`move: ${err.message}`); }
      const message = problems.length
        ? `Update failed: ${error.message}. Automatic rollback was incomplete (${problems.join('; ')}). Check files and your backup.`
        : `Update failed: ${error.message}. Changes were rolled back; verify your wiki to be safe.`;
      const failure = new Error(message); failure.code = 'MIGRATION_FAILED'; throw failure;
    }
  }
  // Asset relocation has different semantics from note renames: the moved
  // resource is binary; only Markdown documents that reference it are edited.
  // Keep scope conservative: image wikilinks and Markdown link/image targets.
  function planAsset(snapshots, oldPath, newPath, assetPaths) {
    const assets = new Set(assetPaths);
    if (!assets.has(oldPath)) throw new Error('Original image is not in the wiki.');
    if (oldPath !== newPath && assets.has(newPath)) throw new Error('Destination image exists.');
    const changes = [];
    let totalLinks = 0;
    const decoder = s => { try { return decodeURIComponent(s); } catch (_) { return s; } };
    function resolves(raw, from, isWiki) {
      const target = decoder(raw).replace(/\\/g, '/');
      if (!target || target.startsWith('/') || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
      const fromDir = from.split('/').slice(0, -1).join('/');
      const rel = global.LocalWikiFS.normalizePath([fromDir, target].filter(Boolean).join('/'));
      if (rel && assets.has(rel)) return rel;
      if (assets.has(target)) return target;
      if (!isWiki) return null;
      const lower = target.toLocaleLowerCase();
      const matches = Array.from(assets).filter(p => p.toLocaleLowerCase() === lower ||
        (!target.includes('/') && p.split('/').pop().toLocaleLowerCase() === lower));
      return matches.length === 1 ? matches[0] : null;
    }
    for (const [path, snapshot] of snapshots) {
      const text = snapshot.text;
      const mask = buildProtectedMask(text);
      const patches = [];
      function add(start, value, replacement) {
        if (!value || value === replacement || mask.subarray(start, start + value.length).some(Boolean)) return;
        if (patches.some(p => start < p.end && start + value.length > p.start)) return;
        patches.push({ start, end: start + value.length, value: replacement });
      }
      for (const match of text.matchAll(wikiLink)) {
        if (mask[match.index]) continue;
        const content = match[1], separator = content.indexOf('|');
        const body = separator < 0 ? content : content.slice(0, separator);
        const suffixIdx = body.search(/[?#]/);
        const target = suffixIdx < 0 ? body : body.slice(0, suffixIdx);
        if (resolves(target, path, true) !== oldPath) continue;
        const suffix = suffixIdx < 0 ? '' : body.slice(suffixIdx);
        add(match.index + match[0].indexOf(content), body, relative(path, newPath) + suffix);
      }
      // Standard Markdown image embeds and hyperlinks to image files.
      const inlineAsset = /!?\[[^\]\r\n]*\]\(\s*(<[^>\r\n]+>|[^\s)\r\n]+)(?:\s+(?:"[^"\r\n]*"|'[^'\r\n]*'))?\s*\)/g;
      for (const match of text.matchAll(inlineAsset)) {
        if (mask[match.index]) continue;
        const raw = match[1], angled = raw.startsWith('<') && raw.endsWith('>');
        const target = angled ? raw.slice(1, -1) : raw;
        const suffixIdx = target.search(/[?#]/);
        const pathname = suffixIdx < 0 ? target : target.slice(0, suffixIdx);
        if (resolves(pathname, path, false) !== oldPath) continue;
        const suffix = suffixIdx < 0 ? '' : target.slice(suffixIdx);
        const replacement = encodePath(relative(path, newPath)) + suffix;
        add(match.index + match[0].indexOf(raw), raw, angled ? `<${replacement}>` : replacement);
      }
      if (!patches.length) continue;
      patches.sort((a, b) => b.start - a.start);
      let rewritten = text;
      for (const patch of patches) rewritten = rewritten.slice(0, patch.start) + patch.value + rewritten.slice(patch.end);
      changes.push({ path, before: text, after: rewritten, fingerprint: snapshot.fingerprint, links: patches.length });
      totalLinks += patches.length;
    }
    return { oldPath, newPath, changes, totalLinks, affectedFiles: changes.length };
  }
  async function executeAsset(bridge, migration, snapshots, expectedAssetFingerprint) {
    // Check all note snapshots *before* moving the image. Unlike notes, the
    // original binary bytes cannot be recovered by decoding text.
    for (const [path, old] of snapshots) {
      const fresh = await bridge.readRaw(path);
      if (fresh.fingerprint !== old.fingerprint || fresh.text !== old.text) {
        throw new Error('Notes changed during image move preparation; nothing was moved.');
      }
    }
    await bridge.moveAsset(migration.oldPath, migration.newPath, expectedAssetFingerprint);
    const committed = [];
    try {
      for (const change of migration.changes) {
        const fresh = await bridge.readRaw(change.path);
        if (fresh.text !== change.before) throw new Error('A note changed while moving the image.');
        await bridge.write(change.path, change.after, fresh.fingerprint);
        committed.push(change);
      }
      return { moved: migration.newPath, links: migration.totalLinks, updated: committed.length };
    } catch (err) {
      const problems = [];
      for (const change of committed.reverse()) {
        try {
          const fresh = await bridge.readRaw(change.path);
          if (fresh.text !== change.after) throw new Error('Note changed again');
          await bridge.write(change.path, change.before, fresh.fingerprint);
        } catch (error) { problems.push(change.path + ': ' + error.message); }
      }
      try {
        const fp = await bridge.assetFingerprint(migration.newPath);
        await bridge.moveAsset(migration.newPath, migration.oldPath, fp);
      } catch (error) { problems.push('image: ' + error.message); }
      throw new Error('Image move failed: ' + err.message +
        (problems.length ? '; automatic recovery incomplete: ' + problems.join('; ') : '; changes rolled back.'));
    }
  }

  global.LocalWikiMigration = { plan, snapshotAll, execute, rewriteText, relative, planAsset, executeAsset };
})(typeof window !== 'undefined' ? window : globalThis);
