
let BATCH_SIZE = 50; // Default batch size for database operations
let MAX_FILE_SIZE_MB = 50; // Default max file size in MB
let THUMBNAIL_BATCH_SIZE = 10; // Default batch size for thumbnails
let MAX_CONCURRENT_RENDERS = 1; // Reduce from 5 to 1 to prevent context loss
let allFilteredModels = []; // Store all filtered models (references only)
let visibleModels = []; // Store currently visible models (full data)
let currentPage = 0;
let isVirtualScrolling = false; // Flag to track if virtual scrolling is active
// RENDER_DELAY is already declared later in the file
let currentBatch = 0;
let isRendering = false;
let selectedModels = new Set();
let isMultiSelectMode = false;
let isScanning = false;

// Add these queue-related variables
let renderQueue = [];
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

// Add these variables at the top
let totalThumbnailsToGenerate = 0;
let generatedThumbnailsCount = 0;

// Add WebGL context management variables
let sharedScene = null;
let sharedCamera = null;
let contextUseCount = 0;

let allTags = [];

let fileMetadataCache = new Map();
let modelCache = new Map();
