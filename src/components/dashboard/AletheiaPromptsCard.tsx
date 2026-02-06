import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { motion } from "framer-motion";
import {
  Zap,
  Pin,
  RefreshCw,
  Sparkles,
  ChevronRight,
  MessageSquare,
} from "lucide-react";
import { useAletheiaData, AletheiaInsight } from "@/hooks/useAletheiaData";
import { CohiBriefingControl } from "@/components/aletheia/CohiBriefingControl";
import { Link } from "react-router-dom";
import { InsightDetailModal } from "./InsightDetailModal";
import { ExportShareMenu } from "@/components/common/ExportShareMenu";
import type { ExportData } from "@/utils/exportUtils";

interface AletheiaPromptsCardProps {
  dateFilter: "today" | "mtd" | "ytd" | "custom";
  onDataAvailabilityChange?: (hasData: boolean) => void;
  /** Called when user clicks "Ask Cohi" – opens the page-level Cohi panel */
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

export const AletheiaPromptsCard = React.memo(function AletheiaPromptsCard({
  dateFilter,
  onDataAvailabilityChange,
  onOpenCohiPanel,
  briefingContext,
  selectedTenantId,
  selectedChannel,
}: AletheiaPromptsCardProps) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const [currentSet, setCurrentSet] = useState(0);
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [pinnedInsights, setPinnedInsights] = useState<Set<string>>(new Set());
  // Modal state for insight details
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedInsight, setSelectedInsight] =
    useState<AletheiaInsight | null>(null);

