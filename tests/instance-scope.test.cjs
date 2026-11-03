const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scopeSource = fs.readFileSync(path.join(__dirname, '../src/instance-scope.js'), 'utf8');
const recentSource = fs.readFileSync(path.join(__dirname, '../src/recent-wiki.js'), 'utf8');
function scoped(url) {
  const context = { location: { href: url }};
  vm.runInNewContext(scopeSource, context);
  return context.LocalWikiScope;
}
test('two file:// installations never share localStorage or IndexedDB names', () => {
  const a = scoped('file:///C:/app-A/index.html');
  const b = scoped('file:///C:/app-B/index.html');
  assert.notEqual(a.storageKey('local-wiki-theme'), b.storageKey('local-wiki-theme'));
  assert.notEqual(a.databaseName('local-stackedit-wiki-local-folders'), b.databaseName('local-stackedit-wiki-local-folders'));
  assert.notEqual(a.storageKey('local-wiki-sidebar-width'), b.storageKey('local-wiki-sidebar-width'));
});
test('same copy retains settings across query and hash navigation', () => {
  const a = scoped('file:///C:/app-A/index.html?source=1#notes');
  const b = scoped('file:///C:/app-A/index.html');
  assert.equal(a.storageKey('local-wiki-theme'), b.storageKey('local-wiki-theme'));
  assert.equal(a.databaseName('local-stackedit-wiki-local-folders'), b.databaseName('local-stackedit-wiki-local-folders'));
});
test('legacy global names are never reused and location scoping works for HTTPS installs too', () => {
  const a = scoped('https://wiki.local/install-a/index.html');
  const b = scoped('https://wiki.local/install-b/index.html');
  assert.notEqual(a.databaseName('local-stackedit-wiki-local-folders'), 'local-stackedit-wiki-local-folders');
  assert.notEqual(a.databaseName('local-stackedit-wiki-local-folders'), b.databaseName('local-stackedit-wiki-local-folders'));
  assert.notEqual(a.storageKey('local-wiki-theme'), 'local-wiki-theme');
});
test('bookmark reads the scoped database, not the old globally named database', async () => {
  const names = [];
  const context = {location: {href:'file:///users/testing/wiki/index.html'}, indexedDB: {open(name) { names.push(name); throw new Error('Intentional stop'); }}};
  vm.runInNewContext(scopeSource, context);
  vm.runInNewContext(recentSource, context);
  await assert.rejects(context.LocalWikiRecent.restoreHandle(), /Intentional stop/);
  assert.equal(names.length, 1);
  assert.equal(names[0], context.LocalWikiScope.databaseName('local-stackedit-wiki-local-folders'));
});
