// utils/debug.js
function debugLog(...args) {
  console.log('Hello World...');
  if (window.constants?.DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}
