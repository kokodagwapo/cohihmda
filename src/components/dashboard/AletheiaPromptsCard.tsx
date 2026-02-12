import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Zap,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ChevronLeft,
  MessageSquare,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  ChevronsDownUp,
  ChevronsUpDown,
  RotateCw,
  Plus,
  X,
  ThumbsUp,
  ThumbsDown,
  MessageSquareText,
  Send,
  Tag,
} from "lucide-react";
import { useAletheiaData, AletheiaInsight } from "@/hooks/useAletheiaData";
import { useAuth } from "@/contexts/AuthContext";
import { CohiBriefingControl } from "@/components/aletheia/CohiBriefingControl";
import { InsightDetailModal } from "./InsightDetailModal";
import { ExportShareMenu } from "@/components/common/ExportShareMenu";
import type { ExportData } from "@/utils/exportUtils";

// ============================================================================
// Bucket configuration
// ============================================================================

interface BucketConfig {
  id: string;
  label: string;
  icon: React.ElementType;
  gradient: string;
  borderColor: string;
  bgColor: string;
  bgColorDark: string;
  iconColor: string;
  badgeBg: string;
  badgeText: string;
  dotColor: string;
  stripColor: string;
  emptyMessage: string;
}

const BUCKET_ORDER: BucketConfig[] = [
  {
    id: "critical",
    label: "Critical",
    icon: AlertCircle,
    gradient: "from-rose-500 to-red-600",
    borderColor: "border-rose-200/70 dark:border-rose-800/50",
    bgColor: "bg-rose-50/60",
    bgColorDark: "dark:bg-rose-950/20",
    iconColor: "text-rose-600 dark:text-rose-400",
    badgeBg: "bg-rose-100 dark:bg-rose-900/40",
    badgeText: "text-rose-700 dark:text-rose-300",
    dotColor: "bg-rose-500",
    stripColor: "border-l-rose-500",
    emptyMessage: "No critical issues detected",
  },
  {
    id: "attention",
    label: "Needs Attention",
    icon: AlertTriangle,
    gradient: "from-amber-400 to-orange-500",
    borderColor: "border-amber-200/70 dark:border-amber-800/50",
    bgColor: "bg-amber-50/60",
    bgColorDark: "dark:bg-amber-950/20",
    iconColor: "text-amber-600 dark:text-amber-400",
    badgeBg: "bg-amber-100 dark:bg-amber-900/40",
    badgeText: "text-amber-700 dark:text-amber-300",
    dotColor: "bg-amber-400",
    stripColor: "border-l-amber-400",
    emptyMessage: "Nothing flagged for attention",
  },
  {
    id: "working",
    label: "What's Working",
    icon: CheckCircle2,
    gradient: "from-blue-500 to-indigo-600",
    borderColor: "border-blue-200/70 dark:border-blue-800/50",
    bgColor: "bg-blue-50/60",
    bgColorDark: "dark:bg-blue-950/20",
    iconColor: "text-blue-600 dark:text-blue-400",
    badgeBg: "bg-blue-100 dark:bg-blue-900/40",
    badgeText: "text-blue-700 dark:text-blue-300",
    dotColor: "bg-blue-500",
    stripColor: "border-l-blue-500",
    emptyMessage: "No standout performance flagged",
  },
  {
    id: "context",
    label: "Context & Trends",
    icon: TrendingUp,
    gradient: "from-slate-400 to-slate-500",
    borderColor: "border-slate-200/70 dark:border-slate-700/50",
    bgColor: "bg-slate-50/60",
    bgColorDark: "dark:bg-slate-900/30",
    iconColor: "text-slate-500 dark:text-slate-400",
    badgeBg: "bg-slate-100 dark:bg-slate-800/50",
    badgeText: "text-slate-600 dark:text-slate-400",
    dotColor: "bg-slate-400",
    stripColor: "border-l-slate-300 dark:border-l-slate-600",
    emptyMessage: "No contextual trends available",
  },
];

// ============================================================================
// Props
// ============================================================================

