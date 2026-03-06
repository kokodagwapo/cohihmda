/**
 * Lock Stratification – workbench widgets (KPIs, Interest Rates, Days to Expiration,
 * Pull Through, Active Loans Bar, Active Loans Pivot). Each table/chart is a separate widget.
 * Filters (Locked, Measure, Group by, Pull-through period) live in the section header.
 */

import React from 'react';
import type { WidgetDefinition } from './types';
import { LockStratificationEmbed } from '../components/LockStratificationEmbed';

const lockStratificationKpis: WidgetDefinition = {
  id: 'lock-stratification-kpis',
  name: 'Lock Stratification KPIs',
  description: 'Volume, units, average balance, avg days active, WAC, WA FICO, WA LTV, WA DTI',
  category: 'kpi',
  group: 'Lock Stratification',
  dataSource: 'lock-stratification',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 12 },
  minSize: { w: 16, h: 8 },
  config: { variant: 'kpis' },
  component: LockStratificationEmbed as React.ComponentType<unknown>,
};

const lockStratificationInterestRates: WidgetDefinition = {
  id: 'lock-stratification-interest-rates',
  name: 'Lock Stratification Interest Rates',
  description: 'Interest rate distribution bar chart with drill-down',
  category: 'chart',
  group: 'Lock Stratification',
  dataSource: 'lock-stratification',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 20, h: 18 },
  minSize: { w: 14, h: 12 },
  config: { variant: 'interest-rates' },
  component: LockStratificationEmbed as React.ComponentType<unknown>,
};

const lockStratificationDaysToExpiration: WidgetDefinition = {
  id: 'lock-stratification-days-to-expiration',
  name: 'Lock Stratification Days to Expiration',
  description: 'Table of loans by days to lock expiration (time range, units, volume, WAC, avg days active)',
  category: 'table',
  group: 'Lock Stratification',
  dataSource: 'lock-stratification',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 14 },
  minSize: { w: 18, h: 10 },
  config: { variant: 'days-to-expiration' },
  component: LockStratificationEmbed as React.ComponentType<unknown>,
};

const lockStratificationPullThrough: WidgetDefinition = {
  id: 'lock-stratification-pull-through',
  name: 'Lock Stratification Pull Through',
  description: 'Pull through | Locked to final disposition (originate/withdrew/denied % and chart)',
  category: 'chart',
  group: 'Lock Stratification',
  dataSource: 'lock-stratification',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 22, h: 18 },
  minSize: { w: 16, h: 12 },
  config: { variant: 'pull-through' },
  component: LockStratificationEmbed as React.ComponentType<unknown>,
};

const lockStratificationMilestoneBar: WidgetDefinition = {
  id: 'lock-stratification-milestone-bar',
  name: 'Lock Stratification Active Loans (Bar)',
  description: 'Active loans by milestone/investor/branch etc. – bar chart by days to lock expiration',
  category: 'chart',
  group: 'Lock Stratification',
  dataSource: 'lock-stratification',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 20 },
  minSize: { w: 18, h: 14 },
  config: { variant: 'milestone-bar' },
  component: LockStratificationEmbed as React.ComponentType<unknown>,
};

const lockStratificationMilestonePivot: WidgetDefinition = {
  id: 'lock-stratification-milestone-pivot',
  name: 'Lock Stratification Active Loans (Pivot)',
  description: 'Active loans by milestone/investor/branch etc. – pivot table with expandable rows',
  category: 'table',
  group: 'Lock Stratification',
  dataSource: 'lock-stratification',
  dataSelector: () => ({ ready: true }),
  defaultSize: { w: 24, h: 18 },
  minSize: { w: 18, h: 12 },
  config: { variant: 'milestone-pivot' },
  component: LockStratificationEmbed as React.ComponentType<unknown>,
};

export const lockStratificationWidgets: WidgetDefinition[] = [
  lockStratificationKpis,
  lockStratificationInterestRates,
  lockStratificationDaysToExpiration,
  lockStratificationPullThrough,
  lockStratificationMilestoneBar,
  lockStratificationMilestonePivot,
];
