/* An optional directory-handle bookmark, stored ONLY in this browser's IndexedDB.
 * Never stores wiki contents, filenames, or any remote data.
 * File System Access permissions remain under browser/user control.
 */
(function (global) {
  'use strict';
  // Separate IndexedDB for each location of index.html, even with shared file:// origin.
  // Deliberately do not migrate legacy global bookmark data from another installation.
  const DB_NAME = global.LocalWikiScope.databaseName('local-stackedit-wiki-local-folders');
  const STORE_NAME = 'bookmarks';
  // One browser tab may browse an entirely different wiki than another,
  // even if both use the same index.html. Give each tab its own bookmark key.
  // sessionStorage survives refresh / tab restoration, but is not shared
  // between independently opened tabs. The DB holds handles, not note text.
  function tabBookmarkKey(){
    const key=global.LocalWikiScope.storageKey('tab-bookmark-identity');
    try {
      if(!global.sessionStorage)return 'last-directory'; // Old test/browser fallback
      let id=global.sessionStorage.getItem(key);
      if(!id){
        id=typeof global.crypto?.randomUUID==='function'?
          global.crypto.randomUUID():
          String(Date.now())+'-'+String(Math.random()).slice(2);
        global.sessionStorage.setItem(key,id);
      }
      return 'last-directory@'+id;
    }catch(_){return 'last-directory';}
  }
  const ENTRY = tabBookmarkKey();

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error('IndexedDB is unavailable.')); return; }
      let req;
      try { req = global.indexedDB.open(DB_NAME, 1); }
      catch (err) { reject(err); return; }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) req.result.createObjectStore(STORE_NAME);
      };
      req.onerror = () => reject(req.error || new Error('Cannot open IndexedDB.'));
      req.onsuccess = () => resolve(req.result);
      req.onblocked = () => reject(new Error('Storage is blocked by another open tab.'));
    });
  }
  async function transaction(mode, operation) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      let settled = false;
      let tx;
      try {
        tx = db.transaction(STORE_NAME, mode);
        const request = operation(tx.objectStore(STORE_NAME));
        let value;
        request.onsuccess = () => { value = request.result; };
        request.onerror = () => {
          if (!settled) { settled = true; reject(request.error || new Error('Saved folder operation failed.')); }
        };
        tx.oncomplete = () => { if (!settled) { settled = true; resolve(value); } db.close(); };
        tx.onabort = tx.onerror = () => {
          if (!settled) { settled = true; reject(tx.error || new Error('Could not update the saved folder selection.')); }
          db.close();
        };
      } catch (err) { db.close(); reject(err); }
    });
  }
  function isDirectory(handle) {
    return !!handle && handle.kind === 'directory' && typeof handle.values === 'function';
  }
  async function remember(handle) {
    if (!isDirectory(handle)) throw new Error('Only a selected directory can be remembered.');
    // FileSystemDirectoryHandle is structured-cloneable in supporting Chrome/Edge.
    return transaction('readwrite', store => store.put(handle, ENTRY));
  }
  async function restoreHandle() {
    let h = await transaction('readonly', store => store.get(ENTRY));
    // One-way compatibility read from the old single-tab bookmark. Never
    // write to that record: after choosing a folder, each tab keeps its own.
    if(!h && ENTRY!=='last-directory')
      h=await transaction('readonly',store=>store.get('last-directory'));
    if (!h) return null;
    if (!isDirectory(h)) throw new Error('Saved folder is invalid. Choose it again.');
    return h;
  }
  function forget() { return transaction('readwrite', store => store.delete(ENTRY)); }
  async function ensurePermission(handle, prompt = false, readOnly = false) {
    if (!isDirectory(handle)) return false;
    if (typeof handle.queryPermission !== 'function') return false;
    const options = { mode: readOnly ? 'read' : 'readwrite' };
    if (await handle.queryPermission(options) === 'granted') return true;
    if (prompt && typeof handle.requestPermission === 'function') {
      return await handle.requestPermission(options) === 'granted';
    }
    return false;
  }
  global.LocalWikiRecent = { remember, restoreHandle, forget, ensurePermission };
})(typeof window !== 'undefined' ? window : globalThis);
