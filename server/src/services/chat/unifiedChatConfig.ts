/**
 * Feature flag and helpers for unified chat API.
 * UNIFIED_CHAT_ENABLED: unset = enabled in non-production, enabled if "true" in production;
 * set to "false" to disable /api/chat/v1 (returns 404).
 */

export function isUnifiedChatApiEnabled(): boolean {
  const raw = process.env.UNIFIED_CHAT_ENABLED;
  if (raw === "false") return false;
  if (raw === "true") return true;
  return process.env.NODE_ENV !== "production";
}
