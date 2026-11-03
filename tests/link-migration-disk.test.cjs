const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const files = ['file-system.js', 'wiki-index.js','link-migration.js'];
const ctx = {TextDecoder,TextEncoder,Uint8Array,Set,Map}; ctx.window = ctx;
for (const filename of files) vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..','src',filename),'utf8'),ctx);
class MockFile {
  constructor(name, text) {this.kind='file';this.name=name;this.body=Buffer.from(text);this.lastModified=1;this.failWrite=false;}
  async getFile() { const bytes=Buffer.from(this.body); return {
    size:bytes.length,lastModified:this.lastModified,
    text:async()=>bytes.toString('utf8'),
    arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
  };}
  async createWritable() {
    if(this.failWrite) throw new Error('Simulated disk write failed');
    let pending;
    return {write:async val=>{pending=Buffer.from(val);},close:async()=>{this.body=pending;this.lastModified++},abort:async()=>{}};
  }
}
class MockDir {
  constructor(name,children=[]) {this.kind='directory';this.name=name;this.children=new Map(children.map(c=>[c.name,c]));}
  async *values() {yield* this.children.values();}
  async getDirectoryHandle(name,{create=false}={}) { const n=this.children.get(name); if(n) {if(n.kind==='directory')return n;throw new Error('Not a dir');} if(!create)throw new Error('Not found');const d=new MockDir(name);this.children.set(name,d);return d;}
  async getFileHandle(name,{create=false}={}) { const n=this.children.get(name); if(n) {if(n.kind==='file')return n;throw new Error('Not a file');} if(!create)throw new Error('Not found');const f=new MockFile(name,'');this.children.set(name,f);return f;}
  async removeEntry(name) {this.children.delete(name);}
}
async function bridgeFor(root) {ctx.showDirectoryPicker=async()=>root;const bridge=ctx.LocalWikiFS.createBridge();await bridge.openWritable();return bridge;}
test('successful migration updates inbound and outgoing links on disk (BOM and CRLF preserved)',async()=>{
  const root=new MockDir('Wiki',[
    new MockFile('index.md','\ufeff# Obsah\r\n[Link](Pod/Old.md#x) a [[Pod/Old|alias]]\r\n'),
    new MockDir('Pod',[new MockFile('Old.md','# Název\r\n[Domů](../index.md)\r\n')]),
    new MockDir('Jinde')
  ]);
  const b=await bridgeFor(root);const ss=await ctx.LocalWikiMigration.snapshotAll(b);
  const p=ctx.LocalWikiMigration.plan(ss,'Pod/Old.md','Jinde/New.md');
  assert.equal(p.totalLinks,2);
  const result=await ctx.LocalWikiMigration.execute(b,p,ss);
  assert.equal(result.updated,1);
  assert.equal(b.hasFile('Pod/Old.md'),false);
  assert.equal((await b.readRaw('index.md')).text,'\ufeff# Obsah\r\n[Link](Jinde/New.md#x) a [[Jinde/New|alias]]\r\n');
  assert.equal((await b.readRaw('Jinde/New.md')).text,'# Název\r\n[Domů](../index.md)\r\n');
});
test('preflight detects external mutation, does not move source',async()=>{
  const root=new MockDir('Wiki',[new MockFile('A.md','# A'),new MockFile('B.md','[A](A.md)')]);
  const b=await bridgeFor(root);const ss=await ctx.LocalWikiMigration.snapshotAll(b);
  const p=ctx.LocalWikiMigration.plan(ss,'A.md','C.md');
  root.children.get('B.md').body=Buffer.from('External');root.children.get('B.md').lastModified++;
  await assert.rejects(()=>ctx.LocalWikiMigration.execute(b,p,ss),/changed/);
  assert.equal(root.children.has('A.md'),true);assert.equal(root.children.has('C.md'),false);
});
test('write failure after partial update rolls back changed documents and rename',async()=>{
  const a=new MockFile('A.md','# A');const b=new MockFile('B.md','[A](A.md)');const c=new MockFile('C.md','[A](A.md)');
  c.failWrite=true;const root=new MockDir('Wiki',[a,b,c]);
  const bridge=await bridgeFor(root);const ss=await ctx.LocalWikiMigration.snapshotAll(bridge);
  const p=ctx.LocalWikiMigration.plan(ss,'A.md','Moved.md');
  await assert.rejects(()=>ctx.LocalWikiMigration.execute(bridge,p,ss),/Changes were rolled back/);
  assert.equal(root.children.has('Moved.md'),false);
  assert.equal((await bridge.readRaw('A.md')).text,'# A');
  assert.equal((await bridge.readRaw('B.md')).text,'[A](A.md)');
  assert.equal((await bridge.readRaw('C.md')).text,'[A](A.md)');
});
