const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/recent-wiki.js'), 'utf8');
const scopeSource = fs.readFileSync(path.join(__dirname, '../src/instance-scope.js'), 'utf8');

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
function load(storage = makeFakeIndexedDB(), tabSession = null) {
  const context = { indexedDB: storage, location: {href:'file:///install-A/index.html'} };
  if(tabSession)context.sessionStorage=tabSession;
  vm.runInNewContext(scopeSource, context);
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
  await assert.rejects(recent.remember({kind:'file'}), /directory/);
  const blocked = load(undefined); // default fake DB is available
  assert.ok(blocked);
  const noStorage = load(null);
  await assert.rejects(noStorage.restoreHandle(), /IndexedDB/);
});

test('independent tabs using the same index.html remember different folders', async () => {
  const db = makeFakeIndexedDB();
  function tab() {
    const storage=new Map();
    return {getItem:key=>storage.get(key)||null,setItem:(key,value)=>{storage.set(key,value);}};
  }
  const tabOne=tab(),tabTwo=tab();
  const a=load(db,tabOne),b=load(db,tabTwo);
  const first=handle(true),second=handle(true);
  first.name='First wiki';second.name='Second wiki';
  assert.equal(await b.restoreHandle(),null);
  await a.remember(first);
  assert.equal(await a.restoreHandle(),first);
  assert.equal(await b.restoreHandle(),null);
  await b.remember(second);
  assert.equal(await a.restoreHandle(),first);
  assert.equal(await b.restoreHandle(),second);
  const reloadedA=load(db,tabOne),reloadedB=load(db,tabTwo);
  assert.equal(await reloadedA.restoreHandle(),first);
  assert.equal(await reloadedB.restoreHandle(),second);
  await reloadedA.forget();
  assert.equal(await reloadedA.restoreHandle(),null);
  assert.equal(await reloadedB.restoreHandle(),second);
});

test('recent folder menu keeps newest eight handles while tab bookmarks remain independent', async () => {
  const db=makeFakeIndexedDB();
  const recent=load(db);
  for(let i=0;i<10;i++){
    const item=handle(true);item.name='Wiki '+i;
    await recent.remember(item);
  }
  const list=await recent.recentFolders();
  assert.equal(list.length,8);
  assert.equal(list[0].name,'Wiki 9');
  assert.equal(list[7].name,'Wiki 2');
  await recent.remember(list[4].handle);
  const reordered=await recent.recentFolders();
  assert.equal(reordered[0].name,list[4].name);
  assert.equal(new Set(reordered.map(x=>x.name)).size,reordered.length);
  assert.equal(await recent.restoreHandle(),list[4].handle);
});
