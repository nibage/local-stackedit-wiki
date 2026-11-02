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
    if (!snapshots.has(oldPath)) throw new Error('Původní dokument chybí v načtené wiki.');
    if (newPath !== oldPath && snapshots.has(newPath)) throw new Error('Cílový dokument již existuje.');
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
        throw new Error(`Soubor ${path} se během přípravy změnil; nic nebylo přesunuto.`);
      }
    }
    const original = snapshots.get(migration.oldPath);
    await bridge.renameFile(migration.oldPath, migration.newPath, original.fingerprint);
    const committed = [];
    try {
      for (const change of migration.changes) {
        const fresh = await bridge.readRaw(change.path);
        const expected = change.oldPath === migration.oldPath ? original.text : change.before;
        if (fresh.text !== expected) throw new Error(`Soubor ${change.path} se mezitím změnil.`);
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
          if (fresh.text !== change.after) throw new Error('obsah se mezitím změnil');
          await bridge.write(change.path, change.before, fresh.fingerprint);
        } catch (err) { problems.push(`${change.path}: ${err.message}`); }
      }
      try {
        const moved = await bridge.readRaw(migration.newPath);
        if (moved.text !== original.text) throw new Error('obsah nelze bezpečně vrátit');
        await bridge.renameFile(migration.newPath, migration.oldPath, moved.fingerprint);
      } catch (err) { problems.push(`přesun: ${err.message}`); }
      const message = problems.length
        ? `Aktualizace selhala: ${error.message}. Automatické vrácení není úplné (${problems.join('; ')}). Zkontroluj soubory a zálohu.`
        : `Aktualizace selhala: ${error.message}. Změny byly vráceny; stav wiki pro jistotu zkontroluj.`;
      const failure = new Error(message); failure.code = 'MIGRATION_FAILED'; throw failure;
    }
  }
  global.LocalWikiMigration = { plan, snapshotAll, execute, rewriteText, relative };
})(typeof window !== 'undefined' ? window : globalThis);
