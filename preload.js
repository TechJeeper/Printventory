const { contextBridge, ipcRenderer, shell } = require('electron');
const { version } = require('./package.json');

contextBridge.exposeInMainWorld('electron', {
  loadDirectory: () => ipcRenderer.invoke('load-directory'),
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  saveDirectory: (directoryPath) => ipcRenderer.invoke('save-directory', directoryPath),
  scanDirectory: (directoryPath) => ipcRenderer.invoke('scan-directory', directoryPath),
  getModel: (filePath) => ipcRenderer.invoke('get-model', filePath),
  saveModel: (modelData) => ipcRenderer.invoke('save-model', modelData),
  saveModelBatch: (modelDataBatch) => ipcRenderer.invoke('save-model-batch', modelDataBatch),
  saveThumbnail: (filePath, thumbnail) => ipcRenderer.invoke('save-thumbnail', filePath, thumbnail),
  getDesigners: () => ipcRenderer.invoke('get-designers'),
  getLicenses: () => ipcRenderer.invoke('get-licenses'),
  getModelsByDesigner: (designer) => ipcRenderer.invoke('get-models-by-designer', designer),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  getAllModels: (sortOption, limit) => ipcRenderer.invoke('get-all-models', sortOption, limit),
  getTotalModelCount: () => ipcRenderer.invoke('getTotalModelCount'),
  getParentModels: () => ipcRenderer.invoke('get-parent-models'),
  getAllTags: () => ipcRenderer.invoke('get-all-tags'),
  saveTag: (tagName) => ipcRenderer.invoke('save-tag', tagName),
  deleteTag: (tagId) => ipcRenderer.invoke('delete-tag', tagId),
  getTagModelCount: (tagId) => ipcRenderer.invoke('get-tag-model-count', tagId),
  onOpenTagManager: (callback) => ipcRenderer.on('open-tag-manager', callback),
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
  showMessage: (title, message, buttons) => ipcRenderer.invoke('show-message', title, message, buttons),
  onOpenBackupRestore: (callback) => ipcRenderer.on('open-backup-restore', callback),
  backupDatabase: () => ipcRenderer.invoke('backup-database'),
  restoreDatabase: () => ipcRenderer.invoke('restore-database'),
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
  showContextMenu: (filePath) => ipcRenderer.invoke('show-context-menu', filePath),
  onRefreshGrid: (callback) => ipcRenderer.on('refresh-grid', callback),
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
  onScanProgress: (callback) => {
    ipcRenderer.on('scan-progress', (_, progress) => callback(progress));
  },
  onDbProgress: (callback) => {
    ipcRenderer.on('db-progress', (_, progress) => callback(progress));
  },
  onDbCleanup: (callback) => {
    ipcRenderer.on('db-cleanup', callback);
  },
  getDuplicates: () => ipcRenderer.invoke('get-duplicates'),
  getThumbnail: (filePath) => ipcRenderer.invoke('getThumbnail', filePath),
  calculateMissingHashes: () => ipcRenderer.invoke('calculate-missing-hashes'),
  onHashCalculationProgress: (callback) => {
    ipcRenderer.on('hash-calculation-progress', (_, progress) => callback(progress));
  },
  onStartPrintRoulette: (callback) => {
    ipcRenderer.on('start-print-roulette', callback);
  },
  checkForUpdates: (isBeta) => ipcRenderer.invoke('check-for-updates', isBeta),
  openUpdatePage: (isBeta) => ipcRenderer.invoke('open-update-page', isBeta),
  onOpenSTLHome: (callback) => ipcRenderer.on('open-stl-home', callback),
  send: (channel, data) => {
    // Optionally add a whitelist of channels if needed for security
    ipcRenderer.send(channel, data);
  },
  on: (channel, callback) => {
    const validChannels = [
      'ping', 
      'open-ai-config', 
      'tags-generated', 
      'show-progress-dialog',
      'update-progress',
      'close-progress-dialog',
      /* other valid channels */
    ];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
    if (channel === 'open-guide') {
      ipcRenderer.on(channel, (event) => callback());
    }
  },
  invoke: (channel, data) => ipcRenderer.invoke(channel, data),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
  openSlicerDialog: (title) => ipcRenderer.invoke('open-slicer-dialog', title),
  testAIConfig: (apiKey, baseURL, model) => ipcRenderer.invoke('test-ai-config', apiKey, baseURL, model),
  generateTags: (filePath) => ipcRenderer.invoke('generate-tags', filePath),
  getModelsWithoutThumbnails: () => ipcRenderer.invoke('get-models-without-thumbnails'),
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
  onRegenerateThumbnails: (callback) => ipcRenderer.on('regenerate-thumbnails', callback)
});

contextBridge.exposeInMainWorld('electronAPI', {
  getDb: () => ipcRenderer.invoke('get-db'),
  // ... other exposed functions
});

