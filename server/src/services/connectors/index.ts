/**
 * Connectors Module
 * 
 * Universal Connector architecture for LOS integrations.
 * Export all connector-related types, classes, and utilities.
 */

// Base connector and types
export {
  BaseConnector,
  LOSType,
  LOSConnectionConfig,
  StandardLoanRecord,
  SyncResult,
  SyncOptions,
  ConnectionTestResult,
  FieldMapping,
  LOSField
} from './BaseConnector.js';

// Connector factory
export {
  ConnectorFactory,
  createConnector,
  registerConnector,
  ConnectorInfo
} from './ConnectorFactory.js';

// Specific connectors
export { EncompassConnector } from './EncompassConnector.js';
export { MeridianLinkConnector } from './MeridianLinkConnector.js';

// Future connectors will be exported here
// export { ByteConnector } from './ByteConnector.js';
