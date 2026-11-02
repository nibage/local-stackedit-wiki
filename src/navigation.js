/* Local Wiki – heading/link navigation without changing Markdown source. */
(function (global) {
  'use strict';
  function decode(value) {
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }
  function splitTarget(href) {
    const source = String(href || '');
    const isWiki = /^wiki:/i.test(source);
    // The Obsidian converter encodes the complete [[Page#Heading]] target,
    // including its '#'. In normal Markdown, %23 is a filename character.
    const raw = isWiki ? decode(source.slice(5)) : source;
    const idx = raw.indexOf('#');
    return {
      isWiki,
      path: isWiki ? raw.slice(0, idx < 0 ? undefined : idx) : raw.slice(0, idx < 0 ? undefined : idx),
      anchor: idx < 0 ? null : decode(raw.slice(idx + 1))
    };
  }
  function fold(input) {
    return String(input || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs').trim();
  }
  function headingSlug(input) {
    return fold(input).replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
  }
  function findHeading(container, anchor) {
    if (!container || anchor == null || !String(anchor).trim()) return null;
    const wanted = fold(anchor);
    const slug = headingSlug(anchor);
    const headings = Array.from(container.querySelectorAll('h1,h2,h3,h4,h5,h6'));
    // Obsidian's [[Note#Displayed title]] uses the visible title; GitHub/Markdown
    // often use a lower-case, hyphenated fragment. Support both forms.
    const byText = headings.find(h => fold(h.textContent) === wanted);
    if (byText) return byText;
    const counts = new Map();
    for (const h of headings) {
      const heading = headingSlug(h.textContent);
      const index = counts.get(heading) || 0;
      counts.set(heading, index + 1);
      if (slug === (index ? `${heading}-${index}` : heading) || wanted === h.id.toLowerCase()) return h;
    }
    return null;
  }
  global.LocalWikiNavigation = { splitTarget, findHeading, headingSlug };
})(typeof window !== 'undefined' ? window : globalThis);
