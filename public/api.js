// Frontend API Bridge
const socket = io();

window.electron = {
  loadDirectory: async () => {
    // Return stored directory from settings (fetch from API)
    return null; // Todo
  },

  openFileDialog: async () => {
    const path = prompt("Enter directory path to scan (local path on server):");
    return path ? [path] : [];
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

  getAllModels: async (sortOption, limit) => {
    const response = await fetch(`/api/models?sort=${sortOption}&limit=${limit}`);
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

  // Events
  onScanProgress: (callback) => {
    socket.on('scan-progress', callback);
  },

  onDbProgress: (callback) => {
    // For now map to scan-progress or ignore
  },

  // ... (implement other methods as needed)

  // Settings
  getSetting: async (key) => {
      // Mock or fetch
      if (key === 'modelBackgroundColor') return '#1a1a1a';
      return null;
  },

  saveSetting: async (key, value) => {
      return true;
  },

  // Metadata
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

  // File ops
  openPath: async (path) => {
      alert(`Cannot open local path on server: ${path}`);
  },

  showItemInFolder: async (path) => {
      alert(`Cannot show item on server: ${path}`);
  }
};

// Expose socket for direct usage if needed
window.socket = socket;
