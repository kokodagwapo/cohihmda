/**
 * Global Knowledge Sync Service
 *
 * Handles synchronization of global knowledge documents from the management database
 * to all tenant databases. Provides:
 * - Sync documents to all tenants on publish
 * - Sync all global docs to new tenant on provisioning
 * - Archive (soft delete) and remove from all tenants
 * - Restore archived documents
 * - Audit logging for all sync operations
 */

import { pool as managementPool } from "../config/managementDatabase.js";
import { tenantDbManager } from "../config/tenantDatabaseManager.js";
import { generateEmbeddings } from "./embeddingService.js";
import { chunkDocument } from "./documentChunker.js";
import { parseDocument } from "./documentParser.js";
import pg from "pg";

// =============================================================================
// Types
// =============================================================================

export interface SyncResult {
  tenantId: string;
  tenantName?: string;
  success: boolean;
  chunksCreated?: number;
  error?: string;
}

export interface GlobalDocument {
  id: string;
  title: string;
  filename: string | null;
  file_type: string | null;
  content: string | null;
  category: string;
  tags: string[];
  version: number;
  status: string;
  chunk_count: number;
  token_count: number;
}

export interface GlobalEmbedding {
  id: string;
  document_id: string;
  chunk_index: number;
  chunk_text: string;
  embedding: number[];
  token_count: number;
}

