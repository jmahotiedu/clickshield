import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: 'output/playwright',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: process.env.CI === 'true' ? 'line' : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node --experimental-strip-types tests/fixtures/server.ts',
    url: 'http://127.0.0.1:4173/health',
    reuseExistingServer: process.env.CI !== 'true',
    timeout: 15_000,
  },
});
