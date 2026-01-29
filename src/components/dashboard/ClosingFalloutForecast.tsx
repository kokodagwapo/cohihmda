import { useState, useEffect, useRef, useMemo, useCallback, memo, useDeferredValue } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { BarChart3, TrendingUp, Play } from 'lucide-react';
import { DashboardCard } from './DashboardCard';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { useMetrics } from '@/hooks/useMetrics';
import { LoanCardsContainer } from './LoanCardsContainer';
import { LoanOfficerModal } from './LoanOfficerModal';
import { useTheme } from '@/components/theme-provider';
import { api } from '@/lib/api';
import { ClosingFalloutMetricModal } from '@/components/dashboard/modals/ClosingFalloutMetricModal';
import { OutcomeLoansModal, type OutcomeModalType } from '@/components/dashboard/modals/OutcomeLoansModal';
import { LoanRiskDetailModal } from '@/components/dashboard/modals/LoanRiskDetailModal';
import { PeriodValue, getLoanAmountNumber, isDateInPeriod, isFundedInPeriod, getPeriodRange, inferLoanStatus } from '@/utils/closingFalloutFilters';
import { transformLoanToCard } from '@/utils/loanDataTransform';

interface ClosingFalloutForecastProps {
  dateFilter?: 'today' | 'mtd' | 'ytd' | 'custom';
}

const normalizeRawStatus = (raw: unknown): string =>
  (raw ?? '').toString().trim().toUpperCase();

type ForecastStatus = 'Active' | 'Closed' | 'Withdrawn' | 'Denied' | 'Locked' | null;

const hasAnyValue = (v: unknown): boolean => {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
};

// Helper to extract status from loan (checks both top-level and raw_data)
const getLoanStatus = (loan: any): string | null => {
  // Check top-level fields first (both snake_case from API and other variants)
  let status = loan?.current_loan_status ??     // snake_case from /api/loans
               loan?.['Current Loan Status'] ?? 
               loan?.['Fields.1393'] ?? 
               loan?.status ?? null;
  
  // Always check raw_data as well (it might have the status even if top-level doesn't)
  if (loan?.raw_data) {
    let rawData = loan.raw_data;
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = null;
      }
    }
    if (rawData && typeof rawData === 'object') {
      // Prefer raw_data status if top-level status is not found or is generic
      const rawStatus = rawData['Current Loan Status'] ?? 
                       rawData.current_loan_status ??
                       rawData['Loan Status'] ??
                       rawData.loan_status ??
                       rawData['Fields.1393'] ??
                       rawData.status ??
                       null;
      
      // Use raw_data status if we don't have a top-level status, or if top-level is generic
      if (!status || (status && !loan?.['Current Loan Status'] && !loan?.['Fields.1393'])) {
        status = rawStatus || status;
      }
    }
  }
  
  return status;
};

// Fallout-specific status mapper (scoped to this component only)
// Status buckets are mutually exclusive; "locked" is treated as an additional flag (see `isLockedForForecast`).
const mapForecastStatus = (loan: any): Exclude<ForecastStatus, 'Locked'> => {
  // Use the same status extraction helper that checks both top-level and raw_data
  const preferred = getLoanStatus(loan);

  const s = normalizeRawStatus(preferred);

  // Explicitly exclude purchased loans from fallout calculations
  if (s === 'LOAN PURCHASED BY YOUR INSTITUTION') return null;

  if (s === 'ACTIVE LOAN') return 'Active';
  if (s === 'LOAN ORIGINATED') return 'Closed';

  if (
    s === 'APPLICATION DENIED' ||
    s === 'PREAPPROVAL REQUEST DENIED BY FINANCIAL INSTITUTION'
  ) return 'Denied';

  if (
    s === 'APPLICATION WITHDRAWN' ||
    s === 'APPLICATION APPROVED BUT NOT ACCEPTED' ||
    s === 'FILE CLOSED FOR INCOMPLETENESS' ||
    s === 'PREAPPROVAL REQUEST APPROVED BUT NOT ACCEPTED'
  ) return 'Withdrawn';

  // Default bucket: Active so we don't drop unknown-but-live pipeline items
  return 'Active';
};

// Helper to check if loan has "Active Loan" status (for Active Loans Today metric)
const isActiveLoan = (loan: any): boolean => {
  const status = getLoanStatus(loan);
  const s = normalizeRawStatus(status);
  return s === 'ACTIVE LOAN';
};