export interface SyncOptions {
  concurrency?: number;
  skipFailedTenants?: boolean;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get a global document by ID from management database
 */
async function getGlobalDocument(
  documentId: string
): Promise<GlobalDocument | null> {
  const result = await managementPool.query(
    `SELECT id, title, filename, file_type, content, category, tags, version, status, chunk_count, token_count
     FROM global_knowledge_library
     WHERE id = $1`,
    [documentId]
  );
  return result.rows[0] || null;
}

/**
 * Get embeddings for a global document
 */
async function getGlobalEmbeddings(
  documentId: string
): Promise<GlobalEmbedding[]> {
  const result = await managementPool.query(
    `SELECT id, document_id, chunk_index, chunk_text, embedding, token_count
     FROM global_knowledge_embeddings
     WHERE document_id = $1
     ORDER BY chunk_index`,
    [documentId]
  );
  return result.rows;
}

/**
 * Get all active tenants
 */
async function getActiveTenants(): Promise<
  Array<{ id: string; name: string; slug: string }>
> {
  const result = await managementPool.query(
    `SELECT id, name, slug FROM coheus_tenants WHERE status = 'active'`
  );
  return result.rows;
}

/**
 * Log a sync event to the audit table
 */
async function logSyncEvent(
  documentId: string,
  documentVersion: number | null,
  tenantId: string,
  action: "sync" | "update" | "delete",
  status: "success" | "failed" | "pending",
  syncedBy: string | null,
  errorMessage?: string,
  chunksSynced?: number
): Promise<void> {
  try {
    await managementPool.query(
      `INSERT INTO global_knowledge_sync_log 
       (document_id, document_version, tenant_id, action, status, error_message, chunks_synced, synced_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        documentId,
        documentVersion || 0,
        tenantId,
        action,
        status,
        errorMessage || null,
        chunksSynced || 0,
        syncedBy,
      ]
    );
  } catch (error) {
    console.error("[GlobalKnowledgeSync] Failed to log sync event:", error);
  }
}

/**
 * Convert embedding array to pgvector format string
 */
function embeddingToVector(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

// =============================================================================
// Core Sync Functions
// =============================================================================

/**
 * Sync a single document to a specific tenant
 */
async function syncDocumentToTenant(
  doc: GlobalDocument,
  embeddings: GlobalEmbedding[],
  tenantId: string,
  syncedBy: string | null,
  action: "added" | "updated" = "updated"
): Promise<{ success: boolean; chunksCreated: number; error?: string }> {
  let tenantPool: pg.Pool;

  try {
    tenantPool = await tenantDbManager.getTenantPool(tenantId);
  } catch (error: any) {
    return {
      success: false,
      chunksCreated: 0,
      error: `Failed to connect to tenant database: ${error.message}`,
    };
  }

  try {
    // Start transaction
    await tenantPool.query("BEGIN");

    // Check if document already exists
    const existingDoc = await tenantPool.query(
      `SELECT id FROM rag_documents WHERE global_doc_id = $1 AND is_global = true`,
      [doc.id]
    );

    let tenantDocId: string;

    if (existingDoc.rows.length > 0) {
      // Update existing document
      tenantDocId = existingDoc.rows[0].id;
      await tenantPool.query(
        `UPDATE rag_documents 
         SET title = $1, filename = $2, file_type = $3, content = $4, category = $5, 
             tags = $6, global_version = $7, chunk_count = $8, token_count = $9,
             status = 'indexed', updated_at = NOW()
         WHERE id = $10`,
        [
          doc.title,
          doc.filename,
          doc.file_type,
          doc.content,
          doc.category,
          doc.tags,
          doc.version,
          doc.chunk_count,
          doc.token_count,
          tenantDocId,
        ]
      );

      // Delete old embeddings (will be replaced)
      await tenantPool.query(
        `DELETE FROM rag_embeddings WHERE document_id = $1`,
        [tenantDocId]
      );
    } else {
      // Create new document record
      // First ensure we have a default source for global docs
      let sourceResult = await tenantPool.query(
        `SELECT id FROM rag_document_sources WHERE name = 'Global Knowledge Library' LIMIT 1`
      );

      let sourceId: string;
      if (sourceResult.rows.length === 0) {
        // Create the source
        const newSource = await tenantPool.query(
          `INSERT INTO rag_document_sources (name, source_type, status, source_config)
           VALUES ('Global Knowledge Library', 'api', 'active', '{"synced": true}')
           RETURNING id`
        );
        sourceId = newSource.rows[0].id;
      } else {
        sourceId = sourceResult.rows[0].id;
      }

      // Insert new document
      const newDoc = await tenantPool.query(
        `INSERT INTO rag_documents 
         (source_id, title, filename, file_type, content, category, tags,
          is_global, global_doc_id, global_version, chunk_count, token_count, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9, $10, $11, 'indexed')
         RETURNING id`,
        [
          sourceId,
          doc.title,
          doc.filename,
          doc.file_type,
          doc.content,
          doc.category,
          doc.tags,
          doc.id,
          doc.version,
          doc.chunk_count,
          doc.token_count,
        ]
      );
      tenantDocId = newDoc.rows[0].id;
    }

    // Insert embeddings
    let chunksCreated = 0;
    for (const embedding of embeddings) {
      await tenantPool.query(
        `INSERT INTO rag_embeddings (document_id, chunk_index, chunk_text, embedding, token_count, metadata)
         VALUES ($1, $2, $3, $4::vector, $5, $6)
         ON CONFLICT (document_id, chunk_index) DO UPDATE
         SET chunk_text = EXCLUDED.chunk_text, embedding = EXCLUDED.embedding, 
             token_count = EXCLUDED.token_count`,
        [
          tenantDocId,
          embedding.chunk_index,
          embedding.chunk_text,
          embeddingToVector(embedding.embedding),
          embedding.token_count,
          JSON.stringify({
            global_doc_id: doc.id,
            global_version: doc.version,
          }),
        ]
      );
      chunksCreated++;
    }

    // Add to knowledge_updates feed
    await tenantPool.query(
      `INSERT INTO knowledge_updates (global_doc_id, title, category, action, version, change_summary)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        doc.id,
        doc.title,
        doc.category,
        action,
        doc.version,
        action === "added"
          ? "New document added to knowledge base"
          : "Document content updated",
      ]
    );

    // Commit transaction
    await tenantPool.query("COMMIT");

    return { success: true, chunksCreated };
  } catch (error: any) {
    // Rollback on error
    try {
      await tenantPool.query("ROLLBACK");
    } catch (rollbackError) {
      console.error("[GlobalKnowledgeSync] Rollback failed:", rollbackError);
    }
    return { success: false, chunksCreated: 0, error: error.message };
  }
}

/**
 * Sync a document to all active tenants
 */
