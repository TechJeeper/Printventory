'use strict';

function setFolderStatus(kind, text) {
  const el = document.getElementById('folderStatus');
  el.className = 'folder-status' + (kind ? ' ' + kind : '');
  el.textContent = text;
}

function refreshFolderStatus() {
  chrome.storage.local.get(
    { printventoryFolderConfigured: false, printventoryFolderName: '', printventoryFolderHasDb: false },
    (items) => {
      if (!items.printventoryFolderConfigured) {
        setFolderStatus('', 'No folder selected yet. Inbox files will go to Downloads until you choose one.');
        return;
      }
      const name = items.printventoryFolderName || 'selected folder';
      if (items.printventoryFolderHasDb) {
        setFolderStatus('ok', 'Using “' + name + '” (found printventory.db). Inbox: ' + name + '\\PrintventoryInbox');
      } else {
        setFolderStatus('warn', 'Using “' + name + '”, but printventory.db was not in that folder. Printventory must watch this same path, or pick the data folder that contains the database.');
      }
    }
  );
}

async function chooseFolder() {
  if (!window.showDirectoryPicker) {
    setFolderStatus('err', 'This browser cannot pick a folder. Use Chrome or Edge.');
    return;
  }
  try {
    const handle = await window.showDirectoryPicker({ id: 'pv-printventory-dir', mode: 'readwrite' });
    const granted = await PrintventoryFolder.ensureWritePermission(handle);
    if (!granted) {
      setFolderStatus('err', 'Permission was not granted for that folder.');
      return;
    }
    const hasDb = await PrintventoryFolder.folderHasDatabase(handle);
    await PrintventoryFolder.setDirectoryHandle(handle);
    chrome.storage.local.set({
      printventoryFolderConfigured: true,
      printventoryFolderName: handle.name,
      printventoryFolderHasDb: hasDb
    }, refreshFolderStatus);
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    setFolderStatus('err', err && err.message ? err.message : String(err));
  }
}

document.getElementById('chooseFolder').addEventListener('click', chooseFolder);

document.getElementById('clearFolder').addEventListener('click', async () => {
  await PrintventoryFolder.clearDirectoryHandle();
  chrome.storage.local.set({
    printventoryFolderConfigured: false,
    printventoryFolderName: '',
    printventoryFolderHasDb: false
  }, refreshFolderStatus);
});

document.getElementById('extensionDebug').addEventListener('change', () => {
  const debug = document.getElementById('extensionDebug').checked;
  if (typeof pvSetDebug === 'function') pvSetDebug(debug);
  chrome.storage.sync.set({ extensionDebug: debug });
});

chrome.storage.sync.get({ extensionDebug: false }, (items) => {
  document.getElementById('extensionDebug').checked = !!items.extensionDebug;
  if (typeof pvSetDebug === 'function') pvSetDebug(!!items.extensionDebug);
});

refreshFolderStatus();
