import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const AUTH_DIR = path.join(process.cwd(), "e2e", ".auth");
const USER_STATE = path.join(AUTH_DIR, "user.json");
const ADMIN_STATE = path.join(AUTH_DIR, "admin.json");
const CANVAS_ONLY_STATE = path.join(AUTH_DIR, "canvas-only.json");

async function loginAndPersistState(
  baseURL: string,
  email: string,
  password: string,
  outputPath: string,
) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  await page.goto(`${baseURL}/login`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign In" }).click();

  await page.waitForURL(/\/(insights|my-dashboard)/, { timeout: 30_000 });
  await page.context().storageState({ path: outputPath });
  await browser.close();
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL as string;
  const userEmail = process.env.E2E_TEST_EMAIL;
  const userPassword = process.env.E2E_TEST_PASSWORD;
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;
  const canvasOnlyEmail = process.env.E2E_CANVAS_ONLY_EMAIL;
  const canvasOnlyPassword = process.env.E2E_CANVAS_ONLY_PASSWORD;

  if (!userEmail || !userPassword) {
    throw new Error(
      "Missing E2E_TEST_EMAIL or E2E_TEST_PASSWORD environment variables.",
    );
  }

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Missing E2E_ADMIN_EMAIL or E2E_ADMIN_PASSWORD environment variables.",
    );
  }

  await mkdir(AUTH_DIR, { recursive: true });
  await loginAndPersistState(baseURL, userEmail, userPassword, USER_STATE);
  await loginAndPersistState(baseURL, adminEmail, adminPassword, ADMIN_STATE);

  // Optional: enable dedicated canvas-only persona tests when credentials are provided.
  if (canvasOnlyEmail && canvasOnlyPassword) {
    await loginAndPersistState(
      baseURL,
      canvasOnlyEmail,
      canvasOnlyPassword,
      CANVAS_ONLY_STATE,
    );
  }
}
