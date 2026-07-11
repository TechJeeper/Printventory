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

  // Get filter values from the filter menu (multi-value + query builder filled in below).
  const designer = document.getElementById("designer-select")?.value || "";
  const license = document.getElementById("license-select")?.value || "";
  const parentModel = document.getElementById("parent-select")?.value || "";
  const printStatus = document.getElementById("printed-select")?.value || "all";
  const newStatus = document.getElementById("new-select")?.value || "all";
  const favoriteStatus = document.getElementById("favorite-select")?.value || "all";
  const ratingStatus = document.getElementById("rating-select")?.value || "all";
  const ratingMinStatus = document.getElementById("rating-min-select")?.value || "all";
  const tagFilter = document.getElementById("tag-filter")?.value || "";
  const fileType = document.getElementById("filetype-select")?.value || "";

  const activeSearchClauses =
    typeof window.queryBuilderHasActiveSearchClauses === "function" &&
    window.queryBuilderHasActiveSearchClauses();
  const activeMulti =
    typeof window.queryBuilderHasActiveMultiFilters === "function" &&
    window.queryBuilderHasActiveMultiFilters();

  // Check if any filters are active - if so, we should reset viewingEntireLibrary flag
  // Draft text in the search box alone does not count until you press search (clauses/tokens).
  const hasActiveFilters = designer || license || parentModel || printStatus !== "all" ||
                          newStatus !== "all" ||
                          favoriteStatus !== "all" ||
                          ratingStatus !== "all" ||
                          ratingMinStatus !== "all" ||
                          tagFilter || fileType || activeSearchClauses || activeMulti ||
                          window.currentDirectoryFilter || window.dateAddedFilter;

  if (hasActiveFilters && window.viewingEntireLibrary) {
    // Reset the flag since filters are now being applied
    window.viewingEntireLibrary = false;
    console.log("Reset viewingEntireLibrary flag due to active filters");
  }

  const filters = {
    sortOption,
    designerInverted: window.invertedFilters?.designer || false,
    dateAdded: window.dateAddedFilter || null,
    licenseInverted: window.invertedFilters?.license || false,
    parentModelInverted: window.invertedFilters?.parentModel || false,
    printed: printStatus === "all" ? undefined : printStatus,
    isNew: newStatus === "all" ? undefined : newStatus,
    favorite: favoriteStatus === "all" ? undefined : favoriteStatus,
    rating: ratingStatus === "all" ? undefined : ratingStatus,
    ratingMin: ratingMinStatus === "all" ? undefined : ratingMinStatus,
    tagInverted: window.invertedFilters?.tag || false,
    fileType,
    searchInverted: window.invertedFilters?.search || false,
    directory: window.currentDirectoryFilter
  };
  if (typeof window.queryBuilderAppendExtendedFilterFields === "function") {
    window.queryBuilderAppendExtendedFilterFields(filters);
  } else {
    const searchInputValue = (document.getElementById("search-filter-input")?.value || "").trim();
    const resolvedSearchTerm = searchInputValue || lastSearchTerm || "";
    filters.designer = designer;
    filters.license = license;
    filters.parentModel = parentModel;
    filters.tag = tagFilter;
    filters.search = resolvedSearchTerm;
  }
  if (overrides.limit != null) filters.limit = overrides.limit;
  if (overrides.offset != null) filters.offset = overrides.offset;

  try {
    const models = await window.electron.getModelsFiltered(filters);
    return models;
  } catch (error) {
    console.error("Error fetching filtered models:", error);
    return [];
  }
}

