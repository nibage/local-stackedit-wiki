const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer-selftest.js'), 'utf8');
function fixture() {
  let appended = 0, removed = 0;
  const svg = {
    localName: 'svg', namespaceURI: 'http://www.w3.org/2000/svg',
    querySelector: s => s === 'path,line,polyline,polygon,rect,text,g' ? {} : null,
    cloneNode: () => svg
  };
  const stage = {
    style: {}, setAttribute() {}, remove() { removed++; },
    querySelector: s => s === 'svg' ? svg : null
  };
  const document = { body: { appendChild() { appended++; } }, createElement: () => stage };
  const adapter = { safeSvgFromString: () => svg, scrubSvg: () => 0 };
  const context = { setTimeout, clearTimeout, Error, String, Promise, window: {} };
  vm.runInNewContext(source, context);
  return { document, adapter, svg, get appended() { return appended; }, get removed() { return removed; }, run: context.window.LocalWikiRendererSmoke.run };
}
test('Reports missing libraries without mounting any stage', async () => {
  const x = fixture();
  const result = await x.run({document:x.document, adapter:x.adapter, mermaid:null, abc:null});
  assert.equal(result.mermaid.status,'missing');
  assert.equal(result.abc.status,'missing');
  assert.equal(x.appended,0);
});
test('Actually calls Mermaid 8 callback and ABCjs renderAbc and always cleans up', async () => {
  const x=fixture();
  let mermaidText = '', abcText = '';
  const mermaid={initialize(){},mermaidAPI:{render(id,text,callback){mermaidText=text; callback('<svg xmlns="http://www.w3.org/2000/svg"><path/></svg>');}}};
  const abc={renderAbc(stage,text){abcText=text;}};
  const output=await x.run({document:x.document,adapter:x.adapter,mermaid,abc});
  assert.equal(output.mermaid.status,'ok'); assert.equal(output.abc.status,'ok');
  assert.match(mermaidText,/graph TD/);assert.match(abcText,/K:C/);
  assert.equal(x.appended,2);assert.equal(x.removed,2);
});
test('Accepts modern Promise Mermaid output as well as the original callback API', async () => {
  const x=fixture();
  const mermaid={initialize(){},mermaidAPI:{render(){return Promise.resolve({svg:'<svg><path/></svg>'});}}};
  const output=await x.run({document:x.document,adapter:x.adapter,mermaid,abc:null});
  assert.equal(output.mermaid.status,'ok');assert.equal(output.abc.status,'missing');
  assert.equal(x.appended,1);assert.equal(x.removed,1);
});
test('Detects loaded-but-broken Mermaid, absent ABC SVG and restores DOM', async () => {
  const x=fixture();
  const mermaid={initialize(){throw Error('broken runtime')},mermaidAPI:{render(){}}};
  const abc={renderAbc(){}};
  const doc={...x.document,createElement(){return {style:{},setAttribute(){},remove(){},querySelector(){return null;}}}};
  const output=await x.run({document:doc,adapter:x.adapter,mermaid,abc});
  assert.equal(output.mermaid.status,'failed');assert.match(output.mermaid.message,/broken runtime/);
  assert.equal(output.abc.status,'failed');
});
test('Timeout when Mermaid never resolves, then accepts another run', async () => {
  const x=fixture();
  const mermaid={initialize(){},mermaidAPI:{render(){}}};
  let r=await x.run({document:x.document,adapter:x.adapter,mermaid,abc:null,timeoutMs:15});
  assert.equal(r.mermaid.status,'failed');
  r=await x.run({document:x.document,adapter:x.adapter,mermaid:null,abc:null});
  assert.equal(r.mermaid.status,'missing');
  assert.equal(x.removed,1);
});
test('Second concurrent run is rejected without interfering with the first', async () => {
  const x=fixture();
  const mermaid={initialize(){},mermaidAPI:{render(){}}};
  const first=x.run({document:x.document,adapter:x.adapter,mermaid,abc:null,timeoutMs:25});
  await assert.rejects(x.run({document:x.document,adapter:x.adapter,mermaid,abc:null}),/už probíhá/);
  await first;
});
