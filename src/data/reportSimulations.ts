import { Activity, AlertTriangle, TrendingUp, Clock, BarChart3, DollarSign } from 'lucide-react';

export type ReportStatus = 'healthy' | 'warning' | 'critical';

export interface ReportData {
  id: string;
  title: string;
  icon: typeof Activity;
  status: ReportStatus;
  summary: {
    keyTakeaways: string[];
    primaryKPI: {
      label: string;
      value: string | number;
      trend: 'up' | 'down' | 'neutral';
      change: string;
    }[];
  };
  charts: {
    type: 'line' | 'bar' | 'area' | 'pie';
    title: string;
    data: any[];
    config?: any;
  }[];
  tables: {
    title: string;
    headers: string[];
    rows: any[][];
  }[];
  alerts: {
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    action?: string;
  }[];
}

// Daily Production Pulse
export const dailyProductionPulseData: ReportData = {
  id: '1',
  title: 'Daily Production Pulse',
  icon: Activity,
  status: 'healthy',
  summary: {
    keyTakeaways: [
      'Pacing at 112% of daily volume target - strong performance',
      'Pipeline health is GREEN with 68% of loans in healthy status',
      'Revenue today: $2.4M, up 8% from yesterday',
      'Approval rate at 87% - above 85% target threshold'
    ],
    primaryKPI: [
      { label: 'Loans Locked Today', value: 47, trend: 'up', change: '+12%' },
      { label: 'Loans Submitted', value: 52, trend: 'up', change: '+8%' },
      { label: 'Loans Approved', value: 45, trend: 'up', change: '+5%' },
      { label: 'Loans Funded', value: 38, trend: 'up', change: '+3%' },
      { label: 'Daily Revenue', value: '$2.4M', trend: 'up', change: '+8%' },
      { label: 'Pipeline Health', value: 'GREEN', trend: 'neutral', change: '68% healthy' }
    ]
  },
  charts: [
    {
      type: 'line',
      title: 'Daily Production Trend (Last 30 Days)',
      data: Array.from({ length: 30 }, (_, i) => ({
        date: `Day ${i + 1}`,
        locked: 35 + Math.random() * 15,
        submitted: 40 + Math.random() * 15,
        approved: 38 + Math.random() * 12,
        funded: 32 + Math.random() * 10
      }))
    },
    {
      type: 'bar',
      title: 'Production by Product Type',
      data: [
        { name: 'Conventional', locked: 28, submitted: 32, approved: 27, funded: 23 },
        { name: 'FHA', locked: 12, submitted: 13, approved: 11, funded: 9 },
        { name: 'VA', locked: 5, submitted: 5, approved: 5, funded: 4 },
        { name: 'Jumbo', locked: 2, submitted: 2, approved: 2, funded: 2 }
      ]
    },
    {
      type: 'pie',
      title: 'Pipeline Status Distribution',
      data: [
        { name: 'Healthy', value: 68, color: '#10b981' },
        { name: 'At Risk', value: 22, color: '#f59e0b' },
        { name: 'Critical', value: 10, color: '#ef4444' }
      ]
    }
  ],
  tables: [
    {
      title: 'Top Performing Branches Today',
      headers: ['Branch', 'Loans Locked', 'Revenue', 'Conversion Rate'],
      rows: [
        ['North Region', 12, '$612K', '89%'],
        ['South Region', 15, '$765K', '87%'],
        ['East Region', 11, '$561K', '85%'],
        ['West Region', 9, '$459K', '82%']
      ]
    }
  ],
  alerts: [
    { severity: 'low', message: 'West Region slightly below target - monitor closely' }
  ]
};

