// search.js
// This file provides functions to combine search term with the filters.
// It returns a set of filtered models and offers an initializer to add
// event listeners to the new search bar in the filter menu.

console.log('[search.js] Script loading...');

// Global variable to store the last non-empty search term
let lastSearchTerm = "";
// Flag to track if a filtering operation is in progress
let isFilteringInProgress = false;
// Generation counter so a filter change during progressive load wins over stale "rest" response
let searchGeneration = 0;

// Optional overrides: { limit, offset } for progressive load when clearing filters (Server/Docker)
async function getCombinedFilteredModels(overrides = {}) {
  // Get all models using the current sort option.
  const sortSelect = document.getElementById("sort-select");
  const sortOption = sortSelect ? sortSelect.value : "date-desc";

  // Get filter values from the filter menu.
  const designer = document.getElementById("designer-select")?.value || "";
  const license = document.getElementById("license-select")?.value || "";
  const parentModel = document.getElementById("parent-select")?.value || "";
  const printStatus = document.getElementById("printed-select")?.value || "all";
  const tagFilter = document.getElementById("tag-filter")?.value || "";
  const fileType = document.getElementById("filetype-select")?.value || "";

  // Get current search term from the new search bar in the filter menu.
  const searchInput = document.getElementById("search-filter-input");
  const currentSearchTerm = searchInput ? searchInput.value.trim() : "";

  // Check if any filters are active - if so, we should reset viewingEntireLibrary flag
  const hasActiveFilters = designer || license || parentModel || printStatus !== "all" ||
                          tagFilter || fileType || currentSearchTerm || window.currentDirectoryFilter || window.dateAddedFilter;

  if (hasActiveFilters && window.viewingEntireLibrary) {
    // Reset the flag since filters are now being applied
    window.viewingEntireLibrary = false;
    console.log("Reset viewingEntireLibrary flag due to active filters");
  }

  // Construct filters object; allow limit/offset overrides for progressive load
  const filters = {
    sortOption,
    designer,
    designerInverted: window.invertedFilters?.designer || false,
    dateAdded: window.dateAddedFilter || null,
    license,
    licenseInverted: window.invertedFilters?.license || false,
    parentModel,
    parentModelInverted: window.invertedFilters?.parentModel || false,
    printed: printStatus === "all" ? undefined : printStatus,
    tag: tagFilter,
    tagInverted: window.invertedFilters?.tag || false,
    fileType,
    search: currentSearchTerm,
    searchInverted: window.invertedFilters?.search || false,
    directory: window.currentDirectoryFilter
  };
  if (overrides.limit != null) filters.limit = overrides.limit;
  if (overrides.offset != null) filters.offset = overrides.offset;

  console.log("Requesting filtered models from backend:", filters);

  try {
    const models = await window.electron.getModelsFiltered(filters);
    console.log(`Received ${models.length} models from backend`);
    return models;
  } catch (error) {
    console.error("Error fetching filtered models:", error);
    return [];
  }
}

