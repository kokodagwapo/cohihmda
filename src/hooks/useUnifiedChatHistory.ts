/**
 * Unified v1 history + folders for sidebar and Full History (COHI-403 / COHI-405).
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
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
  UNIFIED_CHAT_HISTORY_SYNC_EVENT,
  type UnifiedChatHistorySyncDetail,
} from "@/lib/unifiedChatFolderUtils";

export function useUnifiedChatHistory(
  tenantId?: string,
  options?: { recentLimit?: number },
) {
  const { user } = useAuth();
  const effectiveTenantId = tenantId ?? user?.tenant_id ?? undefined;
  const defaultRecentLimit = options?.recentLimit ?? 10;
  const [conversations, setConversations] = useState<UnifiedConversationSummary[]>(
    [],
  );
  const [sharedConversations, setSharedConversations] = useState<
    UnifiedConversationSummary[]
  >([]);
  const [folders, setFolders] = useState<UnifiedChatFolder[]>([]);
  const [loading, setLoading] = useState(false);

  const enabled =
    typeof window !== "undefined" && isUnifiedChatClientEnabled();

  const refreshAll = useCallback(
    async (opts?: { chat_type?: UnifiedChatType; limit?: number }) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const client = createUnifiedChatClient(effectiveTenantId);
        const [folderRows, conversationRows, sharedRows] = await Promise.all([
          client.listFolders(),
          client.listConversations({
            limit: opts?.limit ?? defaultRecentLimit,
            chat_type: opts?.chat_type,
          }),
          client.listConversations({ shared_with_me: true, limit: 50 }),
        ]);
        setFolders(folderRows);
        const sharedLegacyRefs = new Set(
          sharedRows
            .map((c) => c.legacy_ref)
            .filter((ref): ref is string => Boolean(ref)),
        );
        const sharedIds = new Set(sharedRows.map((c) => c.id));
        setConversations(
          conversationRows.filter(
            (c) =>
              !c.is_shared_view &&
              !sharedIds.has(c.id) &&
              !(c.legacy_ref && sharedLegacyRefs.has(c.legacy_ref)),
          ),
        );
        setSharedConversations(sharedRows);
        dispatchUnifiedChatFoldersSync();
      } catch (err) {
        console.error("[useUnifiedChatHistory] refreshAll failed:", err);
      } finally {
        setLoading(false);
      }
    },
    [enabled, effectiveTenantId, defaultRecentLimit],
  );

  const refreshRecents = useCallback(
    async (opts?: { chat_type?: UnifiedChatType; limit?: number }) => {
      if (!enabled) return;
      setLoading(true);
      try {
        const client = createUnifiedChatClient(effectiveTenantId);
        const rows = await client.listConversations({
          limit: opts?.limit ?? defaultRecentLimit,
          chat_type: opts?.chat_type,
        });
        setConversations(rows);
      } finally {
        setLoading(false);
      }
    },
    [enabled, effectiveTenantId, defaultRecentLimit],
  );

  const refreshFolders = useCallback(async () => {
    if (!enabled) return;
    const client = createUnifiedChatClient(effectiveTenantId);
    const rows = await client.listFolders();
    setFolders(rows);
  }, [enabled, effectiveTenantId]);

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
      const client = createUnifiedChatClient(effectiveTenantId);
      return client.listConversations(query);
    },
    [enabled, effectiveTenantId],
  );

  const moveConversationToFolder = useCallback(
    async (conversationId: string, folderId: string | null) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(effectiveTenantId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId ? { ...c, folder_id: folderId } : c,
        ),
      );
      await client.patchConversation(conversationId, { folder_id: folderId });
      await refreshRecents();
    },
    [enabled, effectiveTenantId, refreshRecents],
  );

  const createFolder = useCallback(
    async (name: string, parentId?: string | null) => {
      if (!enabled) return undefined;
      const client = createUnifiedChatClient(effectiveTenantId);
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
    [enabled, effectiveTenantId, refreshAll],
  );

  const renameFolder = useCallback(
    async (folderId: string, name: string) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(effectiveTenantId);
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, name } : f)),
      );
      await client.renameFolder(folderId, name);
      await refreshAll();
    },
    [enabled, effectiveTenantId, refreshAll],
  );

  const moveFolder = useCallback(
    async (folderId: string, parentId: string | null) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(effectiveTenantId);
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
    [enabled, effectiveTenantId, refreshAll, refreshFolders],
  );

  const deleteFolder = useCallback(
    async (folderId: string) => {
      if (!enabled) return;
      const client = createUnifiedChatClient(effectiveTenantId);
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      await client.deleteFolder(folderId);
      await refreshAll();
    },
    [enabled, effectiveTenantId, refreshAll],
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
    const onHistorySync = (event: Event) => {
      const detail = (event as CustomEvent<UnifiedChatHistorySyncDetail>)
        .detail;
      if (detail?.conversation) {
        setConversations((prev) => {
          const without = prev.filter((c) => c.id !== detail.conversation!.id);
          return [detail.conversation!, ...without];
        });
      }
      const shouldRefresh =
        detail?.refresh === true ||
        (detail?.refresh === undefined && !detail?.conversation);
      if (shouldRefresh) {
        void refreshAll();
      }
    };
    window.addEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onFoldersSync);
    window.addEventListener(UNIFIED_CHAT_HISTORY_SYNC_EVENT, onHistorySync);
    return () => {
      window.removeEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onFoldersSync);
      window.removeEventListener(UNIFIED_CHAT_HISTORY_SYNC_EVENT, onHistorySync);
    };
  }, [enabled, refreshFolders, refreshAll]);

  return {
    enabled,
    conversations,
    sharedConversations,
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
