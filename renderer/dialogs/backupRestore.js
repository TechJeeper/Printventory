// dialogs/backupRestore.js

function setupBackupRestoreDialog() {
  const dialog = document.getElementById('backup-restore-dialog');
  const backupButton = document.getElementById('backup-button');
  const restoreButton = document.getElementById('restore-button');
  const saveButton = document.getElementById('save-backup-restore');
  const cancelButton = document.getElementById('cancel-backup-restore');

  window.electron.onOpenBackupRestore(() => {
    dialog?.showModal();
  });

  if (backupButton) {
    backupButton.addEventListener('click', async () => {
      try {
        const success = await window.electron.backupDatabase();
        if (success) {
          await window.electron.showMessage('Success', 'Database backup created successfully');
        }
      } catch (error) {
        console.error('Backup error:', error);
        await window.electron.showMessage('Error', 'Failed to create database backup');
      }
    });
  }

  if (restoreButton) {
    restoreButton.addEventListener('click', async () => {
      try {
        const result = await window.electron.showMessage(
          'Confirm Restore',
          'Warning: Restoring from backup will replace all current data. This cannot be undone. Continue?',
          ['Yes', 'No']
        );
        if (result === 'Yes') {
          const success = await window.electron.restoreDatabase();
          if (success) {
            await window.electron.showMessage('Success', 'Database restored successfully. The application will now reload.');
            window.location.reload();
          }
        }
      } catch (error) {
        console.error('Restore error:', error);
        await window.electron.showMessage('Error', 'Failed to restore database');
      }
    });
  }

  if (saveButton) {
    saveButton.addEventListener('click', () => {
      dialog?.close();
    });
  }

  if (cancelButton) {
    cancelButton.addEventListener('click', () => {
      dialog?.close();
    });
  }
}
