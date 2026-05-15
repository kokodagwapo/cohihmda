/**
 * Unified chat policy facade (COHI-389).
 */

export {
  assertUnifiedChatAllowed,
  evaluateUnifiedChatPolicy,
  buildUnifiedChatPermissions,
  sanitizeNavigationHints,
  assertPlatformTenantScope,
  type UnifiedChatPolicyInput,
  type UnifiedChatSurface,
  type UnifiedScopeType,
  type PolicyDecision,
  type UnifiedChatPermissionsPayload,
} from "./unifiedChatPolicy.js";
