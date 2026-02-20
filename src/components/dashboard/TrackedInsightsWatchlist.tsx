/**
 * TrackedInsightsWatchlist
 *
 * Collapsible watchlist section showing insights the user has pinned/tracked.
 * Each tracked insight shows headline, trend badge, last evaluated time,
 * and a sparkline of metric values over time.
 */

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bookmark,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Archive,
  Trash2,
  Clock,
  Loader2,
} from "lucide-react";
import { api } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

interface TrackedInsight {
  id: string;
  headline: string;
  understory: string;
  status: "active" | "resolved" | "archived";
  source_type: string;
  tags: string[];
  created_at: string;
  updated_at: string;
  latest_values: Record<string, any> | null;
  latest_previous: Record<string, any> | null;
  latest_change: string | null;
  latest_trend: "improving" | "worsening" | "stable" | "new" | null;
  last_evaluated: string | null;
}

interface Snapshot {
  id: string;
  metric_values: Record<string, any>;
  previous_values: Record<string, any> | null;
  change_summary: string;
  trend: string;
  evaluated_at: string;
}

// ============================================================================
// Trend helpers
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

function MiniSparkline({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length < 2) return null;

  // Find the first numeric key from the most recent snapshot
  const keys = Object.keys(snapshots[0]?.metric_values || {}).filter(
    (k) => !k.startsWith("_") && typeof snapshots[0].metric_values[k] === "number"
  );
  if (keys.length === 0) return null;

  const key = keys[0];
  const values = snapshots
    .slice()
    .reverse()
    .map((s) => parseFloat(s.metric_values[key]))
    .filter((v) => !isNaN(v));

  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 60;
  const height = 20;

  const points = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  });

  const isUp = values[values.length - 1] >= values[0];

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={isUp ? "#22c55e" : "#ef4444"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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

// ============================================================================
// Main component
// ============================================================================

interface TrackedInsightsWatchlistProps {
  selectedTenantId?: string | null;
}

export function TrackedInsightsWatchlist({ selectedTenantId }: TrackedInsightsWatchlistProps = {}) {
  const [insights, setInsights] = useState<TrackedInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [history, setHistory] = useState<Record<string, Snapshot[]>>({});
  const [historyLoading, setHistoryLoading] = useState<string | null>(null);

  const fetchInsights = useCallback(async () => {
    try {
      const data = await api.getTrackedInsights(selectedTenantId);
      setInsights(data as TrackedInsight[]);
    } catch (err) {
      console.error("Failed to load tracked insights:", err);
    } finally {
      setLoading(false);
    }
  }, [selectedTenantId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const loadHistory = useCallback(async (id: string) => {
    if (history[id]) return;
    setHistoryLoading(id);
    try {
      const data = await api.getTrackedInsightHistory(id, 50, selectedTenantId);
      setHistory((prev) => ({ ...prev, [id]: data as Snapshot[] }));
    } catch (err) {
      console.error("Failed to load insight history:", err);
    } finally {
      setHistoryLoading(null);
    }
  }, [history, selectedTenantId]);

  const handleArchive = useCallback(async (id: string) => {
    try {
      await api.updateTrackedInsight(id, { status: "archived" }, selectedTenantId);
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("Failed to archive tracked insight:", err);
    }
  }, [selectedTenantId]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.deleteTrackedInsight(id, selectedTenantId);
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (err) {
      console.error("Failed to delete tracked insight:", err);
    }
  }, [selectedTenantId]);

  const activeInsights = insights.filter((i) => i.status === "active");

  return (
    <div className="overflow-hidden">
      {/* Empty state */}
      {!loading && activeInsights.length === 0 && (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-900/20 flex items-center justify-center mb-3">
            <Bookmark className="w-6 h-6 text-amber-500 dark:text-amber-400" />
          </div>
          <p className="text-sm font-medium text-slate-700 dark:text-slate-300">No tracked insights yet</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-xs">
            Pin insights from the Pipeline or Agent tabs using the bookmark icon to track them here over time.
          </p>
        </div>
      )}

      {/* Body */}
      {activeInsights.length > 0 && (
        <div className="space-y-2">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
              <span className="ml-2 text-xs text-slate-500">
                Loading watchlist...
              </span>
            </div>
          ) : (
                activeInsights.map((insight) => {
                  const isOpen = expandedId === insight.id;
                  const snaps = history[insight.id];

                  return (
                    <div
                      key={insight.id}
                      className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-900/50 overflow-hidden"
                    >
                      <button
                        onClick={() => {
                          const nextId = isOpen ? null : insight.id;
                          setExpandedId(nextId);
                          if (nextId) loadHistory(nextId);
                        }}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-medium text-slate-800 dark:text-slate-200 leading-snug line-clamp-2">
                              {insight.headline}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <TrendBadge trend={insight.latest_trend} />
                              {insight.last_evaluated && (
                                <span className="flex items-center gap-1 text-[10px] text-slate-400">
                                  <Clock className="w-2.5 h-2.5" />
                                  {timeAgo(insight.last_evaluated)}
                                </span>
                              )}
                            </div>
                          </div>
                          {snaps && snaps.length > 1 && (
                            <MiniSparkline snapshots={snaps} />
                          )}
                        </div>
                      </button>

                      {/* Expanded detail */}
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.15 }}
                          >
                            <div className="px-3 pb-3 border-t border-slate-100 dark:border-slate-800">
                              {insight.latest_change && (
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2 leading-relaxed">
                                  {insight.latest_change}
                                </p>
                              )}

                              {/* History timeline */}
                              {historyLoading === insight.id ? (
                                <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Loading history...
                                </div>
                              ) : snaps && snaps.length > 0 ? (
                                <div className="mt-2 space-y-1.5">
                                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                                    History ({snaps.length})
                                  </p>
                                  {snaps.slice(0, 5).map((s) => (
                                    <div
                                      key={s.id}
                                      className="flex items-center gap-2 text-[11px]"
                                    >
                                      <TrendBadge trend={s.trend} />
                                      <span className="text-slate-500 dark:text-slate-400 flex-1 truncate">
                                        {s.change_summary}
                                      </span>
                                      <span className="text-[10px] text-slate-400 flex-shrink-0">
                                        {timeAgo(s.evaluated_at)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {/* Actions */}
                              <div className="flex items-center gap-2 mt-3">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleArchive(insight.id);
                                  }}
                                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-amber-600 transition-colors"
                                >
                                  <Archive className="w-3 h-3" />
                                  Archive
                                </button>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleDelete(insight.id);
                                  }}
                                  className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-red-600 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  Remove
                                </button>
                              </div>
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })
              )}
        </div>
      )}
    </div>
  );
}
