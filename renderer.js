// Add this at the very top of the file
const DEBUG = true; // Enable debugging temporarily

// Add debug logging utility function
function debugLog(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

let BATCH_SIZE = 50; // Default batch size for database operations
let MAX_FILE_SIZE_MB = 50; // Default max file size in MB
const THUMBNAIL_BATCH_SIZE = 10; // Default batch size for thumbnails
const MAX_CONCURRENT_RENDERS = 5; // Reduce from 5 to 1 to prevent context loss

const MAX_MODELS_IN_MEMORY = 500;
const PAGE_SIZE = 100; // Number of models to keep in memory
let allFilteredModels = []; // Store all filtered models (references only)
let visibleModels = []; // Store currently visible models (full data)
let currentGridView = 'detailed'; // Current grid view mode: 'list', 'preview', 'detailed'
let currentPage = 0;
let isVirtualScrolling = false; // Flag to track if virtual scrolling is active

const DEFAULT_SORT = 'dateAdded DESC'; // Show newest models by default

// RENDER_DELAY is already declared later in the file
let currentBatch = 0;
let isRendering = false;
let selectedModels = new Set();
let isMultiSelectMode = false;
let isScanning = false;

// Add these queue-related variables
let renderQueue = [];
let pendingThumbnails = new Set(); // Track files currently being rendered
let activeRenders = 0;
let isProcessingQueue = false;

// Add these at the top of the file
let isScanCancelled = false;
let isRenderCancelled = false;
let isBackgrounded = false;

// Add these at the top with other global variables
let RENDER_DELAY = 200; // Increase delay between renders to 200ms
let autoStartedRendering = false;
let thumbnailCache = new Map();
let sharedRenderer = null;
let renderContext = null;

// Define loadModel function at top level so it's available immediately (before DOMContentLoaded)
// Helper function to parse zip path format
function parseZipPath(filePath) {
  if (filePath.includes('::')) {
    const [zipPath, entryPath] = filePath.split('::');
    return { zipPath, entryPath, isZipEntry: true };
  }
  return { zipPath: filePath, entryPath: null, isZipEntry: false };
}

async function loadModel(filePath, options = {}) {
  const startTime = Date.now();
  console.log(`[DEBUG] loadModel: Start loading ${filePath}`);
  try {
    console.log('loadModel: Starting for file:', filePath);
    
    // Check if this is a zip entry
    const pathInfo = parseZipPath(filePath);
    let actualFilePath = filePath;
    let tempFilePath = null;
    
    if (pathInfo.isZipEntry) {
      console.log(`[DEBUG] loadModel: Detected zip entry, extracting to temp file`);
      try {
        // Extract to temp file
        actualFilePath = await window.electron.extractModelFromZip(filePath);
        tempFilePath = actualFilePath;
        console.log(`[DEBUG] loadModel: Extracted to temp file: ${actualFilePath}`);
      } catch (error) {
        console.error(`[DEBUG] loadModel: Error extracting zip entry: ${error}`);
        throw new Error(`Failed to extract model from zip: ${error.message}`);
      }
    }
    
    const fileExtension = actualFilePath.split('.').pop().toLowerCase();
    
    // For 3MF files, check for embedded images BEFORE 3D loading
    // NOTE: This is a safety check - renderModelToPNG should have already checked
    // and returned early if embedded images exist. This prevents unnecessary 3D loading.
    if (fileExtension === '3mf') {
      console.log(`[DEBUG] loadModel: Checking for embedded images in 3MF: ${actualFilePath}`);
      try {
        const images = await window.electron.get3MFImages(pathInfo.isZipEntry ? filePath : actualFilePath);
        if (images && images.length > 0) {
          console.log(`[DEBUG] loadModel: WARNING - Found embedded image in 3MF but loadModel was still called for ${filePath}`);
          console.log(`[DEBUG] loadModel: Returning null to skip 3D loading - embedded image should be used instead`);
          // Note: Temp file cleanup handled by OS
          // Return null to skip 3D loading - embedded image should be used instead
          return null;
        } else {
          console.log(`[DEBUG] loadModel: No embedded images found, proceeding with 3D loading for ${filePath}`);
        }
      } catch (imageError) {
        console.error(`[DEBUG] loadModel: Error checking for embedded image: ${imageError}`);
        // Continue with 3D loading if there's an error checking for images
      }
    }
    
    // Check if we're in server mode - use HTTP endpoint instead of file://
    const serverMode = await window.electron.isServerMode().catch(() => false);
    
    let encodedFilePath;
    
    if (serverMode) {
      // In server mode, use HTTP endpoint for UNC paths
      // Encode the path for URL
      const encodedPath = encodeURIComponent(actualFilePath);
      encodedFilePath = `/api/file/${encodedPath}`;
      console.log('loadModel: Using HTTP endpoint for server mode:', encodedFilePath);
    } else if (/^[A-Za-z]:/.test(actualFilePath)) {
      // Check if we're running on Windows (starts with drive letter)
      // For Windows paths: 
      // 1. Convert backslashes to forward slashes
      // 2. Add file:/// protocol
      // 3. Properly encode special characters
      
      try {
        // First normalize the path to use forward slashes
        const normalizedPath = actualFilePath.replace(/\\/g, '/');
        
        // Create URL object for proper handling - this works better for Windows paths
        const fileUrl = new URL(`file:///${normalizedPath}`);
        
        // Get the properly encoded pathname from the URL
        encodedFilePath = fileUrl.href;
        
        // Explicitly handle hash character in path segments
        if (normalizedPath.includes('#')) {
          // Replace the hash character with its URL encoding (%23)
          // But ensure we don't double-encode anything
          encodedFilePath = encodedFilePath.replace(/#/g, '%23');
        }
        
        // Ensure other problematic characters are properly encoded
        encodedFilePath = encodedFilePath
          .replace(/\?/g, '%3F')
          .replace(/\s/g, '%20')
          .replace(/\(/g, '%28')
          .replace(/\)/g, '%29')
          .replace(/'/g, '%27')
          .replace(/\[/g, '%5B')
          .replace(/\]/g, '%5D');
      } catch (error) {
        console.error('Error creating URL from file path:', error);
        
        // Fallback method: direct string replacement
        const normalizedPath = actualFilePath.replace(/\\/g, '/');
        encodedFilePath = `file:///${normalizedPath}`
            .replace(/#/g, '%23')
            .replace(/\s/g, '%20');
      }
      
      console.log('loadModel: Encoded Windows path:', encodedFilePath);
    } else {
      // For non-Windows paths, use a direct encoding approach
      try {
        const normalizedPath = actualFilePath.replace(/\\/g, '/');
        
        // Simply replace problematic characters directly
        encodedFilePath = `file://${normalizedPath}`
            .replace(/#/g, '%23')
            .replace(/\s/g, '%20')
            .replace(/\(/g, '%28')
            .replace(/\)/g, '%29')
            .replace(/'/g, '%27')
            .replace(/\[/g, '%5B')
            .replace(/\]/g, '%5D');
      } catch (error) {
        console.error('Error encoding non-Windows file path:', error);
        // Super simple fallback
        encodedFilePath = `file://${actualFilePath.replace(/#/g, '%23')}`;
      }
      console.log('loadModel: Encoded Unix path:', encodedFilePath);
    }
    
    // If no embedded image found, proceed with 3D loading
    let loader;
    if (fileExtension === 'stl') {
      if (!THREE.STLLoader) {
        console.error('loadModel: THREE.STLLoader not available');
        throw new Error('THREE.STLLoader not initialized');
      }
      loader = new THREE.STLLoader();
    } else if (fileExtension === '3mf') {
      if (!THREE.ThreeMFLoader) {
        console.error('loadModel: THREE.ThreeMFLoader not available');
        throw new Error('THREE.ThreeMFLoader not initialized');
      }
      if (!fflate) {
        console.error('loadModel: fflate not available');
        throw new Error('fflate not initialized');
      }
      THREE.ThreeMFLoader.fflate = fflate;
      loader = new THREE.ThreeMFLoader();
    } else {
      throw new Error(`Unsupported file type: ${fileExtension}`);
    }

    if (!loader) {
      throw new Error('Failed to initialize loader');
    }

    return new Promise((resolve, reject) => {
      try {
        loader.load(
            encodedFilePath, // Use the encoded path instead of the original
            (object) => {
              try {
                let mesh;
                if (object.isBufferGeometry) {
                  if (!THREE.MeshPhongMaterial) {
                    console.error('loadModel: THREE.MeshPhongMaterial not available');
                    throw new Error('THREE.MeshPhongMaterial not initialized');
                  }
                  const material = new THREE.MeshPhongMaterial({
                    color: 0xcccccc,
                    specular: 0x111111,
                    shininess: 200
                  });
                  if (!THREE.Mesh) {
                    console.error('loadModel: THREE.Mesh not available');
                    throw new Error('THREE.Mesh not initialized');
                  }
                  
                  // Proper geometry centering instead of normalization
                  object.computeBoundingBox();
                  object.center();
                  object.computeVertexNormals();
                  
                  mesh = new THREE.Mesh(object, material);
                  
                  if (fileExtension === 'stl') {
                    mesh.rotation.x = -Math.PI / 2;
                  }
                } else if (object.isObject3D) {
                  mesh = object;
                  mesh.traverse((child) => {
                    if (child.isMesh) {
                      // Ensure geometry has normals for proper lighting
                      if (child.geometry && !child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                      }
                      
                      // Handle both single materials and material arrays
                      // Create new material with explicit color to override any black/default materials
                      const newMaterial = new THREE.MeshPhongMaterial({
                        color: 0xcccccc,
                        specular: 0x111111,
                        shininess: 200
                      });
                      
                      if (Array.isArray(child.material)) {
                        child.material = child.material.map(() => newMaterial.clone());
                      } else {
                        child.material = newMaterial;
                      }
                    }
                  });
                  if (fileExtension === '3mf') {
                    mesh.rotation.x = -Math.PI / 2;
                  }
                } else {
                  reject(new Error('Unsupported object type'));
                  return;
                }
                resolve(mesh);
              } catch (error) {
                console.error('loadModel: Error processing loaded object:', error);
                // Note: Temp file cleanup handled by OS
                reject(error);
              }
            },
            (progress) => {
              // Progress callback
            },
            (error) => {
              console.error('loadModel: Loader error:', error);
              // Clean up temp file on error
              if (tempFilePath) {
                window.electron.deleteTempFile?.(tempFilePath).catch(cleanupError => {
                  console.error('Error cleaning up temp file:', cleanupError);
                });
              }
              reject(error);
            }
        );
      } catch (error) {
        console.error('loadModel: Error in loader.load:', error);
        // Note: Temp file cleanup handled by OS
        reject(error);
      }
    });
  } catch (error) {
    console.error('loadModel error:', error);
    throw error;
  } finally {
    const endTime = Date.now();
    console.log(`[DEBUG] loadModel: Finished loading ${filePath}. Took ${endTime - startTime}ms.`);
    // Note: Temp file cleanup is handled by OS or on next extraction
    // We don't delete immediately as the file may still be in use by Three.js
  }
}

// Make loadModel available globally
window.loadModel = loadModel;

// Add these variables at the top
let totalThumbnailsToGenerate = 0;
let generatedThumbnailsCount = 0;

// Add WebGL context management variables
let sharedScene = null;
let sharedCamera = null;
let contextUseCount = 0;
const MAX_CONTEXT_USES = 20; // Reset context after this many uses
const MAX_CONTEXT_REUSE_COUNT = 100; // Add this missing constant

// Add these functions near the top of the file
async function updateModelCounts(viewCount) {
  try {
    // Update view count (for models currently visible in the grid)
    const viewElement = document.getElementById('view-count');
    if (viewElement) {
      viewElement.textContent = `${viewCount} model${viewCount !== 1 ? 's' : ''} in view`;
    }

    // Get the total count from the database using the new IPC handler
    const totalCount = await window.electron.getTotalModelCount();
    
    // Update the total count element
    const totalElement = document.getElementById('total-count');
    if (totalElement) {
      totalElement.textContent = `${totalCount} model${totalCount !== 1 ? 's' : ''} total`;
    }

  } catch (error) {
    console.error('Error updating model counts:', error);
  }
}

// Helper function to normalize paths for comparison
// This handles URL encoding, path separators, and whitespace differences
function normalizePathForComparison(path) {
  if (!path) return '';
  // Decode URL encoding if present
  let normalized = path;
  try {
    normalized = decodeURIComponent(normalized);
  } catch (e) {
    // If decoding fails, use original path
  }
  // Normalize path separators (both forward and back slashes)
  normalized = normalized.replace(/\\/g, '/');
  // Trim whitespace
  normalized = normalized.trim();
  return normalized;
}

async function updateModelElement(filePath) {
  try {
    // Small delay to ensure database is updated
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const model = await window.electron.getModel(filePath);
    if (!model) {
      console.warn('updateModelElement: Model not found for', filePath);
      return;
    }
    console.log('updateModelElement: Updating element for', filePath, 'with model data:', {
      designer: model.designer,
      source: model.source,
      parentModel: model.parentModel,
      license: model.license,
      tags: model.tags
    });

    // Check current filter values
    const designer = document.getElementById('designer-select')?.value || '';
    const license = document.getElementById('license-select')?.value || ''; 
    const parentModel = document.getElementById('parent-select')?.value || '';
    const printStatus = document.getElementById('printed-select')?.value || 'all';
    const fileType = document.getElementById('filetype-select')?.value || '';
    const searchTerm = document.getElementById('search-filter-input')?.value.trim() || '';
    
    // Check if the model matches current filters
    let shouldBeVisible = true;
    
    if (designer) {
      if (designer === '__none__') {
        shouldBeVisible = !model.designer || model.designer.trim() === '';
      } else {
        shouldBeVisible = model.designer && 
          model.designer.trim().toLowerCase() === designer.trim().toLowerCase();
      }
    }
    
    if (shouldBeVisible && license) {
      if (license === '__none__') {
        shouldBeVisible = !model.license || model.license.trim() === '';
      } else {
        shouldBeVisible = model.license === license;
      }
    }
    
    if (shouldBeVisible && parentModel) {
      if (parentModel === '__none__') {
        shouldBeVisible = !model.parentModel || model.parentModel.trim() === '';
      } else {
        shouldBeVisible = model.parentModel === parentModel;
      }
    }
    
    if (shouldBeVisible && printStatus === 'printed') {
      shouldBeVisible = model.printed;
    } else if (shouldBeVisible && printStatus === 'not-printed') {
      shouldBeVisible = !model.printed;
    }
    
    // Check file type filter
    if (shouldBeVisible && fileType) {
      if (fileType.toLowerCase() === 'zip') {
        shouldBeVisible = model.filePath && model.filePath.includes('::');
      } else {
        const fileName = model.fileName || '';
        shouldBeVisible = fileName.toLowerCase().endsWith(`.${fileType.toLowerCase()}`);
      }
    }
    
    // Check search term filter
    if (shouldBeVisible && searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      const fileName = (model.fileName || '').toLowerCase();
      const filePath = (model.filePath || '').toLowerCase();
      const modelDesigner = (model.designer || '').toLowerCase();
      const modelSource = (model.source || '').toLowerCase();
      const modelLicense = (model.license || '').toLowerCase();
      const modelParent = (model.parentModel || '').toLowerCase();
      
      shouldBeVisible = fileName.includes(searchLower) ||
                       filePath.includes(searchLower) ||
                       modelDesigner.includes(searchLower) ||
                       modelSource.includes(searchLower) ||
                       modelLicense.includes(searchLower) ||
                       modelParent.includes(searchLower);
    }

    // Find existing element by iterating through all file items
    // This avoids CSS escaping issues with special characters in file paths
    const allFileItems = document.querySelectorAll('.file-item');
    let existingElement = null;
    
    // Normalize the target file path for comparison
    const normalizedTargetPath = normalizePathForComparison(filePath);
    
    for (const item of allFileItems) {
      const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
      // Normalize both paths before comparison
      const normalizedItemPath = normalizePathForComparison(itemPath);
      if (normalizedItemPath === normalizedTargetPath) {
        existingElement = item;
        break;
      }
    }
    
    if (!existingElement) {
      console.warn('updateModelElement: Element not found for path:', filePath);
      debugLog('Element not found for path:', filePath);
      return;
    }
    
    // Check if we're in detailed view
    const isDetailedView = existingElement.classList.contains('file-item-detailed');
    console.log('updateModelElement: isDetailedView?', isDetailedView);
    
    // Check if we're in preview or list view (needed early to prevent removing elements)
    const isPreviewView = existingElement.classList.contains('file-item-preview') || currentGridView === 'preview';
    const isListView = existingElement.classList.contains('file-item-list') || currentGridView === 'list';

    // If the model no longer matches the current filters, remove it from the grid
    if (!shouldBeVisible) {
      // Remove from multi-select if selected
      if (isMultiSelectMode && selectedModels.has(filePath)) {
        selectedModels.delete(filePath);
        existingElement.classList.remove('selected');
        updateSelectedCount();
      }
      
      // Remove the model from currentModels array so virtual grid knows it's gone
      const container = document.querySelector('.file-grid');
      if (container && container.currentModels) {
        const modelIndex = container.currentModels.findIndex(m => 
          (m.id || m.filePath) === (model.id || model.filePath)
        );
        if (modelIndex !== -1) {
          container.currentModels.splice(modelIndex, 1);
          
          // Recalculate field analysis since a model was removed
          if (container.currentModels.length > 0) {
            window.modelFieldAnalysis = analyzeModelFields(container.currentModels);
          }
        }
      }
      
      // Remove the element from DOM
      existingElement.remove();
      
      // Trigger virtual grid refresh to reflow remaining items
      if (container && container.renderVisibleItemsFn) {
        requestAnimationFrame(() => {
          container.renderVisibleItemsFn();
        });
      }
      
      // Update model count
      if (container && container.currentModels) {
        updateModelCounts(container.currentModels.length);
      }
      
      return;
    } else {
      existingElement.style.display = '';
    }

    // Update model details
    const nameElement = existingElement.querySelector('.file-name');
    if (nameElement) {
      // Extract file name from path if fileName is not available
      let displayFileName = model.fileName;
      if (!displayFileName && model.filePath) {
        if (model.filePath.includes('::')) {
          // Zip entry: extract filename from entry path
          const entryPath = model.filePath.split('::')[1];
          displayFileName = entryPath.split(/[/\\]/).pop() || 'Unknown';
        } else {
          // Regular file: extract filename from path
          displayFileName = model.filePath.split(/[/\\]/).pop() || 'Unknown';
        }
      }
      if (!displayFileName) {
        displayFileName = 'Unknown';
      }
      nameElement.textContent = displayFileName;
    }

    // Update print status - make sure to match the class/structure used in renderFile
    const printStatusElement = existingElement.querySelector('.print-status');
    if (printStatusElement) {
      printStatusElement.textContent = model.printed ? 'Printed' : 'Not Printed';
      if (model.printed) {
        printStatusElement.classList.add('printed');
      } else {
        printStatusElement.classList.remove('printed');
      }
    } else {
      // If print status element doesn't exist, create it
      const statusElement = document.createElement('div');
      statusElement.className = `print-status${model.printed ? ' printed' : ''}`;
      statusElement.textContent = model.printed ? 'Printed' : 'Not Printed';
      statusElement.style.cursor = 'pointer';
      statusElement.title = 'Click to toggle printed status';
      
      // Add click handler to toggle printed status
      statusElement.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation(); // Prevent triggering file item click
        
        // Get current model to check printed status
        const currentModel = await window.electron.getModel(filePath);
        if (currentModel) {
          const newPrintedStatus = !currentModel.printed;
          await autoSaveModel('printed', newPrintedStatus, filePath);
        }
      });
      
      existingElement.appendChild(statusElement);
    }
    
    // Remove any existing designer info elements that might have been added (redundant with metadata)
    // Designer is already shown in the metadata section, so we don't need it here
    const fileInfo = existingElement.querySelector('.file-info');
    if (fileInfo) {
      // Only remove designer-info elements if we're NOT in list view
      // In list view, designer-info is inside designer-info-column and should be updated, not removed
      if (!isListView) {
        const existingDesignerElements = fileInfo.querySelectorAll('.designer-info');
        existingDesignerElements.forEach(el => el.remove());
      }
    }
    
    // Update metadata in detailed view grid (only if in detailed view)
    const metadataContainer = existingElement.querySelector('.metadata-container');
    console.log('updateModelElement: metadataContainer found?', !!metadataContainer, 'isDetailedView?', isDetailedView, 'element classes:', existingElement.className);
    
    // Also check if the current view mode is detailed (in case class check fails)
    const currentViewIsDetailed = currentGridView === 'detailed';
    console.log('updateModelElement: currentGridView is detailed?', currentViewIsDetailed);
    
    // isListView and isPreviewView are already defined above
    
    if (metadataContainer && (isDetailedView || currentViewIsDetailed)) {
      // Update designer
      const designerItem = metadataContainer.querySelector('.designer-item');
      console.log('updateModelElement: designerItem found?', !!designerItem);
      if (designerItem) {
        const designerValue = (model.designer && model.designer.trim()) ? model.designer.trim() : '';
        const hasDesigner = designerValue && designerValue !== '';
        console.log('updateModelElement: designerValue =', designerValue, 'hasDesigner =', hasDesigner);
        let designerValueSpan = designerItem.querySelector('.metadata-value.designer-info');
        console.log('updateModelElement: designerValueSpan found?', !!designerValueSpan);
        if (!designerValueSpan) {
          // If the span doesn't exist, create it
          console.log('Creating missing designer value span');
          designerValueSpan = document.createElement('span');
          designerValueSpan.className = 'metadata-value designer-info';
          designerValueSpan.style.display = 'inline-block';
          // Find the icon and insert after it
          const iconSpan = designerItem.querySelector('.metadata-icon');
          if (iconSpan) {
            // Insert after the icon
            if (iconSpan.nextSibling) {
              iconSpan.parentNode.insertBefore(designerValueSpan, iconSpan.nextSibling);
            } else {
              iconSpan.parentNode.appendChild(designerValueSpan);
            }
          } else {
            designerItem.appendChild(designerValueSpan);
          }
        }
        if (designerValueSpan) {
          designerValueSpan.textContent = hasDesigner ? designerValue : '—';
          designerValueSpan.style.color = hasDesigner ? '#ccc' : '#666';
          designerValueSpan.setAttribute('title', hasDesigner ? designerValue : '');
          console.log('updateModelElement: Updated designer to', designerValueSpan.textContent);
        }
        // Update clickability
        if (hasDesigner) {
          designerItem.style.cursor = 'pointer';
          designerItem.classList.add('clickable-metadata');
          // Re-add click handler
          designerItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const designerSelect = document.getElementById('designer-select');
            if (designerSelect) {
              designerSelect.value = designerValue;
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              }
            }
          };
        } else {
          designerItem.style.cursor = 'default';
          designerItem.classList.remove('clickable-metadata');
          designerItem.onclick = null;
        }
      }
      
      // Update source
      const sourceItem = metadataContainer.querySelector('.source-item');
      if (sourceItem) {
        const sourceValue = model.source || '';
        let sourceValueSpan = sourceItem.querySelector('.metadata-value.source-info');
        if (!sourceValueSpan) {
          // Create the span if it doesn't exist
          sourceValueSpan = document.createElement('span');
          sourceValueSpan.className = 'metadata-value source-info';
          const iconSpan = sourceItem.querySelector('.metadata-icon');
          if (iconSpan) {
            iconSpan.parentNode.insertBefore(sourceValueSpan, iconSpan.nextSibling);
          } else {
            sourceItem.appendChild(sourceValueSpan);
          }
        }
        if (sourceValueSpan) {
          sourceValueSpan.textContent = sourceValue || '—';
          sourceValueSpan.style.color = sourceValue ? '#ccc' : '#666';
          sourceValueSpan.setAttribute('title', sourceValue || '');
          console.log('updateModelElement: Updated source to', sourceValueSpan.textContent);
        }
      } else {
      }
      
      // Update parent model
      const parentItem = metadataContainer.querySelector('.parent-item');
      if (parentItem) {
        const parentValue = model.parentModel || '';
        let parentValueSpan = parentItem.querySelector('.metadata-value.parent-info');
        if (!parentValueSpan) {
          // Create the span if it doesn't exist
          parentValueSpan = document.createElement('span');
          parentValueSpan.className = 'metadata-value parent-info';
          const iconSpan = parentItem.querySelector('.metadata-icon');
          if (iconSpan) {
            iconSpan.parentNode.insertBefore(parentValueSpan, iconSpan.nextSibling);
          } else {
            parentItem.appendChild(parentValueSpan);
          }
        }
        if (parentValueSpan) {
          parentValueSpan.textContent = parentValue || '—';
          parentValueSpan.style.color = parentValue ? '#ccc' : '#666';
          parentValueSpan.setAttribute('title', parentValue || '');
          console.log('updateModelElement: Updated parentModel to', parentValueSpan.textContent);
        }
        // Update clickability
        if (parentValue) {
          parentItem.style.cursor = 'pointer';
          parentItem.classList.add('clickable-metadata');
          // Re-add click handler
          parentItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const parentSelect = document.getElementById('parent-select');
            if (parentSelect) {
              parentSelect.value = parentValue;
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              }
            }
          };
        } else {
          parentItem.style.cursor = 'default';
          parentItem.classList.remove('clickable-metadata');
          parentItem.onclick = null;
        }
      }
      
      // Update license
      const licenseItem = metadataContainer.querySelector('.license-item');
      if (licenseItem) {
        const licenseValue = model.license || '';
        let licenseValueSpan = licenseItem.querySelector('.metadata-value.license-info');
        if (!licenseValueSpan) {
          // Create the span if it doesn't exist
          licenseValueSpan = document.createElement('span');
          licenseValueSpan.className = 'metadata-value license-info';
          const iconSpan = licenseItem.querySelector('.metadata-icon');
          if (iconSpan) {
            iconSpan.parentNode.insertBefore(licenseValueSpan, iconSpan.nextSibling);
          } else {
            licenseItem.appendChild(licenseValueSpan);
          }
        }
        if (licenseValueSpan) {
          licenseValueSpan.textContent = licenseValue || '—';
          licenseValueSpan.style.color = licenseValue ? '#ccc' : '#666';
          licenseValueSpan.setAttribute('title', licenseValue || '');
          console.log('updateModelElement: Updated license to', licenseValueSpan.textContent);
        }
        // Update clickability
        if (licenseValue) {
          licenseItem.style.cursor = 'pointer';
          licenseItem.classList.add('clickable-metadata');
          // Re-add click handler
          licenseItem.onclick = async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const licenseSelect = document.getElementById('license-select');
            if (licenseSelect) {
              licenseSelect.value = licenseValue;
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              }
            }
          };
        } else {
          licenseItem.style.cursor = 'default';
          licenseItem.classList.remove('clickable-metadata');
          licenseItem.onclick = null;
        }
      }
      
      // Update tags
      const tagsItem = metadataContainer.querySelector('.tags-item');
      if (tagsItem) {
        let tagsDisplay = '';
        if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
          const tagNames = model.tags.map(t => t.name || t);
          tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
          tagsDisplay = tagNames.join(', ');
        } else if (model.id) {
          // Load tags asynchronously if not present
          window.electron.getModelTags(model.id).then(tags => {
            if (tags && tags.length > 0) {
              const tagNames = tags.map(t => t.name || t);
              tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
              const tagsText = tagNames.join(', ');
              const tagsValueSpan = tagsItem.querySelector('.metadata-value.tags-info');
              if (tagsValueSpan) {
                tagsValueSpan.textContent = tagsText;
                tagsValueSpan.setAttribute('title', tagsText);
                tagsValueSpan.style.color = '#ccc';
              }
            }
          }).catch(err => console.error('Error loading tags:', err));
        }
        const tagsValueSpan = tagsItem.querySelector('.metadata-value.tags-info');
        if (tagsValueSpan) {
          tagsValueSpan.textContent = tagsDisplay || '—';
          tagsValueSpan.style.color = tagsDisplay ? '#ccc' : '#666';
          tagsValueSpan.setAttribute('title', tagsDisplay || '');
        } else {
          console.warn('Tags value span not found in tags item');
        }
      }
    } else if (isDetailedView || currentViewIsDetailed) {
      // Only warn if we're in detailed view but metadata container is missing
      // This shouldn't happen in detailed view, so it's a real issue
      console.warn('Metadata container not found for element in detailed view:', existingElement);
    }
    // For preview and list views, metadata container is expected to be missing, so no warning
    
    // Update fields in LIST mode
    // isListView is already declared above, reuse it
    if (isListView && fileInfo) {
      console.log('updateModelElement: Updating list view fields, fileInfo:', fileInfo);
      console.log('updateModelElement: Model designer value:', model.designer);
      
      // Update designer in list view
      // The designer is inside .designer-info-column > .designer-info
      const designerColumn = fileInfo.querySelector('.designer-info-column');
      console.log('updateModelElement: designerColumn found?', !!designerColumn);
      if (designerColumn) {
        const designerElement = designerColumn.querySelector('.designer-info');
        console.log('updateModelElement: designerElement found?', !!designerElement);
        if (designerElement) {
          const designerValue = model.designer || '';
          designerElement.textContent = designerValue;
          designerElement.style.color = designerValue ? '#aaa' : '#666';
          console.log('updateModelElement: Updated designer in list view to', designerValue);
        } else {
          console.warn('updateModelElement: .designer-info not found inside .designer-info-column');
          // Try to find it directly as fallback
          const directDesignerElement = fileInfo.querySelector('.designer-info');
          if (directDesignerElement) {
            console.log('updateModelElement: Found .designer-info directly, updating');
            const designerValue = model.designer || '';
            directDesignerElement.textContent = designerValue;
            directDesignerElement.style.color = designerValue ? '#aaa' : '#666';
          }
        }
      } else {
        console.warn('updateModelElement: .designer-info-column not found in list view');
        // Try to find it directly as fallback
        const directDesignerElement = fileInfo.querySelector('.designer-info');
        if (directDesignerElement) {
          console.log('updateModelElement: Found .designer-info directly (fallback), updating');
          const designerValue = model.designer || '';
          directDesignerElement.textContent = designerValue;
          directDesignerElement.style.color = designerValue ? '#aaa' : '#666';
        } else {
          console.warn('updateModelElement: .designer-info not found anywhere in fileInfo');
          console.log('updateModelElement: fileInfo children:', Array.from(fileInfo.children).map(c => c.className));
        }
      }
      
      // Update license in list view (if it exists - license column may not be present in all list views)
      const licenseElement = fileInfo.querySelector('.license-info');
      if (licenseElement) {
        const licenseValue = model.license || '';
        licenseElement.textContent = licenseValue;
        licenseElement.style.color = licenseValue ? '#aaa' : '#666';
        console.log('updateModelElement: Updated license in list view to', licenseValue);
      }
      
      // Update tags in list view
      // The tags are inside .tags-info-column > .tags-info
      const tagsColumn = fileInfo.querySelector('.tags-info-column');
      if (tagsColumn) {
        const tagsElement = tagsColumn.querySelector('.tags-info');
        if (tagsElement) {
          let tagsDisplay = '';
          if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
            // Handle both object format (with .name) and string format
            const tagNames = model.tags.map(t => t.name || t);
            tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
            tagsDisplay = tagNames.join(', ');
          } else if (model.id) {
            // Load tags asynchronously if not present
            window.electron.getModelTags(model.id).then(tags => {
              if (tags && tags.length > 0) {
                const tagNames = tags.map(t => t.name || t);
                tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
                const tagsText = tagNames.join(', ');
                tagsElement.textContent = tagsText;
                tagsElement.style.color = '#aaa';
              } else {
                tagsElement.textContent = '—';
                tagsElement.style.color = '#666';
              }
            }).catch(err => console.error('Error loading tags:', err));
            return; // Early return since we're loading tags asynchronously
          } else {
            tagsDisplay = '—';
          }
          tagsElement.textContent = tagsDisplay;
          tagsElement.style.color = tagsDisplay && tagsDisplay !== '—' ? '#aaa' : '#666';
          console.log('updateModelElement: Updated tags in list view to', tagsDisplay);
        } else {
          console.warn('updateModelElement: .tags-info not found inside .tags-info-column');
        }
      } else {
        // Fallback: try direct query in case structure is different
        const tagsElement = fileInfo.querySelector('.tags-info');
        if (tagsElement) {
          let tagsDisplay = '';
          if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
            const tagNames = model.tags.map(t => t.name || t);
            tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
            tagsDisplay = tagNames.join(', ');
          } else if (model.id) {
            window.electron.getModelTags(model.id).then(tags => {
              if (tags && tags.length > 0) {
                const tagNames = tags.map(t => t.name || t);
                tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
                const tagsText = tagNames.join(', ');
                tagsElement.textContent = tagsText;
                tagsElement.style.color = '#aaa';
              } else {
                tagsElement.textContent = '—';
                tagsElement.style.color = '#666';
              }
            }).catch(err => console.error('Error loading tags:', err));
            return;
          } else {
            tagsDisplay = '—';
          }
          tagsElement.textContent = tagsDisplay;
          tagsElement.style.color = tagsDisplay && tagsDisplay !== '—' ? '#aaa' : '#666';
          console.log('updateModelElement: Updated tags in list view (fallback) to', tagsDisplay);
        }
      }
    }
    
    // Make sure selection state is preserved
    if (selectedModels.has(filePath)) {
      existingElement.classList.add('selected');
    } else {
      existingElement.classList.remove('selected');
    }

    debugLog('Updated model element:', { 
      filePath, 
      printed: model.printed,
      designer: model.designer,
      source: model.source,
      license: model.license,
      parentModel: model.parentModel
    });

    // Update the model in the currentModels array so virtual grid uses fresh data
    const container = document.querySelector('.file-grid');
    if (container && container.currentModels) {
      const modelIndex = container.currentModels.findIndex(m => 
        (m.id || m.filePath) === (model.id || model.filePath)
      );
      if (modelIndex !== -1) {
        // Update the model in the array with fresh data from database
        container.currentModels[modelIndex] = model;
        
        // Recalculate field analysis since a model's metadata may have changed
        // This ensures the field analysis is up-to-date for future renders
        if (container.currentModels.length > 0) {
          window.modelFieldAnalysis = analyzeModelFields(container.currentModels);
        }
      }
    }

    // For virtual grid, we need to remove the existing item so it gets recreated with fresh data
    // This ensures the grid shows the updated details
    const virtualContent = container?.querySelector('.virtual-content');
    if (virtualContent && existingElement && existingElement.parentNode === virtualContent) {
      // Remove the item so it will be recreated with updated data
      existingElement.remove();
      
      // Trigger virtual grid refresh to recreate the item with updated data
      if (container && container.renderVisibleItemsFn) {
        // Use requestAnimationFrame to batch updates and avoid excessive renders
        requestAnimationFrame(() => {
          container.renderVisibleItemsFn();
        });
      }
    } else if (container && container.renderVisibleItemsFn) {
      // If not in virtual grid or item not found, just trigger refresh
      requestAnimationFrame(() => {
        container.renderVisibleItemsFn();
      });
    }

  } catch (error) {
    console.error('Error updating model element:', error);
  }
}



// Move showModelDetails outside the DOMContentLoaded event listener
// Track the current model being displayed to prevent race conditions
let currentModelDetailsPath = null;
let currentModelDetailsAbort = false;

// Parse file path into hierarchical structure
function parsePath(filePath) {
  if (!filePath) return null;
  
  const isZipEntry = filePath.includes('::');
  let zipPath = null;
  let entryPath = null;
  let fullPath = filePath;
  
  if (isZipEntry) {
    const parts = filePath.split('::');
    zipPath = parts[0];
    entryPath = parts[1];
  }
  
  // Normalize path separators (handle both \ and /)
  // But preserve Windows drive letters (C:, D:, etc.)
  const normalizePath = (path) => {
    // Replace backslashes with forward slashes, but keep drive letters intact
    return path.replace(/\\/g, '/');
  };
  
  // Split path into segments
  let pathSegments = [];
  if (isZipEntry) {
    // For zip entries, split the zip path and entry path separately
    const normalizedZipPath = normalizePath(zipPath);
    const zipSegments = normalizedZipPath.split('/').filter(s => s);
    const entrySegments = entryPath ? entryPath.split('/').filter(s => s) : [];
    pathSegments = {
      zipPath: zipPath,
      zipSegments: zipSegments,
      entrySegments: entrySegments,
      fileName: entrySegments.length > 0 ? entrySegments[entrySegments.length - 1] : null
    };
  } else {
    const normalizedPath = normalizePath(fullPath);
    pathSegments = normalizedPath.split('/').filter(s => s);
  }
  
  return {
    isZipEntry,
    zipPath,
    entryPath,
    pathSegments,
    fullPath
  };
}

// Helper function to get the current model file path
function getCurrentModelFilePath() {
  const pathTreeContainer = document.getElementById('path-tree-container');
  if (pathTreeContainer) {
    return pathTreeContainer.getAttribute('data-file-path') || '';
  }
  return '';
}

// Render path tree visualization
function renderPathTree(filePath, containerId) {
  const container = document.getElementById(containerId);
  if (!container) {
    console.error('Path tree container not found:', containerId);
    return;
  }
  
  if (!filePath) {
    container.innerHTML = '<div class="path-tree-item">No path available</div>';
    return;
  }
  
  const pathInfo = parsePath(filePath);
  if (!pathInfo) {
    container.innerHTML = '<div class="path-tree-item">Invalid path</div>';
    return;
  }
  
  let html = '';
  
  if (pathInfo.isZipEntry) {
    // Handle zip entry paths
    const { zipPath, zipSegments, entrySegments, fileName } = pathInfo.pathSegments;
    
    // Build zip file path tree
    let currentPath = '';
    zipSegments.forEach((segment, index) => {
      if (index === 0) {
        currentPath = segment;
      } else {
        const separator = currentPath.includes(':') ? '\\' : '/';
        currentPath += separator + segment;
      }
      const isLastZipSegment = index === zipSegments.length - 1;
      const indent = '---'.repeat(index);
      const indentClass = `path-tree-indent`;
      
      if (isLastZipSegment) {
        // This is the zip file itself - show it as a folder
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${zipPath}">${segment}</span>
        </div>`;
      } else {
        // Regular folder in zip path - ensure it ends with separator
        let folderPath = currentPath;
        if (!folderPath.endsWith('\\') && !folderPath.endsWith('/')) {
          folderPath += currentPath.includes(':') ? '\\' : '/';
        }
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${folderPath}">${segment}</span>
        </div>`;
      }
    });
    
    // Build entry path tree (nested inside zip)
    let entryCurrentPath = zipPath;
    entrySegments.forEach((segment, index) => {
      const isLastEntrySegment = index === entrySegments.length - 1;
      const indentLevel = zipSegments.length + index;
      const indent = '---'.repeat(indentLevel);
      
      if (isLastEntrySegment) {
        // This is the file
        html += `<div class="path-tree-item" style="margin-left: ${indentLevel * 14}px;">
          <span class="path-tree-icon path-tree-file-icon"></span>
          <span class="path-tree-file">${segment}</span>
        </div>`;
      } else {
        // Folder within zip entry
        html += `<div class="path-tree-item" style="margin-left: ${indentLevel * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${zipPath}">${segment}</span>
        </div>`;
      }
    });
  } else {
    // Handle regular file paths
    const segments = pathInfo.pathSegments;
    
    segments.forEach((segment, index) => {
      const isLast = index === segments.length - 1;
      const indent = '---'.repeat(index);
      
      // Build the path up to this segment (for folders, we need the full path to the folder)
      let currentPath = '';
      for (let i = 0; i <= index; i++) {
        if (i === 0) {
          // Handle Windows drive letters (C:, D:, etc.)
          currentPath = segments[i];
        } else {
          // Add separator - use backslash for Windows paths, forward slash for others
          const separator = currentPath.includes(':') ? '\\' : '/';
          currentPath += separator + segments[i];
        }
      }
      
      if (isLast) {
        // This is the file
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-file-icon"></span>
          <span class="path-tree-file">${segment}</span>
        </div>`;
      } else {
        // This is a folder - need to ensure the path ends with a separator for folders
        // But for Windows drive roots (C:\), we need to handle it specially
        let folderPath = currentPath;
        if (!folderPath.endsWith('\\') && !folderPath.endsWith('/')) {
          folderPath += currentPath.includes(':') ? '\\' : '/';
        }
        
        html += `<div class="path-tree-item" style="margin-left: ${index * 14}px;">
          <span class="path-tree-icon path-tree-folder-icon"></span>
          <span class="path-tree-folder" data-path="${folderPath}">${segment}</span>
        </div>`;
      }
    });
  }
  
  container.innerHTML = html;
  
  // Add click handlers for all folder elements
  container.querySelectorAll('.path-tree-folder').forEach(folderElement => {
    folderElement.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      const folderPath = folderElement.getAttribute('data-path');
      if (folderPath) {
        try {
          // Open the folder in the file explorer
          await window.electron.openPath(folderPath);
        } catch (error) {
          console.error('Error opening folder:', error);
        }
      }
    });
  });
}

async function showModelDetails(filePath) {
  try {
    // Cancel any previous operation
    currentModelDetailsAbort = true;
    
    // Set the new current path
    currentModelDetailsPath = filePath;
    currentModelDetailsAbort = false;
    
    debugLog('Showing model details for:', filePath);
    const model = await window.electron.getModel(filePath);
    
    // Check if this operation was cancelled
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    if (!model) return;

    // Get the details panel reference
    const detailsPanel = document.getElementById('model-details');
    if (!detailsPanel) {
      console.error('Model details panel not found');
      return;
    }
    
    // Check again if cancelled
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }

    // Add multi-edit mode button if it doesn't exist
    const modelDetailsHeader = detailsPanel.querySelector('h3');
    if (modelDetailsHeader && !document.getElementById('enter-multi-edit-button')) {
      const enterMultiEditButton = document.createElement('button');
      enterMultiEditButton.id = 'enter-multi-edit-button';
      enterMultiEditButton.className = 'full-width-button';
      enterMultiEditButton.textContent = 'Enter Multi-Edit Mode';
      
      // Insert after the Model Details header
      modelDetailsHeader.insertAdjacentElement('afterend', enterMultiEditButton);

      // Add click handler
      enterMultiEditButton.addEventListener('click', async () => { // Made async
        isMultiSelectMode = true;
        const multiEditPanel = document.getElementById('multi-edit-panel');
        detailsPanel.classList.add('hidden');
        multiEditPanel.classList.remove('hidden');
        
        // Update the other toggle button's state and text
        const toggleButton = document.getElementById('edit-mode-toggle');
        if (toggleButton) {
          toggleButton.textContent = 'Exit Multi-Edit Mode';
          toggleButton.classList.add('active');
        }
        
        // Add the current model to selection when entering multi-edit mode
        const currentFilePath = getCurrentModelFilePath();
        if (currentFilePath) {
          const storedPath = addToSelectedModels(currentFilePath);
          const normalizedCurrentPath = normalizePathForComparison(currentFilePath);
          // Mark the corresponding DOM element as selected
          const fileItems = document.querySelectorAll('.file-item');
          fileItems.forEach(item => {
            const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
            if (normalizePathForComparison(itemPath) === normalizedCurrentPath) {
              item.classList.add('selected');
            }
          });
        }
        
        // *** ADDED DROPDOWN POPULATION LOGIC ***
        try {
          await populateModelDesignerDropdown(null, 'multi-designer');
          await populateModelLicenseDropdown(null, 'multi-license');
          await populateParentModelDropdown(null, 'multi-parent');
          await populateTagSelect('multi-tag-select', 'multi-tags');
          await populateRemoveTagSelect();
        } catch (error) {
          console.error('Error populating multi-edit dropdowns:', error);
        }
        // ****************************************

        await showMultiEditPanel(); // *** ADDED CALL TO ATTACH LISTENERS ***
        
        // Update the selected count
        updateSelectedCount();

        // Scroll the multi-edit panel into view
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Check again if cancelled before proceeding
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Clear existing tags
    document.getElementById('model-tags').innerHTML = '';

    // First populate all dropdowns with available options
    await Promise.all([
      populateModelDesignerDropdown(model.designer),
      populateModelLicenseDropdown(model.license),
      populateParentModelDropdown(model.parentModel)
    ]);
    
    // Check again if cancelled after async operations
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }

    // Immediately set the designer value after population (before cloning)
    // This ensures the value is set on the populated dropdown
    const designerValueToSet = model.designer || '';
    if (designerValueToSet) {
      const designerSelect = document.getElementById('model-designer');
      if (designerSelect) {
        // Ensure the option exists
        const optionExists = Array.from(designerSelect.options).some(opt => opt.value === designerValueToSet);
        if (!optionExists) {
          const option = document.createElement('option');
          option.value = designerValueToSet;
          option.textContent = designerValueToSet;
          designerSelect.appendChild(option);
        }
        designerSelect.value = designerValueToSet;
        console.log('Set designer before cloning:', designerSelect.value);
      }
    }

    // Add auto-save event listeners for all fields
    const fields = {
      'model-printed': { type: 'checkbox', field: 'printed' },
      'model-source': { type: 'text', field: 'source' },
      'model-notes': { type: 'text', field: 'notes', useChange: true },
      'model-designer': { type: 'select', field: 'designer' },
      'model-license': { type: 'select', field: 'license' },
      'model-parent': { type: 'select', field: 'parentModel' }
    };

    // Store the values before cloning
    const storedValues = {
      'model-path': model.filePath || '',
      'model-name': model.fileName || '',
      'model-designer': model.designer || '',
      'model-source': model.source || '',
      'model-notes': model.notes || '',
      'model-printed': Boolean(model.printed),
      'model-parent': model.parentModel || '',
      'model-license': model.license || ''
    };

    // Remove any existing event listeners by cloning and replacing elements
    // BUT skip cloning the designer dropdown to preserve its value
    Object.keys(fields).forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        // Preserve storedValues that were set from the model - don't overwrite with DOM values
        // The storedValues are already correctly set from the model data above
        // We only need to clone the element to remove event listeners
        
        // For designer dropdown, preserve value more carefully
        if (id === 'model-designer') {
          // Store the value before cloning
          const currentValue = element.value || storedValues[id] || model.designer || '';
          console.log('Designer value before clone:', currentValue);
          const newElement = element.cloneNode(true);
          element.parentNode.replaceChild(newElement, element);
          // Immediately restore the value and ensure option exists
          if (currentValue) {
            // Check if option exists
            const optionExists = Array.from(newElement.options).some(opt => opt.value === currentValue);
            if (!optionExists) {
              const option = document.createElement('option');
              option.value = currentValue;
              option.textContent = currentValue;
              newElement.appendChild(option);
            }
            newElement.value = currentValue;
            console.log('Designer value after clone:', newElement.value);
          }
        } else {
          const newElement = element.cloneNode(true);
          element.parentNode.replaceChild(newElement, element);
        }
      }
    });

    // Check again if cancelled before setting form values
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Set form values AFTER cloning (to ensure they're set on the new elements)
    // Use a small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Final check before updating UI
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Clear the path tree container first to prevent stuck paths
    const pathTreeContainer = document.getElementById('path-tree-container');
    if (pathTreeContainer) {
      pathTreeContainer.innerHTML = '';
      pathTreeContainer.removeAttribute('data-file-path');
    }
    
    // Render path tree instead of setting text input value
    renderPathTree(storedValues['model-path'], 'path-tree-container');
    // Store the file path in a data attribute for other functions that need it
    if (pathTreeContainer) {
      pathTreeContainer.setAttribute('data-file-path', storedValues['model-path']);
    }
    
    // Clear and set model name to prevent stuck values
    const modelNameInput = document.getElementById('model-name');
    if (modelNameInput) {
      modelNameInput.value = '';
      // Use setTimeout to ensure the value is set after clearing
      setTimeout(() => {
        modelNameInput.value = storedValues['model-name'];
      }, 0);
    }
    
    // For dropdowns, ensure the option exists before setting value
    const designerSelect = document.getElementById('model-designer');
    if (designerSelect) {
      const designerValue = storedValues['model-designer'] || model.designer || '';
      console.log('Setting designer value:', designerValue, 'Current value:', designerSelect.value);
      
      if (designerValue) {
        // Check if the option exists, if not add it
        const optionExists = Array.from(designerSelect.options).some(opt => opt.value === designerValue);
        console.log('Designer option exists?', optionExists);
        
        if (!optionExists) {
          const option = document.createElement('option');
          option.value = designerValue;
          option.textContent = designerValue;
          designerSelect.appendChild(option);
          console.log('Added designer option:', designerValue);
        }
        
        // Set the value
        designerSelect.value = designerValue;
        console.log('Set designer value to:', designerSelect.value);
        
        // Force a change event to ensure it's registered
        designerSelect.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        designerSelect.value = '';
      }
    } else {
      console.warn('Designer select element not found after cloning');
    }
    
    const licenseSelect = document.getElementById('model-license');
    if (licenseSelect && storedValues['model-license']) {
      const optionExists = Array.from(licenseSelect.options).some(opt => opt.value === storedValues['model-license']);
      if (!optionExists && storedValues['model-license']) {
        const option = document.createElement('option');
        option.value = storedValues['model-license'];
        option.textContent = storedValues['model-license'];
        licenseSelect.appendChild(option);
      }
      licenseSelect.value = storedValues['model-license'];
    }
    
    const parentSelect = document.getElementById('model-parent');
    if (parentSelect && storedValues['model-parent']) {
      const optionExists = Array.from(parentSelect.options).some(opt => opt.value === storedValues['model-parent']);
      if (!optionExists && storedValues['model-parent']) {
        const option = document.createElement('option');
        option.value = storedValues['model-parent'];
        option.textContent = storedValues['model-parent'];
        parentSelect.appendChild(option);
      }
      parentSelect.value = storedValues['model-parent'];
    }
    
    document.getElementById('model-source').value = storedValues['model-source'];
    document.getElementById('model-notes').value = storedValues['model-notes'];
    document.getElementById('model-printed').checked = storedValues['model-printed'];

    // Add new event listeners
    Object.entries(fields).forEach(([id, config]) => {
      const element = document.getElementById(id);
      if (!element) return;

      const handler = async (e) => {
        // Verify that we still have a valid model selected before saving
        // Check both the path tree container and the current model details path
        const pathTreeContainer = document.getElementById('path-tree-container');
        const pathFromContainer = pathTreeContainer?.getAttribute('data-file-path') || '';
        const currentPath = pathFromContainer || getCurrentModelFilePath() || currentModelDetailsPath;
        
        // If no path exists or it doesn't match the original filePath, don't save
        if (!currentPath || currentPath !== filePath || !pathFromContainer) {
          console.log('No valid model selected, ignoring checkbox change');
          // Revert the checkbox to its previous state
          if (config.type === 'checkbox') {
            e.target.checked = !e.target.checked;
          }
          return;
        }
        
        const value = config.type === 'checkbox' ? e.target.checked : e.target.value;
        await autoSaveModel(config.field, value, filePath);
      };

      if (config.useChange) {
        element.addEventListener('change', handler);
      } else if (config.debounce) {
        element.addEventListener('input', debounce(handler, 500));
      } else {
        element.addEventListener('change', handler);
      }
    });

    // Final check before loading tags and showing panel
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }
    
    // Load tags if they exist
    if (model.tags && Array.isArray(model.tags)) {
      model.tags.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      model.tags.forEach(tag => addTagToModel(tag, 'model-tags'));
    }
    
    // Final check before showing the panel
    if (currentModelDetailsAbort || currentModelDetailsPath !== filePath) {
      return;
    }

    // Show the details panel
    detailsPanel.classList.remove('hidden');

    // Hide multi-edit panel if it's open and clear its form fields
    const multiEditPanel = document.getElementById('multi-edit-panel');
    multiEditPanel.classList.add('hidden');
    clearMultiEditFormFields(); // Clear form fields when switching to single-edit mode

    // Maintain selection state
    document.querySelectorAll('.file-item').forEach(item => {
      const itemPath = item.getAttribute('data-filepath');
      if (selectedModels.has(itemPath)) {
        item.classList.add('selected');
      } else {
        item.classList.remove('selected');
      }
    });

    // Scroll the sidebar to show the model details panel
    const sidebar = document.querySelector('.sidebar');
    sidebar.scrollTo({
      top: detailsPanel.offsetTop - 20, // 20px padding from top
      behavior: 'smooth'
    });

  } catch (error) {
    console.error('Error showing model details:', error); // Keep error logging
  }
}

// Create a function to initialize dialog handlers
function initializeDialogHandlers() {


  
  // Designer dialog handler (existing code for reference)
  document.querySelectorAll('.add-designer-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-designer-dialog');
      const input = document.getElementById('new-designer-name');
      
      dialog.querySelector('form').reset();
      input.value = '';
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-designer';
      
      dialog.showModal();
      forceDialogRefresh(dialog, input);
    });
  });
}

// Helper function to force dialog refresh
function forceDialogRefresh(dialog, input) {
  // Force dialog refresh
  dialog.style.display = 'none';
  requestAnimationFrame(() => {
    dialog.style.display = '';
    
    // Reset input state
    input.disabled = false;
    input.readOnly = false;
    input.blur();
    
    // Force focus after a small delay
    setTimeout(() => {
      input.focus();
      input.click();
      
      // Additional focus attempt after a longer delay
      setTimeout(() => {
        if (document.activeElement !== input) {
          input.focus();
          input.click();
        }
      }, 100);
    }, 50);
  });
}

// Moved resetInputState definition before the focus handler that calls it
function resetInputState(input) {
  if (!input) return;
  input.disabled = false;
  input.readOnly = false;
  // Don't clear the value here to preserve any entered data on refocus
  setTimeout(() => {
    input.focus();
    input.click();
  }, 50);
}

// Add window focus handler
window.addEventListener('focus', () => {
  // Find any open dialog and reset its input
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog) {
    const input = openDialog.querySelector('input[type="text"]');
    if (input) {
      resetInputState(input);
    }
  }
});

// Flag to prevent multiple hash generation dialogs from showing
let isHashDialogShowing = false;
// Flag to track if we're currently checking for hashes (prevents race conditions)
let isCheckingForHashes = false;

// Flag to prevent multiple thumbnail generation dialogs from showing
let isThumbnailDialogShowing = false;

// Add or update the loadDuplicateFiles function
async function loadDuplicateFiles(skipHashCheck = false) {
  try {
    // First check for models without file hash (unless we're skipping the check)
    if (!skipHashCheck) {
      // Check if a hash dialog is already showing or if we're currently checking
      if (isHashDialogShowing || isCheckingForHashes) {
        return; // Exit early if dialog is already showing or check is in progress
      }
      
      isCheckingForHashes = true; // Set flag before checking
      const modelsWithoutHashCount = await window.electron.getModelsWithoutHash();
      isCheckingForHashes = false; // Reset flag after checking
      
      // If there are models without hash, ask the user if they want to generate hashes
      if (modelsWithoutHashCount > 0) {
        isHashDialogShowing = true; // Set flag before showing dialog
        const response = await window.electron.showMessage(
          'Generate File Hashes',
          `${modelsWithoutHashCount} models don't have file hashes which are needed for de-duplication. Would you like to generate the hashes now?`,
          ['Yes', 'No']
        );
        
        if (response === 'Yes') {
          // Show progress dialog
          const progressDialog = document.createElement('dialog');
          progressDialog.className = 'progress-dialog';
          progressDialog.innerHTML = `
            <h3>Generating File Hashes</h3>
            <div class="progress-container">
              <progress id="hash-progress" value="0" max="100"></progress>
              <div id="hash-progress-text">0/${modelsWithoutHashCount}</div>
            </div>
            <p style="margin-top: 15px; color: #666;">
              File hashes are needed for de-duplication. This may take some time for large files.
            </p>
          `;
          document.body.appendChild(progressDialog);
          progressDialog.showModal();
          
          // Set up progress listener
          let isCompleting = false; // Flag to prevent multiple completion calls
          const progressListener = (progress) => {
            const progressBar = document.getElementById('hash-progress');
            const progressText = document.getElementById('hash-progress-text');
            
            if (progressBar && progressText) {
              const percentage = (progress.processed / progress.total) * 100;
              progressBar.value = percentage;
              progressText.textContent = `${progress.processed}/${progress.total}`;
              
              // Close dialog when complete (only once)
              if (progress.processed >= progress.total && !isCompleting) {
                isCompleting = true;
                setTimeout(() => {
                  progressDialog.close();
                  progressDialog.remove();
                  
                  // Reset flag after hash generation completes
                  isHashDialogShowing = false;
                  
                  // Reload duplicate files now that we have generated hashes
                  // Skip hash check to prevent loop
                  loadDuplicateFiles(true);
                }, 500);
              }
            }
          };
          
          // Set up the listener
          window.electron.onHashGenerationProgress(progressListener);
          
          // Start hash generation
          try {
            await window.electron.generateMissingHashes();
          } catch (error) {
            console.error('Error generating hashes:', error);
            // Reset flags on error
            isHashDialogShowing = false;
            isCheckingForHashes = false;
            // Close progress dialog
            progressDialog.close();
            progressDialog.remove();
            await window.electron.showMessage('Error', 'Failed to generate file hashes');
            return;
          }
          return; // Exit early - we'll reload when hash generation is complete
        } else {
          // If user clicked "No", reset flag and continue to show duplicates for models that have hashes
          isHashDialogShowing = false;
        }
      } else {
        // No models without hash, ensure flag is reset
        isHashDialogShowing = false;
      }
    }
    
    const dialog = document.getElementById('dedup-dialog');
    const duplicateGroups = dialog.querySelector('.duplicate-groups');
    duplicateGroups.innerHTML = '';
    
    // Check if ZIP is enabled and show/hide the checkbox
    const enableZipArchives = await window.electron.getSetting('enableZipArchives');
    const includeZipContainer = dialog.querySelector('#include-zip-container');
    let includeZipCheckbox = dialog.querySelector('#include-zipped-models');
    
    if (enableZipArchives === '1') {
      // Show the checkbox container
      if (includeZipContainer) {
        includeZipContainer.style.display = 'block';
      }
      // Set up checkbox if it exists
      if (includeZipCheckbox) {
        // Preserve existing checked state (for when user toggles and we reload)
        const wasChecked = includeZipCheckbox.checked;
        // Remove existing listeners and add new one
        const newCheckbox = includeZipCheckbox.cloneNode(true);
        newCheckbox.checked = wasChecked; // Preserve state
        includeZipCheckbox.replaceWith(newCheckbox);
        includeZipCheckbox = newCheckbox;
        newCheckbox.addEventListener('change', async () => {
          await loadDuplicateFiles();
        });
      }
    } else {
      // Hide the checkbox container if ZIP is not enabled
      if (includeZipContainer) {
        includeZipContainer.style.display = 'none';
      }
    }
    
    // Get the current checkbox state (default to false)
    const includeZip = includeZipCheckbox?.checked || false;
    
    // Load duplicates with the includeZip parameter
    const duplicates = await window.electron.getDuplicates(includeZip);
    const isGeneratingHashes = await window.electron.isGeneratingHashes();
    console.log('Loaded duplicates:', duplicates);
    console.log('Is generating hashes:', isGeneratingHashes);
    console.log('Include zip:', includeZip);
    
    // Show warning if hashes are being generated
    if (isGeneratingHashes) {
      const warningDiv = document.createElement('div');
      warningDiv.className = 'hash-generation-warning';
      warningDiv.innerHTML = `
        <div style="background-color: #fff3cd; color: #856404; padding: 10px; margin-bottom: 15px; border-radius: 4px; border: 1px solid #ffeeba;">
          <strong>Note:</strong> Hash generation is currently running in the background. 
          Additional duplicate files may be found once the process completes.
        </div>
      `;
      duplicateGroups.appendChild(warningDiv);
    }
    
    if (!duplicates || Object.keys(duplicates).length === 0) {
      duplicateGroups.innerHTML += `
        <div style="text-align: center; padding: 20px; color: #888;">
          No duplicate models found
        </div>
      `;
      const deleteButton = dialog.querySelector('#delete-selected');
      if (deleteButton) {
        deleteButton.style.display = 'none';
      }
    } else {
      console.log(`Found ${Object.keys(duplicates).length} duplicate groups`);
      
      // Show and setup delete button
      const deleteButton = dialog.querySelector('#delete-selected');
      if (deleteButton) {
        deleteButton.style.display = '';
        // Remove any existing click listeners
        deleteButton.replaceWith(deleteButton.cloneNode(true));
        // Get the new button reference
        const newDeleteButton = dialog.querySelector('#delete-selected');
        // Add click handler
        newDeleteButton.addEventListener('click', handleDeleteSelected);
      }
      
      // Create groups for each set of duplicates
      for (const [hash, files] of Object.entries(duplicates)) {
        const group = document.createElement('div');
        group.className = 'duplicate-group';
        
        // Add preview container
        const preview = document.createElement('div');
        preview.className = 'duplicate-preview';
        
        // Try to get thumbnail
        try {
          const thumbnail = await window.electron.getThumbnail(files[0].filePath);
          if (thumbnail) {
            const img = document.createElement('img');
            img.src = thumbnail;
            preview.appendChild(img);
          } else {
            preview.innerHTML = '<div class="error-message">No preview available</div>';
          }
  } catch (error) {
          console.error('Error getting thumbnail:', error);
          preview.innerHTML = '<div class="error-message">No preview available</div>';
        }
        
        // Add files list
        const filesList = document.createElement('div');
        filesList.className = 'duplicate-files';
        
        // Add header with count
        const header = document.createElement('div');
        header.className = 'duplicate-header';
        header.textContent = `${files.length} duplicate files found`;
        filesList.appendChild(header);
        
        // Add each file
        files.forEach(file => {
          const fileDiv = document.createElement('div');
          fileDiv.className = 'duplicate-file';
          
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.setAttribute('data-filepath', file.filePath);
          
          const filePath = document.createElement('span');
          filePath.className = 'duplicate-file-path';
          filePath.textContent = file.filePath;
          
          const fileSize = document.createElement('span');
          fileSize.className = 'duplicate-file-size';
          fileSize.textContent = formatFileSize(file.size);
          
          fileDiv.appendChild(checkbox);
          fileDiv.appendChild(filePath);
          fileDiv.appendChild(fileSize);
          filesList.appendChild(fileDiv);
        });
        
        group.appendChild(preview);
        group.appendChild(filesList);
        duplicateGroups.appendChild(group);
      }
    }
    
    // Show the dialog
    dialog.showModal();
    
  } catch (error) {
    console.error('Error loading duplicates:', error);
    // Reset flags in case of error
    isHashDialogShowing = false;
    isCheckingForHashes = false;
    await window.electron.showMessage('Error', 'Failed to load duplicate files');
  }
}


// Update the checkTermsOfService function to return a promise
async function checkTermsOfService() {
  try {
    let tosAccepted = await window.electron.getSetting('tosAcceptedDate');
    const termsDialog = document.getElementById('terms-of-service-dialog');
    const acceptButton = document.getElementById('accept-terms');
    const declineButton = document.getElementById('decline-terms');

    if (!termsDialog || !acceptButton || !declineButton) {
      console.error('Terms of Service dialog elements not found');
      return false; // Return false if dialog elements are not found
    }

    if (!tosAccepted) {
      termsDialog.showModal();
      
      return new Promise((resolve) => {
        const acceptHandler = async () => {
          // Remove event listeners first to prevent double-clicks
          acceptButton.removeEventListener('click', acceptHandler);
          declineButton.removeEventListener('click', declineHandler);
          
          // Save TOS acceptance to database
          await window.electron.saveSetting('tosAcceptedDate', new Date().toISOString());
          
          // Close the terms dialog
          termsDialog.close();
          
          // Small delay to ensure dialog closes before showing welcome
          await new Promise(resolve => setTimeout(resolve, 200));
          
          // Show welcome dialog if this is the first run
          const hasRunBefore = await window.electron.getSetting('hasRunBefore');
          if (!hasRunBefore) {
            const welcomeDialog = document.getElementById('welcome-message');
            if (welcomeDialog) {
              welcomeDialog.showModal();
              await window.electron.saveSetting('hasRunBefore', 'true');
            }
          }
          
          resolve(true); // Resolve promise when accepted
        };

        const declineHandler = () => {
          acceptButton.removeEventListener('click', acceptHandler);
          declineButton.removeEventListener('click', declineHandler);
          window.electron.quitApp();
          resolve(false); // Resolve promise when declined
        };

        acceptButton.addEventListener('click', acceptHandler);
        declineButton.addEventListener('click', declineHandler);
      });
    }
    return true; // Return true if already accepted
  } catch (error) {
    console.error('Error checking Terms of Service:', error);
    return false; // Return false on error
  }
}

// Function to create menu dropdown for server mode
function createMenuDropdown(label, items) {
  const menuContainer = document.createElement('div');
  menuContainer.style.cssText = 'position: relative; margin-right: 15px;';
  
  const menuButton = document.createElement('button');
  menuButton.textContent = label;
  menuButton.style.cssText = 'background: none; border: none; color: #e0e0e0; padding: 5px 10px; cursor: pointer; font-size: 13px; font-family: inherit;';
  menuButton.onmouseover = () => menuButton.style.backgroundColor = '#3a3a3a';
  menuButton.onmouseout = () => menuButton.style.backgroundColor = 'transparent';
  
  const dropdown = document.createElement('div');
  dropdown.style.cssText = 'display: none; position: absolute; top: 100%; left: 0; background-color: #2c2c2c; border: 1px solid #444; border-radius: 4px; min-width: 180px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); z-index: 10001; margin-top: 2px;';
  
  items.forEach(item => {
    if (item.label === '---') {
      const separator = document.createElement('div');
      separator.style.cssText = 'height: 1px; background-color: #444; margin: 4px 0;';
      dropdown.appendChild(separator);
    } else {
      const menuItem = document.createElement('div');
      menuItem.textContent = item.label;
      menuItem.style.cssText = 'padding: 8px 12px; color: #e0e0e0; cursor: pointer; font-size: 13px;';
      menuItem.onmouseover = () => menuItem.style.backgroundColor = '#3a3a3a';
      menuItem.onmouseout = () => menuItem.style.backgroundColor = 'transparent';
      menuItem.onclick = () => {
        if (item.action) {
          item.action();
        }
        dropdown.style.display = 'none';
      };
      dropdown.appendChild(menuItem);
    }
  });
  
  menuButton.onclick = (e) => {
    e.stopPropagation();
    const isVisible = dropdown.style.display === 'block';
    // Close all other dropdowns
    document.querySelectorAll('#server-menu-bar [style*="display: block"]').forEach(el => {
      if (el !== dropdown && el.style.display === 'block') el.style.display = 'none';
    });
    dropdown.style.display = isVisible ? 'none' : 'block';
  };
  
  // Close dropdown when clicking outside
  document.addEventListener('click', (e) => {
    if (!menuContainer.contains(e.target)) {
      dropdown.style.display = 'none';
    }
  });
  
  menuContainer.appendChild(menuButton);
  menuContainer.appendChild(dropdown);
  
  return menuContainer;
}

// Shared function to initialize and open STL Home dialog
window.openSTLHomeDialog = async function() {
  const stlHomeDialog = document.getElementById('stl-home-dialog');
  if (!stlHomeDialog) return;
  
  // Check if we're in server mode
  const serverMode = await window.electron.isServerMode().catch(() => false);
  
  // Load the current STL Home setting (if any)
  const dir = await window.electron.getSetting('stlHome');
  const directoryInput = document.getElementById('stl-home-directory');
  if (directoryInput) {
    directoryInput.value = dir || "";
  }
  
  // Load the update frequency setting (default to 60 minutes)
  const updateFrequency = await window.electron.getSetting('stlHomeUpdateFrequency');
  const updateFrequencyInput = document.getElementById('stl-home-update-frequency');
  const updateFrequencyGroup = document.getElementById('stl-home-update-frequency-group');
  const chooseButton = document.getElementById('choose-stl-home-button');
  
  if (serverMode) {
    // In server mode: hide Choose Directory button, show Update Frequency
    if (chooseButton) chooseButton.style.display = 'none';
    if (updateFrequencyGroup) updateFrequencyGroup.style.display = 'block';
    if (updateFrequencyInput) {
      updateFrequencyInput.value = updateFrequency || '60';
    }
  } else {
    // In normal mode: show Choose Directory button, hide Update Frequency
    if (chooseButton) chooseButton.style.display = 'block';
    if (updateFrequencyGroup) updateFrequencyGroup.style.display = 'none';
  }
  
  stlHomeDialog.showModal();
};

// Function to create server mode menu bar
function createServerMenuBar() {
  const menuBar = document.createElement('div');
  menuBar.id = 'server-menu-bar';
  menuBar.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; height: 30px; background-color: #2c2c2c; border-bottom: 1px solid #444; display: flex; align-items: center; padding: 0 10px; z-index: 10000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; font-size: 13px;';
  
  // Tools menu
  const toolsMenu = createMenuDropdown('Tools', [
    { label: 'Scan Directory', action: () => document.getElementById('scan-directory-button')?.click() },
    { label: 'View Entire Library', action: () => document.getElementById('view-library-button')?.click() },
    { label: '---', action: null },
    { label: 'De-Duplicate', action: () => {
      const dialog = document.getElementById('dedup-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        // Trigger the event which will open the dialog via the listener
        window.electron.send('open-dedup');
      }
    }},
    { label: 'Tag Manager', action: () => {
      const dialog = document.getElementById('tag-manager-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        // Fallback: trigger the event which will open the dialog via the listener
        window.electron.send('open-tag-manager');
      }
    }},
    { label: 'Print Roulette', action: () => window.electron.send('start-print-roulette') },
    { label: '---', action: null },
    { label: 'Backup/Restore', action: () => {
      const dialog = document.getElementById('backup-restore-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        // Fallback: trigger the event which will open the dialog via the listener
        window.electron.send('open-backup-restore');
      }
    }},
    { label: 'Purge Models', action: () => {
      const dialog = document.getElementById('purge-models-dialog');
      if (dialog) {
        dialog.showModal();
      }
    }},
    { label: '---', action: null },
    { label: 'Restart Server', action: async () => {
      // Show confirmation dialog
      const confirmed = confirm('Are you sure you want to restart the server? All connected clients will be disconnected temporarily.');
      if (!confirmed) {
        return;
      }
      
      try {
        // Show loading feedback
        const loadingMsg = document.createElement('div');
        loadingMsg.id = 'restart-server-loading';
        loadingMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #2c2c2c; color: white; padding: 20px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
        loadingMsg.textContent = 'Restarting server...';
        document.body.appendChild(loadingMsg);
        
        // Call restart server
        const result = await window.electron.invoke('restart-server');
        
        // Remove loading message
        const loadingElement = document.getElementById('restart-server-loading');
        if (loadingElement) {
          loadingElement.remove();
        }
        
        if (result && result.success) {
          // Show success message briefly
          const successMsg = document.createElement('div');
          successMsg.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: #4a9eff; color: white; padding: 20px; border-radius: 8px; z-index: 10001; box-shadow: 0 4px 6px rgba(0,0,0,0.3);';
          successMsg.textContent = 'Server restarted successfully';
          document.body.appendChild(successMsg);
          setTimeout(() => {
            if (successMsg.parentNode) {
              successMsg.remove();
            }
          }, 2000);
        } else {
          // Show error message
          alert('Failed to restart server: ' + (result?.message || 'Unknown error'));
        }
      } catch (error) {
        // Remove loading message if it exists
        const loadingElement = document.getElementById('restart-server-loading');
        if (loadingElement) {
          loadingElement.remove();
        }
        console.error('Error restarting server:', error);
        alert('Failed to restart server: ' + (error.message || 'Unknown error'));
      }
    }}
  ]);
  
  // Settings menu
  const settingsMenu = createMenuDropdown('Settings', [
    { label: 'AI Config', action: () => {
      const dialog = document.getElementById('ai-config-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        window.electron.send('open-ai-config');
      }
    }},
    { label: 'File Type Settings', action: () => {
      const dialog = document.getElementById('file-type-settings-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        window.electron.send('open-file-type-settings');
      }
    }},
    { label: 'Performance Settings', action: () => {
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        window.electron.send('open-performance-settings');
      }
    }},
    { label: 'Slicer Settings', action: () => {
      const dialog = document.getElementById('slicer-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        window.electron.send('open-slicer-settings');
      }
    }},
    { label: 'STL Home', action: async () => {
      await window.openSTLHomeDialog();
    }},
    { label: 'Theme Settings', action: () => {
      window.electron.send('open-theme-settings');
    }}
  ]);
  
  // Help menu
  const helpMenu = createMenuDropdown('Help', [
    { label: 'User Guide', action: () => {
      const dialog = document.getElementById('guide-dialog');
      if (dialog) {
        dialog.showModal();
      } else {
        window.electron.send('open-guide');
      }
    }},
    { label: 'About', action: () => {
      const aboutDialog = document.getElementById('about-dialog');
      if (aboutDialog) aboutDialog.showModal();
    }}
  ]);
  
  menuBar.appendChild(toolsMenu);
  menuBar.appendChild(settingsMenu);
  menuBar.appendChild(helpMenu);
  
  document.body.insertBefore(menuBar, document.body.firstChild);
  
  // Adjust body padding to account for menu bar
  document.body.style.paddingTop = '30px';
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async () => {
  const tosAccepted = await checkTermsOfService();
  if (!tosAccepted) return; // Don't continue if TOS was declined

  // Check for server mode and add UI indicators
  const serverMode = await window.electron.isServerMode().catch(() => false);
  if (serverMode) {
    // Add server mode indicator to the sidebar (only if it doesn't already exist)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('server-mode-indicator')) {
      const serverIndicator = document.createElement('div');
      serverIndicator.id = 'server-mode-indicator';
      serverIndicator.style.cssText = 'background-color: #4a9eff; color: white; padding: 10px; margin: 10px 0; border-radius: 4px; text-align: center; font-weight: bold;';
      serverIndicator.innerHTML = `
        <div>🌐 Server Mode</div>
        <div style="font-size: 12px; font-weight: normal; margin-top: 5px;">
          UNC paths required for all file operations
        </div>
      `;
      sidebar.insertBefore(serverIndicator, sidebar.firstChild);
    }
    
    // Add menu bar for server mode (only if it doesn't already exist)
    if (!document.getElementById('server-menu-bar')) {
      createServerMenuBar();
    }
  }

  // Show the welcome dialog if this is the first run
  const hasRunBefore = await window.electron.getSetting('hasRunBefore');
  if (!hasRunBefore) {
    const welcomeDialog = document.getElementById('welcome-message');
    if (welcomeDialog) {
      welcomeDialog.showModal();
    }
    await window.electron.saveSetting('hasRunBefore', 'true');
  }

  // Load saved grid view preference
  const savedView = await window.electron.getSetting('gridView');
  if (savedView && ['list', 'preview', 'detailed'].includes(savedView)) {
    // Map old 'small' to 'preview' for backward compatibility
    if (savedView === 'small') {
      currentGridView = 'preview';
    } else {
      currentGridView = savedView;
    }
  }
  
  // Initialize view selector buttons
  const viewButtons = document.querySelectorAll('.view-button');
  // First, remove active class from all buttons
  viewButtons.forEach(btn => btn.classList.remove('active'));
  // Then, add active class only to the button matching the current view
  viewButtons.forEach(button => {
    const view = button.dataset.view;
    if (view === currentGridView) {
      button.classList.add('active');
    }
    button.addEventListener('click', async () => {
      // Before switching views, save current thumbnails as default for all items with navigation
      if (currentGridView === 'detailed' && view !== 'detailed') {
        // Save current thumbnail index for all items with multiple thumbnails
        const allWrappers = document.querySelectorAll('.thumbnail-wrapper');
        for (const wrapper of allWrappers) {
          // Clear any pending debounced saves and save immediately
          if (wrapper._saveTimeout) {
            clearTimeout(wrapper._saveTimeout);
            wrapper._saveTimeout = null;
          }
          
          const currentIdx = parseInt(wrapper.dataset.currentIndex) || 0;
          const filePath = wrapper.dataset.filePath;
          const thumbs = JSON.parse(wrapper.dataset.thumbnails || '[]');
          
          if (filePath && thumbs && thumbs.length > currentIdx && currentIdx >= 0) {
            try {
              await window.electron.setDefaultThumbnail(filePath, currentIdx);
            } catch (e) {
              console.error('Error saving default thumbnail on view switch:', e);
            }
          }
        }
      }
      
      // Remove active class from all buttons
      viewButtons.forEach(btn => btn.classList.remove('active'));
      // Add active class to clicked button
      button.classList.add('active');
      // Update current view
      currentGridView = view;
      // Save preference
      await window.electron.saveSetting('gridView', view);
      // Force clear the grid to ensure new view is applied
      const container = document.querySelector('.file-grid');
      if (container) {
        container.innerHTML = '';
        container.currentModels = null;
        container.isRendering = false;
      }
      // Re-render grid with new view, preserving current filters
      // Use performCombinedSearch to maintain filters when switching views
      if (typeof window.performCombinedSearch === 'function') {
        await window.performCombinedSearch();
      } else {
        // Fallback if search.js hasn't loaded yet
        const currentModels = container?.currentModels || [];
        if (currentModels.length > 0) {
          renderVirtualGrid(currentModels);
        } else {
          // If no models in memory, reload from database with current filters
          const sortSelect = document.getElementById('sort-select');
          const sortOption = sortSelect ? sortSelect.value : 'date-desc';
          const models = await window.electron.getAllModels(sortOption, 0);
          await renderFiles(models);
        }
      }
    });
  });
  
  // Save current thumbnails as default before page unload
  window.addEventListener('beforeunload', () => {
    const allWrappers = document.querySelectorAll('.thumbnail-wrapper');
    for (const wrapper of allWrappers) {
      // Clear any pending debounced saves and save immediately
      if (wrapper._saveTimeout) {
        clearTimeout(wrapper._saveTimeout);
        wrapper._saveTimeout = null;
      }
      
      const currentIdx = parseInt(wrapper.dataset.currentIndex) || 0;
      const filePath = wrapper.dataset.filePath;
      const thumbs = JSON.parse(wrapper.dataset.thumbnails || '[]');
      
      if (filePath && thumbs && thumbs.length > currentIdx && currentIdx >= 0) {
        try {
          // Use synchronous-like approach for beforeunload
          window.electron.setDefaultThumbnail(filePath, currentIdx).catch(e => {
            console.error('Error saving thumbnail on unload:', e);
          });
        } catch (e) {
          console.error('Error saving thumbnail on unload:', e);
        }
      }
    }
  });
  
  // Proceed to initialize the application
  // Update checks are handled in initializeApp() to avoid duplicates
  debugLog('DOM fully loaded and parsed');

  const fileGrid = document.querySelector('.file-grid');
  const settingsDialog = document.getElementById('settings-dialog');
  const aboutDialog = document.getElementById('about-dialog');
  const tagDialog = document.getElementById('new-tag-dialog');
  const newTagInput = document.getElementById('new-tag-name');
  const addTagButton = document.getElementById('add-tag-button');
  const licenseSelect = document.getElementById('license-select');
  const newDesignerDialog = document.getElementById('new-designer-dialog');
  const welcomeDialog = document.getElementById('welcome-message');

  // Initialize license filter
  if (licenseSelect) {
    licenseSelect.addEventListener('change', async () => {
      const license = licenseSelect.value;
      const models = await window.electron.getAllModels();
      
      if (license) {
        const filteredModels = models.filter(model => model.license === license);
      } else {
      }
    });
  }

  // Initialize tag filter
  const tagFilterSelect = document.getElementById('tag-filter-select');
  if (tagFilterSelect) {
    tagFilterSelect.addEventListener('change', async (event) => {
      const selectedTag = event.target.value;
      if (selectedTag) {
        const tagContainer = document.getElementById('tag-filter');
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.setAttribute('data-tag-name', selectedTag);
        tag.setAttribute('title', selectedTag); // Show full tag name on hover
        tag.innerHTML = `
          <span class="tag-text">${selectedTag}</span>
          <span class="tag-remove">×</span>
        `;
        
        tag.querySelector('.tag-remove')?.addEventListener('click', () => {
          tag.remove();
          updateTagFilter();
          populateTagFilterDropdown();
        });
        
        tagContainer.appendChild(tag);
        event.target.value = ''; // Reset selection
        updateTagFilter();
        await populateTagFilterDropdown();
      }
    });
  }

  // Load initial data
  const savedDirectoryPath = await window.electron.loadDirectory();
  if (savedDirectoryPath) {
    try {
      const models = await window.electron.getAllModels('date-desc', 0);
      if (models && models.length > 0) {
        fileGrid.classList.remove('hidden');
        await renderFiles(models);
        const viewLibMsg = document.getElementById("view-library-message");
        if (viewLibMsg) {
          viewLibMsg.style.display = "block";
          viewLibMsg.textContent = `Showing All ${models.length} Models`;
        }
      } else {
        if (welcomeDialog) {
          welcomeDialog.showModal();
        }
        const viewLibMsg = document.getElementById("view-library-message");
        if (viewLibMsg) { 
          viewLibMsg.style.display = "none"; 
        }
      }
    } catch (error) {
      console.error('Error loading models:', error);
    }
  } else {
    if (welcomeDialog) {
      welcomeDialog.showModal();
    }
  }

  // Once the initial models have been rendered, hide the loading overlay.
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) loadingOverlay.style.display = 'none';
  
  // Initialize filters
  await populateDesignerDropdown();
  await populateLicenseFilter();
  await populateParentModelFilter();
  await populateTagFilter();

  // Update the edit mode toggle button listener
  document.getElementById('edit-mode-toggle')?.addEventListener('click', async () => { // Ensure async
    isMultiSelectMode = !isMultiSelectMode;
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    if (isMultiSelectMode) {
      button.textContent = 'Exit Multi-Edit Mode'; // Changed from Single-Edit
      button.classList.add('active');
      multiEditPanel.classList.remove('hidden');
      detailsPanel.classList.add('hidden');
      
      // Populate dropdowns
      try {
        await populateModelDesignerDropdown(null, 'multi-designer');
        await populateModelLicenseDropdown(null, 'multi-license');
        await populateParentModelDropdown(null, 'multi-parent');
        await populateTagSelect('multi-tag-select', 'multi-tags');
        await populateRemoveTagSelect();
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      await showMultiEditPanel(); // Call to attach listeners
      
      multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      // Clear selection when disabling multiselect
      selectedModels.clear();
      document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
      multiEditPanel.classList.add('hidden');
      // Make sure details panel is shown if nothing else is selected
      if (selectedModels.size === 0) {
         detailsPanel.classList.remove('hidden'); // Remove hidden class if no models selected
         closeDetailsPanel(); // Or potentially call closeDetailsPanel if preferred
      }
      button.textContent = 'Multi-Edit Mode';
      button.classList.remove('active');
      // Call exitMultiEditMode if needed for cleanup
      exitMultiEditMode(); 
    }
    updateSelectedCount();
  });

  // Initialize tag dialog handlers
  addTagButton.addEventListener('click', () => {
    // Reset the form and dialog state
    tagDialog.querySelector('form').reset();
    newTagInput.value = '';
    
    // Store the source container ID for single-edit mode
    tagDialog.setAttribute('data-source-container', 'model-tags');
    
    // Show the dialog
    tagDialog.showModal();
    
    // Use forceDialogRefresh to ensure input focus works properly on Windows
    forceDialogRefresh(tagDialog, newTagInput);
  });

  document.getElementById('cancel-tag-button')?.addEventListener('click', () => {
    // Reset form state before closing
    tagDialog.querySelector('form').reset();
    newTagInput.value = '';
    tagDialog.close();
  });

  tagDialog.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const newTagName = newTagInput.value.trim();
    
    if (newTagName) {
      try {
        // Save tag and get the tag object back
        const savedTag = await window.electron.saveTag(newTagName);
        // Add the new tag to the model immediately if in single edit mode
        if (!isMultiSelectMode) {
          console.log(`Single edit mode: Adding new tag '${savedTag.name}' to model-tags`); // Added log
          // This line should handle adding the tag visually and saving
          addTagToModel(savedTag.name, 'model-tags');
        }
        // Reset form state before closing
        tagDialog.querySelector('form').reset();
        newTagInput.value = '';
        tagDialog.close();
        
        // Only refresh the currently active dropdown
        if (isMultiSelectMode) {
          await populateTagSelect('multi-tag-select', 'multi-tags');
        } else {
          await populateTagSelect('tag-select', 'model-tags');
        }
        
        // Update the tag filter dropdown
        await populateTagFilter();
        await refreshTagManagerList();
      } catch (error) {
        console.error('Error saving new tag:', error);
      }
    }
  });

  // Load background color setting
  const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
  if (backgroundColor) {
    document.documentElement.style.setProperty('--model-background-color', backgroundColor);
    document.getElementById('model-background-color').value = backgroundColor;
  }

  // Settings dialog handlers
  window.electron.onOpenSettings(() => {
    settingsDialog.showModal();
  });

  document.getElementById('cancel-settings')?.addEventListener('click', () => {
    settingsDialog.close();
  });

  document.getElementById('save-settings')?.addEventListener('click', async () => {
    const color = document.getElementById('model-background-color').value;
    const theme = document.getElementById('ui-theme')?.value || 'modern-cyan';
    
    // Update CSS variable for model background
    document.documentElement.style.setProperty('--model-background-color', color);
    
    // Update UI theme
    document.body.setAttribute('data-theme', theme);
    
    // Save to settings
    await window.electron.saveSetting('modelBackgroundColor', color);
    await window.electron.saveSetting('uiTheme', theme);
    
    // Apply theme colors dynamically
    applyThemeColors(theme);
    
    settingsDialog.close();
  });

  // Function to apply theme colors
  function applyThemeColors(theme) {
    const root = document.documentElement;
    switch(theme) {
      case 'modern-purple':
        root.style.setProperty('--primary-accent', '#a855f7');
        root.style.setProperty('--primary-accent-hover', '#c084fc');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #a855f7 0%, #c084fc 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #b866ff 0%, #d094ff 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(168, 85, 247, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(168, 85, 247, 0.4)');
        break;
      case 'modern-green':
        root.style.setProperty('--primary-accent', '#4ade80');
        root.style.setProperty('--primary-accent-hover', '#22c55e');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #5ae890 0%, #2dd66f 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(34, 197, 94, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(34, 197, 94, 0.4)');
        break;
      case 'modern-orange':
        root.style.setProperty('--primary-accent', '#fb923c');
        root.style.setProperty('--primary-accent-hover', '#f97316');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ffa34c 0%, #ff8326 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(249, 115, 22, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(249, 115, 22, 0.4)');
        break;
      case 'modern-pink':
        root.style.setProperty('--primary-accent', '#f472b6');
        root.style.setProperty('--primary-accent-hover', '#ec4899');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ff82c6 0%, #fc58a9 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(236, 72, 153, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(236, 72, 153, 0.4)');
        break;
      case 'dark-minimal':
        root.style.setProperty('--primary-accent', '#9ca3af');
        root.style.setProperty('--primary-accent-hover', '#d1d5db');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(75, 85, 99, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(75, 85, 99, 0.4)');
        break;
      default: // modern-cyan
        root.style.setProperty('--primary-accent', '#00d4ff');
        root.style.setProperty('--primary-accent-hover', '#5b9fff');
        root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #00d4ff 0%, #5b9fff 100%)');
        root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #00e5ff 0%, #6ba8ff 100%)');
        root.style.setProperty('--primary-shadow', 'rgba(91, 159, 255, 0.3)');
        root.style.setProperty('--primary-shadow-hover', 'rgba(91, 159, 255, 0.4)');
    }
  }

  // Load theme on startup
  const savedTheme = await window.electron.getSetting('uiTheme') || 'modern-cyan';
  document.body.setAttribute('data-theme', savedTheme);
  const uiThemeSelect = document.getElementById('ui-theme');
  if (uiThemeSelect) {
    uiThemeSelect.value = savedTheme;
  }
  applyThemeColors(savedTheme);

  // Add dismiss button handler
  document.getElementById('dismiss-welcome')?.addEventListener('click', () => {
    welcomeDialog.close();
  });

  // Notes modal handlers
  const notesModal = document.getElementById('notes-modal-dialog');
  const notesModalTextarea = document.getElementById('notes-modal-textarea');
  const openNotesModalButton = document.getElementById('open-notes-modal-button');
  const saveNotesButton = document.getElementById('save-notes-button');
  const cancelNotesButton = document.getElementById('cancel-notes-button');
  const modelNotesTextarea = document.getElementById('model-notes');

  // Open notes modal
  openNotesModalButton?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Get fresh references to ensure we have the latest values
    const currentNotesTextarea = document.getElementById('model-notes');
    const currentModalTextarea = document.getElementById('notes-modal-textarea');
    const currentModal = document.getElementById('notes-modal-dialog');
    
    if (currentModal && currentModalTextarea && currentNotesTextarea) {
      // Always read the current value from the textarea
      currentModalTextarea.value = currentNotesTextarea.value || '';
      currentModal.showModal();
      // Focus the textarea after a short delay to ensure modal is fully rendered
      setTimeout(() => {
        currentModalTextarea.focus();
      }, 100);
    }
  });

  // Save notes from modal
  saveNotesButton?.addEventListener('click', async (e) => {
    e.preventDefault();
    // Get fresh references to ensure we have the latest elements
    const currentModalTextarea = document.getElementById('notes-modal-textarea');
    const currentNotesTextarea = document.getElementById('model-notes');
    const currentModal = document.getElementById('notes-modal-dialog');
    
    if (currentModal && currentModalTextarea && currentNotesTextarea) {
      const newValue = currentModalTextarea.value || '';
      // Update the main textarea with the new value
      currentNotesTextarea.value = newValue;
      
      // Trigger change event to auto-save
      const changeEvent = new Event('change', { bubbles: true });
      currentNotesTextarea.dispatchEvent(changeEvent);
      
      currentModal.close();
    }
  });

  // Cancel notes modal
  cancelNotesButton?.addEventListener('click', () => {
    if (notesModal) {
      notesModal.close();
    }
  });

  // Handle form submission (e.g., pressing Enter in textarea)
  const notesModalForm = notesModal?.querySelector('form');
  notesModalForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    // Get fresh references
    const currentModalTextarea = document.getElementById('notes-modal-textarea');
    const currentNotesTextarea = document.getElementById('model-notes');
    
    if (currentModalTextarea && currentNotesTextarea) {
      const newValue = currentModalTextarea.value || '';
      currentNotesTextarea.value = newValue;
      
      // Trigger change event to auto-save
      const changeEvent = new Event('change', { bubbles: true });
      currentNotesTextarea.dispatchEvent(changeEvent);
      
      notesModal.close();
    }
  });

  // Close modal on backdrop click
  notesModal?.addEventListener('click', (e) => {
    if (e.target === notesModal) {
      notesModal.close();
    }
  });

  // Update the save model button handler (single edit)
  document.getElementById('save-model-button')?.addEventListener('click', async () => {
    try {
      const filePath = getCurrentModelFilePath();
      // Get all selected tags
      const tagElements = document.getElementById('model-tags').querySelectorAll('.tag');
      const tags = Array.from(tagElements).map(tag => tag.getAttribute('data-tag-name'));

      const modelData = {
        filePath,
        fileName: document.getElementById('model-name').value,
        designer: document.getElementById('model-designer').value || 'Unknown',
        source: document.getElementById('model-source').value || '',
        notes: document.getElementById('model-notes').value || '',
        printed: document.getElementById('model-printed').checked,
        parentModel: document.getElementById('model-parent').value || '',
        license: document.getElementById('model-license').value || '',
        tags: tags
      };

      // Save the model with tags
      await window.electron.saveModel(modelData);
      // Update the model element in the grid
      await updateModelElement(filePath);
      // Reapply filters and refresh view
      await refreshModelDisplay();

    } catch (error) {
      console.error('Error saving model:', error);
    }
  });

  // Update the multi-save button handler
  document.getElementById('multi-save-button')?.addEventListener('click', async () => {
    try {
      const designer = document.getElementById('multi-designer').value;
      const source = document.getElementById('multi-source').value;
      const parent = document.getElementById('multi-parent').value;
      const license = document.getElementById('multi-license').value;
      const printed = document.getElementById('multi-printed').checked;

      // Get all selected tags
      const tagElements = document.getElementById('multi-tags').querySelectorAll('.tag');
      const tags = Array.from(tagElements).map(tag => tag.getAttribute('data-tag-name'));

      // Update each selected model
      for (const filePath of selectedModels) {
        const existingModel = await window.electron.getModel(filePath);
        
        const modelData = {
          filePath,
          ...(designer && { designer }), // Only include designer if explicitly set
          ...(source && { source }),
          ...(parent && { parentModel: parent }),
          ...(license && { license }),
          printed: printed,
          tags: tags.length > 0 ? tags : (existingModel.tags || []) // Keep tag logic simple here, merging is in auto-save
        };

        await window.electron.saveModel(modelData);
        await updateModelElement(filePath);
      }

      // Clear selection and hide multi-edit panel
      selectedModels.clear();
      isMultiSelectMode = false;
      document.getElementById('multi-edit-panel').classList.add('hidden');
      document.getElementById('model-details').classList.remove('hidden');
      document.getElementById('edit-mode-toggle').textContent = 'Multi-Edit Mode';
      document.getElementById('edit-mode-toggle').classList.remove('active');

      // Clear the multi-edit tag container to prevent stacking
      const multiTagsContainer = document.getElementById('multi-tags');
      if (multiTagsContainer) {
        multiTagsContainer.innerHTML = '';
      }
      
      // Reset the multi-tag-select dropdown
      const multiTagSelect = document.getElementById('multi-tag-select');
      if (multiTagSelect) {
        multiTagSelect.value = '';
      }
      
      // Reset selection tracking to ensure tags are cleared on next selection
      previousSelectionHash = '';

      // Reapply filters to refresh the view
      await refreshModelDisplay();

    } catch (error) {
      console.error('Error saving multiple models:', error);
    }
  });

  // Add open file button handler
  // open-file-button removed - folders in path tree are now directly clickable

  await populateDesignerDropdown();
  await populateLicenseFilter();
  await populateParentModelFilter();
  await populateTagFilter();

  // Add parent model dialog event listeners
  const newParentDialog = document.getElementById('new-parent-dialog');
  const addParentButton = document.getElementById('add-parent-button');
  const cancelParentButton = document.getElementById('cancel-parent-button');
  const newParentForm = newParentDialog.querySelector('form');

  document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-parent-dialog');
      const input = document.getElementById('new-parent-name');
      
      // Reset form and input state
      dialog.querySelector('form').reset();
      input.value = '';
      
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
      
      // Show dialog and focus input
      dialog.showModal();
      
      // Force proper input state
      requestAnimationFrame(() => {
          input.disabled = false;
          input.readOnly = false;
          input.blur();
          input.focus();
      });
    });
  });

  if (cancelParentButton) {
    cancelParentButton.addEventListener('click', () => {
      document.getElementById('new-parent-name').value = '';
      newParentDialog.close();
    });
  }

  if (newParentForm) {
    newParentForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newParentName = document.getElementById('new-parent-name').value.trim();
      const sourceDropdownId = newParentDialog.dataset.sourceDropdown || 'model-parent';
      
      if (newParentName) {
        // Trigger auto-save first
        if (sourceDropdownId === 'multi-parent') {
          await autoSaveMultipleModels('parentModel', newParentName);
        } else if (sourceDropdownId === 'parent-select') {
          // For filter dropdown, we need to save to a model first
          // This shouldn't normally happen, but handle it gracefully
          const filePath = getCurrentModelFilePath();
          if (filePath) {
            await autoSaveModel('parentModel', newParentName, filePath);
          }
        } else {
          const filePath = getCurrentModelFilePath();
          await autoSaveModel('parentModel', newParentName, filePath);
        }

        // Repopulate all parent model dropdowns to ensure consistency
        await populateParentModelFilter(); // Filter dropdown
        if (sourceDropdownId === 'model-parent') {
          await populateParentModelDropdown(newParentName, 'model-parent');
        } else if (sourceDropdownId === 'multi-parent') {
          await populateParentModelDropdown(newParentName, 'multi-parent');
        } else if (sourceDropdownId === 'parent-select') {
          // Filter dropdown - already repopulated by populateParentModelFilter
          const parentSelect = document.getElementById('parent-select');
          if (parentSelect) {
            parentSelect.value = newParentName;
          }
        } else {
          // Fallback: manually add to the source dropdown if it's not one of the standard ones
          const parentSelect = document.getElementById(sourceDropdownId);
          if (parentSelect) {
            const optionExists = Array.from(parentSelect.options).some(opt => opt.value === newParentName);
            if (!optionExists) {
              const option = document.createElement('option');
              option.value = newParentName;
              option.textContent = newParentName;
              parentSelect.appendChild(option);
            }
            parentSelect.value = newParentName;
          }
        }
        
        // Clear the input and close the dialog
        document.getElementById('new-parent-name').value = '';
        newParentDialog.close();
      }
    });
  }



  // Remove the nested DOMContentLoaded listener and keep only one at the root level
  document.addEventListener('DOMContentLoaded', async () => {
    const tosAccepted = await checkTermsOfService();
    if (!tosAccepted) return;

    // Initialize filters (without search)
    // Note: sort-select is handled by search.js via initializeCombinedSearch()
    const filterElements = [
      'designer-select',
      'license-select',
      'parent-select',
      'printed-select',
      'tag-filter',
      'filetype-select'  // Add this line
    ];

    filterElements.forEach(elementId => {
      const element = document.getElementById(elementId);
      if (element) {
        element.addEventListener('change', handleFilterChange);
      }
    });

    // Rest of initialization...
    await initializeTags();
    await populateTagFilter();
    initializeListButtons();
  });

  // Remove the other DOMContentLoaded listener that's adding filter change handlers

  await initializeTags();
  initializeListButtons();

  // Update the tag filter event listener
  document.getElementById('tag-filter').addEventListener('change', async (event) => {
    const selectedTag = event.target.value;
    debugLog('Tag filter selected:', selectedTag);
    
    if (!selectedTag) {
      // If no tag selected, show all models
      const models = await window.electron.getAllModels();
      return;
    }

    try {
      // Get all models first
      const allModels = await window.electron.getAllModels();
      debugLog('Total models before filtering:', allModels.length);

      // Filter models that have the selected tag
      const filteredModels = [];
      for (const model of allModels) {
        const modelTags = await window.electron.getModelTags(model.id);
        if (modelTags && modelTags.some(tag => tag.name === selectedTag)) {
          filteredModels.push(model);
        }
      }

      debugLog('Filtered models by tag:', filteredModels.length);
    } catch (error) {
      console.error('Error filtering by tag:', error);
    }
  });

  await populateTagFilter();

  // Update the add button event listeners to handle both panels
  document.querySelectorAll('.add-designer-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-designer-dialog');
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
      dialog.showModal();
    });
  });

  document.querySelectorAll('.add-parent-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-parent-dialog');
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
      dialog.showModal();
    });
  });

  document.querySelectorAll('.add-tag-button').forEach(button => {
    button.addEventListener('click', async () => {
      // Get the container ID for the tags container - we'll need this to know where to add the tag
      const sourceContainer = button.closest('.tags-container').querySelector('.tags-list').id;
      
      // Use the HTML dialog instead of Electron's dialog
      const tagDialog = document.getElementById('new-tag-dialog');
      const newTagInput = document.getElementById('new-tag-name');
      
      // Clear any previous input
      if (newTagInput) {
        newTagInput.value = '';
      }
      
      // Store the source container ID on the dialog for reference when submitting
      tagDialog.setAttribute('data-source-container', sourceContainer);
      
      // Show the dialog
      tagDialog.showModal();
    });
  });
  
  // Handle the tag dialog submit
  document.getElementById('add-tag-submit')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const tagDialog = document.getElementById('new-tag-dialog');
    const newTagInput = document.getElementById('new-tag-name');
    const sourceContainer = tagDialog.getAttribute('data-source-container');
    
    if (newTagInput && newTagInput.value.trim()) {
      const tagName = newTagInput.value.trim();
      try {
        // First save the tag to the database
            const tag = await window.electron.saveTag(tagName);
            if (tag) {
              // Update all tag dropdowns
              await updateAllTagDropdowns();
              
          // Add the tag to the model(s)
          if (sourceContainer) {
            // Add the tag to the model using our helper function
                await addTagToModel(tagName, sourceContainer);
            console.log(`Added tag "${tagName}" to ${sourceContainer}`);
              }
          
          // Close the dialog
          tagDialog.close();
            }
          } catch (error) {
            console.error('Error adding tag:', error);
            await window.electron.showMessage('Error', 'Failed to add tag: ' + error.message);
        }
      }
    });
  
  // Handle the tag dialog cancel button
  document.getElementById('cancel-tag-button')?.addEventListener('click', () => {
    const tagDialog = document.getElementById('new-tag-dialog');
    tagDialog.close();
  });

  // Add open in browser button event listeners
  document.getElementById('open-source-button')?.addEventListener('click', async () => {
    const sourceInput = document.getElementById('model-source');
    const url = sourceInput.value.trim();
    
    if (!url) {
      await window.electron.showMessage('Error', 'Please enter a source URL');
      return;
    }

    try {
      // Validate URL format
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await window.electron.showMessage('Error', 'Please enter a valid URL starting with http:// or https://');
        return;
      }
      
      await window.electron.openExternal(url);
    } catch (error) {
      console.error('Error opening URL:', error);
      await window.electron.showMessage('Error', 'Failed to open URL: ' + error.message);
    }
  });

  document.getElementById('multi-open-source-button')?.addEventListener('click', async () => {
    const sourceInput = document.getElementById('multi-source');
    const url = sourceInput.value.trim();
    
    if (!url) {
      await window.electron.showMessage('Error', 'Please enter a source URL');
      return;
    }

    try {
      // Validate URL format
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        await window.electron.showMessage('Error', 'Please enter a valid URL starting with http:// or https://');
        return;
      }
      
      await window.electron.openExternal(url);
    } catch (error) {
      console.error('Error opening URL:', error);
      await window.electron.showMessage('Error', 'Failed to open URL: ' + error.message);
    }
  });


  // Add scan directory button event listener
  document.getElementById('scan-directory-button')?.addEventListener('click', async () => {
    if (isScanning) return; // Prevent multiple scans
    
    // First, check if there are any active filters and clear them
    const clearFilterButton = document.querySelector('.clear-filter-button');
    if (clearFilterButton) {
      console.log('Clearing filters before directory scan');
      clearFilterButton.click(); // Programmatically trigger the clear filters action
      // Wait a moment for the filter clearing to complete
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // Check if we're in server mode
    const serverMode = await window.electron.isServerMode();
    let directoryPath;
    
    if (serverMode) {
      // In server mode, prompt for UNC path via text input
      // Pre-fill with STL Home if it's set
      const stlHome = await window.electron.getSetting('stlHome');
      const defaultPath = stlHome && stlHome.trim() !== '' ? stlHome.trim() : '';
      const promptMessage = defaultPath 
        ? `Enter UNC path to scan (e.g., \\\\server\\share\\path):\n\nCurrent STL Home: ${defaultPath}`
        : 'Enter UNC path to scan (e.g., \\\\server\\share\\path):';
      const uncPath = prompt(promptMessage, defaultPath);
      if (!uncPath || uncPath.trim() === '') return;
      directoryPath = [uncPath.trim()];
    } else {
      // Normal mode: use file dialog
      directoryPath = await window.electron.openFileDialog();
      if (!directoryPath || directoryPath.length === 0) return;
    }

    await window.electron.saveDirectory(directoryPath[0]);
    console.log('Scanning directory:', directoryPath[0]);
    
    // Disable the button and update its appearance
    const scanButton = document.getElementById('scan-directory-button');
    scanButton.disabled = true;
    scanButton.style.opacity = '0.5';
    scanButton.style.cursor = 'not-allowed';
    isScanning = true;
    
    // Show progress section
    showProgressBars();
    
    try {
      // Update progress bars
      const progressSection = document.getElementById('progress-section');
      const progressContainer = document.getElementById('progress-container');
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      const renderProgressContainer = document.getElementById('render-progress-container');
      const renderProgressBar = document.getElementById('render-progress-bar');
      const renderProgressText = document.getElementById('render-progress-text');
      
      progressSection.classList.remove('hidden');
      progressContainer.classList.remove('hidden');
      renderProgressContainer.classList.remove('hidden');

      // Listen for progress updates
      window.electron.onScanProgress((progress) => {
        const percent = progress.total ? (progress.processed / progress.total) * 100 : 0;
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `Checking files: ${progress.processed || 0}`;
      });

      window.electron.onDbProgress((progress) => {
        const percent = progress.total ? (progress.processed / progress.total) * 100 : 0;
        renderProgressBar.style.width = `${percent}%`;
        renderProgressText.textContent = `Processing models: ${progress.processed} / ${progress.total}`;
      });

      // This function now handles both scanning and thumbnail generation
      await scanAndRenderDirectory(directoryPath[0]);

      // Update UI after scan completes
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();
      
      // Reset filters
      document.getElementById('designer-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      document.getElementById('tag-filter').value = '';

      // Load and display models
      const allModels = await window.electron.getAllModels();
      await renderFiles(allModels);
      
      // Update counts
      await updateModelCounts(allModels.length);

    } catch (error) {
      console.error('Error scanning directory:', error);
      await window.electron.showMessage('Error', 'Failed to scan directory');
    } finally {
      hideProgressBars();
      // Re-enable the button
      scanButton.disabled = false;
      scanButton.style.opacity = '1';
      scanButton.style.cursor = 'pointer';
      isScanning = false;
    }
  });
 

  // About dialog handler
  window.electron.onOpenAbout(async () => {
    console.log('Received open-about event'); // Debug log
    const dialog = document.getElementById('about-dialog');
    if (dialog) {
      try {
        await initializeAboutDialog(); // Make sure to await this
        console.log('About dialog initialized'); // Debug log
        dialog.showModal();
      } catch (error) {
        console.error('Error showing about dialog:', error);
      }
    } else {
      console.error('About dialog element not found');
    }
  });

  // Server Mode Info dialog handler
  window.electron.onOpenServerModeInfo(async () => {
    const dialog = document.getElementById('server-mode-info-dialog');
    if (dialog) {
      dialog.showModal();
    } else {
      console.error('Server Mode Info dialog element not found');
    }
  });

  // Stats dialog handler
  const statsDialog = document.getElementById('stats-dialog');
  if (statsDialog) {
    // Clean up charts when dialog closes (set up once, not per-open)
    statsDialog.addEventListener('close', () => {
      if (fileTypeChart) {
        fileTypeChart.destroy();
        fileTypeChart = null;
      }
      if (metadataChart) {
        metadataChart.destroy();
        metadataChart = null;
      }
    });
  }
  
  window.electron.onOpenStats(async () => {
    const dialog = document.getElementById('stats-dialog');
    if (dialog) {
      try {
        await initializeStatsDialog();
        dialog.showModal();
      } catch (error) {
        console.error('Error showing stats dialog:', error);
      }
    } else {
      console.error('Stats dialog element not found');
    }
  });

  // Chart instances storage
  let fileTypeChart = null;
  let metadataChart = null;

  // Initialize stats dialog with data
  async function initializeStatsDialog() {
    try {
      const stats = await window.electron.getStats();
      
      // Update total models
      document.getElementById('stats-total-models').textContent = stats.totalModels.toLocaleString();
      
      // Update file types
      document.getElementById('stats-type-3mf').textContent = stats.fileTypes.threeMf.toLocaleString();
      document.getElementById('stats-type-stl').textContent = stats.fileTypes.stl.toLocaleString();
      
      // Update archived models
      document.getElementById('stats-archived').textContent = stats.archivedModels.toLocaleString();
      
      // Update percentages
      document.getElementById('stats-percent-designer').textContent = stats.percentages.withDesigner + '%';
      document.getElementById('stats-percent-parent').textContent = stats.percentages.withParentModel + '%';
      document.getElementById('stats-percent-license').textContent = stats.percentages.withLicense + '%';
      document.getElementById('stats-percent-tags').textContent = stats.percentages.withTags + '%';
      
      // Update tags
      document.getElementById('stats-total-tags').textContent = stats.tags.total.toLocaleString();
      const mostUsedTagElement = document.getElementById('stats-most-used-tag');
      if (stats.tags.mostUsed) {
        mostUsedTagElement.textContent = `${stats.tags.mostUsed.name} (${stats.tags.mostUsed.count})`;
      } else {
        mostUsedTagElement.textContent = 'None';
      }
      
      // Destroy existing charts if they exist
      if (fileTypeChart) {
        fileTypeChart.destroy();
        fileTypeChart = null;
      }
      if (metadataChart) {
        metadataChart.destroy();
        metadataChart = null;
      }
      
      // Create pie chart for file types
      const fileTypeCanvas = document.getElementById('file-type-chart');
      if (fileTypeCanvas && typeof Chart !== 'undefined') {
        const ctx = fileTypeCanvas.getContext('2d');
        fileTypeChart = new Chart(ctx, {
          type: 'pie',
          data: {
            labels: ['3MF', 'STL'],
            datasets: [{
              data: [stats.fileTypes.threeMf, stats.fileTypes.stl],
              backgroundColor: [
                'rgba(74, 158, 255, 0.8)',
                'rgba(0, 212, 255, 0.8)'
              ],
              borderColor: [
                'rgba(74, 158, 255, 1)',
                'rgba(0, 212, 255, 1)'
              ],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: 'bottom',
                labels: {
                  color: '#e0e0e0',
                  font: {
                    size: 10
                  },
                  padding: 8,
                  boxWidth: 12
                }
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    const label = context.label || '';
                    const value = context.parsed || 0;
                    const total = context.dataset.data.reduce((a, b) => a + b, 0);
                    const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
                    return `${label}: ${value.toLocaleString()} (${percentage}%)`;
                  }
                }
              }
            }
          }
        });
      }
      
      // Create bar chart for metadata completion
      const metadataCanvas = document.getElementById('metadata-chart');
      if (metadataCanvas && typeof Chart !== 'undefined') {
        const ctx = metadataCanvas.getContext('2d');
        metadataChart = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: ['Designer', 'Parent', 'License', 'Tags'],
            datasets: [{
              label: 'Completion %',
              data: [
                parseFloat(stats.percentages.withDesigner),
                parseFloat(stats.percentages.withParentModel),
                parseFloat(stats.percentages.withLicense),
                parseFloat(stats.percentages.withTags)
              ],
              backgroundColor: [
                'rgba(74, 158, 255, 0.8)',
                'rgba(0, 212, 255, 0.8)',
                'rgba(91, 159, 255, 0.8)',
                'rgba(107, 170, 255, 0.8)'
              ],
              borderColor: [
                'rgba(74, 158, 255, 1)',
                'rgba(0, 212, 255, 1)',
                'rgba(91, 159, 255, 1)',
                'rgba(107, 170, 255, 1)'
              ],
              borderWidth: 1
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            indexAxis: 'y',
            scales: {
              x: {
                beginAtZero: true,
                max: 100,
                ticks: {
                  color: '#e0e0e0',
                  font: {
                    size: 9
                  },
                  callback: function(value) {
                    return value + '%';
                  }
                },
                grid: {
                  color: 'rgba(255, 255, 255, 0.1)'
                }
              },
              y: {
                ticks: {
                  color: '#e0e0e0',
                  font: {
                    size: 9
                  }
                },
                grid: {
                  color: 'rgba(255, 255, 255, 0.1)'
                }
              }
            },
            plugins: {
              legend: {
                display: false
              },
              tooltip: {
                callbacks: {
                  label: function(context) {
                    return context.parsed.x.toFixed(1) + '%';
                  }
                }
              }
            }
          }
        });
      }
    } catch (error) {
      console.error('Error initializing stats dialog:', error);
      throw error;
    }
  }

  // Website link handler
  document.getElementById('website-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    window.electron.showItemInFolder('https://printventory.com');
  });

  // Initialize new designer dialog handlers
  if (newDesignerDialog) {
    newDesignerDialog.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newDesignerName = document.getElementById('new-designer-name').value.trim();
      const sourceDropdownId = newDesignerDialog.dataset.sourceDropdown || 'model-designer';
      
      if (newDesignerName) {
        const designerSelect = document.getElementById(sourceDropdownId);
        if (designerSelect) {
          const option = document.createElement('option');
          option.value = newDesignerName;
          option.textContent = newDesignerName;
          designerSelect.appendChild(option);
          designerSelect.value = newDesignerName;
          
          // Trigger auto-save
          if (sourceDropdownId === 'multi-designer') {
            await autoSaveMultipleModels('designer', newDesignerName);
          } else {
            const filePath = getCurrentModelFilePath();
            await autoSaveModel('designer', newDesignerName, filePath);
          }
        }
        
        // Clear the input and close the dialog immediately
        document.getElementById('new-designer-name').value = '';
        document.getElementById('new-designer-dialog').close();
      }
    });

    document.getElementById('cancel-designer-button')?.addEventListener('click', () => {
      document.getElementById('new-designer-name').value = '';
      newDesignerDialog.close();
    });
  }

  // Add new designer button handlers
  document.querySelectorAll('.add-designer-button, #add-new-designer-button').forEach(button => {
    button?.addEventListener('click', () => {
      if (newDesignerDialog) {
        const sourceDropdownId = button.closest('.designer-input-container')?.querySelector('select')?.id;
        newDesignerDialog.dataset.sourceDropdown = sourceDropdownId;
        newDesignerDialog.showModal();
      }
    });
  });

  // Add license dialog event listeners
  const newLicenseDialog = document.getElementById('new-license-dialog');
  const cancelLicenseButton = document.getElementById('cancel-license-button');
  const newLicenseForm = newLicenseDialog.querySelector('form');

  // Add click handlers for the add license buttons
  document.querySelectorAll('.add-license-button, #add-new-license-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-license-dialog');
      const input = document.getElementById('new-license-name');
      
      // Reset form and input state
      dialog.querySelector('form').reset();
      input.value = '';
      
      // Store which dropdown triggered the dialog
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-license';
      
      // Show dialog and focus input
      dialog.showModal();
      
      // Force proper input state
      requestAnimationFrame(() => {
          input.disabled = false;
          input.readOnly = false;
          input.blur();
          input.focus();
      });
    });
  });

  // Add cancel button handler
  if (cancelLicenseButton) {
    cancelLicenseButton.addEventListener('click', () => {
      document.getElementById('new-license-name').value = '';
      newLicenseDialog.close();
    });
  }

  // Add form submit handler
  if (newLicenseForm) {
    newLicenseForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const newLicenseName = document.getElementById('new-license-name').value.trim();
      const sourceDropdownId = newLicenseDialog.dataset.sourceDropdown || 'model-license';
      
      if (newLicenseName) {
        // Trigger auto-save first
        if (sourceDropdownId === 'multi-license') {
          await autoSaveMultipleModels('license', newLicenseName);
        } else if (sourceDropdownId === 'license-select') {
          // For filter dropdown, we need to save to a model first
          const filePath = getCurrentModelFilePath();
          if (filePath) {
            await autoSaveModel('license', newLicenseName, filePath);
          }
        } else {
          const filePath = getCurrentModelFilePath();
          await autoSaveModel('license', newLicenseName, filePath);
        }
        
        // Clear the input and close the dialog immediately
        document.getElementById('new-license-name').value = '';
        document.getElementById('new-license-dialog').close();
        
        // Update all license dropdowns - repopulate from database to avoid duplicates
        await populateLicenseFilter(); // Filter dropdown
        if (sourceDropdownId === 'model-license') {
          await populateModelLicenseDropdown(newLicenseName, 'model-license');
        } else if (sourceDropdownId === 'multi-license') {
          await populateModelLicenseDropdown(newLicenseName, 'multi-license');
        } else if (sourceDropdownId === 'license-select') {
          // Filter dropdown - already repopulated by populateLicenseFilter
          const licenseSelect = document.getElementById('license-select');
          if (licenseSelect) {
            licenseSelect.value = newLicenseName;
          }
        }
      }
    });
  }

  // Initialize dialog handlers
  initializeDialogHandlers();

  // Add inside your DOMContentLoaded event listener
  window.electron.onOpenBackupRestore(() => {
    const dialog = document.getElementById('backup-restore-dialog');
    dialog.showModal();
  });

  document.getElementById('backup-button')?.addEventListener('click', async () => {
    try {
      const success = await window.electron.backupDatabase();
      if (success) {
        await window.electron.showMessage('Success', 'Database backup created successfully');
      }
    } catch (error) {
      console.error('Backup error:', error);
      await window.electron.showMessage('Error', 'Failed to create database backup');
    }
  });

  document.getElementById('restore-button')?.addEventListener('click', async () => {
    try {
      const result = await window.electron.showMessage(
        'Confirm Restore',
        'Warning: Restoring from backup will replace all current data. This cannot be undone. Continue?',
        ['Yes', 'No']
      );
      
      if (result === 'Yes') {
        const success = await window.electron.restoreDatabase();
        if (success) {
          await window.electron.showMessage('Success', 'Database restored successfully. The application will now reload.');
          window.location.reload();
        }
      }
    } catch (error) {
      console.error('Restore error:', error);
      await window.electron.showMessage('Error', 'Failed to restore database');
    }
  });

  document.getElementById('export-library-button')?.addEventListener('click', async () => {
    try {
      const success = await window.electron.exportLibrary();
      if (success) {
        await window.electron.showMessage('Success', 'Library exported successfully');
      }
    } catch (error) {
      console.error('Export library error:', error);
      await window.electron.showMessage('Error', 'Failed to export library');
    }
  });

  document.getElementById('import-library-button')?.addEventListener('click', async () => {
    try {
      const result = await window.electron.showMessage(
        'Confirm Import',
        'This will merge the imported library with your current library. Existing models will be updated. Continue?',
        ['Yes', 'No']
      );
      
      if (result === 'Yes') {
        const importResult = await window.electron.importLibrary();
        if (importResult && importResult.success) {
          const message = `Library imported successfully. ${importResult.imported} new models added, ${importResult.updated} models updated.`;
          await window.electron.showMessage('Success', message);
          // Refresh the grid to show imported models
          if (typeof refreshModelDisplay === 'function') {
            await refreshModelDisplay();
          }
        }
      }
    } catch (error) {
      console.error('Import library error:', error);
      await window.electron.showMessage('Error', 'Failed to import library: ' + (error.message || 'Unknown error'));
    }
  });

  document.getElementById('save-backup-restore')?.addEventListener('click', () => {
    document.getElementById('backup-restore-dialog').close();
  });

  // Add after your existing event listeners in DOMContentLoaded
  window.electron.onOpenDeDup(() => {
    const dialog = document.getElementById('dedup-dialog');
    // Reset the checkbox to unchecked when dialog is first opened
    const includeZipCheckbox = dialog.querySelector('#include-zipped-models');
    if (includeZipCheckbox) {
      includeZipCheckbox.checked = false;
    }
    loadDuplicateFiles();
  });

  // Add this with other event listeners in the DOMContentLoaded section
  document.getElementById('view-library-button')?.addEventListener('click', async () => {
    try {
      // Reset all filter dropdowns
      document.getElementById('designer-select').value = '';
      document.getElementById('license-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      document.getElementById('tag-filter').value = '';
      document.getElementById('filetype-select').value = '';
      document.getElementById('search-filter-input').value = '';
      
      // Explicitly clear the directory filter
      window.currentDirectoryFilter = "";
      
      // Hide the "Showing 100 Newest Models" message
      const viewLibMsg = document.getElementById("view-library-message");
      if (viewLibMsg) {
        viewLibMsg.style.display = "none";
      }
      
      // Flag that we're viewing the entire library
      window.viewingEntireLibrary = true;
      
      // Clear the filter indicator
      const filterIndicator = document.getElementById('current-filter');
      if (filterIndicator) {
        filterIndicator.innerHTML = "";
        filterIndicator.classList.remove('visible');
      }
      
      // Use the combined search function to retrieve and display models with all filters applied correctly
      await window.performCombinedSearch();
      
      console.log("Viewing entire library");
    } catch (error) {
      console.error('Error loading library:', error);
      await window.electron.showMessage('Error', 'Failed to load library.');
    }
  });

  // Add Tag Manager functionality
  window.electron.onOpenTagManager(() => {
    const tagManagerDialog = document.getElementById('tag-manager-dialog');
    refreshTagManagerList();
    tagManagerDialog.showModal();
    
    // Clear search when opening
    document.getElementById('tag-manager-search').value = '';
  });

  // Add close event handler to refresh UI when tag manager closes
  const tagManagerDialog = document.getElementById('tag-manager-dialog');
  if (tagManagerDialog) {
    tagManagerDialog.addEventListener('close', async () => {
      try {
        // Small delay to ensure database writes are flushed
        await new Promise(resolve => setTimeout(resolve, 150));
        
        // Clear the model cache to force fresh data
        const container = document.querySelector('.file-grid');
        if (container) {
          container.currentModels = null; // Clear cache to force re-render
        }
        
        // Refresh tag dropdowns in edit view
        await populateTagSelect('tag-select', 'model-tags');
        await populateTagSelect('multi-tag-select', 'multi-tags');
        
        // Refresh tag filter dropdown
        await populateTagFilter();
        
        // Refresh tag list in edit view if a model is currently being edited
        const currentModelPath = getCurrentModelFilePath() || currentModelDetailsPath;
        if (currentModelPath) {
          await loadModelTags(currentModelPath);
        }
        
        // Force a full grid refresh to show updated tags on all model cards
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          // Fallback: Get current sort option and refresh the grid
          const sortSelect = document.getElementById('sort-select');
          const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
          await renderFiles(models);
        }
        
        // Update all visible model elements to refresh their tags
        // This ensures tags are updated even if the grid doesn't fully re-render
        const allFileItems = document.querySelectorAll('.file-item');
        for (const item of allFileItems) {
          const filePath = item.getAttribute('data-filepath') || item.dataset.filepath;
          if (filePath) {
            await updateModelElement(filePath);
          }
        }
      } catch (error) {
        console.error('Error refreshing UI after tag manager close:', error);
      }
    });
  }

  let allTags = []; // Store all tags for filtering

  async function refreshTagManagerList(searchTerm = '') {
    const tagList = document.getElementById('tag-manager-list');
    tagList.innerHTML = '';
    
    try {
      // Get all tags if we don't have them yet or if no search term
      if (allTags.length === 0 || !searchTerm) {
        allTags = await window.electron.getAllTags();
      }
      
      // Filter tags based on search term
      const filteredTags = searchTerm 
        ? allTags.filter(tag => tag.name.toLowerCase().includes(searchTerm.toLowerCase()))
        : allTags;
      
      // Sort tags alphabetically by name
      filteredTags.sort((a, b) => a.name.localeCompare(b.name));
      
      filteredTags.forEach(tag => {
        const tagElement = document.createElement('div');
        tagElement.className = 'tag';
        tagElement.setAttribute('title', tag.name); // Show full tag name on hover
        tagElement.innerHTML = `
          <span class="tag-text">${tag.name}</span>
          <span class="tag-count">${tag.model_count}</span>
          <span class="tag-remove">×</span>
        `;
        
        tagElement.querySelector('.tag-remove')?.addEventListener('click', async () => {
          if (tag.model_count > 0) {
            const response = await window.electron.showMessage(
              'Delete Tag',
              `This tag is used by ${tag.model_count} model(s). Are you sure you want to delete it?`,
              ['Yes', 'No']
            );
            if (response !== 'Yes') return;
          }
          
          try {
            await window.electron.deleteTag(tag.id);
            allTags = []; // Reset tags cache to force refresh
            await refreshTagManagerList(searchTerm);
            // Also refresh other tag-related UI elements
            await populateTagSelect('tag-select', 'model-tags');
            await populateTagSelect('multi-tag-select', 'multi-tags');
            await populateTagFilter();
            
            // Refresh tag list in edit view if a model is currently being edited
            const currentModelPath = getCurrentModelFilePath() || currentModelDetailsPath;
            if (currentModelPath) {
              await loadModelTags(currentModelPath);
            }
            
            // Refresh the grid to show updated tags on model cards
            if (typeof window.performCombinedSearch === 'function') {
              await window.performCombinedSearch();
            } else {
              // Fallback: Get current sort option and refresh the grid
              const sortSelect = document.getElementById('sort-select');
              const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
              await renderFiles(models);
            }
          } catch (error) {
            console.error('Error deleting tag:', error);
            await window.electron.showMessage('Error', 'Failed to delete tag');
          }
        });
        
        tagList.appendChild(tagElement);
      });
    } catch (error) {
      console.error('Error loading tags:', error);
    }
  }

  // Add search functionality
  document.getElementById('tag-manager-search').addEventListener('input', debounce(async (e) => {
    await refreshTagManagerList(e.target.value.trim());
  }, 300));

  // Add clear search functionality
  document.getElementById('clear-tag-search')?.addEventListener('click', async () => {
    const searchInput = document.getElementById('tag-manager-search');
    searchInput.value = '';
    await refreshTagManagerList();
  });

  document.getElementById('add-tag-manager-button')?.addEventListener('click', async () => {
    const input = document.getElementById('new-tag-manager-name');
    const tagName = input.value.trim();
    
    if (tagName) {
      try {
        await window.electron.saveTag(tagName);
        input.value = '';
        allTags = []; // Reset tags cache to force refresh
        const searchTerm = document.getElementById('tag-manager-search').value.trim();
        await refreshTagManagerList(searchTerm);
        // Also refresh other tag-related UI elements
        await populateTagSelect();
        await populateTagFilter();
      } catch (error) {
        console.error('Error saving tag:', error);
        await window.electron.showMessage('Error', 'Failed to create tag');
      }
    }
  });

  // Add this event listener in your DOMContentLoaded section
  window.electron.onOpenPurgeModels((_event) => {
    const dialog = document.getElementById('purge-models-dialog');
    dialog.showModal();
  });

  // Metadata Editor functionality
  let allMetadata = []; // Store all metadata for filtering
  let currentMetadataType = 'designer'; // Track current active tab
  let metadataEditorChanged = false; // Track if any changes were made

  window.electron.onOpenMetadataEditor(() => {
    const metadataDialog = document.getElementById('metadata-editor-dialog');
    currentMetadataType = 'designer';
    metadataEditorChanged = false; // Reset change flag when opening
    updateMetadataTabs();
    refreshMetadataList('designer');
    metadataDialog.showModal();
    
    // Clear search when opening
    const searchInput = document.getElementById('metadata-editor-search');
    if (searchInput) {
      searchInput.value = '';
    }

    // Initialize tab button event listeners (in case they weren't set up yet)
    initializeMetadataTabs();
    initializeMetadataSearch();

    // Refresh grid when dialog closes (only if changes were made)
    const closeHandler = async () => {
      if (metadataEditorChanged) {
        // Force full grid re-render by clearing cache
        const container = document.querySelector('.file-grid');
        if (container) {
          container.currentModels = null; // Clear cache to force re-render
        }
        // Small delay to ensure database writes are flushed
        await new Promise(resolve => setTimeout(resolve, 100));
        // Refresh the grid to show updated metadata values
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          // Fallback: Get current sort option and refresh the grid
          const sortSelect = document.getElementById('sort-select');
          const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
          await renderFiles(models);
        }
        metadataEditorChanged = false; // Reset flag after refresh
      }
    };
    
    // Remove any existing listener and add new one
    metadataDialog.removeEventListener('close', closeHandler);
    metadataDialog.addEventListener('close', closeHandler);
  });

  // Tab switching functionality - initialize when dialog is available
  function initializeMetadataTabs() {
    document.querySelectorAll('.metadata-tab').forEach(tab => {
      // Remove existing listeners to avoid duplicates
      const newTab = tab.cloneNode(true);
      tab.parentNode.replaceChild(newTab, tab);
      
      newTab.addEventListener('click', () => {
        const type = newTab.dataset.type;
        currentMetadataType = type;
        updateMetadataTabs();
        refreshMetadataList(type);
        // Clear search when switching tabs
        const searchInput = document.getElementById('metadata-editor-search');
        if (searchInput) {
          searchInput.value = '';
        }
      });
    });
  }

  // Initialize tabs on DOMContentLoaded as well
  document.addEventListener('DOMContentLoaded', () => {
    initializeMetadataTabs();
  });

  function updateMetadataTabs() {
    document.querySelectorAll('.metadata-tab').forEach(tab => {
      if (tab.dataset.type === currentMetadataType) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Update label
    const label = document.getElementById('metadata-type-label');
    const labels = {
      'designer': 'Designers',
      'parentModel': 'Parent Models',
      'license': 'Licenses'
    };
    if (label) {
      label.textContent = labels[currentMetadataType] || 'Metadata';
    }
  }

  async function refreshMetadataList(type, searchTerm = '') {
    const metadataList = document.getElementById('metadata-editor-list');
    metadataList.innerHTML = '';
    
    try {
      // Always refresh metadata to ensure we have the latest data
      allMetadata = await window.electron.getAllMetadata();
      
      // Filter metadata by type and search term
      let filteredMetadata = allMetadata.filter(item => item.type === type);
      
      // Further filter by search term if provided
      if (searchTerm) {
        filteredMetadata = filteredMetadata.filter(item => 
          item.name.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
      
      // Sort alphabetically by name
      filteredMetadata.sort((a, b) => a.name.localeCompare(b.name));
      
      if (filteredMetadata.length === 0) {
        metadataList.innerHTML = '<div class="no-metadata">No items found</div>';
        return;
      }
      
      filteredMetadata.forEach(item => {
        const itemElement = document.createElement('div');
        itemElement.className = 'metadata-item';
        itemElement.innerHTML = `
          <span class="metadata-name">${escapeHtml(item.name)}</span>
          <span class="metadata-count">${item.model_count}</span>
          <button type="button" class="metadata-rename" title="Rename">✎</button>
          <button type="button" class="metadata-delete" title="Delete">×</button>
        `;
        
        // Rename functionality
        itemElement.querySelector('.metadata-rename')?.addEventListener('click', async () => {
          const newName = await window.electron.showInputDialog({
            title: `Rename ${type === 'designer' ? 'Designer' : type === 'parentModel' ? 'Parent Model' : 'License'}`,
            message: `Enter new name for "${item.name}":`,
            defaultValue: item.name,
            placeholder: 'Enter new name...'
          });
          
          if (newName && newName.trim() !== '' && newName.trim() !== item.name) {
            try {
              // Check if the new name already exists (merge scenario)
              const trimmedNewName = newName.trim();
              const existingItem = allMetadata.find(m => 
                m.type === type && 
                m.name.toLowerCase() === trimmedNewName.toLowerCase() &&
                m.name !== item.name
              );
              
              let shouldProceed = true;
              
              // If merging, show confirmation dialog
              if (existingItem) {
                const confirmResult = await window.electron.showMessageBox({
                  type: 'question',
                  title: 'Merge Metadata',
                  message: `A ${type === 'designer' ? 'designer' : type === 'parentModel' ? 'parent model' : 'license'} with the name "${trimmedNewName}" already exists.`,
                  detail: `This will merge "${item.name}" (${item.model_count} model${item.model_count !== 1 ? 's' : ''}) into "${trimmedNewName}" (${existingItem.model_count} model${existingItem.model_count !== 1 ? 's' : ''}).`,
                  buttons: ['Merge', 'Cancel'],
                  defaultId: 0,
                  cancelId: 1
                });
                
                shouldProceed = confirmResult.response === 0;
              }
              
              if (shouldProceed) {
                const result = await window.electron.renameMetadata(type, item.name, trimmedNewName);
                metadataEditorChanged = true; // Mark that changes were made
                allMetadata = []; // Reset cache to force refresh
                await refreshMetadataList(type, searchTerm);
                // Refresh all relevant dropdowns
                await refreshMetadataDropdowns();
                // Force full grid re-render by clearing cache
                const container = document.querySelector('.file-grid');
                if (container) {
                  container.currentModels = null; // Clear cache to force re-render
                }
                // Refresh the grid immediately to show updated metadata values
                // Small delay to ensure database write is complete
                await new Promise(resolve => setTimeout(resolve, 50));
                if (typeof window.performCombinedSearch === 'function') {
                  await window.performCombinedSearch();
                } else {
                  const sortSelect = document.getElementById('sort-select');
                  const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
                  await renderFiles(models);
                }
                
                // Show success message if merge occurred
                if (result.merged) {
                  await window.electron.showMessage('Success', 
                    `Successfully merged "${item.name}" into "${trimmedNewName}". ${result.updated} model${result.updated !== 1 ? 's' : ''} updated.`);
                }
              }
            } catch (error) {
              console.error('Error renaming metadata:', error);
              await window.electron.showMessage('Error', error.message || 'Failed to rename');
            }
          }
        });
        
        // Delete functionality
        itemElement.querySelector('.metadata-delete')?.addEventListener('click', async () => {
          const typeLabel = type === 'designer' ? 'Designer' : type === 'parentModel' ? 'Parent Model' : 'License';
          const response = await window.electron.showMessage(
            `Delete ${typeLabel}`,
            `This ${typeLabel.toLowerCase()} is used by ${item.model_count} model(s). Are you sure you want to delete it?`,
            ['Yes', 'No']
          );
          
          if (response === 'Yes') {
            try {
              await window.electron.deleteMetadata(type, item.name);
              metadataEditorChanged = true; // Mark that changes were made
              allMetadata = []; // Reset cache to force refresh
              await refreshMetadataList(type, searchTerm);
              // Refresh all relevant dropdowns
              await refreshMetadataDropdowns();
              // Force full grid re-render by clearing cache
              const container = document.querySelector('.file-grid');
              if (container) {
                container.currentModels = null; // Clear cache to force re-render
              }
              // Refresh the grid immediately to show updated metadata values
              // Small delay to ensure database write is complete
              await new Promise(resolve => setTimeout(resolve, 50));
              if (typeof window.performCombinedSearch === 'function') {
                await window.performCombinedSearch();
              } else {
                const sortSelect = document.getElementById('sort-select');
                const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
                await renderFiles(models);
              }
            } catch (error) {
              console.error('Error deleting metadata:', error);
              await window.electron.showMessage('Error', 'Failed to delete');
            }
          }
        });
        
        metadataList.appendChild(itemElement);
      });
    } catch (error) {
      console.error('Error loading metadata:', error);
      metadataList.innerHTML = '<div class="error-message">Error loading metadata</div>';
    }
  }

  async function refreshMetadataDropdowns() {
    // Refresh designer dropdowns
    if (typeof populateDesignerDropdown === 'function') {
      await populateDesignerDropdown();
    }
    if (typeof populateModelDesignerDropdown === 'function') {
      await populateModelDesignerDropdown(null, 'model-designer');
      await populateModelDesignerDropdown(null, 'multi-designer');
    }
    
    // Refresh parent model dropdowns
    if (typeof populateParentModelFilter === 'function') {
      await populateParentModelFilter();
    }
    if (typeof populateParentModelDropdown === 'function') {
      await populateParentModelDropdown(null, 'model-parent');
      await populateParentModelDropdown(null, 'multi-parent');
    }
    
    // Refresh license dropdowns
    if (typeof populateLicenseFilter === 'function') {
      await populateLicenseFilter();
    }
    if (typeof populateModelLicenseDropdown === 'function') {
      await populateModelLicenseDropdown(null, 'model-license');
      await populateModelLicenseDropdown(null, 'multi-license');
    }
  }

  // Helper function to escape HTML
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Add search functionality - initialize when available
  function initializeMetadataSearch() {
    const metadataSearchInput = document.getElementById('metadata-editor-search');
    if (metadataSearchInput) {
      // Remove existing listener to avoid duplicates
      const newInput = metadataSearchInput.cloneNode(true);
      metadataSearchInput.parentNode.replaceChild(newInput, metadataSearchInput);
      
      newInput.addEventListener('input', debounce(async (e) => {
        await refreshMetadataList(currentMetadataType, e.target.value.trim());
      }, 300));
    }

    // Add clear search functionality
    const clearButton = document.getElementById('clear-metadata-search');
    if (clearButton) {
      // Remove existing listener to avoid duplicates
      const newButton = clearButton.cloneNode(true);
      clearButton.parentNode.replaceChild(newButton, clearButton);
      
      newButton.addEventListener('click', async () => {
        const searchInput = document.getElementById('metadata-editor-search');
        if (searchInput) {
          searchInput.value = '';
          await refreshMetadataList(currentMetadataType);
        }
      });
    }
  }

  // Initialize search on DOMContentLoaded
  document.addEventListener('DOMContentLoaded', () => {
    initializeMetadataSearch();
  });

  // Handle regenerate thumbnails from Tools menu
  window.electron.on('regenerate-thumbnails', async () => {
    try {
      // Get all models
      const sortSelect = document.getElementById('sort-select');
      const allModels = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
      
      if (allModels.length === 0) {
        await window.electron.showMessage('Information', 'No models found in the database.');
        return;
      }
      
      // Ask for user confirmation
      const userChoice = await window.electron.showMessage(
        'Regenerate Thumbnails',
        `This will regenerate thumbnails for all ${allModels.length} models. This may take a while. Continue?`,
        ['Yes', 'No']
      );
      
      if (userChoice === 'Yes') {
        // Purge existing thumbnails to force regeneration
        await window.electron.purgeThumbnails();
        
        // Regenerate thumbnails for all models
        await generateThumbnailsForModels(allModels);
        
        await window.electron.showMessage('Success', 'Thumbnail regeneration completed successfully.');
        
        // Refresh the grid to show the new thumbnails
        const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
        await renderFiles(models);
      }
    } catch (error) {
      console.error('Error regenerating thumbnails:', error);
      await window.electron.showMessage('Error', 'Failed to regenerate thumbnails: ' + error.message);
    }
  });

  // Handle generate missing thumbnails from Tools menu
  window.electron.on('generate-missing-thumbnails', async () => {
    // Check if a thumbnail dialog is already showing
    if (isThumbnailDialogShowing) {
      return; // Exit early if dialog is already showing
    }
    
    try {
      // Get models without thumbnails (NULL, empty, or default '3d.png')
      const modelsWithoutThumbs = await window.electron.getModelsWithoutThumbnails();
      
      if (modelsWithoutThumbs.length === 0) {
        await window.electron.showMessage('Information', 'All models already have thumbnails. Nothing to generate.');
        return;
      }
      
      isThumbnailDialogShowing = true; // Set flag before showing dialog
      // Ask for user confirmation
      const userChoice = await window.electron.showMessage(
        'Generate Missing Thumbnails',
        `${modelsWithoutThumbs.length} models are missing thumbnails. Would you like to generate them now?`,
        ['Yes', 'No']
      );
      
      if (userChoice === 'Yes') {
        // Get full model data for the models without thumbnails
        const fullModels = [];
        for (const model of modelsWithoutThumbs) {
          const fullModel = await window.electron.getModel(model.filePath);
          if (fullModel) {
            fullModels.push(fullModel);
          }
        }
        
        // Generate thumbnails for models without them
        await generateThumbnailsForModels(fullModels);
        
        isThumbnailDialogShowing = false; // Reset flag after generation completes
        await window.electron.showMessage('Success', 'Thumbnail generation completed successfully.');
        
        // Refresh the grid to show the new thumbnails
        const sortSelect = document.getElementById('sort-select');
        const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc', 0);
        await renderFiles(models);
      } else {
        isThumbnailDialogShowing = false; // Reset flag if user clicks "No"
      }
    } catch (error) {
      console.error('Error generating missing thumbnails:', error);
      isThumbnailDialogShowing = false; // Reset flag on error
      await window.electron.showMessage('Error', 'Failed to generate missing thumbnails: ' + error.message);
    }
  });

  // Add purge confirmation handler
  document.getElementById('confirm-purge-button')?.addEventListener('click', async () => {
    try {
      const success = await window.electron.purgeModels();
      if (success) {
        // Clear the grid
        const container = document.querySelector('.file-grid');
        container.innerHTML = '';
        
        // Update model counts
        await updateModelCounts(0);
        
        // Close the dialog
        document.getElementById('purge-models-dialog').close();
        
        // Show success message
        await window.electron.showMessage('Success', 'All models have been purged from the database.');
        
        // Reset all filters and dropdowns
        document.getElementById('designer-select').value = '';
        document.getElementById('parent-select').value = '';
        document.getElementById('printed-select').value = 'all';
        document.getElementById('tag-filter').value = '';
        
 
      }
    } catch (error) {
      console.error('Error purging models:', error);
      await window.electron.showMessage('Error', 'Failed to purge models from the database.');
    }
  });

  // Sort-select handler is now managed by search.js via initializeCombinedSearch()
  // which properly calls performCombinedSearch() to re-render with filters preserved

  // Add this near the top of the file with other initialization code
  // Handle thumbnail added event - refresh grid to show updated thumbnail
  window.electron.onThumbnailAdded(async (data) => {
    if (data && data.filePath) {
      // Use a small delay to ensure database write is complete
      setTimeout(async () => {
        try {
          // Preserve dateAddedFilter if it's set (for new models view)
          const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
          
          // If dateAddedFilter is active, we should only update the specific item, not refresh the whole grid
          // This prevents clearing the filter when thumbnails are generated
          if (preservedDateAddedFilter) {
            console.log('Thumbnail added while dateAddedFilter is active, updating item only');
            
            // First, verify the model was updated in the database
            const updatedModel = await window.electron.getModel(data.filePath);
            if (!updatedModel || !updatedModel.thumbnail) {
              return;
            }
            
            // Check if this model matches the filter
            if (updatedModel.dateAdded) {
              const modelDateAdded = new Date(updatedModel.dateAdded);
              const filterDate = new Date(preservedDateAddedFilter);
              if (modelDateAdded < filterDate) {
                // This model doesn't match the dateAdded filter, don't refresh
                console.log('Thumbnail added for model outside dateAdded filter, skipping');
                return;
              }
            }
            
            // Restore the filter
            window.dateAddedFilter = preservedDateAddedFilter;
            window._lastDateAddedFilter = preservedDateAddedFilter;
            
            // Try to find and update the specific DOM element only
            const allFileItems = document.querySelectorAll('.file-item');
            const normalizedPath = normalizePathForComparison(data.filePath);
            
            for (const fileItem of allFileItems) {
              const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedPath) {
                // Update the model in currentModels array
                const container = document.querySelector('.file-grid');
                if (container && container.currentModels) {
                  const modelIndex = container.currentModels.findIndex(m => 
                    normalizePathForComparison(m.filePath) === normalizedPath
                  );
                  if (modelIndex >= 0) {
                    // Update the model with fresh data from database
                    container.currentModels[modelIndex] = { ...updatedModel };
                  }
                }
                
                // Remove the item so it gets recreated with updated thumbnail
                fileItem.remove();
                
                // Trigger re-render of visible items only (preserves filter)
                if (container && container.renderVisibleItemsFn) {
                  container.renderVisibleItemsFn();
                }
                
                // Don't call performCombinedSearch - just update the single item
                return;
              }
            }
            
            // If item wasn't found in current view, it might be filtered out or not visible
            // Don't refresh the whole grid - just return
            console.log('Thumbnail added for item not in current view, skipping refresh');
            return;
          }
          
          // If dateAddedFilter is NOT active, proceed with normal refresh behavior
          // First, verify the model was updated in the database
          const updatedModel = await window.electron.getModel(data.filePath);
          if (!updatedModel || !updatedModel.thumbnail) {
            return;
          }
          
          // Try to find and update the specific DOM element first
          const allFileItems = document.querySelectorAll('.file-item');
          const normalizedPath = normalizePathForComparison(data.filePath);
          let itemFound = false;
          
          for (const fileItem of allFileItems) {
            const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
            const normalizedItemPath = normalizePathForComparison(itemPath);
            if (normalizedItemPath === normalizedPath) {
              itemFound = true;
              
              // Update the model in currentModels array
              const container = document.querySelector('.file-grid');
              if (container && container.currentModels) {
                const modelIndex = container.currentModels.findIndex(m => 
                  normalizePathForComparison(m.filePath) === normalizedPath
                );
                if (modelIndex >= 0) {
                  // Update the model with fresh data from database
                  container.currentModels[modelIndex] = { ...updatedModel };
                }
              }
              
              // Remove the item so it gets recreated with updated thumbnail
              fileItem.remove();
              break;
            }
          }
          
          // Trigger re-render of visible items
          const container = document.querySelector('.file-grid');
          if (container && container.renderVisibleItemsFn) {
            container.renderVisibleItemsFn();
          }
          
          // If item wasn't found or we need a full refresh, do it
          if (!itemFound || !container || !container.renderVisibleItemsFn) {
            // Use performCombinedSearch to reload all models from database with current filters
            if (typeof window.performCombinedSearch === 'function') {
              await window.performCombinedSearch();
            } else {
              // Fallback: use onRefreshGrid handler approach
              const sortSelect = document.getElementById('sort-select');
              const models = await window.electron.getAllModels(sortSelect ? sortSelect.value : 'date-desc');
              await renderFiles(models);
            }
          }
        } catch (updateError) {
          console.error('Error refreshing grid after adding thumbnail:', updateError);
          // Fallback to full refresh on error, but preserve dateAddedFilter if set
          const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
          if (preservedDateAddedFilter) {
            window.dateAddedFilter = preservedDateAddedFilter;
            window._lastDateAddedFilter = preservedDateAddedFilter;
            const filteredModels = await window.electron.getModelsFiltered({
              dateAdded: preservedDateAddedFilter
            });
            await renderFiles(filteredModels);
          } else if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      }, 300); // Delay to ensure database write completes
    }
  });

  window.electron.onRefreshGrid(async () => {
    // Preserve dateAddedFilter if it's set
    const preservedDateAddedFilter = window.dateAddedFilter || window._lastDateAddedFilter;
    if (preservedDateAddedFilter) {
      console.log('onRefreshGrid called, preserving dateAddedFilter:', preservedDateAddedFilter);
      window.dateAddedFilter = preservedDateAddedFilter;
      window._lastDateAddedFilter = preservedDateAddedFilter;
    }
    
    // Clear all selected models from memory.
    selectedModels.clear();
    // Also clear any visual indication of selection.
    document.querySelectorAll('.file-item.selected').forEach(item => item.classList.remove('selected'));
    
    // Use performCombinedSearch to refresh the grid, which will preserve dateAddedFilter if set
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    } else {
      // Fallback: Get current sort option and refresh the grid.
      const sortSelect = document.getElementById('sort-select');
      // If dateAddedFilter is set, use filtered models
      if (preservedDateAddedFilter) {
        const filteredModels = await window.electron.getModelsFiltered({
          dateAdded: preservedDateAddedFilter
        });
        await renderFiles(filteredModels);
      } else {
        const models = await window.electron.getAllModels(sortSelect.value);
        await renderFiles(models);
      }
    }
  });

  // Add this near other dialog event listeners
  window.electron.onOpenThemeSettings(() => {
    // Rename the existing settings dialog to theme-dialog
    const themeDialog = document.getElementById('settings-dialog');
    themeDialog.showModal();
  });


  // Update the tag deletion handler
  async function deleteSelectedTags() {
    try {
      const selectedTagIds = Array.from(selectedTags);
      for (const tagId of selectedTagIds) {
        await window.electron.deleteTag(tagId);
      }
      
      // Reset the input state after successful deletion
      resetInputState();
      
      // Refresh the tag list
      await loadTags();
      
      // Refresh the model grid to update any models that had these tags
      await refreshGrid();
    } catch (error) {
      console.error('Error deleting tags:', error);
      await window.electron.showMessage('Error', 'Failed to delete tags: ' + error.message);
    }
  }

  // Make sure this event listener exists
  document.getElementById('delete-tag-button')?.addEventListener('click', async () => {
    if (selectedTags.size === 0) {
      await window.electron.showMessage('Error', 'Please select tags to delete');
      return;
    }

    const result = await window.electron.showMessageBox({
      type: 'warning',
      title: 'Delete Tags',
      message: `Are you sure you want to delete ${selectedTags.size} tag(s)?`,
      buttons: ['Yes', 'No'],
      defaultId: 1,
      cancelId: 1
    });

    if (result.response === 0) {
      await deleteSelectedTags();
    }
  });

  // Add this function to update all tag dropdowns
  async function updateAllTagDropdowns() {
    try {
      const tags = await window.electron.getAllTags();
      tags.sort((a, b) => a.name.localeCompare(b.name)); // Sort tags alphabetically
      const tagDropdowns = document.querySelectorAll('.tags-input-container select');
      
      tagDropdowns.forEach(dropdown => {
        // Save current selection
        const currentSelection = Array.from(dropdown.selectedOptions).map(opt => opt.value);
        
        // Clear existing options
        dropdown.innerHTML = '';
        
        // Add placeholder option first
        const placeholderOption = document.createElement('option');
        placeholderOption.value = '';
        placeholderOption.textContent = 'Select a tag...';
        dropdown.appendChild(placeholderOption);
        
        // Add tags
        tags.forEach(tag => {
          const option = document.createElement('option');
          option.value = tag.name;
          option.textContent = tag.name;
          option.selected = currentSelection.includes(tag.name);
          dropdown.appendChild(option);
        });
      });
    } catch (error) {
      console.error('Error updating tag dropdowns:', error);
    }
  }

  // NOTE: addTagToModel is defined at top level (line ~5637) - duplicate removed

  // Make sure the add-tag-button event listener is updated

  // Add this function to handle tag dropdown click
  async function refreshTagDropdown(dropdown) {
    try {
      const tags = await window.electron.getAllTags();
      
      // Save current selection
      const currentSelection = Array.from(dropdown.selectedOptions).map(opt => opt.value);
      
      // Clear existing options
      dropdown.innerHTML = '';
      
      // Add placeholder option first
      const placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Select a tag...';
      dropdown.appendChild(placeholderOption);
      
      // Add tags
      tags.forEach(tag => {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = tag.name;
        option.selected = currentSelection.includes(tag.name);
        dropdown.appendChild(option);
      });
    } catch (error) {
      console.error('Error refreshing tag dropdown:', error);
    }
  }

  // Add this in your DOMContentLoaded event listener
  document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Add click handlers to all tag dropdowns
    document.querySelectorAll('.tags-input-container select').forEach(dropdown => {
      dropdown.addEventListener('mousedown', async (event) => {
        // Prevent the default dropdown from showing immediately
        event.preventDefault();
        
        // Refresh the dropdown content
        await refreshTagDropdown(dropdown);
        
        // Show the dropdown
        dropdown.click();
      });
    });

    // Also add the handler for dynamically created dropdowns
    document.body.addEventListener('mousedown', async (event) => {
      if (event.target.matches('.tags-input-container select')) {
        event.preventDefault();
        await refreshTagDropdown(event.target);
        event.target.click();
      }
    });

    // ... rest of your existing code ...
  });

  // Add this near your other event listeners
  document.querySelectorAll('.refresh-tags-button').forEach(button => {
    button.addEventListener('click', async (event) => {
      const dropdown = event.target.closest('.tags-input-container').querySelector('select');
      if (dropdown) {
        // Use the refreshTagDropdown function for consistency
        await refreshTagDropdown(dropdown);
        
        // Add visual feedback
        const refreshButton = event.target;
        refreshButton.style.transform = 'rotate(360deg)';
        setTimeout(() => {
          refreshButton.style.transform = 'none';
        }, 200);
      }
    });
  });

  // Also add handler for dynamically created refresh buttons
  document.body.addEventListener('click', async (event) => {
    if (event.target.matches('.refresh-tags-button')) {
      const dropdown = event.target.closest('.tags-input-container').querySelector('select');
      if (dropdown) {
        await refreshTagDropdown(dropdown);
        
        // Optional: Add a visual feedback for refresh
        const refreshButton = event.target;
        refreshButton.style.transform = 'rotate(360deg)';
        setTimeout(() => {
          refreshButton.style.transform = 'none';
        }, 200);
      }
    }
  });


  // Add these event listeners for single-edit mode dropdowns
  document.getElementById('model-designer').addEventListener('change', async (e) => {
    const filePath = getCurrentModelFilePath();
    await autoSaveModel('designer', e.target.value, filePath);
  });

  document.getElementById('model-license').addEventListener('change', async (e) => {
    const filePath = getCurrentModelFilePath();
    await autoSaveModel('license', e.target.value, filePath);
  });

  // The parent model listener is already present but let's make sure it's consistent
  document.getElementById('model-parent').addEventListener('change', async (e) => {
    const filePath = getCurrentModelFilePath();
    await autoSaveModel('parentModel', e.target.value, filePath);
  });

  // Update the About dialog content in index.html
  const tosContent = `
  <h4>MIT License</h4>
  <p class="tos-copyright">Copyright (c) 2025 Printventory</p>
  <p>
    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:
  </p>
  <p>
    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.
  </p>
  <p class="tos-warning">
    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
  </p>
  <p>
    <strong>Data and Risk Disclaimer:</strong> You are solely responsible for backing up your data. 
    Use of this software is entirely at your own risk. The developers assume no liability for any 
    data loss, corruption, or damage.
  </p>
  `;

  // Add near the top where other constants are defined
  let MAX_FILE_SIZE_MB = 50;

  // Add this function to initialize performance settings
  async function initializePerformanceSettings() {
    try {
      // Load max file size setting
      const maxFileSize = await window.electron.getSetting('maxFileSizeMB') || '50';
      const input = document.getElementById('max-file-size');
      if (input) {
        input.value = maxFileSize;
        MAX_FILE_SIZE_MB = parseInt(maxFileSize);
      }
    } catch (error) {
      console.error('Error initializing performance settings:', error);
    }
  }

  async function savePerformanceSettings() {
    try {
      const input = document.getElementById('max-file-size');
      if (!input) {
        throw new Error('Could not find max file size input');
      }

      const maxFileSize = parseInt(input.value);
      
      // Validate input
      if (isNaN(maxFileSize) || maxFileSize < 1 || maxFileSize > 1000) {
        throw new Error('Invalid max file size. Must be between 1 and 1000 MB.');
      }

      // Save to database
      await window.electron.saveSetting('maxFileSizeMB', maxFileSize.toString());
      
      // Update the global variable
      MAX_FILE_SIZE_MB = maxFileSize;
      
      // Close dialog and show success message
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        dialog.close();
      }
      await window.electron.showMessage('Success', 'Performance settings saved successfully');
    } catch (error) {
      console.error('Error saving performance settings:', error);
      await window.electron.showMessage('Error', error.message);
    }
  }

  // Add performance settings event listeners
  document.addEventListener('DOMContentLoaded', async () => {
    // Initialize settings
    await initializeSettings();
    
    // Add performance settings dialog handlers
    window.electron.onOpenPerformanceSettings(() => {
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        initializePerformanceSettings();
        dialog.showModal();
      }
    });

    // Remove the form submit handler and only use the save button
    const saveButton = document.getElementById('save-performance-settings');
    if (saveButton) {
      saveButton.addEventListener('click', async () => {
        await savePerformanceSettings();
      });
    }

    const cancelButton = document.getElementById('cancel-performance-settings');
    if (cancelButton) {
      cancelButton.addEventListener('click', () => {
        const dialog = document.getElementById('performance-settings-dialog');
        if (dialog) {
          dialog.close();
        }
      });
    }
  });

  // Add performance settings dialog handler
  window.electron.onOpenPerformanceSettings(() => {
    const dialog = document.getElementById('performance-settings-dialog');
    initializePerformanceSettings();
    dialog.showModal();
  });

  document.getElementById('performance-settings-dialog').addEventListener('submit', async (event) => {
    event.preventDefault();
    
    try {
      const newBatchSize = parseInt(document.getElementById('batch-size').value);
      const newConcurrentRenders = parseInt(document.getElementById('concurrent-renders').value);
      const newMaxFileSize = parseInt(document.getElementById('max-file-size').value);
      const newThumbnailBatchSize = parseInt(document.getElementById('thumbnail-batch-size').value);
      const newRenderDelay = parseInt(document.getElementById('render-delay').value);

      // Validate inputs
      if (isNaN(newBatchSize) || newBatchSize < 1 || newBatchSize > 100) {
        throw new Error('Invalid batch size. Must be between 1 and 100.');
      }
      if (isNaN(newConcurrentRenders) || newConcurrentRenders < 1 || newConcurrentRenders > 10) {
        throw new Error('Invalid concurrent renders. Must be between 1 and 10.');
      }
      if (isNaN(newMaxFileSize) || newMaxFileSize < 1 || newMaxFileSize > 1000) {
        throw new Error('Invalid max file size. Must be between 1 and 1000 MB.');
      }
      if (isNaN(newThumbnailBatchSize) || newThumbnailBatchSize < 5 || newThumbnailBatchSize > 20) {
        throw new Error('Invalid thumbnail batch size. Must be between 5 and 20.');
      }
      if (isNaN(newRenderDelay) || newRenderDelay < 0 || newRenderDelay > 100) {
        throw new Error('Invalid render delay. Must be between 0 and 100 ms.');
      }

      // Save settings
      await window.electron.saveSetting('batchSize', newBatchSize.toString());
      await window.electron.saveSetting('maxConcurrentRenders', newConcurrentRenders.toString());
      await window.electron.saveSetting('maxFileSizeMB', newMaxFileSize.toString());
      await window.electron.saveSetting('thumbnailBatchSize', newThumbnailBatchSize.toString());
      await window.electron.saveSetting('renderDelay', newRenderDelay.toString());

      // Update variables
      BATCH_SIZE = newBatchSize;
      MAX_CONCURRENT_RENDERS = newConcurrentRenders;
      MAX_FILE_SIZE_MB = newMaxFileSize;
      THUMBNAIL_BATCH_SIZE = newThumbnailBatchSize;
      RENDER_DELAY = newRenderDelay;

      document.getElementById('performance-settings-dialog').close();
    } catch (error) {
      console.error('Error saving performance settings:', error);
      await window.electron.showMessage('Error', error.message);
    }
  });

  document.getElementById('cancel-performance-settings')?.addEventListener('click', () => {
    document.getElementById('performance-settings-dialog').close();
  });

  // Update the file scanning function to use MAX_FILE_SIZE_MB
  function isValidFile(filename, size) {
    const maxSize = MAX_FILE_SIZE_MB * 1024 * 1024;
    const isValid = (filename.toLowerCase().endsWith('.stl') || 
                    filename.toLowerCase().endsWith('.3mf')) && 
                    size <= maxSize;
    debugLog(`File validation: ${filename}, size: ${size}, max: ${maxSize}, valid: ${isValid}`);
    return isValid;
  }

  // Add this function to initialize all settings including performance settings
  async function initializeSettings() {
    try {
      // Initialize other settings as needed
      const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
      if (backgroundColor) {
        document.documentElement.style.setProperty('--model-background-color', backgroundColor);
        document.getElementById('model-background-color').value = backgroundColor;
      }
    } catch (error) {
      console.error('Error initializing settings:', error);
    }
  }

  // Call initializeSettings when the app starts
  document.addEventListener('DOMContentLoaded', async () => {
    await initializeSettings();
    // Rest of your initialization code...
  });

  // Performance settings handlers
  const savePerformanceButton = document.getElementById('save-performance-settings');
  if (savePerformanceButton) {
    savePerformanceButton.addEventListener('click', async () => {
      const input = document.getElementById('max-file-size');
      if (!input) {
        await window.electron.showMessage('Error', 'Could not find max file size input');
        return;
      }

      const maxFileSize = parseInt(input.value);
      if (isNaN(maxFileSize) || maxFileSize < 1 || maxFileSize > 1000) {
        await window.electron.showMessage('Error', 'Invalid max file size. Must be between 1 and 1000 MB.');
        return;
      }

      try {
        await window.electron.saveSetting('maxFileSizeMB', maxFileSize.toString());
        MAX_FILE_SIZE_MB = maxFileSize;
        const dialog = document.getElementById('performance-settings-dialog');
        if (dialog) {
          dialog.close();
        }
        await window.electron.showMessage('Success', 'Performance settings saved successfully');
      } catch (error) {
        console.error('Error saving performance settings:', error);
        await window.electron.showMessage('Error', error.message);
      }
    });
  }

  const cancelPerformanceButton = document.getElementById('cancel-performance-settings');
  if (cancelPerformanceButton) {
    cancelPerformanceButton.addEventListener('click', () => {
      const dialog = document.getElementById('performance-settings-dialog');
      if (dialog) {
        dialog.close();
      }
    });
  }

  window.electron.onOpenPerformanceSettings(() => {
    const dialog = document.getElementById('performance-settings-dialog');
    if (dialog) {
      const maxFileSize = window.electron.getSetting('maxFileSizeMB') || '50';
      const input = document.getElementById('max-file-size');
      if (input) {
        input.value = maxFileSize;
      }
      dialog.showModal();
    }
  });

  // ... rest of the existing code ...

  // Add this near the other electron event listeners
  window.electron.onDbCleanup(async (event, data) => {
    if (data.message) {
      await window.electron.showMessage('Database Cleanup', data.message);
    }
  });

  // 1. Implement thumbnail caching system
  const thumbnailCache = new Map();

  // 2. Optimize renderer settings and reuse renderer instance
  let sharedRenderer = null;
  let sharedCanvas = null;
  const MAX_CONTEXT_REUSE_COUNT = 100; // Number of renders before recreating context
  let contextUseCount = 0;

  function getSharedRenderer() {
    if (!sharedRenderer || contextUseCount >= MAX_CONTEXT_REUSE_COUNT) {
      // Clean up existing resources before creating new ones
      if (sharedRenderer) {
        sharedRenderer.dispose();
        sharedRenderer.forceContextLoss();
        sharedRenderer = null;
      }
      if (sharedCanvas) {
        sharedCanvas.remove();
        sharedCanvas = null;
      }

      // Create new canvas and renderer
      sharedCanvas = document.createElement('canvas');
      sharedCanvas.width = 250;
      sharedCanvas.height = 250;
      
      sharedRenderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        canvas: sharedCanvas,
        powerPreference: 'low-power',
        preserveDrawingBuffer: true // Add this for better context management
      });
      
      contextUseCount = 0;
      
      // Add context loss handler
      sharedCanvas.addEventListener('webglcontextlost', (event) => {
        event.preventDefault();
        sharedRenderer.dispose();
        sharedRenderer = null;
        sharedCanvas = null;
      }, false);
    }
    contextUseCount++;
    return sharedRenderer;
  }

  async function extract3MFThumbnail(filePath) {
    try {
      console.log(`[DEBUG] extract3MFThumbnail: Extracting images from ${filePath}`);
      const images = await window.electron.get3MFImages(filePath);
      if (images && images.length > 0) {
        console.log(`[DEBUG] extract3MFThumbnail: Found ${images.length} image(s) in 3MF file`);
        return images; // Return array of images
      } else {
        console.log(`[DEBUG] extract3MFThumbnail: No images found in 3MF file`);
        return null;
      }
    } catch (error) {
      console.error('extract3MFThumbnail error:', error);
      return null; // Or return null to indicate failure
    }
  }
  
  async function extract3MFSTL(filePath) {
    try {
      return await window.electron.get3MFSTL(filePath); // Direct return
    } catch (error) {
      console.error('extract3MFSTL error:', error);
      // throw error;  // Same consideration as above
      return null;
    }
  }

  // NOTE: renderModelToPNG is defined at top level (line ~5462) - duplicate removed
  
  function displayThumbnail(thumbnail, container, size) {
    const img = document.createElement('img');
    img.src = thumbnail;
    img.style.width = size;
    img.style.height = size;
    img.className = 'model-thumbnail'; // Add a class for styling (optional)
    container.innerHTML = ''; // Clear existing content
    container.appendChild(img);
    return thumbnail;
  }

  async function renderSTLThumbnail(filePath, container) {
    const renderer = getSharedRenderer();
    const thumbnailSize = '250px';
  
    let scene, camera, model;
  
    try {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  
      const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
      scene.add(light);
  
      model = await loadModel(filePath, {
        optimizeGeometry: true,
        skipMaterials: true
      });
  
      if (!model) {
        throw new Error('Failed to load model');
      }
  
      model.traverse(child => {
        if (child.isMesh) {
          child.material = new THREE.MeshBasicMaterial({ color: 0xcccccc });
        }
      });
  
      scene.add(model);
      fitCameraToObject(camera, model, scene, renderer);
  
      renderer.render(scene, camera);
      const imgData = renderer.domElement.toDataURL('image/png', 0.8);
  
      thumbnailCache.set(filePath, imgData);
  
      return displayThumbnail(imgData, container, thumbnailSize);
  
    } catch (error) {
      console.error('Error rendering STL:', error);
      return displayThumbnail('3d.png', container, thumbnailSize);
    } finally {
      // Clean up THREE.js resources
      if (scene) {
        scene.traverse((object) => {
          if (object.geometry) {
            object.geometry.dispose();
            object.geometry = null;
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(material => {
                material.dispose();
                material = null;
              });
            } else {
              object.material.dispose();
              object.material = null;
            }
          }
        });
        scene.clear();
        scene = null;
      }

      // Explicitly clean up the model
      if (model) {
        model.traverse(child => {
          if (child.geometry) {
            child.geometry.dispose();
            child.geometry = null;
          }
        });
        model = null;
      }

      // Reset renderer state but keep the instance
      if (sharedRenderer) {
        sharedRenderer.forceContextLoss();
        sharedRenderer.resetState();
        sharedRenderer.clear();
      }

      // Force garbage collection
      if (typeof gc === 'function') gc();
    }
  }
  

  // NOTE: processRenderQueue is defined at top level (line ~5316) - duplicate removed
  
  // 8. Add memory management
  function cleanupMemory() {
    if (thumbnailCache.size > 1000) { // Limit cache size
      const entriesToRemove = Array.from(thumbnailCache.keys()).slice(0, 500);
      entriesToRemove.forEach(key => thumbnailCache.delete(key));
    }
    
    if (sharedRenderer) {
      sharedRenderer.state.reset();
    }
  }

  // Add function for deep cleanup of Three.js resources
  function deepCleanThreeResources() {
    if (sharedRenderer) {
      sharedRenderer.forceContextLoss();
      sharedRenderer.dispose();
      sharedRenderer = null;
    }
    
    // Force garbage collection
    if (typeof gc === 'function') {
      gc();
      gc(); // Call twice to ensure full collection
    }
    
    // Clear texture cache
    THREE.Cache.clear();
  }

  // NOTE: loadModel is now defined at top level (line ~50) - duplicate removed



  // NOTE: refreshModelDisplay is defined at top level (line ~5093) - duplicate removed

  // Add this function to handle closing the details panel
  function closeDetailsPanel() {
    const detailsPanel = document.getElementById('model-details');
    if (detailsPanel) {
      detailsPanel.classList.add('hidden');
    }
  }

  // Update the click handler for file items
  function handleFileItemClick(element, filePath) {
    if (isMultiSelectMode) {
      // ... existing multi-select mode code ...
    } else {
      // Single select mode
      const wasSelected = element.classList.contains('selected');
      
      // Clear all selections first
      document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
      });

      if (wasSelected) {
        // If it was already selected, just deselect it and close details
        element.classList.remove('selected');
        closeDetailsPanel();
      } else {
        // If it wasn't selected, select it and show details
        element.classList.add('selected');
        showModelDetails(filePath);
      }
    }
  }

  // NOTE: renderFile is defined at top level (line ~5046) - duplicate removed

  // Add this function to filter by directory
  async function filterByDirectory(directoryPath) {
    try {
        const models = await window.electron.getModelsByDirectory(directoryPath);
        await displayModels(models);
    } catch (error) {
        console.error('Error filtering by directory:', error);
    }
  }

  // Add these constants at the top with other constants
  const ROULETTE_SPINS = 10; // Number of models to highlight before stopping
  const ROULETTE_INITIAL_DELAY = 100; // Initial delay between highlights in ms
  const ROULETTE_DELAY_INCREMENT = 20; // How much to slow down each spin

  // Add the roulette functionality
  async function startPrintRoulette() {
    // Get all visible models in the grid
    const visibleModels = Array.from(document.querySelectorAll('.file-item'));
    if (visibleModels.length === 0) return;

    // Clear any existing selections
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    // Close details panel if open
    const detailsPanel = document.getElementById('model-details');
    if (detailsPanel) {
      detailsPanel.classList.add('hidden');
    }

    let delay = ROULETTE_INITIAL_DELAY;
    let previousItem = null;

    // Function to highlight a random item.
    // Pass doScroll=true to scroll the item into view.
    const highlightRandom = (doScroll = false) => {
      if (previousItem) {
        previousItem.classList.remove('selected');
      }
      const randomIndex = Math.floor(Math.random() * visibleModels.length);
      const randomItem = visibleModels[randomIndex];
      randomItem.classList.add('selected');
      if (doScroll) {
        randomItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      previousItem = randomItem;
      return randomItem;
    };

    // Spin animation without scrolling (to avoid white flashes)
    for (let i = 0; i < ROULETTE_SPINS; i++) {
      await new Promise(resolve => setTimeout(resolve, delay));
      highlightRandom(); // no scrolling on intermediate spins
      delay += ROULETTE_DELAY_INCREMENT; // Gradually slow down
    }

    // Final selection with scrolling.
    const finalItem = highlightRandom(true);
    const filePath = finalItem.getAttribute('data-filepath');
    
    // Add winning animation class
    finalItem.classList.add('roulette-winner');
    setTimeout(() => finalItem.classList.remove('roulette-winner'), 3000);
    
    // Show model details and update selection state
    selectedModels.add(filePath);
    await showModelDetails(filePath);
    
    // Show celebration message
    await window.electron.showMessage(
      'Print Roulette',
      'Your next print has been chosen! 🎲\nTime to get printing!'
    );
  }

  // Add event listener for the menu item
  window.electron.onStartPrintRoulette(() => {
    startPrintRoulette();
  });

  // Add these functions at an appropriate location
  async function checkForUpdates(silent = false) {
    try {
      const currentVersion = await window.electron.getSetting('currentVersion');
      const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
      const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');
      
      console.log('Checking for updates:', {
        currentVersion,
        isBeta,
        lastDeclinedVersion,
        checkType: silent ? 'startup' : 'manual',
        endpoint: isBeta ? 'beta.version' : 'public.version'
      });
      
      // Get latest version from web
      const latestVersion = await window.electron.checkForUpdates(isBeta);
      if (!latestVersion) return;

      console.log('Version check result:', {
        currentVersion,
        latestVersion,
        lastDeclinedVersion,
        isBeta,
        needsUpdate: latestVersion !== currentVersion
      });

      // Store the latest version
      await window.electron.saveSetting('latestVersion', latestVersion);
      await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());

      // Compare versions
      // For manual checks (silent=false), ignore lastDeclinedVersion so user can check again
      // For automatic checks (silent=true), respect lastDeclinedVersion to avoid re-prompting
      const shouldCheckDeclined = silent; // Only check declined version on automatic checks
      const isUpdateAvailable = latestVersion && 
                                latestVersion !== currentVersion && 
                                compareVersions(latestVersion, currentVersion) > 0;
      const shouldShowPrompt = isUpdateAvailable && 
                               (!shouldCheckDeclined || latestVersion !== lastDeclinedVersion);
      
      if (shouldShowPrompt) {
        // Always show update prompt if there's an update
        const shouldUpdate = await window.electron.showMessage(
          'Update Available',
          `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
          ['Yes', 'No']
        );

        if (shouldUpdate === 'Yes') {
          await window.electron.openUpdatePage(isBeta);
        } else {
          // Store the declined version
          console.log('User declined update, storing version:', latestVersion);
          await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
        }
      } else if (!silent) {
        // For manual checks, show appropriate message
        if (isUpdateAvailable && latestVersion === lastDeclinedVersion) {
          // Update available but was previously declined
          await window.electron.showMessage(
            'Update Previously Declined',
            `Version ${latestVersion} is available, but you previously declined this update. You can still update by visiting the website.`
          );
        } else {
          // Actually up to date
          await window.electron.showMessage(
            'Up to Date',
            'You are running the latest version.'
          );
        }
      }
    } catch (error) {
      console.error('Error checking for updates:', error);
      if (!silent) {
        await window.electron.showMessage(
          'Error',
          'Failed to check for updates. Please try again later.'
        );
      }
    }
  }

  // Update the about dialog initialization
  async function initializeAboutDialog() {
    try {
      // Get both versions
      const currentVersion = await window.electron.getSetting('currentVersion');
      const latestVersion = await window.electron.getSetting('latestVersion');
      const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
      
      console.log('Initializing about dialog:', {
        currentVersion,
        latestVersion,
        isBeta
      });
      
      // Update version display
      const versionElement = document.getElementById('about-version');
      if (versionElement) {
        let versionText = `Version: ${currentVersion}${isBeta ? ' (Beta)' : ''}`;
        if (latestVersion && latestVersion !== currentVersion) {
          versionText += ` (${latestVersion} available)`;
        }
        versionElement.textContent = versionText;
      }

      // Set up beta opt-in
      const betaOptIn = document.getElementById('beta-opt-in');
      if (betaOptIn) {
        betaOptIn.checked = isBeta;
        betaOptIn.addEventListener('change', async (e) => {
          console.log('Beta opt-in changed:', e.target.checked);
          await window.electron.saveSetting('betaOptIn', e.target.checked.toString());
        });
      }

      // Set up check updates button
      const checkUpdatesButton = document.getElementById('check-updates-button');
      if (checkUpdatesButton) {
        checkUpdatesButton.addEventListener('click', () => {
          console.log('Check updates button clicked');
          checkForUpdates(false);
        });
      }
      
      // Initialize analytics checkbox
      const collectUsageCheckbox = document.getElementById('collect-usage');
      if (collectUsageCheckbox) {
        // Get initial value
        const collectUsage = await window.electron.getSetting('CollectUsage');
        console.log('About dialog - Initial CollectUsage value:', collectUsage);
        
        // Set checkbox state based on the actual value
        collectUsageCheckbox.checked = collectUsage === '1';
        
        // Remove any existing event listeners
        collectUsageCheckbox.removeEventListener('change', collectUsageChangeHandler);
        
        // Add new event listener
        collectUsageCheckbox.addEventListener('change', collectUsageChangeHandler);
      }

      // Set up close X button
      const closeXButton = document.querySelector('.about-close-x');
      if (closeXButton) {
        // Remove any existing event listeners by cloning and replacing
        const newCloseButton = closeXButton.cloneNode(true);
        closeXButton.parentNode.replaceChild(newCloseButton, closeXButton);
        
        newCloseButton.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const dialog = document.getElementById('about-dialog');
          if (dialog) {
            dialog.close();
          }
        });
      }

      // Set up license link
      const licenseLink = document.getElementById('license-link');
      if (licenseLink) {
        licenseLink.addEventListener('click', async (e) => {
          e.preventDefault();
          await window.electron.openExternal('https://github.com/TechJeeper/Printventory/blob/main/LICENSE.txt');
        });
      }
    } catch (error) {
      console.error('Error initializing about dialog:', error);
    }
  }
  
  // Define the collect usage change handler as a named function so we can remove it
  async function collectUsageChangeHandler(e) {
    const newValue = e.target.checked ? '1' : '0';
    console.log('About dialog - Saving CollectUsage value:', newValue);
    
    // Save the setting
    await window.electron.saveSetting('CollectUsage', newValue);
    
    // Verify the setting was saved correctly
    const verifiedValue = await window.electron.checkCollectUsage();
    console.log('Verified CollectUsage value from database:', verifiedValue);
    
    // Update the checkbox state to match the database value
    e.target.checked = verifiedValue === '1';
    
    // Toggle analytics based on the verified value
    toggleAnalytics(verifiedValue === '1');
  }

  // Remove any nested DOMContentLoaded listeners and consolidate into one
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Initialize all settings first
      await initializeSettings();
      
      // Initialize dialog handlers
      initializeDialogHandlers();
      
      // Initialize performance settings handlers
      initializePerformanceSettings();
      
      // Add about dialog handler
      window.electron.onOpenAbout(async () => {
        const dialog = document.getElementById('about-dialog');
        if (dialog) {
          dialog.showModal();
          // Initialize after showing the dialog to ensure elements are in the DOM
          await initializeAboutDialog();
        }
      });

      // Add server mode info dialog handler
      window.electron.onOpenServerModeInfo(async () => {
        const dialog = document.getElementById('server-mode-info-dialog');
        if (dialog) {
          dialog.showModal();
        }
      });

      // Check for updates on startup (silent)
      await checkForUpdates(true);
      
    } catch (error) {
      console.error('Error during initialization:', error);
    }
  });


  // NOTE: initializeGrid is defined at top level (line ~6635) - duplicate removed

  // Add this function to handle clearing the directory filter
  async function clearDirectoryFilter() {
    try {
      // Get the filter indicator element and clear its content and visual state
      const filterIndicator = document.getElementById('current-filter');
      if (filterIndicator) {
        filterIndicator.innerHTML = '';
        filterIndicator.classList.remove('visible');
      }
      // Retrieve and display all models
      const models = await window.electron.getAllModels();
      await displayModels(models);
    } catch (error) {
      console.error('Error clearing directory filter:', error);
    }
  }

  // Expose clearDirectoryFilter to the global (window) scope so that event listeners can access it
  window.clearDirectoryFilter = clearDirectoryFilter;

  // Update the parent directory click handler to show the clear button

  // Open STL Home dialog when the main process sends the event
  window.electron.onOpenSTLHome(async () => {
    await window.openSTLHomeDialog();
  });

  // Handler for "Choose Directory" button in the STL Home dialog
  document.getElementById('choose-stl-home-button')?.addEventListener('click', async () => {
    const directory = await window.electron.openFileDialog();
    if (directory && directory[0]) {
      document.getElementById('stl-home-directory').value = directory[0];
    }
  });

  // Handler for Cancel button in the STL Home dialog
  document.getElementById('cancel-stl-home-button')?.addEventListener('click', () => {
    document.getElementById('stl-home-dialog').close();
  });

  // Handler for Clear Directory button in the STL Home dialog
  document.getElementById('clear-stl-home-button')?.addEventListener('click', async () => {
    // Clear the directory input field
    document.getElementById('stl-home-directory').value = "";
    // Save an empty string, effectively clearing the STL Home setting
    await window.electron.saveSetting('stlHome', "");
    
    // Stop periodic scanning if in server mode
    const serverMode = await window.electron.isServerMode().catch(() => false);
    if (serverMode) {
      stopPeriodicSTLHomeScan();
    }
    
    // Close the dialog
    document.getElementById('stl-home-dialog').close();
  });

  // Periodic STL Home scanning for server mode
  let stlHomeScanInterval = null;

  async function startPeriodicSTLHomeScan() {
    // Stop any existing interval
    stopPeriodicSTLHomeScan();
    
    const serverMode = await window.electron.isServerMode().catch(() => false);
    if (!serverMode) return;
    
    const stlHome = await window.electron.getSetting('stlHome');
    if (!stlHome || stlHome.trim() === "") return;
    
    const updateFrequency = await window.electron.getSetting('stlHomeUpdateFrequency');
    const frequencyMinutes = parseInt(updateFrequency) || 60;
    const frequencyMs = frequencyMinutes * 60 * 1000;
    
    console.log(`Starting periodic STL Home scan. Frequency: ${frequencyMinutes} minutes`);
    
    // Perform initial scan
    await performSTLHomeScan(stlHome);
    
    // Set up periodic scanning
    stlHomeScanInterval = setInterval(async () => {
      const currentStlHome = await window.electron.getSetting('stlHome');
      if (currentStlHome && currentStlHome.trim() !== "") {
        await performSTLHomeScan(currentStlHome);
      } else {
        stopPeriodicSTLHomeScan();
      }
    }, frequencyMs);
  }

  function stopPeriodicSTLHomeScan() {
    if (stlHomeScanInterval) {
      clearInterval(stlHomeScanInterval);
      stlHomeScanInterval = null;
      console.log('Stopped periodic STL Home scan');
    }
  }

  async function performSTLHomeScan(stlHomeDir) {
    try {
      console.log(`Performing periodic STL Home scan: ${stlHomeDir}`);
      // Use background scan to avoid disrupting the UI
      await scanAndRenderDirectory(stlHomeDir, true);
      
      // Refresh filters after scanning
      await populateDesignerDropdown();
      await populateParentModelFilter();
      await populateTagFilter();
      await populateLicenseFilter();
    } catch (error) {
      console.error('Error during periodic STL Home scan:', error);
    }
  }

  // Handler for saving the STL Home setting (via form submit)
  document.getElementById('stl-home-dialog').addEventListener('submit', async (event) => {
    event.preventDefault();
    const stlDir = document.getElementById('stl-home-directory').value.trim();
    // Save the STL Home directory to settings (blank by default if nothing selected)
    await window.electron.saveSetting('stlHome', stlDir);
    
    // Save update frequency if in server mode
    const serverMode = await window.electron.isServerMode().catch(() => false);
    if (serverMode) {
      const updateFrequency = document.getElementById('stl-home-update-frequency').value;
      await window.electron.saveSetting('stlHomeUpdateFrequency', updateFrequency);
      
      // Restart periodic scanning if STL Home is set
      if (stlDir && stlDir.trim() !== "") {
        startPeriodicSTLHomeScan();
      } else {
        stopPeriodicSTLHomeScan();
      }
    }
    
    document.getElementById('stl-home-dialog').close();
  });

  // On startup, if an STL Home directory is specified, automatically scan it.
  const stlHome = await window.electron.getSetting('stlHome');
  
  if (stlHome && stlHome.trim() !== "") {
    console.log("STL Home is set. Scanning directory:", stlHome);
    // You can use your existing scan/render function (e.g., scanAndRenderDirectory)
    await scanAndRenderDirectory(stlHome);

    // Refresh filters after scanning
    await populateDesignerDropdown();
    await populateParentModelFilter();
    await populateTagFilter();
    await populateLicenseFilter();
    
    // If in server mode, start periodic scanning (reuse serverMode from line 2121)
    if (serverMode) {
      startPeriodicSTLHomeScan();
    }
  }

  // Add event listener for "View Entire Library" button
  const viewLibraryButton = document.getElementById('view-library-button');
  if (viewLibraryButton) {
    viewLibraryButton.addEventListener('click', async () => {
      try {
        // Reset all filter dropdowns
        document.getElementById('designer-select').value = '';
        document.getElementById('license-select').value = '';
        document.getElementById('parent-select').value = '';
        document.getElementById('printed-select').value = 'all';
        document.getElementById('tag-filter').value = '';
        document.getElementById('filetype-select').value = '';
        document.getElementById('search-filter-input').value = '';
        
        // Explicitly clear the directory filter
        window.currentDirectoryFilter = "";
        
        // Hide the "Showing 100 Newest Models" message
        const viewLibMsg = document.getElementById("view-library-message");
        if (viewLibMsg) {
          viewLibMsg.style.display = "none";
        }
        
        // Flag that we're viewing the entire library
        window.viewingEntireLibrary = true;
        
        // Clear the filter indicator
        const filterIndicator = document.getElementById('current-filter');
        if (filterIndicator) {
          filterIndicator.innerHTML = "";
          filterIndicator.classList.remove('visible');
        }
        
        // Use the combined search function to retrieve and display models with all filters applied correctly
        await window.performCombinedSearch();
        
        console.log("Viewing entire library");
      } catch (error) {
        console.error('Error loading library:', error);
        await window.electron.showMessage('Error', 'Failed to load library.');
      }
    });
  } else {
    debugLog("View Library button not found.");
  }

  // Add event listeners on filter and search elements so that the "view-library-message" is removed when a filter or search is active.
  ["designer-select", "license-select", "parent-select", "printed-select", "tag-filter", "filetype-select", "search-filter-input"].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        const msg = document.getElementById("view-library-message");
        if (msg) { msg.style.display = "none"; }
      });
      if (id === "search-filter-input") {
        el.addEventListener("input", () => {
          const msg = document.getElementById("view-library-message");
          if (msg) { msg.style.display = "none"; }
        });
      }
    }
  });

  // Assuming this is where the menu item is defined
  document.addEventListener('DOMContentLoaded', function() {
    // Remove any old guide references
    // const guideDialog = document.getElementById('guide-dialog'); // Remove this line if it exists

    // Assuming this is where the menu item is defined
    document.getElementById("guide-button").addEventListener("click", function() {
      // Call the new guide function
      window.electron.send('open-guide'); // Ensure this sends the correct event to show the new guide
    });
  });

  // Add this listener at the top of the file or within the DOMContentLoaded event
  window.electron.on('open-guide', () => {
    showGuide(); // Call the function to show the guide
  });

  // Handler for puter.com AI requests from main process
  window.electron.on('puter-ai-chat-request', async (requestId, prompt, imageUrl, model) => {
    try {
      // Wait for puter.js to be fully loaded
      let retries = 0;
      const maxRetries = 10;
      while ((typeof puter === 'undefined' || !puter.ai || !puter.ai.chat) && retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100));
        retries++;
      }
      
      // Check if puter is available
      if (typeof puter === 'undefined' || !puter.ai || !puter.ai.chat) {
        throw new Error('Puter.js is not loaded. Please refresh the application.');
      }
      
      // Call puter.ai.chat() with error handling
      let response;
      try {
        response = await puter.ai.chat(prompt, imageUrl, { model: model || 'gpt-5-nano' });
      } catch (apiError) {
        // Handle 403 or other API errors
        if (apiError.message && apiError.message.includes('403')) {
          throw new Error('Puter.com API access denied (403). This may be due to CORS restrictions or API limitations. Please try using a different AI service or check puter.com documentation.');
        } else if (apiError.message && apiError.message.includes('Forbidden')) {
          throw new Error('Puter.com API access forbidden. This service may require additional setup or have usage restrictions.');
        }
        throw apiError;
      }
      
      // Extract serializable content from response
      // puter.ai.chat() may return a string or an object, ensure we only send serializable data
      let responseText;
      if (typeof response === 'string') {
        responseText = response;
      } else if (response && typeof response === 'object') {
        // Try to extract text content from various possible response formats
        responseText = response.text || response.content || response.message || JSON.stringify(response);
      } else {
        responseText = String(response || '');
      }
      
      // Send response back to main process with requestId (only send serializable string)
      window.electron.send('puter-ai-chat-response', requestId, { response: responseText });
    } catch (error) {
      console.error('Error calling puter.ai.chat:', error);
      const errorMessage = error.message || 'Unknown error';
      window.electron.send('puter-ai-chat-response', requestId, { error: errorMessage });
    }
  });

  // NEW: Listen for the "open-ai-config" event from the main process
  window.electron.on('open-ai-config', () => {
    const dialog = document.getElementById('ai-config-dialog');
    if (!dialog) {
      console.error('ai-config-dialog element not found.');
      return;
    }
    window.electron.getSetting('apiKey').then((value) => {
      const keyEl = document.getElementById('ai-api-key');
      if (keyEl) {
        keyEl.value = value || '';
        
        // Add input event listener for real-time persistence
        keyEl.addEventListener('input', async () => {
          await window.electron.saveSetting('apiKey', keyEl.value);
        });
      } else {
        console.error('ai-api-key element not found.');
      }
    });
    window.electron.getSetting('apiEndpoint').then((value) => {
      const endpointEl = document.getElementById('ai-endpoint');
      if (endpointEl) {
        endpointEl.value = value || 'https://js.puter.com/v2/';
        
        // Add input event listener for real-time persistence
        endpointEl.addEventListener('input', async () => {
          await window.electron.saveSetting('apiEndpoint', endpointEl.value);
        });
      } else {
        console.error('ai-endpoint element not found.');
      }
    });
    window.electron.getSetting('aiModel').then((value) => {
      const modelEl = document.getElementById('ai-model');
      if (modelEl) {
        modelEl.value = value || 'gpt-5-nano';
        
        // Add input event listener for real-time persistence
        modelEl.addEventListener('input', async () => {
          await window.electron.saveSetting('aiModel', modelEl.value);
        });
      } else {
        console.error('ai-model element not found.');
      }
    });
    window.electron.getSetting('aiService').then((value) => {
      const serviceEl = document.getElementById('ai-service-select');
      if (serviceEl) {
        serviceEl.value = value || 'puter';
        
        // Update UI based on current service
        const apiKeyEl = document.getElementById('ai-api-key');
        const apiKeyGroup = apiKeyEl?.closest('.form-group');
        const endpointEl = document.getElementById('ai-endpoint');
        if (serviceEl.value === 'puter') {
          if (apiKeyEl) {
            apiKeyEl.required = false;
            apiKeyEl.disabled = true;
          }
          if (apiKeyGroup) apiKeyGroup.style.display = 'none';
          if (endpointEl) endpointEl.required = false;
        } else {
          if (apiKeyEl) {
            apiKeyEl.required = true;
            apiKeyEl.disabled = false;
          }
          if (apiKeyGroup) apiKeyGroup.style.display = '';
          if (endpointEl) endpointEl.required = true;
        }
        
        // Add change event listener for real-time persistence
        serviceEl.addEventListener('change', async () => {
          await window.electron.saveSetting('aiService', serviceEl.value);
        });
      } else {
        console.error('ai-service-select element not found.');
      }
    });
    
    // Load AI tag settings
    window.electron.getSetting('aiTagMaxTags').then((value) => {
      const maxTagsEl = document.getElementById('ai-tag-max-tags');
      if (maxTagsEl) {
        maxTagsEl.value = value || '10';
      }
    });
    
    window.electron.getSetting('aiTagMergeStrategy').then((value) => {
      const mergeStrategyEl = document.getElementById('ai-tag-merge-strategy');
      if (mergeStrategyEl) {
        mergeStrategyEl.value = value || 'merge';
      }
    });
    
    window.electron.getSetting('aiTagUseCategories').then((value) => {
      const useCategoriesEl = document.getElementById('ai-tag-use-categories');
      if (useCategoriesEl) {
        useCategoriesEl.checked = value === '1';
      }
    });
    
    window.electron.getSetting('aiTagAllowRetagging').then((value) => {
      const allowRetaggingEl = document.getElementById('ai-tag-allow-retagging');
      if (allowRetaggingEl) {
        allowRetaggingEl.checked = value === '1';
      }
    });
    
    window.electron.getSetting('aiTagConcurrency').then((value) => {
      const concurrencyEl = document.getElementById('ai-tag-concurrency');
      if (concurrencyEl) {
        concurrencyEl.value = value || '3';
      }
    });
    
    window.electron.getSetting('aiTagDetailLevel').then((value) => {
      const detailLevelEl = document.getElementById('ai-tag-detail-level');
      if (detailLevelEl) {
        detailLevelEl.value = value || 'medium';
      }
    });
    
    dialog.showModal();
  });

  // AI Config dialog handlers
  document.getElementById('test-ai-config')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const apiKeyEl = document.getElementById('ai-api-key');
    const endpointEl = document.getElementById('ai-endpoint');
    const modelEl = document.getElementById('ai-model');
    const serviceEl = document.getElementById('ai-service-select');
    
    if (!apiKeyEl || !endpointEl || !modelEl || !serviceEl) {
      console.error('One or more AI Config input elements not found.');
      return;
    }
    
    const apiKey = apiKeyEl.value;
    const endpoint = endpointEl.value;
    const model = modelEl.value;
    const service = serviceEl.value;
    
    const result = await window.electron.testAIConfig(apiKey, endpoint, model, service);
    const resultDiv = document.getElementById('ai-config-result');
    if (resultDiv) {
      if (result.success) {
        resultDiv.textContent = `Test successful! Tags: ${result.tags.join(', ')}`;
      } else {
        resultDiv.textContent = `Test failed: ${result.error}`;
      }
    } else {
      console.error('The ai-config-result element was not found.');
    }
  });

  document.getElementById('save-ai-config')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const service = document.getElementById('ai-service-select')?.value || 'puter';
    const apiKey = service === 'puter' ? '' : (document.getElementById('ai-api-key')?.value || '');
    const endpoint = document.getElementById('ai-endpoint')?.value || (service === 'puter' ? 'https://js.puter.com/v2/' : 'https://api.openai.com/v1');
    const model = document.getElementById('ai-model')?.value || (service === 'puter' ? 'gpt-5-nano' : 'gpt-4o-mini');
    
    // AI tag settings
    const maxTags = document.getElementById('ai-tag-max-tags')?.value || '10';
    const mergeStrategy = document.getElementById('ai-tag-merge-strategy')?.value || 'merge';
    const useCategories = document.getElementById('ai-tag-use-categories')?.checked ? '1' : '0';
    const allowRetagging = document.getElementById('ai-tag-allow-retagging')?.checked ? '1' : '0';
    const concurrency = document.getElementById('ai-tag-concurrency')?.value || '3';
    const detailLevel = document.getElementById('ai-tag-detail-level')?.value || 'medium';
    
    await window.electron.saveSetting('apiKey', apiKey);
    await window.electron.saveSetting('apiEndpoint', endpoint);
    await window.electron.saveSetting('aiModel', model);
    await window.electron.saveSetting('aiService', service);
    await window.electron.saveSetting('aiTagMaxTags', maxTags);
    await window.electron.saveSetting('aiTagMergeStrategy', mergeStrategy);
    await window.electron.saveSetting('aiTagUseCategories', useCategories);
    await window.electron.saveSetting('aiTagAllowRetagging', allowRetagging);
    await window.electron.saveSetting('aiTagConcurrency', concurrency);
    await window.electron.saveSetting('aiTagDetailLevel', detailLevel);
    
    document.getElementById('ai-config-dialog').close();
  });

  document.getElementById('cancel-ai-config')?.addEventListener('click', () => {
    document.getElementById('ai-config-dialog').close();
  });

  // File Type Settings dialog handlers
  window.electron.on('open-file-type-settings', async () => {
    const dialog = document.getElementById('file-type-settings-dialog');
    if (!dialog) {
      console.error('file-type-settings-dialog element not found.');
      return;
    }
    
    // Load current settings
    const enableZipArchives = await window.electron.getSetting('enableZipArchives');
    const checkbox = document.getElementById('enable-zip-archives');
    if (checkbox) {
      checkbox.checked = enableZipArchives === '1';
    }
    
    // Load 3MF metadata settings (default to '1' if not set)
    const enable3MFDesigner = await window.electron.getSetting('enable3MFDesigner');
    const enable3MFParentModel = await window.electron.getSetting('enable3MFParentModel');
    const enable3MFLicense = await window.electron.getSetting('enable3MFLicense');
    const enable3MFNotes = await window.electron.getSetting('enable3MFNotes');
    
    const designerCheckbox = document.getElementById('enable-3mf-designer');
    const parentModelCheckbox = document.getElementById('enable-3mf-parent-model');
    const licenseCheckbox = document.getElementById('enable-3mf-license');
    const notesCheckbox = document.getElementById('enable-3mf-notes');
    
    if (designerCheckbox) {
      designerCheckbox.checked = enable3MFDesigner === '1' || enable3MFDesigner === null;
    }
    if (parentModelCheckbox) {
      parentModelCheckbox.checked = enable3MFParentModel === '1' || enable3MFParentModel === null;
    }
    if (licenseCheckbox) {
      licenseCheckbox.checked = enable3MFLicense === '1' || enable3MFLicense === null;
    }
    if (notesCheckbox) {
      notesCheckbox.checked = enable3MFNotes === '1' || enable3MFNotes === null;
    }
    
    dialog.showModal();
  });

  document.getElementById('save-file-type-settings')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const checkbox = document.getElementById('enable-zip-archives');
    const enableZipArchives = checkbox?.checked ? '1' : '0';
    
    await window.electron.saveSetting('enableZipArchives', enableZipArchives);
    
    // Save 3MF metadata settings
    const designerCheckbox = document.getElementById('enable-3mf-designer');
    const parentModelCheckbox = document.getElementById('enable-3mf-parent-model');
    const licenseCheckbox = document.getElementById('enable-3mf-license');
    const notesCheckbox = document.getElementById('enable-3mf-notes');
    
    await window.electron.saveSetting('enable3MFDesigner', designerCheckbox?.checked ? '1' : '0');
    await window.electron.saveSetting('enable3MFParentModel', parentModelCheckbox?.checked ? '1' : '0');
    await window.electron.saveSetting('enable3MFLicense', licenseCheckbox?.checked ? '1' : '0');
    await window.electron.saveSetting('enable3MFNotes', notesCheckbox?.checked ? '1' : '0');
    
    document.getElementById('file-type-settings-dialog').close();
  });

  document.getElementById('cancel-file-type-settings')?.addEventListener('click', () => {
    document.getElementById('file-type-settings-dialog').close();
  });

  // Store pending tags for preview (can handle multiple models)
  let pendingTagData = [];
  let batchTagGenerationInProgress = false;
  let expectedBatchCount = 0;
  let reviewDialogOpen = false;
  let rateLimitDialogShown = false; // Track if rate limit dialog has been shown during current batch

  // Helper function to normalize file paths for comparison
  function normalizeFilePath(path) {
    return path ? path.replace(/\\/g, '/').toLowerCase().trim() : '';
  }

  // Helper function to get filePath from modelData (checks both locations)
  function getFilePathFromModelData(modelData) {
    return modelData.model?.filePath || modelData.filePath;
  }

  // Helper function to deduplicate model data array
  function deduplicateModelData(modelsData) {
    const deduplicated = new Map();
    
    for (const modelData of modelsData) {
      const filePath = getFilePathFromModelData(modelData);
      if (!filePath) continue;
      
      const normalizedPath = normalizeFilePath(filePath);
      const existing = deduplicated.get(normalizedPath);
      
      // Prefer entry with actual tags over "Generating..." entries or empty tags
      if (!existing) {
        deduplicated.set(normalizedPath, modelData);
      } else {
        const existingHasTags = existing.generatedTags !== undefined && existing.generatedTags.length > 0;
        const newHasTags = modelData.generatedTags !== undefined && modelData.generatedTags.length > 0;
        const existingIsGenerating = existing.generatedTags === undefined;
        const newIsGenerating = modelData.generatedTags === undefined;
        
        // Always prefer entry with actual tags
        if (newHasTags && !existingHasTags) {
          // New has tags, existing doesn't - replace
          deduplicated.set(normalizedPath, modelData);
        } else if (existingHasTags && !newHasTags) {
          // Existing has tags, new doesn't - keep existing
          // (don't replace)
        } else if (newIsGenerating && !existingIsGenerating) {
          // New is generating, existing has some result - keep existing
          // (don't replace)
        } else if (existingIsGenerating && !newIsGenerating) {
          // Existing is generating, new has result - replace
          deduplicated.set(normalizedPath, modelData);
        } else {
          // Both in same state - keep existing (first one wins)
          // (don't replace)
        }
      }
    }
    
    return Array.from(deduplicated.values());
  }

  // Helper function to update or add model data to pendingTagData (ensures no duplicates)
  function updatePendingTagData(filePath, tagData) {
    const normalizedFilePath = normalizeFilePath(filePath);
    
    // First, remove ALL entries with this filePath (in case there are duplicates)
    // This ensures we never have multiple entries for the same file
    const beforeCount = pendingTagData.length;
    pendingTagData = pendingTagData.filter(d => {
      const dPath1 = normalizeFilePath(d.filePath);
      const dPath2 = normalizeFilePath(getFilePathFromModelData(d));
      return (dPath1 !== normalizedFilePath) && (dPath2 !== normalizedFilePath);
    });
    
    // Then add the new/updated entry
    pendingTagData.push(tagData);
    
    // Always deduplicate after update to ensure no duplicates
    // This is a final safeguard
    const beforeDedup = pendingTagData.length;
    pendingTagData = deduplicateModelData(pendingTagData);
    
    // Debug: log if we removed duplicates
    if (beforeCount !== pendingTagData.length || beforeDedup !== pendingTagData.length) {
      console.log(`updatePendingTagData: Removed duplicates for ${filePath}. Before: ${beforeCount}, After filter: ${pendingTagData.length + 1}, After dedup: ${pendingTagData.length}`);
    }
  }

  // Function to update the tag preview dialog (for real-time updates)
  function updateTagPreviewDialog() {
    if (!reviewDialogOpen) return;
    // CRITICAL: Always deduplicate before showing to prevent duplicates from rapid updates
    // This is especially important when multiple tags arrive quickly
    pendingTagData = deduplicateModelData(pendingTagData);
    // showTagPreviewDialog will use pendingTagData when dialog is open (ignores parameter)
    showTagPreviewDialog(pendingTagData);
  }

  // Listen for the 'tags-generated' event from the main process
  window.electron.on('tags-generated', async (filePath, tags, errorMessage) => {
    try {
      // Check if there's a rate limit error
      if (errorMessage && errorMessage.includes('Rate limit')) {
        // Extract the detailed message if available (after "Rate limit exceeded: ")
        const detailedMessage = errorMessage.includes('Rate limit exceeded: ') 
          ? errorMessage.split('Rate limit exceeded: ')[1]
          : 'API rate limit has been exceeded. Please try again later.';
        
        // Only show dialog once per batch operation to prevent flooding
        const isBatchOperation = batchTagGenerationInProgress;
        if (!isBatchOperation || !rateLimitDialogShown) {
          await window.electron.showMessage('Rate Limit Exceeded', detailedMessage);
          if (isBatchOperation) {
            rateLimitDialogShown = true; // Mark as shown for this batch
          }
        }
        return;
      }
      
      // Fetch the current model data for the given filePath
      const model = await window.electron.getModel(filePath);
      if (!model) {
        console.error(`Model not found for ${filePath}`);
        return;
      }

      // Check if this is a batch operation (if review dialog is already open, it's batch)
      const isBatchOperation = batchTagGenerationInProgress;
      
      if (isBatchOperation) {
        // Store or update tag data for this model (even if tags are empty)
        const tagData = {
          filePath: filePath,
          model: model,
          generatedTags: tags || [],
          existingTags: model.tags || [],
          errorMessage: errorMessage || null
        };
        
        // Use helper function to update pendingTagData (ensures no duplicates)
        updatePendingTagData(filePath, tagData);
        
        // Update the review dialog in real-time
        if (reviewDialogOpen) {
          updateTagPreviewDialog();
        } else if (batchTagGenerationInProgress) {
          // Show the dialog when first model arrives
          // pendingTagData is already deduplicated by updatePendingTagData
          showTagPreviewDialog(pendingTagData);
        }
      } else {
        // Single model operation - update existing dialog or show if not open
        const tagData = {
          filePath: filePath,
          model: model,
          generatedTags: tags || [],
          existingTags: model.tags || [],
          errorMessage: errorMessage || null
        };
        
        // Update or set pending data
        if (pendingTagData.length > 0 && pendingTagData[0].filePath === filePath) {
          pendingTagData[0] = tagData;
        } else {
          pendingTagData = [tagData];
        }
        
        // Update the dialog if it's open, otherwise show it
        if (reviewDialogOpen) {
          updateTagPreviewDialog();
        } else {
          // Deduplicate before showing
          const uniquePendingData = deduplicateModelData(pendingTagData);
          showTagPreviewDialog(uniquePendingData);
        }
        
        // Show message if no tags were generated (but don't block)
        if (!tags || tags.length === 0) {
          console.log(`No tags generated for ${filePath}`);
        }
      }
    } catch (error) {
      console.error(`Error updating tags for model ${filePath}:`, error);
    }
  });
  
  // Listen for single file tag generation start
  window.electron.on('start-single-tag-generation', async (filePath, modelData) => {
    console.log('Received start-single-tag-generation event', filePath);
    batchTagGenerationInProgress = false;
    expectedBatchCount = 1;
    pendingTagData = [modelData];
    reviewDialogOpen = false; // Reset dialog state
    rateLimitDialogShown = false; // Reset rate limit dialog flag
    // Deduplicate before showing (should be single item, but be safe)
    const uniquePendingData = deduplicateModelData(pendingTagData);
    showTagPreviewDialog(uniquePendingData);
  });

  // Listen for batch tag generation start
  window.electron.on('start-batch-tag-generation', async (count, filePaths) => {
    batchTagGenerationInProgress = true;
    expectedBatchCount = count;
    pendingTagData = [];
    reviewDialogOpen = false;
    rateLimitDialogShown = false; // Reset rate limit dialog flag for new batch
    
    // Pre-populate with all models so they appear immediately
    if (filePaths && filePaths.length > 0) {
      for (const filePath of filePaths) {
        try {
          const model = await window.electron.getModel(filePath);
          if (model) {
            pendingTagData.push({
              filePath: filePath,
              model: model,
              generatedTags: undefined, // Not generated yet
              existingTags: model.tags || []
            });
          }
        } catch (error) {
          console.error(`Error loading model ${filePath} for preview:`, error);
        }
      }
    }
    
    // Show the review dialog immediately with all models (some may show "Generating...")
    // Deduplicate before showing to prevent any duplicates
    const uniquePendingData = deduplicateModelData(pendingTagData);
    if (uniquePendingData.length > 0) {
      showTagPreviewDialog(uniquePendingData);
    } else {
      showTagPreviewDialog([]);
    }
  });
  
  // Listen for batch tag generation complete
  window.electron.on('batch-tag-generation-complete', async () => {
    batchTagGenerationInProgress = false;
    rateLimitDialogShown = false; // Reset rate limit dialog flag when batch completes
    
    // Wait a tiny bit to ensure all pending tag updates have completed
    // This prevents race conditions where the last tag update hasn't finished
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Update the dialog one final time to show completion status
    // CRITICAL: Ensure pendingTagData is fully deduplicated before final refresh
    if (reviewDialogOpen && pendingTagData.length > 0) {
      // Debug: Log before deduplication
      console.log('batch-tag-generation-complete: Before dedup, pendingTagData has', pendingTagData.length, 'entries');
      pendingTagData.forEach((d, i) => {
        const path = getFilePathFromModelData(d);
        const hasTags = d.generatedTags !== undefined && d.generatedTags.length > 0;
        const isGenerating = d.generatedTags === undefined;
        console.log(`  [${i}] ${path}: hasTags=${hasTags}, isGenerating=${isGenerating}, tags=${d.generatedTags?.length || 0}`);
      });
      
      // Force deduplication one more time before final update
      // This ensures no duplicates from rapid tag generation events
      const beforeCount = pendingTagData.length;
      pendingTagData = deduplicateModelData(pendingTagData);
      const afterCount = pendingTagData.length;
      
      if (beforeCount !== afterCount) {
        console.log(`batch-tag-generation-complete: Removed ${beforeCount - afterCount} duplicates. Now have ${afterCount} entries`);
      }
      
      // Use showTagPreviewDialog directly with the deduplicated data
      // Don't call updateTagPreviewDialog which might use stale data
      showTagPreviewDialog(pendingTagData);
    }
    
    // Don't auto-close - let the user review what happened (even if no tags)
    // They can see which models failed and which succeeded
  });

  // Function to show tag preview dialog (now handles multiple models)
  function showTagPreviewDialog(modelsData) {
    const dialog = document.getElementById('tag-preview-dialog');
    const container = document.getElementById('tag-preview-container');
    const modelInfoEl = document.getElementById('tag-preview-model-info');
    
    if (!dialog || !container) {
      console.error('Tag preview dialog elements not found');
      return;
    }

    // Check if dialog is open BEFORE we use it (fix race condition)
    const isDialogOpen = dialog.open || false;
    reviewDialogOpen = isDialogOpen;

    // When dialog is already open, ALWAYS use pendingTagData as the single source of truth
    // This prevents stale data from being displayed and ensures consistency
    let dataToDeduplicate;
    if (isDialogOpen) {
      // Dialog is open - ONLY use pendingTagData (ignore passed parameter)
      // pendingTagData is already updated by updatePendingTagData before this is called
      dataToDeduplicate = pendingTagData;
    } else {
      // Dialog not open yet - use passed data (first time opening)
      dataToDeduplicate = modelsData;
    }
    
    // Deduplicate models by filePath - prefer entries with actual tags over "Generating..." entries
    const beforeDedup = dataToDeduplicate.length;
    const uniqueModelsData = deduplicateModelData(dataToDeduplicate);
    const afterDedup = uniqueModelsData.length;
    
    // Debug: Log if duplicates were found
    if (beforeDedup !== afterDedup) {
      console.log(`showTagPreviewDialog: Found ${beforeDedup - afterDedup} duplicates. Before: ${beforeDedup}, After: ${afterDedup}`);
      // Log what was removed
      const removed = dataToDeduplicate.filter(d1 => {
        const path1 = normalizeFilePath(getFilePathFromModelData(d1));
        return !uniqueModelsData.some(d2 => {
          const path2 = normalizeFilePath(getFilePathFromModelData(d2));
          return path1 === path2;
        });
      });
      removed.forEach(d => {
        const path = getFilePathFromModelData(d);
        console.log(`  Removed duplicate: ${path}, hasTags=${d.generatedTags?.length > 0}, isGenerating=${d.generatedTags === undefined}`);
      });
    }
    
    // Update pendingTagData to match what we're showing (single source of truth)
    pendingTagData = uniqueModelsData;

    // Hide single model info, show batch info if multiple models
    if (uniqueModelsData.length === 1) {
      // Single model - show model info
      if (modelInfoEl) {
        modelInfoEl.style.display = 'block';
        const model = uniqueModelsData[0].model;
        const modelNameEl = document.getElementById('tag-preview-model-name');
        const modelPathEl = document.getElementById('tag-preview-model-path');
        
        if (modelNameEl && modelPathEl) {
          const fileName = model.fileName || model.filePath?.split(/[/\\]/).pop() || 'Unknown';
          const filePath = model.filePath || 'Unknown path';
          
          modelNameEl.textContent = fileName;
          modelPathEl.textContent = filePath;
        }
      }
    } else {
      // Multiple models - hide single model info
      if (modelInfoEl) {
        modelInfoEl.style.display = 'none';
      }
    }

    // Save checkbox states before clearing (to preserve user selections when dialog is updated)
    const checkboxStates = new Map();
    if (container) {
      const existingCheckboxes = container.querySelectorAll('input[type="checkbox"]');
      console.log(`Saving checkbox states: found ${existingCheckboxes.length} checkboxes`);
      existingCheckboxes.forEach(checkbox => {
        const filePath = checkbox.dataset.filePath;
        const tagValue = checkbox.value;
        if (filePath && tagValue) {
          const key = `${filePath}::${tagValue}`;
          checkboxStates.set(key, checkbox.checked);
          if (checkbox.checked) {
            console.log(`Saved checked state for: ${key}`);
          }
        } else {
          console.warn(`Checkbox missing filePath or value:`, { filePath, tagValue, checked: checkbox.checked });
        }
      });
      console.log(`Total checkbox states saved: ${checkboxStates.size}`);
    }

    // Clear container completely to prevent duplicates
    container.innerHTML = '';

    // Get merge strategy from settings
    window.electron.getSetting('aiTagMergeStrategy').then((strategy) => {
      const mergeStrategy = strategy || 'merge';

      // Create a container for multiple models (scrolling handled by parent)
      const modelsContainer = document.createElement('div');

      // Process each model - use for...of to support async operations
      for (const [index, modelData] of uniqueModelsData.entries()) {
        const { model, generatedTags, existingTags, errorMessage } = modelData;
        const fileName = model.fileName || model.filePath?.split(/[/\\]/).pop() || 'Unknown';
        const filePath = model.filePath || 'Unknown path';

        // Create model section
        const modelSection = document.createElement('div');
        modelSection.style.marginBottom = '25px';
        modelSection.style.padding = '15px';
        modelSection.style.backgroundColor = '#2a2a2a';
        modelSection.style.border = '1px solid #444';
        modelSection.style.borderRadius = '8px';
        modelSection.dataset.filePath = model.filePath;

        // Model header with thumbnail
        const modelHeader = document.createElement('div');
        modelHeader.style.display = 'flex';
        modelHeader.style.gap = '12px';
        modelHeader.style.marginBottom = '12px';
        modelHeader.style.paddingBottom = '10px';
        modelHeader.style.borderBottom = '1px solid #444';
        
        // Thumbnail
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.style.flexShrink = '0';
        thumbnailContainer.style.width = '80px';
        thumbnailContainer.style.height = '80px';
        thumbnailContainer.style.backgroundColor = '#1a1a1a';
        thumbnailContainer.style.border = '1px solid #444';
        thumbnailContainer.style.borderRadius = '6px';
        thumbnailContainer.style.overflow = 'hidden';
        thumbnailContainer.style.display = 'flex';
        thumbnailContainer.style.alignItems = 'center';
        thumbnailContainer.style.justifyContent = 'center';
        
        const thumbnailImg = document.createElement('img');
        
        // Handle thumbnail loading - especially for 3MF files which may have thumbnails stored differently
        let thumbnailSrc = null;
        
        if (model.thumbnail) {
          // Check if it's a delimited string (multiple thumbnails)
          if (model.thumbnail.includes('::')) {
            const thumbnails = model.thumbnail.split('::').filter(t => 
              t && t !== '3d.png' && t.length > 0 && t.startsWith('data:image')
            );
            thumbnailSrc = thumbnails.length > 0 ? thumbnails[0] : null;
          } else if (model.thumbnail !== '3d.png' && model.thumbnail.startsWith('data:image')) {
            // Single thumbnail
            thumbnailSrc = model.thumbnail;
          }
        }
        
        // For 3MF files, try to get thumbnail from database if not found in model.thumbnail
        // Load asynchronously to avoid blocking
        (async () => {
          if (!thumbnailSrc && model.filePath && model.filePath.toLowerCase().endsWith('.3mf')) {
            try {
              const allThumbnails = await window.electron.getAllThumbnails(model.filePath);
              if (allThumbnails && allThumbnails.length > 0) {
                // Filter out invalid thumbnails and use the first valid one
                const validThumbs = allThumbnails.filter(t => 
                  t && t !== '3d.png' && t.length > 0 && t.startsWith('data:image')
                );
                if (validThumbs.length > 0) {
                  thumbnailSrc = validThumbs[0];
                  thumbnailImg.src = thumbnailSrc;
                  thumbnailImg.style.width = '100%';
                  thumbnailImg.style.height = '100%';
                  thumbnailImg.style.objectFit = 'cover';
                }
              }
            } catch (e) {
              console.log('Could not fetch 3MF thumbnail from database:', e);
            }
          }
        })();
        
        if (thumbnailSrc) {
          thumbnailImg.src = thumbnailSrc;
          thumbnailImg.style.width = '100%';
          thumbnailImg.style.height = '100%';
          thumbnailImg.style.objectFit = 'cover';
          thumbnailImg.onerror = () => {
            // If image fails to load, show placeholder
            thumbnailImg.style.width = '40px';
            thumbnailImg.style.height = '40px';
            thumbnailImg.style.opacity = '0.3';
            thumbnailImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>';
          };
        } else {
          thumbnailImg.style.width = '40px';
          thumbnailImg.style.height = '40px';
          thumbnailImg.style.opacity = '0.3';
          thumbnailImg.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6v6H9z"/></svg>';
        }
        thumbnailContainer.appendChild(thumbnailImg);
        
        // Model info
        const modelInfo = document.createElement('div');
        modelInfo.style.flex = '1';
        modelInfo.style.minWidth = '0';
        modelInfo.innerHTML = `
          <div style="color: #4a9eff; font-weight: 600; font-size: 15px; margin-bottom: 4px;">${fileName}</div>
          <div style="color: #999; font-size: 12px; word-break: break-all;">${filePath}</div>
        `;
        
        modelHeader.appendChild(thumbnailContainer);
        modelHeader.appendChild(modelInfo);
        modelSection.appendChild(modelHeader);

        // Existing tags
        if (existingTags.length > 0) {
          const existingDiv = document.createElement('div');
          existingDiv.style.marginBottom = '12px';
          existingDiv.innerHTML = `<div style="color: #aaa; font-size: 12px; margin-bottom: 6px;">Existing tags (${existingTags.length}):</div>` +
            `<div style="color: #ccc; line-height: 1.6;">${existingTags.map(t => `<span style="display: inline-block; background: #3a3a3a; padding: 3px 6px; margin: 2px; border-radius: 4px; font-size: 12px;">${t}</span>`).join('')}</div>`;
          modelSection.appendChild(existingDiv);
        }

        // Generated tags with checkboxes
        if (generatedTags && generatedTags.length > 0) {
          const generatedDiv = document.createElement('div');
          generatedDiv.style.color = '#fff';
          generatedDiv.style.fontWeight = '600';
          generatedDiv.style.marginBottom = '10px';
          generatedDiv.style.fontSize = '13px';
          generatedDiv.innerHTML = `Generated tags (${generatedTags.length}):`;
          modelSection.appendChild(generatedDiv);

          const tagList = document.createElement('div');
          tagList.style.display = 'flex';
          tagList.style.flexWrap = 'wrap';
          tagList.style.gap = '8px';
          tagList.style.marginBottom = '10px';

          generatedTags.forEach(tag => {
            const tagItem = document.createElement('label');
            tagItem.style.display = 'inline-flex';
            tagItem.style.alignItems = 'center';
            tagItem.style.padding = '6px 10px';
            tagItem.style.backgroundColor = '#3a3a3a';
            tagItem.style.border = '1px solid #555';
            tagItem.style.borderRadius = '6px';
            tagItem.style.cursor = 'pointer';
            tagItem.style.userSelect = 'none';
            tagItem.style.color = '#fff';
            tagItem.style.transition = 'all 0.2s ease';
            tagItem.style.fontSize = '13px';

            // Hover effect
            tagItem.addEventListener('mouseenter', () => {
              tagItem.style.backgroundColor = '#4a4a4a';
              tagItem.style.borderColor = '#666';
            });
            tagItem.addEventListener('mouseleave', () => {
              tagItem.style.backgroundColor = '#3a3a3a';
              tagItem.style.borderColor = '#555';
            });

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            // Restore checked state if it was previously set, otherwise default to true
            const stateKey = `${model.filePath}::${tag}`;
            const wasChecked = checkboxStates.has(stateKey) ? checkboxStates.get(stateKey) : true;
            checkbox.checked = wasChecked;
            if (!wasChecked && checkboxStates.has(stateKey)) {
              console.log(`Restored unchecked state for: ${stateKey}`);
            } else if (wasChecked && checkboxStates.has(stateKey)) {
              console.log(`Restored checked state for: ${stateKey}`);
            }
            checkbox.value = tag;
            checkbox.dataset.filePath = model.filePath;
            checkbox.style.marginRight = '6px';
            checkbox.style.width = '14px';
            checkbox.style.height = '14px';
            checkbox.style.cursor = 'pointer';
            checkbox.style.accentColor = '#4a9eff';

            const tagText = document.createElement('span');
            tagText.textContent = tag;
            tagText.style.color = '#fff';

            tagItem.appendChild(checkbox);
            tagItem.appendChild(tagText);
            tagList.appendChild(tagItem);
          });

          modelSection.appendChild(tagList);

          // Add Select All / Clear Selection buttons
          const buttonContainer = document.createElement('div');
          buttonContainer.style.display = 'flex';
          buttonContainer.style.gap = '12px';
          buttonContainer.style.marginTop = '8px';

          const selectAllBtn = document.createElement('button');
          selectAllBtn.textContent = 'Select All';
          selectAllBtn.style.background = 'none';
          selectAllBtn.style.border = 'none';
          selectAllBtn.style.color = '#fff';
          selectAllBtn.style.cursor = 'pointer';
          selectAllBtn.style.fontSize = '13px';
          selectAllBtn.style.padding = '4px 0';
          selectAllBtn.style.textDecoration = 'underline';
          selectAllBtn.style.textUnderlineOffset = '2px';
          selectAllBtn.addEventListener('mouseenter', () => {
            selectAllBtn.style.opacity = '0.7';
          });
          selectAllBtn.addEventListener('mouseleave', () => {
            selectAllBtn.style.opacity = '1';
          });
          selectAllBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const checkboxes = tagList.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = true);
          });

          const clearSelectionBtn = document.createElement('button');
          clearSelectionBtn.textContent = 'Clear Selection';
          clearSelectionBtn.style.background = 'none';
          clearSelectionBtn.style.border = 'none';
          clearSelectionBtn.style.color = '#fff';
          clearSelectionBtn.style.cursor = 'pointer';
          clearSelectionBtn.style.fontSize = '13px';
          clearSelectionBtn.style.padding = '4px 0';
          clearSelectionBtn.style.textDecoration = 'underline';
          clearSelectionBtn.style.textUnderlineOffset = '2px';
          clearSelectionBtn.addEventListener('mouseenter', () => {
            clearSelectionBtn.style.opacity = '0.7';
          });
          clearSelectionBtn.addEventListener('mouseleave', () => {
            clearSelectionBtn.style.opacity = '1';
          });
          clearSelectionBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const checkboxes = tagList.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(cb => cb.checked = false);
          });

          buttonContainer.appendChild(selectAllBtn);
          buttonContainer.appendChild(clearSelectionBtn);
          modelSection.appendChild(buttonContainer);
        } else {
          // Show status for models with no tags
          const noTagsDiv = document.createElement('div');
          noTagsDiv.style.color = '#888';
          noTagsDiv.style.fontSize = '13px';
          noTagsDiv.style.fontStyle = 'italic';
          noTagsDiv.style.padding = '8px';
          noTagsDiv.style.backgroundColor = '#1a1a1a';
          noTagsDiv.style.borderRadius = '4px';
          noTagsDiv.style.border = '1px solid #333';
          
          // Check if tags are still being generated (undefined) vs failed (empty array)
          if (generatedTags === undefined) {
            noTagsDiv.textContent = 'Generating tags...';
            noTagsDiv.style.color = '#aaa';
          } else if (errorMessage && errorMessage.includes('Rate limit')) {
            // Show rate limit error message
            const detailedMessage = errorMessage.includes('Rate limit exceeded: ') 
              ? errorMessage.split('Rate limit exceeded: ')[1]
              : 'API rate limit has been exceeded. Please try again later.';
            noTagsDiv.textContent = `Rate limit exceeded: ${detailedMessage}`;
            noTagsDiv.style.color = '#ff6b6b';
            noTagsDiv.style.fontStyle = 'normal';
            noTagsDiv.style.border = '1px solid #ff6b6b';
          } else {
            noTagsDiv.textContent = 'No tags generated for this model';
            noTagsDiv.style.color = '#888';
          }
          modelSection.appendChild(noTagsDiv);
        }

        modelsContainer.appendChild(modelSection);
      }

      container.appendChild(modelsContainer);

      // Show merge strategy info (only once at the bottom)
      // Remove any existing strategy info first to prevent duplicates
      const existingStrategyInfo = container.querySelector('#tag-preview-merge-strategy');
      if (existingStrategyInfo) {
        existingStrategyInfo.remove();
      }
      
      const strategyInfo = document.createElement('div');
      strategyInfo.id = 'tag-preview-merge-strategy';
      strategyInfo.style.marginTop = '15px';
      strategyInfo.style.padding = '12px';
      strategyInfo.style.backgroundColor = '#2a3a4a';
      strategyInfo.style.border = '1px solid #4a5a6a';
      strategyInfo.style.borderRadius = '6px';
      strategyInfo.style.fontSize = '0.9em';
      strategyInfo.innerHTML = `<div style="color: #fff; font-weight: 600; margin-bottom: 6px;">Merge Strategy: <span style="color: #4a9eff;">${mergeStrategy}</span></div>` +
        `<div style="color: #bbb; line-height: 1.5;">${getMergeStrategyDescription(mergeStrategy)}</div>`;
      container.appendChild(strategyInfo);

      // Enable/disable Apply button based on whether tags are generated
      const applyButton = document.getElementById('tag-preview-apply');
      if (applyButton) {
        // Check if any models are still generating tags (generatedTags === undefined)
        const stillGenerating = uniqueModelsData.some(modelData => modelData.generatedTags === undefined);
        
        if (stillGenerating) {
          // Disable button if tags are still being generated
          applyButton.disabled = true;
          applyButton.style.opacity = '0.5';
          applyButton.style.cursor = 'not-allowed';
          applyButton.title = 'Please wait for tags to finish generating';
        } else {
          // Enable button if all tags are generated (even if empty arrays)
          applyButton.disabled = false;
          applyButton.style.opacity = '1';
          applyButton.style.cursor = 'pointer';
          applyButton.title = '';
        }
      }

      // Update dialog title for multiple models
      const dialogTitle = dialog.querySelector('h3');
      if (dialogTitle) {
        const modelCount = pendingTagData.length;
        if (modelCount > 1 || batchTagGenerationInProgress) {
          const completedCount = pendingTagData.filter(d => d.generatedTags !== undefined).length;
          const tagsGeneratedCount = pendingTagData.filter(d => d.generatedTags && d.generatedTags.length > 0).length;
          let status = '';
          if (batchTagGenerationInProgress) {
            status = `(${completedCount}/${expectedBatchCount || modelCount} processed, ${tagsGeneratedCount} with tags)`;
          } else {
            status = `(${modelCount} models, ${tagsGeneratedCount} with tags)`;
          }
          dialogTitle.textContent = `Review Generated Tags ${status}`;
        } else {
          dialogTitle.textContent = 'Review Generated Tags';
        }
      }

      if (!dialog.open) {
        dialog.showModal();
        reviewDialogOpen = true;
      }
    });
  }

  // Get description for merge strategy
  function getMergeStrategyDescription(strategy) {
    switch (strategy) {
      case 'merge':
        return 'Selected tags will be added to existing tags (duplicates removed)';
      case 'append':
        return 'Only new tags not already present will be added';
      case 'replace':
        return 'Existing tags will be replaced with selected tags';
      default:
        return 'Selected tags will be merged with existing tags';
    }
  }

  // Function to apply tags to model
  async function applyTagsToModel(filePath, selectedTags, existingTags, mergeStrategy) {
    try {
      const model = await window.electron.getModel(filePath);
      if (!model) {
        console.error(`Model not found for ${filePath}`);
        return;
      }

      let finalTags = [];

      switch (mergeStrategy) {
        case 'replace':
          // Replace all tags with selected tags
          finalTags = [...selectedTags, "AI Tagged"];
          break;
        case 'append':
          // Only add tags that don't already exist
          const existingSet = new Set(existingTags.map(t => t.toLowerCase()));
          finalTags = [...existingTags];
          selectedTags.forEach(tag => {
            if (!existingSet.has(tag.toLowerCase())) {
              finalTags.push(tag);
            }
          });
          finalTags.push("AI Tagged");
          break;
        case 'merge':
        default:
          // Merge all tags, removing duplicates
          finalTags = Array.from(new Set([...existingTags, ...selectedTags, "AI Tagged"]));
          break;
      }

      // Update the model data with the new tag list
      await window.electron.saveModel({ ...model, tags: finalTags });

      // Update the model element in the grid/UI
      await updateModelElement(filePath);
      
      // Refresh the tags in the Edit Model Details view if it's showing the current model
      const currentModelPath = getCurrentModelFilePath();
      if (currentModelPath === filePath) {
        await loadModelTags(filePath);
      }

      console.log(`Tags updated for model: ${filePath}`);
    } catch (error) {
      console.error(`Error applying tags to model ${filePath}:`, error);
      throw error;
    }
  }

  // Tag preview dialog handlers
  document.getElementById('tag-preview-apply')?.addEventListener('click', async () => {
    if (!pendingTagData || pendingTagData.length === 0) {
      console.error('No pending tag data');
      await window.electron.showMessage('Info', 'No models to process.');
      return;
    }

    const container = document.getElementById('tag-preview-container');
    if (!container) {
      console.error('Tag preview container not found');
      await window.electron.showMessage('Error', 'Tag preview container not found');
      return;
    }
    
    const mergeStrategy = await window.electron.getSetting('aiTagMergeStrategy') || 'merge';

    let successCount = 0;
    let failCount = 0;
    let totalTagsApplied = 0;

    try {
      // Debug: Log all model sections in container
      const allSectionsInContainer = container.querySelectorAll('div[data-file-path]');
      console.log(`\n=== Starting tag application ===`);
      console.log(`Total model sections found in container: ${allSectionsInContainer.length}`);
      console.log('Section file paths:', Array.from(allSectionsInContainer).map(s => s.dataset.filePath));
      console.log(`Total models in pendingTagData: ${pendingTagData.length}`);
      console.log('Pending tag data file paths:', pendingTagData.map(d => d.model?.filePath || d.filePath));
      console.log('Pending tag data structure:', pendingTagData.map(d => ({
        hasModel: !!d.model,
        filePath: d.filePath,
        modelFilePath: d.model?.filePath,
        generatedTagsCount: d.generatedTags?.length || 0,
        hasGeneratedTags: !!(d.generatedTags && d.generatedTags.length > 0)
      })));
      
      // Build models to process from DOM sections (source of truth) instead of pendingTagData
      // This ensures we process all visible models even if pendingTagData is incomplete
      const modelsToProcess = [];
      const processedFilePaths = new Set(); // Track duplicates
      
      for (const section of allSectionsInContainer) {
        const filePath = section.dataset.filePath;
        if (!filePath) {
          console.warn('Found section without file path, skipping');
          continue;
        }
        
        // Skip duplicates (some models might appear twice in the DOM)
        if (processedFilePaths.has(filePath)) {
          console.log(`Skipping duplicate model: ${filePath}`);
          continue;
        }
        processedFilePaths.add(filePath);
        
        // Try to find corresponding data in pendingTagData for existing tags info
        const modelData = pendingTagData.find(d => 
          (d.model?.filePath === filePath) || (d.filePath === filePath)
        );
        
        modelsToProcess.push({
          filePath: filePath,
          section: section,
          existingTags: modelData?.existingTags || [],
          modelData: modelData // Keep reference for any other needed data
        });
      }
      
      console.log(`Will process ${modelsToProcess.length} models from DOM sections`);
      console.log(`pendingTagData has ${pendingTagData.length} models`);
      
      if (modelsToProcess.length !== pendingTagData.length) {
        console.warn(`Mismatch: DOM has ${modelsToProcess.length} models, pendingTagData has ${pendingTagData.length}`);
        console.warn('Processing all models from DOM (source of truth)');
      }
      
      // Filter models that have selected tags before processing
      const modelsWithTags = [];
      for (const modelInfo of modelsToProcess) {
        const targetFilePath = modelInfo.filePath;
        const modelSection = modelInfo.section;
        
        // Get selected tags for this specific model from within its section
        let allCheckboxes = modelSection.querySelectorAll('input[type="checkbox"]');
        let checkedCheckboxes = modelSection.querySelectorAll('input[type="checkbox"]:checked');
        
        // Fallback: if no checkboxes found in section, try finding by filePath in entire container
        if (allCheckboxes.length === 0) {
          try {
            const escapedPath = targetFilePath.replace(/[!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~]/g, '\\$&');
            const fallbackCheckboxes = container.querySelectorAll(`input[type="checkbox"][data-file-path="${escapedPath}"]`);
            if (fallbackCheckboxes.length > 0) {
              allCheckboxes = fallbackCheckboxes;
              checkedCheckboxes = container.querySelectorAll(`input[type="checkbox"][data-file-path="${escapedPath}"]:checked`);
            }
          } catch (e) {
            // Try alternative fallback
            const allCheckboxesInContainer = container.querySelectorAll('input[type="checkbox"]');
            const matchingCheckboxes = Array.from(allCheckboxesInContainer).filter(cb => 
              cb.dataset.filePath === targetFilePath ||
              (modelInfo.modelData?.model?.filePath && cb.dataset.filePath === modelInfo.modelData.model.filePath) ||
              (modelInfo.modelData?.filePath && cb.dataset.filePath === modelInfo.modelData.filePath)
            );
            if (matchingCheckboxes.length > 0) {
              allCheckboxes = matchingCheckboxes;
              checkedCheckboxes = matchingCheckboxes.filter(cb => cb.checked);
            }
          }
        }
        
        const selectedTags = Array.from(checkedCheckboxes).map(cb => cb.value);
        
        if (selectedTags.length > 0) {
          modelsWithTags.push({
            ...modelInfo,
            selectedTags: selectedTags
          });
        }
      }
      
      if (modelsWithTags.length === 0) {
        const allCheckedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
        if (allCheckedBoxes.length === 0) {
          await window.electron.showMessage('Info', 'No tags were selected to apply.');
        } else {
          await window.electron.showMessage('Warning', 'Tags were selected but could not be applied. Please check the console for details.');
        }
        document.getElementById('tag-preview-dialog').close();
        pendingTagData = [];
        return;
      }
      
      // Show progress dialog
      const progressDialog = document.getElementById('progress-dialog');
      const progressTitle = document.getElementById('progress-title');
      const progressMessage = document.getElementById('progress-message');
      const progressBar = document.getElementById('progress-bar');
      const progressStatus = document.getElementById('progress-status');
      
      if (progressDialog && progressTitle && progressMessage && progressBar && progressStatus) {
        progressTitle.textContent = 'Applying Tags';
        progressMessage.textContent = 'Processing models...';
        progressBar.style.width = '0%';
        progressStatus.textContent = `0 / ${modelsWithTags.length}`;
        progressDialog.showModal();
      }
      
      // Process models in parallel batches (5 at a time)
      const BATCH_SIZE = 5;
      let processedCount = 0;
      
      for (let i = 0; i < modelsWithTags.length; i += BATCH_SIZE) {
        const batch = modelsWithTags.slice(i, i + BATCH_SIZE);
        const batchPromises = batch.map(async (modelInfo) => {
          const targetFilePath = modelInfo.filePath;
          const selectedTags = modelInfo.selectedTags;
          
          try {
            console.log(`Applying ${selectedTags.length} tags to model: ${targetFilePath}`);
            await applyTagsToModel(
              targetFilePath,
              selectedTags,
              modelInfo.existingTags || [],
              mergeStrategy
            );
            
            processedCount++;
            const fileName = targetFilePath.split(/[/\\]/).pop() || targetFilePath;
            
            // Update progress
            if (progressDialog && progressMessage && progressBar && progressStatus) {
              const percentage = (processedCount / modelsWithTags.length) * 100;
              progressBar.style.width = `${percentage}%`;
              progressMessage.textContent = `Processing: ${fileName}`;
              progressStatus.textContent = `${processedCount} / ${modelsWithTags.length}`;
            }
            
            successCount++;
            totalTagsApplied += selectedTags.length;
            console.log(`Successfully applied tags to ${targetFilePath}`);
            return { success: true, filePath: targetFilePath, tagsCount: selectedTags.length };
          } catch (error) {
            processedCount++;
            console.error(`Error applying tags to ${targetFilePath}:`, error);
            failCount++;
            
            // Update progress even on error
            if (progressDialog && progressBar && progressStatus) {
              const percentage = (processedCount / modelsWithTags.length) * 100;
              progressBar.style.width = `${percentage}%`;
              progressStatus.textContent = `${processedCount} / ${modelsWithTags.length}`;
            }
            
            return { success: false, filePath: targetFilePath, error: error.message };
          }
        });
        
        // Wait for batch to complete before starting next batch
        await Promise.all(batchPromises);
      }
      
      // Close progress dialog
      if (progressDialog) {
        progressDialog.close();
      }
      
      console.log(`\n=== Finished processing all models ===`);
      console.log(`Total processed: ${processedCount}, Success: ${successCount}, Failed: ${failCount}, Total tags: ${totalTagsApplied}`);

      // Show results
      if (successCount > 0) {
        const message = failCount > 0
          ? `Tags applied to ${successCount} model(s) (${failCount} failed). ${totalTagsApplied} tag(s) applied.`
          : `Tags applied successfully to ${successCount} model(s)! ${totalTagsApplied} tag(s) applied.`;
        await window.electron.showMessage('Success', message);
        
        // Refresh the tag filter dropdown to include any new tags
        await populateTagFilter();
      } else if (totalTagsApplied === 0) {
        // Only show "no tags selected" if we actually processed models but found no selected tags
        // Check if we have any checked checkboxes at all in the container
        const allCheckedBoxes = container.querySelectorAll('input[type="checkbox"]:checked');
        if (allCheckedBoxes.length === 0) {
          await window.electron.showMessage('Info', 'No tags were selected to apply.');
        } else {
          // Tags were checked but couldn't be applied - show different message
          await window.electron.showMessage('Warning', 'Tags were selected but could not be applied. Please check the console for details.');
        }
      }

      document.getElementById('tag-preview-dialog').close();
      pendingTagData = [];
    } catch (error) {
      console.error('Error applying tags:', error);
      await window.electron.showMessage('Error', 'Failed to apply tags: ' + error.message);
    }
  });

  document.getElementById('tag-preview-cancel')?.addEventListener('click', () => {
    document.getElementById('tag-preview-dialog').close();
    pendingTagData = [];
    batchTagGenerationInProgress = false;
    reviewDialogOpen = false;
  });
  
  // Add handlers for progress dialog
  window.electron.on('show-progress-dialog', (data) => {
    const progressDialog = document.getElementById('progress-dialog');
    const progressTitle = document.getElementById('progress-title');
    const progressMessage = document.getElementById('progress-message');
    const progressBar = document.getElementById('progress-bar');
    const progressStatus = document.getElementById('progress-status');
    
    // Set initial values
    progressTitle.textContent = data.title || 'Processing...';
    progressMessage.textContent = data.message || 'Please wait...';
    progressBar.style.width = '0%';
    progressStatus.textContent = `0 / ${data.total}`;
    
    // Show the dialog
    progressDialog.showModal();
  });
  
  window.electron.on('update-progress', (data) => {
    const progressBar = document.getElementById('progress-bar');
    const progressMessage = document.getElementById('progress-message');
    const progressStatus = document.getElementById('progress-status');
    
    // Update progress bar
    const percentage = (data.current / data.total) * 100;
    progressBar.style.width = `${percentage}%`;
    
    // Update message and status
    if (data.message) {
      progressMessage.textContent = data.message;
    }
    progressStatus.textContent = `${data.current} / ${data.total}`;
  });
  
  window.electron.on('close-progress-dialog', () => {
    const progressDialog = document.getElementById('progress-dialog');
    progressDialog.close();
  });

  // Listen for tag generation progress updates and update a progress bar
  window.electron.on('tag-generation-progress', (completed, total) => {
    // Assume an element with id "ai-tag-progress" exists in the DOM.
    let progressContainer = document.getElementById('ai-tag-progress');
    if (!progressContainer) {
      // If not, create one dynamically and append it to the main-content or body.
      progressContainer = document.createElement('div');
      progressContainer.id = 'ai-tag-progress';
      progressContainer.style.position = 'fixed';
      progressContainer.style.top = '10px';
      progressContainer.style.right = '10px';
      progressContainer.style.width = '300px';
      progressContainer.style.height = '30px';
      progressContainer.style.background = '#444';
      progressContainer.style.borderRadius = '5px';
      progressContainer.style.boxShadow = '0 0 5px rgba(0,0,0,0.5)';
      progressContainer.style.zIndex = '10000';

      // Create an inner progress bar element
      const progressBar = document.createElement('div');
      progressBar.className = 'progress-bar';
      progressBar.style.height = '100%';
      progressBar.style.width = '0%';
      progressBar.style.background = '#4a9eff';
      progressBar.style.transition = 'width 0.2s ease';

      // Create a text overlay
      const progressText = document.createElement('span');
      progressText.className = 'progress-text';
      progressText.style.position = 'absolute';
      progressText.style.top = '50%';
      progressText.style.left = '50%';
      progressText.style.transform = 'translate(-50%, -50%)';
      progressText.style.color = '#fff';
      progressText.style.fontSize = '14px';

      progressContainer.appendChild(progressBar);
      progressContainer.appendChild(progressText);
      document.body.appendChild(progressContainer);
    }

    // Update the progress bar based on the completed progress.
    const progressBar = progressContainer.querySelector('.progress-bar');
    const progressText = progressContainer.querySelector('.progress-text');
    const percent = Math.floor((completed / total) * 100);
    progressBar.style.width = percent + '%';
    progressText.textContent = `${completed} / ${total}`;

    // If complete, hide the progress bar after a short delay.
    if (completed === total) {
      setTimeout(() => {
        progressContainer.style.display = 'none';
      }, 1000);
    } else {
      progressContainer.style.display = 'block';
    }
  });

  window.electron.on('select-model-by-filepath', (filePath) => {
    // You already have a function (e.g. showModelDetails or toggleModelSelection)
    // Use it to select and highlight the model.
    // For single edit mode, simply select the model and call the function to load its details:
    showModelDetails(filePath);
  });

  // Fetch models without thumbnails
  const modelsWithoutThumbnails = await window.electron.getModelsWithoutThumbnails();
  const modelsCount = modelsWithoutThumbnails.length;

  document.getElementById('ai-service-select').addEventListener('change', async (event) => {
    const selectedService = event.target.value;
    const endpointEl = document.getElementById('ai-endpoint');
    const modelEl = document.getElementById('ai-model');
    const apiKeyEl = document.getElementById('ai-api-key');
    const apiKeyLabel = document.querySelector('label[for="ai-api-key"]');
    const apiKeyGroup = apiKeyEl?.closest('.form-group');

    if (selectedService === 'openai') {
      endpointEl.value = 'https://api.openai.com/v1';
      modelEl.value = 'gpt-4o-mini';
      if (apiKeyEl) {
        apiKeyEl.required = true;
        apiKeyEl.disabled = false;
      }
      if (apiKeyGroup) apiKeyGroup.style.display = '';
    } else if (selectedService === 'gemini') {
      endpointEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      modelEl.value = 'gemini-2.5-flash';
      if (apiKeyEl) {
        apiKeyEl.required = true;
        apiKeyEl.disabled = false;
      }
      if (apiKeyGroup) apiKeyGroup.style.display = '';
    } else if (selectedService === 'puter') {
      endpointEl.value = 'https://js.puter.com/v2/';
      modelEl.value = 'gpt-5-nano';
      if (apiKeyEl) {
        apiKeyEl.required = false;
        apiKeyEl.disabled = true;
        apiKeyEl.value = '';
      }
      if (apiKeyGroup) apiKeyGroup.style.display = 'none';
    } else if (selectedService === 'custom') {
      endpointEl.value = '';
      modelEl.value = '';
      if (apiKeyEl) {
        apiKeyEl.required = true;
        apiKeyEl.disabled = false;
      }
      if (apiKeyGroup) apiKeyGroup.style.display = '';
    }
    
    // Clear the API key field if not puter
    if (apiKeyEl && selectedService !== 'puter') {
      apiKeyEl.value = '';
    }
    
    // Save the new values to the database
    await window.electron.saveSetting('apiEndpoint', endpointEl.value);
    await window.electron.saveSetting('aiModel', modelEl.value);
    await window.electron.saveSetting('aiService', selectedService);
  });

  // Add missing function renderThumbnail used in generateThumbnail().
  async function renderThumbnail(file) {
    try {
      // Determine filePath: if file is a string, use it directly; otherwise, assume it's an object with filePath property.
      const filePath = (typeof file === 'string') ? file : file.filePath;
      if (!filePath) {
        throw new Error("renderThumbnail: filePath is undefined");
      }
      // Create a temporary container (not attached to DOM)
      const tempContainer = document.createElement('div');
      // Call renderModelToPNG with the filePath; no existing thumbnail provided.
      const thumbnail = await renderModelToPNG(filePath, tempContainer, null);
      return thumbnail;
    } catch (error) {
      console.error("Error in renderThumbnail:", error);
      throw error;
    }
  }

  // Global variable for storing a parent directory filter.
  window.currentDirectoryFilter = "";

  // Add ping/pong handler to keep the renderer process alive
  window.electron.on('ping', () => {
    window.electron.pong();
    
    // Force a minimal UI update to prevent freezing
    requestAnimationFrame(() => {
      const dummyElement = document.createElement('div');
      document.body.appendChild(dummyElement);
      document.body.removeChild(dummyElement);
    });
  });

  // Add download handler for server/docker mode (only register once)
  if (!window._downloadHandlerRegistered) {
    window._downloadHandlerRegistered = true;
    const activeDownloads = new Set(); // Track active downloads to prevent duplicates
    
    window.electron.on('download-model', async (filePath) => {
      // Prevent duplicate downloads of the same file
      if (activeDownloads.has(filePath)) {
        console.log('Download already in progress for:', filePath);
        return;
      }
      
      activeDownloads.add(filePath);
      console.log('Download handler triggered with filePath:', filePath);
      
      try {
        // Check if in server mode
        const serverMode = await window.electron.isServerMode().catch(() => false);
        if (!serverMode) {
          console.error('Download only available in server mode');
          alert('Download is only available in server mode');
          return;
        }

        console.log('Server mode confirmed, constructing download URL');
        // Construct download URL - use /api/download/ endpoint which handles zip entries
        const encodedPath = encodeURIComponent(filePath);
        const downloadUrl = `/api/download/${encodedPath}`;
        console.log('Download URL:', downloadUrl);

        // Try using direct link first (simpler and more reliable)
        // This works better when the server sets Content-Disposition header
        const link = document.createElement('a');
        link.href = downloadUrl;
        link.download = ''; // Let server set filename via Content-Disposition
        link.style.display = 'none';
        document.body.appendChild(link);
        
        // Get filename from path for logging
        let fileName = filePath;
        if (fileName.includes('::')) {
          fileName = fileName.split('::')[1] || fileName.split('::')[0];
        }
        fileName = fileName.split(/[/\\]/).pop() || fileName;
        
        console.log('Triggering download via direct link for:', fileName);
        link.click();
        
        // Clean up link after a short delay
        setTimeout(() => {
          if (document.body.contains(link)) {
            document.body.removeChild(link);
          }
          // Remove from active downloads after a delay to allow download to start
          setTimeout(() => {
            activeDownloads.delete(filePath);
          }, 2000);
        }, 100);
      } catch (error) {
        console.error('Error downloading file:', error);
        activeDownloads.delete(filePath);
        // Show error message to user
        alert(`Error downloading file: ${error.message}`);
      }
    });
  }

  // Add near the top of your DOMContentLoaded event listener
  document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Add visibility change handler
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Force a refresh of the UI
        requestAnimationFrame(() => {
          // Refresh any dynamic content that might be stale
          refreshUIContent();
        });
      }
    });
  });

  // Add this new function
  function refreshUIContent() {
    // Refresh the file grid if it exists
    const fileGrid = document.querySelector('.file-grid');
    if (fileGrid) {
      // Re-render the current view
      window.electron.getAllModels(
        document.getElementById('sort-select')?.value || 'name',
        50
      ).then(models => {
        renderFiles(models);
        
      }).catch(console.error);
    }
  }

  // Add this line to listen for the slicer settings event
  window.electron.onOpenSlicerSettings(() => {
    const dialog = document.getElementById('slicer-dialog');
    if (dialog) {
      // Load current slicer path
      window.electron.getSetting('slicerPath')
        .then(path => {
          const input = document.getElementById('slicer-path');
          if (input) input.value = path || '';
          dialog.showModal();
        })
        .catch(err => console.error('Error loading slicer path:', err));
    }
  });

  // Modify the prompt handler
  async function promptPendingThumbnails() {
    try {
      const modelsWithoutThumbs = await window.electron.getModelsWithoutThumbnails();
      if (modelsWithoutThumbs.length > 0) {
        totalThumbnailsToGenerate = modelsWithoutThumbs.length;
        generatedThumbnailsCount = 0;
        
        // Update progress UI
        const progressDialog = document.getElementById('thumbnail-progress-dialog');
        const progressBar = document.getElementById('thumbnail-progress-bar');
        const progressText = document.getElementById('thumbnail-progress-text');
        progressDialog.showModal();
        
        // Process in batches
        await generateThumbnailsForModels(modelsWithoutThumbs);
        
        progressDialog.close();
      }
    } catch (error) {
      console.error('Error in thumbnail generation:', error);
    }
  }

  // Add this to the generateThumbnail function
  function updateProgress() {
    generatedThumbnailsCount++;
    const progress = Math.floor((generatedThumbnailsCount / totalThumbnailsToGenerate) * 100);
    progressBar.style.width = `${progress}%`;
    progressText.textContent = `${generatedThumbnailsCount}/${totalThumbnailsToGenerate} (${progress}%)`;
  }

  // Add this to your existing DOMContentLoaded event listener
  document.addEventListener('DOMContentLoaded', async () => {
    // ... existing code ...

    // Initialize analytics checkbox
    const collectUsageCheckbox = document.getElementById('collect-usage');
    if (collectUsageCheckbox) {
      // Get initial value
      const collectUsage = await window.electron.getSetting('CollectUsage');
      console.log('Initial CollectUsage value:', collectUsage);
      
      // Set checkbox state based on the actual value
      collectUsageCheckbox.checked = collectUsage === '1';
      
      // Handle changes using the same handler as in the about dialog
      collectUsageCheckbox.addEventListener('change', collectUsageChangeHandler);

      // Initialize analytics state with current setting
      toggleAnalytics(collectUsage === '1');
    }
  });

  // Add this function to handle enabling/disabling analytics
  function toggleAnalytics(enable) {
    console.log('Toggling analytics:', enable);
    
    const script1 = document.getElementById('analytics-script-1');
    const script2 = document.getElementById('analytics-script-2');

    if (!script1 || !script2) {
      console.log('Analytics scripts not found in the DOM');
      return;
    }

    if (enable) {
      // Enable analytics
      console.log('Enabling analytics scripts');
      script1.removeAttribute('disabled');
      script2.removeAttribute('disabled');
      
      // Initialize analytics if it wasn't already
      if (typeof gtag === 'undefined') {
        const newScript = document.createElement('script');
        newScript.async = true;
        newScript.src = "https://www.googletagmanager.com/gtag/js?id=G-N4766Y9R11";
        document.head.appendChild(newScript);

        newScript.onload = () => {
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', 'G-N4766Y9R11');
        };
      }
    } else {
      // Disable analytics
      console.log('Disabling analytics scripts');
      script1.setAttribute('disabled', '');
      script2.setAttribute('disabled', '');
      
      // Clear any existing analytics data
      if (window.dataLayer) {
        window.dataLayer = [];
      }
    }
  }

  // Add function for generating thumbnails for multiple models
  async function generateThumbnailsForModels(models) {
    console.log(`[DEBUG] generateThumbnailsForModels: Starting thumbnail generation for ${models.length} models.`);
    const BATCH_SIZE = 1; // Process one at a time
    const progressDialog = document.getElementById('thumbnail-progress-dialog');
    const progressBar = document.getElementById('thumbnail-progress-bar');
    const progressText = document.getElementById('thumbnail-progress-text');
    
    // Check if progress elements exist before proceeding
    const hasProgressUI = progressDialog && progressBar && progressText;
    
    totalThumbnailsToGenerate = models.length;
    generatedThumbnailsCount = 0;

    try {
      // Show progress dialog if it exists
      if (hasProgressUI) {
        progressDialog.showModal();
      }
      
      for (let i = 0; i < models.length; i++) {
        const model = models[i];
        let thumbnail = null;
        
        try {
          // Update progress before starting each model
          generatedThumbnailsCount = i;
          
          // Only update UI elements if they exist
          if (hasProgressUI) {
            const progress = Math.floor((i / totalThumbnailsToGenerate) * 100);
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `Processing ${i + 1}/${totalThumbnailsToGenerate} (${progress}%)`;
          }
          
          // 1. Try to get embedded thumbnail for 3MF
          if (model.filePath.toLowerCase().endsWith('.3mf')) {
            console.log(`[DEBUG] generateThumbnailsForModels: Attempting to extract embedded thumbnail for ${model.filePath}`);
            try {
              const embeddedImages = await extract3MFThumbnail(model.filePath);
              if (embeddedImages && embeddedImages.length > 0) {
                const firstImage = embeddedImages[0];
                if (typeof firstImage === 'string' && firstImage.startsWith('data:image')) {
                  thumbnail = firstImage;
                  console.log(`[DEBUG] generateThumbnailsForModels: SUCCESS - Using embedded thumbnail for ${model.filePath}`);
                  console.log(`[DEBUG] generateThumbnailsForModels: Image type: ${firstImage.substring(5, firstImage.indexOf(';'))}`);
                } else {
                  console.log(`[DEBUG] generateThumbnailsForModels: Invalid image format for ${model.filePath}. First image type: ${typeof firstImage}`);
                }
              } else {
                console.log(`[DEBUG] generateThumbnailsForModels: No embedded thumbnail found for ${model.filePath}. Falling back to 3D rendering.`);
              }
            } catch (embeddedError) {
              console.error(`Error extracting embedded image from 3MF: ${model.filePath}`, embeddedError);
            }
          }

          // 2. If no embedded thumbnail, try 3D rendering
          if (!thumbnail) {
            console.log(`[DEBUG] generateThumbnailsForModels: Rendering 3D model for ${model.filePath}`);
            try {
              thumbnail = await generateThumbnail(model.filePath);
            } catch (renderError) {
              console.error(`Error generating 3D thumbnail for ${model.filePath}:`, renderError);
            }
          }

          // 3. Validate and fallback to default if necessary
          if (!thumbnail || typeof thumbnail !== 'string' || !thumbnail.startsWith('data:image')) {
            thumbnail = '3d.png';
          }

          // 4. Save whatever thumbnail we ended up with
          await window.electron.saveThumbnail(model.filePath, thumbnail);
          
          // 5. Calculate and save hash during thumbnail generation (file is already being read)
          if (!model.hash || model.hash === '') {
            try {
              await window.electron.calculateFileHash(model.filePath);
            } catch (hashError) {
              console.error(`Error calculating hash for ${model.filePath}:`, hashError);
              // Continue even if hash calculation fails
            }
          }
          
          // Force cleanup after each model
          if (typeof deepCleanThreeResources === 'function') {
            deepCleanThreeResources();
          }
          
          // Add delay between models
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          console.error(`Failed to generate thumbnail for ${model.filePath}:`, error);
          // Try to save a default thumbnail to prevent future attempts
          try {
            await window.electron.saveThumbnail(model.filePath, '3d.png');
          } catch (saveError) {
            console.error(`Failed to save default thumbnail for ${model.filePath}:`, saveError);
          }
        }
      }

      // Update final progress
      if (hasProgressUI) {
        progressBar.style.width = '100%';
        progressText.textContent = `Completed ${totalThumbnailsToGenerate}/${totalThumbnailsToGenerate} (100%)`;
      }
      
    } catch (error) {
      console.error('Error in thumbnail generation:', error);
    } finally {
      // Close the dialog if it exists and was opened
      if (hasProgressUI && progressDialog.open) {
        progressDialog.close();
      }
    }
  }

  // Add these constants at the top of the file (if not already present)
  const PAGE_SIZE = 100; // Number of models to keep in memory
  let allFilteredModels = []; // Store all filtered models (references only)
  let visibleModels = []; // Store currently visible models (full data)
  let currentPage = 0;
  let isVirtualScrolling = false;

  // Update the view-library-button click handler
  document.getElementById('view-library-button')?.addEventListener('click', async () => {
    try {
      // Clear dateAddedFilter when viewing entire library
      window.dateAddedFilter = null;
      window._lastDateAddedFilter = null;
      
      // Reset all filter dropdowns
      document.getElementById('designer-select').value = '';
      document.getElementById('license-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      document.getElementById('tag-filter').value = '';
      document.getElementById('filetype-select').value = '';
      document.getElementById('search-filter-input').value = '';
      
      // Explicitly clear the directory filter
      window.currentDirectoryFilter = "";
      
      // Hide the "Showing 100 Newest Models" message
      const viewLibMsg = document.getElementById("view-library-message");
      if (viewLibMsg) {
        viewLibMsg.style.display = "none";
      }
      
      // Flag that we're viewing the entire library
      window.viewingEntireLibrary = true;
      
      // Clear the filter indicator
      const filterIndicator = document.getElementById('current-filter');
      if (filterIndicator) {
        filterIndicator.innerHTML = "";
        filterIndicator.classList.remove('visible');
      }
      
      // Use the combined search function to retrieve and display models with all filters applied correctly
      await window.performCombinedSearch();
      
      console.log("Viewing entire library");
    } catch (error) {
      console.error('Error loading library:', error);
      await window.electron.showMessage('Error', 'Failed to load library.');
    }
  });

  // New function to initialize virtual scrolling
  async function initializeVirtualScrolling(modelRefs) {
    try {
      // First, clear any existing content
      const grid = document.getElementById('file-grid');
      grid.innerHTML = '';
      
      // Show loading
      document.getElementById('spinner').classList.remove('hidden');
      
      // Calculate total number of models
      const totalCount = modelRefs.length;
      console.log(`Setting up virtual grid with ${totalCount} models`);
      
      // Update the model count display
      updateModelCounts(totalCount);
      
      // Create placeholder items for all models
      let fragment = document.createDocumentFragment();
      
      // Use the same file-item creation and styling as the regular view
      modelRefs.forEach(model => {
        const fileElement = document.createElement('div');
        fileElement.className = 'file-item';
        fileElement.setAttribute('data-filepath', model.filePath);
        
        const thumbnailContainer = document.createElement('div');
        thumbnailContainer.className = 'thumbnail-container';
        thumbnailContainer.style.background = getComputedStyle(document.documentElement).getPropertyValue('--model-background-color');
        
        // Create print status indicator
        const printStatus = document.createElement('div');
        printStatus.className = 'print-status';
        printStatus.textContent = 'Not Printed';
        printStatus.style.cursor = 'pointer';
        printStatus.title = 'Click to toggle printed status';
        
        // Add click handler to toggle printed status
        printStatus.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation(); // Prevent triggering file item click
          
          // Get current model to check printed status
          const currentModel = await window.electron.getModel(model.filePath);
          if (currentModel) {
            const newPrintedStatus = !currentModel.printed;
            await autoSaveModel('printed', newPrintedStatus, model.filePath);
          }
        });
        
        thumbnailContainer.appendChild(printStatus);
        
        fileElement.appendChild(thumbnailContainer);
        
        // Create file info container
        const fileInfo = document.createElement('div');
        fileInfo.className = 'file-info';
        
        // Add file name element
        const fileName = document.createElement('div');
        fileName.className = 'file-name';
        fileName.textContent = path.basename(model.filePath);
        fileInfo.appendChild(fileName);
        
        // Add file details
        const fileDetails = document.createElement('div');
        fileDetails.className = 'file-details';
        fileDetails.textContent = 'Loading...';
        fileInfo.appendChild(fileDetails);
        
        fileElement.appendChild(fileInfo);
        
        // Add click handler
        fileElement.addEventListener('click', (e) => handleFileClick(e, model.filePath));
        
        // Add context menu handler
        addContextMenuHandler(fileElement, model.filePath);
        
        fragment.appendChild(fileElement);
      });
      
      grid.appendChild(fragment);
      
      // Start loading models and rendering thumbnails
      loadAndRenderModels(modelRefs);
      
      // Hide spinner when initial rendering is done
      document.getElementById('spinner').classList.add('hidden');
      
    } catch (error) {
      console.error('Error initializing virtual scrolling:', error);
      document.getElementById('spinner').classList.add('hidden');
    }
  }

  // Add this helper function to load and render models
  async function loadAndRenderModels(modelRefs, batchSize = 20) {
    if (!modelRefs || !Array.isArray(modelRefs)) {
      console.warn('Invalid model references provided to loadAndRenderModels');
      return;
    }
    
    try {
      // Process in batches for better performance
      for (let i = 0; i < modelRefs.length; i += batchSize) {
        const batch = modelRefs.slice(i, i + batchSize);
        
        // Load detailed model data for each model in the batch
        for (const modelRef of batch) {
          if (!modelRef || !modelRef.filePath) {
            console.warn('Invalid model reference:', modelRef);
            continue; // Skip this iteration
          }
          
          try {
            // Get model data from electron
            const model = await window.electron.getModel(modelRef.filePath);
            if (!model) {
              console.warn(`No model data returned for ${modelRef.filePath}`);
              continue; // Skip if no model data
            }
            
            // Find the element for this model by iterating through all file items
            // This avoids CSS escaping issues with special characters in file paths
            const allFileItems = document.querySelectorAll('.file-item');
            let fileElement = null;
            const normalizedModelRefPath = normalizePathForComparison(modelRef.filePath);
            for (const item of allFileItems) {
              const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedModelRefPath) {
                fileElement = item;
                break;
              }
            }
            if (!fileElement) {
              console.warn(`Element for model ${modelRef.filePath} not found in DOM`);
              continue; // Skip if element not found
            }
            
            // Update print status
            const printStatus = fileElement.querySelector('.print-status');
            if (printStatus) {
              if (model.printed) {
                printStatus.textContent = 'Printed';
                printStatus.classList.add('printed');
              } else {
                printStatus.textContent = 'Not Printed';
                printStatus.classList.remove('printed');
              }
            }
            
            // Update file details
            const fileDetails = fileElement.querySelector('.file-details');
            if (fileDetails) {
              // Use formatFileSize function if it exists
              const sizeText = model.size ? 
                (typeof formatFileSize === 'function' ? formatFileSize(model.size) : `${Math.round(model.size / 1024)} KB`) : 
                '';
              
              const designerText = model.designer ? `Designer: ${model.designer}` : '';
              fileDetails.textContent = [sizeText, designerText].filter(Boolean).join(' • ');
            }
            
            // Load thumbnail
            const thumbnailContainer = fileElement.querySelector('.thumbnail-container');
            if (thumbnailContainer) {
              // Check if an image already exists
              if (!thumbnailContainer.querySelector('img')) {
                if (model.thumbnail) {
                  const img = document.createElement('img');
                  img.src = model.thumbnail;
                  thumbnailContainer.appendChild(img);
                } else {
                  // Queue for thumbnail generation if the function exists
                  if (typeof renderModelToPNG === 'function') {
                    renderModelToPNG(modelRef.filePath, thumbnailContainer);
                  }
                }
              }
            }
          } catch (e) {
            console.error(`Error loading model ${modelRef.filePath}:`, e);
            // Continue with next model even if one fails
          }
        }
        
        // Allow UI to update between batches
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    } catch (error) {
      console.error('Error in loadAndRenderModels:', error);
    }
  }


  // Add this function to check if a model should be visible based on current filters
  async function isModelVisible(model) {
    const designer = document.getElementById('designer-select').value;
    const license = document.getElementById('license-select').value;
    const parentModel = document.getElementById('parent-select').value;
    const printStatus = document.getElementById('printed-select').value;
    const tagFilter = document.getElementById('tag-filter').value;
    const fileType = document.getElementById('filetype-select').value;
    const searchTerm = document.getElementById('search-filter-input')?.value.trim() || '';

    // Apply each filter
    if (designer && designer !== '__none__' && model.designer !== designer) return false;
    if (designer === '__none__' && model.designer) return false;
    if (license && model.license !== license) return false;
    if (parentModel && model.parentModel !== parentModel) return false;
    if (printStatus === 'printed' && !model.printed) return false;
    if (printStatus === 'not-printed' && model.printed) return false;
    if (fileType) {
      if (fileType.toLowerCase() === 'zip') {
        // For zip filter, show all models inside ZIP archives (entries with :: separator)
        if (!model.filePath || !model.filePath.includes('::')) return false;
      } else {
        if (!model.fileName.toLowerCase().endsWith(`.${fileType.toLowerCase()}`)) return false;
      }
    }
    
    // Handle tag filter
    if (tagFilter) {
      const modelTags = await window.electron.getModelTags(model.id);
      if (!modelTags || !modelTags.some(tag => tag.name === tagFilter)) return false;
    }

    // Handle search term
    if (searchTerm) {
      const searchFields = [model.fileName, model.designer, model.parentModel, model.notes, model.filePath]
        .filter(Boolean)
        .map(field => field.toLowerCase());
      if (!searchFields.some(field => field.includes(searchTerm.toLowerCase()))) return false;
    }

    return true;
  }

 

  // Fix the renderVisibleItems function to maintain selection state
  function renderVisibleItems(startIndex) {
    const container = document.getElementById('visible-items-container');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Calculate grid layout
    const containerWidth = container.parentElement.clientWidth;
    const itemWidth = 250; // Approximate width of each item
    const columns = Math.max(Math.floor(containerWidth / itemWidth), 1);
    
    visibleModels.forEach((model, index) => {
      if (!model || !model.filePath) return; // Skip invalid models
      
      const absoluteIndex = startIndex + index;
      const row = Math.floor(absoluteIndex / columns);
      const col = absoluteIndex % columns;
      
      const item = createModelItem(model, currentGridView);
      item.style.position = 'absolute';
      item.style.top = `${row * 300}px`; // 300px height per item
      item.style.left = `${col * (containerWidth / columns)}px`;
      item.style.width = `${containerWidth / columns - 20}px`; // 20px for margins
      
      // Set selection state from global Set
      if (selectedModels.has(model.filePath)) {
        item.classList.add('selected');
      }
      
      container.appendChild(item);
    });
  }


  // Update the filter indicator
  function updateFilterIndicator(count) {
    const filterIndicator = document.getElementById('current-filter');
    if (filterIndicator) {
      if (count === 0) {
        filterIndicator.innerHTML = `<div class="no-results">No models match your filters</div>`;
      } else {
        filterIndicator.innerHTML = `<div class="filter-count">Showing ${count} models</div>`;
      }
    }
  }

  document.getElementById('select-all-button')?.addEventListener('click', async () => {
    // Clear existing selections first
    selectedModels.clear();
    
    try {
      // Get all filtered model references (not just visible ones)
      const filteredModels = await window.getCombinedFilteredModels(); // Use the function from search.js
      
      // Add all filtered models to selection (ensuring no duplicates by file path)
      const uniqueFilePaths = new Set();
      filteredModels.forEach(model => {
        if (!uniqueFilePaths.has(model.filePath)) {
          uniqueFilePaths.add(model.filePath);
          addToSelectedModels(model.filePath);
        }
      });
      
      // Update UI for all items with matching file paths that are rendered
      // Use helper function to ensure normalized path comparison
      filteredModels.forEach(model => {
        if (isInSelectedModels(model.filePath)) {
          document.querySelectorAll('.file-item').forEach(item => {
            const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
            if (normalizePathForComparison(itemPath) === normalizePathForComparison(model.filePath)) {
              item.classList.add('selected');
            }
          });
        }
      });
      
      // Update the selected count
      updateSelectedCount();
      
      // Show multi-edit panel if there are selections
      if (selectedModels.size > 0) {
        showMultiEditPanel();
      }
    } catch (error) {
      console.error('Error selecting all models:', error);
    }
  });

  // Remove the override of getCombinedFilteredModels - use the one from search.js instead
  // window.getCombinedFilteredModels = async (limit = 0) => {
  //   try {
  //     // Get current filter values
  //     ...
  //   } catch (error) {
  //     console.error("Error in getCombinedFilteredModels:", error);
  //     return [];
  //   }
  // };

  // Add this IPC handler to preload.js
  // getAllModelReferences: () => ipcRenderer.invoke('get-all-model-references'),

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      // Initialize the application
      await initializeApp();
      
      // Set up multi-edit button handler
      const multiEditBtn = document.getElementById('multi-edit-btn');
      if (multiEditBtn) {
        multiEditBtn.addEventListener('click', async () => {
          await showMultiEditPanel();
        });
      }
      
      // Set up multi-edit close button
      const closeMultiEditBtn = document.getElementById('close-multi-edit');
      if (closeMultiEditBtn) {
        closeMultiEditBtn.addEventListener('click', () => {
          exitMultiEditMode();
        });
      }
      
      // Initialize multi-edit tag handling
      const addMultiEditTagBtn = document.getElementById('add-multi-edit-tag');
      if (addMultiEditTagBtn) {
        addMultiEditTagBtn.addEventListener('click', async () => {
          const tagSelect = document.getElementById('multi-edit-tag-select');
          if (tagSelect && tagSelect.value) {
            await autoSaveMultipleModels('tags', tagSelect.value);
            tagSelect.value = ''; // Reset selection
          }
        });
      }
      
      // Debug log for initialization
      debugLog('Multi-edit panel initialization complete');
      
    } catch (error) {
      console.error('Error during application initialization:', error);
    }
  });

  // ... existing code ...
});

async function updateSelectedCount() {
  const countElement = document.querySelector('.selected-count');
  if (countElement) {
    countElement.textContent = `${selectedModels.size} model${selectedModels.size !== 1 ? 's' : ''} selected`;
  }
  
  // Clear tags when selection changes significantly (new group of files selected)
  clearTagsOnSelectionChange();
  
  // Clear multi-edit form fields when no models are selected
  if (selectedModels.size === 0 && isMultiSelectMode) {
    clearMultiEditFormFields();
  }

  // Refresh the remove tag dropdown when selection changes (if in multi-edit mode)
  if (isMultiSelectMode && selectedModels.size > 0) {
    await populateRemoveTagSelect();
  }
}

// Track previous selection to detect when a completely new selection is made
let previousSelectionHash = '';

function clearTagsOnSelectionChange() {
  // Create a hash of current selection to detect complete selection changes
  const currentSelectionHash = selectedModels.size > 0 
    ? Array.from(selectedModels).sort().join('|')
    : '';
  
  // If selection was cleared (went from >0 to 0), mark for clearing on next selection
  if (previousSelectionHash && selectedModels.size === 0) {
    previousSelectionHash = ''; // Reset so next selection is treated as new
    return;
  }
  
  // If this is a completely new selection (no overlap with previous), clear tags
  if (previousSelectionHash && currentSelectionHash && 
      previousSelectionHash !== currentSelectionHash && 
      selectedModels.size > 0) {
    // Check if there's any overlap - if no overlap, it's a completely new selection
    const previousFiles = new Set(previousSelectionHash.split('|'));
    const currentFiles = new Set(currentSelectionHash.split('|'));
    const hasOverlap = Array.from(currentFiles).some(file => previousFiles.has(file));
    
    // If no overlap, clear tags as this is a completely new selection
    if (!hasOverlap) {
      const multiTagsContainer = document.getElementById('multi-tags');
      if (multiTagsContainer) {
        multiTagsContainer.innerHTML = '';
      }
      const multiTagSelect = document.getElementById('multi-tag-select');
      if (multiTagSelect) {
        multiTagSelect.value = '';
      }
    }
  }
  
  // Update tracking variable
  previousSelectionHash = currentSelectionHash;
}

// Update the toggleModelSelection function`
async function toggleModelSelection(fileElement, filePath) {
  if (!isMultiSelectMode) {
    const wasSelected = fileElement.classList.contains('selected');
    
    // Clear previous selections
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('selected');
    });
    
    if (wasSelected) {
      // If it was already selected, just deselect and close details
      const detailsPanel = document.getElementById('model-details');
      if (detailsPanel) {
        detailsPanel.classList.add('hidden');
      }
    } else {
      // Add selection to the clicked item
      selectedModels.add(filePath);
      
      // Only select this specific element, not all elements with the same filePath
      fileElement.classList.add('selected');
      
      // Show model details
      showModelDetails(filePath);
    }
  } else {
    // Multi-select mode
    if (fileElement.classList.contains('selected')) {
      // Deselect
      selectedModels.delete(filePath);
      fileElement.classList.remove('selected');
    } else {
      // Select
      selectedModels.add(filePath);
      fileElement.classList.add('selected');
    }
    await updateSelectedCount(); // This will clear form fields if selection is now 0
  }
}

// NOTE: loadModel function is defined earlier in the file (around line 2840)
// This duplicate has been removed to use the enhanced version that checks for embedded images

function fitCameraToObject(camera, object, scene, renderer) {
  const boundingBox = new THREE.Box3().setFromObject(scene);
  const size = boundingBox.getSize(new THREE.Vector3());
  const center = boundingBox.getCenter(new THREE.Vector3());

  // Position camera to fit object
  const maxDim = Math.max(size.x, size.y, size.z);
  const fov = camera.fov * (Math.PI / 180);
  let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5;

  // Update camera position to view from front-top instead of bottom
  camera.position.set(cameraZ, cameraZ, cameraZ);
  camera.lookAt(center);

  // Rotate the model to correct orientation
  object.rotation.x = -Math.PI / 2; // Rotate 90 degrees around X axis
  
  // Update the scene
  renderer.render(scene, camera);
}

function handleContextLost(event) {
  event.preventDefault();
  
  // Properly clean up resources
  if (scene) {
    scene.traverse((object) => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose());
        } else {
          object.material.dispose();
        }
      }
    });
    scene.clear();
  }
  
  renderer = null;
  scene = null;
  camera = null;
}

function handleContextRestored() {
  console.log('WebGL context restored');
  // Renderer will be recreated on next render
}

// Update showSpinner function to show progress section instead
function showProgressBars() {
  const progressSection = document.getElementById('progress-section');
  const progressBar = document.getElementById('progress-bar');
  const renderProgressBar = document.getElementById('render-progress-bar');
  const progressText = document.getElementById('progress-text');
  const renderProgressText = document.getElementById('render-progress-text');
  
  progressSection.classList.remove('hidden');
  progressBar.style.width = '0%';
  renderProgressBar.style.width = '0%';
  progressText.textContent = '0 / 0 files';
  renderProgressText.textContent = '0 / 0 models';
}

// Update hideSpinner function
function hideProgressBars() {
  const progressSection = document.getElementById('progress-section');
  progressSection.classList.add('hidden');
}

// Update function signature to include background parameter
async function scanAndRenderDirectory(directoryPath, background = false) {
  const progressSection = document.getElementById('progress-section');
  const progressContainer = document.getElementById('progress-container');
  const progressBar = document.getElementById('progress-bar');
  const progressText = document.getElementById('progress-text');
  const renderProgressContainer = document.getElementById('render-progress-container');
  const renderProgressBar = document.getElementById('render-progress-bar');
  const renderProgressText = document.getElementById('render-progress-text');
  const stopButton = document.getElementById('stop-thumbnail-generation');
  const container = background ? document.createElement('div') : document.querySelector('.file-grid');
  
  // Flag to track if the process has been cancelled
  let isCancelled = false;
  
  // Function to handle stop button click
  const handleStopClick = () => {
    isCancelled = true;
    renderProgressText.textContent = 'Stopping...';
    console.log('Thumbnail generation cancelled by user');
  };
  
  // Add event listener to stop button
  stopButton.addEventListener('click', handleStopClick);

  try {
    if (background) {
      window.disableGridRefresh = true;
      console.log('Background scan: grid refresh disabled');
    }
    if (!background) {
      progressSection.classList.remove('hidden');
      progressContainer.classList.remove('hidden');
      renderProgressContainer.classList.remove('hidden');
      progressBar.style.width = '0%';
      progressText.textContent = 'Gathering files...';
      stopButton.style.display = 'block';
    }

    // Use file extension to determine file type
    const isValidFile = (filename, size) => {
      const ext = filename.toLowerCase().split('.').pop();
      const maxSize = MAX_FILE_SIZE_MB * 1024 * 1024;
      return (ext === 'stl' || ext === '3mf') && size <= maxSize;
    };

    // Store scan start time for filtering newly added models
    const scanStartTime = new Date().toISOString();
    
    // Update the scan directory call to use the new validation and cancellation
    const scanResult = await window.electron.scanDirectory(directoryPath, isValidFile);
    const { files, totalFiles, newFilesCount, cancelScan } = scanResult || { files: [], totalFiles: 0, newFilesCount: 0 };
    
    if (isCancelled) {
      if (cancelScan) cancelScan(); // Cancel the scan if possible
      throw new Error('Operation cancelled by user.');
    }
    
    if (!files || files.length === 0) {
      if (!background) {
        progressBar.style.width = '100%';
        progressText.textContent = '';
        renderProgressBar.style.width = '100%';
        renderProgressText.textContent = '';
      }
      console.log('No files found in directory:', directoryPath);
      return; // Exit the function early instead of throwing error
    }

    console.log('Scanned files:', totalFiles);

    const allModels = await window.electron.getAllModels();
    const existingFiles = new Set(allModels.map(model => model.filePath));
    const existingThumbnails = new Map(allModels.map(model => [model.filePath, model.thumbnail]));

    if (!background) {
      progressBar.style.width = '0%';
      progressText.textContent = `Processing ${files.length} files...`;
    }

    const newFiles = files.filter(file => !existingFiles.has(file.filePath));
    
    // Use a more efficient approach for saving models
    if (newFiles.length > 0) {
      const fileProgressUpdate = (completed) => {
        if (!background) {
          const progress = (completed / newFiles.length) * 100;
          progressBar.style.width = `${progress}%`;
          progressText.textContent = `${completed} / ${newFiles.length} files`;
        }
      };

      // Process files in larger batches for better performance
      const saveBatchSize = 50; // Increased from 10
      for (let i = 0; i < newFiles.length; i += saveBatchSize) {
        if (isCancelled) {
          throw new Error('Operation cancelled by user.');
        }
        
        const batch = newFiles.slice(i, Math.min(i + saveBatchSize, newFiles.length));
        const modelDataBatch = batch.map(file => ({
          filePath: file.filePath,
          fileName: file.fileName,
          hash: file.hash,
          size: file.size,
          modifiedDate: file.mtime
        }));
        
        // Save models in batch for better performance
        await window.electron.saveModelBatch(modelDataBatch);
        fileProgressUpdate(Math.min(i + saveBatchSize, newFiles.length));
      }
    }

    if (!background) {
      progressBar.style.width = '100%';
    }

    const filesNeedingThumbnails = files.filter(file => !existingThumbnails.has(file.filePath));
    if (!background) {
      progressText.textContent = `${filesNeedingThumbnails.length} models found`;
      renderProgressBar.style.width = '0%';
      renderProgressText.textContent = `0 / ${filesNeedingThumbnails.length} models`;
      container.innerHTML = '';
    }

    if (filesNeedingThumbnails.length > 0) {
      let completedThumbnails = 0;
      const thumbnailProgressUpdate = (completed) => {
        if (!background) {
          const progress = (completed / filesNeedingThumbnails.length) * 100;
          renderProgressBar.style.width = `${progress}%`;
          renderProgressText.textContent = `${completed} / ${filesNeedingThumbnails.length} models`;
        }
      };

      // Improved thumbnail generation with concurrency control and cancellation
      const maxConcurrentThumbnails = 5; // Increased from 1 for better performance
      const thumbnailQueue = [...filesNeedingThumbnails];
      const activePromises = new Set();
      
      while (thumbnailQueue.length > 0 && !isCancelled) {
        // Fill up to max concurrent thumbnails
        while (activePromises.size < maxConcurrentThumbnails && thumbnailQueue.length > 0) {
          const file = thumbnailQueue.shift();
          
          const promise = (async () => {
            try {
              if (existingThumbnails.has(file.filePath)) {
                console.log(`Thumbnail found for ${file.filePath} in database. Skipping render.`);
                return;
              }
              
              // Add code to actually render the thumbnail
              // Use the same thumbnail generation code that's in renderFile
              const fileExtension = file.filePath.split('.').pop().toLowerCase();
              let thumbnail = null;
              
              if (fileExtension === '3mf') {
                try {
                  const images = await window.electron.get3MFImages(file.filePath);
                  if (images && images.length > 0) {
                    console.log(`[DEBUG] Found ${images.length} embedded image(s) in 3MF: ${file.filePath}`);
                    // Add all images to model's thumbnails at once using batch function
                    const addResult = await window.electron.addMultipleThumbnails(file.filePath, images);
                    // Use first image as thumbnail for display
                    thumbnail = images[0];
                    console.log(`[DEBUG] Added ${images.length} images to thumbnails for ${file.filePath}`);
                    
                    // If we're in detailed view and added multiple thumbnails, update the DOM item
                    if (addResult && addResult.success && addResult.thumbnailCount > 1 && currentGridView === 'detailed') {
                      // Update the existing item to show navigation controls
                      setTimeout(async () => {
                        try {
                          const allFileItems = document.querySelectorAll('.file-item');
                          const normalizedPath = normalizePathForComparison(file.filePath);
                          for (const fileItem of allFileItems) {
                            const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
                            const normalizedItemPath = normalizePathForComparison(itemPath);
                            if (normalizedItemPath === normalizedPath && fileItem.classList.contains('file-item-detailed')) {
                              // Get updated model with all thumbnails
                              const updatedModel = await window.electron.getModel(file.filePath);
                              if (updatedModel) {
                                const container = document.querySelector('.file-grid');
                                if (container && container.currentModels) {
                                  // Update the model in the array
                                  const modelIndex = container.currentModels.findIndex(m => 
                                    normalizePathForComparison(m.filePath) === normalizedPath
                                  );
                                  if (modelIndex >= 0) {
                                    container.currentModels[modelIndex] = updatedModel;
                                    // Remove the item so it gets recreated with navigation
                                    fileItem.remove();
                                    // Trigger re-render
                                    if (container.renderVisibleItemsFn) {
                                      container.renderVisibleItemsFn();
                                    }
                                    console.log(`[DEBUG] Updated DOM item for ${file.filePath} to show navigation controls`);
                                  }
                                }
                              }
                              break;
                            }
                          }
                        } catch (updateError) {
                          console.error(`[DEBUG] Error updating DOM for ${file.filePath}:`, updateError);
                        }
                      }, 300);
                    }
                  } else {
                    console.log(`[DEBUG] No embedded images found in 3MF: ${file.filePath}`);
                  }
                } catch (imageError) {
                  console.error('Error checking for embedded image:', imageError);
                }
              }
              
              if (!thumbnail) {
                thumbnail = await new Promise((resolve, reject) => {
                  renderQueue.push({
                    filePath: file.filePath,
                    container: document.createElement('div'), // Dummy container
                    existingThumbnail: null,
                    resolve,
                    reject
                  });
                  processRenderQueue();
                });
                
                if (thumbnail) {
                  await window.electron.saveThumbnail(file.filePath, thumbnail);
                }
              }
              
              // Calculate and save hash during thumbnail generation (file is already being read)
              if (!file.hash || file.hash === '') {
                try {
                  await window.electron.calculateFileHash(file.filePath);
                } catch (hashError) {
                  console.error(`Error calculating hash for ${file.filePath}:`, hashError);
                  // Continue even if hash calculation fails
                }
              }
            } catch (error) {
              console.error('Error caching thumbnail:', error);
            } finally {
              if (!existingThumbnails.has(file.filePath)) {
                completedThumbnails++;
                thumbnailProgressUpdate(completedThumbnails);
              }
              activePromises.delete(promise);
            }
          })();
          
          activePromises.add(promise);
        }
        
        // Wait for at least one promise to complete before continuing
        if (activePromises.size > 0) {
          await Promise.race(Array.from(activePromises));
        }
        
        // Check for cancellation after each batch
        if (isCancelled) {
          console.log('Thumbnail generation cancelled, stopping process');
          break;
        }
      }
      
      // Wait for any remaining active promises to complete
      if (activePromises.size > 0) {
        await Promise.all(Array.from(activePromises));
      }
    } else {
      if (!background) {
        renderProgressBar.style.width = '100%';
        renderProgressText.textContent = 'All thumbnails up to date';
      }
    }
    
    // Update additional UI components only if not in background mode
    if (!background) {

      document.getElementById('designer-select').value = '';
      document.getElementById('parent-select').value = '';
      document.getElementById('printed-select').value = 'all';
      document.getElementById('tag-filter').value = '';

      const finalModels = await window.electron.getAllModels();
      await updateModelCounts(finalModels.length);
      
      // Show dialog if new files were found
      if (newFilesCount > 0) {
        const result = await window.electron.showMessageBox({
          type: 'question',
          buttons: ['Yes', 'No'],
          defaultId: 0,
          title: 'New Models Found',
          message: `${newFilesCount} new model(s) found, would you like to see them?`
        });
        
        if (result.response === 0) {
          // User clicked "Yes" - apply dateAdded filter to show only newly added models
          // Set the dateAdded filter FIRST before clearing inputs to prevent event listeners from firing
          window.dateAddedFilter = scanStartTime;
          window._lastDateAddedFilter = scanStartTime; // Backup copy
          console.log('Setting dateAddedFilter to:', scanStartTime);
          
          // Clear all other filters (this will trigger change events, but dateAddedFilter is already set)
          // Use a flag to prevent the change events from clearing dateAddedFilter
          window._suppressFilterEvents = true;
          document.getElementById('designer-select').value = '';
          document.getElementById('parent-select').value = '';
          document.getElementById('printed-select').value = 'all';
          document.getElementById('tag-filter').value = '';
          document.getElementById('filetype-select').value = '';
          document.getElementById('search-filter-input').value = '';
          window.currentDirectoryFilter = null;
          window._suppressFilterEvents = false;
          
          // Small delay to ensure all event handlers have processed
          await new Promise(resolve => setTimeout(resolve, 100));
          
          // Verify dateAddedFilter is still set
          if (!window.dateAddedFilter) {
            console.warn('dateAddedFilter was cleared, resetting it');
            window.dateAddedFilter = scanStartTime;
            window._lastDateAddedFilter = scanStartTime;
          }
          
          // Re-render models with the dateAdded filter applied
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          } else {
            // Fallback to renderFiles if performCombinedSearch is not available
            const filteredModels = await window.electron.getModelsFiltered({
              dateAdded: scanStartTime
            });
            await renderFiles(filteredModels);
          }
        } else {
          // User clicked "No" - clear dateAdded filter and refresh normally
          window.dateAddedFilter = null;
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          } else {
            // Fallback to renderFiles if performCombinedSearch is not available
            await renderFiles(finalModels);
          }
        }
      } else {
        // No new files, just refresh normally
        // Re-render models after scanning completes
        // Use performCombinedSearch to ensure filters are properly applied
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        } else {
          // Fallback to renderFiles if performCombinedSearch is not available
          await renderFiles(finalModels);
        }
      }
    }
  } catch (error) {
    console.error('Error scanning directory:', error);
    if (!background) {
      renderProgressText.textContent = `Error: ${error.message}`;
      // Show alert for UNC path validation errors
      if (error.message && error.message.includes('UNC path')) {
        alert(`Error: ${error.message}\n\nIn server mode, all file paths must be UNC paths (e.g., \\\\server\\share\\path\\to\\file.stl)`);
      }
    }
  } finally {
    // Clean up event listener
    stopButton.removeEventListener('click', handleStopClick);
    
    if (!background) {
      progressSection.classList.add('hidden');
    } else {
      window.disableGridRefresh = false;
      console.log('Background scan complete: grid refresh re-enabled');
    }
  }
}

// Process 2: Model Display and Management
async function refreshModelDisplay() {
  try {
    // Get current filter values
    const designer = document.getElementById('designer-select').value;
    const license = document.getElementById('license-select').value;
    const parentModel = document.getElementById('parent-select').value;
    const printStatus = document.getElementById('printed-select').value;
    const tagFilter = document.getElementById('tag-filter').value;
    const sortOption = document.getElementById('sort-select').value;
    const fileType = document.getElementById('filetype-select').value; // Add this line
    const searchInput = document.getElementById("search-filter-input");
    const searchTerm = searchInput ? searchInput.value.trim() : "";

    

    
    // Restore filter selections
    document.getElementById('designer-select').value = designer;
    document.getElementById('license-select').value = license;
    document.getElementById('parent-select').value = parentModel;
    document.getElementById('printed-select').value = printStatus;
    document.getElementById('tag-filter').value = tagFilter;
    document.getElementById('filetype-select').value = fileType; // Add this line

    // Get all models with current sort option
    let models = await window.electron.getAllModels(sortOption, 0);

    // Add file type filter
    if (fileType) {
      if (fileType.toLowerCase() === 'zip') {
        // For zip filter, show all models inside ZIP archives (entries with :: separator)
        models = models.filter(model => 
          model.filePath && model.filePath.includes('::')
        );
      } else {
        models = models.filter(model => 
          model.fileName.toLowerCase().endsWith(`.${fileType.toLowerCase()}`)
        );
      }
    }

    // Apply filters
    if (designer) {
      if (designer === '__none__') {
        models = models.filter(model => !model.designer || model.designer.trim() === '');
      } else {
        models = models.filter(model =>
          model.designer &&
          model.designer.trim().toLowerCase() === designer.trim().toLowerCase()
        );
      }
    }
    if (license) {
      if (license === '__none__') {
        models = models.filter(model => !model.license || model.license.trim() === '');
      } else {
        models = models.filter(model => model.license === license);
      }
    }
    if (parentModel) {
      if (parentModel === '__none__') {
        models = models.filter(model => !model.parentModel || model.parentModel.trim() === '');
      } else {
        models = models.filter(model => model.parentModel === parentModel);
      }
    }
    if (printStatus === 'printed') {
      models = models.filter(model => model.printed);
    } else if (printStatus === 'not-printed') {
      models = models.filter(model => !model.printed);
    }
    if (tagFilter) {
      models = await Promise.all(models.map(async (model) => {
        const modelTags = await window.electron.getModelTags(model.id);
        if (modelTags && modelTags.some(tag => tag.name === tagFilter)) {
          return model;
        }
        return null;
      }));
      models = models.filter(model => model !== null);
    }

    // Display filtered models
    await displayModels(models);
  } catch (error) {
    console.error('Error refreshing model display:', error);
  }
}

// ==================== Modified displayModels() to use the virtual grid ====================
async function displayModels(files) {
  // Instead of appending items in batches, we now use the virtual grid to render them.
  renderVirtualGrid(files);
  await updateModelCounts(files.length);
}


// Add event listeners for all filter changes
document.addEventListener('DOMContentLoaded', () => {
  const filterElements = [
    'designer-select',
    'license-select',
    'parent-select',
    'printed-select',
    'tag-filter',
    // Note: sort-select is handled by search.js via initializeCombinedSearch()
    'filetype-select'  // Add this line
  ];

  filterElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', handleFilterChange);
    }
  });
});

// Add this near the top with other constants
const GC_INTERVAL = 100; // Number of models to process before garbage collection

// Update the renderFiles function to handle pagination
async function renderFiles(files, skipThumbnail = false, viewEntireLibrary = false) {
  if (window.disableGridRefresh) {
    console.log('Grid refresh is disabled, skipping renderFiles');
    return;
  }
  
  // Defensive: If dateAddedFilter is active and we're being called with many models,
  // filter them to preserve the "new models" view
  // This prevents something from bypassing performCombinedSearch and showing all models
  // BUT: Only apply this if the user hasn't actively cleared filters (check if search/filters are empty)
  const searchInput = document.getElementById('search-filter-input');
  const hasActiveUserFilters = searchInput?.value.trim() || 
                               document.getElementById('designer-select')?.value ||
                               document.getElementById('tag-filter')?.value ||
                               document.getElementById('filetype-select')?.value;
  
  if (window.dateAddedFilter && files.length > 10 && !hasActiveUserFilters) {
    console.warn('renderFiles called with', files.length, 'models while dateAddedFilter is active! Filtering to preserve new models view...');
    const filterDate = new Date(window.dateAddedFilter);
    const originalCount = files.length;
    files = files.filter(model => {
      if (!model.dateAdded) return false;
      const modelDate = new Date(model.dateAdded);
      return modelDate >= filterDate;
    });
    console.log('Filtered from', originalCount, 'to', files.length, 'models');
  }

  // Use the new virtual grid implementation for better performance
  renderVirtualGrid(files);

  // Update counts
  await updateModelCounts(files.length);

  // Handle thumbnail generation for visible items?
  // renderVirtualGrid handles creating items, but thumbnail generation might need to be triggered
  // for visible items if they don't have thumbnails.
  // Ideally, createModelItem should queue thumbnail generation if missing.
  // Since createModelItem calls renderModelToPNG only if needed (in our updated logic? No, createModelItem uses '3d.png' default).
  // We might want to trigger thumbnail generation for models without thumbnails in the background.

  // Note: renderVirtualGrid doesn't currently trigger thumbnail generation automatically for missing thumbnails
  // except what createModelItem does.
  // createModelItem in the new code uses model.thumbnail || '3d.png'.

  // Trigger background thumbnail generation for files without thumbnails
  // This maintains the previous behavior but decouples it from the initial render
  const filesWithoutThumbnails = files.filter(file => !file.thumbnail);
  if (filesWithoutThumbnails.length > 0) {
    // We can use the existing queue mechanism
    filesWithoutThumbnails.forEach(file => {
       // Only queue if we haven't already queued it?
       // For now, let's rely on the user triggers or existing background processes.
       // Or we can queue them here.
    });
  }
}

async function handleFilterChange() {
  try {
    // Clear previous selections explicitly
    selectedModels.clear();

    // Clear visual selection indicators
    document.querySelectorAll('.file-item').forEach(item => {
      item.classList.remove('selected');
    });

    // Hide multi-edit panel if it's open
    const multiEditPanel = document.getElementById('multi-edit-panel');
    if (multiEditPanel && !multiEditPanel.classList.contains('hidden')) {
      multiEditPanel.classList.add('hidden');
      const detailsPanel = document.getElementById('model-details');
      if (detailsPanel) {
        detailsPanel.classList.remove('hidden');
      }
      const editModeToggle = document.getElementById('edit-mode-toggle');
      if (editModeToggle) {
        editModeToggle.textContent = 'Multi-Edit Mode';
        editModeToggle.classList.remove('active');
      }
      isMultiSelectMode = false;
    }

    // Update the selected count display
    updateSelectedCount();

    // Get and display filtered models
    const models = await window.getCombinedFilteredModels();
    await displayModels(models);
  } catch (error) {
    console.error("Error applying filters:", error);
  }
}

async function renderFile(file, container, skipThumbnail = false) {
  const fileElement = document.createElement('div');
  fileElement.className = 'file-item';
  fileElement.dataset.filepath = file.filePath; // Use dataset for data attributes

  if (isInSelectedModels(file.filePath)) {
    fileElement.classList.add('selected');
  }

  const printStatus = document.createElement('div');
  printStatus.className = `print-status ${file.printed? 'printed': ''}`;
  printStatus.textContent = file.printed? 'Printed': 'Not Printed';
  fileElement.appendChild(printStatus);

  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'thumbnail-container loading';
  fileElement.appendChild(thumbnailContainer);

  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  
  // Check if this is a zip entry
  const isZipEntry = file.filePath.includes('::');
  if (isZipEntry) {
    const zipBadge = document.createElement('span');
    zipBadge.className = 'zip-badge';
    zipBadge.textContent = 'ZIP';
    zipBadge.title = 'This model is inside a ZIP archive';
    zipBadge.style.cssText = 'background: #4a90e2; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; font-weight: bold; margin-right: 6px;';
    fileName.appendChild(zipBadge);
  }
  
  const fileNameText = document.createElement('span');
  fileNameText.textContent = file.fileName;
  fileName.appendChild(fileNameText);
  fileInfo.appendChild(fileName);

  // For zip entries, show both zip file and entry path
  let parentDir;
  if (isZipEntry) {
    const [zipPath, entryPath] = file.filePath.split('::');
    const zipFileName = zipPath.split(/[/\\]/).pop();
    parentDir = `${zipFileName} → ${entryPath.split(/[/\\]/).slice(0, -1).join('/') || 'root'}`;
  } else {
    const parentDirArray = file.filePath.split(/[/\\]/).slice(-2, -1); // Keep this as an array for now
    parentDir = parentDirArray[0]; // Get the string value from the array
  }
  
  const parentDirElement = document.createElement('div');
  parentDirElement.className = 'parent-directory';
  parentDirElement.innerHTML = `
      <span class="directory-label">Directory:</span> 
      <a href="#" class="directory-link">${parentDir}</a>
  `;
  
  parentDirElement.querySelector('.directory-link')?.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Hide any welcome or view library message.
      const viewLibMsg = document.getElementById("view-library-message");
      if (viewLibMsg) { viewLibMsg.style.display = "none"; }
      
      // For zip entries, open the zip file's directory in the file explorer
      if (isZipEntry) {
        try {
          const [zipPath] = file.filePath.split('::');
          await window.electron.showItemInFolder(zipPath);
        } catch (error) {
          console.error('Error opening zip file directory:', error);
        }
        return;
      }
      
      // Extract the full path up to the parent directory for filtering
      let directoryFilterPath;
      // For regular files, get the full path up to the parent directory
      // Make sure we're getting the directory, not the file itself
      const lastSlash = Math.max(file.filePath.lastIndexOf('\\'), file.filePath.lastIndexOf('/'));
      if (lastSlash > 0) {
        directoryFilterPath = file.filePath.substring(0, lastSlash);
        // Ensure we have a valid directory path (not a file path)
        if (!directoryFilterPath || directoryFilterPath.endsWith('.zip') || directoryFilterPath.endsWith('.stl') || directoryFilterPath.endsWith('.3mf')) {
          // If somehow we got a file path, extract the parent directory again
          const parentSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
          directoryFilterPath = parentSlash > 0 ? directoryFilterPath.substring(0, parentSlash) : '';
        }
      } else {
        directoryFilterPath = '';
      }
      
      // Validate that we have a directory path, not a file path
      // Check for common file extensions (case-insensitive)
      const lowerPath = directoryFilterPath.toLowerCase();
      if (directoryFilterPath && (lowerPath.endsWith('.zip') || lowerPath.endsWith('.stl') || lowerPath.endsWith('.3mf') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.ply'))) {
        console.warn('Directory filter appears to be a file path, extracting parent directory:', directoryFilterPath);
        const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
        directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
      }
      
      // Final validation: ensure we don't have a file path
      if (directoryFilterPath && directoryFilterPath === file.filePath) {
        console.error('Directory filter is same as file path, this should not happen. File path:', file.filePath);
        const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
        directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
      }
      
      console.log('Setting directory filter to:', directoryFilterPath, 'from file path:', file.filePath);
      
      // Set the global directory filter with the full path
      window.currentDirectoryFilter = directoryFilterPath;
      
      // Instead of filtering just by directory here, trigger the combined search which applies all filters.
      await performCombinedSearch();
      
      // Update the filter indicator to show the active parent directory filter.
      const filterIndicator = document.getElementById('current-filter');
      filterIndicator.innerHTML = `
        Showing models in directory: ${parentDir}
        <button class="clear-filter-button">Clear Filter</button>
      `;
      filterIndicator.classList.add('visible');
      
      // Attach a click handler to clear the directory filter.
      filterIndicator.querySelector('.clear-filter-button')?.addEventListener('click', async () => {
        window.currentDirectoryFilter = "";
        filterIndicator.innerHTML = "";
        filterIndicator.classList.remove('visible');
        await performCombinedSearch();
      });
    });

  fileInfo.appendChild(parentDirElement);

 

  const fileDetails = document.createElement('div');
  fileDetails.className = 'file-details';
  fileDetails.innerHTML = `<span class="directory-label">Size:
    <span>${file.size? formatFileSize(file.size): ''}</span>
  `;
  fileInfo.appendChild(fileDetails);
  fileElement.appendChild(fileInfo);

  fileElement.addEventListener('click', () => {
    toggleModelSelection(fileElement, file.filePath);
  });
 // Designer info is now shown in metadata section, so we don't need it here
 // Removed redundant designer info display

  if (!file.thumbnail &&!skipThumbnail) {
    const fileExtension = file.filePath.split('.').pop().toLowerCase();
    if (fileExtension === '3mf') {
      try {
        const images = await window.electron.get3MFImages(file.filePath);
        if (images && images.length > 0) {
          const firstImage = images[0]; // Use first image, not the array
          console.log(`[DEBUG] renderFile: Using embedded image from 3MF: ${file.filePath}`);
          const img = document.createElement('img');
          img.src = firstImage;
          img.className = 'model-thumbnail';
          thumbnailContainer.innerHTML = '';
          thumbnailContainer.appendChild(img);
          thumbnailContainer.classList.remove('loading');
          
          await window.electron.saveThumbnail(file.filePath, firstImage);
          file.thumbnail = firstImage;
          
          return fileElement;
        } else {
          console.log(`[DEBUG] renderFile: No embedded images found in 3MF: ${file.filePath}`);
        }
      } catch (imageError) {
        console.error('renderFile: Error checking for embedded image:', imageError);
      }
    }

    try {
      const thumbnail = await new Promise((resolve, reject) => {
        renderQueue.push({
          filePath: file.filePath,
          container: thumbnailContainer,
          existingThumbnail: null,
          resolve,
          reject
        });
        processRenderQueue();
      });

      if (thumbnail) {
        await window.electron.saveThumbnail(file.filePath, thumbnail);
        
        // Calculate and save hash during thumbnail generation (file is already being read)
        if (!file.hash || file.hash === '') {
          try {
            await window.electron.calculateFileHash(file.filePath);
          } catch (hashError) {
            console.error(`Error calculating hash for ${file.filePath}:`, hashError);
            // Continue even if hash calculation fails
          }
        }
      }
    } catch (error) {
      console.error(`Error rendering thumbnail for ${file.fileName}:`, error);
      thumbnailContainer.innerHTML = '<div class="error-message">Error loading model</div>';
    }
  } else if (file.thumbnail) { // Check if file.thumbnail exists before creating img element
    const img = document.createElement('img');
    img.src = file.thumbnail || '3d.png'; // Provide a default image
    img.className = 'model-thumbnail'; // Add class for styling
    thumbnailContainer.innerHTML = '';
    thumbnailContainer.appendChild(img);
    thumbnailContainer.classList.remove('loading');
  }

  addContextMenuHandler(fileElement, file.filePath);

  return fileElement;
}

async function processRenderQueue() {
  if (isProcessingQueue || renderQueue.length === 0 || activeRenders >= MAX_CONCURRENT_RENDERS) {
    return;
  }

  isProcessingQueue = true;
  
  try {
    while (renderQueue.length > 0 && activeRenders < MAX_CONCURRENT_RENDERS) {
      const task = renderQueue.shift();
      activeRenders++;
      
      try {
        const result = await renderModelToPNG(task.filePath, task.container, task.existingThumbnail);
        task.resolve(result);
      } catch (error) {
        console.error(`Render task failed: ${error.message}`);
        // Retry once after longer delay
        setTimeout(() => renderQueue.push(task), 2000);
      } finally {
        activeRenders--;
        await new Promise(resolve => setTimeout(resolve, RENDER_DELAY));
      }
    }
  } finally {
    isProcessingQueue = false;
    if (renderQueue.length > 0) {
      setTimeout(processRenderQueue, 100);
    }
  }
}

async function renderModelToPNG(filePath, container, existingThumbnail) {
  const startTime = Date.now();
  console.log(`[DEBUG] renderModelToPNG: Start rendering ${filePath}`);
  if (existingThumbnail) {
    const img = document.createElement('img');
    img.src = existingThumbnail;
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);
    return existingThumbnail;
  }

  // For 3MF files, check for embedded images BEFORE 3D rendering
  // Handle ZIP entries: get extension from entry path if it's a ZIP entry
  let fileExtension;
  if (filePath.includes('::')) {
    // ZIP entry: get extension from the entry part after ::
    const entryPath = filePath.split('::')[1];
    fileExtension = entryPath.split('.').pop().toLowerCase();
  } else {
    fileExtension = filePath.split('.').pop().toLowerCase();
  }
  
  if (fileExtension === '3mf') {
    try {
      const images = await window.electron.get3MFImages(filePath);
      if (images && images.length > 0) {
        // Add all images to model's thumbnails at once using batch function
        let result = null;
        try {
          result = await window.electron.addMultipleThumbnails(filePath, images);
          
          // After adding thumbnails, update the model in memory if we can find it
          if (result && result.success) {
            const allThumbs = await window.electron.getAllThumbnails(filePath);
            
            // Update the model object in memory if we can find it
            // This will help when the item is re-rendered
            const allFileItems = document.querySelectorAll('.file-item');
            const normalizedPath = normalizePathForComparison(filePath);
            for (const item of allFileItems) {
              const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedPath) {
                // Store the updated thumbnail string on the element
                item.dataset.thumbnail = result.thumbnailString || '';
                
                // If we added multiple thumbnails, update the existing DOM item to add navigation controls
                if (allThumbs.length > 1 && currentGridView === 'detailed') {
                  // Find the existing item and add navigation if in detailed view
                  const allFileItems = document.querySelectorAll('.file-item');
                  const normalizedPath = normalizePathForComparison(filePath);
                  for (const fileItem of allFileItems) {
                    const itemPath = fileItem.getAttribute('data-filepath') || fileItem.dataset.filepath;
                    const normalizedItemPath = normalizePathForComparison(itemPath);
                    if (normalizedItemPath === normalizedPath) {
                      // Check if it's in detailed view
                      if (fileItem.classList.contains('file-item-detailed')) {
                        const existingContainer = fileItem.querySelector('.thumbnail-container');
                        const existingWrapper = fileItem.querySelector('.thumbnail-wrapper');
                        
                        // If navigation wrapper doesn't exist, create it
                        if (existingContainer && !existingWrapper) {
                          // Get the updated model with all thumbnails
                          const updatedModel = await window.electron.getModel(filePath);
                          if (updatedModel && updatedModel.thumbnail) {
                            // Re-create the item with navigation - this is the cleanest approach
                            // But for now, let's just trigger a refresh of this specific item
                            // by removing it and letting the virtual grid recreate it
                            const container = document.querySelector('.file-grid');
                            if (container && container.currentModels) {
                              // Update the model in the array
                              const modelIndex = container.currentModels.findIndex(m => 
                                normalizePathForComparison(m.filePath) === normalizedPath
                              );
                              if (modelIndex >= 0) {
                                container.currentModels[modelIndex] = updatedModel;
                                // Remove the item so it gets recreated
                                fileItem.remove();
                                // Trigger re-render
                                if (container.renderVisibleItemsFn) {
                                  setTimeout(() => {
                                    container.renderVisibleItemsFn();
                                  }, 100);
                                }
                              }
                            }
                          }
                        }
                      }
                      break;
                    }
                  }
                }
                break;
              }
            }
          }
        } catch (error) {
          console.error('Error adding multiple thumbnails:', error);
        }
        // Use first image for display
        const firstImage = images[0];
        const img = document.createElement('img');
        img.src = firstImage;
        img.style.width = '250px';
        img.style.height = '250px';
        container.innerHTML = '';
        container.appendChild(img);
        return firstImage;
      }
    } catch (imageError) {
      console.error('Error checking for embedded image:', imageError);
    }
  }

  let renderer, scene, camera, canvas;
  let model = null; // Declare model in outer scope

  try {
    canvas = document.createElement('canvas');
    canvas.width = 250;
    canvas.height = 250;
    
    renderer = new THREE.WebGLRenderer({
        antialias: false,
        alpha: true,
        canvas: canvas,
        powerPreference: 'low-power',
        precision: 'lowp',
        setPixelRatio: .2,
        setClearColor: 0x000000,
    });
    
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);

    renderer.setClearColor(0x000000, 0);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();
    scene.add(ambientLight);
    scene.add(directionalLight);

    // Use loadModel function which has proper path encoding handling and embedded image check
    // loadModel is available globally via window.loadModel
    const loadModelFunc = window.loadModel || loadModel;
    if (!loadModelFunc) {
      throw new Error('loadModel function is not available.');
    }
    model = await loadModelFunc(filePath);
    if (!model) {
      console.log(`[DEBUG] renderModelToPNG: loadModel returned null (likely embedded image found), skipping 3D render`);
      throw new Error('Failed to load model - embedded image should be used instead');
    }
    
    scene.add(model);
    fitCameraToObject(camera, model, scene, renderer);
    renderer.render(scene, camera);

    const imgData = canvas.toDataURL('image/png');

    const img = document.createElement('img');
    img.src = imgData;
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);

    return imgData;

  } catch (error) {
    console.error('Error rendering model:', error);
    const img = document.createElement('img');
    img.src = '3d.png';
    img.style.width = '250px';
    img.style.height = '250px';
    container.innerHTML = '';
    container.appendChild(img);
    return '3d.png';
  } finally {
    // Cleanup code that uses model
    if (model) {
      model.traverse(child => {
        if (child.geometry) {
          child.geometry.dispose();
          child.geometry = null;
        }
      });
      model = null;
    }
    // ... rest of cleanup code ...
  }
}



// Helper functions to manage selectedModels with normalized paths
function addToSelectedModels(filePath) {
  const normalized = normalizePathForComparison(filePath);
  // Find the original path format from selectedModels or DOM to maintain consistency
  let originalPath = filePath;
  for (const path of selectedModels) {
    if (normalizePathForComparison(path) === normalized) {
      originalPath = path; // Use existing format
      break;
    }
  }
  selectedModels.add(originalPath);
  return originalPath;
}

function removeFromSelectedModels(filePath) {
  const normalized = normalizePathForComparison(filePath);
  for (const path of selectedModels) {
    if (normalizePathForComparison(path) === normalized) {
      selectedModels.delete(path);
      return path;
    }
  }
  return null;
}

function isInSelectedModels(filePath) {
  const normalized = normalizePathForComparison(filePath);
  for (const path of selectedModels) {
    if (normalizePathForComparison(path) === normalized) {
      return true;
    }
  }
  return false;
}

// Sync DOM selection state with selectedModels
function syncDOMSelectionWithSelectedModels() {
  document.querySelectorAll('.file-item').forEach(item => {
    const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
    if (itemPath && isInSelectedModels(itemPath)) {
      item.classList.add('selected');
    } else {
      item.classList.remove('selected');
    }
  });
}

// Ensure all visually selected items are in selectedModels
function syncSelectedModelsWithDOM() {
  document.querySelectorAll('.file-item.selected').forEach(item => {
    const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
    if (itemPath && !isInSelectedModels(itemPath)) {
      addToSelectedModels(itemPath);
    }
  });
}

// Update the click handler for file items to use the new showMultiEditPanel function
async function handleFileClick(event, filePath) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const fileItem = event.currentTarget;
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    // Normalize the filePath for consistent comparison
    const normalizedFilePath = normalizePathForComparison(filePath);
    
    if (!isMultiSelectMode) {
      isMultiSelectMode = true;
      selectedModels.clear();
      
      // Update UI to reflect multi-select mode
      if (button) {
        button.textContent = 'Exit Multi-Edit Mode';
        button.classList.add('active');
      }
      if (multiEditPanel) {
        multiEditPanel.classList.remove('hidden');
      }
      if (detailsPanel) {
        detailsPanel.classList.add('hidden');
      }
      
      // Populate dropdowns for multi-edit
      try {
        await populateModelDesignerDropdown(null, 'multi-designer');
        await populateModelLicenseDropdown(null, 'multi-license');
        await populateParentModelDropdown(null, 'multi-parent');
        await populateTagSelect('multi-tag-select', 'multi-tags');
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      // Add the first clicked model to selection when entering multi-select mode
      const storedPath = addToSelectedModels(filePath);
      // Mark all DOM elements with matching normalized path as selected
      document.querySelectorAll('.file-item').forEach(item => {
        const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
        if (normalizePathForComparison(itemPath) === normalizedFilePath) {
          item.classList.add('selected');
        }
      });
    } else {
      // Toggle selection for subsequent clicks
      if (isInSelectedModels(filePath)) {
        removeFromSelectedModels(filePath);
        // Remove selection from all DOM elements with this filePath
        document.querySelectorAll('.file-item').forEach(item => {
          const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
          if (normalizePathForComparison(itemPath) === normalizedFilePath) {
            item.classList.remove('selected');
          }
        });
      } else {
        addToSelectedModels(filePath);
        // Add selection to all DOM elements with this filePath
        document.querySelectorAll('.file-item').forEach(item => {
          const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
          if (normalizePathForComparison(itemPath) === normalizedFilePath) {
            item.classList.add('selected');
          }
        });
      }
    }
    
    // Sync selectedModels with DOM to ensure consistency
    syncSelectedModelsWithDOM();
    
    // Update the selected count after any selection change
    updateSelectedCount();
    
    if (selectedModels.size > 0) {
      showMultiEditPanel();
      if (multiEditPanel) {
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } else {
      // Exiting multi-select mode - update UI
      isMultiSelectMode = false;
      if (multiEditPanel) {
        multiEditPanel.classList.add('hidden');
      }
      if (button) {
        button.textContent = 'Multi-Edit Mode';
        button.classList.remove('active');
      }
      if (detailsPanel && selectedModels.size === 0) {
        detailsPanel.classList.remove('hidden');
      }
      exitMultiEditMode();
    }
    updateSelectedCount();
  } else {
    // Single selection
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    selectedModels.add(filePath);
    isMultiSelectMode = false;
    
    // Update UI to reflect single-select mode
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    if (button) {
      button.textContent = 'Multi-Edit Mode';
      button.classList.remove('active');
    }
    if (multiEditPanel) {
      multiEditPanel.classList.add('hidden');
    }
    
    showModelDetails(filePath);
    updateSelectedCount();
  }
}

// Handle keyboard shortcuts
document.addEventListener('keydown', async (event) => {
  // Handle Escape key to exit multi-edit mode
  if (event.key === 'Escape' || event.key === 'Esc') {
    if (isMultiSelectMode) {
      event.preventDefault();
      exitMultiEditMode();
      return;
    }
  }
  
  // Check for Ctrl+A (Windows/Linux) or Cmd+A (Mac)
  if ((event.ctrlKey || event.metaKey) && (event.key === 'a' || event.key === 'A')) {
    // Don't intercept if user is typing in an input field, textarea, or contenteditable
    const activeElement = document.activeElement;
    const isInputField = activeElement && (
      activeElement.tagName === 'INPUT' ||
      activeElement.tagName === 'TEXTAREA' ||
      activeElement.isContentEditable
    );
    
    if (isInputField) {
      return; // Let default behavior work for text selection in input fields
    }
    
    event.preventDefault();
    
    // Clear existing selections first
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
    
    try {
      // Get all filtered model references (not just visible ones) - same as select-all-button
      const filteredModels = await window.getCombinedFilteredModels();
      
      // Add all filtered models to selection (ensuring no duplicates by file path)
      const uniqueFilePaths = new Set();
      filteredModels.forEach(model => {
        if (!uniqueFilePaths.has(model.filePath)) {
          uniqueFilePaths.add(model.filePath);
          addToSelectedModels(model.filePath);
        }
      });
      
      // Update UI for all items with matching file paths that are rendered
      // Use helper function to ensure normalized path comparison
      filteredModels.forEach(model => {
        if (isInSelectedModels(model.filePath)) {
          document.querySelectorAll('.file-item').forEach(item => {
            const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
            if (normalizePathForComparison(itemPath) === normalizePathForComparison(model.filePath)) {
              item.classList.add('selected');
            }
          });
        }
      });
      
      // Update the selected count
      updateSelectedCount();
      
      // Show multi-edit panel if there are selections
      if (selectedModels.size > 0) {
        showMultiEditPanel();
      }
    } catch (error) {
      console.error('Error selecting all models:', error);
    }
    
    // Activate multi-edit mode if not already active
    const button = document.getElementById('edit-mode-toggle');
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');
    
    if (!isMultiSelectMode && selectedModels.size > 0) {
      isMultiSelectMode = true;
      
      // Update UI to reflect multi-select mode
      if (button) {
        button.textContent = 'Exit Multi-Edit Mode';
        button.classList.add('active');
      }
      if (multiEditPanel) {
        multiEditPanel.classList.remove('hidden');
      }
      if (detailsPanel) {
        detailsPanel.classList.add('hidden');
      }
      
      // Populate dropdowns for multi-edit
      try {
        await populateModelDesignerDropdown(null, 'multi-designer');
        await populateModelLicenseDropdown(null, 'multi-license');
        await populateParentModelDropdown(null, 'multi-parent');
        await populateTagSelect('multi-tag-select', 'multi-tags');
        await populateRemoveTagSelect();
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      if (multiEditPanel) {
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }
});

// Update populateModelDesignerDropdown to handle multiple dropdowns
async function populateModelDesignerDropdown(selectedDesigner, elementId = 'model-designer') {
  const designerSelect = document.getElementById(elementId);
  if (!designerSelect) return;

  designerSelect.innerHTML = '<option value="">Select Designer</option>';

  try {
    const designers = await window.electron.getDesigners();
    designers.forEach(designer => {
      if (designer) { // Only add non-empty designers
        const option = document.createElement('option');
        option.value = designer;
        option.textContent = designer;
        if (designer === selectedDesigner) {
          option.selected = true;
        }
        designerSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching designers:', error);
  }
}

// Update the change event listener
document.getElementById('model-designer').addEventListener('change', async (event) => {
  const designerSelect = event.target;
  const newDesigner = designerSelect.value;
  
  if (newDesigner && newDesigner !== 'Unknown') {
    const designers = await window.electron.getDesigners();
    if (!designers.includes(newDesigner)) {
      console.log('New designer will be added:', newDesigner);
    }
  }
});

async function populateDesignerDropdown() {
  const designerSelect = document.getElementById('designer-select');
  designerSelect.innerHTML = '<option value="">All Designers</option>';
  // Add an option to filter for models with no designer set
  designerSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const designers = await window.electron.getDesigners();
    designers.forEach(designer => {
      const option = document.createElement('option');
      option.value = designer;
      option.textContent = designer;
      designerSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching designers:', error);
  }
}

// Add these event listeners after your existing ones
document.getElementById('add-new-designer-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-designer-dialog');
  dialog.showModal();
});

document.getElementById('cancel-designer-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-designer-dialog');
  dialog.close();
});

document.getElementById('new-designer-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newDesignerName = document.getElementById('new-designer-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown;
  
  if (newDesignerName) {
    // Trigger auto-save first (before repopulating dropdowns)
    if (sourceDropdownId === 'multi-designer') {
      await autoSaveMultipleModels('designer', newDesignerName);
    } else if (sourceDropdownId === 'designer-select') {
      // For filter dropdown, we need to save to a model first
      const filePath = getCurrentModelFilePath();
      if (filePath) {
        await autoSaveModel('designer', newDesignerName, filePath);
      }
    } else {
      const filePath = getCurrentModelFilePath();
      await autoSaveModel('designer', newDesignerName, filePath);
    }
    
    // Clear the input and close the dialog immediately
    document.getElementById('new-designer-name').value = '';
    document.getElementById('new-designer-dialog').close();
    
    // Update all designer dropdowns - both filter and model dropdowns
    // This repopulates from the database, avoiding duplicates
    await populateDesignerDropdown(); // Filter dropdown on left side
    // Preserve the selection for the dropdown that was just updated
    await populateModelDesignerDropdown(
      sourceDropdownId === 'multi-designer' ? newDesignerName : null, 
      'multi-designer'
    ); // Multi-edit dropdown
    await populateModelDesignerDropdown(
      sourceDropdownId === 'model-designer' ? newDesignerName : null, 
      'model-designer'
    ); // Single-edit dropdown
    
    // Set the value on the source dropdown after repopulation
    if (sourceDropdownId === 'designer-select') {
      const designerSelect = document.getElementById('designer-select');
      if (designerSelect) {
        designerSelect.value = newDesignerName;
      }
    }
  }
});

// Keep the clear parent button event listener
document.getElementById('clear-parent-button')?.addEventListener('click', () => {
  document.getElementById('model-parent').value = '';
});


// Add event listeners for parent model dialog
document.getElementById('add-new-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  dialog.showModal();
});

document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  dialog.close();
});

// Duplicate event listener removed - handled in DOMContentLoaded above

// Update the parent model button click handler to match designer exactly
document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
  button?.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    const input = document.getElementById('new-parent-name');
    
    // Reset form and input state exactly like designer
    dialog.querySelector('form').reset();
    input.value = '';
    input.disabled = false;
    input.readOnly = false;
    
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-parent';
    
    // Show dialog and force refresh exactly like designer
    dialog.showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.click();
    });
  });
});

// Add back the cancel button handler
document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  const input = document.getElementById('new-parent-name');
  input.value = '';
  dialog.close();
});



// Add these new functions
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const context = this; // Store the context
    const later = () => {
      timeout = null; // Clear timeout identifier
      func.apply(context, args); // Call the original function with correct context and args
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}


// Replace the existing tag handling functions with these
async function initializeTags() {
  const tagSelect = document.getElementById('tag-select');
  const multiTagSelect = document.getElementById('multi-tag-select');

  // Handle selecting a tag from the single edit dropdown
  tagSelect.addEventListener('change', () => {
    const selectedTag = tagSelect.value;
    if (selectedTag) {
      addTagToModel(selectedTag, 'model-tags');
      tagSelect.value = ''; // Reset selection
    }
  });

  // Handle selecting a tag from the multi edit dropdown
  multiTagSelect.addEventListener('change', () => {
    const selectedTag = multiTagSelect.value;
    if (selectedTag) {
      addTagToModel(selectedTag, 'multi-tags');
      multiTagSelect.value = ''; // Reset selection
    }
  });

  // Initial population of tag dropdowns
  await populateTagSelect('tag-select', 'model-tags');
  await populateTagSelect('multi-tag-select', 'multi-tags');
}

async function populateTagSelect(selectId = 'tag-select', containerId = 'model-tags') {
  const tagSelect = document.getElementById(selectId);
  const currentTags = Array.from(document.querySelectorAll(`#${containerId} .tag`))
    .map(tag => tag.getAttribute('data-tag-name'));
  
  tagSelect.innerHTML = '<option value="">Select a tag...</option>';

  try {
    const tags = await window.electron.getAllTags();
    tags.sort((a, b) => a.name.localeCompare(b.name)); // Sort tags alphabetically
    tags.forEach(tag => {
      // Only add tags that aren't already selected
      if (!currentTags.includes(tag.name)) {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = tag.name;
        tagSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching tags:', error);
  }
}

// Refresh the tags displayed in the multi-tags container
async function refreshMultiEditTags() {
  const multiTagsContainer = document.getElementById('multi-tags');
  if (!multiTagsContainer) {
    return;
  }

  // Clear existing tags
  multiTagsContainer.innerHTML = '';

  // Check if any models are selected
  if (selectedModels.size === 0) {
    return;
  }

  try {
    // Get all selected file paths
    const filePaths = Array.from(selectedModels);
    
    // Load tags for each model in parallel
    const tagPromises = filePaths.map(async (filePath) => {
      try {
        const model = await window.electron.getModel(filePath);
        return model && model.tags ? (Array.isArray(model.tags) ? model.tags : []) : [];
      } catch (error) {
        console.error(`Error loading tags for ${filePath}:`, error);
        return [];
      }
    });

    const allTagsArrays = await Promise.all(tagPromises);
    
    // Collect unique tags across all selected files
    const uniqueTags = new Set();
    allTagsArrays.forEach(tags => {
      if (Array.isArray(tags)) {
        tags.forEach(tag => {
          if (tag && typeof tag === 'string') {
            const normalizedTag = tag.trim();
            if (normalizedTag) {
              uniqueTags.add(normalizedTag);
            }
          }
        });
      }
    });

    // Sort tags alphabetically
    const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));

    // Display tags in the container with remove functionality
    sortedTags.forEach(tagName => {
      // Check if tag already exists visually
      const existingTag = Array.from(multiTagsContainer.children)
        .find(tag => tag.getAttribute('data-tag-name') === tagName);
      
      if (!existingTag) {
        // Create tag element with remove functionality
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.setAttribute('data-tag-name', tagName);
        tag.setAttribute('title', tagName);
        tag.innerHTML = `
          <span class="tag-text">${tagName}</span>
          <span class="tag-remove">×</span>
        `;
        
        // Add remove handler with auto-save
        tag.querySelector('.tag-remove')?.addEventListener('click', async () => {
          tag.remove();
          // Auto-save the updated tags after REMOVAL
          const currentTags = Array.from(multiTagsContainer.querySelectorAll('.tag'))
            .map(t => t.getAttribute('data-tag-name'));
          
          // Use replaceTags: true to replace tags instead of merging
          await autoSaveMultipleModels('tags', currentTags, { replaceTags: true });
          
          // Refresh the remove tag dropdown after removal
          await populateRemoveTagSelect();
        });
        
        multiTagsContainer.appendChild(tag);
      }
    });
  } catch (error) {
    console.error('Error refreshing multi-edit tags:', error);
  }
}

// Populate the remove tag dropdown with tags from selected files
async function populateRemoveTagSelect() {
  const removeTagSelect = document.getElementById('multi-tag-remove-select');
  if (!removeTagSelect) {
    console.error('multi-tag-remove-select element not found');
    return;
  }

  // Clear existing options except the default
  removeTagSelect.innerHTML = '<option value="">Select a tag to remove...</option>';

  // Check if any models are selected
  if (selectedModels.size === 0) {
    const noTagsOption = document.createElement('option');
    noTagsOption.value = '';
    noTagsOption.textContent = 'No files selected';
    noTagsOption.disabled = true;
    removeTagSelect.appendChild(noTagsOption);
    return;
  }

  try {
    // Get all selected file paths
    const filePaths = Array.from(selectedModels);
    
    // Load tags for each model in parallel
    const tagPromises = filePaths.map(async (filePath) => {
      try {
        const model = await window.electron.getModel(filePath);
        return model && model.tags ? (Array.isArray(model.tags) ? model.tags : []) : [];
      } catch (error) {
        console.error(`Error loading tags for ${filePath}:`, error);
        return [];
      }
    });

    const allTagsArrays = await Promise.all(tagPromises);
    
    // Collect unique tags across all selected files
    // Use Set to automatically ensure uniqueness
    const uniqueTags = new Set();
    allTagsArrays.forEach(tags => {
      if (Array.isArray(tags)) {
        // First deduplicate tags within each model (in case a model has duplicate tags)
        const modelUniqueTags = new Set();
        tags.forEach(tag => {
          // Normalize tag: trim whitespace and ensure it's a non-empty string
          if (tag && typeof tag === 'string') {
            const normalizedTag = tag.trim();
            if (normalizedTag) {
              modelUniqueTags.add(normalizedTag);
            }
          }
        });
        // Add all unique tags from this model to the overall set
        modelUniqueTags.forEach(tag => uniqueTags.add(tag));
      }
    });

    // Convert Set to array and sort alphabetically
    // Set already ensures uniqueness, so no need for additional deduplication
    const sortedTags = Array.from(uniqueTags).sort((a, b) => a.localeCompare(b));
    
    // Double-check for duplicates (defensive programming)
    const finalUniqueTags = [];
    const seenTags = new Set();
    sortedTags.forEach(tag => {
      if (!seenTags.has(tag)) {
        seenTags.add(tag);
        finalUniqueTags.push(tag);
      }
    });

    // Populate dropdown
    if (finalUniqueTags.length === 0) {
      const noTagsOption = document.createElement('option');
      noTagsOption.value = '';
      noTagsOption.textContent = 'No tags to remove';
      noTagsOption.disabled = true;
      removeTagSelect.appendChild(noTagsOption);
    } else {
      finalUniqueTags.forEach(tagName => {
        // Additional check to prevent duplicate options in the DOM
        const existingOption = Array.from(removeTagSelect.options).find(opt => opt.value === tagName);
        if (!existingOption) {
          const option = document.createElement('option');
          option.value = tagName;
          option.textContent = tagName;
          removeTagSelect.appendChild(option);
        }
      });
    }
  } catch (error) {
    console.error('Error populating remove tag select:', error);
    const errorOption = document.createElement('option');
    errorOption.value = '';
    errorOption.textContent = 'Error loading tags';
    errorOption.disabled = true;
    removeTagSelect.appendChild(errorOption);
  }
}

// Update the addTagToModel function
async function addTagToModel(tagName, containerId) {
  const tagContainer = document.getElementById(containerId);
  if (!tagContainer) {
    console.error(`Tag container with ID ${containerId} not found`);
    return;
  }
  
  // Check if tag already exists visually
  const existingTag = Array.from(tagContainer.children)
    .find(tag => tag.getAttribute('data-tag-name') === tagName);
  
  if (existingTag) return; // Don't add visual duplicates

  // Create new tag element
  const tag = document.createElement('div');
  tag.className = 'tag';
  tag.setAttribute('data-tag-name', tagName);
  tag.setAttribute('title', tagName); // Show full tag name on hover
  tag.innerHTML = `
    <span class="tag-text">${tagName}</span>
    <span class=\"tag-remove\">×</span>
  `;

  // Add remove handler with auto-save
  tag.querySelector('.tag-remove')?.addEventListener('click', async () => {
    tag.remove(); 
    // Auto-save the updated tags after REMOVAL
    const currentTags = Array.from(tagContainer.querySelectorAll('.tag'))
      .map(t => t.getAttribute('data-tag-name'));
    
    if (containerId === 'multi-tags') {
      // When removing, we DO want to save the resulting list for all selected models
      // Note: This sets all selected models to have exactly the tags remaining in the UI.
      // Use replaceTags: true to replace tags instead of merging
      await autoSaveMultipleModels('tags', currentTags, { replaceTags: true }); 
    } else {
      // Single edit mode save
      const filePath = getModelFilePath();
      if (filePath) {
        await autoSaveModel('tags', currentTags, filePath);
      } else {
        console.error('No file path found for saving tags');
      }
    }
  });

  tagContainer.appendChild(tag); // Add tag visually

  // Auto-save logic after ADDING a tag
  if (containerId === 'multi-tags') {
    // For multi-edit ADD, only save the *newly added tag* to append it
    console.log(`Multi-edit: Appending tag '${tagName}' to selected models.`);
    await autoSaveMultipleModels('tags', [tagName]); // Pass only the new tag
  } else {
    // For single-edit ADD, save the full list for that model
    const currentTags = Array.from(tagContainer.querySelectorAll('.tag'))
      .map(t => t.getAttribute('data-tag-name'));
    const filePath = getModelFilePath();
    if (filePath) {
      await autoSaveModel('tags', currentTags, filePath);
    } else {
      console.error('No file path found for saving tags');
    }
  }
}

// Update the multi-tag-select change handler
document.getElementById('multi-tag-select').addEventListener('change', async () => {
  const tagSelect = document.getElementById('multi-tag-select');
  const selectedTag = tagSelect.value;
  if (selectedTag) {
    // Use the same addTagToModel function as single mode
    addTagToModel(selectedTag, 'multi-tags');
    document.getElementById('multi-tag-select').value = ''; // Reset selection
  }
});

async function loadModelTags(modelIdOrPath) {
  const tagsContainer = document.getElementById('model-tags');
  if (!tagsContainer) {
    console.error('Model tags container not found');
    return;
  }
  
  tagsContainer.innerHTML = '';
  
  try {
    // Get the model to retrieve its ID (modelIdOrPath can be filePath or model ID)
    const model = await window.electron.getModel(modelIdOrPath);
    if (!model || !model.id) {
      console.warn('Model not found or missing ID:', modelIdOrPath);
      return;
    }
    
    // Fetch fresh tags directly from the database using getModelTags
    // This ensures we get the latest tags even if the model object is cached
    const tags = await window.electron.getModelTags(model.id);
    
    if (tags && Array.isArray(tags) && tags.length > 0) {
      // Extract tag names (tags might be objects with .name property or just strings)
      const tagNames = tags.map(tag => typeof tag === 'string' ? tag : (tag.name || tag));
      tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      tagNames.forEach(tagName => addTagToModel(tagName, 'model-tags'));
    }
  } catch (error) {
    console.error('Error loading model tags:', error);
  }
}

// Add this function to populate the tag filter dropdown
async function populateTagFilter() {
  const tagSelect = document.getElementById('tag-filter'); // Changed from 'tag-filter-select'
  if (!tagSelect) {
    console.error('Tag filter select element not found');
    return;
  }

  tagSelect.innerHTML = '<option value="">All Tags</option>';

  try {
    const tags = await window.electron.getAllTags();
    tags.sort((a, b) => a.name.localeCompare(b.name)); // Sort tags alphabetically
    tags.forEach(tag => {
      const option = document.createElement('option');
      option.value = tag.name;
      option.textContent = `${tag.name} (${tag.model_count})`;
      tagSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error populating tag filter:', error);
  }
}

// Add bulk edit button to the main content area
const bulkEditButton = document.createElement('button');
bulkEditButton.id = 'bulk-edit-button';
bulkEditButton.className = 'bulk-edit-button';
bulkEditButton.textContent = 'Edit Selected Models';
document.querySelector('.main-content').appendChild(bulkEditButton);

// Add bulk edit functionality
bulkEditButton.addEventListener('click', () => {
  const dialog = document.getElementById('bulk-edit-dialog');
  
  // Populate dropdowns
  populateModelDesignerDropdown();
  populateParentModelDropdown();
  
  dialog.showModal();
});

// Handle bulk edit save
document.getElementById('bulk-edit-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  
  const updates = {
    designer: document.getElementById('bulk-designer').value,
    parentModel: document.getElementById('bulk-parent').value,
    source: document.getElementById('bulk-source').value,
    printed: document.getElementById('bulk-printed').value
  };

  try {
    for (const filePath of selectedModels) {
      const model = await window.electron.getModel(filePath);
      const updatedModel = {
        ...model,
        designer: updates.designer || model.designer,
        parentModel: updates.parentModel === 'none' ? '' : (updates.parentModel || model.parentModel),
        source: updates.source || model.source,
        printed: updates.printed ? (updates.printed === 'true') : model.printed
      };
      await window.electron.saveModel(updatedModel);
    }

    // Refresh the view
    const models = await window.electron.getAllModels();
    await renderFiles(models);
    
    // Clear selection
    selectedModels.clear();
    document.getElementById('bulk-edit-button').classList.remove('visible');
    
    await window.electron.showMessage('Success', 'Changes saved successfully!');
  } catch (error) {
    console.error('Error saving bulk changes:', error);
    await window.electron.showMessage('Error', 'Error saving changes');
  }
  
  document.getElementById('bulk-edit-dialog').close();
});

// Handle bulk edit cancel
document.getElementById('bulk-cancel-button')?.addEventListener('click', () => {
  document.getElementById('bulk-edit-dialog').close();
});

// Update the add button event listeners to handle both panels
document.querySelectorAll('.add-designer-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-designer-dialog');
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
    dialog.showModal();
  });
});

document.querySelectorAll('.add-parent-button').forEach(button => {
  button.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container').querySelector('select').id;
    dialog.showModal();
  });
});

document.querySelectorAll('.add-tag-button').forEach(button => {
  button.addEventListener('click', async () => {
    // Get the container ID for the tags container - we'll need this to know where to add the tag
    const sourceContainer = button.closest('.tags-container').querySelector('.tags-list').id;
    
    // Use the HTML dialog instead of Electron's dialog
    const tagDialog = document.getElementById('new-tag-dialog');
    const newTagInput = document.getElementById('new-tag-name');
    
    // Clear any previous input
    if (newTagInput) {
      newTagInput.value = '';
    }
    
    // Store the source container ID on the dialog for reference when submitting
    tagDialog.setAttribute('data-source-container', sourceContainer);
    
    // Show the dialog
    tagDialog.showModal();
  });
});

// Update the dialog submit handlers to use the stored dropdown IDs
// Duplicate event listener removed - handled at line 9210

// Duplicate event listener removed - handled in DOMContentLoaded above

// Parent Model Button Click Handler
document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
  button?.addEventListener('click', () => {
    const dialog = document.getElementById('new-parent-dialog');
    const input = document.getElementById('new-parent-name');
    
    // Reset form and input state
    dialog.querySelector('form').reset();
    input.value = '';
    input.disabled = false;
    input.readOnly = false;
    
    // Store which dropdown triggered the dialog
    dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-parent';
    
    // Show dialog and force refresh exactly like designer
    dialog.showModal();
    requestAnimationFrame(() => {
      input.focus();
      input.click();
    });
  });
});

// Cancel Button Handler
document.getElementById('cancel-parent-button')?.addEventListener('click', () => {
  const dialog = document.getElementById('new-parent-dialog');
  const input = document.getElementById('new-parent-name');
  input.value = '';
  dialog.close();
});



// Add change event listeners for auto-save
document.getElementById('model-parent').addEventListener('change', async (e) => {
  const filePath = getCurrentModelFilePath();
  await autoSaveModel('parentModel', e.target.value, filePath);
});

document.getElementById('multi-parent').addEventListener('change', async (e) => {
  await autoSaveMultipleModels('parentModel', e.target.value);
});

// Update tag handling for multi-edit panel
document.getElementById('multi-tag-select').addEventListener('change', async () => {
  const selectedTag = document.getElementById('multi-tag-select').value;
  if (selectedTag) {
    // Use the same addTagToModel function as single mode
    addTagToModel(selectedTag, 'multi-tags');
    document.getElementById('multi-tag-select').value = ''; // Reset selection
  }
});

// Handle remove tag dropdown change event
async function handleRemoveTagSelect() {
  const removeTagSelect = document.getElementById('multi-tag-remove-select');
  if (!removeTagSelect) {
    return;
  }

  const tagToRemove = removeTagSelect.value;
  if (!tagToRemove) {
    return;
  }

  try {
    // Get all selected file paths
    const filePaths = Array.from(selectedModels);
    
    if (filePaths.length === 0) {
      console.warn('No models selected for tag removal');
      return;
    }

    // Show confirmation dialog
    const confirmResult = await window.electron.showMessageBox({
      type: 'warning',
      title: 'Remove Tag',
      message: `Are you sure you want to remove the tag "${tagToRemove}" from ${filePaths.length} selected file${filePaths.length === 1 ? '' : 's'}?`,
      buttons: ['Yes', 'No'],
      defaultId: 1,
      cancelId: 1
    });

    // If user clicked "No" (response === 1) or cancelled, reset dropdown and return
    if (confirmResult.response !== 0) {
      removeTagSelect.value = '';
      return;
    }

    // Load all models and remove the tag from each
    const modelUpdates = [];
    for (const filePath of filePaths) {
      try {
        const model = await window.electron.getModel(filePath);
        if (model && model.tags) {
          const tags = Array.isArray(model.tags) ? model.tags : [];
          // Remove the tag from the array
          const updatedTags = tags.filter(tag => tag !== tagToRemove);
          model.tags = updatedTags.sort();
          modelUpdates.push({ filePath, model });
        }
      } catch (error) {
        console.error(`Error loading model ${filePath} for tag removal:`, error);
      }
    }

    // Save all updated models using autoSaveMultipleModels with replaceTags
    if (modelUpdates.length > 0) {
      // For each model, we need to save with its updated tags
      // We'll use the batch update approach
      const modelDataBatch = modelUpdates.map(({ model }) => model);
      try {
        await window.electron.updateModelsBatch(modelDataBatch);
        console.log(`Successfully removed tag '${tagToRemove}' from ${modelUpdates.length} models`);
      } catch (error) {
        console.error('Error in batch update for tag removal:', error);
        // Fallback to individual saves
        for (const { model } of modelUpdates) {
          await window.electron.saveModel(model).catch(err => {
            console.error(`Error saving model ${model.filePath}:`, err);
          });
        }
      }

      // Update UI elements
      for (const { filePath } of modelUpdates) {
        await updateModelElement(filePath);
      }
    }

    // Reset dropdown and refresh the remove tag list
    removeTagSelect.value = '';
    await populateRemoveTagSelect();
    
    // Refresh the add tag dropdown to reflect any changes
    await populateTagSelect('multi-tag-select', 'multi-tags');
  } catch (error) {
    console.error('Error removing tag:', error);
  }
}

async function parseSourceUrl(url) {
  try {
    if (!url.includes('thangs.com')) return null;

    // Fetch the page content
    const pageData = await window.electron.fetchThangsPage(url);
    if (!pageData) return null;

    const { modelTitle, designerName } = pageData;

    console.log('Parsed page data:', { modelTitle, designerName });
    return {
      designer: designerName || null,
      parentModel: modelTitle || null
    };
  } catch (error) {
    console.error('Error parsing source URL:', error);
    return null;
  }
}

// Fix syntax error in formatFileSize function
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper function to create SVG icon element
function createSVGIcon(svgString, size = 16) {
  const iconContainer = document.createElement('div');
  iconContainer.style.display = 'inline-flex';
  iconContainer.style.alignItems = 'center';
  iconContainer.style.justifyContent = 'center';
  iconContainer.style.width = `${size}px`;
  iconContainer.style.height = `${size}px`;
  iconContainer.style.flexShrink = '0';
  iconContainer.style.marginRight = '6px';
  iconContainer.innerHTML = svgString;
  return iconContainer;
}

// Function to create list view header
function createListViewHeader() {
  const header = document.createElement('div');
  header.className = 'list-view-header';
  header.style.display = 'flex';
  header.style.flexDirection = 'row';
  header.style.alignItems = 'center';
  header.style.gap = '12px';
  header.style.padding = '8px 12px';
  header.style.height = '36px';
  header.style.borderBottom = '2px solid rgba(255, 255, 255, 0.1)';
  header.style.backgroundColor = 'rgba(0, 0, 0, 0.2)';
  header.style.position = 'sticky';
  header.style.top = '0';
  header.style.zIndex = '10';
  header.style.marginBottom = '4px';
  
  // Thumbnail column header (spacer for alignment)
  const thumbnailHeader = document.createElement('div');
  thumbnailHeader.style.flexShrink = '0';
  thumbnailHeader.style.width = '48px';
  thumbnailHeader.style.height = '20px';
  header.appendChild(thumbnailHeader);
  
  // File info container (matches fileInfo structure)
  const headerInfo = document.createElement('div');
  headerInfo.style.flex = '1';
  headerInfo.style.display = 'flex';
  headerInfo.style.flexDirection = 'row';
  headerInfo.style.alignItems = 'center';
  headerInfo.style.gap = '15px';
  headerInfo.style.minWidth = '0';
  
  // Name column header
  const nameHeader = document.createElement('div');
  nameHeader.textContent = 'Name';
  nameHeader.style.flexShrink = '0';
  nameHeader.style.width = '180px';
  nameHeader.style.fontSize = '12px';
  nameHeader.style.fontWeight = '600';
  nameHeader.style.color = '#aaa';
  nameHeader.style.textTransform = 'uppercase';
  nameHeader.style.letterSpacing = '0.5px';
  headerInfo.appendChild(nameHeader);
  
  // Size column header
  const sizeHeader = document.createElement('div');
  sizeHeader.textContent = 'Size';
  sizeHeader.style.flexShrink = '0';
  sizeHeader.style.width = '90px';
  sizeHeader.style.fontSize = '12px';
  sizeHeader.style.fontWeight = '600';
  sizeHeader.style.color = '#aaa';
  sizeHeader.style.textTransform = 'uppercase';
  sizeHeader.style.letterSpacing = '0.5px';
  sizeHeader.style.textAlign = 'center';
  headerInfo.appendChild(sizeHeader);
  
  // Parent Directory column header (with icon)
  const directoryHeader = document.createElement('div');
  directoryHeader.style.display = 'flex';
  directoryHeader.style.alignItems = 'center';
  directoryHeader.style.flexShrink = '0';
  directoryHeader.style.width = '180px';
  const folderIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#aaa"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>', 16);
  directoryHeader.appendChild(folderIcon);
  const directoryText = document.createElement('span');
  directoryText.textContent = 'Parent Directory';
  directoryText.style.fontSize = '12px';
  directoryText.style.fontWeight = '600';
  directoryText.style.color = '#aaa';
  directoryText.style.textTransform = 'uppercase';
  directoryText.style.letterSpacing = '0.5px';
  directoryText.style.flex = '1';
  directoryText.style.minWidth = '0';
  directoryText.style.overflow = 'hidden';
  directoryText.style.textOverflow = 'ellipsis';
  directoryText.style.whiteSpace = 'nowrap';
  directoryHeader.appendChild(directoryText);
  headerInfo.appendChild(directoryHeader);
  
  // Designer column header (with icon)
  const designerHeader = document.createElement('div');
  designerHeader.style.display = 'flex';
  designerHeader.style.alignItems = 'center';
  designerHeader.style.flexShrink = '0';
  designerHeader.style.width = '180px';
  const designerIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#a855f7"><path d="m352-522 86-87-56-57-44 44-56-56 43-44-45-45-87 87 159 158Zm328 329 87-87-45-45-44 43-56-56 43-44-57-56-86 86 158 159Zm24-567 57 57-57-57ZM290-120H120v-170l175-175L80-680l200-200 216 216 151-152q12-12 27-18t31-6q16 0 31 6t27 18l53 54q12 12 18 27t6 31q0 16-6 30.5T816-647L665-495l215 215L680-80 465-295 290-120Zm-90-80h56l392-391-57-57-391 392v56Zm420-419-29-29 57 57-28-28Z"/></svg>', 16);
  designerHeader.appendChild(designerIcon);
  const designerText = document.createElement('span');
  designerText.textContent = 'Designer';
  designerText.style.fontSize = '12px';
  designerText.style.fontWeight = '600';
  designerText.style.color = '#aaa';
  designerText.style.textTransform = 'uppercase';
  designerText.style.letterSpacing = '0.5px';
  designerText.style.flex = '1';
  designerText.style.minWidth = '0';
  designerText.style.overflow = 'hidden';
  designerText.style.textOverflow = 'ellipsis';
  designerText.style.whiteSpace = 'nowrap';
  designerHeader.appendChild(designerText);
  headerInfo.appendChild(designerHeader);
  
  // Printed column header
  const printedHeader = document.createElement('div');
  printedHeader.textContent = 'Printed';
  printedHeader.style.flexShrink = '0';
  printedHeader.style.width = '120px';
  printedHeader.style.fontSize = '12px';
  printedHeader.style.fontWeight = '600';
  printedHeader.style.color = '#aaa';
  printedHeader.style.textTransform = 'uppercase';
  printedHeader.style.letterSpacing = '0.5px';
  printedHeader.style.textAlign = 'center';
  headerInfo.appendChild(printedHeader);
  
  // Tags column header (with icon)
  const tagsHeader = document.createElement('div');
  tagsHeader.style.display = 'flex';
  tagsHeader.style.alignItems = 'center';
  tagsHeader.style.flexShrink = '0';
  tagsHeader.style.width = '200px';
  const tagsIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#aaa"><path d="M240-120q-33 0-56.5-23.5T160-200v-480q0-33 23.5-56.5T240-760h120l80 80h320q33 0 56.5 23.5T820-600v400q0 33-23.5 56.5T740-120H240Zm0-80h500v-400H447l-80-80H240v480Zm0 0v-480 480Zm280-240q17 0 28.5-11.5T560-480q0-17-11.5-28.5T520-520q-17 0-28.5 11.5T480-480q0 17 11.5 28.5T520-440Zm-160 0q17 0 28.5-11.5T400-480q0-17-11.5-28.5T360-520q-17 0-28.5 11.5T320-480q0 17 11.5 28.5T360-440Zm320 0q17 0 28.5-11.5T720-480q0-17-11.5-28.5T680-520q-17 0-28.5 11.5T640-480q0 17 11.5 28.5T680-440ZM520-280q17 0 28.5-11.5T560-320q0-17-11.5-28.5T520-360q-17 0-28.5 11.5T480-320q0 17 11.5 28.5T520-280Zm-160 0q17 0 28.5-11.5T400-320q0-17-11.5-28.5T360-360q-17 0-28.5 11.5T320-320q0 17 11.5 28.5T360-280Zm320 0q17 0 28.5-11.5T720-320q0-17-11.5-28.5T680-360q-17 0-28.5 11.5T640-320q0 17 11.5 28.5T680-280Z"/></svg>', 16);
  tagsHeader.appendChild(tagsIcon);
  const tagsText = document.createElement('span');
  tagsText.textContent = 'Tags';
  tagsText.style.fontSize = '12px';
  tagsText.style.fontWeight = '600';
  tagsText.style.color = '#aaa';
  tagsText.style.textTransform = 'uppercase';
  tagsText.style.letterSpacing = '0.5px';
  tagsText.style.marginLeft = '6px';
  tagsHeader.appendChild(tagsText);
  headerInfo.appendChild(tagsHeader);
  
  // Archive column header (with icon)
  const archiveHeader = document.createElement('div');
  archiveHeader.style.display = 'flex';
  archiveHeader.style.alignItems = 'center';
  archiveHeader.style.justifyContent = 'center';
  archiveHeader.style.flexShrink = '0';
  archiveHeader.style.width = '120px';
  const archiveIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#aaa"><path d="M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"/></svg>', 16);
  archiveHeader.appendChild(archiveIcon);
  const archiveText = document.createElement('span');
  archiveText.textContent = 'Archive';
  archiveText.style.fontSize = '12px';
  archiveText.style.fontWeight = '600';
  archiveText.style.color = '#aaa';
  archiveText.style.textTransform = 'uppercase';
  archiveText.style.letterSpacing = '0.5px';
  archiveText.style.marginLeft = '6px';
  archiveHeader.appendChild(archiveText);
  headerInfo.appendChild(archiveHeader);
  
  header.appendChild(headerInfo);
  return header;
}


// Update the tag filter to support multiple tags
function updateTagFilter() {
  const selectedTags = Array.from(document.querySelectorAll('#tag-filter .tag'))
    .map(tag => tag.getAttribute('data-tag-name'));
  
  if (selectedTags.length === 0) {
    // If no tags selected, show all models
    window.electron.getAllModels().then(displayModels);
    return;
  }

  // Filter models that have ALL selected tags
  window.electron.getAllModels().then(async models => {
    const filteredModels = [];
    
    for (const model of models) {
      const modelTags = await window.electron['get-model-tags'](model.id);
      const modelTagNames = modelTags.map(tag => tag.name);
      
      // Check if model has all selected tags
      if (selectedTags.every(tag => modelTagNames.includes(tag))) {
        filteredModels.push(model);
      }
    }
    
    await displayModels(filteredModels);
  });
}

// Add tag filter functionality
document.getElementById('tag-filter-select')?.addEventListener('change', async (event) => {
  const selectedTag = event.target.value;
  debugLog('Tag filter selected:', selectedTag);
  
  if (!selectedTag) {
    // If no tag selected, show all models
    const models = await window.electron.getAllModels();
    return;
  }

  try {
    // Get all models first
    const allModels = await window.electron.getAllModels();
    debugLog('Total models before filtering:', allModels.length);

    // Filter models that have the selected tag
    const filteredModels = [];
    for (const model of allModels) {
      const modelTags = await window.electron.getModelTags(model.id);
      if (modelTags && modelTags.some(tag => tag.name === selectedTag)) {
        filteredModels.push(model);
      }
    }

    debugLog('Filtered models by tag:', filteredModels.length);
  } catch (error) {
    console.error('Error filtering by tag:', error);
  }
});

// Add license filter population with null checks
async function populateLicenseFilter() {
  const licenseSelect = document.getElementById('license-select');
  licenseSelect.innerHTML = '<option value="">All Licenses</option>';
  // Add an option to filter for models with no license set
  licenseSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const rows = await window.electron.getLicenses();
    rows.forEach(license => {
      const option = document.createElement('option');
      option.value = license;
      option.textContent = license;
      licenseSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching licenses:', error);
  }
}

async function showDuplicateFiles(duplicates) {
  console.log('Showing duplicate files:', duplicates);
  const duplicateGroups = document.querySelector('.duplicate-groups');
  duplicateGroups.innerHTML = '';

  // Check if there are any duplicates
  if (Object.keys(duplicates).length === 0) {
    // Create and show "no duplicates" message
    const messageDiv = document.createElement('div');
    messageDiv.style.textAlign = 'center';
    messageDiv.style.padding = '20px';
    messageDiv.style.color = '#888';
    messageDiv.textContent = 'No duplicate models found';
    duplicateGroups.appendChild(messageDiv);

    // Hide the delete button since there's nothing to delete
    const deleteButton = document.querySelector('.dialog-buttons #delete-selected');
    if (deleteButton) {
      deleteButton.style.display = 'none';
    }
    return;
  }

  // Show delete button if it was previously hidden
  const deleteButton = document.querySelector('.dialog-buttons #delete-selected');
  if (deleteButton) {
    deleteButton.style.display = '';
  }

  // Rest of the existing code for showing duplicates
  for (const [hash, files] of Object.entries(duplicates)) {
    const group = document.createElement('div');
    group.className = 'duplicate-group';
    
    // Add preview container
    const preview = document.createElement('div');
    preview.className = 'duplicate-preview';
    
    // Try to render the first file's thumbnail
    try {
      const thumbnail = await renderModelToPNG(files[0].filePath, preview);
      if (thumbnail) {
        const img = document.createElement('img');
        img.src = thumbnail;
        preview.innerHTML = '';
        preview.appendChild(img);
      }
    } catch (error) {
      console.error('Error rendering preview:', error);
      preview.innerHTML = '<div class="error-message">Error loading preview</div>';
    }
    
    const filesList = document.createElement('div');
    filesList.className = 'duplicate-files';
    
    const header = document.createElement('div');
    header.className = 'duplicate-group-header';
    header.innerHTML = `<span class="duplicate-count">${files.length} duplicates found</span>`;
    filesList.appendChild(header);
    
    files.forEach((file) => {
      const fileDiv = document.createElement('div');
      fileDiv.className = 'duplicate-file';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('data-filepath', file.filePath);
      
      const filePath = document.createElement('span');
      filePath.className = 'duplicate-file-path';
      filePath.textContent = file.filePath;
      
      const fileSize = document.createElement('span');
      fileSize.className = 'duplicate-file-size';
      fileSize.textContent = formatFileSize(file.size);
      
      fileDiv.appendChild(checkbox);
      fileDiv.appendChild(filePath);
      fileDiv.appendChild(fileSize);
      filesList.appendChild(fileDiv);
    });
    
    group.appendChild(preview);
    group.appendChild(filesList);
    duplicateGroups.appendChild(group);
  }

  // Set up delete handler
  if (deleteButton) {
    deleteButton.onclick = handleDeleteSelected;
  } else {
    console.error('Delete button not found!');
  }
}

async function handleDeleteSelected() {
  console.log('Delete button clicked!');

  const selectedFiles = Array.from(
    document.querySelectorAll('.duplicate-file input[type="checkbox"]:checked')
  ).map(checkbox => checkbox.getAttribute('data-filepath'));

  console.log('Selected files:', selectedFiles);

  if (selectedFiles.length === 0) {
    await window.electron.showMessage('No Selection', 'Please select files to delete');
    return;
  }

  // Limit file list display to prevent dialog from becoming too tall
  const maxFilesToShow = 20;
  const fileList = selectedFiles.slice(0, maxFilesToShow).map(fp => {
    // Extract filename from path (handle both Windows and Unix paths)
    const parts = fp.split(/[/\\]/);
    return parts[parts.length - 1];
  }).join('\n');
  const moreFiles = selectedFiles.length > maxFilesToShow ? `\n... and ${selectedFiles.length - maxFilesToShow} more file${selectedFiles.length - maxFilesToShow === 1 ? '' : 's'}` : '';

  const confirm = await window.electron.showMessage(
    'Confirm Delete',
    `Are you sure you want to DELETE ${selectedFiles.length} files?\nThis cannot be undone!\n\nFiles:\n${fileList}${moreFiles}`,
    ['Yes', 'No']
  );

  if (confirm === 'Yes') {
    try {
      for (const filePath of selectedFiles) {
        console.log('Attempting to delete:', filePath);
        const success = await window.electron.deleteFile(filePath);
        console.log('Delete result:', success);
        if (!success) {
          await window.electron.showMessage('Error', `Failed to delete file: ${filePath}`);
        }
      }

      // Close the dedup dialog
      const dialog = document.getElementById('dedup-dialog');
      dialog.close();

      // Clear selected models
      selectedModels.clear();
      
      // Get current sort option and refresh the grid
      const sortSelect = document.getElementById('sort-select');
      
      const models = await window.electron.getAllModels(sortSelect.value);
      
      // Use renderFiles instead of refreshModelDisplay
      await renderFiles(models);

      // Reload and reopen the dedup dialog with fresh data
      // Skip hash check since we just deleted files and don't need to check again
      await loadDuplicateFiles(true);
      dialog.showModal();

    } catch (error) {
      console.error('Error deleting files:', error);
      await window.electron.showMessage('Error', `An error occurred: ${error.message}`);
    }
  }
}

// Create a separate function for rendering filtered results
async function renderFilteredFiles(files) {
  const container = document.querySelector('.file-grid');
  container.innerHTML = '';
  
  // Render in batches without progress indication
  const batchSize = 5;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, Math.min(i + batchSize, files.length));
    const elements = await Promise.all(batch.map(file => renderFile(file, container)));
    elements.forEach(element => {
      if (element) container.appendChild(element);
    });
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  
  // Just update the count, don't touch progress bars
  await updateModelCounts(files.length);
}

// Add a separate function for generating thumbnails
async function generateThumbnail(file) {
  try {
    const filePath = (typeof file === 'string') ? file : file.filePath;
    if (!filePath) {
      throw new Error("generateThumbnail: filePath is undefined");
    }

    // 1. Try to get embedded thumbnail for 3MF
    if (filePath.toLowerCase().endsWith('.3mf')) {
        console.log(`[DEBUG] generateThumbnail: Attempting to extract embedded thumbnail for ${filePath}`);
        try {
            const images = await extract3MFThumbnail(filePath);
            if (images && images.length > 0) {
                const firstImage = images[0];
                if (typeof firstImage === 'string' && firstImage.startsWith('data:image')) {
                    console.log(`[DEBUG] generateThumbnail: SUCCESS - Using embedded thumbnail for ${filePath}`);
                    // Save to database
                    await window.electron.saveThumbnail(filePath, firstImage);
                    
                    // Calculate and save hash during thumbnail generation (file is already being read)
                    try {
                      await window.electron.calculateFileHash(filePath);
                    } catch (hashError) {
                      console.error(`Error calculating hash for ${filePath}:`, hashError);
                      // Continue even if hash calculation fails
                    }
                    
                    return firstImage;
                } else {
                    console.log(`[DEBUG] generateThumbnail: Invalid image format. First image type: ${typeof firstImage}`);
                }
            } else {
                console.log(`[DEBUG] generateThumbnail: No embedded images found for ${filePath}`);
            }
        } catch (e) {
            console.error('Error extracting 3MF thumbnail:', e);
        }
    }

    // Use the exposed function to get file stats
    const stats = await window.electron.getFileStats(filePath);
    const fileSizeInMB = stats.size / (1024 * 1024);
    
    if (fileSizeInMB > MAX_FILE_SIZE_MB) {
      debugLog(`Skipping thumbnail generation for ${filePath} (${fileSizeInMB.toFixed(2)}MB > ${MAX_FILE_SIZE_MB}MB)`);
      console.warn(`Skipping thumbnail generation for ${filePath} (${fileSizeInMB.toFixed(2)}MB > ${MAX_FILE_SIZE_MB}MB)`);
      await window.electron.saveThumbnail(filePath, '3d.png');
      return '3d.png';
    }

    // Create a temporary container for rendering
    const tempContainer = document.createElement('div');
    
    // Call renderModelToPNG directly instead of renderThumbnail
    const thumbnail = await renderModelToPNG(filePath, tempContainer, null);
    
    await window.electron.saveThumbnail(filePath, thumbnail);
    
    // Calculate and save hash during thumbnail generation (file is already being read)
    try {
      await window.electron.calculateFileHash(filePath);
    } catch (hashError) {
      console.error(`Error calculating hash for ${filePath}:`, hashError);
      // Continue even if hash calculation fails
    }
    
    return thumbnail;
  } catch (error) {
    console.error(`Error generating thumbnail for ${file.filePath || file}:`, error);
    return '3d.png';
  }
}

// Add helper function for populating license dropdown
async function populateModelLicenseDropdown(selectedLicense, elementId = 'model-license') {
  const licenseSelect = document.getElementById(elementId);
  if (!licenseSelect) return;

  licenseSelect.innerHTML = '<option value="">Select License</option>';

  try {
    const licenses = await window.electron.getLicenses();
    licenses.forEach(license => {
      if (license) { // Only add non-empty licenses
        const option = document.createElement('option');
        option.value = license;
        option.textContent = license;
        if (license === selectedLicense) {
          option.selected = true;
        }
        licenseSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching licenses:', error);
  }
}

// Add helper function for populating parent model dropdown
async function populateParentModelDropdown(selectedParent, elementId = 'model-parent') {
  const parentSelect = document.getElementById(elementId);
  if (!parentSelect) return;

  parentSelect.innerHTML = '<option value="">None</option>';

  try {
    const parents = await window.electron.getParentModels();
    // Use a Set to track unique parent values to prevent duplicates
    const seenParents = new Set();
    
    parents.forEach(parent => {
      if (parent && !seenParents.has(parent)) { // Only add non-empty, unique parent models
        seenParents.add(parent);
        const option = document.createElement('option');
        option.value = parent;
        option.textContent = parent;
        if (parent === selectedParent) {
          option.selected = true;
        }
        parentSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching parent models:', error);
  }
}

// Add back the populateParentModelFilter function
async function populateParentModelFilter() {
  const parentSelect = document.getElementById('parent-select');
  parentSelect.innerHTML = '<option value="">All Parent Models</option>';
  // Add an option to filter for models with no parent model set
  parentSelect.innerHTML += '<option value="__none__">None</option>';
  try {
    const parents = await window.electron.getParentModels();
    // Use a Set to track unique parent values to prevent duplicates
    const seenParents = new Set();
    
    parents.forEach(parent => {
      if (parent && !seenParents.has(parent)) { // Only add non-empty, unique parent models
        seenParents.add(parent);
        const option = document.createElement('option');
        option.value = parent;
        option.textContent = parent;
        parentSelect.appendChild(option);
      }
    });
  } catch (error) {
    console.error('Error fetching parent models for filter:', error);
  }
}

// Add this function near other file rendering functions
function addContextMenuHandler(fileElement, filePath) {
  // Remove any existing context menu handler to avoid duplicates
  fileElement.removeEventListener('contextmenu', fileElement._contextMenuHandler);
  
  // Create the handler function
  const handler = async (e) => {
    e.preventDefault(); // Prevent default context menu
    
    // For list view, ensure the entire element is clickable
    // Check if the click is on this element or any of its children
    const target = e.target;
    if (!fileElement.contains(target) && target !== fileElement) {
      return; // Click was outside the element
    }
    
    e.stopPropagation(); // Prevent event bubbling after we've handled it
    
    // If multi-edit mode is active and more than one model is selected,
    // send the entire selection. Otherwise, use the single filePath.
    if (isMultiSelectMode && selectedModels.size > 1) {
      await window.electron.showContextMenu(Array.from(selectedModels));
    } else {
      await window.electron.showContextMenu(filePath);
    }
  };
  
  // Store handler reference for potential removal
  fileElement._contextMenuHandler = handler;
  
  // Use capture phase for list view to catch events on child elements
  // For other views, use bubble phase
  const useCapture = fileElement.classList.contains('file-item-list');
  fileElement.addEventListener('contextmenu', handler, useCapture);
}

// Update the exit multi-edit mode functionality
function exitMultiEditMode() {
  // Clear selections
  selectedModels.clear();
  document.querySelectorAll('.file-item').forEach(item => {
    item.classList.remove('selected');
  });
  
  // Update the selection count display
  updateSelectedCount();
  
  // Switch back to single edit mode
  isMultiSelectMode = false;
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');
  multiEditPanel.classList.add('hidden');
  detailsPanel.classList.remove('hidden');
  document.getElementById('edit-mode-toggle').textContent = 'Multi-Edit Mode';
  document.getElementById('edit-mode-toggle').classList.remove('active');

  // Remove all event listeners from model form fields
  const formFields = [
    'multi-designer',
    'multi-source',
    'multi-printed', // Add printed checkbox to list
    'multi-parent',
    'multi-license',
    'multi-tag-select'
  ];

  // Clone and replace each field to remove event listeners
  formFields.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      // Clone and replace the element to remove all event listeners
      const newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
      
      // Reset any specific element states
      if (fieldId === 'multi-printed') {
        newElement.checked = false;
      } else if (newElement.tagName === 'SELECT') {
        newElement.value = ''; // Reset select elements
      } else if (newElement.tagName === 'INPUT') {
        newElement.value = ''; // Reset text inputs
      }
    }
  });

  // Clear the current model details path to prevent stale event handlers
  currentModelDetailsPath = null;
  currentModelDetailsAbort = true;
  
  // Remove event listeners from model details form fields by cloning them
  const modelDetailsFields = [
    'model-printed',
    'model-source',
    'model-notes',
    'model-designer',
    'model-license',
    'model-parent'
  ];
  
  modelDetailsFields.forEach(fieldId => {
    const element = document.getElementById(fieldId);
    if (element) {
      // Clone and replace to remove all event listeners
      const newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
      
      // Reset element states
      if (fieldId === 'model-printed') {
        newElement.checked = false;
      } else if (newElement.tagName === 'SELECT') {
        newElement.value = '';
      } else if (newElement.tagName === 'INPUT') {
        newElement.value = '';
      }
    }
  });
  
  // Clear the form
  const pathTreeContainer = document.getElementById('path-tree-container');
  if (pathTreeContainer) {
    pathTreeContainer.innerHTML = '';
    pathTreeContainer.removeAttribute('data-file-path');
  }
  document.getElementById('model-name').value = '';
  document.getElementById('model-designer').value = '';
  document.getElementById('model-source').value = '';
  document.getElementById('model-notes').value = '';
  document.getElementById('model-printed').checked = false;
  document.getElementById('model-parent').value = '';
  document.getElementById('model-license').value = '';
  document.getElementById('model-tags').innerHTML = '';
  
  // Clear the multi-edit tag container as well
  const multiTagsContainer = document.getElementById('multi-tags');
  if (multiTagsContainer) {
    multiTagsContainer.innerHTML = '';
  }
  
  // Reset the multi-tag-select dropdown
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    // Set back to default option
    multiTagSelect.value = '';
    
    // Optionally refresh the dropdown options
    populateTagSelect('multi-tag-select', 'multi-tags');
  }
  
  // Reset selection tracking to ensure tags are cleared on next selection
  previousSelectionHash = '';
  
  console.log('Exited multi-edit mode and cleared tags');
}

// Update the edit mode toggle handler
document.getElementById('edit-mode-toggle')?.addEventListener('click', () => {
  isMultiSelectMode = !isMultiSelectMode;
  const button = document.getElementById('edit-mode-toggle');
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');

  if (isMultiSelectMode) {
    button.textContent = 'Exit Multi-Edit Mode';
    button.classList.add('active');
    multiEditPanel.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
    showMultiEditPanel();
  } else {
    exitMultiEditMode();
  }
});

// Update the exit button handler
document.getElementById('exit-multi-edit-button')?.addEventListener('click', exitMultiEditMode);

// Add these configurations at the top of your file
const RENDER_CONFIG = {
  THUMBNAIL_SIZE: 250,
  MAX_CACHE_SIZE: 1000,
  CHUNK_SIZE: 5,
  JPEG_QUALITY: 0.8,
  CLEANUP_INTERVAL: 60000
};

// Add WebGL context loss handling
window.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  sharedRenderer = null;
}, false);

// Searchable list dialog functionality
async function showSearchableListDialog(fieldType, targetSelectId, mode = 'filter', containerId = null, isRemove = false) {
  const dialog = document.getElementById('searchable-list-dialog');
  const titleElement = document.getElementById('searchable-list-title');
  const searchInput = document.getElementById('searchable-list-search');
  const itemsList = document.getElementById('searchable-list-items');
  const cancelButton = document.getElementById('searchable-list-cancel');
  
  if (!dialog || !titleElement || !searchInput || !itemsList) {
    console.error('Searchable list dialog elements not found');
    return;
  }
  
  // Set title based on field type
  const titles = {
    designer: 'Select Designer',
    parent: 'Select Parent Model',
    license: 'Select License',
    tag: isRemove ? 'Remove Tag' : 'Select Tag'
  };
  titleElement.textContent = titles[fieldType] || 'Select Item';
  
  // Clear previous content
  searchInput.value = '';
  itemsList.innerHTML = '';
  
  // Fetch data based on field type
  let items = [];
  try {
    switch (fieldType) {
      case 'designer':
        items = await window.electron.getDesigners();
        break;
      case 'parent':
        items = await window.electron.getParentModels();
        // Remove duplicates
        items = [...new Set(items.filter(p => p))];
        break;
      case 'license':
        items = await window.electron.getLicenses();
        break;
      case 'tag':
        if (isRemove && targetSelectId === 'multi-tag-remove-select') {
          // For remove tags, get tags from selected files only
          if (selectedModels.size === 0) {
            items = [];
          } else {
            const filePaths = Array.from(selectedModels);
            const tagPromises = filePaths.map(async (filePath) => {
              try {
                const model = await window.electron.getModel(filePath);
                return model && model.tags ? (Array.isArray(model.tags) ? model.tags : []) : [];
              } catch (error) {
                console.error(`Error loading tags for ${filePath}:`, error);
                return [];
              }
            });
            const allTagsArrays = await Promise.all(tagPromises);
            // Collect unique tags
            const uniqueTags = new Set();
            allTagsArrays.forEach(tags => {
              if (Array.isArray(tags)) {
                tags.forEach(tag => {
                  if (tag && typeof tag === 'string') {
                    const normalizedTag = tag.trim();
                    if (normalizedTag) {
                      uniqueTags.add(normalizedTag);
                    }
                  }
                });
              }
            });
            items = Array.from(uniqueTags);
          }
        } else {
          // For add tags, get all tags
          const tags = await window.electron.getAllTags();
          items = tags.map(t => t.name);
        }
        break;
      default:
        console.error('Unknown field type:', fieldType);
        return;
    }
    
    // Sort items alphabetically
    items.sort((a, b) => a.localeCompare(b));
    
    // Filter out empty values
    items = items.filter(item => item && item.trim() !== '');
    
    if (items.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No items found';
      li.style.color = '#888';
      li.style.cursor = 'default';
      itemsList.appendChild(li);
    } else {
      // Render items
      renderListItems(items, itemsList, '');
    }
  } catch (error) {
    console.error('Error fetching items for searchable list:', error);
    const li = document.createElement('li');
    li.textContent = 'Error loading items';
    li.style.color = '#ff4444';
    li.style.cursor = 'default';
    itemsList.appendChild(li);
    return;
  }
  
  // Handle item selection
  const handleItemClick = (itemValue) => {
    dialog.close();
    
    const targetSelect = document.getElementById(targetSelectId);
    if (!targetSelect) {
      console.error('Target select element not found:', targetSelectId);
      return;
    }
    
    // Set the value in the dropdown
    targetSelect.value = itemValue;
    
    // For remove tags, trigger the remove handler
    if (isRemove && targetSelectId === 'multi-tag-remove-select') {
      // Trigger the change event which will call handleRemoveTagSelect
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (fieldType === 'tag' && mode !== 'filter' && containerId) {
      // For tags in edit mode, use addTagToModel
      addTagToModel(itemValue, containerId);
    } else if (mode === 'edit' || mode === 'multi') {
      // For edit/multi mode, trigger auto-save
      const fieldMap = {
        designer: 'designer',
        parent: 'parentModel',
        license: 'license'
      };
      
      if (fieldMap[fieldType]) {
        const filePath = mode === 'edit' ? getCurrentModelFilePath() : null;
        if (mode === 'multi') {
          autoSaveMultipleModels(fieldMap[fieldType], itemValue);
        } else if (filePath) {
          autoSaveModel(fieldMap[fieldType], itemValue, filePath);
        }
      }
      
      // Trigger change event after setting value
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (mode === 'filter') {
      // For filter mode, trigger filter update
      targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };
  
  // Render list items function
  function renderListItems(itemsToRender, listElement, searchTerm) {
    listElement.innerHTML = '';
    
    if (itemsToRender.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No items found';
      li.style.color = '#888';
      li.style.cursor = 'default';
      listElement.appendChild(li);
      return;
    }
    
    itemsToRender.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      li.addEventListener('click', () => handleItemClick(item));
      listElement.appendChild(li);
    });
  }
  
  // Handle search input with debounce
  let searchTimeout;
  const handleSearch = (e) => {
    const searchTerm = e.target.value;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const filtered = items.filter(item => 
        item.toLowerCase().includes(searchTerm.toLowerCase())
      );
      renderListItems(filtered, itemsList, searchTerm);
    }, 200);
  };
  
  searchInput.addEventListener('input', handleSearch);
  
  // Handle cancel button
  const handleCancel = () => {
    dialog.close();
  };
  cancelButton.addEventListener('click', handleCancel);
  
  // Close on Escape key
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      dialog.close();
    }
  };
  dialog.addEventListener('keydown', handleKeyDown);
  
  // Clean up event listeners when dialog closes
  dialog.addEventListener('close', () => {
    searchInput.removeEventListener('input', handleSearch);
    cancelButton.removeEventListener('click', handleCancel);
    dialog.removeEventListener('keydown', handleKeyDown);
  }, { once: true });
  
  // Show dialog
  dialog.showModal();
  
  // Focus search input
  requestAnimationFrame(() => {
    searchInput.focus();
  });
}

// Helper function to get current model file path
function getCurrentModelFilePath() {
  const modelDetails = document.getElementById('model-details');
  if (modelDetails && !modelDetails.classList.contains('hidden')) {
    const pathContainer = document.getElementById('path-tree-container');
    if (pathContainer && pathContainer.dataset.filePath) {
      return pathContainer.dataset.filePath;
    }
  }
  return null;
}

// Initialize List button event listeners
function initializeListButtons() {
  document.querySelectorAll('.list-button').forEach(button => {
    // Remove existing listeners to avoid duplicates
    const newButton = button.cloneNode(true);
    button.parentNode.replaceChild(newButton, button);
    
    newButton.addEventListener('click', async () => {
      const fieldType = newButton.dataset.field;
      const targetSelectId = newButton.dataset.target;
      const mode = newButton.dataset.mode || 'filter';
      const containerId = newButton.dataset.container || null;
      const isRemove = newButton.dataset.remove === 'true';
      
      await showSearchableListDialog(fieldType, targetSelectId, mode, containerId, isRemove);
    });
  });
}

// Remove all existing DOMContentLoaded event listeners and create a single one
// Place this at the end of the file, after all function declarations

// First, declare all initialization functions outside of any event listeners
async function initializeApp() {
  try {
    // Load saved sort preference before initializing search
    const savedSortOption = await window.electron.getSetting('sortOption');
    const sortSelect = document.getElementById('sort-select');
    if (sortSelect && savedSortOption) {
      // Validate that the saved option is a valid sort option
      const validOptions = ['name-asc', 'name-desc', 'size-asc', 'size-desc', 'date-asc', 'date-desc', 'dateadded-asc', 'dateadded-desc'];
      if (validOptions.includes(savedSortOption)) {
        sortSelect.value = savedSortOption;
      }
    }
    
    // Initialize the combined search functionality from search.js
    if (typeof window.initializeCombinedSearch === 'function') {
      await window.initializeCombinedSearch();
    }
    
    console.log('1. Starting initialization sequence');
    
    // Initialize settings inline instead of calling initializeSettings()
    console.log('2. Loading settings...');
    try {
      // Initialize other settings as needed
      const backgroundColor = await window.electron.getSetting('modelBackgroundColor');
      if (backgroundColor) {
        document.documentElement.style.setProperty('--model-background-color', backgroundColor);
        const colorPicker = document.getElementById('model-background-color');
        if (colorPicker) {
          colorPicker.value = backgroundColor;
        }
      }
      
      // Load UI theme
      const savedTheme = await window.electron.getSetting('uiTheme') || 'modern-cyan';
      document.body.setAttribute('data-theme', savedTheme);
      const uiThemeSelect = document.getElementById('ui-theme');
      if (uiThemeSelect) {
        uiThemeSelect.value = savedTheme;
      }
      
      // Apply theme colors if function exists
      if (typeof applyThemeColors === 'function') {
        applyThemeColors(savedTheme);
      } else {
        // Fallback: apply theme colors inline
        const root = document.documentElement;
        switch(savedTheme) {
          case 'modern-purple':
            root.style.setProperty('--primary-accent', '#a855f7');
            root.style.setProperty('--primary-accent-hover', '#c084fc');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #a855f7 0%, #c084fc 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #b866ff 0%, #d094ff 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(168, 85, 247, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(168, 85, 247, 0.4)');
            break;
          case 'modern-green':
            root.style.setProperty('--primary-accent', '#4ade80');
            root.style.setProperty('--primary-accent-hover', '#22c55e');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #4ade80 0%, #22c55e 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #5ae890 0%, #2dd66f 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(34, 197, 94, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(34, 197, 94, 0.4)');
            break;
          case 'modern-orange':
            root.style.setProperty('--primary-accent', '#fb923c');
            root.style.setProperty('--primary-accent-hover', '#f97316');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #fb923c 0%, #f97316 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ffa34c 0%, #ff8326 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(249, 115, 22, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(249, 115, 22, 0.4)');
            break;
          case 'modern-pink':
            root.style.setProperty('--primary-accent', '#f472b6');
            root.style.setProperty('--primary-accent-hover', '#ec4899');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #f472b6 0%, #ec4899 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #ff82c6 0%, #fc58a9 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(236, 72, 153, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(236, 72, 153, 0.4)');
            break;
          case 'dark-minimal':
            root.style.setProperty('--primary-accent', '#9ca3af');
            root.style.setProperty('--primary-accent-hover', '#d1d5db');
            root.style.setProperty('--primary-gradient', 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)');
            root.style.setProperty('--primary-gradient-hover', 'linear-gradient(135deg, #9ca3af 0%, #6b7280 100%)');
            root.style.setProperty('--primary-shadow', 'rgba(75, 85, 99, 0.3)');
            root.style.setProperty('--primary-shadow-hover', 'rgba(75, 85, 99, 0.4)');
            break;
        }
      }
    } catch (error) {
      console.error('Error initializing settings:', error);
    }
    
    console.log('3. Checking current version...');
    const currentVersion = await window.electron.getSetting('currentVersion');
    const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
    
    console.log('4. Current app state:', {
      currentVersion,
      isBeta,
      checkingForUpdates: true
    });
    
    // Check if version check was already performed by main process
    const versionCheckPerformed = await window.electron.getSetting('versionCheckPerformedOnStartup');
    let latestVersion;
    
    if (versionCheckPerformed === 'true') {
      console.log('5. Version check already performed by main process, retrieving stored version');
      // Get the latest version from the database instead of making another HTTP request
      latestVersion = await window.electron.getSetting('latestVersion');
      console.log('Retrieved latest version from database:', latestVersion);
    } else {
      console.log('5. Checking for updates...');
      latestVersion = await window.electron.checkForUpdates(isBeta);
    }
    
    // Reset the flag for next app start
    await window.electron.saveSetting('versionCheckPerformedOnStartup', 'false');
    
    const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');
    
    console.log('6. Version check results:', {
      currentVersion,
      latestVersion,
      lastDeclinedVersion,
      isBeta,
      needsUpdate: latestVersion !== currentVersion
    });
    
    // Only show prompt if it's a new version and not the one user previously declined
    // This is an automatic check (silent=true), so respect lastDeclinedVersion
    const isUpdateAvailable = latestVersion && 
                              latestVersion !== currentVersion && 
                              compareVersions(latestVersion, currentVersion) > 0;
    const shouldShowPrompt = isUpdateAvailable && 
                             latestVersion !== lastDeclinedVersion;
    
    if (shouldShowPrompt) {
      console.log('7. Update available - showing prompt');
      const shouldUpdate = await window.electron.showMessage(
        'Update Available',
        `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
        ['Yes', 'No']
      );
      
      console.log('Renderer - Update prompt response:', shouldUpdate);
      if (shouldUpdate === 'Yes') {
        await window.electron.openUpdatePage(isBeta);
      } else {
        // Store the declined version
        console.log('Renderer - User declined update, storing version:', latestVersion);
        await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
      }
    }

    // Store the latest version after check
    if (latestVersion) {
      console.log('Renderer - Saving latest version to settings:', latestVersion);
      await window.electron.saveSetting('latestVersion', latestVersion);
      await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());
    }
    
    console.log('8. Initializing UI components');
    // Call initializeDialogHandlers directly if it's accessible
    if (typeof initializeDialogHandlers === 'function') {
      initializeDialogHandlers();
    }
    
    // Initialize performance settings inline
    try {
      // Get the stored max file size value
      const maxFileSize = await window.electron.getSetting('maxFileSizeMB');
      if (maxFileSize) {
        MAX_FILE_SIZE_MB = parseInt(maxFileSize);
      }

      // Set the input value if the element exists
      const maxFileSizeInput = document.getElementById('max-file-size');
      if (maxFileSizeInput) {
        maxFileSizeInput.value = MAX_FILE_SIZE_MB.toString();
      }
    } catch (error) {
      console.error('Error initializing performance settings:', error);
    }
    

    
    console.log('9. Initialization complete');
  } catch (error) {
    console.error('Fatal error during initialization:', error);
    throw error; // Re-throw to be caught by the DOMContentLoaded handler
  }
}

// Remove the version check from initializeGrid
async function initializeGrid(sortOption = 'name') {
  try {
    const models = await window.electron.getAllModels(sortOption);
    const fileGrid = document.querySelector('.file-grid');
    
    // Show welcome message if no models
    if (models.length === 0) {
      const welcomeDialog = document.getElementById('welcome-message');
      if (welcomeDialog && !welcomeDialog.hasAttribute('open')) {
        welcomeDialog.showModal();
      }
    }

    await updateModelCounts(models.length);
    fileGrid.innerHTML = '';
    // ... rest of grid initialization
  } catch (error) {
    console.error('Error initializing grid:', error);
  }
}

// Edit the DOMContentLoaded event listener to remove the call to promptPendingThumbnails
document.addEventListener('DOMContentLoaded', async () => {
  const tosAccepted = await checkTermsOfService();
  if (!tosAccepted) return; // Don't continue if TOS was declined

  // Check for server mode and add UI indicators
  const serverMode = await window.electron.isServerMode().catch(() => false);
  if (serverMode) {
    // Server mode indicator and menu bar are already added in the first DOMContentLoaded listener
    // Just ensure they exist (they should already be there)
    if (!document.getElementById('server-mode-indicator')) {
      const sidebar = document.querySelector('.sidebar');
      if (sidebar) {
        const serverIndicator = document.createElement('div');
        serverIndicator.id = 'server-mode-indicator';
        serverIndicator.style.cssText = 'background-color: #4a9eff; color: white; padding: 10px; margin: 10px 0; border-radius: 4px; text-align: center; font-weight: bold;';
        serverIndicator.innerHTML = `
          <div>🌐 Server Mode</div>
          <div style="font-size: 12px; font-weight: normal; margin-top: 5px;">
            UNC paths required for all file operations
          </div>
        `;
        sidebar.insertBefore(serverIndicator, sidebar.firstChild);
      }
    }
    if (!document.getElementById('server-menu-bar')) {
      createServerMenuBar();
    }
  }

  // Show the welcome dialog if this is the first run
  try {
    const hasRunBefore = await window.electron.getSetting('hasRunBefore');
    console.log('hasRunBefore check:', hasRunBefore);
    if (!hasRunBefore) {
      console.log('Showing welcome dialog and saving hasRunBefore setting');
      const welcomeDialog = document.getElementById('welcome-message');
      if (welcomeDialog) {
        welcomeDialog.showModal();
      }
      await window.electron.saveSetting('hasRunBefore', 'true');
      console.log('hasRunBefore setting saved');
    }
  } catch (error) {
    console.error('Error checking/saving hasRunBefore:', error);
  }

  debugLog('DOM fully loaded and parsed');

  // Continue with normal initialization (which includes update checking)
  await initializeApp();

  // (Any additional event listeners and UI initialization code below)
});

// Add event listeners for the multi-edit panel move and delete buttons
document.getElementById('move-selected-button')?.addEventListener('click', async () => {
    if (selectedModels.size === 0) {
        await window.electron.showMessage('No Selection', 'Please select models to move.');
        return;
    }
    const count = selectedModels.size;
    const confirmation = await window.electron.showMessage(
        'Confirm Move',
        `Are you sure you want to move ${count} selected model${count !== 1 ? 's' : ''}?`,
        ['Yes', 'No']
    );
    if (confirmation !== 'Yes') return;

    // Open folder dialog via IPC
    const result = await window.electron.openFolderDialog('Select Destination Folder');
    if (!result.canceled && result.filePaths && result.filePaths.length > 0) {
        const destinationFolder = result.filePaths[0];
        try {
            // Move files
            for (const filePath of selectedModels) {
                const newDestination = path.join(destinationFolder, path.basename(filePath));
                await fs.promises.rename(filePath, newDestination);
                db.prepare('UPDATE models SET filePath = ? WHERE filePath = ?').run(newDestination, filePath);
            }
            // Clear selected models after moving
            selectedModels.clear();
            updateSelectedCount(); // Update the UI to reflect the cleared selection
            document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected')); // Clear visual selection
        } catch (error) {
            console.error('Error moving selected models:', error);
        }
    }
});

document.getElementById('delete-selected-button')?.addEventListener('click', async () => {
  if (selectedModels.size === 0) {
    await window.electron.showMessage('No Selection', 'Please select models to delete.');
    return;
  }
  const count = selectedModels.size;
  const confirmation = await window.electron.showMessage(
    'Confirm Deletion',
    `Are you sure you want to DELETE ${count} selected model${count !== 1 ? 's' : ''}? This cannot be undone!`,
    ['Yes', 'No']
  );
  if (confirmation !== 'Yes') return;

  // Delete selected models one-by-one.
  for (const filePath of selectedModels) {
    try {
      await window.electron.deleteFile(filePath);
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
    }
  }
  // Clear selected models after deletion.
  selectedModels.clear();
  // Refresh the display (assuming 'refreshModelDisplay' exists).
  await refreshModelDisplay();
});

// Add a semantic version comparison function at an appropriate place in the file
function compareVersions(v1, v2) {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 < p2) return -1;
    if (p1 > p2) return 1;
  }
  
  return 0;
}

// Add this event handler after the other window.electron.on handlers
window.electron.on('show-native-prompt', async (options) => {
  const { title, label, placeholder } = options;
  const value = prompt(label || 'Please enter a value:', placeholder || '');
  
  // Send the response back to main process
  window.electron.send('native-prompt-response', { 
    value: value,
    canceled: value === null
  });
});

// Add implementation of autoSaveModel function
async function autoSaveModel(field, value, filePath) {
  try {
    if (!filePath) {
      console.error('No file path provided for autoSaveModel');
      return;
    }
    
    const model = await window.electron.getModel(filePath);
    if (!model) {
      console.error(`Model not found for ${filePath}`);
      return;
    }
    
    // Update the specified field
    model[field] = value;
    
    // Save the updated model
    await window.electron.saveModel(model);
    
    // For tags, add a slightly longer delay to ensure database is fully updated
    if (field === 'tags') {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    
    // If this was called from the details panel, update the displayed file
    await updateModelElement(filePath);
    
    // Also update the checkbox in the model details panel if it's showing this model
    if (field === 'printed') {
      // Use the same logic as getModelFilePath to determine current model
      const currentModelPath = getCurrentModelFilePath() || 
        document.querySelector('.model-details')?.getAttribute('data-filepath');
      
      // Check if the details panel is showing this model
      if (currentModelPath === filePath) {
        const printedCheckbox = document.getElementById('model-printed');
        if (printedCheckbox) {
          printedCheckbox.checked = value;
        }
      }
    }
    
    return true;
  } catch (error) {
    console.error(`Error in autoSaveModel for field ${field}:`, error);
    return false;
  }
}

// Add implementation of autoSaveMultipleModels function
async function autoSaveMultipleModels(field, value, options = {}) {
  try {
    // No models selected
    if (selectedModels.size === 0) {
      console.warn('No models selected for autoSaveMultipleModels');
      return false; // Indicate failure/no-op
    }
    
    // Handle designer field default value (will be reapplied next)
    if (field === 'designer' && !value) {
      value = 'Unknown';
    }
    
    // Create a copy of selectedModels to avoid issues if the set changes during iteration
    const modelsToUpdate = Array.from(selectedModels);
    console.log(`autoSaveMultipleModels: Updating ${modelsToUpdate.length} models for field ${field}`);
    
    // Load all models in parallel for better performance
    const modelLoadPromises = modelsToUpdate.map(async (filePath, index) => {
      try {
        console.log(`[${index}] Loading model: ${filePath}`);
        const model = await window.electron.getModel(filePath);
        if (model) {
          console.log(`[${index}] Successfully loaded model: ${filePath}`);
          return { filePath, model };
        } else {
          console.warn(`[${index}] Could not find model for ${filePath} during autoSaveMultipleModels`);
          return null;
        }
      } catch (error) {
        console.error(`[${index}] Error loading model ${filePath} in autoSaveMultipleModels:`, error);
        return null;
      }
    });
    
    // Wait for all models to load in parallel
    const loadedModels = await Promise.all(modelLoadPromises);
    console.log(`Loaded ${loadedModels.length} models, ${loadedModels.filter(r => r !== null).length} successful`);
    
    // Filter out null results and prepare updates
    const modelUpdates = [];
    for (let i = 0; i < loadedModels.length; i++) {
      const result = loadedModels[i];
      if (result) {
        const { filePath, model } = result;
        console.log(`[${i}] Processing model update for: ${filePath}`);
        // Special handling for tags - MERGE or REPLACE based on options
        if (field === 'tags') {
          const newTags = Array.isArray(value) ? value : []; 
          if (options.replaceTags) {
            // Replace tags completely (used when removing tags)
            model.tags = newTags.sort();
            console.log(`[${i}] Replacing tags with: ${newTags.join(', ')}`);
          } else {
            // Merge tags (used when adding tags)
            const existingTags = Array.isArray(model.tags) ? model.tags : [];
            // Combine, filter out duplicates, and sort
            const allTags = [...new Set([...existingTags, ...newTags])].sort(); 
            model.tags = allTags;
            console.log(`[${i}] Merging tags. Existing: ${existingTags.join(', ')}, New: ${newTags.join(', ')}, Result: ${allTags.join(', ')}`);
          }
        } else {
          // Handle other fields
          model[field] = value;
        }
        
        modelUpdates.push({ filePath, model });
        console.log(`[${i}] Added to batch: ${filePath}, field ${field} = ${value}`);
      } else {
        console.warn(`[${i}] Skipping null result at index ${i}`);
      }
    }
    console.log(`Prepared ${modelUpdates.length} models for batch update`);
    
    // Save all models in a single bulk update
    if (modelUpdates.length > 0) {
      const modelDataBatch = modelUpdates.map(({ model }) => model);
      try {
        // Use bulk update for better performance - single transaction
        console.log(`Attempting bulk update for ${modelDataBatch.length} models`);
        const success = await window.electron.updateModelsBatch(modelDataBatch);
        if (!success) {
          throw new Error('Bulk update returned false');
        }
        console.log(`Successfully bulk updated ${modelDataBatch.length} models`);
      } catch (error) {
        console.error(`Error in bulk update for ${modelUpdates.length} models:`, error);
        console.log('Falling back to individual saves');
        // Fallback to individual saves if bulk update fails
        const savePromises = modelUpdates.map(({ model }) => 
          window.electron.saveModel(model).catch(err => {
            console.error(`Error saving model ${model.filePath}:`, err);
            return null;
          })
        );
        await Promise.all(savePromises);
      }
    }
    
    // Update UI for all models at once (batch update)
    // Use requestAnimationFrame to batch DOM updates
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    // Update all model elements in a single batch
    const updatePromises = modelUpdates.map(({ filePath }) => 
      updateModelElement(filePath).catch(err => {
        console.error(`Error updating UI for ${filePath}:`, err);
      })
    );
    
    // Wait for all UI updates to complete
    await Promise.all(updatePromises);
    
    console.log(`Finished autoSaveMultipleModels for field ${field}. Updated ${modelsToUpdate.length} models.`);
    return true;
  } catch (error) {
    console.error(`Error in autoSaveMultipleModels for field ${field}:`, error);
    return false;
  }
}

// Helper function to get the current model file path
function getModelFilePath() {
  // First try to get it from the path tree container
  const currentPath = getCurrentModelFilePath();
  if (currentPath) {
    return currentPath;
  }
  
  // Fallback: try to get it from the model-path input (for backwards compatibility)
  const pathInput = document.getElementById('model-path');
  if (pathInput && pathInput.value) {
    return pathInput.value;
  }
  
  // Then try to get it from the model-details data attribute
  const detailsPanel = document.querySelector('.model-details');
  if (detailsPanel && detailsPanel.getAttribute('data-filepath')) {
    return detailsPanel.getAttribute('data-filepath');
  }
  
  return null;
}

// Helper function to clear all multi-edit form fields
function clearMultiEditFormFields() {
  // Clear the printed checkbox
  const multiPrintedCheckbox = document.getElementById('multi-printed');
  if (multiPrintedCheckbox) {
    multiPrintedCheckbox.checked = false;
  }
  
  // Clear the source input
  const multiSourceInput = document.getElementById('multi-source');
  if (multiSourceInput) {
    multiSourceInput.value = '';
  }
  
  // Clear the designer dropdown
  const multiDesignerSelect = document.getElementById('multi-designer');
  if (multiDesignerSelect) {
    multiDesignerSelect.value = '';
  }
  
  // Clear the parent dropdown
  const multiParentSelect = document.getElementById('multi-parent');
  if (multiParentSelect) {
    multiParentSelect.value = '';
  }
  
  // Clear the license dropdown
  const multiLicenseSelect = document.getElementById('multi-license');
  if (multiLicenseSelect) {
    multiLicenseSelect.value = '';
  }
  
  // Clear the multi-edit tag container
  const multiTagsContainer = document.getElementById('multi-tags');
  if (multiTagsContainer) {
    multiTagsContainer.innerHTML = '';
  }
  
  // Reset the multi-tag-select dropdown
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    multiTagSelect.value = '';
  }

  // Reset the multi-tag-remove-select dropdown
  const multiTagRemoveSelect = document.getElementById('multi-tag-remove-select');
  if (multiTagRemoveSelect) {
    multiTagRemoveSelect.value = '';
    multiTagRemoveSelect.innerHTML = '<option value="">Select a tag to remove...</option>';
  }
}

// Add this code to set up event handlers for multi-edit mode controls
async function showMultiEditPanel() {
  // Populate dropdowns with existing data - REMOVED redundant calls
  // populateModelDesignerDropdown('', 'multi-designer');
  // populateModelLicenseDropdown('', 'multi-license');
  // populateParentModelDropdown('', 'multi-parent');
  // populateTagSelect('multi-tag-select', 'multi-tags');
  
  // Always clear the multi-edit tag container to prevent tags from sticking
  // This ensures that when a new selection is made, old tags don't persist
  // Note: The container is hidden in multi-edit mode, but we still clear it
  const multiTagsContainer = document.getElementById('multi-tags');
  if (multiTagsContainer) {
    multiTagsContainer.innerHTML = '';
    multiTagsContainer.style.display = 'none'; // Hide the tag list in multi-edit mode
  }
  
  // Reset the multi-tag-select dropdown
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    multiTagSelect.value = '';
  }
  
  // Also call the selection change handler to update tracking
  clearTagsOnSelectionChange();
  
  // Force the checkbox to be unchecked at the start
  const multiPrintedCheckbox = document.getElementById('multi-printed');
  if (multiPrintedCheckbox) {
    multiPrintedCheckbox.checked = false;
  }
  
  // Reset the source input
  const multiSourceInput = document.getElementById('multi-source');
  if (multiSourceInput) {
    multiSourceInput.value = '';
  }
  
  // Only clear dropdowns if no models are selected
  if (selectedModels.size === 0) {
    const multiDesignerSelect = document.getElementById('multi-designer');
    if (multiDesignerSelect) {
      multiDesignerSelect.value = '';
    }
    
    const multiParentSelect = document.getElementById('multi-parent');
    if (multiParentSelect) {
      multiParentSelect.value = '';
    }
    
    const multiLicenseSelect = document.getElementById('multi-license');
    if (multiLicenseSelect) {
      multiLicenseSelect.value = '';
    }
  }
  
  // Add change handlers for multi-edit controls
  document.getElementById('multi-designer')?.addEventListener('change', async (e) => {
    const value = e.target.value; // Only save if explicitly set
    if (value) {
      await autoSaveMultipleModels('designer', value);
    }
  });
  
  document.getElementById('multi-parent')?.addEventListener('change', async (e) => {
    await autoSaveMultipleModels('parentModel', e.target.value);
  });
  
  document.getElementById('multi-license')?.addEventListener('change', async (e) => {
    await autoSaveMultipleModels('license', e.target.value);
  });
  
  // Use input event with debounce for the source field so it saves as user types
  if (multiSourceInput) {
    // First remove any existing event listeners
    const newInput = multiSourceInput.cloneNode(true);
    multiSourceInput.parentNode.replaceChild(newInput, multiSourceInput);
    
    // Add debounced input event listener
    newInput.addEventListener('input', debounce(async function() {
      const sourceValue = this.value.trim();
      console.log(`Saving source value: "${sourceValue}"`);
      await autoSaveMultipleModels('source', sourceValue);
    }, 500));
    
    console.log('Multi-source input event handler attached');
  } else {
    console.error('Multi-source input not found');
  }
  
  // Add explicit event listener for the printed checkbox
  if (multiPrintedCheckbox) {
    // Create a highly visible function for debugging
    const handlePrintedChange = async function() {
      const isChecked = this.checked;
      console.log(`Multi-printed checkbox changed to: ${isChecked}`);
      
      if (selectedModels.size === 0) {
        console.warn('No models selected for updating printed status');
        return;
      }
      
      // Use autoSaveMultipleModels which handles bulk update
      await autoSaveMultipleModels('printed', isChecked);
    };
    
    // First remove any existing event listeners
    const newCheckbox = multiPrintedCheckbox.cloneNode(true);
    multiPrintedCheckbox.parentNode.replaceChild(newCheckbox, multiPrintedCheckbox);
    
    // Add event listener with both input and change events
    newCheckbox.addEventListener('change', handlePrintedChange);
    newCheckbox.addEventListener('click', function() {
      console.log('Multi-printed checkbox clicked, current state:', this.checked);
    });
    
    console.log('Multi-printed checkbox event handlers attached in showMultiEditPanel');
  } else {
    console.error('Multi-printed checkbox not found in showMultiEditPanel');
  }
  
  // Re-attach event listener for multi-tag-select
  // Get fresh reference since we may have cloned it earlier
  const multiTagSelectElement = document.getElementById('multi-tag-select');
  if (multiTagSelectElement) {
    // Clone/replace to ensure any old listeners are gone (might be redundant but safe)
    const newMultiTagSelect = multiTagSelectElement.cloneNode(true);
    multiTagSelectElement.parentNode.replaceChild(newMultiTagSelect, multiTagSelectElement);

    // Add the change listener
    newMultiTagSelect.addEventListener('change', () => {
      const selectedTag = newMultiTagSelect.value;
      if (selectedTag) {
        addTagToModel(selectedTag, 'multi-tags');
        newMultiTagSelect.value = ''; // Reset selection
      }
    });
    console.log('Multi-tag-select event handler re-attached in showMultiEditPanel');
  } else {
    console.error('Multi-tag-select element not found in showMultiEditPanel');
  }

  // Set up remove tag select event listener
  const removeTagSelectElement = document.getElementById('multi-tag-remove-select');
  if (removeTagSelectElement) {
    // Clone/replace to ensure any old listeners are gone
    const newRemoveTagSelect = removeTagSelectElement.cloneNode(true);
    removeTagSelectElement.parentNode.replaceChild(newRemoveTagSelect, removeTagSelectElement);

    // Add the change listener
    newRemoveTagSelect.addEventListener('change', async () => {
      await handleRemoveTagSelect();
    });
    console.log('Multi-tag-remove-select event handler attached in showMultiEditPanel');

    // Populate the remove tag dropdown
    await populateRemoveTagSelect();
  } else {
    console.error('Multi-tag-remove-select element not found in showMultiEditPanel');
  }
  
  // Initialize List buttons for multi-edit panel
  initializeListButtons();
}

// Update the edit mode toggle handler to call showMultiEditPanel when entering multi-edit mode
document.getElementById('edit-mode-toggle')?.addEventListener('click', () => {
  isMultiSelectMode = !isMultiSelectMode;
  const button = document.getElementById('edit-mode-toggle');
  const multiEditPanel = document.getElementById('multi-edit-panel');
  const detailsPanel = document.getElementById('model-details');

  if (isMultiSelectMode) {
    button.textContent = 'Exit Multi-Edit Mode';
    button.classList.add('active');
    multiEditPanel.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
    showMultiEditPanel();
  } else {
    exitMultiEditMode();
  }
});

// Add a direct event listener for the multi-printed checkbox
document.addEventListener('DOMContentLoaded', () => {
  // Setup multi-printed checkbox handler
  const multiPrintedCheckbox = document.getElementById('multi-printed');
  if (multiPrintedCheckbox) {
    // First remove any existing listeners by cloning and replacing
    const newCheckbox = multiPrintedCheckbox.cloneNode(true);
    multiPrintedCheckbox.parentNode.replaceChild(newCheckbox, multiPrintedCheckbox);
    
    // Add the event listener to the new checkbox
    newCheckbox.addEventListener('change', async function() {
      const isChecked = this.checked;
      console.log(`Multi-printed checkbox changed to: ${isChecked}`);
      
      // Use autoSaveMultipleModels which handles bulk update
      await autoSaveMultipleModels('printed', isChecked);
    });
    
    console.log('Multi-printed checkbox event listener attached');
  } else {
    console.error('Multi-printed checkbox not found');
  }

  // Add event listener for the Clear Selection button
  const clearSelectionButton = document.getElementById('clear-selection-button');
  if (clearSelectionButton) {
    clearSelectionButton.addEventListener('click', () => {
      console.log('Clear Selection button clicked');
      if (isMultiSelectMode) {
        selectedModels.clear();
        document.querySelectorAll('.file-item.selected').forEach(item => {
          item.classList.remove('selected');
        });
        
        // Clear all multi-edit form fields
        clearMultiEditFormFields();
        
        // Refresh the tag dropdown options
        populateTagSelect('multi-tag-select', 'multi-tags');
        
        updateSelectedCount(); // Update the count display
        
        console.log('Selection cleared');
      }
    });
    console.log('Clear Selection button event listener attached');
  } else {
    console.error('Clear Selection button not found');
  }
});

// ==================== NEW CODE: Virtual Grid Implementation ====================

// Helper function to create a DOM element for a model item
function createModelItem(model, viewMode = null) {
  const view = viewMode || currentGridView;
  const item = document.createElement('div');
  item.className = `file-item file-item-${view}`;
  item.dataset.filepath = model.filePath;

  if (selectedModels.has(model.filePath)) {
    item.classList.add('selected');
  }

  // Print status element
  const printStatus = document.createElement('div');
  printStatus.className = 'print-status' + (model.printed ? ' printed' : '');
  printStatus.textContent = model.printed ? 'Printed' : 'Not Printed';
  printStatus.style.cursor = 'pointer';
  printStatus.title = 'Click to toggle printed status';
  
  // Add click handler to toggle printed status
  printStatus.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent triggering file item click
    
    // Get current model state to ensure we have the latest printed status
    const currentModel = await window.electron.getModel(model.filePath);
    if (currentModel) {
      const newPrintedStatus = !currentModel.printed;
      await autoSaveModel('printed', newPrintedStatus, model.filePath);
    }
  });
  
  item.appendChild(printStatus);

  // Archive status element (for models inside ZIP archives)
  const isZipEntry = model.filePath && model.filePath.includes('::');
  let archiveStatus = null;
  if (isZipEntry) {
    archiveStatus = document.createElement('div');
    archiveStatus.className = 'archive-status';
    archiveStatus.textContent = 'Archive';
    item.appendChild(archiveStatus);
  }

  // Define thumbnail sizes based on view mode (optimized)
  const thumbnailSizes = {
    'list': { width: '48px', height: '48px' },      // Slightly larger for better visibility
    'preview': { width: '140px', height: '140px' }, // Preview thumbnail size
    'detailed': { width: '276px', height: '276px' }  // Optimized large thumbnail
  };
  
  const thumbSize = thumbnailSizes[view] || thumbnailSizes['detailed'];
  
  // Thumbnail container with size based on view mode
  const thumbnailContainer = document.createElement('div');
  thumbnailContainer.className = 'thumbnail-container';

  // Parse thumbnails to check if multiple exist
  const parseThumbnails = (thumbnailString) => {
    if (!thumbnailString || thumbnailString === '3d.png' || !thumbnailString.includes('::')) {
      return [thumbnailString].filter(t => t && t !== '3d.png' && t.length > 0);
    }
    // Split and filter out invalid entries - only keep valid data URLs
    return thumbnailString.split('::').filter(t => {
      return t && typeof t === 'string' && t.length > 0 && t !== '3d.png' && t.startsWith('data:image');
    });
  };

  // Parse thumbnails from model.thumbnail
  // The model.thumbnail should contain all thumbnails separated by ::
  const thumbnailString = model.thumbnail;
  
  const allThumbnails = thumbnailString ? parseThumbnails(thumbnailString) : [];
  const hasMultipleThumbnails = allThumbnails.length > 1;
  const currentThumbnailIndex = 0; // Start with first thumbnail (default)
  const currentThumbnail = allThumbnails.length > 0 ? allThumbnails[currentThumbnailIndex] : null;
  
  // For detailed view, if we don't have multiple thumbnails in the model object,
  // try to fetch from database asynchronously (but don't block rendering)
  if (view === 'detailed' && !hasMultipleThumbnails && model.filePath) {
    window.electron.getAllThumbnails(model.filePath).then(allThumbs => {
      if (allThumbs && allThumbs.length > 1) {
        // Find the item and update it
        const item = document.querySelector(`[data-filepath="${model.filePath.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`);
        if (item) {
          const wrapper = item.querySelector('.thumbnail-wrapper');
          const container = item.querySelector('.thumbnail-container');
          if (container && !wrapper) {
            // Re-create with navigation - user can refresh to see navigation controls
          }
        }
      }
    }).catch(e => {
      // Silently fail - not critical
    });
  }

  // In detailed view with multiple thumbnails, wrap in navigation container
  let thumbnailWrapper = thumbnailContainer;
  if (view === 'detailed' && hasMultipleThumbnails) {
    thumbnailWrapper = document.createElement('div');
    thumbnailWrapper.className = 'thumbnail-wrapper';
    thumbnailWrapper.style.position = 'relative';
    thumbnailWrapper.style.width = thumbSize.width;
    thumbnailWrapper.style.height = thumbSize.height;
    
    // Store thumbnails and current index on the wrapper
    thumbnailWrapper.dataset.thumbnails = JSON.stringify(allThumbnails);
    thumbnailWrapper.dataset.currentIndex = currentThumbnailIndex;
    thumbnailWrapper.dataset.filePath = model.filePath;
    
    // Left navigation area
    const leftNav = document.createElement('div');
    leftNav.className = 'thumbnail-nav-left';
    leftNav.style.position = 'absolute';
    leftNav.style.left = '0';
    leftNav.style.top = '0';
    leftNav.style.width = '50%';
    leftNav.style.height = '100%';
    leftNav.style.cursor = 'pointer';
    leftNav.style.zIndex = '10';
    leftNav.title = 'Previous image';
    
    // Right navigation area
    const rightNav = document.createElement('div');
    rightNav.className = 'thumbnail-nav-right';
    rightNav.style.position = 'absolute';
    rightNav.style.right = '0';
    rightNav.style.top = '0';
    rightNav.style.width = '50%';
    rightNav.style.height = '100%';
    rightNav.style.cursor = 'pointer';
    rightNav.style.zIndex = '10';
    rightNav.title = 'Next image';
    
    // Navigation click handlers
    const navigateThumbnail = async (direction) => {
      const wrapper = thumbnailWrapper;
      const thumbnails = JSON.parse(wrapper.dataset.thumbnails);
      // Read current index from dataset - this should persist between clicks
      let currentIndex = parseInt(wrapper.dataset.currentIndex);
      if (isNaN(currentIndex)) {
        currentIndex = 0;
        wrapper.dataset.currentIndex = '0';
      }
      
      // Filter out any invalid thumbnails
      const validThumbnails = thumbnails.filter(t => t && typeof t === 'string' && t.length > 0 && t !== '3d.png');
      if (validThumbnails.length !== thumbnails.length) {
        wrapper.dataset.thumbnails = JSON.stringify(validThumbnails);
        // Update badge
        if (wrapper._updateBadge) {
          wrapper._updateBadge();
        } else {
          const badge = wrapper.querySelector('.thumbnail-count-badge');
          if (badge) {
            const currentIdx = parseInt(wrapper.dataset.currentIndex) || 0;
            badge.textContent = `${currentIdx + 1}/${validThumbnails.length}`;
            badge.title = `Image ${currentIdx + 1} of ${validThumbnails.length} - Click left/right to navigate`;
          }
        }
      }
      
      if (validThumbnails.length === 0) {
        return;
      }
      
      // Adjust currentIndex if it's out of bounds
      if (currentIndex >= validThumbnails.length) {
        currentIndex = 0;
      }
      
      // Calculate new index
      if (direction === 'prev') {
        currentIndex = (currentIndex - 1 + validThumbnails.length) % validThumbnails.length;
      } else {
        currentIndex = (currentIndex + 1) % validThumbnails.length;
      }
      
      // IMPORTANT: Update the dataset BEFORE doing anything else so it persists
      wrapper.dataset.currentIndex = currentIndex.toString();
      
      // Update badge to show current position
      if (wrapper._updateBadge) {
        wrapper._updateBadge();
      } else {
        const badge = wrapper.querySelector('.thumbnail-count-badge');
        if (badge) {
          badge.textContent = `${currentIndex + 1}/${validThumbnails.length}`;
          badge.title = `Image ${currentIndex + 1} of ${validThumbnails.length} - Click left/right to navigate`;
        }
      }
      
      const img = wrapper.querySelector('.thumbnail-container img');
      if (img) {
        const newSrc = validThumbnails[currentIndex];
        img.src = newSrc;
        
        // Debounced save - save the current thumbnail as default after user stops navigating
        // This ensures the last viewed image becomes the default for preview/list views
        // Clear any existing timeout
        if (wrapper._saveTimeout) {
          clearTimeout(wrapper._saveTimeout);
        }
        
        // Save after 2 seconds of no navigation
        wrapper._saveTimeout = setTimeout(async () => {
          try {
            const idxToSave = parseInt(wrapper.dataset.currentIndex) || 0;
            const thumbs = JSON.parse(wrapper.dataset.thumbnails);
            if (thumbs && thumbs.length > idxToSave && idxToSave >= 0) {
              await window.electron.setDefaultThumbnail(model.filePath, idxToSave);
              // Update the model in memory with the reordered thumbnails
              const updatedModel = await window.electron.getModel(model.filePath);
              if (updatedModel && updatedModel.thumbnail) {
                model.thumbnail = updatedModel.thumbnail;
                // Update the dataset with the new order (selected one moved to front)
                const reorderedThumbs = parseThumbnails(updatedModel.thumbnail);
                wrapper.dataset.thumbnails = JSON.stringify(reorderedThumbs);
                wrapper.dataset.currentIndex = '0'; // Reset to 0 since selected is now at front
                // Update badge after reordering
                if (wrapper._updateBadge) {
                  wrapper._updateBadge();
                } else {
                  const badge = wrapper.querySelector('.thumbnail-count-badge');
                  if (badge) {
                    badge.textContent = `1/${reorderedThumbs.length}`;
                    badge.title = `Image 1 of ${reorderedThumbs.length} - Click left/right to navigate`;
                  }
                }
              }
            }
          } catch (e) {
            console.error('Error saving default thumbnail:', e);
          }
        }, 2000); // 2 second delay
      }
    };
    
    leftNav.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateThumbnail('prev');
    });
    
    rightNav.addEventListener('click', (e) => {
      e.stopPropagation();
      navigateThumbnail('next');
    });
    
    thumbnailWrapper.appendChild(leftNav);
    thumbnailWrapper.appendChild(rightNav);
    
    // Add indicator badge showing number of images
    const badge = document.createElement('div');
    badge.className = 'thumbnail-count-badge';
    // Helper function to update badge text
    const updateBadgeText = () => {
      const currentIdx = parseInt(thumbnailWrapper.dataset.currentIndex) || 0;
      // Get current thumbnails from dataset (may have been filtered)
      const currentThumbs = JSON.parse(thumbnailWrapper.dataset.thumbnails || JSON.stringify(allThumbnails));
      const total = currentThumbs.length;
      badge.textContent = `${currentIdx + 1}/${total}`;
      badge.title = `Image ${currentIdx + 1} of ${total} - Click left/right to navigate`;
    };
    updateBadgeText();
    badge.style.position = 'absolute';
    badge.style.bottom = '8px';
    badge.style.right = '8px';
    badge.style.background = 'rgba(0, 0, 0, 0.7)';
    badge.style.color = '#fff';
    badge.style.padding = '4px 8px';
    badge.style.borderRadius = '12px';
    badge.style.fontSize = '12px';
    badge.style.fontWeight = 'bold';
    badge.style.zIndex = '11';
    badge.style.pointerEvents = 'none';
    // Store update function on wrapper for later use
    thumbnailWrapper._updateBadge = updateBadgeText;
    thumbnailWrapper.appendChild(badge);
    
  }

  if (currentThumbnail) {
    const img = document.createElement('img');
    img.src = currentThumbnail;
    img.style.width = thumbSize.width;
    img.style.height = thumbSize.height;
    thumbnailContainer.appendChild(img);
  } else {
    // Show placeholder/loading state
    const img = document.createElement('img');
    img.src = '3d.png';
    img.style.width = thumbSize.width;
    img.style.height = thumbSize.height;
    // Add loading class if needed
    thumbnailContainer.appendChild(img);

    // Queue thumbnail generation if not already pending
    if (!pendingThumbnails.has(model.filePath)) {
      pendingThumbnails.add(model.filePath);

      renderQueue.push({
        filePath: model.filePath,
        container: thumbnailContainer,
        resolve: async (thumbnail) => {
          // Remove from pending set first
          pendingThumbnails.delete(model.filePath);
          
          // Check if model already has multiple thumbnails (from 3MF images)
          // If so, don't overwrite with single thumbnail
          const existingThumbs = await window.electron.getAllThumbnails(model.filePath);
          if (existingThumbs && existingThumbs.length > 1) {
            // Update model in memory with existing thumbnails
            const modelData = await window.electron.getModel(model.filePath);
            if (modelData && modelData.thumbnail) {
              model.thumbnail = modelData.thumbnail;
            }
          } else {
            // Update model in memory
            model.thumbnail = thumbnail;
            // Save to database
            await window.electron.saveThumbnail(model.filePath, thumbnail);
          }

          // Try to update any visible instances of this file in the DOM
          try {
            // Find the file item by iterating through all file items
            // This avoids CSS escaping issues with special characters in file paths
            const allFileItems = document.querySelectorAll('.file-item');
            let fileItem = null;
            const normalizedModelPath = normalizePathForComparison(model.filePath);
            for (const item of allFileItems) {
              const itemPath = item.getAttribute('data-filepath') || item.dataset.filepath;
              const normalizedItemPath = normalizePathForComparison(itemPath);
              if (normalizedItemPath === normalizedModelPath) {
                fileItem = item;
                break;
              }
            }
            const visibleItem = fileItem ? fileItem.querySelector('.thumbnail-container') : null;
            if (visibleItem) {
               const img = document.createElement('img');
               img.src = thumbnail;
               img.style.width = thumbSize.width;
               img.style.height = thumbSize.height;
               visibleItem.innerHTML = '';
               visibleItem.appendChild(img);
            }
          } catch (e) {
            console.error('Error updating visible thumbnail:', e);
          }
        },
        reject: (error) => {
          console.error(`Failed to generate thumbnail for ${model.filePath}`, error);
          pendingThumbnails.delete(model.filePath);
        }
      });

      // Trigger queue processing
      processRenderQueue();
    }
  }

  // Append wrapper if it exists (detailed view with multiple thumbnails), otherwise append container directly
  if (thumbnailWrapper !== thumbnailContainer) {
    thumbnailWrapper.appendChild(thumbnailContainer);
    item.appendChild(thumbnailWrapper);
  } else {
    item.appendChild(thumbnailContainer);
  }

  // Get parent directory from file path (needed for list view)
  const getParentDirectory = (filePath) => {
    if (!filePath) return '';
    // Handle both Windows (\) and Unix (/) paths
    const lastSlash = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
    if (lastSlash <= 0) return '';
    // Get the parent directory path
    const parentPath = filePath.substring(0, lastSlash);
    // Extract just the parent folder name (last segment of the path)
    const parentFolderSlash = Math.max(parentPath.lastIndexOf('\\'), parentPath.lastIndexOf('/'));
    return parentFolderSlash >= 0 ? parentPath.substring(parentFolderSlash + 1) : parentPath;
  };
  const parentDir = getParentDirectory(model.filePath);

  // File info container - layout depends on view mode
  const fileInfo = document.createElement('div');
  fileInfo.className = 'file-info';

  // File name element
  const fileName = document.createElement('div');
  fileName.className = 'file-name';
  // Extract file name from path if fileName is not available
  // Handle zip entries (format: "zipPath::entryPath")
  let displayFileName = model.fileName;
  if (!displayFileName && model.filePath) {
    if (model.filePath.includes('::')) {
      // Zip entry: extract filename from entry path
      const entryPath = model.filePath.split('::')[1];
      displayFileName = entryPath.split(/[/\\]/).pop() || 'Unknown';
    } else {
      // Regular file: extract filename from path
      displayFileName = model.filePath.split(/[/\\]/).pop() || 'Unknown';
    }
  }
  if (!displayFileName) {
    displayFileName = 'Unknown';
  }
  fileName.textContent = displayFileName;
  
  // Check if model is a zip file (actual .zip file, not a file inside a zip)
  // Only check if it's NOT a zip entry (zip entries have :: in filePath)
  // Note: isZipEntry is already declared earlier in the function (line 7805)
  const isZipFile = !isZipEntry && (
    (model.filePath && model.filePath.toLowerCase().endsWith('.zip')) || 
    (displayFileName && displayFileName.toLowerCase().endsWith('.zip'))
  );
  
  // In detailed view, add file name directly after thumbnail, not in fileInfo
  // For other views, add it to fileInfo as before
  if (view === 'detailed') {
    // File name will be added after thumbnail in detailed view section
  } else {
    fileInfo.appendChild(fileName);
  }

  // File details container (directory, size, designer) - only show in detailed and list views
  const fileDetails = document.createElement('div');
  fileDetails.className = 'file-details';
  
  // In list view, show Windows File Explorer style - thin horizontal row with details
  if (view === 'list') {
    // Get status indicators that were already added to item - we'll move them to columns later
    // Note: These are added to item early in the function (lines 7099-7111), so they should be findable here
    const printStatusElement = item.querySelector('.print-status');
    const archiveStatusElement = item.querySelector('.archive-status');
    
    // List view: horizontal layout with tiny thumbnail on left, details on right
    item.style.display = 'flex';
    item.style.flexDirection = 'row';
    item.style.alignItems = 'center';
    item.style.gap = '12px';
    item.style.padding = '6px 12px';
    item.style.height = '52px';
    item.style.position = 'relative';
    thumbnailContainer.style.flexShrink = '0';
    thumbnailContainer.style.width = '48px';
    thumbnailContainer.style.height = '48px';
    thumbnailContainer.style.position = 'relative';
    fileInfo.style.flex = '1';
    fileInfo.style.display = 'flex';
    fileInfo.style.flexDirection = 'row';
    fileInfo.style.alignItems = 'center';
    fileInfo.style.gap = '15px';
    fileInfo.style.minWidth = '0';
    
    // File name column (fixed width - narrower)
    fileName.style.flexShrink = '0';
    fileName.style.width = '180px';
    fileName.style.overflow = 'hidden';
    fileName.style.textOverflow = 'ellipsis';
    fileName.style.whiteSpace = 'nowrap';
    fileName.style.fontSize = '13px';
    // Apply zip file styling (isZipFile was already calculated above)
    if (isZipFile) {
      fileName.classList.add('zip-file');
      fileName.style.setProperty('color', '#4ade80', 'important'); // Green for zip files
    } else {
      fileName.style.setProperty('color', '#fff', 'important'); // White for non-zip files
    }
    
    // File size column (fixed width, center-aligned)
    const sizeColumn = document.createElement('div');
    sizeColumn.className = 'file-size-column';
    sizeColumn.style.display = 'flex';
    sizeColumn.style.alignItems = 'center';
    sizeColumn.style.flexShrink = '0';
    sizeColumn.style.width = '90px';
    sizeColumn.style.justifyContent = 'center';
    if (model.size) {
      const sizeText = document.createElement('span');
      sizeText.textContent = formatFileSize(model.size);
      sizeText.style.fontSize = '12px';
      sizeText.style.color = '#aaa';
      sizeText.style.fontFamily = 'monospace';
      sizeColumn.appendChild(sizeText);
    }
    fileInfo.appendChild(sizeColumn);
    
    // Parent directory column (fixed width, clickable to filter, with icon)
    const directoryColumn = document.createElement('div');
    directoryColumn.className = 'directory-info-column';
    directoryColumn.style.display = 'flex';
    directoryColumn.style.alignItems = 'center';
    directoryColumn.style.flexShrink = '0';
    directoryColumn.style.width = '180px';
    directoryColumn.style.overflow = 'hidden';
    
    // Add folder icon or archive icon based on whether model is in zip archive
    const parentIcon = isZipEntry 
      ? createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#22c55e"><path d="M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"/></svg>', 16)
      : createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#e3e3e3"><path d="M160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80h640v-400H447l-80-80H160v480Zm0 0v-480 480Z"/></svg>', 16);
    directoryColumn.appendChild(parentIcon);
    
    const directoryText = document.createElement('span');
    directoryText.className = 'directory-info';
    directoryText.textContent = parentDir || '';
    directoryText.style.fontSize = '12px';
    directoryText.style.color = parentDir ? '#4a9eff' : '#888';
    directoryText.style.overflow = 'hidden';
    directoryText.style.textOverflow = 'ellipsis';
    directoryText.style.whiteSpace = 'nowrap';
    directoryText.style.cursor = parentDir ? 'pointer' : 'default';
    directoryText.style.fontWeight = parentDir ? '500' : '400';
    directoryText.style.flex = '1';
    directoryText.style.minWidth = '0';
    
    // Add click handler to filter by directory
    if (parentDir) {
      directoryColumn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Extract the full path up to the parent directory for filtering
        let directoryFilterPath;
        if (model.filePath && model.filePath.includes('::')) {
          // For zip entries, use the zip path up to the parent directory
          const [zipPath, entryPath] = model.filePath.split('::');
          const entryParentPath = entryPath.split(/[/\\]/).slice(0, -1).join('/');
          directoryFilterPath = entryParentPath ? `${zipPath}::${entryParentPath}` : zipPath;
        } else {
          // For regular files, get the full path up to the parent directory
          // Make sure we're getting the directory, not the file itself
          const lastSlash = Math.max(model.filePath.lastIndexOf('\\'), model.filePath.lastIndexOf('/'));
          if (lastSlash > 0) {
            directoryFilterPath = model.filePath.substring(0, lastSlash);
            // Ensure we have a valid directory path (not a file path)
            if (!directoryFilterPath || directoryFilterPath.endsWith('.zip') || directoryFilterPath.endsWith('.stl') || directoryFilterPath.endsWith('.3mf')) {
              // If somehow we got a file path, extract the parent directory again
              const parentSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
              directoryFilterPath = parentSlash > 0 ? directoryFilterPath.substring(0, parentSlash) : '';
            }
          } else {
            directoryFilterPath = '';
          }
        }
        
        // Validate that we have a directory path, not a file path
        // Check for common file extensions (case-insensitive)
        const lowerPath = directoryFilterPath.toLowerCase();
        if (directoryFilterPath && (lowerPath.endsWith('.zip') || lowerPath.endsWith('.stl') || lowerPath.endsWith('.3mf') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.ply'))) {
          console.warn('Directory filter appears to be a file path, extracting parent directory:', directoryFilterPath);
          const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
          directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
        }
        
        // Final validation: ensure we don't have a file path
        if (directoryFilterPath && directoryFilterPath === model.filePath) {
          console.error('Directory filter is same as file path, this should not happen. File path:', model.filePath);
          const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
          directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
        }
        
        console.log('Setting directory filter to:', directoryFilterPath, 'from file path:', model.filePath);
        
        // Set the global directory filter with the full path
        window.currentDirectoryFilter = directoryFilterPath;
        // Trigger combined search to apply filter
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
      });
      directoryColumn.style.cursor = 'pointer';
      // Add hover effect
      directoryColumn.addEventListener('mouseenter', () => {
        directoryText.style.textDecoration = 'underline';
        directoryText.style.color = '#6bb3ff';
      });
      directoryColumn.addEventListener('mouseleave', () => {
        directoryText.style.textDecoration = 'none';
        directoryText.style.color = '#4a9eff';
      });
    }
    directoryColumn.appendChild(directoryText);
    fileInfo.appendChild(directoryColumn);
    
    // Designer column (with icon)
    const designerColumn = document.createElement('div');
    designerColumn.className = 'designer-info-column';
    designerColumn.style.display = 'flex';
    designerColumn.style.alignItems = 'center';
    designerColumn.style.flexShrink = '0';
    designerColumn.style.width = '180px';
    designerColumn.style.overflow = 'hidden';
    
    // Add designer icon
    const designerIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#a855f7"><path d="m352-522 86-87-56-57-44 44-56-56 43-44-45-45-87 87 159 158Zm328 329 87-87-45-45-44 43-56-56 43-44-57-56-86 86 158 159Zm24-567 57 57-57-57ZM290-120H120v-170l175-175L80-680l200-200 216 216 151-152q12-12 27-18t31-6q16 0 31 6t27 18l53 54q12 12 18 27t6 31q0 16-6 30.5T816-647L665-495l215 215L680-80 465-295 290-120Zm-90-80h56l392-391-57-57-391 392v56Zm420-419-29-29 57 57-28-28Z"/></svg>', 16);
    designerColumn.appendChild(designerIcon);
    
    const designerText = document.createElement('span');
    designerText.className = 'designer-info';
    designerText.textContent = model.designer || '';
    designerText.style.fontSize = '12px';
    designerText.style.color = model.designer ? '#aaa' : '#666';
    designerText.style.overflow = 'hidden';
    designerText.style.textOverflow = 'ellipsis';
    designerText.style.whiteSpace = 'nowrap';
    designerText.style.flex = '1';
    designerText.style.minWidth = '0';
    designerColumn.appendChild(designerText);
    fileInfo.appendChild(designerColumn);
    
    // Printed column (status badge only, no icon)
    const printStatusColumn = document.createElement('div');
    printStatusColumn.className = 'print-status-column';
    printStatusColumn.style.display = 'flex';
    printStatusColumn.style.alignItems = 'center';
    printStatusColumn.style.justifyContent = 'center';
    printStatusColumn.style.flexShrink = '0';
    printStatusColumn.style.width = '120px';
    
    if (printStatusElement) {
      // Remove all positioning styles and move to column
      printStatusElement.style.position = 'static';
      printStatusElement.style.top = 'auto';
      printStatusElement.style.right = 'auto';
      printStatusElement.style.left = 'auto';
      printStatusElement.style.fontSize = '11px';
      printStatusElement.style.padding = '2px 6px';
      printStatusElement.style.borderRadius = '3px';
      printStatusElement.style.display = 'inline-block';
      printStatusElement.style.zIndex = 'auto';
      printStatusElement.style.margin = '0';
      // Move the print status from item to the column (appendChild automatically removes from old parent)
      printStatusColumn.appendChild(printStatusElement);
    }
    fileInfo.appendChild(printStatusColumn);
    
    // Tags column
    const tagsColumn = document.createElement('div');
    tagsColumn.className = 'tags-info-column';
    tagsColumn.style.display = 'flex';
    tagsColumn.style.alignItems = 'center';
    tagsColumn.style.flexShrink = '0';
    tagsColumn.style.width = '200px';
    tagsColumn.style.overflow = 'hidden';
    
    // Get tags from model
    let tagsDisplay = '';
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      const tagNames = model.tags.map(t => t.name || t);
      tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      tagsDisplay = tagNames.join(', ');
    } else if (model.id) {
      // Load tags asynchronously if not present
      window.electron.getModelTags(model.id).then(tags => {
        if (tags && tags.length > 0) {
          const tagNames = tags.map(t => t.name || t);
          tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
          const tagsText = tagNames.join(', ');
          const tagsSpan = tagsColumn.querySelector('.tags-info');
          if (tagsSpan) {
            tagsSpan.textContent = tagsText;
            tagsSpan.setAttribute('title', tagsText); // Show full tag list on hover
            tagsSpan.style.color = '#aaa';
          }
        } else {
          const tagsSpan = tagsColumn.querySelector('.tags-info');
          if (tagsSpan) {
            tagsSpan.textContent = '—';
            tagsSpan.style.color = '#666';
          }
        }
      }).catch(err => console.error('Error loading tags:', err));
    }
    
    const tagsSpan = document.createElement('span');
    tagsSpan.className = 'tags-info';
    tagsSpan.textContent = tagsDisplay || '—';
    if (tagsDisplay) {
      tagsSpan.setAttribute('title', tagsDisplay); // Show full tag list on hover
    }
    tagsSpan.style.fontSize = '12px';
    tagsSpan.style.color = tagsDisplay ? '#aaa' : '#666';
    tagsSpan.style.overflow = 'hidden';
    tagsSpan.style.textOverflow = 'ellipsis';
    tagsSpan.style.whiteSpace = 'nowrap';
    tagsColumn.appendChild(tagsSpan);
    fileInfo.appendChild(tagsColumn);
    
    // Archive column (with icon, only show for files in zip/archive)
    const archiveStatusColumn = document.createElement('div');
    archiveStatusColumn.className = 'archive-status-column';
    archiveStatusColumn.style.display = 'flex';
    archiveStatusColumn.style.alignItems = 'center';
    archiveStatusColumn.style.justifyContent = 'center';
    archiveStatusColumn.style.gap = '6px';
    archiveStatusColumn.style.flexShrink = '0';
    archiveStatusColumn.style.width = '120px';
    
    // Only show archive icon and status for files in zip/archive
    if (isZipEntry) {
      // Add archive icon
      const archiveIcon = createSVGIcon('<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="#e3e3e3"><path d="M640-480v-80h80v80h-80Zm0 80h-80v-80h80v80Zm0 80v-80h80v80h-80ZM447-640l-80-80H160v480h400v-80h80v80h160v-400H640v80h-80v-80H447ZM160-160q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v400q0 33-23.5 56.5T800-160H160Zm0-80v-480 480Z"/></svg>', 16);
      archiveStatusColumn.appendChild(archiveIcon);
      
      if (archiveStatusElement) {
        // Remove all positioning styles and move to column
        archiveStatusElement.style.position = 'static';
        archiveStatusElement.style.top = 'auto';
        archiveStatusElement.style.right = 'auto';
        archiveStatusElement.style.left = 'auto';
        archiveStatusElement.style.fontSize = '11px';
        archiveStatusElement.style.padding = '2px 6px';
        archiveStatusElement.style.borderRadius = '3px';
        archiveStatusElement.style.display = 'inline-block';
        archiveStatusElement.style.zIndex = 'auto';
        archiveStatusElement.style.margin = '0';
        // Move the archive status from item to the column (appendChild automatically removes from old parent)
        archiveStatusColumn.appendChild(archiveStatusElement);
      } else {
        // Create archive status if it doesn't exist (shouldn't happen, but just in case)
        const archiveStatusText = document.createElement('span');
        archiveStatusText.textContent = 'Archive';
        archiveStatusText.style.fontSize = '11px';
        archiveStatusText.style.color = '#fff';
        archiveStatusText.style.padding = '2px 6px';
        archiveStatusText.style.borderRadius = '3px';
        archiveStatusText.style.background = 'rgba(255, 152, 0, 0.9)';
        archiveStatusColumn.appendChild(archiveStatusText);
      }
    }
    fileInfo.appendChild(archiveStatusColumn);
    
    item.appendChild(fileInfo);
    
    // Add click event handler for model selection
    item.addEventListener('click', (e) => {
      // Check if ctrl or cmd key is pressed for multi-select
      if (e.ctrlKey || e.metaKey) {
        handleFileClick(e, model.filePath);
      } else {
        toggleModelSelection(item, model.filePath);
      }
    });
    
    // Add context menu handler for list view - works on entire element
    addContextMenuHandler(item, model.filePath);
    
    return item;
  }
  
  // For preview view (formerly small), show thumbnail and filename only
  if (view === 'preview') {
    // Optimized small view layout
    item.style.width = '180px';
    item.style.padding = '10px';
    item.style.boxSizing = 'border-box';
    
    // Show filename below thumbnail
    fileName.style.fontSize = '11px';
    fileName.style.marginTop = '10px';
    fileName.style.textAlign = 'center';
    fileName.style.padding = '0 4px';
    fileName.style.lineHeight = '1.3';
    fileName.style.maxHeight = '32px';
    fileName.style.overflow = 'hidden';
    fileName.style.textOverflow = 'ellipsis';
    fileName.style.display = '-webkit-box';
    fileName.style.webkitLineClamp = '2';
    fileName.style.webkitBoxOrient = 'vertical';
    item.appendChild(fileInfo);
    
    // Add click event handler for model selection
    item.addEventListener('click', (e) => {
      // Check if ctrl or cmd key is pressed for multi-select
      if (e.ctrlKey || e.metaKey) {
        handleFileClick(e, model.filePath);
      } else {
        toggleModelSelection(item, model.filePath);
      }
    });
    
    // Add context menu handler for preview view
    addContextMenuHandler(item, model.filePath);
    
    return item;
  }
  
  // Create metadata items container
  const metadataContainer = document.createElement('div');
  metadataContainer.className = 'metadata-container';
  
  // Only add metadata in detailed view
  if (view === 'detailed') {
    // Optimized detailed view - more compact dimensions
    // Reduced height and padding for better space utilization
    item.style.width = '300px';
    item.style.height = '450px'; // Reduced from 540px
    item.style.minHeight = '450px';
    item.style.maxHeight = '450px';
    item.style.padding = '10px'; // Reduced from 12px
    item.style.boxSizing = 'border-box';
    item.style.display = 'flex';
    item.style.flexDirection = 'column';
    
    // Slightly smaller thumbnail to give more room for metadata
    thumbnailContainer.style.width = '276px'; // Reduced from 276px (actually same, but adjusted for padding)
    thumbnailContainer.style.height = '276px'; // Reduced from 276px
    thumbnailContainer.style.flexShrink = '0';
    
    // Add file name directly after thumbnail (in the red square area)
    if (fileName && fileName.textContent) {
      fileName.style.display = 'block';
      fileName.style.fontSize = '13px';
      fileName.style.fontWeight = '500';
      fileName.style.color = '#fff';
      fileName.style.marginTop = '8px'; // Reduced from 10px
      fileName.style.marginBottom = '8px'; // Reduced from 10px
      fileName.style.padding = '5px 8px'; // Reduced from 6px
      fileName.style.textAlign = 'center';
      fileName.style.whiteSpace = 'nowrap';
      fileName.style.overflow = 'hidden';
      fileName.style.textOverflow = 'ellipsis';
      fileName.style.width = '100%';
      fileName.style.boxSizing = 'border-box';
      fileName.style.minHeight = '28px';
      fileName.style.lineHeight = '1.4';
      fileName.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
      fileName.style.borderRadius = '4px';
      fileName.style.flexShrink = '0';
      // Insert file name right after thumbnail container
      const nextSibling = thumbnailContainer.nextSibling;
      if (nextSibling) {
        item.insertBefore(fileName, nextSibling);
      } else {
        item.appendChild(fileName);
      }
    }
    
    // Ensure file info container only takes the space it needs
    fileInfo.style.minHeight = '0';
    fileInfo.style.flex = '0 0 auto'; // Don't grow, don't shrink, auto size - prevents overflow
    fileInfo.style.display = 'flex';
    fileInfo.style.flexDirection = 'column';
    fileInfo.style.justifyContent = 'flex-start';
    fileInfo.style.gap = '4px'; // Slightly increased for better spacing
    fileInfo.style.overflow = 'hidden';
    fileInfo.style.padding = '0'; // Remove all padding
    fileInfo.style.margin = '0'; // Remove all margin
    
    // Enable two-column grid layout for metadata
    metadataContainer.style.display = 'grid';
    metadataContainer.style.gridTemplateColumns = '1fr 1fr';
    metadataContainer.style.gap = '2px 8px';
    metadataContainer.style.padding = '0';
    
    // Add directory and size on the same row - directory on left, size on right
    if (parentDir || model.size) {
      const dirSizeRow = document.createElement('div');
      dirSizeRow.className = 'metadata-item dir-size-row';
      dirSizeRow.style.gridColumn = '1 / -1'; // Span both columns
      dirSizeRow.style.display = 'flex';
      dirSizeRow.style.justifyContent = 'space-between';
      dirSizeRow.style.alignItems = 'center';
      dirSizeRow.style.gap = '8px';
      
      // Directory on the left
      if (parentDir) {
        const directoryPart = document.createElement('div');
        directoryPart.className = 'directory-part';
        directoryPart.style.display = 'flex';
        directoryPart.style.alignItems = 'center';
        directoryPart.style.gap = '6px';
        directoryPart.style.cursor = 'pointer';
        directoryPart.innerHTML = `
          <span class="metadata-icon">📁</span>
          <span class="metadata-value directory-link" title="${parentDir}">${parentDir}</span>
        `;
        directoryPart.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          // Hide any welcome or view library message
          const viewLibMsg = document.getElementById("view-library-message");
          if (viewLibMsg) { viewLibMsg.style.display = "none"; }
          
          // Extract the full path up to the parent directory for filtering
          let directoryFilterPath;
          if (model.filePath && model.filePath.includes('::')) {
            // For zip entries, use the zip path up to the parent directory
            const [zipPath, entryPath] = model.filePath.split('::');
            const entryParentPath = entryPath.split(/[/\\]/).slice(0, -1).join('/');
            directoryFilterPath = entryParentPath ? `${zipPath}::${entryParentPath}` : zipPath;
          } else {
            // For regular files, get the full path up to the parent directory
            // Make sure we're getting the directory, not the file itself
            const lastSlash = Math.max(model.filePath.lastIndexOf('\\'), model.filePath.lastIndexOf('/'));
            if (lastSlash > 0) {
              directoryFilterPath = model.filePath.substring(0, lastSlash);
              // Ensure we have a valid directory path (not a file path)
              if (!directoryFilterPath || directoryFilterPath.endsWith('.zip') || directoryFilterPath.endsWith('.stl') || directoryFilterPath.endsWith('.3mf')) {
                // If somehow we got a file path, extract the parent directory again
                const parentSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
                directoryFilterPath = parentSlash > 0 ? directoryFilterPath.substring(0, parentSlash) : '';
              }
            } else {
              directoryFilterPath = '';
            }
          }
          
          // Validate that we have a directory path, not a file path
          // Check for common file extensions (case-insensitive)
          const lowerPath = directoryFilterPath.toLowerCase();
          if (directoryFilterPath && (lowerPath.endsWith('.zip') || lowerPath.endsWith('.stl') || lowerPath.endsWith('.3mf') || lowerPath.endsWith('.obj') || lowerPath.endsWith('.ply'))) {
            console.warn('Directory filter appears to be a file path, extracting parent directory:', directoryFilterPath);
            const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
            directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
          }
          
          // Final validation: ensure we don't have a file path
          if (directoryFilterPath && directoryFilterPath === model.filePath) {
            console.error('Directory filter is same as file path, this should not happen. File path:', model.filePath);
            const lastSlash = Math.max(directoryFilterPath.lastIndexOf('\\'), directoryFilterPath.lastIndexOf('/'));
            directoryFilterPath = lastSlash > 0 ? directoryFilterPath.substring(0, lastSlash) : '';
          }
          
          console.log('Setting directory filter to:', directoryFilterPath, 'from file path:', model.filePath);
          
          // Set the global directory filter with the full path
          window.currentDirectoryFilter = directoryFilterPath;
          
          // Instead of filtering just by directory here, trigger the combined search which applies all filters.
          await performCombinedSearch();
          
          // Update the filter indicator to show the active parent directory filter.
          const filterIndicator = document.getElementById('current-filter');
          filterIndicator.innerHTML = `
            Showing models in directory: ${parentDir}
            <button class="clear-filter-button">Clear Filter</button>
          `;
          filterIndicator.classList.add('visible');
          
          // Attach a click handler to clear the directory filter.
          filterIndicator.querySelector('.clear-filter-button')?.addEventListener('click', async () => {
            window.currentDirectoryFilter = "";
            filterIndicator.innerHTML = "";
            filterIndicator.classList.remove('visible');
            await performCombinedSearch();
          });
        });
        dirSizeRow.appendChild(directoryPart);
      }
      
      // Size on the right
      if (model.size) {
        const sizePart = document.createElement('div');
        sizePart.className = 'size-part';
        sizePart.style.display = 'flex';
        sizePart.style.alignItems = 'center';
        sizePart.style.gap = '6px';
        sizePart.style.marginLeft = 'auto'; // Push to the right
        sizePart.innerHTML = `
          <span class="metadata-icon">💾</span>
          <span class="metadata-value file-size">${formatFileSize(model.size)}</span>
        `;
        dirSizeRow.appendChild(sizePart);
      }
      
      metadataContainer.appendChild(dirSizeRow);
    }

    // Always check individual model data - don't rely on fieldAnalysis which may be stale
    // This ensures metadata shows up immediately when added to a model
    
    // Add designer with icon (only show if this model has designer data)
    const designerValue = (model.designer && model.designer.trim()) ? model.designer.trim() : '';
    const hasDesigner = designerValue && designerValue !== '';
    if (hasDesigner) {
      const designerItem = document.createElement('div');
      designerItem.className = 'metadata-item designer-item';
      designerItem.style.cursor = 'pointer';
      designerItem.classList.add('clickable-metadata');
      
      designerItem.innerHTML = `
        <span class="metadata-icon">👤</span>
        <span class="metadata-value designer-info" style="color: #ccc; display: inline-block;" title="${designerValue}">${designerValue}</span>
      `;
      
      // Add click handler to filter by designer
      designerItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the designer filter
        const designerSelect = document.getElementById('designer-select');
        if (designerSelect) {
          designerSelect.value = designerValue;
          // Trigger combined search to apply filter
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      });
      metadataContainer.appendChild(designerItem);
    }

    // Add source with icon (only show if this model has source data)
    const sourceValue = (model.source && model.source.trim()) ? model.source.trim() : '';
    if (sourceValue) {
      const sourceItem = document.createElement('div');
      sourceItem.className = 'metadata-item source-item';
      sourceItem.innerHTML = `
        <span class="metadata-icon">🔗</span>
        <span class="metadata-value source-info" style="color: #ccc" title="${sourceValue}">${sourceValue}</span>
      `;
      metadataContainer.appendChild(sourceItem);
    }

    // Add parent model with icon (only show if this model has parent model data)
    const parentValue = (model.parentModel && model.parentModel.trim()) ? model.parentModel.trim() : '';
    if (parentValue) {
      const parentItem = document.createElement('div');
      parentItem.className = 'metadata-item parent-item';
      parentItem.style.cursor = 'pointer';
      parentItem.classList.add('clickable-metadata');
      
      parentItem.innerHTML = `
        <span class="metadata-icon">📦</span>
        <span class="metadata-value parent-info" style="color: #ccc" title="${parentValue}">${parentValue}</span>
      `;
      
      // Add click handler to filter by parent model
      parentItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the parent model filter
        const parentSelect = document.getElementById('parent-select');
        if (parentSelect) {
          parentSelect.value = parentValue;
          // Trigger combined search to apply filter
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      });
      metadataContainer.appendChild(parentItem);
    }

    // Add license with icon (only show if this model has license data)
    const licenseValue = (model.license && model.license.trim()) ? model.license.trim() : '';
    if (licenseValue) {
      const licenseItem = document.createElement('div');
      licenseItem.className = 'metadata-item license-item';
      licenseItem.style.cursor = 'pointer';
      licenseItem.classList.add('clickable-metadata');
      
      licenseItem.innerHTML = `
        <span class="metadata-icon">📜</span>
        <span class="metadata-value license-info" style="color: #ccc" title="${licenseValue}">${licenseValue}</span>
      `;
      
      // Add click handler to filter by license
      licenseItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the license filter
        const licenseSelect = document.getElementById('license-select');
        if (licenseSelect) {
          licenseSelect.value = licenseValue;
          // Trigger combined search to apply filter
          if (typeof window.performCombinedSearch === 'function') {
            await window.performCombinedSearch();
          }
        }
      });
      metadataContainer.appendChild(licenseItem);
    }

    // Add tags with icon - always try to load tags in detailed view
    // (fieldAnalysis might not detect tags since getAllModels doesn't include them)
    let tagsDisplay = '';
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      // Handle both array of strings and array of objects with name property
      const tagNames = model.tags.map(t => (typeof t === 'string' ? t : (t.name || t)));
      tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      tagsDisplay = tagNames.join(', ');
    }
    
    // Always create tags item and load asynchronously if needed
    const tagsItem = document.createElement('div');
    tagsItem.className = 'metadata-item tags-item';
    tagsItem.style.gridColumn = '1 / -1'; // Span both columns like other metadata
    
    if (tagsDisplay) {
      // Tags already available, display them immediately
      tagsItem.innerHTML = `
        <span class="metadata-icon">🏷️</span>
        <span class="metadata-value tags-info" style="color: #ccc" title="${tagsDisplay}">${tagsDisplay}</span>
      `;
      metadataContainer.appendChild(tagsItem);
    } else {
      // Create item and load tags asynchronously
      tagsItem.innerHTML = `
        <span class="metadata-icon">🏷️</span>
        <span class="metadata-value tags-info" style="color: #666"></span>
      `;
      metadataContainer.appendChild(tagsItem);
      
      // Load tags asynchronously - get model ID first if needed
      const loadTags = async () => {
        try {
          let modelId = model.id;
          
          // If model.id doesn't exist, get the model from database using filePath
          if (!modelId && model.filePath) {
            const fullModel = await window.electron.getModel(model.filePath);
            if (fullModel && fullModel.id) {
              modelId = fullModel.id;
              // Also check if tags are already in the full model
              if (fullModel.tags && Array.isArray(fullModel.tags) && fullModel.tags.length > 0) {
                const tagNames = fullModel.tags.map(t => (typeof t === 'string' ? t : (t.name || t)));
                tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
                const tagsText = tagNames.join(', ');
                const tagsValueSpan = tagsItem.querySelector('.tags-info');
                if (tagsValueSpan) {
                  tagsValueSpan.textContent = tagsText;
                  tagsValueSpan.setAttribute('title', tagsText); // Show full tag list on hover
                  tagsValueSpan.style.color = '#ccc';
                }
                return;
              }
            }
          }
          
          // Load tags using model ID
          if (modelId) {
            const tags = await window.electron.getModelTags(modelId);
            if (tags && tags.length > 0) {
              const tagNames = tags.map(t => (typeof t === 'string' ? t : (t.name || t)));
              tagNames.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
              const tagsText = tagNames.join(', ');
              const tagsValueSpan = tagsItem.querySelector('.tags-info');
              if (tagsValueSpan) {
                tagsValueSpan.textContent = tagsText;
                tagsValueSpan.setAttribute('title', tagsText); // Show full tag list on hover
                tagsValueSpan.style.color = '#ccc';
              }
            } else {
              // Remove the tags item if no tags found
              tagsItem.remove();
            }
          } else {
            // Remove the tags item if we can't get model ID
            tagsItem.remove();
          }
        } catch (err) {
          console.error('Error loading tags:', err);
          // Remove the tags item on error
          tagsItem.remove();
        }
      };
      
      loadTags();
    }
    
    // Show file details in detailed view
    fileDetails.appendChild(metadataContainer);
    fileDetails.style.padding = '0'; // Remove all padding
    fileDetails.style.margin = '0'; // Remove all margin
    fileInfo.appendChild(fileDetails);
  }
  
  item.appendChild(fileInfo);

  // Add click event handler for model selection
  item.addEventListener('click', (e) => {
    // Check if ctrl or cmd key is pressed for multi-select
    if (e.ctrlKey || e.metaKey) {
      handleFileClick(e, model.filePath);
    } else {
      toggleModelSelection(item, model.filePath);
    }
  });

  // Add context menu
  addContextMenuHandler(item, model.filePath);

  return item;
}

// Analyze models to determine which metadata fields have data
function analyzeModelFields(models) {
  const fieldAnalysis = {
    hasDesigner: false,
    hasSource: false,
    hasParentModel: false,
    hasLicense: false,
    hasTags: false
  };
  
  if (!models || models.length === 0) {
    return fieldAnalysis;
  }
  
  for (const model of models) {
    if (model.designer && model.designer.trim()) {
      fieldAnalysis.hasDesigner = true;
    }
    if (model.source && model.source.trim()) {
      fieldAnalysis.hasSource = true;
    }
    if (model.parentModel && model.parentModel.trim()) {
      fieldAnalysis.hasParentModel = true;
    }
    if (model.license && model.license.trim()) {
      fieldAnalysis.hasLicense = true;
    }
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      fieldAnalysis.hasTags = true;
    }
    
    // If all fields are found, we can break early for performance
    if (fieldAnalysis.hasDesigner && fieldAnalysis.hasSource && 
        fieldAnalysis.hasParentModel && fieldAnalysis.hasLicense && fieldAnalysis.hasTags) {
      break;
    }
  }
  
  return fieldAnalysis;
}

// Virtual grid function—renders only items visible in the scroll window.
function renderVirtualGrid(models) {
  const container = document.querySelector('.file-grid');
  if (!container) return;
  
  // Prevent multiple simultaneous renders
  if (container.isRendering) {
    // Queue the render for later
    container.pendingModels = models;
    return;
  }
  container.isRendering = true;
  
  // Analyze which fields have data across all models
  window.modelFieldAnalysis = analyzeModelFields(models);

  // Store current models for comparison
  const currentModels = container.currentModels || [];
  // Check if the set of models changed (using sorted IDs)
  const currentModelIds = currentModels.map(m => m.id || m.filePath).sort();
  const newModelIds = models.map(m => m.id || m.filePath).sort();
  const modelsSetChanged = JSON.stringify(currentModelIds) !== JSON.stringify(newModelIds);
  
  // Check if the order of models changed (using unsorted IDs in sequence)
  const currentModelIdsOrdered = currentModels.map(m => m.id || m.filePath);
  const newModelIdsOrdered = models.map(m => m.id || m.filePath);
  const orderChanged = JSON.stringify(currentModelIdsOrdered) !== JSON.stringify(newModelIdsOrdered);
  
  // Models changed if either the set changed or the order changed
  const modelsChanged = modelsSetChanged || orderChanged;
  
  // Only clear if models actually changed
  if (modelsChanged) {
    container.innerHTML = ''; // clear existing content
    
    // Add header for list view
    if (currentGridView === 'list') {
      const header = createListViewHeader();
      container.appendChild(header);
    }
  }
  container.currentModels = models;
  
  // Check if grid structure already exists
  let spacer = container.querySelector('.virtual-spacer');
  let virtualContent = container.querySelector('.virtual-content');
  let listHeader = container.querySelector('.list-view-header');
  
  // Ensure header exists for list view (in case it was removed)
  if (currentGridView === 'list' && !listHeader) {
    const header = createListViewHeader();
    // Insert header before spacer or at the beginning
    if (spacer) {
      container.insertBefore(header, spacer);
    } else {
      container.appendChild(header);
    }
  }
  
  // Remove header if not in list view
  if (currentGridView !== 'list' && listHeader) {
    listHeader.remove();
  }
  
  // If grid structure exists and models haven't changed, just trigger re-render
  // But if order changed, we need to re-render even if the set is the same
  if (spacer && virtualContent && !modelsChanged) {
    container.isRendering = false;
    // Store renderVisibleItems function reference if it exists
    if (container.renderVisibleItemsFn) {
      container.renderVisibleItemsFn();
    }
    // Process any pending render
    if (container.pendingModels) {
      const pending = container.pendingModels;
      container.pendingModels = null;
      container.isRendering = false;
      renderVirtualGrid(pending);
    }
    return;
  }
  
  container.style.position = 'relative';
  container.style.overflowY = 'auto';
  container.style.overflowX = 'hidden';
  container.style.display = 'block'; // Override CSS grid display for virtual scrolling
  
  // Calculate proper height based on viewport, accounting for any headers/footers
  const containerRect = container.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const containerTop = containerRect.top;
  container.style.height = `calc(100vh - ${containerTop}px)`;
  container.style.maxHeight = `calc(100vh - ${containerTop}px)`;

  // Define item dimensions based on view mode
  const viewDimensions = {
    'list': { width: '100%', height: 52, itemWidth: '100%' },
    'preview': { width: 180, height: 220, itemWidth: 180 },
    'detailed': { width: 300, height: 450, itemWidth: 300 }
  };
  
  const dimensions = viewDimensions[currentGridView] || viewDimensions['detailed'];
  
  // Assume fixed item size (in pixels) - optimized gaps
  const paddingVertical = 10; // Grid top/bottom padding (small top padding to prevent menu overlap)
  const paddingHorizontal = 20; // Grid left/right padding
  // Different gaps for different views - optimized for better visual spacing
  let verticalGap, horizontalGap;
  if (currentGridView === 'list') {
    verticalGap = 4; // Slight padding between list items
    horizontalGap = 0;
  } else if (currentGridView === 'preview') {
    verticalGap = 24; // More vertical padding for preview thumbnails
    horizontalGap = 24; // More horizontal padding for preview thumbnails
  } else {
    // Detailed view: improved spacing for better visual hierarchy
    verticalGap = 28; // Better vertical spacing between rows with slight bottom padding
    horizontalGap = 20; // Consistent horizontal spacing
  }
  const itemWidth = dimensions.itemWidth;   // fixed model width
  const itemHeight = dimensions.height;  // fixed model height
  const itemHeightWithGap = itemHeight + verticalGap; // Total height including gap
  const containerWidth = container.clientWidth;

  // Calculate number of columns (at least 1), accounting for padding
  // For list view, always 1 column
  let columns, rowCount;
  if (currentGridView === 'list') {
    columns = 1;
    rowCount = models.length;
  } else if (currentGridView === 'preview') {
    // For small view, account for horizontal gap
    const availableWidth = containerWidth - (paddingHorizontal * 2);
    const itemWidthWithGap = itemWidth + horizontalGap;
    columns = Math.max(Math.floor(availableWidth / itemWidthWithGap), 1);
    rowCount = Math.ceil(models.length / columns);
  } else {
    // For detailed view, calculate columns and center the grid
    const availableWidth = containerWidth - (paddingHorizontal * 2);
    columns = Math.max(Math.floor(availableWidth / itemWidth), 1);
    rowCount = Math.ceil(models.length / columns);
    
    // Center the grid if we have fewer columns than would fill the width
    if (currentGridView === 'detailed') {
      const totalItemsWidth = columns * itemWidth;
      const totalGapsWidth = (columns - 1) * horizontalGap;
      const usedWidth = totalItemsWidth + totalGapsWidth;
      const leftOffset = (availableWidth - usedWidth) / 2;
      // Store offset for positioning items
      container._centeredOffset = leftOffset;
    } else {
      container._centeredOffset = 0;
    }
  }

  // Create a spacer element of full height to allow scrolling
  if (!spacer) {
    spacer = document.createElement('div');
    spacer.className = 'virtual-spacer';
    spacer.style.width = '100%';
    spacer.style.position = 'relative';
    container.appendChild(spacer);
  }
  // Calculate total height including gaps between rows
  // For list view, add header height (36px + 4px margin) to spacer
  const headerHeight = (currentGridView === 'list') ? 40 : 0;
  const totalHeight = (rowCount * itemHeight) + ((rowCount - 1) * verticalGap) + (paddingVertical * 2) + headerHeight;
  spacer.style.height = totalHeight + 'px';
  
  // Position spacer below header for list view
  if (currentGridView === 'list' && spacer) {
    spacer.style.marginTop = '0';
  }

  // Create an absolutely positioned element within the container to hold the items
  if (!virtualContent) {
    virtualContent = document.createElement('div');
    virtualContent.className = 'virtual-content';
    virtualContent.style.position = 'absolute';
    virtualContent.style.left = '0';
    virtualContent.style.width = '100%';
    virtualContent.style.height = '100%';
    virtualContent.style.pointerEvents = 'none'; // Let clicks pass through to items
    container.appendChild(virtualContent);
  }
  
  // Adjust virtual content top position for list view header (always update, not just on creation)
  if (currentGridView === 'list') {
    virtualContent.style.top = '40px'; // Header height (36px + 4px margin)
  } else {
    virtualContent.style.top = '0';
  }

  // Store the resize observer to disconnect later if needed
  if (container.resizeObserver) {
    container.resizeObserver.disconnect();
  }

  // Throttle render function to prevent excessive re-renders
  let renderTimeout = null;
  let isRendering = false;
  
  // Function to (re)render only the visible rows (plus a small buffer)
  function renderVisibleItems() {
    // Cancel any pending render
    if (renderTimeout) {
      cancelAnimationFrame(renderTimeout);
    }
    
    // Skip if already rendering
    if (isRendering) return;
    
    // Use currentModels from container to ensure we have the latest data
    // This is critical for showing updated metadata after edits
    const currentModels = container.currentModels || models;
    
    // Recalculate values each time to ensure we use current view settings
    let currentVerticalGap, currentHorizontalGap;
    if (currentGridView === 'list') {
      currentVerticalGap = 4;
      currentHorizontalGap = 0;
    } else if (currentGridView === 'preview') {
      currentVerticalGap = 24;
      currentHorizontalGap = 24;
    } else {
      // Detailed view: gap between rows
      currentVerticalGap = 20;
      currentHorizontalGap = 20;
    }
    
    // Use requestAnimationFrame for smooth updates
    renderTimeout = requestAnimationFrame(() => {
      isRendering = true;
      
      try {
        const scrollTop = container.scrollTop;
        const containerHeight = container.clientHeight;

        // Recalculate columns in case of resize
        const currentContainerWidth = container.clientWidth;
        let currentColumns, currentRowCount;
        if (currentGridView === 'list') {
          currentColumns = 1;
          currentRowCount = currentModels.length;
        } else if (currentGridView === 'preview') {
          // For small view, account for horizontal gap
          const currentAvailableWidth = currentContainerWidth - (paddingHorizontal * 2);
          const itemWidthWithGap = itemWidth + currentHorizontalGap;
          currentColumns = Math.max(Math.floor(currentAvailableWidth / itemWidthWithGap), 1);
          currentRowCount = Math.ceil(currentModels.length / currentColumns);
        } else {
          const currentAvailableWidth = currentContainerWidth - (paddingHorizontal * 2);
          currentColumns = Math.max(Math.floor(currentAvailableWidth / itemWidth), 1);
          currentRowCount = Math.ceil(currentModels.length / currentColumns);
          
          // Center the grid for detailed view
          if (currentGridView === 'detailed') {
            const totalItemsWidth = currentColumns * itemWidth;
            const totalGapsWidth = (currentColumns - 1) * currentHorizontalGap;
            const usedWidth = totalItemsWidth + totalGapsWidth;
            const leftOffset = (currentAvailableWidth - usedWidth) / 2;
            container._centeredOffset = leftOffset;
          } else {
            container._centeredOffset = 0;
          }
        }

        // Update spacer height
        let currentTotalHeight;
        currentTotalHeight = (currentRowCount * itemHeight) + ((currentRowCount - 1) * currentVerticalGap) + (paddingVertical * 2);
        spacer.style.height = currentTotalHeight + 'px';

        const buffer = 2; // extra rows to render before and after the visible area
        // Account for vertical gap when calculating visible rows
        const rowHeightWithGap = itemHeight + currentVerticalGap;
        const startRow = Math.max(0, Math.floor(scrollTop / rowHeightWithGap) - buffer);
        const endRow = Math.min(currentRowCount, Math.ceil((scrollTop + containerHeight) / rowHeightWithGap) + buffer);

        // Track which items should be visible
        const visibleIndices = new Set();
        for (let row = startRow; row < endRow; row++) {
          for (let col = 0; col < currentColumns; col++) {
            const index = row * currentColumns + col;
            if (index < currentModels.length) {
              visibleIndices.add(index);
            }
          }
        }

        // Remove items that are no longer visible
        const existingItems = Array.from(virtualContent.children);
        existingItems.forEach(item => {
          const itemIndex = parseInt(item.dataset.index || '-1');
          if (itemIndex === -1 || !visibleIndices.has(itemIndex)) {
            item.remove();
          }
        });

        // Add or update visible items
        for (let row = startRow; row < endRow; row++) {
          for (let col = 0; col < currentColumns; col++) {
            const index = row * currentColumns + col;
            if (index >= currentModels.length) break;

            // Get the model for this index - use currentModels to get fresh data
            const model = currentModels[index];

            // Check if item already exists
            const existingItem = virtualContent.querySelector(`[data-index="${index}"]`);
            if (existingItem) {
              // Verify that the existing item matches the model that should be at this index
              // This handles cases where the order changed but wasn't detected
              const existingFilePath = existingItem.getAttribute('data-filepath');
              const expectedFilePath = model.filePath;
              const normalizedExistingPath = normalizePathForComparison(existingFilePath);
              const normalizedExpectedPath = normalizePathForComparison(expectedFilePath);
              if (normalizedExistingPath !== normalizedExpectedPath) {
                // Model at this index has changed, remove old item and create new one
                existingItem.remove();
              } else {
                // Item matches, just update position if needed (in case of resize)
                // Calculate top position
                let topPosition;
                topPosition = paddingVertical + (row * itemHeight) + (row * currentVerticalGap);
                
                existingItem.style.top = topPosition + 'px';
                if (currentGridView === 'list') {
                  existingItem.style.left = paddingHorizontal + 'px';
                  existingItem.style.width = `calc(100% - ${paddingHorizontal * 2}px)`;
                } else if (currentGridView === 'preview') {
                  // Account for horizontal gap in preview view
                  const leftPosition = (col * (itemWidth + currentHorizontalGap)) + paddingHorizontal;
                  existingItem.style.left = leftPosition + 'px';
                  existingItem.style.width = typeof itemWidth === 'number' ? itemWidth + 'px' : itemWidth;
                } else {
                  // For detailed view, center the grid with proper spacing
                  const centeredOffset = container._centeredOffset || 0;
                  const leftPosition = (col * (itemWidth + currentHorizontalGap)) + paddingHorizontal + centeredOffset;
                  existingItem.style.left = leftPosition + 'px';
                  existingItem.style.width = typeof itemWidth === 'number' ? itemWidth + 'px' : itemWidth;
                }
                continue;
              }
            }

            // Create new item
            const item = createModelItem(model, currentGridView);
            item.dataset.index = index;
            item.style.position = 'absolute';
            // Calculate top position
            let topPosition;
            // Note: Header offset is handled by virtualContent top position for list view
            topPosition = paddingVertical + (row * itemHeight) + (row * currentVerticalGap);
            
            item.style.top = topPosition + 'px';
            if (currentGridView === 'list') {
              item.style.left = paddingHorizontal + 'px';
              item.style.width = `calc(100% - ${paddingHorizontal * 2}px)`;
            } else if (currentGridView === 'preview') {
              // Account for horizontal gap in preview view
              const leftPosition = (col * (itemWidth + currentHorizontalGap)) + paddingHorizontal;
              item.style.left = leftPosition + 'px';
              item.style.width = typeof itemWidth === 'number' ? itemWidth + 'px' : itemWidth;
            } else {
              // For detailed view, center the grid with proper spacing
              const centeredOffset = container._centeredOffset || 0;
              const leftPosition = (col * (itemWidth + currentHorizontalGap)) + paddingHorizontal + centeredOffset;
              item.style.left = leftPosition + 'px';
              item.style.width = typeof itemWidth === 'number' ? itemWidth + 'px' : itemWidth;
            }
            item.style.pointerEvents = 'auto'; // Re-enable pointer events for items

            virtualContent.appendChild(item);
          }
        }
      } finally {
        isRendering = false;
        renderTimeout = null;
      }
    });


  }

  // Throttled scroll handler to prevent excessive renders
  let scrollTimeout = null;
  function throttledScrollHandler() {
    if (scrollTimeout) return;
    scrollTimeout = requestAnimationFrame(() => {
      renderVisibleItems();
      scrollTimeout = null;
    });
  }
  
  // Attach the scroll event handler to update visible items on scroll
  container.removeEventListener('scroll', container.virtualScrollHandler);
  container.virtualScrollHandler = throttledScrollHandler;
  container.addEventListener('scroll', throttledScrollHandler, { passive: true });

  // Throttled resize handler
  let resizeTimeout = null;
  function throttledResizeHandler() {
    if (resizeTimeout) {
      cancelAnimationFrame(resizeTimeout);
    }
    resizeTimeout = requestAnimationFrame(() => {
      renderVisibleItems();
      resizeTimeout = null;
    });
  }
  
  // Handle window resize
  if (container.resizeObserver) {
    container.resizeObserver.disconnect();
  }
  container.resizeObserver = new ResizeObserver(throttledResizeHandler);
  container.resizeObserver.observe(container);

  // Store renderVisibleItems function reference for later use
  container.renderVisibleItemsFn = renderVisibleItems;
  
  // Mark rendering as complete
  container.isRendering = false;
  
  // Process any pending render
  if (container.pendingModels) {
    const pending = container.pendingModels;
    container.pendingModels = null;
    renderVirtualGrid(pending);
    return;
  }
  
  // Initial render of visible items
  renderVisibleItems();
}
// ==================== END NEW CODE ====================

// Change the multi-source event listener from 'change' back to 'input' with debounce
document.getElementById('multi-source')?.addEventListener('input', debounce(async (e) => {
  console.log(`Saving source value: "${e.target.value}"`);
  await autoSaveMultipleModels('source', e.target.value);
}, 500));


window.renderFiles = renderFiles;
window.displayModels = displayModels;
