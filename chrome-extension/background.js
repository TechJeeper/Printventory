/* global pvLog, pvSetDebug, pvShort, pvWarn */
'use strict';
importScripts('debug.js');

const DEFAULT_SERVER_URL = 'http://localhost:5000';

chrome.storage.sync.get({ extensionDebug: false }, (items) => {
  if (typeof pvSetDebug === 'function') pvSetDebug(!!items.extensionDebug);
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.extensionDebug && typeof pvSetDebug === 'function') {
    pvSetDebug(!!changes.extensionDebug.newValue);
  }
});

let ws = null;
let wsReady = false;
let connectPromise = null;

function httpToWs(url) {
  if (!url || typeof url !== 'string') return null;
  const u = url.trim().replace(/\/+$/, '');
  if (u.startsWith('https://')) return 'wss://' + u.slice(8);
  if (u.startsWith('http://')) return 'ws://' + u.slice(7);
  if (u.startsWith('localhost') || u.startsWith('127.0.0.1')) return 'ws://' + u;
  return 'ws://' + u;
}

function getServerUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ printventoryServerUrl: DEFAULT_SERVER_URL }, (items) => {
      resolve(items.printventoryServerUrl || DEFAULT_SERVER_URL);
    });
  });
}

function getUseUploadForServer() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ useUploadForServer: false }, (items) => {
      resolve(!!items.useUploadForServer);
    });
  });
}

function connect(serverUrl) {
  if (connectPromise) return connectPromise;
  const wsUrl = httpToWs(serverUrl);
  if (!wsUrl) {
    connectPromise = Promise.reject(new Error('Invalid server URL'));
    return connectPromise;
  }
  connectPromise = new Promise((resolve, reject) => {
    try {
      const socket = new WebSocket(wsUrl);
      socket.onopen = () => {
        ws = socket;
        wsReady = true;
        resolve(ws);
      };
      socket.onclose = () => {
        ws = null;
        wsReady = false;
        connectPromise = null;
      };
      socket.onerror = () => {
        ws = null;
        wsReady = false;
        connectPromise = null;
        reject(new Error('Cannot connect to Printventory. Is Printventory running?'));
      };
    } catch (err) {
      connectPromise = null;
      reject(err);
    }
  });
  return connectPromise;
}

function sendIpc(channel, args) {
  return new Promise((resolve, reject) => {
    const id = 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2);
    const payload = { id, channel, args };
    let timeoutId = null;

    const onMessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.id !== id) return;
        if (timeoutId) clearTimeout(timeoutId);
        ws.removeEventListener('message', onMessage);
        if (data.type === 'result') {
          if (typeof pvLog === 'function') pvLog('WebSocket result', { id, channel, hasResult: data.result != null });
          resolve(data.result);
        } else if (data.type === 'error') {
          if (typeof pvWarn === 'function') pvWarn('WebSocket error payload', { id, channel, error: data.error });
          reject(new Error(data.error || 'Unknown error'));
        }
      } catch (e) {
        if (timeoutId) clearTimeout(timeoutId);
        ws.removeEventListener('message', onMessage);
        reject(e);
      }
    };

    const doSend = () => {
      if (typeof pvLog === 'function') pvLog('WebSocket send', { id, channel, argKeys: (args && args[0] && typeof args[0] === 'object') ? Object.keys(args[0]) : args });
      ws.addEventListener('message', onMessage);
      ws.send(JSON.stringify(payload));
      timeoutId = setTimeout(() => {
        timeoutId = null;
        if (ws) ws.removeEventListener('message', onMessage);
        reject(new Error('Printventory request timeout'));
      }, 15000);
    };

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      getServerUrl().then((url) => connect(url)).then(doSend).catch(reject);
      return;
    }

    doSend();
  });
}

const SUPPORTED_SITES = ['makerworld.com', 'thangs.com', 'printables.com', 'thingiverse.com', 'cults3d.com', 'myminifactory.com'];

function isSupportedSite(url) {
  if (!url) return false;
  const u = url.toLowerCase();
  return SUPPORTED_SITES.some(site => u.includes(site));
}

