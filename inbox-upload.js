/**
 * Drag files/ZIPs onto the grid → configured Inbox folder + incremental scan.
 */
(function () {
  let overlay = null;

  function ensureOverlay() {
    if (overlay) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'inbox-drop-overlay';
    overlay.className = 'inbox-drop-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<div class="inbox-drop-message">Drop files to Inbox</div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  async function getInboxConfig() {
    const name = (await window.electron?.getSetting?.('inboxFolderName')) || 'Inbox';
    return { folderName: String(name || 'Inbox') };
  }

  async function readFileAsBase64(file) {
    const buf = await file.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  async function uploadFiles(fileList) {
    if (!window.electron?.uploadToInbox) {
      if (window.showToast) window.showToast('Inbox upload is not available in this build', { type: 'warning' });
      return;
    }
    const files = [];
    for (const file of fileList) {
      files.push({
        name: file.name,
        type: file.type,
        dataBase64: await readFileAsBase64(file)
      });
    }
    const result = await window.electron.uploadToInbox({ files });
    if (window.showToast) {
      window.showToast(
        result?.ok
          ? `Uploaded ${result.saved || files.length} file(s) to Inbox`
          : (result?.error || 'Upload failed'),
        { type: result?.ok ? 'success' : 'error' }
      );
    }
    if (result?.ok && typeof window.performCombinedSearch === 'function') {
      await window.performCombinedSearch();
    }
  }

  let depth = 0;
  function isFileDrag(e) {
    const types = e.dataTransfer && e.dataTransfer.types;
    return types && [...types].includes('Files');
  }

  window.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    // Prefer inbox overlay for file drops (empty-state handles folders separately)
    ensureOverlay();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth && overlay) overlay.hidden = true;
  });
  window.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    depth = 0;
    if (overlay) overlay.hidden = true;
    const files = e.dataTransfer?.files;
    if (!files || !files.length) return;
    // If only directories, let empty-state / OS handle scan
    const asFiles = [...files].filter((f) => f.type || /\.[a-z0-9]+$/i.test(f.name));
    if (!asFiles.length) return;
    e.preventDefault();
    e.stopPropagation();
    await uploadFiles(asFiles);
  }, true);

  window.InboxUpload = { uploadFiles, getInboxConfig };
})();
