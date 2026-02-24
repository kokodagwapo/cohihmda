/**
 * Widget definitions for Company Scorecard data source.
 *
 * These extract individual KPIs, charts, and tables from the
 * ScorecardData returned by useCompanyScorecardData.
 */

import type { WidgetDefinition, KPIData, ChartData, TableData, TabbedTableData } from './types';
import { KPICard } from '../components/KPICard';
import { ChartCard } from '../components/ChartCard';
import { DataTable } from '../components/DataTable';
import { TabbedTableContainer } from '../components/TabbedTableContainer';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

interface BranchRow {
  name: string;
  totalLoansWithRespa: number;
  originatedLoans: number;
  volume: number;
  tieringVolume: number;
  pullThroughRate: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  wac: number;
  revenue: number;
  govtUnits: number;
  purchaseUnits: number;
  falloutWithdrawn: number;
  falloutDenied: number;
  withdrawnVolume: number;
  withdrawnProformaRevenue: number;
  deniedVolume: number;
  [key: string]: unknown;
}

interface ScorecardSource {
  totals: {
    totalLoansWithRespa: number;
    totalVolume: number;
    originatedLoans: number;
    originatedVolume: number;
    originatedRevenue: number;
    totalRevenue: number;
    pullThroughRate: number;
    avgCycleTime: number;
    waFico: number;
    waLtv: number;
    waDti: number;
    wac: number;
    loansStarted: number;
    govtUnits: number;
    purchaseUnits: number;
    falloutWithdrawn: number;
    falloutDenied: number;
    withdrawnVolume: number;
    deniedVolume: number;
    [key: string]: number;
  };
  byBranch: BranchRow[];
  byLoanOfficer: BranchRow[];
}

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

export const companyScorecardUnits: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-units',
  name: 'Total Units',
  description: 'Total loan applications (with RESPA)',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      value: d.totals.totalLoansWithRespa,
      label: 'Units',
      format: 'number' as const,
      subtitle: `of ${d.totals.loansStarted.toLocaleString('en-US')} started`,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
  configurableProperties: [
    { key: 'format', label: 'Number format', type: 'select', default: 'number', options: [
      { value: 'number', label: 'Number' },
      { value: 'currency', label: 'Currency' },
      { value: 'percent', label: 'Percent' },
    ] },
  ],
};

export const companyScorecardVolume: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-volume',
  name: 'Total Volume',
  description: 'Total loan volume (applications taken)',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      value: d.totals.totalVolume,
      label: 'Volume',
      format: 'currency' as const,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
  configurableProperties: [
    { key: 'format', label: 'Number format', type: 'select', default: 'currency', options: [
      { value: 'number', label: 'Number' },
      { value: 'currency', label: 'Currency' },
      { value: 'percent', label: 'Percent' },
    ] },
  ],
};

export const companyScorecardAvgLoanSize: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-avg-loan-size',
  name: 'Average Loan Size',
  description: 'Average loan amount per application',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    const avg = d.totals.totalLoansWithRespa > 0
      ? d.totals.totalVolume / d.totals.totalLoansWithRespa
      : 0;
    return {
      value: avg,
      label: 'Avg Loan Size',
      format: 'currency' as const,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const companyScorecardWAC: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-wac',
  name: 'Weighted Avg Coupon',
  description: 'Weighted average coupon rate',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      value: d.totals.wac,
      label: 'WAC',
      format: 'percent' as const,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const companyScorecardWAFICO: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-wa-fico',
  name: 'WA FICO',
  description: 'Weighted average FICO score',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      value: d.totals.waFico,
      label: 'WA FICO',
      format: 'number' as const,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const companyScorecardWALTV: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-wa-ltv',
  name: 'WA LTV',
  description: 'Weighted average loan-to-value ratio',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      value: d.totals.waLtv,
      label: 'WA LTV',
      format: 'percent' as const,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const companyScorecardWADTI: WidgetDefinition<KPIData> = {
  id: 'company-scorecard-wa-dti',
  name: 'WA DTI',
  description: 'Weighted average debt-to-income ratio',
  category: 'kpi',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      value: d.totals.waDti,
      label: 'WA DTI',
      format: 'percent' as const,
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Chart Widgets
// ---------------------------------------------------------------------------

export const companyScorecardVolumeByBranch: WidgetDefinition<ChartData> = {
  id: 'company-scorecard-volume-by-branch',
  name: 'Volume by Branch',
  description: 'Originated volume by top branches',
  category: 'chart',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    const chartData = (d.byBranch ?? []).slice(0, 10).map((b) => ({
      name: b.name.length > 12 ? b.name.substring(0, 12) + '…' : b.name,
      volume: Math.round(b.tieringVolume / 1_000_000),
    }));
    return {
      title: 'Volume by Branch ($M)',
      chartType: 'bar' as const,
      data: chartData,
      series: [{ dataKey: 'volume', name: 'Volume ($M)', color: '#3b82f6' }],
      xAxisKey: 'name',
    };
  },
  defaultSize: { w: 250, h: 160 },
  minSize: { w: 130, h: 80 },
  component: ChartCard,
  configurableProperties: [
    { key: 'chartType', label: 'Chart type', type: 'select', default: 'bar', options: [
      { value: 'bar', label: 'Bar' },
      { value: 'line', label: 'Line' },
      { value: 'area', label: 'Area' },
      { value: 'pie', label: 'Pie' },
    ] },
  ],
};

export const companyScorecardPullThroughByBranch: WidgetDefinition<ChartData> = {
  id: 'company-scorecard-pullthrough-by-branch',
  name: 'Pull-Through by Branch',
  description: 'Pull-through rate by top branches',
  category: 'chart',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    const chartData = (d.byBranch ?? []).slice(0, 10).map((b) => ({
      name: b.name.length > 12 ? b.name.substring(0, 12) + '…' : b.name,
      pullThrough: b.pullThroughRate,
    }));
    return {
      title: 'Pull-Through Rate by Branch (%)',
      chartType: 'bar' as const,
      data: chartData,
      series: [{ dataKey: 'pullThrough', name: 'Pull-Through %', color: '#10b981' }],
      xAxisKey: 'name',
    };
  },
  defaultSize: { w: 250, h: 160 },
  minSize: { w: 130, h: 80 },
  component: ChartCard,
};

