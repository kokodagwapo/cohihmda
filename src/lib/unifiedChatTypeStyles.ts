import type { UnifiedChatType } from "@/lib/unifiedChatClient";

/** Display labels for unified chat types (COHI-403). */
export const CHAT_TYPE_LABELS: Record<UnifiedChatType, string> = {
  chat: "Chat",
  research: "Research",
  insight_builder: "Insight builder",
  workbench: "Workbench",
};

/**
 * Distinct pill colors per chat type (Full History & shared UI).
 */
export const CHAT_TYPE_PILL_CLASS: Record<UnifiedChatType, string> = {
  chat: "bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200",
  research:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
  insight_builder:
    "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
  workbench:
    "bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200",
};

export function formatChatTypeLabel(chatType: UnifiedChatType) {
  return CHAT_TYPE_LABELS[chatType];
}

export function getChatTypePillClassName(chatType: UnifiedChatType) {
  return CHAT_TYPE_PILL_CLASS[chatType];
}

/** Active prompt-card outline aligned to each chat type pill color. */
export const CHAT_TYPE_ACTIVE_BORDER_CLASS: Record<UnifiedChatType, string> = {
  chat: "border-blue-300/90 dark:border-blue-600/55 ring-1 ring-blue-200/70 dark:ring-blue-800/45",
  research:
    "border-emerald-300/90 dark:border-emerald-600/55 ring-1 ring-emerald-200/70 dark:ring-emerald-800/45",
  insight_builder:
    "border-amber-300/90 dark:border-amber-600/55 ring-1 ring-amber-200/70 dark:ring-amber-800/45",
  workbench:
    "border-orange-300/90 dark:border-orange-600/55 ring-1 ring-orange-200/70 dark:ring-orange-800/45",
};

export function getChatTypeActiveBorderClassName(chatType: UnifiedChatType) {
  return CHAT_TYPE_ACTIVE_BORDER_CLASS[chatType];
}
