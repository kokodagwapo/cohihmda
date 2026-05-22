/**
 * Horizontal Cohi Chat band under top nav (COHI-404).
 */

import { useRef } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { CohiChatPanel } from "@/components/dashboard/CohiChatPanel";
import { UnifiedChatShellBootstrap } from "@/components/cohi/UnifiedChatShellBootstrap";
import { useChatShell } from "@/contexts/ChatShellContext";
import { cn } from "@/lib/utils";
import type { UnifiedChatType } from "@/lib/unifiedChatClient";
import {
  DASHBOARD_CHAT_SHELL_GUTTER,
  DASHBOARD_PAGE_CONTENT_COLUMN,
  PAGE_CONTENT_GUTTER,
} from "@/components/cohi/pageContentStyles";
import { isTopTieringDashboardRoute } from "@/lib/dashboardChatShellRoutes";
import {
  CHAT_SHELL_VIEW_TRANSITION,
  useChatShellAnimatedHeight,
} from "@/hooks/useChatShellAnimatedHeight";

export interface UnifiedChatShellProps {
  tenantId?: string;
  className?: string;
}

export function UnifiedChatShell({ tenantId, className }: UnifiedChatShellProps) {
  const { pathname } = useLocation();
  const { mode, isStackedInsetLayout, setMode } = useChatShell();
  const isTopTieringDashboard = isTopTieringDashboardRoute(pathname);
  const contentMeasureRef = useRef<HTMLDivElement>(null);
  const { targetHeightPx, usesAnimatedHeight, transition } =
    useChatShellAnimatedHeight(mode, contentMeasureRef);

  const onResume = (conversationId: string, chatType: UnifiedChatType) => {
    if (chatType !== "workbench") {
      setMode("full");
    }
    window.dispatchEvent(
      new CustomEvent("cohi-chat-resume", {
        detail: { conversationId, chatType },
      }),
    );
  };

  return (
    <motion.section
      data-testid="unified-chat-shell"
      data-tour="unified-chat-shell"
      data-stacked-inset={isStackedInsetLayout ? "" : undefined}
      animate={
        usesAnimatedHeight
          ? { height: targetHeightPx }
          : undefined
      }
      transition={transition}
      className={cn(
        "flex flex-col min-w-0 z-30 overflow-hidden isolate",
        !usesAnimatedHeight && "h-full min-h-0 flex-1",
        isStackedInsetLayout
          ? "bg-transparent"
          : mode === "split"
            ? "bg-white/95 dark:bg-slate-950/95"
            : "border-b border-violet-100/80 dark:border-indigo-900/50 bg-white/95 dark:bg-slate-950/95",
        className,
      )}
    >
      <UnifiedChatShellBootstrap tenantId={tenantId} onResume={onResume} />
      <div
        ref={contentMeasureRef}
        className={cn(
          "flex flex-col min-h-0 min-w-0 w-full",
          mode === "compact" ? "flex-none" : "flex-1 min-h-0 h-full",
          isStackedInsetLayout &&
            (isTopTieringDashboard
              ? DASHBOARD_CHAT_SHELL_GUTTER
              : PAGE_CONTENT_GUTTER),
        )}
      >
        <div
          className={cn(
            "flex flex-col flex-1 min-h-0 h-full min-w-0 overflow-hidden w-full",
            isStackedInsetLayout && isTopTieringDashboard && DASHBOARD_PAGE_CONTENT_COLUMN,
          )}
        >
          <CohiChatPanel
            layout="shell"
            isOpen
            tenantId={tenantId}
            onClose={() => {}}
            hideInPanelHistory
            className={
              mode === "compact"
                ? "shrink-0 flex-none"
                : "flex-1 min-h-0 h-full"
            }
          />
        </div>
      </div>
    </motion.section>
  );
}

export { CHAT_SHELL_VIEW_TRANSITION };
