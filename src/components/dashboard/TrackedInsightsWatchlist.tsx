/**
 * TrackedInsightsWatchlist
 *
 * Collapsible watchlist section showing insights the user has pinned/tracked.
 * Each tracked insight shows headline, trend badge, last evaluated time,
 * and a sparkline of metric values over time.
 */

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bookmark,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Clock,
  Loader2,
  AlertTriangle,
  ChevronRight,
  BookmarkX,
  Pause,
  Archive,
} from "lucide-react";
import { api } from "@/lib/api";
import { TrackedInsightDetailModal } from "./TrackedInsightDetailModal";

// ============================================================================
// Types
// ============================================================================

interface TrackedInsight {
  id: string;
  headline: string;
  understory: string;
  status: "active" | "resolved" | "archived";
  source_type: string;
  source_insight_id?: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  alert_threshold: { field: string; operator: string; value: number; triggered?: boolean; last_triggered_at?: string | null } | null;
  metric_signature: {
    sql: string;
    keyFields: string[];
    comparisonKeyFields?: string[];
    polarities?: Record<string, "higher_better" | "lower_better" | "neutral">;
  } | null;
  display_metadata: {
    keyMetricDescriptions?: Record<string, string>;
    keyMetricFormats?: Record<string, string>;
    evaluable?: boolean;
    non_evaluable_reason?: string;
    source_page_id?: string;
    source_page_name?: string;
    filter_context_snapshot?: Record<string, unknown>;
  } | null;
  latest_values: Record<string, any> | null;
  latest_previous: Record<string, any> | null;
  baseline_values?: Record<string, any> | null;
  snapshot_count?: number | null;
  latest_change: string | null;
  latest_trend: "improving" | "worsening" | "stable" | "new" | null;
  last_evaluated: string | null;
}

// ============================================================================
// Trend badge (inline — used in the list rows)
// ============================================================================

function TrendBadge({ trend }: { trend: string | null }) {
  if (!trend || trend === "new") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        <Sparkles className="w-3 h-3" />
        New
      </span>
    );
  }
  if (trend === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <TrendingUp className="w-3 h-3" />
        Improving
      </span>
    );
  }
  if (trend === "worsening") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <TrendingDown className="w-3 h-3" />
        Worsening
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
      <Minus className="w-3 h-3" />
      Stable
    </span>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

/** Plan §0: explicit evaluable flag from server, or legacy empty-SQL signature. */
function trackedInsightIsEvaluable(insight: TrackedInsight): boolean {
  const e = insight.display_metadata?.evaluable;
  if (typeof e === "boolean") return e;
  return !!(insight.metric_signature?.sql?.trim());
}

// ============================================================================
// Main component
// ============================================================================

interface TrackedInsightsWatchlistProps {
  selectedTenantId?: string | null;
  /** Increment to force a refetch (e.g. after track/untrack elsewhere). */
  refreshTrigger?: number;
  /** Called after an insight is removed or archived from this watchlist UI. */
  onInsightRemoved?: () => void;
}

type ListView = "watching" | "archived";

