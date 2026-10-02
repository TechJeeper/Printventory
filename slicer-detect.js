'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// GUI slicers only. Console/engine binaries are skipped by name before these rules run.
const SLICER_RULES = [
  { id: 'bambu-studio', name: 'Bambu Studio', stems: ['bambu-studio', 'bambustudio', 'bambu studio'] },
  {
    id: 'snapmaker-orca',
    name: 'Snapmaker Orca',
    stems: ['snapmaker-orca', 'snapmaker orca', 'snapmakerorca', 'orca-slicer', 'orcaslicer'],
    pathIncludes: 'snapmaker'
  },
  {
    id: 'orca-slicer',
    name: 'OrcaSlicer',
    stems: ['orca-slicer', 'orcaslicer', 'com.softfever3d.orcaslicer', 'io.github.softfever.orcaslicer'],
    pathExcludes: 'snapmaker'
  },
  { id: 'prusaslicer', name: 'PrusaSlicer', stems: ['prusa-slicer', 'prusaslicer', 'com.prusa3d.prusaslicer'] },
  { id: 'superslicer', name: 'SuperSlicer', stems: ['superslicer', 'super-slicer'] },
  { id: 'slic3r', name: 'Slic3r', stems: ['slic3r'] },
  {
    id: 'cura',
    name: 'UltiMaker Cura',
    stems: ['ultimaker-cura', 'ultimaker cura', 'cura'],
    pathIncludesAny: ['ultimaker', 'cura']
  },
  { id: 'creality-print', name: 'Creality Print', stems: ['crealityprint', 'creality-print', 'creality print', 'crealityprint5'] },
  { id: 'elegoo', name: 'ElegooSlicer', stems: ['elegooslicer', 'elegoo-slicer', 'elegoo slicer'] },
  { id: 'anycubic-next', name: 'Anycubic Slicer Next', stems: ['anycubicslicernext', 'anycubic-slicer-next'] },
  { id: 'anycubic', name: 'Anycubic Slicer', stems: ['anycubicslicer', 'anycubic-slicer'] },
  { id: 'ideamaker', name: 'ideaMaker', stems: ['ideamaker'] },
  { id: 'lychee', name: 'Lychee Slicer', stems: ['lycheeslicer', 'lychee slicer'] },
  { id: 'chitubox', name: 'CHITUBOX', stems: ['chitubox', 'chituboxpro', 'chitubox basic'] },
  { id: 'flashprint', name: 'FlashPrint', stems: ['flashprint'] },
  { id: 'qidi', name: 'QIDI Studio', stems: ['qidistudio', 'qidi-studio', 'qidi studio', 'qidislicer'] },
  { id: 'simplify3d', name: 'Simplify3D', stems: ['simplify3d'] }
];

const SLICER_DIR_RE = /bambu|orca|prusa|slic3r|superslicer|super-slicer|cura|creality|elegoo|anycubic|ideamaker|lychee|chitu|flashprint|qidi|snapmaker|simplify|slicer/i;

const SKIP_DIRS = new Set([
  'resources', 'locales', 'node_modules', 'swiftshader', 'uninstall', '.git',
  'windows', 'microsoft', 'common files', 'windowsapps', 'internet explorer',
  'windows defender', 'windows mail', 'windows nt', 'windows photo viewer',
  'reference assemblies', 'msbuild'
]);

const LINUX_BIN_NAMES = [
  'bambu-studio', 'orca-slicer', 'prusa-slicer', 'superslicer', 'slic3r',
  'cura', 'ultimaker-cura', 'crealityprint', 'elegooslicer', 'ideamaker'
];

const FLATPAK_IDS = [
  'com.prusa3d.PrusaSlicer',
  'com.softfever3d.OrcaSlicer',
  'io.github.softfever.OrcaSlicer'
];

const MAC_APP_NAMES = [
  'BambuStudio.app',
  'Bambu Studio.app',
  'OrcaSlicer.app',
  'Snapmaker Orca.app',
  'PrusaSlicer.app',
  'SuperSlicer.app',
  'UltiMaker Cura.app',
  'Ultimaker Cura.app',
  'Creality Print.app',
  'ideaMaker.app',
  'CHITUBOX.app',
  'Lychee Slicer.app',
  'ElegooSlicer.app',
  'FlashPrint.app',
  'QIDI Studio.app',
  'Simplify3D.app'
];

