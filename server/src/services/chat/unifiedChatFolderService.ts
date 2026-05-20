/**
 * User-scoped chat folders (COHI-403). Max depth 5 per meeting spec §7.1.
 */

import { randomUUID } from "crypto";
import { tenantDbManager } from "../../config/tenantDatabaseManager.js";

export const MAX_FOLDER_DEPTH = 5;

export interface UnifiedChatFolderRow {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  depth: number;
  created_at: string;
  updated_at: string;
}

async function ensureFoldersTable(tenantId: string): Promise<boolean> {
  try {
    const pool = await tenantDbManager.getTenantPool(tenantId);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS public.unified_chat_folders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
        parent_id UUID REFERENCES public.unified_chat_folders(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        depth INT NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    return true;
  } catch (e: any) {
    console.warn("[unifiedChatFolder] ensureFoldersTable:", e.message);
    return false;
  }
}

async function folderDepth(
  tenantId: string,
  userId: string,
  parentId: string | null,
): Promise<number> {
  if (!parentId) return 1;
  const pool = await tenantDbManager.getTenantPool(tenantId);
  const r = await pool.query(
    `SELECT depth FROM public.unified_chat_folders WHERE id = $1::uuid AND user_id = $2::uuid`,
    [parentId, userId],
  );
  if (r.rows.length === 0) {
    throw Object.assign(new Error("Parent folder not found"), { statusCode: 404 });
  }
  return Number(r.rows[0].depth) + 1;
}

export async function listUnifiedChatFolders(args: {
  tenantId: string;
  userId: string;
}): Promise<UnifiedChatFolderRow[]> {
  const ok = await ensureFoldersTable(args.tenantId);
  if (!ok) return [];
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const r = await pool.query(
    `
    SELECT id, user_id, parent_id, name, depth, created_at, updated_at
    FROM public.unified_chat_folders
    WHERE user_id = $1::uuid
    ORDER BY depth ASC, name ASC
    `,
    [args.userId],
  );
  return r.rows as UnifiedChatFolderRow[];
}

export async function createUnifiedChatFolder(args: {
  tenantId: string;
  userId: string;
  name: string;
  parentId?: string | null;
}): Promise<UnifiedChatFolderRow> {
  const ok = await ensureFoldersTable(args.tenantId);
  if (!ok) throw new Error("unified_chat_folders unavailable");
  const name = args.name.trim().slice(0, 200);
  if (!name) {
    throw Object.assign(new Error("Folder name is required"), { statusCode: 400 });
  }
  const depth = await folderDepth(args.tenantId, args.userId, args.parentId ?? null);
  if (depth > MAX_FOLDER_DEPTH) {
    throw Object.assign(new Error(`Maximum folder depth is ${MAX_FOLDER_DEPTH}`), {
      statusCode: 400,
    });
  }
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const id = randomUUID();
  const r = await pool.query(
    `
    INSERT INTO public.unified_chat_folders (id, user_id, parent_id, name, depth)
    VALUES ($1::uuid, $2::uuid, $3, $4, $5)
    RETURNING id, user_id, parent_id, name, depth, created_at, updated_at
    `,
    [id, args.userId, args.parentId ?? null, name, depth],
  );
  return r.rows[0] as UnifiedChatFolderRow;
}

export async function renameUnifiedChatFolder(args: {
  tenantId: string;
  userId: string;
  folderId: string;
  name: string;
}): Promise<UnifiedChatFolderRow | null> {
  const ok = await ensureFoldersTable(args.tenantId);
  if (!ok) return null;
  const name = args.name.trim().slice(0, 200);
  if (!name) {
    throw Object.assign(new Error("Folder name is required"), { statusCode: 400 });
  }
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const r = await pool.query(
    `
    UPDATE public.unified_chat_folders
    SET name = $3, updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $2::uuid
    RETURNING id, user_id, parent_id, name, depth, created_at, updated_at
    `,
    [args.folderId, args.userId, name],
  );
  return r.rows.length === 0 ? null : (r.rows[0] as UnifiedChatFolderRow);
}

function buildChildrenMap(
  folders: UnifiedChatFolderRow[],
): Map<string, UnifiedChatFolderRow[]> {
  const map = new Map<string, UnifiedChatFolderRow[]>();
  for (const folder of folders) {
    if (!folder.parent_id) continue;
    const siblings = map.get(folder.parent_id) ?? [];
    siblings.push(folder);
    map.set(folder.parent_id, siblings);
  }
  return map;
}

function collectDescendantIds(
  folderId: string,
  childrenByParent: Map<string, UnifiedChatFolderRow[]>,
): Set<string> {
  const blocked = new Set<string>([folderId]);
  const walk = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      blocked.add(child.id);
      walk(child.id);
    }
  };
  walk(folderId);
  return blocked;
}

function subtreeMaxDepth(
  folderId: string,
  folders: UnifiedChatFolderRow[],
  childrenByParent: Map<string, UnifiedChatFolderRow[]>,
): number {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const root = byId.get(folderId);
  if (!root) return 0;
  let maxDepth = root.depth;
  const walk = (id: string) => {
    for (const child of childrenByParent.get(id) ?? []) {
      maxDepth = Math.max(maxDepth, child.depth);
      walk(child.id);
    }
  };
  walk(folderId);
  return maxDepth;
}

