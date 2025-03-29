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


    // Load initial data
    const savedDirectoryPath = await window.electron.loadDirectory();
    if (savedDirectoryPath) {
      try {
        const models = await window.electron.getAllModels('date-desc', 0);
        if (models && models.length > 0) {
          fileGrid.classList.remove('hidden');
          await renderFiles(models);
          const viewLibMsg = document.getElementById("view-library-message");
          if (viewLibMsg) {
            viewLibMsg.style.display = "block";
            viewLibMsg.textContent = `Showing All ${models.length} Models`;
          }
        } else {
          welcomeDialog.showModal();
          const viewLibMsg = document.getElementById("view-library-message");
          if (viewLibMsg) {
            viewLibMsg.style.display = "none";
          }
        }
      } catch (error) {
        console.error('Error loading models:', error);
      }
    } else {
      welcomeDialog.showModal();
    }


  } catch (error) {
    console.error('Error showing welcome dialog:', error);
  }
}
