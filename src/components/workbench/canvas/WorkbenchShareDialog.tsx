import {
  Check,
  ChevronDown,
  Globe,
  Link as LinkIcon,
  Lock,
  Mail,
  Presentation,
  Share2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type CanvasShareEntry = {
  userId?: string;
  groupId?: string;
  permission: "viewer" | "editor";
};

export type TenantUserRow = {
  id: string;
  email: string;
  full_name?: string | null;
};

export type TenantGroupRow = { id: string; name: string };

export type WorkbenchShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canvasVisibility: "private" | "shared" | "global";
  setCanvasVisibility: (v: "private" | "shared" | "global") => void;
  userRole?: string;
  tenantUsers: TenantUserRow[];
  tenantUsersLoaded: boolean;
  tenantGroups: TenantGroupRow[];
  tenantGroupsLoaded: boolean;
  canvasShares: CanvasShareEntry[];
  toggleSharedUser: (userId: string) => void;
  toggleSharedGroup: (groupId: string) => void;
  setSharePermission: (
    id: string,
    kind: "user" | "group",
    permission: "viewer" | "editor",
  ) => void;
  canTransferOwnership: boolean;
  transferOwnershipUserId: string;
  setTransferOwnershipUserId: (id: string) => void;
  transferOwnershipSaving: boolean;
  handleTransferOwnership: () => void;
  handleSaveVisibility: () => void;
  visibilitySaving: boolean;
  hasItems: boolean;
  onOpenReportBuilder: () => void;
  onEmailScreenshot: () => void;
  onCopyShareLink: () => void;
  onEmailLink: () => void;
  shareFavorited: boolean;
  onToggleFavorite: () => void;
  favoriteLoading: boolean;
};

