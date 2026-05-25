/**
 * Sidebar History / Folders / Full History (COHI-405) — v1 client only.
 */

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ChevronRight,
  Clock,
  Folder,
  History,
  Table2,
  Users,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatUserDisplayName } from "@/lib/userDisplayName";
import { useUnifiedChatHistory } from "@/hooks/useUnifiedChatHistory";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { cohiChatResumeNavigationState } from "@/contexts/ChatShellContext";
import { buildUnifiedChatResumePath } from "@/lib/chatHomeRoute";
import {
  navigateForWorkbenchConversationResume,
} from "@/lib/workbench/workbenchChatHandoff";
import { createUnifiedChatClient } from "@/lib/unifiedChatClient";
import {
  getFolderNameById,
  groupConversationsByFolder,
  groupFoldersByParent,
  isSharedWithMeFolderId,
  SHARED_WITH_ME_FOLDER_ID,
} from "@/lib/unifiedChatFolderUtils";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import {
  formatChatTypeLabel,
  getChatTypePillClassName,
} from "@/lib/unifiedChatTypeStyles";
import { HistoryMetaPill } from "@/components/cohi/UnifiedChatHistoryMeta";
import { ConversationRunningIndicator } from "@/components/cohi/ConversationRunningIndicator";
import {
  ConversationMoveMenu,
  FolderMoveMenu,
} from "@/components/cohi/UnifiedChatMoveMenus";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  SidebarExpandableSection,
  SidebarTourAnchor,
} from "@/components/cohi/sidebarNavPrimitives";
import { cohiTourAnchorId } from "@/lib/tourTargets";

const SIDEBAR_HISTORY_LIMIT = 5;
/** Fetch enough recents to populate folder nesting in the sidebar. */
const SIDEBAR_FETCH_LIMIT = 50;

type ConversationDragSource = "history" | "folder";

/** Unique per sidebar row — same chat can appear in History and inside a folder. */
const conversationDragId = (
  source: ConversationDragSource,
  conversationId: string,
) => `${source}:conversation:${conversationId}`;

const folderDropId = (folderId: string) => `folder:${folderId}`;

type ConversationDragData = {
  type: "conversation";
  conversationId: string;
  currentFolderId: string | null;
  title: string;
};

type FolderDropData = {
  type: "folder";
  folderId: string;
};

export interface UnifiedChatSidebarSectionsProps {
  tenantId?: string;
  isDarkMode?: boolean;
  isExpanded?: boolean;
  className?: string;
  /** When false, omit data-tour anchors (e.g. mobile slide-down menu). */
  includeTourAnchors?: boolean;
}

type FolderRow = ReturnType<typeof useUnifiedChatHistory>["folders"][number];
type ConversationRow =
  ReturnType<typeof useUnifiedChatHistory>["conversations"][number];

type FolderDialogMode =
  | { kind: "create"; parentId?: string | null }
  | { kind: "rename"; folderId: string; initialName: string };

function ConversationDragPreview({ title }: { title: string }) {
  return (
    <div className="flex min-w-[180px] max-w-[240px] items-center rounded-md border border-slate-200 bg-white px-2 py-2 text-sm font-medium text-slate-800 shadow-lg dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <span className="truncate">{title}</span>
    </div>
  );
}

function ConversationMetaSubtitle({
  conversation,
  folders,
}: {
  conversation: ConversationRow;
  folders: FolderRow[];
}) {
  const chatType = conversation.chat_type as UnifiedChatType;
  const folderName = conversation.folder_id
    ? (getFolderNameById(conversation.folder_id, folders) ?? "Folder")
    : null;

  return (
    <span className="flex flex-wrap items-center gap-1 pl-2 mt-px">
      <HistoryMetaPill className={getChatTypePillClassName(chatType)}>
        {formatChatTypeLabel(chatType)}
      </HistoryMetaPill>
      {folderName && (
        <HistoryMetaPill className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          {folderName}
        </HistoryMetaPill>
      )}
      {conversation.is_shared_view &&
        (conversation.shared_by_name || conversation.shared_by_email) && (
        <HistoryMetaPill className="bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          Shared by{" "}
          {conversation.shared_by_name ||
            formatUserDisplayName(null, conversation.shared_by_email)}
        </HistoryMetaPill>
      )}
      {conversation.parent_conversation_id ? (
        <HistoryMetaPill className="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
          Continued from prior
        </HistoryMetaPill>
      ) : null}
      {conversation.forked_to_conversation_id ? (
        <HistoryMetaPill className="bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          Continued in new chat
        </HistoryMetaPill>
      ) : null}
    </span>
  );
}

