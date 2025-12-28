// Frontend API Bridge
const socket = io();

window.electron = {
  // --- Core / File System ---
  loadDirectory: async () => {
    // Return stored directory from settings (fetch from API)
    return null; // Todo
  },

  openFileDialog: async () => {
    const path = prompt("Enter directory path to scan (local path on server):");
    return path ? [path] : [];
  },

  openFolderDialog: async (title) => {
    const path = prompt(title || "Enter folder path (local path on server):");
    return { canceled: !path, filePaths: path ? [path] : [] };
  },

  saveDirectory: async (directoryPath) => {
    // Save to settings API
    return true;
  },

  scanDirectory: async (directoryPath) => {
    const response = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directoryPath })
    });
    return response.json();
  },

  // --- Model Management ---
  getAllModels: async (sortOption, limit) => {
    let url = '/api/models';
    const params = [];
    if (sortOption) params.push(`sort=${sortOption}`);
    if (limit) params.push(`limit=${limit}`);
    if (params.length > 0) url += '?' + params.join('&');
    const response = await fetch(url);
    return response.json();
  },

  getModelsFiltered: async (filters) => {
    const response = await fetch('/api/models/filter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(filters)
    });
    return response.json();
  },

  getModel: async (filePath) => {
    const res = await fetch('/api/models/lookup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ filePath })
    });
    const data = await res.json();
    if (!data.uuid) return null;

    const modelRes = await fetch(`/api/models/${data.uuid}`);
    return modelRes.json();
  },

  saveModel: async (model) => {
    // In a real implementation this would POST to update the model
    // For now we assume optimistic UI updates or specific API endpoints exist
    // If there isn't a generic saveModel endpoint, we might need specific ones.
    // Assuming backend support or todo.
    // Based on renderer usage, it sends full model object.
    // We'll stub it for now or assume a route.
    console.log('saveModel called', model);
    return true;
  },

  updateModelsBatch: async (models) => {
    console.log('updateModelsBatch called', models.length);
    return true;
  },

  deleteFile: async (filePath) => {
     console.log('deleteFile called', filePath);
     // Implement API call if backend supports it
     return true;
  },

  // --- File Content / Stats ---
  getFileUrl: async (filePath) => {
      // Handle zip entry
      let lookupPath = filePath;
      let entryPath = null;
      if (filePath.includes('::')) {
          [lookupPath, entryPath] = filePath.split('::');
      }

      const res = await fetch('/api/models/lookup', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({ filePath: lookupPath })
      });
      const data = await res.json();
      if (!data.uuid) return null;

      let url = `/api/files/${data.uuid}/content`;
      if (entryPath) {
          url += `?entry=${encodeURIComponent(entryPath)}`;
      }
      return url;
  },

  extractModelFromZip: async (filePath) => {
      // Return the path as is, let getFileUrl handle it
      return filePath;
  },

  get3MFImages: async (filePath) => {
      // Todo: implement on server
      return [];
  },

  getFileStats: async (filePath) => {
      // Mock stats
      return { size: 1024 * 1024 }; // 1MB
  },

  calculateFileHash: async (filePath) => {
      return null;
  },

  getTotalModelCount: async () => {
    return Promise.resolve(0);
  },

  getModelsWithoutHash: async () => {
      return Promise.resolve(0);
  },

  // --- Thumbnails ---
  getThumbnail: async (filePath) => {
      // Similar logic to getFileUrl but for thumbnail endpoint if separate
      return null;
  },

  getAllThumbnails: async (filePath) => {
      return [];
  },

  saveThumbnail: async (filePath, thumbnailData) => {
      console.log('saveThumbnail called');
      return true;
  },

  setDefaultThumbnail: async (filePath, index) => {
      return true;
  },

  // --- Events (Socket.io) ---
  on: (channel, callback) => {
    socket.on(channel, callback);
  },

  send: (channel, data) => {
    socket.emit(channel, data);
  },

  onScanProgress: (callback) => {
    socket.on('scan-progress', callback);
  },

  onDbProgress: (callback) => {
    // For now map to scan-progress or ignore
  },

  onHashGenerationProgress: (callback) => {
      socket.on('hash-generation-progress', callback);
  },

  generateMissingHashes: async () => {
      console.log('generateMissingHashes called');
  },

  isGeneratingHashes: async () => {
      return false;
  },

  // --- Settings ---
  getSetting: async (key) => {
      // Mock or fetch
      if (key === 'modelBackgroundColor') return '#1a1a1a';
      if (key === 'betaOptIn') return 'false';
      if (key === 'currentVersion') return '1.22.1';
      return null;
  },

  saveSetting: async (key, value) => {
      return true;
  },

  onOpenSettings: (callback) => {
      socket.on('open-settings', callback);
  },

  // --- Updates ---
  checkForUpdates: async (isBeta) => {
      return Promise.resolve(null);
  },

  openUpdatePage: async (isBeta) => {
      console.log('openUpdatePage called');
  },

  // --- Slicers ---
  getSlicers: async () => {
      return Promise.resolve([]);
  },

  clearAndSaveSlicers: async (slicers) => {
      return Promise.resolve();
  },

  openSlicerDialog: async (title) => {
      return Promise.resolve({ canceled: true, filePaths: [] });
  },

  onOpenSlicerSettings: (callback) => {
      socket.on('open-slicer-settings', callback);
  },

  // --- Metadata (Tags, Designers, etc.) ---
  getDesigners: async () => {
      const res = await fetch('/api/metadata/designers');
      return res.json();
  },

  getLicenses: async () => {
      return [];
  },

  getParentModels: async () => {
      return [];
  },

  getAllTags: async () => {
      return [];
  },

  getModelTags: async (id) => {
      // Implement if API exists
      return [];
  },

  saveTag: async (name) => {
      console.log('saveTag', name);
      return { name, id: Date.now() };
  },

  deleteTag: async (id) => {
      console.log('deleteTag', id);
      return true;
  },

  onOpenTagManager: (callback) => {
      socket.on('open-tag-manager', callback);
  },

  // Metadata Editor
  onOpenMetadataEditor: (callback) => {
      socket.on('open-metadata-editor', callback);
  },

  getAllMetadata: async () => {
      return [];
  },

  renameMetadata: async (type, oldName, newName) => {
      console.log('renameMetadata', type, oldName, newName);
      return true;
  },

  deleteMetadata: async (type, name) => {
       console.log('deleteMetadata', type, name);
       return true;
  },

  // --- Database / Backup ---
  backupDatabase: async () => {
      return Promise.resolve(true);
  },

  restoreDatabase: async () => {
      return Promise.resolve(true);
  },

  onOpenBackupRestore: (callback) => {
      socket.on('open-backup-restore', callback);
  },

  // --- De-duplication ---
  getDuplicates: async (includeZip) => {
      return {};
  },

  onOpenDeDup: (callback) => {
      socket.on('open-dedup', callback);
  },

  onOpenPurgeModels: (callback) => {
      socket.on('open-purge-models', callback);
  },

  // --- UI / Misc ---
  showMessage: async (title, message, buttons) => {
      const result = confirm(`${title}\n\n${message}`);
      if (buttons && buttons.length > 0) {
          // Rudimentary mapping: Yes/No -> confirm result
          if (buttons.includes('Yes') && result) return 'Yes';
          if (buttons.includes('No') && !result) return 'No';
          return result ? buttons[0] : (buttons[1] || null);
      }
      return result;
  },

  showInputDialog: async (options) => {
      return prompt(options.message, options.defaultValue || '');
  },

  showContextMenu: async (filePath) => {
      console.log('showContextMenu', filePath);
  },

  openPath: async (path) => {
      alert(`Cannot open local path on server: ${path}`);
  },

  showItemInFolder: async (path) => {
      alert(`Cannot show item on server: ${path}`);
  },

  onOpenAbout: (callback) => {
      socket.on('open-about', callback);
  },

  quitApp: () => {
      console.log('quitApp called');
  },

  fetchThangsPage: async (url) => {
      return null;
  },

  fetchMakerWorldPage: async (url) => {
      return null;
  }
};

// Expose socket for direct usage if needed
window.socket = socket;
