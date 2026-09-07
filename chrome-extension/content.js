(function () {
  'use strict';

  function extractNow() {
    const Extract = self.PrintventoryExtract;
    if (!Extract) return Promise.resolve(null);
    return Extract.extractPage(location.href, document, typeof fetch === 'function' ? fetch.bind(self) : null);
  }

  function storeForTab(data) {
    if (!data) return;
    try {
      chrome.runtime.sendMessage({ action: 'storePageMetadata', data: data }, function () {
        try { void chrome.runtime.lastError; } catch (e) { /* ignore */ }
      });
    } catch (e) { /* context invalidated */ }
  }

  function init() {
    extractNow().then(function (data) {
      storeForTab(data);
    }).catch(function () { /* ignore */ });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  let lastPath = location.pathname;
  setInterval(function () {
    if (location.pathname === lastPath) return;
    lastPath = location.pathname;
    init();
  }, 2000);

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.action !== 'pvExtract') return;
    extractNow().then(function (data) {
      storeForTab(data);
      sendResponse(data);
    }).catch(function () {
      sendResponse(null);
    });
    return true;
  });
})();
