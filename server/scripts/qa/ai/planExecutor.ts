import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { chromium } from "@playwright/test";
import { redactToJson } from "../../../src/utils/aiRedactor.js";
import type { PlanStep, StepExecutionResult, TestPlan } from "./types.js";
import {
  PLATFORM_ADMIN_API_PATH_PREFIXES,
  requiresPlatformAdmin,
} from "./planExecutorAuth.js";

export { requiresPlatformAdmin, PLATFORM_ADMIN_API_PATH_PREFIXES };

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
  harPaths: string[];
  domSnapshotPaths: string[];
  writesPerformed: number;
}

function resolveStorageStatePath(): string {
  return process.env.QA_AC_STORAGE_STATE_PATH || join(REPO_ROOT, "e2e", ".auth", "admin.json");
}

function resolvePlatformAdminStoragePath(): string {
  return (
    process.env.QA_AC_PLATFORM_ADMIN_STORAGE_PATH ||
    join(REPO_ROOT, "e2e", ".auth", "platform-admin.json")
  );
}


function resolveRunTag(buildNumber: string): string {
  return `qa-agent-run-${buildNumber}`;
}

function buildUrl(baseUrl: string, candidate: string): string {
  if (/^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  return `${baseUrl.replace(/\/+$/, "")}/${candidate.replace(/^\/+/, "")}`;
}

function isMutatingMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

function extractAuthToken(storageStatePath: string, baseUrl: string): string | null {
  if (!existsSync(storageStatePath)) {
    return null;
  }

  try {
    const targetOrigin = new URL(baseUrl).origin;
    const raw = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
      origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }>;
    };
    const matchingOrigins = (raw.origins ?? []).filter(
      (origin) =>
        origin.origin === targetOrigin ||
        origin.localStorage?.some((entry) => entry.name === "auth_token"),
    );
    for (const origin of matchingOrigins) {
      const token = origin.localStorage?.find((entry) => entry.name === "auth_token")?.value;
      if (token) {
        return token;
      }
    }
  } catch {
    return null;
  }

  return null;
}

// NOTE: `locator.isVisible()` is NOT an auto-waiting API in Playwright — it
// returns the current state synchronously and its `timeout` option is ignored.
// Using it after `page.goto({ waitUntil: "domcontentloaded" })` races against
// React's post-hydration render cycle and produces false negatives (e.g. the
// workbench canvas toolbar hasn't mounted yet when we look). The correct
// auto-waiting pattern is `locator.waitFor({ state: "visible" })`, which polls
// up to `timeout` ms before throwing.
async function assertVisible(page: any, locator: string): Promise<void> {
  try {
    await page.locator(locator).first().waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    throw new Error(`Expected locator to be visible: ${locator}`);
  }
}

async function assertText(page: any, text: string): Promise<void> {
  try {
    await page
      .getByText(text, { exact: false })
      .first()
      .waitFor({ state: "visible", timeout: 10_000 });
  } catch {
    throw new Error(`Expected text to be visible: ${text}`);
  }
}

async function assertUrl(page: any, expectedUrl: string): Promise<void> {
  await page.waitForURL(new RegExp(expectedUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), {
    timeout: 10_000,
  });
}

async function assertLocatorText(page: any, locator: string, expectedText: string): Promise<void> {
  const actualText = await page.locator(locator).first().textContent({ timeout: 10_000 });
  if (!actualText?.includes(expectedText)) {
    throw new Error(`Expected locator ${locator} to contain "${expectedText}" but saw "${actualText ?? ""}"`);
  }
}

async function assertLocatorValue(page: any, locator: string, expectedValue: string): Promise<void> {
  const actualValue = await page.locator(locator).first().inputValue({ timeout: 10_000 });
  if (actualValue !== expectedValue) {
    throw new Error(`Expected locator ${locator} to equal "${expectedValue}" but saw "${actualValue}"`);
  }
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value, null, 2), "utf8");
}

