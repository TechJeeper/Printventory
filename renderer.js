// Add this at the very top of the file
const DEBUG = true; // Enable debugging temporarily
/** Parse max file size (MB) from Performance settings input; requires integer >= 1. */
function parseMaxFileSizeMBInput(raw) {
  const n = parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return null;
  return n;
}
console.log('[Renderer] script loaded');
window.addEventListener('DOMContentLoaded', () => {
  console.log('[Renderer] DOMContentLoaded fired');
});

// If DOM is already loaded before this script executes (common in server-mode HTTP load),
// force-dispatch DOMContentLoaded once so all late-registered listeners run.
console.log('[Renderer] document.readyState at load:', document.readyState);
if (document.readyState !== 'loading' && !window.__forcedDomContentLoaded) {
  window.__forcedDomContentLoaded = true;
  setTimeout(() => {
    console.log('[Renderer] Forcing DOMContentLoaded (doc already loaded)');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  }, 0);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    window.__forcedDomContentLoaded = true;
  });
}

// Safety: force a single DOMContentLoaded after a short delay if it never fired
setTimeout(() => {
  if (!window.__forcedDomContentLoaded) {
    window.__forcedDomContentLoaded = true;
    console.log('[Renderer] Forcing DOMContentLoaded after timeout');
    document.dispatchEvent(new Event('DOMContentLoaded'));
  }
}, 500);

// Scan STL Home + AI Config Test: delegated click handlers (Server/Docker - main block may run late)
function _attachEarlyButtonHandlers() {
  if (!document.body || document.body._earlyButtonHandlersAttached) return;
  document.body._earlyButtonHandlersAttached = true;
  document.body.addEventListener('click', function _earlyDelegated(e) {
    if (!e.target || !e.target.closest) return;
    if (e.target.closest('#scan-stl-home-button')) {
      var btn = document.getElementById('scan-stl-home-button');
      if (btn && btn.style.display === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.runScanSTLHome === 'function') window.runScanSTLHome();
      else window._pendingScanStlHome = true;
      return;
    }
    if (e.target.closest('#test-ai-config')) {
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.testAIConfigFromDialog === 'function') window.testAIConfigFromDialog();
      return;
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _attachEarlyButtonHandlers);
} else {
  _attachEarlyButtonHandlers();
}

// Stub so "Scan STL Home" click always has something to call; replaced by real impl when main block runs
window.runScanSTLHome = function() {
  if (typeof window._runScanSTLHomeImpl === 'function') {
    window._runScanSTLHomeImpl();
    return;
  }
  window._pendingScanStlHome = true;
  console.log('[Scan STL Home] runScanSTLHome not ready yet, queued');
};

// Ensure window.electron exists before any usage to avoid early crashes in server mode
if (typeof window !== 'undefined') {
  window.electron = window.electron || {};
  if (typeof window.electron.on !== 'function') {
    window.electron.on = function() {};
  }
}

// Early event listener pattern for Docker/Server: register listeners before DOMContentLoaded
// so events broadcast from server (e.g. menu clicks) are never "No listeners registered"
window._electronRealEventHandlers = {};
window._electronPendingEvents = {};
const earlyEventChannels = [
  'open-theme-settings', 'regenerate-thumbnails', 'generate-missing-thumbnails',
  'start-print-roulette', 'open-dedup', 'open-tag-manager', 'open-stats',
  'open-backup-restore', 'open-ai-config', 'open-file-type-settings', 'open-performance-settings',
  'open-slicer-settings', 'open-browser-extension-settings', 'open-purge-models',
  'open-metadata-editor', 'open-system-report', 'open-manage-thumbnails',
  'open-settings', 'open-guide', 'open-about', 'open-keyboard-shortcuts',
  'open-server-mode-info',
  'puter-ai-chat-request',
  'tags-generated', 'start-single-tag-generation', 'start-batch-tag-generation', 'batch-tag-generation-complete',
  'thumbnail-job-progress', 'thumbnail-job-complete', 'thumbnail-job-error',
  'run-server-thumbnail-job', 'cancel-server-thumbnail-job'
];
earlyEventChannels.forEach(function(channel) {
  window.electron.on(channel, function() {
    const args = Array.prototype.slice.call(arguments);
    if (window._electronRealEventHandlers[channel]) {
      try {
        window._electronRealEventHandlers[channel].apply(null, args);
      } catch (err) {
        console.error('[Bridge] Early handler error for', channel, err);
      }
    } else {
      if (!window._electronPendingEvents[channel]) {
        window._electronPendingEvents[channel] = [];
      }
      window._electronPendingEvents[channel].push(args);
      console.debug('[Bridge] Event', channel, 'queued (real handler not ready yet).');
    }
  });
});

// Performance dialog: register before main DOMContentLoaded async work (avoids menu IPC race + bridge log)
window._openPerformanceSettingsDialog = async function _openPerformanceSettingsDialog() {
  const dialog = document.getElementById('performance-settings-dialog');
  if (!dialog) return;
  try {
    if (window.electron && typeof window.electron.getSetting === 'function') {
      const maxFileSize = (await window.electron.getSetting('maxFileSizeMB')) || '50';
      const input = document.getElementById('max-file-size');
      if (input) input.value = maxFileSize;
    }
  } catch (e) {
    console.error('Error loading performance settings for dialog:', e);
  }
  try {
    dialog.showModal();
  } catch (e) {
    console.error('Error opening performance settings dialog:', e);
  }
};
window._electronRealEventHandlers['open-performance-settings'] = function() {
  window._openPerformanceSettingsDialog();
};

// File Type Settings: expose save early so Save button onclick works in Docker/server (before DOMContentLoaded block runs)
window.saveFileTypeSettingsFromDialog = async function saveFileTypeSettingsFromDialog() {
  const dialogEl = document.getElementById('file-type-settings-dialog');
  if (!dialogEl || !window.electron?.saveSetting) return;
  try {
    // Get previously saved scan types to detect unchecked (removed) types
    let previousIds = [];
    try {
      const previousRaw = await window.electron.getSetting('scanAdditionalFileTypes');
      if (previousRaw) previousIds = JSON.parse(previousRaw);
    } catch (e) { /* ignore */ }

    const ADDITIONAL_SCAN_TYPE_IDS = ['3ds', 'amf', 'blender', 'dae', 'dxf', 'dwg', 'fbx', 'f3d', 'f3z', 'gcode', 'igs', 'lys', 'obj', 'ply', 'step', 'svg', 'x3d'];
    const selectedScanTypes = [];
    for (const id of ADDITIONAL_SCAN_TYPE_IDS) {
      const el = dialogEl.querySelector('#scan-type-' + id) || document.getElementById('scan-type-' + id);
      if (el && el.checked) selectedScanTypes.push(id);
    }
    const uncheckedIds = previousIds.filter(id => !selectedScanTypes.includes(id));

    if (uncheckedIds.length > 0 && window.electron?.getModelCountByFileTypeIds && window.electron?.removeModelsByFileTypeIds) {
      const count = await window.electron.getModelCountByFileTypeIds(uncheckedIds);
      if (count > 0) {
        const catalog = await window.electron.getAdditionalFileTypesCatalog().catch(() => []);
        const labels = uncheckedIds.map(id => (catalog.find(e => e.id === id) || {}).label || id).join(', ');
        const message = count === 1
          ? `Unchecking "${labels}" will remove 1 file of that type from the library. This cannot be undone. Continue?`
          : `Unchecking ${labels} will remove ${count} files of those types from the library. This cannot be undone. Continue?`;
        const confirmResult = await window.electron.showMessage('Remove file type from library?', message, ['Yes', 'No']);
        if (confirmResult !== 'Yes') return;
        await window.electron.removeModelsByFileTypeIds(uncheckedIds);
        if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
      }
    }

    const checkbox = dialogEl.querySelector('#enable-zip-archives') || document.getElementById('enable-zip-archives');
    const enableZipArchives = checkbox?.checked ? '1' : '0';
    await window.electron.saveSetting('enableZipArchives', enableZipArchives);

    const scanTypesValue = JSON.stringify(selectedScanTypes);
    await window.electron.saveSetting('scanAdditionalFileTypes', scanTypesValue);

    const designerCheckbox = dialogEl.querySelector('#enable-3mf-designer') || document.getElementById('enable-3mf-designer');
    const parentModelCheckbox = dialogEl.querySelector('#enable-3mf-parent-model') || document.getElementById('enable-3mf-parent-model');
    const licenseCheckbox = dialogEl.querySelector('#enable-3mf-license') || document.getElementById('enable-3mf-license');
    const notesCheckbox = dialogEl.querySelector('#enable-3mf-notes') || document.getElementById('enable-3mf-notes');
    await window.electron.saveSetting('enable3MFDesigner', designerCheckbox?.checked ? '1' : '0');
    await window.electron.saveSetting('enable3MFParentModel', parentModelCheckbox?.checked ? '1' : '0');
    await window.electron.saveSetting('enable3MFLicense', licenseCheckbox?.checked ? '1' : '0');
    await window.electron.saveSetting('enable3MFNotes', notesCheckbox?.checked ? '1' : '0');

    if (typeof dialogEl.close === 'function') dialogEl.close();
    if (typeof window.populateFileTypeFilter === 'function') await window.populateFileTypeFilter();
  } catch (err) {
    console.error('File type settings save failed:', err);
    if (window.electron?.showMessage) await window.electron.showMessage('Error', 'Failed to save file type settings: ' + (err.message || String(err)));
  }
};

// Tag Manager & DeDup: fullscreen toggle (expose early so Full Screen button works in Docker/server mode)
window.toggleTagManagerFullscreen = function toggleTagManagerFullscreen() {
  const dialog = document.getElementById('tag-manager-dialog');
  const btn = document.getElementById('tag-manager-fullscreen-toggle');
  if (!dialog || !btn) return;
  dialog.classList.toggle('modal-fullscreen');
  btn.textContent = dialog.classList.contains('modal-fullscreen') ? 'Exit Full Screen' : 'Full Screen';
};
window.toggleDedupFullscreen = function toggleDedupFullscreen() {
  const dialog = document.getElementById('dedup-dialog');
  const btn = document.getElementById('dedup-fullscreen-toggle');
  if (!dialog || !btn) return;
  dialog.classList.toggle('modal-fullscreen');
  btn.textContent = dialog.classList.contains('modal-fullscreen') ? 'Exit Full Screen' : 'Full Screen';
};

// Purge Models: expose confirm action early so Purge button onclick works in Docker/server mode
window.confirmPurgeModelsFromDialog = async function confirmPurgeModelsFromDialog() {
  if (!window.electron?.purgeModels) return;
  try {
    const success = await window.electron.purgeModels({ confirmedInDialog: true });
    if (success) {
      const container = document.querySelector('.file-grid');
      if (container) container.innerHTML = '';
      if (typeof window.updateModelCounts === 'function') await window.updateModelCounts(0);
      const dialog = document.getElementById('purge-models-dialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
      if (window.electron?.showMessage) await window.electron.showMessage('Success', 'All models have been purged from the database.');
      const designerSelect = document.getElementById('designer-select');
      const parentSelect = document.getElementById('parent-select');
      const printedSelect = document.getElementById('printed-select');
      const newSelect = document.getElementById('new-select');
      const tagFilter = document.getElementById('tag-filter');
      if (designerSelect) designerSelect.value = '';
      if (parentSelect) parentSelect.value = '';
      if (printedSelect) printedSelect.value = 'all';
      if (newSelect) newSelect.value = 'all';
      if (tagFilter) tagFilter.value = '';
    }
  } catch (err) {
    console.error('Error purging models:', err);
    if (window.electron?.showMessage) await window.electron.showMessage('Error', 'Failed to purge models from the database.');
  }
};

// DeDup Easy: select all but one per group; keep archived (ZIP) when present (early for Docker/server)
window.dedupEasyFromDialog = function dedupEasyFromDialog() {
  if (typeof window.applyDedupEasySelection === 'function' && window._dedupVirtualState?.groups?.length) {
    window.applyDedupEasySelection();
    return;
  }
  const dialog = document.getElementById('dedup-dialog');
  if (!dialog) return;
  const groups = dialog.querySelectorAll('.duplicate-group');
  groups.forEach(function(group) {
    const fileRows = group.querySelectorAll('.duplicate-file');
    if (fileRows.length === 0) return;
    const zipRow = Array.from(fileRows).find(function(row) { return row.classList.contains('zip-entry'); });
    const keeperRow = zipRow || fileRows[0];
    fileRows.forEach(function(row) {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox || checkbox.disabled) return;
      checkbox.checked = row !== keeperRow;
      // Keep virtual selection in sync when falling back to DOM
      const fp = checkbox.getAttribute('data-filepath');
      if (fp && window._dedupVirtualState?.selectedPaths) {
        if (checkbox.checked) window._dedupVirtualState.selectedPaths.add(fp);
        else window._dedupVirtualState.selectedPaths.delete(fp);
      }
    });
  });
};

// DeDup Clear: uncheck all (early for Docker/server)
window.dedupClearFromDialog = function dedupClearFromDialog() {
  if (typeof window.clearDedupSelection === 'function' && window._dedupVirtualState) {
    window.clearDedupSelection();
    return;
  }
  const dialog = document.getElementById('dedup-dialog');
  if (!dialog) return;
  if (window._dedupVirtualState?.selectedPaths) {
    window._dedupVirtualState.selectedPaths.clear();
  }
  dialog.querySelectorAll('.duplicate-file input[type="checkbox"]:not(:disabled)').forEach(function(cb) {
    cb.checked = false;
  });
};

// Free large dedup payloads when the dialog closes (register early — DOMContentLoaded may abort before late listeners)
document.addEventListener('DOMContentLoaded', function() {
  const dedupDialog = document.getElementById('dedup-dialog');
  if (!dedupDialog || dedupDialog.dataset.dedupTeardownBound === '1') return;
  dedupDialog.dataset.dedupTeardownBound = '1';
  dedupDialog.addEventListener('close', function() {
    if (typeof window.teardownDedupVirtualList === 'function') {
      window.teardownDedupVirtualList();
    } else {
      window._dedupVirtualState = null;
    }
    const groupsEl = dedupDialog.querySelector('.duplicate-groups');
    if (groupsEl) groupsEl.innerHTML = '';
  });
});

// Backup/Restore/Export/Import: early-exposed for Docker/server button clicks
window.createBackupFromDialog = async function createBackupFromDialog() {
  if (!window.electron?.backupDatabase) return;
  try {
    const serverMode = await window.electron.isServerMode().catch(function() { return false; });
    if (serverMode) {
      const result = await window.electron.backupDatabase();
      if (result && result.success && result.filePath) {
        const downloadUrl = '/api/download/' + encodeURIComponent(result.filePath);
        window.location.href = downloadUrl;
        if (window.electron.showMessage) await window.electron.showMessage('Success', 'Database backup created successfully. Download should start shortly.');
      } else {
        if (window.electron.showMessage) await window.electron.showMessage('Error', result && result.message ? result.message : 'Failed to create database backup');
      }
      return;
    }
    const success = await window.electron.backupDatabase();
    if (success && window.electron.showMessage) await window.electron.showMessage('Success', 'Database backup created successfully');
  } catch (err) {
    console.error('Backup error:', err);
    if (window.electron?.showMessage) await window.electron.showMessage('Error', 'Failed to create database backup');
  }
};

window.restoreBackupFromDialog = async function restoreBackupFromDialog() {
  if (typeof window._restoreBackupFromDialogImpl === 'function') {
    await window._restoreBackupFromDialogImpl();
  }
};

window.exportLibraryFromDialog = async function exportLibraryFromDialog() {
  if (!window.electron?.exportLibrary) return;
  try {
    const serverMode = await window.electron.isServerMode().catch(function() { return false; });
    if (serverMode) {
      const result = await window.electron.exportLibrary();
      if (result && result.success && result.filePath) {
        window.location.href = '/api/download/' + encodeURIComponent(result.filePath);
        if (window.electron.showMessage) await window.electron.showMessage('Success', 'Library exported successfully. Download should start shortly.');
      } else {
        if (window.electron.showMessage) await window.electron.showMessage('Error', result && result.message ? result.message : 'Failed to export library');
      }
      return;
    }
    const success = await window.electron.exportLibrary();
    if (success && window.electron.showMessage) await window.electron.showMessage('Success', 'Library exported successfully');
  } catch (err) {
    console.error('Export library error:', err);
    if (window.electron?.showMessage) await window.electron.showMessage('Error', 'Failed to export library');
  }
};

window.importLibraryFromDialog = async function importLibraryFromDialog() {
  if (typeof window._importLibraryFromDialogImpl === 'function') {
    await window._importLibraryFromDialogImpl();
  }
};

// AI Config: Test and Save (early for Docker/server)
window.testAIConfigFromDialog = async function testAIConfigFromDialog() {
  const resultDiv = document.getElementById('ai-config-result');
  if (resultDiv) resultDiv.textContent = 'Testing...';
  if (!window.electron || typeof window.electron.testAIConfig !== 'function') {
    if (resultDiv) resultDiv.textContent = 'Error: AI config not available (not connected?).';
    if (window.electron?.showMessage) await window.electron.showMessage('Error', 'AI config test is not available.');
    return;
  }
  const apiKeyEl = document.getElementById('ai-api-key');
  const endpointEl = document.getElementById('ai-endpoint');
  const modelEl = document.getElementById('ai-model');
  const serviceEl = document.getElementById('ai-service-select');
  if (!apiKeyEl || !endpointEl || !modelEl || !serviceEl) {
    if (resultDiv) resultDiv.textContent = 'Error: Form fields not found.';
    return;
  }
  const selectedOption = serviceEl.options && serviceEl.options[serviceEl.selectedIndex];
  let service = selectedOption ? selectedOption.value : (serviceEl.value || 'puter');
  const endpoint = (endpointEl.value || '').trim();
  if (endpoint.indexOf('puter.com') !== -1 || endpoint.indexOf('js.puter.com') !== -1) {
    service = 'puter';
  }
  const apiKey = (apiKeyEl.value || '').trim();
  const model = (modelEl.value || '').trim() || (service === 'puter' ? 'gpt-5-nano' : '');
  try {
    const result = await window.electron.testAIConfig(apiKey, endpoint, model, service);
    if (resultDiv) {
      resultDiv.textContent = result.success ? 'Test successful! Tags: ' + (result.tags ? result.tags.join(', ') : '') : 'Test failed: ' + (result.error || '');
    }
  } catch (err) {
    console.error('AI Config test error:', err);
    if (resultDiv) resultDiv.textContent = 'Test failed: ' + (err.message || String(err));
    if (window.electron?.showMessage) await window.electron.showMessage('Error', err.message || 'Test failed');
  }
};

window.saveAIConfigFromDialog = async function saveAIConfigFromDialog() {
  if (!window.electron?.saveSetting) return;
  const service = (document.getElementById('ai-service-select') && document.getElementById('ai-service-select').value) || 'puter';
  const apiKey = service === 'puter' ? '' : ((document.getElementById('ai-api-key') && document.getElementById('ai-api-key').value) || '');
  const endpoint = (document.getElementById('ai-endpoint') && document.getElementById('ai-endpoint').value) || (service === 'puter' ? 'https://js.puter.com/v2/' : 'https://api.openai.com/v1');
  const model = (document.getElementById('ai-model') && document.getElementById('ai-model').value) || (service === 'puter' ? 'gpt-5-nano' : 'gpt-4o-mini');
  const maxTags = (document.getElementById('ai-tag-max-tags') && document.getElementById('ai-tag-max-tags').value) || '10';
  const mergeStrategy = (document.getElementById('ai-tag-merge-strategy') && document.getElementById('ai-tag-merge-strategy').value) || 'merge';
  const useCategories = document.getElementById('ai-tag-use-categories') && document.getElementById('ai-tag-use-categories').checked ? '1' : '0';
  const allowRetagging = document.getElementById('ai-tag-allow-retagging') && document.getElementById('ai-tag-allow-retagging').checked ? '1' : '0';
  const concurrency = (document.getElementById('ai-tag-concurrency') && document.getElementById('ai-tag-concurrency').value) || '3';
  const detailLevel = (document.getElementById('ai-tag-detail-level') && document.getElementById('ai-tag-detail-level').value) || 'medium';
  try {
    await window.electron.saveSetting('apiKey', apiKey);
    await window.electron.saveSetting('apiEndpoint', endpoint);
    await window.electron.saveSetting('aiModel', model);
    await window.electron.saveSetting('aiService', service);
    await window.electron.saveSetting('aiTagMaxTags', maxTags);
    await window.electron.saveSetting('aiTagMergeStrategy', mergeStrategy);
    await window.electron.saveSetting('aiTagUseCategories', useCategories);
    await window.electron.saveSetting('aiTagAllowRetagging', allowRetagging);
    await window.electron.saveSetting('aiTagConcurrency', concurrency);
    await window.electron.saveSetting('aiTagDetailLevel', detailLevel);
    const dialog = document.getElementById('ai-config-dialog');
    if (dialog && typeof dialog.close === 'function') dialog.close();
  } catch (err) {
    console.error('Save AI config error:', err);
    if (window.electron?.showMessage) await window.electron.showMessage('Error', err.message || 'Failed to save');
  }
};

// Performance Save (early for Docker/server)
window.savePerformanceSettingsFromDialog = async function savePerformanceSettingsFromDialog() {
  if (!window.electron?.saveSetting) return;
  const maxFileSizeEl = document.getElementById('max-file-size');
  if (!maxFileSizeEl) {
    if (window.electron?.showMessage) await window.electron.showMessage('Error', 'Could not find max file size input');
    return;
  }
  const newMaxFileSize = parseMaxFileSizeMBInput(maxFileSizeEl.value);
  try {
    if (newMaxFileSize == null) {
      throw new Error('Invalid max file size. Must be at least 1 MB.');
    }
    await window.electron.saveSetting('maxFileSizeMB', String(newMaxFileSize));
    MAX_FILE_SIZE_MB = newMaxFileSize;
    const dialog = document.getElementById('performance-settings-dialog');
    if (dialog && typeof dialog.close === 'function') dialog.close();
    if (window.electron.showMessage) await window.electron.showMessage('Success', 'Performance settings saved successfully');
  } catch (err) {
    console.error('Performance save error:', err);
    if (window.electron?.showMessage) await window.electron.showMessage('Error', err.message || 'Failed to save');
  }
};

// STL Home Clear Directory (early for Docker/server)
window.clearSTLHomeDirectory = async function clearSTLHomeDirectory() {
  const input = document.getElementById('stl-home-directory');
  if (input) input.value = '';
  if (window.electron?.saveSetting) await window.electron.saveSetting('stlHome', '');
  if (typeof window.updateScanStlHomeButtonVisibility === 'function') window.updateScanStlHomeButtonVisibility();
  if (typeof window.stopPeriodicSTLHomeScan === 'function') window.stopPeriodicSTLHomeScan();
  const dialog = document.getElementById('stl-home-dialog');
  if (dialog && typeof dialog.close === 'function') dialog.close();
};

// Lazy load Puter.js only when needed to avoid unnecessary socket.io connections
let puterLoadingPromise = null;
function isPuterJsSupportedHere() {
  const protocol = window.location && window.location.protocol;
  return protocol === 'http:' || protocol === 'https:';
}

async function loadPuterJS() {
  if (!isPuterJsSupportedHere()) {
    throw new Error('Puter.com AI is unavailable in this view (file:// protocol). Restart the desktop app or use Server Mode in a browser.');
  }

  // If already loaded, return immediately
  if (typeof puter !== 'undefined' && puter && puter.ai) {
    console.log('[Puter] Puter.js already loaded');
    return Promise.resolve();
  }
  
  // If already loading, return the existing promise
  if (puterLoadingPromise) {
    console.log('[Puter] Puter.js already loading, waiting...');
    return puterLoadingPromise;
  }
  
  // Check if script tag already exists
  const existingScript = document.querySelector('script[src="https://js.puter.com/v2/"]');
  if (existingScript) {
    console.log('[Puter] Puter.js script tag already exists, waiting for load...');
    puterLoadingPromise = new Promise((resolve, reject) => {
      let retries = 0;
      const maxRetries = 50; // 5 seconds
      const checkInterval = setInterval(() => {
        retries++;
        if (typeof puter !== 'undefined' && puter && puter.ai) {
          clearInterval(checkInterval);
          puterLoadingPromise = null;
          console.log('[Puter] Puter.js loaded successfully');
          resolve();
        } else if (retries >= maxRetries) {
          clearInterval(checkInterval);
          puterLoadingPromise = null;
          reject(new Error('Puter.js failed to load within timeout'));
        }
      }, 100);
    });
    return puterLoadingPromise;
  }
  
  // Load Puter.js dynamically
  console.log('[Puter] Loading Puter.js dynamically...');
  puterLoadingPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;
    script.onload = () => {
      // Wait for puter object to be available
      let retries = 0;
      const maxRetries = 50; // 5 seconds
      const checkInterval = setInterval(() => {
        retries++;
        if (typeof puter !== 'undefined' && puter && puter.ai) {
          clearInterval(checkInterval);
          puterLoadingPromise = null;
          console.log('[Puter] Puter.js loaded and initialized successfully');
          resolve();
        } else if (retries >= maxRetries) {
          clearInterval(checkInterval);
          puterLoadingPromise = null;
          reject(new Error('Puter.js loaded but puter object not available'));
        }
      }, 100);
    };
    script.onerror = () => {
      puterLoadingPromise = null;
      console.error('[Puter] Failed to load Puter.js');
      reject(new Error('Failed to load Puter.js script'));
    };
    document.head.appendChild(script);
  });
  
  return puterLoadingPromise;
}

/** True when Puter API must be reached via our server proxy (not https://puter.com origin). */
function needsPuterProxy() {
  const loc = window.location;
  if (!loc || loc.protocol === 'file:') return false;
  const host = (loc.hostname || '').toLowerCase();
  return host !== 'puter.com' && host !== 'www.puter.com';
}

function extractPuterResponseText(response) {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object') {
    return response.text || response.content || response.message || JSON.stringify(response);
  }
  return String(response || '');
}

function mapPuterApiError(apiError) {
  const msg = apiError && apiError.message ? String(apiError.message) : '';
  if (msg.includes('timeout') || msg.includes('Network') || msg.includes('Failed to fetch')) {
    return new Error('Network error: Unable to connect to Puter.com API. Please check your internet connection. If running in Docker, ensure the container or browser has internet access.');
  }
  if (msg.includes('CORS') || msg.includes('Access-Control-Allow-Origin')) {
    return new Error('Puter.com API blocked by browser CORS policy. The server proxy should handle this — try refreshing the page.');
  }
  if (msg.includes('403')) {
    return new Error('Puter.com API access denied (403). This may be due to CORS restrictions or API limitations. Please try using a different AI service or check puter.com documentation.');
  }
  if (msg.includes('Forbidden')) {
    return new Error('Puter.com API access forbidden. This service may require additional setup or have usage restrictions.');
  }
  return apiError;
}

/** Call Puter AI — uses server proxy on localhost to avoid CORS; direct puter.ai.chat on puter.com. */
async function callPuterAI(prompt, imageUrl, model) {
  await loadPuterJS();
  let retries = 0;
  const maxRetries = 10;
  while ((typeof puter === 'undefined' || !puter.ai) && retries < maxRetries) {
    await new Promise((r) => setTimeout(r, 100));
    retries++;
  }
  if (typeof puter === 'undefined' || !puter.ai) {
    throw new Error('Puter.js is not loaded. Please refresh the application.');
  }

  const modelName = model || 'gpt-5-nano';
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Network timeout: Unable to reach Puter.com API. Please check your internet connection.')), 55000);
  });

  if (needsPuterProxy()) {
    if (!puter.authToken && puter.ui && typeof puter.ui.authenticateWithPuter === 'function') {
      console.log('[Puter AI] Authenticating with Puter.com (captcha may appear)...');
      await puter.ui.authenticateWithPuter();
    }
    const proxyCall = fetch('/api/puter-ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        imageUrl: imageUrl || null,
        model: modelName,
        authToken: puter.authToken || null
      })
    }).then(async (resp) => {
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const err = new Error(data.error || `Puter AI proxy error (${resp.status})`);
        if (data.code) err.code = data.code;
        throw err;
      }
      return data.response;
    });
    return await Promise.race([proxyCall, timeoutPromise]);
  }

  if (!puter.ai.chat) {
    throw new Error('Puter.js AI chat is not available. Please refresh the application.');
  }
  return await Promise.race([
    puter.ai.chat(prompt, imageUrl, { model: modelName }),
    timeoutPromise
  ]);
}

// Assign puter-ai-chat-request handler early so Test (Puter) works in Docker/server before DOMContentLoaded
window._electronRealEventHandlers['puter-ai-chat-request'] = async function(requestId, prompt, imageUrl, model) {
  console.log('[Puter AI] Received request, Puter.js captcha may appear in this window');
  try {
    const response = await callPuterAI(prompt, imageUrl, model);
    const responseText = extractPuterResponseText(response);
    console.log('[Puter AI] Sending response back, requestId:', requestId, 'response length:', responseText ? responseText.length : 0);
    window.electron.send('puter-ai-chat-response', requestId, { response: responseText });
  } catch (error) {
    console.error('[Puter AI] Error calling puter.ai.chat:', error);
    const mapped = mapPuterApiError(error);
    const errorMessage = mapped.message || 'Unknown error';
    window.electron.send('puter-ai-chat-response', requestId, { error: errorMessage });
  }
};

// Minimal handlers for tag-preview so dialog opens when events arrive before late block (Docker/Server)
window._electronRealEventHandlers['start-single-tag-generation'] = function(filePath, modelData) {
  var dialog = document.getElementById('tag-preview-dialog');
  if (dialog && !dialog.open) {
    dialog.showModal();
    var container = document.getElementById('tag-preview-container');
    if (container) container.innerHTML = '<div style="padding: 20px; color: #fff;">Generating tags...</div>';
  }
};
window._electronRealEventHandlers['start-batch-tag-generation'] = function(count, filePaths) {
  var dialog = document.getElementById('tag-preview-dialog');
  if (dialog && !dialog.open) {
    dialog.showModal();
    var container = document.getElementById('tag-preview-container');
    if (container) container.innerHTML = '<div style="padding: 20px; color: #fff;">Generating tags for ' + (count || 0) + ' model(s)...</div>';
  }
};

// Add debug logging utility function
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Above this many scan hits without thumbnails, skip bulk scan-time rendering; grid queues thumbs when cells mount.
const DEFER_SCAN_BATCH_THUMBNAILS_THRESHOLD = 80;

let BATCH_SIZE = 50; // Default batch size for database operations
let MAX_FILE_SIZE_MB = 50; // Default max file size in MB
const THUMBNAIL_BATCH_SIZE = 10; // Default batch size for thumbnails
// Higher concurrency in Server/Docker mode to compensate for slower file system operations
// Docker file system operations (especially on network shares) can be 10-100ms per operation
// vs <1ms for local file systems, so we need more parallel operations to maintain throughput
let MAX_CONCURRENT_RENDERS = 5; // Default value, will be adjusted based on mode

const MAX_MODELS_IN_MEMORY = 500;
const PAGE_SIZE = 100; // Number of models to keep in memory
let allFilteredModels = []; // Store all filtered models (references only)
let visibleModels = []; // Store currently visible models (full data)
let currentGridView = 'detailed'; // Current grid view mode: 'list', 'preview', 'detailed'

/** Preview wall tile size: small / medium / large (persisted as previewTileSize). */
let currentPreviewTileSize = 'm';
const PREVIEW_TILE_PX = { s: 140, m: 180, l: 240 };
const PREVIEW_COLUMNS = { s: 10, m: 6, l: 4 };

/**
 * Fixed preview columns per size; tile dimension scales to fill row width.
 * S → 10 columns; M → 6 columns; L → 4 columns.
 */
function computePreviewTilePxFromWidth(availableWidth, horizontalGap = 2) {
  const g = horizontalGap;
  const aw = Math.max(0, availableWidth);
  const cols = PREVIEW_COLUMNS[currentPreviewTileSize] || PREVIEW_COLUMNS.m;
  if (cols <= 0) return PREVIEW_TILE_PX.m;

  // Use fixed column count and scale tile so the row fills available width.
  const computed = Math.floor((aw - (cols - 1) * g) / cols);
  return Math.max(1, computed);
}

function getPreviewTileSizePx() {
  const grid = document.querySelector('.file-grid');
  if (
    currentGridView === 'preview' &&
    grid &&
    typeof grid._previewTilePx === 'number' &&
    grid._previewTilePx > 0
  ) {
    return grid._previewTilePx;
  }
  return PREVIEW_TILE_PX[currentPreviewTileSize] || PREVIEW_TILE_PX.m;
}

function getPreviewTileDims() {
  const tile = getPreviewTileSizePx();
  return { width: tile, height: tile, itemWidth: tile };
}

// Per-folder view preference (when "View Entire Library" is off): remember list/preview/detailed per scanned root
async function getPerFolderViewPrefs() {
  try {
    const raw = await window.electron.getSetting('perFolderView');
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_) {
    return {};
  }
}

async function getViewForFolder(folderPath) {
  if (!folderPath) return null;
  const prefs = await getPerFolderViewPrefs();
  if (prefs[folderPath] && ['list', 'preview', 'detailed'].includes(prefs[folderPath])) {
    return prefs[folderPath];
  }
  const lastUsed = await window.electron.getSetting('lastUsedView');
  if (lastUsed && ['list', 'preview', 'detailed'].includes(lastUsed)) return lastUsed;
  const globalView = await window.electron.getSetting('gridView');
  if (globalView && ['list', 'preview', 'detailed'].includes(globalView)) return globalView === 'small' ? 'preview' : globalView;
  return 'detailed';
}

async function savePerFolderView(folderPath, view) {
  if (!folderPath || !['list', 'preview', 'detailed'].includes(view)) return;
  const prefs = await getPerFolderViewPrefs();
  prefs[folderPath] = view;
  await window.electron.saveSetting('perFolderView', JSON.stringify(prefs));
  await window.electron.saveSetting('lastUsedView', view);
}

async function applyViewForCurrentFolder() {
  const folder = window.currentDirectoryFilter;
  if (!folder) return;
  const view = await getViewForFolder(folder);
  if (!view || view === currentGridView) return;
  currentGridView = view;
  const viewButtons = document.querySelectorAll('.view-button');
  viewButtons.forEach(btn => btn.classList.remove('active'));
  viewButtons.forEach(button => {
    if (button.dataset.view === currentGridView) button.classList.add('active');
  });
  updateListViewColumnsToolbarButton();
}

window.savePerFolderView = savePerFolderView;
window.applyViewForCurrentFolder = applyViewForCurrentFolder;

let currentPage = 0;
let isVirtualScrolling = false; // Flag to track if virtual scrolling is active

const DEFAULT_SORT = 'dateAdded DESC'; // Show newest models by default

// RENDER_DELAY is already declared later in the file
let currentBatch = 0;
let isRendering = false;
let selectedModels = new Set();
let isMultiSelectMode = false;
let isScanning = false;

// Scan STL Home: define at top level so it's ready before DOMContentLoaded handler runs (avoids "not ready yet, queued" in Docker/server)
function runScanSTLHomeImpl() {
  console.log('[Scan STL Home] runScanSTLHome entered');
  if (isScanning) {
    console.log('[Scan STL Home] skipped - already scanning');
    return;
  }
  (async () => {
    const stlHome = await window.electron.getSetting('stlHome');
    if (!stlHome || stlHome.trim() === '') {
      console.log('[Scan STL Home] no path set');
      if (window.electron && typeof window.electron.showMessage === 'function') {
        await window.electron.showMessage('STL Home', 'Set STL Home path in Settings first (Settings → STL Home).');
      }
      return;
    }
    console.log('[Scan STL Home] starting scan:', stlHome);
    await window.electron.saveDirectory(stlHome.trim());
    const clearFilterButton = document.querySelector('.clear-filter-button');
    if (clearFilterButton) {
      clearFilterButton.click();
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const scanButton = document.getElementById('scan-directory-button');
    const stlHomeButton = document.getElementById('scan-stl-home-button');
    if (scanButton) { scanButton.disabled = true; scanButton.style.opacity = '0.5'; scanButton.style.cursor = 'not-allowed'; }
    if (stlHomeButton) { stlHomeButton.disabled = true; stlHomeButton.style.opacity = '0.5'; stlHomeButton.style.cursor = 'not-allowed'; }
    isScanning = true;
    showProgressBars();
    let lastScanProcessed = 0;
    window.electron.onScanProgress((progress) => {
      const processedRaw = typeof progress?.processed === 'number' ? progress.processed : 0;
      lastScanProcessed = Math.max(lastScanProcessed, processedRaw);
      const percent = progress.total ? (lastScanProcessed / progress.total) * 100 : 0;
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `Checking files: ${lastScanProcessed}`;
    });
    window.electron.onDbProgress((progress) => {
      if (window._scanThumbnailProgress) return; // Thumbnail phase drives progress so bar stays in sync with renders
      const percent = progress.total ? (progress.processed / progress.total) * 100 : 0;
      const renderProgressBar = document.getElementById('render-progress-bar');
      const renderProgressText = document.getElementById('render-progress-text');
      if (renderProgressBar) renderProgressBar.style.width = `${percent}%`;
      if (renderProgressText) renderProgressText.textContent = progress.processed + ' / ' + (progress.total || 0);
    });
    try {
      await scanAndRenderDirectory(stlHome.trim(), false, true);
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();
      console.log('[Scan STL Home] scan complete');
    } catch (err) {
      console.error('[Scan STL Home] scan error:', err);
      if (window.electron && typeof window.electron.showMessage === 'function') {
        await window.electron.showMessage('Scan STL Home Error', err.message || String(err));
      }
    } finally {
      isScanning = false;
      if (scanButton) { scanButton.disabled = false; scanButton.style.opacity = ''; scanButton.style.cursor = ''; }
      if (stlHomeButton) { stlHomeButton.disabled = false; stlHomeButton.style.opacity = ''; stlHomeButton.style.cursor = ''; }
      const progressSection = document.getElementById('progress-section');
      if (progressSection) progressSection.classList.add('hidden');
      // Force grid to refetch and re-render so models show without reload (Docker/server)
      window.disableGridRefresh = false;
      const gridEl = document.querySelector('.file-grid');
      if (gridEl) gridEl.currentModels = null;
      if (typeof window.forceGridRefresh === 'function') {
        window.forceGridRefresh().catch(err => console.error('[Scan STL Home] post-scan refresh:', err));
      } else if (typeof window.performCombinedSearch === 'function') {
        window.performCombinedSearch().catch(err => console.error('[Scan STL Home] post-scan refresh:', err));
      }
    }
  })();
}
window._runScanSTLHomeImpl = runScanSTLHomeImpl;

// Add these queue-related variables
let renderQueue = [];
/** Lower values run first. Scan / off-grid work uses THUMB_PRIORITY_BACKGROUND so on-screen grid cells win. */
const THUMB_PRIORITY_BACKGROUND = 1e12;
/** Priorities at or above this are off-viewport grid rows (see computeThumbPriorityForScroll / refresh). */
const THUMB_PRIORITY_LOW_TIER_MIN = 2e9;
/** Extra delay after each low-priority render so visible/interactive work stays smooth. */
let RENDER_DELAY_BACKGROUND = 750;
/** When the queue has only off-screen work, cap parallel WebGL thumbs (foreground uses MAX_CONCURRENT_RENDERS). */
let MAX_CONCURRENT_RENDERS_BACKGROUND = 2;
let pendingThumbnails = new Set(); // Track files currently being rendered
/** Paths with an in-flight WebGL/extract job (dequeued). Kept separate so prune cannot clear pending and allow a duplicate concurrent render. */
let activeThumbnailRenders = new Set();
/** Soft cap so fast scrolling cannot enqueue thousands of 3MF extract/WebGL jobs. */
const RENDER_QUEUE_SOFT_CAP = 120;

function isBenignThumbnailDropError(error) {
  const msg = (error && error.message) ? String(error.message) : String(error || '');
  return /Render task pruned \(cell scrolled off-screen\)|Render task dropped \(queue soft cap\)/.test(msg)
    || !!(error && error.benignThumbnailDrop);
}

function dropRenderTask(task, reason) {
  if (!task) return;
  // Only free the pending slot when nothing is actively rendering this path.
  // Otherwise a virtual-grid rebuild can re-enqueue the same file mid-render.
  if (task.filePath && !activeThumbnailRenders.has(task.filePath)) {
    pendingThumbnails.delete(task.filePath);
  }
  // Scan/bulk waiters must not hang forever if a task is discarded.
  if (typeof task.reject === 'function') {
    try {
      const err = new Error(reason || 'Render task dropped');
      err.benignThumbnailDrop = true;
      task.reject(err);
    } catch (_) { /* already settled */ }
  }
  // Soft-cap / prune often leaves a still-visible cell on 3d.png — re-hydrate next frame.
  scheduleVisibleThumbnailHydrate();
}

let _visibleThumbHydrateTimer = null;
function scheduleVisibleThumbnailHydrate() {
  if (_visibleThumbHydrateTimer != null) return;
  _visibleThumbHydrateTimer = setTimeout(() => {
    _visibleThumbHydrateTimer = null;
    const grid = document.querySelector('.file-grid');
    if (grid && typeof grid.renderVisibleItemsFn === 'function') {
      try {
        grid.renderVisibleItemsFn();
      } catch (_) { /* ignore */ }
    }
  }, 50);
}

function findQueuedThumbnailTask(filePath) {
  if (!filePath) return null;
  for (let i = 0; i < renderQueue.length; i++) {
    const task = renderQueue[i];
    if (task && task.filePath === filePath && !task.retainDetached) return task;
  }
  return null;
}

/**
 * Re-queue thumbnail work for an on-screen cell that still shows the placeholder.
 * Virtual-grid keeps existing DOM nodes across scroll frames, so pruned/soft-capped
 * jobs would otherwise never start again until the cell is destroyed and recreated.
 */
function ensureVisibleThumbnailQueued(itemEl, model, thumbPriority) {
  if (window._serverBulkThumbnailJobActive) return false;
  if (!itemEl || !model || !model.filePath) return false;
  if (model.hasThumbnail) return false;

  const thumbContainer = itemEl.querySelector('.thumbnail-container');
  if (!thumbContainer) return false;
  const img = thumbContainer.querySelector('img');
  if (img && typeof img.src === 'string' && img.src.startsWith('data:image')) return false;

  const queued = findQueuedThumbnailTask(model.filePath);
  if (queued) {
    queued.container = thumbContainer;
    if (thumbPriority != null) queued.thumbPriority = thumbPriority;
    pendingThumbnails.add(model.filePath);
    return true;
  }
  if (activeThumbnailRenders.has(model.filePath)) {
    pendingThumbnails.add(model.filePath);
    return false;
  }
  // Stale pending bit (dropped while a race left the flag set)
  if (pendingThumbnails.has(model.filePath)) {
    pendingThumbnails.delete(model.filePath);
  }

  pendingThumbnails.add(model.filePath);
  enqueueRenderTask({
    filePath: model.filePath,
    container: thumbContainer,
    thumbPriority: thumbPriority != null ? thumbPriority : 0,
    resolve: async (thumbnail) => {
      pendingThumbnails.delete(model.filePath);
      if (!thumbnail || thumbnail === '3d.png' || isFailurePlaceholderThumbnail(thumbnail)) {
        scheduleVisibleThumbnailHydrate();
        return;
      }
      if (await isMostlyEmptyThumbnailDataUrl(thumbnail)) {
        scheduleVisibleThumbnailHydrate();
        return;
      }
      model.thumbnail = thumbnail;
      model.hasThumbnail = true;
      invalidatePrimaryThumbnailCache(model.filePath);
      setCachedPrimaryThumbnail(model.filePath, thumbnail);
      try {
        await window.electron.saveThumbnail(model.filePath, thumbnail);
      } catch (_) { /* ignore */ }

      const normalizedModelPath = normalizePathForComparison(model.filePath);
      const allFileItems = document.querySelectorAll('.file-item');
      for (const fileItem of allFileItems) {
        const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
        if (normalizePathForComparison(itemPath) !== normalizedModelPath) continue;
        const liveImg = fileItem.querySelector('.thumbnail-container img');
        if (liveImg) liveImg.src = thumbnail;
        break;
      }
    },
    reject: (error) => {
      if (isBenignThumbnailDropError(error)) {
        scheduleVisibleThumbnailHydrate();
        return;
      }
      pendingThumbnails.delete(model.filePath);
      console.error(`Failed to generate thumbnail for ${model.filePath}`, error);
      scheduleVisibleThumbnailHydrate();
    }
  });
  return true;
}

function enqueueRenderTask(task) {
  if (!task || !task.filePath) return false;
  pruneDisconnectedRenderTasks();
  if (renderQueue.length >= RENDER_QUEUE_SOFT_CAP) {
    // Drop lowest-priority (usually off-screen) tasks first.
    // Never soft-cap-drop scan/bulk jobs that intentionally use detached containers.
    renderQueue.sort((a, b) => (a.thumbPriority ?? 1e9) - (b.thumbPriority ?? 1e9));
    while (renderQueue.length >= RENDER_QUEUE_SOFT_CAP) {
      let dropIdx = -1;
      for (let i = renderQueue.length - 1; i >= 0; i--) {
        if (!renderQueue[i]?.retainDetached) {
          dropIdx = i;
          break;
        }
      }
      if (dropIdx < 0) break;
      const dropped = renderQueue.splice(dropIdx, 1)[0];
      dropRenderTask(dropped, 'Render task dropped (queue soft cap)');
    }
  }
  renderQueue.push(task);
  return true;
}

function isLowPriorityThumbnailTask(task) {
  const p = task?.thumbPriority ?? THUMB_PRIORITY_BACKGROUND;
  return p >= THUMB_PRIORITY_LOW_TIER_MIN;
}

function renderQueueHasOnlyLowPriorityWork() {
  if (renderQueue.length === 0) return false;
  return renderQueue.every(isLowPriorityThumbnailTask);
}

function effectiveMaxConcurrentRenders() {
  // While a Docker/server bulk thumb job runs in the hidden window, pause grid
  // WebGL renders so scrolling does not OOM the shared Electron process.
  if (window._serverBulkThumbnailJobActive) {
    return 0;
  }
  return renderQueueHasOnlyLowPriorityWork()
    ? Math.min(MAX_CONCURRENT_RENDERS, MAX_CONCURRENT_RENDERS_BACKGROUND)
    : MAX_CONCURRENT_RENDERS;
}

function computeThumbPriorityForScroll(scrollTop, clientHeight, itemContentY, itemHeight, col = 0) {
  const EPS = 1;
  const itemBottom = itemContentY + itemHeight;
  if (itemBottom <= scrollTop + EPS) {
    return 3e9 + itemContentY + col * 1e-6;
  }
  if (itemContentY >= scrollTop + clientHeight - EPS) {
    return 2e9 + itemContentY + col * 1e-6;
  }
  return itemContentY - scrollTop + col * 1e-6;
}

function refreshThumbnailQueuePriorities() {
  const grid = document.querySelector('.file-grid');
  if (!grid || renderQueue.length === 0) return;
  const gr = grid.getBoundingClientRect();
  const vh = grid.clientHeight;
  const NEAR = 80;
  for (const task of renderQueue) {
    if (!task || !task.container) continue;
    if (!task.container.isConnected) continue;
    const tr = task.container.getBoundingClientRect();
    const relTop = tr.top - gr.top;
    const relBottom = tr.bottom - gr.top;
    if (relBottom < -NEAR) task.thumbPriority = 3e9 + relTop;
    else if (relTop > vh + NEAR) task.thumbPriority = 2e9 + relTop;
    else task.thumbPriority = relTop;
  }
}

function pruneDisconnectedRenderTasks() {
  if (renderQueue.length === 0) return 0;
  let removed = 0;
  for (let i = renderQueue.length - 1; i >= 0; i--) {
    const task = renderQueue[i];
    // Scan / foreground batch thumbs use a detached dummy container on purpose.
    // Only prune scroll-hydrate jobs whose grid cell left the DOM (2.1.17 Docker fix).
    if (task?.retainDetached) continue;
    if (task?.container && !task.container.isConnected) {
      renderQueue.splice(i, 1);
      dropRenderTask(task, 'Render task pruned (cell scrolled off-screen)');
      removed++;
    }
  }
  return removed;
}

function dequeueNextRenderTask() {
  pruneDisconnectedRenderTasks();
  if (renderQueue.length === 0) return null;
  if (renderQueue.length === 1) return renderQueue.shift();
  let minIdx = 0;
  let minP = renderQueue[0].thumbPriority ?? THUMB_PRIORITY_BACKGROUND;
  for (let i = 1; i < renderQueue.length; i++) {
    const p = renderQueue[i].thumbPriority ?? THUMB_PRIORITY_BACKGROUND;
    if (p < minP) {
      minP = p;
      minIdx = i;
    }
  }
  return renderQueue.splice(minIdx, 1)[0];
}
// When set during scan, any thumbnail completion (scan or grid) increments progress so bar stays in sync with visible renders
window._scanThumbnailProgress = null;
let activeRenders = 0;
let isProcessingQueue = false;

// Add these at the top of the file
let isScanCancelled = false;
let isRenderCancelled = false;
let isBackgrounded = false;

// Add these at the top with other global variables
let RENDER_DELAY = 200; // Increase delay between renders to 200ms
let autoStartedRendering = false;
let thumbnailCache = new Map();
let sharedRenderer = null;
let renderContext = null;

// Inverted filter state - tracks which filters are inverted (NOT equal instead of equal)
let invertedFilters = window.invertedFilters || {
  tag: false,
  designer: false,
  license: false,
  parentModel: false,
  search: false
};
// Ensure search flag exists if window.invertedFilters was created earlier without it
if (invertedFilters.search === undefined) {
  invertedFilters.search = false;
}
// Expose inverted filters globally so search.js can read the state (keep the same object reference)
window.invertedFilters = invertedFilters;

// Define loadModel function at top level so it's available immediately (before DOMContentLoaded)
// Helper function to parse zip path format
function parseZipPath(filePath) {
  if (filePath.includes('::')) {
    const [zipPath, entryPath] = filePath.split('::');
    return { zipPath, entryPath, isZipEntry: true };
  }
  return { zipPath: filePath, entryPath: null, isZipEntry: false };
}

// Helper function to get model color based on settings
function getModelColor() {
  const colorSetting = window.currentRenderColor || '#cccccc';
  
  if (colorSetting === 'rainbow') {
    return new THREE.Color().setHSL(Math.random(), 1.0, 0.5);
  } else if (colorSetting === 'pastel-rainbow') {
    return new THREE.Color().setHSL(Math.random(), 1.0, 0.8);
  } else {
    return new THREE.Color(colorSetting);
  }
}

// Extensions that are valid for library (scan/add). Used for isValidFile.
const EXTENSIONS_VALID_FOR_LIBRARY = new Set(['.stl', '.3mf', '.3ds', '.amf', '.blender', '.dae', '.dxf', '.dwg', '.fbx', '.f3d', '.f3z', '.gcode', '.igs', '.iges', '.lys', '.lyt', '.obj', '.ply', '.step', '.stp', '.svg', '.x3d']);

// Map file extension (with or without dot) to label for typed placeholder
const EXTENSION_TO_PLACEHOLDER_LABEL = {
  '3ds': '3DS', 'amf': 'AMF', 'blender': 'Blender', 'dae': 'DAE', 'dxf': 'DXF', 'dwg': 'DWG',
  'fbx': 'FBX', 'f3d': 'F3D', 'f3z': 'F3Z', 'gcode': 'G-code', 'igs': 'IGES', 'iges': 'IGES',
  'lys': 'LYS', 'lyt': 'LYT', 'obj': 'OBJ', 'ply': 'PLY', 'step': 'STEP', 'stp': 'STEP', 'svg': 'SVG', 'x3d': 'X3D'
};

function generateTypedPlaceholder(extension) {
  const ext = (extension || '').toLowerCase().replace(/^\./, '');
  const label = EXTENSION_TO_PLACEHOLDER_LABEL[ext] || (ext ? ext.toUpperCase() : '?');
  const size = 250;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '3d.png';
  // Dark background similar to 3d.png style
  ctx.fillStyle = '#1a1a2e';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, size / 2, size / 2);
  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    return '3d.png';
  }
}

function generateCorruptedPlaceholder() {
  const size = 250;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '3d.png';
  const bg = (typeof getComputedStyle !== 'undefined' && document.documentElement
    ? getComputedStyle(document.documentElement).getPropertyValue('--model-background-color').trim()
    : '') || '#070147';
  ctx.fillStyle = bg || '#070147';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255, 120, 100, 0.95)';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Model may be', size / 2, size / 2 - 14);
  ctx.fillText('corrupted', size / 2, size / 2 + 10);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '12px sans-serif';
  ctx.fillText('(could not load)', size / 2, size / 2 + 32);
  try {
    return canvas.toDataURL('image/png');
  } catch (e) {
    return '3d.png';
  }
}

/** True for failure art that must not be persisted (keeps hasThumbnail=0 so Docker can retry). */
function isFailurePlaceholderThumbnail(thumb) {
  if (!thumb || thumb === '3d.png') return true;
  if (typeof thumb !== 'string' || !thumb.startsWith('data:image')) return false;
  try {
    if (thumb === generateCorruptedPlaceholder()) return true;
    // Bulk-gen used to save typed STL/3MF/OBJ placeholders "to prevent future attempts"
    for (const ext of ['stl', '3mf', 'obj']) {
      if (thumb === generateTypedPlaceholder(ext)) return true;
    }
  } catch (_) { /* ignore */ }
  return false;
}

/**
 * Primary thumbnail cache for grid cells (path -> data URL | null).
 * Grid must never call getAllThumbnails — only the default thumb for visible rows.
 * Cap keeps memory bounded for huge libraries.
 */
const PRIMARY_THUMBNAIL_CACHE = new Map();
const PRIMARY_THUMBNAIL_CACHE_MAX = 800;

function normalizeThumbCacheKey(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  return typeof normalizePathForComparison === 'function'
    ? normalizePathForComparison(filePath)
    : filePath.replace(/\\/g, '/').toLowerCase();
}

function getCachedPrimaryThumbnail(filePath) {
  const key = normalizeThumbCacheKey(filePath);
  if (!key || !PRIMARY_THUMBNAIL_CACHE.has(key)) return undefined;
  return PRIMARY_THUMBNAIL_CACHE.get(key);
}

function setCachedPrimaryThumbnail(filePath, thumb) {
  const key = normalizeThumbCacheKey(filePath);
  if (!key) return;
  if (PRIMARY_THUMBNAIL_CACHE.size >= PRIMARY_THUMBNAIL_CACHE_MAX && !PRIMARY_THUMBNAIL_CACHE.has(key)) {
    const oldest = PRIMARY_THUMBNAIL_CACHE.keys().next().value;
    PRIMARY_THUMBNAIL_CACHE.delete(oldest);
  }
  PRIMARY_THUMBNAIL_CACHE.set(key, thumb || null);
}

function invalidatePrimaryThumbnailCache(filePath = null) {
  if (!filePath) {
    PRIMARY_THUMBNAIL_CACHE.clear();
    return;
  }
  PRIMARY_THUMBNAIL_CACHE.delete(normalizeThumbCacheKey(filePath));
}

/** Keep grid primary-thumb cache aligned with the DB default (first :: segment). */
function syncPrimaryThumbnailCacheFromThumbnailString(filePath, thumbnailString) {
  if (!filePath) return;
  invalidatePrimaryThumbnailCache(filePath);
  if (!thumbnailString || thumbnailString === '3d.png' || typeof thumbnailString !== 'string') {
    setCachedPrimaryThumbnail(filePath, null);
    return;
  }
  const parts = thumbnailString.includes('::')
    ? thumbnailString.split('::').filter(
        (t) => t && t !== '3d.png' && typeof t === 'string' && t.startsWith('data:image')
      )
    : thumbnailString.startsWith('data:image')
      ? [thumbnailString]
      : [];
  setCachedPrimaryThumbnail(filePath, parts[0] || null);
}

/** Load only the default/primary thumbnail for a grid cell (never getAllThumbnails). */
async function fetchPrimaryThumbnailForGrid(filePath) {
  if (!filePath || !window.electron?.getThumbnail) return null;
  const cached = getCachedPrimaryThumbnail(filePath);
  if (cached !== undefined) return cached;
  try {
    const thumb = await window.electron.getThumbnail(filePath);
    const valid =
      thumb &&
      thumb !== '3d.png' &&
      typeof thumb === 'string' &&
      thumb.startsWith('data:image') &&
      !isFailurePlaceholderThumbnail(thumb)
        ? thumb
        : null;
    if (valid && typeof isMostlyEmptyThumbnailDataUrl === 'function') {
      if (await isMostlyEmptyThumbnailDataUrl(valid)) {
        setCachedPrimaryThumbnail(filePath, null);
        return null;
      }
    }
    setCachedPrimaryThumbnail(filePath, valid);
    return valid;
  } catch (_) {
    return null;
  }
}

/** Only persist real renders — never corrupted/typed failure art. */
async function saveThumbnailIfReal(filePath, thumbnail) {
  if (!filePath || !thumbnail || thumbnail === '3d.png') return false;
  if (isFailurePlaceholderThumbnail(thumbnail)) return false;
  if (typeof isMostlyEmptyThumbnailDataUrl === 'function' && await isMostlyEmptyThumbnailDataUrl(thumbnail)) {
    return false;
  }
  await window.electron.saveThumbnail(filePath, thumbnail);
  invalidatePrimaryThumbnailCache(filePath);
  setCachedPrimaryThumbnail(filePath, thumbnail);
  return true;
}

async function loadModel(filePath, options = {}) {
  if (filePath && filePath.startsWith('url::')) {
    return null;
  }
  const startTime = Date.now();
  console.log(`[DEBUG] loadModel: Start loading ${filePath}`);
  try {
    console.log('loadModel: Starting for file:', filePath);
    
    // Check if this is a zip entry
    const pathInfo = parseZipPath(filePath);
    let actualFilePath = filePath;
    let tempFilePath = null;
    
    if (pathInfo.isZipEntry) {
      console.log(`[DEBUG] loadModel: Detected zip entry, extracting to temp file`);
      try {
        // Extract to temp file
        actualFilePath = await window.electron.extractModelFromZip(filePath);
        tempFilePath = actualFilePath;
        console.log(`[DEBUG] loadModel: Extracted to temp file: ${actualFilePath}`);
      } catch (error) {
        console.error(`[DEBUG] loadModel: Error extracting zip entry: ${error}`);
        throw new Error(`Failed to extract model from zip: ${error.message}`);
      }
    }
    
    const fileExtension = actualFilePath.split('.').pop().toLowerCase();

    // Standalone .zip (container only): no 3D model to load — treat like scan zip
    if (fileExtension === 'zip') {
      console.log(`[DEBUG] loadModel: Standalone .zip file, skipping 3D load`);
      return null;
    }
    
    // Only STL, 3MF, and OBJ are loadable for 3D preview; other types use typed placeholder
    if (fileExtension !== 'stl' && fileExtension !== '3mf' && fileExtension !== 'obj') {
      return null;
    }
    
    // For 3MF files, check for embedded images BEFORE 3D loading
    // NOTE: This is a safety check - renderModelToPNG should have already checked
    // and returned early if embedded images exist. This prevents unnecessary 3D loading.
    if (fileExtension === '3mf') {
      console.log(`[DEBUG] loadModel: Checking for embedded images in 3MF: ${actualFilePath}`);
      try {
        const images = await window.electron.get3MFImages(pathInfo.isZipEntry ? filePath : actualFilePath);
        if (images && images.length > 0) {
          console.log(`[DEBUG] loadModel: WARNING - Found embedded image in 3MF but loadModel was still called for ${filePath}`);
          console.log(`[DEBUG] loadModel: Returning null to skip 3D loading - embedded image should be used instead`);
          // Note: Temp file cleanup handled by OS
          // Return null to skip 3D loading - embedded image should be used instead
          return null;
        } else {
          console.log(`[DEBUG] loadModel: No embedded images found, proceeding with 3D loading for ${filePath}`);
        }
      } catch (imageError) {
        console.error(`[DEBUG] loadModel: Error checking for embedded image: ${imageError}`);
        // Continue with 3D loading if there's an error checking for images
      }
    }
    
    // Check if we're in server mode - use HTTP endpoint instead of file://
    const serverMode = await window.electron.isServerMode().catch(() => false);
    
    let encodedFilePath;
    
    // Check if this is a UNC path (works in both server and non-server mode)
    const isUncPath = actualFilePath.startsWith('\\\\') && !/^[A-Za-z]:/.test(actualFilePath);
    
    if (serverMode || isUncPath) {
      // In server mode, or for UNC paths in any mode, use HTTP endpoint
      // Encode the path for URL
      const encodedPath = encodeURIComponent(actualFilePath);
      // Use full URL for HTTP endpoint (Three.js loaders need absolute URLs)
      // In server mode (browser access), use current window origin
      // In non-server mode (Electron) with UNC paths, HTTP server runs on localhost:5000
      const serverPort = 5000; // Should match the port in main.js startHttpServer()
      if (serverMode && window.location.origin && window.location.origin !== 'null' && window.location.origin !== 'file://') {
        // Server mode with browser access - use current origin
        encodedFilePath = `${window.location.origin}/api/file/${encodedPath}`;
      } else {
        // Electron mode with UNC paths - HTTP server runs on localhost:5000
        encodedFilePath = `http://localhost:${serverPort}/api/file/${encodedPath}`;
      }
      console.log(`loadModel: Using HTTP endpoint ${serverMode ? 'for server mode' : 'for UNC path'}:`, encodedFilePath);
      // In server mode, client paths (e.g. C:\ from extension) are not on the server; avoid loader error by checking first
      if (serverMode && /^[A-Za-z]:/.test(actualFilePath)) {
        try {
          const check = await fetch(encodedFilePath, { method: 'HEAD' });
          if (check.status === 404) {
            console.log('loadModel: File not on server (client path), skipping 3D load');
            return null;
          }
        } catch (e) { /* proceed to load */ }
      }
    } else if (/^[A-Za-z]:/.test(actualFilePath)) {
      // Check if we're running on Windows (starts with drive letter)
      // For Windows paths: 
      // 1. Convert backslashes to forward slashes
      // 2. Add file:/// protocol
      // 3. Properly encode special characters
      
      try {
        // First normalize the path to use forward slashes
        const normalizedPath = actualFilePath.replace(/\\/g, '/');
        
        // Create URL object for proper handling - this works better for Windows paths
        const fileUrl = new URL(`file:///${normalizedPath}`);
        
        // Get the properly encoded pathname from the URL
        encodedFilePath = fileUrl.href;
        
        // Explicitly handle hash character in path segments
        if (normalizedPath.includes('#')) {
          // Replace the hash character with its URL encoding (%23)
          // But ensure we don't double-encode anything
          encodedFilePath = encodedFilePath.replace(/#/g, '%23');
        }
        
        // Ensure other problematic characters are properly encoded
        encodedFilePath = encodedFilePath
          .replace(/\?/g, '%3F')
          .replace(/\s/g, '%20')
          .replace(/\(/g, '%28')
          .replace(/\)/g, '%29')
          .replace(/'/g, '%27')
          .replace(/\[/g, '%5B')
          .replace(/\]/g, '%5D');
      } catch (error) {
        console.error('Error creating URL from file path:', error);
        
        // Fallback method: direct string replacement
        const normalizedPath = actualFilePath.replace(/\\/g, '/');
        encodedFilePath = `file:///${normalizedPath}`
            .replace(/#/g, '%23')
            .replace(/\s/g, '%20');
      }
      
      console.log('loadModel: Encoded Windows path:', encodedFilePath);
    } else {
      // For non-Windows paths, use a direct encoding approach
      try {
        const normalizedPath = actualFilePath.replace(/\\/g, '/');
        
        // Simply replace problematic characters directly
        encodedFilePath = `file://${normalizedPath}`
            .replace(/#/g, '%23')
            .replace(/\s/g, '%20')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29')
            .replace(/'/g, '%27')
            .replace(/\[/g, '%5B')
            .replace(/\]/g, '%5D');
      } catch (error) {
        console.error('Error encoding non-Windows file path:', error);
        // Super simple fallback
        encodedFilePath = `file://${actualFilePath.replace(/#/g, '%23')}`;
      }
      console.log('loadModel: Encoded Unix path:', encodedFilePath);
    }
    
    // If no embedded image found, proceed with 3D loading using Web Worker
    if (fileExtension !== 'stl' && fileExtension !== '3mf' && fileExtension !== 'obj') {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }

    // Read file bytes via main process (same as 3D preview) — avoids fragile file:// fetch in the worker.
    let modelArrayBuffer = null;
    if (window.electron && typeof window.electron.readModelFile === 'function') {
      try {
        const raw = await window.electron.readModelFile(filePath);
        if (raw) {
          modelArrayBuffer = raw instanceof ArrayBuffer
            ? raw
            : raw.buffer
              ? raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)
              : null;
        }
      } catch (e) {
        console.warn('loadModel: readModelFile failed, worker will use URL:', e);
      }
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker('parse-worker.js');
      const jobId = Date.now().toString() + Math.random().toString();

      worker.onmessage = function(e) {
        const data = e.data;
        if (data.id !== jobId) return;

        worker.terminate();

        if (!data.success) {
          const errMsg = data.error || 'Unknown worker parse error';
          console.error('Worker error:', errMsg, filePath);
          if (tempFilePath) {
            window.electron.deleteTempFile?.(tempFilePath).catch(err => console.error(err));
          }
          reject(new Error(errMsg));
          return;
        }

        try {
          const group = new THREE.Group();
          const material = new THREE.MeshStandardMaterial({
            color: getModelColor(),
            metalness: 0.3,
            roughness: 0.4
          });

          data.geometries.forEach(geoData => {
            if (!geoData.position || geoData.position.length < 9) return;
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(geoData.position, 3));
            if (geoData.normal && geoData.normal.length >= geoData.position.length) {
              geometry.setAttribute('normal', new THREE.BufferAttribute(geoData.normal, 3));
            } else {
              geometry.computeVertexNormals();
            }
            if (geoData.uv && geoData.uv.length >= (geoData.position.length / 3) * 2) {
              geometry.setAttribute('uv', new THREE.BufferAttribute(geoData.uv, 2));
            }
            if (geoData.index) geometry.setIndex(new THREE.BufferAttribute(geoData.index, 1));

            const mesh = new THREE.Mesh(geometry, material);
            if (geoData.matrix) {
              mesh.applyMatrix4(new THREE.Matrix4().fromArray(geoData.matrix));
            }
            group.add(mesh);
          });

          if (group.children.length === 0) {
            if (tempFilePath) {
              window.electron.deleteTempFile?.(tempFilePath).catch(err => console.error(err));
            }
            reject(new Error('Model contains no drawable mesh geometry'));
            return;
          }

          if (fileExtension === 'stl' || fileExtension === '3mf' || fileExtension === 'obj') {
            group.rotation.x = -Math.PI / 2;
          }

          resolve(group);
        } catch (err) {
          console.error('loadModel: Error processing geometries from worker:', err);
          if (tempFilePath) {
            window.electron.deleteTempFile?.(tempFilePath).catch(err2 => console.error(err2));
          }
          reject(err);
        }
      };

      worker.onerror = function(error) {
        console.error('Worker failed:', error.message, filePath);
        worker.terminate();
        if (tempFilePath) {
          window.electron.deleteTempFile?.(tempFilePath).catch(err => console.error(err));
        }
        reject(error);
      };

      const payload = {
        id: jobId,
        fileExtension,
        url: encodedFilePath,
        arrayBuffer: modelArrayBuffer || undefined
      };
      const transfer = modelArrayBuffer && modelArrayBuffer instanceof ArrayBuffer ? [modelArrayBuffer] : undefined;
      if (transfer) {
        worker.postMessage(payload, transfer);
      } else {
        worker.postMessage(payload);
      }
    }).finally(() => {
      const endTime = Date.now();
      console.log(`[DEBUG] loadModel: Finished loading ${filePath}. Took ${endTime - startTime}ms.`);
    });
  } catch (error) {
    console.error('loadModel error:', error);
    throw error;
  }
}

// Make loadModel available globally
window.loadModel = loadModel;

// Add these variables at the top
let totalThumbnailsToGenerate = 0;
let generatedThumbnailsCount = 0;

// Add WebGL context management variables
let sharedScene = null;
let sharedCamera = null;
let contextUseCount = 0;
const MAX_CONTEXT_USES = 20; // Reset context after this many uses
const MAX_CONTEXT_REUSE_COUNT = 100; // Desktop default; server mode lowers this at init
let maxContextReuseCount = MAX_CONTEXT_REUSE_COUNT;

// Debounce total-count IPC: progressive library load calls updateModelCounts every chunk; one fetch is enough.
let updateTotalCountDebounce = null;
function scheduleTotalModelCountRefresh() {
  if (updateTotalCountDebounce) clearTimeout(updateTotalCountDebounce);
  updateTotalCountDebounce = setTimeout(async () => {
    updateTotalCountDebounce = null;
    try {
      const totalCount = await window.electron.getTotalModelCount();
      const totalElement = document.getElementById('total-count');
      if (totalElement) {
        totalElement.textContent = `${totalCount} model${totalCount !== 1 ? 's' : ''} total`;
      }
    } catch (error) {
      console.error('Error updating total model count:', error);
    }
  }, 350);
}

// Add these functions near the top of the file
async function updateModelCounts(viewCount) {
  try {
    const viewElement = document.getElementById('view-count');
    if (viewElement) {
      viewElement.textContent = `${viewCount} model${viewCount !== 1 ? 's' : ''} in view`;
    }
    scheduleTotalModelCountRefresh();
  } catch (error) {
    console.error('Error updating model counts:', error);
  }
}

// Helper function to normalize paths for comparison
// This handles URL encoding, path separators, and whitespace differences
function normalizePathForComparison(path) {
  if (!path) return '';
  // Decode URL encoding if present
  let normalized = path;
  try {
    normalized = decodeURIComponent(normalized);
  } catch (e) {
    // If decoding fails, use original path
  }
  // Normalize path separators (both forward and back slashes)
  normalized = normalized.replace(/\\/g, '/');
  // Trim whitespace
  normalized = normalized.trim();
  // Windows drive letter: compare case-insensitively (C: vs c:)
  if (/^[a-zA-Z]:\//.test(normalized)) {
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }
  return normalized;
}

/**
 * Full parent directory path for a model file (or zip file's folder for zip entries).
 * Used for filtering and tooltips — always drive/UNC aware.
 * Drive-root files (e.g. E:\model.stl) return "E:\" so the removable drive is obvious.
 */
function getParentDirectoryFullPath(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  if (filePath.startsWith('url::')) return '';
  const pathForParent = filePath.includes('::') ? filePath.split('::')[0] : filePath;
  const lastSlash = Math.max(pathForParent.lastIndexOf('\\'), pathForParent.lastIndexOf('/'));
  if (lastSlash < 0) return '';
  // Keep the trailing separator for Windows drive roots ("E:\file" → "E:\") and Unix root ("/file" → "/").
  const parent = pathForParent.substring(0, lastSlash);
  if (/^[A-Za-z]:$/i.test(parent)) {
    return parent + (pathForParent[lastSlash] || '\\');
  }
  if (parent === '' && (pathForParent[lastSlash] === '/' || pathForParent[lastSlash] === '\\')) {
    return pathForParent[lastSlash];
  }
  return parent;
}

/**
 * Directory label shown in grid/list/details.
 * Prefer the full parent path (includes drive letter) so removable-drive scans
 * are not mistaken for similarly named folders on C:.
 * Zip entries: "<zipParent>\<zipName> → <entryFolder>".
 */
function getDirectoryDisplayLabel(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';
  if (filePath.startsWith('url::')) return 'Open in browser';
  if (filePath.includes('::')) {
    const [zipPath, entryPath] = filePath.split('::');
    const zipFileName = zipPath.split(/[/\\]/).pop() || zipPath;
    const zipParent = getParentDirectoryFullPath(zipPath);
    const entryDir = (entryPath || '').split(/[/\\]/).slice(0, -1).join('/') || 'root';
    const sep = zipPath.includes('\\') ? '\\' : '/';
    // Avoid double separators when zipParent is already a drive root ("E:\") or "/".
    const zipLabel = zipParent
      ? (zipParent.endsWith('\\') || zipParent.endsWith('/')
          ? `${zipParent}${zipFileName}`
          : `${zipParent}${sep}${zipFileName}`)
      : zipFileName;
    return `${zipLabel} → ${entryDir}`;
  }
  return getParentDirectoryFullPath(filePath);
}

/** Stable identity for grid rows: same file path = one row (handles duplicate DB ids). */
function getGridModelDedupeKey(model) {
  if (!model) return '';
  const pathNorm = normalizePathForComparison(model.filePath || '');
  if (pathNorm) return `p:${pathNorm}`;
  if (model.id != null && model.id !== '') return `id:${model.id}`;
  return '';
}

/** One row per filesystem / zip entry — duplicate DB rows share the same normalized path. */
function dedupeModelsForVirtualGrid(models) {
  if (!models || models.length < 2) return models || [];
  const seen = new Map();
  const out = [];
  for (const model of models) {
    if (!model) continue;
    const key = getGridModelDedupeKey(model);
    if (!key) {
      out.push(model);
      continue;
    }
    if (!seen.has(key)) {
      seen.set(key, model);
      out.push(model);
      continue;
    }
    const keeper = seen.get(key);
    const keepHasId = keeper && keeper.id != null && keeper.id !== '';
    const candHasId = model.id != null && model.id !== '';
    if (!keepHasId && candHasId) {
      const idx = out.indexOf(keeper);
      if (idx !== -1) out[idx] = model;
      seen.set(key, model);
    }
  }
  return out;
}

/** Drop expand state for parent groups that no longer have 2+ distinct files. */
function pruneParentModelExpandedGroups(models) {
  if (!parentModelExpandedGroups.size) return;
  const pathSets = new Map();
  for (const model of models || []) {
    const label = getParentModelGroupLabel(model);
    if (!label) continue;
    const gk = `parent:${getParentModelGroupKey(label)}`;
    const pathKey = normalizePathForComparison(model.filePath || '');
    if (!pathKey) continue;
    if (!pathSets.has(gk)) pathSets.set(gk, new Set());
    pathSets.get(gk).add(pathKey);
  }
  for (const key of [...parentModelExpandedGroups]) {
    const set = pathSets.get(key);
    if (!set || set.size < 2) {
      parentModelExpandedGroups.delete(key);
    }
  }
}

function pruneZipArchiveExpandedGroups(models) {
  if (!zipArchiveExpandedGroups.size) return;
  const pathSets = new Map();
  for (const model of models || []) {
    const parsed = parseZipPath(model?.filePath || '');
    if (!parsed.isZipEntry || !parsed.zipPath) continue;
    const gk = `zip:${normalizePathForComparison(parsed.zipPath)}`;
    if (!gk || gk === 'zip:') continue;
    const pathKey = normalizePathForComparison(model.filePath || '');
    if (!pathKey) continue;
    if (!pathSets.has(gk)) pathSets.set(gk, new Set());
    pathSets.get(gk).add(pathKey);
  }
  for (const key of [...zipArchiveExpandedGroups]) {
    const set = pathSets.get(key);
    if (!set || set.size < 2) {
      zipArchiveExpandedGroups.delete(key);
    }
  }
}

/** True when the model should show the "New" badge (SQLite 1, boolean, or string "1"). */
function isModelNew(model) {
  if (!model) return false;
  const v = model.isNew;
  return v === 1 || v === true || v === '1';
}

/** Keep the thumbnail "New" pill in sync with model.isNew (create, update, virtual-grid reuse). */
function syncModelNewBadge(fileItem, model) {
  if (!fileItem) return;
  fileItem.querySelector(':scope > .new-status')?.remove();
  const thumbHost =
    fileItem.querySelector('.thumbnail-wrapper .thumbnail-container') ||
    fileItem.querySelector('.thumbnail-container');
  if (!thumbHost) return;
  const existingBadge = thumbHost.querySelector(':scope > .new-status');
  if (isModelNew(model)) {
    if (!existingBadge) {
      const newStatusEl = document.createElement('div');
      newStatusEl.className = 'new-status';
      newStatusEl.textContent = 'New';
      newStatusEl.title = 'New model — clears once you edit it';
      thumbHost.appendChild(newStatusEl);
    }
  } else if (existingBadge) {
    existingBadge.remove();
  }
}

function deriveBundleFieldsForModel(model) {
  const filePath = model?.filePath || '';
  if (!filePath || filePath.startsWith('url::')) {
    return { bundleKey: '', bundleLabel: '', bundleKind: '' };
  }
  // Only ZIP archive entries are bundled; plain directory siblings stay individual.
  if (!filePath.includes('::')) {
    return { bundleKey: '', bundleLabel: '', bundleKind: '' };
  }
  const zipPath = filePath.split('::')[0];
  const normalized = normalizePathForComparison(zipPath).toLowerCase();
  const parts = normalized.split('/').filter(Boolean);
  const label = parts.length ? parts[parts.length - 1] : zipPath;
  return { bundleKey: `zip:${normalized}`, bundleLabel: label, bundleKind: 'zip' };
}

function isZipBundleModel(model) {
  const kind = String(model?.bundleKind || '').trim().toLowerCase();
  if (kind === 'zip') return true;
  if (kind === 'folder') return false;
  const key = String(model?.bundleKey || '').trim().toLowerCase();
  if (key.startsWith('zip:')) return true;
  if (key.startsWith('folder:')) return false;
  const filePath = model?.filePath || '';
  return Boolean(filePath.includes('::') && !filePath.startsWith('url::'));
}

function getBundleGroupLabel(model) {
  if (!isZipBundleModel(model)) return '';
  if (model?.bundleLabel) return String(model.bundleLabel).trim();
  return deriveBundleFieldsForModel(model).bundleLabel;
}

function getBundleGroupKey(model) {
  if (!isZipBundleModel(model)) return '';
  if (model?.bundleKey) return String(model.bundleKey).trim().toLowerCase();
  return deriveBundleFieldsForModel(model).bundleKey;
}

function pruneBundleExpandedGroups(models) {
  if (!bundleExpandedGroups.size) return;
  const pathSets = new Map();
  for (const model of models || []) {
    const bundleKey = getBundleGroupKey(model);
    if (!bundleKey) continue;
    const gk = `bundle:${bundleKey}`;
    const pathKey = normalizePathForComparison(model.filePath || '');
    if (!pathKey) continue;
    if (!pathSets.has(gk)) pathSets.set(gk, new Set());
    pathSets.get(gk).add(pathKey);
  }
  for (const key of [...bundleExpandedGroups]) {
    const set = pathSets.get(key);
    if (!set || set.size < 2) {
      bundleExpandedGroups.delete(key);
    }
  }
}

/** Merge fresh model into virtual grid's currentModels when paths match (normalized). */
function mergeModelIntoGridCurrentModels(model) {
  const container = document.querySelector('.file-grid');
  if (!container || !container.currentModels || !model) return false;
  const target = normalizePathForComparison(model.filePath || '');
  if (!target) return false;
  const idx = container.currentModels.findIndex(m =>
    normalizePathForComparison(m.filePath || m.id || '') === target
  );
  if (idx === -1) return false;
  container.currentModels[idx] = model;
  return true;
}

/** Insert a new detailed-view metadata row in the same order as createModelItem (dir row, designer, source, parent, license, tags). */
function insertDetailedMetadataRowBefore(metadataContainer, el, selectorList) {
  for (const sel of selectorList) {
    const ref = metadataContainer.querySelector(sel);
    if (ref) {
      metadataContainer.insertBefore(el, ref);
      return;
    }
  }
  const dirRow = metadataContainer.querySelector('.dir-size-row');
  if (dirRow) {
    if (dirRow.nextSibling) {
      metadataContainer.insertBefore(el, dirRow.nextSibling);
    } else {
      metadataContainer.appendChild(el);
    }
  } else if (metadataContainer.firstChild) {
    metadataContainer.insertBefore(el, metadataContainer.firstChild);
  } else {
    metadataContainer.appendChild(el);
  }
}

async function updateModelElement(filePath) {
  try {
    const model = await window.electron.getModel(filePath);
    if (!model) {
      console.warn('updateModelElement: Model not found for', filePath);
      return;
    }
    console.log('updateModelElement: Updating element for', filePath, 'with model data:', {
      designer: model.designer,
      source: model.source,
      parentModel: model.parentModel,
      license: model.license,
      tags: model.tags
    });

    // Check current filter values
    const designer = document.getElementById('designer-select')?.value || '';
    const license = document.getElementById('license-select')?.value || ''; 
    const parentModel = document.getElementById('parent-select')?.value || '';
    const printStatus = document.getElementById('printed-select')?.value || 'all';
    const newStatus = document.getElementById('new-select')?.value || 'all';
    const favoriteStatus = document.getElementById('favorite-select')?.value || 'all';
    const ratingStatus = document.getElementById('rating-select')?.value || 'all';
    const ratingMinStatus = document.getElementById('rating-min-select')?.value || 'all';
    const fileType = document.getElementById('filetype-select')?.value || '';
    const searchTerm = document.getElementById('search-filter-input')?.value.trim() || '';
    
    // Check if the model matches current filters
    let shouldBeVisible = true;
    
    if (designer) {
      if (designer === '__none__') {
        shouldBeVisible = !model.designer || model.designer.trim() === '';
      } else {
        shouldBeVisible = model.designer && 
          model.designer.trim().toLowerCase() === designer.trim().toLowerCase();
      }
    }
    
    if (shouldBeVisible && license) {
      if (license === '__none__') {
        shouldBeVisible = !model.license || model.license.trim() === '';
      } else {
        shouldBeVisible = model.license === license;
      }
    }
    
    if (shouldBeVisible && parentModel) {
      if (parentModel === '__none__') {
        shouldBeVisible = !model.parentModel || model.parentModel.trim() === '';
      } else {
        shouldBeVisible = model.parentModel === parentModel;
      }
    }
    
    if (shouldBeVisible && printStatus === 'printed') {
      shouldBeVisible = model.printed;
    } else if (shouldBeVisible && printStatus === 'not-printed') {
      shouldBeVisible = !model.printed;
    }

    if (shouldBeVisible && newStatus === 'new') {
      shouldBeVisible = isModelNew(model);
    } else if (shouldBeVisible && newStatus === 'not-new') {
      shouldBeVisible = !isModelNew(model);
    }

    if (shouldBeVisible && favoriteStatus === 'favorited') {
      shouldBeVisible = Boolean(model.favorite);
    } else if (shouldBeVisible && favoriteStatus === 'not-favorited') {
      shouldBeVisible = !model.favorite;
    }

    const modelRating = normalizeModelRatingValue(model.rating);
    if (shouldBeVisible && ratingStatus === 'unrated') {
      shouldBeVisible = modelRating === 0;
    } else if (shouldBeVisible && ratingStatus !== 'all' && /^[1-5]$/.test(ratingStatus)) {
      shouldBeVisible = modelRating === parseInt(ratingStatus, 10);
    }

    if (shouldBeVisible && ratingMinStatus !== 'all' && /^[1-5]$/.test(ratingMinStatus)) {
      shouldBeVisible = modelRating >= parseInt(ratingMinStatus, 10);
    }
    
    // Check file type filter
    if (shouldBeVisible && fileType) {
      if (fileType.toLowerCase() === 'zip') {
        shouldBeVisible = model.filePath && model.filePath.includes('::');
      } else {
        const fileName = model.fileName || '';
        shouldBeVisible = fileName.toLowerCase().endsWith(`.${fileType.toLowerCase()}`);
      }
    }
    
    // Check search term filter (name, directory, metadata, tags, notes)
    if (shouldBeVisible && searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const fileName = (model.fileName || '').toLowerCase();
      const filePath = (model.filePath || '').toLowerCase();
      const modelDesigner = (model.designer || '').toLowerCase();
      const modelSource = (model.source || '').toLowerCase();
      const modelLicense = (model.license || '').toLowerCase();
      const modelParent = (model.parentModel || '').toLowerCase();
      const modelNotes = (model.notes || '').toLowerCase();
      const tagNames = Array.isArray(model.tags) ? model.tags.map(t => (t && t.name) ? t.name.toLowerCase() : '').filter(Boolean) : [];
      const tagsMatch = tagNames.some(name => name.includes(searchLower));
      
      shouldBeVisible = fileName.includes(searchLower) ||
                       filePath.includes(searchLower) ||
                       modelDesigner.includes(searchLower) ||
                       modelSource.includes(searchLower) ||
                       modelLicense.includes(searchLower) ||
                       modelParent.includes(searchLower) ||
                       modelNotes.includes(searchLower) ||
                       tagsMatch;
    }

    const normalizedTargetPath = normalizePathForComparison(filePath);
    let existingElement = null;
    try {
      existingElement = document.querySelector(`.file-item[data-filepath="${CSS.escape(filePath)}"]`);
    } catch (e) {
      /* invalid path for selector */
    }
    if (!existingElement) {
      for (const item of document.querySelectorAll('.file-item')) {
        const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
        if (normalizePathForComparison(itemPath) === normalizedTargetPath) {
          existingElement = item;
          break;
        }
      }
    }
    
    if (!existingElement) {
      // Virtual grid only mounts visible rows — bulk edits often have no DOM node; still sync in-memory list.
      mergeModelIntoGridCurrentModels(model);
      debugLog('updateModelElement: no visible .file-item for path (expected for off-screen/filtered):', filePath);
      return;
    }

    syncModelNewBadge(existingElement, model);
    
    // Check if we're in detailed view
    const isDetailedView = existingElement.classList.contains('file-item-detailed');
    console.log('updateModelElement: isDetailedView?', isDetailedView);
    
    // Check if we're in preview or list view (needed early to prevent removing elements)
    const isPreviewView = existingElement.classList.contains('file-item-preview') || currentGridView === 'preview';
    const isListView = existingElement.classList.contains('file-item-list') || currentGridView === 'list';

    // If the model no longer matches the current filters, remove it from the grid
    if (!shouldBeVisible) {
      // Remove from multi-select if selected
      if (isMultiSelectMode && selectedModels.has(filePath)) {
        selectedModels.delete(filePath);
        existingElement.classList.remove('selected');
        updateSelectedCount();
      }
      
      // Remove the model from currentModels array so virtual grid knows it's gone
      const container = document.querySelector('.file-grid');
      if (container && container.currentModels) {
        const modelIndex = container.currentModels.findIndex(m => 
          (m.id || m.filePath) === (model.id || model.filePath)
        );
        if (modelIndex !== -1) {
          container.currentModels.splice(modelIndex, 1);
          
          // Recalculate field analysis since a model was removed
          if (container.currentModels.length > 0) {
            window.modelFieldAnalysis = analyzeModelFields(container.currentModels);
          }
        }
      }
      
      // Remove the element from DOM
      existingElement.remove();
      
      // Trigger virtual grid refresh to reflow remaining items
      if (container && container.renderVisibleItemsFn) {
        requestAnimationFrame(() => {
          container.renderVisibleItemsFn();
        });
      }
      
      // Update model count
      if (container && container.currentModels) {
        updateModelCounts(container.currentModels.length);
      }
      
      return;
    } else {
      existingElement.style.display = '';
    }

    // Update model details (list/detailed use .file-name; preview wall uses .preview-tile-name)
    let displayFileName = model.fileName;
    if (!displayFileName && model.filePath) {
      if (model.filePath.includes('::')) {
        const entryPath = model.filePath.split('::')[1];
        displayFileName = entryPath.split(/[/\\]/).pop() || 'Unknown';
      } else {
        displayFileName = model.filePath.split(/[/\\]/).pop() || 'Unknown';
      }
    }
    if (!displayFileName) {
      displayFileName = 'Unknown';
    }
    const nameElement = existingElement.querySelector('.file-name');
    if (nameElement) {
      nameElement.textContent = displayFileName;
    }
    const previewTileNameEl = existingElement.querySelector('.preview-tile-name');
    if (previewTileNameEl) {
      previewTileNameEl.textContent = displayFileName;
    }

    // Update print status - make sure to match the class/structure used in renderFile
    const printStatusElement = existingElement.querySelector('.print-status');
    if (printStatusElement) {
      printStatusElement.textContent = model.printed ? 'Printed' : 'Not Printed';
      if (model.printed) {
        printStatusElement.classList.add('printed');
      } else {
        printStatusElement.classList.remove('printed');
      }
    } else {
      // If print status element doesn't exist, create it
      const statusElement = document.createElement('div');
      statusElement.className = `print-status${model.printed ? ' printed' : ''}`;
      statusElement.textContent = model.printed ? 'Printed' : 'Not Printed';
      statusElement.style.cursor = 'pointer';
      statusElement.title = 'Click to toggle printed status';
      
      // Add click handler to toggle printed status
      statusElement.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent triggering file item click
        
        // Get current model to check printed status
        const currentModel = await window.electron.getModel(filePath);
        if (currentModel) {
          const newPrintedStatus = !currentModel.printed;
          await autoSaveModel('printed', newPrintedStatus, filePath);
        }
      });
      
      existingElement.appendChild(statusElement);
    }

    const engagementBar = existingElement.querySelector('.model-engagement-bar:not(.is-group)');
    if (engagementBar) {
      updateEngagementBarDisplay(
        engagementBar,
        normalizeModelRatingValue(model.rating),
        Boolean(model.favorite)
      );
    }
    
    // Remove any existing designer info elements that might have been added (redundant with metadata)
    // Designer is already shown in the metadata section, so we don't need it here
    const fileInfo = existingElement.querySelector('.file-info');
    if (fileInfo) {
      // Only remove legacy designer-info nodes outside metadata (detailed view stores designer in .metadata-container)
      if (!isListView) {
        fileInfo.querySelectorAll('.designer-info').forEach(el => {
          if (!el.closest('.metadata-container')) el.remove();
        });
      }
    }
    
    // Update metadata in detailed view grid (only if in detailed view)
    const metadataContainer = existingElement.querySelector('.metadata-container');
    console.log('updateModelElement: metadataContainer found?', !!metadataContainer, 'isDetailedView?', isDetailedView, 'element classes:', existingElement.className);
    
    // Also check if the current view mode is detailed (in case class check fails)
    const currentViewIsDetailed = currentGridView === 'detailed';
    console.log('updateModelElement: currentGridView is detailed?', currentViewIsDetailed);
    
    // isListView and isPreviewView are already defined above
    
    if (metadataContainer && (isDetailedView || currentViewIsDetailed)) {
      // Detailed grid rows for designer/source/parent/license are only created in createModelItem when the
      // field already had a value — new models get no row, so updates must insert or remove rows here.

      // Update designer
      let designerItem = metadataContainer.querySelector('.designer-item');
      const designerValue = (model.designer && model.designer.trim()) ? model.designer.trim() : '';
      const hasDesigner = designerValue && designerValue !== '';
      console.log('updateModelElement: designerItem found?', !!designerItem, 'designerValue =', designerValue);

      if (designerItem && !hasDesigner) {
        designerItem.remove();
        designerItem = null;
      }
      if (!designerItem && hasDesigner) {
        designerItem = document.createElement('div');
        designerItem.className = 'metadata-item designer-item';
        designerItem.innerHTML = `
          <span class="metadata-icon">👤</span>
          <span class="metadata-value designer-info" style="color: #ccc; display: inline-block;" title=""></span>
        `;
        insertDetailedMetadataRowBefore(metadataContainer, designerItem, [
          '.source-item', '.parent-item', '.license-item', '.tags-item'
        ]);
      }

      if (designerItem) {
        let designerValueSpan = designerItem.querySelector(':scope > span.metadata-value.designer-info')
          || designerItem.querySelector(':scope > span.metadata-value')
          || designerItem.querySelector('span.designer-info');
        if (!designerValueSpan) {
          designerValueSpan = document.createElement('span');
          designerValueSpan.className = 'metadata-value designer-info';
          designerValueSpan.style.display = 'inline-block';
          const iconSpan = designerItem.querySelector('.metadata-icon');
          if (iconSpan) {
            if (iconSpan.nextSibling) {
              iconSpan.parentNode.insertBefore(designerValueSpan, iconSpan.nextSibling);
            } else {
              iconSpan.parentNode.appendChild(designerValueSpan);
            }
          } else {
            designerItem.appendChild(designerValueSpan);
          }
        }
        if (designerValueSpan) {
          designerValueSpan.textContent = hasDesigner ? designerValue : '—';
          designerValueSpan.style.color = hasDesigner ? '#ccc' : '#666';
          designerValueSpan.setAttribute('title', hasDesigner ? designerValue : '');
        }
        if (hasDesigner) {
          designerItem.style.cursor = 'pointer';
          designerItem.classList.add('clickable-metadata');
          designerItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const designerSelect = document.getElementById('designer-select');
            if (designerSelect) {
              designerSelect.value = designerValue;
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              }
            }
          };
        } else {
          designerItem.style.cursor = 'default';
          designerItem.classList.remove('clickable-metadata');
          designerItem.onclick = null;
        }
      }

      // Update source
      let sourceItem = metadataContainer.querySelector('.source-item');
      const sourceValue = (model.source && String(model.source).trim()) ? String(model.source).trim() : '';
      if (sourceItem && !sourceValue) {
        sourceItem.remove();
        sourceItem = null;
      }
      if (!sourceItem && sourceValue) {
        sourceItem = document.createElement('div');
        sourceItem.className = 'metadata-item source-item';
        sourceItem.innerHTML = `
          <span class="metadata-icon">🔗</span>
          <span class="metadata-value source-info" style="color: #ccc" title=""></span>
        `;
        insertDetailedMetadataRowBefore(metadataContainer, sourceItem, [
          '.parent-item', '.license-item', '.tags-item'
        ]);
      }
      if (sourceItem) {
        let sourceValueSpan = sourceItem.querySelector('.metadata-value.source-info');
        if (!sourceValueSpan) {
          sourceValueSpan = document.createElement('span');
          sourceValueSpan.className = 'metadata-value source-info';
          const iconSpan = sourceItem.querySelector('.metadata-icon');
          if (iconSpan) {
            iconSpan.parentNode.insertBefore(sourceValueSpan, iconSpan.nextSibling);
          } else {
            sourceItem.appendChild(sourceValueSpan);
          }
        }
        if (sourceValueSpan) {
          sourceValueSpan.textContent = sourceValue || '—';
          sourceValueSpan.style.color = sourceValue ? '#ccc' : '#666';
          sourceValueSpan.setAttribute('title', sourceValue || '');
        }
      }

      // Update parent model
      let parentItem = metadataContainer.querySelector('.parent-item');
      const parentValue = (model.parentModel && String(model.parentModel).trim()) ? String(model.parentModel).trim() : '';
      if (parentItem && !parentValue) {
        parentItem.remove();
        parentItem = null;
      }
      if (!parentItem && parentValue) {
        parentItem = document.createElement('div');
        parentItem.className = 'metadata-item parent-item';
        parentItem.style.cursor = 'pointer';
        parentItem.classList.add('clickable-metadata');
        parentItem.innerHTML = `
          <span class="metadata-icon">📦</span>
          <span class="metadata-value parent-info" style="color: #ccc" title=""></span>
        `;
        insertDetailedMetadataRowBefore(metadataContainer, parentItem, ['.license-item', '.tags-item']);
      }
      if (parentItem) {
        let parentValueSpan = parentItem.querySelector('.metadata-value.parent-info');
        if (!parentValueSpan) {
          parentValueSpan = document.createElement('span');
          parentValueSpan.className = 'metadata-value parent-info';
          const iconSpan = parentItem.querySelector('.metadata-icon');
          if (iconSpan) {
            iconSpan.parentNode.insertBefore(parentValueSpan, iconSpan.nextSibling);
          } else {
            parentItem.appendChild(parentValueSpan);
          }
        }
        if (parentValueSpan) {
          parentValueSpan.textContent = parentValue || '—';
          parentValueSpan.style.color = parentValue ? '#ccc' : '#666';
          parentValueSpan.setAttribute('title', parentValue || '');
        }
        if (parentValue) {
          parentItem.style.cursor = 'pointer';
          parentItem.classList.add('clickable-metadata');
          parentItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parentSelect = document.getElementById('parent-select');
            if (parentSelect) {
              parentSelect.value = parentValue;
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              }
            }
          };
        } else {
          parentItem.style.cursor = 'default';
          parentItem.classList.remove('clickable-metadata');
          parentItem.onclick = null;
        }
      }

      // Update license
      let licenseItem = metadataContainer.querySelector('.license-item');
      const licenseValue = (model.license && String(model.license).trim()) ? String(model.license).trim() : '';
      if (licenseItem && !licenseValue) {
        licenseItem.remove();
        licenseItem = null;
      }
      if (!licenseItem && licenseValue) {
        licenseItem = document.createElement('div');
        licenseItem.className = 'metadata-item license-item';
        licenseItem.style.cursor = 'pointer';
        licenseItem.classList.add('clickable-metadata');
        licenseItem.innerHTML = `
          <span class="metadata-icon">📜</span>
          <span class="metadata-value license-info" style="color: #ccc" title=""></span>
        `;
        insertDetailedMetadataRowBefore(metadataContainer, licenseItem, ['.tags-item']);
      }
      if (licenseItem) {
        let licenseValueSpan = licenseItem.querySelector('.metadata-value.license-info');
        if (!licenseValueSpan) {
          licenseValueSpan = document.createElement('span');
          licenseValueSpan.className = 'metadata-value license-info';
          const iconSpan = licenseItem.querySelector('.metadata-icon');
          if (iconSpan) {
            iconSpan.parentNode.insertBefore(licenseValueSpan, iconSpan.nextSibling);
          } else {
            licenseItem.appendChild(licenseValueSpan);
          }
        }
        if (licenseValueSpan) {
          licenseValueSpan.textContent = licenseValue || '—';
          licenseValueSpan.style.color = licenseValue ? '#ccc' : '#666';
          licenseValueSpan.setAttribute('title', licenseValue || '');
        }
        if (licenseValue) {
          licenseItem.style.cursor = 'pointer';
          licenseItem.classList.add('clickable-metadata');
          licenseItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const licenseSelect = document.getElementById('license-select');
            if (licenseSelect) {
              licenseSelect.value = licenseValue;
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              }
            }
          };
        } else {
          licenseItem.style.cursor = 'default';
          licenseItem.classList.remove('clickable-metadata');
          licenseItem.onclick = null;
        }
      }
      
      // Update tags — create .tags-item if missing (initial detailed render removes the row when a model had no tags)
      let tagsItem = metadataContainer.querySelector('.tags-item');
      const normalizeTagNames = (arr) => {
        if (!Array.isArray(arr)) return [];
        const names = arr
          .map(t => (typeof t === 'string' ? t : (t && (t.name || t)) || ''))
          .filter(Boolean);
        names.sort((a, b) => a.localeCompare(b));
        return names;
      };
      let tagNames = normalizeTagNames(model.tags);

      const applyDetailedTagsRow = (names) => {
        const text = names.join(', ');
        if (names.length === 0) {
          if (tagsItem) {
            tagsItem.remove();
            tagsItem = null;
          }
          return;
        }
        if (!tagsItem) {
          tagsItem = document.createElement('div');
          tagsItem.className = 'metadata-item tags-item';
          tagsItem.style.gridColumn = '1 / -1';
          tagsItem.innerHTML = `
          <span class="metadata-icon">🏷️</span>
          <span class="metadata-value tags-info" style="color: #ccc" title=""></span>
        `;
          metadataContainer.appendChild(tagsItem);
        }
        const tagsValueSpan = tagsItem.querySelector('.metadata-value.tags-info');
        if (tagsValueSpan) {
          fillTagsWithFilterLinks(tagsValueSpan, names);
          tagsValueSpan.setAttribute('title', text);
          tagsValueSpan.style.color = '#ccc';
        }
      };

      if (tagNames.length > 0) {
        applyDetailedTagsRow(tagNames);
      } else if (model.id) {
        window.electron.getModelTags(model.id).then((dbTags) => {
          const names = normalizeTagNames(dbTags);
          const mc = existingElement.querySelector('.metadata-container');
          if (!mc) return;
          tagsItem = mc.querySelector('.tags-item');
          applyDetailedTagsRow(names);
        }).catch(err => console.error('Error loading tags:', err));
      } else {
        applyDetailedTagsRow([]);
      }
    } else if (isDetailedView || currentViewIsDetailed) {
      // Only warn if we're in detailed view but metadata container is missing
      // This shouldn't happen in detailed view, so it's a real issue
      console.warn('Metadata container not found for element in detailed view:', existingElement);
    }
    // For preview and list views, metadata container is expected to be missing, so no warning
    
    // Update fields in LIST mode
    // isListView is already declared above, reuse it
    if (isListView && fileInfo) {
      console.log('updateModelElement: Updating list view fields, fileInfo:', fileInfo);
      console.log('updateModelElement: Model designer value:', model.designer);
      
      // Update designer in list view
      // The designer is inside .designer-info-column > .designer-info
      const designerColumn = fileInfo.querySelector('.designer-info-column');
      console.log('updateModelElement: designerColumn found?', !!designerColumn);
      if (designerColumn) {
        const designerElement = designerColumn.querySelector('.designer-info');
        console.log('updateModelElement: designerElement found?', !!designerElement);
        if (designerElement) {
          const designerValue = model.designer || '';
          designerElement.textContent = designerValue;
          designerElement.style.color = designerValue ? '#aaa' : '#666';
          console.log('updateModelElement: Updated designer in list view to', designerValue);
        } else {
          console.warn('updateModelElement: .designer-info not found inside .designer-info-column');
          // Try to find it directly as fallback
          const directDesignerElement = fileInfo.querySelector('.designer-info');
          if (directDesignerElement) {
            console.log('updateModelElement: Found .designer-info directly, updating');
            const designerValue = model.designer || '';
            directDesignerElement.textContent = designerValue;
            directDesignerElement.style.color = designerValue ? '#aaa' : '#666';
          }
        }
      } else {
        console.warn('updateModelElement: .designer-info-column not found in list view');
        // Try to find it directly as fallback
        const directDesignerElement = fileInfo.querySelector('.designer-info');
        if (directDesignerElement) {
          console.log('updateModelElement: Found .designer-info directly (fallback), updating');
          const designerValue = model.designer || '';
          directDesignerElement.textContent = designerValue;
          directDesignerElement.style.color = designerValue ? '#aaa' : '#666';
        } else {
          console.warn('updateModelElement: .designer-info not found anywhere in fileInfo');
          console.log('updateModelElement: fileInfo children:', Array.from(fileInfo.children).map(c => c.className));
        }
      }
      
      // Update license in list view (if it exists - license column may not be present in all list views)
      const licenseElement = fileInfo.querySelector('.license-info');
      if (licenseElement) {
        const licenseValue = model.license || '';
        licenseElement.textContent = licenseValue;
        licenseElement.style.color = licenseValue ? '#aaa' : '#666';
        console.log('updateModelElement: Updated license in list view to', licenseValue);
      }
      
      // Update tags in list view
      // The tags are inside .tags-info-column > .tags-info
      const tagsColumn = fileInfo.querySelector('.tags-info-column');
      if (tagsColumn) {
        const tagsElement = tagsColumn.querySelector('.tags-info');
        if (tagsElement) {
          if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
            const tagNames = model.tags.map(t =>
              typeof t === 'string' ? t : (t && (t.name || t)) || ''
            ).filter(Boolean);
            tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
            const tagsDisplay = tagNames.join(', ');
            fillTagsWithFilterLinks(tagsElement, tagNames);
            tagsElement.style.color = '#aaa';
            tagsElement.setAttribute('title', tagsDisplay);
          } else if (model.id) {
            tagsElement.textContent = '—';
            tagsElement.style.color = '#666';
            tagsElement.removeAttribute('title');
            window.electron.getModelTags(model.id).then(tags => {
              if (tags && tags.length > 0) {
                const tagNames = tags.map(t =>
                  typeof t === 'string' ? t : (t && (t.name || t)) || ''
                ).filter(Boolean);
                tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
                const tagsText = tagNames.join(', ');
                fillTagsWithFilterLinks(tagsElement, tagNames);
                tagsElement.style.color = '#aaa';
                tagsElement.setAttribute('title', tagsText);
              } else {
                tagsElement.textContent = '—';
                tagsElement.style.color = '#666';
                tagsElement.removeAttribute('title');
              }
            }).catch(err => console.error('Error loading tags:', err));
          } else {
            tagsElement.textContent = '—';
            tagsElement.style.color = '#666';
            tagsElement.removeAttribute('title');
          }
          console.log('updateModelElement: Updated tags in list view');
        } else {
          console.warn('updateModelElement: .tags-info not found inside .tags-info-column');
        }
      } else {
        // Fallback: try direct query in case structure is different
        const tagsElement = fileInfo.querySelector('.tags-info');
        if (tagsElement) {
          if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
            const tagNames = model.tags.map(t =>
              typeof t === 'string' ? t : (t && (t.name || t)) || ''
            ).filter(Boolean);
            tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
            const tagsDisplay = tagNames.join(', ');
            fillTagsWithFilterLinks(tagsElement, tagNames);
            tagsElement.style.color = '#aaa';
            tagsElement.setAttribute('title', tagsDisplay);
          } else if (model.id) {
            tagsElement.textContent = '—';
            tagsElement.style.color = '#666';
            tagsElement.removeAttribute('title');
            window.electron.getModelTags(model.id).then(tags => {
              if (tags && tags.length > 0) {
                const tagNames = tags.map(t =>
                  typeof t === 'string' ? t : (t && (t.name || t)) || ''
                ).filter(Boolean);
                tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
                const tagsText = tagNames.join(', ');
                fillTagsWithFilterLinks(tagsElement, tagNames);
                tagsElement.style.color = '#aaa';
                tagsElement.setAttribute('title', tagsText);
              } else {
                tagsElement.textContent = '—';
                tagsElement.style.color = '#666';
                tagsElement.removeAttribute('title');
              }
            }).catch(err => console.error('Error loading tags:', err));
          } else {
            tagsElement.textContent = '—';
            tagsElement.style.color = '#666';
            tagsElement.removeAttribute('title');
          }
          console.log('updateModelElement: Updated tags in list view (fallback)');
        }
      }
    }
    
    // Make sure selection state is preserved
    if (selectedModels.has(filePath)) {
      existingElement.classList.add('selected');
    } else {
      existingElement.classList.remove('selected');
    }

    debugLog('Updated model element:', { 
      filePath, 
      printed: model.printed,
      designer: model.designer,
      source: model.source,
      license: model.license,
      parentModel: model.parentModel
    });

    // Update the model in the currentModels array so virtual grid uses fresh data
    mergeModelIntoGridCurrentModels(model);

    // In-place DOM updates above are enough; do not remove the grid item or force renderVisibleItemsFn here.
    // Removing + re-rendering the virtual cell was causing multi-second freezes and duplicate updateModelElement runs.

  } catch (error) {
    console.error('Error updating model element:', error);
  }
}



// Move showModelDetails outside the DOMContentLoaded event listener
// Track the current model being displayed to prevent race conditions
let currentModelDetailsPath = null;
let currentModelDetailsAbort = false;

// Parse file path into hierarchical structure
function parsePath(filePath) {
  if (!filePath) return null;
  if (filePath.startsWith('url::')) {
    return {
      isZipEntry: false,
      zipPath: null,
      entryPath: null,
      pathSegments: ['Online model'],
      fullPath: filePath
    };
  }
  
  const isZipEntry = filePath.includes('::');
  let zipPath = null;
  let entryPath = null;
  let fullPath = filePath;
  
  if (isZipEntry) {
    const parts = filePath.split('::');
    zipPath = parts[0];
    entryPath = parts[1];
  }
  
  // Normalize path separators (handle both \ and /)
  // But preserve Windows drive letters (C:, D:, etc.)
  const normalizePath = (path) => {
    // Replace backslashes with forward slashes, but keep drive letters intact
    return path.replace(/\\/g, '/');
  };
  
  // Split path into segments
  let pathSegments = [];
  if (isZipEntry) {
    // For zip entries, split the zip path and entry path separately
    const normalizedZipPath = normalizePath(zipPath);
    const zipSegments = normalizedZipPath.split('/').filter(s => s);
    const entrySegments = entryPath ? entryPath.split('/').filter(s => s) : [];
    pathSegments = {
      zipPath: zipPath,
      zipSegments: zipSegments,
      entrySegments: entrySegments,
      fileName: entrySegments.length > 0 ? entrySegments[entrySegments.length - 1] : null
    };
  } else {
    const normalizedPath = normalizePath(fullPath);
    pathSegments = normalizedPath.split('/').filter(s => s);
  }
  
  return {
    isZipEntry,
    zipPath,
    entryPath,
    pathSegments,
    fullPath
  };
}

// Helper function to get the current model file path
function getCurrentModelFilePath() {
  const pathTreeContainer = document.getElementById('path-tree-container');
  if (pathTreeContainer) {
    return pathTreeContainer.getAttribute('data-file-path') || '';
  }
  return '';
}

// Render path tree visualization
function renderPathTree(filePath, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('Path tree container not found:', containerId);
    return;
  }
  
  if (!filePath) {
    container.innerHTML = '<div class="path-tree-item">No path available</div>';
    return;
  }
  
  const pathInfo = parsePath(filePath);
  if (!pathInfo) {
    container.innerHTML = '<div class="path-tree-item">Invalid path</div>';
    return;
  }
  
  let html = '';
  
  if (pathInfo.isZipEntry) {
    // Handle zip entry paths
    const { zipPath, zipSegments, entrySegments, fileName } = pathInfo.pathSegments;
    
    // Build zip file path tree
    let currentPath = '';
    zipSegments.forEach((segment, index) => {
      if (index === 0) {
        currentPath = segment;
      } else {
        const separator = currentPath.includes(':') ? '\\' : '/';
        currentPath += separator + segment;
      }
      const isLastZipSegment = index === zipSegments.length - 1;
      const indent = '---'.repeat(index);
      const indentClass = `path-tree-indent`;
      
      if (isLastZipSegment) {
        // This is the zip file itself - show it as a folder
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${zipPath}">${segment}</span>
        </div>`;
      } else {
        // Regular folder in zip path - ensure it ends with separator
        let folderPath = currentPath;
        if (!folderPath.endsWith('\\') && !folderPath.endsWith('/')) {
          folderPath += currentPath.includes(':') ? '\\' : '/';
        }
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${folderPath}">${segment}</span>
        </div>`;
      }
    });
    
    // Build entry path tree (nested inside zip)
    let entryCurrentPath = zipPath;
    entrySegments.forEach((segment, index) => {
      const isLastEntrySegment = index === entrySegments.length - 1;
      const indentLevel = zipSegments.length + index;
      const indent = '---'.repeat(indentLevel);
      
      if (isLastEntrySegment) {
        // This is the file
        html += `<div class="path-tree-item" style="margin-left: ${indentLevel * 14}px;">
          <span class="path-tree-icon path-tree-file-icon"></span>
          <span class="path-tree-file">${segment}</span>
        </div>`;
      } else {
        // Folder within zip entry
        html += `<div class="path-tree-item" style="margin-left: ${indentLevel * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${zipPath}">${segment}</span>
        </div>`;
      }
    });
  } else {
    // Handle regular file paths
    const segments = pathInfo.pathSegments;
    
    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      const indent = '---'.repeat(index);
      
      // Build the path up to this segment (for folders, we need the full path to the folder)
      let currentPath = '';
      for (let i = 0; i <= index; i++) {
        if (i === 0) {
          // Handle Windows drive letters (C:, D:, etc.)
          currentPath = segments[i];
        } else {
          // Add separator - use backslash for Windows paths, forward slash for others
          const separator = currentPath.includes(':') ? '\\' : '/';
          currentPath += separator + segments[i];
        }
      }
      
      if (isLast) {
        // This is the file
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-file-icon"></span>
          <span class="path-tree-file">${segment}</span>
        </div>`;
      } else {
        // This is a folder - need to ensure the path ends with a separator for folders
        // But for Windows drive roots (C:\), we need to handle it specially
        let folderPath = currentPath;
        if (!folderPath.endsWith('\\') && !folderPath.endsWith('/')) {
          folderPath += currentPath.includes(':') ? '\\' : '/';
        }
        
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${folderPath}">${segment}</span>
        </div>`;
      }
    });
  }
  
  container.innerHTML = html;
  
  // Add click handlers for all folder elements
  container.querySelectorAll('.path-tree-folder').forEach(folderElement => {
    folderElement.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const folderPath = folderElement.getAttribute('data-path');
      if (folderPath) {
        try {
          // Open the folder in the file explorer
          await window.electron.openPath(folderPath);
        } catch (error) {
          console.error('Error opening folder:', error);
        }
      }
    });
  });
}

async function showModelDetails(filePath) {
  try {
    // Cancel any previous operation
    currentModelDetailsAbort = true;
    
    // Set the new current path
    currentModelDetailsPath = filePath;
    currentModelDetailsAbort = false;
    
    debugLog('Showing model details for:', filePath);
    const model = await window.electron.getModel(filePath);
    
    // Check if this operation was cancelled
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    if (!model) return;

    hideBundleDetailsPanel();

    // Get the details panel reference
    const detailsPanel = document.getElementById('model-details');
    if (!detailsPanel) {
      console.error('Model details panel not found');
      return;
    }
    
    // Check again if cancelled
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }

    // Add multi-edit mode button if it doesn't exist
    const modelDetailsHeader = detailsPanel.querySelector('h3');
    if (modelDetailsHeader && !document.getElementById('enter-multi-edit-button')) {
      const enterMultiEditButton = document.createElement('button');
      enterMultiEditButton.id = 'enter-multi-edit-button';
      enterMultiEditButton.className = 'full-width-button';
      enterMultiEditButton.textContent = 'Enter Multi-Edit Mode';
      
      // Insert after the Model Details header
      modelDetailsHeader.insertAdjacentElement('afterend', enterMultiEditButton);

      // Add click handler
      enterMultiEditButton.addEventListener('click', async () => { // Made async
        isMultiSelectMode = true;
        const multiEditPanel = document.getElementById('multi-edit-panel');
        detailsPanel.classList.add('hidden');
        multiEditPanel.classList.remove('hidden');
        
        // Update the other toggle button's state and text
        const toggleButton = document.getElementById('edit-mode-toggle');
        if (toggleButton) {
          toggleButton.textContent = 'Exit Multi-Edit Mode';
          toggleButton.classList.add('active');
        }
        
        // Add the current model to selection when entering multi-edit mode
        const currentFilePath = getCurrentModelFilePath();
        if (currentFilePath) {
          const storedPath = addToSelectedModels(currentFilePath);
          const normalizedCurrentPath = normalizePathForComparison(currentFilePath);
          // Mark the corresponding DOM element as selected
          const fileItems = document.querySelectorAll('.file-item');
          fileItems.forEach(item => {
            const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
            if (normalizePathForComparison(itemPath) === normalizedCurrentPath) {
              item.classList.add('selected');
            }
          });
        }
        
        // *** ADDED DROPDOWN POPULATION LOGIC ***
        try {
          await populateModelDesignerDropdown(null, 'multi-designer');
          await populateModelLicenseDropdown(null, 'multi-license');
          await populateParentModelDropdown(null, 'multi-parent');
          await populateTagSelect('multi-tag-select', 'multi-tags');
          await populateRemoveTagSelect();
        } catch (error) {
          console.error('Error populating multi-edit dropdowns:', error);
        }
        // ****************************************

        await showMultiEditPanel(); // *** ADDED CALL TO ATTACH LISTENERS ***
        
        // Update the selected count
        updateSelectedCount();

        // Scroll the multi-edit panel into view
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Check again if cancelled before proceeding
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Clear existing tags
    document.getElementById('model-tags').innerHTML = '';

    // First populate all dropdowns with available options
    await Promise.all([
      populateModelDesignerDropdown(model.designer),
      populateModelLicenseDropdown(model.license),
      populateParentModelDropdown(model.parentModel)
    ]);
    
    // Check again if cancelled after async operations
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }

    // Immediately set the designer value after population (before cloning)
    // This ensures the value is set on the populated dropdown
    const designerValueToSet = model.designer || '';
    if (designerValueToSet) {
      const designerSelect = document.getElementById('model-designer');
      if (designerSelect) {
        // Ensure the option exists
        const optionExists = Array.from(designerSelect.options).some(opt => opt.value === designerValueToSet);
        if (!optionExists) {
          const option = document.createElement('option');
          option.value = designerValueToSet;
          option.textContent = designerValueToSet;
          designerSelect.appendChild(option);
        }
        designerSelect.value = designerValueToSet;
        console.log('Set designer before cloning:', designerSelect.value);
      }
    }

    // Add auto-save event listeners for all fields
    const fields = {
      'model-printed': { type: 'checkbox', field: 'printed' },
      'model-source': { type: 'text', field: 'source' },
      'model-notes': { type: 'text', field: 'notes', useChange: true },
      'model-designer': { type: 'select', field: 'designer' },
      'model-license': { type: 'select', field: 'license' },
      'model-parent': { type: 'select', field: 'parentModel' }
    };

    // Store the values before cloning
    const storedValues = {
      'model-path': model.filePath || '',
      'model-name': model.fileName || '',
      'model-designer': model.designer || '',
      'model-source': model.source || '',
      'model-notes': model.notes || '',
      'model-printed': Boolean(model.printed),
      'model-parent': model.parentModel || '',
      'model-license': model.license || ''
    };

    // Remove any existing event listeners by cloning and replacing elements
    // BUT skip cloning the designer dropdown to preserve its value
    Object.keys(fields).forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        // Preserve storedValues that were set from the model - don't overwrite with DOM values
        // The storedValues are already correctly set from the model data above
        // We only need to clone the element to remove event listeners
        
        // For designer dropdown, preserve value more carefully
        if (id === 'model-designer') {
          // Store the value before cloning
          const currentValue = element.value || storedValues[id] || model.designer || '';
          console.log('Designer value before clone:', currentValue);
          const newElement = element.cloneNode(true);
          element.parentNode.replaceChild(newElement, element);
          // Immediately restore the value and ensure option exists
          if (currentValue) {
            // Check if option exists
            const optionExists = Array.from(newElement.options).some(opt => opt.value === currentValue);
            if (!optionExists) {
              const option = document.createElement('option');
              option.value = currentValue;
              option.textContent = currentValue;
              newElement.appendChild(option);
            }
            newElement.value = currentValue;
            console.log('Designer value after clone:', newElement.value);
          }
        } else {
          const newElement = element.cloneNode(true);
          element.parentNode.replaceChild(newElement, element);
        }
      }
    });

    // Check again if cancelled before setting form values
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Set form values AFTER cloning (to ensure they're set on the new elements)
    // Use a small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Final check before updating UI
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Clear the path tree container first to prevent stuck paths
    const pathTreeContainer = document.getElementById('path-tree-container');
    if (pathTreeContainer) {
      pathTreeContainer.innerHTML = '';
      pathTreeContainer.removeAttribute('data-file-path');
    }
    
    // Render path tree instead of setting text input value
    renderPathTree(storedValues['model-path'], 'path-tree-container');
    // Store the file path in a data attribute for other functions that need it
    if (pathTreeContainer) {
      pathTreeContainer.setAttribute('data-file-path', storedValues['model-path']);
    }
    
    // Clear and set model name to prevent stuck values
    const modelNameInput = document.getElementById('model-name');
    if (modelNameInput) {
      modelNameInput.value = '';
      // Defer set so layout settles — must not run after filter clear / new selection (stale TIE name bug)
      const nameForThisLoad = storedValues['model-name'];
      setTimeout(() => {
        if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) return;
        modelNameInput.value = nameForThisLoad;
      }, 0);
    }
    
    // For dropdowns, ensure the option exists before setting value
    const designerSelect = document.getElementById('model-designer');
    if (designerSelect) {
      const designerValue = storedValues['model-designer'] || model.designer || '';
      console.log('Setting designer value:', designerValue, 'Current value:', designerSelect.value);
      
      if (designerValue) {
        // Check if the option exists, if not add it
        const optionExists = Array.from(designerSelect.options).some(opt => opt.value === designerValue);
        console.log('Designer option exists?', optionExists);
        
        if (!optionExists) {
          const option = document.createElement('option');
          option.value = designerValue;
          option.textContent = designerValue;
          designerSelect.appendChild(option);
          console.log('Added designer option:', designerValue);
        }
        
        // Set the value
        designerSelect.value = designerValue;
        console.log('Set designer value to:', designerSelect.value);
        
        // Force a change event to ensure it's registered
        designerSelect.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        designerSelect.value = '';
      }
    } else {
      console.warn('Designer select element not found after cloning');
    }
    
    const licenseSelect = document.getElementById('model-license');
    if (licenseSelect && storedValues['model-license']) {
      const optionExists = Array.from(licenseSelect.options).some(opt => opt.value === storedValues['model-license']);
      if (!optionExists && storedValues['model-license']) {
        const option = document.createElement('option');
        option.value = storedValues['model-license'];
        option.textContent = storedValues['model-license'];
        licenseSelect.appendChild(option);
      }
      licenseSelect.value = storedValues['model-license'];
    }
    
    const parentSelect = document.getElementById('model-parent');
    if (parentSelect && storedValues['model-parent']) {
      const optionExists = Array.from(parentSelect.options).some(opt => opt.value === storedValues['model-parent']);
      if (!optionExists && storedValues['model-parent']) {
        const option = document.createElement('option');
        option.value = storedValues['model-parent'];
        option.textContent = storedValues['model-parent'];
        parentSelect.appendChild(option);
      }
      parentSelect.value = storedValues['model-parent'];
    }
    
    document.getElementById('model-source').value = storedValues['model-source'];
    document.getElementById('model-notes').value = storedValues['model-notes'];
    document.getElementById('model-printed').checked = storedValues['model-printed'];

    // Add new event listeners
    Object.entries(fields).forEach(([id, config]) => {
      const element = document.getElementById(id);
      if (!element) return;

      const handler = async (e) => {
        // Verify that we still have a valid model selected before saving
        // Check both the path tree container and the current model details path
        const pathTreeContainer = document.getElementById('path-tree-container');
        const pathFromContainer = pathTreeContainer?.getAttribute('data-file-path') || '';
        const currentPath = pathFromContainer || getCurrentModelFilePath() || currentModelDetailsPath;
        
        // If no path exists or it doesn't match the original filePath, don't save
        if (!currentPath || currentPath !== filePath || !pathFromContainer) {
          console.log('No valid model selected, ignoring checkbox change');
          // Revert the checkbox to its previous state
          if (config.type === 'checkbox') {
            e.target.checked = !e.target.checked;
          }
          return;
        }
        
        const value = config.type === 'checkbox' ? e.target.checked : e.target.value;
        await autoSaveModel(config.field, value, filePath);
      };

      if (config.useChange) {
        element.addEventListener('change', handler);
      } else if (config.debounce) {
        element.addEventListener('input', debounce(handler, 500));
      } else {
        element.addEventListener('change', handler);
      }
    });

    // Final check before loading tags and showing panel
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Load tags if they exist (skipSave: data is already persisted; avoids N redundant saveModel calls)
    if (model.tags && Array.isArray(model.tags)) {
      const tagNames = model.tags.map(t => (typeof t === 'string' ? t : (t && (t.name || t)) || '')).filter(Boolean);
      tagNames.sort((a, b) => a.localeCompare(b));
      for (const tagName of tagNames) {
        if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) return;
        await addTagToModel(tagName, 'model-tags', { skipSave: true });
      }
    }
    
    // Final check before showing the panel
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }

    // Show the details panel
    detailsPanel.classList.remove('hidden');

    // Hide multi-edit panel if it's open and clear its form fields
    const multiEditPanel = document.getElementById('multi-edit-panel');
    multiEditPanel.classList.add('hidden');
    clearMultiEditFormFields(); // Clear form fields when switching to single-edit mode

    // Maintain selection state
    document.querySelectorAll('.file-item').forEach(item => {
      const itemPath = item.getAttribute('data-filepath');
      if (selectedModels.has(itemPath)) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });

    // Scroll the sidebar to show the model details panel
    const sidebar = document.querySelector('.sidebar');
    sidebar.scrollTo({
      top: detailsPanel.offsetTop - 20, // 20px padding from top
      behavior: 'smooth'
    });

  } catch (error) {
    console.error('Error showing model details:', error); // Keep error logging
  }
}

// Create a function to initialize dialog handlers
function initializeDialogHandlers() {


  
  // Designer dialog handler (existing code for reference)
  document.querySelectorAll('.add-designer-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-designer-dialog');
      const input = document.getElementById('new-designer-name');
      
      dialog.querySelector('form').reset();
      input.value = '';
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-designer';
      
      dialog.showModal();
      forceDialogRefresh(dialog, input);
    });
  });
}

// Helper function to force dialog refresh
function forceDialogRefresh(dialog, input) {
  // Force dialog refresh
  dialog.style.display = 'none';
  requestAnimationFrame(() => {
    dialog.style.display = '';
    
    // Reset input state
    input.disabled = false;
    input.readOnly = false;
    input.blur();
    
    // Force focus after a small delay
    setTimeout(() => {
      input.focus();
      input.click();
      
      // Additional focus attempt after a longer delay
      setTimeout(() => {
        if (document.activeElement !== input) {
          input.focus();
          input.click();
        }
      }, 100);
    }, 50);
  });
}

// Moved resetInputState definition before the focus handler that calls it
function resetInputState(input) {
  if (!input) return;
  input.disabled = false;
  input.readOnly = false;
  // Don't clear the value here to preserve any entered data on refocus
  setTimeout(() => {
    input.focus();
    input.click();
  }, 50);
}

// Add window focus handler
window.addEventListener('focus', () => {
  // Find any open dialog and reset its input
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog) {
    const input = openDialog.querySelector('input[type="text"]');
    if (input) {
      resetInputState(input);
    }
  }
});

// Flag to prevent multiple hash generation dialogs from showing
let isHashDialogShowing = false;
// Flag to track if we're currently checking for hashes (prevents race conditions)
let isCheckingForHashes = false;

// Flag to prevent multiple thumbnail generation dialogs from showing
let isThumbnailDialogShowing = false;
// Flag to prevent multiple regenerate thumbnails dialogs from showing
let isRegeneratingThumbnails = false;

// Active browser-side waiter for a server/Docker bulk thumbnail job
let activeServerThumbnailJobWaiter = null;

function isServerThumbnailWorkerContext() {
  if (typeof window.electron?.isServerThumbnailWorker !== 'function') {
    return Promise.resolve(false);
  }
  return window.electron.isServerThumbnailWorker().catch(() => false);
}

function showBackgroundThumbnailProgress(text, percent) {
  const progressSection = document.getElementById('progress-section');
  const progressContainer = document.getElementById('progress-container');
  const renderProgressContainer = document.getElementById('render-progress-container');
  const renderProgressBar = document.getElementById('render-progress-bar');
  const renderProgressText = document.getElementById('render-progress-text');
  const stopButton = document.getElementById('stop-thumbnail-generation');
  if (!progressSection || !renderProgressBar || !renderProgressText) return;

  progressSection.classList.remove('hidden');
  if (renderProgressContainer) renderProgressContainer.classList.remove('hidden');
  if (progressContainer) progressContainer.classList.add('hidden');
  renderProgressBar.style.width = `${Math.max(0, Math.min(100, percent || 0))}%`;
  renderProgressText.textContent = text || 'Generating thumbnails in background...';
  if (stopButton) {
    stopButton.style.display = 'block';
    stopButton.onclick = () => {
      window.electron.cancelServerThumbnailJob().catch((err) => {
        console.warn('Failed to cancel background thumbnail job:', err);
      });
      renderProgressText.textContent = 'Stopping...';
      stopButton.disabled = true;
    };
    stopButton.disabled = false;
  }
}

function hideBackgroundThumbnailProgress() {
  const progressSection = document.getElementById('progress-section');
  const renderProgressContainer = document.getElementById('render-progress-container');
  const stopButton = document.getElementById('stop-thumbnail-generation');
  if (stopButton) {
    stopButton.style.display = 'none';
    stopButton.onclick = null;
    stopButton.disabled = false;
  }
  if (renderProgressContainer) renderProgressContainer.classList.add('hidden');
  if (progressSection) {
    const progressContainer = document.getElementById('progress-container');
    const scanVisible = progressContainer && !progressContainer.classList.contains('hidden');
    if (!scanVisible) progressSection.classList.add('hidden');
  }
}

async function refreshGridAfterBackgroundThumbnailJob() {
  try {
    if (typeof invalidatePrimaryThumbnailCache === 'function') {
      invalidatePrimaryThumbnailCache();
    }
    const sortSelect = document.getElementById('sort-select');
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    } else if (typeof renderFiles === 'function') {
      const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
      await renderFiles(models);
    }
  } catch (err) {
    console.warn('Failed to refresh grid after background thumbnail job:', err);
  }
}

/**
 * Browser clients in server mode: start a server-side job and mirror progress locally.
 * Desktop / non-server: returns null so callers fall back to local generation.
 * Resolves early with { backgrounded: true } if the user moves the job to the sidebar.
 */
async function startAndWatchServerThumbnailJob(mode, title) {
  const serverMode = await window.electron.isServerMode().catch(() => false);
  const isWorker = await isServerThumbnailWorkerContext();
  if (!serverMode || isWorker || typeof window.electron.startServerThumbnailJob !== 'function') {
    return null;
  }

  if (activeServerThumbnailJobWaiter) {
    throw new Error('A thumbnail job is already running');
  }

  const jobMode = mode === 'all' ? 'all' : 'missing';
  const overlay = window.ThumbnailProgress;
  const jobTitle = title || (jobMode === 'all' ? 'Regenerate Thumbnails' : 'Generate Missing Thumbnails');

  return new Promise(async (resolve, reject) => {
    const waiter = {
      resolve,
      reject,
      settled: false,
      backgrounded: false,
      mode: jobMode,
      title: jobTitle,
      lastProcessed: 0,
      lastTotal: 0
    };
    activeServerThumbnailJobWaiter = waiter;
    window._serverBulkThumbnailJobActive = true;

    overlay?.show({
      title: jobTitle,
      phase: 'Starting on server...',
      cancellable: true,
      allowBackground: true
    });
    overlay?.onCancel(() => {
      window.electron.cancelServerThumbnailJob().catch((err) => {
        console.warn('Failed to cancel server thumbnail job:', err);
      });
    });
    overlay?.onBackground(() => {
      if (!activeServerThumbnailJobWaiter || activeServerThumbnailJobWaiter !== waiter) return;
      waiter.backgrounded = true;
      const total = waiter.lastTotal || 0;
      const processed = waiter.lastProcessed || 0;
      const percent = total > 0 ? Math.floor((processed / total) * 100) : 0;
      const label = total > 0
        ? `${jobTitle}: ${processed}/${total} (${percent}%)`
        : `${jobTitle}: running in background...`;
      showBackgroundThumbnailProgress(label, percent);
      overlay.hide();
      if (!waiter.settled) {
        waiter.settled = true;
        waiter.resolve({ backgrounded: true, mode: jobMode });
      }
    });

    try {
      const start = await window.electron.startServerThumbnailJob({ mode: jobMode });
      if (!start || !start.success) {
        activeServerThumbnailJobWaiter = null;
        window._serverBulkThumbnailJobActive = false;
        hideBackgroundThumbnailProgress();
        overlay?.hide();
        reject(new Error((start && start.error) || 'Failed to start server thumbnail job'));
        return;
      }
    } catch (err) {
      activeServerThumbnailJobWaiter = null;
      window._serverBulkThumbnailJobActive = false;
      hideBackgroundThumbnailProgress();
      overlay?.hide();
      reject(err);
    }
  });
}

window._electronRealEventHandlers['thumbnail-job-progress'] = function(payload) {
  window._serverBulkThumbnailJobActive = true;
  const waiter = activeServerThumbnailJobWaiter;
  if (!waiter || !payload) return;

  if (typeof payload.processed === 'number') waiter.lastProcessed = payload.processed;
  if (typeof payload.total === 'number') waiter.lastTotal = payload.total;

  if (waiter.backgrounded) {
    const total = waiter.lastTotal || 0;
    const processed = waiter.lastProcessed || 0;
    const percent = total > 0 ? Math.floor((processed / total) * 100) : 0;
    const label = total > 0
      ? `${waiter.title}: ${processed}/${total} (${percent}%)`
      : (payload.phase || `${waiter.title}: running in background...`);
    showBackgroundThumbnailProgress(label, percent);
    return;
  }

  const overlay = window.ThumbnailProgress;
  if (!overlay) return;
  if (payload.phase) overlay.setPhase(payload.phase);
  if (typeof payload.total === 'number' && payload.total > 0) {
    overlay.update(payload.processed || 0, payload.total, payload.phase);
  } else if (payload.phase) {
    overlay.setIndeterminate(true);
    overlay.setPhase(payload.phase);
  }
};
if (window._electronPendingEvents['thumbnail-job-progress']) {
  window._electronPendingEvents['thumbnail-job-progress'].forEach((args) => {
    window._electronRealEventHandlers['thumbnail-job-progress'].apply(null, args);
  });
  delete window._electronPendingEvents['thumbnail-job-progress'];
}

window._electronRealEventHandlers['thumbnail-job-complete'] = function(result) {
  const waiter = activeServerThumbnailJobWaiter;
  activeServerThumbnailJobWaiter = null;
  window._serverBulkThumbnailJobActive = false;
  const wasBackgrounded = !!(waiter && waiter.backgrounded);

  hideBackgroundThumbnailProgress();
  if (typeof processRenderQueue === 'function' && renderQueue.length > 0) {
    setTimeout(() => processRenderQueue(), 100);
  }

  if (wasBackgrounded) {
    const cancelled = !!(result && result.cancelled);
    refreshGridAfterBackgroundThumbnailJob();
    window.electron.showMessage(
      waiter.title || 'Thumbnails',
      cancelled ? 'Thumbnail generation stopped.' : 'Thumbnail generation finished.'
    ).catch(() => {});
    return;
  }

  if (!waiter || waiter.settled) return;
  waiter.settled = true;
  const overlay = window.ThumbnailProgress;
  overlay?.complete(result && result.cancelled ? 'Stopped.' : 'Finished.');
  waiter.resolve(result || { success: true });
};
if (window._electronPendingEvents['thumbnail-job-complete']) {
  window._electronPendingEvents['thumbnail-job-complete'].forEach((args) => {
    window._electronRealEventHandlers['thumbnail-job-complete'].apply(null, args);
  });
  delete window._electronPendingEvents['thumbnail-job-complete'];
}

window._electronRealEventHandlers['thumbnail-job-error'] = function(payload) {
  const waiter = activeServerThumbnailJobWaiter;
  activeServerThumbnailJobWaiter = null;
  window._serverBulkThumbnailJobActive = false;
  const wasBackgrounded = !!(waiter && waiter.backgrounded);

  hideBackgroundThumbnailProgress();
  window.ThumbnailProgress?.hide();
  if (typeof processRenderQueue === 'function' && renderQueue.length > 0) {
    setTimeout(() => processRenderQueue(), 100);
  }

  const message = (payload && payload.error) || 'Server thumbnail job failed';
  if (wasBackgrounded) {
    window.electron.showMessage('Error', message).catch(() => {});
    return;
  }

  if (!waiter || waiter.settled) return;
  waiter.settled = true;
  waiter.reject(new Error(message));
};
if (window._electronPendingEvents['thumbnail-job-error']) {
  window._electronPendingEvents['thumbnail-job-error'].forEach((args) => {
    window._electronRealEventHandlers['thumbnail-job-error'].apply(null, args);
  });
  delete window._electronPendingEvents['thumbnail-job-error'];
}

// Hidden Electron window (--server): WebGL bulk thumbnail worker.
// Registered at top level so it still initializes if later DOMContentLoaded paths return early (e.g. TOS).
(function initServerThumbnailWorkerEarly() {
  const cancelRef = { cancelled: false };
  let workerBusy = false;

  async function waitForGenerateThumbnailsForModels(timeoutMs) {
    const deadline = Date.now() + (timeoutMs || 60000);
    while (typeof window.generateThumbnailsForModels !== 'function') {
      if (Date.now() > deadline) {
        throw new Error('Thumbnail generator not ready in server worker window');
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    return window.generateThumbnailsForModels;
  }

  window._electronRealEventHandlers['cancel-server-thumbnail-job'] = function() {
    cancelRef.cancelled = true;
  };
  if (window._electronPendingEvents['cancel-server-thumbnail-job']) {
    window._electronPendingEvents['cancel-server-thumbnail-job'].forEach((args) => {
      window._electronRealEventHandlers['cancel-server-thumbnail-job'].apply(null, args);
    });
    delete window._electronPendingEvents['cancel-server-thumbnail-job'];
  }

  window._electronRealEventHandlers['run-server-thumbnail-job'] = async function(payload) {
    const isWorker = await isServerThumbnailWorkerContext();
    if (!isWorker) return;
    if (workerBusy) {
      console.warn('[Server thumbnails] Ignoring job; worker already busy');
      return;
    }

    const mode = payload && payload.mode === 'all' ? 'all' : 'missing';
    workerBusy = true;
    cancelRef.cancelled = false;
    window._serverBulkThumbnailJobActive = true;

    try {
      const generateThumbnailsForModels = await waitForGenerateThumbnailsForModels();

      // Path-only worklist — never preload thousands of full model rows (OOM on large libs).
      let filePaths = [];
      if (mode === 'missing') {
        const without = await window.electron.getModelsWithoutThumbnails();
        filePaths = (without || []).map((m) => m.filePath).filter(Boolean);
      } else if (typeof window.electron.getAllModelReferences === 'function') {
        const refs = await window.electron.getAllModelReferences();
        filePaths = (refs || []).map((m) => m.filePath).filter(Boolean);
      } else {
        const all = await window.electron.getAllModels('date-desc', 0);
        filePaths = (all || []).map((m) => m.filePath).filter(Boolean);
      }

      const total = filePaths.length;
      await window.electron.reportServerThumbnailProgress({
        phase: total ? `Generating thumbnails for ${total} models...` : 'Nothing to generate',
        processed: 0,
        total,
        mode
      });

      if (cancelRef.cancelled) {
        await window.electron.reportServerThumbnailComplete({ cancelled: true, mode, count: 0 });
        return;
      }

      if (!total) {
        await window.electron.reportServerThumbnailComplete({ cancelled: false, mode, count: 0 });
        return;
      }

      // Small chunks keep peak RAM low; concurrency 1 avoids shared-WebGL races + OOM.
      const CHUNK_SIZE = 25;
      let cancelled = false;
      for (let offset = 0; offset < filePaths.length; offset += CHUNK_SIZE) {
        if (cancelRef.cancelled) {
          cancelled = true;
          break;
        }
        const chunkPaths = filePaths.slice(offset, offset + CHUNK_SIZE);
        const chunkModels = chunkPaths.map((filePath) => ({ filePath, hash: '' }));
        const result = await generateThumbnailsForModels(chunkModels, {
          headless: true,
          maxConcurrent: 1,
          cancelRef,
          mode,
          skipHash: true,
          progressOffset: offset,
          progressTotal: total,
          title: mode === 'all' ? 'Regenerate Thumbnails' : 'Generate Missing Thumbnails'
        });
        if (result && result.cancelled) {
          cancelled = true;
          break;
        }
        // Drop chunk references before next batch; yield so V8 can GC.
        chunkModels.length = 0;
        chunkPaths.length = 0;
        await new Promise((r) => setTimeout(r, 50));
        if (typeof gc === 'function') {
          try { gc(); } catch (_) { /* ignore */ }
        }
      }

      await window.electron.reportServerThumbnailComplete({
        cancelled: cancelled || cancelRef.cancelled,
        mode,
        count: total
      });
    } catch (error) {
      console.error('[Server thumbnails] Worker job failed:', error);
      try {
        await window.electron.reportServerThumbnailError({ message: error.message || String(error) });
      } catch (reportErr) {
        console.error('[Server thumbnails] Failed to report error:', reportErr);
      }
    } finally {
      workerBusy = false;
      cancelRef.cancelled = false;
      window._serverBulkThumbnailJobActive = false;
    }
  };
  if (window._electronPendingEvents['run-server-thumbnail-job']) {
    window._electronPendingEvents['run-server-thumbnail-job'].forEach((args) => {
      window._electronRealEventHandlers['run-server-thumbnail-job'].apply(null, args);
    });
    delete window._electronPendingEvents['run-server-thumbnail-job'];
  }

  isServerThumbnailWorkerContext().then((isWorker) => {
    if (isWorker) {
      console.log('[Server thumbnails] Hidden window worker handlers registered');
    }
  }).catch(() => {});
})();
// Flag to prevent multiple DeDup delete confirmations from showing
let isDeletingDuplicates = false;

const DEDUP_PREVIEW_CONCURRENCY = 4;
/** Fixed row height matches .duplicate-group (150px preview + padding/border). */
const DEDUP_ITEM_HEIGHT = 171;
const DEDUP_OVERSCAN = 6;

/** Normalize IPC payload: new array form, or legacy hash→files object. */
function normalizeDuplicateGroups(duplicates) {
  if (!duplicates) return [];
  if (Array.isArray(duplicates)) {
    return duplicates.filter((g) => g && Array.isArray(g.files) && g.files.length > 1);
  }
  return Object.entries(duplicates)
    .filter(([, files]) => Array.isArray(files) && files.length > 1)
    .map(([hash, files]) => ({ hash, files }));
}

function setDuplicatePreviewPlaceholder(previewEl) {
  previewEl.innerHTML = `
    <div class="dedup-preview-loading" style="display:flex;align-items:center;justify-content:center;min-height:120px;color:#888;font-size:0.85rem;">
      Loading preview…
    </div>
  `;
}

async function loadDuplicateGroupPreview(previewEl, filePath, generation) {
  try {
    const thumbnail = await window.electron.getThumbnail(filePath);
    if (generation != null && window._dedupVirtualState?.previewGeneration !== generation) return;
    if (thumbnail && thumbnail !== '3d.png' && thumbnail.trim() !== '') {
      const img = document.createElement('img');
      img.src = thumbnail;
      previewEl.innerHTML = '';
      previewEl.appendChild(img);
      return;
    }
    const rendered = await renderModelToPNG(filePath, previewEl);
    if (generation != null && window._dedupVirtualState?.previewGeneration !== generation) return;
    if (rendered) {
      const img = document.createElement('img');
      img.src = rendered;
      previewEl.innerHTML = '';
      previewEl.appendChild(img);
    } else {
      previewEl.innerHTML = '<div class="error-message">No preview available</div>';
    }
  } catch (error) {
    if (generation != null && window._dedupVirtualState?.previewGeneration !== generation) return;
    console.error('Error loading duplicate preview:', error);
    previewEl.innerHTML = '<div class="error-message">No preview available</div>';
  }
}

function loadDuplicatePreviewsInBackground(tasks, generation) {
  if (!tasks.length) return;
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      if (generation != null && window._dedupVirtualState?.previewGeneration !== generation) return;
      const task = tasks[next++];
      await loadDuplicateGroupPreview(task.preview, task.filePath, generation);
    }
  };
  const workerCount = Math.min(DEDUP_PREVIEW_CONCURRENCY, tasks.length);
  Promise.all(Array.from({ length: workerCount }, () => worker()))
    .catch((err) => console.error('Error loading dedup previews:', err));
}

function createDuplicateGroupElement(group, selectedPaths) {
  const groupEl = document.createElement('div');
  groupEl.className = 'duplicate-group';
  groupEl.dataset.hash = group.hash || '';

  const preview = document.createElement('div');
  preview.className = 'duplicate-preview';
  setDuplicatePreviewPlaceholder(preview);

  const filesList = document.createElement('div');
  filesList.className = 'duplicate-files';

  const header = document.createElement('div');
  header.className = 'duplicate-header';
  header.textContent = `${group.files.length} duplicate files found`;
  filesList.appendChild(header);

  group.files.forEach((file) => {
    const fileDiv = document.createElement('div');
    fileDiv.className = 'duplicate-file';

    const isZipEntry = file.filePath.includes('::');
    if (isZipEntry) {
      fileDiv.classList.add('zip-entry');
    }

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.setAttribute('data-filepath', file.filePath);

    if (isZipEntry) {
      checkbox.disabled = true;
      checkbox.title = 'Cannot delete files inside ZIP archives';
    } else {
      checkbox.checked = selectedPaths.has(file.filePath);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          selectedPaths.add(file.filePath);
        } else {
          selectedPaths.delete(file.filePath);
        }
        updateDedupSelectionCount();
      });
    }

    const filePath = document.createElement('span');
    filePath.className = 'duplicate-file-path';

    if (isZipEntry) {
      const zipBadge = document.createElement('span');
      zipBadge.className = 'zip-entry-badge';
      zipBadge.textContent = 'ZIP';
      zipBadge.title = 'Model in ZIP archive (cannot be deleted)';
      filePath.appendChild(zipBadge);

      const pathText = document.createElement('span');
      pathText.textContent = file.filePath;
      filePath.appendChild(pathText);
    } else {
      filePath.textContent = file.filePath;
    }

    const fileSize = document.createElement('span');
    fileSize.className = 'duplicate-file-size';
    fileSize.textContent = formatFileSize(file.size);

    fileDiv.appendChild(checkbox);
    fileDiv.appendChild(filePath);
    fileDiv.appendChild(fileSize);
    filesList.appendChild(fileDiv);
  });

  groupEl.appendChild(preview);
  groupEl.appendChild(filesList);
  return { groupEl, preview, filePath: group.files[0]?.filePath };
}

function updateDedupSelectionCount() {
  const state = window._dedupVirtualState;
  if (!state) return;
  const countEl = state.container?.querySelector('.dedup-virtual-summary .dedup-selection-count');
  if (countEl) {
    const n = state.selectedPaths.size;
    countEl.textContent = n > 0 ? ` · ${n} selected` : '';
  }
}

function applyDedupEasySelection() {
  const state = window._dedupVirtualState;
  if (!state?.groups?.length) return;
  state.selectedPaths.clear();
  for (const group of state.groups) {
    const files = group.files || [];
    if (files.length === 0) continue;
    const zipFile = files.find((f) => f.filePath.includes('::'));
    const keeperPath = zipFile ? zipFile.filePath : files[0].filePath;
    for (const file of files) {
      if (file.filePath.includes('::')) continue;
      if (file.filePath !== keeperPath) {
        state.selectedPaths.add(file.filePath);
      }
    }
  }
  renderDedupVirtualWindow(true);
  updateDedupSelectionCount();
}
window.applyDedupEasySelection = applyDedupEasySelection;

function clearDedupSelection() {
  const state = window._dedupVirtualState;
  if (!state) return;
  state.selectedPaths.clear();
  renderDedupVirtualWindow(true);
  updateDedupSelectionCount();
}
window.clearDedupSelection = clearDedupSelection;

function teardownDedupVirtualList() {
  const state = window._dedupVirtualState;
  if (!state) return;
  if (state.container && state.scrollHandler) {
    state.container.removeEventListener('scroll', state.scrollHandler);
  }
  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
  }
  state.previewGeneration = (state.previewGeneration || 0) + 1;
  window._dedupVirtualState = null;
}
window.teardownDedupVirtualList = teardownDedupVirtualList;

function renderDedupVirtualWindow(force) {
  const state = window._dedupVirtualState;
  if (!state?.container || !state.groups) return;

  const container = state.container;
  const scrollTop = container.scrollTop;
  const viewportH = container.clientHeight || 300;
  const total = state.groups.length;

  let startIdx = Math.max(0, Math.floor(scrollTop / DEDUP_ITEM_HEIGHT) - DEDUP_OVERSCAN);
  let endIdx = Math.min(total, Math.ceil((scrollTop + viewportH) / DEDUP_ITEM_HEIGHT) + DEDUP_OVERSCAN);

  if (!force && state.lastStart === startIdx && state.lastEnd === endIdx) return;
  state.lastStart = startIdx;
  state.lastEnd = endIdx;

  // Bump generation so in-flight previews for scrolled-away rows are abandoned
  state.previewGeneration = (state.previewGeneration || 0) + 1;
  const generation = state.previewGeneration;

  let spacer = container.querySelector('.dedup-virtual-spacer');
  let content = container.querySelector('.dedup-virtual-content');
  let summary = container.querySelector('.dedup-virtual-summary');

  if (!spacer || !content) {
    container.innerHTML = '';
    summary = document.createElement('div');
    summary.className = 'dedup-virtual-summary';
    summary.style.cssText = 'padding:8px 10px;color:#888;font-size:0.85rem;position:sticky;top:0;background:inherit;z-index:1;';
    summary.innerHTML = `<span class="dedup-group-count"></span><span class="dedup-selection-count"></span>`;

    spacer = document.createElement('div');
    spacer.className = 'dedup-virtual-spacer';
    spacer.style.position = 'relative';

    content = document.createElement('div');
    content.className = 'dedup-virtual-content';
    content.style.position = 'absolute';
    content.style.top = '0';
    content.style.left = '0';
    content.style.right = '0';

    container.appendChild(summary);
    container.appendChild(spacer);
    spacer.appendChild(content);
  }

  const countEl = summary.querySelector('.dedup-group-count');
  if (countEl) {
    countEl.textContent = `${total.toLocaleString()} duplicate group${total === 1 ? '' : 's'}`;
  }
  updateDedupSelectionCount();

  const totalHeight = total * DEDUP_ITEM_HEIGHT;
  spacer.style.height = `${totalHeight}px`;
  spacer.style.position = 'relative';

  content.style.position = 'absolute';
  content.style.top = '0';
  content.style.left = '0';
  content.style.right = '0';
  content.style.transform = `translateY(${startIdx * DEDUP_ITEM_HEIGHT}px)`;
  content.innerHTML = '';

  const previewTasks = [];
  for (let i = startIdx; i < endIdx; i++) {
    const built = createDuplicateGroupElement(state.groups[i], state.selectedPaths);
    built.groupEl.style.minHeight = `${DEDUP_ITEM_HEIGHT - 1}px`;
    built.groupEl.style.boxSizing = 'border-box';
    content.appendChild(built.groupEl);
    if (built.filePath) {
      previewTasks.push({ preview: built.preview, filePath: built.filePath });
    }
  }

  loadDuplicatePreviewsInBackground(previewTasks, generation);
}

function setupDedupVirtualList(container, groups) {
  teardownDedupVirtualList();

  window._dedupVirtualState = {
    container,
    groups,
    selectedPaths: new Set(),
    previewGeneration: 0,
    lastStart: -1,
    lastEnd: -1,
    rafId: 0,
    scrollHandler: null
  };

  const onScroll = () => {
    const state = window._dedupVirtualState;
    if (!state) return;
    if (state.rafId) return;
    state.rafId = requestAnimationFrame(() => {
      state.rafId = 0;
      renderDedupVirtualWindow(false);
    });
  };

  window._dedupVirtualState.scrollHandler = onScroll;
  container.addEventListener('scroll', onScroll, { passive: true });
  container.scrollTop = 0;
  renderDedupVirtualWindow(true);
}

function hashGenerationFailedMessage(result) {
  const hint = result.firstError
    ? ` ${result.firstError}`
    : ' This may be due to network issues or file access problems.';
  if (result.failed === result.total) {
    return `All file hashes failed to generate.${hint}`;
  }
  return `${result.failed} out of ${result.total} file hashes failed to generate. Some duplicates may not be detected.`;
}

function notifyHashGenerationFailures(result) {
  if (!result || !(result.failed > 0)) return;
  const failedMsg = hashGenerationFailedMessage(result);
  if (result.failed === result.total) {
    setTimeout(async () => {
      await window.electron.showMessage('Warning', failedMsg);
    }, 600);
  } else {
    console.warn(failedMsg);
  }
}

// Add or update the loadDuplicateFiles function
// refreshOnly: when true, only refresh duplicate-groups content and do not call showModal() (dialog stays open)
async function loadDuplicateFiles(skipHashCheck = false, refreshOnly = false) {
  try {
    const serverMode = await window.electron.isServerMode().catch(() => false);
    // First check for models without file hash (unless we're skipping the check)
    if (!skipHashCheck) {
      // Check if a hash dialog is already showing or if we're currently checking
      if (isHashDialogShowing || isCheckingForHashes) {
        return; // Exit early if dialog is already showing or check is in progress
      }
      
      isCheckingForHashes = true; // Set flag before checking
      const modelsWithoutHashCount = await window.electron.getModelsWithoutHash();
      const isAlreadyGenerating = await window.electron.isGeneratingHashes();
      isCheckingForHashes = false; // Reset flag after checking
      
      // If there are models without hash, handle based on mode
      if (modelsWithoutHashCount > 0) {
        // Check if hash generation is already running
        if (isAlreadyGenerating) {
          // Hash generation is already in progress - show progress dialog and attach to existing process
          console.log('Hash generation already in progress, showing progress dialog');
          isHashDialogShowing = true;
          
          // Show progress dialog (works in both normal and server mode)
          const progressDialog = document.createElement('dialog');
          progressDialog.className = 'progress-dialog';
          progressDialog.innerHTML = `
            <h3>Generating File Hashes</h3>
            <div class="progress-container">
              <progress id="hash-progress" value="0" max="100"></progress>
              <div id="hash-progress-text">0/${modelsWithoutHashCount}</div>
            </div>
            <p style="margin-top: 15px; color: #666;">
              Hash generation is already running in the background. Progress will be shown here.
            </p>
          `;
          document.body.appendChild(progressDialog);
          progressDialog.showModal();
          
          // Set up progress listener to attach to existing process
          let isCompleting = false;
          const progressListener = (progress) => {
            const progressBar = document.getElementById('hash-progress');
            const progressText = document.getElementById('hash-progress-text');
            
            if (progressBar && progressText) {
              const percentage = (progress.processed / progress.total) * 100;
              progressBar.value = percentage;
              
              if (progress.success !== undefined && progress.failed !== undefined) {
                progressText.textContent = `${progress.processed}/${progress.total} (${progress.success} succeeded, ${progress.failed} failed)`;
              } else {
                progressText.textContent = `${progress.processed}/${progress.total}`;
              }
              
              if (progress.processed >= progress.total && !isCompleting) {
                isCompleting = true;
                setTimeout(() => {
                  progressDialog.close();
                  progressDialog.remove();
                  isHashDialogShowing = false;
                  loadDuplicateFiles(true);
                }, 500);
              }
            }
          };
          
          const completionListener = (result) => {
            notifyHashGenerationFailures(result);
          };
          
          window.electron.onHashGenerationProgress(progressListener);
          window.electron.onHashGenerationComplete(completionListener);
          
          // Don't start a new process, just wait for the existing one
          return;
        }
        
        // In both server mode and normal mode, ask the user if they want to generate hashes
        // and show the progress bar
        isHashDialogShowing = true; // Set flag before showing dialog
        const response = await window.electron.showMessage(
          'Generate File Hashes',
          `${modelsWithoutHashCount} models don't have file hashes which are needed for de-duplication. Would you like to generate the hashes now?`,
          ['Yes', 'No']
        );
      
        if (response === 'Yes') {
          // Show progress dialog (works in both normal and server mode)
          const progressDialog = document.createElement('dialog');
          progressDialog.className = 'progress-dialog';
          progressDialog.innerHTML = `
            <h3>Generating File Hashes</h3>
            <div class="progress-container">
              <progress id="hash-progress" value="0" max="100"></progress>
              <div id="hash-progress-text">0/${modelsWithoutHashCount}</div>
            </div>
            <p style="margin-top: 15px; color: #666;">
              File hashes are needed for de-duplication. This may take some time for large files.
            </p>
          `;
          document.body.appendChild(progressDialog);
          progressDialog.showModal();
          
          // Set up progress listener (works in both normal and server mode via WebSocket)
          let isCompleting = false; // Flag to prevent multiple completion calls
          const progressListener = (progress) => {
            const progressBar = document.getElementById('hash-progress');
            const progressText = document.getElementById('hash-progress-text');
            
            if (progressBar && progressText) {
              const percentage = (progress.processed / progress.total) * 100;
              progressBar.value = percentage;
              
              // Show success/failure counts if available
              if (progress.success !== undefined && progress.failed !== undefined) {
                progressText.textContent = `${progress.processed}/${progress.total} (${progress.success} succeeded, ${progress.failed} failed)`;
              } else {
                progressText.textContent = `${progress.processed}/${progress.total}`;
              }
              
              // Close dialog when complete (only once)
              if (progress.processed >= progress.total && !isCompleting) {
                isCompleting = true;
                setTimeout(() => {
                  progressDialog.close();
                  progressDialog.remove();
                  
                  // Reset flag after hash generation completes
                  isHashDialogShowing = false;
                  
                  // Reload duplicate files now that we have generated hashes
                  // Skip hash check to prevent loop
                  loadDuplicateFiles(true);
                }, 500);
              }
            }
          };
          
          // Set up completion listener to handle success/failure counts
          const completionListener = (result) => {
            notifyHashGenerationFailures(result);
          };
          
          // Listen for completion event
          window.electron.onHashGenerationComplete(completionListener);
          
          // Set up the listener (works in both normal and server mode)
          window.electron.onHashGenerationProgress(progressListener);
          
          // Check if hash generation is already running before starting
          const isAlreadyRunning = await window.electron.isGeneratingHashes();
          if (isAlreadyRunning) {
            console.log('Hash generation already in progress, attaching to existing process');
            // Don't start a new process, just attach to the existing one
            // The progress listener is already set up above, so it will receive updates
            // Update the dialog message to indicate we're joining an existing process
            const dialogContent = progressDialog.querySelector('p');
            if (dialogContent) {
              dialogContent.textContent = 'Hash generation is already running in the background. Progress will be shown here.';
            }
            // Don't call generateMissingHashes() - just wait for progress updates
            return; // Exit early, progress listener will handle completion
          }
          
          // Start hash generation
          try {
            const result = await window.electron.generateMissingHashes();
            
            // Check if it's already running (shouldn't happen after the check above, but handle it)
            if (result && result.alreadyRunning) {
              console.log('Hash generation was already running, attached to existing process');
              // Progress listener is already set up, just wait for updates
              return;
            }

            if (result && result.started) {
              return;
            }
            
            // Check if all hashes failed
            if (result && result.failed === result.total && result.total > 0) {
              // All hashes failed - error dialog will be shown by completion listener
              // Reset flags
              isHashDialogShowing = false;
              isCheckingForHashes = false;
              // Close progress dialog
              progressDialog.close();
              progressDialog.remove();
              return;
            }
            // If some or all succeeded, the completion listener will handle the dialog closing
          } catch (error) {
            console.error('Error generating hashes:', error);
            // Reset flags on error
            isHashDialogShowing = false;
            isCheckingForHashes = false;
            // Close progress dialog
            progressDialog.close();
            progressDialog.remove();
            // Only show error if it's a critical error, not just some failed hashes
            await window.electron.showMessage('Error', 'Failed to generate file hashes. Please check file permissions and network connectivity.');
            return;
          }
          return; // Exit early - we'll reload when hash generation is complete
        } else {
          // If user clicked "No", reset flag and continue to show duplicates for models that have hashes
          isHashDialogShowing = false;
        }
      } else {
        // No models without hash, ensure flag is reset
        isHashDialogShowing = false;
      }
    }
    
    const dialog = document.getElementById('dedup-dialog');
    const duplicateGroups = dialog.querySelector('.duplicate-groups');
    
    // Show loading indicator and open dialog immediately so the UI is not blocked by preview work
    teardownDedupVirtualList();
    duplicateGroups.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #888;">
        <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #333; border-top-color: #4a9eff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 15px;"></div>
        <div style="margin-top: 15px;">Loading duplicate files...</div>
      </div>
    `;
    if (!refreshOnly && !dialog.open) {
      dialog.showModal();
    }
    
    // Check if ZIP is enabled and show/hide the checkbox
    const enableZipArchives = await window.electron.getSetting('enableZipArchives');
    const includeZipContainer = dialog.querySelector('#include-zip-container');
    let includeZipCheckbox = dialog.querySelector('#include-zipped-models');
    
    if (enableZipArchives === '1') {
      // Show the checkbox container
      if (includeZipContainer) {
        includeZipContainer.style.display = 'block';
      }
      // Set up checkbox if it exists
      if (includeZipCheckbox) {
        // Preserve existing checked state (for when user toggles and we reload)
        const wasChecked = includeZipCheckbox.checked;
        // Remove existing listeners and add new one
        const newCheckbox = includeZipCheckbox.cloneNode(true);
        newCheckbox.checked = wasChecked; // Preserve state
        includeZipCheckbox.replaceWith(newCheckbox);
        includeZipCheckbox = newCheckbox;
        newCheckbox.addEventListener('change', async () => {
          await loadDuplicateFiles();
        });
      }
    } else {
      // Hide the checkbox container if ZIP is not enabled
      if (includeZipContainer) {
        includeZipContainer.style.display = 'none';
      }
    }
    
    // Get the current checkbox state (default to false)
    const includeZip = includeZipCheckbox?.checked || false;
    
    // Update loading message
    duplicateGroups.innerHTML = `
      <div style="text-align: center; padding: 40px; color: #888;">
        <div style="display: inline-block; width: 40px; height: 40px; border: 4px solid #333; border-top-color: #4a9eff; border-radius: 50%; animation: spin 1s linear infinite; margin-bottom: 15px;"></div>
        <div style="margin-top: 15px;">Analyzing duplicates...</div>
      </div>
    `;
    
    // Load duplicates with the includeZip parameter
    const duplicatesRaw = await window.electron.getDuplicates(includeZip);
    const groups = normalizeDuplicateGroups(duplicatesRaw);
    const isGeneratingHashes = await window.electron.isGeneratingHashes();
    console.log(`Loaded ${groups.length} duplicate groups (includeZip=${includeZip}, generatingHashes=${isGeneratingHashes})`);
    
    // Show and setup delete button
    const deleteButton = dialog.querySelector('#delete-selected');
    if (deleteButton) {
      deleteButton.style.display = groups.length === 0 ? 'none' : '';
      deleteButton.replaceWith(deleteButton.cloneNode(true));
      const newDeleteButton = dialog.querySelector('#delete-selected');
      if (newDeleteButton && groups.length > 0) {
        newDeleteButton.addEventListener('click', handleDeleteSelected);
      }
    }

    if (groups.length === 0) {
      teardownDedupVirtualList();
      let emptyHtml = '';
      if (isGeneratingHashes) {
        emptyHtml += `
          <div class="hash-generation-warning" style="background-color: #fff3cd; color: #856404; padding: 10px; margin-bottom: 15px; border-radius: 4px; border: 1px solid #ffeeba;">
            <strong>Note:</strong> Hash generation is currently running in the background. 
            Additional duplicate files may be found once the process completes.
          </div>
        `;
      }
      emptyHtml += `
        <div style="text-align: center; padding: 20px; color: #888;">
          No duplicate models found
        </div>
      `;
      duplicateGroups.innerHTML = emptyHtml;
    } else {
      setupDedupVirtualList(duplicateGroups, groups);
      if (isGeneratingHashes) {
        const warningDiv = document.createElement('div');
        warningDiv.className = 'hash-generation-warning';
        warningDiv.style.cssText = 'background-color:#fff3cd;color:#856404;padding:10px;margin-bottom:8px;border-radius:4px;border:1px solid #ffeeba;';
        warningDiv.innerHTML = `
          <strong>Note:</strong> Hash generation is currently running in the background. 
          Additional duplicate files may be found once the process completes.
        `;
        duplicateGroups.insertBefore(warningDiv, duplicateGroups.firstChild);
      }
    }

    if (!refreshOnly && !dialog.open) {
      dialog.showModal();
    }
    
  } catch (error) {
    console.error('Error loading duplicates:', error);
    // Reset flags in case of error
    isHashDialogShowing = false;
    isCheckingForHashes = false;
    teardownDedupVirtualList();
    // In refreshOnly mode (e.g. after delete), don't show error dialog so user stays in de-dupe list
    if (!refreshOnly) {
      await window.electron.showMessage('Error', 'Failed to load duplicate files');
    }
  }
}

/** After reordering the default thumbnail, sync the virtual grid cell (same approach as thumbnail-deleted IPC). */
async function refreshGridModelAfterManageThumbnailsActiveChange(filePath) {
  await new Promise((r) => setTimeout(r, 200));
  try {
    const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
    const normalizedPath = normalizePathForComparison(filePath);

    const updatedModel = await window.electron.getModel(filePath);
    if (!updatedModel) return;
    syncPrimaryThumbnailCacheFromThumbnailString(filePath, updatedModel.thumbnail);

    if (preservedDateAddedFilter) {
      if (updatedModel.dateAdded) {
        const modelDateAdded = new Date(updatedModel.dateAdded);
        const filterDate = new Date(preservedDateAddedFilter);
        if (modelDateAdded < filterDate) return;
      }
      window.dateAddedFilter = preservedDateAddedFilter;
      window._lastDateAddedFilter = preservedDateAddedFilter;

      for (const fileItem of document.querySelectorAll('.file-item')) {
        const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
        if (normalizePathForComparison(itemPath) !== normalizedPath) continue;
        const container = document.querySelector('.file-grid');
        if (container?.currentModels) {
          const modelIndex = container.currentModels.findIndex(
            (m) => normalizePathForComparison(m.filePath) === normalizedPath
          );
          if (modelIndex >= 0) container.currentModels[modelIndex] = { ...updatedModel };
        }
        fileItem.remove();
        if (container?.renderVisibleItemsFn) container.renderVisibleItemsFn();
        return;
      }
      return;
    }

    const container = document.querySelector('.file-grid');
    for (const fileItem of document.querySelectorAll('.file-item')) {
      const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
      if (normalizePathForComparison(itemPath) !== normalizedPath) continue;
      if (container?.currentModels) {
        const modelIndex = container.currentModels.findIndex(
          (m) => normalizePathForComparison(m.filePath) === normalizedPath
        );
        if (modelIndex >= 0) container.currentModels[modelIndex] = { ...updatedModel };
      }
      fileItem.remove();
      if (container?.renderVisibleItemsFn) container.renderVisibleItemsFn();
      return;
    }

    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    } else {
      const sortSelect = document.getElementById('sort-select');
      const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
      if (typeof renderFiles === 'function') await renderFiles(models);
    }
  } catch (err) {
    console.error('Error refreshing grid after active thumbnail change:', err);
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  }
}

// Function to show manage thumbnails modal
async function showManageThumbnailsModal(filePath) {
  const dialog = document.getElementById('manage-thumbnails-dialog');
  const grid = document.getElementById('thumbnails-grid');
  
  if (!dialog || !grid) {
    throw new Error('Manage thumbnails dialog elements not found');
  }
  const title = dialog.querySelector('h3');
  const desc = dialog.querySelector('.form-group p');
  if (title) title.textContent = 'Manage Thumbnails';
  if (desc) desc.textContent = 'Select a thumbnail to set it as active, or delete thumbnails (the active thumbnail cannot be deleted).';

  if (!dialog._manageThumbnailsCloseListenerAttached) {
    dialog._manageThumbnailsCloseListenerAttached = true;
    dialog.addEventListener('close', () => {
      const fp = dialog.dataset.pendingManageThumbnailsRefreshPath;
      if (!fp) return;
      delete dialog.dataset.pendingManageThumbnailsRefreshPath;
      refreshGridModelAfterManageThumbnailsActiveChange(fp).catch((e) =>
        console.error('Manage thumbnails close refresh:', e)
      );
    });
  }
  
  try {
    // Get all thumbnails for the model
    const allThumbnails = await window.electron.getAllThumbnails(filePath);
    
    // Filter out invalid thumbnails (3d.png and non-data URLs)
    const validThumbnails = allThumbnails.filter(t => 
      t && t !== '3d.png' && t.length > 0 && t.startsWith('data:image')
    );
    
    if (validThumbnails.length === 0) {
      alert('This model has no thumbnails to manage.');
      return;
    }
    
    // Clear the grid
    grid.innerHTML = '';
    
    // Create thumbnail items
    validThumbnails.forEach((thumbnail, index) => {
      const item = document.createElement('div');
      item.className = 'thumbnail-item';
      if (index === 0) {
        item.classList.add('active');
      }
      item.dataset.index = index;
      
      const img = document.createElement('img');
      img.src = thumbnail;
      img.alt = `Thumbnail ${index + 1}`;
      
      const label = document.createElement('div');
      label.className = 'thumbnail-item-label';
      label.textContent = index === 0 ? 'Active' : `Image ${index + 1}`;
      
      const overlay = document.createElement('div');
      overlay.className = 'thumbnail-item-overlay';
      
      const setActiveButton = document.createElement('button');
      setActiveButton.type = 'button';
      setActiveButton.className = 'thumbnail-item-button set-active';
      setActiveButton.textContent = index === 0 ? 'Active' : 'Set as Active';
      setActiveButton.disabled = index === 0;
      
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'thumbnail-item-button delete';
      deleteButton.textContent = 'Delete';
      // Disable delete for active thumbnail (index 0) or if only one thumbnail remains
      deleteButton.disabled = index === 0 || validThumbnails.length <= 1;
      
      // Set active button handler
      setActiveButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          await window.electron.setDefaultThumbnail(filePath, index);
          dialog.dataset.pendingManageThumbnailsRefreshPath = filePath;

          // Refresh the modal to show updated state
          await showManageThumbnailsModal(filePath);
        } catch (error) {
          console.error('Error setting active thumbnail:', error);
          alert('Error setting active thumbnail: ' + error.message);
        }
      });
      
      // Delete button handler
      deleteButton.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        // Confirm deletion
        if (!confirm(`Are you sure you want to delete this thumbnail?`)) {
          return;
        }
        
        try {
          await window.electron.deleteThumbnail(filePath, index);
          
          // Refresh the modal to show updated thumbnails
          await showManageThumbnailsModal(filePath);
        } catch (error) {
          console.error('Error deleting thumbnail:', error);
          alert('Error deleting thumbnail: ' + error.message);
        }
      });
      
      // Click on item to set as active (if not already active)
      item.addEventListener('click', async (e) => {
        // Don't trigger if clicking on buttons
        if (e.target.closest('.thumbnail-item-button')) {
          return;
        }
        
        if (index !== 0) {
          try {
            await window.electron.setDefaultThumbnail(filePath, index);
            dialog.dataset.pendingManageThumbnailsRefreshPath = filePath;
            await showManageThumbnailsModal(filePath);
          } catch (error) {
            console.error('Error setting active thumbnail:', error);
            alert('Error setting active thumbnail: ' + error.message);
          }
        }
      });
      
      overlay.appendChild(setActiveButton);
      if (!deleteButton.disabled) {
        overlay.appendChild(deleteButton);
      }
      
      item.appendChild(img);
      item.appendChild(label);
      item.appendChild(overlay);
      grid.appendChild(item);
    });
    
    // Show the dialog
    dialog.showModal();
    
    // Handle dialog close
    const form = dialog.querySelector('form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        dialog.close();
      });
    }
    
    // Also handle close button
    const closeButton = dialog.querySelector('button[type="submit"]');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        dialog.close();
      });
    }
    
  } catch (error) {
    console.error('Error loading thumbnails:', error);
    throw error;
  }
}

// Update the checkTermsOfService function to return a promise
async function checkTermsOfService() {
  try {
    // Hidden server worker has no interactive UI; never block init on TOS.
    if (await isServerThumbnailWorkerContext()) {
      return true;
    }

    let tosAccepted = await window.electron.getSetting('tosAcceptedDate');
    const termsDialog = document.getElementById('terms-of-service-dialog');
    const acceptButton = document.getElementById('accept-terms');
    const declineButton = document.getElementById('decline-terms');

    if (!termsDialog || !acceptButton || !declineButton) {
      console.error('Terms of Service dialog elements not found');
      return false; // Return false if dialog elements are not found
    }

    if (!tosAccepted) {
      termsDialog.showModal();
      
      return new Promise((resolve) => {
        const acceptHandler = async () => {
          // Remove event listeners first to prevent double-clicks
          acceptButton.removeEventListener('click', acceptHandler);
          declineButton.removeEventListener('click', declineHandler);
          
          // Save TOS acceptance to database
          await window.electron.saveSetting('tosAcceptedDate', new Date().toISOString());
          
          // Close the terms dialog
          termsDialog.close();
          
          // Small delay to ensure dialog closes before showing welcome
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Show welcome dialog if this is the first run
          const hasRunBefore = await window.electron.getSetting('hasRunBefore');
          if (!hasRunBefore) {
            const welcomeDialog = document.getElementById('welcome-message');
            if (welcomeDialog) {
              welcomeDialog.showModal();
              await window.electron.saveSetting('hasRunBefore', 'true');
            }
          }
          
          resolve(true); // Resolve promise when accepted
        };

        const declineHandler = () => {
          acceptButton.removeEventListener('click', acceptHandler);
          declineButton.removeEventListener('click', declineHandler);
          window.electron.quitApp();
          resolve(false); // Resolve promise when declined
        };

        acceptButton.addEventListener('click', acceptHandler);
        declineButton.addEventListener('click', declineHandler);
      });
    }
    return true; // Return true if already accepted
  } catch (error) {
    console.error('Error checking Terms of Service:', error);
    return false; // Return false on error
  }
}

// Function to create menu dropdown for server mode
function createMenuDropdown(label, items) {
  const menuContainer = document.createElement('div');
  menuContainer.style.cssText = 'position: relative; margin-right: 15px;';
  
  const menuButton = document.createElement('button');
  menuButton.textContent = label;
  menuButton.style.cssText = 'background: none; border: none; color: #e0e0e0; padding: 5px 10px; cursor: pointer; font-size: 13px; font-family: inherit;';
  menuButton.onmouseover = () => menuButton.style.backgroundColor = '#3a3a3a';
  menuButton.onmouseout = () => menuButton.style.backgroundColor = 'transparent';
  
  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; background-color: #2c2c2c; border: 1px solid #444; border-radius: 4px; min-width: 180px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); z-index: 10001; margin-top: 2px;';
  
  items.forEach(item => {
    if (item.label === '---') {
      const separator = document.createElement('div');
      separator.style.cssText = 'height: 1px; background-color: #444; margin: 4px 0;';
      dropdown.appendChild(separator);
    } else {
      const menuItem = document.createElement('div');
      menuItem.textContent = item.label;
      menuItem.style.cssText = 'padding: 8px 12px; color: #e0e0e0; cursor: pointer; font-size: 13px;';
      menuItem.onmouseover = () => menuItem.style.backgroundColor = '#3a3a3a';
      menuItem.onmouseout = () => menuItem.style.backgroundColor = 'transparent';
      menuItem.onclick = () => {
        if (item.action) {
          item.action();
        }
        dropdown.style.display = 'none';
      };
      dropdown.appendChild(menuItem);
    }
  });
  
  menuButton.onclick = (e) => {
    e.stopPropagation();
    const isVisible = dropdown.style.display === 'block';
    // Close all other dropdowns
    document.querySelectorAll('#server-menu-bar [style*="display: block"]').forEach(el => {
      if (el !== dropdown && el.style.display === 'block') el.style.display = 'none';
    });
    dropdown.style.display = isVisible ? 'none' : 'block';
  };
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!menuContainer.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
  
  menuContainer.appendChild(menuButton);
  menuContainer.appendChild(dropdown);
  
  return menuContainer;
}

  // Show/hide direction description paragraphs when "Use folder path" dropdown changes (STL Home dialog)
  function updateStlHomePathDirectionDesc() {
    const sel = document.getElementById('stl-home-path-direction');
    const fromModelDesc = document.getElementById('stl-home-path-desc-from-model');
    const fromRootDesc = document.getElementById('stl-home-path-desc-from-root');
    if (!sel || !fromModelDesc || !fromRootDesc) return;
    const isFromRoot = sel.value === 'fromRoot';
    fromModelDesc.style.display = isFromRoot ? 'none' : '';
    fromRootDesc.style.display = isFromRoot ? '' : 'none';
  }
  window.updateStlHomePathDirectionDesc = updateStlHomePathDirectionDesc;

  // Gray out path-metadata options when "Enable" is unchecked (used by STL Home dialog)
  function updateStlHomePathMetadataGrayed() {
  const enableEl = document.getElementById('stl-home-path-metadata-enabled');
  const optionsEl = document.getElementById('stl-home-path-metadata-options');
  if (optionsEl) optionsEl.classList.toggle('grayed', !enableEl?.checked);
}
window.updateStlHomePathMetadataGrayed = updateStlHomePathMetadataGrayed;

// Shared function to initialize and open STL Home dialog
window.openSTLHomeDialog = async function() {
  const stlHomeDialog = document.getElementById('stl-home-dialog');
  if (!stlHomeDialog) return;
  
  // Check if we're in server mode
  const serverMode = await window.electron.isServerMode().catch(() => false);
  
  // Load the current STL Home setting (if any)
  const dir = await window.electron.getSetting('stlHome');
  const directoryInput = document.getElementById('stl-home-directory');
  if (directoryInput) {
    directoryInput.value = dir || "";
  }
  
  // Load the update frequency setting (default to 60 minutes)
  const updateFrequency = await window.electron.getSetting('stlHomeUpdateFrequency');
  const updateFrequencyInput = document.getElementById('stl-home-update-frequency');
  const updateFrequencyGroup = document.getElementById('stl-home-update-frequency-group');
  const chooseButton = document.getElementById('choose-stl-home-button');

  // Load path metadata from folder (STL Home only): enabled + direction + use Designer/Parent checkboxes + segment indices
  const pathMetaEnabled = await window.electron.getSetting('pathMetadataStlHomeEnabled');
  const pathMetaDirection = await window.electron.getSetting('pathMetadataStlHomeDirection');
  const pathMetaUseDesigner = await window.electron.getSetting('pathMetadataUseDesigner');
  const pathMetaUseParentModel = await window.electron.getSetting('pathMetadataUseParentModel');
  const pathMetaDesignerIndex = await window.electron.getSetting('pathMetadataDesignerIndex');
  const pathMetaParentModelIndex = await window.electron.getSetting('pathMetadataParentModelIndex');
  const pathMetaEnabledEl = document.getElementById('stl-home-path-metadata-enabled');
  const pathMetaDirectionEl = document.getElementById('stl-home-path-direction');
  const pathMetaUseDesignerEl = document.getElementById('stl-home-use-designer');
  const pathMetaUseParentModelEl = document.getElementById('stl-home-use-parent-model');
  const pathMetaDesignerIndexEl = document.getElementById('stl-home-designer-index');
  const pathMetaParentModelIndexEl = document.getElementById('stl-home-parent-model-index');
  if (pathMetaEnabledEl) pathMetaEnabledEl.checked = pathMetaEnabled === '1';
  if (pathMetaDirectionEl) pathMetaDirectionEl.value = (pathMetaDirection === 'fromRoot' || pathMetaDirection === 'fromModel') ? pathMetaDirection : 'fromModel';
  if (pathMetaUseDesignerEl) pathMetaUseDesignerEl.checked = pathMetaUseDesigner !== '0';
  if (pathMetaUseParentModelEl) pathMetaUseParentModelEl.checked = pathMetaUseParentModel !== '0';
  if (pathMetaDesignerIndexEl) pathMetaDesignerIndexEl.value = (pathMetaDesignerIndex !== null && pathMetaDesignerIndex !== '') ? String(pathMetaDesignerIndex) : '1';
  if (pathMetaParentModelIndexEl) pathMetaParentModelIndexEl.value = (pathMetaParentModelIndex !== null && pathMetaParentModelIndex !== '') ? String(pathMetaParentModelIndex) : '0';
  if (typeof window.updateStlHomePathDirectionDesc === 'function') window.updateStlHomePathDirectionDesc();
  updateStlHomePathMetadataGrayed();
  // Re-apply grayed state after paint (fixes Docker/server mode where checkbox state wasn't reflected)
  requestAnimationFrame(() => updateStlHomePathMetadataGrayed());
  
  if (serverMode) {
    // In server mode: hide Choose Directory button, show Update Frequency, make input editable
    if (chooseButton) chooseButton.style.display = 'none';
    if (updateFrequencyGroup) updateFrequencyGroup.style.display = 'block';
    if (updateFrequencyInput) {
      updateFrequencyInput.value = updateFrequency || '60';
    }
    // Make the input field editable in server mode so users can type paths
    if (directoryInput) {
      directoryInput.removeAttribute('readonly');
      directoryInput.placeholder = 'Enter UNC path (e.g., \\\\server\\share\\path)';
    }
  } else {
    // In normal mode: show Choose Directory button, hide Update Frequency, keep input readonly
    if (chooseButton) chooseButton.style.display = 'block';
    if (updateFrequencyGroup) updateFrequencyGroup.style.display = 'none';
    // Keep input readonly in normal mode (browse button is used)
    if (directoryInput) {
      directoryInput.setAttribute('readonly', 'readonly');
      directoryInput.placeholder = 'No directory selected';
    }
  }

  // Bind Save button when dialog opens - run save logic directly so it always works (Docker/server load order)
  const saveBtn = document.getElementById('save-stl-home-button');
  if (saveBtn) {
    saveBtn.addEventListener('click', async function onSaveClick(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[STL Home] Save button clicked');
      const stlDirEl = document.getElementById('stl-home-directory');
      const stlDir = stlDirEl ? stlDirEl.value.trim() : '';
      const pathMetaEnabledEl = document.getElementById('stl-home-path-metadata-enabled');
      const pathMetaUseDesignerEl = document.getElementById('stl-home-use-designer');
      const pathMetaUseParentModelEl = document.getElementById('stl-home-use-parent-model');
      const pathMetaDirectionEl = document.getElementById('stl-home-path-direction');
      const pathMetaDesignerIndexEl = document.getElementById('stl-home-designer-index');
      const pathMetaParentModelIndexEl = document.getElementById('stl-home-parent-model-index');
      try {
        console.log('[STL Home] Saving stlHome:', stlDir);
        await window.electron.saveSetting('stlHome', stlDir);
        await window.electron.saveSetting('pathMetadataStlHomeEnabled', pathMetaEnabledEl?.checked ? '1' : '0');
        await window.electron.saveSetting('pathMetadataStlHomeDirection', (pathMetaDirectionEl?.value === 'fromRoot' || pathMetaDirectionEl?.value === 'fromModel') ? pathMetaDirectionEl.value : 'fromModel');
        await window.electron.saveSetting('pathMetadataUseDesigner', pathMetaUseDesignerEl?.checked ? '1' : '0');
        await window.electron.saveSetting('pathMetadataUseParentModel', pathMetaUseParentModelEl?.checked ? '1' : '0');
        await window.electron.saveSetting('pathMetadataDesignerIndex', pathMetaDesignerIndexEl?.value ?? '1');
        await window.electron.saveSetting('pathMetadataParentModelIndex', pathMetaParentModelIndexEl?.value ?? '0');
        // Show "Scan STL Home" in sidebar from value we just saved (Docker/server: getSetting can lag)
        const scanStlHomeBtn = document.getElementById('scan-stl-home-button');
        if (scanStlHomeBtn) scanStlHomeBtn.style.display = (stlDir && stlDir.trim() !== '') ? '' : 'none';
        if (typeof window.updateScanStlHomeButtonVisibility === 'function') await window.updateScanStlHomeButtonVisibility();
        const serverMode = await window.electron.isServerMode().catch(() => false);
        if (serverMode) {
          const updateFrequencyEl = document.getElementById('stl-home-update-frequency');
          const updateFrequency = updateFrequencyEl ? updateFrequencyEl.value : '60';
          await window.electron.saveSetting('stlHomeUpdateFrequency', updateFrequency);
          if (stlDir && stlDir.trim() !== '') {
            if (typeof window.performSTLHomeScan === 'function') window.performSTLHomeScan(stlDir).catch(err => console.error('STL Home scan on save:', err));
            if (typeof window.startPeriodicSTLHomeScan === 'function') window.startPeriodicSTLHomeScan();
          } else {
            if (typeof window.stopPeriodicSTLHomeScan === 'function') window.stopPeriodicSTLHomeScan();
          }
        }
        console.log('[STL Home] Save complete, closing dialog');
        if (typeof stlHomeDialog.close === 'function') stlHomeDialog.close();
      } catch (err) {
        console.error('[STL Home] Save failed:', err);
        if (window.electron && typeof window.electron.showMessage === 'function') {
          await window.electron.showMessage('Error', 'Failed to save STL Home: ' + (err.message || String(err)));
        }
      }
    }, { once: true });
  }

  stlHomeDialog.showModal();
};

// About dialog functions - defined at top level for accessibility
function bindAboutCloseButton() {
  const dialog = document.getElementById('about-dialog');
  const closeXButton = dialog?.querySelector('.about-close-x');
  if (!dialog || !closeXButton) {
    return;
  }

  // Remove any existing event listeners by cloning and replacing the button
  // This ensures we don't have duplicate listeners
  const newButton = closeXButton.cloneNode(true);
  closeXButton.parentNode.replaceChild(newButton, closeXButton);
  
  // Add the click handler to the new button
  newButton.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dialog.close();
  });
}

// Define the collect usage change handler as a named function so we can remove it
async function collectUsageChangeHandler(e) {
  const newValue = e.target.checked ? '1' : '0';
  console.log('About dialog - Saving CollectUsage value:', newValue);
  
  // Save the setting
  await window.electron.saveSetting('CollectUsage', newValue);
  
  // Verify the setting was saved correctly
  const verifiedValue = await window.electron.checkCollectUsage();
  console.log('Verified CollectUsage value from database:', verifiedValue);
  
  // Update the checkbox state to match the database value
  e.target.checked = verifiedValue === '1';
  
  // Toggle analytics based on the verified value
  if (typeof window.toggleAnalytics === 'function') {
    window.toggleAnalytics(verifiedValue === '1');
  }
}

async function initializeAboutDialog() {
  const versionElement = document.getElementById('about-version');
  const dialog = document.getElementById('about-dialog');
  if (!dialog) return;

  // Version: load defensively so dialog always shows something
  try {
    let currentVersion = null;
    if (typeof window.electron?.getSetting === 'function') {
      currentVersion = await window.electron.getSetting('currentVersion').catch(() => null);
    }
    if (!currentVersion && typeof window.electron?.getAppVersion === 'function') {
      currentVersion = await window.electron.getAppVersion().catch(() => null);
    }
    if (versionElement) {
      versionElement.textContent = `Version: ${currentVersion || 'Unknown'}`;
    }
  } catch (e) {
    console.error('About dialog version:', e);
    if (versionElement) versionElement.textContent = 'Version: Unknown';
  }

  // Analytics checkbox: optional, don't block dialog load
  try {
    const collectUsageCheckbox = document.getElementById('collect-usage');
    if (collectUsageCheckbox && typeof window.electron?.getSetting === 'function') {
      const collectUsage = await window.electron.getSetting('CollectUsage').catch(() => null);
      collectUsageCheckbox.checked = collectUsage === '1';
      collectUsageCheckbox.removeEventListener('change', collectUsageChangeHandler);
      collectUsageCheckbox.addEventListener('change', collectUsageChangeHandler);
    }
  } catch (e) {
    console.error('About dialog CollectUsage:', e);
  }

  // Close X is handled by inline onclick in HTML; bind for any extra behavior
  bindAboutCloseButton();

  // License link
  try {
    const licenseLink = document.getElementById('license-link');
    if (licenseLink && typeof window.electron?.openExternal === 'function') {
      licenseLink.addEventListener('click', async (e) => {
        e.preventDefault();
        await window.electron.openExternal('https://github.com/TechJeeper/Printventory/blob/main/LICENSE.txt');
      });
    }
  } catch (e) {
    console.error('About dialog license link:', e);
  }
}

function escapeSystemReportHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatServerGpuReport(serverGpu) {
  if (!serverGpu) {
    return { statusText: '✗ Unavailable', statusColor: '#f44336', details: 'No response from getGpuInfo.' };
  }
  if (serverGpu.error) {
    return {
      statusText: '✗ Error',
      statusColor: '#f44336',
      details: escapeSystemReportHtml(serverGpu.error)
    };
  }

  const lines = [];
  const backend = serverGpu.glBackend || 'unknown';
  const backendLabel = backend === 'swiftshader'
    ? 'SwiftShader (CPU / software WebGL)'
    : (backend === 'nvidia' ? 'NVIDIA hardware WebGL (requested)' : backend);
  lines.push(`<div><strong>GL backend:</strong> ${escapeSystemReportHtml(backendLabel)}</div>`);

  if (serverGpu.activeRenderer) {
    lines.push(`<div><strong>Electron WebGL renderer:</strong> ${escapeSystemReportHtml(serverGpu.activeRenderer)}</div>`);
  }

  if (serverGpu.nvidia && serverGpu.nvidia.available && Array.isArray(serverGpu.nvidia.gpus)) {
    lines.push('<div style="margin-top:0.5rem;"><strong>nvidia-smi:</strong></div>');
    serverGpu.nvidia.gpus.forEach((gpu) => {
      lines.push(
        `<div style="margin-left:0.5rem;">` +
        `[${escapeSystemReportHtml(gpu.index)}] ${escapeSystemReportHtml(gpu.name)}` +
        ` — driver ${escapeSystemReportHtml(gpu.driverVersion)}` +
        `, mem ${escapeSystemReportHtml(gpu.memoryUsedMiB)}/${escapeSystemReportHtml(gpu.memoryTotalMiB)} MiB` +
        `, util ${escapeSystemReportHtml(gpu.utilizationPercent)}%` +
        `</div>`
      );
    });
  } else if (serverGpu.nvidia && serverGpu.nvidia.message) {
    lines.push(`<div><strong>nvidia-smi:</strong> ${escapeSystemReportHtml(serverGpu.nvidia.message)}</div>`);
  }

  if (serverGpu.nvidiaVisibleDevices) {
    lines.push(`<div><strong>NVIDIA_VISIBLE_DEVICES:</strong> ${escapeSystemReportHtml(serverGpu.nvidiaVisibleDevices)}</div>`);
  }
  if (serverGpu.nvidiaDriverCapabilities) {
    lines.push(`<div><strong>NVIDIA_DRIVER_CAPABILITIES:</strong> ${escapeSystemReportHtml(serverGpu.nvidiaDriverCapabilities)}</div>`);
  } else if (serverGpu.serverMode) {
    lines.push('<div><strong>NVIDIA_DRIVER_CAPABILITIES:</strong> <em>unset</em></div>');
  }

  if (Array.isArray(serverGpu.warnings) && serverGpu.warnings.length) {
    lines.push('<div style="margin-top:0.5rem;color:#ffb74d;"><strong>Warnings:</strong></div>');
    serverGpu.warnings.forEach((w) => {
      lines.push(`<div style="margin-left:0.5rem;color:#ffb74d;">• ${escapeSystemReportHtml(w)}</div>`);
    });
  }

  let statusText = '✗ Not Detected';
  let statusColor = '#f44336';
  if (serverGpu.usingSwiftShader && serverGpu.available) {
    statusText = serverGpu.nvidia?.available
      ? '⚠ Host NVIDIA visible — WebGL on SwiftShader'
      : '✓ SwiftShader (software)';
    statusColor = serverGpu.nvidia?.available ? '#ff9800' : '#4caf50';
  } else if (serverGpu.available && !serverGpu.usingSwiftShader) {
    statusText = '✓ Hardware GPU in use';
    statusColor = '#4caf50';
  } else if (serverGpu.nvidia?.available) {
    statusText = '⚠ NVIDIA visible — WebGL status unknown';
    statusColor = '#ff9800';
  }

  return {
    statusText,
    statusColor,
    details: lines.join('') || 'No additional information available.'
  };
}

async function initializeSystemReport() {
  try {
    const loadingEl = document.getElementById('system-report-loading');
    const contentEl = document.getElementById('system-report-content');
    const clientGpuDetectedEl = document.getElementById('client-gpu-detected') || document.getElementById('gpu-detected');
    const clientGpuDetailsEl = document.getElementById('client-gpu-details') || document.getElementById('gpu-details');
    const serverGpuDetectedEl = document.getElementById('server-gpu-detected');
    const serverGpuDetailsEl = document.getElementById('server-gpu-details');
    const filesystemResultEl = document.getElementById('filesystem-result');
    const filesystemDetailsEl = document.getElementById('filesystem-details');
    const databaseResultEl = document.getElementById('database-result');
    const databaseDetailsEl = document.getElementById('database-details');
    
    // Show loading, hide content
    if (loadingEl) loadingEl.style.display = 'block';
    if (contentEl) contentEl.style.display = 'none';
    
    // Client GPU / WebGL (this browser)
    let clientGpuDetected = false;
    let clientGpuInfo = '';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      
      if (gl) {
        clientGpuDetected = true;
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        if (debugInfo) {
          const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
          const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
          clientGpuInfo = `Vendor: ${escapeSystemReportHtml(vendor)}<br>Renderer: ${escapeSystemReportHtml(renderer)}`;
        } else {
          clientGpuInfo = 'WebGL is available but detailed GPU information is not accessible.';
        }
      } else {
        clientGpuDetected = false;
        clientGpuInfo = 'WebGL is not available. 3D rendering may be limited or unavailable.';
      }
    } catch (error) {
      clientGpuDetected = false;
      clientGpuInfo = `Error detecting GPU: ${escapeSystemReportHtml(error.message)}`;
    }
    
    if (clientGpuDetectedEl) {
      clientGpuDetectedEl.textContent = clientGpuDetected ? '✓ Detected' : '✗ Not Detected';
      clientGpuDetectedEl.style.color = clientGpuDetected ? '#4caf50' : '#f44336';
    }
    if (clientGpuDetailsEl) {
      clientGpuDetailsEl.innerHTML = clientGpuInfo || 'No additional information available.';
    }

    // Server / Electron-process GPU (Docker thumbnail worker or desktop app)
    if (serverGpuDetectedEl || serverGpuDetailsEl) {
      try {
        const serverGpu = typeof window.electron.getGpuInfo === 'function'
          ? await window.electron.getGpuInfo()
          : null;
        const formatted = formatServerGpuReport(serverGpu);
        if (serverGpuDetectedEl) {
          serverGpuDetectedEl.textContent = formatted.statusText;
          serverGpuDetectedEl.style.color = formatted.statusColor;
        }
        if (serverGpuDetailsEl) {
          serverGpuDetailsEl.innerHTML = formatted.details;
        }
      } catch (error) {
        if (serverGpuDetectedEl) {
          serverGpuDetectedEl.textContent = '✗ Error';
          serverGpuDetectedEl.style.color = '#f44336';
        }
        if (serverGpuDetailsEl) {
          serverGpuDetailsEl.innerHTML = escapeSystemReportHtml(error.message);
        }
      }
    }
    
    // Run file system benchmark
    let filesystemInfo = '';
    try {
      const fsResult = await window.electron.benchmarkFilesystem();
      if (fsResult && fsResult.success) {
        filesystemInfo = `Write: ${fsResult.write.speedMBps} MB/s (${fsResult.write.time}ms for ${fsResult.iterations} operations)<br>Read: ${fsResult.read.speedMBps} MB/s (${fsResult.read.time}ms for ${fsResult.iterations} operations)`;
        if (filesystemResultEl) {
          filesystemResultEl.textContent = '✓ Completed';
          filesystemResultEl.style.color = '#4caf50';
        }
      } else {
        filesystemInfo = `Error: ${fsResult?.error || 'Unknown error'}`;
        if (filesystemResultEl) {
          filesystemResultEl.textContent = '✗ Failed';
          filesystemResultEl.style.color = '#f44336';
        }
      }
    } catch (error) {
      filesystemInfo = `Error: ${error.message}`;
      if (filesystemResultEl) {
        filesystemResultEl.textContent = '✗ Error';
        filesystemResultEl.style.color = '#f44336';
      }
    }
    if (filesystemDetailsEl) {
      filesystemDetailsEl.innerHTML = filesystemInfo || 'Benchmark not available.';
    }
    
    // Run database benchmark
    let databaseInfo = '';
    try {
      const dbResult = await window.electron.benchmarkDatabase();
      if (dbResult && dbResult.success) {
        databaseInfo = `Write: ${dbResult.write.opsPerSec} ops/sec (${dbResult.write.time}ms for ${dbResult.write.operations} operations)<br>Read: ${dbResult.read.opsPerSec} ops/sec (${dbResult.read.time}ms for ${dbResult.read.operations} operations)`;
        if (databaseResultEl) {
          databaseResultEl.textContent = '✓ Completed';
          databaseResultEl.style.color = '#4caf50';
        }
      } else {
        databaseInfo = `Error: ${dbResult?.error || 'Unknown error'}`;
        if (databaseResultEl) {
          databaseResultEl.textContent = '✗ Failed';
          databaseResultEl.style.color = '#f44336';
        }
      }
    } catch (error) {
      databaseInfo = `Error: ${error.message}`;
      if (databaseResultEl) {
        databaseResultEl.textContent = '✗ Error';
        databaseResultEl.style.color = '#f44336';
      }
    }
    if (databaseDetailsEl) {
      databaseDetailsEl.innerHTML = databaseInfo || 'Benchmark not available.';
    }
    
    // Hide loading, show content
    if (loadingEl) loadingEl.style.display = 'none';
    if (contentEl) contentEl.style.display = 'block';
    
  } catch (error) {
    console.error('Error initializing system report:', error);
    const loadingEl = document.getElementById('system-report-loading');
    const contentEl = document.getElementById('system-report-content');
    if (loadingEl) {
      loadingEl.innerHTML = `<p style="color: #f44336;">Error loading system report: ${error.message}</p>`;
    }
    if (contentEl) contentEl.style.display = 'none';
  }
}

// Shared function to load AI config settings and show dialog (must be top-level for server menu access)
async function loadAndShowAIConfig() {
  const dialog = document.getElementById('ai-config-dialog');
  if (!dialog) {
    console.error('ai-config-dialog element not found.');
    return;
  }
  
  // Load all settings first, then show dialog with populated values
  const apiKeyValue = await window.electron.getSetting('apiKey').catch(() => null);
  const serviceValue = await window.electron.getSetting('aiService').catch(() => null);
  const endpointValue = await window.electron.getSetting('apiEndpoint').catch(() => null);
  const modelValue = await window.electron.getSetting('aiModel').catch(() => null);
  
  // Ensure dialog is in DOM before getting elements
  if (!dialog.isConnected) {
    document.body.appendChild(dialog);
  }
  
  // Get all form elements
  const keyEl = document.getElementById('ai-api-key');
  const serviceEl = document.getElementById('ai-service-select');
  const endpointEl = document.getElementById('ai-endpoint');
  const modelEl = document.getElementById('ai-model');
  const apiKeyGroup = keyEl?.closest('.form-group');
  
  if (!serviceEl) {
    console.error('ai-service-select element not found.');
    return;
  }
  
  console.log('[AI Config] Found elements:', {
    serviceEl: !!serviceEl,
    endpointEl: !!endpointEl,
    modelEl: !!modelEl,
    keyEl: !!keyEl
  });
  
    // Set service first - default to 'puter' if undefined
    const selectedService = serviceValue || 'puter';
    
    // Force set the select value and verify it stuck
    serviceEl.value = selectedService;
    
    // Double-check the value was set correctly
    if (serviceEl.value !== selectedService) {
      console.warn('[AI Config] Select value mismatch, forcing to:', selectedService);
      // Try setting by selectedIndex
      for (let i = 0; i < serviceEl.options.length; i++) {
        if (serviceEl.options[i].value === selectedService) {
          serviceEl.selectedIndex = i;
          break;
        }
      }
      // Verify again
      if (serviceEl.value !== selectedService) {
        console.error('[AI Config] Failed to set service select to:', selectedService, 'current value:', serviceEl.value);
      }
    }
    
    // Ensure service is saved if it was undefined
    if (!serviceValue || serviceValue !== selectedService) {
      await window.electron.saveSetting('aiService', selectedService).catch((err) => {
        console.error('[AI Config] Error saving service:', err);
      });
      console.log('[AI Config] Saved service to database:', selectedService);
    }
    
    console.log('[AI Config] Service set to:', selectedService, 'serviceEl.value:', serviceEl.value, 'selectedIndex:', serviceEl.selectedIndex);
  
  // Helper function to check if a value is empty/null/undefined
  const isEmpty = (val) => val === null || val === undefined || val === '';
  
  // Set defaults based on service if values are empty
  if (selectedService === 'puter') {
    // Load Puter.js when Puter service is selected in the dialog
    loadPuterJS().catch(err => {
      console.warn('[AI Config] Failed to preload Puter.js:', err);
      // Don't block dialog opening if Puter.js fails to load
    });
    
    // For Puter.com, always use defaults (endpoint and model are required for Puter.com)
    const puterEndpoint = 'https://js.puter.com/v2/';
    const puterModel = 'gpt-5-nano';
    
    console.log('[AI Config] Setting Puter.com defaults:', { endpointEl: !!endpointEl, modelEl: !!modelEl, endpointValue, modelValue });
    
    if (endpointEl) {
      // Always set the Puter.com endpoint
      endpointEl.value = puterEndpoint;
      endpointEl.required = false;
      console.log('[AI Config] Set endpoint to:', endpointEl.value);
      // Save it if it wasn't already saved or if it's different
      if (isEmpty(endpointValue) || endpointValue !== puterEndpoint) {
        await window.electron.saveSetting('apiEndpoint', puterEndpoint).catch((err) => {
          console.error('[AI Config] Error saving endpoint:', err);
        });
      }
    } else {
      console.error('[AI Config] endpointEl not found!');
    }
    if (modelEl) {
      // Always set the Puter.com model
      modelEl.value = puterModel;
      console.log('[AI Config] Set model to:', modelEl.value);
      // Save it if it wasn't already saved or if it's different
      if (isEmpty(modelValue) || modelValue !== puterModel) {
        await window.electron.saveSetting('aiModel', puterModel).catch((err) => {
          console.error('[AI Config] Error saving model:', err);
        });
      }
    } else {
      console.error('[AI Config] modelEl not found!');
    }
    if (keyEl) {
      keyEl.value = '';
      keyEl.required = false;
      keyEl.disabled = true;
    }
    if (apiKeyGroup) apiKeyGroup.style.display = 'none';
  } else if (selectedService === 'openai') {
    if (endpointEl) {
      endpointEl.value = endpointValue || 'https://api.openai.com/v1';
      endpointEl.required = true;
    }
    if (modelEl) {
      modelEl.value = modelValue || 'gpt-4o-mini';
    }
    if (keyEl) {
      keyEl.value = apiKeyValue || '';
      keyEl.required = true;
      keyEl.disabled = false;
    }
    if (apiKeyGroup) apiKeyGroup.style.display = '';
  } else if (selectedService === 'gemini') {
    if (endpointEl) {
      endpointEl.value = endpointValue || 'https://generativelanguage.googleapis.com/v1beta/openai/';
      endpointEl.required = true;
    }
    if (modelEl) {
      modelEl.value = modelValue || 'gemini-2.5-flash';
    }
    if (keyEl) {
      keyEl.value = apiKeyValue || '';
      keyEl.required = true;
      keyEl.disabled = false;
    }
    if (apiKeyGroup) apiKeyGroup.style.display = '';
  } else {
    // Custom service
    if (endpointEl) {
      endpointEl.value = endpointValue || '';
      endpointEl.required = true;
    }
    if (modelEl) {
      modelEl.value = modelValue || '';
    }
    if (keyEl) {
      keyEl.value = apiKeyValue || '';
      keyEl.required = true;
      keyEl.disabled = false;
    }
    if (apiKeyGroup) apiKeyGroup.style.display = '';
  }
  
  // Add input event listeners for real-time persistence (only if not already added)
  if (keyEl && !keyEl.dataset.listenerAdded) {
    keyEl.addEventListener('input', async () => {
      await window.electron.saveSetting('apiKey', keyEl.value).catch(() => {});
    });
    keyEl.dataset.listenerAdded = 'true';
  }
  if (endpointEl && !endpointEl.dataset.listenerAdded) {
    endpointEl.addEventListener('input', async () => {
      await window.electron.saveSetting('apiEndpoint', endpointEl.value).catch(() => {});
    });
    endpointEl.dataset.listenerAdded = 'true';
  }
  if (modelEl && !modelEl.dataset.listenerAdded) {
    modelEl.addEventListener('input', async () => {
      await window.electron.saveSetting('aiModel', modelEl.value).catch(() => {});
    });
    modelEl.dataset.listenerAdded = 'true';
  }
  
  // Load AI tag settings
  const maxTagsValue = await window.electron.getSetting('aiTagMaxTags').catch(() => null);
  const mergeStrategyValue = await window.electron.getSetting('aiTagMergeStrategy').catch(() => null);
  const useCategoriesValue = await window.electron.getSetting('aiTagUseCategories').catch(() => null);
  const allowRetaggingValue = await window.electron.getSetting('aiTagAllowRetagging').catch(() => null);
  const concurrencyValue = await window.electron.getSetting('aiTagConcurrency').catch(() => null);
  const detailLevelValue = await window.electron.getSetting('aiTagDetailLevel').catch(() => null);
  
  const maxTagsEl = document.getElementById('ai-tag-max-tags');
  if (maxTagsEl) {
    maxTagsEl.value = maxTagsValue || '10';
  }
  
  const mergeStrategyEl = document.getElementById('ai-tag-merge-strategy');
  if (mergeStrategyEl) {
    mergeStrategyEl.value = mergeStrategyValue || 'merge';
  }
  
  const useCategoriesEl = document.getElementById('ai-tag-use-categories');
  if (useCategoriesEl) {
    useCategoriesEl.checked = useCategoriesValue === '1';
  }
  
  const allowRetaggingEl = document.getElementById('ai-tag-allow-retagging');
  if (allowRetaggingEl) {
    allowRetaggingEl.checked = allowRetaggingValue === '1';
  }
  
  const concurrencyEl = document.getElementById('ai-tag-concurrency');
  if (concurrencyEl) {
    concurrencyEl.value = concurrencyValue || '3';
  }
  
  const detailLevelEl = document.getElementById('ai-tag-detail-level');
  if (detailLevelEl) {
    detailLevelEl.value = detailLevelValue || 'medium';
  }
  
  // Double-check Puter.com defaults are set (in case elements weren't ready earlier)
  if (selectedService === 'puter') {
    const puterEndpoint = 'https://js.puter.com/v2/';
    const puterModel = 'gpt-5-nano';
    
    // Re-get elements to ensure they're in the DOM
    const finalEndpointEl = document.getElementById('ai-endpoint');
    const finalModelEl = document.getElementById('ai-model');
    
    if (finalEndpointEl && (!finalEndpointEl.value || finalEndpointEl.value === '')) {
      finalEndpointEl.value = puterEndpoint;
      console.log('[AI Config] Re-set endpoint after dialog prep:', finalEndpointEl.value);
    }
    if (finalModelEl && (!finalModelEl.value || finalModelEl.value === '')) {
      finalModelEl.value = puterModel;
      console.log('[AI Config] Re-set model after dialog prep:', finalModelEl.value);
    }
  }
  
  // Now show the dialog with all values populated
  dialog.showModal();
  
  // One more check after dialog is shown (for any edge cases)
  if (selectedService === 'puter') {
    setTimeout(() => {
      const puterEndpoint = 'https://js.puter.com/v2/';
      const puterModel = 'gpt-5-nano';
      const finalEndpointEl = document.getElementById('ai-endpoint');
      const finalModelEl = document.getElementById('ai-model');
      
      if (finalEndpointEl && (!finalEndpointEl.value || finalEndpointEl.value === '')) {
        finalEndpointEl.value = puterEndpoint;
        console.log('[AI Config] Final fallback - set endpoint:', finalEndpointEl.value);
      }
      if (finalModelEl && (!finalModelEl.value || finalModelEl.value === '')) {
        finalModelEl.value = puterModel;
        console.log('[AI Config] Final fallback - set model:', finalModelEl.value);
      }
    }, 100);
  }
}

// Load File Type settings from DB then show dialog (same pattern as loadAndShowAIConfig; required for Docker/server menu)
async function loadAndShowFileTypeSettings() {
  const dialog = document.getElementById('file-type-settings-dialog');
  if (!dialog) {
    console.error('file-type-settings-dialog element not found.');
    return;
  }
  if (window.electron?.whenConnected) {
    try {
      await window.electron.whenConnected();
    } catch (e) {
      console.warn('[File Type] WebSocket wait:', e);
    }
  }
  try {
    const enableZipArchives = await window.electron.getSetting('enableZipArchives');
    const checkbox = document.getElementById('enable-zip-archives');
    if (checkbox) {
      checkbox.checked = enableZipArchives === '1';
    }

    const ADDITIONAL_SCAN_TYPE_IDS = ['3ds', 'amf', 'blender', 'dae', 'dxf', 'dwg', 'fbx', 'f3d', 'f3z', 'gcode', 'igs', 'lys', 'obj', 'ply', 'step', 'svg', 'x3d'];
    try {
      const scanTypesRaw = await window.electron.getSetting('scanAdditionalFileTypes');
      const scanTypes = (scanTypesRaw && typeof scanTypesRaw === 'string') ? JSON.parse(scanTypesRaw) : [];
      const scanSet = new Set(Array.isArray(scanTypes) ? scanTypes : []);
      ADDITIONAL_SCAN_TYPE_IDS.forEach(id => {
        const el = document.getElementById('scan-type-' + id);
        if (el) el.checked = scanSet.has(id);
      });
    } catch (e) { /* ignore */ }

    const enable3MFDesigner = await window.electron.getSetting('enable3MFDesigner');
    const enable3MFParentModel = await window.electron.getSetting('enable3MFParentModel');
    const enable3MFLicense = await window.electron.getSetting('enable3MFLicense');
    const enable3MFNotes = await window.electron.getSetting('enable3MFNotes');

    const designerCheckbox = document.getElementById('enable-3mf-designer');
    const parentModelCheckbox = document.getElementById('enable-3mf-parent-model');
    const licenseCheckbox = document.getElementById('enable-3mf-license');
    const notesCheckbox = document.getElementById('enable-3mf-notes');

    if (designerCheckbox) {
      designerCheckbox.checked = enable3MFDesigner === '1' || enable3MFDesigner === null;
    }
    if (parentModelCheckbox) {
      parentModelCheckbox.checked = enable3MFParentModel === '1' || enable3MFParentModel === null;
    }
    if (licenseCheckbox) {
      licenseCheckbox.checked = enable3MFLicense === '1' || enable3MFLicense === null;
    }
    if (notesCheckbox) {
      notesCheckbox.checked = enable3MFNotes === '1' || enable3MFNotes === null;
    }
  } catch (err) {
    console.error('Error loading file type settings:', err);
  }

  dialog.showModal();
}

// Function to create server mode menu bar (async so we can hide Browser Extension in server mode)
async function createServerMenuBar() {
  const serverMode = await window.electron.isServerMode().catch(() => false);
  const menuBar = document.createElement('div');
  menuBar.id = 'server-menu-bar';
  menuBar.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; height: 30px; background-color: #2c2c2c; border-bottom: 1px solid #444; display: flex; align-items: center; padding: 0 10px; z-index: 10000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px;';
  
  // Tools menu
  const toolsMenu = createMenuDropdown('Tools', [
    { label: 'Scan Directory', action: () => document.getElementById('scan-directory-button')?.click() },
    { label: 'View Entire Library', action: () => document.getElementById('view-library-button')?.click() },
    { label: '---', action: null },
    { label: 'Print Roulette', action: () => window.electron.send('start-print-roulette') },
    { label: 'De-Dup', action: () => {
      const dialog = document.getElementById('dedup-dialog');
      if (dialog) {
        dialog.classList.remove('modal-fullscreen');
        const fullscreenBtn = document.getElementById('dedup-fullscreen-toggle');
        if (fullscreenBtn) fullscreenBtn.textContent = 'Full Screen';
        dialog.showModal();
        const includeZipCheckbox = dialog.querySelector('#include-zipped-models');
        if (includeZipCheckbox) {
          includeZipCheckbox.checked = false;
        }
        loadDuplicateFiles();
      } else {
        // Trigger the event which will open the dialog via the listener
        window.electron.send('open-dedup');
      }
    }},
    { label: '---', action: null },
    { label: 'Tag Manager', action: () => {
      const dialog = document.getElementById('tag-manager-dialog');
      if (dialog) {
        dialog.classList.remove('modal-fullscreen');
        const fullscreenBtn = document.getElementById('tag-manager-fullscreen-toggle');
        if (fullscreenBtn) fullscreenBtn.textContent = 'Full Screen';
        dialog.showModal();
      } else {
        // Fallback: trigger the event which will open the dialog via the listener
        window.electron.send('open-tag-manager');
      }
    }},
    { label: 'Metadata Manager', action: () => {
      window.electron.send('open-metadata-editor');
    }},
    { label: 'Backup/Restore', action: () => {
      const dialog = document.getElementById('backup-restore-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        // Fallback: trigger the event which will open the dialog via the listener
        window.electron.send('open-backup-restore');
      }
    }},
    { label: '---', action: null },
    { label: 'Regenerate Thumbnails', action: () => {
      window.electron.send('regenerate-thumbnails');
    }},
    { label: 'Generate Missing Thumbnails', action: () => {
      window.electron.send('generate-missing-thumbnails');
    }},
    { label: 'Purge Models', action: () => {
      const dialog = document.getElementById('purge-models-dialog');
      if (dialog) {
        dialog.showModal();
      }
    }},
    { label: '---', action: null },
    { label: 'Browser Extension', action: () => {
      window.open('https://chromewebstore.google.com/detail/pigngedngcegmemgfbkaiihjnbplaedj?utm_source=item-share-cb', '_blank', 'noopener,noreferrer');
    }},
    { label: '---', action: null },
    { label: 'Restart Server', action: async () => {
      // Show confirmation dialog
      const confirmed = confirm('Are you sure you want to restart the server? All connected clients will be disconnected temporarily.');
      if (!confirmed) {
        return;
      }
      
      try {
        // Show loading feedback
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'restart-server-loading';
        loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2c2c2c; color: white; padding: 20px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        loadingMsg.textContent = 'Restarting server...';
        document.body.appendChild(loadingMsg);
        
        // Call restart server
        const result = await window.electron.invoke('restart-server');
        
        // Remove loading message
        const loadingElement = document.getElementById('restart-server-loading');
        if (loadingElement) {
          loadingElement.remove();
        }
        
        if (result && result.success) {
          // Show success message briefly
          const successMsg = document.createElement('div');
          successMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #4a9eff; color: white; padding: 20px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
          successMsg.textContent = 'Server restarted successfully';
          document.body.appendChild(successMsg);
          setTimeout(() => {
            if (successMsg.parentNode) {
              successMsg.remove();
            }
          }, 2000);
        } else {
          // Show error message
          alert('Failed to restart server: ' + (result?.message || 'Unknown error'));
        }
      } catch (error) {
        // Remove loading message if it exists
        const loadingElement = document.getElementById('restart-server-loading');
        if (loadingElement) {
          loadingElement.remove();
        }
        console.error('Error restarting server:', error);
        alert('Failed to restart server: ' + (error.message || 'Unknown error'));
      }
    }}
  ]);
  
  // Settings menu (Browser Extension not needed in Docker/Server mode)
  const settingsMenuItems = [
    { label: 'AI Config', action: async () => {
      await loadAndShowAIConfig();
    }},
    { label: 'File Type', action: async () => {
      await loadAndShowFileTypeSettings();
    }},
    { label: 'Performance', action: () => {
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        window.electron.send('open-performance-settings');
      }
    }},
    { label: 'STL Home', action: async () => {
      await window.openSTLHomeDialog();
    }},
    { label: 'Theme', action: () => {
      window.electron.send('open-theme-settings');
    }}
  ];
  if (!serverMode) {
    settingsMenuItems.push({ label: 'Browser Extension', action: async () => {
      const dialog = document.getElementById('browser-extension-settings-dialog');
      if (!dialog) {
        window.electron.send('open-browser-extension-settings');
        return;
      }
      const enabled = await window.electron.getSetting('enableBrowserExtension');
      const port = await window.electron.getSetting('browserExtensionPort');
      const check = document.getElementById('enable-browser-extension');
      const portInput = document.getElementById('browser-extension-port');
      if (check) check.checked = enabled === '1';
      if (portInput) portInput.value = port || '5000';
      dialog.showModal();
    }});
  }
  const settingsMenu = createMenuDropdown('Settings', settingsMenuItems);
  
  // Help menu - Quick Start Guide opens multi-page quickstart-guide, not guide-dialog
  const helpMenu = createMenuDropdown('Help', [
    { label: 'Quick Start Guide', action: () => {
      if (typeof showGuide === 'function') {
        showGuide();
      } else {
        window.electron.send('open-guide');
      }
    }},
    { label: 'Keyboard Shortcuts', action: () => {
      const dialog = document.getElementById('keyboard-shortcuts-dialog');
      if (dialog) dialog.showModal();
    }},
    { label: 'FAQ', action: () => {
      window.electron.openExternal('https://printventory.com/faq.html');
    }},
    { label: 'About', action: async () => {
      const aboutDialog = document.getElementById('about-dialog');
      if (!aboutDialog) return;
      aboutDialog.showModal();
      bindAboutCloseButton();
      try {
        await initializeAboutDialog();
      } catch (e) {
        console.error('Error initializing about dialog:', e);
        const versionEl = document.getElementById('about-version');
        if (versionEl) versionEl.textContent = 'Version: Unknown';
      }
    }},
    { label: '---', action: null },
    { label: 'Discord', action: () => {
      window.electron.openExternal('https://discord.gg/JXcZHT77ua');
    }},
    { label: 'Patreon', action: () => {
      window.electron.openExternal('https://patreon.com/Printventory');
    }},
    { label: 'Support Printventory', action: () => {
      window.electron.openExternal('https://printventory.com/support.html');
    }},
    { label: 'GitHub', action: () => {
      window.electron.openExternal('https://github.com/TechJeeper/Printventory');
    }},
    { label: '---', action: null },
    { label: 'Library Stats', action: () => {
      window.electron.send('open-stats');
    }},
    { label: 'System Report', action: async () => {
      const systemReportDialog = document.getElementById('system-report-dialog');
      if (systemReportDialog) {
        systemReportDialog.showModal();
        await initializeSystemReport();
      }
    }},
    { label: 'Server Mode Info', action: () => {
      window.electron.openExternal('https://github.com/TechJeeper/Printventory?tab=readme-ov-file#server-mode');
    }}
  ]);
  
  menuBar.appendChild(toolsMenu);
  menuBar.appendChild(settingsMenu);
  menuBar.appendChild(helpMenu);
  
  document.body.insertBefore(menuBar, document.body.firstChild);
  document.body.classList.add('server-mode');
  if (document.documentElement) document.documentElement.classList.add('server-mode');

  // Adjust body padding to account for menu bar
  document.body.style.paddingTop = '30px';

  // Prevent left-side shift in Docker/Server: reset horizontal scroll and re-apply after paint
  const resetHorizontalScroll = () => {
    if (document.documentElement) document.documentElement.scrollLeft = 0;
    if (document.body) document.body.scrollLeft = 0;
  };
  resetHorizontalScroll();
  requestAnimationFrame(resetHorizontalScroll);
  window.addEventListener('resize', resetHorizontalScroll);
}

// Extract 3MF thumbnail function - must be at top level for generateThumbnail to access
async function extract3MFThumbnail(filePath) {
  try {
    console.log(`[DEBUG] extract3MFThumbnail: Extracting images from ${filePath}`);
    const images = await window.electron.get3MFImages(filePath);
    if (images && images.length > 0) {
      console.log(`[DEBUG] extract3MFThumbnail: Found ${images.length} image(s) in 3MF file`);
      return images; // Return array of images
    } else {
      console.log(`[DEBUG] extract3MFThumbnail: No images found in 3MF file`);
      return null;
    }
  } catch (error) {
    console.error('extract3MFThumbnail error:', error);
    return null; // Or return null to indicate failure
  }
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async () => {
  // In server mode, the loading overlay blocks UI. Hide it early.
  const initialOverlay = document.getElementById('loading-overlay');
  if (initialOverlay) initialOverlay.style.display = 'none';

  // Docker/Server first connect: wait for WebSocket before any IPC so data loads without refresh
  const isServedOverHttp = window.location.protocol === 'http:' || window.location.protocol === 'https:';
  if (isServedOverHttp && window.electron && typeof window.electron.whenConnected === 'function') {
    const connected = window.electron.whenConnected();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Bridge connect timeout')), 15000));
    try {
      await Promise.race([connected, timeout]);
    } catch (e) {
      console.warn('[Renderer] Bridge whenConnected timeout or error, continuing:', e?.message || e);
    }
  }

  const tosAccepted = await checkTermsOfService();
  if (!tosAccepted) return; // Don't continue if TOS was declined

  await loadListViewColumnStateFromStore();

  // Docker/Server: parallelize initial round-trips to reduce startup lag
  const [serverMode, hasRunBeforeVal, savedView] = await Promise.all([
    window.electron.isServerMode().catch(() => false),
    window.electron.getSetting('hasRunBefore'),
    window.electron.getSetting('gridView')
  ]);

  // After bridge is ready: show "Scan STL Home" when STL Home is set (Docker/server may set via env)
  if (typeof window.updateScanStlHomeButtonVisibility === 'function') {
    window.updateScanStlHomeButtonVisibility().catch(() => {});
  }

  // Docker/server: keep concurrency low — high parallelism + 30s IPC timeouts caused mass
  // "corrupted"/STL placeholders that then got persisted as permanent thumbs.
  // NVIDIA+ANGLE: parallel WebGL + compositor SharedImages tend to Skia-OOM the GPU process.
  if (serverMode) {
    let glBackend = 'unknown';
    try {
      const gpuInfo = typeof window.electron.getGpuInfo === 'function'
        ? await window.electron.getGpuInfo()
        : null;
      glBackend = (gpuInfo && gpuInfo.glBackend) || 'unknown';
    } catch (_) { /* ignore */ }
    if (glBackend === 'nvidia') {
      MAX_CONCURRENT_RENDERS = 1;
      MAX_CONCURRENT_RENDERS_BACKGROUND = 1;
      maxContextReuseCount = 25;
    } else {
      MAX_CONCURRENT_RENDERS = 3;
      MAX_CONCURRENT_RENDERS_BACKGROUND = 1;
      maxContextReuseCount = 40;
    }
    console.log(
      'Server mode detected: Capped MAX_CONCURRENT_RENDERS to',
      MAX_CONCURRENT_RENDERS,
      `(glBackend=${glBackend}, contextReuse=${maxContextReuseCount})`
    );
  }
  // Hidden worker window must not run grid WebGL at all (bulk job owns the GPU/CPU).
  if (await isServerThumbnailWorkerContext()) {
    MAX_CONCURRENT_RENDERS = 0;
    MAX_CONCURRENT_RENDERS_BACKGROUND = 0;
    window._serverBulkThumbnailJobActive = true;
    console.log('[Server thumbnails] Worker window: grid thumbnail renders disabled');
  }

  if (serverMode) {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('server-mode-indicator')) {
      const serverIndicator = document.createElement('div');
      serverIndicator.id = 'server-mode-indicator';
      serverIndicator.style.cssText = 'background-color: #4a9eff; color: white; padding: 10px; margin: 10px 0; border-radius: 4px; text-align: center; font-weight: bold;';
      serverIndicator.innerHTML = `
        <div>🌐 Server Mode</div>
        <div style="font-size: 12px; font-weight: normal; margin-top: 5px;">
          UNC paths required for all file operations
        </div>
      `;
      sidebar.insertBefore(serverIndicator, sidebar.firstChild);
    }
    if (!document.getElementById('server-menu-bar')) {
      await createServerMenuBar();
    }
  }

  // Show the welcome dialog if this is the first run
  if (!hasRunBeforeVal) {
    const welcomeDialog = document.getElementById('welcome-message');
    if (welcomeDialog) {
      welcomeDialog.showModal();
    }
    await window.electron.saveSetting('hasRunBefore', 'true');
  }

  // Load saved grid view preference
  if (savedView && ['list', 'preview', 'detailed'].includes(savedView)) {
    if (savedView === 'small') {
      currentGridView = 'preview';
    } else {
      currentGridView = savedView;
    }
  }

  try {
    const previewTileRaw = await window.electron.getSetting('previewTileSize');
    if (previewTileRaw && ['s', 'm', 'l'].includes(previewTileRaw)) {
      currentPreviewTileSize = previewTileRaw;
    }
  } catch (_) {
    /* ignore */
  }
  
  // Initialize view selector buttons
  const viewButtons = document.querySelectorAll('.view-button');
  // First, remove active class from all buttons
  viewButtons.forEach(btn => btn.classList.remove('active'));
  // Then, add active class only to the button matching the current view
  viewButtons.forEach(button => {
    const view = button.dataset.view;
    if (view === currentGridView) {
      button.classList.add('active');
    }
    button.addEventListener('click', async () => {
      const container = document.querySelector('.file-grid');
      // Capture current models BEFORE clearing so we can re-render without a round-trip (Docker/Server)
      const cachedModels = container?.currentModels ? [...container.currentModels] : null;

      // Before switching views, save current thumbnails in background (do not block — avoids lag in Docker/Server)
      if (currentGridView === 'detailed' && view !== 'detailed') {
        const allWrappers = document.querySelectorAll('.thumbnail-wrapper');
        for (const wrapper of allWrappers) {
          if (wrapper._saveTimeout) {
            clearTimeout(wrapper._saveTimeout);
            wrapper._saveTimeout = null;
          }
          const currentIdx = parseInt(wrapper.dataset.currentIndex) || 0;
          const filePath = wrapper.dataset.filePath;
          const thumbs = JSON.parse(wrapper.dataset.thumbnails || '[]');
          if (filePath && thumbs && thumbs.length > currentIdx && currentIdx >= 0) {
            window.electron.setDefaultThumbnail(filePath, currentIdx).catch((e) => {
              console.error('Error saving default thumbnail on view switch:', e);
            });
          }
        }
      }

      // Remove active class from all buttons
      viewButtons.forEach(btn => btn.classList.remove('active'));
      button.classList.add('active');
      currentGridView = view;
      updateListViewColumnsToolbarButton();
      await window.electron.saveSetting('gridView', view);
      // When viewing a folder (not entire library), remember this view for this folder
      if (!window.viewingEntireLibrary && window.currentDirectoryFilter) {
        await window.savePerFolderView(window.currentDirectoryFilter, view);
      }

      // Clear grid so new view is applied
      if (container) {
        container.innerHTML = '';
        container.currentModels = null;
        container.isRendering = false;
      }

      // Re-render from cached models when possible to avoid backend round-trip (Docker/Server)
      if (cachedModels && cachedModels.length > 0) {
        renderVirtualGrid(cachedModels);
      } else if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      } else {
        const sortSelect = document.getElementById('sort-select');
        const sortOption = sortSelect ? sortSelect.value : 'date-desc';
        const models = await window.electron.getAllModels(sortOption, 0);
        await renderFiles(models);
      }
    });
  });

  const listColsToolbarBtn = document.getElementById('list-view-columns-toolbar-btn');
  if (listColsToolbarBtn) {
    listColsToolbarBtn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleListViewColumnsPopover(listColsToolbarBtn);
    });
  }

  const previewSizeSwitcher = document.getElementById('preview-size-switcher');
  if (previewSizeSwitcher) {
    previewSizeSwitcher.querySelectorAll('[data-preview-size]').forEach((sizeBtn) => {
      sizeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const s = sizeBtn.dataset.previewSize;
        if (!s || s === currentPreviewTileSize) return;
        currentPreviewTileSize = s;
        syncPreviewSizeSwitcherActive();
        try {
          await window.electron.saveSetting('previewTileSize', s);
        } catch (err) {
          console.warn('save previewTileSize:', err);
        }
        const grid = document.querySelector('.file-grid');
        const cached = grid?.currentModels ? [...grid.currentModels] : null;
        if (grid && cached && cached.length > 0) {
          grid.innerHTML = '';
          grid.currentModels = null;
          grid.isRendering = false;
          renderVirtualGrid(cached);
        } else if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
      });
    });
  }

  updateListViewColumnsToolbarButton();
  
  // Save current thumbnails as default before page unload
  window.addEventListener('beforeunload', () => {
    const allWrappers = document.querySelectorAll('.thumbnail-wrapper');
    for (const wrapper of allWrappers) {
      // Clear any pending debounced saves and save immediately
      if (wrapper._saveTimeout) {
        clearTimeout(wrapper._saveTimeout);
        wrapper._saveTimeout = null;
      }
      
      const currentIdx = parseInt(wrapper.dataset.currentIndex) || 0;
      const filePath = wrapper.dataset.filePath;
      const thumbs = JSON.parse(wrapper.dataset.thumbnails || '[]');
      
      if (filePath && thumbs && thumbs.length > currentIdx && currentIdx >= 0) {
        try {
          // Use synchronous-like approach for beforeunload
          window.electron.setDefaultThumbnail(filePath, currentIdx).catch(e => {
            console.error('Error saving thumbnail on unload:', e);
          });
        } catch (e) {
          console.error('Error saving thumbnail on unload:', e);
        }
      }
    }
  });
  
  // Proceed to initialize the application
  // Update checks are handled in initializeApp() to avoid duplicates
  debugLog('DOM fully loaded and parsed');

  const fileGrid = document.querySelector('.file-grid');
  const settingsDialog = document.getElementById('settings-dialog');
  const aboutDialog = document.getElementById('about-dialog');
  const tagDialog = document.getElementById('new-tag-dialog');
  const newTagInput = document.getElementById('new-tag-name');
  const addTagButton = document.getElementById('add-tag-button');
  const licenseSelect = document.getElementById('license-select');
  const newDesignerDialog = document.getElementById('new-designer-dialog');
  const welcomeDialog = document.getElementById('welcome-message');

  // Initialize license filter
  if (licenseSelect) {
    licenseSelect.addEventListener('change', async () => {
      const license = licenseSelect.value;
      const models = await window.electron.getAllModels();
      
      if (license) {
        const filteredModels = models.filter(model => model.license === license);
      } else {
      }
    });
  }

  // Initialize tag filter
  const tagFilterSelect = document.getElementById('tag-filter-select');
  if (tagFilterSelect) {
    tagFilterSelect.addEventListener('change', async (event) => {
      const selectedTag = event.target.value;
      if (selectedTag) {
        const tagContainer = document.getElementById('tag-filter');
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.setAttribute('data-tag-name', selectedTag);
        tag.setAttribute('title', selectedTag); // Show full tag name on hover
        tag.innerHTML = `
          <span class="tag-text">${selectedTag}</span>
          <span class="tag-remove">×</span>
        `;
        
        tag.querySelector('.tag-remove')?.addEventListener('click', () => {
          tag.remove();
          updateTagFilter();
          populateTagFilterDropdown();
        });
        
        tagContainer.appendChild(tag);
        event.target.value = ''; // Reset selection
        updateTagFilter();
        await populateTagFilterDropdown();
      }
    });
  }

  // Docker/Server: hide overlay so main window shell (sidebar, empty grid) paints immediately
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';

  // Docker/Server: yield for first paint, then load data (reduces perceived startup lag).
  // Do NOT call getAllModels here: the same handler later runs performCombinedSearch(), which
  // loads the library in bounded chunks (see search.js). Loading tens of thousands of rows here
  // duplicated IPC work and blocked the main thread for tens of seconds before that path ran.
  requestAnimationFrame(async () => {
    const savedDirectoryPath = await window.electron.loadDirectory();
    const shouldLoadModels = serverMode || savedDirectoryPath;

    if (shouldLoadModels) {
      fileGrid.classList.remove('hidden');
    } else {
      console.log('[DEBUG] No directory path set and not in server mode, showing welcome');
      if (welcomeDialog) {
        welcomeDialog.showModal();
      }
    }

    // Initialize filters in parallel (Docker/Server: one batch instead of four sequential round-trips)
    await Promise.all([
      populateDesignerDropdown(),
      populateLicenseFilter(),
      populateParentModelFilter(),
      populateTagFilter()
    ]);
  });

  // Update the edit mode toggle button listener
  document.getElementById('edit-mode-toggle')?.addEventListener('click', async () => { // Ensure async
    isMultiSelectMode = !isMultiSelectMode;
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    if (isMultiSelectMode) {
      button.textContent = 'Exit Multi-Edit Mode'; // Changed from Single-Edit
      button.classList.add('active');
      multiEditPanel.classList.remove('hidden');
      detailsPanel.classList.add('hidden');
      
      // Populate dropdowns
      try {
        await populateModelDesignerDropdown(null, 'multi-designer');
        await populateModelLicenseDropdown(null, 'multi-license');
        await populateParentModelDropdown(null, 'multi-parent');
        await populateTagSelect('multi-tag-select', 'multi-tags');
        await populateRemoveTagSelect();
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      await showMultiEditPanel(); // Call to attach listeners
      
      multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Clear selection when disabling multiselect
      selectedModels.clear();
      document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
      multiEditPanel.classList.add('hidden');
      // Make sure details panel is shown if nothing else is selected
      if (selectedModels.size === 0) {
         detailsPanel.classList.remove('hidden'); // Remove hidden class if no models selected
         closeDetailsPanel(); // Or potentially call closeDetailsPanel if preferred
      }
      button.textContent = 'Multi-Edit Mode';
      button.classList.remove('active');
      // Call exitMultiEditMode if needed for cleanup
      exitMultiEditMode(); 
    }
    updateSelectedCount();
  });

  // Invert Filter button click handler
  document.getElementById('invert-filter-button')?.addEventListener('click', async () => {
    const button = document.getElementById('invert-filter-button');
    
    // Detect which filter is active and invert it
    const searchTerm = document.getElementById('search-filter-input')?.value?.trim();
    const searchClausesActive =
      typeof window.queryBuilderHasActiveSearchClauses === 'function' &&
      window.queryBuilderHasActiveSearchClauses();
    const designer = document.getElementById('designer-select')?.value;
    const license = document.getElementById('license-select')?.value;
    const parentModel = document.getElementById('parent-select')?.value;
    const tagFilter = document.getElementById('tag-filter')?.value;
    const tagChips = window.multiFilterChips?.tags?.length;

    // Determine which filter to invert (prioritize in order: search, tag, designer, license, parentModel)
    if (searchTerm || searchClausesActive) {
      invertedFilters.search = !invertedFilters.search;
      console.log('Inverted search filter:', invertedFilters.search);
    } else if (tagFilter || tagChips) {
      invertedFilters.tag = !invertedFilters.tag;
      console.log('Inverted tag filter:', invertedFilters.tag);
    } else if (designer || window.multiFilterChips?.designer?.length) {
      invertedFilters.designer = !invertedFilters.designer;
      console.log('Inverted designer filter:', invertedFilters.designer);
    } else if (license || window.multiFilterChips?.license?.length) {
      invertedFilters.license = !invertedFilters.license;
      console.log('Inverted license filter:', invertedFilters.license);
    } else if (parentModel || window.multiFilterChips?.parentModel?.length) {
      invertedFilters.parentModel = !invertedFilters.parentModel;
      console.log('Inverted parentModel filter:', invertedFilters.parentModel);
    } else {
      console.warn('No active filter to invert');
      return;
    }
    
    // Update button appearance to show it's active
    if (Object.values(invertedFilters).some(val => val === true)) {
      button.classList.add('active');
      button.title = 'Filter is inverted (NOT equal)';
    } else {
      button.classList.remove('active');
      button.title = 'Invert the current filter (NOT equal instead of equal)';
    }
    
    // Trigger filter change to apply the inverted filter
    await handleFilterChange();
  });

  // Initialize tag dialog handlers
  addTagButton.addEventListener('click', () => {
    // Reset the form and dialog state
    tagDialog.querySelector('form').reset();
    newTagInput.value = '';
    
    // Store the source container ID for single-edit mode
    tagDialog.setAttribute('data-source-container', 'model-tags');
    
    // Show the dialog
    tagDialog.showModal();
    
    // Use forceDialogRefresh to ensure input focus works properly on Windows
    forceDialogRefresh(tagDialog, newTagInput);
  });

  document.getElementById('cancel-tag-button')?.addEventListener('click', () => {
    // Reset form state before closing
    tagDialog.querySelector('form').reset();
    newTagInput.value = '';
    tagDialog.close();
  });

  tagDialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const newTagName = newTagInput.value.trim();
    
    if (newTagName) {
      try {
        // Save tag and get the tag object back
        const savedTag = await window.electron.saveTag(newTagName);
        // Add the new tag to the model immediately if in single edit mode
        if (!isMultiSelectMode) {
          console.log(`Single edit mode: Adding new tag '${savedTag.name}' to model-tags`); // Added log
          // This line should handle adding the tag visually and saving
          addTagToModel(savedTag.name, 'model-tags');
        }
        // Reset form state before closing
        tagDialog.querySelector('form').reset();
        newTagInput.value = '';
        tagDialog.close();
        
        // Only refresh the currently active dropdown
        if (isMultiSelectMode) {
          await populateTagSelect('multi-tag-select', 'multi-tags');
        } else {
          await populateTagSelect('tag-select', 'model-tags');
        }
        
        // Update the tag filter dropdown
        await populateTagFilter();
        await refreshTagManagerList();
      } catch (error) {
        console.error('Error saving new tag:', error);
      }
    }
  });

  // Load background color setting
  const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
  if (backgroundColor) {
    document.documentElement.style.setProperty('--model-background-color', backgroundColor);
    document.getElementById('model-background-color').value = backgroundColor;
  }

  // Load render color setting
  const renderColor = await window.electron.getSetting('renderColor');
  if (renderColor) {
    const renderColorSelect = document.getElementById('render-color');
    if (renderColorSelect) {
      renderColorSelect.value = renderColor;
    }
    window.currentRenderColor = renderColor;
  } else {
    window.currentRenderColor = '#cccccc';
  }

  // Load lighting setting
  const renderLighting = await window.electron.getSetting('renderLighting');
  if (renderLighting !== null && renderLighting !== undefined) {
    const renderLightingCheckbox = document.getElementById('render-lighting');
    if (renderLightingCheckbox) {
      renderLightingCheckbox.checked = renderLighting === 'true';
    }
    window.currentRenderLighting = renderLighting === 'true';
  } else {
    window.currentRenderLighting = true; // Default to true
  }

  // Settings dialog handlers
  window.electron.onOpenSettings(() => {
    settingsDialog.showModal();
  });

  document.getElementById('cancel-settings')?.addEventListener('click', () => {
    settingsDialog.close();
  });

  document.getElementById('save-settings')?.addEventListener('click', async () => {
    const color = document.getElementById('model-background-color').value;
    const renderColor = document.getElementById('render-color').value;
    const renderLighting = document.getElementById('render-lighting').checked;
    const theme = document.getElementById('ui-theme')?.value || 'modern-cyan';
    
    // Check if render settings changed
    const oldRenderColor = window.currentRenderColor || '#cccccc';
    const oldRenderLighting = window.currentRenderLighting !== undefined ? window.currentRenderLighting : true;
    
    const renderSettingsChanged = (oldRenderColor !== renderColor) || (oldRenderLighting !== renderLighting);

    // Update CSS variable for model background
    document.documentElement.style.setProperty('--model-background-color', color);
    
    // Update UI theme
    document.body.setAttribute('data-theme', theme);
    
    // Save to settings
    await window.electron.saveSetting('modelBackgroundColor', color);
    await window.electron.saveSetting('renderColor', renderColor);
    await window.electron.saveSetting('renderLighting', renderLighting.toString());
    await window.electron.saveSetting('uiTheme', theme);
    
    // Update global variable
    window.currentRenderColor = renderColor;
    window.currentRenderLighting = renderLighting;
    
    // Apply theme colors dynamically
    applyThemeColors(theme);
    
    settingsDialog.close();

    // Ask to regenerate thumbnails if color or lighting changed
    if (renderSettingsChanged) {
        const userChoice = await window.electron.showMessage(
            'Regenerate Thumbnails?',
            'You have changed model rendering settings. Would you like to regenerate all thumbnails to apply this change?',
            ['Yes', 'No']
        );

        if (userChoice === 'Yes') {
             // Get all models
            const sortSelect = document.getElementById('sort-select');
            const allModels = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
            
            if (allModels.length > 0) {
                const serverJob = await startAndWatchServerThumbnailJob('all', 'Regenerate Thumbnails');
                if (serverJob) {
                  if (serverJob.backgrounded || serverJob.cancelled) {
                    return;
                  }
                  invalidatePrimaryThumbnailCache();
                  await window.electron.showMessage('Success', 'Thumbnail regeneration completed successfully.');
                  const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
                  await renderFiles(models);
                  return;
                }

                window.ThumbnailProgress?.show({
                  title: 'Regenerate Thumbnails',
                  phase: 'Clearing existing thumbnails...',
                  cancellable: false
                });
                 // Purge existing thumbnails to force regeneration
                await window.electron.purgeThumbnails();
                invalidatePrimaryThumbnailCache();
                
                // Regenerate thumbnails for all models
                await generateThumbnailsForModels(allModels);
                
                await window.electron.showMessage('Success', 'Thumbnail regeneration completed successfully.');
                
                // Refresh the grid to show the new thumbnails
                const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
                await renderFiles(models);
            }
        }
    }
  });

  // Function to apply theme colors
  function applyThemeColors(theme) {
    const root = document.documentElement;
    switch(theme) {
      case 'modern-purple':
        root.style.setProperty('--primary-accent', '#a855f7');
        root.style.setProperty('--primary-accent-hover', '#c084fc');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #a855f7 0%, #c084fc 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #b866ff 0%, #d094ff 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(168, 85, 247, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(168, 85, 247, 0.4)');
        break;
      case 'modern-green':
        root.style.setProperty('--primary-accent', '#4ade80');
        root.style.setProperty('--primary-accent-hover', '#22c55e');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #5ae890 0%, #2dd66f 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(34, 197, 94, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(34, 197, 94, 0.4)');
        break;
      case 'modern-orange':
        root.style.setProperty('--primary-accent', '#fb923c');
        root.style.setProperty('--primary-accent-hover', '#f97316');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ffa34c 0%, #ff8326 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(249, 115, 22, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(249, 115, 22, 0.4)');
        break;
      case 'modern-pink':
        root.style.setProperty('--primary-accent', '#f472b6');
        root.style.setProperty('--primary-accent-hover', '#ec4899');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ff82c6 0%, #fc58a9 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(236, 72, 153, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(236, 72, 153, 0.4)');
        break;
      case 'dark-minimal':
        root.style.setProperty('--primary-accent', '#9ca3af');
        root.style.setProperty('--primary-accent-hover', '#d1d5db');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(75, 85, 99, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(75, 85, 99, 0.4)');
        break;
      default: // modern-cyan
        root.style.setProperty('--primary-accent', '#00d4ff');
        root.style.setProperty('--primary-accent-hover', '#5b9fff');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #00d4ff 0%, #5b9fff 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #00e5ff 0%, #6ba8ff 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(91, 159, 255, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(91, 159, 255, 0.4)');
    }
  }

  // Load theme on startup
  const savedTheme = await window.electron.getSetting('uiTheme') || 'modern-cyan';
  document.body.setAttribute('data-theme', savedTheme);
  const uiThemeSelect = document.getElementById('ui-theme');
  if (uiThemeSelect) {
    uiThemeSelect.value = savedTheme;
  }
  applyThemeColors(savedTheme);

  // Add dismiss button handler
  document.getElementById('dismiss-welcome')?.addEventListener('click', () => {
    welcomeDialog.close();
  });

  // Notes modal handlers
  const notesModal = document.getElementById('notes-modal-dialog');
  const notesModalTextarea = document.getElementById('notes-modal-textarea');
  const openNotesModalButton = document.getElementById('open-notes-modal-button');
  const saveNotesButton = document.getElementById('save-notes-button');
  const cancelNotesButton = document.getElementById('cancel-notes-button');
  const modelNotesTextarea = document.getElementById('model-notes');

  // Open notes modal
  openNotesModalButton?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Get fresh references to ensure we have the latest values
    const currentNotesTextarea = document.getElementById('model-notes');
    const currentModalTextarea = document.getElementById('notes-modal-textarea');
    const currentModal = document.getElementById('notes-modal-dialog');
    
    if (currentModal && currentModalTextarea && currentNotesTextarea) {
      // Always read the current value from the textarea
      currentModalTextarea.value = currentNotesTextarea.value || '';
      currentModal.showModal();
      // Focus the textarea after a short delay to ensure modal is fully rendered
      setTimeout(() => {
        currentModalTextarea.focus();
      }, 100);
    }
  });

  // Save notes from modal
  saveNotesButton?.addEventListener('click', async (e) => {
    e.preventDefault();
    // Get fresh references to ensure we have the latest elements
    const currentModalTextarea = document.getElementById('notes-modal-textarea');
    const currentNotesTextarea = document.getElementById('model-notes');
    const currentModal = document.getElementById('notes-modal-dialog');
    
    if (currentModal && currentModalTextarea && currentNotesTextarea) {
      const newValue = currentModalTextarea.value || '';
      // Update the main textarea with the new value
      currentNotesTextarea.value = newValue;
      
      // Trigger change event to auto-save
      const changeEvent = new Event('change', { bubbles: true });
      currentNotesTextarea.dispatchEvent(changeEvent);
      
      currentModal.close();
    }
  });

  // Cancel notes modal
  cancelNotesButton?.addEventListener('click', () => {
    if (notesModal) {
      notesModal.close();
    }
  });

  // Handle form submission (e.g., pressing Enter in textarea)
  const notesModalForm = notesModal?.querySelector('form');
  notesModalForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Get fresh references
    const currentModalTextarea = document.getElementById('notes-modal-textarea');
    const currentNotesTextarea = document.getElementById('model-notes');
    
    if (currentModalTextarea && currentNotesTextarea) {
      const newValue = currentModalTextarea.value || '';
      currentNotesTextarea.value = newValue;
      
      // Trigger change event to auto-save
      const changeEvent = new Event('change', { bubbles: true });
      currentNotesTextarea.dispatchEvent(changeEvent);
      
      notesModal.close();
    }
  });

  // Close modal on backdrop click
  notesModal?.addEventListener('click', (e) => {
    if (e.target === notesModal) {
      notesModal.close();
    }
  });

  // Update the save model button handler (single edit)
  document.getElementById('save-model-button')?.addEventListener('click', async () => {
    try {
      const filePath = getCurrentModelFilePath();
      // Get all selected tags
      const tagElements = document.getElementById('model-tags').querySelectorAll('.tag');
      const tags = Array.from(tagElements).map(tag => tag.getAttribute('data-tag-name'));

      const modelData = {
        filePath,
        fileName: document.getElementById('model-name').value,
        designer: document.getElementById('model-designer').value || 'Unknown',
        source: document.getElementById('model-source').value || '',
        notes: document.getElementById('model-notes').value || '',
        printed: document.getElementById('model-printed').checked,
        parentModel: document.getElementById('model-parent').value || '',
        license: document.getElementById('model-license').value || '',
        tags: tags
      };

      // Save the model with tags
      await window.electron.saveModel(modelData);
      // Update the model element in the grid
      await updateModelElement(filePath);
      // Reapply filters and refresh view
      await refreshModelDisplay();

    } catch (error) {
      console.error('Error saving model:', error);
    }
  });

  // Update the multi-save button handler
  document.getElementById('multi-save-button')?.addEventListener('click', async () => {
    try {
      const designer = document.getElementById('multi-designer').value;
      const source = document.getElementById('multi-source').value;
      const parent = document.getElementById('multi-parent').value;
      const license = document.getElementById('multi-license').value;
      const printed = document.getElementById('multi-printed').checked;

      // Get all selected tags
      const tagElements = document.getElementById('multi-tags').querySelectorAll('.tag');
      const tags = Array.from(tagElements).map(tag => tag.getAttribute('data-tag-name'));

      // Update each selected model
      for (const filePath of selectedModels) {
        const existingModel = await window.electron.getModel(filePath);
        
        const modelData = {
          filePath,
          ...(designer && { designer }), // Only include designer if explicitly set
          ...(source && { source }),
          ...(parent && { parentModel: parent }),
          ...(license && { license }),
          printed: printed,
          tags: tags.length > 0 ? tags : (existingModel.tags || []) // Keep tag logic simple here, merging is in auto-save
        };

        await window.electron.saveModel(modelData);
        await updateModelElement(filePath);
      }

      // Clear selection and hide multi-edit panel
      selectedModels.clear();
      isMultiSelectMode = false;
      document.getElementById('multi-edit-panel').classList.add('hidden');
      document.getElementById('model-details').classList.remove('hidden');
      document.getElementById('edit-mode-toggle').textContent = 'Multi-Edit Mode';
      document.getElementById('edit-mode-toggle').classList.remove('active');

      // Clear the multi-edit tag container to prevent stacking
      const multiTagsContainer = document.getElementById('multi-tags');
      if (multiTagsContainer) {
        multiTagsContainer.innerHTML = '';
      }
      
      // Reset the multi-tag-select dropdown
      const multiTagSelect = document.getElementById('multi-tag-select');
      if (multiTagSelect) {
        multiTagSelect.value = '';
      }
      
      // Reset selection tracking to ensure tags are cleared on next selection
      previousSelectionHash = '';

      // Reapply filters to refresh the view
      await refreshModelDisplay();

    } catch (error) {
      console.error('Error saving multiple models:', error);
    }
  });

  // Add open file button handler
  // open-file-button removed - folders in path tree are now directly clickable

  await populateDesignerDropdown();
  await populateLicenseFilter();
  await populateParentModelFilter();
  await populateTagFilter();

  // Add parent model dialog event listeners
  const newParentDialog = document.getElementById('new-parent-dialog');
  const addParentButton = document.getElementById('add-parent-button');
  const cancelParentButton = document.getElementById('cancel-parent-button');
  const newParentForm = newParentDialog.querySelector('form');

  document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-parent-dialog');
      const input = document.getElementById('new-parent-name');
      
      // Reset form and input state
      dialog.querySelector('form').reset();
      input.value = '';
      
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
      
      // Show dialog and focus input
      dialog.showModal();
      
      // Force proper input state
      requestAnimationFrame(() => {
          input.disabled = false;
          input.readOnly = false;
          input.blur();
          input.focus();
      });
    });
  });

  if (cancelParentButton) {
    cancelParentButton.addEventListener('click', () => {
      document.getElementById('new-parent-name').value = '';
      newParentDialog.close();
    });
  }

  if (newParentForm) {
    newParentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newParentName = document.getElementById('new-parent-name').value.trim();
      const sourceDropdownId = newParentDialog.dataset.sourceDropdown || 'model-parent';
      
      if (newParentName) {
        // Trigger auto-save first
        if (sourceDropdownId === 'multi-parent') {
          await autoSaveMultipleModels('parentModel', newParentName);
        } else if (sourceDropdownId === 'parent-select') {
          // For filter dropdown, we need to save to a model first
          // This shouldn't normally happen, but handle it gracefully
          const filePath = getCurrentModelFilePath();
          if (filePath) {
            await autoSaveModel('parentModel', newParentName, filePath);
          }
        } else {
          const filePath = getCurrentModelFilePath();
          await autoSaveModel('parentModel', newParentName, filePath);
        }

        // Repopulate all parent model dropdowns to ensure consistency
        await populateParentModelFilter(); // Filter dropdown
        if (sourceDropdownId === 'model-parent') {
          await populateParentModelDropdown(newParentName, 'model-parent');
        } else if (sourceDropdownId === 'multi-parent') {
          await populateParentModelDropdown(newParentName, 'multi-parent');
        } else if (sourceDropdownId === 'parent-select') {
          // Filter dropdown - already repopulated by populateParentModelFilter
          const parentSelect = document.getElementById('parent-select');
          if (parentSelect) {
            parentSelect.value = newParentName;
          }
        } else {
          // Fallback: manually add to the source dropdown if it's not one of the standard ones
          const parentSelect = document.getElementById(sourceDropdownId);
          if (parentSelect) {
            const optionExists = Array.from(parentSelect.options).some(opt => opt.value === newParentName);
            if (!optionExists) {
              const option = document.createElement('option');
              option.value = newParentName;
              option.textContent = newParentName;
              parentSelect.appendChild(option);
            }
            parentSelect.value = newParentName;
          }
        }
        
        // Clear the input and close the dialog
        document.getElementById('new-parent-name').value = '';
        newParentDialog.close();
        
        // Refresh metadata editor list if dialog is open
        const metadataDialog = document.getElementById('metadata-editor-dialog');
        if (metadataDialog && metadataDialog.open && currentMetadataType === 'parentModel') {
          allMetadata = []; // Clear cache to force refresh
          await refreshMetadataList('parentModel');
        }
      }
    });
  }



  // Remove the nested DOMContentLoaded listener and keep only one at the root level
  document.addEventListener('DOMContentLoaded', async () => {
    const tosAccepted = await checkTermsOfService();
    if (!tosAccepted) return;

    // Initialize filters (without search)
    // Note: sort-select is handled by search.js via initializeCombinedSearch()
    const filterElements = [
      'designer-select',
      'license-select',
      'parent-select',
      'printed-select',
      'new-select',
      'tag-filter',
      'filetype-select'  // Add this line
    ];

    filterElements.forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) {
        element.addEventListener('change', handleFilterChange);
      }
    });

    // Rest of initialization...
    await initializeTags();
    await populateTagFilter();
    initializeListButtons();
  });

  // Remove the other DOMContentLoaded listener that's adding filter change handlers

  await initializeTags();
  initializeListButtons();

  // Update the tag filter event listener
  document.getElementById('tag-filter').addEventListener('change', async (event) => {
    const selectedTag = event.target.value;
    debugLog('Tag filter selected:', selectedTag);
    
    if (!selectedTag) {
      // If no tag selected, show all models
      const models = await window.electron.getAllModels();
      return;
    }

    try {
      // Get all models first
      const allModels = await window.electron.getAllModels();
      debugLog('Total models before filtering:', allModels.length);

      // Filter models that have the selected tag
      const filteredModels = [];
      for (const model of allModels) {
        const modelTags = await window.electron.getModelTags(model.id);
        if (modelTags && modelTags.some(tag => tag.name === selectedTag)) {
          filteredModels.push(model);
        }
      }

      debugLog('Filtered models by tag:', filteredModels.length);
    } catch (error) {
      console.error('Error filtering by tag:', error);
    }
  });

  await populateTagFilter();

  // Update the add button event listeners to handle both panels
  document.querySelectorAll('.add-designer-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-designer-dialog');
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
      dialog.showModal();
    });
  });

  document.querySelectorAll('.add-parent-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-parent-dialog');
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
      dialog.showModal();
    });
  });

  document.querySelectorAll('.add-tag-button').forEach(button => {
    button.addEventListener('click', async () => {
      // Get the container ID for the tags container - we'll need this to know where to add the tag
      const sourceContainer = button.closest('.tags-container').querySelector('.tags-list').id;
      
      // Use the HTML dialog instead of Electron's dialog
      const tagDialog = document.getElementById('new-tag-dialog');
      const newTagInput = document.getElementById('new-tag-name');
      
      // Clear any previous input
      if (newTagInput) {
        newTagInput.value = '';
      }
      
      // Store the source container ID on the dialog for reference when submitting
      tagDialog.setAttribute('data-source-container', sourceContainer);
      
      // Show the dialog
      tagDialog.showModal();
    });
  });
  
  // Handle the tag dialog submit
  document.getElementById('add-tag-submit')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const tagDialog = document.getElementById('new-tag-dialog');
    const newTagInput = document.getElementById('new-tag-name');
    const sourceContainer = tagDialog.getAttribute('data-source-container');
    
    if (newTagInput && newTagInput.value.trim()) {
      const tagName = newTagInput.value.trim();
      try {
        // First save the tag to the database
            const tag = await window.electron.saveTag(tagName);
            if (tag) {
              // Update all tag dropdowns
              await updateAllTagDropdowns();
              
          // Add the tag to the model(s)
          if (sourceContainer) {
            // Add the tag to the model using our helper function
                await addTagToModel(tagName, sourceContainer);
            console.log(`Added tag "${tagName}" to ${sourceContainer}`);
              }
          
          // Close the dialog
          tagDialog.close();
            }
          } catch (error) {
            console.error('Error adding tag:', error);
            await window.electron.showMessage('Error', 'Failed to add tag: ' + error.message);
        }
      }
    });
  
  // Handle the tag dialog cancel button
  document.getElementById('cancel-tag-button')?.addEventListener('click', () => {
    const tagDialog = document.getElementById('new-tag-dialog');
    tagDialog.close();
  });

  // Add open in browser button event listeners
  document.getElementById('open-source-button')?.addEventListener('click', async () => {
    const sourceInput = document.getElementById('model-source');
    const url = sourceInput.value.trim();
    
    if (!url) {
      await window.electron.showMessage('Error', 'Please enter a source URL');
      return;
    }

    try {
      // Validate URL format
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await window.electron.showMessage('Error', 'Please enter a valid URL starting with http:// or https://');
        return;
      }
      
      await window.electron.openExternal(url);
    } catch (error) {
      console.error('Error opening URL:', error);
      await window.electron.showMessage('Error', 'Failed to open URL: ' + error.message);
    }
  });

  document.getElementById('multi-open-source-button')?.addEventListener('click', async () => {
    const sourceInput = document.getElementById('multi-source');
    const url = sourceInput.value.trim();
    
    if (!url) {
      await window.electron.showMessage('Error', 'Please enter a source URL');
      return;
    }

    try {
      // Validate URL format
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await window.electron.showMessage('Error', 'Please enter a valid URL starting with http:// or https://');
        return;
      }
      
      await window.electron.openExternal(url);
    } catch (error) {
      console.error('Error opening URL:', error);
      await window.electron.showMessage('Error', 'Failed to open URL: ' + error.message);
    }
  });


  // Add scan directory button event listener
  document.getElementById('scan-directory-button')?.addEventListener('click', async () => {
    if (isScanning) return; // Prevent multiple scans
    
    // First, check if there are any active filters and clear them
    const clearFilterButton = document.querySelector('.clear-filter-button');
    if (clearFilterButton) {
      console.log('Clearing filters before directory scan');
      clearFilterButton.click(); // Programmatically trigger the clear filters action
      // Wait a moment for the filter clearing to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Check if we're in server mode
    const serverMode = await window.electron.isServerMode();
    let directoryPath;
    
    if (serverMode) {
      // In server mode, prompt for UNC path via text input
      // Pre-fill with STL Home if it's set
      const stlHome = await window.electron.getSetting('stlHome');
      const defaultPath = stlHome && stlHome.trim() !== '' ? stlHome.trim() : '';
      const promptMessage = defaultPath 
        ? `Enter UNC path to scan (e.g., \\\\server\\share\\path):\n\nCurrent STL Home: ${defaultPath}`
        : 'Enter UNC path to scan (e.g., \\\\server\\share\\path):';
      const uncPath = prompt(promptMessage, defaultPath);
      if (!uncPath || uncPath.trim() === '') return;
      directoryPath = [uncPath.trim()];
    } else {
      // Normal mode: use file dialog
      directoryPath = await window.electron.openFileDialog();
      if (!directoryPath || directoryPath.length === 0) return;
    }

    await window.electron.saveDirectory(directoryPath[0]);
    console.log('Scanning directory:', directoryPath[0]);
    
    // Disable the button and update its appearance
    const scanButton = document.getElementById('scan-directory-button');
    scanButton.disabled = true;
    scanButton.style.opacity = '0.5';
    scanButton.style.cursor = 'not-allowed';
    isScanning = true;
    
    // Show progress section
    showProgressBars();
    
    try {
      // Update progress bars
      const progressSection = document.getElementById('progress-section');
      const progressContainer = document.getElementById('progress-container');
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      const renderProgressContainer = document.getElementById('render-progress-container');
      const renderProgressBar = document.getElementById('render-progress-bar');
      const renderProgressText = document.getElementById('render-progress-text');
      
      progressSection.classList.remove('hidden');
      progressContainer.classList.remove('hidden');
      renderProgressContainer.classList.remove('hidden');

      // Listen for progress updates
      // Note: scan progress events can arrive out-of-order because the scan worker
      // processes many operations concurrently. Keep the displayed count monotonic.
      let lastScanProcessed = 0;
      window.electron.onScanProgress((progress) => {
        const processedRaw = typeof progress?.processed === 'number' ? progress.processed : 0;
        lastScanProcessed = Math.max(lastScanProcessed, processedRaw);
        const percent = progress.total ? (lastScanProcessed / progress.total) * 100 : 0;
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `Checking files: ${lastScanProcessed}`;
      });

      window.electron.onDbProgress((progress) => {
        if (window._scanThumbnailProgress) return;
        const percent = progress.total ? (progress.processed / progress.total) * 100 : 0;
        renderProgressBar.style.width = `${percent}%`;
        renderProgressText.textContent = `Processing models: ${progress.processed} / ${progress.total}`;
      });

      // This function now handles both scanning and thumbnail generation
      await scanAndRenderDirectory(directoryPath[0]);

      // Update UI after scan completes
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();
      
      // Reset filters
      document.getElementById('designer-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      const newSelScan = document.getElementById('new-select');
      if (newSelScan) newSelScan.value = 'all';
      document.getElementById('tag-filter').value = '';

      // Force grid to refetch and re-render so models show without reload (Docker/server - same as Scan STL Home / View Entire Library)
      window.disableGridRefresh = false;
      const gridEl = document.querySelector('.file-grid');
      if (gridEl) gridEl.currentModels = null;
      if (typeof window.forceGridRefresh === 'function') {
        await window.forceGridRefresh();
      } else {
        const allModels = await window.electron.getAllModels();
        await renderFiles(allModels);
        await updateModelCounts(allModels.length);
      }

    } catch (error) {
      console.error('Error scanning directory:', error);
      await window.electron.showMessage('Error', 'Failed to scan directory');
    } finally {
      hideProgressBars();
      // Re-enable the button
      scanButton.disabled = false;
      scanButton.style.opacity = '1';
      scanButton.style.cursor = 'pointer';
      isScanning = false;
    }
  });
 

  // About dialog handler
  window._electronRealEventHandlers['open-keyboard-shortcuts'] = function() {
    const dialog = document.getElementById('keyboard-shortcuts-dialog');
    if (dialog) dialog.showModal();
  };
  if (window._electronPendingEvents['open-keyboard-shortcuts']) {
    window._electronPendingEvents['open-keyboard-shortcuts'].forEach((args) => {
      window._electronRealEventHandlers['open-keyboard-shortcuts'].apply(null, args);
    });
    delete window._electronPendingEvents['open-keyboard-shortcuts'];
  }

  window._electronRealEventHandlers['open-about'] = async function() {
    const dialog = document.getElementById('about-dialog');
    if (!dialog) {
      console.error('About dialog element not found');
      return;
    }
    dialog.showModal();
    bindAboutCloseButton();
    try {
      await initializeAboutDialog();
    } catch (error) {
      console.error('Error initializing about dialog:', error);
      const versionEl = document.getElementById('about-version');
      if (versionEl) versionEl.textContent = 'Version: Unknown';
    }
  };
  if (window._electronPendingEvents['open-about']) {
    window._electronPendingEvents['open-about'].forEach((args) => {
      window._electronRealEventHandlers['open-about'].apply(null, args);
    });
    delete window._electronPendingEvents['open-about'];
  }

  window._electronRealEventHandlers['open-server-mode-info'] = function() {
    const dialog = document.getElementById('server-mode-info-dialog');
    if (dialog) dialog.showModal();
  };
  if (window._electronPendingEvents['open-server-mode-info']) {
    window._electronPendingEvents['open-server-mode-info'].forEach((args) => {
      window._electronRealEventHandlers['open-server-mode-info'].apply(null, args);
    });
    delete window._electronPendingEvents['open-server-mode-info'];
  }

  // Stats dialog handler
  const statsDialog = document.getElementById('stats-dialog');
  if (statsDialog) {
    // Clean up charts when dialog closes (set up once, not per-open)
    statsDialog.addEventListener('close', () => {
      if (fileTypeChart) {
        fileTypeChart.destroy();
        fileTypeChart = null;
      }
      if (metadataChart) {
        metadataChart.destroy();
        metadataChart = null;
      }
    });
  }
  
  window._electronRealEventHandlers['open-stats'] = async function() {
    const dialog = document.getElementById('stats-dialog');
    if (dialog) {
      try {
        await initializeStatsDialog();
        dialog.showModal();
      } catch (error) {
        console.error('Error showing stats dialog:', error);
      }
    }
  };
  if (window._electronPendingEvents['open-stats']) {
    window._electronPendingEvents['open-stats'].forEach((args) => {
      window._electronRealEventHandlers['open-stats'].apply(null, args);
    });
    delete window._electronPendingEvents['open-stats'];
  }

  window._electronRealEventHandlers['open-system-report'] = async function() {
    const dialog = document.getElementById('system-report-dialog');
    if (dialog) {
      try {
        dialog.showModal();
        await initializeSystemReport();
      } catch (error) {
        console.error('Error showing system report dialog:', error);
      }
    }
  };
  if (window._electronPendingEvents['open-system-report']) {
    window._electronPendingEvents['open-system-report'].forEach((args) => {
      window._electronRealEventHandlers['open-system-report'].apply(null, args);
    });
    delete window._electronPendingEvents['open-system-report'];
  }

  // Chart instances storage
  let fileTypeChart = null;
  let metadataChart = null;

  // Initialize stats dialog with data
  async function initializeStatsDialog() {
    try {
      const stats = await window.electron.getStats();
      
      // Update total models
      document.getElementById('stats-total-models').textContent = stats.totalModels.toLocaleString();
      
      // Update file types (count + disk usage)
      document.getElementById('stats-type-3mf').textContent = stats.fileTypes.threeMf.toLocaleString();
      document.getElementById('stats-type-stl').textContent = stats.fileTypes.stl.toLocaleString();
      const otherEl = document.getElementById('stats-type-other');
      if (otherEl) otherEl.textContent = (stats.fileTypes.other != null ? stats.fileTypes.other : 0).toLocaleString();

      const threeMfBytesEl = document.getElementById('stats-type-3mf-bytes');
      const stlBytesEl = document.getElementById('stats-type-stl-bytes');
      const otherBytesEl = document.getElementById('stats-type-other-bytes');
      const totalBytesEl = document.getElementById('stats-total-bytes');
      if (threeMfBytesEl) threeMfBytesEl.textContent = `(${formatFileSize(stats.fileTypes.threeMfBytes || 0)})`;
      if (stlBytesEl) stlBytesEl.textContent = `(${formatFileSize(stats.fileTypes.stlBytes || 0)})`;
      if (otherBytesEl) otherBytesEl.textContent = `(${formatFileSize(stats.fileTypes.otherBytes || 0)})`;
      if (totalBytesEl) totalBytesEl.textContent = formatFileSize(stats.totalBytes || 0);
      
      // Update archived models
      document.getElementById('stats-archived').textContent = stats.archivedModels.toLocaleString();
      
      // Update percentages
      document.getElementById('stats-percent-designer').textContent = stats.percentages.withDesigner + '%';
      document.getElementById('stats-percent-parent').textContent = stats.percentages.withParentModel + '%';
      document.getElementById('stats-percent-license').textContent = stats.percentages.withLicense + '%';
      document.getElementById('stats-percent-tags').textContent = stats.percentages.withTags + '%';
      
      // Update tags
      document.getElementById('stats-total-tags').textContent = stats.tags.total.toLocaleString();
      const mostUsedTagElement = document.getElementById('stats-most-used-tag');
      if (stats.tags.mostUsed) {
        mostUsedTagElement.textContent = `${stats.tags.mostUsed.name} (${stats.tags.mostUsed.count})`;
      } else {
        mostUsedTagElement.textContent = 'None';
      }
      
      // Destroy existing charts if they exist
      if (fileTypeChart) {
        fileTypeChart.destroy();
        fileTypeChart = null;
      }
      if (metadataChart) {
        metadataChart.destroy();
        metadataChart = null;
      }
      
      // Create pie chart for file types
      const fileTypeCanvas = document.getElementById('file-type-chart');
      if (fileTypeCanvas && typeof Chart !== 'undefined') {
        const ctx = fileTypeCanvas.getContext('2d');
        const otherCount = stats.fileTypes.other != null ? stats.fileTypes.other : 0;
        fileTypeChart = new Chart(ctx, {
          type: 'pie',
          data: {
            labels: otherCount > 0 ? ['3MF', 'STL', 'Other'] : ['3MF', 'STL'],
            datasets: [{
              data: otherCount > 0 ? [stats.fileTypes.threeMf, stats.fileTypes.stl, otherCount] : [stats.fileTypes.threeMf, stats.fileTypes.stl],
              backgroundColor: otherCount > 0 ? ['rgba(74, 158, 255, 0.8)', 'rgba(0, 212, 255, 0.8)', 'rgba(128, 128, 128, 0.8)'] : ['rgba(74, 158, 255, 0.8)', 'rgba(0, 212, 255, 0.8)'],
              borderColor: otherCount > 0 ? ['rgba(74, 158, 255, 1)', 'rgba(0, 212, 255, 1)', 'rgba(128, 128, 128, 1)'] : ['rgba(74, 158, 255, 1)', 'rgba(0, 212, 255, 1)'],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#e0e0e0',
                  font: {
                    size: 10
                  },
                  padding: 8,
                  boxWidth: 12
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const label = context.label || '';
                    const value = context.parsed || 0;
                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                    const bytesByLabel = {
                      '3MF': stats.fileTypes.threeMfBytes || 0,
                      'STL': stats.fileTypes.stlBytes || 0,
                      'Other': stats.fileTypes.otherBytes || 0
                    };
                    const bytes = bytesByLabel[label] || 0;
                    return `${label}: ${value.toLocaleString()} (${percentage}%) · ${formatFileSize(bytes)}`;
                  }
                }
              }
            }
          }
        });
      }
      
      // Create bar chart for metadata completion
      const metadataCanvas = document.getElementById('metadata-chart');
      if (metadataCanvas && typeof Chart !== 'undefined') {
        const ctx = metadataCanvas.getContext('2d');
        metadataChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ['Designer', 'Parent', 'License', 'Tags'],
            datasets: [{
              label: 'Completion %',
              data: [
                parseFloat(stats.percentages.withDesigner),
                parseFloat(stats.percentages.withParentModel),
                parseFloat(stats.percentages.withLicense),
                parseFloat(stats.percentages.withTags)
              ],
              backgroundColor: [
                'rgba(74, 158, 255, 0.8)',
                'rgba(0, 212, 255, 0.8)',
                'rgba(91, 159, 255, 0.8)',
                'rgba(107, 170, 255, 0.8)'
              ],
              borderColor: [
                'rgba(74, 158, 255, 1)',
                'rgba(0, 212, 255, 1)',
                'rgba(91, 159, 255, 1)',
                'rgba(107, 170, 255, 1)'
              ],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
              x: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  color: '#e0e0e0',
                  font: {
                    size: 9
                  },
                  callback: function(value) {
                    return value + '%';
                  }
                },
                grid: {
                  color: 'rgba(255, 255, 255, 0.1)'
                }
              },
              y: {
                ticks: {
                  color: '#e0e0e0',
                  font: {
                    size: 9
                  }
                },
                grid: {
                  color: 'rgba(255, 255, 255, 0.1)'
                }
              }
            },
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return context.parsed.x.toFixed(1) + '%';
                  }
                }
              }
            }
          }
        });
      }
    } catch (error) {
      console.error('Error initializing stats dialog:', error);
      throw error;
    }
  }

  // Website link handler
  document.getElementById('website-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    await window.electron.openExternal('https://printventory.com');
  });

  // Initialize new designer dialog handlers
  if (newDesignerDialog) {
    newDesignerDialog.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newDesignerName = document.getElementById('new-designer-name').value.trim();
      const sourceDropdownId = newDesignerDialog.dataset.sourceDropdown || 'model-designer';
      
      if (newDesignerName) {
        const designerSelect = document.getElementById(sourceDropdownId);
        if (designerSelect) {
          const option = document.createElement('option');
          option.value = newDesignerName;
          option.textContent = newDesignerName;
          designerSelect.appendChild(option);
          designerSelect.value = newDesignerName;
          
          // Trigger auto-save
          if (sourceDropdownId === 'multi-designer') {
            await autoSaveMultipleModels('designer', newDesignerName);
          } else {
            const filePath = getCurrentModelFilePath();
            await autoSaveModel('designer', newDesignerName, filePath);
          }
        }
        
        // Clear the input and close the dialog immediately
        document.getElementById('new-designer-name').value = '';
        document.getElementById('new-designer-dialog').close();
      }
    });

    document.getElementById('cancel-designer-button')?.addEventListener('click', () => {
      document.getElementById('new-designer-name').value = '';
      newDesignerDialog.close();
    });
  }

  // Add new designer button handlers
  document.querySelectorAll('.add-designer-button, #add-new-designer-button').forEach(button => {
    button?.addEventListener('click', () => {
      if (newDesignerDialog) {
        const sourceDropdownId = button.closest('.designer-input-container')?.querySelector('select')?.id;
        newDesignerDialog.dataset.sourceDropdown = sourceDropdownId;
        newDesignerDialog.showModal();
      }
    });
  });

  // Add license dialog event listeners
  const newLicenseDialog = document.getElementById('new-license-dialog');
  const cancelLicenseButton = document.getElementById('cancel-license-button');
  const newLicenseForm = newLicenseDialog.querySelector('form');

  // Add click handlers for the add license buttons
  document.querySelectorAll('.add-license-button, #add-new-license-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-license-dialog');
      const input = document.getElementById('new-license-name');
      
      // Reset form and input state
      dialog.querySelector('form').reset();
      input.value = '';
      
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-license';
      
      // Show dialog and focus input
      dialog.showModal();
      
      // Force proper input state
      requestAnimationFrame(() => {
          input.disabled = false;
          input.readOnly = false;
          input.blur();
          input.focus();
      });
    });
  });

  // Add cancel button handler
  if (cancelLicenseButton) {
    cancelLicenseButton.addEventListener('click', () => {
      document.getElementById('new-license-name').value = '';
      newLicenseDialog.close();
    });
  }

  // Add form submit handler
  if (newLicenseForm) {
    newLicenseForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newLicenseName = document.getElementById('new-license-name').value.trim();
      const sourceDropdownId = newLicenseDialog.dataset.sourceDropdown || 'model-license';
      
      if (newLicenseName) {
        // Trigger auto-save first
        if (sourceDropdownId === 'multi-license') {
          await autoSaveMultipleModels('license', newLicenseName);
        } else if (sourceDropdownId === 'license-select') {
          // For filter dropdown, we need to save to a model first
          const filePath = getCurrentModelFilePath();
          if (filePath) {
            await autoSaveModel('license', newLicenseName, filePath);
          }
        } else {
          const filePath = getCurrentModelFilePath();
          await autoSaveModel('license', newLicenseName, filePath);
        }
        
        // Clear the input and close the dialog immediately
        document.getElementById('new-license-name').value = '';
        document.getElementById('new-license-dialog').close();
        
        // Update all license dropdowns - repopulate from database to avoid duplicates
        await populateLicenseFilter(); // Filter dropdown
        if (sourceDropdownId === 'model-license') {
          await populateModelLicenseDropdown(newLicenseName, 'model-license');
        } else if (sourceDropdownId === 'multi-license') {
          await populateModelLicenseDropdown(newLicenseName, 'multi-license');
        } else if (sourceDropdownId === 'license-select') {
          // Filter dropdown - already repopulated by populateLicenseFilter
          const licenseSelect = document.getElementById('license-select');
          if (licenseSelect) {
            licenseSelect.value = newLicenseName;
          }
        }
        
        // Refresh metadata editor list if dialog is open
        const metadataDialog = document.getElementById('metadata-editor-dialog');
        if (metadataDialog && metadataDialog.open && currentMetadataType === 'license') {
          allMetadata = []; // Clear cache to force refresh
          await refreshMetadataList('license');
        }
      }
    });
  }

  // Initialize dialog handlers
  initializeDialogHandlers();

  window._electronRealEventHandlers['open-backup-restore'] = function() {
    const dialog = document.getElementById('backup-restore-dialog');
    if (dialog) dialog.showModal();
  };
  if (window._electronPendingEvents['open-backup-restore']) {
    window._electronPendingEvents['open-backup-restore'].forEach((args) => {
      window._electronRealEventHandlers['open-backup-restore'].apply(null, args);
    });
    delete window._electronPendingEvents['open-backup-restore'];
  }

  async function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const buffer = reader.result;
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;
        for (let i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
        }
        resolve(btoa(binary));
      };
      reader.readAsArrayBuffer(file);
    });
  }

  async function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => resolve(reader.result || '');
      reader.readAsText(file);
    });
  }

  function promptForBackupFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.db';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        input.remove();
        resolve(file);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function promptForLibraryImportFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files && input.files[0] ? input.files[0] : null;
        input.remove();
        resolve(file);
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  window._restoreBackupFromDialogImpl = async function() {
    try {
      const confirmResult = await window.electron.showMessage(
        'Confirm Restore',
        'Warning: Restoring from backup will replace all current data. This cannot be undone. Continue?',
        ['Yes', 'No']
      );
      if (confirmResult !== 'Yes') return;
      const serverMode = await window.electron.isServerMode().catch(() => false);
      if (serverMode) {
        const file = await promptForBackupFile();
        if (!file) return;
        const base64 = await readFileAsBase64(file);
        const result = await window.electron.restoreDatabase({ base64 });
        if (result && result.success) {
          await window.electron.showMessage('Success', 'Database restored successfully. The application will now reload.');
          window.location.reload();
        } else {
          await window.electron.showMessage('Error', result?.message || 'Failed to restore database');
        }
        return;
      }
      const success = await window.electron.restoreDatabase();
      if (success) {
        await window.electron.showMessage('Success', 'Database restored successfully. The application will now reload.');
        window.location.reload();
      }
    } catch (error) {
      console.error('Restore error:', error);
      await window.electron.showMessage('Error', 'Failed to restore database');
    }
  };

  window._importLibraryFromDialogImpl = async function() {
    try {
      const result = await window.electron.showMessage(
        'Confirm Import',
        'This will merge the imported library with your current library. Existing models will be updated. Continue?',
        ['Yes', 'No']
      );
      if (result !== 'Yes') return;
      const serverMode = await window.electron.isServerMode().catch(() => false);
      if (serverMode) {
        const file = await promptForLibraryImportFile();
        if (!file) return;
        const json = await readFileAsText(file);
        const importResult = await window.electron.importLibrary({ json });
        if (importResult && importResult.success) {
          const message = `Library imported successfully. ${importResult.imported} new models added, ${importResult.updated} models updated.`;
          await window.electron.showMessage('Success', message);
          if (typeof refreshModelDisplay === 'function') await refreshModelDisplay();
        } else {
          await window.electron.showMessage('Error', importResult?.message || 'Failed to import library');
        }
        return;
      }
      const importResult = await window.electron.importLibrary();
      if (importResult && importResult.success) {
        const message = `Library imported successfully. ${importResult.imported} new models added, ${importResult.updated} models updated.`;
        await window.electron.showMessage('Success', message);
        if (typeof refreshModelDisplay === 'function') await refreshModelDisplay();
      }
    } catch (error) {
      console.error('Import library error:', error);
      await window.electron.showMessage('Error', 'Failed to import library: ' + (error.message || 'Unknown error'));
    }
  };

  document.getElementById('backup-button')?.addEventListener('click', () => window.createBackupFromDialog());
  document.getElementById('restore-button')?.addEventListener('click', () => window.restoreBackupFromDialog());
  document.getElementById('export-library-button')?.addEventListener('click', () => window.exportLibraryFromDialog());
  document.getElementById('import-library-button')?.addEventListener('click', () => window.importLibraryFromDialog());

  document.getElementById('save-backup-restore')?.addEventListener('click', () => {
    document.getElementById('backup-restore-dialog').close();
  });

  // Assign real handler for open-dedup (early listener already registered; avoids "No listeners" in Docker/server)
  window._electronRealEventHandlers['open-dedup'] = function() {
    const dialog = document.getElementById('dedup-dialog');
    if (!dialog) return;
    dialog.classList.remove('modal-fullscreen');
    const fullscreenBtn = document.getElementById('dedup-fullscreen-toggle');
    if (fullscreenBtn) fullscreenBtn.textContent = 'Full Screen';
    const includeZipCheckbox = dialog.querySelector('#include-zipped-models');
    if (includeZipCheckbox) includeZipCheckbox.checked = false;
    loadDuplicateFiles();
  };
  if (window._electronPendingEvents['open-dedup']) {
    window._electronPendingEvents['open-dedup'].forEach((args) => {
      window._electronRealEventHandlers['open-dedup'].apply(null, args);
    });
    delete window._electronPendingEvents['open-dedup'];
  }

  // Add this with other event listeners in the DOMContentLoaded section
  document.getElementById('view-library-button')?.addEventListener('click', async () => {
    try {
      window.disableGridRefresh = false; // Ensure user-initiated view always shows models (e.g. after scan in docker mode)
      // Reset all filter dropdowns
      document.getElementById('designer-select').value = '';
      document.getElementById('license-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      const newSelView = document.getElementById('new-select');
      if (newSelView) newSelView.value = 'all';
      document.getElementById('tag-filter').value = '';
      document.getElementById('filetype-select').value = '';
      document.getElementById('search-filter-input').value = '';
      
      // Explicitly clear the directory filter
      window.currentDirectoryFilter = "";
      
      // Hide the "Showing 100 Newest Models" message
      const viewLibMsg = document.getElementById("view-library-message");
      if (viewLibMsg) {
        viewLibMsg.style.display = "none";
      }
      
      // Flag that we're viewing the entire library
      window.viewingEntireLibrary = true;
      
      if (typeof window.resetCurrentFilterPanelShell === "function") {
        window.resetCurrentFilterPanelShell();
      } else {
        const filterIndicator = document.getElementById("current-filter");
        if (filterIndicator) {
          filterIndicator.innerHTML = "";
          filterIndicator.classList.remove("visible");
        }
      }
      
      // Use the combined search function to retrieve and display models with all filters applied correctly
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      }
      
      console.log("Viewing entire library");
    } catch (error) {
      console.error('Error loading library:', error);
      await window.electron.showMessage('Error', 'Failed to load library.');
    }
  });

  // Add Tag Manager functionality
  window._electronRealEventHandlers['open-tag-manager'] = function() {
    const tagManagerDialog = document.getElementById('tag-manager-dialog');
    if (!tagManagerDialog) return;
    tagManagerDialog.classList.remove('modal-fullscreen');
    const fullscreenBtn = document.getElementById('tag-manager-fullscreen-toggle');
    if (fullscreenBtn) fullscreenBtn.textContent = 'Full Screen';
    refreshTagManagerList();
    tagManagerDialog.showModal();
    const searchEl = document.getElementById('tag-manager-search');
    if (searchEl) searchEl.value = '';
  };
  if (window._electronPendingEvents['open-tag-manager']) {
    window._electronPendingEvents['open-tag-manager'].forEach((args) => {
      window._electronRealEventHandlers['open-tag-manager'].apply(null, args);
    });
    delete window._electronPendingEvents['open-tag-manager'];
  }

  // Fullscreen toggle for DeDup and Tag Manager modals
  document.getElementById('dedup-fullscreen-toggle')?.addEventListener('click', () => {
    const dialog = document.getElementById('dedup-dialog');
    const btn = document.getElementById('dedup-fullscreen-toggle');
    if (!dialog || !btn) return;
    dialog.classList.toggle('modal-fullscreen');
    btn.textContent = dialog.classList.contains('modal-fullscreen') ? 'Exit Full Screen' : 'Full Screen';
  });

  document.getElementById('dedup-easy-button')?.addEventListener('click', () => window.dedupEasyFromDialog());
  document.getElementById('dedup-clear-button')?.addEventListener('click', () => window.dedupClearFromDialog());

  // Free large dedup payloads when the dialog closes
  document.getElementById('dedup-dialog')?.addEventListener('close', () => {
    teardownDedupVirtualList();
    const groupsEl = document.querySelector('#dedup-dialog .duplicate-groups');
    if (groupsEl) groupsEl.innerHTML = '';
  });

  document.getElementById('tag-manager-fullscreen-toggle')?.addEventListener('click', () => {
    const dialog = document.getElementById('tag-manager-dialog');
    const btn = document.getElementById('tag-manager-fullscreen-toggle');
    if (!dialog || !btn) return;
    dialog.classList.toggle('modal-fullscreen');
    btn.textContent = dialog.classList.contains('modal-fullscreen') ? 'Exit Full Screen' : 'Full Screen';
  });

  // Add close event handler to refresh UI when tag manager closes
  const tagManagerDialog = document.getElementById('tag-manager-dialog');
  if (tagManagerDialog) {
    tagManagerDialog.addEventListener('close', async () => {
      try {
        // Small delay to ensure database writes are flushed
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Clear the model cache to force fresh data
        const container = document.querySelector('.file-grid');
        if (container) {
          container.currentModels = null; // Clear cache to force re-render
        }
        
        // Refresh tag dropdowns in edit view
        await populateTagSelect('tag-select', 'model-tags');
        await populateTagSelect('multi-tag-select', 'multi-tags');
        
        // Refresh tag filter dropdown
        await populateTagFilter();
        
        // Refresh tag list in edit view if a model is currently being edited
        const currentModelPath = getCurrentModelFilePath() || currentModelDetailsPath;
        if (currentModelPath) {
          await loadModelTags(currentModelPath);
        }
        
        // Force a full grid refresh to show updated tags on all model cards
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          // Fallback: Get current sort option and refresh the grid
          const sortSelect = document.getElementById('sort-select');
          const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
          await renderFiles(models);
        }
        
        // Update all visible model elements to refresh their tags
        // This ensures tags are updated even if the grid doesn't fully re-render
        const allFileItems = document.querySelectorAll('.file-item');
        for (const item of allFileItems) {
          const filePath = item.getAttribute('data-filepath') || item.dataset.filepath;
          if (filePath) {
            await updateModelElement(filePath);
          }
        }
      } catch (error) {
        console.error('Error refreshing UI after tag manager close:', error);
      }
    });
  }

  let allTags = []; // Store all tags for filtering

  async function refreshTagManagerList(searchTerm = '') {
    const tagList = document.getElementById('tag-manager-list');
    tagList.innerHTML = '';
    
    try {
      // Get all tags if we don't have them yet or if no search term
      if (allTags.length === 0 || !searchTerm) {
        allTags = await window.electron.getAllTags();
      }
      
      // Filter tags based on search term
      const filteredTags = searchTerm 
        ? allTags.filter(tag => tag.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : allTags;
      
      // Sort tags alphabetically by name
      filteredTags.sort((a, b) => a.name.localeCompare(b.name));
      
      filteredTags.forEach(tag => {
        const tagElement = document.createElement('div');
        tagElement.className = 'tag';
        tagElement.setAttribute('title', tag.name); // Show full tag name on hover
        tagElement.innerHTML = `
          <span class="tag-text">${tag.name}</span>
          <span class="tag-count">${tag.model_count}</span>
          <span class="tag-remove">×</span>
        `;
        
        tagElement.querySelector('.tag-remove')?.addEventListener('click', async () => {
          if (tag.model_count > 0) {
            const response = await window.electron.showMessage(
              'Delete Tag',
              `This tag is used by ${tag.model_count} model(s). Are you sure you want to delete it?`,
              ['Yes', 'No']
            );
            if (response !== 'Yes') return;
          }
          
          try {
            await window.electron.deleteTag(tag.id);
            allTags = []; // Reset tags cache to force refresh
            await refreshTagManagerList(searchTerm);
            // Also refresh other tag-related UI elements
            await populateTagSelect('tag-select', 'model-tags');
            await populateTagSelect('multi-tag-select', 'multi-tags');
            await populateTagFilter();
            
            // Refresh tag list in edit view if a model is currently being edited
            const currentModelPath = getCurrentModelFilePath() || currentModelDetailsPath;
            if (currentModelPath) {
              await loadModelTags(currentModelPath);
            }
            
            // Refresh the grid to show updated tags on model cards
            if (typeof window.performCombinedSearch === 'function') {
              await window.performCombinedSearch();
            } else {
              // Fallback: Get current sort option and refresh the grid
              const sortSelect = document.getElementById('sort-select');
              const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
              await renderFiles(models);
            }
          } catch (error) {
            console.error('Error deleting tag:', error);
            await window.electron.showMessage('Error', 'Failed to delete tag');
          }
        });
        
        tagList.appendChild(tagElement);
      });
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  }

  // Add search functionality
  document.getElementById('tag-manager-search').addEventListener('input', debounce(async (e) => {
    await refreshTagManagerList(e.target.value.trim());
  }, 300));

  // Add clear search functionality
  document.getElementById('clear-tag-search')?.addEventListener('click', async () => {
    const searchInput = document.getElementById('tag-manager-search');
    searchInput.value = '';
    await refreshTagManagerList();
  });

  document.getElementById('add-tag-manager-button')?.addEventListener('click', async () => {
    const input = document.getElementById('new-tag-manager-name');
    const tagName = input.value.trim();
    
    if (tagName) {
      try {
        await window.electron.saveTag(tagName);
        input.value = '';
        allTags = []; // Reset tags cache to force refresh
        const searchTerm = document.getElementById('tag-manager-search').value.trim();
        await refreshTagManagerList(searchTerm);
        // Also refresh other tag-related UI elements
        await populateTagSelect();
        await populateTagFilter();
      } catch (error) {
        console.error('Error saving tag:', error);
        await window.electron.showMessage('Error', 'Failed to create tag');
      }
    }
  });

  window._electronRealEventHandlers['open-purge-models'] = function() {
    const dialog = document.getElementById('purge-models-dialog');
    if (dialog) dialog.showModal();
  };
  if (window._electronPendingEvents['open-purge-models']) {
    window._electronPendingEvents['open-purge-models'].forEach((args) => {
      window._electronRealEventHandlers['open-purge-models'].apply(null, args);
    });
    delete window._electronPendingEvents['open-purge-models'];
  }

  // Metadata Editor functionality
  let allMetadata = []; // Store all metadata for filtering
  let currentMetadataType = 'designer'; // Track current active tab
  let metadataEditorChanged = false; // Track if any changes were made

  window._electronRealEventHandlers['open-metadata-editor'] = function() {
    const metadataDialog = document.getElementById('metadata-editor-dialog');
    if (!metadataDialog) return;
    currentMetadataType = 'designer';
    metadataEditorChanged = false;
    updateMetadataTabs();
    refreshMetadataList('designer');
    metadataDialog.showModal();
    const searchInput = document.getElementById('metadata-editor-search');
    if (searchInput) searchInput.value = '';
    initializeMetadataTabs();
    initializeMetadataSearch();

    // Refresh grid when dialog closes (only if changes were made)
    const closeHandler = async () => {
      if (metadataEditorChanged) {
        // Force full grid re-render by clearing cache
        const container = document.querySelector('.file-grid');
        if (container) {
          container.currentModels = null; // Clear cache to force re-render
        }
        // Small delay to ensure database writes are flushed
        await new Promise(resolve => setTimeout(resolve, 100));
        // Refresh the grid to show updated metadata values
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          // Fallback: Get current sort option and refresh the grid
          const sortSelect = document.getElementById('sort-select');
          const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
          await renderFiles(models);
        }
        metadataEditorChanged = false; // Reset flag after refresh
      }
    };
    
    metadataDialog.removeEventListener('close', closeHandler);
    metadataDialog.addEventListener('close', closeHandler);
  };
  if (window._electronPendingEvents['open-metadata-editor']) {
    window._electronPendingEvents['open-metadata-editor'].forEach((args) => {
      window._electronRealEventHandlers['open-metadata-editor'].apply(null, args);
    });
    delete window._electronPendingEvents['open-metadata-editor'];
  }

  // Tab switching functionality - initialize when dialog is available
  function initializeMetadataTabs() {
    document.querySelectorAll('.metadata-tab').forEach(tab => {
      // Remove existing listeners to avoid duplicates
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
      
      newTab.addEventListener('click', () => {
        const type = newTab.dataset.type;
        currentMetadataType = type;
        updateMetadataTabs();
        refreshMetadataList(type);
        // Clear search when switching tabs
        const searchInput = document.getElementById('metadata-editor-search');
        if (searchInput) {
          searchInput.value = '';
        }
      });
    });
  }

  // Initialize tabs on DOMContentLoaded as well
  document.addEventListener('DOMContentLoaded', () => {
    initializeMetadataTabs();
  });

  function updateMetadataTabs() {
    document.querySelectorAll('.metadata-tab').forEach(tab => {
      if (tab.dataset.type === currentMetadataType) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Update label
    const label = document.getElementById('metadata-type-label');
    const labels = {
      'designer': 'Designers',
      'parentModel': 'Parent Models',
      'license': 'Licenses'
    };
    if (label) {
      label.textContent = labels[currentMetadataType] || 'Metadata';
    }
  }

  async function refreshMetadataList(type, searchTerm = '') {
    const metadataList = document.getElementById('metadata-editor-list');
    metadataList.innerHTML = '';
    
    try {
      // Always refresh metadata to ensure we have the latest data
      allMetadata = await window.electron.getAllMetadata();
      
      // Filter metadata by type and search term
      let filteredMetadata = allMetadata.filter(item => item.type === type);
      
      // Deduplicate by name (case-insensitive) - keep the one with the highest model_count
      const metadataMap = new Map();
      filteredMetadata.forEach(item => {
        const key = item.name.toLowerCase();
        const existing = metadataMap.get(key);
        if (!existing || (item.model_count || 0) > (existing.model_count || 0)) {
          metadataMap.set(key, item);
        }
      });
      filteredMetadata = Array.from(metadataMap.values());
      
      // Further filter by search term if provided
      if (searchTerm) {
        filteredMetadata = filteredMetadata.filter(item => 
          item.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
      
      // Sort alphabetically by name
      filteredMetadata.sort((a, b) => a.name.localeCompare(b.name));
      
      if (filteredMetadata.length === 0) {
        metadataList.innerHTML = '<div class="no-metadata">No items found</div>';
        return;
      }
      
      filteredMetadata.forEach(item => {
        const itemElement = document.createElement('div');
        itemElement.className = 'metadata-item';
        itemElement.innerHTML = `
          <span class="metadata-name">${escapeHtml(item.name)}</span>
          <span class="metadata-count">${item.model_count}</span>
          <button type="button" class="metadata-rename" title="Rename">✎</button>
          <button type="button" class="metadata-delete" title="Delete">×</button>
        `;
        
        // Rename functionality
        itemElement.querySelector('.metadata-rename')?.addEventListener('click', async () => {
          const newName = await window.electron.showInputDialog({
            title: `Rename ${type === 'designer' ? 'Designer' : type === 'parentModel' ? 'Parent Model' : 'License'}`,
            message: `Enter new name for "${item.name}":`,
            defaultValue: item.name,
            placeholder: 'Enter new name...'
          });
          
          if (newName && newName.trim() !== '' && newName.trim() !== item.name) {
            try {
              // Check if the new name already exists (merge scenario)
              const trimmedNewName = newName.trim();
              const existingItem = allMetadata.find(m => 
                m.type === type && 
                m.name.toLowerCase() === trimmedNewName.toLowerCase() &&
                m.name !== item.name
              );
              
              let shouldProceed = true;
              
              // If merging, show confirmation dialog
              if (existingItem) {
                const confirmResult = await window.electron.showMessageBox({
                  type: 'question',
                  title: 'Merge Metadata',
                  message: `A ${type === 'designer' ? 'designer' : type === 'parentModel' ? 'parent model' : 'license'} with the name "${trimmedNewName}" already exists.`,
                  detail: `This will merge "${item.name}" (${item.model_count} model${item.model_count !== 1 ? 's' : ''}) into "${trimmedNewName}" (${existingItem.model_count} model${existingItem.model_count !== 1 ? 's' : ''}).`,
                  buttons: ['Merge', 'Cancel'],
                  defaultId: 0,
                  cancelId: 1
                });
                
                shouldProceed = confirmResult.response === 0;
              }
              
              if (shouldProceed) {
                const result = await window.electron.renameMetadata(type, item.name, trimmedNewName);
                metadataEditorChanged = true; // Mark that changes were made
                allMetadata = []; // Reset cache to force refresh
                await refreshMetadataList(type, searchTerm);
                // Refresh all relevant dropdowns
                await refreshMetadataDropdowns();
                // Force full grid re-render by clearing cache
                const container = document.querySelector('.file-grid');
                if (container) {
                  container.currentModels = null; // Clear cache to force re-render
                }
                // Refresh the grid immediately to show updated metadata values
                // Small delay to ensure database write is complete
                await new Promise(resolve => setTimeout(resolve, 50));
                if (typeof window.performCombinedSearch === 'function') {
                  await window.performCombinedSearch();
                } else {
                  const sortSelect = document.getElementById('sort-select');
                  const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
                  await renderFiles(models);
                }
                
                // Show success message if merge occurred
                if (result.merged) {
                  await window.electron.showMessage('Success', 
                    `Successfully merged "${item.name}" into "${trimmedNewName}". ${result.updated} model${result.updated !== 1 ? 's' : ''} updated.`);
                }
              }
            } catch (error) {
              console.error('Error renaming metadata:', error);
              await window.electron.showMessage('Error', error.message || 'Failed to rename');
            }
          }
        });
        
        // Delete functionality
        itemElement.querySelector('.metadata-delete')?.addEventListener('click', async () => {
          const typeLabel = type === 'designer' ? 'Designer' : type === 'parentModel' ? 'Parent Model' : 'License';
          const response = await window.electron.showMessage(
            `Delete ${typeLabel}`,
            `Delete for ${item.model_count} model${item.model_count !== 1 ? 's' : ''}?`,
            ['Yes', 'No']
          );
          
          if (response === 'Yes') {
            try {
              await window.electron.deleteMetadata(type, item.name);
              metadataEditorChanged = true; // Mark that changes were made
              allMetadata = []; // Reset cache to force refresh
              await refreshMetadataList(type, searchTerm);
              // Refresh all relevant dropdowns
              await refreshMetadataDropdowns();
              // Force full grid re-render by clearing cache
              const container = document.querySelector('.file-grid');
              if (container) {
                container.currentModels = null; // Clear cache to force re-render
              }
              // Refresh the grid immediately to show updated metadata values
              // Small delay to ensure database write is complete
              await new Promise(resolve => setTimeout(resolve, 50));
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              } else {
                const sortSelect = document.getElementById('sort-select');
                const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
                await renderFiles(models);
              }
            } catch (error) {
              console.error('Error deleting metadata:', error);
              await window.electron.showMessage('Error', 'Failed to delete');
            }
          }
        });
        
        metadataList.appendChild(itemElement);
      });
    } catch (error) {
      console.error('Error loading metadata:', error);
      metadataList.innerHTML = '<div class="error-message">Error loading metadata</div>';
    }
  }

  async function refreshMetadataDropdowns() {
    // Refresh designer dropdowns
    if (typeof populateDesignerDropdown === 'function') {
      await populateDesignerDropdown();
    }
    if (typeof populateModelDesignerDropdown === 'function') {
      await populateModelDesignerDropdown(null, 'model-designer');
      await populateModelDesignerDropdown(null, 'multi-designer');
    }
    
    // Refresh parent model dropdowns
    if (typeof populateParentModelFilter === 'function') {
      await populateParentModelFilter();
    }
    if (typeof populateParentModelDropdown === 'function') {
      await populateParentModelDropdown(null, 'model-parent');
      await populateParentModelDropdown(null, 'multi-parent');
    }
    
    // Refresh license dropdowns
    if (typeof populateLicenseFilter === 'function') {
      await populateLicenseFilter();
    }
    if (typeof populateModelLicenseDropdown === 'function') {
      await populateModelLicenseDropdown(null, 'model-license');
      await populateModelLicenseDropdown(null, 'multi-license');
    }
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Add search functionality - initialize when available
  function initializeMetadataSearch() {
    const metadataSearchInput = document.getElementById('metadata-editor-search');
    if (metadataSearchInput) {
      // Remove existing listener to avoid duplicates
      const newInput = metadataSearchInput.cloneNode(true);
      metadataSearchInput.parentNode.replaceChild(newInput, metadataSearchInput);
      
      newInput.addEventListener('input', debounce(async (e) => {
        await refreshMetadataList(currentMetadataType, e.target.value.trim());
      }, 300));
    }

    // Add clear search functionality
    const clearButton = document.getElementById('clear-metadata-search');
    if (clearButton) {
      // Remove existing listener to avoid duplicates
      const newButton = clearButton.cloneNode(true);
      clearButton.parentNode.replaceChild(newButton, clearButton);
      
      newButton.addEventListener('click', async () => {
        const searchInput = document.getElementById('metadata-editor-search');
        if (searchInput) {
          searchInput.value = '';
          await refreshMetadataList(currentMetadataType);
        }
      });
    }
  }

  // Initialize search on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    initializeMetadataSearch();
  });

  window._electronRealEventHandlers['regenerate-thumbnails'] = async function() {
    if (isRegeneratingThumbnails) return;
    // Hidden server worker ignores UI events; it only runs run-server-thumbnail-job.
    if (await isServerThumbnailWorkerContext()) return;
    try {
      const sortSelect = document.getElementById('sort-select');
      const allModels = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
      if (allModels.length === 0) {
        await window.electron.showMessage('Information', 'No models found in the database.');
        return;
      }
      isRegeneratingThumbnails = true;
      const userChoice = await window.electron.showMessage(
        'Regenerate Thumbnails',
        `This will regenerate thumbnails for all ${allModels.length} models. This may take a while. Continue?`,
        ['Yes', 'No']
      );
      if (userChoice === 'Yes') {
        const serverJob = await startAndWatchServerThumbnailJob('all', 'Regenerate Thumbnails');
        if (serverJob) {
          isRegeneratingThumbnails = false;
          if (serverJob.backgrounded || serverJob.cancelled) {
            return;
          }
          await window.electron.showMessage('Success', 'Thumbnail regeneration completed successfully.');
          invalidatePrimaryThumbnailCache();
          const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
          await renderFiles(models);
          return;
        }

        window.ThumbnailProgress?.show({
          title: 'Regenerate Thumbnails',
          phase: 'Clearing existing thumbnails...',
          cancellable: false
        });
        await window.electron.purgeThumbnails();
        invalidatePrimaryThumbnailCache();
        await generateThumbnailsForModels(allModels);
        isRegeneratingThumbnails = false;
        await window.electron.showMessage('Success', 'Thumbnail regeneration completed successfully.');
        const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
        await renderFiles(models);
      } else {
        isRegeneratingThumbnails = false;
      }
    } catch (error) {
      console.error('Error regenerating thumbnails:', error);
      isRegeneratingThumbnails = false;
      window.ThumbnailProgress?.hide();
      await window.electron.showMessage('Error', 'Failed to regenerate thumbnails: ' + error.message);
    }
  };
  if (window._electronPendingEvents['regenerate-thumbnails']) {
    window._electronPendingEvents['regenerate-thumbnails'].forEach((args) => {
      window._electronRealEventHandlers['regenerate-thumbnails'].apply(null, args);
    });
    delete window._electronPendingEvents['regenerate-thumbnails'];
  }

  window._electronRealEventHandlers['generate-missing-thumbnails'] = async function() {
    // Check if a thumbnail dialog is already showing
    if (isThumbnailDialogShowing) {
      return; // Exit early if dialog is already showing
    }
    if (await isServerThumbnailWorkerContext()) return;
    
    try {
      // Get models without thumbnails (NULL, empty, or default '3d.png')
      const modelsWithoutThumbs = await window.electron.getModelsWithoutThumbnails();
      
      if (modelsWithoutThumbs.length === 0) {
        await window.electron.showMessage('Information', 'All models already have thumbnails. Nothing to generate.');
        return;
      }
      
      isThumbnailDialogShowing = true; // Set flag before showing dialog
      // Ask for user confirmation
      const userChoice = await window.electron.showMessage(
        'Generate Missing Thumbnails',
        `${modelsWithoutThumbs.length} models are missing thumbnails. Would you like to generate them now?`,
        ['Yes', 'No']
      );
      
      if (userChoice === 'Yes') {
        const serverJob = await startAndWatchServerThumbnailJob('missing', 'Generate Missing Thumbnails');
        if (serverJob) {
          isThumbnailDialogShowing = false;
          if (serverJob.backgrounded || serverJob.cancelled) {
            return;
          }
          await window.electron.showMessage('Success', 'Thumbnail generation completed successfully.');
          invalidatePrimaryThumbnailCache();
          const sortSelect = document.getElementById('sort-select');
          const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
          await renderFiles(models);
          return;
        }

        const progress = window.ThumbnailProgress;
        progress?.show({
          title: 'Generate Missing Thumbnails',
          phase: 'Loading model details...',
          total: modelsWithoutThumbs.length,
          cancellable: false
        });

        // Get full model data for the models without thumbnails
        const fullModels = [];
        let loadedCount = 0;
        for (const model of modelsWithoutThumbs) {
          const fullModel = await window.electron.getModel(model.filePath);
          if (fullModel) {
            fullModels.push(fullModel);
          }
          loadedCount++;
          progress?.update(loadedCount, modelsWithoutThumbs.length);
        }
        
        // Generate thumbnails for models without them
        await generateThumbnailsForModels(fullModels);
        
        isThumbnailDialogShowing = false; // Reset flag after generation completes
        await window.electron.showMessage('Success', 'Thumbnail generation completed successfully.');
        
        // Refresh the grid to show the new thumbnails
        const sortSelect = document.getElementById('sort-select');
        const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
        await renderFiles(models);
      } else {
        isThumbnailDialogShowing = false; // Reset flag if user clicks "No"
      }
    } catch (error) {
      console.error('Error generating missing thumbnails:', error);
      isThumbnailDialogShowing = false;
      window.ThumbnailProgress?.hide();
      await window.electron.showMessage('Error', 'Failed to generate missing thumbnails: ' + error.message);
    }
  };
  if (window._electronPendingEvents['generate-missing-thumbnails']) {
    window._electronPendingEvents['generate-missing-thumbnails'].forEach((args) => {
      window._electronRealEventHandlers['generate-missing-thumbnails'].apply(null, args);
    });
    delete window._electronPendingEvents['generate-missing-thumbnails'];
  }

  // Purge Models: full implementation (overwrites early stub so updateModelCounts is available)
  async function confirmPurgeModelsFromDialog() {
    try {
      const success = await window.electron.purgeModels({ confirmedInDialog: true });
      if (success) {
        const container = document.querySelector('.file-grid');
        if (container) container.innerHTML = '';
        await updateModelCounts(0);
        document.getElementById('purge-models-dialog')?.close();
        await window.electron.showMessage('Success', 'All models have been purged from the database.');
        document.getElementById('designer-select').value = '';
        document.getElementById('parent-select').value = '';
        document.getElementById('printed-select').value = 'all';
        const newSelPurge = document.getElementById('new-select');
        if (newSelPurge) newSelPurge.value = 'all';
        document.getElementById('tag-filter').value = '';
      }
    } catch (error) {
      console.error('Error purging models:', error);
      await window.electron.showMessage('Error', 'Failed to purge models from the database.');
    }
  }
  window.confirmPurgeModelsFromDialog = confirmPurgeModelsFromDialog;

  // Sort-select handler is now managed by search.js via initializeCombinedSearch()
  // which properly calls performCombinedSearch() to re-render with filters preserved

  // Add this near the top of the file with other initialization code
  // Handle thumbnail added event - refresh grid to show updated thumbnail
  window.electron.onThumbnailAdded(async (data) => {
    if (data && data.filePath) {
      // Use a small delay to ensure database write is complete
      setTimeout(async () => {
        try {
          // Preserve dateAddedFilter if it's set (for new models view)
          const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;

          // Always refresh primary-thumb cache so exiting new mode / re-search shows the new default
          const updatedModelEarly = await window.electron.getModel(data.filePath);
          if (updatedModelEarly?.thumbnail) {
            syncPrimaryThumbnailCacheFromThumbnailString(data.filePath, updatedModelEarly.thumbnail);
          } else if (data.filePath) {
            invalidatePrimaryThumbnailCache(data.filePath);
          }
          
          // If dateAddedFilter is active, we should only update the specific item, not refresh the whole grid
          // This prevents clearing the filter when thumbnails are generated
          if (preservedDateAddedFilter) {
            console.log('Thumbnail added while dateAddedFilter is active, updating item only');
            
            // First, verify the model was updated in the database
            const updatedModel = updatedModelEarly;
            if (!updatedModel || !updatedModel.thumbnail) {
              return;
            }
            
            // Check if this model matches the filter
            if (updatedModel.dateAdded) {
              const modelDateAdded = new Date(updatedModel.dateAdded);
              const filterDate = new Date(preservedDateAddedFilter);
              if (modelDateAdded < filterDate) {
                // This model doesn't match the dateAdded filter, don't refresh
                console.log('Thumbnail added for model outside dateAdded filter, skipping');
                return;
              }
            }
            
            // Restore the filter
            window.dateAddedFilter = preservedDateAddedFilter;
            window._lastDateAddedFilter = preservedDateAddedFilter;
            
            // Try to find and update the specific DOM element only
            const allFileItems = document.querySelectorAll('.file-item');
            const normalizedPath = normalizePathForComparison(data.filePath);
            
            for (const fileItem of allFileItems) {
              const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedPath) {
                // Update the model in currentModels array
                const container = document.querySelector('.file-grid');
                if (container && container.currentModels) {
                  const modelIndex = container.currentModels.findIndex(m => 
                    normalizePathForComparison(m.filePath) === normalizedPath
                  );
                  if (modelIndex >= 0) {
                    // Update the model with fresh data from database
                    container.currentModels[modelIndex] = { ...updatedModel };
                  }
                }
                
                // Remove the item so it gets recreated with updated thumbnail
                fileItem.remove();
                
                // Trigger re-render of visible items only (preserves filter)
                if (container && container.renderVisibleItemsFn) {
                  container.renderVisibleItemsFn();
                }
                
                // Don't call performCombinedSearch - just update the single item
                return;
              }
            }
            
            // If item wasn't found in current view, it might be filtered out or not visible
            // Don't refresh the whole grid - just return
            console.log('Thumbnail added for item not in current view, skipping refresh');
            return;
          }
          
          // If dateAddedFilter is NOT active, proceed with normal refresh behavior
          // First, verify the model was updated in the database
          const updatedModel = updatedModelEarly;
          if (!updatedModel || !updatedModel.thumbnail) {
            return;
          }
          
          // Try to find and update the specific DOM element first
          const allFileItems = document.querySelectorAll('.file-item');
          const normalizedPath = normalizePathForComparison(data.filePath);
          let itemFound = false;
          
          for (const fileItem of allFileItems) {
            const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
            const normalizedItemPath = normalizePathForComparison(itemPath);
            if (normalizedItemPath === normalizedPath) {
              itemFound = true;
              
              // Update the model in currentModels array
              const container = document.querySelector('.file-grid');
              if (container && container.currentModels) {
                const modelIndex = container.currentModels.findIndex(m => 
                  normalizePathForComparison(m.filePath) === normalizedPath
                );
                if (modelIndex >= 0) {
                  // Update the model with fresh data from database
                  container.currentModels[modelIndex] = { ...updatedModel };
                }
              }
              
              // Remove the item so it gets recreated with updated thumbnail
              fileItem.remove();
              break;
            }
          }
          
          // Trigger re-render of visible items
          const container = document.querySelector('.file-grid');
          if (container && container.renderVisibleItemsFn) {
            container.renderVisibleItemsFn();
          }
          
          // If item wasn't found or we need a full refresh, do it
          if (!itemFound || !container || !container.renderVisibleItemsFn) {
            // Use performCombinedSearch to reload all models from database with current filters
            if (typeof window.performCombinedSearch === 'function') {
              await window.performCombinedSearch();
            } else {
              // Fallback: use onRefreshGrid handler approach
              const sortSelect = document.getElementById('sort-select');
              const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
              await renderFiles(models);
            }
          }
        } catch (updateError) {
          console.error('Error refreshing grid after adding thumbnail:', updateError);
          // Fallback to full refresh on error, but preserve dateAddedFilter if set
          const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
          if (preservedDateAddedFilter) {
            window.dateAddedFilter = preservedDateAddedFilter;
            window._lastDateAddedFilter = preservedDateAddedFilter;
            const filteredModels = await window.electron.getModelsFiltered({
              dateAdded: preservedDateAddedFilter
            });
            await renderFiles(filteredModels);
          } else if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      }, 300); // Delay to ensure database write completes
    }
  });

  // Keep primary-thumb cache aligned when default is changed (carousel / manage thumbnails)
  window.electron.on('thumbnail-default-changed', async (data) => {
    if (!data?.filePath) return;
    try {
      const updatedModel = await window.electron.getModel(data.filePath);
      if (updatedModel?.thumbnail) {
        syncPrimaryThumbnailCacheFromThumbnailString(data.filePath, updatedModel.thumbnail);
      } else {
        invalidatePrimaryThumbnailCache(data.filePath);
      }
    } catch (_) {
      invalidatePrimaryThumbnailCache(data.filePath);
    }
  });

  // Handle thumbnail deleted event - refresh grid to show updated thumbnail
  window.electron.on('thumbnail-deleted', async (data) => {
    if (data?.filePath) invalidatePrimaryThumbnailCache(data.filePath);
    if (data && data.filePath) {
      // Use a small delay to ensure database write is complete
      setTimeout(async () => {
        try {
          // Preserve dateAddedFilter if it's set (for new models view)
          const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
          
          // If dateAddedFilter is active, we should only update the specific item, not refresh the whole grid
          if (preservedDateAddedFilter) {
            console.log('Thumbnail deleted while dateAddedFilter is active, updating item only');
            
            // First, verify the model was updated in the database
            const updatedModel = await window.electron.getModel(data.filePath);
            if (!updatedModel) {
              return;
            }
            
            // Check if this model matches the filter
            if (updatedModel.dateAdded) {
              const modelDateAdded = new Date(updatedModel.dateAdded);
              const filterDate = new Date(preservedDateAddedFilter);
              if (modelDateAdded < filterDate) {
                // This model doesn't match the dateAdded filter, don't refresh
                console.log('Thumbnail deleted for model outside dateAdded filter, skipping');
                return;
              }
            }
            
            // Restore the filter
            window.dateAddedFilter = preservedDateAddedFilter;
            window._lastDateAddedFilter = preservedDateAddedFilter;
            
            // Try to find and update the specific DOM element only
            const allFileItems = document.querySelectorAll('.file-item');
            const normalizedPath = normalizePathForComparison(data.filePath);
            
            for (const fileItem of allFileItems) {
              const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedPath) {
                // Update the model in currentModels array
                const container = document.querySelector('.file-grid');
                if (container && container.currentModels) {
                  const modelIndex = container.currentModels.findIndex(m => 
                    normalizePathForComparison(m.filePath) === normalizedPath
                  );
                  if (modelIndex >= 0) {
                    // Update the model with fresh data from database
                    container.currentModels[modelIndex] = { ...updatedModel };
                  }
                }
                
                // Remove the item so it gets recreated with updated thumbnail
                fileItem.remove();
                
                // Trigger re-render of visible items only (preserves filter)
                if (container && container.renderVisibleItemsFn) {
                  container.renderVisibleItemsFn();
                }
                
                return;
              }
            }
            
            return;
          }
          
          // If dateAddedFilter is NOT active, proceed with normal refresh behavior
          const updatedModel = await window.electron.getModel(data.filePath);
          if (!updatedModel) {
            return;
          }
          
          // Try to find and update the specific DOM element first
          const allFileItems = document.querySelectorAll('.file-item');
          const normalizedPath = normalizePathForComparison(data.filePath);
          let itemFound = false;
          
          for (const fileItem of allFileItems) {
            const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
            const normalizedItemPath = normalizePathForComparison(itemPath);
            if (normalizedItemPath === normalizedPath) {
              itemFound = true;
              
              // Update the model in currentModels array
              const container = document.querySelector('.file-grid');
              if (container && container.currentModels) {
                const modelIndex = container.currentModels.findIndex(m => 
                  normalizePathForComparison(m.filePath) === normalizedPath
                );
                if (modelIndex >= 0) {
                  container.currentModels[modelIndex] = { ...updatedModel };
                }
              }
              
              // Remove the item so it gets recreated with updated thumbnail
              fileItem.remove();
              
              // Trigger re-render of visible items
              if (container && container.renderVisibleItemsFn) {
                container.renderVisibleItemsFn();
              }
              
              return;
            }
          }
          
          // If item wasn't found, do a full refresh
          if (!itemFound) {
            if (typeof window.performCombinedSearch === 'function') {
              await window.performCombinedSearch();
            } else {
              const sortSelect = document.getElementById('sort-select');
              const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
              await renderFiles(models);
            }
          }
        } catch (updateError) {
          console.error('Error refreshing grid after deleting thumbnail:', updateError);
          // Fallback to full refresh on error
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      }, 300); // Delay to ensure database write completes
    }
  });

  // Force grid to refetch and re-render (Docker/server: performCombinedSearch alone often doesn't update the grid)
  async function forceGridRefresh() {
    window.disableGridRefresh = false;
    const gridEl = document.querySelector('.file-grid');
    if (gridEl) gridEl.currentModels = null; // force renderVirtualGrid to treat as changed and re-render
    if (typeof populateFileTypeFilter === 'function') await populateFileTypeFilter();
    const sortSelect = document.getElementById('sort-select');
    const sortOption = sortSelect ? sortSelect.value : 'date-desc';
    try {
      const models = await window.electron.getAllModels(sortOption, 0);
      if (typeof renderFiles === 'function') await renderFiles(models);
    } catch (err) {
      console.error('[forceGridRefresh]', err);
    }
  }
  window.forceGridRefresh = forceGridRefresh;

  window.electron.onRefreshGrid(async () => {
    // Always allow grid refresh when server/main signals (e.g. after scan in docker/server mode)
    window.disableGridRefresh = false;
    const gridEl = document.querySelector('.file-grid');
    if (gridEl) gridEl.currentModels = null;
    if (typeof populateFileTypeFilter === 'function') await populateFileTypeFilter();
    // Preserve dateAddedFilter if it's set
    const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
    if (preservedDateAddedFilter) {
      console.log('onRefreshGrid called, preserving dateAddedFilter:', preservedDateAddedFilter);
      window.dateAddedFilter = preservedDateAddedFilter;
      window._lastDateAddedFilter = preservedDateAddedFilter;
    }
    selectedModels.clear();
    document.querySelectorAll('.file-item.selected').forEach(item => item.classList.remove('selected'));

    // Match search.js: any active filter must reload via performCombinedSearch — forceGridRefresh uses
    // getAllModels() and would drop search/tag/etc. (e.g. after "Remove from Library" while filtered).
    const designer = document.getElementById('designer-select')?.value || '';
    const license = document.getElementById('license-select')?.value || '';
    const parentModel = document.getElementById('parent-select')?.value || '';
    const printStatus = document.getElementById('printed-select')?.value || 'all';
    const newStatus = document.getElementById('new-select')?.value || 'all';
    const tagFilter = document.getElementById('tag-filter')?.value || '';
    const fileType = document.getElementById('filetype-select')?.value || '';
    const searchTerm = (document.getElementById('search-filter-input')?.value || '').trim();
    const qbClauses =
      typeof window.queryBuilderHasActiveSearchClauses === 'function' &&
      window.queryBuilderHasActiveSearchClauses();
    const qbMulti =
      typeof window.queryBuilderHasActiveMultiFilters === 'function' &&
      window.queryBuilderHasActiveMultiFilters();
    const hasActiveFilters = Boolean(
      designer || license || parentModel || printStatus !== 'all' ||
      newStatus !== 'all' ||
      tagFilter || fileType || searchTerm || qbClauses || qbMulti ||
      window.currentDirectoryFilter || window.dateAddedFilter
    );

    if (typeof window.performCombinedSearch === 'function' && hasActiveFilters) {
      await window.performCombinedSearch();
    } else if (typeof window.forceGridRefresh === 'function') {
      await window.forceGridRefresh();
    } else if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  });

  // Add this near other dialog event listeners
  window._electronRealEventHandlers['open-theme-settings'] = function() {
    const themeDialog = document.getElementById('settings-dialog');
    if (themeDialog) themeDialog.showModal();
  };
  if (window._electronPendingEvents['open-theme-settings']) {
    window._electronPendingEvents['open-theme-settings'].forEach((args) => {
      window._electronRealEventHandlers['open-theme-settings'].apply(null, args);
    });
    delete window._electronPendingEvents['open-theme-settings'];
  }


  // Update the tag deletion handler
  async function deleteSelectedTags() {
    try {
      const selectedTagIds = Array.from(selectedTags);
      for (const tagId of selectedTagIds) {
        await window.electron.deleteTag(tagId);
      }
      
      // Reset the input state after successful deletion
      resetInputState();
      
      // Refresh the tag list
      await loadTags();
      
      // Refresh the model grid to update any models that had these tags
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      } else if (typeof window.forceGridRefresh === 'function') {
        await window.forceGridRefresh();
      }
    } catch (error) {
      console.error('Error deleting tags:', error);
      await window.electron.showMessage('Error', 'Failed to delete tags: ' + error.message);
    }
  }

  // Make sure this event listener exists
  document.getElementById('delete-tag-button')?.addEventListener('click', async () => {
    if (selectedTags.size === 0) {
      await window.electron.showMessage('Error', 'Please select tags to delete');
      return;
    }

    const result = await window.electron.showMessageBox({
      type: 'warning',
      title: 'Delete Tags',
      message: `Are you sure you want to delete ${selectedTags.size} tag(s)?`,
      buttons: ['Yes', 'No'],
      defaultId: 1,
      cancelId: 1
    });

    if (result.response === 0) {
      await deleteSelectedTags();
    }
  });

  // Add this function to update all tag dropdowns
  async function updateAllTagDropdowns() {
    try {
      const tags = await window.electron.getAllTags();
      tags.sort((a, b) => a.name.localeCompare(b.name)); // Sort tags alphabetically
      const tagDropdowns = document.querySelectorAll('.tags-input-container select');
      
      tagDropdowns.forEach(dropdown => {
        // Save current selection
        const currentSelection = Array.from(dropdown.selectedOptions).map(opt => opt.value);
        
        // Clear existing options
        dropdown.innerHTML = '';
        
        // Add placeholder option first
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select a tag...';
        dropdown.appendChild(placeholderOption);
        
        // Add tags
        tags.forEach(tag => {
          const option = document.createElement('option');
          option.value = tag.name;
          option.textContent = tag.name;
          option.selected = currentSelection.includes(tag.name);
          dropdown.appendChild(option);
        });
      });
    } catch (error) {
      console.error('Error updating tag dropdowns:', error);
    }
  }

  // NOTE: addTagToModel is defined at top level (line ~5637) - duplicate removed

  // Make sure the add-tag-button event listener is updated

  // Add this function to handle tag dropdown click
  async function refreshTagDropdown(dropdown) {
    try {
      const tags = await window.electron.getAllTags();
      
      // Save current selection
      const currentSelection = Array.from(dropdown.selectedOptions).map(opt => opt.value);
      
      // Clear existing options
      dropdown.innerHTML = '';
      
      // Add placeholder option first
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Select a tag...';
      dropdown.appendChild(placeholderOption);
      
      // Add tags
      tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = tag.name;
        option.selected = currentSelection.includes(tag.name);
        dropdown.appendChild(option);
      });
    } catch (error) {
      console.error('Error refreshing tag dropdown:', error);
    }
  }

  // Add this in your DOMContentLoaded event listener
  document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Add click handlers to all tag dropdowns
    document.querySelectorAll('.tags-input-container select').forEach(dropdown => {
      dropdown.addEventListener('mousedown', async (event) => {
        // Prevent the default dropdown from showing immediately
        event.preventDefault();
        
        // Refresh the dropdown content
        await refreshTagDropdown(dropdown);
        
        // Show the dropdown
        dropdown.click();
      });
    });

    // Also add the handler for dynamically created dropdowns
    document.body.addEventListener('mousedown', async (event) => {
      if (event.target.matches('.tags-input-container select')) {
        event.preventDefault();
        await refreshTagDropdown(event.target);
        event.target.click();
      }
    });

    // ... rest of your existing code ...
  });

  // Add this near your other event listeners
  document.querySelectorAll('.refresh-tags-button').forEach(button => {
    button.addEventListener('click', async (event) => {
      const dropdown = event.target.closest('.tags-input-container').querySelector('select');
      if (dropdown) {
        // Use the refreshTagDropdown function for consistency
        await refreshTagDropdown(dropdown);
        
        // Add visual feedback
        const refreshButton = event.target;
        refreshButton.style.transform = 'rotate(360deg)';
        setTimeout(() => {
          refreshButton.style.transform = 'none';
        }, 200);
      }
    });
  });

  // Also add handler for dynamically created refresh buttons
  document.body.addEventListener('click', async (event) => {
    if (event.target.matches('.refresh-tags-button')) {
      const dropdown = event.target.closest('.tags-input-container').querySelector('select');
      if (dropdown) {
        await refreshTagDropdown(dropdown);
        
        // Optional: Add a visual feedback for refresh
        const refreshButton = event.target;
        refreshButton.style.transform = 'rotate(360deg)';
        setTimeout(() => {
          refreshButton.style.transform = 'none';
        }, 200);
      }
    }
  });


  // Add these event listeners for single-edit mode dropdowns
  document.getElementById('model-designer').addEventListener('change', async (e) => {
    const filePath = getCurrentModelFilePath();
    await autoSaveModel('designer', e.target.value, filePath);
  });

  document.getElementById('model-license').addEventListener('change', async (e) => {
    const filePath = getCurrentModelFilePath();
    await autoSaveModel('license', e.target.value, filePath);
  });

  // The parent model listener is already present but let's make sure it's consistent
  document.getElementById('model-parent').addEventListener('change', async (e) => {
    const filePath = getCurrentModelFilePath();
    await autoSaveModel('parentModel', e.target.value, filePath);
  });

  // Update the About dialog content in index.html
  const tosContent = `
  <h4>MIT License</h4>
  <p class="tos-copyright">Copyright (c) 2025 Printventory</p>
  <p>
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
  </p>
  <p>
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
  </p>
  <p class="tos-warning">
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
  </p>
  <p>
    <strong>Data and Risk Disclaimer:</strong> You are solely responsible for backing up your data. 
    Use of this software is entirely at your own risk. The developers assume no liability for any 
    data loss, corruption, or damage.
  </p>
  `;

  // Add this function to initialize performance settings
  async function initializePerformanceSettings() {
    try {
      // Load max file size setting
      const maxFileSize = await window.electron.getSetting('maxFileSizeMB') || '50';
      const input = document.getElementById('max-file-size');
      if (input) {
        input.value = maxFileSize;
        MAX_FILE_SIZE_MB = parseInt(maxFileSize);
      }
    } catch (error) {
      console.error('Error initializing performance settings:', error);
    }
  }

  async function savePerformanceSettings() {
    try {
      const input = document.getElementById('max-file-size');
      if (!input) {
        throw new Error('Could not find max file size input');
      }

      const maxFileSize = parseMaxFileSizeMBInput(input.value);
      
      // Validate input
      if (maxFileSize == null) {
        throw new Error('Invalid max file size. Must be at least 1 MB.');
      }

      // Save to database
      await window.electron.saveSetting('maxFileSizeMB', maxFileSize.toString());
      
      // Update the global variable
      MAX_FILE_SIZE_MB = maxFileSize;
      
      // Close dialog and show success message
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        dialog.close();
      }
      await window.electron.showMessage('Success', 'Performance settings saved successfully');
    } catch (error) {
      console.error('Error saving performance settings:', error);
      await window.electron.showMessage('Error', error.message);
    }
  }

  // Add performance settings event listeners (handler registered at top with _openPerformanceSettingsDialog)
  document.addEventListener('DOMContentLoaded', async () => {
    await initializeSettings();

    if (window._electronPendingEvents['open-performance-settings']) {
      window._electronPendingEvents['open-performance-settings'].forEach((args) => {
        window._electronRealEventHandlers['open-performance-settings'].apply(null, args);
      });
      delete window._electronPendingEvents['open-performance-settings'];
    }

    // Save/cancel use onclick in index.html + savePerformanceSettingsFromDialog (avoid duplicate handlers)
  });

  // Add performance settings dialog handler
  document.getElementById('performance-settings-dialog').addEventListener('submit', async (event) => {
    event.preventDefault();
    
    try {
      const newBatchSize = parseInt(document.getElementById('batch-size').value);
      const newConcurrentRenders = parseInt(document.getElementById('concurrent-renders').value);
      const newMaxFileSize = parseMaxFileSizeMBInput(document.getElementById('max-file-size').value);
      const newThumbnailBatchSize = parseInt(document.getElementById('thumbnail-batch-size').value);
      const newRenderDelay = parseInt(document.getElementById('render-delay').value);

      // Validate inputs
      if (isNaN(newBatchSize) || newBatchSize < 1 || newBatchSize > 100) {
        throw new Error('Invalid batch size. Must be between 1 and 100.');
      }
      if (isNaN(newConcurrentRenders) || newConcurrentRenders < 1 || newConcurrentRenders > 10) {
        throw new Error('Invalid concurrent renders. Must be between 1 and 10.');
      }
      if (newMaxFileSize == null) {
        throw new Error('Invalid max file size. Must be at least 1 MB.');
      }
      if (isNaN(newThumbnailBatchSize) || newThumbnailBatchSize < 5 || newThumbnailBatchSize > 20) {
        throw new Error('Invalid thumbnail batch size. Must be between 5 and 20.');
      }
      if (isNaN(newRenderDelay) || newRenderDelay < 0 || newRenderDelay > 100) {
        throw new Error('Invalid render delay. Must be between 0 and 100 ms.');
      }

      // Save settings
      await window.electron.saveSetting('batchSize', newBatchSize.toString());
      await window.electron.saveSetting('maxConcurrentRenders', newConcurrentRenders.toString());
      await window.electron.saveSetting('maxFileSizeMB', newMaxFileSize.toString());
      await window.electron.saveSetting('thumbnailBatchSize', newThumbnailBatchSize.toString());
      await window.electron.saveSetting('renderDelay', newRenderDelay.toString());

      // Update variables
      BATCH_SIZE = newBatchSize;
      MAX_CONCURRENT_RENDERS = newConcurrentRenders;
      MAX_FILE_SIZE_MB = newMaxFileSize;
      THUMBNAIL_BATCH_SIZE = newThumbnailBatchSize;
      RENDER_DELAY = newRenderDelay;

      document.getElementById('performance-settings-dialog').close();
    } catch (error) {
      console.error('Error saving performance settings:', error);
      await window.electron.showMessage('Error', error.message);
    }
  });

  // Update the file scanning function to use MAX_FILE_SIZE_MB
  function isValidFile(filename, size) {
    const maxSize = MAX_FILE_SIZE_MB * 1024 * 1024;
    const lower = filename.toLowerCase();
    const ext = lower.includes('.') ? '.' + lower.split('.').pop() : '';
    const isValid = EXTENSIONS_VALID_FOR_LIBRARY.has(ext) && size <= maxSize;
    debugLog(`File validation: ${filename}, size: ${size}, max: ${maxSize}, valid: ${isValid}`);
    return isValid;
  }

  // Add this function to initialize all settings including performance settings
  async function initializeSettings() {
    try {
      // Initialize other settings as needed
      const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
      if (backgroundColor) {
        document.documentElement.style.setProperty('--model-background-color', backgroundColor);
        document.getElementById('model-background-color').value = backgroundColor;
      }
    } catch (error) {
      console.error('Error initializing settings:', error);
    }
  }

  // Call initializeSettings when the app starts
  document.addEventListener('DOMContentLoaded', async () => {
    await initializeSettings();
    // Rest of your initialization code...
  });

  // ... rest of the existing code ...

  // Add this near the other electron event listeners
  window.electron.onDbCleanup(async (event, data) => {
    if (data.message) {
      await window.electron.showMessage('Database Cleanup', data.message);
    }
  });

  // 1. Implement thumbnail caching system
  const thumbnailCache = new Map();

  // extract3MFThumbnail moved to top level for generateThumbnail access
  
  async function extract3MFSTL(filePath) {
    try {
      return await window.electron.get3MFSTL(filePath); // Direct return
    } catch (error) {
      console.error('extract3MFSTL error:', error);
      // throw error;  // Same consideration as above
      return null;
    }
  }

  // NOTE: renderModelToPNG is defined at top level (line ~5462) - duplicate removed
  
  function displayThumbnail(thumbnail, container, size) {
    const img = document.createElement('img');
    img.src = thumbnail;
    img.style.width = size;
    img.style.height = size;
    img.className = 'model-thumbnail'; // Add a class for styling (optional)
    container.innerHTML = ''; // Clear existing content
    container.appendChild(img);
    return thumbnail;
  }

  async function renderSTLThumbnail(filePath, container) {
    const renderer = getSharedRenderer();
    const thumbnailSize = '250px';
  
    let scene, camera, model;
  
    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
  
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);
    
    // Check if advanced lighting is enabled (default true)
    const useAdvancedLighting = window.currentRenderLighting !== undefined ? window.currentRenderLighting : true;
    
    if (useAdvancedLighting) {
      const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
      keyLight.position.set(5, 10, 7.5); // Standard key light position
      scene.add(keyLight);
      
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
      fillLight.position.set(-5, 5, -7.5); // Fill/Back light
      scene.add(fillLight);
    } else {
      // Fallback to simple directional light if advanced lighting is disabled
      const simpleLight = new THREE.DirectionalLight(0xffffff, 1.0);
      simpleLight.position.set(1, 1, 1).normalize();
      scene.add(simpleLight);
    }
  
      model = await loadModel(filePath, {
        optimizeGeometry: true,
        skipMaterials: true
      });
  
      if (!model) {
        throw new Error('Failed to load model');
      }
  
      model.traverse(child => {
        if (child.isMesh) {
          if (useAdvancedLighting) {
             child.material = new THREE.MeshStandardMaterial({
              color: getModelColor(),
              metalness: 0.3,
              roughness: 0.4
            }); 
          } else {
             child.material = new THREE.MeshBasicMaterial({ color: getModelColor() });
          }
        }
      });
  
      scene.add(model);
      fitCameraToObject(camera, model, scene, renderer);
  
      renderer.render(scene, camera);
      const imgData = renderer.domElement.toDataURL('image/png', 0.8);
  
      thumbnailCache.set(filePath, imgData);
  
      return displayThumbnail(imgData, container, thumbnailSize);
  
    } catch (error) {
      console.error('Error rendering STL:', error);
      return displayThumbnail(generateCorruptedPlaceholder(), container, thumbnailSize);
    } finally {
      // Clean up THREE.js resources
      if (scene) {
        scene.traverse((object) => {
          if (object.geometry) {
            object.geometry.dispose();
            object.geometry = null;
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(material => {
                material.dispose();
                material = null;
              });
            } else {
              object.material.dispose();
              object.material = null;
            }
          }
        });
        scene.clear();
        scene = null;
      }

      // Explicitly clean up the model
      if (model) {
        model.traverse(child => {
          if (child.geometry) {
            child.geometry.dispose();
            child.geometry = null;
          }
        });
        model = null;
      }

      // Reset renderer state but keep the instance
      if (sharedRenderer) {
        // sharedRenderer.forceContextLoss(); // Do not force context loss as it destroys the WebGL context
        sharedRenderer.resetState();
        sharedRenderer.clear();
      }

      // Force garbage collection
      if (typeof gc === 'function') gc();
    }
  }
  

  // NOTE: processRenderQueue is defined at top level (line ~5316) - duplicate removed
  
  // 8. Add memory management
  function cleanupMemory() {
    if (thumbnailCache.size > 1000) { // Limit cache size
      const entriesToRemove = Array.from(thumbnailCache.keys()).slice(0, 500);
      entriesToRemove.forEach(key => thumbnailCache.delete(key));
    }
    
    if (sharedRenderer) {
      sharedRenderer.state.reset();
    }
  }

  // Add function for deep cleanup of Three.js resources.
  // Do NOT call forceContextLoss — that restarts Chromium's GPU process and floods
  // Docker logs with Skia OOM / CreateSharedImage errors (especially NVIDIA+ANGLE).
  function deepCleanThreeResources() {
    if (sharedRenderer) {
      try {
        sharedRenderer.dispose();
      } catch (_) { /* ignore */ }
      sharedRenderer = null;
    }
    if (sharedCanvas) {
      try { sharedCanvas.remove(); } catch (_) { /* ignore */ }
      sharedCanvas = null;
    }
    contextUseCount = 0;

    // Force garbage collection
    if (typeof gc === 'function') {
      try { gc(); } catch (_) { /* ignore */ }
    }

    // Clear texture cache
    if (typeof THREE !== 'undefined' && THREE.Cache) {
      THREE.Cache.clear();
    }
  }

  // NOTE: loadModel is now defined at top level (line ~50) - duplicate removed



  // NOTE: refreshModelDisplay is defined at top level (line ~5093) - duplicate removed

  // Add this function to handle closing the details panel
  function closeDetailsPanel() {
    const detailsPanel = document.getElementById('model-details');
    if (detailsPanel) {
      detailsPanel.classList.add('hidden');
    }
  }

  // Update the click handler for file items
  function handleFileItemClick(element, filePath) {
    if (isMultiSelectMode) {
      // ... existing multi-select mode code ...
    } else {
      // Single select mode
      const wasSelected = element.classList.contains('selected');
      
      // Clear all selections first
      document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
      });

      if (wasSelected) {
        // If it was already selected, just deselect it and close details
        element.classList.remove('selected');
        closeDetailsPanel();
      } else {
        // If it wasn't selected, select it and show details
        element.classList.add('selected');
        showModelDetails(filePath);
      }
    }
  }

  // NOTE: renderFile is defined at top level (line ~5046) - duplicate removed

  // Add this function to filter by directory
  async function filterByDirectory(directoryPath) {
    try {
        const models = await window.electron.getModelsByDirectory(directoryPath);
        await displayModels(models);
    } catch (error) {
        console.error('Error filtering by directory:', error);
    }
  }

  // Add these constants at the top with other constants
  const ROULETTE_SPINS = 10; // Number of models to highlight before stopping
  const ROULETTE_INITIAL_DELAY = 100; // Initial delay between highlights in ms
  const ROULETTE_DELAY_INCREMENT = 20; // How much to slow down each spin

  // Add the roulette functionality
  async function startPrintRoulette() {
    // Get all visible models in the grid
    const visibleModels = Array.from(document.querySelectorAll('.file-item'));
    if (visibleModels.length === 0) return;

    // Clear any existing selections
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    // Close details panel if open
    const detailsPanel = document.getElementById('model-details');
    if (detailsPanel) {
      detailsPanel.classList.add('hidden');
    }

    let delay = ROULETTE_INITIAL_DELAY;
    let previousItem = null;

    // Function to highlight a random item.
    // Pass doScroll=true to scroll the item into view.
    const highlightRandom = (doScroll = false) => {
      if (previousItem) {
        previousItem.classList.remove('selected');
      }
      const randomIndex = Math.floor(Math.random() * visibleModels.length);
      const randomItem = visibleModels[randomIndex];
      randomItem.classList.add('selected');
      if (doScroll) {
        randomItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      previousItem = randomItem;
      return randomItem;
    };

    // Spin animation without scrolling (to avoid white flashes)
    for (let i = 0; i < ROULETTE_SPINS; i++) {
      await new Promise(resolve => setTimeout(resolve, delay));
      highlightRandom(); // no scrolling on intermediate spins
      delay += ROULETTE_DELAY_INCREMENT; // Gradually slow down
    }

    // Final selection with scrolling.
    const finalItem = highlightRandom(true);
    const filePath = finalItem.getAttribute('data-filepath');
    
    // Add winning animation class
    finalItem.classList.add('roulette-winner');
    setTimeout(() => finalItem.classList.remove('roulette-winner'), 3000);
    
    // Show model details and update selection state
    selectedModels.add(filePath);
    await showModelDetails(filePath);
    
    // Show celebration message
    await window.electron.showMessage(
      'Print Roulette',
      'Your next print has been chosen! 🎲\nTime to get printing!'
    );
  }

  window._electronRealEventHandlers['start-print-roulette'] = function() {
    startPrintRoulette();
  };
  if (window._electronPendingEvents['start-print-roulette']) {
    window._electronPendingEvents['start-print-roulette'].forEach((args) => {
      window._electronRealEventHandlers['start-print-roulette'].apply(null, args);
    });
    delete window._electronPendingEvents['start-print-roulette'];
  }

  // Add these functions at an appropriate location
  async function checkForUpdates(silent = false) {
    try {
      const currentVersion = await window.electron.getSetting('currentVersion');
      const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
      const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');
      
      console.log('Checking for updates:', {
        currentVersion,
        isBeta,
        lastDeclinedVersion,
        checkType: silent ? 'startup' : 'manual',
        endpoint: isBeta ? 'beta.version' : 'public.version'
      });
      
      // Get latest version from web
      const latestVersion = await window.electron.checkForUpdates(isBeta);
      if (!latestVersion) return;

      console.log('Version check result:', {
        currentVersion,
        latestVersion,
        lastDeclinedVersion,
        isBeta,
        needsUpdate: latestVersion !== currentVersion
      });

      // Store the latest version
      await window.electron.saveSetting('latestVersion', latestVersion);
      await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());

      // Compare versions
      // For manual checks (silent=false), ignore lastDeclinedVersion so user can check again
      // For automatic checks (silent=true), respect lastDeclinedVersion to avoid re-prompting
      const shouldCheckDeclined = silent; // Only check declined version on automatic checks
      const isUpdateAvailable = latestVersion && 
                                latestVersion !== currentVersion && 
                                compareVersions(latestVersion, currentVersion) > 0;
      const shouldShowPrompt = isUpdateAvailable && 
                               (!shouldCheckDeclined || latestVersion !== lastDeclinedVersion);
      
      if (shouldShowPrompt) {
        // Always show update prompt if there's an update
        const shouldUpdate = await window.electron.showMessage(
          'Update Available',
          `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
          ['Yes', 'No']
        );

        if (shouldUpdate === 'Yes') {
          await window.electron.openUpdatePage(isBeta);
        } else {
          // Store the declined version
          console.log('User declined update, storing version:', latestVersion);
          await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
        }
      } else if (!silent) {
        // For manual checks, show appropriate message
        if (isUpdateAvailable && latestVersion === lastDeclinedVersion) {
          // Update available but was previously declined
          await window.electron.showMessage(
            'Update Previously Declined',
            `Version ${latestVersion} is available, but you previously declined this update. You can still update by visiting the website.`
          );
        } else {
          // Actually up to date
          await window.electron.showMessage(
            'Up to Date',
            'You are running the latest version.'
          );
        }
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      if (!silent) {
        await window.electron.showMessage(
          'Error',
          'Failed to check for updates. Please try again later.'
        );
      }
    }
  }

  // Remove any nested DOMContentLoaded listeners and consolidate into one
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      bindAboutCloseButton();
      // Scan STL Home: ensure delegated handler is attached (fallback if main block ran before body existed)
      if (typeof window.attachScanStlHomeHandler === 'function') window.attachScanStlHomeHandler();
      // If user clicked "Scan STL Home" before runScanSTLHome was ready, run the queued scan now
      if (window._pendingScanStlHome && typeof window.runScanSTLHome === 'function') {
        window._pendingScanStlHome = false;
        console.log('[Scan STL Home] running queued scan (DOMContentLoaded)');
        window.runScanSTLHome();
      }
      // Initialize all settings first
      await initializeSettings();
      
      // Initialize dialog handlers
      initializeDialogHandlers();
      
      // Initialize performance settings handlers
      initializePerformanceSettings();
      
      // About dialog: handled by early listener (electron.on('open-about')) which calls
      // _electronRealEventHandlers['open-about'] set in initializeDialogHandlers() above.
      // Register onOpenAbout so preload has a listener; callback is a no-op here to avoid
      // double-open (early handler already opens the dialog).
      window.electron.onOpenAbout(() => {});

      // Add server mode info dialog handler
      window.electron.onOpenServerModeInfo(async () => {
        const dialog = document.getElementById('server-mode-info-dialog');
        if (dialog) {
          dialog.showModal();
        }
      });

      // Defer silent check so settings/dialogs can paint first (IPC + network; main also checks)
      setTimeout(() => {
        checkForUpdates(true).catch((err) => console.error('Silent update check:', err));
      }, 2000);
      
    } catch (error) {
      console.error('Error during initialization:', error);
    }
  });


  // NOTE: initializeGrid is defined at top level (line ~6635) - duplicate removed

  // Add this function to handle clearing the directory filter
  async function clearDirectoryFilter() {
    try {
      // Get the filter indicator element and clear its content and visual state
      if (typeof window.resetCurrentFilterPanelShell === "function") {
        window.resetCurrentFilterPanelShell();
      } else {
        const filterIndicator = document.getElementById("current-filter");
        if (filterIndicator) {
          filterIndicator.innerHTML = "";
          filterIndicator.classList.remove("visible");
        }
      }
      // Retrieve and display all models
      const models = await window.electron.getAllModels();
      await displayModels(models);
    } catch (error) {
      console.error('Error clearing directory filter:', error);
    }
  }

  // Expose clearDirectoryFilter to the global (window) scope so that event listeners can access it
  window.clearDirectoryFilter = clearDirectoryFilter;

  // Update the parent directory click handler to show the clear button

  // Open STL Home dialog when the main process sends the event
  window.electron.onOpenSTLHome(async () => {
    await window.openSTLHomeDialog();
  });

  // Handler for "Choose Directory" button in the STL Home dialog
  document.getElementById('choose-stl-home-button')?.addEventListener('click', async () => {
    const directory = await window.electron.openFileDialog();
    if (directory && directory[0]) {
      document.getElementById('stl-home-directory').value = directory[0];
    }
  });

  // Handler for Cancel button in the STL Home dialog (inline onclick also set in HTML for Docker/server mode)
  document.getElementById('cancel-stl-home-button')?.addEventListener('click', () => {
    document.getElementById('stl-home-dialog').close();
  });

  // Gray out path-metadata options when "Enable" is unchecked (change + click for Docker/server mode)
  const stlHomePathMetaEnabledEl = document.getElementById('stl-home-path-metadata-enabled');
  if (stlHomePathMetaEnabledEl) {
    stlHomePathMetaEnabledEl.addEventListener('change', updateStlHomePathMetadataGrayed);
    stlHomePathMetaEnabledEl.addEventListener('click', updateStlHomePathMetadataGrayed);
  }

  // Show or hide "Scan STL Home" sidebar button based on whether STL Home path is set
  async function updateScanStlHomeButtonVisibility() {
    const stlHome = await window.electron.getSetting('stlHome');
    const btn = document.getElementById('scan-stl-home-button');
    if (btn) btn.style.display = (stlHome && stlHome.trim() !== '') ? '' : 'none';
  }
  window.updateScanStlHomeButtonVisibility = updateScanStlHomeButtonVisibility;

  document.getElementById('clear-stl-home-button')?.addEventListener('click', () => window.clearSTLHomeDirectory());
  document.getElementById('stl-home-path-direction')?.addEventListener('change', () => { if (window.updateStlHomePathDirectionDesc) window.updateStlHomePathDirectionDesc(); });

  // Periodic STL Home scanning for server mode
  let stlHomeScanInterval = null;

  async function startPeriodicSTLHomeScan() {
    // Stop any existing interval
    stopPeriodicSTLHomeScan();
    
    const serverMode = await window.electron.isServerMode().catch(() => false);
    if (!serverMode) return;
    
    const stlHome = await window.electron.getSetting('stlHome');
    if (!stlHome || stlHome.trim() === "") return;
    
    const updateFrequency = await window.electron.getSetting('stlHomeUpdateFrequency');
    const frequencyMinutes = parseInt(updateFrequency) || 60;
    const frequencyMs = frequencyMinutes * 60 * 1000;
    
    console.log(`Starting periodic STL Home scan. Frequency: ${frequencyMinutes} minutes (first run after interval)`);
    
    // In server mode: no scan on page load; first check after interval, then on interval
    const runScan = async () => {
      const currentStlHome = await window.electron.getSetting('stlHome');
      if (currentStlHome && currentStlHome.trim() !== "") {
        await performSTLHomeScan(currentStlHome);
      } else {
        stopPeriodicSTLHomeScan();
      }
    };
    stlHomeScanInterval = setInterval(runScan, frequencyMs);
  }

  function stopPeriodicSTLHomeScan() {
    if (stlHomeScanInterval) {
      clearInterval(stlHomeScanInterval);
      stlHomeScanInterval = null;
      console.log('Stopped periodic STL Home scan');
    }
  }

  async function performSTLHomeScan(stlHomeDir) {
    try {
      console.log(`Performing periodic STL Home scan: ${stlHomeDir}`);
      // Use background scan to avoid disrupting the UI
      await scanAndRenderDirectory(stlHomeDir, true);
      
      // Refresh filters after scanning
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();
    } catch (error) {
      console.error('Error during periodic STL Home scan:', error);
    }
  }
  window.performSTLHomeScan = performSTLHomeScan;
  window.startPeriodicSTLHomeScan = startPeriodicSTLHomeScan;
  window.stopPeriodicSTLHomeScan = stopPeriodicSTLHomeScan;

  // Shared save logic for STL Home (used by Save click, form submit, and inline onclick for Docker/server/Electron)
  async function saveSTLHomeFromDialog() {
    console.log('[STL Home] saveSTLHomeFromDialog started');
    const stlDirEl = document.getElementById('stl-home-directory');
    const pathMetaEnabledEl = document.getElementById('stl-home-path-metadata-enabled');
    const pathMetaUseDesignerEl = document.getElementById('stl-home-use-designer');
    const pathMetaUseParentModelEl = document.getElementById('stl-home-use-parent-model');
    const pathMetaDirectionEl = document.getElementById('stl-home-path-direction');
    const pathMetaDesignerIndexEl = document.getElementById('stl-home-designer-index');
    const pathMetaParentModelIndexEl = document.getElementById('stl-home-parent-model-index');
    const stlDir = stlDirEl ? stlDirEl.value.trim() : '';
    try {
      console.log('[STL Home] Saving stlHome:', stlDir);
      await window.electron.saveSetting('stlHome', stlDir);
      await window.electron.saveSetting('pathMetadataStlHomeEnabled', pathMetaEnabledEl?.checked ? '1' : '0');
      await window.electron.saveSetting('pathMetadataStlHomeDirection', (pathMetaDirectionEl?.value === 'fromRoot' || pathMetaDirectionEl?.value === 'fromModel') ? pathMetaDirectionEl.value : 'fromModel');
      await window.electron.saveSetting('pathMetadataUseDesigner', pathMetaUseDesignerEl?.checked ? '1' : '0');
      await window.electron.saveSetting('pathMetadataUseParentModel', pathMetaUseParentModelEl?.checked ? '1' : '0');
      await window.electron.saveSetting('pathMetadataDesignerIndex', pathMetaDesignerIndexEl?.value ?? '1');
      await window.electron.saveSetting('pathMetadataParentModelIndex', pathMetaParentModelIndexEl?.value ?? '0');
      if (typeof updateScanStlHomeButtonVisibility === 'function') updateScanStlHomeButtonVisibility();
      const serverMode = await window.electron.isServerMode().catch(() => false);
      if (serverMode) {
        const updateFrequencyEl = document.getElementById('stl-home-update-frequency');
        const updateFrequency = updateFrequencyEl ? updateFrequencyEl.value : '60';
        await window.electron.saveSetting('stlHomeUpdateFrequency', updateFrequency);
        if (stlDir && stlDir.trim() !== "") {
          if (typeof performSTLHomeScan === 'function') performSTLHomeScan(stlDir).catch(err => console.error('STL Home scan on save:', err));
          if (typeof startPeriodicSTLHomeScan === 'function') startPeriodicSTLHomeScan();
        } else {
          if (typeof stopPeriodicSTLHomeScan === 'function') stopPeriodicSTLHomeScan();
        }
      }
      console.log('[STL Home] Save complete, closing dialog');
      const dialog = document.getElementById('stl-home-dialog');
      if (dialog && typeof dialog.close === 'function') dialog.close();
    } catch (err) {
      console.error('STL Home save failed:', err);
      if (window.electron && typeof window.electron.showMessage === 'function') {
        await window.electron.showMessage('Error', 'Failed to save STL Home: ' + (err.message || String(err)));
      }
    }
  }
  window.saveSTLHomeFromDialog = saveSTLHomeFromDialog;

  // Save button uses inline onclick in HTML so it works in Docker/server/Electron; form submit for Enter key
  // Form submit: prevent default and run same save (e.g. Enter key)
  document.getElementById('stl-home-dialog').addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveSTLHomeFromDialog();
  });

  // Show/hide "Scan STL Home" button based on STL Home setting
  updateScanStlHomeButtonVisibility();

  // Scan STL Home: implementation is at top level (_runScanSTLHomeImpl); run any queued click from before script ready
  if (window._pendingScanStlHome) {
    window._pendingScanStlHome = false;
    console.log('[Scan STL Home] running queued scan');
    window.runScanSTLHome();
  }

  // Attach Scan STL Home click handler (immediately if body exists, else on DOMContentLoaded - Server/Docker)
  function attachScanStlHomeHandler() {
    if (!document.body) return;
    if (document.body._scanStlHomeHandlerAttached) return;
    document.body._scanStlHomeHandlerAttached = true;
    document.body.addEventListener('click', function scanStlHomeDelegated(e) {
      if (!e.target || !e.target.closest) return;
      if (!e.target.closest('#scan-stl-home-button')) return;
      const btn = document.getElementById('scan-stl-home-button');
      if (btn && btn.style.display === 'none') return;
      e.preventDefault();
      e.stopPropagation();
      console.log('[Scan STL Home] button clicked');
      if (typeof window.runScanSTLHome === 'function') window.runScanSTLHome();
    });
    console.log('[Scan STL Home] delegated handler attached to body');
  }
  window.attachScanStlHomeHandler = attachScanStlHomeHandler;
  if (document.body) attachScanStlHomeHandler();
  else document.addEventListener('DOMContentLoaded', attachScanStlHomeHandler);

  // On startup, if an STL Home directory is specified:
  // - In docker/server mode (stl_home set via startup/env): run one background check when the server loads, then on the interval.
  // - When user saves STL Home via the UI in server mode: scan runs in the dialog submit handler when saved.
  // - In normal mode: scan once on load and refresh filters.
  const stlHome = await window.electron.getSetting('stlHome');
  
  if (stlHome && stlHome.trim() !== "") {
    const serverModeStlHome = await window.electron.isServerMode().catch(() => false);
    if (serverModeStlHome) {
      console.log("STL Home is set (server mode). Running initial background check, then on the configured interval.");
      performSTLHomeScan(stlHome).catch(err => console.error('Background STL Home scan on server load:', err));
      startPeriodicSTLHomeScan();
    } else {
      console.log("STL Home is set. Showing library from database; STL Home scan in background:", stlHome);
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      }
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();
      scanAndRenderDirectory(stlHome, true, true)
        .then(async () => {
          try {
            await populateDesignerDropdown();
            await populateParentModelFilter();
            await populateTagFilter();
            await populateLicenseFilter();
          } catch (e) {
            console.error('Startup STL Home scan: filter refresh failed:', e);
          }
        })
        .catch((err) => console.error('Background STL Home scan on startup:', err));
    }
  } else if (typeof window.performCombinedSearch === 'function') {
    await window.performCombinedSearch();
  }
  // Ensure "Scan STL Home" button is visible when STL Home is set (Docker/server: may be set via env before UI ready)
  if (typeof window.updateScanStlHomeButtonVisibility === 'function') {
    await window.updateScanStlHomeButtonVisibility();
  }

  // Add event listener for "View Entire Library" button
  const viewLibraryButton = document.getElementById('view-library-button');
  if (viewLibraryButton) {
    viewLibraryButton.addEventListener('click', async () => {
      try {
        window.disableGridRefresh = false;
        const gridEl = document.querySelector('.file-grid');
        if (gridEl) gridEl.currentModels = null;
        // Reset all filter dropdowns
        document.getElementById('designer-select').value = '';
        document.getElementById('license-select').value = '';
        document.getElementById('parent-select').value = '';
        document.getElementById('printed-select').value = 'all';
        const newSelVl = document.getElementById('new-select');
        if (newSelVl) newSelVl.value = 'all';
        document.getElementById('tag-filter').value = '';
        document.getElementById('filetype-select').value = '';
        document.getElementById('search-filter-input').value = '';
        if (typeof window.queryBuilderClearAllMultiChips === 'function') {
          window.queryBuilderClearAllMultiChips();
        }
        if (typeof window.clearSearchClauseList === 'function') {
          window.clearSearchClauseList();
        }
        window.currentDirectoryFilter = "";
        window.dateAddedFilter = null;
        window._lastDateAddedFilter = null;
        const viewLibMsg = document.getElementById("view-library-message");
        if (viewLibMsg) viewLibMsg.style.display = "none";
        window.viewingEntireLibrary = true;
        if (typeof window.resetCurrentFilterPanelShell === "function") {
          window.resetCurrentFilterPanelShell();
        } else {
          const filterIndicator = document.getElementById("current-filter");
          if (filterIndicator) {
            filterIndicator.innerHTML = "";
            filterIndicator.classList.remove("visible");
          }
        }
        // Force refetch and re-render so grid updates in Docker/server
        if (typeof window.forceGridRefresh === 'function') {
          await window.forceGridRefresh();
        } else if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
        console.log("Viewing entire library");
      } catch (error) {
        console.error('Error loading library:', error);
        await window.electron.showMessage('Error', 'Failed to load library.');
      }
    });
  } else {
    debugLog("View Library button not found.");
  }

  // Add event listeners on filter and search elements so that the "view-library-message" is removed when a filter or search is active.
  ["designer-select", "license-select", "parent-select", "printed-select", "new-select", "favorite-select", "rating-select", "rating-min-select", "tag-filter", "filetype-select", "search-filter-input"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        const msg = document.getElementById("view-library-message");
        if (msg) { msg.style.display = "none"; }
      });
      if (id === "search-filter-input") {
        el.addEventListener("input", () => {
          const msg = document.getElementById("view-library-message");
          if (msg) { msg.style.display = "none"; }
        });
      }
    }
  });

  // Assuming this is where the menu item is defined
  document.addEventListener('DOMContentLoaded', function() {
    // Remove any old guide references
    // const guideDialog = document.getElementById('guide-dialog'); // Remove this line if it exists

    // Assuming this is where the menu item is defined
    document.getElementById("guide-button").addEventListener("click", function() {
      // Call the new guide function
      window.electron.send('open-guide'); // Ensure this sends the correct event to show the new guide
    });
  });

  // Add this listener at the top of the file or within the DOMContentLoaded event
  window._electronRealEventHandlers['open-guide'] = function() {
    if (typeof showGuide === 'function') showGuide();
  };
  if (window._electronPendingEvents['open-guide']) {
    window._electronPendingEvents['open-guide'].forEach((args) => {
      window._electronRealEventHandlers['open-guide'].apply(null, args);
    });
    delete window._electronPendingEvents['open-guide'];
  }

  // Handler for puter.com AI requests from main process
  // In server mode, this is called via WebSocket from server-bridge.js
  // In normal mode, this is called via IPC from main process
  // The captcha will appear in this window (browser window in server mode, Electron window in normal mode)
  window._electronRealEventHandlers['puter-ai-chat-request'] = async function(requestId, prompt, imageUrl, model) {
    console.log('[Puter AI] Received request, Puter.js captcha may appear in this window');
    try {
      const response = await callPuterAI(prompt, imageUrl, model);
      const responseText = extractPuterResponseText(response);
      console.log('[Puter AI] Sending response back, requestId:', requestId, 'response length:', responseText?.length);
      window.electron.send('puter-ai-chat-response', requestId, { response: responseText });
    } catch (error) {
      console.error('[Puter AI] Error calling puter.ai.chat:', error);
      const mapped = mapPuterApiError(error);
      const errorMessage = mapped.message || 'Unknown error';
      console.log('[Puter AI] Sending error response, requestId:', requestId, 'error:', errorMessage);
      window.electron.send('puter-ai-chat-response', requestId, { error: errorMessage });
    }
  };
  if (window._electronPendingEvents['puter-ai-chat-request']) {
    window._electronPendingEvents['puter-ai-chat-request'].forEach((args) => {
      window._electronRealEventHandlers['puter-ai-chat-request'].apply(null, args);
    });
    delete window._electronPendingEvents['puter-ai-chat-request'];
  }

  window._electronRealEventHandlers['open-ai-config'] = async function() {
    await loadAndShowAIConfig();
  };
  if (window._electronPendingEvents['open-ai-config']) {
    window._electronPendingEvents['open-ai-config'].forEach((args) => {
      window._electronRealEventHandlers['open-ai-config'].apply(null, args);
    });
    delete window._electronPendingEvents['open-ai-config'];
  }

  window._electronRealEventHandlers['open-file-type-settings'] = async function() {
    await loadAndShowFileTypeSettings();
  };
  if (window._electronPendingEvents['open-file-type-settings']) {
    window._electronPendingEvents['open-file-type-settings'].forEach((args) => {
      window._electronRealEventHandlers['open-file-type-settings'].apply(null, args);
    });
    delete window._electronPendingEvents['open-file-type-settings'];
  }

  document.getElementById('test-ai-config')?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (typeof window.testAIConfigFromDialog === 'function') {
      await window.testAIConfigFromDialog();
      return;
    }
    const apiKeyEl = document.getElementById('ai-api-key');
    const endpointEl = document.getElementById('ai-endpoint');
    const modelEl = document.getElementById('ai-model');
    const serviceEl = document.getElementById('ai-service-select');
    
    if (!apiKeyEl || !endpointEl || !modelEl || !serviceEl) {
      console.error('One or more AI Config input elements not found.');
      return;
    }
    
    // Get values - ALWAYS read from the select element's selected option, not just .value
    // This ensures we get the actual selected value, not a stale value
    const selectedOption = serviceEl.options[serviceEl.selectedIndex];
    let service = selectedOption ? selectedOption.value : (serviceEl.value || 'puter');
    
    // If service is still empty or doesn't match what we expect, check the endpoint
    // If endpoint is Puter.com URL, force service to 'puter'
    const endpoint = endpointEl.value || '';
    if (endpoint.includes('puter.com') || endpoint.includes('js.puter.com')) {
      if (service !== 'puter') {
        console.warn('[AI Config Test] Endpoint is Puter.com but service is', service, '- forcing to puter');
        service = 'puter';
        serviceEl.value = 'puter';
        // Update selectedIndex to match
        for (let i = 0; i < serviceEl.options.length; i++) {
          if (serviceEl.options[i].value === 'puter') {
            serviceEl.selectedIndex = i;
            break;
          }
        }
      }
    }
    
    const apiKey = apiKeyEl.value || '';
    const model = modelEl.value || '';
    
    console.log('[AI Config Test] Calling testAIConfig with:', { 
      service, 
      endpoint, 
      model, 
      apiKeyLength: apiKey.length,
      serviceElValue: serviceEl.value,
      selectedIndex: serviceEl.selectedIndex,
      selectedOptionValue: selectedOption ? selectedOption.value : 'none'
    });
    
    const result = await window.electron.testAIConfig(apiKey, endpoint, model, service);
    const resultDiv = document.getElementById('ai-config-result');
    if (resultDiv) {
      if (result.success) {
        resultDiv.textContent = `Test successful! Tags: ${result.tags.join(', ')}`;
      } else {
        resultDiv.textContent = `Test failed: ${result.error}`;
      }
    } else {
      console.error('The ai-config-result element was not found.');
    }
  });

  document.getElementById('save-ai-config')?.addEventListener('click', async (event) => {
    event.preventDefault();
    if (typeof window.saveAIConfigFromDialog === 'function') {
      await window.saveAIConfigFromDialog();
      return;
    }
    const service = document.getElementById('ai-service-select')?.value || 'puter';
    const apiKey = service === 'puter' ? '' : (document.getElementById('ai-api-key')?.value || '');
    const endpoint = document.getElementById('ai-endpoint')?.value || (service === 'puter' ? 'https://js.puter.com/v2/' : 'https://api.openai.com/v1');
    const model = document.getElementById('ai-model')?.value || (service === 'puter' ? 'gpt-5-nano' : 'gpt-4o-mini');
    
    // AI tag settings
    const maxTags = document.getElementById('ai-tag-max-tags')?.value || '10';
    const mergeStrategy = document.getElementById('ai-tag-merge-strategy')?.value || 'merge';
    const useCategories = document.getElementById('ai-tag-use-categories')?.checked ? '1' : '0';
    const allowRetagging = document.getElementById('ai-tag-allow-retagging')?.checked ? '1' : '0';
    const concurrency = document.getElementById('ai-tag-concurrency')?.value || '3';
    const detailLevel = document.getElementById('ai-tag-detail-level')?.value || 'medium';
    
    await window.electron.saveSetting('apiKey', apiKey);
    await window.electron.saveSetting('apiEndpoint', endpoint);
    await window.electron.saveSetting('aiModel', model);
    await window.electron.saveSetting('aiService', service);
    await window.electron.saveSetting('aiTagMaxTags', maxTags);
    await window.electron.saveSetting('aiTagMergeStrategy', mergeStrategy);
    await window.electron.saveSetting('aiTagUseCategories', useCategories);
    await window.electron.saveSetting('aiTagAllowRetagging', allowRetagging);
    await window.electron.saveSetting('aiTagConcurrency', concurrency);
    await window.electron.saveSetting('aiTagDetailLevel', detailLevel);
    
    document.getElementById('ai-config-dialog').close();
  });

  document.getElementById('cancel-ai-config')?.addEventListener('click', () => {
    document.getElementById('ai-config-dialog').close();
  });

  document.getElementById('edit-ai-prompt')?.addEventListener('click', async () => {
    const editDialog = document.getElementById('ai-prompt-edit-dialog');
    const textarea = document.getElementById('ai-prompt-textarea');
    if (!editDialog || !textarea) return;
    const current = await window.electron.getSetting('aiTagPrompt').catch(() => null);
    if (current != null && String(current).trim() !== '') {
      textarea.value = current;
    } else {
      const defaultPrompt = await (window.electron.getDefaultAIPrompt && window.electron.getDefaultAIPrompt()).catch(() => '');
      textarea.value = defaultPrompt || '';
    }
    editDialog.showModal();
  });

  document.getElementById('reset-ai-prompt')?.addEventListener('click', async () => {
    if (!window.electron?.saveSetting) return;
    try {
      await window.electron.saveSetting('aiTagPrompt', '');
      if (window.electron?.showMessage) await window.electron.showMessage('AI Prompt', 'Prompt reset to default.');
    } catch (err) {
      console.error('Reset AI prompt error:', err);
      if (window.electron?.showMessage) await window.electron.showMessage('Error', err.message || 'Failed to reset prompt');
    }
  });

  document.getElementById('save-ai-prompt-edit')?.addEventListener('click', async () => {
    const editDialog = document.getElementById('ai-prompt-edit-dialog');
    const textarea = document.getElementById('ai-prompt-textarea');
    if (!editDialog || !textarea || !window.electron?.saveSetting) return;
    try {
      await window.electron.saveSetting('aiTagPrompt', textarea.value || '');
      editDialog.close();
      if (window.electron?.showMessage) await window.electron.showMessage('AI Prompt', 'Prompt saved.');
    } catch (err) {
      console.error('Save AI prompt error:', err);
      if (window.electron?.showMessage) await window.electron.showMessage('Error', err.message || 'Failed to save prompt');
    }
  });

  document.getElementById('cancel-ai-prompt-edit')?.addEventListener('click', () => {
    document.getElementById('ai-prompt-edit-dialog')?.close();
  });

  // Populate File Type filter dropdown with only enabled types (from Settings > File Type)
  async function populateFileTypeFilter() {
    const select = document.getElementById('filetype-select');
    if (!select) return;
    const currentValue = select.value;
    try {
      const enableZipArchives = await window.electron.getSetting('enableZipArchives');
      const scanTypesRaw = await window.electron.getSetting('scanAdditionalFileTypes');
      let scanTypes = [];
      try {
        if (scanTypesRaw && typeof scanTypesRaw === 'string') scanTypes = JSON.parse(scanTypesRaw);
        if (!Array.isArray(scanTypes)) scanTypes = [];
      } catch (e) { /* ignore */ }
      const catalog = await (window.electron.getAdditionalFileTypesCatalog && window.electron.getAdditionalFileTypesCatalog()) || [];
      const enabledIds = new Set(scanTypes);
      const options = [
        { value: '', label: 'All Types' },
        { value: 'stl', label: 'STL' },
        { value: '3mf', label: '3MF' }
      ];
      if (enableZipArchives === '1') options.push({ value: 'zip', label: 'Zip' });
      catalog.forEach(entry => {
        if (entry.id && enabledIds.has(entry.id)) options.push({ value: entry.id, label: entry.label || entry.id });
      });
      select.innerHTML = '';
      options.forEach(opt => {
        const option = document.createElement('option');
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === currentValue) option.selected = true;
        select.appendChild(option);
      });
      if (select.value !== currentValue && !options.some(o => o.value === currentValue)) select.value = '';
    } catch (e) {
      console.error('Error populating file type filter:', e);
    }
  }

  // Populate file type filter once when sidebar is ready (only enabled types)
  setTimeout(() => { if (typeof populateFileTypeFilter === 'function') populateFileTypeFilter(); }, 500);

  // File Type Settings: open-file-type-settings is handled via earlyEventChannels + _electronRealEventHandlers (loadAndShowFileTypeSettings)

  async function saveFileTypeSettingsFromDialog() {
    const dialogEl = document.getElementById('file-type-settings-dialog');
    if (!dialogEl) return;
    try {
      let previousIds = [];
      try {
        const previousRaw = await window.electron.getSetting('scanAdditionalFileTypes');
        if (previousRaw) previousIds = JSON.parse(previousRaw);
      } catch (e) { /* ignore */ }

      const ADDITIONAL_SCAN_TYPE_IDS = ['3ds', 'amf', 'blender', 'dae', 'dxf', 'dwg', 'fbx', 'f3d', 'f3z', 'gcode', 'igs', 'lys', 'obj', 'ply', 'step', 'svg', 'x3d'];
      const selectedScanTypes = [];
      for (const id of ADDITIONAL_SCAN_TYPE_IDS) {
        const el = dialogEl.querySelector('#scan-type-' + id) || document.getElementById('scan-type-' + id);
        if (el && el.checked) selectedScanTypes.push(id);
      }
      const uncheckedIds = previousIds.filter(id => !selectedScanTypes.includes(id));

      if (uncheckedIds.length > 0 && window.electron?.getModelCountByFileTypeIds && window.electron?.removeModelsByFileTypeIds) {
        const count = await window.electron.getModelCountByFileTypeIds(uncheckedIds);
        if (count > 0) {
          const catalog = await window.electron.getAdditionalFileTypesCatalog().catch(() => []);
          const labels = uncheckedIds.map(id => (catalog.find(e => e.id === id) || {}).label || id).join(', ');
          const message = count === 1
            ? `Unchecking "${labels}" will remove 1 file of that type from the library. This cannot be undone. Continue?`
            : `Unchecking ${labels} will remove ${count} files of those types from the library. This cannot be undone. Continue?`;
          const confirmResult = await window.electron.showMessage('Remove file type from library?', message, ['Yes', 'No']);
          if (confirmResult !== 'Yes') return;
          await window.electron.removeModelsByFileTypeIds(uncheckedIds);
          if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
        }
      }

      const checkbox = dialogEl.querySelector('#enable-zip-archives') || document.getElementById('enable-zip-archives');
      const enableZipArchives = checkbox?.checked ? '1' : '0';
      await window.electron.saveSetting('enableZipArchives', enableZipArchives);
      await window.electron.saveSetting('scanAdditionalFileTypes', JSON.stringify(selectedScanTypes));
      const designerCheckbox = dialogEl.querySelector('#enable-3mf-designer') || document.getElementById('enable-3mf-designer');
      const parentModelCheckbox = dialogEl.querySelector('#enable-3mf-parent-model') || document.getElementById('enable-3mf-parent-model');
      const licenseCheckbox = dialogEl.querySelector('#enable-3mf-license') || document.getElementById('enable-3mf-license');
      const notesCheckbox = dialogEl.querySelector('#enable-3mf-notes') || document.getElementById('enable-3mf-notes');
      await window.electron.saveSetting('enable3MFDesigner', designerCheckbox?.checked ? '1' : '0');
      await window.electron.saveSetting('enable3MFParentModel', parentModelCheckbox?.checked ? '1' : '0');
      await window.electron.saveSetting('enable3MFLicense', licenseCheckbox?.checked ? '1' : '0');
      await window.electron.saveSetting('enable3MFNotes', notesCheckbox?.checked ? '1' : '0');
      if (typeof dialogEl.close === 'function') dialogEl.close();
      if (typeof populateFileTypeFilter === 'function') await populateFileTypeFilter();
    } catch (err) {
      console.error('File type settings save failed:', err);
      if (window.electron?.showMessage) await window.electron.showMessage('Error', 'Failed to save file type settings: ' + (err.message || String(err)));
    }
  }
  window.saveFileTypeSettingsFromDialog = saveFileTypeSettingsFromDialog;

  document.getElementById('save-file-type-settings')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await saveFileTypeSettingsFromDialog();
  });

  document.getElementById('cancel-file-type-settings')?.addEventListener('click', () => {
    document.getElementById('file-type-settings-dialog')?.close();
  });

  // Browser Extension Settings: not shown in Docker/Server mode (menu item hidden there)
  window._electronRealEventHandlers['open-browser-extension-settings'] = async function() {
    const serverMode = await window.electron.isServerMode().catch(() => false);
    if (serverMode) return;
    const dialog = document.getElementById('browser-extension-settings-dialog');
    if (!dialog) return;
    const enabled = await window.electron.getSetting('enableBrowserExtension');
    const port = await window.electron.getSetting('browserExtensionPort');
    const uploadDir = await window.electron.getSetting('extensionUploadDirectory');
    const clientPrefix = await window.electron.getSetting('extensionClientPathPrefix');
    const containerPrefix = await window.electron.getSetting('extensionContainerPathPrefix');
    const copyToNas = await window.electron.getSetting('extensionCopyToNasPath');
    const check = document.getElementById('enable-browser-extension');
    const portInput = document.getElementById('browser-extension-port');
    const uploadDirInput = document.getElementById('extension-upload-directory');
    const clientPrefixInput = document.getElementById('extension-client-path-prefix');
    const containerPrefixInput = document.getElementById('extension-container-path-prefix');
    const copyToNasInput = document.getElementById('extension-copy-to-nas-path');
    if (check) check.checked = enabled === '1';
    if (portInput) portInput.value = port || '5000';
    if (uploadDirInput) uploadDirInput.value = uploadDir || '';
    if (clientPrefixInput) clientPrefixInput.value = clientPrefix || '';
    if (containerPrefixInput) containerPrefixInput.value = containerPrefix || '';
    if (copyToNasInput) copyToNasInput.value = copyToNas || '';
    dialog.showModal();
  };
  if (window._electronPendingEvents['open-browser-extension-settings']) {
    window._electronPendingEvents['open-browser-extension-settings'].forEach((args) => {
      window._electronRealEventHandlers['open-browser-extension-settings'].apply(null, args);
    });
    delete window._electronPendingEvents['open-browser-extension-settings'];
  }

  document.getElementById('save-browser-extension-settings')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const check = document.getElementById('enable-browser-extension');
    const portInput = document.getElementById('browser-extension-port');
    const uploadDirInput = document.getElementById('extension-upload-directory');
    const clientPrefixInput = document.getElementById('extension-client-path-prefix');
    const containerPrefixInput = document.getElementById('extension-container-path-prefix');
    const copyToNasInput = document.getElementById('extension-copy-to-nas-path');
    const enabled = check?.checked ? '1' : '0';
    const port = Math.min(65535, Math.max(1024, parseInt(portInput?.value || '5000', 10) || 5000));
    await window.electron.saveSetting('enableBrowserExtension', enabled);
    await window.electron.saveSetting('browserExtensionPort', String(port));
    await window.electron.saveSetting('extensionUploadDirectory', (uploadDirInput?.value || '').trim());
    await window.electron.saveSetting('extensionClientPathPrefix', (clientPrefixInput?.value || '').trim());
    await window.electron.saveSetting('extensionContainerPathPrefix', (containerPrefixInput?.value || '').trim());
    await window.electron.saveSetting('extensionCopyToNasPath', (copyToNasInput?.value || '').trim());
    if (enabled === '1') {
      const result = await window.electron.startExtensionServer(port);
      if (result && !result.success) {
        await window.electron.showMessage('Browser Extension Server', result.message || 'Failed to start server. On macOS, check the main process console (run from Terminal) or ensure the app was built with com.apple.security.network.server entitlement.');
        return;
      }
    } else {
      await window.electron.stopExtensionServer();
    }
    document.getElementById('browser-extension-settings-dialog').close();
  });

  document.getElementById('cancel-browser-extension-settings')?.addEventListener('click', () => {
    document.getElementById('browser-extension-settings-dialog').close();
  });

  document.getElementById('browser-extension-store-link')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const url = e.currentTarget.getAttribute('href');
    if (url && typeof window.electron?.openExternal === 'function') {
      await window.electron.openExternal(url);
    }
  });

  // Store pending tags for preview (can handle multiple models)
  let pendingTagData = [];
  let batchTagGenerationInProgress = false;
  let expectedBatchCount = 0;
  let reviewDialogOpen = false;
  let rateLimitDialogShown = false; // Track if rate limit dialog has been shown during current batch
  /** Set when the tag preview dialog closes; cleared when a new generate-tags run starts. Stops late IPC from reopening the dialog. */
  let suppressTagPreviewReopen = false;
  /** Bumps on each showTagPreviewDialog call so stale getSetting() callbacks cannot append duplicate UI */
  let tagPreviewDialogRenderGeneration = 0;

  // Helper function to normalize file paths for comparison (Docker/server may use leading slash or not)
  function normalizeFilePath(path) {
    if (!path) return '';
    const normalized = path.replace(/\\/g, '/').toLowerCase().trim();
    return normalized.replace(/^\/+/, ''); // strip leading slashes so "/3dmodels/..." and "3dmodels/..." match
  }

  // Helper function to get filePath from modelData (checks both locations)
  function getFilePathFromModelData(modelData) {
    return modelData.model?.filePath || modelData.filePath;
  }

  // Helper function to deduplicate model data array
  function deduplicateModelData(modelsData) {
    if (!Array.isArray(modelsData) || modelsData.length === 0) {
      return [];
    }
    
    const deduplicated = new Map();
    
    for (const modelData of modelsData) {
      if (!modelData) continue; // Skip null/undefined entries
      
      const filePath = getFilePathFromModelData(modelData);
      if (!filePath) {
        console.warn('[Deduplicate] Skipping modelData with no filePath:', modelData);
        continue;
      }
      
      const normalizedPath = normalizeFilePath(filePath);
      if (!normalizedPath) {
        console.warn('[Deduplicate] Skipping modelData with empty normalized path:', filePath);
        continue;
      }
      
      const existing = deduplicated.get(normalizedPath);
      
      // Prefer entry with actual tags over "Generating..." entries or empty tags
      if (!existing) {
        deduplicated.set(normalizedPath, modelData);
      } else {
        const existingHasTags = existing.generatedTags !== undefined && existing.generatedTags.length > 0;
        const newHasTags = modelData.generatedTags !== undefined && modelData.generatedTags.length > 0;
        const existingIsGenerating = existing.generatedTags === undefined;
        const newIsGenerating = modelData.generatedTags === undefined;
        
        // Always prefer entry with actual tags
        if (newHasTags && !existingHasTags) {
          // New has tags, existing doesn't - replace
          deduplicated.set(normalizedPath, modelData);
        } else if (existingHasTags && !newHasTags) {
          // Existing has tags, new doesn't - keep existing
          // (don't replace)
        } else if (newIsGenerating && !existingIsGenerating) {
          // New is generating, existing has some result - keep existing
          // (don't replace)
        } else if (existingIsGenerating && !newIsGenerating) {
          // Existing is generating, new has result - replace
          deduplicated.set(normalizedPath, modelData);
        } else {
          // Both in same state - prefer the one with more complete data (has model object)
          // If both have model objects, keep existing (first one wins)
          const existingHasModel = existing.model && typeof existing.model === 'object';
          const newHasModel = modelData.model && typeof modelData.model === 'object';
          
          if (newHasModel && !existingHasModel) {
            // New has model object, existing doesn't - replace
            deduplicated.set(normalizedPath, modelData);
          } else {
            // Keep existing (first one wins or both have same completeness)
            // (don't replace)
          }
        }
      }
    }
    
    const result = Array.from(deduplicated.values());
    
    // Final validation: ensure no duplicates by path
    const pathSet = new Set();
    const finalResult = [];
    for (const modelData of result) {
      const filePath = getFilePathFromModelData(modelData);
      if (!filePath) continue;
      const normalizedPath = normalizeFilePath(filePath);
      if (!pathSet.has(normalizedPath)) {
        pathSet.add(normalizedPath);
        finalResult.push(modelData);
      } else {
        console.warn(`[Deduplicate] Found duplicate after deduplication: ${filePath}`);
      }
    }
    
    return finalResult;
  }

  // Helper function to update or add model data to pendingTagData (ensures no duplicates)
  function updatePendingTagData(filePath, tagData) {
    const normalizedFilePath = normalizeFilePath(filePath);
    
    // First, remove ALL entries with this filePath (in case there are duplicates)
    // This ensures we never have multiple entries for the same file
    const beforeCount = pendingTagData.length;
    pendingTagData = pendingTagData.filter(d => {
      const dPath1 = normalizeFilePath(d.filePath);
      const dPath2 = normalizeFilePath(getFilePathFromModelData(d));
      return (dPath1 !== normalizedFilePath) && (dPath2 !== normalizedFilePath);
    });
    
    // Then add the new/updated entry
    pendingTagData.push(tagData);
    
    // Always deduplicate after update to ensure no duplicates
    // This is a final safeguard
    const beforeDedup = pendingTagData.length;
    pendingTagData = deduplicateModelData(pendingTagData);
    
    // Debug: log if we removed duplicates
    if (beforeCount !== pendingTagData.length || beforeDedup !== pendingTagData.length) {
      console.log(`updatePendingTagData: Removed duplicates for ${filePath}. Before: ${beforeCount}, After filter: ${pendingTagData.length + 1}, After dedup: ${pendingTagData.length}`);
    }
  }

  // Function to update the tag preview dialog (for real-time updates)
  function updateTagPreviewDialog() {
    if (!reviewDialogOpen) return;
    // CRITICAL: Always deduplicate before showing to prevent duplicates from rapid updates
    // This is especially important when multiple tags arrive quickly
    pendingTagData = deduplicateModelData(pendingTagData);
    // showTagPreviewDialog will use pendingTagData when dialog is open (ignores parameter)
    showTagPreviewDialog(pendingTagData);
  }

  window._electronRealEventHandlers['tags-generated'] = async function(filePath, tags, errorMessage) {
    try {
      // Check if there's a rate limit error
      if (errorMessage && errorMessage.includes('Rate limit')) {
        // Extract the detailed message if available (after "Rate limit exceeded: ")
        const detailedMessage = errorMessage.includes('Rate limit exceeded: ') 
          ? errorMessage.split('Rate limit exceeded: ')[1]
          : 'API rate limit has been exceeded. Please try again later.';
        
        // Only show dialog once per batch operation to prevent flooding
        const isBatchOperation = batchTagGenerationInProgress;
        if (!isBatchOperation || !rateLimitDialogShown) {
          await window.electron.showMessage('Rate Limit Exceeded', detailedMessage);
          if (isBatchOperation) {
            rateLimitDialogShown = true; // Mark as shown for this batch
          }
        }
        return;
      }
      
      // Fetch the current model data for the given filePath
      const model = await window.electron.getModel(filePath);
      if (!model) {
        console.error(`Model not found for ${filePath}`);
        return;
      }

      // Check if this is a batch operation (if review dialog is already open, it's batch)
      const isBatchOperation = batchTagGenerationInProgress;
      
      if (isBatchOperation) {
        // Store or update tag data for this model (even if tags are empty)
        const tagData = {
          filePath: filePath,
          model: model,
          generatedTags: tags || [],
          existingTags: model.tags || [],
          errorMessage: errorMessage || null
        };
        
        // Use helper function to update pendingTagData (ensures no duplicates)
        updatePendingTagData(filePath, tagData);
        
        // Update the review dialog in real-time (only while user still has it open)
        if (reviewDialogOpen) {
          updateTagPreviewDialog();
        }
      } else {
        // Single model operation - update existing dialog or show if not open
        const tagData = {
          filePath: filePath,
          model: model,
          generatedTags: tags || [],
          existingTags: model.tags || [],
          errorMessage: errorMessage || null
        };
        
        // Same merge as batch: normalized path dedupe (strict filePath compare missed Docker/UNC variants)
        updatePendingTagData(filePath, tagData);
        
        // Update the dialog if it's open, otherwise show it (unless user closed this run)
        if (reviewDialogOpen) {
          updateTagPreviewDialog();
        } else if (!suppressTagPreviewReopen) {
          showTagPreviewDialog(pendingTagData);
        }
        
        // Show message if no tags were generated (but don't block)
        if (!tags || tags.length === 0) {
          console.log(`No tags generated for ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`Error updating tags for model ${filePath}:`, error);
    }
  };
  if (window._electronPendingEvents['tags-generated']) {
    window._electronPendingEvents['tags-generated'].forEach((args) => {
      window._electronRealEventHandlers['tags-generated'].apply(null, args);
    });
    delete window._electronPendingEvents['tags-generated'];
  }

  window._electronRealEventHandlers['start-single-tag-generation'] = async function(filePath, modelData) {
    try {
      console.log('[Renderer] Received start-single-tag-generation event', filePath, modelData);
      batchTagGenerationInProgress = false;
      expectedBatchCount = 1;
      pendingTagData = [modelData];
      reviewDialogOpen = false; // Reset dialog state
      suppressTagPreviewReopen = false;
      rateLimitDialogShown = false; // Reset rate limit dialog flag
      // Deduplicate before showing (should be single item, but be safe)
      const uniquePendingData = deduplicateModelData(pendingTagData);
      console.log('[Renderer] About to call showTagPreviewDialog with:', uniquePendingData);
      console.log('[Renderer] showTagPreviewDialog exists:', typeof showTagPreviewDialog);
      
      // Ensure dialog opens even if showTagPreviewDialog has issues
      const dialog = document.getElementById('tag-preview-dialog');
      if (dialog && !dialog.open) {
        console.log('[Renderer] Opening tag preview dialog directly');
        dialog.showModal();
        reviewDialogOpen = true;
      }
      
      if (typeof showTagPreviewDialog === 'function') {
        showTagPreviewDialog(uniquePendingData);
      } else {
        console.error('[Renderer] showTagPreviewDialog is not a function!');
        // If function doesn't exist, at least show the dialog with basic content
        if (dialog && dialog.open) {
          const container = document.getElementById('tag-preview-container');
          if (container) {
            container.innerHTML = '<div style="padding: 20px; color: #fff;">Generating tags...</div>';
          }
        }
      }
    } catch (error) {
      console.error('[Renderer] Error in start-single-tag-generation handler:', error);
      // Try to open dialog anyway
      try {
        const dialog = document.getElementById('tag-preview-dialog');
        if (dialog && !dialog.open) {
          dialog.showModal();
          reviewDialogOpen = true;
        }
      } catch (dialogError) {
        console.error('[Renderer] Failed to open dialog:', dialogError);
      }
    }
  };
  if (window._electronPendingEvents['start-single-tag-generation']) {
    window._electronPendingEvents['start-single-tag-generation'].forEach((args) => {
      window._electronRealEventHandlers['start-single-tag-generation'].apply(null, args);
    });
    delete window._electronPendingEvents['start-single-tag-generation'];
  }

  window._electronRealEventHandlers['start-batch-tag-generation'] = async function(count, filePaths) {
    try {
      console.log('[Renderer] Received start-batch-tag-generation event', count, filePaths);
      batchTagGenerationInProgress = true;
      expectedBatchCount = count;
      pendingTagData = [];
      reviewDialogOpen = false;
      suppressTagPreviewReopen = false;
      rateLimitDialogShown = false; // Reset rate limit dialog flag for new batch
      
      // Ensure dialog opens immediately, even before loading models
      const dialog = document.getElementById('tag-preview-dialog');
      if (dialog && !dialog.open) {
        console.log('[Renderer] Opening tag preview dialog directly for batch');
        dialog.showModal();
        reviewDialogOpen = true;
      }
      
      // Pre-populate with all models so they appear immediately (deduplicate by normalized path to avoid duplicate entries)
      if (filePaths && filePaths.length > 0) {
        const seenPaths = new Set();
        for (const filePath of filePaths) {
          const norm = normalizeFilePath(filePath);
          if (!norm || seenPaths.has(norm)) continue;
          seenPaths.add(norm);
          try {
            const model = await window.electron.getModel(filePath);
            if (model) {
              pendingTagData.push({
                filePath: filePath,
                model: model,
                generatedTags: undefined, // Not generated yet
                existingTags: model.tags || []
              });
            }
          } catch (error) {
            console.error(`Error loading model ${filePath} for preview:`, error);
          }
        }
      }
      
      // Show the review dialog immediately with all models (some may show "Generating...")
      // Deduplicate before showing to prevent any duplicates
      const uniquePendingData = deduplicateModelData(pendingTagData);
      console.log('[Renderer] About to call showTagPreviewDialog with:', uniquePendingData.length, 'items');
      console.log('[Renderer] showTagPreviewDialog exists:', typeof showTagPreviewDialog);
      if (typeof showTagPreviewDialog === 'function') {
        if (uniquePendingData.length > 0) {
          showTagPreviewDialog(uniquePendingData);
        } else {
          showTagPreviewDialog([]);
        }
      } else {
        console.error('[Renderer] showTagPreviewDialog is not a function!');
        // If function doesn't exist, at least show the dialog with basic content
        if (dialog && dialog.open) {
          const container = document.getElementById('tag-preview-container');
          if (container) {
            container.innerHTML = `<div style="padding: 20px; color: #fff;">Generating tags for ${count} model(s)...</div>`;
          }
        }
      }
    } catch (error) {
      console.error('[Renderer] Error in start-batch-tag-generation handler:', error);
      // Try to open dialog anyway
      try {
        const dialog = document.getElementById('tag-preview-dialog');
        if (dialog && !dialog.open) {
          dialog.showModal();
          reviewDialogOpen = true;
          const container = document.getElementById('tag-preview-container');
          if (container) {
            container.innerHTML = '<div style="padding: 20px; color: #fff;">Error loading tag preview. Tags are still being generated...</div>';
          }
        }
      } catch (dialogError) {
        console.error('[Renderer] Failed to open dialog:', dialogError);
      }
    }
  };
  if (window._electronPendingEvents['start-batch-tag-generation']) {
    window._electronPendingEvents['start-batch-tag-generation'].forEach((args) => {
      window._electronRealEventHandlers['start-batch-tag-generation'].apply(null, args);
    });
    delete window._electronPendingEvents['start-batch-tag-generation'];
  }

  window._electronRealEventHandlers['batch-tag-generation-complete'] = async function() {
    batchTagGenerationInProgress = false;
    rateLimitDialogShown = false; // Reset rate limit dialog flag when batch completes
    
    // Wait a tiny bit to ensure all pending tag updates have completed
    // This prevents race conditions where the last tag update hasn't finished
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Update the dialog one final time to show completion status
    // CRITICAL: Ensure pendingTagData is fully deduplicated before final refresh
    if (reviewDialogOpen && pendingTagData.length > 0) {
      // Debug: Log before deduplication
      console.log('batch-tag-generation-complete: Before dedup, pendingTagData has', pendingTagData.length, 'entries');
      pendingTagData.forEach((d, i) => {
        const path = getFilePathFromModelData(d);
        const hasTags = d.generatedTags !== undefined && d.generatedTags.length > 0;
        const isGenerating = d.generatedTags === undefined;
        console.log(`  [${i}] ${path}: hasTags=${hasTags}, isGenerating=${isGenerating}, tags=${d.generatedTags?.length || 0}`);
      });
      
      // Force deduplication one more time before final update
      // This ensures no duplicates from rapid tag generation events
      const beforeCount = pendingTagData.length;
      pendingTagData = deduplicateModelData(pendingTagData);
      const afterCount = pendingTagData.length;
      
      if (beforeCount !== afterCount) {
        console.log(`batch-tag-generation-complete: Removed ${beforeCount - afterCount} duplicates. Now have ${afterCount} entries`);
      }
      
      // Use showTagPreviewDialog directly with the deduplicated data
      // Don't call updateTagPreviewDialog which might use stale data
      showTagPreviewDialog(pendingTagData);
    }
    
    // Don't auto-close - let the user review what happened (even if no tags)
    // They can see which models failed and which succeeded
  };
  if (window._electronPendingEvents['batch-tag-generation-complete']) {
    window._electronPendingEvents['batch-tag-generation-complete'].forEach((args) => {
      window._electronRealEventHandlers['batch-tag-generation-complete'].apply(null, args);
    });
    delete window._electronPendingEvents['batch-tag-generation-complete'];
  }

  // Function to show tag preview dialog (now handles multiple models)
  function showTagPreviewDialog(modelsData) {
    const dialog = document.getElementById('tag-preview-dialog');
    const container = document.getElementById('tag-preview-container');
    const modelInfoEl = document.getElementById('tag-preview-model-info');
    
    if (!dialog || !container) {
      console.error('Tag preview dialog elements not found');
      return;
    }

    const renderGeneration = ++tagPreviewDialogRenderGeneration;

    // Check if dialog is open BEFORE we use it (fix race condition)
    const isDialogOpen = dialog.open || false;
    reviewDialogOpen = isDialogOpen;

    // When dialog is already open, ALWAYS use pendingTagData as the single source of truth
    // This prevents stale data from being displayed and ensures consistency
    let dataToDeduplicate;
    if (isDialogOpen) {
      // Dialog is open - ONLY use pendingTagData (ignore passed parameter)
      // pendingTagData is already updated by updatePendingTagData before this is called
      dataToDeduplicate = pendingTagData;
    } else {
      // Dialog not open yet - use passed data (first time opening)
      dataToDeduplicate = modelsData;
    }
    
    // Deduplicate models by filePath - prefer entries with actual tags over "Generating..." entries
    const beforeDedup = dataToDeduplicate.length;
    const uniqueModelsData = deduplicateModelData(dataToDeduplicate);
    const afterDedup = uniqueModelsData.length;
    
    // Debug: Log if duplicates were found
    if (beforeDedup !== afterDedup) {
      console.log(`showTagPreviewDialog: Found ${beforeDedup - afterDedup} duplicates. Before: ${beforeDedup}, After: ${afterDedup}`);
      // Log what was removed
      const removed = dataToDeduplicate.filter(d1 => {
        const path1 = normalizeFilePath(getFilePathFromModelData(d1));
        return !uniqueModelsData.some(d2 => {
          const path2 = normalizeFilePath(getFilePathFromModelData(d2));
          return path1 === path2;
        });
      });
      removed.forEach(d => {
        const path = getFilePathFromModelData(d);
        console.log(`  Removed duplicate: ${path}, hasTags=${d.generatedTags?.length > 0}, isGenerating=${d.generatedTags === undefined}`);
      });
    }
    
    // Update pendingTagData to match what we're showing (single source of truth)
    pendingTagData = uniqueModelsData;

    // Hide single model info, show batch info if multiple models
    if (uniqueModelsData.length === 1) {
      // Single model - show model info
      if (modelInfoEl) {
        modelInfoEl.style.display = 'block';
        const model = uniqueModelsData[0].model;
        const modelNameEl = document.getElementById('tag-preview-model-name');
        const modelPathEl = document.getElementById('tag-preview-model-path');
        
        if (modelNameEl && modelPathEl) {
          const fileName = model.fileName || model.filePath?.split(/[/\\]/).pop() || 'Unknown';
          const filePath = model.filePath || 'Unknown path';
          
          modelNameEl.textContent = fileName;
          modelPathEl.textContent = filePath;
        }
      }
    } else {
      // Multiple models - hide single model info
      if (modelInfoEl) {
        modelInfoEl.style.display = 'none';
      }
    }

    // Save checkbox states before clearing (to preserve user selections when dialog is updated)
    const checkboxStates = new Map();
    if (container) {
      const existingCheckboxes = container.querySelectorAll('input[type="checkbox"]');
      console.log(`Saving checkbox states: found ${existingCheckboxes.length} checkboxes`);
      existingCheckboxes.forEach(checkbox => {
        const filePath = checkbox.dataset.filePath;
        const tagValue = checkbox.value;
        if (filePath && tagValue) {
          const key = `${filePath}::${tagValue}`;
          checkboxStates.set(key, checkbox.checked);
          if (checkbox.checked) {
            console.log(`Saved checked state for: ${key}`);
          }
        } else {
          console.warn(`Checkbox missing filePath or value:`, { filePath, tagValue, checked: checkbox.checked });
        }
      });
      console.log(`Total checkbox states saved: ${checkboxStates.size}`);
    }

    // Clear container completely to prevent duplicates
    container.innerHTML = '';

    // Open dialog immediately (before loading settings) so it appears in desktop mode
    if (!dialog.open) {
      dialog.showModal();
      reviewDialogOpen = true;
    }

    // Get merge strategy from settings
    window.electron.getSetting('aiTagMergeStrategy').then((strategy) => {
      if (renderGeneration !== tagPreviewDialogRenderGeneration) {
        return;
      }
      if (!dialog.open) {
        return;
      }

      const mergeStrategy = strategy || 'merge';

      // Clear again here: overlapping showTagPreviewDialog calls only cleared synchronously earlier;
      // without this, each resolved callback would append another full model list.
      container.innerHTML = '';

      // Final deduplication check before rendering - use a Set to track rendered filePaths
      const renderedPaths = new Set();
      const finalUniqueModels = [];
      
      for (const modelData of uniqueModelsData) {
        const filePath = getFilePathFromModelData(modelData);
        if (!filePath) continue;
        
        const normalizedPath = normalizeFilePath(filePath);
        if (!renderedPaths.has(normalizedPath)) {
          renderedPaths.add(normalizedPath);
          finalUniqueModels.push(modelData);
        } else {
          console.warn(`[Tag Preview] Skipping duplicate model: ${filePath}`);
        }
      }
      
      if (finalUniqueModels.length !== uniqueModelsData.length) {
        console.log(`[Tag Preview] Final deduplication: ${uniqueModelsData.length} -> ${finalUniqueModels.length} models`);
      }

      // Create a container for multiple models (scrolling handled by parent)
      const modelsContainer = document.createElement('div');

      // Process each model - use for...of to support async operations
      for (const [index, modelData] of finalUniqueModels.entries()) {
        const { model, generatedTags, existingTags, errorMessage } = modelData;
        const fileName = model.fileName || model.filePath?.split(/[/\\]/).pop() || 'Unknown';
        const filePath = model.filePath || 'Unknown path';

        // Create model section with unique ID to prevent duplicate rendering
        const normalizedModelPath = normalizeFilePath(model.filePath);
        const existingSection = modelsContainer.querySelector(`[data-normalized-path="${normalizedModelPath}"]`);
        if (existingSection) {
          console.warn(`[Tag Preview] Skipping duplicate model section for: ${model.filePath}`);
          continue; // Skip if this model section already exists
        }
        
        const modelSection = document.createElement('div');
        modelSection.style.marginBottom = '25px';
        modelSection.style.padding = '15px';
        modelSection.style.backgroundColor = '#2a2a2a';
        modelSection.style.border = '1px solid #444';
        modelSection.style.borderRadius = '8px';
        modelSection.dataset.filePath = model.filePath;
        modelSection.dataset.normalizedPath = normalizedModelPath;

        // Model header with thumbnail
        const modelHeader = document.createElement('div');
        modelHeader.style.display = 'flex';
        modelHeader.style.gap = '12px';
        modelHeader.style.marginBottom = '12px';
        modelHeader.style.paddingBottom = '10px';
        modelHeader.style.borderBottom = '1px solid #444';
        
        // Thumbnail
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.style.flexShrink = '0';
        thumbnailContainer.style.width = '80px';
        thumbnailContainer.style.height = '80px';
        thumbnailContainer.style.backgroundColor = '#1a1a1a';
        thumbnailContainer.style.border = '1px solid #444';
        thumbnailContainer.style.borderRadius = '6px';
        thumbnailContainer.style.overflow = 'hidden';
        thumbnailContainer.style.display = 'flex';
        thumbnailContainer.style.alignItems = 'center';
        thumbnailContainer.style.justifyContent = 'center';
        
        const thumbnailImg = document.createElement('img');
        
        // Handle thumbnail loading - especially for 3MF files which may have thumbnails stored differently
        let thumbnailSrc = null;
        
        if (model.thumbnail) {
          // Check if it's a delimited string (multiple thumbnails)
          if (model.thumbnail.includes('::')) {
            const thumbnails = model.thumbnail.split('::').filter(t => 
              t && t !== '3d.png' && t.length > 0 && t.startsWith('data:image')
            );
            thumbnailSrc = thumbnails.length > 0 ? thumbnails[0] : null;
          } else if (model.thumbnail !== '3d.png' && model.thumbnail.startsWith('data:image')) {
            // Single thumbnail
            thumbnailSrc = model.thumbnail;
          }
        }
        
        // For 3MF files, try to get primary thumbnail from database if not found in model.thumbnail
        // Load asynchronously to avoid blocking — never getAllThumbnails for a single display slot
        (async () => {
          if (!thumbnailSrc && model.filePath && model.filePath.toLowerCase().endsWith('.3mf')) {
            try {
              const primary = await fetchPrimaryThumbnailForGrid(model.filePath);
              if (primary) {
                thumbnailSrc = primary;
                thumbnailImg.src = thumbnailSrc;
                thumbnailImg.style.width = '100%';
                thumbnailImg.style.height = '100%';
                thumbnailImg.style.objectFit = 'cover';
              }
            } catch (e) {
              console.log('Could not fetch 3MF thumbnail from database:', e);
            }
          }
        })();
        
        if (thumbnailSrc) {
          thumbnailImg.src = thumbnailSrc;
          thumbnailImg.style.width = '100%';
          thumbnailImg.style.height = '100%';
          thumbnailImg.style.objectFit = 'cover';
          thumbnailImg.onerror = () => {
            // If image fails to load, show placeholder
            thumbnailImg.style.width = '40px';
            thumbnailImg.style.height = '40px';
            thumbnailImg.style.opacity = '0.3';
            thumbnailImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>';
          };
        } else {
          thumbnailImg.style.width = '40px';
          thumbnailImg.style.height = '40px';
          thumbnailImg.style.opacity = '0.3';
          thumbnailImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>';
        }
        thumbnailContainer.appendChild(thumbnailImg);
        
        // Model info
        const modelInfo = document.createElement('div');
        modelInfo.style.flex = '1';
        modelInfo.style.minWidth = '0';
        modelInfo.innerHTML = `
          <div style="color: #4a9eff; font-weight: 600; font-size: 15px; margin-bottom: 4px;">${fileName}</div>
          <div style="color: #999; font-size: 12px; word-break: break-all;">${filePath}</div>
        `;
        
        modelHeader.appendChild(thumbnailContainer);
        modelHeader.appendChild(modelInfo);
        modelSection.appendChild(modelHeader);

        // Existing tags
        if (existingTags.length > 0) {
          const existingDiv = document.createElement('div');
          existingDiv.style.marginBottom = '12px';
          existingDiv.innerHTML = `<div style="color: #aaa; font-size: 12px; margin-bottom: 6px;">Existing tags (${existingTags.length}):</div>` +
            `<div style="color: #ccc; line-height: 1.6;">${existingTags.map(t => `<span style="display: inline-block; background: #3a3a3a; padding: 3px 6px; margin: 2px; border-radius: 4px; font-size: 12px;">${t}</span>`).join('')}</div>`;
          modelSection.appendChild(existingDiv);
        }

        // Generated tags with checkboxes
        if (generatedTags && generatedTags.length > 0) {
          const generatedDiv = document.createElement('div');
          generatedDiv.style.color = '#fff';
          generatedDiv.style.fontWeight = '600';
          generatedDiv.style.marginBottom = '10px';
          generatedDiv.style.fontSize = '13px';
          generatedDiv.innerHTML = `Generated tags (${generatedTags.length}):`;
          modelSection.appendChild(generatedDiv);

          const tagList = document.createElement('div');
          tagList.style.display = 'flex';
          tagList.style.flexWrap = 'wrap';
          tagList.style.gap = '8px';
          tagList.style.marginBottom = '10px';

          generatedTags.forEach(tag => {
            const tagItem = document.createElement('label');
            tagItem.style.display = 'inline-flex';
            tagItem.style.alignItems = 'center';
            tagItem.style.padding = '6px 10px';
            tagItem.style.backgroundColor = '#3a3a3a';
            tagItem.style.border = '1px solid #555';
            tagItem.style.borderRadius = '6px';
            tagItem.style.cursor = 'pointer';
            tagItem.style.userSelect = 'none';
            tagItem.style.color = '#fff';
            tagItem.style.transition = 'all 0.2s ease';
            tagItem.style.fontSize = '13px';

            // Hover effect
            tagItem.addEventListener('mouseenter', () => {
              tagItem.style.backgroundColor = '#4a4a4a';
              tagItem.style.borderColor = '#666';
            });
            tagItem.addEventListener('mouseleave', () => {
              tagItem.style.backgroundColor = '#3a3a3a';
              tagItem.style.borderColor = '#555';
            });

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            // Restore checked state if it was previously set, otherwise default to true
            const stateKey = `${model.filePath}::${tag}`;
            const wasChecked = checkboxStates.has(stateKey) ? checkboxStates.get(stateKey) : true;
            checkbox.checked = wasChecked;
            if (!wasChecked && checkboxStates.has(stateKey)) {
              console.log(`Restored unchecked state for: ${stateKey}`);
            } else if (wasChecked && checkboxStates.has(stateKey)) {
              console.log(`Restored checked state for: ${stateKey}`);
            }
            checkbox.value = tag;
            checkbox.dataset.filePath = model.filePath;
            checkbox.style.marginRight = '6px';
            checkbox.style.width = '14px';
            checkbox.style.height = '14px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.accentColor = '#4a9eff';

            const tagText = document.createElement('span');
            tagText.textContent = tag;
            tagText.style.color = '#fff';

            tagItem.appendChild(checkbox);
            tagItem.appendChild(tagText);
            tagList.appendChild(tagItem);
          });

          modelSection.appendChild(tagList);

          // Add Select All / Clear Selection buttons
          const buttonContainer = document.createElement('div');
          buttonContainer.style.display = 'flex';
          buttonContainer.style.gap = '12px';
          buttonContainer.style.marginTop = '8px';

          const selectAllBtn = document.createElement('button');
          selectAllBtn.textContent = 'Select All';
          selectAllBtn.style.background = 'none';
          selectAllBtn.style.border = 'none';
          selectAllBtn.style.color = '#fff';
          selectAllBtn.style.cursor = 'pointer';
          selectAllBtn.style.fontSize = '13px';
          selectAllBtn.style.padding = '4px 0';
          selectAllBtn.style.textDecoration = 'underline';
          selectAllBtn.style.textUnderlineOffset = '2px';
          selectAllBtn.addEventListener('mouseenter', () => {
            selectAllBtn.style.opacity = '0.7';
          });
          selectAllBtn.addEventListener('mouseleave', () => {
            selectAllBtn.style.opacity = '1';
          });
          selectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const checkboxes = tagList.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = true);
          });

          const clearSelectionBtn = document.createElement('button');
          clearSelectionBtn.textContent = 'Clear Selection';
          clearSelectionBtn.style.background = 'none';
          clearSelectionBtn.style.border = 'none';
          clearSelectionBtn.style.color = '#fff';
          clearSelectionBtn.style.cursor = 'pointer';
          clearSelectionBtn.style.fontSize = '13px';
          clearSelectionBtn.style.padding = '4px 0';
          clearSelectionBtn.style.textDecoration = 'underline';
          clearSelectionBtn.style.textUnderlineOffset = '2px';
          clearSelectionBtn.addEventListener('mouseenter', () => {
            clearSelectionBtn.style.opacity = '0.7';
          });
          clearSelectionBtn.addEventListener('mouseleave', () => {
            clearSelectionBtn.style.opacity = '1';
          });
          clearSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const checkboxes = tagList.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
          });

          buttonContainer.appendChild(selectAllBtn);
          buttonContainer.appendChild(clearSelectionBtn);
          modelSection.appendChild(buttonContainer);
        } else {
          // Show status for models with no tags
          const noTagsDiv = document.createElement('div');
          noTagsDiv.style.color = '#888';
          noTagsDiv.style.fontSize = '13px';
          noTagsDiv.style.fontStyle = 'italic';
          noTagsDiv.style.padding = '8px';
          noTagsDiv.style.backgroundColor = '#1a1a1a';
          noTagsDiv.style.borderRadius = '4px';
          noTagsDiv.style.border = '1px solid #333';
          
          // Check if tags are still being generated (undefined) vs failed (empty array)
          if (generatedTags === undefined) {
            noTagsDiv.textContent = 'Generating tags...';
            noTagsDiv.style.color = '#aaa';
          } else if (errorMessage && errorMessage.includes('Rate limit')) {
            // Show rate limit error message
            const detailedMessage = errorMessage.includes('Rate limit exceeded: ') 
              ? errorMessage.split('Rate limit exceeded: ')[1]
              : 'API rate limit has been exceeded. Please try again later.';
            noTagsDiv.textContent = `Rate limit exceeded: ${detailedMessage}`;
            noTagsDiv.style.color = '#ff6b6b';
            noTagsDiv.style.fontStyle = 'normal';
            noTagsDiv.style.border = '1px solid #ff6b6b';
          } else {
            noTagsDiv.textContent = 'No tags generated for this model';
            noTagsDiv.style.color = '#888';
          }
          modelSection.appendChild(noTagsDiv);
        }

        modelsContainer.appendChild(modelSection);
      }

      container.appendChild(modelsContainer);

      // Show merge strategy info (only once at the bottom)
      // Remove any existing strategy info first to prevent duplicates
      const existingStrategyInfo = container.querySelector('#tag-preview-merge-strategy');
      if (existingStrategyInfo) {
        existingStrategyInfo.remove();
      }
      
      const strategyInfo = document.createElement('div');
      strategyInfo.id = 'tag-preview-merge-strategy';
      strategyInfo.style.marginTop = '15px';
      strategyInfo.style.padding = '12px';
      strategyInfo.style.backgroundColor = '#2a3a4a';
      strategyInfo.style.border = '1px solid #4a5a6a';
      strategyInfo.style.borderRadius = '6px';
      strategyInfo.style.fontSize = '0.9em';
      strategyInfo.innerHTML = `<div style="color: #fff; font-weight: 600; margin-bottom: 6px;">Merge Strategy: <span style="color: #4a9eff;">${mergeStrategy}</span></div>` +
        `<div style="color: #bbb; line-height: 1.5;">${getMergeStrategyDescription(mergeStrategy)}</div>`;
      container.appendChild(strategyInfo);

      // Enable/disable Apply button based on whether tags are generated
      const applyButton = document.getElementById('tag-preview-apply');
      if (applyButton) {
        // Check if any models are still generating tags (generatedTags === undefined)
        const stillGenerating = uniqueModelsData.some(modelData => modelData.generatedTags === undefined);
        
        if (stillGenerating) {
          // Disable button if tags are still being generated
          applyButton.disabled = true;
          applyButton.style.opacity = '0.5';
          applyButton.style.cursor = 'not-allowed';
          applyButton.title = 'Please wait for tags to finish generating';
        } else {
          // Enable button if all tags are generated (even if empty arrays)
          applyButton.disabled = false;
          applyButton.style.opacity = '1';
          applyButton.style.cursor = 'pointer';
          applyButton.title = '';
        }
      }

      // Update dialog title for multiple models
      const dialogTitle = dialog.querySelector('h3');
      if (dialogTitle) {
        const modelCount = pendingTagData.length;
        if (modelCount > 1 || batchTagGenerationInProgress) {
          const completedCount = pendingTagData.filter(d => d.generatedTags !== undefined).length;
          const tagsGeneratedCount = pendingTagData.filter(d => d.generatedTags && d.generatedTags.length > 0).length;
          let status = '';
          if (batchTagGenerationInProgress) {
            status = `(${completedCount}/${expectedBatchCount || modelCount} processed, ${tagsGeneratedCount} with tags)`;
          } else {
            status = `(${modelCount} models, ${tagsGeneratedCount} with tags)`;
          }
          dialogTitle.textContent = `Review Generated Tags ${status}`;
        } else {
          dialogTitle.textContent = 'Review Generated Tags';
        }
      }

    });
  }

  // Get description for merge strategy
  function getMergeStrategyDescription(strategy) {
    switch (strategy) {
      case 'merge':
        return 'Selected tags will be added to existing tags (duplicates removed)';
      case 'append':
        return 'Only new tags not already present will be added';
      case 'replace':
        return 'Existing tags will be replaced with selected tags';
      default:
        return 'Selected tags will be merged with existing tags';
    }
  }

  // Function to apply tags to model
  async function applyTagsToModel(filePath, selectedTags, existingTags, mergeStrategy) {
    try {
      const model = await window.electron.getModel(filePath);
      if (!model) {
        console.error(`Model not found for ${filePath}`);
        return;
      }

      let finalTags = [];

      switch (mergeStrategy) {
        case 'replace':
          // Replace all tags with selected tags
          finalTags = [...selectedTags, "AI Tagged"];
          break;
        case 'append':
          // Only add tags that don't already exist
          const existingSet = new Set(existingTags.map(t => t.toLowerCase()));
          finalTags = [...existingTags];
          selectedTags.forEach(tag => {
            if (!existingSet.has(tag.toLowerCase())) {
              finalTags.push(tag);
            }
          });
          finalTags.push("AI Tagged");
          break;
        case 'merge':
        default:
          // Merge all tags, removing duplicates
          finalTags = Array.from(new Set([...existingTags, ...selectedTags, "AI Tagged"]));
          break;
      }

      // Update the model data with the new tag list
      await window.electron.saveModel({ ...model, tags: finalTags });

      // Update the model element in the grid/UI
      await updateModelElement(filePath);
      
      // Refresh the tags in the Edit Model Details view if it's showing the current model
      const currentModelPath = getCurrentModelFilePath();
      if (currentModelPath === filePath) {
        await loadModelTags(filePath);
      }

      console.log(`Tags updated for model: ${filePath}`);
    } catch (error) {
      console.error(`Error applying tags to model ${filePath}:`, error);
      throw error;
    }
  }

  // Tag preview dialog handlers
  document.getElementById('tag-preview-apply')?.addEventListener('click', async () => {
    if (!pendingTagData || pendingTagData.length === 0) {
      console.error('No pending tag data');
      await window.electron.showMessage('Info', 'No models to process.');
      return;
    }

    const container = document.getElementById('tag-preview-container');
    if (!container) {
      console.error('Tag preview container not found');
      await window.electron.showMessage('Error', 'Tag preview container not found');
      return;
    }
    
    const mergeStrategy = await window.electron.getSetting('aiTagMergeStrategy') || 'merge';

    let successCount = 0;
    let failCount = 0;
    let totalTagsApplied = 0;

    try {
      // Debug: Log all model sections in container
      const allSectionsInContainer = container.querySelectorAll('div[data-file-path]');
      console.log(`\n=== Starting tag application ===`);
      console.log(`Total model sections found in container: ${allSectionsInContainer.length}`);
      console.log('Section file paths:', Array.from(allSectionsInContainer).map(s => s.dataset.filePath));
      console.log(`Total models in pendingTagData: ${pendingTagData.length}`);
      console.log('Pending tag data file paths:', pendingTagData.map(d => d.model?.filePath || d.filePath));
      console.log('Pending tag data structure:', pendingTagData.map(d => ({
        hasModel: !!d.model,
        filePath: d.filePath,
        modelFilePath: d.model?.filePath,
        generatedTagsCount: d.generatedTags?.length || 0,
        hasGeneratedTags: !!(d.generatedTags && d.generatedTags.length > 0)
      })));
      
      // Build models to process from DOM sections (source of truth) instead of pendingTagData
      // This ensures we process all visible models even if pendingTagData is incomplete
      const modelsToProcess = [];
      const processedFilePaths = new Set(); // Track duplicates
      
      for (const section of allSectionsInContainer) {
        const filePath = section.dataset.filePath;
        if (!filePath) {
          console.warn('Found section without file path, skipping');
          continue;
        }
        
        // Skip duplicates (some models might appear twice in the DOM)
        if (processedFilePaths.has(filePath)) {
          console.log(`Skipping duplicate model: ${filePath}`);
          continue;
        }
        processedFilePaths.add(filePath);
        
        // Try to find corresponding data in pendingTagData for existing tags info
        const modelData = pendingTagData.find(d => 
          (d.model?.filePath === filePath) || (d.filePath === filePath)
        );
        
        modelsToProcess.push({
          filePath: filePath,
          section: section,
          existingTags: modelData?.existingTags || [],
          modelData: modelData // Keep reference for any other needed data
        });
      }
      
      console.log(`Will process ${modelsToProcess.length} models from DOM sections`);
      console.log(`pendingTagData has ${pendingTagData.length} models`);
      
      if (modelsToProcess.length !== pendingTagData.length) {
        console.warn(`Mismatch: DOM has ${modelsToProcess.length} models, pendingTagData has ${pendingTagData.length}`);
        console.warn('Processing all models from DOM (source of truth)');
      }
      
      // Filter models that have selected tags before processing
      const modelsWithTags = [];
      for (const modelInfo of modelsToProcess) {
        const targetFilePath = modelInfo.filePath;
        const modelSection = modelInfo.section;
        
        // Get selected tags for this specific model from within its section
        let allCheckboxes = modelSection.querySelectorAll('input[type="checkbox"]');
        let checkedCheckboxes = modelSection.querySelectorAll('input[type="checkbox"]:checked');
        
        // Fallback: if no checkboxes found in section, try finding by filePath in entire container
        if (allCheckboxes.length === 0) {
          try {
            const escapedPath = targetFilePath.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
            const fallbackCheckboxes = container.querySelectorAll(`input[type="checkbox"][data-file-path="${escapedPath}"]`);
            if (fallbackCheckboxes.length > 0) {
              allCheckboxes = fallbackCheckboxes;
              checkedCheckboxes = container.querySelectorAll(`input[type="checkbox"][data-file-path="${escapedPath}"]:checked`);
            }
          } catch (e) {
            // Try alternative fallback
            const allCheckboxesInContainer = container.querySelectorAll('input[type="checkbox"]');
            const matchingCheckboxes = Array.from(allCheckboxesInContainer).filter(cb => 
              cb.dataset.filePath === targetFilePath ||
              (modelInfo.modelData?.model?.filePath && cb.dataset.filePath === modelInfo.modelData.model.filePath) ||
              (modelInfo.modelData?.filePath && cb.dataset.filePath === modelInfo.modelData.filePath)
            );
            if (matchingCheckboxes.length > 0) {
              allCheckboxes = matchingCheckboxes;
              checkedCheckboxes = matchingCheckboxes.filter(cb => cb.checked);
            }
          }
        }
        
        const selectedTags = Array.from(checkedCheckboxes).map(cb => cb.value);
        
        if (selectedTags.length > 0) {
          modelsWithTags.push({
            ...modelInfo,
            selectedTags: selectedTags
          });
        }
      }
      
      if (modelsWithTags.length === 0) {
        const allCheckedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
        if (allCheckedBoxes.length === 0) {
          await window.electron.showMessage('Info', 'No tags were selected to apply.');
        } else {
          await window.electron.showMessage('Warning', 'Tags were selected but could not be applied. Please check the console for details.');
        }
        document.getElementById('tag-preview-dialog').close();
        pendingTagData = [];
        return;
      }
      
      // Show progress dialog
      const progressDialog = document.getElementById('progress-dialog');
      const progressTitle = document.getElementById('progress-title');
      const progressMessage = document.getElementById('progress-message');
      const progressBar = document.getElementById('progress-bar');
      const progressStatus = document.getElementById('progress-status');
      
      if (progressDialog && progressTitle && progressMessage && progressBar && progressStatus) {
        progressTitle.textContent = 'Applying Tags';
        progressMessage.textContent = 'Processing models...';
        progressBar.style.width = '0%';
        progressStatus.textContent = `0 / ${modelsWithTags.length}`;
        progressDialog.showModal();
      }
      
      // Process models in parallel batches (5 at a time)
      const BATCH_SIZE = 5;
      let processedCount = 0;
      
      for (let i = 0; i < modelsWithTags.length; i += BATCH_SIZE) {
        const batch = modelsWithTags.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (modelInfo) => {
          const targetFilePath = modelInfo.filePath;
          const selectedTags = modelInfo.selectedTags;
          
          try {
            console.log(`Applying ${selectedTags.length} tags to model: ${targetFilePath}`);
            await applyTagsToModel(
              targetFilePath,
              selectedTags,
              modelInfo.existingTags || [],
              mergeStrategy
            );
            
            processedCount++;
            const fileName = targetFilePath.split(/[/\\]/).pop() || targetFilePath;
            
            // Update progress
            if (progressDialog && progressMessage && progressBar && progressStatus) {
              const percentage = (processedCount / modelsWithTags.length) * 100;
              progressBar.style.width = `${percentage}%`;
              progressMessage.textContent = `Processing: ${fileName}`;
              progressStatus.textContent = `${processedCount} / ${modelsWithTags.length}`;
            }
            
            successCount++;
            totalTagsApplied += selectedTags.length;
            console.log(`Successfully applied tags to ${targetFilePath}`);
            return { success: true, filePath: targetFilePath, tagsCount: selectedTags.length };
          } catch (error) {
            processedCount++;
            console.error(`Error applying tags to ${targetFilePath}:`, error);
            failCount++;
            
            // Update progress even on error
            if (progressDialog && progressBar && progressStatus) {
              const percentage = (processedCount / modelsWithTags.length) * 100;
              progressBar.style.width = `${percentage}%`;
              progressStatus.textContent = `${processedCount} / ${modelsWithTags.length}`;
            }
            
            return { success: false, filePath: targetFilePath, error: error.message };
          }
        });
        
        // Wait for batch to complete before starting next batch
        await Promise.all(batchPromises);
      }
      
      // Close progress dialog
      if (progressDialog) {
        progressDialog.close();
      }
      
      console.log(`\n=== Finished processing all models ===`);
      console.log(`Total processed: ${processedCount}, Success: ${successCount}, Failed: ${failCount}, Total tags: ${totalTagsApplied}`);

      // Show results
      if (successCount > 0) {
        const message = failCount > 0
          ? `Tags applied to ${successCount} model(s) (${failCount} failed). ${totalTagsApplied} tag(s) applied.`
          : `Tags applied successfully to ${successCount} model(s)! ${totalTagsApplied} tag(s) applied.`;
        await window.electron.showMessage('Success', message);
        
        // Refresh the tag filter dropdown to include any new tags
        await populateTagFilter();
      } else if (totalTagsApplied === 0) {
        // Only show "no tags selected" if we actually processed models but found no selected tags
        // Check if we have any checked checkboxes at all in the container
        const allCheckedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
        if (allCheckedBoxes.length === 0) {
          await window.electron.showMessage('Info', 'No tags were selected to apply.');
        } else {
          // Tags were checked but couldn't be applied - show different message
          await window.electron.showMessage('Warning', 'Tags were selected but could not be applied. Please check the console for details.');
        }
      }

      document.getElementById('tag-preview-dialog').close();
      pendingTagData = [];
    } catch (error) {
      console.error('Error applying tags:', error);
      await window.electron.showMessage('Error', 'Failed to apply tags: ' + error.message);
    }
  });

  document.getElementById('tag-preview-dialog')?.addEventListener('close', () => {
    suppressTagPreviewReopen = true;
    reviewDialogOpen = false;
    pendingTagData = [];
    batchTagGenerationInProgress = false;
    rateLimitDialogShown = false;
  });

  document.getElementById('tag-preview-cancel')?.addEventListener('click', () => {
    document.getElementById('tag-preview-dialog')?.close();
  });
  
  // Add handlers for progress dialog
  window.electron.on('show-progress-dialog', (data) => {
    const progressDialog = document.getElementById('progress-dialog');
    const progressTitle = document.getElementById('progress-title');
    const progressMessage = document.getElementById('progress-message');
    const progressBar = document.getElementById('progress-bar');
    const progressStatus = document.getElementById('progress-status');
    
    // Set initial values
    progressTitle.textContent = data.title || 'Processing...';
    progressMessage.textContent = data.message || 'Please wait...';
    progressBar.style.width = '0%';
    progressStatus.textContent = `0 / ${data.total}`;
    
    // Show the dialog
    progressDialog.showModal();
  });
  
  window.electron.on('update-progress', (data) => {
    const progressBar = document.getElementById('progress-bar');
    const progressMessage = document.getElementById('progress-message');
    const progressStatus = document.getElementById('progress-status');
    
    // Update progress bar
    const percentage = (data.current / data.total) * 100;
    progressBar.style.width = `${percentage}%`;
    
    // Update message and status
    if (data.message) {
      progressMessage.textContent = data.message;
    }
    progressStatus.textContent = `${data.current} / ${data.total}`;
  });
  
  window.electron.on('close-progress-dialog', () => {
    const progressDialog = document.getElementById('progress-dialog');
    progressDialog.close();
  });

  // Listen for tag generation progress updates and update a progress bar
  window.electron.on('tag-generation-progress', (completed, total) => {
    // Assume an element with id "ai-tag-progress" exists in the DOM.
    let progressContainer = document.getElementById('ai-tag-progress');
    if (!progressContainer) {
      // If not, create one dynamically and append it to the main-content or body.
      progressContainer = document.createElement('div');
      progressContainer.id = 'ai-tag-progress';
      progressContainer.style.position = 'fixed';
      progressContainer.style.top = '10px';
      progressContainer.style.right = '10px';
      progressContainer.style.width = '300px';
      progressContainer.style.height = '30px';
      progressContainer.style.background = '#444';
      progressContainer.style.borderRadius = '5px';
      progressContainer.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
      progressContainer.style.zIndex = '10000';

      // Create an inner progress bar element
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.style.height = '100%';
      progressBar.style.width = '0%';
      progressBar.style.background = '#4a9eff';
      progressBar.style.transition = 'width 0.2s ease';

      // Create a text overlay
      const progressText = document.createElement('span');
      progressText.className = 'progress-text';
      progressText.style.position = 'absolute';
      progressText.style.top = '50%';
      progressText.style.left = '50%';
      progressText.style.transform = 'translate(-50%, -50%)';
      progressText.style.color = '#fff';
      progressText.style.fontSize = '14px';

      progressContainer.appendChild(progressBar);
      progressContainer.appendChild(progressText);
      document.body.appendChild(progressContainer);
    }

    // Update the progress bar based on the completed progress.
    const progressBar = progressContainer.querySelector('.progress-bar');
    const progressText = progressContainer.querySelector('.progress-text');
    const percent = Math.floor((completed / total) * 100);
    progressBar.style.width = percent + '%';
    progressText.textContent = `${completed} / ${total}`;

    // If complete, hide the progress bar after a short delay.
    if (completed === total) {
      setTimeout(() => {
        progressContainer.style.display = 'none';
      }, 1000);
    } else {
      progressContainer.style.display = 'block';
    }
  });

  window.electron.on('select-model-by-filepath', (filePath) => {
    // You already have a function (e.g. showModelDetails or toggleModelSelection)
    // Use it to select and highlight the model.
    // For single edit mode, simply select the model and call the function to load its details:
    showModelDetails(filePath);
  });

  // Fetch models without thumbnails
  const modelsWithoutThumbnails = await window.electron.getModelsWithoutThumbnails();
  const modelsCount = modelsWithoutThumbnails.length;

  document.getElementById('ai-service-select').addEventListener('change', async (event) => {
    const selectedService = event.target.value;
    const endpointEl = document.getElementById('ai-endpoint');
    const modelEl = document.getElementById('ai-model');
    const apiKeyEl = document.getElementById('ai-api-key');
    const apiKeyLabel = document.querySelector('label[for="ai-api-key"]');
    const apiKeyGroup = apiKeyEl?.closest('.form-group');

    if (selectedService === 'openai') {
      endpointEl.value = 'https://api.openai.com/v1';
      modelEl.value = 'gpt-4o-mini';
      if (apiKeyEl) {
        apiKeyEl.required = true;
        apiKeyEl.disabled = false;
      }
      if (apiKeyGroup) apiKeyGroup.style.display = '';
    } else if (selectedService === 'gemini') {
      endpointEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      modelEl.value = 'gemini-2.5-flash';
      if (apiKeyEl) {
        apiKeyEl.required = true;
        apiKeyEl.disabled = false;
      }
      if (apiKeyGroup) apiKeyGroup.style.display = '';
    } else if (selectedService === 'puter') {
      // Load Puter.js when user selects Puter service
      loadPuterJS().catch(err => {
        console.warn('[AI Config] Failed to load Puter.js:', err);
      });
      
      endpointEl.value = 'https://js.puter.com/v2/';
      modelEl.value = 'gpt-5-nano';
      if (apiKeyEl) {
        apiKeyEl.required = false;
        apiKeyEl.disabled = true;
        apiKeyEl.value = '';
      }
      if (apiKeyGroup) apiKeyGroup.style.display = 'none';
    } else if (selectedService === 'custom') {
      endpointEl.value = '';
      modelEl.value = '';
      if (apiKeyEl) {
        apiKeyEl.required = true;
        apiKeyEl.disabled = false;
      }
      if (apiKeyGroup) apiKeyGroup.style.display = '';
    }
    
    // Clear the API key field if not puter
    if (apiKeyEl && selectedService !== 'puter') {
      apiKeyEl.value = '';
    }
    
    // Save the new values to the database
    await window.electron.saveSetting('apiEndpoint', endpointEl.value).catch(err => console.error('Error saving endpoint:', err));
    await window.electron.saveSetting('aiModel', modelEl.value).catch(err => console.error('Error saving model:', err));
    await window.electron.saveSetting('aiService', selectedService).catch(err => console.error('Error saving service:', err));
    console.log('[AI Config] Service changed to:', selectedService, 'and saved to database');
  });

  // Add missing function renderThumbnail used in generateThumbnail().
  async function renderThumbnail(file) {
    try {
      // Determine filePath: if file is a string, use it directly; otherwise, assume it's an object with filePath property.
      const filePath = (typeof file === 'string') ? file : file.filePath;
      if (!filePath) {
        throw new Error("renderThumbnail: filePath is undefined");
      }
      // Create a temporary container (not attached to DOM — retainDetached required)
      const tempContainer = document.createElement('div');
      // Call renderModelToPNG with the filePath; no existing thumbnail provided.
      const thumbnail = await renderModelToPNG(filePath, tempContainer, null, {
        retainDetached: true
      });
      return thumbnail;
    } catch (error) {
      console.error("Error in renderThumbnail:", error);
      throw error;
    }
  }

  // Global variable for storing a parent directory filter.
  window.currentDirectoryFilter = "";

  // Add ping/pong handler to keep the renderer process alive
  window.electron.on('ping', () => {
    window.electron.pong();
    
    // Force a minimal UI update to prevent freezing
    requestAnimationFrame(() => {
      const dummyElement = document.createElement('div');
      document.body.appendChild(dummyElement);
      document.body.removeChild(dummyElement);
    });
  });

  // Add download handler for server/docker mode (only register once)
  if (!window._downloadHandlerRegistered) {
    window._downloadHandlerRegistered = true;
    const activeDownloads = new Set(); // Track active downloads to prevent duplicates
    
  // Handle add-image-request event (for server/Docker mode). Accepts single filePath or array for multi-edit.
  let activeImageInput = null; // Track active file input to prevent duplicates
  window.electron.on('add-image-request', async (filePathOrPaths) => {
    // Prevent multiple file input dialogs from opening
    if (activeImageInput) {
      console.log('Image file input dialog already open, ignoring request');
      return;
    }
    const paths = Array.isArray(filePathOrPaths) ? filePathOrPaths : [filePathOrPaths];
    
    try {
      // Create a file input element
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      fileInput.accept = 'image/png,image/jpeg,image/jpg,image/gif,image/webp';
      fileInput.style.display = 'none';
      activeImageInput = fileInput;
      
      let fileSelected = false;
      
      // Handle file selection
      fileInput.addEventListener('change', async (e) => {
        // Prevent multiple change events
        if (fileSelected) {
          return;
        }
        fileSelected = true;
        
        const file = e.target.files[0];
        
        // Clean up immediately, even if no file was selected
        if (activeImageInput === fileInput) {
          activeImageInput = null;
        }
        if (fileInput.parentNode) {
          fileInput.parentNode.removeChild(fileInput);
        }
        
        if (!file) {
          return; // User cancelled
        }
        
        try {
          // Read file as data URL
          const reader = new FileReader();
          reader.onload = async (event) => {
            try {
              const dataUrl = event.target.result;
              // Add thumbnail to each selected model (multi-edit: same image to all)
              for (const filePath of paths) {
                await window.electron.addThumbnail(filePath, dataUrl);
              }
              // Server-side handler sends thumbnail-added per model to refresh the UI
            } catch (error) {
              console.error('Error adding image:', error);
              alert('Error adding image: ' + error.message);
            }
          };
          reader.onerror = (error) => {
            console.error('Error reading file:', error);
            alert('Error reading image file');
          };
          reader.readAsDataURL(file);
        } catch (error) {
          console.error('Error processing image file:', error);
          alert('Error processing image: ' + error.message);
        }
      });
      
      // Clean up if user cancels (no file selected after a delay)
      setTimeout(() => {
        if (!fileSelected && activeImageInput === fileInput) {
          activeImageInput = null;
          if (fileInput.parentNode) {
            fileInput.parentNode.removeChild(fileInput);
          }
        }
      }, 1000);
      
      // Trigger file input dialog
      document.body.appendChild(fileInput);
      fileInput.click();
    } catch (error) {
      console.error('Error setting up image file input:', error);
      alert('Error: Could not open file dialog');
      activeImageInput = null;
    }
  });

  // Handle manage-thumbnails-request event
  window.electron.on('manage-thumbnails-request', async (filePath) => {
    try {
      await showManageThumbnailsModal(filePath);
    } catch (error) {
      console.error('Error showing manage thumbnails modal:', error);
      alert('Error opening thumbnail manager: ' + error.message);
    }
  });

  // Handle client-side command execution (for server mode)
  window.electron.on('execute-client-command', async (commandData) => {
    try {
      if (!commandData || !commandData.type) {
        console.error('Invalid command data:', commandData);
        return;
      }

      const { type, filePath, slicerName, slicerPath, isZipEntry, zipPath, entryPath } = commandData;

      if (type === 'open-file') {
        // Try to open file using Electron IPC handler first, then fallback to download
        try {
          // Try IPC handler (works for Electron clients)
          if (window.electron && typeof window.electron.invoke === 'function') {
            try {
              const result = await window.electron.invoke('execute-client-command', commandData);
              if (result && result.success) {
                console.log('File opened successfully via IPC');
                return;
              }
            } catch (ipcError) {
              console.log('IPC handler not available, trying direct method:', ipcError);
            }
          }
          
          // Try direct openPath (works for Electron clients with preload)
          if (window.electron && typeof window.electron.openPath === 'function') {
            await window.electron.openPath(filePath);
          } else {
            // Browser context - trigger download so user can open it
            const encodedPath = encodeURIComponent(filePath);
            const downloadUrl = `/api/download/${encodedPath}`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = '';
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => link.remove(), 100);
          }
        } catch (error) {
          console.error('Error opening file:', error);
          // Fallback: trigger download
          const encodedPath = encodeURIComponent(filePath);
          const downloadUrl = `/api/download/${encodedPath}`;
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.download = '';
          link.style.display = 'none';
          document.body.appendChild(link);
          link.click();
          setTimeout(() => link.remove(), 100);
        }
      } else if (type === 'open-in-slicer') {
        // Try to execute slicer command on client machine
        // For Electron clients, use IPC handler; for browser clients, show instructions
        
        try {
          // Try IPC handler first (works for Electron clients accessing server)
          if (window.electron && typeof window.electron.invoke === 'function') {
            try {
              const result = await window.electron.invoke('execute-client-command', commandData);
              if (result && result.success) {
                console.log('Slicer command executed successfully via IPC');
                return;
              } else if (result && result.error) {
                alert(`Error opening file in ${slicerName}:\n${result.error}\n\n` +
                  `File: ${filePath}\n` +
                  `Slicer: ${slicerPath}`);
                return;
              }
            } catch (ipcError) {
              console.log('IPC handler failed, trying direct execution:', ipcError);
            }
          }
          
          // Fallback: Try direct Node.js execution (if available in Electron renderer)
          const hasNodeAccess = typeof window !== 'undefined' && typeof require !== 'undefined';
          
          if (hasNodeAccess) {
            try {
              const { exec } = require('child_process');
              const rawPaths = Array.isArray(commandData.filePaths) && commandData.filePaths.length
                ? commandData.filePaths
                : [filePath];
              const modelPaths = isZipEntry && zipPath && entryPath && rawPaths.length === 1
                ? null
                : rawPaths.filter(Boolean);

              if (!modelPaths) {
                alert(`To open a file from a ZIP archive in your slicer:\n\n` +
                  `1. Download the ZIP file: ${zipPath}\n` +
                  `2. Extract ${entryPath} from the ZIP\n` +
                  `3. Open ${entryPath} in ${slicerName}\n\n` +
                  `Slicer: ${slicerPath}`);
                return;
              }

              const command = buildSlicerLaunchCommand(slicerPath, modelPaths);
              
              exec(command, (error, stdout, stderr) => {
                if (error) {
                  console.error('Error executing slicer on client:', error);
                  alert(`Error opening file in ${slicerName}:\n${error.message}\n\n` +
                    `File(s): ${modelPaths.join(', ')}\n` +
                    `Slicer: ${slicerPath}\n\n` +
                    `Please try opening the file manually.`);
                } else {
                  console.log('Successfully executed slicer command on client');
                }
              });
              return; // Successfully started execution
            } catch (execError) {
              console.error('Cannot execute command directly:', execError);
              // Fall through to show instructions
            }
          }
          
          // Browser client or no Node.js access - show instructions
          showSlicerInstructions(filePath, slicerName, slicerPath, isZipEntry, zipPath, entryPath);
        } catch (error) {
          console.error('Error executing slicer command:', error);
          showSlicerInstructions(filePath, slicerName, slicerPath, isZipEntry, zipPath, entryPath);
        }
      }
    } catch (error) {
      console.error('Error handling client command:', error);
    }
  });

  function escapeSlicerShellArg(filePath) {
    return `"${String(filePath).replace(/"/g, '\\"')}"`;
  }

  function getDarwinSlicerAppBundlePath(slicerPath) {
    if (!slicerPath || process.platform !== 'darwin') return null;
    const normalized = String(slicerPath).replace(/\\/g, '/');
    if (/\.app$/i.test(normalized)) return normalized;
    const match = normalized.match(/^(.*?\.app)\//i);
    return match ? match[1] : null;
  }

  // PrusaSlicer / SuperSlicer / Slic3r accept --single-instance; Bambu / Orca / Snapmaker Orca reject it.
  function slicerSupportsSingleInstanceFlag(slicerPath) {
    const base = String(slicerPath).split(/[/\\]/).pop().toLowerCase();
    return /prusa|superslicer|slic3r/.test(base) && !/bambu|orca/.test(base);
  }

  function buildSlicerLaunchCommand(slicerPath, modelPaths) {
    const paths = (Array.isArray(modelPaths) ? modelPaths : [modelPaths]).filter(Boolean);
    const escapedPaths = paths.map(escapeSlicerShellArg).join(' ');
    const appBundle = getDarwinSlicerAppBundlePath(slicerPath);
    if (appBundle) {
      return `open -n -a ${escapeSlicerShellArg(appBundle)} --args ${escapedPaths}`;
    }
    let command = escapeSlicerShellArg(slicerPath);
    if (slicerSupportsSingleInstanceFlag(slicerPath)) {
      command += ' --single-instance=0';
    }
    return `${command} ${escapedPaths}`;
  }

  // Helper function to show slicer instructions
  function showSlicerInstructions(filePath, slicerName, slicerPath, isZipEntry, zipPath, entryPath) {
    let message = `To open this file in ${slicerName}:\n\n`;
    
    if (isZipEntry && zipPath && entryPath) {
      message += `1. Download the ZIP file: ${zipPath}\n`;
      message += `2. Extract ${entryPath} from the ZIP\n`;
      message += `3. Open ${entryPath} in ${slicerName}\n\n`;
    } else {
      message += `1. Download the file (use the Download option)\n`;
      message += `2. Open ${slicerName} on your workstation\n`;
      message += `3. Open the downloaded file in ${slicerName}\n\n`;
      message += `File: ${filePath}\n`;
    }
    
    message += `Slicer Path: ${slicerPath}`;
    
    alert(message);
  }

    window.electron.on('download-model', async (filePath) => {
      // Prevent duplicate downloads of the same file
      if (activeDownloads.has(filePath)) {
        console.log('Download already in progress for:', filePath);
        return;
      }
      
      activeDownloads.add(filePath);
      console.log('Download handler triggered with filePath:', filePath);
      
      try {
        // Check if in server mode
        const serverMode = await window.electron.isServerMode().catch(() => false);
        if (!serverMode) {
          console.error('Download only available in server mode');
          alert('Download is only available in server mode');
          return;
        }

        console.log('Server mode confirmed, constructing download URL');
        // Construct download URL - use /api/download/ endpoint which handles zip entries
        const encodedPath = encodeURIComponent(filePath);
        const downloadUrl = `/api/download/${encodedPath}`;
        console.log('Download URL:', downloadUrl);

        // Try using direct link first (simpler and more reliable)
        // This works better when the server sets Content-Disposition header
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = ''; // Let server set filename via Content-Disposition
        link.style.display = 'none';
        document.body.appendChild(link);
        
        // Get filename from path for logging
        let fileName = filePath;
        if (fileName.includes('::')) {
          fileName = fileName.split('::')[1] || fileName.split('::')[0];
        }
        fileName = fileName.split(/[/\\]/).pop() || fileName;
        
        console.log('Triggering download via direct link for:', fileName);
        link.click();
        
        // Clean up link after a short delay
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          // Remove from active downloads after a delay to allow download to start
          setTimeout(() => {
            activeDownloads.delete(filePath);
          }, 2000);
        }, 100);
      } catch (error) {
        console.error('Error downloading file:', error);
        activeDownloads.delete(filePath);
        // Show error message to user
        alert(`Error downloading file: ${error.message}`);
      }
    });
  }

  // Add near the top of your DOMContentLoaded event listener
  document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Add visibility change handler
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Force a refresh of the UI
        requestAnimationFrame(() => {
          // Refresh any dynamic content that might be stale
          refreshUIContent();
        });
      }
    });
  });

  // Add this new function
  function refreshUIContent() {
    // Refresh the file grid if it exists
    const fileGrid = document.querySelector('.file-grid');
    if (fileGrid) {
      // Re-render the current view
      window.electron.getAllModels(
        document.getElementById('sort-select')?.value || 'name',
        50
      ).then(models => {
        renderFiles(models);
        
      }).catch(console.error);
    }
  }

  window._electronRealEventHandlers['open-slicer-settings'] = function() {
    if (typeof window.openSlicerSettings === 'function') {
      window.openSlicerSettings();
      return;
    }
    const dialog = document.getElementById('slicer-dialog');
    if (dialog) {
      try { dialog.showModal(); } catch (err) { console.error('Error opening slicer settings:', err); }
    }
  };
  if (window._electronPendingEvents['open-slicer-settings']) {
    window._electronPendingEvents['open-slicer-settings'].forEach((args) => {
      window._electronRealEventHandlers['open-slicer-settings'].apply(null, args);
    });
    delete window._electronPendingEvents['open-slicer-settings'];
  }

  // Modify the prompt handler
  async function promptPendingThumbnails() {
    try {
      const modelsWithoutThumbs = await window.electron.getModelsWithoutThumbnails();
      if (modelsWithoutThumbs.length > 0) {
        totalThumbnailsToGenerate = modelsWithoutThumbs.length;
        generatedThumbnailsCount = 0;
        
        // Process in batches
        // UI is now handled inside generateThumbnailsForModels
        await generateThumbnailsForModels(modelsWithoutThumbs);
      }
    } catch (error) {
      console.error('Error in thumbnail generation:', error);
    }
  }

  // Add this to the generateThumbnail function
  function updateProgress() {
    generatedThumbnailsCount++;
    const progress = Math.floor((generatedThumbnailsCount / totalThumbnailsToGenerate) * 100);
    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${generatedThumbnailsCount}/${totalThumbnailsToGenerate} (${progress}%)`;
  }

  // Add this to your existing DOMContentLoaded event listener
  document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Initialize analytics checkbox
    const collectUsageCheckbox = document.getElementById('collect-usage');
    if (collectUsageCheckbox) {
      // Get initial value
      const collectUsage = await window.electron.getSetting('CollectUsage');
      console.log('Initial CollectUsage value:', collectUsage);
      
      // Set checkbox state based on the actual value
      collectUsageCheckbox.checked = collectUsage === '1';
      
      // Handle changes using the same handler as in the about dialog
      collectUsageCheckbox.addEventListener('change', collectUsageChangeHandler);

      // Initialize analytics state with current setting
      toggleAnalytics(collectUsage === '1');
    }
  });

  // GoatCounter usage reporting — only loads when CollectUsage is enabled
  const GOATCOUNTER_ENDPOINT = 'https://printventory.goatcounter.com/count';
  const GOATCOUNTER_SCRIPT_SRC = 'https://gc.zgo.at/count.js';
  const GOATCOUNTER_SCRIPT_ID = 'goatcounter-script';

  function toggleAnalytics(enable) {
    console.log('Toggling analytics:', enable);

    const existing = document.getElementById(GOATCOUNTER_SCRIPT_ID);

    if (enable) {
      console.log('Enabling GoatCounter');

      const alreadyLoaded = existing && window.goatcounter && typeof window.goatcounter.count === 'function';
      if (alreadyLoaded) {
        window.goatcounter.allow_local = true;
        try {
          window.goatcounter.count();
        } catch (e) {
          console.warn('GoatCounter count() failed:', e);
        }
        return;
      }

      // allow_local: Electron may load via file:// or localhost
      // Replace (don't merge) so a prior disable stub cannot leave no_onload set
      window.goatcounter = { allow_local: true };

      if (existing) existing.remove();

      const script = document.createElement('script');
      script.id = GOATCOUNTER_SCRIPT_ID;
      script.async = true;
      script.setAttribute('data-goatcounter', GOATCOUNTER_ENDPOINT);
      script.src = GOATCOUNTER_SCRIPT_SRC;
      document.head.appendChild(script);
    } else {
      console.log('Disabling GoatCounter');
      if (existing) existing.remove();
      // Neuter any already-loaded GoatCounter so further counts are no-ops
      window.goatcounter = {
        no_onload: true,
        count: function () {}
      };
    }
  }
  window.toggleAnalytics = toggleAnalytics;

  // Add function for generating thumbnails for multiple models
  async function generateThumbnailsForModels(models, options = {}) {
    const headless = !!options.headless;
    const cancelRef = options.cancelRef || null;
    const skipHash = !!options.skipHash;
    const progressOffset = typeof options.progressOffset === 'number' ? options.progressOffset : 0;
    const progressTotal = typeof options.progressTotal === 'number' ? options.progressTotal : models.length;
    console.log(`[DEBUG] generateThumbnailsForModels: Starting thumbnail generation for ${models.length} models.`);
    
    // Check if we're in server mode (Docker typically runs in server mode)
    // Hidden worker must stay at concurrency 1 (shared WebGL + SwiftShader RAM).
    const serverMode = await window.electron.isServerMode().catch(() => false);
    const isWorker = await isServerThumbnailWorkerContext();
    const maxConcurrentThumbnails = typeof options.maxConcurrent === 'number'
      ? options.maxConcurrent
      : (isWorker || headless ? 1 : (serverMode ? 3 : 3));
    
    // New progress UI elements (Sidebar)
    const progressSection = document.getElementById('progress-section');
    const progressContainer = document.getElementById('progress-container');
    const progressBar = document.getElementById('progress-bar');
    const progressText = document.getElementById('progress-text');
    const renderProgressContainer = document.getElementById('render-progress-container');
    const renderProgressBar = document.getElementById('render-progress-bar');
    const renderProgressText = document.getElementById('render-progress-text');
    const stopButton = document.getElementById('stop-thumbnail-generation');

    // Use render progress bar for thumbnail generation
    const activeProgressBar = renderProgressBar;
    const activeProgressText = renderProgressText;
    
    // Check if progress elements exist before proceeding
    const hasProgressUI = !headless && progressSection && activeProgressBar && activeProgressText;
    
    const overlay = headless ? null : window.ThumbnailProgress;

    totalThumbnailsToGenerate = progressTotal;
    generatedThumbnailsCount = progressOffset;
    let isCancelled = false;
    let processedInBatch = 0;

    const reportHeadlessProgress = async (processed, total, phase) => {
      if (!headless || typeof window.electron.reportServerThumbnailProgress !== 'function') return;
      try {
        await window.electron.reportServerThumbnailProgress({
          processed,
          total,
          phase: phase || `Processing ${processed}/${total}`,
          mode: options.mode || null
        });
      } catch (err) {
        console.warn('[Server thumbnails] progress report failed:', err);
      }
    };

    // Handle stop button
    const handleStopClick = () => {
        isCancelled = true;
        if (cancelRef) cancelRef.cancelled = true;
        if (activeProgressText) activeProgressText.textContent = 'Stopping...';
    };
    if (stopButton && !headless) {
        // Remove existing listener if any (to avoid duplicates)
        stopButton.replaceWith(stopButton.cloneNode(true));
        const newStopButton = document.getElementById('stop-thumbnail-generation');
        newStopButton.addEventListener('click', handleStopClick);
        newStopButton.style.display = 'block';
    }

    try {
      // Show progress section
      if (hasProgressUI) {
        progressSection.classList.remove('hidden');
        renderProgressContainer.classList.remove('hidden');
        // Hide the file scan progress as we are only generating thumbnails
        if (progressContainer) progressContainer.classList.add('hidden'); 
        
        activeProgressBar.style.width = '0%';
        activeProgressText.textContent = `Processing ${progressOffset}/${progressTotal} (0%)`;
      }

      if (overlay) {
        overlay.show({ title: options.title || 'Generating Thumbnails', total: progressTotal });
        overlay.update(progressOffset, progressTotal, `Generating thumbnails for ${progressTotal} model${progressTotal === 1 ? '' : 's'}...`);
        overlay.onCancel(handleStopClick);
      }

      if (progressOffset === 0) {
        await reportHeadlessProgress(0, progressTotal, `Generating thumbnails for ${progressTotal} model${progressTotal === 1 ? '' : 's'}...`);
      }
      
      // Process models in parallel with concurrency control for better performance
      const modelQueue = [...models];
      const activePromises = new Set();
      let processedCount = 0;
      
      const processModel = async (model) => {
        let thumbnail = null;
        const pathForExt = model.filePath.includes('::') ? (model.filePath.split('::')[1] || '') : model.filePath;
        const fileExt = pathForExt.split('.').pop().toLowerCase();
        
        try {
          // 0. Non-previewable types: use typed placeholder (file type label)
          if (fileExt !== 'stl' && fileExt !== '3mf' && fileExt !== 'obj' && fileExt !== 'svg') {
            thumbnail = generateTypedPlaceholder(fileExt);
            await window.electron.saveThumbnail(model.filePath, thumbnail);
            if (!skipHash && (!model.hash || model.hash === '')) {
              try { await window.electron.calculateFileHash(model.filePath); } catch (e) { /* ignore */ }
            }
            return;
          }
          
          // 0b. SVG: try to load as image data URL; on failure use typed placeholder
          if (fileExt === 'svg') {
            try {
              const buf = await window.electron.readModelFile(model.filePath);
              if (buf && (buf instanceof ArrayBuffer || buf.byteLength)) {
                const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
                const decoder = new TextDecoder();
                const svgText = decoder.decode(bytes);
                thumbnail = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
              }
            } catch (e) { /* ignore */ }
            if (!thumbnail || !thumbnail.startsWith('data:image')) {
              thumbnail = generateTypedPlaceholder('svg');
            }
            await window.electron.saveThumbnail(model.filePath, thumbnail);
            if (!skipHash && (!model.hash || model.hash === '')) {
              try { await window.electron.calculateFileHash(model.filePath); } catch (e) { /* ignore */ }
            }
            return;
          }
          
          // 1. Try to get embedded images for 3MF (all packed into DB for Manage Thumbnails)
          let saved3mfEmbedsViaBatch = false;
          if (model.filePath.toLowerCase().endsWith('.3mf')) {
            console.log(`[DEBUG] generateThumbnailsForModels: Attempting to extract embedded thumbnail for ${model.filePath}`);
            try {
              const embeddedImages = await extract3MFThumbnail(model.filePath);
              if (embeddedImages && embeddedImages.length > 0) {
                const validImages = embeddedImages.filter(
                  (im) => typeof im === 'string' && im.startsWith('data:image')
                );
                if (validImages.length > 0) {
                  thumbnail = validImages[0];
                  await window.electron.addMultipleThumbnails(model.filePath, validImages);
                  saved3mfEmbedsViaBatch = true;
                  console.log(
                    `[DEBUG] generateThumbnailsForModels: SUCCESS - Saved ${validImages.length} embedded image(s) for ${model.filePath}`
                  );
                } else {
                  console.log(`[DEBUG] generateThumbnailsForModels: Invalid image format for ${model.filePath}`);
                }
              } else {
                console.log(`[DEBUG] generateThumbnailsForModels: No embedded thumbnail found for ${model.filePath}. Falling back to 3D rendering.`);
              }
            } catch (embeddedError) {
              console.error(`Error extracting embedded image from 3MF: ${model.filePath}`, embeddedError);
            }
          }

          // 2. If no embedded thumbnail, try 3D rendering
          if (!thumbnail) {
            console.log(`[DEBUG] generateThumbnailsForModels: Rendering 3D model for ${model.filePath}`);
            try {
              thumbnail = await generateThumbnail(model.filePath);
            } catch (renderError) {
              console.error(`Error generating 3D thumbnail for ${model.filePath}:`, renderError);
            }
          }

          // 3. Validate and fallback to default if necessary (STL/3MF only reach here)
          if (!thumbnail || typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image') || isFailurePlaceholderThumbnail(thumbnail)) {
            thumbnail = '3d.png';
          }

          // 4. Save real renders only — never lock in failure placeholders
          if (!saved3mfEmbedsViaBatch && thumbnail !== '3d.png') {
            await window.electron.saveThumbnail(model.filePath, thumbnail);
          } else if (!saved3mfEmbedsViaBatch) {
            await window.electron.saveThumbnail(model.filePath, '3d.png');
          }
          
          // 5. Hash during bulk jobs is optional (extra I/O / memory); skip in Docker headless.
          if (!skipHash && (!model.hash || model.hash === '')) {
            try {
              await window.electron.calculateFileHash(model.filePath);
            } catch (hashError) {
              console.error(`Error calculating hash for ${model.filePath}:`, hashError);
              // Continue even if hash calculation fails
            }
          }

          thumbnail = null;
          
        } catch (error) {
          console.error(`Failed to generate thumbnail for ${model.filePath}:`, error);
          // Do not persist typed STL/3MF placeholders — that blocks retries (common on Docker timeouts).
          try {
            await window.electron.saveThumbnail(model.filePath, '3d.png');
          } catch (saveError) {
            console.error(`Failed to save default thumbnail for ${model.filePath}:`, saveError);
          }
        } finally {
          processedInBatch++;
          processedCount = processedInBatch;
          const absoluteProcessed = progressOffset + processedInBatch;
          generatedThumbnailsCount = absoluteProcessed;
          
          // Update progress
          if (hasProgressUI) {
            const progress = Math.floor((absoluteProcessed / progressTotal) * 100);
            activeProgressBar.style.width = `${progress}%`;
            activeProgressText.textContent = `Processing ${absoluteProcessed}/${progressTotal} (${progress}%)`;
          }
          if (overlay && !isCancelled) {
            overlay.update(absoluteProcessed, progressTotal);
          }
          if (!isCancelled) {
            await reportHeadlessProgress(absoluteProcessed, progressTotal);
          }

          // Between models: yield + occasional soft GC. Soft dispose only —
          // never forceContextLoss (restarts GPU process → Skia OOM log storms).
          if (maxConcurrentThumbnails === 1) {
            await new Promise((r) => setTimeout(r, 25));
            if (processedInBatch % 15 === 0 && typeof deepCleanThreeResources === 'function') {
              deepCleanThreeResources();
              await new Promise((r) => setTimeout(r, 50));
            } else if (typeof gc === 'function' && processedInBatch % 5 === 0) {
              try { gc(); } catch (_) { /* ignore */ }
            }
          }
        }
      };
      
      // Process models with concurrency control
      while (modelQueue.length > 0 && !isCancelled && !(cancelRef && cancelRef.cancelled)) {
        if (cancelRef && cancelRef.cancelled) {
          isCancelled = true;
          break;
        }
        // Fill up to max concurrent thumbnails
        while (activePromises.size < maxConcurrentThumbnails && modelQueue.length > 0) {
          const model = modelQueue.shift();
          const promise = processModel(model).finally(() => {
            activePromises.delete(promise);
          });
          activePromises.add(promise);
        }

        if (hasProgressUI && progressTotal > 0) {
          const done = Math.min(generatedThumbnailsCount, progressTotal);
          activeProgressText.textContent = `Processing ${done}/${progressTotal} (${activePromises.size} active)`;
        }
        
        // Wait for at least one promise to complete before continuing
        if (activePromises.size > 0) {
          await Promise.race(Array.from(activePromises));
        }
      }
      
      // Wait for any remaining active promises to complete
      if (activePromises.size > 0) {
        await Promise.all(Array.from(activePromises));
      }

      if (cancelRef && cancelRef.cancelled) {
        isCancelled = true;
      }

      // Update final progress
      const finalProcessed = progressOffset + processedInBatch;
      if (hasProgressUI && !isCancelled && finalProcessed >= progressTotal) {
        activeProgressBar.style.width = '100%';
        activeProgressText.textContent = `Completed ${progressTotal}/${progressTotal} (100%)`;
      }
      if (overlay && !isCancelled && finalProcessed >= progressTotal) {
        overlay.update(progressTotal, progressTotal);
      }
      if (!isCancelled && finalProcessed >= progressTotal) {
        await reportHeadlessProgress(progressTotal, progressTotal, 'Finished.');
      }
      
    } catch (error) {
      console.error('Error in thumbnail generation:', error);
      if (headless) throw error;
    } finally {
      // Hide progress section after a short delay
      if (hasProgressUI) {
        setTimeout(() => {
             progressSection.classList.add('hidden');
        }, 2000);
      }
      if (overlay) {
        overlay.complete(isCancelled ? 'Stopped.' : 'Finished.');
      }
    }

    return { cancelled: isCancelled, count: models.length };
  }

  window.generateThumbnailsForModels = generateThumbnailsForModels;

  // Hidden Docker worker: once the generator exists, skip the rest of this UI init path
  // (virtual grid / library load) so it does not compete for RAM with bulk thumbs.
  if (await isServerThumbnailWorkerContext()) {
    console.log('[Server thumbnails] Worker window: generateThumbnails ready; skipping remaining UI init');
    document.body?.classList.add('server-thumbnail-worker');
    return;
  }

  // Add these constants at the top of the file (if not already present)
  const PAGE_SIZE = 100; // Number of models to keep in memory
  let allFilteredModels = []; // Store all filtered models (references only)
  let visibleModels = []; // Store currently visible models (full data)
  let currentPage = 0;
  let isVirtualScrolling = false;

  // Update the view-library-button click handler
  document.getElementById('view-library-button')?.addEventListener('click', async () => {
    try {
      window.disableGridRefresh = false;
      const gridEl = document.querySelector('.file-grid');
      if (gridEl) gridEl.currentModels = null;
      window.dateAddedFilter = null;
      window._lastDateAddedFilter = null;
      document.getElementById('designer-select').value = '';
      document.getElementById('license-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      const newSelVl2 = document.getElementById('new-select');
      if (newSelVl2) newSelVl2.value = 'all';
      document.getElementById('tag-filter').value = '';
      document.getElementById('filetype-select').value = '';
      document.getElementById('search-filter-input').value = '';
      window.currentDirectoryFilter = "";
      const viewLibMsg = document.getElementById("view-library-message");
      if (viewLibMsg) viewLibMsg.style.display = "none";
      window.viewingEntireLibrary = true;
      if (typeof window.resetCurrentFilterPanelShell === "function") {
        window.resetCurrentFilterPanelShell();
      } else {
        const filterIndicator = document.getElementById("current-filter");
        if (filterIndicator) {
          filterIndicator.innerHTML = "";
          filterIndicator.classList.remove("visible");
        }
      }
      if (typeof window.forceGridRefresh === 'function') {
        await window.forceGridRefresh();
      } else if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      }
      console.log("Viewing entire library");
    } catch (error) {
      console.error('Error loading library:', error);
      await window.electron.showMessage('Error', 'Failed to load library.');
    }
  });

  // New function to initialize virtual scrolling
  async function initializeVirtualScrolling(modelRefs) {
    try {
      // First, clear any existing content
      const grid = document.getElementById('file-grid');
      grid.innerHTML = '';
      
      // Show loading
      document.getElementById('spinner').classList.remove('hidden');
      
      // Calculate total number of models
      const totalCount = modelRefs.length;
      console.log(`Setting up virtual grid with ${totalCount} models`);
      
      // Update the model count display
      updateModelCounts(totalCount);
      
      // Create placeholder items for all models
      let fragment = document.createDocumentFragment();
      
      // Use the same file-item creation and styling as the regular view
      modelRefs.forEach(model => {
        const fileElement = document.createElement('div');
        fileElement.className = 'file-item';
        fileElement.setAttribute('data-filepath', model.filePath);
        
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'thumbnail-container';
        thumbnailContainer.style.background = getComputedStyle(document.documentElement).getPropertyValue('--model-background-color');
        addThumbnailMenuButton(thumbnailContainer, model.filePath);
        
        // Create print status indicator
        const printStatus = document.createElement('div');
        printStatus.className = 'print-status';
        printStatus.textContent = 'Not Printed';
        printStatus.style.cursor = 'pointer';
        printStatus.title = 'Click to toggle printed status';
        
        // Add click handler to toggle printed status
        printStatus.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation(); // Prevent triggering file item click
          
          // Get current model to check printed status
          const currentModel = await window.electron.getModel(model.filePath);
          if (currentModel) {
            const newPrintedStatus = !currentModel.printed;
            await autoSaveModel('printed', newPrintedStatus, model.filePath);
          }
        });
        
        thumbnailContainer.appendChild(printStatus);
        
        fileElement.appendChild(thumbnailContainer);
        
        // Create file info container
        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        
        // Add file name element
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = path.basename(model.filePath);
        fileInfo.appendChild(fileName);
        
        // Add file details
        const fileDetails = document.createElement('div');
        fileDetails.className = 'file-details';
        fileDetails.textContent = 'Loading...';
        fileInfo.appendChild(fileDetails);
        
        fileElement.appendChild(fileInfo);
        
        // Add click handler
        fileElement.addEventListener('click', (e) => handleFileClick(e, model.filePath));
        
        // Add context menu handler
        addContextMenuHandler(fileElement, model.filePath);
        
        fragment.appendChild(fileElement);
      });
      
      grid.appendChild(fragment);
      
      // Start loading models and rendering thumbnails
      loadAndRenderModels(modelRefs);
      
      // Hide spinner when initial rendering is done
      document.getElementById('spinner').classList.add('hidden');
      
    } catch (error) {
      console.error('Error initializing virtual scrolling:', error);
      document.getElementById('spinner').classList.add('hidden');
    }
  }

  // Add this helper function to load and render models
  async function loadAndRenderModels(modelRefs, batchSize = 20) {
    if (!modelRefs || !Array.isArray(modelRefs)) {
      console.warn('Invalid model references provided to loadAndRenderModels');
      return;
    }
    
    try {
      // Process in batches for better performance
      for (let i = 0; i < modelRefs.length; i += batchSize) {
        const batch = modelRefs.slice(i, i + batchSize);
        
        // Load detailed model data for each model in the batch
        for (const modelRef of batch) {
          if (!modelRef || !modelRef.filePath) {
            console.warn('Invalid model reference:', modelRef);
            continue; // Skip this iteration
          }
          
          try {
            // Get model data from electron
            const model = await window.electron.getModel(modelRef.filePath);
            if (!model) {
              console.warn(`No model data returned for ${modelRef.filePath}`);
              continue; // Skip if no model data
            }
            
            // Find the element for this model by iterating through all file items
            // This avoids CSS escaping issues with special characters in file paths
            const allFileItems = document.querySelectorAll('.file-item');
            let fileElement = null;
            const normalizedModelRefPath = normalizePathForComparison(modelRef.filePath);
            for (const item of allFileItems) {
              const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedModelRefPath) {
                fileElement = item;
                break;
              }
            }
            if (!fileElement) {
              console.warn(`Element for model ${modelRef.filePath} not found in DOM`);
              continue; // Skip if element not found
            }
            
            // Update print status
            const printStatus = fileElement.querySelector('.print-status');
            if (printStatus) {
              if (model.printed) {
                printStatus.textContent = 'Printed';
                printStatus.classList.add('printed');
              } else {
                printStatus.textContent = 'Not Printed';
                printStatus.classList.remove('printed');
              }
            }
            
            // Update file details
            const fileDetails = fileElement.querySelector('.file-details');
            if (fileDetails) {
              // Use formatFileSize function if it exists
              const sizeText = model.size ? 
                (typeof formatFileSize === 'function' ? formatFileSize(model.size) : `${Math.round(model.size / 1024)} KB`) : 
                '';
              
              const designerText = model.designer ? `Designer: ${model.designer}` : '';
              fileDetails.textContent = [sizeText, designerText].filter(Boolean).join(' • ');
            }
            
            // Load thumbnail
            const thumbnailContainer = fileElement.querySelector('.thumbnail-container');
            if (thumbnailContainer) {
              // Check if an image already exists
              if (!thumbnailContainer.querySelector('img')) {
                if (model.thumbnail) {
                  const img = document.createElement('img');
                  img.src = model.thumbnail;
                  thumbnailContainer.appendChild(img);
                } else {
                  // Queue for thumbnail generation if the function exists
                  if (typeof renderModelToPNG === 'function') {
                    renderModelToPNG(modelRef.filePath, thumbnailContainer);
                  }
                }
              }
            }
          } catch (e) {
            console.error(`Error loading model ${modelRef.filePath}:`, e);
            // Continue with next model even if one fails
          }
        }
        
        // Allow UI to update between batches
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error('Error in loadAndRenderModels:', error);
    }
  }


  // Add this function to check if a model should be visible based on current filters
  async function isModelVisible(model) {
    const designer = document.getElementById('designer-select').value;
    const license = document.getElementById('license-select').value;
    const parentModel = document.getElementById('parent-select').value;
    const printStatus = document.getElementById('printed-select').value;
    const favoriteStatus = document.getElementById('favorite-select')?.value || 'all';
    const ratingStatus = document.getElementById('rating-select')?.value || 'all';
    const ratingMinStatus = document.getElementById('rating-min-select')?.value || 'all';
    const tagFilter = document.getElementById('tag-filter').value;
    const fileType = document.getElementById('filetype-select').value;
    const searchTerm = document.getElementById('search-filter-input')?.value.trim() || '';

    // Apply each filter
    if (designer && designer !== '__none__' && model.designer !== designer) return false;
    if (designer === '__none__' && model.designer) return false;
    if (license && model.license !== license) return false;
    if (parentModel && model.parentModel !== parentModel) return false;
    if (printStatus === 'printed' && !model.printed) return false;
    if (printStatus === 'not-printed' && model.printed) return false;
    if (favoriteStatus === 'favorited' && !model.favorite) return false;
    if (favoriteStatus === 'not-favorited' && model.favorite) return false;
    const modelRating = normalizeModelRatingValue(model.rating);
    if (ratingStatus === 'unrated' && modelRating !== 0) return false;
    if (ratingStatus !== 'all' && /^[1-5]$/.test(ratingStatus) && modelRating !== parseInt(ratingStatus, 10)) return false;
    if (ratingMinStatus !== 'all' && /^[1-5]$/.test(ratingMinStatus) && modelRating < parseInt(ratingMinStatus, 10)) return false;
    if (fileType) {
      if (fileType.toLowerCase() === 'zip') {
        // For zip filter, show all models inside ZIP archives (entries with :: separator)
        if (!model.filePath || !model.filePath.includes('::')) return false;
      } else {
        if (!model.fileName.toLowerCase().endsWith(`.${fileType.toLowerCase()}`)) return false;
      }
    }
    
    // Handle tag filter
    if (tagFilter) {
      const modelTags = await window.electron.getModelTags(model.id);
      if (!modelTags || !modelTags.some(tag => tag.name === tagFilter)) return false;
    }

    // Handle search term (name, directory, metadata, tags, notes)
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const searchFields = [model.fileName, model.designer, model.parentModel, model.notes, model.filePath, model.source, model.license]
        .filter(Boolean)
        .map(field => String(field).toLowerCase());
      if (searchFields.some(field => field.includes(searchLower))) return true;
      const modelTags = await window.electron.getModelTags(model.id);
      const tagMatch = modelTags && modelTags.some(tag => tag.name && tag.name.toLowerCase().includes(searchLower));
      if (tagMatch) return true;
      return false;
    }

    return true;
  }

 

  // Fix the renderVisibleItems function to maintain selection state
  function renderVisibleItems(startIndex) {
    const container = document.getElementById('visible-items-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Calculate grid layout
    const containerWidth = container.parentElement.clientWidth;
    const itemWidth = 250; // Approximate width of each item
    const columns = Math.max(Math.floor(containerWidth / itemWidth), 1);
    
    visibleModels.forEach((model, index) => {
      if (!model || !model.filePath) return; // Skip invalid models
      
      const absoluteIndex = startIndex + index;
      const row = Math.floor(absoluteIndex / columns);
      const col = absoluteIndex % columns;
      
      const item = createModelItem(model, currentGridView);
      item.style.position = 'absolute';
      item.style.top = `${row * 300}px`; // 300px height per item
      item.style.left = `${col * (containerWidth / columns)}px`;
      item.style.width = `${containerWidth / columns - 20}px`; // 20px for margins
      
      // Set selection state from global Set
      if (isInSelectedModels(model.filePath)) {
        item.classList.add('selected');
      }
      
      container.appendChild(item);
    });
  }


  document.getElementById('select-all-button')?.addEventListener('click', async () => {
    // Clear existing selections first
    selectedModels.clear();
    
    try {
      // Get all filtered model references (not just visible ones)
      // Wait for getCombinedFilteredModels to be available (handles module loading race condition)
      const getFilteredModels = await waitForGetCombinedFilteredModels();
      const filteredModels = await getFilteredModels(); // Use the function from search.js
      
      // Add all filtered models to selection (ensuring no duplicates by file path)
      const uniqueFilePaths = new Set();
      filteredModels.forEach(model => {
        if (!uniqueFilePaths.has(model.filePath)) {
          uniqueFilePaths.add(model.filePath);
          addToSelectedModels(model.filePath);
        }
      });
      
      // Update UI for all items with matching file paths that are rendered
      // Use helper function to ensure normalized path comparison
      filteredModels.forEach(model => {
        if (isInSelectedModels(model.filePath)) {
          document.querySelectorAll('.file-item').forEach(item => {
            const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
            if (normalizePathForComparison(itemPath) === normalizePathForComparison(model.filePath)) {
              item.classList.add('selected');
            }
          });
        }
      });
      
      // Update the selected count
      updateSelectedCount();
      
      // Show multi-edit panel if there are selections
      if (selectedModels.size > 0) {
        showMultiEditPanel();
      }
    } catch (error) {
      console.error('Error selecting all models:', error);
    }
  });

  // Remove the override of getCombinedFilteredModels - use the one from search.js instead
  // window.getCombinedFilteredModels = async (limit = 0) => {
  //   try {
  //     // Get current filter values
  //     ...
  //   } catch (error) {
  //     console.error("Error in getCombinedFilteredModels:", error);
  //     return [];
  //   }
  // };

  // Add this IPC handler to preload.js
  // getAllModelReferences: () => ipcRenderer.invoke('get-all-model-references'),

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Initialize the application
      await initializeApp();
      
      // Set up multi-edit button handler
      const multiEditBtn = document.getElementById('multi-edit-btn');
      if (multiEditBtn) {
        multiEditBtn.addEventListener('click', async () => {
          await showMultiEditPanel();
        });
      }
      
      // Set up multi-edit close button
      const closeMultiEditBtn = document.getElementById('close-multi-edit');
      if (closeMultiEditBtn) {
        closeMultiEditBtn.addEventListener('click', () => {
          exitMultiEditMode();
        });
      }
      
      // Initialize multi-edit tag handling
      const addMultiEditTagBtn = document.getElementById('add-multi-edit-tag');
      if (addMultiEditTagBtn) {
        addMultiEditTagBtn.addEventListener('click', async () => {
          const tagSelect = document.getElementById('multi-edit-tag-select');
          if (tagSelect && tagSelect.value) {
            await autoSaveMultipleModels('tags', tagSelect.value);
            tagSelect.value = ''; // Reset selection
          }
        });
      }
      
      // Debug log for initialization
      debugLog('Multi-edit panel initialization complete');
      
    } catch (error) {
      console.error('Error during application initialization:', error);
    }
  });

  // ... existing code ...
});

async function updateSelectedCount() {
  const countElement = document.querySelector('.selected-count');
  if (countElement) {
    countElement.textContent = `${selectedModels.size} model${selectedModels.size !== 1 ? 's' : ''} selected`;
  }
  
  // Clear tags when selection changes significantly (new group of files selected)
  clearTagsOnSelectionChange();
  
  // Clear multi-edit form fields when no models are selected
  if (selectedModels.size === 0 && isMultiSelectMode) {
    clearMultiEditFormFields();
  }

  // Refresh the remove tag dropdown when selection changes (if in multi-edit mode)
  if (isMultiSelectMode && selectedModels.size > 0) {
    await populateRemoveTagSelect();
  }
}

// Track previous selection to detect when a completely new selection is made
let previousSelectionHash = '';

function clearTagsOnSelectionChange() {
  // Create a hash of current selection to detect complete selection changes
  const currentSelectionHash = selectedModels.size > 0 
    ? Array.from(selectedModels).sort().join('|')
    : '';
  
  // If selection was cleared (went from >0 to 0), mark for clearing on next selection
  if (previousSelectionHash && selectedModels.size === 0) {
    previousSelectionHash = ''; // Reset so next selection is treated as new
    return;
  }
  
  // If this is a completely new selection (no overlap with previous), clear tags
  if (previousSelectionHash && currentSelectionHash && 
      previousSelectionHash !== currentSelectionHash && 
      selectedModels.size > 0) {
    // Check if there's any overlap - if no overlap, it's a completely new selection
    const previousFiles = new Set(previousSelectionHash.split('|'));
    const currentFiles = new Set(currentSelectionHash.split('|'));
    const hasOverlap = Array.from(currentFiles).some(file => previousFiles.has(file));
    
    // If no overlap, clear tags as this is a completely new selection
    if (!hasOverlap) {
      const multiTagsContainer = document.getElementById('multi-tags');
      if (multiTagsContainer) {
        multiTagsContainer.innerHTML = '';
      }
      const multiTagSelect = document.getElementById('multi-tag-select');
      if (multiTagSelect) {
        multiTagSelect.value = '';
      }
    }
  }
  
  // Update tracking variable
  previousSelectionHash = currentSelectionHash;
}

// Update the toggleModelSelection function`
async function toggleModelSelection(fileElement, filePath) {
  if (!isMultiSelectMode) {
    const wasSelected = fileElement.classList.contains('selected');
    
    // Clear previous selections
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    if (wasSelected) {
      // If it was already selected, just deselect and close details
      const detailsPanel = document.getElementById('model-details');
      if (detailsPanel) {
        detailsPanel.classList.add('hidden');
      }
    } else {
      // Add selection to the clicked item
      addToSelectedModels(filePath);
      
      // Only select this specific element, not all elements with the same filePath
      fileElement.classList.add('selected');
      
      // Show model details
      showModelDetails(filePath);
    }
  } else {
    // Multi-select mode
    if (fileElement.classList.contains('selected') || isInSelectedModels(filePath)) {
      // Deselect
      removeFromSelectedModels(filePath);
      fileElement.classList.remove('selected');
    } else {
      // Select
      addToSelectedModels(filePath);
      fileElement.classList.add('selected');
    }
    await updateSelectedCount(); // This will clear form fields if selection is now 0
  }
}

// NOTE: loadModel function is defined earlier in the file (around line 2840)
// This duplicate has been removed to use the enhanced version that checks for embedded images

function fitCameraToObject(camera, object, scene, renderer) {
  // Orient first, then measure — otherwise large flat STLs (e.g. 400×420×4 plates)
  // get framed for the wrong bbox and often land past the camera far plane.
  object.rotation.x = -Math.PI / 2;
  object.updateMatrixWorld(true);

  const boundingBox = new THREE.Box3().setFromObject(object);
  const size = boundingBox.getSize(new THREE.Vector3());
  const center = boundingBox.getCenter(new THREE.Vector3());

  if (Number.isFinite(center.x) && Number.isFinite(center.y) && Number.isFinite(center.z)) {
    object.position.sub(center);
    object.updateMatrixWorld(true);
  }

  const fittedBox = new THREE.Box3().setFromObject(object);
  const fittedSize = fittedBox.getSize(new THREE.Vector3());
  const maxDim = Math.max(fittedSize.x, fittedSize.y, fittedSize.z, 1e-3);

  const fov = camera.fov * (Math.PI / 180);
  const tanHalfFov = Math.tan(fov / 2);
  let cameraZ =
    maxDim > 0 && tanHalfFov > 0
      ? Math.abs(maxDim / 2 / tanHalfFov) * 1.5
      : 5;
  if (!Number.isFinite(cameraZ) || cameraZ <= 0) cameraZ = 5;

  // Camera sits on the (z,z,z) diagonal — keep far plane beyond that distance.
  const cameraDistance = cameraZ * Math.sqrt(3);
  camera.near = Math.max(0.01, cameraDistance / 1000);
  camera.far = Math.max(10000, cameraDistance * 20);
  camera.updateProjectionMatrix();

  camera.position.set(cameraZ, cameraZ, cameraZ);
  camera.lookAt(0, 0, 0);

  renderer.render(scene, camera);
}

/** True when a thumbnail data-URL is effectively empty (transparent / clipped render). */
function isMostlyEmptyThumbnailDataUrl(dataUrl) {
  return new Promise((resolve) => {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image')) {
      resolve(true);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const w = Math.min(64, img.width || 64);
        const h = Math.min(64, img.height || 64);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(false);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const pixels = ctx.getImageData(0, 0, w, h).data;
        let opaque = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] > 12) opaque += 1;
        }
        // Less than 0.5% opaque pixels ≈ blank (model clipped or failed).
        resolve(opaque < w * h * 0.005);
      } catch (error) {
        resolve(false);
      }
    };
    img.onerror = () => resolve(true);
    img.src = dataUrl;
  });
}

function handleContextLost(event) {
  event.preventDefault();
  
  // Properly clean up resources
  if (scene) {
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
    scene.clear();
  }
  
  renderer = null;
  scene = null;
  camera = null;
}

function handleContextRestored() {
  console.log('WebGL context restored');
  // Renderer will be recreated on next render
}

// Update showSpinner function to show progress section instead
function showProgressBars() {
  const progressSection = document.getElementById('progress-section');
  const progressBar = document.getElementById('progress-bar');
  const renderProgressBar = document.getElementById('render-progress-bar');
  const progressText = document.getElementById('progress-text');
  const renderProgressText = document.getElementById('render-progress-text');
  
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  renderProgressBar.style.width = '0%';
  progressText.textContent = '0 / 0 files';
  renderProgressText.textContent = '0 / 0 models';
}

// Update hideSpinner function
function hideProgressBars() {
  const progressSection = document.getElementById('progress-section');
  progressSection.classList.add('hidden');
}

// Update function signature to include background and isStlHomeScan parameters
async function scanAndRenderDirectory(directoryPath, background = false, isStlHomeScan = false) {
  const progressSection = document.getElementById('progress-section');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const renderProgressContainer = document.getElementById('render-progress-container');
  const renderProgressBar = document.getElementById('render-progress-bar');
  const renderProgressText = document.getElementById('render-progress-text');
  const stopButton = document.getElementById('stop-thumbnail-generation');
  const container = background ? document.createElement('div') : document.querySelector('.file-grid');
  
  // Flag to track if the process has been cancelled
  let isCancelled = false;
  
  // Function to handle stop button click
  const handleStopClick = () => {
    isCancelled = true;
    renderProgressText.textContent = 'Stopping...';
    console.log('Thumbnail generation cancelled by user');
  };
  
  // Add event listener to stop button
  stopButton.addEventListener('click', handleStopClick);

  // When a background scan finds new models, we show the same "New Models" dialog as a foreground scan;
  // then skip the duplicate performCombinedSearch in finally (see skipBackgroundFinallyRefresh).
  let skipBackgroundFinallyRefresh = false;

  try {
    if (background) {
      window.disableGridRefresh = true;
      console.log('Background scan: grid refresh disabled');
    }
    if (!background) {
      progressSection.classList.remove('hidden');
      progressContainer.classList.remove('hidden');
      renderProgressContainer.classList.remove('hidden');
      progressBar.style.width = '0%';
      progressText.textContent = 'Gathering files...';
      stopButton.style.display = 'block';
    }

    // Use file extension to determine file type
    const isValidFile = (filename, size) => {
      const ext = filename.toLowerCase().split('.').pop();
      const maxSize = MAX_FILE_SIZE_MB * 1024 * 1024;
      return (ext === 'stl' || ext === '3mf') && size <= maxSize;
    };

    // Store scan start time for filtering newly added models
    const scanStartTime = new Date().toISOString();
    
    // Update the scan directory call to use the new validation and cancellation
    const scanOptions = isStlHomeScan ? { isStlHomeScan: true } : {};
    const scanResult = await window.electron.scanDirectory(directoryPath, scanOptions);
    const { files, totalFiles, newFilesCount, cancelScan } = scanResult || { files: [], totalFiles: 0, newFilesCount: 0 };
    
    if (isCancelled) {
      if (cancelScan) cancelScan(); // Cancel the scan if possible
      throw new Error('Operation cancelled by user.');
    }
    
    if (!files || files.length === 0) {
      if (!background) {
        progressBar.style.width = '100%';
        progressText.textContent = '';
        renderProgressBar.style.width = '100%';
        renderProgressText.textContent = '';
      }
      console.log('No files found in directory:', directoryPath);
      return; // Exit the function early instead of throwing error
    }

    console.log('Scanned files:', totalFiles);

    const allModels = await window.electron.getAllModels();
    const existingFiles = new Set(allModels.map(model => model.filePath));
    const existingThumbnails = new Map(allModels.map(model => [model.filePath, model.thumbnail]));

    if (!background) {
      progressBar.style.width = '0%';
      progressText.textContent = `Processing ${files.length} files...`;
    }

    const newFiles = files.filter(file => !existingFiles.has(file.filePath));
    
    // Use a more efficient approach for saving models
    if (newFiles.length > 0) {
      const fileProgressUpdate = (completed) => {
        if (!background) {
          const progress = (completed / newFiles.length) * 100;
          progressBar.style.width = `${progress}%`;
          progressText.textContent = `${completed} / ${newFiles.length} files`;
        }
      };

      // Process files in larger batches for better performance
      const saveBatchSize = 50; // Increased from 10
      for (let i = 0; i < newFiles.length; i += saveBatchSize) {
        if (isCancelled) {
          throw new Error('Operation cancelled by user.');
        }
        
        const batch = newFiles.slice(i, Math.min(i + saveBatchSize, newFiles.length));
        const modelDataBatch = batch.map(file => ({
          filePath: file.filePath,
          fileName: file.fileName,
          hash: file.hash,
          size: file.size,
          modifiedDate: file.mtime
        }));
        
        // Save models in batch for better performance
        await window.electron.saveModelBatch(modelDataBatch);
        fileProgressUpdate(Math.min(i + saveBatchSize, newFiles.length));
      }
    }

    if (!background) {
      progressBar.style.width = '100%';
    }

    // Include files that have no thumbnail or only the default placeholder (new inserts have null)
    const filesNeedingThumbnails = files.filter(file => {
      const thumb = existingThumbnails.get(file.filePath);
      return !thumb || thumb === '3d.png' || (typeof thumb === 'string' && thumb.trim() === '');
    });
    const deferScanThumbnails =
      filesNeedingThumbnails.length > DEFER_SCAN_BATCH_THUMBNAILS_THRESHOLD;

    if (!background) {
      if (filesNeedingThumbnails.length > 0) {
        progressText.textContent = deferScanThumbnails
          ? ''
          : `${filesNeedingThumbnails.length} models found`;
      } else {
        progressText.textContent = '';
      }
      renderProgressBar.style.width = '0%';
      renderProgressText.textContent = deferScanThumbnails
        ? 'Thumbnails will load as you scroll'
        : `0 / ${filesNeedingThumbnails.length} models`;
      if (!deferScanThumbnails) {
        container.innerHTML = '';
      }
    }

    if (filesNeedingThumbnails.length > 0 && deferScanThumbnails) {
      if (!background) {
        renderProgressBar.style.width = '100%';
        renderProgressText.textContent = `${filesNeedingThumbnails.length} models — open the grid to generate previews`;
      }
      window._scanThumbnailProgress = null;
      console.log(
        `[scan] Deferred ${filesNeedingThumbnails.length} thumbnails (threshold ${DEFER_SCAN_BATCH_THUMBNAILS_THRESHOLD}); lazy queue will render visible items.`
      );
    } else if (filesNeedingThumbnails.length > 0) {
      console.log(
        `[scan] Generating thumbnails for ${filesNeedingThumbnails.length} models (first: ${filesNeedingThumbnails[0].filePath})`
      );
      let completedThumbnails = 0;
      const thumbnailProgressUpdate = (completed) => {
        if (!background) {
          const progress = (completed / filesNeedingThumbnails.length) * 100;
          renderProgressBar.style.width = `${progress}%`;
          renderProgressText.textContent = `${completed} / ${filesNeedingThumbnails.length} models`;
        }
      };
      // So progress bar advances with every thumbnail completion (scan or grid), not only scan tasks
      window._scanThumbnailProgress = {
        completed: 0,
        total: filesNeedingThumbnails.length,
        onComplete() {
          this.completed++;
          const c = Math.min(this.completed, this.total);
          if (!background) {
            const progress = (c / this.total) * 100;
            renderProgressBar.style.width = `${progress}%`;
            renderProgressText.textContent = `${c} / ${this.total} models`;
          }
        }
      };

      // Improved thumbnail generation with concurrency control and cancellation
      // Higher concurrency in Server/Docker mode to compensate for slower file system operations
      const serverMode = await window.electron.isServerMode().catch(() => false);
      const maxConcurrentThumbnails = serverMode ? 10 : 5; // Higher concurrency in server/Docker mode
      const thumbnailQueue = [...filesNeedingThumbnails];
      const activePromises = new Set();
      
      while (thumbnailQueue.length > 0 && !isCancelled) {
        // Fill up to max concurrent thumbnails
        while (activePromises.size < maxConcurrentThumbnails && thumbnailQueue.length > 0) {
          const file = thumbnailQueue.shift();
          
          const promise = (async () => {
            try {
              const existing = existingThumbnails.get(file.filePath);
              if (existing && existing !== '3d.png' && (typeof existing !== 'string' || existing.trim() !== '')) {
                console.log(`Thumbnail found for ${file.filePath} in database. Skipping render.`);
                return;
              }
              
              // Add code to actually render the thumbnail
              // Use the same thumbnail generation code that's in renderFile
              const fileExtension = file.filePath.split('.').pop().toLowerCase();
              let thumbnail = null;
              
              if (fileExtension === '3mf') {
                try {
                  const images = await window.electron.get3MFImages(file.filePath);
                  if (images && images.length > 0) {
                    console.log(`[DEBUG] Found ${images.length} embedded image(s) in 3MF: ${file.filePath}`);
                    // Add all images to model's thumbnails at once using batch function
                    const addResult = await window.electron.addMultipleThumbnails(file.filePath, images);
                    // Use first image as thumbnail for display
                    thumbnail = images[0];
                    console.log(`[DEBUG] Added ${images.length} images to thumbnails for ${file.filePath}`);
                    
                    // If we're in detailed view and added multiple thumbnails, update the DOM item
                    if (addResult && addResult.success && addResult.thumbnailCount > 1 && currentGridView === 'detailed') {
                      // Update the existing item to show navigation controls
                      setTimeout(async () => {
                        try {
                          const allFileItems = document.querySelectorAll('.file-item');
                          const normalizedPath = normalizePathForComparison(file.filePath);
                          for (const fileItem of allFileItems) {
                            const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
                            const normalizedItemPath = normalizePathForComparison(itemPath);
                            if (normalizedItemPath === normalizedPath && fileItem.classList.contains('file-item-detailed')) {
                              // Get updated model with all thumbnails
                              const updatedModel = await window.electron.getModel(file.filePath);
                              if (updatedModel) {
                                const container = document.querySelector('.file-grid');
                                if (container && container.currentModels) {
                                  // Update the model in the array
                                  const modelIndex = container.currentModels.findIndex(m => 
                                    normalizePathForComparison(m.filePath) === normalizedPath
                                  );
                                  if (modelIndex >= 0) {
                                    container.currentModels[modelIndex] = updatedModel;
                                    // Remove the item so it gets recreated with navigation
                                    fileItem.remove();
                                    // Trigger re-render
                                    if (container.renderVisibleItemsFn) {
                                      container.renderVisibleItemsFn();
                                    }
                                    console.log(`[DEBUG] Updated DOM item for ${file.filePath} to show navigation controls`);
                                  }
                                }
                              }
                              break;
                            }
                          }
                        } catch (updateError) {
                          console.error(`[DEBUG] Error updating DOM for ${file.filePath}:`, updateError);
                        }
                      }, 300);
                    }
                  } else {
                    console.log(`[DEBUG] No embedded images found in 3MF: ${file.filePath}`);
                  }
                } catch (imageError) {
                  console.error('Error checking for embedded image:', imageError);
                }
              }
              
              if (!thumbnail) {
                thumbnail = await new Promise((resolve, reject) => {
                  renderQueue.push({
                    filePath: file.filePath,
                    container: document.createElement('div'), // Dummy container (not in DOM)
                    existingThumbnail: null,
                    resolve,
                    reject,
                    // Must survive pruneDisconnectedRenderTasks — dummy is never isConnected.
                    retainDetached: true,
                    thumbPriority: THUMB_PRIORITY_BACKGROUND
                  });
                  processRenderQueue();
                });
                
                if (thumbnail) {
                  await window.electron.saveThumbnail(file.filePath, thumbnail);
                }
              }
              
              // Calculate and save hash during thumbnail generation (file is already being read)
              if (!file.hash || file.hash === '') {
                try {
                  await window.electron.calculateFileHash(file.filePath);
                } catch (hashError) {
                  console.error(`Error calculating hash for ${file.filePath}:`, hashError);
                  // Continue even if hash calculation fails
                }
              }
            } catch (error) {
              console.error('Error caching thumbnail:', error);
            } finally {
              if (!window._scanThumbnailProgress) {
                completedThumbnails++;
                thumbnailProgressUpdate(completedThumbnails);
              }
              activePromises.delete(promise);
            }
          })();
          
          activePromises.add(promise);
        }
        
        // Wait for at least one promise to complete before continuing
        if (activePromises.size > 0) {
          await Promise.race(Array.from(activePromises));
        }
        
        // Check for cancellation after each batch
        if (isCancelled) {
          console.log('Thumbnail generation cancelled, stopping process');
          window._scanThumbnailProgress = null;
          break;
        }
      }
      
      // Wait for any remaining active promises to complete
      if (activePromises.size > 0) {
        await Promise.all(Array.from(activePromises));
      }
      window._scanThumbnailProgress = null;
    } else {
      if (!background) {
        renderProgressBar.style.width = '100%';
        renderProgressText.textContent = 'All thumbnails up to date';
      }
    }
    
    // Foreground scans: reset filter UI and counts. Background scans (Docker STL Home polling, etc.) skip this.
    if (!background) {
      document.getElementById('designer-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      const newSelFg = document.getElementById('new-select');
      if (newSelFg) newSelFg.value = 'all';
      document.getElementById('tag-filter').value = '';

      const totalInDb = await window.electron.getTotalModelCount();
      await updateModelCounts(totalInDb);
    }

    // "New Models Found" prompt: run for any scan that reported new inserts (including background/server STL Home).
    if (newFilesCount > 0) {
      if (background) {
        window.disableGridRefresh = false;
      }
      const result = await window.electron.showMessageBox({
        type: 'question',
        buttons: ['Yes', 'No'],
        defaultId: 0,
        title: 'New Models Found',
        message: `${newFilesCount} new model(s) found, would you like to see them?`
      });

      if (background) {
        skipBackgroundFinallyRefresh = true;
      }

      if (result.response === 0) {
        // User clicked "Yes" - apply dateAdded filter to show only newly added models
        window.dateAddedFilter = scanStartTime;
        window._lastDateAddedFilter = scanStartTime;
        console.log('Setting dateAddedFilter to:', scanStartTime);

        window._suppressFilterEvents = true;
        document.getElementById('designer-select').value = '';
        document.getElementById('parent-select').value = '';
        document.getElementById('printed-select').value = 'all';
        const newSelNm = document.getElementById('new-select');
        if (newSelNm) newSelNm.value = 'all';
        document.getElementById('tag-filter').value = '';
        document.getElementById('filetype-select').value = '';
        document.getElementById('search-filter-input').value = '';
        window.currentDirectoryFilter = null;
        window._suppressFilterEvents = false;

        await new Promise(resolve => setTimeout(resolve, 100));

        if (!window.dateAddedFilter) {
          console.warn('dateAddedFilter was cleared, resetting it');
          window.dateAddedFilter = scanStartTime;
          window._lastDateAddedFilter = scanStartTime;
        }

        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          const filteredModels = await window.electron.getModelsFiltered({
            dateAdded: scanStartTime
          });
          await renderFiles(filteredModels);
        }
      } else {
        window.dateAddedFilter = null;
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          const sortSelect = document.getElementById('sort-select');
          const fallbackModels = await window.electron.getAllModels(
            sortSelect ? sortSelect.value : 'date-desc',
            0
          );
          await renderFiles(fallbackModels);
        }
      }
    } else if (!background) {
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      } else {
        const sortSelect = document.getElementById('sort-select');
        const fallbackModels = await window.electron.getAllModels(
          sortSelect ? sortSelect.value : 'date-desc',
          0
        );
        await renderFiles(fallbackModels);
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', error);
    window._scanThumbnailProgress = null;
    if (!background) {
      renderProgressText.textContent = `Error: ${error.message}`;
      // Show alert for UNC path validation errors
      if (error.message && error.message.includes('UNC path')) {
        alert(`Error: ${error.message}\n\nIn server mode, all file paths must be UNC paths (e.g., \\\\server\\share\\path\\to\\file.stl)`);
      }
    }
  } finally {
    window._scanThumbnailProgress = null;
    // Clean up event listener
    stopButton.removeEventListener('click', handleStopClick);
    
    if (!background) {
      progressSection.classList.add('hidden');
    } else {
      window.disableGridRefresh = false;
      console.log('Background scan complete: grid refresh re-enabled');
      if (skipBackgroundFinallyRefresh) {
        console.log('Background scan: grid already refreshed after New Models dialog');
      } else {
        // Refresh the grid so models show without requiring a page reload (docker/server mode)
        if (typeof window.performCombinedSearch === 'function') {
          window.performCombinedSearch().catch(err => console.error('Background scan post-refresh:', err));
        } else {
          window.electron.getAllModels().then((models) => {
            if (typeof window.renderFiles === 'function') window.renderFiles(models);
          }).catch(err => console.error('Background scan post-refresh:', err));
        }
      }
    }
  }
}

// Process 2: Model Display and Management
async function refreshModelDisplay() {
  try {
    // Get current filter values
    const designer = document.getElementById('designer-select').value;
    const license = document.getElementById('license-select').value;
    const parentModel = document.getElementById('parent-select').value;
    const printStatus = document.getElementById('printed-select').value;
    const newStatus = document.getElementById('new-select')?.value || 'all';
    const favoriteStatus = document.getElementById('favorite-select')?.value || 'all';
    const ratingStatus = document.getElementById('rating-select')?.value || 'all';
    const ratingMinStatus = document.getElementById('rating-min-select')?.value || 'all';
    const tagFilter = document.getElementById('tag-filter').value;
    const sortOption = document.getElementById('sort-select').value;
    const fileType = document.getElementById('filetype-select').value; // Add this line
    const searchInput = document.getElementById("search-filter-input");
    const searchTerm = searchInput ? searchInput.value.trim() : "";

    

    
    // Restore filter selections
    document.getElementById('designer-select').value = designer;
    document.getElementById('license-select').value = license;
    document.getElementById('parent-select').value = parentModel;
    document.getElementById('printed-select').value = printStatus;
    const newSelRestore = document.getElementById('new-select');
    if (newSelRestore) newSelRestore.value = newStatus;
    const favSelRestore = document.getElementById('favorite-select');
    if (favSelRestore) favSelRestore.value = favoriteStatus;
    const ratingSelRestore = document.getElementById('rating-select');
    if (ratingSelRestore) ratingSelRestore.value = ratingStatus;
    const ratingMinSelRestore = document.getElementById('rating-min-select');
    if (ratingMinSelRestore) ratingMinSelRestore.value = ratingMinStatus;
    document.getElementById('tag-filter').value = tagFilter;
    document.getElementById('filetype-select').value = fileType; // Add this line

    // Get all models with current sort option
    let models = await window.electron.getAllModels(sortOption, 0);

    // Add file type filter
    if (fileType) {
      if (fileType.toLowerCase() === 'zip') {
        // For zip filter, show all models inside ZIP archives (entries with :: separator)
        models = models.filter(model => 
          model.filePath && model.filePath.includes('::')
        );
      } else {
        models = models.filter(model => 
          model.fileName.toLowerCase().endsWith(`.${fileType.toLowerCase()}`)
        );
      }
    }

    // Apply filters
    if (designer) {
      if (designer === '__none__') {
        models = models.filter(model => !model.designer || model.designer.trim() === '');
      } else {
        models = models.filter(model =>
          model.designer &&
          model.designer.trim().toLowerCase() === designer.trim().toLowerCase()
        );
      }
    }
    if (license) {
      if (license === '__none__') {
        models = models.filter(model => !model.license || model.license.trim() === '');
      } else {
        models = models.filter(model => model.license === license);
      }
    }
    if (parentModel) {
      if (parentModel === '__none__') {
        models = models.filter(model => !model.parentModel || model.parentModel.trim() === '');
      } else {
        models = models.filter(model => model.parentModel === parentModel);
      }
    }
    if (printStatus === 'printed') {
      models = models.filter(model => model.printed);
    } else if (printStatus === 'not-printed') {
      models = models.filter(model => !model.printed);
    }
    if (newStatus === 'new') {
      models = models.filter(model => isModelNew(model));
    } else if (newStatus === 'not-new') {
      models = models.filter(model => !isModelNew(model));
    }
    if (favoriteStatus === 'favorited') {
      models = models.filter(model => Boolean(model.favorite));
    } else if (favoriteStatus === 'not-favorited') {
      models = models.filter(model => !model.favorite);
    }
    if (ratingStatus === 'unrated') {
      models = models.filter(model => normalizeModelRatingValue(model.rating) === 0);
    } else if (ratingStatus !== 'all' && /^[1-5]$/.test(ratingStatus)) {
      const exact = parseInt(ratingStatus, 10);
      models = models.filter(model => normalizeModelRatingValue(model.rating) === exact);
    }
    if (ratingMinStatus !== 'all' && /^[1-5]$/.test(ratingMinStatus)) {
      const min = parseInt(ratingMinStatus, 10);
      models = models.filter(model => normalizeModelRatingValue(model.rating) >= min);
    }
    if (tagFilter) {
      models = await Promise.all(models.map(async (model) => {
        const modelTags = await window.electron.getModelTags(model.id);
        if (modelTags && modelTags.some(tag => tag.name === tagFilter)) {
          return model;
        }
        return null;
      }));
      models = models.filter(model => model !== null);
    }

    // Display filtered models
    await displayModels(models);
  } catch (error) {
    console.error('Error refreshing model display:', error);
  }
}

// ==================== Modified displayModels() to use the virtual grid ====================
async function displayModels(files) {
  // Keep behavior aligned with renderFiles (handleFilterChange uses this path, not renderFiles)
  if (shouldSyncSelectionWithFilteredList()) {
    syncSelectionWithFilteredModels(files);
  }
  const gridFiles = dedupeModelsForVirtualGrid(files || []);
  renderVirtualGrid(gridFiles);
  if (shouldSyncSelectionWithFilteredList()) {
    syncSelectionWithFilteredModels(files);
  }
  await updateModelCounts(gridFiles.length);
}


// Add event listeners for all filter changes
document.addEventListener('DOMContentLoaded', () => {
  const filterElements = [
    'designer-select',
    'license-select',
    'parent-select',
    'printed-select',
    'new-select',
    'tag-filter',
    // Note: sort-select is handled by search.js via initializeCombinedSearch()
    'filetype-select'  // Add this line
  ];

  filterElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', handleFilterChange);
    }
  });
});

// Add this near the top with other constants
const GC_INTERVAL = 100; // Number of models to process before garbage collection

// Update the renderFiles function to handle pagination
async function renderFiles(files, skipThumbnail = false, viewEntireLibrary = false) {
  if (window.disableGridRefresh) {
    console.log('Grid refresh is disabled, skipping renderFiles');
    return;
  }
  
  // Defensive: If dateAddedFilter is active and we're being called with many models,
  // filter them to preserve the "new models" view
  // This prevents something from bypassing performCombinedSearch and showing all models
  // BUT: Only apply this if the user hasn't actively cleared filters (check if search/filters are empty)
  const searchInput = document.getElementById('search-filter-input');
  const hasActiveUserFilters = searchInput?.value.trim() || 
                               document.getElementById('designer-select')?.value ||
                               document.getElementById('tag-filter')?.value ||
                               document.getElementById('filetype-select')?.value;
  
  if (window.dateAddedFilter && files.length > 10 && !hasActiveUserFilters) {
    console.warn('renderFiles called with', files.length, 'models while dateAddedFilter is active! Filtering to preserve new models view...');
    const filterDate = new Date(window.dateAddedFilter);
    const originalCount = files.length;
    files = files.filter(model => {
      if (!model.dateAdded) return false;
      const modelDate = new Date(model.dateAdded);
      return modelDate >= filterDate;
    });
    console.log('Filtered from', originalCount, 'to', files.length, 'models');
  }

  // search.js replaces filter controls and only calls performCombinedSearch — selection was not cleared.
  // Drop selection and details when the current model(s) are not in the filtered result (skip progressive full-library loads).
  if (shouldSyncSelectionWithFilteredList()) {
    syncSelectionWithFilteredModels(files);
  }

  // Use the new virtual grid implementation for better performance
  const gridFiles = dedupeModelsForVirtualGrid(files || []);
  renderVirtualGrid(gridFiles);

  // Run again after the grid exists: path/name resolution and DOM can differ; catches stale selection UI
  if (shouldSyncSelectionWithFilteredList()) {
    syncSelectionWithFilteredModels(files);
  }

  // Update counts
  await updateModelCounts(gridFiles.length);

  // Handle thumbnail generation for visible items?
  // renderVirtualGrid handles creating items, but thumbnail generation might need to be triggered
  // for visible items if they don't have thumbnails.
  // Ideally, createModelItem should queue thumbnail generation if missing.
  // Since createModelItem calls renderModelToPNG only if needed (in our updated logic? No, createModelItem uses '3d.png' default).
  // We might want to trigger thumbnail generation for models without thumbnails in the background.

  // Note: renderVirtualGrid doesn't currently trigger thumbnail generation automatically for missing thumbnails
  // except what createModelItem does.
  // createModelItem in the new code uses model.thumbnail || '3d.png'.

  // Trigger background thumbnail generation for files without thumbnails
  // This maintains the previous behavior but decouples it from the initial render
  const filesWithoutThumbnails = files.filter(file => !file.thumbnail);
  if (filesWithoutThumbnails.length > 0) {
    // We can use the existing queue mechanism
    filesWithoutThumbnails.forEach(file => {
       // Only queue if we haven't already queued it?
       // For now, let's rely on the user triggers or existing background processes.
       // Or we can queue them here.
    });
  }
}

// Helper function to wait for window.getCombinedFilteredModels to be available
// This handles the case where search.js module hasn't finished loading yet
async function waitForGetCombinedFilteredModels(maxWait = 5000) {
  const startTime = Date.now();
  while (!window.getCombinedFilteredModels && (Date.now() - startTime) < maxWait) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  if (!window.getCombinedFilteredModels) {
    throw new Error('getCombinedFilteredModels function not available after waiting. search.js may not have loaded properly.');
  }
  return window.getCombinedFilteredModels;
}

async function handleFilterChange() {
  try {
    resetFilterSelectionAndDetails();

    // Get and display filtered models
    // Wait for getCombinedFilteredModels to be available (handles module loading race condition)
    console.log('handleFilterChange: About to get filtered models. invertedFilters:', invertedFilters);
    const getFilteredModels = await waitForGetCombinedFilteredModels();
    const models = await getFilteredModels();
    console.log('handleFilterChange: Got', models.length, 'models. About to display them.');
    await displayModels(models);
    if (window.updateFilterIndicator) {
      window.updateFilterIndicator(models.length);
    }
    console.log('handleFilterChange: Models displayed.');
  } catch (error) {
    console.error("Error applying filters:", error);
  }
}

async function renderFile(file, container, skipThumbnail = false) {
  const fileElement = document.createElement('div');
  fileElement.className = 'file-item';
  fileElement.dataset.filepath = file.filePath; // Use dataset for data attributes

  if (isInSelectedModels(file.filePath)) {
    fileElement.classList.add('selected');
  }

  const printStatus = document.createElement('div');
  printStatus.className = `print-status ${file.printed? 'printed': ''}`;
  printStatus.textContent = file.printed? 'Printed': 'Not Printed';
  fileElement.appendChild(printStatus);

  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'thumbnail-container loading';
  fileElement.appendChild(thumbnailContainer);

  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  
  const isUrlModel = file.filePath && file.filePath.startsWith('url::');
  const isZipEntry = file.filePath.includes('::') && !isUrlModel;
  if (isUrlModel) {
    const urlBadge = document.createElement('span');
    urlBadge.className = 'url-badge';
    urlBadge.textContent = 'URL';
    urlBadge.title = 'Online model - click directory to open in browser';
    urlBadge.style.cssText = 'background: #2d7a2d; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-right: 6px;';
    fileName.appendChild(urlBadge);
  }
  if (isZipEntry) {
    const zipBadge = document.createElement('span');
    zipBadge.className = 'zip-badge';
    zipBadge.textContent = 'ZIP';
    zipBadge.title = 'This model is inside a ZIP archive';
    zipBadge.style.cssText = 'background: #4a90e2; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-right: 6px;';
    fileName.appendChild(zipBadge);
  }
  
  const fileNameText = document.createElement('span');
  fileNameText.textContent = file.fileName;
  fileName.appendChild(fileNameText);
  fileInfo.appendChild(fileName);

  // For zip entries, show zip location on disk + entry folder; for URL models show "Open in browser"
  let parentDir;
  if (isUrlModel) {
    parentDir = 'Open in browser';
  } else {
    parentDir = getDirectoryDisplayLabel(file.filePath);
  }
  
  const parentDirElement = document.createElement('div');
  parentDirElement.className = 'parent-directory';
  const dirLabel = document.createElement('span');
  dirLabel.className = 'directory-label';
  dirLabel.textContent = isUrlModel ? 'Source:' : 'Directory:';
  const dirLink = document.createElement('a');
  dirLink.href = '#';
  dirLink.className = 'directory-link';
  dirLink.textContent = parentDir || '';
  if (parentDir && !isUrlModel) {
    dirLink.title = getParentDirectoryFullPath(file.filePath) || parentDir;
  }
  parentDirElement.appendChild(dirLabel);
  parentDirElement.appendChild(document.createTextNode(' '));
  parentDirElement.appendChild(dirLink);
  
  dirLink.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Hide any welcome or view library message.
      const viewLibMsg = document.getElementById("view-library-message");
      if (viewLibMsg) { viewLibMsg.style.display = "none"; }
      
      if (isUrlModel) {
        try {
          await window.electron.openPath(file.filePath);
        } catch (err) {
          console.error('Error opening URL:', err);
        }
        return;
      }
      // For zip entries, open the zip file's directory in the file explorer
      if (isZipEntry) {
        try {
          const [zipPath] = file.filePath.split('::');
          await window.electron.showItemInFolder(zipPath);
        } catch (error) {
          console.error('Error opening zip file directory:', error);
        }
        return;
      }
      
      // Extract the full path up to the parent directory for filtering
      let directoryFilterPath;
      // For regular files, get the full path up to the parent directory
      // Make sure we're getting the directory, not the file itself
      const lastSlash = Math.max(file.filePath.lastIndexOf('\\'), file.filePath.lastIndexOf('/'));
      if (lastSlash > 0) {
        directoryFilterPath = file.filePath.substring(0, lastSlash);
        // Ensure we have a valid directory path (not a file path)
        if (!directoryFilterPath || directoryFilterPath.endsWith('.zip') || directoryFilterPath.endsWith('.stl') || directoryFilterPath.endsWith('.3mf')) {
          // If somehow we got a file path, extract the parent directory again
          const parentSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
          directoryFilterPath = parentSlash > 0 ? directoryFilterPath.substring(0, parentSlash) : '';
        }
      } else {
        directoryFilterPath = '';
      }
      
      // Validate that we have a directory path, not a file path
      // Check for common file extensions (case-insensitive)
      const lowerPath = directoryFilterPath.toLowerCase();
      if (directoryFilterPath && (lowerPath.endsWith('.zip') || lowerPath.endsWith('.stl') || lowerPath.endsWith('.3mf') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.ply'))) {
        console.warn('Directory filter appears to be a file path, extracting parent directory:', directoryFilterPath);
        const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
        directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
      }
      
      // Final validation: ensure we don't have a file path
      if (directoryFilterPath && directoryFilterPath === file.filePath) {
        console.error('Directory filter is same as file path, this should not happen. File path:', file.filePath);
        const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
        directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
      }
      
      console.log('Setting directory filter to:', directoryFilterPath, 'from file path:', file.filePath);
      
      // Set the global directory filter with the full path
      window.currentDirectoryFilter = directoryFilterPath;
      if (window.viewingEntireLibrary) {
        window.viewingEntireLibrary = false;
      }
      // Restore this folder's view preference (list/preview/detailed) when switching folders
      if (typeof window.applyViewForCurrentFolder === 'function') {
        await window.applyViewForCurrentFolder();
      }
      // Instead of filtering just by directory here, trigger the combined search which applies all filters.
      // The updateFilterIndicator function in search.js will handle displaying the filter correctly
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      }
    });

  fileInfo.appendChild(parentDirElement);

 

  const fileDetails = document.createElement('div');
  fileDetails.className = 'file-details';
  fileDetails.innerHTML = `<span class="directory-label">Size:
    <span>${file.size? formatFileSize(file.size): ''}</span>
  `;
  fileInfo.appendChild(fileDetails);
  fileElement.appendChild(fileInfo);

  fileElement.addEventListener('click', () => {
    toggleModelSelection(fileElement, file.filePath);
  });
 // Designer info is now shown in metadata section, so we don't need it here
 // Removed redundant designer info display

  if (!file.thumbnail &&!skipThumbnail) {
    const fileExtension = file.filePath.split('.').pop().toLowerCase();
    if (fileExtension === '3mf') {
      try {
        const images = await window.electron.get3MFImages(file.filePath);
        if (images && images.length > 0) {
          const firstImage = images[0];
          console.log(`[DEBUG] renderFile: Using ${images.length} embedded image(s) from 3MF: ${file.filePath}`);
          const img = document.createElement('img');
          img.src = firstImage;
          img.className = 'model-thumbnail';
          thumbnailContainer.innerHTML = '';
          thumbnailContainer.appendChild(img);
          thumbnailContainer.classList.remove('loading');

          await window.electron.addMultipleThumbnails(file.filePath, images);
          file.thumbnail = firstImage;

          return fileElement;
        } else {
          console.log(`[DEBUG] renderFile: No embedded images found in 3MF: ${file.filePath}`);
        }
      } catch (imageError) {
        console.error('renderFile: Error checking for embedded image:', imageError);
      }
    }

    try {
      const thumbnail = await new Promise((resolve, reject) => {
        renderQueue.push({
          filePath: file.filePath,
          container: thumbnailContainer,
          existingThumbnail: null,
          resolve,
          reject,
          thumbPriority: THUMB_PRIORITY_BACKGROUND
        });
        processRenderQueue();
      });

      if (thumbnail) {
        await window.electron.saveThumbnail(file.filePath, thumbnail);
        
        // Calculate and save hash during thumbnail generation (file is already being read)
        if (!file.hash || file.hash === '') {
          try {
            await window.electron.calculateFileHash(file.filePath);
          } catch (hashError) {
            console.error(`Error calculating hash for ${file.filePath}:`, hashError);
            // Continue even if hash calculation fails
          }
        }
      }
    } catch (error) {
      console.error(`Error rendering thumbnail for ${file.fileName}:`, error);
      thumbnailContainer.innerHTML = '<div class="error-message">Error loading model</div>';
    }
  } else if (file.thumbnail) { // Check if file.thumbnail exists before creating img element
    const img = document.createElement('img');
    img.src = file.thumbnail || '3d.png'; // Provide a default image
    img.className = 'model-thumbnail'; // Add class for styling
    thumbnailContainer.innerHTML = '';
    thumbnailContainer.appendChild(img);
    thumbnailContainer.classList.remove('loading');
  }

  addContextMenuHandler(fileElement, file.filePath);

  return fileElement;
}

async function processRenderQueue() {
  if (window._serverBulkThumbnailJobActive) {
    // Drain only after the bulk job ends; do not start WebGL work meanwhile.
    return;
  }
  if (isProcessingQueue || renderQueue.length === 0 || activeRenders >= effectiveMaxConcurrentRenders()) {
    return;
  }

  isProcessingQueue = true;

  try {
    // Start up to effectiveMaxConcurrentRenders() tasks in parallel (don't await inside loop)
    while (renderQueue.length > 0 && activeRenders < effectiveMaxConcurrentRenders()) {
      const task = dequeueNextRenderTask();
      if (!task) break;
      activeRenders++;

      if (task.filePath) activeThumbnailRenders.add(task.filePath);

      (async () => {
        try {
          const result = await renderModelToPNG(task.filePath, task.container, task.existingThumbnail, {
            retainDetached: !!task.retainDetached
          });
          task.resolve(result);
          // So progress bar stays in sync with visible thumbnails (scan and grid share the same queue)
          if (window._scanThumbnailProgress && typeof window._scanThumbnailProgress.onComplete === 'function') {
            window._scanThumbnailProgress.onComplete();
          }
        } catch (error) {
          if (!isBenignThumbnailDropError(error)) {
            console.error(`Render task failed: ${error.message}`);
          }
          const isWebGLHardFail = /Error creating WebGL context/i.test(error && error.message ? error.message : '');
          if (isWebGLHardFail) {
            // Do not requeue forever when the GPU/WebGL stack cannot create a context.
            task.reject(error);
          } else if (isBenignThumbnailDropError(error)) {
            if (typeof task.reject === 'function') task.reject(error);
          } else {
            // Retry once after longer delay
            setTimeout(() => enqueueRenderTask(task), 2000);
          }
        } finally {
          if (task.filePath) activeThumbnailRenders.delete(task.filePath);
          activeRenders--;
          const pauseMs = isLowPriorityThumbnailTask(task) ? RENDER_DELAY_BACKGROUND : RENDER_DELAY;
          await new Promise(resolve => setTimeout(resolve, pauseMs));
          if (renderQueue.length > 0) {
            setTimeout(processRenderQueue, 0);
          }
        }
      })();
    }
  } finally {
    isProcessingQueue = false;
    if (renderQueue.length > 0) {
      const backlogMs = renderQueueHasOnlyLowPriorityWork() ? 350 : 100;
      setTimeout(processRenderQueue, backlogMs);
    }
  }
}

// 2. Optimize renderer settings and reuse renderer instance
let sharedCanvas = null;
let sharedWebGLUnavailable = false;

function createThumbnailWebGLRenderer(canvas) {
  // Prefer options that succeed on macOS Electron; fall back if a preference is rejected.
  const attempts = [
    { antialias: false, alpha: true, canvas, preserveDrawingBuffer: true, powerPreference: 'default', failIfMajorPerformanceCaveat: false },
    { antialias: false, alpha: true, canvas, preserveDrawingBuffer: true, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false },
    { antialias: false, alpha: true, canvas, preserveDrawingBuffer: true, failIfMajorPerformanceCaveat: false },
    { antialias: false, alpha: true, canvas, preserveDrawingBuffer: true }
  ];
  let lastError = null;
  for (const opts of attempts) {
    try {
      const renderer = new THREE.WebGLRenderer(opts);
      if (renderer.debug) {
        // Some WebGL stacks return null from getProgramInfoLog/getShaderInfoLog; Three.js calls .trim() and throws.
        renderer.debug.checkShaderErrors = false;
      }
      return renderer;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Error creating WebGL context.');
}

function getSharedRenderer() {
  if (sharedWebGLUnavailable) {
    throw new Error('Error creating WebGL context.');
  }
  if (!sharedRenderer || contextUseCount >= maxContextReuseCount) {
    // Soft recycle: dispose only. forceContextLoss restarts the GPU process and
    // produces Skia OOM / CreateSharedImage stderr storms in Docker (NVIDIA).
    if (sharedRenderer) {
      try {
        sharedRenderer.dispose();
      } catch (_) { /* ignore */ }
      sharedRenderer = null;
    }
    if (sharedCanvas) {
      sharedCanvas.remove();
      sharedCanvas = null;
    }

    // Create new canvas and attach to DOM. Detached canvases often fail getContext('webgl') on macOS Electron.
    sharedCanvas = document.createElement('canvas');
    sharedCanvas.width = 250;
    sharedCanvas.height = 250;
    sharedCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(sharedCanvas.style, {
      position: 'fixed',
      left: '-9999px',
      top: '0',
      width: '250px',
      height: '250px',
      opacity: '0',
      pointerEvents: 'none'
    });
    document.body.appendChild(sharedCanvas);

    try {
      sharedRenderer = createThumbnailWebGLRenderer(sharedCanvas);
    } catch (err) {
      sharedWebGLUnavailable = true;
      if (sharedCanvas) {
        sharedCanvas.remove();
        sharedCanvas = null;
      }
      console.error('WebGL unavailable for thumbnails:', err && err.message ? err.message : err);
      throw err;
    }

    contextUseCount = 0;

    // Add context loss handler
    sharedCanvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      sharedWebGLUnavailable = false;
      try {
        if (sharedRenderer) {
          sharedRenderer.dispose();
        }
      } catch (_) { /* ignore */ }
      sharedRenderer = null;
      if (sharedCanvas) {
        sharedCanvas.remove();
        sharedCanvas = null;
      }
      contextUseCount = 0;
    }, false);
  }
  contextUseCount++;
  return sharedRenderer;
}

async function renderModelToPNG(filePath, container, existingThumbnail, options = {}) {
  const retainDetached = !!(options && options.retainDetached);
  const startTime = Date.now();
  console.log(`[DEBUG] renderModelToPNG: Start rendering ${filePath}`);
  if (existingThumbnail) {
    const img = document.createElement('img');
    img.src = existingThumbnail;
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);
    return existingThumbnail;
  }

  // URL-only models (from Chrome extension) have no file to render; show placeholder
  if (filePath && filePath.startsWith('url::')) {
    const img = document.createElement('img');
    img.src = '3d.png';
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);
    return '3d.png';
  }

  // For 3MF files, check for embedded images BEFORE 3D rendering
  // Handle ZIP entries: get extension from entry path if it's a ZIP entry
  let fileExtension;
  if (filePath.includes('::')) {
    // ZIP entry: get extension from the entry part after ::
    const entryPath = filePath.split('::')[1];
    fileExtension = entryPath.split('.').pop().toLowerCase();
  } else {
    fileExtension = filePath.split('.').pop().toLowerCase();
  }
  
  if (fileExtension === '3mf') {
    try {
      // Scroll hydrate only needs a few top-scoring plate/cover images.
      // Fetching every embedded PNG over the WebSocket bridge OOMs Docker on large libraries.
      const images = await window.electron.get3MFImages(filePath, {
        maxImages: 3,
        quiet: true
      });
      // Cell scrolled away while we extracted — abandon (will re-queue if it returns).
      // Scan/batch jobs use a detached dummy container on purpose (retainDetached).
      if (container && !container.isConnected && !retainDetached) {
        return null;
      }
      if (images && images.length > 0) {
        // Add all images to model's thumbnails at once using batch function
        let result = null;
        try {
          result = await window.electron.addMultipleThumbnails(filePath, images);
          if (container && !container.isConnected && !retainDetached) {
            return images[0];
          }

          // After adding thumbnails, update the model in memory if we can find it
          if (result && result.success) {
            // Prefer the images we already have — avoid a second full getAllThumbnails WS round-trip.
            const allThumbs = images;
            
            // Update the model object in memory if we can find it
            // This will help when the item is re-rendered
            const allFileItems = document.querySelectorAll('.file-item');
            const normalizedPath = normalizePathForComparison(filePath);
            for (const item of allFileItems) {
              const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedPath) {
                // Store the updated thumbnail string on the element
                item.dataset.thumbnail = result.thumbnailString || '';
                
                // If we added multiple thumbnails, update the existing DOM item to add navigation controls
                if (allThumbs.length > 1 && currentGridView === 'detailed') {
                  // Find the existing item and add navigation if in detailed view
                  const allFileItems = document.querySelectorAll('.file-item');
                  const normalizedPath = normalizePathForComparison(filePath);
                  for (const fileItem of allFileItems) {
                    const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
                    const normalizedItemPath = normalizePathForComparison(itemPath);
                    if (normalizedItemPath === normalizedPath) {
                      // Check if it's in detailed view
                      if (fileItem.classList.contains('file-item-detailed')) {
                        const existingContainer = fileItem.querySelector('.thumbnail-container');
                        const existingWrapper = fileItem.querySelector('.thumbnail-wrapper');
                        
                        // If navigation wrapper doesn't exist, create it
                        if (existingContainer && !existingWrapper) {
                          // Get the updated model with all thumbnails
                          const updatedModel = await window.electron.getModel(filePath);
                          if (updatedModel && updatedModel.thumbnail) {
                            // Re-create the item with navigation - this is the cleanest approach
                            // But for now, let's just trigger a refresh of this specific item
                            // by removing it and letting the virtual grid recreate it
                            const container = document.querySelector('.file-grid');
                            if (container && container.currentModels) {
                              // Update the model in the array
                              const modelIndex = container.currentModels.findIndex(m => 
                                normalizePathForComparison(m.filePath) === normalizedPath
                              );
                              if (modelIndex >= 0) {
                                container.currentModels[modelIndex] = updatedModel;
                                // Remove the item so it gets recreated
                                fileItem.remove();
                                // Trigger re-render
                                if (container.renderVisibleItemsFn) {
                                  setTimeout(() => {
                                    container.renderVisibleItemsFn();
                                  }, 100);
                                }
                              }
                            }
                          }
                        }
                      }
                      break;
                    }
                  }
                }
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error adding multiple thumbnails:', error);
        }
        // Use first image for display
        const firstImage = images[0];
        const img = document.createElement('img');
        img.src = firstImage;
        img.style.width = '250px';
        img.style.height = '250px';
        container.innerHTML = '';
        container.appendChild(img);
        return firstImage;
      }
    } catch (imageError) {
      console.error('Error checking for embedded image:', imageError);
    }
  }

  // Non-previewable types: show typed placeholder (file type label on image)
  if (fileExtension !== 'stl' && fileExtension !== '3mf' && fileExtension !== 'obj' && fileExtension !== 'svg') {
    const dataUrl = generateTypedPlaceholder(fileExtension);
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);
    return dataUrl;
  }

  // SVG: try to load file and show as image; on failure use typed placeholder
  if (fileExtension === 'svg') {
    try {
      const buf = await window.electron.readModelFile(filePath);
      if (buf && (buf instanceof ArrayBuffer || buf.byteLength)) {
        const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
        const decoder = new TextDecoder();
        const svgText = decoder.decode(bytes);
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
        const img = document.createElement('img');
        img.style.width = '250px';
        img.style.height = '250px';
        container.innerHTML = '';
        container.appendChild(img);
        img.src = dataUrl;
        return dataUrl;
      }
    } catch (e) { /* ignore */ }
    const fallback = generateTypedPlaceholder('svg');
    const img = document.createElement('img');
    img.src = fallback;
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);
    return fallback;
  }

  let scene, camera;
  let model = null; // Declare model in outer scope
  let renderer;
  try {
    renderer = getSharedRenderer();
  } catch (webglError) {
    console.error('WebGL unavailable, using placeholder:', webglError && webglError.message ? webglError.message : webglError);
    const corruptedDataUrl = generateCorruptedPlaceholder();
    const img = document.createElement('img');
    img.src = corruptedDataUrl;
    img.style.width = '250px';
    img.style.height = '250px';
    img.alt = 'WebGL unavailable';
    container.innerHTML = '';
    container.appendChild(img);
    return null;
  }

  try {
    renderer.setSize(250, 250);
    scene = new THREE.Scene();
    // Match preview.js far plane — large plates (400mm+) put the camera well past 1000.
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);

    renderer.setClearColor(0x000000, 0);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    scene.add(ambientLight);

    // Check if advanced lighting is enabled (default true)
    const useAdvancedLighting = window.currentRenderLighting !== undefined ? window.currentRenderLighting : true;

    if (useAdvancedLighting) {
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
      directionalLight.position.set(5, 10, 7.5);
      scene.add(directionalLight);
      
      const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
      fillLight.position.set(-5, 5, -7.5);
      scene.add(fillLight);
    } else {
       // Fallback to simple directional light if advanced lighting is disabled
      const simpleLight = new THREE.DirectionalLight(0xffffff, 1.0);
      simpleLight.position.set(1, 1, 1).normalize();
      scene.add(simpleLight);
    }

    // Use loadModel function which has proper path encoding handling and embedded image check
    // loadModel is available globally via window.loadModel
    const loadModelFunc = window.loadModel || loadModel;
    if (!loadModelFunc) {
      throw new Error('loadModel function is not available.');
    }

    // Add a timeout to prevent hanging indefinitely (e.g. on network shares or parsing errors)
    // Split 3MF (MeshyAI / Bambu Production Extension) can be 100MB+ of XML.
    const timeoutMs = fileExtension === '3mf' ? 120000 : 30000;
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Loading model timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      model = await Promise.race([
        loadModelFunc(filePath),
        timeoutPromise
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    // Cell recycled / scrolled away during load — abandon; visible hydrate will re-queue.
    if (container && !container.isConnected && !retainDetached) {
      return null;
    }

    if (!model) {
      console.log(`[DEBUG] renderModelToPNG: loadModel returned null (embedded image, zip container, or url), using placeholder`);
      const img = document.createElement('img');
      img.src = '3d.png';
      img.style.width = '250px';
      img.style.height = '250px';
      container.innerHTML = '';
      container.appendChild(img);
      return '3d.png';
    }
    
    scene.add(model);
    fitCameraToObject(camera, model, scene, renderer);
    renderer.render(scene, camera);

    let imgData = renderer.domElement.toDataURL('image/png');
    if (await isMostlyEmptyThumbnailDataUrl(imgData)) {
      // One retry with a wider framing — common for large flat STLs that were clipped.
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
      const cameraZ = maxDim * 2.5;
      const cameraDistance = cameraZ * Math.sqrt(3);
      camera.near = Math.max(0.01, cameraDistance / 1000);
      camera.far = Math.max(20000, cameraDistance * 20);
      camera.updateProjectionMatrix();
      camera.position.set(cameraZ, cameraZ * 0.7, cameraZ);
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      imgData = renderer.domElement.toDataURL('image/png');
    }

    const img = document.createElement('img');
    img.src = imgData;
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);

    return imgData;

  } catch (error) {
    console.error('Error rendering model:', error);
    const corruptedDataUrl = generateCorruptedPlaceholder();
    const img = document.createElement('img');
    img.src = corruptedDataUrl;
    img.style.width = '250px';
    img.style.height = '250px';
    img.alt = 'Model may be corrupted';
    container.innerHTML = '';
    container.appendChild(img);
    // Return null so callers do not persist failure art as a "real" thumbnail.
    return null;
  } finally {
    // Cleanup code that uses model
    if (model) {
      model.traverse(child => {
        if (child.geometry) {
          child.geometry.dispose();
          child.geometry = null;
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m && m.dispose());
          } else {
            child.material.dispose();
          }
        }
      });
      model = null;
    }

    if (scene) {
      scene.traverse((object) => {
        if (object.geometry) {
          object.geometry.dispose();
          object.geometry = null;
        }
        if (object.material) {
          if (Array.isArray(object.material)) {
            object.material.forEach(material => {
              material && material.dispose();
            });
          } else {
            object.material.dispose();
          }
        }
      });
      scene.clear();
      scene = null;
    }

    // Reset renderer state but keep the instance
    if (sharedRenderer) {
      sharedRenderer.clear();
    }

    camera = null;
  }
}



// Helper functions to manage selectedModels with normalized paths
function addToSelectedModels(filePath) {
  const normalized = normalizePathForComparison(filePath);
  // Find the original path format from selectedModels or DOM to maintain consistency
  let originalPath = filePath;
  for (const path of selectedModels) {
    if (normalizePathForComparison(path) === normalized) {
      originalPath = path; // Use existing format
      break;
    }
  }
  selectedModels.add(originalPath);
  return originalPath;
}

function removeFromSelectedModels(filePath) {
  const normalized = normalizePathForComparison(filePath);
  for (const path of selectedModels) {
    if (normalizePathForComparison(path) === normalized) {
      selectedModels.delete(path);
      return path;
    }
  }
  return null;
}

function isInSelectedModels(filePath) {
  const normalized = normalizePathForComparison(filePath);
  for (const path of selectedModels) {
    if (normalizePathForComparison(path) === normalized) {
      return true;
    }
  }
  return false;
}

/** Match search.js: full-library progressive load returns partial rows — do not clear selection in that case. */
function shouldSyncSelectionWithFilteredList() {
  const designer = document.getElementById('designer-select')?.value || '';
  const license = document.getElementById('license-select')?.value || '';
  const parentModel = document.getElementById('parent-select')?.value || '';
  const printStatus = document.getElementById('printed-select')?.value || 'all';
  const newStatus = document.getElementById('new-select')?.value || 'all';
  const tagFilter = document.getElementById('tag-filter')?.value || '';
  const fileType = document.getElementById('filetype-select')?.value || '';
  const searchTerm = (document.getElementById('search-filter-input')?.value || '').trim();
  const qbClauses =
    typeof window.queryBuilderHasActiveSearchClauses === 'function' &&
    window.queryBuilderHasActiveSearchClauses();
  const qbMulti =
    typeof window.queryBuilderHasActiveMultiFilters === 'function' &&
    window.queryBuilderHasActiveMultiFilters();
  const noFiltersActive = !designer && !license && !parentModel && printStatus === 'all' &&
    newStatus === 'all' &&
    !tagFilter && !fileType && !searchTerm && !qbClauses && !qbMulti &&
    !window.currentDirectoryFilter && !window.dateAddedFilter;
  const useProgressiveFullLibrary = noFiltersActive;
  return !useProgressiveFullLibrary;
}

function clearModelDetailsSidebar() {
  currentModelDetailsPath = null;
  currentModelDetailsAbort = true;
  const pathTreeContainer = document.getElementById('path-tree-container');
  if (pathTreeContainer) {
    pathTreeContainer.innerHTML = '';
    pathTreeContainer.removeAttribute('data-file-path');
  }
  const mn = document.getElementById('model-name');
  if (mn) mn.value = '';
  const md = document.getElementById('model-designer');
  if (md) md.value = '';
  const ms = document.getElementById('model-source');
  if (ms) ms.value = '';
  const mnotes = document.getElementById('model-notes');
  if (mnotes) mnotes.value = '';
  const mp = document.getElementById('model-printed');
  if (mp) mp.checked = false;
  const mparent = document.getElementById('model-parent');
  if (mparent) mparent.value = '';
  const mlic = document.getElementById('model-license');
  if (mlic) mlic.value = '';
  const mtags = document.getElementById('model-tags');
  if (mtags) mtags.innerHTML = '';
  previousSelectionHash = '';
}

/**
 * Run when filter/search inputs change the result set — synchronously, before any await.
 * search.js cannot access selectedModels; post-render sync alone loses races to showModelDetails().
 */
function resetFilterSelectionAndDetails() {
  currentModelDetailsAbort = true;
  selectedModels.clear();
  document.querySelectorAll('.file-item').forEach((item) => item.classList.remove('selected'));

  const multiEditPanel = document.getElementById('multi-edit-panel');
  if (multiEditPanel && !multiEditPanel.classList.contains('hidden')) {
    multiEditPanel.classList.add('hidden');
    const detailsPanel = document.getElementById('model-details');
    if (detailsPanel) detailsPanel.classList.remove('hidden');
    const editModeToggle = document.getElementById('edit-mode-toggle');
    if (editModeToggle) {
      editModeToggle.textContent = 'Multi-Edit Mode';
      editModeToggle.classList.remove('active');
    }
    isMultiSelectMode = false;
  }

  clearModelDetailsSidebar();
  updateSelectedCount();
}

/** True if sidebar + selection state is consistent with the current filtered grid rows. */
function isSidebarShowingModelInFilteredList(files, filteredSet) {
  const list = Array.isArray(files) ? files : [];
  const paths = [
    currentModelDetailsPath,
    document.getElementById('path-tree-container')?.getAttribute('data-file-path')
  ].filter(Boolean);
  const mn = document.getElementById('model-name')?.value?.trim();
  const hasSidebarContent = paths.length > 0 || !!mn || selectedModels.size > 0;
  if (!hasSidebarContent) return true;
  if (list.length === 0) return false;

  const pathOrSelectionOk =
    paths.some((p) => filteredSet.has(normalizePathForComparison(p))) ||
    Array.from(selectedModels).some((p) =>
      filteredSet.has(normalizePathForComparison(p))
    );
  if (pathOrSelectionOk) return true;

  if (mn) {
    return list.some(
      (f) =>
        f &&
        f.fileName &&
        (f.fileName === mn || mn === f.fileName || mn.endsWith(f.fileName))
    );
  }
  return false;
}

function syncSelectionWithFilteredModels(files) {
  const list = Array.isArray(files) ? files : [];
  const filteredSet = new Set(
    list.filter((f) => f && f.filePath).map((f) => normalizePathForComparison(f.filePath))
  );

  for (const path of Array.from(selectedModels)) {
    if (!filteredSet.has(normalizePathForComparison(path))) {
      selectedModels.delete(path);
    }
  }

  if (isMultiSelectMode && selectedModels.size === 0) {
    exitMultiEditMode();
    return;
  }

  if (!isSidebarShowingModelInFilteredList(files, filteredSet)) {
    clearModelDetailsSidebar();
  }

  updateSelectedCount();
}

// Sync DOM selection state with selectedModels
function syncDOMSelectionWithSelectedModels() {
  document.querySelectorAll('.file-item').forEach(item => {
    const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
    if (itemPath && isInSelectedModels(itemPath)) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Ensure all visually selected items are in selectedModels
function syncSelectedModelsWithDOM() {
  document.querySelectorAll('.file-item.selected').forEach(item => {
    const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
    if (itemPath && !isInSelectedModels(itemPath)) {
      addToSelectedModels(itemPath);
    }
  });
}

// Update the click handler for file items to use the new showMultiEditPanel function
async function handleFileClick(event, filePath) {
  // In multi-edit mode, plain clicks toggle selection (Ctrl/Cmd also toggles).
  // Outside multi-edit mode, only Ctrl/Cmd enters multi-select; plain click is single-select.
  const multiToggle = isMultiSelectMode || event.ctrlKey || event.metaKey;

  if (multiToggle) {
    event.preventDefault();
    const fileItem = event.currentTarget;
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    // Normalize the filePath for consistent comparison
    const normalizedFilePath = normalizePathForComparison(filePath);
    
    if (!isMultiSelectMode) {
      isMultiSelectMode = true;
      selectedModels.clear();
      
      // Update UI to reflect multi-select mode
      if (button) {
        button.textContent = 'Exit Multi-Edit Mode';
        button.classList.add('active');
      }
      if (multiEditPanel) {
        multiEditPanel.classList.remove('hidden');
      }
      if (detailsPanel) {
        detailsPanel.classList.add('hidden');
      }
      
      // Populate dropdowns for multi-edit
      try {
        await populateModelDesignerDropdown(null, 'multi-designer');
        await populateModelLicenseDropdown(null, 'multi-license');
        await populateParentModelDropdown(null, 'multi-parent');
        await populateTagSelect('multi-tag-select', 'multi-tags');
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      // Add the first clicked model to selection when entering multi-select mode
      const storedPath = addToSelectedModels(filePath);
      // Mark all DOM elements with matching normalized path as selected
      document.querySelectorAll('.file-item').forEach(item => {
        const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
        if (normalizePathForComparison(itemPath) === normalizedFilePath) {
          item.classList.add('selected');
        }
      });
    } else {
      // Toggle selection for subsequent clicks
      if (isInSelectedModels(filePath)) {
        removeFromSelectedModels(filePath);
        // Remove selection from all DOM elements with this filePath
        document.querySelectorAll('.file-item').forEach(item => {
          const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
          if (normalizePathForComparison(itemPath) === normalizedFilePath) {
            item.classList.remove('selected');
          }
        });
      } else {
        addToSelectedModels(filePath);
        // Add selection to all DOM elements with this filePath
        document.querySelectorAll('.file-item').forEach(item => {
          const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
          if (normalizePathForComparison(itemPath) === normalizedFilePath) {
            item.classList.add('selected');
          }
        });
      }
    }
    
    // Sync selectedModels with DOM to ensure consistency
    syncSelectedModelsWithDOM();
    
    // Update the selected count after any selection change
    updateSelectedCount();
    
    if (selectedModels.size > 0) {
      showMultiEditPanel();
      if (multiEditPanel) {
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      // Exiting multi-select mode - update UI
      isMultiSelectMode = false;
      if (multiEditPanel) {
        multiEditPanel.classList.add('hidden');
      }
      if (button) {
        button.textContent = 'Multi-Edit Mode';
        button.classList.remove('active');
      }
      if (detailsPanel && selectedModels.size === 0) {
        detailsPanel.classList.remove('hidden');
      }
      exitMultiEditMode();
    }
    updateSelectedCount();
  } else {
    // Single selection
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    selectedModels.add(filePath);
    isMultiSelectMode = false;
    
    // Update UI to reflect single-select mode
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    if (button) {
      button.textContent = 'Multi-Edit Mode';
      button.classList.remove('active');
    }
    if (multiEditPanel) {
      multiEditPanel.classList.add('hidden');
    }
    
    showModelDetails(filePath);
    updateSelectedCount();
  }
}

// Helper: true when focus is in a form control (don't trigger app shortcuts)
function isFocusInFormControl() {
  const el = document.activeElement;
  return el && (
    el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

// Navigate to next/previous model in detail view (called from keydown when details visible)
function navigateDetailView(direction) {
  const detailsPanel = document.getElementById('model-details');
  if (!detailsPanel || detailsPanel.classList.contains('hidden')) return false;
  const items = Array.from(document.querySelectorAll('.file-item'));
  if (items.length === 0) return false;
  const currentPath = getCurrentModelFilePath() || currentModelDetailsPath || '';
  const normalizedCurrent = currentPath ? normalizePathForComparison(currentPath) : '';
  let index = -1;
  if (normalizedCurrent) {
    index = items.findIndex(item => {
      const p = item.getAttribute('data-filepath') || item.dataset.filepath || '';
      return p && normalizePathForComparison(p) === normalizedCurrent;
    });
  }
  if (index < 0) index = items.findIndex(item => item.classList.contains('selected'));
  if (index < 0) index = 0;
  const nextIndex = direction === 'next' ? index + 1 : index - 1;
  if (nextIndex < 0 || nextIndex >= items.length) return false;
  const target = items[nextIndex];
  const filePath = target.getAttribute('data-filepath') || target.dataset.filepath;
  if (!filePath) return false;
  document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
  target.classList.add('selected');
  target.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  showModelDetails(filePath);
  return true;
}

// Handle keyboard shortcuts
document.addEventListener('keydown', async (event) => {
  const mod = event.ctrlKey || event.metaKey;
  const inInput = isFocusInFormControl();
  const detailsVisible = (() => {
    const p = document.getElementById('model-details');
    return p && !p.classList.contains('hidden');
  })();

  // Handle Escape key to exit multi-edit mode
  if (event.key === 'Escape' || event.key === 'Esc') {
    if (isMultiSelectMode) {
      event.preventDefault();
      exitMultiEditMode();
      return;
    }
  }

  // Search focus: Ctrl+/ or Cmd+/ (always allow so user can jump to search from anywhere)
  if (mod && event.key === '/') {
    event.preventDefault();
    const searchInput = document.getElementById('search-filter-input');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  // Show keyboard shortcuts dialog: Ctrl+Shift+/ (?) or Cmd+Shift+/
  if (mod && event.shiftKey && event.key === '?') {
    event.preventDefault();
    const dialog = document.getElementById('keyboard-shortcuts-dialog');
    if (dialog) dialog.showModal();
    return;
  }

  // Next/Previous in detail view (only when details panel is open and not typing)
  if (!inInput && detailsVisible && (event.key === 'ArrowDown' || event.key === 'j' || event.key === 'J')) {
    if (navigateDetailView('next')) {
      event.preventDefault();
      return;
    }
  }
  if (!inInput && detailsVisible && (event.key === 'ArrowUp' || event.key === 'k' || event.key === 'K')) {
    if (navigateDetailView('previous')) {
      event.preventDefault();
      return;
    }
  }

  // Other shortcuts only when not typing in an input
  if (inInput) return;

  // Scan directory: Ctrl+Shift+S / Cmd+Shift+S
  if (mod && event.shiftKey && (event.key === 'S' || event.key === 's')) {
    if (!isScanning) {
      event.preventDefault();
      document.getElementById('scan-directory-button')?.click();
    }
    return;
  }

  // Clear filters: Ctrl+Shift+C / Cmd+Shift+C
  if (mod && event.shiftKey && (event.key === 'C' || event.key === 'c')) {
    event.preventDefault();
    const clearBtn = document.querySelector('.clear-filter-button');
    if (clearBtn) clearBtn.click();
    else {
      const searchInput = document.getElementById('search-filter-input');
      const viewLibraryBtn = document.getElementById('view-library-button');
      if (searchInput) searchInput.value = '';
      if (viewLibraryBtn) viewLibraryBtn.click();
    }
    return;
  }

  // Print Roulette: Ctrl+Shift+R / Cmd+Shift+R
  if (mod && event.shiftKey && (event.key === 'R' || event.key === 'r')) {
    event.preventDefault();
    window.electron.send('start-print-roulette');
    return;
  }

  // Toggle Multi-Edit: Ctrl+E / Cmd+E
  if (mod && (event.key === 'e' || event.key === 'E')) {
    event.preventDefault();
    const toggleBtn = document.getElementById('edit-mode-toggle');
    const enterMultiBtn = document.getElementById('enter-multi-edit-button');
    if (enterMultiBtn && detailsVisible) enterMultiBtn.click();
    else if (toggleBtn) toggleBtn.click();
    return;
  }
  
  // Check for Ctrl+A (Windows/Linux) or Cmd+A (Mac)
  if (mod && (event.key === 'a' || event.key === 'A')) {
    // Don't intercept if user is typing in an input field, textarea, or contenteditable
    const activeElement = document.activeElement;
    const isInputField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );
    
    if (isInputField) {
      return; // Let default behavior work for text selection in input fields
    }
    
    event.preventDefault();
    
    // Clear existing selections first
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
    
    try {
      // Get all filtered model references (not just visible ones) - same as select-all-button
      // Wait for getCombinedFilteredModels to be available (handles module loading race condition)
      const getFilteredModels = await waitForGetCombinedFilteredModels();
      const filteredModels = await getFilteredModels();
      
      // Add all filtered models to selection (ensuring no duplicates by file path)
      const uniqueFilePaths = new Set();
      filteredModels.forEach(model => {
        if (!uniqueFilePaths.has(model.filePath)) {
          uniqueFilePaths.add(model.filePath);
          addToSelectedModels(model.filePath);
        }
      });
      
      // Update UI for all items with matching file paths that are rendered
      // Use helper function to ensure normalized path comparison
      filteredModels.forEach(model => {
        if (isInSelectedModels(model.filePath)) {
          document.querySelectorAll('.file-item').forEach(item => {
            const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
            if (normalizePathForComparison(itemPath) === normalizePathForComparison(model.filePath)) {
              item.classList.add('selected');
            }
          });
        }
      });
      
      // Update the selected count
      updateSelectedCount();
      
      // Show multi-edit panel if there are selections
      if (selectedModels.size > 0) {
        showMultiEditPanel();
      }
    } catch (error) {
      console.error('Error selecting all models:', error);
    }
    
    // Activate multi-edit mode if not already active
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    if (!isMultiSelectMode && selectedModels.size > 0) {
      isMultiSelectMode = true;
      
      // Update UI to reflect multi-select mode
      if (button) {
        button.textContent = 'Exit Multi-Edit Mode';
        button.classList.add('active');
      }
      if (multiEditPanel) {
        multiEditPanel.classList.remove('hidden');
      }
      if (detailsPanel) {
        detailsPanel.classList.add('hidden');
      }
      
      // Populate dropdowns for multi-edit
      try {
        await populateModelDesignerDropdown(null, 'multi-designer');
        await populateModelLicenseDropdown(null, 'multi-license');
        await populateParentModelDropdown(null, 'multi-parent');
        await populateTagSelect('multi-tag-select', 'multi-tags');
        await populateRemoveTagSelect();
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      if (multiEditPanel) {
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }
});

// Update populateModelDesignerDropdown to handle multiple dropdowns
async function populateModelDesignerDropdown(selectedDesigner, elementId = 'model-designer') {
  const designerSelect = document.getElementById(elementId);
  if (!designerSelect) return;

  designerSelect.innerHTML = '<option value="">Select Designer</option>';

  try {
    const designers = await window.electron.getDesigners();
    designers.forEach(designer => {
      if (designer) { // Only add non-empty designers
        const option = document.createElement('option');
        option.value = designer;
        option.textContent = designer;
        if (designer === selectedDesigner) {
          option.selected = true;
        }
        designerSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching designers:', error);
  }
}

// Update the change event listener
document.getElementById('model-designer').addEventListener('change', async (event) => {
  const designerSelect = event.target;
  const newDesigner = designerSelect.value;
  
  if (newDesigner && newDesigner !== 'Unknown') {
    const designers = await window.electron.getDesigners();
    if (!designers.includes(newDesigner)) {
      console.log('New designer will be added:', newDesigner);
    }
  }
});

async function populateDesignerDropdown() {
  const designerSelect = document.getElementById('designer-select');
  designerSelect.innerHTML = '<option value="">All Designers</option>';
  // Add an option to filter for models with no designer set
  designerSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const designers = await window.electron.getDesigners();
    designers.forEach(designer => {
      const option = document.createElement('option');
      option.value = designer;
      option.textContent = designer;
      designerSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching designers:', error);
  }
}

// Add these event listeners after your existing ones
document.getElementById('add-new-designer-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-designer-dialog');
  dialog.showModal();
});

document.getElementById('cancel-designer-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-designer-dialog');
  dialog.close();
});

document.getElementById('new-designer-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newDesignerName = document.getElementById('new-designer-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown;
  
  if (newDesignerName) {
    // Trigger auto-save first (before repopulating dropdowns)
    if (sourceDropdownId === 'multi-designer') {
      await autoSaveMultipleModels('designer', newDesignerName);
    } else if (sourceDropdownId === 'designer-select') {
      // For filter dropdown, we need to save to a model first
      const filePath = getCurrentModelFilePath();
      if (filePath) {
        await autoSaveModel('designer', newDesignerName, filePath);
      }
    } else {
      const filePath = getCurrentModelFilePath();
      await autoSaveModel('designer', newDesignerName, filePath);
    }
    
    // Clear the input and close the dialog immediately
    document.getElementById('new-designer-name').value = '';
    document.getElementById('new-designer-dialog').close();
    
    // Update all designer dropdowns - both filter and model dropdowns
    // This repopulates from the database, avoiding duplicates
    await populateDesignerDropdown(); // Filter dropdown on left side
    // Preserve the selection for the dropdown that was just updated
    await populateModelDesignerDropdown(
      sourceDropdownId === 'multi-designer' ? newDesignerName : null, 
      'multi-designer'
    ); // Multi-edit dropdown
    await populateModelDesignerDropdown(
      sourceDropdownId === 'model-designer' ? newDesignerName : null, 
      'model-designer'
    ); // Single-edit dropdown
    
    // Set the value on the source dropdown after repopulation
    if (sourceDropdownId === 'designer-select') {
      const designerSelect = document.getElementById('designer-select');
      if (designerSelect) {
        designerSelect.value = newDesignerName;
      }
    }
    
    // Refresh metadata editor list if dialog is open
    const metadataDialog = document.getElementById('metadata-editor-dialog');
    if (metadataDialog && metadataDialog.open && currentMetadataType === 'designer') {
      allMetadata = []; // Clear cache to force refresh
      await refreshMetadataList('designer');
    }
  }
});

// Keep the clear parent button event listener
document.getElementById('clear-parent-button')?.addEventListener('click', () => {
  document.getElementById('model-parent').value = '';
});


// Add event listeners for parent model dialog
document.getElementById('add-new-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  dialog.showModal();
});

document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  dialog.close();
});

// Duplicate event listener removed - handled in DOMContentLoaded above

// Update the parent model button click handler to match designer exactly
document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
  button?.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    const input = document.getElementById('new-parent-name');
    
    // Reset form and input state exactly like designer
    dialog.querySelector('form').reset();
    input.value = '';
    input.disabled = false;
    input.readOnly = false;
    
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-parent';
    
    // Show dialog and force refresh exactly like designer
    dialog.showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.click();
    });
  });
});

// Add back the cancel button handler
document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  const input = document.getElementById('new-parent-name');
  input.value = '';
  dialog.close();
});



// Add these new functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const context = this; // Store the context
    const later = () => {
      timeout = null; // Clear timeout identifier
      func.apply(context, args); // Call the original function with correct context and args
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}


// Replace the existing tag handling functions with these
async function initializeTags() {
  const tagSelect = document.getElementById('tag-select');
  const multiTagSelect = document.getElementById('multi-tag-select');

  // Handle selecting a tag from the single edit dropdown
  tagSelect.addEventListener('change', () => {
    const selectedTag = tagSelect.value;
    if (selectedTag) {
      addTagToModel(selectedTag, 'model-tags');
      tagSelect.value = ''; // Reset selection
    }
  });

  // Handle selecting a tag from the multi edit dropdown
  multiTagSelect.addEventListener('change', () => {
    const selectedTag = multiTagSelect.value;
    if (selectedTag) {
      addTagToModel(selectedTag, 'multi-tags');
      multiTagSelect.value = ''; // Reset selection
    }
  });

  // Initial population of tag dropdowns
  await populateTagSelect('tag-select', 'model-tags');
  await populateTagSelect('multi-tag-select', 'multi-tags');
}

async function populateTagSelect(selectId = 'tag-select', containerId = 'model-tags') {
  const tagSelect = document.getElementById(selectId);
  const currentTags = Array.from(document.querySelectorAll(`#${containerId} .tag`))
    .map(tag => tag.getAttribute('data-tag-name'));
  
  tagSelect.innerHTML = '<option value="">Select a tag...</option>';

  try {
    const tags = await window.electron.getAllTags();
    tags.sort((a, b) => a.name.localeCompare(b.name)); // Sort tags alphabetically
    tags.forEach(tag => {
      // Only add tags that aren't already selected
      if (!currentTags.includes(tag.name)) {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = tag.name;
        tagSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching tags:', error);
  }
}

// Refresh the tags displayed in the multi-tags container
async function refreshMultiEditTags() {
  const multiTagsContainer = document.getElementById('multi-tags');
  if (!multiTagsContainer) {
    return;
  }

  // Clear existing tags
  multiTagsContainer.innerHTML = '';

  // Check if any models are selected
  if (selectedModels.size === 0) {
    return;
  }

  try {
    // Get all selected file paths
    const filePaths = Array.from(selectedModels);
    
    // Load tags for each model in parallel
    const tagPromises = filePaths.map(async (filePath) => {
      try {
        const model = await window.electron.getModel(filePath);
        return model && model.tags ? (Array.isArray(model.tags) ? model.tags : []) : [];
      } catch (error) {
        console.error(`Error loading tags for ${filePath}:`, error);
        return [];
      }
    });

    const allTagsArrays = await Promise.all(tagPromises);
    
    // Collect unique tags across all selected files
    const uniqueTags = new Set();
    allTagsArrays.forEach(tags => {
      if (Array.isArray(tags)) {
        tags.forEach(tag => {
          if (tag && typeof tag === 'string') {
            const normalizedTag = tag.trim();
            if (normalizedTag) {
              uniqueTags.add(normalizedTag);
            }
          }
        });
      }
    });

    // Sort tags alphabetically
    const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));

    // Display tags in the container with remove functionality
    sortedTags.forEach(tagName => {
      // Check if tag already exists visually
      const existingTag = Array.from(multiTagsContainer.children)
        .find(tag => tag.getAttribute('data-tag-name') === tagName);
      
      if (!existingTag) {
        // Create tag element with remove functionality
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.setAttribute('data-tag-name', tagName);
        tag.setAttribute('title', tagName);
        tag.innerHTML = `
          <span class="tag-text">${tagName}</span>
          <span class="tag-remove">×</span>
        `;
        
        // Add remove handler with auto-save
        tag.querySelector('.tag-remove')?.addEventListener('click', async () => {
          tag.remove();
          // Auto-save the updated tags after REMOVAL
          const currentTags = Array.from(multiTagsContainer.querySelectorAll('.tag'))
            .map(t => t.getAttribute('data-tag-name'));
          
          // Use replaceTags: true to replace tags instead of merging
          await autoSaveMultipleModels('tags', currentTags, { replaceTags: true });
          
          // Refresh the remove tag dropdown after removal
          await populateRemoveTagSelect();
        });
        
        multiTagsContainer.appendChild(tag);
      }
    });
  } catch (error) {
    console.error('Error refreshing multi-edit tags:', error);
  }
}

// Populate the remove tag dropdown with tags from selected files
async function populateRemoveTagSelect() {
  const removeTagSelect = document.getElementById('multi-tag-remove-select');
  if (!removeTagSelect) {
    console.error('multi-tag-remove-select element not found');
    return;
  }

  // Clear existing options except the default
  removeTagSelect.innerHTML = '<option value="">Select a tag to remove...</option>';

  // Check if any models are selected
  if (selectedModels.size === 0) {
    const noTagsOption = document.createElement('option');
    noTagsOption.value = '';
    noTagsOption.textContent = 'No files selected';
    noTagsOption.disabled = true;
    removeTagSelect.appendChild(noTagsOption);
    return;
  }

  try {
    // Get all selected file paths
    const filePaths = Array.from(selectedModels);
    
    // Load tags for each model in parallel
    const tagPromises = filePaths.map(async (filePath) => {
      try {
        const model = await window.electron.getModel(filePath);
        return model && model.tags ? (Array.isArray(model.tags) ? model.tags : []) : [];
      } catch (error) {
        console.error(`Error loading tags for ${filePath}:`, error);
        return [];
      }
    });

    const allTagsArrays = await Promise.all(tagPromises);
    
    // Collect unique tags across all selected files
    // Use Set to automatically ensure uniqueness
    const uniqueTags = new Set();
    allTagsArrays.forEach(tags => {
      if (Array.isArray(tags)) {
        // First deduplicate tags within each model (in case a model has duplicate tags)
        const modelUniqueTags = new Set();
        tags.forEach(tag => {
          // Normalize tag: trim whitespace and ensure it's a non-empty string
          if (tag && typeof tag === 'string') {
            const normalizedTag = tag.trim();
            if (normalizedTag) {
              modelUniqueTags.add(normalizedTag);
            }
          }
        });
        // Add all unique tags from this model to the overall set
        modelUniqueTags.forEach(tag => uniqueTags.add(tag));
      }
    });

    // Convert Set to array and sort alphabetically
    // Set already ensures uniqueness, so no need for additional deduplication
    const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));
    
    // Double-check for duplicates (defensive programming)
    const finalUniqueTags = [];
    const seenTags = new Set();
    sortedTags.forEach(tag => {
      if (!seenTags.has(tag)) {
        seenTags.add(tag);
        finalUniqueTags.push(tag);
      }
    });

    // Populate dropdown
    if (finalUniqueTags.length === 0) {
      const noTagsOption = document.createElement('option');
      noTagsOption.value = '';
      noTagsOption.textContent = 'No tags to remove';
      noTagsOption.disabled = true;
      removeTagSelect.appendChild(noTagsOption);
    } else {
      finalUniqueTags.forEach(tagName => {
        // Additional check to prevent duplicate options in the DOM
        const existingOption = Array.from(removeTagSelect.options).find(opt => opt.value === tagName);
        if (!existingOption) {
          const option = document.createElement('option');
          option.value = tagName;
          option.textContent = tagName;
          removeTagSelect.appendChild(option);
        }
      });
    }
  } catch (error) {
    console.error('Error populating remove tag select:', error);
    const errorOption = document.createElement('option');
    errorOption.value = '';
    errorOption.textContent = 'Error loading tags';
    errorOption.disabled = true;
    removeTagSelect.appendChild(errorOption);
  }
}

// Update the addTagToModel function
// skipSave: use when populating tags from DB (showModelDetails / loadModelTags) to avoid redundant saves
async function addTagToModel(tagName, containerId, options = {}) {
  const { skipSave = false } = options;
  const tagContainer = document.getElementById(containerId);
  if (!tagContainer) {
    console.error(`Tag container with ID ${containerId} not found`);
    return;
  }
  
  // Check if tag already exists visually
  const existingTag = Array.from(tagContainer.children)
    .find(tag => tag.getAttribute('data-tag-name') === tagName);
  
  if (existingTag) return; // Don't add visual duplicates

  // Create new tag element
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.setAttribute('data-tag-name', tagName);
  tag.setAttribute('title', tagName); // Show full tag name on hover
  tag.innerHTML = `
    <span class="tag-text">${tagName}</span>
    <span class=\"tag-remove\">×</span>
  `;

  // Add remove handler with auto-save
  tag.querySelector('.tag-remove')?.addEventListener('click', async () => {
    tag.remove(); 
    // Auto-save the updated tags after REMOVAL
    const currentTags = Array.from(tagContainer.querySelectorAll('.tag'))
      .map(t => t.getAttribute('data-tag-name'));
    
    if (containerId === 'multi-tags') {
      // When removing, we DO want to save the resulting list for all selected models
      // Note: This sets all selected models to have exactly the tags remaining in the UI.
      // Use replaceTags: true to replace tags instead of merging
      await autoSaveMultipleModels('tags', currentTags, { replaceTags: true }); 
    } else {
      // Single edit mode save
      const filePath = getModelFilePath();
      if (filePath) {
        await autoSaveModel('tags', currentTags, filePath);
      } else {
        console.error('No file path found for saving tags');
      }
    }
  });

  tagContainer.appendChild(tag); // Add tag visually

  if (skipSave) {
    return;
  }

  // Auto-save logic after ADDING a tag
  if (containerId === 'multi-tags') {
    // For multi-edit ADD, only save the *newly added tag* to append it
    console.log(`Multi-edit: Appending tag '${tagName}' to selected models.`);
    await autoSaveMultipleModels('tags', [tagName]); // Pass only the new tag
  } else {
    // For single-edit ADD, save the full list for that model
    const currentTags = Array.from(tagContainer.querySelectorAll('.tag'))
      .map(t => t.getAttribute('data-tag-name'));
    const filePath = getModelFilePath();
    if (filePath) {
      await autoSaveModel('tags', currentTags, filePath);
    } else {
      console.error('No file path found for saving tags');
    }
  }
}

// Update the multi-tag-select change handler
document.getElementById('multi-tag-select').addEventListener('change', async () => {
  const tagSelect = document.getElementById('multi-tag-select');
  const selectedTag = tagSelect.value;
  if (selectedTag) {
    // Use the same addTagToModel function as single mode
    addTagToModel(selectedTag, 'multi-tags');
    document.getElementById('multi-tag-select').value = ''; // Reset selection
  }
});

async function loadModelTags(modelIdOrPath) {
  const tagsContainer = document.getElementById('model-tags');
  if (!tagsContainer) {
    console.error('Model tags container not found');
    return;
  }
  
  tagsContainer.innerHTML = '';
  
  try {
    // Get the model to retrieve its ID (modelIdOrPath can be filePath or model ID)
    const model = await window.electron.getModel(modelIdOrPath);
    if (!model || !model.id) {
      console.warn('Model not found or missing ID:', modelIdOrPath);
      return;
    }
    
    // Fetch fresh tags directly from the database using getModelTags
    // This ensures we get the latest tags even if the model object is cached
    const tags = await window.electron.getModelTags(model.id);
    
    if (tags && Array.isArray(tags) && tags.length > 0) {
      // Extract tag names (tags might be objects with .name property or just strings)
      const tagNames = tags.map(tag => typeof tag === 'string' ? tag : (tag.name || tag));
      tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      for (const tagName of tagNames) {
        await addTagToModel(tagName, 'model-tags', { skipSave: true });
      }
    }
  } catch (error) {
    console.error('Error loading model tags:', error);
  }
}

/** Set tag filter dropdown and refresh the grid (same path as Filter menu; works with getModelsFiltered in Electron and server bridge). */
async function applyTagFilterFromModelClick(tagName) {
  const trimmed = (tagName && String(tagName).trim()) || '';
  if (!trimmed) return;
  if (window.dateAddedFilter) {
    window.dateAddedFilter = null;
    window._lastDateAddedFilter = null;
  }
  window.viewingEntireLibrary = false;
  if (typeof window.resetFilterSelectionAndDetails === 'function') {
    window.resetFilterSelectionAndDetails();
  }
  const tagSelect = document.getElementById('tag-filter');
  if (!tagSelect) return;
  const hasOption = Array.from(tagSelect.options).some((o) => o.value === trimmed);
  if (!hasOption) {
    const opt = document.createElement('option');
    opt.value = trimmed;
    opt.textContent = trimmed;
    tagSelect.appendChild(opt);
  }
  tagSelect.value = '';
  if (typeof window.setTagMultiFilter === 'function') {
    window.setTagMultiFilter([trimmed]);
  } else {
    tagSelect.value = trimmed;
  }
  if (typeof window.performCombinedSearch === 'function') {
    await window.performCombinedSearch();
  }
}

/** Render tag names as clickable spans that apply the tag filter (use in model list/detailed views). */
function fillTagsWithFilterLinks(tagsValueSpan, names) {
  if (!tagsValueSpan) return;
  const sorted = (Array.isArray(names) ? names : [])
    .map((n) => {
      if (typeof n === 'string') return n.trim();
      return String((n && (n.name || n)) || '').trim();
    })
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  if (sorted.length === 0) {
    tagsValueSpan.textContent = '';
    return;
  }
  tagsValueSpan.innerHTML = '';
  sorted.forEach((name, i) => {
    const link = document.createElement('span');
    link.className = 'tag-filter-link';
    link.textContent = name;
    link.setAttribute('title', `Filter by tag: ${name}`);
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      await applyTagFilterFromModelClick(name);
    });
    tagsValueSpan.appendChild(link);
    if (i < sorted.length - 1) {
      tagsValueSpan.appendChild(document.createTextNode(', '));
    }
  });
}

// Add this function to populate the tag filter dropdown
async function populateTagFilter() {
  const tagSelect = document.getElementById('tag-filter'); // Changed from 'tag-filter-select'
  if (!tagSelect) {
    console.error('Tag filter select element not found');
    return;
  }

  tagSelect.innerHTML = '<option value="">All Tags</option>';

  try {
    const tags = await window.electron.getAllTags();
    tags.sort((a, b) => a.name.localeCompare(b.name)); // Sort tags alphabetically
    tags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag.name;
      option.textContent = `${tag.name} (${tag.model_count})`;
      tagSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error populating tag filter:', error);
  }
}

// Add bulk edit button to the main content area
const bulkEditButton = document.createElement('button');
bulkEditButton.id = 'bulk-edit-button';
bulkEditButton.className = 'bulk-edit-button';
bulkEditButton.textContent = 'Edit Selected Models';
document.querySelector('.main-content').appendChild(bulkEditButton);

// Add bulk edit functionality
bulkEditButton.addEventListener('click', () => {
  const dialog = document.getElementById('bulk-edit-dialog');
  
  // Populate dropdowns
  populateModelDesignerDropdown();
  populateParentModelDropdown();
  
  dialog.showModal();
});

// Handle bulk edit save
document.getElementById('bulk-edit-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  
  const updates = {
    designer: document.getElementById('bulk-designer').value,
    parentModel: document.getElementById('bulk-parent').value,
    source: document.getElementById('bulk-source').value,
    printed: document.getElementById('bulk-printed').value
  };

  try {
    for (const filePath of selectedModels) {
      const model = await window.electron.getModel(filePath);
      const updatedModel = {
        ...model,
        designer: updates.designer || model.designer,
        parentModel: updates.parentModel === 'none' ? '' : (updates.parentModel || model.parentModel),
        source: updates.source || model.source,
        printed: updates.printed ? (updates.printed === 'true') : model.printed
      };
      await window.electron.saveModel(updatedModel);
    }

    // Refresh the view
    const models = await window.electron.getAllModels();
    await renderFiles(models);
    
    // Clear selection
    selectedModels.clear();
    document.getElementById('bulk-edit-button').classList.remove('visible');
    
    await window.electron.showMessage('Success', 'Changes saved successfully!');
  } catch (error) {
    console.error('Error saving bulk changes:', error);
    await window.electron.showMessage('Error', 'Error saving changes');
  }
  
  document.getElementById('bulk-edit-dialog').close();
});

// Handle bulk edit cancel
document.getElementById('bulk-cancel-button')?.addEventListener('click', () => {
  document.getElementById('bulk-edit-dialog').close();
});

// Update the add button event listeners to handle both panels
document.querySelectorAll('.add-designer-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-designer-dialog');
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
    dialog.showModal();
  });
});

document.querySelectorAll('.add-parent-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
    dialog.showModal();
  });
});

document.querySelectorAll('.add-tag-button').forEach(button => {
  button.addEventListener('click', async () => {
    // Get the container ID for the tags container - we'll need this to know where to add the tag
    const sourceContainer = button.closest('.tags-container').querySelector('.tags-list').id;
    
    // Use the HTML dialog instead of Electron's dialog
    const tagDialog = document.getElementById('new-tag-dialog');
    const newTagInput = document.getElementById('new-tag-name');
    
    // Clear any previous input
    if (newTagInput) {
      newTagInput.value = '';
    }
    
    // Store the source container ID on the dialog for reference when submitting
    tagDialog.setAttribute('data-source-container', sourceContainer);
    
    // Show the dialog
    tagDialog.showModal();
  });
});

// Update the dialog submit handlers to use the stored dropdown IDs
// Duplicate event listener removed - handled at line 9210

// Duplicate event listener removed - handled in DOMContentLoaded above

// Parent Model Button Click Handler
document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
  button?.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    const input = document.getElementById('new-parent-name');
    
    // Reset form and input state
    dialog.querySelector('form').reset();
    input.value = '';
    input.disabled = false;
    input.readOnly = false;
    
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-parent';
    
    // Show dialog and force refresh exactly like designer
    dialog.showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.click();
    });
  });
});

// Cancel Button Handler
document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  const input = document.getElementById('new-parent-name');
  input.value = '';
  dialog.close();
});



// Add change event listeners for auto-save
document.getElementById('model-parent').addEventListener('change', async (e) => {
  const filePath = getCurrentModelFilePath();
  await autoSaveModel('parentModel', e.target.value, filePath);
});

document.getElementById('multi-parent').addEventListener('change', async (e) => {
  await autoSaveMultipleModels('parentModel', e.target.value);
});

// Update tag handling for multi-edit panel
document.getElementById('multi-tag-select').addEventListener('change', async () => {
  const selectedTag = document.getElementById('multi-tag-select').value;
  if (selectedTag) {
    // Use the same addTagToModel function as single mode
    addTagToModel(selectedTag, 'multi-tags');
    document.getElementById('multi-tag-select').value = ''; // Reset selection
  }
});

// Handle remove tag dropdown change event
async function handleRemoveTagSelect() {
  const removeTagSelect = document.getElementById('multi-tag-remove-select');
  if (!removeTagSelect) {
    return;
  }

  const tagToRemove = removeTagSelect.value;
  if (!tagToRemove) {
    return;
  }

  try {
    // Get all selected file paths
    const filePaths = Array.from(selectedModels);
    
    if (filePaths.length === 0) {
      console.warn('No models selected for tag removal');
      return;
    }

    // Show confirmation dialog
    const confirmResult = await window.electron.showMessageBox({
      type: 'warning',
      title: 'Remove Tag',
      message: `Are you sure you want to remove the tag "${tagToRemove}" from ${filePaths.length} selected file${filePaths.length === 1 ? '' : 's'}?`,
      buttons: ['Yes', 'No'],
      defaultId: 1,
      cancelId: 1
    });

    // If user clicked "No" (response === 1) or cancelled, reset dropdown and return
    if (confirmResult.response !== 0) {
      removeTagSelect.value = '';
      return;
    }

    // Load all models and remove the tag from each
    const modelUpdates = [];
    for (const filePath of filePaths) {
      try {
        const model = await window.electron.getModel(filePath);
        if (model && model.tags) {
          const tags = Array.isArray(model.tags) ? model.tags : [];
          // Remove the tag from the array
          const updatedTags = tags.filter(tag => tag !== tagToRemove);
          model.tags = updatedTags.sort();
          modelUpdates.push({ filePath, model });
        }
      } catch (error) {
        console.error(`Error loading model ${filePath} for tag removal:`, error);
      }
    }

    // Save all updated models using autoSaveMultipleModels with replaceTags
    if (modelUpdates.length > 0) {
      // For each model, we need to save with its updated tags
      // We'll use the batch update approach
      const modelDataBatch = modelUpdates.map(({ model }) => model);
      try {
        await window.electron.updateModelsBatch(modelDataBatch);
        console.log(`Successfully removed tag '${tagToRemove}' from ${modelUpdates.length} models`);
      } catch (error) {
        console.error('Error in batch update for tag removal:', error);
        // Fallback to individual saves
        for (const { model } of modelUpdates) {
          await window.electron.saveModel(model).catch(err => {
            console.error(`Error saving model ${model.filePath}:`, err);
          });
        }
      }

      // Update UI elements
      for (const { filePath } of modelUpdates) {
        await updateModelElement(filePath);
      }
    }

    // Reset dropdown and refresh the remove tag list
    removeTagSelect.value = '';
    await populateRemoveTagSelect();
    
    // Refresh the add tag dropdown to reflect any changes
    await populateTagSelect('multi-tag-select', 'multi-tags');
  } catch (error) {
    console.error('Error removing tag:', error);
  }
}

async function parseSourceUrl(url) {
  try {
    if (!url.includes('thangs.com')) return null;

    // Fetch the page content
    const pageData = await window.electron.fetchThangsPage(url);
    if (!pageData) return null;

    const { modelTitle, designerName } = pageData;

    console.log('Parsed page data:', { modelTitle, designerName });
    return {
      designer: designerName || null,
      parentModel: modelTitle || null
    };
  } catch (error) {
    console.error('Error parsing source URL:', error);
    return null;
  }
}

// Fix syntax error in formatFileSize function
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper function to create SVG icon element
function createSVGIcon(svgString, size = 16) {
  const iconContainer = document.createElement('div');
  iconContainer.style.display = 'inline-flex';
  iconContainer.style.alignItems = 'center';
  iconContainer.style.justifyContent = 'center';
  iconContainer.style.width = `${size}px`;
  iconContainer.style.height = `${size}px`;
  iconContainer.style.flexShrink = '0';
  iconContainer.style.marginRight = '6px';
  iconContainer.innerHTML = svgString;
  return iconContainer;
}

/** List view: column visibility + widths (persisted via listViewColumnLayout) */
const LIST_VIEW_COLUMN_DEFS = [
  { id: 'name', label: 'Name', defaultWidth: 140, min: 80, max: 800 },
  { id: 'size', label: 'Size', defaultWidth: 75, min: 50, max: 200 },
  { id: 'dateadded', label: 'Date Added', defaultWidth: 110, min: 90, max: 240 },
  { id: 'directory', label: 'Parent Directory', defaultWidth: 130, min: 80, max: 500 },
  { id: 'designer', label: 'Designer', defaultWidth: 120, min: 60, max: 400 },
  { id: 'parentmodel', label: 'Parent Model', defaultWidth: 120, min: 60, max: 400 },
  { id: 'printed', label: 'Printed', defaultWidth: 100, min: 70, max: 200 },
  { id: 'tags', label: 'Tags', defaultWidth: 180, min: 80, max: 600 },
  { id: 'archive', label: 'Archive', defaultWidth: 100, min: 70, max: 200 }
];

let listViewColumnState = null;
let listViewColumnsPopoverEl = null;

function getDefaultListViewColumnState() {
  const visibility = {};
  const widths = {};
  for (const col of LIST_VIEW_COLUMN_DEFS) {
    visibility[col.id] = true;
    widths[col.id] = col.defaultWidth;
  }
  return { visibility, widths };
}

function mergeListViewColumnState(saved) {
  const base = getDefaultListViewColumnState();
  if (!saved || typeof saved !== 'object') return base;
  if (saved.visibility && typeof saved.visibility === 'object') {
    for (const col of LIST_VIEW_COLUMN_DEFS) {
      if (typeof saved.visibility[col.id] === 'boolean') {
        base.visibility[col.id] = saved.visibility[col.id];
      }
    }
  }
  if (saved.widths && typeof saved.widths === 'object') {
    for (const col of LIST_VIEW_COLUMN_DEFS) {
      const w = saved.widths[col.id];
      if (typeof w === 'number' && Number.isFinite(w)) {
        base.widths[col.id] = Math.round(Math.max(col.min, Math.min(col.max, w)));
      }
    }
  }
  return base;
}

function ensureListViewColumnState() {
  if (!listViewColumnState) {
    listViewColumnState = getDefaultListViewColumnState();
  }
  return listViewColumnState;
}

function listViewColDisplayMode(colId) {
  return colId === 'name' ? '' : 'flex';
}

function applyListViewColumnToElement(el, colId) {
  if (!el || !colId) return;
  const state = ensureListViewColumnState();
  const def = LIST_VIEW_COLUMN_DEFS.find(c => c.id === colId);
  if (!def) return;
  const visible = state.visibility[colId] !== false;
  const w = state.widths[colId] ?? def.defaultWidth;
  if (!visible) {
    el.style.display = 'none';
    return;
  }
  const mode = listViewColDisplayMode(colId);
  if (mode) {
    el.style.display = mode;
  } else {
    el.style.removeProperty('display');
  }
  el.style.flexShrink = '0';
  el.style.width = `${w}px`;
  el.style.minWidth = `${w}px`;
  if (colId === 'tags') {
    el.style.maxWidth = `${w}px`;
  } else {
    el.style.removeProperty('maxWidth');
  }
}

function applyListViewColumnLayoutToSubtree(root) {
  if (!root) return;
  root.querySelectorAll('[data-list-col]').forEach(el => {
    applyListViewColumnToElement(el, el.getAttribute('data-list-col'));
  });
}

function applyListViewColumnLayoutToGrid() {
  const grid = document.querySelector('.file-grid');
  if (!grid) return;
  applyListViewColumnLayoutToSubtree(grid);
}

async function persistListViewColumnState() {
  if (!window.electron?.saveSetting) return;
  const state = ensureListViewColumnState();
  try {
    await window.electron.saveSetting(
      'listViewColumnLayout',
      JSON.stringify({ visibility: state.visibility, widths: state.widths })
    );
  } catch (err) {
    console.error('Error saving list view column layout:', err);
  }
}

async function loadListViewColumnStateFromStore() {
  try {
    if (!window.electron?.getSetting) {
      listViewColumnState = getDefaultListViewColumnState();
      return;
    }
    const raw = await window.electron.getSetting('listViewColumnLayout');
    if (raw) {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      listViewColumnState = mergeListViewColumnState(parsed);
    } else {
      listViewColumnState = getDefaultListViewColumnState();
    }
  } catch (e) {
    console.warn('loadListViewColumnStateFromStore:', e);
    listViewColumnState = getDefaultListViewColumnState();
  }
  applyListViewColumnLayoutToGrid();
}

function closeListViewColumnsPopover() {
  if (listViewColumnsPopoverEl) {
    listViewColumnsPopoverEl.remove();
    listViewColumnsPopoverEl = null;
  }
}

function syncPreviewSizeSwitcherActive() {
  const wrap = document.getElementById('preview-size-switcher');
  if (!wrap) return;
  wrap.querySelectorAll('[data-preview-size]').forEach(b => {
    b.classList.toggle('active', b.dataset.previewSize === currentPreviewTileSize);
  });
}

function updateListViewColumnsToolbarButton() {
  const btn = document.getElementById('list-view-columns-toolbar-btn');
  if (btn) btn.hidden = currentGridView !== 'list';
  const previewSwitcher = document.getElementById('preview-size-switcher');
  if (previewSwitcher) {
    const showPreviewSizer = currentGridView === 'preview';
    previewSwitcher.hidden = !showPreviewSizer;
    if (showPreviewSizer) {
      previewSwitcher.style.display = '';
    } else {
      previewSwitcher.style.display = 'none';
    }
    previewSwitcher.setAttribute('aria-hidden', showPreviewSizer ? 'false' : 'true');
    syncPreviewSizeSwitcherActive();
  }
  document.querySelector('.grid-view-selector')?.classList.toggle('preview-view-active', currentGridView === 'preview');
}
window.updateListViewColumnsToolbarButton = updateListViewColumnsToolbarButton;

function toggleListViewColumnsPopover(anchorBtn) {
  if (listViewColumnsPopoverEl) {
    closeListViewColumnsPopover();
    return;
  }
  ensureListViewColumnState();
  const pop = document.createElement('div');
  pop.className = 'list-view-columns-popover';
  pop.setAttribute('role', 'menu');
  LIST_VIEW_COLUMN_DEFS.forEach(col => {
    const row = document.createElement('label');
    row.className = 'list-view-columns-popover-row';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.dataset.colId = col.id;
    cb.checked = listViewColumnState.visibility[col.id] !== false;
    const span = document.createElement('span');
    span.textContent = col.label;
    row.appendChild(cb);
    row.appendChild(span);
    cb.addEventListener('change', () => {
      listViewColumnState.visibility[col.id] = cb.checked;
      applyListViewColumnLayoutToGrid();
      persistListViewColumnState();
    });
    pop.appendChild(row);
  });
  const rect = anchorBtn.getBoundingClientRect();
  pop.style.position = 'fixed';
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.zIndex = '10050';
  document.body.appendChild(pop);
  listViewColumnsPopoverEl = pop;
  requestAnimationFrame(() => {
    const onDoc = (ev) => {
      if (!listViewColumnsPopoverEl || listViewColumnsPopoverEl.contains(ev.target) || anchorBtn.contains(ev.target)) {
        return;
      }
      closeListViewColumnsPopover();
      document.removeEventListener('mousedown', onDoc, true);
    };
    document.addEventListener('mousedown', onDoc, true);
  });
}

function attachListViewColumnResizeHandle(wrapEl, colId) {
  const def = LIST_VIEW_COLUMN_DEFS.find(c => c.id === colId);
  if (!def || !wrapEl) return;
  const handle = document.createElement('div');
  handle.className = 'list-view-col-resize-handle';
  handle.title = 'Drag to resize';
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    ensureListViewColumnState();
    const startX = e.clientX;
    const startW = listViewColumnState.widths[colId] ?? def.defaultWidth;
    function onMove(ev) {
      const dx = ev.clientX - startX;
      let nw = startW + dx;
      nw = Math.max(def.min, Math.min(def.max, nw));
      listViewColumnState.widths[colId] = Math.round(nw);
      applyListViewColumnLayoutToGrid();
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      persistListViewColumnState();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  wrapEl.appendChild(handle);
}

// Function to create list view header
// Helper function to create a sortable header
function createSortableHeader(label, sortKey, width, options = {}) {
  const header = document.createElement('div');
  header.className = 'sortable-header';
  header.dataset.sortKey = sortKey;
  header.style.flexShrink = '0';
  header.style.width = width;
  header.style.fontSize = '12px';
  header.style.fontWeight = '600';
  header.style.color = '#aaa';
  header.style.textTransform = 'uppercase';
  header.style.letterSpacing = '0.5px';
  header.style.cursor = 'pointer';
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '6px';
  header.style.userSelect = 'none';
  if (options.textAlign) {
    header.style.justifyContent = options.textAlign === 'center' ? 'center' : 'flex-start';
  }
  
  // Create label container
  const labelSpan = document.createElement('span');
  labelSpan.textContent = label;
  header.appendChild(labelSpan);
  
  // Create sort indicator container
  const sortIndicator = document.createElement('span');
  sortIndicator.className = 'sort-indicator';
  sortIndicator.style.display = 'inline-flex';
  sortIndicator.style.alignItems = 'center';
  sortIndicator.style.marginLeft = '4px';
  sortIndicator.style.opacity = '0';
  sortIndicator.style.transition = 'opacity 0.2s ease';
  header.appendChild(sortIndicator);
  
  // Add click handler
  header.addEventListener('click', async () => {
    const sortSelect = document.getElementById('sort-select');
    if (!sortSelect) return;
    
    const currentSort = sortSelect.value;
    let newSort;
    
    // Determine new sort based on current state
    if (currentSort === `${sortKey}-asc`) {
      newSort = `${sortKey}-desc`;
    } else if (currentSort === `${sortKey}-desc`) {
      newSort = `${sortKey}-asc`;
    } else {
      // Default to ascending when clicking a new column
      newSort = `${sortKey}-asc`;
    }
    
    // Update sort select - check if option exists first
    if (sortSelect.querySelector(`option[value="${newSort}"]`)) {
      sortSelect.value = newSort;
      
      // Trigger change event to ensure other listeners are notified
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn(`Sort option ${newSort} not found in dropdown, adding it dynamically`);
      // Option doesn't exist, add it dynamically
      const option = document.createElement('option');
      option.value = newSort;
      option.textContent = `${label} (${newSort.includes('-asc') ? 'A-Z' : 'Z-A'})`;
      sortSelect.appendChild(option);
      sortSelect.value = newSort;
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Save sort preference
    try {
      await window.electron.saveSetting('sortOption', newSort);
    } catch (error) {
      console.error('Error saving sort preference:', error);
    }
    
    // Trigger search to re-sort (also triggered by change event, but ensure it happens)
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  });
  
  // Add hover effect
  header.addEventListener('mouseenter', () => {
    if (!header.classList.contains('sort-active')) {
      header.style.color = '#fff';
      sortIndicator.style.opacity = '0.5';
    }
  });
  
  header.addEventListener('mouseleave', () => {
    if (!header.classList.contains('sort-active')) {
      header.style.color = '#aaa';
      sortIndicator.style.opacity = '0';
    }
  });
  
  // Function to update sort indicator based on current sort
  header.updateSortIndicator = function(currentSort) {
    if (currentSort === `${sortKey}-asc` || currentSort === `${sortKey}-desc`) {
      header.classList.add('sort-active');
      header.style.color = '#fff';
      sortIndicator.style.opacity = '1';
      
      // Update arrow direction
      if (currentSort === `${sortKey}-asc`) {
        sortIndicator.innerHTML = '↑';
        sortIndicator.title = 'Sorted ascending';
      } else {
        sortIndicator.innerHTML = '↓';
        sortIndicator.title = 'Sorted descending';
      }
    } else {
      header.classList.remove('sort-active');
      header.style.color = '#aaa';
      sortIndicator.style.opacity = '0';
      sortIndicator.innerHTML = '';
      sortIndicator.title = '';
    }
  };
  
  return header;
}

function createListViewHeader() {
  ensureListViewColumnState();
  const header = document.createElement('div');
  header.className = 'list-view-header';
  header.style.display = 'flex';
  header.style.flexDirection = 'row';
  header.style.alignItems = 'center';
  header.style.gap = '12px';
  header.style.padding = '8px 12px';
  header.style.height = '36px';
  header.style.borderBottom = '2px solid rgba(255, 255, 255, 0.1)';
  header.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
  header.style.position = 'sticky';
  header.style.top = '0';
  header.style.zIndex = '10';
  header.style.marginBottom = '4px';
  
  // Thumbnail column header (spacer for alignment)
  const thumbnailHeader = document.createElement('div');
  thumbnailHeader.style.flexShrink = '0';
  thumbnailHeader.style.width = '48px';
  thumbnailHeader.style.height = '20px';
  header.appendChild(thumbnailHeader);
  
  // File info container (matches fileInfo structure)
  const headerInfo = document.createElement('div');
  headerInfo.style.flex = '1';
  headerInfo.style.display = 'flex';
  headerInfo.style.flexDirection = 'row';
  headerInfo.style.alignItems = 'center';
  headerInfo.style.gap = '12px';
  headerInfo.style.minWidth = '0';
  
  // Name column header (sortable)
  const nameWrap = document.createElement('div');
  nameWrap.className = 'list-view-col';
  nameWrap.dataset.listCol = 'name';
  nameWrap.style.position = 'relative';
  const nameHeader = createSortableHeader('Name', 'name', '100%');
  nameHeader.style.width = '100%';
  nameWrap.appendChild(nameHeader);
  attachListViewColumnResizeHandle(nameWrap, 'name');
  headerInfo.appendChild(nameWrap);
  
  // Size column header (sortable)
  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'list-view-col';
  sizeWrap.dataset.listCol = 'size';
  sizeWrap.style.position = 'relative';
  const sizeHeader = createSortableHeader('Size', 'size', '100%', { textAlign: 'center' });
  sizeHeader.style.width = '100%';
  sizeWrap.appendChild(sizeHeader);
  attachListViewColumnResizeHandle(sizeWrap, 'size');
  headerInfo.appendChild(sizeWrap);
  
  // Date Added column header (sortable)
  const dateAddedWrap = document.createElement('div');
  dateAddedWrap.className = 'list-view-col';
  dateAddedWrap.dataset.listCol = 'dateadded';
  dateAddedWrap.style.position = 'relative';
  const dateAddedHeader = createSortableHeader('Date Added', 'dateadded', '100%', { textAlign: 'center' });
  dateAddedHeader.style.width = '100%';
  dateAddedWrap.appendChild(dateAddedHeader);
  attachListViewColumnResizeHandle(dateAddedWrap, 'dateadded');
  headerInfo.appendChild(dateAddedWrap);
  
  // Parent Directory column header (sortable - sorts by filePath)
  const directoryHeaderContainer = document.createElement('div');
  directoryHeaderContainer.className = 'list-view-col';
  directoryHeaderContainer.dataset.listCol = 'directory';
  directoryHeaderContainer.style.position = 'relative';
  directoryHeaderContainer.style.display = 'flex';
  directoryHeaderContainer.style.alignItems = 'center';
  directoryHeaderContainer.style.cursor = 'pointer';
  directoryHeaderContainer.style.userSelect = 'none';
  const folderIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#aaa"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>', 16);
  directoryHeaderContainer.appendChild(folderIcon);
  const directoryHeader = createSortableHeader('Parent Directory', 'directory', 'auto');
  directoryHeader.style.flex = '1';
  directoryHeader.style.minWidth = '0';
  // Make the container clickable - forward clicks to the header
  directoryHeaderContainer.addEventListener('click', (e) => {
    // If click is on the icon, trigger the header's click handler
    if (e.target === folderIcon || folderIcon.contains(e.target)) {
      directoryHeader.click();
    }
  });
  directoryHeaderContainer.appendChild(directoryHeader);
  attachListViewColumnResizeHandle(directoryHeaderContainer, 'directory');
  headerInfo.appendChild(directoryHeaderContainer);
  
  // Designer column header (sortable with icon)
  const designerWrap = document.createElement('div');
  designerWrap.className = 'list-view-col';
  designerWrap.dataset.listCol = 'designer';
  designerWrap.style.position = 'relative';
  const designerHeader = document.createElement('div');
  designerHeader.className = 'sortable-header';
  designerHeader.dataset.sortKey = 'designer';
  designerHeader.style.flexShrink = '0';
  designerHeader.style.width = '100%';
  designerHeader.style.fontSize = '12px';
  designerHeader.style.fontWeight = '600';
  designerHeader.style.color = '#aaa';
  designerHeader.style.textTransform = 'uppercase';
  designerHeader.style.letterSpacing = '0.5px';
  designerHeader.style.cursor = 'pointer';
  designerHeader.style.display = 'flex';
  designerHeader.style.alignItems = 'center';
  designerHeader.style.gap = '6px';
  designerHeader.style.userSelect = 'none';
  
  const designerIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#a855f7"><path d="m352-522 86-87-56-57-44 44-56-56 43-44-45-45-87 87 159 158Zm328 329 87-87-45-45-44 43-56-56 43-44-57-56-86 86 158 159Zm24-567 57 57-57-57ZM290-120H120v-170l175-175L80-680l200-200 216 216 151-152q12-12 27-18t31-6q16 0 31 6t27 18l53 54q12 12 18 27t6 31q0 16-6 30.5T816-647L665-495l215 215L680-80 465-295 290-120Zm-90-80h56l392-391-57-57-391 392v56Zm420-419-29-29 57 57-28-28Z"/></svg>', 16);
  designerHeader.appendChild(designerIcon);
  
  const designerLabel = document.createElement('span');
  designerLabel.textContent = 'Designer';
  designerHeader.appendChild(designerLabel);
  
  const designerSortIndicator = document.createElement('span');
  designerSortIndicator.className = 'sort-indicator';
  designerSortIndicator.style.display = 'inline-flex';
  designerSortIndicator.style.alignItems = 'center';
  designerSortIndicator.style.marginLeft = '4px';
  designerSortIndicator.style.opacity = '0';
  designerSortIndicator.style.transition = 'opacity 0.2s ease';
  designerHeader.appendChild(designerSortIndicator);
  
  // Add click handler
  designerHeader.addEventListener('click', async () => {
    const sortSelect = document.getElementById('sort-select');
    if (!sortSelect) return;
    
    const currentSort = sortSelect.value;
    let newSort;
    
    if (currentSort === 'designer-asc') {
      newSort = 'designer-desc';
    } else if (currentSort === 'designer-desc') {
      newSort = 'designer-asc';
    } else {
      newSort = 'designer-asc';
    }
    
    // Update sort select - check if option exists first
    if (sortSelect.querySelector(`option[value="${newSort}"]`)) {
      sortSelect.value = newSort;
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else {
      console.warn(`Sort option ${newSort} not found in dropdown, adding it dynamically`);
      const option = document.createElement('option');
      option.value = newSort;
      option.textContent = `Designer (${newSort === 'designer-asc' ? 'A-Z' : 'Z-A'})`;
      sortSelect.appendChild(option);
      sortSelect.value = newSort;
      sortSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    try {
      await window.electron.saveSetting('sortOption', newSort);
    } catch (error) {
      console.error('Error saving sort preference:', error);
    }
    
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  });
  
  // Add hover effect
  designerHeader.addEventListener('mouseenter', () => {
    if (!designerHeader.classList.contains('sort-active')) {
      designerHeader.style.color = '#fff';
      designerSortIndicator.style.opacity = '0.5';
    }
  });
  
  designerHeader.addEventListener('mouseleave', () => {
    if (!designerHeader.classList.contains('sort-active')) {
      designerHeader.style.color = '#aaa';
      designerSortIndicator.style.opacity = '0';
    }
  });
  
  // Function to update sort indicator
  designerHeader.updateSortIndicator = function(currentSort) {
    if (currentSort === 'designer-asc' || currentSort === 'designer-desc') {
      designerHeader.classList.add('sort-active');
      designerHeader.style.color = '#fff';
      designerSortIndicator.style.opacity = '1';
      
      if (currentSort === 'designer-asc') {
        designerSortIndicator.innerHTML = '↑';
        designerSortIndicator.title = 'Sorted ascending';
      } else {
        designerSortIndicator.innerHTML = '↓';
        designerSortIndicator.title = 'Sorted descending';
      }
    } else {
      designerHeader.classList.remove('sort-active');
      designerHeader.style.color = '#aaa';
      designerSortIndicator.style.opacity = '0';
      designerSortIndicator.innerHTML = '';
      designerSortIndicator.title = '';
    }
  };
  
  designerWrap.appendChild(designerHeader);
  attachListViewColumnResizeHandle(designerWrap, 'designer');
  headerInfo.appendChild(designerWrap);
  
  // Parent Model column header (sortable)
  const parentWrap = document.createElement('div');
  parentWrap.className = 'list-view-col';
  parentWrap.dataset.listCol = 'parentmodel';
  parentWrap.style.position = 'relative';
  const parentModelHeader = createSortableHeader('Parent Model', 'parentmodel', '100%');
  parentModelHeader.style.width = '100%';
  parentWrap.appendChild(parentModelHeader);
  attachListViewColumnResizeHandle(parentWrap, 'parentmodel');
  headerInfo.appendChild(parentWrap);
  
  // Printed column header (sortable - backend supports printed sorting)
  const printedWrap = document.createElement('div');
  printedWrap.className = 'list-view-col';
  printedWrap.dataset.listCol = 'printed';
  printedWrap.style.position = 'relative';
  const printedHeader = createSortableHeader('Printed', 'printed', '100%', { textAlign: 'center' });
  printedHeader.style.width = '100%';
  printedWrap.appendChild(printedHeader);
  attachListViewColumnResizeHandle(printedWrap, 'printed');
  headerInfo.appendChild(printedWrap);
  
  // Tags column header (not easily sortable - tags are in a separate table)
  const tagsHeader = document.createElement('div');
  tagsHeader.className = 'list-view-col';
  tagsHeader.dataset.listCol = 'tags';
  tagsHeader.style.position = 'relative';
  tagsHeader.style.display = 'flex';
  tagsHeader.style.alignItems = 'center';
  const tagsIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#aaa"><path d="M240-120q-33 0-56.5-23.5T160-200v-480q0-33 23.5-56.5T240-760h120l80 80h320q33 0 56.5 23.5T820-600v400q0 33-23.5 56.5T740-120H240Zm0-80h500v-400H447l-80-80H240v480Zm0 0v-480 480Zm280-240q17 0 28.5-11.5T560-480q0-17-11.5-28.5T520-520q-17 0-28.5 11.5T480-480q0 17 11.5 28.5T520-440Zm-160 0q17 0 28.5-11.5T400-480q0-17-11.5-28.5T360-520q-17 0-28.5 11.5T320-480q0 17 11.5 28.5T360-440Zm320 0q17 0 28.5-11.5T720-480q0-17-11.5-28.5T680-520q-17 0-28.5 11.5T640-480q0 17 11.5 28.5T680-440ZM520-280q17 0 28.5-11.5T560-320q0-17-11.5-28.5T520-360q-17 0-28.5 11.5T480-320q0 17 11.5 28.5T520-280Zm-160 0q17 0 28.5-11.5T400-320q0-17-11.5-28.5T360-360q-17 0-28.5 11.5T320-320q0 17 11.5 28.5T360-280Zm320 0q17 0 28.5-11.5T720-320q0-17-11.5-28.5T680-360q-17 0-28.5 11.5T640-320q0 17 11.5 28.5T680-280Z"/></svg>', 16);
  tagsHeader.appendChild(tagsIcon);
  const tagsText = document.createElement('span');
  tagsText.textContent = 'Tags';
  tagsText.style.fontSize = '12px';
  tagsText.style.fontWeight = '600';
  tagsText.style.color = '#aaa';
  tagsText.style.textTransform = 'uppercase';
  tagsText.style.letterSpacing = '0.5px';
  tagsText.style.marginLeft = '6px';
  tagsHeader.appendChild(tagsText);
  attachListViewColumnResizeHandle(tagsHeader, 'tags');
  headerInfo.appendChild(tagsHeader);
  
  // Archive column header (with icon, not sortable)
  const archiveWrap = document.createElement('div');
  archiveWrap.className = 'list-view-col';
  archiveWrap.dataset.listCol = 'archive';
  archiveWrap.style.position = 'relative';
  const archiveHeader = document.createElement('div');
  archiveHeader.style.display = 'flex';
  archiveHeader.style.alignItems = 'center';
  archiveHeader.style.justifyContent = 'center';
  archiveHeader.style.width = '100%';
  const archiveIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#aaa"><path d="M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"/></svg>', 16);
  archiveHeader.appendChild(archiveIcon);
  const archiveText = document.createElement('span');
  archiveText.textContent = 'Archive';
  archiveText.style.fontSize = '12px';
  archiveText.style.fontWeight = '600';
  archiveText.style.color = '#aaa';
  archiveText.style.textTransform = 'uppercase';
  archiveText.style.letterSpacing = '0.5px';
  archiveText.style.marginLeft = '6px';
  archiveHeader.appendChild(archiveText);
  archiveWrap.appendChild(archiveHeader);
  attachListViewColumnResizeHandle(archiveWrap, 'archive');
  headerInfo.appendChild(archiveWrap);
  
  header.appendChild(headerInfo);
  
  // Store references to sortable headers for updating indicators
  header.sortableHeaders = {
    name: nameHeader,
    size: sizeHeader,
    dateadded: dateAddedHeader,
    directory: directoryHeader,
    designer: designerHeader,
    parentmodel: parentModelHeader,
    printed: printedHeader
  };
  
  // Function to update all sort indicators
  header.updateSortIndicators = function() {
    const sortSelect = document.getElementById('sort-select');
    const currentSort = sortSelect ? sortSelect.value : 'date-desc';
    
    // Update each sortable header's indicator
    Object.values(header.sortableHeaders).forEach(sortableHeader => {
      if (sortableHeader && sortableHeader.updateSortIndicator) {
        sortableHeader.updateSortIndicator(currentSort);
      }
    });
  };
  
  // Initial update of sort indicators
  header.updateSortIndicators();
  applyListViewColumnLayoutToSubtree(header);
  
  return header;
}


// Update the tag filter to support multiple tags
function updateTagFilter() {
  const selectedTags = Array.from(document.querySelectorAll('#tag-filter .tag'))
    .map(tag => tag.getAttribute('data-tag-name'));
  
  if (selectedTags.length === 0) {
    // If no tags selected, show all models
    window.electron.getAllModels().then(displayModels);
    return;
  }

  // Filter models that have ALL selected tags
  window.electron.getAllModels().then(async models => {
    const filteredModels = [];
    
    for (const model of models) {
      const modelTags = await window.electron['get-model-tags'](model.id);
      const modelTagNames = modelTags.map(tag => tag.name);
      
      // Check if model has all selected tags
      if (selectedTags.every(tag => modelTagNames.includes(tag))) {
        filteredModels.push(model);
      }
    }
    
    await displayModels(filteredModels);
  });
}

// Add tag filter functionality
document.getElementById('tag-filter-select')?.addEventListener('change', async (event) => {
  const selectedTag = event.target.value;
  debugLog('Tag filter selected:', selectedTag);
  
  if (!selectedTag) {
    // If no tag selected, show all models
    const models = await window.electron.getAllModels();
    return;
  }

  try {
    // Get all models first
    const allModels = await window.electron.getAllModels();
    debugLog('Total models before filtering:', allModels.length);

    // Filter models that have the selected tag
    const filteredModels = [];
    for (const model of allModels) {
      const modelTags = await window.electron.getModelTags(model.id);
      if (modelTags && modelTags.some(tag => tag.name === selectedTag)) {
        filteredModels.push(model);
      }
    }

    debugLog('Filtered models by tag:', filteredModels.length);
  } catch (error) {
    console.error('Error filtering by tag:', error);
  }
});

// Add license filter population with null checks
async function populateLicenseFilter() {
  const licenseSelect = document.getElementById('license-select');
  licenseSelect.innerHTML = '<option value="">All Licenses</option>';
  // Add an option to filter for models with no license set
  licenseSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const rows = await window.electron.getLicenses();
    rows.forEach(license => {
      const option = document.createElement('option');
      option.value = license;
      option.textContent = license;
      licenseSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching licenses:', error);
  }
}

async function showDuplicateFiles(duplicates) {
  const groups = normalizeDuplicateGroups(duplicates);
  console.log('Showing duplicate files:', groups.length, 'groups');
  const duplicateGroups = document.querySelector('.duplicate-groups');
  if (!duplicateGroups) return;

  // Check if there are any duplicates
  if (groups.length === 0) {
    teardownDedupVirtualList();
    duplicateGroups.innerHTML = '';
    const messageDiv = document.createElement('div');
    messageDiv.style.textAlign = 'center';
    messageDiv.style.padding = '20px';
    messageDiv.style.color = '#888';
    messageDiv.textContent = 'No duplicate models found';
    duplicateGroups.appendChild(messageDiv);

    const deleteButton = document.querySelector('.dialog-buttons #delete-selected');
    if (deleteButton) {
      deleteButton.style.display = 'none';
    }
    return;
  }

  const deleteButton = document.querySelector('.dialog-buttons #delete-selected');
  if (deleteButton) {
    deleteButton.style.display = '';
    deleteButton.onclick = null;
    const newButton = deleteButton.cloneNode(true);
    deleteButton.parentNode.replaceChild(newButton, deleteButton);
    const finalDeleteButton = document.querySelector('.dialog-buttons #delete-selected');
    if (finalDeleteButton) {
      finalDeleteButton.onclick = handleDeleteSelected;
    }
  }

  setupDedupVirtualList(duplicateGroups, groups);
}

async function handleDeleteSelected() {
  console.log('Delete button clicked!');
  
  // Prevent multiple confirmations from showing
  if (isDeletingDuplicates) {
    console.log('Delete confirmation already in progress, ignoring duplicate call');
    return;
  }

  // Prefer virtual-list selection (covers off-screen groups); fall back to DOM checkboxes
  let selectedFiles;
  if (window._dedupVirtualState?.selectedPaths) {
    selectedFiles = Array.from(window._dedupVirtualState.selectedPaths).filter(
      (filePath) => filePath && !filePath.includes('::')
    );
  } else {
    selectedFiles = Array.from(
      document.querySelectorAll('.duplicate-file input[type="checkbox"]:checked')
    )
      .map(checkbox => checkbox.getAttribute('data-filepath'))
      .filter(filePath => {
        return filePath && !filePath.includes('::');
      });
  }

  console.log('Selected files:', selectedFiles.length);

  if (selectedFiles.length === 0) {
    await window.electron.showMessage('No Selection', 'Please select files to delete');
    return;
  }

  // Limit file list display to prevent dialog from growing beyond the screen
  const maxFilesToShow = 5;
  const fileList = selectedFiles.slice(0, maxFilesToShow).map(fp => {
    // Extract filename from path (handle both Windows and Unix paths)
    const parts = fp.split(/[/\\]/);
    return parts[parts.length - 1];
  }).join('\n');
  const moreCount = selectedFiles.length - maxFilesToShow;
  const moreFiles = moreCount > 0 ? `\n... and ${moreCount} more` : '';

  isDeletingDuplicates = true; // Set flag before showing confirmation
  let confirm;
  try {
    confirm = await window.electron.showMessage(
      'Confirm Delete',
      `Are you sure you want to DELETE ${selectedFiles.length} files?\nThis cannot be undone!\n\nFiles:\n${fileList}${moreFiles}`,
      ['Yes', 'No']
    );
  } finally {
    // Reset flag after confirmation dialog closes (whether Yes or No)
    isDeletingDuplicates = false;
  }

  if (confirm === 'Yes') {
    try {
      for (const filePath of selectedFiles) {
        console.log('Attempting to delete:', filePath);
        const success = await window.electron.deleteFile(filePath);
        console.log('Delete result:', success);
        if (!success) {
          await window.electron.showMessage('Error', `Failed to delete file: ${filePath}`);
        }
      }

      const dialog = document.getElementById('dedup-dialog');
      // Keep dialog open: refresh grid in background, then refresh duplicate list in place until user clicks Close
      selectedModels.clear();
      
      // Refresh the main grid (non-blocking feel: don't await before refreshing de-dupe list)
      const sortSelect = document.getElementById('sort-select');
      window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc').then(models => {
        renderFiles(models);
      });

      // Reload duplicate list in place; skip hash check and do not close/reopen dialog (refreshOnly)
      await loadDuplicateFiles(true, true);

    } catch (error) {
      console.error('Error deleting files:', error);
      await window.electron.showMessage('Error', `An error occurred: ${error.message}`);
    }
  }
  // Flag is already reset in the try/finally block above
}

// Create a separate function for rendering filtered results
async function renderFilteredFiles(files) {
  const container = document.querySelector('.file-grid');
  container.innerHTML = '';
  
  // Render in batches without progress indication
  const batchSize = 5;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, Math.min(i + batchSize, files.length));
    const elements = await Promise.all(batch.map(file => renderFile(file, container)));
    elements.forEach(element => {
      if (element) container.appendChild(element);
    });
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Just update the count, don't touch progress bars
  await updateModelCounts(files.length);
}

// Add a separate function for generating thumbnails
async function generateThumbnail(file) {
  try {
    const filePath = (typeof file === 'string') ? file : file.filePath;
    if (!filePath) {
      throw new Error("generateThumbnail: filePath is undefined");
    }

    // 1. Try to get embedded thumbnail for 3MF
    if (filePath.toLowerCase().endsWith('.3mf')) {
        console.log(`[DEBUG] generateThumbnail: Attempting to extract embedded thumbnail for ${filePath}`);
        try {
            const images = await extract3MFThumbnail(filePath);
            if (images && images.length > 0) {
                const validImages = images.filter(
                  (im) => typeof im === 'string' && im.startsWith('data:image')
                );
                if (validImages.length > 0) {
                    const firstImage = validImages[0];
                    console.log(
                      `[DEBUG] generateThumbnail: SUCCESS - Saving ${validImages.length} embedded image(s) for ${filePath}`
                    );
                    await window.electron.addMultipleThumbnails(filePath, validImages);

                    try {
                      await window.electron.calculateFileHash(filePath);
                    } catch (hashError) {
                      console.error(`Error calculating hash for ${filePath}:`, hashError);
                    }

                    return firstImage;
                } else {
                    console.log(`[DEBUG] generateThumbnail: Invalid image format for ${filePath}`);
                }
            } else {
                console.log(`[DEBUG] generateThumbnail: No embedded images found for ${filePath}`);
            }
        } catch (e) {
            console.error('Error extracting 3MF thumbnail:', e);
        }
    }

    // Use the exposed function to get file stats
    const stats = await window.electron.getFileStats(filePath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    if (fileSizeInMB > MAX_FILE_SIZE_MB) {
      debugLog(`Skipping thumbnail generation for ${filePath} (${fileSizeInMB.toFixed(2)}MB > ${MAX_FILE_SIZE_MB}MB)`);
      console.warn(`Skipping thumbnail generation for ${filePath} (${fileSizeInMB.toFixed(2)}MB > ${MAX_FILE_SIZE_MB}MB)`);
      await window.electron.saveThumbnail(filePath, '3d.png');
      return '3d.png';
    }

    // Create a temporary container for rendering (not in DOM — retainDetached required)
    const tempContainer = document.createElement('div');
    
    // Call renderModelToPNG directly instead of renderThumbnail
    const thumbnail = await renderModelToPNG(filePath, tempContainer, null, {
      retainDetached: true
    });

    if (!thumbnail || isFailurePlaceholderThumbnail(thumbnail)) {
      // Leave as default so hasThumbnail stays false and Docker can retry later.
      return '3d.png';
    }

    await window.electron.saveThumbnail(filePath, thumbnail);
    
    // Calculate and save hash during thumbnail generation (file is already being read)
    try {
      await window.electron.calculateFileHash(filePath);
    } catch (hashError) {
      console.error(`Error calculating hash for ${filePath}:`, hashError);
      // Continue even if hash calculation fails
    }
    
    return thumbnail;
  } catch (error) {
    console.error(`Error generating thumbnail for ${file.filePath || file}:`, error);
    return '3d.png';
  }
}

// Add helper function for populating license dropdown
async function populateModelLicenseDropdown(selectedLicense, elementId = 'model-license') {
  const licenseSelect = document.getElementById(elementId);
  if (!licenseSelect) return;

  licenseSelect.innerHTML = '<option value="">Select License</option>';

  try {
    const licenses = await window.electron.getLicenses();
    licenses.forEach(license => {
      if (license) { // Only add non-empty licenses
        const option = document.createElement('option');
        option.value = license;
        option.textContent = license;
        if (license === selectedLicense) {
          option.selected = true;
        }
        licenseSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching licenses:', error);
  }
}

// Add helper function for populating parent model dropdown
async function populateParentModelDropdown(selectedParent, elementId = 'model-parent') {
  const parentSelect = document.getElementById(elementId);
  if (!parentSelect) return;

  parentSelect.innerHTML = '<option value="">None</option>';

  try {
    const parents = await window.electron.getParentModels();
    // Use a Set to track unique parent values to prevent duplicates
    const seenParents = new Set();
    
    parents.forEach(parent => {
      if (parent && !seenParents.has(parent)) { // Only add non-empty, unique parent models
        seenParents.add(parent);
        const option = document.createElement('option');
        option.value = parent;
        option.textContent = parent;
        if (parent === selectedParent) {
          option.selected = true;
        }
        parentSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching parent models:', error);
  }
}

// Add back the populateParentModelFilter function
async function populateParentModelFilter() {
  const parentSelect = document.getElementById('parent-select');
  parentSelect.innerHTML = '<option value="">All Parent Models</option>';
  // Add an option to filter for models with no parent model set
  parentSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const parents = await window.electron.getParentModels();
    // Use a Set to track unique parent values to prevent duplicates
    const seenParents = new Set();
    
    parents.forEach(parent => {
      if (parent && !seenParents.has(parent)) { // Only add non-empty, unique parent models
        seenParents.add(parent);
        const option = document.createElement('option');
        option.value = parent;
        option.textContent = parent;
        parentSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching parent models for filter:', error);
  }
}

// Function to show HTML context menu (for server mode browser access)
function showHtmlContextMenu(menuData, x, y, options = {}) {
  const showClose = options.showClose === true;
  // Remove any existing context menu
  const existingMenu = document.getElementById('html-context-menu');
  if (existingMenu) {
    existingMenu.remove();
  }
  
  // Create menu container
  const menu = document.createElement('div');
  menu.id = 'html-context-menu';
  menu.style.cssText = `
    position: fixed;
    left: ${x}px;
    top: ${y}px;
    background-color: #2d2d2d;
    border: 1px solid #555;
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
    z-index: 10000;
    min-width: 200px;
    padding: ${showClose ? '20px 0 4px 0' : '4px 0'};
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
  `;

  if (showClose) {
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = 'x';
    closeButton.style.cssText = `
      position: absolute;
      top: 4px;
      right: 6px;
      background: transparent;
      border: none;
      color: #ccc;
      font-size: 14px;
      cursor: pointer;
      padding: 0;
    `;
    closeButton.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.remove();
    });
    menu.appendChild(closeButton);
  }
  
  // Create menu items
  menuData.items.forEach((item, index) => {
    if (item.type === 'separator') {
      const separator = document.createElement('div');
      separator.style.cssText = 'height: 1px; background-color: #555; margin: 4px 0;';
      menu.appendChild(separator);
      return;
    }
    
    const menuItem = document.createElement('div');
    menuItem.style.cssText = `
      padding: 6px 20px;
      color: ${item.enabled ? '#fff' : '#666'};
      cursor: ${item.enabled ? 'pointer' : 'default'};
      user-select: none;
      position: relative;
    `;
    menuItem.textContent = item.label;
    
    if (item.enabled) {
      menuItem.addEventListener('mouseenter', () => {
        menuItem.style.backgroundColor = '#3d3d3d';
      });
      menuItem.addEventListener('mouseleave', () => {
        menuItem.style.backgroundColor = 'transparent';
      });
      
      // Handle submenus
      if (item.submenu) {
        menuItem.style.paddingRight = '30px';
        const arrow = document.createElement('span');
        arrow.textContent = '▶';
        arrow.style.cssText = 'position: absolute; right: 8px; font-size: 10px;';
        menuItem.appendChild(arrow);
        
        let submenuElement = null;
        let submenuTimeout = null;
        let isSubmenuHovered = false;
        
        menuItem.addEventListener('mouseenter', () => {
          // Clear any pending hide timeout
          if (submenuTimeout) {
            clearTimeout(submenuTimeout);
            submenuTimeout = null;
          }
          
          // Create submenu
          if (!submenuElement) {
            submenuElement = document.createElement('div');
            submenuElement.style.cssText = `
              position: absolute;
              left: 100%;
              top: 0;
              background-color: #2d2d2d;
              border: 1px solid #555;
              border-radius: 4px;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
              min-width: 200px;
              padding: 4px 0;
              z-index: 10001;
              margin-left: 2px;
            `;
            
            // Add hover handlers to submenu to keep it visible
            submenuElement.addEventListener('mouseenter', () => {
              isSubmenuHovered = true;
              if (submenuTimeout) {
                clearTimeout(submenuTimeout);
                submenuTimeout = null;
              }
            });
            
            submenuElement.addEventListener('mouseleave', () => {
              isSubmenuHovered = false;
              if (submenuElement) {
                submenuTimeout = setTimeout(() => {
                  if (!isSubmenuHovered && !menuItem.matches(':hover')) {
                    submenuElement.style.display = 'none';
                  }
                }, 150);
              }
            });
            
            item.submenu.forEach((subItem, subIndex) => {
              const subMenuItem = document.createElement('div');
              subMenuItem.style.cssText = `
                padding: 6px 20px;
                color: ${subItem.enabled ? '#fff' : '#666'};
                cursor: ${subItem.enabled ? 'pointer' : 'default'};
                user-select: none;
              `;
              subMenuItem.textContent = subItem.label;
              
              if (subItem.enabled) {
                subMenuItem.addEventListener('mouseenter', () => {
                  subMenuItem.style.backgroundColor = '#3d3d3d';
                });
                subMenuItem.addEventListener('mouseleave', () => {
                  subMenuItem.style.backgroundColor = 'transparent';
                });
                
                subMenuItem.addEventListener('click', async (e) => {
                  e.stopPropagation();
                  try {
                    await window.electron.executeContextMenuAction(menuData.requestId, index, subIndex);
                    menu.remove();
                  } catch (error) {
                    console.error('Error executing menu action:', error);
                    alert('Error: ' + error.message);
                  }
                });
              }
              
              submenuElement.appendChild(subMenuItem);
            });
            
            menu.appendChild(submenuElement);
          }
          
          // Position submenu to align with the current menu item
          const menuItemRect = menuItem.getBoundingClientRect();
          submenuElement.style.top = `${menuItem.offsetTop}px`;
          submenuElement.style.display = 'block';
          
          // Check if submenu goes off screen and adjust position
          setTimeout(() => {
            if (submenuElement) {
              const submenuRect = submenuElement.getBoundingClientRect();
              const menuRect = menu.getBoundingClientRect();
              
              // If submenu goes off right edge, show it on the left side instead
              if (submenuRect.right > window.innerWidth) {
                submenuElement.style.left = 'auto';
                submenuElement.style.right = '100%';
                submenuElement.style.marginLeft = '0';
                submenuElement.style.marginRight = '2px';
              }
              
              // If submenu goes off bottom, adjust top position
              if (submenuRect.bottom > window.innerHeight) {
                const overflow = submenuRect.bottom - window.innerHeight;
                submenuElement.style.top = `${Math.max(0, menuItem.offsetTop - overflow)}px`;
              }
            }
          }, 0);
        });
        
        menuItem.addEventListener('mouseleave', () => {
          if (submenuElement) {
            // Delay hiding to allow moving to submenu
            submenuTimeout = setTimeout(() => {
              if (!isSubmenuHovered && submenuElement && !submenuElement.matches(':hover')) {
                submenuElement.style.display = 'none';
              }
            }, 150);
          }
        });
      } else {
        // Regular menu item click
        menuItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await window.electron.executeContextMenuAction(menuData.requestId, index, null);
            menu.remove();
          } catch (error) {
            console.error('Error executing menu action:', error);
            alert('Error: ' + error.message);
          }
        });
      }
    }
    
    menu.appendChild(menuItem);
  });
  
  // Add to document
  document.body.appendChild(menu);
  
  // Adjust position if menu goes off screen
  const rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    menu.style.left = `${x - rect.width}px`;
  }
  if (rect.bottom > window.innerHeight) {
    menu.style.top = `${y - rect.height}px`;
  }
  
  // Close menu when clicking outside
  const closeMenu = (e) => {
    if (!menu.contains(e.target)) {
      menu.remove();
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };
  
  // Close on escape key
  const handleEscape = (e) => {
    if (e.key === 'Escape') {
      menu.remove();
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('click', closeMenu);
      document.removeEventListener('contextmenu', closeMenu);
    }
  };
  
  setTimeout(() => {
    document.addEventListener('click', closeMenu);
    document.addEventListener('contextmenu', closeMenu);
    document.addEventListener('keydown', handleEscape);
  }, 10);
}

// Register a global listener for hash-generation-progress that works even if dialog isn't shown
// This handles background hash generation in server mode
window.electron.on('hash-generation-progress', async (progress) => {
  // Check if we're in server mode - if so, don't show dialog, just log progress
  const serverMode = await window.electron.isServerMode().catch(() => false);
  
  if (serverMode) {
    // In server mode, hash generation is truly background - just log progress
    if (progress.processed % 100 === 0 || progress.processed === progress.total) {
      console.log(`[Hash Generation] Background progress: ${progress.processed}/${progress.total} (${Math.round((progress.processed / progress.total) * 100)}%)`);
    }
    return; // Don't show any UI in server mode
  }
  
  // In normal mode, update or create progress dialog if needed
  const progressDialog = document.querySelector('.progress-dialog');
  const progressBar = document.getElementById('hash-progress');
  const progressText = document.getElementById('hash-progress-text');
  
  if (progressBar && progressText) {
    // Update existing progress dialog (user-initiated) - use same format as loadDuplicateFiles listeners to avoid bouncing
    const percentage = (progress.processed / progress.total) * 100;
    progressBar.value = percentage;
    if (progress.success !== undefined && progress.failed !== undefined) {
      progressText.textContent = `${progress.processed}/${progress.total} (${progress.success} succeeded, ${progress.failed} failed)`;
    } else {
      progressText.textContent = `${progress.processed}/${progress.total}`;
    }
    
    // Close dialog when complete
    if (progress.processed >= progress.total && progressDialog) {
      setTimeout(() => {
        progressDialog.close();
        progressDialog.remove();
        isHashDialogShowing = false;
      }, 500);
    }
  }
  // In normal mode, if no dialog exists, don't create one automatically
  // Only show dialog if user explicitly requested hash generation
});

window.electron.on('hash-generation-complete', async (result) => {
  try {
    const serverMode = await window.electron.isServerMode().catch(() => false);
    if (!serverMode) return;
    const dialog = document.getElementById('dedup-dialog');
    if (dialog && dialog.open) {
      // Reload duplicates if DeDup window is open
      await loadDuplicateFiles(true);
    }
    // Also close any hash progress dialog that might be open
    const progressDialog = document.getElementById('hash-progress-dialog') || document.querySelector('.progress-dialog');
    if (progressDialog) {
      progressDialog.close();
      progressDialog.remove();
      isHashDialogShowing = false;
    }
    // Log completion result for debugging
    if (result) {
      console.log('Hash generation completed:', result);
    }
  } catch (error) {
    console.error('Error refreshing duplicates after hash completion:', error);
  }
});

// Resolve which file path(s) a context menu should operate on.
// If the right-clicked item is part of a multi-selection, use the whole selection.
function resolveContextMenuFilePaths(clickedFilePath) {
  // Prefer live DOM selection so we don't miss visually selected items if the Set desynced
  if (typeof syncSelectedModelsWithDOM === 'function') {
    syncSelectedModelsWithDOM();
  }

  const selected = Array.from(selectedModels).filter(Boolean);
  const clickedSelected = clickedFilePath && isInSelectedModels(clickedFilePath);

  if (selected.length > 1 && clickedSelected) {
    return selected;
  }

  // Multi-edit mode with a selection: operate on all selected even if the click
  // target path format differs slightly from the Set entry.
  if (isMultiSelectMode && selected.length > 1) {
    return selected;
  }

  if (clickedFilePath) return [clickedFilePath];
  return selected.length ? selected : [];
}

function addThumbnailMenuButton(thumbnailContainer, filePath) {
  if (!thumbnailContainer || !filePath) return;
  if (thumbnailContainer.querySelector('.thumbnail-menu-button')) return;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'thumbnail-menu-button';
  button.textContent = '...';
  button.title = 'Menu';
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const rect = button.getBoundingClientRect();
    const x = rect.left;
    const y = rect.bottom;

    try {
      const paths = resolveContextMenuFilePaths(filePath);
      const menuResult = paths.length > 1
        ? await window.electron.showContextMenu(paths)
        : await window.electron.showContextMenu(paths[0] || filePath);

      if (menuResult && menuResult.type === 'html-menu') {
        showHtmlContextMenu(menuResult, x, y, { showClose: true });
      }
    } catch (error) {
      console.error('Error showing context menu:', error);
    }
  });

  thumbnailContainer.appendChild(button);
}

// Add this function near other file rendering functions
function addContextMenuHandler(fileElement, filePath) {
  // Remove any existing context menu handler to avoid duplicates
  fileElement.removeEventListener('contextmenu', fileElement._contextMenuHandler);
  
  // Create the handler function
  const handler = async (e) => {
    e.preventDefault(); // Prevent default context menu
    
    // For list view, ensure the entire element is clickable
    // Check if the click is on this element or any of its children
    const target = e.target;
    if (!fileElement.contains(target) && target !== fileElement) {
      return; // Click was outside the element
    }
    
    e.stopPropagation(); // Prevent event bubbling after we've handled it
    
    // Get click coordinates for positioning HTML menu
    const x = e.clientX;
    const y = e.clientY;
    
    // If the right-clicked item is part of a multi-selection, operate on all selected.
    // Otherwise use the single right-clicked file.
    const paths = resolveContextMenuFilePaths(filePath);
    const menuResult = paths.length > 1
      ? await window.electron.showContextMenu(paths)
      : await window.electron.showContextMenu(paths[0] || filePath);
    
    // Check if server returned HTML menu data (server mode via browser)
    if (menuResult && menuResult.type === 'html-menu') {
      showHtmlContextMenu(menuResult, x, y);
    }
    // Otherwise, native menu was shown (normal mode)
  };
  
  // Store handler reference for potential removal
  fileElement._contextMenuHandler = handler;
  
  // Use capture phase for list view to catch events on child elements
  // For other views, use bubble phase
  const useCapture = fileElement.classList.contains('file-item-list');
  fileElement.addEventListener('contextmenu', handler, useCapture);
}

// Update the exit multi-edit mode functionality
function exitMultiEditMode() {
  // Clear selections
  selectedModels.clear();
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // Update the selection count display
  updateSelectedCount();
  
  // Switch back to single edit mode
  isMultiSelectMode = false;
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');
  multiEditPanel.classList.add('hidden');
  detailsPanel.classList.remove('hidden');
  document.getElementById('edit-mode-toggle').textContent = 'Multi-Edit Mode';
  document.getElementById('edit-mode-toggle').classList.remove('active');

  // Remove all event listeners from model form fields
  const formFields = [
    'multi-designer',
    'multi-source',
    'multi-printed', // Add printed checkbox to list
    'multi-parent',
    'multi-license',
    'multi-tag-select'
  ];

  // Clone and replace each field to remove event listeners
  formFields.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      // Clone and replace the element to remove all event listeners
      const newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
      
      // Reset any specific element states
      if (fieldId === 'multi-printed') {
        newElement.checked = false;
      } else if (newElement.tagName === 'SELECT') {
        newElement.value = ''; // Reset select elements
      } else if (newElement.tagName === 'INPUT') {
        newElement.value = ''; // Reset text inputs
      }
    }
  });

  // Clear the current model details path to prevent stale event handlers
  currentModelDetailsPath = null;
  currentModelDetailsAbort = true;
  
  // Remove event listeners from model details form fields by cloning them
  const modelDetailsFields = [
    'model-printed',
    'model-source',
    'model-notes',
    'model-designer',
    'model-license',
    'model-parent'
  ];
  
  modelDetailsFields.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      // Clone and replace to remove all event listeners
      const newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
      
      // Reset element states
      if (fieldId === 'model-printed') {
        newElement.checked = false;
      } else if (newElement.tagName === 'SELECT') {
        newElement.value = '';
      } else if (newElement.tagName === 'INPUT') {
        newElement.value = '';
      }
    }
  });
  
  // Clear the form
  const pathTreeContainer = document.getElementById('path-tree-container');
  if (pathTreeContainer) {
    pathTreeContainer.innerHTML = '';
    pathTreeContainer.removeAttribute('data-file-path');
  }
  document.getElementById('model-name').value = '';
  document.getElementById('model-designer').value = '';
  document.getElementById('model-source').value = '';
  document.getElementById('model-notes').value = '';
  document.getElementById('model-printed').checked = false;
  document.getElementById('model-parent').value = '';
  document.getElementById('model-license').value = '';
  document.getElementById('model-tags').innerHTML = '';
  
  // Clear the multi-edit tag container as well
  const multiTagsContainer = document.getElementById('multi-tags');
  if (multiTagsContainer) {
    multiTagsContainer.innerHTML = '';
  }
  
  // Reset the multi-tag-select dropdown
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    // Set back to default option
    multiTagSelect.value = '';
    
    // Optionally refresh the dropdown options
    populateTagSelect('multi-tag-select', 'multi-tags');
  }
  
  // Reset selection tracking to ensure tags are cleared on next selection
  previousSelectionHash = '';
  
  console.log('Exited multi-edit mode and cleared tags');
}

// Update the edit mode toggle handler
document.getElementById('edit-mode-toggle')?.addEventListener('click', () => {
  isMultiSelectMode = !isMultiSelectMode;
  const button = document.getElementById('edit-mode-toggle');
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');

  if (isMultiSelectMode) {
    button.textContent = 'Exit Multi-Edit Mode';
    button.classList.add('active');
    multiEditPanel.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
    showMultiEditPanel();
  } else {
    exitMultiEditMode();
  }
});

// Update the exit button handler
document.getElementById('exit-multi-edit-button')?.addEventListener('click', exitMultiEditMode);

// Add these configurations at the top of your file
const RENDER_CONFIG = {
  THUMBNAIL_SIZE: 250,
  MAX_CACHE_SIZE: 1000,
  CHUNK_SIZE: 5,
  JPEG_QUALITY: 0.8,
  CLEANUP_INTERVAL: 60000
};

// Add WebGL context loss handling
window.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  try {
    if (sharedRenderer) sharedRenderer.dispose();
  } catch (_) { /* ignore */ }
  sharedRenderer = null;
  if (sharedCanvas) {
    try { sharedCanvas.remove(); } catch (_) { /* ignore */ }
    sharedCanvas = null;
  }
  contextUseCount = 0;
}, false);

// Searchable list dialog functionality
async function showSearchableListDialog(fieldType, targetSelectId, mode = 'filter', containerId = null, isRemove = false) {
  const dialog = document.getElementById('searchable-list-dialog');
  const titleElement = document.getElementById('searchable-list-title');
  const searchInput = document.getElementById('searchable-list-search');
  const itemsList = document.getElementById('searchable-list-items');
  const cancelButton = document.getElementById('searchable-list-cancel');
  
  if (!dialog || !titleElement || !searchInput || !itemsList) {
    console.error('Searchable list dialog elements not found');
    return;
  }
  
  // Set title based on field type
  const titles = {
    designer: 'Select Designer',
    parent: 'Select Parent Model',
    license: 'Select License',
    tag: isRemove ? 'Remove Tag' : 'Select Tag'
  };
  titleElement.textContent = titles[fieldType] || 'Select Item';
  
  // Clear previous content
  searchInput.value = '';
  itemsList.innerHTML = '';
  
  // Fetch data based on field type
  let items = [];
  try {
    switch (fieldType) {
      case 'designer':
        items = await window.electron.getDesigners();
        break;
      case 'parent':
        items = await window.electron.getParentModels();
        // Remove duplicates
        items = [...new Set(items.filter(p => p))];
        break;
      case 'license':
        items = await window.electron.getLicenses();
        break;
      case 'tag':
        if (isRemove && targetSelectId === 'multi-tag-remove-select') {
          // For remove tags, get tags from selected files only
          if (selectedModels.size === 0) {
            items = [];
          } else {
            const filePaths = Array.from(selectedModels);
            const tagPromises = filePaths.map(async (filePath) => {
              try {
                const model = await window.electron.getModel(filePath);
                return model && model.tags ? (Array.isArray(model.tags) ? model.tags : []) : [];
              } catch (error) {
                console.error(`Error loading tags for ${filePath}:`, error);
                return [];
              }
            });
            const allTagsArrays = await Promise.all(tagPromises);
            // Collect unique tags
            const uniqueTags = new Set();
            allTagsArrays.forEach(tags => {
              if (Array.isArray(tags)) {
                tags.forEach(tag => {
                  if (tag && typeof tag === 'string') {
                    const normalizedTag = tag.trim();
                    if (normalizedTag) {
                      uniqueTags.add(normalizedTag);
                    }
                  }
                });
              }
            });
            items = Array.from(uniqueTags);
          }
        } else {
          // For add tags, get all tags
          const tags = await window.electron.getAllTags();
          items = tags.map(t => t.name);
        }
        break;
      default:
        console.error('Unknown field type:', fieldType);
        return;
    }
    
    // Sort items alphabetically
    items.sort((a, b) => a.localeCompare(b));
    
    // Filter out empty values
    items = items.filter(item => item && item.trim() !== '');
    
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No items found';
      li.style.color = '#888';
      li.style.cursor = 'default';
      itemsList.appendChild(li);
    } else {
      // Render items
      renderListItems(items, itemsList, '');
    }
  } catch (error) {
    console.error('Error fetching items for searchable list:', error);
    const li = document.createElement('li');
    li.textContent = 'Error loading items';
    li.style.color = '#ff4444';
    li.style.cursor = 'default';
    itemsList.appendChild(li);
    return;
  }
  
  // Handle item selection
  const handleItemClick = (itemValue) => {
    dialog.close();
    
    const targetSelect = document.getElementById(targetSelectId);
    if (!targetSelect) {
      console.error('Target select element not found:', targetSelectId);
      return;
    }
    
    // Set the value in the dropdown
    targetSelect.value = itemValue;
    
    // For remove tags, trigger the remove handler
    if (isRemove && targetSelectId === 'multi-tag-remove-select') {
      // Trigger the change event which will call handleRemoveTagSelect
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (fieldType === 'tag' && mode !== 'filter' && containerId) {
      // For tags in edit mode, use addTagToModel
      addTagToModel(itemValue, containerId);
    } else if (mode === 'edit' || mode === 'multi') {
      // For edit/multi mode, trigger auto-save
      const fieldMap = {
        designer: 'designer',
        parent: 'parentModel',
        license: 'license'
      };
      
      if (fieldMap[fieldType]) {
        const filePath = mode === 'edit' ? getCurrentModelFilePath() : null;
        if (mode === 'multi') {
          autoSaveMultipleModels(fieldMap[fieldType], itemValue);
        } else if (filePath) {
          autoSaveModel(fieldMap[fieldType], itemValue, filePath);
        }
      }
      
      // Trigger change event after setting value
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (mode === 'filter') {
      // For filter mode, trigger filter update
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  
  // Render list items function
  function renderListItems(itemsToRender, listElement, searchTerm) {
    listElement.innerHTML = '';
    
    if (itemsToRender.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No items found';
      li.style.color = '#888';
      li.style.cursor = 'default';
      listElement.appendChild(li);
      return;
    }
    
    itemsToRender.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      li.addEventListener('click', () => handleItemClick(item));
      listElement.appendChild(li);
    });
  }
  
  // Handle search input with debounce
  let searchTimeout;
  const handleSearch = (e) => {
    const searchTerm = e.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const filtered = items.filter(item => 
        item.toLowerCase().includes(searchTerm.toLowerCase())
      );
      renderListItems(filtered, itemsList, searchTerm);
    }, 200);
  };
  
  searchInput.addEventListener('input', handleSearch);
  
  // Handle cancel button
  const handleCancel = () => {
    dialog.close();
  };
  cancelButton.addEventListener('click', handleCancel);
  
  // Close on Escape key
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      dialog.close();
    }
  };
  dialog.addEventListener('keydown', handleKeyDown);
  
  // Clean up event listeners when dialog closes
  dialog.addEventListener('close', () => {
    searchInput.removeEventListener('input', handleSearch);
    cancelButton.removeEventListener('click', handleCancel);
    dialog.removeEventListener('keydown', handleKeyDown);
  }, { once: true });
  
  // Show dialog
  dialog.showModal();
  
  // Focus search input
  requestAnimationFrame(() => {
    searchInput.focus();
  });
}

// Helper function to get current model file path
function getCurrentModelFilePath() {
  const modelDetails = document.getElementById('model-details');
  if (modelDetails && !modelDetails.classList.contains('hidden')) {
    const pathContainer = document.getElementById('path-tree-container');
    if (pathContainer && pathContainer.dataset.filePath) {
      return pathContainer.dataset.filePath;
    }
  }
  return null;
}

// Initialize List button event listeners
function initializeListButtons() {
  document.querySelectorAll('.list-button').forEach(button => {
    // Remove existing listeners to avoid duplicates
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    newButton.addEventListener('click', async () => {
      const fieldType = newButton.dataset.field;
      const targetSelectId = newButton.dataset.target;
      const mode = newButton.dataset.mode || 'filter';
      const containerId = newButton.dataset.container || null;
      const isRemove = newButton.dataset.remove === 'true';
      
      await showSearchableListDialog(fieldType, targetSelectId, mode, containerId, isRemove);
    });
  });
}

// Remove all existing DOMContentLoaded event listeners and create a single one
// Place this at the end of the file, after all function declarations

// First, declare all initialization functions outside of any event listeners
async function initializeApp() {
  try {
    if (await isServerThumbnailWorkerContext()) {
      console.log('[Server thumbnails] Worker window: skipping initializeApp');
      return;
    }
    // Load saved sort preference before initializing search
    const savedSortOption = await window.electron.getSetting('sortOption');
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect && savedSortOption) {
      // Validate that the saved option is a valid sort option
      const validOptions = ['name-asc', 'name-desc', 'size-asc', 'size-desc', 'date-asc', 'date-desc', 'dateadded-asc', 'dateadded-desc', 'directory-asc', 'directory-desc', 'designer-asc', 'designer-desc', 'parentmodel-asc', 'parentmodel-desc', 'printed-asc', 'printed-desc'];
      if (validOptions.includes(savedSortOption)) {
        sortSelect.value = savedSortOption;
      }
    }
    
    // Initialize the combined search functionality from search.js
    if (typeof window.initializeCombinedSearch === 'function') {
      await window.initializeCombinedSearch();
    }
    
    console.log('1. Starting initialization sequence');
    
    // Initialize settings inline instead of calling initializeSettings()
    console.log('2. Loading settings...');
    try {
      // Initialize other settings as needed
      const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
      if (backgroundColor) {
        document.documentElement.style.setProperty('--model-background-color', backgroundColor);
        const colorPicker = document.getElementById('model-background-color');
        if (colorPicker) {
          colorPicker.value = backgroundColor;
        }
      }
      
      // Load UI theme
      const savedTheme = await window.electron.getSetting('uiTheme') || 'modern-cyan';
      document.body.setAttribute('data-theme', savedTheme);
      const uiThemeSelect = document.getElementById('ui-theme');
      if (uiThemeSelect) {
        uiThemeSelect.value = savedTheme;
      }
      
      // Apply theme colors if function exists
      if (typeof applyThemeColors === 'function') {
        applyThemeColors(savedTheme);
      } else {
        // Fallback: apply theme colors inline
        const root = document.documentElement;
        switch(savedTheme) {
          case 'modern-purple':
            root.style.setProperty('--primary-accent', '#a855f7');
            root.style.setProperty('--primary-accent-hover', '#c084fc');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #a855f7 0%, #c084fc 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #b866ff 0%, #d094ff 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(168, 85, 247, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(168, 85, 247, 0.4)');
            break;
          case 'modern-green':
            root.style.setProperty('--primary-accent', '#4ade80');
            root.style.setProperty('--primary-accent-hover', '#22c55e');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #5ae890 0%, #2dd66f 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(34, 197, 94, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(34, 197, 94, 0.4)');
            break;
          case 'modern-orange':
            root.style.setProperty('--primary-accent', '#fb923c');
            root.style.setProperty('--primary-accent-hover', '#f97316');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ffa34c 0%, #ff8326 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(249, 115, 22, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(249, 115, 22, 0.4)');
            break;
          case 'modern-pink':
            root.style.setProperty('--primary-accent', '#f472b6');
            root.style.setProperty('--primary-accent-hover', '#ec4899');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ff82c6 0%, #fc58a9 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(236, 72, 153, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(236, 72, 153, 0.4)');
            break;
          case 'dark-minimal':
            root.style.setProperty('--primary-accent', '#9ca3af');
            root.style.setProperty('--primary-accent-hover', '#d1d5db');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(75, 85, 99, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(75, 85, 99, 0.4)');
            break;
        }
      }
    } catch (error) {
      console.error('Error initializing settings:', error);
    }
    
    console.log('3. Checking current version...');
    const currentVersion = await window.electron.getSetting('currentVersion');
    const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
    
    console.log('4. Current app state:', {
      currentVersion,
      isBeta,
      checkingForUpdates: true
    });
    
    // Check if version check was already performed by main process
    const versionCheckPerformed = await window.electron.getSetting('versionCheckPerformedOnStartup');
    let latestVersion;
    
    if (versionCheckPerformed === 'true') {
      console.log('5. Version check already performed by main process, retrieving stored version');
      // Get the latest version from the database instead of making another HTTP request
      latestVersion = await window.electron.getSetting('latestVersion');
      console.log('Retrieved latest version from database:', latestVersion);
    } else {
      console.log('5. Checking for updates...');
      latestVersion = await window.electron.checkForUpdates(isBeta);
    }
    
    // Reset the flag for next app start
    await window.electron.saveSetting('versionCheckPerformedOnStartup', 'false');
    
    const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');
    
    console.log('6. Version check results:', {
      currentVersion,
      latestVersion,
      lastDeclinedVersion,
      isBeta,
      needsUpdate: latestVersion !== currentVersion
    });
    
    // Only show prompt if it's a new version and not the one user previously declined
    // This is an automatic check (silent=true), so respect lastDeclinedVersion
    const isUpdateAvailable = latestVersion && 
                              latestVersion !== currentVersion && 
                              compareVersions(latestVersion, currentVersion) > 0;
    const shouldShowPrompt = isUpdateAvailable && 
                             latestVersion !== lastDeclinedVersion;
    
    if (shouldShowPrompt) {
      console.log('7. Update available - showing prompt');
      const shouldUpdate = await window.electron.showMessage(
        'Update Available',
        `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
        ['Yes', 'No']
      );
      
      console.log('Renderer - Update prompt response:', shouldUpdate);
      if (shouldUpdate === 'Yes') {
        await window.electron.openUpdatePage(isBeta);
      } else {
        // Store the declined version
        console.log('Renderer - User declined update, storing version:', latestVersion);
        await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
      }
    }

    // Store the latest version after check
    if (latestVersion) {
      console.log('Renderer - Saving latest version to settings:', latestVersion);
      await window.electron.saveSetting('latestVersion', latestVersion);
      await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());
    }
    
    console.log('8. Initializing UI components');
    // Call initializeDialogHandlers directly if it's accessible
    if (typeof initializeDialogHandlers === 'function') {
      initializeDialogHandlers();
    }
    
    // Initialize performance settings inline
    try {
      // Get the stored max file size value
      const maxFileSize = await window.electron.getSetting('maxFileSizeMB');
      if (maxFileSize) {
        MAX_FILE_SIZE_MB = parseInt(maxFileSize);
      }

      // Set the input value if the element exists
      const maxFileSizeInput = document.getElementById('max-file-size');
      if (maxFileSizeInput) {
        maxFileSizeInput.value = MAX_FILE_SIZE_MB.toString();
      }
    } catch (error) {
      console.error('Error initializing performance settings:', error);
    }
    

    
    console.log('9. Initialization complete');
  } catch (error) {
    console.error('Fatal error during initialization:', error);
    throw error; // Re-throw to be caught by the DOMContentLoaded handler
  }
}

// Remove the version check from initializeGrid
async function initializeGrid(sortOption = 'name') {
  try {
    const models = await window.electron.getAllModels(sortOption);
    const fileGrid = document.querySelector('.file-grid');
    
    await updateModelCounts(models.length);
    fileGrid.innerHTML = '';
    // ... rest of grid initialization
  } catch (error) {
    console.error('Error initializing grid:', error);
  }
}

// Edit the DOMContentLoaded event listener to remove the call to promptPendingThumbnails
document.addEventListener('DOMContentLoaded', async () => {
  const tosAccepted = await checkTermsOfService();
  if (!tosAccepted) return; // Don't continue if TOS was declined

  // Check for server mode and add UI indicators
  const serverMode = await window.electron.isServerMode().catch(() => false);
  if (serverMode) {
    // Server mode indicator and menu bar are already added in the first DOMContentLoaded listener
    // Just ensure they exist (they should already be there)
    if (!document.getElementById('server-mode-indicator')) {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) {
        const serverIndicator = document.createElement('div');
        serverIndicator.id = 'server-mode-indicator';
        serverIndicator.style.cssText = 'background-color: #4a9eff; color: white; padding: 10px; margin: 10px 0; border-radius: 4px; text-align: center; font-weight: bold;';
        serverIndicator.innerHTML = `
          <div>🌐 Server Mode</div>
          <div style="font-size: 12px; font-weight: normal; margin-top: 5px;">
            UNC paths required for all file operations
          </div>
        `;
        sidebar.insertBefore(serverIndicator, sidebar.firstChild);
      }
    }
    if (!document.getElementById('server-menu-bar')) {
      await createServerMenuBar();
    }
  }

  // First-run welcome is handled in the primary DOMContentLoaded startup path in this file.
  debugLog('DOM fully loaded and parsed');

  // Continue with normal initialization (which includes update checking)
  await initializeApp();

  // (Any additional event listeners and UI initialization code below)
});

// Add event listeners for the multi-edit panel move and delete buttons
document.getElementById('move-selected-button')?.addEventListener('click', async () => {
    if (selectedModels.size === 0) {
        await window.electron.showMessage('No Selection', 'Please select models to move.');
        return;
    }
    const count = selectedModels.size;
    const confirmation = await window.electron.showMessage(
        'Confirm Move',
        `Are you sure you want to move ${count} selected model${count !== 1 ? 's' : ''}?`,
        ['Yes', 'No']
    );
    if (confirmation !== 'Yes') return;

    // Open folder dialog via IPC
    const result = await window.electron.openFolderDialog('Select Destination Folder');
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const destinationFolder = result.filePaths[0];
        try {
            // Move files
            for (const filePath of selectedModels) {
                const newDestination = path.join(destinationFolder, path.basename(filePath));
                await fs.promises.rename(filePath, newDestination);
                db.prepare('UPDATE models SET filePath = ? WHERE filePath = ?').run(newDestination, filePath);
            }
            // Clear selected models after moving
            selectedModels.clear();
            updateSelectedCount(); // Update the UI to reflect the cleared selection
            document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected')); // Clear visual selection
        } catch (error) {
            console.error('Error moving selected models:', error);
        }
    }
});

document.getElementById('delete-selected-button')?.addEventListener('click', async () => {
  if (selectedModels.size === 0) {
    await window.electron.showMessage('No Selection', 'Please select models to delete.');
    return;
  }
  const count = selectedModels.size;
  const confirmation = await window.electron.showMessage(
    'Confirm Deletion',
    `Are you sure you want to DELETE ${count} selected model${count !== 1 ? 's' : ''}? This cannot be undone!`,
    ['Yes', 'No']
  );
  if (confirmation !== 'Yes') return;

  // Delete selected models one-by-one.
  for (const filePath of selectedModels) {
    try {
      await window.electron.deleteFile(filePath);
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
    }
  }
  // Clear selected models after deletion.
  selectedModels.clear();
  // Refresh the display (assuming 'refreshModelDisplay' exists).
  await refreshModelDisplay();
});

// Add a semantic version comparison function at an appropriate place in the file
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  
  return 0;
}

// Add this event handler after the other window.electron.on handlers
window.electron.on('show-native-prompt', async (options) => {
  const { title, label, placeholder } = options;
  const value = prompt(label || 'Please enter a value:', placeholder || '');
  
  // Send the response back to main process
  window.electron.send('native-prompt-response', { 
    value: value,
    canceled: value === null
  });
});

// Add implementation of autoSaveModel function
async function autoSaveModel(field, value, filePath) {
  try {
    if (!filePath) {
      console.error('No file path provided for autoSaveModel');
      return;
    }
    
    const model = await window.electron.getModel(filePath);
    if (!model) {
      console.error(`Model not found for ${filePath}`);
      return;
    }
    
    // Update the specified field
    model[field] = value;
    
    // Save the updated model
    await window.electron.saveModel(model);
    
    // If this was called from the details panel, update the displayed file
    await updateModelElement(filePath);
    
    // Also update the checkbox in the model details panel if it's showing this model
    if (field === 'printed') {
      // Use the same logic as getModelFilePath to determine current model
      const currentModelPath = getCurrentModelFilePath() || 
        document.querySelector('.model-details')?.getAttribute('data-filepath');
      
      // Check if the details panel is showing this model
      if (currentModelPath === filePath) {
        const printedCheckbox = document.getElementById('model-printed');
        if (printedCheckbox) {
          printedCheckbox.checked = value;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Error in autoSaveModel for field ${field}:`, error);
    return false;
  }
}

// Add implementation of autoSaveMultipleModels function
async function autoSaveMultipleModels(field, value, options = {}) {
  try {
    // No models selected
    if (selectedModels.size === 0) {
      console.warn('No models selected for autoSaveMultipleModels');
      return false; // Indicate failure/no-op
    }
    
    // Handle designer field default value (will be reapplied next)
    if (field === 'designer' && !value) {
      value = 'Unknown';
    }
    
    // Create a copy of selectedModels to avoid issues if the set changes during iteration
    const modelsToUpdate = Array.from(selectedModels);
    console.log(`autoSaveMultipleModels: Updating ${modelsToUpdate.length} models for field ${field}`);
    
    // Load all models in parallel for better performance
    const modelLoadPromises = modelsToUpdate.map(async (filePath, index) => {
      try {
        console.log(`[${index}] Loading model: ${filePath}`);
        const model = await window.electron.getModel(filePath);
        if (model) {
          console.log(`[${index}] Successfully loaded model: ${filePath}`);
          return { filePath, model };
        } else {
          console.warn(`[${index}] Could not find model for ${filePath} during autoSaveMultipleModels`);
          return null;
        }
      } catch (error) {
        console.error(`[${index}] Error loading model ${filePath} in autoSaveMultipleModels:`, error);
        return null;
      }
    });
    
    // Wait for all models to load in parallel
    const loadedModels = await Promise.all(modelLoadPromises);
    console.log(`Loaded ${loadedModels.length} models, ${loadedModels.filter(r => r !== null).length} successful`);
    
    // Filter out null results and prepare updates
    const modelUpdates = [];
    for (let i = 0; i < loadedModels.length; i++) {
      const result = loadedModels[i];
      if (result) {
        const { filePath, model } = result;
        console.log(`[${i}] Processing model update for: ${filePath}`);
        // Special handling for tags - MERGE or REPLACE based on options
        if (field === 'tags') {
          const newTags = Array.isArray(value) ? value : []; 
          if (options.replaceTags) {
            // Replace tags completely (used when removing tags)
            model.tags = newTags.sort();
            console.log(`[${i}] Replacing tags with: ${newTags.join(', ')}`);
          } else {
            // Merge tags (used when adding tags)
            const existingTags = Array.isArray(model.tags) ? model.tags : [];
            // Combine, filter out duplicates, and sort
            const allTags = [...new Set([...existingTags, ...newTags])].sort(); 
            model.tags = allTags;
            console.log(`[${i}] Merging tags. Existing: ${existingTags.join(', ')}, New: ${newTags.join(', ')}, Result: ${allTags.join(', ')}`);
          }
        } else {
          // Handle other fields
          model[field] = value;
        }
        
        modelUpdates.push({ filePath, model });
        console.log(`[${i}] Added to batch: ${filePath}, field ${field} = ${value}`);
      } else {
        console.warn(`[${i}] Skipping null result at index ${i}`);
      }
    }
    console.log(`Prepared ${modelUpdates.length} models for batch update`);
    
    // Save all models in a single bulk update
    if (modelUpdates.length > 0) {
      const modelDataBatch = modelUpdates.map(({ model }) => model);
      try {
        // Use bulk update for better performance - single transaction
        console.log(`Attempting bulk update for ${modelDataBatch.length} models`);
        const success = await window.electron.updateModelsBatch(modelDataBatch);
        if (!success) {
          throw new Error('Bulk update returned false');
        }
        console.log(`Successfully bulk updated ${modelDataBatch.length} models`);
      } catch (error) {
        console.error(`Error in bulk update for ${modelUpdates.length} models:`, error);
        console.log('Falling back to individual saves');
        // Fallback to individual saves if bulk update fails
        const savePromises = modelUpdates.map(({ model }) => 
          window.electron.saveModel(model).catch(err => {
            console.error(`Error saving model ${model.filePath}:`, err);
            return null;
          })
        );
        await Promise.all(savePromises);
      }
    }
    
    await new Promise(resolve => requestAnimationFrame(resolve));

    // Merge into virtual grid memory, drop stale visible DOM for updated paths, then re-run visible render.
    // renderVisibleItems reuses matching .file-item nodes and only moves them — it does not refresh metadata,
    // so without removing those nodes bulk designer/printed/license changes would not show on screen.
    const gridContainer = document.querySelector('.file-grid');
    if (gridContainer && gridContainer.currentModels && modelUpdates.length > 0) {
      const updatedNorm = new Set(
        modelUpdates.map(({ filePath }) => normalizePathForComparison(filePath))
      );
      for (const { filePath, model } of modelUpdates) {
        const normalizedTarget = normalizePathForComparison(filePath);
        const idx = gridContainer.currentModels.findIndex(m =>
          normalizePathForComparison(m.filePath || m.id || '') === normalizedTarget
        );
        if (idx !== -1) {
          gridContainer.currentModels[idx] = { ...model };
        }
      }
      const virtualContent = gridContainer.querySelector('.virtual-content');
      if (virtualContent) {
        virtualContent.querySelectorAll('.file-item').forEach((el) => {
          const p = el.getAttribute('data-filepath');
          if (p && updatedNorm.has(normalizePathForComparison(p))) {
            el.remove();
          }
        });
      }
      if (gridContainer.renderVisibleItemsFn) {
        requestAnimationFrame(() => {
          gridContainer.renderVisibleItemsFn();
        });
      }
    }
    
    console.log(`Finished autoSaveMultipleModels for field ${field}. Updated ${modelsToUpdate.length} models.`);
    return true;
  } catch (error) {
    console.error(`Error in autoSaveMultipleModels for field ${field}:`, error);
    return false;
  }
}

// Helper function to get the current model file path
function getModelFilePath() {
  // First try to get it from the path tree container
  const currentPath = getCurrentModelFilePath();
  if (currentPath) {
    return currentPath;
  }
  
  // Fallback: try to get it from the model-path input (for backwards compatibility)
  const pathInput = document.getElementById('model-path');
  if (pathInput && pathInput.value) {
    return pathInput.value;
  }
  
  // Then try to get it from the model-details data attribute
  const detailsPanel = document.querySelector('.model-details');
  if (detailsPanel && detailsPanel.getAttribute('data-filepath')) {
    return detailsPanel.getAttribute('data-filepath');
  }
  
  return null;
}

// Helper function to clear all multi-edit form fields
function clearMultiEditFormFields() {
  // Clear the printed checkbox
  const multiPrintedCheckbox = document.getElementById('multi-printed');
  if (multiPrintedCheckbox) {
    multiPrintedCheckbox.checked = false;
  }
  
  // Clear the source input
  const multiSourceInput = document.getElementById('multi-source');
  if (multiSourceInput) {
    multiSourceInput.value = '';
  }
  
  // Clear the designer dropdown
  const multiDesignerSelect = document.getElementById('multi-designer');
  if (multiDesignerSelect) {
    multiDesignerSelect.value = '';
  }
  
  // Clear the parent dropdown
  const multiParentSelect = document.getElementById('multi-parent');
  if (multiParentSelect) {
    multiParentSelect.value = '';
  }
  
  // Clear the license dropdown
  const multiLicenseSelect = document.getElementById('multi-license');
  if (multiLicenseSelect) {
    multiLicenseSelect.value = '';
  }
  
  // Clear the multi-edit tag container
  const multiTagsContainer = document.getElementById('multi-tags');
  if (multiTagsContainer) {
    multiTagsContainer.innerHTML = '';
  }
  
  // Reset the multi-tag-select dropdown
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    multiTagSelect.value = '';
  }

  // Reset the multi-tag-remove-select dropdown
  const multiTagRemoveSelect = document.getElementById('multi-tag-remove-select');
  if (multiTagRemoveSelect) {
    multiTagRemoveSelect.value = '';
    multiTagRemoveSelect.innerHTML = '<option value="">Select a tag to remove...</option>';
  }
}

// Add this code to set up event handlers for multi-edit mode controls
async function showMultiEditPanel() {
  // Populate dropdowns with existing data - REMOVED redundant calls
  // populateModelDesignerDropdown('', 'multi-designer');
  // populateModelLicenseDropdown('', 'multi-license');
  // populateParentModelDropdown('', 'multi-parent');
  // populateTagSelect('multi-tag-select', 'multi-tags');
  
  // Always clear the multi-edit tag container to prevent tags from sticking
  // This ensures that when a new selection is made, old tags don't persist
  // Note: The container is hidden in multi-edit mode, but we still clear it
  const multiTagsContainer = document.getElementById('multi-tags');
  if (multiTagsContainer) {
    multiTagsContainer.innerHTML = '';
    multiTagsContainer.style.display = 'none'; // Hide the tag list in multi-edit mode
  }
  
  // Reset the multi-tag-select dropdown
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    multiTagSelect.value = '';
  }
  
  // Also call the selection change handler to update tracking
  clearTagsOnSelectionChange();
  
  // Force the checkbox to be unchecked at the start
  const multiPrintedCheckbox = document.getElementById('multi-printed');
  if (multiPrintedCheckbox) {
    multiPrintedCheckbox.checked = false;
  }
  
  // Reset the source input
  const multiSourceInput = document.getElementById('multi-source');
  if (multiSourceInput) {
    multiSourceInput.value = '';
  }
  
  // Only clear dropdowns if no models are selected
  if (selectedModels.size === 0) {
    const multiDesignerSelect = document.getElementById('multi-designer');
    if (multiDesignerSelect) {
      multiDesignerSelect.value = '';
    }
    
    const multiParentSelect = document.getElementById('multi-parent');
    if (multiParentSelect) {
      multiParentSelect.value = '';
    }
    
    const multiLicenseSelect = document.getElementById('multi-license');
    if (multiLicenseSelect) {
      multiLicenseSelect.value = '';
    }
  }
  
  // Add change handlers for multi-edit controls
  document.getElementById('multi-designer')?.addEventListener('change', async (e) => {
    const value = e.target.value; // Only save if explicitly set
    if (value) {
      await autoSaveMultipleModels('designer', value);
    }
  });
  
  document.getElementById('multi-parent')?.addEventListener('change', async (e) => {
    await autoSaveMultipleModels('parentModel', e.target.value);
  });
  
  document.getElementById('multi-license')?.addEventListener('change', async (e) => {
    await autoSaveMultipleModels('license', e.target.value);
  });
  
  // Use input event with debounce for the source field so it saves as user types
  if (multiSourceInput) {
    // First remove any existing event listeners
    const newInput = multiSourceInput.cloneNode(true);
    multiSourceInput.parentNode.replaceChild(newInput, multiSourceInput);
    
    // Add debounced input event listener
    newInput.addEventListener('input', debounce(async function() {
      const sourceValue = this.value.trim();
      console.log(`Saving source value: "${sourceValue}"`);
      await autoSaveMultipleModels('source', sourceValue);
    }, 500));
    
    console.log('Multi-source input event handler attached');
  } else {
    console.error('Multi-source input not found');
  }
  
  // Add explicit event listener for the printed checkbox
  if (multiPrintedCheckbox) {
    // Create a highly visible function for debugging
    const handlePrintedChange = async function() {
      const isChecked = this.checked;
      console.log(`Multi-printed checkbox changed to: ${isChecked}`);
      
      if (selectedModels.size === 0) {
        console.warn('No models selected for updating printed status');
        return;
      }
      
      // Use autoSaveMultipleModels which handles bulk update
      await autoSaveMultipleModels('printed', isChecked);
    };
    
    // First remove any existing event listeners
    const newCheckbox = multiPrintedCheckbox.cloneNode(true);
    multiPrintedCheckbox.parentNode.replaceChild(newCheckbox, multiPrintedCheckbox);
    
    // Add event listener with both input and change events
    newCheckbox.addEventListener('change', handlePrintedChange);
    newCheckbox.addEventListener('click', function() {
      console.log('Multi-printed checkbox clicked, current state:', this.checked);
    });
    
    console.log('Multi-printed checkbox event handlers attached in showMultiEditPanel');
  } else {
    console.error('Multi-printed checkbox not found in showMultiEditPanel');
  }
  
  // Re-attach event listener for multi-tag-select
  // Get fresh reference since we may have cloned it earlier
  const multiTagSelectElement = document.getElementById('multi-tag-select');
  if (multiTagSelectElement) {
    // Clone/replace to ensure any old listeners are gone (might be redundant but safe)
    const newMultiTagSelect = multiTagSelectElement.cloneNode(true);
    multiTagSelectElement.parentNode.replaceChild(newMultiTagSelect, multiTagSelectElement);

    // Add the change listener
    newMultiTagSelect.addEventListener('change', () => {
      const selectedTag = newMultiTagSelect.value;
      if (selectedTag) {
        addTagToModel(selectedTag, 'multi-tags');
        newMultiTagSelect.value = ''; // Reset selection
      }
    });
    console.log('Multi-tag-select event handler re-attached in showMultiEditPanel');
  } else {
    console.error('Multi-tag-select element not found in showMultiEditPanel');
  }

  // Set up remove tag select event listener
  const removeTagSelectElement = document.getElementById('multi-tag-remove-select');
  if (removeTagSelectElement) {
    // Clone/replace to ensure any old listeners are gone
    const newRemoveTagSelect = removeTagSelectElement.cloneNode(true);
    removeTagSelectElement.parentNode.replaceChild(newRemoveTagSelect, removeTagSelectElement);

    // Add the change listener
    newRemoveTagSelect.addEventListener('change', async () => {
      await handleRemoveTagSelect();
    });
    console.log('Multi-tag-remove-select event handler attached in showMultiEditPanel');

    // Populate the remove tag dropdown
    await populateRemoveTagSelect();
  } else {
    console.error('Multi-tag-remove-select element not found in showMultiEditPanel');
  }
  
  // Initialize List buttons for multi-edit panel
  initializeListButtons();
}

// Update the edit mode toggle handler to call showMultiEditPanel when entering multi-edit mode
document.getElementById('edit-mode-toggle')?.addEventListener('click', () => {
  isMultiSelectMode = !isMultiSelectMode;
  const button = document.getElementById('edit-mode-toggle');
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');

  if (isMultiSelectMode) {
    button.textContent = 'Exit Multi-Edit Mode';
    button.classList.add('active');
    multiEditPanel.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
    showMultiEditPanel();
  } else {
    exitMultiEditMode();
  }
});

// Add a direct event listener for the multi-printed checkbox
document.addEventListener('DOMContentLoaded', () => {
  // Setup multi-printed checkbox handler
  const multiPrintedCheckbox = document.getElementById('multi-printed');
  if (multiPrintedCheckbox) {
    // First remove any existing listeners by cloning and replacing
    const newCheckbox = multiPrintedCheckbox.cloneNode(true);
    multiPrintedCheckbox.parentNode.replaceChild(newCheckbox, multiPrintedCheckbox);
    
    // Add the event listener to the new checkbox
    newCheckbox.addEventListener('change', async function() {
      const isChecked = this.checked;
      console.log(`Multi-printed checkbox changed to: ${isChecked}`);
      
      // Use autoSaveMultipleModels which handles bulk update
      await autoSaveMultipleModels('printed', isChecked);
    });
    
    console.log('Multi-printed checkbox event listener attached');
  } else {
    console.error('Multi-printed checkbox not found');
  }

  // Add event listener for the Clear Selection button
  const clearSelectionButton = document.getElementById('clear-selection-button');
  if (clearSelectionButton) {
    clearSelectionButton.addEventListener('click', () => {
      console.log('Clear Selection button clicked');
      if (isMultiSelectMode) {
        selectedModels.clear();
        document.querySelectorAll('.file-item.selected').forEach(item => {
          item.classList.remove('selected');
        });
        
        // Clear all multi-edit form fields
        clearMultiEditFormFields();
        
        // Refresh the tag dropdown options
        populateTagSelect('multi-tag-select', 'multi-tags');
        
        updateSelectedCount(); // Update the count display
        
        console.log('Selection cleared');
      }
    });
    console.log('Clear Selection button event listener attached');
  } else {
    console.error('Clear Selection button not found');
  }
});

// ==================== NEW CODE: Virtual Grid Implementation ====================

/**
 * Grid queries omit the full `thumbnail` blob (only hasThumbnail / hasMultipleThumbnails).
 * Cards load the primary thumb via getThumbnail for visible rows only.
 * When hasMultipleThumbnails is set, upgrade to carousel via getAllThumbnails
 * (detailed/preview only — never for every grid cell).
 */
async function maybeUpgradeGridItemToCarousel(thumbnailContainer, model, thumbSize, parseThumbnails) {
  if (!thumbnailContainer || !model?.filePath || !window.electron?.getAllThumbnails) return;
  const fileItem = thumbnailContainer.closest('.file-item');
  const isCarouselView =
    fileItem &&
    (fileItem.classList.contains('file-item-detailed') || fileItem.classList.contains('file-item-preview'));
  if (!isCarouselView) return;
  if (fileItem.querySelector('.thumbnail-nav-left')) return;
  if (!model.hasMultipleThumbnails) return;
  try {
    const all = await window.electron.getAllThumbnails(model.filePath);
    const valid = (all || []).filter(
      (t) => t && typeof t === 'string' && t.length > 0 && t !== '3d.png' && t.startsWith('data:image')
    );
    if (valid.length < 2 || !thumbnailContainer.isConnected) return;
    model.thumbnail = valid.join('::');
    model.hasMultipleThumbnails = true;
    model.hasThumbnail = true;
    syncPrimaryThumbnailCacheFromThumbnailString(model.filePath, model.thumbnail);
    upgradeGridItemToThumbnailCarousel(thumbnailContainer, model, valid, thumbSize, parseThumbnails);
  } catch (_) {
    /* not critical */
  }
}

function upgradeGridItemToThumbnailCarousel(thumbnailContainer, model, validThumbnails, thumbSize, parseThumbnails) {
  const fileItem = thumbnailContainer.closest('.file-item');
  const isCarouselView =
    fileItem &&
    (fileItem.classList.contains('file-item-detailed') || fileItem.classList.contains('file-item-preview'));
  if (!isCarouselView) return;
  if (!validThumbnails || validThumbnails.length < 2) return;
  if (fileItem.querySelector('.thumbnail-nav-left')) return;

  const parent = thumbnailContainer.parentNode;
  if (!parent) return;

  const thumbnailWrapper = document.createElement('div');
  thumbnailWrapper.className = 'thumbnail-wrapper';
  thumbnailWrapper.style.position = 'relative';
  thumbnailWrapper.style.width = thumbSize.width;
  thumbnailWrapper.style.height = thumbSize.height;
  thumbnailWrapper.dataset.thumbnails = JSON.stringify(validThumbnails);
  thumbnailWrapper.dataset.currentIndex = '0';
  thumbnailWrapper.dataset.filePath = model.filePath;

  const leftNav = document.createElement('div');
  leftNav.className = 'thumbnail-nav-left';
  leftNav.style.cssText = 'position:absolute;left:0;top:0;width:50%;height:100%;cursor:pointer;z-index:10;';
  leftNav.title = 'Previous image';

  const rightNav = document.createElement('div');
  rightNav.className = 'thumbnail-nav-right';
  rightNav.style.cssText = 'position:absolute;right:0;top:0;width:50%;height:100%;cursor:pointer;z-index:10;';
  rightNav.title = 'Next image';

  const navigateThumbnail = async (direction) => {
    const wrapper = thumbnailWrapper;
    let thumbnails = JSON.parse(wrapper.dataset.thumbnails);
    let currentIndex = parseInt(wrapper.dataset.currentIndex, 10);
    if (isNaN(currentIndex)) {
      currentIndex = 0;
      wrapper.dataset.currentIndex = '0';
    }

    const validTs = thumbnails.filter(
      (t) => t && typeof t === 'string' && t.length > 0 && t !== '3d.png'
    );
    if (validTs.length !== thumbnails.length) {
      thumbnails = validTs;
      wrapper.dataset.thumbnails = JSON.stringify(thumbnails);
    }
    if (validTs.length === 0) return;
    if (currentIndex >= validTs.length) currentIndex = 0;

    if (direction === 'prev') {
      currentIndex = (currentIndex - 1 + validTs.length) % validTs.length;
    } else {
      currentIndex = (currentIndex + 1) % validTs.length;
    }
    wrapper.dataset.currentIndex = String(currentIndex);

    if (wrapper._updateBadge) wrapper._updateBadge();
    const navImg = wrapper.querySelector('.thumbnail-container img');
    if (navImg) {
      navImg.src = validTs[currentIndex];
      if (wrapper._saveTimeout) clearTimeout(wrapper._saveTimeout);
      wrapper._saveTimeout = setTimeout(async () => {
        try {
          const idxToSave = parseInt(wrapper.dataset.currentIndex, 10) || 0;
          const thumbs = JSON.parse(wrapper.dataset.thumbnails);
          if (thumbs && thumbs.length > idxToSave && idxToSave >= 0) {
            await window.electron.setDefaultThumbnail(model.filePath, idxToSave);
            const updatedModel = await window.electron.getModel(model.filePath);
            if (updatedModel && updatedModel.thumbnail) {
              model.thumbnail = updatedModel.thumbnail;
              const reordered = parseThumbnails(updatedModel.thumbnail);
              syncPrimaryThumbnailCacheFromThumbnailString(model.filePath, updatedModel.thumbnail);
              wrapper.dataset.thumbnails = JSON.stringify(reordered);
              wrapper.dataset.currentIndex = '0';
              if (wrapper._updateBadge) wrapper._updateBadge();
              const imgEl = wrapper.querySelector('.thumbnail-container img');
              if (imgEl && reordered[0]) imgEl.src = reordered[0];
            }
          }
        } catch (e) {
          console.error('Error saving default thumbnail:', e);
        }
      }, 2000);
    }
  };

  leftNav.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateThumbnail('prev');
  });
  rightNav.addEventListener('click', (e) => {
    e.stopPropagation();
    navigateThumbnail('next');
  });

  const badge = document.createElement('div');
  badge.className = 'thumbnail-count-badge';
  const updateBadgeText = () => {
    const currentIdx = parseInt(thumbnailWrapper.dataset.currentIndex, 10) || 0;
    const currentThumbs = JSON.parse(
      thumbnailWrapper.dataset.thumbnails || JSON.stringify(validThumbnails)
    );
    const total = currentThumbs.length;
    badge.textContent = `${currentIdx + 1}/${total}`;
    badge.title = `Image ${currentIdx + 1} of ${total} - Click left/right to navigate`;
  };
  updateBadgeText();
  badge.style.cssText =
    'position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.7);color:#fff;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:bold;z-index:11;pointer-events:none;';
  thumbnailWrapper._updateBadge = updateBadgeText;

  parent.insertBefore(thumbnailWrapper, thumbnailContainer);
  thumbnailWrapper.appendChild(leftNav);
  thumbnailWrapper.appendChild(rightNav);
  thumbnailWrapper.appendChild(badge);
  thumbnailWrapper.appendChild(thumbnailContainer);

  const imgEl = thumbnailContainer.querySelector('img');
  if (imgEl && validThumbnails[0]) imgEl.src = validThumbnails[0];
}

function normalizeModelRatingValue(value) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || n < 0) return 0;
  if (n > 5) return 5;
  return n;
}

function computeGroupEngagementFromChildren(children) {
  const list = Array.isArray(children) ? children : [];
  if (!list.length) return { rating: 0, favorite: false };
  const ratings = list.map((c) => normalizeModelRatingValue(c?.rating));
  const sum = ratings.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / list.length);
  const favorite = list.some((c) => Boolean(c?.favorite));
  return { rating: avg, favorite };
}

function updateEngagementBarDisplay(bar, rating, favorite, hoverRating = null) {
  if (!bar) return;
  const displayRating = hoverRating != null ? hoverRating : normalizeModelRatingValue(rating);
  const stars = bar.querySelectorAll('.model-star');
  stars.forEach((star, i) => {
    const starNum = i + 1;
    const filled = starNum <= displayRating;
    star.classList.toggle('is-filled', filled);
    star.textContent = filled ? '★' : '☆';
  });
  const favBtn = bar.querySelector('.model-favorite-btn');
  if (favBtn) {
    favBtn.classList.toggle('is-favorited', Boolean(favorite));
    favBtn.setAttribute('aria-pressed', favorite ? 'true' : 'false');
    favBtn.textContent = favorite ? '♥' : '♡';
  }
  bar.dataset.rating = String(normalizeModelRatingValue(rating));
  bar.dataset.favorite = favorite ? '1' : '0';
}

async function bulkSaveModelsEngagement(filePaths, field, value) {
  if (!filePaths || !filePaths.length) return false;
  const updates = [];
  for (const filePath of filePaths) {
    try {
      const model = await window.electron.getModel(filePath);
      if (!model) continue;
      model[field] = value;
      updates.push(model);
    } catch (err) {
      console.error('bulkSaveModelsEngagement load error:', filePath, err);
    }
  }
  if (!updates.length) return false;
  try {
    const success = await window.electron.updateModelsBatch(updates);
    if (success) {
      for (const m of updates) {
        await updateModelElement(m.filePath);
      }
    }
    return success;
  } catch (err) {
    console.error('bulkSaveModelsEngagement save error:', err);
    return false;
  }
}

function createModelEngagementBar(context, options = {}) {
  const { groupMode = false, children = [] } = options;
  let rating = 0;
  let favorite = false;
  let filePaths = [];

  if (groupMode) {
    const agg = computeGroupEngagementFromChildren(children);
    rating = agg.rating;
    favorite = agg.favorite;
    filePaths = (children || []).map((c) => c?.filePath).filter(Boolean);
  } else {
    rating = normalizeModelRatingValue(context?.rating);
    favorite = Boolean(context?.favorite);
    filePaths = context?.filePath ? [context.filePath] : [];
  }

  const bar = document.createElement('div');
  bar.className = 'model-engagement-bar' + (groupMode ? ' is-group' : '');

  const ratingWrap = document.createElement('div');
  ratingWrap.className = 'model-rating';
  ratingWrap.setAttribute('role', 'radiogroup');
  ratingWrap.setAttribute('aria-label', groupMode ? 'Group rating' : 'Rating');

  let hoverRating = null;

  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('button');
    star.type = 'button';
    star.className = 'model-star';
    star.dataset.star = String(i);
    star.setAttribute('aria-label', `${i} star${i === 1 ? '' : 's'}`);
    star.textContent = '☆';

    star.addEventListener('mouseenter', () => {
      hoverRating = i;
      updateEngagementBarDisplay(bar, rating, favorite, hoverRating);
    });
    star.addEventListener('mouseleave', () => {
      hoverRating = null;
      updateEngagementBarDisplay(bar, rating, favorite, null);
    });
    star.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const starNum = i;
      const newRating = normalizeModelRatingValue(rating) === starNum ? 0 : starNum;
      if (groupMode) {
        const ok = await bulkSaveModelsEngagement(filePaths, 'rating', newRating);
        if (ok) {
          rating = newRating;
          children.forEach((c) => { if (c) c.rating = newRating; });
          updateEngagementBarDisplay(bar, rating, favorite);
        }
      } else {
        const ok = await autoSaveModel('rating', newRating, context.filePath);
        if (ok) {
          rating = newRating;
          updateEngagementBarDisplay(bar, rating, favorite);
        }
      }
    });

    ratingWrap.appendChild(star);
  }

  const favBtn = document.createElement('button');
  favBtn.type = 'button';
  favBtn.className = 'model-favorite-btn';
  favBtn.setAttribute('aria-pressed', favorite ? 'true' : 'false');
  favBtn.title = groupMode ? 'Favorite all models in group' : 'Favorite';
  favBtn.textContent = favorite ? '♥' : '♡';

  favBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const newFavorite = !favorite;
    if (groupMode) {
      const ok = await bulkSaveModelsEngagement(filePaths, 'favorite', newFavorite);
      if (ok) {
        favorite = newFavorite;
        children.forEach((c) => { if (c) c.favorite = newFavorite; });
        updateEngagementBarDisplay(bar, rating, favorite);
      }
    } else {
      const ok = await autoSaveModel('favorite', newFavorite, context.filePath);
      if (ok) {
        favorite = newFavorite;
        updateEngagementBarDisplay(bar, rating, favorite);
      }
    }
  });

  bar.appendChild(ratingWrap);
  bar.appendChild(favBtn);
  updateEngagementBarDisplay(bar, rating, favorite);

  return bar;
}

// Helper function to create a DOM element for a model item
function createModelItem(model, viewMode = null, thumbPriority = THUMB_PRIORITY_BACKGROUND) {
  const view = viewMode || currentGridView;
  const item = document.createElement('div');
  item.className = `file-item file-item-${view}`;
  item.dataset.filepath = model.filePath;

  if (isInSelectedModels(model.filePath)) {
    item.classList.add('selected');
  }

  // Print status element
  const printStatus = document.createElement('div');
  printStatus.className = 'print-status' + (model.printed ? ' printed' : '');
  printStatus.textContent = model.printed ? 'Printed' : 'Not Printed';
  printStatus.style.cursor = 'pointer';
  printStatus.title = 'Click to toggle printed status';
  
  // Add click handler to toggle printed status
  printStatus.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent triggering file item click
    
    // Get current model state to ensure we have the latest printed status
    const currentModel = await window.electron.getModel(model.filePath);
    if (currentModel) {
      const newPrintedStatus = !currentModel.printed;
      await autoSaveModel('printed', newPrintedStatus, model.filePath);
    }
  });
  
  item.appendChild(printStatus);

  // Archive status element (for models inside ZIP archives)
  const isZipEntry = model.filePath && model.filePath.includes('::');
  let archiveStatus = null;
  if (isZipEntry) {
    archiveStatus = document.createElement('div');
    archiveStatus.className = 'archive-status';
    archiveStatus.textContent = 'Archive';
    item.appendChild(archiveStatus);
  }

  // Define thumbnail sizes based on view mode (optimized)
  const previewPx = view === 'preview' ? getPreviewTileSizePx() : 0;
  const thumbnailSizes = {
    'list': { width: '48px', height: '48px' },      // Slightly larger for better visibility
    'preview': { width: `${previewPx}px`, height: `${previewPx}px` },
    'detailed': { width: '276px', height: '276px' }  // Optimized large thumbnail
  };
  
  const thumbSize = thumbnailSizes[view] || thumbnailSizes['detailed'];
  
  // Thumbnail container with size based on view mode
  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'thumbnail-container';
  addThumbnailMenuButton(thumbnailContainer, model.filePath);

  // Parse thumbnails to check if multiple exist
  const parseThumbnails = (thumbnailString) => {
    if (!thumbnailString || thumbnailString === '3d.png' || !thumbnailString.includes('::')) {
      return [thumbnailString].filter(t => t && t !== '3d.png' && t.length > 0);
    }
    // Split and filter out invalid entries - only keep valid data URLs
    return thumbnailString.split('::').filter(t => {
      return t && typeof t === 'string' && t.length > 0 && t !== '3d.png' && t.startsWith('data:image');
    });
  };

  // Parse thumbnails from model.thumbnail if available
  // The model.thumbnail should contain all thumbnails separated by ::
  // List queries omit the blob but may set hasMultipleThumbnails from SQL.
  const thumbnailString = model.thumbnail;
  let hasThumbnailFlag = !!model.hasThumbnail;
  
  const allThumbnails = thumbnailString ? parseThumbnails(thumbnailString) : [];
  let hasMultipleThumbnails = allThumbnails.length > 1 || !!model.hasMultipleThumbnails;
  const currentThumbnailIndex = 0; // Start with first thumbnail (default)
  let currentThumbnail = allThumbnails.length > 0 ? allThumbnails[currentThumbnailIndex] : null;

  // Stuck Docker failure art (corrupted / typed STL) must not block regeneration.
  if (currentThumbnail && isFailurePlaceholderThumbnail(currentThumbnail)) {
    currentThumbnail = null;
    hasThumbnailFlag = false;
    hasMultipleThumbnails = false;
  }
  
  // Add image element right away to reserve space
  const img = document.createElement('img');
  if (view === 'preview') {
    img.style.width = '100%';
    img.style.height = '100%';
  } else {
    img.style.width = thumbSize.width;
    img.style.height = thumbSize.height;
  }
  img.src = currentThumbnail || '3d.png';
  thumbnailContainer.appendChild(img);

  if (isModelNew(model)) {
    const newStatusEl = document.createElement('div');
    newStatusEl.className = 'new-status';
    newStatusEl.textContent = 'New';
    newStatusEl.title = 'New model — clears once you edit it';
    thumbnailContainer.appendChild(newStatusEl);
  }

  // Visible-row thumbnail hydrate: primary only (getThumbnail). Virtual scroll already
  // limits createModelItem to on-screen (+buffer) rows — never fetch all thumbs for the grid
  // unless hasMultipleThumbnails (then upgrade to carousel in detailed/preview).
  if (model.filePath && !currentThumbnail && hasThumbnailFlag) {
    fetchPrimaryThumbnailForGrid(model.filePath).then(async (thumb) => {
      if (!img.isConnected) return;

      if (thumb) {
        img.src = thumb;
        model.thumbnail = thumb;
        model.hasThumbnail = true;
        if ((view === 'detailed' || view === 'preview') && hasMultipleThumbnails) {
          model.hasMultipleThumbnails = true;
          await maybeUpgradeGridItemToCarousel(thumbnailContainer, model, thumbSize, parseThumbnails);
        }
        return;
      }

      // Flagged as having a thumb but empty/clipped — queue a re-render (detailed/preview).
      if (view !== 'detailed' && view !== 'preview') return;
      if (pendingThumbnails.has(model.filePath)) return;
      pendingThumbnails.add(model.filePath);
      enqueueRenderTask({
        filePath: model.filePath,
        container: thumbnailContainer,
        thumbPriority,
        resolve: async (thumbnail) => {
          pendingThumbnails.delete(model.filePath);
          if (!thumbnail || thumbnail === '3d.png' || isFailurePlaceholderThumbnail(thumbnail)) return;
          if (await isMostlyEmptyThumbnailDataUrl(thumbnail)) return;
          // Late queue finish must not wipe a user-added / multi-image default.
          try {
            const existingModel = await window.electron.getModel(model.filePath);
            const existingRaw = existingModel?.thumbnail || '';
            const existingParts =
              typeof existingRaw === 'string' && existingRaw.includes('::')
                ? existingRaw.split('::').filter(
                    (t) =>
                      t &&
                      t !== '3d.png' &&
                      t.startsWith('data:image') &&
                      !isFailurePlaceholderThumbnail(t)
                  )
                : existingRaw &&
                    existingRaw !== '3d.png' &&
                    existingRaw.startsWith('data:image') &&
                    !isFailurePlaceholderThumbnail(existingRaw)
                  ? [existingRaw]
                  : [];
            if (existingParts.length > 0) {
              model.thumbnail = existingRaw;
              model.hasThumbnail = true;
              model.hasMultipleThumbnails = existingParts.length > 1;
              syncPrimaryThumbnailCacheFromThumbnailString(model.filePath, existingRaw);
              if (img.isConnected) img.src = existingParts[0];
              if (existingParts.length > 1) {
                await maybeUpgradeGridItemToCarousel(thumbnailContainer, model, thumbSize, parseThumbnails);
              }
              return;
            }
          } catch (_) { /* fall through to save */ }
          model.thumbnail = thumbnail;
          model.hasThumbnail = true;
          invalidatePrimaryThumbnailCache(model.filePath);
          setCachedPrimaryThumbnail(model.filePath, thumbnail);
          try {
            await window.electron.saveThumbnail(model.filePath, thumbnail);
          } catch (e) { /* ignore */ }
          if (img.isConnected) img.src = thumbnail;
          invalidateGroupThumbnailCache();
          if (window._groupThumbRefreshTimer) clearTimeout(window._groupThumbRefreshTimer);
          window._groupThumbRefreshTimer = setTimeout(() => {
            window._groupThumbRefreshTimer = null;
            const grid = document.querySelector('.file-grid');
            if (grid?.renderVisibleItemsFn) grid.renderVisibleItemsFn();
          }, 250);
        },
        reject: (error) => {
          // Benign prune/soft-cap: dropRenderTask already managed pending (and must not
          // clear it while the same path is mid-render).
          if (isBenignThumbnailDropError(error)) return;
          pendingThumbnails.delete(model.filePath);
          console.error(`Failed to generate thumbnail for ${model.filePath}`, error);
        }
      });
      if (typeof processRenderQueue === 'function') processRenderQueue();
    }).catch(() => { /* not critical */ });
  } else if (
    model.filePath &&
    currentThumbnail &&
    hasMultipleThumbnails &&
    allThumbnails.length < 2 &&
    (view === 'detailed' || view === 'preview')
  ) {
    // List row had only the primary blob (or a single cached thumb) but SQL says multi —
    // upgrade to carousel without waiting for a full re-fetch of the model.
    model.hasMultipleThumbnails = true;
    maybeUpgradeGridItemToCarousel(thumbnailContainer, model, thumbSize, parseThumbnails);
  }

  // In detailed or preview view with multiple thumbnails, wrap in navigation container
  let thumbnailWrapper = thumbnailContainer;
  if ((view === 'detailed' || view === 'preview') && allThumbnails.length > 1) {
    thumbnailWrapper = document.createElement('div');
    thumbnailWrapper.className = 'thumbnail-wrapper';
    thumbnailWrapper.style.position = 'relative';
    thumbnailWrapper.style.width = thumbSize.width;
    thumbnailWrapper.style.height = thumbSize.height;
    
    // Store thumbnails and current index on the wrapper
    thumbnailWrapper.dataset.thumbnails = JSON.stringify(allThumbnails);
    thumbnailWrapper.dataset.currentIndex = currentThumbnailIndex;
    thumbnailWrapper.dataset.filePath = model.filePath;
    
    // Left navigation area
    const leftNav = document.createElement('div');
    leftNav.className = 'thumbnail-nav-left';
    leftNav.style.position = 'absolute';
    leftNav.style.left = '0';
    leftNav.style.top = '0';
    leftNav.style.width = '50%';
    leftNav.style.height = '100%';
    leftNav.style.cursor = 'pointer';
    leftNav.style.zIndex = '10';
    leftNav.title = 'Previous image';
    
    // Right navigation area
    const rightNav = document.createElement('div');
    rightNav.className = 'thumbnail-nav-right';
    rightNav.style.position = 'absolute';
    rightNav.style.right = '0';
    rightNav.style.top = '0';
    rightNav.style.width = '50%';
    rightNav.style.height = '100%';
    rightNav.style.cursor = 'pointer';
    rightNav.style.zIndex = '10';
    rightNav.title = 'Next image';
    
    // Navigation click handlers
    const navigateThumbnail = async (direction) => {
      const wrapper = thumbnailWrapper;
      const thumbnails = JSON.parse(wrapper.dataset.thumbnails);
      // Read current index from dataset - this should persist between clicks
      let currentIndex = parseInt(wrapper.dataset.currentIndex);
      if (isNaN(currentIndex)) {
        currentIndex = 0;
        wrapper.dataset.currentIndex = '0';
      }
      
      // Filter out any invalid thumbnails
      const validThumbnails = thumbnails.filter(t => t && typeof t === 'string' && t.length > 0 && t !== '3d.png');
      if (validThumbnails.length !== thumbnails.length) {
        wrapper.dataset.thumbnails = JSON.stringify(validThumbnails);
        // Update badge
        if (wrapper._updateBadge) {
          wrapper._updateBadge();
        } else {
          const badge = wrapper.querySelector('.thumbnail-count-badge');
          if (badge) {
            const currentIdx = parseInt(wrapper.dataset.currentIndex) || 0;
            badge.textContent = `${currentIdx + 1}/${validThumbnails.length}`;
            badge.title = `Image ${currentIdx + 1} of ${validThumbnails.length} - Click left/right to navigate`;
          }
        }
      }
      
      if (validThumbnails.length === 0) {
        return;
      }
      
      // Adjust currentIndex if it's out of bounds
      if (currentIndex >= validThumbnails.length) {
        currentIndex = 0;
      }
      
      // Calculate new index
      if (direction === 'prev') {
        currentIndex = (currentIndex - 1 + validThumbnails.length) % validThumbnails.length;
      } else {
        currentIndex = (currentIndex + 1) % validThumbnails.length;
      }
      
      // IMPORTANT: Update the dataset BEFORE doing anything else so it persists
      wrapper.dataset.currentIndex = currentIndex.toString();
      
      // Update badge to show current position
      if (wrapper._updateBadge) {
        wrapper._updateBadge();
      } else {
        const badge = wrapper.querySelector('.thumbnail-count-badge');
        if (badge) {
          badge.textContent = `${currentIndex + 1}/${validThumbnails.length}`;
          badge.title = `Image ${currentIndex + 1} of ${validThumbnails.length} - Click left/right to navigate`;
        }
      }
      
      const img = wrapper.querySelector('.thumbnail-container img');
      if (img) {
        const newSrc = validThumbnails[currentIndex];
        img.src = newSrc;
        
        // Debounced save - save the current thumbnail as default after user stops navigating
        // This ensures the last viewed image becomes the default for preview/list views
        // Clear any existing timeout
        if (wrapper._saveTimeout) {
          clearTimeout(wrapper._saveTimeout);
        }
        
        // Save after 2 seconds of no navigation
        wrapper._saveTimeout = setTimeout(async () => {
          try {
            const idxToSave = parseInt(wrapper.dataset.currentIndex) || 0;
            const thumbs = JSON.parse(wrapper.dataset.thumbnails);
            if (thumbs && thumbs.length > idxToSave && idxToSave >= 0) {
              await window.electron.setDefaultThumbnail(model.filePath, idxToSave);
              // Update the model in memory with the reordered thumbnails
              const updatedModel = await window.electron.getModel(model.filePath);
              if (updatedModel && updatedModel.thumbnail) {
                model.thumbnail = updatedModel.thumbnail;
                // Update the dataset with the new order (selected one moved to front)
                const reorderedThumbs = parseThumbnails(updatedModel.thumbnail);
                syncPrimaryThumbnailCacheFromThumbnailString(model.filePath, updatedModel.thumbnail);
                wrapper.dataset.thumbnails = JSON.stringify(reorderedThumbs);
                wrapper.dataset.currentIndex = '0'; // Reset to 0 since selected is now at front
                // Update badge after reordering
                if (wrapper._updateBadge) {
                  wrapper._updateBadge();
                } else {
                  const badge = wrapper.querySelector('.thumbnail-count-badge');
                  if (badge) {
                    badge.textContent = `1/${reorderedThumbs.length}`;
                    badge.title = `Image 1 of ${reorderedThumbs.length} - Click left/right to navigate`;
                  }
                }
              }
            }
          } catch (e) {
            console.error('Error saving default thumbnail:', e);
          }
        }, 2000); // 2 second delay
      }
    };
    
    leftNav.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateThumbnail('prev');
    });
    
    rightNav.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateThumbnail('next');
    });
    
    thumbnailWrapper.appendChild(leftNav);
    thumbnailWrapper.appendChild(rightNav);
    
    // Add indicator badge showing number of images
    const badge = document.createElement('div');
    badge.className = 'thumbnail-count-badge';
    // Helper function to update badge text
    const updateBadgeText = () => {
      const currentIdx = parseInt(thumbnailWrapper.dataset.currentIndex) || 0;
      // Get current thumbnails from dataset (may have been filtered)
      const currentThumbs = JSON.parse(thumbnailWrapper.dataset.thumbnails || JSON.stringify(allThumbnails));
      const total = currentThumbs.length;
      badge.textContent = `${currentIdx + 1}/${total}`;
      badge.title = `Image ${currentIdx + 1} of ${total} - Click left/right to navigate`;
    };
    updateBadgeText();
    badge.style.position = 'absolute';
    badge.style.bottom = '8px';
    badge.style.right = '8px';
    badge.style.background = 'rgba(0, 0, 0, 0.7)';
    badge.style.color = '#fff';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '12px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = 'bold';
    badge.style.zIndex = '11';
    badge.style.pointerEvents = 'none';
    // Store update function on wrapper for later use
    thumbnailWrapper._updateBadge = updateBadgeText;
    thumbnailWrapper.appendChild(badge);
    
  }

  // Only queue if it doesn't have a thumbnail string AND the flag is false
  if (!currentThumbnail && !hasThumbnailFlag) {
    // During Docker bulk Generate Missing / Regenerate, skip grid WebGL queues —
    // scrolling must not compete with the hidden-window job (OOM).
    if (window._serverBulkThumbnailJobActive) {
      // keep placeholder; job will fill thumbs server-side
    } else if (!pendingThumbnails.has(model.filePath)) {
      pendingThumbnails.add(model.filePath);

      enqueueRenderTask({
        filePath: model.filePath,
        container: thumbnailContainer,
        thumbPriority,
        resolve: async (thumbnail) => {
          // Remove from pending set first
          pendingThumbnails.delete(model.filePath);

          // Never persist failure placeholders — leave retryable (hasThumbnail=0 via 3d.png).
          if (!thumbnail || thumbnail === '3d.png' || isFailurePlaceholderThumbnail(thumbnail)) {
            if (thumbnail && isFailurePlaceholderThumbnail(thumbnail)) {
              // Show failure in this cell only; do not write to DB.
              const imgEl = thumbnailContainer.querySelector('img');
              if (imgEl) imgEl.src = thumbnail;
            }
            // Cell may have been recycled mid-render — re-queue any still-visible placeholder.
            scheduleVisibleThumbnailHydrate();
            return;
          }
          if (await isMostlyEmptyThumbnailDataUrl(thumbnail)) {
            scheduleVisibleThumbnailHydrate();
            return;
          }
          
          // Check if model already has real thumbnail(s) (3MF embeds, user-added HueForge, etc.).
          // Prefer getModel over getAllThumbnails so the grid path never loads every blob list.
          // Never clobber a single user-added image either — only write when there is no real thumb yet.
          const modelData = await window.electron.getModel(model.filePath);
          const existingRaw = modelData?.thumbnail || '';
          const existingMulti = typeof existingRaw === 'string' && existingRaw.includes('::')
            ? existingRaw.split('::').filter((t) => t && t !== '3d.png' && t.startsWith('data:image') && !isFailurePlaceholderThumbnail(t))
            : [];
          const existingSingle =
            existingMulti.length === 0 &&
            existingRaw &&
            existingRaw !== '3d.png' &&
            typeof existingRaw === 'string' &&
            existingRaw.startsWith('data:image') &&
            !isFailurePlaceholderThumbnail(existingRaw)
              ? existingRaw
              : null;
          if (existingMulti.length > 0) {
            model.thumbnail = existingRaw;
            model.hasThumbnail = true;
            model.hasMultipleThumbnails = existingMulti.length > 1;
            syncPrimaryThumbnailCacheFromThumbnailString(model.filePath, existingRaw);
          } else if (existingSingle) {
            model.thumbnail = existingSingle;
            model.hasThumbnail = true;
            model.hasMultipleThumbnails = false;
            syncPrimaryThumbnailCacheFromThumbnailString(model.filePath, existingSingle);
          } else {
            model.thumbnail = thumbnail;
            model.hasThumbnail = true;
            invalidatePrimaryThumbnailCache(model.filePath);
            setCachedPrimaryThumbnail(model.filePath, thumbnail);
            await window.electron.saveThumbnail(model.filePath, thumbnail);
          }

          // Try to update any visible instances of this file in the DOM
          try {
            // Find the file item by iterating through all file items
            // This avoids CSS escaping issues with special characters in file paths
            const allFileItems = document.querySelectorAll('.file-item');
            let fileItem = null;
            const normalizedModelPath = normalizePathForComparison(model.filePath);
            for (const item of allFileItems) {
              const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedModelPath) {
                fileItem = item;
                break;
              }
            }
            
            if (fileItem) {
              // Force a refresh of the entire item to ensure all styling and event listeners are reapplied
              const itemIndex = parseInt(fileItem.dataset.index || '-1');
              const itemParent = fileItem.parentNode;
              
              if (itemParent && itemIndex >= 0) {
                // Get the item's current position
                const itemPosition = {
                  top: fileItem.style.top,
                  left: fileItem.style.left,
                  width: fileItem.style.width
                };
                
                // Preserve virtual-grid and grouped-highlight state before replacing the node.
                const preservedLayoutKey = fileItem.dataset.layoutKey || '';
                const preservedParentGroupKey = fileItem.dataset.parentGroupKey || '';
                const preserveGroupedClasses = [
                  'parent-model-group-child',
                  'parent-model-group-child-start',
                  'parent-model-group-child-middle',
                  'parent-model-group-child-end',
                  'parent-model-group-child-single'
                ];
                const groupedClassesToRestore = preserveGroupedClasses.filter(cls => fileItem.classList.contains(cls));

                // Remove the old item
                fileItem.remove();
                
                // Create a new item with the updated thumbnail
                const newItem = createModelItem(model, currentGridView);
                newItem.dataset.index = itemIndex;
                if (preservedLayoutKey) newItem.dataset.layoutKey = preservedLayoutKey;
                if (preservedParentGroupKey) newItem.dataset.parentGroupKey = preservedParentGroupKey;
                groupedClassesToRestore.forEach(cls => newItem.classList.add(cls));
                newItem.style.position = 'absolute';
                newItem.style.top = itemPosition.top;
                newItem.style.left = itemPosition.left;
                newItem.style.width = itemPosition.width;
                if (fileItem.style.height) newItem.style.height = fileItem.style.height;
                if (fileItem.style.minHeight) newItem.style.minHeight = fileItem.style.minHeight;
                if (fileItem.style.maxHeight) newItem.style.maxHeight = fileItem.style.maxHeight;
                newItem.style.pointerEvents = 'auto';
                
                // Add the new item to the DOM
                itemParent.appendChild(newItem);
              }
            }
          } catch (e) {
            console.error('Error refreshing item after thumbnail generation:', e);
          }
        },
        reject: (error) => {
          // Benign prune/soft-cap: dropRenderTask already managed pending (and must not
          // clear it while the same path is mid-render).
          if (isBenignThumbnailDropError(error)) return;
          pendingThumbnails.delete(model.filePath);
          console.error(`Failed to generate thumbnail for ${model.filePath}`, error);
        }
      });

      // Trigger queue processing
      processRenderQueue();
    } else {
      // Already pending — point the queued job at this cell (DOM may have been recycled).
      const queued = findQueuedThumbnailTask(model.filePath);
      if (queued) {
        queued.container = thumbnailContainer;
        queued.thumbPriority = thumbPriority;
      }
    }
  }

  // Append wrapper if it exists (detailed view with multiple thumbnails), otherwise append container directly
  if (thumbnailWrapper !== thumbnailContainer) {
    thumbnailWrapper.appendChild(thumbnailContainer);
    item.appendChild(thumbnailWrapper);
  } else {
    item.appendChild(thumbnailContainer);
  }

  // Parent directory label — full path including drive (not just leaf folder name)
  const parentDir = getDirectoryDisplayLabel(model.filePath);
  const parentDirFullPath = getParentDirectoryFullPath(model.filePath);

  // File info container - layout depends on view mode
  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  // File name element
  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  // Extract file name from path if fileName is not available
  // Handle zip entries (format: "zipPath::entryPath")
  let displayFileName = model.fileName;
  if (!displayFileName && model.filePath) {
    if (model.filePath.includes('::')) {
      // Zip entry: extract filename from entry path
      const entryPath = model.filePath.split('::')[1];
      displayFileName = entryPath.split(/[/\\]/).pop() || 'Unknown';
    } else {
      // Regular file: extract filename from path
      displayFileName = model.filePath.split(/[/\\]/).pop() || 'Unknown';
    }
  }
  if (!displayFileName) {
    displayFileName = 'Unknown';
  }
  fileName.textContent = displayFileName;
  
  // Check if model is a zip file (actual .zip file, not a file inside a zip)
  // Only check if it's NOT a zip entry (zip entries have :: in filePath)
  // Note: isZipEntry is already declared earlier in the function (line 7805)
  const isZipFile = !isZipEntry && (
    (model.filePath && model.filePath.toLowerCase().endsWith('.zip')) || 
    (displayFileName && displayFileName.toLowerCase().endsWith('.zip'))
  );
  
  // In detailed view, add file name directly after thumbnail, not in fileInfo
  // List: name in fileInfo. Preview wall: name only in hover overlay (not in fileInfo).
  if (view === 'detailed') {
    // File name will be added after thumbnail in detailed view section
  } else if (view !== 'preview') {
    fileInfo.appendChild(fileName);
  }

  // File details container (directory, size, designer) - only show in detailed and list views
  const fileDetails = document.createElement('div');
  fileDetails.className = 'file-details';
  
  // In list view, show Windows File Explorer style - thin horizontal row with details
  if (view === 'list') {
    // Get status indicators that were already added to item - we'll move them to columns later
    // Note: These are added to item early in the function (lines 7099-7111), so they should be findable here
    const printStatusElement = item.querySelector('.print-status');
    const archiveStatusElement = item.querySelector('.archive-status');
    
    // List view: horizontal layout with tiny thumbnail on left, details on right
    item.style.display = 'flex';
    item.style.flexDirection = 'row';
    item.style.alignItems = 'center';
    item.style.gap = '12px';
    item.style.padding = '6px 12px';
    item.style.height = '52px';
    item.style.position = 'relative';
    thumbnailContainer.style.flexShrink = '0';
    thumbnailContainer.style.width = '48px';
    thumbnailContainer.style.height = '48px';
    thumbnailContainer.style.position = 'relative';
    fileInfo.style.flex = '1';
    fileInfo.style.display = 'flex';
    fileInfo.style.flexDirection = 'row';
    fileInfo.style.alignItems = 'center';
    fileInfo.style.gap = '12px';
    fileInfo.style.minWidth = '0';
    
    // File name column (width from list view column preferences)
    fileName.setAttribute('data-list-col', 'name');
    fileName.style.flexShrink = '0';
    fileName.style.overflow = 'hidden';
    fileName.style.textOverflow = 'ellipsis';
    fileName.style.whiteSpace = 'nowrap';
    fileName.style.fontSize = '13px';
    // Add tooltip for truncated file names
    if (displayFileName) {
      fileName.setAttribute('title', displayFileName);
    }
    // Apply zip file styling (isZipFile was already calculated above)
    if (isZipFile) {
      fileName.classList.add('zip-file');
      fileName.style.setProperty('color', '#4ade80', 'important'); // Green for zip files
    } else {
      fileName.style.setProperty('color', '#fff', 'important'); // White for non-zip files
    }
    
    // File size column (center-aligned; width from preferences)
    const sizeColumn = document.createElement('div');
    sizeColumn.className = 'file-size-column';
    sizeColumn.setAttribute('data-list-col', 'size');
    sizeColumn.style.display = 'flex';
    sizeColumn.style.alignItems = 'center';
    sizeColumn.style.flexShrink = '0';
    sizeColumn.style.justifyContent = 'center';
    if (model.size) {
      const sizeText = document.createElement('span');
      sizeText.textContent = formatFileSize(model.size);
      sizeText.style.fontSize = '12px';
      sizeText.style.color = '#aaa';
      sizeText.style.fontFamily = 'monospace';
      sizeColumn.appendChild(sizeText);
    }
    fileInfo.appendChild(sizeColumn);
    
    // Date Added column (center-aligned; width from preferences)
    const dateAddedColumn = document.createElement('div');
    dateAddedColumn.className = 'date-added-column';
    dateAddedColumn.setAttribute('data-list-col', 'dateadded');
    dateAddedColumn.style.display = 'flex';
    dateAddedColumn.style.alignItems = 'center';
    dateAddedColumn.style.flexShrink = '0';
    dateAddedColumn.style.justifyContent = 'center';
    if (model.dateAdded) {
      const dateText = document.createElement('span');
      const date = new Date(model.dateAdded);
      // Format date as MM/DD/YYYY or use locale string
      const formattedDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      dateText.textContent = formattedDate;
      dateText.style.fontSize = '12px';
      dateText.style.color = '#aaa';
      dateText.style.fontFamily = 'monospace';
      // Add tooltip with full date/time if available
      if (model.dateAdded) {
        const fullDate = new Date(model.dateAdded);
        dateText.setAttribute('title', fullDate.toLocaleString());
      }
      dateAddedColumn.appendChild(dateText);
    } else {
      const emptyText = document.createElement('span');
      emptyText.textContent = '—';
      emptyText.style.fontSize = '12px';
      emptyText.style.color = '#666';
      dateAddedColumn.appendChild(emptyText);
    }
    fileInfo.appendChild(dateAddedColumn);
    
    // Parent directory column (clickable to filter, with icon)
    const directoryColumn = document.createElement('div');
    directoryColumn.className = 'directory-info-column';
    directoryColumn.setAttribute('data-list-col', 'directory');
    directoryColumn.style.display = 'flex';
    directoryColumn.style.alignItems = 'center';
    directoryColumn.style.flexShrink = '0';
    directoryColumn.style.overflow = 'hidden';
    
    // Add folder icon or archive icon based on whether model is in zip archive
    const parentIcon = isZipEntry 
      ? createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#22c55e"><path d="M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"/></svg>', 16)
      : createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#e3e3e3"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>', 16);
    directoryColumn.appendChild(parentIcon);
    
    const directoryText = document.createElement('span');
    directoryText.className = 'directory-info';
    directoryText.textContent = parentDir || '';
    directoryText.style.fontSize = '12px';
    directoryText.style.color = parentDir ? '#4a9eff' : '#888';
    directoryText.style.overflow = 'hidden';
    directoryText.style.textOverflow = 'ellipsis';
    directoryText.style.whiteSpace = 'nowrap';
    directoryText.style.cursor = parentDir ? 'pointer' : 'default';
    directoryText.style.fontWeight = parentDir ? '500' : '400';
    directoryText.style.flex = '1';
    directoryText.style.minWidth = '0';
    // Add tooltip for truncated directory names (full path, including drive)
    if (parentDir) {
      directoryText.setAttribute('title', parentDirFullPath || parentDir);
    }
    
    // Add click handler to filter by directory
    if (parentDir) {
      directoryColumn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Extract the full path up to the parent directory for filtering
        let directoryFilterPath;
        if (model.filePath && model.filePath.includes('::')) {
          // For zip entries, use the zip path up to the parent directory
          const [zipPath, entryPath] = model.filePath.split('::');
          const entryParentPath = entryPath.split(/[/\\]/).slice(0, -1).join('/');
          directoryFilterPath = entryParentPath ? `${zipPath}::${entryParentPath}` : zipPath;
        } else {
          // For regular files, get the full path up to the parent directory
          // Make sure we're getting the directory, not the file itself
          const lastSlash = Math.max(model.filePath.lastIndexOf('\\'), model.filePath.lastIndexOf('/'));
          if (lastSlash > 0) {
            directoryFilterPath = model.filePath.substring(0, lastSlash);
            // Ensure we have a valid directory path (not a file path)
            if (!directoryFilterPath || directoryFilterPath.endsWith('.zip') || directoryFilterPath.endsWith('.stl') || directoryFilterPath.endsWith('.3mf')) {
              // If somehow we got a file path, extract the parent directory again
              const parentSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
              directoryFilterPath = parentSlash > 0 ? directoryFilterPath.substring(0, parentSlash) : '';
            }
          } else {
            directoryFilterPath = '';
          }
        }
        
        // Validate that we have a directory path, not a file path
        // Check for common file extensions (case-insensitive)
        const lowerPath = directoryFilterPath.toLowerCase();
        if (directoryFilterPath && (lowerPath.endsWith('.zip') || lowerPath.endsWith('.stl') || lowerPath.endsWith('.3mf') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.ply'))) {
          console.warn('Directory filter appears to be a file path, extracting parent directory:', directoryFilterPath);
          const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
          directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
        }
        
        // Final validation: ensure we don't have a file path
        if (directoryFilterPath && directoryFilterPath === model.filePath) {
          console.error('Directory filter is same as file path, this should not happen. File path:', model.filePath);
          const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
          directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
        }
        
        console.log('Setting directory filter to:', directoryFilterPath, 'from file path:', model.filePath);
        
        // Set the global directory filter with the full path
        window.currentDirectoryFilter = directoryFilterPath;
        if (window.viewingEntireLibrary) {
          window.viewingEntireLibrary = false;
        }
        if (typeof window.applyViewForCurrentFolder === 'function') {
          await window.applyViewForCurrentFolder();
        }
        // Trigger combined search to apply filter
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
      });
      directoryColumn.style.cursor = 'pointer';
      // Add hover effect
      directoryColumn.addEventListener('mouseenter', () => {
        directoryText.style.textDecoration = 'underline';
        directoryText.style.color = '#6bb3ff';
      });
      directoryColumn.addEventListener('mouseleave', () => {
        directoryText.style.textDecoration = 'none';
        directoryText.style.color = '#4a9eff';
      });
    }
    directoryColumn.appendChild(directoryText);
    fileInfo.appendChild(directoryColumn);
    
    // Designer column (with icon)
    const designerColumn = document.createElement('div');
    designerColumn.className = 'designer-info-column';
    designerColumn.setAttribute('data-list-col', 'designer');
    designerColumn.style.display = 'flex';
    designerColumn.style.alignItems = 'center';
    designerColumn.style.flexShrink = '0';
    designerColumn.style.overflow = 'hidden';
    
    // Add designer icon
    const designerIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#a855f7"><path d="m352-522 86-87-56-57-44 44-56-56 43-44-45-45-87 87 159 158Zm328 329 87-87-45-45-44 43-56-56 43-44-57-56-86 86 158 159Zm24-567 57 57-57-57ZM290-120H120v-170l175-175L80-680l200-200 216 216 151-152q12-12 27-18t31-6q16 0 31 6t27 18l53 54q12 12 18 27t6 31q0 16-6 30.5T816-647L665-495l215 215L680-80 465-295 290-120Zm-90-80h56l392-391-57-57-391 392v56Zm420-419-29-29 57 57-28-28Z"/></svg>', 16);
    designerColumn.appendChild(designerIcon);
    
    const designerText = document.createElement('span');
    designerText.className = 'designer-info';
    designerText.textContent = model.designer || '';
    designerText.style.fontSize = '12px';
    designerText.style.color = model.designer ? '#aaa' : '#666';
    designerText.style.overflow = 'hidden';
    designerText.style.textOverflow = 'ellipsis';
    designerText.style.whiteSpace = 'nowrap';
    designerText.style.flex = '1';
    designerText.style.minWidth = '0';
    // Add tooltip for truncated designer names
    if (model.designer) {
      designerText.setAttribute('title', model.designer);
    }
    designerColumn.appendChild(designerText);
    fileInfo.appendChild(designerColumn);
    
    // Parent Model column
    const parentModelColumn = document.createElement('div');
    parentModelColumn.className = 'parent-model-column';
    parentModelColumn.setAttribute('data-list-col', 'parentmodel');
    parentModelColumn.style.display = 'flex';
    parentModelColumn.style.alignItems = 'center';
    parentModelColumn.style.flexShrink = '0';
    parentModelColumn.style.overflow = 'hidden';
    
    const parentModelText = document.createElement('span');
    parentModelText.className = 'parent-model-info';
    parentModelText.textContent = model.parentModel || '';
    parentModelText.style.fontSize = '12px';
    parentModelText.style.color = model.parentModel ? '#aaa' : '#666';
    parentModelText.style.overflow = 'hidden';
    parentModelText.style.textOverflow = 'ellipsis';
    parentModelText.style.whiteSpace = 'nowrap';
    // Add tooltip for truncated parent model names
    if (model.parentModel) {
      parentModelText.setAttribute('title', model.parentModel);
    }
    parentModelColumn.appendChild(parentModelText);
    fileInfo.appendChild(parentModelColumn);
    
    // Printed column (status badge only, no icon)
    const printStatusColumn = document.createElement('div');
    printStatusColumn.className = 'print-status-column';
    printStatusColumn.setAttribute('data-list-col', 'printed');
    printStatusColumn.style.display = 'flex';
    printStatusColumn.style.alignItems = 'center';
    printStatusColumn.style.justifyContent = 'center';
    printStatusColumn.style.flexShrink = '0';
    
    if (printStatusElement) {
      // Remove all positioning styles and move to column
      printStatusElement.style.position = 'static';
      printStatusElement.style.top = 'auto';
      printStatusElement.style.right = 'auto';
      printStatusElement.style.left = 'auto';
      printStatusElement.style.fontSize = '11px';
      printStatusElement.style.padding = '2px 6px';
      printStatusElement.style.borderRadius = '3px';
      printStatusElement.style.display = 'inline-block';
      printStatusElement.style.zIndex = 'auto';
      printStatusElement.style.margin = '0';
      // Move the print status from item to the column (appendChild automatically removes from old parent)
      printStatusColumn.appendChild(printStatusElement);
    }
    fileInfo.appendChild(printStatusColumn);
    
    // Tags column
    const tagsColumn = document.createElement('div');
    tagsColumn.className = 'tags-info-column';
    tagsColumn.setAttribute('data-list-col', 'tags');
    tagsColumn.style.display = 'flex';
    tagsColumn.style.alignItems = 'center';
    tagsColumn.style.overflow = 'hidden';
    
    // Get tags from model
    let tagsDisplay = '';
    let tagNamesList = [];
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      tagNamesList = model.tags.map(t => (typeof t === 'string' ? t : (t.name || t))).filter(Boolean);
      tagNamesList.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      tagsDisplay = tagNamesList.join(', ');
    } else if (model.id) {
      // Load tags asynchronously if not present
      window.electron.getModelTags(model.id).then(tags => {
        const tagsSpan = tagsColumn.querySelector('.tags-info');
        if (!tagsSpan) return;
        if (tags && tags.length > 0) {
          const tagNames = tags.map(t => (typeof t === 'string' ? t : (t.name || t))).filter(Boolean);
          tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
          const tagsText = tagNames.join(', ');
          fillTagsWithFilterLinks(tagsSpan, tagNames);
          tagsSpan.setAttribute('title', tagsText); // Show full tag list on hover
          tagsSpan.style.color = '#aaa';
        } else {
          tagsSpan.textContent = '—';
          tagsSpan.style.color = '#666';
          tagsSpan.removeAttribute('title');
        }
      }).catch(err => console.error('Error loading tags:', err));
    }
    
    const tagsSpan = document.createElement('span');
    tagsSpan.className = 'tags-info';
    if (tagsDisplay) {
      fillTagsWithFilterLinks(tagsSpan, tagNamesList);
      tagsSpan.setAttribute('title', tagsDisplay); // Show full tag list on hover
    } else {
      tagsSpan.textContent = '—';
    }
    tagsSpan.style.fontSize = '12px';
    tagsSpan.style.color = tagsDisplay ? '#aaa' : '#666';
    tagsSpan.style.overflow = 'hidden';
    tagsSpan.style.textOverflow = 'ellipsis';
    tagsSpan.style.whiteSpace = 'nowrap';
    tagsColumn.appendChild(tagsSpan);
    fileInfo.appendChild(tagsColumn);
    
    // Archive column (with icon, only show for files in zip/archive)
    const archiveStatusColumn = document.createElement('div');
    archiveStatusColumn.className = 'archive-status-column';
    archiveStatusColumn.setAttribute('data-list-col', 'archive');
    archiveStatusColumn.style.display = 'flex';
    archiveStatusColumn.style.alignItems = 'center';
    archiveStatusColumn.style.justifyContent = 'center';
    archiveStatusColumn.style.gap = '6px';
    archiveStatusColumn.style.flexShrink = '0';
    
    // Only show archive icon and status for files in zip/archive
    if (isZipEntry) {
      // Add archive icon
      const archiveIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#e3e3e3"><path d="M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"/></svg>', 16);
      archiveStatusColumn.appendChild(archiveIcon);
      
      if (archiveStatusElement) {
        // Remove all positioning styles and move to column
        archiveStatusElement.style.position = 'static';
        archiveStatusElement.style.top = 'auto';
        archiveStatusElement.style.right = 'auto';
        archiveStatusElement.style.left = 'auto';
        archiveStatusElement.style.fontSize = '11px';
        archiveStatusElement.style.padding = '2px 6px';
        archiveStatusElement.style.borderRadius = '3px';
        archiveStatusElement.style.display = 'inline-block';
        archiveStatusElement.style.zIndex = 'auto';
        archiveStatusElement.style.margin = '0';
        // Move the archive status from item to the column (appendChild automatically removes from old parent)
        archiveStatusColumn.appendChild(archiveStatusElement);
      } else {
        // Create archive status if it doesn't exist (shouldn't happen, but just in case)
        const archiveStatusText = document.createElement('span');
        archiveStatusText.textContent = 'Archive';
        archiveStatusText.style.fontSize = '11px';
        archiveStatusText.style.color = '#fff';
        archiveStatusText.style.padding = '2px 6px';
        archiveStatusText.style.borderRadius = '3px';
        archiveStatusText.style.background = 'rgba(255, 152, 0, 0.9)';
        archiveStatusColumn.appendChild(archiveStatusText);
      }
    }
    fileInfo.appendChild(archiveStatusColumn);
    
    applyListViewColumnLayoutToSubtree(fileInfo);
    item.appendChild(fileInfo);
    
    // Add click event handler for model selection
    item.addEventListener('click', (e) => {
      // Check if ctrl or cmd key is pressed for multi-select
      if (e.ctrlKey || e.metaKey) {
        handleFileClick(e, model.filePath);
      } else {
        toggleModelSelection(item, model.filePath);
      }
    });
    
    // Add context menu handler for list view - works on entire element
    addContextMenuHandler(item, model.filePath);
    
    return item;
  }
  
  // Preview view: dense square wall (see preview-wall.css)
  if (view === 'preview') {
    const tilePx = getPreviewTileSizePx();
    item.classList.add('preview-tile');
    item.style.width = `${tilePx}px`;
    item.style.height = `${tilePx}px`;
    item.style.minHeight = `${tilePx}px`;
    item.style.maxHeight = `${tilePx}px`;
    item.style.padding = '0';
    item.style.boxSizing = 'border-box';
    item.style.position = 'relative';
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    item.style.overflow = 'hidden';

    thumbnailContainer.style.width = '100%';
    thumbnailContainer.style.height = '100%';
    thumbnailContainer.style.flex = '1';
    thumbnailContainer.style.minHeight = '0';
    thumbnailContainer.style.marginBottom = '0';

    if (thumbnailWrapper !== thumbnailContainer) {
      thumbnailWrapper.style.width = '100%';
      thumbnailWrapper.style.height = '100%';
    }

    const checkEl = document.createElement('div');
    checkEl.className = 'preview-tile-check';
    checkEl.setAttribute('aria-hidden', 'true');

    const overlay = document.createElement('div');
    overlay.className = 'preview-tile-overlay';
    const nameRow = document.createElement('div');
    nameRow.className = 'preview-tile-name';
    nameRow.textContent = displayFileName;
    if (isZipFile) {
      nameRow.classList.add('zip-file');
    }
    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'preview-tile-open-btn';
    openBtn.textContent = '3D Preview';
    openBtn.title = 'Open 3D preview';
    openBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.openPreview === 'function') {
        window.openPreview(model.filePath);
      }
    });
    overlay.appendChild(nameRow);
    overlay.appendChild(openBtn);

    item.appendChild(checkEl);
    item.appendChild(overlay);

    item.appendChild(printStatus);
    if (archiveStatus) {
      item.appendChild(archiveStatus);
    }

    item.addEventListener('dblclick', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (typeof window.openPreview === 'function') {
        window.openPreview(model.filePath);
      }
    });

    item.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        handleFileClick(e, model.filePath);
      } else {
        toggleModelSelection(item, model.filePath);
      }
    });

    addContextMenuHandler(item, model.filePath);

    return item;
  }
  
  // Create metadata items container
  const metadataContainer = document.createElement('div');
  metadataContainer.className = 'metadata-container';
  
  // Only add metadata in detailed view
  if (view === 'detailed') {
    item.style.width = '300px';
    item.style.height = '490px';
    item.style.minHeight = '490px';
    item.style.maxHeight = '490px';
    item.style.padding = '16px 16px 0';
    item.style.boxSizing = 'border-box';
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    
    // Slightly smaller thumbnail to give more room for metadata
    thumbnailContainer.style.width = '276px'; // Reduced from 276px (actually same, but adjusted for padding)
    thumbnailContainer.style.height = '276px'; // Reduced from 276px
    thumbnailContainer.style.flexShrink = '0';
    
    // Add file name directly after thumbnail (in the red square area)
    if (fileName && fileName.textContent) {
      fileName.style.display = 'block';
      fileName.style.fontSize = '13px';
      fileName.style.fontWeight = '500';
      fileName.style.color = '#fff';
      fileName.style.marginTop = '8px'; // Reduced from 10px
      fileName.style.marginBottom = '8px'; // Reduced from 10px
      fileName.style.padding = '5px 8px'; // Reduced from 6px
      fileName.style.textAlign = 'center';
      fileName.style.whiteSpace = 'nowrap';
      fileName.style.overflow = 'hidden';
      fileName.style.textOverflow = 'ellipsis';
      fileName.style.width = '100%';
      fileName.style.boxSizing = 'border-box';
      fileName.style.minHeight = '28px';
      fileName.style.lineHeight = '1.4';
      fileName.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
      fileName.style.borderRadius = '4px';
      fileName.style.flexShrink = '0';
      // Insert file name right after thumbnail container
      const nextSibling = thumbnailContainer.nextSibling;
      if (nextSibling) {
        item.insertBefore(fileName, nextSibling);
      } else {
        item.appendChild(fileName);
      }
    }
    
    // File info fills remaining space above the engagement bar
    fileInfo.style.minHeight = '0';
    fileInfo.style.flex = '1 1 auto';
    fileInfo.style.display = 'flex';
    fileInfo.style.flexDirection = 'column';
    fileInfo.style.justifyContent = 'flex-start';
    fileInfo.style.gap = '4px';
    fileInfo.style.overflow = 'visible';
    fileInfo.style.padding = '0';
    fileInfo.style.margin = '0';
    
    // Enable two-column grid layout for metadata
    metadataContainer.style.display = 'grid';
    metadataContainer.style.gridTemplateColumns = '1fr 1fr';
    metadataContainer.style.gap = '2px 8px';
    metadataContainer.style.padding = '0';
    
    // Add directory and size on the same row - directory on left, size on right
    if (parentDir || model.size) {
      const dirSizeRow = document.createElement('div');
      dirSizeRow.className = 'metadata-item dir-size-row';
      dirSizeRow.style.gridColumn = '1 / -1'; // Span both columns
      dirSizeRow.style.display = 'flex';
      dirSizeRow.style.justifyContent = 'space-between';
      dirSizeRow.style.alignItems = 'center';
      dirSizeRow.style.gap = '8px';
      
      // Directory on the left
      if (parentDir) {
        const directoryPart = document.createElement('div');
        directoryPart.className = 'directory-part';
        directoryPart.style.display = 'flex';
        directoryPart.style.alignItems = 'center';
        directoryPart.style.gap = '6px';
        directoryPart.style.cursor = 'pointer';
        const dirIcon = document.createElement('span');
        dirIcon.className = 'metadata-icon';
        dirIcon.textContent = '📁';
        const dirValue = document.createElement('span');
        dirValue.className = 'metadata-value directory-link';
        dirValue.textContent = parentDir;
        dirValue.title = parentDirFullPath || parentDir;
        directoryPart.appendChild(dirIcon);
        directoryPart.appendChild(dirValue);
        directoryPart.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Hide any welcome or view library message
          const viewLibMsg = document.getElementById("view-library-message");
          if (viewLibMsg) { viewLibMsg.style.display = "none"; }
          
          // Extract the full path up to the parent directory for filtering
          let directoryFilterPath;
          if (model.filePath && model.filePath.includes('::')) {
            // For zip entries, use the zip path up to the parent directory
            const [zipPath, entryPath] = model.filePath.split('::');
            const entryParentPath = entryPath.split(/[/\\]/).slice(0, -1).join('/');
            directoryFilterPath = entryParentPath ? `${zipPath}::${entryParentPath}` : zipPath;
          } else {
            // For regular files, get the full path up to the parent directory
            // Make sure we're getting the directory, not the file itself
            const lastSlash = Math.max(model.filePath.lastIndexOf('\\'), model.filePath.lastIndexOf('/'));
            if (lastSlash > 0) {
              directoryFilterPath = model.filePath.substring(0, lastSlash);
              // Ensure we have a valid directory path (not a file path)
              if (!directoryFilterPath || directoryFilterPath.endsWith('.zip') || directoryFilterPath.endsWith('.stl') || directoryFilterPath.endsWith('.3mf')) {
                // If somehow we got a file path, extract the parent directory again
                const parentSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
                directoryFilterPath = parentSlash > 0 ? directoryFilterPath.substring(0, parentSlash) : '';
              }
            } else {
              directoryFilterPath = '';
            }
          }
          
          // Validate that we have a directory path, not a file path
          // Check for common file extensions (case-insensitive)
          const lowerPath = directoryFilterPath.toLowerCase();
          if (directoryFilterPath && (lowerPath.endsWith('.zip') || lowerPath.endsWith('.stl') || lowerPath.endsWith('.3mf') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.ply'))) {
            console.warn('Directory filter appears to be a file path, extracting parent directory:', directoryFilterPath);
            const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
            directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
          }
          
          // Final validation: ensure we don't have a file path
          if (directoryFilterPath && directoryFilterPath === model.filePath) {
            console.error('Directory filter is same as file path, this should not happen. File path:', model.filePath);
            const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
            directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
          }
          
          console.log('Setting directory filter to:', directoryFilterPath, 'from file path:', model.filePath);
          
          // Set the global directory filter with the full path
          window.currentDirectoryFilter = directoryFilterPath;
          if (window.viewingEntireLibrary) {
            window.viewingEntireLibrary = false;
          }
          if (typeof window.applyViewForCurrentFolder === 'function') {
            await window.applyViewForCurrentFolder();
          }
          // Instead of filtering just by directory here, trigger the combined search which applies all filters.
          // The updateFilterIndicator function in search.js will handle displaying the filter correctly
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        });
        dirSizeRow.appendChild(directoryPart);
      }
      
      // Size on the right
      if (model.size) {
        const sizePart = document.createElement('div');
        sizePart.className = 'size-part';
        sizePart.style.display = 'flex';
        sizePart.style.alignItems = 'center';
        sizePart.style.gap = '6px';
        sizePart.style.marginLeft = 'auto'; // Push to the right
        sizePart.innerHTML = `
          <span class="metadata-icon">💾</span>
          <span class="metadata-value file-size">${formatFileSize(model.size)}</span>
        `;
        dirSizeRow.appendChild(sizePart);
      }
      
      metadataContainer.appendChild(dirSizeRow);
    }

    // Always check individual model data - don't rely on fieldAnalysis which may be stale
    // This ensures metadata shows up immediately when added to a model
    
    // Add designer with icon (only show if this model has designer data)
    const designerValue = (model.designer && model.designer.trim()) ? model.designer.trim() : '';
    const hasDesigner = designerValue && designerValue !== '';
    if (hasDesigner) {
      const designerItem = document.createElement('div');
      designerItem.className = 'metadata-item designer-item';
      designerItem.style.cursor = 'pointer';
      designerItem.classList.add('clickable-metadata');
      
      designerItem.innerHTML = `
        <span class="metadata-icon">👤</span>
        <span class="metadata-value designer-info" style="color: #ccc; display: inline-block;" title="${designerValue}">${designerValue}</span>
      `;
      
      // Add click handler to filter by designer
      designerItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the designer filter
        const designerSelect = document.getElementById('designer-select');
        if (designerSelect) {
          designerSelect.value = designerValue;
          // Trigger combined search to apply filter
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      });
      metadataContainer.appendChild(designerItem);
    }

    // Add source with icon (only show if this model has source data)
    const sourceValue = (model.source && model.source.trim()) ? model.source.trim() : '';
    if (sourceValue) {
      const sourceItem = document.createElement('div');
      sourceItem.className = 'metadata-item source-item';
      sourceItem.innerHTML = `
        <span class="metadata-icon">🔗</span>
        <span class="metadata-value source-info" style="color: #ccc" title="${sourceValue}">${sourceValue}</span>
      `;
      metadataContainer.appendChild(sourceItem);
    }

    // Add parent model with icon (only show if this model has parent model data)
    const parentValue = (model.parentModel && model.parentModel.trim()) ? model.parentModel.trim() : '';
    if (parentValue) {
      const parentItem = document.createElement('div');
      parentItem.className = 'metadata-item parent-item';
      parentItem.style.cursor = 'pointer';
      parentItem.classList.add('clickable-metadata');
      
      parentItem.innerHTML = `
        <span class="metadata-icon">📦</span>
        <span class="metadata-value parent-info" style="color: #ccc" title="${parentValue}">${parentValue}</span>
      `;
      
      // Add click handler to filter by parent model
      parentItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the parent model filter
        const parentSelect = document.getElementById('parent-select');
        if (parentSelect) {
          parentSelect.value = parentValue;
          // Trigger combined search to apply filter
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      });
      metadataContainer.appendChild(parentItem);
    }

    // Add license with icon (only show if this model has license data)
    const licenseValue = (model.license && model.license.trim()) ? model.license.trim() : '';
    if (licenseValue) {
      const licenseItem = document.createElement('div');
      licenseItem.className = 'metadata-item license-item';
      licenseItem.style.cursor = 'pointer';
      licenseItem.classList.add('clickable-metadata');
      
      licenseItem.innerHTML = `
        <span class="metadata-icon">📜</span>
        <span class="metadata-value license-info" style="color: #ccc" title="${licenseValue}">${licenseValue}</span>
      `;
      
      // Add click handler to filter by license
      licenseItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the license filter
        const licenseSelect = document.getElementById('license-select');
        if (licenseSelect) {
          licenseSelect.value = licenseValue;
          // Trigger combined search to apply filter
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      });
      metadataContainer.appendChild(licenseItem);
    }

    // Add tags with icon - always try to load tags in detailed view
    // (fieldAnalysis might not detect tags since getAllModels doesn't include them)
    let tagsDisplay = '';
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      // Handle both array of strings and array of objects with name property
      const tagNames = model.tags.map(t => (typeof t === 'string' ? t : (t.name || t)));
      tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      tagsDisplay = tagNames.join(', ');
    }
    
    // Always create tags item and load asynchronously if needed
    const tagsItem = document.createElement('div');
    tagsItem.className = 'metadata-item tags-item';
    tagsItem.style.gridColumn = '1 / -1'; // Span both columns like other metadata
    
    if (tagsDisplay) {
      // Tags already available, display them immediately
      const tagNamesForDisplay = model.tags
        .map(t => (typeof t === 'string' ? t : (t && (t.name || t)) || ''))
        .filter(Boolean);
      tagNamesForDisplay.sort((a, b) => a.localeCompare(b));
      tagsItem.innerHTML = `
        <span class="metadata-icon">🏷️</span>
        <span class="metadata-value tags-info" style="color: #ccc" title=""></span>
      `;
      metadataContainer.appendChild(tagsItem);
      const tagsValueSpanSync = tagsItem.querySelector('.tags-info');
      if (tagsValueSpanSync) {
        fillTagsWithFilterLinks(tagsValueSpanSync, tagNamesForDisplay);
        tagsValueSpanSync.setAttribute('title', tagsDisplay);
      }
    } else {
      // Create item and load tags asynchronously
      tagsItem.innerHTML = `
        <span class="metadata-icon">🏷️</span>
        <span class="metadata-value tags-info" style="color: #666"></span>
      `;
      metadataContainer.appendChild(tagsItem);
      
      // Load tags asynchronously - get model ID first if needed
      const loadTags = async () => {
        try {
          let modelId = model.id;
          
          // If model.id doesn't exist, get the model from database using filePath
          if (!modelId && model.filePath) {
            const fullModel = await window.electron.getModel(model.filePath);
            if (fullModel && fullModel.id) {
              modelId = fullModel.id;
              // Also check if tags are already in the full model
              if (fullModel.tags && Array.isArray(fullModel.tags) && fullModel.tags.length > 0) {
                const tagNames = fullModel.tags.map(t => (typeof t === 'string' ? t : (t.name || t))).filter(Boolean);
                tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
                const tagsText = tagNames.join(', ');
                const tagsValueSpan = tagsItem.querySelector('.tags-info');
                if (tagsValueSpan) {
                  fillTagsWithFilterLinks(tagsValueSpan, tagNames);
                  tagsValueSpan.setAttribute('title', tagsText); // Show full tag list on hover
                  tagsValueSpan.style.color = '#ccc';
                }
                return;
              }
            }
          }
          
          // Load tags using model ID
          if (modelId) {
            const tags = await window.electron.getModelTags(modelId);
            if (tags && tags.length > 0) {
              const tagNames = tags.map(t => (typeof t === 'string' ? t : (t.name || t))).filter(Boolean);
              tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
              const tagsText = tagNames.join(', ');
              const tagsValueSpan = tagsItem.querySelector('.tags-info');
              if (tagsValueSpan) {
                fillTagsWithFilterLinks(tagsValueSpan, tagNames);
                tagsValueSpan.setAttribute('title', tagsText); // Show full tag list on hover
                tagsValueSpan.style.color = '#ccc';
              }
            } else {
              // Remove the tags item if no tags found
              tagsItem.remove();
            }
          } else {
            // Remove the tags item if we can't get model ID
            tagsItem.remove();
          }
        } catch (err) {
          console.error('Error loading tags:', err);
          // Remove the tags item on error
          tagsItem.remove();
        }
      };
      
      loadTags();
    }
    
    // Show file details in detailed view
    fileDetails.appendChild(metadataContainer);
    fileDetails.style.padding = '0'; // Remove all padding
    fileDetails.style.margin = '0'; // Remove all margin
    fileInfo.appendChild(fileDetails);
  }
  
  item.appendChild(fileInfo);

  if (view === 'detailed') {
    const engagementBar = createModelEngagementBar(model);
    item.appendChild(engagementBar);
  }

  // Add click event handler for model selection
  item.addEventListener('click', (e) => {
    // Check if ctrl or cmd key is pressed for multi-select
    if (e.ctrlKey || e.metaKey) {
      handleFileClick(e, model.filePath);
    } else {
      toggleModelSelection(item, model.filePath);
    }
  });

  // Add context menu
  addContextMenuHandler(item, model.filePath);

  return item;
}

// Analyze models to determine which metadata fields have data
function analyzeModelFields(models) {
  const fieldAnalysis = {
    hasDesigner: false,
    hasSource: false,
    hasParentModel: false,
    hasLicense: false,
    hasTags: false
  };
  
  if (!models || models.length === 0) {
    return fieldAnalysis;
  }
  
  for (const model of models) {
    if (model.designer && model.designer.trim()) {
      fieldAnalysis.hasDesigner = true;
    }
    if (model.source && model.source.trim()) {
      fieldAnalysis.hasSource = true;
    }
    if (model.parentModel && model.parentModel.trim()) {
      fieldAnalysis.hasParentModel = true;
    }
    if (model.license && model.license.trim()) {
      fieldAnalysis.hasLicense = true;
    }
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      fieldAnalysis.hasTags = true;
    }
    
    // If all fields are found, we can break early for performance
    if (fieldAnalysis.hasDesigner && fieldAnalysis.hasSource && 
        fieldAnalysis.hasParentModel && fieldAnalysis.hasLicense && fieldAnalysis.hasTags) {
      break;
    }
  }
  
  return fieldAnalysis;
}

/** Merge field-visibility flags (progressive load: only analyze appended tail). */
function mergeModelFieldAnalysis(base, delta) {
  return {
    hasDesigner: base.hasDesigner || delta.hasDesigner,
    hasSource: base.hasSource || delta.hasSource,
    hasParentModel: base.hasParentModel || delta.hasParentModel,
    hasLicense: base.hasLicense || delta.hasLicense,
    hasTags: base.hasTags || delta.hasTags
  };
}

/** True when `next` is `prev` with extra rows appended in the same order (progressive library load). */
function isProgressiveModelListExtension(prevModels, nextModels) {
  if (!prevModels.length || nextModels.length <= prevModels.length) return false;
  const key = (m) => (m.id != null && m.id !== '') ? m.id : m.filePath;
  for (let i = 0; i < prevModels.length; i++) {
    if (key(prevModels[i]) !== key(nextModels[i])) return false;
  }
  return true;
}

const parentModelExpandedGroups = new Set();
const zipArchiveExpandedGroups = new Set();
const bundleExpandedGroups = new Set();
let groupThumbnailPreferencesLoaded = false;
let groupThumbnailPreferencesLoading = null;
const groupThumbnailPreferences = {};
/** Survives virtual-grid card recycle so folder/ZIP icons don't flash 3d.png forever. */
const groupThumbnailCache = new Map();

function childHasStoredThumbnail(child) {
  if (!child) return false;
  const primary = getPrimaryThumbnailFromString(child.thumbnail);
  if (primary && !isFailurePlaceholderThumbnail(primary)) return true;
  return Boolean(child.hasThumbnail) && Number(child.hasThumbnail) !== 0;
}

function rememberGroupThumbnails(groupKey, thumbnails) {
  if (!groupKey) return;
  const valid = (thumbnails || []).filter((t) => t && t !== '3d.png' && !isFailurePlaceholderThumbnail(t));
  if (valid.length === 0) return;
  groupThumbnailCache.set(groupKey, valid.slice(0, MAX_GROUP_CAROUSEL_THUMBNAILS));
}

function getCachedGroupThumbnails(groupKey) {
  if (!groupKey || !groupThumbnailCache.has(groupKey)) return [];
  return groupThumbnailCache.get(groupKey).slice();
}

function invalidateGroupThumbnailCache(groupKey = null) {
  if (groupKey) groupThumbnailCache.delete(groupKey);
  else groupThumbnailCache.clear();
}

async function filterNonEmptyThumbnails(thumbs) {
  const out = [];
  for (const t of thumbs || []) {
    if (!t || t === '3d.png' || isFailurePlaceholderThumbnail(t)) continue;
    if (await isMostlyEmptyThumbnailDataUrl(t)) continue;
    out.push(t);
  }
  return out;
}

async function loadGroupThumbnailPreferences() {
  if (groupThumbnailPreferencesLoaded) return;
  if (groupThumbnailPreferencesLoading) {
    await groupThumbnailPreferencesLoading;
    return;
  }
  groupThumbnailPreferencesLoading = (async () => {
  groupThumbnailPreferencesLoaded = true;
  try {
    if (!window.electron?.getSetting) return;
    const raw = await window.electron.getSetting('groupThumbnailPreferences');
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      Object.assign(groupThumbnailPreferences, parsed);
    }
  } catch (error) {
    console.error('Failed to load group thumbnail preferences:', error);
  }
  })();
  await groupThumbnailPreferencesLoading;
  groupThumbnailPreferencesLoading = null;
}

async function saveGroupThumbnailPreferences() {
  try {
    if (!window.electron?.saveSetting) return;
    await window.electron.saveSetting('groupThumbnailPreferences', JSON.stringify(groupThumbnailPreferences));
  } catch (error) {
    console.error('Failed to save group thumbnail preferences:', error);
  }
}

function getParentModelGroupLabel(model) {
  return model?.parentModel ? String(model.parentModel).trim() : '';
}

function getParentModelGroupKey(parentModel) {
  return String(parentModel || '').trim().toLocaleLowerCase();
}

function getModelRenderKey(model) {
  if (!model) return '';
  if (model.id != null && model.id !== '') return `id:${model.id}`;
  return `path:${model.filePath || ''}`;
}

function getParentModelGroupHeight(view) {
  if (view === 'list') return 52;
  if (view === 'preview') return getPreviewTileSizePx();
  return 450;
}

function getZipArchiveGroupLabel(model) {
  const parsed = parseZipPath(model?.filePath || '');
  if (!parsed.isZipEntry || !parsed.zipPath) return '';
  const normalized = String(parsed.zipPath).replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

function getZipArchiveGroupKey(model) {
  const parsed = parseZipPath(model?.filePath || '');
  if (!parsed.isZipEntry || !parsed.zipPath) return '';
  return normalizePathForComparison(parsed.zipPath);
}

function buildGroupedDisplayRecords(records, options) {
  const {
    groupKind,
    keyPrefix,
    expandedSet,
    getGroupLabelFromModel,
    getGroupKeyFromModel
  } = options || {};

  const groupedRecords = [];
  const recordIndexByGroupKey = new Map();

  (records || []).forEach(record => {
    if (!record || record.type !== 'model' || !record.model) {
      groupedRecords.push(record);
      return;
    }

    const groupLabel = getGroupLabelFromModel(record.model);
    const groupKeyRaw = getGroupKeyFromModel(record.model);
    if (!groupLabel || !groupKeyRaw) {
      groupedRecords.push(record);
      return;
    }

    const groupKey = `${keyPrefix}:${groupKeyRaw}`;
    const existingIndex = recordIndexByGroupKey.get(groupKey);
    if (existingIndex == null) {
      groupedRecords.push(record);
      recordIndexByGroupKey.set(groupKey, groupedRecords.length - 1);
      return;
    }

    const existingRecord = groupedRecords[existingIndex];
    if (existingRecord?.type === 'model') {
      groupedRecords[existingIndex] = {
        type: 'group',
        key: `group:${groupKey}`,
        groupKind,
        groupKey,
        groupLabel,
        children: [existingRecord.model, record.model]
      };
      return;
    }

    if (existingRecord?.type === 'group') {
      existingRecord.children.push(record.model);
    }
  });

  const flattened = [];
  groupedRecords.forEach(record => {
    if (record.type !== 'group') {
      flattened.push(record);
      return;
    }
    if ((record.children || []).length <= 1) {
      const onlyModel = (record.children || [])[0];
      if (onlyModel) {
        flattened.push({
          type: 'model',
          key: `model:${getModelRenderKey(onlyModel)}`,
          model: onlyModel
        });
      }
      return;
    }

    const expanded = expandedSet.has(record.groupKey);
    flattened.push({ ...record, expanded });
    if (expanded) {
      record.children.forEach(model => {
        flattened.push({
          type: 'model',
          key: `child:${record.groupKey}:${getModelRenderKey(model)}`,
          model,
          parentGroupKey: record.groupKey
        });
      });
    }
  });

  return flattened;
}

function buildParentModelDisplayRecords(models) {
  const records = [];
  const seenModelKeys = new Set();

  (models || []).forEach((model, index) => {
    let dedupeKey = getGridModelDedupeKey(model);
    if (!dedupeKey) dedupeKey = `__row__:${index}`;
    if (seenModelKeys.has(dedupeKey)) {
      return;
    }
    seenModelKeys.add(dedupeKey);

    const modelRenderKey = getModelRenderKey(model);

    records.push({
      type: 'model',
      key: `model:${modelRenderKey}`,
      model
    });
  });

  const bundleGroupedRecords = buildGroupedDisplayRecords(records, {
    groupKind: 'bundle',
    keyPrefix: 'bundle',
    expandedSet: bundleExpandedGroups,
    getGroupLabelFromModel: getBundleGroupLabel,
    getGroupKeyFromModel: getBundleGroupKey
  });

  return buildGroupedDisplayRecords(bundleGroupedRecords, {
    groupKind: 'parentModel',
    keyPrefix: 'parent',
    expandedSet: parentModelExpandedGroups,
    getGroupLabelFromModel: getParentModelGroupLabel,
    getGroupKeyFromModel: (model) => getParentModelGroupKey(getParentModelGroupLabel(model))
  });
}

function buildParentModelLayoutRows(displayRecords, columns, view, itemHeight, paddingVertical, verticalGap) {
  const rows = [];
  let currentModelRow = [];

  const flushModelRow = () => {
    if (currentModelRow.length === 0) return;
    rows.push({
      type: 'models',
      key: `models:${currentModelRow.map(record => record.key).join('|')}`,
      records: currentModelRow,
      height: itemHeight
    });
    currentModelRow = [];
  };

  displayRecords.forEach(record => {
    if (record.type === 'group' && (record.children || []).length <= 1) {
      const onlyModel = (record.children || [])[0];
      if (onlyModel) {
        currentModelRow.push({
          type: 'model',
          key: `model:${getModelRenderKey(onlyModel)}`,
          model: onlyModel
        });
        if (currentModelRow.length >= columns) {
          flushModelRow();
        }
      }
      return;
    }

    if (record.type === 'group' && view === 'list') {
      flushModelRow();
      rows.push({
        type: 'group',
        key: record.key,
        record,
        height: getParentModelGroupHeight(view)
      });
      return;
    }

    currentModelRow.push(record);
    if (currentModelRow.length >= columns) {
      flushModelRow();
    }
  });

  flushModelRow();

  let top = paddingVertical;
  rows.forEach((row, index) => {
    row.top = top;
    row.bottom = top + row.height;
    top = row.bottom + (index < rows.length - 1 ? verticalGap : 0);
  });

  const totalHeight = rows.length > 0 ? rows[rows.length - 1].bottom + paddingVertical : paddingVertical * 2;
  return { rows, totalHeight };
}

/** Cap group-card carousels so large folders don't become 1/500+ counters. */
const MAX_GROUP_CAROUSEL_THUMBNAILS = 12;
/** Cap the manage-thumbnails picker; one primary image per child is enough. */
const MAX_GROUP_MANAGE_THUMBNAILS = 48;

function getPrimaryThumbnailFromString(thumbnailString) {
  if (!thumbnailString || thumbnailString === '3d.png') return null;
  const primary = String(thumbnailString)
    .split('::')
    .find((t) => t && t !== '3d.png');
  return primary || null;
}

function getParentModelThumbnails(children, groupKey = '') {
  const thumbnails = [];
  const seen = new Set();

  // One primary thumbnail per child — not every embedded 3MF image.
  for (const child of children || []) {
    if (thumbnails.length >= MAX_GROUP_CAROUSEL_THUMBNAILS) break;
    const primary = getPrimaryThumbnailFromString(child.thumbnail);
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    thumbnails.push(primary);
  }

  const preferred = groupThumbnailPreferences[groupKey];
  if (preferred) {
    const preferredIndex = thumbnails.indexOf(preferred);
    if (preferredIndex > 0) {
      thumbnails.splice(preferredIndex, 1);
      thumbnails.unshift(preferred);
    } else if (preferredIndex < 0 && preferred !== '3d.png') {
      thumbnails.unshift(preferred);
      if (thumbnails.length > MAX_GROUP_CAROUSEL_THUMBNAILS) {
        thumbnails.length = MAX_GROUP_CAROUSEL_THUMBNAILS;
      }
    }
  }

  return thumbnails;
}

function updateParentModelGroupThumbnailCarousel(thumbnailWrap, imageElement, thumbnails) {
  const validThumbnails = (thumbnails || []).filter(t => t && t !== '3d.png');
  if (validThumbnails.length === 0) return;
  const isListGroupView = Boolean(thumbnailWrap.closest('.parent-model-group-list'));

  thumbnailWrap.dataset.thumbnails = JSON.stringify(validThumbnails);
  thumbnailWrap.dataset.currentIndex = thumbnailWrap.dataset.currentIndex || '0';
  imageElement.src = validThumbnails[0];

  let leftNav = thumbnailWrap.querySelector('.thumbnail-nav-left');
  let rightNav = thumbnailWrap.querySelector('.thumbnail-nav-right');
  let badge = thumbnailWrap.querySelector('.thumbnail-count-badge');

  if (validThumbnails.length < 2) {
    leftNav?.remove();
    rightNav?.remove();
    badge?.remove();
    return;
  }

  if (!leftNav) {
    leftNav = document.createElement('div');
    leftNav.className = 'thumbnail-nav-left';
    leftNav.style.cssText = 'position:absolute;left:0;top:0;width:50%;height:100%;cursor:pointer;z-index:10;';
    leftNav.title = 'Previous group thumbnail';
    thumbnailWrap.appendChild(leftNav);
  }

  if (!rightNav) {
    rightNav = document.createElement('div');
    rightNav.className = 'thumbnail-nav-right';
    rightNav.style.cssText = 'position:absolute;right:0;top:0;width:50%;height:100%;cursor:pointer;z-index:10;';
    rightNav.title = 'Next group thumbnail';
    thumbnailWrap.appendChild(rightNav);
  }

  if (isListGroupView) {
    badge?.remove();
    badge = null;
  } else if (!badge) {
    badge = document.createElement('div');
    badge.className = 'thumbnail-count-badge';
    badge.style.cssText =
      'position:absolute;bottom:8px;right:8px;background:rgba(0,0,0,0.7);color:#fff;padding:4px 8px;border-radius:12px;font-size:12px;font-weight:bold;z-index:11;pointer-events:none;';
    thumbnailWrap.appendChild(badge);
  }

  const updateBadge = () => {
    if (!badge) return;
    const currentIdx = parseInt(thumbnailWrap.dataset.currentIndex, 10) || 0;
    badge.textContent = `${currentIdx + 1}/${validThumbnails.length}`;
    badge.title = `Group thumbnail ${currentIdx + 1} of ${validThumbnails.length}`;
  };

  const navigate = (direction, event) => {
    event?.preventDefault();
    event?.stopPropagation();
    let currentIndex = parseInt(thumbnailWrap.dataset.currentIndex, 10) || 0;
    currentIndex = direction === 'prev'
      ? (currentIndex - 1 + validThumbnails.length) % validThumbnails.length
      : (currentIndex + 1) % validThumbnails.length;
    thumbnailWrap.dataset.currentIndex = String(currentIndex);
    imageElement.src = validThumbnails[currentIndex];
    updateBadge();
  };

  leftNav.onclick = (event) => navigate('prev', event);
  rightNav.onclick = (event) => navigate('next', event);
  updateBadge();
}

async function hydrateParentModelGroupThumbnails(thumbnailWrap, imageElement, children, groupKey = '') {
  if (!window.electron || !thumbnailWrap) return;

  const generation = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  thumbnailWrap.dataset.hydrateGen = generation;
  const isStale = () =>
    thumbnailWrap.dataset.hydrateGen !== generation || !thumbnailWrap.isConnected;

  const applyThumbs = async (thumbs, { paint = true } = {}) => {
    const valid = await filterNonEmptyThumbnails(thumbs);
    if (valid.length === 0) return false;
    rememberGroupThumbnails(groupKey, valid);
    if (paint && !isStale()) {
      updateParentModelGroupThumbnailCarousel(thumbnailWrap, imageElement, valid);
    }
    return true;
  };

  // Grid rows omit thumbnail blobs — prefer cache, then any inline data, then IPC.
  // Drop clipped/transparent leftovers from the old far-plane bug.
  let thumbnails = await filterNonEmptyThumbnails(getCachedGroupThumbnails(groupKey));
  if (thumbnails.length === 0) {
    invalidateGroupThumbnailCache(groupKey);
    thumbnails = await filterNonEmptyThumbnails(
      getParentModelThumbnails(children, groupKey)
    );
  }
  const seen = new Set(thumbnails);
  if (thumbnails.length > 0) {
    await applyThumbs(thumbnails);
  }
  if (thumbnails.length >= MAX_GROUP_CAROUSEL_THUMBNAILS) return;

  const candidates = (children || []).filter((child) => child.filePath);
  const withStored = candidates.filter((c) => childHasStoredThumbnail(c));
  const withoutStored = candidates.filter((c) => !childHasStoredThumbnail(c));
  const ordered = withStored.concat(withoutStored);

  const fetchPrimaryForChild = async (child) => {
    const tryThumb = async (value) => {
      const primary = getPrimaryThumbnailFromString(value) ||
        (value && value !== '3d.png' ? value : null);
      if (!primary || isFailurePlaceholderThumbnail(primary)) return null;
      if (await isMostlyEmptyThumbnailDataUrl(primary)) return null;
      return primary;
    };

    const inline = await tryThumb(child.thumbnail);
    if (inline) return inline;
    try {
      if (typeof fetchPrimaryThumbnailForGrid === 'function') {
        const single = await fetchPrimaryThumbnailForGrid(child.filePath);
        if (single) return single;
      } else if (window.electron.getThumbnail) {
        const single = await window.electron.getThumbnail(child.filePath);
        const primary = await tryThumb(single);
        if (primary) return primary;
      }
      if (window.electron.getModel) {
        const fullModel = await window.electron.getModel(child.filePath);
        return tryThumb(fullModel?.thumbnail);
      }
    } catch (error) {
      // Best-effort
    }
    return null;
  };

  const firstWave = ordered.slice(0, Math.min(6, MAX_GROUP_CAROUSEL_THUMBNAILS));
  if (firstWave.length > 0) {
    const results = await Promise.all(firstWave.map((child) => fetchPrimaryForChild(child)));
    if (isStale()) return;
    for (const primary of results) {
      if (!primary || seen.has(primary)) continue;
      seen.add(primary);
      thumbnails.push(primary);
      if (thumbnails.length >= MAX_GROUP_CAROUSEL_THUMBNAILS) break;
    }
    if (thumbnails.length > 0) {
      await applyThumbs(thumbnails);
    }
  }
  if (thumbnails.length >= MAX_GROUP_CAROUSEL_THUMBNAILS || isStale()) return;

  for (const child of ordered.slice(firstWave.length)) {
    if (isStale()) return;
    if (thumbnails.length >= MAX_GROUP_CAROUSEL_THUMBNAILS) break;
    const primary = await fetchPrimaryForChild(child);
    if (!primary || seen.has(primary)) continue;
    seen.add(primary);
    thumbnails.push(primary);
    await applyThumbs(thumbnails);
  }

  if (!isStale() && thumbnails.length > 0) {
    await applyThumbs(thumbnails);
    return;
  }

  if (!isStale() && thumbnails.length === 0 && candidates.length > 0 && typeof renderModelToPNG === 'function') {
    try {
      // Detached temp container — must retainDetached or post-load isConnected check aborts.
      const tempContainer = document.createElement('div');
      const rendered = await renderModelToPNG(candidates[0].filePath, tempContainer, null, {
        retainDetached: true
      });
      if (isStale()) return;
      if (rendered && rendered !== '3d.png' && !isFailurePlaceholderThumbnail(rendered) && !(await isMostlyEmptyThumbnailDataUrl(rendered))) {
        thumbnails.push(rendered);
        await applyThumbs(thumbnails);
        if (window.electron.saveThumbnail) {
          await window.electron.saveThumbnail(candidates[0].filePath, rendered);
        }
      }
    } catch (error) {
      // Keep the placeholder if rendering fallback fails.
    }
  }
}

async function collectThumbnailsForGroup(groupRecord) {
  const thumbnails = [];
  const seen = new Set();
  const addThumb = (thumb) => {
    if (!thumb || thumb === '3d.png' || seen.has(thumb)) return false;
    if (thumbnails.length >= MAX_GROUP_MANAGE_THUMBNAILS) return false;
    seen.add(thumb);
    thumbnails.push(thumb);
    return true;
  };

  for (const child of (groupRecord.children || [])) {
    if (thumbnails.length >= MAX_GROUP_MANAGE_THUMBNAILS) break;

    // One representative image per child for the picker.
    const inlinePrimary = getPrimaryThumbnailFromString(child.thumbnail);
    if (inlinePrimary) {
      addThumb(inlinePrimary);
      continue;
    }

    try {
      if (window.electron?.getThumbnail) {
        const single = await window.electron.getThumbnail(child.filePath);
        if (addThumb(getPrimaryThumbnailFromString(single) || single)) continue;
      }
      if (window.electron?.getModel) {
        const full = await window.electron.getModel(child.filePath);
        addThumb(getPrimaryThumbnailFromString(full?.thumbnail));
      }
    } catch (error) {
      // keep collecting from remaining children
    }
  }

  const preferred = groupThumbnailPreferences[groupRecord.groupKey];
  if (preferred) {
    const preferredIndex = thumbnails.indexOf(preferred);
    if (preferredIndex > 0) {
      thumbnails.splice(preferredIndex, 1);
      thumbnails.unshift(preferred);
    } else if (preferredIndex < 0 && preferred !== '3d.png') {
      thumbnails.unshift(preferred);
      if (thumbnails.length > MAX_GROUP_MANAGE_THUMBNAILS) {
        thumbnails.length = MAX_GROUP_MANAGE_THUMBNAILS;
      }
    }
  }

  return thumbnails;
}

function getBundleContainerPath(groupRecord) {
  const first = groupRecord?.children?.[0];
  if (!first?.filePath) {
    return { path: '', kind: 'folder' };
  }
  const bundleKind = first.bundleKind || deriveBundleFieldsForModel(first).bundleKind;
  if (bundleKind === 'zip' || first.filePath.includes('::')) {
    return { path: parseZipPath(first.filePath).zipPath, kind: 'zip' };
  }
  const sep = Math.max(first.filePath.lastIndexOf('/'), first.filePath.lastIndexOf('\\'));
  return { path: sep >= 0 ? first.filePath.slice(0, sep) : first.filePath, kind: 'folder' };
}

let currentBundleDetailsGroupKey = null;
let currentBundleDetailsRecord = null;

function hideBundleDetailsPanel() {
  const panel = document.getElementById('bundle-details');
  if (panel) panel.classList.add('hidden');
  currentBundleDetailsGroupKey = null;
  currentBundleDetailsRecord = null;
  const container = document.querySelector('.file-grid');
  if (container?.renderVisibleItemsFn) container.renderVisibleItemsFn();
}

async function showBundleDetails(groupRecord) {
  if (!groupRecord?.children?.length) return;

  currentBundleDetailsGroupKey = groupRecord.groupKey;
  currentBundleDetailsRecord = groupRecord;

  document.getElementById('model-details')?.classList.add('hidden');
  document.getElementById('multi-edit-panel')?.classList.add('hidden');

  const panel = document.getElementById('bundle-details');
  if (!panel) return;

  const bundleKind = groupRecord.children[0]?.bundleKind
    || deriveBundleFieldsForModel(groupRecord.children[0]).bundleKind
    || 'folder';
  const groupLabel = groupRecord.groupLabel || 'Bundle';
  const containerInfo = getBundleContainerPath(groupRecord);
  const children = [...groupRecord.children].sort((a, b) =>
    String(a.fileName || '').localeCompare(String(b.fileName || ''), undefined, { sensitivity: 'base' })
  );

  const titleEl = document.getElementById('bundle-details-title');
  const subtitleEl = document.getElementById('bundle-details-subtitle');
  const pathEl = document.getElementById('bundle-details-path');
  const statsEl = document.getElementById('bundle-details-stats');
  const listEl = document.getElementById('bundle-contents-list');

  const kindLabel = bundleKind === 'zip' ? 'ZIP archive' : 'Folder bundle';
  if (titleEl) titleEl.textContent = groupLabel;
  if (subtitleEl) subtitleEl.textContent = `${kindLabel} • ${children.length} file${children.length === 1 ? '' : 's'}`;

  const containerPath = containerInfo.path || '';
  if (pathEl) pathEl.value = containerPath;

  const totalBytes = children.reduce((sum, c) => sum + (Number(c.size) || 0), 0);
  const printedCount = children.filter((c) => Boolean(c.printed)).length;
  if (statsEl) {
    statsEl.innerHTML = `
      <span><strong>${children.length}</strong> models</span>
      <span><strong>${formatFileSize(totalBytes)}</strong> combined size</span>
      <span><strong>${printedCount}/${children.length}</strong> printed</span>
    `;
  }

  if (listEl) {
    listEl.innerHTML = '';
    for (const child of children) {
      const entryPath = child.filePath?.includes('::')
        ? (child.filePath.split('::')[1] || child.fileName)
        : (child.fileName || child.filePath || '');
      const displayName = String(entryPath).split(/[/\\]/).pop() || entryPath || '—';

      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'bundle-contents-list-item';
      btn.textContent = displayName;
      btn.title = entryPath || displayName;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        listEl.querySelectorAll('.bundle-contents-list-item.is-active').forEach((el) => {
          el.classList.remove('is-active');
        });
        btn.classList.add('is-active');
        if (child.filePath) showModelDetails(child.filePath);
      });
      li.appendChild(btn);
      listEl.appendChild(li);
    }
  }

  const showPathBtn = document.getElementById('bundle-details-show-path');
  if (showPathBtn) {
    showPathBtn.onclick = async (e) => {
      e.preventDefault();
      if (containerPath && window.electron?.showItemInFolder) {
        await window.electron.showItemInFolder(containerPath);
      }
    };
    showPathBtn.disabled = !containerPath;
  }

  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const grid = document.querySelector('.file-grid');
  if (grid?.renderVisibleItemsFn) grid.renderVisibleItemsFn();
}

async function showManageGroupThumbnailsModal(groupRecord) {
  await loadGroupThumbnailPreferences();

  const dialog = document.getElementById('manage-thumbnails-dialog');
  const grid = document.getElementById('thumbnails-grid');
  if (!dialog || !grid) {
    throw new Error('Manage thumbnails dialog elements not found');
  }

  const title = dialog.querySelector('h3');
  const desc = dialog.querySelector('.form-group p');
  const groupLabel = groupRecord?.groupLabel || groupRecord?.parentModel || 'group';
  const groupLabelType = groupRecord?.groupKind === 'bundle'
    ? (groupRecord.children?.[0]?.bundleKind === 'zip' ? 'ZIP bundle' : 'folder bundle')
    : groupRecord?.groupKind === 'zip'
      ? 'ZIP archive group'
      : 'parent group';
  if (title) title.textContent = `Manage Group Thumbnails`;
  if (desc) desc.textContent = `Pick the thumbnail shown on ${groupLabelType} "${groupLabel}".`;

  const thumbnails = await collectThumbnailsForGroup(groupRecord);
  if (!thumbnails.length) {
    alert('No thumbnails found in child models for this group.');
    return;
  }

  grid.innerHTML = '';
  thumbnails.forEach((thumbnail, index) => {
    const item = document.createElement('div');
    item.className = 'thumbnail-item';
    if (index === 0) item.classList.add('active');

    const img = document.createElement('img');
    img.src = thumbnail;
    img.alt = `Group Thumbnail ${index + 1}`;

    const label = document.createElement('div');
    label.className = 'thumbnail-item-label';
    label.textContent = index === 0 ? 'Active' : `Image ${index + 1}`;

    const overlay = document.createElement('div');
    overlay.className = 'thumbnail-item-overlay';

    const setActiveButton = document.createElement('button');
    setActiveButton.type = 'button';
    setActiveButton.className = 'thumbnail-item-button set-active';
    setActiveButton.textContent = index === 0 ? 'Active' : 'Set as Active';
    setActiveButton.disabled = index === 0;

    const setAsActive = async () => {
      groupThumbnailPreferences[groupRecord.groupKey] = thumbnail;
      rememberGroupThumbnails(groupRecord.groupKey, [thumbnail, ...getCachedGroupThumbnails(groupRecord.groupKey)]);
      await saveGroupThumbnailPreferences();
      const container = document.querySelector('.file-grid');
      if (container?.renderVisibleItemsFn) container.renderVisibleItemsFn();
      await showManageGroupThumbnailsModal(groupRecord);
    };

    setActiveButton.addEventListener('click', async (e) => {
      e.stopPropagation();
      await setAsActive();
    });

    item.addEventListener('click', async (e) => {
      if (e.target.closest('.thumbnail-item-button') || index === 0) return;
      await setAsActive();
    });

    overlay.appendChild(setActiveButton);
    item.appendChild(img);
    item.appendChild(label);
    item.appendChild(overlay);
    grid.appendChild(item);
  });

  dialog.showModal();
}

function parseTagInput(tagInput) {
  return String(tagInput || '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean)
    .filter((tag, index, array) => array.indexOf(tag) === index);
}

async function getGroupModelsWithTags(groupRecord) {
  const children = groupRecord.children || [];
  const result = [];
  for (const child of children) {
    try {
      const model = await window.electron.getModel(child.filePath);
      if (!model) continue;
      const tags = Array.isArray(model.tags)
        ? model.tags.map(tag => (typeof tag === 'string' ? tag : (tag?.name || tag))).filter(Boolean)
        : [];
      result.push({ model, tags });
    } catch (error) {
      console.error('Failed loading model for group tag update:', child.filePath, error);
    }
  }
  return result;
}

async function updateGroupTags(groupRecord, mode = 'merge') {
  const modelsWithTags = await getGroupModelsWithTags(groupRecord);
  if (!modelsWithTags.length) {
    await window.electron.showMessage('Group Tags', 'No models found in this group.');
    return;
  }

  const commonTags = modelsWithTags
    .map(entry => new Set(entry.tags))
    .reduce((acc, set) => {
      if (!acc) return new Set(set);
      return new Set([...acc].filter(tag => set.has(tag)));
    }, null);
  const defaultInput = commonTags && commonTags.size > 0 ? Array.from(commonTags).sort().join(', ') : '';

  const input = await window.electron.showInputDialog({
    title: mode === 'replace' ? 'Replace Group Tags' : 'Add Tags to Group',
    message: `Enter comma-separated tags for group "${groupRecord?.groupLabel || groupRecord?.parentModel || ''}"`,
    defaultValue: defaultInput,
    placeholder: 'e.g. Functional, Mechanical, MMU'
  });

  if (!input || !String(input).trim()) {
    return;
  }

  const requestedTags = parseTagInput(input);
  if (!requestedTags.length) {
    await window.electron.showMessage('Group Tags', 'No valid tags provided.');
    return;
  }

  for (const { model, tags } of modelsWithTags) {
    const nextTags = mode === 'replace'
      ? requestedTags
      : Array.from(new Set([...(tags || []), ...requestedTags])).sort((a, b) => a.localeCompare(b));
    model.tags = nextTags;
    await window.electron.saveModel(model);
  }

  const container = document.querySelector('.file-grid');
  if (container?.renderVisibleItemsFn) container.renderVisibleItemsFn();
  await window.electron.showMessage(
    'Group Tags Updated',
    `Updated tags for ${modelsWithTags.length} model${modelsWithTags.length === 1 ? '' : 's'} in "${groupRecord?.groupLabel || groupRecord?.parentModel || ''}".`
  );
}

function createParentModelGroupItem(groupRecord, viewMode = null) {
  const view = viewMode || currentGridView;
  const groupLabel = groupRecord?.groupLabel || groupRecord?.parentModel || 'Group';
  const expandedSet =
    groupRecord?.groupKind === 'bundle'
      ? bundleExpandedGroups
      : groupRecord?.groupKind === 'zip'
        ? zipArchiveExpandedGroups
        : parentModelExpandedGroups;
  const isParentModelGroup = groupRecord?.groupKind === 'parentModel';
  const bundleKind = groupRecord?.groupKind === 'bundle'
    ? (groupRecord.children?.[0]?.bundleKind || 'folder')
    : '';
  const item = document.createElement('div');
  item.className = `parent-model-group parent-model-group-${view}`;
  if (view !== 'list') {
    item.classList.add('file-item', `file-item-${view}`);
  }
  if (groupRecord.expanded) {
    item.classList.add('expanded');
  }
  if (currentBundleDetailsGroupKey && groupRecord.groupKey === currentBundleDetailsGroupKey) {
    item.classList.add('bundle-details-active');
  }
  item.dataset.groupKey = groupRecord.groupKey;
  item.dataset.groupKind = groupRecord.groupKind || 'parentModel';
  item.dataset.childCount = String(groupRecord.children.length);
  item.dataset.expanded = groupRecord.expanded ? '1' : '0';
  item.tabIndex = 0;
  item.setAttribute('role', 'button');
  item.setAttribute('aria-expanded', groupRecord.expanded ? 'true' : 'false');
  item.title = `${groupRecord.expanded ? 'Collapse' : 'Expand'} ${groupLabel}`;

  const thumbnailWrap = document.createElement('div');
  thumbnailWrap.className = 'parent-model-group-thumbnail';
  thumbnailWrap.style.position = 'relative';

  const thumbnailImg = document.createElement('img');
  thumbnailImg.src = '3d.png';
  thumbnailImg.alt = '';
  thumbnailWrap.appendChild(thumbnailImg);

  if (view !== 'list') {
    const groupBadge = document.createElement('div');
    groupBadge.className = 'parent-model-group-corner-badge';
    groupBadge.classList.add(groupRecord.expanded ? 'is-expanded' : 'is-collapsed');
    groupBadge.title = groupRecord?.groupKind === 'bundle'
      ? `${bundleKind === 'zip' ? 'ZIP bundle' : 'Folder bundle'} (${groupRecord.expanded ? 'expanded' : 'collapsed'})`
      : `${groupRecord?.groupKind === 'zip' ? 'ZIP archive group' : 'Parent model group'} (${groupRecord.expanded ? 'expanded' : 'collapsed'})`;
    for (let i = 0; i < 3; i++) {
      groupBadge.appendChild(document.createElement('span'));
    }
    thumbnailWrap.appendChild(groupBadge);
  }

  // Grid queries omit thumbnail blobs on children — use cache so icons survive card recycle.
  let groupThumbnails = getCachedGroupThumbnails(groupRecord.groupKey);
  if (groupThumbnails.length === 0) {
    groupThumbnails = getParentModelThumbnails(groupRecord.children, groupRecord.groupKey);
  }
  if (groupThumbnails.length > 0) {
    updateParentModelGroupThumbnailCarousel(thumbnailWrap, thumbnailImg, groupThumbnails);
  }
  hydrateParentModelGroupThumbnails(thumbnailWrap, thumbnailImg, groupRecord.children, groupRecord.groupKey);

  const details = document.createElement('div');
  details.className = 'parent-model-group-details';

  const titleRow = document.createElement('div');
  titleRow.className = 'parent-model-group-title-row';

  const chevron = document.createElement('span');
  chevron.className = 'parent-model-group-chevron';
  chevron.textContent = groupRecord.expanded ? '▾' : '▸';

  const title = document.createElement('span');
  title.className = 'parent-model-group-title parent-model-filter-link';
  title.textContent = groupLabel;
  title.title = groupLabel;
  if (isParentModelGroup) {
    title.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const parentSelect = document.getElementById('parent-select');
      if (!parentSelect) return;
      parentSelect.value = groupLabel;
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      }
    });
  } else {
    title.classList.remove('parent-model-filter-link');
  }

  titleRow.appendChild(chevron);
  titleRow.appendChild(title);

  const printedCount = groupRecord.children.filter(child => Boolean(child.printed)).length;
  const childCount = groupRecord.children.length;
  const meta = document.createElement('div');
  meta.className = 'parent-model-group-meta';
  if (groupRecord?.groupKind === 'bundle') {
    const kindLabel = bundleKind === 'zip' ? 'zip archive' : 'folder';
    meta.textContent = `${childCount} part${childCount === 1 ? '' : 's'} • ${kindLabel} • ${printedCount}/${childCount} printed`;
    meta.title = 'Right-click for Preview and more options';
  } else {
    meta.textContent = `${childCount} model${childCount === 1 ? '' : 's'} • ${printedCount}/${childCount} printed`;
  }

  details.appendChild(titleRow);
  details.appendChild(meta);

  item.appendChild(thumbnailWrap);
  item.appendChild(details);

  if (view === 'detailed') {
    const engagementBar = createModelEngagementBar(null, {
      groupMode: true,
      children: groupRecord.children || []
    });
    item.appendChild(engagementBar);
  }

  const toggleGroup = () => {
    if (expandedSet.has(groupRecord.groupKey)) {
      expandedSet.delete(groupRecord.groupKey);
    } else {
      expandedSet.add(groupRecord.groupKey);
    }
    const container = document.querySelector('.file-grid');
    if (container?.renderVisibleItemsFn) {
      container.renderVisibleItemsFn();
    } else {
      renderVirtualGrid(container?.currentModels || []);
    }
  };

  const expandGroupAndShowDetails = () => {
    const isBundle = groupRecord.groupKind === 'bundle' || groupRecord.groupKind === 'zip';
    if (isBundle) {
      // Expand (don't toggle) so a single click both opens children and the details panel.
      // Avoid expand→collapse from click+click before dblclick.
      expandedSet.add(groupRecord.groupKey);
      const container = document.querySelector('.file-grid');
      if (container?.renderVisibleItemsFn) {
        container.renderVisibleItemsFn();
      } else {
        renderVirtualGrid(container?.currentModels || []);
      }
      showBundleDetails(groupRecord);
      return;
    }
    toggleGroup();
  };

  chevron.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleGroup();
  });

  item.addEventListener('click', (event) => {
    if (event.target.closest('.parent-model-group-chevron')) return;
    if (event.target.closest('.model-engagement-bar')) return;
    event.preventDefault();
    event.stopPropagation();
    expandGroupAndShowDetails();
  });
  item.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      expandGroupAndShowDetails();
    }
  });
  item.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    event.stopPropagation();
    const paths = (groupRecord.children || []).map(c => c && c.filePath).filter(Boolean);
    if (!paths.length) return;
    const x = event.clientX;
    const y = event.clientY;
    const isBundleGroup = groupRecord.groupKind === 'bundle' || groupRecord.groupKind === 'zip';
    const fileIdentifier = isBundleGroup || paths.length > 1
      ? {
          filePaths: paths,
          groupLabel: groupRecord.groupLabel || groupRecord.parentModel || 'Group',
          previewAsBundle: isBundleGroup || paths.length > 1
        }
      : paths[0];
    try {
      const menuResult = await window.electron.showContextMenu(fileIdentifier);
      if (menuResult && menuResult.type === 'html-menu') {
        showHtmlContextMenu(menuResult, x, y);
      }
    } catch (error) {
      console.error('Error showing context menu for group:', error);
    }
  });

  return item;
}

// Virtual grid function—renders only items visible in the scroll window.
function renderVirtualGrid(models) {
  const container = document.querySelector('.file-grid');
  if (!container) return;

  models = dedupeModelsForVirtualGrid(models || []);
  pruneBundleExpandedGroups(models);
  pruneParentModelExpandedGroups(models);
  pruneZipArchiveExpandedGroups(models);

  if (currentGridView === 'preview') {
    container.classList.add('preview-wall');
    container.style.setProperty('--preview-tile', `${getPreviewTileSizePx()}px`);
  } else {
    container.classList.remove('preview-wall');
    container.style.removeProperty('--preview-tile');
  }

  if (!groupThumbnailPreferencesLoaded) {
    loadGroupThumbnailPreferences().then(() => {
      if (container.renderVisibleItemsFn) container.renderVisibleItemsFn();
    }).catch(() => {});
  }
  
  // Prevent multiple simultaneous renders
  if (container.isRendering) {
    // Queue the render for later
    container.pendingModels = models;
    return;
  }
  container.isRendering = true;
  
  const currentModels = container.currentModels || [];
  // Detect append-only updates BEFORE sorting/stringifying all IDs (was O(n log n) per chunk → multi-second freezes).
  const progressiveAppend =
    currentModels.length > 0 &&
    models.length > currentModels.length &&
    isProgressiveModelListExtension(currentModels, models);

  if (progressiveAppend) {
    const prevAnalysis = window.modelFieldAnalysis || analyzeModelFields(currentModels);
    if (prevAnalysis.hasDesigner && prevAnalysis.hasSource && prevAnalysis.hasParentModel &&
        prevAnalysis.hasLicense && prevAnalysis.hasTags) {
      window.modelFieldAnalysis = prevAnalysis;
    } else {
      const tail = models.slice(currentModels.length);
      window.modelFieldAnalysis = mergeModelFieldAnalysis(prevAnalysis, analyzeModelFields(tail));
    }
  } else {
    window.modelFieldAnalysis = analyzeModelFields(models);
  }

  let modelsSetChanged;
  let orderChanged;
  if (progressiveAppend) {
    modelsSetChanged = false;
    orderChanged = false;
  } else {
    const currentModelIds = currentModels.map(m => m.id || m.filePath).sort();
    const newModelIds = models.map(m => m.id || m.filePath).sort();
    modelsSetChanged = JSON.stringify(currentModelIds) !== JSON.stringify(newModelIds);
    const currentModelIdsOrdered = currentModels.map(m => m.id || m.filePath);
    const newModelIdsOrdered = models.map(m => m.id || m.filePath);
    orderChanged = JSON.stringify(currentModelIdsOrdered) !== JSON.stringify(newModelIdsOrdered);
  }

  // Models changed if either the set changed or the order changed (unless only appending to the list)
  const modelsChanged = (modelsSetChanged || orderChanged) && !progressiveAppend;
  
  // Only clear if models actually changed
  if (modelsChanged) {
    console.log('renderVirtualGrid: Models changed! Clearing container and re-rendering.');
    console.log('Current model count:', currentModels.length, 'New model count:', models.length);
    container.innerHTML = ''; // clear existing content
    // Drop queued hydrate jobs whose cells were just destroyed (in-flight jobs keep pending).
    pruneDisconnectedRenderTasks();
    
    // Add header for list view
    if (currentGridView === 'list') {
      const header = createListViewHeader();
      container.appendChild(header);
      // Update sort indicators after header is created
      if (header.updateSortIndicators) {
        header.updateSortIndicators();
      }
    }
  }
  container.currentModels = models;
  
  // Check if grid structure already exists
  let spacer = container.querySelector('.virtual-spacer');
  let virtualContent = container.querySelector('.virtual-content');
  let listHeader = container.querySelector('.list-view-header');
  
  // Ensure header exists for list view (in case it was removed)
  if (currentGridView === 'list' && !listHeader) {
    const header = createListViewHeader();
    // Insert header before spacer or at the beginning
    if (spacer) {
      container.insertBefore(header, spacer);
    } else {
      container.appendChild(header);
    }
    // Update sort indicators after header is created
    if (header.updateSortIndicators) {
      header.updateSortIndicators();
    }
  } else if (currentGridView === 'list' && listHeader && listHeader.updateSortIndicators) {
    // Update sort indicators for existing header
    listHeader.updateSortIndicators();
  }
  
  // Remove header if not in list view
  if (currentGridView !== 'list' && listHeader) {
    listHeader.remove();
  }
  
  // If grid structure exists and models haven't changed, just trigger re-render
  // But if order changed, we need to re-render even if the set is the same
  if (spacer && virtualContent && !modelsChanged) {
    container.isRendering = false;
    // Store renderVisibleItems function reference if it exists
    if (container.renderVisibleItemsFn) {
      container.renderVisibleItemsFn();
    }
    // Process any pending render
    if (container.pendingModels) {
      const pending = container.pendingModels;
      container.pendingModels = null;
      container.isRendering = false;
      renderVirtualGrid(pending);
    }
    return;
  }
  
  container.style.position = 'relative';
  container.style.overflowY = 'auto';
  container.style.overflowX = 'hidden';
  container.style.display = 'block'; // Override CSS grid display for virtual scrolling
  
  // Calculate proper height based on viewport, accounting for any headers/footers
  const containerRect = container.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const containerTop = containerRect.top;
  container.style.height = `calc(100vh - ${containerTop}px)`;
  container.style.maxHeight = `calc(100vh - ${containerTop}px)`;

  // Assume fixed item size (in pixels) - optimized gaps
  const paddingVertical = currentGridView === 'preview' ? 8 : 10;
  const paddingHorizontal = currentGridView === 'preview' ? 0 : 20;
  // Different gaps for different views - optimized for better visual spacing
  let verticalGap, horizontalGap;
  if (currentGridView === 'list') {
    verticalGap = 4; // Slight padding between list items
    horizontalGap = 0;
  } else if (currentGridView === 'preview') {
    verticalGap = 2;
    horizontalGap = 2;
  } else {
    // Detailed view: improved spacing for better visual hierarchy
    verticalGap = 28; // Better vertical spacing between rows with slight bottom padding
    horizontalGap = 20; // Consistent horizontal spacing
  }

  const containerWidth = container.clientWidth;
  const previewAvailableW = containerWidth - paddingHorizontal * 2;
  let previewTilePx = null;
  if (currentGridView === 'preview') {
    previewTilePx = computePreviewTilePxFromWidth(previewAvailableW, horizontalGap);
    container._previewTilePx = previewTilePx;
    container.style.setProperty('--preview-tile', `${previewTilePx}px`);
  } else {
    delete container._previewTilePx;
  }

  // Define item dimensions based on view mode
  const viewDimensions = {
    'list': { width: '100%', height: 52, itemWidth: '100%' },
    'preview':
      currentGridView === 'preview' && previewTilePx != null
        ? { width: previewTilePx, height: previewTilePx, itemWidth: previewTilePx }
        : getPreviewTileDims(),
    'detailed': { width: 300, height: 490, itemWidth: 300 }
  };

  const dimensions = viewDimensions[currentGridView] || viewDimensions['detailed'];
  const itemWidth = dimensions.itemWidth;   // fixed model width
  const itemHeight = dimensions.height;  // fixed model height
  const itemHeightWithGap = itemHeight + verticalGap; // Total height including gap

  // Calculate number of columns (at least 1), accounting for padding.
  // Group headers are laid out after this because they span the full row.
  let columns;
  if (currentGridView === 'list') {
    columns = 1;
  } else if (currentGridView === 'preview') {
    // Keep fixed column count by preview size; tile dimensions scale to fit width.
    columns = PREVIEW_COLUMNS[currentPreviewTileSize] || PREVIEW_COLUMNS.m;
  } else {
    // For detailed view, calculate columns and center the grid
    const availableWidth = containerWidth - (paddingHorizontal * 2);
    columns = Math.max(Math.floor(availableWidth / itemWidth), 1);
    
    // Center the grid if we have fewer columns than would fill the width
    if (currentGridView === 'detailed') {
      const totalItemsWidth = columns * itemWidth;
      const totalGapsWidth = (columns - 1) * horizontalGap;
      const usedWidth = totalItemsWidth + totalGapsWidth;
      const leftOffset = (availableWidth - usedWidth) / 2;
      // Store offset for positioning items
      container._centeredOffset = leftOffset;
    } else {
      container._centeredOffset = 0;
    }
  }

  const displayRecords = buildParentModelDisplayRecords(models);
  const initialLayout = buildParentModelLayoutRows(displayRecords, columns, currentGridView, itemHeight, paddingVertical, verticalGap);
  container.currentDisplayRecords = displayRecords;

  // Create a spacer element of full height to allow scrolling
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'virtual-spacer';
    spacer.style.width = '100%';
    spacer.style.position = 'relative';
    container.appendChild(spacer);
  }
  // Calculate total height including variable-height group rows.
  spacer.style.height = initialLayout.totalHeight + 'px';
  
  // Position spacer below header for list view
  if (currentGridView === 'list' && spacer) {
    spacer.style.marginTop = '0';
  }

  // Create an absolutely positioned element within the container to hold the items
  if (!virtualContent) {
    virtualContent = document.createElement('div');
    virtualContent.className = 'virtual-content';
    virtualContent.style.position = 'absolute';
    virtualContent.style.left = '0';
    virtualContent.style.width = '100%';
    virtualContent.style.height = '100%';
    virtualContent.style.pointerEvents = 'none'; // Let clicks pass through to items
    container.appendChild(virtualContent);
  }
  
  // Adjust virtual content top position for list view header (always update, not just on creation)
  if (currentGridView === 'list') {
    virtualContent.style.top = '40px'; // Header height (36px + 4px margin)
  } else {
    virtualContent.style.top = '0';
  }

  // Store the resize observer to disconnect later if needed
  if (container.resizeObserver) {
    container.resizeObserver.disconnect();
  }

  // Throttle render function to prevent excessive re-renders
  let renderTimeout = null;
  let isRendering = false;
  
  // Function to (re)render only the visible rows (plus a small buffer)
  function renderVisibleItems() {
    // Cancel any pending render
    if (renderTimeout) {
      cancelAnimationFrame(renderTimeout);
    }
    
    // Skip if already rendering
    if (isRendering) return;
    
    // Use currentModels from container to ensure we have the latest data
    // This is critical for showing updated metadata after edits
    const currentModels = container.currentModels || models;
    
    // Recalculate values each time to ensure we use current view settings
    let currentVerticalGap, currentHorizontalGap;
    if (currentGridView === 'list') {
      currentVerticalGap = 4;
      currentHorizontalGap = 0;
    } else if (currentGridView === 'preview') {
      currentVerticalGap = 2;
      currentHorizontalGap = 2;
    } else {
      // Detailed view: gap between rows
      currentVerticalGap = 20;
      currentHorizontalGap = 20;
    }
    
    // Use requestAnimationFrame for smooth updates
    renderTimeout = requestAnimationFrame(() => {
      isRendering = true;
      
      try {
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;

        // Recalculate columns in case of resize
        const currentContainerWidth = container.clientWidth;
        let effectivePreviewTilePx = itemWidth;
        let effectiveItemHeight = itemHeight;
        let currentColumns;
        if (currentGridView === 'list') {
          currentColumns = 1;
        } else if (currentGridView === 'preview') {
          const currentAvailableWidth = currentContainerWidth - (paddingHorizontal * 2);
          effectivePreviewTilePx = computePreviewTilePxFromWidth(currentAvailableWidth, currentHorizontalGap);
          container._previewTilePx = effectivePreviewTilePx;
          container.style.setProperty('--preview-tile', `${effectivePreviewTilePx}px`);
          effectiveItemHeight = effectivePreviewTilePx;
          currentColumns = PREVIEW_COLUMNS[currentPreviewTileSize] || PREVIEW_COLUMNS.m;
        } else {
          const currentAvailableWidth = currentContainerWidth - (paddingHorizontal * 2);
          currentColumns = Math.max(Math.floor(currentAvailableWidth / itemWidth), 1);
          
          // Center the grid for detailed view
          if (currentGridView === 'detailed') {
            const totalItemsWidth = currentColumns * itemWidth;
            const totalGapsWidth = (currentColumns - 1) * currentHorizontalGap;
            const usedWidth = totalItemsWidth + totalGapsWidth;
            const leftOffset = (currentAvailableWidth - usedWidth) / 2;
            container._centeredOffset = leftOffset;
          } else {
            container._centeredOffset = 0;
          }
        }

        const currentDisplayRecords = buildParentModelDisplayRecords(currentModels);
        const layoutRowHeight =
          currentGridView === 'preview' ? effectiveItemHeight : itemHeight;
        const layout = buildParentModelLayoutRows(
          currentDisplayRecords,
          currentColumns,
          currentGridView,
          layoutRowHeight,
          paddingVertical,
          currentVerticalGap
        );
        container.currentDisplayRecords = currentDisplayRecords;
        spacer.style.height = layout.totalHeight + 'px';

        const groupH =
          currentGridView === 'preview' ? effectivePreviewTilePx : getParentModelGroupHeight(currentGridView);
        const bufferPx = Math.max(layoutRowHeight, groupH) * 2;
        const visibleRows = layout.rows.filter(row => {
          return row.bottom >= scrollTop - bufferPx && row.top <= scrollTop + containerHeight + bufferPx;
        });

        // Track which items should be visible
        const visibleKeys = new Set();
        visibleRows.forEach(row => {
          if (row.type === 'group') {
            visibleKeys.add(row.key);
          } else {
            row.records.forEach(record => visibleKeys.add(record.key));
          }
        });

        // Remove items that are no longer visible
        const existingItems = Array.from(virtualContent.children);
        existingItems.forEach(item => {
          const layoutKey = item.dataset.layoutKey;
          if (!layoutKey || !visibleKeys.has(layoutKey)) {
            item.remove();
          }
        });
        // Drop queued thumbnail work for cells that scrolled off-screen so
        // Docker/server mode does not keep extracting 3MF images / WebGL-rendering them.
        pruneDisconnectedRenderTasks();
        refreshThumbnailQueuePriorities();

        const findExistingLayoutItem = (layoutKey) => {
          return Array.from(virtualContent.children).find(item => item.dataset.layoutKey === layoutKey) || null;
        };

        const positionModelItem = (item, row, col) => {
          item.style.top = row.top + 'px';
          if (currentGridView === 'list') {
            item.style.left = paddingHorizontal + 'px';
            item.style.width = `calc(100% - ${paddingHorizontal * 2}px)`;
          } else if (currentGridView === 'preview') {
            const w = effectivePreviewTilePx;
            const leftPosition = (col * (w + currentHorizontalGap)) + paddingHorizontal;
            item.style.left = leftPosition + 'px';
            item.style.width = w + 'px';
            item.style.height = w + 'px';
            item.style.minHeight = w + 'px';
            item.style.maxHeight = w + 'px';
          } else {
            const centeredOffset = container._centeredOffset || 0;
            const leftPosition = (col * (itemWidth + currentHorizontalGap)) + paddingHorizontal + centeredOffset;
            item.style.left = leftPosition + 'px';
            item.style.width = typeof itemWidth === 'number' ? itemWidth + 'px' : itemWidth;
          }
        };

        const positionGroupItem = (item, row) => {
          item.style.top = row.top + 'px';
          item.style.left = paddingHorizontal + 'px';
          item.style.width = `calc(100% - ${paddingHorizontal * 2}px)`;
          item.style.height = row.height + 'px';
        };

        const applyParentGroupHighlightClasses = (item, record, recordIndex) => {
          item.classList.remove(
            'parent-model-group-child',
            'parent-model-group-child-start',
            'parent-model-group-child-middle',
            'parent-model-group-child-end',
            'parent-model-group-child-single'
          );
          delete item.dataset.parentGroupKey;

          const parentGroupKey = record.parentGroupKey;
          if (!parentGroupKey) return;

          item.classList.add('parent-model-group-child');
          item.dataset.parentGroupKey = parentGroupKey;

          const prevRecord = recordIndex > 0 ? currentDisplayRecords[recordIndex - 1] : null;
          const nextRecord = recordIndex < currentDisplayRecords.length - 1 ? currentDisplayRecords[recordIndex + 1] : null;
          const hasPrevInGroup = prevRecord?.parentGroupKey === parentGroupKey;
          const hasNextInGroup = nextRecord?.parentGroupKey === parentGroupKey;

          if (!hasPrevInGroup && !hasNextInGroup) {
            item.classList.add('parent-model-group-child-single');
          } else if (!hasPrevInGroup) {
            item.classList.add('parent-model-group-child-start');
          } else if (!hasNextInGroup) {
            item.classList.add('parent-model-group-child-end');
          } else {
            item.classList.add('parent-model-group-child-middle');
          }
        };

        // Add or update visible items
        for (const row of visibleRows) {
          if (row.type === 'group') {
            const existingGroup = findExistingLayoutItem(row.key);
            if (existingGroup &&
                existingGroup.dataset.childCount === String(row.record.children.length) &&
                existingGroup.dataset.expanded === (row.record.expanded ? '1' : '0')) {
              positionGroupItem(existingGroup, row);
              continue;
            }
            if (existingGroup) existingGroup.remove();

            const item = createParentModelGroupItem(row.record, currentGridView);
            item.dataset.layoutKey = row.key;
            item.style.position = 'absolute';
            item.style.pointerEvents = 'auto';
            positionGroupItem(item, row);
            virtualContent.appendChild(item);
            continue;
          }

          for (let col = 0; col < row.records.length; col++) {
            const record = row.records[col];
            const recordIndex = currentDisplayRecords.indexOf(record);
            const existingItem = findExistingLayoutItem(record.key);

            if (record.type === 'group') {
              if (existingItem &&
                  existingItem.dataset.childCount === String(record.children.length) &&
                  existingItem.dataset.expanded === (record.expanded ? '1' : '0')) {
                positionModelItem(existingItem, row, col);
                continue;
              }
              if (existingItem) existingItem.remove();

              const item = createParentModelGroupItem(record, currentGridView);
              item.dataset.layoutKey = record.key;
              item.style.position = 'absolute';
              positionModelItem(item, row, col);
              item.style.pointerEvents = 'auto';
              virtualContent.appendChild(item);
              continue;
            }

            const model = record.model;
            const listHeaderOffset = currentGridView === 'list' ? 40 : 0;
            const itemContentY = listHeaderOffset + row.top;
            const thumbPriority = computeThumbPriorityForScroll(
              scrollTop,
              containerHeight,
              itemContentY,
              layoutRowHeight,
              col
            );

            if (existingItem) {
              const existingFilePath = existingItem.getAttribute('data-filepath');
              const normalizedExistingPath = normalizePathForComparison(existingFilePath);
              const normalizedExpectedPath = normalizePathForComparison(model.filePath);
              if (normalizedExistingPath === normalizedExpectedPath) {
                applyParentGroupHighlightClasses(existingItem, record, recordIndex);
                positionModelItem(existingItem, row, col);
                syncModelNewBadge(existingItem, model);
                // On-screen placeholders must re-enter the queue after prune/soft-cap;
                // recycled DOM nodes skip createModelItem so nothing else would enqueue them.
                if (thumbPriority < THUMB_PRIORITY_LOW_TIER_MIN) {
                  ensureVisibleThumbnailQueued(existingItem, model, thumbPriority);
                } else {
                  const queued = findQueuedThumbnailTask(model.filePath);
                  if (queued) {
                    const tc = existingItem.querySelector('.thumbnail-container');
                    if (tc) queued.container = tc;
                    queued.thumbPriority = thumbPriority;
                  }
                }
                continue;
              }
              existingItem.remove();
            }

            // Create new item — prioritize thumbnails for cells in/near the viewport
            const item = createModelItem(model, currentGridView, thumbPriority);
            item.dataset.index = String(recordIndex);
            item.dataset.layoutKey = record.key;
            applyParentGroupHighlightClasses(item, record, recordIndex);
            item.style.position = 'absolute';
            // Note: Header offset is handled by virtualContent top position for list view
            positionModelItem(item, row, col);
            item.style.pointerEvents = 'auto'; // Re-enable pointer events for items

            virtualContent.appendChild(item);
          }
        }
      } finally {
        isRendering = false;
        renderTimeout = null;
        refreshThumbnailQueuePriorities();
        processRenderQueue();
      }
    });


  }

  // Throttled scroll handler to prevent excessive renders
  let scrollTimeout = null;
  function throttledScrollHandler() {
    if (scrollTimeout) return;
    scrollTimeout = requestAnimationFrame(() => {
      renderVisibleItems();
      scrollTimeout = null;
    });
  }
  
  // Attach the scroll event handler to update visible items on scroll
  container.removeEventListener('scroll', container.virtualScrollHandler);
  container.virtualScrollHandler = throttledScrollHandler;
  container.addEventListener('scroll', throttledScrollHandler, { passive: true });

  // Throttled resize handler
  let resizeTimeout = null;
  function throttledResizeHandler() {
    if (resizeTimeout) {
      cancelAnimationFrame(resizeTimeout);
    }
    resizeTimeout = requestAnimationFrame(() => {
      renderVisibleItems();
      resizeTimeout = null;
    });
  }
  
  // Handle window resize
  if (container.resizeObserver) {
    container.resizeObserver.disconnect();
  }
  container.resizeObserver = new ResizeObserver(throttledResizeHandler);
  container.resizeObserver.observe(container);

  // Store renderVisibleItems function reference for later use
  container.renderVisibleItemsFn = renderVisibleItems;
  
  // Mark rendering as complete
  container.isRendering = false;
  
  // Process any pending render
  if (container.pendingModels) {
    const pending = container.pendingModels;
    container.pendingModels = null;
    renderVirtualGrid(pending);
    return;
  }
  
  // Initial render of visible items
  renderVisibleItems();
}
// ==================== END NEW CODE ====================

// Change the multi-source event listener from 'change' back to 'input' with debounce
document.getElementById('multi-source')?.addEventListener('input', debounce(async (e) => {
  console.log(`Saving source value: "${e.target.value}"`);
  await autoSaveMultipleModels('source', e.target.value);
}, 500));


window.renderFiles = renderFiles;
window.displayModels = displayModels;
window.syncSelectionWithFilteredModels = syncSelectionWithFilteredModels;
window.resetFilterSelectionAndDetails = resetFilterSelectionAndDetails;
window.clearModelDetailsSidebar = clearModelDetailsSidebar;
