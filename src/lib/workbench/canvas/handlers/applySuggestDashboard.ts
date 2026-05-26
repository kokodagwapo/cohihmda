/**
 * Pure reducer for suggest_dashboard — append a pre-built section without replacing canvas.
 */
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type SectionType,
} from "@/components/workbench/canvas/types";
import type { SuggestDashboardAction } from "@/types/widgetActions";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";
import type { SectionWidgetsConfig } from "./applyCreateCanvas";

export type SuggestDashboardContext = {
  defaultGroupWidth: number;
  sectionToWidgets: Record<string, SectionWidgetsConfig>;
  standaloneWidgets: Record<string, { defId: string; w: number; h: number }>;
};

function sectionTitleFromKey(sectionKey: string): string {
  return sectionKey
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function stackYBelowExisting(items: CanvasLayoutItem[]): number {
  if (items.length === 0) return 20;
  const bottom = items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  return bottom + 24;
}

export function applySuggestDashboard(
  items: CanvasLayoutItem[],
  action: SuggestDashboardAction,
  context: SuggestDashboardContext,
): WidgetActionReducerOutcome {
  const sectionKey = action.sectionKey;
  const sectionTitle = sectionTitleFromKey(sectionKey);
  const y = stackYBelowExisting(items);

  const sw = context.standaloneWidgets[sectionKey];
  if (sw) {
    const swItem = createLayoutItem(
      `canvas-${Date.now()}`,
      "registry_widget",
      { type: "registry_widget", definitionId: sw.defId },
      {
        x: 20,
        y,
        w: Math.min(sw.w, context.defaultGroupWidth),
        h: sw.h,
      },
    );
    return {
      items: [...items, swItem],
      result: "ok",
      toast: {
        title: "Widget added",
        description: `Added "${sectionTitle}" to canvas`,
      },
    };
  }

  const section = context.sectionToWidgets[sectionKey];
  if (!section) {
    return {
      items,
      result: "invalid",
      toast: {
        title: "Dashboard not found",
        description: `Unknown section: ${sectionKey}`,
        variant: "destructive",
      },
    };
  }

  const gId = `cohi-dash-${Date.now()}`;
  const dashItem = createLayoutItem(
    `canvas-${Date.now()}`,
    "widget_group",
    {
      type: "widget_group",
      groupId: gId,
      title: sectionTitle,
      sectionType: section.sectionType as SectionType,
      widgetIds: section.widgetIds,
    },
    { x: 0, y, w: context.defaultGroupWidth, h: 800 },
  );

  return {
    items: [...items, dashItem],
    result: "ok",
    toast: {
      title: "Dashboard added",
      description: `Added ${section.widgetIds.length} widgets to canvas`,
    },
  };
}
