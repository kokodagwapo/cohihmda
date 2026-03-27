/**
 * TrackedInsightDetailModal
 *
 * Full detail view for a tracked insight. Shows:
 * - Current metric values as cards with formatting
 * - Recharts line chart of the primary metric over all snapshots
 * - Full history timeline with expandable snapshot detail
 * - Alert threshold configuration
 * - Actions: Archive, Untrack, pause/resume
 */

import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  Clock,
  Archive,
  Trash2,
  Bell,
  BellOff,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { api } from "@/lib/api";

// ============================================================================
// Types
// ============================================================================

interface AlertThreshold {
  field: string;
  operator: "gt" | "lt" | "gte" | "lte";
  value: number;
  triggered?: boolean;
  last_triggered_at?: string | null;
}

interface TrackedInsight {
  id: string;
  headline: string;
  understory: string;
  status: "active" | "resolved" | "archived";
  source_type: string;
  source_insight_id: number | null;
  tags: string[];
  created_at: string;
  updated_at: string;
  alert_threshold: AlertThreshold | null;
  metric_signature: { sql: string; keyFields: string[] } | null;
  display_metadata: {
    keyMetricDescriptions?: Record<string, string>;
    keyMetricFormats?: Record<string, string>;
  } | null;
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

interface TrackedInsightDetailModalProps {
  insight: TrackedInsight | null;
  isOpen: boolean;
  onClose: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  selectedTenantId?: string | null;
}

// ============================================================================
// Helpers
// ============================================================================

function formatMetricValue(
  key: string,
  value: any,
  formats?: Record<string, string>
): string {
  if (value === null || value === undefined) return "—";
  const format = formats?.[key];
  const num = parseFloat(value);
  if (isNaN(num)) return String(value);

  if (format === "currency" || key.includes("revenue") || key.includes("dollar") || key.includes("amount")) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(num);
  }
  if (format === "percent" || key.includes("rate") || key.includes("pct") || key.includes("percent")) {
    return `${num.toFixed(1)}%`;
  }
  if (format === "days" || key.includes("day") || key.includes("cycle") || key.includes("dwell")) {
    return `${num.toFixed(1)}d`;
  }
  if (Number.isInteger(num) || num > 100) {
    return num.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
  return num.toFixed(2);
}

function getDeltaDisplay(
  key: string,
  current: any,
  previous: any
): { text: string; positive: boolean } | null {
  const cur = parseFloat(current);
  const prev = parseFloat(previous);
  if (isNaN(cur) || isNaN(prev) || prev === 0) return null;
  const pct = ((cur - prev) / Math.abs(prev)) * 100;
  const positive = cur >= prev;
  return {
    text: `${positive ? "+" : ""}${pct.toFixed(1)}%`,
    positive,
  };
}

function TrendBadge({ trend }: { trend: string | null }) {
  if (!trend || trend === "new") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
        <Sparkles className="w-3 h-3" />
        New
      </span>
    );
  }
  if (trend === "improving") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
        <TrendingUp className="w-3 h-3" />
        Improving
      </span>
    );
  }
  if (trend === "worsening") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <TrendingDown className="w-3 h-3" />
        Worsening
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
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
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ============================================================================
// Alert Threshold Config
// ============================================================================

