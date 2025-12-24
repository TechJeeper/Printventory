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
const MAX_CONCURRENT_RENDERS = 1; // Reduce from 5 to 1 to prevent context loss

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
    
    // Properly encode the file path to handle special characters and Windows paths
    let encodedFilePath;
    
    // Check if we're running on Windows (starts with drive letter)
    if (/^[A-Za-z]:/.test(actualFilePath)) {
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
                      child.material = new THREE.MeshPhongMaterial({
                        color: 0xcccccc,
                        specular: 0x111111,
                        shininess: 200
                      });
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

// Add this new function to update individual model elements
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
    const designer = document.getElementById('designer-select').value;
    const license = document.getElementById('license-select').value; 
    const parentModel = document.getElementById('parent-select').value;
    const printStatus = document.getElementById('printed-select').value;
    
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

    // Escape the file path for use in querySelector
    const escapedPath = CSS.escape(filePath);
    
    // Find existing element using the escaped path
    const existingElement = document.querySelector(`.file-item[data-filepath="${escapedPath}"]`);
    if (!existingElement) {
      console.warn('updateModelElement: Element not found for path:', filePath);
      debugLog('Element not found for path:', filePath);
      return;
    }
    
    // Check if we're in detailed view
    const isDetailedView = existingElement.classList.contains('file-item-detailed');
    console.log('updateModelElement: isDetailedView?', isDetailedView);

    // If the model no longer matches the current filters, hide it
    if (!shouldBeVisible) {
      existingElement.style.display = 'none';
      
      // If in multi-select mode and the item is hidden due to filter, remove it from selection
      if (isMultiSelectMode && selectedModels.has(filePath)) {
        selectedModels.delete(filePath);
        existingElement.classList.remove('selected');
        // Update the selection count
        updateSelectedCount();
      }
      
      return;
    } else {
      existingElement.style.display = '';
    }

    // Update model details
    const nameElement = existingElement.querySelector('.file-name');
    if (nameElement) nameElement.textContent = model.fileName;

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
      existingElement.appendChild(statusElement);
    }
    
    // Remove any existing designer info elements that might have been added (redundant with metadata)
    // Designer is already shown in the metadata section, so we don't need it here
    const fileInfo = existingElement.querySelector('.file-info');
    if (fileInfo) {
      const existingDesignerElements = fileInfo.querySelectorAll('.designer-info');
      existingDesignerElements.forEach(el => el.remove());
    }
    
    // Update metadata in detailed view grid (only if in detailed view)
    const metadataContainer = existingElement.querySelector('.metadata-container');
    console.log('updateModelElement: metadataContainer found?', !!metadataContainer, 'isDetailedView?', isDetailedView, 'element classes:', existingElement.className);
    
    // Also check if the current view mode is detailed (in case class check fails)
    const currentViewIsDetailed = currentGridView === 'detailed';
    console.log('updateModelElement: currentGridView is detailed?', currentViewIsDetailed);
    
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
          console.log('updateModelElement: Updated source to', sourceValueSpan.textContent);
        }
      } else {
        console.warn('Source item not found in metadata container');
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
          tagsDisplay = model.tags.map(t => t.name || t).join(', ');
        } else if (model.id) {
          // Load tags asynchronously if not present
          window.electron.getModelTags(model.id).then(tags => {
            if (tags && tags.length > 0) {
              const tagsText = tags.map(t => t.name || t).join(', ');
              const tagsValueSpan = tagsItem.querySelector('.metadata-value.tags-info');
              if (tagsValueSpan) {
                tagsValueSpan.textContent = tagsText;
                tagsValueSpan.style.color = '#ccc';
              }
            }
          }).catch(err => console.error('Error loading tags:', err));
        }
        const tagsValueSpan = tagsItem.querySelector('.metadata-value.tags-info');
        if (tagsValueSpan) {
          tagsValueSpan.textContent = tagsDisplay || '—';
          tagsValueSpan.style.color = tagsDisplay ? '#ccc' : '#666';
        } else {
          console.warn('Tags value span not found in tags item');
        }
      }
    } else {
      console.warn('Metadata container not found for element:', existingElement);
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

  } catch (error) {
    console.error('Error updating model element:', error);
  }
}



