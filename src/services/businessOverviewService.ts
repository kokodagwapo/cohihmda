import { BusinessOverviewData } from '@/types/businessOverview';
import { api } from '@/lib/api';

/**
 * Get business overview data from API
 * Uses real imported data from the database
 */
export async function getBusinessOverviewData(dateFilter: 'today' | 'mtd' | 'ytd' | 'custom' = 'mtd'): Promise<BusinessOverviewData> {
  try {
    // Get comprehensive stats from API using the dateFilter parameter
    // Convert 'custom' to 'all' to show all imported data
    const filterParam = dateFilter === 'custom' ? 'all' : dateFilter;
    const url = `/api/loans/stats?dateFilter=${filterParam}`;
    
    const stats = await api.request<{
      total: number;
      active: number;
      closed: number;
      locked: number;
      byLoanType: Record<string, { count: number; volume: number; loans: any[] }>;
      byStatus: Record<string, { count: number; volume: number }>;
      avgLoanAmount: number;
      avgInterestRate: number;
      totalVolume: number;
      avgCycleTime: number;
      pullThroughRate: number;
      creditPulls: number;
      activeVolume: number;
      closedVolume: number;
      lockedVolume: number;
    }>(url);

    // If we have stats data (even if total is 0), transform it to BusinessOverviewData format
    // This ensures we show real imported data, even if it's zeros
    if (stats && typeof stats.total === 'number') {
      return transformStatsToBusinessOverviewData(stats);
    }
  } catch (error: any) {
    console.error('[BusinessOverview] Failed to fetch business overview from API:', error);
  }

  // Return empty data structure when API fails or returns invalid data
  return getEmptyData();
}

/**
 * Transform API stats to BusinessOverviewData format using real imported data
 */
