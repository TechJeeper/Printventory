#!/usr/bin/env node
// Docker Hub push script for Printventory
// Handles building, tagging, and pushing Docker images to Docker Hub

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const containerRuntime = require('./container-runtime');

// Read package.json for version
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

// Get Docker Hub username from environment variable (Docker Hub namespaces are lowercase)
const dockerHubUsernameRaw = process.env.DOCKER_HUB_USERNAME;

if (!dockerHubUsernameRaw) {
  console.error('Error: DOCKER_HUB_USERNAME environment variable is not set.');
  console.error('');
  console.error('Please set it before running Docker Hub commands:');
  console.error('  Windows (PowerShell): $env:DOCKER_HUB_USERNAME="your-username"');
  console.error('  Windows (CMD): set DOCKER_HUB_USERNAME=your-username');
  console.error('  Unix/Linux/Mac: export DOCKER_HUB_USERNAME=your-username');
  console.error('');
  console.error('Or create a .env file with: DOCKER_HUB_USERNAME=your-username');
  process.exit(1);
}

const dockerHubUsername = dockerHubUsernameRaw.toLowerCase();
if (dockerHubUsername !== dockerHubUsernameRaw) {
  console.warn(
    `Note: DOCKER_HUB_USERNAME normalized to "${dockerHubUsername}" (Docker Hub namespaces are lowercase).`
  );
}

const imageName = 'printventory';
// Short Docker Hub form (docker.io implied). Lowercase namespace avoids the client
// treating "Printventory/..." as a custom registry hostname. Do not prefix with
// registry-1.docker.io — that key does not match credentials from `docker login`.
const fullImageName = `${dockerHubUsername}/${imageName}`;
const versionTag = `${fullImageName}:${version}`;
const latestTag = `${fullImageName}:latest`;

// Helper function to execute commands
function exec(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options });
    return true;
  } catch (error) {
    console.error(`Error executing: ${command}`);
    console.error(error.message);
    return false;
  }
}

// Build the container image
function buildImage() {
  const runtimeLabel = containerRuntime.getRuntimeLabel();
  console.log(`Building container image (${runtimeLabel})...`);
  console.log(`Image: ${fullImageName}`);
  console.log('');
  
  // Podman fails to push images that still reference library/* base layers because
  // Docker Hub requests multi-repository auth scopes (e.g. library/node:pull).
  const runtime = containerRuntime.getRuntime();
  const squashFlag = runtime.endsWith('podman') ? ' --squash-all' : '';
  const buildCommand = `${runtime} build${squashFlag} -t ${fullImageName} .`;
  if (!exec(buildCommand)) {
    console.error('Failed to build container image');
    process.exit(1);
  }
  
  console.log('');
  console.log(`✓ Container image built successfully (${runtimeLabel})`);
}

// Tag the image with version and latest
function tagImage() {
  const runtime = containerRuntime.getRuntime();
  console.log('Tagging container image...');
  console.log(`  Version tag: ${versionTag}`);
  console.log(`  Latest tag: ${latestTag}`);
  console.log('');
  
  // Tag with version
  if (!exec(`${runtime} tag ${fullImageName} ${versionTag}`)) {
    console.error('Failed to tag image with version');
    process.exit(1);
  }
  
  // Tag as latest
  if (!exec(`${runtime} tag ${fullImageName} ${latestTag}`)) {
    console.error('Failed to tag image as latest');
    process.exit(1);
  }
  
  console.log('');
  console.log('✓ Container image tagged successfully');
}

function printPushAuthHelp() {
  console.error('');
  console.error('Docker Hub rejected the push (insufficient_scope or access denied). Try:');
  console.error('  1. docker logout');
  console.error(`  2. docker login -u ${dockerHubUsername}`);
  console.error('     Use a Personal Access Token as the password (not your account password):');
  console.error('     https://hub.docker.com/settings/security');
  console.error('     Token permissions: Read, Write, Delete');
  console.error(`  3. Confirm DOCKER_HUB_USERNAME matches your Hub account (${dockerHubUsername})`);
  console.error('  4. npm run docker:push');
  console.error('');
}

