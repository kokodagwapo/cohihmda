import type { GroupWidgetItem } from "@/components/workbench/canvas/types";
import { getWidgetDefinition } from "@/components/widgets/registry";

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function groupWidgetItemKey(
  item: GroupWidgetItem,
  index: number,
): string {
  if (item.kind === "registry") return `${item.defId}__${index}`;
  return `cohi__${item.id}__${index}`;
}

/**
 * Resolve LLM-provided widget id / title to an index in a dashboard group.
 */
export function resolveGroupWidgetItemIndex(
  itemsList: GroupWidgetItem[],
  widgetIdRef: string,
): number {
  const needle = widgetIdRef.trim().toLowerCase();
  if (!needle) return -1;
  const needleNorm = normalizeLabel(needle);

  let idx = itemsList.findIndex(
    (it, i) => groupWidgetItemKey(it, i).toLowerCase() === needle,
  );
  if (idx >= 0) return idx;

  return itemsList.findIndex((it, i) => {
    const key = groupWidgetItemKey(it, i).toLowerCase();
    if (key === needle || key.includes(needle) || needle.includes(key)) {
      return true;
    }

    const labels: string[] = [];
    if (it.kind === "registry") {
      labels.push(it.defId);
      const def = getWidgetDefinition(it.defId);
      if (def?.name) labels.push(def.name);
    } else {
      if (it.title) labels.push(it.title);
    }

    return labels.some((label) => {
      const lower = label.toLowerCase();
      const norm = normalizeLabel(label);
      if (lower.includes(needle) || needle.includes(lower)) return true;
      if (needleNorm.length >= 4 && norm.includes(needleNorm)) return true;
      if (needleNorm.length >= 4 && needleNorm.includes(norm)) return true;
      return (
        needleNorm.includes("pullthrough") &&
        norm.includes("pullthrough")
      );
    });
  });
}
