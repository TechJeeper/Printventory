#!/usr/bin/env node
/**
 * Creates a zip of everything needed to build all platforms (Electron) and run Docker/server,
 * for publishing to GitHub — excludes tests, dev-only assets, local DBs, and build outputs.
 */

const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

const projectRoot = path.join(__dirname, '..');

function posix(p) {
  return p.split(path.sep).join('/');
}

function walkDirFiles(absDir, baseRel, out) {
  if (!fs.existsSync(absDir)) return;
  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  for (const e of entries) {
    const name = e.name;
    const abs = path.join(absDir, name);
    const rel = baseRel ? `${baseRel}/${name}` : name;
    if (e.isDirectory()) {
      walkDirFiles(abs, rel, out);
    } else {
      out.push(rel);
    }
  }
}

function addBuildFilesFromPackageJson(set) {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const files = pkg.build?.files || [];
  for (const pattern of files) {
    if (pattern.startsWith('node_modules/')) continue;
    if (pattern === 'guide/*') {
      const acc = [];
      walkDirFiles(path.join(projectRoot, 'guide'), 'guide', acc);
      acc.forEach((r) => set.add(r));
      continue;
    }
    if (pattern === 'vendor/**' || pattern === 'vendor/**/*') {
      const acc = [];
      walkDirFiles(path.join(projectRoot, 'vendor'), 'vendor', acc);
      acc.forEach((r) => set.add(r));
      continue;
    }
    if (pattern.includes('*')) continue;
    set.add(pattern);
  }
}

function addRootMediaForDocker(set) {
  let names;
  try {
    names = fs.readdirSync(projectRoot);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/\.(png|jpg|jpeg|bmp)$/i.test(name)) continue;
    const abs = path.join(projectRoot, name);
    try {
      if (fs.statSync(abs).isFile()) set.add(name);
    } catch {
      /* skip */
    }
  }
}

function addElectronBuildResources(set, pkg) {
  const mac = pkg.build?.mac || {};
  const win = pkg.build?.win || {};
  const linux = pkg.build?.linux || {};
  const nsis = pkg.build?.nsis || {};
  if (mac.icon) set.add(mac.icon);
  if (win.icon) set.add(win.icon);
  if (linux.icon) set.add(linux.icon);
  if (mac.entitlements) set.add(mac.entitlements);
  if (mac.entitlementsInherit && mac.entitlementsInherit !== mac.entitlements) {
    set.add(mac.entitlementsInherit);
  }
  if (nsis.installerSidebar) set.add(nsis.installerSidebar);
  if (nsis.uninstallerSidebar && nsis.uninstallerSidebar !== nsis.installerSidebar) {
    set.add(nsis.uninstallerSidebar);
  }
}

const EXTRA_ALWAYS = [
  'package.json',
  'package-lock.json',
  'Dockerfile',
  'Dockerfile.build-linux',
  'docker-compose.yml',
  'docker-entrypoint.sh',
  '.dockerignore',
  'favicon.ico',
  '.npmrc',
  '.gitignore',
];

const EXTRA_DOCS = ['README.md', 'GUIDE.md', 'LICENSE.txt'];

async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const version = pkg.version;

  const paths = new Set();

  addBuildFilesFromPackageJson(paths);
  addElectronBuildResources(paths, pkg);
  addRootMediaForDocker(paths);

  for (const f of EXTRA_ALWAYS) {
    paths.add(f);
  }
  for (const f of EXTRA_DOCS) {
    if (fs.existsSync(path.join(projectRoot, f))) paths.add(f);
  }

  const scriptFiles = [];
  walkDirFiles(path.join(projectRoot, 'scripts'), 'scripts', scriptFiles);
  scriptFiles.forEach((r) => paths.add(r));

  const missing = [];
  const toZip = [];
  for (const rel of paths) {
    const abs = path.join(projectRoot, rel);
    if (!fs.existsSync(abs)) {
      missing.push(rel);
      continue;
    }
    toZip.push(rel);
  }

  if (missing.length) {
    console.warn('Optional or missing paths (skipped):');
    missing.forEach((m) => console.warn(`  - ${m}`));
  }

  toZip.sort((a, b) => a.localeCompare(b));

  const zip = new JSZip();
  for (const rel of toZip) {
    const abs = path.join(projectRoot, rel);
    const data = fs.readFileSync(abs);
    zip.file(posix(rel), data);
  }

  const distDir = path.join(projectRoot, 'dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  const outName = `printventory-github-source-${version}.zip`;
  const outPath = path.join(distDir, outName);

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
  fs.writeFileSync(outPath, buf);

  console.log(`Created ${outPath} (${toZip.length} files, ${(buf.length / 1024 / 1024).toFixed(2)} MiB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
