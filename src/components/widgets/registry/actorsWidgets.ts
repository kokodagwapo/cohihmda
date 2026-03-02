/**
 * Widget definitions for Actors dashboard (Current Loan Status chart, KPIs, 4 actor tables).
 * Data source provides full ActorsDashboardData from WidgetDataProvider.
 */

import type { ComponentType } from 'react';
import type { WidgetDefinition } from './types';
import type { ActorsDashboardData, ActorsTableResult } from '@/hooks/useActorsData';
import { ActorsStatusChartWidget } from '../components/ActorsStatusChartWidget';
import { ActorsKPIsWidget } from '../components/ActorsKPIsWidget';
import { ActorsTableWidget } from '../components/ActorsTableWidget';

function selectFull(_raw: unknown): ActorsDashboardData | null {
  return _raw as ActorsDashboardData | null;
}

function selectTable(index: number) {
  return (raw: unknown): ActorsTableResult | null => {
    const data = raw as ActorsDashboardData | null;
    const table = data?.tables?.[index];
    return table ?? null;
  };
}

export const actorsStatusChart: WidgetDefinition<ActorsDashboardData | null> = {
  id: 'actors-status-chart',
  name: 'Current Loan Status',
  description: 'Bar chart of loan status counts or volume by status',
  category: 'chart',
  group: 'Actors',
  dataSource: 'actors',
  dataSelector: selectFull,
  defaultSize: { w: 600, h: 340 },
  minSize: { w: 400, h: 260 },
  component: ActorsStatusChartWidget as ComponentType<any>,
};

export const actorsKpis: WidgetDefinition<ActorsDashboardData | null> = {
  id: 'actors-kpis',
  name: 'KPIs',
  description: 'Units, Volume, Average Balance, WAC, WAM, WA FICO, WA LTV, WA DTI',
  category: 'kpi',
  group: 'Actors',
  dataSource: 'actors',
  dataSelector: selectFull,
  defaultSize: { w: 520, h: 320 },
  minSize: { w: 320, h: 240 },
  component: ActorsKPIsWidget as ComponentType<any>,
};

const TABLE_NAMES = ['Loan Officer', 'Processor', 'Underwriter', 'Closer'] as const;

export const actorsTable0: WidgetDefinition<ActorsTableResult | null> = {
  id: 'actors-table-0',
  name: TABLE_NAMES[0],
  description: 'Actor table by loan officer (or select dimension)',
  category: 'table',
  group: 'Actors',
  dataSource: 'actors',
  dataSelector: selectTable(0),
  defaultSize: { w: 500, h: 380 },
  minSize: { w: 320, h: 280 },
  component: ActorsTableWidget as ComponentType<any>,
  config: { tableIndex: 0 },
};

export const actorsTable1: WidgetDefinition<ActorsTableResult | null> = {
  id: 'actors-table-1',
  name: TABLE_NAMES[1],
  description: 'Actor table by processor (or select dimension)',
  category: 'table',
  group: 'Actors',
  dataSource: 'actors',
  dataSelector: selectTable(1),
  defaultSize: { w: 500, h: 380 },
  minSize: { w: 320, h: 280 },
  component: ActorsTableWidget as ComponentType<any>,
  config: { tableIndex: 1 },
};

export const actorsTable2: WidgetDefinition<ActorsTableResult | null> = {
  id: 'actors-table-2',
  name: TABLE_NAMES[2],
  description: 'Actor table by underwriter (or select dimension)',
  category: 'table',
  group: 'Actors',
  dataSource: 'actors',
  dataSelector: selectTable(2),
  defaultSize: { w: 500, h: 380 },
  minSize: { w: 320, h: 280 },
  component: ActorsTableWidget as ComponentType<any>,
  config: { tableIndex: 2 },
};

export const actorsTable3: WidgetDefinition<ActorsTableResult | null> = {
  id: 'actors-table-3',
  name: TABLE_NAMES[3],
  description: 'Actor table by closer (or select dimension)',
  category: 'table',
  group: 'Actors',
  dataSource: 'actors',
  dataSelector: selectTable(3),
  defaultSize: { w: 500, h: 380 },
  minSize: { w: 320, h: 280 },
  component: ActorsTableWidget as ComponentType<any>,
  config: { tableIndex: 3 },
};

export const actorsWidgets: WidgetDefinition[] = [
  actorsStatusChart,
  actorsKpis,
  actorsTable0,
  actorsTable1,
  actorsTable2,
  actorsTable3,
];
