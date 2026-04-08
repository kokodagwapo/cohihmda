import React, { useState, useEffect, useMemo, useCallback } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTheme } from "@/components/theme-provider";
import {
  Share2,
  Calendar,
  Clock,
  Search,
  Download,
  TrendingUp,
  BarChart3,
  Users,
  DollarSign,
  Loader2,
  AlertCircle,
  Maximize2,
  X,
  CheckSquare,
  Square,
  ListChecks,
} from "lucide-react";
import {
  useTopTieringSelectionStore,
  TopTieringSelectionItem,
} from "@/stores/topTieringSelectionStore";
import {
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ComposedChart,
  Tooltip,
  Cell,
  ReferenceLine,
} from "recharts";
import { formatCompactNumber } from "@/utils/formatting";
import {
  useTopTieringComparisonData,
  TopTieringActorType,
  TimeFilterType,
  TopTieringActor as APIActorData,
  CustomDateRange,
} from "@/hooks/useTopTieringComparisonData";
import { DatePeriodPicker, computePresetDateRange, type PeriodSelection, type PeriodPreset } from "@/components/ui/DatePeriodPicker";
import { api } from "@/lib/api";
import { DashboardInsightsStrip } from "@/components/dashboard/DashboardInsightsStrip";
import {
  useDashboardInsights,
  type DashboardInsightItem,
} from "@/hooks/useDashboardInsights";

type TopTieringActor = "branch" | "loan-officer";
type TimeFilter =
  | "last-year"
  | "last-quarter"
  | "last-month"
  | "ytd"
  | "qtd"
  | "mtd"
  | "trailing-12"
  | "custom";

const INSIGHT_DATE_PERIOD_TO_TIME_FILTER: Record<string, TimeFilter> = {
  mtd: "mtd",
  qtd: "qtd",
  ytd: "ytd",
  lm: "last-month",
  lq: "last-quarter",
  ly: "last-year",
  t12: "trailing-12",
};

const INSIGHT_WIDGET_IDS = new Set([
  "ttc-kpi-total-revenue",
  "ttc-kpi-total-units",
  "ttc-kpi-avg-revenue-bps",
  "ttc-kpi-actor-count",
  "ttc-revenue-chart",
  "ttc-units-volume-chart",
  "ttc-revenue-quality-chart",
  "ttc-detail-table",
  "ttc-story-panel",
]);

/** Map PeriodSelection to TopTiering TimeFilter + optional CustomDateRange */
const mapPeriodToTopTiering = (selection: PeriodSelection): { timeFilter: TimeFilter; customDateRange?: CustomDateRange } => {
  if (selection.type === 'custom') {
    return { timeFilter: 'custom', customDateRange: { start: selection.dateRange.start, end: selection.dateRange.end } };
  }
  const directMap: Record<string, TimeFilter> = {
    'mtd': 'mtd', 'qtd': 'qtd', 'ytd': 'ytd',
    'last-month': 'last-month', 'last-quarter': 'last-quarter',
    'last-year': 'last-year', 'trailing-12': 'trailing-12',
  };
  const preset = selection.preset;
  if (preset && directMap[preset]) return { timeFilter: directMap[preset] };
  return { timeFilter: 'last-year' };
};

/** Map TopTiering timeFilter + customDateRange back to PeriodSelection so DatePeriodPicker stays in sync when data reloads */
function toptieringTimeToPeriodSelection(
  timeFilter: TimeFilter,
  customDateRange: CustomDateRange | undefined
): PeriodSelection {
  if (timeFilter === 'custom' && customDateRange) {
    return { type: 'custom', dateRange: { start: customDateRange.start, end: customDateRange.end } };
  }
  const preset: PeriodPreset = timeFilter as PeriodPreset;
  return { type: 'preset', preset, dateRange: computePresetDateRange(preset) };
}
type ChartSorting = "desc" | "asc";

interface ActorData {
  id: string;
  name: string;
  tier: "top" | "second" | "bottom";
  revenue: number;
  units: number;
  volume: number;
  revenueBPS: number;
  revenuePerLoan: number;
}

interface TopTieringComparisonViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}