export async function executePlan(params: ExecutePlanParams): Promise<ExecutePlanResult> {
  const storageStatePath = resolveStorageStatePath();
  const authToken = extractAuthToken(storageStatePath, params.baseUrl);
  const platformAdminStoragePath = resolvePlatformAdminStoragePath();
  const platformAdminToken = existsSync(platformAdminStoragePath)
    ? extractAuthToken(platformAdminStoragePath, params.baseUrl)
    : null;
  if (!platformAdminToken) {
    console.warn(
      `[planExecutor] Platform-admin storage state missing at ${platformAdminStoragePath}. API steps targeting platform-only admin routes will be executed with the tenant-admin token and likely 403.`,
    );
  }
  const runTag = resolveRunTag(params.buildNumber);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    baseURL: params.baseUrl,
    acceptDownloads: true,
    ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
  });
  const page = await context.newPage();

  let activeStep: PlanStep | null = null;
  let activeRequests: Array<Record<string, unknown>> = [];
  let writesPerformed = 0;

  await page.route("**/*", async (route) => {
    const request = route.request();
    const shouldTagWrite =
      activeStep?.scope === "self_scoped" &&
      isMutatingMethod(request.method()) &&
      /^https?:\/\//i.test(request.url());

    if (shouldTagWrite) {
      await route.continue({
        headers: {
          ...request.headers(),
          "X-QA-Agent-Run": runTag,
        },
      });
      return;
    }

    await route.continue();
  });

  page.on("request", (request) => {
    if (!activeStep) return;
    activeRequests.push({
      type: "request",
      url: request.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      headers: request.headers(),
    });
  });

  page.on("response", async (response) => {
    if (!activeStep) return;
    const request = response.request();
    activeRequests.push({
      type: "response",
      url: response.url(),
      method: request.method(),
      status: response.status(),
      headers: response.headers(),
      contentType: response.headers()["content-type"] ?? null,
    });
  });

  await page.goto(params.baseUrl, { waitUntil: "domcontentloaded" }).catch(() => {});

  const artifactDir = join(REPO_ROOT, "test-results", "ac-validator", params.issueKey, params.buildNumber);
  mkdirSync(artifactDir, { recursive: true });

  const stepResults: StepExecutionResult[] = [];
  const screenshotPaths: string[] = [];
  const harPaths: string[] = [];
  const domSnapshotPaths: string[] = [];

  for (const step of params.plan.steps) {
    const screenshotPath = join(artifactDir, `${step.id}.png`);
    const domSnapshotPath = join(artifactDir, `${step.id}.dom.html`);
    const harPath = join(artifactDir, `${step.id}.har.json`);
    const startedAt = Date.now();
    activeStep = step;
    activeRequests = [];

    try {
      if (step.kind === "goto") {
        await page.goto(buildUrl(params.baseUrl, step.url), { waitUntil: "domcontentloaded" });
        if (step.expect.locator) {
          await assertVisible(page, step.expect.locator);
        }
        if (step.expect.text) {
          await assertText(page, step.expect.text);
        }
        if (step.expect.url) {
          await assertUrl(page, step.expect.url);
        }
      } else if (step.kind === "api") {
        const url = buildUrl(params.baseUrl, step.path);
        const headers: Record<string, string> = { Accept: "application/json" };
        const stepAuthToken =
          requiresPlatformAdmin(step.path) && platformAdminToken ? platformAdminToken : authToken;
        if (stepAuthToken) {
          headers.Authorization = `Bearer ${stepAuthToken}`;
        }
        if (step.body) {
          headers["Content-Type"] = "application/json";
        }
        if (step.scope === "self_scoped" && isMutatingMethod(step.method)) {
          headers["X-QA-Agent-Run"] = runTag;
        }

        const response = await context.request.fetch(url, {
          method: step.method,
          headers,
          data: step.body ? JSON.stringify(step.body) : undefined,
        });
        const rawBody = await response.text().catch(() => "");
        const headersObject = Object.fromEntries(
          response.headersArray().map((header) => [header.name, header.value]),
        );
        activeRequests.push({
          type: "api",
          url,
          method: step.method,
          status: response.status(),
          headers: headersObject,
          body: redactToJson({ body: rawBody }),
        });

        if (step.scope === "self_scoped" && isMutatingMethod(step.method)) {
          writesPerformed += 1;
        }

        if (response.status() !== step.expectStatus) {
          throw new Error(`Expected status ${step.expectStatus} but got ${response.status()}`);
        }
        if (step.expectBodyContains && !rawBody.includes(step.expectBodyContains)) {
          throw new Error(`Expected API body to contain "${step.expectBodyContains}"`);
        }
      } else if (step.kind === "click") {
        await page.locator(step.locator).first().click({ timeout: 10_000 });
        if (step.expect.locator) {
          await assertVisible(page, step.expect.locator);
        }
        if (step.expect.text) {
          await assertText(page, step.expect.text);
        }
        if (step.expect.url) {
          await assertUrl(page, step.expect.url);
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
          await assertLocatorText(page, step.locator, step.toContainText);
        }
        if (step.toHaveValue) {
          await assertLocatorValue(page, step.locator, step.toHaveValue);
        }
      } else if (step.kind === "waitFor") {
        await page.locator(step.locator).first().waitFor({
          state: step.state,
          timeout: step.timeout ?? 10_000,
        });
      } else if (step.kind === "upload") {
        const fixturePath = join(REPO_ROOT, "e2e", "fixtures", "qa-agent", step.fixtureFile);
        await page.locator(step.locator).setInputFiles(fixturePath);
      } else if (step.kind === "select") {
        await page.locator(step.locator).first().click({ timeout: 10_000 });
        await page.locator("[role='listbox']").first().waitFor({ state: "visible", timeout: 10_000 });
        await page
          .locator("[role='option']")
          .filter({ hasText: step.option })
          .first()
          .click({ timeout: 10_000 });
        await assertLocatorText(page, step.locator, step.option);
      } else if (step.kind === "press") {
        await page.keyboard.press(step.keys);
      } else if (step.kind === "expectDownload") {
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 10_000 }),
          page.locator(step.triggerLocator).first().click({ timeout: 10_000 }),
        ]);
        const suggestedFilename = download.suggestedFilename();
        const downloadPath = join(artifactDir, `${step.id}-${suggestedFilename}`);
        await download.saveAs(downloadPath);
        if (step.filenameMatches && !(new RegExp(step.filenameMatches, "i")).test(suggestedFilename)) {
          throw new Error(`Expected download filename to match ${step.filenameMatches}, saw ${suggestedFilename}`);
        }
        if (step.contentType) {
          const contentType = [...activeRequests]
            .reverse()
            .find((entry) => entry.type === "response" && typeof entry.contentType === "string")
            ?.contentType;
          if (typeof contentType !== "string" || !contentType.includes(step.contentType)) {
            throw new Error(`Expected download content-type to contain "${step.contentType}"`);
          }
        }
        activeRequests.push({
          type: "download",
          path: downloadPath,
          suggestedFilename,
        });
      }

      const dom = await page.content();
      await page.screenshot({ path: screenshotPath, fullPage: true });
      writeFileSync(domSnapshotPath, dom, "utf8");
      writeJson(harPath, {
        stepId: step.id,
        stepKind: step.kind,
        entries: activeRequests,
      });

      screenshotPaths.push(screenshotPath);
      harPaths.push(harPath);
      domSnapshotPaths.push(domSnapshotPath);

      const apiEntry = activeRequests.find((entry) => entry.type === "api");
      stepResults.push({
        stepId: step.id,
        status: "passed",
        screenshotPath,
        domSnapshotPath,
        harPath,
        requestCount: activeRequests.length,
        durationMs: Date.now() - startedAt,
        ...(typeof apiEntry?.status === "number" ? { observedStatus: Number(apiEntry.status) } : {}),
        ...(typeof apiEntry?.body === "string" ? { observedBodySnippet: String(apiEntry.body) } : {}),
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const dom = await page.content().catch(() => "<html><body>DOM capture failed</body></html>");
      const observedUrl = page.url();
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      writeFileSync(domSnapshotPath, dom, "utf8");
      writeJson(harPath, {
        stepId: step.id,
        stepKind: step.kind,
        entries: activeRequests,
        error: errorMessage,
        observedUrl,
      });

      // Emit a single-line, log-friendly summary so pipeline stdout surfaces
      // the failing step without requiring the reviewer to pull the evidence
      // manifest from S3. Include the observed URL because most AC failures
      // we've seen are goto/assert steps that misread a redirect target.
      const stepSummary: Record<string, unknown> = { kind: step.kind };
      if (step.kind === "goto") {
        stepSummary.url = step.url;
        stepSummary.expect = step.expect;
      } else if (step.kind === "api") {
        stepSummary.method = step.method;
        stepSummary.path = step.path;
        stepSummary.expectStatus = step.expectStatus;
      } else if (step.kind === "assert" || step.kind === "click" || step.kind === "fill" || step.kind === "waitFor") {
        stepSummary.locator = (step as { locator?: string }).locator;
      }
      console.warn(
        `[planExecutor] step ${step.id} failed: ${errorMessage} (observedUrl=${observedUrl}, step=${JSON.stringify(stepSummary)})`,
      );

      screenshotPaths.push(screenshotPath);
      harPaths.push(harPath);
      domSnapshotPaths.push(domSnapshotPath);
      stepResults.push({
        stepId: step.id,
        status: "failed",
        screenshotPath,
        domSnapshotPath,
        harPath,
        requestCount: activeRequests.length,
        durationMs: Date.now() - startedAt,
        error: errorMessage,
      });
      break;
    } finally {
      activeStep = null;
    }
  }

  await context.close();
  await browser.close();

  return { stepResults, screenshotPaths, harPaths, domSnapshotPaths, writesPerformed };
}
