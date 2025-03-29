// dialogs/aboutDialog.js

function setupAboutDialogHandler() {
  window.electron.onOpenAbout(async () => {
    const dialog = document.getElementById('about-dialog');

    if (!dialog) {
      console.error('About dialog element not found');
      return;
    }

    try {
      await initializeAboutDialog(); // assumes this function is already declared somewhere
      dialog.showModal();
    } catch (error) {
      console.error('Error showing about dialog:', error);
    }
  });

  const websiteLink = document.getElementById('website-link');
  if (websiteLink) {
    websiteLink.addEventListener('click', (e) => {
      e.preventDefault();
      window.electron.showItemInFolder('https://printventory.com');
    });
  }
}
