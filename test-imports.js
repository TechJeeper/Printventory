const { app } = require('electron');
const path = require('path');

async function testImports() {
  console.log('Testing imports...');

  try {
    const fetch = (await import('node-fetch')).default;
    console.log('node-fetch imported successfully');
  } catch (err) {
    console.error('Failed to import node-fetch:', err);
    process.exit(1);
  }

  try {
    const OpenAI = require('openai');
    console.log('openai required successfully');
  } catch (err) {
    console.error('Failed to require openai:', err);
    process.exit(1);
  }

  console.log('Imports test passed');
}

testImports();
