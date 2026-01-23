const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Module = require('module');

// We'll load StreamZip after receiving the node_modules path from the main process
let StreamZip = null;
let nodeModulesPath = null;

// Function to load StreamZip from the correct location
function loadStreamZip() {
  if (StreamZip) return StreamZip;
  
  try {
    // First try normal require (works when worker is in app directory)
    StreamZip = require('node-stream-zip');
    return StreamZip;
  } catch (error) {
    // If that fails, try to find it from the app's node_modules
    const possiblePaths = [];
    
    // Add the passed node_modules path if available (make it absolute)
    if (nodeModulesPath) {
      const absoluteNodeModules = path.isAbsolute(nodeModulesPath) 
        ? nodeModulesPath 
        : path.resolve(nodeModulesPath);
      possiblePaths.push(path.join(absoluteNodeModules, 'node-stream-zip'));
    }
    
    // Add common locations - use process.resourcesPath for built Electron apps
    const resourcesPath = process.resourcesPath || path.dirname(__dirname);
    possiblePaths.push(
      path.resolve(__dirname, '..', 'node_modules', 'node-stream-zip'),
      path.resolve(__dirname, '..', '..', 'node_modules', 'node-stream-zip'),
      path.resolve(resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-stream-zip'),
      path.resolve(resourcesPath, 'app.asar', 'node_modules', 'node-stream-zip'),
      path.resolve(resourcesPath, 'app', 'node_modules', 'node-stream-zip'),
      // Windows-specific paths
      path.resolve(path.dirname(resourcesPath), 'app.asar.unpacked', 'node_modules', 'node-stream-zip'),
      path.resolve(path.dirname(resourcesPath), 'Resources', 'app.asar.unpacked', 'node_modules', 'node-stream-zip')
    );
    
    // Try each path (normalize to absolute paths)
    for (let modulePath of possiblePaths) {
      // Normalize to absolute path
      if (!path.isAbsolute(modulePath)) {
        modulePath = path.resolve(modulePath);
      }
      
      if (fs.existsSync(modulePath)) {
        try {
          // Try requiring the directory (Node will resolve to index.js or main from package.json)
          // Use path.resolve to ensure we have an absolute path
          const resolvedPath = path.resolve(modulePath);
          StreamZip = require(resolvedPath);
          console.log(`[Worker] Loaded node-stream-zip from: ${resolvedPath}`);
          return StreamZip;
        } catch (requireError) {
          console.log(`[Worker] Failed to require ${modulePath}:`, requireError.message);
          // If directory require fails, try requiring the main file directly
          try {
            const packageJsonPath = path.join(modulePath, 'package.json');
            if (fs.existsSync(packageJsonPath)) {
              const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
              const mainFile = packageJson.main || 'index.js';
              const mainPath = path.resolve(modulePath, mainFile);
              if (fs.existsSync(mainPath)) {
                StreamZip = require(mainPath);
                console.log(`[Worker] Loaded node-stream-zip from main file: ${mainPath}`);
                return StreamZip;
              }
            }
          } catch (mainFileError) {
            console.log(`[Worker] Failed to load from main file:`, mainFileError.message);
            // Continue to next path
            continue;
          }
          // Continue to next path
          continue;
        }
      }
    }
    
    // Last resort: modify Module._nodeModulePaths to include the node_modules path
    if (nodeModulesPath && fs.existsSync(nodeModulesPath)) {
      const originalNodeModulePaths = Module._nodeModulePaths;
      const originalResolveFilename = Module._resolveFilename;
      
      // Modify both _nodeModulePaths and _resolveFilename for better compatibility
      Module._nodeModulePaths = function(from) {
        const paths = originalNodeModulePaths.call(this, from);
        if (!paths.includes(nodeModulesPath)) {
          paths.unshift(nodeModulesPath);
        }
        return paths;
      };
      
      // Also modify _resolveFilename as a fallback
      Module._resolveFilename = function(request, parent, isMain, options) {
        if (request === 'node-stream-zip') {
          const streamZipPath = path.join(nodeModulesPath, 'node-stream-zip');
          if (fs.existsSync(streamZipPath)) {
            try {
              const packageJsonPath = path.join(streamZipPath, 'package.json');
              if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                const mainFile = packageJson.main || 'index.js';
                const mainPath = path.join(streamZipPath, mainFile);
                if (fs.existsSync(mainPath)) {
                  return mainPath;
                }
              }
              return streamZipPath;
            } catch (e) {
              // Fall through to original resolver
            }
          }
        }
        return originalResolveFilename.call(this, request, parent, isMain, options);
      };
      
      try {
        StreamZip = require('node-stream-zip');
        Module._nodeModulePaths = originalNodeModulePaths;
        Module._resolveFilename = originalResolveFilename;
        console.log(`[Worker] Loaded node-stream-zip using modified Module paths from: ${nodeModulesPath}`);
        return StreamZip;
      } catch (requireError) {
        Module._nodeModulePaths = originalNodeModulePaths;
        Module._resolveFilename = originalResolveFilename;
        console.error(`[Worker] Failed to load node-stream-zip from ${nodeModulesPath}:`, requireError.message);
        console.error(`[Worker] Require error stack:`, requireError.stack);
        // Continue to throw error below
      }
    }
    
    // Log all attempted paths for debugging
    console.error(`[Worker] Cannot find node-stream-zip module. Worker location: ${__dirname}`);
    console.error(`[Worker] process.resourcesPath: ${process.resourcesPath || 'undefined'}`);
    console.error(`[Worker] nodeModulesPath: ${nodeModulesPath || 'undefined'}`);
    console.error(`[Worker] Tried paths:`);
    possiblePaths.forEach(p => {
      const exists = fs.existsSync(p);
      console.error(`[Worker]   ${p} - ${exists ? 'EXISTS' : 'NOT FOUND'}`);
    });
    
    throw new Error(`Cannot find node-stream-zip module. Worker location: ${__dirname}, resourcesPath: ${process.resourcesPath || 'undefined'}, nodeModulesPath: ${nodeModulesPath || 'undefined'}`);
  }
}

