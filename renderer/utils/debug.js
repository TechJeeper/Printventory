// utils/debug.js

function debugLog(...args) {
  if (window.constants?.DEBUG) {
    console.log('[DEBUG]', ...args);
  }
}

function resetInputState(inputElement) {
  if (!inputElement) return;

  inputElement.disabled = false;
  inputElement.readOnly = false;
  inputElement.blur();

  setTimeout(() => {
    inputElement.focus();
    inputElement.click();

    setTimeout(() => {
      if (document.activeElement !== inputElement) {
        inputElement.focus();
        inputElement.click();
      }
    }, 100);
  }, 50);
}
