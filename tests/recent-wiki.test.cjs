const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/recent-wiki.js'), 'utf8');

function makeFakeIndexedDB() {
  const saved = new Map();
  let storeExists = false;
  const db = {
    objectStoreNames: { contains: () => storeExists },
    createObjectStore() { storeExists = true; },
    close() {},
    transaction() {
      const tx = { error: null };
      tx.objectStore = () => ({
        put(val, key) { return request(() => { saved.set(key, val); }); },
        get(key) { return request(() => saved.get(key)); },
        delete(key) { return request(() => { saved.delete(key); }); }
      });
      function request(fn) {
        const req = {};
        queueMicrotask(() => {
          req.result = fn();
          req.onsuccess?.();
          queueMicrotask(() => tx.oncomplete?.());
        });
        return req;
      }
      return tx;
    }
  };
  return {
    open() {
      const req = { result: db };
      queueMicrotask(() => { if (!storeExists) req.onupgradeneeded?.(); req.onsuccess?.(); });
      return req;
    }
  };
}
function load(storage = makeFakeIndexedDB()) {
  const context = { indexedDB: storage };
  vm.runInNewContext(source, context);
  return context.LocalWikiRecent;
}
function handle(allowed = false) {
  const state = { allowed, requests: 0 };
  return { kind: 'directory', name: 'Wiki', async *values() {}, state,
    async queryPermission() { return state.allowed ? 'granted' : 'prompt'; },
    async requestPermission() { state.requests++; return state.allowed ? 'granted' : 'denied'; }
  };
}
test('bookmark is opt-in, stores handle without contents, and can be forgotten', async () => {
  const recent = load();
  assert.equal(await recent.restoreHandle(), null);
  const h = handle(true);
  await recent.remember(h);
  assert.equal(await recent.restoreHandle(), h);
  await recent.forget();
  assert.equal(await recent.restoreHandle(), null);
});
test('no implicit permission prompt while checking saved directory', async () => {
  const recent = load();
  const h = handle(false);
  await recent.remember(h);
  assert.equal(await recent.ensurePermission(h), false);
  assert.equal(h.state.requests, 0);
  assert.equal(await recent.ensurePermission(h, true), false);
  assert.equal(h.state.requests, 1);
  h.state.allowed = true;
  assert.equal(await recent.ensurePermission(h), true);
  assert.equal(h.state.requests, 1);
});
test('rejects invalid handle and gracefully reports blocked storage', async () => {
  const recent = load();
  await assert.rejects(recent.remember({kind:'file'}), /složku/);
  const blocked = load(undefined); // default fake DB is available
  assert.ok(blocked);
  const noStorage = load(null);
  await assert.rejects(noStorage.restoreHandle(), /IndexedDB/);
});
