const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'..','src','file-system.js'), 'utf8');
class FileHandle {
  constructor(name, bytes, lastModified=1000) {
    this.kind='file'; this.name=name; this.bytes=Buffer.from(bytes); this.lastModified=lastModified;
  }
  async getFile() {
    const bytes = Buffer.from(this.bytes);
    return {size:bytes.length,lastModified:this.lastModified,
      arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength)};
  }
  async createWritable() {
    let pending;
    return {write:async value=>{pending=Buffer.from(value);},close:async()=>{
      this.bytes=pending; this.lastModified+=1;
    },abort:async()=>{}};
  }
}
class Dir {
  constructor(...children) {this.kind='directory';this.name='Wiki';this.children=children;}
  async *values() {yield* this.children;}
}
async function setup(...files) {
  const c={console,TextDecoder,TextEncoder,showDirectoryPicker:async()=>new Dir(...files)};
  c.window=c;
  vm.runInNewContext(source,c);
  const bridge=c.LocalWikiFS.createBridge();await bridge.openWritable();return bridge;
}
test('BOM is hidden in editor read but preserved in raw migration reads',async()=>{
  const original=Buffer.from('\ufeff# Žluťoučký\r\nDruhý řádek\r\n');
  const b=await setup(new FileHandle('BOM.md',original));
  const read=await b.read('BOM.md');
  assert.equal(read.hasBOM,true);
  assert.equal(read.text,'# Žluťoučký\r\nDruhý řádek\r\n');
  assert.equal((await b.readRaw('BOM.md')).text,'\ufeff# Žluťoučký\r\nDruhý řádek\r\n');
});
test('Saving an edited BOM+CRLF file retains original byte-level format',async()=>{
  const f=new FileHandle('A.md',Buffer.from('\ufeff# Test\r\nŘádek\r\n'));
  const b=await setup(f);
  const before=await b.read('A.md');
  await b.write('A.md',`\ufeff${before.text.replace('Řádek','Novinka')}`,before.fingerprint);
  assert.equal(f.bytes.toString('utf8'),'\ufeff# Test\r\nNovinka\r\n');
  assert.equal((await b.read('A.md')).text,'# Test\r\nNovinka\r\n');
});
test('External rewrite of same size and mtime is detected',async()=>{
  const f=new FileHandle('A.md',Buffer.from('FIRST'));
  const b=await setup(f);
  const {fingerprint}=await b.read('A.md');
  f.bytes=Buffer.from('OTHER'); // same length, identical mtime
  await assert.rejects(()=>b.write('A.md','WRITE',fingerprint),err=>err.code==='EXTERNAL_CHANGE');
  assert.equal(f.bytes.toString(),'OTHER');
  await assert.rejects(()=>b.renameFile('A.md','B.md',fingerprint),err=>err.code==='EXTERNAL_CHANGE');
});
test('Invalid UTF-8 is rejected rather than decoded using replacements',async()=>{
  const f=new FileHandle('Bad.md',Buffer.from([0x23,0x20,0xc3,0x28]));
  const b=await setup(f);
  await assert.rejects(()=>b.read('Bad.md'),/not valid UTF-8/);
  await assert.rejects(()=>b.readRaw('Bad.md'),/not valid UTF-8/);
  assert.deepEqual([...f.bytes],[0x23,0x20,0xc3,0x28]);
});
test('Non-BOM UTF-8 remains non-BOM after save',async()=>{
  const f=new FileHandle('Plain.md',Buffer.from('český text'));
  const b=await setup(f);
  const {fingerprint,hasBOM}=await b.read('Plain.md');
  assert.equal(hasBOM,false);
  await b.write('Plain.md','úprava',fingerprint);
  assert.equal(f.bytes.toString('utf8'),'úprava');
  assert.equal(f.bytes.subarray(0,3).toString('hex').startsWith('efbbbf'),false);
});
