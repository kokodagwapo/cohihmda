/**
 * Unified chat v1 envelope parsing and POST helpers (COHI-396).
 * Enable production path with VITE_UNIFIED_CHAT=true.
 * E2E may set sessionStorage.cohi_force_unified_chat = "1" before navigation.
 * E2E may set localStorage.cohi_e2e_legacy_chat_only = "1" to keep legacy session APIs (overrides VITE).
 */

import { api } from "@/lib/api";
import type { WidgetAction } from "@/types/widgetActions";

const FORCE_UNIFIED_KEY = "cohi_force_unified_chat";
/** Playwright / manual: force legacy `/api/cohi-chat/*` session + ask paths while VITE_UNIFIED_CHAT is true */
const LEGACY_ONLY_KEY = "cohi_e2e_legacy_chat_only";

export type UnifiedChatBlock =
  | { type: "text"; markdown: string }
  | { type: "citations"; items: { title?: string; snippet?: string }[] }
  | { type: "visualization"; artifactId?: string; config: unknown }
  | { type: "actions"; items: unknown[]; teachingNotes?: string }
  | {
      type: "artifacts";
      items: Array<{
        kind: "ppt_export" | "canvas_build" | "file" | "chart_ref" | string;
        ref: string;
        meta?: {
          insightBuilderPreview?: boolean;
          draft?: Record<string, unknown>;
          actions?: string[];
          [key: string]: unknown;
        };
      }>;
    }
  | { type: "navigation_hints"; items: { label: string; path: string }[] }
  | { type: "safety"; reason: string; category?: string };

export interface UnifiedChatV1Response {
  conversationId: string;
  turn: { id: string; blocks: UnifiedChatBlock[] };
  metadata?: {
    promptHash?: string;
    suggestedQuestions?: string[];
    sqlQuery?: string;
    sources?: { dataQuery?: boolean; knowledgeBase?: string[] };
    [key: string]: unknown;
  };
}

/** Allowlisted workbench handoff for visualization artifactId (Wave 5 §8). */
export function workbenchArtifactHandoffPath(artifactId: string): string {
  const id = artifactId.trim();
  if (!id) return "/workbench";
  return `/workbench?artifactId=${encodeURIComponent(id)}`;
}

export function isUnifiedChatClientEnabled(): boolean {
  if (typeof window !== "undefined") {
    try {
      if (window.localStorage?.getItem(LEGACY_ONLY_KEY) === "1") {
        return false;
      }
    } catch {
      /* ignore */
    }
    try {
      if (window.sessionStorage?.getItem(FORCE_UNIFIED_KEY) === "1") {
        return true;
      }
    } catch {
      /* ignore */
    }
  }
  try {
    return import.meta.env.VITE_UNIFIED_CHAT === "true";
  } catch {
    return false;
  }
}

function withTenant(basePath: string, tid: string | null): string {
  if (!tid) return basePath;
  const sep = basePath.includes("?") ? "&" : "?";
  return `${basePath}${sep}tenant_id=${encodeURIComponent(tid)}`;
}

export { createUnifiedChatClient, WORKBENCH_HUB_SCOPE_IDS } from "@/lib/unifiedChatClient";

export async function resolveDefaultTenantId(
  explicit?: string | null,
): Promise<string | null> {
  if (explicit) return explicit;
  try {
    const response = await api.request<
      { tenants: { id: string }[] } | { id: string }[]
    >("/api/tenants");
    const list = Array.isArray(response)
      ? response
      : (response as { tenants: { id: string }[] }).tenants || [];
    return list[0]?.id ?? null;
  } catch {
    try {
      const defaultRes = await api.request<{ tenantId: string | null }>(
        "/api/cohi-chat/default-tenant",
      );
      return defaultRes?.tenantId ?? null;
    } catch {
      return null;
    }
  }
}

/** Custom event for COHI-404 shell auto full-page (meeting spec §4.6). */
export const RESEARCH_SHELL_EXPAND_EVENT = "cohi-research-shell-expand";

