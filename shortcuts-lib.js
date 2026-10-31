'use strict';

/** Pure helpers for rebindable shortcuts (settings key: keybindings). */

function parseKeybindings(raw) {
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

module.exports = {
  parseKeybindings
};
