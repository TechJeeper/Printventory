// state.js
window.state = {
  currentPage: 0,
  currentBatch: 0,
  isRendering: false,
  isMultiSelectMode: false,
  isVirtualScrolling: false,
  isScanning: false,

  isScanCancelled: false,
  isRenderCancelled: false,
  isBackgrounded: false,

  autoStartedRendering: false,
  totalThumbnailsToGenerate: 0,
  generatedThumbnailsCount: 0,
  contextUseCount: 0,

  sharedRenderer: null,
  renderContext: null,
  sharedScene: null,
  sharedCamera: null,

  selectedModels: new Set(),
  allFilteredModels: [],
  visibleModels: [],

  renderQueue: [],
  activeRenders: 0,
  isProcessingQueue: false,

  thumbnailCache: new Map()
};
