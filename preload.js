const { contextBridge, ipcRenderer, shell } = require('electron');
const { version } = require('./package.json');

// Track registered channels to prevent duplicates in hidden window
const registeredChannels = new Set();

// Check if we're in server mode (hidden window) - cache the result
let isServerModeCached = null;
let isServerModeCheckPending = false;

async function checkIsServerMode() {
  if (isServerModeCached !== null) {
    return isServerModeCached;
  }
  if (isServerModeCheckPending) {
    // Wait for pending check
    while (isServerModeCheckPending) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return isServerModeCached;
  }
  isServerModeCheckPending = true;
  try {
    isServerModeCached = await ipcRenderer.invoke('is-server-mode');
  } catch (error) {
    console.error('[Preload] Error checking server mode:', error);
    isServerModeCached = false; // Default to false (normal mode)
  }
  isServerModeCheckPending = false;
  return isServerModeCached;
}

// Wrap ipcRenderer.on to prevent preview-model listeners ONLY in server mode hidden window
// Only block if we're CERTAIN we're in server mode (cached = true)
// If not cached yet, allow through (normal mode needs to work immediately)
const originalOn = ipcRenderer.on.bind(ipcRenderer);
const previewModelListenerCount = { count: 0 };
ipcRenderer.on = function(channel, ...args) {
  // Only block preview-model and download-model if we're CERTAIN we're in server mode
  // In normal mode or if not cached yet, allow these listeners to register normally
  if ((channel === 'preview-model' || channel === 'download-model' || channel === 'preview-bundle-models') && isServerModeCached === true) {
    previewModelListenerCount.count++;
    console.warn(`[Preload] BLOCKED ipcRenderer.on('${channel}') call #${previewModelListenerCount.count} in server mode hidden window - events go to WebSocket clients`);
    return ipcRenderer; // Return ipcRenderer to allow chaining
  }
  // If not cached yet, check asynchronously but don't block (normal mode needs to work immediately)
  // The receive() and on() methods will handle the blocking properly for their specific cases
  if ((channel === 'preview-model' || channel === 'download-model' || channel === 'preview-bundle-models') && isServerModeCached === null) {
    checkIsServerMode().then(isServer => {
      if (isServer) {
        console.warn(`[Preload] Note: '${channel}' listener registered via direct ipcRenderer.on() in server mode - consider using receive() method`);
      }
    });
  }
  return originalOn(channel, ...args);
};

