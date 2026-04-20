/**
 * Sweep orphaned QA-agent fixture resources in a tenant.
 *
 * Why this exists:
 *   The AC validator seeds one canvas (and one knowledge-center document) per
 *   run, then invokes `teardownQaAgentTenant()` in a finally-block. The
 *   teardown is best-effort: if a DELETE fails mid-run (network blip, 5xx),
 *   the resource is not retried in a later build — the manifest file stays
 *   on the build agent's local disk, but the build agent is destroyed when
 *   the pipeline step completes, so the manifest is lost and the resource
 *   becomes an untracked orphan on the tenant.
 *
 *   This script walks the tenant's canvases (and optionally knowledge
 *   documents), finds rows produced by the seeder (by title prefix and
 *   `qaAgentRunTag` metadata marker), and deletes anything older than
 *   `--older-than-hours` (default 24h). Running it as a pipeline `before:`
 *   step makes a single failed teardown a bounded problem rather than a
 *   monotonic leak.
 *
 * Safety:
 *   - Dry-run by default. Pass `--execute` to perform deletes.
 *   - Only matches canvases whose title begins with "QA Agent Seed " AND
 *     whose content metadata contains `qaAgentRunTag`. Both conditions must
 *     hold, so a human-authored canvas that happens to share the title cannot
 *     be deleted by accident.
 *
 * Usage:
 *   npx tsx server/scripts/qa/sweepOrphanFixtures.ts \
 *     --base-url=https://cohi-dev.coheus1.com \
 *     --older-than-hours=24
 *
 *   npx tsx server/scripts/qa/sweepOrphanFixtures.ts \
 *     --base-url=https://cohi-dev.coheus1.com \
 *     --older-than-hours=24 \
 *     --execute
 *
 * Auth:
 *   Uses the same Playwright storage-state file the QA runner already
 *   authenticates with. Set `QA_AC_STORAGE_STATE_PATH` if the file is not
 *   at the default `<repo>/e2e/.auth/admin.json`.
 */

