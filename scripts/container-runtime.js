// Detect and run docker or podman (CLI-compatible) for build/push scripts.
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

let cachedRuntime = null;

function commandExists(cmd) {
  try {
    execSync(`${cmd} --version`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function wslCommandExists(cmd) {
  try {
    execSync(`wsl which ${cmd}`, { stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function resolveRuntime(name) {
  if (commandExists(name)) {
    return name;
  }
  if (wslCommandExists(name)) {
    return `wsl ${name}`;
  }
  return null;
}

function detectRuntime() {
  if (cachedRuntime) {
    return cachedRuntime;
  }

  const override = (process.env.CONTAINER_RUNTIME || process.env.DOCKER_CMD || '').trim().toLowerCase();
  if (override) {
    if (!['docker', 'podman'].includes(override)) {
      console.error(`Invalid CONTAINER_RUNTIME="${process.env.CONTAINER_RUNTIME || process.env.DOCKER_CMD}". Use "docker" or "podman".`);
      process.exit(1);
    }
    const resolved = resolveRuntime(override);
    if (!resolved) {
      console.error(`CONTAINER_RUNTIME=${override} but "${override}" is not available on PATH or in WSL.`);
      process.exit(1);
    }
    cachedRuntime = resolved;
    return cachedRuntime;
  }

  cachedRuntime = resolveRuntime('docker') || resolveRuntime('podman');
  return cachedRuntime;
}

function usesWsl() {
  const runtime = detectRuntime();
  return runtime !== null && runtime.startsWith('wsl ');
}

function isAvailable() {
  return detectRuntime() !== null;
}

function getRuntime() {
  const runtime = detectRuntime();
  if (!runtime) {
    console.error('Error: No container runtime found. Install Docker or Podman, or set CONTAINER_RUNTIME=docker|podman.');
    process.exit(1);
  }
  return runtime;
}

function getRuntimeLabel() {
  const runtime = getRuntime();
  return runtime.endsWith('podman') ? 'Podman' : 'Docker';
}

function run(args, options = {}) {
  execSync(`${getRuntime()} ${args}`, { stdio: 'inherit', shell: true, ...options });
}

function runQuiet(args, options = {}) {
  return execSync(`${getRuntime()} ${args}`, { stdio: 'pipe', shell: true, ...options });
}

function dockerHubRegistry() {
  return 'registry-1.docker.io';
}

function loginHint() {
  const runtime = getRuntime();
  if (runtime.endsWith('podman')) {
    const registry = dockerHubRegistry();
    if (process.platform === 'win32') {
      return `${runtime} login ${registry} -u <username> -p <access-token>`;
    }
    return `${runtime} login ${registry} -u <username> --password-stdin`;
  }
  return `${runtime} login`;
}

function isPodmanOnWindows() {
  return process.platform === 'win32' && getRuntime().endsWith('podman');
}

function getHostAuthFile() {
  const authFile = process.env.REGISTRY_AUTH_FILE
    || path.join(os.homedir(), '.config', 'containers', 'auth.json');
  return fs.existsSync(authFile) ? authFile : null;
}

function syncAuthToPodmanMachine() {
  if (!isPodmanOnWindows()) {
    return true;
  }

  const authFile = getHostAuthFile();
  if (!authFile) {
    console.error('Error: Docker Hub credentials not found on Windows.');
    console.error(`Log in locally, then retry push:`);
    console.error(`  podman login ${dockerHubRegistry()} -u <username> -p <access-token>`);
    return false;
  }

  try {
    runQuiet('machine ssh sudo mkdir -p /root/.config/containers');
    run(`machine cp "${authFile}" podman-machine-default:/root/.config/containers/auth.json`);
    return true;
  } catch (error) {
    console.error('Error: Failed to sync Docker Hub credentials into the Podman VM.');
    console.error(error.message);
    return false;
  }
}

module.exports = {
  commandExists,
  detectRuntime,
  dockerHubRegistry,
  getRuntime,
  getRuntimeLabel,
  isAvailable,
  getHostAuthFile,
  isPodmanOnWindows,
  loginHint,
  run,
  runQuiet,
  syncAuthToPodmanMachine,
  usesWsl,
  wslCommandExists,
};
