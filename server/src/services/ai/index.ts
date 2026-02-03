/**
 * AI Services Index
 * Exports all AI-related services
 */

// Export types from cohiChatService (new hybrid architecture)
export type {
  ChatContext,
  UserPermissions,
  RowFilter,
  CohiChatMessage,
  CohiChatResponse,
  VisualizationConfig,
} from "./cohiChatService.js";

// Export functions from cohiChatService
export {
  processCohiQuestion,
  refineCohiQuery,
} from "./cohiChatService.js";

// Legacy exports from dataChatService (for backwards compatibility)
export type {
  DataChatMessage,
  DataChatResponse,
} from "./dataChatService.js";

export {
  processDataQuestion,
  refineQuery,
} from "./dataChatService.js";

// Export types from queryBuilderService (excluding duplicates already exported)
export type {
  QueryContext,
  FilterOperator,
  DynamicSource,
  SecureQueryResult,
} from "./queryBuilderService.js";

// Export functions from queryBuilderService
export {
  getUserPermissions,
  buildSecureQuery,
  checkSectionAccess,
  checkFieldAccess,
  getAccessibleFields,
} from "./queryBuilderService.js";