// ---------------------------------------------------------------------------
// Summary + Detail Tabbed Table Widget
// ---------------------------------------------------------------------------

/**
 * Build summary tier-breakdown rows from branch data.
 * Mirrors the SummaryTable logic in CompanyScorecard.tsx:
 * rows = metrics, columns = Totals / Top Tier / Second Tier / Bottom Tier.
 */
function buildSummaryTableData(d: ScorecardSource): TableData {
  const branches = d.byBranch ?? [];
  const t = d.totals;

  // Filter active branches
  const active = branches.filter(
    (b) => b.totalLoansWithRespa > 0 || b.originatedLoans > 0 || b.tieringVolume > 0,
  );
  const sorted = [...active].sort((a, b) => b.tieringVolume - a.tieringVolume);
  const totalVol = sorted.reduce((s, b) => s + b.tieringVolume, 0);

  // Assign tiers (cumulative-above method matching Qlik)
  const topTier: BranchRow[] = [];
  const secondTier: BranchRow[] = [];
  const bottomTier: BranchRow[] = [];
  let cumBefore = 0;
  for (const br of sorted) {
    const pct = totalVol > 0 ? cumBefore / totalVol : 0;
    if (pct <= 0.5) topTier.push(br);
    else if (pct <= 0.8) secondTier.push(br);
    else bottomTier.push(br);
    cumBefore += br.tieringVolume;
  }

  const sum = (arr: BranchRow[], k: keyof BranchRow) =>
    arr.reduce((s, b) => s + (typeof b[k] === 'number' ? (b[k] as number) : 0), 0);
  const avg = (arr: BranchRow[], k: keyof BranchRow) =>
    arr.length > 0 ? sum(arr, k) / arr.length : 0;

  const fmtN = (v: number) => v;
  const fmtP = (v: number) => v;
  const pctOf = (num: number, den: number) => (den > 0 ? (num / den) * 100 : 0);

  // Build rows – each row is a metric with values per tier
  const columns: import('./types').TableColumn[] = [
    { key: 'metric', label: 'Metric', sortable: false },
    { key: 'totals', label: 'Totals', sortable: false, align: 'right' as const },
    {
      key: 'topTier',
      label: 'Top Tier',
      sortable: false,
      align: 'right' as const,
      highlight: 'bg-teal-600/10',
    },
    {
      key: 'secondTier',
      label: 'Second Tier',
      sortable: false,
      align: 'right' as const,
      highlight: 'bg-emerald-500/10',
    },
    {
      key: 'bottomTier',
      label: 'Bottom Tier',
      sortable: false,
      align: 'right' as const,
      highlight: 'bg-red-500/10',
    },
  ];

  const rows: Record<string, unknown>[] = [
    // Branch Count
    { metric: 'Branch Count', totals: sorted.length, topTier: topTier.length, secondTier: secondTier.length, bottomTier: bottomTier.length },
    // Section: Applications Taken
    { _sectionHeader: 'Applications Taken' },
    { metric: 'Units', totals: t.totalLoansWithRespa, topTier: sum(topTier, 'totalLoansWithRespa'), secondTier: sum(secondTier, 'totalLoansWithRespa'), bottomTier: sum(bottomTier, 'totalLoansWithRespa') },
    { metric: 'Volume', totals: t.totalVolume, topTier: sum(topTier, 'volume'), secondTier: sum(secondTier, 'volume'), bottomTier: sum(bottomTier, 'volume') },
    { metric: 'WAC', totals: +(t.wac || 0).toFixed(3), topTier: +avg(topTier, 'wac').toFixed(3), secondTier: +avg(secondTier, 'wac').toFixed(3), bottomTier: +avg(bottomTier, 'wac').toFixed(3) },
    // Section: Originated Totals
    { _sectionHeader: 'Originated Totals' },
    { metric: 'Originated Units', totals: t.originatedLoans, topTier: sum(topTier, 'originatedLoans'), secondTier: sum(secondTier, 'originatedLoans'), bottomTier: sum(bottomTier, 'originatedLoans') },
    {
      metric: 'Originated Units %',
      totals: +pctOf(t.originatedLoans, t.totalLoansWithRespa).toFixed(1),
      topTier: +pctOf(sum(topTier, 'originatedLoans'), sum(topTier, 'totalLoansWithRespa')).toFixed(1),
      secondTier: +pctOf(sum(secondTier, 'originatedLoans'), sum(secondTier, 'totalLoansWithRespa')).toFixed(1),
      bottomTier: +pctOf(sum(bottomTier, 'originatedLoans'), sum(bottomTier, 'totalLoansWithRespa')).toFixed(1),
    },
    { metric: 'Originated Volume $', totals: t.originatedVolume, topTier: sum(topTier, 'volume'), secondTier: sum(secondTier, 'volume'), bottomTier: sum(bottomTier, 'volume') },
    { metric: 'Originated Revenue $', totals: t.originatedRevenue, topTier: sum(topTier, 'revenue'), secondTier: sum(secondTier, 'revenue'), bottomTier: sum(bottomTier, 'revenue') },
    { metric: "Gov't Originated Units", totals: t.govtUnits, topTier: sum(topTier, 'govtUnits'), secondTier: sum(secondTier, 'govtUnits'), bottomTier: sum(bottomTier, 'govtUnits') },
    {
      metric: "Gov't Originated %",
      totals: +pctOf(t.govtUnits, t.originatedLoans).toFixed(1),
      topTier: +pctOf(sum(topTier, 'govtUnits'), sum(topTier, 'originatedLoans')).toFixed(1),
      secondTier: +pctOf(sum(secondTier, 'govtUnits'), sum(secondTier, 'originatedLoans')).toFixed(1),
      bottomTier: +pctOf(sum(bottomTier, 'govtUnits'), sum(bottomTier, 'originatedLoans')).toFixed(1),
    },
    { metric: 'Purchase Originated Units', totals: t.purchaseUnits, topTier: sum(topTier, 'purchaseUnits'), secondTier: sum(secondTier, 'purchaseUnits'), bottomTier: sum(bottomTier, 'purchaseUnits') },
    {
      metric: 'Purchase Originated %',
      totals: +pctOf(t.purchaseUnits, t.originatedLoans).toFixed(1),
      topTier: +pctOf(sum(topTier, 'purchaseUnits'), sum(topTier, 'originatedLoans')).toFixed(1),
      secondTier: +pctOf(sum(secondTier, 'purchaseUnits'), sum(secondTier, 'originatedLoans')).toFixed(1),
      bottomTier: +pctOf(sum(bottomTier, 'purchaseUnits'), sum(bottomTier, 'originatedLoans')).toFixed(1),
    },
    { metric: 'Originated WAC', totals: +(t.wac || 0).toFixed(3), topTier: +avg(topTier, 'wac').toFixed(3), secondTier: +avg(secondTier, 'wac').toFixed(3), bottomTier: +avg(bottomTier, 'wac').toFixed(3) },
    { metric: 'Originated WA FICO', totals: Math.round(t.waFico), topTier: Math.round(avg(topTier, 'waFico')), secondTier: Math.round(avg(secondTier, 'waFico')), bottomTier: Math.round(avg(bottomTier, 'waFico')) },
    { metric: 'Originated WA LTV', totals: +avg(sorted, 'waLtv').toFixed(1), topTier: +avg(topTier, 'waLtv').toFixed(1), secondTier: +avg(secondTier, 'waLtv').toFixed(1), bottomTier: +avg(bottomTier, 'waLtv').toFixed(1) },
    { metric: 'Originated WA DTI', totals: +avg(sorted, 'waDti').toFixed(1), topTier: +avg(topTier, 'waDti').toFixed(1), secondTier: +avg(secondTier, 'waDti').toFixed(1), bottomTier: +avg(bottomTier, 'waDti').toFixed(1) },
    // Section: Withdrawn
    { _sectionHeader: 'Withdrawn Totals' },
    { metric: 'Withdrawn Units', totals: t.falloutWithdrawn, topTier: sum(topTier, 'falloutWithdrawn'), secondTier: sum(secondTier, 'falloutWithdrawn'), bottomTier: sum(bottomTier, 'falloutWithdrawn') },
    { metric: 'Withdrawn Volume $', totals: t.withdrawnVolume, topTier: sum(topTier, 'withdrawnVolume'), secondTier: sum(secondTier, 'withdrawnVolume'), bottomTier: sum(bottomTier, 'withdrawnVolume') },
    // Section: Denied
    { _sectionHeader: 'Denied Totals' },
    { metric: 'Denied Units', totals: t.falloutDenied, topTier: sum(topTier, 'falloutDenied'), secondTier: sum(secondTier, 'falloutDenied'), bottomTier: sum(bottomTier, 'falloutDenied') },
    { metric: 'Denied Volume $', totals: t.deniedVolume, topTier: sum(topTier, 'deniedVolume'), secondTier: sum(secondTier, 'deniedVolume'), bottomTier: sum(bottomTier, 'deniedVolume') },
  ];

  return { title: 'Summary by Tier', columns, rows, stickyFirstColumn: true };
}

