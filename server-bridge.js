// Server mode bridge - replaces window.electron when served via HTTP
(function() {
  'use strict';
  
  console.log('[Bridge] Server bridge script starting...');
  
  if (typeof window === 'undefined') {
    console.error('[Bridge] window is undefined, cannot initialize');
    return;
  }
  
  // Don't initialize bridge in Electron windows (hidden window in server mode)
  // Only initialize in browser contexts (where window.electron doesn't exist from preload)
  // Check if window.electron already exists with methods from preload.js (not from bridge)
  if (window.electron && typeof window.electron.invoke === 'function' && !window._electronBridgeReady) {
    // This is likely the hidden Electron window with preload.js, not a browser
    // The hidden window uses preload.js for IPC, not server-bridge.js for WebSocket
    console.log('[Bridge] Detected Electron window context (preload.js), skipping bridge initialization');
    return;
  }
  
  // CRITICAL: Initialize window.electron immediately, before anything else
  // This prevents "Cannot read properties of undefined" errors
  if (!window.electron) {
    window.electron = {};
    console.log('[Bridge] Created window.electron object');
  } else {
    console.log('[Bridge] window.electron already exists, will extend it');
  }
  
  // CRITICAL: Initialize _electronEventListeners immediately
  if (!window._electronEventListeners) {
    window._electronEventListeners = {};
    console.log('[Bridge] Created window._electronEventListeners object');
  } else {
    console.log('[Bridge] window._electronEventListeners already exists');
  }
  
  // Define on() method IMMEDIATELY so it's always available
  window.electron.on = function(channel, callback) {
    if (!window._electronEventListeners) {
      window._electronEventListeners = {};
    }
    if (!window._electronEventListeners[channel]) {
      window._electronEventListeners[channel] = [];
    }
    window._electronEventListeners[channel].push(callback);
    console.log('[Bridge] Registered listener for channel:', channel, 'Total listeners:', window._electronEventListeners[channel].length);
  };
  console.log('[Bridge] window.electron.on method defined');
  
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${wsProtocol}//${window.location.host}`;
  let ws = null;
  let reconnectAttempts = 0;
  const maxReconnectAttempts = 5;
  const pendingRequests = new Map();
  let requestIdCounter = 0;

  // Promise that resolves when WebSocket connects (so first load doesn't run before bridge is ready)
  let connectionReadyResolve;
  const connectionReady = new Promise(function(resolve) {
    connectionReadyResolve = resolve;
  });
  window.electron.whenConnected = function() {
    return connectionReady;
  };

  // Define send() method - will be enhanced when WebSocket connects
  let sendFunction = function(channel, ...args) {
    // Will be enhanced when WebSocket connects
    console.warn('window.electron.send called before WebSocket connected:', channel);
  };
  window.electron.send = sendFunction;

  function showBrowserMessage(title, message, buttons = ['OK']) {
    return new Promise((resolve) => {
      const dialog = document.createElement('dialog');
      const dialogId = `browser-message-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      dialog.id = dialogId;
      dialog.style.cssText = `
        background: #2d2d2d;
        color: #fff;
        border: 1px solid #555;
        border-radius: 6px;
        min-width: 320px;
        max-width: 520px;
        padding: 16px;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;
      dialog.setAttribute('aria-modal', 'true');

      const titleEl = document.createElement('div');
      titleEl.textContent = title || 'Message';
      titleEl.style.cssText = 'font-weight: 600; margin-bottom: 8px; font-size: 14px;';

      const messageEl = document.createElement('div');
      messageEl.textContent = message || '';
      messageEl.style.cssText = 'font-size: 13px; line-height: 1.4; margin-bottom: 16px; white-space: pre-wrap;';

      const buttonRow = document.createElement('div');
      buttonRow.style.cssText = 'display: flex; gap: 8px; justify-content: flex-end;';

      const cleanup = () => {
        dialog.close();
        dialog.remove();
        if (styleTag) styleTag.remove();
      };

      buttons.forEach((label, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        btn.style.cssText = `
          padding: 6px 12px;
          border: 1px solid #555;
          border-radius: 4px;
          background: ${index === 0 ? '#007bff' : '#444'};
          color: #fff;
          cursor: pointer;
          font-size: 13px;
        `;
        btn.addEventListener('click', () => {
          cleanup();
          resolve({ label, index });
        });
        buttonRow.appendChild(btn);
      });

      dialog.appendChild(titleEl);
      dialog.appendChild(messageEl);
      dialog.appendChild(buttonRow);

      const styleTag = document.createElement('style');
      styleTag.textContent = `
        #${dialogId}::backdrop {
          background: rgba(0, 0, 0, 0.5);
        }
      `;

      document.body.appendChild(styleTag);
      document.body.appendChild(dialog);
      dialog.showModal();
    });
  }
  
  function connect() {
    try {
      console.log('[Bridge] Attempting WebSocket connection to:', wsUrl);
      ws = new WebSocket(wsUrl);
      
      ws.onopen = () => {
        console.log('WebSocket connected to Printventory server');
        console.log('[Bridge] WebSocket readyState after open:', ws.readyState);
        reconnectAttempts = 0;
        if (connectionReadyResolve) {
          connectionReadyResolve();
          connectionReadyResolve = null;
        }
      };
      
      ws.onmessage = (event) => {
        console.log('[Bridge] Received WebSocket message:', event.data.substring(0, 200));
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'result') {
            const pending = pendingRequests.get(data.id);
            if (pending) {
              console.log('[Bridge] Resolving pending request:', data.id);
              
              // Convert base64 ArrayBuffer back to ArrayBuffer if needed
              let result = data.result;
              if (result && result.__arrayBuffer === true) {
                // Convert base64 string back to ArrayBuffer
                const binaryString = atob(result.data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                  bytes[i] = binaryString.charCodeAt(i);
                }
                result = bytes.buffer;
              }
              
              pending.resolve(result);
              pendingRequests.delete(data.id);
            }
          } else if (data.type === 'error') {
            const pending = pendingRequests.get(data.id);
            if (pending) {
              console.log('[Bridge] Rejecting pending request:', data.id, data.error);
              pending.reject(new Error(data.error));
              pendingRequests.delete(data.id);
            }
          } else if (data.type === 'event') {
            // Handle events (like 'refresh-grid', 'scan-progress', etc.)
            console.log('[Bridge] Received event:', data.channel, 'with args:', data.args);
            const eventListeners = window._electronEventListeners || {};
            const listeners = eventListeners[data.channel] || [];
            console.log('[Bridge] Found', listeners.length, 'listener(s) for channel:', data.channel);
            if (listeners.length === 0) {
              console.warn('[Bridge] No listeners registered for event channel:', data.channel);
              // Debug: Show all registered channels
              const allChannels = Object.keys(eventListeners);
              console.log('[Bridge] All registered channels:', allChannels);
              // Debug: Check if onHashGenerationProgress exists
              if (data.channel === 'hash-generation-progress') {
                console.log('[Bridge] window.electron.onHashGenerationProgress exists:', typeof window.electron?.onHashGenerationProgress);
                console.log('[Bridge] window.electron.on exists:', typeof window.electron?.on);
                console.log('[Bridge] _electronEventListeners type:', typeof window._electronEventListeners);
                console.log('[Bridge] _electronEventListeners keys:', Object.keys(window._electronEventListeners || {}));
              }
              // Debug for tag generation events
              if (data.channel === 'start-single-tag-generation' || data.channel === 'start-batch-tag-generation') {
                console.log('[Bridge] Tag generation event received but no listeners!');
                console.log('[Bridge] window.electron.on exists:', typeof window.electron?.on);
                console.log('[Bridge] _electronEventListeners keys:', Object.keys(window._electronEventListeners || {}));
                console.log('[Bridge] Attempting to register listener now...');
                // Try to register listener if window.electron.on exists
                if (typeof window.electron.on === 'function') {
                  console.log('[Bridge] window.electron.on is a function, listeners should be registerable');
                }
              }
            }
            listeners.forEach((listener, index) => {
              try {
                console.log('[Bridge] Calling listener', index, 'for channel:', data.channel, 'with args:', data.args);
                listener(...(data.args || []));
              } catch (error) {
                console.error('[Bridge] Error in event listener:', error);
              }
            });
          }
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };
      
      ws.onerror = (error) => {
        console.error('[Bridge] WebSocket error:', error);
      };
      
      ws.onclose = (event) => {
        console.log('[Bridge] WebSocket disconnected. Code:', event.code, 'Reason:', event.reason, 'Clean:', event.wasClean);
        if (reconnectAttempts < maxReconnectAttempts) {
          reconnectAttempts++;
          console.log('[Bridge] Reconnect attempt', reconnectAttempts, 'in', 1000 * reconnectAttempts, 'ms');
          setTimeout(connect, 1000 * reconnectAttempts);
        }
      };
    } catch (error) {
      console.error('Error connecting WebSocket:', error);
    }
  }
  
  // Helper function to make IPC calls via WebSocket
  function makeIpcCall(channel, ...args) {
    console.log('[Bridge] makeIpcCall:', channel, 'args:', args?.length);
    
    // If WebSocket is not connected, try to connect
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.log('[Bridge] WebSocket not open, state:', ws?.readyState, 'reconnectAttempts:', reconnectAttempts);
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
    console.log('[Bridge] Sending WebSocket message:', { id, channel, argsLength: args?.length });
    
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      
      ws.send(JSON.stringify({
        id,
        channel,
        args
      }));
      
      // test-ai-config can take longer when using Puter (captcha, network)
      var timeoutMs = (channel === 'test-ai-config') ? 60000 : 30000;
      setTimeout(function() {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          console.error('[Bridge] IPC call timeout:', channel, 'id:', id);
          reject(new Error('IPC call timeout: ' + channel));
        }
      }, timeoutMs);
    });
  }
  
  // Store original electron if it exists (for fallback)
  const originalElectron = window.electron || {};
  console.log('[Bridge] Stored originalElectron, now creating methods...');
  
  // Map of method names to IPC channels (from preload.js)
  const methodToChannel = {
    'loadDirectory': 'load-directory',
    'openFileDialog': 'open-file-dialog',
    'saveDirectory': 'save-directory',
    'scanDirectory': 'scan-directory',
    'getModel': 'get-model',
    'getModelsFiltered': 'get-models-filtered',
    'saveModel': 'save-model',
    'saveModelFromUpload': 'save-model-from-upload',
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
    'getStats': 'get-stats',
    'renameMetadata': 'rename-metadata',
    'deleteMetadata': 'delete-metadata',
    'getModelTags': 'get-model-tags',
    'saveModelTags': 'save-model-tags',
    'getSetting': 'get-setting',
    'saveSetting': 'save-setting',
    'getAppVersion': 'get-app-version',
    'checkCollectUsage': 'check-collect-usage',
    'purgeThumbnails': 'purge-thumbnails',
    'trackEvent': 'track-event',
    'showMessage': 'show-message',
    'showMessageBox': 'show-message-box',
    'backupDatabase': 'backup-database',
    'restoreDatabase': 'restore-database',
    'exportLibrary': 'export-library',
    'importLibrary': 'import-library',
    'getDuplicateFiles': 'get-duplicate-files',
    'checkFilesExist': 'check-files-exist',
    'deleteFile': 'delete-file',
    'fetchThangsPage': 'fetch-thangs-page',
    'purgeModels': 'purge-models',
    'getModelCountByFileTypeIds': 'get-model-count-by-file-type-ids',
    'removeModelsByFileTypeIds': 'remove-models-by-file-type-ids',
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
    'deleteThumbnail': 'delete-thumbnail',
    'checkForUpdates': 'check-for-updates',
    'openUpdatePage': 'open-update-page',
    'testAIConfig': 'test-ai-config',
    'getDefaultAIPrompt': 'get-default-ai-prompt',
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
    'showContextMenu': 'show-context-menu',
    'executeContextMenuAction': 'execute-context-menu-action',
    'pull3MFMetadata': 'pull-3mf-metadata',
    'readModelFile': 'read-model-file',
    'parse3MFPreview': 'parse-3mf-preview',
    'cancel3MFPreview': 'cancel-3mf-preview',
    'executeClientCommand': 'execute-client-command',
    'getGpuInfo': 'get-gpu-info',
    'benchmarkFilesystem': 'benchmark-filesystem',
    'benchmarkDatabase': 'benchmark-database'
  };
  
  // Create proxy methods for all IPC calls IMMEDIATELY and SYNCHRONOUSLY
  // This ensures all methods exist before any other script tries to use them
  console.log('[Bridge] Creating', Object.keys(methodToChannel).length, 'methods from methodToChannel...');
  Object.keys(methodToChannel).forEach(method => {
    // Store original method if it exists (before we overwrite it)
    const originalMethod = originalElectron[method];
    
    // Create the method immediately - don't wait for WebSocket connection
    window.electron[method] = function(...args) {
      // In server mode, always use WebSocket (don't fall back to original)
      // The original methods from preload.js won't work in a browser anyway
      return makeIpcCall(methodToChannel[method], ...args);
    };
  });
  console.log('[Bridge] Created all methods from methodToChannel');
  
  // Ensure all event listener methods are available immediately
  console.log('[Bridge] Creating event listener methods...');
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
  
  window.electron.onOpenStats = function(callback) {
    window.electron.on('open-stats', async () => {
      await callback();
    });
  };
  
  window.electron.onOpenSystemReport = function(callback) {
    window.electron.on('open-system-report', async () => {
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
    window.electron.on('thumbnail-added', (data) => {
      // In server mode via WebSocket, data comes directly as the first argument
      // The WebSocket handler calls: listener(...(data.args || []))
      // So if data.args = [{filePath: ...}], listener is called with that object
      callback(data);
    });
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
  
  // Handle client-side command execution (for server mode)
  window.electron.on('execute-client-command', async (commandData) => {
    try {
      if (!commandData || !commandData.type) {
        console.error('[Bridge] Invalid command data:', commandData);
        return;
      }

      const { type, filePath, slicerName, slicerPath, isZipEntry, zipPath, entryPath } = commandData;

      if (type === 'open-file') {
        // For browser clients, try to download and open, or show message
        console.log('[Bridge] Open file requested:', filePath);
        // Trigger download which browser can then open
        window.electron.on('download-model', async (path) => {
          // This will trigger the download handler
        });
        // Trigger download
        const encodedPath = encodeURIComponent(filePath);
        const downloadUrl = `/api/download/${encodedPath}`;
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = '';
        link.style.display = 'none';
        document.body.appendChild(link);
        link.click();
        setTimeout(() => link.remove(), 100);
      } else if (type === 'open-in-slicer') {
        // For browser clients, show instructions (can't execute local commands)
        console.log('[Bridge] Open in slicer requested:', filePath, slicerName);
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
    } catch (error) {
      console.error('[Bridge] Error handling client command:', error);
    }
  });
  
  window.electron.onOpenPurgeModels = function(callback) {
    window.electron.on('open-purge-models', callback);
  };
  
  window.electron.onHashGenerationProgress = function(callback) {
    console.log('[Bridge] ===== onHashGenerationProgress CALLED =====');
    console.log('[Bridge] Callback type:', typeof callback);
    console.log('[Bridge] Stack trace:', new Error().stack);
    // Ensure _electronEventListeners exists
    if (!window._electronEventListeners) {
      window._electronEventListeners = {};
      console.log('[Bridge] Created _electronEventListeners in onHashGenerationProgress');
    } else {
      console.log('[Bridge] _electronEventListeners already exists with keys:', Object.keys(window._electronEventListeners));
    }
    // In server mode via WebSocket, the progress object comes as the first (and only) argument
    // In normal mode via IPC, it comes as the second argument (event, progress)
    const listener = (progress) => {
      console.log('[Bridge] hash-generation-progress listener invoked with:', progress);
      // If progress is actually the event object and we got a second argument, use that
      // Otherwise, progress is the actual progress object
      try {
        callback(progress);
      } catch (error) {
        console.error('[Bridge] Error in hash-generation-progress callback:', error);
      }
    };
    // Use the bridge's on method directly to ensure it's registered
    if (typeof window.electron.on === 'function') {
      window.electron.on('hash-generation-progress', listener);
      console.log('[Bridge] Listener registered via window.electron.on');
    } else {
      // Fallback: register directly
      if (!window._electronEventListeners['hash-generation-progress']) {
        window._electronEventListeners['hash-generation-progress'] = [];
      }
      window._electronEventListeners['hash-generation-progress'].push(listener);
      console.log('[Bridge] Listener registered directly');
    }
    console.log('[Bridge] onHashGenerationProgress completed, listeners for hash-generation-progress:', window._electronEventListeners?.['hash-generation-progress']?.length || 0);
    console.log('[Bridge] All registered channels:', Object.keys(window._electronEventListeners || {}));
  };
  
  window.electron.onHashGenerationComplete = function(callback) {
    console.log('[Bridge] ===== onHashGenerationComplete CALLED =====');
    // Ensure _electronEventListeners exists
    if (!window._electronEventListeners) {
      window._electronEventListeners = {};
    }
    const listener = (result) => {
      console.log('[Bridge] hash-generation-complete listener invoked with:', result);
      try {
        callback(result || {});
      } catch (error) {
        console.error('[Bridge] Error in hash-generation-complete callback:', error);
      }
    };
    // Use the bridge's on method directly to ensure it's registered
    if (typeof window.electron.on === 'function') {
      window.electron.on('hash-generation-complete', listener);
      console.log('[Bridge] Completion listener registered via window.electron.on');
    } else {
      // Fallback: register directly
      if (!window._electronEventListeners['hash-generation-complete']) {
        window._electronEventListeners['hash-generation-complete'] = [];
      }
      window._electronEventListeners['hash-generation-complete'].push(listener);
      console.log('[Bridge] Completion listener registered directly');
    }
  };
  
  window.electron.onScanProgress = function(callback) {
    if (!window._electronEventListeners) window._electronEventListeners = {};
    window._electronEventListeners['scan-progress'] = [];
    window.electron.on('scan-progress', (event, progress) => callback(progress));
  };
  
  window.electron.onDbProgress = function(callback) {
    if (!window._electronEventListeners) window._electronEventListeners = {};
    window._electronEventListeners['db-progress'] = [];
    window.electron.on('db-progress', (event, progress) => callback(progress));
  };
  
  window.electron.onDbCleanup = function(callback) {
    window.electron.on('db-cleanup', callback);
  };
  
  window.electron.on3MFPreviewStatus = function(callback) {
    window.electron.on('3mf-preview-status', (event, requestId, message) => callback(requestId, message));
  };
  
  window.electron.receive = function(channel, callback) {
    const validChannels = ['preview-model', 'download-model'];
    if (validChannels.includes(channel)) {
      console.log('[Bridge] Registering receive listener for channel:', channel);
      window.electron.on(channel, callback);
      const count = (window._electronEventListeners[channel] || []).length;
      console.log('[Bridge] Listener registered. Total listeners for', channel, ':', count);
    } else {
      console.warn('[Bridge] Attempted to register receive listener for invalid channel:', channel);
    }
  };
  
  window.electron.pong = function() {
    window.electron.send('pong');
  };
  
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

  // Override showMessage and showMessageBox with browser implementations
  // (These are in methodToChannel but we want custom browser dialogs)
  window.electron.showMessage = function(title, message, buttons = ['OK']) {
    return showBrowserMessage(title, message, buttons).then(result => result.label);
  };

  window.electron.showMessageBox = function(options = {}) {
    const title = options.title || 'Message';
    const messageParts = [options.message, options.detail].filter(Boolean);
    const message = messageParts.join('\n\n');
    const buttons = options.buttons || ['OK'];
    return showBrowserMessage(title, message, buttons).then(result => ({
      response: result.index,
      checkboxChecked: false
    }));
  };

  window.electron.openExternal = function(url) {
    try {
      window.open(url, '_blank', 'noopener');
    } catch (error) {
      console.error('Error opening external URL:', error);
    }
    return Promise.resolve(true);
  };
  
  // Update send method to use WebSocket when available
  sendFunction = function(channel, ...args) {
    // Send events (fire and forget)
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (channel === 'puter-ai-chat-response') {
        console.log('[Bridge] Sending puter-ai-chat-response via WebSocket, requestId:', args[0], 'has result:', !!args[1]);
      }
      ws.send(JSON.stringify({
        id: `send_${++requestIdCounter}_${Date.now()}`,
        channel,
        args,
        type: 'send'
      }));
    } else {
      // WebSocket not ready yet - will be queued or logged
      console.warn('window.electron.send called before WebSocket connected:', channel);
    }
  };
  window.electron.send = sendFunction;
  
  // Copy over any other methods from original that we haven't overridden
  Object.keys(originalElectron).forEach(key => {
    if (!window.electron[key] && typeof originalElectron[key] === 'function') {
      window.electron[key] = originalElectron[key];
    }
  });
  
  // Verify critical methods exist (debug check)
  console.log('[Bridge] Verifying critical methods...');
  if (typeof window.electron.getSetting !== 'function') {
    console.error('[Bridge] ERROR: getSetting method not created! Available methods:', Object.keys(window.electron));
  } else {
    console.log('[Bridge] ✓ getSetting method exists');
  }
  if (typeof window.electron.receive !== 'function') {
    console.error('[Bridge] ERROR: receive method not created!');
  } else {
    console.log('[Bridge] ✓ receive method exists');
  }
  if (typeof window.electron.onOpenSlicerSettings !== 'function') {
    console.error('[Bridge] ERROR: onOpenSlicerSettings method not created!');
  } else {
    console.log('[Bridge] ✓ onOpenSlicerSettings method exists');
  }
  
  // Signal that bridge is ready
  window._electronBridgeReady = true;
  console.log('[Bridge] Server bridge initialized, all methods available. Total methods:', Object.keys(window.electron).length);
  console.log('[Bridge] onHashGenerationProgress defined:', typeof window.electron.onHashGenerationProgress);
  console.log('[Bridge] on method defined:', typeof window.electron.on);
  console.log('[Bridge] _electronEventListeners initialized:', !!window._electronEventListeners);
  
  // CRITICAL: Register preview-model listener directly in bridge
  // This ensures it works even if preview.js has issues
  console.log('[Bridge] Registering preview-model listener directly in bridge');
  window.electron.on('preview-model', (filePath) => {
    console.log('[Bridge] preview-model event received:', filePath);
    // Try to call window.openPreview if it exists (from preview.js)
    if (typeof window.openPreview === 'function') {
      console.log('[Bridge] Calling window.openPreview');
      try {
        window.openPreview(filePath);
      } catch (error) {
        console.error('[Bridge] Error calling window.openPreview:', error);
      }
    } else {
      console.warn('[Bridge] window.openPreview not available yet, will retry when preview.js loads');
      // Retry mechanism: check for openPreview periodically
      let attempts = 0;
      const maxAttempts = 50; // 5 seconds
      const retryInterval = setInterval(() => {
        attempts++;
        if (typeof window.openPreview === 'function') {
          console.log('[Bridge] window.openPreview now available, calling it');
          clearInterval(retryInterval);
          try {
            window.openPreview(filePath);
          } catch (error) {
            console.error('[Bridge] Error calling window.openPreview:', error);
          }
        } else if (attempts >= maxAttempts) {
          console.error('[Bridge] window.openPreview never became available');
          clearInterval(retryInterval);
        }
      }, 100);
    }
  });
  console.log('[Bridge] preview-model listener registered. Count:', (window._electronEventListeners['preview-model'] || []).length);
  
  // Connect when script loads
  connect();
})();
