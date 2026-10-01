'use strict';

function splitCommandTokens(input) {
  const tokens = [];
  const re = /"([^"]*)"|'([^']*)'|\S+/g;
  const s = String(input || '').trim();
  let match;
  while ((match = re.exec(s))) {
    if (match[1] != null) tokens.push(match[1]);
    else if (match[2] != null) tokens.push(match[2]);
    else tokens.push(match[0]);
  }
  return tokens;
}

function escapeShellArg(filePath) {
  return `"${String(filePath).replace(/"/g, '\\"')}"`;
}

function getDarwinAppBundlePath(slicerPath) {
  if (!slicerPath) return null;
  const normalized = String(slicerPath).replace(/\\/g, '/');
  if (/\.app$/i.test(normalized)) return normalized;
  const match = normalized.match(/^(.*?\.app)\//i);
  return match ? match[1] : null;
}

// PrusaSlicer / SuperSlicer / Slic3r accept --single-instance; Bambu / Orca reject it.
function slicerSupportsSingleInstanceFlag(slicerPath) {
  const raw = String(slicerPath || '').toLowerCase();
  if (/bambu|orca/.test(raw)) return false;
  return /prusa|superslicer|slic3r/.test(raw);
}

function parseSlicerLauncher(slicerPath) {
  const raw = String(slicerPath || '').trim();
  if (!raw) {
    throw new Error('Slicer path is empty');
  }
  const flatpak = raw.match(/^flatpak\s+run\s+(\S+)([\s\S]*)$/i);
  if (flatpak) {
    return {
      command: 'flatpak',
      prefixArgs: ['run', flatpak[1], ...splitCommandTokens(flatpak[2])]
    };
  }
  const snap = raw.match(/^snap\s+run\s+(\S+)([\s\S]*)$/i);
  if (snap) {
    return {
      command: 'snap',
      prefixArgs: ['run', snap[1], ...splitCommandTokens(snap[2])]
    };
  }
  return { command: raw, prefixArgs: [] };
}

function modelPathList(modelPaths) {
  const paths = (Array.isArray(modelPaths) ? modelPaths : [modelPaths]).filter(Boolean);
  if (!paths.length) {
    throw new Error('No model files to open in slicer');
  }
  return paths.map((p) => String(p));
}

/**
 * argv for child_process.spawn. A configured value like
 * "flatpak run com.prusa3d.PrusaSlicer" is split into a command and args.
 * A filesystem path, including one with spaces, stays a single executable.
 */
function buildSlicerSpawnSpec(slicerPath, modelPaths, platform = process.platform) {
  const paths = modelPathList(modelPaths);
  if (platform === 'darwin') {
    const appBundle = getDarwinAppBundlePath(slicerPath);
    if (appBundle) {
      return {
        command: 'open',
        args: ['-n', '-a', appBundle, '--args', ...paths]
      };
    }
  }

  const launcher = parseSlicerLauncher(slicerPath);
  const args = launcher.prefixArgs.slice();
  if (slicerSupportsSingleInstanceFlag(slicerPath)) {
    args.push('--single-instance=0');
  }
  args.push(...paths);
  return { command: launcher.command, args };
}

/** Shell command used when a client has to launch through a shell. */
function buildSlicerShellCommand(slicerPath, modelPaths, platform = process.platform) {
  const paths = modelPathList(modelPaths);
  const spec = buildSlicerSpawnSpec(slicerPath, paths, platform);
  const launcher = parseSlicerLauncher(slicerPath);
  const head = spec.args.slice(0, spec.args.length - paths.length);
  const files = spec.args.slice(spec.args.length - paths.length);
  const quoteCommand = spec.command !== 'open' && launcher.prefixArgs.length === 0;
  const commandToken = quoteCommand ? escapeShellArg(spec.command) : spec.command;
  const headTokens = head.map((arg) => (/\s/.test(arg) ? escapeShellArg(arg) : arg));
  return [commandToken, ...headTokens, ...files.map(escapeShellArg)].join(' ');
}

module.exports = {
  splitCommandTokens,
  escapeShellArg,
  slicerSupportsSingleInstanceFlag,
  parseSlicerLauncher,
  buildSlicerSpawnSpec,
  buildSlicerShellCommand
};
