// utils/dom.js

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


function forceDialogRefresh(dialog, input) {
  dialog.style.display = 'none';
  requestAnimationFrame(() => {
    dialog.style.display = '';
    resetInputState(input);
  });
}

function scrollToView(el) {
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function debounce(func, wait = 300) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}
