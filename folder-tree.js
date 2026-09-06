/**
 * Folder tree picker: sidebar Folders control, popover explorer, optional grid rail.
 */
(function () {
  const RECENT_SETTING = 'recentFolderFilters';
  const RAIL_SETTING = 'folderRailOpen';
  const MAX_RECENT = 8;

  let forest = { roots: [] };
  let expanded = new Set();
  let query = '';
  let popoverOpen = false;
  let suppressSelect = false;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizePath(p) {
    return String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
  }

  function pathsEqual(a, b) {
    return normalizePath(a).toLowerCase() === normalizePath(b).toLowerCase();
  }

  function toDirectoryFilter(node) {
    if (!node) return '';
    if (node.isBundle && node.path && !String(node.path).includes('::')) return `${node.path}::`;
    return node.path;
  }

  function directoryOfFile(filePath) {
    const raw = String(filePath || '');
    if (!raw || raw.startsWith('url::')) return '';
    if (raw.includes('::')) {
      const [zipPath, entryPath] = raw.split('::');
      const entryDir = String(entryPath || '').replace(/\\/g, '/').replace(/\/[^/]+$/, '');
      return entryDir ? `${zipPath}::${entryDir}` : `${zipPath}::`;
    }
    const n = raw.replace(/\\/g, '/');
    const i = n.lastIndexOf('/');
    return i > 0 ? n.slice(0, i) : n;
  }

  function walk(nodes, visit, parents) {
    const stackParents = parents || [];
    for (const node of nodes || []) {
      visit(node, stackParents);
      if (node.children && node.children.length) {
        walk(node.children, visit, stackParents.concat(node));
      }
    }
  }

  function findNode(path) {
    let found = null;
    walk(forest.roots, (node) => {
      if (!found && (pathsEqual(node.path, path) || pathsEqual(toDirectoryFilter(node), path))) {
        found = node;
      }
    });
    return found;
  }

  function collectRecent() {
    try {
      const raw = window._recentFolderFiltersCache;
      return Array.isArray(raw) ? raw : [];
    } catch (_) {
      return [];
    }
  }

  async function loadRecent() {
    try {
      const raw = await window.electron.getSetting(RECENT_SETTING);
      const parsed = raw ? JSON.parse(raw) : [];
      window._recentFolderFiltersCache = Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      window._recentFolderFiltersCache = [];
    }
  }

  async function pushRecent(node) {
    if (!node || !node.path) return;
    const next = collectRecent().filter((item) => !pathsEqual(item.path, node.path));
    next.unshift({ path: node.path, label: node.label, isBundle: !!node.isBundle });
    window._recentFolderFiltersCache = next.slice(0, MAX_RECENT);
    try {
      await window.electron.saveSetting(RECENT_SETTING, JSON.stringify(window._recentFolderFiltersCache));
    } catch (_) { /* ignore */ }
  }

  async function loadForest() {
    if (!window.electron?.getFolderTree) {
      forest = { roots: [] };
      return forest;
    }
    try {
      forest = (await window.electron.getFolderTree()) || { roots: [] };
    } catch (err) {
      console.error('Error loading folder tree:', err);
      forest = { roots: [] };
    }
    if (!expanded.size) {
      (forest.roots || []).forEach((root) => expanded.add(root.path));
    }
    return forest;
  }

  function matchesQuery(node) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return String(node.label || '').toLowerCase().includes(q) || String(node.path || '').toLowerCase().includes(q);
  }

  function nodeOrDescendantMatches(node) {
    if (matchesQuery(node)) return true;
    return (node.children || []).some(nodeOrDescendantMatches);
  }

  function renderTree(container) {
    if (!container) return;
    const selected = window.currentDirectoryFilter || '';
    const html = [];

    function renderNode(node, depth) {
      if (query && !nodeOrDescendantMatches(node)) return;
      const hasKids = (node.children || []).length > 0;
      const isOpen = !hasKids || query || expanded.has(node.path);
      const filterValue = toDirectoryFilter(node);
      const selectedClass = pathsEqual(filterValue, selected) || pathsEqual(node.path, selected) ? ' is-selected' : '';
      html.push(`<div class="folder-tree-node" data-path="${escapeHtml(node.path)}">`);
      html.push(`<button type="button" class="folder-tree-row${selectedClass}" data-path="${escapeHtml(node.path)}" title="${escapeHtml(node.tooltip || node.path)}">`);
      html.push(`<span class="folder-tree-twist${hasKids ? '' : ' is-empty'}" data-twist="1">${hasKids && isOpen ? '▾' : hasKids ? '▸' : '•'}</span>`);
      html.push(`<span class="folder-tree-icon${node.isBundle ? ' is-bundle' : ''}" aria-hidden="true"></span>`);
      html.push(`<span class="folder-tree-label">${escapeHtml(node.label)}</span>`);
      html.push(`<span class="folder-tree-count">${Number(node.count) || 0}</span>`);
      html.push('</button>');
      if (hasKids && isOpen) {
        html.push('<div class="folder-tree-children">');
        node.children.forEach((child) => renderNode(child, depth + 1));
        html.push('</div>');
      }
      html.push('</div>');
    }

    if (!(forest.roots || []).length) {
      html.push('<div class="folder-tree-row" style="opacity:0.6">No scanned folders yet</div>');
    } else {
      forest.roots.forEach((root) => renderNode(root, 0));
    }
    container.innerHTML = html.join('');
  }

  function refreshTrees() {
    renderTree(document.getElementById('folder-tree-popover-tree'));
    renderTree(document.getElementById('folder-rail-tree'));
  }

  function fillSelect() {
    const select = document.getElementById('folder-select');
    if (!select) return;
    const current = window.currentDirectoryFilter || '';
    suppressSelect = true;
    const groups = [];
    groups.push('<option value="">All folders</option>');
    if ((forest.roots || []).length) {
      groups.push('<optgroup label="Library roots">');
      forest.roots.forEach((root) => {
        groups.push(`<option value="${escapeHtml(toDirectoryFilter(root))}">${escapeHtml(root.label)}</option>`);
      });
      groups.push('</optgroup>');
    }
    const recent = collectRecent();
    if (recent.length) {
      groups.push('<optgroup label="Recent">');
      recent.forEach((item) => {
        groups.push(`<option value="${escapeHtml(toDirectoryFilter(item))}">${escapeHtml(item.label || item.path)}</option>`);
      });
      groups.push('</optgroup>');
    }
    select.innerHTML = groups.join('');
    if (current) {
      const match = Array.from(select.options).find((opt) => pathsEqual(opt.value, current));
      select.value = match ? match.value : '';
      if (!match) {
        const opt = document.createElement('option');
        opt.value = current;
        opt.textContent = current.split(/[/\\]/).filter(Boolean).pop() || current;
        select.appendChild(opt);
        select.value = current;
      }
    } else {
      select.value = '';
    }
    suppressSelect = false;
  }

  function syncControl() {
    fillSelect();
    refreshTrees();
  }

  async function applyDirectoryFilter(directoryPath, node) {
    window.currentDirectoryFilter = directoryPath || '';
    if (window.viewingEntireLibrary && directoryPath) {
      window.viewingEntireLibrary = false;
    }
    if (node) await pushRecent(node);
    fillSelect();
    if (typeof window.applyViewForCurrentFolder === 'function') {
      await window.applyViewForCurrentFolder();
    }
    if (typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
    refreshTrees();
  }

  async function applyNode(node) {
    if (!node) return;
    await applyDirectoryFilter(toDirectoryFilter(node), node);
    closePopover();
  }

  function closePopover() {
    popoverOpen = false;
    const pop = document.getElementById('folder-tree-popover');
    if (pop) {
      pop.classList.add('hidden');
      pop.hidden = true;
    }
  }

  function folderTreeWidth() {
    const fromLayout = window.SidebarLayout?.getFolderTreeWidth?.();
    if (fromLayout) return fromLayout;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--folder-tree-width');
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 280;
  }

  function positionPopover() {
    const pop = document.getElementById('folder-tree-popover');
    const btn = document.getElementById('folder-tree-button');
    if (!pop || !btn) return;
    const rect = btn.getBoundingClientRect();
    const width = folderTreeWidth();
    let left = rect.left;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - width - 8);
    let top = rect.bottom + 6;
    pop.style.visibility = 'hidden';
    pop.classList.remove('hidden');
    pop.hidden = false;
    const height = pop.offsetHeight || 360;
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6);
    }
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;
    pop.style.visibility = '';
  }

  async function openPopover() {
    await loadForest();
    fillSelect();
    popoverOpen = true;
    query = '';
    const search = document.getElementById('folder-tree-search');
    if (search) search.value = '';
    refreshTrees();
    positionPopover();
    if (search) search.focus();
  }

  function expandAncestors(path) {
    walk(forest.roots, (node, parents) => {
      if (pathsEqual(node.path, path) || pathsEqual(toDirectoryFilter(node), path)) {
        parents.forEach((p) => expanded.add(p.path));
        expanded.add(node.path);
      }
    });
  }

  async function revealPath(filePath) {
    const dir = directoryOfFile(filePath);
    if (!dir) return;
    await loadForest();
    expandAncestors(dir.replace(/::$/, ''));
    const rail = document.getElementById('folder-rail');
    const railOpen = rail && !rail.classList.contains('hidden');
    refreshTrees();
    if (railOpen) {
      const row = document.querySelector(`#folder-rail-tree .folder-tree-row[data-path="${CSS.escape(dir.replace(/::$/, ''))}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    } else {
      await openPopover();
      const row = document.querySelector(`#folder-tree-popover-tree .folder-tree-row[data-path="${CSS.escape(dir.replace(/::$/, ''))}"]`);
      if (row) row.scrollIntoView({ block: 'center' });
    }
  }

  async function setRailOpen(open) {
    const rail = document.getElementById('folder-rail');
    const toggle = document.getElementById('folder-rail-toggle');
    if (!rail) return;
    if (open) {
      await loadForest();
      rail.classList.remove('hidden');
      rail.hidden = false;
      document.body.classList.add('folder-rail-open');
      if (toggle) toggle.classList.add('active');
      refreshTrees();
    } else {
      rail.classList.add('hidden');
      rail.hidden = true;
      document.body.classList.remove('folder-rail-open');
      if (toggle) toggle.classList.remove('active');
    }
    try {
      await window.electron.saveSetting(RAIL_SETTING, open ? 'true' : 'false');
    } catch (_) { /* ignore */ }
  }

  function onTreeClick(e) {
    const twist = e.target.closest('[data-twist]');
    const row = e.target.closest('.folder-tree-row');
    if (!row || !row.dataset.path) return;
    const node = findNode(row.dataset.path);
    if (!node) return;
    if (twist && (node.children || []).length) {
      e.preventDefault();
      e.stopPropagation();
      if (expanded.has(node.path)) expanded.delete(node.path);
      else expanded.add(node.path);
      refreshTrees();
      return;
    }
    e.preventDefault();
    applyNode(node);
  }

  function bind() {
    const treeBtn = document.getElementById('folder-tree-button');
    if (treeBtn && !treeBtn.dataset.bound) {
      treeBtn.dataset.bound = '1';
      treeBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (popoverOpen) closePopover();
        else await openPopover();
      });
    }

    const select = document.getElementById('folder-select');
    if (select && !select.dataset.bound) {
      select.dataset.bound = '1';
      select.addEventListener('change', async () => {
        if (suppressSelect) return;
        const value = select.value || '';
        if (!value) {
          await applyDirectoryFilter('');
          return;
        }
        const node = findNode(value) || { path: value, label: value.split(/[/\\]/).filter(Boolean).pop() || value };
        await applyDirectoryFilter(value, node);
      });
    }

    const popTree = document.getElementById('folder-tree-popover-tree');
    if (popTree && !popTree.dataset.bound) {
      popTree.dataset.bound = '1';
      popTree.addEventListener('click', onTreeClick);
    }
    const railTree = document.getElementById('folder-rail-tree');
    if (railTree && !railTree.dataset.bound) {
      railTree.dataset.bound = '1';
      railTree.addEventListener('click', onTreeClick);
    }

    const popSearch = document.getElementById('folder-tree-search');
    if (popSearch && !popSearch.dataset.bound) {
      popSearch.dataset.bound = '1';
      popSearch.addEventListener('input', () => {
        query = popSearch.value || '';
        refreshTrees();
      });
    }
    const railSearch = document.getElementById('folder-rail-search');
    if (railSearch && !railSearch.dataset.bound) {
      railSearch.dataset.bound = '1';
      railSearch.addEventListener('input', () => {
        query = railSearch.value || '';
        refreshTrees();
      });
    }

    const railToggle = document.getElementById('folder-rail-toggle');
    if (railToggle && !railToggle.dataset.bound) {
      railToggle.dataset.bound = '1';
      railToggle.addEventListener('click', async () => {
        const rail = document.getElementById('folder-rail');
        const open = rail && rail.classList.contains('hidden');
        await setRailOpen(open);
      });
    }
    const railClose = document.getElementById('folder-rail-close');
    if (railClose && !railClose.dataset.bound) {
      railClose.dataset.bound = '1';
      railClose.addEventListener('click', () => setRailOpen(false));
    }

    const reveal = document.getElementById('reveal-in-folders-button');
    if (reveal && !reveal.dataset.bound) {
      reveal.dataset.bound = '1';
      reveal.addEventListener('click', async (e) => {
        e.preventDefault();
        const path = document.getElementById('path-tree-container')?.getAttribute('data-file-path') || '';
        await revealPath(path);
      });
    }

    if (!document.body.dataset.folderTreeDocBound) {
      document.body.dataset.folderTreeDocBound = '1';
      document.addEventListener('mousedown', (e) => {
        if (!popoverOpen) return;
        if (document.body.classList.contains('is-panel-resizing')) return;
        const pop = document.getElementById('folder-tree-popover');
        const btn = document.getElementById('folder-tree-button');
        if (pop && !pop.contains(e.target) && e.target !== btn && !btn?.contains(e.target)) {
          closePopover();
        }
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && popoverOpen) closePopover();
      });
    }
  }

  async function init() {
    bind();
    await loadRecent();
    await loadForest();
    fillSelect();
    try {
      const railPref = await window.electron.getSetting(RAIL_SETTING);
      if (railPref === 'true') await setRailOpen(true);
    } catch (_) { /* ignore */ }
  }

  window.FolderTree = {
    init,
    syncControl,
    applyDirectoryFilter,
    revealPath,
    refresh: async () => {
      await loadForest();
      fillSelect();
      refreshTrees();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
