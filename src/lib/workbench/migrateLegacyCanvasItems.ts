/**
 * One-shot migration: legacy chart/kpi/table/pinned_insight payloads → registry_widget.
 */
import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";
import {
  WORKBENCH_LEGACY_CHART_ID,
  WORKBENCH_LEGACY_KPI_ID,
  WORKBENCH_LEGACY_PINNED_ID,
  WORKBENCH_LEGACY_TABLE_ID,
} from "@/components/widgets/registry/legacyWorkbenchWidgets";

export function migrateLegacyCanvasItem(item: CanvasLayoutItem): CanvasLayoutItem {
  const p = item.payload;
  if (p.type === "chart") {
    return {
      ...item,
      type: "registry_widget",
      payload: {
        type: "registry_widget",
        definitionId: WORKBENCH_LEGACY_CHART_ID,
        config: { vizConfig: p.config },
      },
    };
  }
  if (p.type === "kpi") {
    return {
      ...item,
      type: "registry_widget",
      payload: {
        type: "registry_widget",
        definitionId: WORKBENCH_LEGACY_KPI_ID,
        config: {
          label: p.label,
          value: p.value,
          format: p.format,
        },
      },
    };
  }
  if (p.type === "table") {
    return {
      ...item,
      type: "registry_widget",
      payload: {
        type: "registry_widget",
        definitionId: WORKBENCH_LEGACY_TABLE_ID,
        config: {
          columns: p.columns,
          data: p.data,
        },
      },
    };
  }
  if (p.type === "pinned_insight") {
    return {
      ...item,
      type: "registry_widget",
      payload: {
        type: "registry_widget",
        definitionId: WORKBENCH_LEGACY_PINNED_ID,
        config: {
          title: p.title,
          content: p.content,
          visualization: p.visualization,
        },
      },
    };
  }
  return item;
}

export function migrateLegacyCanvasItems(
  items: CanvasLayoutItem[],
): CanvasLayoutItem[] {
  return items.map(migrateLegacyCanvasItem);
}
