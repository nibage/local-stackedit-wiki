/* Offline fulltext + backlinks index. Reads only the already authorized wiki folder.
 * Classic script for direct file:// usage. No network, no storage. */
(function (global) {
  'use strict';
  const norm = text => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs');
  const mdExt = /\.(?:md|markdown)$/i;
  function withoutCode(source) {
    return String(source).replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*(?:`{3,}|~{3,})\s*$/gm, '')
      .replace(/`[^`\n]*`/g, '');
  }
  function targetFor(href, fromPath, allPaths) {
    if (!href) return null;
    const pathList = allPaths instanceof Set ? allPaths : new Set(allPaths);
    let target = String(href).trim();
    let isWiki = false;
    if (target.startsWith('wiki:')) { target = target.slice(5); isWiki = true; }
    try { target = decodeURIComponent(target); } catch (_) { /* preserve literal */ }
    target = target.split('#')[0].split('?')[0].replace(/\\/g, '/');
    if (!target || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target)) return null;
    if (target.startsWith('/')) return null;
    const all = Array.from(pathList);
    const base = fromPath.split('/').slice(0, -1);
    const candidate = global.LocalWikiFS.normalizePath([...base, target].join('/'));
    const variants = candidate ? [candidate, ...(mdExt.test(candidate) ? [] : [`${candidate}.md`, `${candidate}.markdown`])] : [];
    for (const v of variants) if (pathList.has(v)) return v;
    // Obsidian wiki links allow a basename. Use only an unambiguous match.
    if (isWiki) {
      const stem = norm(target).replace(mdExt, '');
      const matches = all.filter(path => norm(path).replace(mdExt, '') === stem ||
        norm(path.split('/').pop()).replace(mdExt, '') === stem);
      return matches.length === 1 ? matches[0] : null;
    }
    return null;
  }
  function links(source) {
    const codeFree = withoutCode(source);
    const found = [];
    for (const m of codeFree.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      found.push(`wiki:${m[1].split('|')[0].trim()}`);
    }
    // Markdown links and image links; ignore URLs when resolving.
    for (const m of codeFree.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)/g)) {
      const raw = m[1].replace(/^<|>$/g, '').split(/\s+"/)[0];
      found.push(raw);
    }
    return found;
  }
  function createIndex(bridge) {
    const texts = new Map();
    let completed = false, epoch = 0;
    async function rebuild(onProgress) {
      const myEpoch = ++epoch;
      const paths = bridge.getFilePaths().slice().sort((a,b) => a.localeCompare(b, 'cs'));
      const fresh = new Map();
      let cursor = 0, done = 0;
      async function worker() {
        while (cursor < paths.length) {
          const path = paths[cursor++];
          try { fresh.set(path, (await bridge.read(path)).text); }
          catch (_) { /* An unreadable file doesn't invalidate other results. */ }
          done++;
          if (onProgress && epoch === myEpoch) onProgress(done, paths.length);
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, paths.length) }, worker));
      if (epoch !== myEpoch) return { indexed: 0, total: paths.length, stale: true };
      texts.clear(); fresh.forEach((v,k) => texts.set(k,v));
      completed = true;
      return { indexed: texts.size, total: paths.length };
    }
    function invalidate() { epoch++; completed = false; texts.clear(); }
    function update(path, content) { if (completed) texts.set(path, content); }
    function search(query, maxResults = 100) {
      const words = norm(query).split(/\s+/).filter(Boolean);
      if (!words.length) return [];
      const found = [];
      for (const [path, text] of texts) {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        for (let i = 0, matches = 0; i < lines.length; i++) {
          if (words.every(word => norm(lines[i]).includes(word))) {
            found.push({ path, line: i + 1, snippet: lines[i].trim().slice(0, 180) || '(empty line)' });
            matches++;
            if (matches >= 3 || found.length >= maxResults) break;
          }
        }
        if (found.length >= maxResults) break;
      }
      return found;
    }
    function backlinks(path) {
      const paths = new Set(texts.keys());
      const found = [];
      for (const [from, content] of texts) {
        if (from === path) continue;
        if (links(content).some(href => targetFor(href, from, paths) === path)) found.push(from);
      }
      return found;
    }
    return { rebuild, invalidate, update, search, backlinks, isReady: () => completed, indexedCount: () => texts.size };
  }
  global.LocalWikiIndex = { createIndex, norm, links, targetFor };
})(typeof window !== 'undefined' ? window : globalThis);
