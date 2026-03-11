import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
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
  Mail,
  Link2,
  Pin,
  PinOff,
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
import { ExportMenu } from "@/components/common/ExportMenu";
import { CohiPodcast } from "@/components/cohi/CohiPodcast";

// Sample data for Daily Morning Brief charts (from Markets & Economy brief)
const FIXED_RATE_DATA = [
  { week: "Jan 6", rate: 5.6 },
  { week: "Jan 13", rate: 6.3 },
  { week: "Jan 20", rate: 6.0 },
  { week: "Jan 27", rate: 5.9 },
  { week: "Feb 3", rate: 5.35 },
  { week: "Feb 10", rate: 5.03 },
  { week: "Feb 16", rate: 6.0 },
];
const TREASURY_DATA = [
  { date: "Feb 6", yield: 4.15 },
  { date: "Feb 9", yield: 4.0 },
  { date: "Feb 10", yield: 4.0 },
  { date: "Feb 12", yield: 4.05 },
  { date: "Feb 14", yield: 4.09 },
  { date: "Feb 16", yield: 4.0 },
  { date: "Feb 17", yield: 4.0 },
];
const MBA_INDEX_DATA = [
  { week: "Jan 10", purchase: 135, refi: 111 },
  { week: "Jan 17", purchase: 130, refi: 122 },
  { week: "Jan 24", purchase: 123, refi: 125 },
  { week: "Jan 31", purchase: 127, refi: 126 },
  { week: "Feb 7", purchase: 123, refi: 123 },
];
const NAHB_DATA = [
  { month: "Feb", value: 40 },
  { month: "Apr", value: 42 },
  { month: "Jun", value: 33 },
  { month: "Aug", value: 39 },
  { month: "Dec", value: 37 },
  { month: "Jan", value: 38 },
];
const RATE_SNAPSHOT_DATA = [
  { product: "30-Yr Fixed", prior: 5.38, today: 5.39 },
  { product: "15-Yr Fixed", prior: 5.73, today: 5.28 },
  { product: "30-Yr FHA", prior: 5.55, today: 5.99 },
  { product: "30-Yr Jumbo", prior: 6.39, today: 5.5 },
  { product: "30-Yr VA", prior: 5.69, today: 5.65 },
  { product: "30-Yr USDA", prior: 6.04, today: 6.02 },
];
const EXISTING_HOME_SALES_DATA = [
  { month: "Aug '25", value: 4.02 },
  { month: "Sep '25", value: 4.14 },
  { month: "Oct '25", value: 4.15 },
  { month: "Nov '25", value: 4.0 },
  { month: "Dec '25", value: 3.31 },
  { month: "Jan '26", value: 3.91 },
];

type DrilldownRange = "mtd" | "qtr" | "ytd" | "3y";
type DrilldownChartKey =
  | "fixedRate"
  | "treasury"
  | "mba"
  | "nahb"
  | "rateSnapshot"
  | "existingSales";

const CHART_SOURCE_META: Record<
  DrilldownChartKey,
  { label: string; url: string }
> = {
  fixedRate: {
    label: "Optimal Blue OBMMI",
    url: "https://www2.optimalblue.com/obmmi",
  },
  treasury: {
    label: "U.S. Treasury",
    url: "https://home.treasury.gov/",
  },
  mba: {
    label: "MBA Weekly Applications Survey",
    url: "https://www.mba.org/news-and-research/newsroom",
  },
  nahb: {
    label: "NAHB Housing Market Index",
    url: "https://www.nahb.org/news-and-economics/housing-economics/indices/housing-market-index",
  },
  rateSnapshot: {
    label: "Optimal Blue OBMMI",
    url: "https://www2.optimalblue.com/obmmi",
  },
  existingSales: {
    label: "NAR Existing-Home Sales",
    url: "https://www.nar.realtor/research-and-statistics/housing-statistics/existing-home-sales",
  },
};

const DRILLDOWN_RANGE_LABELS: Record<DrilldownRange, string> = {
  mtd: "MTD",
  qtr: "QTR",
  ytd: "YTD",
  "3y": "Last 3 Years",
};

const CHART_DRILLDOWN_DATA: Record<
  DrilldownChartKey,
  Partial<Record<DrilldownRange, any[]>>
> = {
  fixedRate: {
    mtd: FIXED_RATE_DATA.slice(-3),
    qtr: FIXED_RATE_DATA,
    ytd: FIXED_RATE_DATA,
    "3y": [
      { week: "2023", rate: 6.8 },
      { week: "2024", rate: 6.4 },
      { week: "2025", rate: 6.1 },
      { week: "2026", rate: 5.9 },
    ],
  },
  treasury: {
    mtd: TREASURY_DATA.slice(-4),
    qtr: TREASURY_DATA,
    ytd: TREASURY_DATA,
    "3y": [
      { date: "2023", yield: 4.62 },
      { date: "2024", yield: 4.25 },
      { date: "2025", yield: 4.08 },
      { date: "2026", yield: 4.0 },
    ],
  },
  mba: {
    mtd: MBA_INDEX_DATA.slice(-2),
    qtr: MBA_INDEX_DATA,
    ytd: MBA_INDEX_DATA,
    "3y": [
      { week: "2023", purchase: 118, refi: 92 },
      { week: "2024", purchase: 122, refi: 97 },
      { week: "2025", purchase: 128, refi: 112 },
      { week: "2026", purchase: 130, refi: 120 },
    ],
  },
  nahb: {
    mtd: NAHB_DATA.slice(-2),
    qtr: NAHB_DATA.slice(-4),
    ytd: NAHB_DATA,
    "3y": [
      { month: "2023", value: 34 },
      { month: "2024", value: 37 },
      { month: "2025", value: 39 },
      { month: "2026", value: 38 },
    ],
  },
  rateSnapshot: {
    mtd: RATE_SNAPSHOT_DATA,
    qtr: RATE_SNAPSHOT_DATA,
    ytd: RATE_SNAPSHOT_DATA,
  },
  existingSales: {
    mtd: EXISTING_HOME_SALES_DATA.slice(-2),
    qtr: EXISTING_HOME_SALES_DATA.slice(-4),
    ytd: EXISTING_HOME_SALES_DATA,
    "3y": [
      { month: "2023", value: 4.28 },
      { month: "2024", value: 4.11 },
      { month: "2025", value: 4.05 },
      { month: "2026", value: 3.91 },
    ],
  },
};

const HEADLINES_PER_PAGE = 6;
const HEADLINES_ROTATE_MS = 15_000;
const MAX_HEADLINE_AGE_MS = 2 * 24 * 60 * 60 * 1000; // 2 days
const EXCERPT_PARAGRAPHS_PER_PAGE = 4;