// Concurrency limit for file processing
const MAX_CONCURRENT_OPS = 50;

async function calculateFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
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
        resolve(fileHash);
      } catch (err) {
        console.error(`Error generating final hash for file: ${filePath}`, err);
        reject(err);
      }
    });
  });
}

async function scanDirectory(directoryPath, maxFileSize, enableZipArchives = false) {
  const files = [];
  let processedFiles = 0;

  // Use a simple queue system
  const queue = [{ type: 'dir', path: directoryPath }];
  const seenDirs = new Set();
  let activeOps = 0;

  // Promise to signal completion
  let resolveDone;
  const donePromise = new Promise(resolve => { resolveDone = resolve; });

  const processNext = () => {
    // If no active ops and queue is empty, we are done
    if (activeOps === 0 && queue.length === 0) {
      resolveDone({ files, totalFiles: processedFiles });
      return;
    }

    // While we have capacity and items in queue, start processing
    while (activeOps < MAX_CONCURRENT_OPS && queue.length > 0) {
      const item = queue.shift();
      activeOps++;

      if (item.type === 'dir') {
        processDirectory(item.path).finally(() => {
          activeOps--;
          processNext();
        });
      } else if (item.type === 'file') {
        processFile(item.path, item.name).finally(() => {
          activeOps--;
          processNext();
        });
      }
    }
  };

  const processDirectory = async (dirPath) => {
    if (seenDirs.has(dirPath)) return;
    seenDirs.add(dirPath);

    try {
      const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);

        if (entry.isDirectory()) {
          // Skip system directories and __MACOSX
          if (entry.name.toLowerCase() === '__macosx' ||
              /^(System Volume Information|\$Recycle\.Bin|Windows|Recovery|Boot|EFI)$/i.test(entry.name)) {
            continue;
          }
          // Prioritize files over directories to keep memory usage lower?
          // Actually directories first might discover more work faster.
          queue.push({ type: 'dir', path: fullPath });
        } else {
          queue.push({ type: 'file', path: fullPath, name: entry.name });
        }
      }
    } catch (err) {
      console.error(`Skipping directory ${dirPath} due to error: ${err.message}`);
    }
  };

  const processFile = async (filePath, fileName) => {
    try {
      // Check extension FIRST to avoid unnecessary stat() calls
      const ext = path.extname(fileName).toLowerCase();

      if (ext === '.stl' || ext === '.3mf') {
        // Only call stat() for valid 3D model files
        const stats = await fs.promises.stat(filePath);
        if (stats.size <= maxFileSize) {
          // Add file without hash calculation (calculate later if needed)
          files.push({
            filePath,
            fileName,
            size: stats.size,
            mtime: stats.mtime,
            hash: null, // Calculate later if needed
            isZipArchive: false
          });
        }
      } else if (enableZipArchives && ext === '.zip') {
        // ZIP files still need stat for size check
        const stats = await fs.promises.stat(filePath);
        if (stats.size <= maxFileSize) {
          const zipFiles = await scanZipFile(filePath, maxFileSize);
          files.push(...zipFiles);
        }
      }
      // For all other files, do nothing - no stat() call!
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    } finally {
      processedFiles++;
      // Report progress every 15 files instead of 100 for better responsiveness
      if (processedFiles % 15 === 0) {
        parentPort.postMessage({
          type: 'progress',
          processed: processedFiles
        });
      }
    }
  };

  // Start processing
  processNext();

  return donePromise;
}

  async function scanZipFile(zipPath, maxFileSize) {
    const files = [];
    try {
      // Ensure StreamZip is loaded
      const StreamZipClass = loadStreamZip();
      const zip = new StreamZipClass.async({ file: zipPath });
    const entries = await zip.entries();
    
    for (const entry of Object.values(entries)) {
      if (!entry.isDirectory) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.stl' || ext === '.3mf') {
          if (entry.size <= maxFileSize) {
            // Use double colon format: zipPath::entryPath
            const filePath = `${zipPath}::${entry.name}`;
            // For zip entries, we can't easily calculate hash without extracting
            // Hash will be calculated later when the file is accessed
            files.push({
              filePath: filePath,
              fileName: entry.name,
              size: entry.size,
              mtime: entry.time ? new Date(entry.time) : new Date(),
              hash: null, // Hash calculated on-demand for zip entries
              isZipArchive: true,
              zipEntryPath: entry.name,
              zip_path: entry.name
            });
          }
        }
      }
    }
    
    await zip.close();
  } catch (error) {
    console.error(`Error scanning ZIP file ${zipPath}:`, error);
  }
  
  return files;
}

parentPort.on('message', async ({ directoryPath, maxFileSize, enableZipArchives, nodeModulesPath: passedNodeModulesPath }) => {
  // Set the node_modules path if provided
  if (passedNodeModulesPath) {
    nodeModulesPath = passedNodeModulesPath;
    console.log(`[Worker] Received node_modules path: ${nodeModulesPath}`);
  }
  
  // Load StreamZip now that we have the path
  try {
    loadStreamZip();
    if (!StreamZip) {
      throw new Error('loadStreamZip() returned without setting StreamZip');
    }
  } catch (error) {
    console.error(`[Worker] Error loading node-stream-zip:`, error);
    console.error(`[Worker] Error stack:`, error.stack);
    parentPort.postMessage({ type: 'error', error: `Failed to load node-stream-zip: ${error.message}` });
    return;
  }
  try {
    const result = await scanDirectory(directoryPath, maxFileSize, enableZipArchives);
    parentPort.postMessage({ type: 'done', result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
});