// Fallout and Risk
export const falloutRiskData: ReportData = {
  id: '2',
  title: 'Fallout and Risk',
  icon: AlertTriangle,
  status: 'warning',
  summary: {
    keyTakeaways: [
      'Fallout risk increased 15% in FHA purchase channel - immediate attention needed',
      '12 rate lock expirations within 7 days requiring urgent follow-up',
      'Top fallout cause: Rate increases (38% of withdrawals)',
      'Forecasted fallout risk: $1.2M if no intervention'
    ],
    primaryKPI: [
      { label: 'Withdrawals Today', value: 8, trend: 'up', change: '+15%' },
      { label: 'Declinations Today', value: 5, trend: 'down', change: '-8%' },
      { label: 'Aging Loans (>30 days)', value: 23, trend: 'up', change: '+12%' },
      { label: 'Rate Lock Expirations', value: 12, trend: 'up', change: '+25%' },
      { label: 'Forecasted Fallout Risk', value: '$1.2M', trend: 'up', change: '+15%' },
      { label: 'Risk Level', value: 'ELEVATED', trend: 'up', change: 'Monitor closely' }
    ]
  },
  charts: [
    {
      type: 'area',
      title: 'Fallout Trends (Last 14 Days)',
      data: Array.from({ length: 14 }, (_, i) => ({
        date: `Day ${i + 1}`,
        withdrawals: 5 + Math.random() * 5,
        declinations: 3 + Math.random() * 3,
        expirations: 2 + Math.random() * 4
      }))
    },
    {
      type: 'bar',
      title: 'Top Fallout Causes',
      data: [
        { name: 'Rate Increases', value: 38, color: '#ef4444' },
        { name: 'Appraisal Issues', value: 24, color: '#f59e0b' },
        { name: 'Credit Concerns', value: 18, color: '#f59e0b' },
        { name: 'MLO Behavior', value: 12, color: '#10b981' },
        { name: 'Ops Delays', value: 8, color: '#10b981' }
      ]
    },
    {
      type: 'line',
      title: 'Rate Lock Expiration Timeline',
      data: Array.from({ length: 7 }, (_, i) => ({
        day: `Day ${i + 1}`,
        expiring: [12, 8, 5, 3, 2, 1, 0][i]
      }))
    }
  ],
  tables: [
    {
      title: 'Critical Rate Lock Expirations',
      headers: ['Loan ID', 'Borrower', 'Expires In', 'Loan Amount', 'Risk Level'],
      rows: [
        ['#12345', 'Smith, John', '2 days', '$450K', 'CRITICAL'],
        ['#12346', 'Johnson, Mary', '3 days', '$320K', 'HIGH'],
        ['#12347', 'Williams, David', '4 days', '$580K', 'HIGH'],
        ['#12348', 'Brown, Sarah', '5 days', '$275K', 'MEDIUM']
      ]
    }
  ],
  alerts: [
    { severity: 'critical', message: 'FHA purchase channel showing 15% increase in fallout risk', action: 'Review pricing strategy immediately' },
    { severity: 'high', message: '12 rate locks expiring within 7 days', action: 'Contact borrowers today' },
    { severity: 'medium', message: 'Appraisal issues trending up - coordinate with appraisers' }
  ]
};