const isValidDate = (value: Date) => !Number.isNaN(value.getTime());

/** Format a FRED YYYY-MM-DD string as "MMM 'yy" using local calendar date (avoids UTC→local shift). */
function formatFredDateAsMonthYear(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return format(new Date(y, m - 1, d), "MMM ''yy");
}

/** Format a FRED YYYY-MM-DD string as "MMM d" using local calendar date (avoids UTC→local shift for chart labels). */
function formatFredDateShort(dateStr: string): string {
  const parts = dateStr.split("-").map(Number);
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  return format(new Date(y, m - 1, d), "MMM d");
}

const parseNewsReleaseDate = (item: any): Date | null => {
  const directCandidates = [
    item?.publishedAt,
    item?.published_at,
    item?.pubDate,
    item?.published,
    item?.dateTime,
    item?.datetime,
  ];

  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      const parsed = new Date(candidate);
      if (isValidDate(parsed)) return parsed;
    }
  }

  if (typeof item?.date === "string" && item.date.trim()) {
    const combined = `${item.date}${item.time ? ` ${item.time}` : ""}`;
    const parsed = new Date(combined);
    if (isValidDate(parsed)) return parsed;
    const dateOnly = new Date(item.date);
    if (isValidDate(dateOnly)) return dateOnly;
  }

  return null;
};

const OBMMI_WIDGET_URL = "https://www2.optimalblue.com/OBMMI/widgetConfig.php";

