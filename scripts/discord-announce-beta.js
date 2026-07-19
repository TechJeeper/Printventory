#!/usr/bin/env node
/**
 * Back-compat wrapper. Prefer:
 *   npm run discord:latest-builds -- --changelog "..."
 * which posts via Printventory-Build bot (scripts/.discord).
 */
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'publish-beta-release.js');
const passthrough = process.argv.slice(2);
const args = ['--discord-only', ...passthrough];
if (!passthrough.includes('--changelog') && !process.env.CHANGELOG && !process.env.RELEASE_BODY) {
  // Keep announce usable without flags for current package version defaults from CHANGELOG-ish bullets
  args.push(
    '--changelog',
    [
      '- Folder and ZIP bundle grouping in List/Preview/Detailed views',
      '- Bundle 3D preview with multi-part grid layout',
      '- Bundle details panel with file list',
      '- Send to Slicer from preview (including full bundles)',
      '- New slicer instance on macOS send',
    ].join('\n')
  );
}

const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
