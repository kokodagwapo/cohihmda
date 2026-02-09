/**
 * Widget definitions for Credit Risk data source.
 *
 * Matches CreditRiskManagement.tsx layout:
 * - 6 KPIs (Units, Volume, WAC, WA FICO, WA LTV, WA DTI)
 * - 3 distribution charts (FICO, LTV, DTI)
 * - Loan Mix tabbed table (Loan Type / Loan Purpose / Occupancy)
 */

import type { WidgetDefinition, KPIData, DistributionData, TabbedTableData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { DistributionBars } from '../components/DistributionBars';
import { TabbedTableContainer } from '../components/TabbedTableContainer';

// ---------------------------------------------------------------------------
// Source shape (matches useCreditRiskData return → CreditRiskData)
// ---------------------------------------------------------------------------

interface DistributionBucket {
  range: string;
  rangeLabel: string;
  units: number;
  volume: number;
  percentage: number;
  sortOrder: number;
}

interface LoanMixRow {
  category: string;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
}

interface CreditRiskSource {
  kpis: {
    units: number;
    volume: number;
    wac: number;
    waFico: number;
    waLtv: number;
    waDti: number;
  };
  ficoDistribution: DistributionBucket[];
  ltvDistribution: DistributionBucket[];
  dtiDistribution: DistributionBucket[];
  loanMixByType: LoanMixRow[];
  loanMixByPurpose: LoanMixRow[];
  loanMixByOccupancy: LoanMixRow[];
  creditRiskStory: {
    largestLoanType: { category: string; volumePercent: number };
    largestLoanPurpose: { category: string; volumePercent: number };
    largestOccupancy: { category: string; volumePercent: number };
    conventionalQualifiedPercent: number;
    governmentQualifiedPercent: number;
  };
}

function cr(raw: unknown): CreditRiskSource {
  return raw as CreditRiskSource;
}

// ---------------------------------------------------------------------------
// KPI Widgets (data is in `kpis` property, NOT `totals`)
// ---------------------------------------------------------------------------

export const creditRiskUnits: WidgetDefinition<KPIData> = {
  id: 'credit-risk-units',
  name: 'CR Units',
  description: 'Total loans in credit risk view',
  category: 'kpi',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => ({
    value: cr(raw).kpis?.units ?? 0,
    label: 'Units',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const creditRiskVolume: WidgetDefinition<KPIData> = {
  id: 'credit-risk-volume',
  name: 'CR Volume',
  description: 'Total volume in credit risk view',
  category: 'kpi',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => ({
    value: cr(raw).kpis?.volume ?? 0,
    label: 'Volume',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const creditRiskWAC: WidgetDefinition<KPIData> = {
  id: 'credit-risk-wac',
  name: 'CR WAC',
  description: 'Weighted average coupon',
  category: 'kpi',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => ({
    value: cr(raw).kpis?.wac ?? 0,
    label: 'WAC',
    format: 'ratio',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const creditRiskWAFICO: WidgetDefinition<KPIData> = {
  id: 'credit-risk-wa-fico',
  name: 'CR WA FICO',
  description: 'Weighted average FICO',
  category: 'kpi',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => ({
    value: cr(raw).kpis?.waFico ?? 0,
    label: 'WA FICO',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const creditRiskWALTV: WidgetDefinition<KPIData> = {
  id: 'credit-risk-wa-ltv',
  name: 'CR WA LTV',
  description: 'Weighted average LTV',
  category: 'kpi',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => ({
    value: cr(raw).kpis?.waLtv ?? 0,
    label: 'WA LTV',
    format: 'percent',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

export const creditRiskWADTI: WidgetDefinition<KPIData> = {
  id: 'credit-risk-wa-dti',
  name: 'CR WA DTI',
  description: 'Weighted average DTI',
  category: 'kpi',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => ({
    value: cr(raw).kpis?.waDti ?? 0,
    label: 'WA DTI',
    format: 'percent',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Distribution Widgets (data uses `units` and `percentage`, not `count/total`)
// ---------------------------------------------------------------------------

export const creditRiskFICODistribution: WidgetDefinition<DistributionData> = {
  id: 'credit-risk-fico-distribution',
  name: 'FICO Distribution',
  description: 'Distribution of loans by FICO score range',
  category: 'distribution',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => {
    const d = cr(raw);
    const totalUnits = (d.ficoDistribution ?? []).reduce((s, b) => s + b.units, 0);
    return {
      title: 'FICO Distribution',
      bars: (d.ficoDistribution ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          label: item.rangeLabel || item.range,
          value: item.units,
          total: totalUnits,
          color: 'bg-blue-500',
        })),
    };
  },
  defaultSize: { w: 220, h: 130 },
  minSize: { w: 120, h: 70 },
  component: DistributionBars,
};

export const creditRiskLTVDistribution: WidgetDefinition<DistributionData> = {
  id: 'credit-risk-ltv-distribution',
  name: 'LTV Distribution',
  description: 'Distribution of loans by LTV range',
  category: 'distribution',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => {
    const d = cr(raw);
    const totalUnits = (d.ltvDistribution ?? []).reduce((s, b) => s + b.units, 0);
    return {
      title: 'LTV Distribution',
      bars: (d.ltvDistribution ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          label: item.rangeLabel || item.range,
          value: item.units,
          total: totalUnits,
          color: 'bg-emerald-500',
        })),
    };
  },
  defaultSize: { w: 220, h: 130 },
  minSize: { w: 120, h: 70 },
  component: DistributionBars,
};

export const creditRiskDTIDistribution: WidgetDefinition<DistributionData> = {
  id: 'credit-risk-dti-distribution',
  name: 'DTI Distribution',
  description: 'Distribution of loans by DTI range',
  category: 'distribution',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => {
    const d = cr(raw);
    const totalUnits = (d.dtiDistribution ?? []).reduce((s, b) => s + b.units, 0);
    return {
      title: 'DTI Distribution',
      bars: (d.dtiDistribution ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => ({
          label: item.rangeLabel || item.range,
          value: item.units,
          total: totalUnits,
          color: 'bg-amber-500',
        })),
    };
  },
  defaultSize: { w: 220, h: 130 },
  minSize: { w: 120, h: 70 },
  component: DistributionBars,
};

// ---------------------------------------------------------------------------
// Loan Mix Tabbed Table (3 tabs: Loan Type / Loan Purpose / Occupancy)
// ---------------------------------------------------------------------------

function buildLoanMixTable(data: LoanMixRow[], tabLabel: string): TableData {
  const columns: TableColumn[] = [
    { key: 'category', label: tabLabel, sortable: true },
    { key: 'units', label: 'Units', sortable: true, align: 'right', format: 'number' },
    { key: 'unitsPercent', label: 'Units %', sortable: true, align: 'right', format: 'percent' },
    { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
    { key: 'volumePercent', label: 'Vol %', sortable: true, align: 'right', format: 'percent' },
    { key: 'wac', label: 'WAC', sortable: true, align: 'right', format: 'ratio' },
    { key: 'waFico', label: 'WA FICO', sortable: true, align: 'right', format: 'number' },
    { key: 'waLtv', label: 'WA LTV', sortable: true, align: 'right', format: 'percent' },
    { key: 'waDti', label: 'WA DTI', sortable: true, align: 'right', format: 'percent' },
  ];

  const rows: Record<string, unknown>[] = (data ?? []).map((r) => ({
    category: r.category,
    units: r.units,
    unitsPercent: r.unitsPercent,
    volume: r.volume,
    volumePercent: r.volumePercent,
    wac: r.wac,
    waFico: Math.round(r.waFico),
    waLtv: r.waLtv,
    waDti: r.waDti,
  }));

  return { title: tabLabel, columns, rows, stickyFirstColumn: true };
}

const creditRiskLoanMixTable: WidgetDefinition<TabbedTableData> = {
  id: 'credit-risk-loan-mix-table',
  name: 'Loan Mix',
  description: 'Loan mix breakdown by type, purpose, and occupancy',
  category: 'table',
  group: 'Credit Risk',
  dataSource: 'credit-risk',
  dataSelector: (raw) => {
    const d = cr(raw);
    return {
      title: 'Loan Mix',
      tabs: [
        { id: 'type', label: 'Loan Type', table: buildLoanMixTable(d.loanMixByType, 'Loan Type') },
        { id: 'purpose', label: 'Loan Purpose', table: buildLoanMixTable(d.loanMixByPurpose, 'Purpose') },
        { id: 'occupancy', label: 'Occupancy', table: buildLoanMixTable(d.loanMixByOccupancy, 'Occupancy') },
      ],
      defaultTab: 'type',
    };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: TabbedTableContainer as any,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const creditRiskWidgets: WidgetDefinition[] = [
  creditRiskUnits,
  creditRiskVolume,
  creditRiskWAC,
  creditRiskWAFICO,
  creditRiskWALTV,
  creditRiskWADTI,
  creditRiskFICODistribution,
  creditRiskLTVDistribution,
  creditRiskDTIDistribution,
  creditRiskLoanMixTable,
];
