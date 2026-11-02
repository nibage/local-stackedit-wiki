const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'diagnostics.js'), 'utf8');
function create(ctx) {
  vm.runInNewContext(src, ctx);
  return ctx.LocalWikiDiagnostics;
}
test('diagnostic export never includes wiki names, contents, paths or URL', () => {
  const context = {
    location: {protocol:'file:', pathname:'/secret/wiki/index.html', search:'?token=topsecret'},
    navigator: {userAgent:'Chrome 999'}, isSecureContext:true,
    showDirectoryPicker() {},
    FileSystemFileHandle: {prototype:{createWritable() {}}},
    TextDecoder: class{},
    document: {createElement() { return {webkitdirectory: true}; }},
    LocalWikiDiagrams: {capabilities() {return {mermaid:false,abc:true};}},
    marked: {parse() {}}, CodeMirror() {}, MathJax: {Hub:{}}
  };
  const diag = create(context);
  const report = diag.collect({mode:'readwrite', count:23, dirty:true, indexed:5,
    busy:false, fileNames:['Sensitive.md'], activePath:'personal.md', content:'secret draft'});
  assert.equal(report.environment.protocol,'file:');
  assert.equal(report.environment.showDirectoryPicker,true);
  assert.equal(report.libraries.abcjs,true);
  assert.equal(report.libraries.mermaid,false);
  assert.equal(report.wiki.files,23);
  assert.equal(report.wiki.unsavedEdits,true);
  const json = JSON.stringify(report);
  for (const privateValue of ['secret', 'Sensitive.md', 'personal.md', 'draft', '/secret/wiki', 'topsecret']) {
    assert.ok(!json.includes(privateValue), privateValue);
  }
});
test('diagnostic report clamps malicious metadata', () => {
  const diag = create({navigator:{userAgent:'x'.repeat(600)},location:{protocol:'https:'}});
  const report = diag.collect({count:-1,indexed:Infinity,mode:'hacked'});
  assert.equal(report.wiki.mode,'none');
  assert.equal(report.wiki.files,null);
  assert.equal(report.wiki.indexed,null);
  assert.equal(report.environment.userAgent.length,300);
});

test('records ONLY controlled renderer smoke status in exported diagnostics', () => {
  const diag = create({
    LocalWikiRendererSmoke: {lastStatus() {return {mermaid:'ok',abc:'FAILED with /private/wiki/page.md'};}},
    LocalWikiDiagrams: {capabilities() {return {mermaid:true,abc:true};}}
  });
  const output=diag.collect({});
  assert.equal(output.libraries.smokeTest.mermaid,'ok');
  assert.equal(output.libraries.smokeTest.abc,null);
  assert.ok(!JSON.stringify(output).includes('private'));
});