  // Use custom hook for data fetching
  const {
    allInsights,
    insightsLoading,
    insightsError,
    funnelData,
    metadata,
    refreshInsights,
  } = useAletheiaData(
    dateFilter,
    onDataAvailabilityChange,
    selectedTenantId,
    selectedChannel
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Handle refresh with loading state
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    refreshInsights();
    // Reset after a short delay to show the animation
    setTimeout(() => setIsRefreshing(false), 1500);
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

  // Handle insight click to show detail modal
  const handleInsightClick = useCallback((insight: AletheiaInsight) => {
    // Only show modal for insights with drillable sources
    const drillableSources = [
      "predictions",
      "credit_risk",
      "lost_opportunity",
      "pipeline",
      "performance",
      "comparisons",
    ];
    if (insight.source && drillableSources.includes(insight.source)) {
      setSelectedInsight(insight);
      setIsModalOpen(true);
    }
  }, []);

  // Check if an insight is drillable
  const isDrillable = useCallback((insight: AletheiaInsight) => {
    const drillableSources = [
      "predictions",
      "credit_risk",
      "lost_opportunity",
      "pipeline",
      "performance",
      "comparisons",
    ];
    return insight.source && drillableSources.includes(insight.source);
  }, []);

  // Create unique ID for each insight based on message content (must be defined before useMemo)
  const getInsightId = useCallback(
    (insight: AletheiaInsight, index: number) => {
      return `${dateFilter}-${index}-${insight.message.substring(0, 50)}`;
    },
    [dateFilter]
  );

  // Group insights into sets of 3 with priority color coding (using useMemo to ensure consistent calculation)
  const unpinnedInsights = useMemo(() => {
    return allInsights.filter((insight, idx) => {
      const insightId = getInsightId(insight, idx);
      return !pinnedInsights.has(insightId);
    });
  }, [allInsights, pinnedInsights, getInsightId]);

  const insightSets = useMemo(() => {
    const sets = [];
    for (let i = 0; i < unpinnedInsights.length; i += 3) {
      sets.push(unpinnedInsights.slice(i, i + 3));
    }
    return sets;
  }, [unpinnedInsights]);

  // Get pinned insights in their original order
  const pinnedInsightsList = useMemo(() => {
    return allInsights.filter((insight, idx) => {
      const insightId = getInsightId(insight, idx);
      return pinnedInsights.has(insightId);
    });
  }, [allInsights, pinnedInsights, getInsightId]);

  // Get current set of insights for rotation
  const currentInsights = useMemo(() => {
    return insightSets[currentSet] || [];
  }, [insightSets, currentSet]);

  // Rotate through sets every 15 seconds - pause when user is interacting
  useEffect(() => {
    if (isPaused || insightSets.length === 0) return;
    const interval = setInterval(() => {
      setCurrentSet((prev) => (prev + 1) % insightSets.length);
    }, 15000); // 15 seconds per set for comfortable reading
    return () => clearInterval(interval);
  }, [isPaused, insightSets.length]);

  // Toggle pin/unpin insight
  const togglePin = (insight: (typeof allInsights)[0], index: number) => {
    const insightId = getInsightId(insight, index);
    setPinnedInsights((prev) => {
      const next = new Set(prev);
      if (next.has(insightId)) {
        next.delete(insightId);
      } else {
        next.add(insightId);
      }
      return next;
    });
  };

  // Render the component – 2026-style: glassmorphism, strategic minimalism, fluid typography
  return (
    <div className="mb-6 sm:mb-10 aletheia-prompts-card">
      <motion.div
        ref={sectionRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-4 sm:p-5 md:p-6 lg:p-8 border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
      >
        {/* Header */}
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
                <span className="text-slate-400 dark:text-slate-500">
                  {allInsights.length} insights
                </span>
              </p>
            </div>
          </div>
          {/* Briefing Controls and Refresh - Right side of header */}
          <div className="flex items-center gap-2">
            <ExportShareMenu
              title="Cohi Insights"
              targetRef={sectionRef}
              getExportData={(): ExportData => ({
                title: "Cohi Insights",
                tables: [
                  {
                    name: "Insights",
                    headers: ["Type", "Message", "Reasoning", "Source"],
                    rows: allInsights.map((insight) => [
                      insight.type || "--",
                      insight.message || "--",
                      insight.reasoning || "--",
                      insight.source || "--",
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
            {/* Documentation links hidden for now */}
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

        {!insightsLoading && allInsights.length === 0 && (
          <div className="rounded-2xl border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/40 backdrop-blur-sm p-5 text-sm text-slate-600 dark:text-slate-400">
            Insights will appear once live data is available for this tenant.
          </div>
        )}

        {/* Pinned Insights */}
        {pinnedInsightsList.length > 0 && (
          <div className="mb-4 sm:mb-5 md:mb-6 space-y-2 sm:space-y-3">
            {pinnedInsightsList.map((insight, idx) => {
              const insightId = getInsightId(
                insight,
                allInsights.indexOf(insight)
              );
              const InsightIcon = insight.icon;
              return (
                <motion.div
                  key={insightId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="p-4 rounded-2xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 shadow-sm"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        insight.type === "success"
                          ? "bg-emerald-100 dark:bg-emerald-900/30"
                          : insight.type === "warning"
                          ? "bg-amber-100 dark:bg-amber-900/30"
                          : insight.type === "error"
                          ? "bg-rose-100 dark:bg-rose-900/30"
                          : "bg-blue-100 dark:bg-blue-900/30"
                      }`}
                    >
                      <InsightIcon
                        className={`w-4 h-4 ${
                          insight.type === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : insight.type === "warning"
                            ? "text-amber-600 dark:text-amber-400"
                            : insight.type === "error"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-blue-600 dark:text-blue-400"
                        }`}
                        strokeWidth={1.5}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm sm:text-base text-slate-900 dark:text-white font-light leading-relaxed">
                        {insight.message}
                      </p>
                      {insight.reasoning && (
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-1 font-light">
                          {insight.reasoning}
                        </p>
                      )}
                    </div>
                    <button
                      onClick={() =>
                        togglePin(insight, allInsights.indexOf(insight))
                      }
                      className="ml-2 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                      aria-label="Unpin insight"
                    >
                      <Pin
                        className="w-4 h-4 text-blue-600 dark:text-blue-400"
                        strokeWidth={2}
                      />
                    </button>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Rotating Insights */}
        {currentInsights.length > 0 && (
          <motion.div
            key={currentSet}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.4 }}
            className="space-y-2 sm:space-y-3"
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => setIsPaused(false)}
          >
            {currentInsights.map((insight, idx) => {
              const globalIdx = allInsights.indexOf(insight);
              const insightId = getInsightId(insight, globalIdx);
              const InsightIcon = insight.icon;
              const canDrill = isDrillable(insight);
              return (
                <motion.div
                  key={insightId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.1 }}
                  className={`p-4 rounded-2xl bg-white/90 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/70 shadow-sm hover:shadow-md transition-all duration-200 ${
                    canDrill
                      ? "cursor-pointer hover:border-blue-300/80 dark:hover:border-blue-500/50"
                      : "cursor-default"
                  }`}
                  onClick={() => {
                    if (canDrill) {
                      handleInsightClick(insight);
                    } else {
                      setExpandedInsight(
                        expandedInsight === globalIdx ? null : globalIdx
                      );
                    }
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                        insight.type === "success"
                          ? "bg-emerald-100 dark:bg-emerald-900/30"
                          : insight.type === "warning"
                          ? "bg-amber-100 dark:bg-amber-900/30"
                          : insight.type === "error"
                          ? "bg-rose-100 dark:bg-rose-900/30"
                          : insight.type === "critical"
                          ? "bg-rose-100 dark:bg-rose-900/30"
                          : "bg-blue-100 dark:bg-blue-900/30"
                      }`}
                    >
                      <InsightIcon
                        className={`w-4 h-4 ${
                          insight.type === "success"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : insight.type === "warning"
                            ? "text-amber-600 dark:text-amber-400"
                            : insight.type === "error"
                            ? "text-rose-600 dark:text-rose-400"
                            : insight.type === "critical"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-blue-600 dark:text-blue-400"
                        }`}
                        strokeWidth={1.5}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm sm:text-base text-slate-900 dark:text-white font-light leading-relaxed">
                        {insight.message}
                      </p>
                      {expandedInsight === globalIdx && insight.reasoning && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-2 font-light"
                        >
                          {insight.reasoning}
                        </motion.p>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      {canDrill && (
                        <div
                          className="p-1.5 rounded-lg text-blue-500 dark:text-blue-400"
                          title="Click to view details"
                        >
                          <ChevronRight className="w-4 h-4" strokeWidth={1.5} />
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          togglePin(insight, globalIdx);
                        }}
                        className="p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                        aria-label="Pin insight"
                      >
                        <Pin
                          className="w-4 h-4 text-slate-400 dark:text-slate-500"
                          strokeWidth={1.5}
                        />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Pagination Dots */}
        {insightSets.length > 1 && (
          <div className="flex items-center justify-center gap-2 mt-4 sm:mt-5 md:mt-6">
            {insightSets.map((_, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentSet(idx)}
                className={`w-2 h-2 rounded-full transition-all ${
                  currentSet === idx
                    ? "bg-blue-600 dark:bg-blue-400 w-6"
                    : "bg-slate-300 dark:bg-slate-600"
                }`}
                aria-label={`Go to insight set ${idx + 1}`}
              />
            ))}
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
        dateFilter={dateFilter}
      />
    </div>
  );
});
