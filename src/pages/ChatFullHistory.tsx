/**
 * Full unified chat history (COHI-403 §7).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Folder, Loader2, X } from "lucide-react";
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
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { cohiChatResumeNavigationState } from "@/contexts/ChatShellContext";
import {
  buildFolderBreadcrumb,
  conversationMatchesFolderFilter,
  getDirectChildFolders,
  getFolderNameById,
  UNIFIED_CHAT_FOLDERS_SYNC_EVENT,
} from "@/lib/unifiedChatFolderUtils";
import type { UnifiedChatFolder } from "@/lib/unifiedChatClient";
import {
  ConversationMoveMenu,
  FolderMoveMenu,
} from "@/components/cohi/UnifiedChatMoveMenus";
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

  const load = useCallback(async () => {
    if (!enabled) return;
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
        setRows(data);
      }
    } finally {
      if (seq === loadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [
    enabled,
    searchConversations,
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
    const onFoldersSync = () => {
      void load();
    };
    window.addEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onFoldersSync);
    return () =>
      window.removeEventListener(UNIFIED_CHAT_FOLDERS_SYNC_EVENT, onFoldersSync);
  }, [enabled, load]);

  const handleMoveConversation = async (
    conversationId: string,
    folderId: string | null,
  ) => {
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

  const childFolders = getDirectChildFolders(selectedFolderId, folders);
  const breadcrumb = selectedFolderId
    ? buildFolderBreadcrumb(selectedFolderId, folders)
    : [];

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

        {folders.length > 0 && (
          <div className="mb-4 space-y-3">
            {selectedFolderId && (
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
          </div>
        )}

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
                      navigate(
                        `/insights?resume=${encodeURIComponent(row.id)}&mode=${row.chat_type}`,
                        { state: cohiChatResumeNavigationState() },
                      )
                    }
                  >
                    <p className="font-medium text-slate-900 dark:text-white truncate">
                      {row.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {row.folder_id && (
                        <>
                          {getFolderNameById(row.folder_id, folders) ??
                            "Folder"}{" "}
                          ·{" "}
                        </>
                      )}
                      {row.chat_type} ·{" "}
                      {new Date(row.updated_at).toLocaleString()}
                    </p>
                  </button>
                  <ConversationMoveMenu
                    conversationId={row.id}
                    currentFolderId={row.folder_id}
                    folders={folders}
                    onMove={handleMoveConversation}
                    triggerClassName="h-8 w-8 mr-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  />
                </li>
              ))}
              {rows.length === 0 && (
                <li className="px-4 py-8 text-center text-slate-500 text-sm">
                  No conversations found.
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
