/* global pvLog, pvSetDebug, PrintventoryInbox, PrintventoryExtract */
'use strict';
importScripts('debug.js', 'inbox.js', 'extractors.js');

chrome.storage.sync.get({ extensionDebug: false }, (items) => {
  if (typeof pvSetDebug === 'function') pvSetDebug(!!items.extensionDebug);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.extensionDebug && typeof pvSetDebug === 'function') {
    pvSetDebug(!!changes.extensionDebug.newValue);
  }
});

const ALWAYS_QUEUE_EXT = /\.(stl|obj|3mf)$/i;
const SUPPORTED_SITES = [
  'makerworld.com',
  'thangs.com',
  'printables.com',
  'thingiverse.com',
  'cults3d.com',
  'myminifactory.com'
];

function isInboxSidecar(filename) {
  return typeof filename === 'string' && filename.toLowerCase().endsWith('.pvimport.json');
}

function isAlwaysQueueFile(filename) {
  if (!filename || isInboxSidecar(filename)) return false;
  return ALWAYS_QUEUE_EXT.test(filename);
}

function hostFromUrl(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return '';
  }
}

function isSupportedSiteUrl(url) {
  const host = hostFromUrl(url);
  if (!host) return false;
  return SUPPORTED_SITES.some((site) => host === site || host.endsWith('.' + site));
}

function isDownloadFromSupportedSite(item, tabUrl) {
  return isSupportedSiteUrl(item && item.referrer)
    || isSupportedSiteUrl(item && item.finalUrl)
    || isSupportedSiteUrl(item && item.url)
    || isSupportedSiteUrl(tabUrl);
}

async function getDownloadTabUrl(item) {
  if (!item || item.tabId == null || item.tabId < 0) return null;
  try {
    const tab = await chrome.tabs.get(item.tabId);
    return tab && tab.url ? tab.url : null;
  } catch (e) {
    return null;
  }
}

function shouldQueueDownload(item, tabUrl) {
  if (!item || isInboxSidecar(item.filename)) return false;
  if (isAlwaysQueueFile(item.filename)) return true;
  return isDownloadFromSupportedSite(item, tabUrl);
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icon48.png',
      title: title,
      message: message || ''
    });
  } catch (e) { /* ignore */ }
}

function tabMetaKey(tabId) {
  return 'tabMetadata_' + tabId;
}

function storeTabMeta(tabId, data) {
  if (tabId == null || !data) return Promise.resolve();
  const payload = Object.assign({}, data, { storedAt: Date.now() });
  const exact = exactModelUrl(payload.source || payload.url);
  const updates = { [tabMetaKey(tabId)]: payload };
  if (exact) {
    payload.source = exact;
    payload.url = exact;
    updates.lastExactModel = {
      url: exact,
      site: payload.site || siteFromUrl(exact),
      tabId: tabId,
      at: Date.now()
    };
  }
  return chrome.storage.local.set(updates);
}

function getTabMeta(tabId) {
  return new Promise((resolve) => {
    if (tabId == null) {
      resolve(null);
      return;
    }
    const key = tabMetaKey(tabId);
    chrome.storage.local.get(key, (items) => {
      resolve(items[key] || null);
    });
  });
}

async function liveExtract(tabId) {
  if (tabId == null) return null;
  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'pvExtract' });
  } catch (e) {
    return null;
  }
}

function metadataFromUrl(href) {
  if (!self.PrintventoryExtract || typeof self.PrintventoryExtract.metadataFromUrl !== 'function') return null;
  return self.PrintventoryExtract.metadataFromUrl(href);
}

function isLooseSiteUrl(url) {
  if (!url || typeof url !== 'string') return true;
  try {
    const path = new URL(url).pathname.replace(/\/+$/, '') || '/';
    if (path === '/' || /^\/(en|de|fr|es|it|nl|ja|ko|zh)\/?$/i.test(path)) return true;
  } catch (e) {
    return true;
  }
  const cat = self.PrintventoryExtract && self.PrintventoryExtract.parseCatalog(url);
  return !(cat && cat.isModelPage);
}

function exactModelUrl(url) {
  if (!url || isLooseSiteUrl(url)) return null;
  const catalog = parseCatalog(url);
  if (!catalog || !catalog.isModelPage) return null;
  return catalog.canonicalHref || catalog.href;
}

function siteFromUrl(url) {
  const catalog = parseCatalog(url);
  if (catalog && catalog.site) return catalog.site;
  const host = hostFromUrl(url);
  if (!host) return null;
  const hit = SUPPORTED_SITES.find((site) => host === site || host.endsWith('.' + site));
  return hit || null;
}

function mergeMeta(pageMeta, urlMeta) {
  if (!pageMeta && !urlMeta) return null;
  const out = Object.assign({}, urlMeta || {}, pageMeta || {});
  if (urlMeta && urlMeta.source) {
    out.source = urlMeta.source;
    out.url = urlMeta.url || urlMeta.source;
  }
  if ((!out.parentModel || out.parentModel === 'Unknown') && urlMeta && urlMeta.parentModel) {
    out.parentModel = urlMeta.parentModel;
  }
  return out;
}

