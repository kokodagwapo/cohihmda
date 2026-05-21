/**
 * Watchlist tracking for research ranked insights (Research Lab + unified chat).
 */
import { useState, useCallback, useEffect } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useTenantStore } from "@/stores/tenantStore";

type TrackedRow = {
  id: string;
  headline: string;
  understory?: string;
  source_type?: string;
  status?: string;
};

const normalizeHeadline = (h: string) => (h || "").trim().toLowerCase();

/** Tenant DB missing migration 111 — artifact POST fails; bookmark-only track still works. */
function isResearchArtifactsUnavailable(err: unknown): boolean {
  const msg =
    err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return (
    /research_artifacts/i.test(msg) ||
    /research_artifacts_unavailable/i.test(msg) ||
    /pending migration/i.test(msg)
  );
}

export function useResearchInsightTracking(
  tenantId?: string | null,
  sessionId?: string | null,
) {
  const { toast } = useToast();
  const { user } = useAuth();
  const selectedTenantId = useTenantStore((s) => s.selectedTenantId);
  const effectiveTenantId = tenantId ?? selectedTenantId ?? user?.tenant_id ?? null;

  const [trackedMap, setTrackedMap] = useState<Map<string, string>>(new Map());

  const fetchAndBuildTrackedMap = useCallback(
    async (bustCache = false) => {
      if (bustCache) api.invalidateCacheFor("/insights/tracked");
      const data = ((await api.getTrackedInsights(effectiveTenantId)) ||
        []) as TrackedRow[];
      const map = new Map<string, string>();
      for (const r of data) {
        if (r.source_type === "research" && r.status === "active") {
          map.set(normalizeHeadline(r.headline), r.id);
        }
      }
      return map;
    },
    [effectiveTenantId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAndBuildTrackedMap()
      .then((map) => {
        if (!cancelled) setTrackedMap(map);
      })
      .catch((err) =>
        console.error("Failed to load tracked research insights:", err),
      );
    return () => {
      cancelled = true;
    };
  }, [fetchAndBuildTrackedMap]);

  const isTracked = useCallback(
    (headline: string, _detail: string) =>
      trackedMap.has(normalizeHeadline(headline)),
    [trackedMap],
  );

  const onToggleTrack = useCallback(
    async (
      headline: string,
      detail: string,
      extras?: { sql?: string; keyFields?: string[] },
    ) => {
      const key = normalizeHeadline(headline);
      const currentlyTracked = trackedMap.has(key);

      setTrackedMap((prev) => {
        const next = new Map(prev);
        if (currentlyTracked) next.delete(key);
        else next.set(key, "pending");
        return next;
      });

      try {
        if (currentlyTracked) {
          let trackedId = trackedMap.get(key);
          if (!trackedId || trackedId === "pending") {
            const freshMap = await fetchAndBuildTrackedMap(true);
            trackedId = freshMap.get(key);
          }
          if (trackedId && trackedId !== "pending") {
            await api.deleteTrackedInsight(trackedId, effectiveTenantId);
          }
        } else {
          let researchArtifactId: string | undefined;
          let usedBookmarkFallback = false;
          const sql = extras?.sql?.trim();
          if (sql && sessionId) {
            try {
              const created = (await api.createResearchArtifact(
                {
                  session_id: sessionId,
                  sql,
                  keyFields: extras?.keyFields?.length ? extras.keyFields : [],
                  title: headline.slice(0, 500),
                  explanation: detail.slice(0, 8000),
                  headline_fingerprint: key,
                },
                effectiveTenantId,
              )) as { id?: string };
              if (created?.id) researchArtifactId = created.id;
            } catch (artifactErr) {
              if (!isResearchArtifactsUnavailable(artifactErr)) {
                throw artifactErr;
              }
              usedBookmarkFallback = true;
              console.warn(
                "[Research] research_artifacts unavailable; tracking headline bookmark only:",
                artifactErr,
              );
            }
          } else if (sql && !sessionId) {
            toast({
              title: "Cannot track with data refresh",
              description:
                "Open a research session before tracking SQL-backed insights.",
              variant: "destructive",
            });
            setTrackedMap((prev) => {
              const next = new Map(prev);
              next.delete(key);
              return next;
            });
            return;
          }
          await api.trackInsight(
            {
              headline,
              understory: detail,
              source_type: "research",
              ...(researchArtifactId
                ? { research_artifact_id: researchArtifactId }
                : {}),
            },
            effectiveTenantId,
          );
          if (usedBookmarkFallback) {
            toast({
              title: "Added to watchlist",
              description:
                "Saved as a headline bookmark. Run tenant migration 132_ensure_research_artifacts for auto-updating metrics.",
            });
          }
        }
        const freshMap = await fetchAndBuildTrackedMap(true);
        setTrackedMap(freshMap);
      } catch (err) {
        console.error("Error toggling tracked research insight:", err);
        toast({
          title: "Watchlist update failed",
          description:
            err instanceof Error ? err.message : "Could not update watchlist.",
          variant: "destructive",
        });
        setTrackedMap((prev) => {
          const reverted = new Map(prev);
          if (currentlyTracked) reverted.set(key, "reverted");
          else reverted.delete(key);
          return reverted;
        });
      }
    },
    [
      effectiveTenantId,
      trackedMap,
      fetchAndBuildTrackedMap,
      sessionId,
      toast,
    ],
  );

  return { isTracked, onToggleTrack };
}
