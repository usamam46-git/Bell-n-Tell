import { defineConfig } from '@playwright/test';
process.loadEnvFile('../../.env');
export default defineConfig({
  testDir: './test',
  timeout: 90000,
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' },
  webServer: [
    { command: 'npm run dev -w @bellntell/api', cwd: '../..', url: 'http://localhost:4000/api/v1/health', timeout: 120000, reuseExistingServer: true },
    { command: 'npm run dev -w @bellntell/web', cwd: '../..', url: 'http://localhost:3000', timeout: 120000, reuseExistingServer: true }
  ]
});
