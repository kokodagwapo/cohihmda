import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import { CHAT_TYPE_LABELS } from "@/lib/unifiedChatTypeStyles";

/** Brief empty-state copy per chat type (from centralization spec §3). */
export const CHAT_TYPE_DESCRIPTIONS: Record<UnifiedChatType, string> = {
  chat: "Ask questions, explore metrics, and get quick answers about your business.",
  research:
    "Run deep investigations with timeline, findings, and structured reports.",
  insight_builder:
    "Describe insights in natural language to draft custom prompt definitions.",
  workbench:
    "Build and refine dashboards with AI—add widgets, layouts, and KPI views.",
};

/**
 * Research Lab topic starters (legacy `/research` empty state — `ResearchAnalyst.tsx`).
 */
export const RESEARCH_TOPIC_SUGGESTIONS = [
  "Overall pipeline health and conversion performance",
  "LO scorecard: compute TTS scores, tier distribution (Top/Second/Bottom), and identify performance outliers",
  "Risk patterns and credit exposure: FICO, LTV, DTI distribution and high-risk concentrations",
  "Turn time trends and operational efficiency by role (processor, underwriter, closer)",
  "Product mix and channel analysis: loan type, purpose, and program breakdown",
  "Revenue drivers: margin analysis, BPS by LO/channel, and revenue concentration",
] as const;

/** Default starter prompts when the server has not returned suggestions yet. */
export const CHAT_TYPE_DEFAULT_SUGGESTIONS: Record<UnifiedChatType, string[]> = {
  chat: [
    "What's important to know today?",
    "Show me loan volume by month",
    "What are the FHA requirements?",
    "Top loan officers by revenue",
  ],
  research: [...RESEARCH_TOPIC_SUGGESTIONS],
  insight_builder: [],
  workbench: [
    "Prepare a board-ready overview of this month's performance",
    "Summarize pipeline health and pull-through trends",
    "What needs my attention right now?",
    "Build an executive dashboard with key KPIs",
  ],
};

export const DEFAULT_CHAT_SUGGESTIONS = CHAT_TYPE_DEFAULT_SUGGESTIONS.chat;

export function getChatTypeLabel(chatType: UnifiedChatType) {
  return CHAT_TYPE_LABELS[chatType];
}
