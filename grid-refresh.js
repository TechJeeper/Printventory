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

  // Grid CSS width is the viewport minus the sidebar. During a live resize,
  // clientWidth can stay on the previous size, so preview tiles never scale.
  // Trust the viewport once the two disagree by more than a scrollbar.
  function libraryGridWidth(clientWidth, viewportWidth, sidebarWidth, folderWidth) {
    const fromViewport = Math.max(
      0,
      Math.round((Number(viewportWidth) || 0) - (Number(sidebarWidth) || 0) - (Number(folderWidth) || 0) - 40)
    );
    const client = Math.max(0, Math.round(Number(clientWidth) || 0));
    if (!fromViewport) return client;
    if (!client) return fromViewport;
    if (Math.abs(fromViewport - client) <= 24) return client;
    return fromViewport;
  }

  function previewTilePx(availableWidth, columns, horizontalGap) {
    const cols = Math.max(1, Math.round(Number(columns) || 1));
    const gap = Math.max(0, Number(horizontalGap) || 0);
    const available = Math.max(0, Number(availableWidth) || 0);
    return Math.max(1, Math.floor((available - (cols - 1) * gap) / cols));
  }

  function detailedColumnCount(availableWidth, itemWidth) {
    const item = Math.max(1, Number(itemWidth) || 300);
    const available = Math.max(0, Number(availableWidth) || 0);
    return Math.max(Math.floor(available / item), 1);
  }

  // List row padding + thumbnail + the gap before the columns.
  const LIST_ROW_CHROME = 32 + 60 + 12;

  function listViewScrollWidth(columnWidths, paneContentWidth) {
    const gap = 12;
    let cols = 0;
    let visible = 0;
    const widths = Array.isArray(columnWidths) ? columnWidths : [];
    for (let i = 0; i < widths.length; i++) {
      const w = Number(widths[i]);
      if (!Number.isFinite(w) || w <= 0) continue;
      visible += 1;
      cols += w;
    }
    if (visible > 1) cols += (visible - 1) * gap;
    const natural = LIST_ROW_CHROME + cols;
    const available = Math.max(0, Math.floor(Number(paneContentWidth) || 0));
    return {
      natural: natural,
      width: Math.max(natural, available),
      scrolls: natural > available
    };
  }

  // Desktop and Docker share the grid width. Docker only adds the menu bar
  // above the sidebar, so a resize must scale tiles the same way in both.
  function windowScaleFrame(input) {
    const spec = input || {};
    const mode = spec.mode === 'docker' ? 'docker' : 'desktop';
    const sidebar = spec.sidebarWidth == null ? 350 : (Number(spec.sidebarWidth) || 0);
    const folder = Number(spec.folderWidth) || 0;
    const gridWidth = libraryGridWidth(spec.clientWidth || 0, spec.viewportWidth, sidebar, folder);
    const view = spec.view || 'detailed';
    const previewColumns = Math.max(1, Math.round(Number(spec.previewColumns) || 6));
    const previewGap = spec.previewGap == null ? 2 : Number(spec.previewGap);
    // Preview tiles use the full grid box. Detailed and list sit inside 20px of padding.
    const contentWidth = Math.max(0, gridWidth - 40);
    const available = view === 'preview' ? gridWidth : contentWidth;
    const tile = previewTilePx(gridWidth, previewColumns, previewGap);
    const detailedColumns = detailedColumnCount(contentWidth, spec.itemWidth || 300);
    const columns = view === 'list' ? 1 : (view === 'preview' ? previewColumns : detailedColumns);
    const rowHeight = view === 'preview' ? tile : (view === 'list' ? 56 : (Number(spec.itemHeight) || 490));
    const verticalGap = view === 'preview' ? previewGap : (view === 'list' ? 6 : 20);
    const next = {
      width: gridWidth,
      columns: columns,
      view: view,
      rowHeight: rowHeight,
      verticalGap: verticalGap
    };
    return {
      mode: mode,
      menuBarOffset: mode === 'docker' ? 30 : 0,
      gridWidth: gridWidth,
      available: available,
      previewTile: tile,
      previewColumns: previewColumns,
      detailedColumns: detailedColumns,
      columns: columns,
      rowHeight: rowHeight,
      list: listViewScrollWidth(spec.columnWidths || [], contentWidth),
      reposition: virtualGridGeometryChanged(spec.previous || null, next),
      layout: next
    };
  }

  // A window resize can change columns while every visible card is already mounted.
  // That happens most with short filtered lists (New, no designer). Those cards
  // still have to be moved; a scroll-only "already painted" skip must not apply.
  function virtualGridGeometryChanged(cache, next) {
    if (!cache || !next) return true;
    return cache.width !== next.width
      || cache.columns !== next.columns
      || cache.view !== next.view
      || cache.rowHeight !== next.rowHeight
      || cache.verticalGap !== next.verticalGap;
  }

  // A filter that drops one model does not change the window size. Mounted
  // cards still have to slide into the hole; geometry alone is not enough.
  function mountedCardsStayPut(cache, next) {
    if (!cache || !next) return false;
    if (virtualGridGeometryChanged(cache, next)) return false;
    return cache.modelsRef === next.modelsRef
      && cache.modelsLen === next.modelsLen
      && cache.expandGen === next.expandGen;
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
    libraryGridWidth: libraryGridWidth,
    previewTilePx: previewTilePx,
    detailedColumnCount: detailedColumnCount,
    listViewScrollWidth: listViewScrollWidth,
    windowScaleFrame: windowScaleFrame,
    virtualGridGeometryChanged: virtualGridGeometryChanged,
    mountedCardsStayPut: mountedCardsStayPut,
    scrollTopForSelectedLayout: scrollTopForSelectedLayout,
    patchLoadedModel: patchLoadedModel,
    createCoalescedRefresh: createCoalescedRefresh
  };
});
