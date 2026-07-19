#!/usr/bin/env node
/**
 * Back-compat wrapper. Prefer: node scripts/publish-beta-release.js --discord-only
 */
const { spawnSync } = require('child_process');
const path = require('path');

const script = path.join(__dirname, 'publish-beta-release.js');
const args = process.argv.slice(2).map((arg) => (arg === '--init' ? '--discord-init' : arg));
if (!args.includes('--discord-only') && !args.includes('--discord-init')) {
  args.unshift('--discord-only');
}

const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' });
process.exit(result.status ?? 1);
