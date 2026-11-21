const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '../src/file-system.js'), 'utf8');
const now = Date.now();
class MockFile {
  constructor(name, text) { this.name=name; this.contents=text; this.lastModified=now; this.kind='file'; }
  async getFile() { const data = Buffer.from(this.contents); return { size:data.length, lastModified:this.lastModified, text:async()=>data.toString('utf8'), arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength) }; }
  async createWritable() {
    return { write:async(t)=>{this.next=t;},close:async()=>{this.contents=this.next;this.lastModified+=1000;},abort:async()=>{} };
  }
}
class MockDir {
  constructor(name, entries){this.name=name;this.kind='directory';this.entries=entries;}
  async *values() { for(const entry of this.entries) yield entry; }
}
function setup(dir) {
  const context={showDirectoryPicker:async()=>dir, console, TextDecoder, TextEncoder};
  context.window=context;
  vm.runInNewContext(script,context,{filename:'file-system.js'});
  return context.LocalWikiFS.createBridge();
}
test('čte podsložky a vynechává .obsidian, obrázky vidí ve stromu',async()=>{
  const md=new MockFile('A.md','# Hello');
  const root=new MockDir('Wiki',[new MockDir('Z',[md]),new MockDir('.obsidian',[new MockFile('config.md','hidden')]),new MockFile('image.jpg','image')]);
  const api=setup(root);
  const result=await api.openWritable();
  assert.equal(result.mode,'readwrite');
  assert.equal(Array.from(result.tree.children, x => x.name).join(','),'Z,image.jpg');
  assert.equal(result.tree.children[1].kind, 'image');
  assert.equal(Array.from(api.getAssetPaths()).join(','), 'image.jpg');
  assert.equal((await api.read('Z/A.md')).text,'# Hello');
});
test('ukládá původní soubor a blokuje přepis externí změny',async()=>{
  const md=new MockFile('Poznamka.md','Verze 1');
  const api=setup(new MockDir('Wiki',[md]));
  await api.openWritable();
  const {fingerprint}=await api.read('Poznamka.md');
  await api.write('Poznamka.md','Verze 2',fingerprint);
  assert.equal(md.contents,'Verze 2');
  await assert.rejects(()=>api.write('Poznamka.md','Verze 3',fingerprint),e=>e.code==='EXTERNAL_CHANGE');
  assert.equal(md.contents,'Verze 2');
});
test('read-only fallback nemůže zapisovat',async()=>{
  const api=setup(new MockDir('Unused',[]));
  const fakeFile={name:'One.md',webkitRelativePath:'Wiki/One.md',size:3,lastModified:1,text:async()=> 'abc',arrayBuffer:async()=>Uint8Array.from([97,98,99]).buffer};
  const result=api.openReadOnly([fakeFile]);
  assert.equal(result.tree.children[0].path,'One.md');
  assert.equal((await api.read('One.md')).text,'abc');
  await assert.rejects(()=>api.write('One.md','new','3:1'),/read-only/);
});

test('Canvas asset snapshot writes only with a current fingerprint and permission',async()=>{
  const original='{"nodes":[],"edges":[],"future":true}';
  const canvas=new MockFile('draft.canvas',original);
  const other=new MockFile('diagram.drawio','untouched');
  const api=setup(new MockDir('Wiki',[canvas,other]));
  await api.openWritable();
  const snapshot=await api.readAssetSnapshot('draft.canvas');
  assert.equal(snapshot.text,original);
  const saved=await api.writeAsset('draft.canvas','{"nodes":[],"edges":[],"future":true,"draft":1}',snapshot.fingerprint);
  assert.equal(JSON.parse(canvas.contents).draft,1);
  assert.notEqual(saved.fingerprint,snapshot.fingerprint);
  await assert.rejects(()=>api.writeAsset('draft.canvas','overwrite',snapshot.fingerprint),e=>e.code==='EXTERNAL_CHANGE');
  assert.equal(JSON.parse(canvas.contents).draft,1);
  await assert.rejects(()=>api.writeAsset('diagram.drawio','X','anything'),e=>e.code==='EXTERNAL_CHANGE');
  assert.equal(other.contents,'untouched');
});
test('read-only Canvas snapshot cannot be committed',async()=>{
  const text='{"nodes":[],"edges":[]}';
  const canvas=new MockFile('draft.canvas',text);
  const api=setup(new MockDir('Wiki',[canvas]));
  await api.openExisting(new MockDir('Wiki',[canvas]),()=>{},true);
  const snap=await api.readAssetSnapshot('draft.canvas');
  await assert.rejects(()=>api.writeAsset('draft.canvas','not allowed',snap.fingerprint),/read-only/);
  assert.equal(canvas.contents,text);
});

test('Base YAML snapshots protect writes, reject missing assets and read-only writes',async()=>{
  const yaml='views:\n  - type: table\n    name: Notes\n';
  const base=new MockFile('views.base',yaml);
  const api=setup(new MockDir('Wiki',[base]));
  await api.openWritable();
  const snapshot=await api.readAssetSnapshot('views.base');
  assert.equal(snapshot.text,yaml);
  await api.writeAsset('views.base',yaml.replace('Notes','All notes'),snapshot.fingerprint);
  assert.match(base.contents,/All notes/);
  await assert.rejects(()=>api.writeAsset('views.base','corrupt',snapshot.fingerprint),e=>e.code==='EXTERNAL_CHANGE');
  assert.match(base.contents,/All notes/);
  await assert.rejects(()=>api.writeAsset('diagram.drawio','x','missing'),/permission is missing/);
  const ro=setup(new MockDir('Wiki',[base]));
  await ro.openExisting(new MockDir('Wiki',[base]),()=>{},true);
  const after=await ro.readAssetSnapshot('views.base');
  await assert.rejects(()=>ro.writeAsset('views.base','x',after.fingerprint),/read-only/);
});

test('draw.io source snapshots allow only fingerprint-guarded writes in writable mode',async()=>{
  const xml='<?xml version="1.0"?><mxfile><diagram name="Page"><mxGraphModel/></diagram></mxfile>';
  const file=new MockFile('diagram.drawio',xml);
  const api=setup(new MockDir('Wiki',[file]));
  await api.openWritable();
  const snapshot=await api.readAssetSnapshot('diagram.drawio');
  assert.equal(snapshot.text,xml);
  const updated=xml.replace('Page','Updated');
  const result=await api.writeAsset('diagram.drawio',updated,snapshot.fingerprint);
  assert.equal(file.contents,updated);
  assert.notEqual(result.fingerprint,snapshot.fingerprint);
  await assert.rejects(()=>api.writeAsset('diagram.drawio','overwrite',snapshot.fingerprint),
    error=>error.code==='EXTERNAL_CHANGE');
  assert.equal(file.contents,updated);
  const ro=setup(new MockDir('Wiki',[file]));
  await ro.openExisting(new MockDir('Wiki',[file]),()=>{},true);
  const roSnapshot=await ro.readAssetSnapshot('diagram.drawio');
  await assert.rejects(()=>ro.writeAsset('diagram.drawio','x',roSnapshot.fingerprint),/read-only/);
});
