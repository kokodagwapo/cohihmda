/**
 * Dashboard helper utilities
 * Extracted from Dashboard.tsx for better organization
 */

/**
 * Get urgency color classes based on urgency level
 */
export const getUrgencyColor = (urgency: string): string => {
  switch (urgency) {
    case 'critical':
      return 'border-l-red-500 bg-red-50/50 dark:bg-red-950/20';
    case 'high':
      return 'border-l-orange-500 bg-orange-50/50 dark:bg-orange-950/20';
    case 'medium':
      return 'border-l-yellow-500 bg-yellow-50/50 dark:bg-yellow-950/20';
    case 'low':
      return 'border-l-blue-500 bg-blue-50/50 dark:bg-blue-950/20';
    default:
      return 'border-l-gray-500 bg-gray-50/50 dark:bg-gray-950/20';
  }
};

/**
 * Get urgency dot color class based on urgency level
 */
export const getUrgencyDot = (urgency: string): string => {
  switch (urgency) {
    case 'critical':
      return 'bg-red-500';
    case 'high':
      return 'bg-orange-500';
    case 'medium':
      return 'bg-yellow-500';
    case 'low':
      return 'bg-blue-500';
    default:
      return 'bg-gray-500';
  }
};

/**
 * Generate animated value that fluctuates realistically
 * Used for dashboard animations
 */
export const getAnimatedValue = (
  realValue: number,
  animationCycle: number,
  isAnimating: boolean,
  baseVariation: number = 0.15
): number => {
  if (!isAnimating) return realValue;

  // Create smooth oscillation with some randomness
  const time = animationCycle * 100; // milliseconds
  const oscillation = Math.sin(time / 500) * 0.1; // Slow wave
  const randomVariation = (Math.random() - 0.5) * baseVariation;
  const variation = oscillation + randomVariation;

  // Ensure we don't go below 0 or above real value (adjusted for 5 second cycle)
  const animated = realValue * (0.7 + variation + 0.2 * (animationCycle / 5));
  return Math.max(0, Math.min(realValue, Math.floor(animated)));
};

/**
 * Smooth progress for gradual transitions
 * Returns a value between 0 and 1 based on animation cycle
 */
export const getSmoothProgress = (animationCycle: number, isAnimating: boolean): number => {
  if (!isAnimating) return 1;
  // Ease in/out curve for smooth animation (5 second duration)
  const progress = animationCycle / 5;
  return progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
};

/**
 * Get filter-based KPI values for reports
 * Returns KPI data filtered by date range (today, mtd, ytd, custom)
 */
export const getFilteredKPI = (
  reportId: string,
  kpiIndex: number,
  originalKPI: any,
  dateFilter: string
): any => {
  const filterData: Record<string, Record<number, any>> = {
    '1': {
      // Daily Production Pulse
      0: {
        // Loans Locked
        today: { value: 47, change: '+12%' },
        mtd: { value: 1247, change: '+8%' },
        ytd: { value: 15420, change: '+18%' },
        custom: originalKPI
      },
      1: {
        // Loans Submitted
        today: { value: 52, change: '+8%' },
        mtd: { value: 1382, change: '+6%' },
        ytd: { value: 17180, change: '+15%' },
        custom: originalKPI
      },
      2: {
        // Loans Approved
        today: { value: 45, change: '+5%' },
        mtd: { value: 1205, change: '+4%' },
        ytd: { value: 14950, change: '+12%' },
        custom: originalKPI
      }
    },
    '2': {
      // Fallout & Risk
      0: {
        // Withdrawals
        today: { value: 8, change: '+15%' },
        mtd: { value: 212, change: '+12%' },
        ytd: { value: 2630, change: '+8%' },
        custom: originalKPI
      },
      1: {
        // Declinations
        today: { value: 5, change: '-8%' },
        mtd: { value: 132, change: '-5%' },
        ytd: { value: 1640, change: '-3%' },
        custom: originalKPI
      },
      2: {
        // Aging Loans
        today: { value: 23, change: '+12%' },
        mtd: { value: 610, change: '+8%' },
        ytd: { value: 7560, change: '+5%' },
        custom: originalKPI
      }
    },
    '3': {
      // LO Performance
      0: {
        // Top Tier Revenue
        today: { value: '$142K', change: '+8%' },
        mtd: { value: '$3.82M', change: '+12%' },
        ytd: { value: '$47.5M', change: '+18%' },
        custom: originalKPI
      },
      1: {
        // Top Performers
        today: { value: 18, change: '+2' },
        mtd: { value: 485, change: '+12' },
        ytd: { value: 6020, change: '+156' },
        custom: originalKPI
      },
      2: {
        // Need Coaching
        today: { value: 3, change: '-1' },
        mtd: { value: 81, change: '-5' },
        ytd: { value: 1005, change: '-12' },
        custom: originalKPI
      }
    },
    '4': {
      // Operations Efficiency
      0: {
        // Avg Cycle Time
        today: { value: '28d', change: '-0.5d' },
        mtd: { value: '28.2d', change: '-1.2d' },
        ytd: { value: '28.5d', change: '-3.4d' },
        custom: originalKPI
      },
      1: {
        // Processing Time
        today: { value: '12h', change: '-0.5h' },
        mtd: { value: '12.2h', change: '-1.0h' },
        ytd: { value: '12.8h', change: '-2.2h' },
        custom: originalKPI
      },
      2: {
        // Efficiency Score
        today: { value: '87%', change: '+2%' },
        mtd: { value: '85%', change: '+4%' },
        ytd: { value: '82%', change: '+12%' },
        custom: originalKPI
      }
    },
    '5': {
      // Rate Competitiveness
      0: {
        // Avg Rate
        today: { value: '6.75%', change: '-0.05%' },
        mtd: { value: '6.78%', change: '-0.12%' },
        ytd: { value: '6.82%', change: '-0.28%' },
        custom: originalKPI
      },
      1: {
        // Market Position
        today: { value: 'Top 15%', change: '+2%' },
        mtd: { value: 'Top 18%', change: '+3%' },
        ytd: { value: 'Top 22%', change: '+5%' },
        custom: originalKPI
      },
      2: {
        // Win Rate
        today: { value: '68%', change: '+3%' },
        mtd: { value: '65%', change: '+5%' },
        ytd: { value: '62%', change: '+8%' },
        custom: originalKPI
      }
    },
    '6': {
      // Profitability Analysis
      0: {
        // Net Margin
        today: { value: '4.2%', change: '+0.3%' },
        mtd: { value: '4.0%', change: '+0.5%' },
        ytd: { value: '3.8%', change: '+0.8%' },
        custom: originalKPI
      },
      1: {
        // Revenue
        today: { value: '$2.4M', change: '+8%' },
        mtd: { value: '$64.8M', change: '+12%' },
        ytd: { value: '$805M', change: '+18%' },
        custom: originalKPI
      },
      2: {
        // Profit
        today: { value: '$101K', change: '+12%' },
        mtd: { value: '$2.59M', change: '+18%' },
        ytd: { value: '$30.6M', change: '+25%' },
        custom: originalKPI
      }
    }
  };
  
  const reportData = filterData[reportId]?.[kpiIndex];
  if (!reportData) return originalKPI;
  const filtered = reportData[dateFilter];
  if (!filtered) return originalKPI;
  return {
    ...originalKPI,
    value: filtered.value,
    change: filtered.change
  };
};

