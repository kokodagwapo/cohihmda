import { motion, AnimatePresence } from "framer-motion";
import { X, AlertCircle, AlertTriangle, CheckCircle2, Info, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import type { DashboardInsightItem } from "@/hooks/useDashboardInsights";

/** Static map: widgetId -> label (matches leaderboard adapter widget catalog) */
const WIDGET_LABELS: Record<string, string> = {
  "leaderboard-main-table": "Leaderboard",
  "kpi-top-performer-units": "Top performer (units)",
  "kpi-top-performer-volume": "Top performer (volume)",
};

function getWidgetLabel(widgetId: string): string {
  return WIDGET_LABELS[widgetId] ?? widgetId;
}

const SENTIMENT_ICON = {
  critical: AlertCircle,
  warning: AlertTriangle,
  positive: CheckCircle2,
  neutral: Info,
};

const SENTIMENT_STYLE = {
  critical: "text-red-600 dark:text-red-400",
  warning: "text-amber-600 dark:text-amber-400",
  positive: "text-emerald-600 dark:text-emerald-400",
  neutral: "text-slate-500 dark:text-slate-400",
};

/** Insight shape that can come from the strip (DashboardInsightItem) or Aletheia (has same fields) */
export type DashboardInsightEvidenceModalInsight = Pick<
  DashboardInsightItem,
  | "headline"
  | "understory"
  | "sentiment"
  | "severity_score"
  | "what_changed"
  | "why"
  | "business_impact"
  | "risk_if_ignored"
  | "recommended_action"
  | "owner"
  | "sourcePageId"
  | "sourcePageName"
  | "filter_context"
> & {
  evidence_refs?: Array<{
    widgetId: string;
    role: string;
    target?: { type: string; label: string };
    /** When present, the actual data value from the widget (e.g. "12 units", "47%") */
    value?: string;
  }>;
  /** May be string[] or array of objects with value/label from API */
  cited_numbers?: unknown[];
  /** By-period metrics for evidence table (pull-through, units, volume per period) */
  supporting_data?: { byPeriod?: Array<{
    period: string;
    periodLabel?: string;
    averagePullThrough?: number;
    totalUnits?: number;
    totalVolume?: number;
    topPerformerName?: string;
    topPerformerUnits?: number;
    topPerformerVolume?: number;
  }> };
};

export interface DashboardInsightEvidenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  insight: DashboardInsightEvidenceModalInsight | null;
}

