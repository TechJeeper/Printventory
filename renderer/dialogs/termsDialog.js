// dialogs/termsDialog.js

async function checkTermsOfService() {
  try {
    let tosAccepted = await window.electron.getSetting('tosAcceptedDate');
    const termsDialog = document.getElementById('terms-of-service-dialog');
    const acceptButton = document.getElementById('accept-terms');
    const declineButton = document.getElementById('decline-terms');
    const closeButton = document.querySelector('#terms-of-service-dialog .close');

    if (!termsDialog || !acceptButton || !declineButton || !closeButton) {
      console.error('Terms of Service dialog elements not found');
      return false;
    }

    if (!tosAccepted) {
      termsDialog.showModal();

      return new Promise((resolve) => {
        acceptButton.addEventListener('click', async () => {
          await window.electron.saveSetting('tosAcceptedDate', new Date().toISOString());
          termsDialog.close();
          resolve(true);
        });

        declineButton.addEventListener('click', () => {
          window.electron.quitApp();
          resolve(false);
        });

        closeButton.addEventListener('click', () => {
          window.electron.quitApp();
          resolve(false);
        });
      });
    }

    return true;
  } catch (error) {
    console.error('Error checking Terms of Service:', error);
    return false;
  }
}
