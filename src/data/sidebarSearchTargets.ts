/**
 * Sidebar dashboard/page search targets are sourced from the backend
 * canonical navigation catalog to avoid frontend/backend drift.
 */

import { api } from "@/lib/api";
import type { SidebarRouteSearchTarget } from "@/components/dashboard/SidebarRouteSearch";

type NavigationTargetDto = {
  id: string;
  label: string;
  group: string;
  kind: "route" | "section";
  path?: string;
  sectionId?: string;
  keywords?: string[];
};

type NavigationTargetsResponse = {
  targets: NavigationTargetDto[];
  version?: number;
};

function toSidebarTarget(
  target: NavigationTargetDto,
): SidebarRouteSearchTarget | null {
  if (target.kind === "route" && target.path) {
    return {
      id: target.id,
      label: target.label,
      group: target.group,
      kind: "route",
      path: target.path,
      keywords: target.keywords ?? [],
    };
  }
  if (target.kind === "section" && target.sectionId) {
    return {
      id: target.id,
      label: target.label,
      group: target.group,
      kind: "section",
      sectionId: target.sectionId,
      keywords: target.keywords ?? [],
    };
  }
  return null;
}

export async function fetchSidebarSearchTargets(): Promise<
  SidebarRouteSearchTarget[]
> {
  const resp = await api.request<NavigationTargetsResponse>(
    "/api/cohi-chat/navigation-targets",
    { method: "GET" },
  );
  const targets = Array.isArray(resp?.targets) ? resp.targets : [];
  return targets.map(toSidebarTarget).filter((t): t is SidebarRouteSearchTarget => t !== null);
}