function parseCatalog(href) {
  if (!href || !self.PrintventoryExtract || typeof self.PrintventoryExtract.parseCatalog !== 'function') {
    return null;
  }
  return self.PrintventoryExtract.parseCatalog(href);
}

function catalogKey(hrefOrMeta) {
  if (!hrefOrMeta) return null;
  if (typeof hrefOrMeta === 'object') {
    if (hrefOrMeta.site && hrefOrMeta.catalogId) return hrefOrMeta.site + ':' + hrefOrMeta.catalogId;
    return catalogKey(hrefOrMeta.source || hrefOrMeta.url);
  }
  const catalog = parseCatalog(hrefOrMeta);
  if (!catalog || !catalog.isModelPage) return null;
  return catalog.site + ':' + (catalog.id || catalog.canonicalHref || catalog.href);
}

function firstModelPageUrl() {
  for (let i = 0; i < arguments.length; i++) {
    const url = arguments[i];
    if (!url || isLooseSiteUrl(url)) continue;
    const catalog = parseCatalog(url);
    if (catalog && catalog.isModelPage) return catalog.canonicalHref || catalog.href;
  }
  return null;
}

async function enrichCatalog(href, extraMeta) {
  const fromUrl = metadataFromUrl(href);
  const catalog = parseCatalog(href);
  let merged = mergeMeta(extraMeta, fromUrl);
  if (!catalog || !catalog.isModelPage || !self.PrintventoryExtract.enrichFromApi) {
    return merged || fromUrl;
  }
  try {
    const api = await self.PrintventoryExtract.enrichFromApi(catalog, fetch);
    if (!api) return merged || fromUrl;
    return {
      url: (merged && merged.url) || catalog.canonicalHref,
      source: catalog.canonicalHref || (merged && merged.source),
      catalogId: catalog.id,
      site: catalog.site,
      parentModel: api.parentModel || (merged && merged.parentModel) || catalog.slugTitle,
      designer: api.designer || (merged && merged.designer) || null,
      notes: api.notes || (merged && merged.notes) || null,
      license: api.license || (merged && merged.license) || 'Unknown'
    };
  } catch (e) {
    return merged || fromUrl;
  }
}

async function extractForTab(tabId, tabUrl) {
  const live = await liveExtract(tabId);
  const stored = await getTabMeta(tabId);
  const fromUrl = metadataFromUrl(tabUrl || (live && live.source) || (stored && stored.source));
  const wantKey = catalogKey(tabUrl) || catalogKey(fromUrl);
  const pageMeta = live || stored;
  const pageKey = catalogKey(pageMeta);
  const trustedPage = pageMeta && (!wantKey || !pageKey || pageKey === wantKey) ? pageMeta : null;
  return enrichCatalog(tabUrl || (fromUrl && fromUrl.source), trustedPage);
}

const pendingMeta = new Map();
const capturingById = new Map();

function pendingKey(downloadId) {
  return 'pendingDl_' + downloadId;
}

async function savePendingDownload(downloadId, payload) {
  pendingMeta.set(downloadId, payload);
  await chrome.storage.local.set({ [pendingKey(downloadId)]: payload });
}

async function takePendingDownload(downloadId) {
  if (pendingMeta.has(downloadId)) {
    const mem = pendingMeta.get(downloadId);
    pendingMeta.delete(downloadId);
    chrome.storage.local.remove(pendingKey(downloadId));
    return mem;
  }
  const key = pendingKey(downloadId);
  const items = await chrome.storage.local.get(key);
  const stored = items[key] || null;
  if (stored) chrome.storage.local.remove(key);
  return stored;
}

async function resolveStartModelUrl(item) {
  let tabUrl = null;
  if (item.tabId != null && item.tabId >= 0) {
    try {
      const tab = await chrome.tabs.get(item.tabId);
      tabUrl = tab && tab.url ? tab.url : null;
    } catch (e) { /* tab gone */ }
  }
  let pageUrl = firstModelPageUrl(item.referrer, tabUrl, item.url, item.finalUrl);
  if (!pageUrl && item.tabId != null) {
    const storedTab = await getTabMeta(item.tabId);
    pageUrl = exactModelUrl(storedTab && (storedTab.source || storedTab.url));
  }
  if (!pageUrl) {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const active = tabs && tabs[0];
      if (active) {
        pageUrl = firstModelPageUrl(active.url);
        if (!pageUrl) {
          const storedActive = await getTabMeta(active.id);
          pageUrl = exactModelUrl(storedActive && (storedActive.source || storedActive.url));
        }
      }
    } catch (e) { /* ignore */ }
  }
  if (!pageUrl) {
    const last = await new Promise((resolve) => {
      chrome.storage.local.get('lastExactModel', (items) => resolve(items.lastExactModel || null));
    });
    const site = siteFromUrl(item.referrer) || siteFromUrl(item.url) || siteFromUrl(item.finalUrl);
    if (last && last.url && (!site || last.site === site) && Date.now() - (last.at || 0) < 120000) {
      pageUrl = exactModelUrl(last.url);
    }
  }
  return pageUrl;
}

