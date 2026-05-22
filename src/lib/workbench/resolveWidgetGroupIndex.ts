import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";

/**
 * Resolve a widget_group layout index from an LLM-provided group id.
 * Models may echo payload.groupId, layout item id (item.i), or group title.
 */
export function resolveWidgetGroupIndex(
  items: CanvasLayoutItem[],
  groupId: string,
): number {
  const needle = groupId?.trim();
  if (!needle) return -1;

  const byPayload = items.findIndex(
    (it) =>
      it.payload.type === "widget_group" &&
      (it.payload as { groupId: string }).groupId === needle,
  );
  if (byPayload >= 0) return byPayload;

  const byLayoutId = items.findIndex(
    (it) =>
      it.type === "widget_group" &&
      (it.i === needle || it.i === `canvas-${needle}`),
  );
  if (byLayoutId >= 0) return byLayoutId;

  const groups = items.filter((it) => it.payload.type === "widget_group");
  const normalized = needle.toLowerCase();
  const byTitle = groups.findIndex(
    (it) =>
      (it.payload as { title?: string }).title?.toLowerCase().trim() ===
      normalized,
  );
  if (byTitle >= 0) return items.indexOf(groups[byTitle]);

  if (groups.length === 1) return items.indexOf(groups[0]);

  return -1;
}
