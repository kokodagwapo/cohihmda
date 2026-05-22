/**
 * Feature flag and helpers for unified chat API.
 * Unified chat is enabled by default in all environments.
 * Set UNIFIED_CHAT_ENABLED=false only as an emergency kill switch
 * (returns 404 for /api/chat/v1).
 */

export function isUnifiedChatApiEnabled(): boolean {
  const raw = process.env.UNIFIED_CHAT_ENABLED;
  if (raw === "false") return false;
  return true;
}
