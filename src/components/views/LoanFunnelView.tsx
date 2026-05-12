import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { format } from "date-fns";
import {
  BarChart3,
  ChevronRight,
  AlertTriangle,
  Zap,
  TrendingUp,
  TrendingDown,
  ChartBar,
  TrendingUp as LineChartIcon,
  Calendar as CalendarIcon,
  X,
} from "lucide-react";
import { LOSFunnelData } from "@/lib/losSchema";
import { FunnelVisualization } from "@/components/FunnelVisualization";
import { FunnelDataPoint } from "@/types/funnel";
import { formatCompactNumber } from "@/utils/formatting";
import { useFunnelData, FunnelDateFilter } from "@/hooks/useFunnelData";
import { SalesView } from "./SalesView";
import { OpsView } from "./OpsView";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { DatePeriodPicker, type PeriodSelection, type DateRange as DPDateRange } from "@/components/ui/DatePeriodPicker";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";

interface LoanFunnelViewProps {
  view: "funnel" | "bar" | "revenue" | "units" | "volume" | "detail";
  onViewChange: (
    view: "funnel" | "bar" | "revenue" | "units" | "volume" | "detail"
  ) => void;
  year: number;
  onYearChange: (year: number) => void;
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

// Generate years from current year down to 2022
const currentYear = new Date().getFullYear();
const availableYears = Array.from(
  { length: currentYear - 2021 },
  (_, i) => currentYear - i
);

export const LoanFunnelView = ({
  view,
  onViewChange,
  year,
  onYearChange,
  selectedTenantId,
  selectedChannel,
}: LoanFunnelViewProps) => {
  // Tab state for Company/Sales/Ops
  const [activeTab, setActiveTab] = useState<"company" | "sales" | "ops">(
    "company"
  );
  // Comparison view state for Funded vs Apps / Locked vs Apps
  const [comparisonView, setComparisonView] = useState<"funded" | "locked">(
    "funded"
  );

  // Custom date range state
  const [dateFilterType, setDateFilterType] = useState<"year" | "custom">(
    "year"
  );
  const [customDateRange, setCustomDateRange] = useState<{
    start: Date | null;
    end: Date | null;
  }>({ start: null, end: null });

  const loanFunnelFilterAnalytics = useMemo(
    () => ({
      view,
      year,
      dateFilterType,
      custom_start: customDateRange.start ? format(customDateRange.start, "yyyy-MM-dd") : null,
      custom_end: customDateRange.end ? format(customDateRange.end, "yyyy-MM-dd") : null,
      activeTab,
      comparisonView,
      selectedChannel: selectedChannel ?? "All",
    }),
    [view, year, dateFilterType, customDateRange, activeTab, comparisonView, selectedChannel]
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.loan_funnel, loanFunnelFilterAnalytics);

  // Handle DatePeriodPicker changes (replaces manual year buttons + custom date logic)
  const handleFunnelPeriodChange = useCallback((selection: PeriodSelection) => {
    if (selection.type === 'year' && selection.year) {
      setDateFilterType("year");
      setCustomDateRange({ start: null, end: null });
      onYearChange(selection.year);
    } else {
      // preset or custom – treat both as custom date range
      setDateFilterType("custom");
      const s = new Date(selection.dateRange.start + 'T00:00:00');
      const e = new Date(selection.dateRange.end + 'T00:00:00');
      setCustomDateRange({ start: s, end: e });
    }
  }, [onYearChange]);

  // Build the date filter for the hook
  // For current year, use YTD (Jan 1 to today); for past years, use full year (Jan 1 to Dec 31)
  const dateFilter: FunnelDateFilter = useMemo(() => {
    if (
      dateFilterType === "custom" &&
      customDateRange.start &&
      customDateRange.end
    ) {
      return {
        type: "custom",
        startDate: customDateRange.start.toISOString().split("T")[0],
        endDate: customDateRange.end.toISOString().split("T")[0],
      };
    }

    // For year-based filtering, calculate appropriate date range
    const startOfYear = `${year}-01-01`;
    const today = new Date();
    const isCurrentYear = year === today.getFullYear();

    // For current year: use YTD (Jan 1 to today)
    // For past years: use full year (Jan 1 to Dec 31)
    const endDate = isCurrentYear
      ? today.toISOString().split("T")[0]
      : `${year}-12-31`;

    return {
      type: "custom", // Use custom date range to get proper date filtering
      startDate: startOfYear,
      endDate: endDate,
    };
  }, [dateFilterType, year, customDateRange.start, customDateRange.end]);

  // Build additional filters including channel
  const additionalFilters = useMemo(
    () => ({
      // Use channelGroup for consolidated channel filtering (matches Qlik)
      channelGroup: selectedChannel || undefined,
    }),
    [selectedChannel]
  );

  // Use the hook for funnel data fetching with tenant context and channel filter
  const { funnelData: funnelDataState, loading: funnelLoading } = useFunnelData(
    dateFilter,
    selectedTenantId,
    additionalFilters
  );

  // Debug: Log when component renders and view changes
  useEffect(() => {
    console.log("LoanFunnelView rendered with view:", view, "year:", year);
  }, [view, year]);

  // Mobile scroll indicator state
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollIndicator, setShowScrollIndicator] = useState(true);

