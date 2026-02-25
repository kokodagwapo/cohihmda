/**
 * Widget definitions for Pricing Dashboard data source.
 *
 * Matches PricingDashboardView layout:
 * - 4 KPIs (Pipeline Units, Pipeline Volume, Pipeline Margin, Pricing $)
 * - 4 separate tables: Loan Officer Report, Loan Officer Detail, Entity Report, Entity Detail
 */

import type { WidgetDefinition, KPIData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { DataTable } from '../components/DataTable';
import type { PricingReportRow, PricingDetailRow } from '@/hooks/usePricingDashboardData';

// ---------------------------------------------------------------------------
// Source shape (matches usePricingDashboardWorkbenchData return)
// ---------------------------------------------------------------------------

interface PricingDashboardSource {
  kpis: {
    units: number;
    volume: number;
    pipelineMargin: number;
    pricingDollars: number;
    labelPrefix: string;
  } | null;
  loanOfficerReport: { rows: PricingReportRow[]; totals: Partial<PricingReportRow> };
  entityReport: { rows: PricingReportRow[]; totals: Partial<PricingReportRow> };
  loanOfficerDetail: { rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> };
  entityDetail: { rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> };
  loading: boolean;
  error: string | null;
}

function t(raw: unknown): PricingDashboardSource {
  return raw as PricingDashboardSource;
}

// ---------------------------------------------------------------------------
// Report table columns (shared by Loan Officer Report and Entity Report)
// ---------------------------------------------------------------------------

const REPORT_COLUMNS: TableColumn[] = [
  { key: 'entityName', label: 'Entity', sortable: true },
  { key: 'actorName', label: 'Actor', sortable: true },
  { key: 'units', label: 'Units', sortable: true, align: 'right', format: 'number' },
  { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
  { key: 'loanPricingDollars', label: 'Loan Pricing $', sortable: true, align: 'right', format: 'currency' },
  { key: 'pricingMargin', label: 'Pricing Margin', sortable: true, align: 'right', format: 'number' },
  { key: 'cdLenderCredits', label: 'CD Lender Credits', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceSellAmount', label: 'Purchase Advice Sell Amount', sortable: true, align: 'right', format: 'currency' },
  { key: 'line800TotalBorrowerPaidAmount', label: 'Line 800 Borrower Paid', sortable: true, align: 'right', format: 'currency' },
  { key: 'feesAppraisalFeeBorr', label: 'Fees Appraisal Fee Borr', sortable: true, align: 'right', format: 'currency' },
  { key: 'line800TotalSellerPaidAmount', label: 'Line 800 Seller Amount', sortable: true, align: 'right', format: 'currency' },
  { key: 'feesInterestBorr', label: 'Fees Interest Borr', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdvExpectedIntPymtFromInvestor', label: 'Purchase Adv Expected Int', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceExpctdPayout1Amt', label: 'Payout 1 Amt', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceExpctdPayout2Amt', label: 'Payout 2 Amt', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceExpctdPayout3Amt', label: 'Payout 3 Amt', sortable: true, align: 'right', format: 'currency' },
  { key: 'lenderCredits', label: 'Lender Credits', sortable: true, align: 'right', format: 'currency' },
];

// ---------------------------------------------------------------------------
// Detail table columns (shared by Loan Officer Detail and Entity Detail)
// ---------------------------------------------------------------------------

const DETAIL_COLUMNS: TableColumn[] = [
  { key: 'entityName', label: 'Entity', sortable: true },
  { key: 'actorName', label: 'Actor', sortable: true },
  { key: 'loanNumber', label: 'Loan Number', sortable: true },
  { key: 'applicationDate', label: 'Application Date', sortable: true },
  { key: 'lockExpirationDate', label: 'Lock Expiration Date', sortable: true },
  { key: 'fundingDate', label: 'Funding Date', sortable: true },
  { key: 'closingDate', label: 'Closing Date', sortable: true },
  { key: 'currentLoanStatus', label: 'Current Loan Status', sortable: true },
  { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
  { key: 'loanPricingDollars', label: 'Loan Pricing $', sortable: true, align: 'right', format: 'currency' },
  { key: 'pricingMargin', label: 'Pricing Margin', sortable: true, align: 'right', format: 'number' },
  { key: 'cdLenderCredits', label: 'CD Lender Credits', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceSellAmount', label: 'Purchase Advice Sell Amount', sortable: true, align: 'right', format: 'currency' },
  { key: 'line800TotalBorrowerPaidAmount', label: 'Line 800 Borrower Paid', sortable: true, align: 'right', format: 'currency' },
  { key: 'feesAppraisalFeeBorr', label: 'Fees Appraisal Fee Borr', sortable: true, align: 'right', format: 'currency' },
  { key: 'line800TotalSellerPaidAmount', label: 'Line 800 Seller Amount', sortable: true, align: 'right', format: 'currency' },
  { key: 'feesInterestBorr', label: 'Fees Interest Borr', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdvExpectedIntPymtFromInvestor', label: 'Purchase Adv Expected Int', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceExpctdPayout1Amt', label: 'Payout 1 Amt', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceExpctdPayout2Amt', label: 'Payout 2 Amt', sortable: true, align: 'right', format: 'currency' },
  { key: 'purchaseAdviceExpctdPayout3Amt', label: 'Payout 3 Amt', sortable: true, align: 'right', format: 'currency' },
  { key: 'lenderCredits', label: 'Lender Credits', sortable: true, align: 'right', format: 'currency' },
];

function reportRowsToTableRows(rows: PricingReportRow[], totals: Partial<PricingReportRow>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (rows.length > 0 && Object.keys(totals).length > 0) {
    out.push({ ...totals, entityName: 'Totals', actorName: '' });
  }
  rows.forEach((r) => out.push({ ...r }));
  return out;
}

function detailRowsToTableRows(rows: PricingDetailRow[], totals: Partial<PricingDetailRow>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (rows.length > 0 && Object.keys(totals).length > 0) {
    out.push({ ...totals, entityName: 'Totals', actorName: '', loanNumber: '', applicationDate: '', lockExpirationDate: '', fundingDate: '', closingDate: '', currentLoanStatus: '' });
  }
  rows.forEach((r) => out.push({ ...r }));
  return out;
}

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const pdUnits: WidgetDefinition<KPIData> = {
  id: 'pricing-dashboard-units',
  name: 'Pipeline Units',
  description: 'Active pipeline units',
  category: 'kpi',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const prefix = d.kpis?.labelPrefix ?? 'Active Locked';
    return {
      value: d.kpis?.units ?? 0,
      label: `${prefix} Pipeline Units`,
      format: 'number',
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
  config: { color: 'blue' },
};

const pdVolume: WidgetDefinition<KPIData> = {
  id: 'pricing-dashboard-volume',
  name: 'Pipeline Volume',
  description: 'Active pipeline volume',
  category: 'kpi',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const prefix = d.kpis?.labelPrefix ?? 'Active Locked';
    return {
      value: d.kpis?.volume ?? 0,
      label: `${prefix} Pipeline Volume`,
      format: 'currency',
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
  config: { color: 'violet' },
};

const pdMargin: WidgetDefinition<KPIData> = {
  id: 'pricing-dashboard-margin',
  name: 'Pipeline Margin',
  description: 'Pipeline margin',
  category: 'kpi',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const prefix = d.kpis?.labelPrefix ?? 'Active Locked';
    return {
      value: d.kpis?.pipelineMargin ?? 0,
      label: `${prefix} Pipeline Margin`,
      format: 'number',
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
  config: { color: 'amber' },
};

const pdPricingDollars: WidgetDefinition<KPIData> = {
  id: 'pricing-dashboard-pricing-dollars',
  name: 'Pricing $',
  description: 'Pricing dollars',
  category: 'kpi',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const prefix = d.kpis?.labelPrefix ?? 'Active Locked';
    return {
      value: d.kpis?.pricingDollars ?? 0,
      label: `${prefix} Pricing $`,
      format: 'currency',
    };
  },
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
  config: { color: 'emerald' },
};

// ---------------------------------------------------------------------------
// Table Widgets (4 separate tables)
// ---------------------------------------------------------------------------

const loanOfficerReportTable: WidgetDefinition<TableData> = {
  id: 'pricing-dashboard-lo-report',
  name: 'Loan Officer Report',
  description: 'Report by loan officer',
  category: 'table',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const { rows, totals } = d.loanOfficerReport;
    return {
      title: 'Loan Officer Report',
      columns: REPORT_COLUMNS,
      rows: reportRowsToTableRows(rows, totals),
      stickyFirstColumn: true,
    };
  },
  defaultSize: { w: 520, h: 280 },
  minSize: { w: 280, h: 160 },
  component: DataTable,
};

const loanOfficerDetailTable: WidgetDefinition<TableData> = {
  id: 'pricing-dashboard-lo-detail',
  name: 'Loan Officer Detail',
  description: 'Detail rows by loan officer',
  category: 'table',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const { rows, totals } = d.loanOfficerDetail;
    return {
      title: 'Loan Officer Detail',
      columns: DETAIL_COLUMNS,
      rows: detailRowsToTableRows(rows, totals),
      stickyFirstColumn: true,
    };
  },
  defaultSize: { w: 520, h: 280 },
  minSize: { w: 280, h: 160 },
  component: DataTable,
};

const entityReportTable: WidgetDefinition<TableData> = {
  id: 'pricing-dashboard-entity-report',
  name: 'Entity Report',
  description: 'Report by entity (branch, channel, etc.)',
  category: 'table',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const { rows, totals } = d.entityReport;
    return {
      title: 'Entity Report',
      columns: REPORT_COLUMNS,
      rows: reportRowsToTableRows(rows, totals),
      stickyFirstColumn: true,
    };
  },
  defaultSize: { w: 520, h: 280 },
  minSize: { w: 280, h: 160 },
  component: DataTable,
};

const entityDetailTable: WidgetDefinition<TableData> = {
  id: 'pricing-dashboard-entity-detail',
  name: 'Entity Detail',
  description: 'Detail rows by entity',
  category: 'table',
  group: 'Pricing Dashboard',
  dataSource: 'pricing-dashboard',
  dataSelector: (raw) => {
    const d = t(raw);
    const { rows, totals } = d.entityDetail;
    return {
      title: 'Entity Detail',
      columns: DETAIL_COLUMNS,
      rows: detailRowsToTableRows(rows, totals),
      stickyFirstColumn: true,
    };
  },
  defaultSize: { w: 520, h: 280 },
  minSize: { w: 280, h: 160 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const pricingDashboardWidgets: WidgetDefinition[] = [
  pdUnits,
  pdVolume,
  pdMargin,
  pdPricingDollars,
  loanOfficerReportTable,
  loanOfficerDetailTable,
  entityReportTable,
  entityDetailTable,
];
