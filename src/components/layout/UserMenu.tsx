import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import {
  Banknote,
  Brain,
  ChevronDown,
  FolderKanban,
  Gauge,
  Home,
  LayoutDashboard,
  Laptop,
  LineChart,
  LogOut,
  Moon,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sun,
  Wand2,
  BarChart3,
  Users,
  Target,
  TrendingUp,
  ClipboardList,
} from "lucide-react";

type UserMenuProps = {
  isAuthenticated: boolean;
  isAdminPage: boolean;
  currentUser: any | null;
  displayName: string | null;
  currentPath?: string;
  onNavigate: (to: string) => void;
  onLogout: () => void | Promise<void>;
  isAdmin?: boolean;
};

function initialsFromName(name: string | null | undefined) {
  const cleaned = String(name ?? "").trim();
  if (!cleaned) return "U";
  const parts = cleaned.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  const initials = (first + last).toUpperCase();
  return initials || "U";
}

function deriveRoleLabel(user: any | null, isAdminPage: boolean) {
  const raw =
    user?.role ??
    user?.user_role ??
    user?.userRole ??
    user?.roles?.[0] ??
    user?.permissions?.role ??
    undefined;

  const normalized = String(raw ?? "").trim();
  if (normalized) {
    return normalized
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  if (isAdminPage) return "Admin";
  return "User";
}

function deriveAvatarUrl(user: any | null) {
  return (
    user?.avatar_url ??
    user?.avatarUrl ??
    user?.image_url ??
    user?.imageUrl ??
    user?.picture ??
    user?.profile_image ??
    user?.profileImage ??
    undefined
  );
}

export function UserMenu({
  isAuthenticated,
  isAdminPage,
  currentUser,
  displayName,
  currentPath = "",
  onNavigate,
  onLogout,
  isAdmin = false,
}: UserMenuProps) {
  const { theme, setTheme } = useTheme();

  const roleLabel = deriveRoleLabel(currentUser, isAdminPage);
  const email = String(currentUser?.email ?? "").trim();
  const avatarUrl = deriveAvatarUrl(currentUser);
  const userLabel = displayName || (email ? email.split("@")[0] : "User");

  const showAdminLink = isAdmin;

  // Helper to check if a path is active
  const isActive = (path: string) => {
    if (path === "/") return currentPath === "/";
    return currentPath.startsWith(path);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="user-menu-trigger"
          variant="ghost"
          className={cn(
            "h-10 px-2.5 rounded-xl flex items-center gap-2.5",
            "hover:bg-slate-100/70 dark:hover:bg-slate-800/60",
            "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "shadow-sm",
          )}
        >
          <div className="flex items-center gap-2.5 select-none">
            <Avatar className="h-8 w-8 ring-1 ring-slate-200/70 dark:ring-slate-800/80 shadow-sm">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={userLabel} /> : null}
              <AvatarFallback className="text-[12px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {initialsFromName(displayName || email)}
              </AvatarFallback>
            </Avatar>

            <div className="hidden sm:flex flex-col items-start leading-tight">
              <span className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 max-w-[150px] truncate">
                {userLabel}
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">{roleLabel}</span>
            </div>

            <ChevronDown className="hidden sm:block h-4 w-4 text-slate-400 dark:text-slate-500" />
          </div>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-2">
        <DropdownMenuLabel className="px-2 py-2">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              {avatarUrl ? <AvatarImage src={avatarUrl} alt={userLabel} /> : null}
              <AvatarFallback className="text-[12px] font-semibold">{initialsFromName(displayName || email)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">{userLabel}</div>
              <div className="text-xs text-muted-foreground truncate">{email || roleLabel}</div>
            </div>
          </div>
        </DropdownMenuLabel>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuGroup>
          <DropdownMenuItem
            onClick={() => {
              try {
                localStorage.removeItem('bypass-landing-page');
              } catch {
                // ignore storage errors
              }
              onNavigate("/");
            }}
            className={cn(
              "h-10 rounded-md px-2",
              isActive("/") && "bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium",
            )}
          >
            <Home className="mr-2 h-4 w-4" />
            Home
          </DropdownMenuItem>

          <DropdownMenuItem
            onClick={() => onNavigate("/insights")}
            className={cn(
              "h-10 rounded-md px-2",
              isActive("/insights") && "bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium",
            )}
          >
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Insights
          </DropdownMenuItem>

          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="h-10 rounded-md px-2">
              <Wand2 className="mr-2 h-4 w-4" />
              Theme
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 p-1">
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as any)}>
                <DropdownMenuRadioItem value="light" className="h-10 rounded-md px-2">
                  <Sun className="mr-2 h-4 w-4" />
                  Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark" className="h-10 rounded-md px-2">
                  <Moon className="mr-2 h-4 w-4" />
                  Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system" className="h-10 rounded-md px-2">
                  <Laptop className="mr-2 h-4 w-4" />
                  System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>

          <DropdownMenuItem
            onClick={() => onNavigate("/settings")}
            className={cn(
              "h-10 rounded-md px-2",
              isActive("/settings") && "bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium",
            )}
          >
            <Settings className="mr-2 h-4 w-4" />
            Settings
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuGroup>
          {showAdminLink && !isAdminPage && (
            <DropdownMenuItem
              onClick={() => onNavigate("/admin")}
              className={cn(
                "h-10 rounded-md px-2",
                currentPath === "/admin" && "bg-gradient-to-r from-blue-500 to-purple-500 text-white font-medium",
              )}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              Admin
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator className="my-2" />

        <DropdownMenuItem
          onClick={onLogout}
          className={cn(
            "h-10 rounded-md px-2",
            "text-rose-600 focus:text-rose-700 dark:text-rose-400 dark:focus:text-rose-300",
          )}
        >
          <LogOut className="mr-2 h-4 w-4" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
