// KPI Drilldown Data
export interface KPIDrilldownSection {
  title: string;
  data: Array<{
    label: string;
    value: string;
    pct?: string;
    change?: string;
  }>;
}

export interface KPIDrilldown {
  summary: string;
  sections: KPIDrilldownSection[];
  insight?: string;
}

// Top KPI Metrics (6 cards shown in PDF)
export interface KPIMetric {
  id: string;
  label: string;
  value: string;
  changeValue: string;
  trend: 'up' | 'down' | 'neutral';
  drilldown?: KPIDrilldown;
}

// Active Loans Breakdown
export interface ActiveLoanRow {
  category: string; // e.g., "Conventional", "FHA", "Purchase", etc.
  unitsUpDown?: string;
  units: string;
  volume: string;
  avgInterestRate: string;
  avgBalance: string;
  avgFICO: string;
  avgLTV: string;
}

export interface ActiveLoanSection {
  title: string; // "By: Loan Type", "By: Loan Purpose", etc.
  rows: ActiveLoanRow[];
}

export interface ActiveLoansData {
  totalUnitsUpDown: string;
  sections: ActiveLoanSection[];
}

// Closed Loans
export interface ClosedLoansData {
  totalUnitsUpDown: string;
  sections: ActiveLoanSection[]; // Same structure as active loans
}

// Locked Loans Expiration
export interface LockedLoanExpirationRow {
  category: string; // "> 30 days", "15-29 days", etc.
  units: string;
}

export interface LockedLoansData {
  totalUnitsUpDown: string;
  breakdown: LockedLoanExpirationRow[];
}

// Cycle Time Analysis
export interface CycleTimeStage {
  stage: string;
  avgDays: string;
  target: string;
  variance: string;
}

export interface CycleTimeByType {
  loanType: string;
  avgDays: string;
  trend: 'up' | 'down' | 'neutral';
  status: 'good' | 'warning' | 'bad';
}

export interface CycleTimeData {
  daysUpDown: string;
  avgDaysToFunding: string;
  target: string;
  variance: string;
  timeByStage: CycleTimeStage[];
  cycleTimeByType: CycleTimeByType[];
}

// Pull-Through
export interface PullThroughByType {
  loanType: string;
  value: string;
  companyAverage: string;
  status: 'above' | 'at' | 'below';
}

export interface PullThroughData {
  avgPercentUpDown: string;
  byType: PullThroughByType[];
  fallout: {
    withdrawn: string;
    denied: string;
  };
}

// Credit Pulls
export interface CreditPullByType {
  loanType: string;
  mtdUnits: string;
  monthUnits: string;
}

export interface CreditPullsData {
  unitsUpDown: string;
  byType: CreditPullByType[];
}

// Complete Business Overview Data
export interface BusinessOverviewData {
  kpis: KPIMetric[];
  activeLoans: ActiveLoansData;
  closedLoans: ClosedLoansData;
  lockedLoans: LockedLoansData;
  cycleTime: CycleTimeData;
  pullThrough: PullThroughData;
  creditPulls: CreditPullsData;
}