import { existsSync, readFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

interface SweepArgs {
  baseUrl: string | null;
  olderThanHours: number;
  storageStatePath: string | null;
  execute: boolean;
}

interface CanvasRow {
  id: string;
  title: string;
  updated_at?: string;
  created_at?: string;
  content?: unknown;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../../../");
const DEFAULT_STORAGE_STATE_PATH = join(REPO_ROOT, "e2e", ".auth", "admin.json");
const CANVAS_TITLE_PREFIX = "QA Agent Seed ";
const RUN_TAG_MARKER_REGEX = /^qa-agent-run-/;

function parseArgs(argv: string[]): SweepArgs {
  const args: SweepArgs = {
    baseUrl: process.env.QA_BASE_URL ?? null,
    olderThanHours: 24,
    storageStatePath: process.env.QA_AC_STORAGE_STATE_PATH ?? null,
    execute: false,
  };

  for (const raw of argv) {
    if (raw === "--execute") {
      args.execute = true;
      continue;
    }
    const match = raw.match(/^--([^=]+)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    switch (key) {
      case "base-url":
        args.baseUrl = value.replace(/\/+$/, "");
        break;
      case "older-than-hours": {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`--older-than-hours must be a non-negative number, got "${value}"`);
        }
        args.olderThanHours = n;
        break;
      }
      case "storage-state":
        args.storageStatePath = value;
        break;
      default:
        console.warn(`[sweep] Unknown flag --${key}, ignoring`);
    }
  }
  return args;
}

function log(message: string): void {
  console.log(`[sweep] ${message}`);
}

function resolveStorageStatePath(storageStatePath: string | null): string {
  return storageStatePath || DEFAULT_STORAGE_STATE_PATH;
}

/**
 * Parse the Playwright storage-state file and extract the bearer token for
 * the tenant the QA runner uses. Same logic as `qaFixtureSeeder.ts` — kept
 * inlined here so the sweeper is a standalone script with no imports from
 * the runner's internal module graph (which would otherwise require the
 * whole aiQaRunner build surface to be importable).
 */
function extractAuthToken(storageStatePath: string, baseUrl: string): string {
  if (!existsSync(storageStatePath)) {
    throw new Error(`QA storage state not found at ${storageStatePath}`);
  }
  const raw = JSON.parse(readFileSync(storageStatePath, "utf8")) as {
    origins?: Array<{ origin?: string; localStorage?: Array<{ name?: string; value?: string }> }>;
  };
  const targetOrigin = new URL(baseUrl).origin;
  for (const origin of raw.origins ?? []) {
    if (origin.origin !== targetOrigin) continue;
    const token = origin.localStorage?.find((entry) => entry.name === "auth_token")?.value;
    if (token) return token;
  }
  throw new Error(`auth_token for ${targetOrigin} not found in ${storageStatePath}`);
}

/**
 * Return true if the canvas was seeded by the QA agent and is safe to delete.
 * Requires BOTH the title prefix AND a `qa-agent-run-*` tag in metadata, so a
 * mere title collision with a human-authored canvas does not trigger deletion.
 */
function isSeededQaCanvas(row: CanvasRow): boolean {
  if (!row.title || !row.title.startsWith(CANVAS_TITLE_PREFIX)) return false;

  const content = row.content;
  if (!content || typeof content !== "object") return false;
  const metadata = (content as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== "object") return false;
  const runTag = (metadata as { qaAgentRunTag?: unknown }).qaAgentRunTag;
  if (typeof runTag !== "string") return false;
  return RUN_TAG_MARKER_REGEX.test(runTag);
}

function ageInHours(row: CanvasRow, now: number): number {
  const ts = row.updated_at ?? row.created_at;
  if (!ts) return Infinity;
  const parsed = Date.parse(ts);
  if (Number.isNaN(parsed)) return Infinity;
  return (now - parsed) / (1000 * 60 * 60);
}

async function listCanvases(baseUrl: string, authToken: string): Promise<CanvasRow[]> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/workbench/canvases/`;
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Canvas list failed ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = (await resp.json()) as { canvases?: CanvasRow[] } | CanvasRow[] | null;
  if (Array.isArray(json)) return json;
  return json?.canvases ?? [];
}

async function deleteCanvas(
  baseUrl: string,
  authToken: string,
  canvasId: string,
): Promise<void> {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/workbench/canvases/${encodeURIComponent(canvasId)}`;
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${authToken}`,
      Accept: "application/json",
      // Mirror the seeder header so DELETE logs stay attributed to the QA
      // agent even when called outside a seed→teardown lifecycle.
      "X-QA-Agent-Run": "qa-agent-orphan-sweep",
    },
  });
  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => "");
    throw new Error(`DELETE ${canvasId} failed ${resp.status}: ${text.slice(0, 300)}`);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.baseUrl) {
    throw new Error("--base-url (or QA_BASE_URL env) is required");
  }
  const storageStatePath = resolveStorageStatePath(args.storageStatePath);
  const authToken = extractAuthToken(storageStatePath, args.baseUrl);

  log(
    `baseUrl=${args.baseUrl} olderThanHours=${args.olderThanHours} execute=${args.execute} storageState=${storageStatePath}`,
  );
  if (!args.execute) {
    log("DRY RUN — no canvases will be deleted");
  }

  const allCanvases = await listCanvases(args.baseUrl, authToken);
  const now = Date.now();
  const candidates = allCanvases.filter((row) => isSeededQaCanvas(row));
  const stale = candidates.filter((row) => ageInHours(row, now) >= args.olderThanHours);

  log(
    `tenant has ${allCanvases.length} canvas(es); ${candidates.length} seeded-by-QA; ${stale.length} orphan(s) older than ${args.olderThanHours}h`,
  );

  // Echo newest-first so humans scanning the log can spot anything
  // suspicious (e.g. a QA canvas created 5 minutes ago would usually be a
  // live run, not an orphan). Only delete past the --older-than-hours line.
  stale.sort(
    (a, b) => Date.parse(b.updated_at ?? b.created_at ?? "") - Date.parse(a.updated_at ?? a.created_at ?? ""),
  );

  for (const row of stale) {
    log(
      `orphan id=${row.id} title="${row.title}" age=${ageInHours(row, now).toFixed(1)}h`,
    );
  }

  if (!args.execute || stale.length === 0) {
    if (stale.length === 0) log("no orphans to delete");
    else log("DRY RUN complete (pass --execute to delete)");
    return;
  }

  let deleted = 0;
  const errors: string[] = [];
  for (const row of stale) {
    try {
      await deleteCanvas(args.baseUrl, authToken, row.id);
      deleted++;
    } catch (err) {
      errors.push(`${row.id}: ${(err as Error).message}`);
    }
  }
  log(`deleted ${deleted}/${stale.length} orphan canvas(es)`);
  if (errors.length > 0) {
    log(`errors: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? " …" : ""}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[sweep] fatal:", err);
  process.exit(1);
});
