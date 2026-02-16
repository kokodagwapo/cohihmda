/**
 * Hook for calculating dashboard metrics
 * Extracted from Dashboard.tsx for better organization
 */

import { useMemo } from 'react';

interface CommandCenterMetrics {
  todayRevenue: number;
  revenueChange: number;
  monthToDate: number;
  monthProgress: number;
  monthChange: number;
  loansClosedToday: number;
  criticalAlerts: number;
  highPriorityAlerts: number;
}

interface FinancialHealth {
  netMargin: number;
  revenuePerLoan: number;
  costPerLoan: number;
  monthEndRevenue: number;
  monthEndProfit: number;
}

interface OperationalHealth {
  avgCycleTime: number;
  targetCycleTime: number;
  pullThroughRate: number;
  industryPullThrough: number;
  bottleneck: any;
}

interface UseDashboardMetricsParams {
  realTopPerformers: any[];
  realMiddlePerformers: any[];
  realBottomPerformers: any[];
  topPerformers: any[];
  cycleTimeData: any[];
  pullThroughData: any[];
  managementWarnings: any[];
}

export const useDashboardMetrics = ({
  realTopPerformers,
  realMiddlePerformers,
  realBottomPerformers,
  topPerformers,
  cycleTimeData,
  pullThroughData,
  managementWarnings
}: UseDashboardMetricsParams) => {
  // Calculate key metrics for Command Center (using raw data)
  const commandMetrics = useMemo((): CommandCenterMetrics => {
    const allPerformersData = [...realTopPerformers, ...realMiddlePerformers, ...realBottomPerformers];
    
    if (allPerformersData.length === 0) {
      const criticalAlerts = managementWarnings.filter(w => w.urgency === 'critical').length;
      const highPriorityAlerts = managementWarnings.filter(w => w.urgency === 'high').length;
      return { todayRevenue: 0, revenueChange: 0, monthToDate: 0, monthProgress: 0, monthChange: 0, loansClosedToday: 0, criticalAlerts, highPriorityAlerts };
    }

    const todayRevenue = allPerformersData.slice(0, 10).reduce((sum, p) => sum + (p.revenue || 0), 0) / 10;
    const yesterdayRevenue = todayRevenue * 0.85;
    const revenueChange = yesterdayRevenue > 0 ? (todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100 : 0;

    const monthTarget = 50000000;
    const monthToDate = todayRevenue * 20;
    const monthProgress = monthTarget > 0 ? monthToDate / monthTarget * 100 : 0;
    const lastMonthTotal = monthToDate * 0.97;
    const monthChange = lastMonthTotal > 0 ? (monthToDate - lastMonthTotal) / lastMonthTotal * 100 : 0;

    const loansClosedToday = allPerformersData.slice(0, 10).reduce((sum, p) => sum + (p.loans || 0), 0) / 5;
    const criticalAlerts = managementWarnings.filter(w => w.urgency === 'critical').length;
    const highPriorityAlerts = managementWarnings.filter(w => w.urgency === 'high').length;
    
    return { todayRevenue, revenueChange, monthToDate, monthProgress, monthChange, loansClosedToday, criticalAlerts, highPriorityAlerts };
  }, [realTopPerformers, realMiddlePerformers, realBottomPerformers, managementWarnings]);

  // Calculate Financial Health metrics (using topPerformers and commandMetrics)
  const financialHealth = useMemo((): FinancialHealth => {
    if (topPerformers.length === 0) {
      return { netMargin: 0, revenuePerLoan: 0, costPerLoan: 0, monthEndRevenue: 0, monthEndProfit: 0 };
    }
    const avgRevenuePerLoan = topPerformers.reduce((sum, p) => sum + (p.revenue || 0) / Math.max(p.loans, 1), 0) / topPerformers.length;
    const avgCostPerLoan = avgRevenuePerLoan * 0.97;
    const netMargin = avgRevenuePerLoan > 0 ? (avgRevenuePerLoan - avgCostPerLoan) / avgRevenuePerLoan * 100 : 0;
    const monthEndRevenue = commandMetrics.monthToDate * 1.08;
    const monthEndProfit = monthEndRevenue * (netMargin / 100);
    
    return { netMargin, revenuePerLoan: avgRevenuePerLoan, costPerLoan: avgCostPerLoan, monthEndRevenue, monthEndProfit };
  }, [topPerformers, commandMetrics]);

  // Calculate Operational Health metrics (using cycleTimeData and pullThroughData)
  const operationalHealth = useMemo((): OperationalHealth => {
    if (cycleTimeData.length === 0) {
      return { avgCycleTime: 0, targetCycleTime: 0, pullThroughRate: 0, industryPullThrough: 72, bottleneck: null };
    }
    const avgCycleTime = cycleTimeData.reduce((sum, d) => sum + d.avgDays, 0) / cycleTimeData.length;
    const targetCycleTime = cycleTimeData.reduce((sum, d) => sum + d.targetDays, 0) / cycleTimeData.length;
    const pullThroughRate = pullThroughData.find(d => d.stage === 'Funded')?.percentage || 0;
    const industryPullThrough = 72;
    const bottleneck = cycleTimeData.length > 0 
      ? cycleTimeData.reduce((max, d) => (d.avgDays / d.targetDays > max.avgDays / max.targetDays ? d : max))
      : null;
    
    return { avgCycleTime, targetCycleTime, pullThroughRate, industryPullThrough, bottleneck };
  }, [cycleTimeData, pullThroughData]);

  return {
    commandMetrics,
    financialHealth,
    operationalHealth
  };
};

