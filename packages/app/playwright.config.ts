import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:6006',
    browserName: 'chromium',
    launchOptions: { channel: 'chrome' },
    headless: true,
    reducedMotion: 'reduce',
    timezoneId: 'UTC',
    screenshot: 'off'
  },
  webServer: {
    command: 'npm run storybook -- --ci --host 127.0.0.1',
    url: 'http://127.0.0.1:6006',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