// Helper to check if loan is funded (for Funded Loans metric)
// Funded = Current Loan Status = "Loan Originated" OR fund_date is not blank
const isFundedLoan = (loan: any): boolean => {
  // Check if fund_date exists and is not blank (check both top-level and raw_data)
  let fundDate = loan?.fund_date || loan?.['Fund Date'] || loan?.['Funding Date'];
  
  // If not found, check raw_data
  if (!hasAnyValue(fundDate) && loan?.raw_data) {
    let rawData = loan.raw_data;
    if (typeof rawData === 'string') {
      try {
        rawData = JSON.parse(rawData);
      } catch (e) {
        rawData = null;
      }
    }
    if (rawData && typeof rawData === 'object') {
      fundDate = rawData.fund_date ?? 
                 rawData['Fund Date'] ?? 
                 rawData['Funding Date'] ??
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
  return s === 'LOAN ORIGINATED';
};

const getForecastLockDate = (loan: any): unknown => {
  // Support multiple possible field names / LOS mappings
  return (
    loan?.lock_date ??
    loan?.['Lock Date'] ??
    loan?.['Trans Details Lock Date'] ??
    loan?.['761']
  );
};

const getApplicationDate = (loan: any): string | null | undefined => {
  // Support multiple possible field names for application date
  return loan?.application_date ?? loan?.['Application Date'] ?? 
    loan?.app_date ?? loan?.['App Date'] ?? loan?.created_at;
};

const isLockedForForecast = (loan: any): boolean => {
  const baseStatus = mapForecastStatus(loan);
  if (baseStatus !== 'Active') return false;
  return hasAnyValue(getForecastLockDate(loan));
};

const daysSinceLocal = (dateIso: string | null | undefined, now: Date = new Date()): number | null => {
  if (!dateIso) return null;
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
};

/**
 * Determines if an active loan is likely to close late.
 * Checks if the loan has exceeded its expected closing date by more than 72 hours (3 days).
 * Falls back to checking if loan has been in pipeline > threshold days if no expected close date.
 */
const isLikelyCloseLateForecast = (loan: any, thresholdDays: number = 30, now: Date = new Date()): boolean => {
  const status = mapForecastStatus(loan);
  if (!status || status !== 'Active') return false;
  
  // Primary check: Has the loan exceeded its expected/estimated close date?
  const expectedCloseDate = loan?.expected_close_date || loan?.estimated_completion_date || 
    loan?.['Expected Close Date'] || loan?.['Estimated Closing Date'] || loan?.target_close_date;
  
  if (expectedCloseDate) {
    const expected = new Date(expectedCloseDate);
    if (!Number.isNaN(expected.getTime())) {
      // Loan is late if it's more than 3 days past expected close date
      const daysPastExpected = Math.floor((now.getTime() - expected.getTime()) / (1000 * 60 * 60 * 24));
      return daysPastExpected > 3; // More than 72 hours past expected close
    }
  }
  
  // Fallback: If no expected close date, check if loan has been in pipeline too long
  // Average mortgage cycle is 30-45 days, so loans > threshold days are considered at risk
  const days = daysSinceLocal(loan?.application_date, now);
  return days !== null && days > thresholdDays;
};

// Hook for animating numbers (from BusinessOverviewSection.tsx)
const useCountUp = (
  endValue: number,
  duration: number = 1500,
  delay: number = 0,
  startAnimation: boolean = true
) => {
  const [count, setCount] = useState(0);
  const countRef = useRef(0);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!startAnimation) return;

    const timeout = setTimeout(() => {
      const animate = (timestamp: number) => {
        if (!startTimeRef.current) startTimeRef.current = timestamp;
        const progress = Math.min((timestamp - startTimeRef.current) / duration, 1);
        
        // Easing function for smooth animation
        const easeOutQuart = 1 - Math.pow(1 - progress, 4);
        countRef.current = Math.floor(easeOutQuart * endValue);
        setCount(countRef.current);

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          setCount(endValue);
        }
      };

      requestAnimationFrame(animate);
    }, delay);

    return () => clearTimeout(timeout);
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
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const options: Array<{ value: PeriodValue; label: string }> = [
    { value: 'all', label: 'All Time' },
    { value: 'mtd', label: 'Month to Date' },
    { value: 'last_month', label: 'Last Month' },
    { value: 'ytd', label: 'Year to Date' },
    { value: 'last_year', label: 'Last Year' },
    ...availableYears.map((y) => ({ value: y.toString(), label: y.toString() })),
  ];

  const currentLabel = options.find((o) => o.value === period)?.label || 'All Time';

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 rounded-lg sm:rounded-xl border text-xs sm:text-sm font-medium transition-all touch-manipulation ${
          isDarkMode
            ? 'bg-slate-800 border-white/10 text-slate-200 hover:border-blue-500/50 active:bg-slate-700'
            : 'bg-white border-slate-200 text-slate-700 hover:border-slate-300 shadow-sm active:bg-slate-50'
        }`}
      >
        <span className="truncate max-w-[110px] sm:max-w-none">{currentLabel}</span>
        <svg className={`w-3.5 h-3.5 sm:w-4 sm:h-4 transition-transform flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div
          className={`absolute top-full right-0 mt-2 py-1.5 sm:py-2 rounded-lg sm:rounded-xl border shadow-xl z-50 min-w-[170px] max-h-[60vh] overflow-y-auto ${
            isDarkMode ? 'bg-slate-800 border-white/10' : 'bg-white border-slate-200'
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
                isDarkMode ? 'hover:bg-slate-700 active:bg-slate-600 text-slate-200' : 'hover:bg-slate-50 active:bg-slate-100 text-slate-700'
              }`}
            >
              <span className={`w-4 ${period === opt.value ? 'text-blue-500' : 'opacity-0'}`}>{period === opt.value && '✓'}</span>
              <span className={period === opt.value ? 'font-medium' : ''}>{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

PeriodDropdown.displayName = 'PeriodDropdown';

/** Session-only cache key for metrics (period string). Cleared on loans/predictions change or page refresh. */
const PERIODS_TO_PRECOMPUTE: PeriodValue[] = ['all', 'mtd', 'ytd', 'last_month', 'last_year'];

function computeMetricsFromLoans(
  loans: any[],
  period: PeriodValue,
  now: Date,
  statsData: { pullThroughRate?: number; avgCycleTime?: number; active?: number; activeVolume?: number; locked?: number; closed?: number; totalVolume?: number } | null,
  predictions: { likelyWithdraw: number; likelyDecline: number; predictedFalloutTotal: number } | null
): {
  activeLoansToday: number;
  closedLoansMTD: number;
  predictedClosing: number;
  likelyCloseLate: number;
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
  let fundedInPeriodCount = 0;
  let fundedTotalByStatus = 0; // Count funded loans by status (for 'all' period fallback)
  let startedInPeriodCount = 0;
  let lockedCount = 0;
  let lockedInPeriodCount = 0;
  let lockedInRolling90 = 0; // Locks in rolling 90 days for Pipeline Snapshot KPI
  
  // Single pass through all loans
  for (let i = 0; i < loans.length; i++) {
    const loan = loans[i];
    const status = mapForecastStatus(loan);
    
    // Check if active (snapshot metric - not filtered by period)
    if (status === 'Active') {
      activeCount++;
      activePipelineValue += getLoanAmountNumber(loan);
      
      // Check if likely close late (only for active loans)
      if (isLikelyCloseLateForecast(loan, 30, now)) {
        likelyCloseLateCount++;
      }
    }
    
    // Count total funded loans by status (for 'all' period - doesn't require closing_date field)
    if (status === 'Closed') {
      fundedTotalByStatus++;
    }
    
    // Check if funded in period (historical metric - requires closing_date field for date filtering)
    if (isFundedInPeriod(loan, period, now)) {
      fundedInPeriodCount++;
    }
    
    // Check if application started in period (for pull-through calculation)
    const appDate = getApplicationDate(loan);
    if (appDate && isDateInPeriod(appDate, period, now)) {
      startedInPeriodCount++;
    }
    
    // Check if locked (needs to be active first)
    if (isLockedForForecast(loan)) {
      lockedCount++;
      // Check if locked in period - use getForecastLockDate to get the lock date from multiple possible field names
      const lockDateValue = getForecastLockDate(loan);
      if (lockDateValue) {
        if (isDateInPeriod(String(lockDateValue), period, now)) {
          lockedInPeriodCount++;
        }
        // Also count locks in rolling 90 days for the Pipeline Snapshot KPI
        if (isDateInPeriod(String(lockDateValue), 'rolling_90_days', now)) {
          lockedInRolling90++;
        }
      }
    }
  }
  
  // ======== SNAPSHOT METRICS (current pipeline state) ========
  
  const activeLoansToday = statsData?.active ?? activeCount;
  const pipelineValue = statsData?.activeVolume ?? activePipelineValue;
  const pipelineValueM = pipelineValue > 0 ? (pipelineValue / 1000000).toFixed(1) : '0';
  
  // Predicted Fallout - from AI predictions (applies to current active pipeline)
  const likelyWithdraw = predictions?.likelyWithdraw ?? 0;
  const likelyDecline = predictions?.likelyDecline ?? 0;
  const predictedFalloutTotal = predictions?.predictedFalloutTotal ?? (likelyWithdraw + likelyDecline);
  
  // Fallout rate - relative to current active pipeline
  const falloutRate = activeLoansToday > 0 ? Math.round((predictedFalloutTotal / activeLoansToday) * 100) : 0;
  
  // ======== HISTORICAL METRICS (filtered by period) ========
  
  // Pull-through rate: Uses rolling 90 days and excludes active loans
  // This is the industry-standard methodology - only count completed loan journeys
  // MTD/YTD is inappropriate because loans take 30-45+ days to close on average
  const rolling90DaysPeriod: PeriodValue = 'rolling_90_days';
  
  // Filter to inactive loans only (completed journeys)
  const inactiveLoans = loans.filter(l => {
    const status = inferLoanStatus(l);
    return status !== 'Active' && status !== 'Locked';
  });
  
  // Count loans started in rolling 90 days
  const startedInRolling = inactiveLoans.filter(l => {
    const appDate = getApplicationDate(l);
    return appDate && isDateInPeriod(appDate, rolling90DaysPeriod, now);
  });
  
  // Calculate pull-through from rolling 90 days data, fallback to API data
  const pullThroughRate = startedInRolling.length > 0
    ? (inactiveLoans.filter(l => {
        const appDate = getApplicationDate(l);
        const hasClosedDate = l?.closing_date || l?.funding_date || l?.fund_date || l?.['Closing Date'];
        return appDate && isDateInPeriod(appDate, rolling90DaysPeriod, now) && hasClosedDate;
      }).length / startedInRolling.length) * 100
    : (statsData?.pullThroughRate ?? 0);
  
  const pullThroughRateDisplay = pullThroughRate > 0 ? Math.round(pullThroughRate) : 0;
  
  // Predicted Closing - current active loans * period's pull-through rate
  const predictedClosing = activeLoansToday > 0 ? Math.round((activeLoansToday * pullThroughRate) / 100) : 0;
  
  // Locked loans - use statsData for 'all', client-side count for filtered periods
  const lockedLoans = period === 'all'
    ? (statsData?.locked ?? lockedCount)
    : (lockedInPeriodCount > 0 ? lockedInPeriodCount : 0);
  
  // Funded/Closed loans - IMPORTANT: Use statsData?.closed for 'all' period
  // This ensures it matches ExecutiveDashboard's "Closed Loans" metric
  // For 'all' period: prefer statsData?.closed, then fundedTotalByStatus (counts by loan status), then fundedInPeriodCount
  // For other periods: use fundedInPeriodCount (filtered by closing_date field)
  const closedLoansMTD = period === 'all'
    ? (statsData?.closed ?? fundedTotalByStatus ?? fundedInPeriodCount)
    : fundedInPeriodCount;
  
  // Average cycle time (from statsData or default)
  const avgCycleTime = statsData?.avgCycleTime ?? 24;
  
  // For rolling 90-day locks, use client-side calculation if available, otherwise fall back to statsData.locked
  // This handles cases where lock_date might not be populated or parseable
  const lockedRolling90Value = lockedInRolling90 > 0 ? lockedInRolling90 : (statsData?.locked ?? lockedCount);
  
  return {
    activeLoansToday,
    closedLoansMTD,
    predictedClosing,
    likelyCloseLate: likelyCloseLateCount,
    likelyWithdraw,
    likelyDecline,
    predictedFalloutTotal,
    pipelineValueM,
    pullThroughRateDisplay,
    falloutRate,
    lockedLoans,
    lockedRolling90: lockedRolling90Value,
    avgCycleTime,
    pipelineValue
  };
}

// Get metric explanation for tooltips
const getMetricExplanation = (label: string) => {
  if (label.startsWith("Funded Loans")) {
    return { title: "Production Output", desc: "Total number of loans successfully funded and closed in the selected period. Key revenue driver and operational efficiency metric." };
  }
  switch(label) {
    case "Active Loans Today": return { title: "Active Pipeline Volume", desc: "Total number of loans currently in the production pipeline across all stages—from application through closing." };
    case "Predicted Fallout": return { title: "Forecasted Leakage", desc: "AI-calculated estimate of loan volume that will fail to fund based on real-time behavior signals and market conditions." };
    case "Predicted Closing": return { title: "Closing Forecast", desc: "Projected number of loans expected to successfully close based on pipeline health and historical conversion rates." };
    case "Likely Withdraw": return { title: "Borrower Says No", desc: "Buyer decision - borrower is rate shopping, experiencing buyer's remorse, or choosing a competitor." };
    case "Likely Decline": return { title: "Lender Says No", desc: "Lender decision - loan failing underwriting criteria, credit issues, or documentation requirements." };
    case "Likely Close Late": return { title: "Pipeline Stagnation", desc: "Active loans that have exceeded their expected closing date by more than 72 hours, or have been in pipeline longer than 30 days without an expected close date." };
    default:
      return { title: label, desc: "Standardized performance metric for portfolio monitoring." };
  }
};

/**
 * Closing & Fallout Forecast Component
 * Displays predictive analytics for loan closings and fallout risk
 */
export const ClosingFalloutForecast = ({ dateFilter = 'mtd' }: ClosingFalloutForecastProps) => {
  // ============================================================================
  // TESTING FLAG: Signal Strength Buckets Table
  // Set to true to display the loan signal strength buckets table
  // Set to false to hide it (for production or when not needed)
  // ============================================================================
  const SHOW_SIGNAL_BUCKETS_TABLE = false;
  // ============================================================================

  const { statsData, statsLoading, funnelData } = useDashboardStats(dateFilter);
  const { queryMetrics } = useMetrics();
  const [isAnimating, setIsAnimating] = useState(true);
  const [insightsTab, setInsightsTab] = useState<'critical' | 'officers'>('critical');
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  // State for locked loans fetched via useMetrics (rolling 90 days)
  const [lockedLoansRolling90, setLockedLoansRolling90] = useState<number>(0);

  const [period, setPeriod] = useState<PeriodValue>('all');
  // PERFORMANCE: useDeferredValue defers expensive re-computation during rapid period changes
  // This allows the UI to remain responsive while metrics are recalculated in the background
  const deferredPeriod = useDeferredValue(period);
  const prevPeriodRef = useRef<PeriodValue>(period);

  // Session-scoped metrics cache: keyed by period, invalidated when loans or predictions change / on refresh
  const metricsCacheRef = useRef<{
    cache: Map<string, ReturnType<typeof computeMetricsFromLoans>>;
    dataVersion: any[] | null;
    predictionsVersion: { likelyWithdraw: number; likelyDecline: number; predictedFalloutTotal: number } | null;
  }>({ cache: new Map(), dataVersion: null, predictionsVersion: null });

  // Lazy loan loading (only when a tile modal is opened)
  const [loansRaw, setLoansRaw] = useState<any[] | null>(null);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState<string | null>(null);

  // AI prediction state
  const [predictions, setPredictions] = useState<{
    likelyWithdraw: number;
    likelyDecline: number;
    predictedFalloutTotal: number;
  } | null>(null);
  const [predictionsLoading, setPredictionsLoading] = useState(false);
  const [bucketedLoans, setBucketedLoans] = useState<any[]>([]);
  // Store individual predictions to identify which loans are predicted to fallout
  const [loanPredictions, setLoanPredictions] = useState<Record<string, string>>({});
  // Store full prediction objects for LoanCardsContainer
  const [fullPredictions, setFullPredictions] = useState<Array<{
    loanId: string;
    predictedOutcome: 'withdraw' | 'deny' | 'originate';
    confidence: number;
    reasoning?: string;
    riskFactors?: string[];
  }>>([]);
  
  // Pagination state for signal buckets table
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(50);

  // Modal state
  const [metricModalLabel, setMetricModalLabel] = useState<string | null>(null);
  const [outcomeModalType, setOutcomeModalType] = useState<OutcomeModalType | null>(null);
  const [selectedLoanForDetail, setSelectedLoanForDetail] = useState<any | null>(null);

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
      for (let y = now.getFullYear(); y >= now.getFullYear() - 5; y--) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [loansRaw]);

  const periodLabel = useMemo(() => {
    const map: Record<string, string> = {
      all: 'All Time',
      mtd: 'MTD',
      last_month: 'Last Month',
      ytd: 'YTD',
      last_year: 'Last Year',
    };
    if (typeof period === 'string' && /^\d{4}$/.test(period)) return period;
    return map[String(period)] || 'All Time';
  }, [period]);

  // Calculate metrics from data (with session cache so switching periods is instant after first load)
  // PERFORMANCE: Uses deferredPeriod to allow UI to remain responsive during rapid period changes
  const metrics = useMemo(() => {
    const now = new Date();
    const hasLoans = loansRaw && loansRaw.length > 0 && !loansError;

    if (hasLoans) {
      const loans = loansRaw as any[];
      const cache = metricsCacheRef.current;

      // Invalidate cache when loans or predictions change (e.g. new fetch or page refresh)
      if (cache.dataVersion !== loansRaw || cache.predictionsVersion !== predictions) {
        cache.cache.clear();
        cache.dataVersion = loansRaw;
        cache.predictionsVersion = predictions;
      }

      const periodKey = String(deferredPeriod);
      const cached = cache.cache.get(periodKey);
      if (cached) return cached;

      const result = computeMetricsFromLoans(loans, deferredPeriod, now, statsData, predictions);
      cache.cache.set(periodKey, result);

      // Precompute other periods in the background so switching later is instant
      if (typeof requestIdleCallback !== 'undefined') {
        const loansSnap = loans;
        const nowSnap = now;
        const statsSnap = statsData;
        const predSnap = predictions;
        const ref = metricsCacheRef;
        requestIdleCallback(
          () => {
            const c = ref.current;
            if (c.dataVersion !== loansSnap || c.predictionsVersion !== predSnap) return;
            PERIODS_TO_PRECOMPUTE.forEach((p) => {
              if (String(p) !== periodKey && !c.cache.has(String(p))) {
                c.cache.set(String(p), computeMetricsFromLoans(loansSnap, p, nowSnap, statsSnap, predSnap));
              }
            });
          },
          { timeout: 4000 }
        );
      }

      return result;
    }

    // Active Loans Today
    const activeLoansToday = statsData?.active ?? funnelData?.stillActive?.units ?? 0;
    
    // Closed Loans (Funded Loans)
    const closedLoansMTD = statsData?.closed ?? funnelData?.originated?.units ?? 0;
    
    // Predicted Closing - estimate based on pull-through rate
    const pullThroughRate = statsData?.pullThroughRate ?? 
      (funnelData?.loansStarted?.units && funnelData.loansStarted.units > 0
        ? ((funnelData?.originated?.units ?? 0) / funnelData.loansStarted.units * 100)
        : 0);
    const predictedClosing = activeLoansToday > 0 
      ? Math.round((activeLoansToday * pullThroughRate) / 100)
      : 0;
    
    // Likely Close Late - estimate based on cycle time (loans over 30 days old)
    // This is a simplified calculation - in production, this would come from actual loan data
    const likelyCloseLate = activeLoansToday > 0 
      ? Math.round(activeLoansToday * 0.15) // Estimate 15% of active loans will close late
      : 0;
    
    // Fallout metrics - use predictions ONLY (not funnel data fallback)
    // These should be populated by AI predictions, not historical funnel data
    const likelyWithdraw = predictions?.likelyWithdraw ?? 0;
    const likelyDecline = predictions?.likelyDecline ?? 0;
    const predictedFalloutTotal = predictions?.predictedFalloutTotal ?? (likelyWithdraw + likelyDecline);
    
    // Pipeline value
    const pipelineValue = statsData?.activeVolume ?? statsData?.totalVolume ?? funnelData?.stillActive?.volume ?? 0;
    const pipelineValueM = pipelineValue > 0 ? (pipelineValue / 1000000).toFixed(1) : '0';
    
    // Pull-through rate for display
    const pullThroughRateDisplay = pullThroughRate > 0 ? Math.round(pullThroughRate) : 0;
    
    // Fallout rate
    const falloutRate = activeLoansToday > 0 
      ? Math.round((predictedFalloutTotal / activeLoansToday) * 100)
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
      likelyWithdraw,
      likelyDecline,
      predictedFalloutTotal,
      pipelineValueM,
      pullThroughRateDisplay,
      falloutRate,
      lockedLoans,
      lockedRolling90: lockedLoans, // Fallback: use total locks when no loan data available
      avgCycleTime,
      pipelineValue
    };
  }, [statsData, funnelData, loansRaw, loansError, deferredPeriod, predictions]);

  // Calculate KPIs for Pipeline Snapshot
  const kpis = useMemo(() => {
    const pipelineUPB = metrics.pipelineValue > 0 
      ? `$${(metrics.pipelineValue / 1000000).toFixed(1)}M`
      : '$0M';
    
    // Use locked loans from useMetrics (rolling 90 days) - same approach as ExecutiveDashboard
    const locksCount = lockedLoansRolling90;
    
    const pullThrough = `${metrics.pullThroughRateDisplay}%`;

    return [
      {
        label: 'Pipeline UPB',
        value: pipelineUPB,
        secondaryLabel: 'Current Pipeline',
        secondaryValue: pipelineUPB,
        explanation: 'Total Unpaid Principal Balance of active loans. Forward-looking revenue indicator.'
      },
      {
        label: 'Locks (90D)',
        value: locksCount.toString(),
        secondaryLabel: 'Rolling 90 Days',
        secondaryValue: locksCount.toString(),
        explanation: 'Loans with secured rate locks in the past 90 days. Matches ExecutiveDashboard methodology.'
      },
      {
        label: 'Pull-Through',
        value: pullThrough,
        secondaryLabel: 'Rolling 90D',
        secondaryValue: pullThrough,
        explanation: 'Historical success rate - % of loans that successfully fund. Uses rolling 90-day window for accuracy.'
      }
    ];
  }, [metrics, lockedLoansRolling90]);

  // PERFORMANCE: Only trigger animation on initial data load, not on period changes
  // This prevents stutter when switching between periods
  const hasAnimatedRef = useRef(false);
  const prevDataRef = useRef<{ statsData: typeof statsData; loansRaw: typeof loansRaw }>({ statsData: null, loansRaw: null });
  
  useEffect(() => {
    // Only animate when actual data changes (initial load or refresh), not period switches
    const dataChanged = (
      (prevDataRef.current.statsData === null && statsData !== null) ||
      (prevDataRef.current.loansRaw === null && loansRaw !== null)
    );
    
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

  // Fetch stored predictions from DB (used on load and after predict pipeline completes)
  // Now includes full loan data with signal strengths for display without re-running predictions
  const fetchStoredPredictions = useCallback(async () => {
    try {
      const response = await api.request<{
        predictions: Array<{
          loanId: string;
          predictedOutcome: 'withdraw' | 'deny' | 'originate';
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
        summary: { withdraw: number; deny: number; originate: number };
      }>('/api/loans/predictions', { method: 'GET' });
      
      if (response.predictions && Array.isArray(response.predictions)) {
        setFullPredictions(response.predictions);
        
        // Also update the predictions state used for KPI metrics
        if (response.summary) {
          setPredictions({
            likelyWithdraw: response.summary.withdraw,
            likelyDecline: response.summary.deny,
            predictedFalloutTotal: response.summary.withdraw + response.summary.deny
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
          .filter(pred => pred.loanData) // Only include predictions that have stored loan data
          .map(pred => ({
            ...pred.loanData,
            // Ensure loan_id is set (might be in loanData or from prediction)
            loan_id: pred.loanData?.loan_id || pred.loanId,
            // Add the prediction info to each loan
            bucket: pred.bucket || pred.loanData?.bucket || 'medium',
            riskSummary: pred.loanData?.riskSummary || {
              predictedOutcome: pred.predictedOutcome,
              confidence: pred.confidence,
              risks: pred.riskFactors || [],
              positives: [],
              overallRisk: pred.bucket === 'high' ? 'high' : pred.bucket === 'low' ? 'low' : 'medium'
            }
          }));
        
        if (reconstructedBucketedLoans.length > 0) {
          console.log('[Predictions] Restored bucketed loans from database:', reconstructedBucketedLoans.length);
          setBucketedLoans(reconstructedBucketedLoans);
        }
      } else {
        setFullPredictions([]);
      }
    } catch (error) {
      console.error('[Predictions] Failed to fetch stored predictions:', error);
      setFullPredictions([]);
    }
  }, []);

  // Manual prediction trigger: runs bucketing with rule-based summaries (instant)
  const runPrediction = useCallback(async () => {
    setPredictionsLoading(true);
    try {
      // Don't send loanIds - let the backend query the full database with proper filters
      // The frontend's 5000-loan sample may not match the backend's "Active Loan" criteria
      const response = await api.request<{
        predictions: Array<{ predictedOutcome: string; loanId: string }>;
        bucketedLoans?: any[];
        summary: { predictedWithdraw: number; predictedDeny: number; predictedOriginate: number };
      }>('/api/loans/predict', {
        method: 'POST',
        body: JSON.stringify({})
      });

      setPredictions({
        likelyWithdraw: response.summary.predictedWithdraw,
        likelyDecline: response.summary.predictedDeny,
        predictedFalloutTotal: response.summary.predictedWithdraw + response.summary.predictedDeny
      });

      if (response.predictions && Array.isArray(response.predictions)) {
        const predictionsMap: Record<string, string> = {};
        response.predictions.forEach((pred: { loanId: string; predictedOutcome: string }) => {
          if (pred.loanId && pred.predictedOutcome) predictionsMap[pred.loanId] = pred.predictedOutcome;
        });
        setLoanPredictions(predictionsMap);
      }

      if (response.bucketedLoans && Array.isArray(response.bucketedLoans) && response.bucketedLoans.length > 0) {
        setBucketedLoans(response.bucketedLoans);
      } else {
        setBucketedLoans([]);
      }

      // Simplified: predictions are instant now (no background processing)
      // No need to poll for status - just set loading to false
      setPredictionsLoading(false);
    } catch (error) {
      console.error('[Predict] Failed to run prediction:', error);
      setPredictions(null);
      setLoanPredictions({});
      setBucketedLoans([]);
      setPredictionsLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch stored predictions from database when loans are loaded
  useEffect(() => {
    fetchStoredPredictions();
  }, [fetchStoredPredictions]);

  // Load full loan set on mount (required for period filtering to work)
  // The loans are loaded once with 'all' period and then filtered client-side
  useEffect(() => {
    if (!loansRaw && !loansLoading && !loansError) {
      ensureLoansLoaded();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch locked loans count using useMetrics with rolling_90_days period
  // This matches how ExecutiveDashboard fetches locked_loans
  useEffect(() => {
    const fetchLockedLoans = async () => {
      try {
        const results = await queryMetrics(['locked_loans'], 'rolling_90_days');
        if (results?.locked_loans?.value) {
          const value = typeof results.locked_loans.value === 'number'
            ? results.locked_loans.value
            : parseFloat(results.locked_loans.value as string) || 0;
          setLockedLoansRolling90(value);
        }
      } catch (error) {
        console.error('[ClosingFalloutForecast] Failed to fetch locked loans:', error);
      }
    };
    fetchLockedLoans();
  }, [queryMetrics]);

  const criticalLoanCards = useMemo(() => {
    // Use bucketedLoans (from prediction endpoint) as primary source - they have accurate risk bucketing
    // Fall back to loansRaw if no bucketed data
    if (bucketedLoans && bucketedLoans.length > 0) {
      // Filter to high-risk loans from bucketed data
      const highRiskLoans = bucketedLoans.filter((l: any) => l.bucket === 'high');
      
      // Debug: Log first high-risk loan to see available fields (snake_case from backend)
      if (highRiskLoans.length > 0) {
        console.log('[CriticalLoans Debug] First high-risk loan fields:', {
          loan_officer: highRiskLoans[0].loan_officer,
          fico_score: highRiskLoans[0].fico_score,
          ltv_ratio: highRiskLoans[0].ltv_ratio,
          be_dti_ratio: highRiskLoans[0].be_dti_ratio,
          interest_rate: highRiskLoans[0].interest_rate,
          market_rate: highRiskLoans[0].market_rate,
          current_milestone: highRiskLoans[0].current_milestone,
          allKeys: Object.keys(highRiskLoans[0]).slice(0, 30)
        });
      }
      
      return highRiskLoans.map((l: any) => {
        // Use snake_case field names matching database columns
        const loanId = l.loan_id || l.id || '';
        const loanAmount = typeof l.loan_amount === 'number' ? l.loan_amount : 
                          parseFloat(l.loan_amount || '0');
        
        // Extract reason from riskSummary object (it has {risks, positives, overallRisk, predictedOutcome, confidence})
        let reason = 'High risk signals detected';
        if (l.riskSummary && typeof l.riskSummary === 'object') {
          // Combine the risks array into a readable string
          const risks = l.riskSummary.risks;
          if (Array.isArray(risks) && risks.length > 0) {
            reason = risks.slice(0, 3).join('; '); // Show top 3 risks
          } else if (l.riskSummary.overallRisk) {
            reason = `Overall risk: ${l.riskSummary.overallRisk}`;
          }
        } else if (typeof l.riskSummary === 'string') {
          reason = l.riskSummary;
        }
        
        // Calculate risk score from signal strengths (1-6 scale → 0-100 scale)
        // Higher signal = higher risk, so we scale: (avgSignal / 6) * 100
        const signals = [
          l.creditMetricsSignalStrength,
          l.loanCharacteristicsSignalStrength,
          l.timeInMotionSignalStrength,
          l.mloAeFalloutProneSignalStrength,
          l.interestLockVsMarketSignalStrength,
        ].filter((s): s is number => typeof s === 'number' && !isNaN(s));
        
        let riskScore = 75; // Default for high-risk loans
        if (signals.length > 0) {
          const avgSignal = signals.reduce((sum, s) => sum + s, 0) / signals.length;
          // Scale 1-6 to roughly 50-100 range for high-risk loans
          // Signal 1 → ~50, Signal 6 → ~100
          riskScore = Math.round(40 + (avgSignal / 6) * 60);
        } else if (l.riskSummary?.confidence) {
          // Fall back to confidence if no signals available
          riskScore = l.riskSummary.confidence;
        }
        
        // Return in LoanCardsContainer expected format
        // Use snake_case field names matching database columns
        return {
          id: String(loanId),
          officer: l.loan_officer || '',
          amount: loanAmount ? `$${(loanAmount / 1000).toFixed(0)}K` : '$0',
          amountValue: loanAmount,
          riskLevel: 'Very High',
          riskScore,
          reason,
          // Credit metrics (snake_case matching DB)
          ficoScore: l.fico_score ?? null,
          ltvRatio: l.ltv_ratio ?? null,
          dtiRatio: l.be_dti_ratio ?? null,
          // Milestone and time in motion
          currentMilestone: l.current_milestone || l.lastCompletedMilestone || null,
          activeDays: l.activeDays ?? null,
          // Rates and market delta
          interestRate: l.interest_rate ?? null,
          marketRate: l.market_rate ?? null,
          marketChangeDelta: l.marketChangeDelta ?? null,
          // Pullthrough percentages (actual values)
          loPullthroughPct: l.loPullthroughPercentage ?? null,
          uwPullthroughPct: l.uwPullthroughPercentage ?? null,
          closerPullthroughPct: l.closerPullthroughPercentage ?? null,
          processorPullthroughPct: l.processorPullthroughPercentage ?? null,
          // Rule-based risk summary from backend (contains risks, positives, overallRisk, predictedOutcome, confidence)
          riskSummary: l.riskSummary || null,
          // Signal bucket scores (camelCase - computed fields)
          creditMetricsSignalStrength: l.creditMetricsSignalStrength ?? null,
          loanCharacteristicsSignalStrength: l.loanCharacteristicsSignalStrength ?? null,
          timeInMotionSignalStrength: l.timeInMotionSignalStrength ?? null,
          mloAeFalloutProneSignalStrength: l.mloAeFalloutProneSignalStrength ?? null,
          interestLockVsMarketSignalStrength: l.interestLockVsMarketSignalStrength ?? null,
          uwPullthroughSignalStrength: l.uwPullthroughSignalStrength ?? null,
          closerPullthroughSignalStrength: l.closerPullthroughSignalStrength ?? null,
          processorPullthroughSignalStrength: l.processorPullthroughSignalStrength ?? null,
          ficoScoreSignal: l.ficoScoreSignal ?? null,
          ltvSignal: l.ltvSignal ?? null,
          dtiSignal: l.dtiSignal ?? null,
          loPullthroughSignal: l.loPullthroughSignal ?? null,
          marketChangeDeltaSignal: l.marketChangeDeltaSignal ?? null,
          loanType: l.loan_type || null,
        };
      });
    }
    
    // Fallback: use loansRaw if no bucketed data available
    if (!loansRaw || loansRaw.length === 0) return [];

    const now = new Date();
    // Filter to only active loans that are predicted to fallout (withdraw or decline)
    const activeRaw = loansRaw.filter((l) => {
      // Must be active
      if (mapForecastStatus(l) !== 'Active') return false;
      
      // Check if this loan is predicted to fallout
      const loanId = l.loan_id || l.id;
      if (!loanId) return false;
      
      const predictedOutcome = loanPredictions[loanId];
      // Include loans predicted to withdraw or decline (API returns lowercase: 'withdraw', 'deny', 'originate')
      const outcomeLower = (predictedOutcome || '').toLowerCase();
      return outcomeLower === 'withdraw' || outcomeLower === 'deny' || outcomeLower === 'decline';
    });

    return activeRaw.map((l) => {
      const base = transformLoanToCard(l);
      const loanId = l.loan_id || l.id;
      const predictedOutcome = loanId ? loanPredictions[loanId] : null;
      
      // Determine risk level and reason based on prediction
      // Note: API returns lowercase: 'withdraw', 'deny', 'originate'
      let riskLevel = 'High';
      let riskScore = base.riskScore ?? 70;
      let reason = base.reason || '';
      
      const outcomeLower = (predictedOutcome || '').toLowerCase();
      if (outcomeLower === 'withdraw' || outcomeLower === 'deny' || outcomeLower === 'decline') {
        riskLevel = 'Very High';
        riskScore = Math.max(riskScore, 85);
        const outcomeText = outcomeLower === 'withdraw' ? 'withdraw' : 'decline';
        reason = `AI predicts loan will ${outcomeText}. ${reason ? reason : ''}`.trim();
      }
      
      if (isLikelyCloseLateForecast(l, 30, now)) {
        riskLevel = 'Very High';
        riskScore = Math.max(riskScore, 85);
        reason = reason 
          ? `Past expected closing window; ${reason}`
          : 'Past expected closing window';
      }
      
      return {
        ...base,
        riskLevel,
        riskScore,
        reason,
      };
    });
  }, [bucketedLoans, loansRaw, loanPredictions]);

  // Animated values for main metrics
  const animatedActiveLoans = useCountUp(metrics.activeLoansToday, 1500, 0, isAnimating);
  const animatedClosedLoans = useCountUp(metrics.closedLoansMTD, 1500, 200, isAnimating);
  const animatedPredictedClosing = useCountUp(metrics.predictedClosing, 1500, 400, isAnimating);
  const animatedLikelyCloseLate = useCountUp(metrics.likelyCloseLate, 1500, 600, isAnimating);

  // Animated values for outcome metrics
  const animatedPredictedFallout = useCountUp(metrics.predictedFalloutTotal, 1500, 0, isAnimating);
  const animatedWithdraw = useCountUp(metrics.likelyWithdraw, 1500, 200, isAnimating);
  const animatedDecline = useCountUp(metrics.likelyDecline, 1500, 400, isAnimating);

  const ensureLoansLoaded = async (periodToUse?: PeriodValue) => {
    // If no period specified, only load when we don't have loans yet (session cache uses one "all" set)
    if (!periodToUse && (loansRaw || loansLoading)) return;
    
    setLoansLoading(true);
    setLoansError(null);
    try {
      const now = new Date();
      // Always request the full set ('all') so metrics for every period can be computed client-side
      const { start, end } = getPeriodRange(periodToUse ?? 'all', now);
      
      // NOTE: A new /api/dashboard/overview endpoint is available that computes metrics server-side.
      // To fully optimize, refactor this component to use that endpoint instead of client-side computation.
      // For now, keep fetching 5000 loans for accurate client-side metrics.
      const params = new URLSearchParams();
      params.append('limit', '5000'); // Full dataset needed for accurate client-side metrics
      params.append('offset', '0');
      
      // Add date filters if period is not 'all'
      if (start) {
        params.append('start_date', start.toISOString().split('T')[0]);
      }
      if (end) {
        params.append('end_date', end.toISOString().split('T')[0]);
      }
      
      const res = await api.request<{ loans: any[] }>(`/api/loans?${params.toString()}`);
      setLoansRaw(res.loans || []);
    } catch (e: any) {
      const errorMsg = e?.message || 'Failed to load loans';
      // Silently handle common startup/auth errors
      if (errorMsg.includes('Database not initialized') || 
          errorMsg.includes('not found') || 
          errorMsg.includes('Unauthorized') ||
          errorMsg.includes('Tenant not found')) {
        setLoansRaw([]);
      } else {
        console.error('[Signal Buckets] Error loading loans:', errorMsg);
        setLoansError(errorMsg);
        setLoansRaw([]);
      }
    } finally {
      setLoansLoading(false);
    }
  };

  const handleMetricClick = async (label: string) => {
    ensureLoansLoaded(); // Load full set if needed (no refetch if already loaded)

    // Outcome list modals - show predicted loans
    if (label === 'Predicted Fallout') {
      setOutcomeModalType('fallout');
      return;
    }
    if (label === 'Likely Withdraw') {
      setOutcomeModalType('withdraw');
      return;
    }
    if (label === 'Likely Decline') {
      setOutcomeModalType('decline');
      return;
    }
    if (label === 'Likely Close Late') {
      setOutcomeModalType('delayed');
      return;
    }

    // Metric drilldown modal
    setMetricModalLabel(label);
  };

  return (
    <TooltipProvider>
      <div className="mb-8 md:mb-12">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 lg:gap-10 items-stretch">
          {/* Main Forecast Section */}
          <div className="md:col-span-8 lg:col-span-9 flex flex-col">
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
                <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light truncate">Predictive insights and closing forecasts</p>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0 flex-wrap">
              {/* Start Prediction - manual trigger; disabled until run completes */}
              <Button
                type="button"
                onClick={runPrediction}
                disabled={predictionsLoading}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:px-3 sm:py-2 text-[10px] sm:text-xs font-medium uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500 text-white border-0 shadow-sm disabled:opacity-50 disabled:pointer-events-none disabled:cursor-not-allowed"
                title={predictionsLoading ? 'Prediction in progress…' : 'Analyze loans and calculate risk signals'}
              >
                <Play className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                {predictionsLoading ? 'Running…' : 'Start Prediction'}
              </Button>
              {/* Predictive Insights Badge */}
              <div className="px-2 sm:px-3 md:px-4 py-1 sm:py-1.5 md:py-2 rounded-full border flex items-center space-x-1.5 sm:space-x-2 w-fit backdrop-blur-sm bg-emerald-50/90 dark:bg-emerald-500/10 border-emerald-200/60 dark:border-emerald-500/30">
                <span className="w-1 h-1 sm:w-1.5 sm:h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.4)]"></span>
                <span className="text-[8px] sm:text-[9px] md:text-[10px] font-medium text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Predictive Insights</span>
              </div>
              <PeriodDropdown
                period={period}
                onPeriodChange={(p) => {
                  setPeriod(p);
                }}
                availableYears={availableYears}
                isDarkMode={isDarkMode}
              />
            </div>
          </div>

          {/* Main Metrics Grid - 3 KPIs centered */}
          <div className="grid grid-cols-3 gap-4 sm:gap-6 md:gap-8 lg:gap-12 mb-8 md:mb-12 max-w-4xl mx-auto">
            {/* Active Loans Today */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick("Active Loans Today")}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                      <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                        Active Loans Today
                      </p>
                      <span className="px-1 sm:px-1.5 py-0.5 rounded text-[6px] sm:text-[7px] font-bold uppercase tracking-wide bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400">
                        Live
                      </span>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] transition-all duration-300 group-hover/stat:scale-[1.02] text-slate-900 dark:text-slate-50">
                      {isAnimating ? animatedActiveLoans.toLocaleString() : metrics.activeLoansToday.toLocaleString()}
                    </p>
                    <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium group-hover/stat:text-blue-500 dark:group-hover/stat:text-blue-400 transition-colors duration-300">
                      ${metrics.pipelineValueM}M Pipeline
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Active Loans Today").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Active Loans Today").desc}</p>
                </TooltipContent>
            </Tooltip>

            {/* Predicted Closing */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick("Predicted Closing")}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                      <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                        Predicted Closing
                      </p>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] transition-all duration-300 group-hover/stat:scale-[1.02] text-slate-900 dark:text-slate-50">
                      {isAnimating ? animatedPredictedClosing.toLocaleString() : metrics.predictedClosing.toLocaleString()}
                    </p>
                    <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium group-hover/stat:text-blue-500 dark:group-hover/stat:text-blue-400 transition-colors duration-300">
                      {metrics.predictedClosing > 0 ? `${metrics.pullThroughRateDisplay}% Pull-Through (R90D)` : '% Pull-Through'}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[280px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Predicted Closing").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Predicted Closing").desc}</p>
                  <p className="text-xs text-slate-400 mt-1">Pull-through uses Rolling 90 Days and excludes active loans for accuracy.</p>
                </TooltipContent>
            </Tooltip>

            {/* Likely Close Late */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick("Likely Close Late")}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center">
                      <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                        Likely Close Late
                      </p>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] transition-all duration-300 group-hover/stat:scale-[1.02] text-slate-900 dark:text-slate-50">
                      {isAnimating ? animatedLikelyCloseLate.toLocaleString() : metrics.likelyCloseLate.toLocaleString()}
                    </p>
                    <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium group-hover/stat:text-blue-500 dark:group-hover/stat:text-blue-400 transition-colors duration-300">
                      Units
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Likely Close Late").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Likely Close Late").desc}</p>
                </TooltipContent>
            </Tooltip>
          </div>

          {/* Outcome Metrics Grid */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4 md:gap-6 lg:gap-8 mt-auto">
            {/* Predicted Fallout */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    onClick={() => handleMetricClick("Predicted Fallout")} 
                    className="p-3 sm:p-5 md:p-6 lg:p-8 rounded-xl md:rounded-xl lg:rounded-2xl border transition-all duration-300 cursor-pointer group/outcome text-center overflow-hidden bg-white dark:bg-slate-900/30 border-slate-200/60 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10 shadow-[0_1px_4px_rgba(0,0,0,0.04)] dark:hover:bg-slate-800/50 hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]"
                  >
                    <p className="text-[8px] sm:text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-wide sm:tracking-widest mb-1.5 sm:mb-2 lg:mb-3 leading-tight text-rose-600 dark:text-rose-400">
                      Predicted Fallout
                    </p>
                    <p className="text-base sm:text-xl md:text-2xl lg:text-3xl font-light tracking-tight text-rose-500 dark:text-rose-400">
                      {isAnimating ? animatedPredictedFallout.toLocaleString() : metrics.predictedFalloutTotal.toLocaleString()}
                    </p>
                    <p className="text-[8px] sm:text-xs md:text-sm text-slate-400 font-normal mt-1 uppercase">
                      {metrics.falloutRate}%
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Predicted Fallout").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Predicted Fallout").desc}</p>
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
                      {isAnimating ? animatedWithdraw.toLocaleString() : metrics.likelyWithdraw.toLocaleString()}
                    </p>
                    <p className="text-[8px] sm:text-xs md:text-sm text-slate-400 font-normal mt-1 uppercase">
                      Units
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Likely Withdraw").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Likely Withdraw").desc}</p>
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
                      {isAnimating ? animatedDecline.toLocaleString() : metrics.likelyDecline.toLocaleString()}
                    </p>
                    <p className="text-[8px] sm:text-xs md:text-sm text-slate-400 font-normal mt-1 uppercase">
                      Units
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Likely Decline").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Likely Decline").desc}</p>
                </TooltipContent>
            </Tooltip>
          </div>
              </div>
            </DashboardCard>
          </div>

          {/* Pipeline Snapshot Section */}
          <div className="md:col-span-4 lg:col-span-3 flex flex-col order-first md:order-none">
            <section className="bg-[#1A56DB] rounded-xl md:rounded-2xl p-6 md:p-10 lg:p-12 text-white shadow-[0_20px_50px_-15px_rgba(26,86,219,0.4)] flex-1 flex flex-col">
              <h3 className="text-[10px] md:text-[11px] font-semibold uppercase tracking-widest mb-6 opacity-80">Pipeline Snapshot</h3>
              <div className="space-y-6 md:space-y-8 flex-1 flex flex-col justify-between">
                {kpis.map((kpi) => (
                  <Tooltip key={kpi.label}>
                    <TooltipTrigger asChild>
                      <div 
                        className="group cursor-pointer hover:bg-white/5 rounded-xl p-3 -mx-3 transition-all duration-200"
                        onClick={() => handleMetricClick(kpi.label)}
                      >
                        <p className="text-[9px] md:text-[10px] font-semibold uppercase tracking-[0.2em] mb-2 opacity-60 group-hover:opacity-90 transition-opacity">{kpi.label}</p>
                        <div className="flex items-baseline justify-between">
                          <p className="text-2xl md:text-4xl lg:text-5xl font-thin tracking-tight group-hover:scale-[1.02] transition-transform">{kpi.value}</p>
                          <div className="text-right">
                            <span className="text-[7px] md:text-[8px] font-medium uppercase tracking-wider opacity-50 block">{kpi.secondaryLabel}</span>
                            <span className="text-[10px] md:text-xs font-semibold text-white/90">{kpi.secondaryValue}</span>
                          </div>
                        </div>
                        <div className="mt-3 md:mt-4 h-px w-full bg-white/10 group-hover:bg-white/20 transition-colors"></div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                      <p className="font-semibold mb-1 text-white">{kpi.label}</p>
                      <p className="text-xs text-slate-300">{kpi.explanation}</p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </section>
          </div>
        </div>

        {/* ============================================================================
            TESTING: Loan Signal Strength Buckets Table
            This section displays signal strength buckets for each loan.
            Controlled by SHOW_SIGNAL_BUCKETS_TABLE flag above.
            Always shows table structure (headers) even when no data, so you can see the template.
            ============================================================================ */}
        {SHOW_SIGNAL_BUCKETS_TABLE && (
          <section 
            className={`mt-6 md:mt-12 md:rounded-2xl md:border overflow-hidden ${isDarkMode ? 'bg-transparent md:bg-slate-900/50 md:border-white/10' : 'bg-transparent md:bg-white md:border-slate-200 md:shadow-sm'}`}
            data-testid="signal-buckets-table"
          >
            <div className={`p-4 md:p-6 border-b ${isDarkMode ? 'border-white/10' : 'border-slate-100'}`}>
              <h3 className="text-sm md:text-base font-semibold text-slate-900 dark:text-white">
                Loan Signal Strength Buckets
              </h3>
              <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400 mt-1">
                Signal strength buckets (1 = less fallout prone, 6 = more fallout prone) for each active loan
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
                  <tr className={`border-b ${isDarkMode ? 'border-white/10 bg-slate-800/50' : 'border-slate-100 bg-slate-50'}`}>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700 dark:text-slate-300 sticky left-0 z-10 bg-inherit">Loan ID</th>
                    <th className="text-left py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Type</th>
                    <th className="text-right py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Amount</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">FICO</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">LTV</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">DTI</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Credit Signal</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Loan Char</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Time Motion</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">LO Pull</th>
                    <th className="text-center py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">Market Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {bucketedLoans.length > 0 ? (
                    (() => {
                      // Calculate pagination
                      const startIndex = (currentPage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      const paginatedLoans = bucketedLoans.slice(startIndex, endIndex);
                      
                      return paginatedLoans.map((loan, idx) => {
                    const getBucketColor = (bucket: number | null) => {
                      if (bucket === null) return 'text-slate-400 dark:text-slate-500';
                      if (bucket <= 2) return 'text-emerald-600 dark:text-emerald-400 font-semibold';
                      if (bucket <= 4) return 'text-yellow-600 dark:text-yellow-400';
                      return 'text-rose-600 dark:text-rose-400 font-semibold';
                    };
                    
                    const getBucketBg = (bucket: number | null) => {
                      if (bucket === null) return '';
                      if (bucket <= 2) return 'bg-emerald-50/50 dark:bg-emerald-950/20';
                      if (bucket <= 4) return 'bg-yellow-50/50 dark:bg-yellow-950/20';
                      return 'bg-rose-50/50 dark:bg-rose-950/20';
                    };

                    return (
                      <tr 
                        key={loan.loanId || loan.id || idx} 
                        className={`border-b cursor-pointer ${isDarkMode ? 'border-white/5 hover:bg-slate-800/30' : 'border-slate-100 hover:bg-slate-50/50'} transition-colors`}
                        onClick={() => setSelectedLoanForDetail(loan)}
                        title="Click to view loan risk details"
                      >
                        <td className={`py-3 px-4 font-mono text-xs text-slate-600 dark:text-slate-300 sticky left-0 z-10 ${isDarkMode ? 'bg-slate-900/50' : 'bg-white'} shadow-[2px_0_4px_rgba(0,0,0,0.05)]`}>
                          {loan.loanId || loan.id || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-slate-700 dark:text-slate-300 truncate max-w-[120px]" title={loan.loanType || loan.loan_type || 'N/A'}>
                          {loan.loanType || loan.loan_type || 'N/A'}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {loan.loanAmount ? `$${(loan.loanAmount / 1000).toFixed(0)}k` : 'N/A'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.ficoScoreSignal)} ${getBucketBg(loan.ficoScoreSignal)}`}>
                          {loan.ficoScoreSignal ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.ltvSignal)} ${getBucketBg(loan.ltvSignal)}`}>
                          {loan.ltvSignal ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.dtiSignal)} ${getBucketBg(loan.dtiSignal)}`}>
                          {loan.dtiSignal ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.creditMetricsSignalStrength)} ${getBucketBg(loan.creditMetricsSignalStrength)}`}>
                          {loan.creditMetricsSignalStrength ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.loanCharacteristicsSignalStrength)} ${getBucketBg(loan.loanCharacteristicsSignalStrength)}`}>
                          {loan.loanCharacteristicsSignalStrength ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.timeInMotionSignalStrength)} ${getBucketBg(loan.timeInMotionSignalStrength)}`}>
                          {loan.timeInMotionSignalStrength ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.loPullthroughSignal)} ${getBucketBg(loan.loPullthroughSignal)}`}>
                          {loan.loPullthroughSignal ?? '—'}
                        </td>
                        <td className={`py-3 px-4 text-center font-mono tabular-nums ${getBucketColor(loan.marketChangeDeltaSignal)} ${getBucketBg(loan.marketChangeDeltaSignal)}`}>
                          {loan.marketChangeDeltaSignal ?? '—'}
                        </td>
                      </tr>
                    );
                    });
                    })()
                  ) : (
                    <tr>
                      <td colSpan={11} className="py-8 px-4 text-center text-sm text-slate-500 dark:text-slate-400">
                        {predictionsLoading || loansLoading ? (
                          'Loading loan data and calculating signal strength buckets...'
                        ) : loansError ? (
                          `Unable to load loans: ${loansError}`
                        ) : bucketedLoans.length === 0 && loansRaw && loansRaw.length > 0 ? (
                          `Loaded ${loansRaw.length} loans but no bucketed data received. Check console for errors.`
                        ) : (
                          `No loan data available. Upload a CSV file or ensure loans are loaded to see signal strength buckets. (loansRaw: ${loansRaw?.length || 0}, bucketedLoans: ${bucketedLoans.length})`
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {bucketedLoans.length > 0 && (
              <div className={`p-4 md:p-6 border-t ${isDarkMode ? 'border-white/10 bg-slate-800/30' : 'border-slate-100 bg-slate-50'}`}>
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
                          ? 'bg-slate-700 border-white/20 text-slate-200' 
                          : 'bg-white border-slate-300 text-slate-700'
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
                    Showing {Math.min((currentPage - 1) * itemsPerPage + 1, bucketedLoans.length)} - {Math.min(currentPage * itemsPerPage, bucketedLoans.length)} of {bucketedLoans.length} loans
                  </div>
                  
                  {/* Pagination controls */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage(1)}
                      disabled={currentPage === 1}
                      className={`px-2 py-1 text-xs md:text-sm rounded ${
                        currentPage === 1
                          ? 'opacity-50 cursor-not-allowed text-slate-400'
                          : isDarkMode
                          ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                          : 'bg-white text-slate-700 hover:bg-slate-100'
                      } border ${isDarkMode ? 'border-white/20' : 'border-slate-300'}`}
                    >
                      First
                    </button>
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                      className={`px-3 py-1 text-xs md:text-sm rounded ${
                        currentPage === 1
                          ? 'opacity-50 cursor-not-allowed text-slate-400'
                          : isDarkMode
                          ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                          : 'bg-white text-slate-700 hover:bg-slate-100'
                      } border ${isDarkMode ? 'border-white/20' : 'border-slate-300'}`}
                    >
                      Previous
                    </button>
                    <span className="text-xs md:text-sm text-slate-600 dark:text-slate-400 px-2">
                      Page {currentPage} of {Math.ceil(bucketedLoans.length / itemsPerPage)}
                    </span>
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(Math.ceil(bucketedLoans.length / itemsPerPage), prev + 1))}
                      disabled={currentPage >= Math.ceil(bucketedLoans.length / itemsPerPage)}
                      className={`px-3 py-1 text-xs md:text-sm rounded ${
                        currentPage >= Math.ceil(bucketedLoans.length / itemsPerPage)
                          ? 'opacity-50 cursor-not-allowed text-slate-400'
                          : isDarkMode
                          ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                          : 'bg-white text-slate-700 hover:bg-slate-100'
                      } border ${isDarkMode ? 'border-white/20' : 'border-slate-300'}`}
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setCurrentPage(Math.ceil(bucketedLoans.length / itemsPerPage))}
                      disabled={currentPage >= Math.ceil(bucketedLoans.length / itemsPerPage)}
                      className={`px-2 py-1 text-xs md:text-sm rounded ${
                        currentPage >= Math.ceil(bucketedLoans.length / itemsPerPage)
                          ? 'opacity-50 cursor-not-allowed text-slate-400'
                          : isDarkMode
                          ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                          : 'bg-white text-slate-700 hover:bg-slate-100'
                      } border ${isDarkMode ? 'border-white/20' : 'border-slate-300'}`}
                    >
                      Last
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Critical Loans and Top Loan Officers Section */}
        <section className={`mt-6 md:mt-12 md:rounded-2xl md:border overflow-hidden lg:min-h-[480px] ${isDarkMode ? 'bg-transparent md:bg-slate-900/50 md:border-white/10' : 'bg-transparent md:bg-white md:border-slate-200 md:shadow-sm'}`}>
          <div className={`flex border-b ${isDarkMode ? 'border-white/10' : 'border-slate-100'}`}>
            <button
              onClick={() => setInsightsTab('critical')}
              className={`flex-1 py-4 lg:py-5 px-6 text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-widest transition-all ${
                insightsTab === 'critical'
                  ? isDarkMode
                    ? 'bg-slate-800/50 text-white border-b-2 border-rose-500'
                    : 'bg-slate-50 text-slate-900 border-b-2 border-rose-500'
                  : isDarkMode
                    ? 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/30'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Critical Loans
              </span>
            </button>
            <button
              onClick={() => setInsightsTab('officers')}
              className={`flex-1 py-4 lg:py-5 px-6 text-[10px] md:text-[11px] lg:text-xs font-semibold uppercase tracking-widest transition-all ${
                insightsTab === 'officers'
                  ? isDarkMode
                    ? 'bg-slate-800/50 text-white border-b-2 border-indigo-500'
                    : 'bg-slate-50 text-slate-900 border-b-2 border-indigo-500'
                  : isDarkMode
                    ? 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/30'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
                Top Loan Officers
              </span>
            </button>
          </div>

          <div className="py-4 md:p-8 lg:p-10">
            {insightsTab === 'critical' && (
              <div>
                {loansError ? (
                  <div className={`text-sm py-6 text-center ${isDarkMode ? 'text-rose-400' : 'text-rose-600'}`}>{loansError}</div>
                ) : loansLoading && !loansRaw ? (
                  <div className={`text-sm py-6 text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Loading loans…</div>
                ) : null}
                <LoanCardsContainer
                  loans={criticalLoanCards as any}
                  predictions={fullPredictions}
                  isDarkMode={isDarkMode}
                />
              </div>
            )}

            {insightsTab === 'officers' && (
              (() => {
                // TODO: Replace with actual loan officer data from API using aggregateLoanOfficers utility
                const mockOfficers: Array<{ name: string; activeLoans: number; pullThrough: string; volume: string; risk: 'Low' | 'Medium' | 'High' }> = [];
                
                return mockOfficers.length === 0 ? (
                  <div className={`text-center py-12 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>
                    <svg className="w-12 h-12 mx-auto mb-4 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <p className="text-sm font-medium">No loan officer activity for this period</p>
                    <p className="text-xs mt-1 opacity-70">Try selecting a different date range to see loan officers</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3 lg:gap-4">
                    {mockOfficers.slice(0, 16).map((mlo, index) => (
                      <div 
                        key={mlo.name} 
                        className={`flex items-center justify-between p-3 sm:p-4 lg:p-5 rounded-lg sm:rounded-xl transition-all duration-200 group cursor-pointer active:scale-[0.98] ${isDarkMode ? 'bg-slate-800/40 hover:bg-slate-800/60 shadow-[0_1px_3px_rgba(0,0,0,0.15)]' : 'bg-white shadow-[0_1px_4px_rgba(0,0,0,0.04)] hover:shadow-[0_2px_8px_rgba(0,0,0,0.06)]'}`}
                        onClick={() => setSelectedOfficer(mlo.name)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 sm:w-10 sm:h-10 lg:w-11 lg:h-11 rounded-lg flex items-center justify-center text-xs sm:text-sm font-semibold ${isDarkMode ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-50 text-indigo-600'}`}>
                            {index + 1}
                          </div>
                          <div className="min-w-0">
                            <button 
                              onClick={(e) => { e.stopPropagation(); setSelectedOfficer(mlo.name); }}
                              className={`text-[13px] sm:text-sm font-medium hover:underline text-left truncate block max-w-[140px] sm:max-w-none ${isDarkMode ? 'text-slate-100 hover:text-indigo-400' : 'text-slate-700 hover:text-indigo-600'}`}
                            >
                              {mlo.name}
                            </button>
                            <p className={`text-[10px] sm:text-[11px] ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>
                              {mlo.activeLoans || 0} loans · {mlo.pullThrough}
                            </p>
                          </div>
                        </div>
                        <div className={`px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-md text-[10px] sm:text-[11px] font-medium ${mlo.risk === 'Low' ? 'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-500/15' : 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-500/15'}`}>
                          {mlo.volume}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()
            )}
          </div>
        </section>

        {selectedOfficer && (
          <LoanOfficerModal
            officerName={selectedOfficer}
            isOpen={!!selectedOfficer}
            onClose={() => setSelectedOfficer(null)}
            isDarkMode={isDarkMode}
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
            metricModalLabel === 'Active Loans Today'
              ? metrics.activeLoansToday
              : metricModalLabel?.startsWith('Funded Loans')
                ? metrics.closedLoansMTD
                : metricModalLabel === 'Predicted Closing'
                  ? metrics.predictedClosing
                  : metricModalLabel === 'Predicted Fallout'
                    ? metrics.predictedFalloutTotal
                    : undefined
          }
          subLabel={
            metricModalLabel === 'Active Loans Today'
              ? `$${metrics.pipelineValueM}M Pipeline`
              : metricModalLabel?.startsWith('Funded Loans')
                ? `${periodLabel}`
                : metricModalLabel === 'Predicted Closing'
                  ? `${metrics.pullThroughRateDisplay}% Pull-Through (Rolling 90D)`
                  : metricModalLabel === 'Predicted Fallout'
                    ? `${metrics.falloutRate}%`
                    : undefined
          }
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
