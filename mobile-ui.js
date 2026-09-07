/**
 * Server/Docker phone layout. Observes only detail-panel class changes.
 */
(function () {
  const NARROW = '(max-width: 900px)';
  const DETAIL_IDS = ['model-details', 'bundle-details', 'multi-edit-panel'];
  let applying = false;
  let detailsObserver = null;

  function uaIsMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
  }

  function shouldUseMobileUi() {
    if (!document.body.classList.contains('server-mode')) return false;
    if (window.matchMedia('(max-width: 700px)').matches) return true;
    return uaIsMobile() && window.matchMedia(NARROW).matches;
  }

  function detailsAreOpen() {
    return DETAIL_IDS.some((id) => {
      const el = document.getElementById(id);
      return el && !el.classList.contains('hidden');
    });
  }

  function hideDetails() {
    DETAIL_IDS.forEach((id) => document.getElementById(id)?.classList.add('hidden'));
    document.body.classList.remove('mobile-details-open');
  }

  function closeFolderRail() {
    if (!document.body.classList.contains('folder-rail-open')) return;
    document.getElementById('folder-rail-close')?.click();
  }

  function sheetOpen() {
    return document.body.classList.contains('mobile-sidebar-open')
      || document.body.classList.contains('mobile-menu-open')
      || document.body.classList.contains('mobile-details-open')
      || document.body.classList.contains('folder-rail-open');
  }

  function syncOverlay() {
    const overlay = document.getElementById('mobile-ui-overlay');
    if (!overlay) return;
    const open = document.body.classList.contains('mobile-ui') && sheetOpen();
    overlay.classList.toggle('is-open', open);
    overlay.hidden = !open;
    document.body.classList.toggle('mobile-sheet-open', open);
    const burger = document.getElementById('mobile-menu-toggle');
    if (burger) burger.textContent = open ? '×' : '☰';
  }

  function setNav(active) {
    document.querySelectorAll('#mobile-bottom-nav button[data-nav]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.nav === active);
    });
  }

  function openFilters() {
    setSearchOpen(false);
    hideDetails();
    closeFolderRail();
    document.body.classList.remove('mobile-menu-open');
    document.body.classList.add('mobile-sidebar-open');
    setNav('filters');
    syncOverlay();
  }

  function closeDrawers() {
    document.body.classList.remove('mobile-sidebar-open', 'mobile-menu-open');
    syncOverlay();
  }

  function closeAllSheets() {
    closeDrawers();
    closeFolderRail();
    hideDetails();
    setSearchOpen(false);
    setNav('library');
    syncOverlay();
  }

  function setSearchOpen(on) {
    const bar = document.getElementById('mobile-search-bar');
    const toggle = document.getElementById('mobile-search-toggle');
    if (!bar) return;
    bar.hidden = !on;
    document.body.classList.toggle('mobile-search-open', !!on);
    if (toggle) toggle.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      const input = document.getElementById('mobile-search-input');
      const src = document.getElementById('search-filter-input');
      if (input && src && !input.value) input.value = src.value || '';
      setTimeout(() => input?.focus(), 50);
    }
  }

  function runMobileSearch(term) {
    const src = document.getElementById('search-filter-input');
    const go = document.getElementById('filter-search-button');
    if (src) {
      src.value = term;
      src.dispatchEvent(new Event('input', { bubbles: true }));
    }
    go?.click();
    setSearchOpen(false);
    closeDrawers();
    hideDetails();
    closeFolderRail();
    setNav('library');
    syncOverlay();
  }

  function syncDetailsClass() {
    if (!document.body.classList.contains('mobile-ui')) return;
    const open = detailsAreOpen();
    document.body.classList.toggle('mobile-details-open', open);
    if (open) {
      document.body.classList.remove('mobile-sidebar-open', 'mobile-menu-open');
      closeFolderRail();
      setNav('library');
    }
    syncOverlay();
  }

  function observeDetails() {
    if (detailsObserver) detailsObserver.disconnect();
    detailsObserver = new MutationObserver(syncDetailsClass);
    DETAIL_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) detailsObserver.observe(el, { attributes: true, attributeFilter: ['class'] });
    });
  }

  function syncCount() {
    const dest = document.getElementById('mobile-bar-count');
    const src = document.getElementById('view-count');
    if (!dest) return;
    const text = (src?.textContent || '').trim();
    dest.textContent = text;
    dest.hidden = !text;
  }

  function nudgePreviewView() {
    if (window.__printventoryMobileViewNudged) return;
    let tries = 0;
    const tick = setInterval(() => {
      const previewBtn = document.querySelector('.view-button[data-view="preview"]');
      tries += 1;
      if (previewBtn?.classList.contains('active')) {
        window.__printventoryMobileViewNudged = true;
        clearInterval(tick);
        return;
      }
      if (previewBtn) {
        window.__printventoryMobileViewNudged = true;
        previewBtn.click();
        clearInterval(tick);
        return;
      }
      if (tries > 40) clearInterval(tick);
    }, 250);
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      const on = shouldUseMobileUi();
      document.body.classList.toggle('mobile-ui', on);
      document.documentElement.classList.toggle('mobile-ui', on);
      const bar = document.getElementById('mobile-app-bar');
      const nav = document.getElementById('mobile-bottom-nav');
      if (bar) bar.hidden = !on;
      if (nav) nav.hidden = !on;
      if (on) {
        document.documentElement.style.setProperty('--sidebar-width', '0px');
        document.documentElement.style.setProperty('--folder-rail-width', '0px');
        nudgePreviewView();
        syncCount();
        syncDetailsClass();
        observeDetails();
      } else {
        closeAllSheets();
        setSearchOpen(false);
        const searchBar = document.getElementById('mobile-search-bar');
        if (searchBar) searchBar.hidden = true;
        if (detailsObserver) detailsObserver.disconnect();
      }
    } finally {
      applying = false;
    }
  }

  function bindChrome() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !document.getElementById('mobile-drawer-head')) {
      const head = document.createElement('div');
      head.id = 'mobile-drawer-head';
      head.innerHTML = '<strong>Filters</strong><button type="button" id="mobile-drawer-done">Done</button>';
      sidebar.insertBefore(head, sidebar.firstChild);
      head.querySelector('#mobile-drawer-done')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllSheets();
      });
    }
    document.getElementById('mobile-ui-overlay')?.addEventListener('click', closeAllSheets);
    document.getElementById('mobile-menu-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (sheetOpen()) closeAllSheets();
      else openFilters();
    });
    document.getElementById('mobile-search-toggle')?.addEventListener('click', (e) => {
      e.preventDefault();
      const bar = document.getElementById('mobile-search-bar');
      setSearchOpen(!!bar?.hidden);
    });
    document.getElementById('mobile-search-bar')?.addEventListener('submit', (e) => {
      e.preventDefault();
      runMobileSearch((document.getElementById('mobile-search-input')?.value || '').trim());
    });
    document.getElementById('mobile-nav-library')?.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllSheets();
      document.getElementById('view-library-button')?.click();
      setNav('library');
    });
    document.getElementById('mobile-nav-filters')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (document.body.classList.contains('mobile-sidebar-open')) closeAllSheets();
      else openFilters();
    });
    document.getElementById('mobile-nav-folders')?.addEventListener('click', (e) => {
      e.preventDefault();
      const wasOpen = document.body.classList.contains('folder-rail-open');
      setSearchOpen(false);
      hideDetails();
      document.body.classList.remove('mobile-sidebar-open', 'mobile-menu-open');
      if (wasOpen) closeFolderRail();
      else document.getElementById('folder-rail-toggle')?.click();
      setNav(wasOpen ? 'library' : 'folders');
      syncOverlay();
    });
    document.getElementById('mobile-nav-more')?.addEventListener('click', (e) => {
      e.preventDefault();
      const open = !document.body.classList.contains('mobile-menu-open');
      setSearchOpen(false);
      hideDetails();
      closeFolderRail();
      document.body.classList.remove('mobile-sidebar-open');
      document.body.classList.toggle('mobile-menu-open', open);
      setNav(open ? 'more' : 'library');
      syncOverlay();
    });
    document.querySelectorAll('[data-mobile-close-details]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        hideDetails();
        syncOverlay();
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('mobile-ui')) closeAllSheets();
    });

    const viewCount = document.getElementById('view-count');
    if (viewCount) {
      new MutationObserver(syncCount).observe(viewCount, { childList: true, characterData: true, subtree: true });
    }
    const rail = document.getElementById('folder-rail');
    if (rail) {
      new MutationObserver(() => {
        syncOverlay();
        if (document.body.classList.contains('folder-rail-open')) setNav('folders');
      }).observe(rail, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
  }

  function start() {
    bindChrome();
    window.addEventListener('resize', apply);
    const tick = setInterval(() => {
      if (document.body.classList.contains('server-mode')) {
        apply();
        clearInterval(tick);
      }
    }, 400);
    setTimeout(() => clearInterval(tick), 20000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
