const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/file-system.js'), 'utf8');
class Dir {
  constructor(name, entries=[]) { this.name=name; this.kind='directory'; this.map=new Map(entries.map(x=>[x.name,x])); }
  async *values() { yield* this.map.values(); }
  async getDirectoryHandle(name,{create=false}={}) {
    let h=this.map.get(name);
    if (!h && create) { h=new Dir(name); this.map.set(name,h); }
    if (!h || h.kind!=='directory') throw Error('not found');
    return h;
  }
  async getFileHandle(name,{create=false}={}) {
    let h=this.map.get(name);
    if (!h && create) { h={name,kind:'file'}; this.map.set(name,h); }
    if (!h || h.kind!=='file') throw Error('not found');
    return h;
  }
}
function bridge(root) {
  const win={showDirectoryPicker:async()=>root,console,TextDecoder,TextEncoder};
  win.window=win;vm.runInNewContext(source,win,{filename:'file-system.js'});
  return win.LocalWikiFS.createBridge();
}
test('root-relative nested .md creation requires explicit opt-in',async()=>{
  const root=new Dir('Wiki'),api=bridge(root);await api.openWritable();
  assert.equal(await api.missingParents('/knowledge/novaslozka/pivo.md'),'knowledge');
  await assert.rejects(api.createFile('/knowledge/novaslozka/pivo.md'),/Parent folder does not exist/);
  assert.equal(root.map.size,0);
  assert.equal(await api.createFile('/knowledge/novaslozka/pivo.md',{createParents:true}),'knowledge/novaslozka/pivo.md');
  assert.equal(await api.missingParents('/knowledge/novaslozka/next.md'),null);
  assert.ok(api.hasFile('knowledge/novaslozka/pivo.md'));
});
test('unsafe and case-colliding folders are never created',async()=>{
  const root=new Dir('Wiki',[new Dir('Knowledge')]),api=bridge(root);await api.openWritable();
  for(const input of ['../x.md','//server/x.md','/.git/x.md','C:/x.md']){
    await assert.rejects(api.createFile(input,{createParents:true}),undefined,input);
  }
  await assert.rejects(api.createFile('knowledge/x.md',{createParents:true}),/Parent folder name collision/);
  assert.equal(root.map.size,1);
});
