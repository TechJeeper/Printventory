const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const StreamZip = require('node-stream-zip');

// Concurrency limit for file processing
const MAX_CONCURRENT_OPS = 50;

async function scanDirectory(directoryPath, maxFileSize, enableZipArchives = false) {
  const files = [];
  let totalFiles = 0;
  let processedFiles = 0;

  // Use a stack for directory traversal
  const directoryStack = [directoryPath];
  const seenDirs = new Set();

  // Processing queue for files
  const processingQueue = [];
  let activeOps = 0;

  // Function to process a single file entry
  const processFile = async (filePath, fileName) => {
    try {
      const stats = await fs.promises.stat(filePath);
      const ext = path.extname(fileName).toLowerCase();

      if ((ext === '.stl' || ext === '.3mf') && stats.size <= maxFileSize) {
        files.push({
          filePath,
          fileName,
          size: stats.size,
          mtime: stats.mtime,
          isZipArchive: false
        });
      } else if (enableZipArchives && ext === '.zip' && stats.size <= maxFileSize) {
        const zipFiles = await scanZipFile(filePath, maxFileSize);
        files.push(...zipFiles);
      }
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
    } finally {
      processedFiles++;
      if (processedFiles % 100 === 0) {
        parentPort.postMessage({
          type: 'progress',
          processed: processedFiles
        });
      }
    }
  };

  // Main loop
  while (directoryStack.length > 0 || processingQueue.length > 0 || activeOps > 0) {
    // Fill up active operations
    while (activeOps < MAX_CONCURRENT_OPS && processingQueue.length > 0) {
      const { filePath, fileName } = processingQueue.shift();
      activeOps++;
      processFile(filePath, fileName).then(() => {
        activeOps--;
      });
    }

    // Process directories if we have space or empty queue
    if (directoryStack.length > 0) {
      // Process a directory synchronously to discover files quickly
      // but don't block too long.
      const currentDir = directoryStack.pop();
      if (seenDirs.has(currentDir)) continue;
      seenDirs.add(currentDir);

      try {
        const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
        
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
            // Add file to queue
            processingQueue.push({ filePath: fullPath, fileName: entry.name });
          }
        }
      } catch (err) {
        console.error(`Skipping directory ${currentDir} due to error: ${err.message}`);
      }
    } else if (activeOps > 0) {
      // If no directories left but active ops, wait a bit
      await new Promise(resolve => setTimeout(resolve, 10));
    } else {
      // No directories, no active ops, no queue -> done
      break;
    }
  }

  return { files, totalFiles: processedFiles };
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
            files.push({
              filePath: zipPath,
              fileName: entry.name,
              size: entry.size,
              mtime: entry.time ? new Date(entry.time) : new Date(),
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
