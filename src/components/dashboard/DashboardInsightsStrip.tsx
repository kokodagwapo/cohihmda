import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles, AlertCircle, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardInsightItem } from "@/hooks/useDashboardInsights";
import { DashboardInsightEvidenceModal } from "./DashboardInsightEvidenceModal";
import { InsightDetailModal } from "./InsightDetailModal";

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

export interface DashboardInsightsStripProps {
  insights: DashboardInsightItem[];
  onShowInsight?: (insight: DashboardInsightItem) => void;
  onGenerate?: () => void;
  loading?: boolean;
  /** When true, generate is in progress: show "Loading insights…" and hide the current list until new insights are loaded. */
  generating?: boolean;
  /** Error message from the last generate request; shown in the strip when set. */
  generateError?: string | null;
  /** Callback to clear generateError (e.g. when user dismisses or retries). */
  onClearGenerateError?: () => void;
  generatedAt?: string | null;
  showGenerateButton?: boolean;
  /** When true, show thumbs up/down for feedback (e.g. for tenant_admin) */
  showFeedback?: boolean;
  /** Callback to submit feedback (insightId, rating 1 | -1). When provided, thumbs are wired. */
  onSubmitFeedback?: (insightId: number, rating: 1 | -1) => Promise<void>;
  /** Date filter for details API (e.g. ytd, mtd). Defaults to ytd. */
  dateFilter?: string;
  /** Tenant id for details API. */
  selectedTenantId?: string | null;
}

export function DashboardInsightsStrip({
  insights,
  onShowInsight,
  onGenerate,
  loading,
  generating = false,
  generateError = null,
  onClearGenerateError,
  generatedAt,
  showGenerateButton,
  showFeedback = false,
  onSubmitFeedback,
  dateFilter = "ytd",
  selectedTenantId,
}: DashboardInsightsStripProps) {
  const [evidenceModalInsight, setEvidenceModalInsight] = useState<DashboardInsightItem | null>(null);
  /** When true, show InsightDetailModal first; on 404 fall back to DashboardInsightEvidenceModal. */
  const [useDetailModalFirst, setUseDetailModalFirst] = useState(true);
  const isBusy = loading || generating;

  const handleCloseEvidenceModal = () => {
    setEvidenceModalInsight(null);
    setUseDetailModalFirst(true);
  };

  if (insights.length === 0 && !showGenerateButton && !isBusy && !generateError) {
    return null;
  }

  return (
    <>
      <div className="rounded-xl border border-slate-200/80 dark:border-slate-700/80 bg-slate-50/50 dark:bg-slate-800/30 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500" aria-hidden />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Dashboard Insights
            </span>
            {generatedAt && !generating && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Generated {new Date(generatedAt).toLocaleDateString()}
              </span>
            )}
          </div>
          {showGenerateButton && onGenerate && (
            <Button
              variant="outline"
              size="sm"
              onClick={onGenerate}
              disabled={isBusy}
              className="text-xs"
            >
              {isBusy ? "Generating…" : "Generate Insights"}
            </Button>
          )}
        </div>

        {generateError ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50 px-3 py-2">
            <p className="text-sm text-red-700 dark:text-red-300">{generateError}</p>
            {onClearGenerateError && (
              <Button variant="ghost" size="sm" className="text-xs shrink-0" onClick={onClearGenerateError}>
                Dismiss
              </Button>
            )}
          </div>
        ) : isBusy ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Loading insights…</p>
        ) : (
          <div className="space-y-2">
            {insights.slice(0, 3).map((insight, idx) => (
              <InsightCard
                key={insight.id ?? idx}
                insight={insight}
                onShowInsight={onShowInsight}
                onOpenEvidence={() => {
                  setEvidenceModalInsight(insight);
                  setUseDetailModalFirst(true);
                }}
                showFeedback={showFeedback && !!insight.id}
                onSubmitFeedback={onSubmitFeedback}
              />
            ))}
          </div>
        )}
      </div>

      <InsightDetailModal
        isOpen={!!evidenceModalInsight && useDetailModalFirst}
        onClose={handleCloseEvidenceModal}
        insightSource="dashboard_insights"
        insightMessage={evidenceModalInsight?.headline ?? ""}
        insightId={evidenceModalInsight?.id}
        dateFilter={dateFilter}
        selectedTenantId={selectedTenantId}
        onDetailUnavailable={() => setUseDetailModalFirst(false)}
      />
      <DashboardInsightEvidenceModal
        isOpen={!!evidenceModalInsight && !useDetailModalFirst}
        onClose={handleCloseEvidenceModal}
        insight={evidenceModalInsight}
      />
    </>
  );
}

