import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Info,
  ThumbsUp,
  ThumbsDown,
  Tag,
  Send,
  Bookmark,
  Telescope,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { DashboardInsightItem } from "@/hooks/useDashboardInsights";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useNavigate } from "react-router-dom";
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

const BUCKET_STYLE = {
  critical: {
    label: "Immediate Action Required",
    gradient: "from-rose-500 to-red-600",
    border: "border-rose-200/70 dark:border-rose-800/50",
    badgeBg: "bg-rose-100 dark:bg-rose-900/40",
    badgeText: "text-rose-700 dark:text-rose-300",
    strip: "border-l-rose-500",
  },
  warning: {
    label: "Monitor Closely",
    gradient: "from-amber-400 to-orange-500",
    border: "border-amber-200/70 dark:border-amber-800/50",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-700 dark:text-amber-300",
    strip: "border-l-amber-400",
  },
  positive: {
    label: "Strategic Review",
    gradient: "from-blue-500 to-indigo-600",
    border: "border-blue-200/70 dark:border-blue-800/50",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40",
    badgeText: "text-blue-700 dark:text-blue-300",
    strip: "border-l-blue-500",
  },
  neutral: {
    label: "Informational",
    gradient: "from-slate-400 to-slate-500",
    border: "border-slate-200/70 dark:border-slate-700/50",
    badgeBg: "bg-slate-100 dark:bg-slate-800/50",
    badgeText: "text-slate-600 dark:text-slate-400",
    strip: "border-l-slate-300 dark:border-l-slate-600",
  },
} as const;

