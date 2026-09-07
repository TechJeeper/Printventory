/**
 * Queue a Printventory inbox JSON into Downloads/PrintventoryInbox.
 * Service-worker safe (data: URL, no Blob).
 */
(function (root) {
  'use strict';

  const INBOX_PREFIX = 'PrintventoryInbox/';

  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function buildPayload(fields) {
    const source = (fields && (fields.source || fields.url)) || null;
    return {
      version: 1,
      id: (fields && fields.id) || uuid(),
      createdAt: new Date().toISOString(),
      filePath: fields && fields.filePath ? fields.filePath : null,
      fileName: (fields && (fields.fileName || fields.parentModel)) || null,
      designer: (fields && fields.designer) || null,
      parentModel: (fields && fields.parentModel) || null,
      source: source,
      notes: (fields && fields.notes) || null,
      license: (fields && fields.license) || null
    };
  }

  function toDataUrl(obj) {
    const json = JSON.stringify(obj, null, 2);
    const bytes = unescape(encodeURIComponent(json));
    let b64;
    if (typeof btoa === 'function') {
      b64 = btoa(bytes);
    } else {
      b64 = Buffer.from(json, 'utf8').toString('base64');
    }
    return 'data:application/json;base64,' + b64;
  }

  function writeViaDownloads(payload) {
    const filename = INBOX_PREFIX + payload.id + '.pvimport.json';
    return new Promise(function (resolve, reject) {
      chrome.downloads.download(
        {
          url: toDataUrl(payload),
          filename: filename,
          saveAs: false,
          conflictAction: 'uniquify'
        },
        function (downloadId) {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve({ downloadId: downloadId, payload: payload, filename: filename, via: 'downloads' });
        }
      );
    });
  }

  async function ensureOffscreen() {
    if (!chrome.offscreen) return false;
    try {
      if (chrome.offscreen.hasDocument && await chrome.offscreen.hasDocument()) return true;
    } catch (e) { /* create below */ }
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['BLOBS'],
      justification: 'Write inbox files into the Printventory folder you selected.'
    });
    await new Promise(function (resolve) { setTimeout(resolve, 50); });
    return true;
  }

  async function writeViaFolder(payload) {
    if (!chrome.offscreen) return { ok: false, reason: 'no-offscreen' };
    await ensureOffscreen();
    return await chrome.runtime.sendMessage({ action: 'writeInboxToFolder', payload: payload });
  }

  async function writeInbox(fields) {
    const payload = buildPayload(fields);
    try {
      const folder = await writeViaFolder(payload);
      if (folder && folder.ok) return Object.assign({ payload: payload }, folder);
    } catch (e) { /* fall back */ }
    return writeViaDownloads(payload);
  }

  root.PrintventoryInbox = {
    INBOX_PREFIX: INBOX_PREFIX,
    buildPayload: buildPayload,
    writeInbox: writeInbox
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
