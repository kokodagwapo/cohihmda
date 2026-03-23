/**
 * Dashboard Insights — generic adapter interface
 *
 * Page adapters build DashboardPageContext from existing dashboard APIs.
 */

import type {
  DashboardPageContext,
  WidgetCatalogEntry,
} from "../types.js";

export interface DashboardAdapter {
  readonly pageId: string;
  readonly pageName: string;
  readonly pageDescription: string;

  /**
   * Returns list of view-level filter combinations for this page
   * (e.g. different timeframes × channel groups) that should get insights.
   */
  getFilterCombinations(tenantPool: import("pg").Pool): Promise<Record<string, unknown>[]>;

  /**
   * Builds full page context for the given filters by calling existing dashboard APIs.
   */
  buildContext(
    tenantPool: import("pg").Pool,
    filters: Record<string, unknown>,
    accessClause?: string
  ): Promise<DashboardPageContext>;

  /**
   * Returns static widget catalog for this page (can also be embedded in buildContext).
   */
  getWidgetCatalog(): WidgetCatalogEntry[];
}
