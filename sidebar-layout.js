/**
 * Sidebar layout: pin search / sort / folders; collapse the long filter stack
 * behind "More filters". Auto-collapse again when model details open.
 * Also owns drag-resize for the sidebar and Folders panels, persisting widths.
 */
(function () {
  const DETAIL_IDS = ['model-details', 'bundle-details', 'multi-edit-panel'];
  const SIDEBAR_SETTING = 'sidebarWidth';
  const FOLDER_SETTING = 'folderTreeWidth';
  const SIDEBAR_MIN = 280;
  const SIDEBAR_MAX = 640;
  const SIDEBAR_DEFAULT = 350;
  const FOLDER_MIN = 180;
  const FOLDER_MAX = 560;
  const FOLDER_DEFAULT = 280;

  let expanded = false;
  let observer = null;
  let sidebarWidth = SIDEBAR_DEFAULT;
  let folderTreeWidth = FOLDER_DEFAULT;

  function sidebar() {
    return document.querySelector('.sidebar');
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function parseWidth(value, fallback) {
    const n = parseInt(value, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  function applySidebarWidth(px) {
    sidebarWidth = clamp(Math.round(px), SIDEBAR_MIN, SIDEBAR_MAX);
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
  }

  function applyFolderTreeWidth(px, extraMax) {
    const max = extraMax != null ? Math.min(FOLDER_MAX, extraMax) : FOLDER_MAX;
    folderTreeWidth = clamp(Math.round(px), FOLDER_MIN, Math.max(FOLDER_MIN, max));
    document.documentElement.style.setProperty('--folder-tree-width', `${folderTreeWidth}px`);
  }

  function persistWidth(key, px) {
    try {
      window.electron?.saveSetting?.(key, String(px));
    } catch (_) { /* ignore */ }
  }

  function bindResize(handle, options) {
    if (!handle || handle.dataset.resizeBound) return;
    handle.dataset.resizeBound = '1';
    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = options.getStartWidth();
      handle.classList.add('is-active');
      document.body.classList.add('is-panel-resizing');
      function onMouseMove(ev) {
        options.onMove(startWidth + (ev.clientX - startX));
      }
      function onMouseUp() {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        handle.classList.remove('is-active');
        document.body.classList.remove('is-panel-resizing');
        options.onEnd();
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function popoverMaxWidth() {
    const pop = document.getElementById('folder-tree-popover');
    if (!pop || pop.classList.contains('hidden')) return FOLDER_MAX;
    const left = pop.getBoundingClientRect().left;
    return Math.min(FOLDER_MAX, Math.max(FOLDER_MIN, window.innerWidth - left - 8));
  }

  function bindResizeHandles() {
    bindResize(document.getElementById('sidebar-resize-handle'), {
      getStartWidth: () => sidebarWidth,
      onMove: (next) => applySidebarWidth(next),
      onEnd: () => persistWidth(SIDEBAR_SETTING, sidebarWidth)
    });
    const onFolderMove = (next) => applyFolderTreeWidth(next, popoverMaxWidth());
    const onFolderEnd = () => persistWidth(FOLDER_SETTING, folderTreeWidth);
    bindResize(document.getElementById('folder-rail-resize-handle'), {
      getStartWidth: () => folderTreeWidth,
      onMove: (next) => applyFolderTreeWidth(next),
      onEnd: onFolderEnd
    });
    bindResize(document.getElementById('folder-tree-resize-handle'), {
      getStartWidth: () => folderTreeWidth,
      onMove: onFolderMove,
      onEnd: onFolderEnd
    });
  }

  async function loadSavedWidths() {
    try {
      const savedSidebar = await window.electron?.getSetting?.(SIDEBAR_SETTING);
      if (savedSidebar) applySidebarWidth(parseWidth(savedSidebar, SIDEBAR_DEFAULT));
    } catch (_) { /* ignore */ }
    try {
      const savedFolder = await window.electron?.getSetting?.(FOLDER_SETTING);
      if (savedFolder) applyFolderTreeWidth(parseWidth(savedFolder, FOLDER_DEFAULT));
    } catch (_) { /* ignore */ }
  }

  function detailsAreOpen() {
    const multi = document.getElementById('multi-edit-panel');
    if (multi && !multi.classList.contains('hidden')) return true;
    const bundle = document.getElementById('bundle-details');
    if (bundle && !bundle.classList.contains('hidden')) return true;
    const details = document.getElementById('model-details');
    if (!details || details.classList.contains('hidden')) return false;
    const path = document.getElementById('path-tree-container')?.getAttribute('data-file-path');
    return Boolean(path);
  }

  function applyExpanded(next) {
    expanded = !!next;
    const root = sidebar();
    if (root) root.classList.toggle('filters-expanded', expanded);
    const toggle = document.getElementById('filter-stack-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
      const label = toggle.querySelector('.filter-stack-toggle-label');
      const chevron = toggle.querySelector('.filter-stack-toggle-chevron');
      if (label) label.textContent = expanded ? 'Filters' : 'More filters';
      if (chevron) chevron.textContent = expanded ? '▾' : '▸';
    }
  }

  function sync() {
    const root = sidebar();
    if (!root) return;
    const open = detailsAreOpen();
    root.classList.toggle('details-open', open);
    if (open && expanded) applyExpanded(false);
  }

  function onToggleClick(e) {
    e.preventDefault();
    applyExpanded(!expanded);
  }

  function observe() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      const root = sidebar();
      if (!root) return;
      const open = detailsAreOpen();
      const wasOpen = root.classList.contains('details-open');
      root.classList.toggle('details-open', open);
      if (open && !wasOpen) applyExpanded(false);
    });
    DETAIL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
    const pathTree = document.getElementById('path-tree-container');
    if (pathTree) observer.observe(pathTree, { attributes: true, attributeFilter: ['data-file-path'] });
    sync();
  }

  async function init() {
    const toggle = document.getElementById('filter-stack-toggle');
    if (toggle && !toggle.dataset.sidebarLayoutBound) {
      toggle.dataset.sidebarLayoutBound = '1';
      toggle.addEventListener('click', onToggleClick);
    }
    applyExpanded(false);
    observe();
    bindResizeHandles();
    await loadSavedWidths();
  }

  window.SidebarLayout = {
    init,
    sync,
    setExpanded: applyExpanded,
    collapseFiltersForDetails() {
      applyExpanded(false);
      sync();
    },
    getFolderTreeWidth() {
      return folderTreeWidth;
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
