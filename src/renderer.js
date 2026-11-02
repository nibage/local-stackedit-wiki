/* Local Wiki Markdown renderer – offline, conservative HTML sanitation. */
(function (global) {
  'use strict';
  const ALLOWED = new Set('A BLOCKQUOTE BR CODE DEL DETAILS DIV EM H1 H2 H3 H4 H5 H6 HR I IMG KBD LI OL P PRE S SPAN STRONG SUB SUMMARY SUP TABLE TBODY TD TH THEAD TR U UL'.split(' '));
  const REMOVE = new Set('SCRIPT STYLE IFRAME OBJECT EMBED FORM BUTTON INPUT SELECT TEXTAREA META LINK BASE SVG MATH'.split(' '));
  const ALLOWED_CODE_CLASSES = /^language-[a-z\d_+.-]+$/i;
  const MATH_MARKER = 'LOCALWIKIMATHBLOCK';
  const OBSIDIAN_IMAGE = /\.(?:png|jpe?g|gif|webp|bmp|avif)$/i;
  const CALLOUT_LABELS = { note: 'Poznámka', abstract: 'Shrnutí', info: 'Informace', todo: 'Úkol', tip: 'Tip', success: 'Hotovo', question: 'Otázka', warning: 'Upozornění', failure: 'Neúspěch', danger: 'Nebezpečí', bug: 'Chyba', example: 'Příklad', quote: 'Citace' }; 
  const tokenCounter = () => Math.floor(Math.random() * 1000000000).toString(36);
  function convertWikiLinks(line) {
    return line.replace(/(?<!!)\[\[([^\]\n]+)\]\]/g, (all, inner) => {
      const pipe = inner.indexOf('|');
      const title = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim();
      const caption = (pipe >= 0 ? inner.slice(pipe + 1) : title).trim().replace(/[\[\]]/g, '');
      if (!title) return all;
      return `[${caption.replace(/[\\[\]()]/g, '\\$&')}](wiki:${encodeURIComponent(title)})`;
    });
  }
  function extractFrontmatter(source) {
    const normalized = String(source).replace(/\r\n?/g, '\n');
    if (!normalized.startsWith('---\n')) return { body: normalized, frontmatter: null };
    const lines = normalized.split('\n');
    // Only recognize a properly terminated YAML header at the very beginning.
    const closing = lines.findIndex((line, i) => i > 0 && i < 300 && /^(?:---|\.\.)\s*$/.test(line));
    if (closing < 1) return { body: normalized, frontmatter: null };
    return { body: lines.slice(closing + 1).join('\n'), frontmatter: lines.slice(1, closing).join('\n') };
  }
  function convertEmbeds(piece) {
    return piece.replace(/!\[\[([^\]\n]+)\]\]/g, (original, inner) => {
      const segments = inner.split('|');
      const target = segments.shift().trim();
      if (!OBSIDIAN_IMAGE.test(target)) return original; // Note transclusion is not implemented.
      const option = (segments[0] || '').trim();
      const widthMatch = /^(\d{2,4})(?:x\d{2,4})?$/.exec(option);
      const width = widthMatch && Number(widthMatch[1]) >= 32 && Number(widthMatch[1]) <= 1600 ? Number(widthMatch[1]) : null;
      const caption = (width ? segments.slice(1).join(' | ') : segments.join(' | ')).trim() || target.split('/').pop();
      const safeCaption = caption.replace(/[\\[\]()]/g, '\\$&');
      return `![${safeCaption}](<obsidian-asset:${encodeURIComponent(target)}${width ? `?width=${width}` : ''}>)`;
    });
  }
  function prepareSource(source) {
    const expressions = [];
    const nonce = tokenCounter();
    const remember = (formula) => { const name = `${MATH_MARKER}${nonce}X${expressions.length}END`; expressions.push({ name, formula }); return name; };
    const { body, frontmatter } = extractFrontmatter(source);
    const lines = body.split('\n');
    let fence = null, mathBlock = null;
    const out = [];
    for (const line of lines) {
      const fenceStart = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        out.push(line);
        if (fenceStart && fenceStart[1][0] === fence[0] && fenceStart[1].length >= fence.length) fence = null;
        continue;
      }
      if (fenceStart) { fence = fenceStart[1]; out.push(line); continue; }
      if (mathBlock !== null) {
        mathBlock.push(line);
        if (line.includes('$$')) {
          out.push('', remember(mathBlock.join('\n')), '');
          mathBlock = null;
        }
        continue;
      }
      if (/^\s*\$\$/.test(line) && (line.match(/\$\$/g) || []).length === 1) { mathBlock = [line]; continue; }
      if (/^\s*\$\$[\s\S]*\$\$\s*$/.test(line)) { out.push('', remember(line), ''); continue; }
      // Recognized Obsidian callout headers become separate blockquote paragraphs.
      const callout = /^ {0,3}>\s*\[!([a-z][a-z0-9_-]*)\]([+-])?(?:[ \t]+.*)?$/i.exec(line);
      if (callout && CALLOUT_LABELS[callout[1].toLowerCase()]) { out.push(line, '>'); continue; }
      // Inline code is deliberately excluded from wiki and math expansion.
      const spans = line.split(/(`+[^`]*`+)/g);
      const v = spans.map(span => {
        if (/^`/.test(span)) return span;
        let piece = span;
        piece = piece.replace(/\\\[[\s\S]*?\\\]/g, match => remember(match));
        piece = piece.replace(/\\\([\s\S]*?\\\)/g, match => remember(match));
        piece = piece.replace(/(?<![\\\w$])\$(?!\s)([^\n$]*?[^\s\\])\$(?!\d)/g, match => remember(match));
        return convertWikiLinks(convertEmbeds(piece));
      }).join('');
      out.push(v);
    }
    if (mathBlock) out.push(...mathBlock);
    return { prepared: out.join('\n'), expressions, frontmatter };
  }
  function sanitize(html) {
    const template = document.createElement('template');
    template.innerHTML = html;
    function clean(node) {
      if (node.nodeType === Node.COMMENT_NODE) { node.remove(); return; }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      const tag = node.tagName;
      if (REMOVE.has(tag)) { node.remove(); return; }
      if (!ALLOWED.has(tag)) {
        const fragment = document.createDocumentFragment();
        while (node.firstChild) fragment.appendChild(node.firstChild);
        Array.from(fragment.childNodes).forEach(clean);
        node.replaceWith(fragment);
        return;
      }
      for (const attr of Array.from(node.attributes)) {
        if (tag === 'A' && attr.name === 'href') continue;
        if (tag === 'IMG' && (attr.name === 'src' || attr.name === 'alt' || attr.name === 'title')) continue;
        if (tag === 'CODE' && attr.name === 'class' && attr.value.split(/\s+/).every(x => ALLOWED_CODE_CLASSES.test(x))) continue;
        if (tag === 'OL' && attr.name === 'start' && /^\d+$/.test(attr.value)) continue;
        if (tag === 'TH' && attr.name === 'scope' && /^(col|row)$/.test(attr.value)) continue;
        node.removeAttribute(attr.name);
      }
      if (tag === 'A') {
        const href = node.getAttribute('href') || '';
        if (/^\s*(javascript|data|vbscript|file|blob):/i.test(href) || href.startsWith('//')) node.removeAttribute('href');
      }
      if (tag === 'IMG') {
        node.dataset.localSource = node.getAttribute('src') || '';
        node.removeAttribute('src');
      }
      Array.from(node.childNodes).forEach(clean);
    }
    Array.from(template.content.childNodes).forEach(clean);
    return template.content;
  }
  function restoreMath(fragment, expressions) {
    if (!expressions.length) return;
    const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const textNode of textNodes) {
      const text = textNode.nodeValue;
      const hits = expressions.filter(e => text.includes(e.name));
      if (!hits.length) continue;
      const replace = document.createDocumentFragment();
      let rest = text;
      while (rest) {
        let earliest = null, pos = Infinity;
        for (const e of hits) { const p = rest.indexOf(e.name); if (p >= 0 && p < pos) { pos = p; earliest = e; } }
        if (!earliest) { replace.appendChild(document.createTextNode(rest)); break; }
        if (pos) replace.appendChild(document.createTextNode(rest.slice(0, pos)));
        const math = document.createElement('span');
        math.className = 'math-expression'; math.textContent = earliest.formula;
        replace.appendChild(math);
        rest = rest.slice(pos + earliest.name.length);
      }
      textNode.replaceWith(replace);
    }
  }
  function enhanceCallouts(fragment) {
    let count = 0;
    fragment.querySelectorAll('blockquote').forEach(blockquote => {
      const head = blockquote.firstElementChild;
      if (!head || head.tagName !== 'P') return;
      const matched = /^\[!([a-z][a-z0-9_-]*)\]([+-])?(?:[ \t]+(.*))?$/i.exec(head.textContent.trim());
      if (!matched) return;
      const type = matched[1].toLowerCase();
      if (!Object.prototype.hasOwnProperty.call(CALLOUT_LABELS, type)) return;
      const isFold = matched[2] === '+' || matched[2] === '-';
      const outer = document.createElement(isFold ? 'details' : 'div');
      outer.className = `obsidian-callout obsidian-callout--${type}`;
      if (isFold && matched[2] === '+') outer.open = true;
      const heading = document.createElement(isFold ? 'summary' : 'div');
      heading.className = 'obsidian-callout-title';
      heading.textContent = matched[3] || CALLOUT_LABELS[type];
      outer.appendChild(heading);
      head.remove();
      while (blockquote.firstChild) outer.appendChild(blockquote.firstChild);
      blockquote.replaceWith(outer);
      count++;
    });
    return count;
  }
  function prependFrontmatter(fragment, frontmatter) {
    if (frontmatter === null) return false;
    const details = document.createElement('details');
    details.className = 'obsidian-properties';
    const summary = document.createElement('summary');
    summary.textContent = 'Vlastnosti poznámky (YAML)';
    const pre = document.createElement('pre');
    pre.textContent = frontmatter;
    details.append(summary, pre);
    fragment.prepend(details);
    return true;
  }
  function render(text, container, options = {}) {
    if (!global.marked || typeof global.marked.parse !== 'function') throw new Error('Chybí offline knihovna marked.js.');
    const { prepared, expressions, frontmatter } = prepareSource(text);
    const html = global.marked.parse(prepared, { gfm: true, breaks: false, headerIds: false, mangle: false });
    const fragment = sanitize(html);
    restoreMath(fragment, expressions);
    const callouts = enhanceCallouts(fragment);
    const properties = prependFrontmatter(fragment, frontmatter);
    const allCode = Array.from(fragment.querySelectorAll('pre > code'));
    allCode.forEach(code => {
      if (/\blanguage-(?:mermaid|abc)\b/.test(code.className)) {
        const warn = document.createElement('div');
        warn.className = 'unsupported';
        warn.textContent = code.className.includes('mermaid')
          ? 'Mermaid: knihovna není nainstalována. Viz docs/RENDERERY.md. Zdroj zůstává zachovaný.'
          : 'ABCjs: knihovna není nainstalována. Viz docs/RENDERERY.md. Zdroj zůstává zachovaný.';
        code.parentNode.before(warn);
      }
    });
    let idx = 0;
    fragment.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach(h => { h.id = `wiki-heading-${idx++}`; });
    container.replaceChildren(fragment);
    const diagrams = global.LocalWikiDiagrams ? global.LocalWikiDiagrams.enhance(container, options.onDiagramUpdate) : { ready: 0, missing: 0 };
    if (expressions.length && global.MathJax && global.MathJax.Hub) {
      try { global.MathJax.Hub.Queue(['Typeset', global.MathJax.Hub, container]); }
      catch (err) { console.warn('MathJax:', err); }
    }
    return { imageNodes: Array.from(container.querySelectorAll('img[data-local-source]')), headings: idx, expressions: expressions.length, callouts, properties, diagrams };
  }
  global.LocalWikiRender = { render, prepareSource, convertWikiLinks, convertEmbeds, extractFrontmatter };
})(window);
