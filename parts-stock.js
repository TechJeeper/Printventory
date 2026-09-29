/**
 * Parts Stock: hardware inventory (screws, bearings, inserts) used when logging a print.
 */
(function () {
  let editingPartId = null;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function setStatus(message, isError) {
    const el = document.getElementById('parts-stock-status');
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
  }

  function friendlyError(error) {
    const message = String(error?.message || error || 'Could not save part');
    return message.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '');
  }

  function searchValue() {
    return document.getElementById('parts-stock-search')?.value || '';
  }

  function isPartsAddOpen() {
    const body = document.getElementById('parts-stock-form-body');
    return !body || !body.hidden;
  }

  function setPartsAddOpen(open) {
    const section = document.getElementById('parts-stock-form-section');
    const body = document.getElementById('parts-stock-form-body');
    const btn = document.getElementById('parts-stock-toggle-add-btn');
    if (body) body.hidden = !open;
    if (section) section.classList.toggle('collapsed', !open);
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '− Cancel' : '+ Add Part';
      btn.classList.toggle('active', open);
    }
  }

  function resetForm() {
    editingPartId = null;
    const name = document.getElementById('parts-stock-name');
    const category = document.getElementById('parts-stock-category');
    const quantity = document.getElementById('parts-stock-quantity');
    const unit = document.getElementById('parts-stock-unit');
    const low = document.getElementById('parts-stock-low');
    const notes = document.getElementById('parts-stock-notes');
    const add = document.getElementById('parts-stock-add');
    const cancel = document.getElementById('parts-stock-cancel-edit');
    const label = document.getElementById('parts-stock-form-label');
    if (name) name.value = '';
    if (category) category.value = '';
    if (quantity) quantity.value = '0';
    if (unit) unit.value = 'pcs';
    if (low) low.value = '0';
    if (notes) notes.value = '';
    if (add) add.textContent = 'Add';
    if (cancel) cancel.textContent = 'Cancel';
    if (label) label.textContent = 'Add a part';
    setPartsAddOpen(false);
  }

  function beginEdit(part) {
    setPartsAddOpen(true);
    editingPartId = part.id;
    const name = document.getElementById('parts-stock-name');
    const category = document.getElementById('parts-stock-category');
    const quantity = document.getElementById('parts-stock-quantity');
    const unit = document.getElementById('parts-stock-unit');
    const low = document.getElementById('parts-stock-low');
    const notes = document.getElementById('parts-stock-notes');
    const add = document.getElementById('parts-stock-add');
    const cancel = document.getElementById('parts-stock-cancel-edit');
    const label = document.getElementById('parts-stock-form-label');
    if (name) name.value = part.name || '';
    if (category) category.value = part.category || '';
    if (quantity) quantity.value = String(part.quantity ?? 0);
    if (unit) unit.value = part.unit || 'pcs';
    if (low) low.value = String(part.low_stock ?? 0);
    if (notes) notes.value = part.notes || '';
    if (add) add.textContent = 'Save';
    if (cancel) cancel.textContent = 'Cancel Edit';
    if (label) label.textContent = 'Edit part';
    name?.focus();
  }

  function readForm() {
    return {
      id: editingPartId || undefined,
      name: document.getElementById('parts-stock-name')?.value?.trim() || '',
      category: document.getElementById('parts-stock-category')?.value?.trim() || '',
      quantity: document.getElementById('parts-stock-quantity')?.value,
      unit: document.getElementById('parts-stock-unit')?.value?.trim() || 'pcs',
      notes: document.getElementById('parts-stock-notes')?.value?.trim() || '',
      lowStock: document.getElementById('parts-stock-low')?.value
    };
  }

  async function persistPart(part, { keepForm = false } = {}) {
    if (!window.electron?.savePart) throw new Error('Parts Stock is not available');
    await window.electron.savePart({
      id: part.id,
      name: part.name,
      category: part.category || '',
      quantity: part.quantity,
      unit: part.unit || 'pcs',
      notes: part.notes || '',
      lowStock: part.lowStock ?? part.low_stock ?? 0
    });
    if (!keepForm) resetForm();
    await refreshPartsList(searchValue());
    document.dispatchEvent(new CustomEvent('parts-stock-changed'));
  }

  async function refreshPartsList(searchTerm = '') {
    const list = document.getElementById('parts-stock-list');
    if (!list || !window.electron?.getAllParts) return;
    const q = String(searchTerm || '').trim().toLowerCase();
    try {
      const parts = await window.electron.getAllParts();
      list.innerHTML = '';
      const filtered = (parts || []).filter((part) => {
        if (!q) return true;
        const hay = `${part.name || ''} ${part.category || ''} ${part.notes || ''} ${part.unit || ''}`.toLowerCase();
        return hay.includes(q);
      });
      const countBadge = document.getElementById('parts-stock-count-badge');
      if (countBadge) {
        countBadge.textContent = filtered.length ? `${filtered.length} part${filtered.length === 1 ? '' : 's'}` : '';
      }
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'parts-stock-empty';
        empty.innerHTML = q
          ? '<span style="font-size:22px;margin-bottom:4px;">🔍</span><span>No parts match that search.</span>'
          : '<span style="font-size:22px;margin-bottom:4px;">🔩</span><span>No parts yet. Add screws, bearings, inserts, and anything else a print uses up.</span>';
        list.appendChild(empty);
        return;
      }
      filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
      for (const part of filtered) {
        const lowAt = Number(part.low_stock) || 0;
        const qty = Number(part.quantity) || 0;
        const isLow = qty <= lowAt;
        const row = document.createElement('div');
        row.className = `parts-stock-item${isLow ? ' is-low' : ''}`;
        row.dataset.partId = String(part.id);

        const tags = [];
        if (part.category) {
          tags.push(`<span class="parts-stock-tag category">${escapeHtml(part.category)}</span>`);
        }
        tags.push(`<span class="parts-stock-tag">${escapeHtml(part.unit || 'pcs')}</span>`);
        if (isLow) {
          tags.push(`<span class="parts-stock-low-badge" title="Low stock alert (threshold: ${lowAt})">⚠️ Low stock</span>`);
        }
        if (part.notes) {
          tags.push(`<span class="parts-stock-notes-text" title="${escapeHtml(part.notes)}">${escapeHtml(part.notes)}</span>`);
        }

        row.innerHTML = `
          <div class="parts-stock-item-body">
            <div class="parts-stock-item-name" title="${escapeHtml(part.name)}">${escapeHtml(part.name)}</div>
            <div class="parts-stock-item-meta">${tags.join('')}</div>
          </div>
          <div class="parts-stock-qty">
            <button type="button" class="parts-stock-step" data-delta="-1" title="Remove one" aria-label="Decrease quantity">−</button>
            <input type="number" class="parts-stock-qty-input" min="0" max="1000000" step="1" value="${qty}" aria-label="Quantity on hand">
            <button type="button" class="parts-stock-step" data-delta="1" title="Add one" aria-label="Increase quantity">+</button>
          </div>
          <button type="button" class="parts-stock-edit" title="Edit part details">Edit</button>
          <button type="button" class="parts-stock-remove" title="Remove from Parts Stock" aria-label="Delete part">×</button>
        `;
        row.querySelectorAll('.parts-stock-step').forEach((button) => {
          button.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            const delta = Number(button.dataset.delta) || 0;
            const next = Math.max(0, qty + delta);
            try {
              await persistPart({ ...part, quantity: next }, { keepForm: true });
            } catch (err) {
              setStatus(friendlyError(err), true);
            }
          });
        });
        row.querySelector('.parts-stock-qty-input')?.addEventListener('change', async (e) => {
          const next = Math.max(0, Math.floor(Number(e.target.value) || 0));
          try {
            await persistPart({ ...part, quantity: next }, { keepForm: true });
          } catch (err) {
            setStatus(friendlyError(err), true);
          }
        });
        row.querySelector('.parts-stock-edit')?.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          beginEdit(part);
          setStatus('');
        });
        row.querySelector('.parts-stock-remove')?.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const ok = window.confirm
            ? window.confirm(`Remove "${part.name}" from Parts Stock? Older print logs keep the part name. Stock is not restored.`)
            : true;
          if (!ok) return;
          try {
            await window.electron.deletePart(part.id);
            if (editingPartId === part.id) resetForm();
            await refreshPartsList(searchValue());
            document.dispatchEvent(new CustomEvent('parts-stock-changed'));
          } catch (err) {
            setStatus(friendlyError(err), true);
          }
        });
        list.appendChild(row);
      }
    } catch (error) {
      console.error('Error loading parts:', error);
      list.innerHTML = `<div class="parts-stock-empty">Failed to load parts: ${escapeHtml(friendlyError(error))}</div>`;
    }
  }

  async function saveFromForm() {
    const part = readForm();
    if (!part.name) {
      setStatus('Name is required.', true);
      return;
    }
    try {
      await persistPart(part);
      setStatus(editingPartId ? '' : 'Part saved.');
      setPartsAddOpen(false);
    } catch (error) {
      console.error('Error saving part:', error);
      setStatus(friendlyError(error), true);
    }
  }

  function syncPartsStockFullscreenButton(isFullscreen) {
    const btn = document.getElementById('parts-stock-fullscreen-toggle');
    if (!btn) return;
    const full = !!isFullscreen;
    btn.title = full ? 'Exit Full Screen' : 'Full Screen';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
  }

  function togglePartsStockFullscreen() {
    const dialog = document.getElementById('parts-stock-dialog');
    if (!dialog) return;
    dialog.classList.toggle('modal-fullscreen');
    syncPartsStockFullscreenButton(dialog.classList.contains('modal-fullscreen'));
  }

  async function openPartsStock() {
    const dialog = document.getElementById('parts-stock-dialog');
    if (!dialog) return;
    dialog.classList.remove('modal-fullscreen');
    syncPartsStockFullscreenButton(false);
    resetForm();
    setPartsAddOpen(false);
    const searchEl = document.getElementById('parts-stock-search');
    if (searchEl) searchEl.value = '';
    setStatus('');
    await refreshPartsList();
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  }

  function wirePartsStock() {
    window._electronRealEventHandlers = window._electronRealEventHandlers || {};
    window._electronRealEventHandlers['open-parts-stock'] = function () {
      openPartsStock();
    };
    if (window._electronPendingEvents?.['open-parts-stock']) {
      window._electronPendingEvents['open-parts-stock'].forEach((args) => {
        window._electronRealEventHandlers['open-parts-stock'].apply(null, args);
      });
      delete window._electronPendingEvents['open-parts-stock'];
    }

    document.getElementById('parts-stock-toggle-add-btn')?.addEventListener('click', () => {
      const open = !isPartsAddOpen();
      setPartsAddOpen(open);
      if (open) document.getElementById('parts-stock-name')?.focus();
      else resetForm();
    });

    document.getElementById('parts-stock-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      saveFromForm();
    });
    document.getElementById('parts-stock-cancel-edit')?.addEventListener('click', () => {
      resetForm();
      setStatus('');
    });
    document.getElementById('parts-stock-close')?.addEventListener('click', () => {
      document.getElementById('parts-stock-dialog')?.close();
    });
    document.getElementById('parts-stock-dialog')?.addEventListener('close', () => {
      const dialog = document.getElementById('parts-stock-dialog');
      if (dialog) dialog.classList.remove('modal-fullscreen');
      syncPartsStockFullscreenButton(false);
    });
    document.getElementById('parts-stock-search')?.addEventListener('input', (e) => {
      refreshPartsList(e.target.value);
    });
    document.getElementById('parts-stock-search')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    document.getElementById('parts-stock-list')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.preventDefault();
    });
    document.getElementById('parts-stock-clear-search')?.addEventListener('click', async () => {
      const searchEl = document.getElementById('parts-stock-search');
      if (searchEl) searchEl.value = '';
      await refreshPartsList();
    });
    document.addEventListener('parts-stock-changed', () => {
      const dialog = document.getElementById('parts-stock-dialog');
      if (dialog?.open) refreshPartsList(searchValue());
    });
  }

  window.openPartsStock = openPartsStock;
  window.setPartsAddOpen = setPartsAddOpen;
  window.syncPartsStockFullscreenButton = syncPartsStockFullscreenButton;
  window.togglePartsStockFullscreen = togglePartsStockFullscreen;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wirePartsStock);
  } else {
    wirePartsStock();
  }
})();
