/**
 * Unified background Jobs manager (Tools → Jobs Manager).
 * No sidebar button — open via menu / Command Palette.
 */
(function () {
  const jobs = new Map();
  let popover = null;

  function ensurePopover() {
    if (popover && document.body.contains(popover)) return;
    popover = document.getElementById('jobs-panel-popover');
    if (!popover) {
      popover = document.createElement('div');
      popover.id = 'jobs-panel-popover';
      popover.className = 'jobs-panel-popover';
      popover.hidden = true;
      document.body.appendChild(popover);
    }
  }

  function renderPopover() {
    ensurePopover();
    const list = [...jobs.values()];
    if (!list.length) {
      popover.hidden = true;
      popover.innerHTML = '';
      return;
    }
    popover.innerHTML = '';
    for (const job of list) {
      const row = document.createElement('div');
      row.className = 'jobs-panel-row';
      const label = document.createElement('div');
      label.className = 'jobs-panel-label';
      label.textContent = job.label || job.id;
      const bar = document.createElement('div');
      bar.className = 'jobs-panel-bar';
      const fill = document.createElement('div');
      fill.className = 'jobs-panel-bar-fill';
      fill.style.width = `${Math.round(Math.max(0, Math.min(1, job.progress || 0)) * 100)}%`;
      bar.appendChild(fill);
      row.appendChild(label);
      row.appendChild(bar);
      if (typeof job.cancel === 'function') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.className = 'jobs-panel-cancel';
        cancel.onclick = () => job.cancel();
        row.appendChild(cancel);
      }
      popover.appendChild(row);
    }
  }

  function renderManager() {
    const host = document.getElementById('jobs-manager-list');
    if (!host) return;
    const list = [...jobs.values()];
    host.innerHTML = '';
    if (!list.length) {
      host.innerHTML = '<p class="jobs-manager-empty">No background jobs running.</p>';
      return;
    }
    for (const job of list) {
      const row = document.createElement('div');
      row.className = 'jobs-panel-row';
      row.innerHTML = `<div class="jobs-panel-label"></div><div class="jobs-panel-bar"><div class="jobs-panel-bar-fill"></div></div>`;
      row.querySelector('.jobs-panel-label').textContent = `${job.label || job.id} — ${Math.round((job.progress || 0) * 100)}%`;
      row.querySelector('.jobs-panel-bar-fill').style.width = `${Math.round(Math.max(0, Math.min(1, job.progress || 0)) * 100)}%`;
      if (typeof job.cancel === 'function') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Cancel';
        cancel.className = 'jobs-panel-cancel';
        cancel.onclick = () => job.cancel();
        row.appendChild(cancel);
      }
      host.appendChild(row);
    }
  }

  function render() {
    renderPopover();
    const dlg = document.getElementById('jobs-manager-dialog');
    if (dlg?.open) renderManager();
  }

  function registerJob({ id, label, progress = 0, cancel = null }) {
    if (!id) throw new Error('job id required');
    jobs.set(id, { id, label: label || id, progress, cancel });
    render();
    return id;
  }

  function updateJob(id, patch = {}) {
    const job = jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
    render();
  }

  function completeJob(id) {
    jobs.delete(id);
    render();
  }

  function openManager() {
    const dlg = document.getElementById('jobs-manager-dialog');
    if (!dlg) return;
    dlg.classList.remove('modal-fullscreen');
    if (typeof window.syncJobsManagerFullscreenButton === 'function') {
      window.syncJobsManagerFullscreenButton(false);
    }
    renderManager();
    dlg.showModal();
  }

  function wireBackgroundJobs() {
    if (!window.electron) return;
    if (window.electron.onScanProgress) {
      window.electron.onScanProgress((progress) => {
        const id = 'scan';
        const total = Number(progress?.total) || 0;
        const current = Number(progress?.current ?? progress?.processed) || 0;
        const done = progress?.done === true || progress?.complete === true || (total > 0 && current >= total);
        if (done) {
          completeJob(id);
          return;
        }
        if (!jobs.has(id)) registerJob({ id, label: progress?.phase || 'Scanning…', progress: 0 });
        updateJob(id, {
          label: progress?.message || progress?.phase || 'Scanning…',
          progress: total > 0 ? current / total : (Number(progress?.percent) || 0) / 100
        });
      });
    }
    if (window.electron.onHashGenerationProgress) {
      window.electron.onHashGenerationProgress((progress) => {
        const id = 'hash';
        const total = Number(progress?.total) || 0;
        const current = Number(progress?.current ?? progress?.processed) || 0;
        if (!jobs.has(id)) {
          registerJob({
            id,
            label: 'Generating hashes…',
            progress: 0,
            cancel: () => window.electron.cancelHashGeneration?.()
          });
        }
        updateJob(id, {
          label: `Hashes ${current}/${total || '?'}`,
          progress: total > 0 ? current / total : 0
        });
      });
    }
    if (window.electron.onHashGenerationComplete) {
      window.electron.onHashGenerationComplete(() => completeJob('hash'));
    }
    const onThumb = (progress) => {
      const id = 'thumbnails';
      const total = Number(progress?.total) || 0;
      const current = Number(progress?.current ?? progress?.processed) || 0;
      const done = progress?.done === true || progress?.complete === true || (total > 0 && current >= total);
      if (done) {
        completeJob(id);
        return;
      }
      if (!jobs.has(id)) registerJob({ id, label: 'Thumbnails…', progress: 0 });
      updateJob(id, {
        label: `Thumbnails ${current}/${total || '?'}`,
        progress: total > 0 ? current / total : 0
      });
    };
    if (typeof window.electron.on === 'function') {
      window.electron.on('thumbnail-job-progress', onThumb);
      window.electron.on('thumbnail-job-complete', () => completeJob('thumbnails'));
    }
    if (window.electron.onOpenJobsManager) {
      window.electron.onOpenJobsManager(() => openManager());
    }
    document.getElementById('jobs-manager-refresh')?.addEventListener('click', renderManager);
  }

  // Remove any leftover sidebar Jobs button from earlier builds
  function removeLegacyButton() {
    document.getElementById('jobs-panel-button')?.remove();
  }

  window.JobsPanel = {
    registerJob,
    updateJob,
    completeJob,
    openManager,
    list: () => [...jobs.values()]
  };

  function boot() {
    removeLegacyButton();
    ensurePopover();
    wireBackgroundJobs();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