function fileStem(filePath) {
  const base = path.basename(filePath).replace(/\.app$/i, '');
  return base.replace(/\.(exe|appimage)$/i, '').toLowerCase();
}

function stemMatches(stem, expected) {
  if (stem === expected) return true;
  return stem.startsWith(`${expected}_`) || stem.startsWith(`${expected}-`);
}

function identifySlicer(filePath) {
  if (!filePath) return null;
  const stem = fileStem(filePath);
  const full = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (/console|curaengine|gcodeviewer/.test(stem)) return null;

  for (const rule of SLICER_RULES) {
    if (rule.pathIncludes && !full.includes(rule.pathIncludes)) continue;
    if (rule.pathExcludes && full.includes(rule.pathExcludes)) continue;
    if (rule.pathIncludesAny && !rule.pathIncludesAny.some((part) => full.includes(part))) continue;
    if (rule.stems.some((expected) => stemMatches(stem, expected))) {
      return { id: rule.id, name: rule.name };
    }
  }
  return null;
}

function uniqueExisting(paths, existsSync) {
  const seen = new Set();
  const result = [];
  for (const candidate of paths) {
    if (!candidate) continue;
    const key = candidate.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (existsSync(candidate)) result.push(candidate);
  }
  return result;
}

function programFilesRoots(env) {
  return [env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432].filter(Boolean);
}

function defaultScanRoots(platform, env, home) {
  if (platform === 'win32') {
    const local = env.LOCALAPPDATA;
    return [
      ...programFilesRoots(env),
      local || null,
      local ? path.join(local, 'Programs') : null
    ].filter(Boolean);
  }
  if (platform === 'darwin') {
    return ['/Applications', path.join(home, 'Applications'), '/opt'].filter(Boolean);
  }
  return [
    '/opt',
    '/usr/local',
    path.join(home, 'Applications'),
    path.join(home, '.local')
  ];
}

function defaultCandidatePaths(platform, env, home) {
  const candidates = [];
  if (platform === 'win32') {
    const roots = [
      ...programFilesRoots(env),
      env.LOCALAPPDATA ? path.join(env.LOCALAPPDATA, 'Programs') : null
    ].filter(Boolean);
    const relative = [
      ['Bambu Studio', 'bambu-studio.exe'],
      ['OrcaSlicer', 'orca-slicer.exe'],
      ['Snapmaker Orca', 'orca-slicer.exe'],
      ['Prusa3D', 'PrusaSlicer', 'prusa-slicer.exe'],
      ['PrusaSlicer', 'prusa-slicer.exe'],
      ['SuperSlicer', 'superslicer.exe'],
      ['SuperSlicer', 'SuperSlicer.exe'],
      ['ideaMaker', 'ideaMaker.exe'],
      ['LycheeSlicer', 'LycheeSlicer.exe'],
      ['Lychee Slicer', 'LycheeSlicer.exe'],
      ['ChiTuBox', 'CHITUBOX.exe'],
      ['ElegooSlicer', 'ElegooSlicer.exe'],
      ['FlashPrint', 'FlashPrint.exe'],
      ['Simplify3D', 'Simplify3D.exe']
    ];
    for (const root of roots) {
      for (const parts of relative) candidates.push(path.join(root, ...parts));
    }
    return candidates;
  }

  if (platform === 'darwin') {
    for (const dir of ['/Applications', path.join(home, 'Applications')]) {
      for (const appName of MAC_APP_NAMES) candidates.push(path.join(dir, appName));
    }
    return candidates;
  }

  const binDirs = ['/usr/bin', '/usr/local/bin', '/snap/bin', path.join(home, '.local', 'bin')];
  for (const dir of binDirs) {
    for (const bin of LINUX_BIN_NAMES) candidates.push(path.join(dir, bin));
  }
  const flatpakRoots = [
    path.join(home, '.local', 'share', 'flatpak', 'exports', 'bin'),
    '/var/lib/flatpak/exports/bin'
  ];
  for (const dir of flatpakRoots) {
    for (const id of FLATPAK_IDS) candidates.push(path.join(dir, id));
  }
  return candidates;
}

