import {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  memo,
  useDeferredValue,
} from "react";
import { useJobStatus } from "@/hooks/useJobStatus";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BarChart3,
  TrendingUp,
  Play,
  Table,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  ChevronDown,
} from "lucide-react";
import { DashboardCard } from "./DashboardCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useMetrics } from "@/hooks/useMetrics";
import { useLoanFavorites } from "@/hooks/useLoanFavorites";
import { LoanCardsContainer, type TabType, type LoanFalloutStatus } from "./LoanCardsContainer";
import {
  getZoneFromReasonCodes,
  type ReasonCodeEntry,
  getZoneColorClass,
} from "./LoanRiskDistribution";
import { LoanDrilldownModal } from "./LoanDrilldownModal";
import { LoanOfficerModal } from "./LoanOfficerModal";
import { useTheme } from "@/components/theme-provider";
import { api } from "@/lib/api";
import { ClosingFalloutMetricModal } from "@/components/dashboard/modals/ClosingFalloutMetricModal";
import {
  OutcomeLoansModal,
  type OutcomeModalType,
} from "@/components/dashboard/modals/OutcomeLoansModal";
import { LoanRiskDetailModal } from "@/components/dashboard/modals/LoanRiskDetailModal";
import {
  PeriodValue,
  getLoanAmountNumber,
  isDateInPeriod,
  isFundedInPeriod,
  getPeriodRange,
  inferLoanStatus,
} from "@/utils/closingFalloutFilters";
import {
  transformLoanToCard,
  aggregateLoanOfficers,
} from "@/utils/loanDataTransform";
import { ExportMenu } from "@/components/common/ExportMenu";
import type { ExportData } from "@/utils/exportUtils";
import { useAuth } from "@/contexts/AuthContext";

interface ClosingFalloutForecastProps {
  dateFilter?: "today" | "mtd" | "ytd" | "custom";
  selectedTenantId?: string | null;
  /** Optional channel filter - filters forecast data to loans in the selected channel */
  selectedChannel?: string | null;
  openLoanId?: string;
  onOpenLoanIdHandled?: () => void;
}

interface FalloutAlertConfigState {
  enabled: boolean;
  min_risk_score: number;
  frequency: "realtime" | "daily_digest" | "weekly_digest";
  include_risk_levels: string[];
  custom_message: string | null;
  notify_managers: boolean;
  target_encompass_user_ids: string[];
  manager_user_ids: string[];
}

interface FalloutAlertResponseRow {
  id: string;
  alert_batch_id: string;
  loan_id: string;
  loan_number: string | null;
  loan_officer: string | null;
  recipient_email: string | null;
  response: "acknowledged" | "working_on_it" | "need_help";
  responded_at: string;
}

interface FalloutRecipientLoanOfficer {
  encompass_user_id: string;
  display_name: string;
  email: string;
  active_loan_count: number;
}

interface FalloutRecipientManager {
  id: string;
  display_name: string;
  email: string;
  role: string;
}

const parseManualTestEmails = (rawInput: string): string[] =>
  Array.from(
    new Set(
      rawInput
        .split(/[\n,;]+/)
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

const normalizeRawStatus = (raw: unknown): string =>
  (raw ?? "").toString().trim().toUpperCase();

type ForecastStatus =
  | "Active"
  | "Closed"
  | "Withdrawn"
  | "Denied"
  | "Locked"
  | null;

const hasAnyValue = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  return true;
};

// Global guard: only one POST /api/predictions at a time across all component instances
// (Dashboard + Workbench widget can both mount ClosingFalloutForecast; each has its own ref)
let predictionInFlightGlobal = false;

/** Claim the global prediction lock. Returns true if we got it, false if another instance already has it. */
function claimPredictionLock(): boolean {
  if (predictionInFlightGlobal) return false;
  predictionInFlightGlobal = true;
  return true;
}

// Helper to extract status from loan (checks both top-level and raw_data)
const getLoanStatus = (loan: any): string | null => {
  // Check top-level fields first (both snake_case from API and other variants)
  let status =
    loan?.current_loan_status ?? // snake_case from /api/loans
    loan?.["Current Loan Status"] ??
    loan?.["Fields.1393"] ??
    loan?.status ??
    null;

  // Always check raw_data as well (it might have the status even if top-level doesn't)
  if (loan?.raw_data) {
    let rawData = loan.raw_data;
    if (typeof rawData === "string") {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = null;
      }
    }
    if (rawData && typeof rawData === "object") {
      // Prefer raw_data status if top-level status is not found or is generic
      const rawStatus =
        rawData["Current Loan Status"] ??
        rawData.current_loan_status ??
        rawData["Loan Status"] ??
        rawData.loan_status ??
        rawData["Fields.1393"] ??
        rawData.status ??
        null;

      // Use raw_data status if we don't have a top-level status, or if top-level is generic
      if (
        !status ||
        (status && !loan?.["Current Loan Status"] && !loan?.["Fields.1393"])
      ) {
        status = rawStatus || status;
      }
    }
  }

  return status;
};

// Fallout-specific status mapper (scoped to this component only)
// Status buckets are mutually exclusive; "locked" is treated as an additional flag (see `isLockedForForecast`).
const mapForecastStatus = (loan: any): Exclude<ForecastStatus, "Locked"> => {
  // Use the same status extraction helper that checks both top-level and raw_data
  const preferred = getLoanStatus(loan);

  const s = normalizeRawStatus(preferred);

  // Explicitly exclude purchased loans from fallout calculations
  if (s === "LOAN PURCHASED BY YOUR INSTITUTION") return null;

  if (s === "ACTIVE LOAN") return "Active";
  if (s === "LOAN ORIGINATED") return "Closed";

  if (
    s === "APPLICATION DENIED" ||
    s === "PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION"
  )
    return "Denied";

  if (
    s === "APPLICATION WITHDRAWN" ||
    s === "APPLICATION APPROVED BUT NOT ACCEPTED" ||
    s === "FILE CLOSED FOR INCOMPLETENESS" ||
    s === "PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED"
  )
    return "Withdrawn";

  // Default bucket: Active so we don't drop unknown-but-live pipeline items
  return "Active";
};

// Helper to check if loan has "Active Loan" status (for Active Loans Today metric)
// IMPORTANT: This MUST match the server-side METRICS_CATALOG.active_loans definition exactly:
//   current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND (is_archived IS DISTINCT FROM TRUE)
// Do NOT use getLoanStatus() here because it has fallbacks that inflate the count
const isActiveLoan = (loan: any): boolean => {
  if (loan?.is_archived === true) return false;
  const status = loan?.current_loan_status;
  if (!status) return false;
  const normalized = normalizeRawStatus(status);
  return normalized === "ACTIVE LOAN";
};

// Helper to check if loan is funded (for Funded Loans metric)
// Funded = Current Loan Status = "Loan Originated" OR fund_date is not blank
const isFundedLoan = (loan: any): boolean => {
  // Check if fund_date exists and is not blank (check both top-level and raw_data)
  let fundDate =
    loan?.fund_date || loan?.["Fund Date"] || loan?.["Funding Date"];

  // If not found, check raw_data
  if (!hasAnyValue(fundDate) && loan?.raw_data) {
    let rawData = loan.raw_data;
    if (typeof rawData === "string") {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = null;
      }
    }
    if (rawData && typeof rawData === "object") {
      fundDate =
        rawData.fund_date ??
        rawData["Fund Date"] ??
        rawData["Funding Date"] ??
        rawData.funding_date ??
        null;
    }
  }

  if (hasAnyValue(fundDate)) {
    return true;
  }

  // Check if Current Loan Status = "Loan Originated"
  const status = getLoanStatus(loan);
  const s = normalizeRawStatus(status);
  return s === "LOAN ORIGINATED";
};

const getForecastLockDate = (loan: any): unknown => {
  // Support multiple possible field names / LOS mappings
  return (
    loan?.lock_date ??
    loan?.["Lock Date"] ??
    loan?.["Trans Details Lock Date"] ??
    loan?.["761"]
  );
};

const getApplicationDate = (loan: any): string | null | undefined => {
  // Support multiple possible field names for application date
  return (
    loan?.application_date ??
    loan?.["Application Date"] ??
    loan?.app_date ??
    loan?.["App Date"] ??
    loan?.created_at
  );
};

const isLockedForForecast = (loan: any): boolean => {
  const baseStatus = mapForecastStatus(loan);
  if (baseStatus !== "Active") return false;
  return hasAnyValue(getForecastLockDate(loan));
};

const daysSinceLocal = (
  dateIso: string | null | undefined,
  now: Date = new Date(),
): number | null => {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
};

/**
 * Determines if an active loan is likely to close late.
 * Uses the server-computed closeLateRisk field (from historical on-time analysis + pipeline stage).
 * Falls back to checking estimated_closing_date if the server field isn't present.
 */
const isLikelyCloseLateForecast = (
  loan: any,
  thresholdDays: number = 30,
  now: Date = new Date(),
): boolean => {
  const status = mapForecastStatus(loan);
  if (!status || status !== "Active") return false;

  // Primary: use server-computed close-late risk (from prediction API)
  if (loan?.closeLateRisk != null) {
    return loan.closeLateRisk === true;
  }

  // Fallback: check estimated_closing_date (the actual DB field name)
  const expectedCloseDate =
    loan?.estimated_closing_date ||
    loan?.estimatedClosingDate ||
    loan?.expected_close_date;

  if (expectedCloseDate) {
    const expected = new Date(expectedCloseDate);
    if (!Number.isNaN(expected.getTime())) {
      const daysPastExpected = Math.floor(
        (now.getTime() - expected.getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysPastExpected > 3;
    }
  }

  // Last resort: loan has been in pipeline too long
  const days = daysSinceLocal(loan?.application_date, now);
  return days !== null && days > thresholdDays;
};

// Hook for animating numbers (from BusinessOverviewSection.tsx)
const useCountUp = (
  endValue: number,
  duration: number = 1500,
  delay: number = 0,
  startAnimation: boolean = true,
) => {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!startAnimation) return;

    // Reset timing refs when endValue changes to ensure fresh animation
    startTimeRef.current = null;

    // Cancel any existing animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTimeRef.current) startTimeRef.current = timestamp;
        const progress = Math.min(
          (timestamp - startTimeRef.current) / duration,
          1,
        );

        // Easing function for smooth animation
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        countRef.current = Math.floor(easeOutQuart * endValue);
        setCount(countRef.current);

        if (progress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          setCount(endValue);
          animationFrameRef.current = null;
        }
      };

      animationFrameRef.current = requestAnimationFrame(animate);
    }, delay);

    return () => {
      clearTimeout(timeout);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [endValue, duration, delay, startAnimation]);

  return count;
};

