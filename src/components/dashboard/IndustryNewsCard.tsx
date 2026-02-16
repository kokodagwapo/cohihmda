import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import {
  Newspaper,
  Building2,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Activity,
  AlertTriangle,
  Settings,
  Check,
  X,
  Zap,
  ExternalLink,
  Loader2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { ExportShareMenu } from "@/components/common/ExportShareMenu";

const OBMMI_WIDGET_URL = "https://www2.optimalblue.com/OBMMI/widgetConfig.php";

function MarketIntelligenceTicker() {
  const [obModalOpen, setObModalOpen] = useState(false);
  const RATE_INDICES = [
    { label: "30-Yr. Conforming", rate: 6.092, delta: 0.026, trend: "up" as const },
    { label: "30-Yr. Jumbo", rate: 6.263, delta: 0.017, trend: "up" as const },
    { label: "30-Yr. FHA", rate: 5.88, delta: -0.107, trend: "down" as const },
    { label: "30-Yr. VA", rate: 5.692, delta: 0.054, trend: "up" as const },
    { label: "30-Yr. USDA", rate: 6.035, delta: -0.027, trend: "down" as const },
    { label: "15-Yr. Conforming", rate: 5.378, delta: -0.034, trend: "down" as const },
  ];

  const renderSparkline = (trend: "up" | "down") => {
    const stroke = trend === "up" ? "#16a34a" : "#ef4444";
    const points =
      trend === "up"
        ? "0 9 6 6 12 8 18 4 24 6 30 2 36 4"
        : "0 3 6 6 12 4 18 8 24 6 30 9 36 7";
    return (
      <svg width="38" height="12" viewBox="0 0 38 12" aria-hidden="true">
        <polyline
          points={points}
          fill="none"
          stroke={stroke}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  };

  const tickerTooltip = "Click for details on Rate Indices, Credit and LTV, Rate Trends";

  return (
    <>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className="flex items-center w-full max-w-[920px] min-w-0 box-border mx-auto rounded-md overflow-hidden relative border border-slate-200/60 dark:border-slate-700/50 cursor-pointer"
              style={{ background: "rgba(243, 249, 252, 0.85)" }}
            >
              <div className="relative flex-1 min-w-0 h-10 sm:h-11 overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-[#f3f9fc] to-transparent pointer-events-none" />
          <div className="absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-[#f3f9fc] to-transparent pointer-events-none" />
          <div className="ticker-track">
            {[...RATE_INDICES, ...RATE_INDICES].map((item, idx) => {
              const isUp = item.trend === "up";
              return (
                <button
                  type="button"
                  key={`${item.label}-${idx}`}
                  onClick={() => setObModalOpen(true)}
                  className="flex items-center gap-3 px-6 h-full border-r border-slate-200/70 shrink-0 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors duration-150 text-left touch-manipulation focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400/30 rounded-none"
                  aria-label={`View rate details: ${item.label} ${item.rate.toFixed(3)}%`}
                >
                  <span className="text-[11px] sm:text-xs md:text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    {item.label}
                  </span>
                  {renderSparkline(item.trend)}
                  <span className="text-[11px] sm:text-xs md:text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    {item.rate.toFixed(3)}%
                  </span>
                  <span
                    className={`text-[10px] sm:text-[11px] md:text-[12px] font-medium ${
                      isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {isUp ? "+" : ""}
                    {item.delta.toFixed(3)}
                  </span>
                </button>
              );
            })}
          </div>
          <a
            href="https://www2.optimalblue.com/obmmi"
            target="_blank"
            rel="noopener noreferrer"
            className="absolute right-1 bottom-0.5 text-[8px] sm:text-[9px] text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/70 px-1 py-0.5 rounded-full border border-slate-200/60 dark:border-slate-700/50 backdrop-blur"
          >
            Powered by OBMMI
          </a>
          <style>{`
            @keyframes ticker-left {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
            .ticker-track {
              display: inline-flex;
              align-items: center;
              height: 100%;
              width: max-content;
              white-space: nowrap;
              animation: ticker-left 42s linear infinite;
              will-change: transform;
            }
          `}</style>
              </div>
            </div>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            className="max-w-[280px] text-center px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 shadow-lg"
          >
            {tickerTooltip}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* OBMMI widget modal – sized so 750×462 widget fits without scroll */}
      <Dialog open={obModalOpen} onOpenChange={setObModalOpen}>
        <DialogContent className="p-0 gap-0 w-[min(95vw,820px)] max-w-[820px] max-h-[85vh] sm:max-h-[90vh] overflow-hidden flex flex-col bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/50 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] [&>button]:right-4 [&>button]:top-4">
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200/60 dark:border-slate-700/50 bg-slate-50/50 dark:bg-slate-800/50">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm">
                  <TrendingUp className="w-4 h-4 text-white" strokeWidth={2} />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold text-slate-900 dark:text-white tracking-tight">
                    Mortgage Rate Index
                  </DialogTitle>
                  <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Optimal Blue OBMMI – live rates and indices
                  </DialogDescription>
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-0 p-4 sm:p-5 bg-slate-50/30 dark:bg-slate-800/30 flex flex-col">
              <div className="rounded-xl overflow-hidden border border-slate-200/60 dark:border-slate-700/50 bg-white dark:bg-slate-900 shadow-sm flex-1 min-h-0 flex flex-col">
                <iframe
                  src={OBMMI_WIDGET_URL}
                  title="Optimal Blue Mortgage Market Index (OBMMI)"
                  width="750"
                  height="462"
                  className="w-full flex-1 min-h-[462px] border-0 block"
                />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Industry News Card Component
 * Displays industry news from various sources (MBA, Fannie Mae, Freddie Mac, CFPB, FHFA)
 * with source selection, filtering, and detailed article views
 */
export const IndustryNewsCard = () => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [newsFeed, setNewsFeed] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);
  const [lastNewsUpdate, setLastNewsUpdate] = useState<Date | null>(null);
  const [selectedNewsItem, setSelectedNewsItem] = useState<{
    item: any;
    source: any;
  } | null>(null);
  const [showSourceSelector, setShowSourceSelector] = useState(false);

  // AI-powered insights state
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<{
    insights: Array<{
      type: string;
      label: string;
      content: string;
      color: string;
    }>;
    clientDataSummary?: string;
    error?: string;
  } | null>(null);
  // Initialize with government/GSE sources enabled by default
  // RSS feed sources (National Mortgage News, etc.) are disabled by default
  const defaultSources = ["MBA", "Fannie Mae", "Freddie Mac", "CFPB", "FHFA"];
  const [selectedSources, setSelectedSources] =
    useState<string[]>(defaultSources);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);

  // Load user preferences from database
  const loadUserPreferences = async () => {
    try {
      const preference = await api.request<{ preference_value: string[] }>(
        "/api/user/preferences/selectedNewsSources"
      );
      if (preference?.preference_value) {
        setSelectedSources(preference.preference_value);
        localStorage.setItem(
          "selectedNewsSources",
          JSON.stringify(preference.preference_value)
        );
      } else {
        // Fallback to localStorage
        const saved = localStorage.getItem("selectedNewsSources");
        if (saved) {
          const parsed = JSON.parse(saved);
          setSelectedSources(parsed);
          // Save to database for future use
          await saveUserPreferences(parsed);
        } else {
          // If no preferences exist, use all available sources
          setSelectedSources(defaultSources);
          await saveUserPreferences(defaultSources);
        }
      }
    } catch (error: any) {
      // For timeout errors, log as warning since we have localStorage fallback
      if (
        error.message?.includes("timed out") ||
        error.message?.includes("timeout")
      ) {
        console.warn(
          "User preferences request timed out, using localStorage fallback:",
          error.message
        );
      } else {
        console.error("Error loading user preferences:", error);
      }
      // Fallback to localStorage if not authenticated or preference not found
      const saved = localStorage.getItem("selectedNewsSources");
      if (saved) {
        setSelectedSources(JSON.parse(saved));
      } else {
        setSelectedSources(defaultSources);
        localStorage.setItem(
          "selectedNewsSources",
          JSON.stringify(defaultSources)
        );
      }
    } finally {
      setIsLoadingPreferences(false);
    }
  };

  // Save user preferences to database
  const saveUserPreferences = async (sources: string[]) => {
    try {
      // Save to localStorage immediately for instant access
      localStorage.setItem("selectedNewsSources", JSON.stringify(sources));

      // Save to database via API
      try {
        await api.request("/api/user/preferences/selectedNewsSources", {
          method: "PUT",
          body: JSON.stringify({ preference_value: sources }),
        });
      } catch (error: any) {
        // If not authenticated, just use localStorage
        if (error.message?.includes("Unauthorized")) {
          return;
        }
        throw error;
      }
    } catch (error) {
      console.error("Error saving user preferences:", error);
      // Still save to localStorage even if database save fails
      localStorage.setItem("selectedNewsSources", JSON.stringify(sources));
    }
  };

  // Load preferences on mount
  useEffect(() => {
    loadUserPreferences();
  }, []);

  // Available news sources - Government/GSE sites (enabled by default) + RSS feeds (disabled by default)
  const availableSources = [
    // Government/GSE sources - enabled by default
    {
      source: "MBA",
      icon: Building2,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/20",
      summary:
        "The Mortgage Bankers Association (MBA) is the leading trade association representing the real estate finance industry. MBA provides market analysis, economic forecasts, and industry insights.",
      items: [],
    },
    {
      source: "Fannie Mae",
      icon: TrendingUp,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/20",
      summary:
        "Fannie Mae provides comprehensive housing market research and economic forecasts. Their insights help lenders understand home price trends and housing supply dynamics.",
      items: [],
    },
    {
      source: "Freddie Mac",
      icon: BarChart3,
      color: "text-indigo-600 dark:text-indigo-400",
      bg: "bg-indigo-50 dark:bg-indigo-950/20",
      summary:
        "Freddie Mac provides market insights, economic research, and policy updates critical for mortgage lenders. Stay informed about GSE guidelines and market trends.",
      items: [],
    },
    {
      source: "CFPB",
      icon: AlertTriangle,
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-50 dark:bg-rose-950/20",
      summary:
        "The Consumer Financial Protection Bureau (CFPB) issues regulations and enforcement actions that directly impact mortgage lending operations. Critical for compliance.",
      items: [],
    },
    {
      source: "FHFA",
      icon: Activity,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/20",
      summary:
        "The Federal Housing Finance Agency (FHFA) regulates Fannie Mae, Freddie Mac, and the Federal Home Loan Banks. Their policy updates affect mortgage lending standards.",
      items: [],
    },
    // RSS feed sources - disabled by default
    {
      source: "National Mortgage News",
      icon: Newspaper,
      color: "text-orange-600 dark:text-orange-400",
      bg: "bg-orange-50 dark:bg-orange-950/20",
      summary:
        "National Mortgage News provides breaking news and analysis on mortgage rates, regulations, compliance, and industry trends that directly impact lending operations.",
      items: [],
    },
    {
      source: "Mortgage News Daily",
      icon: Newspaper,
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-50 dark:bg-cyan-950/20",
      summary:
        "Mortgage News Daily offers daily mortgage rate updates, MBS market commentary, and industry news essential for understanding market movements and rate trends.",
      items: [],
    },
    {
      source: "MND Rate Watch",
      icon: BarChart3,
      color: "text-pink-600 dark:text-pink-400",
      bg: "bg-pink-50 dark:bg-pink-950/20",
      summary:
        "Mortgage rate analysis and daily rate movements from Mortgage News Daily, helping lenders stay informed on rate lock timing and market volatility.",
      items: [],
    },
  ];

  // Default news feed structure (fallback) - filtered by selected sources
  const getDefaultNewsFeed = () => {
    return availableSources.filter((source) =>
      selectedSources.includes(source.source)
    );
  };

  // Fetch news from API
  const fetchNews = async () => {
    // Check if user has a valid token before making API call
    const token = localStorage.getItem("auth_token");
    if (!token) {
      // No token - use default news feed without making API call
      setNewsFeed(getDefaultNewsFeed());
      setNewsLoading(false);
      return;
    }

    try {
      setNewsLoading(true);
      setNewsError(null);
      const response = await api.getNews();

      // Map icon strings to actual icon components
      const iconMap: Record<string, any> = {
        Building2,
        Newspaper,
        TrendingUp,
        BarChart3,
        Activity,
        AlertTriangle,
      };

      // Use the API response directly - it has real news from RSS feeds
      const mappedNewsFeed = response.newsFeed.map((source: any) => ({
        ...source,
        icon: iconMap[source.icon] || Newspaper,
      }));

      // Log for debugging
      console.log("[News] Fetched from API:", {
        sources: mappedNewsFeed.map((s: any) => s.source),
        firstItems: mappedNewsFeed.map(
          (s: any) => s.items?.[0]?.title?.substring(0, 40) + "..."
        ),
      });

      // Set all sources directly from API
      setNewsFeed(mappedNewsFeed);
      setLastNewsUpdate(new Date());

      // Update selectedSources if the API returned different sources than expected
      const apiSourceNames = mappedNewsFeed.map((s: any) => s.source);
      const validSelectedSources = selectedSources.filter((s) =>
        apiSourceNames.includes(s)
      );
      if (validSelectedSources.length === 0 && apiSourceNames.length > 0) {
        // If no valid selected sources, select all from API
        setSelectedSources(apiSourceNames);
      }

      if (response.error) {
        setNewsError(response.error);
      }
    } catch (error: any) {
      // Handle unauthorized errors silently (user not logged in)
      if (
        error.message?.includes("Unauthorized") ||
        error.message?.includes("401")
      ) {
        // User not authenticated - use default news feed without logging error
        setNewsFeed(getDefaultNewsFeed());
      } else if (
        error.message?.includes("timed out") ||
        error.message?.includes("timeout")
      ) {
        // For timeout errors, log as warning since we have default news feed fallback
        console.warn(
          "News request timed out, using default news feed fallback:",
          error.message
        );
        setNewsError(error.message || "Failed to fetch news");
        setNewsFeed(getDefaultNewsFeed());
      } else {
        console.error("Error fetching news:", error);
        setNewsError(error.message || "Failed to fetch news");
        setNewsFeed(getDefaultNewsFeed());
      }
    } finally {
      setNewsLoading(false);
    }
  };

  // Fetch news on mount, when selected sources change, and every 30 minutes
  useEffect(() => {
    fetchNews();
    const interval = setInterval(() => {
      fetchNews();
    }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [selectedSources]);

  // Initialize news feed with default if empty
  useEffect(() => {
    if (newsFeed.length === 0 && !newsLoading) {
      setNewsFeed(getDefaultNewsFeed());
    }
  }, [newsLoading]);

  // Filter news feed based on selected sources
  const filteredNewsFeed = useMemo(() => {
    if (newsFeed.length === 0) {
      return getDefaultNewsFeed();
    }
    // Filter by selected sources, or show all if none selected match
    const filtered = newsFeed.filter((source: any) =>
      selectedSources.includes(source.source)
    );
    // If no matches, show all available news (user may have old preferences)
    return filtered.length > 0 ? filtered : newsFeed;
  }, [newsFeed, selectedSources]);

  // Handle source selection - Allow all sources to be selected
  const handleSourceToggle = (sourceName: string) => {
    setSelectedSources((prev) => {
      if (prev.includes(sourceName)) {
        // Remove if already selected (but keep at least 1 source)
        if (prev.length > 1) {
          const updated = prev.filter((s) => s !== sourceName);
          saveUserPreferences(updated);
          return updated;
        }
        return prev;
      } else {
        // Add if not selected - no maximum limit, allow all sources
        const updated = [...prev, sourceName];
        saveUserPreferences(updated);
        return updated;
      }
    });
  };

  // Re-fetch news when selected sources change (to ensure we have latest data)
  // The filtering is handled by filteredNewsFeed useMemo
  useEffect(() => {
    // Only re-fetch if we don't have news yet
    if (newsFeed.length === 0) {
      fetchNews();
    }
  }, [selectedSources]);

  // Fetch AI-powered insights when a news item is selected
  const fetchInsights = useCallback(async (item: any, source: any) => {
    setInsightsLoading(true);
    setInsights(null);

    try {
      const result = await api.getNewsInsights({
        title: item.title,
        source: source.source,
        link: item.link,
        sourceSummary: source.summary,
      });
      setInsights(result);
    } catch (error: any) {
      console.error("[News] Failed to fetch insights:", error);
      // Set default insights on error
      setInsights({
        insights: getDefaultInsights(item.title),
        error: "Could not generate AI insights",
      });
    } finally {
      setInsightsLoading(false);
    }
  }, []);

  // Helper to get default insights when AI is unavailable
  const getDefaultInsights = (title: string) => {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("rate") || lowerTitle.includes("mortgage")) {
      return [
        {
          type: "pipeline",
          label: "Pipeline Impact",
          content:
            "Rate movements may affect application volume and lock timing. Monitor pipeline closely.",
          color: "blue",
        },
        {
          type: "competitive",
          label: "Market Opportunity",
          content:
            "Consider proactive outreach to borrowers who may benefit from rate changes.",
          color: "emerald",
        },
        {
          type: "action",
          label: "Recommended Action",
          content:
            "Review rate lock policies and ensure pricing team is aligned.",
          color: "violet",
        },
      ];
    }
    if (
      lowerTitle.includes("compliance") ||
      lowerTitle.includes("regulation") ||
      lowerTitle.includes("cfpb")
    ) {
      return [
        {
          type: "compliance",
          label: "Compliance Alert",
          content:
            "New regulatory guidance may require process updates. Schedule compliance review.",
          color: "rose",
        },
        {
          type: "action",
          label: "Immediate Action",
          content:
            "Brief compliance team and assess impact on current pipeline.",
          color: "violet",
        },
        {
          type: "competitive",
          label: "Positioning",
          content:
            "Early adoption of compliance changes can differentiate your organization.",
          color: "emerald",
        },
      ];
    }
    return [
      {
        type: "market",
        label: "Market Signal",
        content:
          "This development may indicate broader industry trends. Monitor for follow-up.",
        color: "blue",
      },
      {
        type: "competitive",
        label: "Strategic Fit",
        content:
          "Evaluate how this aligns with your market positioning and growth strategy.",
        color: "emerald",
      },
      {
        type: "action",
        label: "Next Steps",
        content:
          "Consider discussing implications with leadership team within 48 hours.",
        color: "violet",
      },
    ];
  };

  // Handle news item click - open dialog and fetch insights
  const handleNewsItemClick = (item: any, source: any) => {
    setSelectedNewsItem({ item, source });
    fetchInsights(item, source);
  };

  // Get color class for insight
  const getInsightColor = (color: string) => {
    const colorMap: Record<string, string> = {
      blue: "bg-blue-500",
      emerald: "bg-emerald-500",
      rose: "bg-rose-500",
      amber: "bg-amber-500",
      violet: "bg-violet-500",
    };
    return colorMap[color] || "bg-slate-500";
  };

  return (
    <div className="mb-6 sm:mb-10">
      {/* Refined Preview Card - Enhanced Typography & Layout */}
      <motion.div
        ref={cardRef}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="relative overflow-hidden rounded-xl sm:rounded-2xl md:rounded-3xl bg-white dark:bg-slate-900/95 p-4 sm:p-5 md:p-7 lg:p-9 shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_4px_12px_0_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_0_rgba(0,0,0,0.3),0_4px_12px_0_rgba(0,0,0,0.2)] border border-slate-200/60 dark:border-slate-700/50"
      >
        {/* Enhanced Header - Mobile First */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 md:gap-4 lg:gap-5 mb-4 sm:mb-5 md:mb-6 lg:mb-7">
          <div className="flex items-center gap-2.5 sm:gap-3 md:gap-4 lg:gap-5 flex-1 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 sm:w-12 sm:h-12 md:w-14 md:h-14 lg:w-16 lg:h-16 rounded-xl sm:rounded-2xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-[0_4px_12px_rgba(59,130,246,0.25)] dark:shadow-[0_4px_12px_rgba(59,130,246,0.15)]">
                <Newspaper
                  className="w-5 h-5 sm:w-6 sm:h-6 md:w-7 md:h-7 lg:w-8 lg:h-8 text-white"
                  strokeWidth={1.5}
                />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-lg sm:text-xl md:text-2xl lg:text-3xl xl:text-4xl font-extralight text-slate-900 dark:text-white mb-0.5 sm:mb-1 tracking-[-0.02em] leading-[1.05] truncate">
                Industry News
              </h3>
              <p className="text-[10px] sm:text-xs md:text-sm lg:text-base text-slate-600 dark:text-slate-400 font-light tracking-tight truncate">
                Market Intelligence Updates
              </p>
            </div>
          </div>
          {/* Source Selector Button - Mobile First */}
          <div className="flex items-center gap-2">
            <ExportShareMenu
              title="Industry News"
              targetRef={cardRef}
              shareTarget={{ type: "industry-news", label: "Industry News" }}
            />
            <button
              onClick={() => setShowSourceSelector(true)}
              className="flex items-center justify-center p-2 sm:p-2.5 rounded-lg sm:rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all duration-200 active:scale-95 border border-slate-200 dark:border-slate-700 touch-manipulation"
              aria-label={`Select news sources (${selectedSources.length}/${availableSources.length})`}
              title={`Sources (${selectedSources.length}/${availableSources.length})`}
            >
              <Settings
                className="w-4 h-4 sm:w-5 sm:h-5 text-slate-700 dark:text-slate-300"
                strokeWidth={1.5}
              />
            </button>
          </div>
        </div>

        {/* Market Intelligence Ticker - Optimal Blue style */}
        <MarketIntelligenceTicker />

        {/* Enhanced Multi-column Layout - Display All Sources - Mobile First with Perfect Alignment */}
        <div
          className={`${
            selectedSources.length >= 4
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              : "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3"
          } gap-2.5 sm:gap-3 md:gap-4 lg:gap-6 xl:gap-8 items-start mt-[8.7mm]`}
        >
          {filteredNewsFeed.map((source: any, sourceIdx: number) => {
            const SourceIcon = source.icon;
            return (
              <div
                key={source.source}
                className="min-w-0 w-full flex flex-col h-full"
              >
                {/* Header - Fixed height for alignment */}
                <div className="flex items-center gap-2 sm:gap-2.5 md:gap-3 mb-3 sm:mb-4 md:mb-5 h-8 sm:h-9 md:h-10 mt-[2mm]">
                  <div
                    className={`w-6 h-6 sm:w-7 sm:h-7 md:w-8 md:h-8 lg:w-9 lg:h-9 rounded-lg sm:rounded-xl ${source.bg} flex items-center justify-center flex-shrink-0 shadow-sm border border-slate-200/40 dark:border-slate-700/40`}
                  >
                    <SourceIcon
                      className={`w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-4.5 md:h-4.5 lg:w-5 lg:h-5 ${source.color}`}
                      strokeWidth={1.5}
                    />
                  </div>
                  <h4 className="text-xs sm:text-sm md:text-base lg:text-lg font-light text-slate-800 dark:text-slate-200 tracking-tight truncate flex-1 min-w-0 leading-tight">
                    {source.source}
                  </h4>
                </div>
                {/* News Items - Consistent spacing */}
                <div className="space-y-2.5 sm:space-y-3 md:space-y-3.5 lg:space-y-4 xl:space-y-5 flex-1">
                  {source.items?.slice(0, 2).map((item: any, idx: number) => (
                    <div
                      key={idx}
                      onClick={() => handleNewsItemClick(item, source)}
                      className="group cursor-pointer p-2.5 sm:p-3 md:p-4 lg:p-5 xl:p-6 rounded-md sm:rounded-lg md:rounded-xl lg:rounded-2xl bg-slate-50/50 dark:bg-slate-800/30 hover:bg-white dark:hover:bg-slate-800/50 transition-all duration-300 active:scale-[0.98] border border-slate-200/60 dark:border-slate-700/40 hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-md dark:hover:shadow-lg touch-manipulation w-full flex flex-col"
                    >
                      <p className="text-[11px] sm:text-xs md:text-sm lg:text-base xl:text-lg text-slate-900 dark:text-slate-100 leading-[1.4] sm:leading-[1.5] mb-1.5 sm:mb-2 md:mb-2.5 lg:mb-3 group-hover:text-slate-950 dark:group-hover:text-white transition-colors font-light tracking-tight line-clamp-2 break-words min-h-[2.8em] sm:min-h-[3em] md:min-h-[3.2em]">
                        {item.title}
                      </p>
                      <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2 text-[9px] sm:text-[10px] md:text-xs lg:text-sm text-slate-500 dark:text-slate-400 font-light flex-wrap mt-auto">
                        <span className="truncate">{item.date}</span>
                        <span className="text-slate-300 dark:text-slate-600 flex-shrink-0">
                          •
                        </span>
                        <span className="whitespace-nowrap">{item.time}</span>
                      </div>
                    </div>
                  )) || (
                    <p className="text-[9px] sm:text-[10px] md:text-xs lg:text-sm text-slate-500 dark:text-slate-400 font-light">
                      Loading news...
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>

      {/* Source Selector Dialog */}
      <Dialog open={showSourceSelector} onOpenChange={setShowSourceSelector}>
        <DialogContent className="max-w-2xl w-full sm:w-[90vw] md:w-[95vw] h-[85vh] sm:h-auto sm:max-h-[85vh] p-0 gap-0 overflow-hidden bg-white dark:bg-slate-900 rounded-none sm:rounded-xl md:rounded-2xl border-0 sm:border border-slate-200/60 dark:border-slate-700/50 shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.5)] [&>button]:hidden">
          <div className="flex flex-col h-full max-h-[85vh]">
            {/* Header - Mobile First */}
            <div className="flex-shrink-0 flex items-center justify-between px-3 sm:px-4 md:px-5 lg:px-6 py-3 sm:py-4 md:py-5 border-b border-slate-200/60 dark:border-slate-700/50 bg-slate-50/30 dark:bg-slate-800/30">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-sm flex-shrink-0">
                  <Newspaper
                    className="w-4 h-4 sm:w-5 sm:h-5 text-white"
                    strokeWidth={1.5}
                  />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="text-base sm:text-lg md:text-xl font-extralight text-slate-900 dark:text-white tracking-tight truncate">
                    Select News Sources
                  </DialogTitle>
                  <DialogDescription className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light mt-0.5">
                    Select sources to display in your Industry News feed
                  </DialogDescription>
                </div>
              </div>
            </div>

            {/* Source List - Mobile First */}
            <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 md:px-5 lg:px-6 py-3 sm:py-4 md:py-5 lg:py-6">
              <div className="space-y-2 sm:space-y-3">
                {availableSources.map((source) => {
                  const SourceIcon = source.icon;
                  const isSelected = selectedSources.includes(source.source);
                  const isDisabled = false; // No limit on source selection
                  return (
                    <button
                      key={source.source}
                      onClick={() => handleSourceToggle(source.source)}
                      disabled={isDisabled}
                      className={`w-full flex items-start gap-2.5 sm:gap-3 md:gap-4 p-3 sm:p-4 rounded-lg sm:rounded-xl border transition-all duration-200 text-left touch-manipulation ${
                        isSelected
                          ? "bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-900/40 shadow-sm"
                          : isDisabled
                          ? "bg-slate-50 dark:bg-slate-800/30 border-slate-200 dark:border-slate-700 opacity-50 cursor-not-allowed"
                          : "bg-white dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:border-slate-300 dark:hover:border-slate-600"
                      }`}
                    >
                      <div
                        className={`w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-lg ${source.bg} flex items-center justify-center flex-shrink-0 border border-slate-200/40 dark:border-slate-700/40`}
                      >
                        <SourceIcon
                          className={`w-4 h-4 sm:w-4.5 sm:h-4.5 md:w-5 md:h-5 ${source.color}`}
                          strokeWidth={1.5}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1">
                          <h4 className="text-xs sm:text-sm md:text-base font-light text-slate-900 dark:text-slate-200 tracking-tight truncate">
                            {source.source}
                          </h4>
                          {isSelected && (
                            <Check
                              className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600 dark:text-blue-400 flex-shrink-0"
                              strokeWidth={2}
                            />
                          )}
                        </div>
                        <p className="text-[10px] sm:text-xs md:text-sm text-slate-600 dark:text-slate-400 font-light leading-relaxed line-clamp-2 sm:line-clamp-3">
                          {source.summary}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Footer */}
            <div className="flex-shrink-0 px-5 sm:px-6 py-4 border-t border-slate-200/60 dark:border-slate-700/50 bg-slate-50/30 dark:bg-slate-800/30">
              <div className="flex items-center justify-between">
                <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light">
                  {selectedSources.length} of {availableSources.length} sources
                  selected
                </p>
                <button
                  onClick={() => setShowSourceSelector(false)}
                  className="px-4 py-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-light text-sm tracking-tight hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!selectedNewsItem}
        onOpenChange={(open) => !open && setSelectedNewsItem(null)}
      >
        <DialogContent
          className="
            /* Mobile: true fullscreen, perfectly aligned */
            inset-0 top-0 bottom-0 left-0 right-0
            translate-x-0 translate-y-0
            w-screen max-w-none
            h-[100dvh] max-h-none
            rounded-none

            /* Desktop/tablet: centered modal */
            sm:left-1/2 sm:top-1/2 sm:right-auto sm:bottom-auto
            sm:w-[min(95vw,42rem)] sm:max-w-2xl
            sm:h-auto sm:max-h-[90vh]
            sm:translate-x-[-50%] sm:translate-y-[-50%]
            sm:rounded-2xl

            p-0 gap-0
            overflow-hidden
            bg-white dark:bg-slate-900
            border-0 sm:border border-slate-200/60 dark:border-slate-700/50
            shadow-none sm:shadow-[0_20px_60px_rgba(0,0,0,0.15)] dark:sm:shadow-[0_20px_60px_rgba(0,0,0,0.5)]
            [&>button]:hidden
            safe-area-inset
          "
        >
          {selectedNewsItem && (
            <div className="flex flex-col h-full sm:max-h-[90vh] md:max-h-[85vh]">
              {/* Enhanced Header - Sticky with safe area */}
              <div
                className="
                  sticky top-0 z-10 
                  flex items-center justify-between 
                  px-4 sm:px-5 md:px-6 
                  py-4 sm:py-4 md:py-5 
                  pt-safe
                  border-b border-slate-200/60 dark:border-slate-700/50 
                  bg-white/95 dark:bg-slate-900/95 
                  backdrop-blur-md 
                  flex-shrink-0 
                  shadow-sm sm:shadow-none
                "
              >
                <div className="flex items-center gap-3 sm:gap-3.5 min-w-0 flex-1">
                  <div
                    className={`
                      w-10 h-10 sm:w-11 sm:h-11 
                      rounded-xl 
                      ${selectedNewsItem.source.bg} 
                      flex items-center justify-center 
                      flex-shrink-0 
                      shadow-sm 
                      border border-slate-200/40 dark:border-slate-700/40
                    `}
                  >
                    {(() => {
                      const Icon = selectedNewsItem.source.icon;
                      return (
                        <Icon
                          className={`w-5 h-5 sm:w-5.5 sm:h-5.5 ${selectedNewsItem.source.color}`}
                          strokeWidth={1.5}
                        />
                      );
                    })()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm sm:text-sm font-normal text-slate-700 dark:text-slate-300 truncate tracking-tight">
                      {selectedNewsItem.source.source}
                    </p>
                    <p className="text-xs sm:text-xs text-slate-500 dark:text-slate-400 truncate font-light mt-0.5">
                      {selectedNewsItem.item.date} •{" "}
                      {selectedNewsItem.item.time}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedNewsItem(null)}
                  className="
                    min-w-[44px] min-h-[44px] w-11 h-11 sm:w-9 sm:h-9
                    rounded-full 
                    bg-white/90 dark:bg-slate-800/90 
                    border border-slate-200 dark:border-slate-700 
                    shadow-sm 
                    hover:bg-slate-50 dark:hover:bg-slate-700 
                    active:bg-slate-100 dark:active:bg-slate-600
                    backdrop-blur-sm 
                    flex items-center justify-center 
                    transition-all duration-200 
                    flex-shrink-0 
                    ml-3 
                    focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1
                    touch-manipulation
                  "
                  aria-label="Close"
                >
                  <X
                    className="w-5 h-5 sm:w-4 sm:h-4 text-slate-500 dark:text-slate-400"
                    strokeWidth={1.5}
                  />
                </button>
              </div>

              {/* Enhanced Content - Scrollable with safe area */}
              <div
                className="
                  flex-1 
                  overflow-y-auto 
                  px-4 sm:px-5 md:px-6 
                  py-5 sm:py-5 md:py-6 
                  pb-safe
                  overscroll-contain
                  -webkit-overflow-scrolling-touch
                "
              >
                {/* Title */}
                <h1
                  className="
                    text-[1.375rem] leading-[1.25] sm:text-2xl sm:leading-[1.2] md:text-3xl md:leading-[1.15] 
                    font-extralight 
                    text-slate-900 dark:text-white 
                    tracking-[-0.02em] 
                    mb-4 sm:mb-4 md:mb-5 
                    pr-2
                    break-words
                  "
                >
                  {selectedNewsItem.item.title}
                </h1>

                {/* Brief Summary */}
                <p
                  className="
                    text-[0.9375rem] leading-[1.6] sm:text-base sm:leading-[1.6] md:text-base md:leading-[1.6] 
                    text-slate-700 dark:text-slate-300 
                    mb-5 sm:mb-5 md:mb-6 
                    font-light 
                    tracking-tight
                    break-words
                  "
                >
                  {selectedNewsItem.source.summary}
                </p>

                {/* Enhanced Cohi Executive Insights - AI Powered */}
                <div
                  className="
                    rounded-xl sm:rounded-2xl 
                    bg-gradient-to-br from-slate-50 to-slate-100/60 
                    dark:from-slate-800/50 dark:to-slate-800/40 
                    p-4 sm:p-4 md:p-5 
                    mb-5 sm:mb-5 md:mb-6 
                    border border-slate-200/50 dark:border-slate-700/40 
                    shadow-sm
                  "
                >
                  <div className="flex items-center gap-2.5 sm:gap-2.5 mb-4 sm:mb-3.5 md:mb-4">
                    <div
                      className="
                        w-7 h-7 sm:w-7 sm:h-7 
                        rounded-lg 
                        bg-gradient-to-br from-blue-500 to-indigo-600 
                        flex items-center justify-center 
                        flex-shrink-0 
                        shadow-sm
                      "
                    >
                      {insightsLoading ? (
                        <Loader2
                          className="w-4 h-4 sm:w-4 sm:h-4 text-white animate-spin"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <Zap
                          className="w-4 h-4 sm:w-4 sm:h-4 text-white"
                          strokeWidth={1.5}
                        />
                      )}
                    </div>
                    <span
                      className="
                        text-[0.9375rem] sm:text-sm md:text-base 
                        font-medium 
                        text-slate-700 dark:text-slate-300 
                        tracking-tight
                      "
                    >
                      Cohi Insights
                    </span>
                    {!insightsLoading && insights && !insights.error && (
                      <span className="ml-auto text-[10px] sm:text-xs text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-950/30 px-2 py-0.5 rounded-full">
                        AI Powered
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 sm:space-y-3 md:space-y-3.5">
                    {insightsLoading ? (
                      // Loading state
                      <>
                        <div className="flex items-start gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-[0.5rem] flex-shrink-0 animate-pulse" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-3/4" />
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-full" />
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-[0.5rem] flex-shrink-0 animate-pulse" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-2/3" />
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-5/6" />
                          </div>
                        </div>
                        <div className="flex items-start gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-600 mt-[0.5rem] flex-shrink-0 animate-pulse" />
                          <div className="flex-1 space-y-2">
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-1/2" />
                            <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-4/5" />
                          </div>
                        </div>
                      </>
                    ) : insights?.insights && insights.insights.length > 0 ? (
                      // AI-generated insights
                      <>
                        {insights.insights.map((insight, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-3 sm:gap-3"
                          >
                            <div
                              className={`w-1.5 h-1.5 rounded-full ${getInsightColor(
                                insight.color
                              )} mt-[0.5rem] flex-shrink-0`}
                            />
                            <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {insight.label}:
                              </span>{" "}
                              {insight.content}
                            </p>
                          </div>
                        ))}
                        {/* Client data summary if available */}
                        {insights.clientDataSummary && (
                          <div className="mt-3 pt-3 border-t border-slate-200/50 dark:border-slate-700/40">
                            <p className="text-[0.8125rem] sm:text-xs md:text-sm text-blue-700 dark:text-blue-300 font-light tracking-tight">
                              <span className="font-medium">Your Data:</span>{" "}
                              {insights.clientDataSummary}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      // Fallback default insights
                      <>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              Market Signal:
                            </span>{" "}
                            This development may indicate broader industry
                            trends worth monitoring.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              Strategic Fit:
                            </span>{" "}
                            Consider how this aligns with your market
                            positioning.
                          </p>
                        </div>
                        <div className="flex items-start gap-3 sm:gap-3">
                          <div className="w-1.5 h-1.5 rounded-full bg-violet-500 mt-[0.5rem] flex-shrink-0" />
                          <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.6] sm:leading-[1.6] font-light tracking-tight break-words">
                            <span className="font-semibold text-slate-800 dark:text-slate-200">
                              Next Steps:
                            </span>{" "}
                            Read the full article for more details.
                          </p>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Enhanced Read Full Article CTA */}
                <a
                  href={selectedNewsItem.item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    sessionStorage.setItem("returnToAdmin", "true");
                    sessionStorage.setItem(
                      "dashboardUrl",
                      window.location.href
                    );
                  }}
                  className="
                    flex items-center justify-center gap-2.5 
                    w-full 
                    min-h-[52px] sm:min-h-[48px]
                    py-4 sm:py-4 md:py-4 
                    rounded-xl sm:rounded-2xl 
                    bg-gradient-to-r from-slate-900 to-slate-800 
                    dark:from-white dark:to-slate-50 
                    hover:from-slate-800 hover:to-slate-700 
                    dark:hover:from-slate-50 dark:hover:to-slate-100 
                    active:from-slate-700 active:to-slate-600
                    dark:active:from-slate-100 dark:active:to-slate-200
                    text-white dark:text-slate-900 
                    font-medium 
                    text-base sm:text-base md:text-lg 
                    tracking-tight 
                    transition-all 
                    active:scale-[0.98] 
                    shadow-lg hover:shadow-xl 
                    border border-slate-700 dark:border-slate-200
                    touch-manipulation
                    no-underline
                  "
                >
                  <ExternalLink
                    className="w-5 h-5 sm:w-5 sm:h-5"
                    strokeWidth={2}
                  />
                  <span>Read Full Article</span>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