interface AletheiaPromptsCardProps {
  dateFilter: "today" | "mtd" | "ytd" | "custom";
  onDataAvailabilityChange?: (hasData: boolean) => void;
  onOpenCohiPanel?: () => void;
  briefingContext?: {
    dialogues?: Array<{ message: string; type: string; priority: string }>;
    funnelStory?: {
      conversionRates: any;
      falloutData: any;
      lostRevenue: any;
    };
    userName?: string;
  };
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

// ============================================================================
// Bucket Lane sub-component — shows one insight at a time, auto-rotates,
// expandable to show all insights in the section
// ============================================================================

// ============================================================================
// Feedback tags
// ============================================================================
const FEEDBACK_TAGS = [
  { id: "inaccurate", label: "Inaccurate" },
  { id: "not_useful", label: "Not Useful" },
  { id: "misleading", label: "Misleading" },
  { id: "duplicate", label: "Duplicate" },
  { id: "great", label: "Great Insight" },
  { id: "actionable", label: "Actionable" },
];

interface BucketLaneProps {
  config: BucketConfig;
  insights: AletheiaInsight[];
  onInsightClick: (insight: AletheiaInsight) => void;
  isDrillable: (insight: AletheiaInsight) => boolean;
  /** When non-null, overrides the local expanded state (driven by parent "Expand All / Collapse All"). */
  globalExpanded?: boolean | null;
  /** Bumped each time the global toggle fires, ensuring the effect re-runs even if the boolean value stays the same. */
  expandToggleKey?: number;
  /** Admin-only: refresh this bucket */
  onRefreshBucket?: () => Promise<void>;
  /** Admin-only: generate more insights for this bucket (appends) */
  onGenerateMore?: () => Promise<void>;
  /** Admin-only: delete a single insight */
  onDeleteInsight?: (insightId: number) => Promise<void>;
  /** Admin-only: submit feedback on an insight */
  onSubmitFeedback?: (insightId: number, rating: -1 | 1, tags?: string[], comment?: string) => Promise<boolean>;
  /** Whether the user is a platform admin */
  isAdmin?: boolean;
}

function BucketLane({
  config,
  insights,
  onInsightClick,
  isDrillable,
  globalExpanded,
  expandToggleKey,
  onRefreshBucket,
  onGenerateMore,
  onDeleteInsight,
  onSubmitFeedback,
  isAdmin,
}: BucketLaneProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedInsightIdx, setSelectedInsightIdx] = useState<number | null>(
    null
  );
  const [isPaused, setIsPaused] = useState(false);
  const [isBucketRefreshing, setIsBucketRefreshing] = useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = useState(false);