async function performCombinedSearch() {
  try {
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
    const newStatus = document.getElementById("new-select")?.value || "all";
    const favoriteStatus = document.getElementById("favorite-select")?.value || "all";
    const ratingStatus = document.getElementById("rating-select")?.value || "all";
    const ratingMinStatus = document.getElementById("rating-min-select")?.value || "all";
    const tagFilter = document.getElementById("tag-filter")?.value || "";
    const fileType = document.getElementById("filetype-select")?.value || "";
    const qbClauses =
      typeof window.queryBuilderHasActiveSearchClauses === "function" &&
      window.queryBuilderHasActiveSearchClauses();
    const qbMulti =
      typeof window.queryBuilderHasActiveMultiFilters === "function" &&
      window.queryBuilderHasActiveMultiFilters();
    const noFiltersActive = !designer && !license && !parentModel && printStatus === "all" &&
      newStatus === "all" &&
      favoriteStatus === "all" &&
      ratingStatus === "all" &&
      ratingMinStatus === "all" &&
      !tagFilter && !fileType && !qbClauses && !qbMulti &&
      !window.currentDirectoryFilter && !window.dateAddedFilter;
    
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

    // Full library (no filters): load in chunks so we do not pull/render tens of thousands of rows in one IPC pass.
    // Cannot use SQL LIMIT when tag filter is active — main process applies tags after the query.
    const PROGRESSIVE_INITIAL = 500;
    const PROGRESSIVE_CHUNK = 1200;
    const useProgressiveFullLibrary = noFiltersActive;

    let filteredModels;
    if (useProgressiveFullLibrary) {
      filteredModels = await getCombinedFilteredModels({ limit: PROGRESSIVE_INITIAL });
      if (searchGeneration !== myGeneration) return;
      if (filteredModels.length === 0) {
        // Empty library is normal; do not reopen the onboarding welcome dialog here —
        // that caused a loop (dismiss → search → 0 models → showModal again).
        const viewLibMsg = document.getElementById('view-library-message');
        if (viewLibMsg) viewLibMsg.style.display = 'none';
        updateFilterIndicator(0);
        await window.renderFiles(filteredModels);
        isFilteringInProgress = false;
        return;
      }
      updateFilterIndicator(filteredModels.length);
      await window.renderFiles(filteredModels);
      isFilteringInProgress = false;

      (async () => {
        try {
          let acc = filteredModels.slice();
          let offset = acc.length;
          while (true) {
            const chunk = await getCombinedFilteredModels({
              limit: PROGRESSIVE_CHUNK,
              offset
            });
            if (searchGeneration !== myGeneration) return;
            if (!chunk || chunk.length === 0) break;
            acc = acc.concat(chunk);
            offset += chunk.length;
            updateFilterIndicator(acc.length);
            await window.renderFiles(acc);
            // Yield so layout, thumbnail decode, and input can run between large virtual-grid updates.
            await new Promise((r) => {
              if (typeof requestIdleCallback !== 'undefined') {
                requestIdleCallback(() => r(), { timeout: 100 });
              } else {
                setTimeout(r, 48);
              }
            });
          }
        } catch (err) {
          console.error("Progressive library load failed:", err);
        }
      })();
      return;
    }

    filteredModels = await getCombinedFilteredModels();
    console.log(`Got ${filteredModels.length} filtered models, rendering...`, window.dateAddedFilter ? `(filtered by dateAdded)` : '');
    updateFilterIndicator(filteredModels.length);
    await window.renderFiles(filteredModels);
    // renderer.js sync can lose to rAF/layout; run again after paint (stale Model Details path/name)
    if (typeof window.syncSelectionWithFilteredModels === 'function') {
      window.syncSelectionWithFilteredModels(filteredModels);
      requestAnimationFrame(() => {
        if (typeof window.syncSelectionWithFilteredModels === 'function') {
          window.syncSelectionWithFilteredModels(filteredModels);
        }
      });
    }
 
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

/** Clears pill list and hides logic toolbar + clear button without removing persistent #current-filter children. */
function resetCurrentFilterPanelShell() {
  const panel = document.getElementById("current-filter");
  const body = document.getElementById("current-filter-body");
  const tb = document.getElementById("search-boolean-toolbar");
  const clearBtn = document.getElementById("clear-all-filters-button");
  if (body) body.innerHTML = "";
  if (tb) tb.hidden = true;
  if (clearBtn) clearBtn.hidden = true;
  if (panel) panel.classList.remove("visible");
}

// Function to update the filter indicator with active filters
function updateFilterIndicator(count) {
  const filterIndicator = document.getElementById("current-filter");
  const filterBody = document.getElementById("current-filter-body");
  if (!filterIndicator || !filterBody) return;
  
  // Get active filter values
  const designer = document.getElementById("designer-select")?.value || "";
  const license = document.getElementById("license-select")?.value || "";
  const parentModel = document.getElementById("parent-select")?.value || "";
  const printStatus = document.getElementById("printed-select")?.value || "all";
  const newStatus = document.getElementById("new-select")?.value || "all";
  const favoriteStatus = document.getElementById("favorite-select")?.value || "all";
  const ratingStatus = document.getElementById("rating-select")?.value || "all";
  const ratingMinStatus = document.getElementById("rating-min-select")?.value || "all";
  const tagFilter = document.getElementById("tag-filter")?.value || "";
  const fileType = document.getElementById("filetype-select")?.value || "";
  const inverted = window.invertedFilters || {};
  const qbClauses =
    typeof window.queryBuilderHasActiveSearchClauses === "function" &&
    window.queryBuilderHasActiveSearchClauses();
  const qbMulti =
    typeof window.queryBuilderHasActiveMultiFilters === "function" &&
    window.queryBuilderHasActiveMultiFilters();

  // Draft text in the search box does not show the filter strip until you press search.
  const hasActiveFilters =
    designer ||
    license ||
    parentModel ||
    printStatus !== "all" ||
    newStatus !== "all" ||
    favoriteStatus !== "all" ||
    ratingStatus !== "all" ||
    ratingMinStatus !== "all" ||
    tagFilter ||
    fileType ||
    qbClauses ||
    qbMulti ||
    window.currentDirectoryFilter ||
    window.dateAddedFilter;
  
  // Start with basic count message
  let message = "";
  
  if (count === 0) {
    message = `<div class="no-results">No models match your filters</div>`;
  } else {
    message = `<div class="filter-count">Showing ${count} models</div>`;
  }

  if (hasActiveFilters) {
    message += `<div class="filter-pills-container">`;

      // Search clauses + tag chips: one row that wraps within the sidebar — e.g. Search… AND Tag: 1 AND Tag: 2
      const esc = (t) =>
        String(t)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
      const escAttr = (t) =>
        String(t)
          .replace(/&/g, "&amp;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      const chipTags = (window.multiFilterChips && window.multiFilterChips.tags && window.multiFilterChips.tags.length)
        ? window.multiFilterChips.tags.slice()
        : [];
      const tagVals = chipTags.length ? chipTags : tagFilter ? [tagFilter] : [];
      const tagsActive = tagVals.length > 0;
      const tokens =
        qbClauses && typeof window.queryBuilderReadSearchBoolTokens === "function"
          ? window.queryBuilderReadSearchBoolTokens()
          : [];
      const openSearchTagChain = tokens.length > 0 || tagsActive;
      const staticAnd = () => {
        message += `<span class="filter-pill-search-op filter-pill-logic-connector" aria-hidden="true">AND</span>`;
      };
      if (openSearchTagChain) {
        message += `<div class="filter-pills-search-chain">`;
        const invertLabel = inverted.search ? '<span class="pill-invert">NOT</span>' : "";
        const isQueryChainOperand = (tok) =>
          !!(
            tok &&
            (tok.t === "clause" ||
              tok.t === "filter" ||
              tok.t === "filterMulti")
          );

        tokens.forEach((tok, i) => {
          if (tok.t === "op") {
            message += `<span class="filter-pill filter-pill-search-op" data-filter-type="searchToken" data-token-index="${i}">
              ${tok.op === "OR" ? "OR" : "AND"}
              <span class="filter-remove" data-filter-type="searchToken" data-token-index="${i}">×</span>
            </span>`;
          } else if (tok.t === "not") {
            message += `<span class="filter-pill filter-pill-search-op" data-filter-type="searchToken" data-token-index="${i}">
              NOT
              <span class="filter-remove" data-filter-type="searchToken" data-token-index="${i}">×</span>
            </span>`;
          } else if (tok.t === "clause" && String(tok.value || "").trim()) {
            const isAll = !tok.field || tok.field === "all";
            const flab =
              typeof window.queryBuilderSearchFieldLabel === "function"
                ? window.queryBuilderSearchFieldLabel(tok.field)
                : tok.field;
            const searchLine = isAll
              ? `Search: &quot;${esc(tok.value)}&quot; ${invertLabel}`
              : `Search (${esc(flab)}): &quot;${esc(tok.value)}&quot; ${invertLabel}`;
            message += `<div class="filter-pill filter-pill-search-clause ${inverted.search ? "inverted" : ""}" data-filter-type="searchToken" data-token-index="${i}">
              ${searchLine}
              <span class="filter-remove" data-filter-type="searchToken" data-token-index="${i}">×</span>
            </div>`;
          } else if (tok.t === "filter" || tok.t === "filterMulti") {
            const plain =
              typeof window.queryBuilderSidebarFilterTokenLabel === "function"
                ? window.queryBuilderSidebarFilterTokenLabel(tok)
                : "Filter";
            const invFlip =
              typeof window.queryBuilderInvertedFilterKindsForAtom === "function" &&
              window.queryBuilderInvertedFilterKindsForAtom(tok);
            const invLbl = invFlip ? '<span class="pill-invert">NOT</span>' : "";
            message += `<div class="filter-pill filter-pill-search-clause filter-pill-query-atom ${invFlip ? "inverted" : ""}" data-filter-type="searchToken" data-token-index="${i}">
              ${esc(plain)} ${invLbl}
              <span class="filter-remove" data-filter-type="searchToken" data-token-index="${i}">×</span>
            </div>`;
          }
        });
        const lastTok = tokens.length ? tokens[tokens.length - 1] : null;
        if (tagsActive && tokens.length && lastTok && isQueryChainOperand(lastTok)) {
          staticAnd();
        }
        if (tagsActive) {
          const combine = document.querySelector('input[name="tags-combine"]:checked')?.value || "AND";
          tagVals.forEach((tv, ti) => {
            if (ti > 0) staticAnd();
            const inv = inverted.tag ? '<span class="pill-invert">NOT</span>' : "";
            const av = escAttr(tv);
            message += `<div class="filter-pill filter-pill-search-clause filter-pill-tag-chip ${inverted.tag ? "inverted" : ""}" data-filter-type="tagChip" data-tag-value="${av}">
              Tag: ${esc(tv)} ${inv}
              <span class="filter-remove" data-filter-type="tagChip" data-tag-value="${av}">×</span>
            </div>`;
          });
          if (tagVals.length > 1) {
            message += `<span class="filter-pill-tag-combine-hint">(${combine === "AND" ? "all" : "any"})</span>`;
          }
        }
        message += `</div>`;
      }

      // Add designer filter pill if active
      if (designer || (window.multiFilterChips && (window.multiFilterChips.designer || []).length)) {
        const list = (window.multiFilterChips && window.multiFilterChips.designer && window.multiFilterChips.designer.length)
          ? window.multiFilterChips.designer.map((d) => (d === "__none__" ? "No designer" : d)).join(", ")
          : (designer === "__none__" ? "No designer" : designer);
        const dMode = (window.multiFilterChips && window.multiFilterChips.designer && window.multiFilterChips.designer.length > 1)
          ? ` (${document.querySelector('input[name="designer-combine"]:checked')?.value === "AND" ? "all" : "any"})` : "";
        const invertLabel = inverted.designer ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.designer ? 'inverted' : ''}" data-filter-type="designer">
          Designer: ${list}${dMode} ${invertLabel}
          <span class="filter-remove" data-filter-type="designer">×</span>
        </div>`;
      }
      
      // Add license filter pill if active
      if (license || (window.multiFilterChips && (window.multiFilterChips.license || []).length)) {
        const list = (window.multiFilterChips && window.multiFilterChips.license && window.multiFilterChips.license.length)
          ? window.multiFilterChips.license.map((d) => (d === "__none__" ? "No license" : d)).join(", ")
          : (license === "__none__" ? "No license" : license);
        const lMode = (window.multiFilterChips && window.multiFilterChips.license && window.multiFilterChips.license.length > 1)
          ? ` (${document.querySelector('input[name="license-combine"]:checked')?.value === "AND" ? "all" : "any"})` : "";
        const invertLabel = inverted.license ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.license ? 'inverted' : ''}" data-filter-type="license">
          License: ${list}${lMode} ${invertLabel}
          <span class="filter-remove" data-filter-type="license">×</span>
        </div>`;
      }
      
      // Add parent model filter pill if active
      if (parentModel || (window.multiFilterChips && (window.multiFilterChips.parentModel || []).length)) {
        const list = (window.multiFilterChips && window.multiFilterChips.parentModel && window.multiFilterChips.parentModel.length)
          ? window.multiFilterChips.parentModel.map((d) => (d === "__none__" ? "No parent" : d)).join(", ")
          : (parentModel === "__none__" ? "No parent model" : parentModel);
        const pMode = (window.multiFilterChips && window.multiFilterChips.parentModel && window.multiFilterChips.parentModel.length > 1)
          ? ` (${document.querySelector('input[name="parentModel-combine"]:checked')?.value === "AND" ? "all" : "any"})` : "";
        const invertLabel = inverted.parentModel ? '<span class="pill-invert">NOT</span>' : '';
        message += `<div class="filter-pill ${inverted.parentModel ? 'inverted' : ''}" data-filter-type="parentModel">
          Parent: ${list}${pMode} ${invertLabel}
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

      if (newStatus !== "all") {
        const displayText = newStatus === "new" ? "New models only" : "Exclude new models";
        message += `<div class="filter-pill" data-filter-type="newStatus">
          ${displayText}
          <span class="filter-remove" data-filter-type="newStatus">×</span>
        </div>`;
      }

      if (favoriteStatus !== "all") {
        const displayText = favoriteStatus === "favorited" ? "Favorites" : "Not favorites";
        message += `<div class="filter-pill" data-filter-type="favoriteStatus">
          ${displayText}
          <span class="filter-remove" data-filter-type="favoriteStatus">×</span>
        </div>`;
      }

      if (ratingStatus !== "all") {
        const displayText = ratingStatus === "unrated" ? "Unrated" : `${ratingStatus} star${ratingStatus === "1" ? "" : "s"}`;
        message += `<div class="filter-pill" data-filter-type="ratingStatus">
          Rating: ${displayText}
          <span class="filter-remove" data-filter-type="ratingStatus">×</span>
        </div>`;
      }

      if (ratingMinStatus !== "all") {
        message += `<div class="filter-pill" data-filter-type="ratingMinStatus">
          Min rating: ${ratingMinStatus}+
          <span class="filter-remove" data-filter-type="ratingMinStatus">×</span>
        </div>`;
      }
      
      // Tags are rendered in filter-pills-search-chain (per-tag AND Tag: n); skip merged pill here
      
      // Add file type filter pill if active
      if (fileType) {
        message += `<div class="filter-pill" data-filter-type="fileType">
          Type: ${fileType}
          <span class="filter-remove" data-filter-type="fileType">×</span>
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

  const searchBoolToolbar = document.getElementById("search-boolean-toolbar");
  const clearFilterButton = document.getElementById("clear-all-filters-button");

  if (hasActiveFilters) {
    filterBody.innerHTML = message;
    filterIndicator.classList.add("visible");
    if (searchBoolToolbar) searchBoolToolbar.hidden = false;
    if (clearFilterButton) clearFilterButton.hidden = false;
  } else {
    filterBody.innerHTML = "";
    filterIndicator.classList.remove("visible");
    if (searchBoolToolbar) searchBoolToolbar.hidden = true;
    if (clearFilterButton) clearFilterButton.hidden = true;
  }

  if (clearFilterButton) {
    clearFilterButton.onclick = async () => {
      // Reset all filter dropdowns
      if (designer) document.getElementById("designer-select").value = "";
      if (license) document.getElementById("license-select").value = "";
      if (parentModel) document.getElementById("parent-select").value = "";
      if (printStatus !== "all") document.getElementById("printed-select").value = "all";
      if (newStatus !== "all") document.getElementById("new-select").value = "all";
      if (favoriteStatus !== "all") document.getElementById("favorite-select").value = "all";
      if (ratingStatus !== "all") document.getElementById("rating-select").value = "all";
      if (ratingMinStatus !== "all") document.getElementById("rating-min-select").value = "all";
      if (tagFilter) document.getElementById("tag-filter").value = "";
      if (fileType) document.getElementById("filetype-select").value = "";
      if (typeof window.queryBuilderClearAllMultiChips === "function") {
        window.queryBuilderClearAllMultiChips();
      }
      if (typeof window.clearSearchClauseList === "function") {
        window.clearSearchClauseList();
      }
      
      // Clear the search input and update its clear button
      const searchInput = document.getElementById("search-filter-input");
      const clearSearchButton = document.getElementById("clear-filter-search-button");
      if (searchInput) {
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
      
      resetCurrentFilterPanelShell();

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
      if (typeof window.resetFilterSelectionAndDetails === 'function') {
        window.resetFilterSelectionAndDetails();
      }
      await performCombinedSearch();
    };
  }

  const removeButtons = filterBody.querySelectorAll(".filter-remove");
  removeButtons.forEach(button => {
    button.addEventListener('click', async (e) => {
      const filterType = e.target.dataset.filterType;
      
      // Clear the specific filter based on its type
      switch (filterType) {
        case 'designer':
          document.getElementById("designer-select").value = "";
          if (window.multiFilterChips) window.multiFilterChips.designer = [];
          if (typeof window.queryBuilderRenderMultiChips === "function") {
            window.queryBuilderRenderMultiChips("designer");
          }
          if (window.invertedFilters) window.invertedFilters.designer = false;
          break;
        case 'license':
          document.getElementById("license-select").value = "";
          if (window.multiFilterChips) window.multiFilterChips.license = [];
          if (typeof window.queryBuilderRenderMultiChips === "function") {
            window.queryBuilderRenderMultiChips("license");
          }
          if (window.invertedFilters) window.invertedFilters.license = false;
          break;
        case 'parentModel':
          document.getElementById("parent-select").value = "";
          if (window.multiFilterChips) window.multiFilterChips.parentModel = [];
          if (typeof window.queryBuilderRenderMultiChips === "function") {
            window.queryBuilderRenderMultiChips("parentModel");
          }
          if (window.invertedFilters) window.invertedFilters.parentModel = false;
          break;
        case 'printStatus':
          document.getElementById("printed-select").value = "all";
          break;
        case 'newStatus':
          document.getElementById("new-select").value = "all";
          break;
        case 'favoriteStatus':
          document.getElementById("favorite-select").value = "all";
          break;
        case 'ratingStatus':
          document.getElementById("rating-select").value = "all";
          break;
        case 'ratingMinStatus':
          document.getElementById("rating-min-select").value = "all";
          break;
        case 'tagFilter':
          document.getElementById("tag-filter").value = "";
          if (window.multiFilterChips) window.multiFilterChips.tags = [];
          if (typeof window.queryBuilderRenderMultiChips === "function") {
            window.queryBuilderRenderMultiChips("tags");
          }
          if (window.invertedFilters) window.invertedFilters.tag = false;
          break;
        case "tagChip": {
          const raw = e.target.getAttribute("data-tag-value");
          if (raw != null && typeof window.queryBuilderRemoveMultiFilterChip === "function") {
            window.queryBuilderRemoveMultiFilterChip("tags", raw);
          }
          const tagSel = document.getElementById("tag-filter");
          if (tagSel && tagSel.value === raw) tagSel.value = "";
          if (typeof window.queryBuilderRenderMultiChips === "function") {
            window.queryBuilderRenderMultiChips("tags");
          }
          const left = (window.multiFilterChips && window.multiFilterChips.tags && window.multiFilterChips.tags.length) || 0;
          const selLeft = tagSel && tagSel.value ? String(tagSel.value).trim() : "";
          if (!left && !selLeft && window.invertedFilters) window.invertedFilters.tag = false;
          break;
        }
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
          if (typeof window.clearSearchClauseList === "function") {
            window.clearSearchClauseList();
          }
          if (window.invertedFilters) window.invertedFilters.search = false;
          break;
        case "searchToken": {
          const idx = parseInt(e.target.getAttribute("data-token-index"), 10);
          if (!Number.isNaN(idx) && typeof window.removeSearchTokenAt === "function") {
            window.removeSearchTokenAt(idx);
          }
          if (window.invertedFilters) window.invertedFilters.search = false;
          break;
        }
        case 'directory':
          window.currentDirectoryFilter = "";
          break;
      }
      
      if (typeof window.resetFilterSelectionAndDetails === 'function') {
        window.resetFilterSelectionAndDetails();
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
    'new-select',
    'favorite-select',
    'rating-select',
    'rating-min-select',
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

        let consumedAwaitingTag = false;
        if (elementId === "tag-filter") {
          const raw = (e.target.value || "").trim();
          if (raw) {
            if (
              typeof window.queryBuilderTryConsumeAwaitingTagPick === "function" &&
              window.queryBuilderTryConsumeAwaitingTagPick(raw)
            ) {
              consumedAwaitingTag = true;
              e.target.value = "";
            } else if (typeof window.addMultiTagFilter === "function") {
              window.addMultiTagFilter(raw);
              e.target.value = "";
            }
          } else if (window.multiFilterChips && (window.multiFilterChips.tags || []).length) {
            window.multiFilterChips.tags = [];
            if (typeof window.queryBuilderRenderMultiChips === "function") {
              window.queryBuilderRenderMultiChips("tags");
            }
          }
        }

        console.log(`Filter changed: ${elementId} = ${e.target.value}`);

        let consumedAwaitingFilter = false;
        if (
          elementId !== "tag-filter" &&
          typeof window.queryBuilderTryConsumeAwaitingFilterFromElement === "function"
        ) {
          consumedAwaitingFilter = window.queryBuilderTryConsumeAwaitingFilterFromElement(elementId);
        }

        if (
          !consumedAwaitingTag &&
          !consumedAwaitingFilter &&
          typeof window.queryBuilderDismissSearchAwaiting === "function"
        ) {
          window.queryBuilderDismissSearchAwaiting();
        }

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
        // Clear selection + Model Details synchronously before await (renderer.js state; avoids stale sidebar)
        if (typeof window.resetFilterSelectionAndDetails === 'function') {
          window.resetFilterSelectionAndDetails();
        }
        await performCombinedSearch();
      });
    }
  });

  searchButton.addEventListener("click", async () => {
    const raw = searchInput.value.trim();
    lastSearchTerm = raw;
    console.log("Filter search button clicked with term:", raw);
    if (raw && typeof window.appendSearchClauseFromSidebar === "function") {
      window.appendSearchClauseFromSidebar("all", raw);
      searchInput.value = "";
      clearButton.classList.add("hidden");
      clearButton.style.display = "none";
    }
    // Clear dateAddedFilter when user searches
    if (window.dateAddedFilter) {
      console.log('User performed search, clearing dateAddedFilter');
      window.dateAddedFilter = null;
      window._lastDateAddedFilter = null;
    }
    // Reset the viewingEntireLibrary flag when search is applied
    window.viewingEntireLibrary = false;
    if (typeof window.resetFilterSelectionAndDetails === 'function') {
      window.resetFilterSelectionAndDetails();
    }
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
    lastSearchTerm = "";
    clearButton.classList.add("hidden");
    clearButton.style.display = "none";
    if (typeof window.clearSearchClauseList === "function") {
      window.clearSearchClauseList();
    }
    if (window.invertedFilters) window.invertedFilters.search = false;
    if (typeof window.resetFilterSelectionAndDetails === 'function') {
      window.resetFilterSelectionAndDetails();
    }
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

  const wireSearchBoolLink = (id, fn) => {
    const el = document.getElementById(id);
    if (!el || typeof fn !== "function") return;
    el.addEventListener("click", async (e) => {
      e.preventDefault();
      if (el.getAttribute("aria-disabled") === "true") return;
      fn();
      if (typeof window.resetFilterSelectionAndDetails === "function") {
        window.resetFilterSelectionAndDetails();
      }
      await performCombinedSearch();
    });
  };
  wireSearchBoolLink("search-add-and-btn", () => {
    if (typeof window.appendSearchBoolOp === "function") window.appendSearchBoolOp("AND");
  });
  wireSearchBoolLink("search-add-or-btn", () => {
    if (typeof window.appendSearchBoolOp === "function") window.appendSearchBoolOp("OR");
  });
  wireSearchBoolLink("search-add-not-btn", () => {
    if (typeof window.appendSearchBoolNot === "function") window.appendSearchBoolNot();
  });

  if (typeof window.queryBuilderWireMultiFilterUI === "function") {
    window.queryBuilderWireMultiFilterUI();
  }
  if (typeof window.queryBuilderWireSearchQueryBuilder === "function") {
    window.queryBuilderWireSearchQueryBuilder();
  }
  if (typeof window.queryBuilderInitState === "function") {
    window.queryBuilderInitState();
  }
}

// Attach functions to the global window object IMMEDIATELY
// This ensures they're available before renderer.js tries to use them
window.getCombinedFilteredModels = getCombinedFilteredModels;
window.resetCurrentFilterPanelShell = resetCurrentFilterPanelShell;
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
    'new-select',
    'favorite-select',
    'rating-select',
    'rating-min-select',
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

  document
    .querySelectorAll(
      "#search-add-and-btn, #search-add-or-btn, #search-add-not-btn, .filter-combine-row input"
    )
    .forEach((el) => {
      if (!el) return;
      if (el.tagName === "A" && el.classList.contains("search-boolean-op-link")) {
        el.setAttribute("aria-disabled", enabled ? "false" : "true");
        el.tabIndex = enabled ? 0 : -1;
        if (enabled) el.classList.remove("disabled-during-loading");
        else el.classList.add("disabled-during-loading");
        return;
      }
      el.disabled = !enabled;
      if (enabled) el.classList.remove("disabled-during-loading");
      else el.classList.add("disabled-during-loading");
    });
}
