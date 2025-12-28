const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');

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
    const zip = new StreamZip.async({ file: zipPath });
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

parentPort.on('message', async ({ directoryPath, maxFileSize, enableZipArchives }) => {
  try {
    const result = await scanDirectory(directoryPath, maxFileSize, enableZipArchives);
    parentPort.postMessage({ type: 'done', result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
});