export function dispatchResearchShellExpandIfNeeded(
  metadata?: Record<string, unknown>,
): void {
  if (
    typeof window === "undefined" ||
    !metadata?.researchShellExpand
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(RESEARCH_SHELL_EXPAND_EVENT, { detail: metadata }),
  );
}

export interface InsightBuilderDraftPreview {
  title: string;
  prompt_text: string;
  schedule: "batch" | "on_demand";
  prompt_tag?: string;
  specifiers: Record<string, unknown>;
}

export type InsightBuilderPhase = "gathering" | "preview" | "approved";

export interface ParsedGlobalUnifiedFields {
  message: string;
  visualization?: unknown;
  /** COHI-394 stable viz handoff id from visualization blocks */
  visualizationArtifactId?: string;
  sqlQuery?: string;
  sources?: { dataQuery?: boolean; knowledgeBase?: string[] };
  suggestedQuestions?: string[];
  navigationHints?: { label: string; path: string }[];
  insightBuilderDraft?: InsightBuilderDraftPreview;
  insightBuilderPhase?: InsightBuilderPhase;
}

/** Extract insight builder preview draft from assistant blocks (COHI-406). */
export function parseInsightBuilderDraftFromBlocks(
  blocks: UnifiedChatBlock[],
): InsightBuilderDraftPreview | undefined {
  for (const b of blocks) {
    if (b.type !== "artifacts" || !Array.isArray(b.items)) continue;
    for (const item of b.items) {
      const meta = item?.meta as
        | { insightBuilderPreview?: boolean; draft?: InsightBuilderDraftPreview }
        | undefined;
      if (meta?.insightBuilderPreview && meta.draft?.title && meta.draft?.prompt_text) {
        const d = meta.draft as InsightBuilderDraftPreview;
        const tag =
          typeof d.prompt_tag === "string"
            ? d.prompt_tag
            : typeof (d.specifiers as Record<string, unknown>)?._prompt_tag === "string"
              ? String((d.specifiers as Record<string, unknown>)._prompt_tag)
              : "";
        return {
          title: d.title,
          prompt_text: d.prompt_text,
          schedule: d.schedule === "on_demand" ? "on_demand" : "batch",
          prompt_tag: tag,
          specifiers: d.specifiers ?? {},
        };
      }
    }
  }
  return undefined;
}

function normalizeInsightBuilderPhase(
  value: unknown,
): InsightBuilderPhase | undefined {
  return value === "gathering" || value === "preview" || value === "approved"
    ? value
    : undefined;
}

/** Resolve insight builder phase from persisted turn metadata and/or artifact blocks. */
export function inferInsightBuilderPhase(
  blocks: UnifiedChatBlock[],
  message: string,
  metadata?: Record<string, unknown>,
): InsightBuilderPhase | undefined {
  const fromMeta = normalizeInsightBuilderPhase(metadata?.insightBuilderPhase);
  if (fromMeta) return fromMeta;

  for (const b of blocks) {
    if (b.type !== "artifacts" || !Array.isArray(b.items)) continue;
    for (const item of b.items) {
      const meta = item?.meta as Record<string, unknown> | undefined;
      if (!meta?.insightBuilderPreview) continue;
      const fromBlock = normalizeInsightBuilderPhase(meta.insightBuilderPhase);
      if (fromBlock) return fromBlock;
      if (meta.approved === true) return "approved";
      if (
        Array.isArray(meta.actions) &&
        meta.actions.length === 0 &&
        meta.draft
      ) {
        return "approved";
      }
    }
  }

  if (!parseInsightBuilderDraftFromBlocks(blocks)) return undefined;

  if (/has been saved to|saved to \[My Prompts\]/i.test(message)) {
    return "approved";
  }

  return "preview";
}

/** Build fields from stored assistant `blocks` or a stream result. */
export function parseGlobalFromBlocks(
  blocks: UnifiedChatBlock[],
  metadata?: Record<string, unknown>,
): ParsedGlobalUnifiedFields {
  return parseGlobalUnifiedEnvelope({
    conversationId: "",
    turn: { id: "", blocks },
    metadata,
  });
}

