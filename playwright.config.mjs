import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120000,
  expect: {
    timeout: 15000
  },
  use: {
    baseURL: "http://127.0.0.1:8080",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "set PORT=8080&& npm run dev",
    url: "http://127.0.0.1:8080/health",
    timeout: 120000,
    reuseExistingServer: true
  },
  reporter: [["list"], ["html", { open: "never" }]]
});
