const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const StreamZip = require('node-stream-zip');

// Function to scan a zip file and find valid 3D model files
async function scanZipFile(zipPath, maxFileSize) {
  const files = [];
  try {
    const zip = new StreamZip.async({ file: zipPath });
    const entries = await zip.entries();

    for (const entry of Object.values(entries)) {
      if (!entry.isDirectory) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.stl' || ext === '.3mf') {
          // Check the size of the file INSIDE the zip
          if (entry.size <= maxFileSize) {
            console.log(`Found valid file in zip: ${entry.name}`);
            files.push({
              filePath: `${zipPath}:${entry.name}`,
              fileName: path.basename(entry.name),
              size: entry.size,
              mtime: entry.time ? new Date(entry.time) : new Date(),
              isZipArchive: true
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

// Function to recursively scan a directory
async function scanDirectory(directoryPath, maxFileSize, enableZipSupport) {
  const files = [];
  let totalFiles = 0;
  let processedFiles = 0;

  // Use a stack instead of recursion for better performance and to avoid stack overflow
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

        // Handle standard model files
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
            console.error(`Error processing file ${fullPath}:`, error);
          }
        }
        // Handle zip files if enabled
        else if (enableZipSupport && ext === '.zip') {
          try {
            // Note: We don't check the zip file size here, we check inner files in scanZipFile
            const zipFiles = await scanZipFile(fullPath, maxFileSize);
            files.push(...zipFiles);
          } catch (error) {
            console.error(`Error processing zip file ${fullPath}:`, error);
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

// Listen for messages from the main thread
parentPort.on('message', async ({ directoryPath, maxFileSize, enableZipSupport }) => {
  try {
    console.log(`Worker starting scan of ${directoryPath} with zip support: ${enableZipSupport}`);
    const result = await scanDirectory(directoryPath, maxFileSize, enableZipSupport);
    parentPort.postMessage({ type: 'done', result });
  } catch (error) {
    parentPort.postMessage({ type: 'error', error: error.message });
  }
});
