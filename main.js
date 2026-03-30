const { app, BrowserWindow, ipcMain, screen, dialog, Menu, shell, contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { Worker } = require('worker_threads');
// 3MF preview worker/caching
const preview3mfWorkers = new Map();
const preview3mfCache = new Map();
const PREVIEW_3MF_CACHE_LIMIT = 5;
const PREVIEW_3MF_POOL_SIZE = 10;
const preview3mfWorkerPool = [];

function getPreview3mfCacheDir() {
  return path.join(app.getPath('userData'), '3mf-preview-cache');
}

function acquirePreview3mfWorker(workerPath) {
  const idle = preview3mfWorkerPool.find(entry => !entry.busy);
  if (idle) {
    idle.busy = true;
    return idle;
  }

  if (preview3mfWorkerPool.length < PREVIEW_3MF_POOL_SIZE) {
    const worker = new Worker(workerPath);
    const entry = { worker, busy: true, temporary: false };
    preview3mfWorkerPool.push(entry);
    return entry;
  }

  // Fallback: temporary worker when pool is busy
  return { worker: new Worker(workerPath), busy: true, temporary: true };
}

function releasePreview3mfWorker(entry) {
  if (!entry) return;
  if (entry.temporary) {
    try {
      entry.worker.terminate();
    } catch (error) {
      console.error('Error terminating temp 3MF preview worker:', error);
    }
    return;
  }
  entry.busy = false;
}

function removePreview3mfWorker(entry) {
  if (!entry || entry.temporary) return;
  const index = preview3mfWorkerPool.indexOf(entry);
  if (index >= 0) {
    preview3mfWorkerPool.splice(index, 1);
  }
}
const JSZip = require('jszip');
const os = require('os');
const https = require('https');

// Additional file types for scan/library (alphabetical by label). id used in settings; extensions for scan/filter.
const ADDITIONAL_FILE_TYPES_CATALOG = [
  { id: '3ds', label: '3DS (.3ds)', extensions: ['.3ds'] },
  { id: 'amf', label: 'AMF (.amf)', extensions: ['.amf'] },
  { id: 'blender', label: 'Blender (.blender)', extensions: ['.blender'] },
  { id: 'dae', label: 'DAE (.dae)', extensions: ['.dae'] },
  { id: 'dxf', label: 'DXF (.dxf)', extensions: ['.dxf'] },
  { id: 'dwg', label: 'DWG (.dwg)', extensions: ['.dwg'] },
  { id: 'fbx', label: 'FBX (.fbx)', extensions: ['.fbx'] },
  { id: 'f3d', label: 'F3D (.f3d)', extensions: ['.f3d'] },
  { id: 'f3z', label: 'F3Z (.f3z)', extensions: ['.f3z'] },
  { id: 'gcode', label: 'G-code (.gcode)', extensions: ['.gcode'] },
  { id: 'igs', label: 'IGES (.igs/.iges)', extensions: ['.igs', '.iges'] },
  { id: 'obj', label: 'OBJ (.obj)', extensions: ['.obj'] },
  { id: 'ply', label: 'PLY (.ply)', extensions: ['.ply'] },
  { id: 'step', label: 'STEP (.step/.stp)', extensions: ['.step', '.stp'] },
  { id: 'svg', label: 'SVG (.svg)', extensions: ['.svg'] },
  { id: 'x3d', label: 'X3D (.x3d)', extensions: ['.x3d'] }
];

function getScanExtensions(selectedIds) {
  const extSet = new Set(['.stl', '.3mf']);
  if (selectedIds && Array.isArray(selectedIds)) {
    for (const id of selectedIds) {
      const entry = ADDITIONAL_FILE_TYPES_CATALOG.find(e => e.id === id);
      if (entry) entry.extensions.forEach(ext => extSet.add(ext));
    }
  }
  return Array.from(extSet);
}

function getSupportedExtensionsForLibrary(db) {
  const setting = db && db.prepare ? db.prepare('SELECT value FROM settings WHERE key = ?').get('scanAdditionalFileTypes') : null;
  let selectedIds = [];
  try {
    if (setting && setting.value) selectedIds = JSON.parse(setting.value);
  } catch (e) { /* ignore */ }
  return getScanExtensions(selectedIds);
}

function getExtensionsForFileTypeFilter(fileTypeValue) {
  if (!fileTypeValue || fileTypeValue === 'zip') return null;
  const lower = fileTypeValue.toLowerCase();
  if (lower === 'stl') return ['.stl'];
  if (lower === '3mf') return ['.3mf'];
  const entry = ADDITIONAL_FILE_TYPES_CATALOG.find(e => e.id === lower || e.extensions.some(ext => ext.slice(1) === lower));
  return entry ? entry.extensions : [`.${lower}`];
}
const ua = require('universal-analytics');
const express = require('express');
const WebSocket = require('ws');

// Create an analytics wrapper for GA4
const analytics = {
  // Generate a session ID when the app starts
  sessionId: crypto.randomUUID(),
  
  async sendGA4Event(clientId, name, params = {}) {
    try {
      // Check if usage collection is enabled
      if (!db || !db.prepare) return; // Database not initialized yet
      
      const collectUsage = db.prepare('SELECT value FROM settings WHERE key = ?').get('CollectUsage');
      if (!collectUsage || collectUsage.value !== '1') {
        console.log('Usage tracking disabled, skipping analytics');
        return;
      }
      
      console.log(`Tracking GA4 event: ${name} with params:`, params);
      console.log(`App version being sent: ${version}`);
      
      // GA4 measurement ID and API secret
      const measurementId = 'G-N4766Y9R11';
      const apiSecret = 'JeeNztq1RkCitPAFqT25Qg';
      
      // Add session ID to all events
      params.session_id = this.sessionId;
      
      // Add app_name parameter to identify this as an Electron app
      params.app_name = 'Printventory';
      
      // Add engagement parameters for better real-time tracking
      if (name === 'user_engagement') {
        params.engagement_time_msec = params.engagement_time_msec || 30000;
        params.session_engaged = true;
      }
      
      // Get model count (library size) from database if not already provided in params
      let modelCount = params.model_count;
      if (modelCount === undefined) {
        try {
          const row = db.prepare("SELECT COUNT(*) AS total FROM models").get();
          modelCount = row ? row.total : 0;
        } catch (error) {
          console.error('Error getting model count for analytics:', error);
          // Continue with modelCount = 0 if query fails
          modelCount = 0;
        }
      }
      
      // Ensure custom dimension parameters are set (matching custom dimensions: app_version, model_count, os_platform)
      // These parameter names must match exactly the custom dimension parameter names in GA4
      // GA4 requires numeric values for numeric custom dimensions, so ensure model_count is a number
      if (params.app_version === undefined) {
        params.app_version = version;
      }
      if (params.os_platform === undefined) {
        params.os_platform = process.platform;
      }
      if (params.model_count === undefined) {
        params.model_count = modelCount;
      }
      
      // Ensure model_count is a number (GA4 custom dimensions may require specific types)
      if (typeof params.model_count === 'string') {
        params.model_count = parseInt(params.model_count, 10) || 0;
      }
      if (typeof params.model_count !== 'number') {
        params.model_count = Number(params.model_count) || 0;
      }
      
      // Prepare user properties for GA4 - these persist across events and enable version-based segmentation
      // User-scoped custom dimensions MUST be sent as user_properties
      // The property names must match the custom dimension parameter names exactly in GA4 (case-sensitive)
      // GA4 user_properties format: { property_name: { value: property_value } }
      const userProperties = {
        app_version: { value: String(params.app_version) },      // Custom dimension: App Version (User-scoped)
        os_platform: { value: String(params.os_platform) },      // Custom dimension: OS Platform (User-scoped)
        model_count: { value: Number(params.model_count) },      // Custom dimension: Model Count (User-scoped) - must be number
        os_version: { value: os.release() },
        electron_version: { value: process.versions.electron },
        node_version: { value: process.versions.node },
        architecture: { value: process.arch }
      };
      
      // Prepare the event data - following GA4 protocol exactly
      const eventData = {
        client_id: clientId,
        user_id: clientId,
        timestamp_micros: Date.now() * 1000, // Current time in microseconds
        non_personalized_ads: true,
        user_properties: userProperties,
        events: [{
          name,
          params
        }]
      };
      
      // Convert to JSON
      const postData = JSON.stringify(eventData);
      
      // Always use debug endpoint to see validation errors and ensure data is being received
      // This helps troubleshoot issues with custom dimensions and event parameters
      const isDebug = process.env.NODE_ENV === 'development' || process.env.GA4_DEBUG === 'true';
      const baseEndpoint = isDebug ? '/debug/mp/collect' : '/mp/collect';
      
      // Build query string with measurement_id and api_secret
      let queryString = `measurement_id=${measurementId}&api_secret=${apiSecret}`;
      // Always add debug_mode for better visibility during troubleshooting
      // Remove this in production if you want to reduce debug noise
      if (isDebug) {
        queryString += '&debug_mode=true'; // Enable debugView in Google Analytics
      }
      
      // Prepare the request options
      const options = {
        hostname: 'www.google-analytics.com',
        path: `${baseEndpoint}?${queryString}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      // Log the full request for debugging
      console.log('=== GA4 Analytics Event ===');
      console.log('GA4 request URL:', `https://${options.hostname}${options.path}`);
      console.log('GA4 debug mode enabled:', isDebug);
      console.log('GA4 event name:', name);
      console.log('GA4 custom dimensions (event params):', {
        app_version: params.app_version,
        os_platform: params.os_platform,
        model_count: params.model_count
      });
      console.log('GA4 user properties (custom dimensions):', JSON.stringify(userProperties, null, 2));
      console.log('GA4 client_id:', clientId);
      console.log('GA4 measurement_id:', measurementId);
      if (isDebug) {
        console.log('⚠️  Using debug endpoint - check GA4 DebugView: https://analytics.google.com/');
        console.log('   Navigate to: Admin > DebugView to see real-time event validation');
      }
      console.log('GA4 request body:', postData);
      console.log('===========================');
      
      // Send the request
      return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
          let data = '';
          
          res.on('data', (chunk) => {
            data += chunk;
          });
          
          res.on('end', () => {
            console.log(`GA4 response status: ${res.statusCode}`);
            console.log(`GA4 response data: ${data}`);
            
            // Parse response to check for validation messages
            try {
              const responseData = JSON.parse(data);
              if (responseData.validationMessages && responseData.validationMessages.length > 0) {
                console.error('GA4 validation errors:', JSON.stringify(responseData.validationMessages, null, 2));
                responseData.validationMessages.forEach((msg, idx) => {
                  console.error(`  Validation ${idx + 1}: ${msg.description} (Field: ${msg.fieldPath})`);
                });
              }
            } catch (parseError) {
              // Response might not be JSON, that's okay
            }
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('GA4 event sent successfully');
              if (isDebug) {
                console.log('Check GA4 DebugView for real-time event validation: https://analytics.google.com/');
              }
              resolve(true);
            } else {
              console.error(`Error sending GA4 event: ${res.statusCode} ${data}`);
              console.error('Check the response above for validation errors or API issues');
              resolve(false);
            }
          });
        });
        
        req.on('error', (error) => {
          console.error('Error sending GA4 event:', error);
          reject(error);
        });
        
        req.write(postData);
        req.end();
      });
    } catch (error) {
      console.error('Error in sendGA4Event:', error);
      return false;
    }
  },
  
  async event(clientId, category, action, options = {}) {
    try {
      // Convert traditional event parameters to GA4 format
      const params = {
        event_category: category,
        event_action: action,
        event_label: options.evLabel || '',
        value: options.evValue || 1
      };
      
      console.log(`Tracking event: ${category} - ${action} - ${options.evLabel || ''}`);
      
      // Map to standard GA4 event names
      // Using standard GA4 event names is important for proper reporting
      let eventName = 'user_engagement';
      
      // Map common categories to standard GA4 event names
      if (category === 'Application' && action === 'Start') {
        eventName = 'app_start'; // Custom event for application start
      } else if (category === 'Settings') {
        eventName = 'settings_change'; // Custom event for settings changes
      } else if (category === 'User Interaction') {
        eventName = 'select_content'; // Standard GA4 event for user interactions
      } else if (category === 'File') {
        eventName = 'file_operation'; // Custom event for file operations
      } else if (category === 'Error') {
        eventName = 'app_exception'; // Custom event for error tracking
      }
      
      // Send as GA4 event
      await this.sendGA4Event(clientId, eventName, params);
      
      console.log('Analytics event sent');
    } catch (error) {
      console.error('Error in analytics.event:', error);
    }
  },
  
  async pageview(clientId, path, title) {
    try {
      console.log(`Tracking pageview: ${path} - ${title}`);
      
      // Send as GA4 screen_view event (standard GA4 event for apps)
      await this.sendGA4Event(clientId, 'screen_view', {
        screen_name: title,
        screen_class: path
      });
      
      console.log('Analytics pageview sent');
    } catch (error) {
      console.error('Error in analytics.pageview:', error);
    }
  },

  async trackActiveUser(clientId) {
    try {
      console.log('Tracking active user');
      
      // Send a standard GA4 event for active users
      // Using 'user_engagement' instead of 'first_visit' which is reserved
      await this.sendGA4Event(clientId, 'user_engagement', {
        engagement_time_msec: 30000,
        session_engaged: true
      });
      
      console.log('Active user tracked');
    } catch (error) {
      console.error('Error tracking active user:', error);
    }
  }
};

// Near the top of the file, add this line
const { version } = require('./package.json');

let isDev = false;
try {
  const electronIsDev = require('electron-is-dev');
  isDev = electronIsDev;
} catch (error) {
  // If electron-is-dev is not available, determine dev mode through other means
  isDev = process.env.NODE_ENV === 'development' || /[\\/]electron/i.test(process.execPath);
}

const DEBUG = false; // Set to true for development/debugging
const PING_INTERVAL = 30000; // 30 seconds

function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Server mode detection
const isServerMode = process.argv.includes('--server');
let httpServer = null;
let wss = null; // WebSocket server
let wsClients = null; // WebSocket clients Set

// Store pending context menu actions for server mode (browser access)
const pendingContextMenus = new Map();
let contextMenuRequestIdCounter = 0;

// Handler registry for WebSocket IPC calls in server mode
// This allows us to directly invoke handlers without going through the renderer
const ipcHandlerRegistry = new Map();

// Helper function to register IPC handlers and add them to the registry
function registerIpcHandler(channel, handler) {
  ipcMain.handle(channel, handler);
  ipcHandlerRegistry.set(channel, handler);
}

// UNC Path Validation Functions
function isUncPath(path) {
  if (!path || typeof path !== 'string') {
    return false;
  }
  // UNC paths on Windows start with \\
  // They cannot be local drive paths (C:\, D:\, etc.)
  return path.startsWith('\\\\') && !/^[A-Za-z]:/.test(path);
}

// Check if running in Docker container
function isDockerContainer() {
  // Check for Docker environment indicators
  const hasDockerenv = fs.existsSync('/.dockerenv');
  const hasCgroup = fs.existsSync('/proc/self/cgroup');
  const cgroupContainsDocker = hasCgroup && fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
  const result = hasDockerenv || cgroupContainsDocker;
  return result;
}

function validateUncPath(path, operation = 'operation') {
  if (isUrlModel(path)) {
    return; // URL-only models (from extension) have no file path to validate
  }
  if (isServerMode) {
    // In Docker, allow Linux-style absolute paths (mounted shares)
    if (isDockerContainer()) {
      // Allow absolute paths starting with / (Linux-style)
      if (!path.startsWith('/') && !isUncPath(path)) {
        throw new Error(`Server mode in Docker requires absolute paths (e.g., /mnt/network-share/path/to/file.stl) or UNC paths. The path "${path}" is not valid.`);
      }
    } else {
      // On Windows, require UNC paths
      if (!isUncPath(path)) {
        throw new Error(`Server mode requires UNC paths. The path "${path}" is not a valid UNC path. UNC paths must start with \\\\ (e.g., \\\\server\\share\\path\\to\\file.stl).`);
      }
    }
  }
}

// Create a hidden window in server mode for IPC handling
function createHiddenWindow() {
  return new Promise((resolve) => {
    const hiddenWindow = new BrowserWindow({
      width: 1,
      height: 1,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js'),
        spellcheck: false,
        sandbox: false,
        enableWebSQL: false,
        webSecurity: true
      }
    });

    // Store reference to hidden window
    mainWindow = hiddenWindow;
    
    // Wait for window to be ready before resolving
    hiddenWindow.webContents.once('did-finish-load', () => {
      console.log('Hidden window ready for IPC handling in server mode');
      resolve();
    });
    
    // Load the HTML file so preload script is injected
    hiddenWindow.loadFile('index.html');
  });
}

// Helper function to safely get BrowserWindow from event (returns null in server mode)
function getWindowFromEvent(event) {
  if (isServerMode) {
    return null;
  }
  try {
    return BrowserWindow.fromWebContents(event.sender);
  } catch (error) {
    return null;
  }
}

// HTTP Server Function
function startHttpServer(port = 5000, localhostOnly = false) {
  const expressApp = express();
  const PORT = typeof port === 'number' ? port : parseInt(port, 10) || 5000;
  const HOST = localhostOnly ? '127.0.0.1' : '0.0.0.0';

  // Enable CORS for remote access
  expressApp.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
    } else {
      next();
    }
  });

  // JSON body parser for extension upload (large payloads for base64 file)
  expressApp.use(express.json({ limit: '50mb' }));

  // Serve static files from the application directory
  const appDir = __dirname;
  // Ensure renderer.js, styles.css, images, and server-bridge.js are served
  // Without this, the browser won't load app scripts and buttons won't work
  
  // CRITICAL: Inject server-bridge.js route handler BEFORE express.static
  // This ensures the route handler runs and injects the bridge code
  // Inject server-bridge.js into HTML for server mode
  expressApp.get('/', (req, res) => {
    const htmlPath = path.join(appDir, 'index.html');
    const bridgePath = path.join(appDir, 'server-bridge.js');
    
    // Read both files
    fs.readFile(htmlPath, 'utf8', (err, htmlData) => {
      if (err) {
        res.status(500).send('Error loading index.html');
        return;
      }
      
      fs.readFile(bridgePath, 'utf8', (err, bridgeCode) => {
        if (err) {
          console.error('Error loading server-bridge.js, falling back to script tag:', err);
          // Fallback to script tag if file can't be read
          const bridgeScript = '<script src="/server-bridge.js"></script>';
          let modifiedHtml = htmlData;
          const appScriptRegex = /(<script(?:\s+type=["']module["'])?\s+src=["'](?:search|renderer|slicer|preview|guide)\.js["'][^>]*>)/i;
          if (appScriptRegex.test(htmlData)) {
            modifiedHtml = htmlData.replace(appScriptRegex, `${bridgeScript}\n$1`);
          } else if (htmlData.includes('</body>')) {
            modifiedHtml = htmlData.replace('</body>', `${bridgeScript}\n</body>`);
          }
          res.send(modifiedHtml);
          return;
        }
        
        // Inject server-bridge.js code INLINE before application scripts
        // This ensures it executes synchronously and immediately
        // Wrap in try-catch to ensure it doesn't break if there's an error
        const bridgeScript = `<script>
// Server bridge initialization
try {
${bridgeCode}
} catch (error) {
  console.error('[Bridge] Error initializing server bridge:', error);
  // Ensure window.electron exists even if bridge fails
  if (typeof window !== 'undefined' && !window.electron) {
    window.electron = {};
    window.electron.on = function() {};
    window.electron.send = function() {};
    console.warn('[Bridge] Created fallback window.electron object');
  }
}
</script>`;
        let modifiedHtml = htmlData;
        
        // Find the first application script (search.js, renderer.js, slicer.js, preview.js, or guide.js)
        // and inject server-bridge.js right before it
        const appScriptRegex = /(<script(?:\s+type=["']module["'])?\s+src=["'](?:search|renderer|slicer|preview|guide)\.js["'][^>]*>)/i;
        if (appScriptRegex.test(htmlData)) {
          // Insert before first application script
          modifiedHtml = htmlData.replace(appScriptRegex, `${bridgeScript}\n$1`);
        } else if (htmlData.includes('<script type="module" src="search.js"></script>')) {
          // Specific pattern for search.js module
          modifiedHtml = htmlData.replace('<script type="module" src="search.js"></script>', `${bridgeScript}\n<script type="module" src="search.js"></script>`);
        } else if (htmlData.includes('<script src="renderer.js"></script>')) {
          // Fallback: before renderer.js
          modifiedHtml = htmlData.replace('<script src="renderer.js"></script>', `${bridgeScript}\n<script src="renderer.js"></script>`);
        } else if (htmlData.includes('</body>')) {
          // Last resort: insert before closing body tag
          modifiedHtml = htmlData.replace('</body>', `${bridgeScript}\n</body>`);
        }
        res.send(modifiedHtml);
      });
    });
  });
  
  // Add middleware to set proper MIME types for JavaScript modules
  expressApp.use((req, res, next) => {
    // Set proper Content-Type for JavaScript modules
    if (req.path.endsWith('.js')) {
      // Check if it's requested as a module (from script type="module")
      // or if it's search.js, slicer.js which are known modules
      if (req.path.includes('search.js') || req.path.includes('slicer.js') || 
          req.get('Accept')?.includes('application/javascript') ||
          req.get('Accept')?.includes('text/javascript')) {
        res.type('application/javascript');
      } else {
        res.type('application/javascript');
      }
    }
    next();
  });

  // Now register static file serving AFTER the route handler
  // This ensures the route handler takes precedence for the root path
  expressApp.use(express.static(appDir));

  // Extension upload: accept file bytes + metadata, write to configured directory (e.g. NAS), then saveModel
  expressApp.post('/api/extension-upload', async (req, res) => {
    try {
      const result = await saveModelFromUpload(req.body || {});
      res.status(200).json(result || { success: true });
    } catch (err) {
      console.error('Extension upload error:', err);
      const msg = err && err.message ? err.message : 'Upload failed';
      if (msg.includes('not configured')) res.status(400).json({ error: msg });
      else if (msg.includes('Invalid') || msg.includes('Empty') || msg.includes('Missing')) res.status(400).json({ error: msg });
      else res.status(500).json({ error: msg });
    }
  });

  // Serve files via HTTP for server mode (UNC paths or Docker-mounted paths)
  expressApp.get('/api/file/*', (req, res) => {
    try {
      // Extract file path from URL (everything after /api/file/)
      const filePath = decodeURIComponent(req.path.replace('/api/file/', ''));
      
      // Validate path (UNC paths on Windows, absolute paths in Docker)
      if (isDockerContainer()) {
        // In Docker, require absolute paths starting with /. Client paths (e.g. C:\ from extension) are not on the server.
        if (!filePath.startsWith('/') && !isUncPath(filePath)) {
          res.status(404).setHeader('X-File-Not-On-Server', '1').send('File not on server (path is on client). Use extension "Use upload for server" to add files to the server.');
          return;
        }
      } else {
        // On Windows, allow both UNC paths and drive letter paths
        // In server mode, require UNC paths; in non-server mode, allow both
        if (!isUncPath(filePath) && !/^[A-Za-z]:/.test(filePath)) {
          if (isServerMode) {
            res.status(400).send('Invalid path: Server mode requires UNC paths');
          } else {
            res.status(400).send('Invalid path: Must be a UNC path (\\\\server\\share\\path) or drive letter path (C:\\path)');
          }
          return;
        }
      }
      
      // Check if file exists
      if (!fs.existsSync(filePath)) {
        res.status(404).send('File not found');
        return;
      }
      
      // Set appropriate content type
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.stl': 'application/octet-stream',
        '.3mf': 'application/octet-stream',
        '.zip': 'application/zip',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.obj': 'application/octet-stream',
        '.svg': 'image/svg+xml',
        '.step': 'application/octet-stream',
        '.stp': 'application/octet-stream',
        '.3ds': 'application/octet-stream',
        '.amf': 'application/octet-stream',
        '.dae': 'application/octet-stream',
        '.ply': 'application/octet-stream',
        '.x3d': 'application/octet-stream',
        '.blender': 'application/octet-stream',
        '.dxf': 'application/octet-stream',
        '.dwg': 'application/octet-stream',
        '.fbx': 'application/octet-stream',
        '.f3d': 'application/octet-stream',
        '.f3z': 'application/octet-stream',
        '.gcode': 'application/octet-stream',
        '.igs': 'application/octet-stream',
        '.iges': 'application/octet-stream'
      };
      
      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
      }
      
      // Stream the file
      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(res);
      
      fileStream.on('error', (error) => {
        console.error('Error serving file:', error);
        if (!res.headersSent) {
          res.status(500).send('Error reading file');
        }
      });
    } catch (error) {
      console.error('Error in file serving endpoint:', error);
      res.status(500).send('Error serving file');
    }
  });

  // Download endpoint for server mode - handles both regular files and zip entries
  expressApp.get('/api/download/*', async (req, res) => {
    try {
      // Extract file path from URL (everything after /api/download/)
      const filePath = decodeURIComponent(req.path.replace('/api/download/', ''));
      
      // Check if this is a zip entry
      const pathInfo = parseZipPath(filePath);
      let actualFilePath = filePath;
      let fileName = path.basename(filePath);
      let fileData = null;
      
      if (pathInfo.isZipEntry) {
        // Extract zip entry to temp file and stream it
        try {
          const tempPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
          actualFilePath = tempPath;
          fileName = path.basename(pathInfo.entryPath);
        } catch (error) {
          console.error('Error extracting zip entry:', error);
          res.status(500).send('Error extracting file from zip');
          return;
        }
      }
      
      // Validate path (UNC paths on Windows, absolute paths in Docker)
      // Normalize temp dir path for comparison
      const normalizedTempDir = os.tmpdir().replace(/\\/g, '/');
      const normalizedFilePath = actualFilePath.replace(/\\/g, '/');
      let isServerManagedPath = false;
      try {
        const resolvedFilePath = path.resolve(actualFilePath);
        const resolvedUserData = path.resolve(app.getPath('userData'));
        const resolvedDbDir = path.resolve(path.dirname(getDatabasePath()));
        isServerManagedPath =
          resolvedFilePath === resolvedDbDir ||
          resolvedFilePath.startsWith(resolvedUserData + path.sep) ||
          resolvedFilePath.startsWith(resolvedDbDir + path.sep);
      } catch (error) {
        isServerManagedPath = false;
      }
      const isTempFile = normalizedFilePath.includes(normalizedTempDir);
      
      if (isDockerContainer()) {
        // In Docker, require absolute paths starting with /
        if (!normalizedFilePath.startsWith('/') && !isUncPath(actualFilePath)) {
          // For temp files from zip extraction, allow them
          if (!isTempFile) {
            res.status(400).send('Invalid path: Docker server mode requires absolute paths');
            return;
          }
        }
      } else {
        // On Windows, allow both UNC paths and drive letter paths (except temp files)
        // In server mode, require UNC paths; in non-server mode, allow both
        if (!isUncPath(actualFilePath) && !/^[A-Za-z]:/.test(actualFilePath) && !isTempFile && !isServerManagedPath) {
          if (isServerMode) {
            res.status(400).send('Invalid path: Server mode requires UNC paths');
          } else {
            res.status(400).send('Invalid path: Must be a UNC path (\\\\server\\share\\path) or drive letter path (C:\\path)');
          }
          return;
        }
      }
      
      // Check if file exists
      if (!fs.existsSync(actualFilePath)) {
        res.status(404).send('File not found');
        return;
      }
      
      // Set appropriate content type
      const ext = path.extname(fileName).toLowerCase();
      const mimeTypes = {
        '.stl': 'application/octet-stream',
        '.3mf': 'application/octet-stream',
        '.zip': 'application/zip',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.obj': 'application/octet-stream',
        '.svg': 'image/svg+xml',
        '.step': 'application/octet-stream',
        '.stp': 'application/octet-stream',
        '.3ds': 'application/octet-stream',
        '.amf': 'application/octet-stream',
        '.dae': 'application/octet-stream',
        '.ply': 'application/octet-stream',
        '.x3d': 'application/octet-stream',
        '.blender': 'application/octet-stream',
        '.dxf': 'application/octet-stream',
        '.dwg': 'application/octet-stream',
        '.fbx': 'application/octet-stream',
        '.f3d': 'application/octet-stream',
        '.f3z': 'application/octet-stream',
        '.gcode': 'application/octet-stream',
        '.igs': 'application/octet-stream',
        '.iges': 'application/octet-stream'
      };
      
      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
      }
      
      // Set Content-Disposition header to trigger download with proper filename
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
      
      // Stream the file
      const fileStream = fs.createReadStream(actualFilePath);
      fileStream.pipe(res);
      
      fileStream.on('error', (error) => {
        console.error('Error serving download:', error);
        if (!res.headersSent) {
          res.status(500).send('Error reading file');
        }
      });
      
      // Clean up temp file after streaming (for zip entries)
      if (pathInfo.isZipEntry) {
        fileStream.on('end', () => {
          // Clean up temp file asynchronously
          setTimeout(() => {
            try {
              if (fs.existsSync(actualFilePath)) {
                fs.unlinkSync(actualFilePath);
              }
            } catch (cleanupError) {
              console.error('Error cleaning up temp file:', cleanupError);
            }
          }, 1000);
        });
      }
    } catch (error) {
      console.error('Error in download endpoint:', error);
      res.status(500).send('Error serving download');
    }
  });

  // Serve static assets
  expressApp.use(express.static(appDir, {
    setHeaders: (res, filePath) => {
      // Set proper MIME types
      const ext = path.extname(filePath).toLowerCase();
      const mimeTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.bmp': 'image/bmp',
        '.webp': 'image/webp'
      };
      if (mimeTypes[ext]) {
        res.setHeader('Content-Type', mimeTypes[ext]);
      }
    }
  }));

  // Handle 404 - serve index.html for SPA routing (with bridge injection)
  expressApp.get('*', (req, res) => {
    // Don't inject bridge for static assets
    if (req.path.match(/\.(js|css|png|jpg|jpeg|gif|svg|ico|bmp|webp|json)$/)) {
      return; // Let express.static handle it
    }
    
    const htmlPath = path.join(appDir, 'index.html');
    const bridgePath = path.join(appDir, 'server-bridge.js');
    
    fs.readFile(htmlPath, 'utf8', (err, htmlData) => {
      if (err) {
        res.status(500).send('Error loading index.html');
        return;
      }
      
      fs.readFile(bridgePath, 'utf8', (err, bridgeCode) => {
        if (err) {
          // Fallback to script tag
          const bridgeScript = '<script src="/server-bridge.js"></script>';
          const modifiedHtml = htmlData.replace('</body>', `${bridgeScript}\n</body>`);
          res.send(modifiedHtml);
          return;
        }
        
        // Inject server-bridge.js code INLINE before closing body tag
        const bridgeScript = `<script>\n${bridgeCode}\n</script>`;
        const modifiedHtml = htmlData.replace('</body>', `${bridgeScript}\n</body>`);
        res.send(modifiedHtml);
      });
    });
  });

  // Start server (returns Promise so callers can catch bind errors, e.g. macOS entitlement)
  const serverPromise = new Promise((resolve, reject) => {
    if (localhostOnly) {
      console.log(`[Browser extension] Starting server on http://${HOST}:${PORT}...`);
    }
    httpServer = expressApp.listen(PORT, HOST, () => {
      if (localhostOnly) {
        console.log(`[Browser extension] Server listening at http://${HOST}:${PORT}`);
      } else {
        console.log(`Printventory server mode started`);
        console.log(`Server running at http://${HOST}:${PORT}`);
        console.log(`Access from remote browsers: http://<your-ip>:${PORT}`);
        console.log(`Server mode requires UNC paths for all file operations`);
      }
      resolve();
    });
    httpServer.on('error', (err) => {
      console.error('[Browser extension] Server failed to bind:', err.message);
      console.error('[Browser extension] Code:', err.code, '— If EACCES on macOS, add com.apple.security.network.server to entitlements and rebuild.');
      httpServer = null;
      reject(err);
    });
  });

  // Create WebSocket server for IPC bridge
  wss = new WebSocket.Server({ server: httpServer });
  const pendingRequests = new Map();
  wsClients = new Set(); // Track all connected clients

  wss.on('connection', (ws) => {
    console.log('WebSocket client connected');
    wsClients.add(ws);

    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        const { id, channel, args, type } = data;
        
        // Handle puter-ai-chat-response events from WebSocket clients (server mode)
        if (type === 'event' && channel === 'puter-ai-chat-response') {
          const [requestId, result] = args || [];
          console.log('[Puter AI] Received response via WebSocket event, requestId:', requestId, 'has result:', !!result, 'has error:', !!(result && result.error));
          const pending = puterPendingRequests.get(requestId);
          if (pending) {
            console.log('[Puter AI] Found pending request, resolving');
            puterPendingRequests.delete(requestId);
            if (result && result.error) {
              pending.reject(new Error(result.error));
            } else {
              pending.resolve(result ? result.response : null);
            }
          } else {
            console.warn('[Puter AI] No pending request found for requestId:', requestId, 'Total pending:', puterPendingRequests.size);
          }
          return; // Don't process as regular event
        }
        
        // Handle event sends (fire and forget) - these are events, not IPC handlers
        if (type === 'send') {
          // Special handling for puter-ai-chat-response: route to pending request
          if (channel === 'puter-ai-chat-response') {
            const [requestId, result] = args || [];
            console.log('[Puter AI] Received response via WebSocket send, requestId:', requestId, 'has result:', !!result, 'has error:', !!(result && result.error));
            const pending = puterPendingRequests.get(requestId);
            if (pending) {
              console.log('[Puter AI] Found pending request, resolving');
              puterPendingRequests.delete(requestId);
              if (result && result.error) {
                pending.reject(new Error(result.error));
              } else {
                pending.resolve(result ? result.response : null);
              }
            } else {
              console.warn('[Puter AI] No pending request found for requestId:', requestId, 'Total pending:', puterPendingRequests.size);
            }
            return; // Don't broadcast or process as regular event
          }
          
          // These are events that should be broadcast to all clients
          // In server mode, broadcast to all WebSocket clients
          // In normal mode, trigger the ipcMain.on() handler which sends to the renderer
          if (isServerMode && global.broadcastEvent) {
            // Broadcast to all WebSocket clients (they'll receive as type: 'event')
            global.broadcastEvent(channel, ...(args || []));
          } else {
            // In normal mode, trigger the ipcMain.on() handler
            // Create a mock event object to trigger the handler
            const mockEvent = {
              sender: mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null
            };
            
            // Get all listeners for this channel and trigger them
            const listeners = ipcMain.listeners(channel);
            if (listeners.length > 0) {
              listeners.forEach(listener => {
                try {
                  listener(mockEvent, ...(args || []));
                } catch (error) {
                  console.error(`Error in ipcMain.on('${channel}') handler:`, error);
                }
              });
            } else if (mainWindow && !mainWindow.isDestroyed()) {
              // If no listeners, send directly to the renderer
              mainWindow.webContents.send(channel, ...(args || []));
            }
          }
          return; // Don't try to handle as IPC call
        }

        // Create a mock event object for IPC handlers
        const mockEvent = {
          sender: {
            send: (eventChannel, ...eventArgs) => {
              // Broadcast event to all WebSocket clients in server mode
              if (isServerMode && global.broadcastEvent) {
                global.broadcastEvent(eventChannel, ...eventArgs);
              } else {
                // Send event back via WebSocket to this specific client
                ws.send(JSON.stringify({
                  type: 'event',
                  channel: eventChannel,
                  args: eventArgs
                }));
              }
            }
          },
          // Add wsClient for server mode so createPuterIPCHandler can use it
          wsClient: isServerMode ? ws : null
        };

        // Call IPC handlers directly instead of through hidden window
        // This is more reliable and faster
        try {
          // Create a mock event object for IPC handlers
          const mockEvent = {
            sender: {
              send: (eventChannel, ...eventArgs) => {
                // Broadcast event to all WebSocket clients in server mode
                if (isServerMode && global.broadcastEvent) {
                  global.broadcastEvent(eventChannel, ...eventArgs);
                } else {
                  // Send event back via WebSocket to this specific client
                  ws.send(JSON.stringify({
                    type: 'event',
                    channel: eventChannel,
                    args: eventArgs
                  }));
                }
              }
            },
            // Add wsClient for server mode so createPuterIPCHandler can use it
            wsClient: isServerMode ? ws : null
          };
          
          // Check if handler exists in registry (for direct invocation)
          const handler = ipcHandlerRegistry.get(channel);
          if (handler) {
            // Call the handler directly - much faster and more reliable
            try {
              // Ensure args is a flat array (handle nested arrays from JSON parsing)
              let flatArgs = args || [];
              console.log('[WebSocket] Handler found for channel:', channel, 'Raw args:', args, 'Args length:', args?.length, 'Args type:', typeof args);
              if (flatArgs.length === 1 && Array.isArray(flatArgs[0])) {
                // If args is [ [arg1, arg2] ], unwrap it to [arg1, arg2]
                console.log('[WebSocket] Unwrapping nested array');
                flatArgs = flatArgs[0];
              }
              console.log('[WebSocket] Calling handler with flatArgs:', flatArgs, 'Length:', flatArgs.length);
              const result = await handler(mockEvent, ...flatArgs);
              
              // Convert ArrayBuffer to base64 for WebSocket transmission
              let serializedResult = result;
              if (result instanceof ArrayBuffer) {
                const buffer = Buffer.from(result);
                serializedResult = {
                  __arrayBuffer: true,
                  data: buffer.toString('base64'),
                  byteLength: result.byteLength
                };
              } else if (result && result.buffer instanceof ArrayBuffer) {
                // Handle TypedArray (Uint8Array, etc.)
                const buffer = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
                serializedResult = {
                  __arrayBuffer: true,
                  data: buffer.toString('base64'),
                  byteLength: result.byteLength
                };
              }
              
              ws.send(JSON.stringify({
                id,
                type: 'result',
                result: serializedResult
              }));
            } catch (error) {
              console.error(`Error in handler for '${channel}':`, error);
              ws.send(JSON.stringify({
                id,
                type: 'error',
                error: error.message || String(error)
              }));
            }
          } else {
            // Fallback: Try to find handler using Electron's internal mechanism
            // This is for handlers that weren't registered in our registry
            // Use the hidden window as fallback if direct call doesn't work
            if (mainWindow && !mainWindow.isDestroyed()) {
              // Wait if window is still loading
              if (mainWindow.webContents.isLoading()) {
                await new Promise(resolve => {
                  const timeout = setTimeout(resolve, 5000);
                  mainWindow.webContents.once('did-finish-load', () => {
                    clearTimeout(timeout);
                    resolve();
                  });
                });
              }
              
              // Stringify args for safe injection into JavaScript code
              const argsJson = JSON.stringify(args || []);
              
              const result = await mainWindow.webContents.executeJavaScript(`
                (async () => {
                  try {
                    if (window.electron) {
                      const args = ${argsJson};
                      
                      // Convert channel name to method name (e.g., 'save-setting' -> 'saveSetting')
                      const methodName = '${channel}'.split('-').map((word, i) => 
                        i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
                      ).join('');
                      
                      // Use the specific method if it exists (e.g., saveSetting, getSetting, purgeModels)
                      // This ensures all arguments are passed correctly
                      if (window.electron[methodName] && typeof window.electron[methodName] === 'function') {
                        // Call the method with the appropriate number of arguments
                        const result = args.length === 0 
                          ? await window.electron[methodName]()
                          : await window.electron[methodName](...args);
                        return result;
                      } else if (window.electron.invoke && typeof window.electron.invoke === 'function') {
                        // Fallback: use window.electron.invoke (available through preload script)
                        // Note: preload.js invoke only accepts one data argument, so we pass args as an array
                        const result = await window.electron.invoke('${channel}', args);
                        return result;
                      } else {
                        throw new Error('window.electron methods not available');
                      }
                    } else {
                      throw new Error('window.electron not available');
                    }
                  } catch (error) {
                    console.error('Hidden window - invoke error:', error);
                    throw error;
                  }
                })()
              `);
              // Convert ArrayBuffer to base64 for WebSocket transmission
              let serializedResult = result;
              if (result instanceof ArrayBuffer) {
                const buffer = Buffer.from(result);
                serializedResult = {
                  __arrayBuffer: true,
                  data: buffer.toString('base64'),
                  byteLength: result.byteLength
                };
              } else if (result && result.buffer instanceof ArrayBuffer) {
                // Handle TypedArray (Uint8Array, etc.)
                const buffer = Buffer.from(result.buffer, result.byteOffset, result.byteLength);
                serializedResult = {
                  __arrayBuffer: true,
                  data: buffer.toString('base64'),
                  byteLength: result.byteLength
                };
              }
              
              ws.send(JSON.stringify({
                id,
                type: 'result',
                result: serializedResult
              }));
            } else {
              throw new Error(`IPC handler '${channel}' not found`);
            }
          }
        } catch (error) {
          console.error('Error executing IPC call:', error);
          ws.send(JSON.stringify({
            id,
            type: 'error',
            error: error.message || String(error)
          }));
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
        ws.send(JSON.stringify({
          type: 'error',
          error: error.message
        }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket client disconnected');
      wsClients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      wsClients.delete(ws);
    });
  });
  
  // Broadcast events to all WebSocket clients
  function broadcastEvent(channel, ...args) {
    const message = JSON.stringify({
      type: 'event',
      channel,
      args
    });
    wsClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('Error broadcasting event:', error);
        }
      }
    });
  }
  
  // Store broadcast function globally for use in IPC handlers
  global.broadcastEvent = broadcastEvent;
  
  // Helper function to send events (works in both normal and server mode)
  global.sendEvent = function(event, channel, ...args) {
    if (isServerMode && global.broadcastEvent) {
      global.broadcastEvent(channel, ...args);
    } else if (event && event.sender) {
      event.sender.send(channel, ...args);
    }
  };

  // Bind errors are handled in the Promise above (reject). Server-mode callers should catch and exit.
  return serverPromise;
}