function transformStatsToBusinessOverviewData(stats: any): BusinessOverviewData {
  // Helper to infer loan status from loan data
  const getInferredStatus = (loan: any) => {
    if (loan.closing_date) return 'Closed';
    if (loan.lock_date) return 'Locked';
    const rawStatus = (loan.status || '').toString().toUpperCase();
    if (['ACTIVE', 'SUBMITTED', 'APPROVED', 'CTC', 'STARTED', 'INQUIRY', 'PROCESSING', 'UNDERWRITING'].includes(rawStatus)) return 'Active';
    if (['WITHDRAWN', 'CANCELLED'].includes(rawStatus)) return 'Withdrawn';
    if (['DENIED', 'DECLINED', 'REJECTED'].includes(rawStatus)) return 'Denied';
    if (['ORIGINATED', 'FUNDED', 'CLOSED', 'COMPLETE', 'COMPLETED'].includes(rawStatus)) return 'Closed';
    if (['LOCKED'].includes(rawStatus)) return 'Locked';
    if (/^[A-Z]{2}$/.test(rawStatus)) return 'Active';
    return 'Active'; // Default
  };

  // Filter loans by status from byLoanType
  const activeLoansByType: Record<string, any[]> = {};
  const closedLoansByType: Record<string, any[]> = {};
  const lockedLoansByType: Record<string, any[]> = {};

  // Process loans from byLoanType to separate by status
  Object.entries(stats.byLoanType || {}).forEach(([type, data]: [string, any]) => {
    const loans = data.loans || [];
    activeLoansByType[type] = loans.filter((loan: any) => {
      const status = getInferredStatus(loan);
      return ['Active', 'Locked'].includes(status);
    });
    closedLoansByType[type] = loans.filter((loan: any) => {
      const status = getInferredStatus(loan);
      return status === 'Closed';
    });
    lockedLoansByType[type] = loans.filter((loan: any) => {
      const status = getInferredStatus(loan);
      return status === 'Locked';
    });
  });

  // Calculate breakdowns for active and closed loans
  // Use the actual counts from stats (which come from the API) as the totals
  const activeTotal = stats.active ?? 0;
  const closedTotal = stats.closed ?? 0;
  const activeBreakdown = calculateBreakdownFromLoans(activeLoansByType, activeTotal);
  const closedBreakdown = calculateBreakdownFromLoans(closedLoansByType, closedTotal);
  
  // Calculate cycle time display
  const cycleTimeDays = Math.round(stats.avgCycleTime || 0);
  const cycleTimeDisplay = cycleTimeDays > 0 ? `${cycleTimeDays} days` : '0 days';
  
  // Calculate pull-through rate display
  const pullThroughDisplay = stats.pullThroughRate ? `${stats.pullThroughRate.toFixed(1)}%` : '0%';
  
  // Helper to calculate averages for a set of loans
  const calculateAverages = (loans: any[]) => {
    if (loans.length === 0) return { avgInterestRate: 0, avgBalance: 0, avgFICO: 0, avgLTV: 0 };
    
    const withInterest = loans.filter(l => l.interest_rate);
    const avgInterestRate = withInterest.length > 0
      ? withInterest.reduce((sum, l) => sum + parseFloat(l.interest_rate || 0), 0) / withInterest.length
      : 0;
    
    const avgBalance = loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0) / loans.length;
    
    // Extract FICO and LTV from raw_data
    const ficoScores = loans
      .map(l => {
        const rawData = typeof l.raw_data === 'string' ? JSON.parse(l.raw_data) : (l.raw_data || {});
        return rawData.fico_score || rawData.fico;
      })
      .filter(f => f && !isNaN(parseFloat(f)));
    const avgFICO = ficoScores.length > 0
      ? ficoScores.reduce((sum, f) => sum + parseFloat(f), 0) / ficoScores.length
      : 0;
    
    const ltvValues = loans
      .map(l => {
        const rawData = typeof l.raw_data === 'string' ? JSON.parse(l.raw_data) : (l.raw_data || {});
        return rawData.ltv || rawData.loan_to_value;
      })
      .filter(l => l && !isNaN(parseFloat(l)));
    const avgLTV = ltvValues.length > 0
      ? ltvValues.reduce((sum, l) => sum + parseFloat(l), 0) / ltvValues.length
      : 0;
    
    return { avgInterestRate, avgBalance, avgFICO, avgLTV };
  };

  // Collect all active loans for additional breakdowns
  const allActiveLoans: any[] = [];
  Object.values(activeLoansByType).forEach(loans => {
    allActiveLoans.push(...loans);
  });

  // Helper to build rows from grouped loans
  const buildRowsFromGroupedLoans = (groupedLoans: Record<string, any[]>) => {
    return Object.entries(groupedLoans)
      .filter(([_, loans]) => loans.length > 0)
      .map(([category, loans]) => {
        const volume = loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
        const avgs = calculateAverages(loans);
        return {
          category: category || 'Unknown',
          units: loans.length.toString(),
          volume: formatCurrency(volume),
          avgInterestRate: avgs.avgInterestRate > 0 ? `${avgs.avgInterestRate.toFixed(2)}%` : 'N/A',
          avgBalance: formatCurrency(avgs.avgBalance),
          avgFICO: avgs.avgFICO > 0 ? Math.round(avgs.avgFICO).toString() : 'N/A',
          avgLTV: avgs.avgLTV > 0 ? `${avgs.avgLTV.toFixed(1)}%` : 'N/A'
        };
      });
  };

  // Build active loans rows by type
  const activeLoansRows = buildRowsFromGroupedLoans(activeLoansByType);

  // Build active loans rows by purpose
  const activeLoansByPurpose: Record<string, any[]> = {};
  allActiveLoans.forEach(loan => {
    const purpose = loan.loan_purpose || 'Unknown';
    if (!activeLoansByPurpose[purpose]) {
      activeLoansByPurpose[purpose] = [];
    }
    activeLoansByPurpose[purpose].push(loan);
  });
  const activeLoansRowsByPurpose = buildRowsFromGroupedLoans(activeLoansByPurpose);

  // Build active loans rows by size (Jumbo vs Conforming)
  const activeLoansBySize: Record<string, any[]> = {
    'Jumbo': [],
    'Conforming Balance': []
  };
  allActiveLoans.forEach(loan => {
    const amount = parseFloat(loan.loan_amount || 0);
    // Jumbo threshold is typically $766,550 (2024 conforming limit), but we'll use $700K as a reasonable threshold
    const size = amount >= 700000 ? 'Jumbo' : 'Conforming Balance';
    activeLoansBySize[size].push(loan);
  });
  const activeLoansRowsBySize = buildRowsFromGroupedLoans(activeLoansBySize);

  // Build active loans rows by stage
  const activeLoansByStage: Record<string, any[]> = {};
  allActiveLoans.forEach(loan => {
    let stage = 'Inquiry';
    if (loan.lock_date) {
      stage = 'Locked';
    } else if (loan.status) {
      const status = (loan.status || '').toString().toUpperCase();
      if (['SUBMITTED', 'UNDERWRITING'].includes(status)) {
        stage = 'Submitted to Underwriting';
      } else if (['APPROVED'].includes(status)) {
        stage = 'Approved';
      } else if (['CTC', 'CLEAR TO CLOSE'].includes(status)) {
        stage = 'CTC (Clear to Close)';
      } else if (['LOCKED'].includes(status)) {
        stage = 'Locked';
      } else {
        stage = status || 'Inquiry';
      }
    }
    if (!activeLoansByStage[stage]) {
      activeLoansByStage[stage] = [];
    }
    activeLoansByStage[stage].push(loan);
  });
  const activeLoansRowsByStage = buildRowsFromGroupedLoans(activeLoansByStage);

  // Build closed loans rows by type
  const closedLoansRows = Object.entries(closedLoansByType)
    .filter(([_, loans]) => loans.length > 0)
    .map(([type, loans]) => {
      const volume = loans.reduce((sum, l) => sum + parseFloat(l.loan_amount || 0), 0);
      const avgs = calculateAverages(loans);
      return {
        category: type || 'Unknown',
        units: loans.length.toString(),
        volume: formatCurrency(volume),
        avgInterestRate: avgs.avgInterestRate > 0 ? `${avgs.avgInterestRate.toFixed(2)}%` : 'N/A',
        avgBalance: formatCurrency(avgs.avgBalance),
        avgFICO: avgs.avgFICO > 0 ? Math.round(avgs.avgFICO).toString() : 'N/A',
        avgLTV: avgs.avgLTV > 0 ? `${avgs.avgLTV.toFixed(1)}%` : 'N/A'
      };
    });

  // Ensure all values are properly set
  const activeLoansValue = (stats.active ?? 0).toString();
  const closedLoansValue = (stats.closed ?? 0).toString();
  const lockedLoansValue = (stats.locked ?? 0).toString();
  const creditPullsValue = (stats.creditPulls ?? 0).toString();

  return {
    kpis: [
      {
        id: 'active-loans',
        label: 'ACTIVE LOANS',
        value: activeLoansValue,
        changeValue: '+0', // TODO: Calculate from previous period
        trend: 'up',
        drilldown: {
          summary: 'Active loans currently in pipeline',
          sections: [
            {
              title: 'By Loan Type',
              data: activeBreakdown.map(item => ({
                label: item.label,
                value: item.value,
                pct: item.pct
              }))
            }
          ],
          insight: `Active pipeline contains ${stats.active ?? 0} loans with ${formatCurrency(stats.activeVolume ?? 0)} in volume.`
        }
      },
      {
        id: 'closed-loans',
        label: 'CLOSED LOANS',
        value: closedLoansValue,
        changeValue: '+0', // TODO: Calculate from previous period
        trend: 'up',
        drilldown: {
          summary: 'Loans closed',
          sections: [
            {
              title: 'By Loan Type',
              data: closedBreakdown.map(item => ({
                label: item.label,
                value: item.value,
                pct: item.pct
              }))
            }
          ],
          insight: `Closed ${stats.closed ?? 0} loans with ${formatCurrency(stats.closedVolume ?? 0)} in total volume.`
        }
      },
      {
        id: 'locked-loans',
        label: 'LOCKED LOANS',
        value: lockedLoansValue,
        changeValue: '+0', // TODO: Calculate from previous period
        trend: 'up',
        drilldown: {
          summary: 'Loans with rate locks',
          sections: [
            {
              title: 'Locked Loans Summary',
              data: [
                { label: 'Total Locked', value: (stats.locked ?? 0).toString() },
                { label: 'Locked Volume', value: formatCurrency(stats.lockedVolume ?? 0) }
              ]
            }
          ],
          insight: `${stats.locked ?? 0} loans are currently locked with ${formatCurrency(stats.lockedVolume ?? 0)} in volume.`
        }
      },
      {
        id: 'cycle-time',
        label: 'CYCLE TIME',
        value: cycleTimeDisplay,
        changeValue: '0 days', // TODO: Calculate from previous period
        trend: 'up',
        drilldown: {
          summary: `Average days from application to funding = ${cycleTimeDays} days`,
          sections: [
            {
              title: 'Average Cycle Time',
              data: [
                { label: 'Average Days', value: cycleTimeDays.toString(), change: '0' }
              ]
            }
          ],
          insight: `Average cycle time is ${cycleTimeDays} days from application to funding.`
        }
      },
      {
        id: 'pull-through',
        label: 'PULL-THROUGH',
        value: pullThroughDisplay,
        changeValue: '0%', // TODO: Calculate from previous period
        trend: 'up',
        drilldown: {
          summary: 'Percentage of loans that fund',
          sections: [
            {
              title: 'Pull-Through Rate',
              data: [
                { label: 'Pull-Through Rate', value: pullThroughDisplay }
              ]
            }
          ],
          insight: `Pull-through rate is ${pullThroughDisplay}.`
        }
      },
      {
        id: 'credit-pulls',
        label: 'CREDIT PULLS',
        value: creditPullsValue,
        changeValue: '+0', // TODO: Calculate from previous period
        trend: 'up',
        drilldown: {
          summary: 'Credit pulls by loan type',
          sections: [
            {
              title: 'Credit Pulls Summary',
              data: [
                { label: 'Total Credit Pulls', value: (stats.creditPulls ?? 0).toString() }
              ]
            }
          ],
          insight: `${stats.creditPulls ?? 0} credit pulls recorded.`
        }
      }
    ],
    activeLoans: {
      totalUnitsUpDown: '+0',
      sections: [
        {
          title: 'By: Loan Type',
          rows: activeLoansRows.length > 0 ? activeLoansRows : [{
            category: 'No Active Loans',
            units: '0',
            volume: '$0',
            avgInterestRate: 'N/A',
            avgBalance: '$0',
            avgFICO: 'N/A',
            avgLTV: 'N/A'
          }]
        },
        ...(activeLoansRowsByPurpose.length > 0 ? [{
          title: 'By: Loan Purpose',
          rows: activeLoansRowsByPurpose
        }] : []),
        ...(activeLoansRowsBySize.length > 0 ? [{
          title: 'By: Loan Size',
          rows: activeLoansRowsBySize
        }] : []),
        ...(activeLoansRowsByStage.length > 0 ? [{
          title: 'By: Stage',
          rows: activeLoansRowsByStage
        }] : [])
      ]
    },
    closedLoans: {
      totalUnitsUpDown: '+0',
      sections: [
        {
          title: 'By: Loan Type',
          rows: closedLoansRows.length > 0 ? closedLoansRows : [{
            category: 'No Closed Loans',
            units: '0',
            volume: '$0',
            avgInterestRate: 'N/A',
            avgBalance: '$0',
            avgFICO: 'N/A',
            avgLTV: 'N/A'
          }]
        }
      ]
    },
    lockedLoans: {
      totalUnitsUpDown: '+0',
      breakdown: [
        { category: 'Locked Loans', units: (stats.locked ?? 0).toString() }
      ]
    },
    cycleTime: {
      daysUpDown: '0d',
      avgDaysToFunding: cycleTimeDays.toString(),
      target: '30',
      variance: (cycleTimeDays - 30).toString(),
      timeByStage: [],
      cycleTimeByType: []
    },
    pullThrough: {
      avgPercentUpDown: '0%',
      byType: [],
      fallout: {
        withdrawn: '0',
        denied: '0'
      }
    },
    creditPulls: {
      unitsUpDown: '+0',
      byType: Object.entries(stats.byLoanType || {}).map(([type, data]: [string, any]) => ({
        loanType: type || 'Unknown',
        mtdUnits: data.count?.toString() || '0',
        monthUnits: data.count?.toString() || '0'
      }))
    }
  };
}

