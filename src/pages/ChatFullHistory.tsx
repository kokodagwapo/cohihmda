/**
 * Full unified chat history (COHI-403 §7).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Folder, Loader2, Users, X } from "lucide-react";
import { DashboardLayout } from "@/components/dashboard/DashboardLayout";
import { useDashboardVisibility } from "@/hooks/useDashboardVisibility";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { useUnifiedChatHistory } from "@/hooks/useUnifiedChatHistory";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import {
  formatChatTypeLabel,
  getChatTypePillClassName,
} from "@/lib/unifiedChatTypeStyles";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { cohiChatResumeNavigationState } from "@/contexts/ChatShellContext";
import { buildUnifiedChatResumePath } from "@/lib/chatHomeRoute";
import { navigateForWorkbenchConversationResume } from "@/lib/workbench/workbenchChatHandoff";
import { createUnifiedChatClient } from "@/lib/unifiedChatClient";
import {
  buildFolderBreadcrumb,
  conversationMatchesFolderFilter,
  getDirectChildFolders,
  getFolderNameById,
  SHARED_WITH_ME_FOLDER_ID,
  UNIFIED_CHAT_FOLDERS_SYNC_EVENT,
  UNIFIED_CHAT_HISTORY_SYNC_EVENT,
} from "@/lib/unifiedChatFolderUtils";
import { formatUserDisplayName } from "@/lib/userDisplayName";
import type { UnifiedChatFolder } from "@/lib/unifiedChatClient";
import {
  ConversationMoveMenu,
  FolderMoveMenu,
} from "@/components/cohi/UnifiedChatMoveMenus";
import { HistoryMetaPill } from "@/components/cohi/UnifiedChatHistoryMeta";
import { ConversationRunningIndicator } from "@/components/cohi/ConversationRunningIndicator";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;
const SEARCH_DEBOUNCE_MS = 300;

function FolderListCard({
  title,
  folders,
  allFolders,
  onSelect,
  onMoveFolder,
}: {
  title: string;
  folders: UnifiedChatFolder[];
  allFolders: UnifiedChatFolder[];
  onSelect: (folderId: string) => void;
  onMoveFolder: (folderId: string, parentId: string | null) => Promise<void>;
}) {
  if (folders.length === 0) return null;

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
        {title}
      </p>
      <ul className="space-y-1">
        {folders.map((folder) => (
          <li key={folder.id} className="flex items-center gap-1 group">
            <button
              type="button"
              className="flex-1 min-w-0 flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50 dark:hover:bg-slate-900/50"
              onClick={() => onSelect(folder.id)}
            >
              <Folder className="h-4 w-4 text-slate-400 shrink-0" />
              <span className="truncate text-slate-900 dark:text-white">
                {folder.name}
              </span>
            </button>
            <FolderMoveMenu
              folder={folder}
              folders={allFolders}
              onMove={onMoveFolder}
              triggerClassName="h-8 w-8 mr-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ChatFullHistory() {
  const { isAuthenticated, user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const tenantId = selectedTenantId || user?.tenant_id || undefined;
  const navigate = useNavigate();
  const { toast } = useToast();
  const { dashboardVisibility, handleVisibilityChange } =
    useDashboardVisibility();
  const {
    searchConversations,
    sharedConversations,
    folders,
    enabled,
    moveConversationToFolder,
    moveFolder,
  } = useUnifiedChatHistory(tenantId);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [chatType, setChatType] = useState<UnifiedChatType | "all">("all");
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [rows, setRows] = useState<
    Awaited<ReturnType<typeof searchConversations>>
  >([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const loadSeqRef = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(q), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    setOffset(0);
  }, [debouncedQ, chatType, selectedFolderId]);

  const isSharedWithMeFolder =
    selectedFolderId === SHARED_WITH_ME_FOLDER_ID;

  const load = useCallback(async () => {
    if (!enabled) return;
    const seq = ++loadSeqRef.current;
    setLoading(true);
    try {
      if (isSharedWithMeFolder) {
        const qLower = debouncedQ.trim().toLowerCase();
        const filtered = sharedConversations.filter((row) => {
          if (chatType !== "all" && row.chat_type !== chatType) return false;
          if (qLower && !row.title.toLowerCase().includes(qLower)) return false;
          return true;
        });
        if (seq === loadSeqRef.current) {
          setRows(filtered.slice(offset, offset + PAGE_SIZE));
        }
        return;
      }
      const data = await searchConversations({
        q: debouncedQ.trim() || undefined,
        chat_type: chatType === "all" ? undefined : chatType,
        folder_id: selectedFolderId ?? undefined,
        include_subfolders: true,
        limit: PAGE_SIZE,
        offset,
      });
      if (seq === loadSeqRef.current) {
        const sharedLegacyRefs = new Set(
          sharedConversations
            .map((c) => c.legacy_ref)
            .filter((ref): ref is string => Boolean(ref)),
        );
        const sharedIds = new Set(sharedConversations.map((c) => c.id));
        setRows(
          data.filter(
            (row) =>
              !row.is_shared_view &&
              !sharedIds.has(row.id) &&
              !(row.legacy_ref && sharedLegacyRefs.has(row.legacy_ref)),
          ),
        );
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [
    enabled,
    searchConversations,
    sharedConversations,
    isSharedWithMeFolder,
    debouncedQ,
    chatType,
    selectedFolderId,
    offset,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!enabled) return;
    const onSync = () => {
      void load();
    };
    window.addEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onSync);
    window.addEventListener(UNIFIED_CHAT_HISTORY_SYNC_EVENT, onSync);
    return () => {
      window.removeEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onSync);
      window.removeEventListener(UNIFIED_CHAT_HISTORY_SYNC_EVENT, onSync);
    };
  }, [enabled, load]);

  const handleMoveConversation = async (
    conversationId: string,
    folderId: string | null,
  ) => {
    if (folderId === SHARED_WITH_ME_FOLDER_ID) return;
    const previousRows = rows;
    setRows((prev) => {
      const updated = prev.map((row) =>
        row.id === conversationId ? { ...row, folder_id: folderId } : row,
      );
      if (!selectedFolderId) return updated;
      return updated.filter((row) =>
        conversationMatchesFolderFilter(
          row.folder_id,
          selectedFolderId,
          folders,
          true,
        ),
      );
    });
    try {
      await moveConversationToFolder(conversationId, folderId);
      const seq = ++loadSeqRef.current;
      setLoading(true);
      try {
        const data = await searchConversations({
          q: debouncedQ.trim() || undefined,
          chat_type: chatType === "all" ? undefined : chatType,
          folder_id: selectedFolderId ?? undefined,
          include_subfolders: true,
          limit: PAGE_SIZE,
          offset,
        });
        if (seq === loadSeqRef.current) {
          setRows(
            data.map((row) =>
              row.id === conversationId ? { ...row, folder_id: folderId } : row,
            ),
          );
        }
      } finally {
        if (seq === loadSeqRef.current) {
          setLoading(false);
        }
      }
      const folderName = getFolderNameById(folderId, folders);
      toast({
        title: folderId ? "Moved to folder" : "Removed from folder",
        description: folderId ? folderName ?? undefined : undefined,
      });
    } catch (err) {
      setRows(previousRows);
      toast({
        variant: "destructive",
        title: "Could not move chat",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  };

  const handleMoveFolder = async (
    folderId: string,
    parentId: string | null,
  ) => {
    try {
      await moveFolder(folderId, parentId);
      await load();
      toast({ title: "Folder moved" });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not move folder",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  };

  const childFolders = isSharedWithMeFolder
    ? []
    : getDirectChildFolders(selectedFolderId, folders);
  const breadcrumb =
    selectedFolderId && !isSharedWithMeFolder
      ? buildFolderBreadcrumb(selectedFolderId, folders)
      : [];

  const resumeConversation = async (
    id: string,
    rowChatType: string,
    row?: (typeof rows)[number],
  ) => {
    let resumeId = id;
    if (row?.is_shared_view && row.legacy_ref) {
      try {
        const client = createUnifiedChatClient(tenantId);
        const opened = await client.openSharedResearch(row.legacy_ref);
        resumeId = opened.id;
      } catch {
        resumeId = row.legacy_ref;
      }
    }
    if (rowChatType === "workbench") {
      const scopeType = row?.scope?.type;
      const scopeId = row?.scope?.id;
      if (
        scopeId &&
        (scopeType === "canvas" || scopeType === "draft") &&
        navigateForWorkbenchConversationResume(navigate, {
          conversationId: resumeId,
          scopeType,
          scopeId,
        })
      ) {
        return;
      }
      try {
        const client = createUnifiedChatClient(tenantId);
        const full = await client.getConversation(resumeId);
        const rowScopeType = full.scope?.type;
        const rowScopeId = full.scope?.id;
        if (
          rowScopeId &&
          (rowScopeType === "canvas" || rowScopeType === "draft") &&
          navigateForWorkbenchConversationResume(navigate, {
            conversationId: resumeId,
            scopeType: rowScopeType,
            scopeId: rowScopeId,
          })
        ) {
          return;
        }
      } catch {
        /* fall through */
      }
    }

    navigate(buildUnifiedChatResumePath(resumeId, rowChatType), {
      state: cohiChatResumeNavigationState(),
    });
  };

  if (!isUnifiedChatClientEnabled()) {
    return (
      <DashboardLayout
        isAuthenticated={isAuthenticated}
        mobileMenuOpen={false}
        onMobileMenuToggle={() => {}}
        dashboardVisibility={dashboardVisibility}
        onVisibilityChange={handleVisibilityChange}
        onReportClick={() => {}}
      >
        <div className="container mx-auto px-4 py-12 text-center text-slate-600">
          Unified chat history requires VITE_UNIFIED_CHAT=true.
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout
      isAuthenticated={isAuthenticated}
      mobileMenuOpen={false}
      onMobileMenuToggle={() => {}}
      dashboardVisibility={dashboardVisibility}
      onVisibilityChange={handleVisibilityChange}
      onReportClick={() => {}}
    >
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white mb-6">
          Full chat history
        </h1>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="relative max-w-xs w-full">
            <Input
              placeholder="Search by title…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={cn("w-full", q && "pr-9")}
              aria-label="Search conversations by title"
            />
            {q && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-10 w-9 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
                onClick={() => setQ("")}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Select
            value={chatType}
            onValueChange={(v) => setChatType(v as UnifiedChatType | "all")}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="chat">Chat</SelectItem>
              <SelectItem value="research">Research</SelectItem>
              <SelectItem value="insight_builder">Insight builder</SelectItem>
              <SelectItem value="workbench">Workbench</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="mb-4 space-y-3">
            <div className="rounded-xl border border-amber-200/80 dark:border-amber-800/50 p-3">
              <button
                type="button"
                className={cn(
                  "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
                  isSharedWithMeFolder
                    ? "bg-amber-50 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100"
                    : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/50",
                )}
                onClick={() =>
                  setSelectedFolderId(
                    isSharedWithMeFolder ? null : SHARED_WITH_ME_FOLDER_ID,
                  )
                }
              >
                <Users className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="flex-1 truncate">Shared With Me</span>
                {sharedConversations.length > 0 && (
                  <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80 tabular-nums">
                    ({sharedConversations.length})
                  </span>
                )}
              </button>
            </div>
        {folders.length > 0 && (
          <>
            {selectedFolderId && !isSharedWithMeFolder && (
              <nav
                aria-label="Folder breadcrumb"
                className="flex flex-wrap items-center gap-1 text-sm text-slate-600 dark:text-slate-400"
              >
                <button
                  type="button"
                  className="hover:text-slate-900 dark:hover:text-white"
                  onClick={() => setSelectedFolderId(null)}
                >
                  All folders
                </button>
                {breadcrumb.map((folder) => (
                  <span
                    key={folder.id}
                    className="inline-flex items-center gap-1"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    <button
                      type="button"
                      className="hover:text-slate-900 dark:hover:text-white"
                      onClick={() => setSelectedFolderId(folder.id)}
                    >
                      {folder.name}
                    </button>
                  </span>
                ))}
              </nav>
            )}
            <FolderListCard
              title={selectedFolderId ? "Subfolders" : "Folders"}
              folders={childFolders}
              allFolders={folders}
              onSelect={setSelectedFolderId}
              onMoveFolder={handleMoveFolder}
            />
          </>
        )}
        </div>

        {loading && rows.length === 0 ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
          </div>
        ) : (
          <div className="relative">
            {loading && (
              <div
                className="absolute inset-0 z-10 flex items-start justify-center pt-12 bg-white/70 dark:bg-slate-950/70 backdrop-blur-[1px]"
                aria-hidden
              >
                <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
              </div>
            )}
            <ul className="divide-y divide-slate-200 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800">
              {rows.map((row) => (
                <li key={row.id} className="flex items-center gap-2 group">
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-900/50"
                    onClick={() =>
                      void resumeConversation(row.id, row.chat_type, row)
                    }
                  >
                    <p className="font-medium text-slate-900 dark:text-white truncate flex items-center gap-2">
                      <span className="truncate flex-1 min-w-0">{row.title}</span>
                      <ConversationRunningIndicator conversationId={row.id} />
                    </p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500 mt-1.5">
                      <HistoryMetaPill
                        className={getChatTypePillClassName(row.chat_type)}
                      >
                        {formatChatTypeLabel(row.chat_type)}
                      </HistoryMetaPill>
                      {row.folder_id && (
                        <HistoryMetaPill className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                          {getFolderNameById(row.folder_id, folders) ?? "Folder"}
                        </HistoryMetaPill>
                      )}
                      {row.is_shared_view &&
                        (row.shared_by_name || row.shared_by_email) && (
                          <HistoryMetaPill className="bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                            Shared by{" "}
                            {row.shared_by_name ||
                              formatUserDisplayName(null, row.shared_by_email)}
                          </HistoryMetaPill>
                        )}
                      <span className="text-slate-400 dark:text-slate-500">
                        {new Date(row.updated_at).toLocaleString()}
                      </span>
                    </p>
                  </button>
                  {!row.is_shared_view && (
                    <ConversationMoveMenu
                      conversationId={row.id}
                      currentFolderId={row.folder_id}
                      folders={folders}
                      onMove={handleMoveConversation}
                      triggerClassName="h-8 w-8 mr-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    />
                  )}
                </li>
              ))}
              {rows.length === 0 && (
                <li className="px-4 py-8 text-center text-slate-500 text-sm">
                  {isSharedWithMeFolder
                    ? "No shared research yet."
                    : "No conversations found."}
                </li>
              )}
            </ul>
          </div>
        )}
        <div className="flex justify-between mt-4">
          <Button
            variant="outline"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            disabled={rows.length < PAGE_SIZE || loading}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
    </DashboardLayout>
  );
}
