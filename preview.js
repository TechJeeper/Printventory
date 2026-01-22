// Preview modal for 3D models
(function() {
  let previewScene = null;
  let previewCamera = null;
  let previewRenderer = null;
  let previewControls = null;
  let previewModel = null;
  let previewAnimationId = null;
  let previewAxesHelper = null;
  let currentFilePath = null;
  let previewLoadToken = 0;
  let preview3mfRequestId = null;

  // Initialize preview modal
  function initPreviewModal() {
    const dialog = document.getElementById('preview-dialog');
    const closeBtn = document.getElementById('close-preview');
    const resetBtn = document.getElementById('preview-reset-view');
    const wireframeBtn = document.getElementById('preview-toggle-wireframe');
    const axesBtn = document.getElementById('preview-toggle-axes');

    // Close button handler - force close even if loading
    closeBtn.addEventListener('click', () => {
      console.log('Close button clicked, forcing close...');
      closePreview();
    });

    // Reset view button
    resetBtn.addEventListener('click', () => {
      resetPreviewView();
    });

    // Toggle wireframe
    wireframeBtn.addEventListener('click', () => {
      toggleWireframe();
    });

    // Toggle axes
    axesBtn.addEventListener('click', () => {
      toggleAxes();
    });

    // Close on backdrop click
    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) {
        closePreview();
      }
    });

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dialog.open) {
        closePreview();
      }
    });

    // Listen for preview events from main process
    window.electron.receive('preview-model', (filePath) => {
      openPreview(filePath);
    });

    // Listen for 3MF preview status updates
    window.electron.on3MFPreviewStatus((requestId, message) => {
      if (requestId !== preview3mfRequestId) return;
      const loading = document.getElementById('preview-loading');
      if (loading && loading.querySelector('p')) {
        loading.querySelector('p').textContent = message;
      }
    });
  }

  // Open preview modal
  async function openPreview(filePath) {
    console.log('Opening preview for:', filePath);
    currentFilePath = filePath;
    const loadToken = ++previewLoadToken;
    const dialog = document.getElementById('preview-dialog');
    const modelName = document.getElementById('preview-model-name');
    const loading = document.getElementById('preview-loading');
    const fileType = document.getElementById('preview-file-type');
    const dimensions = document.getElementById('preview-dimensions');

    // Set model name
    const fileName = filePath.split(/[/\\]/).pop();
    modelName.textContent = fileName;

    // Show loading
    loading.style.display = 'flex';
    fileType.textContent = '';
    dimensions.textContent = '';

    // Open dialog
    dialog.showModal();

    // Wait a bit for dialog to fully render before initializing Three.js
    await new Promise(resolve => setTimeout(resolve, 100));

    // Initialize Three.js scene
    initPreviewScene();

    // Load the model
    try {
      console.log('Starting model load...');
      await loadPreviewModel(filePath, loadToken);
      console.log('Model loaded successfully');
      loading.style.display = 'none';
    } catch (error) {
      const message = error && error.message ? error.message : '';
      if (message === 'Preview cancelled' || message.includes('Preview cancelled')) {
        return;
      }
      console.error('Error loading preview model:', error);
      loading.innerHTML = `
        <div style="color: #ff6b6b; text-align: center; padding: 20px; max-width: 500px;">
          <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Error loading model</p>
          <p style="font-size: 14px; line-height: 1.6; white-space: pre-line;">${error.message}</p>
          <button onclick="document.getElementById('preview-dialog').close()" 
                  style="margin-top: 20px; padding: 10px 20px; background: rgba(255,255,255,0.1); 
                         border: 1px solid rgba(255,255,255,0.2); border-radius: 8px; 
                         color: white; cursor: pointer; font-size: 14px;">
            Close
          </button>
        </div>
      `;
    }
  }

  // Initialize Three.js scene
  function initPreviewScene() {
    const container = document.getElementById('preview-canvas-container');
    const canvas = document.getElementById('preview-canvas');

    // Clear existing scene
    if (previewRenderer) {
      cleanupPreviewScene();
    }

    // Get container dimensions
    const width = container.clientWidth;
    const height = container.clientHeight;
    console.log('Initializing preview scene, container size:', width, 'x', height);
    
    if (width === 0 || height === 0) {
      console.error('Container has zero dimensions!', {width, height});
    }

    // Create scene
    previewScene = new THREE.Scene();
    previewScene.background = new THREE.Color(0x2a2a3e);
    console.log('Scene created with background:', previewScene.background);

    // Create camera
    previewCamera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
    previewCamera.position.set(100, 100, 100);
    console.log('Camera created at:', previewCamera.position);

    // Create renderer
    previewRenderer = new THREE.WebGLRenderer({ 
      canvas: canvas,
      antialias: true,
      alpha: false
    });
    previewRenderer.setSize(width, height);
    previewRenderer.setPixelRatio(window.devicePixelRatio);
    previewRenderer.shadowMap.enabled = true;
    console.log('Renderer created, size:', width, 'x', height);

    // Add lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    previewScene.add(ambientLight);
    console.log('Added ambient light');

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(200, 200, 200);
    keyLight.castShadow = true;
    previewScene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.6);
    fillLight.position.set(-200, 100, -200);
    previewScene.add(fillLight);

    const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
    backLight.position.set(0, -200, -200);
    previewScene.add(backLight);
    
    console.log('Added 3 directional lights');

    // Add axes helper (initially hidden)
    previewAxesHelper = new THREE.AxesHelper(100);
    previewAxesHelper.visible = false;
    previewScene.add(previewAxesHelper);

    // Create OrbitControls
    if (typeof THREE.OrbitControls !== 'undefined') {
      console.log('Creating OrbitControls...');
      previewControls = new THREE.OrbitControls(previewCamera, previewRenderer.domElement);
      previewControls.enableDamping = true;
      previewControls.dampingFactor = 0.05;
      previewControls.screenSpacePanning = true;
      previewControls.minDistance = 10;
      previewControls.maxDistance = 5000;
      previewControls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.PAN
      };
      console.log('OrbitControls created successfully');
    } else {
      console.error('THREE.OrbitControls is not available!');
    }

    // Handle window resize
    window.addEventListener('resize', onPreviewResize);

    // Start animation loop
    animatePreview();
  }

  function getEncodedFilePath(filePath) {
    try {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const prefix = normalizedPath.startsWith('/') ? 'file://' : 'file:///';
      return `${prefix}${normalizedPath}`
        .replace(/#/g, '%23')
        .replace(/\?/g, '%3F')
        .replace(/\s/g, '%20')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/'/g, '%27')
        .replace(/\[/g, '%5B')
        .replace(/\]/g, '%5D');
    } catch (error) {
      console.error('Error encoding file path:', error);
      return `file://${filePath.replace(/\\/g, '/').replace(/#/g, '%23').replace(/\s/g, '%20')}`;
    }
  }

  function loadSTLFromPath(filePath, loadToken) {
    return new Promise((resolve, reject) => {
      if (!THREE.STLLoader) {
        reject(new Error('STLLoader not available'));
        return;
      }

      const loader = new THREE.STLLoader();
      const encodedFilePath = getEncodedFilePath(filePath);

      loader.load(
        encodedFilePath,
        (geometry) => {
          if (loadToken !== previewLoadToken) {
            reject(new Error('Preview cancelled'));
            return;
          }

          if (!geometry) {
            reject(new Error('Failed to parse STL geometry'));
            return;
          }

          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();

          const material = new THREE.MeshStandardMaterial({
            color: 0x4a4a4a,
            metalness: 0.85,
            roughness: 0.35,
            flatShading: false
          });

          const mesh = new THREE.Mesh(geometry, material);
          resolve(mesh);
        },
        undefined,
        (error) => {
          console.error('STL preview load error:', error);
          reject(error);
        }
      );
    });
  }

  function hasColorData(object) {
    let hasColor = false;
    object.traverse((child) => {
      if (!child.isMesh) return;
      const geometry = child.geometry;
      if (geometry && geometry.attributes && geometry.attributes.color) {
        hasColor = true;
      }
      const material = child.material;
      const materials = Array.isArray(material) ? material : [material];
      for (const mat of materials) {
        if (!mat) continue;
        if (mat.map || mat.vertexColors) {
          hasColor = true;
        }
        if (mat.color) {
          const { r, g, b } = mat.color;
          if (r > 0.05 || g > 0.05 || b > 0.05) {
            hasColor = true;
          }
        }
      }
    });
    return hasColor;
  }

  function applyDefaultMetalMaterial(object) {
    const material = new THREE.MeshStandardMaterial({
      color: 0x4a4a4a,
      metalness: 0.85,
      roughness: 0.35,
      flatShading: false
    });

    object.traverse((child) => {
      if (!child.isMesh) return;
      if (Array.isArray(child.material)) {
        child.material = child.material.map(() => material.clone());
      } else {
        child.material = material.clone();
      }
    });
  }

  function ensureLitMaterials(object) {
    object.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat, index) => {
        if (!mat) return;
        const hasTexture = !!mat.map;
        const usesVertexColors = !!mat.vertexColors;
        const color = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
        if (hasTexture || usesVertexColors) {
          color.set(0xffffff);
        }
        if (mat.isMeshBasicMaterial) {
          const converted = new THREE.MeshStandardMaterial({
            color,
            map: mat.map || null,
            metalness: 0.15,
            roughness: 0.65,
            flatShading: mat.flatShading || false,
            vertexColors: mat.vertexColors || false,
            transparent: mat.transparent || false,
            opacity: typeof mat.opacity === 'number' ? mat.opacity : 1
          });
          if (Array.isArray(child.material)) {
            child.material[index] = converted;
          } else {
            child.material = converted;
          }
        } else if (mat.isMeshPhongMaterial) {
          const converted = new THREE.MeshStandardMaterial({
            color,
            map: mat.map || null,
            metalness: 0.2,
            roughness: 0.55,
            flatShading: mat.flatShading || false,
            vertexColors: mat.vertexColors || false,
            transparent: mat.transparent || false,
            opacity: typeof mat.opacity === 'number' ? mat.opacity : 1
          });
          if (Array.isArray(child.material)) {
            child.material[index] = converted;
          } else {
            child.material = converted;
          }
        }
      });
    });
  }

  // Load preview model
  async function loadPreviewModel(filePath, loadToken) {
    return new Promise(async (resolve, reject) => {
      if (loadToken !== previewLoadToken) {
        reject(new Error('Preview cancelled'));
        return;
      }
      const ext = filePath.split('.').pop().toLowerCase();
      const fileType = document.getElementById('preview-file-type');
      
      fileType.textContent = `Type: ${ext.toUpperCase()}`;
      console.log('Loading model type:', ext);

      try {
        if (ext === 'stl') {
          // Load STL
          if (!THREE.STLLoader) {
            throw new Error('STLLoader not available');
          }
          
          console.log('Creating STL loader...');
          const loader = new THREE.STLLoader();
          
          // Read file data as ArrayBuffer
          console.log('Reading STL file...');
          const arrayBuffer = await window.electron.readModelFile(filePath);
          if (loadToken !== previewLoadToken) {
            reject(new Error('Preview cancelled'));
            return;
          }
          console.log('STL file read, size:', arrayBuffer.byteLength, 'bytes');
          
          // Parse the STL data
          console.log('Parsing STL data...');
          const geometry = loader.parse(arrayBuffer);
          console.log('STL parsed, geometry:', geometry);
          
          if (!geometry) {
            throw new Error('Failed to parse STL geometry');
          }

          // Compute normals and bounding box
          geometry.computeVertexNormals();
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
          console.log('Geometry computed - vertices:', geometry.attributes.position.count);
          console.log('Geometry bounding box:', geometry.boundingBox);

          // Create mesh with material
          const material = new THREE.MeshStandardMaterial({
            color: 0x4a9eff,
            metalness: 0.3,
            roughness: 0.6,
            flatShading: false,
            emissive: 0x002244,
            emissiveIntensity: 0.2
          });

          previewModel = new THREE.Mesh(geometry, material);
          previewScene.add(previewModel);
          console.log('STL mesh added to scene, position:', previewModel.position);
          console.log('Mesh in scene:', previewScene.children.includes(previewModel));

          // Center and scale the model
          centerAndScaleModel(previewModel);
          updateModelDimensions(previewModel);
          
          resolve();

        } else if (ext === '3mf') {
          // Load 3MF via main-process worker for responsiveness
          const loading = document.getElementById('preview-loading');
          if (loading && loading.querySelector('p')) {
            loading.querySelector('p').textContent =
              'Loading 3MF file...\nThis could take time for larger files.';
          }

          preview3mfRequestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
          const json = await window.electron.parse3MFPreview(filePath, preview3mfRequestId);
          if (loadToken !== previewLoadToken) {
            reject(new Error('Preview cancelled'));
            return;
          }

          if (!json) {
            throw new Error('Failed to load 3MF file');
          }

          const objectLoader = new THREE.ObjectLoader();
          const object = objectLoader.parse(json);
          if (!object) {
            throw new Error('Failed to parse 3MF preview');
          }

          // Ensure geometry has normals computed
          object.traverse((child) => {
            if (child.isMesh && child.geometry) {
              if (!child.geometry.attributes.normal || child.geometry.attributes.normal.count === 0) {
                child.geometry.computeVertexNormals();
              }
            }
          });

          if (!hasColorData(object)) {
            applyDefaultMetalMaterial(object);
          } else {
            ensureLitMaterials(object);
          }

          previewModel = object;
          previewScene.add(previewModel);

          centerAndScaleModel(previewModel);
          updateModelDimensions(previewModel);

          resolve();

        } else {
          throw new Error(`Unsupported file type: ${ext}`);
        }

      } catch (error) {
        reject(error);
      }
    });
  }

  // Center and scale model to fit in view
  function centerAndScaleModel(model) {
    console.log('Centering and scaling model...');
    
    // Get bounding box BEFORE any transformations
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    console.log('Model bounding box - center:', center, 'size:', size);

    // Center the model at origin
    model.position.set(0, 0, 0);
    model.position.sub(center);
    console.log('Model centered at:', model.position);

    // Calculate scale to fit model in view
    const maxDim = Math.max(size.x, size.y, size.z);
    console.log('Max dimension:', maxDim);
    
    // Don't scale if already reasonable size, just position camera appropriately
    if (maxDim === 0) {
      console.error('Model has zero dimensions!');
      return;
    }

    // Position camera based on model size
    const distance = maxDim * 1.5;
    previewCamera.position.set(distance, distance * 0.7, distance);
    previewCamera.lookAt(0, 0, 0);
    console.log('Camera positioned at distance:', distance, 'position:', previewCamera.position);

    // Update controls
    if (previewControls) {
      previewControls.target.set(0, 0, 0);
      previewControls.update();
    }

    // Update axes helper size
    if (previewAxesHelper) {
      const axesSize = maxDim * 0.6;
      previewAxesHelper.scale.setScalar(axesSize / 100);
    }
  }

  // Update model dimensions display
  function updateModelDimensions(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    
    // Dimensions in mm (assuming model units are mm)
    const dimensions = document.getElementById('preview-dimensions');
    dimensions.textContent = `Dimensions: ${size.x.toFixed(1)} × ${size.y.toFixed(1)} × ${size.z.toFixed(1)} mm`;
  }

  // Reset preview view
  function resetPreviewView() {
    if (!previewModel || !previewCamera || !previewControls) {
      console.log('Cannot reset view - missing:', {
        model: !!previewModel,
        camera: !!previewCamera,
        controls: !!previewControls
      });
      return;
    }

    const box = new THREE.Box3().setFromObject(previewModel);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    console.log('Reset view - size:', size, 'maxDim:', maxDim);

    if (maxDim === 0) {
      console.error('Model has zero dimensions in reset view');
      return;
    }

    // Position camera
    const distance = maxDim * 2.5;
    previewCamera.position.set(distance, distance * 0.7, distance);
    previewCamera.lookAt(0, 0, 0);
    console.log('Camera positioned at:', previewCamera.position, 'distance:', distance);

    // Reset controls
    previewControls.target.set(0, 0, 0);
    previewControls.update();
  }

  // Toggle wireframe mode
  function toggleWireframe() {
    if (!previewModel) return;

    previewModel.traverse((child) => {
      if (child.isMesh) {
        child.material.wireframe = !child.material.wireframe;
      }
    });
  }

  // Toggle axes helper
  function toggleAxes() {
    if (previewAxesHelper) {
      previewAxesHelper.visible = !previewAxesHelper.visible;
    }
  }

  // Animation loop
  let frameCount = 0;
  function animatePreview() {
    previewAnimationId = requestAnimationFrame(animatePreview);

    if (previewControls) {
      previewControls.update();
    }

    if (previewRenderer && previewScene && previewCamera) {
      previewRenderer.render(previewScene, previewCamera);
      
      // Log once for debugging
      if (frameCount === 0) {
        console.log('First render - Scene children:', previewScene.children.length);
        console.log('Camera position:', previewCamera.position);
        console.log('Camera looking at:', previewControls ? previewControls.target : 'no controls');
        console.log('Canvas size:', previewRenderer.domElement.width, 'x', previewRenderer.domElement.height);
      }
      frameCount++;
    }
  }

  // Handle window resize
  function onPreviewResize() {
    if (!previewCamera || !previewRenderer) return;

    const container = document.getElementById('preview-canvas-container');
    const width = container.clientWidth;
    const height = container.clientHeight;

    previewCamera.aspect = width / height;
    previewCamera.updateProjectionMatrix();
    previewRenderer.setSize(width, height);
  }

  // Cleanup preview scene
  function cleanupPreviewScene() {
    // Stop animation
    if (previewAnimationId) {
      cancelAnimationFrame(previewAnimationId);
      previewAnimationId = null;
    }

    // Remove resize listener
    window.removeEventListener('resize', onPreviewResize);

    // Dispose of Three.js objects
    if (previewModel) {
      previewModel.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(mat => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      previewScene.remove(previewModel);
      previewModel = null;
    }

    if (previewRenderer) {
      previewRenderer.dispose();
      previewRenderer = null;
    }

    if (previewControls) {
      previewControls.dispose();
      previewControls = null;
    }

    previewScene = null;
    previewCamera = null;
  }

  // Close preview modal
  function closePreview() {
    const dialog = document.getElementById('preview-dialog');
    previewLoadToken++;
    if (preview3mfRequestId) {
      window.electron.cancel3MFPreview?.(preview3mfRequestId);
      preview3mfRequestId = null;
    }
    cleanupPreviewScene();
    dialog.close();
    currentFilePath = null;
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreviewModal);
  } else {
    initPreviewModal();
  }
})();
