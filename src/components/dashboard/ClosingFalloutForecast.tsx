import { useState, useEffect, useRef, useMemo } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { DashboardCard } from './DashboardCard';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useDashboardStats } from '@/hooks/useDashboardStats';
import { LoanCardsContainer } from './LoanCardsContainer';
import { LoanOfficerModal } from './LoanOfficerModal';
import { useTheme } from '@/components/theme-provider';
import { api } from '@/lib/api';
import { ClosingFalloutMetricModal } from '@/components/dashboard/modals/ClosingFalloutMetricModal';
import { OutcomeLoansModal, type OutcomeModalType } from '@/components/dashboard/modals/OutcomeLoansModal';
import { PeriodValue, getLoanAmountNumber, inferLoanStatus, isDateInPeriod, isFundedInPeriod, isLikelyCloseLate, getPeriodRange } from '@/utils/closingFalloutFilters';
import { transformLoanToCard } from '@/utils/loanDataTransform';

interface ClosingFalloutForecastProps {
  dateFilter?: 'today' | 'mtd' | 'ytd' | 'custom';
}

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
}> = ({ period, onPeriodChange, availableYears, isDarkMode }) => {
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
};

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
    case "Likely Close Late": return { title: "Pipeline Stagnation", desc: "Loans that have exceeded their expected closing date by more than 72 hours." };
    default:
      return { title: label, desc: "Standardized performance metric for portfolio monitoring." };
  }
};

/**
 * Closing & Fallout Forecast Component
 * Displays predictive analytics for loan closings and fallout risk
 */
