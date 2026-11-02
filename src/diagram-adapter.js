/* Local Wiki – offline adapters for the official Mermaid 8 and ABCjs 6 UMD builds.
 * The libraries themselves are optional. Rendering never alters the .md source.
 */
(function (global) {
  'use strict';
  let nextId = 0;
  const TYPES = { mermaid: 'Mermaid', abc: 'ABCjs' };

  function capabilities() {
    return {
      mermaid: !!(global.mermaid && typeof global.mermaid.initialize === 'function' &&
        global.mermaid.mermaidAPI && typeof global.mermaid.mermaidAPI.render === 'function'),
      abc: !!(global.ABCJS && typeof global.ABCJS.renderAbc === 'function')
    };
  }

  function scrubSvg(root) {
    if (!root || root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') {
      throw new Error('Renderer nevrátil platné SVG.');
    }
    const forbidden = new Set([
      'script','foreignobject','iframe','object','embed','image','feimage','audio','video',
      'animate','animatetransform','animatemotion','set','metadata'
    ]);
    let removed = 0;
    for (const el of [root, ...root.querySelectorAll('*')]) {
      if (!el.isConnected && el !== root && !root.contains(el)) continue;
      if (forbidden.has(el.localName.toLowerCase())) { el.remove(); removed++; continue; }
      for (const attr of Array.from(el.attributes)) {
        const name = attr.localName.toLowerCase();
        const value = attr.value.trim();
        const css = (name === 'style' || name === 'class') ? value : '';
        const urlDanger = /url\s*\(\s*(?!['"]?#[-\w:.]+['"]?\s*\))[^)]*\)/i;
        if (name.startsWith('on') || name === 'src' || name === 'srcset' ||
            ((name === 'href') && !/^#[\w:.-]+$/.test(value)) ||
            (/url\s*\(/i.test(value) && urlDanger.test(value)) ||
            (css && /@import|expression\s*\(|-moz-binding|javascript\s*:/i.test(css))) {
          el.removeAttributeNode(attr); removed++;
        }
      }
      if (el.localName.toLowerCase() === 'style' &&
          /@import|expression\s*\(|-moz-binding|javascript\s*:|url\s*\(\s*(?!['"]?#[-\w:.]+['"]?\s*\))/i.test(el.textContent)) {
        el.remove(); removed++;
      }
    }
    return removed;
  }

  function safeSvgFromString(xml) {
    if (typeof xml !== 'string' || !/<svg(?:\s|>)/i.test(xml)) {
      throw new Error('Renderer nevrátil SVG.');
    }
    const doc = new DOMParser().parseFromString(xml, 'image/svg+xml');
    if (doc.querySelector('parsererror')) throw new Error('SVG obsahuje chybný XML zápis.');
    scrubSvg(doc.documentElement);
    return document.importNode(doc.documentElement, true);
  }

  function addExportButton(target, type, svg) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'diagram-export';
    button.textContent = 'Uložit SVG';
    button.title = 'Uloží pouze vykreslený diagram, původní poznámka se nemění.';
    button.addEventListener('click', () => {
      const output = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([output], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `${type}-${Date.now()}.svg`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
    target.appendChild(button);
  }

  function enhance(container, onUpdate = () => {}) {
    const counters = { rendered: 0, missing: 0, failed: 0, pending: 0 };
    const runtime = capabilities();
    const notify = () => onUpdate({ ...counters });

    for (const code of Array.from(container.querySelectorAll('pre > code'))) {
      const kind = /\blanguage-(mermaid|abc)\b/i.exec(code.className)?.[1]?.toLowerCase();
      if (!kind) continue;
      const label = TYPES[kind];
      const pre = code.parentElement;
      const warning = pre.previousElementSibling?.classList.contains('unsupported') ? pre.previousElementSibling : null;
      const setWarning = message => { if (warning?.isConnected) warning.textContent = message; };
      if (!runtime[kind]) {
        counters.missing++;
        setWarning(`${label}: knihovna není nainstalována. Zdrojový kód zůstává viditelný. Viz docs/RENDERERY.md.`);
        continue;
      }
      const target = document.createElement('div');
      target.className = `visualization visualization-${kind}`;
      target.setAttribute('role', 'group');
      target.setAttribute('aria-label', `Vykreslení ${label}`);
      pre.before(target);
      const original = code.textContent;
      let settled = false;
      counters.pending++;
      const fail = err => {
        if (settled) return;
        settled = true; counters.pending--; counters.failed++;
        target.remove();
        setWarning(`${label}: vykreslení selhalo (${err?.message || String(err)}). Zdroj je zachován.`);
        notify();
      };
      const success = nodes => {
        if (settled || !target.isConnected) return;
        if (!nodes.length) { fail(new Error('Žádný SVG výstup')); return; }
        try {
          for (const node of nodes) { scrubSvg(node); target.appendChild(node); }
          addExportButton(target, kind, nodes[0]);
          pre.hidden = true;
          if (warning?.isConnected) warning.remove();
          settled = true; counters.pending--; counters.rendered++;
          notify();
        } catch (err) { fail(err); }
      };
      try {
        if (kind === 'abc') {
          global.ABCJS.renderAbc(target, original, { responsive: 'resize', paddingtop: 12, paddingbottom: 12 });
          const svgNodes = Array.from(target.querySelectorAll('svg'));
          if (!svgNodes.length) throw new Error('ABCjs nevrátil notový zápis.');
          // ABCjs generates DOM nodes directly. Scrub before displaying/exporting.
          success(svgNodes);
        } else {
          const mermaid = global.mermaid;
          if (!mermaid.__localWikiConfigured) {
            mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral',
              flowchart: { htmlLabels: false } });
            mermaid.__localWikiConfigured = true;
          }
          const id = `local-wiki-mermaid-${++nextId}`;
          const received = xml => {
            if (settled || !target.isConnected) return;
            try { success([safeSvgFromString(xml)]); } catch (err) { fail(err); }
          };
          const response = mermaid.mermaidAPI.render(id, original, received);
          if (typeof response === 'string') received(response);
          else if (response && typeof response.then === 'function') {
            response.then(output => {
              const xml = typeof output === 'string' ? output : output?.svg;
              if (typeof xml === 'string') received(xml);
            }).catch(fail);
          }
        }
      } catch (err) { fail(err); }
    }
    notify();
    return counters;
  }
  global.LocalWikiDiagrams = { enhance, capabilities, scrubSvg, safeSvgFromString };
})(window);
