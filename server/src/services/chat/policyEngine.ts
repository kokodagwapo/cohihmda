/**
 * Unified chat policy facade (COHI-389).
 * Re-exports enforcement helpers used by the orchestrator and routes.
 */

export {
  assertUnifiedChatAllowed,
  sanitizeNavigationHints,
  type UnifiedChatPolicyInput,
  type UnifiedChatSurface,
  type UnifiedScopeType,
} from "./unifiedChatPolicy.js";
