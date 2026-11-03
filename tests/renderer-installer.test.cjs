const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/renderer-installer.js'), 'utf8');
const mermaidDigest = '6Wa+B9B3RYe0RtUPHHpg6RTnDBMLUq1hdoJtNJfkfNOaipetnb30xQPd1nTQDBMF0dt7lOb3XmAq62Dqqr57Zw==';
const context = { TextDecoder, ArrayBuffer, Uint8Array, btoa,
  crypto: { subtle: { async digest() { return Uint8Array.from(Buffer.from(mermaidDigest, 'base64')).buffer; } } }
};
vm.runInNewContext(source, context);
const installer = context.LocalWikiRendererInstaller;

function setup({ valid = true, already = false, failOnWrite = false, failSecondWrite = false } = {}) {
  let failedSecond = false;
  const written = new Map();
  const files = new Map([
    ['mermaid/mermaid.min.js', new TextEncoder().encode('/* placeholder */')],
    ['abcjs/abcjs-basic-min.js', new TextEncoder().encode('/* placeholder */')]
  ]);
  function mockBytes(id, size) {
    const bytes = new Uint8Array(size).fill(65);
    bytes.set(new TextEncoder().encode(id === 'mermaid' ? '/* mermaidAPI initialize */' : '/* ABCJS renderAbc */'), 0);
    return bytes;
  }
  if (already) {
    files.set('mermaid/mermaid.min.js', mockBytes('mermaid', 120000));
    files.set('abcjs/abcjs-basic-min.js', mockBytes('abcjs', 60000));
  }
  function fileHandle(filename) {
    return {
      async getFile() {
        const data = files.get(filename);
        return { size: data.length, async text() { return new TextDecoder().decode(data); }, async arrayBuffer() { return data.slice().buffer; } };
      },
      async createWritable() {
        let bytes;
        return {
          async write(data) { bytes = new Uint8Array(data); },
          async close() {
            if (failOnWrite || (failSecondWrite && filename.includes('abcjs') && !failedSecond)) {
              failedSecond = true;
              throw Error('Disk plný');
            }
            files.set(filename, bytes);
            written.set(filename, bytes);
          },
          async abort() {}
        };
      }
    };
  }
  const vendor = {
    async getDirectoryHandle(dir, opts) {
      assert.equal(opts.create, false);
      if (!['mermaid','abcjs'].includes(dir)) throw Error('not found');
      return {
        async getFileHandle(filename, options) {
          assert.equal(options.create, false);
          return fileHandle(`${dir}/${filename}`);
        }
      };
    }
  };
  const root = {
    async getFileHandle(name, opts) {
      assert.equal(name, 'index.html');
      assert.equal(opts.create, false);
      return { async getFile() { return { async text() {
        return valid ? '<title>Local StackEdit Wiki</title><script src="src/renderer-installer.js"></script>' : 'Some other index.html';
      } }; } };
    },
    async getDirectoryHandle(name, opts) {
      assert.equal(name, 'vendor');
      assert.equal(opts.create, false);
      return vendor;
    }
  };
  let fetched = [];
  const fetchFn = async url => {
    fetched.push(url);
    const isMermaid = url.includes('mermaid');
    const size = isMermaid ? 130000 : 65000;
    const bytes = mockBytes(isMermaid ? 'mermaid' : 'abcjs', size);
    return { ok: true, arrayBuffer: async () => bytes.buffer };
  };
  return { root, fetchFn, written, files, fetched };
}

test('Installs real-sized bytes only in picked application vendor, and verifies readback', async () => {
  const fake = setup();
  const progress = [];
  const result = await installer.install({
    pickDirectory: async opt => { assert.equal(opt.mode,'readwrite'); return fake.root; },
    fetchFn: fake.fetchFn,
    onProgress: s => progress.push(s)
  });
  assert.equal(result.installed.length, 2);
  assert.equal(fake.written.size, 2);
  assert.equal(fake.written.get('mermaid/mermaid.min.js').length, 130000);
  assert.equal(fake.written.get('abcjs/abcjs-basic-min.js').length, 65000);
  assert.ok(progress.at(-1).includes('offline'));
});

test('Rejects wrong directory without fetching or writing anything', async () => {
  const fake = setup({valid:false});
  await assert.rejects(installer.install({pickDirectory: async()=>fake.root,fetchFn:fake.fetchFn}), /does not match/);
  assert.equal(fake.written.size,0);
  assert.equal(fake.fetched.length,0);
});

