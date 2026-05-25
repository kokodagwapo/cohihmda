/**
 * Pure reducer for convert_to_sql_widget on canvas layout items.
 */
import type { CanvasLayoutItem, GroupWidgetItem } from "@/components/workbench/canvas/types";
import type { ConvertToSqlWidgetAction } from "@/types/widgetActions";
import { groupWidgetItemKey } from "@/lib/workbench/resolveGroupWidgetItem";
import { resolveWidgetGroupIndex } from "@/lib/workbench/resolveWidgetGroupIndex";
import {
  normalizeWidgetGroupItemsList,
  WIDGET_GROUP_LAYOUT_VERSION,
  type WidgetGroupPayloadShape,
} from "./applyModifyGroupOperations";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";

export function applyConvertToSqlWidget(
  items: CanvasLayoutItem[],
  action: ConvertToSqlWidgetAction,
): WidgetActionReducerOutcome {
  const groupIdx = resolveWidgetGroupIndex(items, action.groupId);
  if (groupIdx < 0) {
    return {
      items,
      result: "not_found",
      toast: {
        title: "Group not found",
        description: `No dashboard group with id ${action.groupId}`,
        variant: "destructive",
      },
    };
  }

  const layoutItem = items[groupIdx];
  const payload = layoutItem.payload as WidgetGroupPayloadShape;
  const itemsList = normalizeWidgetGroupItemsList(payload);
  const targetIdx = itemsList.findIndex(
    (it, i) =>
      it.kind === "registry" &&
      (groupWidgetItemKey(it, i) === action.widgetId || it.defId === action.widgetId),
  );
  if (targetIdx < 0) {
    return {
      items,
      result: "not_found",
      toast: {
        title: "Widget not found",
        description: `No registry widget "${action.widgetId}" in that group`,
        variant: "destructive",
      },
    };
  }

  const oldKey = groupWidgetItemKey(itemsList[targetIdx], targetIdx);
  const newCohi: GroupWidgetItem = {
    kind: "cohi",
    id: `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sql: action.sql,
    title: action.title,
    vizConfig: action.vizConfig,
  };
  const updatedItems = itemsList.map((it, i) => (i === targetIdx ? newCohi : it));
  const newKey = groupWidgetItemKey(newCohi, targetIdx);
  const layouts = { ...(payload.widgetLayouts ?? {}) };
  if (layouts[oldKey]) {
    layouts[newKey] = layouts[oldKey];
    delete layouts[oldKey];
  }
  const nextPayload = {
    ...payload,
    items: updatedItems,
    widgetLayouts: Object.keys(layouts).length > 0 ? layouts : undefined,
    layoutVersion: WIDGET_GROUP_LAYOUT_VERSION,
  };

  const nextItems = items.map((it, i) =>
    i === groupIdx ? { ...layoutItem, payload: nextPayload } : it,
  );

  return {
    items: nextItems,
    result: "ok",
    toast: {
      title: "Widget converted",
      description:
        action.explanation?.substring(0, 80) || "Replaced with SQL-backed widget",
    },
  };
}
