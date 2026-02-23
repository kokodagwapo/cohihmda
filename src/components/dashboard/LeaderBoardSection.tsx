import { useState, useMemo, useCallback, useRef } from "react";
import {
  ChevronUp,
  Medal,
  Rocket,
  Timer,
  ShieldCheck,
  Gauge,
  Zap,
  CalendarDays,
  ChevronDown,
  X,
  UserRound,
} from "lucide-react";
import {
  format,
  subQuarters,
  subMonths,
  subYears,
  startOfQuarter,
  startOfMonth,
  startOfYear,
  endOfQuarter,
  endOfMonth,
  endOfYear,
  startOfWeek,
  subWeeks,
} from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  useLeaderboardData,
  LeaderboardLeader,
  LeaderboardTimeframe,
} from "@/hooks/useLeaderboardData";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ExportMenu } from "@/components/common/ExportMenu";
import type { ExportData } from "@/utils/exportUtils";

/** Golden certificate seal icon (scalloped border, star ring, blank center) for rank badge */
function CertificateSealIcon({
  className,
  size = 32,
  id: sealId,
}: {
  className?: string;
  size?: number;
  id: string;
}) {
  const r = size / 2;
  const rays = 20;
  const points: string[] = [];
  for (let i = 0; i < rays * 2; i++) {
    const a = (i * Math.PI) / rays - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.88;
    points.push(`${r + radius * Math.cos(a)},${r + radius * Math.sin(a)}`);
  }
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={cn("flex-shrink-0", className)}
      width={size}
      height={size}
      aria-hidden
    >
      <defs>
        <linearGradient id={sealId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fef3c7" />
          <stop offset="50%" stopColor="#fcd34d" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <filter
          id={`${sealId}-sh`}
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feDropShadow dx="0" dy="1" stdDeviation="0.5" floodOpacity="0.3" />
        </filter>
      </defs>
      <polygon
        points={points.join(" ")}
        fill={`url(#${sealId})`}
        filter={`url(#${sealId}-sh)`}
      />
      <circle
        cx={r}
        cy={r}
        r={r * 0.72}
        fill="none"
        stroke="rgba(253,230,138,0.6)"
        strokeWidth={0.5}
      />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 2 * Math.PI) / 12 - Math.PI / 2;
        const cx = r + r * 0.6 * Math.cos(a);
        const cy = r + r * 0.6 * Math.sin(a);
        const ir = 1.2;
        const star = Array.from({ length: 5 }, (__, k) => {
          const ang = (k * 4 * Math.PI) / 5 - Math.PI / 2;
          return `${cx + ir * Math.cos(ang)},${cy + ir * Math.sin(ang)}`;
        }).join(" ");
        return <polygon key={i} points={star} fill="rgba(180,83,9,0.4)" />;
      })}
    </svg>
  );
}

// Period types for the leaderboard
type PeriodType = "wtd" | "mtd" | "qtd" | "lw" | "lm" | "lq" | "ly" | "custom";

// Period display labels
const periodLabels: Record<PeriodType, { short: string; long: string }> = {
  wtd: { short: "WTD", long: "Week-to-Date" },
  mtd: { short: "MTD", long: "Month-to-Date" },
  qtd: { short: "QTD", long: "Quarter-to-Date" },
  lw: { short: "LW", long: "Last Week" },
  lm: { short: "LM", long: "Last Month" },
  lq: { short: "LQ", long: "Last Quarter" },
  ly: { short: "LY", long: "Last Year" },
  custom: { short: "Custom", long: "Custom Range" },
};

interface LeaderBoardSectionProps {
  dateFilter: "today" | "mtd" | "ytd" | "custom";
  selectedTenantId?: string | null;
  /** When true, avatars are hidden (e.g. on /dashboard). */
  hideAvatar?: boolean;
  /** Optional channel filter - filters leaderboard to loans in the selected channel */
  selectedChannel?: string | null;
}

