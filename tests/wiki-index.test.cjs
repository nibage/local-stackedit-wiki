const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const window = {};
for (const src of ['file-system.js', 'wiki-index.js']) vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '..', 'src', src), 'utf8'), { window, globalThis: window, console });
const { createIndex, links, targetFor } = window.LocalWikiIndex;
const docs = new Map([
  ['index.md', '# Domů\n\nOdkaz na [Python](Programovani/Python.md).\n'],
  ['Programovani/Python.md', '# Python\n\nPříklad s čárkou: žluťoučký kůň\n\n[[../index|Domů]]'],
  ['Programovani/JS.md', '# JavaScript\n\n[[Python]]\n']
]);
const bridge = { getFilePaths: () => [...docs.keys()], read: async p => ({ text: docs.get(p) }) };
test('indexuje a hledá české výrazy bez diakritiky', async () => {
  const index = createIndex(bridge); const progress=[];
  const result=await index.rebuild((i, total) => progress.push([i,total]));
  assert.equal(result.indexed,3); assert.equal(progress.length,3);
  const match=index.search('zlutoucky kun');
  assert.equal(match.length,1); assert.equal(match[0].path,'Programovani/Python.md');
  assert.equal(match[0].line,3);
});
test('backlinks: Markdown i Obsidian odkazy, změny v editoru', async () => {
  const index=createIndex(bridge); await index.rebuild();
  assert.deepEqual(Array.from(index.backlinks('Programovani/Python.md')).sort(), ['Programovani/JS.md','index.md'].sort());
  index.update('index.md','# domů');
  assert.deepEqual(Array.from(index.backlinks('Programovani/Python.md')),['Programovani/JS.md']);
});
test('wiki target je jednoznačný a bezpečně řeší cesty', () => {
  const all = new Set(docs.keys());
  assert.equal(targetFor('wiki:Python', 'Programovani/JS.md', all),'Programovani/Python.md');
  assert.equal(targetFor('Programovani/Python.md', 'index.md', all),'Programovani/Python.md');
  assert.equal(targetFor('../../secret.md', 'index.md', all),null);
  assert.equal(targetFor('javascript:alert(1)', 'index.md', all),null);
  assert.equal(targetFor('wiki:Python','Other/Note.md',new Set([...all,'Python.md'])),null);
});
test('nevyhledává odkazy uvnitř bloků kódu', () => {
  const arr=links('```md\n[[neexistuje]]\n```\n[[Python]]\n[Odkaz](index.md)');
  assert.deepEqual(Array.from(arr),['wiki:Python','index.md']);
});
