const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const app = fs.readFileSync(path.join(__dirname, '../src/renderer-installer.js'), 'utf8');
const sha = '6Wa+B9B3RYe0RtUPHHpg6RTnDBMLUq1hdoJtNJfkfNOaipetnb30xQPd1nTQDBMF0dt7lOb3XmAq62Dqqr57Zw==';
const sandbox = { Uint8Array, ArrayBuffer, TextDecoder, btoa,
  crypto: { subtle: { async digest() { return Uint8Array.from(Buffer.from(sha, 'base64')).buffer; } } }
};
vm.runInNewContext(app, sandbox);
const { installFromFiles } = sandbox.LocalWikiRendererInstaller;
function bytes(header, size) { const x = new Uint8Array(size); x.fill(65); x.set(new TextEncoder().encode(header)); return x; }
function selected(name, bytes) { return { name, arrayBuffer: async () => bytes.slice().buffer }; }
function mockRoot({ failSecond = false, alreadyMermaid = false } = {}) {
  const store = new Map([
    ['mermaid/mermaid.min.js', alreadyMermaid ? bytes('/* mermaidAPI initialize */', 110000) : new TextEncoder().encode('placeholder')],
    ['abcjs/abcjs-basic-min.js', new TextEncoder().encode('placeholder')]
  ]);
  let writes = 0, failed = false;
  const root = {
    async getFileHandle(name) { assert.equal(name, 'index.html'); return { async getFile() { return { async text() { return '<title>Local StackEdit Wiki</title><script src="src/renderer-installer.js"></script>'; } }; } }; },
    async getDirectoryHandle(name) { assert.equal(name, 'vendor'); return {
      async getDirectoryHandle(dir) { return {
        async getFileHandle(filename) { const key = `${dir}/${filename}`; return {
          async getFile() { const data = store.get(key); return { size: data.byteLength, async arrayBuffer() { return data.slice().buffer; } }; },
          async createWritable() { let written; return {
            async write(data) { written = new Uint8Array(data); },
            async close() { if (failSecond && key.startsWith('abcjs/') && !failed) { failed = true; throw new Error('Disk plný'); } store.set(key,written); writes++; },
            async abort() {}
          }; }
        }; }
      }; }
    }; }
  };
  return { root, store, get writes() { return writes; } };
}
const picked = () => [
  selected('mermaid.min.js', bytes('/* mermaidAPI initialize */', 120000)),
  selected('abcjs-basic-min.js', bytes('/* ABCJS renderAbc */', 70000))
];

test('Lokální import bez fetch skutečně zapíše dva vybrané soubory',async()=>{
  const mock=mockRoot(); let called=0;
  const result=await installFromFiles({ files:picked(), pickDirectory:async()=>mock.root,
    fetchFn:async()=>{called++;throw Error('No network');} });
  assert.deepEqual(Array.from(result.installed),['mermaid','abcjs']);
  assert.equal(called,0); assert.equal(mock.writes,2);
  assert.equal(mock.store.get('mermaid/mermaid.min.js').length,120000);
});

test('Odmítne neúplný výběr dřív než cokoliv zapíše',async()=>{
  const mock=mockRoot();
  await assert.rejects(installFromFiles({ files:picked().slice(0,1), pickDirectory:async()=>mock.root }),/Also select/);
  assert.equal(mock.writes,0);
});

test('Odmítne HTML odpověď přejmenovanou na JS soubor',async()=>{
  const mock=mockRoot();
  const files=picked(); files[1]=selected('abcjs-basic-min.js',bytes('<html>Blocked</html>',70000));
  await assert.rejects(installFromFiles({ files, pickDirectory:async()=>mock.root }),/did not return JavaScript/);
  assert.equal(mock.writes,0);
});

test('Odmítne náhodný JS soubor správné velikosti',async()=>{
  const mock=mockRoot();
  const files=picked(); files[1]=selected('abcjs-basic-min.js',bytes('/* unrelated fake */',70000));
  await assert.rejects(installFromFiles({ files, pickDirectory:async()=>mock.root }),/expected library API/);
  assert.equal(mock.writes,0);
});

test('Odmítne soubory s duplicitním názvem nebo neznámý soubor',async()=>{
  const mock=mockRoot();
  await assert.rejects(installFromFiles({ files:[...picked(),picked()[0]],pickDirectory:async()=>mock.root }),/twice/);
  await assert.rejects(installFromFiles({ files:[...picked(),selected('third-party.js',bytes('whatever',70000))],pickDirectory:async()=>mock.root }),/Unknown file/);
  assert.equal(mock.writes,0);
});

test('Opraví pouze chybějící knihovnu, přítomnou nepřepisuje',async()=>{
  const mock=mockRoot({alreadyMermaid:true});
  const result=await installFromFiles({ files:picked().slice(1), pickDirectory:async()=>mock.root });
  assert.deepEqual(Array.from(result.installed),['abcjs']);
  assert.deepEqual(Array.from(result.skipped),['mermaid']);
  assert.equal(mock.writes,1);
});

test('Při chybě druhého zápisu obnoví původní data',async()=>{
  const mock=mockRoot({failSecond:true});
  await assert.rejects(installFromFiles({ files:picked(),pickDirectory:async()=>mock.root }),/restored/);
  assert.equal(new TextDecoder().decode(mock.store.get('mermaid/mermaid.min.js')), 'placeholder');
  assert.equal(new TextDecoder().decode(mock.store.get('abcjs/abcjs-basic-min.js')), 'placeholder');
});

test('Chybný SHA-512 Mermaid se odmítne bez zápisu',async()=>{
  const mock=mockRoot();
  await assert.rejects(installFromFiles({ files:picked(),pickDirectory:async()=>mock.root,
    verify:async(bytes,spec)=>{ if(spec.id==='mermaid') await sandbox.LocalWikiRendererInstaller.checkIntegrity(bytes,spec,webcrypto.subtle); }
  }),/SHA-512/);
  assert.equal(mock.writes,0);
});