function isModelFile(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return lower.endsWith('.stl') || lower.endsWith('.3mf') || lower.endsWith('.zip');
}

function buildModelData(item, finalMeta, baseName) {
  const fileName = (finalMeta && finalMeta.parentModel && finalMeta.parentModel !== 'Unknown')
    ? finalMeta.parentModel
    : baseName;
  return {
    filePath: item.filename,
    fileName,
    designer: finalMeta ? finalMeta.designer || null : null,
    parentModel: finalMeta ? finalMeta.parentModel || null : null,
    notes: finalMeta ? finalMeta.notes || null : null,
    license: finalMeta ? finalMeta.license || null : null,
    source: (finalMeta && (finalMeta.source || finalMeta.url)) || item.finalUrl || item.url || null
  };
}

async function addModelViaExtensionUpload(item, modelData, baseName) {
  const baseUrl = (await getServerUrl()).replace(/\/+$/, '');
  const downloadUrl = item.finalUrl || item.url || '';
  if (!downloadUrl) throw new Error('No download URL for upload');
  const res = await fetch(downloadUrl, { method: 'GET', credentials: 'include' });
  if (!res.ok) throw new Error('Re-download failed: ' + res.status);
  const blob = await res.blob();
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const fileBase64 = btoa(binary);
  const uploadRes = await fetch(baseUrl + '/api/extension-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileBase64,
      fileName: baseName,
      designer: modelData.designer || null,
      source: modelData.source || null,
      notes: modelData.notes || null,
      parentModel: modelData.parentModel || null,
      license: modelData.license || null
    })
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(uploadRes.status === 400 ? errText : 'Upload failed: ' + uploadRes.status);
  }
  return uploadRes.json();
}

async function addModelViaWebSocket(modelData) {
  const urlToUse = await getServerUrl();
  if (!ws || ws.readyState !== WebSocket.OPEN) await connect(urlToUse);
  return sendIpc('save-model', [modelData]);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'storePageMetadata' && message.data && sender.tab && sender.tab.id != null) {
    const key = 'tabMetadata_' + sender.tab.id;
    const d = message.data;
    const payload = Object.assign({}, d, { storedAt: Date.now() });
    if (typeof pvLog === 'function') {
      pvLog('storePageMetadata', {
        tabId: sender.tab.id,
        key,
        source: payload.source || payload.url,
        parentModel: payload.parentModel,
        designer: payload.designer,
        license: payload.license,
        notes: typeof pvShort === 'function' ? pvShort(payload.notes, 180) : payload.notes
      });
    }
    chrome.storage.local.set({ [key]: payload }, () => {
      if (typeof pvLog === 'function') pvLog('local.set ok', key);
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message.action === 'testConnection') {
    const urlToTest = (message.url && message.url.trim()) ? message.url.trim() : null;
    let responded = false;
    const respond = (ok, error) => {
      if (responded) return;
      responded = true;
      sendResponse(ok ? { ok: true } : { ok: false, error: error || 'Connection failed' });
    };
    (async () => {
      try {
        const serverUrl = urlToTest || await getServerUrl();
        const wsUrl = httpToWs(serverUrl);
        if (!wsUrl) {
          respond(false, 'Invalid server URL');
          return;
        }
        const socket = new WebSocket(wsUrl);
        const timeout = setTimeout(() => {
          try {
            socket.close();
          } catch (e) { /* ignore */ }
          respond(false, 'Connection timeout. Is Printventory running?');
        }, 5000);
        socket.onopen = () => {
          clearTimeout(timeout);
          try {
            socket.close();
          } catch (e) { /* ignore */ }
          respond(true);
        };
        socket.onerror = () => {
          clearTimeout(timeout);
          respond(false, 'Cannot connect. Is Printventory running?');
        };
        socket.onclose = () => {
          clearTimeout(timeout);
          if (!responded) respond(false, 'Connection closed');
        };
      } catch (err) {
        respond(false, (err && err.message) ? err.message : 'Connection failed');
      }
    })();
    return true; // keep channel open for async sendResponse
  }
});