export function DashboardInsightEvidenceModal({
  isOpen,
  onClose,
  insight,
}: DashboardInsightEvidenceModalProps) {
  const navigate = useNavigate();

  const handleGoToPage = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!insight?.sourcePageId) return;
    const path = insight.sourcePageId ? `/insights#${insight.sourcePageId}` : "/insights";
    const state: Record<string, unknown> = {
      scrollToSection: insight.sourcePageId,
      ...(insight.filter_context
        ? { dashboardInsightFilterContext: insight.filter_context, sourcePageId: insight.sourcePageId }
        : {}),
    };
    navigate(path, { state });
    onClose();
  };

  if (!isOpen) return null;

  const Icon = insight ? (SENTIMENT_ICON[insight.sentiment] ?? Info) : Info;
  const iconClass = insight ? (SENTIMENT_STYLE[insight.sentiment] ?? SENTIMENT_STYLE.neutral) : SENTIMENT_STYLE.neutral;
  const hasEtm =
    insight &&
    (insight.what_changed || insight.why || insight.business_impact || insight.risk_if_ignored || insight.recommended_action || insight.owner);
  const refs = insight?.evidence_refs ?? [];
  const citedRaw = insight?.cited_numbers ?? [];

  /** Normalize cited items to display strings (API may return strings or objects). */
  const citedDisplay = (citedRaw as unknown[]).map((item: unknown): string => {
    if (typeof item === "string") return item;
    if (item != null && typeof item === "object") {
      const o = item as Record<string, unknown>;
      if (typeof o.value === "string") return o.value;
      if (typeof o.label === "string") return o.label;
      if (typeof o.period === "string" && typeof o.value !== "undefined") return `${o.value} (${o.period})`;
      return JSON.stringify(o);
    }
    return String(item);
  });

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-4xl max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-4 p-4 sm:p-6 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shrink-0">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                {insight && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold",
                      iconClass,
                      insight.sentiment === "critical" && "bg-red-50 dark:bg-red-900/20",
                      insight.sentiment === "warning" && "bg-amber-50 dark:bg-amber-900/20",
                      insight.sentiment === "positive" && "bg-emerald-50 dark:bg-emerald-900/20",
                      insight.sentiment === "neutral" && "bg-slate-100 dark:bg-slate-800"
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {insight.sentiment.charAt(0).toUpperCase() + insight.sentiment.slice(1)}
                  </span>
                )}
                <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                  Dashboard Insight
                </span>
              </div>
              <h2 className="mt-2 text-lg font-semibold text-slate-900 dark:text-white">
                {insight?.headline ?? "Evidence"}
              </h2>
              {insight?.sourcePageId && insight?.sourcePageName && (
                <button
                  type="button"
                  onClick={handleGoToPage}
                  className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors"
                >
                  Go to {insight.sourcePageName}
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 min-h-0">
            {insight?.understory && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">Summary</h3>
                <p className="text-sm text-slate-600 dark:text-slate-400">{insight.understory}</p>
              </section>
            )}

            {/* Why this matters (ETM) */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Why this matters</h3>
              {hasEtm ? (
                <div className="space-y-2 text-sm">
                  {insight!.what_changed && (
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">What changed:</span>{" "}
                      {insight!.what_changed}
                    </p>
                  )}
                  {insight!.why && (
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">Why:</span> {insight!.why}
                    </p>
                  )}
                  {insight!.business_impact && (
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">Business impact:</span>{" "}
                      {insight!.business_impact}
                    </p>
                  )}
                  {insight!.risk_if_ignored && (
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">Risk if ignored:</span>{" "}
                      {insight!.risk_if_ignored}
                    </p>
                  )}
                  {insight!.recommended_action && (
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">Recommended action:</span>{" "}
                      {insight!.recommended_action}
                    </p>
                  )}
                  {insight!.owner && (
                    <p>
                      <span className="font-medium text-slate-600 dark:text-slate-300">Owner:</span> {insight!.owner}
                    </p>
                  )}
                </div>
              ) : insight?.understory ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">{insight.understory}</p>
              ) : (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No additional detail available for this insight.
                </p>
              )}
            </section>

            {/* Evidence: by-period table + cited figures + source widgets */}
            {(citedDisplay.length > 0 || refs.length > 0 || (insight?.supporting_data?.byPeriod?.length ?? 0) > 0) && (
              <section>
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">Evidence</h3>
                <div className="space-y-3">
                  {insight?.supporting_data?.byPeriod && insight.supporting_data.byPeriod.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">Data by time period</p>
                      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="w-full text-sm text-left">
                          <thead>
                            <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/50">
                              <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Period</th>
                              {(insight.supporting_data.byPeriod.some((r) => r.averagePullThrough != null)) && (
                                <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Pull-through</th>
                              )}
                              {(insight.supporting_data.byPeriod.some((r) => r.totalUnits != null)) && (
                                <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Units</th>
                              )}
                              {(insight.supporting_data.byPeriod.some((r) => r.totalVolume != null)) && (
                                <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Volume</th>
                              )}
                              {(insight.supporting_data.byPeriod.some((r) => r.topPerformerName)) && (
                                <th className="px-3 py-2 font-semibold text-slate-700 dark:text-slate-300">Top performer</th>
                              )}
                            </tr>
                          </thead>
                          <tbody>
                            {insight.supporting_data.byPeriod.map((row, idx) => {
                              const showPullThrough = insight.supporting_data!.byPeriod!.some((r) => r.averagePullThrough != null);
                              const showUnits = insight.supporting_data!.byPeriod!.some((r) => r.totalUnits != null);
                              const showVolume = insight.supporting_data!.byPeriod!.some((r) => r.totalVolume != null);
                              const showTopPerformer = insight.supporting_data!.byPeriod!.some((r) => r.topPerformerName);
                              const fmtVol = (v: number) =>
                                v >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(1)}K` : `$${v}`;
                              return (
                                <tr key={idx} className="border-b border-slate-100 dark:border-slate-700/50 last:border-0">
                                  <td className="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">
                                    {row.periodLabel ?? row.period}
                                  </td>
                                  {showPullThrough && (
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                      {row.averagePullThrough != null ? `${row.averagePullThrough}%` : "—"}
                                    </td>
                                  )}
                                  {showUnits && (
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                      {row.totalUnits != null ? row.totalUnits : "—"}
                                    </td>
                                  )}
                                  {showVolume && (
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                      {row.totalVolume != null ? fmtVol(row.totalVolume) : "—"}
                                    </td>
                                  )}
                                  {showTopPerformer && (
                                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                                      {row.topPerformerName
                                        ? `${row.topPerformerName}${row.topPerformerUnits != null ? ` (${row.topPerformerUnits} units)` : row.topPerformerVolume != null ? ` (${fmtVol(row.topPerformerVolume)})` : ""}`
                                        : "—"}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                  {citedDisplay.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Supporting data</p>
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        The numbers in the summary are drawn from the dashboard for the time periods compared (e.g. MTD, last month, QTD).
                      </p>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-1">
                        Cited figures: {citedDisplay.join(", ")}
                      </p>
                    </div>
                  )}
                  {refs.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Source widgets</p>
                      <ul className="space-y-2">
                        {refs.map((ref, i) => {
                          const value = "value" in ref && typeof (ref as { value?: string }).value === "string"
                            ? (ref as { value: string }).value
                            : null;
                          return (
                            <li
                              key={i}
                              className="flex flex-col gap-0.5 text-sm text-slate-600 dark:text-slate-400"
                            >
                              <span className="font-medium text-slate-700 dark:text-slate-300">
                                {getWidgetLabel(ref.widgetId)}
                                {ref.target?.label ? ` · ${ref.target.label}` : ""}
                              </span>
                              {value ? (
                                <span className="text-slate-600 dark:text-slate-400">{value}</span>
                              ) : ref.target?.label ? (
                                <span className="text-slate-500 dark:text-slate-500 text-xs">
                                  {ref.target.type}: {ref.target.label}
                                </span>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