async function performCombinedSearch() {
  try {
    // Log the call stack to see what's calling this
    console.log("performCombinedSearch called from:", new Error().stack);
    
    // If a filtering operation is already in progress, don't start another one
    if (isFilteringInProgress) {
      console.log("Filtering operation already in progress, ignoring new request");
      return;
    }

    const myGeneration = ++searchGeneration;

    // Detect if we're loading full library (no filters) - e.g. after "Clear All Filters"
    const designer = document.getElementById("designer-select")?.value || "";
    const license = document.getElementById("license-select")?.value || "";
    const parentModel = document.getElementById("parent-select")?.value || "";
    const printStatus = document.getElementById("printed-select")?.value || "all";
    const tagFilter = document.getElementById("tag-filter")?.value || "";
    const fileType = document.getElementById("filetype-select")?.value || "";
    const searchTerm = (document.getElementById("search-filter-input")?.value || "").trim();
    const noFiltersActive = !designer && !license && !parentModel && printStatus === "all" &&
      !tagFilter && !fileType && !searchTerm && !window.currentDirectoryFilter && !window.dateAddedFilter;
    
    // Set the filtering flag to prevent concurrent operations
    isFilteringInProgress = true;
    
    // When clearing filters (full library load), skip spinner so UI feels responsive
    if (!noFiltersActive) {
      const spinner = document.getElementById('spinner');
      if (spinner) spinner.classList.remove('hidden');
      toggleFilterControls(false);
    }
    
    console.log("Performing combined search...", window.dateAddedFilter ? `dateAddedFilter: ${window.dateAddedFilter}` : 'no dateAddedFilter');
    
    // CRITICAL: If dateAddedFilter was set but is now null, restore it
    // This prevents it from being cleared by other code
    if (!window.dateAddedFilter && window._lastDateAddedFilter) {
      console.warn("dateAddedFilter was cleared! Restoring from _lastDateAddedFilter:", window._lastDateAddedFilter);
      window.dateAddedFilter = window._lastDateAddedFilter;
    }
    
    const viewLibMsg = document.getElementById("view-library-message");
    if (viewLibMsg) { viewLibMsg.style.display = "none"; }

    const serverMode = await window.electron.isServerMode().catch(() => false);
    const PROGRESSIVE_INITIAL = 400;

    let filteredModels;
    if (noFiltersActive && serverMode) {
      // Progressive load: show first batch quickly to reduce perceived lag when clearing filters (Server/Docker)
      filteredModels = await getCombinedFilteredModels({ limit: PROGRESSIVE_INITIAL });
      if (searchGeneration !== myGeneration) return;
      updateFilterIndicator(filteredModels.length);
      await window.renderFiles(filteredModels);
      // Allow filter changes while rest loads; only apply rest if this search is still current
      isFilteringInProgress = false;
      getCombinedFilteredModels({ offset: PROGRESSIVE_INITIAL })
        .then((rest) => {
          if (searchGeneration !== myGeneration) return;
          const full = filteredModels.concat(rest);
          updateFilterIndicator(full.length);
          return window.renderFiles(full);
        })
        .catch((err) => console.error("Progressive load rest failed:", err));
      return; // exit so finally runs; rest runs in background
    }

    filteredModels = await getCombinedFilteredModels();
    console.log(`Got ${filteredModels.length} filtered models, rendering...`, window.dateAddedFilter ? `(filtered by dateAdded)` : '');
    updateFilterIndicator(filteredModels.length);
    await window.renderFiles(filteredModels);
 
  } catch (error) {
    console.error("Error performing combined search:", error);
  } finally {
    // Re-enable filter controls
    toggleFilterControls(true);
    
    // Hide loading spinner
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.classList.add('hidden');
    
    // Reset the filtering flag
    isFilteringInProgress = false;
  }
}