function showNotification(title, message) {
  const t = (title != null && String(title).trim()) ? String(title).trim() : 'Printventory Watcher';
  const m = (message != null && String(message).trim()) ? String(message).trim() : 'Done';
  const opts = {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icon48.png'),
    title: t,
    message: m
  };
  chrome.notifications.create(opts, (id) => {
    if (chrome.runtime.lastError) {
      try {
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
          title: t,
          message: m
        });
      } catch (e) { /* ignore */ }
    }
  });
}

function normalizeHost(host) {
  if (!host || typeof host !== 'string') return '';
  const h = host.toLowerCase().trim();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function normalizeUrlForMatch(u) {
  if (!u || typeof u !== 'string') return '';
  try {
    const url = new URL(u.trim());
    const pathPart = (url.pathname || '/').replace(/\/+$/, '') || '/';
    return (url.protocol + '//' + url.host).toLowerCase() + pathPart.toLowerCase();
  } catch (e) {
    return u.toLowerCase();
  }
}

/** e.g. https://makerworld.com/ or /en only — must NOT be used to match "every" model on the site. */
function isLooseTopLevelPageOnly(norm) {
  if (!norm) return true;
  try {
    const u = new URL(norm);
    const p = (u.pathname || '/').replace(/\/+$/g, '') || '/';
    if (p === '/' || p === '/en' || p === '/zh' || p === '/ja' || p === '/de' || p === '/fr' || p === '/es' || p === '/it' || p === '/ko' || p === '/ru') {
      if (/makerworld|printables|thangs|thingiverse|cults3d|myminifactory|bbl|bambu/i.test(u.host)) {
        return true;
      }
    }
  } catch (e) { /* ignore */ }
  return false;
}

/** e.g. /en/models/2683891-foo or .../thing:123 in any URL string. */
function extractModelCatalogIdFromString(s) {
  if (!s || typeof s !== 'string') return null;
  const m1 = s.match(/\/models\/(\d{4,})/i);
  if (m1) return m1[1];
  const m2 = s.match(/thing[:/]?(\d{4,})/i);
  if (m2) return m2[1];
  const m3 = s.match(/\/prints\/(\d{4,})/i);
  if (m3) return m3[1];
  return null;
}

function modelSourceHasCatalogId(sourceStr, id) {
  if (!id || !sourceStr) return false;
  const s = String(sourceStr);
  if (s.indexOf('/models/' + id) >= 0) return true;
  if (s.indexOf('/prints/' + id) >= 0) return true;
  if (new RegExp('thing[:/]' + id + '(?:[^0-9]|$)', 'i').test(s)) return true;
  if (s.indexOf('/object/') >= 0 && s.indexOf(id) >= 0) return true;
  return false;
}

function findMetaByReferrer(stored, downloadReferrer, downloadUrl) {
  const refNorm = normalizeUrlForMatch(downloadReferrer);
  const urlNorm = normalizeUrlForMatch(downloadUrl);
  if (!refNorm && !urlNorm) return null;
  const fromDl = (downloadUrl || '') + (downloadReferrer || '');
  const idNeedle = extractModelCatalogIdFromString(fromDl);
  const refIsLoose = isLooseTopLevelPageOnly(refNorm);
  if (idNeedle) {
    if (typeof pvLog === 'function') {
      pvLog('findMetaByReferrer: require catalog id in metadata', { idNeedle, hadLooseRef: refIsLoose });
    }
  } else if (refIsLoose) {
    if (typeof pvLog === 'function') {
      pvLog('findMetaByReferrer: skip (site root referrer, no /models/ id in download URL path)');
    }
    return null;
  }
  const candidates = [];
  for (const key of Object.keys(stored)) {
    if (!key.startsWith('tabMetadata_')) continue;
    const meta = stored[key];
    const src = (meta && (meta.source || meta.url)) || '';
    const pageUrl = normalizeUrlForMatch(src);
    if (!pageUrl) continue;
    if (idNeedle && !modelSourceHasCatalogId(src, idNeedle)) {
      continue;
    }
    let match = false;
    let score = 0;
    if (refNorm) {
      if (refNorm === pageUrl) {
        match = true;
        score = 3;
      } else if (refIsLoose) {
        match = false;
      } else if (refNorm.startsWith(pageUrl) || pageUrl.startsWith(refNorm)) {
        match = true;
        score = 2;
      }
    }
    if (!match && urlNorm) {
      if (urlNorm === pageUrl) {
        match = true;
        score = 3;
      } else if (idNeedle) {
        if (String(downloadUrl || '').includes(idNeedle) && modelSourceHasCatalogId(src, idNeedle)) {
          match = true;
          score = 2;
        }
      } else if (urlNorm.startsWith(pageUrl) || pageUrl.startsWith(urlNorm)) {
        match = true;
        score = 1;
      }
    }
    if (!match && idNeedle) {
      match = true;
      score = 2;
    }
    if (!match) continue;
    const ts = (meta && meta.storedAt) ? Number(meta.storedAt) : 0;
    candidates.push({ meta, score, ts, key });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score || b.ts - a.ts);
  if (typeof pvLog === 'function' && candidates.length > 1) {
    pvLog('findMetaByReferrer picked newest/best of', candidates.length, 'candidates', {
      key: candidates[0].key,
      parentModel: candidates[0].meta && candidates[0].meta.parentModel
    });
  }
  return candidates[0].meta;
}

/** Key path for model page identity (e.g. /en/models/2672993-foo) — ignores hash, trailing slash. */
function modelPathKeyForMatch(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const p = new URL(url.trim()).pathname.replace(/\/+$/, '') || '/';
    const low = p.toLowerCase();
    const m = low.match(/(\/models\/\d+[^/]*|\/thing[:/]\d+[^/]*|\/prints\/\d+[^/]*|\/object\/\d+[^/]*|\/model\/[^/]+|\/3d-model\/)/i);
    if (m) return m[1] || low;
    return low;
  } catch (e) {
    return '';
  }
}

