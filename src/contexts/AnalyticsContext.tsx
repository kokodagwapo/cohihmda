/**
 * Analytics context: initializes tracking with user identity and wires
 * auto page-view, click, time-on-page, and form interaction tracking.
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useMemo,
  type ReactNode,
} from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Tracks page views on route change. Must be rendered inside <Router>.
 * Use once inside your Router (e.g. in App.tsx) so useLocation() is valid.
 */
export function AnalyticsPageViewTracker() {
  const location = useLocation();
  useEffect(() => {
    const path = location.pathname + location.search;
    const fullUrl = typeof window !== "undefined" ? window.location.origin + path : path;
    const prevPath = getLastPagePath();
    const enteredAt = getPageEnteredAt();
    if (prevPath && enteredAt) {
      trackPageLeave(prevPath, Date.now() - enteredAt);
    }
    trackPageView(path, fullUrl, document.referrer || undefined);
  }, [location.pathname, location.search]);
  return null;
}
import {
  initAnalytics,
  setIdentity,
  flush,
  trackPageView,
  trackPageLeave,
  trackClick,
  trackFormInteraction,
  trackEvent,
  stopFlushInterval,
  getLastPagePath,
  getPageEnteredAt,
  shouldTrackElement,
} from "@/services/analyticsService";
import { startSessionReplay, stopSessionReplay } from "@/services/sessionReplayRecorder";

interface AnalyticsContextType {
  trackEvent: (name: string, metadata?: Record<string, unknown>) => void;
  trackClick: (element: Element, clientX?: number, clientY?: number) => void;
}

const AnalyticsContext = createContext<AnalyticsContextType | null>(null);

export function useAnalytics(): AnalyticsContextType {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) {
    return {
      trackEvent,
      trackClick: (el: Element, x?: number, y?: number) => {
        const path = typeof window !== "undefined" ? window.location.pathname : "";
        const url = typeof window !== "undefined" ? window.location.href : "";
        trackClick(el, path, url, x, y);
      },
    };
  }
  return ctx;
}

interface AnalyticsProviderProps {
  children: ReactNode;
  userId: string;
  tenantId: string;
}

export function AnalyticsProvider({ children, userId, tenantId }: AnalyticsProviderProps) {
  const initialized = useRef(false);
  const clickHandlerRef = useRef<((e: MouseEvent) => void) | null>(null);

  useEffect(() => {
    if (!userId || !tenantId) return;
    if (!initialized.current) {
      initAnalytics({ userId, tenantId });
      initialized.current = true;
      startSessionReplay();
    } else {
      setIdentity({ userId, tenantId });
    }
  }, [userId, tenantId]);

  useEffect(() => {
    return () => {
      stopSessionReplay();
    };
  }, []);

  // Pause tracking when tab is hidden; resume on visible
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const prevPath = getLastPagePath();
        const enteredAt = getPageEnteredAt();
        if (prevPath && enteredAt) {
          trackPageLeave(prevPath, Date.now() - enteredAt);
        }
        flush();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Global click listener (delegation)
  useEffect(() => {
    if (!userId || !tenantId) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target || !shouldTrackElement(target)) return;
      const path = window.location.pathname + window.location.search;
      const url = window.location.href;
      trackClick(target, path, url, e.clientX, e.clientY);
    };
    clickHandlerRef.current = handler;
    document.addEventListener("click", handler, true);
    return () => {
      document.removeEventListener("click", clickHandlerRef.current!, true);
      clickHandlerRef.current = null;
    };
  }, [userId, tenantId]);

  // Form interaction: focus, blur, submit (delegation)
  useEffect(() => {
    if (!userId || !tenantId) return;
    const getFieldName = (el: Element): string => {
      const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
      return input.name || input.id || el.tagName.toLowerCase();
    };
    const onFocus = (e: FocusEvent) => {
      const target = e.target as Element;
      if (!target || target.closest("[data-no-track]")) return;
      const tag = (target as HTMLElement).tagName?.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") {
        const path = window.location.pathname + window.location.search;
        const url = window.location.href;
        trackFormInteraction("focus", getFieldName(target), path, url);
      }
    };
    const onBlur = (e: FocusEvent) => {
      const target = e.target as Element;
      if (!target || target.closest("[data-no-track]")) return;
      const tag = (target as HTMLElement).tagName?.toLowerCase();
      if (tag === "input" || tag === "select" || tag === "textarea") {
        const path = window.location.pathname + window.location.search;
        const url = window.location.href;
        trackFormInteraction("blur", getFieldName(target), path, url);
      }
    };
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement;
      if (!form || form.closest("[data-no-track]")) return;
      const path = window.location.pathname + window.location.search;
      const url = window.location.href;
      trackFormInteraction("submit", form.id || form.name || "form", path, url);
    };
    document.addEventListener("focusin", onFocus, true);
    document.addEventListener("focusout", onBlur, true);
    document.addEventListener("submit", onSubmit, true);
    return () => {
      document.removeEventListener("focusin", onFocus, true);
      document.removeEventListener("focusout", onBlur, true);
      document.removeEventListener("submit", onSubmit, true);
    };
  }, [userId, tenantId]);

  useEffect(() => {
    return () => {
      stopFlushInterval();
      flush();
    };
  }, []);

  const api = useMemo(
    () => ({
      trackEvent,
      trackClick: (el: Element, x?: number, y?: number) => {
        const path = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
        const url = typeof window !== "undefined" ? window.location.href : "";
        trackClick(el, path, url, x, y);
      },
    }),
    []
  );

  return (
    <AnalyticsContext.Provider value={api}>
      {children}
    </AnalyticsContext.Provider>
  );
}

/**
 * Wrapper that only renders AnalyticsProvider when user is authenticated.
 * Place inside AuthProvider and wrap the rest of the app.
 */
export function AnalyticsProviderWithAuth({
  children,
  user,
}: {
  children: ReactNode;
  user: { id: string; tenant_id?: string | null } | null;
}) {
  if (!user?.id) return <>{children}</>;
  const tenantId = user.tenant_id ?? "";
  return (
    <AnalyticsProvider userId={user.id} tenantId={tenantId}>
      {children}
    </AnalyticsProvider>
  );
}

/**
 * Use inside AuthProvider to enable analytics when user is logged in.
 */
export function AnalyticsWrapper({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.access_mode === "canvas_only") {
    // Canvas-only users run in a slim shell; disable analytics/replay to avoid
    // unnecessary blocked calls and keep logs clean.
    return <>{children}</>;
  }
  return <AnalyticsProviderWithAuth user={user}>{children}</AnalyticsProviderWithAuth>;
}
