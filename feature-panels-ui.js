/**
 * Feature panel wiring: path display, parent flatten, find similar modal,
 * dedup ignore, maintenance badge, sliced files (gcode-only send), recently removed.
 */
(function () {
  'use strict';

  let pendingSendPath = null;

  function toast(msg, type) {
    if (typeof window.showToast === 'function') window.showToast(msg, { type: type || 'info' });
  }

  function isSendableGcode(filePath) {
    return /\.(gcode|bgcode)$/i.test(String(filePath || ''));
  }

  // —— Path display ——
  async function loadPathSettings() {
    if (!window.electron?.getSetting) return;
    const mode = (await window.electron.getSetting('pathDisplayMode')) || 'full';
    const aliasesRaw = await window.electron.getSetting('pathAliases');
    const modeEl = document.getElementById('path-display-mode');
    const aliasEl = document.getElementById('path-aliases-json');
    if (modeEl) modeEl.value = mode;
    if (aliasEl) {
      try {
        const parsed = typeof aliasesRaw === 'string' ? JSON.parse(aliasesRaw || '[]') : (aliasesRaw || []);
        aliasEl.value = JSON.stringify(parsed, null, 2);
      } catch (_) {
        aliasEl.value = '[]';
      }
    }
  }

  async function savePathSettings() {
    const mode = document.getElementById('path-display-mode')?.value || 'full';
    const raw = document.getElementById('path-aliases-json')?.value || '[]';
    let aliases = [];
    try {
      aliases = JSON.parse(raw);
      if (!Array.isArray(aliases)) throw new Error('Aliases must be a JSON array');
    } catch (err) {
      toast(err.message || 'Invalid aliases JSON', 'error');
      return false;
    }
    await window.electron.saveSetting('pathDisplayMode', mode);
    await window.electron.saveSetting('pathAliases', JSON.stringify(aliases));
    window._pathDisplayMode = mode;
    window._pathAliases = aliases;
    return true;
  }

  async function formatPath(fullPath) {
    if (!fullPath) return '';
    const mode = window._pathDisplayMode || (await window.electron.getSetting('pathDisplayMode')) || 'full';
    const aliases = window._pathAliases || JSON.parse((await window.electron.getSetting('pathAliases')) || '[]');
    if (window.electron.formatPathDisplay) return window.electron.formatPathDisplay(fullPath, mode, aliases);
    return fullPath;
  }

  // —— Parent safety ——
  async function flattenCurrentParent() {
    const parent = document.getElementById('model-parent')?.value?.trim();
    if (!parent) { toast('No parent model set', 'warning'); return; }
    const ok = await window.electron.showMessage('Flatten group?', `Clear parent on all children of “${parent}”?`, ['Flatten', 'Cancel']);
    if (ok !== 'Flatten') return;
    const result = await window.electron.flattenParentGroup(parent);
    toast(`Cleared ${result?.cleared ?? 0} child link(s)`, 'success');
    if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
  }

  // —— Find similar (modal with previews) ——
  async function findSimilarForModel(modelId) {
    const id = Number(modelId || window.currentModelId || document.getElementById('model-details')?.dataset?.modelId);
    if (!id) { toast('Open a model first', 'warning'); return; }

    const dlg = document.getElementById('find-similar-dialog');
    const list = document.getElementById('find-similar-modal-list');
    const summary = document.getElementById('find-similar-summary');
    if (!dlg || !list) return;
    list.innerHTML = '<p class="feature-muted">Searching for similar models…</p>';
    if (summary) summary.textContent = 'Comparing geometry fingerprints and metadata…';
    dlg.showModal();

    let similar = [];
    try {
      if (window.electron.computeStlGeometry && window.currentModelPath) {
        const fp = String(window.currentModelPath || '');
        if (/\.stl$/i.test(fp) && !fp.includes('::')) {
          await window.electron.computeStlGeometry(id, fp).catch(() => {});
        }
      }
      similar = (await window.electron.findSimilarModels(id, 24)) || [];
    } catch (err) {
      list.innerHTML = `<p class="feature-muted">${err.message || 'Search failed'}</p>`;
      return;
    }

    list.innerHTML = '';
    if (!similar.length) {
      list.innerHTML = '<p class="feature-muted">No similar models found. Geometry is indexed when you open STL models; try again after browsing more of the library.</p>';
      return;
    }
    if (summary) {
      summary.textContent = `${similar.length} similar model${similar.length === 1 ? '' : 's'} (geometry preferred when available).`;
    }

    for (const s of similar) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'find-similar-card';
      const scorePct = Math.round((Number(s.score) || 0) * 100);
      const name = s.fileName || s.filePath || `Model ${s.modelId || s.model_id}`;
      if (s.thumbnail) {
        const img = document.createElement('img');
        img.className = 'find-similar-thumb';
        img.alt = '';
        img.src = s.thumbnail.startsWith('data:') ? s.thumbnail : `data:image/png;base64,${s.thumbnail}`;
        card.appendChild(img);
      } else {
        const ph = document.createElement('div');
        ph.className = 'find-similar-thumb-placeholder';
        ph.textContent = 'No preview';
        card.appendChild(ph);
      }
      const nameEl = document.createElement('div');
      nameEl.className = 'find-similar-name';
      nameEl.textContent = name;
      const scoreEl = document.createElement('div');
      scoreEl.className = 'find-similar-score';
      scoreEl.textContent = `${scorePct}% · ${s.source || 'match'}`;
      card.appendChild(nameEl);
      card.appendChild(scoreEl);
      card.addEventListener('click', async () => {
        dlg.close();
        const path = s.filePath;
        if (!path) return;
        if (typeof window.selectModelByPath === 'function') {
          await window.selectModelByPath(path);
        } else if (typeof window.showModelDetails === 'function') {
          await window.showModelDetails(path);
        } else if (typeof window.previewModel === 'function') {
          window.previewModel(path);
        } else {
          const item = document.querySelector(`.file-item[data-filepath="${CSS.escape(path)}"]`);
          if (item) item.click();
        }
      });
      list.appendChild(card);
    }
  }

  async function findSimilarForCurrent() {
    return findSimilarForModel(window.currentModelId);
  }

  // —— Dedup ignore ——
  async function markGroupNotDuplicate(hash) {
    if (!hash) return;
    await window.electron.dedupIgnoreHash(hash, 'intentional');
    toast('Marked as not a duplicate', 'success');
    if (typeof window.loadDuplicateFiles === 'function') await window.loadDuplicateFiles(true, true);
  }

  async function unmarkGroupNotDuplicate(hash) {
    if (!hash) return;
    await window.electron.dedupUnignoreHash(hash);
    toast('Restored duplicate group', 'success');
    if (typeof window.loadDuplicateFiles === 'function') await window.loadDuplicateFiles(true, true);
  }

  // —— Maintenance badge ——
  async function checkMaintenance() {
    if (!window.electron?.checkMaintenanceOnLaunch) return;
    const result = await window.electron.checkMaintenanceOnLaunch();
    const badge = document.getElementById('maintenance-badge');
    const banner = document.getElementById('maintenance-banner');
    const count = result?.count || 0;
    if (badge) {
      badge.hidden = count === 0;
      badge.textContent = count > 0 ? String(count) : '';
    }
    if (banner) {
      if (count === 0) {
        banner.hidden = true;
        banner.replaceChildren();
      } else {
        banner.hidden = false;
        const first = (result.notifications || [])[0];
        banner.replaceChildren();
        const text = document.createElement('span');
        text.textContent = first ? `${first.title}: ${first.body}` : `${count} maintenance reminder(s) due`;
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.textContent = 'Dismiss';
        dismiss.addEventListener('click', () => { banner.hidden = true; });
        banner.appendChild(text);
        banner.appendChild(dismiss);
      }
    }
  }

  // —— Send to printer (gcode only, in-app modal) ——
  async function openSendToPrinterDialog(filePath) {
    if (!isSendableGcode(filePath)) {
      toast('Send to printer is only available for .gcode / .bgcode files', 'warning');
      return;
    }
    const dlg = document.getElementById('send-to-printer-dialog');
    const select = document.getElementById('send-to-printer-select');
    const label = document.getElementById('send-to-printer-file-label');
    if (!dlg || !select) return;
    pendingSendPath = filePath;
    if (label) label.textContent = filePath;
    const printers = (await window.electron.getAllPrinters?.()) || [];
    const klipper = printers.filter((p) => p.is_klipper || p.host || p.web_url);
    select.innerHTML = '';
    if (!klipper.length) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No Moonraker printers configured';
      select.appendChild(opt);
    } else {
      for (const p of klipper) {
        const opt = document.createElement('option');
        opt.value = String(p.id);
        opt.textContent = p.nickname || p.host || `Printer ${p.id}`;
        select.appendChild(opt);
      }
    }
    dlg.showModal();
  }

  async function confirmSendToPrinter() {
    const select = document.getElementById('send-to-printer-select');
    const printerId = Number(select?.value);
    if (!printerId || !pendingSendPath) {
      toast('Select a printer first', 'warning');
      return;
    }
    const dlg = document.getElementById('send-to-printer-dialog');
    toast('Uploading G-code…', 'info');
    const result = await window.electron.sendSlicedToPrinter({
      printerId,
      filePath: pendingSendPath
    });
    dlg?.close();
    if (result?.ok) toast(`Uploaded ${result.fileName || 'file'} to printer`, 'success');
    else toast(result?.detail || result?.reason || 'Upload failed', 'error');
  }

  async function attachGcodeForModel(modelId, modelPath) {
    const id = Number(modelId || window.currentModelId);
    if (!id) { toast('Open a model first', 'warning'); return; }
    const result = await window.electron.attachGcodeToModel({
      modelId: id,
      modelPath: modelPath || window.currentModelPath || null
    });
    if (!result?.ok) {
      if (result?.reason === 'cancelled') return;
      toast(result?.reason || 'Could not attach G-code', 'error');
      return;
    }
    toast('G-code attached', 'success');
    await loadSlicedFiles(id, modelPath || window.currentModelPath);
  }

  async function pickGcodeViaInput() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.gcode,.bgcode,text/plain';
      input.style.display = 'none';
      document.body.appendChild(input);
      input.addEventListener('change', () => {
        const file = input.files && input.files[0];
        const path = file?.path || null;
        input.remove();
        resolve(path);
      }, { once: true });
      input.click();
    });
  }

  async function loadSlicedFiles(modelId, modelPath) {
    const host = document.getElementById('sliced-files-list');
    if (!host || !modelId) return;
    if (typeof window.electron?.listSlicedFiles !== 'function') {
      host.innerHTML = '<p class="feature-muted">Sliced-file tools are unavailable in this client.</p>';
      return;
    }
    try {
      if (modelPath && typeof window.electron.indexSlicedFiles === 'function') {
        await window.electron.indexSlicedFiles(modelId, modelPath);
      }
      const files = await window.electron.listSlicedFiles(modelId);
      host.innerHTML = '';
      const gcodes = (files || []).filter((f) => isSendableGcode(f.filePath));
      if (!gcodes.length) {
        host.innerHTML = '<p class="feature-muted">No .gcode / .bgcode attached. Right-click the model → Attach G-code…</p>';
        const attachBtn = document.createElement('button');
        attachBtn.type = 'button';
        attachBtn.className = 'sliced-send-btn';
        attachBtn.textContent = 'Attach G-code…';
        attachBtn.addEventListener('click', () => attachGcodeForModel(modelId, modelPath));
        host.appendChild(attachBtn);
        return;
      }
      for (const f of gcodes) {
        const row = document.createElement('div');
        row.className = 'sliced-file-row';
        const meta = f.meta || {};
        const bits = [];
        if (meta.estimatedTimeSec) bits.push(`${Math.round(meta.estimatedTimeSec / 60)} min`);
        if (meta.filamentGrams) bits.push(`${meta.filamentGrams} g`);
        if (meta.layerHeight) bits.push(`${meta.layerHeight} mm`);
        if (meta.slicer) bits.push(meta.slicer);
        row.innerHTML = `<div class="sliced-file-path"></div><div class="sliced-file-meta"></div>`;
        row.querySelector('.sliced-file-path').textContent = f.filePath;
        row.querySelector('.sliced-file-meta').textContent = bits.join(' · ') || 'G-code';
        const actions = document.createElement('div');
        actions.className = 'sliced-file-actions';
        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'sliced-send-btn';
        sendBtn.textContent = 'Send to printer';
        sendBtn.addEventListener('click', () => openSendToPrinterDialog(f.filePath));
        const detachBtn = document.createElement('button');
        detachBtn.type = 'button';
        detachBtn.className = 'sliced-detach-btn';
        detachBtn.textContent = 'Detach';
        detachBtn.title = 'Remove this G-code association (file stays on disk)';
        detachBtn.addEventListener('click', async () => {
          await window.electron.detachGcodeFromModel({ modelId, filePath: f.filePath });
          toast('G-code detached', 'success');
          await loadSlicedFiles(modelId, modelPath);
        });
        actions.appendChild(sendBtn);
        actions.appendChild(detachBtn);
        row.appendChild(actions);
        host.appendChild(row);
      }
      const attachMore = document.createElement('button');
      attachMore.type = 'button';
      attachMore.className = 'sliced-send-btn';
      attachMore.textContent = 'Attach another G-code…';
      attachMore.addEventListener('click', () => attachGcodeForModel(modelId, modelPath));
      host.appendChild(attachMore);
    } catch (err) {
      host.innerHTML = `<p class="feature-muted">${err.message || 'Could not load sliced files'}</p>`;
    }
  }

  // —— Recently removed ——
  async function openRecentlyRemoved() {
    const dlg = document.getElementById('recently-removed-dialog');
    const list = document.getElementById('recently-removed-list');
    if (!dlg || !list) return;
    if (!dlg.open) {
      dlg.classList.remove('modal-fullscreen');
      if (typeof window.syncRecentlyRemovedFullscreenButton === 'function') {
        window.syncRecentlyRemovedFullscreenButton(false);
      }
    }
    const rows = await window.electron.listRecentlyRemoved(100);
    list.innerHTML = '';
    for (const r of rows || []) {
      const row = document.createElement('div');
      row.className = 'recently-removed-row';
      const name = document.createElement('span');
      name.textContent = r.fileName || r.filePath || `#${r.model_id || r.id}`;
      name.title = r.filePath || '';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Restore';
      btn.addEventListener('click', async () => {
        await window.electron.restoreModel(r.model_id || r.id);
        toast('Restored', 'success');
        await openRecentlyRemoved();
        if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
      });
      row.appendChild(name);
      row.appendChild(btn);
      list.appendChild(row);
    }
    if (!rows?.length) list.innerHTML = '<p class="feature-muted">Nothing in trash.</p>';
    if (!dlg.open) dlg.showModal();
  }

  // —— Near-dup threshold ——
  async function ensureGeometryForVisible() {
    const cards = document.querySelectorAll('.file-item[data-id]');
    let n = 0;
    for (const card of cards) {
      if (n >= 60) break;
      const id = Number(card.dataset.id);
      const fp = card.dataset.filepath || card.getAttribute('data-filepath') || '';
      if (!id || !fp || !/\.stl$/i.test(fp) || fp.includes('::')) continue;
      try {
        await window.electron.computeStlGeometry?.(id, fp);
        n += 1;
      } catch (_) { /* ignore */ }
    }
  }

  async function runNearDupes() {
    const slider = document.getElementById('near-dup-threshold');
    const thr = slider ? Number(slider.value) / 100 : 0.92;
    const host = document.getElementById('near-dup-results');
    if (!host) return;
    host.textContent = 'Indexing geometry from visible / duplicate STLs…';
    try { await ensureGeometryForVisible(); } catch (_) { /* optional */ }
    // Also index STLs from exact duplicate groups currently shown
    try {
      const paths = [...document.querySelectorAll('.duplicate-file-path')].map((el) => el.dataset?.fullPath || el.title || el.textContent).filter(Boolean);
      for (const p of paths.slice(0, 40)) {
        if (!/\.stl$/i.test(p) || p.includes('::')) continue;
        const item = document.querySelector(`.file-item[data-filepath="${CSS.escape(p)}"]`);
        const id = Number(item?.dataset?.id);
        if (id) await window.electron.computeStlGeometry?.(id, p).catch(() => {});
      }
    } catch (_) { /* ignore */ }

    host.textContent = 'Searching…';
    const groups = await window.electron.findNearDuplicates(thr);
    host.innerHTML = '';
    const exactCount = document.querySelectorAll('.duplicate-group:not(.ignored-dedup-group)').length;
    const note = document.createElement('p');
    note.className = 'near-dup-exact-note';
    note.textContent = exactCount
      ? `${exactCount} exact hash duplicate group(s) are listed above. Near-duplicates find different files with similar mesh geometry.`
      : 'Near-duplicates find different files with similar mesh geometry (not the same file hash).';
    host.appendChild(note);

    if (!groups?.length) {
      const empty = document.createElement('p');
      empty.className = 'feature-muted';
      empty.textContent = 'No near-duplicates above this threshold yet. Open more STL models to index geometry, then try again.';
      host.appendChild(empty);
      return;
    }
    for (const g of groups) {
      const div = document.createElement('div');
      div.className = 'near-dup-group';
      const sim = g.similarity != null ? g.similarity : g.minSimilarity;
      div.textContent = `Models ${g.modelIds.join(', ')} · similarity ${((sim || 0) * 100).toFixed(1)}%`;
      host.appendChild(div);
    }
  }

  function updateDedupIgnoreButtons() {
    const hash = window._dedupActiveHash;
    const undoBtn = document.getElementById('dedup-undo-not-duplicate');
    const active = document.querySelector('.duplicate-group.active-dedup-group');
    const ignored = active?.classList.contains('ignored-dedup-group');
    if (undoBtn) undoBtn.hidden = !(hash && ignored);
  }

  function wire() {
    document.getElementById('flatten-parent-button')?.addEventListener('click', flattenCurrentParent);
    document.getElementById('recently-removed-button')?.addEventListener('click', openRecentlyRemoved);
    if (window.electron?.onOpenRecentlyRemoved) {
      window.electron.onOpenRecentlyRemoved(() => openRecentlyRemoved());
    }
    document.getElementById('purge-trash-button')?.addEventListener('click', async () => {
      const r = await window.electron.purgeTrash(30);
      toast(`Purged ${r?.purged ?? 0}`, 'success');
      openRecentlyRemoved();
    });
    document.getElementById('near-dup-run')?.addEventListener('click', runNearDupes);
    document.getElementById('near-dup-threshold')?.addEventListener('input', (e) => {
      const label = document.getElementById('near-dup-threshold-label');
      if (label) label.textContent = `${e.target.value}%`;
    });
    document.getElementById('dedup-not-duplicate')?.addEventListener('click', async () => {
      const hash = window._dedupActiveHash;
      if (!hash) { toast('Select a duplicate group first', 'warning'); return; }
      await markGroupNotDuplicate(hash);
    });
    document.getElementById('dedup-undo-not-duplicate')?.addEventListener('click', async () => {
      const hash = window._dedupActiveHash;
      if (!hash) { toast('Select an ignored group first', 'warning'); return; }
      await unmarkGroupNotDuplicate(hash);
    });
    document.getElementById('dedup-show-ignored')?.addEventListener('change', () => {
      if (typeof window.loadDuplicateFiles === 'function') window.loadDuplicateFiles(true, true);
    });
    document.getElementById('send-to-printer-confirm')?.addEventListener('click', (e) => {
      e.preventDefault();
      confirmSendToPrinter();
    });
    document.getElementById('save-settings')?.addEventListener('click', () => {
      savePathSettings().catch(() => {});
    });

    loadPathSettings().catch(() => {});
    checkMaintenance().catch(() => {});

    if (window.electron?.onLibrarySoftRemoved) {
      window.electron.onLibrarySoftRemoved((payload) => {
        const removed = payload?.removed || [];
        if (!removed.length) return;
        const label = removed.length === 1
          ? `Removed “${removed[0].fileName || removed[0].filePath}”`
          : `Removed ${removed.length} models`;
        const ids = removed.map((r) => r.id).filter(Boolean);
        if (typeof window.showUndoToast === 'function') {
          window.showUndoToast(label, async () => {
            for (const id of ids) {
              try { await window.electron.restoreModel(id); } catch (_) { /* ignore */ }
            }
            if (typeof window.performCombinedSearch === 'function') await window.performCombinedSearch();
            toast('Restored', 'success');
          }, 10000);
        } else {
          toast(`${label} (see Recently removed)`, 'info');
        }
      });
    }

    if (window.electron?.onContextAddToCollection) {
      window.electron.onContextAddToCollection(async (payload) => {
        const paths = payload?.filePaths || [];
        let ids = [];
        for (const p of paths) {
          const el = document.querySelector(`.file-item[data-filepath="${CSS.escape(p)}"]`);
          const id = Number(el?.dataset?.id);
          if (id > 0) ids.push(id);
        }
        if (ids.length < paths.length && window.electron.resolveModelIdsByPaths) {
          const resolved = await window.electron.resolveModelIdsByPaths(paths);
          ids = [...new Set([...(resolved || []).map(Number), ...ids])].filter((n) => n > 0);
        }
        if (!ids.length && window.CollectionsUI?.selectedModelIds) {
          ids = window.CollectionsUI.selectedModelIds();
        }
        if (!ids.length) {
          toast('Could not resolve selected models', 'warning');
          return;
        }
        await window.CollectionsUI?.promptAddToCollection?.(ids);
      });
    }
    if (window.electron?.onContextFindSimilar) {
      window.electron.onContextFindSimilar(async (payload) => {
        const path = (payload?.filePaths || [])[0];
        let id = Number(payload?.modelId);
        if (!id && path) {
          const el = document.querySelector(`.file-item[data-filepath="${CSS.escape(path)}"]`);
          id = Number(el?.dataset?.id);
        }
        if (!id && path && window.electron.getModelDetails) {
          try {
            const m = await window.electron.getModelDetails(path);
            id = Number(m?.id);
          } catch (_) { /* ignore */ }
        }
        if (!id) { toast('Open a model first', 'warning'); return; }
        window.currentModelId = id;
        window.currentModelPath = path || window.currentModelPath;
        await findSimilarForModel(id);
      });
    }

    if (window.electron?.onGcodeAttached) {
      window.electron.onGcodeAttached(async (payload) => {
        toast('G-code attached', 'success');
        const id = Number(payload?.modelId || window.currentModelId);
        if (id && Number(window.currentModelId) === id) {
          await loadSlicedFiles(id, window.currentModelPath);
        }
      });
    }
    if (window.electron?.onContextAttachGcode) {
      window.electron.onContextAttachGcode(async (payload) => {
        const modelPath = payload?.filePath;
        let id = 0;
        if (modelPath) {
          const el = document.querySelector(`.file-item[data-filepath="${CSS.escape(modelPath)}"]`);
          id = Number(el?.dataset?.id);
        }
        if (!id && window.electron.resolveModelIdsByPaths && modelPath) {
          const ids = await window.electron.resolveModelIdsByPaths([modelPath]);
          id = Number(ids?.[0]) || 0;
        }
        if (!id) { toast('Model not found', 'warning'); return; }
        const gcodePath = await pickGcodeViaInput();
        if (!gcodePath) return;
        const result = await window.electron.attachGcodeToModel({ modelId: id, filePath: gcodePath });
        if (!result?.ok) {
          toast(result?.reason || 'Could not attach G-code', 'error');
          return;
        }
        toast('G-code attached', 'success');
        if (Number(window.currentModelId) === id) await loadSlicedFiles(id, modelPath);
      });
    }

    document.addEventListener('click', (e) => {
      if (e.target.closest?.('.duplicate-group')) {
        setTimeout(updateDedupIgnoreButtons, 0);
      }
    });

    window.FeaturePanels = {
      formatPath,
      loadSlicedFiles,
      findSimilarForCurrent,
      findSimilarForModel,
      flattenCurrentParent,
      openRecentlyRemoved,
      checkMaintenance,
      markGroupNotDuplicate,
      unmarkGroupNotDuplicate,
      loadPathSettings,
      savePathSettings,
      openSendToPrinterDialog,
      attachGcodeForModel,
      updateDedupIgnoreButtons
    };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
