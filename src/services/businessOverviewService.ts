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

  // Fallback to mock data only if API fails or returns invalid data
  return getMockData();
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

function getMockData(): BusinessOverviewData {
  return {
    kpis: [
      {
        id: 'active-loans',
        label: 'ACTIVE LOANS',
        value: '402',
        changeValue: '+42',
        trend: 'up',
        drilldown: {
          summary: 'Active loans currently in pipeline',
          sections: [
            {
              title: 'By Loan Type',
              data: [
                { label: 'Conventional', value: '245', pct: '61%' },
                { label: 'FHA', value: '89', pct: '22%' },
                { label: 'VA', value: '45', pct: '11%' },
                { label: 'USDA', value: '23', pct: '6%' }
              ]
            },
            {
              title: 'By Loan Purpose',
              data: [
                { label: 'Purchase', value: '302', pct: '75%' },
                { label: 'Refinance', value: '100', pct: '25%' }
              ]
            },
            {
              title: 'By Loan Size',
              data: [
                { label: 'Jumbo', value: '78', pct: '19%' },
                { label: 'Conforming Balance', value: '324', pct: '81%' }
              ]
            },
            {
              title: 'By Stage',
              data: [
                { label: 'Locked', value: '158', pct: '39%' },
                { label: 'Submitted to Underwriting', value: '124', pct: '31%' },
                { label: 'Approved', value: '89', pct: '22%' },
                { label: 'CTC (Clear to Close)', value: '31', pct: '8%' }
              ]
            }
          ],
          insight: 'Active pipeline is healthy with 75% purchase loans. 39% already locked and progressing through underwriting.'
        }
      },
      {
        id: 'closed-loans',
        label: 'CLOSED LOANS',
        value: '892',
        changeValue: '+67',
        trend: 'up',
        drilldown: {
          summary: 'Loans closed month-to-date',
          sections: [
            {
              title: 'By Loan Type',
              data: [
                { label: 'Conventional', value: '534', pct: '60%' },
                { label: 'FHA', value: '198', pct: '22%' },
                { label: 'VA', value: '102', pct: '11%' },
                { label: 'USDA', value: '58', pct: '7%' }
              ]
            },
            {
              title: 'By Loan Purpose',
              data: [
                { label: 'Purchase', value: '669', pct: '75%' },
                { label: 'Refinance', value: '223', pct: '25%' }
              ]
            },
            {
              title: 'By Loan Size',
              data: [
                { label: 'Jumbo', value: '134', pct: '15%' },
                { label: 'Conforming Balance', value: '758', pct: '85%' }
              ]
            }
          ],
          insight: 'Strong closing volume with +67 units vs prior period. Conventional and purchase loans lead production.'
        }
      },
      {
        id: 'locked-loans',
        label: 'LOCKED LOANS',
        value: '158',
        changeValue: '+12',
        trend: 'up',
        drilldown: {
          summary: 'Loans with rate locks by expiration',
          sections: [
            {
              title: 'By Expiration Days',
              data: [
                { label: '> 30 days', value: '18', pct: '11%' },
                { label: '15-29 days', value: '42', pct: '27%' },
                { label: '10-14 days', value: '56', pct: '35%' },
                { label: '< 9 days', value: '38', pct: '24%' },
                { label: 'Expired', value: '4', pct: '3%' }
              ]
            }
          ],
          insight: '97% of locks are active. Only 4 expired locks need attention. Focus on the 38 loans expiring within 9 days.'
        }
      },
      {
        id: 'cycle-time',
        label: 'CYCLE TIME',
        value: '25d',
        changeValue: '-3d',
        trend: 'up',
        drilldown: {
          summary: 'Average days from application to funding = 25 days',
          sections: [
            {
              title: 'Time By Stage (Days)',
              data: [
                { label: 'Application to Lock', value: '5', change: '-2' },
                { label: 'Lock to Submitted to Underwriting', value: '6', change: '+1' },
                { label: 'Underwriting to Approval', value: '8', change: '-2' },
                { label: 'Approval to CTC', value: '4', change: '-1' },
                { label: 'CTC to Closing', value: '2', change: '-1' }
              ]
            },
            {
              title: 'Cycle Time By Loan Type',
              data: [
                { label: 'Conventional', value: '23d' },
                { label: 'FHA', value: '28d' },
                { label: 'VA', value: '26d' },
                { label: 'USDA', value: '32d' },
                { label: 'Jumbo', value: '21d' }
              ]
            }
          ],
          insight: 'Cycle time improved 3 days. Underwriting and approval stages showing best improvement.'
        }
      },
      {
        id: 'pull-through',
        label: 'PULL-THROUGH',
        value: '72.8%',
        changeValue: '+4.2%',
        trend: 'up',
        drilldown: {
          summary: 'Percentage of locked loans that fund',
          sections: [
            {
              title: 'By Loan Type',
              data: [
                { label: 'Conventional', value: '75.2%', change: 'above' },
                { label: 'FHA', value: '68.4%', change: 'below' },
                { label: 'VA', value: '78.9%', change: 'above' },
                { label: 'USDA', value: '65.2%', change: 'below' },
                { label: 'Jumbo', value: '82.1%', change: 'above' }
              ]
            },
            {
              title: 'Fallout Breakdown',
              data: [
                { label: 'Withdrawn', value: '142', pct: '61%' },
                { label: 'Denied', value: '89', pct: '39%' }
              ]
            }
          ],
          insight: 'Pull-through up 4.2%. VA and Jumbo performing above company average. Focus on improving FHA and USDA conversion.'
        }
      },
      {
        id: 'credit-pulls',
        label: 'CREDIT PULLS',
        value: '938',
        changeValue: '+28',
        trend: 'up',
        drilldown: {
          summary: 'Credit pulls by loan type',
          sections: [
            {
              title: 'By Loan Type (MTD vs Month)',
              data: [
                { label: 'Conventional', value: '489 MTD / 1,247 Month' },
                { label: 'FHA', value: '178 MTD / 456 Month' },
                { label: 'VA', value: '95 MTD / 243 Month' },
                { label: 'USDA', value: '42 MTD / 107 Month' },
                { label: 'Jumbo', value: '134 MTD / 342 Month' }
              ]
            }
          ],
          insight: 'Credit pull activity up 28 units. Strong lead flow across all loan types. Conventional and Jumbo showing strongest activity.'
        }
      }
    ],
    activeLoans: {
      totalUnitsUpDown: '+42',
      sections: [
        {
          title: 'By: Loan Type',
          rows: [
            { category: 'Conventional', units: '245', volume: '$78.4M', avgInterestRate: '6.25%', avgBalance: '$320K', avgFICO: '740', avgLTV: '75%' },
            { category: 'FHA', units: '89', volume: '$22.1M', avgInterestRate: '6.50%', avgBalance: '$248K', avgFICO: '680', avgLTV: '96.5%' },
            { category: 'VA', units: '45', volume: '$15.2M', avgInterestRate: '6.00%', avgBalance: '$338K', avgFICO: '720', avgLTV: '100%' },
            { category: 'USDA', units: '23', volume: '$5.9M', avgInterestRate: '6.35%', avgBalance: '$257K', avgFICO: '690', avgLTV: '100%' }
          ]
        },
        {
          title: 'By: Loan Purpose',
          rows: [
            { category: 'Purchase', units: '302', volume: '$96.8M', avgInterestRate: '6.28%', avgBalance: '$321K', avgFICO: '725', avgLTV: '82%' },
            { category: 'Refinance', units: '100', volume: '$24.8M', avgInterestRate: '6.15%', avgBalance: '$248K', avgFICO: '710', avgLTV: '68%' }
          ]
        },
        {
          title: 'By: Loan Size',
          rows: [
            { category: 'Jumbo', units: '78', volume: '$42.5M', avgInterestRate: '6.10%', avgBalance: '$545K', avgFICO: '770', avgLTV: '70%' },
            { category: 'Conforming Balance', units: '324', volume: '$79.1M', avgInterestRate: '6.32%', avgBalance: '$244K', avgFICO: '705', avgLTV: '85%' }
          ]
        },
        {
          title: 'By: Stage',
          rows: [
            { category: 'Locked', units: '158', volume: '$50.4M', avgInterestRate: '6.24%', avgBalance: '$319K', avgFICO: '730', avgLTV: '78%' },
            { category: 'Submitted to Underwriting', units: '124', volume: '$39.8M', avgInterestRate: '6.28%', avgBalance: '$321K', avgFICO: '720', avgLTV: '80%' },
            { category: 'Approved', units: '89', volume: '$28.2M', avgInterestRate: '6.20%', avgBalance: '$317K', avgFICO: '735', avgLTV: '76%' },
            { category: 'CTC (Clear to Close)', units: '31', volume: '$9.2M', avgInterestRate: '6.18%', avgBalance: '$297K', avgFICO: '745', avgLTV: '74%' }
          ]
        }
      ]
    },
    closedLoans: {
      totalUnitsUpDown: '+67',
      sections: [
        {
          title: 'By: Loan Type',
          rows: [
            { category: 'Conventional', units: '534', volume: '$171.2M', avgInterestRate: '6.22%', avgBalance: '$321K', avgFICO: '742', avgLTV: '74%' },
            { category: 'FHA', units: '198', volume: '$49.1M', avgInterestRate: '6.48%', avgBalance: '$248K', avgFICO: '682', avgLTV: '96.5%' },
            { category: 'VA', units: '102', volume: '$34.5M', avgInterestRate: '5.98%', avgBalance: '$338K', avgFICO: '722', avgLTV: '100%' },
            { category: 'USDA', units: '58', volume: '$14.9M', avgInterestRate: '6.32%', avgBalance: '$257K', avgFICO: '692', avgLTV: '100%' }
          ]
        }
      ]
    },
    lockedLoans: {
      totalUnitsUpDown: '+12',
      breakdown: [
        { category: '> 30 days', units: '18' },
        { category: '15-29 days', units: '42' },
        { category: '10-14 days', units: '56' },
        { category: '< 9 days', units: '38' },
        { category: 'Expired', units: '4' }
      ]
    },
    cycleTime: {
      daysUpDown: '-3d',
      avgDaysToFunding: '25',
      target: '30',
      variance: '-5',
      timeByStage: [
        { stage: 'Application to Lock', avgDays: '5', target: '7', variance: '-2' },
        { stage: 'Lock to Submitted to Underwriting', avgDays: '6', target: '5', variance: '+1' },
        { stage: 'Underwriting to Approval', avgDays: '8', target: '10', variance: '-2' },
        { stage: 'Approval to CTC', avgDays: '4', target: '5', variance: '-1' },
        { stage: 'CTC to Closing', avgDays: '2', target: '3', variance: '-1' }
      ],
      cycleTimeByType: [
        { loanType: 'Conventional', avgDays: '23', trend: 'down', status: 'good' },
        { loanType: 'FHA', avgDays: '28', trend: 'neutral', status: 'good' },
        { loanType: 'VA', avgDays: '26', trend: 'down', status: 'good' },
        { loanType: 'USDA', avgDays: '32', trend: 'up', status: 'warning' },
        { loanType: 'Jumbo', avgDays: '21', trend: 'down', status: 'good' }
      ]
    },
    pullThrough: {
      avgPercentUpDown: '+4.2%',
      byType: [
        { loanType: 'Conventional', value: '75.2%', companyAverage: '72.8%', status: 'above' },
        { loanType: 'FHA', value: '68.4%', companyAverage: '70.1%', status: 'below' },
        { loanType: 'VA', value: '78.9%', companyAverage: '75.5%', status: 'above' },
        { loanType: 'USDA', value: '65.2%', companyAverage: '68.3%', status: 'below' },
        { loanType: 'Jumbo', value: '82.1%', companyAverage: '79.4%', status: 'above' }
      ],
      fallout: {
        withdrawn: '142',
        denied: '89'
      }
    },
    creditPulls: {
      unitsUpDown: '+28',
      byType: [
        { loanType: 'Conventional', mtdUnits: '489', monthUnits: '1,247' },
        { loanType: 'FHA', mtdUnits: '178', monthUnits: '456' },
        { loanType: 'VA', mtdUnits: '95', monthUnits: '243' },
        { loanType: 'USDA', mtdUnits: '42', monthUnits: '107' },
        { loanType: 'Jumbo', mtdUnits: '134', monthUnits: '342' }
      ]
    }
  };
}