export async function moveUnifiedChatFolder(args: {
  tenantId: string;
  userId: string;
  folderId: string;
  parentId: string | null;
}): Promise<UnifiedChatFolderRow | null> {
  const ok = await ensureFoldersTable(args.tenantId);
  if (!ok) return null;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);

  const current = await pool.query(
    `SELECT id, user_id, parent_id, name, depth, created_at, updated_at
     FROM public.unified_chat_folders
     WHERE id = $1::uuid AND user_id = $2::uuid`,
    [args.folderId, args.userId],
  );
  if (current.rows.length === 0) return null;

  const folder = current.rows[0] as UnifiedChatFolderRow;
  const nextParentId = args.parentId ?? null;
  if (folder.parent_id === nextParentId) return folder;

  if (nextParentId === args.folderId) {
    throw Object.assign(new Error("A folder cannot be moved into itself"), {
      statusCode: 400,
    });
  }

  const allFolders = await listUnifiedChatFolders({
    tenantId: args.tenantId,
    userId: args.userId,
  });
  const childrenByParent = buildChildrenMap(allFolders);

  if (nextParentId) {
    const parentExists = allFolders.some((f) => f.id === nextParentId);
    if (!parentExists) {
      throw Object.assign(new Error("Parent folder not found"), { statusCode: 404 });
    }
    const blocked = collectDescendantIds(args.folderId, childrenByParent);
    if (blocked.has(nextParentId)) {
      throw Object.assign(new Error("A folder cannot be moved into its own subfolder"), {
        statusCode: 400,
      });
    }
  }

  const newDepth = nextParentId
    ? (allFolders.find((f) => f.id === nextParentId)?.depth ?? 0) + 1
    : 1;
  const oldDepth = folder.depth;
  const depthDelta = newDepth - oldDepth;
  const maxDepthAfterMove = subtreeMaxDepth(args.folderId, allFolders, childrenByParent) + depthDelta;
  if (maxDepthAfterMove > MAX_FOLDER_DEPTH) {
    throw Object.assign(
      new Error(`Maximum folder depth is ${MAX_FOLDER_DEPTH}`),
      { statusCode: 400 },
    );
  }

  await pool.query(
    `
    WITH RECURSIVE subtree AS (
      SELECT id FROM public.unified_chat_folders
      WHERE id = $1::uuid AND user_id = $2::uuid
      UNION ALL
      SELECT f.id
      FROM public.unified_chat_folders f
      INNER JOIN subtree s ON f.parent_id = s.id
      WHERE f.user_id = $2::uuid
    )
    UPDATE public.unified_chat_folders
    SET depth = depth + $3, updated_at = NOW()
    WHERE id IN (SELECT id FROM subtree) AND user_id = $2::uuid
    `,
    [args.folderId, args.userId, depthDelta],
  );

  const moved = await pool.query(
    `
    UPDATE public.unified_chat_folders
    SET parent_id = $3, depth = $4, updated_at = NOW()
    WHERE id = $1::uuid AND user_id = $2::uuid
    RETURNING id, user_id, parent_id, name, depth, created_at, updated_at
    `,
    [args.folderId, args.userId, nextParentId, newDepth],
  );
  return moved.rows.length === 0 ? null : (moved.rows[0] as UnifiedChatFolderRow);
}

export async function deleteUnifiedChatFolder(args: {
  tenantId: string;
  userId: string;
  folderId: string;
}): Promise<boolean> {
  const ok = await ensureFoldersTable(args.tenantId);
  if (!ok) return false;
  const pool = await tenantDbManager.getTenantPool(args.tenantId);
  const folder = await pool.query(
    `SELECT parent_id FROM public.unified_chat_folders WHERE id = $1::uuid AND user_id = $2::uuid`,
    [args.folderId, args.userId],
  );
  if (folder.rows.length === 0) return false;
  const parentId = folder.rows[0].parent_id as string | null;

  await pool.query(
    `
    UPDATE public.unified_chat_conversations
    SET folder_id = $3, updated_at = NOW()
    WHERE folder_id = $1::uuid AND user_id = $2::uuid
    `,
    [args.folderId, args.userId, parentId],
  );

  const childFolders = await pool.query(
    `SELECT id FROM public.unified_chat_folders WHERE parent_id = $1::uuid AND user_id = $2::uuid`,
    [args.folderId, args.userId],
  );
  for (const row of childFolders.rows) {
    await pool.query(
      `
      UPDATE public.unified_chat_folders
      SET parent_id = $3, depth = GREATEST(1, depth - 1), updated_at = NOW()
      WHERE id = $1::uuid AND user_id = $2::uuid
      `,
      [row.id, args.userId, parentId],
    );
  }

  const r = await pool.query(
    `DELETE FROM public.unified_chat_folders WHERE id = $1::uuid AND user_id = $2::uuid`,
    [args.folderId, args.userId],
  );
  return (r.rowCount ?? 0) > 0;
}