function isLikelyCatalogModelPageUrl(url) {
  if (!url) return false;
  try {
    if (!/makerworld|thangs|printables|thingiverse|cults3d|myminifactory/i.test(url)) return false;
    return /\/models\/\d+|thing[:/]\d+|\/prints\/\d+|\/object\/|\/model\//i.test(new URL(url).pathname);
  } catch (e) {
    return false;
  }
}

function isStaleModelTabMetadata(meta, tab) {
  if (!meta || !tab || !tab.url) return false;
  if (!isLikelyCatalogModelPageUrl(tab.url)) return false;
  const ms = (meta.source || meta.url || '').trim();
  if (!ms) return false;
  const a = modelPathKeyForMatch(ms);
  const b = modelPathKeyForMatch(tab.url);
  if (!a || !b) return false;
  return a !== b;
}

// Only use metadata if it matches the page the download came from (avoid stale data from same tab after navigation)
function metadataMatchesContext(meta, contextUrl) {
  if (!meta || !contextUrl) return false;
  const pageUrl = normalizeUrlForMatch(meta.source || meta.url);
  const ctx = normalizeUrlForMatch(contextUrl);
  if (!pageUrl || !ctx) return false;
  if (pageUrl === ctx || ctx.startsWith(pageUrl) || pageUrl.startsWith(ctx)) return true;
  // Same site (host) and same pathname: treat as match (handles www vs non-www, query, hash)
  try {
    const page = new URL(meta.source || meta.url);
    const ctxUrl = new URL(contextUrl);
    if (normalizeHost(page.host) !== normalizeHost(ctxUrl.host)) return false;
    const pPath = (page.pathname || '').replace(/\/+$/, '') || '/';
    const cPath = (ctxUrl.pathname || '').replace(/\/+$/, '') || '/';
    return pPath === cPath || cPath.startsWith(pPath) || pPath.startsWith(cPath);
  } catch (e) {
    return false;
  }
}

/**
 * Download often has no tabId (CDN) and referrer https://makerworld.com/ (matches all models).
 * Use the focused tab's model page first, then strict findMetaByReferrer.
 */
