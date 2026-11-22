'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const source=file=>fs.readFileSync(path.join(ROOT,file),'utf8');

test('toolbar groups line numbers, Center and wrapping before rendering controls',()=>{
  const html=source('index.html');
  const ids=['line-numbers-toggle','center-content-toggle','line-wrap-toggle',
    'auto-rerender-toggle','render-now','scroll-sync-toggle','workspace-text-size'];
  const positions=ids.map(id=>html.indexOf('id="'+id+'"'));
  assert.ok(positions.every(x=>x>0),positions);
  assert.deepEqual([...positions].sort((a,b)=>a-b),positions);
  assert.equal((html.match(/workspace-display-divider/g)||[]).length,2);
  assert.match(html, /data-asset-kind="drawio"[^>]*>[^<]+<\/button>\s*<span class="toolbar-divider"/);
});

test('PDF export is deliberately user-triggered and pages do not clip',()=>{
  const exporter=source('src/preview-export.js');
  const main=source('src/main.js');
  assert.match(exporter, /const PRINT_STYLES =/);
  assert.match(exporter, /@page \{ size:A4; margin:10mm 11mm 12mm; \}/);
  assert.match(exporter, /break-inside:avoid-page!important/);
  assert.match(exporter, /display:table-header-group!important/);
  assert.match(exporter, /overflow-wrap:anywhere!important/);
  assert.match(exporter, /function showPdfPreview\(html,popup\)/);
  assert.match(exporter, /print\.textContent='Print \/ Save PDF'/);
  assert.match(main, /await exporter\.showPdfPreview\(html,popup\)/);
  assert.doesNotMatch(main, /await exporter\.printHtml\(html,popup\)/);
  assert.match(main, /requestAnimationFrame\(\(\) => \{\s*if \(!element\.isConnected\) return;\s*element\.data = url/);
});

test('two-page sample PDF has valid ASCII xref and both page trees',()=>{
  const bytes=fs.readFileSync(path.join(ROOT,'demo-wiki/Attachments/sample.pdf'));
  const pdf=bytes.toString('latin1');
  assert.match(pdf,/^%PDF-1\.4\n/);
  assert.match(pdf,/\/Type \/Pages \/Kids \[3 0 R 5 0 R\] \/Count 2/);
  assert.equal((pdf.match(/\/Type \/Page \/Parent/g)||[]).length,2);
  assert.match(pdf,/Page 1 \/ 2/);
  assert.match(pdf,/Page 2 \/ 2/);
  const offset=Number(/startxref\n(\d+)\n%%EOF/.exec(pdf)?.[1]);
  assert.ok(Number.isInteger(offset)&&pdf.slice(offset,offset+4)==='xref');
  const objectStarts=[...pdf.matchAll(/(?:^|\n)([1-8]) 0 obj\n/g)].map(m=>m.index+(m[0].startsWith('\n')?1:0));
  assert.equal(objectStarts.length,8);
  const xrefBody=pdf.slice(offset).split('\n').slice(3,11);
  assert.equal(xrefBody.length,8);
  objectStarts.forEach((position,i)=>assert.equal(Number(xrefBody[i].slice(0,10)),position));
});

test('structured asset editing keeps footer save/exit guards and hides insert',()=>{
  const main=source('src/main.js');
  const canvas=source('src/canvas-editor.js');
  const base=source('src/bases-editor.js');
  const raw=source('src/asset-source-editor.js');
  assert.match(main, /attachment-insert'\)\.hidden = false/);
  assert.match(main, /attachment-insert'\)\.hidden=true/);
  assert.match(main, /attachment-insert'\)\.hidden=false/);
  assert.match(canvas, /options\.confirmHost\) options\.confirmHost\.insertBefore\(warning/);
  assert.match(canvas, /make\('button','canvas-control canvas-confirm-save','Save'\)/);
  assert.match(base, /asset-confirm-save','Save'/);
  assert.match(raw, /saveExit\.textContent='Save'/);
  const style=source('assets/attachment-dialog-actions.css');
  assert.match(style, /order:-1;flex:0 0 100%/);
  assert.match(style, /\.canvas-editor-save-stack button:not\(:disabled\)/);
});
