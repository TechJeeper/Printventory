/**
 * Custom accent helper only. Appearance is dark-only (no light/system modes).
 */
(function () {
  'use strict';

  function lightenHex(hex, amount) {
    const m = String(hex || '').trim().match(/^#?([0-9a-f]{6})$/i);
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    let r = (n >> 16) & 255;
    let g = (n >> 8) & 255;
    let b = n & 255;
    r = Math.min(255, Math.round(r + (255 - r) * amount));
    g = Math.min(255, Math.round(g + (255 - g) * amount));
    b = Math.min(255, Math.round(b + (255 - b) * amount));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  function applyCustomAccent(hex) {
    const color = String(hex || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return false;
    const root = document.documentElement;
    const hover = lightenHex(color, 0.18);
    root.style.setProperty('--primary-accent', color);
    root.style.setProperty('--primary-accent-hover', hover);
    root.style.setProperty('--accent-color', color);
    root.style.setProperty('--primary-gradient', color);
    root.style.setProperty('--primary-gradient-hover', hover);
    root.style.setProperty('--primary-shadow', color + '4d');
    root.style.setProperty('--primary-shadow-hover', color + '66');
    return true;
  }

  function forceDark() {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.documentElement.removeAttribute('data-theme-mode');
    document.documentElement.removeAttribute('data-appearance');
    if (document.body) {
      document.body.removeAttribute('data-appearance');
    }
  }

  forceDark();

  window.ThemeMode = {
    applyCustomAccent,
    forceDark
  };

  document.addEventListener('DOMContentLoaded', forceDark);
})();