  // Feedback state: tracks ratings per insight in this session
  const [feedbackMap, setFeedbackMap] = useState<Record<number, { rating: -1 | 1; submitted: boolean }>>({});
  // Which insight currently has the feedback popover open
  const [feedbackPopoverInsightId, setFeedbackPopoverInsightId] = useState<number | null>(null);
  const [feedbackTags, setFeedbackTags] = useState<string[]>([]);
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const feedbackPopoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (feedbackPopoverRef.current && !feedbackPopoverRef.current.contains(e.target as Node)) {
        setFeedbackPopoverInsightId(null);
        setFeedbackTags([]);
        setFeedbackComment("");
      }
    };
    if (feedbackPopoverInsightId !== null) {
      document.addEventListener("mousedown", handler);
    }
    return () => document.removeEventListener("mousedown", handler);
  }, [feedbackPopoverInsightId]);

  // Handle quick thumbs click
  const handleQuickRating = useCallback(async (insightId: number, rating: -1 | 1) => {
    // Set optimistic state
    setFeedbackMap(prev => ({ ...prev, [insightId]: { rating, submitted: false } }));
    // Open popover for optional tags/comment
    setFeedbackPopoverInsightId(insightId);
    setFeedbackTags([]);
    setFeedbackComment("");
  }, []);

  // Submit full feedback (with optional tags + comment)
  const handleSubmitFeedback = useCallback(async (insightId: number) => {
    const entry = feedbackMap[insightId];
    if (!entry || !onSubmitFeedback) return;
    setFeedbackSubmitting(true);
    const success = await onSubmitFeedback(insightId, entry.rating, feedbackTags, feedbackComment);
    if (success) {
      setFeedbackMap(prev => ({ ...prev, [insightId]: { ...prev[insightId], submitted: true } }));
    }
    setFeedbackSubmitting(false);
    setFeedbackPopoverInsightId(null);
    setFeedbackTags([]);
    setFeedbackComment("");
  }, [feedbackMap, feedbackTags, feedbackComment, onSubmitFeedback]);

  // Sync local expanded state when parent toggles "Expand All / Collapse All"
  useEffect(() => {
    if (globalExpanded !== undefined && globalExpanded !== null) {
      setIsExpanded(globalExpanded);
      if (!globalExpanded) setSelectedInsightIdx(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalExpanded, expandToggleKey]);

  // Auto-rotate through insights every 8 seconds (only when collapsed & not paused)
  useEffect(() => {
    if (isExpanded || isPaused || insights.length <= 1) return;
    const timer = setInterval(() => {
      setActiveIdx((prev) => (prev + 1) % insights.length);
    }, 8000);
    return () => clearInterval(timer);
  }, [isExpanded, isPaused, insights.length]);

  // Reset active index when insights change
  useEffect(() => {
    setActiveIdx(0);
    setSelectedInsightIdx(null);
  }, [insights.length]);

  const goNext = () =>
    setActiveIdx((prev) => (prev + 1) % insights.length);
  const goPrev = () =>
    setActiveIdx((prev) => (prev - 1 + insights.length) % insights.length);

  const BucketIcon = config.icon;
  const current = insights[activeIdx];

  // Render a single insight row
  const renderInsightRow = (
    insight: AletheiaInsight,
    idx: number,
    showUnderstory: boolean
  ) => {
    const canDrill = isDrillable(insight);
    const isSelected = selectedInsightIdx === idx;

    const insightFeedback = insight.insightId ? feedbackMap[insight.insightId] : null;
    const isPopoverOpen = feedbackPopoverInsightId === insight.insightId;

    return (
      <div
        key={idx}
        className="group/insight cursor-pointer relative"
        onClick={() => {
          if (isSelected && canDrill) {
            onInsightClick(insight);
          } else {
            setSelectedInsightIdx(isSelected ? null : idx);
          }
        }}
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        <div className="flex items-start gap-2">
          <p className="flex-1 text-[13px] sm:text-sm text-slate-900 dark:text-white font-medium leading-snug">
            {insight.headline || insight.message}
          </p>
          {/* Admin feedback + delete buttons */}
          {isAdmin && insight.insightId && (
            <div className="flex-shrink-0 flex items-center gap-0.5 opacity-0 group-hover/insight:opacity-100 transition-all">
              {/* Thumbs Up */}
              {onSubmitFeedback && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQuickRating(insight.insightId!, 1);
                  }}
                  className={`p-1 rounded-md transition-all ${
                    insightFeedback?.rating === 1
                      ? "bg-green-100 dark:bg-green-900/40 opacity-100"
                      : "hover:bg-green-100 dark:hover:bg-green-900/30"
                  }`}
                  title="Good insight"
                >
                  <ThumbsUp
                    className={`w-3 h-3 ${
                      insightFeedback?.rating === 1
                        ? "text-green-600 dark:text-green-400 fill-current"
                        : "text-slate-400 hover:text-green-600 dark:hover:text-green-400"
                    }`}
                    strokeWidth={2}
                  />
                </button>
              )}
              {/* Thumbs Down */}
              {onSubmitFeedback && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleQuickRating(insight.insightId!, -1);
                  }}
                  className={`p-1 rounded-md transition-all ${
                    insightFeedback?.rating === -1
                      ? "bg-red-100 dark:bg-red-900/40 opacity-100"
                      : "hover:bg-red-100 dark:hover:bg-red-900/30"
                  }`}
                  title="Bad insight"
                >
                  <ThumbsDown
                    className={`w-3 h-3 ${
                      insightFeedback?.rating === -1
                        ? "text-red-600 dark:text-red-400 fill-current"
                        : "text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                    }`}
                    strokeWidth={2}
                  />
                </button>
              )}
              {/* Delete button */}
              {onDeleteInsight && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteInsight(insight.insightId!);
                  }}
                  className="p-1 rounded-md hover:bg-red-100 dark:hover:bg-red-900/30 transition-all"
                  title="Remove this insight"
                >
                  <X className="w-3.5 h-3.5 text-red-400 hover:text-red-600 dark:text-red-500 dark:hover:text-red-400" strokeWidth={2} />
                </button>
              )}
            </div>
          )}
        </div>

        {/* Feedback popover — appears after thumbs click */}
        <AnimatePresence>
          {isAdmin && isPopoverOpen && insight.insightId && (
            <motion.div
              ref={feedbackPopoverRef}
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full mt-1 z-30 w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg p-3 space-y-2.5"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                  <Tag className="w-3 h-3" />
                  Optional tags & comment
                </span>
                <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                  insightFeedback?.rating === 1
                    ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                    : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                }`}>
                  {insightFeedback?.rating === 1 ? <ThumbsUp className="w-2.5 h-2.5" /> : <ThumbsDown className="w-2.5 h-2.5" />}
                  {insightFeedback?.rating === 1 ? "Good" : "Bad"}
                </span>
              </div>
              {/* Tags */}
              <div className="flex flex-wrap gap-1.5">
                {FEEDBACK_TAGS.map((tag) => {
                  const isActive = feedbackTags.includes(tag.id);
                  return (
                    <button
                      key={tag.id}
                      onClick={() =>
                        setFeedbackTags((prev) =>
                          isActive ? prev.filter((t) => t !== tag.id) : [...prev, tag.id]
                        )
                      }
                      className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${
                        isActive
                          ? "bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                          : "bg-slate-50 dark:bg-slate-700/50 border-slate-200 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700"
                      }`}
                    >
                      {tag.label}
                    </button>
                  );
                })}
              </div>
              {/* Comment */}
              <textarea
                value={feedbackComment}
                onChange={(e) => setFeedbackComment(e.target.value)}
                placeholder="Optional note..."
                className="w-full text-xs rounded-md border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 px-2.5 py-1.5 text-slate-700 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-400 resize-none"
                rows={2}
              />
              {/* Submit */}
              <div className="flex justify-end gap-2">
                <button
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
                  onClick={() => handleSubmitFeedback(insight.insightId!)}
                  disabled={feedbackSubmitting}
                  className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-medium rounded-md bg-blue-500 hover:bg-blue-600 text-white transition-colors disabled:opacity-50"
                >
                  <Send className="w-3 h-3" />
                  {feedbackSubmitting ? "Sending..." : "Submit"}
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {isSelected && (insight.understory || insight.reasoning) && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
            >
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
                {insight.understory || insight.reasoning}
              </p>
              {canDrill && (
                <span className="inline-flex items-center gap-0.5 mt-1.5 text-[11px] text-blue-500 dark:text-blue-400 font-medium">
                  View details
                  <ChevronRight className="w-3 h-3" />
                </span>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  };

  return (
    <div
      className={`rounded-2xl border ${config.borderColor} ${config.bgColor} ${config.bgColorDark} backdrop-blur-sm overflow-hidden`}
    >
      {/* Bucket header */}
      <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2.5">
          <div
            className={`w-6 h-6 rounded-md bg-gradient-to-br ${config.gradient} flex items-center justify-center shadow-sm`}
          >
            <BucketIcon className="w-3 h-3 text-white" strokeWidth={2} />
          </div>
          <h4 className="text-[13px] font-semibold text-slate-800 dark:text-slate-200 tracking-tight">
            {config.label}
          </h4>
          {insights.length > 1 && (
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${config.badgeBg} ${config.badgeText}`}
            >
              {insights.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Prev / Next (collapsed mode, multiple insights) */}
          {!isExpanded && insights.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev();
                }}
                className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                aria-label="Previous insight"
              >
                <ChevronLeft className="w-3.5 h-3.5 text-slate-400" />
              </button>
              <span className="text-[10px] text-slate-400 dark:text-slate-500 tabular-nums min-w-[28px] text-center">
                {activeIdx + 1}/{insights.length}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  goNext();
                }}
                className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
                aria-label="Next insight"
              >
                <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </>
          )}
          {/* Expand / Collapse toggle */}
          {insights.length > 1 && (
            <button
              onClick={() => {
                setIsExpanded((prev) => !prev);
                setSelectedInsightIdx(null);
              }}
              className="ml-1 px-2 py-0.5 rounded-md text-[10px] font-medium text-slate-500 dark:text-slate-400 hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors"
            >
              {isExpanded ? "Collapse" : "Show all"}
            </button>
          )}
          {/* Admin controls */}
          {isAdmin && (
            <div className="flex items-center gap-0.5 ml-1">
              {/* Generate more (append) */}
              {onGenerateMore && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isGeneratingMore) return;
                    setIsGeneratingMore(true);
                    try {
                      await onGenerateMore();
                    } finally {
                      setIsGeneratingMore(false);
                    }
                  }}
                  disabled={isGeneratingMore || isBucketRefreshing}
                  className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50"
                  title={`Generate additional ${config.label} insights`}
                >
                  <Plus
                    className={`w-3.5 h-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ${
                      isGeneratingMore ? "animate-pulse" : ""
                    }`}
                    strokeWidth={2}
                  />
                </button>
              )}
              {/* Refresh (replace) */}
              {onRefreshBucket && (
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (isBucketRefreshing) return;
                    setIsBucketRefreshing(true);
                    try {
                      await onRefreshBucket();
                    } finally {
                      setIsBucketRefreshing(false);
                    }
                  }}
                  disabled={isBucketRefreshing || isGeneratingMore}
                  className="p-1 rounded-md hover:bg-white/60 dark:hover:bg-slate-800/60 transition-colors disabled:opacity-50"
                  title={`Regenerate ${config.label} insights`}
                >
                  <RotateCw
                    className={`w-3.5 h-3.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 ${
                      isBucketRefreshing ? "animate-spin" : ""
                    }`}
                    strokeWidth={2}
                  />
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="px-4 pb-3.5">
        {!isExpanded ? (
          /* ---- Single insight view with crossfade ---- */
          current && (
            <AnimatePresence mode="wait">
              <motion.div
                key={activeIdx}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.25 }}
              >
                {renderInsightRow(current, activeIdx, false)}
              </motion.div>
            </AnimatePresence>
          )
        ) : (
          /* ---- Expanded: all insights stacked ---- */
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            className="space-y-3"
          >
            {insights.map((insight, idx) => (
              <div
                key={idx}
                className={`rounded-lg px-3 py-2.5 border-l-4 ${config.stripColor} bg-white/70 dark:bg-slate-800/50 border border-white/60 dark:border-slate-700/40`}
              >
                {renderInsightRow(insight, idx, false)}
              </div>
            ))}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Main component
// ============================================================================

export const AletheiaPromptsCard = React.memo(function AletheiaPromptsCard({
  dateFilter,
  onDataAvailabilityChange,
  onOpenCohiPanel,
  briefingContext,
  selectedTenantId,
  selectedChannel,
}: AletheiaPromptsCardProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInsight, setSelectedInsight] =
    useState<AletheiaInsight | null>(null);
  // Global expand/collapse state: null = uncontrolled (each lane manages itself),
  // true = all expanded, false = all collapsed. Resets to null on individual lane toggle.
  const [globalExpanded, setGlobalExpanded] = useState<boolean | null>(null);
  // Counter to force re-trigger the effect in BucketLane even when toggling the same value
  const [expandToggleKey, setExpandToggleKey] = useState(0);

  // Auth context — admin controls only shown for platform staff
  const { isPlatformStaff } = useAuth();
  const isAdmin = isPlatformStaff();

  // Data hook
  const {
    allInsights,
    insightsLoading,
    insightsError,
    funnelData,
    metadata,
    needsGeneration,
    refreshInsights,
    refreshBucket,
    generateMoreInsights,
    deleteInsight,
    submitFeedback,
  } = useAletheiaData(
    dateFilter,
    onDataAvailabilityChange,
    selectedTenantId,
    selectedChannel
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refreshInsights();
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshInsights]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId?: string | null }>)
        .detail;
      if (!detail?.tenantId || detail.tenantId === selectedTenantId) {
        refreshInsights();
      }
    };
    window.addEventListener("cohi-demo-seeded", handler as EventListener);
    return () =>
      window.removeEventListener("cohi-demo-seeded", handler as EventListener);
  }, [refreshInsights, selectedTenantId]);

  // Drill-down logic
  const drillableSources = useMemo(
    () => [
      "predictions",
      "credit_risk",
      "lost_opportunity",
      "pipeline",
      "performance",
      "comparisons",
      "closing_risk",
      "lock_expiration",
      "trid",
      "margin",
      "condition_backlog",
      "tiering",
    ],
    []
  );

  const handleInsightClick = useCallback(
    (insight: AletheiaInsight) => {
      if (insight.source && drillableSources.includes(insight.source)) {
        setSelectedInsight(insight);
        setIsModalOpen(true);
      }
    },
    [drillableSources]
  );

  const isDrillable = useCallback(
    (insight: AletheiaInsight) => {
      return !!(insight.source && drillableSources.includes(insight.source));
    },
    [drillableSources]
  );

  // Group insights by bucket
  const bucketedInsights = useMemo(() => {
    const map: Record<string, AletheiaInsight[]> = {
      critical: [],
      attention: [],
      working: [],
      context: [],
    };

    for (const insight of allInsights) {
      const bucket = insight.bucket || "context"; // default untagged to context
      if (map[bucket]) {
        map[bucket].push(insight);
      } else {
        map.context.push(insight);
      }
    }
    return map;
  }, [allInsights]);

  // Count non-empty buckets for grid sizing
  const nonEmptyBuckets = useMemo(
    () => BUCKET_ORDER.filter((b) => bucketedInsights[b.id]?.length > 0),
    [bucketedInsights]
  );

  const hasInsights = allInsights.length > 0;

  return (
    <div className="mb-6 sm:mb-10 aletheia-prompts-card">
      <motion.div
        ref={sectionRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-4 sm:p-5 md:p-6 lg:p-8 border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
      >
        {/* ===== Header ===== */}
        <div className="flex items-center justify-between mb-5 sm:mb-6 md:mb-8">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 dark:shadow-blue-600/15 ring-1 ring-white/20">
              <Zap
                className="w-5 h-5 sm:w-6 sm:h-6 text-white"
                strokeWidth={1.5}
              />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight">
                Cohi Insights
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                <span>Executive briefing</span>
                {metadata?.usedLLM && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100/80 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-[10px] sm:text-xs font-medium">
                    <Sparkles className="w-3 h-3" />
                    AI
                  </span>
                )}
                {hasInsights && (
                  <span className="text-slate-400 dark:text-slate-500">
                    {allInsights.length} insights
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {/* Expand All / Collapse All toggle */}
            {hasInsights && nonEmptyBuckets.length > 1 && (
              <button
                onClick={() => {
                  const next = globalExpanded === true ? false : true;
                  setGlobalExpanded(next);
                  setExpandToggleKey((k) => k + 1);
                }}
                className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors border border-slate-200/60 dark:border-slate-700/50"
                title={globalExpanded === true ? "Collapse all sections" : "Expand all sections"}
              >
                {globalExpanded === true ? (
                  <>
                    <ChevronsDownUp className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Collapse All
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="w-3.5 h-3.5" strokeWidth={1.5} />
                    Expand All
                  </>
                )}
              </button>
            )}
            <ExportShareMenu
              title="Cohi Insights"
              targetRef={sectionRef}
              getExportData={(): ExportData => ({
                title: "Cohi Insights",
                tables: [
                  {
                    name: "Insights",
                    headers: [
                      "Bucket",
                      "Headline",
                      "Detail",
                      "Source",
                      "Severity",
                    ],
                    rows: allInsights.map((insight) => [
                      insight.bucket || "--",
                      insight.headline || insight.message || "--",
                      insight.understory || insight.reasoning || "--",
                      insight.source || "--",
                      insight.severity_score?.toFixed(2) || "--",
                    ]),
                  },
                ],
              })}
              shareTarget={{
                type: "cohi-insights",
                tenantId: selectedTenantId || undefined,
                label: "Cohi Insights",
              }}
            />
            <button
              onClick={handleRefresh}
              disabled={insightsLoading || isRefreshing}
              className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
              title="Refresh insights"
            >
              <RefreshCw
                className={`w-4 h-4 text-slate-500 dark:text-slate-400 ${
                  isRefreshing ? "animate-spin" : ""
                }`}
                strokeWidth={1.5}
              />
            </button>
            <button
              onClick={() => onOpenCohiPanel?.()}
              className="p-2 rounded-lg transition-colors hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
              title="Ask Cohi"
            >
              <MessageSquare className="w-4 h-4" strokeWidth={1.5} />
            </button>
            <CohiBriefingControl
              briefingContext={briefingContext}
              tenantId={selectedTenantId}
            />
          </div>
        </div>

        {/* ===== Loading shimmer ===== */}
        {insightsLoading && !hasInsights && (
          <div className="flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-slate-100/80 dark:bg-slate-800/40 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* ===== Needs Generation CTA ===== */}
        {!insightsLoading && needsGeneration && !hasInsights && (
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-8 text-center">
            <div className="flex flex-col items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Sparkles className="w-7 h-7 text-white" strokeWidth={1.5} />
              </div>
              <div>
                <p className="text-base font-medium text-slate-800 dark:text-slate-200">
                  Ready to generate insights
                </p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                  Cohi will analyze your data across 4 categories using AI
                </p>
              </div>
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white text-sm font-medium shadow-lg shadow-blue-500/20 hover:shadow-blue-500/30 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
              >
                {isRefreshing ? (
                  <>
                    <RefreshCw
                      className="w-4 h-4 animate-spin"
                      strokeWidth={1.5}
                    />
                    Generating insights...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" strokeWidth={1.5} />
                    Generate Insights
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* ===== Empty state (no data at all) ===== */}
        {!insightsLoading && !needsGeneration && !hasInsights && (
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-6 text-center">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Insights will appear once live data is available for this tenant.
            </p>
          </div>
        )}

        {/* ===== Generating overlay ===== */}
        {isRefreshing && hasInsights && (
          <div className="mb-4 flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-blue-50/80 dark:bg-blue-950/30 border border-blue-200/60 dark:border-blue-800/40">
            <RefreshCw
              className="w-3.5 h-3.5 text-blue-500 animate-spin"
              strokeWidth={2}
            />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">
              Regenerating insights...
            </span>
          </div>
        )}

        {/* ===== Bucket Lanes (stacked) ===== */}
        {hasInsights && (
          <div className="flex flex-col gap-4">
            {BUCKET_ORDER.map((bucket) => {
              const items = bucketedInsights[bucket.id] || [];
              if (items.length === 0) return null;
              return (
                <BucketLane
                  key={bucket.id}
                  config={bucket}
                  insights={items}
                  onInsightClick={handleInsightClick}
                  isDrillable={isDrillable}
                  globalExpanded={globalExpanded}
                  expandToggleKey={expandToggleKey}
                  onRefreshBucket={
                    isAdmin
                      ? () => refreshBucket(bucket.id)
                      : undefined
                  }
                  onGenerateMore={
                    isAdmin
                      ? () => generateMoreInsights(bucket.id)
                      : undefined
                  }
                  onDeleteInsight={
                    isAdmin ? deleteInsight : undefined
                  }
                  onSubmitFeedback={
                    isAdmin ? submitFeedback : undefined
                  }
                  isAdmin={isAdmin}
                />
              );
            })}
          </div>
        )}
      </motion.div>

      {/* Insight Detail Modal */}
      <InsightDetailModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setSelectedInsight(null);
        }}
        insightSource={selectedInsight?.source || ""}
        insightMessage={selectedInsight?.message || ""}
        insightId={selectedInsight?.insightId}
        dateFilter={dateFilter}
        selectedTenantId={selectedTenantId}
      />
    </div>
  );
});