export function TopTieringComparisonView({
  selectedTenantId,
  selectedChannel,
}: TopTieringComparisonViewProps) {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const isMobile = useIsMobile();
  const chartHeight = isMobile ? 220 : 240;

  const [selectedActor, setSelectedActor] = useState<TopTieringActor>(() => {
    const saved = localStorage.getItem("toptiering-comparison-actor");
    return (saved as TopTieringActor) || "loan-officer";
  });
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(() => {
    const saved = localStorage.getItem("toptiering-comparison-time");
    return (saved as TimeFilter) || "last-year";
  });
  const [ttcPickerYear, setTtcPickerYear] = useState(new Date().getFullYear());
  const handleTtcPeriodChange = useCallback((selection: PeriodSelection) => {
    const mapped = mapPeriodToTopTiering(selection);
    setTimeFilter(mapped.timeFilter);
    if (mapped.customDateRange) {
      setCustomDateRange(mapped.customDateRange);
    } else {
      setCustomDateRange(undefined);
    }
  }, []);
  // Per-chart sorting states (desc = high to low, asc = low to high)
  const [revenueChartSorting, setRevenueChartSorting] = useState<ChartSorting>(
    () => {
      const saved = localStorage.getItem(
        "toptiering-comparison-revenue-sorting"
      );
      return saved === "asc" ? "asc" : "desc";
    }
  );
  const [unitsChartSorting, setUnitsChartSorting] = useState<ChartSorting>(
    () => {
      const saved = localStorage.getItem("toptiering-comparison-units-sorting");
      return saved === "asc" ? "asc" : "desc";
    }
  );
  const [bpsChartSorting, setBpsChartSorting] = useState<ChartSorting>(() => {
    const saved = localStorage.getItem("toptiering-comparison-bps-sorting");
    return saved === "asc" ? "asc" : "desc";
  });
  const [selectedChartTab, setSelectedChartTab] = useState<
    "units" | "volume" | "detail"
  >("units");
  const [selectedRevenueTab, setSelectedRevenueTab] = useState<
    "revenue-bps" | "revenue-per-loan"
  >("revenue-bps");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Expanded chart states
  const [expandedChart, setExpandedChart] = useState<
    "revenue" | "units" | "bps" | null
  >(null);
  const [isExporting, setIsExporting] = useState(false);

  // Custom date range state (for when timeFilter is 'custom')
  const [customDateRange, setCustomDateRange] = useState<
    CustomDateRange | undefined
  >(undefined);
  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pendingInsightWidgetId, setPendingInsightWidgetId] = useState<string | null>(null);

  // Selection state for Current Selection feature
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const { setSelection } = useTopTieringSelectionStore();

  // Toggle selection of an item
  const toggleSelection = useCallback((item: ActorData) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }, []);

  // Clear all selections
  const clearAllSelections = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  // Fetch real data from API
  const {
    data: apiData,
    loading,
    error,
  } = useTopTieringComparisonData(
    selectedActor as TopTieringActorType,
    timeFilter as TimeFilterType,
    selectedTenantId,
    selectedChannel,
    customDateRange
  );

  const dashboardInsightFilters = useMemo(() => ({}), []);
  const {
    insights: dashboardInsights,
    generatedAt: dashboardInsightsGeneratedAt,
    loading: dashboardInsightsLoading,
    refresh: refreshDashboardInsights,
  } = useDashboardInsights("top-tiering-comparison", dashboardInsightFilters, {
    tenantId: selectedTenantId,
  });

  const handleGenerateInsights = useCallback(async () => {
    setGenerateLoading(true);
    setGenerateError(null);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : "";
      await api.request(`/api/dashboard-insights/generate${tenantParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: "top-tiering-comparison",
          filters: {},
        }),
      });
      await refreshDashboardInsights();
    } catch (err: unknown) {
      setGenerateError(
        err instanceof Error ? err.message : "We couldn't generate insights right now. Please try again later."
      );
    } finally {
      setGenerateLoading(false);
    }
  }, [refreshDashboardInsights, selectedTenantId]);

  const handleShowInsight = useCallback((insight: DashboardInsightItem) => {
    const fc = insight.filter_context ?? {};
    const datePeriod = typeof fc.datePeriod === "string" ? fc.datePeriod.toLowerCase() : "";
    const mappedTimeFilter = INSIGHT_DATE_PERIOD_TO_TIME_FILTER[datePeriod];
    if (mappedTimeFilter) setTimeFilter(mappedTimeFilter);

    const actorType = fc.actorType;
    if (actorType === "branch" || actorType === "loan-officer") {
      setSelectedActor(actorType);
    }

    if (typeof fc.actorName === "string" && fc.actorName.trim()) {
      setSearchQuery(fc.actorName.trim());
      setSelectedChartTab("detail");
    }

    const widgetFromEvidence = insight.evidence_refs?.find((r) => INSIGHT_WIDGET_IDS.has(r.widgetId))?.widgetId;
    if (widgetFromEvidence) setPendingInsightWidgetId(widgetFromEvidence);
  }, []);

  const handleDashboardInsightFeedback = useCallback(
    async (insightId: number, rating: 1 | -1, tags?: string[], comment?: string) => {
      try {
        await api.submitDashboardInsightFeedback(insightId, rating, tags, comment, selectedTenantId);
        return true;
      } catch {
        return false;
      }
    },
    [selectedTenantId]
  );

  const periodSelectionForPicker = useMemo(
    () => toptieringTimeToPeriodSelection(timeFilter, customDateRange),
    [timeFilter, customDateRange]
  );

  // Determine if using real data or mock data
  const isUsingMockData = !apiData || apiData.actors.length === 0;

  useEffect(() => {
    localStorage.setItem("toptiering-comparison-actor", selectedActor);
  }, [selectedActor]);

  useEffect(() => {
    localStorage.setItem("toptiering-comparison-time", timeFilter);
  }, [timeFilter]);

  useEffect(() => {
    if (!pendingInsightWidgetId || loading) return;
    const el = document.getElementById(pendingInsightWidgetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setPendingInsightWidgetId(null);
  }, [pendingInsightWidgetId, loading, selectedChartTab, selectedRevenueTab, selectedActor]);

  useEffect(() => {
    localStorage.setItem(
      "toptiering-comparison-revenue-sorting",
      revenueChartSorting
    );
  }, [revenueChartSorting]);

  useEffect(() => {
    localStorage.setItem(
      "toptiering-comparison-units-sorting",
      unitsChartSorting
    );
  }, [unitsChartSorting]);

  useEffect(() => {
    localStorage.setItem("toptiering-comparison-bps-sorting", bpsChartSorting);
  }, [bpsChartSorting]);

  const formatCurrency = (value: number) => {
    return formatCompactNumber(value);
  };

  const formatNumber = (num: number) => num.toLocaleString("en-US");

  // Get current data based on selected actor - use API data when available, else empty
  const currentData: ActorData[] = useMemo(() => {
    if (apiData && apiData.actors.length > 0) {
      // Transform API data to match local interface
      return apiData.actors.map((actor) => ({
        id: actor.id,
        name: actor.name,
        tier: actor.tier,
        revenue: Number(actor.revenue ?? 0),
        units: Number(actor.units ?? 0),
        volume: Number(actor.volume ?? 0),
        revenueBPS: Number(actor.revenueBPS ?? 0),
        revenuePerLoan: Number(actor.revenuePerLoan ?? 0),
      }));
    }
    // Return empty array when no API data available
    return [];
  }, [apiData]);

  // Sync selections to the global store whenever they change
  // NOTE: This must come AFTER currentData is defined
  useEffect(() => {
    if (selectedIds.size > 0) {
      const selectedItems: TopTieringSelectionItem[] = currentData
        .filter((item) => selectedIds.has(item.id))
        .map((item) => ({
          id: item.id,
          name: item.name,
          tier: item.tier,
          revenue: item.revenue,
          units: item.units,
          volume: item.volume,
          revenueBPS: item.revenueBPS,
          revenuePerLoan: item.revenuePerLoan,
        }));
      setSelection(selectedActor, selectedItems);
    } else {
      setSelection(selectedActor, []);
    }
  }, [selectedIds, currentData, selectedActor, setSelection]);

  // Calculate statistical insights
  const statisticalInsights = useMemo(() => {
    if (currentData.length === 0) {
      const emptyBlock = {
        mean: 0,
        median: 0,
        q1: 0,
        q3: 0,
        stdDev: 0,
        min: 0,
        max: 0,
      };
      return {
        revenue: emptyBlock,
        units: emptyBlock,
        revenueBPS: emptyBlock,
      };
    }

    const revenues = currentData.map((d) => d.revenue).sort((a, b) => a - b);
    const units = currentData.map((d) => d.units).sort((a, b) => a - b);
    const revenueBPS = currentData
      .map((d) => d.revenueBPS)
      .sort((a, b) => a - b);

    const median = (arr: number[]) => {
      const mid = Math.floor(arr.length / 2);
      return arr.length % 2 === 0 ? (arr[mid - 1] + arr[mid]) / 2 : arr[mid];
    };

    const q1 = (arr: number[]) => arr[Math.floor(arr.length * 0.25)];
    const q3 = (arr: number[]) => arr[Math.floor(arr.length * 0.75)];

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = (arr: number[]) => {
      const avg = mean(arr);
      const squareDiffs = arr.map((v) => Math.pow(v - avg, 2));
      return Math.sqrt(mean(squareDiffs));
    };

    return {
      revenue: {
        mean: mean(revenues),
        median: median(revenues),
        q1: q1(revenues),
        q3: q3(revenues),
        stdDev: stdDev(revenues),
        min: revenues[0],
        max: revenues[revenues.length - 1],
      },
      units: {
        mean: mean(units),
        median: median(units),
        q1: q1(units),
        q3: q3(units),
        stdDev: stdDev(units),
        min: units[0],
        max: units[units.length - 1],
      },
      revenueBPS: {
        mean: mean(revenueBPS),
        median: median(revenueBPS),
        q1: q1(revenueBPS),
        q3: q3(revenueBPS),
        stdDev: stdDev(revenueBPS),
        min: revenueBPS[0],
        max: revenueBPS[revenueBPS.length - 1],
      },
    };
  }, [currentData]);

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) return currentData;
    const query = searchQuery.toLowerCase();
    return currentData.filter(
      (item) =>
        item.name.toLowerCase().includes(query) ||
        item.id.toLowerCase().includes(query)
    );
  }, [currentData, searchQuery]);

  // Calculate YoY growth - use API data when available
  const yoyGrowth = useMemo(() => {
    if (apiData && apiData.yoyGrowth !== undefined) {
      return apiData.yoyGrowth;
    }
    // Mock: assume 8% growth
    return 8.2;
  }, [apiData]);

  // Export functionality
  const handleExport = async () => {
    setIsExporting(true);
    try {
      const csvContent = [
        [
          "Name",
          "ID",
          "Tier",
          "Revenue",
          "Units",
          "Volume",
          "Revenue BPS",
          "Revenue per Loan",
        ].join(","),
        ...filteredData.map((item) =>
          [
            item.name,
            item.id,
            item.tier,
            item.revenue,
            item.units,
            item.volume,
            item.revenueBPS,
            item.revenuePerLoan,
          ].join(",")
        ),
      ].join("\n");

      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      const url = URL.createObjectURL(blob);
      link.setAttribute("href", url);
      link.setAttribute(
        "download",
        `toptiering-comparison-${selectedActor}-${
          new Date().toISOString().split("T")[0]
        }.csv`
      );
      link.style.visibility = "hidden";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  const totalRevenue = currentData.reduce((sum, item) => sum + item.revenue, 0);
  const totalUnits = currentData.reduce((sum, item) => sum + item.units, 0);
  const totalVolume = currentData.reduce((sum, item) => sum + item.volume, 0);
  const totalRevenueBPS =
    currentData.length > 0
      ? currentData.reduce((sum, item) => sum + item.revenueBPS, 0) /
        currentData.length
      : 0;

  // Calculate tier summaries dynamically
  const topTierItems = currentData.filter((item) => item.tier === "top");
  const secondTierItems = currentData.filter((item) => item.tier === "second");
  const bottomTierItems = currentData.filter((item) => item.tier === "bottom");

  const topTierRevenue = topTierItems.reduce(
    (sum, item) => sum + item.revenue,
    0
  );
  const secondTierRevenue = secondTierItems.reduce(
    (sum, item) => sum + item.revenue,
    0
  );
  const bottomTierRevenue = bottomTierItems.reduce(
    (sum, item) => sum + item.revenue,
    0
  );

  const topTierPercent =
    totalRevenue > 0 ? (topTierRevenue / totalRevenue) * 100 : 0;
  const secondTierPercent =
    totalRevenue > 0 ? (secondTierRevenue / totalRevenue) * 100 : 0;
  const bottomTierPercent =
    totalRevenue > 0 ? (bottomTierRevenue / totalRevenue) * 100 : 0;

  // Get actor label
  const actorLabel = selectedActor === "branch" ? "Branch" : "Loan Officer";
  const actorLabelPlural =
    selectedActor === "branch" ? "Branches" : "Loan Officers";
  const actorLabelSingular =
    selectedActor === "branch" ? "Branch" : "Loan Officer";

  // Helper function to sort and add cumulative percentages
  const sortAndAddCumulative = (
    data: ActorData[],
    sorting: ChartSorting,
    metric: "revenue" | "units" | "volume" | "revenueBPS" | "revenuePerLoan"
  ) => {
    const sorted = [...data];

    if (metric === "revenue") {
      sorted.sort((a, b) =>
        sorting === "desc" ? b.revenue - a.revenue : a.revenue - b.revenue
      );
    } else if (metric === "units") {
      sorted.sort((a, b) =>
        sorting === "desc" ? b.units - a.units : a.units - b.units
      );
    } else if (metric === "volume") {
      sorted.sort((a, b) =>
        sorting === "desc" ? b.volume - a.volume : a.volume - b.volume
      );
    } else if (metric === "revenueBPS") {
      sorted.sort((a, b) =>
        sorting === "desc"
          ? b.revenueBPS - a.revenueBPS
          : a.revenueBPS - b.revenueBPS
      );
    } else if (metric === "revenuePerLoan") {
      sorted.sort((a, b) =>
        sorting === "desc"
          ? b.revenuePerLoan - a.revenuePerLoan
          : a.revenuePerLoan - b.revenuePerLoan
      );
    }

    let cumulativeRevenue = 0;
    let cumulativeUnits = 0;
    let cumulativeVolume = 0;
    const totalRev = data.reduce((sum, item) => sum + item.revenue, 0);
    const totalUnitsVal = data.reduce((sum, item) => sum + item.units, 0);
    const totalVol = data.reduce((sum, item) => sum + item.volume, 0);

    return sorted.map((item) => {
      cumulativeRevenue += item.revenue;
      cumulativeUnits += item.units;
      cumulativeVolume += item.volume;
      return {
        ...item,
        cumulativeRevenuePercent:
          totalRev > 0 ? (cumulativeRevenue / totalRev) * 100 : 0,
        cumulativeUnitsPercent:
          totalUnitsVal > 0 ? (cumulativeUnits / totalUnitsVal) * 100 : 0,
        cumulativeVolumePercent:
          totalVol > 0 ? (cumulativeVolume / totalVol) * 100 : 0,
      };
    });
  };

  // Prepare chart data with cumulative percentage - separate for each chart
  const revenueChartData = useMemo(() => {
    return sortAndAddCumulative(filteredData, revenueChartSorting, "revenue");
  }, [filteredData, revenueChartSorting]);

  // Units/Volume chart uses the correct metric based on selected tab
  const unitsChartData = useMemo(() => {
    const metric = selectedChartTab === "volume" ? "volume" : "units";
    return sortAndAddCumulative(filteredData, unitsChartSorting, metric);
  }, [filteredData, unitsChartSorting, selectedChartTab]);

  // BPS chart sorts by the currently selected metric (BPS or Revenue per Loan)
  const bpsChartData = useMemo(() => {
    const metric =
      selectedRevenueTab === "revenue-bps" ? "revenueBPS" : "revenuePerLoan";
    return sortAndAddCumulative(filteredData, bpsChartSorting, metric);
  }, [filteredData, bpsChartSorting, selectedRevenueTab]);

  // Calculate minimum chart width based on data count for horizontal scrolling
  const getChartMinWidth = (dataCount: number) => {
    const minWidthPerBar = 70; // pixels per bar for readable labels
    return Math.max(600, dataCount * minWidthPerBar);
  };

  // Get tier color - Updated to match new tier colors
  const getTierColor = (tier: "top" | "second" | "bottom") => {
    switch (tier) {
      case "top":
        return "#00008F"; // Dark blue
      case "second":
        return "#52B852"; // Green
      case "bottom":
        return "#B2DCB2"; // Light green
    }
  };

  const getTierLightColor = (tier: "top" | "second" | "bottom") => {
    switch (tier) {
      case "top":
        return isDarkMode ? "rgba(0, 0, 143, 0.3)" : "rgba(0, 0, 143, 0.2)";
      case "second":
        return isDarkMode ? "rgba(82, 184, 82, 0.3)" : "rgba(82, 184, 82, 0.2)";
      case "bottom":
        return isDarkMode
          ? "rgba(178, 220, 178, 0.3)"
          : "rgba(178, 220, 178, 0.2)";
    }
  };

  // Loading state
  if (loading) {
    return (
      <div
        className={`relative transition-all duration-300 max-w-[1800px] p-3 sm:p-4 md:p-6`}
      >
        <Card
          className={`rounded-xl backdrop-blur-sm ${
            isDarkMode
              ? "border-slate-700/50 bg-slate-800/70"
              : "border-blue-200/40 bg-white"
          }`}
        >
          <CardContent className="pt-12 pb-12 text-center">
            <Loader2
              className={`w-12 h-12 mx-auto mb-4 animate-spin ${
                isDarkMode ? "text-blue-400" : "text-blue-600"
              }`}
            />
            <p
              className={`text-lg font-semibold mb-2 ${
                isDarkMode ? "text-slate-300" : "text-slate-700"
              }`}
            >
              Loading TopTiering Data...
            </p>
            <p
              className={`text-sm ${
                isDarkMode ? "text-slate-500" : "text-slate-600"
              }`}
            >
              Fetching {selectedActor === "branch" ? "branch" : "loan officer"}{" "}
              performance metrics
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div
        className={`relative transition-all duration-300 max-w-[1800px] p-3 sm:p-4 md:p-6`}
      >
        <Card
          className={`rounded-xl backdrop-blur-sm ${
            isDarkMode
              ? "border-red-700/50 bg-slate-800/70"
              : "border-red-200/40 bg-white"
          }`}
        >
          <CardContent className="pt-12 pb-12 text-center">
            <AlertCircle
              className={`w-12 h-12 mx-auto mb-4 ${
                isDarkMode ? "text-red-400" : "text-red-600"
              }`}
            />
            <p
              className={`text-lg font-semibold mb-2 ${
                isDarkMode ? "text-slate-300" : "text-slate-700"
              }`}
            >
              Failed to Load Data
            </p>
            <p
              className={`text-sm mb-4 ${
                isDarkMode ? "text-slate-500" : "text-slate-600"
              }`}
            >
              {error}
            </p>
            <p
              className={`text-xs ${
                isDarkMode ? "text-slate-400" : "text-slate-500"
              }`}
            >
              Showing demo data instead
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div
      className={`relative transition-all duration-300 ${
        isFullscreen ? "max-w-full" : "max-w-[1800px]"
      } p-1 sm:p-2`}
    >
      <DashboardInsightsStrip
        insights={dashboardInsights}
        generatedAt={dashboardInsightsGeneratedAt}
        loading={dashboardInsightsLoading}
        generating={generateLoading}
        generateError={generateError}
        onClearGenerateError={() => setGenerateError(null)}
        onGenerate={handleGenerateInsights}
        showGenerateButton
        onShowInsight={handleShowInsight}
        onRefreshInsights={refreshDashboardInsights}
        showFeedback
        onSubmitFeedback={handleDashboardInsightFeedback}
        dateFilter="ytd"
        selectedTenantId={selectedTenantId ?? undefined}
      />

      {/* Demo data indicator */}
      {isUsingMockData && (
        <div
          className={`mb-4 p-3 rounded-lg flex items-center gap-2 ${
            isDarkMode
              ? "bg-amber-900/20 border border-amber-700/30"
              : "bg-amber-50 border border-amber-200"
          }`}
        >
          <AlertCircle
            className={`w-4 h-4 flex-shrink-0 ${
              isDarkMode ? "text-amber-400" : "text-amber-600"
            }`}
          />
          <span
            className={`text-sm ${
              isDarkMode ? "text-amber-300" : "text-amber-700"
            }`}
          >
            Using demo data. Connect to a tenant database or upload loan data to
            see real metrics.
          </span>
        </div>
      )}

      <div
        className={`grid gap-2 sm:gap-3 transition-all duration-300 ${
          isFullscreen ? "grid-cols-1" : "grid-cols-12"
        }`}
      >
        {/* Left Sidebar - Filters + TopTiering Story */}
        {!isFullscreen && (
          <div className="col-span-12 lg:col-span-3 space-y-2 sm:space-y-3">
            {/* Title and Time Filter */}
            <Card
              id="ttc-story-panel"
              className={`rounded-xl backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                  : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
              }`}
            >
              <CardHeader
                className={`border-b pb-2 sm:pb-3 ${
                  isDarkMode ? "border-slate-700/50" : "border-blue-100/50"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-xs sm:text-sm font-bold leading-tight">
                    TopTiering by {actorLabel} | Production Data{" "}
                    {apiData?.dateRange?.label || "Last Year"}
                  </CardTitle>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 sm:h-6 sm:w-6 p-0 touch-manipulation"
                      onClick={handleExport}
                      disabled={isExporting}
                      aria-label="Export data"
                    >
                      {isExporting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 sm:h-6 sm:w-6 p-0 touch-manipulation"
                      aria-label="Share"
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4 sm:pt-5 space-y-4 sm:space-y-5">
                {/* Selection Summary */}
                {selectedIds.size > 0 && (
                  <div
                    className={`p-3 rounded-lg flex items-center justify-between gap-2 ${
                      isDarkMode
                        ? "bg-violet-900/30 border border-violet-700/50"
                        : "bg-violet-50 border border-violet-200"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <ListChecks
                        className={`w-4 h-4 ${
                          isDarkMode ? "text-violet-400" : "text-violet-600"
                        }`}
                      />
                      <span
                        className={`text-sm font-medium ${
                          isDarkMode ? "text-violet-300" : "text-violet-700"
                        }`}
                      >
                        {selectedIds.size}{" "}
                        {selectedIds.size === 1
                          ? actorLabelSingular.toLowerCase()
                          : actorLabelPlural.toLowerCase()}{" "}
                        selected
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearAllSelections}
                      className={`h-7 px-2 text-xs ${
                        isDarkMode
                          ? "text-violet-400 hover:text-violet-300"
                          : "text-violet-600 hover:text-violet-700"
                      }`}
                    >
                      Clear
                    </Button>
                  </div>
                )}

                {/* Search Filter */}
                <div>
                  <label
                    className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${
                      isDarkMode ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    Search {actorLabelPlural}
                  </label>
                  <div className="relative">
                    <Search
                      className={`absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 ${
                        isDarkMode ? "text-slate-500" : "text-slate-400"
                      }`}
                    />
                    <Input
                      type="text"
                      placeholder={`Search by name or ID...`}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className={`pl-9 h-10 sm:h-9 text-sm ${
                        isDarkMode
                          ? "bg-slate-800/60 border-slate-700"
                          : "bg-white border-slate-300"
                      }`}
                    />
                  </div>
                  {searchQuery && (
                    <p
                      className={`text-xs mt-1 ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      Showing {filteredData.length} of {currentData.length}{" "}
                      {actorLabelPlural.toLowerCase()}
                    </p>
                  )}
                </div>
                {/* Time Filter */}
                <div>
                  <label
                    className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${
                      isDarkMode ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    Time Filter
                  </label>
                  <DatePeriodPicker
                    year={ttcPickerYear}
                    onYearChange={setTtcPickerYear}
                    presets={['mtd', 'qtd', 'ytd', 'last-month', 'last-quarter', 'last-year', 'trailing-12']}
                    showYears={false}
                    onPeriodChange={handleTtcPeriodChange}
                    periodSelectionFromStore={periodSelectionForPicker}
                    defaultPreset="last-year"
                    showLabel={false}
                    size="sm"
                  />
                </div>

                {/* Actor Selection */}
                <div>
                  <label
                    className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${
                      isDarkMode ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    Choose TopTiering Actor
                  </label>
                  <Tabs
                    value={selectedActor}
                    onValueChange={(v) =>
                      setSelectedActor(v as TopTieringActor)
                    }
                  >
                    <TabsList
                      className={`grid w-full grid-cols-2 h-10 sm:h-9 ${
                        isDarkMode
                          ? "bg-slate-900/60 border border-slate-700/50"
                          : "bg-slate-100/80 border border-slate-300/40"
                      }`}
                    >
                      <TabsTrigger
                        value="branch"
                        className="text-xs sm:text-xs touch-manipulation data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Branch
                      </TabsTrigger>
                      <TabsTrigger
                        value="loan-officer"
                        className="text-xs sm:text-xs touch-manipulation data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                      >
                        Loan Officer
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardContent>
            </Card>

            {/* TopTiering Story Card */}
            <Card
              className={`rounded-xl backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                  : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
              }`}
            >
              <CardHeader
                className={`border-b pb-2 sm:pb-3 ${
                  isDarkMode
                    ? "border-slate-700/50 bg-gradient-to-r from-blue-600/10 to-purple-600/10"
                    : "border-blue-100/50 bg-gradient-to-r from-blue-50/80 to-purple-50/60"
                }`}
              >
                <CardTitle className="text-xs sm:text-sm font-bold">
                  TopTiering Story
                </CardTitle>
                <CardDescription className="text-[10px] sm:text-xs">
                  {actorLabel} Revenue Analysis | Production Data{" "}
                  {apiData?.dateRange?.label || "Last Year"}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-4 sm:pt-5 space-y-3 sm:space-y-4">
                {/* Total Summary */}
                <div
                  className={`p-3 sm:p-4 rounded-lg ${
                    isDarkMode ? "bg-slate-700/30" : "bg-slate-50"
                  }`}
                >
                  <p
                    className={`text-xs sm:text-sm font-semibold mb-1 leading-relaxed ${
                      isDarkMode ? "text-white" : "text-slate-900"
                    }`}
                  >
                    Total Revenue contributed by {currentData.length}{" "}
                    {actorLabelPlural}{" "}
                    {apiData?.dateRange?.label || "Last Year"}.{" "}
                    <strong className="font-bold">
                      {formatCurrency(totalRevenue)}
                    </strong>
                  </p>
                </div>

                {/* Tier Summaries - Premium Redesign */}
                {[
                  {
                    tier: "top",
                    items: topTierItems,
                    revenue: topTierRevenue,
                    percent: topTierPercent,
                  },
                  {
                    tier: "second",
                    items: secondTierItems,
                    revenue: secondTierRevenue,
                    percent: secondTierPercent,
                  },
                  {
                    tier: "bottom",
                    items: bottomTierItems,
                    revenue: bottomTierRevenue,
                    percent: bottomTierPercent,
                  },
                ].map((tierData) => {
                  const tierName =
                    tierData.tier.charAt(0).toUpperCase() +
                    tierData.tier.slice(1) +
                    " Tier";

                  // Define tier-specific styles
                  const tierStyles = {
                    top: {
                      bg: isDarkMode ? "bg-tier-top-dark" : "bg-tier-top-light",
                      border: isDarkMode
                        ? "border-tier-top/40"
                        : "border-tier-top/30",
                      dot: "bg-tier-top",
                      text: isDarkMode ? "text-white" : "text-tier-top",
                      iconBg: isDarkMode
                        ? "bg-tier-top/20"
                        : "bg-tier-top-light",
                      badge: "bg-tier-top",
                    },
                    second: {
                      bg: isDarkMode
                        ? "bg-tier-second-dark"
                        : "bg-tier-second-light",
                      border: isDarkMode
                        ? "border-tier-second/40"
                        : "border-tier-second/30",
                      dot: "bg-tier-second",
                      text: isDarkMode ? "text-white" : "text-tier-second",
                      iconBg: isDarkMode
                        ? "bg-tier-second/20"
                        : "bg-tier-second-light",
                      badge: "bg-tier-second",
                    },
                    bottom: {
                      bg: isDarkMode
                        ? "bg-tier-bottom-dark"
                        : "bg-tier-bottom-light",
                      border: isDarkMode
                        ? "border-tier-bottom/60"
                        : "border-tier-bottom",
                      dot: "bg-tier-bottom",
                      text: isDarkMode ? "text-tier-bottom" : "text-slate-600",
                      iconBg: isDarkMode
                        ? "bg-tier-bottom/30"
                        : "bg-tier-bottom-light",
                      badge: "bg-tier-bottom text-slate-800",
                    },
                  }[tierData.tier as "top" | "second" | "bottom"];

                  // Calculate average revenue per actor
                  const avgRevenuePerActor =
                    tierData.items.length > 0
                      ? tierData.revenue / tierData.items.length
                      : 0;
                  const avgUnitsPerActor =
                    tierData.items.length > 0
                      ? tierData.items.reduce(
                          (sum, item) => sum + item.units,
                          0
                        ) / tierData.items.length
                      : 0;

                  return (
                    <div
                      key={tierData.tier}
                      className={`p-3 sm:p-4 md:p-5 rounded-xl border-2 transition-all duration-200 active:scale-[0.98] sm:hover:scale-[1.02] sm:hover:shadow-lg ${tierStyles.bg} ${tierStyles.border}`}
                    >
                      {/* Header with Badge */}
                      <div className="flex items-center justify-between mb-3 sm:mb-4">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-2 h-2 rounded-full ${tierStyles.dot} animate-pulse`}
                          ></div>
                          <h4
                            className={`text-[10px] sm:text-[10px] font-bold uppercase tracking-wider ${tierStyles.text}`}
                          >
                            {tierName}
                          </h4>
                        </div>
                        <div
                          className={`px-2 py-0.5 rounded-full ${tierStyles.badge} text-white text-[10px] font-bold`}
                        >
                          {tierData.percent.toFixed(1)}%
                        </div>
                      </div>

                      {/* Main Content - 3 Elements in Row */}
                      <div className="flex items-center gap-3 mb-4">
                        {/* Main Metric */}
                        <div className="flex-shrink-0">
                          <div className="flex items-baseline gap-2">
                            <span
                              className={`text-3xl font-bold tracking-tight ${
                                isDarkMode ? "text-white" : "text-slate-900"
                              }`}
                            >
                              {formatCurrency(tierData.revenue)}
                            </span>
                          </div>
                          <p
                            className={`text-xs mt-1 ${
                              isDarkMode ? "text-slate-500" : "text-slate-600"
                            }`}
                          >
                            {tierData.items.length} {actorLabelSingular}
                            {tierData.items.length > 1 ? "s" : ""}
                          </p>
                        </div>

                        {/* Metrics - Vertical Layout */}
                        <div className="flex flex-col gap-2 flex-1">
                          {/* Avg Revenue per Actor */}
                          <div
                            className={`flex items-center gap-2 p-2 rounded-lg w-full ${
                              isDarkMode ? "bg-slate-800/40" : "bg-white/60"
                            }`}
                          >
                            <div
                              className={`p-1.5 rounded ${tierStyles.iconBg}`}
                            >
                              <Calendar
                                className={`w-3.5 h-3.5 ${tierStyles.text}`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-[10px] ${
                                  isDarkMode
                                    ? "text-slate-500"
                                    : "text-slate-600"
                                }`}
                              >
                                Avg Revenue
                              </p>
                              <p
                                className={`text-sm font-bold ${
                                  isDarkMode ? "text-white" : "text-slate-900"
                                }`}
                              >
                                {formatCurrency(avgRevenuePerActor)}
                              </p>
                            </div>
                          </div>

                          {/* Avg Units per Actor */}
                          <div
                            className={`flex items-center gap-2 p-2 rounded-lg w-full ${
                              isDarkMode ? "bg-slate-800/40" : "bg-white/60"
                            }`}
                          >
                            <div
                              className={`p-1.5 rounded ${tierStyles.iconBg}`}
                            >
                              <Clock
                                className={`w-3.5 h-3.5 ${tierStyles.text}`}
                              />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className={`text-[10px] ${
                                  isDarkMode
                                    ? "text-slate-500"
                                    : "text-slate-600"
                                }`}
                              >
                                Avg Units
                              </p>
                              <p
                                className={`text-sm font-bold ${
                                  isDarkMode ? "text-white" : "text-slate-900"
                                }`}
                              >
                                {Math.round(avgUnitsPerActor)}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="mt-3">
                        <div
                          className={`h-1.5 rounded-full overflow-hidden backdrop-blur-sm ${
                            isDarkMode
                              ? "bg-slate-800/60 border border-slate-700/50"
                              : "bg-slate-200/80 border border-slate-300/40"
                          }`}
                        >
                          <div
                            className={`h-full rounded-full shadow-lg transition-all duration-1000 ease-out ${
                              tierData.tier === "top"
                                ? "bg-tier-top shadow-tier-top/30"
                                : tierData.tier === "second"
                                ? "bg-tier-second shadow-tier-second/30"
                                : "bg-tier-bottom shadow-tier-bottom/30"
                            }`}
                            style={{ width: `${tierData.percent}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Tier Definition */}
                <div
                  className={`p-3 sm:p-4 rounded-lg ${
                    isDarkMode
                      ? "bg-slate-700/30 border border-slate-600/50"
                      : "bg-slate-100 border border-slate-300"
                  }`}
                >
                  <p
                    className={`text-[10px] sm:text-xs leading-relaxed ${
                      isDarkMode ? "text-slate-400" : "text-slate-600"
                    }`}
                  >
                    "Teraverde Intelligence suggests the Top Tier is the top 50%
                    of producers, the Second Tier is the next 30%, and the
                    Bottom Tier is the remaining 20%."
                  </p>
                </div>

                {/* Statistical Insights */}
                <div
                  className={`p-3 sm:p-4 rounded-lg ${
                    isDarkMode
                      ? "bg-slate-700/30 border border-slate-600/50"
                      : "bg-slate-100 border border-slate-300"
                  }`}
                >
                  <p
                    className={`text-xs font-semibold mb-2 ${
                      isDarkMode ? "text-slate-300" : "text-slate-700"
                    }`}
                  >
                    Statistical Insights
                  </p>
                  <div className="space-y-1.5 text-[10px] sm:text-xs">
                    <div
                      className={`flex justify-between gap-2 ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      <span className="truncate">Revenue Median:</span>
                      <span className="font-semibold flex-shrink-0">
                        {formatCurrency(statisticalInsights.revenue.median)}
                      </span>
                    </div>
                    <div
                      className={`flex justify-between gap-2 ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      <span className="truncate">Revenue Q1-Q3:</span>
                      <span className="font-semibold flex-shrink-0 text-right">
                        {formatCurrency(statisticalInsights.revenue.q1)} -{" "}
                        {formatCurrency(statisticalInsights.revenue.q3)}
                      </span>
                    </div>
                    <div
                      className={`flex justify-between gap-2 ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      <span className="truncate">Units Median:</span>
                      <span className="font-semibold flex-shrink-0">
                        {formatNumber(
                          Math.round(statisticalInsights.units.median)
                        )}
                      </span>
                    </div>
                    <div
                      className={`flex justify-between gap-2 ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      <span className="truncate">BPS Median:</span>
                      <span className="font-semibold flex-shrink-0">
                        {statisticalInsights.revenueBPS.median.toFixed(0)}
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Right Panel - Charts */}
        <div
          className={`space-y-2 transition-all duration-300 ${
            isFullscreen ? "col-span-1" : "col-span-12 lg:col-span-9"
          }`}
        >
          {/* KPI Summary Dashboard */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <Card
              id="ttc-kpi-total-revenue"
              className={`rounded-lg backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70"
                  : "border-blue-200/40 bg-white shadow-sm"
              }`}
            >
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[10px] font-medium ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      Total Revenue
                    </p>
                    <p
                      className={`text-lg font-bold truncate ${
                        isDarkMode ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {formatCurrency(totalRevenue)}
                    </p>
                    <div className="flex items-center gap-1">
                      <TrendingUp
                        className={`w-3 h-3 flex-shrink-0 ${
                          isDarkMode ? "text-emerald-400" : "text-emerald-600"
                        }`}
                      />
                      <span
                        className={`text-[10px] font-medium ${
                          isDarkMode ? "text-emerald-400" : "text-emerald-600"
                        }`}
                      >
                        {Number(yoyGrowth) > 0 ? "+" : ""}
                        {Number(yoyGrowth ?? 0).toFixed(1)}% YoY
                      </span>
                    </div>
                  </div>
                  <div
                    className={`p-1.5 rounded-lg flex-shrink-0 ${
                      isDarkMode ? "bg-blue-500/20" : "bg-blue-100"
                    }`}
                  >
                    <DollarSign
                      className={`w-4 h-4 ${
                        isDarkMode ? "text-blue-400" : "text-blue-600"
                      }`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              id="ttc-kpi-total-units"
              className={`rounded-lg backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70"
                  : "border-blue-200/40 bg-white shadow-sm"
              }`}
            >
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[10px] font-medium ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      Total Units
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        isDarkMode ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {formatNumber(totalUnits)}
                    </p>
                    <p
                      className={`text-[10px] ${
                        isDarkMode ? "text-slate-500" : "text-slate-600"
                      }`}
                    >
                      Avg:{" "}
                      {formatNumber(
                        Math.round(
                          currentData.length > 0
                            ? totalUnits / currentData.length
                            : 0
                        )
                      )}{" "}
                      per {actorLabelSingular.toLowerCase()}
                    </p>
                  </div>
                  <div
                    className={`p-1.5 rounded-lg flex-shrink-0 ${
                      isDarkMode ? "bg-teal-500/20" : "bg-teal-100"
                    }`}
                  >
                    <BarChart3
                      className={`w-4 h-4 ${
                        isDarkMode ? "text-teal-400" : "text-teal-600"
                      }`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              id="ttc-kpi-avg-revenue-bps"
              className={`rounded-lg backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70"
                  : "border-blue-200/40 bg-white shadow-sm"
              }`}
            >
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[10px] font-medium ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      Avg Revenue BPS
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        isDarkMode ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {totalRevenueBPS.toFixed(0)}
                    </p>
                    <p
                      className={`text-[10px] ${
                        isDarkMode ? "text-slate-500" : "text-slate-600"
                      }`}
                    >
                      Range: {Math.round(statisticalInsights.revenueBPS.min)}-
                      {Math.round(statisticalInsights.revenueBPS.max)}
                    </p>
                  </div>
                  <div
                    className={`p-1.5 rounded-lg flex-shrink-0 ${
                      isDarkMode ? "bg-purple-500/20" : "bg-purple-100"
                    }`}
                  >
                    <TrendingUp
                      className={`w-4 h-4 ${
                        isDarkMode ? "text-purple-400" : "text-purple-600"
                      }`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card
              id="ttc-kpi-actor-count"
              className={`rounded-lg backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70"
                  : "border-blue-200/40 bg-white shadow-sm"
              }`}
            >
              <CardContent className="pt-2 pb-2 px-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-[10px] font-medium ${
                        isDarkMode ? "text-slate-400" : "text-slate-600"
                      }`}
                    >
                      Total {actorLabelPlural}
                    </p>
                    <p
                      className={`text-lg font-bold ${
                        isDarkMode ? "text-white" : "text-slate-900"
                      }`}
                    >
                      {currentData.length}
                    </p>
                    <p
                      className={`text-[10px] ${
                        isDarkMode ? "text-slate-500" : "text-slate-600"
                      }`}
                    >
                      {topTierItems.length} Top | {secondTierItems.length}{" "}
                      Second | {bottomTierItems.length} Bottom
                    </p>
                  </div>
                  <div
                    className={`p-1.5 rounded-lg flex-shrink-0 ${
                      isDarkMode ? "bg-amber-500/20" : "bg-amber-100"
                    }`}
                  >
                    <Users
                      className={`w-4 h-4 ${
                        isDarkMode ? "text-amber-400" : "text-amber-600"
                      }`}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {filteredData.length === 0 ? (
            <Card
              className={`rounded-xl backdrop-blur-sm ${
                isDarkMode
                  ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                  : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
              }`}
            >
              <CardContent className="pt-12 pb-12 text-center">
                <Search
                  className={`w-12 h-12 mx-auto mb-4 ${
                    isDarkMode ? "text-slate-500" : "text-slate-400"
                  }`}
                />
                <p
                  className={`text-lg font-semibold mb-2 ${
                    isDarkMode ? "text-slate-300" : "text-slate-700"
                  }`}
                >
                  No {actorLabelPlural.toLowerCase()} found
                </p>
                <p
                  className={`text-sm ${
                    isDarkMode ? "text-slate-500" : "text-slate-600"
                  }`}
                >
                  Try adjusting your search query or filters
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => setSearchQuery("")}
                >
                  Clear Search
                </Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Chart 1: Revenue by Branch (Pareto Chart) */}
              <Card
                id="ttc-revenue-chart"
                className={`rounded-lg backdrop-blur-sm ${
                  isDarkMode
                    ? "border-slate-700/50 bg-slate-800/70"
                    : "border-blue-200/40 bg-white shadow-sm"
                }`}
              >
                <CardHeader
                  className={`border-b py-1.5 px-3 ${
                    isDarkMode ? "border-slate-700/50" : "border-blue-100/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-semibold">
                        Revenue by {actorLabel}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      <Select
                        value={revenueChartSorting}
                        onValueChange={(v) =>
                          setRevenueChartSorting(v as ChartSorting)
                        }
                      >
                        <SelectTrigger
                          className={`w-[100px] h-6 text-[10px] ${
                            isDarkMode
                              ? "bg-slate-800/60 border-slate-700"
                              : "bg-white border-slate-300"
                          }`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="desc">High to Low</SelectItem>
                          <SelectItem value="asc">Low to High</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedChart("revenue")}
                        className={`h-6 w-6 p-0 ${
                          isDarkMode
                            ? "hover:bg-slate-700"
                            : "hover:bg-slate-100"
                        }`}
                        title="Expand chart"
                      >
                        <Maximize2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-1 pb-1 px-2">
                  <div className="w-full overflow-x-auto -webkit-overflow-scrolling-touch">
                    <div
                      style={{
                        minWidth: getChartMinWidth(revenueChartData.length),
                      }}
                    >
                      <ResponsiveContainer width="100%" height={chartHeight}>
                        <ComposedChart
                          data={revenueChartData}
                          margin={{ top: 5, right: 20, left: 10, bottom: 60 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                          />
                          <XAxis
                            dataKey={selectedActor === "branch" ? "id" : "name"}
                            stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                            tick={{ fontSize: 9 }}
                            angle={-45}
                            textAnchor="end"
                            height={60}
                            interval={0}
                          />
                          <YAxis
                            yAxisId="left"
                            label={{
                              value: "Revenue",
                              angle: -90,
                              position: "insideLeft",
                              style: {
                                textAnchor: "middle",
                                fill: isDarkMode ? "#94a3b8" : "#64748b",
                                fontSize: "10px",
                              },
                            }}
                            stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                            tick={{ fontSize: 10 }}
                            tickFormatter={(value) => formatCurrency(value)}
                            width={50}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            label={{
                              value: "Accumulated %",
                              angle: 90,
                              position: "insideRight",
                              style: {
                                textAnchor: "middle",
                                fill: isDarkMode ? "#94a3b8" : "#64748b",
                                fontSize: "10px",
                              },
                            }}
                            stroke={isDarkMode ? "#3b82f6" : "#3b82f6"}
                            tick={{ fontSize: 10 }}
                            domain={[0, 100]}
                            tickFormatter={(value) =>
                              `${Number(value ?? 0).toFixed(1)}%`
                            }
                            width={50}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: isDarkMode
                                ? "#1e293b"
                                : "#ffffff",
                              border: isDarkMode
                                ? "1px solid #475569"
                                : "1px solid #e2e8f0",
                              borderRadius: "8px",
                              boxShadow: isDarkMode
                                ? "0 4px 12px rgba(0, 0, 0, 0.4)"
                                : "0 4px 12px rgba(0, 0, 0, 0.15)",
                            }}
                            formatter={(
                              value: any,
                              name: string,
                              props: any
                            ) => {
                              if (name === "Revenue") {
                                const entry = props.payload;
                                return [
                                  `${formatCurrency(value)} revenue · ${formatNumber(
                                    entry.units
                                  )} units · ${formatCurrency(
                                    Math.round(entry.revenuePerLoan)
                                  )}/loan · ${Math.round(
                                    entry.revenueBPS
                                  )} BPS · ${entry.tier} tier`,
                                  "Revenue",
                                ];
                              }
                              if (name === "Accumulated %")
                                return [
                                  `${Number(value ?? 0).toFixed(1)}%`,
                                  "Cumulative %",
                                ];
                              return [value, name];
                            }}
                            labelFormatter={(label) => {
                              const entry = revenueChartData.find(
                                (d) =>
                                  (selectedActor === "branch"
                                    ? d.id
                                    : d.name) === label
                              );
                              return entry
                                ? `${entry.name} (${entry.id})`
                                : label;
                            }}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="revenue"
                            name="Revenue"
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(data: any) =>
                              data && toggleSelection(data)
                            }
                          >
                            {revenueChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={
                                  selectedIds.has(entry.id)
                                    ? isDarkMode
                                      ? "#8b5cf6"
                                      : "#7c3aed"
                                    : getTierColor(entry.tier)
                                }
                                stroke={
                                  selectedIds.has(entry.id)
                                    ? isDarkMode
                                      ? "#a78bfa"
                                      : "#8b5cf6"
                                    : "none"
                                }
                                strokeWidth={selectedIds.has(entry.id) ? 2 : 0}
                              />
                            ))}
                          </Bar>
                          <Line
                            yAxisId="right"
                            type="monotone"
                            dataKey="cumulativeRevenuePercent"
                            name="Accumulated %"
                            stroke="#3b82f6"
                            strokeWidth={2}
                            dot={{ fill: "#3b82f6", r: 4 }}
                            strokeDasharray="0"
                          />
                          <ReferenceLine
                            yAxisId="right"
                            y={50}
                            stroke={isDarkMode ? "#64748b" : "#94a3b8"}
                            strokeDasharray="5 5"
                            strokeWidth={1}
                          />
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                          />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Chart 2: Units/Volume/Detail by Actor */}
              <Card
                id={selectedChartTab === "detail" ? "ttc-detail-table" : "ttc-units-volume-chart"}
                className={`rounded-lg backdrop-blur-sm ${
                  isDarkMode
                    ? "border-slate-700/50 bg-slate-800/70"
                    : "border-blue-200/40 bg-white shadow-sm"
                }`}
              >
                <CardHeader
                  className={`border-b py-1.5 px-3 ${
                    isDarkMode ? "border-slate-700/50" : "border-blue-100/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-semibold">
                        {selectedChartTab === "units" &&
                          `Units by ${actorLabel}`}
                        {selectedChartTab === "volume" &&
                          `Volume by ${actorLabel}`}
                        {selectedChartTab === "detail" &&
                          `Detail by ${actorLabel}`}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      {selectedChartTab !== "detail" && (
                        <Select
                          value={unitsChartSorting}
                          onValueChange={(v) =>
                            setUnitsChartSorting(v as ChartSorting)
                          }
                        >
                          <SelectTrigger
                            className={`w-[100px] h-6 text-[10px] ${
                              isDarkMode
                                ? "bg-slate-800/60 border-slate-700"
                                : "bg-white border-slate-300"
                            }`}
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="desc">High to Low</SelectItem>
                            <SelectItem value="asc">Low to High</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                      <Tabs
                        value={selectedChartTab}
                        onValueChange={(v) =>
                          setSelectedChartTab(
                            v as "units" | "volume" | "detail"
                          )
                        }
                      >
                        <TabsList
                          className={`h-6 ${
                            isDarkMode
                              ? "bg-slate-800/60 border border-slate-700/50"
                              : "bg-slate-100/80 border border-slate-300/40"
                          }`}
                        >
                          <TabsTrigger
                            value="units"
                            className="text-[10px] px-2 h-5"
                          >
                            Units
                          </TabsTrigger>
                          <TabsTrigger
                            value="volume"
                            className="text-[10px] px-2 h-5"
                          >
                            Volume
                          </TabsTrigger>
                          <TabsTrigger
                            value="detail"
                            className="text-[10px] px-2 h-5"
                          >
                            Detail
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                      {selectedChartTab !== "detail" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExpandedChart("units")}
                          className={`h-6 w-6 p-0 ${
                            isDarkMode
                              ? "hover:bg-slate-700"
                              : "hover:bg-slate-100"
                          }`}
                          title="Expand chart"
                        >
                          <Maximize2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-1 pb-1 px-2">
                  {selectedChartTab === "detail" ? (
                    /* Detail Table View */
                    <div className="w-full overflow-x-auto -webkit-overflow-scrolling-touch">
                      <table
                        className={`w-full text-[10px] ${
                          isDarkMode ? "text-slate-300" : "text-slate-700"
                        }`}
                      >
                        <thead>
                          <tr
                            className={`border-b ${
                              isDarkMode
                                ? "border-slate-700"
                                : "border-slate-200"
                            }`}
                          >
                            <th
                              className={`text-center py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                              style={{ width: "40px" }}
                            >
                              <span className="sr-only">Select</span>
                            </th>
                            <th
                              className={`text-left py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              {actorLabelSingular}
                            </th>
                            <th
                              className={`text-right py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Units
                            </th>
                            <th
                              className={`text-right py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Volume
                            </th>
                            <th
                              className={`text-right py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Revenue
                            </th>
                            <th
                              className={`text-right py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Rev BPS
                            </th>
                            <th
                              className={`text-right py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Rev/Loan
                            </th>
                            <th
                              className={`text-center py-1 px-2 font-semibold ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Tier
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {unitsChartData.map((actor, index) => {
                            const isSelected = selectedIds.has(actor.id);
                            return (
                              <tr
                                key={actor.id}
                                onClick={() => toggleSelection(actor)}
                                className={`border-b cursor-pointer transition-colors ${
                                  isSelected
                                    ? isDarkMode
                                      ? "bg-violet-900/30 border-violet-700/50 hover:bg-violet-900/40"
                                      : "bg-violet-50 border-violet-200 hover:bg-violet-100"
                                    : isDarkMode
                                    ? "border-slate-700/50 hover:bg-slate-700/30"
                                    : "border-slate-100 hover:bg-slate-50"
                                }`}
                              >
                                <td className="text-center py-2 px-2">
                                  {isSelected ? (
                                    <CheckSquare
                                      className={`w-4 h-4 mx-auto ${
                                        isDarkMode
                                          ? "text-violet-400"
                                          : "text-violet-600"
                                      }`}
                                    />
                                  ) : (
                                    <Square
                                      className={`w-4 h-4 mx-auto ${
                                        isDarkMode
                                          ? "text-slate-500"
                                          : "text-slate-400"
                                      }`}
                                    />
                                  )}
                                </td>
                                <td className="py-2 px-3">
                                  <div className="font-medium">
                                    {actor.name}
                                  </div>
                                  <div
                                    className={`text-[10px] ${
                                      isDarkMode
                                        ? "text-slate-500"
                                        : "text-slate-400"
                                    }`}
                                  >
                                    {actor.id}
                                  </div>
                                </td>
                                <td className="text-right py-2 px-3 tabular-nums">
                                  {formatNumber(actor.units)}
                                </td>
                                <td className="text-right py-2 px-3 tabular-nums">
                                  {formatCurrency(actor.volume)}
                                </td>
                                <td className="text-right py-2 px-3 tabular-nums">
                                  {formatCurrency(actor.revenue)}
                                </td>
                                <td className="text-right py-2 px-3 tabular-nums">
                                  {(actor.revenueBPS ?? 0).toFixed(0)}
                                </td>
                                <td className="text-right py-2 px-3 tabular-nums">
                                  {formatCurrency(
                                    Math.round(actor.revenuePerLoan)
                                  )}
                                </td>
                                <td className="text-center py-2 px-3">
                                  <span
                                    className="inline-block px-2 py-0.5 rounded text-[10px] font-medium"
                                    style={{
                                      backgroundColor:
                                        getTierColor(actor.tier) + "20",
                                      color: getTierColor(actor.tier),
                                    }}
                                  >
                                    {actor.tier === "top"
                                      ? "Top 50%"
                                      : actor.tier === "second"
                                      ? "Second 30%"
                                      : "Bottom 20%"}
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    /* Units or Volume Chart View */
                    <div className="w-full overflow-x-auto -webkit-overflow-scrolling-touch">
                      <div
                        style={{
                          minWidth: getChartMinWidth(unitsChartData.length),
                        }}
                      >
                        <ResponsiveContainer width="100%" height={chartHeight}>
                          <ComposedChart
                            data={unitsChartData}
                            margin={{ top: 5, right: 20, left: 10, bottom: 60 }}
                          >
                            <CartesianGrid
                              strokeDasharray="3 3"
                              stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                            />
                            <XAxis
                              dataKey={
                                selectedActor === "branch" ? "id" : "name"
                              }
                              stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                              tick={{ fontSize: 11 }}
                              angle={-45}
                              textAnchor="end"
                              height={80}
                              interval={0}
                            />
                            <YAxis
                              yAxisId="left"
                              label={{
                                value:
                                  selectedChartTab === "units"
                                    ? "Units"
                                    : "Volume ($)",
                                angle: -90,
                                position: "insideLeft",
                                style: {
                                  textAnchor: "middle",
                                  fill: isDarkMode ? "#94a3b8" : "#64748b",
                                  fontSize: "11px",
                                },
                              }}
                              stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                              tick={{ fontSize: 11 }}
                              tickFormatter={
                                selectedChartTab === "volume"
                                  ? (value) => formatCurrency(value)
                                  : undefined
                              }
                              width={selectedChartTab === "volume" ? 70 : 60}
                            />
                            <YAxis
                              yAxisId="right"
                              orientation="right"
                              label={{
                                value: "Accumulated %",
                                angle: 90,
                                position: "insideRight",
                                style: {
                                  textAnchor: "middle",
                                  fill: isDarkMode ? "#94a3b8" : "#64748b",
                                  fontSize: "11px",
                                },
                              }}
                              stroke={isDarkMode ? "#3b82f6" : "#3b82f6"}
                              tick={{ fontSize: 11 }}
                              domain={[0, 100]}
                              tickFormatter={(value) =>
                                `${Number(value ?? 0).toFixed(1)}%`
                              }
                              width={60}
                            />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: isDarkMode
                                  ? "#1e293b"
                                  : "#ffffff",
                                border: isDarkMode
                                  ? "1px solid #475569"
                                  : "1px solid #e2e8f0",
                                borderRadius: "8px",
                                boxShadow: isDarkMode
                                  ? "0 4px 12px rgba(0, 0, 0, 0.4)"
                                  : "0 4px 12px rgba(0, 0, 0, 0.15)",
                              }}
                              formatter={(
                                value: any,
                                name: string,
                                props: any
                              ) => {
                                const entry = props.payload;
                                if (name === "Units") {
                                  return [
                                    `${formatNumber(
                                      value
                                    )} units\n${formatCurrency(
                                      entry.revenue
                                    )} revenue · ${formatCurrency(
                                      Math.round(entry.revenuePerLoan)
                                    )}/unit\n${Math.round(
                                      entry.revenueBPS
                                    )} BPS · ${entry.tier} tier`,
                                    "Units",
                                  ];
                                }
                                if (name === "Volume") {
                                  return [
                                    `${formatCurrency(value)}\n${formatNumber(
                                      entry.units
                                    )} units · ${formatCurrency(
                                      entry.revenue
                                    )} revenue\n${Math.round(
                                      entry.revenueBPS
                                    )} BPS · ${entry.tier} tier`,
                                    "Volume",
                                  ];
                                }
                                if (name === "Accumulated %")
                                  return [
                                    `${Number(value ?? 0).toFixed(1)}%`,
                                    "Cumulative %",
                                  ];
                                return [value, name];
                              }}
                              labelFormatter={(label) => {
                                const entry = unitsChartData.find(
                                  (d) =>
                                    (selectedActor === "branch"
                                      ? d.id
                                      : d.name) === label
                                );
                                return entry
                                  ? `${entry.name} (${entry.id})`
                                  : label;
                              }}
                            />
                            <Bar
                              yAxisId="left"
                              dataKey={
                                selectedChartTab === "units"
                                  ? "units"
                                  : "volume"
                              }
                              name={
                                selectedChartTab === "units"
                                  ? "Units"
                                  : "Volume"
                              }
                              radius={[4, 4, 0, 0]}
                              cursor="pointer"
                              onClick={(data: any) =>
                                data && toggleSelection(data)
                              }
                            >
                              {unitsChartData.map((entry, index) => (
                                <Cell
                                  key={`cell-${index}`}
                                  fill={
                                    selectedIds.has(entry.id)
                                      ? isDarkMode
                                        ? "#8b5cf6"
                                        : "#7c3aed"
                                      : getTierColor(entry.tier)
                                  }
                                  stroke={
                                    selectedIds.has(entry.id)
                                      ? isDarkMode
                                        ? "#a78bfa"
                                        : "#8b5cf6"
                                      : "none"
                                  }
                                  strokeWidth={
                                    selectedIds.has(entry.id) ? 2 : 0
                                  }
                                />
                              ))}
                            </Bar>
                            <Line
                              yAxisId="right"
                              type="monotone"
                              dataKey={
                                selectedChartTab === "units"
                                  ? "cumulativeUnitsPercent"
                                  : "cumulativeVolumePercent"
                              }
                              name="Accumulated %"
                              stroke="#3b82f6"
                              strokeWidth={2}
                              dot={{ fill: "#3b82f6", r: 4 }}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Chart 3: Revenue BPS / Revenue per Loan */}
              <Card
                id="ttc-revenue-quality-chart"
                className={`rounded-lg backdrop-blur-sm ${
                  isDarkMode
                    ? "border-slate-700/50 bg-slate-800/70"
                    : "border-blue-200/40 bg-white shadow-sm"
                }`}
              >
                <CardHeader
                  className={`border-b py-1.5 px-3 ${
                    isDarkMode ? "border-slate-700/50" : "border-blue-100/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xs font-semibold">
                        {selectedRevenueTab === "revenue-bps"
                          ? "Revenue BPS"
                          : "Revenue per Loan"}{" "}
                        by {actorLabel}
                      </CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      <Select
                        value={bpsChartSorting}
                        onValueChange={(v) =>
                          setBpsChartSorting(v as ChartSorting)
                        }
                      >
                        <SelectTrigger
                          className={`w-[100px] h-6 text-[10px] ${
                            isDarkMode
                              ? "bg-slate-800/60 border-slate-700"
                              : "bg-white border-slate-300"
                          }`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="desc">High to Low</SelectItem>
                          <SelectItem value="asc">Low to High</SelectItem>
                        </SelectContent>
                      </Select>
                      <Tabs
                        value={selectedRevenueTab}
                        onValueChange={(v) =>
                          setSelectedRevenueTab(
                            v as "revenue-bps" | "revenue-per-loan"
                          )
                        }
                      >
                        <TabsList
                          className={`h-6 ${
                            isDarkMode
                              ? "bg-slate-800/60 border border-slate-700/50"
                              : "bg-slate-100/80 border border-slate-300/40"
                          }`}
                        >
                          <TabsTrigger
                            value="revenue-bps"
                            className="text-[10px] px-2 h-5"
                          >
                            BPS
                          </TabsTrigger>
                          <TabsTrigger
                            value="revenue-per-loan"
                            className="text-[10px] px-2 h-5"
                          >
                            $/Loan
                          </TabsTrigger>
                        </TabsList>
                      </Tabs>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedChart("bps")}
                        className={`h-6 w-6 p-0 ${
                          isDarkMode
                            ? "hover:bg-slate-700"
                            : "hover:bg-slate-100"
                        }`}
                        title="Expand chart"
                      >
                        <Maximize2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-1 pb-1 px-2">
                  <div className="w-full overflow-x-auto -webkit-overflow-scrolling-touch">
                    <div
                      style={{
                        minWidth: getChartMinWidth(bpsChartData.length),
                      }}
                    >
                      <ResponsiveContainer width="100%" height={chartHeight}>
                        <BarChart
                          data={bpsChartData}
                          margin={{ top: 5, right: 20, left: 10, bottom: 60 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                          />
                          <XAxis
                            dataKey={selectedActor === "branch" ? "id" : "name"}
                            stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                            tick={{ fontSize: 9 }}
                            angle={-45}
                            textAnchor="end"
                            height={60}
                            interval={0}
                          />
                          <YAxis
                            label={{
                              value:
                                selectedRevenueTab === "revenue-bps"
                                  ? "Revenue BPS"
                                  : "Revenue per Loan ($)",
                              angle: -90,
                              position: "insideLeft",
                              style: {
                                textAnchor: "middle",
                                fill: isDarkMode ? "#94a3b8" : "#64748b",
                                fontSize: "11px",
                              },
                            }}
                            stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                            tick={{ fontSize: 11 }}
                            width={60}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: isDarkMode
                                ? "#1e293b"
                                : "#ffffff",
                              border: isDarkMode
                                ? "1px solid #475569"
                                : "1px solid #e2e8f0",
                              borderRadius: "8px",
                              boxShadow: isDarkMode
                                ? "0 4px 12px rgba(0, 0, 0, 0.4)"
                                : "0 4px 12px rgba(0, 0, 0, 0.15)",
                            }}
                            formatter={(
                              value: any,
                              name: string,
                              props: any
                            ) => {
                              const entry = props.payload;
                              if (selectedRevenueTab === "revenue-bps") {
                                return [
                                  `${Math.round(value)} BPS\n${formatCurrency(
                                    entry.revenue
                                  )} revenue · ${formatNumber(
                                    entry.units
                                  )} units\n${formatCurrency(
                                    Math.round(entry.revenuePerLoan)
                                  )}/loan · ${entry.tier} tier`,
                                  "Revenue BPS",
                                ];
                              }
                              return [
                                `${formatCurrency(
                                  Math.round(value)
                                )}\n${formatCurrency(
                                  entry.revenue
                                )} total · ${formatNumber(
                                  entry.units
                                )} units\n${Math.round(
                                  entry.revenueBPS
                                )} BPS · ${entry.tier} tier`,
                                "Revenue per Loan",
                              ];
                            }}
                            labelFormatter={(label) => {
                              const entry = bpsChartData.find(
                                (d) =>
                                  (selectedActor === "branch"
                                    ? d.id
                                    : d.name) === label
                              );
                              return entry
                                ? `${entry.name} (${entry.id})`
                                : label;
                            }}
                          />
                          <Bar
                            dataKey={
                              selectedRevenueTab === "revenue-bps"
                                ? "revenueBPS"
                                : "revenuePerLoan"
                            }
                            radius={[4, 4, 0, 0]}
                            cursor="pointer"
                            onClick={(data: any) =>
                              data && toggleSelection(data)
                            }
                          >
                            {bpsChartData.map((entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={
                                  selectedIds.has(entry.id)
                                    ? isDarkMode
                                      ? "#8b5cf6"
                                      : "#7c3aed"
                                    : getTierColor(entry.tier)
                                }
                                stroke={
                                  selectedIds.has(entry.id)
                                    ? isDarkMode
                                      ? "#a78bfa"
                                      : "#8b5cf6"
                                    : "none"
                                }
                                strokeWidth={selectedIds.has(entry.id) ? 2 : 0}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Expanded Chart Modal - Using Dialog for proper portal and accessibility */}
      <Dialog
        open={!!expandedChart}
        onOpenChange={(open) => !open && setExpandedChart(null)}
      >
        <DialogContent className="max-w-7xl w-full p-0 gap-0 max-h-[90vh] overflow-hidden">
          {/* Modal Header */}
          <DialogHeader
            className={`flex flex-row items-center justify-between px-6 py-4 border-b ${
              isDarkMode
                ? "border-slate-700 bg-slate-800/50"
                : "border-slate-200 bg-slate-50"
            }`}
          >
            <div className="flex-1">
              <DialogTitle
                className={`text-lg font-semibold ${
                  isDarkMode ? "text-white" : "text-slate-900"
                }`}
              >
                {expandedChart === "revenue" && `Revenue by ${actorLabel}`}
                {expandedChart === "units" &&
                  (selectedChartTab === "units"
                    ? `Units by ${actorLabel}`
                    : `Volume by ${actorLabel}`)}
                {expandedChart === "bps" &&
                  `${
                    selectedRevenueTab === "revenue-bps"
                      ? "Revenue BPS"
                      : "Revenue per Loan"
                  } by ${actorLabel}`}
              </DialogTitle>
              <DialogDescription
                className={`text-sm ${
                  isDarkMode ? "text-slate-400" : "text-slate-600"
                }`}
              >
                {expandedChart === "revenue" &&
                  "Pareto chart showing revenue and accumulated percentage"}
                {expandedChart === "units" &&
                  (selectedChartTab === "units"
                    ? `Total Units: ${formatNumber(totalUnits)}`
                    : `Total Volume: ${formatCurrency(totalVolume)}`)}
                {expandedChart === "bps" &&
                  `Total Revenue: ${totalRevenueBPS.toFixed(0)} BPS`}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-3 mr-8">
              {/* Sorting dropdown in modal */}
              <Select
                value={
                  expandedChart === "revenue"
                    ? revenueChartSorting
                    : expandedChart === "units"
                    ? unitsChartSorting
                    : bpsChartSorting
                }
                onValueChange={(v) => {
                  if (expandedChart === "revenue")
                    setRevenueChartSorting(v as ChartSorting);
                  else if (expandedChart === "units")
                    setUnitsChartSorting(v as ChartSorting);
                  else setBpsChartSorting(v as ChartSorting);
                }}
              >
                <SelectTrigger
                  className={`w-[130px] h-9 ${
                    isDarkMode
                      ? "bg-slate-800 border-slate-600"
                      : "bg-white border-slate-300"
                  }`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">High to Low</SelectItem>
                  <SelectItem value="asc">Low to High</SelectItem>
                </SelectContent>
              </Select>
              {/* Units/Volume chart tab selector */}
              {expandedChart === "units" && (
                <Tabs
                  value={selectedChartTab}
                  onValueChange={(v) =>
                    setSelectedChartTab(v as "units" | "volume" | "detail")
                  }
                >
                  <TabsList
                    className={`h-9 ${
                      isDarkMode
                        ? "bg-slate-800 border border-slate-600"
                        : "bg-slate-100 border border-slate-300"
                    }`}
                  >
                    <TabsTrigger value="units" className="text-xs px-3">
                      Units
                    </TabsTrigger>
                    <TabsTrigger value="volume" className="text-xs px-3">
                      Volume
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
              {/* BPS chart tab selector */}
              {expandedChart === "bps" && (
                <Tabs
                  value={selectedRevenueTab}
                  onValueChange={(v) =>
                    setSelectedRevenueTab(
                      v as "revenue-bps" | "revenue-per-loan"
                    )
                  }
                >
                  <TabsList
                    className={`h-9 ${
                      isDarkMode
                        ? "bg-slate-800 border border-slate-600"
                        : "bg-slate-100 border border-slate-300"
                    }`}
                  >
                    <TabsTrigger value="revenue-bps" className="text-xs px-3">
                      Revenue BPS
                    </TabsTrigger>
                    <TabsTrigger
                      value="revenue-per-loan"
                      className="text-xs px-3"
                    >
                      Revenue per Loan
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              )}
            </div>
          </DialogHeader>

          {/* Modal Chart Content */}
          <div
            className="p-6 overflow-auto"
            style={{ maxHeight: "calc(90vh - 120px)" }}
          >
            <div className="w-full">
              <ResponsiveContainer width="100%" height={550}>
                {expandedChart === "revenue" ? (
                  <ComposedChart
                    data={revenueChartData}
                    margin={{ top: 20, right: 40, left: 30, bottom: 100 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                    />
                    <XAxis
                      dataKey={selectedActor === "branch" ? "id" : "name"}
                      stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      interval={0}
                    />
                    <YAxis
                      yAxisId="left"
                      label={{
                        value: "Revenue",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          textAnchor: "middle",
                          fill: isDarkMode ? "#94a3b8" : "#64748b",
                          fontSize: "12px",
                        },
                      }}
                      stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                      tick={{ fontSize: 12 }}
                      tickFormatter={(value) => formatCurrency(value)}
                      width={70}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      label={{
                        value: "Accumulated %",
                        angle: 90,
                        position: "insideRight",
                        style: {
                          textAnchor: "middle",
                          fill: isDarkMode ? "#94a3b8" : "#64748b",
                          fontSize: "12px",
                        },
                      }}
                      stroke={isDarkMode ? "#3b82f6" : "#3b82f6"}
                      tick={{ fontSize: 12 }}
                      domain={[0, 100]}
                      tickFormatter={(value) =>
                        `${Number(value ?? 0).toFixed(0)}%`
                      }
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                        border: isDarkMode
                          ? "1px solid #475569"
                          : "1px solid #e2e8f0",
                        borderRadius: "8px",
                        boxShadow: isDarkMode
                          ? "0 4px 12px rgba(0, 0, 0, 0.4)"
                          : "0 4px 12px rgba(0, 0, 0, 0.15)",
                      }}
                      formatter={(value: any, name: string, props: any) => {
                        if (name === "Revenue") {
                          const entry = props.payload;
                          return [
                            `${formatCurrency(value)} revenue · ${formatNumber(
                              entry.units
                            )} units · ${formatCurrency(
                              Math.round(entry.revenuePerLoan)
                            )}/loan · ${Math.round(entry.revenueBPS)} BPS · ${
                              entry.tier
                            } tier`,
                            "Revenue",
                          ];
                        }
                        if (name === "Accumulated %")
                          return [
                            `${Number(value ?? 0).toFixed(1)}%`,
                            "Cumulative %",
                          ];
                        return [value, name];
                      }}
                      labelFormatter={(label) => {
                        const entry = revenueChartData.find(
                          (d) =>
                            (selectedActor === "branch" ? d.id : d.name) ===
                            label
                        );
                        return entry ? `${entry.name} (${entry.id})` : label;
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="revenue"
                      radius={[4, 4, 0, 0]}
                      name="Revenue"
                      cursor="pointer"
                      onClick={(data: any) => data && toggleSelection(data)}
                    >
                      {revenueChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            selectedIds.has(entry.id)
                              ? isDarkMode
                                ? "#8b5cf6"
                                : "#7c3aed"
                              : getTierColor(entry.tier)
                          }
                          stroke={
                            selectedIds.has(entry.id)
                              ? isDarkMode
                                ? "#a78bfa"
                                : "#8b5cf6"
                              : "none"
                          }
                          strokeWidth={selectedIds.has(entry.id) ? 2 : 0}
                        />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="cumulativeRevenuePercent"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: "#3b82f6", r: 4 }}
                      name="Accumulated %"
                    />
                    <ReferenceLine
                      yAxisId="right"
                      y={50}
                      stroke={isDarkMode ? "#64748b" : "#94a3b8"}
                      strokeDasharray="5 5"
                      strokeWidth={1}
                    />
                  </ComposedChart>
                ) : expandedChart === "units" ? (
                  <ComposedChart
                    data={unitsChartData}
                    margin={{ top: 20, right: 40, left: 30, bottom: 100 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                    />
                    <XAxis
                      dataKey={selectedActor === "branch" ? "id" : "name"}
                      stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      interval={0}
                    />
                    <YAxis
                      yAxisId="left"
                      label={{
                        value:
                          selectedChartTab === "units" ? "Units" : "Volume ($)",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          textAnchor: "middle",
                          fill: isDarkMode ? "#94a3b8" : "#64748b",
                          fontSize: "12px",
                        },
                      }}
                      stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                      tick={{ fontSize: 12 }}
                      tickFormatter={
                        selectedChartTab === "volume"
                          ? (value) => formatCurrency(value)
                          : undefined
                      }
                      width={selectedChartTab === "volume" ? 80 : 60}
                    />
                    <YAxis
                      yAxisId="right"
                      orientation="right"
                      label={{
                        value: "Accumulated %",
                        angle: 90,
                        position: "insideRight",
                        style: {
                          textAnchor: "middle",
                          fill: isDarkMode ? "#94a3b8" : "#64748b",
                          fontSize: "12px",
                        },
                      }}
                      stroke={isDarkMode ? "#3b82f6" : "#3b82f6"}
                      tick={{ fontSize: 12 }}
                      domain={[0, 100]}
                      tickFormatter={(value) =>
                        `${Number(value ?? 0).toFixed(0)}%`
                      }
                      width={60}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                        border: isDarkMode
                          ? "1px solid #475569"
                          : "1px solid #e2e8f0",
                        borderRadius: "8px",
                        boxShadow: isDarkMode
                          ? "0 4px 12px rgba(0, 0, 0, 0.4)"
                          : "0 4px 12px rgba(0, 0, 0, 0.15)",
                      }}
                      formatter={(value: any, name: string, props: any) => {
                        const entry = props.payload;
                        if (name === "Units") {
                          return [
                            `${formatNumber(value)} units\n${formatCurrency(
                              entry.revenue
                            )} revenue · ${formatCurrency(
                              Math.round(entry.revenuePerLoan)
                            )}/unit\n${Math.round(entry.revenueBPS)} BPS · ${
                              entry.tier
                            } tier`,
                            "Units",
                          ];
                        }
                        if (name === "Volume") {
                          return [
                            `${formatCurrency(value)}\n${formatNumber(
                              entry.units
                            )} units · ${formatCurrency(
                              entry.revenue
                            )} revenue\n${Math.round(entry.revenueBPS)} BPS · ${
                              entry.tier
                            } tier`,
                            "Volume",
                          ];
                        }
                        if (name === "Accumulated %")
                          return [
                            `${Number(value ?? 0).toFixed(1)}%`,
                            "Cumulative %",
                          ];
                        return [value, name];
                      }}
                      labelFormatter={(label) => {
                        const entry = unitsChartData.find(
                          (d) =>
                            (selectedActor === "branch" ? d.id : d.name) ===
                            label
                        );
                        return entry ? `${entry.name} (${entry.id})` : label;
                      }}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey={
                        selectedChartTab === "units" ? "units" : "volume"
                      }
                      name={selectedChartTab === "units" ? "Units" : "Volume"}
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(data: any) => data && toggleSelection(data)}
                    >
                      {unitsChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            selectedIds.has(entry.id)
                              ? isDarkMode
                                ? "#8b5cf6"
                                : "#7c3aed"
                              : getTierColor(entry.tier)
                          }
                          stroke={
                            selectedIds.has(entry.id)
                              ? isDarkMode
                                ? "#a78bfa"
                                : "#8b5cf6"
                              : "none"
                          }
                          strokeWidth={selectedIds.has(entry.id) ? 2 : 0}
                        />
                      ))}
                    </Bar>
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey={
                        selectedChartTab === "units"
                          ? "cumulativeUnitsPercent"
                          : "cumulativeVolumePercent"
                      }
                      stroke="#3b82f6"
                      strokeWidth={2}
                      dot={{ fill: "#3b82f6", r: 4 }}
                      name="Accumulated %"
                    />
                  </ComposedChart>
                ) : (
                  <BarChart
                    data={bpsChartData}
                    margin={{ top: 20, right: 40, left: 30, bottom: 100 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={isDarkMode ? "#475569" : "#e2e8f0"}
                    />
                    <XAxis
                      dataKey={selectedActor === "branch" ? "id" : "name"}
                      stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                      tick={{ fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={100}
                      interval={0}
                    />
                    <YAxis
                      label={{
                        value:
                          selectedRevenueTab === "revenue-bps"
                            ? "Revenue BPS"
                            : "Revenue per Loan ($)",
                        angle: -90,
                        position: "insideLeft",
                        style: {
                          textAnchor: "middle",
                          fill: isDarkMode ? "#94a3b8" : "#64748b",
                          fontSize: "12px",
                        },
                      }}
                      stroke={isDarkMode ? "#94a3b8" : "#64748b"}
                      tick={{ fontSize: 12 }}
                      width={70}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: isDarkMode ? "#1e293b" : "#ffffff",
                        border: isDarkMode
                          ? "1px solid #475569"
                          : "1px solid #e2e8f0",
                        borderRadius: "8px",
                        boxShadow: isDarkMode
                          ? "0 4px 12px rgba(0, 0, 0, 0.4)"
                          : "0 4px 12px rgba(0, 0, 0, 0.15)",
                      }}
                      formatter={(value: any, name: string, props: any) => {
                        const entry = props.payload;
                        if (selectedRevenueTab === "revenue-bps") {
                          return [
                            `${Math.round(value)} BPS\n${formatCurrency(
                              entry.revenue
                            )} revenue · ${formatNumber(
                              entry.units
                            )} units\n${formatCurrency(
                              Math.round(entry.revenuePerLoan)
                            )}/loan · ${entry.tier} tier`,
                            "Revenue BPS",
                          ];
                        }
                        return [
                          `${formatCurrency(
                            Math.round(value)
                          )}\n${formatCurrency(
                            entry.revenue
                          )} total · ${formatNumber(
                            entry.units
                          )} units\n${Math.round(entry.revenueBPS)} BPS · ${
                            entry.tier
                          } tier`,
                          "Revenue per Loan",
                        ];
                      }}
                      labelFormatter={(label) => {
                        const entry = bpsChartData.find(
                          (d) =>
                            (selectedActor === "branch" ? d.id : d.name) ===
                            label
                        );
                        return entry ? `${entry.name} (${entry.id})` : label;
                      }}
                    />
                    <Bar
                      dataKey={
                        selectedRevenueTab === "revenue-bps"
                          ? "revenueBPS"
                          : "revenuePerLoan"
                      }
                      radius={[4, 4, 0, 0]}
                      cursor="pointer"
                      onClick={(data: any) => data && toggleSelection(data)}
                    >
                      {bpsChartData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            selectedIds.has(entry.id)
                              ? isDarkMode
                                ? "#8b5cf6"
                                : "#7c3aed"
                              : getTierColor(entry.tier)
                          }
                          stroke={
                            selectedIds.has(entry.id)
                              ? isDarkMode
                                ? "#a78bfa"
                                : "#8b5cf6"
                              : "none"
                          }
                          strokeWidth={selectedIds.has(entry.id) ? 2 : 0}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
