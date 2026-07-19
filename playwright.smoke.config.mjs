/**
 * Fast smoke Playwright config — separate from full E2E.
 * Uses BASE_URL when set (deploy verification); otherwise starts local webServer.
 * No fixed sleeps in tests; config timeouts only.
 */

import { defineConfig, devices } from "@playwright/test";

const externalBase = process.env.BASE_URL || process.env.SMOKE_BASE_URL || "";
const localPort = process.env.TEST_PORT || "8091";
const baseURL = externalBase
  ? externalBase.replace(/\/$/, "")
  : `http://127.0.0.1:${localPort}`;

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: "./tests",
  testMatch: /smoke\.spec\.js$/,
  timeout: 20000,
  expect: { timeout: 10000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : [["list"]],
  projects: [
    {
      name: "chromium-smoke",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off"
  }
};

// Only start local server when not targeting an external BASE_URL
if (!externalBase) {
  config.webServer = {
    command:
      process.platform === "win32"
        ? `set NODE_ENV=test&& set NEWS_INGEST_ENABLED=false&& set PORT=${localPort}&& npm run dev`
        : `NODE_ENV=test NEWS_INGEST_ENABLED=false PORT=${localPort} npm run dev`,
    url: `http://127.0.0.1:${localPort}/health`,
    timeout: 120000,
    reuseExistingServer: !process.env.CI
  };
}

export default config;
