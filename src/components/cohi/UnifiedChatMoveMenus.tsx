import { FolderInput } from "lucide-react";
import type { UnifiedChatFolder } from "@/lib/unifiedChatClient";
import {
  formatFolderOptionLabel,
  getConversationMoveTargets,
  getFolderMoveTargets,
} from "@/lib/unifiedChatFolderUtils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ConversationMoveMenu({
  conversationId,
  currentFolderId,
  folders,
  onMove,
  triggerClassName,
}: {
  conversationId: string;
  currentFolderId: string | null | undefined;
  folders: UnifiedChatFolder[];
  onMove: (conversationId: string, folderId: string | null) => void | Promise<void>;
  triggerClassName?: string;
}) {
  const targets = getConversationMoveTargets(folders, currentFolderId);
  const inFolder = Boolean(currentFolderId);
  if (!inFolder && targets.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName ?? "h-7 w-7 shrink-0"}
          aria-label="Move to folder"
          onClick={(e) => e.stopPropagation()}
        >
          <FolderInput className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        {inFolder && (
          <>
            <DropdownMenuItem
              onClick={() => {
                void onMove(conversationId, null);
              }}
            >
              Remove from folder
            </DropdownMenuItem>
            {targets.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {targets.map((folder) => (
          <DropdownMenuItem
            key={folder.id}
            onClick={() => {
              void onMove(conversationId, folder.id);
            }}
          >
            {formatFolderOptionLabel(folder, folders)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FolderMoveMenu({
  folder,
  folders,
  onMove,
  triggerClassName,
}: {
  folder: UnifiedChatFolder;
  folders: UnifiedChatFolder[];
  onMove: (folderId: string, parentId: string | null) => void | Promise<void>;
  triggerClassName?: string;
}) {
  const targets = getFolderMoveTargets(folders, folder.id);
  const canMoveToRoot = folder.parent_id != null;
  if (!canMoveToRoot && targets.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName ?? "h-7 w-7 shrink-0"}
          aria-label={`Move folder ${folder.name}`}
          onClick={(e) => e.stopPropagation()}
        >
          <FolderInput className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52" onClick={(e) => e.stopPropagation()}>
        {canMoveToRoot && (
          <>
            <DropdownMenuItem
              onClick={() => {
                void onMove(folder.id, null);
              }}
            >
              Move to root
            </DropdownMenuItem>
            {targets.length > 0 && <DropdownMenuSeparator />}
          </>
        )}
        {targets.map((target) => (
          <DropdownMenuItem
            key={target.id}
            onClick={() => {
              void onMove(folder.id, target.id);
            }}
          >
            {formatFolderOptionLabel(target, folders)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