// Stop HTTP server function
function stopHttpServer() {
  return new Promise((resolve) => {
    if (!httpServer) {
      console.log('HTTP server is not running');
      resolve();
      return;
    }

    console.log('Stopping HTTP server...');

    // Close all WebSocket connections gracefully
    if (wsClients && wsClients.size > 0) {
      console.log(`Closing ${wsClients.size} WebSocket connection(s)...`);
      wsClients.forEach((ws) => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Server restarting');
          }
        } catch (error) {
          console.error('Error closing WebSocket connection:', error);
        }
      });
      wsClients.clear();
    }

    // Close WebSocket server
    if (wss) {
      try {
        wss.close(() => {
          console.log('WebSocket server closed');
        });
      } catch (error) {
        console.error('Error closing WebSocket server:', error);
      }
      wss = null;
    }

    // Close HTTP server
    httpServer.close(() => {
      console.log('HTTP server closed');
      httpServer = null;
      wsClients = null;
      // Clear global broadcast function
      global.broadcastEvent = null;
      global.sendEvent = null;
      resolve();
    });

    // Force close after timeout if graceful shutdown doesn't complete
    setTimeout(() => {
      if (httpServer) {
        console.log('Force closing HTTP server...');
        try {
          httpServer.close();
        } catch (error) {
          console.error('Error force closing server:', error);
        }
        httpServer = null;
        wsClients = null;
        wss = null;
        global.broadcastEvent = null;
        global.sendEvent = null;
        resolve();
      }
    }, 5000);
  });
}

// Restart HTTP server function
async function restartHttpServer() {
  try {
    console.log('Restarting HTTP server...');
    
    // Return success immediately so response can be sent via WebSocket
    // The actual restart will happen asynchronously after a delay
    // to allow the WebSocket response to be sent first
    setTimeout(async () => {
      try {
        // Stop the server
        await stopHttpServer();
        
        // Wait a brief moment to ensure port is released
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Restart the server
        await startHttpServer();
        
        console.log('HTTP server restarted successfully');
      } catch (error) {
        console.error('Error during server restart:', error);
      }
    }, 100); // Small delay to allow WebSocket response to be sent
    
    return { success: true, message: 'Server restart initiated' };
  } catch (error) {
    console.error('Error initiating server restart:', error);
    return { success: false, message: error.message || 'Failed to initiate server restart' };
  }
}

let db;
let mainWindow;
let isGeneratingHashes = false; // Track hash generation state
let isHashGenerationScheduled = false;

function scheduleBackgroundHashGeneration(reason) {
  if (!isServerMode) return;
  if (isGeneratingHashes || isHashGenerationScheduled) return;
  isHashGenerationScheduled = true;
  setTimeout(async () => {
    if (isGeneratingHashes) {
      isHashGenerationScheduled = false;
      return;
    }
    try {
      await calculateMissingHashesInternal(null);
      console.log(`Background hash generation completed (${reason || 'auto'})`);
    } catch (error) {
      console.error('Background hash generation failed:', error);
    } finally {
      isHashGenerationScheduled = false;
    }
  }, 500);
}

// IPC handler to expose server mode
ipcMain.handle('is-server-mode', () => {
  return isServerMode;
});

// IPC handler to restart server
ipcMain.handle('restart-server', async () => {
  if (!isServerMode) {
    return { success: false, message: 'Not in server mode' };
  }
  return await restartHttpServer();
});

// Handle single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('Another instance is already running. Quitting...');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // Create the main window and initialize the app
  app.whenReady().then(async () => {
    try {
      // Initialize database first
      if (!initializeDatabase()) {
        if (isServerMode) {
          console.error('Database Error: Failed to initialize database. The application will now quit.');
        } else {
          dialog.showErrorBox('Database Error', 'Failed to initialize database. The application will now quit.');
        }
        app.quit();
        return;
      }

      // Reset the version check flag on startup
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('false', 'versionCheckPerformedOnStartup');

      // Update the current version in the database
      try {
        db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(version, 'currentVersion');
        console.log('Updated currentVersion in database to:', version);
      } catch (versionError) {
        console.error('Error updating currentVersion in database:', versionError);
      }

      // Check for STL_HOME environment variable and set it if provided
      // This allows Docker users to configure STL Home via docker-compose.yml
      const stlHomeEnv = process.env.STL_HOME;
      if (stlHomeEnv && stlHomeEnv.trim() !== '') {
        try {
          db.prepare(`
            INSERT INTO settings (key, value) 
            VALUES (?, ?) 
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run('stlHome', stlHomeEnv.trim());
          console.log('STL_HOME environment variable set to:', stlHomeEnv.trim());
        } catch (stlHomeError) {
          console.error('Error setting STL_HOME from environment variable:', stlHomeError);
        }
      }

      // Check for EXTENSION_UPLOAD_DIR environment variable (Docker/NAS: where to save extension-uploaded files)
      const extensionUploadDirEnv = process.env.EXTENSION_UPLOAD_DIR;
      if (extensionUploadDirEnv && extensionUploadDirEnv.trim() !== '') {
        try {
          db.prepare(`
            INSERT INTO settings (key, value) 
            VALUES (?, ?) 
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
          `).run('extensionUploadDirectory', extensionUploadDirEnv.trim());
          console.log('EXTENSION_UPLOAD_DIR environment variable set to:', extensionUploadDirEnv.trim());
        } catch (extUploadError) {
          console.error('Error setting EXTENSION_UPLOAD_DIR from environment variable:', extUploadError);
        }
      }

      // Check for updates before creating window (skip in server mode)
      if (!isServerMode) {
        try {
          await checkForUpdates();
        } catch (updateError) {
          console.error('Error checking version on startup:', updateError);
          // Continue with app startup even if version check fails
        }
      }

      // Server mode: start HTTP server and create hidden window for IPC
      if (isServerMode) {
        try {
          await startHttpServer(5000, false); // Full server mode - listen on all interfaces
        } catch (err) {
          console.error('Server mode: failed to bind:', err.message);
          process.exit(1);
        }
        // Create a hidden BrowserWindow to handle IPC (preload script needs a window)
        await createHiddenWindow();
        // Schedule background hash generation for any existing models with missing hashes
        scheduleBackgroundHashGeneration('startup');
        // Don't quit when all windows are closed in server mode
        app.on('window-all-closed', () => {
          // Keep the app running in server mode
        });
      } else {
        // Normal mode: start localhost-only HTTP server only when Browser Extension is enabled
        const enableExt = db.prepare('SELECT value FROM settings WHERE key = ?').get('enableBrowserExtension')?.value;
        const portRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('browserExtensionPort');
        const extPort = parseInt(portRow?.value || '5000', 10) || 5000;
        if (enableExt === '1') {
          console.log('[Browser extension] Setting enabled at startup — starting server on port', extPort);
          startHttpServer(extPort, true).then(() => {
            console.log('[Browser extension] Server started successfully at startup');
          }).catch((err) => {
            console.error('[Browser extension] Failed to start server at startup:', err.message);
            console.error('[Browser extension] Run from Terminal to see this, or check entitlements (com.apple.security.network.server) and rebuild.');
            if (dialog && dialog.showErrorBox) {
              dialog.showErrorBox('Browser Extension Server', `Could not start server on port ${extPort}: ${err.message}\n\nOn macOS, the app needs the "Allow incoming network connections" entitlement. Rebuild the app after adding com.apple.security.network.server to build/entitlements.mac.plist.`);
            }
          });
        }
        // Normal mode: create window
        createWindow();

        app.on('activate', () => {
          if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
          }
        });

        createApplicationMenu();
      }
      
      // Track application usage after initialization (skip in server mode)
      if (!isServerMode) {
        await trackAppUsage();
      }
    } catch (error) {
      console.error('Error during app initialization:', error);
      if (isServerMode) {
        console.error('Startup Error: Failed to start application properly.');
      } else {
        dialog.showErrorBox('Startup Error', 'Failed to start application properly.');
      }
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Add this function to handle app updates
  app.on('ready', () => {
    // Store the user data path before any potential uninstall
    const userDataPath = app.getPath('userData');
    
    // Create a backup of the database before updates
    app.on('before-quit', async () => {
      try {
        const dbPath = getDatabasePath();
        const backupPath = path.join(userDataPath, 'backup_printventory.db');
        if (fs.existsSync(dbPath)) {
          await fs.promises.copyFile(dbPath, backupPath);
        }
      } catch (error) {
        console.error('Error creating backup:', error);
      }
    });
  });
}

// Add this function to initialize the database
function initializeDatabase() {
  try {
    const dbPath = getDatabasePath();
    console.log(`Initializing database at ${dbPath}`);
    
    // Create database directory if it doesn't exist
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    
    // Initialize database
    db = new Database(dbPath);
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    // Create tables in sequence
    db.transaction(() => {
      // Create models table
      db.prepare(`CREATE TABLE IF NOT EXISTS models (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          filePath TEXT UNIQUE,
          fileName TEXT,
          designer TEXT,
          source TEXT,
          notes TEXT,
          printed INTEGER,
          thumbnail TEXT,
          parentModel TEXT,
          hash TEXT,
          size INTEGER,
          license TEXT,
          modifiedDate DATETIME,
          dateAdded DATETIME
      )`).run();

      // Create tags table
      db.prepare(`CREATE TABLE IF NOT EXISTS tags (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT UNIQUE
      )`).run();

      // Create model_tags table
      db.prepare(`CREATE TABLE IF NOT EXISTS model_tags (
          model_id INTEGER,
          tag_id INTEGER,
          FOREIGN KEY(model_id) REFERENCES models(id),
          FOREIGN KEY(tag_id) REFERENCES tags(id),
          PRIMARY KEY(model_id, tag_id)
      )`).run();
      
      // Create settings table
      db.prepare(`CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
      )`).run();
      
      // Create slicers table
      db.prepare(`CREATE TABLE IF NOT EXISTS slicers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL
      )`).run();
      
      // Create indexes for better performance
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_filepath ON models(filePath)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_filename ON models(fileName)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_designer ON models(designer)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_tags_name ON tags(name)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_model_tags_tag_id ON model_tags(tag_id)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_model_tags_model_id ON model_tags(model_id)').run();
      
      // Single-column indexes for sorting and filtering
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_size ON models(size)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_modifieddate ON models(modifiedDate)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_license ON models(license)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_parentmodel ON models(parentModel)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_printed ON models(printed)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_hash ON models(hash)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_thumbnail ON models(thumbnail)').run();
      
      // Composite indexes for common query patterns
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_designer_filename ON models(designer, fileName)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_license_modifieddate ON models(license, modifiedDate)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_printed_modifieddate ON models(printed, modifiedDate)').run();
      db.prepare('CREATE INDEX IF NOT EXISTS idx_models_parentmodel_modifieddate ON models(parentModel, modifiedDate)').run();
    })();
    
    // Migrate existing database: add dateAdded column if it doesn't exist
    // This must run before creating indexes on dateAdded
    migrateDateAddedColumn();
    
    // Create index for dateAdded after migration (in case it was just added)
    db.prepare('CREATE INDEX IF NOT EXISTS idx_models_dateadded ON models(dateAdded)').run();
    
    // Clean up any database objects that reference models_old (from old migrations)
    cleanupModelsOldReferences();
    
    // Repair model_tags table to fix any foreign key issues
    repairModelTagsTable();
    
    // Check and create slicers table if it doesn't exist
    ensureSlicersTableExists();
    
    // Initialize default settings
    initializeDefaultSettings();
    
    return true;
  } catch (err) {
    console.error('Error initializing database:', err);
    dialog.showErrorBox('Database Error', 
      `Failed to initialize database: ${err.message}\n\nPath: ${getDatabasePath()}\n\nPlease ensure the application has write permissions to its directory.`
    );
    return false;
  }
}

// Add migration function for dateAdded column
function migrateDateAddedColumn() {
  try {
    console.log('Checking for dateAdded column migration...');
    
    // Check if dateAdded column exists
    const tableInfo = db.prepare("PRAGMA table_info(models)").all();
    const hasDateAdded = tableInfo.some(col => col.name === 'dateAdded');
    
    if (!hasDateAdded) {
      console.log('dateAdded column not found. Adding it...');
      
      // Add the column
      db.prepare('ALTER TABLE models ADD COLUMN dateAdded DATETIME').run();
      
      // For existing records, set dateAdded = modifiedDate as fallback, or current timestamp if modifiedDate is null
      db.prepare(`
        UPDATE models 
        SET dateAdded = COALESCE(modifiedDate, datetime('now'))
        WHERE dateAdded IS NULL
      `).run();
      
      console.log('dateAdded column added and existing records updated');
    } else {
      console.log('dateAdded column already exists');
    }
    
    return true;
  } catch (error) {
    console.error('Error migrating dateAdded column:', error);
    return false;
  }
}

// Add this function to clean up any database objects referencing models_old
function cleanupModelsOldReferences() {
  try {
    console.log('Checking for database objects referencing models_old...');
    
    // Check for triggers that reference models_old
    const triggers = db.prepare(`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='trigger' 
      AND (sql LIKE '%models_old%' OR sql LIKE '%modelsOld%')
    `).all();
    
    if (triggers.length > 0) {
      console.log(`Found ${triggers.length} trigger(s) referencing models_old. Removing them...`);
      for (const trigger of triggers) {
        try {
          db.prepare(`DROP TRIGGER IF EXISTS ${trigger.name}`).run();
          console.log(`Removed trigger: ${trigger.name}`);
        } catch (error) {
          console.error(`Error removing trigger ${trigger.name}:`, error);
        }
      }
    }
    
    // Check for views that reference models_old
    const views = db.prepare(`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='view' 
      AND (sql LIKE '%models_old%' OR sql LIKE '%modelsOld%')
    `).all();
    
    if (views.length > 0) {
      console.log(`Found ${views.length} view(s) referencing models_old. Removing them...`);
      for (const view of views) {
        try {
          db.prepare(`DROP VIEW IF EXISTS ${view.name}`).run();
          console.log(`Removed view: ${view.name}`);
        } catch (error) {
          console.error(`Error removing view ${view.name}:`, error);
        }
      }
    }
    
    // Check for indexes that reference models_old (unlikely but possible)
    const indexes = db.prepare(`
      SELECT name 
      FROM sqlite_master 
      WHERE type='index' 
      AND name LIKE '%models_old%'
    `).all();
    
    if (indexes.length > 0) {
      console.log(`Found ${indexes.length} index(es) referencing models_old. Removing them...`);
      for (const index of indexes) {
        try {
          db.prepare(`DROP INDEX IF EXISTS ${index.name}`).run();
          console.log(`Removed index: ${index.name}`);
        } catch (error) {
          console.error(`Error removing index ${index.name}:`, error);
        }
      }
    }
    
    console.log('Finished cleaning up models_old references');
    return true;
  } catch (error) {
    console.error('Error cleaning up models_old references:', error);
    return false;
  }
}

// Add this function to the initializeDatabase function
function repairModelTagsTable() {
  try {
    console.log('Checking and repairing model_tags table...');
    
    // Enable foreign keys
    db.pragma('foreign_keys = ON');
    
    // Check for orphaned records in model_tags
    const orphanedModelTags = db.prepare(`
      SELECT mt.model_id, mt.tag_id 
      FROM model_tags mt
      LEFT JOIN models m ON mt.model_id = m.id
      LEFT JOIN tags t ON mt.tag_id = t.id
      WHERE m.id IS NULL OR t.id IS NULL
    `).all();
    
    if (orphanedModelTags.length > 0) {
      console.log(`Found ${orphanedModelTags.length} orphaned model_tags records. Cleaning up...`);
      
      // Delete orphaned records
      db.prepare(`
        DELETE FROM model_tags 
        WHERE (model_id, tag_id) IN (
          SELECT mt.model_id, mt.tag_id
          FROM model_tags mt
          LEFT JOIN models m ON mt.model_id = m.id
          LEFT JOIN tags t ON mt.tag_id = t.id
          WHERE m.id IS NULL OR t.id IS NULL
        )
      `).run();
      
      console.log('Orphaned records cleaned up');
    } else {
      console.log('No orphaned model_tags records found');
    }
    
    return true;
  } catch (error) {
    console.error('Error repairing model_tags table:', error);
    return false;
  }
}

// Add this function after repairModelTagsTable
function initializeDefaultSettings() {
  try {
    console.log('Initializing default settings...');
    
    // Check if settings table exists
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'").get();
    if (!tableExists) {
      db.prepare('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)').run();
    }

    // Define default settings
    const defaultSettings = [
      { key: 'tosAcceptedDate', value: null },
      { key: 'theme', value: 'light' },
      { key: 'apiKey', value: null },
      { key: 'aiModel', value: 'gpt-5-nano' },
      { key: 'maxThumbnailSize', value: '300' },
      { key: 'maxConcurrentRenders', value: '3' },
      { key: 'lastVersionCheck', value: new Date().toISOString() },
      { key: 'CollectUsage', value: '1' }, // Default to opt-in for analytics
      { key: 'ClientId', value: crypto.randomUUID() }, // Generate a unique client ID
      { key: 'currentVersion', value: version }, // Use imported version from package.json
      { key: 'versionCheckPerformedOnStartup', value: 'false' }, // New setting for version check tracking
      { key: 'enableZipArchives', value: '0' }, // ZIP archive support disabled by default
      { key: 'scanAdditionalFileTypes', value: '[]' }, // JSON array of catalog ids for additional scan types (e.g. ["obj","step"])
      { key: 'aiTagMaxTags', value: '10' }, // Maximum number of AI-generated tags
      { key: 'aiTagUseCategories', value: '0' }, // Use category-based tagging
      { key: 'aiTagMergeStrategy', value: 'merge' }, // How to merge AI tags: 'replace', 'merge', 'append'
      { key: 'aiTagAllowRetagging', value: '0' }, // Allow re-tagging even if "AI Tagged" exists
      { key: 'aiTagConcurrency', value: '3' }, // Number of concurrent tag generation requests
      { key: 'enableBrowserExtension', value: '0' }, // Browser extension local server disabled by default
      { key: 'browserExtensionPort', value: '5000' }, // Port for browser extension server (default 5000)
    ];
    
    // Insert default settings if they don't exist
    const insertStmt = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
    
    for (const setting of defaultSettings) {
      insertStmt.run(setting.key, setting.value);
    }
    
    console.log('Default settings initialized');
    return true;
  } catch (error) {
    console.error('Error initializing default settings:', error);
    return false;
  }
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  mainWindow = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(1000, height),
    backgroundColor: '#1e1e2e', // Match app's dark theme to prevent white flash
    show: false, // Don't show until ready to prevent white flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      // Add these settings for clipboard access
      sandbox: false,
      enableWebSQL: false,
      webSecurity: true // Keep web security enabled, but allow puter.com API calls
    }
  });
  // mainWindow.webContents.openDevTools() // Disabled - prevents auto-opening debug console on load
  
  // Allow puter.com API requests (handle CORS if needed)
  mainWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ['https://api.puter.com/*', 'https://js.puter.com/*'] },
    (details, callback) => {
      // Add headers for puter.com API requests
      details.requestHeaders['Origin'] = 'https://puter.com';
      details.requestHeaders['Referer'] = 'https://puter.com/';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          click: () => mainWindow.webContents.reload()
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'AI Config',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('open-ai-config');
            }
          }
        },
        {
          label: 'File Type',
          click: () => mainWindow.webContents.send('open-file-type-settings')
        },
        {
          label: 'Performance',
          click: () => mainWindow.webContents.send('open-performance-settings')
        },
        ...(isServerMode ? [] : [{
          label: 'Slicer Path',
          click: () => mainWindow.webContents.send('open-slicer-settings')
        }]),
        {
          label: 'STL Home',
          click: () => mainWindow.webContents.send('open-stl-home')
        },
        {
          label: 'Theme',
          click: () => mainWindow.webContents.send('open-theme-settings')
        }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Print Roulette',
          click: () => mainWindow.webContents.send('start-print-roulette')
        },
        {
          label: 'De-Dup',
          click: () => {
            mainWindow.webContents.send('open-dedup');
          }
        },
        ...(isServerMode ? [] : [{
          label: 'Browser Extension',
          click: () => mainWindow.webContents.send('open-browser-extension-settings')
        }]),
        { type: 'separator' },
        {
          label: 'Tag Manager',
          click: () => mainWindow.webContents.send('open-tag-manager')
        },
        {
          label: 'Metadata Manager',
          click: () => mainWindow.webContents.send('open-metadata-editor')
        },
        {
          label: 'Backup/Restore',
          click: () => mainWindow.webContents.send('open-backup-restore')
        },
        { type: 'separator' },
        {
          label: 'Regenerate Thumbnails',
          click: () => mainWindow.webContents.send('regenerate-thumbnails')
        },
        {
          label: 'Generate Missing Thumbnails',
          click: () => mainWindow.webContents.send('generate-missing-thumbnails')
        },
        {
          label: 'Purge Models',
          click: () => mainWindow.webContents.send('open-purge-models')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Quick Start Guide',
          click: () => {
            mainWindow.webContents.send('open-guide');
          }
        },
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            mainWindow.webContents.send('open-keyboard-shortcuts');
          }
        },
        {
          label: 'FAQ',
          click: async () => {
            await shell.openExternal('https://printventory.com/faq.html');
          }
        },
        {
          label: 'About',
          click: async () => {
            // Send event to renderer to open the about dialog
            mainWindow.webContents.send('open-about');
            
            // Log for debugging
            console.log('About menu item clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'Discord',
          click: async () => {
            await shell.openExternal('https://discord.gg/JXcZHT77ua');
          }
        },
        {
          label: 'Patreon',
          click: async () => {
            await shell.openExternal('https://patreon.com/Printventory');
          }
        },
        {
          label: 'Support Printventory',
          click: async () => {
            await shell.openExternal('https://printventory.com/support.html');
          }
        },
        {
          label: 'GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/TechJeeper/Printventory');
          }
        },
        { type: 'separator' },
        {
          label: 'Library Stats',
          click: () => {
            mainWindow.webContents.send('open-stats');
          }
        },
        ...(isServerMode ? [{
          label: 'System Report',
          click: () => {
            mainWindow.webContents.send('open-system-report');
          }
        }] : []),
        {
          label: 'Server Mode Info',
          click: async () => {
            await shell.openExternal('https://github.com/TechJeeper/Printventory?tab=readme-ov-file#server-mode');
          }
        },
        {
          label: 'Debug Console',
          click: () => mainWindow.webContents.openDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  mainWindow.loadFile('index.html');

  // Show the window only when it is ready to be shown
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Set up keep-alive ping
  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('ping');
    }
  }, PING_INTERVAL);
}

function createApplicationMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload',
          click: () => mainWindow.webContents.reload()
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'Settings',
      submenu: [
        {
          label: 'AI Config',
          click: () => mainWindow.webContents.send('open-ai-config')
        },
        {
          label: 'File Type',
          click: () => mainWindow.webContents.send('open-file-type-settings')
        },
        {
          label: 'Performance',
          click: () => mainWindow.webContents.send('open-performance-settings')
        },
        ...(isServerMode ? [] : [{
          label: 'Slicer Path',
          click: () => mainWindow.webContents.send('open-slicer-settings')
        }]),
        {
          label: 'STL Home',
          click: () => mainWindow.webContents.send('open-stl-home')
        },
        {
          label: 'Theme',
          click: () => mainWindow.webContents.send('open-theme-settings')
        }
      ]
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Print Roulette',
          click: () => mainWindow.webContents.send('start-print-roulette')
        },
        {
          label: 'De-Dup',
          click: () => {
            mainWindow.webContents.send('open-dedup');
          }
        },
        ...(isServerMode ? [] : [{
          label: 'Browser Extension',
          click: () => mainWindow.webContents.send('open-browser-extension-settings')
        }]),
        { type: 'separator' },
        {
          label: 'Tag Manager',
          click: () => mainWindow.webContents.send('open-tag-manager')
        },
        {
          label: 'Metadata Manager',
          click: () => mainWindow.webContents.send('open-metadata-editor')
        },
        {
          label: 'Backup/Restore',
          click: () => mainWindow.webContents.send('open-backup-restore')
        },
        { type: 'separator' },
        {
          label: 'Regenerate Thumbnails',
          click: () => mainWindow.webContents.send('regenerate-thumbnails')
        },
        {
          label: 'Generate Missing Thumbnails',
          click: () => mainWindow.webContents.send('generate-missing-thumbnails')
        },
        {
          label: 'Purge Models',
          click: () => mainWindow.webContents.send('open-purge-models')
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'Quick Start Guide',
          click: () => {
            mainWindow.webContents.send('open-guide');
          }
        },
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            mainWindow.webContents.send('open-keyboard-shortcuts');
          }
        },
        {
          label: 'FAQ',
          click: async () => {
            await shell.openExternal('https://printventory.com/faq.html');
          }
        },
        {
          label: 'About',
          click: async () => {
            // Send event to renderer to open the about dialog
            mainWindow.webContents.send('open-about');
            
            // Log for debugging
            console.log('About menu item clicked');
          }
        },
        { type: 'separator' },
        {
          label: 'Discord',
          click: async () => {
            await shell.openExternal('https://discord.gg/JXcZHT77ua');
          }
        },
        {
          label: 'Patreon',
          click: async () => {
            await shell.openExternal('https://patreon.com/Printventory');
          }
        },
        {
          label: 'Support Printventory',
          click: async () => {
            await shell.openExternal('https://printventory.com/support.html');
          }
        },
        {
          label: 'GitHub',
          click: async () => {
            await shell.openExternal('https://github.com/TechJeeper/Printventory');
          }
        },
        { type: 'separator' },
        {
          label: 'Library Stats',
          click: () => {
            mainWindow.webContents.send('open-stats');
          }
        },
        ...(isServerMode ? [{
          label: 'System Report',
          click: () => {
            mainWindow.webContents.send('open-system-report');
          }
        }] : []),
        {
          label: 'Server Mode Info',
          click: async () => {
            await shell.openExternal('https://github.com/TechJeeper/Printventory?tab=readme-ov-file#server-mode');
          }
        },
        {
          label: 'Debug Console',
          click: () => mainWindow.webContents.openDevTools()
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

ipcMain.handle('load-directory', async () => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('directoryPath');
    return row ? row.value : null;
  } catch (error) {
    console.error('Error loading directory:', error);
    throw error;
  }
});

ipcMain.handle('save-directory', async (event, directoryPath) => {
  try {
    db.prepare(`
      INSERT INTO settings (key, value) 
      VALUES (?, ?) 
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run('directoryPath', directoryPath);
    return true;
  } catch (error) {
    console.error('Error saving directory:', error);
    throw error;
  }
});

ipcMain.handle('open-file-dialog', async () => {
  // Test mode: use fixed path so Playwright/Cline can run scan without native dialog (desktop: C:\temp, server/docker: /test)
  const testPath = process.env.PRINTVENTORY_TEST_SCAN_PATH;
  if (testPath && typeof testPath === 'string') {
    return [testPath];
  }
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (result.canceled) {
    return null;
  } else {
    return result.filePaths;
  }
});

// Update the calculateFileHash function to be more robust and handle zip entries
async function calculateFileHash(filePath) {
  // Check if this is a zip entry
  const pathInfo = parseZipPath(filePath);
  let actualFilePath = filePath;
  let tempFilePath = null;

  if (pathInfo.isZipEntry) {
    // For zip entries, extract to temp file first
    try {
      actualFilePath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
      tempFilePath = actualFilePath;
      debugLog(`Extracted zip entry to temp file for hashing: ${actualFilePath}`);
    } catch (error) {
      console.error(`Error extracting zip entry for hashing: ${filePath}`, error);
      throw new Error(`Failed to extract zip entry for hashing: ${error.message}`);
    }
  }

  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(actualFilePath);
    
      stream.on('error', err => {
      console.error(`Error reading file for hashing: ${actualFilePath}`, err);
      // Clean up temp file if it exists
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
        } catch (unlinkErr) {
          console.warn(`Failed to delete temp file: ${tempFilePath}`, unlinkErr);
        }
      }
      reject(err);
    });

    stream.on('data', chunk => {
      try {
        hash.update(chunk);
      } catch (err) {
        console.error(`Error updating hash for file: ${actualFilePath}`, err);
        // Clean up temp file if it exists
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkErr) {
            console.warn(`Failed to delete temp file: ${tempFilePath}`, unlinkErr);
          }
        }
        reject(err);
      }
    });

    stream.on('end', () => {
      try {
        const fileHash = hash.digest('hex');
        debugLog(`Generated hash for ${filePath}: ${fileHash}`);
        
        // Clean up temp file if it exists
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlink(tempFilePath, (err) => {
            if (err) {
              console.warn(`Failed to delete temp file: ${tempFilePath}`, err);
            }
          });
        }
        
        resolve(fileHash);
      } catch (err) {
        console.error(`Error generating final hash for file: ${filePath}`, err);
        // Clean up temp file if it exists
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try {
            fs.unlinkSync(tempFilePath);
          } catch (unlinkErr) {
            console.warn(`Failed to delete temp file: ${tempFilePath}`, unlinkErr);
          }
        }
        reject(err);
      }
    });
  });
}

// Update the isValidFile function to get the max file size from settings
async function getMaxFileSize() {
  try {
    const maxFileSize = await db.prepare('SELECT value FROM settings WHERE key = ?').get('maxFileSizeMB');
    return maxFileSize ? parseInt(maxFileSize.value) * 1024 * 1024 : 50 * 1024 * 1024;
  } catch (error) {
    console.error('Error getting max file size:', error);
    return 50 * 1024 * 1024; // Default to 50MB if there's an error
  }
}

// Add this helper function
function normalizePath(filepath) {
  return filepath.replace(/\\/g, '/');
}

// Apply path-based metadata for STL Home scan: segments from root (From Root) or from model up (From Model).
// Only sets designer/parentModel when current value is empty. Uses pathMetadataStlHomeEnabled, pathMetadataStlHomeDirection,
// pathMetadataUseDesigner, pathMetadataUseParentModel, pathMetadataDesignerIndex, pathMetadataParentModelIndex.
function applyPathMetadataFromSegments(scanRootPath, filePaths) {
  if (!db || !db.prepare) return;
  const enabledRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('pathMetadataStlHomeEnabled');
  if (!enabledRow || enabledRow.value !== '1') return;
  const directionRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('pathMetadataStlHomeDirection');
  const fromRoot = directionRow?.value === 'fromRoot';
  const useDesigner = db.prepare('SELECT value FROM settings WHERE key = ?').get('pathMetadataUseDesigner');
  const useParentModel = db.prepare('SELECT value FROM settings WHERE key = ?').get('pathMetadataUseParentModel');
  const designerIndexRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('pathMetadataDesignerIndex');
  const parentModelIndexRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('pathMetadataParentModelIndex');
  const applyDesigner = useDesigner?.value === '1';
  const applyParentModel = useParentModel?.value === '1';
  if (!applyDesigner && !applyParentModel) return;
  const rawDesigner = parseInt(designerIndexRow?.value, 10);
  const rawParent = parseInt(parentModelIndexRow?.value, 10);
  const designerIndex = Math.max(0, Number.isInteger(rawDesigner) ? rawDesigner : 0);
  const parentModelIndex = Math.max(0, Number.isInteger(rawParent) ? rawParent : 0);
  const getModel = db.prepare('SELECT id, designer, parentModel FROM models WHERE filePath = ?');
  const updateModel = db.prepare('UPDATE models SET designer = ?, parentModel = ? WHERE id = ?');
  const normalizedRoot = normalizePath(scanRootPath).replace(/\/$/, '');
  const rootSegment = normalizedRoot.split('/').filter(Boolean).pop() || '';
  for (const filePath of filePaths) {
    let relativeDir;
    if (filePath.includes('::')) {
      const entryPath = filePath.split('::')[1] || '';
      relativeDir = path.dirname(entryPath);
    } else {
      const normalizedFile = normalizePath(filePath);
      const relative = path.relative(normalizedRoot, normalizedFile);
      relativeDir = path.dirname(relative);
    }
    const segmentsRootToFile = normalizePath(relativeDir).split('/').filter(Boolean);
    // From Root: level 0 = STL Home, 1 = first folder under it, ... From Model: level 0 = parent of file, 1 = grandparent, ...
    const segments = fromRoot ? [rootSegment, ...segmentsRootToFile] : segmentsRootToFile.slice().reverse();
    const derivedDesigner = applyDesigner && segments.length > designerIndex ? segments[designerIndex] : null;
    const derivedParentModel = applyParentModel && segments.length > parentModelIndex ? segments[parentModelIndex] : null;
    const model = getModel.get(filePath);
    if (!model) continue;
    const currentDesigner = model.designer == null || String(model.designer).trim() === '' ? null : model.designer;
    const currentParentModel = model.parentModel == null || String(model.parentModel).trim() === '' ? null : model.parentModel;
    const newDesigner = (currentDesigner == null && derivedDesigner) ? derivedDesigner : currentDesigner;
    const newParentModel = (currentParentModel == null && derivedParentModel) ? derivedParentModel : currentParentModel;
    if (newDesigner !== currentDesigner || newParentModel !== currentParentModel) {
      updateModel.run(newDesigner || null, newParentModel || null, model.id);
    }
  }
}

