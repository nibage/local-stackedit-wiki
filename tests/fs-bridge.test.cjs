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
test('čte podsložky a vynechává .obsidian i obrázky',async()=>{
  const md=new MockFile('A.md','# Hello');
  const root=new MockDir('Wiki',[new MockDir('Z',[md]),new MockDir('.obsidian',[new MockFile('config.md','hidden')]),new MockFile('image.jpg','image')]);
  const api=setup(root);
  const result=await api.openWritable();
  assert.equal(result.mode,'readwrite');
  assert.equal(Array.from(result.tree.children, x => x.name).join(','),'Z');
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
  await assert.rejects(()=>api.write('One.md','new','3:1'),/pouze pro čtení/);
});
