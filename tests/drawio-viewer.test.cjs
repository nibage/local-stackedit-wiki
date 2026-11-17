/* draw.io safe parsing contract with no DOM dependency. */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),
  path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/drawio-viewer.js'),'utf8');
function viewer(){const window={};vm.runInNewContext(source,{window});return window.LocalWikiDrawio;}
test('draw.io style parsing only recognizes inert property strings',()=>{
  const v=viewer();
  const style=v.styleMap('rounded=1;fillColor=#dae8fc;strokeColor=#6c8ebf;shape=rectangle;');
  assert.equal(style.fillColor,'#dae8fc');
  assert.equal(style.strokeColor,'#6c8ebf');
  assert.equal(style.rounded,'1');
  const bad=v.styleMap('fillColor=red;__proto__=evil;image=https://evil.example/img.png');
  assert.equal(Object.getPrototypeOf(bad),null);
  assert.equal(bad.fillColor,'red'); // rejected by SVG color allowlist during rendering
  assert.equal(bad.image,'https://evil.example/img.png'); // never fetched by renderer
});
test('draw.io label removes XML/HTML markup and decodes normal entities',()=>{
  const v=viewer();
  assert.equal(v.label('A&lt;br&gt;&lt;img src=x onerror=evil()&gt;'),'A<br><img src=x onerror=evil()>');
  assert.equal(v.label('<b>Text</b> &amp; data'),'Text & data');
  assert.equal(v.label('Hello&#32;world'),'Hello world');
});
