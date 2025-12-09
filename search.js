// search.js
// This file provides functions to combine search term with the filters.
// It returns a set of filtered models and offers an initializer to add
// event listeners to the new search bar in the filter menu.

// Global variable to store the last non-empty search term
let lastSearchTerm = "";
// Flag to track if a filtering operation is in progress
let isFilteringInProgress = false;

export async function getCombinedFilteredModels() {
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
                          tagFilter || fileType || currentSearchTerm || window.currentDirectoryFilter;
  
  if (hasActiveFilters && window.viewingEntireLibrary) {
    // Reset the flag since filters are now being applied
    window.viewingEntireLibrary = false;
    console.log("Reset viewingEntireLibrary flag due to active filters");
  }

  // Construct filters object
  const filters = {
    sortOption,
    designer,
    license,
    parentModel,
    printed: printStatus === "all" ? undefined : printStatus,
    tag: tagFilter,
    fileType,
    search: currentSearchTerm,
    directory: window.currentDirectoryFilter
  };

  console.log("Requesting filtered models from backend:", filters);

  try {
    // Use the new optimized IPC handler to get filtered results directly from DB
    const models = await window.electron.getModelsFiltered(filters);
    console.log(`Received ${models.length} models from backend`);
    return models;
  } catch (error) {
    console.error("Error fetching filtered models:", error);
    return [];
  }
}

export async function performCombinedSearch() {
  try {
    // If a filtering operation is already in progress, don't start another one
    if (isFilteringInProgress) {
      console.log("Filtering operation already in progress, ignoring new request");
      return;
    }
    
    // Set the filtering flag to prevent concurrent operations
    isFilteringInProgress = true;
    
    // Show loading spinner
    const spinner = document.getElementById('spinner');
    if (spinner) spinner.classList.remove('hidden');
    
    // Disable all filter controls to prevent user interaction during loading
    toggleFilterControls(false);
    
    console.log("Performing combined search...");
    const viewLibMsg = document.getElementById("view-library-message");
    if (viewLibMsg) { viewLibMsg.style.display = "none"; }
    
    // Get the filtered models
    const filteredModels = await getCombinedFilteredModels();
    console.log(`Got ${filteredModels.length} filtered models, rendering...`);
    
    // Update filter indicator with active filters
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
export function updateFilterIndicator(count) {
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
        message += `<div class="filter-pill" data-filter-type="designer">
          ${displayText}
          <span class="filter-remove" data-filter-type="designer">×</span>
        </div>`;
      }
      
      // Add license filter pill if active
      if (license) {
        const displayText = license === "__none__" ? "No license" : `License: ${license}`;
        message += `<div class="filter-pill" data-filter-type="license">
          ${displayText}
          <span class="filter-remove" data-filter-type="license">×</span>
        </div>`;
      }
      
      // Add parent model filter pill if active
      if (parentModel) {
        const displayText = parentModel === "__none__" ? "No parent model" : `Parent: ${parentModel}`;
        message += `<div class="filter-pill" data-filter-type="parentModel">
          ${displayText}
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
        message += `<div class="filter-pill" data-filter-type="tagFilter">
          Tag: ${tagFilter}
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
        message += `<div class="filter-pill" data-filter-type="searchTerm">
          Search: "${searchTerm}"
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
      
      // Clear the last search term
      lastSearchTerm = "";
      
      // Reset the filter indicator
      filterIndicator.innerHTML = "";
      filterIndicator.classList.remove('visible');
      
      // Perform search with cleared filters
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
          break;
        case 'license':
          document.getElementById("license-select").value = "";
          break;
        case 'parentModel':
          document.getElementById("parent-select").value = "";
          break;
        case 'printStatus':
          document.getElementById("printed-select").value = "all";
          break;
        case 'tagFilter':
          document.getElementById("tag-filter").value = "";
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

export function initializeCombinedSearch() {
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
    // Remove any existing event listeners
    const newSortSelect = sortSelect.cloneNode(true);
    sortSelect.parentNode.replaceChild(newSortSelect, sortSelect);
    
    // Add new event listener specifically for sort
    newSortSelect.addEventListener('change', async (e) => {
      console.log(`Sort changed: ${e.target.value}`);
      
      // Just re-run performCombinedSearch which will use the current sort option
      await performCombinedSearch();
    });
  }

  // Add new event listeners for other filters
  filterElements.forEach(elementId => {
    const element = document.getElementById(elementId);
    if (element) {
      element.addEventListener('change', async (e) => {
        console.log(`Filter changed: ${elementId} = ${e.target.value}`);
        
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
    // Reset the viewingEntireLibrary flag when search is applied
    window.viewingEntireLibrary = false;
    await performCombinedSearch();
  });

  searchInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      console.log("Enter pressed in search field:", searchInput.value);
      searchButton.click();
    }
  });

  clearButton.addEventListener("click", async () => {
    console.log("Clear filter search button clicked");
    searchInput.value = "";
    clearButton.style.display = "none";
    await performCombinedSearch();
    searchInput.focus();
  });

  searchInput.addEventListener("input", () => {
    clearButton.style.display = searchInput.value.trim() ? "block" : "none";
  });
}

// Make sure renderFiles is accessible
document.addEventListener("DOMContentLoaded", () => {
  console.log("Initializing combined search from search.js");
  initializeCombinedSearch();
  
  // Ensure renderFiles is accessible
  if (typeof renderFiles === 'function') {
    window.renderFiles = renderFiles;
  }
});

// Attach functions to the global window object
window.getCombinedFilteredModels = getCombinedFilteredModels;
window.updateFilterIndicator = updateFilterIndicator;
window.performCombinedSearch = performCombinedSearch;
window.isFilteringInProgress = isFilteringInProgress;
window.checkFilterStatus = function() {
  return isFilteringInProgress;
};

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
