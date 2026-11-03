/*
 * Local StackEdit Wiki: non-destructive runtime smoke tests for OPTIONAL offline
 * Mermaid and ABCjs distributions. This file contains no third-party renderer.
 * Tests only a fixed diagram/score, never wiki text; writes no files and makes
 * no network requests. It detects a script that loads but cannot render.
 */
(function (global) {
  'use strict';
  const FIXED_MERMAID = 'graph TD\n  A[Start] --> B[End]';
  const FIXED_ABC = 'X:1\nT:Test\nM:4/4\nL:1/4\nK:C\nC D E F | G4 |';
  const MAX_WAIT = 6500;
  let running = false;
  let serial = 0;
  let last = null;

  function makeStage(document) {
    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:900px;max-height:900px;overflow:hidden;pointer-events:none;';
    document.body.appendChild(stage);
    return stage;
  }
  function assessSvg(svg) {
    if (!svg || svg.localName?.toLowerCase() !== 'svg' || svg.namespaceURI !== 'http://www.w3.org/2000/svg') {
      throw new Error('No valid SVG was generated.');
    }
    if (!svg.querySelector('path,line,polyline,polygon,rect,text,g')) {
      throw new Error('SVG is empty.');
    }
    return true;
  }
  function result(status, message) { return { status, message }; }
  async function checkMermaid(mermaid, document, adapter, timeoutMs) {
    if (!mermaid || typeof mermaid.initialize !== 'function' || typeof mermaid.mermaidAPI?.render !== 'function') {
      return result('missing', 'Mermaid is not loaded.');
    }
    const stage = makeStage(document);
    let timeoutId;
    try {
      if (typeof adapter?.safeSvgFromString !== 'function') throw Error('SVG adapter is missing.');
      const id = `local-wiki-selftest-${++serial}`;
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral', flowchart: { htmlLabels: false } });
      const value = await new Promise((resolve, reject) => {
        let settled = false;
        const fulfill = svg => {
          if (settled) return;
          if (typeof svg !== 'string' || !svg.includes('<svg')) return;
          settled = true; resolve(svg);
        };
        const rejectOnce = err => { if (!settled) { settled = true; reject(err); } };
        timeoutId = setTimeout(() => rejectOnce(new Error('Mermaid did not return SVG before timeout.')), timeoutMs);
        try {
          const response = mermaid.mermaidAPI.render(id, FIXED_MERMAID, fulfill, stage);
          if (typeof response === 'string') fulfill(response);
          else if (response && typeof response.then === 'function') {
            response.then(value => fulfill(typeof value === 'string' ? value : value?.svg)).catch(rejectOnce);
          }
        } catch (e) { rejectOnce(e); }
      });
      assessSvg(adapter.safeSvgFromString(value));
      return result('ok', 'Sample flowchart rendered as SVG.');
    } catch (error) {
      return result('failed', String(error?.message || error).slice(0, 220));
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      stage.remove();
    }
  }
  async function checkABC(abc, document, adapter) {
    if (!abc || typeof abc.renderAbc !== 'function') return result('missing', 'ABCjs is not loaded.');
    const stage = makeStage(document);
    try {
      abc.renderAbc(stage, FIXED_ABC, { responsive: 'resize', paddingtop: 12, paddingbottom: 12 });
      const svg = stage.querySelector('svg');
      assessSvg(svg);
      // Use the same SVG-scrubber as the actual preview (on a detached copy).
      if (typeof adapter?.scrubSvg !== 'function') throw Error('SVG adapter is missing.');
      adapter.scrubSvg(svg.cloneNode(true));
      return result('ok', 'Sample notation rendered as SVG.');
    } catch (error) {
      return result('failed', String(error?.message || error).slice(0, 220));
    } finally {
      stage.remove();
    }
  }
  async function run({ mermaid = global.mermaid, abc = global.ABCJS,
    document = global.document, adapter = global.LocalWikiDiagrams,
    timeoutMs = MAX_WAIT } = {}) {
    if (running) throw new Error('Renderer test is already running.');
    if (!document?.body) throw new Error('The document is not ready yet.');
    running = true;
    try {
      const mermaidResult = await checkMermaid(mermaid, document, adapter, timeoutMs);
      const abcResult = await checkABC(abc, document, adapter);
      last = { mermaid: mermaidResult.status, abc: abcResult.status };
      return { mermaid: mermaidResult, abc: abcResult };
    } finally { running = false; }
  }
  function lastStatus() { return last ? { ...last } : null; }
  global.LocalWikiRendererSmoke = { run, assessSvg, lastStatus };
})(typeof window !== 'undefined' ? window : globalThis);
