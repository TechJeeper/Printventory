const { test, expect, _electron: electron } = require('@playwright/test');
const { getElectronLaunchOptions, getTestDbPath, cleanTestArtifacts, acceptTerms } = require('./test-utils');

let app;
let window;

const dbPath = getTestDbPath();

test.describe('Application Launch', () => {
  test.beforeAll(async () => {
    cleanTestArtifacts();
    // Launch the Electron application
    app = await electron.launch(getElectronLaunchOptions());
    // Get the first window that opens
    window = await app.firstWindow();
    console.log('Window title:', await window.title());
    await window.waitForLoadState('domcontentloaded');
  });

  test('should launch the application and load the main screen', async () => {
    await acceptTerms(window);
    const scanButton = window.locator('button:has-text("Scan Directory")');
    await expect(scanButton).toBeVisible();

    // Take a screenshot of the main screen
    await window.screenshot({ path: 'test-results/main-screen.png' });
  });

  test.afterAll(async () => {
    // Close the application
    if (app) {
      await app.close();
    }
  });
});
