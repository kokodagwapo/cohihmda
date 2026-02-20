import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useAuth } from "./AuthContext";

interface DebugModeContextValue {
  /** Whether debug mode is currently active (always false for non-staff) */
  isDebugMode: boolean;
  /** Toggle debug mode on/off — no-op for non-staff */
  toggleDebugMode: () => void;
  /** Whether the current user is allowed to enter debug mode */
  canDebug: boolean;
}

const DebugModeContext = createContext<DebugModeContextValue>({
  isDebugMode: false,
  toggleDebugMode: () => {},
  canDebug: false,
});

const STORAGE_KEY = "cohi:debugMode";

export function DebugModeProvider({ children }: { children: ReactNode }) {
  const { isPlatformStaff } = useAuth();
  const canDebug = isPlatformStaff();

  const [isDebugMode, setIsDebugMode] = useState(() => {
    if (!canDebug) return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });

  // Reset if the user loses admin status (e.g. stopped impersonating)
  useEffect(() => {
    if (!canDebug && isDebugMode) setIsDebugMode(false);
  }, [canDebug, isDebugMode]);

  const toggleDebugMode = useCallback(() => {
    if (!canDebug) return;
    setIsDebugMode((prev) => {
      const next = !prev;
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  }, [canDebug]);

  // Keyboard shortcut: Ctrl+Shift+D (or Cmd+Shift+D on Mac)
  useEffect(() => {
    if (!canDebug) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "D") {
        e.preventDefault();
        toggleDebugMode();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canDebug, toggleDebugMode]);

  return (
    <DebugModeContext.Provider value={{ isDebugMode, toggleDebugMode, canDebug }}>
      {children}
    </DebugModeContext.Provider>
  );
}

export function useDebugMode() {
  return useContext(DebugModeContext);
}
