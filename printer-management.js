'use strict';

(function () {
  let activeTab = 'printers'; // 'printers' or 'maintenance'
  let editingPrinterId = null;
  let selectedPrinterId = null;
  let cachedPrinters = [];
  let liveStatus = {};
  let statusPollTimer = null;
  let statusPollInFlight = false;

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
    const webInput = document.getElementById('printer-form-web-url');
    const hostInput = document.getElementById('printer-form-host');
    const serialInput = document.getElementById('printer-form-serial');
    const accessInput = document.getElementById('printer-form-access-code');
    const prusaUserInput = document.getElementById('printer-form-prusa-user');
    const prusaPasswordInput = document.getElementById('printer-form-prusa-password');
    const notesInput = document.getElementById('printer-form-notes');
    const submitBtn = document.getElementById('printer-form-submit');
    const cancelBtn = document.getElementById('printer-form-cancel');
    const formTitle = document.getElementById('printer-form-title');

    if (nameInput) nameInput.value = '';
    if (mfgInput) mfgInput.value = '';
    if (modelInput) modelInput.value = '';
    if (typeInput) typeInput.value = 'FDM';
    if (fwInput) fwInput.value = 'Klipper';
    if (webInput) webInput.value = '';
    if (hostInput) hostInput.value = '';
    if (serialInput) serialInput.value = '';
    if (accessInput) accessInput.value = '';
    if (prusaUserInput) prusaUserInput.value = '';
    if (prusaPasswordInput) prusaPasswordInput.value = '';
    if (notesInput) notesInput.value = '';
    if (submitBtn) submitBtn.textContent = 'Add Printer';
    if (cancelBtn) cancelBtn.textContent = 'Cancel';
    if (formTitle) formTitle.textContent = 'Onboard a Printer';
    setStatus('printer-form-status', '');
    syncConnectionFields();
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
    const webInput = document.getElementById('printer-form-web-url');
    const hostInput = document.getElementById('printer-form-host');
    const serialInput = document.getElementById('printer-form-serial');
    const accessInput = document.getElementById('printer-form-access-code');
    const prusaUserInput = document.getElementById('printer-form-prusa-user');
    const prusaPasswordInput = document.getElementById('printer-form-prusa-password');
    const notesInput = document.getElementById('printer-form-notes');
    const submitBtn = document.getElementById('printer-form-submit');
    const cancelBtn = document.getElementById('printer-form-cancel');
    const formTitle = document.getElementById('printer-form-title');

    if (nameInput) nameInput.value = printer.nickname || '';
    if (mfgInput) mfgInput.value = printer.manufacturer || '';
    if (modelInput) modelInput.value = printer.model || '';
    if (typeInput) typeInput.value = printer.printer_type || 'FDM';
    if (fwInput) fwInput.value = printer.firmware_type || 'Other';
    if (webInput) webInput.value = printer.web_url || '';
    if (hostInput) hostInput.value = printer.host || '';
    if (serialInput) serialInput.value = printer.bambu_serial || '';
    if (accessInput) accessInput.value = printer.bambu_access_code || '';
    if (prusaUserInput) prusaUserInput.value = printer.prusa_username || '';
    if (prusaPasswordInput) prusaPasswordInput.value = printer.prusa_password || '';
    if (notesInput) notesInput.value = printer.notes || '';
    if (submitBtn) submitBtn.textContent = 'Save Changes';
    if (cancelBtn) cancelBtn.textContent = 'Cancel Edit';
    if (formTitle) formTitle.textContent = `Edit Printer: ${printer.nickname}`;
    syncConnectionFields();

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
              ${renderStatusBadge(printer)}
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
    const notes = document.getElementById('printer-form-notes')?.value?.trim() || null;
    const payload = {
      id: editingPrinterId,
      nickname,
      manufacturer,
      model,
      printerType,
      firmwareType,
      notes
    };
    const firmwareKey = String(firmwareType || '').toLowerCase();
    const normalizedWebUrl = () => {
      let webUrl = document.getElementById('printer-form-web-url')?.value?.trim() || null;
      if (webUrl && !/^https?:\/\//i.test(webUrl)) webUrl = `http://${webUrl}`;
      return webUrl;
    };
    if (firmwareKey === 'klipper') {
      payload.webUrl = normalizedWebUrl();
      payload.host = '';
      payload.bambuSerial = '';
      payload.bambuAccessCode = '';
      payload.prusaUsername = '';
      payload.prusaPassword = '';
    } else if (firmwareKey === 'bambu os') {
      payload.webUrl = '';
      payload.host = document.getElementById('printer-form-host')?.value?.trim() || '';
      payload.bambuSerial = document.getElementById('printer-form-serial')?.value?.trim() || '';
      payload.bambuAccessCode = document.getElementById('printer-form-access-code')?.value?.trim() || '';
      payload.prusaUsername = '';
      payload.prusaPassword = '';
    } else if (firmwareKey === 'prusa buddy') {
      payload.webUrl = normalizedWebUrl();
      payload.host = '';
      payload.bambuSerial = '';
      payload.bambuAccessCode = '';
      payload.prusaUsername = document.getElementById('printer-form-prusa-user')?.value?.trim() || 'maker';
      payload.prusaPassword = document.getElementById('printer-form-prusa-password')?.value || '';
    } else {
      payload.webUrl = '';
      payload.host = '';
      payload.bambuSerial = '';
      payload.bambuAccessCode = '';
      payload.prusaUsername = '';
      payload.prusaPassword = '';
    }

    try {
      await window.electron.savePrinter(payload);

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

  function currentFirmware() {
    return document.getElementById('printer-form-firmware')?.value || '';
  }

  function syncConnectionFields() {
    const firmware = currentFirmware();
    const isKlipper = firmware === 'Klipper';
    const isBambu = firmware === 'Bambu OS';
    const isPrusa = firmware === 'Prusa Buddy';
    const webField = document.getElementById('printer-web-field');
    const hostField = document.getElementById('printer-bambu-host-field');
    const serialField = document.getElementById('printer-bambu-serial-field');
    const codeField = document.getElementById('printer-bambu-code-field');
    const prusaUserField = document.getElementById('printer-prusa-user-field');
    const prusaPasswordField = document.getElementById('printer-prusa-password-field');
    const testBtn = document.getElementById('printer-form-test-connection');
    if (webField) webField.hidden = !(isKlipper || isPrusa);
    if (hostField) hostField.hidden = !isBambu;
    if (serialField) serialField.hidden = !isBambu;
    if (codeField) codeField.hidden = !isBambu;
    if (prusaUserField) prusaUserField.hidden = !isPrusa;
    if (prusaPasswordField) prusaPasswordField.hidden = !isPrusa;
    if (testBtn) testBtn.hidden = !(isKlipper || isBambu || isPrusa);
    const mfg = document.getElementById('printer-form-manufacturer');
    if (isBambu && mfg && !mfg.value.trim()) mfg.value = 'Bambu Lab';
    if (isPrusa && mfg && !mfg.value.trim()) mfg.value = 'Prusa Research';
    const prusaUser = document.getElementById('printer-form-prusa-user');
    if (isPrusa && prusaUser && !prusaUser.value.trim()) prusaUser.value = 'maker';
  }

  function printerCanReportStatus(printer) {
    const firmware = String(printer?.firmware_type || '').toLowerCase();
    if ((firmware === 'klipper' || printer?.is_klipper) && printer?.web_url) return true;
    if (firmware === 'bambu os' && printer?.host && printer?.bambu_serial && printer?.bambu_access_code) return true;
    if (firmware === 'prusa buddy' && printer?.web_url) return true;
    return false;
  }

  function renderStatusBadge(printer) {
    if (!printerCanReportStatus(printer)) return '';
    const status = liveStatus[printer.id];
    if (!status) return '<span class="printer-badge printer-status-badge status-checking">Checking…</span>';
    if (status.supported === false) return '';
    const title = status.detail || status.label || '';
    const state = status.state || 'offline';
    return `<span class="printer-badge printer-status-badge status-${escapeHtml(state)}" title="${escapeHtml(title)}">${escapeHtml(status.label || 'Offline')}</span>`;
  }

  function applyLiveStatusBadges() {
    document.querySelectorAll('#printer-cards-list .printer-card').forEach((card) => {
      const printer = cachedPrinters.find((p) => String(p.id) === card.dataset.printerId);
      const meta = card.querySelector('.printer-card-meta');
      if (!printer || !meta) return;
      const html = renderStatusBadge(printer);
      const existing = meta.querySelector('.printer-status-badge');
      if (!html) {
        existing?.remove();
        return;
      }
      const holder = document.createElement('div');
      holder.innerHTML = html;
      const next = holder.firstElementChild;
      if (!next) return;
      if (existing) existing.replaceWith(next);
      else meta.prepend(next);
    });
  }

  async function refreshLiveStatus() {
    if (statusPollInFlight || !window.electron?.getPrinterStatuses) return;
    const dialog = document.getElementById('printer-management-dialog');
    if (!dialog?.open) return;
    statusPollInFlight = true;
    try {
      const next = await window.electron.getPrinterStatuses();
      liveStatus = next && typeof next === 'object' ? next : {};
      applyLiveStatusBadges();
    } catch (err) {
      console.error('Failed to refresh printer status:', err);
    } finally {
      statusPollInFlight = false;
    }
  }

  function startStatusPolling() {
    stopStatusPolling();
    refreshLiveStatus();
    statusPollTimer = setInterval(refreshLiveStatus, 20000);
  }

  function stopStatusPolling() {
    if (statusPollTimer) clearInterval(statusPollTimer);
    statusPollTimer = null;
  }

  function connectionPayloadFromForm() {
    const firmwareType = currentFirmware();
    const payload = { firmwareType };
    if (firmwareType === 'Klipper') {
      payload.webUrl = document.getElementById('printer-form-web-url')?.value?.trim() || '';
    }
    if (firmwareType === 'Bambu OS') {
      payload.host = document.getElementById('printer-form-host')?.value?.trim() || '';
      payload.bambuSerial = document.getElementById('printer-form-serial')?.value?.trim() || '';
      payload.bambuAccessCode = document.getElementById('printer-form-access-code')?.value?.trim() || '';
    }
    if (firmwareType === 'Prusa Buddy') {
      payload.webUrl = document.getElementById('printer-form-web-url')?.value?.trim() || '';
      payload.prusaUsername = document.getElementById('printer-form-prusa-user')?.value?.trim() || 'maker';
      payload.prusaPassword = document.getElementById('printer-form-prusa-password')?.value || '';
    }
    return payload;
  }

  async function testCurrentConnection() {
    const payload = connectionPayloadFromForm();
    if (payload.firmwareType === 'Klipper' && !payload.webUrl) {
      setStatus('printer-form-status', 'Enter the web interface address first', true);
      return;
    }
    if (payload.firmwareType === 'Bambu OS' && (!payload.host || !payload.bambuSerial || !payload.bambuAccessCode)) {
      setStatus('printer-form-status', 'IP address, serial number, and access code are required to connect', true);
      return;
    }
    if (payload.firmwareType === 'Prusa Buddy' && !payload.webUrl) {
      setStatus('printer-form-status', 'Enter the PrusaLink address first', true);
      return;
    }
    if (!window.electron?.testPrinterConnection) {
      setStatus('printer-form-status', 'Connection test is unavailable', true);
      return;
    }
    setStatus('printer-form-status', 'Checking connection…');
    try {
      const result = await window.electron.testPrinterConnection(payload);
      if (!result?.supported) {
        setStatus('printer-form-status', 'This printer is not set up for a live connection yet', true);
        return;
      }
      const detail = result.detail ? ` — ${result.detail}` : '';
      const failed = result.state === 'offline' || result.state === 'error';
      setStatus('printer-form-status', `${result.label || 'Offline'}${detail}`, failed);
    } catch (err) {
      setStatus('printer-form-status', err.message || 'Connection test failed', true);
    }
  }

  function hostsMatch(left, right) {
    const normalize = (value) => String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/:\d+$/, '');
    const a = normalize(left);
    const b = normalize(right);
    return Boolean(a) && a === b;
  }

  function isAlreadyOnboarded(device) {
    return cachedPrinters.some((printer) => {
      if (device.serial && printer.bambu_serial && printer.bambu_serial.toLowerCase() === device.serial.toLowerCase()) return true;
      if (device.host && printer.host && hostsMatch(printer.host, device.host) && device.kind !== 'klipper' && device.kind !== 'prusa') return true;
      if ((device.kind === 'klipper' || device.kind === 'prusa') && device.host && printer.web_url && hostsMatch(printer.web_url, device.host)) return true;
      return false;
    });
  }

  function configureDetectedPrinter(device) {
    resetPrinterForm();
    setPrinterAddOpen(true);
    const nameInput = document.getElementById('printer-form-nickname');
    const mfgInput = document.getElementById('printer-form-manufacturer');
    const modelInput = document.getElementById('printer-form-model');
    const typeInput = document.getElementById('printer-form-type');
    const fwInput = document.getElementById('printer-form-firmware');
    const webInput = document.getElementById('printer-form-web-url');
    const hostInput = document.getElementById('printer-form-host');
    const serialInput = document.getElementById('printer-form-serial');
    if (nameInput) nameInput.value = device.name || device.model || '';
    if (mfgInput) mfgInput.value = device.manufacturer || '';
    if (modelInput) modelInput.value = device.model || '';
    if (typeInput) typeInput.value = device.printerType || 'FDM';
    if (fwInput) fwInput.value = device.firmwareType || 'Other';
    if (webInput && device.webUrl) webInput.value = device.webUrl;
    if (hostInput && device.host) hostInput.value = device.host;
    if (serialInput && device.serial) serialInput.value = device.serial;
    syncConnectionFields();
    document.querySelector('.printer-management-scroll-content')?.scrollTo({ top: 0, behavior: 'smooth' });
    if (device.firmwareType === 'Bambu OS') {
      document.getElementById('printer-form-access-code')?.focus();
    } else if (device.firmwareType === 'Prusa Buddy') {
      document.getElementById('printer-form-prusa-password')?.focus();
    } else if (!nameInput?.value) {
      nameInput?.focus();
    } else {
      webInput?.focus();
    }
  }

  function renderDetectResults(devices) {
    const results = document.getElementById('printer-detect-results');
    if (!results) return;
    results.innerHTML = '';
    if (!devices.length) {
      const empty = document.createElement('div');
      empty.className = 'printer-detect-empty';
      empty.textContent = 'No printers responded. Klipper needs Moonraker on port 7125. PrusaLink answers on port 80. Bambu Lab printers need LAN mode enabled.';
      results.appendChild(empty);
      return;
    }
    devices.forEach((device) => {
      const row = document.createElement('div');
      row.className = 'printer-detect-row';
      const onboarded = isAlreadyOnboarded(device);
      const subtitle = [
        device.host,
        device.model,
        device.serial,
        device.discoveredVia === 'moonraker' ? 'Moonraker' : '',
        device.discoveredVia === 'web' ? 'Web UI' : '',
        device.discoveredVia === 'prusalink' ? 'PrusaLink' : '',
        device.discoveredVia === 'ssdp' ? 'Bambu discovery' : '',
        device.discoveredVia === 'mqtt' ? 'Bambu MQTT' : ''
      ].filter(Boolean).join(' · ');
      row.innerHTML = `
        <div class="printer-detect-info">
          <div class="printer-detect-name">${escapeHtml(device.name || device.host || 'Printer')}</div>
          <div class="printer-detect-meta">
            <span class="printer-badge ${device.kind === 'klipper' ? 'klipper' : ''}">${escapeHtml(device.firmwareType || device.kind || '')}</span>
            <span>${escapeHtml(subtitle)}</span>
          </div>
        </div>
      `;
      if (onboarded) {
        const added = document.createElement('span');
        added.className = 'printer-detect-added';
        added.textContent = 'Added';
        row.appendChild(added);
      } else {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'printer-toggle-add-btn';
        button.textContent = 'Configure';
        button.addEventListener('click', () => configureDetectedPrinter(device));
        row.appendChild(button);
      }
      results.appendChild(row);
    });
  }

  const SCAN_RANGE_KEY = 'printventory.printerScanRange';

  function readSavedScanRange() {
    let saved = '';
    try { saved = localStorage.getItem(SCAN_RANGE_KEY) || ''; } catch (_) { return null; }
    if (!saved) return null;
    try {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { start: String(parsed.start || ''), end: String(parsed.end || '') };
      }
    } catch (_) { /* older single-field value */ }
    const span = saved.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s*-\s*(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (span) return { start: span[1], end: span[2] };
    return null;
  }

  async function ensureScanRangeDefault() {
    const startInput = document.getElementById('printer-scan-start');
    const endInput = document.getElementById('printer-scan-end');
    if (!startInput || !endInput || startInput.dataset.ready === '1') return;
    startInput.dataset.ready = '1';
    const saved = readSavedScanRange();
    if (saved && (saved.start || saved.end)) {
      startInput.value = saved.start;
      endInput.value = saved.end;
      return;
    }
    try {
      const range = await window.electron?.getLocalScanNetworks?.();
      if (!startInput.value.trim() && !endInput.value.trim() && range?.start && range?.end) {
        startInput.value = range.start;
        endInput.value = range.end;
      }
    } catch (_) { /* leave blank and scan this PC's network */ }
  }

  async function showAutoDetectPanel() {
    const panel = document.getElementById('printer-detect-panel');
    const button = document.getElementById('printer-auto-detect-btn');
    if (!panel) return;
    const opening = panel.hidden;
    panel.hidden = !opening;
    if (button) {
      button.classList.toggle('active', opening);
      button.setAttribute('aria-expanded', opening ? 'true' : 'false');
    }
    if (!opening) return;
    await ensureScanRangeDefault();
    document.getElementById('printer-scan-start')?.focus();
  }

  async function runAutoDetect() {
    const panel = document.getElementById('printer-detect-panel');
    const status = document.getElementById('printer-detect-status');
    const results = document.getElementById('printer-detect-results');
    const button = document.getElementById('printer-scan-btn');
    const startInput = document.getElementById('printer-scan-start');
    const endInput = document.getElementById('printer-scan-end');
    if (panel) panel.hidden = false;
    await ensureScanRangeDefault();
    const cleanScanIp = (value) => String(value || '').trim().replace(/^https?:\/\//i, '').split('/')[0].replace(/:\d+$/, '');
    const start = cleanScanIp(startInput?.value);
    const end = cleanScanIp(endInput?.value);
    if ((start && !end) || (!start && end)) {
      if (status) {
        status.hidden = false;
        status.textContent = 'Enter both a start IP and an end IP.';
      }
      return;
    }
    const range = start && end ? `${start}-${end}` : '';
    try { localStorage.setItem(SCAN_RANGE_KEY, JSON.stringify({ start, end })); } catch (_) { /* private mode */ }
    if (results) results.innerHTML = '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Scanning…';
    }
    if (status) {
      status.hidden = false;
      status.textContent = start && end
        ? `Scanning ${start} to ${end} for Klipper, PrusaLink, and Bambu Lab printers…`
        : 'Scanning this PC\'s network for Klipper, PrusaLink, and Bambu Lab printers…';
    }
    try {
      if (!window.electron?.discoverPrinters) throw new Error('Network scan is unavailable');
      const result = await window.electron.discoverPrinters(range);
      const printers = Array.isArray(result?.printers) ? result.printers : [];
      const where = Array.isArray(result?.networks) && result.networks.length
        ? ` on ${result.networks.join(', ')}`
        : '';
      if (status) {
        status.hidden = false;
        status.textContent = printers.length
          ? `Found ${printers.length} printer${printers.length === 1 ? '' : 's'}${where}.`
          : `Scan finished${where}. No printers found.`;
      }
      renderDetectResults(printers);
    } catch (err) {
      if (status) {
        status.hidden = false;
        status.textContent = err.message || 'Scan failed';
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'Scan';
      }
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
    const detectPanel = document.getElementById('printer-detect-panel');
    const detectButton = document.getElementById('printer-auto-detect-btn');
    if (detectPanel) detectPanel.hidden = true;
    if (detectButton) {
      detectButton.classList.remove('active');
      detectButton.setAttribute('aria-expanded', 'false');
    }
    if (printerId) selectedPrinterId = Number(printerId);
    await refreshPrintersList();

    if (tab === 'maintenance' || (printerId && !tab)) {
      switchTab('maintenance');
    } else {
      switchTab('printers');
    }

    if (typeof dialog.showModal === 'function' && !dialog.open) {
      dialog.showModal();
    }
    startStatusPolling();
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
      stopStatusPolling();
      resetPrinterForm();
    });

    document.getElementById('printer-form-firmware')?.addEventListener('change', () => {
      syncConnectionFields();
    });
    document.getElementById('printer-auto-detect-btn')?.addEventListener('click', () => {
      showAutoDetectPanel();
    });
    document.getElementById('printer-scan-btn')?.addEventListener('click', () => {
      runAutoDetect();
    });
    for (const id of ['printer-scan-start', 'printer-scan-end']) {
      document.getElementById(id)?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        runAutoDetect();
      });
    }
    document.getElementById('printer-form-test-connection')?.addEventListener('click', () => {
      testCurrentConnection();
    });
    syncConnectionFields();

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
