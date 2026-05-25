/**
 * Live manual exploration — reuses e2e/.auth/user.json (no global-setup provisioning).
 */
import { defineConfig } from "@playwright/test";
import { loadE2EEnv } from "./e2e/load-e2e-env.mjs";

loadE2EEnv();

export default defineConfig({
  globalSetup: "./e2e/manual-auth-global-setup.ts",
  testDir: "./e2e/manual",
  testMatch:
    /workbench-live-15-scenarios|human-fork-walkthrough|workbench-varied-live|workbench-responsive|workbench-responsive-controls|workbench-unique-live|workbench-more-live|workbench-more-responsive|workbench-edge-live/,
  fullyParallel: false,
  workers: 1,
  timeout: 360_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:5000",
    storageState: "e2e/.auth/user.json",
    screenshot: "on",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
