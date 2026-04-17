import { mkdirSync, existsSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";
import type { TestPlan, StepExecutionResult } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../../");

export interface ExecutePlanParams {
  plan: TestPlan;
  issueKey: string;
  baseUrl: string;
  buildNumber: string;
}

export interface ExecutePlanResult {
  stepResults: StepExecutionResult[];
  screenshotPaths: string[];
}

function resolveStorageStatePath(): string {
  return process.env.QA_AC_STORAGE_STATE_PATH || join(REPO_ROOT, "e2e", ".auth", "admin.json");
}

function buildUrl(baseUrl: string, candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return `${baseUrl.replace(/\/+$/, "")}/${candidate.replace(/^\/+/, "")}`;
}

async function assertVisible(page: any, locator: string): Promise<void> {
  const isVisible = await page.locator(locator).first().isVisible({ timeout: 10_000 }).catch(() => false);
  if (!isVisible) {
    throw new Error(`Expected locator to be visible: ${locator}`);
  }
}

async function assertText(page: any, text: string): Promise<void> {
  const visible = await page.getByText(text, { exact: false }).first().isVisible({ timeout: 10_000 }).catch(() => false);
  if (!visible) {
    throw new Error(`Expected text to be visible: ${text}`);
  }
}

export async function executePlan(params: ExecutePlanParams): Promise<ExecutePlanResult> {
  const storageStatePath = resolveStorageStatePath();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: params.baseUrl,
    ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();
  await page.goto(params.baseUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  const screenshotDir = join(REPO_ROOT, "test-results", "ac-validator", params.issueKey, params.buildNumber);
  mkdirSync(screenshotDir, { recursive: true });

  const stepResults: StepExecutionResult[] = [];
  const screenshotPaths: string[] = [];

  for (const step of params.plan.steps) {
    const screenshotPath = join(screenshotDir, `${step.id}.png`);
    try {
      if (step.kind === "goto") {
        await page.goto(buildUrl(params.baseUrl, step.url), { waitUntil: "domcontentloaded" });
        if (step.expect.locator) {
          await assertVisible(page, step.expect.locator);
        }
        if (step.expect.text) {
          await assertText(page, step.expect.text);
        }
      } else if (step.kind === "api") {
        const apiResult = await page.evaluate(
          async ({ url, method }) => {
            const token = window.localStorage.getItem("auth_token");
            const response = await fetch(url, {
              method,
              headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            });
            return { status: response.status };
          },
          { url: buildUrl(params.baseUrl, step.path), method: step.method },
        );
        if (apiResult.status !== step.expectStatus) {
          throw new Error(`Expected status ${step.expectStatus} but got ${apiResult.status}`);
        }
        await page.screenshot({ path: screenshotPath, fullPage: true });
        screenshotPaths.push(screenshotPath);
        stepResults.push({
          stepId: step.id,
          status: "passed",
          screenshotPath,
          observedStatus: apiResult.status,
        });
        continue;
      } else if (step.kind === "click") {
        await page.locator(step.locator).first().click({ timeout: 10_000 });
        if (step.expect.locator) {
          await assertVisible(page, step.expect.locator);
        }
        if (step.expect.url) {
          await page.waitForURL(new RegExp(step.expect.url.replace(/\//g, "\\/")), { timeout: 10_000 });
        }
      } else if (step.kind === "fill") {
        await page.locator(step.locator).first().fill(step.value, { timeout: 10_000 });
        if (step.expect?.locator) {
          await assertVisible(page, step.expect.locator);
        }
      } else if (step.kind === "assert") {
        if (step.toBeVisible) {
          await assertVisible(page, step.locator);
        }
        if (step.toContainText) {
          const actualText = await page.locator(step.locator).first().textContent({ timeout: 10_000 });
          if (!actualText?.includes(step.toContainText)) {
            throw new Error(
              `Expected locator ${step.locator} to contain "${step.toContainText}" but saw "${actualText ?? ""}"`,
            );
          }
        }
      }

      await page.screenshot({ path: screenshotPath, fullPage: true });
      screenshotPaths.push(screenshotPath);
      stepResults.push({
        stepId: step.id,
        status: "passed",
        screenshotPath,
      });
    } catch (error) {
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      screenshotPaths.push(screenshotPath);
      stepResults.push({
        stepId: step.id,
        status: "failed",
        screenshotPath,
        error: error instanceof Error ? error.message : String(error),
      });
      break;
    }
  }

  await context.close();
  await browser.close();

  return { stepResults, screenshotPaths };
}