function buildDetailTableData(d: ScorecardSource): TableData {
  const rows = (d.byBranch ?? []).map((b) => ({
    name: b.name,
    units: b.totalLoansWithRespa,
    volume: b.tieringVolume,
    pullThrough: b.pullThroughRate,
    waFico: b.waFico,
    waLtv: b.waLtv,
    waDti: b.waDti,
    wac: b.wac,
    revenue: b.revenue,
  }));
  return {
    title: 'Detail by Branch',
    columns: [
      { key: 'name', label: 'Branch', sortable: true },
      { key: 'units', label: 'Units', sortable: true, format: 'number' as const },
      { key: 'volume', label: 'Volume', sortable: true, format: 'currency' as const },
      { key: 'pullThrough', label: 'Pull-Through %', sortable: true, format: 'percent' as const },
      { key: 'waFico', label: 'WA FICO', sortable: true, format: 'number' as const },
      { key: 'waLtv', label: 'WA LTV', sortable: true, format: 'percent' as const },
      { key: 'waDti', label: 'WA DTI', sortable: true, format: 'percent' as const },
      { key: 'wac', label: 'WAC', sortable: true, format: 'percent' as const },
      { key: 'revenue', label: 'Revenue', sortable: true, format: 'currency' as const },
    ],
    rows,
    stickyFirstColumn: true,
  };
}