// Helper function to check if a zip entry exists
async function checkZipEntryExists(zipPath, entryPath) {
  try {
    if (!fs.existsSync(zipPath)) {
      return false;
    }
    const StreamZip = require('node-stream-zip');
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();
    await zip.close();
    return entries[entryPath] !== undefined;
  } catch (error) {
    console.error(`Error checking zip entry existence for ${zipPath}::${entryPath}:`, error);
    return false;
  }
}

// Update the removeNonExistentFiles function
async function removeNonExistentFiles(scanDirectoryPath, window = null) {
  try {
    // OPTIMIZATION: Only query models in the scanned directory using SQL instead of loading all models
    // This dramatically reduces memory usage and improves performance, especially for large databases
    const normalizedScanPath = normalizePath(scanDirectoryPath).replace(/\/$/, '');
    const scanPathPattern = normalizedScanPath + '%';
    
    // Query only models that are in the scanned directory
    // Use LIKE for path matching (case-insensitive on Windows)
    const modelsInDirectory = process.platform === 'win32'
      ? db.prepare('SELECT filePath, id FROM models WHERE LOWER(filePath) LIKE LOWER(?)').all(scanPathPattern)
      : db.prepare('SELECT filePath, id FROM models WHERE filePath LIKE ?').all(scanPathPattern);
    
    if (modelsInDirectory.length === 0) {
      return 0; // No models in this directory, nothing to check
    }
    
    const filesToDelete = [];
    
    // OPTIMIZATION: Batch file existence checks with concurrency limit
    // This prevents overwhelming the file system, especially in Docker/network share scenarios
    // Sequential checks were causing massive slowdowns (10-100ms per file in Docker)
    const MAX_CONCURRENT_CHECKS = 20; // Limit concurrent file system operations
    const checkPromises = [];
    
    for (let i = 0; i < modelsInDirectory.length; i += MAX_CONCURRENT_CHECKS) {
      const batch = modelsInDirectory.slice(i, i + MAX_CONCURRENT_CHECKS);
      const batchPromises = batch.map(async (model) => {
        const pathInfo = parseZipPath(model.filePath);
        let fileExists = false;
        
        if (pathInfo.isZipEntry) {
          // For zip entries, check if the zip file exists and the entry exists within it
          try {
            fileExists = await checkZipEntryExists(pathInfo.zipPath, pathInfo.entryPath);
          } catch (error) {
            console.error(`Error checking zip entry ${model.filePath}:`, error);
            fileExists = false;
          }
        } else {
          // For regular files, check if the file exists
          try {
            // First try the path as stored
            try {
              await fs.promises.access(model.filePath, fs.constants.F_OK);
              fileExists = true;
            } catch (accessError) {
              // If access fails, try normalizing the path (handles forward/backslash issues)
              const normalizedPath = path.normalize(model.filePath);
              if (normalizedPath !== model.filePath) {
                try {
                  await fs.promises.access(normalizedPath, fs.constants.F_OK);
                  fileExists = true;
                } catch (normalizedError) {
                  fileExists = false;
                }
              } else {
                fileExists = false;
              }
            }
          } catch (error) {
            console.error(`Error checking file existence for ${model.filePath}:`, error);
            fileExists = false;
          }
        }
        
        if (!fileExists) {
          debugLog(`File marked as non-existent: ${model.filePath}`);
          filesToDelete.push({
            filePath: model.filePath,
            id: model.id
          });
        }
      });
      
      // Wait for this batch to complete before starting the next batch
      await Promise.all(batchPromises);
    }

    // If there are files to delete, show confirmation dialog
    if (filesToDelete.length > 0) {
      // Get the window to show dialog - use provided window, mainWindow, or any available window
      let dialogWindow = window;
      if (!dialogWindow) {
        dialogWindow = mainWindow;
      }
      if (!dialogWindow) {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          dialogWindow = windows[0];
        }
      }

      // Prepare file list for display (limit to first 20 files, show just filename)
      const fileList = filesToDelete.slice(0, 20).map(f => {
        const fileName = path.basename(f.filePath);
        return fileName;
      }).join('\n');
      const moreFiles = filesToDelete.length > 20 ? `\n... and ${filesToDelete.length - 20} more file(s)` : '';
      
      // In server mode or test mode, avoid blocking dialog
      if (isServerMode) {
        // Auto-remove in server mode - use transaction for better performance
        db.transaction(() => {
          for (const file of filesToDelete) {
            // First delete from model_tags (child table)
            db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(file.id);
            // Then delete from models (parent table)
            db.prepare('DELETE FROM models WHERE id = ?').run(file.id);
          }
        })();
        console.log(`Server mode: Removed ${filesToDelete.length} non-existent files from library`);
        return filesToDelete.length; // Return early in server mode to avoid duplicate deletion
      } else if (process.env.PRINTVENTORY_TEST_SCAN_PATH) {
        // Test mode: skip dialog and skip removal so tests don't hang
        console.log(`Test mode: skipping removal of ${filesToDelete.length} non-existent files from directory ${scanDirectoryPath}`);
        return 0;
      } else {
        const result = await dialog.showMessageBox(dialogWindow || undefined, {
          type: 'warning',
          title: 'Confirm File Removal',
          message: `The scan found ${filesToDelete.length} file${filesToDelete.length === 1 ? '' : 's'} in the library that no longer exist on disk.`,
          detail: `These files will be removed from the library (files are not deleted from disk):\n\n${fileList}${moreFiles}\n\nDo you want to proceed?`,
          buttons: ['Remove from Library', 'Skip'],
          defaultId: 1,
          cancelId: 1,
        });

        // If user clicked "Skip", return 0 without deleting
        if (result.response === 1) {
          console.log(`User skipped removal of ${filesToDelete.length} non-existent files from directory ${scanDirectoryPath}`);
          return 0;
        }
      }
    }

    // Proceed with deletion if user confirmed or if there were no files to delete
    let removedCount = 0;
    db.transaction(() => {
      for (const fileInfo of filesToDelete) {
        // First delete from model_tags (child table)
        db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(fileInfo.id);
        
        // Then delete from models (parent table)
        db.prepare('DELETE FROM models WHERE id = ?').run(fileInfo.id);
        
        removedCount++;
      }
    })();

    if (removedCount > 0) {
      console.log(`Removed ${removedCount} non-existent files from directory ${scanDirectoryPath}`);
    }
    
    return removedCount;
  } catch (error) {
    console.error('Error removing non-existent files:', error);
    throw error;
  }
}

// Update the scan-directory handler to use a more efficient scanning process
ipcMain.handle('scan-directory', async (event, directoryPath, options = {}) => {
  try {
    // Validate UNC path in server mode
    try {
      validateUncPath(directoryPath, 'scan-directory');
    } catch (validationError) {
      throw new Error(validationError.message);
    }
    
    debugLog('Starting directory scan:', directoryPath);
    const maxFileSize = await getMaxFileSize();
    
    // Read enableZipArchives and scanAdditionalFileTypes from database
    const zipSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('enableZipArchives');
    const enableZipArchives = zipSetting && zipSetting.value === '1';
    let scanExtensions = ['.stl', '.3mf'];
    try {
      const scanTypesSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('scanAdditionalFileTypes');
      if (scanTypesSetting && scanTypesSetting.value) {
        const selectedIds = JSON.parse(scanTypesSetting.value);
        if (Array.isArray(selectedIds)) scanExtensions = getScanExtensions(selectedIds);
      }
    } catch (e) { /* ignore */ }
    
    // First, remove any non-existent files from the scanned directory
    // Pass the window so we can show a confirmation dialog if needed (null in server mode)
    const window = isServerMode ? null : BrowserWindow.fromWebContents(event.sender);
    const removedCount = await removeNonExistentFiles(directoryPath, window);
    if (removedCount > 0) {
      event.sender.send('db-cleanup', {
        message: `Removed ${removedCount} non-existent files from directory ${directoryPath}`
      });
    }

    return new Promise((resolve, reject) => {
      // Use scan-worker.js for scanning (supports zip files)
      // Handle asar archive case - worker threads can't load from inside asar
      let workerPath = path.join(__dirname, 'scan-worker.js');
      
      // Check if we're in an asar archive (worker threads can't load from asar)
      if (__dirname.includes('.asar')) {
        // scan-worker.js should be unpacked to app.asar.unpacked
        const unpackedPath = __dirname.replace('.asar', '.asar.unpacked');
        const unpackedWorkerPath = path.join(unpackedPath, 'scan-worker.js');
        if (fs.existsSync(unpackedWorkerPath)) {
          workerPath = unpackedWorkerPath;
          console.log(`[Main] Using unpacked worker from: ${unpackedWorkerPath}`);
        } else {
          // Fallback: try using process.resourcesPath (for built apps)
          if (process.resourcesPath) {
            const resourcesWorkerPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'scan-worker.js');
            if (fs.existsSync(resourcesWorkerPath)) {
              workerPath = resourcesWorkerPath;
              console.log(`[Main] Using worker from resourcesPath: ${resourcesWorkerPath}`);
            } else {
              // Last resort: copy to temp directory (shouldn't be needed if unpacked correctly)
              console.warn(`[Main] WARNING: scan-worker.js not found in app.asar.unpacked, copying to temp as fallback`);
              const tempDir = path.join(os.tmpdir(), 'printventory-worker');
              if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
              }
              const tempWorkerPath = path.join(tempDir, 'scan-worker.js');
              // Only copy if it doesn't exist
              if (!fs.existsSync(tempWorkerPath)) {
                try {
                  // Read from asar using fs.readFileSync (this works even from asar)
                  const asarWorkerPath = path.join(__dirname, 'scan-worker.js');
                  const workerContent = fs.readFileSync(asarWorkerPath);
                  fs.writeFileSync(tempWorkerPath, workerContent);
                } catch (error) {
                  console.error('Error copying scan-worker.js from asar:', error);
                  reject(new Error(`Failed to load scan-worker.js: ${error.message}`));
                  return;
                }
              }
              workerPath = tempWorkerPath;
            }
          } else {
            reject(new Error(`scan-worker.js not found in app.asar.unpacked and process.resourcesPath is not available`));
            return;
          }
        }
      }
      
      // Verify the worker file exists before creating the worker
      if (!fs.existsSync(workerPath)) {
        reject(new Error(`scan-worker.js not found at: ${workerPath}`));
        return;
      }
      
      const worker = new Worker(workerPath);

      // Set up worker message handling
      worker.on('message', async (message) => {
        if (message.type === 'progress') {
          // Send progress to renderer
          event.sender.send('scan-progress', {
            processed: message.processed
          });
        } else if (message.type === 'done') {
          const { files, totalFiles } = message.result;
          
          try {
            // Process files in larger batches for better performance
            const batchSize = 100; // Increased batch size
            // Preserve existing hash when scan doesn't provide one (worker sends null to avoid slow scans).
            // Otherwise every scan would overwrite hashes with '' and trigger full hash regeneration on each start.
            const updateExisting = db.prepare(`
              UPDATE models 
              SET hash = COALESCE(NULLIF(?, ''), hash), size = ?, modifiedDate = ?
              WHERE filePath = ?
            `);
            
            const insertNew = db.prepare(`
              INSERT INTO models (
                filePath, fileName, hash, size, modifiedDate, dateAdded
              ) VALUES (?, ?, ?, ?, ?, ?)
            `);

            // Track count of newly inserted files
            let newFilesCount = 0;
            
            // OPTIMIZATION: Batch check existence of all files at once instead of N+1 queries
            // This dramatically improves performance, especially in Docker environments
            const allFilePaths = files.map(f => f.filePath);
            const existingFilePaths = new Set();
            
            // Query all existing filePaths in batches to avoid SQLite parameter limits
            const existenceCheckBatchSize = 500; // SQLite supports up to 999 parameters
            for (let i = 0; i < allFilePaths.length; i += existenceCheckBatchSize) {
              const pathBatch = allFilePaths.slice(i, i + existenceCheckBatchSize);
              const placeholders = pathBatch.map(() => '?').join(',');
              const existing = db.prepare(`SELECT filePath FROM models WHERE filePath IN (${placeholders})`).all(...pathBatch);
              existing.forEach(row => existingFilePaths.add(row.filePath));
            }
            
            // Use a transaction for better performance
            db.transaction(() => {
              for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                
                for (const file of batch) {
                  // Use Set lookup instead of database query - O(1) vs O(log n) database query
                  if (existingFilePaths.has(file.filePath)) {
                    updateExisting.run(
                      file.hash || '',
                      file.size,
                      file.mtime.toISOString(),
                      file.filePath
                    );
                  } else {
                    const dateAdded = new Date().toISOString();
                    insertNew.run(
                      file.filePath,
                      file.fileName,
                      file.hash || '',
                      file.size,
                      file.mtime.toISOString(),
                      dateAdded
                    );
                    newFilesCount++;
                    // Add to set so we don't try to insert duplicates within the same transaction
                    existingFilePaths.add(file.filePath);
                  }
                }
                
                // Send batch progress to renderer
                event.sender.send('db-progress', {
                  total: files.length,
                  processed: Math.min(i + batchSize, files.length)
                });
              }
            })();

            worker.terminate();

            // STL Home scan with path metadata: set designer/parent from folder segments (from model level up) when enabled
            if (options.isStlHomeScan && Array.isArray(allFilePaths) && allFilePaths.length > 0) {
              try {
                applyPathMetadataFromSegments(directoryPath, allFilePaths);
              } catch (pathMetaErr) {
                console.error('Path metadata from folder (STL Home):', pathMetaErr);
              }
            }
            
            resolve({ files, totalFiles, newFilesCount });

            scheduleBackgroundHashGeneration('scan-directory');
            
            // Send refresh-grid event to update the UI after scanning completes
            // Use setTimeout to ensure the promise resolves first and database is fully updated
            setTimeout(() => {
              if (isServerMode && global.broadcastEvent) {
                global.broadcastEvent('refresh-grid');
              } else {
                event.sender.send('refresh-grid');
              }
            }, 100);
          } catch (error) {
            worker.terminate();
            reject(error);
          }
        } else if (message.type === 'error') {
          worker.terminate();
          reject(new Error(message.error));
        }
      });

      // Handle worker errors
      worker.on('error', (error) => {
        worker.terminate();
        reject(error);
      });

      // Handle worker exit
      worker.on('exit', (code) => {
        if (code !== 0) {
          reject(new Error(`Worker stopped with exit code ${code}`));
        }
      });

      // Start the worker - pass node_modules path so worker can find dependencies
      // When in asar, node_modules is typically in app.asar.unpacked/node_modules
      // When not in asar, node_modules is in the app directory
      let nodeModulesPath;
      
      // Use process.resourcesPath if available (Electron provides this in built apps)
      // It points to the Resources directory where app.asar.unpacked is located
      if (process.resourcesPath) {
        // In built Electron app, resourcesPath points to Resources directory
        // app.asar.unpacked is at Resources/app.asar.unpacked
        const unpackedNodeModules = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules');
        if (fs.existsSync(unpackedNodeModules)) {
          nodeModulesPath = unpackedNodeModules;
        } else {
          // Fallback: try Resources/app/node_modules
          const appNodeModules = path.join(process.resourcesPath, 'app', 'node_modules');
          if (fs.existsSync(appNodeModules)) {
            nodeModulesPath = appNodeModules;
          }
        }
      }
      
      // If resourcesPath didn't work, try based on __dirname
      if (!nodeModulesPath || !fs.existsSync(nodeModulesPath)) {
        if (__dirname.includes('.asar')) {
          // In asar archive, node_modules should be in app.asar.unpacked
          const unpackedPath = __dirname.replace('.asar', '.asar.unpacked');
          nodeModulesPath = path.join(unpackedPath, 'node_modules');
          // If that doesn't exist, try app/node_modules (for macOS)
          if (!fs.existsSync(nodeModulesPath)) {
            const appPath = path.dirname(__dirname.replace('.asar', ''));
            nodeModulesPath = path.join(appPath, 'node_modules');
          }
          // Also try Resources/app/node_modules (macOS app bundle structure)
          if (!fs.existsSync(nodeModulesPath)) {
            const resourcesPath = path.join(path.dirname(__dirname.replace('.asar', '')), '..', 'Resources');
            const macNodeModules = path.join(resourcesPath, 'app', 'node_modules');
            if (fs.existsSync(macNodeModules)) {
              nodeModulesPath = macNodeModules;
            }
          }
        } else {
          // Not in asar, node_modules is in the app directory
          nodeModulesPath = path.join(__dirname, 'node_modules');
        }
      }
      
      console.log(`[Main] Sending node_modules path to worker: ${nodeModulesPath}`);
      console.log(`[Main] node_modules exists: ${fs.existsSync(nodeModulesPath)}`);
      if (nodeModulesPath && fs.existsSync(path.join(nodeModulesPath, 'node-stream-zip'))) {
        console.log(`[Main] node-stream-zip found in node_modules`);
      } else {
        console.warn(`[Main] WARNING: node-stream-zip not found in ${nodeModulesPath}`);
        // Try to find it in common locations for debugging
        const debugPaths = [
          path.join(process.resourcesPath || '', 'app.asar.unpacked', 'node_modules', 'node-stream-zip'),
          path.join(__dirname.replace('.asar', '.asar.unpacked'), 'node_modules', 'node-stream-zip'),
        ];
        for (const debugPath of debugPaths) {
          if (fs.existsSync(debugPath)) {
            console.log(`[Main] Found node-stream-zip at: ${debugPath}`);
          }
        }
      }
      
      worker.postMessage({ 
        directoryPath, 
        maxFileSize, 
        enableZipArchives,
        scanExtensions,
        nodeModulesPath: nodeModulesPath
      });
    });

  } catch (error) {
    console.error('Error in scan-directory handler:', error);
    throw error;
  }
});

ipcMain.handle('get-model', async (event, filePath) => {
  try {
    const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
    if (!model) return null;

    // Get tags for this model
    const tags = db.prepare(`
      SELECT t.name 
      FROM tags t 
      JOIN model_tags mt ON mt.tag_id = t.id 
      WHERE mt.model_id = ?
    `).all(model.id).map(t => t.name);

    // Parse any JSON fields
    return {
      ...model,
      tags: tags || []
    };
  } catch (error) {
    console.error('Error getting model:', error);
    throw error;
  }
});

// Update the save-model handler to not store tags in the models table
ipcMain.handle('save-model', async (event, modelData) => {
  return await saveModel(modelData);
});

ipcMain.handle('save-model-from-upload', async (event, payload) => {
  return await saveModelFromUpload(payload);
});

ipcMain.handle('save-model-batch', async (event, modelDataBatch) => {
  return await saveModelBatch(modelDataBatch);
});

ipcMain.handle('update-models-batch', async (event, modelDataBatch) => {
  return await updateModelsBatch(modelDataBatch);
});

ipcMain.handle('save-thumbnail', async (event, filePath, thumbnail) => {
  try {
    await saveThumbnail(filePath, thumbnail);
    return true;
  } catch (error) {
    console.error('Error saving thumbnail:', error);
    throw error;
  }
});

ipcMain.handle('get-designers', async () => {
  try {
    const rows = db.prepare("SELECT DISTINCT designer FROM models WHERE designer IS NOT NULL AND designer != ''").all();
    return rows.map(row => row.designer);
  } catch (error) {
    console.error('Error getting designers:', error);
    throw error;
  }
});

ipcMain.handle('get-licenses', async () => {
  try {
    const rows = db.prepare("SELECT DISTINCT license FROM models WHERE license IS NOT NULL AND license != ''").all();
    return rows.map(row => row.license);
  } catch (error) {
    console.error('Error getting licenses:', error);
    throw error;
  }
});

ipcMain.handle('get-models-by-designer', async (event, designer) => {
  try {
    const rows = db.prepare('SELECT * FROM models WHERE designer = ?').all(designer);
    return rows;
  } catch (error) {
    console.error('Error getting models by designer:', error);
    throw error;
  }
});

ipcMain.handle('show-message-box', async (event, options) => {
  try {
    // Test mode: auto-dismiss "New models found, would you like to see them?" so tests don't hang
    if (process.env.PRINTVENTORY_TEST_SCAN_PATH && options.title === 'New Models Found') {
      return { response: 1 };
    }
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(window || undefined, options);
    return result;
  } catch (error) {
    console.error('Error showing message box:', error);
    throw error;
  }
});

const getAllModelsHandler = async (event, sortOption, limit = 0) => {
  try {
    // Determine the ORDER BY clause based on sortOption.
    let orderClause = "";
    switch (sortOption) {
      case "name-asc":
        orderClause = "ORDER BY fileName ASC";
        break;
      case "name-desc":
        orderClause = "ORDER BY fileName DESC";
        break;
      case "size-asc":
        orderClause = "ORDER BY size ASC";
        break;
      case "size-desc":
        orderClause = "ORDER BY size DESC";
        break;
      case "date-asc":
        orderClause = "ORDER BY modifiedDate ASC";
        break;
      case "date-desc":
        orderClause = "ORDER BY modifiedDate DESC";
        break;
      case "dateadded-asc":
        orderClause = "ORDER BY dateAdded ASC";
        break;
      case "dateadded-desc":
        orderClause = "ORDER BY dateAdded DESC";
        break;
      default:
        orderClause = "ORDER BY modifiedDate DESC";
        break;
    }

    const selectCols = "id, filePath, fileName, designer, source, notes, printed, parentModel, hash, size, license, modifiedDate, dateAdded, CASE WHEN thumbnail IS NOT NULL AND thumbnail != '' AND thumbnail != '3d.png' THEN 1 ELSE 0 END AS hasThumbnail";

    let models;
    if (limit === 0) {
      // When limit is 0, load all models without a limit
      models = db.prepare(`SELECT ${selectCols} FROM models ${orderClause}`).all();
    } else {
      models = db.prepare(`SELECT ${selectCols} FROM models ${orderClause} LIMIT ?`).all(limit);
    }
    return models;
  } catch (error) {
    console.error("Error in getAllModels IPC:", error);
    return [];
  }
};
ipcMain.handle('get-all-models', getAllModelsHandler);
ipcHandlerRegistry.set('get-all-models', getAllModelsHandler);

const getModelsFilteredHandler = async (event, filters) => {
  try {
    console.log('getModelsFiltered called with filters:', filters);
    console.log('Designer inverted flag:', filters.designerInverted);
    
    // Build WHERE clause conditions
    const conditions = [];
    const params = [];
    
    // Designer filter
    if (filters.designer) {
      if (filters.designerInverted) {
        // Inverted: show models where designer is NOT equal (include NULL/empty as non-matching)
        if (filters.designer === '__none__') {
          conditions.push("(designer IS NOT NULL AND designer != '')");
        } else {
          conditions.push("(designer IS NULL OR designer = '' OR LOWER(TRIM(designer)) != LOWER(TRIM(?)))");
          params.push(filters.designer);
        }
      } else {
        // Normal: show models where designer IS equal
        if (filters.designer === '__none__') {
          conditions.push("(designer IS NULL OR designer = '')");
        } else {
          conditions.push("LOWER(TRIM(designer)) = LOWER(TRIM(?))");
          params.push(filters.designer);
        }
      }
    }
    
    // License filter
    if (filters.license) {
      if (filters.licenseInverted) {
        // Inverted: show models where license is NOT equal (include NULL/empty as non-matching)
        if (filters.license === '__none__') {
          conditions.push("(license IS NOT NULL AND license != '')");
        } else {
          conditions.push("(license IS NULL OR license = '' OR license != ?)");
          params.push(filters.license);
        }
      } else {
        // Normal: show models where license IS equal
        if (filters.license === '__none__') {
          conditions.push("(license IS NULL OR license = '')");
        } else {
          conditions.push("license = ?");
          params.push(filters.license);
        }
      }
    }
    
    // Parent model filter
    if (filters.parentModel) {
      if (filters.parentModelInverted) {
        // Inverted: show models where parentModel is NOT equal (include NULL/empty as non-matching)
        if (filters.parentModel === '__none__') {
          conditions.push("(parentModel IS NOT NULL AND parentModel != '')");
        } else {
          conditions.push("(parentModel IS NULL OR parentModel = '' OR parentModel != ?)");
          params.push(filters.parentModel);
        }
      } else {
        // Normal: show models where parentModel IS equal
        if (filters.parentModel === '__none__') {
          conditions.push("(parentModel IS NULL OR parentModel = '')");
        } else {
          conditions.push("parentModel = ?");
          params.push(filters.parentModel);
        }
      }
    }
    
    // Print status filter
    if (filters.printed !== undefined) {
      if (filters.printed === 'printed') {
        conditions.push("printed = 1");
      } else if (filters.printed === 'not-printed') {
        conditions.push("printed = 0");
      }
    }
    
    // File type filter
    if (filters.fileType) {
      if (filters.fileType.toLowerCase() === 'zip') {
        // For zip filter, show all models inside ZIP archives (entries with :: separator)
        conditions.push("filePath LIKE ?");
        params.push('%::%');
      } else {
        const exts = getExtensionsForFileTypeFilter(filters.fileType);
        if (exts.length === 1) {
          conditions.push("LOWER(fileName) LIKE ?");
          params.push(`%${exts[0]}`);
        } else {
          conditions.push("(" + exts.map(() => "LOWER(fileName) LIKE ?").join(" OR ") + ")");
          params.push(...exts.map(ext => `%${ext}`));
        }
      }
    }
    
    // Directory filter
    if (filters.directory) {
      // Ensure the directory path ends with a separator to match only files within that directory
      // This prevents matching subdirectories with similar names (e.g., "test" matching "test2")
      // CRITICAL: Normalize the path to match database format (forward slashes)
      // Paths in the database are stored with forward slashes, so we must normalize here
      let directoryPath = normalizePath(filters.directory);
      
      // Add path separator if not already present at the end
      if (!directoryPath.endsWith('/') && !directoryPath.endsWith('::')) {
        // Use forward slash for normalized paths (consistent with database storage)
        directoryPath += '/';
      }
      
      // For zip entries (containing ::), ensure both zip path and entry path use forward slashes
      if (directoryPath.includes('::')) {
        const [zipPath, entryPath] = directoryPath.split('::');
        const normalizedZipPath = normalizePath(zipPath);
        const normalizedEntryPath = entryPath ? normalizePath(entryPath) : '';
        directoryPath = normalizedEntryPath ? `${normalizedZipPath}::${normalizedEntryPath}` : normalizedZipPath;
        if (normalizedEntryPath && !directoryPath.endsWith('/') && !directoryPath.endsWith('::')) {
          directoryPath += '/';
        }
      }
      
      // Match both / and \ so directory filter works on Windows (DB may store paths with backslashes)
      const directoryPathForward = `${directoryPath}%`;
      const directoryPathBackslash = `${directoryPath.replace(/\//g, '\\')}%`;
      conditions.push("(filePath LIKE ? OR filePath LIKE ?)");
      params.push(directoryPathForward, directoryPathBackslash);
    }
    
    // Search term filter (searches name, directory, metadata, tags, notes)
    if (filters.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      if (filters.searchInverted) {
        // Inverted: none of the fields should contain the term (NULL/empty count as non-matching)
        conditions.push(`(
          LOWER(COALESCE(fileName, '')) NOT LIKE ? AND 
          LOWER(COALESCE(designer, '')) NOT LIKE ? AND 
          LOWER(COALESCE(parentModel, '')) NOT LIKE ? AND 
          LOWER(COALESCE(notes, '')) NOT LIKE ? AND
          LOWER(COALESCE(filePath, '')) NOT LIKE ? AND
          LOWER(COALESCE(source, '')) NOT LIKE ? AND
          LOWER(COALESCE(license, '')) NOT LIKE ? AND
          NOT EXISTS (SELECT 1 FROM model_tags mt INNER JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = models.id AND LOWER(t.name) LIKE ?)
        )`);
      } else {
        // Normal: any of the fields or tags may contain the term
        conditions.push(`(
          LOWER(COALESCE(fileName, '')) LIKE ? OR 
          LOWER(COALESCE(designer, '')) LIKE ? OR 
          LOWER(COALESCE(parentModel, '')) LIKE ? OR 
          LOWER(COALESCE(notes, '')) LIKE ? OR
          LOWER(COALESCE(filePath, '')) LIKE ? OR
          LOWER(COALESCE(source, '')) LIKE ? OR
          LOWER(COALESCE(license, '')) LIKE ? OR
          EXISTS (SELECT 1 FROM model_tags mt INNER JOIN tags t ON t.id = mt.tag_id WHERE mt.model_id = models.id AND LOWER(t.name) LIKE ?)
        )`);
      }
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Date Added filter (filter by dateAdded >= specified date)
    if (filters.dateAdded) {
      conditions.push("dateAdded >= ?");
      params.push(filters.dateAdded);
    }
    
    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
    console.log('WHERE clause built:', whereClause);
    console.log('Conditions:', conditions);
    
    // Determine ORDER BY clause based on sortOption
    let orderClause = "";
    const sortOption = filters.sortOption || 'date-desc';
    switch (sortOption) {
      case "name-asc":
        orderClause = "ORDER BY fileName ASC";
        break;
      case "name-desc":
        orderClause = "ORDER BY fileName DESC";
        break;
      case "size-asc":
        orderClause = "ORDER BY size ASC";
        break;
      case "size-desc":
        orderClause = "ORDER BY size DESC";
        break;
      case "date-asc":
        orderClause = "ORDER BY modifiedDate ASC";
        break;
      case "date-desc":
        orderClause = "ORDER BY modifiedDate DESC";
        break;
      case "dateadded-asc":
        orderClause = "ORDER BY dateAdded ASC";
        break;
      case "dateadded-desc":
        orderClause = "ORDER BY dateAdded DESC";
        break;
      case "printed-asc":
        orderClause = "ORDER BY printed ASC";
        break;
      case "printed-desc":
        orderClause = "ORDER BY printed DESC";
        break;
      case "designer-asc":
        orderClause = "ORDER BY designer ASC";
        break;
      case "designer-desc":
        orderClause = "ORDER BY designer DESC";
        break;
      case "parentmodel-asc":
        orderClause = "ORDER BY parentModel ASC";
        break;
      case "parentmodel-desc":
        orderClause = "ORDER BY parentModel DESC";
        break;
      case "directory-asc":
        orderClause = "ORDER BY filePath ASC";
        break;
      case "directory-desc":
        orderClause = "ORDER BY filePath DESC";
        break;
      default:
        orderClause = "ORDER BY modifiedDate DESC";
        break;
    }
    
    const selectCols = "models.id, models.filePath, models.fileName, models.designer, models.source, models.notes, models.printed, models.parentModel, models.hash, models.size, models.license, models.modifiedDate, models.dateAdded, CASE WHEN models.thumbnail IS NOT NULL AND models.thumbnail != '' AND models.thumbnail != '3d.png' THEN 1 ELSE 0 END AS hasThumbnail";

    // Execute query (optional limit/offset for progressive load when clearing filters in Server/Docker)
    // SQLite requires LIMIT when using OFFSET; use a large limit when only offset is set
    let query = `SELECT ${selectCols} FROM models ${whereClause} ${orderClause}`;
    const limit = filters.limit != null && filters.limit > 0 ? Math.min(Number(filters.limit), 10000) : null;
    const offset = filters.offset != null && filters.offset >= 0 ? Number(filters.offset) : null;
    if (limit != null) {
      query += ` LIMIT ${Math.floor(limit)}`;
      if (offset != null) query += ` OFFSET ${Math.floor(offset)}`;
    } else if (offset != null) {
      query += ` LIMIT 999999 OFFSET ${Math.floor(offset)}`;
    }
    console.log('Executing query:', query);
    console.log('With params:', params);
    
    let models = db.prepare(query).all(...params);
    
    // Tag filter (needs to be done after query since it requires joining with model_tags)
    if (filters.tag) {
      const tagFilteredModels = [];
      const isInverted = filters.tagInverted || false;
      
      for (const model of models) {
        const modelTags = db.prepare(`
          SELECT t.name 
          FROM tags t
          INNER JOIN model_tags mt ON t.id = mt.tag_id
          WHERE mt.model_id = ?
        `).all(model.id);
        
        const hasTag = modelTags.some(tag => tag.name === filters.tag);
        
        // If not inverted, include models that have the tag
        // If inverted, include models that don't have the tag
        if (isInverted ? !hasTag : hasTag) {
          tagFilteredModels.push(model);
        }
      }
      models = tagFilteredModels;
    }
    
    console.log(`Returning ${models.length} filtered models`);
    return models;
  } catch (error) {
    console.error("Error in getModelsFiltered IPC:", error);
    throw error;
  }
};
ipcMain.handle('get-models-filtered', getModelsFilteredHandler);
ipcHandlerRegistry.set('get-models-filtered', getModelsFilteredHandler);

ipcMain.handle('get-parent-models', async () => {
  try {
    const rows = db.prepare("SELECT DISTINCT parentModel FROM models WHERE parentModel IS NOT NULL AND parentModel != ''").all();
    return rows.map(row => row.parentModel);
  } catch (error) {
    console.error('Error getting parent models:', error);
    throw error;
  }
});

ipcMain.handle('get-all-tags', async () => {
  try {
    return db.prepare(`
      SELECT 
        t.id,
        t.name,
        COUNT(DISTINCT mt.model_id) as model_count
      FROM tags t
      LEFT JOIN model_tags mt ON t.id = mt.tag_id
      WHERE t.name != ''
      GROUP BY t.id, t.name
      ORDER BY t.name
    `).all();
  } catch (error) {
    console.error('Error getting tags:', error);
    throw error;
  }
});

ipcMain.handle('save-tag', async (event, tagName) => {
  try {
    db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(tagName);
    return db.prepare('SELECT id, name FROM tags WHERE name = ?').get(tagName);
  } catch (error) {
    console.error('Error saving tag:', error);
    throw error;
  }
});

// Add error handling to the getSetting handler
ipcMain.handle('get-additional-file-types-catalog', async () => {
  return ADDITIONAL_FILE_TYPES_CATALOG;
});

/** Get extensions (e.g. ['.obj']) for catalog ids (e.g. ['obj']). Used to find/remove models by file type. */
function getExtensionsForCatalogIds(catalogIds) {
  if (!catalogIds || !Array.isArray(catalogIds) || catalogIds.length === 0) return [];
  const extSet = new Set();
  for (const id of catalogIds) {
    const entry = ADDITIONAL_FILE_TYPES_CATALOG.find(e => e.id === id);
    if (entry) entry.extensions.forEach(ext => extSet.add(ext));
  }
  return Array.from(extSet);
}

ipcMain.handle('get-model-count-by-file-type-ids', async (event, catalogIds) => {
  try {
    const exts = getExtensionsForCatalogIds(catalogIds);
    if (exts.length === 0) return 0;
    const conditions = exts.map(() => 'LOWER(fileName) LIKE ?').join(' OR ');
    const params = exts.map(ext => `%${ext}`);
    const row = db.prepare(`SELECT COUNT(*) AS count FROM models WHERE ${conditions}`).get(...params);
    return row ? row.count : 0;
  } catch (error) {
    console.error('Error getting model count by file type ids:', error);
    throw error;
  }
});

ipcMain.handle('remove-models-by-file-type-ids', async (event, catalogIds) => {
  try {
    const exts = getExtensionsForCatalogIds(catalogIds);
    if (exts.length === 0) return { deleted: 0 };
    const conditions = exts.map(() => 'LOWER(fileName) LIKE ?').join(' OR ');
    const params = exts.map(ext => `%${ext}`);
    const modelRows = db.prepare(`SELECT id FROM models WHERE ${conditions}`).all(...params);
    const ids = modelRows.map(r => r.id);
    if (ids.length === 0) return { deleted: 0 };
    const deleted = db.transaction(() => {
      for (const id of ids) {
        db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(id);
        db.prepare('DELETE FROM models WHERE id = ?').run(id);
      }
      return ids.length;
    })();
    return { deleted };
  } catch (error) {
    console.error('Error removing models by file type ids:', error);
    throw error;
  }
});

const getSettingHandler = async (event, key) => {
  try {
    console.log('Main Process - Getting setting:', key);
    const result = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    console.log('Main Process - Setting value:', result?.value);
    return result?.value || null;
  } catch (error) {
    console.error('Error getting setting:', error);
    return null;
  }
};
ipcMain.handle('get-setting', getSettingHandler);
ipcHandlerRegistry.set('get-setting', getSettingHandler);

// Add handler to get app version directly (fallback for server mode)
ipcMain.handle('get-app-version', async () => {
  try {
    return version;
  } catch (error) {
    console.error('Error getting app version:', error);
    return null;
  }
});

// Add error handling to the saveSetting handler
const saveSettingHandler = async (event, key, value) => {
  try {
    console.log('Main Process - Saving setting:', key, value);
    
    // Ensure database is initialized
    if (!db) {
      console.error('Database not initialized when saving setting');
      return false;
    }
    
    // If this is the CollectUsage setting being changed, track the change
    if (key === 'CollectUsage') {
      const oldValue = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
      console.log('CollectUsage - Old value:', oldValue, 'New value:', value);
      
      // If turning on analytics and it was previously off, track this event
      if (value === '1' && oldValue !== '1') {
        // Track that the user enabled analytics
        const clientId = getClientId();
        await analytics.event(clientId, 'Settings', 'EnableAnalytics', {
          evLabel: `Version ${version}`,
          evValue: 1,
          os_platform: process.platform
        });
      }
    }
    
    // Execute the database update
    const result = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
    console.log('Database update result:', result);
    
    // Verify the save worked
    const verify = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    console.log(`Verified setting '${key}' saved as:`, verify?.value);
    
    // Force a sync to disk to ensure the change is persisted for all settings
    // This is especially important in server mode where multiple clients might be accessing the database
    db.pragma('synchronous = FULL');
    db.pragma('journal_mode = WAL');
    db.prepare('PRAGMA wal_checkpoint(FULL)').run();
    
    // Verify the update
    if (key === 'CollectUsage') {
      const newValue = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
      console.log('CollectUsage - Verified new value in database:', newValue);
    }
    
    return true;
  } catch (error) {
    console.error('Error saving setting:', error);
    return false;
  }
};
ipcMain.handle('save-setting', saveSettingHandler);
ipcHandlerRegistry.set('save-setting', saveSettingHandler);

ipcMain.handle('purge-thumbnails', async () => {
  try {
    db.prepare('UPDATE models SET thumbnail = NULL').run();
    return true;
  } catch (error) {
    console.error('Error purging thumbnails:', error);
    throw error;
  }
});

// Update the shouldSkipDirectory function
function shouldSkipDirectory(dirName) {
  // Skip directories named __MACOSX (case-insensitive)
  if (dirName.toLowerCase() === '__macosx') {
    debugLog(`Skipping __MACOSX directory: ${dirName}`);
    return true;
  }

  // Skip any directory whose name starts with "Windows Defender" (case-insensitive)
  if (/^windows defender/i.test(dirName)) {
    debugLog(`Skipping system directory: ${dirName}`);
    return true;
  }

  const systemDirs = [
    'System Volume Information',
    '$Recycle.Bin',
    'Windows',
    '$WINDOWS.~BT',
    '$Windows.~WS',
    'Config.Msi',
    'ProgramData',
    'Recovery',
    'Boot',
    'EFI'
  ];

  return systemDirs.some(dir => dirName.toLowerCase() === dir.toLowerCase());
}

// Update the scanDirectory function
async function scanDirectory(directoryPath, isValidFile) {
  const files = [];
  let totalFiles = 0;
  let isCancelled = false;

  // Function to check if a directory should be processed
  function shouldProcessDirectory(dirName) {
    return !shouldSkipDirectory(dirName);
  }

  // Process a batch of entries in parallel
  async function processBatch(entries, currentDir) {
    if (isCancelled) return [];

    const batchResults = await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(currentDir, entry.name);
        
        if (entry.isDirectory()) {
          // Skip system directories
          if (!shouldProcessDirectory(entry.name)) {
            debugLog(`Skipping system directory: ${entry.name}`);
            return { files: [], count: 0 };
          }
          
          return await scanRecursive(fullPath);
        } else {
          totalFiles++;
          
          try {
            const stats = await fs.promises.stat(fullPath);
            if (isValidFile(entry.name, stats.size)) {
              return { 
                files: [{
                  filePath: fullPath,
                  fileName: entry.name,
                  size: stats.size,
                  mtime: stats.mtime
                }], 
                count: 1 
              };
            }
          } catch (error) {
            console.error(`Error processing file ${fullPath}:`, error);
          }
          return { files: [], count: 0 };
        }
      })
    );
    
    // Combine results from the batch
    return batchResults.reduce(
      (acc, result) => {
        if (result) {
          acc.files.push(...result.files);
          acc.count += result.count;
        }
        return acc;
      },
      { files: [], count: 0 }
    );
  }

  // Scan directory recursively with improved parallelism
  async function scanRecursive(dir) {
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      
      // Process in batches of 50 for better performance
      const BATCH_SIZE = 50;
      const results = [];
      
      for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const batchResult = await processBatch(batch, dir);
        results.push(batchResult);
        
        if (isCancelled) break;
      }
      
      // Combine all batch results
      return results.reduce(
        (acc, result) => {
          acc.files.push(...result.files);
          acc.count += result.count;
          return acc;
        },
        { files: [], count: 0 }
      );
    } catch (error) {
      console.error(`Error reading directory ${dir}:`, error);
      return { files: [], count: 0 };
    }
  }

  // Add a method to cancel the scan
  const cancelScan = () => {
    isCancelled = true;
  };

  // Start the scan
  const result = await scanRecursive(directoryPath);
  files.push(...result.files);
  
  return { files, totalFiles, cancelScan };
}

