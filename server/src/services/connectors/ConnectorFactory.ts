/**
 * ConnectorFactory - Factory for creating LOS connectors
 * 
 * This factory instantiates the appropriate connector based on the LOS type.
 * Part of the Universal Connector architecture.
 */

import pg from 'pg';
import { BaseConnector, LOSConnectionConfig, LOSType } from './BaseConnector.js';
import { EncompassConnector } from './EncompassConnector.js';
import { MeridianLinkConnector } from './MeridianLinkConnector.js';
// Future connectors will be imported here
// import { ByteConnector } from './ByteConnector.js';

/**
 * Registry of available connectors
 */
const connectorRegistry: Map<LOSType, new (config: LOSConnectionConfig, tenantPool?: pg.Pool) => BaseConnector> = new Map();

/**
 * Register connectors
 */
connectorRegistry.set('encompass', EncompassConnector);
connectorRegistry.set('meridianlink', MeridianLinkConnector);

// Future registrations:
// connectorRegistry.set('byte', ByteConnector);

/**
 * Get information about available connectors
 */
export interface ConnectorInfo {
  type: LOSType;
  displayName: string;
  description: string;
  isAvailable: boolean;
  features: string[];
}

/**
 * ConnectorFactory - Creates and manages LOS connectors
 */
export class ConnectorFactory {
  private static instance: ConnectorFactory;
  private connectorCache: Map<string, BaseConnector> = new Map();

  private constructor() {}

  /**
   * Get singleton instance
   */
  static getInstance(): ConnectorFactory {
    if (!ConnectorFactory.instance) {
      ConnectorFactory.instance = new ConnectorFactory();
    }
    return ConnectorFactory.instance;
  }

  /**
   * Create a connector for the given configuration
   */
  createConnector(config: LOSConnectionConfig, tenantPool?: pg.Pool): BaseConnector {
    const ConnectorClass = connectorRegistry.get(config.los_type);
    
    if (!ConnectorClass) {
      throw new Error(`No connector available for LOS type: ${config.los_type}`);
    }

    return new ConnectorClass(config, tenantPool);
  }

  /**
   * Get or create a cached connector
   * Useful for reusing connections across multiple operations
   */
  getConnector(config: LOSConnectionConfig, tenantPool?: pg.Pool): BaseConnector {
    const cacheKey = `${config.tenant_id}:${config.id}`;
    
    let connector = this.connectorCache.get(cacheKey);
    if (!connector) {
      connector = this.createConnector(config, tenantPool);
      this.connectorCache.set(cacheKey, connector);
    }

    return connector;
  }

  /**
   * Clear cached connector
   */
  clearConnector(tenantId: string, connectionId: string): void {
    const cacheKey = `${tenantId}:${connectionId}`;
    this.connectorCache.delete(cacheKey);
  }

  /**
   * Clear all cached connectors
   */
  clearAllConnectors(): void {
    this.connectorCache.clear();
  }

  /**
   * Get list of available connector types
   */
  getAvailableTypes(): LOSType[] {
    return Array.from(connectorRegistry.keys());
  }

  /**
   * Check if a connector type is available
   */
  isTypeAvailable(type: LOSType): boolean {
    return connectorRegistry.has(type);
  }

  /**
   * Get information about all connectors
   */
  getConnectorInfo(): ConnectorInfo[] {
    const info: ConnectorInfo[] = [
      {
        type: 'encompass',
        displayName: 'Encompass (ICE Mortgage Technology)',
        description: 'Connect to Encompass LOS via REST API',
        isAvailable: connectorRegistry.has('encompass'),
        features: [
          'Full loan data extraction',
          'Incremental sync',
          'Field mapping customization',
          'RDB field support',
          'Multi-folder sync'
        ]
      },
      {
        type: 'meridianlink',
        displayName: 'MeridianLink',
        description: 'Connect to MeridianLink LOS',
        isAvailable: connectorRegistry.has('meridianlink'),
        features: [
          'Loan data extraction',
          'Incremental sync',
          'Field mapping'
        ]
      },
      {
        type: 'byte',
        displayName: 'Byte Software',
        description: 'Connect to Byte LOS',
        isAvailable: connectorRegistry.has('byte'),
        features: [
          'Loan data extraction',
          'Field mapping'
        ]
      },
      {
        type: 'calyx',
        displayName: 'Calyx Point/Path',
        description: 'Connect to Calyx LOS products',
        isAvailable: connectorRegistry.has('calyx'),
        features: [
          'Loan data extraction',
          'Field mapping'
        ]
      },
      {
        type: 'custom',
        displayName: 'Custom Integration',
        description: 'Custom LOS integration via CSV or API',
        isAvailable: connectorRegistry.has('custom'),
        features: [
          'CSV import',
          'Custom API integration',
          'Field mapping'
        ]
      }
    ];

    return info;
  }
}

/**
 * Register a custom connector
 */
export function registerConnector(
  type: LOSType,
  connectorClass: new (config: LOSConnectionConfig, tenantPool?: pg.Pool) => BaseConnector
): void {
  connectorRegistry.set(type, connectorClass);
}

/**
 * Convenience function to create a connector
 */
export function createConnector(config: LOSConnectionConfig, tenantPool?: pg.Pool): BaseConnector {
  return ConnectorFactory.getInstance().createConnector(config, tenantPool);
}

export default ConnectorFactory;
