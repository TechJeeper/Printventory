/**
 * Ctrl/Cmd+K command palette.
 */
(function () {
  let overlay = null;
  let input = null;
  let list = null;
  let items = [];
  let filtered = [];
  let active = 0;

  function defaultCommands() {
    const cmds = [
      { id: 'scan', label: 'Scan a folder', run: () => document.getElementById('scan-button')?.click() || document.getElementById('scan-directory-button')?.click() },
      { id: 'settings', label: 'Open Settings', run: () => window.electron?.openSettings?.() || document.getElementById('settings-button')?.click() },
      { id: 'tags', label: 'Open Tag Manager', run: () => window.electron?.openTagManager?.() || document.getElementById('tag-button')?.click() },
      { id: 'collections', label: 'Collections', run: () => window.CollectionsUI?.openManager?.() },
      { id: 'save-search', label: 'Save current search', run: () => window.SavedSearchesUI?.saveCurrent?.() },
      { id: 'print-queue', label: 'Print Queue', run: () => window.PrintQueueUI?.openBoard?.() },
      { id: 'jobs', label: 'Jobs Manager', run: () => window.JobsPanel?.openManager?.() },
      { id: 'find-similar', label: 'Find similar models', run: () => window.FeaturePanels?.findSimilarForCurrent?.() },
      { id: 'add-collection', label: 'Add selection to collection', run: () => {
        const ids = window.CollectionsUI?.selectedModelIds?.() || [];
        if (ids.length) window.CollectionsUI.promptAddToCollection(ids);
      } },
      { id: 'recently-removed', label: 'Recently removed', run: () => window.FeaturePanels?.openRecentlyRemoved?.() },
      { id: 'stats', label: 'Open Stats', run: () => document.getElementById('stats-dialog')?.showModal?.() },
      { id: 'shortcuts', label: 'Keyboard shortcuts', run: () => document.getElementById('keyboard-shortcuts-dialog')?.showModal?.() },
    ];
    for (const c of window._collectionsCache || []) {
      cmds.push({
        id: `collection-${c.id}`,
        label: `Collection: ${c.name}`,
        run: () => window.CollectionsUI?.applyCollectionFilter?.(c.id)
      });
    }
    for (const s of window._savedSearchesCache || []) {
      cmds.push({
        id: `saved-search-${s.id}`,
        label: `Saved: ${s.name}`,
        run: () => window.SavedSearchesUI?.applySaved?.(s)
      });
    }
    if (Array.isArray(window._commandPaletteExtra)) {
      cmds.push(...window._commandPaletteExtra);
    }
    return cmds;
  }

  function fuzzy(query, label) {
    const q = String(query || '').trim().toLowerCase();
    const l = String(label || '').toLowerCase();
    if (!q) return 1;
    if (l.includes(q)) return 2 + (l.startsWith(q) ? 1 : 0);
    let qi = 0;
    for (let i = 0; i < l.length && qi < q.length; i++) {
      if (l[i] === q[qi]) qi++;
    }
    return qi === q.length ? 1 : 0;
  }

  function ensure() {
    if (overlay) return;
    overlay = document.createElement('div');
    overlay.id = 'command-palette';
    overlay.className = 'command-palette';
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="command-palette-panel" role="dialog" aria-label="Command palette">
        <input type="text" class="command-palette-input" placeholder="Type a command…" autocomplete="off" />
        <ul class="command-palette-list" role="listbox"></ul>
      </div>`;
    document.body.appendChild(overlay);
    input = overlay.querySelector('.command-palette-input');
    list = overlay.querySelector('.command-palette-list');
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    input.addEventListener('input', () => refresh());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, filtered.length - 1); paint(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); paint(); }
      else if (e.key === 'Enter') { e.preventDefault(); runActive(); }
    });
  }

  function paint() {
    list.innerHTML = '';
    filtered.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'command-palette-item' + (i === active ? ' active' : '');
      li.textContent = item.label;
      li.role = 'option';
      li.onclick = () => { active = i; runActive(); };
      list.appendChild(li);
    });
  }

  function refresh() {
    const q = input.value;
    filtered = items
      .map((item) => ({ item, score: fuzzy(q, item.label) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.item);
    active = 0;
    paint();
  }

  function runActive() {
    const item = filtered[active];
    close();
    if (item && typeof item.run === 'function') item.run();
  }

  function open() {
    ensure();
    items = defaultCommands();
    overlay.hidden = false;
    input.value = '';
    refresh();
    input.focus();
  }

  function close() {
    if (overlay) overlay.hidden = true;
  }

  function toggle() {
    ensure();
    if (overlay.hidden) open();
    else close();
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === 'k') {
      e.preventDefault();
      toggle();
    }
  });

  window.CommandPalette = { open, close, toggle };
})();
