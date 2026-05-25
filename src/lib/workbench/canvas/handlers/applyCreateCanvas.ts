/**
 * Pure reducer for create_canvas — builds layout from dashboard section keys.
 */
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type SectionType,
} from "@/components/workbench/canvas/types";
import type { CreateCanvasAction } from "@/types/widgetActions";
import { getWidgetDefinition } from "@/components/widgets/registry";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";

export type SectionWidgetsConfig = {
  sectionType: SectionType;
  widgetIds: string[];
};

export type CreateCanvasContext = {
  canvasWidth: number;
  sectionToWidgets: Record<string, SectionWidgetsConfig>;
  standaloneWidgets: Record<string, { defId: string; w: number; h: number }>;
};

const EMBED_HEIGHTS: Record<string, number> = {
  executiveDashboard: 700,
  leaderboard: 850,
};

function sectionTitleFromKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
}

function computeGroupHeight(
  key: string,
  section: SectionWidgetsConfig,
): number {
  const embedH = EMBED_HEIGHTS[key];
  if (embedH && section.widgetIds.length <= 2) {
    return embedH;
  }
  const kpiCount = section.widgetIds.filter((id) => {
    const def = getWidgetDefinition(id);
    return def?.category === "kpi";
  }).length;
  const kpiRows = Math.ceil(kpiCount / 7);
  const chartCount = section.widgetIds.filter((id) => {
    const d = getWidgetDefinition(id);
    return d?.category === "chart" || d?.category === "distribution";
  }).length;
  const tableCount = section.widgetIds.filter((id) => {
    const d = getWidgetDefinition(id);
    return d?.category === "table";
  }).length;
  const chartRows = Math.ceil(chartCount / 2);
  const contentH = kpiRows * 80 + chartRows * 210 + tableCount * 280 + 20;
  return Math.max(350, 110 + contentH);
}

export function applyCreateCanvas(
  items: CanvasLayoutItem[],
  action: CreateCanvasAction,
  context: CreateCanvasContext,
): WidgetActionReducerOutcome {
  const sectionKeys = action.sectionKeys ?? [];
  if (sectionKeys.length === 0) {
    return {
      items,
      result: "invalid",
      toast: { title: "No sections specified", variant: "destructive" },
    };
  }

  const newItems: CanvasLayoutItem[] = [];
  let yOffset = 0;
  const groupW = Math.max(context.canvasWidth - 32, 480);

  for (const key of sectionKeys) {
    const itemId = `widget-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const sectionTitle = sectionTitleFromKey(key);

    const standalone = context.standaloneWidgets[key];
    if (standalone) {
      newItems.push(
        createLayoutItem(
          itemId,
          "registry_widget",
          {
            type: "registry_widget",
            definitionId: standalone.defId,
          },
          {
            x: 0,
            y: yOffset,
            w: Math.min(standalone.w, groupW),
            h: standalone.h,
          },
        ),
      );
      yOffset += standalone.h + 24;
      continue;
    }

    const section = context.sectionToWidgets[key];
    if (!section) continue;

    const groupId = `cohi-canvas-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const groupH = computeGroupHeight(key, section);

    newItems.push(
      createLayoutItem(
        itemId,
        "widget_group",
        {
          type: "widget_group",
          groupId,
          title: sectionTitle,
          sectionType: section.sectionType,
          widgetIds: section.widgetIds,
        },
        { x: 0, y: yOffset, w: groupW, h: groupH },
      ),
    );
    yOffset += groupH + 24;
  }

  if (newItems.length === 0) {
    return { items, result: "noop" };
  }

  return {
    items: [...items, ...newItems],
    result: "ok",
    toast: {
      title: action.title || "Canvas created",
      description: `Added ${newItems.length} dashboard section${newItems.length !== 1 ? "s" : ""} to canvas`,
    },
  };
}
