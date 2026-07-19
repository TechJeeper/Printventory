import { describe, expect, it } from 'vitest';
import { TestDriver } from 'testdriverai/vitest/hooks';

/**
 * Printventory — Electron DESKTOP build end-to-end test (TestDriver computer-use).
 *
 * Drives the REAL Electron GUI (`electron .`, i.e. `npm start`) — NOT server mode.
 *
 * There is no published prebuilt binary, so this test provisions the desktop
 * build from source INSIDE the TestDriver sandbox:
 *   1. get a Linux desktop VM
 *   2. clone the repo
 *   3. LEAN install — skip Puppeteer's Chromium download and the heavy
 *      `electron-builder install-app-deps` postinstall (which saturated the VM
 *      in earlier attempts); then rebuild ONLY the native module the app needs
 *      at boot (better-sqlite3) for Electron's ABI.
 *   4. launch `electron . --no-sandbox` with PRINTVENTORY_TEST_SCAN_PATH set so
 *      the Scan button skips the native folder-picker dialog and scans the
 *      bundled fixtures directly (tests/test-fixtures/scan-me/*.stl).
 *
 * Then it exercises core desktop flows:
 *   - the app window renders (library / sidebar)
 *   - scanning a directory catalogs models into the grid
 *   - search/filter narrows the grid
 *   - opening a model shows its metadata/detail view
 *
 * NOTE: This test was authored without a live sandbox to iterate against (the
 * interactive session credential was exhausted). It is expected to run in CI via
 * .github/workflows/testdriver-desktop.yml, which authenticates with the
 * TD_API_KEY repo secret. Element descriptions and the provisioning steps may
 * need a round of tuning on the first green run.
 */

const REPO_URL = 'https://github.com/TechJeeper/Printventory.git';
const APP_DIR = '/home/user/Printventory';
const SCAN_PATH = `${APP_DIR}/tests/test-fixtures/scan-me`;

describe('Printventory desktop (Electron) app', () => {
  it('scans a directory and browses the model library', async (context) => {
    const testdriver = TestDriver(context);

    // --- 1. Get a Linux desktop VM -----------------------------------------
    // Provision Chrome purely to spin up the desktop environment; we then launch
    // the Electron app ourselves and drive it. (We never use the browser.)
    await testdriver.provision.chrome({ url: 'about:blank' });

    // --- 2. Clone the repository -------------------------------------------
    await testdriver.exec(
      'sh',
      `rm -rf ${APP_DIR} && git clone --depth 1 ${REPO_URL} ${APP_DIR} && echo CLONE_OK`,
      180000,
    );

    // --- 3. Lean install ----------------------------------------------------
    // Skip Puppeteer's Chromium download and the electron-builder postinstall
    // native rebuild (both saturate the sandbox). Rely on prebuilt binaries.
    await testdriver.exec(
      'sh',
      [
        `cd ${APP_DIR}`,
        'export PUPPETEER_SKIP_DOWNLOAD=1',
        'export ELECTRON_CACHE=/home/user/.cache/electron',
        // --ignore-scripts avoids the heavy electron-builder install-app-deps
        'npm install --no-audit --no-fund --legacy-peer-deps --ignore-scripts',
        'echo INSTALL_OK',
      ].join(' && '),
      600000,
    );

    // --- 4. Rebuild ONLY better-sqlite3 for Electron's ABI ------------------
    // main.js require()s better-sqlite3 at top level, so it must match Electron's
    // Node ABI. Rebuilding a single module is far lighter than a full app-deps.
    await testdriver.exec(
      'sh',
      [
        `cd ${APP_DIR}`,
        'export PUPPETEER_SKIP_DOWNLOAD=1',
        'npx --yes @electron/rebuild -f -o better-sqlite3 || npx --yes electron-rebuild -f -w better-sqlite3',
        'echo REBUILD_OK',
      ].join(' && '),
      600000,
    );

    // --- 5. Launch the desktop build (npm start === electron .) -------------
    // PRINTVENTORY_TEST_SCAN_PATH makes the Scan button skip the native dialog
    // and scan the bundled fixtures. --no-sandbox is required for Electron in CI.
    await testdriver.exec(
      'sh',
      [
        `cd ${APP_DIR}`,
        'export DISPLAY=:0',
        `export PRINTVENTORY_TEST_SCAN_PATH="${SCAN_PATH}"`,
        'export ELECTRON_DISABLE_SANDBOX=1',
        // launch detached so exec returns while the GUI keeps running
        'nohup npx electron . --no-sandbox > /tmp/printventory.log 2>&1 &',
        'sleep 3 && echo LAUNCH_OK && tail -n 20 /tmp/printventory.log || true',
      ].join(' && '),
      120000,
    );

    // Give Electron time to spin up its window and load the renderer.
    await testdriver.wait(15000);
    await testdriver.focusApplication('Printventory');

    // --- 6. The app window renders -----------------------------------------
    const appVisible = await testdriver.assert(
      'The Printventory desktop application window is open and its model library / sidebar interface is visible',
    );
    expect(appVisible).toBeTruthy();

    // --- 7. Scan a directory to catalog models -----------------------------
    const scanButton = await testdriver.find(
      'the "Scan Directory" button in the sidebar/toolbar',
      { timeout: 30000 },
    );
    await scanButton.click();

    // Scanning + thumbnailing takes a moment; wait for models to appear.
    await testdriver.wait(20000);

    const modelsVisible = await testdriver.assert(
      'One or more 3D model cards/thumbnails are now shown in the main library grid',
    );
    expect(modelsVisible).toBeTruthy();

    // --- 8. Search / filter narrows the grid -------------------------------
    const searchInput = await testdriver.find(
      'the search / filter input box for filtering models by filename',
      { timeout: 20000 },
    );
    await searchInput.click();
    await testdriver.type('cube');
    await testdriver.wait(4000);

    const filtered = await testdriver.assert(
      'The library grid has filtered to show model(s) matching the search term "cube"',
    );
    expect(filtered).toBeTruthy();

    // Clear the search so we can open a model.
    await testdriver.pressKeys(['ctrl', 'a']);
    await testdriver.pressKeys(['backspace']);
    await testdriver.wait(3000);

    // --- 9. Open a model to view its metadata/detail -----------------------
    const firstModel = await testdriver.find(
      'the first 3D model card/thumbnail in the library grid',
      { timeout: 20000 },
    );
    await firstModel.click();
    await testdriver.wait(4000);

    const detailVisible = await testdriver.assert(
      'A model detail / metadata panel is visible showing information about the selected model (such as file name, designer, tags, notes, or a 3D preview)',
    );
    expect(detailVisible).toBeTruthy();
  });
});
