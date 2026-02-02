/**
 * AI Services Index
 * Exports all AI-related services
 */

// Export types from dataChatService
export type {
  ChatContext,
  UserPermissions,
  RowFilter,
  DataChatMessage,
  VisualizationConfig,
} from "./dataChatService.js";

// Export functions from dataChatService
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