test('Network failure before second download does not modify first placeholder', async () => {
  const fake = setup();
  const fetchFn = async url => { if (url.includes('abcjs')) throw Error('offline'); return fake.fetchFn(url); };
  await assert.rejects(installer.install({pickDirectory:async()=>fake.root,fetchFn}), /Download failed/);
  assert.equal(fake.written.size,0);
});

test('No overwrite for already installed distribution files', async () => {
  const fake = setup({already:true});
  const result = await installer.install({pickDirectory:async()=>fake.root,fetchFn:fake.fetchFn});
  assert.equal(result.installed.length,0);
  assert.equal(result.skipped.length,2);
  assert.equal(fake.written.size,0);
  assert.equal(fake.fetched.length,0);
});

test('Rejects HTML masquerading as JavaScript', () => {
  const spec = installer.SPECS[0];
  const bytes = new TextEncoder().encode('<html>error</html>'.padEnd(spec.minBytes+1));
  assert.throws(() => installer.validatePayload(bytes.buffer, spec), /did not return JavaScript/);
});

test('Abort after failed write; do not falsely report success', async () => {
  const fake = setup({failOnWrite:true});
  await assert.rejects(installer.install({pickDirectory:async()=>fake.root,fetchFn:fake.fetchFn}),/Disk plný/);
  assert.equal(fake.written.size,0);
});


test('If primary CDN is down, fallback fetches the same pinned version', async () => {
  const fake = setup();
  const requested = [];
  const fetchFn = async url => {
    requested.push(url);
    if (url.startsWith('https://cdnjs.cloudflare.com/')) throw Error('Primary offline');
    return fake.fetchFn(url);
  };
  const status = [];
  const result = await installer.install({
    pickDirectory: async () => fake.root, fetchFn, onProgress: message => status.push(message)
  });
  assert.deepEqual(Array.from(result.installed), ['mermaid', 'abcjs']);
  assert.equal(fake.written.size, 2);
  assert.equal(requested.length, 4);
  assert.ok(requested.some(url => url.includes('mermaid@8.9.2')));
  assert.ok(requested.some(url => url.includes('abcjs@6.4.4')));
  assert.equal(status.filter(s => s.includes('backup CDN')).length, 2);
});

test('Bad payload at primary CDN falls back without writing bad content', async () => {
  const fake = setup();
  const fetchFn = async url => {
    if (url.startsWith('https://cdnjs.cloudflare.com/')) {
      const bytes = new TextEncoder().encode('<html>error</html>'.padEnd(150000));
      return { ok: true, arrayBuffer: async () => bytes.buffer };
    }
    return fake.fetchFn(url);
  };
  const result = await installer.install({ pickDirectory: async () => fake.root, fetchFn });
  assert.equal(result.installed.length, 2);
  for (const bytes of fake.written.values()) assert.equal(bytes[0], 47);
});

test('All CDNs failing does not touch any placeholder or file', async () => {
  const fake = setup();
  const fetchFn = async () => { throw Error('offline'); };
  await assert.rejects(installer.install({ pickDirectory: async () => fake.root, fetchFn }), /all sources/);
  assert.equal(fake.written.size, 0);
  assert.equal(new TextDecoder().decode(fake.files.get('mermaid/mermaid.min.js')), '/* placeholder */');
  assert.equal(new TextDecoder().decode(fake.files.get('abcjs/abcjs-basic-min.js')), '/* placeholder */');
});


test('Rejects large garbage without exported API, not merely HTML', () => {
  const spec = installer.SPECS[1];
  const bytes = new Uint8Array(spec.minBytes + 100).fill(65);
  assert.throws(() => installer.validatePayload(bytes.buffer, spec), /expected library API/);
});

test('Rejects mismatched Mermaid SHA-512 against actual Web Crypto digest', async () => {
  const { webcrypto } = require('node:crypto');
  const bad = new TextEncoder().encode('/* mermaidAPI initialize */');
  await assert.rejects(installer.checkIntegrity(bad, installer.SPECS[0], webcrypto.subtle), /SHA-512/);
});

test('Rolls back first library when second library write fails', async () => {
  const fake = setup({ failSecondWrite: true });
  await assert.rejects(installer.install({ pickDirectory: async () => fake.root, fetchFn: fake.fetchFn }), /restored/);
  assert.equal(new TextDecoder().decode(fake.files.get('mermaid/mermaid.min.js')), '/* placeholder */');
  assert.equal(new TextDecoder().decode(fake.files.get('abcjs/abcjs-basic-min.js')), '/* placeholder */');
});
