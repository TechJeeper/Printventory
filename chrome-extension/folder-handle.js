/**
 * Persist the Printventory folder (File System Access) and write inbox JSON there.
 */
(function (root) {
  'use strict';

  const DB_NAME = 'printventory-watcher';
  const STORE = 'handles';
  const KEY = 'printventoryDir';

  function openDb() {
    return new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function getDirectoryHandle() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }

  async function setDirectoryHandle(handle) {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, KEY);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function clearDirectoryHandle() {
    const db = await openDb();
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  async function ensureWritePermission(handle) {
    const opts = { mode: 'readwrite' };
    if (typeof handle.queryPermission === 'function') {
      const current = await handle.queryPermission(opts);
      if (current === 'granted') return true;
    }
    if (typeof handle.requestPermission === 'function') {
      return (await handle.requestPermission(opts)) === 'granted';
    }
    return true;
  }

  async function folderHasDatabase(handle) {
    try {
      await handle.getFileHandle('printventory.db');
      return true;
    } catch (e) {
      return false;
    }
  }

  async function writePayloadToFolder(payload) {
    const handle = await getDirectoryHandle();
    if (!handle) return { ok: false, reason: 'no-folder' };
    if (!(await ensureWritePermission(handle))) return { ok: false, reason: 'permission' };
    const inbox = await handle.getDirectoryHandle('PrintventoryInbox', { create: true });
    const name = String((payload && payload.id) || 'item') + '.pvimport.json';
    const file = await inbox.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return { ok: true, via: 'folder', filename: name, folderName: handle.name };
  }

  root.PrintventoryFolder = {
    getDirectoryHandle: getDirectoryHandle,
    setDirectoryHandle: setDirectoryHandle,
    clearDirectoryHandle: clearDirectoryHandle,
    ensureWritePermission: ensureWritePermission,
    folderHasDatabase: folderHasDatabase,
    writePayloadToFolder: writePayloadToFolder
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
