'use strict';

const DEFAULT_SERVER_URL = 'http://localhost:5000'; // Printventory listens here in normal and server mode

function setStatus(state, text) {
  const dot = document.getElementById('statusDot');
  const msg = document.getElementById('statusText');
  dot.className = 'status-dot ' + state;
  msg.textContent = text;
}

document.getElementById('save').addEventListener('click', () => {
  const url = document.getElementById('serverUrl').value.trim() || DEFAULT_SERVER_URL;
  const useUpload = document.getElementById('useUploadForServer').checked;
  const debug = document.getElementById('extensionDebug').checked;
  if (typeof pvSetDebug === 'function') pvSetDebug(debug);
  chrome.storage.sync.set({ printventoryServerUrl: url, useUploadForServer: useUpload, extensionDebug: debug }, () => {
    const el = document.getElementById('saved');
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 2000);
    setStatus('unknown', 'Status: not checked');
  });
});

document.getElementById('testConnection').addEventListener('click', () => {
  const urlInput = document.getElementById('serverUrl').value.trim() || DEFAULT_SERVER_URL;
  const btn = document.getElementById('testConnection');
  setStatus('checking', 'Testing…');
  btn.disabled = true;
  chrome.runtime.sendMessage(
    { action: 'testConnection', url: urlInput || undefined },
    (response) => {
      btn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus('error', 'Status: ' + (chrome.runtime.lastError.message || 'Error'));
        return;
      }
      if (response && response.ok) {
        setStatus('connected', 'Status: connected');
      } else {
        setStatus('error', 'Status: ' + (response && response.error ? response.error : 'Connection failed'));
      }
    }
  );
});

chrome.storage.sync.get(
  { printventoryServerUrl: DEFAULT_SERVER_URL, useUploadForServer: false, extensionDebug: false },
  (items) => {
    document.getElementById('serverUrl').value = items.printventoryServerUrl || DEFAULT_SERVER_URL;
    const cb = document.getElementById('useUploadForServer');
    if (cb) cb.checked = !!items.useUploadForServer;
    const dbg = document.getElementById('extensionDebug');
    if (dbg) dbg.checked = !!items.extensionDebug;
    if (typeof pvSetDebug === 'function') pvSetDebug(!!items.extensionDebug);
  }
);
