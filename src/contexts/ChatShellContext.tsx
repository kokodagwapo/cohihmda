/**
 * Global Cohi Chat shell expand state (COHI-404).
 * Meeting spec §2.3–§2.4, §4.6 research auto full-page.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { isChatHomePath } from "@/lib/chatHomeRoute";
import { RESEARCH_SHELL_EXPAND_EVENT } from "@/lib/unifiedChatEnvelope";
import {
  consumeWorkbenchChatSplitLayout,
  isMyDashboardCanvasPath,
  WORKBENCH_CHAT_HANDOFF_STATE_KEY,
  type WorkbenchChatHandoffLocationState,
} from "@/lib/workbench/workbenchChatHandoff";
import { dispatchWorkbenchFlushDraftLayout } from "@/lib/workbench/workbenchDraftLayoutCache";

export type ChatShellExpandMode = "compact" | "tall" | "full" | "split";

export interface ChatShellContextValue {
  mode: ChatShellExpandMode;
  setMode: (mode: ChatShellExpandMode) => void;
  preserveExpandOnNextNavigation: () => void;
  isPageContentVisible: boolean;
  /** Compact/tall band stacked above page content (not full/split). */
  isStackedInsetLayout: boolean;
  /** Authenticated chat landing at `/` — layout controls hidden, mode locked to full. */
  isChatHomePage: boolean;
}

const ChatShellContext = createContext<ChatShellContextValue | null>(null);

export function ChatShellProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isChatHomePage = isChatHomePath(location.pathname);
  const [mode, setModeState] = useState<ChatShellExpandMode>("compact");
  const prevPathnameRef = useRef(location.pathname);

  const setMode = useCallback(
    (next: ChatShellExpandMode) => {
      if (isChatHomePath(location.pathname)) {
        if (next !== "full") return;
        setModeState("full");
        return;
      }
      if (isMobile && next === "split") {
        setModeState("full");
        return;
      }
      dispatchWorkbenchFlushDraftLayout();
      setModeState(next);
    },
    [isMobile, location.pathname],
  );

  /** @deprecated Mode persists across navigation; kept for API compatibility. */
  const preserveExpandOnNextNavigation = useCallback(() => {}, []);

  useEffect(() => {
    const navState = location.state as
      | ({ resumeChat?: boolean } & WorkbenchChatHandoffLocationState)
      | null;
    const pathnameChanged = prevPathnameRef.current !== location.pathname;
    prevPathnameRef.current = location.pathname;

    if (isChatHomePath(location.pathname)) {
      setModeState("full");
      return;
    }

    if (navState?.resumeChat) {
      setModeState("full");
      return;
    }

    const workbenchHandoff = navState?.[WORKBENCH_CHAT_HANDOFF_STATE_KEY];
    if (
      isMyDashboardCanvasPath(location.pathname) &&
      (workbenchHandoff || consumeWorkbenchChatSplitLayout())
    ) {
      setModeState(isMobile ? "full" : "split");
      return;
    }

    if (pathnameChanged) {
      setModeState((prev) => (prev === "full" ? "compact" : prev));
    }
  }, [location.pathname, location.key, isMobile]);

  useEffect(() => {
    if (isMobile && mode === "split") {
      setModeState("full");
    }
  }, [isMobile, mode]);

  useEffect(() => {
    const onExpand = () => {
      if (isChatHomePath(location.pathname)) {
        setModeState("full");
        return;
      }
      setModeState("full");
    };
    window.addEventListener(RESEARCH_SHELL_EXPAND_EVENT, onExpand);
    return () =>
      window.removeEventListener(RESEARCH_SHELL_EXPAND_EVENT, onExpand);
  }, [location.pathname]);

  const effectiveMode = isChatHomePage ? "full" : mode;
  const isPageContentVisible = effectiveMode !== "full";
  const isStackedInsetLayout =
    effectiveMode === "compact" || effectiveMode === "tall";

  const value = useMemo(
    () => ({
      mode: effectiveMode,
      setMode,
      preserveExpandOnNextNavigation,
      isPageContentVisible,
      isStackedInsetLayout,
      isChatHomePage,
    }),
    [
      effectiveMode,
      setMode,
      preserveExpandOnNextNavigation,
      isPageContentVisible,
      isStackedInsetLayout,
      isChatHomePage,
    ],
  );

  return (
    <ChatShellContext.Provider value={value}>{children}</ChatShellContext.Provider>
  );
}

export function useChatShell(): ChatShellContextValue {
  const ctx = useContext(ChatShellContext);
  if (!ctx) {
    return {
      mode: "compact",
      setMode: () => {},
      preserveExpandOnNextNavigation: () => {},
      isPageContentVisible: true,
      isStackedInsetLayout: true,
      isChatHomePage: false,
    };
  }
  return ctx;
}

/** @deprecated Chat links no longer need special navigation state for shell mode. */
export function cohiChatNavigationState() {
  return { fromCohiChat: true as const };
}

/** Open resumed historical chat in full-page shell (§2.3). */
export function cohiChatResumeNavigationState() {
  return { resumeChat: true as const };
}
