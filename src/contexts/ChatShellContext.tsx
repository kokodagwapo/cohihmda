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

import { RESEARCH_SHELL_EXPAND_EVENT } from "@/lib/unifiedChatEnvelope";



export type ChatShellExpandMode = "compact" | "tall" | "full" | "split";



export interface ChatShellContextValue {

  mode: ChatShellExpandMode;

  setMode: (mode: ChatShellExpandMode) => void;

  preserveExpandOnNextNavigation: () => void;

  isPageContentVisible: boolean;

  /** Compact/tall band stacked above page content (not full/split). */

  isStackedInsetLayout: boolean;

}



const ChatShellContext = createContext<ChatShellContextValue | null>(null);



export function ChatShellProvider({ children }: { children: ReactNode }) {

  const location = useLocation();

  const isMobile = useIsMobile();

  const [mode, setModeState] = useState<ChatShellExpandMode>("compact");

  const prevPathnameRef = useRef(location.pathname);



  const setMode = useCallback((next: ChatShellExpandMode) => {

    if (isMobile && next === "split") {

      setModeState("full");

      return;

    }

    setModeState(next);

  }, [isMobile]);



  /** @deprecated Mode persists across navigation; kept for API compatibility. */

  const preserveExpandOnNextNavigation = useCallback(() => {}, []);



  useEffect(() => {

    const navState = location.state as { resumeChat?: boolean } | null;

    const pathnameChanged = prevPathnameRef.current !== location.pathname;

    prevPathnameRef.current = location.pathname;



    if (navState?.resumeChat) {

      setModeState("full");

      return;

    }



    if (pathnameChanged) {

      setModeState((prev) => (prev === "full" ? "compact" : prev));

    }

  }, [location.pathname, location.key]);



  useEffect(() => {

    if (isMobile && mode === "split") {

      setModeState("full");

    }

  }, [isMobile, mode]);



  useEffect(() => {

    const onExpand = () => setModeState("full");

    window.addEventListener(RESEARCH_SHELL_EXPAND_EVENT, onExpand);

    return () =>

      window.removeEventListener(RESEARCH_SHELL_EXPAND_EVENT, onExpand);

  }, []);



  const isPageContentVisible = mode !== "full";

  const isStackedInsetLayout = mode === "compact" || mode === "tall";



  const value = useMemo(

    () => ({

      mode,

      setMode,

      preserveExpandOnNextNavigation,

      isPageContentVisible,

      isStackedInsetLayout,

    }),

    [mode, setMode, preserveExpandOnNextNavigation, isPageContentVisible, isStackedInsetLayout],

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