// Move showModelDetails outside the DOMContentLoaded event listener
async function showModelDetails(filePath) {
  try {
    debugLog('Showing model details for:', filePath);
    const model = await window.electron.getModel(filePath);
    if (!model) return;

    // Get the details panel reference
    const detailsPanel = document.getElementById('model-details');
    if (!detailsPanel) {
      console.error('Model details panel not found');
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
        
        // *** ADDED DROPDOWN POPULATION LOGIC ***
        try {
          await populateModelDesignerDropdown(null, 'multi-designer');
          await populateModelLicenseDropdown(null, 'multi-license');
          await populateParentModelDropdown(null, 'multi-parent');
          await populateTagSelect('multi-tag-select', 'multi-tags');
        } catch (error) {
          console.error('Error populating multi-edit dropdowns:', error);
        }
        // ****************************************

        showMultiEditPanel(); // *** ADDED CALL TO ATTACH LISTENERS ***

        // Scroll the multi-edit panel into view
        multiEditPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Clear existing tags
    document.getElementById('model-tags').innerHTML = '';

    // First populate all dropdowns with available options
    await Promise.all([
      populateModelDesignerDropdown(model.designer),
      populateModelLicenseDropdown(model.license),
      populateParentModelDropdown(model.parentModel)
    ]);

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
        // Store the current value before cloning
        if (element.type === 'checkbox') {
          storedValues[id] = element.checked;
        } else {
          storedValues[id] = element.value;
        }
        
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

    // Set form values AFTER cloning (to ensure they're set on the new elements)
    // Use a small delay to ensure DOM is ready
    await new Promise(resolve => setTimeout(resolve, 10));
    
    document.getElementById('model-path').value = storedValues['model-path'];
    document.getElementById('model-name').value = storedValues['model-name'];
    
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

    // Load tags if they exist
    if (model.tags && Array.isArray(model.tags)) {
      model.tags.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      model.tags.forEach(tag => addTagToModel(tag, 'model-tags'));
    }

    // Show the details panel
    detailsPanel.classList.remove('hidden');

    // Hide multi-edit panel if it's open
    const multiEditPanel = document.getElementById('multi-edit-panel');
    multiEditPanel.classList.add('hidden');

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

// Add or update the loadDuplicateFiles function
async function loadDuplicateFiles() {
  try {
    // First check for models without file hash
    const modelsWithoutHashCount = await window.electron.getModelsWithoutHash();
    
    // If there are models without hash, ask the user if they want to generate hashes
    if (modelsWithoutHashCount > 0) {
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
        window.electron.onHashGenerationProgress((progress) => {
          const progressBar = document.getElementById('hash-progress');
          const progressText = document.getElementById('hash-progress-text');
          
          if (progressBar && progressText) {
            const percentage = (progress.processed / progress.total) * 100;
            progressBar.value = percentage;
            progressText.textContent = `${progress.processed}/${progress.total}`;
            
            // Close dialog when complete
            if (progress.processed >= progress.total) {
              setTimeout(() => {
                progressDialog.close();
                progressDialog.remove();
                
                // Reload duplicate files now that we have generated hashes
                loadDuplicateFiles();
              }, 500);
            }
          }
        });
        
        // Start hash generation
        await window.electron.generateMissingHashes();
        return; // Exit early - we'll reload when hash generation is complete
      }
    }
    
    // Load duplicates
    const duplicates = await window.electron.getDuplicates();
    const isGeneratingHashes = await window.electron.isGeneratingHashes();
    console.log('Loaded duplicates:', duplicates);
    console.log('Is generating hashes:', isGeneratingHashes);
    
    const dialog = document.getElementById('dedup-dialog');
    const duplicateGroups = dialog.querySelector('.duplicate-groups');
    duplicateGroups.innerHTML = '';
    
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
    const closeButton = document.querySelector('#terms-of-service-dialog .close');

    if (!termsDialog || !acceptButton || !declineButton || !closeButton) {
      console.error('Terms of Service dialog elements not found');
      return false; // Return false if dialog elements are not found
    }

    if (!tosAccepted) {
      termsDialog.showModal();
      
      return new Promise((resolve) => {
        acceptButton.addEventListener('click', async () => {
          await window.electron.saveSetting('tosAcceptedDate', new Date().toISOString());
          termsDialog.close();
          resolve(true); // Resolve promise when accepted
        });

        declineButton.addEventListener('click', () => {
          window.electron.quitApp();
          resolve(false); // Resolve promise when declined
        });

        closeButton.addEventListener('click', () => {
          window.electron.quitApp();
          resolve(false); // Resolve promise when closed
        });
      });
    }
    return true; // Return true if already accepted
  } catch (error) {
    console.error('Error checking Terms of Service:', error);
    return false; // Return false on error
  }
}

// Update the DOMContentLoaded event listener
document.addEventListener('DOMContentLoaded', async () => {
  const tosAccepted = await checkTermsOfService();
  if (!tosAccepted) return; // Don't continue if TOS was declined

  // Show the welcome dialog if this is the first run
  const hasRunBefore = await window.electron.getSetting('hasRunBefore');
  if (!hasRunBefore) {
    const welcomeDialog = document.getElementById('welcome-message');
    welcomeDialog.showModal();
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
  
  // Proceed to check for updates and initialize the application
  debugLog('DOM fully loaded and parsed');
  console.log('Checking for updates on startup...');
  const welcomeDialog = document.getElementById('welcome-message');
  
  // Check for updates first
  let currentVersion;
  try {
    currentVersion = await window.electron.getSetting('currentVersion');
    const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
    const latestVersion = await window.electron.checkForUpdates(isBeta);
    const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');
    
    console.log('Version check results:', { 
      currentVersion, 
      latestVersion, 
      lastDeclinedVersion,
      isBeta 
    });
    
    // Only show prompt if it's a new version and not the one user previously declined
    if (latestVersion && 
        latestVersion !== currentVersion && 
        latestVersion > currentVersion && 
        latestVersion !== lastDeclinedVersion) {
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
    }

    // Store the latest version after check
    await window.electron.saveSetting('latestVersion', latestVersion);
    await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());
  } catch (error) {
    console.error('Error checking for updates:', error);
  }

  const fileGrid = document.querySelector('.file-grid');
  const settingsDialog = document.getElementById('settings-dialog');
  const aboutDialog = document.getElementById('about-dialog');
  const tagDialog = document.getElementById('new-tag-dialog');
  const newTagInput = document.getElementById('new-tag-name');
  const addTagButton = document.getElementById('add-tag-button');
  const licenseSelect = document.getElementById('license-select');
  const newDesignerDialog = document.getElementById('new-designer-dialog');

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
        tag.innerHTML = `
          ${selectedTag}
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
        welcomeDialog.showModal();
        const viewLibMsg = document.getElementById("view-library-message");
        if (viewLibMsg) { 
          viewLibMsg.style.display = "none"; 
        }
      }
    } catch (error) {
      console.error('Error loading models:', error);
    }
  } else {
    welcomeDialog.showModal();
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
      } catch (error) {
        console.error('Error populating multi-edit dropdowns:', error);
      }
      
      showMultiEditPanel(); // Call to attach listeners
      
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
    // Update CSS variable
    document.documentElement.style.setProperty('--model-background-color', color);
    // Save to settings
    await window.electron.saveSetting('modelBackgroundColor', color);
    settingsDialog.close();
  });

  // Add dismiss button handler
  document.getElementById('dismiss-welcome')?.addEventListener('click', () => {
    welcomeDialog.close();
  });

  // Update the save model button handler (single edit)
  document.getElementById('save-model-button')?.addEventListener('click', async () => {
    try {
      const filePath = document.getElementById('model-path').value;
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
      const designer = document.getElementById('multi-designer').value || 'Unknown'; // Default to Unknown
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
          designer, // Always include designer (now has default)
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

      // Reapply filters to refresh the view
      await refreshModelDisplay();

    } catch (error) {
      console.error('Error saving multiple models:', error);
    }
  });

  // Add open file button handler
  document.getElementById('open-file-button')?.addEventListener('click', async () => {
    const filePath = document.getElementById('model-path').value;
    if (filePath) {
      await window.electron.showItemInFolder(filePath);
    }
  });

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
        const parentSelect = document.getElementById(sourceDropdownId);
        if (parentSelect) {
          const option = document.createElement('option');
          option.value = newParentName;
          option.textContent = newParentName;
          parentSelect.appendChild(option);
          parentSelect.value = newParentName;
          
          // Trigger auto-save
          if (sourceDropdownId === 'multi-parent') {
            await autoSaveMultipleModels('parentModel', newParentName);
          } else {
            const filePath = document.getElementById('model-path').value;
            await autoSaveModel('parentModel', newParentName, filePath);
          }

          // Update the filter dropdown
          await populateParentModelFilter();
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
    const filterElements = [
      'designer-select',
      'license-select',
      'parent-select',
      'printed-select',
      'tag-filter',
      'sort-select',
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
  });

  // Remove the other DOMContentLoaded listener that's adding filter change handlers

  await initializeTags();

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

  // Add fetch button event listeners
  document.getElementById('fetch-source-button')?.addEventListener('click', async () => {
    const sourceInput = document.getElementById('model-source');
    const url = sourceInput.value.trim();
    
    if (!url) {
      await window.electron.showMessage('Error', 'Please enter a source URL');
      return;
    }

    try {
      if (url.includes('thangs.com')) {
        // Extract designer and model name from URL
        const urlParts = url.split('/');
        const designerIndex = urlParts.indexOf('designer');
        
        if (designerIndex !== -1 && designerIndex + 1 < urlParts.length) {
          const designer = urlParts[designerIndex + 1];
          
          // Find the model name after "3d-model/"
          const modelIndex = urlParts.indexOf('3d-model');
          if (modelIndex !== -1 && modelIndex + 1 < urlParts.length) {
            let modelName = urlParts[modelIndex + 1];
            // Clean up the model name by replacing URL encoding
            modelName = decodeURIComponent(modelName)
              .replace(/-/g, ' ')  // Replace hyphens with spaces
              .replace(/\.stl$|\.3mf$/i, ''); // Remove file extension if present
            
            // Update the designer field
            const designerSelect = document.getElementById('model-designer');
            if (!Array.from(designerSelect.options).some(opt => opt.value === designer)) {
              const option = document.createElement('option');
              option.value = designer;
              option.textContent = designer;
              designerSelect.appendChild(option);
            }
            designerSelect.value = designer;

            // Update the parent model field
            const parentSelect = document.getElementById('model-parent');
            if (!Array.from(parentSelect.options).some(opt => opt.value === modelName)) {
              const option = document.createElement('option');
              option.value = modelName;
              option.textContent = modelName;
              parentSelect.appendChild(option);
            }
            parentSelect.value = modelName;

            // Trigger auto-save for both fields
            const filePath = document.getElementById('model-path').value;
            await autoSaveModel('designer', designer, filePath);
            await autoSaveModel('parentModel', modelName, filePath);
          }
        }
      } else if (url.includes('makerworld.com')) {
        try {
          // Use window.electron to fetch the page content to avoid CORS issues
          const pageData = await window.electron.fetchMakerWorldPage(url);
          
          if (pageData) {
            let designer = pageData.designer;
            let modelName = pageData.modelName;

            // Update the designer field
            const designerSelect = document.getElementById('model-designer');
            if (designer && !Array.from(designerSelect.options).some(opt => opt.value === designer)) {
              const option = document.createElement('option');
              option.value = designer;
              option.textContent = designer;
              designerSelect.appendChild(option);
            }
            if (designer) {
              designerSelect.value = designer;
            }

            // Update the parent model field
            const parentSelect = document.getElementById('model-parent');
            if (modelName && !Array.from(parentSelect.options).some(opt => opt.value === modelName)) {
              const option = document.createElement('option');
              option.value = modelName;
              option.textContent = modelName;
              parentSelect.appendChild(option);
            }
            if (modelName) {
              parentSelect.value = modelName;
            }

            // Trigger auto-save for both fields
            const filePath = document.getElementById('model-path').value;
            if (designer) {
              await autoSaveModel('designer', designer, filePath);
            }
            if (modelName) {
              await autoSaveModel('parentModel', modelName, filePath);
            }
          }
        } catch (error) {
          console.error('Error fetching MakerWorld page:', error);
          await window.electron.showMessage('Error', 'Failed to fetch MakerWorld page details: ' + error.message);
        }
      } else {
        await window.electron.showMessage('Error', 'Only Thangs.com and Makerworld.com URLs are currently supported');
      }
    } catch (error) {
      console.error('Error fetching page:', error);
      await window.electron.showMessage('Error', 'Failed to fetch page details: ' + error.message);
    }
  });

  document.getElementById('multi-fetch-source-button')?.addEventListener('click', async () => {
    const sourceUrl = document.getElementById('multi-source').value.trim();
    if (!sourceUrl || !sourceUrl.includes('thangs.com')) return;

    try {
      const urlParts = sourceUrl.split('/');
      const designerIndex = urlParts.indexOf('designer');
      
      if (designerIndex !== -1 && designerIndex + 1 < urlParts.length) {
        const designer = urlParts[designerIndex + 1];
        
        const modelIndex = urlParts.indexOf('3d-model');
        if (modelIndex !== -1 && modelIndex + 1 < urlParts.length) {
          let modelName = urlParts[modelIndex + 1];
          modelName = decodeURIComponent(modelName)
            .replace(/-/g, ' ')
            .replace(/\.stl$|\.3mf$/i, '');

          // Update multi-edit designer dropdown
          const designerSelect = document.getElementById('multi-designer');
          if (!Array.from(designerSelect.options).some(opt => opt.value === designer)) {
            const option = document.createElement('option');
            option.value = designer;
            option.textContent = designer;
            designerSelect.appendChild(option);
          }
          designerSelect.value = designer;

          // Update multi-edit parent model dropdown
          const parentSelect = document.getElementById('multi-parent');
          if (!Array.from(parentSelect.options).some(opt => opt.value === modelName)) {
            const option = document.createElement('option');
            option.value = modelName;
            option.textContent = modelName;
            parentSelect.appendChild(option);
          }
          parentSelect.value = modelName;

          // Save changes to all selected models
          await autoSaveMultipleModels('designer', designer);
          await autoSaveMultipleModels('parentModel', modelName);
        }
      }
    } catch (error) {
      console.error('Error fetching source data:', error);
      await window.electron.showMessage('Error', 'Failed to fetch source details: ' + error.message);
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
    
    const directoryPath = await window.electron.openFileDialog();
    if (!directoryPath || directoryPath.length === 0) return;

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
            const filePath = document.getElementById('model-path').value;
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
        // Add the new license to the dropdown
        const licenseSelect = document.getElementById(sourceDropdownId);
        if (licenseSelect) {
          const option = document.createElement('option');
          option.value = newLicenseName;
          option.textContent = newLicenseName;
          licenseSelect.appendChild(option);
          licenseSelect.value = newLicenseName;
          
          // Trigger auto-save
          if (sourceDropdownId === 'multi-license') {
            await autoSaveMultipleModels('license', newLicenseName);
          } else {
            const filePath = document.getElementById('model-path').value;
            await autoSaveModel('license', newLicenseName, filePath);
          }
        }
        
        // Clear the input and close the dialog immediately
        document.getElementById('new-license-name').value = '';
        document.getElementById('new-license-dialog').close();
        
        // Update the license filter dropdown
        await populateLicenseFilter();
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

  document.getElementById('save-backup-restore')?.addEventListener('click', () => {
    document.getElementById('backup-restore-dialog').close();
  });

  document.getElementById('cancel-backup-restore')?.addEventListener('click', () => {
    document.getElementById('backup-restore-dialog').close();
  });

  // Add after your existing event listeners in DOMContentLoaded
  window.electron.onOpenDeDup(() => {
    const dialog = document.getElementById('dedup-dialog');
    loadDuplicateFiles();
    dialog.showModal();
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
        tagElement.innerHTML = `
          ${tag.name}
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
            await populateTagSelect();
            await populateTagFilter();
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

  // Add event listener for generating missing thumbnails
  window.electron.onGenerateMissingThumbnails(async (_event) => {
    try {
      const modelsWithoutThumbs = await window.electron.getModelsWithDefaultThumbnails();
      
      if (modelsWithoutThumbs.length === 0) {
        await window.electron.showMessage('Information', 'All models already have thumbnails. Nothing to generate.');
        return;
      }
      
      const userChoice = await window.electron.showMessage(
        'Generate Thumbnails',
        `${modelsWithoutThumbs.length} models need thumbnails. Would you like to generate them now?`,
        ['Yes', 'No']
      );
      
      if (userChoice === 'Yes') {
        await generateThumbnailsForModels(modelsWithoutThumbs);
        await window.electron.showMessage('Success', 'Thumbnail generation completed successfully.');
        
        // Refresh the grid to show the new thumbnails
        const sortSelect = document.getElementById('sort-select');
        const models = await window.electron.getAllModels(sortSelect.value);
        await renderFiles(models);
      }
    } catch (error) {
      console.error('Error generating missing thumbnails:', error);
      await window.electron.showMessage('Error', 'Failed to generate thumbnails: ' + error.message);
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
  window.electron.onRefreshGrid(async () => {
    // Clear all selected models from memory.
    selectedModels.clear();
    // Also clear any visual indication of selection.
    document.querySelectorAll('.file-item.selected').forEach(item => item.classList.remove('selected'));
    
    // Get current sort option and refresh the grid.
    const sortSelect = document.getElementById('sort-select');
    const models = await window.electron.getAllModels(sortSelect.value);
    
    // Actually refresh the grid with the new models
    await renderFiles(models);
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
    const filePath = document.getElementById('model-path').value;
    await autoSaveModel('designer', e.target.value, filePath);
  });

  document.getElementById('model-license').addEventListener('change', async (e) => {
    const filePath = document.getElementById('model-path').value;
    await autoSaveModel('license', e.target.value, filePath);
  });

  // The parent model listener is already present but let's make sure it's consistent
  document.getElementById('model-parent').addEventListener('change', async (e) => {
    const filePath = document.getElementById('model-path').value;
    await autoSaveModel('parentModel', e.target.value, filePath);
  });

  // Update the About dialog content in index.html
  const tosContent = `
  <h4>Welcome to Printventory</h4>
  <p>By using Printventory, you agree to these terms. Please read them carefully.</p>

  <h4>1. Acceptance of Terms</h4>
  <p>By accessing and using Printventory, you accept and agree to be bound by the terms and conditions of this agreement.</p>

  <h4>2. Use License</h4>
  <p>Permission is granted to use Printventory for personal and commercial use subject to the following conditions:</p>
  <ul>
    <li>You may not modify, copy, or redistribute the software.</li>
    <li>You may not reverse engineer or decompile the software.</li>
    <li>This license may be terminated if you violate any terms.</li>
  </ul>

  <h4>3. Data and Risk Disclaimer</h4>
  <p>You acknowledge and agree that:</p>
  <ul>
    <li>Use of this software is entirely at your own risk</li>
    <li>You are solely responsible for backing up your data</li>
    <li>The developers assume no liability for any data loss, corruption, or damage</li>
    <li>No guarantee is made regarding the reliability or security of data stored using this application</li>
  </ul>

  <h4>4. Disclaimer</h4>
  <p>The software is provided "as is", without warranty of any kind, express or implied. This includes but is not limited to:</p>
  <ul>
    <li>No warranty of merchantability</li>
    <li>No warranty of fitness for a particular purpose</li>
    <li>No warranty regarding data integrity or preservation</li>
  </ul>

  <h4>5. Limitations</h4>
  <p>In no event shall the authors or copyright holders be liable for any claim, damages, data loss, or other liability, whether in an action of contract, tort or otherwise, arising from, out of, or in connection with the software or the use or other dealings in the software.</p>
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
      if (latestVersion !== currentVersion && 
          latestVersion > currentVersion && 
          latestVersion !== lastDeclinedVersion) {
        // Always show update prompt if there's an update, even on startup
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
        await window.electron.showMessage(
          'Up to Date',
          'You are running the latest version.'
        );
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
  window.electron.onOpenSTLHome(() => {
    const stlHomeDialog = document.getElementById('stl-home-dialog');
    if (stlHomeDialog) {
      // Load the current STL Home setting (if any)
      window.electron.getSetting('stlHome').then(dir => {
        document.getElementById('stl-home-directory').value = dir || "";
      });
      stlHomeDialog.showModal();
    }
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
    // Close the dialog
    document.getElementById('stl-home-dialog').close();
  });

  // Handler for saving the STL Home setting (via form submit)
  document.getElementById('stl-home-dialog').addEventListener('submit', async (event) => {
    event.preventDefault();
    const stlDir = document.getElementById('stl-home-directory').value.trim();
    // Save the STL Home directory to settings (blank by default if nothing selected)
    await window.electron.saveSetting('stlHome', stlDir);
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
        endpointEl.value = value || 'https://api.openai.com/v1';
        
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
        modelEl.value = value || 'gpt-4o-mini';
        
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
        serviceEl.value = value || 'openai';
        
        // Add change event listener for real-time persistence
        serviceEl.addEventListener('change', async () => {
          await window.electron.saveSetting('aiService', serviceEl.value);
        });
      } else {
        console.error('ai-service-select element not found.');
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
    const apiKey = document.getElementById('ai-api-key')?.value || '';
    const endpoint = document.getElementById('ai-endpoint')?.value || 'https://api.openai.com/v1';
    const model = document.getElementById('ai-model')?.value || 'gpt-4o-mini';
    const service = document.getElementById('ai-service-select')?.value || 'openai';
    
    await window.electron.saveSetting('apiKey', apiKey);
    await window.electron.saveSetting('apiEndpoint', endpoint);
    await window.electron.saveSetting('aiModel', model);
    await window.electron.saveSetting('aiService', service);
    
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
    
    // Load current setting
    const enableZipArchives = await window.electron.getSetting('enableZipArchives');
    const checkbox = document.getElementById('enable-zip-archives');
    if (checkbox) {
      checkbox.checked = enableZipArchives === '1';
    }
    
    dialog.showModal();
  });

  document.getElementById('save-file-type-settings')?.addEventListener('click', async (event) => {
    event.preventDefault();
    const checkbox = document.getElementById('enable-zip-archives');
    const enableZipArchives = checkbox?.checked ? '1' : '0';
    
    await window.electron.saveSetting('enableZipArchives', enableZipArchives);
    
    document.getElementById('file-type-settings-dialog').close();
  });

  document.getElementById('cancel-file-type-settings')?.addEventListener('click', () => {
    document.getElementById('file-type-settings-dialog').close();
  });

  // Listen for the 'tags-generated' event from the main process
  window.electron.on('tags-generated', async (filePath, tags) => {
    try {
      // Fetch the current model data for the given filePath
      const model = await window.electron.getModel(filePath);
      if (!model) {
        console.error(`Model not found for ${filePath}`);
        return;
      }

      // Merge the generated tags with the existing ones without duplicates
      // Also add the "AI Tagged" tag to indicate this model was tagged by AI
      const existingTags = model.tags || [];
      const newTags = Array.from(new Set([...existingTags, ...tags, "AI Tagged"]));
      
      // Update the model data with the new tag list
      await window.electron.saveModel({ ...model, tags: newTags });

      // Update the model element in the grid/UI
      await updateModelElement(filePath);
      
      // Refresh the tags in the Edit Model Details view if it's showing the current model
      const currentModelPath = document.getElementById('model-path')?.value;
      if (currentModelPath === filePath) {
        await loadModelTags(filePath);
      }

      // Only show alert for single model tag generation (not for batch operations)
      if (!document.getElementById('progress-dialog').open) {
        await window.electron.showMessage('Success', 'Tags generated and added successfully!');
      }
      
      // Optionally, provide feedback to the user (only once, not an alert per model in multi-select)
      console.log(`Tags updated for model: ${filePath}`);
    } catch (error) {
      console.error(`Error updating tags for model ${filePath}:`, error);
    }
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

    if (selectedService === 'openai') {
      endpointEl.value = 'https://api.openai.com/v1';
      modelEl.value = 'gpt-4o-mini';
    } else if (selectedService === 'gemini') {
      endpointEl.value = 'https://generativelanguage.googleapis.com/v1beta/openai/';
      modelEl.value = 'gemini-1.5-flash';
    } else if (selectedService === 'custom') {
      endpointEl.value = '';
      modelEl.value = '';
    }
    
    // Clear the API key field
    if (apiKeyEl) {
      apiKeyEl.value = '';
    }
    
    // Save the new values to the database
    await window.electron.saveSetting('apiEndpoint', endpointEl.value);
    await window.electron.saveSetting('aiModel', modelEl.value);
    await window.electron.saveSetting('apiService', selectedService);
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
            
            // Find the element for this model
            const fileElement = document.querySelector(`.file-item[data-filepath="${CSS.escape(modelRef.filePath)}"]`);
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
      const searchFields = [model.fileName, model.designer, model.parentModel, model.notes]
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
          selectedModels.add(model.filePath);
        }
      });
      
      // Update UI for all items with matching file paths that are rendered
      document.querySelectorAll('.file-item').forEach(item => {
        const itemPath = item.getAttribute('data-filepath');
        if (selectedModels.has(itemPath)) {
          item.classList.add('selected');
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

function updateSelectedCount() {
  const countElement = document.querySelector('.selected-count');
  if (countElement) {
    countElement.textContent = `${selectedModels.size} model${selectedModels.size !== 1 ? 's' : ''} selected`;
  }
}

// Update the toggleModelSelection function`
function toggleModelSelection(fileElement, filePath) {
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
    updateSelectedCount();
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

    // Update the scan directory call to use the new validation and cancellation
    const scanResult = await window.electron.scanDirectory(directoryPath, isValidFile);
    const { files, totalFiles, cancelScan } = scanResult || { files: [], totalFiles: 0 };
    
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
                    thumbnail = images[0]; // Use first image, not the array
                    console.log(`[DEBUG] Using embedded image from 3MF: ${file.filePath}`);
                    await window.electron.saveThumbnail(file.filePath, thumbnail);
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
    }
  } catch (error) {
    console.error('Error scanning directory:', error);
    if (!background) {
      renderProgressText.textContent = `Error: ${error.message}`;
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
    'sort-select',
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

  if (selectedModels.has(file.filePath)) {
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
      
      // Set the global directory filter.
      window.currentDirectoryFilter = parentDir;
      
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
    console.log(`[DEBUG] renderModelToPNG: Checking for embedded images in 3MF: ${filePath}`);
    try {
      const images = await window.electron.get3MFImages(filePath);
      if (images && images.length > 0) {
        const firstImage = images[0];
        console.log(`[DEBUG] renderModelToPNG: SUCCESS - Found embedded image, skipping 3D render for ${filePath}`);
        // Return the embedded image instead of rendering
        const img = document.createElement('img');
        img.src = firstImage;
        img.style.width = '250px';
        img.style.height = '250px';
        container.innerHTML = '';
        container.appendChild(img);
        // Save to database
        await window.electron.saveThumbnail(filePath, firstImage);
        return firstImage;
      } else {
        console.log(`[DEBUG] renderModelToPNG: No embedded images found, will render 3D model for ${filePath}`);
      }
    } catch (imageError) {
      console.error(`[DEBUG] renderModelToPNG: Error checking for embedded image: ${imageError}`);
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



// Update the click handler for file items to use the new showMultiEditPanel function
function handleFileClick(event, filePath) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault();
    const fileItem = event.currentTarget;
    
    if (!isMultiSelectMode) {
      isMultiSelectMode = true;
      selectedModels.clear();
    }
    
    if (selectedModels.has(filePath)) {
      selectedModels.delete(filePath);
      fileItem.classList.remove('selected');
    } else {
      selectedModels.add(filePath);
      fileItem.classList.add('selected');
    }
    
    if (selectedModels.size > 0) {
      showMultiEditPanel();
    } else {
      isMultiSelectMode = false;
      document.getElementById('multi-edit-panel').classList.add('hidden');
    }
  } else {
    // Single selection
    selectedModels.clear();
    document.querySelectorAll('.file-item').forEach(item => item.classList.remove('selected'));
    event.currentTarget.classList.add('selected');
    selectedModels.add(filePath);
    isMultiSelectMode = false;
    showModelDetails(filePath);
  }
}

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
    // Add the new designer to the dropdown
    const designerSelect = document.getElementById(sourceDropdownId);
    if (designerSelect) {
      const option = document.createElement('option');
      option.value = newDesignerName;
      option.textContent = newDesignerName;
      designerSelect.appendChild(option);
      designerSelect.value = newDesignerName;
    }
    
    // Clear the input and close the dialog immediately
    document.getElementById('new-designer-name').value = '';
    document.getElementById('new-designer-dialog').close();
    
    // Trigger auto-save and updates after dialog is closed
    if (sourceDropdownId === 'multi-designer') {
      await autoSaveMultipleModels('designer', newDesignerName);
    } else {
      const filePath = document.getElementById('model-path').value;
      await autoSaveModel('designer', newDesignerName, filePath);
    }
    
    // Update the designer filter dropdown
    await populateDesignerDropdown();
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

// Update the parent model dialog submit handler to match designer exactly
document.getElementById('new-parent-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newParentName = document.getElementById('new-parent-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown || 'model-parent';
  
  if (newParentName) {
    const parentSelect = document.getElementById(sourceDropdownId);
    if (parentSelect) {
      const option = document.createElement('option');
      option.value = newParentName;
      option.textContent = newParentName;
      parentSelect.appendChild(option);
      parentSelect.value = newParentName;
    }
    
    // Clear the input and close the dialog immediately
    document.getElementById('new-parent-name').value = '';
    document.getElementById('new-parent-dialog').close();
    
    // Trigger auto-save and updates after dialog is closed
    if (sourceDropdownId === 'multi-parent') {
      await autoSaveMultipleModels('parentModel', newParentName);
    } else {
      const filePath = document.getElementById('model-path').value;
      await autoSaveModel('parentModel', newParentName, filePath);
    }

    // Update the filter dropdown
    await populateParentModelFilter();
  }
});

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
  tag.innerHTML = `
    ${tagName}
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
      await autoSaveMultipleModels('tags', currentTags); 
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

async function loadModelTags(modelId) {
  const tagsContainer = document.getElementById('model-tags');
  tagsContainer.innerHTML = '';
  
  try {
    const model = await window.electron.getModel(modelId);
    if (model && model.tags) {
      model.tags.sort((a, b) => a.localeCompare(b)); // Sort tags alphabetically
      model.tags.forEach(tag => addTagToModel(tag, 'model-tags'));
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
document.getElementById('new-designer-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newDesignerName = document.getElementById('new-designer-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown;
  
  if (newDesignerName) {
    // Add the new designer to the dropdown
    const designerSelect = document.getElementById(sourceDropdownId);
    const option = document.createElement('option');
    option.value = newDesignerName;
    option.textContent = newDesignerName;
    designerSelect.appendChild(option);
    
    // Select the new designer
    designerSelect.value = newDesignerName;
    
    // Clear the input
    document.getElementById('new-designer-name').value = '';
    
    // Close the dialog
    document.getElementById('new-designer-dialog').close();
  }
});

// Parent Model Dialog Submit Handler
document.getElementById('new-parent-dialog').addEventListener('submit', async (event) => {
  event.preventDefault();
  const newParentName = document.getElementById('new-parent-name').value.trim();
  const sourceDropdownId = event.target.closest('dialog').dataset.sourceDropdown || 'model-parent';
  
  if (newParentName) {
    const parentSelect = document.getElementById(sourceDropdownId);
    if (parentSelect) {
      const option = document.createElement('option');
      option.value = newParentName;
      option.textContent = newParentName;
      parentSelect.appendChild(option);
      parentSelect.value = newParentName;
    }
    
    // Clear the input and close the dialog immediately
    document.getElementById('new-parent-name').value = '';
    document.getElementById('new-parent-dialog').close();
    
    // Trigger auto-save and updates after dialog is closed
    if (sourceDropdownId === 'multi-parent') {
      await autoSaveMultipleModels('parentModel', newParentName);
    } else {
      const filePath = document.getElementById('model-path').value;
      await autoSaveModel('parentModel', newParentName, filePath);
    }

    // Update the filter dropdown
    await populateParentModelFilter();
  }
});

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
  const filePath = document.getElementById('model-path').value;
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

  const confirm = await window.electron.showMessage(
    'Confirm Delete',
    `Are you sure you want to DELETE ${selectedFiles.length} files?\nThis cannot be undone!\n\nFiles:\n${selectedFiles.join('\n')}`,
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
      await loadDuplicateFiles();
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
    parents.forEach(parent => {
      if (parent) { // Only add non-empty parent models
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
    parents.forEach(parent => {
      if (parent) { // Only add non-empty parent models
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

  // Clear the form
  document.getElementById('model-path').value = '';
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

// Remove all existing DOMContentLoaded event listeners and create a single one
// Place this at the end of the file, after all function declarations

// First, declare all initialization functions outside of any event listeners
async function initializeApp() {
  try {
    // Initialize the combined search functionality from search.js
    if (typeof window.initializeCombinedSearch === 'function') {
      window.initializeCombinedSearch();
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
    if (latestVersion && 
        latestVersion !== currentVersion && 
        compareVersions(latestVersion, currentVersion) > 0 && 
        latestVersion !== lastDeclinedVersion) {
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

  debugLog('DOM fully loaded and parsed');

  // (update check and app initialization code already present)
  try {
    console.log('Checking for updates on startup...');
    let currentVersion = await window.electron.getSetting('currentVersion');
    const isBeta = (await window.electron.getSetting('betaOptIn')) === 'true';
    const latestVersion = await window.electron.checkForUpdates(isBeta);
    const lastDeclinedVersion = await window.electron.getSetting('lastDeclinedVersion');
    
    console.log('Version check results:', { 
      currentVersion, 
      latestVersion, 
      lastDeclinedVersion,
      isBeta 
    });
    
    if (
      latestVersion &&
      latestVersion !== currentVersion &&
      compareVersions(latestVersion, currentVersion) > 0 &&
      latestVersion !== lastDeclinedVersion
    ) {
      const shouldUpdate = await window.electron.showMessage(
        'Update Available',
        `Version ${latestVersion} is available. You are currently running version ${currentVersion}. Would you like to update?`,
        ['Yes', 'No']
      );
      
      if (shouldUpdate === 'Yes') {
        await window.electron.openUpdatePage(isBeta);
      } else {
        console.log('User declined update, storing version:', latestVersion);
        await window.electron.saveSetting('lastDeclinedVersion', latestVersion);
      }
    }
    
    await window.electron.saveSetting('latestVersion', latestVersion);
    await window.electron.saveSetting('lastUpdateCheck', new Date().toISOString());

  } catch (error) {
    console.error('Error checking for updates:', error);
  }

  // Continue with normal initialization (which now includes the thumbnail prompting)
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
    
    // If this was called from the details panel, update the displayed file
    await updateModelElement(filePath);
    
    return true;
  } catch (error) {
    console.error(`Error in autoSaveModel for field ${field}:`, error);
    return false;
  }
}

// Add implementation of autoSaveMultipleModels function
async function autoSaveMultipleModels(field, value) {
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
    
    // Update all selected models
    for (const filePath of modelsToUpdate) {
      try {
        const model = await window.electron.getModel(filePath);
        if (model) {
          // Special handling for tags - MERGE instead of replace
          if (field === 'tags') {
            const existingTags = Array.isArray(model.tags) ? model.tags : [];
            const newTags = Array.isArray(value) ? value : []; 
            // Combine, filter out duplicates, and sort
            const allTags = [...new Set([...existingTags, ...newTags])].sort(); 
            model.tags = allTags;
          } else {
            // Handle other fields
            model[field] = value;
          }
          
          // Save the model
          await window.electron.saveModel(model);
          
          // Small delay to ensure database is updated before fetching
          await new Promise(resolve => setTimeout(resolve, 50));
          
          // Update UI - ensure this happens for each model
          console.log(`autoSaveMultipleModels: Updating UI for ${filePath}`);
          await updateModelElement(filePath);
          
          // Small delay between updates to avoid overwhelming the UI
          await new Promise(resolve => setTimeout(resolve, 20));
        } else {
          console.warn(`Could not find model for ${filePath} during autoSaveMultipleModels`);
        }
      } catch (error) {
        console.error(`Error updating model ${filePath} in autoSaveMultipleModels:`, error);
        // Continue with other models even if one fails
      }
    }
    
    console.log(`Finished autoSaveMultipleModels for field ${field}. Updated ${modelsToUpdate.length} models.`);
    return true;
  } catch (error) {
    console.error(`Error in autoSaveMultipleModels for field ${field}:`, error);
    return false;
  }
}

// Helper function to get the current model file path
function getModelFilePath() {
  // First try to get it from the model-path input
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

// Add this code to set up event handlers for multi-edit mode controls
function showMultiEditPanel() {
  // Populate dropdowns with existing data - REMOVED redundant calls
  // populateModelDesignerDropdown('', 'multi-designer');
  // populateModelLicenseDropdown('', 'multi-license');
  // populateParentModelDropdown('', 'multi-parent');
  // populateTagSelect('multi-tag-select', 'multi-tags');
  
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
  
  // Add change handlers for multi-edit controls
  document.getElementById('multi-designer')?.addEventListener('change', async (e) => {
    const value = e.target.value || 'Unknown'; // Use default Unknown
    await autoSaveMultipleModels('designer', value);
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
      
      // Use a more direct approach to update the models
      try {
        console.log(`Updating printed status to ${isChecked} for ${selectedModels.size} models`);
        
        // Process each selected model
        for (const filePath of selectedModels) {
          const model = await window.electron.getModel(filePath);
          if (model) {
            model.printed = isChecked;
            await window.electron.saveModel(model);
            console.log(`Updated model ${filePath} printed status to ${isChecked}`);
            await updateModelElement(filePath);
          }
        }
        
        console.log(`Successfully updated printed status for ${selectedModels.size} models`);
      } catch (error) {
        console.error('Error updating printed status:', error);
      }
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
when 
  // Re-attach event listener for multi-tag-select
  const multiTagSelect = document.getElementById('multi-tag-select');
  if (multiTagSelect) {
    // Clone/replace to ensure any old listeners are gone (might be redundant but safe)
    const newMultiTagSelect = multiTagSelect.cloneNode(true);
    multiTagSelect.parentNode.replaceChild(newMultiTagSelect, multiTagSelect);

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
      
      if (selectedModels.size === 0) {
        console.warn('No models selected for updating printed status');
        return;
      }
      
      try {
        // Start transaction
        console.log(`Updating printed status to ${isChecked} for ${selectedModels.size} models`);
        
        // Process each selected model
        for (const filePath of selectedModels) {
          const model = await window.electron.getModel(filePath);
          if (model) {
            model.printed = isChecked;
            await window.electron.saveModel(model);
            await updateModelElement(filePath);
          }
        }
        
        console.log(`Successfully updated printed status for ${selectedModels.size} models`);
      } catch (error) {
        console.error('Error updating printed status:', error);
      }
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
        updateSelectedCount(); // Update the count display
        // Optionally hide the multi-edit panel if preferred when selection is cleared
        // exitMultiEditMode(); // Or just hide the panel like this:
        // document.getElementById('multi-edit-panel').classList.add('hidden'); 
        // document.getElementById('model-details').classList.remove('hidden');
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

  if (model.thumbnail) {
    const img = document.createElement('img');
    img.src = model.thumbnail;
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
          // Update model in memory
          model.thumbnail = thumbnail;
          // Remove from pending set
          pendingThumbnails.delete(model.filePath);
          // Save to database
          await window.electron.saveThumbnail(model.filePath, thumbnail);

          // Try to update any visible instances of this file in the DOM
          try {
            const visibleItem = document.querySelector(`.file-item[data-filepath="${CSS.escape(model.filePath)}"] .thumbnail-container`);
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

  item.appendChild(thumbnailContainer);

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
    
    // File name column (fixed width)
    fileName.style.flexShrink = '0';
    fileName.style.width = '250px';
    fileName.style.overflow = 'hidden';
    fileName.style.textOverflow = 'ellipsis';
    fileName.style.whiteSpace = 'nowrap';
    fileName.style.fontSize = '13px';
    fileName.style.color = '#fff';
    
    // Parent directory column (fixed width, clickable to filter)
    const directoryText = document.createElement('div');
    directoryText.className = 'directory-info';
    directoryText.textContent = parentDir || '';
    directoryText.style.fontSize = '11px';
    directoryText.style.color = parentDir ? '#4a9eff' : '#888';
    directoryText.style.flexShrink = '0';
    directoryText.style.width = '150px';
    directoryText.style.overflow = 'hidden';
    directoryText.style.textOverflow = 'ellipsis';
    directoryText.style.whiteSpace = 'nowrap';
    directoryText.style.cursor = parentDir ? 'pointer' : 'default';
    directoryText.style.fontWeight = parentDir ? '500' : '400';
    // Add click handler to filter by directory
    if (parentDir) {
      directoryText.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the global directory filter
        window.currentDirectoryFilter = parentDir;
        // Trigger combined search to apply filter
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
      });
      // Add hover effect
      directoryText.addEventListener('mouseenter', () => {
        directoryText.style.textDecoration = 'underline';
        directoryText.style.color = '#6bb3ff';
      });
      directoryText.addEventListener('mouseleave', () => {
        directoryText.style.textDecoration = 'none';
        directoryText.style.color = '#4a9eff';
      });
    }
    fileInfo.appendChild(directoryText);
    
    // Optimized column widths for list view
    // Add file size (fixed width, center-aligned)
    if (model.size) {
      const sizeText = document.createElement('div');
      sizeText.className = 'file-size';
      sizeText.textContent = formatFileSize(model.size);
      sizeText.style.fontSize = '12px';
      sizeText.style.color = '#aaa';
      sizeText.style.flexShrink = '0';
      sizeText.style.width = '90px';
      sizeText.style.textAlign = 'center';
      sizeText.style.fontFamily = 'monospace';
      fileInfo.appendChild(sizeText);
    } else {
      // Spacer for consistent alignment
      const spacer = document.createElement('div');
      spacer.style.width = '90px';
      spacer.style.flexShrink = '0';
      fileInfo.appendChild(spacer);
    }
    
    // Add designer column (always show, even if empty)
    const designerText = document.createElement('div');
    designerText.className = 'designer-info';
    designerText.textContent = model.designer || '';
    designerText.style.fontSize = '12px';
    designerText.style.color = model.designer ? '#aaa' : '#666';
    designerText.style.flexShrink = '0';
    designerText.style.width = '180px';
    designerText.style.overflow = 'hidden';
    designerText.style.textOverflow = 'ellipsis';
    designerText.style.whiteSpace = 'nowrap';
    fileInfo.appendChild(designerText);

    // Add source column (always show, even if empty)
    const sourceText = document.createElement('div');
    sourceText.className = 'source-info';
    sourceText.textContent = model.source || '';
    sourceText.style.fontSize = '12px';
    sourceText.style.color = model.source ? '#aaa' : '#666';
    sourceText.style.flexShrink = '0';
    sourceText.style.width = '200px';
    sourceText.style.overflow = 'hidden';
    sourceText.style.textOverflow = 'ellipsis';
    sourceText.style.whiteSpace = 'nowrap';
    fileInfo.appendChild(sourceText);

    // Add parent model column (always show, even if empty)
    const parentText = document.createElement('div');
    parentText.className = 'parent-info';
    parentText.textContent = model.parentModel || '';
    parentText.style.fontSize = '12px';
    parentText.style.color = model.parentModel ? '#aaa' : '#666';
    parentText.style.flexShrink = '0';
    parentText.style.width = '180px';
    parentText.style.overflow = 'hidden';
    parentText.style.textOverflow = 'ellipsis';
    parentText.style.whiteSpace = 'nowrap';
    fileInfo.appendChild(parentText);

    // Add license column (always show, even if empty)
    const licenseText = document.createElement('div');
    licenseText.className = 'license-info';
    licenseText.textContent = model.license || '';
    licenseText.style.fontSize = '12px';
    licenseText.style.color = model.license ? '#aaa' : '#666';
    licenseText.style.flexShrink = '0';
    licenseText.style.width = '150px';
    licenseText.style.overflow = 'hidden';
    licenseText.style.textOverflow = 'ellipsis';
    licenseText.style.whiteSpace = 'nowrap';
    fileInfo.appendChild(licenseText);

    // Add tags column (always show, even if empty)
    // Note: Tags need to be loaded separately if not in model
    const tagsText = document.createElement('div');
    tagsText.className = 'tags-info';
    let tagsDisplay = '';
    if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
      tagsDisplay = model.tags.join(', ');
    }
    tagsText.textContent = tagsDisplay;
    tagsText.style.fontSize = '12px';
    tagsText.style.color = tagsDisplay ? '#aaa' : '#666';
    tagsText.style.flexShrink = '0';
    tagsText.style.width = '200px';
    tagsText.style.overflow = 'hidden';
    tagsText.style.textOverflow = 'ellipsis';
    tagsText.style.whiteSpace = 'nowrap';
    fileInfo.appendChild(tagsText);
    
    // Load tags asynchronously if not present
    if (!model.tags && model.id) {
      window.electron.getModelTags(model.id).then(tags => {
        if (tags && tags.length > 0) {
          tagsText.textContent = tags.map(t => t.name || t).join(', ');
          tagsText.style.color = '#aaa';
        }
      }).catch(err => console.error('Error loading tags:', err));
    }
    
    // Add print status column (fixed width)
    const printStatusColumn = document.createElement('div');
    printStatusColumn.className = 'print-status-column';
    printStatusColumn.style.flexShrink = '0';
    printStatusColumn.style.width = '100px';
    printStatusColumn.style.textAlign = 'center';
    printStatusColumn.style.display = 'flex';
    printStatusColumn.style.alignItems = 'center';
    printStatusColumn.style.justifyContent = 'center';
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
    } else {
      // Add empty spacer for consistent alignment
      const spacer = document.createElement('div');
      spacer.style.width = '100%';
      spacer.style.height = '20px';
      printStatusColumn.appendChild(spacer);
    }
    fileInfo.appendChild(printStatusColumn);
    
    // Add archive status column (fixed width)
    const archiveStatusColumn = document.createElement('div');
    archiveStatusColumn.className = 'archive-status-column';
    archiveStatusColumn.style.flexShrink = '0';
    archiveStatusColumn.style.width = '100px';
    archiveStatusColumn.style.textAlign = 'center';
    archiveStatusColumn.style.display = 'flex';
    archiveStatusColumn.style.alignItems = 'center';
    archiveStatusColumn.style.justifyContent = 'center';
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
      // Add empty spacer for consistent alignment
      const spacer = document.createElement('div');
      spacer.style.width = '100%';
      spacer.style.height = '20px';
      archiveStatusColumn.appendChild(spacer);
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
    
    // Add directory link (clickable to filter) with icon - spans full width
    if (parentDir) {
      const directoryItem = document.createElement('div');
      directoryItem.className = 'metadata-item directory-item';
      directoryItem.style.gridColumn = '1 / -1'; // Span both columns
      directoryItem.innerHTML = `
        <span class="metadata-icon">📁</span>
        <span class="metadata-value directory-link">${parentDir}</span>
      `;
      directoryItem.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        // Set the global directory filter
        window.currentDirectoryFilter = parentDir;
        // Trigger combined search to apply filter
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
      });
      metadataContainer.appendChild(directoryItem);
    }

    // Add file size with icon - spans full width
    if (model.size) {
      const sizeItem = document.createElement('div');
      sizeItem.className = 'metadata-item size-item';
      sizeItem.style.gridColumn = '1 / -1'; // Span both columns
      sizeItem.innerHTML = `
        <span class="metadata-icon">💾</span>
        <span class="metadata-value file-size">${formatFileSize(model.size)}</span>
      `;
      metadataContainer.appendChild(sizeItem);
    }

    // Get field analysis to determine which fields to show
    const fieldAnalysis = window.modelFieldAnalysis || {
      hasDesigner: true,
      hasSource: true,
      hasParentModel: true,
      hasLicense: true,
      hasTags: true
    };
    
    // Add designer with icon (only show if this model has designer data)
    if (fieldAnalysis.hasDesigner) {
      const designerValue = (model.designer && model.designer.trim()) ? model.designer.trim() : '';
      const hasDesigner = designerValue && designerValue !== '';
      
      // Only show if this specific model has a designer value
      if (hasDesigner) {
        const designerItem = document.createElement('div');
        designerItem.className = 'metadata-item designer-item';
        designerItem.style.cursor = 'pointer';
        designerItem.classList.add('clickable-metadata');
        
        designerItem.innerHTML = `
          <span class="metadata-icon">👤</span>
          <span class="metadata-value designer-info" style="color: #ccc; display: inline-block;">${designerValue}</span>
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
    }

    // Add source with icon (only show if this model has source data)
    if (fieldAnalysis.hasSource) {
      const sourceValue = (model.source && model.source.trim()) ? model.source.trim() : '';
      // Only show if this specific model has a source value
      if (sourceValue) {
        const sourceItem = document.createElement('div');
        sourceItem.className = 'metadata-item source-item';
        sourceItem.innerHTML = `
          <span class="metadata-icon">🔗</span>
          <span class="metadata-value source-info" style="color: #ccc">${sourceValue}</span>
        `;
        metadataContainer.appendChild(sourceItem);
      }
    }

    // Add parent model with icon (only show if this model has parent model data)
    if (fieldAnalysis.hasParentModel) {
      const parentValue = (model.parentModel && model.parentModel.trim()) ? model.parentModel.trim() : '';
      // Only show if this specific model has a parent model value
      if (parentValue) {
        const parentItem = document.createElement('div');
        parentItem.className = 'metadata-item parent-item';
        parentItem.style.cursor = 'pointer';
        parentItem.classList.add('clickable-metadata');
        
        parentItem.innerHTML = `
          <span class="metadata-icon">📦</span>
          <span class="metadata-value parent-info" style="color: #ccc">${parentValue}</span>
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
    }

    // Add license with icon (only show if this model has license data)
    if (fieldAnalysis.hasLicense) {
      const licenseValue = (model.license && model.license.trim()) ? model.license.trim() : '';
      // Only show if this specific model has a license value
      if (licenseValue) {
        const licenseItem = document.createElement('div');
        licenseItem.className = 'metadata-item license-item';
        licenseItem.style.cursor = 'pointer';
        licenseItem.classList.add('clickable-metadata');
        
        licenseItem.innerHTML = `
          <span class="metadata-icon">📜</span>
          <span class="metadata-value license-info" style="color: #ccc">${licenseValue}</span>
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
    }

    // Add tags with icon (only show if this model has tags data)
    if (fieldAnalysis.hasTags) {
      let tagsDisplay = '';
      if (model.tags && Array.isArray(model.tags) && model.tags.length > 0) {
        tagsDisplay = model.tags.join(', ');
      }
      
      // Only show if this specific model has tags, or load them asynchronously
      if (tagsDisplay) {
        const tagsItem = document.createElement('div');
        tagsItem.className = 'metadata-item tags-item';
        tagsItem.innerHTML = `
          <span class="metadata-icon">🏷️</span>
          <span class="metadata-value tags-info" style="color: #ccc">${tagsDisplay}</span>
        `;
        metadataContainer.appendChild(tagsItem);
      } else if (model.id) {
        // Create item and load tags asynchronously
        const tagsItem = document.createElement('div');
        tagsItem.className = 'metadata-item tags-item';
        tagsItem.innerHTML = `
          <span class="metadata-icon">🏷️</span>
          <span class="metadata-value tags-info" style="color: #666"></span>
        `;
        metadataContainer.appendChild(tagsItem);
        
        // Load tags asynchronously
        window.electron.getModelTags(model.id).then(tags => {
          if (tags && tags.length > 0) {
            const tagsText = tags.map(t => t.name || t).join(', ');
            const tagsValueSpan = tagsItem.querySelector('.tags-info');
            if (tagsValueSpan) {
              tagsValueSpan.textContent = tagsText;
              tagsValueSpan.style.color = '#ccc';
            }
          } else {
            // Remove the tags item if no tags found
            tagsItem.remove();
          }
        }).catch(err => {
          console.error('Error loading tags:', err);
          // Remove the tags item on error
          tagsItem.remove();
        });
      }
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
  const currentModelIds = currentModels.map(m => m.id || m.filePath).sort();
  const newModelIds = models.map(m => m.id || m.filePath).sort();
  const modelsChanged = JSON.stringify(currentModelIds) !== JSON.stringify(newModelIds);
  
  // Only clear if models actually changed
  if (modelsChanged) {
    container.innerHTML = ''; // clear existing content
  }
  container.currentModels = models;
  
  // Check if grid structure already exists
  let spacer = container.querySelector('.virtual-spacer');
  let virtualContent = container.querySelector('.virtual-content');
  
  // If grid structure exists and models haven't changed, just trigger re-render
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
  const totalHeight = (rowCount * itemHeight) + ((rowCount - 1) * verticalGap) + (paddingVertical * 2);
  spacer.style.height = totalHeight + 'px';

  // Create an absolutely positioned element within the container to hold the items
  if (!virtualContent) {
    virtualContent = document.createElement('div');
    virtualContent.className = 'virtual-content';
    virtualContent.style.position = 'absolute';
    virtualContent.style.top = '0';
    virtualContent.style.left = '0';
    virtualContent.style.width = '100%';
    virtualContent.style.height = '100%';
    virtualContent.style.pointerEvents = 'none'; // Let clicks pass through to items
    container.appendChild(virtualContent);
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
    
    // Recalculate values each time to ensure we use current view settings
    let currentVerticalGap, currentHorizontalGap;
    if (currentGridView === 'list') {
      currentVerticalGap = 4;
      currentHorizontalGap = 0;
    } else if (currentGridView === 'preview') {
      currentVerticalGap = 24;
      currentHorizontalGap = 24;
    } else {
      // Detailed view: no gap between rows
      currentVerticalGap = 0;
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
          currentRowCount = models.length;
        } else if (currentGridView === 'preview') {
          // For small view, account for horizontal gap
          const currentAvailableWidth = currentContainerWidth - (paddingHorizontal * 2);
          const itemWidthWithGap = itemWidth + currentHorizontalGap;
          currentColumns = Math.max(Math.floor(currentAvailableWidth / itemWidthWithGap), 1);
          currentRowCount = Math.ceil(models.length / currentColumns);
        } else {
          const currentAvailableWidth = currentContainerWidth - (paddingHorizontal * 2);
          currentColumns = Math.max(Math.floor(currentAvailableWidth / itemWidth), 1);
          currentRowCount = Math.ceil(models.length / currentColumns);
          
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

        // Update spacer height - for detailed view, no gap between rows
        let currentTotalHeight;
        if (currentGridView === 'detailed') {
          // Detailed view: rows touch each other, no gaps
          currentTotalHeight = (currentRowCount * itemHeight) + (paddingVertical * 2);
        } else {
          currentTotalHeight = (currentRowCount * itemHeight) + ((currentRowCount - 1) * currentVerticalGap) + (paddingVertical * 2);
        }
        spacer.style.height = currentTotalHeight + 'px';

        const buffer = 2; // extra rows to render before and after the visible area
        // Account for vertical gap when calculating visible rows
        const rowHeightWithGap = itemHeight + verticalGap;
        const startRow = Math.max(0, Math.floor(scrollTop / rowHeightWithGap) - buffer);
        const endRow = Math.min(currentRowCount, Math.ceil((scrollTop + containerHeight) / rowHeightWithGap) + buffer);

        // Track which items should be visible
        const visibleIndices = new Set();
        for (let row = startRow; row < endRow; row++) {
          for (let col = 0; col < currentColumns; col++) {
            const index = row * currentColumns + col;
            if (index < models.length) {
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
            if (index >= models.length) break;

            // Check if item already exists
            const existingItem = virtualContent.querySelector(`[data-index="${index}"]`);
            if (existingItem) {
              // Update position if needed (in case of resize)
              // For detailed view, rows touch each other (no gap)
              let topPosition;
              if (currentGridView === 'detailed') {
                topPosition = paddingVertical + (row * itemHeight);
              } else {
                topPosition = paddingVertical + (row * itemHeight) + (row * currentVerticalGap);
              }
              
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

            // Create new item
            const model = models[index];
            const item = createModelItem(model, currentGridView);
            item.dataset.index = index;
            item.style.position = 'absolute';
            // Calculate top position - for detailed view, rows touch each other (no gap)
            let topPosition;
            if (currentGridView === 'detailed') {
              topPosition = paddingVertical + (row * itemHeight);
            } else {
              topPosition = paddingVertical + (row * itemHeight) + (row * currentVerticalGap);
            }
            
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
