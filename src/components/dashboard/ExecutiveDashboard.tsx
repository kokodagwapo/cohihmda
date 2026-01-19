import { useEffect, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, ArrowUp, ArrowDown, X } from 'lucide-react';
import { LOSFunnelData } from '@/lib/losSchema';
import { BusinessDataTable } from '@/components/dashboard/BusinessDataTable';
import { useDashboardStats } from '@/hooks/useDashboardStats';

// Executive Dashboard - Business Overview Component (6 Cards with Modals)
export const ExecutiveDashboard = ({
  dateFilter,
  year = 2025
}: {
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom';
  year?: number;
}) => {
  const [selectedCard, setSelectedCard] = useState<string | null>(null);
  const [animatedValues, setAnimatedValues] = useState<Record<string, number>>({});
  const [isAnimating, setIsAnimating] = useState(false);

  // Use custom hook for API data
  const { statsData, statsLoading, funnelData: funnelDataState, funnelLoading } = useDashboardStats(dateFilter, year);

  const createZeroFunnelYear = (): LOSFunnelData => ({
    loansStarted: { revenue: 0, units: 0, volume: 0 },
    noRespaApp: { revenue: 0, units: 0, volume: 0, lostRevenue: 0 },
    respaApp: { revenue: 0, units: 0, volume: 0 },
    originated: { revenue: 0, units: 0, volume: 0 },
    falloutWithdrawn: { revenue: 0, units: 0, volume: 0, lostRevenue: 0 },
    falloutDenied: { revenue: 0, units: 0, volume: 0, lostRevenue: 0 },
    stillActive: { revenue: 0, units: 0, volume: 0 }
  });

  // Multi-year funnel data - synced with TopTiering (fallback only) - memoized to prevent infinite loops
  const multiYearFunnelData = useMemo<Record<number, LOSFunnelData>>(() => ({
    2025: createZeroFunnelYear(),
    2024: createZeroFunnelYear()
  }), []);

  // Memoize effectiveFunnelData to prevent reference changes on every render
  const effectiveFunnelData = useMemo(() => {
    return funnelDataState || multiYearFunnelData[year] || multiYearFunnelData[2025];
  }, [funnelDataState, multiYearFunnelData, year]);

  // Helper function to format numbers (using utility function)
  // Note: Using formatCompactNumberNoCurrency for non-currency numbers

  // Calculate metrics from funnelData or statsData - memoized to prevent infinite loops
  const metrics = useMemo(() => {
    // Show loading state if data is still loading
    if (statsLoading && !statsData) {
      return {
        activeLoans: { value: '--', change: '+12%', trend: 'up' as const },
        closedLoans: { value: '--', change: '+8%', trend: 'up' as const },
        lockedLoans: { value: '--', change: '+5%', trend: 'up' as const },
        cycleTime: { value: '-- days', change: '-2 days', trend: 'up' as const },
        pullThrough: { value: '--%', change: '+3.2%', trend: 'up' as const },
        creditPulls: { value: '--', change: '+15%', trend: 'up' as const }
      };
    }

    // If we have neither statsData nor funnelData, show placeholders
    if (!effectiveFunnelData && !statsData) {
      return {
        activeLoans: { value: '--', change: '+12%', trend: 'up' as const },
        closedLoans: { value: '--', change: '+8%', trend: 'up' as const },
        lockedLoans: { value: '--', change: '+5%', trend: 'up' as const },
        cycleTime: { value: '-- days', change: '-2 days', trend: 'up' as const },
        pullThrough: { value: '--%', change: '+3.2%', trend: 'up' as const },
        creditPulls: { value: '--', change: '+15%', trend: 'up' as const }
      };
    }

    // Always prefer statsData when available (even if values are 0) - this is the real imported data
    // Only fall back to funnelData if statsData is not available or still loading
    const useStatsData = statsData && !statsLoading;
    
    // Active Loans - always use statsData if available (even if 0), otherwise use funnel data
    const activeLoans = useStatsData && statsData.active !== undefined
      ? statsData.active 
      : (effectiveFunnelData?.stillActive?.units || 0);
    const activeLoansPrev = Math.round(activeLoans * 0.88); // Estimate previous period
    const activeLoansChange = activeLoansPrev > 0 ? ((activeLoans - activeLoansPrev) / activeLoansPrev * 100) : 12;

    // Closed Loans - always use statsData if available (even if 0), otherwise use funnel data
    const closedLoans = useStatsData && statsData.closed !== undefined
      ? statsData.closed 
      : (effectiveFunnelData?.originated?.units ?? 0);
    const closedLoansPrev = Math.round(closedLoans * 0.92); // Estimate previous period
    const closedLoansChange = closedLoansPrev > 0 ? ((closedLoans - closedLoansPrev) / closedLoansPrev * 100) : 8;

    // Locked Loans - always use statsData if available (even if 0), otherwise use funnel data
    const lockedLoans = useStatsData && statsData.locked !== undefined
      ? statsData.locked 
      : Math.round((effectiveFunnelData?.originated?.units || 0) * 1.1 + (effectiveFunnelData?.stillActive?.units || 0) * 0.8);
    const lockedLoansPrev = Math.round(lockedLoans * 0.95);
    const lockedLoansChange = lockedLoansPrev > 0 ? ((lockedLoans - lockedLoansPrev) / lockedLoansPrev * 100) : 5;

    // Cycle Time - always use statsData if available (even if 0), otherwise use default
    const cycleTime = useStatsData && statsData.avgCycleTime !== undefined
      ? statsData.avgCycleTime 
      : 24;
    const cycleTimePrev = cycleTime + 2; // Estimate previous
    const cycleTimeChange = cycleTimePrev - cycleTime;

    // Pull-Through - always use statsData if available (even if 0), otherwise calculate from funnel
    const pullThrough = useStatsData && statsData.pullThroughRate !== undefined
      ? statsData.pullThroughRate 
      : ((effectiveFunnelData?.loansStarted?.units && effectiveFunnelData.loansStarted.units > 0) 
        ? ((effectiveFunnelData?.originated?.units || 0) / effectiveFunnelData.loansStarted.units * 100) 
        : 0);
    const pullThroughPrev = pullThrough * 0.97; // Estimate previous
    const pullThroughChange = pullThrough - pullThroughPrev;

    // Credit Pulls - always use statsData if available (even if 0), otherwise use funnel data
    const creditPulls = useStatsData && statsData.creditPulls !== undefined
      ? statsData.creditPulls 
      : (effectiveFunnelData?.loansStarted?.units ?? 0);

    // Debug logging
    console.log('🔢 Calculated metrics:', JSON.stringify({
      activeLoans,
      closedLoans,
      lockedLoans,
      cycleTime,
      pullThrough: pullThrough.toFixed(1) + '%',
      creditPulls,
      usingStatsData: useStatsData,
      statsDataAvailable: !!statsData,
      statsLoading,
      usingFunnelData: !useStatsData && !!effectiveFunnelData,
      statsDataValues: statsData ? {
        active: statsData.active,
        closed: statsData.closed,
        locked: statsData.locked,
        avgCycleTime: statsData.avgCycleTime,
        pullThroughRate: statsData.pullThroughRate,
        creditPulls: statsData.creditPulls
      } : null
    }, null, 2));
    const creditPullsPrev = Math.round(creditPulls * 0.85);
    const creditPullsChange = creditPullsPrev > 0 ? ((creditPulls - creditPullsPrev) / creditPullsPrev * 100) : 15;

    return {
      activeLoans: { 
        value: activeLoans.toLocaleString(), 
        change: `${activeLoansChange >= 0 ? '+' : ''}${activeLoansChange.toFixed(0)}%`, 
        trend: activeLoansChange >= 0 ? 'up' as const : 'down' as const 
      },
      closedLoans: { 
        value: closedLoans.toLocaleString(), 
        change: `${closedLoansChange >= 0 ? '+' : ''}${closedLoansChange.toFixed(0)}%`, 
        trend: closedLoansChange >= 0 ? 'up' as const : 'down' as const 
      },
      lockedLoans: { 
        value: lockedLoans.toLocaleString(), 
        change: `${lockedLoansChange >= 0 ? '+' : ''}${lockedLoansChange.toFixed(0)}%`, 
        trend: lockedLoansChange >= 0 ? 'up' as const : 'down' as const 
      },
      cycleTime: { 
        value: `${cycleTime} days`, 
        change: `${cycleTimeChange >= 0 ? '-' : '+'}${Math.abs(cycleTimeChange)} days`, 
        trend: cycleTimeChange >= 0 ? 'up' as const : 'down' as const 
      },
      pullThrough: { 
        value: `${pullThrough.toFixed(1)}%`, 
        change: `${pullThroughChange >= 0 ? '+' : ''}${pullThroughChange.toFixed(1)}%`, 
        trend: pullThroughChange >= 0 ? 'up' as const : 'down' as const 
      },
      creditPulls: { 
        value: creditPulls.toLocaleString(), 
        change: `${creditPullsChange >= 0 ? '+' : ''}${creditPullsChange.toFixed(0)}%`, 
        trend: creditPullsChange >= 0 ? 'up' as const : 'down' as const 
      }
    };
  }, [statsLoading, statsData, effectiveFunnelData]);

  // Helper function to parse numeric value from formatted string
  const parseValue = (valueStr: string): number => {
    // Handle placeholder values
    if (valueStr === '--' || valueStr.includes('--')) {
      return 0;
    }
    // Remove commas, spaces, and extract number (handles formats like "25 days", "72.8%", "1,234")
    const cleaned = valueStr.replace(/,/g, '').replace(/\s+/g, '').replace(/[^\d.]/g, '');
    // Match numbers (including decimals)
    const match = cleaned.match(/[\d.]+/);
    if (match) {
      return parseFloat(match[0]);
    }
    return 0;
  };

  // Helper function to format animated value back to original format
  const formatAnimatedValue = (cardId: string, animatedNum: number, originalValue: string): string => {
    if (cardId === 'cycleTime') {
      return `${Math.round(animatedNum)} days`;
    }
    if (cardId === 'pullThrough') {
      return `${animatedNum.toFixed(1)}%`;
    }
    // For numbers with commas (activeLoans, closedLoans, lockedLoans, creditPulls)
    return Math.round(animatedNum).toLocaleString();
  };

  // KPI Cards Configuration - 6 cards matching the PDF structure with real data - memoized to prevent re-creation
  const kpiCards = useMemo(() => [
    { 
      id: 'activeLoans', 
      label: 'Active Loans', 
      value: metrics.activeLoans.value, 
      change: metrics.activeLoans.change, 
      trend: metrics.activeLoans.trend,
      color: 'from-sky-50 to-sky-100',
      borderColor: 'border-sky-200',
      iconBg: 'bg-sky-500'
    },
    { 
      id: 'closedLoans', 
      label: 'Closed Loans', 
      value: metrics.closedLoans.value, 
      change: metrics.closedLoans.change, 
      trend: metrics.closedLoans.trend,
      color: 'from-emerald-50 to-emerald-100',
      borderColor: 'border-emerald-200',
      iconBg: 'bg-emerald-500'
    },
    { 
      id: 'lockedLoans', 
      label: 'Locked Loans', 
      value: metrics.lockedLoans.value, 
      change: metrics.lockedLoans.change, 
      trend: metrics.lockedLoans.trend,
      color: 'from-violet-50 to-violet-100',
      borderColor: 'border-violet-200',
      iconBg: 'bg-violet-500'
    },
    { 
      id: 'cycleTime', 
      label: 'Cycle Time', 
      value: metrics.cycleTime.value, 
      change: metrics.cycleTime.change, 
      trend: metrics.cycleTime.trend,
      color: 'from-amber-50 to-amber-100',
      borderColor: 'border-amber-200',
      iconBg: 'bg-amber-500'
    },
    { 
      id: 'pullThrough', 
      label: 'Pull-Through', 
      value: metrics.pullThrough.value, 
      change: metrics.pullThrough.change, 
      trend: metrics.pullThrough.trend,
      color: 'from-rose-50 to-rose-100',
      borderColor: 'border-rose-200',
      iconBg: 'bg-rose-500'
    },
    { 
      id: 'creditPulls', 
      label: 'Credit Pulls', 
      value: metrics.creditPulls.value, 
      change: metrics.creditPulls.change, 
      trend: metrics.creditPulls.trend,
      color: 'from-teal-50 to-teal-100',
      borderColor: 'border-teal-200',
      iconBg: 'bg-teal-500'
    },
  ], [metrics]);

  // Start count-up animation when component mounts or data changes
  useEffect(() => {
    // Don't animate if data is still loading or if values are placeholders
    if (statsLoading || metrics.activeLoans.value === '--') {
      // If loading, set animated values to show placeholders, don't animate
      const placeholderValues: Record<string, number> = {};
      kpiCards.forEach(card => {
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
    kpiCards.forEach(card => {
      const value = parseValue(card.value);
      initialValues[card.id] = isNaN(value) ? 0 : value;
    });
    setAnimatedValues(initialValues);
    
    // If values are already correct, skip animation and just show them
    const allValuesMatch = kpiCards.every(card => {
      const currentValue = parseValue(card.value);
      // Valid if it's a number (including 0) and not a placeholder
      return !isNaN(currentValue) && !card.value.includes('--');
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
      if (isNaN(targetValue) || (targetValue === 0 && card.value.includes('--'))) {
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

          setAnimatedValues(prev => ({
            ...prev,
            [card.id]: currentValue
          }));

          if (progress < 1) {
            requestAnimationFrame(animate);
          } else {
            // Ensure final value is exact
            setAnimatedValues(prev => ({
              ...prev,
              [card.id]: endValue
            }));
          }
        };

        animate();
      }, delay);
    });

    // Mark animation as complete after all cards finish
    const totalDuration = (kpiCards.length * staggerDelay) + animationDuration;
    setTimeout(() => {
      setIsAnimating(false);
    }, totalDuration);
  }, [year, metrics, statsLoading]); // Re-animate when year, metrics, or loading state change (kpiCards removed - it's derived from metrics)

  // Helper function to format business overview values
  const formatBusinessValue = (value: number, type: 'units' | 'volume' | 'rate' | 'balance' | 'fico' | 'ltv' | 'days' | 'percent'): string => {
    if (type === 'units') return value.toLocaleString();
    if (type === 'volume') {
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
      return `$${value.toFixed(0)}`;
    }
    if (type === 'rate') return `${value.toFixed(3)}%`;
    if (type === 'balance') {
      if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
      if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`;
      return `$${value.toFixed(0)}`;
    }
    if (type === 'fico') return value.toFixed(0);
    if (type === 'ltv') return `${value.toFixed(1)}%`;
    if (type === 'days') return `${value.toFixed(0)} days`;
    if (type === 'percent') return `${value.toFixed(1)}%`;
    return value.toString();
  };

  // Calculate business overview data from statsData (same source as cards)
  const calculateBusinessOverviewData = () => {
    // Use statsData as primary source, but fallback to funnelData if statsData is not available
    // This ensures modals show data even if stats API hasn't loaded yet
    const useStatsData = statsData && !statsLoading;
    
    if (!useStatsData && !effectiveFunnelData) {
      return {
        activeLoans: { summary: { units: '--', volume: '--', avgInterestRate: '--', avgBalance: '--', avgFICO: '--', avgLTV: '--' }, byLoanType: [], byLoanPurpose: [], byLoanSize: [], byStage: [] },
        closedLoans: { summary: { units: '--', volume: '--', avgInterestRate: '--', avgBalance: '--', avgFICO: '--', avgLTV: '--' }, byLoanType: [], byLoanPurpose: [], byLoanSize: [] },
        lockedLoans: { summary: { units: '--', volume: '--', avgInterestRate: '--', avgBalance: '--', avgFICO: '--', avgLTV: '--' }, byExpirationDays: [] },
        cycleTime: { avgDaysToFunding: '--', byStage: [], byLoanType: [] },
        pullThrough: { avgPercent: '--', byLoanType: [], falloutBreakdown: [] },
        creditPulls: { byLoanType: [], byLoanPurpose: [] }
      };
    }

    // Use statsData values if available, otherwise use funnelData to match what cards show
    const activeUnits = useStatsData ? (statsData.active || 0) : (effectiveFunnelData?.stillActive?.units || 0);
    const activeVolume = useStatsData ? (statsData.activeVolume || 0) : (effectiveFunnelData?.stillActive?.volume || 0);
    const activeAvgBalance = activeUnits > 0 ? activeVolume / activeUnits : (useStatsData ? (statsData.avgLoanAmount || 0) : 0);

    const closedUnits = useStatsData ? (statsData.closed || 0) : (effectiveFunnelData?.originated?.units || 0);
    const closedVolume = useStatsData ? (statsData.closedVolume || 0) : (effectiveFunnelData?.originated?.volume || 0);
    const closedAvgBalance = closedUnits > 0 ? closedVolume / closedUnits : (useStatsData ? (statsData.avgLoanAmount || 0) : 0);

    const lockedUnits = useStatsData ? (statsData.locked || 0) : Math.round((effectiveFunnelData?.originated?.units || 0) * 1.1 + (effectiveFunnelData?.stillActive?.units || 0) * 0.8);
    const lockedVolume = useStatsData ? (statsData.lockedVolume || 0) : ((effectiveFunnelData?.originated?.volume || 0) + (effectiveFunnelData?.stillActive?.volume || 0));
    const lockedAvgBalance = lockedUnits > 0 ? lockedVolume / lockedUnits : (useStatsData ? (statsData.avgLoanAmount || 0) : 0);

    // Use API values for averages if available, otherwise use defaults
    const avgLoanBalance = useStatsData ? (statsData.avgLoanAmount || 0) : 0;
    const avgInterestRate = useStatsData ? (statsData.avgInterestRate || 6.875) : 6.875; // Fallback to industry average if not available
    const avgFICO = 740; // Industry average (not in API yet)
    const avgLTV = 78.5; // Industry average (not in API yet)

    // Cycle Time - use real data from API if available
    const avgDaysToFunding = useStatsData && statsData.avgCycleTime !== undefined
      ? statsData.avgCycleTime 
      : 24; // Fallback to default
    // Cycle time by stage - estimate based on average cycle time (can be enhanced with stage-specific API endpoint)
    const stageRatios = { 'App to Lock': 0.21, 'Lock to UW': 0.13, 'UW to Approval': 0.29, 'Approval to CTC': 0.17, 'CTC to Closing': 0.20 };
    const cycleTimeByStage = Object.entries(stageRatios).map(([label, ratio]) => {
      const current = Math.round(avgDaysToFunding * ratio);
      const previous = Math.round(current * 1.1); // Estimate 10% improvement
      const change = current - previous;
      return { label, values: [formatBusinessValue(current, 'days'), formatBusinessValue(previous, 'days'), formatBusinessValue(change, 'days')] };
    });

    // Pull-Through calculation - use statsData if available, otherwise calculate from funnel
    const pullThroughPercent = useStatsData && statsData.pullThroughRate !== undefined
      ? statsData.pullThroughRate
      : ((effectiveFunnelData?.loansStarted?.units && effectiveFunnelData.loansStarted.units > 0) 
        ? ((effectiveFunnelData?.originated?.units || 0) / effectiveFunnelData.loansStarted.units * 100) 
        : 0);
    const companyAvg = 75.0;
    const pullThroughStatus = pullThroughPercent >= companyAvg ? 'Above' : 'Below';

    // Calculate breakdowns by loan type from statsData or use defaults
    const loanTypeDistribution: Record<string, number> = {};
    const loanPurposeDistribution: Record<string, number> = {};
    const loanSizeDistribution: Record<string, number> = {};
    
    // Use statsData.byLoanType for accurate distribution if available
    if (useStatsData && statsData.byLoanType) {
      const totalLoans = statsData.total || 1;
      Object.entries(statsData.byLoanType).forEach(([type, data]: [string, any]) => {
        loanTypeDistribution[type] = (data.count || 0) / totalLoans;
      });
    } else {
      // Fallback to industry averages if no data
      loanTypeDistribution['Conventional'] = 0.60;
      loanTypeDistribution['FHA'] = 0.25;
      loanTypeDistribution['VA'] = 0.10;
      loanTypeDistribution['USDA'] = 0.03;
      loanTypeDistribution['Jumbo'] = 0.02;
    }
    
    // Loan purpose and size distributions - would need additional API endpoint
    // For now, use estimates (can be enhanced with metadata queries)
    loanPurposeDistribution['Purchase'] = 0.65;
    loanPurposeDistribution['Refinance'] = 0.35;
    
    loanSizeDistribution['Jumbo'] = 0.15;
    loanSizeDistribution['Conforming Balance'] = 0.85;

    // Active Loans breakdowns - use statsData.byLoanType if available
    const activeByLoanType = useStatsData && statsData.byLoanType 
      ? Object.entries(statsData.byLoanType)
          .filter(([_, data]: [string, any]) => {
            // Filter to only include loan types that have active loans
            const activeLoansOfType = data.loans?.filter((l: any) => {
              const status = l.inferred_status || 'Active'; // Default to Active if not set
              return ['Active', 'Locked'].includes(status);
            }) || [];
            return activeLoansOfType.length > 0;
          })
          .map(([type, data]: [string, any]) => {
            const activeLoansOfType = data.loans?.filter((l: any) => {
              const status = l.inferred_status || 'Active'; // Default to Active if not set
              return ['Active', 'Locked'].includes(status);
            }) || [];
            const units = activeLoansOfType.length;
            const volume = activeLoansOfType.reduce((sum: number, l: any) => sum + parseFloat(l.loan_amount || 0), 0);
            const typeAvgBalance = units > 0 ? volume / units : activeAvgBalance;
            return {
              label: type,
              values: [
                formatBusinessValue(units, 'units'),
                formatBusinessValue(volume, 'volume'),
                formatBusinessValue(avgInterestRate, 'rate'),
                formatBusinessValue(typeAvgBalance, 'balance'),
                formatBusinessValue(avgFICO, 'fico'),
                formatBusinessValue(avgLTV, 'ltv')
              ]
            };
          })
      : Object.entries(loanTypeDistribution).map(([type, pct]) => {
          const units = Math.round(activeUnits * pct);
          const volume = units * activeAvgBalance;
          return {
            label: type,
            values: [
              formatBusinessValue(units, 'units'),
              formatBusinessValue(volume, 'volume'),
              formatBusinessValue(avgInterestRate, 'rate'),
              formatBusinessValue(activeAvgBalance, 'balance'),
              formatBusinessValue(avgFICO, 'fico'),
              formatBusinessValue(avgLTV, 'ltv')
            ]
          };
        });

    const activeByLoanPurpose = Object.entries(loanPurposeDistribution).map(([purpose, pct]) => {
      const units = Math.round(activeUnits * pct);
      const volume = units * activeAvgBalance;
      return {
        label: purpose,
        values: [
          formatBusinessValue(units, 'units'),
          formatBusinessValue(volume, 'volume'),
          formatBusinessValue(avgInterestRate, 'rate'),
          formatBusinessValue(activeAvgBalance, 'balance'),
          formatBusinessValue(avgFICO, 'fico'),
          formatBusinessValue(avgLTV, 'ltv')
        ]
      };
    });

    const activeByLoanSize = Object.entries(loanSizeDistribution).map(([size, pct]) => {
      const units = Math.round(activeUnits * pct);
      const volume = units * activeAvgBalance;
      return {
        label: size,
        values: [
          formatBusinessValue(units, 'units'),
          formatBusinessValue(volume, 'volume'),
          formatBusinessValue(avgInterestRate, 'rate'),
          formatBusinessValue(activeAvgBalance, 'balance'),
          formatBusinessValue(avgFICO, 'fico'),
          formatBusinessValue(avgLTV, 'ltv')
        ]
      };
    });

    // Active by stage (estimate distribution)
    const stageDistribution = {
      'Locked': 0.40,
      'Submitted to UW': 0.30,
      'Approved': 0.20,
      'CTC': 0.10
    };

    const activeByStage = Object.entries(stageDistribution).map(([stage, pct]) => {
      const units = Math.round(activeUnits * pct);
      const volume = units * activeAvgBalance;
      return {
        label: stage,
        values: [
          formatBusinessValue(units, 'units'),
          formatBusinessValue(volume, 'volume'),
          formatBusinessValue(avgInterestRate, 'rate'),
          formatBusinessValue(activeAvgBalance, 'balance'),
          formatBusinessValue(avgFICO, 'fico'),
          formatBusinessValue(avgLTV, 'ltv')
        ]
      };
    });

    // Closed Loans breakdowns - use statsData.byLoanType if available
    const closedByLoanType = useStatsData && statsData.byLoanType
      ? Object.entries(statsData.byLoanType)
          .filter(([_, data]: [string, any]) => {
            // Filter to only include loan types that have closed loans
            const closedLoansOfType = data.loans?.filter((l: any) => {
              const status = l.inferred_status || 'Active'; // Default to Active if not set
              return status === 'Closed';
            }) || [];
            return closedLoansOfType.length > 0;
          })
          .map(([type, data]: [string, any]) => {
            const closedLoansOfType = data.loans?.filter((l: any) => {
              const status = l.inferred_status || 'Active'; // Default to Active if not set
              return status === 'Closed';
            }) || [];
            const units = closedLoansOfType.length;
            const volume = closedLoansOfType.reduce((sum: number, l: any) => sum + parseFloat(l.loan_amount || 0), 0);
            const typeAvgBalance = units > 0 ? volume / units : closedAvgBalance;
            return {
              label: type,
              values: [
                formatBusinessValue(units, 'units'),
                formatBusinessValue(volume, 'volume'),
                formatBusinessValue(avgInterestRate, 'rate'),
                formatBusinessValue(typeAvgBalance, 'balance'),
                formatBusinessValue(avgFICO, 'fico'),
                formatBusinessValue(avgLTV, 'ltv')
              ]
            };
          })
      : Object.entries(loanTypeDistribution).map(([type, pct]) => {
          const units = Math.round(closedUnits * pct);
          const volume = units * closedAvgBalance;
          return {
            label: type,
            values: [
              formatBusinessValue(units, 'units'),
              formatBusinessValue(volume, 'volume'),
              formatBusinessValue(avgInterestRate, 'rate'),
              formatBusinessValue(closedAvgBalance, 'balance'),
              formatBusinessValue(avgFICO, 'fico'),
              formatBusinessValue(avgLTV, 'ltv')
            ]
          };
        });

    const closedByLoanPurpose = Object.entries(loanPurposeDistribution).map(([purpose, pct]) => {
      const units = Math.round(closedUnits * pct);
      const volume = units * closedAvgBalance;
      return {
        label: purpose,
        values: [
          formatBusinessValue(units, 'units'),
          formatBusinessValue(volume, 'volume'),
          formatBusinessValue(avgInterestRate, 'rate'),
          formatBusinessValue(closedAvgBalance, 'balance'),
          formatBusinessValue(avgFICO, 'fico'),
          formatBusinessValue(avgLTV, 'ltv')
        ]
      };
    });

    const closedByLoanSize = Object.entries(loanSizeDistribution).map(([size, pct]) => {
      const units = Math.round(closedUnits * pct);
      const volume = units * closedAvgBalance;
      return {
        label: size,
        values: [
          formatBusinessValue(units, 'units'),
          formatBusinessValue(volume, 'volume'),
          formatBusinessValue(avgInterestRate, 'rate'),
          formatBusinessValue(closedAvgBalance, 'balance'),
          formatBusinessValue(avgFICO, 'fico'),
          formatBusinessValue(avgLTV, 'ltv')
        ]
      };
    });

    // Locked Loans by expiration days
    const expirationDistribution = {
      '> 30 days': 0.35,
      '15-29 days': 0.30,
      '10-14 days': 0.20,
      '< 9 days': 0.10,
      'Expired': 0.05
    };

    const lockedByExpirationDays = Object.entries(expirationDistribution).map(([days, pct]) => {
      const units = Math.round(lockedUnits * pct);
      const volume = units * lockedAvgBalance;
      return {
        label: days,
        values: [
          formatBusinessValue(units, 'units'),
          formatBusinessValue(volume, 'volume'),
          formatBusinessValue(avgInterestRate, 'rate'),
          formatBusinessValue(lockedAvgBalance, 'balance'),
          formatBusinessValue(avgFICO, 'fico'),
          formatBusinessValue(avgLTV, 'ltv')
        ]
      };
    });

    // Cycle Time by loan type
    const cycleTimeByLoanType = Object.keys(loanTypeDistribution).map((type) => {
      const baseDays = avgDaysToFunding;
      const variance = type === 'FHA' ? 2 : type === 'VA' ? 1 : type === 'Jumbo' ? -1 : 0;
      const days = baseDays + variance;
      return {
        label: type,
        values: [formatBusinessValue(days, 'days'), days >= avgDaysToFunding ? '↑' : '↓', days <= avgDaysToFunding ? 'On Track' : 'Delayed']
      };
    });

    // Pull-Through by loan type
    const pullThroughByLoanType = Object.keys(loanTypeDistribution).map((type) => {
      const variance = type === 'Conventional' ? 5 : type === 'FHA' ? -3 : type === 'VA' ? 2 : type === 'Jumbo' ? 8 : 0;
      const pct = pullThroughPercent + variance;
      return {
        label: type,
        values: [formatBusinessValue(pct, 'percent'), formatBusinessValue(companyAvg, 'percent'), pct >= companyAvg ? 'Above' : 'Below']
      };
    });

    // Fallout breakdown - calculate from statsData.byStatus if available, otherwise use funnel data
    let withdrawnUnits = useStatsData && statsData.byStatus
      ? 0
      : (effectiveFunnelData?.falloutWithdrawn?.units || 0);
    let deniedUnits = useStatsData && statsData.byStatus
      ? 0
      : (effectiveFunnelData?.falloutDenied?.units || 0);
    
    if (useStatsData && statsData.byStatus) {
      Object.entries(statsData.byStatus).forEach(([status, data]: [string, any]) => {
        const statusUpper = status.toUpperCase();
        if (['WITHDRAWN', 'CANCELLED'].includes(statusUpper)) {
          withdrawnUnits += data.count || 0;
        } else if (['DENIED', 'DECLINED', 'REJECTED'].includes(statusUpper)) {
          deniedUnits += data.count || 0;
        }
      });
    }
    const totalFallout = withdrawnUnits + deniedUnits;
    const withdrawnPct = totalFallout > 0 ? (withdrawnUnits / totalFallout * 100) : 0;
    const deniedPct = totalFallout > 0 ? (deniedUnits / totalFallout * 100) : 0;

    const falloutBreakdown = [
      {
        label: 'Withdrawn',
        values: [formatBusinessValue(withdrawnPct, 'percent'), formatBusinessValue(companyAvg, 'percent'), withdrawnPct <= companyAvg ? 'Below Avg' : 'Above Avg']
      },
      {
        label: 'Denied',
        values: [formatBusinessValue(deniedPct, 'percent'), formatBusinessValue(companyAvg, 'percent'), deniedPct <= companyAvg ? 'Below Avg' : 'Above Avg']
      }
    ];

    // Credit Pulls - use statsData if available, otherwise use funnel data
    const creditPullsTotal = useStatsData 
      ? (statsData.creditPulls || statsData.total || 0)
      : (effectiveFunnelData?.loansStarted?.units || 0);
    const creditPullsByLoanType = useStatsData && statsData.byLoanType
      ? Object.entries(statsData.byLoanType).map(([type, data]: [string, any]) => {
          const mtd = data.count || 0;
          const lastMonth = Math.round(mtd * 0.92); // Estimate 8% growth (could be enhanced with historical data)
          return {
            label: type,
            values: [formatBusinessValue(mtd, 'units'), formatBusinessValue(lastMonth, 'units')]
          };
        })
      : Object.entries(loanTypeDistribution).map(([type, pct]) => {
          const mtd = Math.round(creditPullsTotal * pct);
          const lastMonth = Math.round(mtd * 0.92);
          return {
            label: type,
            values: [formatBusinessValue(mtd, 'units'), formatBusinessValue(lastMonth, 'units')]
          };
        });

    const creditPullsByLoanPurpose = Object.entries(loanPurposeDistribution).map(([purpose, pct]) => {
      const mtd = Math.round(creditPullsTotal * pct);
      const lastMonth = Math.round(mtd * 0.92);
      return {
        label: purpose,
        values: [formatBusinessValue(mtd, 'units'), formatBusinessValue(lastMonth, 'units')]
      };
    });

    return {
      activeLoans: {
        summary: {
          units: formatBusinessValue(activeUnits, 'units'),
          volume: formatBusinessValue(activeVolume || (activeUnits * activeAvgBalance), 'volume'),
          avgInterestRate: formatBusinessValue(avgInterestRate, 'rate'),
          avgBalance: formatBusinessValue(activeAvgBalance, 'balance'),
          avgFICO: formatBusinessValue(avgFICO, 'fico'),
          avgLTV: formatBusinessValue(avgLTV, 'ltv')
        },
        byLoanType: activeByLoanType,
        byLoanPurpose: activeByLoanPurpose,
        byLoanSize: activeByLoanSize,
        byStage: activeByStage
      },
      closedLoans: {
        summary: {
          units: formatBusinessValue(closedUnits, 'units'),
          volume: formatBusinessValue(closedVolume, 'volume'),
          avgInterestRate: formatBusinessValue(avgInterestRate, 'rate'),
          avgBalance: formatBusinessValue(closedAvgBalance, 'balance'),
          avgFICO: formatBusinessValue(avgFICO, 'fico'),
          avgLTV: formatBusinessValue(avgLTV, 'ltv')
        },
        byLoanType: closedByLoanType,
        byLoanPurpose: closedByLoanPurpose,
        byLoanSize: closedByLoanSize
      },
      lockedLoans: {
        summary: {
          units: formatBusinessValue(lockedUnits, 'units'),
          volume: formatBusinessValue(lockedVolume, 'volume'),
          avgInterestRate: formatBusinessValue(avgInterestRate, 'rate'),
          avgBalance: formatBusinessValue(lockedAvgBalance, 'balance'),
          avgFICO: formatBusinessValue(avgFICO, 'fico'),
          avgLTV: formatBusinessValue(avgLTV, 'ltv')
        },
        byExpirationDays: lockedByExpirationDays
      },
      cycleTime: {
        avgDaysToFunding: formatBusinessValue(avgDaysToFunding, 'days'),
        byStage: cycleTimeByStage,
        byLoanType: cycleTimeByLoanType
      },
      pullThrough: {
        avgPercent: formatBusinessValue(pullThroughPercent, 'percent'),
        byLoanType: pullThroughByLoanType,
        falloutBreakdown: falloutBreakdown
      },
      creditPulls: {
        byLoanType: creditPullsByLoanType,
        byLoanPurpose: creditPullsByLoanPurpose
      }
    };
  };

  const businessOverviewData = calculateBusinessOverviewData();

  const metricsHeaders = ['Units', '$ Volume', 'Avg Rate', 'Avg Bal', 'FICO', 'LTV'];
  const cycleTimeHeaders = ['Avg Days', 'Target', 'Variance'];
  const cycleTypeHeaders = ['Avg Days', 'Trend', 'Status'];
  const pullThroughHeaders = ['Value', 'Co. Avg', 'Status'];
  const creditPullHeaders = ['MTD', 'Last Mo.'];

  // Get modal content based on selected card
  const getModalContent = (cardId: string) => {
    switch (cardId) {
      case 'activeLoans':
        return {
          title: 'Active Loans',
          subtitle: 'Currently in pipeline',
          color: 'bg-sky-50',
          borderColor: 'border-sky-200',
          accentColor: 'text-sky-600',
          sections: [
            { title: 'Summary', headers: metricsHeaders, summaryData: businessOverviewData.activeLoans.summary },
            { title: 'By Loan Type', headers: metricsHeaders, rows: businessOverviewData.activeLoans.byLoanType },
            { title: 'By Loan Purpose', headers: metricsHeaders, rows: businessOverviewData.activeLoans.byLoanPurpose },
            { title: 'By Loan Size', headers: metricsHeaders, rows: businessOverviewData.activeLoans.byLoanSize },
            { title: 'By Stage', headers: metricsHeaders, rows: businessOverviewData.activeLoans.byStage },
          ]
        };
      case 'closedLoans':
        return {
          title: 'Closed Loans',
          subtitle: 'Successfully funded',
          color: 'bg-emerald-50',
          borderColor: 'border-emerald-200',
          accentColor: 'text-emerald-600',
          sections: [
            { title: 'Summary', headers: metricsHeaders, summaryData: businessOverviewData.closedLoans.summary },
            { title: 'By Loan Type', headers: metricsHeaders, rows: businessOverviewData.closedLoans.byLoanType },
            { title: 'By Loan Purpose', headers: metricsHeaders, rows: businessOverviewData.closedLoans.byLoanPurpose },
            { title: 'By Loan Size', headers: metricsHeaders, rows: businessOverviewData.closedLoans.byLoanSize },
          ]
        };
      case 'lockedLoans':
        return {
          title: 'Locked Loans',
          subtitle: 'Rate locks in progress',
          color: 'bg-violet-50',
          borderColor: 'border-violet-200',
          accentColor: 'text-violet-600',
          sections: [
            { title: 'Summary', headers: metricsHeaders, summaryData: businessOverviewData.lockedLoans.summary },
            { title: 'By Expiration Days', headers: metricsHeaders, rows: businessOverviewData.lockedLoans.byExpirationDays },
          ]
        };
      case 'cycleTime':
        return {
          title: 'Cycle Time Analysis',
          subtitle: `Avg: ${businessOverviewData.cycleTime.avgDaysToFunding} days to funding`,
          color: 'bg-amber-50',
          borderColor: 'border-amber-200',
          accentColor: 'text-amber-600',
          sections: [
            { title: 'Time By Stage', headers: cycleTimeHeaders, rows: businessOverviewData.cycleTime.byStage },
            { title: 'By Loan Type', headers: cycleTypeHeaders, rows: businessOverviewData.cycleTime.byLoanType },
          ]
        };
      case 'pullThrough':
        return {
          title: 'Pull-Through',
          subtitle: `Avg: ${businessOverviewData.pullThrough.avgPercent}%`,
          color: 'bg-rose-50',
          borderColor: 'border-rose-200',
          accentColor: 'text-rose-600',
          sections: [
            { title: 'By Loan Type', headers: pullThroughHeaders, rows: businessOverviewData.pullThrough.byLoanType },
            { title: 'Fallout Breakdown', headers: pullThroughHeaders, rows: businessOverviewData.pullThrough.falloutBreakdown },
          ]
        };
      case 'creditPulls':
        return {
          title: 'Credit Pulls',
          subtitle: 'MTD vs Last Month',
          color: 'bg-teal-50',
          borderColor: 'border-teal-200',
          accentColor: 'text-teal-600',
          sections: [
            { title: 'By Loan Type', headers: creditPullHeaders, rows: businessOverviewData.creditPulls.byLoanType },
            { title: 'By Loan Purpose', headers: creditPullHeaders, rows: businessOverviewData.creditPulls.byLoanPurpose },
          ]
        };
      default:
        return null;
    }
  };

  return (
    <div className="mb-8">
      {/* Business Overview Card */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-white dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800 shadow-[0_1px_3px_rgba(0,0,0,0.04)] p-4 sm:p-6 md:p-8">
        {/* Section Header - Matching Ailethia Dialogues */}
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
              <p className="text-[10px] sm:text-sm text-slate-600 dark:text-slate-300 font-light truncate">Key performance metrics at a glance</p>
            </div>
          </div>
        </div>

        {/* KPI Cards Grid - 6 cards in a row */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          {kpiCards.map((card) => (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              onClick={() => setSelectedCard(card.id)}
              className={`bg-white dark:bg-slate-800/50 rounded-xl border ${card.borderColor} dark:border-slate-700 p-4 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(0,0,0,0.3)] hover:scale-[1.02] transition-all duration-200 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)] text-center`}
            >
              <div className="flex items-center justify-center mb-2 gap-2">
                <span className="text-[10px] sm:text-xs font-medium text-slate-600 dark:text-slate-400 uppercase tracking-wide">
                  {card.label}
                </span>
                <span className={`inline-flex items-center gap-0.5 text-[10px] sm:text-xs font-medium ${card.trend === 'up' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {card.trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  {card.change}
                </span>
              </div>
              <div className="text-xl sm:text-2xl font-semibold text-slate-900 dark:text-white tracking-tight">
                {isAnimating && animatedValues[card.id] !== undefined
                  ? formatAnimatedValue(card.id, animatedValues[card.id], card.value)
                  : (animatedValues[card.id] !== undefined 
                      ? formatAnimatedValue(card.id, animatedValues[card.id], card.value)
                      : card.value)}
              </div>
              <p className="text-[9px] sm:text-[10px] text-slate-500 dark:text-slate-400 mt-2 text-center">Click for details</p>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Modal for Card Details */}
      <AnimatePresence>
        {selectedCard && (() => {
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
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
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
                  <X className="w-4 h-4 sm:w-4 sm:h-4 md:w-4 md:h-4 text-slate-500 dark:text-slate-400" strokeWidth={1.5} />
                </button>

                {/* Modal Header - Mobile First */}
                <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-3 md:py-4 pr-16 sm:pr-16 md:pr-16 border-b border-slate-200 dark:border-slate-700 flex items-center flex-shrink-0 bg-slate-50 dark:bg-slate-800/50 relative sticky top-0 backdrop-blur-sm">
                  <div className="min-w-0 flex-1">
                    <h2 className={`text-base sm:text-base md:text-lg lg:text-xl font-semibold ${modalContent.accentColor} truncate`}>{modalContent.title}</h2>
                    <p className="text-[10px] sm:text-[10px] md:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">{modalContent.subtitle}</p>
                  </div>
                </div>

                {/* Modal Content - Mobile First */}
                <div className="px-3 sm:px-4 md:px-6 py-3 sm:py-4 md:py-6 overflow-y-auto space-y-3 sm:space-y-4 md:space-y-6 flex-1 min-h-0">
                  {modalContent.sections.map((section, idx) => (
                    <div key={idx} className="w-full">
                      <h3 className="text-[10px] sm:text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2 sm:mb-3 uppercase tracking-wider">{section.title}</h3>
                      
                      {/* Summary Row (if exists) - Mobile First */}
                      {section.summaryData && (
                        <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-6 gap-1.5 sm:gap-1.5 md:gap-2 mb-3 sm:mb-4 w-full">
                          {section.headers.map((header, i) => (
                            <div key={i} className="text-center p-1.5 sm:p-1.5 md:p-2 bg-slate-50 dark:bg-slate-800/40 rounded-md sm:rounded-lg border border-slate-200 dark:border-slate-700 min-w-0 overflow-hidden">
                              <p className="text-[8px] sm:text-[8px] md:text-[9px] text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1 sm:mb-1 leading-tight break-words line-clamp-2">{header}</p>
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
                          <BusinessDataTable headers={section.headers} rows={section.rows} />
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
};

