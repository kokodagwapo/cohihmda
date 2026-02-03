import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target,
  ArrowUp,
  ArrowDown,
  X,
  ChevronDown,
  Calendar as CalendarIcon,
} from "lucide-react";
import { LOSFunnelData } from "@/lib/losSchema";
import { BusinessDataTable } from "@/components/dashboard/BusinessDataTable";
import { useMetrics } from "@/hooks/useMetrics";
import { PeriodValue, getPeriodRange } from "@/utils/closingFalloutFilters";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { MetricExplainButton } from "@/components/common/MetricExplainButton";
import { ExportShareMenu } from "@/components/common/ExportShareMenu";
import type { ExportData, ExportTable } from "@/utils/exportUtils";
import { api } from "@/lib/api";

// Period options for KPI timeframe selectors (mortgage industry standard)
const PERIOD_OPTIONS: Array<{
  value: PeriodValue;
  label: string;
  shortLabel: string;
}> = [
  { value: "mtd", label: "Month to Date", shortLabel: "MTD" },
  { value: "ytd", label: "Year to Date", shortLabel: "YTD" },
  { value: "rolling_90_days", label: "Rolling 90 Days", shortLabel: "R90D" },
  { value: "last_month", label: "Last Month", shortLabel: "Last Mo" },
  { value: "last_year", label: "Last Year", shortLabel: "Last Yr" },
  { value: "all", label: "All Time", shortLabel: "All" },
  { value: "custom", label: "Custom Range", shortLabel: "Custom" },
];

// KPI to metric mapping with their volume counterparts
const KPI_METRICS: Record<string, { primary: string; volume?: string }> = {
  activeLoans: { primary: "active_loans", volume: "active_volume" },
  closedLoans: { primary: "closed_loans", volume: "closed_volume" },
  lockedLoans: { primary: "locked_loans", volume: "locked_volume" },
  cycleTime: { primary: "avg_cycle_time" },
  pullThrough: { primary: "pull_through_rate" },
  creditPulls: { primary: "credit_pulls" },
};

// Executive Dashboard - Business Overview Component (6 Cards with Modals)
interface ExecutiveDashboardProps {
  dateFilter: "today" | "mtd" | "ytd" | "custom";
  year?: number;
  selectedTenantId?: string | null;
}

