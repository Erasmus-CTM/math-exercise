import { defineConfig } from 'playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: ['tests/browser/**/*.spec.mjs', '_includes/tests/*.browser.spec.mjs'],
  timeout: 180000,
  expect: {timeout: 30000},
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: 'test-results/browser',
  reporter: [['list'], ['html', {outputFolder: 'playwright-report', open: 'never'}]],
  use: {baseURL: 'http://127.0.0.1:4173', browserName: 'chromium',
    trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  webServer: {command: 'python3 -m http.server 4173 --bind 127.0.0.1 --directory _site',
    url: 'http://127.0.0.1:4173', reuseExistingServer: !process.env.CI},
});
