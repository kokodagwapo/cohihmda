import React, { useEffect, useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target,
  ArrowUp,
  ArrowDown,
  X,
  ChevronDown,
  Calendar as CalendarIcon,
  Download,
  Loader2,
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
import { api } from "@/lib/api";

// Loan Mix row interface - matches backend LoanMixRow
interface LoanMixRow {
  category: string;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
}

// Distribution bucket interface - matches backend ExtendedDistributionBucket
interface DistributionBucket {
  range: string;
  rangeLabel: string;
  units: number;
  volume: number;
  percentage: number;
  sortOrder: number;
  wac: number;
  waFico: number;
  waLtv: number;
}

// Period options for KPI timeframe selectors
const PERIOD_OPTIONS: Array<{
  value: PeriodValue;
  label: string;
  shortLabel: string;
}> = [
  { value: "mtd", label: "Month to Date", shortLabel: "MTD" },
  { value: "ytd", label: "Year to Date", shortLabel: "YTD" },
  { value: "last_month", label: "Last Month", shortLabel: "Last Mo" },
  { value: "last_year", label: "Last Year", shortLabel: "Last Yr" },
  { value: "all", label: "All Time", shortLabel: "All" },
  { value: "custom", label: "Custom Range", shortLabel: "Custom" },
];

// KPI to metric mapping with their volume and weighted average counterparts
const KPI_METRICS: Record<
  string,
  { primary: string; volume?: string; additionalMetrics?: string[] }
> = {
  activeLoans: {
    primary: "active_loans",
    volume: "active_volume",
    additionalMetrics: ["wac", "wa_fico", "wa_ltv"],
  },
  closedLoans: {
    primary: "closed_loans",
    volume: "closed_volume",
    additionalMetrics: ["wac", "wa_fico", "wa_ltv"],
  },
  lockedLoans: {
    primary: "locked_loans",
    volume: "locked_volume",
    additionalMetrics: ["wac", "wa_fico", "wa_ltv"],
  },
  cycleTime: { primary: "avg_cycle_time" },
  pullThrough: { primary: "pull_through_rate" },
  creditPulls: { primary: "credit_pulls" },
};

// Ordered field→label mapping for loan detail CSV export (matches LoanDetailView columns)
const LOAN_DETAIL_CSV_FIELDS: Array<{ field: string; label: string }> = [
  { field: "loan_number", label: "Loan Number" },
  { field: "loan_amount", label: "Loan Amount" },
  { field: "interest_rate", label: "Interest Rate" },
  { field: "fico_score", label: "FICO Score" },
  { field: "ltv_ratio", label: "LTV" },
  { field: "be_dti_ratio", label: "BE DTI" },
  { field: "channel", label: "Channel" },
  { field: "branch", label: "Branch" },
  { field: "loan_officer", label: "Loan Officer" },
  { field: "processor", label: "Processor" },
  { field: "underwriter", label: "Underwriter" },
  { field: "closer", label: "Closer" },
  { field: "investor", label: "Investor" },
  { field: "property_street", label: "Property Street" },
  { field: "property_city", label: "Property City" },
  { field: "property_state", label: "Property State" },
  { field: "property_county", label: "Property County" },
  { field: "property_zip", label: "Property Zip" },
  { field: "loan_term", label: "Loan Term" },
  { field: "current_loan_status", label: "Current Loan Status" },
  { field: "current_milestone", label: "Current Milestone" },
  { field: "loan_folder", label: "Loan Folder" },
  { field: "loan_type", label: "Loan Type" },
  { field: "loan_program", label: "Loan Program" },
  { field: "loan_purpose", label: "Loan Purpose" },
  { field: "occupancy_type", label: "Occupancy Type" },
  { field: "property_type", label: "Property Type" },
  { field: "lien_position", label: "Lien Position" },
  { field: "started_date", label: "Started Date" },
  { field: "credit_pull_date", label: "Credit Pull Date" },
  { field: "application_date", label: "Application Date" },
  { field: "loan_estimate_sent_date", label: "Loan Estimate Sent" },
  { field: "loan_estimate_received_date", label: "Loan Estimate Received" },
  { field: "uw_final_approval_date", label: "UW Final Approval Date" },
  { field: "uw_suspended_date", label: "UW Suspended Date" },
  { field: "uw_denied_date", label: "UW Denied Date" },
  { field: "denial_date", label: "Denial Date" },
  { field: "investor_lock_date", label: "Investor Lock Date" },
  { field: "lock_expiration_date", label: "Lock Expiration Date" },
  { field: "lock_days", label: "Lock Days" },
  { field: "estimated_closing_date", label: "Estimated Closing Date" },
  { field: "ctc_date", label: "CTC Date" },
  { field: "closing_disclosure_sent_date", label: "Closing Disclosure Sent" },
  { field: "closing_disclosure_received_date", label: "Closing Disclosure Received" },
  { field: "closing_date", label: "Closing Date" },
  { field: "funding_date", label: "Funding Date" },
  { field: "investor_purchase_date", label: "Investor Purchase Date" },
  { field: "shipped_date", label: "Shipped Date" },
  { field: "mers_min", label: "MERS MIN" },
  { field: "number_of_months_interest_only_payments", label: "Interest Only Months" },
  { field: "income_total_mo_income", label: "Total Monthly Income" },
  { field: "origination_points", label: "Origination Points" },
  { field: "orig_fee_borr_pd", label: "Orig Fee Borr Pd" },
  { field: "subject_property_type_fannie_mae", label: "Subject Property Type (FNMA)" },
  { field: "fees_va_fund_fee_borr", label: "VA Fund Fee Borr" },
  { field: "fha_lender_id", label: "FHA Lender ID" },
  { field: "fees_loan_discount_fee", label: "Loan Discount Fee" },
  { field: "fees_loan_discount_fee_borr", label: "Loan Discount Fee Borr" },
  { field: "rush_closing_on_file", label: "Rush Closing On File" },
  { field: "scrub_rating_of_file", label: "Scrub Rating Of File" },
];

// Executive Dashboard - Business Overview Component (6 Cards with Modals)
interface ExecutiveDashboardProps {
  dateFilter: "today" | "mtd" | "ytd" | "custom";
  year?: number;
  selectedTenantId?: string | null;
  /** Optional channel filter - filters metrics to loans in the selected channel */
  selectedChannel?: string | null;
  /** Report data to canvasDataStore for PowerPoint export. */
  onDataReady?: (payload: unknown) => void;
}

export const ExecutiveDashboard = React.memo(function ExecutiveDashboard({
  dateFilter,
  year = new Date().getFullYear(),
  selectedTenantId,
  selectedChannel,
  onDataReady,
}: ExecutiveDashboardProps) {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [animatedValues, setAnimatedValues] = useState<Record<string, number>>(
    {}
  );
  const [isAnimating, setIsAnimating] = useState(false);
  const [exportingKpi, setExportingKpi] = useState<string | null>(null);

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
  // Channel filtering is passed through to filter metrics by selected channel
  const {
    queryMetric,
    queryMetrics,
    queryMetricsWithDateRange,
    loading: metricsLoading,
  } = useMetrics(selectedTenantId, year, selectedChannel);
  const [metricsData, setMetricsData] = useState<Record<string, any>>({});
  const [loadingKpis, setLoadingKpis] = useState<Set<string>>(new Set());
  // Single source of truth for active loans count (matches ClosingFalloutForecast "all time")
  const [serverActiveLoansCount, setServerActiveLoansCount] = useState<{
    count: number;
    loading: boolean;
  }>({ count: 0, loading: true });

  // Modal-specific loan mix data - keyed by KPI id, fetched lazily when modal opens
  const [modalLoanMixData, setModalLoanMixData] = useState<
    Record<
      string,
      {
        byType: LoanMixRow[];
        byPurpose: LoanMixRow[];
        byStage: LoanMixRow[];
        byLoanSize: DistributionBucket[];
        byLockExpiration: DistributionBucket[];
        loading: boolean;
      }
    >
  >({});

  // Cycle Time "Time By Stage" - from /api/loans/operations-overview
  const [cycleTimeStageData, setCycleTimeStageData] = useState<{
    turnTimeByStage?: {
      appToLock: { target: number; actual: number; overTarget: number };
      lockToCTC: { target: number; actual: number; overTarget: number };
      ctcToFunding: { target: number; actual: number; overTarget: number };
    };
  } | null>(null);
  const [cycleTimeStageLoading, setCycleTimeStageLoading] = useState(false);

  // Cycle Time "By Loan Type" - from /api/metrics/query with groupBy loan_type
  const [cycleTimeByTypeData, setCycleTimeByTypeData] = useState<
    { groupKey: string; value: number }[] | null
  >(null);
  const [cycleTimeByTypeLoading, setCycleTimeByTypeLoading] = useState(false);

  // Pull-Through modal: By Loan Type from closing-fallout-forecast; Fallout from loan-mix (withdrawn)
  const [pullThroughModalData, setPullThroughModalData] = useState<{
    pullThroughByLoanType: { loanType: string; pullThroughRate: number; historicalCount: number }[];
    withdrawnByType: LoanMixRow[];
  } | null>(null);
  const [pullThroughModalLoading, setPullThroughModalLoading] = useState(false);

  // Track which KPIs have been fetched to avoid redundant calls
  const fetchedKpisRef = React.useRef<Set<string>>(new Set());

  // Get the appropriate filter and dateField for each KPI type
  // These match the exact SQL logic and defaultDateField used in METRICS_CATALOG
  const getKpiFilter = useCallback(
    (
      kpiId: string
    ): { additionalFilters?: Record<string, any>; dateField?: string } => {
      switch (kpiId) {
        case "activeLoans":
          // Active loans: current_loan_status = 'Active Loan' AND application_date IS NOT NULL
          // Uses application_date but date filter is ignored (current state)
          return {
            additionalFilters: { active_loan_filter: true },
            dateField: "application_date",
          };
        case "closedLoans":
          // Funded loans: funding_date IS NOT NULL
          // Date range filters on funding_date
          return {
            additionalFilters: { closed_loan_filter: true },
            dateField: "funding_date",
          };
        case "lockedLoans":
          // Locked loans: lock_date IS NOT NULL
          // Date range filters on lock_date
          return {
            additionalFilters: { locked_loan_filter: true },
            dateField: "lock_date",
          };
        case "cycleTime":
          // Cycle time applies to funded loans - show breakdown of closed/funded loans
          // Uses funding_date for date filtering
          return {
            additionalFilters: { closed_loan_filter: true },
            dateField: "funding_date",
          };
        case "creditPulls":
          // Credit pulls: count loans with credit_pull_date in range (matches credit_pulls metric)
          return {
            additionalFilters: { credit_pull_filter: true },
            dateField: "credit_pull_date",
          };
        default:
          return {};
      }
    },
    []
  );

  // Fetch loan mix data for a specific KPI modal (lazy loading)
  // Respects the time range selected for each KPI
  const fetchModalLoanMixData = useCallback(
    async (
      kpiId: string,
      period: PeriodValue,
      customDates?: { start: Date | null; end: Date | null }
    ) => {
      // Skip if not a KPI that has breakdown data
      // pullThrough requires ratio calculation that loan-mix can't provide
      // cycleTime uses operations-overview + metrics/query groupBy instead of loan-mix
      if (
        ![
          "activeLoans",
          "closedLoans",
          "lockedLoans",
          "creditPulls",
        ].includes(kpiId)
      ) {
        return;
      }

      // Create a cache key that includes the period
      const cacheKey = `${kpiId}_${period}_${
        customDates?.start?.toISOString() || ""
      }_${customDates?.end?.toISOString() || ""}`;

      // Skip if already fetched with this exact configuration
      if (fetchedKpisRef.current.has(cacheKey)) {
        return;
      }
      fetchedKpisRef.current.add(cacheKey);

      setModalLoanMixData((prev) => ({
        ...prev,
        [kpiId]: {
          byType: [],
          byPurpose: [],
          byStage: [],
          byLoanSize: [],
          byLockExpiration: [],
          loading: true,
        },
      }));

      try {
        const queryParams = new URLSearchParams();
        if (selectedTenantId) queryParams.append("tenant_id", selectedTenantId);
        const baseUrl = `/api/metrics/loan-mix${
          queryParams.toString() ? `?${queryParams.toString()}` : ""
        }`;
        const loanSizeUrl = `/api/metrics/loan-size-distribution${
          queryParams.toString() ? `?${queryParams.toString()}` : ""
        }`;
        const lockExpirationUrl = `/api/metrics/lock-expiration-distribution${
          queryParams.toString() ? `?${queryParams.toString()}` : ""
        }`;

        const { additionalFilters, dateField } = getKpiFilter(kpiId);

        // Calculate date range from period (Active Loans = no date filter)
        let dateRange: { start: string | null; end: string | null } | undefined;
        if (kpiId !== "activeLoans") {
          if (period === "custom" && customDates?.start && customDates?.end) {
            dateRange = {
              start: customDates.start.toISOString().split("T")[0],
              end: customDates.end.toISOString().split("T")[0],
            };
          } else if (period !== "all") {
            const range = getPeriodRange(period, new Date(), year);
            dateRange = {
              start: range.start
                ? range.start.toISOString().split("T")[0]
                : null,
              end: range.end ? range.end.toISOString().split("T")[0] : null,
            };
          }
        }

        // Build list of requests based on KPI type
        type ApiResponse =
          | { loanMix: LoanMixRow[] }
          | { distribution: DistributionBucket[] };
        const requests: Promise<ApiResponse>[] = [
          // Always fetch by type and purpose
          api.request<{ loanMix: LoanMixRow[] }>(baseUrl, {
            method: "POST",
            body: JSON.stringify({
              groupBy: "loan_type",
              dateRange,
              dateField,
              additionalFilters,
            }),
          }),
          api.request<{ loanMix: LoanMixRow[] }>(baseUrl, {
            method: "POST",
            body: JSON.stringify({
              groupBy: "loan_purpose",
              dateRange,
              dateField,
              additionalFilters,
            }),
          }),
        ];

        // Add stage request for active loans
        const fetchStage = kpiId === "activeLoans";
        if (fetchStage) {
          requests.push(
            api.request<{ loanMix: LoanMixRow[] }>(baseUrl, {
              method: "POST",
              body: JSON.stringify({
                groupBy: "current_milestone",
                dateRange,
                dateField,
                additionalFilters,
              }),
            })
          );
        }

        // Add loan size request for active and closed loans
        const fetchLoanSize = ["activeLoans", "closedLoans"].includes(kpiId);
        if (fetchLoanSize) {
          requests.push(
            api.request<{ distribution: DistributionBucket[] }>(loanSizeUrl, {
              method: "POST",
              body: JSON.stringify({
                dateRange,
                dateField,
                additionalFilters,
              }),
            })
          );
        }

        // Add lock expiration request for locked loans
        const fetchLockExpiration = kpiId === "lockedLoans";
        if (fetchLockExpiration) {
          requests.push(
            api.request<{ distribution: DistributionBucket[] }>(
              lockExpirationUrl,
              {
                method: "POST",
                body: JSON.stringify({
                  dateRange,
                  dateField,
                  additionalFilters,
                }),
              }
            )
          );
        }

        const responses = await Promise.all(requests);

        // Parse responses based on what was requested
        // Helper to safely extract loanMix from response
        const getLoanMix = (resp: ApiResponse | undefined): LoanMixRow[] =>
          resp && "loanMix" in resp ? resp.loanMix : [];
        const getDistribution = (
          resp: ApiResponse | undefined
        ): DistributionBucket[] =>
          resp && "distribution" in resp ? resp.distribution : [];

        let idx = 0;
        const byType = getLoanMix(responses[idx++]);
        const byPurpose = getLoanMix(responses[idx++]);
        const byStage = fetchStage ? getLoanMix(responses[idx++]) : [];
        const byLoanSize = fetchLoanSize
          ? getDistribution(responses[idx++])
          : [];
        const byLockExpiration = fetchLockExpiration
          ? getDistribution(responses[idx++])
          : [];

        setModalLoanMixData((prev) => ({
          ...prev,
          [kpiId]: {
            byType,
            byPurpose,
            byStage,
            byLoanSize,
            byLockExpiration,
            loading: false,
          },
        }));
      } catch (error: any) {
        console.error(
          `[ExecutiveDashboard] Error fetching loan mix data for ${kpiId}:`,
          error
        );
        fetchedKpisRef.current.delete(cacheKey); // Allow retry on error
        setModalLoanMixData((prev) => ({
          ...prev,
          [kpiId]: {
            byType: [],
            byPurpose: [],
            byStage: [],
            byLoanSize: [],
            byLockExpiration: [],
            loading: false,
          },
        }));
      }
    },
    [selectedTenantId, getKpiFilter, year]
  );

  // Fetch modal data when a card is selected or timeframe changes
  useEffect(() => {
    if (selectedCard) {
      // Get the period for this KPI (activeLoans doesn't have timeframe)
      const period: PeriodValue =
        selectedCard === "activeLoans"
          ? "all"
          : kpiTimeframes[selectedCard] || "mtd";
      const customDates = kpiCustomDates[selectedCard];
      fetchModalLoanMixData(selectedCard, period, customDates);
    }
  }, [selectedCard, fetchModalLoanMixData, kpiTimeframes, kpiCustomDates]);

  // Fetch Cycle Time "Time By Stage" and "By Loan Type" when cycleTime modal opens
  useEffect(() => {
    if (selectedCard !== "cycleTime") {
      setCycleTimeStageData(null);
      setCycleTimeByTypeData(null);
      setCycleTimeStageLoading(false);
      setCycleTimeByTypeLoading(false);
      return;
    }
    let cancelled = false;
    const period: PeriodValue = kpiTimeframes.cycleTime || "mtd";
    const customDates = kpiCustomDates.cycleTime;
    let startDate: string | null = null;
    let endDate: string | null = null;
    if (period === "custom" && customDates?.start && customDates?.end) {
      startDate = customDates.start.toISOString().split("T")[0];
      endDate = customDates.end.toISOString().split("T")[0];
    } else if (period !== "all") {
      const range = getPeriodRange(period, new Date(), year);
      startDate = range.start ? range.start.toISOString().split("T")[0] : null;
      endDate = range.end ? range.end.toISOString().split("T")[0] : null;
    }
    if (period === "all") {
      setCycleTimeStageData(null);
      setCycleTimeByTypeData(null);
      setCycleTimeStageLoading(false);
      setCycleTimeByTypeLoading(false);
      return;
    }
    setCycleTimeStageLoading(true);
    setCycleTimeByTypeLoading(true);
    const params = new URLSearchParams();
    if (selectedTenantId) params.set("tenant_id", selectedTenantId);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (selectedChannel && selectedChannel !== "All")
      params.set("channel_group", selectedChannel);
    // Time By Stage from operations-overview
    api
      .request<{
        turnTimeByStage?: {
          appToLock: { target: number; actual: number; overTarget: number };
          lockToCTC: { target: number; actual: number; overTarget: number };
          ctcToFunding: { target: number; actual: number; overTarget: number };
        };
      }>(`/api/loans/operations-overview?${params.toString()}`)
      .then((res) => {
        if (!cancelled) {
          setCycleTimeStageData(res.turnTimeByStage ? { turnTimeByStage: res.turnTimeByStage } : null);
          setCycleTimeStageLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCycleTimeStageData(null);
          setCycleTimeStageLoading(false);
        }
      });
    // By Loan Type from metrics query with groupBy
    const queryParams = new URLSearchParams();
    if (selectedTenantId) queryParams.append("tenant_id", selectedTenantId);
    const additionalFilters: Record<string, string | boolean> = { closed_loan_filter: true };
    if (selectedChannel && selectedChannel !== "All")
      additionalFilters.consolidated_channel = selectedChannel;
    api
      .request<{
        metrics: Record<string, { groupKey: string; value: number | string }[]>;
        groupedBy: string;
      }>(`/api/metrics/query${queryParams.toString() ? `?${queryParams.toString()}` : ""}`, {
        method: "POST",
        body: JSON.stringify({
          metricIds: ["avg_cycle_time"],
          dateRange: { start: startDate, end: endDate },
          dateField: "funding_date",
          groupBy: "loan_type",
          additionalFilters,
        }),
      })
      .then((res) => {
        if (!cancelled) {
          const rows = res.metrics?.avg_cycle_time ?? [];
          setCycleTimeByTypeData(
            rows.map((r) => ({
              groupKey: r.groupKey,
              value: typeof r.value === "number" ? r.value : parseFloat(String(r.value)) || 0,
            }))
          );
          setCycleTimeByTypeLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCycleTimeByTypeData(null);
          setCycleTimeByTypeLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCard, kpiTimeframes, kpiCustomDates, year, selectedTenantId, selectedChannel]);

  // Fetch Pull-Through "By Loan Type" and Fallout (withdrawn by type) when pullThrough modal opens
  useEffect(() => {
    if (selectedCard !== "pullThrough") {
      setPullThroughModalData(null);
      setPullThroughModalLoading(false);
      return;
    }
    let cancelled = false;
    setPullThroughModalLoading(true);
    const period = kpiTimeframes.pullThrough || "rolling_90_days";
    const dateFilter =
      period === "rolling_90_days" ? "ytd" : period === "custom" ? "ytd" : period;
    const range =
      dateFilter === "ytd"
        ? getPeriodRange("ytd", new Date(), year)
        : dateFilter === "mtd"
          ? getPeriodRange("mtd", new Date(), year)
          : null;
    const dateRange =
      range?.start && range?.end
        ? {
            start: range.start.toISOString().split("T")[0],
            end: range.end.toISOString().split("T")[0],
          }
        : undefined;
    const queryParams = new URLSearchParams();
    if (selectedTenantId) queryParams.set("tenant_id", selectedTenantId);
    const baseUrl = `/api/metrics/loan-mix${queryParams.toString() ? `?${queryParams.toString()}` : ""}`;
    // 1) Closing-fallout-forecast for pull-through by loan type
    const forecastParams = new URLSearchParams();
    forecastParams.set("dateFilter", dateFilter);
    if (selectedTenantId) forecastParams.set("tenant_id", selectedTenantId);
    api
      .request<{
        pullThroughByLoanType: { loanType: string; pullThroughRate: number; historicalCount: number }[];
      }>(`/api/dashboard/closing-fallout-forecast?${forecastParams.toString()}`)
      .then((res) => {
        if (cancelled) return;
        const pullThroughByLoanType = res.pullThroughByLoanType ?? [];
        // 2) Loan-mix with withdrawn_filter for fallout breakdown by type
        api
          .request<{ loanMix: LoanMixRow[] }>(baseUrl, {
            method: "POST",
            body: JSON.stringify({
              groupBy: "loan_type",
              dateRange,
              dateField: "application_date",
              additionalFilters: { withdrawn_filter: true },
            }),
          })
          .then((loanMixRes) => {
            if (!cancelled) {
              setPullThroughModalData({
                pullThroughByLoanType,
                withdrawnByType: loanMixRes.loanMix ?? [],
              });
            }
          })
          .catch(() => {
            if (!cancelled) {
              setPullThroughModalData({ pullThroughByLoanType, withdrawnByType: [] });
            }
          })
          .finally(() => {
            if (!cancelled) setPullThroughModalLoading(false);
          });
      })
      .catch(() => {
        if (!cancelled) {
          setPullThroughModalData(null);
          setPullThroughModalLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCard, kpiTimeframes.pullThrough, selectedTenantId, year]);

  // Clear cached modal data when tenant changes
  useEffect(() => {
    setModalLoanMixData({});
    setCycleTimeStageData(null);
    setCycleTimeByTypeData(null);
    setPullThroughModalData(null);
    fetchedKpisRef.current.clear();
  }, [selectedTenantId]);

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
        // Include additional weighted average metrics (wac, wa_fico, wa_ltv) for loan KPIs
        if (kpiConfig.additionalMetrics) {
          metricsToFetch.push(...kpiConfig.additionalMetrics);
        }

        // Active loans ignores date filter (current state)
        const effectivePeriod = kpiId === "activeLoans" ? "all" : period;

        let results;
        if (
          effectivePeriod === "custom" &&
          customDates?.start &&
          customDates?.end
        ) {
          // Use custom date range
          results = await queryMetricsWithDateRange(
            metricsToFetch,
            customDates.start,
            customDates.end
          );
        } else {
          results = await queryMetrics(metricsToFetch, effectivePeriod as any);
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

  // Export loan-level detail for a KPI modal as CSV.
  // Uses the backend `kpi_filter` param which applies the EXACT same SQL
  // conditions as METRICS_CATALOG, so exported row count matches the KPI card.
  const exportKpiLoanDetail = useCallback(
    async (kpiId: string) => {
      if (exportingKpi) return;
      setExportingKpi(kpiId);

      try {
        const params = new URLSearchParams();
        if (selectedTenantId) params.set("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All")
          params.set("channel_group", selectedChannel);

        // Map frontend KPI id → backend kpi_filter value + the date field
        // that METRICS_CATALOG uses as defaultDateField for each metric.
        const KPI_EXPORT_CONFIG: Record<
          string,
          { kpiFilter: string; dateField: string; hasDateRange: boolean }
        > = {
          activeLoans: {
            kpiFilter: "active_loans",
            dateField: "application_date",
            hasDateRange: false, // current state, no date range
          },
          closedLoans: {
            kpiFilter: "closed_loans",
            dateField: "funding_date",
            hasDateRange: true,
          },
          lockedLoans: {
            kpiFilter: "locked_loans",
            dateField: "investor_lock_date",
            hasDateRange: true,
          },
          cycleTime: {
            kpiFilter: "closed_loans",
            dateField: "funding_date",
            hasDateRange: true,
          },
          pullThrough: {
            kpiFilter: "", // no kpi_filter — all loans in date range
            dateField: "application_date",
            hasDateRange: true,
          },
          creditPulls: {
            kpiFilter: "credit_pulls",
            dateField: "credit_pull_date",
            hasDateRange: true,
          },
        };

        const config = KPI_EXPORT_CONFIG[kpiId];
        if (!config) return;

        // Apply the exact METRICS_CATALOG filter via backend kpi_filter param
        if (config.kpiFilter) {
          params.set("kpi_filter", config.kpiFilter);
        }

        // Apply date range matching the KPI's selected timeframe
        if (config.hasDateRange) {
          const period: PeriodValue = kpiTimeframes[kpiId] || "mtd";
          params.set("date_field", config.dateField);

          if (period === "custom") {
            const customDates = kpiCustomDates[kpiId];
            if (customDates?.start && customDates?.end) {
              params.set("date_from", customDates.start.toISOString().split("T")[0]);
              params.set("date_to", customDates.end.toISOString().split("T")[0]);
            }
          } else if (period !== "all") {
            const effectivePeriod =
              period === ("rolling_90_days" as PeriodValue) ? "ytd" : period;
            const range = getPeriodRange(effectivePeriod, new Date(), year);
            if (range.start)
              params.set("date_from", range.start.toISOString().split("T")[0]);
            if (range.end)
              params.set("date_to", range.end.toISOString().split("T")[0]);
          }
        }

        // Fetch all pages from the detail-list endpoint
        let allLoans: Record<string, unknown>[] = [];
        let offset = 0;
        const limit = 5000;
        while (true) {
          params.set("limit", String(limit));
          params.set("offset", String(offset));
          const resp = await api.request<{ loans: Record<string, unknown>[]; total: number }>(
            `/api/loans/detail-list?${params.toString()}`
          );
          allLoans = allLoans.concat(resp.loans);
          if (allLoans.length >= resp.total || resp.loans.length === 0) break;
          offset += limit;
        }

        if (allLoans.length === 0) return;

        // Determine columns: known fields + any additional fields from the response
        const knownFieldSet = new Set(LOAN_DETAIL_CSV_FIELDS.map((c) => c.field));
        const extraFields: string[] = [];
        if (allLoans.length > 0) {
          for (const key of Object.keys(allLoans[0])) {
            if (key !== "loan_id" && !knownFieldSet.has(key)) {
              extraFields.push(key);
            }
          }
        }
        const columns = [
          ...LOAN_DETAIL_CSV_FIELDS,
          ...extraFields.map((f) => ({
            field: f,
            label: f
              .replace(/_/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase()),
          })),
        ];

        const escapeCsv = (v: unknown) => {
          const s = String(v ?? "");
          if (s.includes(",") || s.includes('"') || s.includes("\n"))
            return `"${s.replace(/"/g, '""')}"`;
          return s;
        };
        const formatCell = (v: unknown) => {
          if (v === null || v === undefined) return "";
          if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))
            return v.slice(0, 10);
          return String(v);
        };

        const headerRow = columns.map((c) => escapeCsv(c.label));
        const dataRows = allLoans.map((loan) =>
          columns.map((c) => escapeCsv(formatCell(loan[c.field])))
        );

        const csv = [headerRow, ...dataRows].map((r) => r.join(",")).join("\n");
        const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        const kpiName = kpiId.replace(/([A-Z])/g, "-$1").toLowerCase();
        link.download = `${kpiName}-loan-detail-${new Date().toISOString().split("T")[0]}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
      } catch (error) {
        console.error(
          `[ExecutiveDashboard] Error exporting loan detail for ${kpiId}:`,
          error
        );
      } finally {
        setExportingKpi(null);
      }
    },
    [exportingKpi, selectedTenantId, selectedChannel, kpiTimeframes, kpiCustomDates, year]
  );

  // Single source of truth: fetch active loans count from same endpoint as ClosingFalloutForecast (no period = all time, no channel)
  useEffect(() => {
    let cancelled = false;
    setServerActiveLoansCount((prev) => ({ ...prev, loading: true }));
    const params = new URLSearchParams();
    if (selectedTenantId) params.set("tenant_id", selectedTenantId);
    api
      .request<{ count: number; volume: number }>(
        `/api/loans/active-loans-count${params.toString() ? `?${params.toString()}` : ""}`
      )
      .then((res) => {
        if (!cancelled)
          setServerActiveLoansCount({ count: res.count ?? 0, loading: false });
      })
      .catch(() => {
        if (!cancelled)
          setServerActiveLoansCount((prev) => ({ ...prev, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  // Initial fetch for all KPIs based on their default timeframes
  useEffect(() => {
    // Active Loans card value comes from serverActiveLoansCount above; still fetch metrics for volume/weighted averages
    fetchKpiMetrics("activeLoans", "all");

    // Fetch other KPIs with their selected timeframes
    Object.entries(kpiTimeframes).forEach(([kpiId, period]) => {
      fetchKpiMetrics(kpiId, period);
    });
  }, [selectedTenantId, year]); // Re-fetch when tenant or year changes

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

    // Use same source as ClosingFalloutForecast (GET active-loans-count) when available
    const activeLoans =
      !serverActiveLoansCount.loading
        ? serverActiveLoansCount.count
        : typeof metricsData.active_loans?.value === "number"
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
        value: serverActiveLoansCount.loading
          ? "--"
          : activeLoans.toLocaleString(),
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
  }, [metricsLoading, metricsData, serverActiveLoansCount]);

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

  useEffect(() => {
    if (!onDataReady || metricsLoading || metrics.activeLoans.value === "--") return;
    const kpiPayload = kpiCards.map((card) => {
      const normalizedValue = (() => {
        if (card.id !== "cycleTime") return card.value;
        const parsed = Number.parseFloat(String(card.value).replace(/[^\d.-]/g, ""));
        return Number.isFinite(parsed) ? `${Math.round(parsed)} days` : card.value;
      })();

      return {
        label: card.label,
        value: normalizedValue,
        change: typeof card.change === "number" ? card.change : undefined,
        trend: card.trend,
      };
    });
    onDataReady({ kpis: kpiPayload, title: 'Business Overview' });
  }, [onDataReady, metricsLoading, kpiCards, metrics.activeLoans.value]);

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

  // Calculate business overview data from metricsData
  const calculateBusinessOverviewData = () => {
    // Check if we have any metrics data yet
    const hasData = Object.keys(metricsData).length > 0;

    // If no metrics data, return placeholders
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
        pullThrough: { avgPercent: "--", totalCompleted: 0, totalFallout: 0, byLoanType: [], falloutBreakdown: [] },
        creditPulls: { byLoanType: [], byLoanPurpose: [] },
      };
    }

    // Extract values from metrics service
    // Extract units/volume from KPI metrics (used for main card display)
    const activeUnits =
      typeof metricsData.active_loans?.value === "number"
        ? metricsData.active_loans.value
        : parseFloat(metricsData.active_loans?.value as string) || 0;
    const activeVolume =
      typeof metricsData.active_volume?.value === "number"
        ? metricsData.active_volume.value
        : parseFloat(metricsData.active_volume?.value as string) || 0;

    const closedUnits =
      typeof metricsData.closed_loans?.value === "number"
        ? metricsData.closed_loans.value
        : parseFloat(metricsData.closed_loans?.value as string) || 0;
    const closedVolume =
      typeof metricsData.closed_volume?.value === "number"
        ? metricsData.closed_volume.value
        : parseFloat(metricsData.closed_volume?.value as string) || 0;

    const lockedUnits =
      typeof metricsData.locked_loans?.value === "number"
        ? metricsData.locked_loans.value
        : parseFloat(metricsData.locked_loans?.value as string) || 0;
    const lockedVolume =
      typeof metricsData.locked_volume?.value === "number"
        ? metricsData.locked_volume.value
        : parseFloat(metricsData.locked_volume?.value as string) || 0;

    // Note: Weighted averages (rate, FICO, LTV, avgBalance) are calculated from filtered loan mix data
    // for each KPI type in calculateWeightedAverages() function below

    // Cycle Time - use metrics data
    const avgDaysToFunding =
      typeof metricsData.avg_cycle_time?.value === "number"
        ? metricsData.avg_cycle_time.value
        : parseFloat(metricsData.avg_cycle_time?.value as string) || 0;

    // Cycle time by stage - from /api/loans/operations-overview turnTimeByStage
    const cycleTimeByStage: Array<{ label: string; values: string[] }> = [];
    if (cycleTimeStageData?.turnTimeByStage) {
      const t = cycleTimeStageData.turnTimeByStage;
      const fmt = (actual: number, target: number, overTarget: number) => [
        `${actual} days`,
        `${target} days`,
        (overTarget >= 0 ? "+" : "") + overTarget + " days",
      ];
      cycleTimeByStage.push(
        { label: "App to Lock", values: fmt(t.appToLock.actual, t.appToLock.target, t.appToLock.overTarget) },
        { label: "Lock to CTC", values: fmt(t.lockToCTC.actual, t.lockToCTC.target, t.lockToCTC.overTarget) },
        { label: "CTC to Funding", values: fmt(t.ctcToFunding.actual, t.ctcToFunding.target, t.ctcToFunding.overTarget) },
      );
    }

    // Pull-Through calculation - use metrics data
    const pullThroughPercent =
      typeof metricsData.pull_through_rate?.value === "number"
        ? metricsData.pull_through_rate.value
        : parseFloat(metricsData.pull_through_rate?.value as string) || 0;
    const companyAvg = 75.0;
    const pullThroughStatus =
      pullThroughPercent >= companyAvg ? "Above" : "Below";

    // Transform loan mix data into breakdown table rows using ACTUAL data from API
    // Helper function to format a LoanMixRow into table values
    const formatLoanMixRow = (row: LoanMixRow) => ({
      label: row.category,
      values: [
        formatBusinessValue(row.units, "units"),
        formatBusinessValue(row.volume, "volume"),
        row.wac > 0 ? formatBusinessValue(row.wac, "rate") : "--",
        row.volume > 0 && row.units > 0
          ? formatBusinessValue(row.volume / row.units, "balance")
          : "--",
        row.waFico > 0 ? formatBusinessValue(row.waFico, "fico") : "--",
        row.waLtv > 0 ? formatBusinessValue(row.waLtv, "ltv") : "--",
      ],
    });

    // Get modal-specific loan mix data for each KPI (filtered by status)
    const getModalData = (kpiId: string) => {
      const data = modalLoanMixData[kpiId];
      return data && !data.loading
        ? data
        : {
            byType: [],
            byPurpose: [],
            byStage: [],
            byLoanSize: [],
            byLockExpiration: [],
          };
    };

    // Helper to format distribution bucket into table row (same columns as loan mix)
    const formatDistributionRow = (bucket: DistributionBucket) => ({
      label: bucket.rangeLabel,
      values: [
        formatBusinessValue(bucket.units, "units"),
        formatBusinessValue(bucket.volume, "volume"),
        bucket.wac > 0 ? formatBusinessValue(bucket.wac, "rate") : "--",
        bucket.volume > 0 && bucket.units > 0
          ? formatBusinessValue(bucket.volume / bucket.units, "balance")
          : "--",
        bucket.waFico > 0 ? formatBusinessValue(bucket.waFico, "fico") : "--",
        bucket.waLtv > 0 ? formatBusinessValue(bucket.waLtv, "ltv") : "--",
      ],
    });

    // Helper to calculate weighted averages from loan mix data
    // Loan mix rows already have volume-weighted wac, waFico, waLtv per category
    // We need to re-weight them by volume to get overall averages
    const calculateWeightedAverages = (rows: LoanMixRow[]) => {
      if (rows.length === 0) {
        return {
          totalUnits: 0,
          totalVolume: 0,
          avgRate: null,
          avgFico: null,
          avgLtv: null,
          avgBalance: null,
        };
      }
      const totalUnits = rows.reduce((sum, r) => sum + r.units, 0);
      const totalVolume = rows.reduce((sum, r) => sum + r.volume, 0);

      // Calculate volume-weighted averages
      const weightedRate = rows.reduce(
        (sum, r) => sum + (r.wac > 0 ? r.wac * r.volume : 0),
        0
      );
      const weightedRateVolume = rows.reduce(
        (sum, r) => sum + (r.wac > 0 ? r.volume : 0),
        0
      );
      const avgRate =
        weightedRateVolume > 0 ? weightedRate / weightedRateVolume : null;

      const weightedFico = rows.reduce(
        (sum, r) => sum + (r.waFico > 0 ? r.waFico * r.volume : 0),
        0
      );
      const weightedFicoVolume = rows.reduce(
        (sum, r) => sum + (r.waFico > 0 ? r.volume : 0),
        0
      );
      const avgFico =
        weightedFicoVolume > 0 ? weightedFico / weightedFicoVolume : null;

      const weightedLtv = rows.reduce(
        (sum, r) => sum + (r.waLtv > 0 ? r.waLtv * r.volume : 0),
        0
      );
      const weightedLtvVolume = rows.reduce(
        (sum, r) => sum + (r.waLtv > 0 ? r.volume : 0),
        0
      );
      const avgLtv =
        weightedLtvVolume > 0 ? weightedLtv / weightedLtvVolume : null;

      const avgBalance = totalUnits > 0 ? totalVolume / totalUnits : null;

      return { totalUnits, totalVolume, avgRate, avgFico, avgLtv, avgBalance };
    };

    // Active Loans breakdown - filtered to only Active Loan status
    const activeData = getModalData("activeLoans");
    const activeStats = calculateWeightedAverages(activeData.byType);
    const activeByLoanType = activeData.byType.map(formatLoanMixRow);
    const activeByLoanPurpose = activeData.byPurpose.map(formatLoanMixRow);
    const activeByLoanSize = activeData.byLoanSize.map(formatDistributionRow);
    const activeByStage = activeData.byStage.map(formatLoanMixRow);

    // Closed Loans breakdown - filtered to only funded loans
    const closedData = getModalData("closedLoans");
    const closedStats = calculateWeightedAverages(closedData.byType);
    const closedByLoanType = closedData.byType.map(formatLoanMixRow);
    const closedByLoanPurpose = closedData.byPurpose.map(formatLoanMixRow);
    const closedByLoanSize = closedData.byLoanSize.map(formatDistributionRow);

    // Locked Loans breakdown - filtered to only locked loans
    const lockedData = getModalData("lockedLoans");
    const lockedStats = calculateWeightedAverages(lockedData.byType);
    const lockedByLoanType = lockedData.byType.map(formatLoanMixRow);
    const lockedByLoanPurpose = lockedData.byPurpose.map(formatLoanMixRow);
    const lockedByExpirationDays = lockedData.byLockExpiration.map(
      formatDistributionRow
    );

    // Cycle Time "By Loan Type" - from /api/metrics/query groupBy loan_type (avg days, trend, status vs overall avg)
    const cycleTimeByLoanType: Array<{ label: string; values: string[] }> = [];
    if (cycleTimeByTypeData && cycleTimeByTypeData.length > 0) {
      cycleTimeByTypeData.forEach((row) => {
        const days = row.value;
        const status =
          avgDaysToFunding > 0
            ? days < avgDaysToFunding
              ? "Above Avg"
              : "Below Avg"
            : "--";
        cycleTimeByLoanType.push({
          label: row.groupKey,
          values: [`${Math.round(days)} days`, "--", status],
        });
      });
    }

    // Pull-Through by loan type - from /api/dashboard/closing-fallout-forecast
    const pullThroughByLoanType: Array<{ label: string; values: string[] }> = [];
    if (pullThroughModalData?.pullThroughByLoanType?.length) {
      const companyAvg = pullThroughPercent;
      pullThroughModalData.pullThroughByLoanType.forEach((row) => {
        const rate = row.pullThroughRate;
        const variance = rate - companyAvg;
        pullThroughByLoanType.push({
          label: row.loanType,
          values: [
            `${rate.toFixed(1)}%`,
            `${companyAvg.toFixed(1)}%`,
            (variance >= 0 ? "+" : "") + variance.toFixed(1) + "%",
            row.historicalCount.toLocaleString(),
            rate >= companyAvg ? "Above" : "Below",
          ],
        });
      });
    }

    // Fallout breakdown - withdrawn by loan type from loan-mix with withdrawn_filter
    const falloutBreakdown: Array<{ label: string; values: string[] }> = [];
    if (pullThroughModalData?.withdrawnByType?.length) {
      const totalUnits = pullThroughModalData.withdrawnByType.reduce(
        (sum, r) => sum + r.units,
        0
      );
      pullThroughModalData.withdrawnByType.forEach((row) => {
        const pct =
          totalUnits > 0
            ? ((row.units / totalUnits) * 100).toFixed(1) + "%"
            : "--";
        falloutBreakdown.push({
          label: row.category,
          values: [
            formatBusinessValue(row.units, "units"),
            formatBusinessValue(row.volume, "volume"),
            pct,
          ],
        });
      });
    }

    // Credit Pulls breakdown - shows all loans by type with credit activity
    const creditPullsTotal =
      typeof metricsData.credit_pulls?.value === "number"
        ? metricsData.credit_pulls.value
        : parseFloat(metricsData.credit_pulls?.value as string) || 0;

    const creditPullsData = getModalData("creditPulls");
    const creditPullsByLoanType = creditPullsData.byType.map(formatLoanMixRow);
    const creditPullsByLoanPurpose =
      creditPullsData.byPurpose.map(formatLoanMixRow);

    return {
      activeLoans: {
        summary: {
          // Use units/volume from KPI metrics (main cards), but weighted averages from filtered loan mix data
          units: formatBusinessValue(activeUnits, "units"),
          volume: formatBusinessValue(activeVolume, "volume"),
          avgInterestRate:
            activeStats.avgRate !== null
              ? formatBusinessValue(activeStats.avgRate, "rate")
              : "--",
          avgBalance:
            activeStats.avgBalance !== null && activeStats.avgBalance > 0
              ? formatBusinessValue(activeStats.avgBalance, "balance")
              : "--",
          avgFICO:
            activeStats.avgFico !== null
              ? formatBusinessValue(activeStats.avgFico, "fico")
              : "--",
          avgLTV:
            activeStats.avgLtv !== null
              ? formatBusinessValue(activeStats.avgLtv, "ltv")
              : "--",
        },
        byLoanType: activeByLoanType,
        byLoanPurpose: activeByLoanPurpose,
        byLoanSize: activeByLoanSize,
        byStage: activeByStage,
      },
      closedLoans: {
        summary: {
          units: formatBusinessValue(closedUnits, "units"),
          volume: formatBusinessValue(closedVolume, "volume"),
          avgInterestRate:
            closedStats.avgRate !== null
              ? formatBusinessValue(closedStats.avgRate, "rate")
              : "--",
          avgBalance:
            closedStats.avgBalance !== null && closedStats.avgBalance > 0
              ? formatBusinessValue(closedStats.avgBalance, "balance")
              : "--",
          avgFICO:
            closedStats.avgFico !== null
              ? formatBusinessValue(closedStats.avgFico, "fico")
              : "--",
          avgLTV:
            closedStats.avgLtv !== null
              ? formatBusinessValue(closedStats.avgLtv, "ltv")
              : "--",
        },
        byLoanType: closedByLoanType,
        byLoanPurpose: closedByLoanPurpose,
        byLoanSize: closedByLoanSize,
      },
      lockedLoans: {
        summary: {
          units: formatBusinessValue(lockedUnits, "units"),
          volume: formatBusinessValue(lockedVolume, "volume"),
          avgInterestRate:
            lockedStats.avgRate !== null
              ? formatBusinessValue(lockedStats.avgRate, "rate")
              : "--",
          avgBalance:
            lockedStats.avgBalance !== null && lockedStats.avgBalance > 0
              ? formatBusinessValue(lockedStats.avgBalance, "balance")
              : "--",
          avgFICO:
            lockedStats.avgFico !== null
              ? formatBusinessValue(lockedStats.avgFico, "fico")
              : "--",
          avgLTV:
            lockedStats.avgLtv !== null
              ? formatBusinessValue(lockedStats.avgLtv, "ltv")
              : "--",
        },
        byLoanType: lockedByLoanType,
        byLoanPurpose: lockedByLoanPurpose,
        byExpirationDays: lockedByExpirationDays,
      },
      cycleTime: {
        avgDaysToFunding:
          avgDaysToFunding > 0
            ? formatBusinessValue(avgDaysToFunding, "days")
            : "--",
        byStage: cycleTimeByStage,
        byLoanType: cycleTimeByLoanType,
      },
      pullThrough: {
        avgPercent:
          pullThroughPercent > 0
            ? formatBusinessValue(pullThroughPercent, "percent")
            : "--",
        totalCompleted: pullThroughModalData?.pullThroughByLoanType?.reduce(
          (sum, r) => sum + r.historicalCount, 0
        ) ?? 0,
        totalFallout: pullThroughModalData?.withdrawnByType?.reduce(
          (sum, r) => sum + r.units, 0
        ) ?? 0,
        byLoanType: pullThroughByLoanType,
        falloutBreakdown: falloutBreakdown,
      },
      creditPulls: {
        byLoanType: creditPullsByLoanType,
        byLoanPurpose: creditPullsByLoanPurpose,
      },
    };
  };

  // Memoize business overview data to prevent recalculation on every render
  const businessOverviewData = useMemo(() => {
    return calculateBusinessOverviewData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metricsData, kpiTimeframes, modalLoanMixData, cycleTimeStageData, cycleTimeByTypeData, pullThroughModalData]);

  const metricsHeaders = [
    "Units",
    "$ Volume",
    "Avg Rate",
    "Avg Bal",
    "FICO",
    "LTV",
  ];
  const cycleTimeHeaders = ["Avg Days", "Target", "Variance"];
  const cycleTypeHeaders = ["Avg Days", "Trend", "Status"];
  const pullThroughHeaders = ["Rate", "Co. Avg", "Variance", "Loans", "Status"];
  const falloutBreakdownHeaders = ["Units", "Volume", "% of Fallout"];
  const creditPullHeaders = ["MTD", "Last Mo."];

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
              title: "By Loan Type",
              headers: metricsHeaders,
              rows: businessOverviewData.lockedLoans.byLoanType,
            },
            {
              title: "By Loan Purpose",
              headers: metricsHeaders,
              rows: businessOverviewData.lockedLoans.byLoanPurpose,
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
          subtitle: `${businessOverviewData.pullThrough.avgPercent} • ${timeframeLabel}`,
          color: "bg-rose-50",
          borderColor: "border-rose-200",
          accentColor: "text-rose-600",
          sections: [
            {
              title: "Summary",
              headers: ["Pull-Through Rate", "Completed Loans", "Withdrawn/Fallout"],
              summaryData: {
                rate: businessOverviewData.pullThrough.avgPercent,
                completed: businessOverviewData.pullThrough.totalCompleted.toLocaleString(),
                fallout: businessOverviewData.pullThrough.totalFallout.toLocaleString(),
              },
            },
            {
              title: "By Loan Type",
              headers: pullThroughHeaders,
              rows: businessOverviewData.pullThrough.byLoanType,
            },
            {
              title: "Fallout Breakdown (Withdrawn)",
              headers: falloutBreakdownHeaders,
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
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.24)] p-4 sm:p-6 md:p-8">
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
        </div>

        {/* KPI Cards Grid - 2 rows on large screens */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 gap-3 sm:gap-4">
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
                  <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-3 md:py-4 pr-16 sm:pr-16 md:pr-16 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2 flex-shrink-0 bg-slate-50 dark:bg-slate-800/50 relative sticky top-0 backdrop-blur-sm">
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
                    <button
                      onClick={() => exportKpiLoanDetail(selectedCard!)}
                      disabled={exportingKpi === selectedCard}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 shadow-sm"
                      title="Export individual loan detail as CSV"
                    >
                      {exportingKpi === selectedCard ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span className="hidden sm:inline">
                        {exportingKpi === selectedCard ? "Exporting..." : "Export Loan Detail"}
                      </span>
                      <span className="sm:hidden">
                        {exportingKpi === selectedCard ? "..." : "Export"}
                      </span>
                    </button>
                  </div>

                  {/* Modal Content - Mobile First */}
                  <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 md:py-6 overflow-y-auto space-y-3 sm:space-y-4 md:space-y-6 flex-1 min-h-0">
                    {modalContent.sections.map((section, idx) => (
                      <div key={idx} className="w-full">
                        <h3 className="text-[10px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 sm:mb-3 uppercase tracking-wider">
                          {section.title}
                        </h3>

                        {/* Summary Row (if exists) - Mobile First */}
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
                                  {Object.values(section.summaryData)[i]}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Data Table (if rows exist) */}
                        {section.rows && (
                          <div className="bg-slate-50 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700 p-2 sm:p-2.5 md:p-3 w-full">
                            {(modalLoanMixData[selectedCard]?.loading &&
                              section.rows.length === 0) ||
                            (selectedCard === "cycleTime" &&
                              section.title === "Time By Stage" &&
                              cycleTimeStageLoading) ||
                            (selectedCard === "cycleTime" &&
                              section.title === "By Loan Type" &&
                              cycleTimeByTypeLoading) ||
                            (selectedCard === "pullThrough" &&
                              section.title === "By Loan Type" &&
                              pullThroughModalLoading) ||
                            (selectedCard === "pullThrough" &&
                              section.title === "Fallout Breakdown" &&
                              pullThroughModalLoading) ? (
                              <div className="flex items-center justify-center py-8">
                                <div className="flex items-center gap-2 text-slate-500">
                                  <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                                  <span className="text-sm">
                                    Loading breakdown data...
                                  </span>
                                </div>
                              </div>
                            ) : section.rows.length === 0 ? (
                              <div className="flex items-center justify-center py-6 text-slate-400 text-sm">
                                No breakdown data available
                              </div>
                            ) : (
                              <BusinessDataTable
                                headers={section.headers}
                                rows={section.rows}
                              />
                            )}
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
