const DEBUG = false; // Enable debugging temporarily
const MAX_MODELS_IN_MEMORY = 500;
// Add these constants at the top level of the file
const PAGE_SIZE = 100; // Number of models to keep in memory
const DEFAULT_SORT = 'dateAdded DESC'; // Show newest models by default
const MAX_CONTEXT_USES = 20; // Reset context after this many uses
const MAX_CONTEXT_REUSE_COUNT = 100; // Add this missing constant
const MEMORY_CLEANUP_INTERVAL = 30000; // 30 seconds
const MAX_CACHED_GEOMETRIES = 200;

const fileGrid = document.querySelector('.file-grid');
const settingsDialog = document.getElementById('settings-dialog');
const aboutDialog = document.getElementById('about-dialog');
const tagDialog = document.getElementById('new-tag-dialog');
const newTagInput = document.getElementById('new-tag-name');
const addTagButton = document.getElementById('add-tag-button');
const licenseSelect = document.getElementById('license-select');
const newDesignerDialog = document.getElementById('new-designer-dialog');

const tagManagerDialog = document.getElementById('tag-manager-dialog');
const tagList = document.getElementById('tag-manager-list');
const searchInput = document.getElementById('tag-manager-search');
const clearSearchBtn = document.getElementById('clear-tag-search');
