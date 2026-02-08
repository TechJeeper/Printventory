#!/usr/bin/env node

/**
 * Check and install macOS build dependencies required for electron-builder DMG creation
 * Specifically checks for gettext which is required by dmgbuild
 */

const { execSync } = require('child_process');
const os = require('os');

function checkGettext() {
  try {
    // Check if gettext is installed via Homebrew
    execSync('brew list gettext', { stdio: 'ignore' });
    console.log('✓ gettext is installed');
    return true;
  } catch (error) {
    return false;
  }
}

function checkHomebrew() {
  try {
    execSync('which brew', { stdio: 'ignore' });
    return true;
  } catch (error) {
    return false;
  }
}

function installGettext() {
  try {
    console.log('Installing gettext via Homebrew...');
    execSync('brew install gettext', { stdio: 'inherit' });
    console.log('✓ gettext installed successfully');
    return true;
  } catch (error) {
    console.error('✗ Failed to install gettext');
    return false;
  }
}

function main() {
  // Only run on macOS
  if (os.platform() !== 'darwin') {
    console.log('Skipping macOS dependency check (not running on macOS)');
    process.exit(0);
  }

  console.log('Checking macOS build dependencies...\n');

  if (!checkHomebrew()) {
    console.error('✗ Homebrew is not installed');
    console.error('\nPlease install Homebrew first:');
    console.error('  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
    console.error('\nThen run this script again or install gettext manually:');
    console.error('  brew install gettext');
    process.exit(1);
  }

  if (!checkGettext()) {
    console.log('✗ gettext is not installed');
    console.log('\ngettext is required for building DMG files on macOS.');
    console.log('Attempting to install...\n');
    
    if (!installGettext()) {
      console.error('\nPlease install gettext manually:');
      console.error('  brew install gettext');
      process.exit(1);
    }
  }

  console.log('\n✓ All macOS build dependencies are satisfied');
  process.exit(0);
}

main();
