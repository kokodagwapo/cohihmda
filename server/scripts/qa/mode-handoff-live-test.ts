/**
 * Live local integration tests for cross-mode handoff (unified chat).
 *
 * Usage (from server/):
 *   npx tsx scripts/qa/mode-handoff-live-test.ts
 *   COHI_LIVE_AUTH_TOKEN=<jwt> npx tsx scripts/qa/mode-handoff-live-test.ts
 *
 * Without COHI_LIVE_AUTH_TOKEN, resolves the first active tenant user from the
 * management DB and mints a JWT using JWT_SECRET (local dev only).
 */

import pg from "pg";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import { join } from "path";
import { randomUUID } from "crypto";
import { getJwtSecret } from "../../src/middleware/auth.js";

dotenv.config({ path: join(process.cwd(), ".env") });

const BASE = (process.env.COHI_API_BASE_URL ?? "http://localhost:3001").replace(
  /\/$/,
  "",
);

type ScenarioResult = {
  id: string;
  ok: boolean;
  detail: string;
  ms: number;
};

const sampleCanvas = {
  groups: [
    {
      groupId: "live-g1",
      title: "Pipeline KPIs",
      sectionType: "default",
      widgetIds: ["w-live-1"],
      widgets: [
        {
          id: "w-live-1",
          kind: "registry" as const,
          defId: "loan_volume",
          title: "Loan Volume",
        },
      ],
    },
  ],
  standaloneWidgets: [],
  totalItems: 1,
};

function handoffPayload(overrides: Record<string, unknown> = {}) {
  return {
    fromChatType: "workbench",
    fromConversationId: randomUUID(),
    fromTitle: "Live test board",
    canvasState: sampleCanvas,
    widgetCatalog: "- loan_volume: Loan Volume (registry)",
    canvasId: "live-canvas-1",
    canvasTitle: "Handoff Live Canvas",
    route: "/my-dashboard/live-canvas-1",
    ...overrides,
  };
}

async function resolveAuthToken(): Promise<string> {
  if (process.env.COHI_LIVE_AUTH_TOKEN?.trim()) {
    return process.env.COHI_LIVE_AUTH_TOKEN.trim();
  }

  const mgPool = new pg.Pool({
    host: process.env.DB_HOST ?? "127.0.0.1",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "postgres",
    password: process.env.DB_PASSWORD ?? "postgres",
    database: process.env.MANAGEMENT_DB_NAME ?? "coheus_management",
    connectionTimeoutMillis: 5000,
    query_timeout: 8000,
  });

  try {
    const tenantRes = await mgPool.query<{ id: string; slug: string }>(
      `SELECT id, slug FROM coheus_tenants
       WHERE status = 'active' OR status IS NULL
       ORDER BY created_at ASC NULLS LAST
       LIMIT 1`,
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) throw new Error("No active tenant in management DB");

    const tenantDbRes = await mgPool.query<{ database_name: string }>(
      `SELECT database_name FROM coheus_tenants WHERE id = $1`,
      [tenant.id],
    );
    const dbName = tenantDbRes.rows[0]?.database_name;
    if (!dbName) throw new Error(`Tenant ${tenant.slug} missing database_name`);

    const tenantPool = new pg.Pool({
      host: process.env.DB_HOST ?? "127.0.0.1",
      port: Number(process.env.DB_PORT ?? 5432),
      user: process.env.DB_USER ?? "postgres",
      password: process.env.DB_PASSWORD ?? "postgres",
      database: dbName,
      connectionTimeoutMillis: 5000,
      query_timeout: 8000,
    });

    let user: { id: string; email: string; role: string };
    try {
      const userRes = await tenantPool.query<{
        id: string;
        email: string;
        role: string;
      }>(
        `SELECT id, email, role FROM users
         WHERE is_active = true
         ORDER BY created_at ASC LIMIT 1`,
      );
      user = userRes.rows[0];
      if (!user) throw new Error(`No active user in tenant DB ${dbName}`);
    } finally {
      await tenantPool.end();
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role === "admin" ? "tenant_admin" : "user",
        isSuperAdmin: false,
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        persona: user.role === "admin" ? "tenant_admin" : "tenant_user",
      },
      getJwtSecret(),
      { expiresIn: "1h" },
    );
    console.log(`Minted JWT for ${user.email} @ ${tenant.slug}`);
    return token;
  } finally {
    await mgPool.end();
  }
}

function parseSseEvents(text: string): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  for (const line of text.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    try {
      events.push(JSON.parse(line.slice(6)) as Record<string, unknown>);
    } catch {
      /* ignore */
    }
  }
  return events;
}