// Function to update the filter indicator with active filters
function updateFilterIndicator(count) {
  const filterIndicator = document.getElementById("current-filter");
  if (!filterIndicator) return;
  
  // Get active filter values
  const designer = document.getElementById("designer-select")?.value || "";
  const license = document.getElementById("license-select")?.value || "";
  const parentModel = document.getElementById("parent-select")?.value || "";
  const printStatus = document.getElementById("printed-select")?.value || "all";
  const tagFilter = document.getElementById("tag-filter")?.value || "";
  const fileType = document.getElementById("filetype-select")?.value || "";
  const searchTerm = document.getElementById("search-filter-input")?.value.trim() || "";
  const inverted = window.invertedFilters || {};
  
  // Check if any filters are active
  const hasActiveFilters = designer || license || parentModel || printStatus !== "all" || tagFilter || fileType || searchTerm || window.currentDirectoryFilter;
  
  // Start with basic count message
  let message = "";
  
  if (count === 0) {
    message = `<div class="no-results">No models match your filters</div>`;
  } else {
    message = `<div class="filter-count">Showing ${count} models</div>`;
    
    // Create a container for filter pills
    if (hasActiveFilters) {
      message += `<div class="filter-pills-container">`;
      
      // Add designer filter pill if active
      if (designer) {
        const displayText = designer === "__none__" ? "No designer" : `Designer: ${designer}`;
        const invertLabel = inverted.designer ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.designer ? 'inverted' : ''}" data-filter-type="designer">
          ${displayText} ${invertLabel}
          <span class="filter-remove" data-filter-type="designer">×</span>
        </div>`;
      }
      
      // Add license filter pill if active
      if (license) {
        const displayText = license === "__none__" ? "No license" : `License: ${license}`;
        const invertLabel = inverted.license ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.license ? 'inverted' : ''}" data-filter-type="license">
          ${displayText} ${invertLabel}
          <span class="filter-remove" data-filter-type="license">×</span>
        </div>`;
      }
      
      // Add parent model filter pill if active
      if (parentModel) {
        const displayText = parentModel === "__none__" ? "No parent model" : `Parent: ${parentModel}`;
        const invertLabel = inverted.parentModel ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.parentModel ? 'inverted' : ''}" data-filter-type="parentModel">
          ${displayText} ${invertLabel}
          <span class="filter-remove" data-filter-type="parentModel">×</span>
        </div>`;
      }
      
      // Add print status filter pill if active
      if (printStatus !== "all") {
        const displayText = printStatus === "printed" ? "Printed" : "Not printed";
        message += `<div class="filter-pill" data-filter-type="printStatus">
          ${displayText}
          <span class="filter-remove" data-filter-type="printStatus">×</span>
        </div>`;
      }
      
      // Add tag filter pill if active
      if (tagFilter) {
        const invertLabel = inverted.tag ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.tag ? 'inverted' : ''}" data-filter-type="tagFilter">
          Tag: ${tagFilter} ${invertLabel}
          <span class="filter-remove" data-filter-type="tagFilter">×</span>
        </div>`;
      }
      
      // Add file type filter pill if active
      if (fileType) {
        message += `<div class="filter-pill" data-filter-type="fileType">
          Type: ${fileType}
          <span class="filter-remove" data-filter-type="fileType">×</span>
        </div>`;
      }
      
      // Add search term pill if active
      if (searchTerm) {
        const invertLabel = inverted.search ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.search ? 'inverted' : ''}" data-filter-type="searchTerm">
          Search: "${searchTerm}" ${invertLabel}
          <span class="filter-remove" data-filter-type="searchTerm">×</span>
        </div>`;
      }
      
      // Add directory filter pill if active
      if (window.currentDirectoryFilter) {
        message += `<div class="filter-pill" data-filter-type="directory">
          Directory: ${window.currentDirectoryFilter}
          <span class="filter-remove" data-filter-type="directory">×</span>
        </div>`;
      }
      
      message += `</div>`;
    }
  }
  
  // Add clear all filters button if any filters are active
  if (hasActiveFilters) {
    message += `<button class="clear-filter-button">Clear All Filters</button>`;
    
    // Only show the filter indicator if there are active filters
    filterIndicator.innerHTML = message;
    filterIndicator.classList.add('visible');
  } else {
    // Hide the filter indicator when no filters are active
    filterIndicator.innerHTML = "";
    filterIndicator.classList.remove('visible');
  }
  
  // Add event listener to clear all filters button
  const clearFilterButton = filterIndicator.querySelector('.clear-filter-button');
  if (clearFilterButton) {
    clearFilterButton.addEventListener('click', async () => {
      // Reset all filter dropdowns
      if (designer) document.getElementById("designer-select").value = "";
      if (license) document.getElementById("license-select").value = "";
      if (parentModel) document.getElementById("parent-select").value = "";
      if (printStatus !== "all") document.getElementById("printed-select").value = "all";
      if (tagFilter) document.getElementById("tag-filter").value = "";
      if (fileType) document.getElementById("filetype-select").value = "";
      
      // Clear the search input and update its clear button
      const searchInput = document.getElementById("search-filter-input");
      const clearSearchButton = document.getElementById("clear-filter-search-button");
      if (searchInput && searchTerm) {
        searchInput.value = "";
        if (clearSearchButton) {
          clearSearchButton.style.display = "none";
        }
      }
      
      // Clear the directory filter if it exists
      window.currentDirectoryFilter = "";
      
      // Clear date-added filter so "Clear All Filters" really clears everything
      window.dateAddedFilter = null;
      window._lastDateAddedFilter = null;
      
      // Clear the last search term
      lastSearchTerm = "";
      
      // Reset the filter indicator immediately so UI feels responsive
      filterIndicator.innerHTML = "";
      filterIndicator.classList.remove('visible');

      // Clear inverted flags
      if (window.invertedFilters) {
        window.invertedFilters.tag = false;
        window.invertedFilters.designer = false;
        window.invertedFilters.license = false;
        window.invertedFilters.parentModel = false;
        window.invertedFilters.search = false;
      }
      
      // Let the cleared UI paint first, then run the search (reduces perceived delay)
      await new Promise(r => requestAnimationFrame(r));
      await performCombinedSearch();
    });
  }
  
  // Add event listeners to individual filter remove buttons
  const removeButtons = filterIndicator.querySelectorAll('.filter-remove');
  removeButtons.forEach(button => {
    button.addEventListener('click', async (e) => {
      const filterType = e.target.dataset.filterType;
      
      // Clear the specific filter based on its type
      switch (filterType) {
        case 'designer':
          document.getElementById("designer-select").value = "";
          if (window.invertedFilters) window.invertedFilters.designer = false;
          break;
        case 'license':
          document.getElementById("license-select").value = "";
          if (window.invertedFilters) window.invertedFilters.license = false;
          break;
        case 'parentModel':
          document.getElementById("parent-select").value = "";
          if (window.invertedFilters) window.invertedFilters.parentModel = false;
          break;
        case 'printStatus':
          document.getElementById("printed-select").value = "all";
          break;
        case 'tagFilter':
          document.getElementById("tag-filter").value = "";
          if (window.invertedFilters) window.invertedFilters.tag = false;
          break;
        case 'fileType':
          document.getElementById("filetype-select").value = "";
          break;
        case 'searchTerm':
          const searchInput = document.getElementById("search-filter-input");
          const clearSearchButton = document.getElementById("clear-filter-search-button");
          if (searchInput) {
            searchInput.value = "";
            if (clearSearchButton) {
              clearSearchButton.style.display = "none";
            }
          }
          if (window.invertedFilters) window.invertedFilters.search = false;
          break;
        case 'directory':
          window.currentDirectoryFilter = "";
          break;
      }
      
      // Perform search with updated filters
      await performCombinedSearch();
    });
  });
}

async function initializeCombinedSearch() {
  const searchInput = document.getElementById("search-filter-input");
  const searchButton = document.getElementById("filter-search-button");
  const clearButton = document.getElementById("clear-filter-search-button");

  if (!searchInput || !searchButton || !clearButton) {
    console.error("Combined search elements not found in filter menu!");
    return;
  }

  console.log("Combined search elements found, initializing event listeners.");

  // Add filter change handlers
  const filterElements = [
    'designer-select',
    'license-select',
    'parent-select',
    'printed-select',
    'tag-filter',
    'filetype-select'
  ];

  // Remove any existing event listeners first
  filterElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      const newElement = element.cloneNode(true);
      element.parentNode.replaceChild(newElement, element);
    }
  });

  // Handle sort-select separately
  const sortSelect = document.getElementById('sort-select');
  if (sortSelect) {
    // Preserve the current value before cloning
    const currentValue = sortSelect.value;
    
    // Remove any existing event listeners
    const newSortSelect = sortSelect.cloneNode(true);
    sortSelect.parentNode.replaceChild(newSortSelect, sortSelect);
    
    // Load saved sort preference and set it (this will override the current value if a saved preference exists)
    const savedSortOption = await window.electron.getSetting('sortOption');
    if (savedSortOption) {
      // Validate that the saved option is a valid sort option
      const validOptions = ['name-asc', 'name-desc', 'size-asc', 'size-desc', 'date-asc', 'date-desc', 'dateadded-asc', 'dateadded-desc', 'directory-asc', 'directory-desc', 'designer-asc', 'designer-desc', 'parentmodel-asc', 'parentmodel-desc', 'printed-asc', 'printed-desc'];
      if (validOptions.includes(savedSortOption)) {
        newSortSelect.value = savedSortOption;
      } else {
        // If saved value is invalid, use the current value
        newSortSelect.value = currentValue;
      }
    } else {
      // If no saved preference, use the current value (which might be the default)
      newSortSelect.value = currentValue;
    }
    
    // Add new event listener specifically for sort
    newSortSelect.addEventListener('change', async (e) => {
      const sortValue = e.target.value;
      console.log(`Sort changed: ${sortValue}`);
      
      // Update sort indicators in list view header
      const listHeader = document.querySelector('.list-view-header');
      if (listHeader && listHeader.updateSortIndicators) {
        listHeader.updateSortIndicators();
      }
      
      // Save the sort preference to the database
      try {
        await window.electron.saveSetting('sortOption', sortValue);
      } catch (error) {
        console.error('Error saving sort preference:', error);
      }
      
      // Just re-run performCombinedSearch which will use the current sort option
      await performCombinedSearch();
    });
  }

  // Add new event listeners for other filters
  filterElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', async (e) => {
        // Skip if we're programmatically updating filters (e.g., when applying dateAdded filter)
        if (window._suppressFilterEvents) {
          return;
        }
        
        console.log(`Filter changed: ${elementId} = ${e.target.value}`);
        
        // If dateAddedFilter is active, only clear it if user manually changed a filter
        // (not when we're programmatically setting it via _suppressFilterEvents)
        if (window.dateAddedFilter && !window._suppressFilterEvents) {
          // User manually changed a filter, so clear dateAddedFilter
          console.log('User manually changed filter, clearing dateAddedFilter');
          window.dateAddedFilter = null;
          window._lastDateAddedFilter = null;
        }
        
        // Reset the viewingEntireLibrary flag when filters are applied
        window.viewingEntireLibrary = false;
        
        // DO NOT clear search input - preserve the search term
        // Just perform search with updated filters
        await performCombinedSearch();
      });
    }
  });

  searchButton.addEventListener("click", async () => {
    console.log("Filter search button clicked with term:", searchInput.value);
    // Clear dateAddedFilter when user searches
    if (window.dateAddedFilter) {
      console.log('User performed search, clearing dateAddedFilter');
      window.dateAddedFilter = null;
      window._lastDateAddedFilter = null;
    }
    // Reset the viewingEntireLibrary flag when search is applied
    window.viewingEntireLibrary = false;
    await performCombinedSearch();
  });

  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      console.log("Enter pressed in search field:", searchInput.value);
      // Clear dateAddedFilter when user searches
      if (window.dateAddedFilter) {
        console.log('User performed search (Enter key), clearing dateAddedFilter');
        window.dateAddedFilter = null;
        window._lastDateAddedFilter = null;
      }
      searchButton.click();
    }
  });

  clearButton.addEventListener("click", async () => {
    console.log("Clear filter search button clicked");
    searchInput.value = "";
    clearButton.classList.add("hidden");
    clearButton.style.display = "none";
    await performCombinedSearch();
    searchInput.focus();
  });

  searchInput.addEventListener("input", () => {
    if (searchInput.value.trim()) {
      clearButton.classList.remove("hidden");
      clearButton.style.display = "block";
    } else {
      clearButton.classList.add("hidden");
      clearButton.style.display = "none";
    }
  });
}

// Attach functions to the global window object IMMEDIATELY
// This ensures they're available before renderer.js tries to use them
window.getCombinedFilteredModels = getCombinedFilteredModels;
window.updateFilterIndicator = updateFilterIndicator;
window.performCombinedSearch = performCombinedSearch;
window.initializeCombinedSearch = initializeCombinedSearch;
window.isFilteringInProgress = isFilteringInProgress;
window.checkFilterStatus = function() {
  return isFilteringInProgress;
};

console.log('[search.js] Functions attached to window object');

// Make sure renderFiles is accessible
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Initializing combined search from search.js");
  await initializeCombinedSearch();
  
  // Ensure renderFiles is accessible
  if (typeof renderFiles === 'function') {
    window.renderFiles = renderFiles;
  }
});

// Helper function to toggle the enabled state of all filter controls
function toggleFilterControls(enabled) {
  const filterElements = [
    'designer-select',
    'license-select',
    'parent-select',
    'printed-select',
    'tag-filter',
    'filetype-select',
    'sort-select',
    'search-filter-input',
    'filter-search-button',
    'clear-filter-search-button',
    'view-library-button'
  ];
  
  // Apply loading class to filter section container
  const filterSection = document.querySelector('.filter-section');
  if (filterSection) {
    if (enabled) {
      filterSection.classList.remove('loading');
    } else {
      filterSection.classList.add('loading');
    }
  }
  
  filterElements.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      element.disabled = !enabled;
      // Add visual indication that controls are disabled
      if (enabled) {
        element.classList.remove('disabled-during-loading');
      } else {
        element.classList.add('disabled-during-loading');
      }
    }
  });
  
  // Also disable any clear filter buttons
  const clearFilterButtons = document.querySelectorAll('.clear-filter-button, .filter-remove');
  clearFilterButtons.forEach(button => {
    if (button) {
      button.disabled = !enabled;
      if (enabled) {
        button.classList.remove('disabled-during-loading');
      } else {
        button.classList.add('disabled-during-loading');
      }
    }
  });
}
