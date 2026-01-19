/**
 * Hybrid Sync Service
 * Handles real-time synchronization between cloud and on-premise instances
 */

import { pool } from '../config/database.js';
import { WebSocket } from 'ws';

export interface SyncConfig {
  sourceInstanceId: string;
  targetInstanceId: string;
  syncType: 'full' | 'incremental' | 'realtime';
  tenantId: string;
}

export interface SyncResult {
  success: boolean;
  recordsSynced: number;
  errors: string[];
  duration: number;
}

/**
 * Active sync connections (WebSocket-based)
 */
const activeSyncConnections = new Map<string, WebSocket>();

/**
 * Start a sync operation between two instances
 */
export async function startSync(config: SyncConfig): Promise<SyncResult> {
  const startTime = Date.now();
  const errors: string[] = [];
  let recordsSynced = 0;

  try {
    // Get instance details
    const sourceResult = await pool.query(
      'SELECT * FROM public.deployment_instances WHERE id = $1',
      [config.sourceInstanceId]
    );

    const targetResult = await pool.query(
      'SELECT * FROM public.deployment_instances WHERE id = $1',
      [config.targetInstanceId]
    );

    if (sourceResult.rows.length === 0 || targetResult.rows.length === 0) {
      throw new Error('Source or target instance not found');
    }

    const sourceInstance = sourceResult.rows[0];
    const targetInstance = targetResult.rows[0];

    // Verify both instances belong to the same tenant
    if (sourceInstance.tenant_id !== config.tenantId || targetInstance.tenant_id !== config.tenantId) {
      throw new Error('Instances must belong to the same tenant');
    }

    // Create sync event record
    const syncEventResult = await pool.query(
      `INSERT INTO public.sync_events
       (source_instance_id, target_instance_id, sync_type, status, started_at)
       VALUES ($1, $2, $3, 'in_progress', NOW())
       RETURNING id`,
      [config.sourceInstanceId, config.targetInstanceId, config.syncType]
    );

    const syncEventId = syncEventResult.rows[0].id;

    // Perform sync based on type
    switch (config.syncType) {
      case 'full':
        recordsSynced = await performFullSync(config, syncEventId);
        break;
      case 'incremental':
        recordsSynced = await performIncrementalSync(config, syncEventId);
        break;
      case 'realtime':
        await setupRealtimeSync(config, syncEventId);
        recordsSynced = 0; // Realtime sync is ongoing
        break;
    }

    // Update sync event
    await pool.query(
      `UPDATE public.sync_events
       SET status = 'completed',
           records_synced = $1,
           completed_at = NOW()
       WHERE id = $2`,
      [recordsSynced, syncEventId]
    );

    // Update instance sync timestamps
    await pool.query(
      `UPDATE public.deployment_instances
       SET last_sync_at = NOW(), status = 'active'
       WHERE id IN ($1, $2)`,
      [config.sourceInstanceId, config.targetInstanceId]
    );

    return {
      success: true,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  } catch (error: any) {
    errors.push(error.message);
    return {
      success: false,
      recordsSynced,
      errors,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Perform full sync (all data)
 */
async function performFullSync(config: SyncConfig, syncEventId: string): Promise<number> {
  let totalRecords = 0;

  // Sync all tables that need replication
  const tablesToSync = [
    'loans',
    'employees',
    'rag_documents',
    'rag_embeddings',
    'cost_events',
    'usage_metrics',
  ];

  for (const table of tablesToSync) {
    try {
      // Get all records for this tenant
      const records = await pool.query(
        `SELECT * FROM public.${table} WHERE tenant_id = $1`,
        [config.tenantId]
      );

      // In a real implementation, these would be sent to the target instance
      // For now, we just count them
      totalRecords += records.rows.length;

      // TODO: Send records to target instance via API or WebSocket
      // await sendRecordsToTarget(config.targetInstanceId, table, records.rows);
    } catch (error: any) {
      // Table might not exist, skip it
      if (error.code !== '42P01') {
        throw error;
      }
    }
  }

  return totalRecords;
}

/**
 * Perform incremental sync (only changed data since last sync)
 */
async function performIncrementalSync(config: SyncConfig, syncEventId: string): Promise<number> {
  let totalRecords = 0;

  // Get last sync timestamp
  const lastSyncResult = await pool.query(
    `SELECT MAX(completed_at) as last_sync
     FROM public.sync_events
     WHERE source_instance_id = $1 
       AND target_instance_id = $2
       AND status = 'completed'`,
    [config.sourceInstanceId, config.targetInstanceId]
  );

  const lastSync = lastSyncResult.rows[0]?.last_sync;

  // Sync only records modified since last sync
  const tablesToSync = [
    'loans',
    'employees',
    'rag_documents',
    'rag_embeddings',
    'cost_events',
    'usage_metrics',
  ];

  for (const table of tablesToSync) {
    try {
      let query = `SELECT * FROM public.${table} WHERE tenant_id = $1`;
      const params: any[] = [config.tenantId];

      if (lastSync) {
        query += ` AND (created_at > $2 OR updated_at > $2)`;
        params.push(lastSync);
      }

      const records = await pool.query(query, params);
      totalRecords += records.rows.length;

      // TODO: Send records to target instance
    } catch (error: any) {
      if (error.code !== '42P01') {
        throw error;
      }
    }
  }

  return totalRecords;
}

/**
 * Setup realtime sync (WebSocket-based continuous sync)
 */
async function setupRealtimeSync(config: SyncConfig, syncEventId: string): Promise<void> {
  // Create a sync channel identifier
  const syncChannel = `sync:${config.sourceInstanceId}:${config.targetInstanceId}`;

  // In a real implementation, this would:
  // 1. Establish WebSocket connection to target instance
  // 2. Set up database triggers to send changes
  // 3. Listen for changes and forward them

  // For now, mark sync as ongoing
  await pool.query(
    `UPDATE public.sync_events
     SET status = 'in_progress',
         metadata = jsonb_build_object('sync_channel', $1)
     WHERE id = $2`,
    [syncChannel, syncEventId]
  );

  // TODO: Implement WebSocket sync channel
  // This would require:
  // - WebSocket server on target instance
  // - Database triggers for change detection
  // - Message queue for reliable delivery
}

/**
 * Stop realtime sync
 */
export async function stopRealtimeSync(sourceInstanceId: string, targetInstanceId: string): Promise<void> {
  const syncChannel = `sync:${sourceInstanceId}:${targetInstanceId}`;
  
  // Close WebSocket connection if exists
  const ws = activeSyncConnections.get(syncChannel);
  if (ws) {
    ws.close();
    activeSyncConnections.delete(syncChannel);
  }

  // Update sync event status
  await pool.query(
    `UPDATE public.sync_events
     SET status = 'completed'
     WHERE source_instance_id = $1 
       AND target_instance_id = $2
       AND status = 'in_progress'
       AND sync_type = 'realtime'`,
    [sourceInstanceId, targetInstanceId]
  );
}

/**
 * Get sync status
 */
export async function getSyncStatus(
  sourceInstanceId: string,
  targetInstanceId: string
): Promise<any> {
  const result = await pool.query(
    `SELECT *
     FROM public.sync_events
     WHERE source_instance_id = $1 
       AND target_instance_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [sourceInstanceId, targetInstanceId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
}

/**
 * Handle failover (switch primary instance)
 */
export async function handleFailover(
  tenantId: string,
  newPrimaryInstanceId: string
): Promise<void> {
  // Set all instances to offline except the new primary
  await pool.query(
    `UPDATE public.deployment_instances
     SET status = CASE 
       WHEN id = $1 THEN 'active'
       ELSE 'offline'
     END,
     updated_at = NOW()
     WHERE tenant_id = $2`,
    [newPrimaryInstanceId, tenantId]
  );

  // Update sync partnerships
  await pool.query(
    `UPDATE public.deployment_instances
     SET sync_partner_id = NULL
     WHERE tenant_id = $1 AND id != $2`,
    [tenantId, newPrimaryInstanceId]
  );
}