export const ClosingFalloutForecast = ({ dateFilter = 'mtd' }: ClosingFalloutForecastProps) => {
  const { statsData, statsLoading, funnelData } = useDashboardStats(dateFilter);
  const [isAnimating, setIsAnimating] = useState(true);
  const [insightsTab, setInsightsTab] = useState<'critical' | 'officers'>('critical');
  const [selectedOfficer, setSelectedOfficer] = useState<string | null>(null);
  const { theme } = useTheme();
  const isDarkMode = theme === 'dark';

  const [period, setPeriod] = useState<PeriodValue>('all');
  const prevPeriodRef = useRef<PeriodValue>(period);

  // Lazy loan loading (only when a tile modal is opened)
  const [loansRaw, setLoansRaw] = useState<any[] | null>(null);
  const [loansLoading, setLoansLoading] = useState(false);
  const [loansError, setLoansError] = useState<string | null>(null);

  // Modal state
  const [metricModalLabel, setMetricModalLabel] = useState<string | null>(null);
  const [outcomeModalType, setOutcomeModalType] = useState<OutcomeModalType | null>(null);

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

  // Calculate metrics from data
  const metrics = useMemo(() => {
    const now = new Date();
    const hasLoans = loansRaw && loansRaw.length > 0 && !loansError;

    if (hasLoans) {
      const loans = loansRaw as any[];
      const activeLoans = loans.filter((l) => ['Active', 'Locked'].includes(inferLoanStatus(l)));
      const pipelineValue = activeLoans.reduce((sum, l) => sum + getLoanAmountNumber(l), 0);
      const pipelineValueM = pipelineValue > 0 ? (pipelineValue / 1000000).toFixed(1) : '0';

      const fundedLoansInPeriod = loans.filter((l) => isFundedInPeriod(l, period, now));
      const fundedCount = fundedLoansInPeriod.length;

      const startedInPeriod = loans.filter((l) => isDateInPeriod(l?.application_date, period, now));
      const pullThroughRate = startedInPeriod.length > 0 ? (fundedCount / startedInPeriod.length) * 100 : (statsData?.pullThroughRate ?? 0);
      const pullThroughRateDisplay = pullThroughRate > 0 ? Math.round(pullThroughRate) : 0;

      const activeLoansToday = activeLoans.length;
      const predictedClosing = activeLoansToday > 0 ? Math.round((activeLoansToday * pullThroughRate) / 100) : 0;

      const likelyCloseLate = activeLoans.filter((l) => isLikelyCloseLate(l, 30, now)).length;

      const likelyWithdraw = loans.filter((l) => inferLoanStatus(l) === 'Withdrawn' && (period === 'all' || isDateInPeriod(l?.application_date, period, now))).length;
      const likelyDecline = loans.filter((l) => inferLoanStatus(l) === 'Denied' && (period === 'all' || isDateInPeriod(l?.application_date, period, now))).length;
      const predictedFalloutTotal = likelyWithdraw + likelyDecline;

      const falloutRate = activeLoansToday > 0 ? Math.round((predictedFalloutTotal / activeLoansToday) * 100) : 0;

      const lockedLoans = loans.filter((l) => inferLoanStatus(l) === 'Locked').length;
      const avgCycleTime = statsData?.avgCycleTime ?? 24;

      return {
        activeLoansToday,
        closedLoansMTD: fundedCount,
        predictedClosing,
        likelyCloseLate,
        likelyWithdraw,
        likelyDecline,
        predictedFalloutTotal,
        pipelineValueM,
        pullThroughRateDisplay,
        falloutRate,
        lockedLoans,
        avgCycleTime,
        pipelineValue
      };
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
    
    // Fallout metrics
    const likelyWithdraw = funnelData?.falloutWithdrawn?.units ?? 0;
    const likelyDecline = funnelData?.falloutDenied?.units ?? 0;
    const predictedFalloutTotal = likelyWithdraw + likelyDecline;
    
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
      avgCycleTime,
      pipelineValue
    };
  }, [statsData, funnelData, loansRaw, loansError, period]);

  // Calculate KPIs for Pipeline Snapshot
  const kpis = useMemo(() => {
    const pipelineUPB = metrics.pipelineValue > 0 
      ? `$${(metrics.pipelineValue / 1000000).toFixed(1)}M`
      : '$0M';
    
    const locksToday = metrics.lockedLoans;
    
    const pullThrough = `${metrics.pullThroughRateDisplay}%`;

    return [
      {
        label: 'Pipeline UPB',
        value: pipelineUPB,
        secondaryLabel: 'Total UPB',
        secondaryValue: pipelineUPB,
        explanation: 'Total Unpaid Principal Balance. Forward-looking revenue.'
      },
      {
        label: 'Locks Today',
        value: locksToday.toString(),
        secondaryLabel: 'Locked',
        secondaryValue: locksToday.toString(),
        explanation: 'Secured rate locks. Immediate demand signal.'
      },
      {
        label: 'Pull-Through',
        value: pullThrough,
        secondaryLabel: 'Rate',
        secondaryValue: pullThrough,
        explanation: 'Success funding rate. Core efficiency.'
      }
    ];
  }, [metrics]);

  // Trigger animation when data changes
  useEffect(() => {
    setIsAnimating(false);
    const timer = setTimeout(() => {
      setIsAnimating(true);
    }, 100);
    return () => clearTimeout(timer);
  }, [statsData, funnelData, loansRaw, period]);

  // Reload loans when period changes
  useEffect(() => {
    const prevPeriod = prevPeriodRef.current;
    
    // Skip on initial mount (when prevPeriodRef matches current period and no loans loaded yet)
    if (prevPeriod === period) {
      return;
    }
    
    // Period has changed - update ref, clear loans and reload with new period
    prevPeriodRef.current = period;
    setLoansRaw(null);
    ensureLoansLoaded(period);
  }, [period]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ensure loans are loaded when switching to the Critical Loans tab (initial state is critical)
  useEffect(() => {
    if (insightsTab === 'critical') {
      ensureLoansLoaded();
    }
  }, [insightsTab]); // eslint-disable-line react-hooks/exhaustive-deps

  const criticalLoanCards = useMemo(() => {
    if (!loansRaw || loansRaw.length === 0) return [];

    const now = new Date();
    const activeRaw = loansRaw.filter((l) => ['Active', 'Locked'].includes(inferLoanStatus(l)));

    return activeRaw.map((l) => {
      const base = transformLoanToCard(l);
      if (isLikelyCloseLate(l, 30, now)) {
        return {
          ...base,
          riskLevel: 'Very High',
          riskScore: Math.max(base.riskScore ?? 0, 85),
          reason: base.reason
            ? `Past expected closing window; ${base.reason}`
            : 'Past expected closing window',
        };
      }
      return base;
    });
  }, [loansRaw]);

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
    // If periodToUse is provided, always reload (period changed)
    // Otherwise, only load if loans aren't already loaded
    if (!periodToUse && (loansRaw || loansLoading)) return;
    
    setLoansLoading(true);
    setLoansError(null);
    try {
      // Get period date range - use provided period or current state
      const now = new Date();
      const { start, end } = getPeriodRange(periodToUse ?? period, now);
      
      // Build query parameters
      const params = new URLSearchParams();
      params.append('limit', '1000');
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
      setLoansError(e?.message || 'Failed to load loans');
      setLoansRaw([]);
    } finally {
      setLoansLoading(false);
    }
  };

  const handleMetricClick = async (label: string) => {
    // Start fetching loans in the background (modal can show loading state)
    ensureLoansLoaded();

    // Outcome list modals (copied behavior from fallout)
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
            <div className="flex items-center gap-3 sm:gap-4 flex-shrink-0">
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

          {/* Main Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 md:gap-8 lg:gap-10 mb-8 md:mb-12">
            {/* Active Loans Today */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center sm:text-left space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick("Active Loans Today")}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center sm:justify-start">
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

            {/* Funded Loans */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center sm:text-left space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick(`Funded Loans ${periodLabel}`)}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center sm:justify-start">
                      <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                        Funded Loans {periodLabel}
                      </p>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] transition-all duration-300 group-hover/stat:scale-[1.02] text-slate-900 dark:text-slate-50">
                      {isAnimating ? animatedClosedLoans.toLocaleString() : metrics.closedLoansMTD.toLocaleString()}
                    </p>
                    <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium group-hover/stat:text-blue-500 dark:group-hover/stat:text-blue-400 transition-colors duration-300">
                      {periodLabel}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Funded Loans").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Funded Loans").desc}</p>
                </TooltipContent>
            </Tooltip>

            {/* Predicted Closing */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center sm:text-left space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick("Predicted Closing")}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center sm:justify-start">
                      <p className="text-[9px] sm:text-[10px] md:text-[11px] lg:text-sm font-semibold uppercase tracking-widest leading-tight text-slate-500 dark:text-slate-400">
                        Predicted Closing
                      </p>
                    </div>
                    <p className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-thin tracking-[-0.04em] transition-all duration-300 group-hover/stat:scale-[1.02] text-slate-900 dark:text-slate-50">
                      {isAnimating ? animatedPredictedClosing.toLocaleString() : metrics.predictedClosing.toLocaleString()}
                    </p>
                    <p className="text-[8px] md:text-[9px] lg:text-xs text-slate-500/60 dark:text-slate-400/70 font-medium group-hover/stat:text-blue-500 dark:group-hover/stat:text-blue-400 transition-colors duration-300">
                      {metrics.predictedClosing > 0 ? `${metrics.pullThroughRateDisplay}% Pull-Through` : '% Pull-Through'}
                    </p>
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-[230px] bg-black text-white border-slate-700">
                  <p className="font-semibold mb-1 text-white">{getMetricExplanation("Predicted Closing").title}</p>
                  <p className="text-xs text-slate-300">{getMetricExplanation("Predicted Closing").desc}</p>
                </TooltipContent>
            </Tooltip>

            {/* Likely Close Late */}
            <Tooltip>
                <TooltipTrigger asChild>
                  <div 
                    className="text-center sm:text-left space-y-1 sm:space-y-2 md:space-y-3 lg:space-y-4 cursor-pointer group/stat transition-all duration-300"
                    onClick={() => handleMetricClick("Likely Close Late")}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 justify-center sm:justify-start">
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
                  ? `${metrics.pullThroughRateDisplay}% Pull-Through`
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
        />
      </div>
    </TooltipProvider>
  );
};
