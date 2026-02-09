/**
 * Widget definitions for Operations Scorecard data source.
 *
 * Matches OperationScorecard.tsx layout:
 * - 7 KPIs (Actor Count, Units Output, Avg Days, % Approved, Cost/File, WA FICO, WA LTV)
 * - Summary table (15 metrics × 4 tier columns)
 * - Detail table (13 columns from actors[])
 */

import type { WidgetDefinition, KPIData, TabbedTableData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { TabbedTableContainer } from '../components/TabbedTableContainer';

// ---------------------------------------------------------------------------
// Source shape (matches useOperationsScorecardData return)
// ---------------------------------------------------------------------------

interface OperationsActor {
  name: string;
  units: number;
  volume: number;
  avgUnitsPerMonth: number;
  avgDays: number;
  loanComplexityScore: number;
  approvedPercent: number;
  deniedPercent: number;
  governmentPercent: number;
  purchasePercent: number;
  waFico: number;
  waLtv: number;
  ttsScore: number;
  tier: 'top' | 'second' | 'bottom';
}

interface OperationsTierSummary {
  count: number;
  units: number;
  unitsPercent: number;
  volume: number;
  loanComplexityScore: number;
  avgUnitsPerMonth: number;
  avgDays: number;
  compensation: string;
  costPerFile: string;
  approvedPercent: number;
  deniedPercent: number;
  governmentPercent: number;
  purchasePercent: number;
  waFico: number;
  waLtv: number;
  avgTtsScore: number;
}

interface OpsScorecardSource {
  actors: OperationsActor[];
  tierSummary: {
    top: OperationsTierSummary;
    second: OperationsTierSummary;
    bottom: OperationsTierSummary;
  };
  totals: OperationsTierSummary;
  companyAverages: { avgUnits: number; avgTurnTime: number; avgComplexity: number };
  weightConfig: { units: number; turnTime: number; complexity: number };
}

function t(raw: unknown): OpsScorecardSource {
  return raw as OpsScorecardSource;
}

const safeFixed = (v: number | undefined | null, d: number) =>
  v == null || isNaN(v) ? '-' : v.toFixed(d);

const fmtCurrency = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const opsActorCount: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-actor-count',
  name: 'Actor Count',
  description: 'Number of actors (processors/underwriters/closers)',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: t(raw).totals?.count ?? 0,
    label: 'Actor Count',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsUnitsOutput: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-units-output',
  name: 'Units Output',
  description: 'Total units output across all actors',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: t(raw).totals?.units ?? 0,
    label: 'Units Output',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsAvgDays: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-avg-days',
  name: 'Average Days',
  description: 'Average processing days',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: t(raw).totals?.avgDays ?? 0,
    label: 'Average Days',
    format: 'days',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsApprovedPct: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-approved-pct',
  name: '% Approved',
  description: 'Approval percentage',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: t(raw).totals?.approvedPercent ?? 0,
    label: '% Approved',
    format: 'percent',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsCostPerFile: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-cost-per-file',
  name: 'Cost per File',
  description: 'Average cost per file',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: 0,
    label: 'Cost per File',
    format: 'currency',
    subtitle: t(raw).totals?.costPerFile || '-',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsWaFico: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-wa-fico',
  name: 'WA FICO',
  description: 'Weighted average FICO score',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: t(raw).totals?.waFico ?? 0,
    label: 'WA FICO',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const opsWaLtv: WidgetDefinition<KPIData> = {
  id: 'ops-scorecard-wa-ltv',
  name: 'WA LTV',
  description: 'Weighted average LTV',
  category: 'kpi',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => ({
    value: t(raw).totals?.waLtv ?? 0,
    label: 'WA LTV',
    format: 'percent',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Summary Table (15 metrics × Totals / Top / Second / Bottom)
// ---------------------------------------------------------------------------

function buildOpsSummaryTable(d: OpsScorecardSource): TableData {
  const tot = d.totals;
  const top = d.tierSummary?.top;
  const sec = d.tierSummary?.second;
  const bot = d.tierSummary?.bottom;

  const columns: TableColumn[] = [
    { key: 'metric', label: 'Metric', sortable: false },
    { key: 'totals', label: 'Totals', sortable: false, align: 'right' },
    { key: 'topTier', label: 'Top Tier', sortable: false, align: 'right', highlight: 'bg-teal-600/10' },
    { key: 'secondTier', label: 'Second Tier', sortable: false, align: 'right', highlight: 'bg-emerald-500/10' },
    { key: 'bottomTier', label: 'Bottom Tier', sortable: false, align: 'right', highlight: 'bg-red-500/10' },
  ];

  const rows: Record<string, unknown>[] = [
    { metric: 'Actor Count', totals: tot?.count ?? 0, topTier: top?.count ?? 0, secondTier: sec?.count ?? 0, bottomTier: bot?.count ?? 0 },
    { metric: 'Units Output', totals: (tot?.units ?? 0).toLocaleString(), topTier: (top?.units ?? 0).toLocaleString(), secondTier: (sec?.units ?? 0).toLocaleString(), bottomTier: (bot?.units ?? 0).toLocaleString() },
    { metric: 'Units %', totals: '100.0', topTier: safeFixed(top?.unitsPercent, 1), secondTier: safeFixed(sec?.unitsPercent, 1), bottomTier: safeFixed(bot?.unitsPercent, 1) },
    { metric: 'Volume Output', totals: fmtCurrency(tot?.volume ?? 0), topTier: fmtCurrency(top?.volume ?? 0), secondTier: fmtCurrency(sec?.volume ?? 0), bottomTier: fmtCurrency(bot?.volume ?? 0) },
    { metric: 'Loan Complexity', totals: safeFixed(tot?.loanComplexityScore, 1), topTier: safeFixed(top?.loanComplexityScore, 1), secondTier: safeFixed(sec?.loanComplexityScore, 1), bottomTier: safeFixed(bot?.loanComplexityScore, 1) },
    { metric: 'Avg Units/Month', totals: safeFixed(tot?.avgUnitsPerMonth, 1), topTier: safeFixed(top?.avgUnitsPerMonth, 1), secondTier: safeFixed(sec?.avgUnitsPerMonth, 1), bottomTier: safeFixed(bot?.avgUnitsPerMonth, 1) },
    { metric: 'Average Days', totals: safeFixed(tot?.avgDays, 2), topTier: safeFixed(top?.avgDays, 2), secondTier: safeFixed(sec?.avgDays, 2), bottomTier: safeFixed(bot?.avgDays, 2) },
    { metric: 'Compensation $', totals: tot?.compensation ?? '-', topTier: top?.compensation ?? '-', secondTier: sec?.compensation ?? '-', bottomTier: bot?.compensation ?? '-' },
    { metric: 'Cost per File', totals: tot?.costPerFile ?? '-', topTier: top?.costPerFile ?? '-', secondTier: sec?.costPerFile ?? '-', bottomTier: bot?.costPerFile ?? '-' },
    { metric: '% Approved', totals: safeFixed(tot?.approvedPercent, 1), topTier: safeFixed(top?.approvedPercent, 1), secondTier: safeFixed(sec?.approvedPercent, 1), bottomTier: safeFixed(bot?.approvedPercent, 1) },
    { metric: '% Denied', totals: safeFixed(tot?.deniedPercent, 1), topTier: safeFixed(top?.deniedPercent, 1), secondTier: safeFixed(sec?.deniedPercent, 1), bottomTier: safeFixed(bot?.deniedPercent, 1) },
    { metric: 'Government %', totals: safeFixed(tot?.governmentPercent, 1), topTier: safeFixed(top?.governmentPercent, 1), secondTier: safeFixed(sec?.governmentPercent, 1), bottomTier: safeFixed(bot?.governmentPercent, 1) },
    { metric: 'Purchase %', totals: safeFixed(tot?.purchasePercent, 1), topTier: safeFixed(top?.purchasePercent, 1), secondTier: safeFixed(sec?.purchasePercent, 1), bottomTier: safeFixed(bot?.purchasePercent, 1) },
    { metric: 'WA FICO', totals: tot?.waFico ? Math.round(tot.waFico) : '-', topTier: top?.waFico ? Math.round(top.waFico) : '-', secondTier: sec?.waFico ? Math.round(sec.waFico) : '-', bottomTier: bot?.waFico ? Math.round(bot.waFico) : '-' },
    { metric: 'WA LTV', totals: safeFixed(tot?.waLtv, 1), topTier: safeFixed(top?.waLtv, 1), secondTier: safeFixed(sec?.waLtv, 1), bottomTier: safeFixed(bot?.waLtv, 1) },
  ];

  return { title: 'Summary by Tier', columns, rows, stickyFirstColumn: true };
}

// ---------------------------------------------------------------------------
// Detail Table (per-actor, 13 columns matching actual page)
// ---------------------------------------------------------------------------

function buildOpsDetailTable(d: OpsScorecardSource): TableData {
  const rows = (d.actors ?? []).map((a) => ({
    name: a.name,
    tier: a.tier === 'top' ? 'Top' : a.tier === 'second' ? '2nd' : 'Bottom',
    ttsScore: +(a.ttsScore ?? 0).toFixed(1),
    units: a.units ?? 0,
    volume: a.volume ?? 0,
    avgPerMonth: +(a.avgUnitsPerMonth ?? 0).toFixed(1),
    days: +(a.avgDays ?? 0).toFixed(1),
    complexity: +(a.loanComplexityScore ?? 0).toFixed(1),
    approved: +(a.approvedPercent ?? 0).toFixed(1),
    govt: +(a.governmentPercent ?? 0).toFixed(1),
    purchase: +(a.purchasePercent ?? 0).toFixed(1),
    fico: a.waFico ? Math.round(a.waFico) : 0,
    ltv: +(a.waLtv ?? 0).toFixed(1),
  }));

  return {
    title: 'Detail by Actor',
    columns: [
      { key: 'name', label: 'Actor', sortable: true },
      { key: 'tier', label: 'Tier', sortable: true, align: 'center' },
      { key: 'ttsScore', label: 'TTS Score', sortable: true, align: 'right', format: 'number' },
      { key: 'units', label: 'Units', sortable: true, align: 'right', format: 'number' },
      { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
      { key: 'avgPerMonth', label: 'Avg/Mo', sortable: true, align: 'right', format: 'number' },
      { key: 'days', label: 'Days', sortable: true, align: 'right', format: 'days' },
      { key: 'complexity', label: 'Complexity', sortable: true, align: 'right', format: 'number' },
      { key: 'approved', label: 'Approved %', sortable: true, align: 'right', format: 'percent' },
      { key: 'govt', label: 'Govt %', sortable: true, align: 'right', format: 'percent' },
      { key: 'purchase', label: 'Purch %', sortable: true, align: 'right', format: 'percent' },
      { key: 'fico', label: 'FICO', sortable: true, align: 'right', format: 'number' },
      { key: 'ltv', label: 'LTV', sortable: true, align: 'right', format: 'percent' },
    ],
    rows,
    stickyFirstColumn: true,
  };
}

// ---------------------------------------------------------------------------
// Tabbed Table (Summary + Detail)
// ---------------------------------------------------------------------------

const opsTabbedTable: WidgetDefinition<TabbedTableData> = {
  id: 'ops-scorecard-tabbed-table',
  name: 'Operations Scorecard Tables',
  description: 'Summary by tier and detail by actor with tabs',
  category: 'table',
  group: 'Operations Scorecard',
  dataSource: 'operations-scorecard',
  dataSelector: (raw) => {
    const d = t(raw);
    return {
      title: 'Operations Scorecard',
      tabs: [
        { id: 'summary', label: 'Summary', table: buildOpsSummaryTable(d) },
        { id: 'detail', label: 'Details', table: buildOpsDetailTable(d) },
      ],
      defaultTab: 'summary',
    };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: TabbedTableContainer as any,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const operationsScorecardWidgets: WidgetDefinition[] = [
  opsActorCount,
  opsUnitsOutput,
  opsAvgDays,
  opsApprovedPct,
  opsCostPerFile,
  opsWaFico,
  opsWaLtv,
  opsTabbedTable,
];
