// utils/debug.js
function debugLog(...args) {
  if (window.constants?.DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}
