import { defineConfig } from "@playwright/test";
import { loadE2EEnv } from "./e2e/load-e2e-env.mjs";

loadE2EEnv();

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
    timeout: isCI ? 15_000 : 10_000,
  },
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL,
    trace: "on-first-retry",
    // Always capture a final-state screenshot per test (not just on
    // failure) so the AI QA agent pipeline can upload them to S3 and
    // embed them in the Confluence evidence page. This lets reviewers
    // verify that passing Jira-tagged tests (@COHI-77 etc.) landed on
    // the correct final UI state instead of trusting a green dot.
    //
    // Cost impact locally: one extra PNG per test in `test-results/`,
    // which dev workflows already ignore. CI impact: all artifacts are
    // filtered down to Jira-tagged tests in `aiQaRunner.ts` before
    // upload, so we are not paying S3 for untagged smoke tests.
    screenshot: "on",
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
