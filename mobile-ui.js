/**
 * Server/Docker touch shell. Desktop Electron stays on the full layout.
 */
(function () {
  const PHONE = '(max-width: 700px)';
  const NARROW = '(max-width: 900px)';
  const WIDE = '(min-width: 701px) and (max-width: 1100px)';
  const DETAIL_IDS = ['model-details', 'bundle-details', 'multi-edit-panel'];
  const PROMOTED_TOOLS = new Set([
    'Filament Manager',
    'Printer Manager',
    'Parts Manager',
    'Tag Manager',
    'De-Dup',
    'Organize Library',
    'Print Roulette',
    'Scan Directory',
    'View Entire Library'
  ]);

  let applying = false;
  let detailsObserver = null;
  let chipObserver = null;
  let titleObserver = null;
  let viewObserver = null;
  let chromeObserver = null;
  let forcingWall = false;
  let layoutKey = '';
  let chipSig = '';
  let moreStack = [];

  function uaIsMobile() {
    return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(navigator.userAgent || '');
  }

  function coarseOrMobile() {
    return window.matchMedia('(pointer: coarse)').matches || uaIsMobile();
  }

  function wideTouch() {
    return window.matchMedia(WIDE).matches && coarseOrMobile();
  }

  function shouldUseMobileUi() {
    if (!document.body.classList.contains('server-mode')) return false;
    if (window.matchMedia(PHONE).matches) return true;
    if (uaIsMobile() && window.matchMedia(NARROW).matches) return true;
    return wideTouch();
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

  function measureChrome() {
    const bar = document.getElementById('mobile-app-bar');
    const nav = document.getElementById('mobile-bottom-nav');
    const on = document.body.classList.contains('mobile-ui');
    if (!on) {
      document.body.style.removeProperty('--mobile-bar-height');
      document.body.style.removeProperty('--mobile-nav-height');
      return;
    }
    const top = bar && !bar.hidden ? bar.offsetHeight : 0;
    const bottom = nav && !nav.hidden ? nav.offsetHeight : 0;
    document.body.style.setProperty('--mobile-bar-height', top + 'px');
    document.body.style.setProperty('--mobile-nav-height', bottom + 'px');
  }

  function syncOverlay() {
    const overlay = document.getElementById('mobile-ui-overlay');
    if (!overlay) return;
    const open = document.body.classList.contains('mobile-ui') && sheetOpen();
    overlay.classList.toggle('is-open', open);
    overlay.hidden = !open;
    document.body.classList.toggle('mobile-sheet-open', open);
    const more = document.getElementById('mobile-more-sheet');
    if (more) more.hidden = !document.body.classList.contains('mobile-menu-open');
    measureChrome();
  }

  function setNav(active) {
    document.querySelectorAll('#mobile-bottom-nav button[data-nav]').forEach((btn) => {
      const on = btn.dataset.nav === active;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-current', on ? 'page' : 'false');
    });
  }

  function openFilters() {
    hideDetails();
    closeFolderRail();
    document.body.classList.remove('mobile-menu-open');
    document.body.classList.add('mobile-sidebar-open');
    setNav('filters');
    syncOverlay();
  }

  function closeDrawers() {
    document.body.classList.remove('mobile-sidebar-open', 'mobile-menu-open');
    moreStack = [];
    syncOverlay();
  }

  function closeAllSheets() {
    closeDrawers();
    closeFolderRail();
    hideDetails();
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
      syncFavoriteButton();
      syncDetailsName();
      setTimeout(syncDetailsName, 80);
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
    const text = (src?.textContent || '').trim().replace(/\s+in view$/i, '');
    dest.textContent = text;
    dest.hidden = !text;
  }

  function syncContextTitle() {
    const title = document.getElementById('mobile-bar-title');
    if (!title) return;
    const dir = window.currentDirectoryFilter || '';
    if (!dir) {
      title.textContent = 'Library';
      return;
    }
    const selected = document.querySelector('#folder-rail-tree .folder-tree-row.is-selected .folder-tree-label');
    const label = (selected?.textContent || '').trim();
    title.textContent = label || String(dir).split(/[/\\]/).filter(Boolean).pop() || 'Folder';
  }

  function syncDetailsName() {
    const nameEl = document.getElementById('mobile-details-name');
    if (!nameEl) return;
    const name = (document.getElementById('model-name')?.value || '').trim();
    nameEl.textContent = name || 'Model';
  }

  function syncViewSwitch() {
    const activeBtn = document.querySelector('.view-button.active');
    if (
      !forcingWall &&
      document.body.classList.contains('mobile-ui') &&
      activeBtn?.dataset.view === 'detailed'
    ) {
      forcingWall = true;
      document.querySelector('.view-button[data-view="preview"]')?.click();
      forcingWall = false;
    }
    const active = document.querySelector('.view-button.active')?.dataset.view === 'list' ? 'list' : 'preview';
    document.querySelectorAll('[data-mobile-view]').forEach((btn) => {
      const on = btn.dataset.mobileView === active;
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function pillLabel(pill) {
    const clone = pill.cloneNode(true);
    clone.querySelectorAll('.filter-remove').forEach((el) => el.remove());
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function syncChips() {
    const dest = document.getElementById('mobile-filter-chips');
    const body = document.getElementById('current-filter-body');
    if (!dest || !body || !document.body.classList.contains('mobile-ui')) return;
    const pills = [...body.querySelectorAll('.filter-pill')];
    const sig = pills.map(pillLabel).join('|');
    if (sig === chipSig && dest.childElementCount === (pills.length ? pills.length + 1 : 0)) return;
    chipSig = sig;
    dest.replaceChildren();
    if (!pills.length) {
      dest.hidden = true;
      measureChrome();
      return;
    }
    pills.forEach((pill, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-chip';
      btn.textContent = pillLabel(pill);
      btn.addEventListener('click', () => {
        const live = document.querySelectorAll('#current-filter-body .filter-pill')[index];
        live?.querySelector('.filter-remove')?.click();
      });
      dest.appendChild(btn);
    });
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'mobile-chip mobile-chip-clear';
    clear.textContent = 'Clear';
    clear.addEventListener('click', () => {
      document.getElementById('clear-all-filters-button')?.click();
    });
    dest.appendChild(clear);
    dest.hidden = false;
    requestAnimationFrame(measureChrome);
  }

  function observeChromeData() {
    if (chipObserver) chipObserver.disconnect();
    const filterBody = document.getElementById('current-filter-body');
    if (filterBody) {
      chipObserver = new MutationObserver(syncChips);
      chipObserver.observe(filterBody, { childList: true, subtree: true, characterData: true });
    }
    if (titleObserver) titleObserver.disconnect();
    const railTree = document.getElementById('folder-rail-tree');
    if (railTree) {
      titleObserver = new MutationObserver(syncContextTitle);
      titleObserver.observe(railTree, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
    if (viewObserver) viewObserver.disconnect();
    const switcher = document.querySelector('.grid-view-selector');
    if (switcher) {
      viewObserver = new MutationObserver(syncViewSwitch);
      viewObserver.observe(switcher, { attributes: true, subtree: true, attributeFilter: ['class'] });
    }
    syncChips();
    syncContextTitle();
    syncViewSwitch();
  }

  async function syncFavoriteButton() {
    const btn = document.getElementById('mobile-details-favorite');
    const path = document.getElementById('path-tree-container')?.getAttribute('data-file-path') || '';
    if (!btn) return;
    if (!path || typeof window.electron?.getModel !== 'function') {
      btn.hidden = true;
      return;
    }
    btn.hidden = false;
    try {
      const model = await window.electron.getModel(path);
      const on = Boolean(model?.favorite);
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      btn.setAttribute('aria-label', on ? 'Favorited' : 'Favorite');
    } catch (_) {
      btn.hidden = true;
    }
  }

  async function toggleFavorite() {
    const path = document.getElementById('path-tree-container')?.getAttribute('data-file-path') || '';
    if (!path) return;
    const cardBtn = document.querySelector('.file-item.selected .model-favorite-btn, .parent-model-group.selected .model-favorite-btn');
    if (cardBtn) {
      cardBtn.click();
      setTimeout(syncFavoriteButton, 200);
      return;
    }
    if (typeof window.electron?.getModel !== 'function') return;
    const model = await window.electron.getModel(path);
    if (!model) return;
    const next = !model.favorite;
    if (typeof window.autoSaveModel === 'function') {
      await window.autoSaveModel('favorite', next, path);
    } else if (typeof window.electron.saveModel === 'function') {
      model.favorite = next;
      await window.electron.saveModel(model);
    }
    syncFavoriteButton();
  }

  function nudgePreviewView() {
    if (window.__printventoryMobileViewNudged) return;
    let tries = 0;
    const tick = setInterval(() => {
      const active = document.querySelector('.view-button.active');
      tries += 1;
      if (!active && tries <= 40) return;
      window.__printventoryMobileViewNudged = true;
      clearInterval(tick);
      if (active?.dataset.view === 'detailed') {
        document.querySelector('.view-button[data-view="preview"]')?.click();
      }
      syncViewSwitch();
    }, 250);
  }

  function menuItemLabel(el) {
    if (el.classList.contains('server-menu-item-has-submenu')) {
      return (el.querySelector('span')?.textContent || '').trim();
    }
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function findMenuAction(label) {
    const nodes = document.querySelectorAll('#server-menu-bar .server-menu-item, #server-menu-bar .server-menu-subitem');
    for (const el of nodes) {
      if (el.classList.contains('server-menu-item-has-submenu')) continue;
      if (menuItemLabel(el) === label) return el;
    }
    return null;
  }

  function activateMenuItem(el) {
    if (!el) return;
    closeAllSheets();
    el.click();
  }

  function runLabeledAction(label) {
    const el = findMenuAction(label);
    if (el) {
      activateMenuItem(el);
      return;
    }
    closeAllSheets();
    if (label === 'Filament Manager' && typeof window.openFilamentManager === 'function') window.openFilamentManager();
    else if (label === 'Printer Manager' && typeof window.openPrinterManagement === 'function') window.openPrinterManagement();
    else if (label === 'Parts Manager' && typeof window.openPartsStock === 'function') window.openPartsStock();
    else if (label === 'Tag Manager' && typeof window.openTagManager === 'function') window.openTagManager();
    else if (label === 'Filament Manager') document.getElementById('filament-button')?.click();
    else if (label === 'Tag Manager') document.getElementById('tag-button')?.click();
    else if (label === 'De-Dup') document.getElementById('dup-button')?.click();
    else if (label === 'Organize Library' && typeof window.openOrganizeLibrary === 'function') window.openOrganizeLibrary();
    else if (label === 'Print Roulette') document.getElementById('roulette-button')?.click();
    else if (label === 'Scan Directory') document.getElementById('scan-directory-button')?.click();
    else if (label === 'View Entire Library') document.getElementById('view-library-button')?.click();
  }

  function readMenuGroup(name) {
    const group = [...document.querySelectorAll('#server-menu-bar .server-menu-group')]
      .find((el) => (el.querySelector('.server-menu-button')?.textContent || '').trim() === name);
    if (!group) return [];
    const items = [];
    group.querySelectorAll(':scope > .server-menu-dropdown > .server-menu-item, :scope > .server-menu-dropdown > .server-menu-separator').forEach((el) => {
      if (el.classList.contains('server-menu-separator')) {
        items.push({ type: 'sep' });
        return;
      }
      if (el.classList.contains('server-menu-item-has-submenu')) {
        const children = [...el.querySelectorAll('.server-menu-subitem')].map((sub) => ({
          type: 'action',
          label: (sub.textContent || '').trim(),
          el: sub
        }));
        items.push({ type: 'drill', label: menuItemLabel(el), children });
        return;
      }
      items.push({ type: 'action', label: menuItemLabel(el), el });
    });
    return items;
  }

  function appendActionList(parent, items) {
    const list = document.createElement('div');
    list.className = 'mobile-more-list';
    let pendingSep = false;
    items.forEach((item) => {
      if (item.type === 'sep') {
        pendingSep = list.childElementCount > 0;
        return;
      }
      if (pendingSep) {
        const rule = document.createElement('div');
        rule.className = 'mobile-more-sep';
        list.appendChild(rule);
        pendingSep = false;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mobile-more-row';
      btn.textContent = item.label;
      if (item.type === 'drill') {
        btn.classList.add('has-children');
        btn.addEventListener('click', () => {
          moreStack.push({ title: item.label, items: item.children || [] });
          renderMore();
        });
      } else {
        btn.addEventListener('click', () => activateMenuItem(item.el));
      }
      list.appendChild(btn);
    });
    if (list.childElementCount) parent.appendChild(list);
    return list.childElementCount > 0;
  }

  function fillMoreSections() {
    const host = document.getElementById('mobile-more-sections');
    if (!host) return;
    host.replaceChildren();
    const sections = [
      { title: 'Tools', items: readMenuGroup('Tools').filter((item) => item.type !== 'action' || !PROMOTED_TOOLS.has(item.label)) },
      { title: 'Settings', items: readMenuGroup('Settings') },
      { title: 'Help', items: readMenuGroup('Help') }
    ];
    sections.forEach((section) => {
      const useful = section.items.some((item) => item.type !== 'sep');
      if (!useful) return;
      const block = document.createElement('section');
      block.className = 'mobile-more-section';
      const heading = document.createElement('h3');
      heading.textContent = section.title;
      block.appendChild(heading);
      appendActionList(block, section.items);
      host.appendChild(block);
    });
  }

  function renderMore() {
    const title = document.getElementById('mobile-more-title');
    const back = document.getElementById('mobile-more-back');
    const home = document.getElementById('mobile-more-home');
    const drill = document.getElementById('mobile-more-drill');
    const page = moreStack[moreStack.length - 1];
    if (!page) {
      if (title) title.textContent = 'More';
      if (back) back.hidden = true;
      if (home) home.hidden = false;
      if (drill) {
        drill.hidden = true;
        drill.replaceChildren();
      }
      fillMoreSections();
      return;
    }
    if (title) title.textContent = page.title;
    if (back) back.hidden = false;
    if (home) home.hidden = true;
    if (!drill) return;
    drill.hidden = false;
    drill.replaceChildren();
    appendActionList(drill, page.items);
  }

  function openMore() {
    moreStack = [];
    renderMore();
    hideDetails();
    closeFolderRail();
    document.body.classList.remove('mobile-sidebar-open');
    document.body.classList.add('mobile-menu-open');
    setNav('more');
    syncOverlay();
  }

  function bindSwipeDismiss(handle, onDismiss) {
    if (!handle || handle.dataset.swipeBound) return;
    handle.dataset.swipeBound = '1';
    let startY = 0;
    let startX = 0;
    let active = false;
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (e.target.closest('button, a, input, select, textarea')) return;
      active = true;
      startY = e.clientY;
      startX = e.clientX;
    });
    const end = (e) => {
      if (!active) return;
      active = false;
      const dy = e.clientY - startY;
      const dx = Math.abs(e.clientX - startX);
      if (dy > 64 && dy > dx) onDismiss();
    };
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', () => { active = false; });
  }

  function apply() {
    if (applying) return;
    applying = true;
    try {
      const on = shouldUseMobileUi();
      const wide = on && window.matchMedia(WIDE).matches;
      const landscape = window.matchMedia('(orientation: landscape)').matches;
      document.body.classList.toggle('mobile-ui', on);
      document.documentElement.classList.toggle('mobile-ui', on);
      document.body.classList.toggle('mobile-ui-wide', wide);
      document.documentElement.classList.toggle('mobile-ui-wide', wide);
      const bar = document.getElementById('mobile-app-bar');
      const nav = document.getElementById('mobile-bottom-nav');
      if (bar) bar.hidden = !on;
      if (nav) nav.hidden = !on;
      if (on) {
        document.body.style.paddingTop = '';
        nudgePreviewView();
        syncCount();
        syncDetailsClass();
        observeDetails();
        observeChromeData();
        measureChrome();
      } else {
        closeAllSheets();
        chipSig = '';
        if (detailsObserver) detailsObserver.disconnect();
        if (chipObserver) chipObserver.disconnect();
        if (document.documentElement.style.getPropertyValue('--sidebar-width').trim() === '0px') {
          document.documentElement.style.removeProperty('--sidebar-width');
        }
        if (document.documentElement.style.getPropertyValue('--folder-rail-width').trim() === '0px') {
          document.documentElement.style.removeProperty('--folder-rail-width');
        }
        if (document.body.classList.contains('server-mode')) document.body.style.paddingTop = '30px';
        measureChrome();
      }
      const key = `${on}:${wide}:${landscape}`;
      if (key !== layoutKey) {
        layoutKey = key;
        requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
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
      head.innerHTML = '<span class="mobile-sheet-grab" aria-hidden="true"></span><div class="mobile-drawer-titlebar"><strong>Filters</strong><button type="button" id="mobile-drawer-done">Done</button></div>';
      sidebar.insertBefore(head, sidebar.firstChild);
      head.querySelector('#mobile-drawer-done')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeAllSheets();
      });
      bindSwipeDismiss(head, closeAllSheets);
    }

    document.querySelectorAll('#model-details > h3, #bundle-details > h3, #multi-edit-panel > h3').forEach((head) => {
      bindSwipeDismiss(head, () => {
        hideDetails();
        syncOverlay();
      });
    });
    bindSwipeDismiss(document.getElementById('mobile-more-head'), closeAllSheets);
    bindSwipeDismiss(document.querySelector('.folder-rail-header'), closeAllSheets);

    document.getElementById('mobile-ui-overlay')?.addEventListener('click', closeAllSheets);
    document.querySelectorAll('[data-mobile-view]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector(`.view-button[data-view="${btn.dataset.mobileView}"]`)?.click();
        syncViewSwitch();
      });
    });
    document.getElementById('mobile-nav-library')?.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllSheets();
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
      hideDetails();
      document.body.classList.remove('mobile-sidebar-open', 'mobile-menu-open');
      if (wasOpen) closeFolderRail();
      else document.getElementById('folder-rail-toggle')?.click();
      setNav(wasOpen ? 'library' : 'folders');
      syncOverlay();
    });
    document.getElementById('mobile-nav-more')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (document.body.classList.contains('mobile-menu-open')) closeAllSheets();
      else openMore();
    });
    document.getElementById('mobile-more-close')?.addEventListener('click', (e) => {
      e.preventDefault();
      closeAllSheets();
    });
    document.getElementById('mobile-more-back')?.addEventListener('click', (e) => {
      e.preventDefault();
      moreStack.pop();
      renderMore();
    });
    document.querySelectorAll('#mobile-more-sheet [data-menu-label]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        runLabeledAction(btn.dataset.menuLabel || '');
      });
    });
    document.querySelectorAll('[data-mobile-close-details]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        hideDetails();
        syncOverlay();
      });
    });
    document.getElementById('mobile-details-open-preview')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const path = document.getElementById('path-tree-container')?.getAttribute('data-file-path');
      if (path && typeof window.openPreview === 'function') window.openPreview(path);
    });
    document.getElementById('mobile-details-favorite')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleFavorite();
    });
    document.getElementById('mobile-details-more')?.addEventListener('click', (e) => {
      e.preventDefault();
      const panel = document.getElementById('model-details');
      const btn = e.currentTarget;
      const open = panel?.classList.toggle('is-expanded');
      btn.textContent = open ? 'Less' : 'More details';
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.getElementById('model-name')?.addEventListener('input', syncDetailsName);
    document.getElementById('mobile-details-log-print')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      document.getElementById('log-print-button')?.click();
    });
    document.getElementById('mobile-bundle-open-preview')?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const record = document.getElementById('bundle-details')?._bundleRecord;
      if (record && typeof window.openBundlePreview === 'function') window.openBundlePreview(record);
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
        syncContextTitle();
        if (document.body.classList.contains('folder-rail-open')) setNav('folders');
      }).observe(rail, { attributes: true, attributeFilter: ['hidden', 'class'] });
    }
    if (chromeObserver) chromeObserver.disconnect();
    const bar = document.getElementById('mobile-app-bar');
    const nav = document.getElementById('mobile-bottom-nav');
    if (bar && nav && typeof ResizeObserver === 'function') {
      chromeObserver = new ResizeObserver(() => measureChrome());
      chromeObserver.observe(bar);
      chromeObserver.observe(nav);
    }
  }

  function start() {
    bindChrome();
    window.addEventListener('resize', apply);
    [PHONE, NARROW, WIDE, '(pointer: coarse)', '(orientation: landscape)'].forEach((query) => {
      window.matchMedia(query).addEventListener('change', apply);
    });
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
