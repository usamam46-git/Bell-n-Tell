import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './test',
  use: { baseURL: 'http://localhost:3000', browserName: 'chromium', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } },
  webServer: [
    { command: 'npm run dev -w @bellntell/api', cwd: '../..', url: 'http://localhost:4000/api/v1/health', timeout: 120000, reuseExistingServer: true },
    { command: 'npm run dev -w @bellntell/web', cwd: '../..', url: 'http://localhost:3000', timeout: 120000, reuseExistingServer: true }
  ]
});
