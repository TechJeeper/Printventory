(function () {
  'use strict';

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes.extensionDebug && typeof self.pvSetDebug === 'function') {
        self.pvSetDebug(!!changes.extensionDebug.newValue);
        if (typeof self.pvLog === 'function') self.pvLog('content: debug toggled', !!changes.extensionDebug.newValue);
      }
    });
  }

  function isModelPage() {
    const scraper = getScraperForHost();
    return scraper && scraper.isModelPage();
  }

  function sendPageMetadataForAutoAdd(reason) {
    try {
      if (!chrome.runtime?.id) return; // Extension context invalidated (e.g. reloaded)
    } catch (e) {
      return; // chrome.runtime access can throw after reload
    }
    if (!isModelPage()) {
      if (typeof self.pvLog === 'function') self.pvLog('sendPageMetadata skip (not model page)', reason, location.href);
      return;
    }
    const data = scrapePage();
    if (!data) {
      if (typeof self.pvLog === 'function') self.pvLog('sendPageMetadata skip (scrape null)', reason, location.href);
      return;
    }
    if (typeof self.pvLog === 'function') {
      self.pvLog('sendPageMetadata -> background', { reason, parentModel: data.parentModel, source: data.source });
    }
    try {
      // Always visible in page console (F12) — not blocked by the debug checkbox
      console.info(
        '%c[Printventory Watcher]%c Metadata:',
        'color:#0a6; font-weight:bold',
        'normal',
        data.parentModel,
        '— if wrong, re-open this page or see extension options (debug).'
      );
    } catch (e) { /* ignore */ }
    try {
      chrome.runtime.sendMessage({ action: 'storePageMetadata', data }, function () {
        try {
          if (chrome.runtime?.lastError) { /* ignore */ }
        } catch (e) { /* context invalidated in callback */ }
      });
    } catch (e) {
      if (e?.message !== 'Extension context invalidated') console.warn('Printventory Watcher:', e);
    }
  }

  function init(reason) {
    try {
      if (isModelPage()) {
        sendPageMetadataForAutoAdd(reason || 'init');
        // SPAs (e.g. Makerworld) often render model title/designer after load; send again after a short delay
        setTimeout(function () {
          try {
            if (isModelPage()) sendPageMetadataForAutoAdd('delayed-2500ms');
          } catch (e) { /* ignore */ }
        }, 2500);
      }
    } catch (e) {
      console.warn('Printventory Watcher init:', e);
    }
  }

  function startContent() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { init('DOMContentLoaded'); });
    } else {
      init('document-idle');
    }
  }

  if (typeof chrome === 'undefined' || !chrome.storage) {
    startContent();
  } else {
    try {
      chrome.storage.sync.get({ extensionDebug: false }, function (items) {
        if (typeof self.pvSetDebug === 'function') self.pvSetDebug(!!items.extensionDebug);
        if (typeof self.pvLog === 'function') self.pvLog('content: start', { extensionDebug: !!items.extensionDebug, href: location.href });
        startContent();
      });
    } catch (e) {
      startContent();
    }
  }

  document.addEventListener('visibilitychange', function () {
    try {
      if (document.visibilityState === 'visible') sendPageMetadataForAutoAdd('visibility');
    } catch (e) { /* ignore */ }
  });

  // Thangs and similar SPAs change the URL without reloading
  let lastPathname = location.pathname;
  setInterval(function () {
    try {
      if (!chrome.runtime?.id) return; // Extension reloaded; stop polling
    } catch (e) {
      return;
    }
    if (location.pathname !== lastPathname) {
      lastPathname = location.pathname;
      if (typeof self.pvLog === 'function') self.pvLog('pathname changed', lastPathname);
      init('pathname-poll');
    }
  }, 1500);
  window.addEventListener('popstate', function () {
    lastPathname = location.pathname;
    if (typeof self.pvLog === 'function') self.pvLog('popstate', lastPathname);
    init('popstate');
  });

  chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
    if (!message || message.action !== 'pvGetScrape') {
      return;
    }
    if (!isModelPage()) {
      sendResponse(null);
      return;
    }
    const data = scrapePage();
    try {
      if (data) {
        console.info(
          '%c[Printventory Watcher]%c Live scrape:',
          'color:#0a6; font-weight:bold',
          'normal',
          data.parentModel,
          location.href
        );
      }
    } catch (e) { /* ignore */ }
    sendResponse(data || null);
  });
})();
