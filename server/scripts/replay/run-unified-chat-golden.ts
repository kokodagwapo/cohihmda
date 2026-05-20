/**
 * Golden replay harness for unified chat (COHI-397 AC3).
 *
 * Usage:
 *   COHI_REPLAY_AUTH_TOKEN=<jwt> COHI_API_BASE_URL=https://staging.example.com \
 *     npx tsx server/scripts/replay/run-unified-chat-golden.ts
 *
 * Options:
 *   --dry-run     Validate fixture JSON only (no HTTP)
 *   --threshold=0.95   Minimum pass rate (default 0.95)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PROMPTS_PATH = path.join(
  REPO_ROOT,
  "scripts/replay/unified-chat-golden-prompts.json",
);
const FIXTURE_PATH = path.join(__dirname, "unified-chat-golden-fixture.json");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_BLOCK_TYPES = new Set([
  "text",
  "visualization",
  "actions",
  "navigation_hints",
  "artifacts",
  "teaching_notes",
  "error",
]);

type GoldenPrompt = {
  id: string;
  surface: string;
  message: string;
};

type ReplayFailure = { id: string; reason: string };

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`${name}=`));
  return hit?.split("=").slice(1).join("=");
}

function surfaceToLocation(surface: string) {
  switch (surface) {
    case "data_chat_page":
      return { surface: "data_chat_page" as const };
    case "workbench_canvas":
      return { surface: "workbench_canvas" as const };
    case "workbench_hub":
      return { surface: "workbench_hub" as const };
    default:
      return { surface: "data_chat_page" as const };
  }
}

function surfaceToScope(surface: string) {
  switch (surface) {
    case "workbench_canvas":
      return { type: "draft" as const };
    case "workbench_hub":
      return { type: "workbench_hub" as const };
    default:
      return { type: "global_session" as const };
  }
}

function surfaceToChatType(surface: string) {
  if (surface === "workbench_canvas" || surface === "workbench_hub") {
    return "workbench";
  }
  return "chat";
}

function assertStructuralResponse(
  id: string,
  status: number,
  body: Record<string, unknown>,
): string | null {
  if (status !== 200) return `HTTP ${status}`;
  const conversationId = body.conversationId;
  if (typeof conversationId !== "string" || !UUID_RE.test(conversationId)) {
    return "missing or invalid conversationId";
  }
  const turn = body.turn as { blocks?: unknown[] } | undefined;
  const blocks = turn?.blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return "turn.blocks empty";
  }
  for (const block of blocks) {
    const type = (block as { type?: string }).type;
    if (!type || !ALLOWED_BLOCK_TYPES.has(type)) {
      return `unknown block type: ${String(type)}`;
    }
  }
  const metadata = body.metadata as { promptHash?: string } | undefined;
  if (!metadata?.promptHash) {
    return "metadata.promptHash missing";
  }
  return null;
}

async function postGolden(
  baseUrl: string,
  token: string,
  tenantId: string,
  prompt: GoldenPrompt,
): Promise<string | null> {
  const url = new URL("/api/chat/v1/messages", baseUrl);
  url.searchParams.set("tenantId", tenantId);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: prompt.message,
      chat_type: surfaceToChatType(prompt.surface),
      clientMessageId: crypto.randomUUID(),
      location: surfaceToLocation(prompt.surface),
      scope: surfaceToScope(prompt.surface),
      history: [],
    }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return `non-JSON response (HTTP ${res.status})`;
  }
  return assertStructuralResponse(prompt.id, res.status, body);
}

function validateFixtureOnly(): ReplayFailure[] {
  const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8")) as {
    cases?: Array<{ id: string; expectRag?: boolean }>;
  };
  const failures: ReplayFailure[] = [];
  for (const c of fixture.cases ?? []) {
    if (!c.id) failures.push({ id: "fixture", reason: "case missing id" });
  }
  return failures;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const threshold = Number(parseArg("--threshold") ?? process.env.COHI_REPLAY_PASS_THRESHOLD ?? "0.95");

  const promptsFile = JSON.parse(fs.readFileSync(PROMPTS_PATH, "utf8")) as {
    prompts: GoldenPrompt[];
  };
  const prompts = promptsFile.prompts ?? [];

  if (dryRun) {
    const fixtureFailures = validateFixtureOnly();
    const report = {
      mode: "dry-run",
      pass: fixtureFailures.length === 0 ? prompts.length : 0,
      fail: fixtureFailures.length,
      passRate: fixtureFailures.length === 0 ? 1 : 0,
      failures: fixtureFailures,
    };
    console.log(JSON.stringify(report, null, 2));
    process.exit(fixtureFailures.length > 0 ? 1 : 0);
  }

  const baseUrl = process.env.COHI_API_BASE_URL ?? "http://localhost:3001";
  const token = process.env.COHI_REPLAY_AUTH_TOKEN;
  const tenantId = process.env.COHI_REPLAY_TENANT_ID ?? "tenant-unified-e2e";

  if (!token) {
    console.error(
      "COHI_REPLAY_AUTH_TOKEN is required (unless --dry-run). Set UNIFIED_CHAT_ENABLED on the target API.",
    );
    process.exit(1);
  }

  const failures: ReplayFailure[] = [];
  for (const prompt of prompts) {
    const reason = await postGolden(baseUrl, token, tenantId, prompt);
    if (reason) failures.push({ id: prompt.id, reason });
  }

  const pass = prompts.length - failures.length;
  const passRate = prompts.length === 0 ? 1 : pass / prompts.length;
  const report = {
    baseUrl,
    tenantId,
    pass,
    fail: failures.length,
    total: prompts.length,
    passRate,
    threshold,
    failures,
  };
  console.log(JSON.stringify(report, null, 2));

  if (passRate < threshold) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