// Helper functions for managing multiple thumbnails
function parseThumbnails(thumbnailString) {
  if (!thumbnailString || thumbnailString === '3d.png' || !thumbnailString.includes('::')) {
    return [thumbnailString].filter(Boolean);
  }
  return thumbnailString.split('::').filter(Boolean);
}

function getDefaultThumbnail(thumbnailString, defaultIndex = 0) {
  const thumbnails = parseThumbnails(thumbnailString);
  if (thumbnails.length === 0) return null;
  const index = Math.max(0, Math.min(defaultIndex, thumbnails.length - 1));
  return thumbnails[index];
}

function addThumbnailToModel(thumbnailString, newThumbnail) {
  if (!newThumbnail) return thumbnailString;
  const thumbnails = parseThumbnails(thumbnailString);
  thumbnails.push(newThumbnail);
  return thumbnails.join('::');
}

function setDefaultThumbnailIndex(thumbnailString, index) {
  const thumbnails = parseThumbnails(thumbnailString);
  if (thumbnails.length === 0 || index < 0 || index >= thumbnails.length) {
    return thumbnailString;
  }
  // Move the selected thumbnail to the front (making it the default)
  const selected = thumbnails[index];
  thumbnails.splice(index, 1);
  thumbnails.unshift(selected);
  return thumbnails.join('::');
}

async function saveThumbnail(filePath, thumbnail) {
  try {
    db.prepare('UPDATE models SET thumbnail = ? WHERE filePath = ?').run(thumbnail, filePath);
    return true;
  } catch (error) {
    console.error('Error saving thumbnail:', error);
    throw error;
  }
}

ipcMain.handle('show-item-in-folder', async (event, filePath) => {
  try {
    if (isUrlModel(filePath)) {
      shell.openExternal(filePath.slice(5));
      return true;
    }
    // Validate UNC path in server mode
    try {
      validateUncPath(filePath, 'show-item-in-folder');
    } catch (validationError) {
      throw new Error(validationError.message);
    }
    
    // If it's a zip entry, extract the zip path
    const pathInfo = parseZipPath(filePath);
    const pathToShow = pathInfo.isZipEntry ? pathInfo.zipPath : filePath;
    shell.showItemInFolder(pathToShow);
    return true;
  } catch (error) {
    console.error('Error showing item in folder:', error);
    throw error;
  }
});

ipcMain.handle('open-path', async (event, path) => {
  try {
    if (isUrlModel(path)) {
      shell.openExternal(path.slice(5));
      return true;
    }
    await shell.openPath(path);
    return true;
  } catch (error) {
    console.error('Error opening path:', error);
    throw error;
  }
});

ipcMain.handle('show-message', async (event, title, message, buttons = ['OK']) => {
  const result = await dialog.showMessageBox({
    type: 'info',
    title: title,
    message: message,
    buttons: buttons
  });
  return buttons[result.response];
});

