'use strict';

const fs = require('fs');
const path = require('path');

/**
 * AppImage mounts are not owned by root, so chrome-sandbox cannot be mode 4755.
 * Chromium aborts at startup when that helper is present but not setuid.
 * Removing it lets the AppImage start; the desktop entry also passes --no-sandbox.
 */
module.exports = async function afterPackLinuxSandbox(context) {
  if (!context || context.electronPlatformName !== 'linux') return;
  const sandboxPath = path.join(context.appOutDir, 'chrome-sandbox');
  try {
    if (fs.existsSync(sandboxPath)) {
      fs.unlinkSync(sandboxPath);
      console.log('[afterPack] Removed chrome-sandbox so the AppImage can start without a setuid helper');
    }
  } catch (error) {
    console.warn('[afterPack] Could not remove chrome-sandbox:', error.message);
  }
};
