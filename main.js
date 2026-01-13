const { app, BrowserWindow, ipcMain, screen, dialog, Menu, shell, contextBridge } = require('electron');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const puppeteer = require('puppeteer');
const { Worker } = require('worker_threads');
const JSZip = require('jszip');
const os = require('os');
const https = require('https');
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
  return fs.existsSync('/.dockerenv') || 
         fs.existsSync('/proc/self/cgroup') && 
         fs.readFileSync('/proc/self/cgroup', 'utf8').includes('docker');
}

function validateUncPath(path, operation = 'operation') {
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
function startHttpServer() {
  const expressApp = express();
  const PORT = 5000;
  const HOST = '0.0.0.0';

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

  // Serve static files from the application directory
  const appDir = __dirname;
  
  // Inject server-bridge.js into HTML for server mode
  expressApp.get('/', (req, res) => {
    const htmlPath = path.join(appDir, 'index.html');
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.status(500).send('Error loading index.html');
        return;
      }
      // Inject server-bridge.js BEFORE renderer.js loads
      // This is critical - bridge must initialize window.electron.on before renderer.js uses it
      const bridgeScript = '<script src="/server-bridge.js"></script>';
      let modifiedHtml = data;
      
      // Try to inject before the first <script> tag (which should be renderer.js or search.js)
      if (data.includes('<script')) {
        // Insert before first script tag
        modifiedHtml = data.replace(/(<script[^>]*>)/i, `${bridgeScript}\n$1`);
      } else if (data.includes('</head>')) {
        // Insert before closing head tag
        modifiedHtml = data.replace('</head>', `${bridgeScript}\n</head>`);
      } else {
        // Fallback: insert before closing body tag
        modifiedHtml = data.replace('</body>', `${bridgeScript}\n</body>`);
      }
      res.send(modifiedHtml);
    });
  });

  // Serve files via HTTP for server mode (UNC paths or Docker-mounted paths)
  expressApp.get('/api/file/*', (req, res) => {
    try {
      // Extract file path from URL (everything after /api/file/)
      const filePath = decodeURIComponent(req.path.replace('/api/file/', ''));
      
      // Validate path (UNC paths on Windows, absolute paths in Docker)
      if (isDockerContainer()) {
        // In Docker, require absolute paths starting with /
        if (!filePath.startsWith('/') && !isUncPath(filePath)) {
          res.status(400).send('Invalid path: Docker server mode requires absolute paths (e.g., /mnt/network-share/path/to/file.stl)');
          return;
        }
      } else {
        // On Windows, require UNC paths
        if (!isUncPath(filePath)) {
          res.status(400).send('Invalid path: Server mode requires UNC paths');
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
        '.jpeg': 'image/jpeg'
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
      
      if (isDockerContainer()) {
        // In Docker, require absolute paths starting with /
        if (!normalizedFilePath.startsWith('/') && !isUncPath(actualFilePath)) {
          // For temp files from zip extraction, allow them
          if (!normalizedFilePath.includes(normalizedTempDir)) {
            res.status(400).send('Invalid path: Docker server mode requires absolute paths');
            return;
          }
        }
      } else {
        // On Windows, require UNC paths (except temp files)
        if (!isUncPath(actualFilePath) && !normalizedFilePath.includes(normalizedTempDir)) {
          res.status(400).send('Invalid path: Server mode requires UNC paths');
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
        '.jpeg': 'image/jpeg'
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
    fs.readFile(htmlPath, 'utf8', (err, data) => {
      if (err) {
        res.status(500).send('Error loading index.html');
        return;
      }
      // Inject server-bridge.js script before closing body tag
      const bridgeScript = '<script src="/server-bridge.js"></script>';
      const modifiedHtml = data.replace('</body>', `${bridgeScript}\n</body>`);
      res.send(modifiedHtml);
    });
  });

  // Start server
  httpServer = expressApp.listen(PORT, HOST, () => {
    console.log(`Printventory server mode started`);
    console.log(`Server running at http://${HOST}:${PORT}`);
    console.log(`Access from remote browsers: http://<your-ip>:${PORT}`);
    console.log(`Server mode requires UNC paths for all file operations`);
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
        
        // Handle event sends (fire and forget) - these are events, not IPC handlers
        if (type === 'send') {
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
          }
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
            }
          };
          
          // Check if handler exists
          const handler = ipcMain.listeners('handle-' + channel)?.[0];
          if (!handler) {
            // Try to find the handler in the registered handlers
            // IPC handlers are registered with ipcMain.handle, so we need to trigger them
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
              ws.send(JSON.stringify({
                id,
                type: 'result',
                result
              }));
            } else {
              throw new Error(`IPC handler '${channel}' not found`);
            }
          } else {
            // Call the handler directly
            const result = await handler(mockEvent, ...(args || []));
            ws.send(JSON.stringify({
              id,
              type: 'result',
              result
            }));
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

  httpServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Please stop the other application or use a different port.`);
    } else {
      console.error('Server error:', err);
    }
    process.exit(1);
  });
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
        startHttpServer();
        
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
        startHttpServer();
        // Create a hidden BrowserWindow to handle IPC (preload script needs a window)
        await createHiddenWindow();
        // Don't quit when all windows are closed in server mode
        app.on('window-all-closed', () => {
          // Keep the app running in server mode
        });
      } else {
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
      { key: 'aiTagMaxTags', value: '10' }, // Maximum number of AI-generated tags
      { key: 'aiTagUseCategories', value: '0' }, // Use category-based tagging
      { key: 'aiTagMergeStrategy', value: 'merge' }, // How to merge AI tags: 'replace', 'merge', 'append'
      { key: 'aiTagAllowRetagging', value: '0' }, // Allow re-tagging even if "AI Tagged" exists
      { key: 'aiTagConcurrency', value: '3' }, // Number of concurrent tag generation requests
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
        {
          label: 'Slicer Path',
          click: () => mainWindow.webContents.send('open-slicer-settings')
        },
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
          label: 'Library Stats',
          click: () => {
            mainWindow.webContents.send('open-stats');
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
        {
          label: 'Slicer Path',
          click: () => mainWindow.webContents.send('open-slicer-settings')
        },
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
          label: 'Library Stats',
          click: () => {
            mainWindow.webContents.send('open-stats');
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
    const allModels = db.prepare('SELECT filePath, id FROM models').all();
    const filesToDelete = [];

    // First, collect files that would be deleted
    for (const model of allModels) {
      // Only check files that are within the scanned directory
      // Normalize paths and ensure consistent trailing slash handling
      let normalizedScanPath = normalizePath(scanDirectoryPath);
      let normalizedFilePath = normalizePath(model.filePath);
      
      // Remove trailing slashes for consistent comparison (except for root paths)
      if (normalizedScanPath.endsWith('/') && normalizedScanPath.length > 1) {
        normalizedScanPath = normalizedScanPath.slice(0, -1);
      }
      if (normalizedFilePath.endsWith('/') && normalizedFilePath.length > 1) {
        normalizedFilePath = normalizedFilePath.slice(0, -1);
      }
      
      // Check if file is within the scanned directory
      // Also handle case-insensitive comparison on Windows
      const isWithinScanDir = process.platform === 'win32' 
        ? normalizedFilePath.toLowerCase().startsWith(normalizedScanPath.toLowerCase())
        : normalizedFilePath.startsWith(normalizedScanPath);
      
      if (isWithinScanDir) {
        const pathInfo = parseZipPath(model.filePath);
        let fileExists = false;
        
        if (pathInfo.isZipEntry) {
          // For zip entries, check if the zip file exists and the entry exists within it
          try {
            fileExists = await checkZipEntryExists(pathInfo.zipPath, pathInfo.entryPath);
          } catch (error) {
            console.error(`Error checking zip entry ${model.filePath}:`, error);
            fileExists = false; // If check fails, consider file as non-existent
          }
        } else {
          // For regular files, check if the file exists
          // Use a more robust check that handles path normalization issues
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
            // If any error occurs during existence check, log it but don't throw
            console.error(`Error checking file existence for ${model.filePath}:`, error);
            fileExists = false;
          }
        }
        
        if (!fileExists) {
          // Log for debugging - can be removed in production if too verbose
          debugLog(`File marked as non-existent: ${model.filePath}`);
          filesToDelete.push({
            filePath: model.filePath,
            id: model.id
          });
        }
      }
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
      
      // In server mode, auto-remove files without showing dialog
      if (isServerMode) {
        // Auto-remove in server mode
        for (const file of filesToDelete) {
          db.prepare('DELETE FROM models WHERE id = ?').run(file.id);
        }
        console.log(`Server mode: Removed ${filesToDelete.length} non-existent files from library`);
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
ipcMain.handle('scan-directory', async (event, directoryPath) => {
  try {
    // Validate UNC path in server mode
    try {
      validateUncPath(directoryPath, 'scan-directory');
    } catch (validationError) {
      throw new Error(validationError.message);
    }
    
    debugLog('Starting directory scan:', directoryPath);
    const maxFileSize = await getMaxFileSize();
    
    // Read enableZipArchives setting from database
    const zipSetting = db.prepare('SELECT value FROM settings WHERE key = ?').get('enableZipArchives');
    const enableZipArchives = zipSetting && zipSetting.value === '1';
    
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
        // Try to get from app.asar.unpacked directory first
        const unpackedPath = __dirname.replace('.asar', '.asar.unpacked');
        const unpackedWorkerPath = path.join(unpackedPath, 'scan-worker.js');
        if (fs.existsSync(unpackedWorkerPath)) {
          workerPath = unpackedWorkerPath;
        } else {
          // Copy to temp directory as fallback
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
            const updateExisting = db.prepare(`
              UPDATE models 
              SET hash = ?, size = ?, modifiedDate = ?
              WHERE filePath = ?
            `);
            
            const insertNew = db.prepare(`
              INSERT INTO models (
                filePath, fileName, hash, size, modifiedDate, dateAdded
              ) VALUES (?, ?, ?, ?, ?, ?)
            `);

            // Track count of newly inserted files
            let newFilesCount = 0;
            
            // Use a transaction for better performance
            db.transaction(() => {
              for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                
                for (const file of batch) {
                  const exists = db.prepare('SELECT 1 FROM models WHERE filePath = ?').get(file.filePath);
                  
                  if (exists) {
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
            
            resolve({ files, totalFiles, newFilesCount });
            
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

      // Start the worker
      worker.postMessage({ directoryPath, maxFileSize, enableZipArchives });
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
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showMessageBox(window || undefined, options);
    return result;
  } catch (error) {
    console.error('Error showing message box:', error);
    throw error;
  }
});

ipcMain.handle('get-all-models', async (event, sortOption, limit = 0) => {
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

    let models;
    if (limit === 0) {
      // When limit is 0, load all models without a limit
      models = db.prepare(`SELECT * FROM models ${orderClause}`).all();
    } else {
      models = db.prepare(`SELECT * FROM models ${orderClause} LIMIT ?`).all(limit);
    }
    return models;
  } catch (error) {
    console.error("Error in getAllModels IPC:", error);
    return [];
  }
});

ipcMain.handle('get-models-filtered', async (event, filters) => {
  try {
    console.log('getModelsFiltered called with filters:', filters);
    
    // Build WHERE clause conditions
    const conditions = [];
    const params = [];
    
    // Designer filter
    if (filters.designer) {
      if (filters.designer === '__none__') {
        conditions.push("(designer IS NULL OR designer = '')");
      } else {
        conditions.push("LOWER(TRIM(designer)) = LOWER(TRIM(?))");
        params.push(filters.designer);
      }
    }
    
    // License filter
    if (filters.license) {
      if (filters.license === '__none__') {
        conditions.push("(license IS NULL OR license = '')");
      } else {
        conditions.push("license = ?");
        params.push(filters.license);
      }
    }
    
    // Parent model filter
    if (filters.parentModel) {
      if (filters.parentModel === '__none__') {
        conditions.push("(parentModel IS NULL OR parentModel = '')");
      } else {
        conditions.push("parentModel = ?");
        params.push(filters.parentModel);
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
        conditions.push("LOWER(fileName) LIKE ?");
        params.push(`%.${filters.fileType.toLowerCase()}`);
      }
    }
    
    // Directory filter
    if (filters.directory) {
      // Ensure the directory path ends with a separator to match only files within that directory
      // This prevents matching subdirectories with similar names (e.g., "test" matching "test2")
      let directoryPath = filters.directory;
      // Add path separator if not already present at the end
      if (!directoryPath.endsWith('\\') && !directoryPath.endsWith('/') && !directoryPath.endsWith('::')) {
        // Determine the appropriate separator based on the path
        if (directoryPath.includes('\\')) {
          directoryPath += '\\';
        } else if (directoryPath.includes('/')) {
          directoryPath += '/';
        } else {
          // Default to backslash for Windows paths
          directoryPath += '\\';
        }
      }
      conditions.push("filePath LIKE ?");
      params.push(`${directoryPath}%`);
    }
    
    // Search term filter (searches in fileName, designer, parentModel, notes, filePath)
    if (filters.search) {
      const searchTerm = `%${filters.search.toLowerCase()}%`;
      conditions.push(`(
        LOWER(fileName) LIKE ? OR 
        LOWER(designer) LIKE ? OR 
        LOWER(parentModel) LIKE ? OR 
        LOWER(notes) LIKE ? OR
        LOWER(filePath) LIKE ?
      )`);
      params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    }
    
    // Date Added filter (filter by dateAdded >= specified date)
    if (filters.dateAdded) {
      conditions.push("dateAdded >= ?");
      params.push(filters.dateAdded);
    }
    
    // Build WHERE clause
    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    
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
      default:
        orderClause = "ORDER BY modifiedDate DESC";
        break;
    }
    
    // Execute query
    let query = `SELECT * FROM models ${whereClause} ${orderClause}`;
    console.log('Executing query:', query);
    console.log('With params:', params);
    
    let models = db.prepare(query).all(...params);
    
    // Tag filter (needs to be done after query since it requires joining with model_tags)
    if (filters.tag) {
      const tagFilteredModels = [];
      for (const model of models) {
        const modelTags = db.prepare(`
          SELECT t.name 
          FROM tags t
          INNER JOIN model_tags mt ON t.id = mt.tag_id
          WHERE mt.model_id = ?
        `).all(model.id);
        
        if (modelTags.some(tag => tag.name === filters.tag)) {
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
});

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
ipcMain.handle('get-setting', async (event, key) => {
  try {
    console.log('Main Process - Getting setting:', key);
    const result = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    console.log('Main Process - Setting value:', result?.value);
    return result?.value || null;
  } catch (error) {
    console.error('Error getting setting:', error);
    return null;
  }
});

// Add error handling to the saveSetting handler
ipcMain.handle('save-setting', async (event, key, value) => {
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
});

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
ipcMain.handle('restore-database', async () => {
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
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Library',
    defaultPath: 'printventory-library.json',
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      // Get all models
      const models = db.prepare('SELECT * FROM models').all();
      
      // For each model, get its tags
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
      
      // Create export object
      const exportData = {
        version: '1.0',
        exportDate: new Date().toISOString(),
        models: modelsWithTags
      };
      
      // Write JSON file
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
ipcMain.handle('import-library', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Library',
    filters: [
      { name: 'JSON Files', extensions: ['json'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    try {
      // Read and parse JSON file
      const fileContent = await fs.promises.readFile(result.filePaths[0], 'utf8');
      const importData = JSON.parse(fileContent);
      
      // Validate structure
      if (!importData.models || !Array.isArray(importData.models)) {
        throw new Error('Invalid library file format: missing models array');
      }
      
      const totalModels = importData.models.length;
      
      // Show progress dialog
      event.sender.send('show-progress-dialog', {
        title: 'Importing Library',
        message: 'Reading library file...',
        total: totalModels
      });
      
      // Import each model using saveModel function
      let importedCount = 0;
      let updatedCount = 0;
      
      for (let i = 0; i < importData.models.length; i++) {
        const modelData = importData.models[i];
        try {
          // Check if model exists
          const existingModel = db.prepare('SELECT id FROM models WHERE filePath = ?').get(modelData.filePath);
          
          // Use saveModel to handle insert/update and tags
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
          
          // Update progress
          event.sender.send('update-progress', {
            current: i + 1,
            total: totalModels,
            message: `Importing model ${i + 1} of ${totalModels}...`
          });
        } catch (modelError) {
          console.error(`Error importing model ${modelData.filePath}:`, modelError);
          // Continue with other models, but still update progress
          event.sender.send('update-progress', {
            current: i + 1,
            total: totalModels,
            message: `Importing model ${i + 1} of ${totalModels}...`
          });
        }
      }
      
      // Close progress dialog
      event.sender.send('close-progress-dialog');
      
      // Notify renderer to refresh the view
      mainWindow.webContents.send('refresh-grid');
      
      return { success: true, imported: importedCount, updated: updatedCount };
    } catch (error) {
      console.error('Import library error:', error);
      // Close progress dialog on error
      event.sender.send('close-progress-dialog');
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
    // Validate UNC path in server mode
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
    console.log('Attempting trashItem with path:', normalizedPath);
    await shell.trashItem(normalizedPath);
    console.log('trashItem succeeded');
    
    // If trash succeeds, remove from database
    await new Promise((resolve, reject) => {
      console.log('Deleting from database:', normalizedPath);
      db.prepare('DELETE FROM models WHERE filePath = ?').run(normalizedPath);
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
        threeMf: threeMfCount ? threeMfCount.count : 0
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
ipcMain.handle('purge-models', async () => {
  try {
    // First ask for confirmation
    const result = await dialog.showMessageBox({
      type: 'warning',
      title: 'Purge Models',
      message: 'Are you sure you want to purge all models?',
      detail: 'This will remove all model data from the database. This action cannot be undone.',
      buttons: ['Cancel', 'Purge All Models'],
      defaultId: 0,
      cancelId: 0,
    });

    if (result.response === 1) { // User clicked "Purge All Models"
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
});

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
  
  // Add "Download" option for server/docker mode at the top
  if ((isServerMode || isDockerContainer()) && filePaths.length === 1) {
    menuItems.push({
      label: 'Download',
      click: async () => {
        try {
          console.log('Download clicked for file:', filePaths[0]);
          // Send download event to renderer
          // In server mode, use broadcastEvent to send to all WebSocket clients
          if (isServerMode && global.broadcastEvent) {
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
  
  menuItems.push(
    {
      label: 'Open File',
      enabled: filePaths.length === 1,
      click: async () => {
        try {
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
          dialog.showMessageBox({
            type: 'error',
            title: 'Error',
            message: 'Could not open file',
            detail: error.message
          });
        }
      }
    },
    {
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
    }
  );
  
  // Add extract options for zip entries
  if (isZipEntry && pathInfo && filePaths.length === 1) {
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
  
  // Add "Open in Slicer" submenu if there are configured slicers and only one file is selected
  if (slicers.length > 0 && filePaths.length === 1) {
    const slicerSubmenu = {
      label: 'Open in Slicer',
      submenu: slicers.map(slicer => ({
        label: slicer.name,
        click: async () => {
          try {
            const { exec } = require('child_process');
            let modelPath = filePaths[0]; // Use the first file selected
            
            // If it's a zip entry, extract to temp first
            if (isZipEntry && pathInfo) {
              modelPath = await extractModelFromZip(pathInfo.zipPath, pathInfo.entryPath);
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
                dialog.showErrorBox('Slice Model Error', error.message);
              }
            });
          } catch (error) {
            console.error('Error slicing model:', error);
            dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
              type: 'error',
              title: 'Error',
              message: 'Could not slice model',
              detail: error.message
            });
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
    menuItems.push({
      label: 'Generate Tags',
      // Remove the restriction to only one file
      click: async () => {
        try {
          const aitagging = require('./aitagging');
          const settings = getSettings();
          
          // Create puter IPC handler if service is puter
          const puterIPCHandler = settings.aiService === 'puter' ? createPuterIPCHandler() : null;
          
          // Initialize OpenAI with the API key
          aitagging.initializeOpenAI(settings.apiKey, settings.apiEndpoint, settings.aiService, puterIPCHandler);
          
          // Filter out invalid file paths first
          const validFilePaths = filePaths.filter(fp => fp && typeof fp === 'string');
          
          // Use validFilePaths for processing
          const filesToProcess = validFilePaths.length > 0 ? validFilePaths : filePaths;
          
          // Start tag generation - show review dialog immediately for both single and multiple files
          if (filesToProcess.length > 1) {
            // Send all file paths so the dialog can show all models immediately
            event.sender.send('start-batch-tag-generation', filesToProcess.length, filesToProcess);
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
              
              console.log('Sending start-single-tag-generation event');
              event.sender.send('start-single-tag-generation', filesToProcess[0], {
                filePath: filesToProcess[0],
                model: singleModel,
                generatedTags: undefined, // undefined means "generating"
                existingTags: modelTags
              });
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
          const processFile = async (filePath, index) => {
            try {
              // Get the model from the database to access its thumbnail
              const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
              
              if (!model) {
                console.log(`Model not found in database: ${filePath}, skipping`);
                completed++;
                // Send empty tags for skipped models so they appear in the review dialog
                event.sender.send('tags-generated', filePath, [], null);
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
              event.sender.send('tags-generated', filePath, [], null);
              return;
              }
              
              // Prepare tag generation options
              const tagOptions = {
                maxTags: settings.aiTagMaxTags,
                useCategories: settings.aiTagUseCategories,
                useJsonResponse: settings.aiTagUseJsonResponse,
                detailLevel: settings.aiTagDetailLevel
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
                    event.sender.send('tags-generated', filePath, [], error.message);
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
                      event.sender.send('tags-generated', filePath, [], error.message);
                      completed++;
                      return;
                    }
                  }
                }
              }
              
              // Send the generated tags back to the renderer process
              event.sender.send('tags-generated', filePath, tags, null);
              
              completed++;
              // Progress is now shown in the review dialog
            } catch (error) {
              console.error(`Unexpected error processing ${filePath}:`, error);
              failureCount++;
              completed++;
              // Check if it's a rate limit error
              if (error.message && error.message.includes('Rate limit')) {
                // Send error info with empty tags
                event.sender.send('tags-generated', filePath, [], error.message);
              } else {
                // Send empty tags for failed models so they appear in the review dialog
                event.sender.send('tags-generated', filePath, []);
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
            event.sender.send('batch-tag-generation-complete');
          }
        } catch (error) {
          console.error('Error generating tags:', error);
          
          // Close progress dialog if open
          if (filePaths.length > 1) {
            event.sender.send('close-progress-dialog');
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

  // Add "Add Image" option for single file selection
  if (filePaths.length === 1) {
    menuItems.push({
      label: 'Add Image',
      click: async () => {
        try {
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
            
            // Add thumbnail to model
            const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePaths[0]);
            const currentThumbnail = model?.thumbnail || null;
            const thumbnailsWithNew = addThumbnailToModel(currentThumbnail, dataUrl);
            
            // Parse thumbnails to get count
            const thumbnails = parseThumbnails(thumbnailsWithNew);
            const newImageIndex = thumbnails.length - 1; // The new image is at the end
            
            // Make the new image the default (move it to the front)
            const updatedThumbnail = setDefaultThumbnailIndex(thumbnailsWithNew, newImageIndex);
            await saveThumbnail(filePaths[0], updatedThumbnail);
            
            // Verify the save was successful
            const verifyModel = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePaths[0]);
            const finalThumbnails = parseThumbnails(verifyModel?.thumbnail || '');
            
            // Send message to renderer to refresh the grid with updated thumbnail
            // The renderer will handle the refresh with a delay to ensure database write completes
            event.sender.send('thumbnail-added', {
              filePath: filePaths[0],
              thumbnailCount: finalThumbnails.length,
              hasMultiple: finalThumbnails.length > 1,
              newImageIsDefault: true
            });
          }
        } catch (error) {
          console.error('Error adding image:', error);
          dialog.showMessageBox(BrowserWindow.fromWebContents(event.sender), {
            type: 'error',
            title: 'Error',
            message: 'Could not add image',
            detail: error.message
          });
        }
      }
    });
  }

  // Add separator before file operations
  menuItems.push({ type: 'separator' });

  // Add Move and new file operations
  menuItems.push(
    {
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
    },
    {
      label: 'Remove from Library',
      click: async () => {
        // Limit file list display to prevent dialog from becoming too tall
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
        if (confirm.response === 0) { // User clicked "Yes"
          try {
            // Use a transaction to handle all removals
            db.transaction(() => {
              filePaths.forEach(fp => {
                const model = db.prepare('SELECT id FROM models WHERE filePath = ?').get(fp);
                if (model) {
                  // First delete from model_tags (child table)
                  db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(model.id);
                  // Then delete from models (parent table)
                  db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
                }
              });
            })();
            
            event.sender.send('refresh-grid');
          } catch (error) {
            console.error('Error removing from library:', error);
            await dialog.showMessageBox({
              type: 'error',
              title: 'Error',
              message: `An error occurred while removing from library: ${error.message}`
            });
          }
        }
      }
    },
    {
      label: 'Delete from Disk',  // Renamed from just "Delete"
      click: async () => {
        // Limit file list display to prevent dialog from becoming too tall
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
        if (confirm.response === 0) { // User clicked "Yes"
          for (const fp of filePaths) {
            try {
              const success = await deleteFile(fp);
              if (!success) {
                await dialog.showMessageBox({
                  type: 'error',
                  title: 'Error',
                  message: `Failed to delete file: ${fp}`
                });
              }
            } catch (error) {
              console.error('Error deleting file:', error);
              await dialog.showMessageBox({
                type: 'error',
                title: 'Error',
                message: `An error occurred: ${error.message}`
              });
            }
          }
          event.sender.send('refresh-grid');
        }
      }
    }
  );

  const menu = Menu.buildFromTemplate(menuItems);
  
  // Get the window - use helper function that handles server mode
  const win = getWindowFromEvent(event);
  
  // In Docker/server mode, use mainWindow if available, or popup without window parameter
  if (win) {
    menu.popup({ window: win });
  } else if (mainWindow && !mainWindow.isDestroyed()) {
    // Fallback to mainWindow in server/Docker mode
    menu.popup({ window: mainWindow });
  } else {
    // Last resort: popup without window (uses current focused window)
    menu.popup();
  }
});

// Update the deleteFile function
async function deleteFile(filePath) {
  try {
    // Delete the actual file
    await fs.promises.unlink(filePath);
    
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
// Helper function to parse zip path format
function parseZipPath(filePath) {
  if (filePath.includes('::')) {
    const [zipPath, entryPath] = filePath.split('::');
    return { zipPath, entryPath, isZipEntry: true };
  }
  return { zipPath: filePath, entryPath: null, isZipEntry: false };
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
    
    // Use JSZip to extract the 3MF file (which is a zip file)
    const zip = new JSZip();
    const data = await fs.promises.readFile(actualFilePath);
    const contents = await zip.loadAsync(data);
    
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
  // Skip files located in __MACOSX directories
  if (/[\\\/]__macosx[\\\/]/i.test(filePath)) {
    console.log('Skipping file from __MACOSX directory:', filePath);
    return [];
  }
  
  // Check if this is a zip entry
  const pathInfo = parseZipPath(filePath);
  let actualFilePath = filePath;
  
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
    
    // Use JSZip to extract the 3MF file (which is a zip file)
    console.log('Creating JSZip instance...');
    const zip = new JSZip();
    
    console.log('Reading file data...');
    const data = await fs.promises.readFile(actualFilePath);
    console.log('File read successfully, size:', data.length, 'bytes');
    
    console.log('Loading zip contents...');
    const contents = await zip.loadAsync(data);
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
  try {
    // Check if this is a zip entry
    const pathInfo = parseZipPath(filePath);
    let actualFilePath = filePath;
    let shouldCleanup = false;
    
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
    
    const zip = new JSZip();
    const data = await fs.promises.readFile(actualFilePath);
    const contents = await zip.loadAsync(data);
    
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
ipcMain.handle('get-duplicates', async (event, includeZip = false) => {
  try {
    // Get all models with their hashes
    const models = db.prepare(`
      SELECT filePath, fileName, hash, size 
      FROM models 
      WHERE hash IS NOT NULL
    `).all();

    // Filter out zip entries if includeZip is false
    const filteredModels = includeZip 
      ? models 
      : models.filter(model => !model.filePath.includes('::'));

    // Group by hash to find duplicates
    const duplicates = filteredModels.reduce((acc, model) => {
      if (!acc[model.hash]) {
        acc[model.hash] = [];
      }
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
    console.error('Error getting duplicates:', error);
    throw error;
  }
});

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

    let calculatedCount = 0;
    const updateHash = db.prepare('UPDATE models SET hash = ? WHERE filePath = ?');

    // Send initial progress update
    if (event && event.sender) {
      event.sender.send('hash-generation-progress', {
        processed: 0,
        total: modelsWithMissingHashes.length
      });
    }

    // Process files in parallel with concurrency limit
    const concurrencyLimit = 50; // Process up to 50 files simultaneously
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
          const hash = await calculateFileHash(model.filePath);
          updateHash.run(hash, model.filePath);
          calculatedCount++;
          console.log(`Hash calculated for: ${model.filePath} (${calculatedCount}/${modelsWithMissingHashes.length})`);
          
          // Send progress update after each file
          if (event && event.sender) {
            event.sender.send('hash-generation-progress', {
              processed: calculatedCount,
              total: modelsWithMissingHashes.length
            });
          }
        } else {
          console.warn(`File no longer exists: ${model.filePath}`);
          // Still update progress even if file doesn't exist
          calculatedCount++;
          if (event && event.sender) {
            event.sender.send('hash-generation-progress', {
              processed: calculatedCount,
              total: modelsWithMissingHashes.length
            });
          }
        }
      } catch (error) {
        console.error(`Error calculating hash for ${model.filePath}:`, error);
        // Update progress even on error to prevent hanging
        calculatedCount++;
        if (event && event.sender) {
          event.sender.send('hash-generation-progress', {
            processed: calculatedCount,
            total: modelsWithMissingHashes.length
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
    return { calculated: calculatedCount, total: modelsWithMissingHashes.length };
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
    const updatedThumbnail = addThumbnailToModel(currentThumbnail, imageDataUrl);
    await saveThumbnail(filePath, updatedThumbnail);
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
ipcMain.handle('test-ai-config', async (event, apiKey, baseURL, model, service) => {
  const aitagging = require('./aitagging');
  // Create puter IPC handler if service is puter
  const puterIPCHandler = service === 'puter' ? createPuterIPCHandler() : null;
  return await aitagging.testAIConfig(apiKey, baseURL, model, service, puterIPCHandler);
});

// Helper function for puter.com AI calls (forwards to renderer)
let puterResponseListenerSet = false;
const puterPendingRequests = new Map();

function createPuterIPCHandler() {
  // Set up a single listener for all puter responses
  if (!puterResponseListenerSet) {
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
  
  return async (prompt, imageUrl, model) => {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      puterPendingRequests.set(requestId, { resolve, reject });
      mainWindow.webContents.send('puter-ai-chat-request', requestId, prompt, imageUrl, model);
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
  const handler = createPuterIPCHandler();
  return await handler(prompt, imageUrl, model);
});

ipcMain.handle('generate-tags', async (event, filePath) => {
  try {
    const aitagging = require('./aitagging');
    const settings = getSettings();
    
    // Create puter IPC handler if service is puter
    const puterIPCHandler = settings.aiService === 'puter' ? createPuterIPCHandler() : null;
    
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
    
    // Prepare tag generation options
    const tagOptions = {
      maxTags: settings.aiTagMaxTags,
      useCategories: settings.aiTagUseCategories,
      useJsonResponse: settings.aiTagUseJsonResponse,
      detailLevel: settings.aiTagDetailLevel
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
    aiTagDetailLevel: aiTagDetailLevelRow ? aiTagDetailLevelRow.value : 'medium'
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
    const models = db.prepare('SELECT * FROM models WHERE filePath LIKE ?').all(`${directoryPath}%`);
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
    const models = db.prepare(
      `SELECT * FROM models ORDER BY ${sortOption} LIMIT ? OFFSET ?`
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

ipcMain.handle('clear-and-save-slicers', async (event, slicers) => {
  try {
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
      slicers.forEach(slicer => {
        insert.run(slicer.name, slicer.path);
      });
    })();
    
    return true;
  } catch (error) {
    console.error('Error clearing and saving slicers:', error);
    throw error;
  }
});

ipcMain.handle('get-file-stats', async (event, filePath) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return stats;
  } catch (error) {
    console.error(`Error getting file stats for ${filePath}:`, error);
    throw error;
  }
});

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
    
    const {
      id: inputId, // Rename to avoid confusion
      filePath,
      fileName,
      designer,
      source,
      notes,
      printed,
      parentModel,
      license,
      tags: rawTags
    } = modelData;

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

    return { success: true, modelId };

  } catch (error) {
    console.error('Error saving model:', error);
    throw error;
  }
}

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