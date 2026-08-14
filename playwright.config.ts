import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  webServer: { command: 'pnpm dev --host 127.0.0.1', port: 4173, reuseExistingServer: true },
  use: { baseURL: 'http://127.0.0.1:4173/health-app/' },
  projects: [
    { name: 'Android Chrome', use: { ...devices['Pixel 7'] } },
    { name: 'iOS WebKit', use: { ...devices['iPhone 13'] } },
  ],
});
