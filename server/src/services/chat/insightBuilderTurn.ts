/**
 * Insight builder mode turn handler (COHI-388 / meeting spec §5).
 */

import { callLLM, type LLMMessage, getOpenAIKey } from "../research/tools.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import { getColumnsForTenant, columnToLabel } from "../ai/schemaContextService.js";
import { buildSpecifierPredicateSql } from "../insights/userInsightSpecifierPredicate.js";
import type { UnifiedBlock } from "./unifiedChatMappers.js";
import type { ComposedPromptBundle } from "./promptComposer.js";
import { suggestLoanColumns, type LoanColumnSuggestion } from "./suggestLoanColumns.js";
import { normalizeInsightBuilderSpecifiers } from "./insightBuilderSpecifiers.js";
import {
  buildValueClarificationMessage,
  findSpecifierValueClarifications,
} from "./insightBuilderSpecifierValues.js";

const INSIGHT_BUILDER_DEBUG =
  process.env.INSIGHT_BUILDER_DEBUG === "1" ||
  process.env.INSIGHT_BUILDER_DEBUG === "true";

function ibDebug(...args: unknown[]): void {
  if (INSIGHT_BUILDER_DEBUG) {
    console.log("[insightBuilder]", ...args);
  }
}

export interface InsightBuilderDraft {
  title: string;
  prompt_text: string;
  schedule: "batch" | "on_demand";
  prompt_tag?: string;
  specifiers: Record<string, unknown>;
}

export interface InsightBuilderTurnOptions {
  action?: "approve" | "revise";
}

interface InsightBuilderLlmResponse {
  phase?: "gathering" | "preview";
  assistantMessage?: string;
  draft?: InsightBuilderDraft | null;
  questions?: string[];
  columnClarifications?: Array<{ userTerm?: string; suggestedColumns?: string[] }>;
}

const APPROVE_RE = /^\s*(approve|yes|confirm|save)\s*$/i;

const COMMON_COLUMN_NAMES = new Set([
  "fico_score",
  "credit_score",
  "loan_type",
  "loan_purpose",
  "branch",
  "loan_officer",
  "loan_status",
  "channel",
  "state",
  "loan_amount",
]);

function draftPreviewBlock(
  draft: InsightBuilderDraft,
  options?: { approved?: boolean },
): UnifiedBlock {
  const approved = options?.approved === true;
  return {
    type: "artifacts",
    items: [
      {
        kind: "file",
        ref: "insight_builder_preview",
        meta: {
          insightBuilderPreview: true,
          draft,
          insightBuilderPhase: approved ? "approved" : "preview",
          ...(approved
            ? { approved: true }
            : { actions: ["approve", "request_changes"] }),
        },
      },
    ],
  };
}

function specifiersWithTag(draft: InsightBuilderDraft): Record<string, unknown> {
  const spec = { ...(draft.specifiers ?? {}) };
  const tag = (draft.prompt_tag ?? "").trim().toLowerCase();
  if (
    tag &&
    ["operations", "sales", "finance", "secondary_marketing", "compliance"].includes(tag)
  ) {
    spec._prompt_tag = tag;
  } else {
    delete spec._prompt_tag;
  }
  return spec;
}

function normalizeDraft(raw: InsightBuilderDraft | null | undefined): InsightBuilderDraft | null {
  if (!raw?.title?.trim() || !raw?.prompt_text?.trim()) return null;
  const tag = (raw.prompt_tag ?? "").trim().toLowerCase();
  let promptTag = "";
  if (["operations", "sales", "finance", "secondary_marketing", "compliance"].includes(tag)) {
    promptTag = tag;
  } else if (raw.specifiers && typeof raw.specifiers._prompt_tag === "string") {
    const fromSpec = raw.specifiers._prompt_tag.trim().toLowerCase();
    if (
      ["operations", "sales", "finance", "secondary_marketing", "compliance"].includes(fromSpec)
    ) {
      promptTag = fromSpec;
    }
  }
  let specifiers: Record<string, unknown> | unknown[] = {};
  if (raw.specifiers != null && typeof raw.specifiers === "object") {
    specifiers = Array.isArray(raw.specifiers)
      ? raw.specifiers
      : { ...(raw.specifiers as Record<string, unknown>) };
  }

  return {
    title: raw.title.trim(),
    prompt_text: raw.prompt_text.trim(),
    schedule: raw.schedule === "on_demand" ? "on_demand" : "batch",
    prompt_tag: promptTag,
    specifiers: specifiers as Record<string, unknown>,
  };
}

