'use strict';

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

function safePublicOrigin(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Helper bundle origin must be http or https');
  }
  if (url.username || url.password) {
    throw new Error('Helper bundle origin cannot include a username');
  }
  if (/[\s"'`$\\<>]/.test(url.origin)) {
    throw new Error('Helper bundle origin has unsupported characters');
  }
  return url.origin;
}

function originFromRequest(req) {
  const header = (name) => {
    if (req && typeof req.get === 'function') return req.get(name) || '';
    const headers = (req && req.headers) || {};
    const value = headers[name] || headers[name.toLowerCase()] || '';
    return Array.isArray(value) ? value[0] : value;
  };
  const forwardedProto = String(header('x-forwarded-proto')).split(',')[0].trim();
  const proto = forwardedProto || (req && req.protocol) || 'http';
  const host = String(header('x-forwarded-host') || header('host')).split(',')[0].trim();
  if (!host) throw new Error('Missing host');
  return safePublicOrigin(proto + '://' + host);
}

function bundleConfig(origin, insecure) {
  return {
    origins: [safePublicOrigin(origin)],
    tlsInsecure: Boolean(insecure),
    slicers: []
  };
}

function windowsInstaller() {
  return [
    '@echo off',
    'setlocal EnableExtensions',
    'cd /d "%~dp0"',
    'set "DEST=%LOCALAPPDATA%\\Printventory\\helper"',
    'mkdir "%DEST%" 2>nul',
    'copy /Y "%~dp0printventory-helper.js" "%DEST%\\" >nul',
    'copy /Y "%~dp0slicer-protocol.js" "%DEST%\\" >nul',
    'copy /Y "%~dp0slicer-launch.js" "%DEST%\\" >nul',
    'copy /Y "%~dp0helper-config.json" "%DEST%\\" >nul',
    'set "NODE="',
    'where node >nul 2>&1 && set "NODE=node"',
    'if defined NODE goto run_install',
    'echo Node.js was not found. Downloading the official LTS release...',
    'where curl.exe >nul 2>&1',
    'if errorlevel 1 (',
    '  echo curl.exe is required to download Node.js.',
    '  pause',
    '  exit /b 1',
    ')',
    'if /I "%PROCESSOR_ARCHITECTURE%"=="ARM64" (set "NODE_ARCH=win-arm64") else (set "NODE_ARCH=win-x64")',
    'set "SUMS=%TEMP%\\printventory-node-shasums.txt"',
    'set "NODE_ZIP=%TEMP%\\printventory-node.zip"',
    'set "NODE_TMP=%TEMP%\\printventory-node-unpack"',
    'curl.exe -fsSL -o "%SUMS%" https://nodejs.org/dist/latest-lts/SHASUMS256.txt',
    'if errorlevel 1 (',
    '  echo Could not reach https://nodejs.org',
    '  pause',
    '  exit /b 1',
    ')',
    'set "NODE_FILE="',
    'for /f "tokens=2" %%A in (\'findstr /E /C:"-%NODE_ARCH%.zip" "%SUMS%"\') do set "NODE_FILE=%%A"',
    'if not defined NODE_FILE (',
    '  echo Could not find a Node.js build for %NODE_ARCH%.',
    '  pause',
    '  exit /b 1',
    ')',
    'curl.exe -fsSL -o "%NODE_ZIP%" "https://nodejs.org/dist/latest-lts/%NODE_FILE%"',
    'if errorlevel 1 (',
    '  echo Node.js download failed.',
    '  pause',
    '  exit /b 1',
    ')',
    'if exist "%NODE_TMP%" rmdir /s /q "%NODE_TMP%"',
    'mkdir "%NODE_TMP%"',
    'tar -xf "%NODE_ZIP%" -C "%NODE_TMP%"',
    'if errorlevel 1 (',
    '  echo Could not unpack Node.js.',
    '  pause',
    '  exit /b 1',
    ')',
    'if exist "%DEST%\\node" rmdir /s /q "%DEST%\\node"',
    'for /d %%D in ("%NODE_TMP%\\node-*") do move "%%D" "%DEST%\\node" >nul',
    'set "NODE=%DEST%\\node\\node.exe"',
    'if not exist "%NODE%" (',
    '  echo Node.js did not unpack correctly.',
    '  pause',
    '  exit /b 1',
    ')',
    ':run_install',
    '"%NODE%" "%DEST%\\printventory-helper.js" install --from-bundle',
    'if errorlevel 1 (',
    '  echo Install failed.',
    '  pause',
    '  exit /b 1',
    ')',
    'echo Printventory helper installed. It will connect to the server that created this package.',
    'echo You can close this window.',
    'pause',
    ''
  ].join('\r\n');
}

