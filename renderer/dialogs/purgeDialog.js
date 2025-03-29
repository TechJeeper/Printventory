// dialogs/purgeDialog.js

function setupPurgeDialogHandler() {
  const purgeDialog = document.getElementById('purge-models-dialog');
  const confirmButton = document.getElementById('confirm-purge-button');

  window.electron.onOpenPurgeModels(() => {
    if (purgeDialog) {
      purgeDialog.showModal();
    } else {
      console.error('Purge dialog not found');
    }
  });

  if (confirmButton) {
    confirmButton.addEventListener('click', async () => {
      try {
        const success = await window.electron.purgeModels();
        if (success) {
          const container = document.querySelector('.file-grid');
          if (container) container.innerHTML = '';

          await window.electron.showMessage('Success', 'All models have been purged from the database.');
          purgeDialog.close();

          // Reset filters and dropdowns
          document.getElementById('designer-select').value = '';
          document.getElementById('parent-select').value = '';
          document.getElementById('printed-select').value = 'all';
          document.getElementById('tag-filter').value = '';

          // Reload dropdowns
          await Promise.all([
            populateDesignerDropdown?.(),
            populateParentModelFilter?.(),
            populateTagFilter?.(),
            populateLicenseFilter?.()
          ]);

          await updateModelCounts?.(0);
        }
      } catch (error) {
        console.error('Error purging models:', error);
        await window.electron.showMessage('Error', 'Failed to purge models from the database.');
      }
    });
  }
}