/**
 * Helper to calculate breakdown percentages from filtered loans
 */
function calculateBreakdownFromLoans(loansByType: Record<string, any[]>, total: number): Array<{ label: string; value: string; pct: string }> {
  if (!loansByType || total === 0) return [];
  
  return Object.entries(loansByType)
    .filter(([_, loans]) => loans.length > 0)
    .map(([type, loans]) => {
      const count = loans.length;
      const pct = total > 0 ? ((count / total) * 100).toFixed(0) : '0';
      return {
        label: type || 'Unknown',
        value: count.toString(),
        pct: `${pct}%`
      };
    });
}

/**
 * Helper to format currency
 */
function formatCurrency(amount: number): string {
  if (!amount || isNaN(amount)) return '$0';
  if (amount >= 1000000) {
    return `$${(amount / 1000000).toFixed(1)}M`;
  } else if (amount >= 1000) {
    return `$${(amount / 1000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

function getEmptyData(): BusinessOverviewData {
  const emptyKpi = (id: string, label: string) => ({
    id,
    label,
    value: '0',
    changeValue: '+0',
    trend: 'up' as const,
    drilldown: {
      summary: 'No data available',
      sections: [],
      insight: 'No data available. Please import loan data to see metrics.'
    }
  });

  return {
    kpis: [
      emptyKpi('active-loans', 'ACTIVE LOANS'),
      emptyKpi('closed-loans', 'CLOSED LOANS'),
      emptyKpi('locked-loans', 'LOCKED LOANS'),
      emptyKpi('cycle-time', 'CYCLE TIME'),
      emptyKpi('pull-through', 'PULL-THROUGH'),
      emptyKpi('credit-pulls', 'CREDIT PULLS'),
    ],
    activeLoans: {
      totalUnitsUpDown: '+0',
      sections: [{ title: 'By: Loan Type', rows: [] }]
    },
    closedLoans: {
      totalUnitsUpDown: '+0',
      sections: [{ title: 'By: Loan Type', rows: [] }]
    },
    lockedLoans: {
      totalUnitsUpDown: '+0',
      breakdown: []
    },
    cycleTime: {
      daysUpDown: '0d',
      avgDaysToFunding: '0',
      target: '30',
      variance: '0',
      timeByStage: [],
      cycleTimeByType: []
    },
    pullThrough: {
      avgPercentUpDown: '0%',
      byType: [],
      fallout: { withdrawn: '0', denied: '0' }
    },
    creditPulls: {
      unitsUpDown: '+0',
      byType: []
    }
  };
}