function mergeDraftWithPending(
  incoming: InsightBuilderDraft,
  pending: InsightBuilderDraft | null | undefined,
  columns: { name: string; type: string }[],
  allowedColumns: Set<string>,
): InsightBuilderDraft {
  const base = pending
    ? {
        title: pending.title,
        prompt_text: pending.prompt_text,
        schedule: pending.schedule,
        prompt_tag: pending.prompt_tag ?? "",
        specifiers: normalizeInsightBuilderSpecifiers(
          pending.specifiers as unknown,
          columns,
          allowedColumns,
        ),
      }
    : null;

  const incomingSpec = normalizeInsightBuilderSpecifiers(
    incoming.specifiers as unknown,
    columns,
    allowedColumns,
  );

  const mergedSpecifiers = {
    ...(base?.specifiers ?? {}),
    ...incomingSpec,
  };

  return {
    title: incoming.title || base?.title || "",
    prompt_text: incoming.prompt_text || base?.prompt_text || "",
    schedule: incoming.schedule ?? base?.schedule ?? "batch",
    prompt_tag: incoming.prompt_tag || base?.prompt_tag || "",
    specifiers: mergedSpecifiers,
  };
}

function parseLlmJson(raw: string): InsightBuilderLlmResponse | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as InsightBuilderLlmResponse;
  } catch {
    return null;
  }
}

function buildColumnCatalog(
  columns: { name: string; type: string }[],
  userMessage: string,
): string {
  const mentioned = suggestLoanColumns(userMessage, columns, 8).map((c) => c.name);
  const picked = new Set<string>([...mentioned, ...COMMON_COLUMN_NAMES]);
  const lines: string[] = [];
  for (const col of columns) {
    if (picked.has(col.name) || lines.length < 40) {
      lines.push(`- ${col.name} (${columnToLabel(col.name)}, ${col.type})`);
      if (lines.length >= 60) break;
    }
  }
  return lines.join("\n");
}

function formatColumnSuggestions(suggestions: LoanColumnSuggestion[]): string {
  if (!suggestions.length) return "";
  return suggestions
    .map((s) => `**${s.name}** (${s.label})`)
    .join(", ");
}

function buildClarificationMessage(
  invalidKeys: string[],
  allowedColumns: Set<string>,
  columns: { name: string; type: string }[],
): string {
  const parts: string[] = [
    "I couldn't map one or more filters to your loans table. Please clarify which column to use:",
  ];
  for (const key of invalidKeys) {
    const suggestions = suggestLoanColumns(key, columns, 5);
    if (suggestions.length) {
      parts.push(
        `- For **${key}**: did you mean ${formatColumnSuggestions(suggestions)}?`,
      );
    } else {
      parts.push(`- **${key}** is not a valid loans-table column.`);
    }
  }
  parts.push("Reply with the correct column name(s), then I'll update the draft.");
  return parts.join("\n\n");
}

type ValidateResult =
  | { ok: true; draft: InsightBuilderDraft }
  | { ok: false; message: string; invalidKeys: string[] };

async function validateDraft(
  draft: InsightBuilderDraft,
  allowedColumns: Set<string>,
  columns: { name: string; type: string }[],
  tenantId: string,
): Promise<ValidateResult> {
  const normalized = normalizeDraft(draft);
  if (!normalized) {
    return {
      ok: false,
      message: "Title and prompt text are required before preview.",
      invalidKeys: [],
    };
  }
  const specifiers = specifiersWithTag(normalized);
  const pred = buildSpecifierPredicateSql(specifiers, allowedColumns);
  if (!pred.ok) {
    return {
      ok: false,
      message: buildClarificationMessage(pred.invalidKeys, allowedColumns, columns),
      invalidKeys: pred.invalidKeys,
    };
  }
  const pool = await tenantDbManager.getTenantPool(tenantId);
  const valueIssues = await findSpecifierValueClarifications(
    pool,
    tenantId,
    specifiers,
  );
  if (valueIssues.length) {
    return {
      ok: false,
      message: buildValueClarificationMessage(valueIssues),
      invalidKeys: [],
    };
  }
  return { ok: true, draft: { ...normalized, specifiers } };
}

