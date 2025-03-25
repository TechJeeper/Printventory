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
      
      // GA4 measurement ID and API secret
      const measurementId = 'G-N4766Y9R11';
      const apiSecret = 'JeeNztq1RkCitPAFqT25Qg';
      
      // Add session ID to all events
      params.session_id = this.sessionId;
      
      // Add app_name parameter to identify this as an Electron app
      params.app_name = 'Printventory';
      params.app_version = version;
      
      // Add OS platform information
      params.os_platform = process.platform;
      
      // Add engagement parameters for better real-time tracking
      if (name === 'user_engagement') {
        params.engagement_time_msec = params.engagement_time_msec || 30000;
        params.session_engaged = true;
      }
      
      // Prepare the event data - following GA4 protocol exactly
      const eventData = {
        client_id: clientId,
        user_id: clientId,
        timestamp_micros: Date.now() * 1000, // Current time in microseconds
        non_personalized_ads: true,
        events: [{
          name,
          params
        }]
      };
      
      // Convert to JSON
      const postData = JSON.stringify(eventData);
      
      // Use debug endpoint only in development
      const isDebug = process.env.NODE_ENV === 'development';
      const baseEndpoint = isDebug ? '/debug/mp/collect' : '/mp/collect';
      
      // Prepare the request options
      const options = {
        hostname: 'www.google-analytics.com',
        path: `${baseEndpoint}?measurement_id=${measurementId}&api_secret=${apiSecret}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };
      
      // Log the full request for debugging
      console.log('GA4 request URL:', `https://${options.hostname}${options.path}`);
      console.log('GA4 request body:', postData);
      
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
            
            if (res.statusCode >= 200 && res.statusCode < 300) {
              console.log('GA4 event sent successfully');
              resolve(true);
            } else {
              console.error(`Error sending GA4 event: ${res.statusCode} ${data}`);
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

let db;
let mainWindow;

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
        dialog.showErrorBox('Database Error', 'Failed to initialize database. The application will now quit.');
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

      // Check for updates before creating window
      try {
        await checkForUpdates();
      } catch (updateError) {
        console.error('Error checking version on startup:', updateError);
        // Continue with app startup even if version check fails
      }

      // Now create the window
      createWindow();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });

      createApplicationMenu();
      
      // Track application usage after initialization
      await trackAppUsage();
    } catch (error) {
      console.error('Error during app initialization:', error);
      dialog.showErrorBox('Startup Error', 'Failed to start application properly.');
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
          modifiedDate DATETIME
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
    })();
    
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
      { key: 'aiModel', value: 'gpt-4o-mini' },
      { key: 'maxThumbnailSize', value: '300' },
      { key: 'maxConcurrentRenders', value: '3' },
      { key: 'lastVersionCheck', value: new Date().toISOString() },
      { key: 'CollectUsage', value: '1' }, // Default to opt-in for analytics
      { key: 'ClientId', value: crypto.randomUUID() }, // Generate a unique client ID
      { key: 'currentVersion', value: version }, // Use imported version from package.json
      { key: 'versionCheckPerformedOnStartup', value: 'false' }, // New setting for version check tracking
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
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: false,
      // Add these settings for clipboard access
      sandbox: false,
      enableWebSQL: false
    }
  });

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
          label: 'Theme',
          click: () => mainWindow.webContents.send('open-theme-settings')
        },
        {
          label: 'AI Config',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('open-ai-config');
            }
          }
        },
        {
          label: 'Performance',
          click: () => mainWindow.webContents.send('open-performance-settings')
        },
        {
          label: 'STL Home',
          click: () => mainWindow.webContents.send('open-stl-home')
        },
        {
          label: 'Slicer Path',
          click: () => mainWindow.webContents.send('open-slicer-settings')
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
          label: 'Backup/Restore',
          click: () => mainWindow.webContents.send('open-backup-restore')
        },
        {
          label: 'De-Dup',
          click: () => {
            mainWindow.webContents.send('open-dedup');
          }
        },
        {
          label: 'Tag Manager',
          click: () => mainWindow.webContents.send('open-tag-manager')
        },
        { type: 'separator' },
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
          label: 'Support Printventory',
          click: async () => {
            await shell.openExternal('https://printventory.com/support.html');
          }
        },
        {
          label: 'Discord',
          click: async () => {
            await shell.openExternal('https://discord.gg/JXcZHT77ua');
          }
        },
        { type: 'separator' },
        {
          label: 'Debug Console',
          click: () => mainWindow.webContents.openDevTools()
        },
        {
          label: 'About',
          click: async () => {
            // Send event to renderer to open the about dialog
            mainWindow.webContents.send('open-about');
            
            // Log for debugging
            console.log('About menu item clicked');
          }
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
          label: 'Theme',
          click: () => mainWindow.webContents.send('open-theme-settings')
        },
        {
          label: 'AI Config',
          click: () => mainWindow.webContents.send('open-ai-config')
        },
        {
          label: 'Performance',
          click: () => mainWindow.webContents.send('open-performance-settings')
        },
        {
          label: 'STL Home',
          click: () => mainWindow.webContents.send('open-stl-home')
        },
        {
          label: 'Slicer Path',
          click: () => mainWindow.webContents.send('open-slicer-settings')
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
          label: 'Backup/Restore',
          click: () => mainWindow.webContents.send('open-backup-restore')
        },
        {
          label: 'De-Dup',
          click: () => {
            mainWindow.webContents.send('open-dedup');
          }
        },
        {
          label: 'Tag Manager',
          click: () => mainWindow.webContents.send('open-tag-manager')
        },
        { type: 'separator' },
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
          label: 'Support Printventory',
          click: async () => {
            await shell.openExternal('https://printventory.com/support.html');
          }
        },
        {
          label: 'Discord',
          click: async () => {
            await shell.openExternal('https://discord.gg/JXcZHT77ua');
          }
        },
        { type: 'separator' },
        {
          label: 'Debug Console',
          click: () => mainWindow.webContents.openDevTools()
        },
        {
          label: 'About',
          click: async () => {
            // Send event to renderer to open the about dialog
            mainWindow.webContents.send('open-about');
            
            // Log for debugging
            console.log('About menu item clicked');
          }
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

// Update the calculateFileHash function to be more robust
async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('error', err => {
      console.error(`Error reading file for hashing: ${filePath}`, err);
      reject(err);
    });

    stream.on('data', chunk => {
      try {
        hash.update(chunk);
      } catch (err) {
        console.error(`Error updating hash for file: ${filePath}`, err);
        reject(err);
      }
    });

    stream.on('end', () => {
      try {
        const fileHash = hash.digest('hex');
        debugLog(`Generated hash for ${filePath}: ${fileHash}`);
        resolve(fileHash);
      } catch (err) {
        console.error(`Error generating final hash for file: ${filePath}`, err);
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

// Update the removeNonExistentFiles function
async function removeNonExistentFiles(scanDirectoryPath) {
  try {
    const allModels = db.prepare('SELECT filePath, id FROM models').all();
    let removedCount = 0;

    db.transaction(() => {
      for (const model of allModels) {
        // Only check files that are within the scanned directory
        const normalizedScanPath = normalizePath(scanDirectoryPath);
        const normalizedFilePath = normalizePath(model.filePath);
        if (normalizedFilePath.startsWith(normalizedScanPath)) {
          if (!fs.existsSync(model.filePath)) {
            // First delete from model_tags (child table)
            db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(model.id);
            
            // Then delete from models (parent table)
            db.prepare('DELETE FROM models WHERE id = ?').run(model.id);
            
            removedCount++;
          }
        }
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
    debugLog('Starting directory scan:', directoryPath);
    const maxFileSize = await getMaxFileSize();
    
    // First, remove any non-existent files from the scanned directory
    const removedCount = await removeNonExistentFiles(directoryPath);
    if (removedCount > 0) {
      event.sender.send('db-cleanup', {
        message: `Removed ${removedCount} non-existent files from directory ${directoryPath}`
      });
    }

    return new Promise((resolve, reject) => {
      // Create a worker for scanning
      const worker = new Worker(`
        const { parentPort, workerData } = require('worker_threads');
        const fs = require('fs');
        const path = require('path');
        const crypto = require('crypto');

        async function scanDirectory(directoryPath, maxFileSize) {
          const files = [];
          let totalFiles = 0;
          let processedFiles = 0;

          // Use a stack instead of recursion for better performance
          const directoryStack = [directoryPath];
          const seenDirs = new Set();

          while (directoryStack.length > 0) {
            const currentDir = directoryStack.pop();
            if (seenDirs.has(currentDir)) continue;
            seenDirs.add(currentDir);

            let entries;
            try {
              entries = fs.readdirSync(currentDir, { withFileTypes: true });
            } catch (err) {
              console.error(\`Skipping directory \${currentDir} due to error: \${err.message}\`);
              continue;
            }

            for (const entry of entries) {
              const fullPath = path.join(currentDir, entry.name);
              
              if (entry.isDirectory()) {
                // Skip system directories and __MACOSX
                if (entry.name.toLowerCase() === '__macosx' || 
                    /^(System Volume Information|\$Recycle\.Bin|Windows|Recovery|Boot|EFI)$/i.test(entry.name)) {
                  continue;
                }
                directoryStack.push(fullPath);
              } else {
                const ext = path.extname(entry.name).toLowerCase();
                if (ext === '.stl' || ext === '.3mf') {
                  try {
                    const stats = fs.statSync(fullPath);
                    if (stats.size <= maxFileSize) {
                      files.push({
                        filePath: fullPath,
                        fileName: entry.name,
                        size: stats.size,
                        mtime: stats.mtime
                      });
                    }
                  } catch (error) {
                    console.error(\`Error processing file \${fullPath}:\`, error);
                  }
                }
                processedFiles++;
                if (processedFiles % 100 === 0) {
                  parentPort.postMessage({ 
                    type: 'progress', 
                    processed: processedFiles 
                  });
                }
              }
            }
          }

          return { files, totalFiles: processedFiles };
        }

        parentPort.on('message', async ({ directoryPath, maxFileSize }) => {
          try {
            const result = await scanDirectory(directoryPath, maxFileSize);
            parentPort.postMessage({ type: 'done', result });
          } catch (error) {
            parentPort.postMessage({ type: 'error', error: error.message });
          }
        });
      `, { eval: true });

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
                filePath, fileName, hash, size, modifiedDate
              ) VALUES (?, ?, ?, ?, ?)
            `);

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
                    insertNew.run(
                      file.filePath,
                      file.fileName,
                      file.hash || '',
                      file.size,
                      file.mtime.toISOString()
                    );
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
            resolve({ files, totalFiles });
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
      worker.postMessage({ directoryPath, maxFileSize });
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
    
    // Verify the update
    if (key === 'CollectUsage') {
      const newValue = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value;
      console.log('CollectUsage - Verified new value in database:', newValue);
      
      // Force a sync to disk to ensure the change is persisted
      db.pragma('synchronous = FULL');
      db.pragma('journal_mode = WAL');
      db.prepare('PRAGMA wal_checkpoint(FULL)').run();
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
    shell.showItemInFolder(filePath);
    return true;
  } catch (error) {
    console.error('Error showing item in folder:', error);
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
  
  let menuItems = [
    {
      label: 'Open File',
      enabled: filePaths.length === 1,
      click: async () => {
        try {
          await shell.openPath(filePaths[0]);
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
          await shell.showItemInFolder(filePaths[0]);
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
  ];

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
  
  // Add "Open in Slicer" submenu if there are configured slicers
  if (slicers.length > 0) {
    const slicerSubmenu = {
      label: 'Open in Slicer',
      submenu: slicers.map(slicer => ({
        label: slicer.name,
        click: async () => {
          try {
            const { exec } = require('child_process');
            const modelPath = filePaths[0]; // Use the first file selected
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
            dialog.showMessageBox({
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
  
  // Add "Generate Tags" option if API key exists
  if (apiKey) {
    menuItems.push({
      label: 'Generate Tags',
      // Remove the restriction to only one file
      click: async () => {
        try {
          const aitagging = require('./aitagging');
          const settings = getSettings();
          
          // Initialize OpenAI with the API key
          aitagging.initializeOpenAI(settings.apiKey, settings.apiEndpoint, settings.aiService);
          
          // Show progress dialog for multiple files
          if (filePaths.length > 1) {
            event.sender.send('show-progress-dialog', {
              title: 'Generating Tags',
              message: `Generating tags for ${filePaths.length} models...`,
              total: filePaths.length
            });
          }
          
          // Process each file path
          for (let i = 0; i < filePaths.length; i++) {
            const filePath = filePaths[i];
            
            // Update progress for multiple files
            if (filePaths.length > 1) {
              event.sender.send('update-progress', {
                current: i + 1,
                total: filePaths.length,
                message: `Processing model ${i + 1} of ${filePaths.length}`
              });
            }
            
            // Get the model from the database to access its thumbnail
            const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
//            
            if (!model) {
              console.log(`Model not found in database: ${filePath}, skipping`);
              continue;
            }
            
            // Get the model tags from the database
            const modelTagRows = db.prepare(`
              SELECT t.name 
              FROM tags t
              JOIN model_tags mt ON mt.tag_id = t.id
              WHERE mt.model_id = ?
            `).all(model.id);
            
            const modelTags = modelTagRows.map(row => row.name);
            
            // Check if model already has the "AI Tagged" tag
            if (modelTags.includes("AI Tagged")) {
              console.log(`Model ${filePath} already has AI Tagged tag, skipping generation`);
              event.sender.send('tags-generated', filePath, []);
              continue;
            }
            
            if (!model.thumbnail) {
              // If no thumbnail exists, we need to generate one or use a default image
              console.log('No thumbnail found for model, using default image');
              try {
                
                const fs = require('fs').promises;
                const defaultImagePath = './logo.png'; // Use a default image that's guaranteed to be in PNG format
                const data = await fs.readFile(defaultImagePath, { encoding: 'base64' });
                const tags = await aitagging.generateTagsForImage(data, settings.aiModel);
                
                // Send the generated tags back to the renderer process
                event.sender.send('tags-generated', filePath, tags);
              } catch (error) {
                console.error(`Error generating tags with default image for ${filePath}:`, error);
                // Send an empty tags array to the renderer to continue processing
                event.sender.send('tags-generated', filePath, []);
              }
            } else {
              // Extract the base64 data from the thumbnail data URL
              // The thumbnail is stored as a data URL like: data:image/png;base64,BASE64_DATA
              const base64Data = model.thumbnail.split(',')[1];
              
              if (!base64Data) {
                console.error(`Invalid thumbnail format for ${filePath}`);
                continue; // Skip this file and continue with the next one
              }
              
              try {
                // We already retrieved the model tags earlier, so we can reuse them here
                if (modelTags.includes("AI Tagged")) {
                  console.log(`Model ${filePath} already has AI Tagged tag, skipping generation`);
                  event.sender.send('tags-generated', filePath, []);
                  continue;
                }
                
                // Generate tags using the thumbnail image which is already in PNG format
                const tags = await aitagging.generateTagsForImage(base64Data, settings.aiModel);
                
                // Send the generated tags back to the renderer process
                event.sender.send('tags-generated', filePath, tags);
              } catch (error) {
                console.error(`Error generating tags for ${filePath}:`, error);
                // Send an empty tags array to the renderer to continue processing
                event.sender.send('tags-generated', filePath, []);
              }
            }
          }
          
          // Close progress dialog for multiple files
          if (filePaths.length > 1) {
            event.sender.send('close-progress-dialog');
            
            // Show completion message
            dialog.showMessageBox({
              type: 'info',
              title: 'Tags Generated',
              message: `Successfully generated tags for ${filePaths.length} models.`
            });
          }
        } catch (error) {
          console.error('Error generating tags:', error);
          
          // Close progress dialog if open
          if (filePaths.length > 1) {
            event.sender.send('close-progress-dialog');
          }
          
          dialog.showMessageBox({
            type: 'error',
            title: 'Error',
            message: 'Could not generate tags',
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
        const confirm = await dialog.showMessageBox({
          type: 'warning',
          title: 'Confirm Remove',
          message: `Are you sure you want to remove ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} from the library?\nFiles will remain on disk but will be removed from Printventory.\n\nFiles:\n${filePaths.join('\n')}`,
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
        const confirm = await dialog.showMessageBox({
          type: 'warning',
          title: 'Confirm Delete',
          message: `Are you sure you want to DELETE ${filePaths.length} file${filePaths.length === 1 ? '' : 's'} from disk?\nThis will permanently delete the files and cannot be undone!\n\nFiles:\n${filePaths.join('\n')}`,
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
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) });
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
    } else { // Windows
      userDataPath = path.join(process.env.LOCALAPPDATA, 'Printventory', 'data');
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
ipcMain.handle('get3MFImages', async (event, filePath) => {
  // Skip files located in __MACOSX directories
  if (/[\\\/]__macosx[\\\/]/i.test(filePath)) {
    console.log('Skipping file from __MACOSX directory:', filePath);
    return null;
  }
  try {
    console.log('Starting to process 3MF file:', filePath);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('File does not exist:', filePath);
      return null;
    }
    
    // Use JSZip to extract the 3MF file (which is a zip file)
    console.log('Creating JSZip instance...');
    const zip = new JSZip();
    
    console.log('Reading file data...');
    const data = await fs.promises.readFile(filePath);
    console.log('File read successfully, size:', data.length, 'bytes');
    
    console.log('Loading zip contents...');
    const contents = await zip.loadAsync(data);
    console.log('Zip contents loaded successfully');
    
    // Log all files in the 3MF
    console.log('\nContents of 3MF file:', filePath);
    console.log('Number of files in archive:', Object.keys(contents.files).length);
    console.log('All files in archive:');
    Object.keys(contents.files).forEach(filename => {
      const file = contents.files[filename];
      console.log(' -', filename, file.dir ? '(directory)' : `(${file._data ? file._data.length : 0} bytes)`);
    });
    
    // Look for plate_1.png in the Metadata directory, trying different case variations
    const possiblePaths = [
      'Metadata/plate_1.png',
      'metadata/plate_1.png',
      '/Metadata/plate_1.png',
      '/metadata/plate_1.png'
    ];

    // Try each possible path
    console.log('\nSearching for plate_1.png...');
    for (const path of possiblePaths) {
      console.log('Checking for:', path);
      const plateImage = contents.files[path];
      if (plateImage) {
        console.log('Found plate_1.png at:', path);
        const imageData = await plateImage.async('base64');
        console.log('Successfully extracted plate_1.png data');
        return [`data:image/png;base64,${imageData}`];
      }
    }
    
    // If plate_1.png wasn't found, look for any images in the Metadata directory first
    console.log('\nLooking for any images in Metadata directory...');
    const imageFiles = [];
    for (const [path, file] of Object.entries(contents.files)) {
      // Check if file is in Metadata directory first
      if (path.toLowerCase().includes('metadata/') && path.match(/\.(png|jpe?g|gif)$/i)) {
        console.log('Found image in Metadata:', path);
        const imageData = await file.async('base64');
        imageFiles.push(`data:image/${path.split('.').pop()};base64,${imageData}`);
      }
    }

    // If no images found in Metadata, look elsewhere in the 3MF
    if (imageFiles.length === 0) {
      console.log('\nLooking for images anywhere in 3MF...');
      for (const [path, file] of Object.entries(contents.files)) {
        if (path.match(/\.(png|jpe?g|gif)$/i)) {
          console.log('Found image:', path);
          const imageData = await file.async('base64');
          imageFiles.push(`data:image/${path.split('.').pop()};base64,${imageData}`);
        }
      }
    }
    
    console.log('\nFound total images:', imageFiles.length);
    return imageFiles;
  } catch (error) {
    console.error('Error reading 3MF images:', error);
    console.error('Error details:', error.message);
    console.error('Error stack:', error.stack);
    return null;
  }
});

ipcMain.handle('get3MFSTL', async (event, filePath) => {
  try {
    const zip = new JSZip();
    const data = await fs.promises.readFile(filePath);
    const contents = await zip.loadAsync(data);
    
    // Look for STL files in the 3MF
    for (const [path, file] of Object.entries(contents.files)) {
      if (path.endsWith('.stl')) {
        // Extract to temp directory
        const tempPath = path.join(os.tmpdir(), `temp_${Date.now()}.stl`);
        await fs.promises.writeFile(tempPath, await file.async('nodebuffer'));
        return tempPath;
      }
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting STL from 3MF:', error);
    return null;
  }
});

// Add a new IPC handler for getting duplicates
ipcMain.handle('get-duplicates', async () => {
  try {
    // Get all models with their hashes
    const models = db.prepare(`
      SELECT filePath, fileName, hash, size 
      FROM models 
      WHERE hash IS NOT NULL
    `).all();

    // Group by hash to find duplicates
    const duplicates = models.reduce((acc, model) => {
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

// Add this IPC handler for thumbnails
ipcMain.handle('getThumbnail', async (event, filePath) => {
  try {
    const model = db.prepare('SELECT thumbnail FROM models WHERE filePath = ?').get(filePath);
    return model?.thumbnail || null;
  } catch (error) {
    console.error('Error getting thumbnail:', error);
    return null;
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
  return await aitagging.testAIConfig(apiKey, baseURL, model, service);
});

ipcMain.handle('generate-tags', async (event, filePath) => {
  try {
    const aitagging = require('./aitagging');
    const settings = getSettings();
    
    // Initialize OpenAI with the API key
    aitagging.initializeOpenAI(settings.apiKey, settings.apiEndpoint, settings.aiService);
    
    // Get the model from the database to access its thumbnail
    const model = db.prepare('SELECT * FROM models WHERE filePath = ?').get(filePath);
    
    // Check if model already has the "AI Tagged" tag
    if (model && model.tags && model.tags.includes("AI Tagged")) {
      console.log(`Model ${filePath} already has AI Tagged tag, skipping generation`);
      return [];
    }
    
    if (!model || !model.thumbnail) {
      // If no thumbnail exists, we need to generate one or use a default image
      console.log('No thumbnail found for model, using default image');
      try {
        const fs = require('fs').promises;
        const defaultImagePath = './logo.png'; // Use a default image that's guaranteed to be in PNG format
        const data = await fs.readFile(defaultImagePath, { encoding: 'base64' });
        const tags = await aitagging.generateTagsForImage(data, settings.aiModel);
        return tags;
      } catch (error) {
        console.error(`Error generating tags with default image:`, error);
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
      const tags = await aitagging.generateTagsForImage(base64Data, settings.aiModel);
      return tags;
    } catch (error) {
      console.error('Error generating tags:', error);
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
  return {
    apiKey: apiKeyRow ? apiKeyRow.value : null,
    apiEndpoint: apiEndpointRow ? apiEndpointRow.value : 'https://api.openai.com/v1',
    aiModel: aiModelRow ? aiModelRow.value : 'gpt-4o-mini',
    aiService: aiServiceRow ? aiServiceRow.value : 'openai'
  };
}

// Add or update this function to get models without thumbnails
ipcMain.handle('get-models-without-thumbnails', async () => {
  try {
    const modelsWithoutThumbnails = db.prepare(`
      SELECT filePath FROM models WHERE thumbnail IS NULL OR thumbnail = ''
    `).all();
    return modelsWithoutThumbnails;
  } catch (error) {
    console.error('Error fetching models without thumbnails:', error);
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
      
      // Track application start event
      await analytics.event(clientId, 'Application', 'Start', {
        evLabel: `Version ${version}`,
        evValue: 1
      });
      
      // Track active user
      await analytics.trackActiveUser(clientId);
      
      // Send a custom app_open event (instead of session_start which is automatically tracked)
      await analytics.sendGA4Event(clientId, 'app_open', {
        app_name: 'Printventory',
        app_version: version,
        os_platform: process.platform
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
          fileName,
          designer || null,
          source || null,
          notes || null,
          printed ? 1 : 0,
          parentModel || null,
          license || null,
          existingModel.id
        );
        
        modelId = existingModel.id;
      } else {
        // Insert new model
        console.log('Inserting new model');
        
        const insertStmt = db.prepare(`
          INSERT INTO models (
            filePath, fileName, designer, source, notes, printed, parentModel, license
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = insertStmt.run(
          filePath,
          fileName,
          designer || null,
          source || null,
          notes || null,
          printed ? 1 : 0,
          parentModel || null,
          license || null
        );
        
        modelId = result.lastInsertRowid;
      }
      
      console.log(`Model saved with ID: ${modelId}`);
    } catch (modelError) {
      console.error('Error saving model data:', modelError);
      throw modelError;
    }

    // Now handle tags in a separate transaction if we have a valid model ID
    if (modelId && tags && Array.isArray(tags) && tags.length > 0) {
      try {
        console.log(`Processing ${tags.length} tags for model ID ${modelId}`);
        
        // Double-check that the model exists before proceeding
        const modelExists = db.prepare('SELECT 1 FROM models WHERE id = ?').get(modelId);
        if (!modelExists) {
          console.error(`Model ID ${modelId} does not exist in the database. This should not happen.`);
          return { success: true, modelId }; // Return success but skip tag processing
        }
        
        // First, remove all existing tags for this model
        const deleteResult = db.prepare('DELETE FROM model_tags WHERE model_id = ?').run(modelId);
        console.log(`Deleted ${deleteResult.changes} existing tag relationships`);

        // Process each tag individually
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
      } catch (tagError) {
        console.error('Error updating tags:', tagError);
        // Continue with the save even if tag update fails
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