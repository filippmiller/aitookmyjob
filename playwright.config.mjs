import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: {
    timeout: 15000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  use: {
    baseURL: `http://127.0.0.1:${process.env.TEST_PORT || 8080}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: `set NODE_ENV=test&& set NEWS_INGEST_ENABLED=false&& set PORT=${process.env.TEST_PORT || 8080}&& npm run dev`,
    url: `http://127.0.0.1:${process.env.TEST_PORT || 8080}/health`,
    timeout: 120000,
    reuseExistingServer: true
  },
  reporter: [["list"], ["html", { open: "never" }]]
});