ipcMain.handle('show-input-dialog', async (event, options) => {
  const { title, message, defaultValue = '', placeholder = '' } = options;
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  
  // Create a simple input dialog window
  const inputWindow = new BrowserWindow({
    width: 400,
    height: 200,
    resizable: false,
    modal: true,
    parent: senderWindow,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    title: title || 'Input',
    show: false,
    backgroundColor: '#2d2d2d'
  });

  // Escape HTML to prevent XSS
  const escapeHtml = (text) => {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  };

  // Create HTML for the input dialog
  const safeMessage = escapeHtml(message || 'Enter value:');
  const safePlaceholder = escapeHtml(placeholder || '');
  const safeDefaultValue = escapeHtml(defaultValue || '');
  
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
          background-color: #2d2d2d;
          color: #fff;
          margin: 0;
          padding: 20px;
          display: flex;
          flex-direction: column;
          height: 100vh;
          box-sizing: border-box;
        }
        .message {
          margin-bottom: 15px;
          font-size: 14px;
        }
        input {
          width: 100%;
          padding: 8px;
          background-color: #444;
          border: 1px solid #555;
          border-radius: 4px;
          color: #fff;
          font-size: 14px;
          box-sizing: border-box;
          margin-bottom: 15px;
        }
        input:focus {
          outline: none;
          border-color: #007bff;
        }
        input::placeholder {
          color: #999;
        }
        .buttons {
          display: flex;
          justify-content: flex-end;
          gap: 10px;
        }
        button {
          padding: 8px 16px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
        }
        .cancel {
          background-color: #555;
          color: #fff;
        }
        .cancel:hover {
          background-color: #666;
        }
        .ok {
          background-color: #007bff;
          color: #fff;
        }
        .ok:hover {
          background-color: #0056b3;
        }
      </style>
    </head>
    <body>
      <div class="message">${safeMessage}</div>
      <input type="text" id="input-field" placeholder="${safePlaceholder}" value="${safeDefaultValue}" autofocus>
      <div class="buttons">
        <button class="cancel" id="cancel-btn">Cancel</button>
        <button class="ok" id="ok-btn">OK</button>
      </div>
      <script>
        const { ipcRenderer } = require('electron');
        const input = document.getElementById('input-field');
        const okBtn = document.getElementById('ok-btn');
        const cancelBtn = document.getElementById('cancel-btn');
        
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            okBtn.click();
          } else if (e.key === 'Escape') {
            cancelBtn.click();
          }
        });
        
        okBtn.addEventListener('click', () => {
          ipcRenderer.send('input-dialog-response', input.value);
        });
        
        cancelBtn.addEventListener('click', () => {
          ipcRenderer.send('input-dialog-response', null);
        });
        
        input.focus();
        input.select();
      </script>
    </body>
    </html>
  `;

  inputWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  inputWindow.show();

  return new Promise((resolve) => {
    // Handle response from the input dialog
    const responseHandler = (event, value) => {
      if (event.sender === inputWindow.webContents) {
        ipcMain.removeListener('input-dialog-response', responseHandler);
        inputWindow.close();
        resolve(value || null);
      }
    };
    
    ipcMain.on('input-dialog-response', responseHandler);
    
    // Handle window close (user clicked X)
    inputWindow.on('closed', () => {
      ipcMain.removeListener('input-dialog-response', responseHandler);
      if (!inputWindow.isDestroyed()) {
        resolve(null);
      }
    });
  });
});

// Update the backup-database handler
ipcMain.handle('backup-database', async () => {
  if (isServerMode) {
    try {
      const dbPath = getDatabasePath();
      const dbDir = path.dirname(dbPath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupPath = path.join(dbDir, `printventory-backup-${timestamp}.db`);

      if (db.open) {
        db.close();
      }

      await fs.promises.copyFile(dbPath, backupPath);

      db = new Database(dbPath, { 
        verbose: DEBUG ? console.log : null 
      });

      return { success: true, filePath: backupPath };
    } catch (error) {
      console.error('Backup error:', error);
      try {
        const dbPath = getDatabasePath();
        db = new Database(dbPath, { 
          verbose: DEBUG ? console.log : null 
        });
      } catch (reopenError) {
        console.error('Error reopening database:', reopenError);
      }
      return { success: false, message: error.message };
    }
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Database Backup',
    defaultPath: 'printventory-backup.db',
    filters: [
      { name: 'Database Files', extensions: ['db'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      // Get the current database path
      const dbPath = getDatabasePath();

      // Close the current database connection
      db.close();

      // Copy the database file
      await fs.promises.copyFile(dbPath, result.filePath);

      // Reopen the database
      db = new Database(dbPath, { 
        verbose: DEBUG ? console.log : null 
      });

      return true;
    } catch (error) {
      console.error('Backup error:', error);
      // Make sure we reopen the database even if there's an error
      try {
        const dbPath = getDatabasePath();
        db = new Database(dbPath, { 
          verbose: DEBUG ? console.log : null 
        });
      } catch (reopenError) {
        console.error('Error reopening database:', reopenError);
      }
      throw error;
    }
  }
  return false;
});

// Update the restore-database handler
ipcMain.handle('restore-database', async (event, payload = null) => {
  if (isServerMode && payload && payload.base64) {
    try {
      const dbPath = getDatabasePath();
      const buffer = Buffer.from(payload.base64, 'base64');

      if (db.open) {
        db.close();
      }

      await fs.promises.writeFile(dbPath, buffer);

      db = new Database(dbPath, { 
        verbose: DEBUG ? console.log : null 
      });

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('refresh-grid');
      }

      return { success: true };
    } catch (error) {
      console.error('Restore error:', error);
      try {
        const dbPath = getDatabasePath();
        db = new Database(dbPath, { 
          verbose: DEBUG ? console.log : null 
        });
      } catch (reopenError) {
        console.error('Error reopening database:', reopenError);
      }
      return { success: false, message: error.message };
    }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Restore Database from Backup',
    filters: [
      { name: 'Database Files', extensions: ['db'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      // Get the current database path
      const dbPath = getDatabasePath();

      // Close the current database connection
      db.close();

      // Copy the backup file over the existing database
      await fs.promises.copyFile(result.filePaths[0], dbPath);

      // Reopen the database
      db = new Database(dbPath, { 
        verbose: DEBUG ? console.log : null 
      });

      // Notify renderer to refresh the view
      mainWindow.webContents.send('refresh-grid');

      return true;
    } catch (error) {
      console.error('Restore error:', error);
      // Make sure we reopen the database even if there's an error
      try {
        const dbPath = getDatabasePath();
        db = new Database(dbPath, { 
          verbose: DEBUG ? console.log : null 
        });
      } catch (reopenError) {
        console.error('Error reopening database:', reopenError);
      }
      throw error;
    }
  }
  return false;
});

// Export library handler
ipcMain.handle('export-library', async () => {
  const buildExportData = () => {
    const models = db.prepare('SELECT * FROM models').all();
    const modelsWithTags = models.map(model => {
      const tags = db.prepare(`
        SELECT t.name 
        FROM tags t 
        JOIN model_tags mt ON mt.tag_id = t.id 
        WHERE mt.model_id = ?
      `).all(model.id).map(t => t.name);
      
      return {
        filePath: model.filePath,
        fileName: model.fileName,
        designer: model.designer,
        source: model.source,
        notes: model.notes,
        printed: model.printed,
        parentModel: model.parentModel,
        license: model.license,
        tags: tags || []
      };
    });

    return {
      version: '1.0',
      exportDate: new Date().toISOString(),
      models: modelsWithTags
    };
  };

  if (isServerMode) {
    try {
      const exportData = buildExportData();
      const exportDir = path.dirname(getDatabasePath());
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const exportPath = path.join(exportDir, `printventory-library-${timestamp}.json`);
      await fs.promises.writeFile(exportPath, JSON.stringify(exportData, null, 2), 'utf8');
      return { success: true, filePath: exportPath };
    } catch (error) {
      console.error('Export library error:', error);
      return { success: false, message: error.message };
    }
  }

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Library',
    defaultPath: 'printventory-library.json',
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      const exportData = buildExportData();
      await fs.promises.writeFile(result.filePath, JSON.stringify(exportData, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Export library error:', error);
      throw error;
    }
  }
  return false;
});

// Import library handler
ipcMain.handle('import-library', async (event, payload = null) => {
  const importLibraryData = async (importData) => {
    if (!importData.models || !Array.isArray(importData.models)) {
      throw new Error('Invalid library file format: missing models array');
    }

    const totalModels = importData.models.length;
    if (event && event.sender) {
      event.sender.send('show-progress-dialog', {
        title: 'Importing Library',
        message: 'Reading library file...',
        total: totalModels
      });
    }

    let importedCount = 0;
    let updatedCount = 0;

    for (let i = 0; i < importData.models.length; i++) {
      const modelData = importData.models[i];
      try {
        const existingModel = db.prepare('SELECT id FROM models WHERE filePath = ?').get(modelData.filePath);

        await saveModel({
          filePath: modelData.filePath,
          fileName: modelData.fileName,
          designer: modelData.designer || null,
          source: modelData.source || null,
          notes: modelData.notes || null,
          printed: modelData.printed || 0,
          parentModel: modelData.parentModel || null,
          license: modelData.license || null,
          tags: modelData.tags || []
        });

        if (existingModel) {
          updatedCount++;
        } else {
          importedCount++;
        }

        if (event && event.sender) {
          event.sender.send('update-progress', {
            current: i + 1,
            total: totalModels,
            message: `Importing model ${i + 1} of ${totalModels}...`
          });
        }
      } catch (modelError) {
        console.error(`Error importing model ${modelData.filePath}:`, modelError);
        if (event && event.sender) {
          event.sender.send('update-progress', {
            current: i + 1,
            total: totalModels,
            message: `Importing model ${i + 1} of ${totalModels}...`
          });
        }
      }
    }

    if (event && event.sender) {
      event.sender.send('close-progress-dialog');
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('refresh-grid');
    }

    return { success: true, imported: importedCount, updated: updatedCount };
  };

  if (isServerMode && payload && payload.json) {
    try {
      const importData = JSON.parse(payload.json);
      return await importLibraryData(importData);
    } catch (error) {
      console.error('Import library error:', error);
      if (event && event.sender) {
        event.sender.send('close-progress-dialog');
      }
      return { success: false, message: error.message };
    }
  }

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Library',
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      const fileContent = await fs.promises.readFile(result.filePaths[0], 'utf8');
      const importData = JSON.parse(fileContent);
      return await importLibraryData(importData);
    } catch (error) {
      console.error('Import library error:', error);
      if (event && event.sender) {
        event.sender.send('close-progress-dialog');
      }
      throw error;
    }
  }
  return false;
});

// Update these handlers to remove Promise wrappers and use synchronous API

ipcMain.handle('get-duplicate-files', async () => {
  try {
    const models = db.prepare('SELECT filePath, hash, size, thumbnail FROM models WHERE hash IS NOT NULL').all();
    
    // Group files by hash
    const duplicates = {};
    for (const model of models) {
      if (!model.hash) continue;
      
      if (!duplicates[model.hash]) {
        duplicates[model.hash] = [];
      }
      duplicates[model.hash].push({
        filePath: model.filePath,
        size: model.size,
        thumbnail: model.thumbnail
      });
    }
    
    // Filter out unique files
    return Object.fromEntries(
      Object.entries(duplicates).filter(([_, files]) => files.length > 1)
    );
  } catch (error) {
    console.error('Error getting duplicate files:', error);
    throw error;
  }
});

// Add this new handler
ipcMain.handle('check-files-exist', async (_, filePaths) => {
  const results = await Promise.all(filePaths.map(async (path) => {
    if (isUrlModel(path)) {
      return { path, exists: true };
    }
    try {
      await fs.promises.access(path, fs.constants.F_OK);
      return {
        path,
        exists: true
      };
    } catch {
      return {
        path,
        exists: false
      };
    }
  }));
  return results;
});

// Update the trash-file handler with simpler path normalization
ipcMain.handle('trash-file', async (event, filePath) => {
  try {
    // Validate UNC path in server mode (skips URL models)
    try {
      validateUncPath(filePath, 'trash-file');
    } catch (validationError) {
      throw new Error(validationError.message);
    }
  } catch (error) {
    console.error('Error in trash-file handler:', error);
    throw error;
  }
  
  // Simple path normalization - replace all backslashes with forward slashes
  const normalizedPath = filePath.replace(/\\/g, "/");
  console.log('trash-file handler received path:', filePath);
  console.log('Normalized path:', normalizedPath);
  
  try {
    if (!isUrlModel(filePath)) {
      console.log('Attempting trashItem with path:', normalizedPath);
      await shell.trashItem(normalizedPath);
      console.log('trashItem succeeded');
    }
    
    // Remove from database (for both file and URL-only models)
    await new Promise((resolve, reject) => {
      console.log('Deleting from database:', normalizedPath);
      db.transaction(() => {
        const model = db.prepare('SELECT id FROM models WHERE filePath = ?').get(normalizedPath);
        if (model) {
          db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(model.id);
          db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
        }
      })();
      resolve();
    });
    
    return true;
  } catch (err) {
    console.error("Error moving file to trash:", err);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      path: normalizedPath
    });
    return false;
  }
});

// Update or add this handler in main.js
ipcMain.handle('delete-file', async (event, filePath) => {
  try {
    // Validate UNC path in server mode
    try {
      validateUncPath(filePath, 'delete-file');
    } catch (validationError) {
      throw new Error(validationError.message);
    }
    
    console.log('main: delete-file handler called with:', filePath);
    const result = await deleteFile(filePath);
    
    // Send refresh-grid event to update the UI after file deletion
    if (result) {
      event.sender.send('refresh-grid');
    }
    
    return result;
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
});

// Update the fetch-thangs-page handler
ipcMain.handle('fetch-thangs-page', async (event, url) => {
  try {
    if (!fetch) {
      throw new Error('Fetch not initialized');
    }
    console.log('Fetching Thangs page:', url);
    
    const browser = await puppeteer.launch({
      headless: 'new'  // Use new headless mode
    });
    
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0' });

    // Get and log the full HTML source
    const htmlContent = await page.content();
    console.log('Page HTML:', htmlContent);

    // Extract the data
    const data = await page.evaluate(() => {
      // Get model title (which will be the parent model)
      const titleElement = document.querySelector('div[class^="ModelTitle_Text-"]');
      const parentModel = titleElement ? titleElement.textContent.trim() : null;

      // Get designer name
      const designerElement = document.querySelector('a[class^="ModelDesigner_ProfileLink-"]');
      const designer = designerElement ? designerElement.textContent.trim() : null;

      // Get license info - look for license text in the description
      const descriptionElement = document.querySelector('div[class^="ModelDescription_"]');
      const description = descriptionElement ? descriptionElement.textContent.toLowerCase() : '';
      
      let license = 'Unknown';
      if (description.includes('personal use')) {
        license = 'For Personal Use';
      } else if (description.includes('creative commons')) {
        license = 'Creative Commons';
      } else if (description.includes('commercial use')) {
        license = 'Commercial Use Allowed';
      }

      // Log the found elements for debugging
      console.log('Found elements:', {
        titleElement: titleElement?.outerHTML,
        designerElement: designerElement?.outerHTML,
        descriptionElement: descriptionElement?.outerHTML
      });

      return {
        parentModel,
        designer,
        license
      };
    });

    await browser.close();
    console.log('Scraped data:', data);
    
    return data;
  } catch (error) {
    console.error('Error fetching Thangs page:', error);
    throw error;
  }
});

ipcMain.handle('delete-tag', async (event, tagId) => {
  try {
    return db.transaction(() => {
      // First delete from model_tags (child table)
      db.prepare('DELETE FROM model_tags WHERE tag_id = ?').run(tagId);
          
          // Then delete the tag itself
      db.prepare('DELETE FROM tags WHERE id = ?').run(tagId);
      
      return true;
    })();
  } catch (error) {
    console.error('Error deleting tag:', error);
    throw error;
  }
});

ipcMain.handle('get-tag-model-count', async (event, tagId) => {
  return new Promise((resolve, reject) => {
    const row = db.prepare('SELECT COUNT(*) as count FROM model_tags WHERE tag_id = ?').get(tagId);
    if (row) {
      resolve(row.count);
    } else {
      reject(new Error('Tag not found'));
    }
  });
});

ipcMain.handle('get-all-metadata', async () => {
  try {
    return db.prepare(`
      SELECT 'designer' as type, designer as name, COUNT(*) as model_count 
      FROM models 
      WHERE designer IS NOT NULL AND designer != '' 
      GROUP BY designer
      UNION ALL
      SELECT 'parentModel' as type, parentModel as name, COUNT(*) as model_count 
      FROM models 
      WHERE parentModel IS NOT NULL AND parentModel != '' 
      GROUP BY parentModel
      UNION ALL
      SELECT 'license' as type, license as name, COUNT(*) as model_count 
      FROM models 
      WHERE license IS NOT NULL AND license != '' 
      GROUP BY license
      ORDER BY type, name
    `).all();
  } catch (error) {
    console.error('Error getting metadata:', error);
    throw error;
  }
});

ipcMain.handle('get-stats', async () => {
  try {
    // Total model count
    const totalModels = db.prepare('SELECT COUNT(*) as count FROM models').get();
    const totalCount = totalModels ? totalModels.count : 0;

    // File type breakdown
    const stlCount = db.prepare("SELECT COUNT(*) as count FROM models WHERE LOWER(fileName) LIKE '%.stl'").get();
    const threeMfCount = db.prepare("SELECT COUNT(*) as count FROM models WHERE LOWER(fileName) LIKE '%.3mf'").get();
    const otherCount = db.prepare("SELECT COUNT(*) as count FROM models WHERE LOWER(fileName) NOT LIKE '%.stl' AND LOWER(fileName) NOT LIKE '%.3mf'").get();
    
    // Archived models (models inside ZIP files)
    const archivedCount = db.prepare("SELECT COUNT(*) as count FROM models WHERE filePath LIKE '%::%'").get();
    
    // Models with metadata
    const withDesigner = db.prepare("SELECT COUNT(*) as count FROM models WHERE designer IS NOT NULL AND designer != ''").get();
    const withParentModel = db.prepare("SELECT COUNT(*) as count FROM models WHERE parentModel IS NOT NULL AND parentModel != ''").get();
    const withLicense = db.prepare("SELECT COUNT(*) as count FROM models WHERE license IS NOT NULL AND license != ''").get();
    const withTags = db.prepare("SELECT COUNT(DISTINCT model_id) as count FROM model_tags").get();
    
    // Tag statistics
    const totalTags = db.prepare('SELECT COUNT(*) as count FROM tags').get();
    const mostUsedTag = db.prepare(`
      SELECT t.name, COUNT(mt.model_id) as count 
      FROM tags t 
      JOIN model_tags mt ON t.id = mt.tag_id 
      GROUP BY t.id, t.name 
      ORDER BY count DESC 
      LIMIT 1
    `).get();
    
    // Calculate percentages
    const calculatePercentage = (count) => {
      if (totalCount === 0) return 0;
      return ((count / totalCount) * 100).toFixed(1);
    };
    
    return {
      totalModels: totalCount,
      fileTypes: {
        stl: stlCount ? stlCount.count : 0,
        threeMf: threeMfCount ? threeMfCount.count : 0,
        other: otherCount ? otherCount.count : 0
      },
      archivedModels: archivedCount ? archivedCount.count : 0,
      percentages: {
        withDesigner: calculatePercentage(withDesigner ? withDesigner.count : 0),
        withParentModel: calculatePercentage(withParentModel ? withParentModel.count : 0),
        withLicense: calculatePercentage(withLicense ? withLicense.count : 0),
        withTags: calculatePercentage(withTags ? withTags.count : 0)
      },
      tags: {
        total: totalTags ? totalTags.count : 0,
        mostUsed: mostUsedTag ? {
          name: mostUsedTag.name,
          count: mostUsedTag.count
        } : null
      }
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    throw error;
  }
});

// System Report handlers
ipcMain.handle('get-gpu-info', async () => {
  try {
    // GPU detection is primarily client-side (WebGL), but we can return basic info
    // The actual WebGL detection will be done in the renderer
    return {
      available: true, // Will be checked client-side
      message: 'GPU detection is performed client-side via WebGL'
    };
  } catch (error) {
    console.error('Error getting GPU info:', error);
    return { available: false, error: error.message };
  }
});

ipcMain.handle('benchmark-filesystem', async () => {
  try {
    const dbPath = getDatabasePath();
    const dbDir = path.dirname(dbPath);
    const testFilePath = path.join(dbDir, 'benchmark-test.tmp');
    
    const iterations = 10;
    const fileSize = 1024 * 1024; // 1MB test file
    const testData = Buffer.alloc(fileSize, 'A');
    
    // Write benchmark
    const writeStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await fs.promises.writeFile(testFilePath, testData);
    }
    const writeTime = Date.now() - writeStart;
    const writeSpeed = (iterations * fileSize) / (writeTime / 1000); // bytes per second
    
    // Read benchmark
    const readStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      await fs.promises.readFile(testFilePath);
    }
    const readTime = Date.now() - readStart;
    const readSpeed = (iterations * fileSize) / (readTime / 1000); // bytes per second
    
    // Cleanup
    try {
      await fs.promises.unlink(testFilePath);
    } catch (cleanupError) {
      console.warn('Failed to cleanup benchmark test file:', cleanupError);
    }
    
    return {
      success: true,
      write: {
        time: writeTime,
        speed: writeSpeed,
        speedMBps: (writeSpeed / (1024 * 1024)).toFixed(2)
      },
      read: {
        time: readTime,
        speed: readSpeed,
        speedMBps: (readSpeed / (1024 * 1024)).toFixed(2)
      },
      iterations: iterations,
      fileSize: fileSize
    };
  } catch (error) {
    console.error('Error benchmarking filesystem:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('benchmark-database', async () => {
  try {
    if (!db) {
      return { success: false, error: 'Database not initialized' };
    }
    
    const iterations = 100;
    
    // Write benchmark - insert test records
    const insertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    const writeStart = Date.now();
    const transaction = db.transaction(() => {
      for (let i = 0; i < iterations; i++) {
        insertStmt.run(`benchmark_test_${i}`, `test_value_${i}`);
      }
    });
    transaction();
    const writeTime = Date.now() - writeStart;
    const writeOpsPerSec = (iterations / (writeTime / 1000)).toFixed(2);
    
    // Read benchmark - select test records
    const selectStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
    const readStart = Date.now();
    for (let i = 0; i < iterations; i++) {
      selectStmt.get(`benchmark_test_${i}`);
    }
    const readTime = Date.now() - readStart;
    const readOpsPerSec = (iterations / (readTime / 1000)).toFixed(2);
    
    // Cleanup - delete test records
    const deleteStmt = db.prepare('DELETE FROM settings WHERE key LIKE ?');
    deleteStmt.run('benchmark_test_%');
    
    return {
      success: true,
      write: {
        time: writeTime,
        operations: iterations,
        opsPerSec: writeOpsPerSec
      },
      read: {
        time: readTime,
        operations: iterations,
        opsPerSec: readOpsPerSec
      }
    };
  } catch (error) {
    console.error('Error benchmarking database:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('rename-metadata', async (event, type, oldName, newName) => {
  try {
    if (!oldName || !newName || oldName.trim() === '' || newName.trim() === '') {
      throw new Error('Name cannot be empty');
    }

    // Validate type
    const validTypes = ['designer', 'parentModel', 'license'];
    if (!validTypes.includes(type)) {
      throw new Error('Invalid metadata type');
    }

    // Check if new name already exists for this type (for merge information)
    const existing = db.prepare(`
      SELECT COUNT(*) as count 
      FROM models 
      WHERE ${type} = ? AND ${type} IS NOT NULL AND ${type} != ''
    `).get(newName.trim());
    
    const existingCount = existing ? existing.count : 0;
    const isMerge = existingCount > 0;

    // Update all models with the old name to the new name (merge if new name exists)
    const result = db.prepare(`
      UPDATE models 
      SET ${type} = ? 
      WHERE ${type} = ?
    `).run(newName.trim(), oldName.trim());

    return { 
      success: true, 
      updated: result.changes,
      merged: isMerge,
      existingCount: existingCount
    };
  } catch (error) {
    console.error('Error renaming metadata:', error);
    throw error;
  }
});

ipcMain.handle('delete-metadata', async (event, type, name) => {
  try {
    if (!name || name.trim() === '') {
      throw new Error('Name cannot be empty');
    }

    // Validate type
    const validTypes = ['designer', 'parentModel', 'license'];
    if (!validTypes.includes(type)) {
      throw new Error('Invalid metadata type');
    }

    // Set the field to NULL for all models with that value
    const result = db.prepare(`
      UPDATE models 
      SET ${type} = NULL 
      WHERE ${type} = ?
    `).run(name.trim());

    return { success: true, updated: result.changes };
  } catch (error) {
    console.error('Error deleting metadata:', error);
    throw error;
  }
});

// Update the purge-models handler
const purgeModelsHandler = async (event, options = {}) => {
  try {
    // Skip native dialog only when user already confirmed in UI (in-app dialog or server/Docker)
    const fromWebSocket = !!(event && event.wsClient);
    const confirmedInDialog = !!(options && options.confirmedInDialog);
    let doPurge = fromWebSocket || confirmedInDialog;

    if (!doPurge) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Purge Models',
        message: 'Are you sure you want to purge all models?',
        detail: 'This will remove all model data from the database. This action cannot be undone.',
        buttons: ['Cancel', 'Purge All Models'],
        defaultId: 0,
        cancelId: 0,
      });
      doPurge = result.response === 1; // User clicked "Purge All Models"
    }

    if (doPurge) {
      // Check if database is open, if not reopen it
      if (!db.open) {
        const dbPath = getDatabasePath();
        db = new Database(dbPath, {
          verbose: DEBUG ? console.log : null
        });
      }

      try {
        // Execute each statement individually to avoid transaction issues
        // First clear the model_tags table (child table)
        db.prepare('DELETE FROM model_tags').run();

        // Then clear the models table (parent table)
        db.prepare('DELETE FROM models').run();

        // Finally clear unused tags
        db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM model_tags)').run();

        return true;
      } catch (dbError) {
        console.error('Database error during purge:', dbError);
        throw dbError;
      }
    }
    return false;
  } catch (error) {
    console.error('Error purging models:', error);
    throw error;
  }
};
ipcMain.handle('purge-models', purgeModelsHandler);
ipcHandlerRegistry.set('purge-models', purgeModelsHandler);

// Update the show-context-menu handler
ipcMain.handle('show-context-menu', async (event, fileIdentifier) => {
  const filePaths = Array.isArray(fileIdentifier) ? fileIdentifier : [fileIdentifier];

  // In single edit mode, if exactly one file is right-clicked, instruct the renderer to select it.
  if (filePaths.length === 1) {
    event.sender.send('select-model-by-filepath', filePaths[0]);
  }
  
  // Check if any file is a zip entry
  const isZipEntry = filePaths.length === 1 && filePaths[0].includes('::');
  const pathInfo = filePaths.length === 1 ? parseZipPath(filePaths[0]) : null;
  
  let menuItems = [];

  // Add "Preview" option at the top
  if (filePaths.length === 1) {
    const fp = filePaths[0];
    const ext = fp.includes('::')
      ? path.extname(fp.split('::')[1] || '').toLowerCase()
      : path.extname(fp).toLowerCase();
    const isSupported = ext === '.stl' || ext === '.3mf';

    if (isSupported) {
      menuItems.push({
        label: 'Preview',
        click: async () => {
          try {
            console.log('Preview clicked for file:', fp);
            // In server mode (including Docker), use broadcastEvent to send to all WebSocket clients
            if (isServerMode && global.broadcastEvent) {
              console.log('Broadcasting preview-model event via WebSocket');
              global.broadcastEvent('preview-model', fp);
            } else if (event && event.sender) {
              // In normal mode, use event.sender.send
              console.log('Sending preview-model event via event.sender');
              event.sender.send('preview-model', fp);
            } else {
              console.error('Cannot send preview event: no sender and not in server mode');
              throw new Error('Cannot preview file: no connection available');
            }
          } catch (error) {
            console.error('Error triggering preview:', error);
            if (event && event.sender) {
              const win = BrowserWindow.fromWebContents(event.sender);
              if (win) {
                dialog.showMessageBox(win, {
                  type: 'error',
                  title: 'Error',
                  message: 'Could not preview file',
                  detail: error.message
                });
              }
            }
          }
        }
      });
      menuItems.push({ type: 'separator' });
    }
  }
  
  // Add "Download" option for server mode at the top
  if (isServerMode && filePaths.length === 1) {
    menuItems.push({
      label: 'Download',
      click: async () => {
        try {
          console.log('Download clicked for file:', filePaths[0]);
          // Send download event to renderer
          // In server mode, use broadcastEvent to send to all WebSocket clients
          if (global.broadcastEvent) {
            console.log('Broadcasting download-model event via WebSocket');
            global.broadcastEvent('download-model', filePaths[0]);
          } else {
            // In normal mode, use event.sender.send
            console.log('Sending download-model event via event.sender');
            event.sender.send('download-model', filePaths[0]);
          }
        } catch (error) {
          console.error('Error triggering download:', error);
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) {
            dialog.showMessageBox(win, {
              type: 'error',
              title: 'Error',
              message: 'Could not download file',
              detail: error.message
            });
          }
        }
      }
    });
    menuItems.push({ type: 'separator' });
  }
  
  // Add "Open File" option (only in normal mode, not server mode)
  if (!isServerMode) {
    menuItems.push({
      label: 'Open File',
      enabled: filePaths.length === 1,
      click: async () => {
        try {
          // Normal mode: open with system default application
          if (isZipEntry && pathInfo) {
            // Extract to temp file first
            const tempPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
            await shell.openPath(tempPath);
            // Note: temp file will be cleaned up by OS or on next extraction
          } else {
            await shell.openPath(filePaths[0]);
          }
        } catch (error) {
          console.error('Error opening file:', error);
          const win = getWindowFromEvent(event);
          if (win && !win.isDestroyed()) {
            dialog.showMessageBox(win, {
              type: 'error',
              title: 'Error',
              message: 'Could not open file',
              detail: error.message
            });
          }
        }
      }
    });
  }
  
  // Add "Open Directory" only if NOT in server mode
  if (!isServerMode) {
    menuItems.push({
      label: 'Open Directory',
      enabled: filePaths.length === 1,
      click: async () => {
        try {
          if (isZipEntry && pathInfo) {
            // For zip entries, open the zip file's directory
            await shell.showItemInFolder(pathInfo.zipPath);
          } else {
            await shell.showItemInFolder(filePaths[0]);
          }
        } catch (error) {
          console.error('Error opening directory:', error);
          dialog.showMessageBox({
            type: 'error',
            title: 'Error',
            message: 'Could not open directory',
            detail: error.message
          });
        }
      }
    });
  }
  
  // Add extract options for zip entries (disabled in server mode)
  if (isZipEntry && pathInfo && filePaths.length === 1 && !isServerMode) {
    menuItems.push(
      { type: 'separator' },
      {
        label: 'Extract Model',
        click: async () => {
          try {
            const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
              properties: ['openDirectory'],
              title: 'Select destination folder for extraction'
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
              const destPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath, result.filePaths[0]);
              dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
                type: 'info',
                title: 'Extraction Complete',
                message: 'Model extracted successfully',
                detail: `Extracted to: ${destPath}`
              });
            }
          } catch (error) {
            console.error('Error extracting model:', error);
            dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
              type: 'error',
              title: 'Error',
              message: 'Could not extract model',
              detail: error.message
            });
          }
        }
      },
      {
        label: 'Extract Zip Archive',
        click: async () => {
          try {
            const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
              properties: ['openDirectory'],
              title: 'Select destination folder for extraction'
            });
            
            if (!result.canceled && result.filePaths.length > 0) {
              const destPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath, result.filePaths[0]);
              dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
                type: 'info',
                title: 'Extraction Complete',
                message: 'Archive extracted successfully',
                detail: `Extracted to: ${destPath}`
              });
            }
          } catch (error) {
            console.error('Error extracting archive:', error);
            dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
              type: 'error',
              title: 'Error',
              message: 'Could not extract archive',
              detail: error.message
            });
          }
        }
      }
    );
  }

  // Get all configured slicers from the database
  let slicers = [];
  try {
    // Ensure the slicers table exists before querying it
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='slicers'`).get();
    if (tableExists) {
      slicers = db.prepare('SELECT * FROM slicers').all();
    } else {
      // Create the table if it doesn't exist
      ensureSlicersTableExists();
    }
  } catch (error) {
    console.error('Error getting slicers:', error);
  }
  
  // Add "Open in Slicer" submenu if there are configured slicers and only one file is selected (only in normal mode, not server mode)
  if (!isServerMode && slicers.length > 0 && filePaths.length === 1) {
    const slicerSubmenu = {
      label: 'Open in Slicer',
      submenu: slicers.map(slicer => ({
        label: slicer.name,
        click: async () => {
          try {
            // In server mode, "Open in Slicer" should execute on the client machine, not the server
            // Send command to client to execute locally
            if (isServerMode) {
              let modelPath = filePaths[0];
              
              // If it's a zip entry, we need to handle it (extract on client or download)
              if (isZipEntry && pathInfo) {
                // For zip entries, send both zip path and entry path
                modelPath = `${pathInfo.zipPath}::${pathInfo.entryPath}`;
              }
              
              // Send command to client to execute slicer locally
              if (global.broadcastEvent) {
                global.broadcastEvent('execute-client-command', {
                  type: 'open-in-slicer',
                  filePath: modelPath,
                  slicerName: slicer.name,
                  slicerPath: slicer.path,
                  isZipEntry: isZipEntry || false,
                  zipPath: isZipEntry ? pathInfo.zipPath : null,
                  entryPath: isZipEntry ? pathInfo.entryPath : null
                });
              } else {
                event.sender.send('execute-client-command', {
                  type: 'open-in-slicer',
                  filePath: modelPath,
                  slicerName: slicer.name,
                  slicerPath: slicer.path,
                  isZipEntry: isZipEntry || false,
                  zipPath: isZipEntry ? pathInfo.zipPath : null,
                  entryPath: isZipEntry ? pathInfo.entryPath : null
                });
              }
              return; // Don't try to execute on server
            }
            
            // For hidden Electron window or normal mode, check Docker/Windows path compatibility
            const inDocker = isDockerContainer();
            if (inDocker) {
              // Check if slicer path is a Windows path (starts with drive letter like C:\ or UNC like \\server)
              const hasWindowsDrive = /^[A-Za-z]:[\\/]/.test(slicer.path);
              const hasUncPath = /^\\\\/.test(slicer.path);
              const isWindowsPath = hasWindowsDrive || hasUncPath;
              
              if (isWindowsPath) {
                console.error('[Slicer] Cannot execute Windows slicer in Docker:', slicer.path);
                const win = getWindowFromEvent(event);
                const errorMessage = `The slicer path "${slicer.path}" is a Windows path, but the application is running in a Docker container (Linux).\n\n` +
                  `In Docker/Server mode, slicer paths must be:\n` +
                  `- Linux executable paths (e.g., /usr/bin/slicer)\n` +
                  `- Paths accessible from within the container\n\n` +
                  `If you need to use a Windows slicer, you must run Printventory in normal mode (not Docker/Server mode).`;
                
                if (win && !win.isDestroyed()) {
                  dialog.showMessageBox(win, {
                    type: 'warning',
                    title: 'Slicer Path Not Compatible',
                    message: 'Cannot execute Windows executable in Docker container',
                    detail: errorMessage
                  });
                } else {
                  console.error('[Slicer] Slicer Path Not Compatible:', errorMessage);
                }
                return; // Exit early - don't try to execute
              }
            }
            
            // Execute slicer command (only in normal mode, not server mode)
            const { exec } = require('child_process');
            let modelPath = filePaths[0]; // Use the first file selected
            
            // If it's a zip entry, extract to temp first
            if (isZipEntry && pathInfo) {
              modelPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
            }
            
            // Final safety check: if we're in Docker and path looks like Windows, don't execute
            if (inDocker && (/^[A-Za-z]:[\\/]/.test(slicer.path) || /^\\\\/.test(slicer.path))) {
              console.error('[Slicer] Blocked Windows path execution in Docker:', slicer.path);
              throw new Error('Cannot execute Windows executable in Docker container. Please use a Linux-compatible slicer path.');
            }
            
            let command;
            if (process.platform === 'darwin' && slicer.path.toLowerCase().endsWith('.app')) {
              command = `open -a "${slicer.path}" --args "${modelPath}"`;
            } else {
              command = `"${slicer.path}" "${modelPath}"`;
            }
            
            exec(command, (error, stdout, stderr) => {
              if (error) {
                console.error('Error executing slicer command:', error);
                const win = getWindowFromEvent(event);
                if (win && !win.isDestroyed()) {
                  dialog.showErrorBox('Slice Model Error', error.message);
                }
              }
            });
          } catch (error) {
            console.error('Error slicing model:', error);
            const win = getWindowFromEvent(event);
            if (win && !win.isDestroyed()) {
              dialog.showMessageBox(win, {
                type: 'error',
                title: 'Error',
                message: 'Could not slice model',
                detail: error.message
              });
            } else {
              // In server mode without a window, re-throw so it gets sent to client via WebSocket
              throw error;
            }
          }
        }
      }))
    };
    menuItems.push(slicerSubmenu);
  }

  // Check if API key exists in settings
  const apiKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('apiKey');
  const apiKey = apiKeyRow ? apiKeyRow.value : null;
  
  // Check AI service type
  const aiServiceRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiService');
  const aiService = aiServiceRow ? aiServiceRow.value : 'openai';
  
  // Add "Generate Tags" option if API key exists OR if using Puter (which doesn't need API key)
  if (apiKey || aiService === 'puter') {
    // Capture event.sender for use in the click handler (needed for desktop mode)
    const sender = event.sender;
    menuItems.push({
      label: 'Generate Tags',
      // Remove the restriction to only one file
      click: async (clickEvent) => {
        console.log('[Generate Tags] Click handler called, filePaths:', filePaths);
        // Use clickEvent.sender if available (server mode), otherwise use captured sender (desktop mode)
        const eventSender = (clickEvent && clickEvent.sender) ? clickEvent.sender : sender;
        console.log('[Generate Tags] Event sender:', { 
          hasClickEventSender: !!(clickEvent && clickEvent.sender),
          hasCapturedSender: !!sender,
          usingSender: !!eventSender,
          hasSend: !!(eventSender && eventSender.send)
        });
        try {
          const aitagging = require('./aitagging');
          const settings = getSettings();
          console.log('[Generate Tags] Settings loaded, filesToProcess will be determined');
          
          // Create puter IPC handler if service is puter
          // Pass clickEvent (which is the mockEvent with proper WebSocket routing) so it can route to the correct client
          // If clickEvent doesn't have sender, create a mock event with the captured sender
          const eventForPuter = clickEvent && clickEvent.sender ? clickEvent : { sender: sender, wsClient: null };
          console.log('[Generate Tags] Creating puterIPCHandler, aiService:', settings.aiService, 'has clickEvent:', !!clickEvent, 'has wsClient:', !!(clickEvent?.wsClient));
          const puterIPCHandler = settings.aiService === 'puter' ? createPuterIPCHandler(eventForPuter) : null;
          console.log('[Generate Tags] puterIPCHandler created:', { hasHandler: !!puterIPCHandler, handlerType: typeof puterIPCHandler });
          
          // Initialize OpenAI with the API key
          aitagging.initializeOpenAI(settings.apiKey, settings.apiEndpoint, settings.aiService, puterIPCHandler);
          
          // Filter out invalid file paths first
          const validFilePaths = filePaths.filter(fp => fp && typeof fp === 'string');
          
          // Deduplicate by normalized path (avoids duplicate entries when new models added before refresh, e.g. server/docker)
          const normalizePathForDedup = (p) => {
            if (!p || typeof p !== 'string') return '';
            const n = p.replace(/\\/g, '/').toLowerCase().trim();
            return n.replace(/^\/+/, ''); // strip leading slashes so "/3dmodels/..." and "3dmodels/..." match
          };
          const seenPaths = new Set();
          const filesToProcess = [];
          for (const fp of (validFilePaths.length > 0 ? validFilePaths : filePaths)) {
            const norm = normalizePathForDedup(fp);
            if (norm && !seenPaths.has(norm)) {
              seenPaths.add(norm);
              filesToProcess.push(fp);
            }
          }
          
          // Start tag generation - show review dialog immediately for both single and multiple files
          if (filesToProcess.length > 1) {
            // Send all file paths so the dialog can show all models immediately
            console.log('[Generate Tags] Sending start-batch-tag-generation event, count:', filesToProcess.length, 'isServerMode:', isServerMode);
            if (isServerMode && global.broadcastEvent) {
              // In server mode, use broadcastEvent to send to all WebSocket clients
              console.log('[Generate Tags] Broadcasting start-batch-tag-generation via WebSocket');
              global.broadcastEvent('start-batch-tag-generation', filesToProcess.length, filesToProcess);
            } else if (eventSender && eventSender.send) {
              // Normal mode - use captured sender or clickEvent sender
              console.log('[Generate Tags] Sending start-batch-tag-generation via eventSender.send');
              console.log('[Generate Tags] eventSender details:', {
                hasSend: typeof eventSender.send === 'function',
                isDestroyed: eventSender.isDestroyed ? eventSender.isDestroyed() : 'N/A'
              });
              try {
                eventSender.send('start-batch-tag-generation', filesToProcess.length, filesToProcess);
                console.log('[Generate Tags] Successfully sent start-batch-tag-generation event');
              } catch (sendError) {
                console.error('[Generate Tags] Error sending start-batch-tag-generation event:', sendError);
              }
            } else {
              console.error('[Generate Tags] No valid way to send start-batch-tag-generation event', {
                hasClickEvent: !!clickEvent,
                hasClickEventSender: !!(clickEvent && clickEvent.sender),
                hasCapturedSender: !!sender,
                hasEventSender: !!eventSender,
                hasSend: !!(eventSender && eventSender.send)
              });
            }
          } else if (filesToProcess.length === 1) {
            // For single file, also open dialog immediately with "Generating..." status
            const singleModel = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filesToProcess[0]);
            if (singleModel) {
              const modelTagRows = db.prepare(`
                SELECT t.name 
                FROM tags t
                JOIN model_tags mt ON mt.tag_id = t.id
                WHERE mt.model_id = ?
              `).all(singleModel.id);
              const modelTags = modelTagRows.map(row => row.name);
              
              const modelData = {
                filePath: filesToProcess[0],
                model: singleModel,
                generatedTags: undefined, // undefined means "generating"
                existingTags: modelTags
              };
              
              console.log('[Generate Tags] Sending start-single-tag-generation event, isServerMode:', isServerMode);
              if (isServerMode && global.broadcastEvent) {
                // In server mode, use broadcastEvent to send to all WebSocket clients
                console.log('[Generate Tags] Broadcasting start-single-tag-generation via WebSocket');
                global.broadcastEvent('start-single-tag-generation', filesToProcess[0], modelData);
              } else if (eventSender && eventSender.send) {
                // Normal mode - use captured sender or clickEvent sender
                console.log('[Generate Tags] Sending start-single-tag-generation via eventSender.send');
                console.log('[Generate Tags] eventSender details:', {
                  hasSend: typeof eventSender.send === 'function',
                  isDestroyed: eventSender.isDestroyed ? eventSender.isDestroyed() : 'N/A'
                });
                try {
                  eventSender.send('start-single-tag-generation', filesToProcess[0], modelData);
                  console.log('[Generate Tags] Successfully sent start-single-tag-generation event');
                } catch (sendError) {
                  console.error('[Generate Tags] Error sending start-single-tag-generation event:', sendError);
                }
              } else {
                console.error('[Generate Tags] No valid way to send start-single-tag-generation event', {
                  hasClickEvent: !!clickEvent,
                  hasClickEventSender: !!(clickEvent && clickEvent.sender),
                  hasCapturedSender: !!sender,
                  hasEventSender: !!eventSender,
                  hasSend: !!(eventSender && eventSender.send)
                });
              }
            } else {
              console.log('Model not found in database for single file generation');
            }
          }
          
          // Process files in parallel with concurrency limit
          const concurrency = Math.max(1, Math.min(settings.aiTagConcurrency || 3, 10));
          let completed = 0;
          let successCount = 0;
          let failureCount = 0;
          const totalFiles = filesToProcess.length;
          
          // Helper function to process a single file
          // Use eventSender (captured from event or clickEvent) for sending events
          const processFile = async (filePath, index) => {
            try {
              // Get the model from the database to access its thumbnail
              const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
              
              if (!model) {
                console.log(`Model not found in database: ${filePath}, skipping`);
                completed++;
                      // Send empty tags for skipped models so they appear in the review dialog
                      if (isServerMode && global.broadcastEvent) {
                        global.broadcastEvent('tags-generated', filePath, [], null);
                      } else if (eventSender && eventSender.send) {
                        eventSender.send('tags-generated', filePath, [], null);
                      }
                return;
              }
              
              // Get the model tags from the database
              const modelTagRows = db.prepare(`
                SELECT t.name 
                FROM tags t
                JOIN model_tags mt ON mt.tag_id = t.id
                WHERE mt.model_id = ?
              `).all(model.id);
              
              const modelTags = modelTagRows.map(row => row.name);
              
              // Check if model already has the "AI Tagged" tag (unless retagging is allowed)
              if (!settings.aiTagAllowRetagging && modelTags.includes("AI Tagged")) {
                console.log(`Model ${filePath} already has AI Tagged tag, skipping generation`);
              completed++;
              // Send empty tags for already-tagged models so they appear in the review dialog
              if (isServerMode && global.broadcastEvent) {
                global.broadcastEvent('tags-generated', filePath, [], null);
              } else if (eventSender && eventSender.send) {
                eventSender.send('tags-generated', filePath, [], null);
              }
              return;
              }
              
              // Prepare tag generation options (read aiTagPrompt from DB so we always have latest)
              const aiTagPromptValue = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagPrompt')?.value ?? null;
              const tagOptions = {
                maxTags: settings.aiTagMaxTags,
                useCategories: settings.aiTagUseCategories,
                useJsonResponse: settings.aiTagUseJsonResponse,
                detailLevel: settings.aiTagDetailLevel,
                customPrompt: (aiTagPromptValue != null && String(aiTagPromptValue).trim() !== '') ? String(aiTagPromptValue).trim() : null
              };
              
              let tags = [];
              
              if (!model.thumbnail) {
                // If no thumbnail exists, use default image
                console.log(`No thumbnail found for model ${filePath}, using default image`);
                try {
                  const fs = require('fs').promises;
                  const defaultImagePath = './logo.png';
                  const data = await fs.readFile(defaultImagePath, { encoding: 'base64' });
                  tags = await aitagging.generateTagsForImage(data, settings.aiModel, tagOptions, 2000, 5, filePath);
                  successCount++;
                } catch (error) {
                  console.error(`Error generating tags with default image for ${filePath}:`, error);
                  failureCount++;
                  // Check if it's a rate limit error
                  if (error.message && error.message.includes('Rate limit')) {
                    // Send error info with empty tags
                    if (isServerMode && global.broadcastEvent) {
                      global.broadcastEvent('tags-generated', filePath, [], error.message);
                    } else if (eventSender && eventSender.send) {
                      eventSender.send('tags-generated', filePath, [], error.message);
                    }
                    completed++;
                    return;
                  }
                }
              } else {
                // Extract the base64 data from the thumbnail data URL
                const base64Data = model.thumbnail.split(',')[1];
                
                if (!base64Data) {
                  console.error(`Invalid thumbnail format for ${filePath}`);
                  failureCount++;
                } else {
                  try {
                    // Generate tags using the thumbnail image
                    tags = await aitagging.generateTagsForImage(base64Data, settings.aiModel, tagOptions, 2000, 5, filePath);
                    successCount++;
                  } catch (error) {
                    console.error(`Error generating tags for ${filePath}:`, error);
                    failureCount++;
                    // Check if it's a rate limit error
                    if (error.message && error.message.includes('Rate limit')) {
                      // Send error info with empty tags
                      if (isServerMode && global.broadcastEvent) {
                        global.broadcastEvent('tags-generated', filePath, [], error.message);
                      } else if (eventSender && eventSender.send) {
                        eventSender.send('tags-generated', filePath, [], error.message);
                      }
                      completed++;
                      return;
                    }
                  }
                }
              }
              
              // Send the generated tags back to the renderer process
              if (isServerMode && global.broadcastEvent) {
                global.broadcastEvent('tags-generated', filePath, tags, null);
              } else if (eventSender && eventSender.send) {
                eventSender.send('tags-generated', filePath, tags, null);
              }
              
              completed++;
              // Progress is now shown in the review dialog
            } catch (error) {
              console.error(`Unexpected error processing ${filePath}:`, error);
              failureCount++;
              completed++;
              // Check if it's a rate limit error
              if (error.message && error.message.includes('Rate limit')) {
                // Send error info with empty tags
                if (isServerMode && global.broadcastEvent) {
                  global.broadcastEvent('tags-generated', filePath, [], error.message);
                } else if (eventSender && eventSender.send) {
                  eventSender.send('tags-generated', filePath, [], error.message);
                }
              } else {
                // Send empty tags for failed models so they appear in the review dialog
                if (isServerMode && global.broadcastEvent) {
                  global.broadcastEvent('tags-generated', filePath, []);
                } else if (eventSender && eventSender.send) {
                  eventSender.send('tags-generated', filePath, []);
                }
              }
            }
          };
          
          // Process files in batches with concurrency limit
          for (let i = 0; i < filesToProcess.length; i += concurrency) {
            const batch = filesToProcess.slice(i, i + concurrency);
            await Promise.all(batch.map((filePath, batchIndex) => 
              processFile(filePath, i + batchIndex)
            ));
          }
          
          // Signal batch completion for multiple files
          if (totalFiles > 1) {
            if (isServerMode && global.broadcastEvent) {
              global.broadcastEvent('batch-tag-generation-complete');
            } else if (eventSender && eventSender.send) {
              eventSender.send('batch-tag-generation-complete');
            }
          }
        } catch (error) {
          console.error('Error generating tags:', error);
          
          // Close progress dialog if open
          if (filePaths.length > 1 && eventSender && eventSender.send) {
            eventSender.send('close-progress-dialog');
          }
          
          // Provide more user-friendly error messages
          let errorMessage = 'Could not generate tags';
          let errorDetail = error.message || 'An unknown error occurred';
          
          if (error.message && error.message.includes('Authentication failed')) {
            errorMessage = 'Authentication Error';
            errorDetail = 'Your API key is invalid or has insufficient permissions. Please check your AI configuration settings.';
          } else if (error.message && error.message.includes('Network error')) {
            errorMessage = 'Connection Error';
            errorDetail = 'Unable to connect to the AI service. Please check your internet connection and API endpoint settings.';
          } else if (error.message && error.message.includes('Rate limit')) {
            errorMessage = 'Rate Limit Exceeded';
            // Extract the detailed message if available (after "Rate limit exceeded: ")
            const detailedMessage = error.message.includes('Rate limit exceeded: ') 
              ? error.message.split('Rate limit exceeded: ')[1]
              : 'API rate limit has been exceeded. Please try again later.';
            errorDetail = detailedMessage;
          } else if (error.message && error.message.includes('Invalid request')) {
            errorMessage = 'Invalid Request';
            errorDetail = error.message;
          }
          
          dialog.showMessageBox({
            type: 'error',
            title: errorMessage,
            message: errorDetail,
            detail: error.stack ? `Technical details: ${error.stack.substring(0, 200)}...` : ''
          });
        }
      }
    });
  }

  // Check if any selected files are 3MF files
  const has3MFFiles = filePaths.some(fp => {
    const ext = path.extname(fp).toLowerCase();
    // Handle zip entries - check the entry path extension
    if (fp.includes('::')) {
      const entryPath = fp.split('::')[1];
      return path.extname(entryPath).toLowerCase() === '.3mf';
    }
    return ext === '.3mf';
  });
  
  // Add "Pull Metadata" option for 3MF files
  if (has3MFFiles) {
    menuItems.push({
      label: 'Pull Metadata',
      click: async () => {
        try {
          // Filter to only 3MF files
          const threeMFFiles = filePaths.filter(fp => {
            const ext = path.extname(fp).toLowerCase();
            if (fp.includes('::')) {
              const entryPath = fp.split('::')[1];
              return path.extname(entryPath).toLowerCase() === '.3mf';
            }
            return ext === '.3mf';
          });
          
          if (threeMFFiles.length === 0) {
            return;
          }
          
          // Check existing models to see if any have data that will be overwritten
          const modelsWithData = [];
          for (const filePath of threeMFFiles) {
            const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
            if (model) {
              const hasData = (model.designer && model.designer.trim()) ||
                             (model.parentModel && model.parentModel.trim()) ||
                             (model.notes && model.notes.trim()) ||
                             (model.license && model.license.trim());
              if (hasData) {
                modelsWithData.push({
                  filePath,
                  fileName: model.fileName || path.basename(filePath),
                  designer: model.designer,
                  parentModel: model.parentModel,
                  notes: model.notes,
                  license: model.license
                });
              }
            }
          }
          
          // Show confirmation dialog if any models have existing data
          const win = BrowserWindow.fromWebContents(event.sender);
          if (modelsWithData.length > 0) {
            const message = modelsWithData.length === 1
              ? `This will overwrite existing metadata for:\n\n${modelsWithData[0].fileName}\n\nExisting data:\n${modelsWithData[0].designer ? `Designer: ${modelsWithData[0].designer}\n` : ''}${modelsWithData[0].parentModel ? `Parent Model: ${modelsWithData[0].parentModel}\n` : ''}${modelsWithData[0].notes ? `Notes: ${modelsWithData[0].notes.substring(0, 50)}${modelsWithData[0].notes.length > 50 ? '...' : ''}\n` : ''}${modelsWithData[0].license ? `License: ${modelsWithData[0].license}\n` : ''}\n\nContinue?`
              : `This will overwrite existing metadata for ${modelsWithData.length} model(s).\n\nContinue?`;
            
            const confirm = await dialog.showMessageBox(win, {
              type: 'warning',
              title: 'Confirm Metadata Overwrite',
              message: message,
              buttons: ['Yes', 'No'],
              defaultId: 1,
              cancelId: 1
            });
            
            if (confirm.response !== 0) {
              return; // User cancelled
            }
          }
          
          // Process each file
          const results = [];
          let successCount = 0;
          let errorCount = 0;
          let noMetadataCount = 0;
          
          for (const filePath of threeMFFiles) {
            try {
              const metadata = await extract3MFMetadata(filePath);
              
              // Filter metadata based on user settings
              const filteredMetadata = filter3MFMetadataBySettings(metadata);
              
              if (filteredMetadata && (filteredMetadata.designer || filteredMetadata.parentModel || filteredMetadata.notes || filteredMetadata.license)) {
                // Get or create model in database
                let existingModel = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
                
                if (!existingModel) {
                  // Create new model entry
                  const fileName = path.basename(filePath);
                  const finalFileName = filePath.includes('::') 
                    ? filePath.split('::').pop() 
                    : fileName;
                  const dateAdded = new Date().toISOString();
                  
                  db.prepare(`
                    INSERT INTO models (filePath, fileName, designer, parentModel, notes, license, dateAdded)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                  `).run(
                    filePath,
                    finalFileName,
                    filteredMetadata.designer || null,
                    filteredMetadata.parentModel || null,
                    filteredMetadata.notes || null,
                    filteredMetadata.license || null,
                    dateAdded
                  );
                  
                  results.push({ filePath, success: true, action: 'created' });
                  successCount++;
                } else {
                  // Update existing model - overwrite all fields
                  db.prepare(`
                    UPDATE models 
                    SET designer = ?, parentModel = ?, notes = ?, license = ?
                    WHERE filePath = ?
                  `).run(
                    filteredMetadata.designer || null,
                    filteredMetadata.parentModel || null,
                    filteredMetadata.notes || null,
                    filteredMetadata.license || null,
                    filePath
                  );
                  
                  results.push({ filePath, success: true, action: 'updated' });
                  successCount++;
                }
              } else {
                results.push({ filePath, success: false, error: 'No metadata found in 3MF file' });
                noMetadataCount++;
              }
            } catch (error) {
              console.error(`Error processing ${filePath}:`, error);
              results.push({ filePath, success: false, error: error.message });
              errorCount++;
            }
          }
          
          // Refresh the grid
          event.sender.send('refresh-grid');
          
          // Show completion message
          let message = '';
          if (successCount > 0) {
            message = `Successfully pulled metadata from ${successCount} file(s).`;
          }
          
          const parts = [];
          if (noMetadataCount > 0) {
            parts.push(`${noMetadataCount} file(s) didn't have metadata`);
          }
          if (errorCount > 0) {
            parts.push(`${errorCount} file(s) had errors`);
          }
          
          if (parts.length > 0) {
            if (message) {
              message += '\n\n' + parts.join('.\n');
            } else {
              message = parts.join('.\n');
            }
          }
          
          if (!message) {
            message = 'No files processed.';
          }
          
          await dialog.showMessageBox(win, {
            type: 'info',
            title: 'Metadata Pull Complete',
            message: message
          });
        } catch (error) {
          console.error('Error pulling metadata:', error);
          const win = BrowserWindow.fromWebContents(event.sender);
          await dialog.showMessageBox(win, {
            type: 'error',
            title: 'Error',
            message: 'Could not pull metadata',
            detail: error.message
          });
        }
      }
    });
  }

  // Add "Add Image" option for single or multi selection (same image added to all selected)
  if (filePaths.length >= 1) {
    menuItems.push({
      label: 'Add Image',
      click: async () => {
        try {
          if (isServerMode) {
            // In server mode: send event to renderer to show file input dialog (pass all paths for multi-edit)
            if (global.broadcastEvent) {
              global.broadcastEvent('add-image-request', filePaths);
            } else {
              event.sender.send('add-image-request', filePaths);
            }
          } else {
            // Normal mode: use native file dialog
            const win = BrowserWindow.fromWebContents(event.sender);
            const result = await dialog.showOpenDialog(win, {
              title: 'Select Image File',
              properties: ['openFile'],
              filters: [
                { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] },
                { name: 'All Files', extensions: ['*'] }
              ]
            });
            
            if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
              const imagePath = result.filePaths[0];
              
              // Read the image file and convert to data URL
              const imageData = await fs.promises.readFile(imagePath);
              const ext = path.extname(imagePath).toLowerCase().slice(1);
              let mimeType = 'image/png';
              if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
              else if (ext === 'gif') mimeType = 'image/gif';
              else if (ext === 'webp') mimeType = 'image/webp';
              
              const base64Data = imageData.toString('base64');
              const dataUrl = `data:${mimeType};base64,${base64Data}`;
              
              // Add the same image to each selected model
              for (const filePath of filePaths) {
                const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
                const currentThumbnail = model?.thumbnail || null;
                const thumbnailsWithNew = addThumbnailToModel(currentThumbnail, dataUrl);
                const thumbnails = parseThumbnails(thumbnailsWithNew);
                const newImageIndex = thumbnails.length - 1;
                const updatedThumbnail = setDefaultThumbnailIndex(thumbnailsWithNew, newImageIndex);
                await saveThumbnail(filePath, updatedThumbnail);
                const verifyModel = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
                const finalThumbnails = parseThumbnails(verifyModel?.thumbnail || '');
                event.sender.send('thumbnail-added', {
                  filePath: filePath,
                  thumbnailCount: finalThumbnails.length,
                  hasMultiple: finalThumbnails.length > 1,
                  newImageIsDefault: true
                });
              }
            }
          }
        } catch (error) {
          console.error('Error adding image:', error);
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) {
            dialog.showMessageBox(win, {
              type: 'error',
              title: 'Error',
              message: 'Could not add image',
              detail: error.message
            });
          }
        }
      }
    });
  }

  // Add "Manage Thumbnails" option for single file selection only
  if (filePaths.length === 1) {
    menuItems.push({
      label: 'Manage Thumbnails',
      click: async () => {
        try {
          // Check if model has at least one thumbnail
          const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePaths[0]);
          const thumbnails = model?.thumbnail ? parseThumbnails(model.thumbnail).filter(t => t && t !== '3d.png' && t.length > 0 && t.startsWith('data:image')) : [];
          
          if (thumbnails.length === 0) {
            const win = BrowserWindow.fromWebContents(event.sender);
            if (win) {
              await dialog.showMessageBox(win, {
                type: 'info',
                title: 'No Thumbnails',
                message: 'This model has no thumbnails to manage.',
                detail: 'Please add an image first using "Add Image".'
              });
            }
            return;
          }
          
          // Send event to renderer to show manage thumbnails modal
          if (isServerMode && global.broadcastEvent) {
            global.broadcastEvent('manage-thumbnails-request', filePaths[0]);
          } else {
            event.sender.send('manage-thumbnails-request', filePaths[0]);
          }
        } catch (error) {
          console.error('Error opening manage thumbnails:', error);
          const win = BrowserWindow.fromWebContents(event.sender);
          if (win) {
            dialog.showMessageBox(win, {
              type: 'error',
              title: 'Error',
              message: 'Could not open thumbnail manager',
              detail: error.message
            });
          }
        }
      }
    });
  }

  // Add separator before file operations
  menuItems.push({ type: 'separator' });

  // Add Move and new file operations
  // Note: "Move" is excluded in server mode
  const fileOperationItems = [];
  
  // Add "Move" only if NOT in server mode
  if (!isServerMode) {
    fileOperationItems.push({
      label: 'Move',
      click: async () => {
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = await dialog.showOpenDialog(win, {
          title: 'Select Destination Folder',
          properties: ['openDirectory']
        });
        if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
          const destinationFolder = result.filePaths[0];
          for (const fp of filePaths) {
            const newDestination = path.join(destinationFolder, path.basename(fp));
            try {
              await fs.promises.rename(fp, newDestination);
              db.prepare('UPDATE models SET filePath = ? WHERE filePath = ?').run(newDestination, fp);
            } catch (error) {
              await dialog.showMessageBox(win, {
                type: 'error',
                title: 'Error Moving File',
                message: `Failed to move file ${fp}: ${error.message}`
              });
            }
          }
          event.sender.send('refresh-grid');
        }
      }
    });
  }
  
  menuItems.push(
    ...fileOperationItems,
    {
      label: 'Remove from Library',
      click: async () => {
        // In server mode (Docker/browser), no native dialog - proceed and broadcast refresh
        let confirmed = isServerMode;
        if (!isServerMode) {
          const maxFilesToShow = 20;
          const fileList = filePaths.slice(0, maxFilesToShow).map(fp => path.basename(fp)).join('\n');
          const moreFiles = filePaths.length > maxFilesToShow ? `\n... and ${filePaths.length - maxFilesToShow} more file${filePaths.length - maxFilesToShow === 1 ? '' : 's'}` : '';
          const confirm = await dialog.showMessageBox({
            type: 'warning',
            title: 'Confirm Remove',
            message: `Are you sure you want to remove ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} from the library?\nFiles will remain on disk but will be removed from Printventory.\n\nFiles:\n${fileList}${moreFiles}`,
            buttons: ['Yes', 'No'],
            defaultId: 1,
            cancelId: 1,
          });
          confirmed = confirm.response === 0;
        }
        if (confirmed) {
          try {
            db.transaction(() => {
              filePaths.forEach(fp => {
                const model = db.prepare('SELECT id FROM models WHERE filePath = ?').get(fp);
                if (model) {
                  db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(model.id);
                  db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
                }
              });
            })();
            if (isServerMode && global.broadcastEvent) {
              global.broadcastEvent('refresh-grid');
            } else {
              event.sender.send('refresh-grid');
            }
          } catch (error) {
            console.error('Error removing from library:', error);
            if (!isServerMode) {
              await dialog.showMessageBox({
                type: 'error',
                title: 'Error',
                message: `An error occurred while removing from library: ${error.message}`
              });
            }
          }
        }
      }
    },
    {
      label: 'Delete from Disk',  // Renamed from just "Delete"
      click: async () => {
        // In server mode (Docker/browser), no native dialog - proceed and broadcast refresh
        let confirmed = isServerMode;
        if (!isServerMode) {
          const maxFilesToShow = 20;
          const fileList = filePaths.slice(0, maxFilesToShow).map(fp => path.basename(fp)).join('\n');
          const moreFiles = filePaths.length > maxFilesToShow ? `\n... and ${filePaths.length - maxFilesToShow} more file${filePaths.length - maxFilesToShow === 1 ? '' : 's'}` : '';
          const confirm = await dialog.showMessageBox({
            type: 'warning',
            title: 'Confirm Delete',
            message: `Are you sure you want to DELETE ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} from disk?\nThis will permanently delete the files and cannot be undone!\n\nFiles:\n${fileList}${moreFiles}`,
            buttons: ['Yes', 'No'],
            defaultId: 1,
            cancelId: 1,
          });
          confirmed = confirm.response === 0;
        }
        if (confirmed) {
          for (const fp of filePaths) {
            try {
              const success = await deleteFile(fp);
              if (!success && !isServerMode) {
                await dialog.showMessageBox({
                  type: 'error',
                  title: 'Error',
                  message: `Failed to delete file: ${fp}`
                });
              }
            } catch (error) {
              console.error('Error deleting file:', error);
              if (!isServerMode) {
                await dialog.showMessageBox({
                  type: 'error',
                  title: 'Error',
                  message: `An error occurred: ${error.message}`
                });
              }
            }
          }
          if (isServerMode && global.broadcastEvent) {
            global.broadcastEvent('refresh-grid');
          } else {
            event.sender.send('refresh-grid');
          }
        }
      }
    }
  );

  const menu = Menu.buildFromTemplate(menuItems);
  
  // Get the window - use helper function that handles server mode
  const win = getWindowFromEvent(event);
  
  // Test mode or server mode without window: return HTML menu so Playwright can assert on it
  const useHtmlMenu = (process.env.PRINTVENTORY_TEST_SCAN_PATH && process.env.PRINTVENTORY_TEST_SCAN_PATH.length > 0) || (isServerMode && !win);
  if (useHtmlMenu) {
    // Generate unique request ID for this context menu
    const requestId = `ctx_${++contextMenuRequestIdCounter}_${Date.now()}`;
    
    // Store the menu items with their click handlers
    pendingContextMenus.set(requestId, {
      menuItems: menuItems,
      filePaths: filePaths,
      event: event,
      timestamp: Date.now()
    });
    
    // Clean up old menus (older than 5 minutes)
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    for (const [id, menu] of pendingContextMenus.entries()) {
      if (menu.timestamp < fiveMinutesAgo) {
        pendingContextMenus.delete(id);
      }
    }
    
    // Serialize menu items for browser rendering
    const serializedItems = menuItems.map((item, index) => {
      if (item.type === 'separator') {
        return { type: 'separator' };
      }
      const serialized = {
        label: item.label,
        enabled: item.enabled !== false, // Default to true if not specified
        index: index
      };
      // Handle submenus
      if (item.submenu) {
        serialized.submenu = item.submenu.map((subItem, subIndex) => ({
          label: subItem.label,
          enabled: subItem.enabled !== false,
          index: index,
          subIndex: subIndex
        }));
      }
      return serialized;
    });
    
    // Return menu items instead of showing native menu
    return {
      type: 'html-menu',
      requestId: requestId,
      items: serializedItems,
      filePaths: filePaths
    };
  }
  
  // In Docker/server mode, use mainWindow if available, or popup without window parameter
  if (win) {
    menu.popup({ window: win });
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    // Fallback to mainWindow in server mode
    menu.popup({ window: mainWindow });
  } else {
    // Last resort: popup without window (uses current focused window)
    menu.popup();
  }
  
  // Return null for normal mode (menu already shown)
  return null;
});

