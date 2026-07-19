// Preview modal for 3D models
console.log('[Preview] preview.js script loaded');
(function() {
  console.log('[Preview] preview.js IIFE executing');
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
  let currentBundleGroupRecord = null;

  function formatUserFacingPreviewError(error) {
    let message = error?.message || String(error || 'Unknown error');
    const ipcMatch = message.match(/Error invoking remote method 'parse-3mf-preview':\s*(?:Error:\s*)?([\s\S]+)/);
    if (ipcMatch) {
      message = ipcMatch[1].trim();
    } else if (message.startsWith('Error: ')) {
      message = message.slice(7);
    }
    if (message.includes('ERR_WORKER_OUT_OF_MEMORY') || message.includes('heap out of memory')) {
      return 'Preview ran out of memory while processing this model. Try closing other previews first, or restart the app.';
    }
    return message;
  }

  function resetPreviewLoadingUI() {
    const loading = document.getElementById('preview-loading');
    if (!loading) return;
    loading.style.display = 'flex';
    loading.innerHTML = `
      <div class="loader"></div>
      <p>Loading model...</p>
    `;
  }

  // Register preview-model listener (server mode WebSocket and normal IPC both dispatch here)
  const previewCallback = (filePath) => {
    console.log('[Preview] Received preview-model event for file:', filePath);
    try {
      openPreview(filePath);
    } catch (error) {
      console.error('[Preview] Error opening preview:', error);
    }
  };
  
  // Register listener - works in both normal mode and server mode (bridge does not register preview-model)
  if (window.electron && typeof window.electron.receive === 'function') {
    console.log('[Preview] Registering preview-model listener via receive()');
    window.electron.receive('preview-model', previewCallback);
  } else if (window.electron && typeof window.electron.on === 'function') {
    console.log('[Preview] Registering preview-model listener via on()');
    window.electron.on('preview-model', previewCallback);
  } else {
    console.warn('[Preview] window.electron not available yet, will retry');
    // Retry when electron is available
    const maxAttempts = 50;
    let attempts = 0;
    const retryInterval = setInterval(() => {
      attempts++;
      if (window.electron && typeof window.electron.receive === 'function') {
        console.log('[Preview] Registering preview-model listener via receive() (retry)');
        window.electron.receive('preview-model', previewCallback);
        clearInterval(retryInterval);
      } else if (window.electron && typeof window.electron.on === 'function') {
        console.log('[Preview] Registering preview-model listener via on() (retry)');
        window.electron.on('preview-model', previewCallback);
        clearInterval(retryInterval);
      } else if (attempts >= maxAttempts) {
        console.error('[Preview] Failed to register preview-model listener after', attempts, 'attempts');
        clearInterval(retryInterval);
      }
    }, 100);
  }

  // Initialize preview modal
  function initPreviewModal() {
    const dialog = document.getElementById('preview-dialog');
    if (!dialog) {
      console.error('[Preview] preview-dialog element not found!');
      return;
    }
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

    const slicerBtn = document.getElementById('preview-send-to-slicer');
    if (slicerBtn) {
      slicerBtn.addEventListener('click', () => {
        handlePreviewSendToSlicer();
      });
    }

    document.addEventListener('click', (event) => {
      const menu = document.getElementById('preview-slicer-menu');
      if (!menu || menu.classList.contains('hidden')) return;
      if (event.target.closest('#preview-slicer-menu') || event.target.closest('#preview-send-to-slicer')) return;
      hidePreviewSlicerMenu();
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
    console.log('[Preview] openPreview called with:', filePath);
    if (preview3mfRequestId) {
      window.electron.cancel3MFPreview?.(preview3mfRequestId);
      preview3mfRequestId = null;
    }
    currentFilePath = filePath;
    currentBundleGroupRecord = null;
    hidePreviewSlicerMenu();
    const loadToken = ++previewLoadToken;
    const dialog = document.getElementById('preview-dialog');
    
    if (!dialog) {
      console.error('[Preview] preview-dialog element not found!');
      return;
    }
    const modelName = document.getElementById('preview-model-name');
    const loading = document.getElementById('preview-loading');
    const fileType = document.getElementById('preview-file-type');
    const dimensions = document.getElementById('preview-dimensions');

    // Set model name
    const fileName = filePath.split(/[/\\]/).pop();
    modelName.textContent = fileName;

    // Show loading (reset any prior error UI)
    resetPreviewLoadingUI();
    fileType.textContent = '';
    dimensions.textContent = '';
    updatePreviewSlicerButton();

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
      if (loadToken !== previewLoadToken) return;
      console.log('Model loaded successfully');
      loading.style.display = 'none';
      updatePreviewSlicerButton();
    } catch (error) {
      if (loadToken !== previewLoadToken) return;
      const message = error && error.message ? error.message : '';
      if (message === 'Preview cancelled' || message.includes('Preview cancelled')) {
        return;
      }
      console.error('Error loading preview model:', error);
      const displayMessage = formatUserFacingPreviewError(error);
      loading.innerHTML = `
        <div style="color: #ff6b6b; text-align: center; padding: 20px; max-width: 500px;">
          <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Error loading model</p>
          <p style="font-size: 14px; line-height: 1.6; white-space: pre-line;">${displayMessage}</p>
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
  
  // Exposed for debugging and any late-loaded code; server bridge no longer calls this directly
  window.openPreview = openPreview;
  window.openBundlePreview = openBundlePreview;
  console.log('[Preview] Exposed window.openPreview and window.openBundlePreview globally');

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
      alpha: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false
    });
    if (previewRenderer.debug) {
      previewRenderer.debug.checkShaderErrors = false;
    }
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

  const MAX_STL_TRIANGLES = 10000000;

  function validateSTLBuffer(buffer) {
    if (buffer.byteLength < 84) throw new Error('STL file too small to be valid');
    const dv = new DataView(buffer);
    const triangleCount = dv.getUint32(80, true);
    const expectedBinarySize = 84 + triangleCount * 50;
    if (expectedBinarySize === buffer.byteLength && triangleCount > MAX_STL_TRIANGLES) {
      throw new Error(
        `STL has too many triangles (${triangleCount.toLocaleString()}). Max ${MAX_STL_TRIANGLES.toLocaleString()}. File may be corrupted.`
      );
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

      fetch(encodedFilePath)
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((buffer) => {
          validateSTLBuffer(buffer);
          return loader.parse(buffer);
        })
        .then((geometry) => {
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
        })
        .catch((error) => {
          console.error('STL preview load error:', error);
          reject(error);
        });
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

  function getPreviewExtension(filePath) {
    const pathForExt = filePath.includes('::') ? (filePath.split('::')[1] || '') : filePath;
    return pathForExt.split('.').pop().toLowerCase();
  }

  function isPreviewableModelPath(filePath) {
    const ext = getPreviewExtension(filePath);
    return ext === 'stl' || ext === '3mf';
  }

  function applyPartTint(object, index, total) {
    if (total <= 1) return;
    const hue = (index / total) * 0.75 + 0.05;
    const tint = new THREE.Color().setHSL(hue, 0.55, 0.52);
    object.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat, matIndex) => {
        if (!mat || mat.map || mat.vertexColors) return;
        const tinted = mat.clone();
        tinted.color = tint.clone();
        if (Array.isArray(child.material)) {
          child.material[matIndex] = tinted;
        } else {
          child.material = tinted;
        }
      });
    });
  }

  async function createPreviewObjectFromPath(filePath, loadToken) {
    if (loadToken !== previewLoadToken) {
      throw new Error('Preview cancelled');
    }

    const ext = getPreviewExtension(filePath);
    if (ext !== 'stl' && ext !== '3mf') {
      throw new Error(`Unsupported file type: ${ext}`);
    }

    if (ext === 'stl') {
      if (!THREE.STLLoader) {
        throw new Error('STLLoader not available');
      }

      const loader = new THREE.STLLoader();
      const arrayBuffer = await window.electron.readModelFile(filePath);
      if (loadToken !== previewLoadToken) {
        throw new Error('Preview cancelled');
      }

      validateSTLBuffer(arrayBuffer);
      const geometry = loader.parse(arrayBuffer);
      if (!geometry) {
        throw new Error('Failed to parse STL geometry');
      }

      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();

      const material = new THREE.MeshStandardMaterial({
        color: 0x4a9eff,
        metalness: 0.3,
        roughness: 0.6,
        flatShading: false,
        emissive: 0x002244,
        emissiveIntensity: 0.2
      });

      return new THREE.Mesh(geometry, material);
    }

    const loading = document.getElementById('preview-loading');
    if (loading && loading.querySelector('p')) {
      loading.querySelector('p').textContent =
        'Loading 3MF file...\nThis could take time for larger files.';
    }

    preview3mfRequestId = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const json = await window.electron.parse3MFPreview(filePath, preview3mfRequestId);
    if (loadToken !== previewLoadToken) {
      throw new Error('Preview cancelled');
    }

    if (!json) {
      throw new Error('Failed to load 3MF file');
    }

    const objectLoader = new THREE.ObjectLoader();
    const object = objectLoader.parse(json);
    if (!object) {
      throw new Error('Failed to parse 3MF preview');
    }

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

    const meta = json.metadata || {};
    if (meta.previewSimplified && meta.sourceTriangles && meta.keptTriangles) {
      const note = document.getElementById('preview-simplified-note');
      if (note) {
        note.textContent =
          `Simplified preview (${meta.keptTriangles.toLocaleString('en-US')} of ` +
          `${meta.sourceTriangles.toLocaleString('en-US')} triangles)`;
        note.style.display = 'inline';
      }
    } else {
      const note = document.getElementById('preview-simplified-note');
      if (note) note.style.display = 'none';
    }

    return object;
  }

  // Load preview model
  async function loadPreviewModel(filePath, loadToken) {
    const ext = getPreviewExtension(filePath);
    const fileType = document.getElementById('preview-file-type');

    fileType.textContent = `Type: ${ext.toUpperCase()}`;
    console.log('Loading model type:', ext);

    if (ext !== 'stl' && ext !== '3mf') {
      throw new Error('Preview not available for this file type. Only STL and 3MF models can be previewed in 3D.');
    }

    const object = await createPreviewObjectFromPath(filePath, loadToken);
    previewModel = object;
    previewScene.add(previewModel);
    centerAndScaleModel(previewModel);
    updateModelDimensions(previewModel);
  }

  const MAX_BUNDLE_PREVIEW_PARTS = 32;

  async function openBundlePreview(groupRecord) {
    const children = groupRecord?.children || [];
    const previewable = children.filter((child) => child?.filePath && isPreviewableModelPath(child.filePath));
    if (!previewable.length) {
      alert('No STL or 3MF models in this bundle to preview.');
      return;
    }

    const sorted = [...previewable].sort((a, b) =>
      String(a.fileName || '').localeCompare(String(b.fileName || ''), undefined, { sensitivity: 'base' })
    );
    const toLoad = sorted.slice(0, MAX_BUNDLE_PREVIEW_PARTS);
    const truncated = previewable.length > MAX_BUNDLE_PREVIEW_PARTS;

    currentFilePath = null;
    const loadToken = ++previewLoadToken;
    const dialog = document.getElementById('preview-dialog');
    if (!dialog) {
      console.error('[Preview] preview-dialog element not found!');
      return;
    }

    currentBundleGroupRecord = groupRecord;
    hidePreviewSlicerMenu();

    const modelName = document.getElementById('preview-model-name');
    const loading = document.getElementById('preview-loading');
    const fileType = document.getElementById('preview-file-type');
    const dimensions = document.getElementById('preview-dimensions');
    const groupLabel = groupRecord.groupLabel || 'Bundle';

    modelName.textContent = groupLabel;
    loading.style.display = 'flex';
    if (loading.querySelector('p')) {
      loading.querySelector('p').textContent = `Loading bundle preview (0/${toLoad.length})...`;
    }
    fileType.textContent = '';
    dimensions.textContent = '';
    updatePreviewSlicerButton();

    dialog.showModal();
    await new Promise((resolve) => setTimeout(resolve, 100));
    initPreviewScene();

    const root = new THREE.Group();
    const placed = [];
    let loadFailures = 0;

    for (let i = 0; i < toLoad.length; i++) {
      const child = toLoad[i];
      const loadingText = loading.querySelector('p');
      if (loadingText) {
        loadingText.textContent =
          `Loading bundle preview (${i + 1}/${toLoad.length})...\n${child.fileName || ''}`;
      }

      try {
        const obj = await createPreviewObjectFromPath(child.filePath, loadToken);
        applyPartTint(obj, i, toLoad.length);

        const box = new THREE.Box3().setFromObject(obj);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        obj.position.sub(center);
        placed.push({ obj, size });
      } catch (error) {
        const message = error && error.message ? error.message : '';
        if (message === 'Preview cancelled' || message.includes('Preview cancelled')) {
          return;
        }
        console.warn('Bundle preview skipped:', child.filePath, error);
        loadFailures++;
      }
    }

    if (loadToken !== previewLoadToken) return;

    if (!placed.length) {
      loading.innerHTML = `
        <div style="color: #ff6b6b; text-align: center; padding: 20px; max-width: 500px;">
          <p style="font-size: 18px; font-weight: 600; margin-bottom: 10px;">Could not load bundle preview</p>
          <p style="font-size: 14px; line-height: 1.6;">No models in this bundle could be loaded for 3D preview.</p>
          <button onclick="document.getElementById('preview-dialog').close()"
                  style="margin-top: 20px; padding: 10px 20px; background: rgba(255,255,255,0.1);
                         border: 1px solid rgba(255,255,255,0.2); border-radius: 8px;
                         color: white; cursor: pointer; font-size: 14px;">
            Close
          </button>
        </div>
      `;
      return;
    }

    const maxPartDim = Math.max(
      ...placed.map((entry) => Math.max(entry.size.x, entry.size.y, entry.size.z)),
      1
    );
    const cellSpacing = maxPartDim * 1.4;
    const cols = Math.ceil(Math.sqrt(placed.length));

    placed.forEach((entry, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      entry.obj.position.x = col * cellSpacing;
      entry.obj.position.z = -row * cellSpacing;
      root.add(entry.obj);
    });

    previewModel = root;
    previewScene.add(previewModel);
    centerAndScaleModel(previewModel);

    const bundleKind = groupRecord.children?.[0]?.bundleKind === 'zip' ? 'ZIP' : 'Folder';
    fileType.textContent = `${bundleKind} bundle • ${placed.length} model${placed.length === 1 ? '' : 's'}`;

    const dimParts = [];
    if (truncated) {
      dimParts.push(`Showing first ${MAX_BUNDLE_PREVIEW_PARTS} of ${previewable.length} previewable models`);
    }
    if (loadFailures) {
      dimParts.push(`${loadFailures} model${loadFailures === 1 ? '' : 's'} failed to load`);
    }
    dimensions.textContent = dimParts.join(' • ');

    loading.style.display = 'none';
    updatePreviewSlicerButton();
  }

  function getPreviewSlicerFilePaths() {
    if (currentFilePath && !currentFilePath.startsWith('url::')) {
      return [currentFilePath];
    }
    if (currentBundleGroupRecord?.children?.length) {
      return currentBundleGroupRecord.children
        .map((child) => child?.filePath)
        .filter((filePath) => filePath && isPreviewableModelPath(filePath) && !filePath.startsWith('url::'));
    }
    return [];
  }

  function updatePreviewSlicerButton() {
    const button = document.getElementById('preview-send-to-slicer');
    if (!button) return;

    const paths = getPreviewSlicerFilePaths();
    button.disabled = paths.length === 0;
    if (paths.length === 0) {
      button.title = 'No local model to send to slicer';
    } else if (paths.length === 1) {
      button.title = 'Open this model in your slicer';
    } else {
      button.title = `Open ${paths.length} models in your slicer`;
    }
  }

  function hidePreviewSlicerMenu() {
    const menu = document.getElementById('preview-slicer-menu');
    if (!menu) return;
    menu.classList.add('hidden');
    menu.innerHTML = '';
  }

  function showPreviewSlicerMenu(slicers, filePaths) {
    const menu = document.getElementById('preview-slicer-menu');
    if (!menu) return;

    menu.innerHTML = '';
    slicers.forEach((slicer) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'preview-slicer-menu-item';
      item.textContent = slicer.name;
      item.title = slicer.path || slicer.name;
      item.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        hidePreviewSlicerMenu();
        await sendPreviewToSlicer(slicer, filePaths);
      });
      menu.appendChild(item);
    });
    menu.classList.remove('hidden');
  }

  async function sendPreviewToSlicer(slicer, filePaths) {
    if (!window.electron?.openFileInSlicer) {
      alert('Send to slicer is not available in this mode.');
      return;
    }

    try {
      const result = await window.electron.openFileInSlicer({
        filePaths,
        slicerId: slicer.id,
        slicerName: slicer.name
      });
      if (result?.success) {
        console.log('[Preview] Sent to slicer:', slicer.name, result);
      }
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      alert(`Could not send to slicer:\n${message}`);
    }
  }

  async function loadConfiguredSlicers() {
    let slicers = [];
    try {
      if (typeof window.electron?.getSlicers === 'function') {
        slicers = await window.electron.getSlicers();
      }
    } catch (error) {
      console.error('[Preview] Error loading slicers:', error);
    }

    if (Array.isArray(slicers) && slicers.length === 1 && Array.isArray(slicers[0])) {
      slicers = slicers[0];
    }

    slicers = (Array.isArray(slicers) ? slicers : []).filter(
      (slicer) => slicer && slicer.name && slicer.path
    );

    if (slicers.length) return slicers;

    try {
      const legacyPath = await window.electron?.getSetting?.('slicerPath');
      if (legacyPath) {
        return [{ id: null, name: 'Slicer', path: legacyPath }];
      }
    } catch (error) {
      console.error('[Preview] Error loading legacy slicer path:', error);
    }

    return [];
  }

  async function handlePreviewSendToSlicer() {
    const filePaths = getPreviewSlicerFilePaths();
    if (!filePaths.length) return;

    hidePreviewSlicerMenu();

    const slicers = await loadConfiguredSlicers();

    if (!slicers.length) {
      const configure = confirm('No slicer configured. Open Slicer Settings now?');
      if (configure && typeof window.openSlicerSettings === 'function') {
        await window.openSlicerSettings();
      }
      return;
    }

    if (slicers.length === 1) {
      await sendPreviewToSlicer(slicers[0], filePaths);
      return;
    }

    showPreviewSlicerMenu(slicers, filePaths);
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

  function disposeObject3D(object) {
    if (!object) return;
    object.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
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
    if (previewScene) {
      if (previewModel) {
        previewScene.remove(previewModel);
        disposeObject3D(previewModel);
        previewModel = null;
      }
      previewScene.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach((mat) => mat.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
      while (previewScene.children.length > 0) {
        previewScene.remove(previewScene.children[0]);
      }
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
    previewAxesHelper = null;
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
    currentBundleGroupRecord = null;
    hidePreviewSlicerMenu();
    updatePreviewSlicerButton();
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initPreviewModal();
    });
  } else {
    initPreviewModal();
  }
})();