function unixInstaller() {
  return [
    '#!/bin/bash',
    'cd "$(dirname "$0")" || exit 1',
    'export PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"',
    'finish() {',
    '  code="$1"',
    '  if [ "$code" -ne 0 ]; then',
    '    echo "Install failed."',
    '  else',
    '    echo "Printventory helper installed. It will connect to the server that created this package."',
    '  fi',
    '  if [ "$(uname)" = "Darwin" ] || [ "$code" -ne 0 ]; then',
    '    echo "Press Enter to close."',
    '    read -r _ || true',
    '  fi',
    '  exit "$code"',
    '}',
    'if [ "$(uname)" = "Darwin" ]; then',
    '  DEST="$HOME/Library/Application Support/Printventory/helper"',
    'else',
    '  DEST="${XDG_DATA_HOME:-$HOME/.local/share}/printventory/helper"',
    'fi',
    'mkdir -p "$DEST" || finish 1',
    'cp -f printventory-helper.js slicer-protocol.js slicer-launch.js helper-config.json "$DEST/" || finish 1',
    'NODE=""',
    'if command -v node >/dev/null 2>&1; then',
    '  NODE=$(command -v node)',
    'else',
    '  echo "Node.js was not found. Downloading the official LTS release..."',
    '  case "$(uname -s)-$(uname -m)" in',
    '    Darwin-arm64) NODE_TARGET=darwin-arm64 ;;',
    '    Darwin-x86_64) NODE_TARGET=darwin-x64 ;;',
    '    Linux-x86_64) NODE_TARGET=linux-x64 ;;',
    '    Linux-aarch64) NODE_TARGET=linux-arm64 ;;',
    '    *) echo "No Node.js build is published for $(uname -s) $(uname -m)."; finish 1 ;;',
    '  esac',
    '  SUMS=$(mktemp)',
    '  curl -fsSL -o "$SUMS" https://nodejs.org/dist/latest-lts/SHASUMS256.txt || finish 1',
    '  NODE_FILE=$(grep -- "-${NODE_TARGET}.tar.gz$" "$SUMS" | awk \'{print $2}\' | head -n 1)',
    '  rm -f "$SUMS"',
    '  if [ -z "$NODE_FILE" ]; then echo "Could not find a Node.js archive for $NODE_TARGET."; finish 1; fi',
    '  ARCHIVE=$(mktemp)',
    '  NODE_TMP=$(mktemp -d)',
    '  curl -fsSL -o "$ARCHIVE" "https://nodejs.org/dist/latest-lts/${NODE_FILE}" || finish 1',
    '  tar -xzf "$ARCHIVE" -C "$NODE_TMP" || finish 1',
    '  rm -f "$ARCHIVE"',
    '  rm -rf "$DEST/node"',
    '  mv "$NODE_TMP"/node-* "$DEST/node" || finish 1',
    '  rm -rf "$NODE_TMP"',
    '  NODE="$DEST/node/bin/node"',
    '  if [ ! -x "$NODE" ]; then echo "Node.js did not unpack correctly."; finish 1; fi',
    'fi',
    '"$NODE" "$DEST/printventory-helper.js" install --from-bundle || finish 1',
    'finish 0',
    ''
  ].join('\n');
}

function installReadme(origin) {
  return [
    'Printventory helper',
    '',
    'This package was built by ' + origin + ' and will connect only to that server.',
    '',
    'Windows: double-click install.cmd',
    'macOS: double-click install.command',
    'Linux: bash install.sh',
    '',
    'If Node.js is not already installed, the installer downloads the official LTS release from nodejs.org.',
    'After it finishes, add the slicer path in Printventory Slicer Settings.',
    ''
  ].join('\n');
}

async function buildHelperBundle({ appDir, origin, insecure }) {
  const config = bundleConfig(origin, insecure);
  const helperJs = fs.readFileSync(path.join(appDir, 'helper', 'printventory-helper.js'));
  const protocolJs = fs.readFileSync(path.join(appDir, 'slicer-protocol.js'));
  const launchJs = fs.readFileSync(path.join(appDir, 'slicer-launch.js'));
  const shell = unixInstaller();
  const zip = new JSZip();
  zip.file('printventory-helper.js', helperJs);
  zip.file('slicer-protocol.js', protocolJs);
  zip.file('slicer-launch.js', launchJs);
  zip.file('helper-config.json', JSON.stringify(config, null, 2) + '\n');
  zip.file('install.cmd', windowsInstaller());
  zip.file('install.sh', shell, { unixPermissions: 0o755 });
  zip.file('install.command', shell, { unixPermissions: 0o755 });
  zip.file('INSTALL.txt', installReadme(config.origins[0]));
  return zip.generateAsync({ type: 'nodebuffer', platform: 'UNIX' });
}

function registerHelperBundleRoute(expressApp, appDir) {
  expressApp.get('/api/helper/bundle', async (req, res) => {
    try {
      const origin = originFromRequest(req);
      const insecure = req.query.insecure === '1' || req.query.insecure === 'true';
      const body = await buildHelperBundle({ appDir, origin, insecure });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', 'attachment; filename="Printventory-Helper.zip"');
      res.send(body);
    } catch (error) {
      const message = error && error.message ? error.message : 'Could not build helper bundle';
      console.error('[Helper] Bundle failed:', message);
      res.status(400).type('text/plain').send(message);
    }
  });
}

module.exports = {
  safePublicOrigin,
  originFromRequest,
  bundleConfig,
  buildHelperBundle,
  registerHelperBundleRoute
};
