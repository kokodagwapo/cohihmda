/**
 * Widget definitions for Sales Scorecard data source.
 *
 * Matches the actual SalesScorecard page layout:
 * - 3 sidebar KPIs (Top Tier Count, Total Revenue, Total Units)
 * - Additional KPIs (Pull-Through, Avg Turn Time, Revenue BPS, WA FICO, WA LTV, WA DTI)
 * - Summary table (28 metrics × 4 tier columns)
 * - Detail table (9 columns from actors[])
 */

import type { WidgetDefinition, KPIData, TabbedTableData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { TabbedTableContainer } from '../components/TabbedTableContainer';

// ---------------------------------------------------------------------------
// Source shape (matches useSalesScorecardData return → SalesScorecardData)
// ---------------------------------------------------------------------------

interface TTSActor {
  name: string;
  units: number;
  volume: number;
  revenue: number;
  revenueBps: number;
  pullThrough: number;
  avgTurnTime: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  lostOpportunityUnits: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  ttsScore: number;
  tier: 'top' | 'second' | 'bottom';
}

interface TTSTierSummary {
  count: number;
  units: number;
  unitsPercent: number;
  volume: number;
  volumePercent: number;
  revenue: number;
  revenueBps: number;
  avgTurnTime: number;
  pullThrough: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  waWhDays: number;
  avgConditions: number;
  lostOpportunityUnits: number;
  lostOpportunityUnitsPercent: number;
  lostOpportunityRevenue: number;
  deniedUnits: number;
  deniedUnitsPercent: number;
  deniedRevenue: number;
  lostOpportunityAndDeniedRevenue: number;
  lostOpportunityAndDeniedRevenueBps: number;
  avgLoRevenue: number;
  avgLoUnits: number;
  avgLoUnitsPerMonth: number;
  avgLoVolume: number;
  avgLoVolumePerMonth: number;
  avgTtsScore: number;
  loanComplexityScore: number;
}

interface SalesScorecardSource {
  actors: TTSActor[];
  totals: TTSTierSummary & { actorCount: number };
  tierSummary: {
    top: TTSTierSummary;
    second: TTSTierSummary;
    bottom: TTSTierSummary;
  };
  companyAverages: unknown;
  weightConfig: unknown;
  dateRange: { startDate: string; endDate: string };
}

function s(raw: unknown): SalesScorecardSource {
  return raw as SalesScorecardSource;
}

// ---------------------------------------------------------------------------
// Helper formatting
// ---------------------------------------------------------------------------

const safeFixed = (v: number | undefined | null, d: number) =>
  v == null || isNaN(v) ? '-' : v.toFixed(d);

const fmtCurrency = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

const fmtNum = (v: number) => v.toLocaleString('en-US');

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const ssUnits: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-units',
  name: 'Total Units',
  description: 'Total sales units',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.units ?? 0,
    label: 'Total Units',
    format: 'number',
    subtitle: `${s(raw).totals?.actorCount ?? 0} LOs`,
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ssVolume: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-volume',
  name: 'Total Volume',
  description: 'Total sales volume',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.volume ?? 0,
    label: 'Total Volume',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ssRevenue: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-revenue',
  name: 'Total Revenue',
  description: 'Total revenue',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.revenue ?? 0,
    label: 'Revenue',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ssRevenueBps: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-revenue-bps',
  name: 'Revenue BPS',
  description: 'Revenue in basis points',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.revenueBps ?? 0,
    label: 'Revenue BPS',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ssPullThrough: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-pull-through',
  name: 'Pull-Through Rate',
  description: 'Pull-through percentage',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.pullThrough ?? 0,
    label: 'Pull-Through %',
    format: 'percent',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ssAvgTurnTime: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-avg-turn-time',
  name: 'Avg Turn Time',
  description: 'Average turn time (days)',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.avgTurnTime ?? 0,
    label: 'Avg Turn Time',
    format: 'days',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const ssAvgTtsScore: WidgetDefinition<KPIData> = {
  id: 'sales-scorecard-avg-tts',
  name: 'Avg TTS Score',
  description: 'Average TTS score across all actors',
  category: 'kpi',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => ({
    value: s(raw).totals?.avgTtsScore ?? 0,
    label: 'Avg TTS Score',
    format: 'number',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Summary Table (28 metrics × Totals / Top Tier / Second Tier / Bottom Tier)
// ---------------------------------------------------------------------------

function buildSalesSummaryTable(d: SalesScorecardSource): TableData {
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

  const v = (tier: TTSTierSummary | undefined, key: keyof TTSTierSummary) =>
    tier?.[key] ?? 0;

  const rows: Record<string, unknown>[] = [
    { metric: 'LO Count', totals: tot?.actorCount ?? 0, topTier: v(top, 'count'), secondTier: v(sec, 'count'), bottomTier: v(bot, 'count') },
    { metric: 'TTS Score', totals: safeFixed(tot?.avgTtsScore, 1), topTier: safeFixed(top?.avgTtsScore, 1), secondTier: safeFixed(sec?.avgTtsScore, 1), bottomTier: safeFixed(bot?.avgTtsScore, 1) },
    { metric: 'Loan Complexity', totals: safeFixed(tot?.loanComplexityScore, 1), topTier: safeFixed(top?.loanComplexityScore, 1), secondTier: safeFixed(sec?.loanComplexityScore, 1), bottomTier: safeFixed(bot?.loanComplexityScore, 1) },
    { metric: 'Units', totals: fmtNum(tot?.units ?? 0), topTier: fmtNum(v(top, 'units') as number), secondTier: fmtNum(v(sec, 'units') as number), bottomTier: fmtNum(v(bot, 'units') as number) },
    { metric: 'Units %', totals: '100.0', topTier: safeFixed(top?.unitsPercent, 1), secondTier: safeFixed(sec?.unitsPercent, 1), bottomTier: safeFixed(bot?.unitsPercent, 1) },
    { metric: 'Volume', totals: fmtCurrency(tot?.volume ?? 0), topTier: fmtCurrency(v(top, 'volume') as number), secondTier: fmtCurrency(v(sec, 'volume') as number), bottomTier: fmtCurrency(v(bot, 'volume') as number) },
    { metric: 'Volume %', totals: '100.0', topTier: safeFixed(top?.volumePercent, 1), secondTier: safeFixed(sec?.volumePercent, 1), bottomTier: safeFixed(bot?.volumePercent, 1) },
    { metric: 'Revenue $', totals: fmtCurrency(tot?.revenue ?? 0), topTier: fmtCurrency(v(top, 'revenue') as number), secondTier: fmtCurrency(v(sec, 'revenue') as number), bottomTier: fmtCurrency(v(bot, 'revenue') as number) },
    { metric: 'Revenue BPS', totals: safeFixed(tot?.revenueBps, 1), topTier: safeFixed(top?.revenueBps, 1), secondTier: safeFixed(sec?.revenueBps, 1), bottomTier: safeFixed(bot?.revenueBps, 1) },
    { metric: 'Lost Opp Revenue', totals: fmtCurrency(tot?.lostOpportunityRevenue ?? 0), topTier: fmtCurrency(v(top, 'lostOpportunityRevenue') as number), secondTier: fmtCurrency(v(sec, 'lostOpportunityRevenue') as number), bottomTier: fmtCurrency(v(bot, 'lostOpportunityRevenue') as number) },
    { _sectionHeader: 'Quality Metrics' },
    { metric: 'Avg Conditions', totals: safeFixed(tot?.avgConditions, 1), topTier: safeFixed(top?.avgConditions, 1), secondTier: safeFixed(sec?.avgConditions, 1), bottomTier: safeFixed(bot?.avgConditions, 1) },
    { metric: 'Turn Time', totals: safeFixed(tot?.avgTurnTime, 2), topTier: safeFixed(top?.avgTurnTime, 2), secondTier: safeFixed(sec?.avgTurnTime, 2), bottomTier: safeFixed(bot?.avgTurnTime, 2) },
    { metric: 'Pull-Through %', totals: safeFixed(tot?.pullThrough, 1), topTier: safeFixed(top?.pullThrough, 1), secondTier: safeFixed(sec?.pullThrough, 1), bottomTier: safeFixed(bot?.pullThrough, 1) },
    { metric: 'WA W-H Days', totals: safeFixed(tot?.waWhDays, 1), topTier: safeFixed(top?.waWhDays, 1), secondTier: safeFixed(sec?.waWhDays, 1), bottomTier: safeFixed(bot?.waWhDays, 1) },
    { metric: 'WA FICO', totals: tot?.waFico ? Math.round(tot.waFico) : '-', topTier: top?.waFico ? Math.round(top.waFico) : '-', secondTier: sec?.waFico ? Math.round(sec.waFico) : '-', bottomTier: bot?.waFico ? Math.round(bot.waFico) : '-' },
    { metric: 'WA LTV', totals: safeFixed(tot?.waLtv, 1), topTier: safeFixed(top?.waLtv, 1), secondTier: safeFixed(sec?.waLtv, 1), bottomTier: safeFixed(bot?.waLtv, 1) },
    { metric: 'WA DTI', totals: safeFixed(tot?.waDti, 1), topTier: safeFixed(top?.waDti, 1), secondTier: safeFixed(sec?.waDti, 1), bottomTier: safeFixed(bot?.waDti, 1) },
    { _sectionHeader: 'Lost Opportunity & Denied' },
    { metric: 'Lost Opp Units', totals: fmtNum(tot?.lostOpportunityUnits ?? 0), topTier: fmtNum(v(top, 'lostOpportunityUnits') as number), secondTier: fmtNum(v(sec, 'lostOpportunityUnits') as number), bottomTier: fmtNum(v(bot, 'lostOpportunityUnits') as number) },
    { metric: 'Lost Opp Units %', totals: safeFixed(tot?.lostOpportunityUnitsPercent, 1), topTier: safeFixed(top?.lostOpportunityUnitsPercent, 1), secondTier: safeFixed(sec?.lostOpportunityUnitsPercent, 1), bottomTier: safeFixed(bot?.lostOpportunityUnitsPercent, 1) },
    { metric: 'Denied Units', totals: fmtNum(tot?.deniedUnits ?? 0), topTier: fmtNum(v(top, 'deniedUnits') as number), secondTier: fmtNum(v(sec, 'deniedUnits') as number), bottomTier: fmtNum(v(bot, 'deniedUnits') as number) },
    { metric: 'Denied Units %', totals: safeFixed(tot?.deniedUnitsPercent, 1), topTier: safeFixed(top?.deniedUnitsPercent, 1), secondTier: safeFixed(sec?.deniedUnitsPercent, 1), bottomTier: safeFixed(bot?.deniedUnitsPercent, 1) },
    { metric: 'Lost Opp & Denied Rev', totals: fmtCurrency(tot?.lostOpportunityAndDeniedRevenue ?? 0), topTier: fmtCurrency(v(top, 'lostOpportunityAndDeniedRevenue') as number), secondTier: fmtCurrency(v(sec, 'lostOpportunityAndDeniedRevenue') as number), bottomTier: fmtCurrency(v(bot, 'lostOpportunityAndDeniedRevenue') as number) },
    { metric: 'Lost Opp & Denied BPS', totals: safeFixed(tot?.lostOpportunityAndDeniedRevenueBps, 1), topTier: safeFixed(top?.lostOpportunityAndDeniedRevenueBps, 1), secondTier: safeFixed(sec?.lostOpportunityAndDeniedRevenueBps, 1), bottomTier: safeFixed(bot?.lostOpportunityAndDeniedRevenueBps, 1) },
    { _sectionHeader: 'Per-LO Averages' },
    { metric: 'Avg LO Revenue', totals: fmtCurrency(tot?.avgLoRevenue ?? 0), topTier: fmtCurrency(v(top, 'avgLoRevenue') as number), secondTier: fmtCurrency(v(sec, 'avgLoRevenue') as number), bottomTier: fmtCurrency(v(bot, 'avgLoRevenue') as number) },
    { metric: 'Avg LO Units', totals: safeFixed(tot?.avgLoUnits, 1), topTier: safeFixed(top?.avgLoUnits, 1), secondTier: safeFixed(sec?.avgLoUnits, 1), bottomTier: safeFixed(bot?.avgLoUnits, 1) },
    { metric: 'Avg LO Units/Month', totals: safeFixed(tot?.avgLoUnitsPerMonth, 2), topTier: safeFixed(top?.avgLoUnitsPerMonth, 2), secondTier: safeFixed(sec?.avgLoUnitsPerMonth, 2), bottomTier: safeFixed(bot?.avgLoUnitsPerMonth, 2) },
    { metric: 'Avg LO Volume', totals: fmtCurrency(tot?.avgLoVolume ?? 0), topTier: fmtCurrency(v(top, 'avgLoVolume') as number), secondTier: fmtCurrency(v(sec, 'avgLoVolume') as number), bottomTier: fmtCurrency(v(bot, 'avgLoVolume') as number) },
    { metric: 'Avg LO Volume/Month', totals: fmtCurrency(tot?.avgLoVolumePerMonth ?? 0), topTier: fmtCurrency(v(top, 'avgLoVolumePerMonth') as number), secondTier: fmtCurrency(v(sec, 'avgLoVolumePerMonth') as number), bottomTier: fmtCurrency(v(bot, 'avgLoVolumePerMonth') as number) },
  ];

  return { title: 'Summary by Tier', columns, rows, stickyFirstColumn: true };
}

// ---------------------------------------------------------------------------
// Detail Table (per-actor, 9 columns matching actual page)
// ---------------------------------------------------------------------------

function buildSalesDetailTable(d: SalesScorecardSource): TableData {
  const rows = (d.actors ?? []).map((a) => ({
    name: a.name,
    ttsScore: +(a.ttsScore ?? 0).toFixed(2),
    tier: a.tier === 'top' ? 'Top Tier' : a.tier === 'second' ? '2nd Tier' : 'Bottom',
    units: a.units ?? 0,
    volume: a.volume ?? 0,
    revenue: a.revenue ?? 0,
    bps: +(a.revenueBps ?? 0).toFixed(2),
    pullThrough: +(a.pullThrough ?? 0).toFixed(2),
    turnTime: +(a.avgTurnTime ?? 0).toFixed(2),
  }));

  return {
    title: 'Detail by LO',
    columns: [
      { key: 'name', label: 'Loan Officer', sortable: true },
      { key: 'ttsScore', label: 'TTS Score', sortable: true, align: 'right', format: 'number' },
      { key: 'tier', label: 'Tier', sortable: true, align: 'center' },
      { key: 'units', label: 'Units', sortable: true, align: 'right', format: 'number' },
      { key: 'volume', label: 'Volume', sortable: true, align: 'right', format: 'currency' },
      { key: 'revenue', label: 'Revenue', sortable: true, align: 'right', format: 'currency' },
      { key: 'bps', label: 'BPS', sortable: true, align: 'right', format: 'number' },
      { key: 'pullThrough', label: 'P-T %', sortable: true, align: 'right', format: 'percent' },
      { key: 'turnTime', label: 'TT Days', sortable: true, align: 'right', format: 'days' },
    ],
    rows,
    stickyFirstColumn: true,
  };
}

// ---------------------------------------------------------------------------
// Tabbed Table Widget (Summary + Detail)
// ---------------------------------------------------------------------------

const ssTabbedTable: WidgetDefinition<TabbedTableData> = {
  id: 'sales-scorecard-tabbed-table',
  name: 'Sales Scorecard Tables',
  description: 'Summary by tier and detail by LO with tabs',
  category: 'table',
  group: 'Sales Scorecard',
  dataSource: 'sales-scorecard',
  dataSelector: (raw) => {
    const d = s(raw);
    return {
      title: 'Sales Scorecard',
      tabs: [
        { id: 'summary', label: 'Summary', table: buildSalesSummaryTable(d) },
        { id: 'detail', label: 'Detail', table: buildSalesDetailTable(d) },
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

export const salesScorecardWidgets: WidgetDefinition[] = [
  ssUnits,
  ssVolume,
  ssRevenue,
  ssRevenueBps,
  ssPullThrough,
  ssAvgTurnTime,
  ssAvgTtsScore,
  ssTabbedTable,
];
