const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/file-system.js'), 'utf8');
class F {
  kind = 'file'; lastModified = 100;
  constructor(name, contents = '') { this.name = name; this.contents = contents; }
  async getFile() { const buf = Buffer.from(this.contents); return {lastModified:this.lastModified, arrayBuffer: async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength)}; }
}
class D {
  kind='directory';
  constructor(name, entries=[]) { this.name=name; this.entries=new Map(entries.map(x=>[x.name,x])); }
  async *values(){ yield* this.entries.values(); }
  async getDirectoryHandle(name) {const x=this.entries.get(name); if(!x||x.kind!=='directory')throw Error('not directory'); return x;}
  async getFileHandle(name) {const x=this.entries.get(name); if(!x||x.kind!=='file')throw Error('not file'); return x;}
  async removeEntry(name,{recursive=false}={}) {
    const x=this.entries.get(name); if(!x)throw Error('not found');
    if(x.kind==='directory'&&x.entries.size&&!recursive)throw Error('not empty');
    this.entries.delete(name);
  }
}
function setup(dir){
 const win={window:null,showDirectoryPicker:async(options)=>{win.options=options;return dir},TextDecoder,TextEncoder,console};win.window=win;
 vm.runInNewContext(source,win,{filename:'file-system.js'});
 return {api:win.LocalWikiFS.createBridge(),win};
}
test('read-only checkbox selects read permission and rejects deletion',async()=>{
 const {api,win}=setup(new D('Wiki',[new F('a.md','hello')]));
 const result=await api.openWritable(null,true);
 assert.equal(result.mode,'readonly');
 assert.equal(win.options.mode,'read');
 assert.equal((await api.read('a.md')).text,'hello');
 await assert.rejects(api.deletionSnapshot('a.md','file'),/permission/);
 assert.equal((await api.refresh()).mode,'readonly');
});
test('delete one file only after matching preview',async()=>{
 const root=new D('Wiki',[new F('a.md','first'),new F('b.md','second')]);
 const {api}=setup(root); await api.openWritable();
 const plan=await api.deletionSnapshot('a.md','file');
 assert.equal(plan.files,1);
 root.entries.get('a.md').contents='changed';
 await assert.rejects(api.deleteEntry('a.md','file',plan),/changed/);
 assert.equal(root.entries.size,2);
 const fresh=await api.deletionSnapshot('a.md','file');
 await api.deleteEntry('a.md','file',fresh);
 assert.equal(root.entries.has('a.md'),false);
 assert.equal(root.entries.has('b.md'),true);
});
test('folder deletion includes non-Markdown files and prevents config deletion',async()=>{
 const inside=new D('nested',[new F('a.md','a'),new F('source.gs','var a=1')]);
 const root=new D('Wiki',[inside,new D('.obsidian',[new F('configuration.md','keep')])]);
 const {api}=setup(root);await api.openWritable();
 const plan=await api.deletionSnapshot('nested','directory');
 assert.equal(plan.files,2);assert.equal(plan.directories,1);
 await api.deleteEntry('nested','directory',plan);
 assert.equal(root.entries.has('nested'),false);
 assert.equal(root.entries.has('.obsidian'),true);
 await assert.rejects(api.deletionSnapshot('', 'directory'),/wiki root/);
});
test('folder containing protected subdirectories cannot be deleted', async()=>{
 const root=new D('Wiki',[new D('notes',[new D('.git',[new F('important.md','dont')])])]);
 const {api}=setup(root);await api.openWritable();
 await assert.rejects(api.deletionSnapshot('notes','directory'),/protected/);
 assert.equal(root.entries.has('notes'),true);
});
test('deleting a folder with a renamed child fails closed', async()=>{
 const folder=new D('notes',[new F('a.md','a')]);
 const root=new D('Wiki',[folder]);const {api}=setup(root);await api.openWritable();
 const plan=await api.deletionSnapshot('notes','directory');
 folder.entries.set('added.txt',new F('added.txt','important'));
 await assert.rejects(api.deleteEntry('notes','directory',plan),/changed/);
 assert.equal(root.entries.has('notes'),true);
});