async function captureDownloadStart(item) {
  const pageUrl = await resolveStartModelUrl(item);
  const storedTab = item.tabId != null ? await getTabMeta(item.tabId) : null;
  const storedOk = storedTab && pageUrl && catalogKey(storedTab) === catalogKey(pageUrl)
    ? storedTab
    : null;
  const starter = storedOk || metadataFromUrl(pageUrl);
  if (starter && pageUrl) {
    starter.source = pageUrl;
    starter.url = pageUrl;
  }
  await savePendingDownload(item.id, {
    pageUrl: pageUrl,
    referrer: item.referrer || null,
    meta: starter
  });
  if (pageUrl) {
    const meta = await enrichCatalog(pageUrl, storedOk);
    if (meta) {
      meta.source = pageUrl;
      meta.url = pageUrl;
    }
    await savePendingDownload(item.id, {
      pageUrl: pageUrl,
      referrer: item.referrer || null,
      meta: meta
    });
  }
}

async function metaForCompletedDownload(item, tabUrlNow) {
  if (capturingById.has(item.id)) {
    try {
      await capturingById.get(item.id);
    } catch (e) { /* use whatever was saved */ }
    capturingById.delete(item.id);
  }
  const pending = await takePendingDownload(item.id);
  if (pending && pending.meta) return pending.meta;
  const startUrl = (pending && pending.pageUrl) || firstModelPageUrl(item.referrer, item.url, item.finalUrl);
  if (startUrl) return enrichCatalog(startUrl, null);
  const nowKey = catalogKey(tabUrlNow);
  const startKey = catalogKey(item.referrer);
  if (startKey && nowKey && startKey !== nowKey) {
    return enrichCatalog(item.referrer, null);
  }
  if (startKey) return enrichCatalog(item.referrer, null);
  return null;
}

function pickSource(meta, item, tabUrl) {
  const candidates = [
    meta && meta.source,
    meta && meta.url,
    tabUrl,
    item && item.referrer,
    item && item.finalUrl,
    item && item.url
  ];
  for (let i = 0; i < candidates.length; i++) {
    const exact = exactModelUrl(candidates[i]);
    if (exact) return exact;
  }
  return null;
}

async function queueInbox(fields) {
  const result = await PrintventoryInbox.writeInbox(fields);
  if (typeof pvLog === 'function') pvLog('inbox written', result.filename, fields && fields.parentModel);
  return result;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.action) return;

  if (message.action === 'storePageMetadata' && message.data && sender.tab && sender.tab.id != null) {
    storeTabMeta(sender.tab.id, message.data).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (message.action === 'queuePage') {
    const data = message.data || {};
    queueInbox({
      filePath: null,
      fileName: data.parentModel || data.fileName || null,
      designer: data.designer || null,
      parentModel: data.parentModel || null,
      source: data.source || data.url || null,
      notes: data.notes || null,
      license: data.license || null
    }).then((result) => {
      notify('Queued for Printventory', data.parentModel || 'Model page');
      sendResponse({ ok: true, result: result });
    }).catch((err) => {
      sendResponse({ ok: false, error: err.message || String(err) });
    });
    return true;
  }

  if (message.action === 'extractActiveTab') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab) {
        sendResponse({ ok: false, error: 'No active tab' });
        return;
      }
      extractForTab(tab.id, tab.url).then((data) => {
        sendResponse({ ok: true, data: data, tab: { id: tab.id, url: tab.url } });
      });
    });
    return true;
  }
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== 'install') return;
  chrome.storage.local.get({ printventoryFolderConfigured: false }, (items) => {
    if (!items.printventoryFolderConfigured) chrome.runtime.openOptionsPage();
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(tabMetaKey(tabId));
});

chrome.downloads.onCreated.addListener((item) => {
  if (!item || isInboxSidecar(item.filename)) return;
  const capturing = captureDownloadStart(item);
  capturingById.set(item.id, capturing);
  capturing.catch((err) => {
    if (typeof pvWarn === 'function') pvWarn('download start capture failed', err);
  });
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta || !delta.state || delta.state.current !== 'complete') return;
  chrome.downloads.search({ id: delta.id }, async (items) => {
    const item = items && items[0];
    if (!item) return;
    const tabUrl = await getDownloadTabUrl(item);
    if (!shouldQueueDownload(item, tabUrl)) return;
    const baseName = (item.filename || '').split(/[/\\]/).pop();
    const meta = await metaForCompletedDownload(item, tabUrl);
    const parentModel = (meta && meta.parentModel && meta.parentModel !== 'Unknown')
      ? meta.parentModel
      : (baseName || 'Downloaded model');
    try {
      await queueInbox({
        filePath: item.filename,
        fileName: parentModel,
        designer: meta ? meta.designer : null,
        parentModel: parentModel,
        source: pickSource(meta, item, meta && meta.source),
        notes: meta ? meta.notes : null,
        license: meta && meta.license !== 'Unknown' ? meta.license : (meta ? meta.license : null)
      });
      notify('Queued for Printventory', parentModel);
    } catch (err) {
      notify('Printventory inbox failed', err.message || String(err));
    }
  });
});
