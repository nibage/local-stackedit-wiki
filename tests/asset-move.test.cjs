const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = {TextDecoder,TextEncoder,Set,Map,Uint8Array}; context.window=context;
for (const name of ['file-system.js','wiki-index.js','link-migration.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',name),'utf8'),context,{filename:name});
}
const migration = context.LocalWikiMigration;
const snapshot = text => ({text,fingerprint:'f'});
const plan = (notes,oldPath,newPath,paths=[oldPath]) => migration.planAsset(new Map(Object.entries(notes).map(([k,v])=>[k,snapshot(v)])),oldPath,newPath,paths);
const rewritten = (p,path) => p.changes.find(c=>c.path===path)?.after;
test('rewrites Markdown image and ordinary links and Obsidian embeds after a move',()=>{
  const p = plan({'Index.md':'![Logo](logo.png) [download](logo.png) ![[logo.png|300]]'},'logo.png','Pictures/logo.png');
  assert.equal(rewritten(p,'Index.md'),'![Logo](Pictures/logo.png) [download](Pictures/logo.png) ![[Pictures/logo.png|300]]');
  assert.equal(p.totalLinks,3);
});
test('relative paths from nested notes and percent-encoded names are retained',()=>{
  const p=plan({'Docs/Readme.md':'![x](../assets/a%20b.webp#foo)\n![[../assets/a b.webp|200]]'},'assets/a b.webp','Images/new a.webp');
  assert.equal(rewritten(p,'Docs/Readme.md'),'![x](../Images/new%20a.webp#foo)\n![[../Images/new a.webp|200]]');
});
test('does not rewrite code fences, inline code, external links or unrelated assets',()=>{
  const before='![x](a.gif) `![x](a.gif)`\n```md\n![x](a.gif)\n```\n![x](https://example.org/a.gif) ![x](b.gif)';
  const p=plan({'X.md':before},'a.gif','Sub/a.gif',['a.gif','b.gif']);
  assert.equal(rewritten(p,'X.md'), before.replace('![x](a.gif) `','![x](Sub/a.gif) `'));
  assert.equal(p.totalLinks,1);
});
test('does not guess ambiguous Obsidian basenames',()=>{
  const p=plan({'X.md':'![[pic.png]]'},'A/pic.png','B/pic.png',['A/pic.png','C/pic.png']);
  assert.equal(p.totalLinks,0);
});
test('supports png jpg jpeg webp gif bmp and avif in binary-move planning',()=>{
  for(const ext of ['png','jpg','jpeg','webp','gif','bmp','avif']) {
    const p=plan({'X.md':`![image](file.${ext})`},`file.${ext}`,`Assets/file.${ext}`);
    assert.equal(p.totalLinks,1,ext);
  }
});
class MockFile {
  constructor(name,bytes) {this.kind='file';this.name=name;this.bytes=Buffer.from(bytes);this.lastModified=100;}
  async getFile(){const data=Buffer.from(this.bytes);return{lastModified:this.lastModified,arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}}
  async createWritable(){let bytes;return{write:async b=>{bytes=Buffer.from(b)},close:async()=>{this.bytes=bytes;this.lastModified++},abort:async()=>{}}}
}
class MockDir {
  constructor(name,items=[]){this.kind='directory';this.name=name;this.entries=new Map(items.map(x=>[x.name,x]));}
  async *values(){yield* this.entries.values()}
  async getDirectoryHandle(name,{create=false}={}){const c=this.entries.get(name);if(c){if(c.kind!=='directory')throw Error('not a directory');return c;}if(!create)throw Error('missing folder');const d=new MockDir(name);this.entries.set(name,d);return d;}
  async getFileHandle(name,{create=false}={}){const c=this.entries.get(name);if(c){if(c.kind!=='file')throw Error('not a file');return c;}if(!create)throw Error('missing file');const f=new MockFile(name,Buffer.alloc(0));this.entries.set(name,f);return f;}
  async removeEntry(name){if(!this.entries.has(name))throw Error('missing');this.entries.delete(name)}
}
async function setup(root){context.showDirectoryPicker=async()=>root;const b=context.LocalWikiFS.createBridge();await b.openWritable();return b;}
test('moves binary image without byte changes and updates file tree',async()=>{
  const original=Buffer.from([0,255,23,0,126,128,0,1,4,240,255]);
  const root=new MockDir('wiki',[new MockFile('photo.webp',original),new MockDir('Pictures')]);
  const b=await setup(root);
  const fingerprint=await b.assetFingerprint('photo.webp');
  await b.moveAsset('photo.webp','Pictures/photo.webp',fingerprint);
  assert.equal(b.hasAsset('photo.webp'),false);
  assert.equal(b.hasAsset('Pictures/photo.webp'),true);
  assert.deepEqual(root.entries.get('Pictures').entries.get('photo.webp').bytes,original);
});
test('rejects collision, non-existent destination parent, extension change, old fingerprint',async()=>{
  const root=new MockDir('wiki',[new MockFile('photo.png',[2,3,7]),new MockFile('other.png',[8])]);
  const b=await setup(root);const fp=await b.assetFingerprint('photo.png');
  for(const target of ['other.png','Absent/photo.png','photo.jpg','../escape.png','file.svg']){
    await assert.rejects(()=>b.moveAsset('photo.png',target,fp),undefined,target);
  }
  await assert.rejects(()=>b.moveAsset('photo.png','new.png','wrong'),/changed/i);
  assert.ok(b.hasAsset('photo.png'));
});
