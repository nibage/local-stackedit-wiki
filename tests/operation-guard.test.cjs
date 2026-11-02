const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'operation-guard.js'), 'utf8');
function make() {
  const ctx = {}; ctx.window = ctx;
  vm.runInNewContext(code, ctx);
  return ctx.LocalWikiOperationGuard.create();
}
test('latest asynchronous read supersedes older read', () => {
  const g = make();
  const one = g.beginRead();
  const two = g.beginRead();
  assert.equal(g.isCurrentRead(one), false);
  assert.equal(g.isCurrentRead(two), true);
});
test('disk mutation invalidates pending reads', () => {
  const g = make(); const old = g.beginRead();
  assert.equal(g.acquire('save'), true);
  assert.equal(g.isCurrentRead(old), false);
  assert.equal(g.beginRead(), null);
  assert.equal(g.acquire('rename'), false);
  assert.equal(g.currentOperation(), 'save');
  g.release('save');
  assert.equal(g.acquire('rename'), true);
  g.release('rename');
});
test('switching wiki cancels stale file reads', () => {
  const g = make(); const old = g.beginRead();
  g.invalidateReads();
  assert.equal(g.isCurrentRead(old), false);
  assert.equal(g.isCurrentRead(g.beginRead()), true);
});
test('incorrect mutation release must not unlock pending write', () => {
  const g = make();
  g.acquire('save');
  assert.throws(() => g.release('rename'));
  assert.equal(g.isBusy(), true);
  g.release('save');
  assert.equal(g.isBusy(), false);
});