// IPC handler to execute context menu actions (for server mode browser access)
const executeContextMenuActionHandler = async (event, requestId, itemIndex, subIndex) => {
  console.log('[Context Menu] executeContextMenuActionHandler called, requestId:', requestId, 'itemIndex:', itemIndex, 'subIndex:', subIndex);
  const menuData = pendingContextMenus.get(requestId);
  if (!menuData) {
    throw new Error('Context menu request not found or expired');
  }
  
  const { menuItems, event: originalEvent } = menuData;
  const menuItem = menuItems[itemIndex];
  
  if (!menuItem) {
    throw new Error('Menu item not found');
  }
  
  console.log('[Context Menu] Menu item label:', menuItem.label, 'has click:', !!menuItem.click, 'has submenu:', !!menuItem.submenu);
  
  // Handle submenu items
  if (subIndex !== undefined && subIndex !== null && menuItem.submenu) {
    const subMenuItem = menuItem.submenu[subIndex];
    if (!subMenuItem || !subMenuItem.click) {
      throw new Error('Submenu item not found or has no action');
    }
    
    // Use the event passed in (has proper WebSocket routing in server mode)
    // Fallback to originalEvent if event doesn't have sender (backward compatibility)
    // IMPORTANT: Preserve wsClient from the event parameter for Puter AI routing
    const mockEvent = event && event.sender ? {
      ...event,
      // Ensure wsClient is preserved
      wsClient: event.wsClient || null
    } : {
      sender: originalEvent.sender,
      wsClient: event?.wsClient || originalEvent?.wsClient || null
    };
    
    console.log('[Context Menu] Created mockEvent for submenu click handler:', {
      hasSender: !!mockEvent.sender,
      hasWsClient: !!mockEvent.wsClient,
      isServerMode
    });
    
    // Execute the submenu item's click handler
    // Wrap in try-catch to handle errors gracefully
    console.log('[Context Menu] Executing submenu item click handler:', subMenuItem.label);
    try {
      const result = subMenuItem.click(mockEvent);
      // If it returns a promise, don't await it to avoid IPC timeout
      // The handler should send events immediately (like dialog opening)
      if (result && typeof result.then === 'function') {
        // Async handler - let it run in background, return immediately
        result.catch(err => {
          console.error('Error in async context menu click handler:', err);
        });
        pendingContextMenus.delete(requestId);
        return { success: true };
      } else {
        // Sync handler - already completed
        pendingContextMenus.delete(requestId);
        return { success: true };
      }
    } catch (err) {
      console.error('Error in context menu click handler:', err);
      pendingContextMenus.delete(requestId);
      throw err;
    }
  } else if (menuItem.click) {
    // Use the event passed in (has proper WebSocket routing in server mode)
    // Fallback to originalEvent if event doesn't have sender (backward compatibility)
    // IMPORTANT: Preserve wsClient from the event parameter for Puter AI routing
    const mockEvent = event && event.sender ? {
      ...event,
      // Ensure wsClient is preserved
      wsClient: event.wsClient || null
    } : {
      sender: originalEvent.sender,
      wsClient: event?.wsClient || originalEvent?.wsClient || null
    };
    
    console.log('[Context Menu] Created mockEvent for click handler:', {
      hasSender: !!mockEvent.sender,
      hasWsClient: !!mockEvent.wsClient,
      isServerMode
    });
    
    // Execute the menu item's click handler
    // Wrap in try-catch to handle errors gracefully
    console.log('[Context Menu] Executing menu item click handler:', menuItem.label);
    try {
      const result = menuItem.click(mockEvent);
      // If it returns a promise, don't await it to avoid IPC timeout
      // The handler should send events immediately (like dialog opening)
      if (result && typeof result.then === 'function') {
        // Async handler - let it run in background, return immediately
        result.catch(err => {
          console.error('Error in async context menu click handler:', err);
        });
        pendingContextMenus.delete(requestId);
        return { success: true };
      } else {
        // Sync handler - already completed
        pendingContextMenus.delete(requestId);
        return { success: true };
      }
    } catch (err) {
      console.error('Error in context menu click handler:', err);
      pendingContextMenus.delete(requestId);
      throw err;
    }
  }
  
  // Clean up after execution
  pendingContextMenus.delete(requestId);
  
  return { success: true };
};

ipcMain.handle('execute-context-menu-action', executeContextMenuActionHandler);
// Register in handler registry for direct WebSocket invocation
ipcHandlerRegistry.set('execute-context-menu-action', executeContextMenuActionHandler);

// Update the deleteFile function
async function deleteFile(filePath) {
  try {
    if (!isUrlModel(filePath)) {
      // Delete the actual file
      await fs.promises.unlink(filePath);
    }
    
    // Use a transaction to handle database operations
    db.transaction(() => {
      // Get the model ID first
      const model = db.prepare('SELECT id FROM models WHERE filePath = ?').get(filePath);
      if (model) {
        // First delete from model_tags (child table)
        db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(model.id);
        
        // Then delete from models (parent table)
        db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
      }
    })();
    
    return true;
  } catch (err) {
    console.error("Error deleting file:", err);
    console.error("Error details:", {
      message: err.message,
      code: err.code,
      path: filePath
    });
    return false;
  }
}

// Update the handler name to match the convention
ipcMain.handle('get-model-tags', async (event, modelId) => {
  try {
    return db.prepare(`
      SELECT t.* 
      FROM tags t 
      JOIN model_tags mt ON mt.tag_id = t.id 
      WHERE mt.model_id = ?
    `).all(modelId);
  } catch (error) {
    console.error('Error getting model tags:', error);
    throw error;
  }
});

// Add these handlers
ipcMain.handle('quitApp', () => {
  app.quit();
});

ipcMain.handle('getSetting', async (event, key) => {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  } catch (error) {
    console.error('Error getting setting:', error);
    throw error;
  }
});

ipcMain.handle('saveSetting', async (event, key, value) => {
  try {
    db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
    return true;
  } catch (error) {
    console.error('Error saving setting:', error);
    throw error;
  }
});

// Browser extension server control (normal mode only)
ipcMain.handle('start-extension-server', async (event, port) => {
  if (isServerMode) return { success: false, message: 'Not available in server mode' };
  try {
    const portNum = parseInt(port, 10) || 5000;
    if (httpServer) await stopHttpServer();
    console.log('[Browser extension] Starting server on port', portNum, '...');
    await startHttpServer(portNum, true);
    console.log('[Browser extension] Server started successfully');
    return { success: true };
  } catch (error) {
    console.error('[Browser extension] Error starting extension server:', error.message);
    return { success: false, message: error?.message || 'Failed to start' };
  }
});

ipcMain.handle('stop-extension-server', async () => {
  if (isServerMode) return { success: false, message: 'Not available in server mode' };
  try {
    await stopHttpServer();
    return { success: true };
  } catch (error) {
    console.error('Error stopping extension server:', error);
    return { success: false, message: error?.message || 'Failed to stop' };
  }
});

// Update the database path handling
function getDatabasePath() {
  try {
    if (isDev) {
      return path.join(__dirname, 'printventory.db');
    }
    
    // Handle different OS paths
    let userDataPath;
    if (process.platform === 'darwin') { // macOS
      userDataPath = path.join(app.getPath('userData'), 'data');
    } else if (process.platform === 'win32') { // Windows
      userDataPath = path.join(process.env.LOCALAPPDATA, 'Printventory', 'data');
    } else { // Linux and other Unix-like systems
      userDataPath = path.join(app.getPath('userData'), 'data');
    }

    // Ensure the directory exists
    if (!fs.existsSync(userDataPath)) {
      fs.mkdirSync(userDataPath, { recursive: true });
    }

    const dbPath = path.join(userDataPath, 'printventory.db');
    debugLog('Using database path:', dbPath);
    return dbPath;
  } catch (error) {
    console.error('Error setting up database path:', error);
    throw error;
  }
}

// Add these IPC handlers
// Helper: URL-only models (added by Chrome extension) have filePath "url::https://..."
function isUrlModel(filePath) {
  return typeof filePath === 'string' && filePath.startsWith('url::');
}

// Helper function to parse zip path format
function parseZipPath(filePath) {
  if (isUrlModel(filePath)) {
    return { zipPath: filePath, entryPath: null, isZipEntry: false };
  }
  if (filePath.includes('::')) {
    const [zipPath, entryPath] = filePath.split('::');
    return { zipPath, entryPath, isZipEntry: true };
  }
  return { zipPath: filePath, entryPath: null, isZipEntry: false };
}

// Skip macOS resource-fork / AppleDouble entries (._*) - they are not valid 3MF/ZIP
function isMacOsResourceForkEntry(entryPath) {
  if (!entryPath) return false;
  const base = path.basename(entryPath);
  return base.startsWith('._');
}

// Minimum ZIP is 22 bytes (end-of-central-directory). 3MF is ZIP-based (starts with PK).
function isLikelyValidZipBuffer(data) {
  if (!Buffer.isBuffer(data) || data.length < 22) return false;
  return data[0] === 0x50 && data[1] === 0x4B; // PK
}

// Helper function to extract model from zip to temp file or specified destination
async function extractModelFromZip(zipPath, entryPath, destinationPath = null) {
  try {
    const StreamZip = require('node-stream-zip');
    const zip = new StreamZip.async({ file: zipPath });
    const entryData = await zip.entryData(entryPath);
    await zip.close();
    
    if (destinationPath) {
      // Extract to specified destination, preserving directory structure
      const destPath = path.join(destinationPath, entryPath);
      const destDir = path.dirname(destPath);
      await fs.promises.mkdir(destDir, { recursive: true });
      await fs.promises.writeFile(destPath, entryData);
      return destPath;
    } else {
      // Create temp file
      const tempDir = os.tmpdir();
      const fileName = path.basename(entryPath);
      const tempPath = path.join(tempDir, `printventory_${Date.now()}_${fileName}`);
      await fs.promises.writeFile(tempPath, entryData);
      return tempPath;
    }
  } catch (error) {
    console.error(`Error extracting ${entryPath} from ${zipPath}:`, error);
    throw error;
  }
}

// Helper function to clean HTML entities and special characters from description text
function cleanDescriptionText(text) {
  if (!text) return text;
  
  let cleaned = text;
  
  // First, decode double-encoded HTML entities (e.g., &amp;lt; becomes &lt;, &amp;#34; becomes &#34;)
  // This handles cases where entities are encoded multiple times
  let previousCleaned = '';
  while (cleaned !== previousCleaned) {
    previousCleaned = cleaned;
    cleaned = cleaned.replace(/&amp;(#?\w+;)/g, '&$1');
  }
  
  // Decode common HTML entities
  cleaned = cleaned.replace(/&lt;/g, '<');
  cleaned = cleaned.replace(/&gt;/g, '>');
  cleaned = cleaned.replace(/&quot;/g, '"');
  cleaned = cleaned.replace(/&#34;/g, '"');
  cleaned = cleaned.replace(/&#39;/g, "'");
  cleaned = cleaned.replace(/&apos;/g, "'");
  cleaned = cleaned.replace(/&nbsp;/g, ' ');
  cleaned = cleaned.replace(/&#160;/g, ' ');
  cleaned = cleaned.replace(/&amp;/g, '&');
  
  // Remove HTML tags (including nested tags and multiline)
  cleaned = cleaned.replace(/<[^>]*>/g, '');
  
  // Decode any remaining numeric entities (decimal and hexadecimal)
  cleaned = cleaned.replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(parseInt(dec, 10)));
  cleaned = cleaned.replace(/&#x([0-9a-fA-F]+);/gi, (match, hex) => String.fromCharCode(parseInt(hex, 16)));
  
  // Clean up whitespace - replace multiple spaces/newlines/tabs with single space
  cleaned = cleaned.replace(/\s+/g, ' ');
  
  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

// Helper function to parse 3MF model XML and extract metadata
function parse3MFModelXML(xmlContent) {
  const metadata = {
    designer: null,
    parentModel: null,
    notes: null,
    license: null
  };

  try {
    // Extract metadata values using regex
    // Pattern: <metadata name="FieldName">value</metadata>
    // Updated to handle multiline content and CDATA sections
    const metadataPattern = /<metadata\s+name="([^"]+)"[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/metadata>/gis;
    let match;

    while ((match = metadataPattern.exec(xmlContent)) !== null) {
      const fieldName = match[1].trim();
      let fieldValue = match[2].trim();
      
      // If the value is in a CDATA section, it's already extracted by the regex
      // Otherwise, handle any remaining encoding

      // Map XML metadata names to database fields
      if (fieldName === 'Designer' && fieldValue) {
        metadata.designer = fieldValue;
      } else if (fieldName === 'Title' && fieldValue) {
        metadata.parentModel = fieldValue;
      } else if (fieldName === 'Description' && fieldValue) {
        metadata.notes = cleanDescriptionText(fieldValue);
      } else if (fieldName === 'License' && fieldValue) {
        metadata.license = fieldValue;
      }
    }
  } catch (error) {
    console.error('Error parsing 3MF model XML:', error);
  }

  return metadata;
}

// Helper function to filter 3MF metadata based on user settings
function filter3MFMetadataBySettings(metadata) {
  const filtered = {
    designer: null,
    parentModel: null,
    notes: null,
    license: null
  };
  
  try {
    // Get settings from database (default to '1' if not set)
    const enableDesigner = db.prepare('SELECT value FROM settings WHERE key = ?').get('enable3MFDesigner');
    const enableParentModel = db.prepare('SELECT value FROM settings WHERE key = ?').get('enable3MFParentModel');
    const enableLicense = db.prepare('SELECT value FROM settings WHERE key = ?').get('enable3MFLicense');
    const enableNotes = db.prepare('SELECT value FROM settings WHERE key = ?').get('enable3MFNotes');
    
    // Include field if setting is '1' or not set (default enabled)
    if (metadata.designer && (enableDesigner?.value === '1' || !enableDesigner)) {
      filtered.designer = metadata.designer;
    }
    if (metadata.parentModel && (enableParentModel?.value === '1' || !enableParentModel)) {
      filtered.parentModel = metadata.parentModel;
    }
    if (metadata.license && (enableLicense?.value === '1' || !enableLicense)) {
      filtered.license = metadata.license;
    }
    if (metadata.notes && (enableNotes?.value === '1' || !enableNotes)) {
      filtered.notes = metadata.notes;
    }
  } catch (error) {
    console.error('Error filtering 3MF metadata by settings:', error);
    // On error, return original metadata (fail open)
    return metadata;
  }
  
  return filtered;
}

// Helper function to extract metadata from a 3MF file
async function extract3MFMetadata(filePath) {
  try {
    // Check if this is a zip entry
    const pathInfo = parseZipPath(filePath);
    let actualFilePath = filePath;
    let shouldCleanup = false;
    
    if (pathInfo.isZipEntry && isMacOsResourceForkEntry(pathInfo.entryPath)) {
      return null;
    }
    
    if (pathInfo.isZipEntry) {
      // Extract to temp file first
      try {
        actualFilePath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
        shouldCleanup = true;
      } catch (error) {
        console.error('Error extracting zip entry for 3MF metadata:', error);
        return null;
      }
    }
    
    // Check if file exists
    if (!fs.existsSync(actualFilePath)) {
      console.error('File does not exist:', actualFilePath);
      return null;
    }
    
    const data = await fs.promises.readFile(actualFilePath);
    if (!isLikelyValidZipBuffer(data)) {
      return null;
    }
    
    // Use JSZip to extract the 3MF file (which is a zip file)
    const zip = new JSZip();
    let contents;
    try {
      contents = await zip.loadAsync(data);
    } catch (zipError) {
      return null;
    }
    
    // Parse 3dmodel.model XML file to extract metadata
    const modelXmlPath = '3D/3dmodel.model';
    const altModelXmlPath = '/3D/3dmodel.model';
    
    // Try both path variations (with and without leading slash)
    let modelXmlFile = contents.files[modelXmlPath] || contents.files[altModelXmlPath];
    
    if (modelXmlFile && !modelXmlFile.dir) {
      const xmlContent = await modelXmlFile.async('string');
      const parsedMetadata = parse3MFModelXML(xmlContent);
      
      // Clean up temp file if needed
      if (shouldCleanup && actualFilePath !== filePath) {
        try {
          await fs.promises.unlink(actualFilePath);
        } catch (cleanupError) {
          console.error('Error cleaning up temp file:', cleanupError);
        }
      }
      
      return parsedMetadata;
    } else {
      // Clean up temp file if needed
      if (shouldCleanup && actualFilePath !== filePath) {
        try {
          await fs.promises.unlink(actualFilePath);
        } catch (cleanupError) {
          console.error('Error cleaning up temp file:', cleanupError);
        }
      }
      return null;
    }
  } catch (error) {
    console.error('Error extracting 3MF metadata:', error);
    return null;
  }
}

ipcMain.handle('get3MFImages', async (event, filePath) => {
  if (isUrlModel(filePath)) return [];
  // Skip files located in __MACOSX directories
  if (/[\\\/]__macosx[\\\/]/i.test(filePath)) {
    console.log('Skipping file from __MACOSX directory:', filePath);
    return [];
  }
  
  // Check if this is a zip entry
  const pathInfo = parseZipPath(filePath);
  let actualFilePath = filePath;
  
  // Skip macOS resource-fork entries (._*) - not valid 3MF
  if (pathInfo.isZipEntry && isMacOsResourceForkEntry(pathInfo.entryPath)) {
    console.log('Skipping macOS resource-fork entry (not a 3MF):', pathInfo.entryPath);
    return [];
  }
  
  if (pathInfo.isZipEntry) {
    // Extract to temp file first
    try {
      actualFilePath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
    } catch (error) {
      console.error('Error extracting zip entry for 3MF images:', error);
      return [];
    }
  }
  
  try {
    console.log('Starting to process 3MF file:', actualFilePath);
    
    // Check if file exists
    if (!fs.existsSync(actualFilePath)) {
      console.error('File does not exist:', actualFilePath);
      return [];
    }
    
    const data = await fs.promises.readFile(actualFilePath);
    if (!isLikelyValidZipBuffer(data)) {
      console.log('Skipping non-ZIP or too-small file (e.g. macOS ._ file):', actualFilePath, 'size:', data.length);
      return [];
    }
    
    // Use JSZip to extract the 3MF file (which is a zip file)
    const zip = new JSZip();
    let contents;
    try {
      contents = await zip.loadAsync(data);
    } catch (zipError) {
      const msg = zipError && zipError.message ? zipError.message : String(zipError);
      if (/end of central directory|not a zip/i.test(msg)) {
        console.log('Invalid or truncated ZIP/3MF, skipping:', actualFilePath);
      } else {
        console.error('Error loading 3MF as ZIP:', zipError);
      }
      return [];
    }
    console.log('Zip contents loaded successfully');
    
    // Log all files in the 3MF
    console.log('\nContents of 3MF file:', actualFilePath);
    console.log('Number of files in archive:', Object.keys(contents.files).length);
    console.log('All files in archive:');
    Object.keys(contents.files).forEach(filename => {
      const file = contents.files[filename];
      console.log(' -', filename, file.dir ? '(directory)' : `(${file._data ? file._data.length : 0} bytes)`);
    });
    
    // Parse 3dmodel.model XML file to extract metadata
    try {
      const modelXmlPath = '3D/3dmodel.model';
      const altModelXmlPath = '/3D/3dmodel.model';
      
      // Try both path variations (with and without leading slash)
      let modelXmlFile = contents.files[modelXmlPath] || contents.files[altModelXmlPath];
      
      if (modelXmlFile && !modelXmlFile.dir) {
        console.log('Found 3dmodel.model file, parsing metadata...');
        const xmlContent = await modelXmlFile.async('string');
        const parsedMetadata = parse3MFModelXML(xmlContent);
        
        // Filter metadata based on user settings
        const filteredMetadata = filter3MFMetadataBySettings(parsedMetadata);
        
        // Update database if we found any metadata
        if (filteredMetadata.designer || filteredMetadata.parentModel || filteredMetadata.notes || filteredMetadata.license) {
          console.log('Parsed metadata from 3dmodel.model:', filteredMetadata);
          
          // Use original filePath for database lookup (not actualFilePath which might be a temp file)
          const dbFilePath = filePath;
          
          // Get the model from database to check existing values
          let existingModel = db.prepare('SELECT * FROM models WHERE filePath = ?').get(dbFilePath);
          
          // If model doesn't exist, create it (similar to add-multiple-thumbnails handler)
          if (!existingModel) {
            console.log('Model not found in database, creating entry with metadata...');
            const fileName = path.basename(dbFilePath);
            // Handle zip entry paths - extract just the entry name
            const finalFileName = dbFilePath.includes('::') 
              ? dbFilePath.split('::').pop() 
              : fileName;
            const dateAdded = new Date().toISOString();
            
            db.prepare(`
              INSERT INTO models (filePath, fileName, designer, parentModel, notes, license, dateAdded)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              dbFilePath,
              finalFileName,
              filteredMetadata.designer || null,
              filteredMetadata.parentModel || null,
              filteredMetadata.notes || null,
              filteredMetadata.license || null,
              dateAdded
            );
            
            console.log(`Created model entry for ${dbFilePath} with metadata`);
          } else {
            // Model exists - only update fields that are empty/null in the database
            const updates = {};
            const conditions = [];
            const values = [];
            
            if (filteredMetadata.designer && (!existingModel.designer || existingModel.designer.trim() === '')) {
              updates.designer = filteredMetadata.designer;
              values.push(filteredMetadata.designer);
              conditions.push('designer = ?');
            }
            
            if (filteredMetadata.parentModel && (!existingModel.parentModel || existingModel.parentModel.trim() === '')) {
              updates.parentModel = filteredMetadata.parentModel;
              values.push(filteredMetadata.parentModel);
              conditions.push('parentModel = ?');
            }
            
            if (filteredMetadata.notes && (!existingModel.notes || existingModel.notes.trim() === '')) {
              updates.notes = filteredMetadata.notes;
              values.push(filteredMetadata.notes);
              conditions.push('notes = ?');
            }
            
            if (filteredMetadata.license && (!existingModel.license || existingModel.license.trim() === '')) {
              updates.license = filteredMetadata.license;
              values.push(filteredMetadata.license);
              conditions.push('license = ?');
            }
            
            // Update database if we have any fields to update
            if (Object.keys(updates).length > 0) {
              values.push(dbFilePath);
              const updateStmt = db.prepare(`
                UPDATE models 
                SET ${conditions.join(', ')} 
                WHERE filePath = ?
              `);
              updateStmt.run(...values);
              console.log(`Updated model metadata for ${dbFilePath}:`, updates);
            } else {
              console.log('Model already has values for all metadata fields, skipping update');
            }
          }
        } else {
          console.log('No metadata found in 3dmodel.model file');
        }
      } else {
        console.log('3dmodel.model file not found in 3MF archive');
      }
    } catch (metadataError) {
      console.warn('Error parsing 3MF metadata (continuing with thumbnail extraction):', metadataError);
    }
    
    // Helper to check if file is an image and not a system file
    const isImage = (path) => {
      const normalized = path.replace(/\\/g, '/');
      // Skip Mac/System files
      if (normalized.includes('__MACOSX/') || normalized.split('/').pop().startsWith('._')) return false;
      return normalized.match(/\.(png|jpe?g|gif|webp)$/i);
    };

    // Helper to get proper MIME type from file extension
    const getMimeType = (path) => {
      const ext = path.split('.').pop().toLowerCase();
      const mimeMap = {
        'jpg': 'jpeg',
        'jpeg': 'jpeg',
        'png': 'png',
        'gif': 'gif',
        'webp': 'webp'
      };
      return mimeMap[ext] || 'png';
    };

    // Helper to calculate score for an image to determine priority
    const calculateScore = (path, size) => {
      let score = 0;
      const lowerPath = path.toLowerCase();
      const fileName = path.split('/').pop().toLowerCase();

      // 0. HIGHEST PRIORITY: Images in 3D/Textures/ or 3D/Texture/ directories (3MF standard location)
      if (lowerPath.includes('3d/textures/') || lowerPath.includes('3d/texture/')) {
        score += 200; // Very high priority for 3MF texture images
      }

      // 1. Plate images (high priority) - prefer images with "plate" in name
      if (fileName.includes('plate')) score += 150; // Prefer plate images like plate_1.jpg

      // 2. Camera photos (high priority) - specific patterns
      if (fileName.match(/^dsc/)) score += 100; // Nikon/Sony
      if (fileName.match(/^img/)) score += 100; // Canon/generic
      if (fileName.match(/^pxl/)) score += 100; // Pixel
      if (fileName.match(/^\d{8}_\d{6}/)) score += 100; // Android date format

      // 3. Metadata/Generated thumbnails (lower priority)
      if (lowerPath.includes('metadata')) score -= 50;
      if (fileName.includes('thumbnail')) score -= 20;
      if (fileName.includes('preview')) score -= 10;

      // 3. File size (preference for larger, likely higher res images)
      // Cap size bonus at 50 points (assuming size is in bytes)
      // Use 0 if size is undefined
      const safeSize = size || 0;
      score += Math.min(safeSize / 1024, 50);

      // 4. Prefer webp/jpg over png (often photos vs generated)
      if (fileName.endsWith('.webp') || fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) {
        score += 10;
      }

      return score;
    };

    // Scan all images in the archive
    console.log('\nScanning all images in 3MF archive...');
    const allImages = [];

    for (const [path, file] of Object.entries(contents.files)) {
      if (isImage(path) && !file.dir) {
        // Try to get uncompressed size if available, otherwise 0
        const size = (file._data && file._data.uncompressedSize) || 0;
        const score = calculateScore(path, size);
        console.log(`Found image: ${path} (Score: ${score})`);

        allImages.push({
          path,
          file,
          score
        });
      }
    }

    // Sort images by score descending
    allImages.sort((a, b) => b.score - a.score);

    // Extract top images
    const imageFiles = [];
    const maxImagesToExtract = 5; // Limit to top 5 to save memory

    for (const imgObj of allImages.slice(0, maxImagesToExtract)) {
      console.log(`Extracting: ${imgObj.path} (Score: ${imgObj.score})`);
      const imageData = await imgObj.file.async('base64');
      const mimeType = getMimeType(imgObj.path);
      imageFiles.push(`data:image/${mimeType};base64,${imageData}`);
    }
    
    console.log('\nExtracted total images:', imageFiles.length);
    if (imageFiles.length === 0) {
      console.log('No images found in 3MF file. Make sure images are in 3D/Textures/ or 3D/Texture/ directories.');
    }
    return imageFiles.length > 0 ? imageFiles : [];
  } catch (error) {
    console.error('Error reading 3MF images:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    return [];
  }
});

ipcMain.handle('get3MFSTL', async (event, filePath) => {
  if (isUrlModel(filePath)) return null;
  try {
    // Check if this is a zip entry
    const pathInfo = parseZipPath(filePath);
    let actualFilePath = filePath;
    let shouldCleanup = false;
    
    if (pathInfo.isZipEntry && isMacOsResourceForkEntry(pathInfo.entryPath)) {
      return null;
    }
    
    if (pathInfo.isZipEntry) {
      // Extract to temp file first
      try {
        actualFilePath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
        shouldCleanup = true;
      } catch (error) {
        console.error('Error extracting zip entry for 3MF STL:', error);
        return null;
      }
    }
    
    const data = await fs.promises.readFile(actualFilePath);
    if (!isLikelyValidZipBuffer(data)) {
      return null;
    }
    
    const zip = new JSZip();
    let contents;
    try {
      contents = await zip.loadAsync(data);
    } catch (zipError) {
      return null;
    }
    
    // Look for STL files in the 3MF
    for (const [entryPath, file] of Object.entries(contents.files)) {
      if (entryPath.endsWith('.stl')) {
        // Extract to temp directory
        const tempPath = path.join(os.tmpdir(), `temp_${Date.now()}.stl`);
        await fs.promises.writeFile(tempPath, await file.async('nodebuffer'));
        
        // Clean up intermediate temp file if needed
        if (shouldCleanup && actualFilePath !== filePath) {
          try {
            await fs.promises.unlink(actualFilePath);
          } catch (cleanupError) {
            console.error('Error cleaning up temp file:', cleanupError);
          }
        }
        
        return tempPath;
      }
    }
    
    // Clean up intermediate temp file if needed
    if (shouldCleanup && actualFilePath !== filePath) {
      try {
        await fs.promises.unlink(actualFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting STL from 3MF:', error);
    return null;
  }
});

// Read model file for preview (STL parsing in renderer)
const readModelFileHandler = async (event, filePath) => {
  if (isUrlModel(filePath)) throw new Error('URL-only model has no file to read');
  try {
    // Handle zip entries
    if (filePath.includes('::')) {
      const pathInfo = parseZipPath(filePath);
      const tempPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
      const data = await fs.promises.readFile(tempPath);
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    }

    const data = await fs.promises.readFile(filePath);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  } catch (error) {
    console.error(`Error reading model file ${filePath}:`, error);
    throw error;
  }
};
ipcMain.handle('read-model-file', readModelFileHandler);
// Register in handler registry for direct WebSocket invocation
ipcHandlerRegistry.set('read-model-file', readModelFileHandler);

// Parse 3MF preview handler
const parse3mfPreviewHandler = async (event, filePath, requestId) => {
  // Validate arguments - ensure filePath is a string, not an array
  if (Array.isArray(filePath)) {
    console.error('parse-3mf-preview: filePath is an array, extracting first element');
    filePath = filePath[0];
  }
  if (typeof filePath !== 'string') {
    throw new Error(`parse-3mf-preview: filePath must be a string, received ${typeof filePath}`);
  }
  if (isUrlModel(filePath)) throw new Error('URL-only model has no file to preview');
  
  const pathInfo = parseZipPath(filePath);
  let actualFilePath = filePath;
  let shouldCleanup = false;
  let fileStat = null;

  if (pathInfo.isZipEntry) {
    if (isMacOsResourceForkEntry(pathInfo.entryPath)) {
      throw new Error('macOS resource-fork entry is not a valid 3MF');
    }
    actualFilePath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
    shouldCleanup = true;
  }

  try {
    fileStat = await fs.promises.stat(actualFilePath);
  } catch (error) {
    console.error('Error statting 3MF preview file:', error);
  }

  const cacheKey = fileStat ? `${filePath}|${fileStat.size}|${fileStat.mtimeMs}` : null;
  const cacheDir = getPreview3mfCacheDir();
  const cacheHash = cacheKey ? crypto.createHash('sha256').update(cacheKey).digest('hex') : null;
  const cachePath = cacheHash ? path.join(cacheDir, `${cacheHash}.json`) : null;

  // In-memory cache
  if (cacheKey && preview3mfCache.has(cacheKey)) {
    const cached = preview3mfCache.get(cacheKey);
    preview3mfCache.delete(cacheKey);
    preview3mfCache.set(cacheKey, cached);
    if (shouldCleanup && actualFilePath !== filePath) {
      try { await fs.promises.unlink(actualFilePath); } catch {}
    }
    return cached;
  }

  // Disk cache
  if (cachePath) {
    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });
      const cachedJson = await fs.promises.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(cachedJson);
      preview3mfCache.set(cacheKey, parsed);
      if (preview3mfCache.size > PREVIEW_3MF_CACHE_LIMIT) {
        const oldestKey = preview3mfCache.keys().next().value;
        preview3mfCache.delete(oldestKey);
      }
      if (shouldCleanup && actualFilePath !== filePath) {
        try { await fs.promises.unlink(actualFilePath); } catch {}
      }
      return parsed;
    } catch (error) {
      console.error('Error reading 3MF preview cache:', error);
    }
  }

  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'preview-3mf-worker-node.js');
    const entry = acquirePreview3mfWorker(workerPath);
    const worker = entry.worker;

    const cleanup = async () => {
      preview3mfWorkers.delete(requestId);
      releasePreview3mfWorker(entry);
      if (shouldCleanup && actualFilePath !== filePath) {
        try { await fs.promises.unlink(actualFilePath); } catch {}
      }
    };

    preview3mfWorkers.set(requestId, { worker, entry, reject, cleanup });

    const onMessage = async (message) => {
      const { ok, json, error, type, message: statusMessage } = message || {};
      if (type === 'status') {
        // Use global.sendEvent for server mode compatibility
        if (isServerMode && global.broadcastEvent) {
          global.broadcastEvent('3mf-preview-status', requestId, statusMessage);
        } else if (event && event.sender) {
          event.sender.send('3mf-preview-status', requestId, statusMessage);
        }
        return;
      }

      worker.off('message', onMessage);
      await cleanup();
      if (!ok) {
        reject(new Error(error || 'Failed to parse 3MF'));
        return;
      }

      if (cacheKey) {
        preview3mfCache.set(cacheKey, json);
        if (preview3mfCache.size > PREVIEW_3MF_CACHE_LIMIT) {
          const oldestKey = preview3mfCache.keys().next().value;
          preview3mfCache.delete(oldestKey);
        }
        if (cachePath) {
          try {
            await fs.promises.mkdir(cacheDir, { recursive: true });
            await fs.promises.writeFile(cachePath, JSON.stringify(json));
          } catch (cacheError) {
            console.error('Error writing 3MF preview cache:', cacheError);
          }
        }
      }

      resolve(json);
    };

    const onError = async (error) => {
      worker.off('error', onError);
      await cleanup();
      removePreview3mfWorker(entry);
      reject(error);
    };

    worker.on('message', onMessage);
    worker.on('error', onError);

    worker.postMessage({ filePath: actualFilePath });
  });
};

ipcMain.handle('parse-3mf-preview', parse3mfPreviewHandler);
// Register in handler registry for direct WebSocket invocation
ipcHandlerRegistry.set('parse-3mf-preview', parse3mfPreviewHandler);

ipcMain.handle('cancel-3mf-preview', async (event, requestId) => {
  const entry = preview3mfWorkers.get(requestId);
  if (!entry) return;

  try {
    entry.worker.terminate();
  } catch (error) {
    console.error('Error terminating 3MF preview worker:', error);
  }

  removePreview3mfWorker(entry.entry);
  await entry.cleanup?.();
  entry.reject?.(new Error('Preview cancelled'));
});

// Handler to pull metadata from 3MF files
ipcMain.handle('pull-3mf-metadata', async (event, filePaths) => {
  try {
    const filePathsArray = Array.isArray(filePaths) ? filePaths : [filePaths];
    
    // Filter to only 3MF files
    const threeMFFiles = filePathsArray.filter(fp => {
      const ext = path.extname(fp).toLowerCase();
      // Handle zip entries - check the entry path extension
      if (fp.includes('::')) {
        const entryPath = fp.split('::')[1];
        return path.extname(entryPath).toLowerCase() === '.3mf';
      }
      return ext === '.3mf';
    });
    
    if (threeMFFiles.length === 0) {
      throw new Error('No 3MF files selected');
    }
    
    // Check existing models to see if any have data that will be overwritten
    const modelsWithData = [];
    for (const filePath of threeMFFiles) {
      const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
      if (model) {
        const hasData = (model.designer && model.designer.trim()) ||
                       (model.parentModel && model.parentModel.trim()) ||
                       (model.notes && model.notes.trim()) ||
                       (model.license && model.license.trim());
        if (hasData) {
          modelsWithData.push({
            filePath,
            fileName: model.fileName || path.basename(filePath),
            designer: model.designer,
            parentModel: model.parentModel,
            notes: model.notes,
            license: model.license
          });
        }
      }
    }
    
    // Show confirmation dialog if any models have existing data
    if (modelsWithData.length > 0) {
      const win = BrowserWindow.fromWebContents(event.sender);
      const message = modelsWithData.length === 1
        ? `This will overwrite existing metadata for:\n\n${modelsWithData[0].fileName}\n\nExisting data:\n${modelsWithData[0].designer ? `Designer: ${modelsWithData[0].designer}\n` : ''}${modelsWithData[0].parentModel ? `Parent Model: ${modelsWithData[0].parentModel}\n` : ''}${modelsWithData[0].notes ? `Notes: ${modelsWithData[0].notes.substring(0, 50)}${modelsWithData[0].notes.length > 50 ? '...' : ''}\n` : ''}${modelsWithData[0].license ? `License: ${modelsWithData[0].license}\n` : ''}\n\nContinue?`
        : `This will overwrite existing metadata for ${modelsWithData.length} model(s).\n\nContinue?`;
      
      const confirm = await dialog.showMessageBox(win, {
        type: 'warning',
        title: 'Confirm Metadata Overwrite',
        message: message,
        buttons: ['Yes', 'No'],
        defaultId: 1,
        cancelId: 1
      });
      
      if (confirm.response !== 0) {
        return { success: false, cancelled: true };
      }
    }
    
    // Process each file
    const results = [];
    let successCount = 0;
    let errorCount = 0;
    let noMetadataCount = 0;
    
    for (const filePath of threeMFFiles) {
      try {
        const metadata = await extract3MFMetadata(filePath);
        
        // Filter metadata based on user settings
        const filteredMetadata = filter3MFMetadataBySettings(metadata);
        
        if (filteredMetadata && (filteredMetadata.designer || filteredMetadata.parentModel || filteredMetadata.notes || filteredMetadata.license)) {
          // Get or create model in database
          let existingModel = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
          
          if (!existingModel) {
            // Create new model entry
            const fileName = path.basename(filePath);
            const finalFileName = filePath.includes('::') 
              ? filePath.split('::').pop() 
              : fileName;
            const dateAdded = new Date().toISOString();
            
            db.prepare(`
              INSERT INTO models (filePath, fileName, designer, parentModel, notes, license, dateAdded)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              filePath,
              finalFileName,
              filteredMetadata.designer || null,
              filteredMetadata.parentModel || null,
              filteredMetadata.notes || null,
              filteredMetadata.license || null,
              dateAdded
            );
            
            results.push({ filePath, success: true, action: 'created' });
            successCount++;
          } else {
            // Update existing model - overwrite all fields
            db.prepare(`
              UPDATE models 
              SET designer = ?, parentModel = ?, notes = ?, license = ?
              WHERE filePath = ?
            `).run(
              filteredMetadata.designer || null,
              filteredMetadata.parentModel || null,
              filteredMetadata.notes || null,
              filteredMetadata.license || null,
              filePath
            );
            
            results.push({ filePath, success: true, action: 'updated' });
            successCount++;
          }
        } else {
          results.push({ filePath, success: false, error: 'No metadata found in 3MF file' });
          noMetadataCount++;
        }
      } catch (error) {
        console.error(`Error processing ${filePath}:`, error);
        results.push({ filePath, success: false, error: error.message });
        errorCount++;
      }
    }
    
    // Refresh the grid
    event.sender.send('refresh-grid');
    
    return {
      success: true,
      processed: threeMFFiles.length,
      successCount,
      errorCount,
      noMetadataCount,
      results
    };
  } catch (error) {
    console.error('Error pulling 3MF metadata:', error);
    throw error;
  }
});

// Add handler to extract model from zip to temp file
ipcMain.handle('extract-model-from-zip', async (event, filePath) => {
  if (isUrlModel(filePath)) throw new Error('URL-only model has no file to extract');
  try {
    const pathInfo = parseZipPath(filePath);
    if (!pathInfo.isZipEntry) {
      // Not a zip entry, return original path
      return filePath;
    }
    
    return await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
  } catch (error) {
    console.error('Error extracting model from zip:', error);
    throw error;
  }
});

// Add handler to extract zip archive
ipcMain.handle('extract-zip-archive', async (event, filePath, destinationPath) => {
  try {
    const pathInfo = parseZipPath(filePath);
    if (!pathInfo.isZipEntry) {
      throw new Error('Not a zip entry');
    }
    
    const StreamZip = require('node-stream-zip');
    const zip = new StreamZip.async({ file: pathInfo.zipPath });
    
    // Extract the specific entry
    const entryData = await zip.entryData(pathInfo.entryPath);
    await zip.close();
    
    // Create destination path preserving directory structure
    const destPath = path.join(destinationPath, pathInfo.entryPath);
    const destDir = path.dirname(destPath);
    await fs.promises.mkdir(destDir, { recursive: true });
    await fs.promises.writeFile(destPath, entryData);
    
    return destPath;
  } catch (error) {
    console.error('Error extracting zip archive:', error);
    throw error;
  }
});

// Add a new IPC handler for getting duplicates
const getDuplicatesHandler = async (event, includeZip = false) => {
  const maxRetries = isServerMode && isGeneratingHashes ? 5 : 1;
  const retryDelayMs = 150;
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      // Get all models with their hashes - explicitly filter out NULL and empty strings
      const models = db.prepare(`
        SELECT filePath, fileName, hash, size 
        FROM models 
        WHERE hash IS NOT NULL 
          AND hash != '' 
          AND LENGTH(TRIM(hash)) > 0
      `).all();

      // Filter out zip entries if includeZip is false
      const filteredModels = includeZip
        ? models
        : models.filter(model => !model.filePath.includes('::'));

      // Group by hash to find duplicates - dedupe by filePath so each path appears once per group
      // (avoids double entries when DB has duplicate rows or in Server/Docker fallback path)
      const seenByHash = new Map();
      const duplicates = filteredModels.reduce((acc, model) => {
        if (!model.hash || model.hash.trim() === '') return acc;
        if (!acc[model.hash]) acc[model.hash] = [];
        const key = model.hash;
        const seen = seenByHash.get(key) || new Set();
        if (seen.has(model.filePath)) return acc;
        seen.add(model.filePath);
        seenByHash.set(key, seen);
        acc[model.hash].push(model);
        return acc;
      }, {});

      // Filter out unique files (groups with only one file)
      const duplicateGroups = Object.entries(duplicates)
        .filter(([hash, files]) => files.length > 1)
        .reduce((acc, [hash, files]) => {
          acc[hash] = files;
          return acc;
        }, {});

      console.log('Found duplicate groups:', Object.keys(duplicateGroups).length);
      return duplicateGroups;
    } catch (error) {
      lastError = error;
      console.error('Error getting duplicates (attempt ' + (attempt + 1) + '/' + maxRetries + '):', error);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, retryDelayMs));
      }
    }
  }
  throw lastError;
};
ipcMain.handle('get-duplicates', getDuplicatesHandler);
ipcHandlerRegistry.set('get-duplicates', getDuplicatesHandler);

