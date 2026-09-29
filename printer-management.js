'use strict';

(function () {
  let activeTab = 'printers'; // 'printers' or 'maintenance'
  let editingPrinterId = null;
  let selectedPrinterId = null;
  let cachedPrinters = [];

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setStatus(elementId, text, isError = false) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = text;
    el.className = `printer-status-msg ${isError ? 'error' : 'success'}`;
    if (text) {
      setTimeout(() => {
        if (el.textContent === text) el.textContent = '';
      }, 5000);
    }
  }

  function openExternalUrl(url) {
    if (!url) return;
    let target = url.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = 'http://' + target;
    }
    if (window.electron?.openExternal) {
      window.electron.openExternal(target).catch((err) => {
        console.error('Failed to open external URL:', err);
        window.open(target, '_blank');
      });
    } else {
      window.open(target, '_blank');
    }
  }

  function switchTab(tabName) {
    activeTab = tabName;
    const printersTabBtn = document.getElementById('printer-tab-printers');
    const maintenanceTabBtn = document.getElementById('printer-tab-maintenance');
    const printersView = document.getElementById('printer-view-printers');
    const maintenanceView = document.getElementById('printer-view-maintenance');

    if (printersTabBtn && maintenanceTabBtn && printersView && maintenanceView) {
      if (tabName === 'printers') {
        printersTabBtn.classList.add('active');
        maintenanceTabBtn.classList.remove('active');
        printersView.hidden = false;
        maintenanceView.hidden = true;
      } else {
        printersTabBtn.classList.remove('active');
        maintenanceTabBtn.classList.add('active');
        printersView.hidden = true;
        maintenanceView.hidden = false;
        loadMaintenanceView();
      }
    }
  }

  function setPrinterAddOpen(open) {
    const section = document.getElementById('printer-form-section');
    const body = document.getElementById('printer-form-body');
    const btn = document.getElementById('printer-toggle-add-btn');
    if (body) body.hidden = !open;
    if (section) section.classList.toggle('collapsed', !open);
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? '− Cancel' : '+ Add Printer';
      btn.classList.toggle('active', open);
    }
  }

  function resetPrinterForm() {
    editingPrinterId = null;
    const nameInput = document.getElementById('printer-form-nickname');
    const mfgInput = document.getElementById('printer-form-manufacturer');
    const modelInput = document.getElementById('printer-form-model');
    const typeInput = document.getElementById('printer-form-type');
    const fwInput = document.getElementById('printer-form-firmware');
    const klipperInput = document.getElementById('printer-form-klipper');
    const webInput = document.getElementById('printer-form-web-url');
    const notesInput = document.getElementById('printer-form-notes');
    const submitBtn = document.getElementById('printer-form-submit');
    const cancelBtn = document.getElementById('printer-form-cancel');
    const formTitle = document.getElementById('printer-form-title');

    if (nameInput) nameInput.value = '';
    if (mfgInput) mfgInput.value = '';
    if (modelInput) modelInput.value = '';
    if (typeInput) typeInput.value = 'FDM';
    if (fwInput) fwInput.value = 'Klipper';
    if (klipperInput) klipperInput.checked = true;
    if (webInput) webInput.value = '';
    if (notesInput) notesInput.value = '';
    if (submitBtn) submitBtn.textContent = 'Add Printer';
    if (cancelBtn) cancelBtn.textContent = 'Cancel';
    if (formTitle) formTitle.textContent = 'Onboard a Printer';
    setStatus('printer-form-status', '');
    setPrinterAddOpen(false);
  }

  function fillPrinterFormForEdit(printer) {
    if (!printer) return;
    setPrinterAddOpen(true);
    editingPrinterId = printer.id;
    const nameInput = document.getElementById('printer-form-nickname');
    const mfgInput = document.getElementById('printer-form-manufacturer');
    const modelInput = document.getElementById('printer-form-model');
    const typeInput = document.getElementById('printer-form-type');
    const fwInput = document.getElementById('printer-form-firmware');
    const klipperInput = document.getElementById('printer-form-klipper');
    const webInput = document.getElementById('printer-form-web-url');
    const notesInput = document.getElementById('printer-form-notes');
    const submitBtn = document.getElementById('printer-form-submit');
    const cancelBtn = document.getElementById('printer-form-cancel');
    const formTitle = document.getElementById('printer-form-title');

    if (nameInput) nameInput.value = printer.nickname || '';
    if (mfgInput) mfgInput.value = printer.manufacturer || '';
    if (modelInput) modelInput.value = printer.model || '';
    if (typeInput) typeInput.value = printer.printer_type || 'FDM';
    if (fwInput) fwInput.value = printer.firmware_type || 'Other';
    if (klipperInput) klipperInput.checked = Boolean(printer.is_klipper);
    if (webInput) webInput.value = printer.web_url || '';
    if (notesInput) notesInput.value = printer.notes || '';
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    if (cancelBtn) cancelBtn.textContent = 'Cancel Edit';
    if (formTitle) formTitle.textContent = `Edit Printer: ${printer.nickname}`;

    switchTab('printers');
    document.querySelector('.printer-management-scroll-content')?.scrollTo({ top: 0, behavior: 'smooth' });
    nameInput?.focus();
  }

  async function refreshPrintersList(searchTerm = null, typeFilter = null) {
    const listEl = document.getElementById('printer-cards-list');
    const countBadge = document.getElementById('printer-count-badge');
    const headerCountBadge = document.getElementById('printer-tab-printers-count');
    const dueBadge = document.getElementById('printer-tab-due-badge');
    if (!listEl || !window.electron?.getAllPrinters) return;

    try {
      cachedPrinters = await window.electron.getAllPrinters() || [];
    } catch (err) {
      console.error('Failed to load printers:', err);
      cachedPrinters = [];
    }

    const searchInput = document.getElementById('printer-search-input');
    const typeSelect = document.getElementById('printer-type-filter');
    const q = (searchTerm != null ? searchTerm : (searchInput?.value || '')).trim().toLowerCase();
    const currentType = (typeFilter != null ? typeFilter : (typeSelect?.value || '')).trim().toLowerCase();

    const filtered = cachedPrinters.filter((p) => {
      if (currentType && currentType !== 'all') {
        const pType = (p.printer_type || '').toLowerCase();
        if (pType !== currentType) return false;
      }
      if (!q) return true;
      const hay = `${p.nickname} ${p.manufacturer || ''} ${p.model || ''} ${p.printer_type || ''} ${p.firmware_type || ''}`.toLowerCase();
      return hay.includes(q);
    });

    const totalDue = cachedPrinters.reduce((acc, p) => acc + (Number(p.due_reminders_count) || 0), 0);
    if (dueBadge) {
      dueBadge.textContent = totalDue > 0 ? `${totalDue} due` : '';
      dueBadge.className = `printer-tab-badge due ${totalDue > 0 ? '' : 'hidden'}`;
      dueBadge.hidden = totalDue === 0;
    }

    if (headerCountBadge) headerCountBadge.textContent = String(cachedPrinters.length);
    if (countBadge) countBadge.textContent = `${filtered.length} printer${filtered.length === 1 ? '' : 's'}`;

    listEl.innerHTML = '';
    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.className = 'printer-empty-state';
      empty.innerHTML = `
        <div class="printer-empty-icon">🖨️</div>
        <div>${q || currentType ? 'No printers match your search or filter.' : 'No printers onboarded yet. Add your first printer above!'}</div>
      `;
      listEl.appendChild(empty);
      return;
    }

    filtered.forEach((printer) => {
      const card = document.createElement('div');
      card.className = 'printer-card';
      card.dataset.printerId = String(printer.id);

      const mfgModel = [printer.manufacturer, printer.model].filter(Boolean).join(' ');
      const isKlipper = Boolean(printer.is_klipper);
      const typeBadge = printer.printer_type
        ? `<span class="printer-badge printer-type">${escapeHtml(printer.printer_type)}</span>`
        : '';
      const fwBadge = printer.firmware_type
        ? `<span class="printer-badge ${isKlipper ? 'klipper' : ''}">${escapeHtml(printer.firmware_type)}</span>`
        : '';
      const klipperBadge = isKlipper && printer.firmware_type?.toLowerCase() !== 'klipper'
        ? '<span class="printer-badge klipper">Klipper</span>'
        : '';
      const printsBadge = `<span class="printer-badge prints-count">🖨️ ${printer.total_prints || 0} print${printer.total_prints === 1 ? '' : 's'}</span>`;
      const dueCount = Number(printer.due_reminders_count) || 0;
      const reminderBadge = dueCount > 0
        ? `<span class="printer-badge reminder-due" title="${dueCount} maintenance reminder(s) due soon or overdue">⚠️ ${dueCount} reminder${dueCount === 1 ? '' : 's'} due</span>`
        : '';

      const webBtn = printer.web_url
        ? `<button type="button" class="printer-action-btn web-ui" data-action="open-web" title="Open web interface in browser (${escapeHtml(printer.web_url)})">🌐 Web UI ↗</button>`
        : '';

      card.innerHTML = `
        <div class="printer-card-main">
          <div class="printer-card-info">
            <div class="printer-card-name-row">
              <span class="printer-card-name">${escapeHtml(printer.nickname)}</span>
              ${mfgModel ? `<span class="printer-card-model">(${escapeHtml(mfgModel)})</span>` : ''}
            </div>
            <div class="printer-card-meta">
              ${typeBadge}
              ${fwBadge}
              ${klipperBadge}
              ${printsBadge}
              ${reminderBadge}
            </div>
            ${printer.notes ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px;">${escapeHtml(printer.notes)}</div>` : ''}
          </div>
          <div class="printer-card-actions">
            ${webBtn}
            <button type="button" class="printer-action-btn maintenance" data-action="maintenance" title="View maintenance log and schedule reminders">📋 Maintenance</button>
            <button type="button" class="printer-action-btn" data-action="edit" title="Edit printer details">✏️ Edit</button>
            <button type="button" class="printer-action-btn danger" data-action="delete" title="Delete printer" aria-label="Delete printer">🗑️</button>
          </div>
        </div>
      `;

      card.querySelector('[data-action="open-web"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        openExternalUrl(printer.web_url);
      });

      card.querySelector('[data-action="maintenance"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        selectedPrinterId = printer.id;
        switchTab('maintenance');
      });

      card.querySelector('[data-action="edit"]')?.addEventListener('click', (e) => {
        e.preventDefault();
        fillPrinterFormForEdit(printer);
      });

      card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
        e.preventDefault();
        const ok = window.confirm(`Delete printer "${printer.nickname}"? Past print logs will be preserved.`);
        if (!ok) return;
        try {
          await window.electron.deletePrinter(printer.id);
          if (editingPrinterId === printer.id) resetPrinterForm();
          await refreshPrintersList();
          document.dispatchEvent(new CustomEvent('printers-changed'));
        } catch (err) {
          console.error('Error deleting printer:', err);
          alert('Failed to delete printer: ' + (err.message || err));
        }
      });

      listEl.appendChild(card);
    });
  }

  async function handlePrinterFormSubmit(e) {
    e.preventDefault();
    const nickname = document.getElementById('printer-form-nickname')?.value?.trim();
    if (!nickname) {
      setStatus('printer-form-status', 'Printer nickname is required', true);
      return;
    }
    const manufacturer = document.getElementById('printer-form-manufacturer')?.value?.trim() || null;
    const model = document.getElementById('printer-form-model')?.value?.trim() || null;
    const printerType = document.getElementById('printer-form-type')?.value?.trim() || null;
    const firmwareType = document.getElementById('printer-form-firmware')?.value?.trim() || null;
    const isKlipper = document.getElementById('printer-form-klipper')?.checked || false;
    let webUrl = document.getElementById('printer-form-web-url')?.value?.trim() || null;
    if (webUrl && !/^https?:\/\//i.test(webUrl)) {
      webUrl = 'http://' + webUrl;
    }
    const notes = document.getElementById('printer-form-notes')?.value?.trim() || null;

    try {
      await window.electron.savePrinter({
        id: editingPrinterId,
        nickname,
        manufacturer,
        model,
        printerType,
        firmwareType,
        isKlipper,
        webUrl,
        notes
      });

      setStatus('printer-form-status', editingPrinterId ? 'Printer updated successfully' : 'Printer added successfully');
      resetPrinterForm();
      await refreshPrintersList();
      document.dispatchEvent(new CustomEvent('printers-changed'));
    } catch (err) {
      console.error('Error saving printer:', err);
      setStatus('printer-form-status', err.message || 'Failed to save printer', true);
    }
  }

  // --- Maintenance & Reminders View ---
  async function loadMaintenanceView() {
    const selector = document.getElementById('maintenance-printer-select');
    if (!selector || !cachedPrinters.length) return;

    selector.innerHTML = '';
    cachedPrinters.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      const typePrefix = p.printer_type ? `[${p.printer_type}] ` : '';
      opt.textContent = `${typePrefix}${p.nickname}${p.model ? ` (${p.model})` : ''}`;
      selector.appendChild(opt);
    });

    if (selectedPrinterId && cachedPrinters.some((p) => p.id === selectedPrinterId)) {
      selector.value = String(selectedPrinterId);
    } else {
      selectedPrinterId = cachedPrinters[0]?.id || null;
      if (selectedPrinterId) selector.value = String(selectedPrinterId);
    }

    // Set default reminder due date to 30 days from now
    const reminderDueDateInput = document.getElementById('reminder-form-due-date');
    if (reminderDueDateInput && !reminderDueDateInput.value) {
      const defaultDate = new Date();
      defaultDate.setDate(defaultDate.getDate() + 30);
      reminderDueDateInput.value = defaultDate.toISOString().slice(0, 10);
    }

    // Set default log date to today
    const logDateInput = document.getElementById('log-form-performed-at');
    if (logDateInput && !logDateInput.value) {
      logDateInput.value = new Date().toISOString().slice(0, 10);
    }

    await refreshMaintenanceData();
  }

  async function refreshMaintenanceData() {
    if (!selectedPrinterId) return;
    const remindersList = document.getElementById('maintenance-reminders-list');
    const logsList = document.getElementById('maintenance-logs-list');
    if (!remindersList || !logsList) return;

    let reminders = [];
    let logs = [];
    try {
      [reminders, logs] = await Promise.all([
        window.electron.getPrinterReminders(selectedPrinterId),
        window.electron.getPrinterMaintenanceLogs(selectedPrinterId)
      ]);
    } catch (err) {
      console.error('Error loading maintenance data:', err);
    }

    // Render Reminders
    remindersList.innerHTML = '';
    if (!reminders || !reminders.length) {
      remindersList.innerHTML = '<div style="font-size:12.5px;color:#94a3b8;padding:8px 0;">No scheduled reminders for this printer. Add one below!</div>';
    } else {
      const now = new Date();
      reminders.forEach((r) => {
        const item = document.createElement('div');
        const dueDate = new Date(r.due_date);
        const isCompleted = r.status === 'completed';
        const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));

        let pillClass = 'upcoming';
        let pillText = `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
        if (isCompleted) {
          pillClass = 'completed';
          pillText = 'Completed';
        } else if (diffDays < 0) {
          pillClass = 'overdue';
          pillText = `Overdue by ${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'}`;
        } else if (diffDays <= 7) {
          pillClass = 'due-soon';
          pillText = diffDays === 0 ? 'Due today!' : `Due in ${diffDays} day${diffDays === 1 ? '' : 's'}`;
        }

        const recurrenceText = r.interval_days > 0 ? `Repeats every ${r.interval_days} days` : 'One-time';
        item.className = `reminder-item ${isCompleted ? 'is-completed' : (diffDays < 0 ? 'is-overdue' : (diffDays <= 7 ? 'is-due-soon' : ''))}`;

        item.innerHTML = `
          <div class="reminder-item-main">
            <span class="reminder-title">${escapeHtml(r.title)}</span>
            <div class="reminder-meta">
              <span class="due-pill ${pillClass}">${pillText}</span>
              <span>📅 ${dueDate.toLocaleDateString()}</span>
              <span>🔄 ${recurrenceText}</span>
            </div>
            ${r.notes ? `<div style="font-size:12px;color:#94a3b8;">${escapeHtml(r.notes)}</div>` : ''}
          </div>
          <div class="reminder-actions">
            ${!isCompleted ? `<button type="button" class="reminder-done-btn" data-action="done" title="Mark completed and record in maintenance log">✓ Done</button>` : ''}
            <button type="button" class="printer-action-btn danger" data-action="delete" title="Delete reminder">🗑️</button>
          </div>
        `;

        item.querySelector('[data-action="done"]')?.addEventListener('click', async (e) => {
          e.preventDefault();
          const notes = prompt(`Mark "${r.title}" as completed?\nOptional notes for maintenance log:`, r.notes || '');
          if (notes === null) return;
          try {
            await window.electron.completePrinterReminder({ id: r.id, notes });
            await refreshMaintenanceData();
            await refreshPrintersList();
          } catch (err) {
            alert('Failed to complete reminder: ' + (err.message || err));
          }
        });

        item.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
          e.preventDefault();
          if (!confirm(`Delete reminder "${r.title}"?`)) return;
          try {
            await window.electron.deletePrinterReminder(r.id);
            await refreshMaintenanceData();
            await refreshPrintersList();
          } catch (err) {
            alert('Failed to delete reminder: ' + (err.message || err));
          }
        });

        remindersList.appendChild(item);
      });
    }

    // Render Logs
    logsList.innerHTML = '';
    if (!logs || !logs.length) {
      logsList.innerHTML = '<div style="font-size:12.5px;color:#94a3b8;padding:8px 0;">No maintenance performed yet.</div>';
    } else {
      logs.forEach((log) => {
        const item = document.createElement('div');
        item.className = 'log-item';
        const perfDate = new Date(log.performed_at);

        item.innerHTML = `
          <div class="log-item-main">
            <span class="log-title">${escapeHtml(log.title || log.maintenance_type)}</span>
            <div class="log-meta">
              <span class="printer-badge">${escapeHtml(log.maintenance_type)}</span>
              <span>📅 ${perfDate.toLocaleDateString()}</span>
            </div>
            ${log.description ? `<div style="font-size:12px;color:#94a3b8;margin-top:2px;">${escapeHtml(log.description)}</div>` : ''}
          </div>
          <div class="log-actions">
            <button type="button" class="printer-action-btn danger" data-action="delete-log" title="Delete log entry">🗑️</button>
          </div>
        `;

        item.querySelector('[data-action="delete-log"]')?.addEventListener('click', async (e) => {
          e.preventDefault();
          if (!confirm('Delete this maintenance log entry?')) return;
          try {
            await window.electron.deletePrinterMaintenanceLog(log.id);
            await refreshMaintenanceData();
          } catch (err) {
            alert('Failed to delete log entry: ' + (err.message || err));
          }
        });

        logsList.appendChild(item);
      });
    }
  }

  async function handleScheduleReminderSubmit(e) {
    e.preventDefault();
    if (!selectedPrinterId) return;
    const title = document.getElementById('reminder-form-title')?.value?.trim();
    if (!title) {
      setStatus('reminder-form-status', 'Reminder title is required', true);
      return;
    }
    const maintenanceType = document.getElementById('reminder-form-type')?.value?.trim() || 'General';
    const dueDateVal = document.getElementById('reminder-form-due-date')?.value;
    const dueDate = dueDateVal ? new Date(dueDateVal + 'T12:00:00').toISOString() : new Date().toISOString();
    const intervalDays = Number(document.getElementById('reminder-form-interval')?.value) || 0;
    const notes = document.getElementById('reminder-form-notes')?.value?.trim() || null;

    try {
      await window.electron.savePrinterReminder({
        printerId: selectedPrinterId,
        title,
        maintenanceType,
        dueDate,
        intervalDays,
        notes
      });
      document.getElementById('reminder-form-title').value = '';
      document.getElementById('reminder-form-notes').value = '';
      setStatus('reminder-form-status', 'Reminder scheduled!');
      await refreshMaintenanceData();
      await refreshPrintersList();
    } catch (err) {
      console.error('Error saving reminder:', err);
      setStatus('reminder-form-status', err.message || 'Failed to save reminder', true);
    }
  }

  async function handleLogMaintenanceSubmit(e) {
    e.preventDefault();
    if (!selectedPrinterId) return;
    const maintenanceType = document.getElementById('log-form-type')?.value?.trim() || 'General';
    const title = document.getElementById('log-form-title')?.value?.trim() || maintenanceType;
    const dateVal = document.getElementById('log-form-performed-at')?.value;
    const performedAt = dateVal ? new Date(dateVal + 'T12:00:00').toISOString() : new Date().toISOString();
    const description = document.getElementById('log-form-description')?.value?.trim() || null;

    try {
      await window.electron.savePrinterMaintenanceLog({
        printerId: selectedPrinterId,
        maintenanceType,
        title,
        performedAt,
        description
      });
      document.getElementById('log-form-title').value = '';
      document.getElementById('log-form-description').value = '';
      setStatus('log-form-status', 'Maintenance logged!');
      await refreshMaintenanceData();
    } catch (err) {
      console.error('Error logging maintenance:', err);
      setStatus('log-form-status', err.message || 'Failed to log maintenance', true);
    }
  }

  function syncPrinterManagementFullscreenButton(isFullscreen) {
    const btn = document.getElementById('printer-management-fullscreen-toggle');
    if (!btn) return;
    const full = !!isFullscreen;
    btn.title = full ? 'Exit Full Screen' : 'Full Screen';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', full ? 'true' : 'false');
  }

  function togglePrinterManagementFullscreen() {
    const dialog = document.getElementById('printer-management-dialog');
    if (!dialog) return;
    dialog.classList.toggle('modal-fullscreen');
    syncPrinterManagementFullscreenButton(dialog.classList.contains('modal-fullscreen'));
  }

  async function openPrinterManagement({ printerId, tab } = {}) {
    const dialog = document.getElementById('printer-management-dialog');
    if (!dialog) return;

    dialog.classList.remove('modal-fullscreen');
    syncPrinterManagementFullscreenButton(false);
    resetPrinterForm();
    if (printerId) selectedPrinterId = Number(printerId);
    await refreshPrintersList();

    if (tab === 'maintenance' || (printerId && !tab)) {
      switchTab('maintenance');
    } else {
      switchTab('printers');
    }

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    }
  }

  function init() {
    window._electronRealEventHandlers = window._electronRealEventHandlers || {};
    window._electronRealEventHandlers['open-printer-management'] = function () {
      openPrinterManagement();
    };

    if (window._electronPendingEvents?.['open-printer-management']) {
      window._electronPendingEvents['open-printer-management'].forEach((args) => {
        window._electronRealEventHandlers['open-printer-management'].apply(null, args);
      });
      delete window._electronPendingEvents['open-printer-management'];
    }

    window.openPrinterManagement = openPrinterManagement;
    window.syncPrinterManagementFullscreenButton = syncPrinterManagementFullscreenButton;
    window.togglePrinterManagementFullscreen = togglePrinterManagementFullscreen;

    // Tabs
    document.getElementById('printer-tab-printers')?.addEventListener('click', () => switchTab('printers'));
    document.getElementById('printer-tab-maintenance')?.addEventListener('click', () => switchTab('maintenance'));

    // Forms
    document.getElementById('printer-toggle-add-btn')?.addEventListener('click', () => {
      const body = document.getElementById('printer-form-body');
      const isCurrentlyOpen = body && !body.hidden;
      if (isCurrentlyOpen) {
        resetPrinterForm();
      } else {
        setPrinterAddOpen(true);
        document.getElementById('printer-form-nickname')?.focus();
      }
    });
    document.getElementById('printer-form')?.addEventListener('submit', handlePrinterFormSubmit);
    document.getElementById('printer-form-cancel')?.addEventListener('click', resetPrinterForm);
    document.getElementById('printer-management-close')?.addEventListener('click', () => {
      document.getElementById('printer-management-dialog')?.close();
    });
    document.getElementById('printer-management-dialog')?.addEventListener('close', () => {
      const dialog = document.getElementById('printer-management-dialog');
      if (dialog) dialog.classList.remove('modal-fullscreen');
      syncPrinterManagementFullscreenButton(false);
      resetPrinterForm();
    });

    // Auto Klipper detection when selecting Firmware dropdown
    document.getElementById('printer-form-firmware')?.addEventListener('change', (e) => {
      const val = e.target.value;
      const klipperBox = document.getElementById('printer-form-klipper');
      const webInput = document.getElementById('printer-form-web-url');
      if (val === 'Klipper') {
        if (klipperBox) klipperBox.checked = true;
        if (webInput && !webInput.value) webInput.placeholder = 'http://mainsail.local or http://fluidd.local';
      } else {
        if (klipperBox) klipperBox.checked = false;
        if (webInput && !webInput.value) webInput.placeholder = 'http://192.168.1.100';
      }
    });

    // Test Open button next to Web Address input in form
    document.getElementById('printer-form-test-url')?.addEventListener('click', () => {
      const url = document.getElementById('printer-form-web-url')?.value?.trim();
      if (!url) {
        setStatus('printer-form-status', 'Enter a web address first', true);
        return;
      }
      openExternalUrl(url);
    });

    // Search input & type filter
    document.getElementById('printer-search-input')?.addEventListener('input', (e) => {
      refreshPrintersList(e.target.value);
    });
    document.getElementById('printer-type-filter')?.addEventListener('change', (e) => {
      refreshPrintersList(null, e.target.value);
    });
    document.getElementById('printer-clear-search')?.addEventListener('click', () => {
      const input = document.getElementById('printer-search-input');
      if (input) input.value = '';
      refreshPrintersList('');
    });

    // Maintenance view events
    document.getElementById('maintenance-printer-select')?.addEventListener('change', (e) => {
      selectedPrinterId = Number(e.target.value);
      refreshMaintenanceData();
    });
    document.getElementById('reminder-form')?.addEventListener('submit', handleScheduleReminderSubmit);
    document.getElementById('log-maintenance-form')?.addEventListener('submit', handleLogMaintenanceSubmit);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
