/**
 * Widget definitions for the Leaderboard data source.
 *
 * Provides a simple table of top performers from
 * useLeaderboardData.
 */

import type { WidgetDefinition, TableData, TableColumn } from './types';
import { DataTable } from '../components/DataTable';

// ---------------------------------------------------------------------------
// Source shape – useLeaderboardData returns { leaderboardData: Leader[], loading }
// ---------------------------------------------------------------------------

interface Leader {
  name: string;
  branch?: string;
  units?: number;
  volume?: number;
  revenue?: number;
  tier?: string;
  badges?: string[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Table Widget
// ---------------------------------------------------------------------------

const leaderboardTable: WidgetDefinition<TableData> = {
  id: 'leaderboard-table',
  name: 'Leaderboard',
  description: 'Top performers leaderboard table',
  category: 'table',
  group: 'Leaderboard',
  dataSource: 'dashboard-metrics',
  dataSelector: (raw) => {
    const leaders = (Array.isArray(raw) ? raw : []) as Leader[];
    const cols: TableColumn[] = [
      { key: 'name', label: 'Name', align: 'left' },
      { key: 'branch', label: 'Branch', align: 'left' },
      { key: 'units', label: 'Units', align: 'right', format: 'number' },
      { key: 'volume', label: 'Volume', align: 'right', format: 'currency' },
      { key: 'revenue', label: 'Revenue', align: 'right', format: 'currency' },
      { key: 'tier', label: 'Tier', align: 'center' },
    ];
    return {
      title: 'Leaderboard',
      columns: cols,
      rows: leaders.slice(0, 25).map((l) => ({
        name: l.name,
        branch: l.branch ?? '',
        units: l.units ?? 0,
        volume: l.volume ?? 0,
        revenue: l.revenue ?? 0,
        tier: l.tier ?? '',
      })),
    };
  },
  defaultSize: { w: 500, h: 220 },
  minSize: { w: 250, h: 112 },
  component: DataTable,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const leaderboardWidgets: WidgetDefinition[] = [
  leaderboardTable,
];
