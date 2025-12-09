
const { _electron: electron } = require('playwright');
const path = require('path');

async function main() {
  const electronApp = await electron.launch({
    executablePath: path.join(__dirname, 'node_modules/electron/dist/electron'),
    args: ['.']
  });
  const window = await electronApp.firstWindow();

  await window.waitForSelector('button:has-text("I Accept")', { timeout: 30000 });
  await window.click('button:has-text("I Accept")');

  // Set up a handler for the file chooser dialog
  window.on('filechooser', async (fileChooser) => {
    await fileChooser.setFiles(path.join(__dirname, 'sample-models'));
  });

  // Click the "Scan Directory" button
  await window.click('button:has-text("Scan Directory")');

  // Wait for the grid to populate
  await window.waitForSelector('.file-item', { timeout: 30000 });

  await new Promise(resolve => setTimeout(resolve, 2000));

  await window.screenshot({ path: "/home/jules/verification/verification.png" });
  await electronApp.close();
}

main();
