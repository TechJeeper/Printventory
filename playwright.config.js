// playwright.config.js
const path = require('path');

const testDir = path.join(__dirname, 'tests');

/** @type {import('@playwright/test').PlaywrightTestConfig} */
module.exports = {
  testDir,
  testMatch: ['**/*.spec.js'],
  timeout: 180000,
  expect: { timeout: 30000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: path.join(testDir, 'playwright-report') }],
    ['json', { outputFile: path.join(testDir, 'test-results', 'results.json') }]
  ],
  outputDir: path.join(testDir, 'test-results'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  }
};
