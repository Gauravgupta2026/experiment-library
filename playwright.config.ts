import { defineConfig } from '@playwright/test';

const PORT = 5173;

export default defineConfig({
  testDir: 'tests',
  testMatch: ['e2e/**/*.spec.ts', 'visual/**/*.spec.ts'],
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}`,
    browserName: 'chromium',
    // WebGL must work in headless mode for the colour-grid tests.
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] },
  },
  webServer: { command: 'npm run dev', port: PORT, reuseExistingServer: true },
});