export async function syncDocumentToAllTenants(
  documentId: string,
  publishedBy: string | null,
  options: SyncOptions = {}
): Promise<SyncResult[]> {
  const { concurrency = 5, skipFailedTenants = true } = options;

  // Get document and embeddings
  const doc = await getGlobalDocument(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  if (doc.status !== "published") {
    throw new Error(
      `Document ${documentId} is not published (status: ${doc.status})`
    );
  }

  const embeddings = await getGlobalEmbeddings(documentId);
  if (embeddings.length === 0) {
    throw new Error(`Document ${documentId} has no embeddings`);
  }

  // Get all active tenants
  const tenants = await getActiveTenants();
  if (tenants.length === 0) {
    console.log("[GlobalKnowledgeSync] No active tenants to sync to");
    return [];
  }

  console.log(
    `[GlobalKnowledgeSync] Syncing document "${doc.title}" to ${tenants.length} tenants`
  );

  // Check if this is a new sync or update
  const existingSyncs = await managementPool.query(
    `SELECT DISTINCT tenant_id FROM global_knowledge_sync_log 
     WHERE document_id = $1 AND action IN ('sync', 'update') AND status = 'success'`,
    [documentId]
  );
  const previouslySyncedTenants = new Set(
    existingSyncs.rows.map((r) => r.tenant_id)
  );

  // Sync to each tenant (with concurrency control)
  const results: SyncResult[] = [];
  const batches: Array<{ id: string; name: string; slug: string }[]> = [];

  for (let i = 0; i < tenants.length; i += concurrency) {
    batches.push(tenants.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    const batchResults = await Promise.all(
      batch.map(async (tenant) => {
        const action = previouslySyncedTenants.has(tenant.id)
          ? "updated"
          : "added";
        const result = await syncDocumentToTenant(
          doc,
          embeddings,
          tenant.id,
          publishedBy,
          action
        );

        // Log the sync event
        await logSyncEvent(
          documentId,
          doc.version,
          tenant.id,
          previouslySyncedTenants.has(tenant.id) ? "update" : "sync",
          result.success ? "success" : "failed",
          publishedBy,
          result.error,
          result.chunksCreated
        );

        return {
          tenantId: tenant.id,
          tenantName: tenant.name,
          success: result.success,
          chunksCreated: result.chunksCreated,
          error: result.error,
        };
      })
    );

    results.push(...batchResults);

    // Stop if we hit failures and skipFailedTenants is false
    if (!skipFailedTenants && batchResults.some((r) => !r.success)) {
      console.warn("[GlobalKnowledgeSync] Stopping sync due to failure");
      break;
    }
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(
    `[GlobalKnowledgeSync] Sync complete: ${successCount}/${results.length} tenants successful`
  );

  return results;
}

/**
 * Sync all published global documents to a new tenant
 * Called during tenant provisioning
 */
export async function syncAllGlobalDocsToTenant(
  tenantId: string,
  provisionedBy: string | null
): Promise<SyncResult[]> {
  // Get all published documents
  const publishedDocs = await managementPool.query(
    `SELECT id FROM global_knowledge_library WHERE status = 'published' ORDER BY published_at DESC`
  );

  if (publishedDocs.rows.length === 0) {
    console.log("[GlobalKnowledgeSync] No published documents to sync");
    return [];
  }

  console.log(
    `[GlobalKnowledgeSync] Syncing ${publishedDocs.rows.length} documents to new tenant ${tenantId}`
  );

  const results: SyncResult[] = [];

  for (const docRow of publishedDocs.rows) {
    const doc = await getGlobalDocument(docRow.id);
    if (!doc) continue;

    const embeddings = await getGlobalEmbeddings(docRow.id);
    if (embeddings.length === 0) continue;

    const result = await syncDocumentToTenant(
      doc,
      embeddings,
      tenantId,
      provisionedBy,
      "added"
    );

    await logSyncEvent(
      docRow.id,
      doc.version,
      tenantId,
      "sync",
      result.success ? "success" : "failed",
      provisionedBy,
      result.error,
      result.chunksCreated
    );

    results.push({
      tenantId,
      success: result.success,
      chunksCreated: result.chunksCreated,
      error: result.error,
    });
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(
    `[GlobalKnowledgeSync] New tenant sync complete: ${successCount}/${results.length} documents`
  );

  return results;
}

/**
 * Archive a global document and remove from all tenants
 */
export async function archiveGlobalDocument(
  documentId: string,
  archivedBy: string,
  reason?: string
): Promise<SyncResult[]> {
  // Get document info before archiving
  const doc = await getGlobalDocument(documentId);
  if (!doc) {
    throw new Error(`Document ${documentId} not found`);
  }

  console.log(`[GlobalKnowledgeSync] Archiving document "${doc.title}"`);

  // Mark as archived in management DB
  await managementPool.query(
    `UPDATE global_knowledge_library 
     SET status = 'archived', archived_at = NOW(), archived_by = $1, archive_reason = $2, updated_at = NOW()
     WHERE id = $3`,
    [archivedBy, reason || "Archived by administrator", documentId]
  );

  // Remove from all tenant DBs
  const tenants = await getActiveTenants();
  const results: SyncResult[] = [];

  for (const tenant of tenants) {
    try {
      const tenantPool = await tenantDbManager.getTenantPool(tenant.id);

      await tenantPool.query("BEGIN");

      // Delete doc and embeddings (cascade should handle embeddings)
      const deleteResult = await tenantPool.query(
        `DELETE FROM rag_documents WHERE global_doc_id = $1 AND is_global = true RETURNING id`,
        [documentId]
      );

      // Add "removed" entry to tenant's update feed
      await tenantPool.query(
        `INSERT INTO knowledge_updates (global_doc_id, title, category, action, version, change_summary)
         VALUES ($1, $2, $3, 'removed', $4, $5)`,
        [
          documentId,
          doc.title,
          doc.category,
          doc.version,
          reason || "Document archived",
        ]
      );

      await tenantPool.query("COMMIT");

      await logSyncEvent(
        documentId,
        doc.version,
        tenant.id,
        "delete",
        "success",
        archivedBy
      );

      results.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        success: true,
      });
    } catch (error: any) {
      await logSyncEvent(
        documentId,
        doc.version,
        tenant.id,
        "delete",
        "failed",
        archivedBy,
        error.message
      );
      results.push({
        tenantId: tenant.id,
        tenantName: tenant.name,
        success: false,
        error: error.message,
      });
    }
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(
    `[GlobalKnowledgeSync] Archive complete: removed from ${successCount}/${results.length} tenants`
  );

  return results;
}

/**
 * Restore an archived document and re-sync to all tenants
 */
export async function restoreGlobalDocument(
  documentId: string,
  restoredBy: string
): Promise<SyncResult[]> {
  // Update status back to published
  const result = await managementPool.query(
    `UPDATE global_knowledge_library 
     SET status = 'published', published_at = NOW(), published_by = $1,
         archived_at = NULL, archived_by = NULL, archive_reason = NULL, updated_at = NOW()
     WHERE id = $2 AND status = 'archived'
     RETURNING title`,
    [restoredBy, documentId]
  );

  if (result.rows.length === 0) {
    throw new Error(`Document ${documentId} not found or not archived`);
  }

  console.log(
    `[GlobalKnowledgeSync] Restoring document "${result.rows[0].title}"`
  );

  // Re-sync to all tenants
  return syncDocumentToAllTenants(documentId, restoredBy);
}

// =============================================================================
// Document Processing Functions
// =============================================================================

/**
 * Process and embed a global document
 * Creates embeddings and stores them in the management DB
 */
export async function processGlobalDocument(
  documentId: string,
  fileBuffer?: Buffer,
  fileName?: string,
  mimeType?: string
): Promise<{ chunkCount: number; tokenCount: number }> {
  // Get document
  const docResult = await managementPool.query(
    `SELECT id, title, content, filename, file_type FROM global_knowledge_library WHERE id = $1`,
    [documentId]
  );

  if (docResult.rows.length === 0) {
    throw new Error(`Document ${documentId} not found`);
  }

  const doc = docResult.rows[0];
  let content = doc.content;

  // If file buffer provided, parse it
  if (fileBuffer && fileName && mimeType) {
    const parsed = await parseDocument(fileBuffer, fileName, mimeType);
    content = parsed.text;

    // Update content in database
    await managementPool.query(
      `UPDATE global_knowledge_library SET content = $1 WHERE id = $2`,
      [content, documentId]
    );
  }

  if (!content || content.trim().length === 0) {
    throw new Error("Document has no content to process");
  }

  // Update processing status
  await managementPool.query(
    `UPDATE global_knowledge_library SET processing_status = 'processing' WHERE id = $1`,
    [documentId]
  );

  try {
    // Chunk the document
    const chunks = chunkDocument(content, {
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    if (chunks.length === 0) {
      throw new Error("Document produced no chunks");
    }

    // Generate embeddings
    const texts = chunks.map((c) => c.text);
    const embeddingResults = await generateEmbeddings(
      texts,
      "openai/text-embedding-3-large"
    );

    // Delete old embeddings
    await managementPool.query(
      `DELETE FROM global_knowledge_embeddings WHERE document_id = $1`,
      [documentId]
    );

    // Store new embeddings
    let totalTokens = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddingResults[i];

      await managementPool.query(
        `INSERT INTO global_knowledge_embeddings (document_id, chunk_index, chunk_text, embedding, token_count)
         VALUES ($1, $2, $3, $4::vector, $5)`,
        [
          documentId,
          chunk.index,
          chunk.text,
          embeddingToVector(embedding.embedding),
          chunk.tokenCount,
        ]
      );

      totalTokens += chunk.tokenCount;
    }

    // Update document with stats
    await managementPool.query(
      `UPDATE global_knowledge_library 
       SET chunk_count = $1, token_count = $2, processing_status = 'completed', processing_error = NULL
       WHERE id = $3`,
      [chunks.length, totalTokens, documentId]
    );

    console.log(
      `[GlobalKnowledgeSync] Processed document: ${chunks.length} chunks, ${totalTokens} tokens`
    );

    return { chunkCount: chunks.length, tokenCount: totalTokens };
  } catch (error: any) {
    // Update with error
    await managementPool.query(
      `UPDATE global_knowledge_library SET processing_status = 'error', processing_error = $1 WHERE id = $2`,
      [error.message, documentId]
    );
    throw error;
  }
}

// =============================================================================
// Query Functions
// =============================================================================

/**
 * Get sync status for a document across all tenants
 */
export async function getDocumentSyncStatus(documentId: string): Promise<
  Array<{
    tenantId: string;
    tenantName: string;
    lastSyncedAt: Date | null;
    lastAction: string | null;
    lastStatus: string | null;
    syncedVersion: number | null;
  }>
> {
  const result = await managementPool.query(
    `SELECT DISTINCT ON (t.id)
       t.id as tenant_id,
       t.name as tenant_name,
       sl.synced_at as last_synced_at,
       sl.action as last_action,
       sl.status as last_status,
       sl.document_version as synced_version
     FROM coheus_tenants t
     LEFT JOIN global_knowledge_sync_log sl ON t.id = sl.tenant_id AND sl.document_id = $1
     WHERE t.status = 'active'
     ORDER BY t.id, sl.synced_at DESC NULLS LAST`,
    [documentId]
  );

  return result.rows.map((row) => ({
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    lastSyncedAt: row.last_synced_at,
    lastAction: row.last_action,
    lastStatus: row.last_status,
    syncedVersion: row.synced_version,
  }));
}

/**
 * Get recent sync activity
 */
export async function getRecentSyncActivity(limit: number = 50): Promise<
  Array<{
    documentId: string;
    documentTitle: string;
    tenantId: string;
    tenantName: string;
    action: string;
    status: string;
    syncedAt: Date;
    error?: string;
  }>
> {
  const result = await managementPool.query(
    `SELECT 
       sl.document_id,
       gkl.title as document_title,
       sl.tenant_id,
       t.name as tenant_name,
       sl.action,
       sl.status,
       sl.synced_at,
       sl.error_message
     FROM global_knowledge_sync_log sl
     JOIN global_knowledge_library gkl ON sl.document_id = gkl.id
     JOIN coheus_tenants t ON sl.tenant_id = t.id
     ORDER BY sl.synced_at DESC
     LIMIT $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    documentId: row.document_id,
    documentTitle: row.document_title,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    action: row.action,
    status: row.status,
    syncedAt: row.synced_at,
    error: row.error_message,
  }));
}