function MarketIntelligenceTicker({
  loading,
  seriesFromApi,
}: {
  loading?: boolean;
  seriesFromApi?: Record<string, { rate: number | null; delta: number | null; trend: string; priorRate: number | null }> | null;
}) {
  const [obModalOpen, setObModalOpen] = useState(false);

  const SERIES_TO_LABEL: Record<string, string> = {
    conforming: "30-Yr. Conforming",
    jumbo: "30-Yr. Jumbo",
    fha: "30-Yr. FHA",
    va: "30-Yr. VA",
    usda: "30-Yr. USDA",
    conforming15yr: "15-Yr. Conforming",
  };

  const keys = ["conforming", "jumbo", "fha", "va", "usda", "conforming15yr"] as const;
  const RATE_INDICES = keys.map((key) => {
    const label = SERIES_TO_LABEL[key];
    if (loading || !seriesFromApi) {
      return { label, rate: null, delta: null, trend: "flat" as const };
    }
    const s = seriesFromApi[key];
    const rate = s?.rate ?? null;
    const delta = s?.delta ?? null;
    const trend = s?.trend === "down" ? "down" : s?.trend === "up" ? "up" : "flat";
    return { label, rate, delta, trend };
  });

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
              const isDown = item.trend === "down";
              const hasRate = item.rate != null;
              const hasDelta = item.delta != null;
              return (
                <button
                  type="button"
                  key={`${item.label}-${idx}`}
                  onClick={() => setObModalOpen(true)}
                  className="flex items-center gap-3 px-6 h-full border-r border-slate-200/70 shrink-0 cursor-pointer hover:bg-slate-100/50 dark:hover:bg-slate-800/30 transition-colors duration-150 text-left touch-manipulation focus:outline-none focus:ring-2 focus:ring-inset focus:ring-slate-400/30 rounded-none"
                  aria-label={hasRate ? `View rate details: ${item.label} ${item.rate!.toFixed(3)}%` : `View rate details: ${item.label}`}
                >
                  <span className="text-[11px] sm:text-xs md:text-[13px] font-medium text-slate-700 dark:text-slate-300">
                    {item.label}
                  </span>
                  {hasRate && (isUp || isDown) ? renderSparkline(item.trend as "up" | "down") : <span className="w-[38px] text-slate-400">—</span>}
                  <span className="text-[11px] sm:text-xs md:text-[13px] font-semibold text-slate-800 dark:text-slate-200">
                    {hasRate ? `${item.rate!.toFixed(3)}%` : "—"}
                  </span>
                  <span
                    className={`text-[10px] sm:text-[11px] md:text-[12px] font-medium min-w-[2.5rem] ${
                      !hasDelta ? "text-slate-400" : isUp ? "text-emerald-600 dark:text-emerald-400" : "text-red-500 dark:text-red-400"
                    }`}
                  >
                    {hasDelta ? `${isUp ? "+" : ""}${item.delta!.toFixed(3)}` : "—"}
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
  const warmedArticleLinksRef = useRef<Set<string>>(new Set());
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
  const [articleBriefLoading, setArticleBriefLoading] = useState(false);
  const [articleBrief, setArticleBrief] = useState<{
    articleParagraphs: string[];
    fullArticleUrl: string;
    fetchedAt: string;
    error?: string;
  } | null>(null);
  
  const [excerptPage, setExcerptPage] = useState(0);
  const [showChartDrilldown, setShowChartDrilldown] = useState(false);
  const [activeChart, setActiveChart] = useState<DrilldownChartKey | null>(null);
  const [drilldownRange, setDrilldownRange] = useState<DrilldownRange>("mtd");

  // FRED-sourced chart data for 30-Yr Fixed (MORTGAGE30US) and 10-Yr Treasury (DGS10)
  const [fixedRateObservations, setFixedRateObservations] = useState<
    Array<{ date: string; rate: number }> | null
  >(null);
  const [treasuryObservations, setTreasuryObservations] = useState<
    Array<{ date: string; yield: number }> | null
  >(null);

  const [existingHomeSalesObservations, setExistingHomeSalesObservations] = useState<
    Array<{ date: string; value: number }> | null
  >(null);

  // OBMMI multi-series (conforming, jumbo, fha, va, conforming15yr, usda) for ticker + rate snapshot
  const [currentObmmiSeries, setCurrentObmmiSeries] = useState<
    Record<string, { rate: number | null; delta: number | null; trend: string; priorRate: number | null }> | null
  >(null);
  const [currentRatesLoading, setCurrentRatesLoading] = useState(true);
  const [currentRatesFailed, setCurrentRatesFailed] = useState(false);
  const [chartDataLoading, setChartDataLoading] = useState(true);
  const [chartDataFailed, setChartDataFailed] = useState(false);
  const [currentRatesRetryKey, setCurrentRatesRetryKey] = useState(0);
  const [chartDataRetryKey, setChartDataRetryKey] = useState(0);
  
  // Initialize with government/GSE sources enabled by default
  // RSS feed sources (National Mortgage News, etc.) are disabled by default
  const defaultSources = [
    "MBA",
    "Fannie Mae",
    "Freddie Mac",
    "CFPB",
    "FHFA",
    "Federal Reserve",
    "Reuters",
    "National Mortgage News",
    "Mortgage News Daily",
    "MND Rate Watch",
  ];
  const [selectedSources, setSelectedSources] =
    useState<string[]>(defaultSources);
  const [isLoadingPreferences, setIsLoadingPreferences] = useState(true);
  const [headlinePage, setHeadlinePage] = useState(0);
  const [headlinesPaused, setHeadlinesPaused] = useState(false);
  const [pinnedHeadlineId, setPinnedHeadlineId] = useState<string | null>(null);
  const [copiedHeadlineId, setCopiedHeadlineId] = useState<string | null>(null);
  const navigate = useNavigate();

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

  // Fetch FRED 30-Yr Fixed (OBMMI daily), 10-Yr Treasury (DGS10), and Existing Home Sales with retry (5 max, backoff 0/10/20/30s)
  const RETRY_DELAYS_MS = [0, 10_000, 20_000, 30_000];
  const MAX_RETRIES = 5;

  useEffect(() => {
    const end = new Date();
    const start = new Date();
    start.setFullYear(start.getFullYear() - 3);
    const observationEnd = end.toISOString().split("T")[0];
    const observationStart = start.toISOString().split("T")[0];
    const qs = `observation_start=${observationStart}&observation_end=${observationEnd}`;
    const qsDaily = `${qs}&daily=1`;

    let cancelled = false;
    let attempt = 0;
    setChartDataLoading(true);
    setChartDataFailed(false);

    const fetchCharts = (): Promise<void> =>
      Promise.all([
        api.request<{ observations: Array<{ date: string; rate: number }> }>(
          `/api/loans/market-rates/mortgage-30y?${qsDaily}`
        ),
        api.request<{ observations: Array<{ date: string; yield: number }> }>(
          `/api/loans/market-rates/treasury-10y?${qs}`
        ),
        api.request<{ observations: Array<{ date: string; value: number }> }>(
          `/api/loans/market-rates/existing-home-sales?${qs}`
        ),
      ]).then(([mort, treas, exHome]) => {
        if (cancelled) return;
        if (mort?.observations?.length) setFixedRateObservations(mort.observations);
        if (treas?.observations?.length) setTreasuryObservations(treas.observations);
        if (exHome?.observations?.length) setExistingHomeSalesObservations(exHome.observations);
        setChartDataLoading(false);
        setChartDataFailed(false);
      });

    function run() {
      if (cancelled || attempt >= MAX_RETRIES) {
        if (!cancelled) setChartDataLoading(false);
        if (!cancelled && attempt >= MAX_RETRIES) setChartDataFailed(true);
        return;
      }
      attempt += 1;
      fetchCharts().catch(() => {
        if (cancelled) return;
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        if (delay > 0) setTimeout(run, delay);
        else run();
      });
    }
    run();
    return () => { cancelled = true; };
  }, [chartDataRetryKey]);

  // Fetch OBMMI current (all 6 series) for ticker and rate snapshot with retry (5 max, backoff 0/10/20/30s). Bypass cache on first load so refresh gets fresh data.
  useEffect(() => {
    let cancelled = false;
    let attempt = 0;
    setCurrentRatesLoading(true);
    setCurrentRatesFailed(false);

    const fetchCurrent = (bypassCache: boolean) =>
      api.request<{
        available?: boolean;
        series?: Record<string, { rate: number | null; delta: number | null; trend: string; priorRate: number | null }>;
      }>(`/api/loans/market-rates/current${bypassCache ? "?bypassCache=1" : ""}`).then((data) => {
        if (cancelled) return;
        setCurrentObmmiSeries(data?.series ?? null);
        setCurrentRatesLoading(false);
        setCurrentRatesFailed(false);
      });

    function run() {
      if (cancelled || attempt >= MAX_RETRIES) {
        if (!cancelled) setCurrentRatesLoading(false);
        if (!cancelled && attempt >= MAX_RETRIES) setCurrentRatesFailed(true);
        return;
      }
      attempt += 1;
      const bypassCache = attempt === 1;
      fetchCurrent(bypassCache).catch(() => {
        if (cancelled) return;
        const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
        if (delay > 0) setTimeout(run, delay);
        else run();
      });
    }
    run();
    return () => { cancelled = true; };
  }, [currentRatesRetryKey]);

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
    {
      source: "Federal Reserve",
      icon: Activity,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/20",
      summary:
        "Federal Reserve press releases and policy communications affecting rates, liquidity, and mortgage market conditions.",
      items: [],
    },
    {
      source: "Reuters",
      icon: Newspaper,
      color: "text-slate-700 dark:text-slate-300",
      bg: "bg-slate-100 dark:bg-slate-800/40",
      summary:
        "National business news coverage with updates on lending, rate markets, and Federal Reserve developments.",
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
    if (!api.hasToken()) {
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

  // Fetch news on mount, when selected sources change, and every 5 minutes
  useEffect(() => {
    fetchNews();
    const interval = setInterval(() => {
      fetchNews();
    }, 5 * 60 * 1000);
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

  const recentHeadlines = useMemo(() => {
    const reputableHeadlineSources = [
      "National Mortgage News",
      "Mortgage News Daily",
      "MND Rate Watch",
      "MBA",
      "Federal Reserve",
      "Reuters",
      "Fannie Mae",
      "Freddie Mac",
      "CFPB",
      "FHFA",
    ];

    const sourcePool = newsFeed.length > 0 ? newsFeed : filteredNewsFeed;
    const reputableFeed = sourcePool.filter((source: any) =>
      reputableHeadlineSources.includes(source.source)
    );
    const feedForHeadlines =
      reputableFeed.length > 0 ? reputableFeed : filteredNewsFeed;

    const flattened = feedForHeadlines.flatMap((source: any) =>
      (source.items || []).map((item: any) => {
        const releaseDate = parseNewsReleaseDate(item);
        return {
          item,
          source,
          releaseDate,
          relevanceScore: Number(item?.relevanceScore || 0),
          releaseLabel: releaseDate
            ? format(releaseDate, "MMM d, yyyy, h:mm a")
            : `${item?.date || "Unknown date"}${item?.time ? `, ${item.time}` : ""}`,
        };
      })
    );

    return flattened
      .filter(
        (headline: any) =>
          !!headline.item?.title &&
          !headline.item.title.toLowerCase().startsWith("visit ") &&
          !!headline.releaseDate &&
          Date.now() - headline.releaseDate.getTime() <= MAX_HEADLINE_AGE_MS
      )
      .sort(
        (a: any, b: any) =>
          b.relevanceScore - a.relevanceScore ||
          (b.releaseDate?.getTime() || 0) - (a.releaseDate?.getTime() || 0)
      );
  }, [newsFeed, filteredNewsFeed]);

  const headlinePageCount = Math.max(
    1,
    Math.ceil(recentHeadlines.length / HEADLINES_PER_PAGE)
  );

  const getHeadlineId = useCallback(
    (headline: any) =>
      headline?.item?.link || `${headline?.source?.source}-${headline?.item?.title || "headline"}`,
    []
  );

  const pinnedHeadline = useMemo(() => {
    if (!pinnedHeadlineId) return null;
    return recentHeadlines.find((headline: any) => getHeadlineId(headline) === pinnedHeadlineId) || null;
  }, [recentHeadlines, pinnedHeadlineId, getHeadlineId]);

  const visibleHeadlines = useMemo(() => {
    const start = (headlinePage % headlinePageCount) * HEADLINES_PER_PAGE;
    if (!pinnedHeadline) {
      return recentHeadlines.slice(start, start + HEADLINES_PER_PAGE);
    }
    const pageItems = recentHeadlines
      .slice(start, start + HEADLINES_PER_PAGE)
      .filter((headline: any) => getHeadlineId(headline) !== getHeadlineId(pinnedHeadline));
    return [pinnedHeadline, ...pageItems].slice(0, HEADLINES_PER_PAGE);
  }, [recentHeadlines, headlinePage, headlinePageCount, pinnedHeadline, getHeadlineId]);

  const selectedHeadlineId = useMemo(() => {
    if (!selectedNewsItem) return null;
    return getHeadlineId(selectedNewsItem);
  }, [selectedNewsItem, getHeadlineId]);

  useEffect(() => {
    if (headlinePage >= headlinePageCount) {
      setHeadlinePage(0);
    }
  }, [headlinePage, headlinePageCount]);

  useEffect(() => {
    if (headlinesPaused || !!pinnedHeadline || headlinePageCount <= 1) return;
    const interval = setInterval(() => {
      setHeadlinePage((prev) => (prev + 1) % headlinePageCount);
    }, HEADLINES_ROTATE_MS);
    return () => clearInterval(interval);
  }, [headlinesPaused, pinnedHeadline, headlinePageCount]);

  useEffect(() => {
    if (pinnedHeadlineId && !pinnedHeadline) {
      setPinnedHeadlineId(null);
    }
  }, [pinnedHeadlineId, pinnedHeadline]);

  const handleHeadlineShareEmail = useCallback((headline: any) => {
    const title = headline?.item?.title || "Industry headline";
    const link = headline?.item?.link || "";
    const subject = encodeURIComponent(title);
    const body = encodeURIComponent(`Thought you might find this useful:\n\n${title}\n${link}`);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
  }, []);

  const handleHeadlineCopyLink = useCallback(async (headline: any) => {
    const link = headline?.item?.link;
    if (!link) return;
    const headlineId = getHeadlineId(headline);
    try {
      await navigator.clipboard.writeText(link);
      setCopiedHeadlineId(headlineId);
      window.setTimeout(() => {
        setCopiedHeadlineId((current) => (current === headlineId ? null : current));
      }, 1500);
    } catch (error) {
      console.warn("Could not copy article link:", error);
    }
  }, [getHeadlineId]);

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

  const fetchArticleBrief = useCallback(async (item: any, source: any) => {
    setArticleBriefLoading(true);
    setArticleBrief(null);
    try {
      const result = await api.getNewsDetails({
        title: item.title,
        source: source.source,
        link: item.link,
      });
      setArticleBrief(result);
    } catch (error: any) {
      console.error("[News] Failed to fetch article brief:", error);
      setArticleBrief({
        articleParagraphs: [
          `We could not extract article body text for "${item.title}".`,
          "Use the full-article view below to read the complete source content directly from the publisher.",
          "Cohi insights are still shown below for quick executive context.",
        ],
        fullArticleUrl: item.link,
        fetchedAt: new Date().toISOString(),
        error: "Could not generate article brief",
      });
    } finally {
      setArticleBriefLoading(false);
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
    fetchArticleBrief(item, source);
  };

  const prewarmArticleLink = useCallback((link?: string) => {
    if (!link || typeof document === "undefined") return;
    if (warmedArticleLinksRef.current.has(link)) return;

    try {
      const url = new URL(link);
      const head = document.head;

      const dnsPrefetch = document.createElement("link");
      dnsPrefetch.rel = "dns-prefetch";
      dnsPrefetch.href = url.origin;
      head.appendChild(dnsPrefetch);

      const preconnect = document.createElement("link");
      preconnect.rel = "preconnect";
      preconnect.href = url.origin;
      preconnect.crossOrigin = "anonymous";
      head.appendChild(preconnect);

      const prefetch = document.createElement("link");
      prefetch.rel = "prefetch";
      prefetch.as = "document";
      prefetch.href = link;
      head.appendChild(prefetch);

      warmedArticleLinksRef.current.add(link);

      // Remove hint elements later to avoid unbounded head growth.
      window.setTimeout(() => {
        dnsPrefetch.remove();
        preconnect.remove();
        prefetch.remove();
      }, 60_000);
    } catch {
      // Ignore invalid/malformed URLs; full article can still open normally.
    }
  }, []);

  useEffect(() => {
    setExcerptPage(0);
  }, [selectedNewsItem, articleBrief]);

  const excerptParagraphs = articleBrief?.articleParagraphs || [];
  const excerptPageCount = Math.max(
    1,
    Math.ceil(excerptParagraphs.length / EXCERPT_PARAGRAPHS_PER_PAGE)
  );
  const visibleExcerptParagraphs = excerptParagraphs.slice(
    excerptPage * EXCERPT_PARAGRAPHS_PER_PAGE,
    (excerptPage + 1) * EXCERPT_PARAGRAPHS_PER_PAGE
  );

  useEffect(() => {
    if (excerptPage >= excerptPageCount) {
      setExcerptPage(0);
    }
  }, [excerptPage, excerptPageCount]);

  const openChartDrilldown = useCallback((chartKey: DrilldownChartKey) => {
    setActiveChart(chartKey);
    setDrilldownRange("mtd");
    setShowChartDrilldown(true);
  }, []);

  const openDataSourceModal = useCallback((chartKey: DrilldownChartKey) => {
    const source = CHART_SOURCE_META[chartKey];
    if (!source) return;
    window.open(source.url, "_blank", "noopener,noreferrer");
  }, []);

  // Build range start dates (YYYY-MM-DD) for filtering FRED observations
  const rangeStartDates = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const mtd = new Date(y, m, 1);
    const qtrMonth = Math.floor(m / 3) * 3;
    const qtr = new Date(y, qtrMonth, 1);
    const ytd = new Date(y, 0, 1);
    const threeY = new Date(y - 3, 0, 1);
    const fmt = (d: Date) => d.toISOString().split("T")[0];
    return { mtd: fmt(mtd), qtr: fmt(qtr), ytd: fmt(ytd), "3y": fmt(threeY) };
  }, []);

  const displayRateSnapshotData = useMemo(() => {
    const s = currentObmmiSeries;
    const products = [
      { key: "conforming" as const, product: "30-Yr Fixed" },
      { key: "conforming15yr" as const, product: "15-Yr Fixed" },
      { key: "fha" as const, product: "30-Yr FHA" },
      { key: "jumbo" as const, product: "30-Yr Jumbo" },
      { key: "va" as const, product: "30-Yr VA" },
      { key: "usda" as const, product: "30-Yr USDA" },
    ];
    if (!s) return products.map((p) => ({ product: p.product, prior: null, today: null }));
    return products.map((p) => ({
      product: p.product,
      prior: s[p.key]?.priorRate ?? null,
      today: s[p.key]?.rate ?? null,
    }));
  }, [currentObmmiSeries]);

  const rateSnapshotChartData = useMemo(
    () =>
      displayRateSnapshotData.map((r) => ({
        product: r.product,
        prior: r.prior ?? 0,
        today: r.today ?? 0,
      })),
    [displayRateSnapshotData]
  );

  const displayExistingHomeSalesData = useMemo(() => {
    if (chartDataLoading || !existingHomeSalesObservations?.length) return [];
    return existingHomeSalesObservations.map((o) => ({
      month: formatFredDateAsMonthYear(o.date),
      value: o.value,
    }));
  }, [existingHomeSalesObservations, chartDataLoading]);

  // Resolved drilldown data: use FRED API data for fixedRate/treasury/rateSnapshot/existingSales when available
  const resolvedDrilldownData = useMemo(() => {
    const base = { ...CHART_DRILLDOWN_DATA };
    if (fixedRateObservations?.length) {
      const filter = (range: DrilldownRange) => {
        const start = rangeStartDates[range];
        return fixedRateObservations
          .filter((o) => o.date >= start)
          .map((o) => ({ week: formatFredDateShort(o.date), rate: o.rate }));
      };
      base.fixedRate = {
        mtd: filter("mtd"),
        qtr: filter("qtr"),
        ytd: filter("ytd"),
        "3y": filter("3y"),
      };
    }
    if (treasuryObservations?.length) {
      const filter = (range: DrilldownRange) => {
        const start = rangeStartDates[range];
        return treasuryObservations
          .filter((o) => o.date >= start)
          .map((o) => ({ date: formatFredDateShort(o.date), yield: o.yield }));
      };
      base.treasury = {
        mtd: filter("mtd"),
        qtr: filter("qtr"),
        ytd: filter("ytd"),
        "3y": filter("3y"),
      };
    }
    if (displayRateSnapshotData.some((r) => r.today != null)) {
      base.rateSnapshot = {
        mtd: rateSnapshotChartData,
        qtr: rateSnapshotChartData,
        ytd: rateSnapshotChartData,
        "3y": rateSnapshotChartData,
      };
    }
    if (existingHomeSalesObservations?.length) {
      const filter = (range: DrilldownRange) => {
        const start = rangeStartDates[range];
        return existingHomeSalesObservations
          .filter((o) => o.date >= start)
          .map((o) => ({
            month: formatFredDateAsMonthYear(o.date),
            value: o.value,
          }));
      };
      base.existingSales = {
        mtd: filter("mtd"),
        qtr: filter("qtr"),
        ytd: filter("ytd"),
        "3y": filter("3y"),
      };
    }
    return base;
  }, [fixedRateObservations, treasuryObservations, rangeStartDates, displayRateSnapshotData, existingHomeSalesObservations, rateSnapshotChartData]);

  const availableDrilldownRanges = useMemo<DrilldownRange[]>(() => {
    if (!activeChart) return [];
    return (Object.keys(resolvedDrilldownData[activeChart]) as DrilldownRange[]).filter(
      (range) => (resolvedDrilldownData[activeChart][range] || []).length > 0
    );
  }, [activeChart, resolvedDrilldownData]);

  // Preview data for the 30-Yr Fixed and 10-Yr Treasury cards (last ~8 points when from API). No fallback when loading or no data.
  const displayFixedRateData = useMemo(() => {
    if (chartDataLoading || !fixedRateObservations?.length) return [];
    return fixedRateObservations.slice(-8).map((o) => ({
      week: formatFredDateShort(o.date),
      rate: o.rate,
    }));
  }, [fixedRateObservations, chartDataLoading]);

  const displayTreasuryData = useMemo(() => {
    if (chartDataLoading || !treasuryObservations?.length) return [];
    return treasuryObservations.slice(-8).map((o) => ({
      date: formatFredDateShort(o.date),
      yield: o.yield,
    }));
  }, [treasuryObservations, chartDataLoading]);

  useEffect(() => {
    if (!showChartDrilldown || !activeChart) return;
    if (!availableDrilldownRanges.includes(drilldownRange)) {
      setDrilldownRange(availableDrilldownRanges[0] || "mtd");
    }
  }, [showChartDrilldown, activeChart, drilldownRange, availableDrilldownRanges]);

  useEffect(() => {
    prewarmArticleLink(selectedNewsItem?.item?.link);
  }, [selectedNewsItem, prewarmArticleLink]);

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

  const chartTitles: Record<DrilldownChartKey, string> = {
    fixedRate: "30-Yr Fixed Rate",
    treasury: "10-Yr Treasury Yield",
    mba: "MBA Application Index",
    nahb: "NAHB Builder Confidence",
    rateSnapshot: "Rate Snapshot by Product",
    existingSales: "Existing Home Sales (SAAR)",
  };

  const renderDrilldownChart = () => {
    if (!activeChart) return null;
    const isLoading =
      (activeChart === "fixedRate" || activeChart === "treasury" || activeChart === "existingSales") && chartDataLoading ||
      (activeChart === "rateSnapshot" && currentRatesLoading);
    if (isLoading) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin" />
          <span className="text-sm font-medium">Loading rates</span>
        </div>
      );
    }
    const chartData = resolvedDrilldownData[activeChart][drilldownRange];
    if (!chartData || chartData.length === 0) {
      return (
        <div className="h-full flex items-center justify-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Data not available for this range yet.
          </p>
        </div>
      );
    }

    if (activeChart === "fixedRate") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <RechartsTooltip formatter={(v: number) => [`${Number(v).toFixed(3)}%`, "Rate"]} />
            <Line type="monotone" dataKey="rate" stroke="rgb(59, 130, 246)" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (activeChart === "treasury") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <RechartsTooltip formatter={(v: number) => [`${Number(v).toFixed(3)}%`, "Yield"]} />
            <Line type="monotone" dataKey="yield" stroke="rgb(249, 115, 22)" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      );
    }

    if (activeChart === "mba") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} barCategoryGap="20%">
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="week" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Legend />
            <Bar dataKey="purchase" fill="rgb(59, 130, 246)" name="Purchase" radius={[4, 4, 0, 0]} />
            <Bar dataKey="refi" fill="rgb(249, 115, 22)" name="Refi" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (activeChart === "nahb") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis dataKey="month" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Bar dataKey="value" fill="rgb(59, 130, 246)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    if (activeChart === "rateSnapshot") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }} layout="vertical" barCategoryGap="14%">
            <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
            <XAxis type="number" tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}%`} />
            <YAxis type="category" dataKey="product" tick={{ fontSize: 12 }} width={120} />
            <RechartsTooltip formatter={(v: number) => [`${v}%`, ""]} />
            <Legend />
            <Bar dataKey="prior" fill="rgb(148, 163, 184)" name="Prior Week" radius={[0, 4, 4, 0]} />
            <Bar dataKey="today" fill="rgb(59, 130, 246)" name="Today" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
          <XAxis dataKey="month" tick={{ fontSize: 12 }} />
          <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${v}M`} />
          <RechartsTooltip formatter={(v: number) => [`${v}M`, "Units"]} />
          <Bar dataKey="value" fill="rgb(59, 130, 246)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
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
        {/* Daily Morning Brief Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5 md:mb-6">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg flex-shrink-0">
              <Newspaper className="w-5 h-5 sm:w-6 sm:h-6 text-white" strokeWidth={1.5} />
            </div>
            <div>
              <h3 className="text-xl sm:text-2xl md:text-3xl font-semibold text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight">
                Cohi Daily Morning Brief
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 font-light mt-0.5">
                {format(new Date(), "EEEE, MMMM d, yyyy")} | Markets & Economy Update
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CohiPodcast />
            <ExportMenu
              title="Industry News"
              targetRef={cardRef}
            />
            <button
              onClick={() => navigate("/settings?tab=notifications")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700 text-xs sm:text-sm text-slate-700 dark:text-slate-200"
              aria-label="Manage email notifications and daily brief"
            >
              <Mail className="w-4 h-4" strokeWidth={1.8} />
              Notifications
            </button>
            <button
              onClick={() => setShowSourceSelector(true)}
              className="flex items-center justify-center p-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all border border-slate-200 dark:border-slate-700"
              aria-label="Select news sources"
            >
              <Settings className="w-5 h-5 text-slate-700 dark:text-slate-300" strokeWidth={1.5} />
            </button>
          </div>
        </div>

        {/* Market Intelligence Ticker - rate strip */}
        <div className="mb-5 md:mb-6">
          <MarketIntelligenceTicker loading={currentRatesLoading} seriesFromApi={currentObmmiSeries} />
          {currentRatesFailed && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 text-center">
              Unable to load rates.{" "}
              <button
                type="button"
                onClick={() => setCurrentRatesRetryKey((k) => k + 1)}
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                Retry
              </button>
            </p>
          )}
        </div>

        {/* Charts Grid - 2 rows x 3 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5 mb-6 md:mb-8">
          {/* 30-Yr Fixed Rate */}
          <div
            className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            onClick={() => openChartDrilldown("fixedRate")}
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">30-YR FIXED RATE</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">OBMMI 30 Year Fixed Rate Conforming Mortgage Index</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDataSourceModal("fixedRate");
              }}
              className="mb-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Source: {CHART_SOURCE_META.fixedRate.label}
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="h-[140px] w-full">
              {chartDataLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-medium">Loading rates</span>
                </div>
              ) : displayFixedRateData.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400 text-xs">
                  {chartDataFailed ? (
                    <>
                      <span>Unable to load rates.</span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setChartDataRetryKey((k) => k + 1); }}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        Retry
                      </button>
                    </>
                  ) : (
                    "No data available"
                  )}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={displayFixedRateData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                    <XAxis dataKey="week" tick={{ fontSize: 10 }} stroke="currentColor" className="fill-slate-500" />
                    <YAxis domain={["dataMin - 0.2", "dataMax + 0.2"]} tick={{ fontSize: 10 }} width={28} tickFormatter={(v) => `${v}%`} />
                    <RechartsTooltip formatter={(v: number) => [`${Number(v).toFixed(3)}%`, "Rate"]} contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="rate" stroke="rgb(59, 130, 246)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {/* 10-Yr Treasury */}
          <div
            className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            onClick={() => openChartDrilldown("treasury")}
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">10-YR TREASURY YIELD</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">~65bps of Fed cuts priced for 2026</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDataSourceModal("treasury");
              }}
              className="mb-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Source: U.S. Treasury
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="h-[140px] w-full">
              {chartDataLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-medium">Loading rates</span>
                </div>
              ) : displayTreasuryData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-xs">No data available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={displayTreasuryData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis domain={["dataMin - 0.05", "dataMax + 0.05"]} tick={{ fontSize: 10 }} width={28} tickFormatter={(v) => `${v}%`} />
                    <RechartsTooltip formatter={(v: number) => [`${Number(v).toFixed(3)}%`, "Yield"]} contentStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="yield" stroke="rgb(249, 115, 22)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {/* MBA Application Index */}
          <div
            className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            onClick={() => openChartDrilldown("mba")}
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">MBA APPLICATION INDEX</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Refi share of total apps</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDataSourceModal("mba");
              }}
              className="mb-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Source: MBA Weekly Applications Survey
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={MBA_INDEX_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} width={28} />
                  <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="purchase" fill="rgb(59, 130, 246)" name="Purchase" radius={[2, 2, 0, 0]} />
                  <Bar dataKey="refi" fill="rgb(249, 115, 22)" name="Refi" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* NAHB Builder Confidence */}
          <div
            className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            onClick={() => openChartDrilldown("nahb")}
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">NAHB BUILDER CONFIDENCE</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Feb forecast releasing 10am ET</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDataSourceModal("nahb");
              }}
              className="mb-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Source: NAHB HMI
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="h-[140px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={NAHB_DATA} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 50]} tick={{ fontSize: 10 }} width={28} />
                  <RechartsTooltip contentStyle={{ fontSize: 12 }} />
                  <Bar dataKey="value" fill="rgb(59, 130, 246)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          {/* Rate Snapshot by Product */}
          <div
            className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            onClick={() => openChartDrilldown("rateSnapshot")}
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">RATE SNAPSHOT BY PRODUCT</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Prior week vs today</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDataSourceModal("rateSnapshot");
              }}
              className="mb-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Source: Optimal Blue OBMMI
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="h-[140px] w-full">
              {currentRatesLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-medium">Loading rates</span>
                </div>
              ) : !displayRateSnapshotData.some((r) => r.today != null) ? (
                <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-xs">No data available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rateSnapshotChartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} layout="vertical" barCategoryGap="12%">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                    <XAxis type="number" domain={["auto", "auto"]} tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="product" tick={{ fontSize: 10 }} width={70} />
                    <RechartsTooltip formatter={(v: number) => [`${v}%`, ""]} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="prior" fill="rgb(148, 163, 184)" name="Prior Week" radius={[0, 2, 2, 0]} />
                    <Bar dataKey="today" fill="rgb(59, 130, 246)" name="Today" radius={[0, 2, 2, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
          {/* Existing Home Sales */}
          <div
            className="rounded-xl bg-slate-50/80 dark:bg-slate-800/40 p-4 border border-slate-200/60 dark:border-slate-700/50 cursor-pointer hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
            onClick={() => openChartDrilldown("existingSales")}
          >
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">EXISTING HOME SALES (SAAR)</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Jan drops — weather impact muted</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                openDataSourceModal("existingSales");
              }}
              className="mb-2 inline-flex items-center gap-1 text-[11px] text-blue-600 dark:text-blue-400 hover:underline"
            >
              Source: NAR Existing-Home Sales
              <ExternalLink className="w-3 h-3" />
            </button>
            <div className="h-[140px] w-full">
              {chartDataLoading ? (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-500 dark:text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-xs font-medium">Loading rates</span>
                </div>
              ) : displayExistingHomeSalesData.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-500 dark:text-slate-400 text-xs">No data available</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={displayExistingHomeSalesData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-600" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={28} tickFormatter={(v) => `${v}M`} />
                    <RechartsTooltip formatter={(v: number) => [`${v}M`, "Units"]} contentStyle={{ fontSize: 12 }} />
                    <Bar dataKey="value" fill="rgb(59, 130, 246)" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>

        {/* TOP HEADLINES */}
        <div
          className="border-t border-slate-200/60 dark:border-slate-700/50 pt-5 md:pt-6"
          onMouseEnter={() => setHeadlinesPaused(true)}
          onMouseLeave={() => setHeadlinesPaused(false)}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5 mb-4">
            <h4 className="text-lg font-medium text-slate-900 dark:text-white">TOP HEADLINES</h4>
            <div className="flex flex-col sm:items-end text-xs text-slate-500 dark:text-slate-400">
              <span>Click through for full articles</span>
              <span className="mt-0.5">
                {newsLoading
                  ? "Refreshing..."
                  : `Last fetched: ${
                      lastNewsUpdate
                        ? lastNewsUpdate.toLocaleString([], {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "N/A"
                    }`}
              </span>
              <span className="mt-0.5">
                {pinnedHeadline ? "Pinned in place • rotation paused" : "Auto-rotates every 15s when unpinned"}
              </span>
            </div>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleHeadlines.map((headline: any, idx: number) => (
              <li key={`${headline.source.source}-${headline.item.link || idx}`} className="h-full">
                <div className="w-full h-full p-3.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/35 hover:bg-slate-100 dark:hover:bg-slate-800/55 border border-slate-200/50 dark:border-slate-700/50 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm hover:shadow-md">
                  <button
                    type="button"
                    onClick={() => handleNewsItemClick(headline.item, headline.source)}
                    className="w-full text-left group"
                  >
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 group-hover:text-blue-600 dark:group-hover:text-blue-400 line-clamp-2">
                      {headline.item.title}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 line-clamp-3">
                      {headline.item.excerpt ||
                        headline.item.description ||
                        headline.item.summary ||
                        "Read more"}
                    </p>
                  </button>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                      [{headline.source.source}] • {headline.releaseLabel}
                    </p>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleHeadlineShareEmail(headline);
                        }}
                        className="w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                        aria-label="Share by email"
                        title="Share by email"
                      >
                        <Mail className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleHeadlineCopyLink(headline);
                        }}
                        className="w-7 h-7 rounded-md border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                        aria-label="Copy article link"
                        title={copiedHeadlineId === getHeadlineId(headline) ? "Copied" : "Copy link"}
                      >
                        <Link2 className="w-3.5 h-3.5" strokeWidth={1.8} />
                      </button>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          const headlineId = getHeadlineId(headline);
                          setPinnedHeadlineId((current) => (current === headlineId ? null : headlineId));
                        }}
                        className={`w-7 h-7 rounded-md border flex items-center justify-center ${
                          pinnedHeadlineId === getHeadlineId(headline)
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400"
                            : "border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                        }`}
                        aria-label={pinnedHeadlineId === getHeadlineId(headline) ? "Unpin headline" : "Pin headline in place"}
                        title={pinnedHeadlineId === getHeadlineId(headline) ? "Unpin" : "Pin in place"}
                      >
                        {pinnedHeadlineId === getHeadlineId(headline) ? (
                          <PinOff className="w-3.5 h-3.5" strokeWidth={1.8} />
                        ) : (
                          <Pin className="w-3.5 h-3.5" strokeWidth={1.8} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {headlinePageCount > 1 && (
            <div className="mt-3 flex items-center justify-center gap-1.5">
              {Array.from({ length: headlinePageCount }).map((_, idx) => (
                <span
                  key={`headline-page-${idx}`}
                  className={`h-1.5 rounded-full transition-all ${
                    idx === headlinePage ? "w-5 bg-blue-500" : "w-1.5 bg-slate-300 dark:bg-slate-600"
                  }`}
                />
              ))}
            </div>
          )}
          {recentHeadlines.length === 0 && !newsLoading && (
            <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
              No recent lending headlines are available right now. Try refreshing in a moment.
            </p>
          )}
        </div>
      </motion.div>

      <Dialog
        open={showChartDrilldown}
        onOpenChange={(open) => {
          setShowChartDrilldown(open);
          if (!open) setActiveChart(null);
        }}
      >
        <DialogContent className="left-0 top-0 translate-x-0 translate-y-0 w-screen max-w-none h-[100dvh] max-h-[100dvh] rounded-none p-0 gap-0 overflow-hidden bg-white dark:bg-slate-900 border-0 shadow-none [&>button]:hidden">
          <div className="h-full flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200/60 dark:border-slate-700/50">
              <div>
                <DialogTitle className="text-base sm:text-lg font-medium text-slate-900 dark:text-slate-100">
                  {activeChart ? `${chartTitles[activeChart]} Drilldown` : "Chart Drilldown"}
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {activeChart === "rateSnapshot"
                    ? "Prior week vs today by product"
                    : "MTD, QTR, YTD, and 3-year views (when available)"}
                </DialogDescription>
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowChartDrilldown(false);
                  setActiveChart(null);
                }}
                className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close chart drilldown"
              >
                <X className="w-4 h-4 text-slate-500 dark:text-slate-400" strokeWidth={1.8} />
              </button>
            </div>

            {activeChart !== "rateSnapshot" && (
            <div className="px-4 pt-3 pb-2 border-b border-slate-200/60 dark:border-slate-700/50 flex items-center gap-2 overflow-x-auto">
              {(Object.keys(DRILLDOWN_RANGE_LABELS) as DrilldownRange[]).map((range) => {
                const hasData = availableDrilldownRanges.includes(range);
                return (
                  <button
                    key={range}
                    type="button"
                    disabled={!hasData}
                    onClick={() => setDrilldownRange(range)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap ${
                      drilldownRange === range
                        ? "bg-blue-600 text-white border-blue-600"
                        : hasData
                        ? "bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                        : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border-slate-200 dark:border-slate-700 cursor-not-allowed"
                    }`}
                  >
                    {DRILLDOWN_RANGE_LABELS[range]}
                  </button>
                );
              })}
            </div>
            )}

            <div className="flex-1 p-4 sm:p-6">
              <div className="h-full min-h-[420px] rounded-xl border border-slate-200/60 dark:border-slate-700/50 bg-slate-50/40 dark:bg-slate-800/30 p-3 sm:p-4">
                {renderDrilldownChart()}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
        onOpenChange={(open) => {
          if (!open) {
            setSelectedNewsItem(null);
          }
        }}
      >
        <DialogContent
          className="
            /* Fullscreen on all breakpoints */
            inset-0 top-0 bottom-0 left-0 right-0
            translate-x-0 translate-y-0
            w-screen max-w-none
            h-[100dvh] max-h-none
            rounded-none
            p-0 gap-0
            overflow-hidden
            bg-white dark:bg-slate-900
            border-0
            shadow-none
            [&>button]:hidden
            safe-area-inset
          "
        >
          {selectedNewsItem && (
            <div className="flex flex-col h-full">
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
                <div className="flex items-center gap-1.5 ml-3">
                  <button
                    type="button"
                    onClick={() => handleHeadlineShareEmail(selectedNewsItem)}
                    className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                    aria-label="Share by email"
                    title="Share by email"
                  >
                    <Mail className="w-4 h-4" strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleHeadlineCopyLink(selectedNewsItem)}
                    className="w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                    aria-label="Copy article link"
                    title={copiedHeadlineId === selectedHeadlineId ? "Copied" : "Copy link"}
                  >
                    <Link2 className="w-4 h-4" strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setPinnedHeadlineId((current) =>
                        current === selectedHeadlineId ? null : selectedHeadlineId
                      )
                    }
                    className={`w-9 h-9 rounded-full border flex items-center justify-center ${
                      pinnedHeadlineId === selectedHeadlineId
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-400"
                        : "border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400"
                    }`}
                    aria-label={pinnedHeadlineId === selectedHeadlineId ? "Unpin headline" : "Pin headline in place"}
                    title={pinnedHeadlineId === selectedHeadlineId ? "Unpin" : "Pin in place"}
                  >
                    {pinnedHeadlineId === selectedHeadlineId ? (
                      <PinOff className="w-4 h-4" strokeWidth={1.8} />
                    ) : (
                      <Pin className="w-4 h-4" strokeWidth={1.8} />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setSelectedNewsItem(null);
                    }}
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

                {/* Article Content (full extracted excerpt with pagination) */}
                <div className="mb-5 sm:mb-5 md:mb-6">
                  <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
                    Article Excerpt
                  </p>
                  {articleBriefLoading ? (
                    <div className="space-y-2.5">
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-full" />
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-11/12" />
                      <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-10/12" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {visibleExcerptParagraphs.map((paragraph, idx) => (
                        <p
                          key={`excerpt-${excerptPage}-${idx}`}
                          className="text-[0.9375rem] leading-[1.7] sm:text-base sm:leading-[1.7] text-slate-700 dark:text-slate-300 font-light tracking-tight break-words"
                        >
                          {paragraph}
                        </p>
                      ))}

                      {excerptPageCount > 1 && (
                        <div className="pt-2 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() =>
                              setExcerptPage((prev) =>
                                prev === 0 ? excerptPageCount - 1 : prev - 1
                              )
                            }
                            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Previous
                          </button>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            Page {excerptPage + 1} of {excerptPageCount}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setExcerptPage((prev) =>
                                prev >= excerptPageCount - 1 ? 0 : prev + 1
                              )
                            }
                            className="px-3 py-1.5 rounded-lg text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

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
                      <div className="space-y-2">
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-full" />
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-11/12" />
                        <div className="h-4 bg-slate-200 dark:bg-slate-700 rounded animate-pulse w-10/12" />
                      </div>
                    ) : (
                      <p className="text-[0.9375rem] sm:text-sm md:text-base text-slate-700 dark:text-slate-300 leading-[1.7] font-light tracking-tight break-words">
                        {insights?.insights && insights.insights.length > 0
                          ? insights.insights
                              .map((insight) => `${insight.label}: ${insight.content}`)
                              .join(" ")
                          : "This development may indicate broader market and operational implications across lending. Read the full article for complete context."}
                        {insights?.clientDataSummary
                          ? ` Your Data: ${insights.clientDataSummary}`
                          : ""}
                      </p>
                    )}
                  </div>
                </div>

                {/* Open full article in new tab */}
                <a
                  href={selectedNewsItem?.item?.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseEnter={() => prewarmArticleLink(selectedNewsItem?.item?.link)}
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
                  <span>View Full Article</span>
                </a>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
};