export const companyScorecardTabbedTable: WidgetDefinition<TabbedTableData> = {
  id: 'company-scorecard-tabbed-table',
  name: 'Summary & Detail Tables',
  description: 'Tier summary and branch detail tables with tabs',
  category: 'table',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => {
    const d = raw as ScorecardSource;
    return {
      title: 'Company Scorecard',
      tabs: [
        { id: 'summary', label: 'Summary', table: buildSummaryTableData(d) },
        { id: 'detail', label: 'Detail by Branch', table: buildDetailTableData(d) },
      ],
      defaultTab: 'summary',
    };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: TabbedTableContainer as any,
};

/** @deprecated Use companyScorecardTabbedTable instead */
export const companyScorecardDetailTable: WidgetDefinition<TableData> = {
  id: 'company-scorecard-detail-table',
  name: 'Detail by Branch',
  description: 'Summary table of key metrics by branch',
  category: 'table',
  group: 'Company Scorecard',
  dataSource: 'company-scorecard',
  dataSelector: (raw) => buildDetailTableData(raw as ScorecardSource),
  defaultSize: { w: 500, h: 200 },
  minSize: { w: 250, h: 96 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// All Company Scorecard widgets
// ---------------------------------------------------------------------------

export const companyScorecardWidgets: WidgetDefinition[] = [
  companyScorecardUnits,
  companyScorecardVolume,
  companyScorecardAvgLoanSize,
  companyScorecardWAC,
  companyScorecardWAFICO,
  companyScorecardWALTV,
  companyScorecardWADTI,
  companyScorecardVolumeByBranch,
  companyScorecardPullThroughByBranch,
  companyScorecardTabbedTable,
  companyScorecardDetailTable, // kept for standalone use in catalog
];
