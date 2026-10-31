/**
 * Data-driven keyboard shortcuts + rebindable storage (settings key: keybindings JSON).
 */
(function () {
  'use strict';

  const DEFAULT_SHORTCUTS = [
    { id: 'focus-search', action: 'Focus search', defaultKeys: 'Mod+/' },
    { id: 'command-palette', action: 'Command palette', defaultKeys: 'Mod+K' },
    { id: 'scan-directory', action: 'Scan directory', defaultKeys: 'Mod+Shift+S' },
    { id: 'clear-filters', action: 'Clear all filters', defaultKeys: 'Mod+Shift+C' },
    { id: 'print-roulette', action: 'Print Roulette', defaultKeys: 'Mod+Shift+R' },
    { id: 'multi-edit', action: 'Toggle Multi-Edit mode', defaultKeys: 'Mod+E' },
    { id: 'select-all', action: 'Select all (filtered) models', defaultKeys: 'Mod+A' },
    { id: 'next-model', action: 'Next model (detail view)', defaultKeys: 'ArrowDown / J' },
    { id: 'prev-model', action: 'Previous model (detail view)', defaultKeys: 'ArrowUp / K' },
    { id: 'exit-multi-edit', action: 'Exit Multi-Edit mode', defaultKeys: 'Escape' },
    { id: 'grid-open', action: 'Open preview (grid)', defaultKeys: 'Enter' },
    { id: 'grid-delete', action: 'Remove selected (grid)', defaultKeys: 'Delete' },
    { id: 'grid-favorite', action: 'Toggle favorite (grid)', defaultKeys: 'F' },
    { id: 'grid-rating', action: 'Set rating 1–5 (grid)', defaultKeys: '1-5' },
    { id: 'grid-quicklook', action: 'Quick-look (grid)', defaultKeys: 'Space' },
    { id: 'notes-bold', action: 'Bold in notes', defaultKeys: 'Mod+B' },
    { id: 'notes-italic', action: 'Italic in notes', defaultKeys: 'Mod+I' },
    { id: 'show-shortcuts', action: 'Show this shortcuts dialog', defaultKeys: 'Mod+Shift+?' }
  ];

  /** @type {Record<string, string>} */
  let overrides = {};

  function parseKeybindings(raw) {
    // Keep in sync with shortcuts-lib.js (node tests)
    if (!raw) return {};
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out = {};
      Object.keys(parsed).forEach((k) => {
        if (typeof parsed[k] === 'string' && parsed[k].trim()) out[k] = parsed[k].trim();
      });
      return out;
    } catch (_) {
      return {};
    }
  }

  function getShortcuts() {
    return DEFAULT_SHORTCUTS.map((s) => ({
      id: s.id,
      action: s.action,
      defaultKeys: s.defaultKeys,
      keys: overrides[s.id] || s.defaultKeys
    }));
  }

  function formatKeysForDisplay(keys) {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '') ||
      (navigator.userAgentData && navigator.userAgentData.platform === 'macOS');
    return String(keys || '')
      .replace(/Mod/g, isMac ? '⌘' : 'Ctrl')
      .split(/\s*\/\s*/)
      .map((part) => part.split('+').map((k) => `<kbd>${escapeHtml(k.trim())}</kbd>`).join('+'))
      .join(' or ');
  }

  function escapeHtml(t) {
    return String(t)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderShortcutsDialog() {
    const list = document.querySelector('#keyboard-shortcuts-dialog .keyboard-shortcuts-list');
    if (!list) return;
    const items = getShortcuts();
    list.innerHTML = items.map((s) =>
      `<div class="shortcut-row" data-shortcut-id="${escapeHtml(s.id)}">` +
      `<span class="shortcut-action">${escapeHtml(s.action)}</span>` +
      `<span class="shortcut-keys">${formatKeysForDisplay(s.keys)}</span>` +
      `</div>`
    ).join('');
  }

  async function loadKeybindings() {
    try {
      if (window.electron && typeof window.electron.getSetting === 'function') {
        const raw = await window.electron.getSetting('keybindings');
        overrides = parseKeybindings(raw);
      }
    } catch (_) {
      overrides = {};
    }
    renderShortcutsDialog();
    return overrides;
  }

  async function setKeybinding(id, keys) {
    if (!id) return getShortcuts();
    if (!keys) delete overrides[id];
    else overrides[id] = String(keys);
    try {
      if (window.electron && typeof window.electron.saveSetting === 'function') {
        await window.electron.saveSetting('keybindings', JSON.stringify(overrides));
      }
    } catch (err) {
      console.warn('Failed to save keybindings', err);
    }
    renderShortcutsDialog();
    return getShortcuts();
  }

  function getBinding(id) {
    const s = DEFAULT_SHORTCUTS.find((x) => x.id === id);
    if (!s) return null;
    return overrides[id] || s.defaultKeys;
  }

  window.SHORTCUTS = DEFAULT_SHORTCUTS;
  window.Shortcuts = {
    DEFAULT_SHORTCUTS,
    getShortcuts,
    parseKeybindings,
    loadKeybindings,
    setKeybinding,
    getBinding,
    renderShortcutsDialog
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadKeybindings().catch(() => renderShortcutsDialog());
  });
})();
