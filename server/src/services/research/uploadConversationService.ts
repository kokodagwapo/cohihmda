/**
 * Links research_uploads to unified chat conversations and builds upload-only schema context.
 */

import type pg from "pg";
import {
  loadUploadRecord,
  buildUploadTableSchemaContext,
  migrateContextUploadToTable,
} from "./uploadProcessor.js";

export type UploadConversationChatType =
  | "chat"
  | "workbench"
  | "research"
  | "insight_builder";

export interface UploadMetaSummary {
  id: string;
  originalFileName: string;
  rowCount: number;
  columnCount: number;
  tableName?: string;
}

export interface LinkedConversationSummary {
  conversationId: string;
  title: string;
  chatType: string;
  updatedAt: string;
}

export interface ResolvedUploadContext {
  schemaAddendum: string;
  tableNames: string[];
  uploadMeta: UploadMetaSummary[];
  instructionBlock: string;
}

const UPLOAD_ONLY_INSTRUCTION = `
## Dataset-only mode (CRITICAL)
The user attached one or more CSV datasets. Query ONLY the listed upload_* tables below.
Do NOT use the loans table or other tenant warehouse tables unless the user explicitly asks to compare with portfolio data.
`;

export async function ensureUploadConversationLinksTable(
  tenantPool: pg.Pool,
): Promise<void> {
  await tenantPool.query(`
    CREATE TABLE IF NOT EXISTS research_upload_conversation_links (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      upload_id UUID NOT NULL REFERENCES research_uploads(id) ON DELETE CASCADE,
      conversation_id UUID NOT NULL,
      chat_type TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (upload_id, conversation_id)
    )
  `);
  await tenantPool.query(`
    CREATE INDEX IF NOT EXISTS idx_upload_conv_links_upload
      ON research_upload_conversation_links (upload_id, created_at DESC)
  `);
  await tenantPool.query(`
    CREATE INDEX IF NOT EXISTS idx_upload_conv_links_conv
      ON research_upload_conversation_links (conversation_id)
  `);
}

export async function linkUploadsToConversation(args: {
  tenantPool: pg.Pool;
  tenantId: string;
  userId: string;
  conversationId: string;
  chatType: UploadConversationChatType;
  uploadIds: string[];
}): Promise<void> {
  const ids = [...new Set(args.uploadIds.filter(Boolean))];
  if (ids.length === 0) return;

  await ensureUploadConversationLinksTable(args.tenantPool);

  for (const uploadId of ids) {
    await args.tenantPool.query(
      `INSERT INTO research_upload_conversation_links
         (tenant_id, user_id, upload_id, conversation_id, chat_type)
       VALUES ($1, $2, $3::uuid, $4::uuid, $5)
       ON CONFLICT (upload_id, conversation_id) DO UPDATE SET
         chat_type = EXCLUDED.chat_type`,
      [
        args.tenantId,
        args.userId,
        uploadId,
        args.conversationId,
        args.chatType,
      ],
    );
  }
}