export function TrackedInsightsWatchlist({ selectedTenantId, refreshTrigger, onInsightRemoved }: TrackedInsightsWatchlistProps = {}) {
  const [insights, setInsights] = useState<TrackedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [listView, setListView] = useState<ListView>("watching");
  const [selectedInsight, setSelectedInsight] = useState<TrackedInsight | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchInsights = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getTrackedInsights(selectedTenantId);
      const rows = data as TrackedInsight[];
      setInsights(rows);
      setSelectedInsight((prev) => {
        if (!prev) return null;
        const next = rows.find((r) => r.id === prev.id);
        return next ?? null;
      });
    } catch (err) {
      console.error("Failed to load tracked insights:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights, refreshTrigger]);

  const handleOpenDetail = useCallback((insight: TrackedInsight) => {
    setSelectedInsight(insight);
    setIsModalOpen(true);
  }, []);

  const handleInsightMutated = useCallback(async () => {
    api.invalidateCacheFor("/insights/tracked");
    await fetchInsights();
    onInsightRemoved?.();
  }, [fetchInsights, onInsightRemoved]);

  /** Modal already called PUT to archive; refresh list only. */
  const handleArchive = useCallback(
    async (_id: string) => {
      api.invalidateCacheFor("/insights/tracked");
      await fetchInsights();
      onInsightRemoved?.();
    },
    [fetchInsights, onInsightRemoved]
  );

  /** Modal already called DELETE; refresh list only. */
  const handleDelete = useCallback(
    async (_id: string) => {
      setSelectedInsight(null);
      api.invalidateCacheFor("/insights/tracked");
      await fetchInsights();
      onInsightRemoved?.();
    },
    [fetchInsights, onInsightRemoved]
  );

  /** Watching = active + paused (resolved); evaluator only runs for active. */
  const watchingInsights = insights.filter((i) => i.status === "active" || i.status === "resolved");
  const archivedInsights = insights.filter((i) => i.status === "archived");
  const listInsights = listView === "watching" ? watchingInsights : archivedInsights;

  return (
    <div className="overflow-hidden">
      {/* Active vs Archived (plan §7) */}
      <div className="flex rounded-lg border border-slate-200/80 dark:border-slate-600/60 p-0.5 mb-3 bg-slate-100/50 dark:bg-slate-800/40">
        <button
          type="button"
          onClick={() => setListView("watching")}
          className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
            listView === "watching"
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          Watching
        </button>
        <button
          type="button"
          onClick={() => setListView("archived")}
          className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${
            listView === "archived"
              ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm"
              : "text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          Archived
        </button>
      </div>
      <p className="text-[10px] text-slate-500 dark:text-slate-400 mb-3 leading-snug">
        {listView === "watching"
          ? "Watching includes active bookmarks and paused ones (no automatic updates until you resume)."
          : "Archived bookmarks are kept for reference. Untrack removes a bookmark completely."}
      </p>

      {/* Empty state */}
      {!loading && listInsights.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mb-3">
            {listView === "archived" ? (
              <Archive className="w-6 h-6 text-slate-500 dark:text-slate-400" />
            ) : (
              <Bookmark className="w-6 h-6 text-amber-500 dark:text-amber-400" />
            )}
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {listView === "archived" ? "No archived bookmarks" : "No tracked insights yet"}
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
            {listView === "archived"
              ? "Archive a bookmark from its detail view to keep it here for reference without Untracking."
              : "Bookmark any insight using the bookmark icon to track it on this watchlist over time."}
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
          <span className="ml-2 text-xs text-slate-500">Loading watchlist...</span>
        </div>
      )}

      {/* List */}
      {!loading && listInsights.length > 0 && (
        <div className="space-y-1.5">
          {listInsights.map((insight) => (
            <motion.button
              key={insight.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => handleOpenDetail(insight)}
              className="w-full text-left rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900/50 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors group"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200 leading-snug line-clamp-2">
                    {insight.headline}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <TrendBadge trend={insight.latest_trend} />
                    {insight.status === "resolved" && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300">
                        <Pause className="w-2.5 h-2.5 shrink-0" />
                        Paused
                      </span>
                    )}
                    {!trackedInsightIsEvaluable(insight) && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-800 dark:bg-amber-900/25 dark:text-amber-300 border border-amber-200/80 dark:border-amber-800/50"
                        title={
                          insight.display_metadata?.non_evaluable_reason ||
                          "This bookmark is kept on your watchlist but metrics are not refreshed automatically."
                        }
                      >
                        <BookmarkX className="w-2.5 h-2.5 shrink-0" />
                        Not auto-updating
                      </span>
                    )}
                    {insight.alert_threshold?.triggered && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        Alert
                      </span>
                    )}
                    {insight.last_evaluated && (
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Clock className="w-2.5 h-2.5" />
                        {timeAgo(insight.last_evaluated)}
                      </span>
                    )}
                  </div>
                  {insight.latest_change && (
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                      {insight.latest_change}
                    </p>
                  )}
                </div>
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </motion.button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      <TrackedInsightDetailModal
        insight={selectedInsight}
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setSelectedInsight(null); }}
        onArchive={handleArchive}
        onDelete={handleDelete}
        onInsightMutated={handleInsightMutated}
        selectedTenantId={selectedTenantId}
      />
    </div>
  );
}
