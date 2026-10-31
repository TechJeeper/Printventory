/**
 * Collections manager UI: create/rename/delete, filter, add selected models.
 */
(function () {
  'use strict';

  let cache = [];
  let activeCollectionId = null;

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, { type: type || 'info' });
    else if (window.electron?.showMessage) window.electron.showMessage('Collections', msg);
  }

  async function refreshList(search) {
    const list = document.getElementById('collections-manager-list');
    const filterSelect = document.getElementById('collection-filter');
    if (!window.electron?.listCollections) return;
    cache = (await window.electron.listCollections()) || [];
    const q = String(search || '').trim().toLowerCase();
    const rows = q ? cache.filter((c) => String(c.name).toLowerCase().includes(q)) : cache;

    if (list) {
      list.innerHTML = '';
      if (!rows.length) {
        list.innerHTML = '<div class="collections-empty">No collections yet. Create one above.</div>';
      } else {
        for (const c of rows) {
          const row = document.createElement('div');
          row.className = 'collections-row';
          row.dataset.id = String(c.id);
          row.innerHTML =
            `<button type="button" class="collections-row-open" title="Show models in this collection">` +
            `<span class="collections-row-name"></span>` +
            `<span class="collections-row-count">${Number(c.model_count) || 0}</span></button>` +
            `<button type="button" class="collections-row-rename icon-button" title="Rename">✎</button>` +
            `<button type="button" class="collections-row-delete icon-button" title="Delete">×</button>`;
          row.querySelector('.collections-row-name').textContent = c.name;
          list.appendChild(row);
        }
      }
    }

    if (filterSelect) {
      const prev = filterSelect.value;
      filterSelect.innerHTML = '<option value="">All collections</option>';
      for (const c of cache) {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = `${c.name} (${Number(c.model_count) || 0})`;
        filterSelect.appendChild(opt);
      }
      if (prev && [...filterSelect.options].some((o) => o.value === prev)) filterSelect.value = prev;
      else if (activeCollectionId) filterSelect.value = String(activeCollectionId);
    }

    const addSelect = document.getElementById('collections-add-selected-select');
    if (addSelect) {
      const prevAdd = addSelect.value;
      addSelect.innerHTML = '<option value="">Select collection…</option>';
      for (const c of cache) {
        const opt = document.createElement('option');
        opt.value = String(c.id);
        opt.textContent = c.name;
        addSelect.appendChild(opt);
      }
      if (prevAdd) addSelect.value = prevAdd;
    }

    window._collectionsCache = cache;
  }

  async function createFromInput() {
    const input = document.getElementById('new-collection-name');
    const name = (input?.value || '').trim();
    if (!name) return;
    try {
      await window.electron.createCollection(name);
      if (input) input.value = '';
      await refreshList(document.getElementById('collections-manager-search')?.value);
      toast(`Created “${name}”`, 'success');
    } catch (err) {
      toast(err.message || 'Could not create collection', 'error');
    }
  }

  async function applyCollectionFilter(id) {
    activeCollectionId = id ? Number(id) : null;
    window.activeCollectionId = activeCollectionId;
    const filterSelect = document.getElementById('collection-filter');
    if (filterSelect) filterSelect.value = activeCollectionId ? String(activeCollectionId) : '';
    if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
  }

  async function clearCollectionFilter() {
    await applyCollectionFilter(null);
  }

  function selectedModelIds() {
    const ids = [];
    if (Array.isArray(window._selectedModelIds) && window._selectedModelIds.length) {
      return window._selectedModelIds.map(Number).filter((n) => n > 0);
    }
    const cards = document.querySelectorAll('.model-item.selected, .file-item.selected, [data-model-id].selected');
    cards.forEach((el) => {
      const id = Number(el.dataset.modelId || el.dataset.id);
      if (id > 0) ids.push(id);
    });
    if (ids.length) return [...new Set(ids)];
    // Fallback: current details model
    const details = document.getElementById('model-details');
    const mid = Number(details?.dataset?.modelId || window.currentModelId);
    if (mid > 0) ids.push(mid);
    return ids;
  }

  async function resolveSelectedModelIds(filePaths) {
    let ids = selectedModelIds();
    if (ids.length) return ids;
    const paths = Array.isArray(filePaths) && filePaths.length
      ? filePaths
      : (Array.isArray(window.selectedModels) ? window.selectedModels : []);
    if (paths.length && window.electron?.resolveModelIdsByPaths) {
      ids = (await window.electron.resolveModelIdsByPaths(paths)) || [];
    }
    return ids.map(Number).filter((n) => n > 0);
  }

  async function addSelectedToCollection(collectionId) {
    const modelIds = selectedModelIds();
    if (!modelIds.length) {
      toast('Select one or more models first', 'warning');
      return;
    }
    try {
      const result = await window.electron.addModelsToCollection(collectionId, modelIds);
      await refreshList();
      toast(`Added ${result?.added ?? modelIds.length} model(s)`, 'success');
    } catch (err) {
      toast(err.message || 'Could not add to collection', 'error');
    }
  }

  async function promptAddToCollection(modelIds) {
    let ids = Array.isArray(modelIds) ? modelIds.map(Number).filter((n) => n > 0) : [];
    if (!ids.length) ids = await resolveSelectedModelIds();
    if (!ids.length) {
      toast('Select one or more models first', 'warning');
      return;
    }
    modelIds = ids;
    window._collectionsPickerModelIds = ids;
    if (!window.electron?.listCollections) return;
    cache = (await window.electron.listCollections()) || [];
    if (!cache.length) {
      const name = await window.electron.showInputDialog?.({
        title: 'New collection',
        message: 'No collections yet. Enter a name to create one and add the selected models:',
        defaultValue: ''
      });
      if (!name || !String(name).trim()) return;
      try {
        const created = await window.electron.createCollection(String(name).trim());
        await window.electron.addModelsToCollection(created.id, modelIds);
        await refreshList();
        toast(`Added to “${created.name}”`, 'success');
      } catch (err) {
        toast(err.message || 'Could not create collection', 'error');
      }
      return;
    }
    openPicker(modelIds);
  }

  function openPicker(modelIds) {
    let dlg = document.getElementById('collections-picker-dialog');
    if (!dlg) return;
    const list = document.getElementById('collections-picker-list');
    const summary = document.getElementById('collections-picker-summary');
    if (summary) {
      summary.textContent = `Add ${modelIds.length} selected model${modelIds.length === 1 ? '' : 's'} to a collection:`;
    }
    list.innerHTML = '';
    for (const c of cache) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'collections-picker-item';
      btn.textContent = `${c.name} (${Number(c.model_count) || 0})`;
      btn.addEventListener('click', async () => {
        dlg.close();
        await window.electron.addModelsToCollection(c.id, modelIds);
        await refreshList();
        toast(`Added to “${c.name}”`, 'success');
      });
      list.appendChild(btn);
    }
    dlg.showModal();
  }

  function openManager() {
    const dlg = document.getElementById('collections-manager-dialog');
    if (!dlg) return;
    refreshList();
    dlg.showModal();
  }

  function wire() {
    document.getElementById('collections-button')?.addEventListener('click', openManager);
    document.getElementById('add-collection-manager-button')?.addEventListener('click', createFromInput);
    document.getElementById('new-collection-name')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createFromInput();
      }
    });
    document.getElementById('collections-manager-search')?.addEventListener('input', (e) => {
      refreshList(e.target.value);
    });
    document.getElementById('collections-manager-list')?.addEventListener('click', async (e) => {
      const row = e.target.closest('.collections-row');
      if (!row) return;
      const id = Number(row.dataset.id);
      if (e.target.closest('.collections-row-delete')) {
        const name = row.querySelector('.collections-row-name')?.textContent || 'collection';
        const ok = await window.electron.showMessage('Delete collection?', `Delete “${name}”? Models stay in the library.`, ['Delete', 'Cancel']);
        if (ok !== 'Delete') return;
        await window.electron.deleteCollection(id);
        if (activeCollectionId === id) await clearCollectionFilter();
        await refreshList(document.getElementById('collections-manager-search')?.value);
        toast('Collection deleted', 'success');
        return;
      }
      if (e.target.closest('.collections-row-rename')) {
        const current = row.querySelector('.collections-row-name')?.textContent || '';
        const next = await window.electron.showInputDialog?.({
          title: 'Rename collection',
          message: 'New name:',
          defaultValue: current
        });
        if (!next || !String(next).trim() || String(next).trim() === current) return;
        try {
          await window.electron.renameCollection(id, String(next).trim());
          await refreshList(document.getElementById('collections-manager-search')?.value);
        } catch (err) {
          toast(err.message || 'Could not rename collection', 'error');
        }
        return;
      }
      if (e.target.closest('.collections-row-open')) {
        document.getElementById('collections-manager-dialog')?.close();
        await applyCollectionFilter(id);
      }
    });

    document.getElementById('collection-filter')?.addEventListener('change', async (e) => {
      const v = e.target.value;
      await applyCollectionFilter(v || null);
    });

    document.getElementById('collections-add-selected-button')?.addEventListener('click', async () => {
      const sel = document.getElementById('collections-add-selected-select');
      const id = Number(sel?.value);
      if (!id) {
        toast('Pick a collection first', 'warning');
        return;
      }
      await addSelectedToCollection(id);
      await refreshList();
      if (sel) {
        // refresh options counts
        const opt = [...(sel.options || [])].find((o) => o.value === String(id));
        if (opt) sel.value = String(id);
      }
    });

    document.getElementById('collections-picker-new')?.addEventListener('click', async () => {
      const name = await window.electron.showInputDialog?.({
        title: 'New collection',
        message: 'Collection name:',
        defaultValue: ''
      });
      if (!name || !String(name).trim()) return;
      try {
        const created = await window.electron.createCollection(String(name).trim());
        document.getElementById('collections-picker-dialog')?.close();
        const ids = window._collectionsPickerModelIds || selectedModelIds();
        if (ids.length) await window.electron.addModelsToCollection(created.id, ids);
        await refreshList();
        toast(`Created “${created.name}”`, 'success');
      } catch (err) {
        toast(err.message || 'Could not create collection', 'error');
      }
    });

    if (window.electron?.onOpenCollections) {
      window.electron.onOpenCollections(() => openManager());
    }

    // Fallback when showInputDialog is unavailable
    if (!window.electron.showInputDialog) {
      window.electron.showInputDialog = async ({ title, message, defaultValue }) => {
        const v = window.prompt(`${title || ''}\n${message || ''}`.trim(), defaultValue || '');
        return v;
      };
    }

    ['filter-size-gt', 'filter-date-within-days', 'filter-print-count-gt', 'filter-rating-gte', 'filter-last-printed-before'].forEach((id) => {
      document.getElementById(id)?.addEventListener('change', () => {
        window._savedSearchNumeric = null;
        if (typeof window.performCombinedSearch === 'function') window.performCombinedSearch();
      });
    });

    refreshList().catch(() => {});
  }

  window.CollectionsUI = {
    openManager,
    refreshList,
    applyCollectionFilter,
    clearCollectionFilter,
    promptAddToCollection,
    addSelectedToCollection,
    selectedModelIds,
    resolveSelectedModelIds,
    getActiveCollectionId: () => activeCollectionId
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
