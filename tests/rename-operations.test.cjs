const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'file-system.js'), 'utf8');
class MockFile {
  constructor(name, text = '') {
    this.kind = 'file'; this.name = name; this.bytes = Buffer.from(text); this.lastModified = 100;
    this.failWrite = false; this.onClose = null;
  }
  async getFile() {
    const copy = Buffer.from(this.bytes);
    return { size: copy.length, lastModified: this.lastModified,
      text: async () => copy.toString('utf8'),
      arrayBuffer: async () => copy.buffer.slice(copy.byteOffset, copy.byteOffset + copy.byteLength) };
  }
  async createWritable() {
    if (this.failWrite) throw Error('cannot write');
    return { write: async (data) => { this.pending = Buffer.from(data); },
      close: async () => { this.bytes = this.pending; this.lastModified++; if (this.onClose) this.onClose(); },
      abort: async () => {} };
  }
}
class MockDir {
  constructor(name, entries = []) {
    this.name = name; this.kind = 'directory'; this.entries = new Map(entries.map(e => [e.name, e]));
    this.failDelete = false; this.newFileHook = null;
  }
  async *values() { yield* this.entries.values(); }
  async getDirectoryHandle(name, {create = false} = {}) {
    const found = this.entries.get(name);
    if (found) { if (found.kind !== 'directory') throw Error('wrong kind'); return found; }
    if (!create) throw Error('not found');
    const dir = new MockDir(name); this.entries.set(name, dir); return dir;
  }
  async getFileHandle(name, {create = false} = {}) {
    const found = this.entries.get(name);
    if (found) { if (found.kind !== 'file') throw Error('wrong kind'); return found; }
    if (!create) throw Error('not found');
    const f = new MockFile(name); this.entries.set(name, f);
    if (this.newFileHook) this.newFileHook(f);
    return f;
  }
  async removeEntry(name) { if (this.failDelete) throw Error('delete denied'); this.entries.delete(name); }
}
const setup = async root => {
  const global = {showDirectoryPicker: async () => root, TextDecoder, TextEncoder};
  global.window = global;
  vm.runInNewContext(src, global);
  const bridge = global.LocalWikiFS.createBridge();
  await bridge.openWritable();
  return bridge;
};
test('renames .md without changing bytes (UTF-8 BOM and CRLF)', async () => {
  const bytes = '\ufeff# Žluťoučký\r\nline\r\n';
  const root = new MockDir('Wiki', [new MockFile('Starý.md', bytes)]);
  const bridge = await setup(root);
  const fp = (await bridge.read('Starý.md')).fingerprint;
  assert.equal(await bridge.renameFile('Starý.md', 'Nový.md', fp), 'Nový.md');
  assert.equal(root.entries.has('Starý.md'), false);
  assert.equal(root.entries.get('Nový.md').bytes.toString(), bytes);
  assert.deepEqual(Array.from(bridge.getFilePaths()), ['Nový.md']);
});
test('moves a note to existing nested folder', async () => {
  const root = new MockDir('Wiki', [new MockFile('A.md', '# A'), new MockDir('Pod', [new MockDir('Další')])]);
  const bridge = await setup(root);
  const fp = (await bridge.read('A.md')).fingerprint;
  assert.equal(await bridge.renameFile('A.md', 'Pod/Další/B.md', fp), 'Pod/Další/B.md');
  assert.equal(root.entries.has('A.md'), false);
  assert.equal((await bridge.read('Pod/Další/B.md')).text, '# A');
});
test('blocks collisions, escapes, invalid folders, case-insensitive names', async () => {
  const root = new MockDir('Wiki', [new MockFile('A.md', 'A'), new MockFile('B.md', 'B')]);
  const bridge = await setup(root);
  const fp = (await bridge.read('A.md')).fingerprint;
  for (const dest of ['B.md', 'b.MD', '../C.md', '.obsidian/C.md', 'missing/C.md', '/tmp/C.md', 'C.html']) {
    await assert.rejects(() => bridge.renameFile('A.md', dest, fp), undefined, dest);
  }
  assert.equal((await bridge.read('A.md')).text, 'A');
  assert.equal((await bridge.read('B.md')).text, 'B');
});
test('blocks move if source was externally edited', async () => {
  const root = new MockDir('Wiki', [new MockFile('A.md', 'A')]);
  const bridge = await setup(root);
  const fp = (await bridge.read('A.md')).fingerprint;
  root.entries.get('A.md').bytes = Buffer.from('NEW');
  root.entries.get('A.md').lastModified++;
  await assert.rejects(() => bridge.renameFile('A.md', 'B.md', fp), /changed/);
  assert.equal(root.entries.has('B.md'), false);
});
test('write failure rolls back target and preserves original', async () => {
  const srcFile = new MockFile('A.md', 'IMPORTANT');
  const root = new MockDir('Wiki', [srcFile]);
  root.newFileHook = f => { f.failWrite = true; };
  const bridge = await setup(root);
  const fp = (await bridge.read('A.md')).fingerprint;
  await assert.rejects(() => bridge.renameFile('A.md', 'B.md', fp), /cannot write/);
  assert.equal(root.entries.has('B.md'), false);
  assert.equal(root.entries.get('A.md').bytes.toString(), 'IMPORTANT');
});
test('failed source deletion preserves both copies and reports recovery', async () => {
  const srcFile = new MockFile('A.md', 'IMPORTANT');
  const root = new MockDir('Wiki', [srcFile]);
  root.failDelete = true;
  const bridge = await setup(root);
  const fp = (await bridge.read('A.md')).fingerprint;
  await assert.rejects(() => bridge.renameFile('A.md', 'B.md', fp), /Both copies/);
  assert.equal(root.entries.get('A.md').bytes.toString(), 'IMPORTANT');
  assert.equal(root.entries.get('B.md').bytes.toString(), 'IMPORTANT');
  assert.equal(bridge.hasFile('B.md'), true);
});
test('source changed mid-copy: preserve both copies for manual recovery', async () => {
  const srcFile = new MockFile('A.md', 'FIRST');
  const root = new MockDir('Wiki', [srcFile]);
  root.newFileHook = target => { target.onClose = () => { srcFile.bytes = Buffer.from('SECOND'); srcFile.lastModified++; }; };
  const bridge = await setup(root);
  const fp = (await bridge.read('A.md')).fingerprint;
  await assert.rejects(() => bridge.renameFile('A.md', 'B.md', fp), /Both copies/);
  assert.equal(root.entries.get('A.md').bytes.toString(), 'SECOND');
  assert.equal(root.entries.get('B.md').bytes.toString(), 'FIRST');
});