export const ExecutiveDashboard = React.memo(function ExecutiveDashboard({
  dateFilter,
  year = new Date().getFullYear(),
  selectedTenantId,
}: ExecutiveDashboardProps) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [animatedValues, setAnimatedValues] = useState<Record<string, number>>(
    {}
  );
  const [isAnimating, setIsAnimating] = useState(false);

  // Per-KPI timeframe state (Active Loans doesn't have timeframe - it's current state)
  const [kpiTimeframes, setKpiTimeframes] = useState<
    Record<string, PeriodValue>
  >({
    closedLoans: "mtd",
    lockedLoans: "mtd", // Locked loans can be filtered by lock date
    cycleTime: "mtd",
    pullThrough: "rolling_90_days", // Pull-through uses rolling 90 days (industry standard for 30-45 day loan cycles)
    creditPulls: "mtd",
  });

  // Track which KPI dropdown is open
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);

  // Custom date ranges per KPI (used when period is 'custom')
  const [kpiCustomDates, setKpiCustomDates] = useState<
    Record<string, { start: Date | null; end: Date | null }>
  >({});

  // Track which KPI's calendar popover is open (start or end)
  const [calendarOpen, setCalendarOpen] = useState<{
    kpiId: string;
    type: "start" | "end";
  } | null>(null);

  // Use metrics service for Qlik Logic Dictionary-based calculations
  const {
    queryMetric,
    queryMetrics,
    queryMetricsWithDateRange,
    loading: metricsLoading,
  } = useMetrics(selectedTenantId, year);
  const [metricsData, setMetricsData] = useState<Record<string, any>>({});
  const [loadingKpis, setLoadingKpis] = useState<Set<string>>(new Set());
  const sectionRef = useRef<HTMLDivElement>(null);
  const [breakdownsData, setBreakdownsData] = useState<any>(null);

  // Fetch a single KPI's metrics based on its timeframe
  const fetchKpiMetrics = useCallback(
    async (
      kpiId: string,
      period: PeriodValue,
      customDates?: { start: Date | null; end: Date | null }
    ) => {
      const kpiConfig = KPI_METRICS[kpiId];
      if (!kpiConfig) return;

      setLoadingKpis((prev) => new Set(prev).add(kpiId));

      try {
        const metricsToFetch = [kpiConfig.primary];
        if (kpiConfig.volume) metricsToFetch.push(kpiConfig.volume);

        // Additional metrics for business overview accuracy (dynamic, backend-sourced)
        if (["activeLoans", "closedLoans", "lockedLoans"].includes(kpiId)) {
          metricsToFetch.push("wac", "wa_fico", "wa_ltv");
        }
        if (kpiId === "pullThrough") {
          metricsToFetch.push("total_units", "fallout_withdrawn", "fallout_denied");
        }

        // Active loans ignores date filter (current state)
        const effectivePeriod = kpiId === "activeLoans" ? "all" : period;

        let results;
        let dateFieldOverride: string | undefined;
        if (kpiId === "lockedLoans") {
          dateFieldOverride = "lock_date";
        } else if (kpiId === "closedLoans") {
          dateFieldOverride = "funding_date";
        }
        if (
          effectivePeriod === "custom" &&
          customDates?.start &&
          customDates?.end
        ) {
          // Use custom date range
          results = await queryMetricsWithDateRange(
            metricsToFetch,
            customDates.start,
            customDates.end,
            dateFieldOverride
          );
        } else {
          results = await queryMetrics(
            metricsToFetch,
            effectivePeriod as any,
            dateFieldOverride
          );
        }

        setMetricsData((prev) => ({
          ...prev,
          ...results,
          [`${kpiId}_period`]: effectivePeriod, // Track which period this data is for
        }));
      } catch (error: any) {
        console.error(
          `[ExecutiveDashboard] Error fetching ${kpiId} metrics:`,
          error
        );
      } finally {
        setLoadingKpis((prev) => {
          const next = new Set(prev);
          next.delete(kpiId);
          return next;
        });
      }
    },
    [queryMetrics, queryMetricsWithDateRange]
  );

  // Handle timeframe change for a KPI
  const handleTimeframeChange = useCallback(
    (kpiId: string, period: PeriodValue) => {
      setKpiTimeframes((prev) => ({ ...prev, [kpiId]: period }));
      setOpenDropdown(null);

      // If switching to custom and we have dates, fetch with those dates
      if (period === "custom") {
        const customDates = kpiCustomDates[kpiId];
        if (customDates?.start && customDates?.end) {
          fetchKpiMetrics(kpiId, period, customDates);
        }
        // Otherwise wait for user to select dates
      } else {
        fetchKpiMetrics(kpiId, period);
      }
    },
    [fetchKpiMetrics, kpiCustomDates]
  );

  // Handle custom date selection for a KPI
  const handleCustomDateChange = useCallback(
    (kpiId: string, type: "start" | "end", date: Date | undefined) => {
      setKpiCustomDates((prev) => {
        const current = prev[kpiId] || { start: null, end: null };
        const updated = { ...current, [type]: date || null };
        return { ...prev, [kpiId]: updated };
      });
      setCalendarOpen(null);

      // If both dates are set, fetch the metric
      setTimeout(() => {
        setKpiCustomDates((currentDates) => {
          const dates = currentDates[kpiId];
          if (dates?.start && dates?.end) {
            fetchKpiMetrics(kpiId, "custom", dates);
          }
          return currentDates;
        });
      }, 0);
    },
    [fetchKpiMetrics]
  );

  // Initial fetch for all KPIs based on their default timeframes
  useEffect(() => {
    // Fetch active loans (no date filter)
    fetchKpiMetrics("activeLoans", "all");

    // Fetch other KPIs with their selected timeframes
    Object.entries(kpiTimeframes).forEach(([kpiId, period]) => {
      fetchKpiMetrics(kpiId, period);
    });
  }, [selectedTenantId, year]); // Re-fetch when tenant or year changes

  // Fetch backend breakdowns for loan type/purpose/size
  useEffect(() => {
    const fetchBreakdowns = async () => {
      try {
        const filterParam = dateFilter === "custom" ? "all" : dateFilter;
        const tenantParam = selectedTenantId
          ? `&tenant_id=${selectedTenantId}`
          : "";
        const url = `/api/loans/stats?dateFilter=${filterParam}${tenantParam}&_t=${Date.now()}`;
        const data = await api.request<any>(url);
        setBreakdownsData(data?.breakdowns || null);
      } catch (error) {
        console.warn("[ExecutiveDashboard] Failed to fetch breakdowns:", error);
        setBreakdownsData(null);
      }
    };

    fetchBreakdowns();
  }, [dateFilter, selectedTenantId]);

  // Helper function to format numbers (using utility function)
  // Note: Using formatCompactNumberNoCurrency for non-currency numbers

  // Calculate metrics from metrics service (Qlik Logic Dictionary formulas)
  const metrics = useMemo(() => {
    // Check if we have any metrics data yet
    const hasData = Object.keys(metricsData).length > 0;

    // Show loading state if data is still loading or no data yet
    if (!hasData) {
      return {
        activeLoans: { value: "--", change: "+12%", trend: "up" as const },
        closedLoans: { value: "--", change: "+8%", trend: "up" as const },
        lockedLoans: { value: "--", change: "+5%", trend: "up" as const },
        cycleTime: {
          value: "-- days",
          change: "-2 days",
          trend: "up" as const,
        },
        pullThrough: { value: "--%", change: "+3.2%", trend: "up" as const },
        creditPulls: { value: "--", change: "+15%", trend: "up" as const },
      };
    }

    // Extract values from metrics service (Qlik Logic Dictionary formulas)
    // NOTE: Change percentages are NOT calculated because we don't have prior period data.
    // To show real changes, we would need to fetch metrics for the prior period and compare.
    // Showing fake/estimated changes was removed as it was misleading.

    const activeLoans =
      typeof metricsData.active_loans?.value === "number"
        ? metricsData.active_loans.value
        : parseFloat(metricsData.active_loans?.value as string) || 0;

    const closedLoans =
      typeof metricsData.closed_loans?.value === "number"
        ? metricsData.closed_loans.value
        : parseFloat(metricsData.closed_loans?.value as string) || 0;

    const lockedLoans =
      typeof metricsData.locked_loans?.value === "number"
        ? metricsData.locked_loans.value
        : parseFloat(metricsData.locked_loans?.value as string) || 0;

    const cycleTime =
      typeof metricsData.avg_cycle_time?.value === "number"
        ? metricsData.avg_cycle_time.value
        : parseFloat(metricsData.avg_cycle_time?.value as string) || 0;

    const pullThrough =
      typeof metricsData.pull_through_rate?.value === "number"
        ? metricsData.pull_through_rate.value
        : parseFloat(metricsData.pull_through_rate?.value as string) || 0;

    const creditPulls =
      typeof metricsData.credit_pulls?.value === "number"
        ? metricsData.credit_pulls.value
        : parseFloat(metricsData.credit_pulls?.value as string) || 0;

    // Return metrics without fake change percentages
    // TODO: Implement actual prior period comparison by fetching metrics for previous period
    return {
      activeLoans: {
        value: activeLoans.toLocaleString(),
        change: "--", // No prior period data available
        trend: "up" as const, // Neutral - no comparison data
      },
      closedLoans: {
        value: closedLoans.toLocaleString(),
        change: "--",
        trend: "up" as const,
      },
      lockedLoans: {
        value: lockedLoans.toLocaleString(),
        change: "--",
        trend: "up" as const,
      },
      cycleTime: {
        value: `${cycleTime} days`,
        change: "--",
        trend: "up" as const,
      },
      pullThrough: {
        value: `${pullThrough.toFixed(1)}%`,
        change: "--",
        trend: "up" as const,
      },
      creditPulls: {
        value: creditPulls.toLocaleString(),
        change: "--",
        trend: "up" as const,
      },
    };
  }, [metricsLoading, metricsData]);

  // Helper function to parse numeric value from formatted string
  const parseValue = (valueStr: string): number => {
    // Handle placeholder values
    if (valueStr === "--" || valueStr.includes("--")) {
      return 0;
    }
    // Remove commas, spaces, and extract number (handles formats like "25 days", "72.8%", "1,234")
    const cleaned = valueStr
      .replace(/,/g, "")
      .replace(/\s+/g, "")
      .replace(/[^\d.]/g, "");
    // Match numbers (including decimals)
    const match = cleaned.match(/[\d.]+/);
    if (match) {
      return parseFloat(match[0]);
    }
    return 0;
  };

  // Helper function to format animated value back to original format
  const formatAnimatedValue = (
    cardId: string,
    animatedNum: number,
    originalValue: string
  ): string => {
    if (cardId === "cycleTime") {
      return `${Math.round(animatedNum)} days`;
    }
    if (cardId === "pullThrough") {
      return `${animatedNum.toFixed(1)}%`;
    }
    // For numbers with commas (activeLoans, closedLoans, lockedLoans, creditPulls)
    return Math.round(animatedNum).toLocaleString();
  };

  // KPI Cards Configuration - 6 cards matching the PDF structure with real data - memoized to prevent re-creation
  const kpiCards = useMemo(
    () => [
      {
        id: "activeLoans",
        label: "Active Loans",
        value: metrics.activeLoans.value,
        change: metrics.activeLoans.change,
        trend: metrics.activeLoans.trend,
        color: "from-sky-50 to-sky-100",
        borderColor: "border-sky-200",
        iconBg: "bg-sky-500",
      },
      {
        id: "closedLoans",
        label: "Closed Loans",
        value: metrics.closedLoans.value,
        change: metrics.closedLoans.change,
        trend: metrics.closedLoans.trend,
        color: "from-emerald-50 to-emerald-100",
        borderColor: "border-emerald-200",
        iconBg: "bg-emerald-500",
      },
      {
        id: "lockedLoans",
        label: "Locked Loans",
        value: metrics.lockedLoans.value,
        change: metrics.lockedLoans.change,
        trend: metrics.lockedLoans.trend,
        color: "from-violet-50 to-violet-100",
        borderColor: "border-violet-200",
        iconBg: "bg-violet-500",
      },
      {
        id: "cycleTime",
        label: "Cycle Time",
        value: metrics.cycleTime.value,
        change: metrics.cycleTime.change,
        trend: metrics.cycleTime.trend,
        color: "from-amber-50 to-amber-100",
        borderColor: "border-amber-200",
        iconBg: "bg-amber-500",
      },
      {
        id: "pullThrough",
        label: "Pull-Through (R90D)",
        value: metrics.pullThrough.value,
        change: metrics.pullThrough.change,
        trend: metrics.pullThrough.trend,
        color: "from-rose-50 to-rose-100",
        borderColor: "border-rose-200",
        iconBg: "bg-rose-500",
      },
      {
        id: "creditPulls",
        label: "Credit Pulls",
        value: metrics.creditPulls.value,
        change: metrics.creditPulls.change,
        trend: metrics.creditPulls.trend,
        color: "from-teal-50 to-teal-100",
        borderColor: "border-teal-200",
        iconBg: "bg-teal-500",
      },
    ],
    [metrics]
  );

  // Start count-up animation when component mounts or data changes
  useEffect(() => {
    // Don't animate if data is still loading or if values are placeholders
    if (metricsLoading || metrics.activeLoans.value === "--") {
      // If loading, set animated values to show placeholders, don't animate
      const placeholderValues: Record<string, number> = {};
      kpiCards.forEach((card) => {
        placeholderValues[card.id] = 0; // Will show as card.value which is '--'
      });
      setAnimatedValues(placeholderValues);
      setIsAnimating(false);
      return;
    }

    // If we have real data (even if zeros), animate it
    setIsAnimating(true);
    const initialValues: Record<string, number> = {};

    // Initialize with actual values from metrics - animation will start from these
    // This ensures cards show correct values even if animation doesn't complete
    kpiCards.forEach((card) => {
      const value = parseValue(card.value);
      initialValues[card.id] = isNaN(value) ? 0 : value;
    });
    setAnimatedValues(initialValues);

    // If values are already correct, skip animation and just show them
    const allValuesMatch = kpiCards.every((card) => {
      const currentValue = parseValue(card.value);
      // Valid if it's a number (including 0) and not a placeholder
      return !isNaN(currentValue) && !card.value.includes("--");
    });

    if (allValuesMatch) {
      // Values are already set correctly, just mark animation as done
      setTimeout(() => setIsAnimating(false), 100);
      return;
    }

    // Animate each card in sequence with staggered delay
    const animationDuration = 1500; // 1.5 seconds per card
    const staggerDelay = 200; // 200ms between cards

    kpiCards.forEach((card, index) => {
      const delay = index * staggerDelay;
      const targetValue = parseValue(card.value);
      const startValue = animatedValues[card.id] || 0;

      // Skip animation if value is placeholder or invalid, or if already at target
      if (
        isNaN(targetValue) ||
        (targetValue === 0 && card.value.includes("--"))
      ) {
        return; // Keep current value
      }

      // If already at target value, skip animation
      if (Math.abs(startValue - targetValue) < 0.01) {
        return;
      }

      setTimeout(() => {
        const startTime = Date.now();
        const endValue = targetValue;

        const animate = () => {
          const elapsed = Date.now() - startTime;
          const progress = Math.min(elapsed / animationDuration, 1);

          // Easing function (ease-out)
          const easeOut = 1 - Math.pow(1 - progress, 3);
          const currentValue = startValue + (endValue - startValue) * easeOut;

          setAnimatedValues((prev) => ({
            ...prev,
            [card.id]: currentValue,
          }));

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            // Ensure final value is exact
            setAnimatedValues((prev) => ({
              ...prev,
              [card.id]: endValue,
            }));
          }
        };

        animate();
      }, delay);
    });

    // Mark animation as complete after all cards finish
    const totalDuration = kpiCards.length * staggerDelay + animationDuration;
    setTimeout(() => {
      setIsAnimating(false);
    }, totalDuration);
  }, [year, metrics, metricsLoading]); // Re-animate when year, metrics, or loading state change

  // Helper function to format business overview values
  const formatBusinessValue = (
    value: number,
    type:
      | "units"
      | "volume"
      | "rate"
      | "balance"
      | "fico"
      | "ltv"
      | "days"
      | "percent"
  ): string => {
    if (type === "units") return value.toLocaleString();
    if (type === "volume") {
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
      return `$${value.toFixed(0)}`;
    }
    if (type === "rate") return `${value.toFixed(3)}%`;
    if (type === "balance") {
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
      return `$${value.toFixed(0)}`;
    }
    if (type === "fico") return value.toFixed(0);
    if (type === "ltv") return `${value.toFixed(1)}%`;
    if (type === "days") return `${value.toFixed(0)} days`;
    if (type === "percent") return `${value.toFixed(1)}%`;
    return value.toString();
  };

  /**
   * Calculate business overview data from metrics (Qlik Logic Dictionary).
   * Mortgage industry definitions (MBA / best practice):
   * - Active Loans: Pipeline count/volume (loans in process, not yet funded). Current state.
   * - Closed Loans: Funded count/volume in period (closed_date in range). MTD/YTD.
   * - Locked Loans: Rate-locked count/volume in period (lock_date in range). Often a subset of pipeline.
   * - Cycle Time: Avg days from application to funding (total days / loans funded). Industry typical 45–51 days.
   * - Pull-Through Rate: Funded / applications in period (e.g. rolling 90 days). Fallout = 1 - pull-through.
   * Do not sum Active + Locked + Closed for totals (locked is typically a subset of pipeline).
   */
  const calculateBusinessOverviewData = () => {
    const hasData = Object.keys(metricsData).length > 0;

    if (!hasData) {
      return {
        activeLoans: {
          summary: {
            units: "--",
            volume: "--",
            avgInterestRate: "--",
            avgBalance: "--",
            avgFICO: "--",
            avgLTV: "--",
          },
          byLoanType: [],
          byLoanPurpose: [],
          byLoanSize: [],
          byStage: [],
        },
        closedLoans: {
          summary: {
            units: "--",
            volume: "--",
            avgInterestRate: "--",
            avgBalance: "--",
            avgFICO: "--",
            avgLTV: "--",
          },
          byLoanType: [],
          byLoanPurpose: [],
          byLoanSize: [],
        },
        lockedLoans: {
          summary: {
            units: "--",
            volume: "--",
            avgInterestRate: "--",
            avgBalance: "--",
            avgFICO: "--",
            avgLTV: "--",
          },
          byExpirationDays: [],
        },
        cycleTime: { avgDaysToFunding: "--", byStage: [], byLoanType: [] },
        pullThrough: { avgPercent: "--", byLoanType: [], falloutBreakdown: [] },
        creditPulls: { byLoanType: [], byLoanPurpose: [] },
      };
    }

    // Extract values from metrics service
    const activeUnits =
      typeof metricsData.active_loans?.value === "number"
        ? metricsData.active_loans.value
        : parseFloat(metricsData.active_loans?.value as string) || 0;
    const activeVolume =
      typeof metricsData.active_volume?.value === "number"
        ? metricsData.active_volume.value
        : parseFloat(metricsData.active_volume?.value as string) || 0;
    const activeAvgBalance = activeUnits > 0 ? activeVolume / activeUnits : 0;

    const closedUnits =
      typeof metricsData.closed_loans?.value === "number"
        ? metricsData.closed_loans.value
        : parseFloat(metricsData.closed_loans?.value as string) || 0;
    const closedVolume =
      typeof metricsData.closed_volume?.value === "number"
        ? metricsData.closed_volume.value
        : parseFloat(metricsData.closed_volume?.value as string) || 0;
    const closedAvgBalance = closedUnits > 0 ? closedVolume / closedUnits : 0;

    const lockedUnits =
      typeof metricsData.locked_loans?.value === "number"
        ? metricsData.locked_loans.value
        : parseFloat(metricsData.locked_loans?.value as string) || 0;
    const lockedVolume =
      typeof metricsData.locked_volume?.value === "number"
        ? metricsData.locked_volume.value
        : parseFloat(metricsData.locked_volume?.value as string) || 0;
    const lockedAvgBalance = lockedUnits > 0 ? lockedVolume / lockedUnits : 0;

    const avgInterestRate =
      typeof metricsData.wac?.value === "number"
        ? metricsData.wac.value
        : parseFloat(metricsData.wac?.value as string) || 0;
    const avgFICO =
      typeof metricsData.wa_fico?.value === "number"
        ? metricsData.wa_fico.value
        : parseFloat(metricsData.wa_fico?.value as string) || 0;
    const avgLTV =
      typeof metricsData.wa_ltv?.value === "number"
        ? metricsData.wa_ltv.value
        : parseFloat(metricsData.wa_ltv?.value as string) || 0;

    // Cycle Time: avg days from application to funding (industry standard: total days / loans funded)
    const avgDaysToFunding =
      typeof metricsData.avg_cycle_time?.value === "number"
        ? metricsData.avg_cycle_time.value
        : parseFloat(metricsData.avg_cycle_time?.value as string) || 0;
    const cycleTimeByStage: { label: string; values: string[] }[] = [];

    // Pull-Through: funded loans / applications (same period). Rolling 90D is industry standard for 30–45 day cycles.
    const pullThroughPercent =
      typeof metricsData.pull_through_rate?.value === "number"
        ? metricsData.pull_through_rate.value
        : parseFloat(metricsData.pull_through_rate?.value as string) || 0;
    const companyAvg = pullThroughPercent;

    const totalUnits =
      typeof metricsData.total_units?.value === "number"
        ? metricsData.total_units.value
        : parseFloat(metricsData.total_units?.value as string) || 0;

    const metricsHeadersLocal = [
      "Units",
      "Volume",
      "Avg Rate",
      "Avg Bal",
      "FICO",
      "LTV",
    ];
    const cycleTimeHeadersLocal = ["Current", "Prior", "Change"];
    const pullThroughHeadersLocal = ["Value", "Co. Avg", "Status"];
    const creditPullHeadersLocal = ["MTD", "Last Mo."];

    const emptyRows = (headers: string[]) => [
      { label: "No data", values: headers.map(() => "--") },
    ];

    const mapBreakdownRows = (rows: any[] = []) =>
      rows.map((row) => {
        const units = Number(row.units ?? row.count ?? 0);
        const volume = Number(row.volume ?? 0);
        const avgBalance =
          Number(row.avg_balance ?? row.avgBalance ?? 0) ||
          (units > 0 ? volume / units : 0);
        const wac = Number(row.wac ?? row.avgInterestRate ?? 0);
        const waFico = Number(row.wa_fico ?? row.waFico ?? row.avgFICO ?? 0);
        const waLtv = Number(row.wa_ltv ?? row.waLtv ?? row.avgLTV ?? 0);
        return {
          label: row.category || row.loan_type || row.loan_purpose || "Unknown",
          values: [
            formatBusinessValue(units, "units"),
            formatBusinessValue(volume, "volume"),
            formatBusinessValue(wac, "rate"),
            formatBusinessValue(avgBalance, "balance"),
            formatBusinessValue(waFico, "fico"),
            formatBusinessValue(waLtv, "ltv"),
          ],
        };
      });

    const hasActiveBreakdowns =
      breakdownsData?.active?.byLoanType?.length > 0;
    const hasClosedBreakdowns =
      breakdownsData?.closed?.byLoanType?.length > 0;

    const activeByStage: { label: string; values: string[] }[] = [];
    const lockedByExpirationDays: { label: string; values: string[] }[] = [];
    const cycleTimeByLoanType: { label: string; values: string[] }[] = [];
    const pullThroughByLoanType: { label: string; values: string[] }[] = [];

    // Fallout breakdown: Withdrawn + Denied = fallout (inverse of pull-through). Use API metrics when available.
    const withdrawnUnits =
      typeof metricsData.fallout_withdrawn?.value === "number"
        ? metricsData.fallout_withdrawn.value
        : parseFloat(metricsData.fallout_withdrawn?.value as string) || 0;
    const deniedUnits =
      typeof metricsData.fallout_denied?.value === "number"
        ? metricsData.fallout_denied.value
        : parseFloat(metricsData.fallout_denied?.value as string) || 0;
    const totalFallout = withdrawnUnits + deniedUnits;
    const withdrawnPct =
      totalUnits > 0 ? (withdrawnUnits / totalUnits) * 100 : 0;
    const deniedPct = totalUnits > 0 ? (deniedUnits / totalUnits) * 100 : 0;
    const falloutAvg = totalUnits > 0 ? (totalFallout / totalUnits) * 100 : 0;

    const falloutBreakdown = [
      {
        label: "Withdrawn",
        values: [
          formatBusinessValue(withdrawnPct, "percent"),
          formatBusinessValue(falloutAvg, "percent"),
          withdrawnPct <= falloutAvg ? "Below Avg" : "Above Avg",
        ],
      },
      {
        label: "Denied",
        values: [
          formatBusinessValue(deniedPct, "percent"),
          formatBusinessValue(falloutAvg, "percent"),
          deniedPct <= falloutAvg ? "Below Avg" : "Above Avg",
        ],
      },
    ];

    // Credit Pulls - use metrics data
    const creditPullsTotal =
      typeof metricsData.credit_pulls?.value === "number"
        ? metricsData.credit_pulls.value
        : parseFloat(metricsData.credit_pulls?.value as string) || 0;
    const creditPullsByLoanType: { label: string; values: string[] }[] = [];
    const creditPullsByLoanPurpose: { label: string; values: string[] }[] = [];

    return {
      activeLoans: {
        summary: {
          units: formatBusinessValue(activeUnits, "units"),
          volume: formatBusinessValue(
            activeVolume || activeUnits * activeAvgBalance,
            "volume"
          ),
          avgInterestRate: formatBusinessValue(avgInterestRate, "rate"),
          avgBalance: formatBusinessValue(activeAvgBalance, "balance"),
          avgFICO: formatBusinessValue(avgFICO, "fico"),
          avgLTV: formatBusinessValue(avgLTV, "ltv"),
        },
        byLoanType: hasActiveBreakdowns
          ? mapBreakdownRows(breakdownsData.active.byLoanType)
          : emptyRows(metricsHeadersLocal),
        byLoanPurpose:
          breakdownsData?.active?.byLoanPurpose?.length > 0
            ? mapBreakdownRows(breakdownsData.active.byLoanPurpose)
            : emptyRows(metricsHeadersLocal),
        byLoanSize:
          breakdownsData?.active?.byLoanSize?.length > 0
            ? mapBreakdownRows(breakdownsData.active.byLoanSize)
            : emptyRows(metricsHeadersLocal),
        byStage:
          activeByStage.length > 0
            ? activeByStage
            : emptyRows(metricsHeadersLocal),
      },
      closedLoans: {
        summary: {
          units: formatBusinessValue(closedUnits, "units"),
          volume: formatBusinessValue(closedVolume, "volume"),
          avgInterestRate: formatBusinessValue(avgInterestRate, "rate"),
          avgBalance: formatBusinessValue(closedAvgBalance, "balance"),
          avgFICO: formatBusinessValue(avgFICO, "fico"),
          avgLTV: formatBusinessValue(avgLTV, "ltv"),
        },
        byLoanType: hasClosedBreakdowns
          ? mapBreakdownRows(breakdownsData.closed.byLoanType)
          : emptyRows(metricsHeadersLocal),
        byLoanPurpose:
          breakdownsData?.closed?.byLoanPurpose?.length > 0
            ? mapBreakdownRows(breakdownsData.closed.byLoanPurpose)
            : emptyRows(metricsHeadersLocal),
        byLoanSize:
          breakdownsData?.closed?.byLoanSize?.length > 0
            ? mapBreakdownRows(breakdownsData.closed.byLoanSize)
            : emptyRows(metricsHeadersLocal),
      },
      lockedLoans: {
        summary: {
          units: formatBusinessValue(lockedUnits, "units"),
          volume: formatBusinessValue(lockedVolume, "volume"),
          avgInterestRate: formatBusinessValue(avgInterestRate, "rate"),
          avgBalance: formatBusinessValue(lockedAvgBalance, "balance"),
          avgFICO: formatBusinessValue(avgFICO, "fico"),
          avgLTV: formatBusinessValue(avgLTV, "ltv"),
        },
        byExpirationDays:
          lockedByExpirationDays.length > 0
            ? lockedByExpirationDays
            : emptyRows(metricsHeadersLocal),
      },
      cycleTime: {
        avgDaysToFunding: formatBusinessValue(avgDaysToFunding, "days"),
        byStage:
          cycleTimeByStage.length > 0
            ? cycleTimeByStage
            : emptyRows(cycleTimeHeadersLocal),
        byLoanType:
          cycleTimeByLoanType.length > 0
            ? cycleTimeByLoanType
            : emptyRows(cycleTimeHeadersLocal),
      },
      pullThrough: {
        avgPercent: formatBusinessValue(pullThroughPercent, "percent"),
        byLoanType:
          pullThroughByLoanType.length > 0
            ? pullThroughByLoanType
            : emptyRows(pullThroughHeadersLocal),
        falloutBreakdown: falloutBreakdown,
      },
      creditPulls: {
        byLoanType:
          creditPullsByLoanType.length > 0
            ? creditPullsByLoanType
            : emptyRows(creditPullHeadersLocal),
        byLoanPurpose:
          creditPullsByLoanPurpose.length > 0
            ? creditPullsByLoanPurpose
            : emptyRows(creditPullHeadersLocal),
      },
    };
  };

  // Memoize business overview data to prevent recalculation on every render
  const businessOverviewData = useMemo(() => {
    return calculateBusinessOverviewData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsData, kpiTimeframes]);

  const metricsHeaders = [
    "Units",
    "$ Volume",
    "Avg Rate",
    "Avg Bal",
    "FICO",
    "LTV",
  ];
  const summaryDataKeys: (keyof typeof businessOverviewData.activeLoans.summary)[] = [
    "units",
    "volume",
    "avgInterestRate",
    "avgBalance",
    "avgFICO",
    "avgLTV",
  ];
  const cycleTimeHeaders = ["Avg Days", "Prior Period", "Change"];
  const cycleTypeHeaders = ["Avg Days", "Trend", "Status"];
  const pullThroughHeaders = ["Value", "Co. Avg", "Status"];
  const creditPullHeaders = ["MTD", "Last Mo."];

  const buildExportTables = (
    sections: Array<{
      title: string;
      headers?: string[];
      rows?: { label: string; values: string[] }[];
      summaryData?: Record<string, string>;
    }>
  ): ExportTable[] =>
    sections.map((section) => {
      const headers = section.headers || metricsHeaders;
      const rows: Array<Array<string>> = [];
      if (section.summaryData) {
        const summaryRow = summaryDataKeys.map(
          (key) => section.summaryData?.[key] || "--"
        );
        rows.push(["Summary", ...summaryRow]);
      }
      if (section.rows) {
        section.rows.forEach((row) => {
          rows.push([row.label, ...row.values]);
        });
      }
      return {
        name: section.title,
        headers: ["Label", ...headers],
        rows,
      };
    });

  const getCardExportData = (cardId: string): ExportData => {
    const modalContent = getModalContent(cardId);
    return {
      title: modalContent.title,
      tables: buildExportTables(modalContent.sections || []),
    };
  };

  // Helper to get timeframe label for modal subtitle
  const getTimeframeLabel = (cardId: string): string => {
    if (cardId === "activeLoans") return "Current State";
    const period = kpiTimeframes[cardId] || "mtd";
    if (period === "custom") {
      const dates = kpiCustomDates[cardId];
      if (dates?.start && dates?.end) {
        return `${format(dates.start, "MMM d")} - ${format(
          dates.end,
          "MMM d, yyyy"
        )}`;
      }
      return "Custom Range";
    }
    return (
      PERIOD_OPTIONS.find((p) => p.value === period)?.label || "Month to Date"
    );
  };

  // Get modal content based on selected card
  const getModalContent = (cardId: string) => {
    const timeframeLabel = getTimeframeLabel(cardId);

    switch (cardId) {
      case "activeLoans":
        return {
          title: "Active Loans",
          subtitle: "Currently in pipeline (current state)",
          color: "bg-sky-50",
          borderColor: "border-sky-200",
          accentColor: "text-sky-600",
          sections: [
            {
              title: "Summary",
              headers: metricsHeaders,
              summaryData: businessOverviewData.activeLoans.summary,
            },
            {
              title: "By Loan Type",
              headers: metricsHeaders,
              rows: businessOverviewData.activeLoans.byLoanType,
            },
            {
              title: "By Loan Purpose",
              headers: metricsHeaders,
              rows: businessOverviewData.activeLoans.byLoanPurpose,
            },
            {
              title: "By Loan Size",
              headers: metricsHeaders,
              rows: businessOverviewData.activeLoans.byLoanSize,
            },
            {
              title: "By Stage",
              headers: metricsHeaders,
              rows: businessOverviewData.activeLoans.byStage,
            },
          ],
        };
      case "closedLoans":
        return {
          title: "Closed Loans",
          subtitle: `Successfully funded • ${timeframeLabel}`,
          color: "bg-emerald-50",
          borderColor: "border-emerald-200",
          accentColor: "text-emerald-600",
          sections: [
            {
              title: "Summary",
              headers: metricsHeaders,
              summaryData: businessOverviewData.closedLoans.summary,
            },
            {
              title: "By Loan Type",
              headers: metricsHeaders,
              rows: businessOverviewData.closedLoans.byLoanType,
            },
            {
              title: "By Loan Purpose",
              headers: metricsHeaders,
              rows: businessOverviewData.closedLoans.byLoanPurpose,
            },
            {
              title: "By Loan Size",
              headers: metricsHeaders,
              rows: businessOverviewData.closedLoans.byLoanSize,
            },
          ],
        };
      case "lockedLoans":
        return {
          title: "Locked Loans",
          subtitle: `Rate locks in progress • ${timeframeLabel}`,
          color: "bg-violet-50",
          borderColor: "border-violet-200",
          accentColor: "text-violet-600",
          sections: [
            {
              title: "Summary",
              headers: metricsHeaders,
              summaryData: businessOverviewData.lockedLoans.summary,
            },
            {
              title: "By Expiration Days",
              headers: metricsHeaders,
              rows: businessOverviewData.lockedLoans.byExpirationDays,
            },
          ],
        };
      case "cycleTime":
        return {
          title: "Cycle Time Analysis",
          subtitle: `Avg: ${businessOverviewData.cycleTime.avgDaysToFunding} days • ${timeframeLabel}`,
          color: "bg-amber-50",
          borderColor: "border-amber-200",
          accentColor: "text-amber-600",
          sections: [
            {
              title: "Time By Stage",
              headers: cycleTimeHeaders,
              rows: businessOverviewData.cycleTime.byStage,
            },
            {
              title: "By Loan Type",
              headers: cycleTypeHeaders,
              rows: businessOverviewData.cycleTime.byLoanType,
            },
          ],
        };
      case "pullThrough":
        return {
          title: "Pull-Through Rate",
          subtitle: `${businessOverviewData.pullThrough.avgPercent}% • ${timeframeLabel}`,
          color: "bg-rose-50",
          borderColor: "border-rose-200",
          accentColor: "text-rose-600",
          sections: [
            {
              title: "By Loan Type",
              headers: pullThroughHeaders,
              rows: businessOverviewData.pullThrough.byLoanType,
            },
            {
              title: "Fallout Breakdown",
              headers: pullThroughHeaders,
              rows: businessOverviewData.pullThrough.falloutBreakdown,
            },
          ],
        };
      case "creditPulls":
        return {
          title: "Credit Pulls",
          subtitle: `Application volume • ${timeframeLabel}`,
          color: "bg-teal-50",
          borderColor: "border-teal-200",
          accentColor: "text-teal-600",
          sections: [
            {
              title: "By Loan Type",
              headers: creditPullHeaders,
              rows: businessOverviewData.creditPulls.byLoanType,
            },
            {
              title: "By Loan Purpose",
              headers: creditPullHeaders,
              rows: businessOverviewData.creditPulls.byLoanPurpose,
            },
          ],
        };
      default:
        return null;
    }
  };

  return (
    <div className="mb-8">
      {/* Business Overview Card */}
      <div
        ref={sectionRef}
        className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 sm:p-6 md:p-8"
      >
        {/* Section Header - Matching Cohi Dialogues */}
        <div className="flex items-center justify-between gap-3 sm:gap-4 mb-4 sm:mb-6">
          <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
            <div className="relative flex-shrink-0">
              <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-[#007AFF] to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                <Target className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
              </div>
            </div>
            <div className="min-w-0">
              <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
                Business Overview
              </h3>
              <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light truncate">
                Key performance metrics at a glance
              </p>
            </div>
          </div>
          <ExportShareMenu
            title="Business Overview"
            targetRef={sectionRef}
            shareTarget={{
              type: "executive-dashboard",
              tenantId: selectedTenantId || undefined,
              label: "Business Overview",
            }}
          />
        </div>

        {/* KPI Cards Grid - 6 cards in a row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {kpiCards.map((card) => {
            const hasTimeframe = card.id !== "activeLoans";
            const selectedPeriod = kpiTimeframes[card.id] || "mtd";
            // Show custom date range or standard period label
            const customDates = kpiCustomDates[card.id];
            const selectedPeriodLabel =
              selectedPeriod === "custom" &&
              customDates?.start &&
              customDates?.end
                ? `${format(customDates.start, "M/d")}-${format(
                    customDates.end,
                    "M/d"
                  )}`
                : PERIOD_OPTIONS.find((p) => p.value === selectedPeriod)
                    ?.shortLabel || "MTD";
            const isLoading = loadingKpis.has(card.id);

            return (
              <motion.div
                key={card.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className={`bg-white dark:bg-slate-800/50 rounded-xl border ${
                  card.borderColor
                } dark:border-slate-700 p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] transition-all duration-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center relative ${
                  isLoading ? "opacity-70" : ""
                }`}
              >
                {/* Metric Info Button (top-left) */}
                <div className="absolute top-1 left-1">
                  <MetricExplainButton
                    metricId={KPI_METRICS[card.id]?.primary || card.id}
                    currentValue={card.value}
                    period={hasTimeframe ? selectedPeriodLabel : "Current"}
                    tenantId={selectedTenantId}
                    size="sm"
                  />
                </div>

                {/* Timeframe Dropdown (not for Active Loans) */}
                {hasTimeframe && (
                  <div className="absolute top-1 right-1">
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdown(
                            openDropdown === card.id ? null : card.id
                          );
                        }}
                        className="flex items-center gap-0.5 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-medium text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 rounded transition-colors"
                        title={`Change timeframe (${
                          PERIOD_OPTIONS.find((p) => p.value === selectedPeriod)
                            ?.label
                        })`}
                      >
                        {selectedPeriodLabel}
                        <ChevronDown className="w-2.5 h-2.5" />
                      </button>
                      {openDropdown === card.id && (
                        <>
                          <div
                            className="fixed inset-0 z-40"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenDropdown(null);
                              setCalendarOpen(null);
                            }}
                          />
                          <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 min-w-[140px]">
                            {PERIOD_OPTIONS.map((option) => (
                              <button
                                key={option.value}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleTimeframeChange(card.id, option.value);
                                }}
                                className={`w-full text-left px-3 py-1.5 text-[10px] sm:text-xs hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors ${
                                  selectedPeriod === option.value
                                    ? "text-blue-600 dark:text-blue-400 font-medium bg-blue-50 dark:bg-blue-900/20"
                                    : "text-slate-700 dark:text-slate-300"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}

                            {/* Custom date range pickers */}
                            {selectedPeriod === "custom" && (
                              <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-2 px-2 pb-2">
                                <div className="text-[9px] text-slate-500 mb-1.5 font-medium">
                                  Custom Range
                                </div>
                                <div className="flex flex-col gap-1.5">
                                  {/* Start Date */}
                                  <Popover
                                    open={
                                      calendarOpen?.kpiId === card.id &&
                                      calendarOpen?.type === "start"
                                    }
                                    onOpenChange={(open) =>
                                      setCalendarOpen(
                                        open
                                          ? { kpiId: card.id, type: "start" }
                                          : null
                                      )
                                    }
                                  >
                                    <PopoverTrigger asChild>
                                      <button
                                        onClick={(e) => e.stopPropagation()}
                                        className={cn(
                                          "flex items-center gap-1 px-2 py-1 text-[9px] border rounded bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors w-full justify-start",
                                          !kpiCustomDates[card.id]?.start &&
                                            "text-slate-400"
                                        )}
                                      >
                                        <CalendarIcon className="w-2.5 h-2.5" />
                                        {kpiCustomDates[card.id]?.start
                                          ? format(
                                              kpiCustomDates[card.id].start!,
                                              "MMM d, yyyy"
                                            )
                                          : "Start date"}
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      className="w-auto p-0 z-[60]"
                                      align="start"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Calendar
                                        mode="single"
                                        selected={
                                          kpiCustomDates[card.id]?.start ||
                                          undefined
                                        }
                                        onSelect={(date) =>
                                          handleCustomDateChange(
                                            card.id,
                                            "start",
                                            date
                                          )
                                        }
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>

                                  {/* End Date */}
                                  <Popover
                                    open={
                                      calendarOpen?.kpiId === card.id &&
                                      calendarOpen?.type === "end"
                                    }
                                    onOpenChange={(open) =>
                                      setCalendarOpen(
                                        open
                                          ? { kpiId: card.id, type: "end" }
                                          : null
                                      )
                                    }
                                  >
                                    <PopoverTrigger asChild>
                                      <button
                                        onClick={(e) => e.stopPropagation()}
                                        className={cn(
                                          "flex items-center gap-1 px-2 py-1 text-[9px] border rounded bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors w-full justify-start",
                                          !kpiCustomDates[card.id]?.end &&
                                            "text-slate-400"
                                        )}
                                      >
                                        <CalendarIcon className="w-2.5 h-2.5" />
                                        {kpiCustomDates[card.id]?.end
                                          ? format(
                                              kpiCustomDates[card.id].end!,
                                              "MMM d, yyyy"
                                            )
                                          : "End date"}
                                      </button>
                                    </PopoverTrigger>
                                    <PopoverContent
                                      className="w-auto p-0 z-[60]"
                                      align="start"
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      <Calendar
                                        mode="single"
                                        selected={
                                          kpiCustomDates[card.id]?.end ||
                                          undefined
                                        }
                                        onSelect={(date) =>
                                          handleCustomDateChange(
                                            card.id,
                                            "end",
                                            date
                                          )
                                        }
                                        initialFocus
                                      />
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Card Content - Clickable for details */}
                <div
                  onClick={() => setSelectedCard(card.id)}
                  className="cursor-pointer hover:scale-[1.02] transition-transform"
                >
                  <div className="flex items-center justify-center mb-2 gap-2">
                    <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                      {card.label}
                    </span>
                    {isLoading || card.value.includes("--") ? (
                      <Skeleton className="h-4 w-12" />
                    ) : card.change === "--" ? (
                      // No comparison data available - hide the change indicator
                      <span className="text-[10px] sm:text-xs text-slate-400 dark:text-slate-500">
                        --
                      </span>
                    ) : (
                      <span
                        className={`inline-flex items-center gap-0.5 text-[10px] sm:text-xs font-medium ${
                          card.trend === "up"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-rose-600 dark:text-rose-400"
                        }`}
                      >
                        {card.trend === "up" ? (
                          <ArrowUp className="w-3 h-3" />
                        ) : (
                          <ArrowDown className="w-3 h-3" />
                        )}
                        {card.change}
                      </span>
                    )}
                  </div>
                  <div className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
                    {isLoading || card.value.includes("--") ? (
                      <Skeleton className="h-7 w-20 mx-auto" />
                    ) : isAnimating && animatedValues[card.id] !== undefined ? (
                      formatAnimatedValue(
                        card.id,
                        animatedValues[card.id],
                        card.value
                      )
                    ) : animatedValues[card.id] !== undefined ? (
                      formatAnimatedValue(
                        card.id,
                        animatedValues[card.id],
                        card.value
                      )
                    ) : (
                      card.value
                    )}
                  </div>
                  <p className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 mt-2 text-center">
                    {hasTimeframe
                      ? `${selectedPeriodLabel} • Click for details`
                      : "Current • Click for details"}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Modal for Card Details */}
      <AnimatePresence>
        {selectedCard &&
          (() => {
            const modalContent = getModalContent(selectedCard);
            if (!modalContent) return null;

            return (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 top-16 sm:top-0 bg-slate-500/20 backdrop-blur-sm z-50 flex items-start justify-center pt-0 sm:pt-4 md:pt-16 lg:pt-24 pb-0 sm:pb-2 md:pb-6 px-0 sm:px-2 md:px-4 overflow-y-auto"
                onClick={() => setSelectedCard(null)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0, y: 20 }}
                  animate={{ scale: 1, opacity: 1, y: 0 }}
                  exit={{ scale: 0.95, opacity: 0, y: 20 }}
                  transition={{ type: "spring", damping: 25, stiffness: 300 }}
                  onClick={(e) => e.stopPropagation()}
                  className={`bg-white dark:bg-slate-800 rounded-none sm:rounded-xl md:rounded-2xl shadow-xl w-full sm:max-w-2xl sm:w-[calc(100vw-1rem)] md:w-full border-0 sm:border ${modalContent.borderColor} dark:border-slate-700 h-[calc(100vh-4rem)] sm:h-auto sm:max-h-[calc(100vh-2rem)] md:max-h-[calc(100vh-4rem)] lg:max-h-[calc(100vh-8rem)] flex flex-col relative`}
                >
                  {/* Fixed Close Button - Always Visible */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedCard(null);
                    }}
                    className="absolute top-3 right-3 sm:top-3 sm:right-3 md:top-4 md:right-4
                    flex items-center justify-center touch-manipulation
                    w-9 h-9 sm:w-8 sm:h-8 md:w-8 md:h-8
                    rounded-full
                    bg-white/90 dark:bg-slate-800/90
                    border border-slate-200 dark:border-slate-700
                    shadow-sm
                    hover:bg-slate-50 dark:hover:bg-slate-700
                    active:bg-slate-100 dark:active:bg-slate-600
                    active:scale-95
                    transition-all duration-200 ease-in-out
                    backdrop-blur-sm
                    focus:outline-none focus:ring-2 focus:ring-slate-300 focus:ring-offset-1"
                    aria-label="Close modal"
                    type="button"
                    style={{ zIndex: 9999 }}
                  >
                    <X
                      className="w-4 h-4 sm:w-4 sm:h-4 md:w-4 md:h-4 text-slate-500 dark:text-slate-400"
                      strokeWidth={1.5}
                    />
                  </button>

                  {/* Modal Header - Mobile First */}
                  <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-3 md:py-4 pr-16 sm:pr-16 md:pr-16 border-b border-slate-200 dark:border-slate-700 flex items-center flex-shrink-0 bg-slate-50 dark:bg-slate-800/50 relative sticky top-0 backdrop-blur-sm">
                    <div className="min-w-0 flex-1">
                      <h2
                        className={`text-base sm:text-base md:text-lg lg:text-xl font-semibold ${modalContent.accentColor} truncate`}
                      >
                        {modalContent.title}
                      </h2>
                      <p className="text-[10px] sm:text-[10px] md:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                        {modalContent.subtitle}
                      </p>
                    </div>
                  </div>

                  {/* Modal Content - Mobile First */}
                  <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 md:py-6 overflow-y-auto space-y-3 sm:space-y-4 md:space-y-6 flex-1 min-h-0">
                    {modalContent.sections.map((section, idx) => (
                      <div key={idx} className="w-full">
                        <h3 className="text-[10px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 sm:mb-3 uppercase tracking-wider">
                          {section.title}
                        </h3>

                        {/* Summary Row (if exists) - headers and summary keys aligned for correct column order */}
                        {section.summaryData && (
                          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-6 gap-1.5 sm:gap-1.5 md:gap-2 mb-3 sm:mb-4 w-full">
                            {section.headers.map((header, i) => (
                              <div
                                key={i}
                                className="text-center p-1.5 sm:p-1.5 md:p-2 bg-slate-50 dark:bg-slate-800/40 rounded-md sm:rounded-lg border border-slate-200 dark:border-slate-700 min-w-0 overflow-hidden"
                              >
                                <p className="text-[8px] sm:text-[8px] md:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 sm:mb-1 leading-tight break-words line-clamp-2">
                                  {header}
                                </p>
                                <p className="text-[10px] sm:text-[10px] md:text-xs lg:text-sm font-semibold text-slate-900 dark:text-white break-words break-all hyphens-auto line-clamp-2">
                                  {(section.summaryData as Record<string, string>)[summaryDataKeys[i]]}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Data Table (if rows exist) */}
                        {section.rows && (
                          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 p-2 sm:p-2.5 md:p-3 w-full">
                            <BusinessDataTable
                              headers={section.headers}
                              rows={section.rows}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </motion.div>
              </motion.div>
            );
          })()}
      </AnimatePresence>
    </div>
  );
});