async function postResearchStream(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; events: Record<string, unknown>[]; text: string }> {
  const res = await fetch(`${BASE}/api/chat/v1/messages:stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      options: { stream: true, research: { deepAnalysis: false } },
      ...body,
    }),
  });
  const text = await res.text();
  return { status: res.status, events: parseSseEvents(text), text };
}

async function postInsightBuilderStream(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; events: Record<string, unknown>[]; text: string }> {
  const res = await fetch(`${BASE}/api/chat/v1/messages:stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      clientMessageId: randomUUID(),
      options: { stream: true },
      ...body,
    }),
  });
  const text = await res.text();
  return { status: res.status, events: parseSseEvents(text), text };
}

async function getResearchSession(
  token: string,
  sessionId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${BASE}/api/research/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

function manifestTiers(events: Record<string, unknown>[]): string[] {
  const started = events.find((e) => e.event === "turn.started");
  const meta = (started?.metadata ?? {}) as {
    contextManifest?: { tier?: string }[];
  };
  return (meta.contextManifest ?? [])
    .map((m) => m.tier)
    .filter((t): t is string => !!t);
}

async function runScenario(
  id: string,
  fn: () => Promise<void>,
): Promise<ScenarioResult> {
  const t0 = Date.now();
  try {
    await fn();
    return { id, ok: true, detail: "pass", ms: Date.now() - t0 };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { id, ok: false, detail: msg, ms: Date.now() - t0 };
  }
}

async function main() {
  console.log(`\n=== Mode handoff live tests @ ${BASE} ===\n`);

  const health = await fetch(`${BASE}/api/health`);
  if (!health.ok) {
    console.error(`Server not healthy: ${health.status}`);
    process.exit(1);
  }

  const token = await resolveAuthToken();
  const results: ScenarioResult[] = [];

  // 1) Baseline: global research without handoff
  results.push(
    await runScenario("global_research_no_handoff", async () => {
      const { status, events } = await postResearchStream(token, {
        message: "Summarize loan volume trends (live test, no handoff)",
        chat_type: "research",
        location: { surface: "data_chat_page" },
        scope: { type: "global_session" },
      });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      const tiers = manifestTiers(events);
      if (tiers.some((t) => t === "workbench_snapshot")) {
        throw new Error(`unexpected workbench_snapshot in manifest: ${tiers.join(",")}`);
      }
      const completed = events.find((e) => e.event === "turn.completed");
      const meta = (completed?.metadata ?? events[0]?.metadata ?? {}) as {
        researchSessionId?: string;
        researchPollMode?: boolean;
      };
      if (!meta.researchSessionId) throw new Error("missing researchSessionId");
      if (!meta.researchPollMode) throw new Error("expected researchPollMode");
    }),
  );

  // 2) Canvas-origin research with structural handoff
  let canvasResearchSessionId: string | null = null;
  results.push(
    await runScenario("canvas_research_with_handoff", async () => {
      const canvasId = randomUUID();
      const { status, events, text } = await postResearchStream(token, {
        message: "Investigate metrics on this dashboard board (live handoff test)",
        chat_type: "research",
        location: {
          surface: "workbench_canvas",
          route: `/my-dashboard/${canvasId}`,
        },
        scope: { type: "canvas", id: canvasId },
        context: {
          modeHandoffContext: handoffPayload({
            canvasId,
            route: `/my-dashboard/${canvasId}`,
          }),
        },
      });
      if (status !== 200) {
        throw new Error(`HTTP ${status}: ${text.slice(0, 300)}`);
      }
      const tiers = manifestTiers(events);
      if (!tiers.includes("workbench_snapshot")) {
        throw new Error(`expected workbench_snapshot tier, got: ${tiers.join(",") || "(none)"}`);
      }
      if (!tiers.includes("research_registry")) {
        throw new Error(`expected research_registry tier, got: ${tiers.join(",")}`);
      }
      const completed = events.find((e) => e.event === "turn.completed");
      const meta = (completed?.metadata ?? {}) as { researchSessionId?: string };
      if (!meta.researchSessionId) throw new Error("missing researchSessionId");
      canvasResearchSessionId = meta.researchSessionId;

      const sess = await getResearchSession(token, meta.researchSessionId);
      if (sess.status !== 200) throw new Error(`session GET ${sess.status}`);
      const phase = (sess.body as { phase?: string }).phase;
      if (!phase || phase === "error") {
        throw new Error(`unexpected research session phase: ${phase ?? "missing"}`);
      }
      const topic = String((sess.body as { topic?: string }).topic ?? "");
      if (!topic.toLowerCase().includes("dashboard") && !topic.toLowerCase().includes("investigate")) {
        throw new Error(`unexpected session topic: ${topic.slice(0, 80)}`);
      }
    }),
  );

  // 3) Handoff + text carry-over compose
  results.push(
    await runScenario("canvas_research_handoff_plus_carryover", async () => {
      const { status, events } = await postResearchStream(token, {
        message: "Continue from prior workbench thread",
        chat_type: "research",
        location: { surface: "workbench_canvas", route: "/my-dashboard/carry-test" },
        scope: { type: "draft", id: randomUUID() },
        context: {
          modeHandoffContext: handoffPayload(),
          carryOverContext: {
            fromConversationId: randomUUID(),
            fromChatType: "workbench",
            summary: "User asked about pipeline fallout in the prior workbench chat.",
          },
        },
      });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      if (!manifestTiers(events).includes("workbench_snapshot")) {
        throw new Error("missing workbench_snapshot manifest tier");
      }
    }),
  );

  // 4) Insight builder with structural handoff prefix
  results.push(
    await runScenario("insight_builder_with_handoff", async () => {
      const { status, events, text } = await postInsightBuilderStream(token, {
        message: "Draft an insight about loan volume on this board",
        chat_type: "insight_builder",
        location: { surface: "data_chat_page" },
        scope: { type: "global_session" },
        history: [],
        context: { modeHandoffContext: handoffPayload() },
      });
      if (status !== 200) {
        throw new Error(`HTTP ${status}: ${text.slice(0, 300)}`);
      }
      const completed = events.find((e) => e.event === "turn.completed");
      const meta = (completed?.metadata ?? {}) as {
        contextManifest?: { tier?: string }[];
      };
      const tiers = (meta.contextManifest ?? []).map((m) => m.tier).filter(Boolean);
      if (!tiers.includes("workbench_snapshot_ib")) {
        throw new Error(`expected workbench_snapshot_ib, got: ${tiers.join(",")}`);
      }
    }),
  );

  // 5) Invalid handoff (no canvas/catalog) rejected server-side
  results.push(
    await runScenario("invalid_handoff_no_structure", async () => {
      const { status, events } = await postResearchStream(token, {
        message: "No structural handoff",
        chat_type: "research",
        location: { surface: "workbench_canvas" },
        scope: { type: "canvas", id: randomUUID() },
        context: {
          modeHandoffContext: {
            fromConversationId: randomUUID(),
            fromChatType: "workbench",
          },
        },
      });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      if (manifestTiers(events).includes("workbench_snapshot")) {
        throw new Error("should not apply handoff without canvas/catalog");
      }
    }),
  );

  // 6) Draft-scope canvas routing (unsaved board tab)
  results.push(
    await runScenario("draft_scope_research_with_handoff", async () => {
      const draftId = `draft-${randomUUID()}`;
      const { status, events } = await postResearchStream(token, {
        message: "Analyze this draft workbench layout",
        chat_type: "research",
        location: {
          surface: "workbench_canvas",
          route: "/my-dashboard/new",
        },
        scope: { type: "draft", id: draftId },
        context: {
          modeHandoffContext: handoffPayload({
            route: "/my-dashboard/new",
            canvasId: undefined,
          }),
        },
      });
      if (status !== 200) throw new Error(`HTTP ${status}`);
      if (!manifestTiers(events).includes("workbench_snapshot")) {
        throw new Error("missing workbench_snapshot for draft scope");
      }
    }),
  );

  // 7) Global chat ignores structural handoff payload
  results.push(
    await runScenario("global_chat_ignores_handoff", async () => {
      const res = await fetch(`${BASE}/api/chat/v1/messages:stream`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: "Hello — handoff should not affect plain chat",
          chat_type: "chat",
          clientMessageId: randomUUID(),
          location: { surface: "data_chat_page" },
          scope: { type: "global_session" },
          context: { modeHandoffContext: handoffPayload() },
          options: { stream: true },
        }),
      });
      const text = await res.text();
      if (res.status !== 200) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
      const tiers = manifestTiers(parseSseEvents(text));
      if (tiers.includes("workbench_snapshot") || tiers.includes("research_registry")) {
        throw new Error(`chat route leaked handoff tiers: ${tiers.join(",")}`);
      }
    }),
  );

  // 8) Follow-up on existing research session (no re-handoff on second message)
  if (canvasResearchSessionId) {
    results.push(
      await runScenario("research_followup_no_duplicate_handoff", async () => {
        const { status, events } = await postResearchStream(token, {
          message: "Follow up: drill into loan volume",
          chat_type: "research",
          conversationId: randomUUID(),
          context: {
            legacyResearchSessionId: canvasResearchSessionId,
            modeHandoffContext: handoffPayload(),
          },
          location: { surface: "data_chat_page" },
          scope: { type: "global_session" },
        });
        if (status !== 200) throw new Error(`HTTP ${status}`);
        // Follow-up reuses session — manifest should not re-emit workbench_snapshot for new session path
        // (handoff only applied on createSession). Poll metadata may still list base tiers only.
        const tiers = manifestTiers(events);
        if (tiers.includes("workbench_snapshot")) {
          throw new Error("follow-up should not re-apply new-session handoff manifest");
        }
      }),
    );
  }

  console.log("\nResults:");
  let failed = 0;
  for (const r of results) {
    const mark = r.ok ? "PASS" : "FAIL";
    if (!r.ok) failed++;
    console.log(`  [${mark}] ${r.id} (${r.ms}ms) — ${r.detail}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
