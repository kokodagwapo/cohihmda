import React, { useState, useEffect, useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useTheme } from "@/components/theme-provider";
import {
  Search,
  Download,
  Maximize2,
  Minimize2,
  TrendingUp,
  Loader2,
} from "lucide-react";
import {
  useSalesScorecardData,
  TTSActor,
  TTSTier,
  TTSTierSummary,
  getTierDisplayName,
  formatCurrency,
  formatNumber,
  formatPercent,
} from "@/hooks/useSalesScorecardData";
import { useAuth } from "@/contexts/AuthContext";
import {
  DatePeriodPicker,
  useDatePeriodState,
  type PeriodSelection,
} from "@/components/ui/DatePeriodPicker";
import { useChannelStore } from "@/stores/channelStore";
import { useTenantStore } from "@/stores/tenantStore";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";

type ScorecardActor = "branch" | "loan-officer";
type ActiveTab = "summary" | "detail";

interface SummaryMetrics {
  metric: string;
  totals: string | number;
  topTier: string | number;
  secondTier: string | number;
  bottomTier: string | number;
  category?: "general" | "average-conditions";
}

const SalesScorecard = () => {
  const { theme } = useTheme();
  const isDarkMode = theme === "dark";
  const { user } = useAuth();

  const [selectedActor, setSelectedActor] = useState<ScorecardActor>(() => {
    const saved = localStorage.getItem("sales-scorecard-actor");
    return (saved as ScorecardActor) || "loan-officer";
  });

  // Use the reusable date period state hook (same as CompanyScorecard)
  const {
    year: selectedYear,
    setYear: setSelectedYear,
    dateRange,
    setDateRange,
    periodSelection,
    setPeriodSelection,
  } = useDatePeriodState();

  // Persist and restore date period (localStorage)
  const SALES_SCORECARD_PERIOD_KEY = "sales-scorecard-period";
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SALES_SCORECARD_PERIOD_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          year?: number;
          periodSelection?: PeriodSelection;
        };
        if (parsed.periodSelection?.dateRange) {
          setPeriodSelection(parsed.periodSelection);
        } else if (parsed.year != null) {
          setSelectedYear(parsed.year);
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(
        SALES_SCORECARD_PERIOD_KEY,
        JSON.stringify({
          year: selectedYear,
          periodSelection,
        })
      );
    } catch {
      // ignore
    }
  }, [selectedYear, periodSelection]);

  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const saved = localStorage.getItem("sales-scorecard-tab");
    return (saved as ActiveTab) || "summary";
  });

  const [searchQuery, setSearchQuery] = useState("");
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Channel filter from global store (synced with header)
  const { selectedChannel } = useChannelStore();

  // Tenant selection from global store (persists across pages)
  const { selectedTenantId } = useTenantStore();

  // Get tenant_id - prefer global selection (for admins), fall back to user's tenant
  const tenantId = selectedTenantId || user?.tenant_id || null;

  // Fetch TTS data from API using the hook
  const actorType = selectedActor === "branch" ? "branch" : "loan_officer";
  const {
    data: scorecardData,
    loading,
    error,
  } = useSalesScorecardData(actorType, dateRange, tenantId, selectedChannel);

  useEffect(() => {
    localStorage.setItem("sales-scorecard-actor", selectedActor);
  }, [selectedActor]);

  useEffect(() => {
    localStorage.setItem("sales-scorecard-tab", activeTab);
  }, [activeTab]);

  // Helper function to safely format numbers
  const safeFixed = (
    value: number | undefined | null,
    decimals: number = 1
  ): string => {
    if (value === undefined || value === null || isNaN(value)) return "-";
    return value.toFixed(decimals);
  };

  // Empty tier summary with all properties zeroed out (matching Qlik's 28 metrics)
  const emptyTierSummary: TTSTierSummary = {
    count: 0,
    units: 0,
    unitsPercent: 0,
    volume: 0,
    volumePercent: 0,
    revenue: 0,
    revenueBps: 0,
    avgTurnTime: 0,
    pullThrough: 0,
    waFico: 0,
    waLtv: 0,
    waDti: 0,
    waWhDays: 0,
    avgConditions: 0,
    lostOpportunityUnits: 0,
    lostOpportunityUnitsPercent: 0,
    lostOpportunityRevenue: 0,
    deniedUnits: 0,
    deniedUnitsPercent: 0,
    deniedRevenue: 0,
    lostOpportunityAndDeniedRevenue: 0,
    lostOpportunityAndDeniedRevenueBps: 0,
    avgLoRevenue: 0,
    avgLoUnits: 0,
    avgLoUnitsPerMonth: 0,
    avgLoVolume: 0,
    avgLoVolumePerMonth: 0,
    avgTtsScore: 0,
    loanComplexityScore: 0,
  };

  // Generate 28 summary metrics matching Qlik's Sales Scorecard Summary table
  const summaryMetrics = useMemo((): SummaryMetrics[] => {
    if (!scorecardData?.totals || !scorecardData?.tierSummary) return [];

    const { totals, tierSummary } = scorecardData;
    const top = tierSummary.top || emptyTierSummary;
    const second = tierSummary.second || emptyTierSummary;
    const bottom = tierSummary.bottom || emptyTierSummary;

    return [
      // Row 1: Loan Officer Count
      {
        metric:
          selectedActor === "branch" ? "Branch Count" : "Loan Officer Count",
        totals: totals.actorCount || 0,
        topTier: top.count || 0,
        secondTier: second.count || 0,
        bottomTier: bottom.count || 0,
        category: "general",
      },
      // Row 2: TTS Long Term Score
      {
        metric: "TTS Long Term Score",
        totals: safeFixed(totals.avgTtsScore),
        topTier: safeFixed(top.avgTtsScore),
        secondTier: safeFixed(second.avgTtsScore),
        bottomTier: safeFixed(bottom.avgTtsScore),
        category: "general",
      },
      // Row 3: Loan Complexity Score
      {
        metric: "Loan Complexity Score",
        totals: safeFixed(totals.loanComplexityScore),
        topTier: safeFixed(top.loanComplexityScore),
        secondTier: safeFixed(second.loanComplexityScore),
        bottomTier: safeFixed(bottom.loanComplexityScore),
        category: "general",
      },
      // Row 4: Units
      {
        metric: "Units",
        totals: totals.units || 0,
        topTier: top.units || 0,
        secondTier: second.units || 0,
        bottomTier: bottom.units || 0,
        category: "general",
      },
      // Row 5: Units %
      {
        metric: "Units %",
        totals: "100.0",
        topTier: safeFixed(top.unitsPercent),
        secondTier: safeFixed(second.unitsPercent),
        bottomTier: safeFixed(bottom.unitsPercent),
        category: "general",
      },
      // Row 6: Volume
      {
        metric: "Volume",
        totals: totals.volume || 0,
        topTier: top.volume || 0,
        secondTier: second.volume || 0,
        bottomTier: bottom.volume || 0,
        category: "general",
      },
      // Row 7: Volume %
      {
        metric: "Volume %",
        totals: "100.0",
        topTier: safeFixed(top.volumePercent),
        secondTier: safeFixed(second.volumePercent),
        bottomTier: safeFixed(bottom.volumePercent),
        category: "general",
      },
      // Row 8: Revenue $
      {
        metric: "Revenue $",
        totals: totals.revenue || 0,
        topTier: top.revenue || 0,
        secondTier: second.revenue || 0,
        bottomTier: bottom.revenue || 0,
        category: "general",
      },
      // Row 9: Revenue (BPS)
      {
        metric: "Revenue (BPS)",
        totals: safeFixed(totals.revenueBps),
        topTier: safeFixed(top.revenueBps),
        secondTier: safeFixed(second.revenueBps),
        bottomTier: safeFixed(bottom.revenueBps),
        category: "general",
      },
      // Row 10: Lost Opportunity Revenue
      {
        metric: "Lost Opportunity Revenue",
        totals: totals.lostOpportunityRevenue || 0,
        topTier: top.lostOpportunityRevenue || 0,
        secondTier: second.lostOpportunityRevenue || 0,
        bottomTier: bottom.lostOpportunityRevenue || 0,
        category: "general",
      },
      // Row 11: Average Conditions (NEW)
      {
        metric: "Average Conditions",
        totals:
          totals.avgConditions && totals.avgConditions > 0
            ? safeFixed(totals.avgConditions, 1)
            : "-",
        topTier:
          top.avgConditions && top.avgConditions > 0
            ? safeFixed(top.avgConditions, 1)
            : "-",
        secondTier:
          second.avgConditions && second.avgConditions > 0
            ? safeFixed(second.avgConditions, 1)
            : "-",
        bottomTier:
          bottom.avgConditions && bottom.avgConditions > 0
            ? safeFixed(bottom.avgConditions, 1)
            : "-",
        category: "average-conditions",
      },
      // Row 12: Turn Time App to Consumer Close
      {
        metric: "Turn Time App to Close",
        totals: safeFixed(totals.avgTurnTime, 2),
        topTier: safeFixed(top.avgTurnTime, 2),
        secondTier: safeFixed(second.avgTurnTime, 2),
        bottomTier: safeFixed(bottom.avgTurnTime, 2),
        category: "average-conditions",
      },
      // Row 13: Pull Through
      {
        metric: "Pull Through",
        totals: safeFixed(totals.pullThrough),
        topTier: safeFixed(top.pullThrough),
        secondTier: safeFixed(second.pullThrough),
        bottomTier: safeFixed(bottom.pullThrough),
        category: "average-conditions",
      },
      // Row 14: WA W-H Days (Weighted Average Warehouse Holding Days)
      // Qlik Transform.qvs: If investor_purchase_date exists, use (purchase_date - funding_date)
      // else use (vMaxDate - funding_date) for funded but not yet purchased loans
      {
        metric: "WA W-H Days",
        totals:
          totals.waWhDays && totals.waWhDays > 0
            ? safeFixed(totals.waWhDays, 1)
            : "-",
        topTier:
          top.waWhDays && top.waWhDays > 0 ? safeFixed(top.waWhDays, 1) : "-",
        secondTier:
          second.waWhDays && second.waWhDays > 0
            ? safeFixed(second.waWhDays, 1)
            : "-",
        bottomTier:
          bottom.waWhDays && bottom.waWhDays > 0
            ? safeFixed(bottom.waWhDays, 1)
            : "-",
        category: "average-conditions",
      },
      // Row 15: WA FICO
      {
        metric: "WA FICO",
        totals:
          totals.waFico && totals.waFico > 0 ? Math.round(totals.waFico) : "-",
        topTier: top.waFico && top.waFico > 0 ? Math.round(top.waFico) : "-",
        secondTier:
          second.waFico && second.waFico > 0 ? Math.round(second.waFico) : "-",
        bottomTier:
          bottom.waFico && bottom.waFico > 0 ? Math.round(bottom.waFico) : "-",
        category: "average-conditions",
      },
      // Row 16: WA LTV
      {
        metric: "WA LTV",
        totals:
          totals.waLtv && totals.waLtv > 0 ? totals.waLtv.toFixed(1) : "-",
        topTier: top.waLtv && top.waLtv > 0 ? top.waLtv.toFixed(1) : "-",
        secondTier:
          second.waLtv && second.waLtv > 0 ? second.waLtv.toFixed(1) : "-",
        bottomTier:
          bottom.waLtv && bottom.waLtv > 0 ? bottom.waLtv.toFixed(1) : "-",
        category: "average-conditions",
      },
      // Row 17: WA DTI
      {
        metric: "WA DTI",
        totals:
          totals.waDti && totals.waDti > 0 ? totals.waDti.toFixed(1) : "-",
        topTier: top.waDti && top.waDti > 0 ? top.waDti.toFixed(1) : "-",
        secondTier:
          second.waDti && second.waDti > 0 ? second.waDti.toFixed(1) : "-",
        bottomTier:
          bottom.waDti && bottom.waDti > 0 ? bottom.waDti.toFixed(1) : "-",
        category: "average-conditions",
      },
      // Row 18: Lost Opportunity Units
      {
        metric: "Lost Opportunity Units",
        totals: totals.lostOpportunityUnits || 0,
        topTier: top.lostOpportunityUnits || 0,
        secondTier: second.lostOpportunityUnits || 0,
        bottomTier: bottom.lostOpportunityUnits || 0,
        category: "general",
      },
      // Row 19: Lost Opportunity Units % (NEW)
      {
        metric: "Lost Opportunity Units %",
        totals: safeFixed(totals.lostOpportunityUnitsPercent),
        topTier: safeFixed(top.lostOpportunityUnitsPercent),
        secondTier: safeFixed(second.lostOpportunityUnitsPercent),
        bottomTier: safeFixed(bottom.lostOpportunityUnitsPercent),
        category: "general",
      },
      // Row 20: Denied Units
      {
        metric: "Denied Units",
        totals: totals.deniedUnits || 0,
        topTier: top.deniedUnits || 0,
        secondTier: second.deniedUnits || 0,
        bottomTier: bottom.deniedUnits || 0,
        category: "general",
      },
      // Row 21: Denied Units % (NEW)
      {
        metric: "Denied Units %",
        totals: safeFixed(totals.deniedUnitsPercent),
        topTier: safeFixed(top.deniedUnitsPercent),
        secondTier: safeFixed(second.deniedUnitsPercent),
        bottomTier: safeFixed(bottom.deniedUnitsPercent),
        category: "general",
      },
      // Row 22: Lost Opportunity & Denied Revenue (NEW)
      {
        metric: "Lost Opportunity & Denied Revenue",
        totals: totals.lostOpportunityAndDeniedRevenue || 0,
        topTier: top.lostOpportunityAndDeniedRevenue || 0,
        secondTier: second.lostOpportunityAndDeniedRevenue || 0,
        bottomTier: bottom.lostOpportunityAndDeniedRevenue || 0,
        category: "general",
      },
      // Row 23: Lost Opportunity & Denied Revenue BPS (NEW)
      {
        metric: "Lost Opp & Denied Rev BPS",
        totals: safeFixed(totals.lostOpportunityAndDeniedRevenueBps),
        topTier: safeFixed(top.lostOpportunityAndDeniedRevenueBps),
        secondTier: safeFixed(second.lostOpportunityAndDeniedRevenueBps),
        bottomTier: safeFixed(bottom.lostOpportunityAndDeniedRevenueBps),
        category: "general",
      },
      // Row 24: Average Loan Officer Revenue
      {
        metric: "Average LO Revenue",
        totals: totals.avgLoRevenue || 0,
        topTier: top.avgLoRevenue || 0,
        secondTier: second.avgLoRevenue || 0,
        bottomTier: bottom.avgLoRevenue || 0,
        category: "general",
      },
      // Row 25: Average Loan Officer Units
      {
        metric: "Average LO Units",
        totals: safeFixed(totals.avgLoUnits, 1),
        topTier: safeFixed(top.avgLoUnits, 1),
        secondTier: safeFixed(second.avgLoUnits, 1),
        bottomTier: safeFixed(bottom.avgLoUnits, 1),
        category: "general",
      },
      // Row 26: Average Loan Officer Units per Month (NEW)
      {
        metric: "Average LO Units/Month",
        totals: safeFixed(totals.avgLoUnitsPerMonth, 2),
        topTier: safeFixed(top.avgLoUnitsPerMonth, 2),
        secondTier: safeFixed(second.avgLoUnitsPerMonth, 2),
        bottomTier: safeFixed(bottom.avgLoUnitsPerMonth, 2),
        category: "general",
      },
      // Row 27: Average Loan Officer Volume (NEW)
      {
        metric: "Average LO Volume",
        totals: totals.avgLoVolume || 0,
        topTier: top.avgLoVolume || 0,
        secondTier: second.avgLoVolume || 0,
        bottomTier: bottom.avgLoVolume || 0,
        category: "general",
      },
      // Row 28: Average Loan Officer Volume per Month (NEW)
      {
        metric: "Average LO Volume/Month",
        totals: totals.avgLoVolumePerMonth || 0,
        topTier: top.avgLoVolumePerMonth || 0,
        secondTier: second.avgLoVolumePerMonth || 0,
        bottomTier: bottom.avgLoVolumePerMonth || 0,
        category: "general",
      },
    ];
  }, [scorecardData, selectedActor]);

  // Filter actors based on search query
  const filteredActors = useMemo((): TTSActor[] => {
    if (!scorecardData?.actors) return [];
    if (!searchQuery) return scorecardData.actors;
    const query = searchQuery.toLowerCase();
    return scorecardData.actors.filter((actor) =>
      actor.name.toLowerCase().includes(query)
    );
  }, [searchQuery, scorecardData]);

  const getTierBadge = (tier: TTSTier) => {
    const baseClasses =
      "inline-flex px-2 py-0.5 rounded-full text-xs font-medium";
    switch (tier) {
      case "top":
        return (
          <span
            className={`${baseClasses} bg-tier-top-light text-tier-top dark:bg-tier-top-dark dark:text-white`}
          >
            Top Tier
          </span>
        );
      case "second":
        return (
          <span
            className={`${baseClasses} bg-tier-second-light text-tier-second dark:bg-tier-second-dark dark:text-white`}
          >
            2nd Tier
          </span>
        );
      case "bottom":
        return (
          <span
            className={`${baseClasses} bg-tier-bottom-light text-slate-600 dark:bg-tier-bottom-dark dark:text-slate-300`}
          >
            Bottom
          </span>
        );
    }
  };

  const getDateRangeText = () => {
    if (dateRange?.start && dateRange?.end) {
      const startDate = new Date(dateRange.start);
      const endDate = new Date(dateRange.end);
      const formatDate = (d: Date) =>
        d.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        });
      const today = new Date();
      const isCurrentYear = selectedYear === today.getFullYear();
      const periodLabel = isCurrentYear
        ? `${selectedYear} YTD`
        : `${selectedYear}`;
      return `${periodLabel}: ${formatDate(startDate)} - ${formatDate(
        endDate
      )}`;
    }
    return `${selectedYear}`;
  };

  const formatMetricValue = (
    metricName: string,
    value: string | number
  ): string => {
    if (typeof value === "string") return value;

    if (
      metricName.includes("Revenue") &&
      !metricName.includes("%") &&
      !metricName.includes("BPS")
    ) {
      return formatCurrency(value);
    }
    if (metricName.includes("Volume") && !metricName.includes("%")) {
      return formatCurrency(value);
    }
    if (metricName.includes("%") || metricName.includes("Pull Through")) {
      return typeof value === "number" ? `${value}%` : value;
    }
    if (typeof value === "number") {
      return formatNumber(value);
    }
    return String(value);
  };

  // Get TTS score text color based on the actor's assigned tier
  // Uses the custom tier colors from tailwind config to stay consistent
  // with summary headers, badges, and column tints
  const getTierScoreColorClass = (tier: TTSTier): string => {
    switch (tier) {
      case "top":
        return isDarkMode ? "text-blue-400" : "text-tier-top";
      case "second":
        return isDarkMode ? "text-green-400" : "text-tier-second";
      case "bottom":
        return isDarkMode ? "text-slate-400" : "text-slate-500";
    }
  };

  const convertToCSV = (data: any, tab: ActiveTab): string => {
    if (tab === "summary") {
      const headers = [
        "Metric",
        "Totals",
        "Top Tier",
        "Second Tier",
        "Bottom Tier",
      ];
      const rows = (data as SummaryMetrics[]).map((m) => [
        m.metric,
        typeof m.totals === "number" ? m.totals.toString() : m.totals,
        typeof m.topTier === "number" ? m.topTier.toString() : m.topTier,
        typeof m.secondTier === "number"
          ? m.secondTier.toString()
          : m.secondTier,
        typeof m.bottomTier === "number"
          ? m.bottomTier.toString()
          : m.bottomTier,
      ]);
      return [headers, ...rows].map((row) => row.join(",")).join("\n");
    } else {
      const headers = [
        "Name",
        "TTS Score",
        "Tier",
        "Units",
        "Volume",
        "Revenue",
        "Revenue BPS",
        "Pull Through",
        "Turn Time",
        "WA FICO",
        "WA LTV",
        "WA DTI",
      ];
      const rows = (data as TTSActor[]).map((actor) => [
        actor.name,
        actor.ttsScore.toFixed(1),
        getTierDisplayName(actor.tier),
        actor.units.toString(),
        actor.volume.toString(),
        actor.revenue.toString(),
        actor.revenueBps.toFixed(1),
        actor.pullThrough.toFixed(1),
        actor.avgTurnTime.toFixed(1),
        actor.waFico.toFixed(0),
        actor.waLtv.toFixed(1),
        actor.waDti.toFixed(1),
      ]);
      return [headers, ...rows].map((row) => row.join(",")).join("\n");
    }
  };

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Sales Scorecard" />

        <main
            className={`relative flex-1 overflow-y-auto px-4 sm:px-6 py-2 sm:py-3 transition-all duration-300 ${
              isFullscreen ? "max-w-full" : "max-w-[1800px] mx-auto"
            }`}
          >
            <div
              className={`grid gap-3 sm:gap-4 transition-all duration-300 ${
                isFullscreen ? "grid-cols-1" : "grid-cols-12"
              }`}
            >
              {/* Left Sidebar - TTS Weights & Insights */}
              {!isFullscreen && (
                <div className="col-span-12 lg:col-span-3 space-y-3">
                  {/* TTS Weights & Story Card */}
                  <Card
                    className={`rounded-xl backdrop-blur-sm ${
                      isDarkMode
                        ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                        : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                    }`}
                  >
                    <Tabs defaultValue="weights" className="w-full">
                      <CardHeader
                        className={`border-b pb-4 ${
                          isDarkMode
                            ? "border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30"
                            : "border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30"
                        }`}
                      >
                        <TabsList
                          className={`grid w-full grid-cols-2 h-9 ${
                            isDarkMode
                              ? "bg-slate-800/60 border border-slate-700/50"
                              : "bg-blue-50/50 border border-blue-200/30"
                          }`}
                        >
                          <TabsTrigger
                            value="weights"
                            className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                          >
                            TTS Weights
                          </TabsTrigger>
                          <TabsTrigger
                            value="story"
                            className="text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white data-[state=active]:shadow-lg data-[state=active]:shadow-blue-500/25"
                          >
                            Methodology
                          </TabsTrigger>
                        </TabsList>
                      </CardHeader>

                      {/* TTS Weights Tab Content - Dynamic weights from tenant config */}
                      <TabsContent value="weights" className="mt-0">
                        <CardContent className="space-y-3 pt-4">
                          {(() => {
                            // Get weights from API response, with defaults
                            const weights = scorecardData?.weightConfig || {
                              unit: 0.2,
                              volume: 0.2,
                              margin: 0.2,
                              concession: 0.2,
                              pullThrough: 0.2,
                              turnTime: 0.2,
                            };
                            // Calculate total for normalization display
                            const totalWeight =
                              weights.unit +
                              weights.volume +
                              weights.margin +
                              weights.concession +
                              weights.pullThrough +
                              weights.turnTime;
                            // Helper to format weight as percentage
                            const formatWeight = (w: number) =>
                              `${((w / totalWeight) * 100).toFixed(0)}%`;
                            const getBarWidth = (w: number) =>
                              `${(w / totalWeight) * 100}%`;

                            return (
                              <>
                                {/* Unit Weight */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span
                                      className={`text-xs font-medium ${
                                        isDarkMode
                                          ? "text-cyan-400"
                                          : "text-cyan-600"
                                      }`}
                                    >
                                      Unit Rating
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {formatWeight(weights.unit)}
                                    </Badge>
                                  </div>
                                  <div
                                    className={`h-2 rounded-full overflow-hidden ${
                                      isDarkMode
                                        ? "bg-slate-800/60"
                                        : "bg-slate-200/80"
                                    }`}
                                  >
                                    <div
                                      className="h-full bg-gradient-to-r from-cyan-600 to-cyan-400 rounded-full transition-all"
                                      style={{ width: getBarWidth(weights.unit) }}
                                    />
                                  </div>
                                </div>

                                {/* Volume Weight */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span
                                      className={`text-xs font-medium ${
                                        isDarkMode
                                          ? "text-blue-400"
                                          : "text-blue-600"
                                      }`}
                                    >
                                      Volume Rating
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {formatWeight(weights.volume)}
                                    </Badge>
                                  </div>
                                  <div
                                    className={`h-2 rounded-full overflow-hidden ${
                                      isDarkMode
                                        ? "bg-slate-800/60"
                                        : "bg-slate-200/80"
                                    }`}
                                  >
                                    <div
                                      className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all"
                                      style={{ width: getBarWidth(weights.volume) }}
                                    />
                                  </div>
                                </div>

                                {/* Margin Weight */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span
                                      className={`text-xs font-medium ${
                                        isDarkMode
                                          ? "text-purple-400"
                                          : "text-purple-600"
                                      }`}
                                    >
                                      Margin Rating
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {formatWeight(weights.margin)}
                                    </Badge>
                                  </div>
                                  <div
                                    className={`h-2 rounded-full overflow-hidden ${
                                      isDarkMode
                                        ? "bg-slate-800/60"
                                        : "bg-slate-200/80"
                                    }`}
                                  >
                                    <div
                                      className="h-full bg-gradient-to-r from-purple-600 to-purple-400 rounded-full transition-all"
                                      style={{ width: getBarWidth(weights.margin) }}
                                    />
                                  </div>
                                </div>

                                {/* Concession Weight */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span
                                      className={`text-xs font-medium ${
                                        isDarkMode
                                          ? "text-amber-400"
                                          : "text-amber-600"
                                      }`}
                                    >
                                      Concession Rating
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {formatWeight(weights.concession)}
                                    </Badge>
                                  </div>
                                  <div
                                    className={`h-2 rounded-full overflow-hidden ${
                                      isDarkMode
                                        ? "bg-slate-800/60"
                                        : "bg-slate-200/80"
                                    }`}
                                  >
                                    <div
                                      className="h-full bg-gradient-to-r from-amber-600 to-amber-400 rounded-full transition-all"
                                      style={{
                                        width: getBarWidth(weights.concession),
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Pull-Through Weight */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span
                                      className={`text-xs font-medium ${
                                        isDarkMode
                                          ? "text-emerald-400"
                                          : "text-emerald-600"
                                      }`}
                                    >
                                      Pull-Through Rating
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {formatWeight(weights.pullThrough)}
                                    </Badge>
                                  </div>
                                  <div
                                    className={`h-2 rounded-full overflow-hidden ${
                                      isDarkMode
                                        ? "bg-slate-800/60"
                                        : "bg-slate-200/80"
                                    }`}
                                  >
                                    <div
                                      className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 rounded-full transition-all"
                                      style={{
                                        width: getBarWidth(weights.pullThrough),
                                      }}
                                    />
                                  </div>
                                </div>

                                {/* Turn Time Weight */}
                                <div>
                                  <div className="flex items-center justify-between mb-1.5">
                                    <span
                                      className={`text-xs font-medium ${
                                        isDarkMode
                                          ? "text-rose-400"
                                          : "text-rose-600"
                                      }`}
                                    >
                                      Turn Time Rating
                                    </span>
                                    <Badge
                                      variant="secondary"
                                      className="font-mono text-[10px] px-1.5 py-0"
                                    >
                                      {formatWeight(weights.turnTime)}
                                    </Badge>
                                  </div>
                                  <div
                                    className={`h-2 rounded-full overflow-hidden ${
                                      isDarkMode
                                        ? "bg-slate-800/60"
                                        : "bg-slate-200/80"
                                    }`}
                                  >
                                    <div
                                      className="h-full bg-gradient-to-r from-rose-600 to-rose-400 rounded-full transition-all"
                                      style={{
                                        width: getBarWidth(weights.turnTime),
                                      }}
                                    />
                                  </div>
                                  <p
                                    className={`text-[9px] mt-0.5 ${
                                      isDarkMode
                                        ? "text-slate-500"
                                        : "text-slate-400"
                                    }`}
                                  >
                                    Inverse: faster = higher score
                                  </p>
                                </div>

                                <div
                                  className={`pt-2 mt-2 border-t ${
                                    isDarkMode
                                      ? "border-slate-700"
                                      : "border-slate-200"
                                  }`}
                                >
                                  <p
                                    className={`text-[10px] ${
                                      isDarkMode
                                        ? "text-slate-400"
                                        : "text-slate-500"
                                    }`}
                                  >
                                    TTS = Sum of (Rating × Weight) / Total Weight
                                  </p>
                                </div>
                              </>
                            );
                          })()}
                        </CardContent>
                      </TabsContent>

                      {/* Methodology Tab Content */}
                      <TabsContent value="story" className="mt-0">
                        <CardContent className="space-y-3 pt-4">
                          <div>
                            <h3
                              className={`text-xs font-semibold mb-1.5 ${
                                isDarkMode ? "text-white" : "text-slate-900"
                              }`}
                            >
                              TTS (Top Tier Score) Methodology
                            </h3>
                            <p
                              className={`text-[11px] leading-relaxed ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              TTS uses percentile-based ranking following the Pareto
                              principle of production distribution.
                            </p>
                          </div>

                          <div
                            className={`p-2.5 rounded-lg ${
                              isDarkMode ? "bg-slate-800/50" : "bg-blue-50/30"
                            }`}
                          >
                            <h4
                              className={`text-[11px] font-semibold mb-1.5 ${
                                isDarkMode
                                  ? "text-emerald-400"
                                  : "text-emerald-600"
                              }`}
                            >
                              Pareto Distribution
                            </h4>
                            <ul
                              className={`text-[10px] space-y-1.5 ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              <li className="flex items-start gap-2">
                                <span className="font-bold text-tier-top min-w-[60px]">
                                  Top 20%
                                </span>
                                <span>→ Produce ~50% of total value</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <span className="font-bold text-tier-second min-w-[60px]">
                                  Middle 30%
                                </span>
                                <span>→ Produce ~30% of total value</span>
                              </li>
                              <li className="flex items-start gap-2">
                                <span className="font-bold text-tier-bottom min-w-[60px]">
                                  Bottom 50%
                                </span>
                                <span>→ Produce ~20% of total value</span>
                              </li>
                            </ul>
                          </div>

                          <div
                            className={`p-2.5 rounded-lg ${
                              isDarkMode ? "bg-slate-800/50" : "bg-emerald-50/30"
                            }`}
                          >
                            <h4
                              className={`text-[11px] font-semibold mb-1.5 ${
                                isDarkMode
                                  ? "text-emerald-400"
                                  : "text-emerald-600"
                              }`}
                            >
                              Tier Assignment (Percentile-Based)
                            </h4>
                            <ul
                              className={`text-[10px] space-y-1 ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              <li>
                                <span className="font-medium text-tier-top">
                                  Top Tier:
                                </span>{" "}
                                80th+ percentile (top 20%)
                              </li>
                              <li>
                                <span className="font-medium text-tier-second">
                                  Second Tier:
                                </span>{" "}
                                50th-80th percentile (middle 30%)
                              </li>
                              <li>
                                <span className="font-medium text-tier-bottom">
                                  Bottom Tier:
                                </span>{" "}
                                Below 50th percentile (bottom 50%)
                              </li>
                            </ul>
                          </div>

                          <div
                            className={`p-2.5 rounded-lg ${
                              isDarkMode ? "bg-slate-800/50" : "bg-blue-50/30"
                            }`}
                          >
                            <h4
                              className={`text-[11px] font-semibold mb-1.5 ${
                                isDarkMode ? "text-blue-400" : "text-blue-600"
                              }`}
                            >
                              Score Calculation
                            </h4>
                            <p
                              className={`text-[10px] ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Each rating = (Actor Value / Company Avg) × 100
                            </p>
                            <p
                              className={`text-[10px] mt-1 ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Turn Time: inverse (faster = higher score)
                            </p>
                          </div>

                          <div
                            className={`p-2.5 rounded-lg ${
                              isDarkMode ? "bg-slate-800/50" : "bg-purple-50/30"
                            }`}
                          >
                            <h4
                              className={`text-[11px] font-semibold mb-1.5 ${
                                isDarkMode
                                  ? "text-purple-400"
                                  : "text-purple-600"
                              }`}
                            >
                              Time Period
                            </h4>
                            <p
                              className={`text-[10px] ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Uses <strong>Funding Date</strong> for all metrics
                            </p>
                          </div>
                        </CardContent>
                      </TabsContent>
                    </Tabs>
                  </Card>

                  {/* Key Insights Card */}
                  <Card
                    className={`rounded-xl backdrop-blur-sm overflow-hidden ${
                      isDarkMode
                        ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                        : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                    }`}
                  >
                    <CardHeader
                      className={`border-b pb-3 ${
                        isDarkMode
                          ? "border-slate-700/50 bg-gradient-to-r from-blue-600/10 to-purple-600/10"
                          : "border-blue-100/50 bg-gradient-to-r from-blue-50/80 to-purple-50/60"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500">
                          <TrendingUp className="w-3.5 h-3.5 text-white" />
                        </div>
                        <CardTitle className="text-sm font-bold">
                          TTS Insights
                        </CardTitle>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-5 space-y-4">
                      {loading ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                        </div>
                      ) : (
                        <>
                          {/* Top Performers */}
                          <div
                            className={`relative overflow-hidden p-4 rounded-xl border-2 ${
                              isDarkMode
                                ? "bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent border-white/10"
                                : "bg-gradient-to-br from-emerald-50 via-emerald-25 to-white border-white"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-tier-top animate-pulse"></div>
                              <p
                                className={`text-[10px] uppercase tracking-wider font-bold ${
                                  isDarkMode
                                    ? "text-white/90"
                                    : "text-tier-top/90"
                                }`}
                              >
                                Top Tier
                              </p>
                            </div>
                            <p
                              className={`text-3xl font-bold leading-none mb-2 ${
                                isDarkMode
                                  ? "text-emerald-300"
                                  : "text-emerald-600"
                              }`}
                            >
                              {scorecardData?.tierSummary.top.count || 0}
                            </p>
                            <p
                              className={`text-xs ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Avg TTS:{" "}
                              {scorecardData?.tierSummary.top.avgTtsScore?.toFixed(
                                1
                              ) || 0}
                            </p>
                          </div>

                          {/* Total Revenue */}
                          <div
                            className={`relative overflow-hidden p-4 rounded-xl border-2 ${
                              isDarkMode
                                ? "bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent border-white/10"
                                : "bg-gradient-to-br from-blue-50 via-blue-25 to-white border-white"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                              <p
                                className={`text-[10px] uppercase tracking-wider font-bold ${
                                  isDarkMode
                                    ? "text-blue-400/90"
                                    : "text-blue-600/90"
                                }`}
                              >
                                Total Revenue
                              </p>
                            </div>
                            <p
                              className={`text-3xl font-bold leading-none mb-2 ${
                                isDarkMode ? "text-blue-300" : "text-blue-600"
                              }`}
                            >
                              {formatCurrency(
                                scorecardData?.totals.revenue || 0
                              )}
                            </p>
                            <p
                              className={`text-xs ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              {scorecardData?.totals.actorCount || 0}{" "}
                              {selectedActor === "branch" ? "branches" : "LOs"}
                            </p>
                          </div>

                          {/* Total Units */}
                          <div
                            className={`relative overflow-hidden p-4 rounded-xl border-2 ${
                              isDarkMode
                                ? "bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent border-white/10"
                                : "bg-gradient-to-br from-purple-50 via-purple-25 to-white border-white"
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-3">
                              <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></div>
                              <p
                                className={`text-[10px] uppercase tracking-wider font-bold ${
                                  isDarkMode
                                    ? "text-purple-400/90"
                                    : "text-purple-600/90"
                                }`}
                              >
                                Total Units
                              </p>
                            </div>
                            <p
                              className={`text-3xl font-bold leading-none mb-2 ${
                                isDarkMode
                                  ? "text-purple-300"
                                  : "text-purple-600"
                              }`}
                            >
                              {formatNumber(scorecardData?.totals.units || 0)}
                            </p>
                            <p
                              className={`text-xs ${
                                isDarkMode ? "text-slate-400" : "text-slate-600"
                              }`}
                            >
                              Avg:{" "}
                              {scorecardData?.totals.avgLoUnits?.toFixed(1) ||
                                0}{" "}
                              per LO
                            </p>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* Main Content */}
              <div
                className={`space-y-3 transition-all duration-300 ${
                  isFullscreen ? "col-span-1" : "col-span-12 lg:col-span-9"
                }`}
              >
                {/* Filter Controls Row */}
                {!isFullscreen && (
                  <Card
                    className={`rounded-xl backdrop-blur-sm ${
                      isDarkMode
                        ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                        : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                    }`}
                  >
                    <CardContent className="pt-6">
                      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                        {/* Scorecard Actor Tabs */}
                        <div>
                          <label
                            className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${
                              isDarkMode ? "text-slate-400" : "text-slate-600"
                            }`}
                          >
                            Scorecard Actor
                          </label>
                          <Tabs
                            value={selectedActor}
                            onValueChange={(v) =>
                              setSelectedActor(v as ScorecardActor)
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
                                className="text-xs sm:text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white"
                              >
                                Branch
                              </TabsTrigger>
                              <TabsTrigger
                                value="loan-officer"
                                className="text-xs sm:text-xs data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-purple-500 data-[state=active]:text-white"
                              >
                                Loan Officer
                              </TabsTrigger>
                            </TabsList>
                          </Tabs>
                        </div>

                        {/* Date Range Tabs */}
                        <div>
                          <label
                            className={`text-xs font-semibold mb-2 block uppercase tracking-wider ${
                              isDarkMode ? "text-slate-400" : "text-slate-600"
                            }`}
                          >
                            Date Range
                          </label>
                          <DatePeriodPicker
                            year={selectedYear}
                            onYearChange={setSelectedYear}
                            onDateRangeChange={setDateRange}
                            onPeriodChange={setPeriodSelection}
                            periodSelectionFromStore={periodSelection}
                            yearsToShow={4}
                            size="sm"
                            showLabel={false}
                          />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Scorecard Table */}
                <Card
                  className={`rounded-xl backdrop-blur-sm ${
                    isDarkMode
                      ? "border-slate-700/50 bg-slate-800/70 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
                      : "border-blue-200/40 bg-white shadow-[0_8px_24px_rgba(59,130,246,0.08)]"
                  }`}
                >
                  <CardHeader
                    className={`border-b pb-4 ${
                      isDarkMode
                        ? "border-slate-700/50 bg-gradient-to-r from-slate-800/50 to-slate-700/30"
                        : "border-blue-100/50 bg-gradient-to-r from-blue-50/30 to-purple-50/30"
                    }`}
                  >
                    <Tabs
                      value={activeTab}
                      onValueChange={(v) => setActiveTab(v as ActiveTab)}
                      className="w-full"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <TabsList
                          className={`grid w-fit grid-cols-2 h-11 sm:h-10 ${
                            isDarkMode
                              ? "bg-slate-800/60 border border-slate-700/50"
                              : "bg-blue-50/50 border border-blue-200/30"
                          }`}
                        >
                          <TabsTrigger value="summary" className="text-sm px-4">
                            Summary
                          </TabsTrigger>
                          <TabsTrigger value="detail" className="text-sm px-4">
                            Detail
                          </TabsTrigger>
                        </TabsList>

                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsFullscreen(!isFullscreen)}
                          className={`gap-2 ${
                            isDarkMode
                              ? "hover:bg-slate-700"
                              : "hover:bg-slate-100"
                          }`}
                        >
                          {isFullscreen ? (
                            <Minimize2 className="h-4 w-4" />
                          ) : (
                            <Maximize2 className="h-4 w-4" />
                          )}
                          <span className="text-xs">
                            {isFullscreen ? "Exit" : "Fullscreen"}
                          </span>
                        </Button>
                      </div>
                    </Tabs>

                    <div>
                      <CardTitle className="text-base sm:text-lg font-semibold">
                        TTS Sales Scorecard -{" "}
                        {activeTab === "summary" ? "Summary" : "Detail"}
                      </CardTitle>
                      <CardDescription className="mt-1">
                        {getDateRangeText()}
                      </CardDescription>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {/* Controls Row */}
                    <div className="flex items-center gap-4 mb-4 flex-wrap">
                      <div className="relative flex-1 max-w-xs">
                        <Search
                          className={`absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 ${
                            isDarkMode ? "text-slate-500" : "text-slate-400"
                          }`}
                        />
                        <Input
                          type="text"
                          placeholder="Search..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className={`pl-9 h-9 ${
                            isDarkMode
                              ? "bg-slate-800/60 border-slate-700"
                              : "bg-white border-slate-200"
                          }`}
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            const data =
                              activeTab === "summary"
                                ? summaryMetrics
                                : filteredActors;
                            const csv = convertToCSV(data, activeTab);
                            const blob = new Blob([csv], { type: "text/csv" });
                            const url = window.URL.createObjectURL(blob);
                            const link = document.createElement("a");
                            link.href = url;
                            link.download = `tts-sales-scorecard-${activeTab}-${selectedYear}.csv`;
                            link.click();
                          }}
                          disabled={loading}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          Export
                        </Button>
                      </div>
                    </div>

                    {/* Table View */}
                    {activeTab === "summary" ? (
                      // Summary Tab - 20 Metrics with 3 Tiers
                      <Card className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                        {loading ? (
                          <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                            <span className="ml-3 text-sm text-slate-500">
                              Loading TTS data...
                            </span>
                          </div>
                        ) : error ? (
                          <div className="flex items-center justify-center py-12 text-red-500">
                            <span className="text-sm">{error}</span>
                          </div>
                        ) : summaryMetrics.length === 0 ? (
                          <div className="flex items-center justify-center py-12 text-slate-500">
                            <span className="text-sm">
                              No data available for the selected period
                            </span>
                          </div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                              <thead>
                                <tr
                                  className={`border-b-2 ${
                                    isDarkMode
                                      ? "border-slate-700"
                                      : "border-slate-300"
                                  }`}
                                >
                                  <th
                                    className={`text-left py-3 px-4 text-sm font-medium sticky left-0 ${
                                      isDarkMode
                                        ? "bg-slate-800/90 text-slate-400"
                                        : "bg-slate-50/90 text-slate-600"
                                    }`}
                                  >
                                    Metric
                                  </th>
                                  <th
                                    className={`text-right py-3 px-4 text-sm font-medium ${
                                      isDarkMode
                                        ? "text-slate-400"
                                        : "text-slate-600"
                                    }`}
                                  >
                                    Totals
                                  </th>
                                  <th className="text-right py-3 px-4 text-sm font-bold bg-tier-top text-white">
                                    Top Tier
                                  </th>
                                  <th className="text-right py-3 px-4 text-sm font-bold bg-tier-second text-white">
                                    Second Tier
                                  </th>
                                  <th className="text-right py-3 px-4 text-sm font-bold bg-tier-bottom text-slate-800">
                                    Bottom Tier
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {summaryMetrics.map((metric, index) => {
                                  const prevMetric =
                                    index > 0
                                      ? summaryMetrics[index - 1]
                                      : null;
                                  const isCategoryHeader =
                                    prevMetric &&
                                    prevMetric.category !== metric.category &&
                                    metric.category === "average-conditions";

                                  return (
                                    <React.Fragment key={index}>
                                      {isCategoryHeader && (
                                        <tr>
                                          <td
                                            colSpan={5}
                                            className={`py-2 px-4 text-xs font-semibold ${
                                              isDarkMode
                                                ? "text-slate-300 bg-slate-800/50"
                                                : "text-slate-700 bg-slate-50"
                                            }`}
                                          >
                                            Average Conditions
                                          </td>
                                        </tr>
                                      )}
                                      <tr
                                        className={`border-b transition-colors ${
                                          isDarkMode
                                            ? "border-slate-800/50 hover:bg-slate-800/30"
                                            : "border-slate-100 hover:bg-slate-50"
                                        }`}
                                      >
                                        <td
                                          className={`py-3 px-4 text-sm sticky left-0 ${
                                            isDarkMode
                                              ? "bg-slate-800/90 text-slate-300"
                                              : "bg-slate-50/90 text-slate-700"
                                          }`}
                                        >
                                          {metric.metric}
                                        </td>
                                        <td
                                          className={`py-3 px-4 text-sm text-right font-mono ${
                                            isDarkMode
                                              ? "text-slate-200"
                                              : "text-slate-900"
                                          }`}
                                        >
                                          {formatMetricValue(
                                            metric.metric,
                                            metric.totals
                                          )}
                                        </td>
                                        <td
                                          className={`py-3 px-4 text-sm text-right font-mono bg-tier-top-light dark:bg-tier-top-dark ${
                                            isDarkMode
                                              ? "text-slate-200"
                                              : "text-slate-900"
                                          }`}
                                        >
                                          {formatMetricValue(
                                            metric.metric,
                                            metric.topTier
                                          )}
                                        </td>
                                        <td
                                          className={`py-3 px-4 text-sm text-right font-mono bg-tier-second-light dark:bg-tier-second-dark ${
                                            isDarkMode
                                              ? "text-slate-200"
                                              : "text-slate-900"
                                          }`}
                                        >
                                          {formatMetricValue(
                                            metric.metric,
                                            metric.secondTier
                                          )}
                                        </td>
                                        <td
                                          className={`py-3 px-4 text-sm text-right font-mono bg-tier-bottom-light dark:bg-tier-bottom-dark ${
                                            isDarkMode
                                              ? "text-slate-200"
                                              : "text-slate-900"
                                          }`}
                                        >
                                          {formatMetricValue(
                                            metric.metric,
                                            metric.bottomTier
                                          )}
                                        </td>
                                      </tr>
                                    </React.Fragment>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </Card>
                    ) : (
                      // Detail Tab - TTS Actors
                      <div className="overflow-x-auto">
                        <Card className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden dark:bg-slate-800 dark:border-slate-700">
                          <CardHeader className="p-4 bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700">
                            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-200">
                              {selectedActor === "branch"
                                ? "Branches"
                                : "Loan Officers"}{" "}
                              - TTS Score Ranking
                            </CardTitle>
                            <p className="text-xs text-slate-400 dark:text-slate-500">
                              Sorted by TTS score (Top 20% / Middle 30% / Bottom
                              50%)
                            </p>
                          </CardHeader>
                          {loading ? (
                            <div className="flex items-center justify-center py-12">
                              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
                              <span className="ml-3 text-sm text-slate-500">
                                Loading data...
                              </span>
                            </div>
                          ) : error ? (
                            <div className="flex items-center justify-center py-12 text-red-500">
                              <span className="text-sm">{error}</span>
                            </div>
                          ) : filteredActors.length === 0 ? (
                            <div className="flex items-center justify-center py-12 text-slate-500">
                              <span className="text-sm">
                                No data available for the selected period
                              </span>
                            </div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="w-full">
                                <thead>
                                  <tr className="bg-slate-50 border-b border-slate-200 dark:bg-slate-800/50 dark:border-slate-700">
                                    <th className="py-2.5 px-4 text-left text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      {selectedActor === "branch"
                                        ? "Branch"
                                        : "Loan Officer"}
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      TTS Score
                                    </th>
                                    <th className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      Tier
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      Units
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      Volume
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      Revenue
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      BPS
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      P-T %
                                    </th>
                                    <th className="py-2.5 px-4 text-right text-xs font-semibold text-slate-600 dark:text-slate-300">
                                      TT Days
                                    </th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredActors.map((actor, index) => (
                                    <tr
                                      key={index}
                                      className={`border-b border-slate-100 hover:bg-slate-50 transition-colors dark:border-slate-700 dark:hover:bg-slate-800/50`}
                                    >
                                      <td className="py-3 px-4 text-sm font-medium text-slate-800 dark:text-slate-200">
                                        {actor.name || "-"}
                                      </td>
                                      <td
                                        className={`py-3 px-4 text-sm text-right font-bold ${getTierScoreColorClass(
                                          actor.tier
                                        )}`}
                                      >
                                        {(actor.ttsScore ?? 0).toFixed(2)}
                                      </td>
                                      <td className="py-3 px-4 text-center">
                                        {getTierBadge(actor.tier)}
                                      </td>
                                      <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                                        {formatNumber(actor.units ?? 0)}
                                      </td>
                                      <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                                        {formatCurrency(actor.volume ?? 0)}
                                      </td>
                                      <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                                        $
                                        {(actor.revenue ?? 0).toLocaleString(
                                          "en-US",
                                          { maximumFractionDigits: 0 }
                                        )}
                                      </td>
                                      <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                                        {(actor.revenueBps ?? 0).toFixed(2)}
                                      </td>
                                      <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                                        {(actor.pullThrough ?? 0).toFixed(2)}%
                                      </td>
                                      <td className="py-3 px-4 text-sm text-right text-slate-700 dark:text-slate-300">
                                        {(actor.avgTurnTime ?? 0).toFixed(2)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </Card>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          </main>
      </div>
    </TopTieringLayout>
  );
};

export default SalesScorecard;
