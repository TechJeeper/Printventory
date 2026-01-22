const { contextBridge, ipcRenderer, shell } = require('electron');
const { version } = require('./package.json');

contextBridge.exposeInMainWorld('electron', {
  isServerMode: () => ipcRenderer.invoke('is-server-mode'),
  loadDirectory: () => ipcRenderer.invoke('load-directory'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveDirectory: (directoryPath) => ipcRenderer.invoke('save-directory', directoryPath),
  scanDirectory: (directoryPath) => ipcRenderer.invoke('scan-directory', directoryPath),
  getModel: (filePath) => ipcRenderer.invoke('get-model', filePath),
  getModelsFiltered: (filters) => ipcRenderer.invoke('get-models-filtered', filters),
  saveModel: (modelData) => ipcRenderer.invoke('save-model', modelData),
  saveModelBatch: (modelDataBatch) => ipcRenderer.invoke('save-model-batch', modelDataBatch),
  updateModelsBatch: (modelDataBatch) => ipcRenderer.invoke('update-models-batch', modelDataBatch),
  saveThumbnail: (filePath, thumbnail) => ipcRenderer.invoke('save-thumbnail', filePath, thumbnail),
  getDesigners: () => ipcRenderer.invoke('get-designers'),
  getLicenses: () => ipcRenderer.invoke('get-licenses'),
  getModelsByDesigner: (designer) => ipcRenderer.invoke('get-models-by-designer', designer),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  openPath: (path) => ipcRenderer.invoke('open-path', path),
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
  getSetting: (key) => ipcRenderer.invoke('get-setting', key),
  saveSetting: (key, value) => ipcRenderer.invoke('save-setting', key, value),
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
  purgeModels: () => ipcRenderer.invoke('purge-models'),
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
    ipcRenderer.on('scan-progress', (_, progress) => callback(progress));
  },
  onDbProgress: (callback) => {
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
  getThumbnail: (filePath) => ipcRenderer.invoke('getThumbnail', filePath),
  getAllThumbnails: (filePath) => ipcRenderer.invoke('get-all-thumbnails', filePath),
  addThumbnail: (filePath, imageDataUrl) => ipcRenderer.invoke('add-thumbnail', filePath, imageDataUrl),
  addMultipleThumbnails: (filePath, imageDataUrls) => ipcRenderer.invoke('add-multiple-thumbnails', filePath, imageDataUrls),
  setDefaultThumbnail: (filePath, index) => ipcRenderer.invoke('set-default-thumbnail', filePath, index),
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
    const validChannels = [
      'ping', 
      'open-ai-config', 
      'open-file-type-settings',
      'tags-generated', 
      'show-progress-dialog',
      'update-progress',
      'close-progress-dialog',
      'start-single-tag-generation',
      'start-batch-tag-generation',
      'batch-tag-generation-complete',
      'hash-generation-complete',
      'show-input-dialog',
      'puter-ai-chat-request',
      'regenerate-thumbnails',
      'generate-missing-thumbnails',
      /* other valid channels */
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
    if (channel === 'open-guide') {
      ipcRenderer.on(channel, (event) => callback());
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
  receive: (channel, callback) => {
    const validChannels = ['preview-model', 'download-model'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  }
});

contextBridge.exposeInMainWorld('electronAPI', {
  getDb: () => ipcRenderer.invoke('get-db'),
  // ... other exposed functions
});