contextBridge.exposeInMainWorld('electron', {
  isServerMode: () => ipcRenderer.invoke('is-server-mode'),
  loadDirectory: () => ipcRenderer.invoke('load-directory'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveDirectory: (directoryPath) => ipcRenderer.invoke('save-directory', directoryPath),
  scanDirectory: (directoryPath, options) => ipcRenderer.invoke('scan-directory', directoryPath, options || {}),
  getModel: (filePath) => ipcRenderer.invoke('get-model', filePath),
  getModelsFiltered: (filters) => ipcRenderer.invoke('get-models-filtered', filters),
  saveModel: (modelData) => ipcRenderer.invoke('save-model', modelData),
  saveModelFromUpload: (payload) => ipcRenderer.invoke('save-model-from-upload', payload),
  saveModelBatch: (modelDataBatch) => ipcRenderer.invoke('save-model-batch', modelDataBatch),
  updateModelsBatch: (modelDataBatch) => ipcRenderer.invoke('update-models-batch', modelDataBatch),
  saveThumbnail: (filePath, thumbnail) => ipcRenderer.invoke('save-thumbnail', filePath, thumbnail),
  getDesigners: () => ipcRenderer.invoke('get-designers'),
  getLicenses: () => ipcRenderer.invoke('get-licenses'),
  getModelsByDesigner: (designer) => ipcRenderer.invoke('get-models-by-designer', designer),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
  executeClientCommand: (commandData) => ipcRenderer.invoke('execute-client-command', commandData),
  getAllModels: (sortOption, limit) => ipcRenderer.invoke('get-all-models', sortOption, limit),
  getTotalModelCount: () => ipcRenderer.invoke('getTotalModelCount'),
  getParentModels: () => ipcRenderer.invoke('get-parent-models'),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  saveTag: (tagName) => ipcRenderer.invoke('save-tag', tagName),
  deleteTag: (tagId) => ipcRenderer.invoke('delete-tag', tagId),
  getTagModelCount: (tagId) => ipcRenderer.invoke('get-tag-model-count', tagId),
  onOpenTagManager: (callback) => ipcRenderer.on('open-tag-manager', callback),
  getAllMetadata: () => ipcRenderer.invoke('get-all-metadata'),
  getStats: () => ipcRenderer.invoke('get-stats'),
  renameMetadata: (type, oldName, newName) => ipcRenderer.invoke('rename-metadata', type, oldName, newName),
  deleteMetadata: (type, name) => ipcRenderer.invoke('delete-metadata', type, name),
  onOpenMetadataEditor: (callback) => ipcRenderer.on('open-metadata-editor', callback),
  getModelTags: (modelId) => ipcRenderer.invoke('get-model-tags', modelId),
  saveModelTags: (modelId, tagIds) => ipcRenderer.invoke('save-model-tags', modelId, tagIds),
  getAdditionalFileTypesCatalog: () => ipcRenderer.invoke('get-additional-file-types-catalog'),
  getModelCountByFileTypeIds: (catalogIds) => ipcRenderer.invoke('get-model-count-by-file-type-ids', catalogIds),
  removeModelsByFileTypeIds: (catalogIds) => ipcRenderer.invoke('remove-models-by-file-type-ids', catalogIds),
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
  getDefaultAIPrompt: () => ipcRenderer.invoke('get-default-ai-prompt'),
  startExtensionServer: (port) => ipcRenderer.invoke('start-extension-server', port),
  stopExtensionServer: () => ipcRenderer.invoke('stop-extension-server'),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  checkCollectUsage: () => ipcRenderer.invoke('check-collect-usage'),
  purgeThumbnails: () => ipcRenderer.invoke('purge-thumbnails'),
  onOpenSettings: (callback) => ipcRenderer.on('open-settings', callback),
  onOpenGuide: (callback) => ipcRenderer.on('open-guide', callback),
  trackEvent: (category, action, label, value) => ipcRenderer.invoke('track-event', category, action, label, value),
  onOpenAbout: (callback) => {
    ipcRenderer.on('open-about', async () => {
      await callback();
    });
  },
  onOpenKeyboardShortcuts: (callback) => ipcRenderer.on('open-keyboard-shortcuts', callback),
  onOpenServerModeInfo: (callback) => {
    ipcRenderer.on('open-server-mode-info', async () => {
      await callback();
    });
  },
  onOpenStats: (callback) => {
    ipcRenderer.on('open-stats', async () => {
      await callback();
    });
  },
  onOpenSystemReport: (callback) => {
    ipcRenderer.on('open-system-report', async () => {
      await callback();
    });
  },
  showMessage: (title, message, buttons) => ipcRenderer.invoke('show-message', title, message, buttons),
  showMessageBox: (options) => ipcRenderer.invoke('show-message-box', options),
  onOpenBackupRestore: (callback) => ipcRenderer.on('open-backup-restore', callback),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),
  exportLibrary: () => ipcRenderer.invoke('export-library'),
  importLibrary: () => ipcRenderer.invoke('import-library'),
  getDuplicateFiles: () => ipcRenderer.invoke('get-duplicate-files'),
  onOpenDeDup: (callback) => ipcRenderer.on('open-dedup', callback),
  checkFilesExist: (filePaths) => ipcRenderer.invoke('check-files-exist', filePaths),
  deleteFile: (filePath) => {
    console.log('preload: deleteFile called with:', filePath);
    return ipcRenderer.invoke('delete-file', filePath);
  },
  fetchThangsPage: (url) => ipcRenderer.invoke('fetch-thangs-page', url),
  purgeModels: (options) => ipcRenderer.invoke('purge-models', options || {}),
  onOpenPurgeModels: (callback) => ipcRenderer.on('open-purge-models', callback),
  onGenerateMissingThumbnails: (callback) => ipcRenderer.on('generate-missing-thumbnails', callback),
  onPingRequest: (callback) => ipcRenderer.on('ping', callback),
  showContextMenu: (filePath) => ipcRenderer.invoke('show-context-menu', filePath),
  executeContextMenuAction: (requestId, itemIndex, subIndex) => ipcRenderer.invoke('execute-context-menu-action', requestId, itemIndex, subIndex),
  onRefreshGrid: (callback) => ipcRenderer.on('refresh-grid', callback),
  onThumbnailAdded: (callback) => ipcRenderer.on('thumbnail-added', (event, data) => callback(data)),
  onOpenThemeSettings: (callback) => ipcRenderer.on('open-theme-settings', callback),
  quitApp: () => ipcRenderer.invoke('quitApp'),
  onOpenPerformanceSettings: (callback) => ipcRenderer.on('open-performance-settings', callback),
  get3MFImages: (filePath) => {
    console.log('preload: get3MFImages called with:', filePath);
    return ipcRenderer.invoke('get3MFImages', filePath);
  },
  get3MFSTL: (filePath) => {
    console.log('preload: get3MFSTL called with:', filePath);
    return ipcRenderer.invoke('get3MFSTL', filePath);
  },
  extractModelFromZip: (filePath) => ipcRenderer.invoke('extract-model-from-zip', filePath),
  extractZipArchive: (filePath, destinationPath) => ipcRenderer.invoke('extract-zip-archive', filePath, destinationPath),
  onScanProgress: (callback) => {
    // Avoid stacking duplicate listeners on each scan (would freeze UI / stale progress text)
    ipcRenderer.removeAllListeners('scan-progress');
    ipcRenderer.on('scan-progress', (_, progress) => callback(progress));
  },
  onDbProgress: (callback) => {
    ipcRenderer.removeAllListeners('db-progress');
    ipcRenderer.on('db-progress', (_, progress) => callback(progress));
  },
  onDbCleanup: (callback) => {
    ipcRenderer.on('db-cleanup', callback);
  },
  getDuplicates: (includeZip = false) => ipcRenderer.invoke('get-duplicates', includeZip),
  isGeneratingHashes: () => ipcRenderer.invoke('is-generating-hashes'),
  getModelsWithoutHash: () => ipcRenderer.invoke('getModelsWithoutHash'),
  generateMissingHashes: () => ipcRenderer.invoke('generateMissingHashes'),
  calculateFileHash: (filePath) => ipcRenderer.invoke('calculate-file-hash', filePath),
  onHashGenerationProgress: (callback) => {
    ipcRenderer.on('hash-generation-progress', (_, progress) => callback(progress));
  },
  onHashGenerationComplete: (callback) => {
    ipcRenderer.on('hash-generation-complete', (_, result) => callback(result || {}));
  },
  getThumbnail: (filePath) => ipcRenderer.invoke('getThumbnail', filePath),
  getAllThumbnails: (filePath) => ipcRenderer.invoke('get-all-thumbnails', filePath),
  addThumbnail: (filePath, imageDataUrl) => ipcRenderer.invoke('add-thumbnail', filePath, imageDataUrl),
  addMultipleThumbnails: (filePath, imageDataUrls) => ipcRenderer.invoke('add-multiple-thumbnails', filePath, imageDataUrls),
  setDefaultThumbnail: (filePath, index) => ipcRenderer.invoke('set-default-thumbnail', filePath, index),
  deleteThumbnail: (filePath, index) => ipcRenderer.invoke('delete-thumbnail', filePath, index),
  onStartPrintRoulette: (callback) => {
    ipcRenderer.on('start-print-roulette', callback);
  },
  checkForUpdates: (isBeta) => ipcRenderer.invoke('check-for-updates', isBeta),
  openUpdatePage: (isBeta) => ipcRenderer.invoke('open-update-page', isBeta),
  onOpenSTLHome: (callback) => ipcRenderer.on('open-stl-home', callback),
  send: (channel, ...args) => {
    // Optionally add a whitelist of channels if needed for security
    const validChannels = [
      'pong',
      'native-prompt-response',
      'puter-ai-chat-response'
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, ...args);
    } else {
      ipcRenderer.send(channel, ...args);
    }
  },
  on: (channel, callback) => {
    // Prevent preview-model and download-model registration ONLY in server mode hidden window
    // In normal mode, allow these to work normally
    if (channel === 'preview-model' || channel === 'download-model' || channel === 'preview-bundle-models') {
      // Check server mode - if true, block; if false/null, allow (normal mode)
      if (isServerModeCached === true) {
        console.warn(`[Preload] Blocking '${channel}' listener registration in server mode hidden window - use receive() method or events go to WebSocket clients`);
        return;
      }
      // If not cached yet, check asynchronously but don't block (normal mode needs to work)
      if (isServerModeCached === null) {
        checkIsServerMode();
      }
    }
    
    const validChannels = [
      'ping',
      'open-about',
      'open-ai-config',
      'open-file-type-settings',
      'open-browser-extension-settings',
      'open-settings',
      'open-guide',
      'open-keyboard-shortcuts',
      'open-server-mode-info',
      'open-stats',
      'open-system-report',
      'open-backup-restore',
      'open-dedup',
      'open-tag-manager',
      'open-purge-models',
      'open-metadata-editor',
      'open-theme-settings',
      'open-performance-settings',
      'open-slicer-settings',
      'open-manage-thumbnails',
      'tags-generated',
      'show-progress-dialog',
      'update-progress',
      'close-progress-dialog',
      'start-single-tag-generation',
      'start-batch-tag-generation',
      'batch-tag-generation-complete',
      'hash-generation-progress',
      'hash-generation-complete',
      'show-input-dialog',
      'puter-ai-chat-request',
      'regenerate-thumbnails',
      'generate-missing-thumbnails',
      'thumbnail-deleted',
      'manage-thumbnails-request',
      'execute-client-command',
      'download-model',
      'start-print-roulette',
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },
  invoke: (channel, data) => {
    const validChannels = [
      'show-input-dialog',
      // ... other valid channels ...
    ];
    if (validChannels.includes(channel)) {
      return ipcRenderer.invoke(channel, data);
    }
    return ipcRenderer.invoke(channel, data);
  },
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openSlicerDialog: (title) => ipcRenderer.invoke('open-slicer-dialog', title),
  testAIConfig: (apiKey, baseURL, model, service) => ipcRenderer.invoke('test-ai-config', apiKey, baseURL, model, service),
  generateTags: (filePath) => ipcRenderer.invoke('generate-tags', filePath),
  puterAIChat: (prompt, imageUrl, model) => ipcRenderer.invoke('puter-ai-chat', prompt, imageUrl, model),
  getModelsWithoutThumbnails: () => ipcRenderer.invoke('get-models-without-thumbnails'),
  getModelsWithDefaultThumbnails: () => ipcRenderer.invoke('get-models-with-default-thumbnails'),
  pong: () => ipcRenderer.send('pong'),
  fetchMakerWorldPage: (url) => ipcRenderer.invoke('fetch-makerworld-page', url),
  onOpenSlicerSettings: (callback) => ipcRenderer.on('open-slicer-settings', callback),
  getSlicers: () => ipcRenderer.invoke('get-slicers'),
  openFileInSlicer: (options) => ipcRenderer.invoke('open-file-in-slicer', options),
  saveSlicer: (slicer) => ipcRenderer.invoke('save-slicer', slicer),
  deleteSlicer: (id) => ipcRenderer.invoke('delete-slicer', id),
  clearAndSaveSlicers: (slicers) => ipcRenderer.invoke('clear-and-save-slicers', slicers),
  getAppVersion: () => version,
  getFileStats: (filePath) => ipcRenderer.invoke('get-file-stats', filePath),
  startTransaction: () => ipcRenderer.invoke('database:start-transaction'),
  commitTransaction: () => ipcRenderer.invoke('database:commit-transaction'),
  rollbackTransaction: () => ipcRenderer.invoke('database:rollback-transaction'),
  getAllModelReferences: () => ipcRenderer.invoke('get-all-model-references'),
  showInputDialog: (options) => ipcRenderer.invoke('show-input-dialog', options),
  pull3MFMetadata: (filePaths) => ipcRenderer.invoke('pull-3mf-metadata', filePaths),
  readModelFile: (filePath) => ipcRenderer.invoke('read-model-file', filePath),
  parse3MFPreview: (filePath, requestId) => ipcRenderer.invoke('parse-3mf-preview', filePath, requestId),
  cancel3MFPreview: (requestId) => ipcRenderer.invoke('cancel-3mf-preview', requestId),
  on3MFPreviewStatus: (callback) => ipcRenderer.on('3mf-preview-status', (event, requestId, message) => callback(requestId, message)),
  getGpuInfo: () => ipcRenderer.invoke('get-gpu-info'),
  benchmarkFilesystem: () => ipcRenderer.invoke('benchmark-filesystem'),
  benchmarkDatabase: () => ipcRenderer.invoke('benchmark-database'),
  receive: (channel, callback) => {
    const validChannels = ['preview-model', 'preview-bundle-models', 'download-model'];
    if (validChannels.includes(channel)) {
      // Prevent duplicate registrations regardless of mode - check FIRST
      if (registeredChannels.has(channel)) {
        console.warn(`[Preload] Duplicate receive() call for '${channel}' - ignoring (already registered)`);
        return;
      }
      
      // Mark as handled immediately to prevent race conditions
      registeredChannels.add(channel);
      
      // Check if we're in server mode (hidden window) - only block in server mode
      // Use async check but handle it properly
      checkIsServerMode().then(isServer => {
        if (isServer) {
          // This is the hidden window in server mode - don't register IPC listeners
          // Events go to browser clients via WebSocket, not to the hidden window
          const location = typeof window !== 'undefined' ? window.location : null;
          console.warn(`[Preload] Skipping IPC listener for '${channel}' in server mode hidden window (protocol: ${location?.protocol}, hostname: ${location?.hostname}) - events go to WebSocket clients`);
          return;
        }
        
        // Normal mode: register the listener
        const location = typeof window !== 'undefined' ? window.location : null;
        console.log(`[Preload] Registering IPC listener for '${channel}' in normal mode (protocol: ${location?.protocol}, hostname: ${location?.hostname})`);
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      }).catch(error => {
        // If check fails, assume normal mode and register (fail open for normal mode)
        console.warn(`[Preload] Error checking server mode, assuming normal mode:`, error);
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
      });
    }
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  getDb: () => ipcRenderer.invoke('get-db'),
  // ... other exposed functions
});

