/**
 * Pure reducer for create_widget — wraps a Cohi widget in a widget_group.
 */
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";
import type { CreateWidgetAction } from "@/types/widgetActions";
import { wrapCohiWidgetInGroup } from "@/lib/workbench/workbenchCohiLayoutUtils";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";

export type CreateWidgetContext = {
  canvasWidth: number;
};

export function applyCreateWidget(
  items: CanvasLayoutItem[],
  action: CreateWidgetAction,
  context: CreateWidgetContext,
): WidgetActionReducerOutcome {
  const yBottom = items.reduce((max, it) => Math.max(max, it.y + it.h), 0);
  const groupItem = wrapCohiWidgetInGroup(
    {
      sql: action.sql,
      title: action.title,
      config: action.config as Record<string, unknown>,
      explanation: action.explanation,
      allowLowSamplePullThrough: action.allowLowSamplePullThrough,
    },
    Math.random().toString(36).slice(2, 6),
    {
      x: 12,
      y: yBottom + 16,
      w: Math.min(Math.max(context.canvasWidth - 56, 400), 700),
      h: 440,
    },
  );

  return {
    items: [...items, groupItem],
    result: "ok",
    toast: { title: "Widget added", description: action.title },
  };
}
