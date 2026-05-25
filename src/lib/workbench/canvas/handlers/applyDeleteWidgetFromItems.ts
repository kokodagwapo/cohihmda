/**
 * Pure reducer for delete_widget against canvas layout items (grouped widgets).
 */
import type { GroupWidgetItem } from "@/components/workbench/canvas/types";
import {
  groupWidgetItemKey,
  resolveGroupWidgetItemIndex,
} from "@/lib/workbench/resolveGroupWidgetItem";

export const DELETE_WIDGET_LAYOUT_VERSION = 8;

export type LayoutItemLike = {
  i: string;
  payload?: {
    type?: string;
    items?: GroupWidgetItem[];
    widgetIds?: string[];
    widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
  };
};

export function applyDeleteWidgetFromItems(
  items: LayoutItemLike[],
  instanceId: string,
): { items: LayoutItemLike[]; removed: boolean } {
  const topIdx = items.findIndex((it) => it.i === instanceId);
  if (topIdx >= 0) {
    return {
      items: items.filter((_, i) => i !== topIdx),
      removed: true,
    };
  }

  let groupedRemoved = false;
  const nextItems = items.map((layoutItem) => {
    if (groupedRemoved) return layoutItem;
    const payload = layoutItem.payload;
    if (payload?.type !== "widget_group") return layoutItem;

    let itemsList: GroupWidgetItem[] = Array.isArray(payload.items)
      ? [...payload.items]
      : (payload.widgetIds ?? []).map((defId: string) => ({
          kind: "registry" as const,
          defId,
        }));

    const removeIdx = resolveGroupWidgetItemIndex(itemsList, instanceId);
    if (removeIdx < 0) return layoutItem;

    const oldKeys = itemsList.map((it, i) => groupWidgetItemKey(it, i));
    itemsList = itemsList.filter((_, i) => i !== removeIdx);

    let layouts: Record<string, { x: number; y: number; w: number; h: number }> = {
      ...(payload.widgetLayouts ?? {}),
    };
    const nextLayouts: Record<string, { x: number; y: number; w: number; h: number }> =
      {};
    itemsList.forEach((it, i) => {
      const newKey = groupWidgetItemKey(it, i);
      const oldKey = i < removeIdx ? oldKeys[i] : oldKeys[i + 1];
      if (layouts[oldKey]) nextLayouts[newKey] = layouts[oldKey];
    });
    layouts = nextLayouts;
    groupedRemoved = true;

    return {
      ...layoutItem,
      payload: {
        ...layoutItem.payload,
        items: itemsList,
        widgetLayouts: Object.keys(layouts).length > 0 ? layouts : undefined,
        layoutVersion: DELETE_WIDGET_LAYOUT_VERSION,
      },
    };
  });

  return { items: nextItems, removed: groupedRemoved };
}
