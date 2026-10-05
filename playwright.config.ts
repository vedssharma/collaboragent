import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testIgnore: 'unit/**',
  fullyParallel: true,
  workers: 2,
  use: {
    baseURL: 'http://localhost:3100',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    // Use a pre-installed browser (for example in sandboxes without downloads).
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } } : {}),
  },
  webServer: { command: 'npm run dev -- --port 3100', url: 'http://localhost:3100', reuseExistingServer: !process.env.CI },
});
