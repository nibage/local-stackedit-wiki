const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/file-system.js'), 'utf8');

class Directory {
  constructor(name, entries = [], failing = false) {
    this.kind = 'directory'; this.name = name; this.entries = entries; this.failing = failing;
  }
  async *values() {
    if (this.failing) throw new DOMException('Přístup odepřen', 'NotAllowedError');
    for (const e of this.entries) yield e;
  }
}
const note = name => ({kind:'file', name});
const image = name => ({kind:'file', name});
function bridge(root) {
  const w = {window:null, showDirectoryPicker:async()=>root, setTimeout, TextDecoder, TextEncoder, console};
  w.window = w;
  vm.runInNewContext(source, w);
  return w.LocalWikiFS.createBridge();
}

test('large nested wiki opens, reports progress and ignores non-wiki support folders', async () => {
  const branches = [];
  for (let i=0; i<20; i++) {
    branches.push(new Directory(`Knowledge-${i}`, Array.from({length:80}, (_,n) => note(`note-${n}.md`))));
  }
  const root = new Directory('knowledge-base', [
    new Directory('.obsidian', [], true),
    new Directory('.GIT', [], true),
    new Directory('.github', [], true),
    new Directory('node_modules', [], true),
    new Directory('apps-script', [note('manifest.json'), note('Code.gs')]),
    ...branches,
    image('diagram.png')
  ]);
  const api = bridge(root);
  const progress = [];
  const result = await api.openWritable(p => progress.push(p));
  assert.equal(result.scanInfo.files, 1600);
  assert.equal(result.scanInfo.skipped, 0);
  assert.equal(api.getFilePaths().length, 1600);
  assert.equal(result.tree.children.length, 22);
  assert.equal(result.tree.children[21].kind, 'image');
  assert.ok(progress.length >= 3, `progress events: ${progress.length}`);
  assert.equal(progress.at(-1).files, 1600);
});

test('inaccessible child is skipped but accessible sibling and nested file remain', async () => {
  const root = new Directory('wiki', [
    new Directory('locked', [], true),
    new Directory('safe', [note('readme.md'), new Directory('nested', [note('a.md')])]),
    new Directory('also-locked', [], true)
  ]);
  const result = await bridge(root).openWritable();
  assert.equal(result.scanInfo.files, 2);
  assert.equal(result.scanInfo.skipped, 2);
  assert.equal(result.scanInfo.skippedPaths.join(','), 'also-locked,locked');
  assert.equal(result.tree.children.map(x=>x.name).join(','), 'safe');
});

test('cannot read root: fails visibly and does not silently open empty wiki', async () => {
  const api = bridge(new Directory('wiki', [], true));
  await assert.rejects(() => api.openWritable(), /Cannot read root folder/);
  assert.equal(api.getMode(), 'none');
});
