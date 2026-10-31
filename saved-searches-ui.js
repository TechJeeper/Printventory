/**
 * Saved / smart searches: save current filters, sidebar list, apply.
 */
(function () {
  'use strict';

  let cache = [];

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, { type: type || 'info' });
  }

  function currentState() {
    const filters = typeof window.getCurrentLibraryFilters === 'function'
      ? window.getCurrentLibraryFilters()
      : {};
    return {
      filters,
      multiFilterChips: window.multiFilterChips ? JSON.parse(JSON.stringify(window.multiFilterChips)) : {},
      multiFilterCombine: window.multiFilterCombine ? { ...window.multiFilterCombine } : {},
      searchBoolTokens: Array.isArray(window.searchBoolTokens) ? window.searchBoolTokens.slice() : [],
      numeric: {
        sizeGt: numVal('filter-size-gt'),
        dateAddedWithinDays: numVal('filter-date-within-days'),
        printCountGt: numVal('filter-print-count-gt'),
        ratingGte: numVal('filter-rating-gte'),
        lastPrintedBefore: document.getElementById('filter-last-printed-before')?.value || null
      },
      sortOption: document.getElementById('sort-select')?.value || 'date-desc',
      collectionId: window.activeCollectionId || null
    };
  }

  function numVal(id) {
    const el = document.getElementById(id);
    if (!el || el.value === '' || el.value == null) return null;
    const n = Number(el.value);
    return Number.isFinite(n) ? n : null;
  }

  async function refresh() {
    if (!window.electron?.listSavedSearches) return;
    cache = (await window.electron.listSavedSearches()) || [];
    window._savedSearchesCache = cache;
    const host = document.getElementById('saved-searches-sidebar-list');
    if (!host) return;
    host.innerHTML = '';
    if (!cache.length) {
      host.innerHTML = '<span class="feature-muted" style="font-size:11px;">None yet — save filters above.</span>';
      return;
    }
    for (const s of cache) {
      const row = document.createElement('div');
      row.className = 'saved-search-row';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'saved-search-item';
      btn.textContent = (s.pinned ? '★ ' : '') + s.name;
      btn.title = s.smart ? 'Smart collection (live filters)' : 'Saved search';
      btn.addEventListener('click', () => applySaved(s));
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'saved-search-delete';
      del.title = 'Delete';
      del.textContent = '×';
      del.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.electron.deleteSavedSearch(s.id);
        await refresh();
        toast('Saved search deleted', 'success');
      });
      row.appendChild(btn);
      row.appendChild(del);
      host.appendChild(row);
    }
  }

  async function applySaved(s) {
    const state = s.state || {};
    if (state.multiFilterChips) window.multiFilterChips = state.multiFilterChips;
    if (state.multiFilterCombine) window.multiFilterCombine = state.multiFilterCombine;
    if (Array.isArray(state.searchBoolTokens)) window.searchBoolTokens = state.searchBoolTokens;
    if (typeof window.queryBuilderRenderAll === 'function') window.queryBuilderRenderAll();
    else if (typeof window.wireMultiFilterUI === 'function') { /* chips rendered elsewhere */ }

    const f = state.filters || {};
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val != null) el.value = val;
    };
    set('designer-select', f.designer || '');
    set('license-select', f.license || '');
    set('parent-select', f.parentModel || '');
    set('tag-filter', f.tag || '');
    set('filament-filter', f.filament || '');
    set('printed-select', f.printed || 'all');
    set('new-select', f.isNew || 'all');
    set('favorite-select', f.favorite || 'all');
    set('rating-select', f.rating || 'all');
    set('rating-min-select', f.ratingMin || 'all');
    set('filetype-select', f.fileType || '');
    set('sort-select', state.sortOption || 'date-desc');
    set('search-filter-input', f.search || '');
    set('filter-size-gt', state.numeric?.sizeGt ?? '');
    set('filter-date-within-days', state.numeric?.dateAddedWithinDays ?? '');
    set('filter-print-count-gt', state.numeric?.printCountGt ?? '');
    set('filter-rating-gte', state.numeric?.ratingGte ?? '');
    set('filter-last-printed-before', state.numeric?.lastPrintedBefore || '');

    window._savedSearchNumeric = state.numeric || null;
    if (state.collectionId && window.CollectionsUI?.applyCollectionFilter) {
      await window.CollectionsUI.applyCollectionFilter(state.collectionId);
    } else if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
    toast(`Applied “${s.name}”`, 'success');
  }

  async function saveCurrent() {
    const name = await window.electron.showInputDialog?.({
      title: 'Save search',
      message: 'Name for this saved search / smart collection:',
      defaultValue: ''
    });
    if (!name || !String(name).trim()) return;
    try {
      await window.electron.saveSavedSearch({
        name: String(name).trim(),
        state: currentState(),
        smart: true,
        pinned: false
      });
      await refresh();
      toast('Search saved', 'success');
    } catch (err) {
      toast(err.message || 'Could not save', 'error');
    }
  }

  function wire() {
    document.getElementById('save-search-button')?.addEventListener('click', saveCurrent);
    document.getElementById('saved-searches-refresh')?.addEventListener('click', refresh);
    refresh().catch(() => {});
  }

  window.SavedSearchesUI = { saveCurrent, refresh, applySaved, currentState };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
