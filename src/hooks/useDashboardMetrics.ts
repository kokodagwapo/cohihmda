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
    // Today's revenue (sum of top performers' revenue / 10 as estimate)
    const allPerformersData = [...realTopPerformers, ...realMiddlePerformers, ...realBottomPerformers];
    const todayRevenue = allPerformersData.slice(0, 10).reduce((sum, p) => sum + p.revenue, 0) / 10;
    const yesterdayRevenue = todayRevenue * 0.85; // Simulated
    const revenueChange = (todayRevenue - yesterdayRevenue) / yesterdayRevenue * 100;

    // Month-to-date calculations
    const monthTarget = 50000000; // $50M target
    const monthToDate = todayRevenue * 20; // Rough estimate
    const monthProgress = monthToDate / monthTarget * 100;
    const lastMonthTotal = monthToDate * 0.97; // Simulated
    const monthChange = (monthToDate - lastMonthTotal) / lastMonthTotal * 100;

    // Loans closed today
    const loansClosedToday = allPerformersData.slice(0, 10).reduce((sum, p) => sum + p.loans, 0) / 5;

    // Critical alerts
    const criticalAlerts = managementWarnings.filter(w => w.urgency === 'critical').length;
    const highPriorityAlerts = managementWarnings.filter(w => w.urgency === 'high').length;
    
    return {
      todayRevenue,
      revenueChange,
      monthToDate,
      monthProgress,
      monthChange,
      loansClosedToday,
      criticalAlerts,
      highPriorityAlerts
    };
  }, [realTopPerformers, realMiddlePerformers, realBottomPerformers, managementWarnings]);

  // Calculate Financial Health metrics (using topPerformers and commandMetrics)
  const financialHealth = useMemo((): FinancialHealth => {
    const avgRevenuePerLoan = topPerformers.reduce((sum, p) => sum + p.revenue / Math.max(p.loans, 1), 0) / topPerformers.length;
    const avgCostPerLoan = avgRevenuePerLoan * 0.97; // 97% of revenue = cost
    const netMargin = (avgRevenuePerLoan - avgCostPerLoan) / avgRevenuePerLoan * 100;
    const monthEndRevenue = commandMetrics.monthToDate * 1.08; // Projected
    const monthEndProfit = monthEndRevenue * (netMargin / 100);
    
    return {
      netMargin,
      revenuePerLoan: avgRevenuePerLoan,
      costPerLoan: avgCostPerLoan,
      monthEndRevenue,
      monthEndProfit
    };
  }, [topPerformers, commandMetrics]);

  // Calculate Operational Health metrics (using cycleTimeData and pullThroughData)
  const operationalHealth = useMemo((): OperationalHealth => {
    const avgCycleTime = cycleTimeData.reduce((sum, d) => sum + d.avgDays, 0) / cycleTimeData.length;
    const targetCycleTime = cycleTimeData.reduce((sum, d) => sum + d.targetDays, 0) / cycleTimeData.length;
    const pullThroughRate = pullThroughData.find(d => d.stage === 'Funded')?.percentage || 52;
    const industryPullThrough = 72; // Industry benchmark
    const bottleneck = cycleTimeData.reduce((max, d) => d.avgDays / d.targetDays > max.avgDays / max.targetDays ? d : max);
    
    return {
      avgCycleTime,
      targetCycleTime,
      pullThroughRate,
      industryPullThrough,
      bottleneck
    };
  }, [cycleTimeData, pullThroughData]);

  return {
    commandMetrics,
    financialHealth,
    operationalHealth
  };
};

