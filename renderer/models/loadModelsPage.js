async function loadModelsPage(page = 1, pageSize = 100, sortOption = 'name') {
  try {
    const models = await window.electron.getModelsPage({ page, pageSize, sortOption });
    return models;
  } catch (error) {
    console.error('Error loading models page:', error);
    return [];
  }
}

// Add this function with other utility functions
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

// Fix the showMultiEditPanel function to properly handle the printed checkbox
async function showMultiEditPanel() {
  try {
    const multiEditPanel = document.getElementById('multi-edit-panel');
    const detailsPanel = document.getElementById('model-details');

    if (!multiEditPanel || !detailsPanel) {
      console.error('Required panels not found');
      return;
    }

    // Hide single edit panel
    detailsPanel.classList.add('hidden');

    // Clear form fields
    const formFields = {
      'multi-designer': '',
      'multi-source': '',
      'multi-notes': '',
      'multi-printed': false,
      'multi-parent': '',
      'multi-license': '',
      'multi-tags': ''
    };

    // Safely set form field values
    Object.entries(formFields).forEach(([id, value]) => {
      const element = document.getElementById(id);
      if (element) {
        if (element.type === 'checkbox') {
          element.checked = value;
        } else if (id === 'multi-tags') {
          element.innerHTML = value;
        } else {
          element.value = value;
        }
      }
    });

    // Populate dropdowns with available options
    await Promise.all([
      populateModelDesignerDropdown(null, 'multi-designer'),
      populateParentModelDropdown(null, 'multi-parent'),
      populateModelLicenseDropdown(null, 'multi-license'),
      populateTagSelect('multi-tag-select', 'multi-tags')
    ]);

    // Handle the printed checkbox specifically
    const multiPrintedCheckbox = document.getElementById('multi-printed');
    if (multiPrintedCheckbox) {
      // Remove any existing event listeners by cloning and replacing
      const newCheckbox = multiPrintedCheckbox.cloneNode(true);
      multiPrintedCheckbox.parentNode.replaceChild(newCheckbox, multiPrintedCheckbox);

      // Determine initial state based on selection
      if (selectedModels.size > 0) {
        try {
          // Sample up to 10 models to determine checkbox state
          const sampleSize = Math.min(selectedModels.size, 10);
          const samplePaths = Array.from(selectedModels).slice(0, sampleSize);

          const printedStates = await Promise.all(
            samplePaths.map(async (filePath) => {
              const model = await window.electron.getModel(filePath);
              return model?.printed || false;
            })
          );

          // Set checkbox state based on sample
          const allPrinted = printedStates.every(state => state === true);
          const allNotPrinted = printedStates.every(state => state === false);

          if (allPrinted) {
            newCheckbox.checked = true;
          } else if (allNotPrinted) {
            newCheckbox.checked = false;
          } else {
            // Mixed state - some printed, some not
            newCheckbox.indeterminate = true;
          }
        } catch (error) {
          console.error('Error determining printed state:', error);
          newCheckbox.checked = false;
        }
      }

      // Add change event listener
      newCheckbox.addEventListener('change', async (e) => {
        console.log('Printed checkbox changed:', e.target.checked);

        // If checkbox was in indeterminate state, it becomes unchecked first
        if (e.target.indeterminate) {
          e.target.indeterminate = false;
        }

        // Save the new value to all selected models
        await autoSaveMultipleModels('printed', e.target.checked);
      });
    }

    // Show the multi-edit panel
    multiEditPanel.classList.remove('hidden');

    console.log('Multi-edit panel shown with', selectedModels.size, 'models selected');
  } catch (error) {
    console.error('Error showing multi-edit panel:', error);
  }
}

// Add a function to get or create a shared renderer
function getSharedRenderer() {
  if (!sharedRenderer || contextUseCount >= MAX_CONTEXT_REUSE_COUNT) {
    // Clean up existing resources before creating new ones
    if (sharedRenderer) {
      debugLog('Disposing old renderer after', contextUseCount, 'uses');
      sharedRenderer.dispose();
      sharedRenderer = null;
    }

    // Create a new canvas and renderer
    const canvas = document.createElement('canvas');
    canvas.width = 250;
    canvas.height = 250;

    sharedRenderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: false,
      alpha: true,
      powerPreference: 'low-power',
      precision: 'lowp',
      preserveDrawingBuffer: true
    });

    sharedRenderer.setClearColor(0x000000, 0);
    contextUseCount = 0;

    // Add context loss handler
    canvas.addEventListener('webglcontextlost', (event) => {
      debugLog('WebGL context lost, preventing default');
      event.preventDefault();
    });

    canvas.addEventListener('webglcontextrestored', () => {
      debugLog('WebGL context restored');
    });

    debugLog('Created new shared renderer');
  }

  contextUseCount++;
  return sharedRenderer;
}

// Add a function to get or create a shared scene
function getSharedScene() {
  if (!sharedScene) {
    sharedScene = new THREE.Scene();

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1).normalize();

    sharedScene.add(ambientLight);
    sharedScene.add(directionalLight);

    debugLog('Created new shared scene');
  }

  // Clear any existing objects from the scene
  while(sharedScene.children.length > 2) { // Keep the 2 lights
    const object = sharedScene.children[sharedScene.children.length - 1];
    sharedScene.remove(object);

    // Dispose of geometries and materials
    if (object.geometry) {
      object.geometry.dispose();
    }

    if (object.material) {
      if (Array.isArray(object.material)) {
        object.material.forEach(material => material.dispose());
      } else {
        object.material.dispose();
      }
    }
  }

  return sharedScene;
}

// Update the loadModel function to be more efficient
async function loadModel(filePath) {
  return new Promise((resolve, reject) => {
    const fileExtension = filePath.split('.').pop().toLowerCase();
    let loader;

    if (fileExtension === 'stl') {
      loader = new THREE.STLLoader();
    } else if (fileExtension === '3mf') {
      THREE.ThreeMFLoader.fflate = fflate;
      loader = new THREE.ThreeMFLoader();
    } else {
      reject(new Error(`Unsupported file type: ${fileExtension}`));
      return;
    }

    loader.load(
      filePath,
      (object) => {
        try {
          let mesh;

          // Handle STL files (geometry)
          if (object.isBufferGeometry) {
            const material = new THREE.MeshPhongMaterial({
              color: 0xcccccc,
              specular: 0x111111,
              shininess: 200,
              flatShading: true // Use flat shading for better performance
            });

            // Optimize geometry
            object.computeVertexNormals();

            mesh = new THREE.Mesh(object, material);

            if (fileExtension === 'stl') {
              mesh.rotation.x = -Math.PI / 2;
            }
          }
          // Handle 3MF files (object)
          else if (object.isObject3D) {
            mesh = object;

            // Apply simple material to all meshes
            mesh.traverse((child) => {
              if (child.isMesh) {
                child.material = new THREE.MeshPhongMaterial({
                  color: 0xcccccc,
                  specular: 0x111111,
                  shininess: 200,
                  flatShading: true
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
          console.error('Error processing loaded object:', error);
          reject(error);
        }
      },
      undefined,
      (error) => {
        console.error('Loader error:', error);
        reject(error);
      }
    );
  });
}
