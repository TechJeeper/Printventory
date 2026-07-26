// Modal progress overlay for thumbnail regeneration and missing-thumbnail generation.
// Exposed as window.ThumbnailProgress so renderer.js can drive it from any phase.
(function () {
  'use strict';

  let cancelHandler = null;
  let isCancelled = false;

  function el(id) {
    return document.getElementById(id);
  }

  function elements() {
    const overlay = el('thumbnail-progress-overlay');
    if (!overlay) return null;
    return {
      overlay,
      title: el('thumbnail-progress-title'),
      phase: el('thumbnail-progress-phase'),
      track: el('thumbnail-progress-track'),
      fill: el('thumbnail-progress-fill'),
      count: el('thumbnail-progress-count'),
      percent: el('thumbnail-progress-percent'),
      cancel: el('thumbnail-progress-cancel')
    };
  }

  function setCancelVisible(ui, visible) {
    if (!ui.cancel) return;
    ui.cancel.style.display = visible ? '' : 'none';
    ui.cancel.disabled = false;
    ui.cancel.textContent = 'Stop';
  }

  const ThumbnailProgress = {
    isVisible() {
      const ui = elements();
      return !!(ui && !ui.overlay.hidden);
    },

    wasCancelled() {
      return isCancelled;
    },

    // Opens the overlay (or retitles it if already open) without resetting progress
    // when the same operation moves between phases.
    show(options) {
      const ui = elements();
      if (!ui) return;
      const opts = options || {};
      const reopening = ui.overlay.hidden;

      if (reopening) {
        isCancelled = false;
        cancelHandler = null;
      }
      // A caller that opened the overlay for an earlier phase keeps its title.
      if (reopening && opts.title && ui.title) ui.title.textContent = opts.title;
      if (ui.phase) ui.phase.textContent = opts.phase || '';
      setCancelVisible(ui, opts.cancellable !== false);
      ui.overlay.hidden = false;

      if (typeof opts.total === 'number') {
        this.update(0, opts.total);
      } else {
        this.setIndeterminate(true);
      }
    },

    setPhase(text) {
      const ui = elements();
      if (ui && ui.phase) ui.phase.textContent = text || '';
    },

    setIndeterminate(indeterminate) {
      const ui = elements();
      if (!ui) return;
      ui.track.classList.toggle('tp-indeterminate', !!indeterminate);
      if (indeterminate) {
        ui.fill.style.width = '';
        if (ui.count) ui.count.textContent = '';
        if (ui.percent) ui.percent.textContent = '';
      }
    },

    update(done, total, detail) {
      const ui = elements();
      if (!ui) return;
      ui.track.classList.remove('tp-indeterminate');
      const safeTotal = total > 0 ? total : 0;
      const percent = safeTotal ? Math.min(100, Math.floor((done / safeTotal) * 100)) : 0;
      ui.fill.style.width = `${percent}%`;
      if (ui.count) ui.count.textContent = safeTotal ? `${Math.min(done, safeTotal)} / ${safeTotal}` : '';
      if (ui.percent) ui.percent.textContent = `${percent}%`;
      if (detail) this.setPhase(detail);
    },

    onCancel(handler) {
      cancelHandler = typeof handler === 'function' ? handler : null;
      const ui = elements();
      if (ui) setCancelVisible(ui, !!cancelHandler);
    },

    // Leaves the completion state on screen briefly so the user sees the result.
    complete(message, delayMs) {
      const ui = elements();
      if (!ui) return;
      if (message) this.setPhase(message);
      if (ui.cancel) ui.cancel.style.display = 'none';
      setTimeout(() => this.hide(), typeof delayMs === 'number' ? delayMs : 900);
    },

    hide() {
      const ui = elements();
      if (!ui) return;
      ui.overlay.hidden = true;
      ui.track.classList.remove('tp-indeterminate');
      ui.fill.style.width = '0%';
      cancelHandler = null;
      isCancelled = false;
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    const ui = elements();
    if (!ui || !ui.cancel) return;
    ui.cancel.addEventListener('click', () => {
      isCancelled = true;
      ui.cancel.disabled = true;
      ui.cancel.textContent = 'Stopping...';
      ThumbnailProgress.setPhase('Stopping...');
      if (cancelHandler) cancelHandler();
    });
  });

  window.ThumbnailProgress = ThumbnailProgress;
})();
