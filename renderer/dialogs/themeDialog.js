// dialogs/themeDialog.js

function setupThemeDialogHandler() {
  const dialog = document.getElementById('settings-dialog');
  const cancelBtn = document.getElementById('cancel-settings');
  const saveBtn = document.getElementById('save-settings');
  const colorInput = document.getElementById('model-background-color');

  window.electron.onOpenThemeSettings(() => {
    if (dialog) {
      dialog.showModal();
    }
  });

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      dialog?.close();
    });
  }

  if (saveBtn && colorInput) {
    saveBtn.addEventListener('click', async () => {
      const color = colorInput.value;
      document.documentElement.style.setProperty('--model-background-color', color);
      await window.electron.saveSetting('modelBackgroundColor', color);
      dialog?.close();
    });
  }

  // On page load, apply stored background color
  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const savedColor = await window.electron.getSetting('modelBackgroundColor');
      if (savedColor) {
        document.documentElement.style.setProperty('--model-background-color', savedColor);
        if (colorInput) {
          colorInput.value = savedColor;
        }
      }
    } catch (err) {
      console.error('Error applying saved background color:', err);
    }
  });
}
