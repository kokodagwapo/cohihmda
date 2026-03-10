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
    refetch,
  };
}