// Loan Officer Performance
export const loPerformanceData: ReportData = {
  id: '3',
  title: 'Loan Officer Top Tiering Performance',
  icon: TrendingUp,
  status: 'healthy',
  summary: {
    keyTakeaways: [
      'Top tier LOs generating 65% of revenue with only 20% of staff',
      '3 LOs trending toward bottom tier - coaching intervention needed',
      'Average pull-through rate: 78% (target: 75%) - exceeding expectations',
      'Revenue per loan: $12,450 - up 3% from last month'
    ],
    primaryKPI: [
      { label: 'Top Tier LOs', value: 20, trend: 'neutral', change: '20% of staff' },
      { label: 'Top Tier Revenue', value: '$15.6M', trend: 'up', change: '65% of total' },
      { label: 'Avg Pull-Through Rate', value: '78%', trend: 'up', change: '+3%' },
      { label: 'Revenue per Loan', value: '$12,450', trend: 'up', change: '+3%' },
      { label: 'Bottom Tier Count', value: 50, trend: 'down', change: '-2 LOs' },
      { label: 'Coaching Flags', value: 3, trend: 'down', change: '3 LOs need attention' }
    ]
  },
  charts: [
    {
      type: 'bar',
      title: 'Revenue by Tier',
      data: [
        { name: 'Top Tier', revenue: 15600000, loans: 1250, color: '#10b981' },
        { name: 'Middle Tier', revenue: 6300000, loans: 630, color: '#f59e0b' },
        { name: 'Bottom Tier', revenue: 2100000, loans: 210, color: '#ef4444' }
      ]
    },
    {
      type: 'line',
      title: 'Pull-Through Rate Trend (Last 12 Weeks)',
      data: Array.from({ length: 12 }, (_, i) => ({
        week: `Week ${i + 1}`,
        topTier: 85 + Math.random() * 5,
        middleTier: 75 + Math.random() * 5,
        bottomTier: 65 + Math.random() * 5
      }))
    },
    {
      type: 'pie',
      title: 'LO Distribution by Tier',
      data: [
        { name: 'Top Tier', value: 20, color: '#10b981' },
        { name: 'Middle Tier', value: 30, color: '#f59e0b' },
        { name: 'Bottom Tier', value: 50, color: '#ef4444' }
      ]
    }
  ],
  tables: [
    {
      title: 'Top 5 Performers This Month',
      headers: ['LO Name', 'Loans Closed', 'Revenue', 'Pull-Through', 'Tier'],
      rows: [
        ['Sarah Martinez', 28, '$348.6K', '92%', 'TOP'],
        ['Michael Chen', 25, '$311.3K', '89%', 'TOP'],
        ['Emily Rodriguez', 23, '$286.4K', '87%', 'TOP'],
        ['James Wilson', 22, '$274.0K', '85%', 'TOP'],
        ['Lisa Anderson', 21, '$261.5K', '84%', 'TOP']
      ]
    },
    {
      title: 'LOs Requiring Coaching',
      headers: ['LO Name', 'Current Tier', 'Trend', 'Issue', 'Action'],
      rows: [
        ['John Smith', 'MIDDLE', '↓ Bottom', 'Low pull-through (62%)', 'Schedule coaching session'],
        ['Mary Johnson', 'MIDDLE', '↓ Bottom', 'Declining volume', 'Review pipeline'],
        ['David Lee', 'BOTTOM', '↓', 'Multiple client complaints', 'Performance improvement plan']
      ]
    }
  ],
  alerts: [
    { severity: 'medium', message: '3 LOs trending toward bottom tier', action: 'Schedule coaching sessions this week' },
    { severity: 'low', message: 'Top tier performance exceeding targets - consider recognition program' }
  ]
};

// Operations and Speed
export const operationsSpeedData: ReportData = {
  id: '4',
  title: 'Operations and Speed',
  icon: Clock,
  status: 'warning',
  summary: {
    keyTakeaways: [
      'Average cycle time: 32 days (target: 30 days) - 2 days behind',
      'Underwriting team at 92% capacity - approaching bottleneck',
      'Top delay reason: Document collection (38% of delays)',
      '2 processors have files aging past 8 days - load balancing needed'
    ],
    primaryKPI: [
      { label: 'Avg Cycle Time', value: '32 days', trend: 'up', change: '+2 days' },
      { label: 'Submission to Approval', value: '12 days', trend: 'up', change: '+1 day' },
      { label: 'Approval to Closing', value: '20 days', trend: 'up', change: '+1 day' },
      { label: 'Underwriting Capacity', value: '92%', trend: 'up', change: 'Near limit' },
      { label: 'Processing Capacity', value: '78%', trend: 'neutral', change: 'Healthy' },
      { label: 'SLA Compliance', value: '85%', trend: 'down', change: '-3%' }
    ]
  },
  charts: [
    {
      type: 'line',
      title: 'Cycle Time Trend (Last 30 Days)',
      data: Array.from({ length: 30 }, (_, i) => ({
        date: `Day ${i + 1}`,
        cycleTime: 28 + Math.random() * 6,
        target: 30
      }))
    },
    {
      type: 'bar',
      title: 'Capacity Utilization by Team',
      data: [
        { name: 'Processing', utilization: 78, capacity: 100, color: '#10b981' },
        { name: 'Underwriting', utilization: 92, capacity: 100, color: '#f59e0b' },
        { name: 'Closing', utilization: 65, capacity: 100, color: '#10b981' },
        { name: 'Post-Closing', utilization: 58, capacity: 100, color: '#10b981' }
      ]
    },
    {
      type: 'pie',
      title: 'Top Delay Reasons',
      data: [
        { name: 'Document Collection', value: 38, color: '#ef4444' },
        { name: 'Appraisal Delays', value: 24, color: '#f59e0b' },
        { name: 'Underwriter Review', value: 18, color: '#f59e0b' },
        { name: 'Title Issues', value: 12, color: '#10b981' },
        { name: 'Other', value: 8, color: '#10b981' }
      ]
    }
  ],
  tables: [
    {
      title: 'Files Aging Past Milestones',
      headers: ['File ID', 'Processor', 'Days Past Due', 'Stage', 'Borrower'],
      rows: [
        ['#F-1234', 'Jennifer Brown', 9, 'Underwriting', 'Smith, John'],
        ['#F-1235', 'Robert Davis', 8, 'Processing', 'Johnson, Mary'],
        ['#F-1236', 'Amanda White', 7, 'Underwriting', 'Williams, David'],
        ['#F-1237', 'Thomas Green', 6, 'Closing', 'Brown, Sarah']
      ]
    },
    {
      title: 'SLA Performance by Stage',
      headers: ['Stage', 'Target', 'Actual', 'Compliance Rate', 'Status'],
      rows: [
        ['Processing', '5 days', '5.2 days', '96%', 'GREEN'],
        ['Underwriting', '7 days', '7.8 days', '89%', 'YELLOW'],
        ['Closing', '10 days', '11.2 days', '88%', 'YELLOW'],
        ['Post-Closing', '3 days', '2.8 days', '100%', 'GREEN']
      ]
    }
  ],
  alerts: [
    { severity: 'high', message: 'Underwriting team at 92% capacity - consider adding resources', action: 'Review workload distribution' },
    { severity: 'medium', message: '2 processors have files aging past 8 days', action: 'Load balance immediately' },
    { severity: 'medium', message: 'Document collection causing 38% of delays', action: 'Implement automated reminders' }
  ]
};