export function parseGlobalUnifiedEnvelope(
  env: UnifiedChatV1Response,
): ParsedGlobalUnifiedFields {
  const blocks = env.turn.blocks;
  let message = "";
  let visualization: unknown;
  let visualizationArtifactId: string | undefined;
  const kbFromCitations: string[] = [];
  let navigationHints: { label: string; path: string }[] | undefined;

  for (const b of blocks) {
    if (b.type === "text") {
      message = message ? `${message}\n\n${b.markdown}` : b.markdown;
    } else if (b.type === "visualization") {
      visualization = b.config;
      if (b.artifactId) visualizationArtifactId = b.artifactId;
    } else if (b.type === "citations" && Array.isArray(b.items)) {
      for (const it of b.items) {
        if (it?.title) kbFromCitations.push(it.title);
      }
    } else if (b.type === "navigation_hints" && Array.isArray(b.items)) {
      navigationHints = b.items as { label: string; path: string }[];
    }
  }

  const meta = env.metadata ?? {};
  const sources = meta.sources;
  const mergedSources =
    kbFromCitations.length > 0
      ? {
          ...sources,
          knowledgeBase: [
            ...(sources?.knowledgeBase ?? []),
            ...kbFromCitations,
          ],
        }
      : sources;

  const insightBuilderPhase = inferInsightBuilderPhase(
    blocks,
    message.trim(),
    meta,
  );

  return {
    message: message.trim() || "(no response)",
    visualization,
    visualizationArtifactId,
    sqlQuery: meta.sqlQuery as string | undefined,
    sources: mergedSources,
    suggestedQuestions: meta.suggestedQuestions as string[] | undefined,
    navigationHints,
    insightBuilderDraft: parseInsightBuilderDraftFromBlocks(blocks),
    insightBuilderPhase,
  };
}

export interface ParsedWorkbenchUnifiedFields {
  message: string;
  actions?: WidgetAction[];
  teachingNotes?: string;
  suggestedQuestions?: string[];
  error?: string;
}

export function parseWorkbenchUnifiedEnvelope(
  env: UnifiedChatV1Response,
): ParsedWorkbenchUnifiedFields {
  const blocks = env.turn.blocks;
  let message = "";
  let actions: WidgetAction[] | undefined;
  let teachingNotes: string | undefined;
  let error: string | undefined;

  for (const b of blocks) {
    if (b.type === "text") {
      message = message ? `${message}\n\n${b.markdown}` : b.markdown;
    } else if (b.type === "actions") {
      actions = (b.items ?? []) as WidgetAction[];
      teachingNotes = b.teachingNotes ?? teachingNotes;
    } else if (b.type === "safety") {
      error = b.reason;
    }
  }

  const meta = env.metadata ?? {};
  return {
    message: message.trim() || "I processed your request.",
    actions,
    teachingNotes,
    suggestedQuestions: meta.suggestedQuestions as string[] | undefined,
    error,
  };
}

export async function postUnifiedChatV1(
  body: Record<string, unknown>,
  tenantId?: string | null,
): Promise<UnifiedChatV1Response> {
  const tid = await resolveDefaultTenantId(tenantId ?? undefined);
  const path = withTenant("/api/chat/v1/messages", tid);
  return api.request<UnifiedChatV1Response>(path, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function postUnifiedWorkbenchHubQuery(
  prompt: string,
  tenantId?: string | null,
  hubScopeId?: string,
): Promise<string> {
  const env = await postUnifiedChatV1(
    {
      message: prompt.trim(),
      clientMessageId: crypto.randomUUID(),
      location: { surface: "workbench_hub" },
      scope: {
        type: "workbench_hub",
        ...(hubScopeId ? { id: hubScopeId } : {}),
      },
      history: [],
    },
    tenantId,
  );
  const parsed = parseGlobalUnifiedEnvelope(env);
  return parsed.message;
}
