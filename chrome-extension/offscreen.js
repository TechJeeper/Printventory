'use strict';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.action !== 'writeInboxToFolder') return;
  const write = self.PrintventoryFolder && self.PrintventoryFolder.writePayloadToFolder;
  if (typeof write !== 'function') {
    sendResponse({ ok: false, reason: 'no-writer' });
    return;
  }
  write(message.payload).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, reason: 'error', error: err && err.message ? err.message : String(err) });
  });
  return true;
});