function ConversationRow({
  conversation,
  dragSource,
  folders,
  resumeConversation,
  moveConversationToFolder,
  onItemActivate,
  style,
  showMetaSubtitle = false,
}: {
  conversation: ConversationRow;
  dragSource: ConversationDragSource;
  folders: FolderRow[];
  resumeConversation: (
    id: string,
    chatType: string,
    conversation?: ConversationRow,
  ) => void | Promise<void>;
  moveConversationToFolder: (
    conversationId: string,
    folderId: string | null,
  ) => Promise<void>;
  onItemActivate?: () => void;
  style?: CSSProperties;
  showMetaSubtitle?: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: conversationDragId(dragSource, conversation.id),
    data: {
      type: "conversation",
      conversationId: conversation.id,
      currentFolderId: conversation.folder_id ?? null,
      title: conversation.title,
    } satisfies ConversationDragData,
  });

  const dragStyle: CSSProperties = {
    ...style,
    opacity: isDragging ? 0 : undefined,
  };

  return (
    <div ref={setNodeRef} className="flex items-center gap-0.5 group" style={dragStyle}>
      <button
        type="button"
        className={cn(
          "flex-1 min-w-0 text-left rounded-md text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60",
          showMetaSubtitle
            ? "px-2 pt-1.5 pb-1"
            : "px-2 py-2 min-h-[36px] text-sm truncate",
          "cursor-grab active:cursor-grabbing",
        )}
        onClick={() => {
          void resumeConversation(
            conversation.id,
            conversation.chat_type,
            conversation,
          );
          onItemActivate?.();
        }}
        {...listeners}
        {...attributes}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="block text-sm truncate flex-1 min-w-0">{conversation.title}</span>
          <ConversationRunningIndicator conversationId={conversation.id} />
        </span>
        {showMetaSubtitle ? (
          <ConversationMetaSubtitle
            conversation={conversation}
            folders={folders}
          />
        ) : null}
      </button>
      <ConversationMoveMenu
        conversationId={conversation.id}
        currentFolderId={conversation.folder_id}
        folders={folders}
        onMove={moveConversationToFolder}
        triggerClassName="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
      />
    </div>
  );
}

