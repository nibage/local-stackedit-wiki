/* Contract tests for standalone preview export naming and escaping. */
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../src/preview-export.js'),'utf8');
function api(){const w={};vm.runInNewContext(source,{window:w});return w.LocalWikiPreviewExport;}
test('download filenames are safe and preserve Czech text',()=>{
  const e=api();
  assert.equal(e.fileName('Poznámky/Článek.md','html'),'Článek.html');
  assert.equal(e.fileName('Folder/Paper.markdown','pdf'),'Paper.pdf');
  assert.equal(e.fileName('A\\B:Test?.md','html'),'B_Test_.html');
  assert.equal(e.fileName('','html'),'preview.html');
});
test('HTML titles safely encode markup and quotes',()=>{
 const e=api();
 assert.equal(e.escapeHtml('A&B <C> "D"'), 'A&amp;B &lt;C&gt; &quot;D&quot;');
 assert.equal(e.escapeHtml("a'b"),'a&#39;b');
});