// Internal function to calculate missing hashes
async function calculateMissingHashesInternal(event) {
  try {
    // Set hash generation state
    isGeneratingHashes = true;

    // Get all models with missing hashes OR SHA256 hashes (64 hex chars) that need to be regenerated as MD5 (32 hex chars)
    const modelsWithMissingHashes = db.prepare(`
      SELECT filePath, fileName, size 
      FROM models 
      WHERE hash IS NULL OR hash = '' OR LENGTH(hash) = 64
    `).all();

    console.log(`Found ${modelsWithMissingHashes.length} models with missing or SHA256 hashes (need MD5)`);

    if (modelsWithMissingHashes.length === 0) {
      isGeneratingHashes = false;
      return { calculated: 0, total: 0 };
    }

    console.log('Starting parallel hash calculation for', modelsWithMissingHashes.length, 'files');

    let processedCount = 0;
    let successCount = 0;
    let failedCount = 0;
    const updateHash = db.prepare('UPDATE models SET hash = ? WHERE filePath = ?');

    // Send initial progress update
    // In server mode, use broadcastEvent to send to all WebSocket clients
    // In normal mode, use event.sender.send
    if (isServerMode && global.broadcastEvent) {
      global.broadcastEvent('hash-generation-progress', {
        processed: 0,
        total: modelsWithMissingHashes.length,
        success: 0,
        failed: 0
      });
    } else if (event && event.sender) {
      event.sender.send('hash-generation-progress', {
        processed: 0,
        total: modelsWithMissingHashes.length,
        success: 0,
        failed: 0
      });
    }

    // Process files in parallel with concurrency limit
    // Lower concurrency in Docker/Server mode for network files to avoid overwhelming the file system
    const concurrencyLimit = isServerMode ? 20 : 50;
    
    // Helper function to calculate hash with retry and timeout
    const calculateFileHashWithRetry = async (filePath, maxRetries = 2) => {
      let lastError;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Add timeout for file operations (especially important for network files in Docker)
          const timeoutMs = isServerMode ? 300000 : 60000; // 5 min for server mode, 1 min for normal
          const hashPromise = calculateFileHash(filePath);
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error(`Hash calculation timeout after ${timeoutMs}ms`)), timeoutMs)
          );
          
          return await Promise.race([hashPromise, timeoutPromise]);
        } catch (error) {
          lastError = error;
          // Only retry on certain errors (network issues, timeouts, temporary file system errors)
          const isRetryableError = error.code === 'ETIMEDOUT' || 
                                   error.code === 'ENOENT' || 
                                   error.code === 'EACCES' ||
                                   error.message.includes('timeout') ||
                                   error.message.includes('ENOTFOUND');
          
          if (attempt < maxRetries && isRetryableError) {
            console.warn(`Retry ${attempt + 1}/${maxRetries} for ${filePath}: ${error.message}`);
            // Exponential backoff: 1s, 2s, 4s
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
            continue;
          }
          throw error;
        }
      }
      throw lastError;
    };

    const processFile = async (model) => {
      try {
        // Check if file exists (for regular files) or zip file exists (for zip entries)
        const pathInfo = parseZipPath(model.filePath);
        let fileExists = false;

        if (pathInfo.isZipEntry) {
          // For zip entries, check if the zip file exists
          fileExists = fs.existsSync(pathInfo.zipPath);
        } else {
          // For regular files, check if the file exists
          fileExists = fs.existsSync(model.filePath);
        }

        if (fileExists) {
          try {
            const hash = await calculateFileHashWithRetry(model.filePath);
            updateHash.run(hash, model.filePath);
            successCount++;
            console.log(`Hash calculated for: ${model.filePath} (${successCount} succeeded, ${failedCount} failed, ${processedCount + 1}/${modelsWithMissingHashes.length} total)`);
          } catch (hashError) {
            failedCount++;
            console.error(`Failed to calculate hash for ${model.filePath} after retries:`, hashError.message);
          }
        } else {
          console.warn(`File no longer exists: ${model.filePath}`);
          failedCount++;
        }
        
        processedCount++;
        
        // Send progress update after each file
        // In server mode, use broadcastEvent to send to all WebSocket clients
        // In normal mode, use event.sender.send
        if (isServerMode && global.broadcastEvent) {
          global.broadcastEvent('hash-generation-progress', {
            processed: processedCount,
            total: modelsWithMissingHashes.length,
            success: successCount,
            failed: failedCount
          });
        } else if (event && event.sender) {
          event.sender.send('hash-generation-progress', {
            processed: processedCount,
            total: modelsWithMissingHashes.length,
            success: successCount,
            failed: failedCount
          });
        }
      } catch (error) {
        console.error(`Unexpected error processing ${model.filePath}:`, error);
        failedCount++;
        processedCount++;
        
        // In server mode, use broadcastEvent to send to all WebSocket clients
        // In normal mode, use event.sender.send
        if (isServerMode && global.broadcastEvent) {
          global.broadcastEvent('hash-generation-progress', {
            processed: processedCount,
            total: modelsWithMissingHashes.length,
            success: successCount,
            failed: failedCount
          });
        } else if (event && event.sender) {
          event.sender.send('hash-generation-progress', {
            processed: processedCount,
            total: modelsWithMissingHashes.length,
            success: successCount,
            failed: failedCount
          });
        }
      }
    };

    // Process files in parallel batches
    for (let i = 0; i < modelsWithMissingHashes.length; i += concurrencyLimit) {
      const batch = modelsWithMissingHashes.slice(i, i + concurrencyLimit);
      await Promise.all(batch.map(processFile));
    }

    isGeneratingHashes = false;

    console.log(`Hash generation complete: ${successCount} succeeded, ${failedCount} failed out of ${modelsWithMissingHashes.length} total`);

    if (isServerMode && global.broadcastEvent) {
      global.broadcastEvent('hash-generation-complete', {
        success: successCount,
        failed: failedCount,
        total: modelsWithMissingHashes.length
      });
    } else if (event && event.sender) {
      event.sender.send('hash-generation-complete', {
        success: successCount,
        failed: failedCount,
        total: modelsWithMissingHashes.length
      });
    }

    return { 
      calculated: successCount, 
      failed: failedCount,
      total: modelsWithMissingHashes.length 
    };
  } catch (error) {
    isGeneratingHashes = false;
    console.error('Error calculating missing hashes:', error);
    throw error;
  }
}

// Add IPC handler to calculate missing hashes
ipcMain.handle('calculate-missing-hashes', async (event) => {
  return await calculateMissingHashesInternal(event);
});

// Add IPC handler for generateMissingHashes (calls the same internal function)
ipcMain.handle('generateMissingHashes', async (event) => {
  // Check if hash generation is already in progress
  if (isGeneratingHashes) {
    console.log('Hash generation already in progress, returning current status');
    // Return a status indicating it's already running
    // The caller should attach to existing progress events
    const modelsWithMissingHashes = db.prepare(`
      SELECT COUNT(*) as count 
      FROM models 
      WHERE hash IS NULL OR hash = '' OR LENGTH(hash) = 64
    `).get();
    return { 
      alreadyRunning: true, 
      total: modelsWithMissingHashes ? modelsWithMissingHashes.count : 0 
    };
  }
  return await calculateMissingHashesInternal(event);
});

// Add IPC handler to get count of models without hash
ipcMain.handle('getModelsWithoutHash', async () => {
  try {
    const result = db.prepare(`
      SELECT COUNT(*) as count 
      FROM models 
      WHERE hash IS NULL OR hash = '' OR LENGTH(hash) = 64
    `).get();
    return result ? result.count : 0;
  } catch (error) {
    console.error('Error getting models without hash:', error);
    return 0;
  }
});

// Add IPC handler to check if hash generation is in progress
ipcMain.handle('is-generating-hashes', async () => {
  return isGeneratingHashes;
});

// Add IPC handler to calculate and save hash for a single file
ipcMain.handle('calculate-file-hash', async (event, filePath) => {
  if (isUrlModel(filePath)) return '';
  try {
    const hash = await calculateFileHash(filePath);
    // Update the database with the calculated hash
    db.prepare('UPDATE models SET hash = ? WHERE filePath = ?').run(hash, filePath);
    return hash;
  } catch (error) {
    console.error(`Error calculating hash for ${filePath}:`, error);
    throw error;
  }
});

// Add this IPC handler for thumbnails
ipcMain.handle('getThumbnail', async (event, filePath) => {
  try {
    const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    if (!model || !model.thumbnail) return null;
    // Return the default (first) thumbnail
    return getDefaultThumbnail(model.thumbnail, 0);
  } catch (error) {
    console.error('Error getting thumbnail:', error);
    return null;
  }
});

// IPC handler to get all thumbnails for a model
ipcMain.handle('get-all-thumbnails', async (event, filePath) => {
  try {
    const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    if (!model || !model.thumbnail) return [];
    return parseThumbnails(model.thumbnail);
  } catch (error) {
    console.error('Error getting all thumbnails:', error);
    return [];
  }
});

// Helper function to add multiple thumbnails at once
function addMultipleThumbnails(thumbnailString, newThumbnails) {
  if (!newThumbnails || newThumbnails.length === 0) return thumbnailString;
  const thumbnails = parseThumbnails(thumbnailString);
  
  // Add all new thumbnails, avoiding duplicates by checking the full string
  for (const newThumbnail of newThumbnails) {
    if (newThumbnail && typeof newThumbnail === 'string' && newThumbnail.length > 0) {
      // Check if this exact thumbnail already exists
      const exists = thumbnails.some(t => t === newThumbnail);
      if (!exists) {
        thumbnails.push(newThumbnail);
      }
    }
  }
  return thumbnails.join('::');
}

// IPC handler to add a thumbnail to a model
ipcMain.handle('add-thumbnail', async (event, filePath, imageDataUrl) => {
  try {
    const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    const currentThumbnail = model?.thumbnail || null;
    const thumbnailsWithNew = addThumbnailToModel(currentThumbnail, imageDataUrl);
    
    // Parse thumbnails to get count and new index
    const thumbnails = parseThumbnails(thumbnailsWithNew);
    const newImageIndex = thumbnails.length - 1; // The new image is at the end
    
    // Make the new image the default (move it to the front)
    const updatedThumbnail = setDefaultThumbnailIndex(thumbnailsWithNew, newImageIndex);
    await saveThumbnail(filePath, updatedThumbnail);
    
    // Verify the save was successful
    const verifyModel = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    const finalThumbnails = parseThumbnails(verifyModel?.thumbnail || '');
    
    // Send message to renderer to refresh the grid with updated thumbnail
    // In server mode always broadcast so browser clients get the update (invoke may come via hidden window)
    if (isServerMode && global.broadcastEvent) {
      global.broadcastEvent('thumbnail-added', {
        filePath: filePath,
        thumbnailCount: finalThumbnails.length,
        hasMultiple: finalThumbnails.length > 1,
        newImageIsDefault: true
      });
    } else if (event && event.sender) {
      event.sender.send('thumbnail-added', {
        filePath: filePath,
        thumbnailCount: finalThumbnails.length,
        hasMultiple: finalThumbnails.length > 1,
        newImageIsDefault: true
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error adding thumbnail:', error);
    throw error;
  }
});

// IPC handler to add multiple thumbnails at once (for 3MF files)
ipcMain.handle('add-multiple-thumbnails', async (event, filePath, imageDataUrls) => {
  try {
    if (!imageDataUrls || !Array.isArray(imageDataUrls) || imageDataUrls.length === 0) {
      return false;
    }
    
    // Check if model exists in database
    let model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    if (!model) {
      // Model doesn't exist yet - create it with just the thumbnails
      // Extract fileName from filePath
      const path = require('path');
      const fileName = path.basename(filePath);
      // Create model entry
      const dateAdded = new Date().toISOString();
      db.prepare(`
        INSERT INTO models (filePath, fileName, thumbnail, dateAdded)
        VALUES (?, ?, ?, ?)
      `).run(filePath, fileName, '', dateAdded);
      // Re-fetch the model
      model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
      if (!model) {
        return false;
      }
    }
    
    const currentThumbnail = model?.thumbnail || null;
    
    // Filter out any null/undefined/empty images
    const validImages = imageDataUrls.filter(img => img && typeof img === 'string' && img.length > 0);
    
    if (validImages.length === 0) {
      return false;
    }
    
    const updatedThumbnail = addMultipleThumbnails(currentThumbnail, validImages);
    const finalCount = parseThumbnails(updatedThumbnail).length;
    
    // Save the thumbnail
    await saveThumbnail(filePath, updatedThumbnail);
    
    // Verify it was saved
    const verifyModel = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    if (!verifyModel) {
      return { success: false, error: 'Model not found after save' };
    }
    
    const verifyThumbnail = verifyModel.thumbnail;
    const verifyCount = verifyThumbnail ? parseThumbnails(verifyThumbnail).length : 0;
    
    if (verifyCount !== finalCount) {
      // Try to save again
      await saveThumbnail(filePath, updatedThumbnail);
    }
    
    // Return the updated thumbnail string so renderer can use it
    return {
      success: true,
      thumbnailCount: verifyCount,
      thumbnailString: verifyThumbnail || updatedThumbnail
    };
  } catch (error) {
    console.error('Error adding multiple thumbnails:', error);
    console.error('Error stack:', error.stack);
    throw error;
  }
});

// IPC handler to set the default thumbnail index
ipcMain.handle('set-default-thumbnail', async (event, filePath, index) => {
  try {
    const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    if (!model || !model.thumbnail) return false;
    const updatedThumbnail = setDefaultThumbnailIndex(model.thumbnail, index);
    await saveThumbnail(filePath, updatedThumbnail);
    return true;
  } catch (error) {
    console.error('Error setting default thumbnail:', error);
    throw error;
  }
});

// IPC handler to delete a thumbnail by index
ipcMain.handle('delete-thumbnail', async (event, filePath, index) => {
  try {
    const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    if (!model || !model.thumbnail) return false;
    
    const thumbnails = parseThumbnails(model.thumbnail).filter(t => t && t !== '3d.png' && t.length > 0 && t.startsWith('data:image'));
    
    // Ensure model has at least one thumbnail and index is valid
    if (thumbnails.length <= 1) {
      throw new Error('Cannot delete thumbnail: model must have at least one thumbnail');
    }
    
    if (index < 0 || index >= thumbnails.length) {
      throw new Error('Invalid thumbnail index');
    }
    
    // Cannot delete the active (first) thumbnail
    if (index === 0) {
      throw new Error('Cannot delete the active thumbnail');
    }
    
    // Remove the thumbnail at the specified index
    thumbnails.splice(index, 1);
    const updatedThumbnail = thumbnails.join('::');
    await saveThumbnail(filePath, updatedThumbnail);
    
    // Send refresh event
    if (event && event.sender) {
      event.sender.send('thumbnail-deleted', {
        filePath: filePath,
        thumbnailCount: thumbnails.length
      });
    } else if (isServerMode && global.broadcastEvent) {
      global.broadcastEvent('thumbnail-deleted', {
        filePath: filePath,
        thumbnailCount: thumbnails.length
      });
    }
    
    return true;
  } catch (error) {
    console.error('Error deleting thumbnail:', error);
    throw error;
  }
});

// Update the checkForUpdates function to track user's response
async function checkForUpdates(isBeta = false) {
  try {
    // First check if we've already shown update dialog this session
    const versionCheckPerformed = db.prepare('SELECT value FROM settings WHERE key = ?').get('versionCheckPerformedOnStartup');
    if (versionCheckPerformed && versionCheckPerformed.value === 'true') {
      console.log('Version check already performed this session, skipping');
      return null;
    }

    return new Promise((resolve, reject) => {
      const versionUrl = isBeta ? 
        'https://printventory.com/beta.version' : 
        'https://printventory.com/public.version';

      console.log('Main Process - Checking version URL:', versionUrl);

      https.get(versionUrl, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          const version = data.trim();
          console.log('Main Process - Version check response:', version);
          // Validate version format (e.g., "0.6.0")
          if (/^\d+\.\d+(\.\d+)?$/.test(version)) {
            console.log('Main Process - Valid version format received:', version);
            // Update the database with the latest version
            try {
              db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(version, 'latestVersion');
              db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(new Date().toISOString(), 'lastUpdateCheck');
              // Mark that we've performed the version check
              db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('true', 'versionCheckPerformedOnStartup');
              console.log('Database updated with latest version:', version);
            } catch (dbError) {
              console.error('Error updating version in database:', dbError);
            }
            resolve(version);
          } else {
            console.error('Invalid version format received:', version);
            reject(new Error('Invalid version format'));
          }
        });
      }).on('error', (err) => {
        console.error('Error checking for updates:', err);
        reject(err);
      });
    });
  } catch (error) {
    console.error('Error in checkForUpdates:', error);
    return null;
  }
}

// Update the IPC handler
ipcMain.handle('check-for-updates', async (event, isBeta) => {
  try {
    console.log('Main Process - Update check requested:', { isBeta });
    // Add timeout to the version check
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Version check timed out')), 5000);
    });
    
    const versionPromise = checkForUpdates(isBeta);
    const latestVersion = await Promise.race([versionPromise, timeoutPromise]);
    
    console.log('Main Process - Latest version found:', latestVersion);
    return latestVersion;
  } catch (error) {
    console.error('Error checking for updates:', error);
    // Return current version to prevent update dialog on failure
    const currentVersion = db.prepare('SELECT value FROM settings WHERE key = ?').get('currentVersion');
    return currentVersion?.value || null;
  }
});

ipcMain.handle('open-update-page', async (event, isBeta) => {
  const url = isBeta ? 
    'https://printventory.com/beta.html' : 
    'https://printventory.com/public.html';
  await shell.openExternal(url);
});

// Add new IPC handler for opening folder dialog
ipcMain.handle('open-folder-dialog', async (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(win, {
    title: title || 'Select Directory',
    properties: ['openDirectory']
  });
  return result;
});

// Add new IPC handler for moving multiple files
ipcMain.handle('move-files', async (event, filePaths, destinationFolder) => {
  try {
    for (const filePath of filePaths) {
      // Check if the file exists before moving
      if (!fs.existsSync(filePath)) {
        console.error(`File does not exist: ${filePath}`);
        throw new Error(`File does not exist: ${filePath}`);
      }

      const newDestination = path.join(destinationFolder, path.basename(filePath));
      console.log(`Moving file from ${filePath} to ${newDestination}`); // Log the move operation
      await fs.promises.rename(filePath, newDestination);
      db.prepare('UPDATE models SET filePath = ? WHERE filePath = ?').run(newDestination, filePath);
    }
    event.sender.send('refresh-grid');
    return true;
  } catch (error) {
    console.error("Error moving files:", error);
    throw error;
  }
});

// Add these IPC listeners near the end of your main.js file
ipcMain.on('open-dedup', (event) => {
  mainWindow.webContents.send('open-dedup');
});

ipcMain.on('open-tag-manager', (event) => {
  mainWindow.webContents.send('open-tag-manager');
});

ipcMain.on('open-metadata-editor', (event) => {
  mainWindow.webContents.send('open-metadata-editor');
});

ipcMain.on('start-print-roulette', (event) => {
  mainWindow.webContents.send('start-print-roulette');
});

// Add this new IPC handler at the end to open external URLs using the system's default browser
ipcMain.handle('open-external', async (event, url) => {
  try {
    await shell.openExternal(url);
    return true;
  } catch (error) {
    console.error('Error opening external URL:', error);
    throw error;
  }
});

ipcMain.handle('getTotalModelCount', async () => {
  try {
    // Query total count from the models table
    const row = db.prepare("SELECT COUNT(*) AS total FROM models").get();
    return row.total;
  } catch (error) {
    console.error("Error getting total model count:", error);
    return 0;
  }
});

// NEW: Add new IPC handler for opening a slicer dialog with proper filters based on platform
ipcMain.handle('open-slicer-dialog', async (event, title) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (process.platform === 'win32') {
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Select Slicer Executable',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile']
    });
    return result;
  } else if (process.platform === 'darwin') {
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Select Slicer Application',
      filters: [{ name: 'Applications', extensions: ['app'] }],
      properties: ['openFile'],
      treatPackagesAsDirectories: false
    });
    return result;
  } else {
    const result = await dialog.showOpenDialog(win, {
      title: title || 'Select Slicer Application',
      properties: ['openFile']
    });
    return result;
  }
});

// Add IPC handlers for AI Config
const testAIConfigHandler = async (event, apiKey, baseURL, model, service) => {
  const aitagging = require('./aitagging');
  // Normalize service to handle case/whitespace variations
  const normalizedService = service ? String(service).toLowerCase().trim() : 'openai';
  // If endpoint contains puter.com, treat as Puter service
  const isPuterService = normalizedService === 'puter' || 
    (baseURL && (baseURL.includes('puter.com') || baseURL.includes('js.puter.com')));
  
  console.log('[Main] test-ai-config handler:', { 
    service, 
    normalizedService, 
    baseURL, 
    isPuterService,
    hasEvent: !!event,
    isServerMode,
    apiKeyLength: apiKey ? apiKey.length : 0,
    model
  });
  
  // Create puter IPC handler if service is puter
  // Pass event so it can route to the correct client (WebSocket in server mode, IPC in normal mode)
  const puterIPCHandler = isPuterService ? createPuterIPCHandler(event) : null;
  console.log('[Main] Created puterIPCHandler:', { 
    isPuterService, 
    hasHandler: !!puterIPCHandler,
    handlerType: typeof puterIPCHandler
  });
  
  return await aitagging.testAIConfig(apiKey, baseURL, model, service, puterIPCHandler);
};

// Register handler for both IPC and WebSocket (server mode)
registerIpcHandler('test-ai-config', testAIConfigHandler);

ipcMain.handle('get-default-ai-prompt', async () => {
  const settings = getSettings();
  const aitagging = require('./aitagging');
  return aitagging.getDefaultPrompt({
    maxTags: settings.aiTagMaxTags,
    useCategories: settings.aiTagUseCategories,
    useJsonResponse: settings.aiTagUseJsonResponse,
    detailLevel: settings.aiTagDetailLevel
  });
});

// Helper function for puter.com AI calls (forwards to renderer)
let puterResponseListenerSet = false;
const puterPendingRequests = new Map(); // Maps requestId -> { resolve, reject, webContents, wsClient }

function createPuterIPCHandler(event = null) {
  console.log('[Puter IPC Handler] createPuterIPCHandler called, has event:', !!event, 'event keys:', event ? Object.keys(event) : []);
  
  // Set up a single listener for all puter responses (both IPC and WebSocket)
  if (!puterResponseListenerSet) {
    // Handle IPC responses (normal mode)
    ipcMain.on('puter-ai-chat-response', (event, requestId, result) => {
      const pending = puterPendingRequests.get(requestId);
      if (pending) {
        puterPendingRequests.delete(requestId);
        if (result.error) {
          pending.reject(new Error(result.error));
        } else {
          pending.resolve(result.response);
        }
      }
    });
    puterResponseListenerSet = true;
  }
  
  // Extract webContents and wsClient from event if available
  let webContents = null;
  let wsClient = null;
  
  if (event) {
    // In normal mode, event.sender is the webContents
    if (event.sender && event.sender.send) {
      webContents = event.sender;
      console.log('[Puter IPC Handler] Found webContents from event.sender');
    }
    // In server mode, event might have a wsClient property (set by WebSocket handler)
    if (event.wsClient) {
      wsClient = event.wsClient;
      console.log('[Puter IPC Handler] Found wsClient from event.wsClient');
    } else {
      console.log('[Puter IPC Handler] No wsClient found in event, isServerMode:', isServerMode);
    }
  } else {
    console.log('[Puter IPC Handler] No event provided');
  }
  
  console.log('[Puter IPC Handler] Extracted:', { hasWebContents: !!webContents, hasWsClient: !!wsClient, isServerMode });
  
  return async (prompt, imageUrl, model) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      // Store both webContents and wsClient for routing responses
      puterPendingRequests.set(requestId, { resolve, reject, webContents, wsClient });
      
      // In server mode with WebSocket client, send via WebSocket
      // This routes to the browser client where Puter.js is loaded and can show the captcha
      if (isServerMode && wsClient) {
        console.log('[Puter AI] Sending request to browser client via WebSocket (captcha will appear in browser window)');
        wsClient.send(JSON.stringify({
          type: 'event',
          channel: 'puter-ai-chat-request',
          args: [requestId, prompt, imageUrl, model]
        }));
      } else if (webContents) {
        // Normal mode: use the webContents from the event
        webContents.send('puter-ai-chat-request', requestId, prompt, imageUrl, model);
      } else if (mainWindow && !mainWindow.isDestroyed()) {
        // Fallback: use mainWindow (for backward compatibility)
        mainWindow.webContents.send('puter-ai-chat-request', requestId, prompt, imageUrl, model);
      } else {
        reject(new Error('No valid client available for Puter AI request'));
        return;
      }
      
      // Timeout after 60 seconds
      setTimeout(() => {
        if (puterPendingRequests.has(requestId)) {
          puterPendingRequests.delete(requestId);
          reject(new Error('Puter AI request timeout'));
        }
      }, 60000);
    });
  };
}

// IPC handler for puter.com AI calls (forwards to renderer)
ipcMain.handle('puter-ai-chat', async (event, prompt, imageUrl, model) => {
  // Pass event so it can route to the correct client (WebSocket in server mode, IPC in normal mode)
  const handler = createPuterIPCHandler(event);
  return await handler(prompt, imageUrl, model);
});

ipcMain.handle('generate-tags', async (event, filePath) => {
  try {
    const aitagging = require('./aitagging');
    const settings = getSettings();
    
    // Create puter IPC handler if service is puter
    // Pass event so it can route to the correct client (WebSocket in server mode, IPC in normal mode)
    const puterIPCHandler = settings.aiService === 'puter' ? createPuterIPCHandler(event) : null;
    
    // Initialize OpenAI with the API key
    aitagging.initializeOpenAI(settings.apiKey, settings.apiEndpoint, settings.aiService, puterIPCHandler);
    
    // Get the model from the database to access its thumbnail
    const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
    
    if (!model) {
      console.log(`Model not found in database: ${filePath}`);
      return [];
    }
    
    // Get the model tags from the database
    const modelTagRows = db.prepare(`
      SELECT t.name 
      FROM tags t
      JOIN model_tags mt ON mt.tag_id = t.id
      WHERE mt.model_id = ?
    `).all(model.id);
    
    const modelTags = modelTagRows.map(row => row.name);
    
    // Check if model already has the "AI Tagged" tag (unless retagging is allowed)
    if (!settings.aiTagAllowRetagging && modelTags.includes("AI Tagged")) {
      console.log(`Model ${filePath} already has AI Tagged tag, skipping generation`);
      return [];
    }
    
    // Prepare tag generation options (read aiTagPrompt from DB so we always have latest)
    const aiTagPromptValue = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagPrompt')?.value ?? null;
    const tagOptions = {
      maxTags: settings.aiTagMaxTags,
      useCategories: settings.aiTagUseCategories,
      useJsonResponse: settings.aiTagUseJsonResponse,
      detailLevel: settings.aiTagDetailLevel,
      customPrompt: (aiTagPromptValue != null && String(aiTagPromptValue).trim() !== '') ? String(aiTagPromptValue).trim() : null
    };

    if (!model.thumbnail) {
      // If no thumbnail exists, we need to generate one or use a default image
      console.log('No thumbnail found for model, using default image');
      try {
        const fs = require('fs').promises;
        const defaultImagePath = './logo.png'; // Use a default image that's guaranteed to be in PNG format
        const data = await fs.readFile(defaultImagePath, { encoding: 'base64' });
        const tags = await aitagging.generateTagsForImage(data, settings.aiModel, tagOptions, 2000, 5, filePath);
        return tags;
      } catch (error) {
        console.error(`Error generating tags with default image:`, error);
        // Re-throw rate limit errors so user is notified
        if (error.message && error.message.includes('Rate limit')) {
          throw error;
        }
        return []; // Return empty tags array instead of throwing
      }
    }
    
    // Extract the base64 data from the thumbnail data URL
    // The thumbnail is stored as a data URL like: data:image/png;base64,BASE64_DATA
    const base64Data = model.thumbnail.split(',')[1];
    
    if (!base64Data) {
      console.error('Invalid thumbnail format');
      return []; // Return empty tags instead of throwing
    }
    
    try {
      // Generate tags using the thumbnail image which is already in PNG format
      const tags = await aitagging.generateTagsForImage(base64Data, settings.aiModel, tagOptions, 2000, 5, filePath);
      return tags;
    } catch (error) {
      console.error('Error generating tags:', error);
      // Re-throw rate limit errors so user is notified
      if (error.message && error.message.includes('Rate limit')) {
        throw error;
      }
      return []; // Return empty tags array instead of throwing
    }
  } catch (error) {
    console.error('Error generating tags:', error);
    throw error;
  }
});

// Add this helper function (if it doesn't already exist) near the top of main.js
function getSettings() {
  const apiKeyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('apiKey');
  const apiEndpointRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('apiEndpoint');
  const aiModelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiModel');
  const aiServiceRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiService');
  const aiTagMaxTagsRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagMaxTags');
  const aiTagUseCategoriesRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagUseCategories');
  const aiTagMergeStrategyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagMergeStrategy');
  const aiTagAllowRetaggingRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagAllowRetagging');
  const aiTagConcurrencyRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagConcurrency');
  const aiTagDetailLevelRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagDetailLevel');
  const aiTagPromptRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('aiTagPrompt');
  
  return {
    apiKey: apiKeyRow ? apiKeyRow.value : null,
    apiEndpoint: apiEndpointRow ? apiEndpointRow.value : 'https://js.puter.com/v2/',
    aiModel: aiModelRow ? aiModelRow.value : 'gpt-5-nano',
    aiService: aiServiceRow ? aiServiceRow.value : 'puter',
    aiTagMaxTags: aiTagMaxTagsRow ? parseInt(aiTagMaxTagsRow.value) || 10 : 10,
    aiTagUseCategories: aiTagUseCategoriesRow ? aiTagUseCategoriesRow.value === '1' : false,
    aiTagUseJsonResponse: true, // Always use JSON response format
    aiTagMergeStrategy: aiTagMergeStrategyRow ? aiTagMergeStrategyRow.value : 'merge',
    aiTagAllowRetagging: aiTagAllowRetaggingRow ? aiTagAllowRetaggingRow.value === '1' : false,
    aiTagConcurrency: aiTagConcurrencyRow ? parseInt(aiTagConcurrencyRow.value) || 3 : 3,
    aiTagDetailLevel: aiTagDetailLevelRow ? aiTagDetailLevelRow.value : 'medium',
    aiTagPrompt: aiTagPromptRow ? aiTagPromptRow.value : null
  };
}