function SharedWithMeFolderNode({
  sharedConversations,
  expandedFolderIds,
  toggleFolderExpanded,
  folders,
  resumeConversation,
  moveConversationToFolder,
  onItemActivate,
}: {
  sharedConversations: ConversationRow[];
  expandedFolderIds: Set<string>;
  toggleFolderExpanded: (folderId: string) => void;
  folders: FolderRow[];
  resumeConversation: (
    id: string,
    chatType: string,
    conversation?: ConversationRow,
  ) => void | Promise<void>;
  moveConversationToFolder: (
    conversationId: string,
    folderId: string | null,
  ) => Promise<void>;
  onItemActivate?: () => void;
}) {
  const isExpanded = expandedFolderIds.has(SHARED_WITH_ME_FOLDER_ID);
  const hasContent = sharedConversations.length > 0;

  return (
    <div>
      <div className="flex items-center gap-0.5 group rounded-md transition-colors">
        <button
          type="button"
          className={cn(
            "flex-1 min-w-0 text-left text-sm truncate rounded-md px-2 py-2 min-h-[36px] flex items-center gap-1",
            isExpanded
              ? "bg-amber-50/80 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60",
          )}
          onClick={() => toggleFolderExpanded(SHARED_WITH_ME_FOLDER_ID)}
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-amber-500 transition-transform",
              isExpanded && "rotate-90",
              !hasContent && "opacity-40",
            )}
          />
          <Users className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="truncate font-medium">Shared With Me</span>
          {hasContent && (
            <span className="text-[10px] text-amber-700/80 dark:text-amber-300/80 tabular-nums shrink-0">
              ({sharedConversations.length})
            </span>
          )}
        </button>
      </div>
      {isExpanded && (
        <div>
          {hasContent ? (
            sharedConversations.map((conversation) => (
              <ConversationRow
                key={`shared:${conversation.id}`}
                conversation={conversation}
                dragSource="folder"
                folders={folders}
                resumeConversation={resumeConversation}
                moveConversationToFolder={moveConversationToFolder}
                onItemActivate={onItemActivate}
                style={{ paddingLeft: "20px" }}
                showMetaSubtitle
              />
            ))
          ) : (
            <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400" style={{ paddingLeft: "20px" }}>
              No shared research yet.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function FolderTreeNode({
  folder,
  depth,
  foldersByParent,
  conversationsByFolder,
  expandedFolderIds,
  toggleFolderExpanded,
  deleteFolder,
  onOpenFolderDialog,
  moveFolder,
  folders,
  resumeConversation,
  moveConversationToFolder,
  onItemActivate,
}: {
  folder: FolderRow;
  depth: number;
  foldersByParent: Map<string | null, FolderRow[]>;
  conversationsByFolder: Map<string, ConversationRow[]>;
  expandedFolderIds: Set<string>;
  toggleFolderExpanded: (folderId: string) => void;
  deleteFolder: (id: string) => Promise<void>;
  onOpenFolderDialog: (mode: FolderDialogMode) => void;
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  folders: FolderRow[];
  resumeConversation: (
    id: string,
    chatType: string,
    conversation?: ConversationRow,
  ) => void | Promise<void>;
  moveConversationToFolder: (
    conversationId: string,
    folderId: string | null,
  ) => Promise<void>;
  onItemActivate?: () => void;
}) {
  const childFolders = foldersByParent.get(folder.id) ?? [];
  const conversationsInFolder = conversationsByFolder.get(folder.id) ?? [];
  const isExpanded = expandedFolderIds.has(folder.id);
  const hasNestedContent =
    childFolders.length > 0 || conversationsInFolder.length > 0;

  const { isOver, setNodeRef } = useDroppable({
    id: folderDropId(folder.id),
    data: { type: "folder", folderId: folder.id } satisfies FolderDropData,
  });

  return (
    <div>
      <div
        ref={setNodeRef}
        className={cn(
          "flex items-center gap-0.5 group rounded-md transition-colors",
          isOver &&
            "bg-blue-50 ring-2 ring-blue-400/70 dark:bg-blue-950/40 dark:ring-blue-500/60",
        )}
      >
        <button
          type="button"
          className={cn(
            "flex-1 min-w-0 text-left text-sm truncate rounded-md px-2 py-2 min-h-[36px] flex items-center gap-1",
            isExpanded
              ? "bg-slate-100 dark:bg-slate-800/40 text-slate-900 dark:text-slate-100"
              : "text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/60",
            isOver && "bg-transparent",
          )}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => toggleFolderExpanded(folder.id)}
        >
          {hasNestedContent ? (
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform",
                isExpanded && "rotate-90",
              )}
            />
          ) : (
            <span className="w-3.5 shrink-0" aria-hidden />
          )}
          <Folder className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="truncate">{folder.name}</span>
        </button>
        <FolderMoveMenu
          folder={folder}
          folders={folders}
          onMove={moveFolder}
          triggerClassName="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 shrink-0"
              aria-label={`Folder actions for ${folder.name}`}
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem
              onClick={() =>
                onOpenFolderDialog({
                  kind: "create",
                  parentId: folder.id,
                })
              }
            >
              <Plus className="h-3.5 w-3.5 mr-2" />
              New subfolder
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                onOpenFolderDialog({
                  kind: "rename",
                  folderId: folder.id,
                  initialName: folder.name,
                })
              }
            >
              <Pencil className="h-3.5 w-3.5 mr-2" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-red-600 focus:text-red-600"
              onClick={() => {
                if (
                  window.confirm(
                    `Delete folder "${folder.name}"? Chats move to the parent or unsorted.`,
                  )
                ) {
                  void deleteFolder(folder.id);
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {isExpanded && (
        <div>
          {childFolders.map((child) => (
            <FolderTreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              foldersByParent={foldersByParent}
              conversationsByFolder={conversationsByFolder}
              expandedFolderIds={expandedFolderIds}
              toggleFolderExpanded={toggleFolderExpanded}
              deleteFolder={deleteFolder}
              onOpenFolderDialog={onOpenFolderDialog}
              moveFolder={moveFolder}
              folders={folders}
              resumeConversation={resumeConversation}
              moveConversationToFolder={moveConversationToFolder}
              onItemActivate={onItemActivate}
            />
          ))}
          {conversationsInFolder.map((conversation) => (
            <ConversationRow
              key={conversation.id}
              conversation={conversation}
              dragSource="folder"
              folders={folders}
              resumeConversation={resumeConversation}
              moveConversationToFolder={moveConversationToFolder}
              onItemActivate={onItemActivate}
              style={{ paddingLeft: `${20 + depth * 12}px` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderNameDialog({
  mode,
  open,
  onOpenChange,
  onSubmit,
}: {
  mode: FolderDialogMode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !mode) return;
    setName(mode.kind === "rename" ? mode.initialName : "");
  }, [open, mode]);

  const handleSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode?.kind === "rename"
              ? "Rename folder"
              : mode?.parentId
                ? "New subfolder"
                : "New folder"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="folder-name">Folder name</Label>
          <Input
            id="folder-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Q2 research"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleSubmit();
            }}
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={saving || !name.trim()}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {mode?.kind === "rename" ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderListBody({
  folders,
  conversations,
  sharedConversations,
  expandedFolderIds,
  toggleFolderExpanded,
  deleteFolder,
  onOpenFolderDialog,
  moveFolder,
  resumeConversation,
  moveConversationToFolder,
  onItemActivate,
}: {
  folders: FolderRow[];
  conversations: ConversationRow[];
  sharedConversations: ConversationRow[];
  expandedFolderIds: Set<string>;
  toggleFolderExpanded: (folderId: string) => void;
  deleteFolder: (id: string) => Promise<void>;
  onOpenFolderDialog: (mode: FolderDialogMode) => void;
  moveFolder: (folderId: string, parentId: string | null) => Promise<void>;
  resumeConversation: (
    id: string,
    chatType: string,
    conversation?: ConversationRow,
  ) => void | Promise<void>;
  moveConversationToFolder: (
    conversationId: string,
    folderId: string | null,
  ) => Promise<void>;
  onItemActivate?: () => void;
}) {
  const foldersByParent = groupFoldersByParent(folders);
  const conversationsByFolder = groupConversationsByFolder(conversations);
  const rootFolders = foldersByParent.get(null) ?? [];

  return (
    <div className="space-y-0.5 px-1 pb-1">
      <SharedWithMeFolderNode
        sharedConversations={sharedConversations}
        expandedFolderIds={expandedFolderIds}
        toggleFolderExpanded={toggleFolderExpanded}
        folders={folders}
        resumeConversation={resumeConversation}
        moveConversationToFolder={moveConversationToFolder}
        onItemActivate={onItemActivate}
      />
      {rootFolders.map((folder) => (
        <FolderTreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          foldersByParent={foldersByParent}
          conversationsByFolder={conversationsByFolder}
          expandedFolderIds={expandedFolderIds}
          toggleFolderExpanded={toggleFolderExpanded}
          deleteFolder={deleteFolder}
          onOpenFolderDialog={onOpenFolderDialog}
          moveFolder={moveFolder}
          folders={folders}
          resumeConversation={resumeConversation}
          moveConversationToFolder={moveConversationToFolder}
          onItemActivate={onItemActivate}
        />
      ))}
      {folders.length === 0 && sharedConversations.length === 0 && (
        <p className="px-2 py-2 text-xs text-slate-500 dark:text-slate-400">
          No folders yet.
        </p>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 w-full justify-start gap-1.5 text-xs mt-1"
        onClick={() => onOpenFolderDialog({ kind: "create" })}
      >
        <Plus className="h-3.5 w-3.5" />
        New folder
      </Button>
    </div>
  );
}

function HistoryListBody({
  conversations,
  folders,
  resumeConversation,
  moveConversationToFolder,
  onItemActivate,
}: {
  conversations: ConversationRow[];
  folders: FolderRow[];
  resumeConversation: (
    id: string,
    chatType: string,
    conversation?: ConversationRow,
  ) => void | Promise<void>;
  moveConversationToFolder: (
    conversationId: string,
    folderId: string | null,
  ) => Promise<void>;
  onItemActivate?: () => void;
}) {
  if (conversations.length === 0) {
    return (
      <p className="px-2 py-3 text-xs text-slate-500 dark:text-slate-400">
        No recent chats yet.
      </p>
    );
  }

  return (
    <div className="space-y-0 px-1 pb-1">
      {conversations.map((conversation) => (
        <ConversationRow
          key={conversation.id}
          conversation={conversation}
          dragSource="history"
          folders={folders}
          resumeConversation={resumeConversation}
          moveConversationToFolder={moveConversationToFolder}
          onItemActivate={onItemActivate}
          showMetaSubtitle
        />
      ))}
    </div>
  );
}

export function UnifiedChatSidebarSections({
  tenantId,
  isDarkMode = false,
  isExpanded = true,
  className,
  includeTourAnchors = true,
}: UnifiedChatSidebarSectionsProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isHistoryPage = location.pathname.startsWith("/chat/history");
  const {
    enabled,
    conversations,
    sharedConversations,
    folders,
    createFolder,
    renameFolder,
    deleteFolder,
    moveFolder,
    moveConversationToFolder,
  } = useUnifiedChatHistory(tenantId, { recentLimit: SIDEBAR_FETCH_LIMIT });
  const { toast } = useToast();
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set([SHARED_WITH_ME_FOLDER_ID]),
  );

  useEffect(() => {
    if (sharedConversations.length > 0) {
      setExpandedFolderIds((prev) => new Set(prev).add(SHARED_WITH_ME_FOLDER_ID));
    }
  }, [sharedConversations.length]);
  const [foldersExpanded, setFoldersExpanded] = useState(true);
  const [historyExpanded, setHistoryExpanded] = useState(true);

  const [folderDialogMode, setFolderDialogMode] =
    useState<FolderDialogMode | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [activeConversationDrag, setActiveConversationDrag] =
    useState<ConversationDragData | null>(null);

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const handleConversationDragOver = (event: DragOverEvent) => {
    const data = event.over?.data.current;
    if (data?.type !== "folder") return;
    const folderId = data.folderId as string;
    setExpandedFolderIds((prev) => {
      if (prev.has(folderId)) return prev;
      return new Set(prev).add(folderId);
    });
  };

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  };

  const openFolderDialog = (mode: FolderDialogMode) => {
    setFolderDialogMode(mode);
    setFolderDialogOpen(true);
  };

  const handleFolderDialogSubmit = async (name: string) => {
    try {
      if (folderDialogMode?.kind === "rename") {
        await renameFolder(folderDialogMode.folderId, name);
        toast({ title: "Folder renamed" });
      } else {
        const folder = await createFolder(name, folderDialogMode?.parentId);
        if (folder?.id) {
          setExpandedFolderIds((prev) => new Set(prev).add(folder.id));
        }
        toast({ title: "Folder created" });
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title:
          folderDialogMode?.kind === "rename"
            ? "Could not rename folder"
            : "Could not create folder",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
      });
      throw err;
    }
  };

  if (!enabled || !isUnifiedChatClientEnabled()) return null;

  const sharedLegacyRefs = useMemo(
    () =>
      new Set(
        sharedConversations
          .map((c) => c.legacy_ref)
          .filter((ref): ref is string => Boolean(ref)),
      ),
    [sharedConversations],
  );
  const sharedConversationIds = useMemo(
    () => new Set(sharedConversations.map((c) => c.id)),
    [sharedConversations],
  );
  const recentConversations = [...conversations]
    .filter(
      (c) =>
        !c.is_shared_view &&
        !sharedConversationIds.has(c.id) &&
        !(c.legacy_ref && sharedLegacyRefs.has(c.legacy_ref)),
    )
    .sort(
      (a, b) =>
        new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    )
    .slice(0, SIDEBAR_HISTORY_LIMIT);

  const resumeConversation = async (
    id: string,
    chatType: string,
    conversation?: ConversationRow,
  ) => {
    let resumeId = id;
    if (
      conversation?.is_shared_view &&
      conversation.legacy_ref &&
      conversation.legacy_ref !== id
    ) {
      try {
        const client = createUnifiedChatClient(tenantId);
        const opened = await client.openSharedResearch(conversation.legacy_ref);
        resumeId = opened.id;
      } catch {
        resumeId = conversation.legacy_ref;
      }
    } else if (conversation?.is_shared_view && conversation.legacy_ref) {
      resumeId = conversation.legacy_ref;
    }

    if (chatType === "workbench") {
      const scopeType = conversation?.scope?.type;
      const scopeId = conversation?.scope?.id;
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
        const row = await client.getConversation(resumeId);
        const rowScopeType = row.scope?.type;
        const rowScopeId = row.scope?.id;
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
        /* fall through to chat home resume */
      }
    }

    navigate(buildUnifiedChatResumePath(resumeId, chatType), {
      state: cohiChatResumeNavigationState(),
    });
  };

  const handleMoveConversationToFolder = async (
    conversationId: string,
    folderId: string | null,
  ) => {
    if (isSharedWithMeFolderId(folderId)) {
      return;
    }
    await moveConversationToFolder(conversationId, folderId);
    if (folderId) {
      setExpandedFolderIds((prev) => new Set(prev).add(folderId));
    }
  };

  const handleConversationDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as ConversationDragData | undefined;
    if (data?.type === "conversation") {
      setActiveConversationDrag(data);
    }
  };

  const handleConversationDragEnd = async (event: DragEndEvent) => {
    setActiveConversationDrag(null);

    const { active, over } = event;
    if (!over) return;

    const activeData = active.data.current as ConversationDragData | undefined;
    const overData = over.data.current as FolderDropData | undefined;
    if (activeData?.type !== "conversation" || overData?.type !== "folder") {
      return;
    }

    const { conversationId, currentFolderId } = activeData;
    const { folderId } = overData;
    if (isSharedWithMeFolderId(folderId)) {
      return;
    }
    const folderName = folders.find((f) => f.id === folderId)?.name;

    if (currentFolderId === folderId) {
      toast({
        title: folderName
          ? `Chat is already in ${folderName}`
          : "Chat is already in this folder",
      });
      return;
    }

    try {
      await handleMoveConversationToFolder(conversationId, folderId);
      toast({
        title: "Moved to folder",
        description: folderName,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not move chat",
        description:
          err instanceof Error ? err.message : "Something went wrong.",
      });
    }
  };

  const handleMoveFolder = async (folderId: string, parentId: string | null) => {
    await moveFolder(folderId, parentId);
    if (parentId) {
      setExpandedFolderIds((prev) => new Set(prev).add(parentId));
    }
    toast({ title: "Folder moved" });
  };

  const handleDeleteFolder = async (folderId: string) => {
    await deleteFolder(folderId);
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      next.delete(folderId);
      return next;
    });
  };

  const folderListProps = {
    folders,
    conversations,
    sharedConversations,
    expandedFolderIds,
    toggleFolderExpanded,
    deleteFolder: handleDeleteFolder,
    onOpenFolderDialog: openFolderDialog,
    moveFolder: handleMoveFolder,
    resumeConversation,
    moveConversationToFolder: handleMoveConversationToFolder,
  };

  const historyListProps = {
    conversations: recentConversations,
    folders,
    resumeConversation,
    moveConversationToFolder: handleMoveConversationToFolder,
  };

  return (
    <DndContext
      sensors={dndSensors}
      onDragStart={handleConversationDragStart}
      onDragOver={handleConversationDragOver}
      onDragEnd={(e) => void handleConversationDragEnd(e)}
      onDragCancel={() => setActiveConversationDrag(null)}
    >
      <div className={cn(isExpanded ? "" : "space-y-0", className)}>
      <FolderNameDialog
        mode={folderDialogMode}
        open={folderDialogOpen}
        onOpenChange={setFolderDialogOpen}
        onSubmit={handleFolderDialogSubmit}
      />
      <SidebarExpandableSection
        isDarkMode={isDarkMode}
        isExpanded={isExpanded}
        sectionExpanded={foldersExpanded}
        onToggleSection={() => setFoldersExpanded((v) => !v)}
        icon={Folder}
        label="Folders"
        dataTour={includeTourAnchors ? "sidebar-folders" : undefined}
        accent="purple"
        flyoutWidth="w-56"
        flyoutChildren={
          <FolderListBody {...folderListProps} />
        }
      >
        <FolderListBody {...folderListProps} />
      </SidebarExpandableSection>

      <SidebarExpandableSection
        isDarkMode={isDarkMode}
        isExpanded={isExpanded}
        sectionExpanded={historyExpanded}
        onToggleSection={() => setHistoryExpanded((v) => !v)}
        onCollapsedClick={() => navigate("/chat/history")}
        icon={Clock}
        label="History"
        dataTour={includeTourAnchors ? "sidebar-history" : undefined}
        accent="blue"
        active={isHistoryPage}
        flyoutWidth="w-64"
        flyoutChildren={
          <HistoryListBody {...historyListProps} />
        }
      >
        <HistoryListBody {...historyListProps} />
      </SidebarExpandableSection>

      {isExpanded ? (
        <div className="px-1 pt-1 pb-2 space-y-2">
          <SidebarTourAnchor
            tourAnchorId={
              includeTourAnchors ? cohiTourAnchorId("fullHistory") : undefined
            }
          >
            <Button
              variant="outline"
              className="w-full justify-center gap-2 h-9 text-sm font-medium"
              asChild
            >
              <Link to="/chat/history">
                <History className="h-4 w-4" />
                Full History
              </Link>
            </Button>
          </SidebarTourAnchor>
          <SidebarTourAnchor
            tourAnchorId={
              includeTourAnchors ? cohiTourAnchorId("dataExplorer") : undefined
            }
          >
            <Button
              variant="outline"
              className="w-full justify-center gap-2 h-9 text-sm font-medium"
              asChild
            >
              <Link to="/research/data-explorer">
                <Table2 className="h-4 w-4" />
                Data Explorer
              </Link>
            </Button>
          </SidebarTourAnchor>
        </div>
      ) : (
        <SidebarTourAnchor
          tourAnchorId={
            includeTourAnchors ? cohiTourAnchorId("fullHistory") : undefined
          }
          className="flex justify-center py-2"
        >
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0"
            asChild
          >
            <Link
              to="/chat/history"
              aria-label="Full History"
              title="Full History"
            >
              <History className="h-4 w-4" />
            </Link>
          </Button>
        </SidebarTourAnchor>
      )}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeConversationDrag ? (
          <ConversationDragPreview title={activeConversationDrag.title} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
