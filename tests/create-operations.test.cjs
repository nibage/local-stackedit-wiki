const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'file-system.js'), 'utf8');
class MockFile {
  constructor(name, value = '') { this.name = name; this.kind = 'file'; this.body = value; this.lastModified = 200; }
  async getFile() { const data = Buffer.from(this.body); return { size: data.length, lastModified: this.lastModified, text: async () => data.toString('utf8'), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) }; }
  async createWritable() { return { write: async v => { this.next = v; }, close: async () => { this.body = this.next; this.lastModified++; }, abort: async () => {} }; }
}
class MockDir {
  constructor(name, entries = []) { this.name = name; this.kind = 'directory'; this.entries = new Map(entries.map(x => [x.name, x])); }
  async *values() { yield* this.entries.values(); }
  async getDirectoryHandle(name, { create = false } = {}) {
    const found = this.entries.get(name);
    if (found) { if (found.kind !== 'directory') throw Error('not directory'); return found; }
    if (!create) throw Error('not found');
    const dir = new MockDir(name); this.entries.set(name, dir); return dir;
  }
  async getFileHandle(name, { create = false } = {}) {
    const found = this.entries.get(name);
    if (found) { if (found.kind !== 'file') throw Error('not file'); return found; }
    if (!create) throw Error('not found');
    const f = new MockFile(name); this.entries.set(name, f); return f;
  }
}
function setup(root) {
  const win = { showDirectoryPicker: async () => root, console, TextDecoder, TextEncoder };
  win.window = win;
  vm.runInNewContext(source, win, { filename: 'file-system.js' });
  return win.LocalWikiFS.createBridge();
}
test('creates Markdown under existing folder and remains editable', async () => {
  const dir = new MockDir('Wiki', [new MockDir('Poznámky')]);
  const bridge = setup(dir);
  await bridge.openWritable();
  assert.equal(await bridge.createFile('Poznámky/Něco'), 'Poznámky/Něco.md');
  assert.deepEqual(Array.from(bridge.getFilePaths()), ['Poznámky/Něco.md']);
  const { fingerprint, text } = await bridge.read('Poznámky/Něco.md');
  assert.equal(text, '');
  await bridge.write('Poznámky/Něco.md', '# Test\n', fingerprint);
  assert.equal((await bridge.read('Poznámky/Něco.md')).text, '# Test\n');
});
test('creates a directory then a document inside, scanning the tree', async () => {
  const bridge = setup(new MockDir('Wiki'));
  await bridge.openWritable();
  assert.equal(await bridge.createDirectory('Kapitoly'), 'Kapitoly');
  assert.equal(await bridge.createFile('Kapitoly/Příklad.markdown'), 'Kapitoly/Příklad.markdown');
  assert.equal(bridge.getTree().children[0].children[0].name, 'Příklad.markdown');
});
test('rejects existing filenames, case collision and missing parent', async () => {
  const root = new MockDir('Wiki', [new MockFile('One.md', 'IMPORTANT')]);
  const bridge = setup(root); await bridge.openWritable();
  await assert.rejects(() => bridge.createFile('One.md'), /existuje/);
  await assert.rejects(() => bridge.createFile('one.MD'), /existuje/);
  await assert.rejects(() => bridge.createFile('Missing/new.md'), /neexistuje/);
  assert.equal(root.entries.get('One.md').body, 'IMPORTANT');
});
test('prevents escapes, reserved directories, invalid extensions and absolute paths', async () => {
  const bridge = setup(new MockDir('Wiki')); await bridge.openWritable();
  for (const input of ['../hack.md', 'safe/../hack.md', '/tmp/hack.md', '.obsidian/config.md', '.OBSIDIAN/config.md', 'x.txt', 'CON.md', 'hello//world.md', 'x/']) {
    await assert.rejects(() => bridge.createFile(input), undefined, input);
  }
  await assert.rejects(() => bridge.createDirectory('../secret'), /nepovolený/);
  assert.equal(bridge.getFilePaths().length, 0);
});
test('does not allow writes in read-only mode', async () => {
  const bridge = setup(new MockDir('Wiki'));
  bridge.openReadOnly([{name:'A.md',webkitRelativePath:'Wiki/A.md',text:async()=>''}]);
  await assert.rejects(() => bridge.createFile('B.md'), /oprávnění/);
  await assert.rejects(() => bridge.createDirectory('Nová'), /oprávnění/);
});
