import { useState, useEffect, useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Zap, Pin } from 'lucide-react';
import { useAletheiaData, AletheiaInsight } from '@/hooks/useAletheiaData';
import { AletheiaBriefingControls } from '@/components/aletheia/AletheiaBriefingControls';

export const AletheiaPromptsCard = ({
  dateFilter,
  onDataAvailabilityChange,
  briefingContext,
  selectedTenantId
}: {
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom';
  onDataAvailabilityChange?: (hasData: boolean) => void;
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
}) => {
  const [currentSet, setCurrentSet] = useState(0);
  const [expandedInsight, setExpandedInsight] = useState<number | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [pinnedInsights, setPinnedInsights] = useState<Set<string>>(new Set());
  
  // Use custom hook for data fetching
  const { allInsights, insightsLoading, insightsError, funnelData } = useAletheiaData(
    dateFilter,
    onDataAvailabilityChange,
    selectedTenantId
  );

  // Create unique ID for each insight based on message content (must be defined before useMemo)
  const getInsightId = useCallback((insight: AletheiaInsight, index: number) => {
    return `${dateFilter}-${index}-${insight.message.substring(0, 50)}`;
  }, [dateFilter]);

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

  // Rotate through sets every 6 seconds - pause when user is interacting
  useEffect(() => {
    if (isPaused || insightSets.length === 0) return;
    const interval = setInterval(() => {
      setCurrentSet((prev) => (prev + 1) % insightSets.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [isPaused, insightSets.length]);

  // Toggle pin/unpin insight
  const togglePin = (insight: typeof allInsights[0], index: number) => {
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

  // Render the component
  return (
    <div className="mb-6 sm:mb-10">
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative overflow-hidden rounded-xl sm:rounded-2xl md:rounded-3xl bg-gradient-to-br from-white to-slate-50/50 dark:from-slate-900/50 dark:to-slate-900/30 p-3 sm:p-4 md:p-6 lg:p-8 shadow-lg border-[0.5px] border-slate-200/40 dark:border-slate-800/40"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4 sm:mb-5 md:mb-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-[0_4px_12px_rgba(59,130,246,0.25)] dark:shadow-[0_4px_12px_rgba(59,130,246,0.15)]">
              <Zap className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 sm:mb-1 tracking-[-0.02em] leading-[1.05]">
                Ailethia Insights
              </h3>
              <p className="text-[10px] sm:text-xs md:text-sm lg:text-base text-slate-600 dark:text-slate-400 font-light tracking-tight">
                Executive Briefing
              </p>
            </div>
          </div>
          {/* Briefing Controls - Right side of header */}
          <div className="flex items-center">
            <AletheiaBriefingControls 
              briefingContext={briefingContext}
            />
          </div>
        </div>

        {/* Pinned Insights */}
        {pinnedInsightsList.length > 0 && (
          <div className="mb-4 sm:mb-5 md:mb-6 space-y-2 sm:space-y-3">
            {pinnedInsightsList.map((insight, idx) => {
              const insightId = getInsightId(insight, allInsights.indexOf(insight));
              const InsightIcon = insight.icon;
              return (
                <motion.div
                  key={insightId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3 }}
                  className="p-3 sm:p-4 rounded-lg sm:rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      insight.type === 'success' ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                      insight.type === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30' :
                      insight.type === 'error' ? 'bg-rose-100 dark:bg-rose-900/30' :
                      'bg-blue-100 dark:bg-blue-900/30'
                    }`}>
                      <InsightIcon className={`w-4 h-4 ${
                        insight.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                        insight.type === 'warning' ? 'text-amber-600 dark:text-amber-400' :
                        insight.type === 'error' ? 'text-rose-600 dark:text-rose-400' :
                        'text-blue-600 dark:text-blue-400'
                      }`} strokeWidth={1.5} />
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
                      onClick={() => togglePin(insight, allInsights.indexOf(insight))}
                      className="ml-2 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                      aria-label="Unpin insight"
                    >
                      <Pin className="w-4 h-4 text-blue-600 dark:text-blue-400" strokeWidth={2} />
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
              const globalIdx = unpinnedInsights.findIndex(i => i === insight) + (currentSet * 3);
              const insightId = getInsightId(insight, globalIdx);
              const InsightIcon = insight.icon;
              return (
                <motion.div
                  key={insightId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, delay: idx * 0.1 }}
                  className="p-3 sm:p-4 rounded-lg sm:rounded-xl bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => setExpandedInsight(expandedInsight === globalIdx ? null : globalIdx)}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      insight.type === 'success' ? 'bg-emerald-100 dark:bg-emerald-900/30' :
                      insight.type === 'warning' ? 'bg-amber-100 dark:bg-amber-900/30' :
                      insight.type === 'error' ? 'bg-rose-100 dark:bg-rose-900/30' :
                      'bg-blue-100 dark:bg-blue-900/30'
                    }`}>
                      <InsightIcon className={`w-4 h-4 ${
                        insight.type === 'success' ? 'text-emerald-600 dark:text-emerald-400' :
                        insight.type === 'warning' ? 'text-amber-600 dark:text-amber-400' :
                        insight.type === 'error' ? 'text-rose-600 dark:text-rose-400' :
                        'text-blue-600 dark:text-blue-400'
                      }`} strokeWidth={1.5} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm sm:text-base text-slate-900 dark:text-white font-light leading-relaxed">
                        {insight.message}
                      </p>
                      {expandedInsight === globalIdx && insight.reasoning && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mt-2 font-light"
                        >
                          {insight.reasoning}
                        </motion.p>
                      )}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        togglePin(insight, globalIdx);
                      }}
                      className="ml-2 p-1.5 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors flex-shrink-0"
                      aria-label="Pin insight"
                    >
                      <Pin className="w-4 h-4 text-slate-400 dark:text-slate-500" strokeWidth={1.5} />
                    </button>
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
                    ? 'bg-blue-600 dark:bg-blue-400 w-6'
                    : 'bg-slate-300 dark:bg-slate-600'
                }`}
                aria-label={`Go to insight set ${idx + 1}`}
              />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
};