const PeriodDropdown: React.FC<{
  period: PeriodValue;
  onPeriodChange: (p: PeriodValue) => void;
  availableYears: number[];
  isDarkMode: boolean;
}> = memo(({ period, onPeriodChange, availableYears, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const options: Array<{ value: PeriodValue; label: string }> = [
    { value: "all", label: "All Time" },
    { value: "mtd", label: "Month to Date" },
    { value: "last_month", label: "Last Month" },
    { value: "ytd", label: "Year to Date" },
    { value: "last_year", label: "Last Year" },
    ...availableYears.map((y) => ({
      value: y.toString(),
      label: y.toString(),
    })),
  ];

  const currentLabel =
    options.find((o) => o.value === period)?.label || "All Time";

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl border text-xs sm:text-sm font-medium transition-all touch-manipulation ${
          isDarkMode
            ? "bg-slate-800 border-white/10 text-slate-200 hover:border-blue-500/50 active:bg-slate-700"
            : "bg-white border-slate-200 text-slate-700 hover:border-slate-300 shadow-sm active:bg-slate-50"
        }`}
      >
        <span className="truncate max-w-[110px] sm:max-w-none">
          {currentLabel}
        </span>
        <svg
          className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform flex-shrink-0 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <div
          className={`absolute top-full right-0 mt-2 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border shadow-xl z-50 min-w-[170px] max-h-[60vh] overflow-y-auto ${
            isDarkMode
              ? "bg-slate-800 border-white/10"
              : "bg-white border-slate-200"
          }`}
        >
          {options.map((opt) => (
            <button
              key={String(opt.value)}
              onClick={() => {
                onPeriodChange(opt.value);
                setIsOpen(false);
              }}
              className={`w-full px-3 sm:px-4 py-2.5 sm:py-2 text-left text-xs sm:text-sm flex items-center gap-2 sm:gap-3 transition-colors touch-manipulation ${
                isDarkMode
                  ? "hover:bg-slate-700 active:bg-slate-600 text-slate-200"
                  : "hover:bg-slate-50 active:bg-slate-100 text-slate-700"
              }`}
            >
              <span
                className={`w-4 ${
                  period === opt.value ? "text-blue-500" : "opacity-0"
                }`}
              >
                {period === opt.value && "✓"}
              </span>
              <span className={period === opt.value ? "font-medium" : ""}>
                {opt.label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

PeriodDropdown.displayName = "PeriodDropdown";

// Active Loans Period Dropdown - filters active loans by application date
const ACTIVE_LOANS_PERIOD_OPTIONS: Array<{
  value: PeriodValue | undefined;
  label: string;
}> = [
  { value: undefined, label: "All Time" },
  { value: "rolling_3_months", label: "3 Months" },
  { value: "rolling_6_months", label: "6 Months" },
  { value: "rolling_12_months", label: "12 Months" },
  { value: "rolling_18_months", label: "18 Months" },
];

const ActiveLoansPeriodDropdown: React.FC<{
  period: PeriodValue | undefined;
  onPeriodChange: (p: PeriodValue | undefined) => void;
  isDarkMode: boolean;
}> = memo(({ period, onPeriodChange, isDarkMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const currentLabel =
    ACTIVE_LOANS_PERIOD_OPTIONS.find((o) => o.value === period)?.label ??
    "All Time";

  return (
    <div ref={dropdownRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs font-medium uppercase tracking-wider rounded-md border transition-colors ${
          isDarkMode
            ? "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
        }`}
        title="Filter active loans by application date"
      >
        <span className="text-slate-500 dark:text-slate-400">Active:</span>
        {currentLabel}
        <svg
          className={`w-3 h-3 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>
      {isOpen && (
        <div
          className={`absolute right-0 mt-1 w-36 rounded-md shadow-lg z-50 ${
            isDarkMode
              ? "bg-slate-800 border border-slate-700"
              : "bg-white border border-slate-200"
          }`}
        >
          <div className="py-1">
            {ACTIVE_LOANS_PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onPeriodChange(opt.value);
                  setIsOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-xs ${
                  period === opt.value
                    ? isDarkMode
                      ? "bg-blue-600/20 text-blue-400"
                      : "bg-blue-50 text-blue-700"
                    : isDarkMode
                      ? "text-slate-300 hover:bg-slate-700"
                      : "text-slate-700 hover:bg-slate-50"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});

ActiveLoansPeriodDropdown.displayName = "ActiveLoansPeriodDropdown";

/** Session-only cache key for metrics (period string). Cleared on loans/predictions change or page refresh. */
const PERIODS_TO_PRECOMPUTE: PeriodValue[] = [
  "all",
  "mtd",
  "ytd",
  "last_month",
  "last_year",
];

function computeMetricsFromLoans(
  loans: any[],
  period: PeriodValue,
  now: Date,
  statsData: {
    pullThroughRate?: number;
    avgCycleTime?: number;
    active?: number;
    activeVolume?: number;
    locked?: number;
    closed?: number;
    totalVolume?: number;
  } | null,
  predictions: {
    likelyWithdraw: number;
    likelyDecline: number;
    predictedFalloutTotal: number;
  } | null,
  // Pull-through rate from useMetrics (rolling 90 days) - matches ExecutiveDashboard
  metricsBasedPullThroughRate?: number,
  // Active loans period filter - filters which active loans are included (by application date)
  activeLoansPeriodFilter?: PeriodValue,
  // Server-side active loans count (from /api/loans/active-loans-count endpoint)
  // This is the authoritative count with proper date filtering applied in SQL
  serverActiveLoans?: { count: number; volume: number },
  // Bucketed loans from predict API (have riskSummary.predictedOutcome). When provided with activeLoansPeriodFilter,
  // Likely Withdraw and Likely Decline are computed from this set filtered by application date (same logic as Active Loans Today).
  bucketedLoans?: any[],
): {
  activeLoansToday: number;
  closedLoansMTD: number;
  predictedClosing: number;
  likelyCloseLate: number;
  pastEstClose: number;
  likelyWithdraw: number;
  likelyDecline: number;
  predictedFalloutTotal: number;
  pipelineValueM: string;
  pullThroughRateDisplay: number;
  falloutRate: number;
  lockedLoans: number;
  lockedRolling90: number;
  avgCycleTime: number;
  pipelineValue: number;
} {
  // PERFORMANCE: Single-pass aggregation instead of multiple .filter() calls
  // This reduces O(n * m) to O(n) where m is the number of metrics

  // Counters for single-pass computation
  let activeCount = 0;
  let activePipelineValue = 0;
  let likelyCloseLateCount = 0;
  let pastEstCloseCount = 0; // Active loans past their estimated closing date
  let fundedInPeriodCount = 0;
  let fundedTotalByStatus = 0; // Count funded loans by status (for 'all' period fallback)
  let startedInPeriodCount = 0;
  let lockedCount = 0; // All active loans with lock dates (snapshot)
  let lockedInPeriodCount = 0; // Active loans with lock dates that pass the period filter

  // Single pass through all loans
  for (let i = 0; i < loans.length; i++) {
    const loan = loans[i];
    const status = mapForecastStatus(loan);
    const appDate = getApplicationDate(loan);

    // Check if active using strict isActiveLoan check (current_loan_status = 'Active Loan' AND has application_date)
    // This matches the server-side METRICS_CATALOG.active_loans definition exactly:
    //   current_loan_status = 'Active Loan' AND application_date IS NOT NULL AND application_date::text != ''
    // IMPORTANT: Use loan.application_date directly here, NOT getApplicationDate() which has fallbacks
    const strictAppDate = loan?.application_date;
    const hasStrictAppDate =
      strictAppDate != null && String(strictAppDate).trim() !== "";

    if (isActiveLoan(loan) && hasStrictAppDate) {
      // Apply active loans period filter if specified (filters by application date range)
      const passesActivePeriodFilter =
        !activeLoansPeriodFilter ||
        isDateInPeriod(strictAppDate, activeLoansPeriodFilter, now);

      // Check if this active loan has a lock date (regardless of period filter)
      const hasLockDate = hasAnyValue(getForecastLockDate(loan));
      if (hasLockDate) {
        lockedCount++;
      }

      if (passesActivePeriodFilter) {
        activeCount++;
        activePipelineValue += getLoanAmountNumber(loan);

        // Past est. close: only count active loans past ECD that fall within the active period filter (same as other KPIs)
        const estClose =
          loan?.estimated_closing_date || loan?.estimatedClosingDate;
        if (estClose) {
          const estCloseDate = new Date(estClose);
          if (!Number.isNaN(estCloseDate.getTime()) && estCloseDate < now) {
            pastEstCloseCount++;
          }
        }

        // Check if likely close late (only for active loans)
        if (isLikelyCloseLateForecast(loan, 30, now)) {
          likelyCloseLateCount++;
        }

        // Count locked active loans within the period filter
        if (hasLockDate) {
          lockedInPeriodCount++;
        }
      }
    }

    // Count total funded loans by status (for 'all' period - doesn't require closing_date field)
    if (status === "Closed") {
      fundedTotalByStatus++;
    }

    // Check if funded in period (historical metric - requires closing_date field for date filtering)
    if (isFundedInPeriod(loan, period, now)) {
      fundedInPeriodCount++;
    }

    // Check if application started in period (for pull-through calculation)
    if (appDate && isDateInPeriod(appDate, period, now)) {
      startedInPeriodCount++;
    }
  }

  // ======== SNAPSHOT METRICS (current pipeline state) ========

  // Active Loans Today:
  // Use server-side count from /api/loans/active-loans-count endpoint.
  // This endpoint applies the date filter in SQL, giving us accurate counts.
  // If serverActiveLoans is provided, use it. Otherwise fall back to statsData.active (all-time).
  let activeLoansToday: number;
  let pipelineValue: number;

  if (serverActiveLoans && serverActiveLoans.count > 0) {
    // Use the server-provided count (with date filter already applied in SQL)
    activeLoansToday = serverActiveLoans.count;
    pipelineValue = serverActiveLoans.volume;
  } else if (statsData?.active) {
    // Fallback to statsData.active (all-time count from /api/loans/stats)
    activeLoansToday = statsData.active;
    pipelineValue = statsData.activeVolume ?? activePipelineValue;
  } else {
    // Last resort: use client-side count (only if no server data available)
    activeLoansToday = activeCount;
    pipelineValue = activePipelineValue;
  }
  const pipelineValueM =
    pipelineValue > 0 ? (pipelineValue / 1000000).toFixed(1) : "0";

  // Predicted Fallout - from AI predictions (applies to current active pipeline)
  // When bucketedLoans and activeLoansPeriodFilter are set, use same filter as Active Loans Today (by application date)
  let likelyWithdraw = predictions?.likelyWithdraw ?? 0;
  let likelyDecline = predictions?.likelyDecline ?? 0;
  if (
    bucketedLoans &&
    bucketedLoans.length > 0 &&
    activeLoansPeriodFilter
  ) {
    const inPeriod = bucketedLoans.filter((l: any) => {
      const appDate = getApplicationDate(l);
      return appDate && isDateInPeriod(appDate, activeLoansPeriodFilter, now);
    });
    likelyWithdraw = inPeriod.filter(
      (l: any) => l?.riskSummary?.predictedOutcome === "withdraw",
    ).length;
    likelyDecline = inPeriod.filter(
      (l: any) => l?.riskSummary?.predictedOutcome === "deny",
    ).length;
  }
  const predictedFalloutTotal =
    bucketedLoans &&
    bucketedLoans.length > 0 &&
    activeLoansPeriodFilter
      ? likelyWithdraw + likelyDecline
      : (predictions?.predictedFalloutTotal ?? likelyWithdraw + likelyDecline);

  // Fallout rate - relative to current active pipeline
  const falloutRate =
    activeLoansToday > 0
      ? Math.round((predictedFalloutTotal / activeLoansToday) * 100)
      : 0;

  // ======== HISTORICAL METRICS (filtered by period) ========

  // Pull-through rate: Uses rolling 90 days and excludes active loans
  // This is the industry-standard methodology - only count completed loan journeys
  // MTD/YTD is inappropriate because loans take 30-45+ days to close on average
  const rolling90DaysPeriod: PeriodValue = "rolling_90_days";

  // Filter to inactive loans only (completed journeys)
  const inactiveLoans = loans.filter((l) => {
    const status = inferLoanStatus(l);
    return status !== "Active" && status !== "Locked";
  });

  // Count loans started in rolling 90 days
  const startedInRolling = inactiveLoans.filter((l) => {
    const appDate = getApplicationDate(l);
    return appDate && isDateInPeriod(appDate, rolling90DaysPeriod, now);
  });

  // Pull-through rate: ALWAYS prefer the server-side value from useMetrics (matches ExecutiveDashboard)
  // This ensures consistency with the Pull-Through KPI shown elsewhere in the app.
  // Only fall back to client-side calculation if no server-side value is available.
  // Fallback order: 1) metricsBasedPullThroughRate (from useMetrics, matches ExecutiveDashboard)
  //                 2) statsData?.pullThroughRate (from /api/loans/stats)
  //                 3) Client-side calculation from loan data
  //                 4) 0 (no data available)
  const pullThroughRate =
    metricsBasedPullThroughRate ||
    statsData?.pullThroughRate ||
    (startedInRolling.length > 0
      ? (inactiveLoans.filter((l) => {
          const appDate = getApplicationDate(l);
          const hasClosedDate =
            l?.closing_date ||
            l?.funding_date ||
            l?.fund_date ||
            l?.["Closing Date"];
          return (
            appDate &&
            isDateInPeriod(appDate, rolling90DaysPeriod, now) &&
            hasClosedDate
          );
        }).length /
          startedInRolling.length) *
        100
      : 0);

  const pullThroughRateDisplay =
    pullThroughRate > 0 ? Math.round(pullThroughRate) : 0;

  // Predicted Closing = Active Loans Today − (Likely Withdraw + Likely Decline)
  const predictedClosing = Math.max(
    0,
    activeLoansToday - (likelyWithdraw + likelyDecline),
  );

  // Locked loans - active loans with lock dates, filtered by period
  // For 'all' period: count all active loans with lock dates
  // For filtered periods: count active loans with lock dates that pass the application date filter
  const lockedLoans = period === "all" ? lockedCount : lockedInPeriodCount;

  // Funded/Closed loans - IMPORTANT: Use statsData?.closed for 'all' period
  // This ensures it matches ExecutiveDashboard's "Closed Loans" metric
  // For 'all' period: prefer statsData?.closed, then fundedTotalByStatus (counts by loan status), then fundedInPeriodCount
  // For other periods: use fundedInPeriodCount (filtered by closing_date field)
  const closedLoansMTD =
    period === "all"
      ? (statsData?.closed ?? fundedTotalByStatus ?? fundedInPeriodCount)
      : fundedInPeriodCount;

  // Average cycle time (from statsData or default)
  const avgCycleTime = statsData?.avgCycleTime ?? 24;

  // For rolling 90-day locks, just use the total locked active count
  const lockedRolling90Value = lockedCount;

  return {
    activeLoansToday,
    closedLoansMTD,
    predictedClosing,
    likelyCloseLate: likelyCloseLateCount,
    pastEstClose: pastEstCloseCount,
    likelyWithdraw,
    likelyDecline,
    predictedFalloutTotal,
    pipelineValueM,
    pullThroughRateDisplay,
    falloutRate,
    lockedLoans,
    lockedRolling90: lockedRolling90Value,
    avgCycleTime,
    pipelineValue,
  };
}

// Get metric explanation for tooltips
const getMetricExplanation = (label: string) => {
  if (label.startsWith("Funded Loans")) {
    return {
      title: "Production Output",
      desc: "Total number of loans successfully funded and closed in the selected period. Key revenue driver and operational efficiency metric.",
    };
  }
  switch (label) {
    case "Active Loans Today":
      return {
        title: "Active Pipeline Volume",
        desc: "Total number of loans currently in the production pipeline across all stages—from application through closing.",
      };
    case "Predicted Fallout":
      return {
        title: "Forecasted Leakage",
        desc: "AI-calculated estimate of loan volume that will fail to fund based on real-time behavior signals and market conditions.",
      };
    case "High Risk":
      return {
        title: "High Risk Loans",
        desc: "Predicted withdraw or decline with risk score ≥ 80/100. Count is shown as High Risk # of # fallout (fallout = predicted withdraw + predicted decline). Click to see the list sorted by risk score.",
      };
    case "Predicted Closing":
      return {
        title: "Closing Forecast",
        desc: "Active loans minus those likely to withdraw or decline. Equals Active Loans Today − (Likely Withdraw + Likely Decline).",
      };
    case "Likely Withdraw":
      return {
        title: "Borrower Says No",
        desc: "Buyer decision - borrower is rate shopping, experiencing buyer's remorse, or choosing a competitor.",
      };
    case "Likely Decline":
      return {
        title: "Lender Says No",
        desc: "Lender decision - loan failing underwriting criteria, credit issues, or documentation requirements.",
      };
    case "Past Est. Close":
      return {
        title: "Past Estimated Closing",
        desc: "Active loans whose estimated closing date has already passed. These need immediate attention.",
      };
    case "Likely Close Late":
      return {
        title: "Pipeline Stagnation",
        desc: "Active loans predicted to close late based on pipeline stage, estimated closing date, and historical on-time closing rates. Click to see details.",
      };
    default:
      return {
        title: label,
        desc: "Standardized performance metric for portfolio monitoring.",
      };
  }
};

/**
 * Closing & Fallout Forecast Component
 * Displays predictive analytics for loan closings and fallout risk
 */
export const ClosingFalloutForecast = ({
  dateFilter = "mtd",
  selectedTenantId,
  selectedChannel,
  openLoanId,
  onOpenLoanIdHandled,
}: ClosingFalloutForecastProps) => {
  const { user } = useAuth();
  const isPlatformAdmin = user?.role === "super_admin" || user?.role === "platform_admin";
  const canManageFalloutAlerts = [
    "tenant_admin",
    "super_admin",
    "platform_admin",
  ].includes(user?.role || "");
  const forecastRef = useRef<HTMLDivElement>(null);
  const criticalLoansSectionRef = useRef<HTMLElement>(null);
  // ============================================================================
  // TESTING FLAG: Signal Strength Buckets Table
  // Set to true to display the loan signal strength buckets table
  // Set to false to hide it (for production or when not needed)
  // ============================================================================
  const SHOW_SIGNAL_BUCKETS_TABLE = false;
  // ============================================================================

  const { statsData, statsLoading, funnelData } = useDashboardStats(
    dateFilter,
    2025,
    selectedTenantId,
  );
  // Channel filtering is now passed through useMetrics to filter data by selected channel
  const { queryMetrics } = useMetrics(
    selectedTenantId,
    undefined,
    selectedChannel,
  );
  const [isAnimating, setIsAnimating] = useState(true);
  const [insightsTab, setInsightsTab] = useState<"critical" | "officers">("critical");
  const [criticalOutcomeFilter, setCriticalOutcomeFilter] =
    useState<TabType>("all");
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
  const { theme } = useTheme();
  const { favoriteIds } = useLoanFavorites();
  const isDarkMode = theme === "dark";

  // State for locked loans fetched via useMetrics (rolling 90 days)
  const [lockedLoansRolling90, setLockedLoansRolling90] = useState<number>(0);
  // State for pull-through rate fetched via useMetrics (rolling 90 days)
  // This matches ExecutiveDashboard's approach for consistent values
  const [pullThroughRateFromMetrics, setPullThroughRateFromMetrics] =
    useState<number>(0);

  const [period, setPeriod] = useState<PeriodValue>("all");
  // PERFORMANCE: useDeferredValue defers expensive re-computation during rapid period changes
  // This allows the UI to remain responsive while metrics are recalculated in the background
  const deferredPeriod = useDeferredValue(period);
  const prevPeriodRef = useRef<PeriodValue>(period);

  // Active loans period filter - filters which active loans are included in fallout analysis
  // Options: undefined (all time), 3, 6, 12, 18 months (rolling from today)
  const [activeLoansPeriod, setActiveLoansPeriod] = useState<
    PeriodValue | undefined
  >("rolling_6_months");

  // Server-side active loans count with date filtering
  // This is fetched from /api/loans/active-loans-count endpoint
  const [serverActiveLoansCount, setServerActiveLoansCount] = useState<{
    count: number;
    volume: number;
    loading: boolean;
  }>({ count: 0, volume: 0, loading: true });

  // Session-scoped metrics cache: keyed by period, invalidated when loans, predictions, stats, pull-through rate, or active loans period change
  const metricsCacheRef = useRef<{
    cache: Map<string, ReturnType<typeof computeMetricsFromLoans>>;
    dataVersion: any[] | null;
    predictionsVersion: {
      likelyWithdraw: number;
      likelyDecline: number;
      predictedFalloutTotal: number;
    } | null;
    statsVersion: typeof statsData;
    pullThroughVersion: number;
    activeLoansPeriodVersion: PeriodValue | undefined;
    serverActiveLoansVersion: { count: number; volume: number } | null;
  }>({
    cache: new Map(),
    dataVersion: null,
    predictionsVersion: null,
    statsVersion: null,
    pullThroughVersion: 0,
    activeLoansPeriodVersion: undefined,
    serverActiveLoansVersion: null,
  });

  // Lazy loan loading (only when a tile modal is opened)
  const [loansRaw, setLoansRaw] = useState<any[] | null>(null);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState<string | null>(null);

  // AI prediction state (from document pipeline / fallout sequencer)
  const [predictions, setPredictions] = useState<{
    likelyWithdraw: number;
    likelyDecline: number;
    predictedFalloutTotal: number;
    likelyCloseLateCount?: number;
  } | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [predictionJobId, setPredictionJobId] = useState<string | null>(null);
  const predictionJob = useJobStatus(predictionJobId);
  const [bucketedLoans, setBucketedLoans] = useState<any[]>([]);
  // Store individual predictions to identify which loans are predicted to fallout
  const [loanPredictions, setLoanPredictions] = useState<
    Record<string, string>
  >({});
  // Store full prediction objects for LoanCardsContainer
  const [fullPredictions, setFullPredictions] = useState<
    Array<{
      loanId: string;
      predictedOutcome: "withdraw" | "deny" | "originate";
      confidence: number;
      reasoning?: string;
      riskFactors?: string[];
    }>
  >([]);

  // Pagination state for signal buckets table
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Modal state
  const [metricModalLabel, setMetricModalLabel] = useState<string | null>(null);
  const [outcomeModalType, setOutcomeModalType] =
    useState<OutcomeModalType | null>(null);
  const [selectedLoanForDetail, setSelectedLoanForDetail] = useState<
    any | null
  >(null);
  const [selectedLoanForDrilldown, setSelectedLoanForDrilldown] = useState<
    any | null
  >(null);

  // Loan officer name -> TTS (Top Tier Score) + tier for display on critical loan cards
  const [officerTtsMap, setOfficerTtsMap] = useState<
    Record<string, { ttsScore: number; tier: string }>
  >({});

  // Table sorting state
  const [sortColumn, setSortColumn] = useState<string>("riskScore");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");

  // Fallout alert status map: loan_id -> status (sent/response)
  const [falloutStatusMap, setFalloutStatusMap] = useState<Map<string, LoanFalloutStatus>>(new Map());

  const availableYears = useMemo(() => {
    // Prefer years from loaded loans (if available); otherwise provide a small recent range.
    const years = new Set<number>();
    if (loansRaw && loansRaw.length > 0) {
      loansRaw.forEach((l) => {
        const d = l?.application_date || l?.closing_date;
        if (!d) return;
        const dt = new Date(d);
        if (!Number.isNaN(dt.getTime())) years.add(dt.getFullYear());
      });
    }
    const now = new Date();
    if (years.size === 0) {
      for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--)
        years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [loansRaw]);

  const periodLabel = useMemo(() => {
    const map: Record<string, string> = {
      all: "All Time",
      mtd: "MTD",
      last_month: "Last Month",
      ytd: "YTD",
      last_year: "Last Year",
    };
    if (typeof period === "string" && /^\d{4}$/.test(period)) return period;
    return map[String(period)] || "All Time";
  }, [period]);

  // Calculate metrics from data (with session cache so switching periods is instant after first load)
  // PERFORMANCE: Uses deferredPeriod to allow UI to remain responsive during rapid period changes
  const metrics = useMemo(() => {
    const now = new Date();
    // High risk: predicted withdraw or deny only, with risk score >= 80 (excludes close-late)
    const HIGH_RISK_SCORE_THRESHOLD = 80;
    const isHighRiskLoan = (l: any) => {
      const score = l?.riskScore ?? 0;
      if (score < HIGH_RISK_SCORE_THRESHOLD) return false;
      const outcome = l?.riskSummary?.predictedOutcome;
      return outcome === "withdraw" || outcome === "deny";
    };
    // When activeLoansPeriod is set, restrict counts to loans whose application_date falls in that period (sync with Active filter)
    const bucketedLoansInPeriod =
      bucketedLoans && bucketedLoans.length > 0 && activeLoansPeriod
        ? bucketedLoans.filter((l: any) => {
            const appDate = getApplicationDate(l);
            return appDate && isDateInPeriod(appDate, activeLoansPeriod, now);
          })
        : bucketedLoans && bucketedLoans.length > 0
          ? bucketedLoans
          : null;

    const highRiskCount =
      bucketedLoansInPeriod && bucketedLoansInPeriod.length > 0
        ? bucketedLoansInPeriod.filter((l: any) => isHighRiskLoan(l)).length
        : bucketedLoans?.length > 0
          ? bucketedLoans.filter((l: any) => isHighRiskLoan(l)).length
          : 0;

    // Locked count from bucketed loans (snapshot metric — active loans with lock dates).
    // Bucketed loans include lock_date in essentialFields from prediction save.
    const bucketedLockedCount = (() => {
      if (!bucketedLoans || bucketedLoans.length === 0) return null;
      return bucketedLoans.filter((l: any) => {
        const lockDate =
          l?.lock_date ?? l?.["Lock Date"] ?? l?.["Trans Details Lock Date"];
        if (lockDate === null || lockDate === undefined) return false;
        if (typeof lockDate === "string") return lockDate.trim().length > 0;
        return true;
      }).length;
    })();

    // Helper: loan is past ECD (date-only, matches filter logic in LoanCardsContainer).
    const isPastEcd = (l: any) => {
      const estClose = l?.estimated_closing_date || l?.estimatedClosingDate;
      if (estClose == null || estClose === "") return false;
      try {
        const ecd = new Date(estClose);
        if (Number.isNaN(ecd.getTime())) return false;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        ecd.setHours(0, 0, 0, 0);
        return today > ecd;
      } catch {
        return false;
      }
    };

    // Past est. close count from bucketed loans, filtered by active period (same as Active Loans Today / critical cards).
    const bucketedPastEstCloseCount = (() => {
      if (!bucketedLoans || bucketedLoans.length === 0) return null;
      const inPeriod = activeLoansPeriod
        ? bucketedLoans.filter((l: any) => {
            const appDate = getApplicationDate(l);
            return appDate && isDateInPeriod(appDate, activeLoansPeriod, now);
          })
        : bucketedLoans;
      return inPeriod.filter((l: any) => isPastEcd(l)).length;
    })();

    // Close-late count excluding past-ECD so we don't double-count (past ECD has its own KPI).
    const serverCloseLateCount = (() => {
      if (!bucketedLoans || bucketedLoans.length === 0) return null;
      const hasCloseLateData = bucketedLoans.some(
        (l: any) => l?.closeLateRisk != null,
      );
      if (!hasCloseLateData) return null;
      return bucketedLoans.filter(
        (l: any) => l?.closeLateRisk === true && !isPastEcd(l),
      ).length;
    })();

    const hasLoans = loansRaw && loansRaw.length > 0 && !loansError;

    if (hasLoans) {
      const loans = loansRaw as any[];
      const cache = metricsCacheRef.current;

      // Invalidate cache when loans, predictions, stats, pull-through rate, active loans period, or server active count change
      // The serverActiveLoansCount is the key data source for active loans - when it changes, we must recompute
      const currentServerActiveLoans = serverActiveLoansCount.loading
        ? null
        : {
            count: serverActiveLoansCount.count,
            volume: serverActiveLoansCount.volume,
          };
      const serverActiveLoansChanged =
        cache.serverActiveLoansVersion?.count !==
          currentServerActiveLoans?.count ||
        cache.serverActiveLoansVersion?.volume !==
          currentServerActiveLoans?.volume;

      if (
        cache.dataVersion !== loansRaw ||
        cache.predictionsVersion !== predictions ||
        cache.statsVersion !== statsData ||
        cache.pullThroughVersion !== pullThroughRateFromMetrics ||
        cache.activeLoansPeriodVersion !== activeLoansPeriod ||
        serverActiveLoansChanged
      ) {
        cache.cache.clear();
        cache.dataVersion = loansRaw;
        cache.predictionsVersion = predictions;
        cache.statsVersion = statsData;
        cache.pullThroughVersion = pullThroughRateFromMetrics;
        cache.activeLoansPeriodVersion = activeLoansPeriod;
        cache.serverActiveLoansVersion = currentServerActiveLoans;
      }

      // Create cache key that includes the active loans period
      // This ensures filtered counts are cached separately from all-time counts
      const periodKey = `${String(deferredPeriod)}_active:${
        activeLoansPeriod ?? "all"
      }`;
      const cached = cache.cache.get(periodKey);
      if (cached) {
        const totalActiveInPanel =
          (bucketedLoansInPeriod ?? bucketedLoans)?.length ??
          cached.activeLoansToday ??
          0;
        const highRiskRate =
          totalActiveInPanel > 0
            ? Math.round((highRiskCount / totalActiveInPanel) * 100)
            : 0;
        const likelyCloseLate =
          serverCloseLateCount != null
            ? serverCloseLateCount
            : cached.likelyCloseLate;
        const pastEstClose =
          bucketedPastEstCloseCount != null
            ? bucketedPastEstCloseCount
            : cached.pastEstClose;
        const lockedLoans =
          bucketedLockedCount != null
            ? Math.max(bucketedLockedCount, cached.lockedLoans)
            : cached.lockedLoans;

        // Always recompute Likely Withdraw/Decline from bucketedLoans when period filter is set
        // so they stay in sync with Active Loans Today and don't use stale cached counts (e.g. from when bucketedLoans was empty)
        let likelyWithdraw = cached.likelyWithdraw;
        let likelyDecline = cached.likelyDecline;
        if (
          bucketedLoans &&
          bucketedLoans.length > 0 &&
          activeLoansPeriod
        ) {
          const inPeriod = bucketedLoans.filter((l: any) => {
            const appDate = getApplicationDate(l);
            return appDate && isDateInPeriod(appDate, activeLoansPeriod, now);
          });
          likelyWithdraw = inPeriod.filter(
            (l: any) => l?.riskSummary?.predictedOutcome === "withdraw",
          ).length;
          likelyDecline = inPeriod.filter(
            (l: any) => l?.riskSummary?.predictedOutcome === "deny",
          ).length;
        }
        const predictedFalloutTotal = likelyWithdraw + likelyDecline;
        const falloutRate =
          cached.activeLoansToday > 0
            ? Math.round(
                (predictedFalloutTotal / cached.activeLoansToday) * 100,
              )
            : cached.falloutRate;

        return {
          ...cached,
          likelyWithdraw,
          likelyDecline,
          predictedFalloutTotal,
          falloutRate,
          highRiskCount,
          totalActiveInPanel,
          highRiskRate,
          likelyCloseLate,
          pastEstClose,
          lockedLoans,
        };
      }

      // Pass server-side active loans count to computeMetricsFromLoans
      // This is the authoritative count from /api/loans/active-loans-count with SQL-applied date filter
      const serverActiveLoans = serverActiveLoansCount.loading
        ? undefined
        : {
            count: serverActiveLoansCount.count,
            volume: serverActiveLoansCount.volume,
          };

      const result = computeMetricsFromLoans(
        loans,
        deferredPeriod,
        now,
        statsData,
        predictions,
        pullThroughRateFromMetrics,
        activeLoansPeriod,
        serverActiveLoans,
        bucketedLoans ?? undefined,
      );
      cache.cache.set(periodKey, result);

      // Precompute other periods in the background so switching later is instant
      // Note: We skip precomputation when serverActiveLoans changes frequently to avoid stale cached values
      if (typeof requestIdleCallback !== "undefined" && serverActiveLoans) {
        const loansSnap = loans;
        const nowSnap = now;
        const statsSnap = statsData;
        const predSnap = predictions;
        const pullThroughSnap = pullThroughRateFromMetrics;
        const activeLoansPeriodSnap = activeLoansPeriod;
        const serverActiveLoansSnap = serverActiveLoans;
        const bucketedLoansSnap = bucketedLoans;
        const ref = metricsCacheRef;
        requestIdleCallback(
          () => {
            const c = ref.current;
            // Check if cache has been invalidated by new data (including serverActiveLoans changes)
            const serverActiveLoansStale =
              c.serverActiveLoansVersion?.count !==
                serverActiveLoansSnap?.count ||
              c.serverActiveLoansVersion?.volume !==
                serverActiveLoansSnap?.volume;
            if (
              c.dataVersion !== loansSnap ||
              c.predictionsVersion !== predSnap ||
              c.statsVersion !== statsSnap ||
              c.pullThroughVersion !== pullThroughSnap ||
              c.activeLoansPeriodVersion !== activeLoansPeriodSnap ||
              serverActiveLoansStale
            )
              return;
            PERIODS_TO_PRECOMPUTE.forEach((p) => {
              const pKey = `${String(p)}_active:${
                activeLoansPeriodSnap ?? "all"
              }`;
              if (pKey !== periodKey && !c.cache.has(pKey)) {
                c.cache.set(
                  pKey,
                  computeMetricsFromLoans(
                    loansSnap,
                    p,
                    nowSnap,
                    statsSnap,
                    predSnap,
                    pullThroughSnap,
                    activeLoansPeriodSnap,
                    serverActiveLoansSnap,
                    bucketedLoansSnap ?? undefined,
                  ),
                );
              }
            });
          },
          { timeout: 4000 },
        );
      }

      const totalActiveInPanel =
        (bucketedLoansInPeriod ?? bucketedLoans)?.length ??
        result.activeLoansToday ??
        0;
      const highRiskRate =
        totalActiveInPanel > 0
          ? Math.round((highRiskCount / totalActiveInPanel) * 100)
          : 0;
      const likelyCloseLate =
        serverCloseLateCount != null
          ? serverCloseLateCount
          : result.likelyCloseLate;
      const pastEstClose =
        bucketedPastEstCloseCount != null
          ? bucketedPastEstCloseCount
          : result.pastEstClose;
      const lockedLoans =
        bucketedLockedCount != null
          ? Math.max(bucketedLockedCount, result.lockedLoans)
          : result.lockedLoans;
      return {
        ...result,
        highRiskCount,
        totalActiveInPanel,
        highRiskRate,
        likelyCloseLate,
        pastEstClose,
        lockedLoans,
      };
    }

    // Active Loans Today - use server count when available so filter (e.g. ACTIVE: Last 6 months) stays in sync
    const activeLoansToday =
      (!serverActiveLoansCount.loading && serverActiveLoansCount.count > 0
        ? serverActiveLoansCount.count
        : null) ??
      statsData?.active ??
      funnelData?.stillActive?.units ??
      0;

    // Closed Loans (Funded Loans)
    const closedLoansMTD =
      statsData?.closed ?? funnelData?.originated?.units ?? 0;

    // Predicted Closing - estimate based on pull-through rate
    // Fallback order: 1) pullThroughRateFromMetrics (from useMetrics, matches ExecutiveDashboard)
    //                 2) statsData?.pullThroughRate (from /api/loans/stats)
    //                 3) Calculated from funnelData
    //                 4) 0 (no data available)
    const pullThroughRate =
      pullThroughRateFromMetrics ||
      statsData?.pullThroughRate ||
      (funnelData?.loansStarted?.units && funnelData.loansStarted.units > 0
        ? ((funnelData?.originated?.units ?? 0) /
            funnelData.loansStarted.units) *
          100
        : 0);
    // Predicted Closing computed below after likelyWithdrawFallback / likelyDeclineFallback

    // Likely Close Late - use server-computed count from document pipeline (or legacy summary) if available
    const likelyCloseLate =
      predictions?.likelyCloseLateCount ??
      (predictions as any)?.summary?.likelyCloseLateCount ??
      (activeLoansToday > 0 ? Math.round(activeLoansToday * 0.15) : 0);

    // Fallout metrics - use predictions ONLY (not funnel data fallback)
    // When bucketedLoans and activeLoansPeriod are set, filter by application date (same as Active Loans Today)
    let likelyWithdrawFallback = predictions?.likelyWithdraw ?? 0;
    let likelyDeclineFallback = predictions?.likelyDecline ?? 0;
    if (
      bucketedLoans &&
      bucketedLoans.length > 0 &&
      activeLoansPeriod
    ) {
      const nowFallback = new Date();
      const inPeriod = bucketedLoans.filter((l: any) => {
        const appDate = getApplicationDate(l);
        return appDate && isDateInPeriod(appDate, activeLoansPeriod, nowFallback);
      });
      likelyWithdrawFallback = inPeriod.filter(
        (l: any) => l?.riskSummary?.predictedOutcome === "withdraw",
      ).length;
      likelyDeclineFallback = inPeriod.filter(
        (l: any) => l?.riskSummary?.predictedOutcome === "deny",
      ).length;
    }
    const predictedFalloutTotalFallback =
      bucketedLoans &&
      bucketedLoans.length > 0 &&
      activeLoansPeriod
        ? likelyWithdrawFallback + likelyDeclineFallback
        : (predictions?.predictedFalloutTotal ??
            likelyWithdrawFallback +
              likelyDeclineFallback);

    // Predicted Closing = Active Loans Today − (Likely Withdraw + Likely Decline)
    const predictedClosing = Math.max(
      0,
      activeLoansToday - (likelyWithdrawFallback + likelyDeclineFallback),
    );

    // Pipeline value
    const pipelineValue =
      statsData?.activeVolume ??
      statsData?.totalVolume ??
      funnelData?.stillActive?.volume ??
      0;
    const pipelineValueM =
      pipelineValue > 0 ? (pipelineValue / 1000000).toFixed(1) : "0";

    // Pull-through rate for display
    const pullThroughRateDisplay =
      pullThroughRate > 0 ? Math.round(pullThroughRate) : 0;

    // Fallout rate
    const falloutRate =
      activeLoansToday > 0
        ? Math.round(
            (predictedFalloutTotalFallback / activeLoansToday) * 100,
          )
        : 0;

    // High risk: use count from top of useMemo; totalActiveInPanel syncs with active filter when bucketed data exists
    const totalActiveInPanel =
      (bucketedLoansInPeriod ?? bucketedLoans)?.length ?? activeLoansToday;
    const highRiskRate =
      totalActiveInPanel > 0
        ? Math.round((highRiskCount / totalActiveInPanel) * 100)
        : 0;

    // Locked loans
    const lockedLoans = statsData?.locked ?? 0;

    // Average cycle time
    const avgCycleTime = statsData?.avgCycleTime ?? 24;

    return {
      activeLoansToday,
      closedLoansMTD,
      predictedClosing,
      likelyCloseLate,
      pastEstClose: bucketedPastEstCloseCount ?? 0,
      likelyWithdraw: likelyWithdrawFallback,
      likelyDecline: likelyDeclineFallback,
      predictedFalloutTotal: predictedFalloutTotalFallback,
      pipelineValueM,
      pullThroughRateDisplay,
      falloutRate,
      lockedLoans,
      lockedRolling90: lockedLoans, // Fallback: use total locks when no loan data available
      avgCycleTime,
      pipelineValue,
      highRiskCount,
      totalActiveInPanel,
      highRiskRate,
    };
  }, [
    statsData,
    funnelData,
    loansRaw,
    loansError,
    deferredPeriod,
    predictions,
    pullThroughRateFromMetrics,
    activeLoansPeriod,
    serverActiveLoansCount, // Server-side active loans count with date filter
    bucketedLoans,
  ]);

  const getExportData = (): ExportData => ({
    title: "Closing & Fallout Forecast",
    tables: [
      {
        name: "Key Metrics",
        headers: ["Metric", "Value"],
        rows: [
          ["Active Loans Today", metrics.activeLoansToday],
          ["Closed Loans MTD", metrics.closedLoansMTD],
          ["Predicted Closings", metrics.predictedClosing],
          ["Likely Close Late", metrics.likelyCloseLate],
          ["Past Est. Close Date", metrics.pastEstClose],
          ["Likely Withdraw", metrics.likelyWithdraw],
          ["Likely Decline", metrics.likelyDecline],
          ["Predicted Fallout Total", metrics.predictedFalloutTotal],
          [
            "High Risk # of # fallout (80/100 risk or higher)",
            `${metrics.highRiskCount} of ${metrics.predictedFalloutTotal} fallout`,
          ],
          ["Pipeline Value (M)", metrics.pipelineValueM],
          ["Pull-Through Rate", `${metrics.pullThroughRateDisplay}%`],
          ["Fallout Rate", `${metrics.falloutRate}%`],
          ["Locked Loans", metrics.lockedLoans],
          ["Avg Cycle Time", `${metrics.avgCycleTime} days`],
        ],
      },
    ],
  });

  // Calculate KPIs for Pipeline Snapshot
  const kpis = useMemo(() => {
    const pipelineUPB =
      metrics.pipelineValue > 0
        ? `$${(metrics.pipelineValue / 1000000).toFixed(1)}M`
        : "$0M";

    // Active locked loans count — how many of the current active loans have a lock date
    const lockedActiveCount = metrics.lockedLoans;

    const pullThrough = `${metrics.pullThroughRateDisplay}%`;

    // Projected Pullthrough = (active loans today - (withdraw + deny)) / active loans today (filter-aware)
    const projectedPullthroughPct =
      metrics.activeLoansToday > 0
        ? Math.round(
            100 *
              (metrics.activeLoansToday -
                (metrics.likelyWithdraw + metrics.likelyDecline)) /
              metrics.activeLoansToday,
          )
        : 0;
    const projectedPullthrough = `${projectedPullthroughPct}%`;

    return [
      {
        label: "Pipeline UPB",
        value: pipelineUPB,
        secondaryLabel: "Current Pipeline",
        secondaryValue: pipelineUPB,
        explanation:
          "Total Unpaid Principal Balance of active loans. Forward-looking revenue indicator.",
      },
      {
        label: "Locked Loans",
        value: lockedActiveCount.toString(),
        secondaryLabel: "Active w/ Lock",
        secondaryValue: `${lockedActiveCount} of ${metrics.activeLoansToday}`,
        explanation:
          "Active loans that have a rate lock date. Only counts loans currently in the active pipeline.",
      },
      {
        label: "Historical Rolling 90 Days Pullthrough",
        value: pullThrough,
        secondaryLabel: "Rolling 90D",
        secondaryValue: pullThrough,
        explanation:
          "Historical success rate - % of loans that successfully fund. Uses rolling 90-day window for accuracy.",
      },
      {
        label: "Projected Pullthrough",
        value: projectedPullthrough,
        secondaryLabel: "Forecast",
        secondaryValue: projectedPullthrough,
        explanation:
          "Expected pullthrough for current pipeline: (Active Loans − Likely Withdraw − Likely Decline) ÷ Active Loans. Respects the active loans period filter.",
      },
    ];
  }, [metrics]);

  // PERFORMANCE: Only trigger animation on initial data load, not on period changes
  // This prevents stutter when switching between periods
  const hasAnimatedRef = useRef(false);
  const prevDataRef = useRef<{
    statsData: typeof statsData;
    loansRaw: typeof loansRaw;
  }>({ statsData: null, loansRaw: null });

  useEffect(() => {
    // Only animate when actual data changes (initial load or refresh), not period switches
    const dataChanged =
      (prevDataRef.current.statsData === null && statsData !== null) ||
      (prevDataRef.current.loansRaw === null && loansRaw !== null);

    if (dataChanged || !hasAnimatedRef.current) {
      setIsAnimating(false);
      const timer = setTimeout(() => {
        setIsAnimating(true);
        hasAnimatedRef.current = true;
      }, 100);

      prevDataRef.current = { statsData, loansRaw };
      return () => clearTimeout(timer);
    }
  }, [statsData, loansRaw]);

  // When period changes, only update the ref. Keep the same loan set and use session-cached metrics
  // so switching periods is instant (metrics are computed from "all" loans and cached per period).
  useEffect(() => {
    prevPeriodRef.current = period;
  }, [period]);

  // Fetch active loans count from server with date filter
  // This calls /api/loans/active-loans-count with the selected period
  useEffect(() => {
    // Use a flag to prevent race conditions when period changes rapidly
    // If the effect re-runs before the previous request completes, we ignore the stale response
    let isCancelled = false;

    const fetchActiveLoansCount = async () => {
      setServerActiveLoansCount((prev) => ({ ...prev, loading: true }));
      try {
        // Build query params based on period selection
        const params = new URLSearchParams();
        if (activeLoansPeriod) {
          params.set("period", activeLoansPeriod);
        }
        // Add tenant_id for multi-tenant support (required for super_admin viewing other tenants)
        if (selectedTenantId) {
          params.set("tenant_id", selectedTenantId);
        }

        const url = `/api/loans/active-loans-count${
          params.toString() ? `?${params.toString()}` : ""
        }`;
        const response = await api.request<{
          count: number;
          volume: number;
          dateFilter: {
            startDate: string;
            endDate: string;
            period?: string;
          } | null;
        }>(url);

        // Only update state if this request hasn't been superseded by a newer one
        if (!isCancelled) {
          setServerActiveLoansCount({
            count: response.count,
            volume: response.volume,
            loading: false,
          });
        }
      } catch (error: any) {
        // Ignore errors from cancelled requests
        if (isCancelled) return;

        // Handle "No tenant selected" gracefully - this happens when platform admin
        // hasn't selected a tenant yet. Not an error, just no data to show.
        const errorMessage = error?.message || "";
        if (
          errorMessage.includes("No tenant selected") ||
          errorMessage.includes("Tenant not found")
        ) {
          // Silently use fallback (statsData.active if available)
          setServerActiveLoansCount({ count: 0, volume: 0, loading: false });
        } else {
          console.error("Failed to fetch active loans count:", error);
          // On other errors, keep previous value but stop loading
          setServerActiveLoansCount((prev) => ({ ...prev, loading: false }));
        }
      }
    };

    fetchActiveLoansCount();

    // Cleanup: mark this request as cancelled when a new one starts
    return () => {
      isCancelled = true;
    };
  }, [activeLoansPeriod, selectedTenantId]); // Re-fetch when period or tenant changes

  // Fetch stored predictions from DB (used on load and after predict pipeline completes)
  // Now includes full loan data with signal strengths for display without re-running predictions
  // Filters predictions by activeLoansPeriod to only show fallout predictions for loans in the selected date range
  const fetchStoredPredictions = useCallback(
    async (options?: { skipPeriodFilter?: boolean }) => {
      try {
        // Build query params
        const params = new URLSearchParams();
        if (selectedTenantId) {
          params.set("tenant_id", selectedTenantId);
        }
        // Apply period filter unless explicitly skipped (e.g., for initial load)
        if (activeLoansPeriod && !options?.skipPeriodFilter) {
          params.set("period", activeLoansPeriod);
        }

        const url = `/api/predictions${
          params.toString() ? `?${params.toString()}` : ""
        }`;
        const response = await api.request<{
          predictions: Array<{
            loanId: string;
            predictedOutcome: "withdraw" | "deny" | "originate";
            confidence: number;
            reasoning?: string;
            riskFactors?: string[];
            bucket?: string;
            loanData?: {
              loan_id: string;
              loan_officer?: string;
              loan_amount?: number;
              loan_type?: string;
              current_milestone?: string;
              fico_score?: number;
              ltv_ratio?: number;
              be_dti_ratio?: number;
              interest_rate?: number;
              market_rate?: number;
              marketChangeDelta?: number;
              activeDays?: number;
              loPullthroughPercentage?: number;
              uwPullthroughPercentage?: number;
              closerPullthroughPercentage?: number;
              processorPullthroughPercentage?: number;
              creditMetricsSignalStrength?: number;
              loanCharacteristicsSignalStrength?: number;
              timeInMotionSignalStrength?: number;
              mloAeFalloutProneSignalStrength?: number;
              interestLockVsMarketSignalStrength?: number;
              uwPullthroughSignalStrength?: number;
              closerPullthroughSignalStrength?: number;
              processorPullthroughSignalStrength?: number;
              ficoScoreSignal?: number;
              ltvSignal?: number;
              dtiSignal?: number;
              loPullthroughSignal?: number;
              marketChangeDeltaSignal?: number;
              riskSummary?: any;
              bucket?: string;
            };
          }>;
          count: number;
          summary: {
            withdraw: number;
            deny: number;
            originate: number;
            likelyCloseLateCount?: number;
          };
          dateFilter?: {
            startDate: string;
            endDate: string;
            period?: string;
          } | null;
        }>(url, { method: "GET", headers: { "Cache-Control": "no-cache" } });

        if (response.predictions && Array.isArray(response.predictions)) {
          setFullPredictions(response.predictions);

          // Also update the predictions state used for KPI metrics
          if (response.summary) {
            setPredictions({
              likelyWithdraw: response.summary.withdraw,
              likelyDecline: response.summary.deny,
              predictedFalloutTotal:
                response.summary.withdraw + response.summary.deny,
            });
          }

          // Update loanPredictions map for card filtering
          const predictionsMap: Record<string, string> = {};
          response.predictions.forEach((pred) => {
            if (pred.loanId && pred.predictedOutcome) {
              predictionsMap[pred.loanId] = pred.predictedOutcome;
            }
          });
          setLoanPredictions(predictionsMap);

          // Reconstruct bucketedLoans from stored loanData for display
          // This allows the critical loan cards to show full signal data on refresh
          const reconstructedBucketedLoans = response.predictions
            .filter((pred) => pred.loanData) // Only include predictions that have stored loan data
            .map((pred) => ({
              ...pred.loanData,
              // Ensure loan_id is set (might be in loanData or from prediction)
              loan_id: pred.loanData?.loan_id || pred.loanId,
              // Add the prediction info to each loan
              bucket: pred.bucket || pred.loanData?.bucket || "medium",
              riskSummary: pred.loanData?.riskSummary || {
                predictedOutcome: pred.predictedOutcome,
                confidence: pred.confidence,
                risks: pred.riskFactors || [],
                positives: [],
                overallRisk:
                  pred.bucket === "high"
                    ? "high"
                    : pred.bucket === "low"
                      ? "low"
                      : "medium",
              },
            }));

          if (reconstructedBucketedLoans.length > 0) {
            console.log(
              "[Predictions] Restored bucketed loans from database, filtered by period:",
              reconstructedBucketedLoans.length,
              activeLoansPeriod
                ? `(filtered by ${activeLoansPeriod})`
                : "(all time)",
            );
            setBucketedLoans(reconstructedBucketedLoans);
          }
        } else {
          setFullPredictions([]);
        }
      } catch (error) {
        console.error(
          "[Predictions] Failed to fetch stored predictions:",
          error,
        );
        setFullPredictions([]);
      }
    },
    [selectedTenantId, activeLoansPeriod],
  );

  // Per-instance guard (avoids double-click / Strict Mode double-invoke in this instance)
  const predictionInFlightRef = useRef(false);

  // Manual prediction trigger: runs bucketing with rule-based summaries (instant)
  const runPrediction = useCallback(async () => {
    if (predictionInFlightRef.current) return;
    predictionInFlightRef.current = true; // set immediately so same-tick second call (e.g. duplicate handler) bails
    if (!claimPredictionLock()) {
      predictionInFlightRef.current = false;
      return; // another instance (Dashboard or Widget) is already running
    }
    setPredictionsLoading(true);
    try {
      const predictUrl = selectedTenantId
        ? `/api/predictions?tenant_id=${selectedTenantId}`
        : "/api/predictions";
      const resp = await api.request<{ jobId: string }>(predictUrl, {
        method: "POST",
        body: JSON.stringify({}),
      });

      if (resp.jobId) {
        setPredictionJobId(resp.jobId);
      }
    } catch (error) {
      console.error("[Predict] Failed to start prediction:", error);
      setPredictions(null);
      setLoanPredictions({});
      setBucketedLoans([]);
      setPredictionsLoading(false);
      predictionInFlightRef.current = false;
      predictionInFlightGlobal = false;
    }
  }, [selectedTenantId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle prediction job completion
  useEffect(() => {
    if (predictionJob.status === "complete" && predictionJob.result) {
      const response = predictionJob.result;
      setPredictions({
        likelyWithdraw: response.summary?.predictedWithdraw ?? 0,
        likelyDecline: response.summary?.predictedDeny ?? 0,
        predictedFalloutTotal:
          (response.summary?.predictedWithdraw ?? 0) + (response.summary?.predictedDeny ?? 0),
        likelyCloseLateCount: response.summary?.likelyCloseLateCount,
      });

      if (response.predictions && Array.isArray(response.predictions)) {
        const predictionsMap: Record<string, string> = {};
        response.predictions.forEach(
          (pred: { loanId: string; predictedOutcome: string }) => {
            if (pred.loanId && pred.predictedOutcome)
              predictionsMap[pred.loanId] = pred.predictedOutcome;
          },
        );
        setLoanPredictions(predictionsMap);
      }

      if (
        response.bucketedLoans &&
        Array.isArray(response.bucketedLoans) &&
        response.bucketedLoans.length > 0
      ) {
        setBucketedLoans(response.bucketedLoans);
      } else {
        setBucketedLoans([]);
      }

      setPredictionsLoading(false);
      setPredictionJobId(null);
      predictionInFlightRef.current = false;
      predictionInFlightGlobal = false;
    } else if (predictionJob.status === "failed") {
      console.error("[Predict] Prediction job failed:", predictionJob.error);
      setPredictions(null);
      setLoanPredictions({});
      setBucketedLoans([]);
      setPredictionsLoading(false);
      setPredictionJobId(null);
      predictionInFlightRef.current = false;
      predictionInFlightGlobal = false;
    }
  }, [predictionJob.status, predictionJob.result, predictionJob.error]);

  // Fetch stored predictions from database when activeLoansPeriod or tenant changes
  // Race condition protection: cancel stale requests when period changes rapidly
  useEffect(() => {
    let isCancelled = false;

    const fetchPredictions = async () => {
      try {
        // Build query params
        const params = new URLSearchParams();
        if (selectedTenantId) {
          params.set("tenant_id", selectedTenantId);
        }
        // Apply period filter for predictions
        if (activeLoansPeriod) {
          params.set("period", activeLoansPeriod);
        }

        const url = `/api/predictions${
          params.toString() ? `?${params.toString()}` : ""
        }`;
        const response = await api.request<{
          predictions: Array<{
            loanId: string;
            predictedOutcome: "withdraw" | "deny" | "originate";
            confidence: number;
            reasoning?: string;
            riskFactors?: string[];
            bucket?: string;
            loanData?: any;
          }>;
          count: number;
          summary: {
            withdraw: number;
            deny: number;
            originate: number;
            likelyCloseLateCount?: number;
          };
          dateFilter?: {
            startDate: string;
            endDate: string;
            period?: string;
          } | null;
        }>(url, { method: "GET", headers: { "Cache-Control": "no-cache" } });

        // Only update state if this request hasn't been superseded
        if (isCancelled) return;

        if (response.predictions && Array.isArray(response.predictions)) {
          setFullPredictions(response.predictions);

          // Update the predictions state used for KPI metrics
          if (response.summary) {
            setPredictions({
              likelyWithdraw: response.summary.withdraw,
              likelyDecline: response.summary.deny,
              predictedFalloutTotal:
                response.summary.withdraw + response.summary.deny,
            });
          }

          // Update loanPredictions map for card filtering
          const predictionsMap: Record<string, string> = {};
          response.predictions.forEach((pred) => {
            if (pred.loanId && pred.predictedOutcome) {
              predictionsMap[pred.loanId] = pred.predictedOutcome;
            }
          });
          setLoanPredictions(predictionsMap);

          // Reconstruct bucketedLoans from stored loanData for display
          const reconstructedBucketedLoans = response.predictions
            .filter((pred) => pred.loanData)
            .map((pred) => ({
              ...pred.loanData,
              loan_id: pred.loanData?.loan_id || pred.loanId,
              bucket: pred.bucket || pred.loanData?.bucket || "medium",
              riskSummary: pred.loanData?.riskSummary || {
                predictedOutcome: pred.predictedOutcome,
                confidence: pred.confidence,
                risks: pred.riskFactors || [],
                positives: [],
                overallRisk:
                  pred.bucket === "high"
                    ? "high"
                    : pred.bucket === "low"
                      ? "low"
                      : "medium",
              },
            }));

          if (reconstructedBucketedLoans.length > 0) {
            setBucketedLoans(reconstructedBucketedLoans);
          }
        } else {
          setFullPredictions([]);
        }
      } catch (error) {
        if (isCancelled) return;
        console.error(
          "[Predictions] Failed to fetch stored predictions:",
          error,
        );
        setFullPredictions([]);
      }
    };

    fetchPredictions();

    // Cleanup: mark this request as cancelled when a new one starts
    return () => {
      isCancelled = true;
    };
  }, [activeLoansPeriod, selectedTenantId]);

  // Load full loan set on mount (required for period filtering to work)
  // The loans are loaded once with 'all' period and then filtered client-side
  useEffect(() => {
    if (!loansRaw && !loansLoading && !loansError) {
      ensureLoansLoaded();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch locked loans and pull-through rate using useMetrics with rolling_90_days period
  // This matches how ExecutiveDashboard fetches these metrics for consistent values
  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const results = await queryMetrics(
          ["locked_loans", "pull_through_rate"],
          "rolling_90_days",
        );
        if (results?.locked_loans?.value !== undefined) {
          const value =
            typeof results.locked_loans.value === "number"
              ? results.locked_loans.value
              : parseFloat(results.locked_loans.value as string) || 0;
          setLockedLoansRolling90(value);
        }
        if (results?.pull_through_rate?.value !== undefined) {
          const value =
            typeof results.pull_through_rate.value === "number"
              ? results.pull_through_rate.value
              : parseFloat(results.pull_through_rate.value as string) || 0;
          setPullThroughRateFromMetrics(value);
        }
      } catch (error) {
        console.error(
          "[ClosingFalloutForecast] Failed to fetch metrics:",
          error,
        );
      }
    };
    fetchMetrics();
  }, [queryMetrics]);

  // Fetch sales scorecard to get loan officer TTS (Top Tier Score) for critical loan cards
  useEffect(() => {
    let cancelled = false;
    const fetchOfficerTts = async () => {
      try {
        const params = new URLSearchParams();
        params.set("actor", "loan_officer");
        if (selectedTenantId) params.set("tenant_id", selectedTenantId);
        if (selectedChannel && selectedChannel !== "All")
          params.set("channel_group", selectedChannel);
        // Using new consolidated endpoint with channel-aware actor support
        const res = await api.request<{
          actors?: Array<{ name: string; ttsScore: number; tier?: string }>;
        }>(`/api/scorecard/sales?${params.toString()}`);
        if (cancelled || !res?.actors) return;
        const map: Record<string, { ttsScore: number; tier: string }> = {};
        res.actors.forEach((a) => {
          if (a.name != null && !Number.isNaN(Number(a.ttsScore))) {
            const tier =
              a.tier &&
              ["top", "second", "bottom"].includes(String(a.tier).toLowerCase())
                ? String(a.tier).toLowerCase()
                : "bottom";
            map[String(a.name).trim()] = { ttsScore: Number(a.ttsScore), tier };
          }
        });
        setOfficerTtsMap(map);
      } catch (e) {
        if (!cancelled) setOfficerTtsMap({});
      }
    };
    fetchOfficerTts();
    return () => {
      cancelled = true;
    };
  }, [selectedTenantId]);

  /** Derive signal bucket (1–6) from reason_codes zones. Backend: Zone 1 = worst (red), Zone 6 = best (green). FICO & market_delta: lower value → Zone 1; LTV, DTI, days_active: higher value → Zone 1. Display bucket = 7 − zone. Credit Metrics = avg(FICO, LTV, DTI); Time in Motion = days_active; Lock vs Market = market_delta. */
  const signalBucketsFromReasonCodes = (
    reasonCodes: ReasonCodeEntry[] | null | undefined
  ): { creditMetrics: number | null; loanCharacteristics: number | null; timeInMotion: number | null; lockVsMarket: number | null } => {
    if (!reasonCodes || !Array.isArray(reasonCodes) || reasonCodes.length === 0) {
      return { creditMetrics: null, loanCharacteristics: null, timeInMotion: null, lockVsMarket: null };
    }
    const zoneFico = getZoneFromReasonCodes(reasonCodes, "fico_score");
    const zoneLtv = getZoneFromReasonCodes(reasonCodes, "ltv_ratio");
    const zoneDti = getZoneFromReasonCodes(reasonCodes, "be_dti_ratio");
    const zoneDays = getZoneFromReasonCodes(reasonCodes, "days_active");
    const zoneMarketDelta = getZoneFromReasonCodes(reasonCodes, "market_delta");
    // Zone 1 (highest risk) → display 6, Zone 6 (lowest) → display 1. So bucket value = 7 - zone.
    const toSignal = (z: number | null): number | null => (z != null ? 7 - z : null);
    const ficoSignal = toSignal(zoneFico);
    const ltvSignal = toSignal(zoneLtv);
    const dtiSignal = toSignal(zoneDti);
    const creditSignals = [ficoSignal, ltvSignal, dtiSignal].filter((x): x is number => x != null);
    const creditMetrics =
      creditSignals.length > 0
        ? Math.round(creditSignals.reduce((a, b) => a + b, 0) / creditSignals.length)
        : null;
    return {
      creditMetrics,
      loanCharacteristics: toSignal(zoneLtv),
      timeInMotion: toSignal(zoneDays),
      lockVsMarket: toSignal(zoneMarketDelta),
    };
  };

  /** MLO Fallout Prone bucket (1–6) from LO pullthrough % only. 1=90-100%, 2=80-90%, 3=70-80%, 4=60-70%, 5=30-60%, 6=0-30%. Accepts percentage (0-100) or decimal (0-1). */
  const pullthroughPctToMloBucket = (pct: number | null | undefined): number | null => {
    if (pct == null) return null;
    const p = Number(pct);
    if (Number.isNaN(p)) return null;
    const percent = p > 1 ? p : p * 100;
    if (percent >= 90) return 1;
    if (percent >= 80) return 2;
    if (percent >= 70) return 3;
    if (percent >= 60) return 4;
    if (percent >= 30) return 5;
    return 6;
  };

  const criticalLoanCards = useMemo(() => {
    // Build map of raw loan data by loan_id/guid for filling missing fields when bucketed data is incomplete
    // Index by loan_id, id, and guid so we can match regardless of which identifier the bucketed loan uses
    type RawLoan = {
      loan_purpose?: string | null;
      channel?: string | null;
      loan_number?: string | null;
      lock_date?: string | null;
      lock_expiration_date?: string | null;
      estimated_closing_date?: string | null;
    };
    const rawByLoanId = new Map<string, RawLoan>();
    if (loansRaw && Array.isArray(loansRaw)) {
      loansRaw.forEach((r: any) => {
        const raw: RawLoan = {
          loan_purpose: r.loan_purpose ?? r.loanPurpose ?? null,
          channel: r.channel ?? null,
          loan_number: r.loan_number ?? r.loanNumber ?? null,
          lock_date: r.lock_date ?? r.lockDate ?? null,
          lock_expiration_date:
            r.lock_expiration_date ?? r.lockExpirationDate ?? null,
          estimated_closing_date:
            r.estimated_closing_date ?? r.estimatedClosingDate ?? null,
        };
        const ids = [r.loan_id, r.id, r.guid].filter(
          (x): x is string => x != null && String(x).trim() !== "",
        );
        ids.forEach((id) => rawByLoanId.set(String(id), raw));
      });
    }

    const getRaw = (loanId: string) => rawByLoanId.get(String(loanId));

    const now = new Date();
    // When activeLoansPeriod is set, filter to loans whose application_date falls in that period (same as Active Loans Today)
    const filterByPeriod = (list: any[]) => {
      if (!activeLoansPeriod || activeLoansPeriod === "all") return list;
      return list.filter((l: any) => {
        const appDate = l.application_date ?? l.applicationDate ?? null;
        return appDate && isDateInPeriod(appDate, activeLoansPeriod, now);
      });
    };

    // Use bucketedLoans (from prediction endpoint) as primary source; filter by active period when set
    if (bucketedLoans && bucketedLoans.length > 0) {
      const inPeriod = filterByPeriod(bucketedLoans);
      return inPeriod.map((l: any) => {
        // Use snake_case field names matching database columns
        const loanId = l.loan_id || l.id || l.guid || "";
        const raw = getRaw(loanId);
        const loanPurpose =
          l.loan_purpose ?? l.loanPurpose ?? raw?.loan_purpose ?? null;
        const channel = l.channel ?? raw?.channel ?? null;
        const loanNumber =
          l.loan_number ?? l.loanNumber ?? raw?.loan_number ?? null;
        const lockDate = l.lock_date ?? l.lockDate ?? raw?.lock_date ?? null;
        const lockExpirationDate =
          l.lock_expiration_date ??
          l.lockExpirationDate ??
          raw?.lock_expiration_date ??
          null;
        const estimatedClosingDate =
          l.estimated_closing_date ??
          l.estimatedClosingDate ??
          raw?.estimated_closing_date ??
          null;

        const applicationDate = l.application_date ?? l.applicationDate ?? null;
        const activeDaysComputed =
          applicationDate != null
            ? Math.floor(
                (Date.now() - new Date(applicationDate).getTime()) /
                  (1000 * 60 * 60 * 24),
              )
            : null;
        const lockRate =
          l.lockMarketRate != null
            ? Number(l.lockMarketRate)
            : l.market_rate_at_lock != null
              ? Number(l.market_rate_at_lock)
              : (lockDate != null && l.interest_rate != null ? Number(l.interest_rate) : null);
        const marketRateVal =
          l.market_rate != null
            ? Number(l.market_rate)
            : l.closeMarketRate != null
              ? Number(l.closeMarketRate)
              : null;
        const marketDeltaComputed =
          lockRate != null && marketRateVal != null && !Number.isNaN(lockRate) && !Number.isNaN(marketRateVal)
            ? marketRateVal - lockRate
            : null;

        const loanAmount =
          typeof l.loan_amount === "number"
            ? l.loan_amount
            : parseFloat(l.loan_amount || "0");

        // Extract reason from riskSummary object (it has {risks, positives, overallRisk, predictedOutcome, confidence})
        let reason = "High risk signals detected";
        if (l.riskSummary && typeof l.riskSummary === "object") {
          // Combine the risks array into a readable string
          const risks = l.riskSummary.risks;
          if (Array.isArray(risks) && risks.length > 0) {
            reason = risks.slice(0, 3).join("; "); // Show top 3 risks
          } else if (l.riskSummary.overallRisk) {
            reason = `Overall risk: ${l.riskSummary.overallRisk}`;
          }
        } else if (typeof l.riskSummary === "string") {
          reason = l.riskSummary;
        }

        // Use backend-computed riskScore (process/credit split, max-based, 1-100 scale)
        // Falls back to riskSummary.riskScore, then confidence, then 50
        const riskScore: number =
          l.riskScore ??
          l.riskSummary?.riskScore ??
          l.riskSummary?.confidence ??
          50;

        // Return in LoanCardsContainer expected format
        // Use snake_case field names matching database columns
        const officerName = (l.loan_officer || "").trim();
        const ttsData = officerName ? officerTtsMap[officerName] : null;
        return {
          id: String(loanId),
          loan_number: loanNumber || null,
          officer: l.loan_officer || "",
          officerTtsScore: ttsData?.ttsScore ?? null,
          officerTier: ttsData?.tier ?? null,
          amount: loanAmount ? `$${(loanAmount / 1000).toFixed(0)}K` : "$0",
          amountValue: loanAmount,
          riskLevel: riskScore >= 75 ? "Very High" : riskScore >= 50 ? "High" : riskScore >= 25 ? "Medium" : "Low",
          riskScore,
          reason,
          // Credit metrics (snake_case matching DB)
          ficoScore: l.fico_score ?? null,
          ltvRatio: l.ltv_ratio ?? null,
          dtiRatio: l.be_dti_ratio ?? null,
          // Milestone and time in motion
          currentMilestone:
            l.current_milestone || l.lastCompletedMilestone || null,
          activeDays:
            l.activeDays ?? l.active_days ?? activeDaysComputed ?? null,
          // Rates and market delta (with snake_case fallbacks and computed delta)
          // When loan has no lock date: show no market data at all (Ref. Market Rate, Market Rate Today, Market Delta, Lock vs Market = blank/N/A)
          interestRate: l.interest_rate ?? null,
          marketRate: lockDate != null
            ? (l.market_rate ?? l.closeMarketRate ?? marketRateVal ?? null)
            : null,
          lockMarketRate: lockDate != null
            ? (l.lockMarketRate ?? (l.market_rate_at_lock != null ? Number(l.market_rate_at_lock) : lockRate) ?? null)
            : null,
          rateReferenceType: l.rateReferenceType ?? (lockDate != null ? "lock" : "application") as "lock" | "application",
          marketChangeDelta: lockDate != null
            ? ((l.marketChangeDelta != null && l.marketChangeDelta !== "" ? Number(l.marketChangeDelta) : null)
              ?? (l.market_change_delta != null ? Number(l.market_change_delta) : null)
              ?? marketDeltaComputed ?? null)
            : null,
          lockDate: lockDate ?? null,
          lockExpirationDate: lockExpirationDate ?? null,
          applicationDate: l.application_date ?? l.applicationDate ?? null,
          estimatedClosingDate: estimatedClosingDate ?? null,
          // Pullthrough percentages (actual values; snake_case from DB; backend sends null when missing so key is always present)
          loPullthroughPct:
            (l.loPullthroughPercentage != null && l.loPullthroughPercentage !== "")
              ? Number(l.loPullthroughPercentage)
              : (l.lo_pullthrough_percentage != null ? Number(l.lo_pullthrough_percentage) : null),
          uwPullthroughPct: l.uwPullthroughPercentage ?? null,
          closerPullthroughPct: l.closerPullthroughPercentage ?? null,
          processorPullthroughPct: l.processorPullthroughPercentage ?? null,
          // Rule-based risk summary from backend (contains risks, positives, overallRisk, predictedOutcome, confidence)
          riskSummary: l.riskSummary || null,
          // Signal bucket scores (1–6): Credit Metrics = avg(FICO,LTV,DTI); Time in Motion = days_active; Lock vs Market = market_delta; MLO Fallout Prone = LO pullthrough % only
          ...((): {
            creditMetricsSignalStrength: number | null;
            loanCharacteristicsSignalStrength: number | null;
            timeInMotionSignalStrength: number | null;
            interestLockVsMarketSignalStrength: number | null;
          } => {
            const codes = l.reasonCodes ?? l.reason_codes ?? null;
            const fromZones = signalBucketsFromReasonCodes(codes);
            return {
              creditMetricsSignalStrength: fromZones.creditMetrics ?? l.creditMetricsSignalStrength ?? null,
              loanCharacteristicsSignalStrength: l.loanCharacteristicsSignalStrength ?? fromZones.loanCharacteristics ?? null,
              timeInMotionSignalStrength: fromZones.timeInMotion ?? l.timeInMotionSignalStrength ?? null,
              interestLockVsMarketSignalStrength: lockDate != null ? (fromZones.lockVsMarket ?? l.interestLockVsMarketSignalStrength ?? null) : null,
            };
          })(),
          mloAeFalloutProneSignalStrength:
            pullthroughPctToMloBucket(
              l.loPullthroughPercentage ?? (l.lo_pullthrough_percentage != null ? Number(l.lo_pullthrough_percentage) : null),
            ) ?? l.mloAeFalloutProneSignalStrength ?? l.loPullthroughSignal ?? null,
          uwPullthroughSignalStrength: l.uwPullthroughSignalStrength ?? null,
          closerPullthroughSignalStrength:
            l.closerPullthroughSignalStrength ?? null,
          processorPullthroughSignalStrength:
            l.processorPullthroughSignalStrength ?? null,
          ficoScoreSignal: l.ficoScoreSignal ?? null,
          ltvSignal: l.ltvSignal ?? null,
          dtiSignal: l.dtiSignal ?? null,
          loPullthroughSignal: l.loPullthroughSignal ?? null,
          marketChangeDeltaSignal: lockDate != null ? (l.marketChangeDeltaSignal ?? null) : null,
          loanType: l.loan_type || null,
          loanPurpose: loanPurpose,
          channel: channel,
          closeLateRisk: l.closeLateRisk ?? null,
          reasonCodes: l.reasonCodes ?? l.reason_codes ?? null,
          reason_codes: l.reasonCodes ?? l.reason_codes ?? null,
        };
      });
    }

    // Fallback: use loansRaw if no bucketed data available - show active loans, filtered by period when set
    if (!loansRaw || loansRaw.length === 0) return [];

    let activeRaw = loansRaw.filter((l) => mapForecastStatus(l) === "Active");
    if (activeLoansPeriod && activeLoansPeriod !== "all") {
      activeRaw = activeRaw.filter((l) => {
        const appDate = l.application_date ?? l.applicationDate ?? null;
        return appDate && isDateInPeriod(appDate, activeLoansPeriod, now);
      });
    }

    return activeRaw.map((l) => {
      const base = transformLoanToCard(l);
      const loanId = l.loan_id || l.id;
      const predictedOutcome = loanId ? loanPredictions[loanId] : null;

      // Determine risk level and reason based on prediction
      // Note: API returns lowercase: 'withdraw', 'deny', 'originate'
      let riskLevel = "High";
      let riskScore = base.riskScore ?? 70;
      let reason = base.reason || "";

      const outcomeLower = (predictedOutcome || "").toLowerCase();
      if (
        outcomeLower === "withdraw" ||
        outcomeLower === "deny" ||
        outcomeLower === "decline"
      ) {
        riskLevel = "Very High";
        riskScore = Math.max(riskScore, 85);
        const outcomeText =
          outcomeLower === "withdraw" ? "withdraw" : "decline";
        reason = `AI predicts loan will ${outcomeText}. ${
          reason ? reason : ""
        }`.trim();
      }

      if (isLikelyCloseLateForecast(l, 30, now)) {
        riskLevel = "Very High";
        riskScore = Math.max(riskScore, 85);
        reason = reason
          ? `Past expected closing window; ${reason}`
          : "Past expected closing window";
      }

      const ttsData = base.officer
        ? officerTtsMap[(base.officer || "").trim()]
        : null;
      const estimatedClosing =
        l.estimated_closing_date ?? l.estimatedClosingDate ?? null;
      const appDate = l.application_date ?? l.applicationDate ?? null;
      const activeDaysFallback =
        l.activeDays ?? l.active_days ?? (appDate != null
          ? Math.floor(
              (Date.now() - new Date(appDate).getTime()) /
                (1000 * 60 * 60 * 24),
            )
          : null);
      const hasLockDate = (l.lock_date ?? l.lockDate) != null;
      const lockRateFallback =
        l.market_rate_at_lock != null
          ? Number(l.market_rate_at_lock)
          : l.lockMarketRate ?? (hasLockDate && l.interest_rate != null ? Number(l.interest_rate) : null);
      const marketRateFallback =
        l.market_rate != null ? Number(l.market_rate) : l.closeMarketRate ?? null;
      const marketDeltaFallback =
        l.market_change_delta != null
          ? Number(l.market_change_delta)
          : l.marketChangeDelta ??
            (lockRateFallback != null && marketRateFallback != null
              ? marketRateFallback - lockRateFallback
              : null);
      return {
        ...base,
        riskLevel,
        riskScore,
        reason,
        officerTtsScore: ttsData?.ttsScore ?? null,
        officerTier: ttsData?.tier ?? null,
        currentMilestone:
          l.current_milestone || l.lastCompletedMilestone || null,
        activeDays: activeDaysFallback,
        loanPurpose: l.loan_purpose ?? l.loanPurpose ?? null,
        channel: l.channel ?? null,
        applicationDate: l.application_date ?? l.applicationDate ?? null,
        estimatedClosingDate: estimatedClosing,
        loPullthroughPct:
          l.lo_pullthrough_percentage != null
            ? Number(l.lo_pullthrough_percentage)
            : l.loPullthroughPercentage ?? base.loPullthroughPct ?? null,
        lockMarketRate: lockRateFallback ?? null,
        rateReferenceType: l.rateReferenceType ?? (hasLockDate ? "lock" : "application") as "lock" | "application",
        marketRate: marketRateFallback ?? base.marketRate ?? null,
        marketChangeDelta: marketDeltaFallback ?? base.marketChangeDelta ?? null,
        lockDate: l.lock_date ?? l.lockDate ?? null,
        lockExpirationDate: l.lock_expiration_date ?? l.lockExpirationDate ?? null,
        closeLateRisk: (l as any).closeLateRisk ?? isLikelyCloseLateForecast(l, 30, now) ?? null,
      };
    });
  }, [bucketedLoans, loansRaw, loanPredictions, officerTtsMap, activeLoansPeriod]);

  // High-risk loans (predicted withdraw or deny only, risk >= 80) in card shape for the metric modal
  const HIGH_RISK_SCORE_MIN = 80;
  const highRiskLoansForModal = useMemo(() => {
    const isHighRisk = (l: (typeof criticalLoanCards)[0]) => {
      const score = l.riskScore ?? 0;
      if (score < HIGH_RISK_SCORE_MIN) return false;
      const outcome = l.riskSummary?.predictedOutcome;
      return outcome === "withdraw" || outcome === "deny";
    };
    const list = criticalLoanCards.filter((l) => isHighRisk(l));
    list.sort((a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0));
    const volume = list.reduce((sum, l) => sum + (l.amountValue || 0), 0);
    return { loans: list, volume };
  }, [criticalLoanCards]);

  // Prediction map for critical outcome filter (same as LoanCardsContainer)
  const criticalPredictionMap = useMemo(() => {
    const map = new Map<string, string>();
    fullPredictions.forEach((p) => {
      if (p.loanId && p.predictedOutcome) map.set(p.loanId, p.predictedOutcome);
    });
    return map;
  }, [fullPredictions]);

  // Filter critical loans by outcome tab (shared state with cards; same logic as LoanCardsContainer)
  const filteredCriticalLoanCards = useMemo(() => {
    if (criticalOutcomeFilter === "all") return criticalLoanCards;
    return criticalLoanCards.filter((loan) => {
      switch (criticalOutcomeFilter) {
        case "high-risk": {
          const score = loan.riskScore ?? 0;
          if (score < 80) return false;
          const outcome = loan.riskSummary?.predictedOutcome;
          return outcome === "withdraw" || outcome === "deny";
        }
        case "likely-withdraw":
          if (loan.riskSummary?.predictedOutcome === "withdraw") return true;
          return criticalPredictionMap.get(loan.id) === "withdraw";
        case "likely-decline":
          if (loan.riskSummary?.predictedOutcome === "deny") return true;
          return criticalPredictionMap.get(loan.id) === "deny";
        case "past-est-closing": {
          const ecdRaw = (loan as { estimatedClosingDate?: string | null })
            .estimatedClosingDate;
          if (ecdRaw == null || ecdRaw === "") return false;
          try {
            const ecd = new Date(ecdRaw);
            if (Number.isNaN(ecd.getTime())) return false;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            ecd.setHours(0, 0, 0, 0);
            return today > ecd;
          } catch {
            return false;
          }
        }
        case "likely-close-late": {
          if ((loan as { closeLateRisk?: boolean }).closeLateRisk !== true)
            return false;
          const ecdRaw = (loan as { estimatedClosingDate?: string | null })
            .estimatedClosingDate;
          if (ecdRaw == null || ecdRaw === "") return true;
          try {
            const ecd = new Date(ecdRaw);
            if (Number.isNaN(ecd.getTime())) return true;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            ecd.setHours(0, 0, 0, 0);
            return today <= ecd;
          } catch {
            return true;
          }
        }
        case "favorites":
          return favoriteIds.has(loan.id);
        default:
          return true;
      }
    });
  }, [
    criticalLoanCards,
    criticalOutcomeFilter,
    criticalPredictionMap,
    favoriteIds,
  ]);

  // Tab counts for critical outcome filter (shared with cards and table)
  const criticalTabCounts = useMemo(() => {
    return {
      all: criticalLoanCards.length,
      "high-risk": criticalLoanCards.filter((l) => {
        const score = l.riskScore ?? 0;
        if (score < 80) return false;
        const outcome = l.riskSummary?.predictedOutcome;
        return outcome === "withdraw" || outcome === "deny";
      }).length,
      "likely-withdraw": criticalLoanCards.filter((l) => {
        if (l.riskSummary?.predictedOutcome === "withdraw") return true;
        return criticalPredictionMap.get(l.id) === "withdraw";
      }).length,
      "likely-decline": criticalLoanCards.filter((l) => {
        if (l.riskSummary?.predictedOutcome === "deny") return true;
        return criticalPredictionMap.get(l.id) === "deny";
      }).length,
      "past-est-closing": criticalLoanCards.filter((l) => {
        const ecdRaw = (l as { estimatedClosingDate?: string | null })
          .estimatedClosingDate;
        if (ecdRaw == null || ecdRaw === "") return false;
        try {
          const ecd = new Date(ecdRaw);
          if (Number.isNaN(ecd.getTime())) return false;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          ecd.setHours(0, 0, 0, 0);
          return today > ecd;
        } catch {
          return false;
        }
      }).length,
      "likely-close-late": criticalLoanCards.filter((l) => {
        if ((l as { closeLateRisk?: boolean }).closeLateRisk !== true)
          return false;
        const ecdRaw = (l as { estimatedClosingDate?: string | null })
          .estimatedClosingDate;
        if (ecdRaw == null || ecdRaw === "") return true;
        try {
          const ecd = new Date(ecdRaw);
          if (Number.isNaN(ecd.getTime())) return true;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          ecd.setHours(0, 0, 0, 0);
          return today <= ecd;
        } catch {
          return true;
        }
      }).length,
      favorites: criticalLoanCards.filter((l) => favoriteIds.has(l.id)).length,
    };
  }, [criticalLoanCards, criticalPredictionMap, favoriteIds]);

  // Sorted critical loans for table display (uses filtered list)
  const sortedCriticalLoans = useMemo(() => {
    const loans = [...filteredCriticalLoanCards];

    const getSortValue = (
      loan: (typeof criticalLoanCards)[0],
      column: string,
    ): any => {
      switch (column) {
        case "loan_number":
          return loan.loan_number || "";
        case "amount":
          return loan.amountValue || 0;
        case "officer":
          return loan.officer || "";
        case "commission":
          const amt = loan.amountValue || 0;
          const COMMISSION_MAX = 6000;
          return Math.min(amt * 0.01, COMMISSION_MAX);
        case "predictedOutcome":
          return loan.riskSummary?.predictedOutcome || "";
        case "riskScore":
          return loan.riskScore || 0;
        case "fico":
          return loan.ficoScore ?? -1;
        case "ltv":
          return loan.ltvRatio ?? -1;
        case "dti":
          return loan.dtiRatio ?? -1;
        case "loPullthrough":
          return loan.loPullthroughPct ?? -1;
        case "timeInMotion":
          return loan.activeDays ?? -1;
        case "loanType":
          return loan.loanType || "";
        case "loanPurpose":
          return loan.loanPurpose || "";
        case "channel":
          return loan.channel || "";
        case "milestone":
          return loan.currentMilestone || "";
        case "applicationDate":
          return (loan as any).applicationDate || "";
        case "estimatedClosingDate":
          return loan.estimatedClosingDate || "";
        case "marketRateAtLock":
          return (loan as any).lockMarketRate ?? -1;
        case "marketRateToday":
          return loan.marketRate ?? -1;
        case "marketDelta":
          return loan.marketChangeDelta ?? -1;
        case "lockStatus":
          if ((loan as any).lockDate) return "Locked";
          return "Not Locked";
        case "creditMetrics":
          return loan.creditMetricsSignalStrength ?? -1;
        case "loanCharacteristics":
          return loan.loanCharacteristicsSignalStrength ?? -1;
        case "timeInMotionSignal":
          return loan.timeInMotionSignalStrength ?? -1;
        case "mloFalloutProne":
          return loan.mloAeFalloutProneSignalStrength ?? -1;
        case "lockVsMarket":
          return loan.interestLockVsMarketSignalStrength ?? -1;
        default:
          return "";
      }
    };

    loans.sort((a, b) => {
      const aVal = getSortValue(a, sortColumn);
      const bVal = getSortValue(b, sortColumn);

      // Handle null/undefined values
      if (aVal === null || aVal === undefined || aVal === "") return 1;
      if (bVal === null || bVal === undefined || bVal === "") return -1;

      // String comparison
      if (typeof aVal === "string" && typeof bVal === "string") {
        const comparison = aVal.localeCompare(bVal);
        return sortDirection === "asc" ? comparison : -comparison;
      }

      // Number comparison (coerce so string numbers from API don't break sort)
      const numA = Number(aVal);
      const numB = Number(bVal);
      if (Number.isNaN(numA) && Number.isNaN(numB)) return 0;
      if (Number.isNaN(numA)) return 1;
      if (Number.isNaN(numB)) return -1;
      const comparison = numA - numB;
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return loans;
  }, [filteredCriticalLoanCards, sortColumn, sortDirection]);

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  const formatAmount = (amount: number | null | undefined): string => {
    if (amount === null || amount === undefined) return "$0";
    const n = Number(amount);
    if (Number.isNaN(n)) return "$0";
    if (n >= 1000000) {
      return `$${(n / 1000000).toFixed(2)}M`;
    } else if (n >= 1000) {
      return `$${(n / 1000).toFixed(0)}K`;
    }
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  };

  const formatCommission = (loan: (typeof criticalLoanCards)[0]): string => {
    const amt = loan.amountValue || 0;
    const COMMISSION_MAX = 6000;
    const low = Math.round(Math.min(amt * 0.005, COMMISSION_MAX));
    const high = Math.round(Math.min(amt * 0.01, COMMISSION_MAX));
    if (low === high && low === COMMISSION_MAX) {
      return `$${COMMISSION_MAX.toLocaleString()}`;
    }
    return `$${low.toLocaleString()} – $${high.toLocaleString()}`;
  };

  const formatDate = (dateStr: string | null | undefined): string => {
    if (!dateStr) return "";
    try {
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return dateStr;
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return dateStr;
    }
  };

  const formatPercent = (val: number | null | undefined): string => {
    if (val === null || val === undefined) return "—";
    const n = Number(val);
    if (Number.isNaN(n)) return "—";
    return `${n.toFixed(1)}%`;
  };

  const formatNumber = (
    val: number | null | undefined,
    decimals: number = 0,
  ): string => {
    if (val === null || val === undefined) return "—";
    const n = Number(val);
    if (Number.isNaN(n)) return "—";
    return n.toFixed(decimals);
  };

  const formatRate = (val: number | string | null | undefined): string => {
    if (val === null || val === undefined) return "—";
    const n = Number(val);
    if (Number.isNaN(n)) return "—";
    return `${n.toFixed(2)}%`;
  };

  const isLoanPastEcd = (loan?: { estimatedClosingDate?: string | null }): boolean => {
    if (!loan) return false;
    const ecdRaw = loan.estimatedClosingDate;
    if (ecdRaw == null || ecdRaw === "") return false;
    try {
      const ecd = new Date(ecdRaw);
      if (Number.isNaN(ecd.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      ecd.setHours(0, 0, 0, 0);
      return today > ecd;
    } catch {
      return false;
    }
  };

  const getPredictedOutcomeLabel = (
    outcome: string | undefined,
    loan?: { closeLateRisk?: boolean | null; estimatedClosingDate?: string | null },
  ): string => {
    if (!outcome) return "—";
    let base: string;
    switch (outcome.toLowerCase()) {
      case "withdraw":
        base = "Withdraw";
        break;
      case "deny":
        base = "Deny";
        break;
      case "originate":
        base = loan?.closeLateRisk === true ? "Originate - Late" : "Originate - On Time";
        break;
      case "at_risk":
        base = "At Risk";
        break;
      default:
        base = outcome;
    }
    if (isLoanPastEcd(loan)) return `${base} - Past Est Close Date`;
    return base;
  };

  const getLockStatus = (loan: (typeof criticalLoanCards)[0]): string => {
    const lockDate = (loan as any).lockDate;
    const lockExpirationDate = (loan as any).lockExpirationDate;
    if (lockDate) {
      if (lockExpirationDate) {
        const exp = new Date(lockExpirationDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        exp.setHours(0, 0, 0, 0);
        if (exp < today) return "Expired";
        return "Locked";
      }
      return "Locked";
    }
    return "Not Locked";
  };

  // Color helper functions matching LoanRiskDistribution; when loan has reasonCodes, use zone-based colors (Zone1=red, Zone2=orange, Zone3=yellow, Zone4=no color)
  // Accepts either a loan object (with reasonCodes/reason_codes) or the reasonCodes array directly (for table row so colors always get the same source)
  const reasonCodesForLoan = (loanOrCodes: unknown): Array<{ bucket_type: string; bucket_value: string }> | null | undefined => {
    const raw = Array.isArray(loanOrCodes)
      ? loanOrCodes
      : (loanOrCodes as any)?.reasonCodes ?? (loanOrCodes as any)?.reason_codes;
    if (raw == null) return raw;
    if (Array.isArray(raw)) return raw;
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  };

  const defaultMetricColor = isDarkMode ? "text-slate-300" : "text-slate-900";

  const getFicoColor = (score: number | null | undefined, loan?: unknown): string => {
    const codes = reasonCodesForLoan(loan);
    const zone = getZoneFromReasonCodes(codes, "fico_score");
    const zoneClass = getZoneColorClass(zone ?? null, isDarkMode);
    if (zoneClass) return zoneClass;
    if (codes != null && codes.length > 0) return defaultMetricColor;
    if (score == null || score === 0)
      return isDarkMode ? "text-slate-400" : "text-slate-500";
    if (score < 640) return isDarkMode ? "text-rose-400" : "text-rose-600";
    if (score < 700) return isDarkMode ? "text-amber-400" : "text-amber-600";
    return defaultMetricColor;
  };

  const getLtvColor = (ratio: number | null | undefined, loan?: unknown): string => {
    const codes = reasonCodesForLoan(loan);
    const zone = getZoneFromReasonCodes(codes, "ltv_ratio");
    const zoneClass = getZoneColorClass(zone ?? null, isDarkMode);
    if (zoneClass) return zoneClass;
    if (codes != null && codes.length > 0) return defaultMetricColor;
    if (ratio == null || ratio === 0)
      return isDarkMode ? "text-slate-400" : "text-slate-500";
    if (ratio > 95) return isDarkMode ? "text-rose-400" : "text-rose-600";
    if (ratio > 80) return isDarkMode ? "text-amber-400" : "text-amber-600";
    return defaultMetricColor;
  };

  const getDtiColor = (ratio: number | null | undefined, loan?: unknown): string => {
    const codes = reasonCodesForLoan(loan);
    const zone = getZoneFromReasonCodes(codes, "be_dti_ratio");
    const zoneClass = getZoneColorClass(zone ?? null, isDarkMode);
    if (zoneClass) return zoneClass;
    if (codes != null && codes.length > 0) return defaultMetricColor;
    if (ratio == null || ratio === 0)
      return isDarkMode ? "text-slate-400" : "text-slate-500";
    if (ratio > 50) return isDarkMode ? "text-rose-400" : "text-rose-600";
    if (ratio > 43) return isDarkMode ? "text-amber-400" : "text-amber-600";
    return defaultMetricColor;
  };

  const getPullthroughColor = (pct: number | null | undefined): string => {
    if (pct == null || pct === 0)
      return isDarkMode ? "text-slate-400" : "text-slate-500";
    if (pct >= 80) return isDarkMode ? "text-emerald-400" : "text-emerald-600";
    if (pct >= 60) return isDarkMode ? "text-amber-400" : "text-amber-600";
    return isDarkMode ? "text-rose-400" : "text-rose-600";
  };

  const getTimeInMotionColor = (days: number | null | undefined, loan?: unknown): string => {
    const codes = reasonCodesForLoan(loan);
    const zone = getZoneFromReasonCodes(codes, "days_active");
    const zoneClass = getZoneColorClass(zone ?? null, isDarkMode);
    if (zoneClass) return zoneClass;
    if (codes != null && codes.length > 0) return defaultMetricColor;
    if (days == null || days === 0)
      return isDarkMode ? "text-slate-400" : "text-slate-500";
    if (days > 45) return isDarkMode ? "text-rose-400" : "text-rose-600";
    if (days >= 30) return isDarkMode ? "text-amber-400" : "text-amber-600";
    return defaultMetricColor;
  };

  const getPredictedOutcomeColor = (
    outcome: string | undefined,
    loan?: { closeLateRisk?: boolean | null; estimatedClosingDate?: string | null },
  ): string => {
    if (!outcome) return isDarkMode ? "text-slate-300" : "text-slate-900";
    if (isLoanPastEcd(loan)) {
      return isDarkMode
        ? "text-orange-300 bg-orange-600/20"
        : "text-orange-800 bg-orange-200";
    }
    const outcomeLower = outcome.toLowerCase();
    if (outcomeLower === "deny") {
      return isDarkMode
        ? "text-red-300 bg-red-600/20"
        : "text-red-700 bg-red-100";
    }
    if (outcomeLower === "withdraw") {
      return isDarkMode
        ? "text-orange-300 bg-orange-500/20"
        : "text-orange-700 bg-orange-100";
    }
    if (outcomeLower === "originate" && loan?.closeLateRisk === true) {
      return isDarkMode
        ? "text-amber-300 bg-amber-500/20"
        : "text-amber-700 bg-amber-100";
    }
    return isDarkMode ? "text-slate-300" : "text-slate-900";
  };

  const getSignalBucketColor = (bucket: number | null | undefined): string => {
    if (bucket === null || bucket === undefined) {
      return isDarkMode
        ? "text-slate-400 bg-slate-700/50"
        : "text-slate-500 bg-slate-100";
    }
    const b = Number(bucket);
    if (Number.isNaN(b)) {
      return isDarkMode
        ? "text-slate-400 bg-slate-700/50"
        : "text-slate-500 bg-slate-100";
    }
    if (b <= 2) {
      return isDarkMode
        ? "text-emerald-400 bg-emerald-900/30"
        : "text-emerald-600 bg-emerald-50";
    }
    if (b <= 4) {
      return isDarkMode
        ? "text-amber-400 bg-amber-900/30"
        : "text-amber-600 bg-amber-50";
    }
    return isDarkMode
      ? "text-rose-400 bg-rose-900/30"
      : "text-rose-600 bg-rose-50";
  };

  // Helper function to get critical loans table export data (headers + rows for CSV/Excel)
  const getCriticalLoansExportData = useCallback(() => {
    const headers = [
      "Loan Number",
      "Loan Amount",
      "MLO/AE",
      "Est. Commission at Risk",
      "Predicted Outcome",
      "Risk Score",
      "FICO",
      "LTV",
      "DTI",
      "LO Pullthrough",
      "Time in Motion",
      "Loan Type",
      "Loan Purpose",
      "Channel",
      "Milestone",
      "Application Date",
      "Est. Closing Date",
      "Ref. Market Rate",
      "Market Rate Today",
      "Market Delta",
      "Lock Status",
      "Credit Metrics",
      "Loan Characteristics",
      "Time in Motion Signal",
      "MLO Fallout Prone",
      "Lock vs Market",
    ];

    const rows = sortedCriticalLoans.map((loan) => {
      const commission = formatCommission(loan);
      return [
        loan.loan_number || "",
        formatAmount(loan.amountValue),
        loan.officer || "",
        commission,
        getPredictedOutcomeLabel(loan.riskSummary?.predictedOutcome, loan),
        formatNumber(loan.riskScore),
        formatNumber(loan.ficoScore),
        formatPercent(loan.ltvRatio),
        formatPercent(loan.dtiRatio),
        formatPercent(loan.loPullthroughPct),
        loan.activeDays !== null && loan.activeDays !== undefined
          ? `${loan.activeDays} days`
          : "",
        loan.loanType || "",
        loan.loanPurpose || "",
        loan.channel || "",
        loan.currentMilestone || "",
        formatDate((loan as any).applicationDate),
        formatDate(loan.estimatedClosingDate),
        formatRate((loan as any).lockMarketRate),
        formatRate(loan.marketRate),
        (loan as any).marketChangeDelta != null && (loan as any).marketChangeDelta !== ""
          ? `${Number((loan as any).marketChangeDelta) > 0 ? "+" : ""}${formatRate((loan as any).marketChangeDelta)}`
          : "",
        getLockStatus(loan),
        formatNumber(loan.creditMetricsSignalStrength),
        formatNumber(loan.loanCharacteristicsSignalStrength),
        formatNumber(loan.timeInMotionSignalStrength),
        formatNumber(loan.mloAeFalloutProneSignalStrength),
        formatNumber(loan.interestLockVsMarketSignalStrength),
      ];
    });

    return { headers, rows };
  }, [sortedCriticalLoans]);

  const exportToCSV = useCallback(() => {
    if (sortedCriticalLoans.length === 0) return;

    const { headers, rows } = getCriticalLoansExportData();

    // Convert to CSV format
    const escapeCSV = (value: string): string => {
      if (value.includes(",") || value.includes('"') || value.includes("\n")) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    };

    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n");

    // Create blob and download
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `critical-loans-${new Date().toISOString().split("T")[0]}.csv`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [sortedCriticalLoans, getCriticalLoansExportData]);

  const exportToExcel = useCallback(() => {
    if (sortedCriticalLoans.length === 0) return;

    const { headers, rows } = getCriticalLoansExportData();

    // Escape XML characters
    const escapeXML = (value: string): string => {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;");
    };

    // Create XML Spreadsheet format (Excel-compatible)
    let xml = '<?xml version="1.0"?>\n';
    xml += '<?mso-application progid="Excel.Sheet"?>\n';
    xml += '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:o="urn:schemas-microsoft-com:office:office"\n';
    xml += ' xmlns:x="urn:schemas-microsoft-com:office:excel"\n';
    xml += ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"\n';
    xml += ' xmlns:html="http://www.w3.org/TR/REC-html40">\n';
    xml += '<Worksheet ss:Name="Critical Loans">\n';
    xml += "<Table>\n";

    // Add header row
    xml += "<Row>\n";
    headers.forEach((header) => {
      xml += `<Cell><Data ss:Type="String">${escapeXML(header)}</Data></Cell>\n`;
    });
    xml += "</Row>\n";

    // Add data rows
    rows.forEach((row) => {
      xml += "<Row>\n";
      row.forEach((cell) => {
        const cellValue = String(cell || "");
        // Try to detect if it's a number
        const numValue = parseFloat(cellValue.replace(/[$,%]/g, ""));
        if (!isNaN(numValue) && cellValue.trim() !== "") {
          xml += `<Cell><Data ss:Type="Number">${numValue}</Data></Cell>\n`;
        } else {
          xml += `<Cell><Data ss:Type="String">${escapeXML(cellValue)}</Data></Cell>\n`;
        }
      });
      xml += "</Row>\n";
    });

    xml += "</Table>\n";
    xml += "</Worksheet>\n";
    xml += "</Workbook>";

    // Create blob and download
    const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute(
      "download",
      `critical-loans-${new Date().toISOString().split("T")[0]}.xls`,
    );
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [sortedCriticalLoans, getCriticalLoansExportData]);

  // Animated values for main metrics
  const animatedActiveLoans = useCountUp(
    metrics.activeLoansToday,
    1500,
    0,
    isAnimating,
  );
  const animatedClosedLoans = useCountUp(
    metrics.closedLoansMTD,
    1500,
    200,
    isAnimating,
  );
  const animatedPredictedClosing = useCountUp(
    metrics.predictedClosing,
    1500,
    400,
    isAnimating,
  );
  const animatedLikelyCloseLate = useCountUp(
    metrics.likelyCloseLate,
    1500,
    600,
    isAnimating,
  );
  const animatedPastEstClose = useCountUp(
    metrics.pastEstClose,
    1500,
    700,
    isAnimating,
  );

  // Animated values for outcome metrics
  const animatedPredictedFallout = useCountUp(
    metrics.predictedFalloutTotal,
    1500,
    0,
    isAnimating,
  );
  const animatedHighRisk = useCountUp(
    metrics.highRiskCount,
    1500,
    0,
    isAnimating,
  );
  const animatedWithdraw = useCountUp(
    metrics.likelyWithdraw,
    1500,
    200,
    isAnimating,
  );
  const animatedDecline = useCountUp(
    metrics.likelyDecline,
    1500,
    400,
    isAnimating,
  );

  const ensureLoansLoaded = async (
    periodToUse?: PeriodValue,
  ): Promise<void> => {
    // If no period specified, only load when we don't have loans yet (session cache uses one "all" set)
    if (!periodToUse && (loansRaw || loansLoading)) return;

    setLoansLoading(true);
    setLoansError(null);
    try {
      const now = new Date();
      // Always request the full set ('all') so metrics for every period can be computed client-side
      const { start, end } = getPeriodRange(periodToUse ?? "all", now);

      // NOTE: A new /api/dashboard/overview endpoint is available that computes metrics server-side.
      // To fully optimize, refactor this component to use that endpoint instead of client-side computation.
      // For now, keep fetching 5000 loans for accurate client-side metrics.
      const params = new URLSearchParams();
      params.append("limit", "5000"); // Full dataset needed for accurate client-side metrics
      params.append("offset", "0");

      // Add date filters if period is not 'all'
      if (start) {
        params.append("start_date", start.toISOString().split("T")[0]);
      }
      if (end) {
        params.append("end_date", end.toISOString().split("T")[0]);
      }

      // Add tenant_id for super_admin viewing other tenants
      if (selectedTenantId) {
        params.append("tenant_id", selectedTenantId);
      }

      const res = await api.request<{ loans: any[] }>(
        `/api/loans?${params.toString()}`,
      );
      setLoansRaw(res.loans || []);
    } catch (e: any) {
      const errorMsg = e?.message || "Failed to load loans";
      // Silently handle common startup/auth errors
      if (
        errorMsg.includes("Database not initialized") ||
        errorMsg.includes("not found") ||
        errorMsg.includes("Unauthorized") ||
        errorMsg.includes("Tenant not found")
      ) {
        setLoansRaw([]);
      } else {
        console.error("[Signal Buckets] Error loading loans:", errorMsg);
        setLoansError(errorMsg);
        setLoansRaw([]);
      }
    } finally {
      setLoansLoading(false);
    }
  };

  useEffect(() => {
    if (insightsTab === "officers") {
      ensureLoansLoaded();
    }
  }, [insightsTab, ensureLoansLoaded]);

  const loanOfficerData = useMemo(() => {
    if (!loansRaw || loansRaw.length === 0) return [];
    const now = new Date();
    const filtered = loansRaw.filter((loan) => {
      if (deferredPeriod === "all") return true;
      const date =
        loan?.application_date ||
        loan?.started_date ||
        loan?.start_date ||
        loan?.closing_date ||
        loan?.lock_date ||
        loan?.fund_date ||
        null;
      return isDateInPeriod(date, deferredPeriod, now);
    });
    const cards = filtered.map((loan) => transformLoanToCard(loan));
    return aggregateLoanOfficers(cards);
  }, [loansRaw, deferredPeriod]);

  const scrollToCriticalLoans = (tab: TabType) => {
    setInsightsTab("critical");
    setCriticalOutcomeFilter(tab);
    requestAnimationFrame(() => {
      criticalLoansSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const handleMetricClick = async (label: string) => {
    await ensureLoansLoaded();

    if (label === "Predicted Fallout") {
      scrollToCriticalLoans("all");
      return;
    }
    if (label === "High Risk") {
      scrollToCriticalLoans("high-risk");
      return;
    }
    if (label === "Likely Withdraw") {
      scrollToCriticalLoans("likely-withdraw");
      return;
    }
    if (label === "Likely Decline") {
      scrollToCriticalLoans("likely-decline");
      return;
    }
    if (label === "Likely Close Late") {
      scrollToCriticalLoans("likely-close-late");
      return;
    }

    // Metric drilldown modal
    setMetricModalLabel(label);
  };

  // Fetch fallout status for visible critical loan cards
  useEffect(() => {
    if (!canManageFalloutAlerts || criticalLoanCards.length === 0) return;
    const loanIds = criticalLoanCards.map((l: any) => l.id).filter(Boolean);
    if (loanIds.length === 0) return;
    api.getLoanFalloutStatuses(loanIds, selectedTenantId || undefined)
      .then((result) => {
        const map = new Map<string, LoanFalloutStatus>();
        for (const s of result.statuses) {
          map.set(s.loan_id, s as LoanFalloutStatus);
        }
        setFalloutStatusMap(map);
      })
      .catch(() => {});
  }, [criticalLoanCards, selectedTenantId, canManageFalloutAlerts]);

  return (
    <TooltipProvider>
      <div className="mb-8 md:mb-12 min-w-0 max-w-full">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 lg:gap-10 items-stretch min-w-0">
          {/* Main Forecast Section */}
          <div className="md:col-span-12 flex flex-col min-w-0">
            <div ref={forecastRef}>
              <DashboardCard className="relative flex-1 flex flex-col">
                <div className="p-6 md:p-10 lg:p-12 flex-1 flex flex-col">
                  {/* Header */}
                  <div className="mb-8 md:mb-10 flex items-start justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0">
                      <div className="relative flex-shrink-0">
                        <div className="w-10 h-10 sm:w-14 sm:h-14 rounded-xl sm:rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
                          <TrendingUp className="w-5 h-5 sm:w-7 sm:h-7 text-white" />
                        </div>
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-lg sm:text-2xl md:text-3xl font-extralight text-slate-900 dark:text-white mb-0.5 tracking-tight leading-tight truncate">
                          Closings & Fallout Forecast
                        </h3>
                        <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light truncate">
                          Predictive insights and closing forecasts
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 flex-wrap">
                      <ExportMenu
                        title="Closing & Fallout Forecast"
                        targetRef={forecastRef}
                        getExportData={getExportData}
                      />
                      {/* Start Prediction - manual trigger; disabled until run completes */}
                      <Button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          runPrediction();
                        }}
                        disabled={predictionsLoading}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs font-medium uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white border-0 shadow-sm disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed"
                        title={
                          predictionsLoading
                            ? "Prediction in progress…"
                            : "Analyze loans and calculate risk signals"
                        }
                      >
                        <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                        {predictionsLoading ? "Running…" : "Start Prediction"}
                      </Button>
                      {/* Active Loans Period Filter - filters by application date */}
                      <ActiveLoansPeriodDropdown
                        period={activeLoansPeriod}
                        onPeriodChange={setActiveLoansPeriod}
                        isDarkMode={isDarkMode}
                      />
                    </div>
                  </div>

                  {/* Main Metrics Grid - 4 KPIs centered */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:gap-6 md:gap-8 lg:gap-12 mb-8 md:mb-12 max-w-5xl mx-auto">
                    {/* Active Loans Today */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 group/stat transition-all duration-300">
                          <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                            <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                              Active Loans{" "}
                              <span className="normal-case font-medium text-slate-400 dark:text-slate-500">
                                ({ACTIVE_LOANS_PERIOD_OPTIONS.find((o) => o.value === activeLoansPeriod)?.label ?? "All Time"})
                              </span>
                            </p>
                            <span className="px-1 sm:px-1.5 py-0.5 rounded text-[6px] sm:text-[7px] font-bold uppercase tracking-wide bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                              Live
                            </span>
                          </div>
                          <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                            {isAnimating
                              ? animatedActiveLoans.toLocaleString()
                              : metrics.activeLoansToday.toLocaleString()}
                          </p>
                          <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium">
                            Units
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("Active Loans Today").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("Active Loans Today").desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    {/* Predicted Closing */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 group/stat transition-all duration-300">
                          <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                            <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                              Predicted Closing
                            </p>
                          </div>
                          <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                            {isAnimating
                              ? animatedPredictedClosing.toLocaleString()
                              : metrics.predictedClosing.toLocaleString()}
                          </p>
                          <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium">
                            Units
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("Predicted Closing").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("Predicted Closing").desc}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">
                          Pull-through uses Rolling 90 Days and excludes active
                          loans for accuracy.
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    {/* Likely Close Late */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 group/stat transition-all duration-300">
                          <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                            <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                              Likely Close Late
                            </p>
                          </div>
                          <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] text-slate-900 dark:text-slate-50">
                            {isAnimating
                              ? animatedLikelyCloseLate.toLocaleString()
                              : metrics.likelyCloseLate.toLocaleString()}
                          </p>
                          <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium">
                            Units
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("Likely Close Late").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("Likely Close Late").desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    {/* Past Est. Close Date */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 group/stat transition-all duration-300">
                          <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                            <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                              Past Est. Close
                            </p>
                            {metrics.pastEstClose > 0 && (
                              <span className="px-1 sm:px-1.5 py-0.5 rounded text-[6px] sm:text-[7px] font-bold uppercase tracking-wide bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400">
                                Alert
                              </span>
                            )}
                          </div>
                          <p
                            className={`text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] ${
                              metrics.pastEstClose > 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-slate-900 dark:text-slate-50"
                            }`}
                          >
                            {isAnimating
                              ? animatedPastEstClose.toLocaleString()
                              : metrics.pastEstClose.toLocaleString()}
                          </p>
                          <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium">
                            Units
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("Past Est. Close").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("Past Est. Close").desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Pipeline Volume / Historical Rolling 90D Pullthrough / Locked Loans / Projected Pullthrough row */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 md:gap-6 lg:gap-8 mb-8 md:mb-12">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 cursor-default">
                          <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                            Pipeline Volume
                          </p>
                          <p className="text-xl sm:text-2xl md:text-3xl font-thin tracking-tight text-slate-900 dark:text-slate-50">
                            {kpis[0].value}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          Pipeline Volume
                        </p>
                        <p className="text-xs text-slate-300">
                          {kpis[0].explanation}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 cursor-default">
                          <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                            Historical Rolling 90 Days Pullthrough
                          </p>
                          <p className="text-xl sm:text-2xl md:text-3xl font-thin tracking-tight text-slate-900 dark:text-slate-50">
                            {kpis[2].value}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          Historical Rolling 90 Days Pullthrough
                        </p>
                        <p className="text-xs text-slate-300">
                          {kpis[2].explanation}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 cursor-default">
                          <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                            Projected Pullthrough
                          </p>
                          <p className="text-xl sm:text-2xl md:text-3xl font-thin tracking-tight text-slate-900 dark:text-slate-50">
                            {kpis[3].value}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[280px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          Projected Pullthrough
                        </p>
                        <p className="text-xs text-slate-300">
                          {kpis[3].explanation}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="text-center space-y-1 sm:space-y-2 cursor-default">
                          <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                            Locked Loans
                          </p>
                          <p className="text-xl sm:text-2xl md:text-3xl font-thin tracking-tight text-slate-900 dark:text-slate-50">
                            {kpis[1].value}
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          Locked Loans
                        </p>
                        <p className="text-xs text-slate-300">
                          {kpis[1].explanation}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Outcome Metrics Grid */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 md:gap-6 lg:gap-8 mt-auto">
                    {/* High Risk */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onClick={() => handleMetricClick("High Risk")}
                          className="p-3 sm:p-5 md:p-6 lg:p-8 rounded-xl md:rounded-xl lg:rounded-2xl border transition-all duration-300 cursor-pointer group/outcome text-center overflow-hidden bg-white dark:bg-slate-900/30 border-slate-200/60 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:hover:bg-slate-800/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                        >
                          <p className="text-[8px] sm:text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-wide sm:tracking-widest mb-1.5 sm:mb-2 lg:mb-3 leading-tight text-rose-600 dark:text-rose-400">
                            High Risk
                          </p>
                          <p className="text-base sm:text-xl md:text-2xl lg:text-3xl font-light tracking-tight text-rose-500 dark:text-rose-400">
                            {isAnimating
                              ? animatedHighRisk.toLocaleString()
                              : metrics.highRiskCount.toLocaleString()}
                          </p>
                          <p className="text-[8px] sm:text-xs md:text-sm text-slate-400 font-normal mt-1 uppercase">
                            of {metrics.predictedFalloutTotal} fallout
                          </p>
                          <p className="text-[7px] sm:text-[9px] md:text-[10px] text-slate-400 font-normal mt-0.5 uppercase">
                            80/100 risk or higher
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("High Risk").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("High Risk").desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    {/* Likely Withdraw */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onClick={() => handleMetricClick("Likely Withdraw")}
                          className="p-3 sm:p-5 md:p-6 lg:p-8 rounded-xl md:rounded-xl lg:rounded-2xl border transition-all duration-300 cursor-pointer group/outcome text-center overflow-hidden bg-white dark:bg-slate-900/30 border-slate-200/60 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:hover:bg-slate-800/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                        >
                          <p className="text-[8px] sm:text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-wide sm:tracking-widest mb-1.5 sm:mb-2 lg:mb-3 leading-tight text-slate-500 dark:text-slate-400">
                            Likely Withdraw
                          </p>
                          <p className="text-base sm:text-xl md:text-2xl lg:text-3xl font-light tracking-tight text-slate-900 dark:text-slate-50">
                            {isAnimating
                              ? animatedWithdraw.toLocaleString()
                              : metrics.likelyWithdraw.toLocaleString()}
                          </p>
                          <p className="text-[8px] sm:text-xs md:text-sm text-slate-400 font-normal mt-1 uppercase">
                            Units
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("Likely Withdraw").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("Likely Withdraw").desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>

                    {/* Likely Decline */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onClick={() => handleMetricClick("Likely Decline")}
                          className="p-3 sm:p-5 md:p-6 lg:p-8 rounded-xl md:rounded-xl lg:rounded-2xl border transition-all duration-300 cursor-pointer group/outcome text-center overflow-hidden bg-white dark:bg-slate-900/30 border-slate-200/60 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:hover:bg-slate-800/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                        >
                          <p className="text-[8px] sm:text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-wide sm:tracking-widest mb-1.5 sm:mb-2 lg:mb-3 leading-tight text-slate-500 dark:text-slate-400">
                            Likely Decline
                          </p>
                          <p className="text-base sm:text-xl md:text-2xl lg:text-3xl font-light tracking-tight text-slate-900 dark:text-slate-50">
                            {isAnimating
                              ? animatedDecline.toLocaleString()
                              : metrics.likelyDecline.toLocaleString()}
                          </p>
                          <p className="text-[8px] sm:text-xs md:text-sm text-slate-400 font-normal mt-1 uppercase">
                            Units
                          </p>
                        </div>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                        <p className="font-semibold mb-1 text-white">
                          {getMetricExplanation("Likely Decline").title}
                        </p>
                        <p className="text-xs text-slate-300">
                          {getMetricExplanation("Likely Decline").desc}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              </DashboardCard>
            </div>
          </div>

          {/* Pipeline Snapshot Section removed — KPIs moved to main panel */}
        </div>

        {/* ============================================================================
            TESTING: Loan Signal Strength Buckets Table
            This section displays signal strength buckets for each loan.
            Controlled by SHOW_SIGNAL_BUCKETS_TABLE flag above.
            Always shows table structure (headers) even when no data, so you can see the template.
            ============================================================================ */}
        {SHOW_SIGNAL_BUCKETS_TABLE && (
          <section
            className={`mt-6 md:mt-12 md:rounded-2xl md:border overflow-hidden ${
              isDarkMode
                ? "bg-transparent md:bg-slate-900/50 md:border-white/10 md:shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
                : "bg-transparent md:bg-white md:border-slate-200 md:shadow-[0_8px_32px_rgba(15,23,42,0.08)]"
            }`}
            data-testid="signal-buckets-table"
          >
            <div
              className={`p-4 md:p-6 border-b ${
                isDarkMode ? "border-white/10" : "border-slate-100"
              }`}
            >
              <h3 className="text-sm md:text-base font-semibold text-slate-900 dark:text-white">
                Loan Signal Strength Buckets
              </h3>
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Signal strength buckets (1 = less fallout prone, 6 = more
                fallout prone) for each active loan
              </p>
              {(predictionsLoading || loansLoading) && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Loading data...
                </p>
              )}
              {loansError && (
                <p className="text-xs text-rose-500 dark:text-rose-400 mt-2">
                  Error: {loansError}
                </p>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs md:text-sm">
                <thead>
                  <tr
                    className={`border-b ${
                      isDarkMode
                        ? "border-white/10 bg-slate-800/50"
                        : "border-slate-100 bg-slate-50"
                    }`}
                  >
                    <th className="text-left py-3 px-3 font-semibold text-slate-700 dark:text-slate-300 sticky left-0 z-10 bg-inherit text-[11px]">
                      Loan #
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Loan Type
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Purpose
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Occup
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      FICO
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      LTV
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      DTI
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Self-Emp
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Time
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      LO Pull
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      UW Pull
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Proc Pull
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Close Pull
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Lock Exp
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                      Market Δ
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-blue-700 dark:text-blue-300 text-[11px] border-l border-slate-200 dark:border-white/10">
                      Credit Risk
                    </th>
                    <th className="text-center py-3 px-2 font-semibold text-purple-700 dark:text-purple-300 text-[11px]">
                      Process Risk
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bucketedLoans.length > 0 ? (
                    (() => {
                      // Calculate pagination
                      const startIndex = (currentPage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      const paginatedLoans = bucketedLoans.slice(
                        startIndex,
                        endIndex,
                      );

                      return paginatedLoans.map((loan, idx) => {
                        const getBucketColor = (bucket: number | null) => {
                          if (bucket === null)
                            return "text-slate-400 dark:text-slate-500";
                          if (bucket <= 2)
                            return "text-emerald-600 dark:text-emerald-400 font-semibold";
                          if (bucket <= 4)
                            return "text-yellow-600 dark:text-yellow-400";
                          return "text-rose-600 dark:text-rose-400 font-semibold";
                        };

                        const getBucketBg = (bucket: number | null) => {
                          if (bucket === null) return "";
                          if (bucket <= 2)
                            return "bg-emerald-50/50 dark:bg-emerald-950/20";
                          if (bucket <= 4)
                            return "bg-yellow-50/50 dark:bg-yellow-950/20";
                          return "bg-rose-50/50 dark:bg-rose-950/20";
                        };

                        const BucketCell = ({ value }: { value: number | null | undefined }) => (
                          <td
                            className={`py-2 px-2 text-center font-mono tabular-nums text-[11px] ${getBucketColor(
                              value ?? null,
                            )} ${getBucketBg(value ?? null)}`}
                          >
                            {value ?? "—"}
                          </td>
                        );

                        const getScoreColor = (score: number | null | undefined) => {
                          if (score == null) return "text-slate-400 dark:text-slate-500";
                          if (score >= 75) return "text-rose-600 dark:text-rose-400 font-semibold";
                          if (score >= 60) return "text-orange-600 dark:text-orange-400 font-semibold";
                          if (score >= 40) return "text-yellow-600 dark:text-yellow-400";
                          return "text-emerald-600 dark:text-emerald-400";
                        };

                        const creditScore = loan.riskSummary?.creditRiskScore ?? null;
                        const processScore = loan.riskSummary?.processRiskScore ?? null;

                        return (
                          <tr
                            key={loan.loanId || loan.id || idx}
                            className={`border-b cursor-pointer ${
                              isDarkMode
                                ? "border-white/5 hover:bg-slate-800/30"
                                : "border-slate-100 hover:bg-slate-50/50"
                            } transition-colors`}
                            onClick={() => setSelectedLoanForDetail(loan)}
                            title="Click to view loan risk details"
                          >
                            <td
                              className={`py-2 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300 sticky left-0 z-10 ${
                                isDarkMode ? "bg-slate-900/50" : "bg-white"
                              } shadow-[2px_0_4px_rgba(0,0,0,0.05)]`}
                            >
                              {loan.loan_number || loan.loanNumber || loan.loanId || loan.loan_id || loan.id || "N/A"}
                            </td>
                            <BucketCell value={loan.loanTypeSignal} />
                            <BucketCell value={loan.loanPurposeSignal} />
                            <BucketCell value={loan.occupancyTypeSignal} />
                            <BucketCell value={loan.ficoScoreSignal} />
                            <BucketCell value={loan.ltvSignal} />
                            <BucketCell value={loan.dtiSignal} />
                            <BucketCell value={loan.selfEmployedSignal} />
                            <BucketCell
                              value={
                                loan.timeInMotionSignal ??
                                loan.timeInMotionSignalStrength
                              }
                            />
                            <BucketCell
                              value={
                                loan.loPullthroughSignal ??
                                loan.mloAeFalloutProneSignalStrength
                              }
                            />
                            <BucketCell
                              value={
                                loan.uwPullthroughSignal ??
                                loan.uwPullthroughSignalStrength
                              }
                            />
                            <BucketCell
                              value={
                                loan.processorPullthroughSignal ??
                                loan.processorPullthroughSignalStrength
                              }
                            />
                            <BucketCell
                              value={
                                loan.closerPullthroughSignal ??
                                loan.closerPullthroughSignalStrength
                              }
                            />
                            <BucketCell value={loan.lockExpirationDaysRemainingSignal} />
                            <BucketCell
                              value={
                                loan.marketChangeDeltaSignal ??
                                loan.interestLockVsMarketSignalStrength
                              }
                            />
                            <td
                              className={`py-2 px-2 text-center font-mono tabular-nums text-[11px] border-l ${
                                isDarkMode ? "border-white/10" : "border-slate-200"
                              } ${getScoreColor(creditScore)}`}
                            >
                              {creditScore ?? "—"}
                            </td>
                            <td
                              className={`py-2 px-2 text-center font-mono tabular-nums text-[11px] ${getScoreColor(processScore)}`}
                            >
                              {processScore ?? "—"}
                            </td>
                          </tr>
                        );
                      });
                    })()
                  ) : (
                    <tr>
                      <td
                        colSpan={17}
                        className="py-8 px-4 text-center text-sm text-slate-500 dark:text-slate-400"
                      >
                        {predictionsLoading || loansLoading
                          ? "Loading loan data and calculating signal strength buckets..."
                          : loansError
                            ? `Unable to load loans: ${loansError}`
                            : bucketedLoans.length === 0 &&
                                loansRaw &&
                                loansRaw.length > 0
                              ? `Loaded ${loansRaw.length} loans but no bucketed data received. Check console for errors.`
                              : `No loan data available. Upload a CSV file or ensure loans are loaded to see signal strength buckets. (loansRaw: ${
                                  loansRaw?.length || 0
                                }, bucketedLoans: ${bucketedLoans.length})`}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {bucketedLoans.length > 0 && (
              <div
                className={`p-4 md:p-6 border-t ${
                  isDarkMode
                    ? "border-white/10 bg-slate-800/30"
                    : "border-slate-100 bg-slate-50"
                }`}
              >
                <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* Items per page selector */}
                  <div className="flex items-center gap-2">
                    <label className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
                      Show:
                    </label>
                    <select
                      value={itemsPerPage}
                      onChange={(e) => {
                        setItemsPerPage(Number(e.target.value));
                        setCurrentPage(1); // Reset to first page when changing items per page
                      }}
                      className={`text-xs md:text-sm px-2 py-1 rounded border ${
                        isDarkMode
                          ? "bg-slate-700 border-white/20 text-slate-200"
                          : "bg-white border-slate-300 text-slate-700"
                      } focus:outline-none focus:ring-2 focus:ring-blue-500`}
                    >
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                    </select>
                    <span className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
                      per page
                    </span>
                  </div>

                  {/* Pagination info */}
                  <div className="text-xs md:text-sm text-slate-600 dark:text-slate-400">
                    Showing{" "}
                    {Math.min(
                      (currentPage - 1) * itemsPerPage + 1,
                      bucketedLoans.length,
                    )}{" "}
                    -{" "}
                    {Math.min(currentPage * itemsPerPage, bucketedLoans.length)}{" "}
                    of {bucketedLoans.length} loans
                  </div>

                  {/* Pagination controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className={`px-2 py-1 text-xs md:text-sm rounded ${
                        currentPage === 1
                          ? "opacity-50 cursor-not-allowed text-slate-400"
                          : isDarkMode
                            ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100"
                      } border ${
                        isDarkMode ? "border-white/20" : "border-slate-300"
                      }`}
                    >
                      First
                    </button>
                    <button
                      onClick={() =>
                        setCurrentPage((prev) => Math.max(1, prev - 1))
                      }
                      disabled={currentPage === 1}
                      className={`px-3 py-1 text-xs md:text-sm rounded ${
                        currentPage === 1
                          ? "opacity-50 cursor-not-allowed text-slate-400"
                          : isDarkMode
                            ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100"
                      } border ${
                        isDarkMode ? "border-white/20" : "border-slate-300"
                      }`}
                    >
                      Previous
                    </button>
                    <span className="text-xs md:text-sm text-slate-600 dark:text-slate-400 px-2">
                      Page {currentPage} of{" "}
                      {Math.ceil(bucketedLoans.length / itemsPerPage)}
                    </span>
                    <button
                      onClick={() =>
                        setCurrentPage((prev) =>
                          Math.min(
                            Math.ceil(bucketedLoans.length / itemsPerPage),
                            prev + 1,
                          ),
                        )
                      }
                      disabled={
                        currentPage >=
                        Math.ceil(bucketedLoans.length / itemsPerPage)
                      }
                      className={`px-3 py-1 text-xs md:text-sm rounded ${
                        currentPage >=
                        Math.ceil(bucketedLoans.length / itemsPerPage)
                          ? "opacity-50 cursor-not-allowed text-slate-400"
                          : isDarkMode
                            ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100"
                      } border ${
                        isDarkMode ? "border-white/20" : "border-slate-300"
                      }`}
                    >
                      Next
                    </button>
                    <button
                      onClick={() =>
                        setCurrentPage(
                          Math.ceil(bucketedLoans.length / itemsPerPage),
                        )
                      }
                      disabled={
                        currentPage >=
                        Math.ceil(bucketedLoans.length / itemsPerPage)
                      }
                      className={`px-2 py-1 text-xs md:text-sm rounded ${
                        currentPage >=
                        Math.ceil(bucketedLoans.length / itemsPerPage)
                          ? "opacity-50 cursor-not-allowed text-slate-400"
                          : isDarkMode
                            ? "bg-slate-700 text-slate-200 hover:bg-slate-600"
                            : "bg-white text-slate-700 hover:bg-slate-100"
                      } border ${
                        isDarkMode ? "border-white/20" : "border-slate-300"
                      }`}
                    >
                      Last
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Critical Loans and Top Loan Officers Section - width constrained so table tab cannot expand */}
        <section
          ref={criticalLoansSectionRef}
          className="mt-6 md:mt-12 md:rounded-2xl md:border overflow-hidden lg:min-h-[480px] min-w-0 max-w-full w-full box-border bg-transparent md:bg-white dark:md:bg-slate-900/70 md:border-slate-100 dark:md:border-slate-800 md:shadow-[0_8px_32px_rgba(15,23,42,0.08)] dark:md:shadow-[0_8px_32px_rgba(0,0,0,0.24)]"
          style={{ width: "100%", maxWidth: "100%", minWidth: 0 }}
        >
          <div
            className={`flex border-b min-w-0 ${
              isDarkMode ? "border-white/10" : "border-slate-100"
            }`}
          >
            <button
              onClick={() => setInsightsTab("critical")}
              className={`flex-1 py-4 lg:py-5 px-6 text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-widest transition-all ${
                insightsTab === "critical"
                  ? isDarkMode
                    ? "bg-slate-800/50 text-white border-b-2 border-rose-500"
                    : "bg-slate-50 text-slate-900 border-b-2 border-rose-500"
                  : isDarkMode
                    ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/30"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                Critical Loans
              </span>
            </button>
            <button
              onClick={() => setInsightsTab("officers")}
              className={`flex-1 py-4 lg:py-5 px-6 text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-widest transition-all ${
                insightsTab === "officers"
                  ? isDarkMode
                    ? "bg-slate-800/50 text-white border-b-2 border-indigo-500"
                    : "bg-slate-50 text-slate-900 border-b-2 border-indigo-500"
                  : isDarkMode
                    ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/30"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <Table className="w-4 h-4" />
                Critical Loans Table
              </span>
            </button>
            {canManageFalloutAlerts && (
              <a
                href="/workbench/distributions?tab=fallout"
                className={`flex-1 py-4 lg:py-5 px-6 text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-widest transition-all ${
                  isDarkMode
                    ? "text-slate-400 hover:text-slate-300 hover:bg-slate-800/30"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <span className="flex items-center justify-center gap-2">
                  <BarChart3 className="w-4 h-4" />
                  Distribution ↗
                </span>
              </a>
            )}
          </div>

          <div className="py-2 md:p-3 lg:p-4 min-w-0 w-full overflow-hidden">
            {insightsTab === "critical" && (
              <div className="min-w-0">
                {loansError ? (
                  <div
                    className={`text-sm py-6 text-center ${
                      isDarkMode ? "text-rose-400" : "text-rose-600"
                    }`}
                  >
                    {loansError}
                  </div>
                ) : loansLoading && !loansRaw ? (
                  <div
                    className={`text-sm py-6 text-center ${
                      isDarkMode ? "text-slate-400" : "text-slate-500"
                    }`}
                  >
                    Loading loans…
                  </div>
                ) : null}
                <LoanCardsContainer
                  loans={criticalLoanCards as any}
                  predictions={fullPredictions}
                  isDarkMode={isDarkMode}
                  selectedTenantId={selectedTenantId}
                  openLoanId={openLoanId}
                  onOpenLoanIdHandled={onOpenLoanIdHandled}
                  activeTab={criticalOutcomeFilter}
                  onActiveTabChange={setCriticalOutcomeFilter}
                  falloutStatusMap={falloutStatusMap}
                />
              </div>
            )}

            {insightsTab === "officers" && (
              <div className="w-full min-w-0 max-w-full overflow-hidden">
                {loansLoading && !loansRaw ? (
                  <div
                    className={`text-sm py-6 text-center ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}
                  >
                    Loading loans…
                  </div>
                ) : (
                  <div className="w-full min-w-0 max-w-full overflow-hidden space-y-3">
                    {/* Critical outcome filter (shared with cards) - show when we have critical loans data */}
                    {criticalLoanCards.length > 0 && (() => {
                      const criticalTabs: {
                        id: TabType;
                        label: string;
                        shortLabel: string;
                        color: string;
                      }[] = [
                        {
                          id: "all",
                          label: "All Loans",
                          shortLabel: "All",
                          color: "darkred",
                        },
                        {
                          id: "high-risk",
                          label: "High Risk",
                          shortLabel: "High Risk",
                          color: "darkred",
                        },
                        {
                          id: "likely-withdraw",
                          label: "Likely Withdrawal",
                          shortLabel: "Withdraw",
                          color: "red",
                        },
                        {
                          id: "likely-decline",
                          label: "Likely Decline",
                          shortLabel: "Decline",
                          color: "lightred",
                        },
                        {
                          id: "past-est-closing",
                          label: "Past Est. Closing",
                          shortLabel: "Past ECD",
                          color: "red",
                        },
                        {
                          id: "likely-close-late",
                          label: "Likely Close Late",
                          shortLabel: "Close Late",
                          color: "amber",
                        },
                        {
                          id: "favorites",
                          label: "Favorites",
                          shortLabel: "Favorites",
                          color: "blue",
                        },
                      ];
                      const baseStyle = isDarkMode
                        ? "bg-slate-800 border border-slate-700"
                        : "bg-slate-100 border border-slate-200";
                      const tabColors: Record<
                        string,
                        { active: string; inactive: string }
                      > = {
                        darkred: {
                          active: isDarkMode
                            ? "bg-rose-900 text-white"
                            : "bg-rose-800 text-white",
                          inactive: isDarkMode
                            ? `${baseStyle} text-slate-400`
                            : `${baseStyle} text-slate-600`,
                        },
                        red: {
                          active: isDarkMode
                            ? "bg-rose-600 text-white"
                            : "bg-rose-600 text-white",
                          inactive: isDarkMode
                            ? `${baseStyle} text-slate-400`
                            : `${baseStyle} text-slate-600`,
                        },
                        lightred: {
                          active: isDarkMode
                            ? "bg-rose-400 text-white"
                            : "bg-rose-400 text-white",
                          inactive: isDarkMode
                            ? `${baseStyle} text-slate-400`
                            : `${baseStyle} text-slate-600`,
                        },
                        amber: {
                          active: isDarkMode
                            ? "bg-amber-600 text-white"
                            : "bg-amber-500 text-white",
                          inactive: isDarkMode
                            ? `${baseStyle} text-slate-400`
                            : `${baseStyle} text-slate-600`,
                        },
                        blue: {
                          active: isDarkMode
                            ? "bg-blue-600 text-white"
                            : "bg-blue-600 text-white",
                          inactive: isDarkMode
                            ? `${baseStyle} text-slate-400`
                            : `${baseStyle} text-slate-600`,
                        },
                      };
                      return (
                        <div className="flex gap-1 sm:gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1 min-w-0">
                          {criticalTabs.map((tab) => {
                            const isActive =
                              criticalOutcomeFilter === tab.id;
                            const style = isActive
                              ? tabColors[tab.color]?.active ??
                                tabColors.red.active
                              : tabColors[tab.color]?.inactive ??
                                tabColors.red.inactive;
                            return (
                              <button
                                key={tab.id}
                                type="button"
                                onClick={() =>
                                  setCriticalOutcomeFilter(tab.id)
                                }
                                className={`flex items-center gap-1 px-2 sm:px-3 py-1.5 text-[10px] sm:text-[11px] font-medium whitespace-nowrap transition-all rounded-full active:scale-95 ${style}`}
                              >
                                <span className="sm:hidden">
                                  {tab.shortLabel}
                                </span>
                                <span className="hidden sm:inline">
                                  {tab.label}
                                </span>
                                <span
                                  className={`min-w-[16px] h-[16px] sm:min-w-[18px] sm:h-[18px] px-1 rounded-full text-[8px] sm:text-[9px] font-semibold flex items-center justify-center ${
                                    isActive
                                      ? "bg-white/25"
                                      : isDarkMode
                                        ? "bg-slate-700/80"
                                        : "bg-slate-200/60"
                                  }`}
                                >
                                  {criticalTabCounts[tab.id]}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })()}
                    {sortedCriticalLoans.length === 0 ? (
                      <div
                        className={`text-center py-12 min-w-0 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}
                      >
                        <Table className="w-12 h-12 mx-auto mb-4 opacity-40" />
                        <p className="text-sm font-medium">
                          {criticalLoanCards.length === 0
                            ? "No critical loans found"
                            : "No loans match this filter"}
                        </p>
                        <p className="text-xs mt-1 opacity-70">
                          {criticalLoanCards.length === 0
                            ? "Run predictions to see critical loans in the table"
                            : "Try a different filter"}
                        </p>
                      </div>
                    ) : (
                    <div
                      className={`border rounded-lg ${isDarkMode ? "border-white/10" : "border-slate-200"}`}
                      style={{
                        maxHeight: "45rem",
                        width: "100%",
                        minWidth: 0,
                        maxWidth: "100%",
                        overflowX: "auto",
                        overflowY: "auto",
                        boxSizing: "border-box",
                      }}
                    >
                      <div style={{ minWidth: "min(100%, max-content)", width: "max-content" }}>
                      <table className="table-auto divide-y divide-slate-200 dark:divide-white/10" style={{ width: "max-content" }}>
                        <thead
                          className={`sticky top-0 z-10 ${isDarkMode ? "bg-slate-800/90" : "bg-slate-50"}`}
                        >
                          <tr>
                            {[
                              { key: "loan_number", label: "Loan Number" },
                              { key: "amount", label: "Loan Amount" },
                              { key: "officer", label: "MLO/AE" },
                              {
                                key: "commission",
                                label: "Est. Commission at Risk",
                              },
                              {
                                key: "predictedOutcome",
                                label: "Predicted Outcome",
                              },
                              { key: "riskScore", label: "Risk Score" },
                              { key: "fico", label: "FICO" },
                              { key: "ltv", label: "LTV" },
                              { key: "dti", label: "DTI" },
                              { key: "loPullthrough", label: "LO Pullthrough" },
                              { key: "timeInMotion", label: "Time in Motion" },
                              { key: "loanType", label: "Loan Type" },
                              { key: "loanPurpose", label: "Loan Purpose" },
                              { key: "channel", label: "Channel" },
                              { key: "milestone", label: "Milestone" },
                              {
                                key: "applicationDate",
                                label: "Application Date",
                              },
                              {
                                key: "estimatedClosingDate",
                                label: "Est. Closing Date",
                              },
                              {
                                key: "marketRateAtLock",
                                label: "Ref. Market Rate",
                              },
                              {
                                key: "marketRateToday",
                                label: "Market Rate Today",
                              },
                              { key: "marketDelta", label: "Market Delta" },
                              { key: "lockStatus", label: "Lock Status" },
                              { key: "creditMetrics", label: "Credit Metrics" },
                              {
                                key: "loanCharacteristics",
                                label: "Loan Characteristics",
                              },
                              {
                                key: "timeInMotionSignal",
                                label: "Time in Motion Signal",
                              },
                              {
                                key: "mloFalloutProne",
                                label: "MLO Fallout Prone",
                              },
                              { key: "lockVsMarket", label: "Lock vs Market" },
                            ].map((col) => (
                              <th
                                key={col.key}
                                className={`px-2 py-2 text-left text-xs font-semibold uppercase tracking-wider ${isDarkMode ? "text-slate-300" : "text-slate-700"} whitespace-nowrap`}
                              >
                                <button
                                  onClick={() => handleSort(col.key)}
                                  className="flex items-center justify-between gap-2 hover:opacity-70 transition-opacity w-full"
                                >
                                  <span>{col.label}</span>
                                  <span className="flex-shrink-0">
                                    {sortColumn === col.key ? (
                                      sortDirection === "asc" ? (
                                        <ArrowUp className="w-3 h-3" />
                                      ) : (
                                        <ArrowDown className="w-3 h-3" />
                                      )
                                    ) : (
                                      <ArrowUpDown className="w-3 h-3 opacity-40" />
                                    )}
                                  </span>
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody
                          className={`divide-y ${isDarkMode ? "divide-white/5 bg-slate-900/30" : "divide-slate-200 bg-white"}`}
                        >
                          {sortedCriticalLoans.map((loan, idx) => {
                            const rowReasonCodes = reasonCodesForLoan(loan);
                            return (
                            <tr
                              key={loan.id || idx}
                              className={`hover:${isDarkMode ? "bg-slate-800/50" : "bg-slate-50"} transition-colors cursor-pointer`}
                              onClick={() => setSelectedLoanForDrilldown(loan)}
                            >
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {loan.loan_number || "—"}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatAmount(loan.amountValue)}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {loan.officer || "—"}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatCommission(loan)}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs whitespace-nowrap rounded ${getPredictedOutcomeColor(loan.riskSummary?.predictedOutcome, loan)}`}
                              >
                                {getPredictedOutcomeLabel(
                                  loan.riskSummary?.predictedOutcome,
                                  loan,
                                )}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatNumber(loan.riskScore)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${getFicoColor(loan.ficoScore, rowReasonCodes)}`}
                              >
                                {formatNumber(loan.ficoScore)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${getLtvColor(loan.ltvRatio, rowReasonCodes)}`}
                              >
                                {formatPercent(loan.ltvRatio)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${getDtiColor(loan.dtiRatio, rowReasonCodes)}`}
                              >
                                {formatPercent(loan.dtiRatio)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${getSignalBucketColor(pullthroughPctToMloBucket(loan.loPullthroughPct))}`}
                              >
                                {formatPercent(loan.loPullthroughPct)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono whitespace-nowrap ${getTimeInMotionColor(loan.activeDays, rowReasonCodes)}`}
                              >
                                {loan.activeDays !== null &&
                                loan.activeDays !== undefined
                                  ? `${loan.activeDays} days`
                                  : "—"}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {loan.loanType || "—"}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {loan.loanPurpose || "—"}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {loan.channel || "—"}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {loan.currentMilestone || "—"}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatDate((loan as any).applicationDate)}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatDate(loan.estimatedClosingDate)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatRate((loan as any).lockMarketRate)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {formatRate(loan.marketRate)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {(loan as any).marketChangeDelta != null &&
                                (loan as any).marketChangeDelta !== ""
                                  ? `${Number((loan as any).marketChangeDelta) > 0 ? "+" : ""}${formatRate((loan as any).marketChangeDelta)}`
                                  : "—"}
                              </td>
                              <td
                                className={`px-2 py-1.5 text-xs ${isDarkMode ? "text-slate-300" : "text-slate-900"} whitespace-nowrap`}
                              >
                                {getLockStatus(loan)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono text-center whitespace-nowrap ${getSignalBucketColor(loan.creditMetricsSignalStrength)}`}
                              >
                                {formatNumber(loan.creditMetricsSignalStrength)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono text-center whitespace-nowrap ${getSignalBucketColor(loan.loanCharacteristicsSignalStrength)}`}
                              >
                                {formatNumber(
                                  loan.loanCharacteristicsSignalStrength,
                                )}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono text-center whitespace-nowrap ${getSignalBucketColor(loan.timeInMotionSignalStrength)}`}
                              >
                                {formatNumber(loan.timeInMotionSignalStrength)}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono text-center whitespace-nowrap ${getSignalBucketColor(loan.mloAeFalloutProneSignalStrength)}`}
                              >
                                {formatNumber(
                                  loan.mloAeFalloutProneSignalStrength,
                                )}
                              </td>
                              <td
                                className={`px-3 py-2 text-xs font-mono text-center whitespace-nowrap ${getSignalBucketColor(loan.interestLockVsMarketSignalStrength)}`}
                              >
                                {formatNumber(
                                  loan.interestLockVsMarketSignalStrength,
                                )}
                              </td>
                            </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                    </div>
                    )}
                    {sortedCriticalLoans.length > 0 && (
                      <div
                        className={`mt-2 flex items-center justify-center gap-3 min-w-0 ${isDarkMode ? "text-slate-400" : "text-slate-500"}`}
                      >
                        <span className="text-xs">
                          Showing {sortedCriticalLoans.length} critical loan
                          {sortedCriticalLoans.length !== 1 ? "s" : ""}
                        </span>
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className={`text-xs h-7 px-3 ${isDarkMode ? "border-white/20 hover:bg-slate-800" : "border-slate-300 hover:bg-slate-50"}`}
                            >
                              <Download className="w-3 h-3 mr-1.5" />
                              Export
                              <ChevronDown className="w-3 h-3 ml-1.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            className="w-[var(--radix-dropdown-menu-trigger-width)] min-w-[var(--radix-dropdown-menu-trigger-width)]"
                          >
                            <DropdownMenuItem
                              onClick={exportToCSV}
                              className="justify-start text-[13px] py-1.5 whitespace-nowrap"
                            >
                              <Download className="w-3 h-3 mr-1.5 flex-shrink-0" />
                              CSV
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={exportToExcel}
                              className="justify-start text-[13px] py-1.5 whitespace-nowrap"
                            >
                              <Download className="w-3 h-3 mr-1.5 flex-shrink-0" />
                              Excel
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Distribution tab was moved to Communications Center */}
          </div>
        </section>

        {selectedOfficer && (
          <LoanOfficerModal
            officerName={selectedOfficer}
            isOpen={!!selectedOfficer}
            onClose={() => setSelectedOfficer(null)}
            isDarkMode={isDarkMode}
            selectedTenantId={selectedTenantId}
            preloadedLoans={criticalLoanCards.filter(
              (l) => (l.officer || "").trim() === selectedOfficer.trim()
            )}
          />
        )}

        {/* Tile Drilldown Modals */}
        <ClosingFalloutMetricModal
          open={!!metricModalLabel}
          onOpenChange={(open) => !open && setMetricModalLabel(null)}
          label={metricModalLabel}
          dateFilter={period}
          isDarkMode={isDarkMode}
          loansRaw={loansRaw}
          loansLoading={loansLoading}
          loansError={loansError}
          headlineValue={
            metricModalLabel === "Active Loans Today"
              ? metrics.activeLoansToday
              : metricModalLabel?.startsWith("Funded Loans")
                ? metrics.closedLoansMTD
                : metricModalLabel === "Predicted Closing"
                  ? metrics.predictedClosing
                  : metricModalLabel === "Predicted Fallout"
                    ? metrics.predictedFalloutTotal
                    : metricModalLabel === "High Risk"
                      ? metrics.highRiskCount
                      : undefined
          }
          subLabel={
            metricModalLabel === "Active Loans Today"
              ? `$${metrics.pipelineValueM}M Pipeline`
              : metricModalLabel?.startsWith("Funded Loans")
                ? `${periodLabel}`
                : metricModalLabel === "Predicted Closing"
                  ? `${metrics.pullThroughRateDisplay}% Pull-Through (Rolling 90D)`
                  : metricModalLabel === "Predicted Fallout"
                    ? `${metrics.falloutRate}%`
                    : metricModalLabel === "High Risk"
                      ? `${metrics.highRiskCount} of ${metrics.predictedFalloutTotal} fallout (80/100 risk or higher)`
                      : undefined
          }
          fallbackActiveVolume={metrics.pipelineValue}
          fallbackActiveCount={metrics.activeLoansToday}
          highRiskLoans={metricModalLabel === "High Risk" ? highRiskLoansForModal.loans : undefined}
          highRiskVolume={metricModalLabel === "High Risk" ? highRiskLoansForModal.volume : undefined}
        />

        <OutcomeLoansModal
          open={!!outcomeModalType}
          onOpenChange={(open) => !open && setOutcomeModalType(null)}
          outcomeType={outcomeModalType}
          dateFilter={period}
          isDarkMode={isDarkMode}
          loansRaw={loansRaw}
          loansLoading={loansLoading}
          loansError={loansError}
          loanPredictions={loanPredictions}
          bucketedLoans={bucketedLoans}
        />

        {/* Loan Drilldown Modal - shown when clicking a loan in the critical loans table */}
        <LoanDrilldownModal
          loan={selectedLoanForDrilldown}
          isOpen={!!selectedLoanForDrilldown}
          onClose={() => setSelectedLoanForDrilldown(null)}
          isDarkMode={isDarkMode}
          onSelectOfficer={(officer) => {
            setSelectedLoanForDrilldown(null);
            setSelectedOfficer(officer);
          }}
        />

        {/* Loan Officer Modal */}
        <LoanOfficerModal
          officerName={selectedOfficer || ""}
          isOpen={!!selectedOfficer}
          onClose={() => setSelectedOfficer(null)}
          isDarkMode={isDarkMode}
          selectedTenantId={selectedTenantId}
          preloadedLoans={selectedOfficer ? criticalLoanCards.filter(
            (l) => (l.officer || "").trim() === selectedOfficer.trim()
          ) : []}
        />

        {/* Loan Risk Detail Modal - shown when clicking a loan in the signal buckets table */}
        <LoanRiskDetailModal
          open={!!selectedLoanForDetail}
          onOpenChange={(open) => !open && setSelectedLoanForDetail(null)}
          loan={selectedLoanForDetail}
          isDarkMode={isDarkMode}
        />
      </div>
    </TooltipProvider>
  );
};
