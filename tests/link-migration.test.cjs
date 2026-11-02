const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const dir = path.join(__dirname, '..', 'src');
const ctx = { TextDecoder, TextEncoder, Uint8Array, Set, Map };
ctx.window = ctx;
for (const name of ['file-system.js','wiki-index.js','link-migration.js']) vm.runInNewContext(fs.readFileSync(path.join(dir, name), 'utf8'), ctx);
const plan = (files, from, to) => ctx.LocalWikiMigration.plan(new Map(Object.entries(files).map(([p, text]) => [p, {text,fingerprint:'1'}])), from,to);
const changed = (p, file) => p.changes.find(c => c.oldPath === file)?.after;
test('rewrites incoming Markdown links, anchors, title and wikilinks while preserving aliases', () => {
  const p = plan({'Docs/A.md':'# A', 'B.md': '[x](Docs/A.md#part "Title") and [[Docs/A|Alias]] and [[A#H|Show]]'}, 'Docs/A.md', 'Docs/Renamed.md');
  assert.equal(changed(p,'B.md'), '[x](Docs/Renamed.md#part "Title") and [[Docs/Renamed|Alias]] and [[Docs/Renamed#H|Show]]');
  assert.equal(p.totalLinks, 3);
});
test('moving note keeps outgoing relative links to other notes', () => {
  const p=plan({'A.md':'[Other](Sub/B.md) [[Sub/B|wiki]]', 'Sub/B.md':'# B', 'Docs/C.md':'# C'},'A.md','Docs/A.md');
  assert.equal(changed(p,'A.md'), '[Other](../Sub/B.md) [[Sub/B|wiki]]');
});
test('untouched references stay untouched, including web and code samples', () => {
  const text='[ok](A.md) [web](https://example.com/A.md)\n```md\n[A](A.md)\n[[A]]\n```\n`[A](A.md)`';
  const p=plan({'A.md':'# A','Index.md':text}, 'A.md','Sub/A.md');
  assert.equal(changed(p,'Index.md'), text.replace('[ok](A.md)','[ok](Sub/A.md)'));
});
test('retains BOM, CRLF and rewrites reference-style URL destinations', () => {
  const text='\ufeff[link][id]\r\n[id]: A.md "T"\r\n';
  const p=plan({'A.md':'A', 'Index.md':text}, 'A.md','B.md');
  assert.equal(changed(p,'Index.md'), '\ufeff[link][id]\r\n[id]: B.md "T"\r\n');
});
test('ambiguous wikilinks are not guessed', () => {
  const p=plan({'Docs/C.md':'# C', 'Sub/C.md':'# other', 'Ref.md':'[[C]]'},'Docs/C.md','Docs/B.md');
  assert.equal(p.totalLinks,0);
  assert.equal(p.changes.length,0);
});
test('encoded spaces and nonascii paths remain addressable', () => {
  const p=plan({'Moje poznámka.md':'# Hi','A.md':'[X](Moje%20pozn%C3%A1mka.md)'},'Moje poznámka.md','České věci.md');
  assert.equal(changed(p,'A.md'),'[X](%C4%8Cesk%C3%A9%20v%C4%9Bci.md)');
});
test('if moving a note with a wikilink resolves naturally, preserve its exact spelling', () => {
  const p=plan({'A.md':'[[B]]','B.md':'# B','Folder/X.md':'#X'},'A.md','Folder/A.md');
  assert.equal(p.totalLinks,0);
});
