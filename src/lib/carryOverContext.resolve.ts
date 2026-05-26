/**
 * Async carry-over resolution (research report fetch).
 */

import { api } from "@/lib/api";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import type { Finding, ResearchReport } from "@/hooks/useResearchSession";
import {
  buildCarryOverContext,
  type ChatMessageForCarryOver,
} from "@/lib/carryOverContext";

const RESEARCH_FETCH_TIMEOUT_MS = 5000;

export async function resolveCarryOverSummary(args: {
  messages: ChatMessageForCarryOver[];
  fromChatType: UnifiedChatType;
  legacyRef?: string | null;
  tenantId?: string | null;
}): Promise<string> {
  const { messages, fromChatType, legacyRef, tenantId } = args;

  if (fromChatType === "research" && legacyRef?.trim()) {
    try {
      const tenantParam = tenantId
        ? `?tenant_id=${encodeURIComponent(tenantId)}`
        : "";
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), RESEARCH_FETCH_TIMEOUT_MS);
      const data = await api.request<{
        report?: ResearchReport | null;
        findings?: Finding[];
      }>(`/api/research/sessions/${legacyRef.trim()}${tenantParam}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const summary = buildCarryOverContext(messages, {
        fromChatType: "research",
        researchReport: data.report ?? null,
        researchFindings: data.findings ?? [],
      });
      if (summary.trim()) return summary;
    } catch (err) {
      console.warn("[carryOverContext] research session fetch failed:", err);
    }
  }

  return buildCarryOverContext(messages, { fromChatType });
}
