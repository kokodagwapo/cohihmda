import type { UnifiedChatFolder, UnifiedConversationSummary } from "@/lib/unifiedChatClient";

/** Virtual sidebar folder for shared research chats (not in unified_chat_folders). */
export const SHARED_WITH_ME_FOLDER_ID = "__cohi_shared_with_me__";

export function isSharedWithMeFolderId(folderId: string | null | undefined): boolean {
  return folderId === SHARED_WITH_ME_FOLDER_ID;
}

export function groupFoldersByParent(folders: UnifiedChatFolder[]) {
  const byParent = new Map<string | null, UnifiedChatFolder[]>();
  for (const folder of folders) {
    const parentId = folder.parent_id ?? null;
    const siblings = byParent.get(parentId) ?? [];
    siblings.push(folder);
    byParent.set(parentId, siblings);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => a.name.localeCompare(b.name));
  }
  return byParent;
}

export function groupConversationsByFolder(
  conversations: UnifiedConversationSummary[],
) {
  const byFolder = new Map<string, UnifiedConversationSummary[]>();
  for (const conversation of conversations) {
    if (!conversation.folder_id) continue;
    const rows = byFolder.get(conversation.folder_id) ?? [];
    rows.push(conversation);
    byFolder.set(conversation.folder_id, rows);
  }
  for (const rows of byFolder.values()) {
    rows.sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }
  return byFolder;
}

export function getFolderDescendantIds(
  folderId: string,
  folders: UnifiedChatFolder[],
): Set<string> {
  const byParent = groupFoldersByParent(folders);
  const blocked = new Set<string>([folderId]);
  const walk = (id: string) => {
    for (const child of byParent.get(id) ?? []) {
      blocked.add(child.id);
      walk(child.id);
    }
  };
  walk(folderId);
  return blocked;
}

/** Folders a conversation can be moved into (excludes its current folder). */
export function getConversationMoveTargets(
  folders: UnifiedChatFolder[],
  currentFolderId: string | null | undefined,
) {
  if (!currentFolderId) return folders;
  return folders.filter((folder) => folder.id !== currentFolderId);
}

/** Folders a folder can be moved into (excludes self and descendants). */
export function getFolderMoveTargets(
  folders: UnifiedChatFolder[],
  folderId: string,
) {
  const blocked = getFolderDescendantIds(folderId, folders);
  return folders.filter((folder) => !blocked.has(folder.id));
}

export function formatFolderOptionLabel(
  folder: UnifiedChatFolder,
  folders: UnifiedChatFolder[],
) {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const parts: string[] = [];
  let current: UnifiedChatFolder | undefined = folder;
  while (current) {
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return parts.join(" / ");
}

export function flattenFoldersForSelect(folders: UnifiedChatFolder[]) {
  const byParent = groupFoldersByParent(folders);
  const rows: Array<{ folder: UnifiedChatFolder; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const folder of byParent.get(parentId) ?? []) {
      rows.push({ folder, depth });
      walk(folder.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

/** Label for folder filter dropdowns (root names plain; nested prefixed with ↳). */
export function formatFolderSelectMenuLabel(depth: number, name: string) {
  if (depth <= 0) return name;
  const indent = "\u00A0".repeat(Math.max(0, (depth - 1) * 2));
  return `${indent}\u21B3\u00A0${name}`;
}

export const UNIFIED_CHAT_FOLDERS_SYNC_EVENT = "cohi-unified-chat-folders-sync";

export function dispatchUnifiedChatFoldersSync() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(UNIFIED_CHAT_FOLDERS_SYNC_EVENT));
}

/** Bust sidebar / Shared With Me after research session sharing changes. */
export const UNIFIED_CHAT_HISTORY_SYNC_EVENT = "cohi-unified-chat-history-sync";

export type UnifiedChatHistorySyncDetail = {
  /** Prepend to recent history before the server row exists (new chat submit). */
  conversation?: UnifiedConversationSummary;
  /** When true, refetch from API. Default: true unless `conversation` is set alone. */
  refresh?: boolean;
};

export function dispatchUnifiedChatHistorySync(
  detail?: UnifiedChatHistorySyncDetail,
) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(UNIFIED_CHAT_HISTORY_SYNC_EVENT, { detail }),
  );
}

/** Show a new chat in sidebar recents immediately on submit. */
export function notifyOptimisticUnifiedChatConversation(
  conversation: UnifiedConversationSummary,
) {
  dispatchUnifiedChatHistorySync({ conversation, refresh: false });
}

/** Refetch sidebar / full history from the API. */
export function refreshUnifiedChatHistoryList() {
  dispatchUnifiedChatHistorySync({ refresh: true });
}

export function getDirectChildFolders(
  folderId: string | null,
  folders: UnifiedChatFolder[],
) {
  return groupFoldersByParent(folders).get(folderId) ?? [];
}

export function getFolderSubtreeIds(
  folderId: string,
  folders: UnifiedChatFolder[],
) {
  return getFolderDescendantIds(folderId, folders);
}

export function buildFolderBreadcrumb(
  folderId: string | null,
  folders: UnifiedChatFolder[],
) {
  if (!folderId) return [] as UnifiedChatFolder[];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const trail: UnifiedChatFolder[] = [];
  let current = byId.get(folderId);
  while (current) {
    trail.unshift(current);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return trail;
}

export function getFolderNameById(
  folderId: string | null | undefined,
  folders: UnifiedChatFolder[],
) {
  if (!folderId) return null;
  return folders.find((folder) => folder.id === folderId)?.name ?? null;
}

/** Whether a conversation belongs in a folder-filtered history view. */
export function conversationMatchesFolderFilter(
  conversationFolderId: string | null | undefined,
  selectedFolderId: string | null,
  folders: UnifiedChatFolder[],
  includeSubfolders = true,
) {
  if (!selectedFolderId) return true;
  if (!conversationFolderId) return false;
  if (!includeSubfolders) return conversationFolderId === selectedFolderId;
  return getFolderSubtreeIds(selectedFolderId, folders).has(conversationFolderId);
}
