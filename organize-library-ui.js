'use strict';

(function () {
  const STRUCTURE_FIELDS = [
    { id: 'designer', label: 'Designer' },
    { id: 'parentModel', label: 'Parent Model' },
    { id: 'license', label: 'License' },
    { id: 'source', label: 'Source' },
    { id: 'printStatus', label: 'Print Status' }
  ];
  const MAX_LAYERS = 4;
  const STRUCTURE_SETTING = 'organizeLibraryLayers';
  let structureLayers = ['parentModel'];
  let previewToken = 0;

  function formatBytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 0) return 'unknown';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let amount = size;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    const digits = unit === 0 ? 0 : 1;
    return amount.toFixed(digits) + ' ' + units[unit];
  }

  function dialogEl() {
    return document.getElementById('organize-library-dialog');
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text || '';
  }

  function clearList(id) {
    const el = document.getElementById(id);
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function lockConfirm() {
    previewToken += 1;
    const confirmBtn = document.getElementById('organize-confirm-button');
    if (confirmBtn) confirmBtn.disabled = true;
  }

  function invalidatePreview() {
    lockConfirm();
    const box = document.getElementById('organize-preview');
    if (!box || box.hidden) return;
    setText('organize-preview-summary', 'Choices changed. Preview again before copying.');
    setText('organize-preview-space', '');
    setText('organize-preview-skipped', '');
    clearList('organize-preview-list');
    const errorEl = document.getElementById('organize-preview-error');
    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  }

  function includeZipsChecked() {
    const row = document.getElementById('organize-include-zip');
    const box = document.getElementById('organize-include-zip-input');
    return !!(row && !row.hidden && box && box.checked);
  }

  function knownLayer(id) {
    return STRUCTURE_FIELDS.some((field) => field.id === id);
  }

  function rememberStructure() {
    if (!window.electron || typeof window.electron.saveSetting !== 'function') return;
    window.electron.saveSetting(STRUCTURE_SETTING, JSON.stringify(structureLayers)).catch(() => {});
  }

  async function loadStructure() {
    try {
      if (!window.electron || typeof window.electron.getSetting !== 'function') return;
      const raw = await window.electron.getSetting(STRUCTURE_SETTING);
      if (raw == null || raw === '') return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const next = [];
      const seen = new Set();
      for (const id of parsed) {
        if (!knownLayer(id) || seen.has(id)) continue;
        seen.add(id);
        next.push(id);
        if (next.length >= MAX_LAYERS) break;
      }
      structureLayers = next;
    } catch (_) {
      /* keep the current layers */
    }
  }

  function fieldLabel(id) {
    const field = STRUCTURE_FIELDS.find((item) => item.id === id);
    return field ? field.label : id;
  }

  function structurePreviewText() {
    const labels = structureLayers.map(fieldLabel);
    return 'Root / ' + (labels.length ? labels.join(' / ') + ' / ' : '') + 'file';
  }

  function renderStructure() {
    const host = document.getElementById('organize-structure-rows');
    const addButton = document.getElementById('organize-structure-add');
    const preview = document.getElementById('organize-structure-preview');
    if (preview) preview.textContent = structurePreviewText();
    if (addButton) {
      const unused = STRUCTURE_FIELDS.some((field) => !structureLayers.includes(field.id));
      addButton.disabled = structureLayers.length >= MAX_LAYERS || !unused;
    }
    if (!host) return;
    host.replaceChildren();
    structureLayers.forEach((currentId, index) => {
      const row = document.createElement('div');
      row.className = 'organize-structure-row';

      const select = document.createElement('select');
      select.setAttribute('aria-label', 'Folder ' + (index + 1));
      STRUCTURE_FIELDS.forEach((field) => {
        if (field.id !== currentId && structureLayers.includes(field.id)) return;
        const option = document.createElement('option');
        option.value = field.id;
        option.textContent = field.label;
        if (field.id === currentId) option.selected = true;
        select.appendChild(option);
      });
      select.addEventListener('change', () => {
        structureLayers[index] = select.value;
        rememberStructure();
        renderStructure();
        invalidatePreview();
      });

      const up = document.createElement('button');
      up.type = 'button';
      up.textContent = 'Up';
      up.disabled = index === 0;
      up.addEventListener('click', (event) => {
        event.preventDefault();
        const previous = structureLayers[index - 1];
        structureLayers[index - 1] = structureLayers[index];
        structureLayers[index] = previous;
        rememberStructure();
        renderStructure();
        invalidatePreview();
      });

      const down = document.createElement('button');
      down.type = 'button';
      down.textContent = 'Down';
      down.disabled = index === structureLayers.length - 1;
      down.addEventListener('click', (event) => {
        event.preventDefault();
        const next = structureLayers[index + 1];
        structureLayers[index + 1] = structureLayers[index];
        structureLayers[index] = next;
        rememberStructure();
        renderStructure();
        invalidatePreview();
      });

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove';
      remove.addEventListener('click', (event) => {
        event.preventDefault();
        structureLayers.splice(index, 1);
        rememberStructure();
        renderStructure();
        invalidatePreview();
      });

      row.append(select, up, down, remove);
      host.appendChild(row);
    });
  }

  function folderKey(value) {
    return String(value || '').trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
  }

  function isAbsolutePath(value) {
    return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
  }

  function folderIsInside(child, parent) {
    const left = folderKey(child);
    const right = folderKey(parent);
    if (!left || !right) return false;
    return left === right || left.startsWith(right + '/');
  }

  function resolveSource(root, sub) {
    const base = String(root || '').trim();
    const extra = String(sub || '').trim();
    if (!base) return '';
    if (!extra) return base;
    if (isAbsolutePath(extra)) return extra;
    const sep = base.includes('\\') ? '\\' : '/';
    const parts = base.split(/[\\/]+/).filter(Boolean);
    extra.split(/[\\/]+/).forEach((part) => {
      if (!part || part === '.') return;
      if (part === '..') parts.pop();
      else parts.push(part);
    });
    if (/^[A-Za-z]:/.test(base)) return parts.join(sep);
    if (base.startsWith('\\\\')) return '\\\\' + parts.join(sep);
    if (base.startsWith('/')) return '/' + parts.join(sep);
    return parts.join(sep);
  }

  function filterSourceMenu() {
    const query = folderKey(document.getElementById('organize-source-search')?.value || '');
    const options = document.querySelectorAll('#organize-source-options button');
    let shown = 0;
    options.forEach((option) => {
      const match = !query || folderKey(option.dataset.path || option.textContent).includes(query);
      option.hidden = !match;
      if (match) shown += 1;
    });
    const empty = document.getElementById('organize-source-empty');
    if (empty) empty.hidden = shown !== 0;
  }

  function closeSourceMenu() {
    const menu = document.getElementById('organize-source-menu');
    const button = document.getElementById('organize-source-button');
    if (menu) menu.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  }

  function openSourceMenu() {
    const menu = document.getElementById('organize-source-menu');
    const button = document.getElementById('organize-source-button');
    const search = document.getElementById('organize-source-search');
    if (!menu || button?.disabled) return;
    if (search) search.value = '';
    filterSourceMenu();
    menu.hidden = false;
    button?.setAttribute('aria-expanded', 'true');
    if (search) search.focus();
  }

  function setScannedRoot(dir) {
    const hidden = document.getElementById('organize-source-input');
    const label = document.getElementById('organize-source-label');
    const sub = document.getElementById('organize-source-subfolder');
    if (hidden) hidden.value = dir || '';
    if (label) label.textContent = dir || 'No scanned directories yet';
    if (sub && sub.value.trim()) {
      const resolved = resolveSource(dir, sub.value);
      if (!dir || !folderIsInside(resolved, dir)) sub.value = '';
    }
    document.querySelectorAll('#organize-source-menu button').forEach((option) => {
      option.setAttribute('aria-selected', option.dataset.path === dir ? 'true' : 'false');
    });
    closeSourceMenu();
  }

  async function loadSources() {
    const button = document.getElementById('organize-source-button');
    const menu = document.getElementById('organize-source-options');
    const subBrowse = document.getElementById('organize-source-sub-browse');
    const hidden = document.getElementById('organize-source-input');
    if (!menu || !button) return;
    const previous = hidden ? hidden.value : '';
    let sources = [];
    try {
      if (window.electron && typeof window.electron.invoke === 'function') {
        sources = await window.electron.invoke('list-organize-sources');
      }
    } catch (_) {
      sources = [];
    }
    if (!Array.isArray(sources)) sources = [];
    menu.replaceChildren();
    closeSourceMenu();
    if (!sources.length) {
      button.disabled = true;
      if (subBrowse) subBrowse.disabled = true;
      setScannedRoot('');
      return;
    }
    button.disabled = false;
    if (subBrowse) subBrowse.disabled = false;
    sources.forEach((item) => {
      const dir = item && item.path ? String(item.path) : '';
      if (!dir) return;
      const option = document.createElement('button');
      option.type = 'button';
      option.dataset.path = dir;
      option.textContent = dir;
      option.title = dir;
      option.setAttribute('role', 'option');
      option.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setScannedRoot(dir);
        invalidatePreview();
      });
      menu.appendChild(option);
    });
    const keep = sources.find((item) => folderKey(item.path) === folderKey(previous));
    setScannedRoot(keep ? keep.path : sources[0].path);
  }

  function paths() {
    const root = (document.getElementById('organize-source-input')?.value || '').trim();
    const sub = (document.getElementById('organize-source-subfolder')?.value || '').trim();
    return {
      sourceDir: resolveSource(root, sub),
      destDir: (document.getElementById('organize-dest-input')?.value || '').trim(),
      includeZips: includeZipsChecked(),
      layers: structureLayers.slice()
    };
  }

  async function syncZipOption() {
    const row = document.getElementById('organize-include-zip');
    const box = document.getElementById('organize-include-zip-input');
    let enabled = false;
    try {
      if (window.electron && typeof window.electron.getSetting === 'function') {
        enabled = (await window.electron.getSetting('enableZipArchives')) === '1';
      }
    } catch (_) {
      enabled = false;
    }
    if (row) row.hidden = !enabled;
    if (!enabled && box) box.checked = false;
  }

  function canConfirm(preview) {
    if (!preview || !preview.ok || !preview.enoughSpace) return false;
    return (Number(preview.copyCount) || 0) + (Number(preview.resumeCount) || 0) > 0;
  }

  function reasonLine(preview) {
    const counts = preview.reasonCounts || {};
    const parts = Object.keys(counts).map((reason) => counts[reason] + ' ' + reason);
    if (!parts.length && preview.skippedCount) parts.push(preview.skippedCount + ' skipped');
    return parts.join('. ');
  }

  function showPreview(preview) {
    const box = document.getElementById('organize-preview');
    const errorEl = document.getElementById('organize-preview-error');
    if (box) box.hidden = false;
    clearList('organize-preview-list');

    const moveCount = (Number(preview.copyCount) || 0) + (Number(preview.resumeCount) || 0);
    const summary = [];
    if (preview.destWillBeCreated) summary.push('The destination folder will be created.');
    if (moveCount) {
      summary.push(
        preview.copyCount + ' file' + (preview.copyCount === 1 ? '' : 's') +
        ' will be copied (' + formatBytes(preview.copyBytes) + ').'
      );
      if (preview.resumeCount) {
        summary.push(
          preview.resumeCount + ' matching file' + (preview.resumeCount === 1 ? '' : 's') +
          ' already at the destination will be finished and the original removed.'
        );
      }
      if (preview.zipCount) {
        summary.push(
          preview.zipCount + ' of those ' + (preview.zipCount === 1 ? 'is a zip file' : 'are zip files') +
          ' (' + preview.zipEntryCount + ' models inside, not extracted).'
        );
      }
    } else if (preview.ok) {
      summary.push('Nothing in that folder needs to be moved.');
    }
    const emptyLayers = Array.isArray(preview.emptyLayers) ? preview.emptyLayers : [];
    if (emptyLayers.length) {
      emptyLayers.forEach((layer) => {
        summary.push(
          layer.count + ' file' + (layer.count === 1 ? '' : 's') +
          ' have no ' + String(layer.label || 'value').toLowerCase() +
          ' and will go in "' + layer.folder + '".'
        );
      });
    } else if (preview.noParentCount) {
      summary.push(
        preview.noParentCount + ' file' + (preview.noParentCount === 1 ? '' : 's') +
        ' have no parent model and will go in "No Parent Model".'
      );
    }
    setText('organize-preview-summary', summary.join(' '));

    const spaceBits = [];
    if (preview.freeBytes != null) spaceBits.push('Free space: ' + formatBytes(preview.freeBytes) + '.');
    if ((Number(preview.copyBytes) || 0) > 0) {
      spaceBits.push(
        'Required: ' + formatBytes(preview.copyBytes) +
        ' plus ' + formatBytes(preview.marginBytes) + '.'
      );
    }
    setText('organize-preview-space', spaceBits.join(' '));

    const list = document.getElementById('organize-preview-list');
    (preview.sample || []).forEach((move) => {
      const item = document.createElement('li');
      const inside = move.zipEntryCount ? ' (' + move.zipEntryCount + ' models inside)' : '';
      item.textContent = move.from + ' → ' + move.to + inside;
      list?.appendChild(item);
    });
    if ((preview.copyCount || 0) + (preview.resumeCount || 0) > (preview.sample || []).length) {
      const more = document.createElement('li');
      more.textContent = '…';
      list?.appendChild(more);
    }

    const skippedLine = reasonLine(preview);
    setText('organize-preview-skipped', skippedLine ? ('Skipped: ' + skippedLine + '.') : '');

    const problems = [preview.error, preview.spaceError].filter(Boolean);
    if (errorEl) {
      errorEl.hidden = problems.length === 0;
      errorEl.textContent = problems.join(' ');
    }

    const confirmBtn = document.getElementById('organize-confirm-button');
    if (confirmBtn) confirmBtn.disabled = !canConfirm(preview);
  }

  let folderBrowserResolve = null;
  let folderBrowserToken = 0;
  let folderBrowserState = { constrain: '', parent: null };

  function folderBrowserError(message) {
    const errorEl = document.getElementById('organize-folder-browser-error');
    if (!errorEl) return;
    errorEl.hidden = !message;
    errorEl.textContent = message || '';
  }

  function closeFolderBrowser(value) {
    const resolve = folderBrowserResolve;
    folderBrowserResolve = null;
    const browser = document.getElementById('organize-folder-browser-dialog');
    if (browser && browser.open && typeof browser.close === 'function') browser.close();
    if (resolve) resolve(value || null);
  }

  async function loadFolderBrowser(dirPath) {
    const token = ++folderBrowserToken;
    const pathInput = document.getElementById('organize-folder-browser-path');
    const list = document.getElementById('organize-folder-browser-list');
    const status = document.getElementById('organize-folder-browser-status');
    const upBtn = document.getElementById('organize-folder-browser-up');
    const requested = String(dirPath || '').trim();
    if (pathInput) pathInput.value = requested;
    if (list) list.replaceChildren();
    if (status) status.textContent = '';
    folderBrowserError('');
    folderBrowserState.parent = null;
    if (upBtn) upBtn.disabled = true;
    if (!requested) {
      folderBrowserError('Enter a folder path to browse.');
      return;
    }
    if (
      folderBrowserState.constrain &&
      folderKey(requested) !== folderKey(folderBrowserState.constrain) &&
      !folderIsInside(requested, folderBrowserState.constrain)
    ) {
      folderBrowserError('That folder is outside the scanned directory.');
      return;
    }
    try {
      const listing = await window.electron.invoke('list-directories', requested);
      if (token !== folderBrowserToken) return;
      if (!listing || !listing.ok) {
        folderBrowserError((listing && listing.error) || 'Could not read that folder.');
        return;
      }
      if (pathInput) pathInput.value = listing.path || requested;
      const parent = listing.parent || null;
      const parentOutside = !!(
        folderBrowserState.constrain &&
        parent &&
        folderKey(parent) !== folderKey(folderBrowserState.constrain) &&
        !folderIsInside(parent, folderBrowserState.constrain)
      );
      folderBrowserState.parent = parentOutside ? null : parent;
      if (upBtn) upBtn.disabled = !folderBrowserState.parent;
      (listing.dirs || []).forEach((dir) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = dir.name;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          loadFolderBrowser(dir.path);
        });
        list?.appendChild(button);
      });
      if (status) {
        if (!listing.dirs || listing.dirs.length === 0) status.textContent = 'No folders in here.';
        else if (listing.truncated) status.textContent = 'Showing the first 2000 folders.';
      }
    } catch (err) {
      if (token !== folderBrowserToken) return;
      folderBrowserError(err.message || 'Could not read that folder.');
    }
  }

  function showFolderBrowser(options) {
    const browser = document.getElementById('organize-folder-browser-dialog');
    if (!browser) return Promise.resolve(null);
    if (folderBrowserResolve) folderBrowserResolve(null);
    return new Promise((resolve) => {
      folderBrowserResolve = resolve;
      folderBrowserState = { constrain: (options && options.constrainTo) || '', parent: null };
      const title = document.getElementById('organize-folder-browser-title');
      if (title) title.textContent = (options && options.title) || 'Select folder';
      if (typeof browser.showModal === 'function' && !browser.open) browser.showModal();
      loadFolderBrowser((options && options.start) || '/');
    });
  }

  async function usingServerFolderBrowser() {
    if (!window.electron || typeof window.electron.isServerMode !== 'function') return false;
    return !!(await window.electron.isServerMode().catch(() => false));
  }

  function pickerFailure(err) {
    showPreview({
      ok: false,
      error: err && err.message ? err.message : 'Could not open the folder picker.',
      enoughSpace: false,
      sample: [],
      copyCount: 0,
      resumeCount: 0
    });
  }

  async function browseSubfolder() {
    const root = (document.getElementById('organize-source-input')?.value || '').trim();
    if (!root) return;
    const current = (document.getElementById('organize-source-subfolder')?.value || '').trim();
    const start = current && folderIsInside(resolveSource(root, current), root)
      ? resolveSource(root, current)
      : root;
    try {
      let chosen = null;
      if (await usingServerFolderBrowser()) {
        chosen = await showFolderBrowser({
          title: 'Folder inside the scanned directory',
          start,
          constrainTo: root
        });
      } else {
        const result = await window.electron.invoke('open-folder-dialog', {
          title: 'Folder inside the scanned directory',
          defaultPath: start
        });
        if (!result || result.canceled || !result.filePaths || !result.filePaths[0]) return;
        chosen = result.filePaths[0];
      }
      if (!chosen) return;
      if (!folderIsInside(chosen, root)) {
        showPreview({
          ok: false,
          error: 'That folder is outside the scanned directory.',
          enoughSpace: false,
          sample: [],
          copyCount: 0,
          resumeCount: 0
        });
        return;
      }
      const input = document.getElementById('organize-source-subfolder');
      if (input) input.value = folderKey(chosen) === folderKey(root) ? '' : chosen;
      invalidatePreview();
    } catch (err) {
      pickerFailure(err);
    }
  }

  async function browseInto(inputId, title) {
    try {
      let chosen = null;
      if (await usingServerFolderBrowser()) {
        const current = (document.getElementById(inputId)?.value || '').trim();
        const source = (document.getElementById('organize-source-input')?.value || '').trim();
        chosen = await showFolderBrowser({
          title,
          start: current || source || '/'
        });
      } else {
        const result = await window.electron.invoke('open-folder-dialog', title);
        if (!result || result.canceled || !result.filePaths || !result.filePaths[0]) return;
        chosen = result.filePaths[0];
      }
      if (!chosen) return;
      const input = document.getElementById(inputId);
      if (!input) return;
      input.value = chosen;
      invalidatePreview();
    } catch (err) {
      pickerFailure(err);
    }
  }

  async function runPreview() {
    const token = ++previewToken;
    const confirmBtn = document.getElementById('organize-confirm-button');
    const previewBtn = document.getElementById('organize-preview-button');
    if (confirmBtn) confirmBtn.disabled = true;
    if (previewBtn) previewBtn.disabled = true;
    try {
      const preview = await window.electron.invoke('organize-library-preview', paths());
      if (token !== previewToken) return;
      showPreview(preview || { ok: false, error: 'Could not preview the organize job.', enoughSpace: false });
    } catch (err) {
      if (token !== previewToken) return;
      showPreview({
        ok: false,
        error: err.message || 'Could not preview the organize job.',
        enoughSpace: false,
        sample: [],
        copyCount: 0,
        resumeCount: 0
      });
    } finally {
      if (previewBtn) previewBtn.disabled = false;
    }
  }

  function resultMessage(result) {
    if (!result) return 'Organize failed.';
    if (result.error && !result.moved) return result.error;
    const lines = [];
    lines.push('Moved ' + (result.moved || 0) + ' file' + ((result.moved || 0) === 1 ? '' : 's') + '.');
    lines.push('Skipped ' + (result.skipped || 0) + '.');
    if (result.failedCount) {
      lines.push(result.failedCount + ' failed. Those originals were left in place.');
      (result.failed || []).slice(0, 5).forEach((item) => {
        lines.push((item.from || 'File') + ': ' + item.error);
      });
    }
    if (result.warningCount) {
      lines.push(result.warningCount + ' copied, but the original could not be removed.');
    }
    if (result.zipModels) {
      lines.push(result.zipModels + ' models stay inside the moved zip files.');
    }
    return lines.join('\n');
  }

  async function runOrganize() {
    const job = paths();
    const confirmBtn = document.getElementById('organize-confirm-button');
    const previewBtn = document.getElementById('organize-preview-button');
    if (confirmBtn) confirmBtn.disabled = true;
    if (previewBtn) previewBtn.disabled = true;
    try {
      const result = await window.electron.invoke('organize-library-run', job);
      const message = resultMessage(result);
      const succeeded = !!(result && result.ok);
      showPreview({
        ok: succeeded,
        error: succeeded ? '' : message,
        enoughSpace: false,
        sample: [],
        copyCount: 0,
        resumeCount: 0,
        reasonCounts: {}
      });
      setText('organize-preview-summary', succeeded ? message : '');
      if (window.electron.showMessage) {
        await window.electron.showMessage('Organize Library', message);
      }
    } catch (err) {
      const message = err.message || 'Organize failed.';
      showPreview({
        ok: false,
        error: message,
        enoughSpace: false,
        sample: [],
        copyCount: 0,
        resumeCount: 0
      });
      if (window.electron.showMessage) {
        await window.electron.showMessage('Organize Library', message);
      }
    } finally {
      if (previewBtn) previewBtn.disabled = false;
      lockConfirm();
    }
  }

  async function openOrganizeLibrary() {
    const dialog = dialogEl();
    if (!dialog) return;
    await loadStructure();
    renderStructure();
    await loadSources();
    syncZipOption();
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
  }

  function bindOrganizeLibrary() {
    const form = document.getElementById('organize-library-form');
    if (!form || form.dataset.bound === '1') return;
    form.dataset.bound = '1';
    form.addEventListener('submit', (event) => event.preventDefault());
    document.getElementById('organize-source-button')?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const menu = document.getElementById('organize-source-menu');
      if (!menu || document.getElementById('organize-source-button')?.disabled) return;
      if (menu.hidden) openSourceMenu();
      else closeSourceMenu();
    });
    document.getElementById('organize-source-search')?.addEventListener('input', filterSourceMenu);
    document.getElementById('organize-source-search')?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeSourceMenu();
        document.getElementById('organize-source-button')?.focus();
        return;
      }
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const match = document.querySelector('#organize-source-options button:not([hidden])');
      if (!match) return;
      setScannedRoot(match.dataset.path || '');
      invalidatePreview();
    });
    document.addEventListener('click', (event) => {
      const picker = document.querySelector('.organize-source-picker');
      if (picker && picker.contains(event.target)) return;
      closeSourceMenu();
    });
    document.getElementById('organize-source-subfolder')?.addEventListener('input', invalidatePreview);
    document.getElementById('organize-dest-input')?.addEventListener('input', invalidatePreview);
    document.getElementById('organize-include-zip-input')?.addEventListener('change', invalidatePreview);
    document.getElementById('organize-structure-add')?.addEventListener('click', (event) => {
      event.preventDefault();
      const next = STRUCTURE_FIELDS.find((field) => !structureLayers.includes(field.id));
      if (!next || structureLayers.length >= MAX_LAYERS) return;
      structureLayers.push(next.id);
      rememberStructure();
      renderStructure();
      invalidatePreview();
    });
    loadStructure().then(renderStructure);
    const browserPath = document.getElementById('organize-folder-browser-path');
    browserPath?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      loadFolderBrowser(browserPath.value);
    });
    document.getElementById('organize-folder-browser-go')?.addEventListener('click', (event) => {
      event.preventDefault();
      loadFolderBrowser(document.getElementById('organize-folder-browser-path')?.value || '');
    });
    document.getElementById('organize-folder-browser-up')?.addEventListener('click', (event) => {
      event.preventDefault();
      if (folderBrowserState.parent) loadFolderBrowser(folderBrowserState.parent);
    });
    document.getElementById('organize-folder-browser-use')?.addEventListener('click', (event) => {
      event.preventDefault();
      const chosen = (document.getElementById('organize-folder-browser-path')?.value || '').trim();
      if (!chosen) {
        folderBrowserError('Enter a folder path to browse.');
        return;
      }
      if (folderBrowserState.constrain && !folderIsInside(chosen, folderBrowserState.constrain)) {
        folderBrowserError('That folder is outside the scanned directory.');
        return;
      }
      closeFolderBrowser(chosen);
    });
    document.getElementById('organize-folder-browser-cancel')?.addEventListener('click', (event) => {
      event.preventDefault();
      closeFolderBrowser(null);
    });
    document.getElementById('organize-folder-browser-dialog')?.addEventListener('close', () => {
      closeFolderBrowser(null);
    });
    document.getElementById('organize-source-sub-browse')?.addEventListener('click', (event) => {
      event.preventDefault();
      browseSubfolder();
    });
    document.getElementById('organize-dest-browse')?.addEventListener('click', (event) => {
      event.preventDefault();
      browseInto('organize-dest-input', 'Destination directory');
    });
    document.getElementById('organize-preview-button')?.addEventListener('click', (event) => {
      event.preventDefault();
      runPreview();
    });
    document.getElementById('organize-confirm-button')?.addEventListener('click', (event) => {
      event.preventDefault();
      runOrganize();
    });
    document.getElementById('organize-close-button')?.addEventListener('click', (event) => {
      event.preventDefault();
      closeSourceMenu();
      dialogEl()?.close();
    });
    dialogEl()?.addEventListener('close', () => {
      closeSourceMenu();
      closeFolderBrowser(null);
    });

    window._electronRealEventHandlers = window._electronRealEventHandlers || {};
    window._electronRealEventHandlers['open-organize-library'] = openOrganizeLibrary;
    const pending = window._electronPendingEvents && window._electronPendingEvents['open-organize-library'];
    if (pending) {
      pending.forEach((args) => openOrganizeLibrary.apply(null, args));
      delete window._electronPendingEvents['open-organize-library'];
    }
  }

  window.openOrganizeLibrary = openOrganizeLibrary;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOrganizeLibrary);
  } else {
    bindOrganizeLibrary();
  }
})();
