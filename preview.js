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
  let previewAmbientLight = null;
  let previewHemiLight = null;
  let previewKeyLight = null;
  let previewFillLight = null;
  let previewBackLight = null;
  let previewGround = null;
  let previewFloor = null;
  let previewRoom = null;
  let previewGrid = null;
  let previewReflection = null;
  let previewEdges = null;
  let previewEnvTarget = null;
  let previewGradientTexture = null;
  let previewWireframe = false;
  let previewTurntable = null;
  let previewAutoRotate = false;
  let previewAutoRotateSpeed = 1;
  let turntablePointer = null;
  let previewModelSize = new THREE.Vector3(100, 100, 100);
  let previewFloorY = 0;
  let currentFilePath = null;
  let previewLoadToken = 0;
  let preview3mfRequestId = null;
  let currentBundleGroupRecord = null;
  let previewFrom3mf = false;
  let previewParts = [];
  let previewFocusPartId = 'all';
  let previewPickStart = null;
  let previewSitOnFaceMode = false;
  let previewFaceHighlight = null;
  let previewRestPose = null;

  const STUDIO_STORAGE_KEY = 'printventory.previewStudio.v5';
  const STUDIO_DEFAULTS = {
    color: '#4a9eff',
    finish: 'matte',
    finishIntensity: 100,
    edges: false,
    wireframe: false,
    autoRotate: false,
    rotateSpeed: 100,
    background: 'solid',
    backdrop: 'charcoal',
    customBg: '#ffffff',
    boxSize: 100,
    reflection: 0,
    reflectionGap: 2,
    shadow: 55,
    shadowSmooth: 45,
    lightRot: 45,
    lightHeight: 48,
    light: 100,
    even: false,
    grid: false,
    transparent: false,
    fov: 42,
    panelOpen: false
  };

  const STUDIO_BACKDROP_COLORS = {
    white: '#f4f5f7',
    gray: '#c8d0d5',
    blue: '#5aa9e6',
    pink: '#e88aa3',
    mint: '#4fc9a4',
    sand: '#e2c08a',
    charcoal: '#3a3d46',
    black: '#16171c'
  };

  const STUDIO_FINISHES = {
    matte: { metalness: 0.02, roughness: 0.92 },
    gloss: { metalness: 0.08, roughness: 0.16, clearcoat: 0.9, clearcoatRoughness: 0.12 },
    metal: { metalness: 0.86, roughness: 0.28 },
    chrome: { metalness: 1, roughness: 0.06 }
  };

  function loadStudioSettings() {
    try {
      const stored = JSON.parse(localStorage.getItem(STUDIO_STORAGE_KEY) || '{}');
      const merged = { ...STUDIO_DEFAULTS, ...stored };
      if (merged.background === 'lightbox') merged.background = 'solid';
      return merged;
    } catch (_) {
      return { ...STUDIO_DEFAULTS };
    }
  }

  function persistStudioSettings(settings) {
    try {
      localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(settings));
    } catch (_) { /* ignore quota */ }
  }

  function studioEl(id) {
    return document.getElementById(id);
  }

  function studioNum(id, fallback) {
    const value = Number(studioEl(id)?.value);
    return Number.isFinite(value) ? value : fallback;
  }

  function studioChipValue(groupId, dataAttr, fallback) {
    return studioEl(groupId)?.querySelector('.active')?.dataset[dataAttr] || fallback;
  }

  function syncStudioChips(groupId, dataAttr, value) {
    const group = studioEl(groupId);
    if (!group) return;
    group.querySelectorAll(`[data-${dataAttr}]`).forEach((button) => {
      const active = button.dataset[dataAttr] === value;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function readStudioForm() {
    const panel = studioEl('preview-studio-panel');
    return {
      color: studioEl('preview-studio-color')?.value || STUDIO_DEFAULTS.color,
      finish: studioChipValue('preview-studio-finish', 'finish', STUDIO_DEFAULTS.finish),
      finishIntensity: studioNum('preview-studio-finish-intensity', STUDIO_DEFAULTS.finishIntensity),
      edges: !!studioEl('preview-studio-edges')?.checked,
      wireframe: !!studioEl('preview-studio-wireframe')?.checked,
      autoRotate: !!studioEl('preview-studio-autorotate')?.checked,
      rotateSpeed: studioNum('preview-studio-rotate-speed', STUDIO_DEFAULTS.rotateSpeed),
      background: studioChipValue('preview-studio-bg', 'bg', STUDIO_DEFAULTS.background),
      backdrop: studioChipValue('preview-studio-backdrop', 'backdrop', STUDIO_DEFAULTS.backdrop),
      customBg: studioEl('preview-studio-custom-bg')?.value || STUDIO_DEFAULTS.customBg,
      boxSize: studioNum('preview-studio-box-size', STUDIO_DEFAULTS.boxSize),
      reflection: studioNum('preview-studio-reflection', STUDIO_DEFAULTS.reflection),
      reflectionGap: studioNum('preview-studio-reflection-gap', STUDIO_DEFAULTS.reflectionGap),
      shadow: studioNum('preview-studio-shadow', STUDIO_DEFAULTS.shadow),
      shadowSmooth: studioNum('preview-studio-shadow-smooth', STUDIO_DEFAULTS.shadowSmooth),
      lightRot: studioNum('preview-studio-light-rot', STUDIO_DEFAULTS.lightRot),
      lightHeight: studioNum('preview-studio-light-height', STUDIO_DEFAULTS.lightHeight),
      light: studioNum('preview-studio-light', STUDIO_DEFAULTS.light),
      even: !!studioEl('preview-studio-even')?.checked,
      grid: !!studioEl('preview-studio-grid')?.checked,
      transparent: !!studioEl('preview-studio-transparent')?.checked,
      fov: studioNum('preview-studio-fov', STUDIO_DEFAULTS.fov),
      panelOpen: !!(panel && !panel.classList.contains('hidden'))
    };
  }

  function hydrateStudioForm(settings) {
    const s = settings || loadStudioSettings();
    const assign = (id, value, checked) => {
      const el = studioEl(id);
      if (!el) return;
      if (checked != null) el.checked = !!checked;
      else el.value = String(value);
    };
    assign('preview-studio-color', s.color);
    syncStudioChips('preview-studio-finish', 'finish', s.finish);
    assign('preview-studio-finish-intensity', s.finishIntensity);
    assign('preview-studio-edges', null, s.edges);
    assign('preview-studio-wireframe', null, s.wireframe);
    assign('preview-studio-autorotate', null, s.autoRotate);
    assign('preview-studio-rotate-speed', s.rotateSpeed);
    syncAutoRotateSpeedVisibility(!!s.autoRotate);
    syncStudioChips('preview-studio-bg', 'bg', s.background === 'lightbox' ? 'solid' : s.background);
    syncStudioChips('preview-studio-backdrop', 'backdrop', s.backdrop);
    assign('preview-studio-custom-bg', s.customBg);
    assign('preview-studio-box-size', s.boxSize);
    assign('preview-studio-reflection', s.reflection);
    assign('preview-studio-reflection-gap', s.reflectionGap);
    assign('preview-studio-shadow', s.shadow);
    assign('preview-studio-shadow-smooth', s.shadowSmooth);
    assign('preview-studio-light-rot', s.lightRot);
    assign('preview-studio-light-height', s.lightHeight);
    assign('preview-studio-light', s.light);
    assign('preview-studio-even', null, s.even);
    assign('preview-studio-grid', null, s.grid);
    assign('preview-studio-transparent', null, s.transparent);
    assign('preview-studio-fov', s.fov);
    setStudioPanelOpen(s.panelOpen !== false);
  }

  function toArrayBuffer(raw) {
    if (!raw) return null;
    if (raw instanceof ArrayBuffer) return raw;
    if (ArrayBuffer.isView(raw)) {
      return raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
    }
    if (raw.buffer) {
      return raw.buffer.slice(raw.byteOffset || 0, (raw.byteOffset || 0) + (raw.byteLength || raw.length || 0));
    }
    return null;
  }

  function looksLikeHtmlOrJson(buf) {
    if (!buf || buf.byteLength < 1) return true;
    const s = new TextDecoder('latin1')
      .decode(new Uint8Array(buf, 0, Math.min(80, buf.byteLength)))
      .trimStart()
      .slice(0, 20)
      .toLowerCase();
    return s.startsWith('<!') || s.startsWith('<html') || s.startsWith('{') || s.startsWith('file not');
  }

  async function loadLibraryFileBuffer(filePath) {
    const tryIpc = async () => {
      if (window.electron && typeof window.electron.readModelFile === 'function') {
        return toArrayBuffer(await window.electron.readModelFile(filePath));
      }
      return null;
    };

    let serverMode = false;
    try {
      serverMode = !!(window.electron && typeof window.electron.isServerMode === 'function'
        && await window.electron.isServerMode());
    } catch (_) { /* desktop */ }

    const isZipEntry = String(filePath || '').includes('::');

    // Desktop local/UNC files: IPC. Fetching /api/file from the localhost UI origin
    // often returns HTML or a truncated body for Windows paths, which then parses
    // as an empty mesh ("No mesh geometry found").
    if (!serverMode && !isZipEntry) {
      const ipcBuf = await tryIpc();
      if (ipcBuf && ipcBuf.byteLength > 0 && !looksLikeHtmlOrJson(ipcBuf)) {
        return ipcBuf;
      }
    }

    const origin = window.location && window.location.origin;
    const httpOrigin = origin && origin !== 'null' && /^https?:/i.test(origin) ? origin : null;
    if (httpOrigin && filePath) {
      const encoded = encodeURIComponent(filePath);
      const url = `${httpOrigin}${isZipEntry ? '/api/download/' : '/api/file/'}${encoded}`;
      try {
        const response = await fetch(url);
        if (response.ok) {
          const httpBuf = await response.arrayBuffer();
          if (httpBuf && httpBuf.byteLength > 0 && !looksLikeHtmlOrJson(httpBuf)) {
            return httpBuf;
          }
        }
      } catch (error) {
        console.warn('[Preview] HTTP model fetch failed, falling back to IPC:', error);
      }
    }

    const ipcBuf = await tryIpc();
    if (ipcBuf && ipcBuf.byteLength > 0) return ipcBuf;
    throw new Error('Cannot read model file');
  }

  window.loadLibraryFileBuffer = loadLibraryFileBuffer;

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

  // Server-mode WebSocket JSON turns Float32Array/Uint32Array into plain objects
  // with numeric keys; ObjectLoader then builds empty buffers (0×0×0 preview).
  function normalizePreview3mfGeometryArrays(json) {
    if (!json || !Array.isArray(json.geometries)) return json;
    for (const geometry of json.geometries) {
      const data = geometry && geometry.data;
      if (!data) continue;
      if (data.attributes) {
        for (const key of Object.keys(data.attributes)) {
          const attr = data.attributes[key];
          if (attr && attr.array != null && !Array.isArray(attr.array)) {
            attr.array = Object.values(attr.array);
          }
        }
      }
      if (data.index && data.index.array != null && !Array.isArray(data.index.array)) {
        data.index.array = Object.values(data.index.array);
      }
    }
    return json;
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

  const previewBundleCallback = (payload) => {
    console.log('[Preview] Received preview-bundle-models event:', payload?.groupLabel, payload?.children?.length);
    try {
      if (typeof openBundlePreview === 'function') {
        openBundlePreview(payload || {});
      } else {
        console.error('[Preview] openBundlePreview is not available yet');
      }
    } catch (error) {
      console.error('[Preview] Error opening bundle preview:', error);
    }
  };

  function registerPreviewChannel(channel, callback) {
    if (window.electron && typeof window.electron.receive === 'function') {
      console.log(`[Preview] Registering ${channel} listener via receive()`);
      window.electron.receive(channel, callback);
      return true;
    }
    if (window.electron && typeof window.electron.on === 'function') {
      console.log(`[Preview] Registering ${channel} listener via on()`);
      window.electron.on(channel, callback);
      return true;
    }
    return false;
  }

  // Register listener - works in both normal mode and server mode (bridge does not register preview-model)
  if (!registerPreviewChannel('preview-model', previewCallback) ||
      !registerPreviewChannel('preview-bundle-models', previewBundleCallback)) {
    console.warn('[Preview] window.electron not available yet, will retry');
    const maxAttempts = 50;
    let attempts = 0;
    const retryInterval = setInterval(() => {
      attempts++;
      const modelOk = registerPreviewChannel('preview-model', previewCallback);
      const bundleOk = registerPreviewChannel('preview-bundle-models', previewBundleCallback);
      if (modelOk && bundleOk) {
        clearInterval(retryInterval);
      } else if (attempts >= maxAttempts) {
        console.error('[Preview] Failed to register preview listeners after', attempts, 'attempts');
        clearInterval(retryInterval);
      }
    }, 100);
  }

  // Initialize preview modal
  function syncPreviewFullscreenButton(isFullscreen) {
    const btn = document.getElementById('preview-fullscreen-toggle');
    if (!btn) return;
    const full = !!isFullscreen;
    btn.title = full ? 'Exit Full Screen' : 'Full Screen';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
  }

  function togglePreviewFullscreen() {
    const dialog = document.getElementById('preview-dialog');
    if (!dialog) return;
    dialog.classList.toggle('modal-fullscreen');
    syncPreviewFullscreenButton(dialog.classList.contains('modal-fullscreen'));
    requestAnimationFrame(() => onPreviewResize());
  }

  window.togglePreviewFullscreen = togglePreviewFullscreen;
  window.syncPreviewFullscreenButton = syncPreviewFullscreenButton;

  function initPreviewModal() {
    const dialog = document.getElementById('preview-dialog');
    if (!dialog) {
      console.error('[Preview] preview-dialog element not found!');
      return;
    }
    const closeBtn = document.getElementById('close-preview');
    const resetBtn = document.getElementById('preview-reset-view');

    // Close button handler - force close even if loading
    closeBtn.addEventListener('click', () => {
      console.log('Close button clicked, forcing close...');
      closePreview();
    });

    // Reset view button
    resetBtn.addEventListener('click', () => {
      resetPreviewView();
    });

    const slicerBtn = document.getElementById('preview-send-to-slicer');
    if (slicerBtn) {
      slicerBtn.addEventListener('click', () => {
        hidePreviewSaveMenu();
        handlePreviewSendToSlicer();
      });
    }

    const studioBtn = document.getElementById('preview-toggle-studio');
    if (studioBtn) {
      studioBtn.addEventListener('click', () => {
        const panel = document.getElementById('preview-studio-panel');
        setStudioPanelOpen(panel?.classList.contains('hidden'));
        persistStudioSettings(readStudioForm());
      });
    }

    const studioClose = document.getElementById('preview-studio-close');
    if (studioClose) {
      studioClose.addEventListener('click', () => {
        setStudioPanelOpen(false);
        persistStudioSettings(readStudioForm());
      });
    }

    bindStudioControls();
    hydrateStudioForm(loadStudioSettings());
    bindPreviewPartPicker();

    const saveBtn = document.getElementById('preview-save-image');
    if (saveBtn) {
      saveBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hidePreviewSlicerMenu();
        togglePreviewSaveMenu();
      });
    }
    document.getElementById('preview-save-with-backdrop')?.addEventListener('click', () => {
      hidePreviewSaveMenu();
      savePreviewImage({ transparent: false });
    });
    document.getElementById('preview-save-transparent')?.addEventListener('click', () => {
      hidePreviewSaveMenu();
      savePreviewImage({ transparent: true });
    });

    document.addEventListener('click', (event) => {
      const slicerMenu = document.getElementById('preview-slicer-menu');
      if (slicerMenu && !slicerMenu.classList.contains('hidden')) {
        if (!event.target.closest('#preview-slicer-menu') && !event.target.closest('#preview-send-to-slicer')) {
          hidePreviewSlicerMenu();
        }
      }
      const saveMenu = document.getElementById('preview-save-menu');
      if (saveMenu && !saveMenu.classList.contains('hidden')) {
        if (!event.target.closest('#preview-save-menu') && !event.target.closest('#preview-save-image')) {
          hidePreviewSaveMenu();
        }
      }
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
    hidePreviewPartPicker();
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
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false
    });
    if (previewRenderer.debug) {
      previewRenderer.debug.checkShaderErrors = false;
    }
    previewRenderer.setSize(width, height);
    previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    previewRenderer.setClearColor(0x000000, 0);
    previewRenderer.localClippingEnabled = true;
    previewRenderer.shadowMap.enabled = true;
    if (THREE.PCFSoftShadowMap) {
      previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }
    if (THREE.sRGBEncoding) {
      previewRenderer.outputEncoding = THREE.sRGBEncoding;
    }
    if (THREE.ACESFilmicToneMapping) {
      previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
      previewRenderer.toneMappingExposure = 1.05;
    }
    console.log('Renderer created, size:', width, 'x', height);

    previewAmbientLight = new THREE.AmbientLight(0xffffff, 0.55);
    previewScene.add(previewAmbientLight);

    previewHemiLight = new THREE.HemisphereLight(0xf0f4ff, 0x2a2430, 0.35);
    previewScene.add(previewHemiLight);

    previewKeyLight = new THREE.DirectionalLight(0xfff6ea, 1.0);
    previewKeyLight.position.set(200, 240, 160);
    previewKeyLight.castShadow = true;
    previewKeyLight.shadow.mapSize.set(2048, 2048);
    previewKeyLight.shadow.bias = -0.0002;
    previewKeyLight.shadow.normalBias = 0.02;
    previewScene.add(previewKeyLight);
    previewScene.add(previewKeyLight.target);

    previewFillLight = new THREE.DirectionalLight(0xc8d8ff, 0.45);
    previewFillLight.position.set(-220, 120, -160);
    previewScene.add(previewFillLight);

    previewBackLight = new THREE.DirectionalLight(0xffffff, 0.35);
    previewBackLight.position.set(40, 80, -260);
    previewScene.add(previewBackLight);

    previewTurntable = new THREE.Group();
    previewTurntable.name = 'preview-turntable';
    previewScene.add(previewTurntable);

    createPreviewEnvironment();
    createStudioRig();

    previewWireframe = false;
    previewWireframe = false;

    // Add axes helper (initially hidden)
    previewAxesHelper = new THREE.AxesHelper(100);
    previewAxesHelper.visible = false;
    previewScene.add(previewAxesHelper);

    applyStudioSettings();

    // Create OrbitControls
    if (typeof THREE.OrbitControls !== 'undefined') {
      console.log('Creating OrbitControls...');
      previewControls = new THREE.OrbitControls(previewCamera, previewRenderer.domElement);
      previewControls.enableDamping = true;
      previewControls.dampingFactor = 0.05;
      previewControls.screenSpacePanning = true;
      previewControls.minDistance = 10;
      previewControls.maxDistance = 5000;
      previewControls.enableRotate = true;
      previewControls.autoRotate = false;
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
      const arrayBuffer = await loadLibraryFileBuffer(filePath);
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

      previewFrom3mf = false;
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

    normalizePreview3mfGeometryArrays(json);

    const objectLoader = new THREE.ObjectLoader();
    const object = objectLoader.parse(json);
    if (!object) {
      throw new Error('Failed to parse 3MF preview');
    }

    // 3MF is Z-up; the studio camera and floor are Y-up.
    if (object.quaternion && THREE.Euler) {
      object.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    } else {
      object.rotation.x = -Math.PI / 2;
    }
    object.updateMatrixWorld(true);
    previewFrom3mf = true;

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
    hidePreviewPartPicker();
    previewRestPose = null;
    setSitOnFaceMode(false);
    console.log('Loading model type:', ext);

    if (ext !== 'stl' && ext !== '3mf') {
      throw new Error('Preview not available for this file type. Only STL and 3MF models can be previewed in 3D.');
    }

    const object = await createPreviewObjectFromPath(filePath, loadToken);
    previewModel = object;
    captureOriginalMaterials(previewModel);
    enableModelShadows(previewModel);
    mountOnTurntable(previewModel);
    centerAndScaleModel(previewModel);
    captureRestPose(previewModel);
    updateModelDimensions(previewModel);
    applyStudioSettings();
    discoverPreviewParts(previewModel);
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
    previewRestPose = null;
    setSitOnFaceMode(false);

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
      entry.obj.name = child.fileName || entry.obj.name || `Part ${index + 1}`;
      entry.obj.userData.previewPart = true;
      entry.obj.userData.previewPartId = String(index);
      root.add(entry.obj);
    });

    previewModel = root;
    captureOriginalMaterials(previewModel);
    enableModelShadows(previewModel);
    mountOnTurntable(previewModel);
    centerAndScaleModel(previewModel);
    captureRestPose(previewModel);
    applyStudioSettings();

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
    discoverPreviewParts(previewModel);
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

  function isPlateLikeSize(size) {
    const span = Math.max(size.x, size.z, 1);
    return size.y > 0 && size.y < span * 0.35;
  }

  function framePreviewCamera(size, name, origin) {
    if (!previewCamera) return;
    const ox = origin?.x || 0;
    const oy = origin?.y || 0;
    const oz = origin?.z || 0;
    const plate = isPlateLikeSize(size);
    const span = Math.max(size.x, size.z, 1);
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const lookY = oy + (plate ? size.y * 0.7 : size.y * 0.4);
    const dist = plate
      ? span * (name === 'fit' ? 0.85 : 0.98)
      : maxDim * (name === 'fit' ? 1.45 : 1.7);
    const elev = plate ? Math.max(size.y * 2.8, span * 0.26) : (lookY - oy) + dist * 0.42;
    const views = {
      iso: [ox + dist, oy + elev, oz + dist],
      front: [ox, lookY + (plate ? size.y : 0), oz + dist * (plate ? 1.05 : 1.15)],
      back: [ox, lookY + (plate ? size.y : 0), oz - dist * (plate ? 1.05 : 1.15)],
      left: [ox - dist * (plate ? 1.05 : 1.15), lookY + (plate ? size.y : 0), oz],
      right: [ox + dist * (plate ? 1.05 : 1.15), lookY + (plate ? size.y : 0), oz],
      top: [ox + 0.01, oy + Math.max(dist * 1.05, span * 1.1), oz + 0.01],
      fit: [ox + dist, oy + (plate ? elev : (lookY - oy) + dist * 0.38), oz + dist]
    };
    const pos = views[name] || views.iso;
    previewCamera.position.set(pos[0], pos[1], pos[2]);
    previewCamera.lookAt(ox, lookY, oz);
    if (previewControls) {
      previewControls.target.set(ox, lookY, oz);
      previewControls.update();
    }
  }

  function hidePreviewPartPicker() {
    previewParts = [];
    previewFocusPartId = 'all';
    const picker = document.getElementById('preview-part-picker');
    if (picker) picker.classList.add('hidden');
  }

  function discoverPreviewParts(root) {
    previewParts = [];
    previewFocusPartId = 'all';
    if (!root) {
      hidePreviewPartPicker();
      return;
    }

    const marked = [];
    root.traverse((child) => {
      if (child !== root && child.userData && child.userData.previewPart) {
        marked.push(child);
      }
    });
    let candidates = marked;
    if (candidates.length < 2 && root.isGroup && root.children) {
      const kids = root.children.filter((child) => child.isMesh || child.isGroup);
      if (kids.length > 1) candidates = kids;
    }
    if (candidates.length < 2) {
      hidePreviewPartPicker();
      return;
    }

    const markedSet = new Set(candidates);
    candidates = candidates.filter((child) => {
      let parent = child.parent;
      while (parent && parent !== root) {
        if (markedSet.has(parent)) return false;
        parent = parent.parent;
      }
      return true;
    });
    if (candidates.length < 2) {
      hidePreviewPartPicker();
      return;
    }

    previewParts = candidates.map((object, index) => ({
      id: String(object.userData?.previewPartId || index),
      name: object.name || `Part ${index + 1}`,
      object
    }));
    syncPreviewPartPicker();
  }

  function previewFocusObject() {
    if (previewFocusPartId === 'all' || !previewParts.length) return previewModel;
    return previewParts.find((part) => part.id === previewFocusPartId)?.object || previewModel;
  }

  function applyPreviewPartFocus(partId, viewName = 'iso') {
    previewFocusPartId = partId || 'all';
    const showAll = previewFocusPartId === 'all';
    previewParts.forEach((part) => {
      part.object.visible = showAll || part.id === previewFocusPartId;
    });
    const target = previewFocusObject();
    if (target) {
      const box = new THREE.Box3().setFromObject(target);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      previewModelSize.copy(size);
      previewFloorY = box.min.y;
      updateStudioGroundAndShadows(target);
      updateModelDimensions(target);
      framePreviewCamera(size, viewName, new THREE.Vector3(center.x, box.min.y, center.z));
    }
    applyStudioSettings({ materials: false, room: true, reflection: true });
    syncPreviewPartPicker();
  }

  function syncPreviewPartPicker() {
    const picker = document.getElementById('preview-part-picker');
    const select = document.getElementById('preview-part-select');
    if (!picker || !select) return;
    const show = previewParts.length > 1;
    picker.classList.toggle('hidden', !show);
    if (!show) return;
    const current = previewFocusPartId;
    select.innerHTML = '<option value="all">All parts</option>' +
      previewParts.map((part) => `<option value="${part.id}">${part.name}</option>`).join('');
    select.value = previewParts.some((part) => part.id === current) ? current : 'all';
  }

  function bindPreviewPartPicker() {
    const select = document.getElementById('preview-part-select');
    select?.addEventListener('change', () => {
      applyPreviewPartFocus(select.value || 'all');
    });
    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;
    canvas.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      if (!previewSitOnFaceMode && previewParts.length < 2) return;
      previewPickStart = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!previewSitOnFaceMode) return;
      const hit = raycastPreviewModel(event);
      if (hit) showFaceHighlight(hit);
      else clearFaceHighlight();
    });
    canvas.addEventListener('pointerleave', () => {
      if (previewSitOnFaceMode) clearFaceHighlight();
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!previewPickStart || event.button !== 0) {
        previewPickStart = null;
        return;
      }
      const dx = event.clientX - previewPickStart.x;
      const dy = event.clientY - previewPickStart.y;
      previewPickStart = null;
      if ((dx * dx) + (dy * dy) > 16 || !previewCamera) return;
      if (previewSitOnFaceMode) {
        const hit = raycastPreviewModel(event);
        if (hit) sitModelOnPickedFace(hit);
        return;
      }
      if (previewParts.length < 2) return;
      const hit = raycastPreviewModel(event);
      if (!hit) return;
      let node = hit.object;
      while (node) {
        const part = previewParts.find((entry) => entry.object === node);
        if (part) {
          applyPreviewPartFocus(part.id);
          return;
        }
        node = node.parent;
      }
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && previewSitOnFaceMode) {
        setSitOnFaceMode(false);
      }
    });
  }

  function collectPreviewMeshes() {
    const meshes = [];
    const root = previewFocusObject() || previewModel;
    if (!root) return meshes;
    root.traverse((child) => {
      if (child.isMesh && child.visible && child !== previewFaceHighlight) meshes.push(child);
    });
    return meshes;
  }

  function raycastPreviewModel(event) {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas || !previewCamera) return null;
    const rect = canvas.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, previewCamera);
    const hits = raycaster.intersectObjects(collectPreviewMeshes(), false);
    return hits.find((hit) => hit.face) || null;
  }

  function worldFaceNormal(hit) {
    if (!hit || !hit.face) return null;
    const normal = hit.face.normal.clone();
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
    normal.applyMatrix3(normalMatrix).normalize();
    return normal.lengthSq() > 1e-10 ? normal : null;
  }

  function clearFaceHighlight() {
    if (!previewFaceHighlight) return;
    previewFaceHighlight.visible = false;
  }

  function disposeFaceHighlight() {
    if (!previewFaceHighlight) return;
    previewFaceHighlight.parent?.remove(previewFaceHighlight);
    previewFaceHighlight.geometry?.dispose();
    previewFaceHighlight.material?.dispose();
    previewFaceHighlight = null;
  }

  function showFaceHighlight(hit) {
    const normal = worldFaceNormal(hit);
    if (!normal || !previewScene) return;
    if (!previewFaceHighlight) {
      const geometry = new THREE.CircleGeometry(1, 40);
      const material = new THREE.MeshBasicMaterial({
        color: 0x4a9eff,
        transparent: true,
        opacity: 0.42,
        side: THREE.DoubleSide,
        depthTest: false
      });
      previewFaceHighlight = new THREE.Mesh(geometry, material);
      previewFaceHighlight.renderOrder = 20;
      previewScene.add(previewFaceHighlight);
    }
    const span = Math.max(previewModelSize.x, previewModelSize.y, previewModelSize.z, 8);
    previewFaceHighlight.scale.setScalar(Math.max(span * 0.1, 2));
    previewFaceHighlight.position.copy(hit.point).addScaledVector(normal, Math.max(span * 0.002, 0.08));
    previewFaceHighlight.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    previewFaceHighlight.visible = true;
  }

  function setSitOnFaceMode(enabled) {
    previewSitOnFaceMode = !!enabled;
    const button = document.getElementById('preview-studio-sit-face');
    const container = document.getElementById('preview-canvas-container');
    if (button) button.classList.toggle('active', previewSitOnFaceMode);
    if (container) container.classList.toggle('is-picking-face', previewSitOnFaceMode);
    if (!previewSitOnFaceMode) clearFaceHighlight();
    const hint = document.querySelector('#preview-dialog .preview-instructions p');
    if (hint) {
      hint.innerHTML = previewSitOnFaceMode
        ? '<strong>Sit on face:</strong> Click a surface to set it flat on the floor • Esc or the button again to cancel'
        : '<strong>Controls:</strong> Left click + drag to orbit • Right click + drag to pan • Scroll to zoom • Click a part to focus';
    }
  }

  function captureRestPose(model) {
    if (!model) {
      previewRestPose = null;
      return;
    }
    previewRestPose = {
      quaternion: model.quaternion.clone(),
      position: model.position.clone()
    };
  }

  function visibleWorldBox(root) {
    const box = new THREE.Box3();
    let found = false;
    if (!root) return box;
    root.updateMatrixWorld(true);
    root.traverse((child) => {
      if (!child.isMesh || !child.geometry || child === previewFaceHighlight) return;
      let node = child;
      while (node && node !== root.parent) {
        if (!node.visible) return;
        if (node === root) break;
        node = node.parent;
      }
      if (!child.geometry.boundingBox) child.geometry.computeBoundingBox();
      const childBox = child.geometry.boundingBox.clone().applyMatrix4(child.matrixWorld);
      if (!found) {
        box.copy(childBox);
        found = true;
      } else {
        box.union(childBox);
      }
    });
    return found ? box : new THREE.Box3().setFromObject(root);
  }

  function applyWorldRotationToModel(worldQuat) {
    if (!previewModel) return;
    const parentWorldQ = new THREE.Quaternion();
    if (previewModel.parent) previewModel.parent.getWorldQuaternion(parentWorldQ);
    const currentWorldQ = new THREE.Quaternion();
    previewModel.getWorldQuaternion(currentWorldQ);
    const nextWorldQ = worldQuat.clone().multiply(currentWorldQ);
    previewModel.quaternion.copy(parentWorldQ.clone().invert().multiply(nextWorldQ));
    previewModel.updateMatrixWorld(true);
  }

  function recenterModelOnFloor(model) {
    if (!model) return;
    model.updateMatrixWorld(true);
    const box = visibleWorldBox(model);
    if (!Number.isFinite(box.min.y)) return;
    const center = box.getCenter(new THREE.Vector3());
    model.position.x -= center.x;
    model.position.z -= center.z;
    seatModelOnFloor(model, 0);
    previewModelSize.copy(visibleWorldBox(model).getSize(new THREE.Vector3()));
  }

  function sitModelOnPickedFace(hit) {
    const normal = worldFaceNormal(hit);
    if (!normal || !previewModel) return;
    const align = new THREE.Quaternion().setFromUnitVectors(normal, new THREE.Vector3(0, -1, 0));
    applyWorldRotationToModel(align);
    recenterModelOnFloor(previewModel);
    setSitOnFaceMode(false);
    updateStudioGroundAndShadows(previewModel);
    updateModelDimensions(previewModel);
    applyStudioSettings({ materials: false, room: true, reflection: true });
    framePreviewCamera(previewModelSize, 'iso');
  }

  function resetModelPose() {
    if (!previewModel || !previewRestPose) return;
    previewModel.quaternion.copy(previewRestPose.quaternion);
    previewModel.position.copy(previewRestPose.position);
    previewModel.updateMatrixWorld(true);
    recenterModelOnFloor(previewModel);
    setSitOnFaceMode(false);
    updateStudioGroundAndShadows(previewModel);
    updateModelDimensions(previewModel);
    applyStudioSettings({ materials: false, room: true, reflection: true });
    framePreviewCamera(previewModelSize, 'iso');
  }

  // Center and scale model to fit in view
  function centerAndScaleModel(model) {
    console.log('Centering and scaling model...');
    
    // Get bounding box BEFORE any transformations
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    console.log('Model bounding box - center:', center, 'size:', size);

    resetTurntable();

    model.position.set(0, 0, 0);
    model.updateMatrixWorld(true);
    const seatedBox = new THREE.Box3().setFromObject(model);
    const seatedCenter = seatedBox.getCenter(new THREE.Vector3());
    model.position.x -= seatedCenter.x;
    model.position.z -= seatedCenter.z;
    seatModelOnFloor(model, 0);
    previewModelSize.copy(seatedBox.getSize(new THREE.Vector3()));
    console.log('Model seated on floor at:', model.position);

    // Calculate scale to fit model in view
    const maxDim = Math.max(size.x, size.y, size.z);
    console.log('Max dimension:', maxDim);
    
    // Don't scale if already reasonable size, just position camera appropriately
    if (maxDim === 0) {
      console.error('Model has zero dimensions!');
      return;
    }

    framePreviewCamera(size, 'iso');

    // Update axes helper size
    if (previewAxesHelper) {
      const axesSize = maxDim * 0.6;
      previewAxesHelper.scale.setScalar(axesSize / 100);
    }

    updateStudioGroundAndShadows(model);
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

    const target = previewFocusObject();
    if (target && previewParts.length > 1 && previewFocusPartId !== 'all') {
      applyPreviewPartFocus(previewFocusPartId, 'iso');
      return;
    }
    setCameraView('iso');
  }

  function applyWireframeState() {
    if (!previewModel) return;
    previewModel.traverse((child) => {
      if (!child.isMesh) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (!mat) return;
        mat.wireframe = previewWireframe;
        mat.needsUpdate = true;
      });
    });
  }

  function setStudioPanelOpen(open) {
    const panel = document.getElementById('preview-studio-panel');
    const button = document.getElementById('preview-toggle-studio');
    if (panel) panel.classList.toggle('hidden', !open);
    if (button) button.classList.toggle('active', !!open);
    requestAnimationFrame(() => onPreviewResize());
  }

  function mountOnTurntable(object) {
    if (!object) return;
    if (previewTurntable) {
      previewTurntable.add(object);
      return;
    }
    if (previewScene) previewScene.add(object);
  }

  function syncAutoRotateSpeedVisibility(enabled) {
    const wrap = studioEl('preview-studio-rotate-speed-wrap');
    if (wrap) wrap.hidden = !enabled;
  }

  function resetTurntable() {
    if (!previewTurntable) return;
    previewTurntable.rotation.set(0, 0, 0);
  }

  function bindStudioControls() {
    const applyAndSave = (options) => {
      persistStudioSettings(readStudioForm());
      applyStudioSettings(options);
    };

    const bindChipGroup = (groupId, dataAttr, options) => {
      studioEl(groupId)?.addEventListener('click', (event) => {
        const button = event.target.closest(`[data-${dataAttr}]`);
        if (!button) return;
        syncStudioChips(groupId, dataAttr, button.dataset[dataAttr]);
        applyAndSave(options);
      });
    };
    bindChipGroup('preview-studio-finish', 'finish', {});
    bindChipGroup('preview-studio-bg', 'bg', { materials: false, room: true, reflection: true });
    bindChipGroup('preview-studio-backdrop', 'backdrop', { materials: false, room: true, reflection: true });

    const materialIds = ['preview-studio-color', 'preview-studio-finish-intensity'];
    materialIds.forEach((id) => {
      studioEl(id)?.addEventListener('input', applyAndSave);
    });

    const lightOnlyIds = [
      'preview-studio-shadow', 'preview-studio-shadow-smooth', 'preview-studio-light-rot',
      'preview-studio-light-height', 'preview-studio-light', 'preview-studio-even',
      'preview-studio-fov', 'preview-studio-autorotate', 'preview-studio-rotate-speed'
    ];
    const roomIds = [
      'preview-studio-custom-bg', 'preview-studio-transparent', 'preview-studio-grid'
    ];
    const reflectionIds = ['preview-studio-reflection', 'preview-studio-reflection-gap'];

    const bindIds = (ids, options) => {
      ids.forEach((id) => {
        const el = studioEl(id);
        if (!el) return;
        const eventName = el.type === 'range' || el.type === 'color' ? 'input' : 'change';
        el.addEventListener(eventName, () => applyAndSave(options));
      });
    };
    bindIds(lightOnlyIds, { onlyLights: true });
    bindIds(roomIds, { materials: false, room: true, reflection: true });
    bindIds(reflectionIds, { materials: false, room: false, reflection: true });
    studioEl('preview-studio-edges')?.addEventListener('change', () => applyAndSave({ materials: false, room: false, reflection: false }));
    studioEl('preview-studio-wireframe')?.addEventListener('change', () => applyAndSave({ materials: false, room: false, reflection: false }));

    studioEl('preview-camera-view')?.addEventListener('click', (event) => {
      const button = event.target.closest('[data-view]');
      if (!button) return;
      setCameraView(button.dataset.view);
    });

    studioEl('preview-studio-sit-face')?.addEventListener('click', () => {
      setSitOnFaceMode(!previewSitOnFaceMode);
    });
    studioEl('preview-studio-reset-pose')?.addEventListener('click', () => {
      resetModelPose();
    });
  }

  function createPreviewEnvironment() {
    if (!previewRenderer || typeof THREE.PMREMGenerator !== 'function') return;
    try {
      const pmrem = new THREE.PMREMGenerator(previewRenderer);
      const envScene = new THREE.Scene();
      envScene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.15));
      const key = new THREE.DirectionalLight(0xfff4e5, 2.2);
      key.position.set(6, 10, 4);
      envScene.add(key);
      const fill = new THREE.DirectionalLight(0xa8c4ff, 0.9);
      fill.position.set(-8, 3, -5);
      envScene.add(fill);
      const rim = new THREE.DirectionalLight(0xffffff, 0.6);
      rim.position.set(0, 4, -8);
      envScene.add(rim);
      previewEnvTarget = pmrem.fromScene(envScene, 0.04);
      pmrem.dispose();
      if (previewScene && previewEnvTarget) {
        previewScene.environment = previewEnvTarget.texture;
      }
    } catch (error) {
      console.warn('[Preview] Could not create studio environment:', error);
    }
  }

  function createStudioRig() {
    previewRoom = new THREE.Group();
    previewRoom.name = 'preview-room';
    previewScene.add(previewRoom);

    previewGround = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshLambertMaterial({
        color: 0x3a3d46,
        side: THREE.BackSide
      })
    );
    previewGround.receiveShadow = true;
    previewGround.renderOrder = -1;
    previewRoom.add(previewGround);

    const plateParams = {
      color: 0x16171c,
      metalness: 0.08,
      roughness: 0.42,
      transparent: true,
      opacity: 0.22,
      envMapIntensity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1
    };
    previewFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      THREE.MeshPhysicalMaterial
        ? new THREE.MeshPhysicalMaterial(plateParams)
        : new THREE.MeshStandardMaterial(plateParams)
    );
    previewFloor.rotation.x = -Math.PI / 2;
    previewFloor.receiveShadow = true;
    previewFloor.renderOrder = 1;
    previewFloor.visible = false;
    previewRoom.add(previewFloor);

    previewGrid = new THREE.GridHelper(1, 20, 0x8aa0b8, 0xc5d0dc);
    previewGrid.visible = false;
    previewGrid.position.y = 0.02;
    previewScene.add(previewGrid);
  }

  function getBackdropHex(settings) {
    if (settings.backdrop === 'custom') return settings.customBg || '#ffffff';
    return STUDIO_BACKDROP_COLORS[settings.backdrop] || STUDIO_BACKDROP_COLORS.white;
  }

  function getBackdropColor(settings) {
    const color = new THREE.Color(getBackdropHex(settings));
    if (typeof color.convertSRGBToLinear === 'function') {
      color.convertSRGBToLinear();
    }
    return color;
  }

  function studioReflectionWell() {
    return Math.max(previewModelSize.y * 2.6, 8);
  }

  function setStudioMeshColor(mesh, color) {
    if (!mesh) return;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((mat) => {
      if (mat && mat.color) mat.color.copy(color);
    });
  }

  function placeStudioBox() {
    if (!previewGround) return;
    const size = previewGround.scale.x || 1;
    const well = previewFloor && previewFloor.visible ? studioReflectionWell() : 0;
    previewGround.position.set(0, previewFloorY + size / 2 - well, 0);
  }

  function seatModelOnFloor(model, floorY = 0) {
    if (!model) return;
    model.updateMatrixWorld(true);
    const box = visibleWorldBox(model);
    if (!Number.isFinite(box.min.y)) return;
    const lift = floorY - box.min.y;
    if (Math.abs(lift) > 1e-8) {
      model.position.y += lift;
      model.updateMatrixWorld(true);
    }
    previewFloorY = floorY;
  }

  function disposeRoomChildren() {
    if (!previewRoom) return;
    const keep = new Set([previewGround, previewFloor]);
    [...previewRoom.children].forEach((child) => {
      if (keep.has(child)) return;
      previewRoom.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((mat) => mat.dispose());
        else child.material.dispose();
      }
    });
  }

  function rebuildStudioRoom(settings) {
    if (!previewRoom || !previewGround) return;
    disposeRoomChildren();

    const maxDim = Math.max(previewModelSize.x, previewModelSize.y, previewModelSize.z, 20);
    const size = maxDim * 7;
    const roomColor = getBackdropColor(settings);
    const showBox = !settings.transparent && settings.background !== 'gradient';

    previewGround.scale.set(size, size, size);
    placeStudioBox();
    previewGround.visible = showBox;
    setStudioMeshColor(previewGround, roomColor);
    previewGround.receiveShadow = settings.shadow > 0 && !settings.even;

    if (previewFloor) {
      previewFloor.scale.set(size, size, 1);
      previewFloor.position.set(0, previewFloorY + 0.02, 0);
      setStudioMeshColor(previewFloor, roomColor);
      previewFloor.visible = showBox && settings.reflection > 0;
    }

    if (previewGrid) {
      previewGrid.scale.set(size, 1, size);
      previewGrid.position.set(0, previewFloorY + 0.05, 0);
    }
  }

  function createGradientTexture(top, bottom) {
    if (previewGradientTexture) {
      previewGradientTexture.dispose();
      previewGradientTexture = null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 256);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 4, 256);
    previewGradientTexture = new THREE.CanvasTexture(canvas);
    previewGradientTexture.needsUpdate = true;
    return previewGradientTexture;
  }

  function captureOriginalMaterials(object) {
    if (!object) return;
    object.traverse((child) => {
      if (!child.isMesh) return;
      if (child.userData.originalMaterial) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      child.userData.originalMaterial = materials.map((mat) => (mat ? mat.clone() : mat));
      child.userData.originalWasArray = Array.isArray(child.material);
    });
  }

  function enableModelShadows(object) {
    if (!object) return;
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
  }

  function restoreOriginalMaterials() {
    if (!previewModel) return;
    previewModel.traverse((child) => {
      if (!child.isMesh || !child.userData.originalMaterial) return;
      const originals = child.userData.originalMaterial;
      const current = Array.isArray(child.material) ? child.material : [child.material];
      current.forEach((mat) => {
        if (mat && !originals.includes(mat)) mat.dispose?.();
      });
      child.material = child.userData.originalWasArray
        ? originals.map((mat) => (mat ? mat.clone() : mat))
        : (originals[0] ? originals[0].clone() : originals[0]);
    });
  }

  function applySurfacePreset(settings) {
    if (!previewModel) return;
    if (settings.finish === 'original') {
      restoreOriginalMaterials();
      applyWireframeState();
      updateModelEdges(settings);
      return;
    }

    const preset = STUDIO_FINISHES[settings.finish] || STUDIO_FINISHES.matte;
    const mix = Math.max(0, Math.min(1, (settings.finishIntensity ?? 100) / 100));
    const lerp = (a, b, t) => a + (b - a) * t;
    const color = new THREE.Color(settings.color || STUDIO_DEFAULTS.color);
    const metalness = lerp(0.04, preset.metalness, mix);
    const roughness = lerp(0.55, preset.roughness, mix);
    const envIntensity = settings.finish === 'chrome' ? 1.6 : settings.finish === 'metal' ? 1.1 : 0.55;

    previewModel.traverse((child) => {
      if (!child.isMesh) return;
      const sources = child.userData.originalMaterial
        || (Array.isArray(child.material) ? child.material : [child.material]);
      const next = sources.map((source) => {
        const hasMap = !!(source && source.map);
        const params = {
          color: hasMap ? 0xffffff : color,
          map: source?.map || null,
          metalness,
          roughness,
          flatShading: false,
          vertexColors: false,
          transparent: !!(source && source.transparent),
          opacity: typeof source?.opacity === 'number' ? source.opacity : 1,
          envMapIntensity: envIntensity,
          side: source?.side ?? THREE.FrontSide
        };
        let material;
        if (preset.clearcoat && THREE.MeshPhysicalMaterial) {
          material = new THREE.MeshPhysicalMaterial({
            ...params,
            clearcoat: preset.clearcoat * mix,
            clearcoatRoughness: preset.clearcoatRoughness
          });
        } else {
          material = new THREE.MeshStandardMaterial(params);
        }
        material.wireframe = previewWireframe;
        return material;
      });

      const current = Array.isArray(child.material) ? child.material : [child.material];
      current.forEach((mat) => {
        if (!mat) return;
        const isOriginal = (child.userData.originalMaterial || []).includes(mat);
        if (!isOriginal) mat.dispose?.();
      });
      child.material = child.userData.originalWasArray ? next : next[0];
    });
    updateModelEdges(settings);
  }

  function updateModelEdges(settings) {
    if (previewEdges) {
      previewEdges.parent?.remove(previewEdges);
      disposeObject3D(previewEdges);
      previewEdges = null;
    }
    if (!previewModel || !settings.edges) return;

    const group = new THREE.Group();
    let meshCount = 0;
    previewModel.traverse((child) => {
      if (!child.isMesh || !child.geometry || meshCount > 12) return;
      if ((child.geometry.attributes.position?.count || 0) > 80000) return;
      meshCount += 1;
      try {
        const edges = new THREE.EdgesGeometry(child.geometry, 25);
        const lines = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35 })
        );
        lines.position.copy(child.getWorldPosition(new THREE.Vector3()));
        lines.quaternion.copy(child.getWorldQuaternion(new THREE.Quaternion()));
        lines.scale.copy(child.getWorldScale(new THREE.Vector3()));
        group.add(lines);
      } catch (_) { /* skip dense meshes */ }
    });
    previewEdges = group;
    mountOnTurntable(previewEdges);
  }

  function disposeReflection(object) {
    if (!object) return;
    object.traverse((child) => {
      if (!child.material) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (mat && mat.userData && mat.userData.previewReflection) mat.dispose();
      });
    });
  }

  function updateModelReflection(settings) {
    if (previewReflection) {
      previewReflection.parent?.remove(previewReflection);
      disposeReflection(previewReflection);
      previewReflection = null;
    }
    if (previewFloor) {
      previewFloor.visible = !settings.transparent && settings.reflection > 0;
    }
    if (!previewModel || settings.transparent || settings.reflection <= 0) return;

    const sourceBox = new THREE.Box3().setFromObject(previewModel);
    const floorY = Number.isFinite(previewFloorY) ? previewFloorY : sourceBox.min.y;
    const gap = Math.max(0, settings.reflectionGap || 0);
    const strength = Math.max(0.2, Math.min(0.85, settings.reflection / 100));
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), floorY - 0.01);

    const mirror = new THREE.Group();
    const clone = previewModel.clone(true);
    clone.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = false;
      child.receiveShadow = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      const next = materials.map((mat) => {
        const reflected = mat ? mat.clone() : new THREE.MeshStandardMaterial({ color: 0xffffff });
        reflected.transparent = true;
        reflected.opacity = strength;
        reflected.depthWrite = false;
        reflected.side = THREE.DoubleSide;
        reflected.clippingPlanes = [clipPlane];
        reflected.clipShadows = true;
        reflected.userData.previewReflection = true;
        reflected.needsUpdate = true;
        return reflected;
      });
      child.material = Array.isArray(child.material) ? next : next[0];
    });
    mirror.add(clone);
    mirror.scale.set(1, -1, 1);
    mirror.position.set(0, (2 * floorY) - gap, 0);
    mirror.renderOrder = -2;
    previewReflection = mirror;
    mountOnTurntable(previewReflection);
  }

  function applyStudioLights(settings) {
    const maxDim = Math.max(previewModelSize.x, previewModelSize.y, previewModelSize.z, 20);
    const reach = maxDim * 3.2;
    const az = (settings.lightRot * Math.PI) / 180;
    const el = (settings.lightHeight * Math.PI) / 180;
    const lookY = previewModelSize.y * 0.4;

    if (previewKeyLight) {
      previewKeyLight.position.set(
        Math.sin(az) * Math.cos(el) * reach,
        Math.sin(el) * reach,
        Math.cos(az) * Math.cos(el) * reach
      );
      previewKeyLight.target.position.set(0, lookY, 0);
      previewKeyLight.target.updateMatrixWorld();
      previewKeyLight.intensity = settings.even ? 0.35 : settings.light / 100;
      previewKeyLight.castShadow = !settings.even && settings.shadow > 0 && !settings.transparent;
      previewKeyLight.shadow.radius = 1 + (settings.shadowSmooth / 100) * 10;
      const shadowCam = previewKeyLight.shadow.camera;
      const extent = maxDim * 1.5;
      shadowCam.left = -extent;
      shadowCam.right = extent;
      shadowCam.top = extent;
      shadowCam.bottom = -extent;
      shadowCam.near = 0.5;
      shadowCam.far = reach * 3;
      shadowCam.updateProjectionMatrix();
    }
    if (previewFillLight) {
      previewFillLight.position.set(-reach * 0.7, reach * 0.35, -reach * 0.4);
      previewFillLight.intensity = settings.even ? 0.85 : 0.28;
    }
    if (previewBackLight) {
      previewBackLight.position.set(reach * 0.15, reach * 0.55, -reach * 0.85);
      previewBackLight.intensity = settings.even ? 0.55 : 0.22;
    }
    if (previewAmbientLight) {
      previewAmbientLight.intensity = settings.even ? 1.05 : 0.42;
    }
    if (previewHemiLight) {
      previewHemiLight.intensity = settings.even ? 0.7 : 0.32;
    }
    if (previewRenderer) {
      previewRenderer.shadowMap.enabled = !settings.even && settings.shadow > 0;
      if (previewRenderer.shadowMap.type !== undefined && THREE.PCFSoftShadowMap) {
        previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
    }
    if (previewGround) {
      const showBox = !settings.transparent && settings.background !== 'gradient';
      previewGround.visible = showBox;
      previewGround.receiveShadow = showBox && settings.shadow > 0 && !settings.even;
      setStudioMeshColor(previewGround, getBackdropColor(settings));
    }
    if (previewFloor) {
      const strength = Math.max(0, Math.min(1, settings.reflection / 100));
      previewFloor.material.opacity = 0.12 + (1 - strength) * 0.2;
      previewFloor.material.metalness = 0.06;
      previewFloor.material.roughness = 0.5;
      if ('envMapIntensity' in previewFloor.material) previewFloor.material.envMapIntensity = 0.15;
      previewFloor.material.needsUpdate = true;
    }
  }

  function applyStudioSettings(options = {}) {
    const settings = readStudioForm();
    const panel = studioEl('preview-studio-panel');
    const container = document.getElementById('preview-canvas-container');
    if (panel) panel.classList.toggle('is-transparent', !!settings.transparent);
    if (container) container.classList.toggle('transparent-stage', !!settings.transparent);

    if (previewScene) {
      if (settings.transparent) {
        if (previewGradientTexture) {
          previewGradientTexture.dispose();
          previewGradientTexture = null;
        }
        previewScene.background = null;
      } else if (settings.background === 'gradient') {
        const hex = getBackdropHex(settings);
        const top = new THREE.Color(hex);
        const bottom = new THREE.Color(hex);
        if (typeof top.offsetHSL === 'function') {
          top.offsetHSL(0, 0, 0.08);
          bottom.offsetHSL(0, 0, -0.12);
        }
        previewScene.background = createGradientTexture(
          `#${top.getHexString()}`,
          `#${bottom.getHexString()}`
        );
      } else {
        if (previewGradientTexture) {
          previewGradientTexture.dispose();
          previewGradientTexture = null;
        }
        previewScene.background = getBackdropColor(settings);
      }
      previewScene.environment = previewEnvTarget ? previewEnvTarget.texture : null;
    }

    if (previewCamera && previewCamera.isPerspectiveCamera) {
      previewCamera.fov = settings.fov;
      previewCamera.updateProjectionMatrix();
    }

    previewAutoRotate = !!settings.autoRotate;
    previewAutoRotateSpeed = Math.max(0.1, (settings.rotateSpeed || 100) / 100);
    syncAutoRotateSpeedVisibility(previewAutoRotate);
    if (previewControls) {
      previewControls.autoRotate = previewAutoRotate;
      previewControls.autoRotateSpeed = 2 * previewAutoRotateSpeed;
    }

    if (previewRoom) previewRoom.visible = !settings.transparent;
    if (previewGrid) previewGrid.visible = !!settings.grid && !settings.transparent;

    if (previewModel) {
      updateStudioGroundAndShadows(previewModel);
    }

    if (options.onlyLights) {
      applyStudioLights(settings);
      return;
    }

    previewWireframe = !!settings.wireframe;

    if (options.materials !== false) {
      applySurfacePreset(settings);
    } else if (options.edges !== false) {
      updateModelEdges(settings);
    }

    applyWireframeState();

    if (options.room !== false) {
      rebuildStudioRoom(settings);
    }

    applyStudioLights(settings);
    if (options.reflection !== false) {
      updateModelReflection(settings);
    }

    if (previewModel && previewFocusPartId === 'all') {
      seatModelOnFloor(previewModel, 0);
      placeStudioBox();
      if (previewFloor) previewFloor.position.y = previewFloorY + 0.02;
      if (previewGrid) previewGrid.position.y = previewFloorY + 0.03;
    }
  }

  function updateStudioGroundAndShadows(model) {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    previewFloorY = box.min.y;
    previewModelSize.copy(box.getSize(new THREE.Vector3()));
    placeStudioBox();
    if (previewFloor) previewFloor.position.y = previewFloorY + 0.02;
    if (previewGrid) previewGrid.position.y = previewFloorY + 0.03;
  }

  function setCameraView(name) {
    if (!previewCamera || !previewControls) return;
    framePreviewCamera(previewModelSize, name);
    resetTurntable();
    syncCameraViewChips(name);
  }

  function syncCameraViewChips(name) {
    const group = studioEl('preview-camera-view');
    if (!group) return;
    group.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  }

  function hidePreviewSaveMenu() {
    const menu = document.getElementById('preview-save-menu');
    if (!menu) return;
    menu.classList.add('hidden');
  }

  function togglePreviewSaveMenu() {
    const menu = document.getElementById('preview-save-menu');
    if (!menu) return;
    menu.classList.toggle('hidden');
  }

  function downloadDataUrl(dataUrl, filename) {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function previewExportBasename() {
    const nameEl = document.getElementById('preview-model-name');
    const raw = (nameEl?.textContent || 'model-preview').replace(/\.[^.]+$/, '');
    return raw.replace(/[<>:"/\\|?*]+/g, '-').trim() || 'model-preview';
  }

  function savePreviewImage({ transparent }) {
    if (!previewRenderer || !previewScene || !previewCamera) {
      alert('Nothing to save yet. Wait for the model to finish loading.');
      return;
    }

    const hidden = [];
    const hide = (obj) => {
      if (!obj) return;
      hidden.push([obj, obj.visible]);
      obj.visible = false;
    };
    hide(previewAxesHelper);
    hide(previewGrid);
    hide(previewEdges);
    const previousBackground = previewScene.background;

    if (transparent) {
      previewScene.background = null;
      hide(previewRoom);
      hide(previewGround);
    hide(previewFloor);
      hide(previewReflection);
      previewRenderer.setClearColor(0x000000, 0);
    }

    previewRenderer.render(previewScene, previewCamera);
    let dataUrl = '';
    try {
      dataUrl = previewRenderer.domElement.toDataURL('image/png');
    } catch (error) {
      console.error('[Preview] Failed to export image:', error);
      alert('Could not save the preview image.');
    }

    hidden.forEach(([obj, visible]) => {
      obj.visible = visible;
    });
    previewScene.background = previousBackground;
    applyStudioSettings({ materials: false, room: true, reflection: true });

    if (!dataUrl) return;
    const suffix = transparent ? '-preview-transparent.png' : '-preview.png';
    downloadDataUrl(dataUrl, `${previewExportBasename()}${suffix}`);
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
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((mat) => mat.dispose());
        } else {
          child.material.dispose();
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

    if (previewEnvTarget) {
      previewEnvTarget.dispose();
      previewEnvTarget = null;
    }
    if (previewGradientTexture) {
      previewGradientTexture.dispose();
      previewGradientTexture = null;
    }

    // Dispose of Three.js objects
    if (previewScene) {
      if (previewModel) {
        previewModel.parent?.remove(previewModel);
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
    previewAmbientLight = null;
    previewHemiLight = null;
    previewKeyLight = null;
    previewFillLight = null;
    previewBackLight = null;
    previewGround = null;
    previewFloor = null;
    previewRoom = null;
    previewGrid = null;
    previewReflection = null;
    previewEdges = null;
    previewTurntable = null;
    previewAutoRotate = false;
    turntablePointer = null;
    disposeFaceHighlight();
    previewRestPose = null;
    setSitOnFaceMode(false);
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
    hidePreviewPartPicker();
    hidePreviewSlicerMenu();
    hidePreviewSaveMenu();
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
