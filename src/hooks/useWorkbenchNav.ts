import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";

export type SidebarCanvas = {
  id: string;
  title: string;
  favorited?: boolean;
  is_owner?: boolean;
  visibility?: "private" | "global" | "shared";
  owner_name?: string | null;
  owner_email?: string | null;
  updated_at?: string;
};

export type SidebarResearchSession = {
  id: string;
  topic: string | null;
  phase?: string;
  updatedAt?: string;
  isOwner?: boolean;
};

const WORKBENCH_NAV_UPDATED = "workbench-nav-updated";

type FavoriteUpdate = { canvasId: string; favorited: boolean };
const WORKBENCH_FAVORITE_CHANGED = "workbench-favorite-changed";

export function useWorkbenchNav() {
  const { user } = useAuth();
  const { selectedTenantId } = useTenantStore();
  const effectiveTenantId = selectedTenantId || user?.tenant_id || null;

  const [canvases, setCanvases] = useState<SidebarCanvas[]>([]);
  const [sessions, setSessions] = useState<SidebarResearchSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [favoriteUpdatingIds, setFavoriteUpdatingIds] = useState<Set<string>>(
    new Set(),
  );

  const refetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const tenantQuery = effectiveTenantId
        ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
        : "";
      const [canvasRes, sessionRes] = await Promise.all([
        api.request<{ canvases: SidebarCanvas[] }>(
          `/api/workbench/canvases${tenantQuery}`,
        ),
        api.request<SidebarResearchSession[]>(
          `/api/research/sessions${tenantQuery}`,
        ),
      ]);
      setCanvases(canvasRes?.canvases ?? []);
      setSessions(Array.isArray(sessionRes) ? sessionRes : []);
    } catch {
      setCanvases([]);
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [effectiveTenantId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Sync favorite changes across all hook instances immediately
  useEffect(() => {
    const handleFavoriteChanged = (e: Event) => {
      const { canvasId, favorited } = (e as CustomEvent<FavoriteUpdate>).detail;
      setCanvases((prev) =>
        prev.map((c) => (c.id === canvasId ? { ...c, favorited } : c)),
      );
    };
    const handleNavUpdated = () => { void refetch(); };
    window.addEventListener(WORKBENCH_FAVORITE_CHANGED, handleFavoriteChanged);
    window.addEventListener(WORKBENCH_NAV_UPDATED, handleNavUpdated);
    return () => {
      window.removeEventListener(WORKBENCH_FAVORITE_CHANGED, handleFavoriteChanged);
      window.removeEventListener(WORKBENCH_NAV_UPDATED, handleNavUpdated);
    };
  }, [refetch]);

  const ownedCanvases = useMemo(
    () => canvases.filter((c) => c.is_owner !== false),
    [canvases],
  );
  const sharedCanvases = useMemo(
    () => canvases.filter((c) => c.is_owner === false),
    [canvases],
  );
  const favoriteCanvases = useMemo(
    () => canvases.filter((c) => !!c.favorited),
    [canvases],
  );

  const ownedSessions = useMemo(
    () => sessions.filter((s) => s.isOwner !== false),
    [sessions],
  );
  const sharedSessions = useMemo(
    () => sessions.filter((s) => s.isOwner === false),
    [sessions],
  );

  const toggleCanvasFavorite = useCallback(
    async (canvasId: string, nextFavorited: boolean) => {
      if (favoriteUpdatingIds.has(canvasId)) return;

      setFavoriteUpdatingIds((prev) => new Set(prev).add(canvasId));
      const previous = canvases;
      setCanvases((prev) =>
        prev.map((c) =>
          c.id === canvasId ? { ...c, favorited: nextFavorited } : c,
        ),
      );

      // Broadcast optimistic update so all instances (sidebar, nav, etc.) sync immediately
      window.dispatchEvent(
        new CustomEvent<FavoriteUpdate>(WORKBENCH_FAVORITE_CHANGED, {
          detail: { canvasId, favorited: nextFavorited },
        }),
      );

      try {
        const tenantQuery = effectiveTenantId
          ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
          : "";
        await api.request(`/api/workbench/canvases/${canvasId}/favorite${tenantQuery}`, {
          method: "POST",
          body: JSON.stringify({ favorited: nextFavorited }),
        });
      } catch {
        setCanvases(previous);
        // Revert the broadcast
        window.dispatchEvent(
          new CustomEvent<FavoriteUpdate>(WORKBENCH_FAVORITE_CHANGED, {
            detail: { canvasId, favorited: !nextFavorited },
          }),
        );
      } finally {
        setFavoriteUpdatingIds((prev) => {
          const next = new Set(prev);
          next.delete(canvasId);
          return next;
        });
      }
    },
    [canvases, effectiveTenantId, favoriteUpdatingIds],
  );

  const deleteCanvas = useCallback(
    async (canvasId: string): Promise<void> => {
      const tenantQuery = effectiveTenantId
        ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
        : "";
      await api.request(`/api/workbench/canvases/${canvasId}${tenantQuery}`, { method: "DELETE" });
      setCanvases((prev) => prev.filter((c) => c.id !== canvasId));
      window.dispatchEvent(new Event(WORKBENCH_NAV_UPDATED));
    },
    [effectiveTenantId],
  );

  const deleteResearchSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const tenantQuery = effectiveTenantId
        ? `?tenant_id=${encodeURIComponent(effectiveTenantId)}`
        : "";
      await api.request(`/api/research/sessions/${sessionId}${tenantQuery}`, { method: "DELETE" });
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    },
    [effectiveTenantId],
  );

  return {
    isLoading,
    canvases,
    sessions,
    ownedCanvases,
    sharedCanvases,
    favoriteCanvases,
    ownedSessions,
    sharedSessions,
    favoriteUpdatingIds,
    toggleCanvasFavorite,
    deleteCanvas,
    deleteResearchSession,
    refetch,
  };
}

/** Call from anywhere to make all useWorkbenchNav instances refetch data */
export function notifyWorkbenchNavUpdated() {
  window.dispatchEvent(new Event(WORKBENCH_NAV_UPDATED));
}

