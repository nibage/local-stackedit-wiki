const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.join(__dirname, '../src/file-system.js'), 'utf8');
class Directory {
  constructor(name, entries = [], failing = false) {
    this.kind = 'directory'; this.name = name; this.entries = entries; this.failing = failing;
  }
  async *values() {
    if (this.failing) throw new DOMException('Permission denied', 'NotAllowedError');
    for (const entry of this.entries) yield entry;
  }
}
const note = name => ({kind: 'file', name});
function bridge(root) {
  const win = {showDirectoryPicker: async () => root, TextDecoder, TextEncoder, setTimeout, console};
  win.window = win;
  vm.runInNewContext(script, win, {filename: 'file-system.js'});
  return win.LocalWikiFS.createBridge();
}
test('large wiki root opens with progress, skipping .obsidian and .git', async () => {
  const dirs = Array.from({length: 20}, (_, n) =>
    new Directory('Folder' + n, Array.from({length: 80}, (_, i) => note('note' + i + '.md'))));
  const root = new Directory('wiki', [
    new Directory('.obsidian', [], true), new Directory('.GIT', [], true),
    new Directory('apps-script', [note('Code.gs')]), ...dirs
  ]);
  const events = [];
  const api = bridge(root);
  const result = await api.openWritable(info => events.push(info));
  assert.equal(result.scanInfo.files, 1600);
  assert.equal(result.scanInfo.skipped, 0);
  assert.equal(api.getFilePaths().length, 1600);
  assert.ok(events.length >= 3);
  assert.equal(events.at(-1).files, 1600);
});
test('one unreadable child does not abort accessible Markdown folders', async () => {
  const root = new Directory('wiki', [
    new Directory('locked', [], true),
    new Directory('safe', [note('readme.md'), new Directory('nested', [note('a.md')])])
  ]);
  const api = bridge(root);
  const result = await api.openWritable();
  assert.equal(result.scanInfo.files, 2);
  assert.equal(result.scanInfo.skipped, 1);
  assert.equal(result.scanInfo.skippedPaths[0], 'locked');
  assert.equal(api.getFilePaths().length, 2);
});
test('unreadable root reports failure instead of silently opening empty wiki', async () => {
  const api = bridge(new Directory('wiki', [], true));
  await assert.rejects(() => api.openWritable(), /Kořenovou složku nelze přečíst/);
  assert.equal(api.getMode(), 'none');
});
