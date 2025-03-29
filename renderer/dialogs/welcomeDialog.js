// dialogs/welcomeDialog.js

async function showWelcomeDialogIfFirstRun() {
  try {
    const hasRunBefore = await window.electron.getSetting('hasRunBefore');
    const welcomeDialog = document.getElementById('welcome-message');

    if (!hasRunBefore && welcomeDialog) {
      welcomeDialog.showModal();
      await window.electron.saveSetting('hasRunBefore', 'true');
    }

    const dismissButton = document.getElementById('dismiss-welcome');
    if (dismissButton && welcomeDialog) {
      dismissButton.addEventListener('click', () => {
        welcomeDialog.close();
      });
    }
  } catch (error) {
    console.error('Error showing welcome dialog:', error);
  }
}
