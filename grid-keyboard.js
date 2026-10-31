/**
 * Arrow-key grid navigation and quick actions.
 */
(function () {
  function gridItems() {
    return [...document.querySelectorAll('.model-item, .model-card, [data-model-id]')].filter((el) => {
      return el.offsetParent !== null;
    });
  }

  function currentIndex(items) {
    const active = document.activeElement;
    const idx = items.indexOf(active);
    if (idx >= 0) return idx;
    const selected = items.findIndex((el) => el.classList.contains('selected') || el.getAttribute('aria-selected') === 'true');
    return selected >= 0 ? selected : 0;
  }

  function columns() {
    const items = gridItems();
    if (items.length < 2) return 1;
    const top = items[0].getBoundingClientRect().top;
    let cols = 1;
    for (let i = 1; i < items.length; i++) {
      if (Math.abs(items[i].getBoundingClientRect().top - top) > 4) break;
      cols++;
    }
    return Math.max(1, cols);
  }

  function focusAt(items, index) {
    if (!items.length) return;
    const i = Math.max(0, Math.min(items.length - 1, index));
    const el = items[i];
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.focus({ preventScroll: false });
    el.scrollIntoView({ block: 'nearest' });
  }

  function modelIdFrom(el) {
    return el?.dataset?.modelId || el?.dataset?.id || el?.getAttribute('data-file-path');
  }

  document.addEventListener('keydown', async (e) => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return;
    if (document.getElementById('command-palette') && !document.getElementById('command-palette').hidden) return;

    const items = gridItems();
    if (!items.length) return;
    const cols = columns();
    let idx = currentIndex(items);

    if (['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowRight') idx += 1;
      if (e.key === 'ArrowLeft') idx -= 1;
      if (e.key === 'ArrowDown') idx += cols;
      if (e.key === 'ArrowUp') idx -= cols;
      focusAt(items, idx);
      return;
    }

    const el = items[currentIndex(items)];
    if (!el) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      el.click();
      return;
    }
    if (e.key === ' ' || e.code === 'Space') {
      e.preventDefault();
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (typeof window.deleteSelectedModels === 'function') {
        e.preventDefault();
        window.deleteSelectedModels();
      }
      return;
    }
    if (String(e.key).toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (typeof window.toggleFavoriteForElement === 'function') {
        window.toggleFavoriteForElement(el);
      } else if (window.electron?.setModelFavorite) {
        const id = modelIdFrom(el);
        if (id) window.electron.setModelFavorite(id, true);
      }
      return;
    }
    if (/^[1-5]$/.test(e.key) && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const rating = Number(e.key);
      if (typeof window.setRatingForElement === 'function') {
        window.setRatingForElement(el, rating);
      } else if (window.electron?.setModelRating) {
        const id = modelIdFrom(el);
        if (id) window.electron.setModelRating(id, rating);
      }
    }
  });
})();