const FEEDBACK_TAGS = [
  { id: "inaccurate", label: "Inaccurate" },
  { id: "not_useful", label: "Not Useful" },
  { id: "misleading", label: "Misleading" },
  { id: "duplicate", label: "Duplicate" },
  { id: "great", label: "Great Insight" },
  { id: "actionable", label: "Actionable" },
];

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
  /** Callback to submit feedback (insightId, rating, tags?, comment?). When provided, thumbs are wired. */
  onSubmitFeedback?: (insightId: number, rating: 1 | -1, tags?: string[], comment?: string) => Promise<boolean | void>;
  /** Optional callback to refresh insights after mutations (delete, etc.). */
  onRefreshInsights?: () => Promise<void>;
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
  onRefreshInsights,
  dateFilter = "ytd",
  selectedTenantId,
}: DashboardInsightsStripProps) {
  const [evidenceModalInsight, setEvidenceModalInsight] = useState<DashboardInsightItem | null>(null);
  /** When true, show InsightDetailModal first; on 404 fall back to DashboardInsightEvidenceModal. */
  const [useDetailModalFirst, setUseDetailModalFirst] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const isBusy = loading || generating;
  const { isPlatformStaff } = useAuth();
  const isAdmin = isPlatformStaff();
  const navigate = useNavigate();

  type TrackedInsightRow = { id: string; source_insight_id?: number | null; source_type?: string | null; status?: string };
  const [trackedMap, setTrackedMap] = useState<Map<number, string>>(new Map());

  const fetchTrackedMap = useMemo(() => {
    return async (bustCache = false) => {
      if (bustCache) api.invalidateCacheFor("/insights/tracked");
      const data = ((await api.getTrackedInsights(selectedTenantId)) || []) as TrackedInsightRow[];
      const map = new Map<number, string>();
      for (const row of data) {
        if (row.status === "active" && row.source_type === "dashboard_insights" && row.source_insight_id != null) {
          map.set(row.source_insight_id, row.id);
        }
      }
      return map;
    };
  }, [selectedTenantId]);

  useEffect(() => {
    fetchTrackedMap().then(setTrackedMap).catch(() => {});
  }, [fetchTrackedMap]);

  // Auto-rotate through insights every 8 seconds when collapsed and not busy
  useEffect(() => {
    if (isExpanded || isBusy || insights.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % insights.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [isExpanded, isBusy, insights.length]);

  // Reset active index when insights change
  useEffect(() => {
    setActiveIdx(0);
  }, [insights.length]);

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
          <div className="flex items-center gap-2">
            {/* Carousel controls when there are multiple insights and not busy */}
            {!isBusy && insights.length > 1 && (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setActiveIdx((prev) => (prev - 1 + insights.length) % insights.length)}
                  className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                  aria-label="Previous insight"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums min-w-[28px] text-center">
                  {activeIdx + 1}/{insights.length}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveIdx((prev) => (prev + 1) % insights.length)}
                  className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                  aria-label="Next insight"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsExpanded((prev) => !prev)}
                  className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                >
                  {isExpanded ? "Collapse" : "Show all"}
                </button>
              </div>
            )}
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
            {!isExpanded ? (
              <AnimatePresence mode="wait">
                {insights[activeIdx] && (
                  <motion.div
                    key={insights[activeIdx].id ?? activeIdx}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25 }}
                  >
                    <InsightCard
                      insight={insights[activeIdx]}
                      onShowInsight={onShowInsight}
                      onOpenEvidence={() => {
                        setEvidenceModalInsight(insights[activeIdx]);
                        setUseDetailModalFirst(true);
                      }}
                      showFeedback={showFeedback && !!insights[activeIdx].id}
                      onSubmitFeedback={onSubmitFeedback}
                      onRefreshInsights={onRefreshInsights}
                      selectedTenantId={selectedTenantId}
                      isAdmin={isAdmin}
                      isTracked={(id) => (id != null ? trackedMap.has(id) : false)}
                      onToggleTrack={async (insightId) => {
                        if (!insightId) return;
                        const currentlyTracked = trackedMap.has(insightId);
                        setTrackedMap((prev) => {
                          const next = new Map(prev);
                          if (currentlyTracked) next.delete(insightId);
                          else next.set(insightId, "pending");
                          return next;
                        });
                        try {
                          if (currentlyTracked) {
                            let trackedId = trackedMap.get(insightId);
                            if (!trackedId || trackedId === "pending") {
                              const fresh = await fetchTrackedMap(true);
                              trackedId = fresh.get(insightId);
                            }
                            if (trackedId && trackedId !== "pending") {
                              await api.deleteTrackedInsight(trackedId, selectedTenantId);
                            }
                          } else {
                            await api.trackInsight(
                              {
                                headline: insights[activeIdx].headline,
                                understory: insights[activeIdx].understory,
                                metric_signature: { sql: "", keyFields: [] },
                                source_insight_id: insightId,
                                source_type: "dashboard_insights",
                              },
                              selectedTenantId
                            );
                          }
                          const fresh = await fetchTrackedMap(true);
                          setTrackedMap(fresh);
                        } catch {
                          const fresh = await fetchTrackedMap(true).catch(() => null);
                          if (fresh) setTrackedMap(fresh);
                        }
                      }}
                      onDeepDive={async (insightId) => {
                        if (!insightId) return;
                        const canvas = await api.createWorkbenchCanvasFromDashboardInsight(insightId, selectedTenantId);
                        if (canvas?.id) navigate(`/my-dashboard/${canvas.id}`);
                      }}
                      onRemoveInsight={async (insightId) => {
                        if (!insightId) return;
                        await api.deleteDashboardInsight(insightId, selectedTenantId);
                        await onRefreshInsights?.();
                      }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            ) : (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
                className="space-y-2"
              >
                {insights.map((insight, idx) => (
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
                    onRefreshInsights={onRefreshInsights}
                    selectedTenantId={selectedTenantId}
                    isAdmin={isAdmin}
                    isTracked={(id) => (id != null ? trackedMap.has(id) : false)}
                    onToggleTrack={async (insightId) => {
                      if (!insightId) return;
                      const currentlyTracked = trackedMap.has(insightId);
                      setTrackedMap((prev) => {
                        const next = new Map(prev);
                        if (currentlyTracked) next.delete(insightId);
                        else next.set(insightId, "pending");
                        return next;
                      });
                      try {
                        if (currentlyTracked) {
                          let trackedId = trackedMap.get(insightId);
                          if (!trackedId || trackedId === "pending") {
                            const fresh = await fetchTrackedMap(true);
                            trackedId = fresh.get(insightId);
                          }
                          if (trackedId && trackedId !== "pending") {
                            await api.deleteTrackedInsight(trackedId, selectedTenantId);
                          }
                        } else {
                          await api.trackInsight(
                            {
                              headline: insight.headline,
                              understory: insight.understory,
                              metric_signature: { sql: "", keyFields: [] },
                              source_insight_id: insightId,
                              source_type: "dashboard_insights",
                            },
                            selectedTenantId
                          );
                        }
                        const fresh = await fetchTrackedMap(true);
                        setTrackedMap(fresh);
                      } catch {
                        const fresh = await fetchTrackedMap(true).catch(() => null);
                        if (fresh) setTrackedMap(fresh);
                      }
                    }}
                    onDeepDive={async (insightId) => {
                      if (!insightId) return;
                      const canvas = await api.createWorkbenchCanvasFromDashboardInsight(insightId, selectedTenantId);
                      if (canvas?.id) navigate(`/my-dashboard/${canvas.id}`);
                    }}
                    onRemoveInsight={async (insightId) => {
                      if (!insightId) return;
                      await api.deleteDashboardInsight(insightId, selectedTenantId);
                      await onRefreshInsights?.();
                    }}
                  />
                ))}
              </motion.div>
            )}
          </div>
        )}
      </div>

      <InsightDetailModal
        isOpen={!!evidenceModalInsight && useDetailModalFirst}
        onClose={handleCloseEvidenceModal}
        insightSource="dashboard_insights"
        insightMessage={evidenceModalInsight?.headline ?? ""}
        insightId={evidenceModalInsight?.id}
        dateFilter={
          evidenceModalInsight?.filter_context?.datePeriod &&
          typeof evidenceModalInsight.filter_context.datePeriod === "string"
            ? String(evidenceModalInsight.filter_context.datePeriod).toLowerCase()
            : dateFilter
        }
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
  selectedTenantId,
  isAdmin,
  isTracked,
  onToggleTrack,
  onDeepDive,
  onRemoveInsight,
}: {
  insight: DashboardInsightItem;
  onShowInsight?: (insight: DashboardInsightItem) => void;
  onOpenEvidence?: () => void;
  showFeedback: boolean;
  onSubmitFeedback?: (insightId: number, rating: 1 | -1, tags?: string[], comment?: string) => Promise<boolean | void>;
  onRefreshInsights?: () => Promise<void>;
  selectedTenantId?: string | null;
  isAdmin: boolean;
  isTracked?: (insightId: number | undefined) => boolean;
  onToggleTrack?: (insightId: number | undefined) => Promise<void>;
  onDeepDive?: (insightId: number | undefined) => Promise<void>;
  onRemoveInsight?: (insightId: number | undefined) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = SENTIMENT_ICON[insight.sentiment] ?? Info;
  const iconClass = SENTIMENT_STYLE[insight.sentiment] ?? SENTIMENT_STYLE.neutral;
  const bucket = BUCKET_STYLE[insight.sentiment] ?? BUCKET_STYLE.neutral;

  const [feedbackMap, setFeedbackMap] = useState<Record<number, { rating: -1 | 1; submitted: boolean }>>({});
  const [feedbackPopoverInsightId, setFeedbackPopoverInsightId] = useState<number | null>(null);
  const [feedbackTags, setFeedbackTags] = useState<string[]>([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  const insightId = insight.id;
  const insightFeedback = insightId ? feedbackMap[insightId] : null;
  const isPopoverOpen = insightId != null && feedbackPopoverInsightId === insightId;

  const handleQuickRating = async (rating: -1 | 1) => {
    if (!insightId) return;
    setFeedbackMap((prev) => ({ ...prev, [insightId]: { rating, submitted: false } }));
    setFeedbackPopoverInsightId(insightId);
    setFeedbackTags([]);
    setFeedbackComment("");
  };

  const handleSubmitFeedback = async () => {
    if (!insightId) return;
    const entry = feedbackMap[insightId];
    if (!entry) return;
    setFeedbackSubmitting(true);
    try {
      if (onSubmitFeedback) {
        const ok = await onSubmitFeedback(insightId, entry.rating, feedbackTags, feedbackComment);
        if (ok !== false) {
          setFeedbackMap((prev) => ({ ...prev, [insightId]: { ...prev[insightId], submitted: true } }));
        }
      } else {
        await api.submitDashboardInsightFeedback(insightId, entry.rating, feedbackTags, feedbackComment, selectedTenantId);
        setFeedbackMap((prev) => ({ ...prev, [insightId]: { ...prev[insightId], submitted: true } }));
      }
    } finally {
      setFeedbackSubmitting(false);
      setFeedbackPopoverInsightId(null);
      setFeedbackTags([]);
      setFeedbackComment("");
    }
  };

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
        "rounded-lg border bg-white dark:bg-slate-900/50 p-3 text-left cursor-pointer border-l-4",
        bucket.border,
        bucket.strip
      )}
      onClick={() => setExpanded((e) => !e)}
      onKeyDown={(e) => e.key === "Enter" && setExpanded((e) => !e)}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
    >
      <div className="flex items-start gap-2">
        <div className={cn("w-6 h-6 rounded-md bg-gradient-to-br flex items-center justify-center shadow-sm", bucket.gradient)}>
          <Icon className={cn("w-3 h-3 text-white")} aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn("inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold leading-none", bucket.badgeBg, bucket.badgeText)}>
              {bucket.label}
            </span>
            <span className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
              Dashboard Insight
            </span>
          </div>
          <div className="mt-1 flex items-start gap-2">
            <p className="text-sm font-medium text-slate-900 dark:text-white flex-1 min-w-0">
              {insight.headline}
            </p>

            {insightId != null && (
              <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                {/* Bookmark */}
                {onToggleTrack && (
                  <button
                    type="button"
                    onClick={() => onToggleTrack(insightId)}
                    className={cn(
                      "p-1 rounded-md transition-all hover:bg-amber-100 dark:hover:bg-amber-900/30",
                      isTracked?.(insightId) ? "bg-amber-100 dark:bg-amber-900/30" : ""
                    )}
                    title={isTracked?.(insightId) ? "Remove from watchlist" : "Track this insight"}
                  >
                    <Bookmark
                      className={cn(
                        "w-3 h-3",
                        isTracked?.(insightId)
                          ? "text-amber-500 fill-amber-500 dark:text-amber-400 dark:fill-amber-400"
                          : "text-slate-400 hover:text-amber-600 dark:hover:text-amber-400"
                      )}
                      strokeWidth={2}
                    />
                  </button>
                )}

                {/* Feedback (thumbs + popover) */}
                {showFeedback && (
                  <Popover
                    open={isPopoverOpen}
                    onOpenChange={(open) => {
                      if (!open) {
                        setFeedbackPopoverInsightId(null);
                        setFeedbackTags([]);
                        setFeedbackComment("");
                      }
                    }}
                  >
                    <PopoverAnchor asChild>
                      <div className="flex items-center gap-0.5" aria-label="Feedback" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className={cn(
                            "p-1 rounded-md transition-all",
                            insightFeedback?.rating === 1
                              ? "bg-green-100 dark:bg-green-900/40"
                              : "hover:bg-green-100 dark:hover:bg-green-900/30"
                          )}
                          title="Good insight"
                          onClick={() => handleQuickRating(1)}
                        >
                          <ThumbsUp
                            className={cn(
                              "w-3 h-3",
                              insightFeedback?.rating === 1
                                ? "text-green-600 dark:text-green-400 fill-current"
                                : "text-slate-400 hover:text-green-600 dark:hover:text-green-400"
                            )}
                            strokeWidth={2}
                          />
                        </button>
                        <button
                          type="button"
                          className={cn(
                            "p-1 rounded-md transition-all",
                            insightFeedback?.rating === -1
                              ? "bg-red-100 dark:bg-red-900/40"
                              : "hover:bg-red-100 dark:hover:bg-red-900/30"
                          )}
                          title="Bad insight"
                          onClick={() => handleQuickRating(-1)}
                        >
                          <ThumbsDown
                            className={cn(
                              "w-3 h-3",
                              insightFeedback?.rating === -1
                                ? "text-red-600 dark:text-red-400 fill-current"
                                : "text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                            )}
                            strokeWidth={2}
                          />
                        </button>
                      </div>
                    </PopoverAnchor>

                    <PopoverContent
                      align="end"
                      sideOffset={6}
                      className="w-72 p-3 space-y-2.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                          <Tag className="w-3 h-3" />
                          Optional tags & comment
                        </span>
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full",
                            insightFeedback?.rating === 1
                              ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                              : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                          )}
                        >
                          {insightFeedback?.rating === 1 ? <ThumbsUp className="w-2.5 h-2.5" /> : <ThumbsDown className="w-2.5 h-2.5" />}
                          {insightFeedback?.rating === 1 ? "Good" : "Bad"}
                        </span>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {FEEDBACK_TAGS.map((tag) => {
                          const active = feedbackTags.includes(tag.id);
                          return (
                            <button
                              key={tag.id}
                              type="button"
                              onClick={() =>
                                setFeedbackTags((prev) => (active ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]))
                              }
                              className={cn(
                                "px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors",
                                active
                                  ? "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                                  : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                              )}
                            >
                              {tag.label}
                            </button>
                          );
                        })}
                      </div>

                      <textarea
                        value={feedbackComment}
                        onChange={(e) => setFeedbackComment(e.target.value)}
                        placeholder="Optional note..."
                        className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2.5 py-1.5 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                        rows={2}
                      />

                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setFeedbackPopoverInsightId(null);
                            setFeedbackTags([]);
                            setFeedbackComment("");
                          }}
                          className="px-2.5 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                        >
                          Skip
                        </button>
                        <button
                          type="button"
                          onClick={handleSubmitFeedback}
                          disabled={feedbackSubmitting}
                          className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
                        >
                          <Send className="w-3 h-3" />
                          {feedbackSubmitting ? "Sending..." : "Submit"}
                        </button>
                      </div>
                    </PopoverContent>
                  </Popover>
                )}

                {/* Deep dive */}
                {isAdmin && onDeepDive && (
                  <button
                    type="button"
                    onClick={() => onDeepDive(insightId)}
                    className="p-1 rounded-md hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-all"
                    title="Deep dive in Workbench"
                  >
                    <Telescope className="w-3 h-3 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400" strokeWidth={2} />
                  </button>
                )}

                {/* Remove */}
                {isAdmin && onRemoveInsight && (
                  <button
                    type="button"
                    onClick={() => onRemoveInsight(insightId)}
                    className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
                    title="Remove this insight"
                  >
                    <X className="w-3.5 h-3.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400" strokeWidth={2} />
                  </button>
                )}
              </div>
            )}
          </div>
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
        </div>
      </div>
    </div>
  );
}