function AlertConfig({
  insight,
  onSave,
  tenantId,
}: {
  insight: TrackedInsight;
  onSave: (threshold: AlertThreshold | null) => void;
  tenantId?: string | null;
}) {
  const descriptions = insight.display_metadata?.keyMetricDescriptions || {};
  const formats = insight.display_metadata?.keyMetricFormats || {};
  const keyFields = insight.metric_signature?.keyFields || Object.keys(insight.latest_values || {}).filter((k) => !k.startsWith("_"));
  const existing = insight.alert_threshold;

  const [field, setField] = useState(existing?.field || keyFields[0] || "");
  const [operator, setOperator] = useState<"gt" | "lt" | "gte" | "lte">(existing?.operator || "gt");
  const [value, setValue] = useState(existing?.value?.toString() || "");
  const [saving, setSaving] = useState(false);

  // Human-readable label for a field key
  function fieldLabel(f: string): string {
    if (descriptions[f]) return descriptions[f];
    // Fallback: convert snake_case → Title Case
    return f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Unit hint for the value input placeholder
  function fieldUnit(f: string): string {
    const fmt = formats[f] || "";
    if (fmt === "currency") return "e.g. 1000000";
    if (fmt === "percent" || f.includes("pct") || f.includes("rate")) return "e.g. 25 (%)";
    if (fmt === "days" || f.includes("day") || f.includes("cycle")) return "e.g. 45 (days)";
    return "value";
  }

  const OPERATOR_LABELS: Record<string, string> = {
    gt: "rises above",
    lt: "falls below",
    gte: "reaches or exceeds",
    lte: "drops to or below",
  };

  const handleSave = async () => {
    if (!field || !value) return;
    setSaving(true);
    try {
      const threshold: AlertThreshold = { field, operator, value: parseFloat(value) };
      await api.updateTrackedInsight(insight.id, { alert_threshold: threshold }, tenantId);
      onSave(threshold);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await api.updateTrackedInsight(insight.id, { alert_threshold: null }, tenantId);
      onSave(null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      {/* Active alert banner */}
      {existing?.triggered && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50">
          <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
          <span className="text-xs text-red-700 dark:text-red-300">
            Alert triggered{existing.last_triggered_at ? ` ${timeAgo(existing.last_triggered_at)}` : ""}
          </span>
        </div>
      )}

      {/* Current alert rule summary */}
      {existing && !existing.triggered && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/40">
          <Bell className="w-3 h-3 text-blue-500 flex-shrink-0" />
          <span className="text-xs text-blue-700 dark:text-blue-300">
            Alert when <strong>{fieldLabel(existing.field)}</strong> {OPERATOR_LABELS[existing.operator] || existing.operator} <strong>{formatMetricValue(existing.field, existing.value, formats)}</strong>
          </span>
        </div>
      )}

      {/* Alert builder */}
      <p className="text-[10px] text-slate-400 dark:text-slate-500">Alert me when…</p>
      <div className="space-y-2">
        {/* Field selector */}
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          {keyFields.map((f) => (
            <option key={f} value={f}>{fieldLabel(f)}</option>
          ))}
        </select>

        {/* Operator + value on one row */}
        <div className="flex items-center gap-2">
          <select
            value={operator}
            onChange={(e) => setOperator(e.target.value as "gt" | "lt" | "gte" | "lte")}
            className="flex-1 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="gt">rises above</option>
            <option value="lt">falls below</option>
            <option value="gte">reaches or exceeds</option>
            <option value="lte">drops to or below</option>
          </select>
          <input
            type="number"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={fieldUnit(field)}
            className="w-32 text-xs rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 px-2.5 py-2 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-0.5">
          <button
            onClick={handleSave}
            disabled={saving || !field || !value}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bell className="w-3 h-3" />}
            {existing ? "Update Alert" : "Set Alert"}
          </button>
          {existing && (
            <button
              onClick={handleClear}
              disabled={saving}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md text-slate-500 hover:text-red-600 transition-colors"
            >
              <BellOff className="w-3 h-3" />
              Remove
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export function TrackedInsightDetailModal({
  insight,
  isOpen,
  onClose,
  onArchive,
  onDelete,
  selectedTenantId,
}: TrackedInsightDetailModalProps) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);
  const [expandedSnapshotId, setExpandedSnapshotId] = useState<string | null>(null);
  const [showAlertConfig, setShowAlertConfig] = useState(false);
  const [localInsight, setLocalInsight] = useState<TrackedInsight | null>(null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Sync local copy when insight prop changes
  useEffect(() => {
    setLocalInsight(insight);
    setSnapshots([]);
    setExpandedSnapshotId(null);
    setShowAlertConfig(false);
  }, [insight?.id]);

  // Load history when modal opens
  useEffect(() => {
    if (!isOpen || !insight?.id) return;
    setSnapshotsLoading(true);
    api.getTrackedInsightHistory(insight.id, 50, selectedTenantId)
      .then((data) => setSnapshots(data as Snapshot[]))
      .catch(console.error)
      .finally(() => setSnapshotsLoading(false));
  }, [isOpen, insight?.id, selectedTenantId]);

  const handleArchive = useCallback(async () => {
    if (!localInsight || archiving) return;
    setArchiving(true);
    try {
      await api.updateTrackedInsight(localInsight.id, { status: "archived" }, selectedTenantId);
      onArchive(localInsight.id);
      onClose();
    } finally {
      setArchiving(false);
    }
  }, [localInsight, archiving, selectedTenantId, onArchive, onClose]);

  const handleDelete = useCallback(async () => {
    if (!localInsight || deleting) return;
    setDeleting(true);
    try {
      await api.deleteTrackedInsight(localInsight.id, selectedTenantId);
      onDelete(localInsight.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  }, [localInsight, deleting, selectedTenantId, onDelete, onClose]);

  if (!localInsight) return null;

  const displayMeta = localInsight.display_metadata;
  const descriptions = displayMeta?.keyMetricDescriptions || {};
  const formats = displayMeta?.keyMetricFormats || {};
  const keyFields = localInsight.metric_signature?.keyFields || Object.keys(localInsight.latest_values || {}).filter((k) => !k.startsWith("_"));
  const currentValues = localInsight.latest_values || {};
  const prevValues = localInsight.latest_previous || {};

  // Build chart data — newest last
  const chartKey = keyFields.find((k) => {
    const v = parseFloat(currentValues[k]);
    return !isNaN(v);
  }) || keyFields[0];

  const chartData = snapshots
    .slice()
    .reverse()
    .map((s, i) => ({
      index: i + 1,
      label: new Date(s.evaluated_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      value: chartKey ? parseFloat(s.metric_values[chartKey]) : null,
    }))
    .filter((d) => d.value !== null && !isNaN(d.value as number));

  const alertTriggered = localInsight.alert_threshold?.triggered;
  const sourceTypeLabel = localInsight.source_type === "agent" ? "AI Agent" : localInsight.source_type === "pipeline" ? "Pipeline" : localInsight.source_type;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: "spring", duration: 0.3 }}
            className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* ===== Header ===== */}
            <div className="flex-shrink-0 px-6 pt-5 pb-4 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <TrendBadge trend={localInsight.latest_trend} />
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400">
                      {sourceTypeLabel}
                    </span>
                    {alertTriggered && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                        <AlertTriangle className="w-3 h-3" />
                        Alert Active
                      </span>
                    )}
                  </div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-white leading-snug">
                    {localInsight.headline}
                  </h2>
                  {localInsight.understory && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                      {localInsight.understory}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2">
                    {localInsight.last_evaluated && (
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        <Clock className="w-2.5 h-2.5" />
                        Evaluated {timeAgo(localInsight.last_evaluated)}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400">
                      Tracked {timeAgo(localInsight.created_at)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="flex-shrink-0 p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
            </div>

            {/* ===== Scrollable body ===== */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5 min-h-0">

              {/* Current metric values */}
              {keyFields.length > 0 && Object.keys(currentValues).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    Current Values
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {keyFields.map((k) => {
                      const val = currentValues[k];
                      const prev = prevValues[k];
                      if (val === undefined && val === null) return null;
                      const delta = prev !== undefined ? getDeltaDisplay(k, val, prev) : null;
                      const label = descriptions[k] || k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                      return (
                        <div
                          key={k}
                          className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/50 px-3 py-2.5"
                        >
                          <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mb-0.5">{label}</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {formatMetricValue(k, val, formats)}
                          </p>
                          {delta && (
                            <p className={`text-[10px] font-medium mt-0.5 ${delta.positive ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                              {delta.text} vs prev
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Latest change summary */}
              {localInsight.latest_change && (
                <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/40">
                  <CheckCircle2 className="w-3.5 h-3.5 text-slate-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                    {localInsight.latest_change}
                  </p>
                </div>
              )}

              {/* Trend chart */}
              {chartData.length >= 2 && (
                <div>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    Trend — {descriptions[chartKey] || chartKey}
                  </p>
                  <div className="h-40 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 9, fill: "rgb(148,163,184)" }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fontSize: 9, fill: "rgb(148,163,184)" }}
                          axisLine={false}
                          tickLine={false}
                          width={44}
                          tickFormatter={(v) => formatMetricValue(chartKey, v, formats)}
                        />
                        <Tooltip
                          contentStyle={{
                            fontSize: 11,
                            borderRadius: "8px",
                            border: "1px solid rgba(148,163,184,0.3)",
                            background: "rgba(15,23,42,0.9)",
                            color: "#e2e8f0",
                          }}
                          formatter={(v: any) => [formatMetricValue(chartKey, v, formats), descriptions[chartKey] || chartKey]}
                          labelStyle={{ color: "#94a3b8" }}
                        />
                        <Line
                          type="monotone"
                          dataKey="value"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          dot={{ r: 3, fill: "#3b82f6" }}
                          activeDot={{ r: 5 }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* History timeline */}
              <div>
                <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                  History {snapshots.length > 0 && `(${snapshots.length})`}
                </p>
                {snapshotsLoading ? (
                  <div className="flex items-center gap-2 text-xs text-slate-400 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Loading history...
                  </div>
                ) : snapshots.length === 0 ? (
                  <p className="text-xs text-slate-400 py-2">No history yet — will appear after the first evaluation.</p>
                ) : (
                  <div className="space-y-1.5">
                    {snapshots.map((snap) => {
                      const isExpanded = expandedSnapshotId === snap.id;
                      const numericFields = Object.keys(snap.metric_values).filter(
                        (k) => !k.startsWith("_") && !isNaN(parseFloat(snap.metric_values[k]))
                      );
                      return (
                        <div
                          key={snap.id}
                          className="rounded-lg border border-slate-100 dark:border-slate-800 overflow-hidden"
                        >
                          <button
                            onClick={() => setExpandedSnapshotId(isExpanded ? null : snap.id)}
                            className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                          >
                            <TrendBadge trend={snap.trend} />
                            <span className="flex-1 text-xs text-slate-600 dark:text-slate-400 line-clamp-1">
                              {snap.change_summary}
                            </span>
                            <span className="text-[10px] text-slate-400 flex-shrink-0">
                              {timeAgo(snap.evaluated_at)}
                            </span>
                            {numericFields.length > 0 && (
                              isExpanded ? (
                                <ChevronDown className="w-3 h-3 text-slate-400 flex-shrink-0" />
                              ) : (
                                <ChevronRight className="w-3 h-3 text-slate-400 flex-shrink-0" />
                              )
                            )}
                          </button>
                          <AnimatePresence>
                            {isExpanded && (
                              <motion.div
                                initial={{ height: 0 }}
                                animate={{ height: "auto" }}
                                exit={{ height: 0 }}
                                transition={{ duration: 0.15 }}
                                className="overflow-hidden"
                              >
                                <div className="px-3 pb-2.5 border-t border-slate-100 dark:border-slate-800 grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2">
                                  {numericFields.map((k) => (
                                    <div key={k} className="text-[10px]">
                                      <span className="text-slate-400 block">
                                        {descriptions[k] || k}
                                      </span>
                                      <span className="text-slate-700 dark:text-slate-200 font-medium">
                                        {formatMetricValue(k, snap.metric_values[k], formats)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Alert threshold */}
              <div>
                <button
                  onClick={() => setShowAlertConfig((prev) => !prev)}
                  className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                >
                  {showAlertConfig ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  Alert Threshold
                  {localInsight.alert_threshold && (
                    <span className="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 text-[9px] font-medium">
                      <Bell className="w-2.5 h-2.5" />
                      Set
                    </span>
                  )}
                </button>
                <AnimatePresence>
                  {showAlertConfig && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden mt-2"
                    >
                      <AlertConfig
                        insight={localInsight}
                        onSave={(threshold) => {
                          setLocalInsight((prev) => prev ? { ...prev, alert_threshold: threshold } : prev);
                        }}
                        tenantId={selectedTenantId}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ===== Footer actions ===== */}
            <div className="flex-shrink-0 flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/50">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleArchive}
                  disabled={archiving}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                >
                  {archiving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                  Archive
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-50"
                >
                  {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  Untrack
                </button>
              </div>
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-xs font-medium rounded-lg bg-slate-900 dark:bg-slate-700 text-white hover:bg-slate-700 dark:hover:bg-slate-600 transition-colors"
              >
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
