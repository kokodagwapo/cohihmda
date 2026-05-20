import React, { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { UnifiedChatShell } from "@/components/cohi/UnifiedChatShell";
import { Footer } from "@/components/layout/Footer";
import { useChatShell } from "@/contexts/ChatShellContext";
import { isUnifiedChatClientEnabled } from "@/lib/unifiedChatEnvelope";
import { DASHBOARD_SECTION_GAP } from "@/components/cohi/pageContentStyles";
import { isDashboardChatShellRoute } from "@/lib/dashboardChatShellRoutes";
import { cn } from "@/lib/utils";
import { CHAT_SHELL_VIEW_TRANSITION } from "@/hooks/useChatShellAnimatedHeight";
import { useSplitPaneWheelRouting } from "@/hooks/useSplitPaneWheelRouting";

const SPLIT_PAGE_PERCENT_KEY = "cohi-chat-split-page-percent-v1";
const DEFAULT_SPLIT_PAGE_PERCENT = 55;

function readSplitPagePercent(): number {
  if (typeof window === "undefined") return DEFAULT_SPLIT_PAGE_PERCENT;
  try {
    const raw = window.localStorage.getItem(SPLIT_PAGE_PERCENT_KEY);
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 35 && n <= 75) return n;
  } catch {
    /* ignore */
  }
  return DEFAULT_SPLIT_PAGE_PERCENT;
}

export interface ChatShellPageGridProps {
  children: React.ReactNode;
  tenantId?: string;
  /** When true, renders split-pane footer inside the page column (insights layout). */
  showSplitPaneFooter?: boolean;
  className?: string;
}

export function ChatShellPageGrid({
  children,
  tenantId,
  showSplitPaneFooter = false,
  className,
}: ChatShellPageGridProps) {
  const unifiedShell = isUnifiedChatClientEnabled();
  const { mode, isPageContentVisible } = useChatShell();
  const location = useLocation();
  const chatPaneRef = useRef<HTMLDivElement>(null);
  const pagePaneRef = useRef<HTMLDivElement>(null);
  const layoutRootRef = useRef<HTMLDivElement>(null);
  const [splitPagePercent, setSplitPagePercent] = useState(readSplitPagePercent);
  const dragStateRef = useRef<{ startX: number; startPercent: number } | null>(
    null,
  );

  useEffect(() => {
    if (!isDashboardChatShellRoute(location.pathname)) return;
    const scrollRoot = pagePaneRef.current?.querySelector<HTMLElement>(
      "[data-dashboard-scroll-root]",
    );
    const scrollTarget =
      scrollRoot ??
      pagePaneRef.current?.querySelector<HTMLElement>("main") ??
      pagePaneRef.current;
    scrollTarget?.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname, location.key]);

  const isSplitLayout = unifiedShell && mode === "split";

  const splitWheel = useSplitPaneWheelRouting(
    isSplitLayout,
    chatPaneRef,
    pagePaneRef,
  );

  useEffect(() => {
    if (!isSplitLayout) return;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, [isSplitLayout]);

  const onSplitHandleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragStateRef.current = { startX: e.clientX, startPercent: splitPagePercent };
      const onMove = (ev: MouseEvent) => {
        const root = layoutRootRef.current;
        const drag = dragStateRef.current;
        if (!root || !drag) return;
        const width = root.getBoundingClientRect().width;
        if (width <= 0) return;
        const deltaPercent = ((ev.clientX - drag.startX) / width) * 100;
        const next = Math.min(75, Math.max(35, drag.startPercent + deltaPercent));
        setSplitPagePercent(next);
      };
      const onUp = () => {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setSplitPagePercent((current) => {
          try {
            window.localStorage.setItem(SPLIT_PAGE_PERCENT_KEY, String(current));
          } catch {
            /* ignore */
          }
          return current;
        });
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [splitPagePercent],
  );

  if (!unifiedShell) {
    return <>{children}</>;
  }

  const shellHeightClass = "h-[calc(100dvh-4rem)] min-h-0";

  return (
    <motion.div
      initial={false}
      animate={{ opacity: 1 }}
      transition={CHAT_SHELL_VIEW_TRANSITION}
      className={cn(
        "flex flex-col flex-1 min-h-0 w-full min-w-0",
        isSplitLayout && cn(shellHeightClass, "overflow-hidden"),
        className,
      )}
    >
      <motion.div
        ref={layoutRootRef}
        className={cn(
          "flex-1 min-h-0 w-full grid",
          isSplitLayout
            ? "grid-rows-1 h-full overflow-hidden"
            : cn(
                "grid-cols-1 grid-rows-[auto_minmax(0,1fr)]",
                DASHBOARD_SECTION_GAP,
              ),
        )}
        style={
          isSplitLayout
            ? {
                gridTemplateColumns: `minmax(0, ${splitPagePercent}fr) 6px minmax(260px, ${100 - splitPagePercent}fr)`,
              }
            : undefined
        }
      >
        <motion.div
          ref={pagePaneRef}
          className={cn(
            "min-h-0 min-w-0 overflow-hidden flex flex-col",
            !isSplitLayout &&
              "[&>main]:pt-0 [&>main]:pb-0 [&>main]:min-h-0",
            !isSplitLayout && "relative z-20 bg-transparent",
            !isSplitLayout && !isPageContentVisible && "hidden",
          )}
          style={
            isSplitLayout
              ? { gridColumn: 1, gridRow: 1 }
              : { gridColumn: 1, gridRow: 2 }
          }
          onMouseEnter={isSplitLayout ? splitWheel.onPagePaneEnter : undefined}
          onMouseLeave={isSplitLayout ? splitWheel.onPagePaneLeave : undefined}
        >
          {children}
          {isSplitLayout && showSplitPaneFooter && <Footer variant="splitPane" />}
        </motion.div>

        <div
          role="separator"
          aria-orientation="vertical"
          data-testid="chat-split-resize-handle"
          className={cn(
            "touch-none select-none bg-violet-100/80 dark:bg-indigo-900/50 transition-colors hover:bg-violet-300/80 dark:hover:bg-violet-500/40",
            isSplitLayout ? "cursor-col-resize" : "hidden",
          )}
          style={isSplitLayout ? { gridColumn: 2, gridRow: 1 } : undefined}
          onMouseDown={onSplitHandleMouseDown}
        />

        <motion.div
          ref={chatPaneRef}
          className={cn(
            "min-h-0 min-w-0 overflow-hidden flex flex-col",
            isSplitLayout && "bg-white/95 dark:bg-slate-950/95",
          )}
          style={
            isSplitLayout
              ? { gridColumn: 3, gridRow: 1 }
              : { gridColumn: 1, gridRow: 1 }
          }
          onMouseEnter={isSplitLayout ? splitWheel.onChatPaneEnter : undefined}
          onMouseLeave={isSplitLayout ? splitWheel.onChatPaneLeave : undefined}
        >
          <UnifiedChatShell tenantId={tenantId} />
        </motion.div>
      </motion.div>
    </motion.div>
  );
}
