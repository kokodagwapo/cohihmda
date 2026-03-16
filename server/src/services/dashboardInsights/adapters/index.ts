/**
 * Dashboard Insights — adapter registry
 */

import type { DashboardAdapter } from "./baseDashboardAdapter.js";
import { leaderboardAdapter } from "./leaderboardAdapter.js";

const adapters: DashboardAdapter[] = [leaderboardAdapter];

export function getDashboardAdapters(): DashboardAdapter[] {
  return adapters;
}

export function getDashboardAdapterByPageId(pageId: string): DashboardAdapter | undefined {
  return adapters.find((a) => a.pageId === pageId);
}

export { leaderboardAdapter } from "./leaderboardAdapter.js";
export type { DashboardAdapter } from "./baseDashboardAdapter.js";
