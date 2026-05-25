/**
 * Pure reducer for modify_group operations on a widget_group payload.
 */
import type { GroupWidgetItem } from "@/components/workbench/canvas/types";
import type { ModifyGroupAction } from "@/types/widgetActions";
import {
  groupWidgetItemKey,
  resolveGroupWidgetItemIndex,
} from "@/lib/workbench/resolveGroupWidgetItem";
import { buildGroupSavedFiltersFromFilterConfig } from "@/lib/workbench/workbenchPresetMapping";
import { filterConfigToInitialState } from "@/lib/workbench/workbenchPresetMapping";

export const WIDGET_GROUP_LAYOUT_VERSION = 8;

export type WidgetGroupPayloadShape = {
  type: "widget_group";
  groupId: string;
  title: string;
  sectionType: string;
  widgetIds: string[];
  items?: GroupWidgetItem[];
  widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
  layoutVersion?: number;
  savedFilters?: Record<string, unknown>;
};

export function normalizeWidgetGroupItemsList(
  payload: WidgetGroupPayloadShape,
): GroupWidgetItem[] {
  if (Array.isArray(payload.items)) return [...payload.items];
  return (payload.widgetIds ?? []).map((defId) => ({
    kind: "registry" as const,
    defId,
  }));
}

export function applyModifyGroupOperations(
  payload: WidgetGroupPayloadShape,
  operations: ModifyGroupAction["operations"],
): {
  payload: WidgetGroupPayloadShape;
  removeMissed: boolean;
} {
  let itemsList = normalizeWidgetGroupItemsList(payload);
  let layouts: Record<string, { x: number; y: number; w: number; h: number }> = {
    ...(payload.widgetLayouts ?? {}),
  };
  let groupTitle = payload.title;
  let savedFilters = payload.savedFilters
    ? { ...payload.savedFilters }
    : undefined;
  let removeMissed = false;

  for (const op of operations) {
    if (op.op === "add_registry") {
      const newItem: GroupWidgetItem = { kind: "registry", defId: op.defId };
      const idx = itemsList.length;
      itemsList.push(newItem);
      if (op.gridPosition) layouts[groupWidgetItemKey(newItem, idx)] = op.gridPosition;
    } else if (op.op === "add_cohi") {
      const id = `cohi-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const fc =
        op.filterConfig ??
        ({ filterable: true, dateColumn: "application_date" } as const);
      const newItem: GroupWidgetItem = {
        kind: "cohi",
        id,
        sql: op.sql,
        title: op.title,
        vizConfig: op.vizConfig,
        filterConfig: fc,
        allowLowSamplePullThrough: !!op.allowLowSamplePullThrough,
        savedFilters:
          fc.filterable !== false ? filterConfigToInitialState(fc) : undefined,
      };
      const idx = itemsList.length;
      itemsList.push(newItem);
      if (op.gridPosition) layouts[groupWidgetItemKey(newItem, idx)] = op.gridPosition;
    } else if (op.op === "remove") {
      const idx = resolveGroupWidgetItemIndex(itemsList, op.widgetId ?? "");
      if (idx < 0) removeMissed = true;
      if (idx >= 0) {
        const oldKeys = itemsList.map((it, i) => groupWidgetItemKey(it, i));
        itemsList = itemsList.filter((_, i) => i !== idx);
        const nextLayouts: Record<string, { x: number; y: number; w: number; h: number }> =
          {};
        itemsList.forEach((it, i) => {
          const newKey = groupWidgetItemKey(it, i);
          const oldKey = i < idx ? oldKeys[i] : oldKeys[i + 1];
          if (layouts[oldKey]) nextLayouts[newKey] = layouts[oldKey];
        });
        layouts = nextLayouts;
      }
    } else if (op.op === "resize" && op.widgetId && layouts[op.widgetId]) {
      layouts = {
        ...layouts,
        [op.widgetId]: { ...layouts[op.widgetId], w: op.w, h: op.h },
      };
    } else if (op.op === "reorder") {
      const keyToItem = new Map<string | undefined, GroupWidgetItem>();
      itemsList.forEach((it, i) => keyToItem.set(groupWidgetItemKey(it, i), it));
      const reordered = op.widgetIds
        .map((k) => keyToItem.get(k))
        .filter(Boolean) as GroupWidgetItem[];
      if (reordered.length === itemsList.length) {
        itemsList = reordered;
        const nextLayouts: Record<string, { x: number; y: number; w: number; h: number }> =
          {};
        itemsList.forEach((it, i) => {
          const newKey = groupWidgetItemKey(it, i);
          const oldKey = op.widgetIds[i];
          if (layouts[oldKey]) nextLayouts[newKey] = layouts[oldKey];
        });
        layouts = nextLayouts;
      }
    } else if (op.op === "set_title") {
      groupTitle = op.title;
    } else if (op.op === "set_filters") {
      savedFilters = { ...(savedFilters ?? {}), ...(op.filters ?? {}) };
    } else if (op.op === "set_period") {
      const built = buildGroupSavedFiltersFromFilterConfig({
        filterable: true,
        dateColumn: "application_date",
        defaultPreset: op.preset,
      });
      if (built) {
        savedFilters = { ...(savedFilters ?? {}), ...built, year: undefined };
      }
    } else if (op.op === "set_widget_title") {
      const idx = itemsList.findIndex(
        (it, i) => groupWidgetItemKey(it, i) === op.widgetId,
      );
      if (idx >= 0 && itemsList[idx].kind === "cohi") {
        itemsList[idx] = { ...itemsList[idx], title: op.title };
      }
    }
  }

  return {
    payload: {
      ...payload,
      title: groupTitle,
      savedFilters,
      items: itemsList,
      widgetLayouts: Object.keys(layouts).length > 0 ? layouts : undefined,
      layoutVersion: WIDGET_GROUP_LAYOUT_VERSION,
    },
    removeMissed,
  };
}
