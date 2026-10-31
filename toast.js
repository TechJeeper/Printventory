/**
 * Non-blocking toast notifications.
 */
(function () {
  const MAX_TOASTS = 5;
  let root = null;

  function ensureRoot() {
    if (root && document.body.contains(root)) return root;
    root = document.getElementById('pv-toast-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'pv-toast-root';
      root.className = 'pv-toast-root';
      root.setAttribute('aria-live', 'polite');
      document.body.appendChild(root);
    }
    return root;
  }

  function showToast(message, opts = {}) {
    const {
      type = 'info',
      duration = 4500,
      action = null
    } = opts;
    const host = ensureRoot();
    while (host.children.length >= MAX_TOASTS) {
      host.removeChild(host.firstChild);
    }
    const el = document.createElement('div');
    el.className = `pv-toast pv-toast-${type}`;
    el.setAttribute('role', 'status');

    const text = document.createElement('div');
    text.className = 'pv-toast-message';
    text.textContent = String(message || '');
    el.appendChild(text);

    if (action && action.label && typeof action.onClick === 'function') {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pv-toast-action';
      btn.textContent = action.label;
      btn.addEventListener('click', () => {
        action.onClick();
        dismiss();
      });
      el.appendChild(btn);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'pv-toast-close';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', dismiss);
    el.appendChild(close);

    let timer = null;
    function dismiss() {
      if (timer) clearTimeout(timer);
      el.classList.add('pv-toast-out');
      setTimeout(() => el.remove(), 200);
    }

    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add('pv-toast-in'));
    if (duration > 0) timer = setTimeout(dismiss, duration);
    return { dismiss, el };
  }

  function showUndoToast(message, onUndo, ms = 10000) {
    return showToast(message, {
      type: 'info',
      duration: ms,
      action: {
        label: 'Undo',
        onClick: () => {
          if (typeof onUndo === 'function') onUndo();
        }
      }
    });
  }

  window.showToast = showToast;
  window.showUndoToast = showUndoToast;
})();