// Push image to Docker Hub
function pushImage(tag = null) {
  const tagsToPush = tag ? [tag] : [versionTag, latestTag];
  
  console.log('Pushing Docker image to Docker Hub...');
  console.log(`Repository: ${fullImageName}`);
  console.log('');
  
  const runtime = containerRuntime.getRuntime();
  // Check if the container runtime is available and responsive
  try {
    containerRuntime.runQuiet('info');
  } catch (error) {
    console.error(`Error: ${containerRuntime.getRuntimeLabel()} is not running or not logged in to Docker Hub`);
    console.error(`Please run: ${containerRuntime.loginHint()}`);
    process.exit(1);
  }
  
  if (containerRuntime.isPodmanOnWindows()) {
    console.log('Syncing Docker Hub credentials into Podman VM...');
    if (!containerRuntime.syncAuthToPodmanMachine()) {
      process.exit(1);
    }
    console.log('');
  }

  for (const imageTag of tagsToPush) {
    console.log(`Pushing ${imageTag}...`);
    if (!exec(`${runtime} push ${imageTag}`)) {
      console.error(`Failed to push ${imageTag}`);
      if (containerRuntime.isPodmanOnWindows()) {
        console.error('');
        console.error('On Windows, log in on the host (not inside the VM), then retry push:');
        console.error(`  podman login docker.io -u ${dockerHubUsername} -p <access-token>`);
      } else {
        printPushAuthHelp();
      }
      process.exit(1);
    }
    console.log(`✓ Pushed ${imageTag}`);
    console.log('');
  }
  
  console.log('✓ All images pushed to Docker Hub successfully');
  console.log('');
  console.log('Your image is now available at:');
  console.log(`  https://hub.docker.com/r/${dockerHubUsername}/${imageName}`);
}

// Main command handler
const command = process.argv[2];

switch (command) {
  case 'build':
    buildImage();
    break;
    
  case 'tag':
    tagImage();
    break;
    
  case 'push':
    pushImage();
    break;
    
  case 'push-version':
    pushImage(versionTag);
    break;
    
  case 'push-latest':
    pushImage(latestTag);
    break;
    
  case 'all':
    console.log('=== Docker Hub Complete Workflow ===');
    console.log(`Version: ${version}`);
    console.log(`Docker Hub Username: ${dockerHubUsername}`);
    console.log(`Image: ${fullImageName}`);
    console.log('');
    buildImage();
    console.log('');
    tagImage();
    console.log('');
    pushImage();
    console.log('');
    console.log('=== Complete ===');
    console.log('');
    console.log('Your Printventory Docker image is now available on Docker Hub!');
    console.log('Pull it with: docker pull printventory/printventory:latest');
    break;
    
  default:
    console.log('Docker Hub Push Script for Printventory');
    console.log('');
    console.log('Usage: node scripts/docker-hub-push.js <command>');
    console.log('');
    console.log('Commands:');
    console.log('  build          Build the Docker image');
    console.log('  tag            Tag the image with version and latest');
    console.log('  push           Push both version and latest tags to Docker Hub');
    console.log('  push-version   Push only the version tag to Docker Hub');
    console.log('  push-latest    Push only the latest tag to Docker Hub');
    console.log('  all            Complete workflow: build, tag, and push');
    console.log('');
    console.log('Environment Variables:');
    console.log('  DOCKER_HUB_USERNAME  Your Docker Hub username (required)');
    console.log('  CONTAINER_RUNTIME    Use "docker" or "podman" (auto-detected if unset)');
    console.log('');
    console.log('Example:');
    console.log('  export DOCKER_HUB_USERNAME=myusername');
    console.log('  npm run docker:hub:all');
    process.exit(1);
}






