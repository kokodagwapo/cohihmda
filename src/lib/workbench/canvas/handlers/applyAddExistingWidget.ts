/**
 * Pure reducer for add_existing_widget — append a registry widget group.
 */
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type SectionType,
} from "@/components/workbench/canvas/types";
import { getWidgetDefinition } from "@/components/widgets/registry";
import type { AddExistingWidgetAction } from "@/types/widgetActions";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";
import type { SectionWidgetsConfig } from "./applyCreateCanvas";

export type AddExistingWidgetContext = {
  defaultGroupWidth: number;
  sectionToWidgets: Record<string, SectionWidgetsConfig>;
};

function stackYBelowExisting(items: CanvasLayoutItem[]): number {
  if (items.length === 0) return 20;
  const bottom = items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  return bottom + 24;
}

export function applyAddExistingWidget(
  items: CanvasLayoutItem[],
  action: AddExistingWidgetAction,
  context: AddExistingWidgetContext,
): WidgetActionReducerOutcome {
  const def = getWidgetDefinition(action.widgetId);
  if (!def) {
    return {
      items,
      result: "invalid",
      toast: {
        title: "Widget not found",
        description: `Unknown widget: ${action.widgetId}`,
        variant: "destructive",
      },
    };
  }

  let sectionType: SectionType = "company-scorecard";
  for (const cfg of Object.values(context.sectionToWidgets)) {
    if (cfg.widgetIds.includes(action.widgetId)) {
      sectionType = cfg.sectionType as SectionType;
      break;
    }
  }

  const groupId = `cohi-group-${Date.now()}`;
  const newItem = createLayoutItem(
    `canvas-${Date.now()}`,
    "widget_group",
    {
      type: "widget_group",
      groupId,
      title: def.group,
      sectionType,
      widgetIds: [action.widgetId],
    },
    { x: 0, y: stackYBelowExisting(items), w: context.defaultGroupWidth, h: 400 },
  );

  return {
    items: [...items, newItem],
    result: "ok",
    toast: {
      title: "Widget added",
      description: `Added "${def.name}" to canvas`,
    },
  };
}
