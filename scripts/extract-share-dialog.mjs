import fs from "fs";

const canvasPath =
  "c:/Users/MPetrovic/Documents/Cohi/cohi/src/components/workbench/WorkbenchCanvas.tsx";
const outPath =
  "c:/Users/MPetrovic/Documents/Cohi/cohi/src/components/workbench/canvas/WorkbenchShareDialog.tsx";

const src = fs.readFileSync(canvasPath, "utf8").split(/\r?\n/);
let body = src.slice(4411, 4828).join("\n");

body = body
  .replaceAll("shareDialogOpen", "open")
  .replaceAll("setShareDialogOpen", "onOpenChange")
  .replaceAll("user?.role", "userRole")
  .replaceAll("handleCopyShareLink", "onCopyShareLink")
  .replaceAll("handleEmailLink", "onEmailLink")
  .replaceAll("handleToggleFavorite", "onToggleFavorite")
  .replace(
    /onClick=\{\(\) => \{\s*setShowReportBuilder\(true\);\s*onOpenChange\(false\);\s*\}\}/g,
    "onClick={onOpenReportBuilder}",
  )
  .replace(
    /onClick=\{\(\) => \{\s*handleEmailScreenshot\(\);\s*onOpenChange\(false\);\s*\}\}/g,
    "onClick={onEmailScreenshot}",
  );

const header = `import {
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
`;

fs.writeFileSync(outPath, `${header}\n${body}\n}\n`);
console.log("wrote", outPath);
