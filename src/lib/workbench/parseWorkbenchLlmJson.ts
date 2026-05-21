/**
 * Client-side workbench LLM JSON repair (duplicated objects, fences).
 */

import type { UnifiedChatBlock } from "@/lib/unifiedChatEnvelope";
import type { WidgetAction } from "@/types/widgetActions";

export type WorkbenchLlmPayload = {
  message?: string;
  actions?: unknown[];
  teachingNotes?: string;
  suggestedQuestions?: string[];
};

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

export function extractFirstJsonObject(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

export function parseWorkbenchLlmJson(raw: string): WorkbenchLlmPayload | null {
  const candidates: string[] = [];
  const stripped = stripCodeFences(raw);
  candidates.push(stripped);
  const first = extractFirstJsonObject(stripped);
  if (first && first !== stripped) candidates.push(first);
  const fromRaw = extractFirstJsonObject(raw);
  if (fromRaw && !candidates.includes(fromRaw)) candidates.push(fromRaw);

  for (const text of candidates) {
    try {
      const parsed = JSON.parse(text) as WorkbenchLlmPayload;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** True when text looks like a raw workbench JSON blob (not user prose). */
export function looksLikeWorkbenchJsonBlob(text: string): boolean {
  const t = text.trim();
  if (!t.startsWith("{")) return false;
  return (
    t.includes('"actions"') ||
    t.includes('"create_widget"') ||
    t.includes('"message"')
  );
}

export function workbenchPayloadToBlocks(
  payload: WorkbenchLlmPayload,
): UnifiedChatBlock[] {
  const blocks: UnifiedChatBlock[] = [];
  const message =
    typeof payload.message === "string" ? payload.message.trim() : "";
  if (message) {
    blocks.push({ type: "text", markdown: message });
  }
  if (Array.isArray(payload.actions) && payload.actions.length > 0) {
    blocks.push({
      type: "actions",
      items: payload.actions,
      teachingNotes:
        typeof payload.teachingNotes === "string"
          ? payload.teachingNotes
          : undefined,
    });
  }
  return blocks;
}

/**
 * If blocks are a single text blob of workbench JSON, split into text + actions.
 */
export function repairWorkbenchBlocks(
  blocks: UnifiedChatBlock[],
): {
  blocks: UnifiedChatBlock[];
  suggestedQuestions?: string[];
} {
  const hasActions = blocks.some((b) => b.type === "actions");
  if (hasActions) return { blocks };

  const textBlocks = blocks.filter((b) => b.type === "text");
  if (textBlocks.length !== 1 || blocks.length !== 1) return { blocks };

  const markdown = (textBlocks[0] as { markdown?: string }).markdown ?? "";
  if (!looksLikeWorkbenchJsonBlob(markdown)) return { blocks };

  const payload = parseWorkbenchLlmJson(markdown);
  if (!payload) return { blocks };

  const repaired = workbenchPayloadToBlocks(payload);
  if (repaired.length === 0) return { blocks };

  return {
    blocks: repaired,
    suggestedQuestions: Array.isArray(payload.suggestedQuestions)
      ? (payload.suggestedQuestions as string[])
      : undefined,
  };
}

export function workbenchStreamDisplayText(accumulated: string): string {
  const payload = parseWorkbenchLlmJson(accumulated);
  if (payload?.message?.trim()) return payload.message.trim();
  if (looksLikeWorkbenchJsonBlob(accumulated)) {
    return "Working on your request…";
  }
  return accumulated;
}

export function extractWorkbenchActionsFromBlocks(
  blocks: UnifiedChatBlock[],
): WidgetAction[] | undefined {
  for (const b of blocks) {
    if (b.type === "actions" && Array.isArray(b.items)) {
      return b.items as WidgetAction[];
    }
  }
  return undefined;
}
