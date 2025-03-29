// dialogs/dialogHandlers.js

function initializeDialogHandlers() {
  // NEW DESIGNER
  document.querySelectorAll('.add-designer-button, #add-new-designer-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-designer-dialog');
      const input = document.getElementById('new-designer-name');
      dialog.querySelector('form').reset();
      input.value = '';
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-designer';
      dialog.showModal();
      forceDialogRefresh(dialog, input);
    });
  });

  // NEW PARENT
  document.querySelectorAll('.add-parent-button, #add-new-parent-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-parent-dialog');
      const input = document.getElementById('new-parent-name');
      dialog.querySelector('form').reset();
      input.value = '';
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-parent';
      dialog.showModal();
      forceDialogRefresh(dialog, input);
    });
  });

  // NEW LICENSE
  document.querySelectorAll('.add-license-button, #add-new-license-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-license-dialog');
      const input = document.getElementById('new-license-name');
      dialog.querySelector('form').reset();
      input.value = '';
      dialog.dataset.sourceDropdown = button.closest('.designer-input-container')?.querySelector('select')?.id || 'model-license';
      dialog.showModal();
      forceDialogRefresh(dialog, input);
    });
  });

  // NEW TAG
  document.querySelectorAll('.add-tag-button').forEach(button => {
    button.addEventListener('click', () => {
      const dialog = document.getElementById('new-tag-dialog');
      const input = document.getElementById('new-tag-name');
      dialog.querySelector('form').reset();
      input.value = '';
      dialog.dataset.sourceContainer = button.closest('.tags-container')?.querySelector('.tags-list')?.id || 'model-tags';
      dialog.showModal();
      forceDialogRefresh(dialog, input);
    });
  });
}

// Basic reset utility for focus handling
function forceDialogRefresh(dialog, input) {
  dialog.style.display = 'none';
  requestAnimationFrame(() => {
    dialog.style.display = '';
    input.disabled = false;
    input.readOnly = false;
    input.blur();
    setTimeout(() => {
      input.focus();
      input.click();
      setTimeout(() => {
        if (document.activeElement !== input) {
          input.focus();
          input.click();
        }
      }, 100);
    }, 50);
  });
}
