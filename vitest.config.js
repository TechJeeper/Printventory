import { defineConfig } from 'vitest/config';
import TestDriver from 'testdriverai/vitest';

// Note: dotenv is loaded automatically by the TestDriver SDK
export default defineConfig({
  test: {
    // Only run TestDriver tests; the existing Playwright specs live in tests/*.spec.js
    include: ['tests/testdriver/**/*.test.mjs'],
    testTimeout: 900000,
    hookTimeout: 900000,
    reporters: [
      'default',
      TestDriver(),
    ],
    setupFiles: ['testdriverai/vitest/setup'],
  },
});
