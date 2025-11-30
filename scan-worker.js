const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const StreamZip = require('node-stream-zip');

async function scanDirectory(directoryPath, maxFileSize, enableZipArchives = false) {
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
      console.error(`Skipping directory ${currentDir} due to error: ${err.message}`);
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
        
        // Handle regular STL/3MF files
        if (ext === '.stl' || ext === '.3mf') {
          try {
            const stats = fs.statSync(fullPath);
            if (stats.size <= maxFileSize) {
              files.push({
                filePath: fullPath,
                fileName: entry.name,
                size: stats.size,
                mtime: stats.mtime,
                isZipArchive: false
              });
            }
          } catch (error) {
            console.error(`Error processing file ${fullPath}:`, error);
          }
        }
        // Handle ZIP archives if enabled
        else if (enableZipArchives && ext === '.zip') {
          try {
            const stats = fs.statSync(fullPath);
            if (stats.size <= maxFileSize) {
              // Scan ZIP file for STL/3MF files
              const zipFiles = await scanZipFile(fullPath, maxFileSize);
              files.push(...zipFiles);
            }
          } catch (error) {
            console.error(`Error processing ZIP file ${fullPath}:`, error);
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