export function WorkbenchShareDialog(props: WorkbenchShareDialogProps) {
  const {
    open,
    onOpenChange,
    canvasVisibility,
    setCanvasVisibility,
    userRole,
    tenantUsers,
    tenantUsersLoaded,
    tenantGroups,
    tenantGroupsLoaded,
    canvasShares,
    toggleSharedUser,
    toggleSharedGroup,
    setSharePermission,
    canTransferOwnership,
    transferOwnershipUserId,
    setTransferOwnershipUserId,
    transferOwnershipSaving,
    handleTransferOwnership,
    handleSaveVisibility,
    visibilitySaving,
    hasItems,
    onOpenReportBuilder,
    onEmailScreenshot,
    onCopyShareLink,
    onEmailLink,
    shareFavorited,
    onToggleFavorite,
    favoriteLoading,
  } = props;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Share2 className="h-5 w-5 text-slate-500" />
                Share canvas
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {/* Visibility selector */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Visibility
                </label>
                <div className="space-y-1.5">
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      canvasVisibility === "private"
                        ? "border-violet-300 bg-violet-50 dark:border-violet-600 dark:bg-violet-900/30"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800",
                    )}
                    onClick={() => setCanvasVisibility("private")}
                  >
                    <Lock className="h-4 w-4 text-slate-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-700 dark:text-slate-200">
                        Private
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Only you can view and edit
                      </div>
                    </div>
                    {canvasVisibility === "private" && (
                      <Check className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                    )}
                  </button>
                  <button
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                      canvasVisibility === "shared"
                        ? "border-violet-300 bg-violet-50 dark:border-violet-600 dark:bg-violet-900/30"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800",
                    )}
                    onClick={() => setCanvasVisibility("shared")}
                  >
                    <Users className="h-4 w-4 text-slate-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-slate-700 dark:text-slate-200">
                        Specific people
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Share with selected users (read-only)
                      </div>
                    </div>
                    {canvasVisibility === "shared" && (
                      <Check className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                    )}
                  </button>
                  {/* Global option — only for admins */}
                  {(
                    ["super_admin", "platform_admin", "tenant_admin"] as const
                  ).includes(userRole as any) && (
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                        canvasVisibility === "global"
                          ? "border-violet-300 bg-violet-50 dark:border-violet-600 dark:bg-violet-900/30"
                          : "border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800",
                      )}
                      onClick={() => setCanvasVisibility("global")}
                    >
                      <Globe className="h-4 w-4 text-slate-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-700 dark:text-slate-200">
                          Global (entire tenant)
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          All users in this organization can view
                        </div>
                      </div>
                      {canvasVisibility === "global" && (
                        <Check className="h-4 w-4 text-violet-600 dark:text-violet-400 shrink-0" />
                      )}
                    </button>
                  )}
                </div>
              </div>

              {/* Users + Groups with permission — shown when visibility is 'shared' */}
              {canvasVisibility === "shared" && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Users
                    </label>
                    {tenantUsers.length > 0 ? (
                      <div className="max-h-[180px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                        {tenantUsers.map((u) => {
                          const shareEntry = canvasShares.find(
                            (s) => s.userId === u.id,
                          );
                          const selected = !!shareEntry;
                          return (
                            <div
                              key={u.id}
                              className={cn(
                                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                                selected
                                  ? "bg-violet-50 dark:bg-violet-900/20"
                                  : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                              )}
                            >
                              <button
                                type="button"
                                className="flex items-center gap-2.5 flex-1 min-w-0"
                                onClick={() => toggleSharedUser(u.id)}
                              >
                                <div
                                  className={cn(
                                    "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                                    selected
                                      ? "bg-violet-600 border-violet-600 text-white"
                                      : "border-slate-300 dark:border-slate-600",
                                  )}
                                >
                                  {selected && <Check className="h-3 w-3" />}
                                </div>
                                <div className="flex-1 min-w-0 truncate">
                                  <span className="text-slate-700 dark:text-slate-200">
                                    {u.full_name || u.email}
                                  </span>
                                  {u.full_name && (
                                    <span className="ml-1.5 text-xs text-slate-400">
                                      {u.email}
                                    </span>
                                  )}
                                </div>
                              </button>
                              {selected && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 gap-1 text-xs shrink-0"
                                    >
                                      {shareEntry.permission === "editor"
                                        ? "Editor"
                                        : "Viewer"}
                                      <ChevronDown className="h-3 w-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setSharePermission(
                                          u.id,
                                          "user",
                                          "viewer",
                                        )
                                      }
                                    >
                                      Viewer
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setSharePermission(
                                          u.id,
                                          "user",
                                          "editor",
                                        )
                                      }
                                    >
                                      Editor
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                        {tenantUsersLoaded
                          ? "No users found in this tenant."
                          : "Loading users..."}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Groups
                    </label>
                    {tenantGroupsLoaded && tenantGroups.length > 0 ? (
                      <div className="max-h-[180px] overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                        {tenantGroups.map((g) => {
                          const shareEntry = canvasShares.find(
                            (s) => s.groupId === g.id,
                          );
                          const selected = !!shareEntry;
                          return (
                            <div
                              key={g.id}
                              className={cn(
                                "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                                selected
                                  ? "bg-violet-50 dark:bg-violet-900/20"
                                  : "hover:bg-slate-50 dark:hover:bg-slate-800/50",
                              )}
                            >
                              <button
                                type="button"
                                className="flex items-center gap-2.5 flex-1 min-w-0"
                                onClick={() => toggleSharedGroup(g.id)}
                              >
                                <div
                                  className={cn(
                                    "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                                    selected
                                      ? "bg-violet-600 border-violet-600 text-white"
                                      : "border-slate-300 dark:border-slate-600",
                                  )}
                                >
                                  {selected && <Check className="h-3 w-3" />}
                                </div>
                                <span className="text-slate-700 dark:text-slate-200 truncate">
                                  {g.name}
                                </span>
                              </button>
                              {selected && (
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 gap-1 text-xs shrink-0"
                                    >
                                      {shareEntry.permission === "editor"
                                        ? "Editor"
                                        : "Viewer"}
                                      <ChevronDown className="h-3 w-3" />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setSharePermission(
                                          g.id,
                                          "group",
                                          "viewer",
                                        )
                                      }
                                    >
                                      Viewer
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() =>
                                        setSharePermission(
                                          g.id,
                                          "group",
                                          "editor",
                                        )
                                      }
                                    >
                                      Editor
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 dark:text-slate-400 py-2">
                        {tenantGroupsLoaded
                          ? "No groups. Admins can create groups in Admin → Groups."
                          : "Loading groups..."}
                      </p>
                    )}
                  </div>
                  {canvasShares.length > 0 && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {canvasShares.length} share
                      {canvasShares.length !== 1 ? "s" : ""} (Viewer =
                      read-only, Editor = can edit)
                    </p>
                  )}
                </div>
              )}

              {canTransferOwnership && (
                <div className="rounded-lg border border-amber-200/80 dark:border-amber-800/50 bg-amber-50/40 dark:bg-amber-950/20 p-3 space-y-2">
                  <label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    Transfer ownership
                  </label>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Make another user the canvas owner. You keep edit access as
                    an editor. Use this when a client should own a canvas you
                    created (e.g. after moving off a platform admin account).
                  </p>
                  <Select
                    value={transferOwnershipUserId || "__none__"}
                    onValueChange={(v) =>
                      setTransferOwnershipUserId(v === "__none__" ? "" : v)
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose new owner" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Choose user…</SelectItem>
                      {tenantUsers.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.full_name
                            ? `${u.full_name} (${u.email})`
                            : u.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full border-amber-300/80"
                    disabled={
                      !transferOwnershipUserId ||
                      transferOwnershipSaving ||
                      !tenantUsersLoaded
                    }
                    onClick={handleTransferOwnership}
                  >
                    {transferOwnershipSaving
                      ? "Transferring…"
                      : "Transfer ownership"}
                  </Button>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-1">
                <Button
                  onClick={handleSaveVisibility}
                  disabled={visibilitySaving}
                  className="w-full"
                >
                  {visibilitySaving ? "Saving..." : "Save sharing settings"}
                </Button>
              </div>
              <div className="h-px bg-slate-200 dark:bg-slate-700" />
              <div className="space-y-2">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 px-0.5">
                  Export canvas
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    onClick={onOpenReportBuilder}
                    disabled={!hasItems}
                    className="w-full gap-2"
                  >
                    <Presentation className="h-4 w-4" />
                    PowerPoint Editor
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onEmailScreenshot}
                    className="w-full gap-2"
                  >
                    <Mail className="h-4 w-4" />
                    Copy image for email
                  </Button>
                </div>
              </div>
              <div className="h-px bg-slate-200 dark:bg-slate-700" />
              <div className="flex flex-col gap-2">
                <Button
                  variant="outline"
                  onClick={onCopyShareLink}
                  className="w-full gap-2"
                >
                  <LinkIcon className="h-4 w-4" />
                  Copy link
                </Button>
                <Button
                  variant="outline"
                  onClick={onEmailLink}
                  className="w-full gap-2"
                >
                  <Mail className="h-4 w-4" />
                  Email link
                </Button>
                <Button
                  variant={shareFavorited ? "secondary" : "outline"}
                  onClick={onToggleFavorite}
                  className="w-full"
                  disabled={favoriteLoading}
                >
                  {shareFavorited
                    ? "Remove from bookmarks"
                    : "Add to bookmarks"}
                </Button>
              </div>
            </div>
          </DialogContent>
    </Dialog>
  );
}
