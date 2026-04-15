import { defineConfig } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL || "http://localhost:5000";
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  workers: isCI ? 2 : undefined,
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [
        ["list"],
        ["html", { open: "never" }],
        ["json", { outputFile: "test-results/results.json" }],
        ["junit", { outputFile: "test-results/junit.xml" }],
      ]
    : [["html", { open: "never" }]],
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    { name: "webkit", use: { browserName: "webkit" } },
  ],
  webServer: isCI
    ? undefined
    : {
        command: "npm run dev:all",
        url: baseURL,
        timeout: 180_000,
        reuseExistingServer: true,
      },
});