export const LeaderBoardSection = ({
  dateFilter,
  selectedTenantId,
  hideAvatar = false,
  selectedChannel,
}: LeaderBoardSectionProps) => {
  const sectionRef = useRef<HTMLDivElement>(null);
  // Default to Last Quarter (lq)
  const [period, setPeriod] = useState<PeriodType>("lq");
  const [scope, setScope] = useState<"All" | "Branch" | "Team">("All");
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const [ranks6To10Expanded, setRanks6To10Expanded] = useState(false);
  const [rankingMetric, setRankingMetric] = useState<
    "units" | "volume" | "turnTime" | "pullThrough" | "revenue"
  >("units");
  const [customDateRange, setCustomDateRange] = useState<{
    start: Date | null;
    end: Date | null;
  }>({
    start: null,
    end: null,
  });
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [quarterYear, setQuarterYear] = useState(new Date().getFullYear());

  // Calculate date range based on period selection
  const calculateDateRange = useCallback(
    (
      periodType: PeriodType
    ): { startDate: string; endDate: string } | undefined => {
      const today = new Date();

      switch (periodType) {
        case "wtd": {
          const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
          return {
            startDate: format(weekStart, "yyyy-MM-dd"),
            endDate: format(today, "yyyy-MM-dd"),
          };
        }
        case "mtd": {
          const monthStart = startOfMonth(today);
          return {
            startDate: format(monthStart, "yyyy-MM-dd"),
            endDate: format(today, "yyyy-MM-dd"),
          };
        }
        case "qtd": {
          const quarterStart = startOfQuarter(today);
          return {
            startDate: format(quarterStart, "yyyy-MM-dd"),
            endDate: format(today, "yyyy-MM-dd"),
          };
        }
        case "lw": {
          const lastWeekStart = startOfWeek(subWeeks(today, 1), {
            weekStartsOn: 1,
          });
          const lastWeekEnd = subWeeks(
            startOfWeek(today, { weekStartsOn: 1 }),
            0
          );
          lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
          return {
            startDate: format(lastWeekStart, "yyyy-MM-dd"),
            endDate: format(lastWeekEnd, "yyyy-MM-dd"),
          };
        }
        case "lm": {
          const lastMonth = subMonths(today, 1);
          return {
            startDate: format(startOfMonth(lastMonth), "yyyy-MM-dd"),
            endDate: format(endOfMonth(lastMonth), "yyyy-MM-dd"),
          };
        }
        case "lq": {
          const lastQuarter = subQuarters(today, 1);
          return {
            startDate: format(startOfQuarter(lastQuarter), "yyyy-MM-dd"),
            endDate: format(endOfQuarter(lastQuarter), "yyyy-MM-dd"),
          };
        }
        case "ly": {
          const lastYear = subYears(today, 1);
          return {
            startDate: format(startOfYear(lastYear), "yyyy-MM-dd"),
            endDate: format(endOfYear(lastYear), "yyyy-MM-dd"),
          };
        }
        case "custom": {
          if (customDateRange.start && customDateRange.end) {
            return {
              startDate: format(customDateRange.start, "yyyy-MM-dd"),
              endDate: format(customDateRange.end, "yyyy-MM-dd"),
            };
          }
          return undefined;
        }
        default:
          return undefined;
      }
    },
    [customDateRange]
  );

  // Map period to API timeframe
  const apiTimeframe = useMemo((): LeaderboardTimeframe => {
    if (period === "lw") return "custom";
    if (period === "custom") return "custom";
    return period as LeaderboardTimeframe;
  }, [period]);

  // Get date range for API
  const dateRangeFilter = useMemo(() => {
    return calculateDateRange(period);
  }, [period, calculateDateRange]);

  // Map scope filter for API
  const scopeFilter = useMemo(() => {
    return scope === "All" ? "all" : scope === "Branch" ? "branch" : "team";
  }, [scope]);

  const { leaderboardData } = useLeaderboardData(
    apiTimeframe,
    selectedTenantId,
    {
      scope: scopeFilter as "all" | "branch" | "team",
      startDate: dateRangeFilter?.startDate,
      endDate: dateRangeFilter?.endDate,
      channelGroup: selectedChannel || undefined,
    }
  );

  // Get the display label for current period
  const getPeriodDisplayLabel = () => {
    if (period === "custom" && customDateRange.start && customDateRange.end) {
      return `${format(customDateRange.start, "MMM d")} - ${format(
        customDateRange.end,
        "MMM d, yyyy"
      )}`;
    }
    return periodLabels[period].long;
  };


  const parseRevenue = (value?: string) => {
    if (!value) return 0;
    // Extract number and handle M (millions) and K (thousands) suffixes
    const numericPart = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (Number.isNaN(numericPart)) return 0;

    const upperValue = value.toUpperCase();
    if (upperValue.includes("M")) {
      return numericPart * 1000000;
    } else if (upperValue.includes("K")) {
      return numericPart * 1000;
    }
    return numericPart;
  };

  const getMetricValue = (
    leader: LeaderboardLeader,
    metric: "units" | "volume" | "turnTime" | "pullThrough" | "revenue"
  ) => {
    switch (metric) {
      case "units":
        return leader.loans;
      case "volume":
        return parseRevenue(leader.volume);
      case "turnTime":
        return leader.cycleTime;
      case "pullThrough":
        return leader.pullThru;
      case "revenue":
        return parseRevenue(leader.revenue);
      default:
        return leader.loans;
    }
  };

  const sortByMetric = (
    data: LeaderboardLeader[],
    metric: "units" | "volume" | "turnTime" | "pullThrough" | "revenue"
  ) => {
    return [...data].sort((a, b) => {
      const aValue = getMetricValue(a, metric);
      const bValue = getMetricValue(b, metric);
      if (metric === "turnTime") {
        return aValue - bValue; // lower is better
      }
      return bValue - aValue; // higher is better
    });
  };

  const buildRankMap = (
    data: LeaderboardLeader[],
    metric: "units" | "volume" | "turnTime" | "pullThrough" | "revenue"
  ) => {
    const sorted = sortByMetric(data, metric);
    return new Map(sorted.map((leader, idx) => [leader.id, idx + 1]));
  };

  // Get leader data - API already handles filtering by scope and timeframe
  const getLeadersData = (): LeaderboardLeader[] => {
    return leaderboardData;
  };

  const scopedData = getLeadersData();
  const leadersData = useMemo(
    () =>
      sortByMetric(scopedData, rankingMetric).map((leader, idx) => ({
        ...leader,
        rank: idx + 1,
      })),
    [scopedData, rankingMetric]
  );
  const rankMaps = useMemo(
    () => ({
      units: buildRankMap(scopedData, "units"),
      volume: buildRankMap(scopedData, "volume"),
      pullThrough: buildRankMap(scopedData, "pullThrough"),
      turnTime: buildRankMap(scopedData, "turnTime"),
      revenue: buildRankMap(scopedData, "revenue"),
    }),
    [scopedData]
  );
  const top5 = leadersData.slice(0, 5);
  const others = leadersData.slice(5);

  const getExportData = (): ExportData => {
    const headers = [
      "LO Name",
      "Units",
      "Ranking",
      "Volume $",
      "Ranking",
      "Pull-Through",
      "Ranking",
      "Turn-Time",
      "Ranking",
      "Revenue",
      "Ranking",
    ];
    const rows = leadersData.map((leader) => [
      leader.name,
      leader.loans,
      rankMap.units.get(leader.id) || "--",
      leader.volume,
      rankMap.volume.get(leader.id) || "--",
      `${leader.pullThru}%`,
      rankMap.pullThrough.get(leader.id) || "--",
      `${leader.cycleTime} days`,
      rankMap.turnTime.get(leader.id) || "--",
      leader.revenue,
      rankMap.revenue.get(leader.id) || "--",
    ]);
    return {
      title: "Leaderboard",
      tables: [
        {
          name: "Leaderboard Rankings",
          headers,
          rows,
        },
      ],
    };
  };

  return (
    <section
      ref={sectionRef}
      className="mt-4 sm:mt-6 rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-5 sm:p-6 md:p-8 space-y-6 sm:space-y-8"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
          <div className="relative flex-shrink-0">
            <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Medal
                className="w-5 h-5 sm:w-7 sm:h-7 text-white"
                strokeWidth={1.5}
              />
            </div>
          </div>
          <div className="min-w-0">
            <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
              Leaderboard
            </h3>
            <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light truncate">
              {getPeriodDisplayLabel()} ·{" "}
              {scope === "All"
                ? "All branches"
                : scope === "Branch"
                ? "By branch"
                : "By team"}{" "}
              · Ranked by{" "}
              {rankingMetric === "units"
                ? "Units"
                : rankingMetric === "volume"
                ? "Volume"
                : rankingMetric === "turnTime"
                ? "Turn-Time"
                : rankingMetric === "pullThrough"
                ? "Pull-through"
                : "Revenue"}
            </p>
          </div>
        </div>

        {/* Period Picker - DatePeriodPicker style */}
        <div className="flex items-center gap-2 flex-wrap">
          <ExportMenu
            title="Leaderboard"
            targetRef={sectionRef}
            getExportData={getExportData}
          />
          {/* To-Date periods */}
          <div className="flex gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100/80 dark:bg-slate-800/50 rounded-lg">
            {(["wtd", "mtd", "qtd"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap touch-manipulation",
                  period === p
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                )}
              >
                {periodLabels[p].short}
              </button>
            ))}
          </div>

          {/* Last period options */}
          <div className="flex gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100/80 dark:bg-slate-800/50 rounded-lg">
            {(["lw", "lm", "lq", "ly"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={cn(
                  "px-2 py-1 sm:px-2.5 sm:py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-all whitespace-nowrap touch-manipulation",
                  period === p
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                )}
                title={periodLabels[p].long}
              >
                {periodLabels[p].short}
              </button>
            ))}
          </div>

          {/* Custom date range picker */}
          <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn(
                  "gap-1 text-[10px] sm:text-xs h-7 sm:h-8 px-2 sm:px-3",
                  period === "custom"
                    ? "bg-white dark:bg-slate-700 border-slate-300 dark:border-slate-600"
                    : ""
                )}
              >
                <CalendarDays className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">
                  {period === "custom" &&
                  customDateRange.start &&
                  customDateRange.end
                    ? `${format(customDateRange.start, "MMM d")} - ${format(
                        customDateRange.end,
                        "MMM d"
                      )}`
                    : "Custom"}
                </span>
                <ChevronDown className="w-2.5 h-2.5 sm:w-3 sm:h-3 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <div className="p-3 border-b border-slate-200 dark:border-slate-700">
                <p className="text-sm font-medium text-slate-900 dark:text-white">
                  Select Date Range
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Quick select a quarter or choose custom dates
                </p>
              </div>

              {/* Quarter Quick Select */}
              <div className="p-3 border-b border-slate-200 dark:border-slate-700 space-y-2">
                {/* Year selector */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    Select Quarter
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setQuarterYear((prev) => prev - 1)}
                    >
                      <ChevronDown className="w-3 h-3 rotate-90" />
                    </Button>
                    <span className="text-sm font-semibold text-slate-900 dark:text-white w-12 text-center">
                      {quarterYear}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      disabled={quarterYear >= new Date().getFullYear()}
                      onClick={() => setQuarterYear((prev) => prev + 1)}
                    >
                      <ChevronDown className="w-3 h-3 -rotate-90" />
                    </Button>
                  </div>
                </div>
                {/* Quarter buttons */}
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4].map((q) => {
                    const qStart = new Date(quarterYear, (q - 1) * 3, 1);
                    const qEnd = endOfQuarter(qStart);
                    const isCurrentQuarter =
                      customDateRange.start?.getTime() === qStart.getTime() &&
                      customDateRange.end?.getTime() === qEnd.getTime();
                    const isFutureQuarter = qStart > new Date();

                    return (
                      <Button
                        key={q}
                        variant={isCurrentQuarter ? "default" : "outline"}
                        size="sm"
                        className={cn(
                          "h-8 text-xs",
                          isCurrentQuarter &&
                            "bg-teal-600 hover:bg-teal-700 text-white",
                          isFutureQuarter && "opacity-50"
                        )}
                        disabled={isFutureQuarter}
                        onClick={() => {
                          setCustomDateRange({ start: qStart, end: qEnd });
                          setPeriod("custom");
                          setCalendarOpen(false);
                        }}
                      >
                        Q{q}
                      </Button>
                    );
                  })}
                  {/* Full Year button */}
                  {(() => {
                    const yearStart = startOfYear(new Date(quarterYear, 0, 1));
                    const yearEnd =
                      quarterYear < new Date().getFullYear()
                        ? endOfYear(new Date(quarterYear, 0, 1))
                        : new Date(); // For current year, end at today
                    const isFullYear =
                      customDateRange.start?.getTime() ===
                        yearStart.getTime() &&
                      customDateRange.end?.getTime() === yearEnd.getTime();
                    const isFutureYear = quarterYear > new Date().getFullYear();

                    return (
                      <Button
                        variant={isFullYear ? "default" : "outline"}
                        size="sm"
                        className={cn(
                          "h-8 text-xs",
                          isFullYear &&
                            "bg-teal-600 hover:bg-teal-700 text-white",
                          isFutureYear && "opacity-50"
                        )}
                        disabled={isFutureYear}
                        onClick={() => {
                          setCustomDateRange({
                            start: yearStart,
                            end: yearEnd,
                          });
                          setPeriod("custom");
                          setCalendarOpen(false);
                        }}
                      >
                        Year
                      </Button>
                    );
                  })()}
                </div>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
                  Q1: Jan-Mar · Q2: Apr-Jun · Q3: Jul-Sep · Q4: Oct-Dec
                </p>
              </div>

              {/* Calendar for custom range */}
              <div className="p-2">
                <p className="text-xs font-medium text-slate-600 dark:text-slate-400 px-1 mb-2">
                  Or select custom range:
                </p>
                <Calendar
                  mode="range"
                  selected={{
                    from: customDateRange.start || undefined,
                    to: customDateRange.end || undefined,
                  }}
                  onSelect={(range) => {
                    setCustomDateRange({
                      start: range?.from || null,
                      end: range?.to || null,
                    });
                    if (range?.from && range?.to) {
                      setPeriod("custom");
                      setCalendarOpen(false);
                    }
                  }}
                  numberOfMonths={2}
                  className="rounded-md"
                />
              </div>
              <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-between items-center">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCustomDateRange({ start: null, end: null });
                    setPeriod("lq");
                    setCalendarOpen(false);
                  }}
                >
                  Clear
                </Button>
                {customDateRange.start && customDateRange.end && (
                  <span className="text-xs text-slate-600 dark:text-slate-400">
                    {format(customDateRange.start, "MMM d, yyyy")} -{" "}
                    {format(customDateRange.end, "MMM d, yyyy")}
                  </span>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* Top 5 Grid - Mobile First */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 sm:gap-3 md:gap-4">
        {top5.map((leader, idx) => {
          const isFirst = idx === 0;

          return (
            <div
              key={leader.id}
              onClick={() => setSelectedLeader(leader.id)}
              className={`group relative bg-white/60 dark:bg-slate-800/60 backdrop-blur-sm border border-white/80 dark:border-slate-700/60 hover:bg-white/80 dark:hover:bg-slate-800/80 hover:border-white/90 dark:hover:border-slate-700/80 rounded-lg sm:rounded-xl p-3 sm:p-4 cursor-pointer transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.2)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_4px_12px_rgba(0,0,0,0.3)] touch-manipulation ${
                isFirst ? "sm:col-span-2 lg:col-span-1" : ""
              }`}
            >
              {/* Rank: golden certificate seal with number on top */}
              <div className="absolute top-3 right-3 sm:top-4 sm:right-4 flex items-center justify-center">
                <div className="relative w-7 h-7 sm:w-8 sm:h-8">
                  <CertificateSealIcon
                    id={`seal-${leader.id}`}
                    size={28}
                    className="w-7 h-7 sm:w-8 sm:h-8"
                  />
                  <span className="absolute inset-0 flex items-center justify-center text-lg sm:text-xl font-bold text-slate-900 dark:text-white/95">
                    {idx + 1}
                  </span>
                </div>
              </div>

              {/* Content */}
              <div className="space-y-2 sm:space-y-3">
                {/* Name */}
                <div className="flex items-center gap-2.5 sm:gap-3 pr-8 sm:pr-9 min-w-0">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm sm:text-base font-medium text-slate-900 dark:text-white truncate">
                      {leader.name}
                    </p>
                    <p className="text-[11px] sm:text-xs text-slate-400 dark:text-slate-500 truncate">
                      {leader.role}
                    </p>
                  </div>
                </div>

                {/* Units */}
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
                      {leader.loans.toLocaleString()}
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider">
                      units
                    </p>
                  </div>
                  {/* Percent change hidden – values are unreliable, will fix later */}
                </div>

                {/* Stats row */}
                <div className="flex items-center justify-between pt-2 sm:pt-3 border-t border-white/40 dark:border-slate-700/50">
                  <div className="text-center flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                      {leader.volume}
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">
                      Volume
                    </p>
                  </div>
                  <div className="w-px h-5 sm:h-6 bg-white/50 dark:bg-slate-700/50 flex-shrink-0" />
                  <div className="text-center flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                      {leader.cycleTime} days
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">
                      Turn-Time
                    </p>
                  </div>
                  <div className="w-px h-5 sm:h-6 bg-white/50 dark:bg-slate-700/50 flex-shrink-0" />
                  <div className="text-center flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300 truncate">
                      {leader.pullThru}%
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">
                      Pull-through
                    </p>
                  </div>
                  <div className="w-px h-5 sm:h-6 bg-white/50 dark:bg-slate-700/50 flex-shrink-0" />
                  <div className="text-center flex-1 min-w-0">
                    <p className="text-xs sm:text-sm font-medium text-emerald-600 dark:text-emerald-400 truncate">
                      {leader.revenue}
                    </p>
                    <p className="text-[9px] sm:text-[10px] text-slate-400 dark:text-slate-500 truncate">
                      Revenue
                    </p>
                  </div>
                </div>

                {/* Badges - only show first badge */}
                {leader.badges.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/60 dark:bg-slate-700/60 backdrop-blur-sm border border-white/40 dark:border-slate-600/40 text-slate-600 dark:text-slate-300">
                      {leader.badges[0]}
                    </span>
                    {leader.badges.length > 1 && (
                      <span className="text-[10px] text-slate-400 dark:text-slate-500">
                        +{leader.badges.length - 1}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Ranks 6–10: collapsible table, collapsed by default */}
      {others.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 pt-4 sm:pt-5">
          <AnimatePresence initial={false} mode="wait">
            {!ranks6To10Expanded ? (
              <motion.button
                key="show-trigger"
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setRanks6To10Expanded(true)}
                className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
              >
                Show ranks 6–10
                <ChevronUp className="w-4 h-4 rotate-180" aria-hidden />
              </motion.button>
            ) : (
              <motion.div
                key="ranks6-10"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
                className="overflow-hidden"
              >
                <div className="overflow-x-auto -mx-1">
                  <table className="w-full min-w-[640px] border-collapse text-left">
                    <thead>
                      <tr className="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-200 dark:border-slate-700">
                        <th className="py-2.5 px-2 sm:px-3">
                          <span className="inline-flex items-center gap-1.5">
                            <span className="inline-flex items-center justify-center text-slate-500 dark:text-slate-300">
                              <UserRound className="w-3.5 h-3.5" />
                            </span>
                            LO Name
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-sky-600 dark:text-sky-400">
                              <Rocket className="w-3.5 h-3.5" />
                            </span>
                            Units
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right w-14">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-amber-600 dark:text-amber-400">
                              <Medal className="w-3.5 h-3.5" />
                            </span>
                            Ranking
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-violet-600 dark:text-violet-400">
                              <Zap className="w-3.5 h-3.5" />
                            </span>
                            Volume $
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right w-14">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-amber-600 dark:text-amber-400">
                              <Medal className="w-3.5 h-3.5" />
                            </span>
                            Ranking
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-emerald-600 dark:text-emerald-400">
                              <Gauge className="w-3.5 h-3.5" />
                            </span>
                            Pull-Through
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right w-14">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-amber-600 dark:text-amber-400">
                              <Medal className="w-3.5 h-3.5" />
                            </span>
                            Ranking
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-blue-600 dark:text-blue-400">
                              <Timer className="w-3.5 h-3.5" />
                            </span>
                            Turn-Time
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right w-14">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-amber-600 dark:text-amber-400">
                              <Medal className="w-3.5 h-3.5" />
                            </span>
                            Ranking
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-teal-600 dark:text-teal-400">
                              <ShieldCheck className="w-3.5 h-3.5" />
                            </span>
                            Revenue
                          </span>
                        </th>
                        <th className="py-2.5 px-2 sm:px-3 text-right w-14">
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span className="inline-flex items-center justify-center text-amber-600 dark:text-amber-400">
                              <Medal className="w-3.5 h-3.5" />
                            </span>
                            Ranking
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {others.map((leader) => (
                        <tr
                          key={leader.id}
                          onClick={() => setSelectedLeader(leader.id)}
                          className="border-b border-slate-100 dark:border-slate-800/80 hover:bg-slate-50/80 dark:hover:bg-slate-800/40 cursor-pointer transition-colors"
                        >
                          <td className="py-2.5 px-2 sm:px-3">
                            <p className="text-xs sm:text-sm font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                              {leader.name}
                            </p>
                            <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 truncate max-w-[140px]">
                              {leader.branch}
                            </p>
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
                            {leader.loans.toLocaleString()}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                            {rankMaps.units.get(leader.id)}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
                            {leader.volume}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                            {rankMaps.volume.get(leader.id)}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
                            {leader.pullThru}%
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                            {rankMaps.pullThrough.get(leader.id)}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm font-medium text-slate-700 dark:text-slate-300">
                            {leader.cycleTime}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                            {rankMaps.turnTime.get(leader.id)}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                            {leader.revenue}
                          </td>
                          <td className="py-2.5 px-2 sm:px-3 text-right text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                            {rankMaps.revenue.get(leader.id)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex justify-center pt-3">
                  <button
                    type="button"
                    onClick={() => setRanks6To10Expanded(false)}
                    className="inline-flex items-center justify-center gap-2 py-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-teal-600 dark:hover:text-teal-400 transition-colors"
                  >
                    Hide ranks 6–10
                    <ChevronUp className="w-4 h-4" aria-hidden />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Achievement Badges - Modern Minimalist - Interactive */}
      <div className="pt-2 sm:pt-3 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-center gap-3 sm:gap-4 md:gap-6 lg:gap-8 flex-wrap">
          {[
            {
              key: "units",
              name: "Units",
              Icon: Rocket,
              tooltip: "Top unit production",
            },
            {
              key: "volume",
              name: "Volume",
              Icon: Zap,
              tooltip: "Top volume performance",
            },
            {
              key: "turnTime",
              name: "Turn-Time",
              Icon: Timer,
              tooltip: "Fastest cycle times",
            },
            {
              key: "pullThrough",
              name: "Pull-through",
              Icon: Gauge,
              tooltip: "Highest pull-through rate",
            },
            {
              key: "revenue",
              name: "Revenue",
              Icon: ShieldCheck,
              tooltip: "Top revenue contributor",
            },
          ].map((badge) => {
            const isActive = rankingMetric === badge.key;
            return (
              <button
                key={badge.key}
                type="button"
                onClick={() =>
                  setRankingMetric(badge.key as typeof rankingMetric)
                }
                className="relative group cursor-pointer touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background rounded-lg"
                aria-pressed={isActive}
                aria-label={`Rank by ${badge.name}`}
              >
                <div className="flex flex-col items-center gap-1 sm:gap-1.5">
                  <div
                    className={cn(
                      "w-8 h-8 sm:w-9 sm:h-9 md:w-10 md:h-10 rounded-full flex items-center justify-center transition-colors duration-200",
                      isActive
                        ? "bg-slate-900 dark:bg-slate-100"
                        : "bg-slate-100 dark:bg-slate-800 group-hover:bg-slate-900 dark:group-hover:bg-slate-700"
                    )}
                  >
                    <badge.Icon
                      className={cn(
                        "w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-4.5 md:h-4.5 transition-colors duration-200",
                        isActive
                          ? "text-white dark:text-slate-900"
                          : "text-slate-500 dark:text-slate-400 group-hover:text-white"
                      )}
                      strokeWidth={1.5}
                    />
                  </div>
                  <span
                    className={cn(
                      "text-[9px] sm:text-[10px] md:text-xs font-medium whitespace-nowrap",
                      isActive
                        ? "text-slate-900 dark:text-white"
                        : "text-slate-500 dark:text-slate-400"
                    )}
                  >
                    {badge.name}
                  </span>
                </div>

                {/* Tooltip - Hidden on mobile, shown on hover for desktop */}
                <div className="hidden sm:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-slate-900 text-white text-[10px] rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-150 whitespace-nowrap z-50 pointer-events-none">
                  {badge.tooltip}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Leader Drill-Down Modal - Modern Minimalist */}
      <AnimatePresence>
        {selectedLeader &&
          (() => {
            const leader = leadersData.find((l) => l.id === selectedLeader);
            if (!leader) return null;
            // Per-metric ranks (1-based) for badge on each card
            const volumeRank = rankMaps.volume.get(leader.id) || 0;
            const pullThroughRank = rankMaps.pullThrough.get(leader.id) || 0;
            const turnTimeRank = rankMaps.turnTime.get(leader.id) || 0;
            const revenueRank = rankMaps.revenue.get(leader.id) || 0;
            const rankBadgeClass = (r: number) =>
              cn(
                "rounded-md px-1.5 py-0.5 text-[9px] font-semibold tabular-nums whitespace-nowrap inline-block",
                r === 1
                  ? "bg-amber-500/90 text-white"
                  : r === 2
                  ? "bg-slate-400/90 text-white"
                  : r === 3
                  ? "bg-orange-400/90 text-white"
                  : "bg-slate-200/90 text-slate-600 dark:bg-slate-700/90 dark:text-slate-300"
              );
            return (
              <motion.div
                initial={{
                  opacity: 0,
                }}
                animate={{
                  opacity: 1,
                }}
                exit={{
                  opacity: 0,
                }}
                className="fixed inset-0 bg-white/40 backdrop-blur-md z-50 flex items-center justify-center p-4"
                onClick={() => setSelectedLeader(null)}
              >
                <motion.div
                  initial={{
                    scale: 0.9,
                    opacity: 0,
                  }}
                  animate={{
                    scale: 1,
                    opacity: 1,
                  }}
                  exit={{
                    scale: 0.9,
                    opacity: 0,
                  }}
                  transition={{
                    type: "spring",
                    damping: 25,
                    stiffness: 300,
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200/50 dark:border-slate-700/50"
                >
                  {/* Compact Header */}
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-lg">
                          {leader.name
                            .split(" ")
                            .map((n) => n[0])
                            .join("")}
                        </div>
                        <div>
                          <h2 className="text-lg sm:text-xl font-extralight text-slate-900 dark:text-white tracking-tight leading-[1.05]">
                            {leader.name}
                          </h2>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            {leader.role} · {leader.branch}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "px-2 py-1 rounded-full text-[10px] font-semibold text-white shadow-sm",
                            leader.rank === 1
                              ? "bg-amber-500"
                              : leader.rank === 2
                              ? "bg-slate-400"
                              : leader.rank === 3
                              ? "bg-orange-400"
                              : "bg-slate-300"
                          )}
                        >
                          Rank #{leader.rank}
                        </span>
                        <button
                          onClick={() => setSelectedLeader(null)}
                          className="w-8 h-8 rounded-full bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 backdrop-blur-sm flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1"
                        >
                          <X
                            className="w-4 h-4 text-slate-500 dark:text-slate-400"
                            strokeWidth={1.5}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Units & Delta */}
                    <div className="flex items-center gap-2 mt-3">
                      <span className="text-2xl font-light text-slate-900 dark:text-white tracking-tight">
                        {leader.loans.toLocaleString()}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        units
                      </span>
                      {/* Percent change hidden – values are unreliable, will fix later */}
                    </div>
                  </div>

                  {/* Compact Content */}
                  <div className="p-4 space-y-4">
                    {/* Badges Row */}
                    {leader.badges.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {leader.badges.map((badge) => (
                          <span
                            key={badge}
                            className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                          >
                            {badge}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Metrics Grid - Compact: badge centered, value + label below */}
                    <div className="grid grid-cols-4 gap-2">
                      <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[3.5rem] text-center">
                        <div
                          className="flex justify-center min-h-[1.25rem] items-center"
                          aria-hidden
                        >
                          <span className={rankBadgeClass(volumeRank)}>
                            Rank #{volumeRank}
                          </span>
                        </div>
                        <p className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                          {leader.volume}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Volume
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[3.5rem] text-center">
                        <div
                          className="flex justify-center min-h-[1.25rem] items-center"
                          aria-hidden
                        >
                          <span className={rankBadgeClass(pullThroughRank)}>
                            Rank #{pullThroughRank}
                          </span>
                        </div>
                        <p className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                          {leader.pullThru}%
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Pull-through
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[3.5rem] text-center">
                        <div
                          className="flex justify-center min-h-[1.25rem] items-center"
                          aria-hidden
                        >
                          <span className={rankBadgeClass(turnTimeRank)}>
                            Rank #{turnTimeRank}
                          </span>
                        </div>
                        <p className="text-lg font-light text-slate-900 dark:text-white tracking-tight">
                          {leader.cycleTime} days
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Turn-Time
                        </p>
                      </div>
                      <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/50 min-h-[3.5rem] text-center">
                        <div
                          className="flex justify-center min-h-[1.25rem] items-center"
                          aria-hidden
                        >
                          <span className={rankBadgeClass(revenueRank)}>
                            Rank #{revenueRank}
                          </span>
                        </div>
                        <p className="text-lg font-light text-emerald-600 dark:text-emerald-400 tracking-tight">
                          {leader.revenue}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          Revenue
                        </p>
                      </div>
                    </div>

                    {/* Quick Stats Row */}
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 py-2 border-t border-slate-100 dark:border-slate-800">
                      <span>Rank #{leader.rank}</span>
                      <span>{periodLabels[period].short}</span>
                    </div>

                    {/* AI Insight - Compact */}
                    <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-50 to-blue-50 dark:from-emerald-950/30 dark:to-blue-950/30 border border-emerald-100 dark:border-emerald-900/30">
                      <div className="flex items-start gap-2">
                        <Zap className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
                        <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-relaxed">
                          {leader.rank === 1
                            ? `Top performer with ${leader.delta}% improvement. Strong momentum across all metrics.`
                            : leader.rank <= 3
                            ? `Strong ${leader.pullThru}% pull-through and ${leader.cycleTime} days cycle. Consider for mentorship.`
                            : `${leader.loans} loans closed. Opportunity to improve pull-through rate.`}
                        </p>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
      </AnimatePresence>
    </section>
  );
};
