/**
 * Unified v1 history + folders for sidebar and Full History (COHI-403 / COHI-405).
 */

import { useCallback, useEffect, useState } from "react";
import {
  createUnifiedChatClient,
  type UnifiedChatFolder,
  type UnifiedChatType,
  type UnifiedConversationSummary,
} from "@/lib/unifiedChatClient";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import {
  dispatchUnifiedChatFoldersSync,
  UNIFIED_CHAT_FOLDERS_SYNC_EVENT,
} from "@/lib/unifiedChatFolderUtils";

export function useUnifiedChatHistory(
  tenantId?: string,
  options?: { recentLimit?: number },
) {
  const defaultRecentLimit = options?.recentLimit ?? 10;
  const [conversations, setConversations] = useState<UnifiedConversationSummary[]>(
    [],
  );
  const [folders, setFolders] = useState<UnifiedChatFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const enabled =
    typeof window !== "undefined" && isUnifiedChatClientEnabled();

  const refreshAll = useCallback(
    async (opts?: { chat_type?: UnifiedChatType; limit?: number }) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const client = createUnifiedChatClient(tenantId);
        const [folderRows, conversationRows] = await Promise.all([
          client.listFolders(),
          client.listConversations({
            limit: opts?.limit ?? defaultRecentLimit,
            chat_type: opts?.chat_type,
          }),
        ]);
        setFolders(folderRows);
        setConversations(conversationRows);
        dispatchUnifiedChatFoldersSync();
      } finally {
        setLoading(false);
      }
    },
    [enabled, tenantId, defaultRecentLimit],
  );

  const refreshRecents = useCallback(
    async (opts?: { chat_type?: UnifiedChatType; limit?: number }) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const client = createUnifiedChatClient(tenantId);
        const rows = await client.listConversations({
          limit: opts?.limit ?? defaultRecentLimit,
          chat_type: opts?.chat_type,
        });
        setConversations(rows);
      } finally {
        setLoading(false);
      }
    },
    [enabled, tenantId, defaultRecentLimit],
  );

  const refreshFolders = useCallback(async () => {
    if (!enabled) return;
    const client = createUnifiedChatClient(tenantId);
    const rows = await client.listFolders();
    setFolders(rows);
  }, [enabled, tenantId]);

  const searchConversations = useCallback(
    async (query: {
      q?: string;
      chat_type?: UnifiedChatType;
      folder_id?: string;
      include_subfolders?: boolean;
      limit?: number;
      offset?: number;
    }) => {
      if (!enabled) return [] as UnifiedConversationSummary[];
      const client = createUnifiedChatClient(tenantId);
      return client.listConversations(query);
    },
    [enabled, tenantId],
  );

  const moveConversationToFolder = useCallback(
    async (conversationId: string, folderId: string | null) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(tenantId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId ? { ...c, folder_id: folderId } : c,
        ),
      );
      await client.patchConversation(conversationId, { folder_id: folderId });
      await refreshRecents();
    },
    [enabled, tenantId, refreshRecents],
  );

  const createFolder = useCallback(
    async (name: string, parentId?: string | null) => {
      if (!enabled) return undefined;
      const client = createUnifiedChatClient(tenantId);
      const folder = await client.createFolder({
        name,
        parent_id: parentId ?? null,
      });
      setFolders((prev) =>
        prev.some((f) => f.id === folder.id) ? prev : [...prev, folder],
      );
      await refreshAll();
      return folder;
    },
    [enabled, tenantId, refreshAll],
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(tenantId);
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, name } : f)),
      );
      await client.renameFolder(folderId, name);
      await refreshAll();
    },
    [enabled, tenantId, refreshAll],
  );

  const moveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(tenantId);
      setFolders((prev) =>
        prev.map((folder) =>
          folder.id === folderId
            ? { ...folder, parent_id: parentId }
            : folder,
        ),
      );
      try {
        await client.moveFolder(folderId, parentId);
        await refreshAll();
      } catch (err) {
        await refreshFolders();
        throw err;
      }
    },
    [enabled, tenantId, refreshAll, refreshFolders],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(tenantId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      await client.deleteFolder(folderId);
      await refreshAll();
    },
    [enabled, tenantId, refreshAll],
  );

  useEffect(() => {
    if (!enabled) return;
    void refreshAll();
  }, [enabled, refreshAll]);

  useEffect(() => {
    if (!enabled) return;
    const onFoldersSync = () => {
      void refreshFolders();
    };
    window.addEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onFoldersSync);
    return () =>
      window.removeEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onFoldersSync);
  }, [enabled, refreshFolders]);

  return {
    enabled,
    conversations,
    folders,
    loading,
    refreshAll,
    refreshRecents,
    refreshFolders,
    searchConversations,
    moveConversationToFolder,
    createFolder,
    renameFolder,
    moveFolder,
    deleteFolder,
  };
}