// Add or update this function to get models without thumbnails
ipcMain.handle('get-models-without-thumbnails', async () => {
  try {
    const modelsWithoutThumbnails = db.prepare(`
      SELECT filePath FROM models WHERE thumbnail IS NULL OR thumbnail = '' OR thumbnail = '3d.png'
    `).all();
    return modelsWithoutThumbnails;
  } catch (error) {
    console.error('Error fetching models without thumbnails:', error);
    return [];
  }
});

ipcMain.handle('get-models-with-default-thumbnails', async () => {
  try {
    const modelsWithDefaultThumbnails = db.prepare(`
      SELECT filePath FROM models WHERE thumbnail IS NULL OR thumbnail = '' OR thumbnail = '3d.png'
    `).all();
    return modelsWithDefaultThumbnails;
  } catch (error) {
    console.error('Error fetching models with default thumbnails:', error);
    return [];
  }
});

// Add this new IPC handler to fetch models by directory
ipcMain.handle('get-models-by-directory', async (event, directoryPath) => {
  try {
    const selectCols = "id, filePath, fileName, designer, source, notes, printed, parentModel, hash, size, license, modifiedDate, dateAdded, CASE WHEN thumbnail IS NOT NULL AND thumbnail != '' AND thumbnail != '3d.png' THEN 1 ELSE 0 END AS hasThumbnail";
    const models = db.prepare(`SELECT ${selectCols} FROM models WHERE filePath LIKE ?`).all(`${directoryPath}%`);
    return models;
  } catch (error) {
    console.error('Error fetching models by directory:', error);
    throw error;
  }
});

// Example: Get models for a given page (limit and offset)
ipcMain.handle('get-models-page', async (event, { page, pageSize, sortOption }) => {
  try {
    const offset = (page - 1) * pageSize;
    const selectCols = "id, filePath, fileName, designer, source, notes, printed, parentModel, hash, size, license, modifiedDate, dateAdded, CASE WHEN thumbnail IS NOT NULL AND thumbnail != '' AND thumbnail != '3d.png' THEN 1 ELSE 0 END AS hasThumbnail";
    const models = db.prepare(
      `SELECT ${selectCols} FROM models ORDER BY ${sortOption} LIMIT ? OFFSET ?`
    ).all(pageSize, offset);
    return models;
  } catch (error) {
    console.error('Error fetching models page:', error);
    return [];
  }
});

// Add this new IPC handler
ipcMain.handle('fetch-makerworld-page', async (event, url) => {
  try {
    if (!fetch) {
      throw new Error('Fetch not initialized');
    }
    const response = await fetch(url);
    const html = await response.text();
    
    // Extract model name from the page title
    const titleMatch = html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
                      html.match(/<title>([^<]+)</i);
    let modelName = '';
    if (titleMatch && titleMatch[1]) {
      modelName = titleMatch[1].split('|')[0].trim();
    }
    
    // Extract designer name using multiple possible patterns
    const designerPatterns = [
      /class="author-name"[^>]*>([^<]+)</i,
      /data-username="([^"]+)"/i,
      /profileId-[0-9]+">([^<]+)</i
    ];
    
    let designer = 'Unknown';
    for (const pattern of designerPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        designer = match[1].trim();
        break;
      }
    }

    return {
      modelName,
      designer
    };
  } catch (error) {
    console.error('Error fetching MakerWorld page:', error);
    throw error;
  }
});

// Add this function to create the viewer window
function createViewerWindow(filePath) {
  const viewerWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  viewerWindow.loadFile('viewer.html');
  
  viewerWindow.webContents.on('did-finish-load', () => {
    viewerWindow.webContents.send('load-model', filePath);
  });
}

// Add this IPC handler
ipcMain.handle('open-model-viewer', async (event, filePath) => {
  createViewerWindow(filePath);
});

// Add this near the top after other imports
let fetch;
(async () => {
  fetch = (await import('node-fetch')).default;
})();

// Add these new IPC handlers
ipcMain.handle('get-slicers', () => {
  try {
    // Ensure the slicers table exists before querying it
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='slicers'`).get();
    if (!tableExists) {
      ensureSlicersTableExists();
      return [];
    }
    return db.prepare('SELECT * FROM slicers').all();
  } catch (error) {
    console.error('Error getting slicers:', error);
    return [];
  }
});

ipcMain.handle('save-slicer', (event, { name, path }) => {
  try {
    // Ensure the slicers table exists before inserting
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='slicers'`).get();
    if (!tableExists) {
      ensureSlicersTableExists();
    }
    db.prepare('INSERT OR REPLACE INTO slicers (name, path) VALUES (?, ?)').run(name, path);
    return true;
  } catch (error) {
    console.error('Error saving slicer:', error);
    throw error;
  }
});

ipcMain.handle('delete-slicer', (event, id) => {
  try {
    // Ensure the slicers table exists before deleting
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='slicers'`).get();
    if (!tableExists) {
      ensureSlicersTableExists();
      return true; // Nothing to delete if table didn't exist
    }
    db.prepare('DELETE FROM slicers WHERE id = ?').run(id);
    return true;
  } catch (error) {
    console.error('Error deleting slicer:', error);
    throw error;
  }
});

const clearAndSaveSlicersHandler = async (event, slicers) => {
  try {
    // Ensure slicers is an array (WebSocket might wrap it in an array)
    let slicersArray = slicers;
    if (!Array.isArray(slicersArray)) {
      // If it's not an array, try to extract it
      if (Array.isArray(slicersArray) === false && slicersArray && typeof slicersArray === 'object') {
        // Might be wrapped: [slicers] -> slicers
        slicersArray = Array.isArray(slicersArray) ? slicersArray : [slicersArray];
      } else if (Array.isArray(slicersArray) && slicersArray.length === 1 && Array.isArray(slicersArray[0])) {
        // Unwrap if double-wrapped: [[slicers]] -> [slicers]
        slicersArray = slicersArray[0];
      } else {
        // Last resort: convert to array
        slicersArray = [slicersArray];
      }
    }
    
    // Validate that we have an array
    if (!Array.isArray(slicersArray)) {
      throw new Error('slicers parameter must be an array');
    }
    
    // Ensure the slicers table exists before clearing and saving
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='slicers'`).get();
    if (!tableExists) {
      ensureSlicersTableExists();
    }
    
    // Use a transaction to ensure atomicity
    db.transaction(() => {
      // Drop all existing entries
      db.prepare('DELETE FROM slicers').run();
      
      // Insert new entries
      const insert = db.prepare('INSERT INTO slicers (name, path) VALUES (?, ?)');
      slicersArray.forEach(slicer => {
        // Validate slicer object
        if (slicer && typeof slicer === 'object' && slicer.name && slicer.path) {
          insert.run(slicer.name, slicer.path);
        } else {
          console.warn('Invalid slicer object skipped:', slicer);
        }
      });
    })();
    
    return true;
  } catch (error) {
    console.error('Error clearing and saving slicers:', error);
    console.error('slicers parameter type:', typeof slicers, 'isArray:', Array.isArray(slicers), 'value:', slicers);
    throw error;
  }
};

ipcMain.handle('clear-and-save-slicers', clearAndSaveSlicersHandler);
// Register in handler registry for WebSocket/Server mode
ipcHandlerRegistry.set('clear-and-save-slicers', clearAndSaveSlicersHandler);

ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats;
  } catch (error) {
    console.error(`Error getting file stats for ${filePath}:`, error);
    throw error;
  }
});

// IPC handler for executing commands on client machine (for server mode Electron clients)
// Note: In server mode, browser clients receive this as an event and handle it in renderer.js
const executeClientCommandHandler = async (event, commandData) => {
  try {
    if (!commandData || !commandData.type) {
      throw new Error('Invalid command data');
    }

    const { type, filePath, slicerName, slicerPath, isZipEntry, zipPath, entryPath } = commandData;

    if (type === 'open-file') {
      // Open file with system default application
      if (isZipEntry && zipPath && entryPath) {
        // For zip entries, open the zip file
        await shell.openPath(zipPath);
      } else {
        await shell.openPath(filePath);
      }
      return { success: true };
    } else if (type === 'open-in-slicer') {
      // Execute slicer command on client machine
      const { exec } = require('child_process');
      let modelPath = filePath;
      
      // Handle zip entries - would need extraction, but for now just use zip path
      if (isZipEntry && zipPath && entryPath) {
        // For zip entries, we can't easily pass the entry to the slicer
        // Show a message instead
        const win = getWindowFromEvent(event);
        if (win && !win.isDestroyed()) {
          dialog.showMessageBox(win, {
            type: 'info',
            title: 'ZIP Entry',
            message: 'Cannot open ZIP entry directly in slicer',
            detail: `To open ${entryPath} from ${zipPath}:\n\n` +
              `1. Extract ${entryPath} from the ZIP file\n` +
              `2. Open the extracted file in ${slicerName}`
          });
        }
        return { success: false, message: 'ZIP entries require extraction first' };
      }
      
      // Construct command based on platform
      let command;
      if (process.platform === 'darwin' && slicerPath.toLowerCase().endsWith('.app')) {
        command = `open -a "${slicerPath}" --args "${modelPath}"`;
      } else {
        command = `"${slicerPath}" "${modelPath}"`;
      }
      
      return new Promise((resolve) => {
        exec(command, (error, stdout, stderr) => {
          if (error) {
            console.error('Error executing slicer command on client:', error);
            resolve({ success: false, error: error.message });
          } else {
            console.log('Successfully executed slicer command on client');
            resolve({ success: true });
          }
        });
      });
    }
    
    return { success: false, error: 'Unknown command type' };
  } catch (error) {
    console.error('Error executing client command:', error);
    throw error;
  }
};

ipcMain.handle('execute-client-command', executeClientCommandHandler);
// Register in handler registry for WebSocket/Server mode (though it should be sent as event, not IPC call)
ipcHandlerRegistry.set('execute-client-command', executeClientCommandHandler);

ipcMain.handle('get-all-model-references', async () => {
  try {
    // Use the global db variable directly instead of calling getDb()
    const modelRefs = db.prepare('SELECT id, filePath FROM models').all();
    return modelRefs;
  } catch (error) {
    console.error('Error getting model references:', error);
    return []; // Return an empty array on error
  }
});

ipcMain.handle('get-db', async () => {
  try {
    const result = await getDb(); // Call your actual getDb function
    return result;
  } catch (error) {
    console.error("Error in get-db handler:", error);
    throw error; // Re-throw the error so the renderer can catch it
  }
});

// Remove or update the getDb function that tries to return a string
function getDb() {
    // Ensure that you return the actual database instance
    if (!db) {
        console.error("Database is not initialized.");
        throw new Error("Database is not initialized.");
    }
    return db; // Return the initialized database instance
}

// Add this function to track application usage
async function trackAppUsage() {
  try {
    // Get the persistent client ID
    const clientId = getClientId();
    
    // Check if usage collection is enabled
    const collectUsage = db.prepare('SELECT value FROM settings WHERE key = ?').get('CollectUsage');
    
    // Only track if CollectUsage is enabled (set to '1')
    if (collectUsage && collectUsage.value === '1') {
      console.log('Usage tracking enabled, sending analytics data');
      
      // Get model count (library size) from database for custom dimension
      let modelCount = 0;
      try {
        const row = db.prepare("SELECT COUNT(*) AS total FROM models").get();
        modelCount = row ? row.total : 0;
      } catch (error) {
        console.error('Error getting model count for startup tracking:', error);
        // Continue with modelCount = 0 if query fails
      }
      
      // Get OS platform
      const osPlatform = process.platform;
      
      // Log the custom dimension values being sent on startup
      console.log('Startup tracking - Custom dimensions:');
      console.log(`  - OS Platform (os_platform): ${osPlatform}`);
      console.log(`  - Printventory Version (app_version): ${version}`);
      console.log(`  - Model Count (model_count): ${modelCount}`);
      
      // Track application start event
      await analytics.event(clientId, 'Application', 'Start', {
        evLabel: `Version ${version}`,
        evValue: 1
      });
      
      // Track active user
      await analytics.trackActiveUser(clientId);
      
      // Send a custom app_open event with explicit custom dimension parameters
      // These match the custom dimensions: App Version, Model Count, OS Platform
      // Using 'app_open' as the event name (GA4 standard event for app launches)
      await analytics.sendGA4Event(clientId, 'app_open', {
        app_name: 'Printventory',
        app_version: version,        // Custom dimension: App Version (User-scoped)
        os_platform: osPlatform,     // Custom dimension: OS Platform (User-scoped)
        model_count: modelCount,     // Custom dimension: Model Count (User-scoped)
        // Add engagement time for better real-time tracking
        engagement_time_msec: 1000
      });
      
      // Set up a periodic ping to keep the user active in real-time analytics
      // Send pings more frequently for better real-time tracking
      setInterval(() => {
        analytics.trackActiveUser(clientId);
      }, 60000); // Send a ping every 60 seconds
    } else {
      console.log('Usage tracking disabled, skipping analytics');
    }
  } catch (error) {
    console.error('Error tracking app usage:', error);
    // Don't throw the error - we don't want to disrupt the app if analytics fails
  }
}

// Add this IPC handler for tracking events from the renderer process
ipcMain.handle('track-event', async (event, category, action, label, value) => {
  try {
    // Get the persistent client ID
    const clientId = getClientId();
    
    // Track the event using the updated analytics implementation
    await analytics.event(clientId, category, action, {
      evLabel: label,
      evValue: value,
      app_version: version,
      os_platform: process.platform
    });
    
    return true;
  } catch (error) {
    console.error('Error tracking event:', error);
    return false;
  }
});

// Add this function after the saveModel function
async function saveModelBatch(modelDataBatch) {
  try {
    if (!db) {
      console.error('Database not initialized');
      return false;
    }

    // Begin a transaction for better performance
    const transaction = db.transaction(() => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO models 
        (filePath, fileName, hash, size, modifiedDate, dateAdded) 
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      
      for (const modelData of modelDataBatch) {
        const dateAdded = new Date().toISOString();
        stmt.run(
          modelData.filePath,
          modelData.fileName,
          modelData.hash || '',
          modelData.size || 0,
          modelData.modifiedDate || dateAdded,
          dateAdded
        );
      }
    });
    
    transaction();
    scheduleBackgroundHashGeneration('save-model-batch');
    return true;
  } catch (error) {
    console.error('Error saving model batch:', error);
    return false;
  }
}

// Bulk update function for updating multiple models in a single transaction
async function updateModelsBatch(modelDataBatch) {
  try {
    if (!db) {
      console.error('Database not initialized');
      return false;
    }

    // Enable foreign key constraints
    db.pragma('foreign_keys = ON');

    // Use a transaction for better performance - update models and tags together
    const transaction = db.transaction(() => {
      const getModelIdStmt = db.prepare('SELECT id FROM models WHERE filePath = ?');
      const getExistingModelStmt = db.prepare('SELECT * FROM models WHERE filePath = ?');
      const updateStmt = db.prepare(`
        UPDATE models SET 
          fileName = ?,
          designer = ?,
          source = ?,
          notes = ?,
          printed = ?,
          parentModel = ?,
          license = ?
        WHERE filePath = ?
      `);

      const deleteTagsStmt = db.prepare('DELETE FROM model_tags WHERE model_id = ?');
      const getTagIdStmt = db.prepare('SELECT id FROM tags WHERE name = ?');
      const insertTagStmt = db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)');
      const insertTagNameStmt = db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)');
      const getTagIdAfterInsertStmt = db.prepare('SELECT id FROM tags WHERE name = ?');

      for (let i = 0; i < modelDataBatch.length; i++) {
        const modelData = modelDataBatch[i];
        const {
          filePath,
          fileName,
          designer,
          source,
          notes,
          printed,
          parentModel,
          license,
          tags
        } = modelData;

        console.log(`[Batch ${i}] Processing model: ${filePath}`);
        console.log(`[Batch ${i}] Field values:`, { fileName, designer, source, notes, printed, parentModel, license, tags });

        // Get existing model to preserve values that aren't being updated
        const existingModel = getExistingModelStmt.get(filePath);
        
        if (!existingModel) {
          console.warn(`[Batch ${i}] Model not found in database: ${filePath}`);
          continue; // Skip this model if it doesn't exist
        }
        
        console.log(`[Batch ${i}] Found existing model with ID: ${existingModel.id}`);
        // Only update fields that are explicitly provided (not undefined)
        const finalFileName = fileName !== undefined ? fileName : existingModel.fileName;
        const finalDesigner = designer !== undefined ? (designer || null) : existingModel.designer;
        const finalSource = source !== undefined ? (source || null) : existingModel.source;
        const finalNotes = notes !== undefined ? (notes || null) : existingModel.notes;
        const finalPrinted = printed !== undefined ? (printed ? 1 : 0) : existingModel.printed;
        const finalParentModel = parentModel !== undefined ? (parentModel || null) : existingModel.parentModel;
        const finalLicense = license !== undefined ? (license || null) : existingModel.license;

        // Update model fields
        console.log(`[Batch ${i}] Updating model with values:`, {
          finalFileName,
          finalDesigner,
          finalSource,
          finalNotes,
          finalPrinted,
          finalParentModel,
          finalLicense,
          filePath
        });
        const updateResult = updateStmt.run(
          finalFileName,
          finalDesigner,
          finalSource,
          finalNotes,
          finalPrinted,
          finalParentModel,
          finalLicense,
          filePath
        );
        console.log(`[Batch ${i}] Update result:`, updateResult);

        // Handle tags if provided
        if (tags && Array.isArray(tags) && tags.length > 0) {
          const modelId = existingModel.id;
          
          // Delete existing tags
          deleteTagsStmt.run(modelId);
          
          // Insert new tags
          for (const tagName of tags) {
            if (!tagName || typeof tagName !== 'string' || tagName.trim() === '') continue;
            
            const trimmedTagName = tagName.trim();
            
            // Get or create tag
            let tagResult = getTagIdStmt.get(trimmedTagName);
            if (!tagResult) {
              // Tag doesn't exist, create it
              insertTagNameStmt.run(trimmedTagName);
              tagResult = getTagIdAfterInsertStmt.get(trimmedTagName);
            }
            
            if (tagResult) {
              insertTagStmt.run(modelId, tagResult.id);
            }
          }
        }
      }
    });

    transaction();

    return true;
  } catch (error) {
    console.error('Error updating models batch:', error);
    return false;
  }
}

// Add this function before the IPC handlers
async function saveModel(modelData) {
  try {
    console.log('saveModel called with data:', JSON.stringify(modelData, null, 2));
    
    let {
      id: inputId, // Rename to avoid confusion
      filePath: filePathIn,
      fileName,
      designer,
      source,
      notes,
      printed,
      parentModel,
      license,
      tags: rawTags
    } = modelData;

    // Extension path mapping (Docker: client path -> container path) and optional copy to NAS
    let resolvedFilePath = filePathIn;
    const clientPrefixRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('extensionClientPathPrefix');
    const containerPrefixRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('extensionContainerPathPrefix');
    const copyToNasRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('extensionCopyToNasPath');
    const clientPrefix = (clientPrefixRow && clientPrefixRow.value) ? String(clientPrefixRow.value).replace(/\\/g, '/').trim().replace(/\/+$/, '') : '';
    const containerPrefix = (containerPrefixRow && containerPrefixRow.value) ? String(containerPrefixRow.value).replace(/\\/g, '/').trim().replace(/\/+$/, '') : '';
    const copyToNasPath = (copyToNasRow && copyToNasRow.value) ? String(copyToNasRow.value).replace(/\\/g, '/').trim().replace(/\/+$/, '') : '';
    if (clientPrefix && containerPrefix && filePathIn && typeof filePathIn === 'string') {
      const normalizedInput = filePathIn.replace(/\\/g, '/').trim();
      const prefixNorm = clientPrefix.toLowerCase();
      const inputNorm = normalizedInput.toLowerCase();
      if (inputNorm.startsWith(prefixNorm)) {
        const rest = normalizedInput.slice(clientPrefix.length).replace(/^\//, '');
        resolvedFilePath = containerPrefix + (rest ? '/' + rest : '');
      }
    }
    const zipSepForCopy = resolvedFilePath ? resolvedFilePath.indexOf('::') : -1;
    const srcFileForCopy = (resolvedFilePath && zipSepForCopy >= 0) ? resolvedFilePath.slice(0, zipSepForCopy) : resolvedFilePath;
    if (copyToNasPath && srcFileForCopy && fs.existsSync(srcFileForCopy)) {
      const base = path.basename(srcFileForCopy);
      const destFile = path.join(copyToNasPath, base);
      if (!fs.existsSync(path.dirname(destFile))) fs.mkdirSync(path.dirname(destFile), { recursive: true });
      if (path.resolve(srcFileForCopy) !== path.resolve(destFile)) {
        fs.copyFileSync(srcFileForCopy, destFile);
        resolvedFilePath = (zipSepForCopy >= 0) ? destFile + resolvedFilePath.slice(zipSepForCopy) : destFile;
      }
    } else if (copyToNasPath && resolvedFilePath) {
      const srcFile = (zipSepForCopy >= 0) ? resolvedFilePath.slice(0, zipSepForCopy) : resolvedFilePath;
      if (srcFile && !fs.existsSync(srcFile)) {
        console.warn('saveModel: extension path mapping resolved path not found on server:', srcFile);
      }
    }
    const filePath = resolvedFilePath;

    // Standalone .zip: only add if "Include zipped models" is enabled; add each STL/3MF inside (like scan)
    if (filePath && filePath.toLowerCase().endsWith('.zip') && !filePath.includes('::')) {
      const zipSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('enableZipArchives');
      const enableZipArchives = zipSetting && zipSetting.value === '1';
      if (!enableZipArchives) {
        throw new Error('ZIP archives are disabled. Enable "Include zipped models" in Settings to add .zip files.');
      }
      // List STL/3MF entries and save each as zipPath::entryPath (same as scan)
      const StreamZip = require('node-stream-zip');
      if (!fs.existsSync(filePath)) {
        throw new Error(`ZIP file not found: ${filePath}`);
      }
      const zip = new StreamZip.async({ file: filePath });
      const entries = await zip.entries();
      await zip.close();
      const modelExts = getSupportedExtensionsForLibrary(db);
      const toAdd = Object.values(entries).filter(
        (e) => !e.isDirectory && modelExts.includes(path.extname(e.name).toLowerCase())
      );
      if (toAdd.length === 0) {
        throw new Error('No supported model files found in the ZIP file. Enable additional file types in Settings > File Type if needed.');
      }
      const baseMeta = {
        designer,
        source,
        notes,
        printed,
        parentModel,
        license,
        tags: rawTags
      };
      for (const entry of toAdd) {
        const entryPath = `${filePath}::${entry.name}`;
        const entryFileName = path.basename(entry.name);
        await saveModel({
          ...baseMeta,
          filePath: entryPath,
          fileName: entryFileName
        });
      }
      return { success: true, expanded: true, count: toAdd.length };
    }

    // Ensure tags is always an array, even if a single string was passed
    const tags = rawTags ? (Array.isArray(rawTags) ? rawTags : [rawTags]) : [];

    console.log(`Processing notes field: "${notes}"`);

    // Verify database integrity before proceeding
    try {
      verifyDatabaseIntegrity();
    } catch (verifyError) {
      console.error('Error verifying database integrity:', verifyError);
      // Continue with the save even if verification fails
    }

    // Enable foreign key constraints
    db.pragma('foreign_keys = ON');

    // First, handle the model data without tags
    let modelId;
    let insertedNewModel = false;
    try {
      // Check if the model exists first
      const existingModel = db.prepare('SELECT id FROM models WHERE filePath = ?').get(filePath);
      
      if (existingModel) {
        // Update existing model
        console.log(`Updating existing model with ID: ${existingModel.id}`);
        
        // Get existing model data to preserve values that aren't being updated
        const existingModelData = db.prepare('SELECT * FROM models WHERE id = ?').get(existingModel.id);
        
        // Only update fields that are explicitly provided (not undefined)
        // Preserve existing values for fields that are undefined in the update
        const finalFileName = fileName !== undefined ? fileName : existingModelData.fileName;
        const finalDesigner = designer !== undefined ? (designer || null) : existingModelData.designer;
        const finalSource = source !== undefined ? (source || null) : existingModelData.source;
        const finalNotes = notes !== undefined ? (notes || null) : existingModelData.notes;
        const finalPrinted = printed !== undefined ? (printed ? 1 : 0) : existingModelData.printed;
        const finalParentModel = parentModel !== undefined ? (parentModel || null) : existingModelData.parentModel;
        const finalLicense = license !== undefined ? (license || null) : existingModelData.license;
        
        // Use a simpler update approach to avoid foreign key issues
        const updateStmt = db.prepare(`
          UPDATE models SET 
            fileName = ?,
            designer = ?,
            source = ?,
            notes = ?,
            printed = ?,
            parentModel = ?,
            license = ?
          WHERE id = ?
        `);
        
        updateStmt.run(
          finalFileName,
          finalDesigner,
          finalSource,
          finalNotes,
          finalPrinted,
          finalParentModel,
          finalLicense,
          existingModel.id
        );
        
        modelId = existingModel.id;
      } else {
        // Insert new model
        console.log('Inserting new model');
        
        const dateAdded = new Date().toISOString();
        const insertStmt = db.prepare(`
          INSERT INTO models (
            filePath, fileName, designer, source, notes, printed, parentModel, license, dateAdded
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = insertStmt.run(
          filePath,
          fileName,
          designer || null,
          source || null,
          notes || null,
          printed ? 1 : 0,
          parentModel || null,
          license || null,
          dateAdded
        );
        
        modelId = result.lastInsertRowid;
        insertedNewModel = true;
      }
      
      console.log(`Model saved with ID: ${modelId}`);
    } catch (modelError) {
      console.error('Error saving model data:', modelError);
      throw modelError;
    }

    // Now handle tags in a separate transaction if we have a valid model ID
    // Note: We need to process tags even if the array is empty (to remove all tags)
    if (modelId && tags && Array.isArray(tags)) {
      try {
        console.log(`Processing ${tags.length} tags for model ID ${modelId}`);
        
        // Double-check that the model exists before proceeding
        const modelExists = db.prepare('SELECT 1 FROM models WHERE id = ?').get(modelId);
        if (!modelExists) {
          console.error(`Model ID ${modelId} does not exist in the database. This should not happen.`);
          return { success: true, modelId }; // Return success but skip tag processing
        }
        
        // Use a transaction to ensure atomicity and handle errors gracefully
        db.transaction(() => {
          // First, get existing tags before deleting (to preserve them if there's an error)
          const existingTags = db.prepare(`
            SELECT t.name 
            FROM model_tags mt
            JOIN tags t ON mt.tag_id = t.id
            WHERE mt.model_id = ?
          `).all(modelId).map(row => row.name);
          
          // First, remove all existing tags for this model
          try {
            const deleteResult = db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);
            console.log(`Deleted ${deleteResult.changes} existing tag relationships`);
          } catch (deleteError) {
            // If delete fails due to models_old, clean up and try again
            if (deleteError.message && deleteError.message.includes('models_old')) {
              console.log('Delete failed due to models_old reference. Cleaning up...');
              cleanupModelsOldReferences();
              // Try delete again
              const deleteResult = db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);
              console.log(`Deleted ${deleteResult.changes} existing tag relationships after cleanup`);
            } else {
              throw deleteError; // Re-throw if it's a different error
            }
          }

          // Process each tag individually (only if there are tags to add)
          if (tags.length > 0) {
            for (const tagName of tags) {
              if (tagName && typeof tagName === 'string' && tagName.trim() !== '') {
                const trimmedTagName = tagName.trim();
                try {
                  console.log(`Processing tag: "${trimmedTagName}"`);
                  
                  // First ensure the tag exists in the tags table
                  db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(trimmedTagName);
                  
                  // Get the tag ID directly
                  const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmedTagName);
                  
                  if (tagRow && tagRow.id) {
                    console.log(`Found tag ID ${tagRow.id} for "${trimmedTagName}"`);
                    
                    // Now create the relationship with the known IDs
                    db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(modelId, tagRow.id);
                  } else {
                    console.warn(`Could not find tag ID for "${trimmedTagName}" after insertion`);
                  }
                } catch (singleTagError) {
                  console.error(`Error processing tag "${trimmedTagName}":`, singleTagError);
                  // Continue with other tags
                }
              }
            }
          } else {
            console.log('Tags array is empty - all tags have been removed from this model');
          }
        })();
      } catch (tagError) {
        console.error('Error updating tags:', tagError);
        
        // If the error is about models_old, try to clean it up and retry
        if (tagError.message && tagError.message.includes('models_old')) {
          console.log('Detected models_old error. Attempting to clean up and retry...');
          try {
            cleanupModelsOldReferences();
            // Retry the tag save operation in a new transaction
            db.transaction(() => {
              // Delete existing tags first
              db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);
              
              // Re-insert the tags we were trying to save (only if there are tags)
              if (tags.length > 0) {
                for (const tagName of tags) {
                  if (tagName && typeof tagName === 'string' && tagName.trim() !== '') {
                    const trimmedTagName = tagName.trim();
                    try {
                      db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(trimmedTagName);
                      const tagRow = db.prepare('SELECT id FROM tags WHERE name = ?').get(trimmedTagName);
                      if (tagRow && tagRow.id) {
                        db.prepare('INSERT OR IGNORE INTO model_tags (model_id, tag_id) VALUES (?, ?)').run(modelId, tagRow.id);
                      }
                    } catch (retryError) {
                      console.error(`Error retrying tag "${trimmedTagName}":`, retryError);
                    }
                  }
                }
              }
            })();
            console.log('Successfully retried tag save after cleanup');
          } catch (cleanupError) {
            console.error('Error during cleanup and retry:', cleanupError);
            // Don't throw - we want to preserve the model save even if tags fail
          }
        }
        // Continue with the save even if tag update fails - don't throw to preserve model data
      }
    }

    if (insertedNewModel) {
      scheduleBackgroundHashGeneration('save-model');
    }
    return { success: true, modelId };

  } catch (error) {
    console.error('Error saving model:', error);
    throw error;
  }
}

// Register save-model for Chrome extension (WebSocket works in normal and server mode)
ipcHandlerRegistry.set('save-model', async (event, modelData) => await saveModel(modelData));

// Extension upload: write file to configured directory then saveModel (used by POST /api/extension-upload and IPC)
async function saveModelFromUpload(payload) {
  if (!db) throw new Error('Database not ready');
  const { fileBase64, fileName: requestedFileName, designer, source, notes, parentModel, license } = payload || {};
  if (!fileBase64 || typeof fileBase64 !== 'string') throw new Error('Missing or invalid fileBase64');
  const uploadDirRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('extensionUploadDirectory');
  let uploadDir = (uploadDirRow && uploadDirRow.value) ? String(uploadDirRow.value).trim() : '';
  if (!uploadDir && process.env.EXTENSION_UPLOAD_DIR) uploadDir = String(process.env.EXTENSION_UPLOAD_DIR).trim();
  if (!uploadDir) throw new Error('Extension upload directory not configured. Set Settings > Chrome Extension > Upload directory, or EXTENSION_UPLOAD_DIR in Docker.');
  const baseName = requestedFileName && path.basename(String(requestedFileName).trim()) || 'model.stl';
  const safeFileName = baseName.replace(/[<>:"/\\|?*]/g, '_') || 'model.stl';
  const resolvedUploadDir = path.resolve(uploadDir);
  const targetPath = path.join(resolvedUploadDir, safeFileName);
  const targetPathResolved = path.resolve(targetPath);
  if (!targetPathResolved.startsWith(resolvedUploadDir)) throw new Error('Invalid path');
  if (!fs.existsSync(resolvedUploadDir)) fs.mkdirSync(resolvedUploadDir, { recursive: true });
  let buffer;
  try {
    buffer = Buffer.from(fileBase64, 'base64');
  } catch (e) {
    throw new Error('Invalid base64 file content');
  }
  if (buffer.length === 0) throw new Error('Empty file');
  fs.writeFileSync(targetPathResolved, buffer);
  return await saveModel({
    filePath: targetPathResolved,
    fileName: safeFileName,
    designer: designer || null,
    source: source || null,
    notes: notes || null,
    parentModel: parentModel || null,
    license: license || null
  });
}
ipcHandlerRegistry.set('save-model-from-upload', async (event, payload) => await saveModelFromUpload(payload));

// Add this function before saveModel
function verifyDatabaseIntegrity() {
  try {
    console.log('Verifying database integrity...');
    
    // Check if foreign keys are enabled
    const foreignKeysEnabled = db.pragma('foreign_keys');
    console.log(`Foreign keys enabled: ${foreignKeysEnabled}`);
    
    // Run integrity check
    const integrityCheck = db.pragma('integrity_check');
    console.log(`Integrity check result: ${JSON.stringify(integrityCheck)}`);
    
    // Check for orphaned records in model_tags
    const orphanedModelTags = db.prepare(`
      SELECT mt.model_id, mt.tag_id 
      FROM model_tags mt
      LEFT JOIN models m ON mt.model_id = m.id
      LEFT JOIN tags t ON mt.tag_id = t.id
      WHERE m.id IS NULL OR t.id IS NULL
    `).all();
    
    if (orphanedModelTags.length > 0) {
      console.error(`Found ${orphanedModelTags.length} orphaned model_tags records:`, orphanedModelTags);
      
      // Clean up orphaned records
      db.prepare(`
        DELETE FROM model_tags 
        WHERE model_id IN (
          SELECT mt.model_id 
          FROM model_tags mt
          LEFT JOIN models m ON mt.model_id = m.id
          WHERE m.id IS NULL
        )
      `).run();
      
      db.prepare(`
        DELETE FROM model_tags 
        WHERE tag_id IN (
          SELECT mt.tag_id 
          FROM model_tags mt
          LEFT JOIN tags t ON mt.tag_id = t.id
          WHERE t.id IS NULL
        )
      `).run();
      
      console.log('Cleaned up orphaned model_tags records');
    } else {
      console.log('No orphaned model_tags records found');
    }
    
    return true;
  } catch (error) {
    console.error('Database integrity check failed:', error);
    return false;
  }
}

// Add this function to check and create the slicers table if it doesn't exist
function ensureSlicersTableExists() {
  try {
    console.log('Checking if slicers table exists...');
    
    // Check if the slicers table exists
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='slicers'`).get();
    
    if (!tableExists) {
      console.log('Slicers table does not exist. Creating it...');
      
      // Create the slicers table
      db.prepare(`CREATE TABLE IF NOT EXISTS slicers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          path TEXT NOT NULL
      )`).run();
      
      console.log('Slicers table created successfully');
    } else {
      console.log('Slicers table already exists');
    }
    
    return true;
  } catch (error) {
    console.error('Error ensuring slicers table exists:', error);
    return false;
  }
}

// Add this function to get or create a persistent client ID
function getClientId() {
  try {
    if (!db || !db.prepare) {
      console.error('Database not initialized, generating temporary client ID');
      return crypto.randomUUID();
    }
    
    // Try to get the client ID from the database
    const clientIdSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('ClientId');
    
    if (clientIdSetting && clientIdSetting.value) {
      return clientIdSetting.value;
    }
    
    // If no client ID exists, generate a new one and store it
    const newClientId = crypto.randomUUID();
    
    // Check if the settings table has the ClientId key
    const existingKey = db.prepare('SELECT key FROM settings WHERE key = ?').get('ClientId');
    
    if (existingKey) {
      // Update the existing key
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(newClientId, 'ClientId');
    } else {
      // Insert a new key
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('ClientId', newClientId);
    }
    
    return newClientId;
  } catch (error) {
    console.error('Error getting/creating client ID:', error);
    return crypto.randomUUID(); // Fallback to a temporary ID
  }
}

// Add a new handler to check the CollectUsage setting directly from the database
ipcMain.handle('check-collect-usage', async (event) => {
  try {
    console.log('Main Process - Checking CollectUsage setting directly from database');
    const result = db.prepare('SELECT value FROM settings WHERE key = ?').get('CollectUsage');
    console.log('CollectUsage direct check result:', result);
    return result?.value || null;
  } catch (error) {
    console.error('Error checking CollectUsage setting:', error);
    return null;
  }
});