// Rate Competitiveness
export const rateCompetitivenessData: ReportData = {
  id: '5',
  title: 'Rate Competitiveness',
  icon: BarChart3,
  status: 'healthy',
  summary: {
    keyTakeaways: [
      'Rate competitiveness score: 87/100 - strong position in market',
      'Margin compression: -2 bps this week - within acceptable range',
      'Lock/float ratio: 68% locked - healthy balance',
      'Aletheia recommendation: Maintain current pricing strategy'
    ],
    primaryKPI: [
      { label: 'Competitiveness Score', value: '87/100', trend: 'up', change: '+2 points' },
      { label: 'Avg Rate vs Market', value: '-0.125%', trend: 'neutral', change: 'Competitive' },
      { label: 'Lock/Float Ratio', value: '68%', trend: 'neutral', change: 'Healthy' },
      { label: 'Margin Compression', value: '-2 bps', trend: 'down', change: 'Acceptable' },
      { label: 'Pricing Exceptions', value: '12', trend: 'down', change: '-3 this week' },
      { label: 'Market Position', value: 'STRONG', trend: 'up', change: 'Top quartile' }
    ]
  },
  charts: [
    {
      type: 'line',
      title: 'Rate Comparison vs Competitors (Last 30 Days)',
      data: Array.from({ length: 30 }, (_, i) => ({
        date: `Day ${i + 1}`,
        ourRate: 6.5 + Math.random() * 0.3,
        competitor1: 6.6 + Math.random() * 0.3,
        competitor2: 6.55 + Math.random() * 0.3,
        marketAvg: 6.58 + Math.random() * 0.3
      }))
    },
    {
      type: 'bar',
      title: 'Lock vs Float Behavior by Product',
      data: [
        { name: 'Conventional', locked: 72, floated: 28 },
        { name: 'FHA', locked: 65, floated: 35 },
        { name: 'VA', locked: 68, floated: 32 },
        { name: 'Jumbo', locked: 75, floated: 25 }
      ]
    },
    {
      type: 'area',
      title: 'Margin Trends by Product (Last 12 Weeks)',
      data: Array.from({ length: 12 }, (_, i) => ({
        week: `Week ${i + 1}`,
        conventional: 250 + Math.random() * 20,
        fha: 280 + Math.random() * 25,
        va: 270 + Math.random() * 20,
        jumbo: 300 + Math.random() * 30
      }))
    }
  ],
  tables: [
    {
      title: 'Pricing Exception Trends by Branch',
      headers: ['Branch', 'Exceptions This Week', 'Avg Exception (bps)', 'Trend'],
      rows: [
        ['North Region', 4, '-12 bps', '↓ Decreasing'],
        ['South Region', 3, '-8 bps', '↓ Decreasing'],
        ['East Region', 3, '-10 bps', '↓ Decreasing'],
        ['West Region', 2, '-6 bps', '→ Stable']
      ]
    }
  ],
  alerts: [
    { severity: 'low', message: 'Margin compression within acceptable range - monitor weekly' },
    { severity: 'low', message: 'Strong market position maintained - continue current strategy' }
  ]
};