function InsightCard({
  insight,
  onShowInsight,
  onOpenEvidence,
  showFeedback,
  onSubmitFeedback,
}: {
  insight: DashboardInsightItem;
  onShowInsight?: (insight: DashboardInsightItem) => void;
  onOpenEvidence?: () => void;
  showFeedback: boolean;
  onSubmitFeedback?: (insightId: number, rating: 1 | -1) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<1 | -1 | null>(null);
  const Icon = SENTIMENT_ICON[insight.sentiment] ?? Info;
  const iconClass = SENTIMENT_STYLE[insight.sentiment] ?? SENTIMENT_STYLE.neutral;

  const hasEtm =
    insight.what_changed ||
    insight.why ||
    insight.business_impact ||
    insight.risk_if_ignored ||
    insight.recommended_action ||
    insight.owner;

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/50 p-3 text-left cursor-pointer"
      )}
      onClick={() => setExpanded((e) => !e)}
      onKeyDown={(e) => e.key === "Enter" && setExpanded((e) => !e)}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
    >
      <div className="flex items-start gap-2">
        <Icon className={cn("w-4 h-4 flex-shrink-0 mt-0.5", iconClass)} aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              Dashboard Insight
            </span>
          </div>
          <p className="text-sm font-medium text-slate-900 dark:text-white mt-1">
            {insight.headline}
          </p>
          {expanded && (
            <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
              <p className="font-medium text-slate-600 dark:text-slate-300">Why this matters</p>
              {hasEtm ? (
                <>
                  {insight.what_changed && (
                    <p><span className="font-medium text-slate-600 dark:text-slate-300">What changed:</span> {insight.what_changed}</p>
                  )}
                  {insight.why && (
                    <p><span className="font-medium text-slate-600 dark:text-slate-300">Why:</span> {insight.why}</p>
                  )}
                  {insight.business_impact && (
                    <p><span className="font-medium text-slate-600 dark:text-slate-300">Business impact:</span> {insight.business_impact}</p>
                  )}
                  {insight.risk_if_ignored && (
                    <p><span className="font-medium text-slate-600 dark:text-slate-300">Risk if ignored:</span> {insight.risk_if_ignored}</p>
                  )}
                  {insight.recommended_action && (
                    <p><span className="font-medium text-slate-600 dark:text-slate-300">Recommended action:</span> {insight.recommended_action}</p>
                  )}
                  {insight.owner && (
                    <p><span className="font-medium text-slate-600 dark:text-slate-300">Owner:</span> {insight.owner}</p>
                  )}
                </>
              ) : (
                <p className="text-slate-500 dark:text-slate-400">
                  {insight.understory || "No additional detail available for this insight."}
                </p>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
            {onShowInsight && (
              <Button
                variant="secondary"
                size="sm"
                className="h-7 text-xs"
                onClick={() => onShowInsight(insight)}
              >
                Show on dashboard
              </Button>
            )}
            {expanded && onOpenEvidence && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onOpenEvidence}
              >
                View evidence
              </Button>
            )}
            {expanded && (
              <button
                type="button"
                className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 flex items-center gap-0.5"
                onClick={(e) => {
                  e.stopPropagation();
                  setExpanded(false);
                }}
              >
                <ChevronDown className="w-3 h-3" />
                Less
              </button>
            )}
          </div>
          {showFeedback && insight.id && onSubmitFeedback && (
            <div className="mt-2 flex gap-1" aria-label="Feedback" onClick={(e) => e.stopPropagation()}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                title="Helpful"
                onClick={(e) => {
                  e.stopPropagation();
                  if (feedbackSent === null) {
                    setFeedbackSent(1);
                    onSubmitFeedback(insight.id!, 1);
                  }
                }}
                disabled={feedbackSent !== null}
              >
                👍
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                title="Not helpful"
                onClick={(e) => {
                  e.stopPropagation();
                  if (feedbackSent === null) {
                    setFeedbackSent(-1);
                    onSubmitFeedback(insight.id!, -1);
                  }
                }}
                disabled={feedbackSent !== null}
              >
                👎
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
