#!/usr/bin/env node

/**
 * Postinstall script to patch threejs-webworker-3mf-loader
 * This redirects the fflate import from three/examples to the direct fflate package
 * which is necessary when the app is bundled as an asar file where examples are not included
 */

const fs = require('fs');
const path = require('path');

const loaderPath = path.join(__dirname, 'node_modules', 'threejs-webworker-3mf-loader', 'src', 'index.js');

if (fs.existsSync(loaderPath)) {
  let content = fs.readFileSync(loaderPath, 'utf-8');
  
  // Replace the problematic import
  const oldImport = "import * as fflate from 'three/examples/jsm/libs/fflate.module.js';";
  const newImport = "import * as fflate from 'fflate';";
  
  if (content.includes(oldImport)) {
    content = content.replace(oldImport, newImport);
    fs.writeFileSync(loaderPath, content, 'utf-8');
    console.log('✓ Patched threejs-webworker-3mf-loader to use fflate directly');
  } else if (!content.includes(newImport)) {
    console.warn('⚠ Warning: Could not find expected fflate import in threejs-webworker-3mf-loader');
  } else {
    console.log('✓ threejs-webworker-3mf-loader already patched');
  }
} else {
  console.warn('⚠ Warning: threejs-webworker-3mf-loader not found, skipping patch');
}
