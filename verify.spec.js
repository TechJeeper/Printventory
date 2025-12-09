const { test, expect, _electron: electron } = require('@playwright/test');

let app;
let window;

// Function to delete the database file before each test run
const fs = require('fs');
const path = require('path');
const dbPath = path.join(__dirname, 'printventory.db'); // Adjust path if needed

test.describe('Application Launch', () => {
  test.beforeAll(async () => {
    // Delete the database file to ensure a clean state
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
    // Launch the Electron application
    app = await electron.launch({
      args: ['.'],
      executablePath: './node_modules/.bin/electron'
    });
    // Get the first window that opens
    window = await app.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test('should launch the application and load the main screen', async () => {
    // Wait for the "I Accept" button to be visible and click it
    const acceptButton = window.locator('button:has-text("I Accept")');
    await acceptButton.waitFor({ state: 'visible', timeout: 30000 });
    await acceptButton.click();

    // Wait for the "Scan Directory" button to be visible
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
