'use strict';

const fs = require('fs');
const path = require('path');

/**
 * AppImage mounts are not owned by root, so chrome-sandbox cannot be mode 4755.
 * Chromium aborts at startup when that helper is present but not setuid.
 * Removing it lets the AppImage start; the desktop entry also passes --no-sandbox.
 */
function copySupportWebhook(context) {
  const src = path.join(__dirname, '..', 'support-webhook.json');
  if (!context || !context.appOutDir || !fs.existsSync(src)) {
    console.warn('[afterPack] support-webhook.json missing; Send Logs will be unconfigured');
    return;
  }
  const targets = [];
  const direct = path.join(context.appOutDir, 'resources');
  if (fs.existsSync(direct)) targets.push(direct);
  try {
    for (const name of fs.readdirSync(context.appOutDir)) {
      if (!name.endsWith('.app')) continue;
      const macResources = path.join(context.appOutDir, name, 'Contents', 'Resources');
      if (fs.existsSync(macResources)) targets.push(macResources);
    }
  } catch (_) {
    /* app output is not readable yet */
  }
  for (const dir of targets) {
    fs.copyFileSync(src, path.join(dir, 'support-webhook.json'));
    console.log('[afterPack] Bundled support webhook');
  }
}

module.exports = async function afterPackLinuxSandbox(context) {
  copySupportWebhook(context);
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