function tryActiveTabThenFindMeta(stored, item, done) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const t = tabs && tabs[0];
    if (t && t.id != null && t.url) {
      const c = stored['tabMetadata_' + t.id];
      if (c && isSupportedSite(t.url) && isLikelyCatalogModelPageUrl(t.url) && metadataMatchesContext(c, t.url)) {
        if (typeof pvLog === 'function') {
          pvLog('meta: active window tab (download had no tabId)', { tabId: t.id, parentModel: c.parentModel, page: t.url });
        }
        done(c);
        return;
      }
    }
    const m = findMetaByReferrer(stored, item.referrer || '', item.url || item.finalUrl || '');
    done(m || null);
  });
}

chrome.downloads.onChanged.addListener((downloadDelta) => {
  if (!downloadDelta.state || downloadDelta.state.current !== 'complete') return;
  chrome.downloads.search({ id: downloadDelta.id }, (results) => {
    const item = results && results[0];
    if (!item || !item.filename || !isModelFile(item.filename)) return;
    if (typeof pvLog === 'function') {
      pvLog('model download complete', {
        id: item.id,
        filename: item.filename,
        tabId: item.tabId,
        url: item.url,
        finalUrl: item.finalUrl,
        referrer: item.referrer
      });
    }

    const tabId = item.tabId;
    if (tabId != null && tabId >= 0) {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          runDownloadHandling(item, null, null);
          return;
        }
        runDownloadHandling(item, tabId, tab);
      });
    } else {
      // No tabId (e.g. download from new window or link). Try referrer + active-tab fallback and show message if nothing works.
      runDownloadHandling(item, null, null);
    }
  });
});

