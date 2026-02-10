/**
 * Widget definitions for the Leaderboard.
 *
 * Single full-component embed that preserves all interactive features:
 * top-5 cards with rank badges, collapsible ranks 6-10 table,
 * scope/period/ranking metric selectors, drill-down modals with
 * per-metric rankings, badges, and streaks.
 */

import type { WidgetDefinition } from './types';
import { LeaderboardEmbed } from '../components/LeaderboardEmbed';

// ---------------------------------------------------------------------------
// Full embed widget
// ---------------------------------------------------------------------------

const leaderboardEmbed: WidgetDefinition = {
  id: 'leaderboard-embed',
  name: 'Leaderboard',
  description: 'Full leaderboard with top-5 cards, rankings, drill-down modals, and scope/metric filters',
  category: 'table', // Use 'table' category for full-width sizing
  group: 'Leaderboard',
  dataSource: 'dashboard-metrics',
  dataSelector: () => ({ ready: true }), // Component does its own data fetching
  defaultSize: { w: 500, h: 800 },
  minSize: { w: 400, h: 400 },
  component: LeaderboardEmbed as any,
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export const leaderboardWidgets: WidgetDefinition[] = [
  leaderboardEmbed,
];
