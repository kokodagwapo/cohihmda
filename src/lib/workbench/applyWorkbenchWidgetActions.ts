/**
 * Batch-apply Cohi workbench WidgetActions on a canvas (embedded + centralized handoff).
 */

import { createLayoutItem, type CanvasLayoutItem } from "@/components/workbench/canvas/types";
import type { SectionType } from "@/components/workbench/canvas/types";
import type { Dispatch, SetStateAction } from "react";
import type { WidgetFilterConfig } from "@/components/workbench/canvas/types";
import type { WidgetAction } from "@/types/widgetActions";
import {
  filterConfigToInitialState,
  wrapCohiWidgetInGroup,
} from "@/lib/workbench/workbenchCohiLayoutUtils";

export interface ApplyWorkbenchWidgetActionsParams {
  actions: WidgetAction[];
  executeAction: (action: WidgetAction) => void;
  setItemsWithHistory: Dispatch<SetStateAction<CanvasLayoutItem[]>>;
  canvasWidth: number;
  defaultGroupWidth: number;
  onWidgetsAdded?: (count: number, titles: string[]) => void;
}

export function applyWorkbenchWidgetActions({
  actions,
  executeAction,
  setItemsWithHistory,
  canvasWidth,
  defaultGroupWidth,
  onWidgetsAdded,
}: ApplyWorkbenchWidgetActionsParams): void {
  const createWidgetActions = actions.filter((a) => a.type === "create_widget");
  let otherActions: WidgetAction[] = actions.filter((a) => a.type !== "create_widget");

  const modifyActions = otherActions.filter(
    (a): a is WidgetAction & { type: "modify_widget"; instanceId: string } =>
      a.type === "modify_widget" && "instanceId" in a,
  );
  if (modifyActions.length > 0) {
    const lastByInstanceId = new Map<
      string,
      WidgetAction & { type: "modify_widget"; instanceId: string }
    >();
    for (const a of modifyActions) lastByInstanceId.set(a.instanceId, a);
    const dedupedModify = [...lastByInstanceId.values()];
    otherActions = [
      ...otherActions.filter((a) => a.type !== "modify_widget"),
      ...dedupedModify,
    ];
  }

  for (const action of otherActions) {
    executeAction(action);
  }

  if (createWidgetActions.length === 1) {
    const action = createWidgetActions[0];
    setItemsWithHistory((prev) => {
      const yBottom = prev.reduce((max, it) => Math.max(max, it.y + it.h), 0);
      const groupItem = wrapCohiWidgetInGroup(
        action as Parameters<typeof wrapCohiWidgetInGroup>[0],
        Math.random().toString(36).slice(2, 6),
        {
          x: 12,
          y: yBottom + 16,
          w: Math.min(Math.max(canvasWidth - 56, 400), 700),
          h: 440,
        },
      );
      return [...prev, groupItem];
    });
    onWidgetsAdded?.(1, [createWidgetActions[0].title].filter(Boolean));
  } else if (createWidgetActions.length > 1) {
    setItemsWithHistory((prev) => {
      const cohiItems = createWidgetActions.map((action, idx) => {
        const fc: WidgetFilterConfig = (action as { filterConfig?: WidgetFilterConfig }).filterConfig ?? {
          filterable: true,
          dateColumn: "application_date",
        };
        return {
          kind: "cohi" as const,
          id: `cohi-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          sql: action.sql,
          title: action.title,
          vizConfig: action.config,
          explanation: action.explanation,
          filterConfig: fc,
          allowLowSamplePullThrough: !!(action as { allowLowSamplePullThrough?: boolean })
            .allowLowSamplePullThrough,
          savedFilters: filterConfigToInitialState(fc),
        };
      });

      const newItems = [...prev];
      let yOffset = 20;
      for (const item of prev) {
        const bottom = item.y + item.h;
        if (bottom + 20 > yOffset) yOffset = bottom + 20;
      }

      const kpiCount = createWidgetActions.filter((a) => a.config?.type === "kpi").length;
      const chartCount = createWidgetActions.length - kpiCount;
      const kpiRows = Math.ceil(kpiCount / 4);
      const chartRows = Math.ceil(chartCount / 2);
      const groupH = Math.max(420, 60 + kpiRows * 100 + chartRows * 300);

      const groupId = `canvas-group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const groupItem = createLayoutItem(
        groupId,
        "widget_group",
        {
          type: "widget_group" as const,
          groupId,
          title: "Cohi Dashboard",
          sectionType: "company-scorecard" as SectionType,
          widgetIds: [],
          items: cohiItems,
          filterSync: false,
        },
        { x: 0, y: yOffset, w: defaultGroupWidth, h: groupH },
      );
      newItems.push(groupItem);
      return newItems;
    });
    onWidgetsAdded?.(
      createWidgetActions.length,
      createWidgetActions.map((a) => a.title).filter(Boolean),
    );
  }
}
