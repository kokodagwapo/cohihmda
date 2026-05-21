import type { ReactNode } from "react";
import { ChatShellPageGrid } from "@/components/dashboard/ChatShellPageGrid";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { DASHBOARD_TITLE_TO_CHAT_GAP } from "@/components/cohi/pageContentStyles";
import { cn } from "@/lib/utils";

export interface TopTieringPageFrameProps {
  /** Title row (typically TopTieringTopBar). Rendered above the chat shell. */
  topBar?: ReactNode;
  children: ReactNode;
  /** Set false for workbench embeds or other surfaces that should not mount chat. */
  enableChat?: boolean;
  className?: string;
}

/**
 * Standard Top Tiering dashboard page chrome: fixed title bar, unified chat band, scrollable body.
 * Matches /insights chat persistence, expand modes, and split layout.
 */
export function TopTieringPageFrame({
  topBar,
  children,
  enableChat = true,
  className,
}: TopTieringPageFrameProps) {
  const unifiedShell = isUnifiedChatClientEnabled();
  const { isAuthenticated, user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id || undefined;
  const showChat = enableChat && isAuthenticated && unifiedShell;

  return (
    <div
      className={cn(
        "flex flex-col min-h-[calc(100dvh-4rem)] w-full min-w-0",
        className,
      )}
    >
      {topBar}
      {showChat ? (
        <ChatShellPageGrid
          tenantId={effectiveTenantId}
          className={cn("flex-1 min-h-0", DASHBOARD_TITLE_TO_CHAT_GAP)}
        >
          {children}
        </ChatShellPageGrid>
      ) : (
        children
      )}
    </div>
  );
}
