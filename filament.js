/**
 * Filament Management UI: catalog modal, model assignment, sidebar filter, card chips.
 */
(function () {
  function formatFilamentLabel(filament) {
    const vendor = String(filament?.vendor || '').trim();
    const name = String(filament?.name || '').trim();
    const material = String(filament?.material || '').trim();
    const base = [vendor, name].filter(Boolean).join(' ') || 'Unnamed filament';
    return material ? `${base} (${material})` : base;
  }

  function normalizeColorHex(hex) {
    if (!hex) return '';
    let h = String(hex).replace(/^#/, '').trim();
    if (h.includes(',')) h = h.split(',')[0].trim();
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return /^[0-9a-fA-F]{6}$/.test(h) ? h.toUpperCase() : '';
  }

  function colorCss(hex) {
    const n = normalizeColorHex(hex);
    return n ? `#${n}` : 'transparent';
  }

  function filamentIdOf(value) {
    if (value == null) return null;
    if (typeof value === 'object') return Number(value.id);
    const n = Number(value);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(message, isError) {
    const el = document.getElementById('filament-manager-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
  }

  function setSpoolmanStatus(message, isError) {
    const el = document.getElementById('spoolman-setup-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
  }

  function isSpoolmanSetupOpen() {
    const panel = document.getElementById('spoolman-setup-panel');
    return !!(panel && !panel.hidden);
  }

  function setSpoolmanSetupOpen(open) {
    const panel = document.getElementById('spoolman-setup-panel');
    const btn = document.getElementById('spoolman-setup-toggle');
    if (panel) panel.hidden = !open;
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Hide Spoolman' : 'Spoolman Setup';
    }
    if (!open) setSpoolmanStatus('');
  }

  async function loadSpoolmanSettingsIntoForm() {
    if (!window.electron?.getSetting) return;
    const url = await window.electron.getSetting('spoolmanUrl');
    const token = await window.electron.getSetting('spoolmanApiToken');
    const urlInput = document.getElementById('spoolman-url');
    const tokenInput = document.getElementById('spoolman-api-token');
    if (urlInput && url != null) urlInput.value = url;
    if (tokenInput && token != null) tokenInput.value = token;
  }

  async function saveSpoolmanSettingsFromForm() {
    if (!window.electron?.saveSetting) return;
    const url = document.getElementById('spoolman-url')?.value?.trim() || '';
    const token = document.getElementById('spoolman-api-token')?.value?.trim() || '';
    await window.electron.saveSetting('spoolmanUrl', url);
    await window.electron.saveSetting('spoolmanApiToken', token);
    return { url, token };
  }

  async function refreshFilamentManagerList(searchTerm = '') {
    const list = document.getElementById('filament-manager-list');
    if (!list || !window.electron?.getAllFilaments) return;
    const q = String(searchTerm || '').trim().toLowerCase();
    try {
      const filaments = await window.electron.getAllFilaments();
      window.filamentLabelById = window.filamentLabelById || {};
      list.innerHTML = '';
      const filtered = (filaments || []).filter((f) => {
        if (!q) return true;
        const hay = `${formatFilamentLabel(f)} ${f.vendor || ''} ${f.material || ''} ${f.source || ''}`.toLowerCase();
        return hay.includes(q);
      });
      if (filtered.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'filament-manager-empty';
        empty.textContent = q ? 'No filaments match that search.' : 'No filaments yet. Add one below or sync from Spoolman.';
        list.appendChild(empty);
        return;
      }
      filtered.sort((a, b) => formatFilamentLabel(a).localeCompare(formatFilamentLabel(b)));
      for (const filament of filtered) {
        window.filamentLabelById[String(filament.id)] = formatFilamentLabel(filament);
        const row = document.createElement('div');
        row.className = 'filament-manager-item';
        row.dataset.filamentId = String(filament.id);
        const swatch = `<span class="filament-swatch" style="background:${colorCss(filament.color_hex)}" title="${escapeHtml(filament.color_hex || 'No color')}"></span>`;
        const badge = filament.source === 'spoolman' ? '<span class="filament-source-badge">Spoolman</span>' : '<span class="filament-source-badge manual">Manual</span>';
        row.innerHTML = `
          ${swatch}
          <div class="filament-manager-item-body">
            <div class="filament-manager-item-name">${escapeHtml(formatFilamentLabel(filament))}</div>
            <div class="filament-manager-item-meta">${escapeHtml(filament.diameter ? `${filament.diameter} mm` : '')}</div>
          </div>
          ${badge}
          <span class="filament-count">${filament.model_count || 0}</span>
          <button type="button" class="filament-remove" title="Remove from Printventory" aria-label="Delete filament">×</button>
        `;
        row.querySelector('.filament-remove')?.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const ok = window.confirm
            ? window.confirm(`Remove "${formatFilamentLabel(filament)}" from Printventory? Model assignments will be cleared. Synced filaments return on the next Spoolman sync.`)
            : true;
          if (!ok) return;
          try {
            await window.electron.deleteFilament(filament.id);
            await refreshFilamentManagerList(document.getElementById('filament-manager-search')?.value || '');
            await window.populateFilamentSelect?.();
            await window.populateFilamentFilter?.();
          } catch (err) {
            console.error('Error deleting filament:', err);
            setStatus(err.message || 'Failed to delete filament', true);
          }
        });
        list.appendChild(row);
      }
    } catch (error) {
      console.error('Error loading filaments:', error);
      list.innerHTML = `<div class="filament-manager-empty">Failed to load filaments: ${escapeHtml(error.message || error)}</div>`;
    }
  }

  async function openFilamentManager() {
    const dialog = document.getElementById('filament-manager-dialog');
    if (!dialog) return;
    dialog.classList.remove('modal-fullscreen');
    const fullscreenBtn = document.getElementById('filament-manager-fullscreen-toggle');
    if (fullscreenBtn) fullscreenBtn.textContent = 'Full Screen';
    await loadSpoolmanSettingsIntoForm();
    const searchEl = document.getElementById('filament-manager-search');
    if (searchEl) searchEl.value = '';
    setStatus('');
    setSpoolmanSetupOpen(false);
    await refreshFilamentManagerList();
    dialog.showModal();
  }

  function wireFilamentManager() {
    window._electronRealEventHandlers = window._electronRealEventHandlers || {};
    window._electronRealEventHandlers['open-filament-manager'] = function () {
      openFilamentManager();
    };
    if (window._electronPendingEvents?.['open-filament-manager']) {
      window._electronPendingEvents['open-filament-manager'].forEach((args) => {
        window._electronRealEventHandlers['open-filament-manager'].apply(null, args);
      });
      delete window._electronPendingEvents['open-filament-manager'];
    }

    document.getElementById('filament-manager-fullscreen-toggle')?.addEventListener('click', () => {
      const dialog = document.getElementById('filament-manager-dialog');
      const btn = document.getElementById('filament-manager-fullscreen-toggle');
      if (!dialog || !btn) return;
      dialog.classList.toggle('modal-fullscreen');
      btn.textContent = dialog.classList.contains('modal-fullscreen') ? 'Exit Full Screen' : 'Full Screen';
    });

    document.getElementById('filament-manager-search')?.addEventListener('input', (e) => {
      refreshFilamentManagerList(e.target.value.trim());
    });
    document.getElementById('clear-filament-search')?.addEventListener('click', async () => {
      const searchEl = document.getElementById('filament-manager-search');
      if (searchEl) searchEl.value = '';
      await refreshFilamentManagerList();
    });

    const colorText = document.getElementById('new-filament-color');
    const colorPicker = document.getElementById('new-filament-color-picker');
    colorPicker?.addEventListener('input', () => {
      if (colorText) colorText.value = String(colorPicker.value || '').replace('#', '').toUpperCase();
    });
    colorText?.addEventListener('input', () => {
      const n = normalizeColorHex(colorText.value);
      if (n && colorPicker) colorPicker.value = `#${n}`;
    });

    document.getElementById('add-filament-manager-button')?.addEventListener('click', async () => {
      const name = document.getElementById('new-filament-name')?.value?.trim();
      if (!name) {
        setStatus('Name is required to add a filament.', true);
        return;
      }
      const vendor = document.getElementById('new-filament-vendor')?.value?.trim() || '';
      const material = document.getElementById('new-filament-material')?.value?.trim() || '';
      const color = normalizeColorHex(document.getElementById('new-filament-color')?.value || document.getElementById('new-filament-color-picker')?.value);
      const diameterRaw = document.getElementById('new-filament-diameter')?.value;
      const diameter = diameterRaw === '' || diameterRaw == null ? 1.75 : Number(diameterRaw);
      try {
        await window.electron.saveFilament({
          name,
          vendor,
          material,
          color_hex: color,
          diameter: Number.isFinite(diameter) ? diameter : 1.75,
          source: 'manual'
        });
        document.getElementById('new-filament-name').value = '';
        document.getElementById('new-filament-vendor').value = '';
        document.getElementById('new-filament-material').value = '';
        setStatus(`Added ${name}`, false);
        await refreshFilamentManagerList(document.getElementById('filament-manager-search')?.value || '');
        await window.populateFilamentSelect?.();
        await window.populateFilamentFilter?.();
      } catch (error) {
        console.error('Error saving filament:', error);
        setStatus(error.message || 'Failed to add filament', true);
      }
    });

    document.getElementById('spoolman-setup-toggle')?.addEventListener('click', () => {
      setSpoolmanSetupOpen(!isSpoolmanSetupOpen());
    });

    document.getElementById('spoolman-test-button')?.addEventListener('click', async () => {
      try {
        const { url, token } = await saveSpoolmanSettingsFromForm();
        if (!url) {
          setSpoolmanStatus('Enter a Spoolman URL first.', true);
          return;
        }
        setSpoolmanStatus('Testing connection…');
        const result = await window.electron.testSpoolmanConnection(url, token);
        const version = result?.version ? ` (v${result.version})` : '';
        setSpoolmanStatus(`Connected${version}.`, false);
      } catch (error) {
        console.error('Spoolman test failed:', error);
        setSpoolmanStatus(error.message || 'Connection failed', true);
      }
    });

    document.getElementById('spoolman-sync-button')?.addEventListener('click', async () => {
      try {
        const { url, token } = await saveSpoolmanSettingsFromForm();
        if (!url) {
          setSpoolmanStatus('Enter a Spoolman URL first.', true);
          return;
        }
        setSpoolmanStatus('Syncing filaments from Spoolman…');
        const result = await window.electron.syncSpoolmanFilaments(url, token);
        const created = result?.created || 0;
        const updated = result?.updated || 0;
        setSpoolmanStatus(`Synced ${result?.total || 0} filaments (${created} new, ${updated} updated).`, false);
        await refreshFilamentManagerList(document.getElementById('filament-manager-search')?.value || '');
        await window.populateFilamentSelect?.();
        await window.populateFilamentFilter?.();
      } catch (error) {
        console.error('Spoolman sync failed:', error);
        setSpoolmanStatus(error.message || 'Sync failed', true);
      }
    });

    document.getElementById('filament-manager-dialog')?.addEventListener('close', async () => {
      try {
        await saveSpoolmanSettingsFromForm();
        await window.populateFilamentSelect?.();
        await window.populateFilamentFilter?.();
        const currentModelPath = (typeof getCurrentModelFilePath === 'function' && getCurrentModelFilePath())
          || (typeof currentModelDetailsPath !== 'undefined' ? currentModelDetailsPath : null);
        if (currentModelPath) {
          await window.loadModelFilaments?.(currentModelPath);
        }
        if (typeof window.performCombinedSearch === 'function') {
          await window.performCombinedSearch();
        }
      } catch (error) {
        console.error('Error refreshing after filament manager close:', error);
      }
    });
  }

  function currentFilamentIds(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.filament-chip'))
      .map((el) => Number(el.getAttribute('data-filament-id')))
      .filter((id) => Number.isInteger(id) && id > 0);
  }

  async function addFilamentToModel(filament, containerId, options = {}) {
    const { skipSave = false } = options;
    const tagContainer = document.getElementById(containerId);
    if (!tagContainer) return;
    const id = filamentIdOf(filament);
    if (!id) return;
    const existing = tagContainer.querySelector(`.filament-chip[data-filament-id="${id}"]`);
    if (existing) return;

    let record = filament;
    if (typeof filament !== 'object' || !filament.name) {
      try {
        const all = await window.electron.getAllFilaments();
        record = (all || []).find((f) => Number(f.id) === id) || { id, name: String(filament) };
      } catch (_) {
        record = { id, name: String(id) };
      }
    }

    const chip = document.createElement('div');
    chip.className = 'filament-chip';
    chip.setAttribute('data-filament-id', String(id));
    chip.setAttribute('title', formatFilamentLabel(record));
    chip.innerHTML = `
      <span class="filament-swatch" style="background:${colorCss(record.color_hex)}"></span>
      <span class="filament-chip-text">${escapeHtml(formatFilamentLabel(record))}</span>
      <span class="filament-chip-remove">×</span>
    `;
    chip.querySelector('.filament-chip-remove')?.addEventListener('click', async () => {
      chip.remove();
      const ids = currentFilamentIds(containerId);
      if (containerId === 'multi-filaments') {
        await autoSaveMultipleModels('filaments', ids, { replaceFilaments: true });
      } else {
        const filePath = typeof getModelFilePath === 'function' ? getModelFilePath() : null;
        if (filePath) await autoSaveModel('filaments', ids, filePath);
      }
      await window.populateFilamentSelect?.(containerId === 'multi-filaments' ? 'multi-filament-select' : 'filament-select', containerId);
    });
    tagContainer.appendChild(chip);

    if (skipSave) return;

    if (containerId === 'multi-filaments') {
      await autoSaveMultipleModels('filaments', [id]);
    } else {
      const filePath = typeof getModelFilePath === 'function' ? getModelFilePath() : null;
      if (filePath) await autoSaveModel('filaments', currentFilamentIds(containerId), filePath);
    }
    await window.populateFilamentSelect?.(containerId === 'multi-filaments' ? 'multi-filament-select' : 'filament-select', containerId);
  }

  async function loadModelFilaments(modelIdOrPath) {
    const container = document.getElementById('model-filaments');
    if (!container) return;
    container.innerHTML = '';
    try {
      const model = await window.electron.getModel(modelIdOrPath);
      if (!model || !model.id) return;
      const filaments = await window.electron.getModelFilaments(model.id);
      const list = Array.isArray(filaments) ? filaments : [];
      list.sort((a, b) => formatFilamentLabel(a).localeCompare(formatFilamentLabel(b)));
      for (const filament of list) {
        await addFilamentToModel(filament, 'model-filaments', { skipSave: true });
      }
      await window.populateFilamentSelect?.('filament-select', 'model-filaments');
    } catch (error) {
      console.error('Error loading model filaments:', error);
    }
  }

  async function populateFilamentSelect(selectId = 'filament-select', containerId = 'model-filaments') {
    const select = document.getElementById(selectId);
    if (!select) return;
    const selected = new Set(currentFilamentIds(containerId).map(String));
    select.innerHTML = '<option value="">Select a filament...</option>';
    try {
      const filaments = await window.electron.getAllFilaments();
      (filaments || [])
        .slice()
        .sort((a, b) => formatFilamentLabel(a).localeCompare(formatFilamentLabel(b)))
        .forEach((filament) => {
          if (selected.has(String(filament.id))) return;
          const option = document.createElement('option');
          option.value = String(filament.id);
          option.textContent = formatFilamentLabel(filament);
          select.appendChild(option);
        });
    } catch (error) {
      console.error('Error fetching filaments:', error);
    }
  }

  async function populateFilamentFilter() {
    const select = document.getElementById('filament-filter');
    if (!select) return;
    const previous = select.value;
    select.innerHTML = '<option value="">All Filaments</option>';
    window.filamentLabelById = window.filamentLabelById || {};
    try {
      const filaments = await window.electron.getAllFilaments();
      (filaments || [])
        .slice()
        .sort((a, b) => formatFilamentLabel(a).localeCompare(formatFilamentLabel(b)))
        .forEach((filament) => {
          const label = formatFilamentLabel(filament);
          window.filamentLabelById[String(filament.id)] = label;
          const option = document.createElement('option');
          option.value = String(filament.id);
          option.textContent = `${label} (${filament.model_count || 0})`;
          select.appendChild(option);
        });
      if (previous && Array.from(select.options).some((o) => o.value === previous)) {
        select.value = previous;
      }
    } catch (error) {
      console.error('Error populating filament filter:', error);
    }
  }

  async function populateRemoveFilamentSelect() {
    const select = document.getElementById('multi-filament-remove-select');
    if (!select) return;
    select.innerHTML = '<option value="">Select a filament to remove...</option>';
    if (typeof selectedModels === 'undefined' || selectedModels.size === 0) return;
    try {
      const filePaths = Array.from(selectedModels);
      const lists = await Promise.all(filePaths.map(async (filePath) => {
        try {
          const model = await window.electron.getModel(filePath);
          return Array.isArray(model?.filaments) ? model.filaments : [];
        } catch (_) {
          return [];
        }
      }));
      const byId = new Map();
      lists.flat().forEach((f) => {
        const id = filamentIdOf(f);
        if (id && !byId.has(id)) byId.set(id, f);
      });
      Array.from(byId.values())
        .sort((a, b) => formatFilamentLabel(a).localeCompare(formatFilamentLabel(b)))
        .forEach((filament) => {
          const option = document.createElement('option');
          option.value = String(filament.id);
          option.textContent = formatFilamentLabel(filament);
          select.appendChild(option);
        });
    } catch (error) {
      console.error('Error populating remove filament select:', error);
    }
  }

  function updateModelFilamentDisplay(existingElement) {
    if (!existingElement) return;
    existingElement.querySelectorAll('.filaments-info-column, .filaments-item').forEach((el) => el.remove());
  }

  function wireAssignmentControls() {
    const filamentSelect = document.getElementById('filament-select');
    filamentSelect?.addEventListener('change', async () => {
      const id = Number(filamentSelect.value);
      if (id) {
        await addFilamentToModel({ id }, 'model-filaments');
        filamentSelect.value = '';
      }
    });

    const multiSelect = document.getElementById('multi-filament-select');
    multiSelect?.addEventListener('change', async () => {
      const id = Number(multiSelect.value);
      if (id) {
        await addFilamentToModel({ id }, 'multi-filaments');
        multiSelect.value = '';
      }
    });

    const removeSelect = document.getElementById('multi-filament-remove-select');
    removeSelect?.addEventListener('change', async () => {
      const id = Number(removeSelect.value);
      if (!id) return;
      const chip = document.getElementById('multi-filaments')?.querySelector(`.filament-chip[data-filament-id="${id}"]`);
      chip?.remove();
      const remaining = currentFilamentIds('multi-filaments');
      await autoSaveMultipleModels('filaments', remaining, { replaceFilaments: true });
      removeSelect.value = '';
      await populateRemoveFilamentSelect();
      await populateFilamentSelect('multi-filament-select', 'multi-filaments');
    });

    document.getElementById('add-filament-button')?.addEventListener('click', () => {
      openFilamentManager();
    });
    document.querySelectorAll('.add-filament-button').forEach((button) => {
      button.addEventListener('click', () => openFilamentManager());
    });
  }

  async function initializeFilaments() {
    wireFilamentManager();
    wireAssignmentControls();
    await populateFilamentSelect('filament-select', 'model-filaments');
    await populateFilamentSelect('multi-filament-select', 'multi-filaments');
    await populateFilamentFilter();
    if (typeof populateTagFilter === 'function' && !populateTagFilter._filamentWrapped) {
      const origFilter = populateTagFilter;
      const wrappedFilter = async function () {
        await origFilter.apply(this, arguments);
        await populateFilamentFilter();
      };
      wrappedFilter._filamentWrapped = true;
      populateTagFilter = wrappedFilter;
      window.populateTagFilter = wrappedFilter;
    }
  }

  window.formatFilamentLabel = formatFilamentLabel;
  window.openFilamentManager = openFilamentManager;
  window.refreshFilamentManagerList = refreshFilamentManagerList;
  window.loadModelFilaments = loadModelFilaments;
  window.populateFilamentSelect = populateFilamentSelect;
  window.populateFilamentFilter = populateFilamentFilter;
  window.populateRemoveFilamentSelect = populateRemoveFilamentSelect;
  window.addFilamentToModel = addFilamentToModel;
  window.updateModelFilamentDisplay = updateModelFilamentDisplay;
  window.initializeFilaments = initializeFilaments;
  window.toggleFilamentManagerFullscreen = function () {
    const dialog = document.getElementById('filament-manager-dialog');
    const btn = document.getElementById('filament-manager-fullscreen-toggle');
    if (!dialog || !btn) return;
    dialog.classList.toggle('modal-fullscreen');
    btn.textContent = dialog.classList.contains('modal-fullscreen') ? 'Exit Full Screen' : 'Full Screen';
  };

  function boot() {
    initializeFilaments().catch((err) => console.error('Error initializing filaments:', err));
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