  // Check if user can scroll horizontally (mobile only)
  useEffect(() => {
    const checkScrollable = () => {
      if (scrollContainerRef.current && window.innerWidth < 640) {
        const container = scrollContainerRef.current;
        const canScroll = container.scrollWidth > container.clientWidth;
        const isScrolledToEnd =
          container.scrollLeft + container.clientWidth >=
          container.scrollWidth - 10;
        setShowScrollIndicator(canScroll && !isScrolledToEnd);
      } else {
        setShowScrollIndicator(false);
      }
    };
    checkScrollable();
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", checkScrollable);
      window.addEventListener("resize", checkScrollable);
    }
    return () => {
      if (container) {
        container.removeEventListener("scroll", checkScrollable);
      }
      window.removeEventListener("resize", checkScrollable);
    };
  }, [view]);

  const createZeroFunnelYear = (): LOSFunnelData => ({
    loansStarted: { revenue: 0, units: 0, volume: 0 },
    noRespaApp: { revenue: 0, units: 0, volume: 0, lostRevenue: 0 },
    respaApp: { revenue: 0, units: 0, volume: 0 },
    originated: { revenue: 0, units: 0, volume: 0 },
    falloutWithdrawn: { revenue: 0, units: 0, volume: 0, lostRevenue: 0 },
    falloutDenied: { revenue: 0, units: 0, volume: 0, lostRevenue: 0 },
    stillActive: { revenue: 0, units: 0, volume: 0 },
  });

  // Zeroed fallback values keep UI empty until real data arrives
  // Dynamically create fallback for all available years
  const funnelViewFunnelData: Record<number, LOSFunnelData> =
    Object.fromEntries(availableYears.map((y) => [y, createZeroFunnelYear()]));

  // Use effectiveFunnelData - prioritize API data, fallback to mock data
  const effectiveFunnelData =
    funnelDataState ||
    funnelViewFunnelData[year] ||
    funnelViewFunnelData[currentYear];

  // Format value helper - defined first so it can be used by other functions
  const formatValue = (value: number, type: "revenue" | "volume") => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
    return `$${value.toFixed(0)}`;
  };

  // Helper to format values for display based on view type
  const formatFunnelValue = (val: number, viewType: typeof view): string => {
    // For units, funnel, and bar views - show as unit counts
    if (viewType === "units" || viewType === "funnel" || viewType === "bar") {
      if (val >= 1000000) return `${(val / 1000000).toFixed(2)}M`;
      if (val >= 1000)
        return val.toLocaleString(undefined, {
          maximumFractionDigits: 0,
        });
      return val.toLocaleString(undefined, {
        maximumFractionDigits: 0,
      });
    }
    // For revenue and volume, use the formatValue function
    return formatValue(val, viewType === "revenue" ? "revenue" : "volume");
  };

  // Transform funnel data to FunnelVisualization format based on view
  const transformFunnelData = useMemo(() => {
    if (!effectiveFunnelData) {
      return { funnelDataPoints: [], falloutDataPoints: [] };
    }
    const getValue = (
      data: typeof effectiveFunnelData,
      key: keyof typeof effectiveFunnelData,
      viewType: typeof view
    ): number => {
      const stageData = data[key];
      switch (viewType) {
        case "revenue":
          return stageData.revenue;
        case "units":
          return stageData.units;
        case "volume":
          return stageData.volume;
        default:
          // Default to units for funnel and bar views
          return stageData.units;
      }
    };

    /**
     * ESTIMATED VALUES - These multipliers are industry approximations, not actual data.
     *
     * Inquiries (1.5x): Industry estimate - inquiry/lead data is typically not captured in LOS systems.
     *   Assumes ~67% of inquiries progress to "loans started" status.
     *   Source: Industry benchmarks from MBA mortgage application research.
     *
     * Pre-Approvals (0.95x): Estimate - assumes ~95% of RESPA applications receive pre-approval.
     *   Actual pre-approval data is not consistently captured in LOS.
     *
     * Locked (1.1x): Estimate - assumes rate locks slightly exceed originations due to lock expirations.
     *   Lock data timing doesn't always align with origination timing.
     *
     * TODO: These should be replaced with actual data when available from the LOS.
     * These estimates are flagged with a note in the metrics catalog.
     */
    const INQUIRY_MULTIPLIER = 1.5; // Industry estimate: 67% inquiry-to-start conversion
    const PRE_APPROVAL_MULTIPLIER = 0.95; // Estimate: 95% RESPA-to-preapproval rate
    const LOCKED_MULTIPLIER = 1.1; // Estimate: locks exceed originations by ~10%

    const inquiriesValue =
      getValue(effectiveFunnelData, "loansStarted", view) * INQUIRY_MULTIPLIER;
    const preApprovalValue =
      getValue(effectiveFunnelData, "respaApp", view) * PRE_APPROVAL_MULTIPLIER;
    const lockedValue =
      getValue(effectiveFunnelData, "originated", view) * LOCKED_MULTIPLIER;

    const funnelDataPoints: FunnelDataPoint[] = [
      {
        id: "inquiries",
        label: "Total Inquiries (Est.)",
        value: inquiriesValue,
        valueDisplay: formatFunnelValue(inquiriesValue, view),
        color: "#9CA3AF",
        description:
          "ESTIMATED - No actual inquiry data available. Based on 1.5x loans started.",
      },
      {
        id: "started",
        label: "Loans Started",
        value: getValue(effectiveFunnelData, "loansStarted", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "loansStarted", view),
          view
        ),
        color: "#6B7280",
        description: "Total loans initiated in the pipeline",
        volume: effectiveFunnelData.loansStarted.volume,
        units: effectiveFunnelData.loansStarted.units,
      },
      {
        id: "pre_approval",
        label: "Pre-Approvals (Est.)",
        value: preApprovalValue,
        valueDisplay: formatFunnelValue(preApprovalValue, view),
        color: "#475569",
        description:
          "ESTIMATED - No actual pre-approval data. Based on 95% of RESPA applications.",
      },
      {
        id: "respa",
        label: "Loans with RESPA Applications",
        value: getValue(effectiveFunnelData, "respaApp", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "respaApp", view),
          view
        ),
        color: "#374151",
        description: "Applications proceeding to RESPA stage",
        volume: effectiveFunnelData.respaApp.volume,
        units: effectiveFunnelData.respaApp.units,
      },
      {
        id: "locked",
        label: "Rate Locked",
        value: lockedValue,
        valueDisplay: formatFunnelValue(lockedValue, view),
        color: "#D97706",
        description: "Loans with locked interest rates",
      },
      {
        id: "originated",
        label: "Originated Loans",
        value: getValue(effectiveFunnelData, "originated", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "originated", view),
          view
        ),
        color: "#F59E0B",
        description: "Loans successfully closed and funded",
        volume: effectiveFunnelData.originated.volume,
        units: effectiveFunnelData.originated.units,
      },
      {
        id: "active",
        label: "Loans Still Active",
        value: getValue(effectiveFunnelData, "stillActive", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "stillActive", view),
          view
        ),
        color: "#3B82F6",
        description: "Loans currently in processing",
        volume: effectiveFunnelData.stillActive.volume,
        units: effectiveFunnelData.stillActive.units,
      },
    ];
    const falloutDataPoints: FunnelDataPoint[] = [
      {
        id: "no-respa",
        label: "No RESPA Apps",
        value: getValue(effectiveFunnelData, "noRespaApp", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "noRespaApp", view),
          view
        ),
        color: "#E5E7EB",
        isFallout: true,
        volume: effectiveFunnelData.noRespaApp.volume,
        units: effectiveFunnelData.noRespaApp.units,
        lostRevenue:
          effectiveFunnelData.noRespaApp.lostRevenue ||
          effectiveFunnelData.noRespaApp.revenue,
      },
      {
        id: "withdrawn",
        label: "Fallout - Withdrawn",
        value: getValue(effectiveFunnelData, "falloutWithdrawn", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "falloutWithdrawn", view),
          view
        ),
        color: "#DC2626",
        isFallout: true,
        volume: effectiveFunnelData.falloutWithdrawn.volume,
        units: effectiveFunnelData.falloutWithdrawn.units,
        lostRevenue:
          effectiveFunnelData.falloutWithdrawn.lostRevenue ||
          effectiveFunnelData.falloutWithdrawn.revenue,
      },
      {
        id: "denied",
        label: "Fallout - Denied",
        value: getValue(effectiveFunnelData, "falloutDenied", view),
        valueDisplay: formatFunnelValue(
          getValue(effectiveFunnelData, "falloutDenied", view),
          view
        ),
        color: "#FEE2E2",
        textColor: "#991B1B",
        isFallout: true,
        volume: effectiveFunnelData.falloutDenied.volume,
        units: effectiveFunnelData.falloutDenied.units,
        lostRevenue:
          effectiveFunnelData.falloutDenied.lostRevenue ||
          effectiveFunnelData.falloutDenied.revenue,
      },
    ];
    return {
      funnelDataPoints,
      falloutDataPoints,
    };
  }, [effectiveFunnelData, view]);

  // Lost Revenue Calculations - Based on Company Performance Overview logic
  // Formula: Lost Revenue = Potential revenue from loans that fell out
  const lostRevenueBreakdown = {
    noRespaApp: {
      volume: effectiveFunnelData.noRespaApp.volume,
      units: effectiveFunnelData.noRespaApp.units,
      lostRevenue: effectiveFunnelData.noRespaApp.lostRevenue || 0,
      recommendation:
        "Manage these loans to ensure loan producers focus on conversion to closed loans.",
    },
    customerNo: {
      volume: effectiveFunnelData.falloutWithdrawn.volume,
      units: effectiveFunnelData.falloutWithdrawn.units,
      lostRevenue: effectiveFunnelData.falloutWithdrawn.lostRevenue || 0,
      recommendation:
        'Consider the customer "No" rate by branch and originator.',
    },
    denied: {
      volume: effectiveFunnelData.falloutDenied.volume,
      units: effectiveFunnelData.falloutDenied.units,
      lostRevenue: effectiveFunnelData.falloutDenied.lostRevenue || 0,
      recommendation:
        "Consider the loan type, credit box, and whether borrowers were referred to credit rehabilitation and other appropriate resources.",
    },
  };
  const totalLostRevenue =
    lostRevenueBreakdown.noRespaApp.lostRevenue +
    lostRevenueBreakdown.customerNo.lostRevenue +
    lostRevenueBreakdown.denied.lostRevenue;
  const totalLostVolume =
    lostRevenueBreakdown.noRespaApp.volume +
    lostRevenueBreakdown.customerNo.volume +
    lostRevenueBreakdown.denied.volume;
  const totalLostUnits =
    lostRevenueBreakdown.noRespaApp.units +
    lostRevenueBreakdown.customerNo.units +
    lostRevenueBreakdown.denied.units;

  // Calculate active states before any early returns to avoid type narrowing issues
  const isCompanyActive = activeTab === "company";
  const isSalesActive = activeTab === "sales";
  const isOpsActive = activeTab === "ops";

  // Show Sales View when Sales tab is active
  if (activeTab === "sales") {
    return (
      <SalesView
        onTabChange={setActiveTab}
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        year={year}
        dateFilterType={dateFilterType}
        customDateRange={customDateRange}
      />
    );
  }

  // Show Ops View when Ops tab is active
  if (activeTab === "ops") {
    return (
      <OpsView
        onTabChange={setActiveTab}
        selectedTenantId={selectedTenantId}
        selectedChannel={selectedChannel}
        year={year}
        dateFilterType={dateFilterType}
        customDateRange={customDateRange}
      />
    );
  }

  return (
    <div className="space-y-3 sm:space-y-6">
      {/* Chart Card on Top */}
      <div className="space-y-3 sm:space-y-6">
        {/* Horizontal Bar Chart - Matching Reference Design */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-3 sm:p-4 md:p-6 border border-slate-200 dark:border-slate-700 overflow-hidden">
          {/* Header Inside Card */}
          <div className="mb-4 sm:mb-6 space-y-3 sm:space-y-4 pb-3 sm:pb-4 border-b border-slate-200 dark:border-slate-700">
            {/* TopTier Title with Icon - Matching Cohi Dialogues */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
              {/* Icon and Title Section */}
              <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <BarChart3 className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                  </div>
                </div>
                <div className="min-w-0">
                  <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
                    Top Tiering
                    <sup className="text-[10px] sm:text-xs md:text-sm align-super ml-0.5 opacity-70">
                      ®
                    </sup>
                  </h3>
                </div>
              </div>
              {/* Actions Section - CSV and Tabs */}
              <div className="flex items-center gap-2">
                {/* Buttons Section - Mobile First */}
                <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg overflow-x-auto">
                  <button
                    onClick={() => setActiveTab("company")}
                    className={`px-2.5 py-1.5 sm:px-3 md:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-md transition-all whitespace-nowrap touch-manipulation ${
                      isCompanyActive
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    Company
                  </button>
                  <button
                    onClick={() => setActiveTab("sales")}
                    className={`px-2.5 py-1.5 sm:px-3 md:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-md transition-all whitespace-nowrap touch-manipulation ${
                      isSalesActive
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    Sales
                  </button>
                  <button
                    onClick={() => setActiveTab("ops")}
                    className={`px-2.5 py-1.5 sm:px-3 md:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-md transition-all whitespace-nowrap touch-manipulation ${
                      isOpsActive
                        ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                        : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                    }`}
                  >
                    Ops
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Controls Row - Chart View on Left, Year on Right */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3 mb-3 sm:mb-4">
            {/* Chart View Selection - Mobile First */}
            <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg overflow-x-auto">
              {[
                {
                  id: "funnel",
                  label: "Funnel",
                },
                {
                  id: "detail",
                  label: "Detail",
                },
              ].map((v) => (
                <button
                  key={v.id}
                  onClick={() => onViewChange(v.id as any)}
                  className={`px-2.5 py-1.5 sm:px-3 md:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-md transition-all whitespace-nowrap touch-manipulation ${
                    view === v.id
                      ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                  }`}
                >
                  {v.label}
                </button>
              ))}
            </div>

            {/* Year/Date Selection - Using standardized DatePeriodPicker */}
            <DatePeriodPicker
              year={year}
              onYearChange={onYearChange}
              onPeriodChange={handleFunnelPeriodChange}
              yearsToShow={currentYear - 2021}
              size="default"
            />
          </div>

          {/* TopTiering Daily Story Section */}
          {view === "funnel" && (
            <div className="bg-white dark:bg-slate-800 rounded-xl p-4 sm:p-6 border border-slate-200 dark:border-slate-700 shadow-sm mt-4 sm:mt-6">
              <div className="space-y-4 sm:space-y-6">
                {/* Header with Title and Tabs on Same Row */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                  {/* Left: Title Section */}
                  <div className="flex items-center gap-2 sm:gap-3">
                    {/* Dark Blue Square Icon with White Line Chart */}
                    <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-[#007AFF] dark:bg-blue-600 flex items-center justify-center flex-shrink-0">
                      <LineChartIcon className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="text-base sm:text-lg md:text-xl font-semibold text-slate-900 dark:text-white tracking-tight">
                        TopTiering Daily Story
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                        Executive summary — updates automatically as the data
                        changes
                      </p>
                    </div>
                  </div>

                  {/* Right: View Options Tabs */}
                  <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg overflow-x-auto">
                    <button
                      onClick={() => setComparisonView("funded")}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-full transition-all whitespace-nowrap touch-manipulation ${
                        comparisonView === "funded"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      Funded vs Apps
                    </button>
                    <button
                      onClick={() => setComparisonView("locked")}
                      className={`px-3 py-1.5 sm:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm font-medium rounded-full transition-all whitespace-nowrap touch-manipulation ${
                        comparisonView === "locked"
                          ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                          : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                      }`}
                    >
                      Locked vs Apps
                    </button>
                  </div>
                </div>

                {/* Cohi Note */}
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 sm:p-5">
                  <p className="text-sm sm:text-base text-slate-700 dark:text-slate-300 leading-relaxed">
                    <span className="font-semibold text-slate-900 dark:text-white">
                      Cohi Note:
                    </span>{" "}
                    Today's conversion is{" "}
                    <span className="font-semibold text-blue-600 dark:text-blue-400">
                      {effectiveFunnelData.respaApp.units > 0
                        ? (
                            (effectiveFunnelData.originated.units /
                              effectiveFunnelData.respaApp.units) *
                            100
                          ).toFixed(1) + "%"
                        : "0%"}
                    </span>{" "}
                    ({effectiveFunnelData.originated.units.toLocaleString()}{" "}
                    funded /{" "}
                    {effectiveFunnelData.respaApp.units.toLocaleString()}{" "}
                    applications taken). Top-tier execution is pulling the
                    average up, while the bottom tier is still leaking momentum.
                    The fastest path to lift enterprise results is tightening
                    conversion in the second tier and stabilizing the bottom
                    tier's fallout.
                  </p>
                </div>

                {/* Performance Tiers */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 sm:gap-4">
                  {/* TOP TIER */}
                  <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
                        TOP TIER
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        1 leaders
                      </span>
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      <span className="font-medium">What's working:</span>{" "}
                      fast-to-lock files and clean conditions.
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                      <span className="font-medium">Leaders:</span> Christopher
                      Santos
                    </p>
                  </div>

                  {/* SECOND TIER */}
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                      <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        SECOND TIER
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        3 leaders
                      </span>
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      <span className="font-medium">Opportunity:</span> convert
                      rate locks faster, reduce touch points per file.
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                      <span className="font-medium">In motion:</span> Ian
                      Howard, Tyler Patel, Madison Blackwell
                    </p>
                  </div>

                  {/* BOTTOM TIER */}
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full bg-red-500"></div>
                      <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                        BOTTOM TIER
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 mb-2">
                      <span className="font-semibold text-slate-900 dark:text-white">
                        3 leaders
                      </span>
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                      <span className="font-medium">Risk:</span> fallout +
                      delays are compressing pull-through and pushing cycle
                      times out.
                    </p>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300 mt-1">
                      <span className="font-medium">Needs focus:</span> Jose
                      Lindberg, Ryan Takahashi, Chris Carter
                    </p>
                  </div>
                </div>

                {/* Team Status */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                  {/* IMPROVING TODAY */}
                  <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingUp className="w-4 h-4 text-green-600 dark:text-green-400" />
                      <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-green-700 dark:text-green-300">
                        IMPROVING TODAY
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                      Vanessa Duarte, Renee Moreno, Rodney Castellanos, David
                      Lee
                    </p>
                  </div>

                  {/* AT RISK / SLIPPING */}
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 sm:p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <TrendingDown className="w-4 h-4 text-red-600 dark:text-red-400" />
                      <h4 className="text-xs sm:text-sm font-bold uppercase tracking-wider text-red-700 dark:text-red-300">
                        AT RISK / SLIPPING
                      </h4>
                    </div>
                    <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                      Natasha Torres, Trevor Mitchell, Elena Al-Hassan, Chris
                      Hoffman
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Conditional: Show funnel visualization for funnel view, bar chart for other views */}
          {view === "funnel" ? (
            <div className="w-full overflow-hidden bg-white dark:bg-slate-800 p-4 sm:p-6">
              <FunnelVisualization
                data={transformFunnelData.funnelDataPoints}
                falloutData={transformFunnelData.falloutDataPoints}
              />
            </div>
          ) : (
            <div className="relative w-full">
              {/* Mobile Scroll Indicator - Blinking Arrow */}
              {showScrollIndicator && (
                <div className="absolute right-2 top-1/2 -translate-y-1/2 z-20 sm:hidden pointer-events-none">
                  <div className="bg-white/90 dark:bg-slate-800/90 backdrop-blur-sm rounded-full p-2 shadow-lg border border-slate-200/50 dark:border-slate-700/50">
                    <ChevronRight className="w-5 h-5 text-slate-600 dark:text-slate-400 animate-blink-subtle" />
                  </div>
                </div>
              )}
              <div ref={scrollContainerRef} className="w-full overflow-x-auto">
                {/* Apple-Style Modern Waterfall Table */}
                <div className="rounded-2xl overflow-hidden bg-gradient-to-b from-slate-50/80 to-white dark:from-slate-900/80 dark:to-slate-800/50 backdrop-blur-xl border border-slate-200/60 dark:border-slate-700/40 shadow-xl shadow-slate-900/5 dark:shadow-black/20 min-w-[640px] sm:min-w-full">
                  <table className="w-full text-xs sm:text-sm">
                    {/* Header Row - Frosted Glass Effect */}
                    <thead>
                      <tr className="bg-gradient-to-r from-slate-100/90 to-slate-50/90 dark:from-slate-800/90 dark:to-slate-800/70 backdrop-blur-md border-b border-slate-200/60 dark:border-slate-700/40">
                        <th className="text-left py-3 px-3 sm:py-4 sm:px-5 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          Waterfall Stage
                        </th>
                        <th className="py-3 px-3 sm:py-4 sm:px-5 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-full bg-slate-200/70 dark:bg-slate-700/70 text-slate-600 dark:text-slate-300 text-[10px] sm:text-xs whitespace-nowrap">
                            {dateFilterType === "custom" &&
                            customDateRange.start &&
                            customDateRange.end
                              ? `Loans Started ${format(
                                  customDateRange.start,
                                  "MMM d, yyyy"
                                )} - ${format(
                                  customDateRange.end,
                                  "MMM d, yyyy"
                                )}`
                              : year === currentYear
                              ? `Loans Started YTD ${year}`
                              : `Loans Started in ${year}`}
                          </span>
                        </th>
                        <th className="text-right py-3 px-3 sm:py-4 sm:px-5 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          Units
                        </th>
                        <th className="text-right py-3 px-3 sm:py-4 sm:px-5 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          Units %
                        </th>
                        <th className="text-right py-3 px-3 sm:py-4 sm:px-5 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          Volume
                        </th>
                        <th className="text-right py-3 px-3 sm:py-4 sm:px-5 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          Volume %
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                      {/* Loans Started */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 shadow-lg shadow-blue-500/30 flex-shrink-0"></div>
                            <span className="font-medium text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              Loans Started
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-slate-900 dark:text-white tabular-nums text-[10px] sm:text-xs">
                            {effectiveFunnelData.loansStarted.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            100.0%
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums text-[10px] sm:text-xs">
                            {formatCompactNumber(
                              effectiveFunnelData.loansStarted.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            100.0%
                          </span>
                        </td>
                      </tr>

                      {/* Loans with No RESPA Applications */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gradient-to-r from-amber-400 to-orange-400 shadow-lg shadow-amber-500/30 flex-shrink-0"></div>
                            <span className="font-medium text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              No RESPA Apps
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-slate-900 dark:text-white tabular-nums text-[10px] sm:text-xs">
                            {effectiveFunnelData.noRespaApp.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.units > 0
                              ? (
                                  (effectiveFunnelData.noRespaApp.units /
                                    effectiveFunnelData.loansStarted.units) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums text-[10px] sm:text-xs">
                            {formatCompactNumber(
                              effectiveFunnelData.noRespaApp.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.volume > 0
                              ? (
                                  (effectiveFunnelData.noRespaApp.volume /
                                    effectiveFunnelData.loansStarted.volume) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                      </tr>

                      {/* Loans with RESPA Applications */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2">
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gradient-to-r from-cyan-400 to-teal-400 shadow-lg shadow-cyan-500/30 flex-shrink-0"></div>
                            <span className="font-medium text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              RESPA Apps
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-slate-900 dark:text-white tabular-nums text-[10px] sm:text-xs">
                            {effectiveFunnelData.respaApp.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.units > 0
                              ? (
                                  (effectiveFunnelData.respaApp.units /
                                    effectiveFunnelData.loansStarted.units) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-medium text-slate-700 dark:text-slate-300 tabular-nums text-[10px] sm:text-xs">
                            {formatCompactNumber(
                              effectiveFunnelData.respaApp.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-cyan-50 dark:bg-cyan-900/30 text-cyan-600 dark:text-cyan-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.volume > 0
                              ? (
                                  (effectiveFunnelData.respaApp.volume /
                                    effectiveFunnelData.loansStarted.volume) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                      </tr>

                      {/* Originated Loans */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200 bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-900/10 dark:to-transparent">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-gradient-to-r from-emerald-500 to-green-400 shadow-lg shadow-emerald-500/40 ring-2 ring-emerald-500/20 flex-shrink-0"></div>
                            <span className="font-semibold text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              Originated
                            </span>
                            <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide">
                              Success
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums text-[10px] sm:text-xs">
                            {effectiveFunnelData.originated.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[9px] sm:text-[10px] font-semibold tabular-nums">
                            {effectiveFunnelData.loansStarted.units > 0
                              ? (
                                  (effectiveFunnelData.originated.units /
                                    effectiveFunnelData.loansStarted.units) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums text-[10px] sm:text-xs">
                            {formatCompactNumber(
                              effectiveFunnelData.originated.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 text-[9px] sm:text-[10px] font-semibold tabular-nums">
                            {effectiveFunnelData.loansStarted.volume > 0
                              ? (
                                  (effectiveFunnelData.originated.volume /
                                    effectiveFunnelData.loansStarted.volume) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                      </tr>

                      {/* Fallout - Withdrawn */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200 bg-gradient-to-r from-rose-50/40 to-transparent dark:from-rose-900/10 dark:to-transparent">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gradient-to-r from-rose-500 to-red-500 shadow-lg shadow-rose-500/30 flex-shrink-0"></div>
                            <span className="font-medium text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              Withdrawn
                            </span>
                            <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide">
                              Lost
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-rose-600 dark:text-rose-400 tabular-nums text-[10px] sm:text-xs">
                            {effectiveFunnelData.falloutWithdrawn.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.units > 0
                              ? (
                                  (effectiveFunnelData.falloutWithdrawn.units /
                                    effectiveFunnelData.loansStarted.units) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-medium text-rose-600 dark:text-rose-400 tabular-nums text-[10px] sm:text-xs">
                            {formatCompactNumber(
                              effectiveFunnelData.falloutWithdrawn.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-rose-50 dark:bg-rose-900/30 text-rose-600 dark:text-rose-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.volume > 0
                              ? (
                                  (effectiveFunnelData.falloutWithdrawn.volume /
                                    effectiveFunnelData.loansStarted.volume) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                      </tr>

                      {/* Fallout - Denied */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200 bg-gradient-to-r from-amber-50/40 to-transparent dark:from-amber-900/10 dark:to-transparent">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full bg-gradient-to-r from-amber-500 to-yellow-500 shadow-lg shadow-amber-500/30 flex-shrink-0"></div>
                            <span className="font-medium text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              Denied
                            </span>
                            <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 text-[8px] sm:text-[9px] font-semibold uppercase tracking-wide">
                              Denied
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-amber-600 dark:text-amber-400 tabular-nums text-[10px] sm:text-xs">
                            {effectiveFunnelData.falloutDenied.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.units > 0
                              ? (
                                  (effectiveFunnelData.falloutDenied.units /
                                    effectiveFunnelData.loansStarted.units) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-medium text-amber-600 dark:text-amber-400 tabular-nums text-[10px] sm:text-xs">
                            {formatCompactNumber(
                              effectiveFunnelData.falloutDenied.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1 sm:px-1.5 py-0.5 rounded-md bg-amber-50 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 text-[9px] sm:text-[10px] font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.volume > 0
                              ? (
                                  (effectiveFunnelData.falloutDenied.volume /
                                    effectiveFunnelData.loansStarted.volume) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                      </tr>

                      {/* Loans Still Active */}
                      <tr className="group hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors duration-200 bg-gradient-to-r from-violet-50/40 to-transparent dark:from-violet-900/10 dark:to-transparent">
                        <td className="py-2 px-2 sm:py-3 sm:px-3" colSpan={2}>
                          <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                            <div className="w-2 h-2 sm:w-2.5 sm:h-2.5 rounded-full bg-gradient-to-r from-violet-500 to-purple-500 shadow-lg shadow-violet-500/40 animate-pulse flex-shrink-0"></div>
                            <span className="font-medium text-slate-900 dark:text-white text-[10px] sm:text-xs">
                              Loans Still Active
                            </span>
                            <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 text-[9px] sm:text-[10px] font-semibold uppercase tracking-wide">
                              In Progress
                            </span>
                          </div>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-semibold text-violet-600 dark:text-violet-400 tabular-nums text-xs sm:text-sm">
                            {effectiveFunnelData.stillActive.units.toLocaleString()}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-[10px] sm:text-xs font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.units > 0
                              ? (
                                  (effectiveFunnelData.stillActive.units /
                                    effectiveFunnelData.loansStarted.units) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="font-medium text-violet-600 dark:text-violet-400 tabular-nums text-xs sm:text-sm">
                            {formatCompactNumber(
                              effectiveFunnelData.stillActive.volume
                            )}
                          </span>
                        </td>
                        <td className="text-right py-2 px-2 sm:py-3 sm:px-3">
                          <span className="inline-flex items-center px-1.5 sm:px-2 py-0.5 rounded-md bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 text-[10px] sm:text-xs font-medium tabular-nums">
                            {effectiveFunnelData.loansStarted.volume > 0
                              ? (
                                  (effectiveFunnelData.stillActive.volume /
                                    effectiveFunnelData.loansStarted.volume) *
                                  100
                                ).toFixed(1)
                              : "0.0"}
                            %
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