export async function unlinkUploadFromConversation(args: {
  tenantPool: pg.Pool;
  conversationId: string;
  uploadId: string;
  userId: string;
}): Promise<boolean> {
  await ensureUploadConversationLinksTable(args.tenantPool);
  const result = await args.tenantPool.query(
    `DELETE FROM research_upload_conversation_links
     WHERE conversation_id = $1::uuid AND upload_id = $2::uuid AND user_id = $3
     RETURNING id`,
    [args.conversationId, args.uploadId, args.userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getUploadIdsForConversation(
  tenantPool: pg.Pool,
  conversationId: string,
): Promise<string[]> {
  await ensureUploadConversationLinksTable(tenantPool);
  const result = await tenantPool.query<{ upload_id: string }>(
    `SELECT upload_id FROM research_upload_conversation_links
     WHERE conversation_id = $1::uuid
     ORDER BY created_at ASC`,
    [conversationId],
  );
  return result.rows.map((r) => r.upload_id);
}

export async function getUploadMetaForConversation(
  tenantPool: pg.Pool,
  conversationId: string,
): Promise<UploadMetaSummary[]> {
  const ids = await getUploadIdsForConversation(tenantPool, conversationId);
  const meta: UploadMetaSummary[] = [];
  for (const id of ids) {
    const row = await tenantPool.query<{
      id: string;
      original_file_name: string;
      row_count: number;
      column_count: number;
      table_name: string | null;
      status: string;
    }>(
      `SELECT id, original_file_name, row_count, column_count, table_name, status
       FROM research_uploads WHERE id = $1 AND status = 'ready'`,
      [id],
    );
    if (row.rows[0]) {
      const r = row.rows[0];
      meta.push({
        id: r.id,
        originalFileName: r.original_file_name,
        rowCount: r.row_count,
        columnCount: r.column_count,
        tableName: r.table_name ?? undefined,
      });
    }
  }
  return meta;
}

export async function getConversationsForUpload(
  tenantPool: pg.Pool,
  uploadId: string,
  userId: string,
): Promise<LinkedConversationSummary[]> {
  await ensureUploadConversationLinksTable(tenantPool);
  const links = await tenantPool.query<{
    conversation_id: string;
    chat_type: string;
  }>(
    `SELECT conversation_id, chat_type
     FROM research_upload_conversation_links
     WHERE upload_id = $1::uuid AND user_id = $2
     ORDER BY created_at DESC`,
    [uploadId, userId],
  );

  const out: LinkedConversationSummary[] = [];
  for (const link of links.rows) {
    const conv = await tenantPool.query<{
      title: string;
      updated_at: Date;
    }>(
      `SELECT title, updated_at FROM public.unified_chat_conversations
       WHERE id = $1::uuid AND user_id = $2::uuid LIMIT 1`,
      [link.conversation_id, userId],
    );
    if (conv.rows[0]) {
      out.push({
        conversationId: link.conversation_id,
        title: conv.rows[0].title,
        chatType: link.chat_type,
        updatedAt: conv.rows[0].updated_at.toISOString(),
      });
    } else {
      out.push({
        conversationId: link.conversation_id,
        title: "Chat",
        chatType: link.chat_type,
        updatedAt: new Date().toISOString(),
      });
    }
  }
  return out;
}

export async function resolveUploadSchemaContext(
  uploadIds: string[],
  tenantPool: pg.Pool,
): Promise<ResolvedUploadContext> {
  const tableNames: string[] = [];
  const uploadMeta: UploadMetaSummary[] = [];
  let schemaAddendum = "";

  for (const uploadId of uploadIds) {
    try {
      const rec = await loadUploadRecord(uploadId, tenantPool);
      if (!rec) continue;
      const withNames = rec as typeof rec & {
        id: string;
        originalFileName: string;
      };
      withNames.id = rec.id;
      withNames.originalFileName = rec.originalFileName;

      if (!rec.tableName && rec.dataJson && rec.dataJson.length > 0) {
        const newTableName = await migrateContextUploadToTable(
          withNames as Parameters<typeof migrateContextUploadToTable>[0],
          tenantPool,
        );
        if (newTableName) {
          rec.tableName = newTableName;
        }
      }

      schemaAddendum += buildUploadTableSchemaContext(withNames);
      if (rec.tableName) tableNames.push(rec.tableName);
      uploadMeta.push({
        id: rec.id,
        originalFileName: rec.originalFileName,
        rowCount: rec.rowCount,
        columnCount: rec.columnCount,
        tableName: rec.tableName,
      });
    } catch (err: unknown) {
      console.warn(
        `[uploadConversation] Failed to load upload ${uploadId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const instructionBlock =
    uploadMeta.length > 0 ? UPLOAD_ONLY_INSTRUCTION + schemaAddendum : "";

  return {
    schemaAddendum,
    tableNames,
    uploadMeta,
    instructionBlock,
  };
}

export function mergeDatasetUploadIds(
  body: {
    options?: {
      datasetUploadIds?: string[];
      research?: { uploadIds?: string[] };
    };
  },
): string[] {
  const fromDataset = body.options?.datasetUploadIds ?? [];
  const fromResearch = body.options?.research?.uploadIds ?? [];
  return [...new Set([...fromDataset, ...fromResearch].filter(Boolean))];
}
