/**
 * Widget definitions for Loan Funnel data source.
 *
 * Data shape: LOSFunnelData with nested objects
 * (loansStarted.units, respaApp.units, originated.units, etc.)
 *
 * Matches LoanFunnel.tsx layout:
 * - Stage KPIs
 * - Waterfall detail table (7 rows × units/volume/percentages)
 */

import type { WidgetDefinition, KPIData, TableData, TableColumn } from './types';
import { KPICard } from '../components/KPICard';
import { DataTable } from '../components/DataTable';

// ---------------------------------------------------------------------------
// Source shape (matches useFunnelData return → LOSFunnelData)
// ---------------------------------------------------------------------------

interface FunnelStage {
  revenue: number;
  units: number;
  volume: number;
  lostRevenue?: number;
}

interface LOSFunnelData {
  loansStarted: FunnelStage;
  noRespaApp: FunnelStage & { lostRevenue: number };
  respaApp: FunnelStage;
  originated: FunnelStage;
  falloutWithdrawn: FunnelStage & { lostRevenue: number };
  falloutDenied: FunnelStage & { lostRevenue: number };
  stillActive: FunnelStage;
}

function f(raw: unknown): LOSFunnelData {
  return raw as LOSFunnelData;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const fmtCurrency = (v: number) => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
};

// ---------------------------------------------------------------------------
// KPI Widgets
// ---------------------------------------------------------------------------

const funnelLoansStarted: WidgetDefinition<KPIData> = {
  id: 'funnel-loans-started',
  name: 'Loans Started',
  description: 'Total loans started in period',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).loansStarted?.units ?? 0,
    label: 'Loans Started',
    format: 'number',
    subtitle: fmtCurrency(f(raw).loansStarted?.volume ?? 0),
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const funnelRespaApps: WidgetDefinition<KPIData> = {
  id: 'funnel-respa-apps',
  name: 'RESPA Applications',
  description: 'Loans with RESPA applications',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).respaApp?.units ?? 0,
    label: 'RESPA Apps',
    format: 'number',
    subtitle: fmtCurrency(f(raw).respaApp?.volume ?? 0),
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const funnelOriginated: WidgetDefinition<KPIData> = {
  id: 'funnel-originated',
  name: 'Originated Loans',
  description: 'Total originated loans',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).originated?.units ?? 0,
    label: 'Originated',
    format: 'number',
    subtitle: fmtCurrency(f(raw).originated?.volume ?? 0),
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const funnelWithdrawn: WidgetDefinition<KPIData> = {
  id: 'funnel-withdrawn',
  name: 'Fallout - Withdrawn',
  description: 'Withdrawn loan count',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).falloutWithdrawn?.units ?? 0,
    label: 'Withdrawn',
    format: 'number',
    subtitle: `Lost: ${fmtCurrency(f(raw).falloutWithdrawn?.lostRevenue ?? 0)}`,
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const funnelDenied: WidgetDefinition<KPIData> = {
  id: 'funnel-denied',
  name: 'Fallout - Denied',
  description: 'Denied loan count',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).falloutDenied?.units ?? 0,
    label: 'Denied',
    format: 'number',
    subtitle: `Lost: ${fmtCurrency(f(raw).falloutDenied?.lostRevenue ?? 0)}`,
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const funnelStillActive: WidgetDefinition<KPIData> = {
  id: 'funnel-still-active',
  name: 'Still Active',
  description: 'Loans still active in pipeline',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).stillActive?.units ?? 0,
    label: 'Still Active',
    format: 'number',
    subtitle: fmtCurrency(f(raw).stillActive?.volume ?? 0),
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

const funnelVolume: WidgetDefinition<KPIData> = {
  id: 'funnel-volume',
  name: 'Originated Volume',
  description: 'Total originated volume',
  category: 'kpi',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => ({
    value: f(raw).originated?.volume ?? 0,
    label: 'Originated Volume',
    format: 'currency',
  }),
  defaultSize: { w: 100, h: 48 },
  minSize: { w: 50, h: 28 },
  component: KPICard,
};

// ---------------------------------------------------------------------------
// Waterfall Table (matches detail view in LoanFunnel.tsx)
// ---------------------------------------------------------------------------

const funnelWaterfallTable: WidgetDefinition<TableData> = {
  id: 'funnel-waterfall-table',
  name: 'Funnel Waterfall',
  description: 'Waterfall breakdown of funnel stages',
  category: 'table',
  group: 'Loan Funnel',
  dataSource: 'funnel',
  dataSelector: (raw) => {
    const d = f(raw);
    const ls = d.loansStarted?.units ?? 0;
    const lsVol = d.loansStarted?.volume ?? 0;
    const pctU = (v: number) => (ls > 0 ? +((v / ls) * 100).toFixed(1) : 0);
    const pctV = (v: number) => (lsVol > 0 ? +((v / lsVol) * 100).toFixed(1) : 0);

    const cols: TableColumn[] = [
      { key: 'stage', label: 'Waterfall Stage', align: 'left' },
      { key: 'units', label: 'Units', align: 'right', format: 'number' },
      { key: 'unitsPct', label: 'Units %', align: 'right', format: 'percent' },
      { key: 'volume', label: 'Volume', align: 'right', format: 'currency' },
      { key: 'volumePct', label: 'Vol %', align: 'right', format: 'percent' },
    ];

    const rows: Record<string, unknown>[] = [
      { stage: 'Loans Started', units: ls, unitsPct: 100, volume: lsVol, volumePct: 100 },
      { stage: 'No RESPA Apps', units: d.noRespaApp?.units ?? 0, unitsPct: pctU(d.noRespaApp?.units ?? 0), volume: d.noRespaApp?.volume ?? 0, volumePct: pctV(d.noRespaApp?.volume ?? 0) },
      { stage: 'RESPA Apps', units: d.respaApp?.units ?? 0, unitsPct: pctU(d.respaApp?.units ?? 0), volume: d.respaApp?.volume ?? 0, volumePct: pctV(d.respaApp?.volume ?? 0) },
      { stage: 'Originated', units: d.originated?.units ?? 0, unitsPct: pctU(d.originated?.units ?? 0), volume: d.originated?.volume ?? 0, volumePct: pctV(d.originated?.volume ?? 0) },
      { stage: 'Withdrawn', units: d.falloutWithdrawn?.units ?? 0, unitsPct: pctU(d.falloutWithdrawn?.units ?? 0), volume: d.falloutWithdrawn?.volume ?? 0, volumePct: pctV(d.falloutWithdrawn?.volume ?? 0) },
      { stage: 'Denied', units: d.falloutDenied?.units ?? 0, unitsPct: pctU(d.falloutDenied?.units ?? 0), volume: d.falloutDenied?.volume ?? 0, volumePct: pctV(d.falloutDenied?.volume ?? 0) },
      { stage: 'Still Active', units: d.stillActive?.units ?? 0, unitsPct: pctU(d.stillActive?.units ?? 0), volume: d.stillActive?.volume ?? 0, volumePct: pctV(d.stillActive?.volume ?? 0) },
    ];

    return { title: 'Funnel Waterfall', columns: cols, rows };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const loanFunnelWidgets: WidgetDefinition[] = [
  funnelLoansStarted,
  funnelRespaApps,
  funnelOriginated,
  funnelWithdrawn,
  funnelDenied,
  funnelStillActive,
  funnelVolume,
  funnelWaterfallTable,
];
