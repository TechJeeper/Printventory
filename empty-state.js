/**
 * In-grid empty state replacing the native "No models found" popup.
 */
(function () {
  function ensureEmptyState() {
    let el = document.getElementById('library-empty-state');
    if (el) return el;
    const grid = document.getElementById('model-grid')
      || document.querySelector('.model-grid')
      || document.querySelector('#models-container')
      || document.querySelector('.content')
      || document.body;
    el = document.createElement('div');
    el.id = 'library-empty-state';
    el.className = 'library-empty-state';
    el.hidden = true;
    el.innerHTML = `
      <div class="library-empty-inner">
        <h2>No models yet</h2>
        <p>Scan a folder of STL / 3MF files to build your library. You can also drop a folder onto this window.</p>
        <div class="library-empty-actions">
          <button type="button" class="primary" id="empty-scan-folder-btn">Scan a folder</button>
          <a href="https://printventory.com" target="_blank" rel="noopener" id="empty-sample-link">Sample library</a>
        </div>
        <p class="library-empty-hint">Tip: drag and drop a folder here to scan it.</p>
      </div>`;
    grid.appendChild(el);
    el.querySelector('#empty-scan-folder-btn')?.addEventListener('click', () => {
      if (typeof window.scanDirectory === 'function') window.scanDirectory();
      else if (document.getElementById('scan-button')) document.getElementById('scan-button').click();
      else if (window.electron?.loadDirectory) window.electron.loadDirectory();
    });
    return el;
  }

  function showLibraryEmptyState(show) {
    const el = ensureEmptyState();
    el.hidden = !show;
    if (show) {
      document.body.classList.add('library-is-empty');
    } else {
      document.body.classList.remove('library-is-empty');
    }
  }

  window.showLibraryEmptyState = showLibraryEmptyState;
  window.ensureLibraryEmptyState = ensureEmptyState;

  // Drag folder onto window to scan
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('folder-drag-over');
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('folder-drag-over');
  });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', async (e) => {
    dragDepth = 0;
    document.body.classList.remove('folder-drag-over');
    const files = e.dataTransfer && e.dataTransfer.files;
    if (!files || !files.length) return;
    // Folder drop: first entry may have path in Electron
    const first = files[0];
    const folderPath = first && (first.path || first.webkitRelativePath);
    if (folderPath && window.electron?.scanDirectory) {
      e.preventDefault();
      const dir = first.path ? requirePathDir(first.path) : null;
      if (dir) await window.electron.scanDirectory(dir);
    }
  });

  function requirePathDir(filePath) {
    try {
      const parts = String(filePath).split(/[/\\]/);
      parts.pop();
      return parts.join(filePath.includes('\\') ? '\\' : '/') || filePath;
    } catch (_) {
      return filePath;
    }
  }

  async function applyHidePrintStatusBadge() {
    try {
      const hide = await window.electron?.getSetting?.('hidePrintStatusBadge');
      document.body.classList.toggle('hide-print-status-badge', hide === '1' || hide === true || hide === 'true');
    } catch (_) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureEmptyState();
      applyHidePrintStatusBadge();
    });
  } else {
    ensureEmptyState();
    applyHidePrintStatusBadge();
  }
})();
