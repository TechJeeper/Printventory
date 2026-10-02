// Grid updates while thumbnails arrive in the background.
// Loaded before search.js and renderer.js.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.gridRefresh = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const THUMBNAIL_REFRESH_COALESCE_MS = 3000;

  // The first progressive page is shorter than a scrolled library. Rendering it
  // collapses the grid and resets scroll, so hold until the reload catches up.
  function shouldHoldProgressiveRender(preserveScroll, modelsLength, shownCount, pageComplete) {
    return !!(preserveScroll && !pageComplete && modelsLength < shownCount);
  }

  // Off-screen virtual-grid rows share this object with the layout cache.
  function patchLoadedModel(currentModels, normalizedPath, updatedModel, normalizePath) {
    if (!Array.isArray(currentModels) || typeof normalizePath !== 'function') return false;
    const loadedModel = currentModels.find(function (model) {
      return model && normalizePath(model.filePath) === normalizedPath;
    });
    if (!loadedModel) return false;
    Object.assign(loadedModel, updatedModel);
    return true;
  }

  function shouldFocusSelectionOnViewSwitch(previousView, nextView, hasSelection) {
    if (!hasSelection) return false;
    return (
      (previousView === 'detailed' && nextView === 'preview') ||
      (previousView === 'preview' && nextView === 'detailed')
    );
  }

  // Center the selected model after a view switch. Prefer the model tile over a group card.
  function scrollTopForSelectedLayout(layout, viewportHeight, isSelectedPath) {
    if (!layout || typeof isSelectedPath !== 'function') return null;
    const rows = layout.rows || [];
    let modelRow = null;
    let groupRow = null;
    for (let i = 0; i < rows.length && !modelRow; i++) {
      const row = rows[i];
      const records = row && row.type === 'group' ? [row.record] : (row && row.records) || [];
      for (let r = 0; r < records.length; r++) {
        const record = records[r];
        if (!record) continue;
        if (record.type === 'model' && record.model && isSelectedPath(record.model.filePath)) {
          modelRow = row;
          break;
        }
        if (!groupRow && record.type === 'group' && Array.isArray(record.children)) {
          for (let c = 0; c < record.children.length; c++) {
            const child = record.children[c];
            if (child && isSelectedPath(child.filePath)) {
              groupRow = row;
              break;
            }
          }
        }
      }
    }
    const row = modelRow || groupRow;
    if (!row || !Number.isFinite(row.top)) return null;
    const viewport = Number(viewportHeight) || 0;
    const rowHeight = Number(row.height) || 0;
    const centered = row.top - Math.max(0, (viewport - rowHeight) / 2);
    const maxScroll = Math.max(0, (Number(layout.totalHeight) || 0) - viewport);
    return Math.max(0, Math.min(centered, maxScroll));
  }

  // One trailing refresh per delay window. Extra calls while a timer is pending are ignored.
  function createCoalescedRefresh(delayMs, refreshFn) {
    let timer = null;
    return function scheduleCoalescedRefresh() {
      if (timer) return;
      timer = setTimeout(function () {
        timer = null;
        Promise.resolve()
          .then(refreshFn)
          .catch(function (err) {
            console.error('Error refreshing grid after thumbnails were added:', err);
          });
      }, delayMs);
    };
  }

  return {
    THUMBNAIL_REFRESH_COALESCE_MS: THUMBNAIL_REFRESH_COALESCE_MS,
    shouldHoldProgressiveRender: shouldHoldProgressiveRender,
    shouldFocusSelectionOnViewSwitch: shouldFocusSelectionOnViewSwitch,
    scrollTopForSelectedLayout: scrollTopForSelectedLayout,
    patchLoadedModel: patchLoadedModel,
    createCoalescedRefresh: createCoalescedRefresh
  };
});
