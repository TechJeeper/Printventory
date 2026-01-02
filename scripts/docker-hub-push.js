#!/usr/bin/env node
// Docker Hub push script for Printventory
// Handles building, tagging, and pushing Docker images to Docker Hub

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Read package.json for version
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = packageJson.version;

// Get Docker Hub username from environment variable
const dockerHubUsername = process.env.DOCKER_HUB_USERNAME;

if (!dockerHubUsername) {
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

const imageName = 'printventory';
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

// Build the Docker image
function buildImage() {
  console.log('Building Docker image...');
  console.log(`Image: ${fullImageName}`);
  console.log('');
  
  const buildCommand = `docker build -t ${fullImageName} .`;
  if (!exec(buildCommand)) {
    console.error('Failed to build Docker image');
    process.exit(1);
  }
  
  console.log('');
  console.log('✓ Docker image built successfully');
}

// Tag the image with version and latest
function tagImage() {
  console.log('Tagging Docker image...');
  console.log(`  Version tag: ${versionTag}`);
  console.log(`  Latest tag: ${latestTag}`);
  console.log('');
  
  // Tag with version
  if (!exec(`docker tag ${fullImageName} ${versionTag}`)) {
    console.error('Failed to tag image with version');
    process.exit(1);
  }
  
  // Tag as latest
  if (!exec(`docker tag ${fullImageName} ${latestTag}`)) {
    console.error('Failed to tag image as latest');
    process.exit(1);
  }
  
  console.log('');
  console.log('✓ Docker image tagged successfully');
}

// Push image to Docker Hub
function pushImage(tag = null) {
  const tagsToPush = tag ? [tag] : [versionTag, latestTag];
  
  console.log('Pushing Docker image to Docker Hub...');
  console.log(`Repository: ${fullImageName}`);
  console.log('');
  
  // Check if user is logged in to Docker Hub
  try {
    execSync('docker info', { stdio: 'pipe' });
  } catch (error) {
    console.error('Error: Not logged in to Docker Hub');
    console.error('Please run: docker login');
    process.exit(1);
  }
  
  for (const imageTag of tagsToPush) {
    console.log(`Pushing ${imageTag}...`);
    if (!exec(`docker push ${imageTag}`)) {
      console.error(`Failed to push ${imageTag}`);
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
    console.log(`Pull it with: docker pull ${latestTag}`);
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
    console.log('');
    console.log('Example:');
    console.log('  export DOCKER_HUB_USERNAME=myusername');
    console.log('  npm run docker:hub:all');
    process.exit(1);
}





