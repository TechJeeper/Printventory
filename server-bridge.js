// Server mode bridge - replaces window.electron when served via HTTP
(function() {
  'use strict';
  
  if (typeof window === 'undefined') return;
  
  // CRITICAL: Initialize window.electron immediately, before anything else
  // This prevents "Cannot read properties of undefined" errors
  if (!window.electron) {
    window.electron = {};
  }
  window._electronEventListeners = window._electronEventListeners || {};
  
  // Define on() method IMMEDIATELY so it's always available
  window.electron.on = function(channel, callback) {
    if (!window._electronEventListeners[channel]) {
      window._electronEventListeners[channel] = [];
    }
    window._electronEventListeners[channel].push(callback);
  };
  
  // Define send() method IMMEDIATELY
  window.electron.send = function(channel, ...args) {
    // Will be enhanced when WebSocket connects
    console.warn('window.electron.send called before WebSocket connected:', channel);
  };
  
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const pendingRequests = new Map();
  let requestIdCounter = 0;
  
  function connect() {
    try {
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('WebSocket connected to Printventory server');
        reconnectAttempts = 0;
      };
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'result') {
            const pending = pendingRequests.get(data.id);
            if (pending) {
              pending.resolve(data.result);
              pendingRequests.delete(data.id);
            }
          } else if (data.type === 'error') {
            const pending = pendingRequests.get(data.id);
            if (pending) {
              pending.reject(new Error(data.error));
              pendingRequests.delete(data.id);
            }
          } else if (data.type === 'event') {
            // Handle events (like 'refresh-grid', 'scan-progress', etc.)
            const eventListeners = window._electronEventListeners || {};
            const listeners = eventListeners[data.channel] || [];
            listeners.forEach(listener => {
              try {
                listener(...(data.args || []));
              } catch (error) {
                console.error('Error in event listener:', error);
              }
            });
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };
      
      ws.onclose = () => {
        console.log('WebSocket disconnected');
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          setTimeout(connect, 1000 * reconnectAttempts);
        }
      };
    } catch (error) {
      console.error('Error connecting WebSocket:', error);
    }
  }
  
  // Helper function to make IPC calls via WebSocket
  function makeIpcCall(channel, ...args) {
    // If WebSocket is not connected, try to connect
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      if (reconnectAttempts < maxReconnectAttempts) {
        connect();
        // Wait a bit for connection
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) {
              makeIpcCall(channel, ...args).then(resolve).catch(reject);
            } else {
              reject(new Error('WebSocket connection failed'));
            }
          }, 500);
        });
      } else {
        return Promise.reject(new Error('WebSocket connection unavailable'));
      }
    }
    
    const id = `req_${++requestIdCounter}_${Date.now()}`;
    
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      
      ws.send(JSON.stringify({
        id,
        channel,
        args
      }));
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new Error(`IPC call timeout: ${channel}`));
        }
      }, 30000);
    });
  }
  
  // Store original electron if it exists (for fallback)
  const originalElectron = window.electron || {};
  
  // Create window.electron bridge with all methods from preload.js
  // Initialize immediately to prevent undefined errors
  if (!window.electron) {
    window.electron = {};
  }
  window._electronEventListeners = window._electronEventListeners || {};
  
  // Generic on method for events - define FIRST so it's always available
  // This must be defined before any code tries to use it
  // Don't call original to avoid infinite recursion - we're replacing it entirely for server mode
  window.electron.on = function(channel, callback) {
    if (!window._electronEventListeners[channel]) {
      window._electronEventListeners[channel] = [];
    }
    window._electronEventListeners[channel].push(callback);
    // Don't call originalElectron.on - it would cause infinite recursion
  };
  
  // Also ensure send is available early
  window.electron.send = function(channel, ...args) {
    // Send events (fire and forget)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        id: `send_${++requestIdCounter}_${Date.now()}`,
        channel,
        args,
        type: 'send'
      }));
    }
    // Also call original if it exists
    if (originalElectron.send) {
      originalElectron.send.call(originalElectron, channel, ...args);
    }
  };
  
  // Map of method names to IPC channels (from preload.js)
  const methodToChannel = {
    'loadDirectory': 'load-directory',
    'openFileDialog': 'open-file-dialog',
    'saveDirectory': 'save-directory',
    'scanDirectory': 'scan-directory',
    'getModel': 'get-model',
    'getModelsFiltered': 'get-models-filtered',
    'saveModel': 'save-model',
    'saveModelBatch': 'save-model-batch',
    'updateModelsBatch': 'update-models-batch',
    'saveThumbnail': 'save-thumbnail',
    'getDesigners': 'get-designers',
    'getLicenses': 'get-licenses',
    'getModelsByDesigner': 'get-models-by-designer',
    'showItemInFolder': 'show-item-in-folder',
    'openPath': 'open-path',
    'getAllModels': 'get-all-models',
    'getTotalModelCount': 'getTotalModelCount',
    'getParentModels': 'get-parent-models',
    'getAllTags': 'get-all-tags',
    'saveTag': 'save-tag',
    'deleteTag': 'delete-tag',
    'getTagModelCount': 'get-tag-model-count',
    'getAllMetadata': 'get-all-metadata',
    'renameMetadata': 'rename-metadata',
    'deleteMetadata': 'delete-metadata',
    'getModelTags': 'get-model-tags',
    'saveModelTags': 'save-model-tags',
    'getSetting': 'get-setting',
    'saveSetting': 'save-setting',
    'checkCollectUsage': 'check-collect-usage',
    'purgeThumbnails': 'purge-thumbnails',
    'trackEvent': 'track-event',
    'showMessage': 'show-message',
    'showMessageBox': 'show-message-box',
    'backupDatabase': 'backup-database',
    'restoreDatabase': 'restore-database',
    'getDuplicateFiles': 'get-duplicate-files',
    'checkFilesExist': 'check-files-exist',
    'deleteFile': 'delete-file',
    'fetchThangsPage': 'fetch-thangs-page',
    'purgeModels': 'purge-models',
    'get3MFImages': 'get3MFImages',
    'get3MFSTL': 'get3MFSTL',
    'extractModelFromZip': 'extract-model-from-zip',
    'extractZipArchive': 'extract-zip-archive',
    'getDuplicates': 'get-duplicates',
    'isGeneratingHashes': 'is-generating-hashes',
    'getModelsWithoutHash': 'getModelsWithoutHash',
    'generateMissingHashes': 'generateMissingHashes',
    'calculateFileHash': 'calculate-file-hash',
    'getThumbnail': 'getThumbnail',
    'getAllThumbnails': 'get-all-thumbnails',
    'addThumbnail': 'add-thumbnail',
    'addMultipleThumbnails': 'add-multiple-thumbnails',
    'setDefaultThumbnail': 'set-default-thumbnail',
    'checkForUpdates': 'check-for-updates',
    'openUpdatePage': 'open-update-page',
    'testAIConfig': 'test-ai-config',
    'generateTags': 'generate-tags',
    'puterAIChat': 'puter-ai-chat',
    'getModelsWithoutThumbnails': 'get-models-without-thumbnails',
    'getModelsWithDefaultThumbnails': 'get-models-with-default-thumbnails',
    'fetchMakerWorldPage': 'fetch-makerworld-page',
    'getSlicers': 'get-slicers',
    'saveSlicer': 'save-slicer',
    'deleteSlicer': 'delete-slicer',
    'clearAndSaveSlicers': 'clear-and-save-slicers',
    'getFileStats': 'get-file-stats',
    'startTransaction': 'database:start-transaction',
    'commitTransaction': 'database:commit-transaction',
    'rollbackTransaction': 'database:rollback-transaction',
    'getAllModelReferences': 'get-all-model-references',
    'showInputDialog': 'show-input-dialog',
    'openSlicerDialog': 'open-slicer-dialog',
    'openExternal': 'open-external',
    'quitApp': 'quitApp',
    'showContextMenu': 'show-context-menu'
  };
  
  // Create proxy methods for all IPC calls
  Object.keys(methodToChannel).forEach(method => {
    // Store original method if it exists (before we overwrite it)
    const originalMethod = originalElectron[method];
    
    window.electron[method] = function(...args) {
      // In server mode, always use WebSocket (don't fall back to original)
      // The original methods from preload.js won't work in a browser anyway
      return makeIpcCall(methodToChannel[method], ...args);
    };
  });
  
  // Special methods that don't map directly to IPC channels
  window.electron.isServerMode = function() {
    return Promise.resolve(true);
  };
  
  window.electron.getAppVersion = function() {
    return Promise.resolve('1.22.5');
  };
  
  window.electron.invoke = function(channel, ...args) {
    return makeIpcCall(channel, ...args);
  };
  
  window.electron.send = function(channel, ...args) {
    // Send events (fire and forget)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        id: `send_${++requestIdCounter}_${Date.now()}`,
        channel,
        args,
        type: 'send'
      }));
    }
  };
  
  // Event listener methods (onOpenTagManager, onOpenSettings, etc.)
  window.electron.onOpenTagManager = function(callback) {
    window.electron.on('open-tag-manager', callback);
  };
  
  window.electron.onOpenMetadataEditor = function(callback) {
    window.electron.on('open-metadata-editor', callback);
  };
  
  window.electron.onOpenSettings = function(callback) {
    window.electron.on('open-settings', callback);
  };
  
  window.electron.onOpenGuide = function(callback) {
    window.electron.on('open-guide', callback);
  };
  
  window.electron.onOpenAbout = function(callback) {
    window.electron.on('open-about', async () => {
      await callback();
    });
  };
  
  window.electron.onOpenServerModeInfo = function(callback) {
    window.electron.on('open-server-mode-info', async () => {
      await callback();
    });
  };
  
  window.electron.onOpenBackupRestore = function(callback) {
    window.electron.on('open-backup-restore', callback);
  };
  
  window.electron.onOpenDeDup = function(callback) {
    window.electron.on('open-dedup', callback);
  };
  
  window.electron.onGenerateMissingThumbnails = function(callback) {
    window.electron.on('generate-missing-thumbnails', callback);
  };
  
  window.electron.onPingRequest = function(callback) {
    window.electron.on('ping', callback);
  };
  
  window.electron.onRefreshGrid = function(callback) {
    window.electron.on('refresh-grid', callback);
  };
  
  window.electron.onThumbnailAdded = function(callback) {
    window.electron.on('thumbnail-added', (event, data) => callback(data));
  };
  
  window.electron.onOpenThemeSettings = function(callback) {
    window.electron.on('open-theme-settings', callback);
  };
  
  window.electron.onOpenPerformanceSettings = function(callback) {
    window.electron.on('open-performance-settings', callback);
  };
  
  window.electron.onStartPrintRoulette = function(callback) {
    window.electron.on('start-print-roulette', callback);
  };
  
  window.electron.onOpenSTLHome = function(callback) {
    window.electron.on('open-stl-home', callback);
  };
  
  window.electron.onOpenSlicerSettings = function(callback) {
    window.electron.on('open-slicer-settings', callback);
  };
  
  window.electron.onOpenPurgeModels = function(callback) {
    window.electron.on('open-purge-models', callback);
  };
  
  window.electron.onHashGenerationProgress = function(callback) {
    window.electron.on('hash-generation-progress', (event, progress) => callback(progress));
  };
  
  window.electron.onScanProgress = function(callback) {
    window.electron.on('scan-progress', (event, progress) => callback(progress));
  };
  
  window.electron.onDbProgress = function(callback) {
    window.electron.on('db-progress', (event, progress) => callback(progress));
  };
  
  window.electron.onDbCleanup = function(callback) {
    window.electron.on('db-cleanup', callback);
  };
  
  window.electron.pong = function() {
    window.electron.send('pong');
  };
  
  // Copy over any other methods from original that we haven't overridden
  Object.keys(originalElectron).forEach(key => {
    if (!window.electron[key] && typeof originalElectron[key] === 'function') {
      window.electron[key] = originalElectron[key];
    }
  });
  
  // Connect when script loads
  connect();
})();