/** Prevent duplicate My Prompts rows when approve is submitted twice in quick succession. */
async function persistUserInsightPrompt(
  tenantId: string,
  userId: string,
  draft: InsightBuilderDraft,
): Promise<string> {
  const pool = await tenantDbManager.getTenantPool(tenantId);
  const specifiers = specifiersWithTag(draft);
  const specifiersJson = JSON.stringify(specifiers);
  const schedule = draft.schedule ?? "batch";
  const lockKey = `ib_approve:${userId}:${draft.title}:${draft.prompt_text}:${specifiersJson}:${schedule}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1::text))`, [lockKey]);

    const existing = await client.query<{ id: string }>(
      `SELECT id::text
       FROM public.user_insight_prompts
       WHERE user_id = $1
         AND title = $2
         AND prompt_text = $3
         AND specifiers = $4::jsonb
         AND COALESCE(schedule, 'batch') = $5
         AND scope = 'user'
         AND created_at > NOW() - INTERVAL '10 minutes'
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, draft.title, draft.prompt_text, specifiersJson, schedule],
    );
    if (existing.rows.length > 0) {
      ibDebug("Reusing existing user_insight_prompts row:", existing.rows[0].id);
      await client.query("COMMIT");
      return existing.rows[0].id;
    }

    const inserted = await client.query<{ id: string }>(
      `INSERT INTO public.user_insight_prompts
        (user_id, title, prompt_text, specifiers, schedule, enabled, scope)
       VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, 'batch'), true, 'user')
       RETURNING id::text`,
      [userId, draft.title, draft.prompt_text, specifiersJson, schedule],
    );
    await client.query("COMMIT");
    return inserted.rows[0].id;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function runInsightBuilderTurn(args: {
  tenantId: string;
  userId: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  bundle: ComposedPromptBundle;
  pendingDraft?: InsightBuilderDraft | null;
  options?: InsightBuilderTurnOptions;
}): Promise<{
  blocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
  persistedPromptId?: string;
}> {
  const trimmed = args.message.trim();
  const columns = await getColumnsForTenant(args.tenantId);
  const allowedColumns = new Set(columns.map((c) => c.name));

  const isApprove =
    args.options?.action === "approve" ||
    (args.pendingDraft && APPROVE_RE.test(trimmed));

  if (isApprove && args.pendingDraft) {
    const validated = await validateDraft(
      args.pendingDraft,
      allowedColumns,
      columns,
      args.tenantId,
    );
    if (!validated.ok) {
      return {
        blocks: [{ type: "text", markdown: validated.message }],
        metadata: {
          insightBuilderPhase: "gathering",
          draft: null,
          invalidSpecifierKeys: validated.invalidKeys,
        },
      };
    }
    let promptId: string | undefined;
    try {
      promptId = await persistUserInsightPrompt(
        args.tenantId,
        args.userId,
        validated.draft,
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[insightBuilder] persist failed:", msg);
    }
    return {
      blocks: [
        {
          type: "text",
          markdown: promptId
            ? `Your insight prompt **${validated.draft.title}** has been saved to [My Prompts](/insights). You can edit it anytime from the My Insights tab.`
            : "Approved, but saving to My Prompts failed — try again from `/insights`.",
        },
        draftPreviewBlock(validated.draft, { approved: true }),
      ],
      metadata: {
        insightBuilderPhase: "approved",
        draft: validated.draft,
        persistedPromptId: promptId ?? null,
      },
      persistedPromptId: promptId,
    };
  }

  const apiKey = await getOpenAIKey(args.tenantId);
  const catalog = buildColumnCatalog(columns, trimmed);
  const revisionContext = args.pendingDraft
    ? `\n\nPrevious draft JSON:\n${JSON.stringify(args.pendingDraft, null, 2)}`
    : "";
  const system = `${args.bundle.systemSections.join("\n\n")}\n\n## Loans table columns (use exact names only)\n${catalog}${revisionContext}`;

  const messages: LLMMessage[] = [
    { role: "system", content: system },
    ...args.history.slice(-12).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: trimmed },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.35,
    maxTokens: 4000,
    tenantId: args.tenantId,
    requestedBy: "unified_chat:insight_builder",
    tag: "insight_builder",
  });

  ibDebug("LLM raw response:", raw);
  const parsed = parseLlmJson(raw);
  ibDebug("LLM parsed JSON:", JSON.stringify(parsed, null, 2));

  const assistantMessage =
    parsed?.assistantMessage?.trim() ||
    "Tell me what insight prompt you'd like to create for My Insights.";

  let draft = normalizeDraft(parsed?.draft ?? null);
  if (draft) {
    draft = mergeDraftWithPending(draft, args.pendingDraft, columns, allowedColumns);
    ibDebug("Draft after merge + specifier normalize:", JSON.stringify(draft, null, 2));
  }
  if (draft) {
    const validated = await validateDraft(
      draft,
      allowedColumns,
      columns,
      args.tenantId,
    );
    if (!validated.ok) {
      return {
        blocks: [{ type: "text", markdown: validated.message }],
        metadata: {
          insightBuilderPhase: "gathering",
          draft: null,
          invalidSpecifierKeys: validated.invalidKeys,
        },
      };
    }
    draft = validated.draft;
    ibDebug("Draft validated specifiers:", JSON.stringify(draft.specifiers, null, 2));
  }

  const phase =
    parsed?.phase === "preview" && draft ? "preview" : draft ? "preview" : "gathering";

  const blocks: UnifiedBlock[] = [{ type: "text", markdown: assistantMessage }];
  if (phase === "preview" && draft) {
    blocks.push(draftPreviewBlock(draft));
  }

  return {
    blocks,
    metadata: {
      insightBuilderPhase: phase,
      draft: phase === "preview" ? draft : null,
      questions: parsed?.questions ?? [],
    },
  };
}
