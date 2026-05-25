/**
 * Pure reducer for create_dashboard — appends widget groups to canvas items.
 */
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type GroupWidgetItem,
  type SectionType,
  type WidgetFilterConfig,
} from "@/components/workbench/canvas/types";
import type { CreateDashboardAction } from "@/types/widgetActions";
import { filterConfigToInitialState } from "@/lib/workbench/workbenchPresetMapping";
import { wrapCohiWidgetInGroup } from "@/lib/workbench/workbenchCohiLayoutUtils";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";

export function applyCreateDashboard(
  items: CanvasLayoutItem[],
  action: CreateDashboardAction,
): WidgetActionReducerOutcome {
  const newItems: CanvasLayoutItem[] = [];
  let yOffset = 20;
  const groupGap = 20;
  const defaultGroupSize = { w: 1000, h: 800 };

  for (const group of action.groups) {
    const groupId = `cohi-dash-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const groupItems: GroupWidgetItem[] = group.widgets.map((w) => {
      if (w.kind === "registry") {
        return { kind: "registry" as const, defId: w.defId };
      }
      const id = `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const fc: WidgetFilterConfig =
        (w as { filterConfig?: WidgetFilterConfig }).filterConfig ?? {
          filterable: true,
          dateColumn: "application_date",
        };
      return {
        kind: "cohi" as const,
        id,
        sql: w.sql,
        title: w.title,
        vizConfig: w.vizConfig,
        filterConfig: fc,
        allowLowSamplePullThrough: !!(w as { allowLowSamplePullThrough?: boolean })
          .allowLowSamplePullThrough,
        savedFilters: filterConfigToInitialState(fc),
      };
    });
    const pos = group.canvasPosition ?? {
      x: 20,
      y: yOffset,
      w: defaultGroupSize.w,
      h: defaultGroupSize.h,
    };
    const sectionType = (group.sectionType ?? "company-scorecard") as SectionType;
    const groupPayload = {
      type: "widget_group" as const,
      groupId,
      title: group.title,
      sectionType,
      widgetIds: groupItems
        .filter(
          (i): i is Extract<GroupWidgetItem, { kind: "registry" }> =>
            i.kind === "registry",
        )
        .map((i) => i.defId),
      items: groupItems,
    };
    newItems.push(
      createLayoutItem(`canvas-${groupId}`, "widget_group", groupPayload, pos),
    );
    yOffset = pos.y + pos.h + groupGap;
  }

  for (const spec of action.standaloneWidgets ?? []) {
    if (spec.kind !== "cohi") continue;
    const pos = spec.canvasPosition ?? {
      x: 20,
      y: yOffset,
      w: 700,
      h: 440,
    };
    const groupItem = wrapCohiWidgetInGroup(
      {
        sql: spec.sql,
        title: spec.title,
        config: spec.vizConfig as Record<string, unknown>,
      },
      Math.random().toString(36).slice(2, 6),
      pos,
    );
    newItems.push(groupItem);
    yOffset = pos.y + pos.h + groupGap;
  }

  if (newItems.length === 0) {
    return { items, result: "noop" };
  }

  return {
    items: [...items, ...newItems],
    result: "ok",
    toast: {
      title: "Dashboard created",
      description:
        action.explanation?.substring(0, 80) ||
        `Added ${action.groups.length} group(s)`,
    },
  };
}
