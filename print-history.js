/**
 * Print lifecycle UI: log-a-print dialog, status picker, details history, card badges.
 */
(function () {
  const STATUSES = ['unprinted', 'want', 'queued', 'printing', 'printed', 'failed'];
  const STATUS_LABELS = {
    unprinted: 'Not printed',
    want: 'Want',
    queued: 'Queued',
    printing: 'Printing',
    printed: 'Printed',
    failed: 'Failed'
  };
  const FILTER_LABELS = {
    printed: 'Printed',
    'not-printed': 'Not printed',
    unprinted: 'Unprinted',
    want: 'Want',
    queued: 'Queued',
    printing: 'Printing',
    failed: 'Failed',
    'ever-printed': 'Ever printed',
    'never-printed': 'Never printed'
  };
  const OUTCOME_LABELS = {
    printed: 'Printed',
    failed: 'Failed',
    cancelled: 'Cancelled'
  };

  let logDialogFilePaths = [];
  let statusMenuEl = null;

  function escapeHtml(text) {
    return String(text ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatFilamentLabel(filament) {
    const id = filament && typeof filament === 'object' ? String(filament.id) : String(filament || '');
    if (window.filamentLabelById && window.filamentLabelById[id]) return window.filamentLabelById[id];
    const vendor = String(filament?.vendor || '').trim();
    const name = String(filament?.name || '').trim();
    const material = String(filament?.material || '').trim();
    const base = [vendor, name].filter(Boolean).join(' ') || 'Filament';
    return material ? `${base} (${material})` : base;
  }

  function colorCss(hex) {
    if (!hex) return 'transparent';
    let h = String(hex).replace(/^#/, '').trim();
    if (h.includes(',')) h = h.split(',')[0].trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (h.length === 8) h = h.slice(0, 6);
    return /^[0-9a-fA-F]{6}$/.test(h) ? `#${h}` : 'transparent';
  }

  function effectiveStatus(model) {
    if (model?.print_status) return String(model.print_status).toLowerCase();
    return model?.printed ? 'printed' : 'unprinted';
  }

  function badgeText(model) {
    const status = effectiveStatus(model);
    const count = Number(model?.print_count) || 0;
    if (status === 'printed') return count > 0 ? `Printed ×${count}` : 'Printed';
    return STATUS_LABELS[status] || STATUS_LABELS.unprinted;
  }

  function badgeClassNames(model) {
    const status = effectiveStatus(model);
    const classes = ['print-status', `print-status-${status}`];
    if (status === 'printed' || Number(model?.print_count) > 0) classes.push('printed');
    return classes.join(' ');
  }

  function formatPrintDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });
  }

  function badgeTitle(model) {
    const status = effectiveStatus(model);
    const count = Number(model?.print_count) || 0;
    const parts = [`Status: ${STATUS_LABELS[status] || status}`];
    if (count > 0) parts.push(`${count} logged print${count === 1 ? '' : 's'}`);
    else if (status === 'printed') parts.push('No logged prints yet');
    if (model?.last_printed_at) parts.push(`Last printed: ${formatPrintDate(model.last_printed_at)}`);
    parts.push('Click to log a print. Shift-click to set status.');
    return parts.join('\n');
  }

  function modelMatchesPrintFilter(model, value) {
    if (!value || value === 'all') return true;
    const v = String(value).trim().toLowerCase();
    const status = effectiveStatus(model);
    const count = Number(model?.print_count) || 0;
    const printed = Number(model?.printed) ? 1 : (status === 'printed' || count > 0 ? 1 : 0);
    if (v === 'printed') return status === 'printed';
    if (v === 'not-printed') return !printed;
    if (v === 'ever-printed') return count > 0;
    if (v === 'never-printed') return count === 0;
    if (STATUSES.includes(v)) return status === v;
    return true;
  }

  function filterLabel(value) {
    return FILTER_LABELS[value] || String(value || '');
  }

  function toDatetimeLocalValue(date) {
    const d = date instanceof Date ? date : new Date(date || Date.now());
    if (Number.isNaN(d.getTime())) return toDatetimeLocalValue(new Date());
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function applyBadge(el, model) {
    if (!el) return;
    el.className = badgeClassNames(model);
    el.textContent = badgeText(model);
    el.title = badgeTitle(model);
    el.style.cursor = 'pointer';
  }

  function bindBadge(el, filePath) {
    if (!el || el.dataset.printHistoryBound === '1') return;
    el.dataset.printHistoryBound = '1';
    el.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) {
        openStatusMenu(el, filePath);
        return;
      }
      await openLogDialog({ filePaths: [filePath] });
    });
  }

  function selectedFilePaths() {
    const set = window.selectedModels;
    return set && typeof set[Symbol.iterator] === 'function' ? Array.from(set) : [];
  }

  function hideStatusMenu() {
    if (statusMenuEl) {
      statusMenuEl.remove();
      statusMenuEl = null;
    }
    document.removeEventListener('mousedown', onStatusMenuOutside);
  }

  function onStatusMenuOutside(e) {
    if (statusMenuEl && !statusMenuEl.contains(e.target)) hideStatusMenu();
  }

  function openStatusMenu(anchorEl, filePath) {
    hideStatusMenu();
    const menu = document.createElement('div');
    menu.className = 'print-status-menu';
    menu.setAttribute('role', 'menu');
    STATUSES.forEach((status) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `print-status-menu-item print-status-${status}`;
      btn.textContent = STATUS_LABELS[status];
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideStatusMenu();
        await setStatusForPaths([filePath], status);
      });
      menu.appendChild(btn);
    });
    document.body.appendChild(menu);
    const rect = anchorEl.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - menu.offsetWidth - 8)}px`;
    menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)}px`;
    statusMenuEl = menu;
    setTimeout(() => document.addEventListener('mousedown', onStatusMenuOutside), 0);
  }

  async function refreshAfterChange(filePaths) {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths];
    for (const filePath of paths) {
      if (typeof updateModelElement === 'function') {
        try { await updateModelElement(filePath); } catch (_) { /* keep going */ }
      }
    }
    const currentPath = typeof getCurrentModelFilePath === 'function' ? getCurrentModelFilePath() : null;
    if (currentPath && paths.includes(currentPath)) {
      try {
        const model = await window.electron.getModel(currentPath);
        if (model) await populateDetails(model);
      } catch (_) { /* ignore */ }
    }
  }

  async function setStatusForPaths(filePaths, status) {
    if (!filePaths.length) return;
    try {
      if (filePaths.length === 1) {
        await window.electron.setPrintStatus({ filePath: filePaths[0], printStatus: status });
      } else {
        await window.electron.setPrintStatusBatch({ filePaths, printStatus: status });
      }
      await refreshAfterChange(filePaths);
    } catch (error) {
      console.error('Error setting print status:', error);
    }
  }

  function selectedFilamentIds() {
    const chips = document.getElementById('log-print-filaments');
    if (!chips) return [];
    return Array.from(chips.querySelectorAll('.filament-chip')).map((el) => Number(el.dataset.filamentId)).filter((id) => id > 0);
  }

  function renderLogFilamentChip(filament) {
    const chip = document.createElement('span');
    chip.className = 'filament-chip';
    chip.dataset.filamentId = String(filament.id);
    chip.innerHTML = `<span class="filament-swatch" style="background:${colorCss(filament.color_hex)}"></span>${escapeHtml(formatFilamentLabel(filament))}<span class="filament-chip-remove" title="Remove">×</span>`;
    chip.querySelector('.filament-chip-remove')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      chip.remove();
    });
    return chip;
  }

  async function fillLogFilamentSelect(preselected) {
    const select = document.getElementById('log-print-filament-select');
    const container = document.getElementById('log-print-filaments');
    if (!select || !container) return;
    select.innerHTML = '<option value="">Add filament…</option>';
    container.innerHTML = '';
    let filaments = [];
    try {
      filaments = await window.electron.getAllFilaments() || [];
    } catch (_) {
      filaments = [];
    }
    filaments.forEach((f) => {
      const option = document.createElement('option');
      option.value = String(f.id);
      option.textContent = formatFilamentLabel(f);
      select.appendChild(option);
    });
    const selected = Array.isArray(preselected) ? preselected : [];
    selected.forEach((f) => {
      const filament = typeof f === 'object' ? f : filaments.find((x) => x.id === Number(f));
      if (filament && !container.querySelector(`[data-filament-id="${filament.id}"]`)) {
        container.appendChild(renderLogFilamentChip(filament));
      }
    });
    select.onchange = () => {
      const id = Number(select.value);
      if (!id) return;
      const filament = filaments.find((f) => f.id === id);
      if (filament && !container.querySelector(`[data-filament-id="${id}"]`)) {
        container.appendChild(renderLogFilamentChip(filament));
      }
      select.value = '';
    };
  }

  async function openLogDialog({ filePaths } = {}) {
    const dialog = document.getElementById('log-print-dialog');
    if (!dialog) return;
    logDialogFilePaths = Array.isArray(filePaths) ? filePaths.filter(Boolean) : [];
    if (!logDialogFilePaths.length) return;

    const title = document.getElementById('log-print-title');
    if (title) {
      title.textContent = logDialogFilePaths.length > 1
        ? `Log a print on ${logDialogFilePaths.length} models`
        : 'Log a print';
    }
    const whenInput = document.getElementById('log-print-when');
    const outcomeSelect = document.getElementById('log-print-outcome');
    const qtyInput = document.getElementById('log-print-quantity');
    const notesInput = document.getElementById('log-print-notes');
    if (whenInput) whenInput.value = toDatetimeLocalValue(new Date());
    if (outcomeSelect) outcomeSelect.value = 'printed';
    if (qtyInput) qtyInput.value = '1';
    if (notesInput) notesInput.value = '';

    let prefill = [];
    if (logDialogFilePaths.length === 1) {
      try {
        const model = await window.electron.getModel(logDialogFilePaths[0]);
        prefill = Array.isArray(model?.filaments) ? model.filaments : [];
      } catch (_) { /* ignore */ }
    }
    await fillLogFilamentSelect(prefill);
    if (typeof dialog.showModal === 'function') dialog.showModal();
  }

  async function submitLogDialog(event) {
    event?.preventDefault();
    const dialog = document.getElementById('log-print-dialog');
    const whenInput = document.getElementById('log-print-when');
    const outcomeSelect = document.getElementById('log-print-outcome');
    const qtyInput = document.getElementById('log-print-quantity');
    const notesInput = document.getElementById('log-print-notes');
    const payload = {
      printedAt: whenInput?.value ? new Date(whenInput.value).toISOString() : new Date().toISOString(),
      outcome: outcomeSelect?.value || 'printed',
      quantity: Number(qtyInput?.value) || 1,
      notes: notesInput?.value || '',
      filamentIds: selectedFilamentIds()
    };
    try {
      if (logDialogFilePaths.length === 1) {
        await window.electron.logPrintEvent({ ...payload, filePath: logDialogFilePaths[0] });
      } else {
        await window.electron.logPrintEventsBatch({ ...payload, filePaths: logDialogFilePaths });
      }
      dialog?.close();
      await refreshAfterChange(logDialogFilePaths);
    } catch (error) {
      console.error('Error logging print:', error);
      const status = document.getElementById('log-print-status');
      if (status) status.textContent = error.message || 'Failed to log print';
    }
  }

  async function populateDetails(model) {
    const select = document.getElementById('model-print-status');
    if (select) {
      select.value = effectiveStatus(model);
    }
    const hint = document.getElementById('print-history-hint');
    const count = Number(model?.print_count) || 0;
    if (hint) {
      if (effectiveStatus(model) === 'printed' && count === 0) {
        hint.textContent = 'No logged prints yet. Logging a print keeps a dated history.';
      } else if (model?.last_printed_at) {
        hint.textContent = `Last printed ${formatPrintDate(model.last_printed_at)}`;
      } else {
        hint.textContent = '';
      }
    }
    await renderHistoryList(model);
  }

  async function renderHistoryList(model) {
    const list = document.getElementById('print-history-list');
    if (!list) return;
    list.innerHTML = '';
    if (!model?.id || !window.electron?.getPrintEvents) return;
    let events = [];
    try {
      events = await window.electron.getPrintEvents(model.id) || [];
    } catch (error) {
      console.error('Error loading print history:', error);
      list.innerHTML = '<li class="print-history-empty">Could not load print history.</li>';
      return;
    }
    if (!events.length) {
      const empty = document.createElement('li');
      empty.className = 'print-history-empty';
      empty.textContent = effectiveStatus(model) === 'printed'
        ? 'No logged prints yet'
        : 'No print history yet';
      list.appendChild(empty);
      return;
    }
    events.forEach((event) => {
      const li = document.createElement('li');
      li.className = `print-history-item outcome-${event.outcome}`;
      const filaments = (event.filaments || []).map((f) => formatFilamentLabel(f)).join(', ');
      const qty = Number(event.quantity) > 1 ? ` ×${event.quantity}` : '';
      li.innerHTML = `
        <div class="print-history-item-main">
          <span class="print-history-outcome">${escapeHtml(OUTCOME_LABELS[event.outcome] || event.outcome)}${qty}</span>
          <span class="print-history-when">${escapeHtml(formatPrintDate(event.printed_at))}</span>
        </div>
        ${filaments ? `<div class="print-history-filaments">${escapeHtml(filaments)}</div>` : ''}
        ${event.notes ? `<div class="print-history-notes">${escapeHtml(event.notes)}</div>` : ''}
        <button type="button" class="print-history-delete icon-button" title="Delete this log entry" aria-label="Delete print log">×</button>
      `;
      li.querySelector('.print-history-delete')?.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const ok = window.confirm ? window.confirm('Delete this print log entry?') : true;
        if (!ok) return;
        try {
          await window.electron.deletePrintEvent(event.id);
          await refreshAfterChange(model.filePath);
        } catch (err) {
          console.error('Error deleting print event:', err);
        }
      });
      list.appendChild(li);
    });
  }

  function fillStatusSelect(select, { includeEmpty = false, emptyLabel = 'No change', value = '' } = {}) {
    if (!select) return;
    select.innerHTML = '';
    if (includeEmpty) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = emptyLabel;
      select.appendChild(opt);
    }
    STATUSES.forEach((status) => {
      const opt = document.createElement('option');
      opt.value = status;
      opt.textContent = STATUS_LABELS[status];
      select.appendChild(opt);
    });
    if (value) select.value = value;
  }

  function bundleSummary(children) {
    const list = Array.isArray(children) ? children : [];
    let everPrinted = 0;
    let totalCount = 0;
    for (const child of list) {
      const count = Number(child?.print_count) || 0;
      totalCount += count;
      if (count > 0 || child?.printed || effectiveStatus(child) === 'printed') everPrinted += 1;
    }
    if (!list.length || everPrinted === 0) {
      return { label: 'Not printed', className: 'print-status print-status-unprinted', printedCount: 0, totalCount: 0 };
    }
    if (everPrinted === list.length) {
      return {
        label: totalCount > 0 ? `Printed ×${totalCount}` : 'Printed',
        className: 'print-status print-status-printed printed',
        printedCount: everPrinted,
        totalCount
      };
    }
    return {
      label: totalCount > 0 ? `Mixed ×${totalCount}` : 'Mixed',
      className: 'print-status print-status-mixed mixed',
      printedCount: everPrinted,
      totalCount
    };
  }

  function wireUi() {
    document.getElementById('log-print-form')?.addEventListener('submit', submitLogDialog);
    document.addEventListener('click', async (e) => {
      const cancel = e.target.closest('#log-print-cancel');
      if (cancel) {
        document.getElementById('log-print-dialog')?.close();
        return;
      }
      if (e.target.closest('#log-print-button, #log-print-history-button, .log-print-icon-button')) {
        const filePath = typeof getCurrentModelFilePath === 'function' ? getCurrentModelFilePath() : null;
        if (filePath) await openLogDialog({ filePaths: [filePath] });
        return;
      }
      if (e.target.closest('#multi-log-print-button')) {
        const paths = selectedFilePaths();
        if (paths.length) await openLogDialog({ filePaths: paths });
      }
    });
    document.addEventListener('change', async (e) => {
      if (e.target.id === 'model-print-status') {
        const filePath = typeof getCurrentModelFilePath === 'function' ? getCurrentModelFilePath() : null;
        if (!filePath || !e.target.value) return;
        await setStatusForPaths([filePath], e.target.value);
        return;
      }
      if (e.target.id === 'multi-print-status') {
        const paths = selectedFilePaths();
        if (!paths.length || !e.target.value) return;
        await setStatusForPaths(paths, e.target.value);
        e.target.value = '';
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUi);
  } else {
    wireUi();
  }

  window.PrintHistory = {
    STATUSES,
    STATUS_LABELS,
    applyBadge,
    bindBadge,
    badgeText,
    badgeClassNames,
    badgeTitle,
    openLogDialog,
    openStatusMenu,
    populateDetails,
    fillStatusSelect,
    modelMatchesPrintFilter,
    filterLabel,
    bundleSummary,
    effectiveStatus,
    refreshAfterChange
  };
})();