function runDownloadHandling(item, tabId, knownTab) {
  const key = tabId != null && tabId >= 0 ? 'tabMetadata_' + tabId : null;
  const filePath = item.filename;
  const baseName = filePath.replace(/^.*[\\/]/, '');
  // When tabId is missing, get all storage so findMetaByReferrer can search every tab's metadata
  const keysToGet = key ? [key] : null;
  chrome.storage.local.get(keysToGet, (stored) => {
      let meta = key ? (stored[key] || null) : null;
      if (typeof pvLog === 'function') {
        pvLog('runDownloadHandling: initial', { key, hasMeta: !!meta, tabId, baseName });
      }
      // Don't invalidate by referrer when we have tab metadata: many sites omit or strip referrer on download links
      if (meta && !key && item.referrer && !metadataMatchesContext(meta, item.referrer)) {
        if (typeof pvLog === 'function') pvLog('cleared meta: referrer mismatch', { referrer: item.referrer, metaSource: meta && (meta.source || meta.url) });
        meta = null;
      }
      if (!meta && (tabId == null || tabId < 0)) {
        tryActiveTabThenFindMeta(stored, item, (m) => {
          meta = m;
          if (typeof pvLog === 'function' && meta) {
            pvLog('meta: active tab or findMetaByReferrer', { parentModel: meta.parentModel, source: meta.source || meta.url });
          }
          runProceed(meta);
        });
        return;
      }

      function useTabForValidationAndProceed(tab) {
        if (meta && tab && isStaleModelTabMetadata(meta, tab)) {
          // eslint-disable-next-line no-console
          console.info('[Printventory Watcher] Discarded stale tab metadata (wrong model for this page).', 'Stored:', (meta && meta.parentModel) || '', '| Tab:', (tab && tab.url) || '');
          meta = null;
        }
        if (!meta && tab && isLikelyCatalogModelPageUrl(tab.url) && key) {
          chrome.tabs.sendMessage(tabId, { action: 'pvGetScrape' }, (response) => {
            if (chrome.runtime.lastError) {
              // eslint-disable-next-line no-console
              console.info('[Printventory Watcher] Live scrape in tab failed:', chrome.runtime.lastError.message);
              runProceed(meta);
              return;
            }
            if (response && response.parentModel) {
              const fresh = Object.assign({}, response, { storedAt: Date.now() });
              chrome.storage.local.set({ [key]: fresh }, () => {
                runProceed(fresh);
              });
              return;
            }
            runProceed(meta);
          });
          return;
        }
        runProceed(meta);
      }

      if (tabId == null || tabId < 0) {
        runProceed(meta);
        return;
      }
      if (knownTab) {
        useTabForValidationAndProceed(knownTab);
      } else {
        chrome.tabs.get(tabId, (tab) => {
          if (chrome.runtime.lastError) useTabForValidationAndProceed(null);
          else useTabForValidationAndProceed(tab);
        });
      }

      function runProceed(resolvedMeta) {
        if (resolvedMeta) {
          proceedWithMeta(resolvedMeta);
        } else if (tabId == null || tabId < 0) {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            let activeMeta = null;
            const tab = tabs[0];
            if (tab && tab.id != null && tab.url && isSupportedSite(tab.url)) {
              const candidate = stored['tabMetadata_' + tab.id];
              if (candidate && metadataMatchesContext(candidate, tab.url)) {
                activeMeta = candidate;
                if (typeof pvLog === 'function') {
                  pvLog('meta from active tab fallback', { tabId: tab.id, parentModel: candidate.parentModel, pageUrl: tab.url });
                }
              }
            }
            proceedWithMeta(activeMeta || null);
          });
        } else {
          proceedWithMeta(null);
        }
      }
      function proceedWithMeta(finalMeta) {
        const modelData = buildModelData(item, finalMeta, baseName);
        const displayName = modelData.fileName;
        if (typeof pvLog === 'function') {
          pvLog('proceedWithMeta', {
            tabId,
            hasMeta: !!finalMeta,
            file: baseName,
            displayName,
            parentModel: finalMeta && finalMeta.parentModel,
            source: finalMeta && (finalMeta.source || finalMeta.url),
            modelDataFileName: modelData.fileName
          });
        }
        if (finalMeta) {
          // Service worker: chrome://extensions → this extension → "service worker" → Inspect
          // eslint-disable-next-line no-console
          console.info(
            '[Printventory Watcher] add:',
            finalMeta.parentModel,
            '←',
            (finalMeta.source || finalMeta.url) || 'no source'
          );
        }
        if (!finalMeta && (tabId == null || tabId < 0)) {
          showNotification('Printventory Watcher', 'Download had no tab. Open the model page in this tab and download again.');
          return;
        }
        if (!finalMeta) {
          showNotification('Printventory Watcher', 'Open the model page in this tab first, then download again.');
          return;
        }
        (async () => {
          const useUpload = await getUseUploadForServer();
          const downloadUrl = item.finalUrl || item.url || '';
          if (typeof pvLog === 'function') pvLog('add path', { useUpload, hasDownloadUrl: !!downloadUrl });
          if (useUpload && downloadUrl) {
            try {
              if (typeof pvLog === 'function') pvLog('trying extension-upload', { baseName });
              const result = await addModelViaExtensionUpload(item, modelData, baseName);
              if (result && result.expanded && typeof result.count === 'number') {
                showNotification('Printventory Watcher', `Added ${result.count} model${result.count === 1 ? '' : 's'} from ${baseName}`);
              } else {
                showNotification('Printventory Watcher', 'Added to Printventory: ' + displayName);
              }
              return;
            } catch (uploadErr) {
              if (typeof pvWarn === 'function') pvWarn('upload path failed, falling back to save-model', uploadErr);
            }
          }
          try {
            if (typeof pvLog === 'function') pvLog('trying save-model (WebSocket)', { fileName: modelData.fileName, filePath: modelData.filePath });
            const result = await addModelViaWebSocket(modelData);
            if (result && result.expanded && typeof result.count === 'number') {
              const zipName = baseName || displayName;
              showNotification('Printventory Watcher', `Added ${result.count} model${result.count === 1 ? '' : 's'} from ${zipName}`);
            } else {
              showNotification('Printventory Watcher', 'Added to Printventory: ' + displayName);
            }
          } catch (err) {
            console.error('Printventory Watcher: auto-add on download failed', err);
            const msg = (err && err.message) ? err.message : 'Could not add. Is Printventory running?';
            showNotification('Printventory Watcher', msg.length > 100 ? msg.slice(0, 97) + '…' : msg);
          }
        })();
      }
    });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove(['tabMetadata_' + tabId], () => {});
});

chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
