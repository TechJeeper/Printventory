#!/usr/bin/env node
'use strict';

/**
 * Local helper for Send to Slicer in server and Docker mode.
 * Registers the printventory:// protocol and starts the slicer on this computer.
 *
 *   node printventory-helper.js install --origin http://your-server:5000
 *   node printventory-helper.js add-slicer --name "OrcaSlicer" --path /path/to/orca
 *   node printventory-helper.js status
 *   node printventory-helper.js uninstall
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, execFileSync } = require('child_process');

function loadCompanion(name) {
  const candidates = [
    path.join(__dirname, name),
    path.join(__dirname, '..', name)
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('Missing ' + name + '. Download it into the same folder as printventory-helper.js.');
}

const protocol = loadCompanion('slicer-protocol.js');
const { buildSlicerSpawnSpec, launchSlicerProcess } = loadCompanion('slicer-launch.js');

const DESKTOP_FILE = 'printventory-helper.desktop';
const MAC_APP_NAME = 'Printventory Helper.app';

function configDir() {
  if (process.env.PRINTVENTORY_HELPER_HOME) {
    return process.env.PRINTVENTORY_HELPER_HOME;
  }
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(base, 'Printventory');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Printventory');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'printventory');
}

function configPath() {
  return path.join(configDir(), 'helper-config.json');
}

function logPath() {
  return path.join(configDir(), 'helper.log');
}

function log(line) {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.appendFileSync(logPath(), new Date().toISOString() + ' ' + line + '\n');
  } catch (error) {
    // Logging must not block the slicer launch.
  }
}

function loadConfig() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    return {
      origins: Array.isArray(parsed.origins) ? parsed.origins : [],
      tlsInsecure: Boolean(parsed.tlsInsecure),
      slicers: Array.isArray(parsed.slicers) ? parsed.slicers : []
    };
  } catch (error) {
    return { origins: [], tlsInsecure: false, slicers: [] };
  }
}

function saveConfig(config) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(config, null, 2) + '\n');
}

function helperScriptPath() {
  return path.resolve(__dirname, 'printventory-helper.js');
}

function notifyError(message) {
  log('ERROR ' + message);
  const title = 'Printventory Helper';
  try {
    if (process.platform === 'darwin') {
      const child = spawn('osascript', [
        '-e',
        'display alert ' + JSON.stringify(title) + ' message ' + JSON.stringify(message)
      ], { detached: true, stdio: 'ignore' });
      child.unref();
    } else if (process.platform === 'win32') {
      const safe = String(message).replace(/'/g, "''");
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-STA',
        '-Command',
        "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('" + safe + "','" + title + "')"
      ], { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
    } else {
      const child = spawn('notify-send', [title, message], { detached: true, stdio: 'ignore' });
      child.on('error', () => {});
      child.unref();
    }
  } catch (error) {
    log('notify failed ' + error.message);
  }
}

function normalizeOrigin(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Origin must start with http:// or https://');
  }
  return url.origin;
}

function upsertSlicer(config, slicer) {
  const name = String(slicer.name || '').trim();
  const slicerPath = protocol.assertSafeSlicerPath(slicer.path);
  if (!name) throw new Error('Slicer name is empty');
  const next = (config.slicers || []).filter((entry) => String(entry.name || '').toLowerCase() !== name.toLowerCase());
  next.push({ name, path: slicerPath });
  config.slicers = next;
}

function linuxDesktopPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'applications', DESKTOP_FILE);
}

function macAppPath() {
  return path.join(os.homedir(), 'Applications', MAC_APP_NAME);
}

function assertQuotable(value, label) {
  if (String(value).includes('"')) {
    throw new Error(label + ' contains a quote and cannot be registered');
  }
}

function registerWindows() {
  const nodeBin = process.execPath;
  const script = helperScriptPath();
  assertQuotable(nodeBin, 'Node');
  assertQuotable(script, 'Helper script');
  const command = '"' + nodeBin + '" "' + script + '" "%1"';
  execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\printventory', '/ve', '/d', 'URL:Printventory Protocol', '/f'], { stdio: 'inherit' });
  execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\printventory', '/v', 'URL Protocol', '/d', '', '/f'], { stdio: 'inherit' });
  execFileSync('reg', ['add', 'HKCU\\Software\\Classes\\printventory\\shell\\open\\command', '/ve', '/d', command, '/f'], { stdio: 'inherit' });
}

function unregisterWindows() {
  try {
    execFileSync('reg', ['delete', 'HKCU\\Software\\Classes\\printventory', '/f'], { stdio: 'ignore' });
  } catch (error) {
    // Already gone.
  }
}

function registerMac() {
  const nodeBin = process.execPath;
  const script = helperScriptPath();
  assertQuotable(nodeBin, 'Node');
  assertQuotable(script, 'Helper script');
  const appPath = macAppPath();
  fs.rmSync(appPath, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(appPath), { recursive: true });
  const source = [
    'on open location thisURL',
    '  do shell script quoted form of "' + nodeBin + '" & " " & quoted form of "' + script + '" & " " & quoted form of thisURL',
    'end open location',
    ''
  ].join('\n');
  const sourcePath = path.join(os.tmpdir(), 'printventory-helper-handler.applescript');
  fs.writeFileSync(sourcePath, source);
  execFileSync('osacompile', ['-o', appPath, sourcePath], { stdio: 'inherit' });
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  let plist = fs.readFileSync(plistPath, 'utf8');
  if (!plist.includes('CFBundleURLTypes')) {
    const block = [
      '  <key>CFBundleURLTypes</key>',
      '  <array>',
      '    <dict>',
      '      <key>CFBundleURLName</key>',
      '      <string>Printventory Helper</string>',
      '      <key>CFBundleURLSchemes</key>',
      '      <array>',
      '        <string>printventory</string>',
      '      </array>',
      '    </dict>',
      '  </array>'
    ].join('\n');
    plist = plist.replace('</dict>\n</plist>', block + '\n</dict>\n</plist>');
    fs.writeFileSync(plistPath, plist);
  }
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  execFileSync(lsregister, ['-f', appPath], { stdio: 'inherit' });
}

function unregisterMac() {
  const appPath = macAppPath();
  const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
  try {
    if (fs.existsSync(appPath)) execFileSync(lsregister, ['-u', appPath], { stdio: 'ignore' });
  } catch (error) {
    // Launch Services may already have dropped the app.
  }
  fs.rmSync(appPath, { recursive: true, force: true });
}

function registerLinux() {
  const nodeBin = process.execPath;
  const script = helperScriptPath();
  assertQuotable(nodeBin, 'Node');
  assertQuotable(script, 'Helper script');
  const desktopPath = linuxDesktopPath();
  fs.mkdirSync(path.dirname(desktopPath), { recursive: true });
  const contents = [
    '[Desktop Entry]',
    'Name=Printventory Helper',
    'Comment=Open Printventory models in a local slicer',
    'Exec="' + nodeBin + '" "' + script + '" %u',
    'Type=Application',
    'Terminal=false',
    'NoDisplay=true',
    'MimeType=x-scheme-handler/printventory;',
    ''
  ].join('\n');
  fs.writeFileSync(desktopPath, contents);
  try {
    execFileSync('update-desktop-database', [path.dirname(desktopPath)], { stdio: 'ignore' });
  } catch (error) {
    // Optional on some desktops.
  }
  try {
    execFileSync('xdg-mime', ['default', DESKTOP_FILE, 'x-scheme-handler/printventory'], { stdio: 'inherit' });
  } catch (error) {
    console.error('Could not set the default handler. Register ' + desktopPath + ' for x-scheme-handler/printventory.');
    throw error;
  }
}

function unregisterLinux() {
  const desktopPath = linuxDesktopPath();
  fs.rmSync(desktopPath, { force: true });
  try {
    execFileSync('update-desktop-database', [path.dirname(desktopPath)], { stdio: 'ignore' });
  } catch (error) {
    // Optional.
  }
}

function registerProtocol() {
  if (process.platform === 'win32') registerWindows();
  else if (process.platform === 'darwin') registerMac();
  else if (process.platform === 'linux') registerLinux();
  else throw new Error('Unsupported platform: ' + process.platform);
}

function unregisterProtocol() {
  if (process.platform === 'win32') unregisterWindows();
  else if (process.platform === 'darwin') unregisterMac();
  else if (process.platform === 'linux') unregisterLinux();
}

function protocolInstalled() {
  if (process.platform === 'win32') {
    try {
      execFileSync('reg', ['query', 'HKCU\\Software\\Classes\\printventory\\shell\\open\\command'], { stdio: 'ignore' });
      return true;
    } catch (error) {
      return false;
    }
  }
  if (process.platform === 'darwin') return fs.existsSync(macAppPath());
  return fs.existsSync(linuxDesktopPath());
}

function fileNameFromModelPath(filePath, index) {
  const entry = String(filePath).includes('::') ? String(filePath).split('::').pop() : String(filePath);
  const base = entry.split(/[/\\]/).pop() || ('model-' + index);
  const cleaned = base.replace(/[<>:"|?*\u0000-\u001f]/g, '_');
  return String(index + 1) + '-' + cleaned;
}

function downloadFile(urlString, destPath, { tlsInsecure, allowedOrigin, redirectsLeft }) {
  const remaining = redirectsLeft == null ? 3 : redirectsLeft;
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(urlString);
    } catch (error) {
      reject(error);
      return;
    }
    if (url.origin !== allowedOrigin) {
      reject(new Error('Refusing to download from ' + url.origin));
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      reject(new Error('Unsupported download URL'));
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      rejectUnauthorized: !tlsInsecure,
      headers: { 'User-Agent': 'PrintventoryHelper' }
    }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        if (remaining <= 0) {
          reject(new Error('Too many redirects downloading ' + urlString));
          return;
        }
        const next = new URL(res.headers.location, url).toString();
        downloadFile(next, destPath, { tlsInsecure, allowedOrigin, redirectsLeft: remaining - 1 }).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        res.resume();
        reject(new Error('Download failed (' + status + ') for ' + urlString));
        return;
      }
      const out = fs.createWriteStream(destPath);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(destPath)));
      out.on('error', reject);
    });
    req.on('error', reject);
  });
}

function sweepOldDownloads(root) {
  let names = [];
  try {
    names = fs.readdirSync(root);
  } catch (error) {
    return;
  }
  const cutoff = Date.now() - (24 * 60 * 60 * 1000);
  names.forEach((name) => {
    const full = path.join(root, name);
    try {
      const stat = fs.statSync(full);
      if (stat.mtimeMs < cutoff) fs.rmSync(full, { recursive: true, force: true });
    } catch (error) {
      // Leave files the slicer may still have open.
    }
  });
}

function launchSlicer(slicerPath, modelPaths, slicerName) {
  const spec = buildSlicerSpawnSpec(slicerPath, modelPaths);
  log('launch ' + spec.command + ' ' + spec.args.join(' '));
  return launchSlicerProcess(spec, { name: slicerName, slicerPath });
}

async function handleUrl(rawUrl) {
  const request = protocol.parsePrintventoryProtocolUrl(rawUrl);
  const config = loadConfig();
  const origin = protocol.assertOriginAllowed(config.origins, request.origin);
  const slicer = protocol.resolveHelperSlicer(config.slicers, request);
  const downloadRoot = path.join(os.tmpdir(), 'printventory-slicer');
  fs.mkdirSync(downloadRoot, { recursive: true });
  sweepOldDownloads(downloadRoot);
  const jobDir = path.join(downloadRoot, String(Date.now()));
  fs.mkdirSync(jobDir, { recursive: true });

  const localPaths = [];
  for (let i = 0; i < request.filePaths.length; i++) {
    const filePath = request.filePaths[i];
    const dest = path.join(jobDir, fileNameFromModelPath(filePath, i));
    const downloadUrl = protocol.buildModelDownloadUrl(origin, filePath);
    log('download ' + downloadUrl);
    await downloadFile(downloadUrl, dest, { tlsInsecure: config.tlsInsecure, allowedOrigin: origin });
    localPaths.push(dest);
  }
  await launchSlicer(slicer.path, localPaths, slicer.name);
  log('opened ' + localPaths.length + ' file(s) in ' + slicer.name);
}

function printHelp() {
  console.log([
    'Printventory helper — send library models to a slicer on this computer.',
    '',
    '  node printventory-helper.js install --origin http://host:5000 [--insecure]',
    '  node printventory-helper.js add-slicer --name "OrcaSlicer" --path /path/to/slicer',
    '  node printventory-helper.js status',
    '  node printventory-helper.js uninstall',
    '',
    'From the Printventory web UI, use Slicer Settings to download a helper package for this server.',
    'Use --insecure when the server certificate is self-signed.',
    'Slicer paths saved in Printventory are used unless this computer has a slicer of the same name.'
  ].join('\n'));
}

function parseCli(argv) {
  const args = argv.slice(2);
  const parsed = {
    command: '',
    origins: [],
    insecure: false,
    fromBundle: false,
    slicers: [],
    name: '',
    slicerPath: '',
    url: ''
  };
  if (!args.length) return parsed;
  if (/^printventory:/i.test(args[0])) {
    parsed.command = 'open';
    parsed.url = args[0];
    return parsed;
  }
  parsed.command = args[0];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--insecure') {
      parsed.insecure = true;
    } else if (arg === '--from-bundle') {
      parsed.fromBundle = true;
    } else if (arg === '--origin') {
      parsed.origins.push(args[++i]);
    } else if (arg === '--name') {
      parsed.name = args[++i] || '';
    } else if (arg === '--path') {
      parsed.slicerPath = args[++i] || '';
    } else if (arg === '--slicer') {
      const raw = args[++i] || '';
      const eq = raw.indexOf('=');
      if (eq <= 0) throw new Error('--slicer expects Name=/path/to/slicer');
      parsed.slicers.push({ name: raw.slice(0, eq), path: raw.slice(eq + 1) });
    } else if (/^printventory:/i.test(arg)) {
      parsed.url = arg;
    } else {
      throw new Error('Unknown argument: ' + arg);
    }
  }
  return parsed;
}

function readBundledConfig() {
  const bundledPath = path.join(__dirname, 'helper-config.json');
  if (!fs.existsSync(bundledPath)) {
    throw new Error('helper-config.json was not found next to the helper. Unzip the download and run the installer from that folder.');
  }
  const parsed = JSON.parse(fs.readFileSync(bundledPath, 'utf8'));
  return {
    origins: Array.isArray(parsed.origins) ? parsed.origins : [],
    tlsInsecure: Boolean(parsed.tlsInsecure),
    slicers: Array.isArray(parsed.slicers) ? parsed.slicers : []
  };
}

function install(parsed) {
  const config = loadConfig();
  const bundled = parsed.fromBundle ? readBundledConfig() : null;
  const origins = parsed.origins.concat(bundled ? bundled.origins : []);
  origins.forEach((origin) => {
    const normalized = normalizeOrigin(origin);
    if (!config.origins.includes(normalized)) config.origins.push(normalized);
  });
  if (bundled && bundled.tlsInsecure) config.tlsInsecure = true;
  if (bundled) bundled.slicers.forEach((slicer) => upsertSlicer(config, slicer));
  if (!config.origins.length) {
    throw new Error('Pass --origin http://your-server:5000 (the address you use in the browser)');
  }
  if (parsed.insecure) config.tlsInsecure = true;
  parsed.slicers.forEach((slicer) => upsertSlicer(config, slicer));
  saveConfig(config);
  registerProtocol();
  console.log('Registered printventory://');
  console.log('Allowed servers: ' + config.origins.join(', '));
  if (config.tlsInsecure) console.log('TLS certificate checks are off for this helper.');
  console.log('Config: ' + configPath());
}

function addSlicer(parsed) {
  const config = loadConfig();
  upsertSlicer(config, { name: parsed.name, path: parsed.slicerPath });
  saveConfig(config);
  console.log('Saved slicer "' + parsed.name + '"');
  console.log('Config: ' + configPath());
}

function status() {
  const config = loadConfig();
  console.log('Platform: ' + process.platform);
  console.log('Protocol registered: ' + (protocolInstalled() ? 'yes' : 'no'));
  console.log('Config: ' + configPath());
  console.log('Allowed servers: ' + (config.origins.join(', ') || '(none)'));
  console.log('Ignore TLS errors: ' + (config.tlsInsecure ? 'yes' : 'no'));
  if (!config.slicers.length) {
    console.log('Local slicers: (none — Printventory settings paths are used)');
  } else {
    config.slicers.forEach((slicer) => {
      console.log('Local slicer: ' + slicer.name + ' -> ' + slicer.path);
    });
  }
}

async function main(argv) {
  const parsed = parseCli(argv || process.argv);
  if (!parsed.command || parsed.command === 'help' || parsed.command === '--help' || parsed.command === '-h') {
    printHelp();
    return;
  }
  if (parsed.command === 'install') {
    install(parsed);
    return;
  }
  if (parsed.command === 'uninstall') {
    unregisterProtocol();
    console.log('Removed the printventory:// handler. Config left at ' + configPath());
    return;
  }
  if (parsed.command === 'add-slicer') {
    addSlicer(parsed);
    return;
  }
  if (parsed.command === 'status') {
    status();
    return;
  }
  if (parsed.command === 'open' || parsed.command === 'handle') {
    const raw = parsed.url || '';
    if (!raw) throw new Error('Missing printventory URL');
    await handleUrl(raw);
    return;
  }
  throw new Error('Unknown command: ' + parsed.command);
}

if (require.main === module) {
  main().catch((error) => {
    const message = error && error.message ? error.message : String(error);
    console.error(message);
    notifyError(message);
    process.exitCode = 1;
  });
}

module.exports = {
  configDir,
  loadConfig,
  saveConfig,
  parseCli,
  handleUrl,
  fileNameFromModelPath
};
