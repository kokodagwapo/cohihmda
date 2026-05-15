/**
 * Insight builder mode turn handler (COHI-388 / meeting spec §5).
 */

import { callLLM, type LLMMessage, getOpenAIKey } from "../research/tools.js";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";
import type { UnifiedBlock } from "./unifiedChatMappers.js";
import type { ComposedPromptBundle } from "./promptComposer.js";

export interface InsightBuilderDraft {
  title: string;
  prompt_text: string;
  schedule: "batch" | "on_demand";
  specifiers: Record<string, unknown>;
}

const APPROVE_RE = /^\s*(approve|yes|confirm|save)\s*$/i;
const DENY_RE = /^\s*(deny|no|reject|cancel)\s*$/i;

function draftPreviewBlock(draft: InsightBuilderDraft): UnifiedBlock {
  return {
    type: "artifacts",
    items: [
      {
        kind: "file",
        ref: "insight_builder_preview",
        meta: {
          insightBuilderPreview: true,
          draft,
          actions: ["approve", "deny"],
        },
      },
    ],
  };
}

function parseDraftFromAssistant(text: string): InsightBuilderDraft | null {
  const jsonMatch = text.match(/\{[\s\S]*"title"[\s\S]*"prompt_text"[\s\S]*\}/);
  if (!jsonMatch) return null;
  try {
    const parsed = JSON.parse(jsonMatch[0]) as InsightBuilderDraft;
    if (!parsed.title || !parsed.prompt_text) return null;
    parsed.schedule = parsed.schedule === "on_demand" ? "on_demand" : "batch";
    parsed.specifiers = parsed.specifiers ?? {};
    return parsed;
  } catch {
    return null;
  }
}

async function persistUserInsightPrompt(
  tenantId: string,
  userId: string,
  draft: InsightBuilderDraft,
): Promise<string> {
  const pool = await tenantDbManager.getTenantPool(tenantId);
  const r = await pool.query(
    `INSERT INTO public.user_insight_prompts
      (user_id, title, prompt_text, specifiers, schedule, enabled, scope)
     VALUES ($1, $2, $3, $4::jsonb, COALESCE($5, 'batch'), true, 'user')
     RETURNING id`,
    [
      userId,
      draft.title,
      draft.prompt_text,
      JSON.stringify(draft.specifiers ?? {}),
      draft.schedule ?? "batch",
    ],
  );
  return String(r.rows[0].id);
}

export async function runInsightBuilderTurn(args: {
  tenantId: string;
  userId: string;
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  bundle: ComposedPromptBundle;
  pendingDraft?: InsightBuilderDraft | null;
}): Promise<{
  blocks: UnifiedBlock[];
  metadata: Record<string, unknown>;
  persistedPromptId?: string;
}> {
  const trimmed = args.message.trim();

  if (args.pendingDraft && APPROVE_RE.test(trimmed)) {
    let promptId: string | undefined;
    try {
      promptId = await persistUserInsightPrompt(
        args.tenantId,
        args.userId,
        args.pendingDraft,
      );
    } catch (e: any) {
      console.warn("[insightBuilder] persist failed:", e?.message);
    }
    return {
      blocks: [
        {
          type: "text",
          markdown: promptId
            ? `Your insight prompt **${args.pendingDraft.title}** has been saved to My Insights.`
            : "Approved. Saving to My Insights failed — try again or save from `/insights`.",
        },
        draftPreviewBlock(args.pendingDraft),
      ],
      metadata: {
        insightBuilderPhase: "approved",
        draft: args.pendingDraft,
        persistedPromptId: promptId ?? null,
      },
      persistedPromptId: promptId,
    };
  }

  if (args.pendingDraft && DENY_RE.test(trimmed)) {
    return {
      blocks: [
        {
          type: "text",
          markdown:
            "What would you like to change about the draft prompt? Tell me what's wrong, missing, or unclear.",
        },
      ],
      metadata: { insightBuilderPhase: "denied", draft: null },
    };
  }

  const apiKey = await getOpenAIKey(args.tenantId);
  const system = args.bundle.systemSections.join("\n\n");
  const messages: LLMMessage[] = [
    { role: "system", content: system },
    ...args.history.slice(-12).map((h) => ({
      role: h.role as "user" | "assistant",
      content: h.content,
    })),
    { role: "user", content: trimmed },
  ];

  const raw = await callLLM(messages, apiKey, {
    temperature: 0.4,
    maxTokens: 4000,
    tenantId: args.tenantId,
    requestedBy: "unified_chat:insight_builder",
    tag: "insight_builder",
  });

  const draft = parseDraftFromAssistant(raw);
  const blocks: UnifiedBlock[] = [{ type: "text", markdown: raw }];
  if (draft) {
    blocks.push(draftPreviewBlock(draft));
  }

  return {
    blocks,
    metadata: {
      insightBuilderPhase: draft ? "preview" : "gathering",
      draft: draft ?? null,
    },
  };
}