// Profitability Snapshot
export const profitabilityData: ReportData = {
  id: '6',
  title: 'Profitability Snapshot',
  icon: DollarSign,
  status: 'healthy',
  summary: {
    keyTakeaways: [
      'Net margin today: $1.85M - 23% above daily target',
      'Revenue per loan: $12,450 vs cost per loan: $8,200 = $4,250 profit',
      'Month-end P&L forecast: $48.2M revenue, $12.8M profit (26.5% margin)',
      'Hedging impact: Positive $125K this week - favorable market conditions'
    ],
    primaryKPI: [
      { label: 'Net Margin Today', value: '$1.85M', trend: 'up', change: '+23%' },
      { label: 'Revenue per Loan', value: '$12,450', trend: 'up', change: '+3%' },
      { label: 'Cost per Loan', value: '$8,200', trend: 'down', change: '-2%' },
      { label: 'Profit per Loan', value: '$4,250', trend: 'up', change: '+8%' },
      { label: 'Month-End Forecast', value: '$48.2M', trend: 'up', change: '+5% vs target' },
      { label: 'Profit Margin', value: '26.5%', trend: 'up', change: '+1.2%' }
    ]
  },
  charts: [
    {
      type: 'area',
      title: 'Daily P&L Trend (Last 30 Days)',
      data: Array.from({ length: 30 }, (_, i) => ({
        date: `Day ${i + 1}`,
        revenue: 1500000 + Math.random() * 500000,
        cost: 1000000 + Math.random() * 300000,
        profit: 500000 + Math.random() * 200000
      }))
    },
    {
      type: 'bar',
      title: 'Profitability by Product Type',
      data: [
        { name: 'Conventional', revenue: 17500000, cost: 11500000, profit: 6000000 },
        { name: 'FHA', revenue: 8400000, cost: 5880000, profit: 2520000 },
        { name: 'VA', revenue: 3500000, cost: 2450000, profit: 1050000 },
        { name: 'Jumbo', revenue: 1200000, cost: 720000, profit: 480000 }
      ]
    },
    {
      type: 'line',
      title: 'Margin Trend (Last 12 Months)',
      data: Array.from({ length: 12 }, (_, i) => ({
        month: `Month ${i + 1}`,
        margin: 24 + Math.random() * 4
      }))
    }
  ],
  tables: [
    {
      title: 'Expense Variance by Department',
      headers: ['Department', 'Budget', 'Actual', 'Variance', 'Status'],
      rows: [
        ['Operations', '$2.1M', '$2.05M', '-$50K', 'UNDER'],
        ['Sales', '$1.8M', '$1.82M', '+$20K', 'OVER'],
        ['Technology', '$450K', '$445K', '-$5K', 'UNDER'],
        ['Administration', '$320K', '$325K', '+$5K', 'OVER']
      ]
    },
    {
      title: 'Hedging Impact Analysis',
      headers: ['Week', 'Hedging Gain/Loss', 'Market Movement', 'Net Impact'],
      rows: [
        ['This Week', '+$125K', 'Favorable', 'POSITIVE'],
        ['Last Week', '+$85K', 'Favorable', 'POSITIVE'],
        ['2 Weeks Ago', '-$45K', 'Unfavorable', 'NEGATIVE'],
        ['3 Weeks Ago', '+$95K', 'Favorable', 'POSITIVE']
      ]
    }
  ],
  alerts: [
    { severity: 'low', message: 'Profitability exceeding targets - strong performance across all products' },
    { severity: 'low', message: 'Hedging strategy performing well - continue current approach' }
  ]
};

// Export all reports
export const allReports: ReportData[] = [
  dailyProductionPulseData,
  falloutRiskData,
  loPerformanceData,
  operationsSpeedData,
  rateCompetitivenessData,
  profitabilityData
];

// Helper to get report by ID
export const getReportById = (id: string): ReportData | undefined => {
  return allReports.find(report => report.id === id);
};

