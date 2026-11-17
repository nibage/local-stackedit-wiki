/* Base YAML editing must preserve source and refuse unsupported/unsafe YAML. */
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const reader=fs.readFileSync(path.join(__dirname,'../src/bases-viewer.js'),'utf8');
const editor=fs.readFileSync(path.join(__dirname,'../src/bases-editor.js'),'utf8');
function api(){
 const w={};
 vm.runInNewContext(reader,{window:w,console});
 vm.runInNewContext(editor,{window:w,console});
 return w.LocalWikiBasesEditor;
}
test('raw Base YAML edits preserve comments, names and unknown keys byte-for-byte outside explicit changes',()=>{
 const original='# comment\nunknownKey: preserve-me\nviews:\n  - type: table\n    name: "Reading list"\n    order:\n      - file.name\n';
 const e=api();
 e.validate(original);
 const d=e.createDraft(original);
 assert.equal(d.dirty,false);
 d.replace(original.replace('Reading list','My notes'));
 assert.equal(d.dirty,true);
 assert.ok(d.value.includes('# comment'));
 assert.ok(d.value.includes('unknownKey: preserve-me'));
 assert.ok(d.value.includes('name: "My notes"'));
 d.discard();
 assert.equal(d.value,original);
 assert.equal(d.dirty,false);
 d.replace(original.replace('Reading list','My notes'));
 d.markSaved();
 assert.equal(d.dirty,false);
});
test('safe subset validation rejects unsupported YAML and missing views',()=>{
 const e=api();
 assert.throws(()=>e.validate('views: nope\n'),/views list/);
 assert.throws(()=>e.validate('views:\n  - type: table\nextra: !execute\n'),/Unsupported/);
 assert.throws(()=>e.validate('constructor: evil\nviews: []\n'),/Unsafe/);
 assert.throws(()=>e.validate('[]'),/Unsupported|mapping/);
});