function shouldEnterDir(name) {
  if (!name || SKIP_DIRS.has(name.toLowerCase())) return false;
  if (name.toLowerCase() === 'programs') return true;
  return SLICER_DIR_RE.test(name);
}

function walkInstallTree(dir, depthLeft, readdirSync, consider) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  let foundHere = false;
  const subdirs = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/\.app$/i.test(entry.name)) {
        if (consider(full)) foundHere = true;
        continue;
      }
      if (!SKIP_DIRS.has(entry.name.toLowerCase())) subdirs.push(full);
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      if (consider(full)) foundHere = true;
    }
  }

  if (foundHere || depthLeft <= 0) return;
  for (const sub of subdirs) walkInstallTree(sub, depthLeft - 1, readdirSync, consider);
}

function scanRoot(root, readdirSync, consider) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory() && /\.app$/i.test(entry.name)) {
      consider(full);
      continue;
    }
    if (!entry.isDirectory() || !shouldEnterDir(entry.name)) continue;
    walkInstallTree(full, 4, readdirSync, consider);
  }
}

function versionHint(filePath) {
  const match = String(filePath).match(/(\d+\.\d+(?:\.\d+){0,2})/);
  return match ? match[1] : '';
}

function locationHint(filePath) {
  const version = versionHint(filePath);
  if (version) return version;
  const norm = String(filePath).replace(/\\/g, '/').toLowerCase();
  if (norm.includes('/appdata/local/') || norm.includes('/.local/')) return 'User';
  if (norm.includes('program files (x86)')) return 'Program Files (x86)';
  if (norm.includes('program files')) return 'Program Files';
  if (norm.includes('/snap/')) return 'Snap';
  if (norm.includes('flatpak')) return 'Flatpak';
  return '';
}

function disambiguate(found) {
  const groups = new Map();
  for (const item of found) {
    if (!groups.has(item.id)) groups.set(item.id, []);
    groups.get(item.id).push(item);
  }

  const named = [];
  for (const group of groups.values()) {
    if (group.length === 1) {
      named.push({ name: group[0].name, path: group[0].path });
      continue;
    }
    const hints = group.map((item) => locationHint(item.path));
    const uniqueHints = new Set(hints.filter(Boolean));
    group.forEach((item, index) => {
      const hint = hints[index];
      if (hint && uniqueHints.size === group.length) {
        named.push({ name: `${item.name} (${hint})`, path: item.path });
      } else if (hint) {
        named.push({ name: `${item.name} (${hint})`, path: item.path });
      } else {
        named.push({ name: item.name, path: item.path });
      }
    });
  }

  const seenNames = new Map();
  const result = named.map((item) => {
    const key = item.name.toLowerCase();
    const count = (seenNames.get(key) || 0) + 1;
    seenNames.set(key, count);
    if (count === 1) return item;
    return { name: `${item.name} (${count})`, path: item.path };
  });

  result.sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
  return result;
}

function detectInstalledSlicers(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const home = options.home || os.homedir();
  const existsSync = options.existsSync || fs.existsSync.bind(fs);
  const readdirSync = options.readdirSync || fs.readdirSync.bind(fs);
  const scanRoots = options.scanRoots !== undefined
    ? options.scanRoots
    : defaultScanRoots(platform, env, home);
  const candidatePaths = options.candidatePaths !== undefined
    ? options.candidatePaths
    : defaultCandidatePaths(platform, env, home);

  const found = [];
  const seen = new Set();

  function consider(filePath) {
    const identified = identifySlicer(filePath);
    if (!identified) return false;
    if (!existsSync(filePath)) return false;
    const key = String(filePath).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return true;
    seen.add(key);
    found.push({ id: identified.id, name: identified.name, path: filePath });
    return true;
  }

  for (const candidate of uniqueExisting(candidatePaths, existsSync)) consider(candidate);
  for (const root of scanRoots) {
    if (root && existsSync(root)) scanRoot(root, readdirSync, consider);
  }
  return disambiguate(found);
}

module.exports = {
  detectInstalledSlicers,
  identifySlicer
};
