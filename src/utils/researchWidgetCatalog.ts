/**
 * Research Lab: serialize the widget registry for the analyst LLM, with nav-parity
 * filtering (e.g. drop /admin-linked widgets for non-admins) and dashboard paths.
 */

import {
  getWidgetGroups,
  getWidgetsByGroup,
} from "@/components/widgets/registry";
import type { DataSourceId } from "@/components/widgets/registry/types";
import type { AuthUser } from "@/contexts/AuthContext";
import { DATA_SOURCE_DASHBOARD_HOME } from "@/lib/researchDashboardHomes";

export interface ResearchWidgetCatalogMetaEntry {
  id: string;
  name: string;
  dataSource: string;
  dashboardPath: string;
  dashboardLabel: string;
  sectionId?: string;
}

function pathRequiresAdmin(path: string): boolean {
  return path.startsWith("/admin");
}

function userCanAccessDashboardPath(
  user: AuthUser | null | undefined,
  path: string,
): boolean {
  if (!pathRequiresAdmin(path)) return true;
  const role = user?.role;
  return (
    role === "tenant_admin" ||
    user?.is_super_admin === true ||
    role === "super_admin" ||
    role === "platform_admin"
  );
}

export interface ResearchWidgetCatalogSnapshot {
  catalog: string;
  meta: ResearchWidgetCatalogMetaEntry[];
}

/**
 * Build markdown catalog + structured meta for POST /api/research/sessions.
 */
export function serializeResearchWidgetCatalog(
  user: AuthUser | null | undefined,
): ResearchWidgetCatalogSnapshot {
  const meta: ResearchWidgetCatalogMetaEntry[] = [];
  const lines: string[] = ["## AVAILABLE DASHBOARD WIDGETS\n"];
  const groups = getWidgetGroups();

  for (const group of groups) {
    const widgets = getWidgetsByGroup(group).filter((w) => {
      const home = DATA_SOURCE_DASHBOARD_HOME[w.dataSource as DataSourceId];
      const dashboardPath = home?.path ?? "/insights";
      return userCanAccessDashboardPath(user, dashboardPath);
    });

    lines.push(`### ${group} (${widgets.length} widgets)`);
    for (const w of widgets) {
      const home = DATA_SOURCE_DASHBOARD_HOME[w.dataSource as DataSourceId];
      const dashboardPath = home?.path ?? "/insights";
      const dashboardLabel = home?.label ?? "Dashboard";
      meta.push({
        id: w.id,
        name: w.name,
        dataSource: w.dataSource,
        dashboardPath,
        dashboardLabel,
        sectionId: home?.sectionId,
      });
      lines.push(
        `- ${w.id}: "${w.name}" [${w.category}] source=${w.dataSource} dashboard=${dashboardPath} ("${dashboardLabel}")`,
      );
    }
    lines.push("");
  }

  lines.push(`Total: ${meta.length} widgets (nav-filtered).`);
  return { catalog: lines.join("\n"), meta };
}
