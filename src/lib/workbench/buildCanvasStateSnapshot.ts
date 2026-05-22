/**
 * Build canvas state snapshot for workbench Cohi (embedded + unified chat bridge).
 */

import type { CanvasStateSnapshot } from "@/types/widgetActions";
import type {
  CanvasLayoutItem,
  GroupWidgetItem,
} from "@/components/workbench/canvas/types";
import { useCanvasDataStore } from "@/stores/canvasDataStore";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { getWidgetDefinition } from "@/components/widgets/registry";

export function buildCanvasStateSnapshot(
  canvasItems: CanvasLayoutItem[],
  selectedWidgetId?: string | null,
): CanvasStateSnapshot {
  const groups: CanvasStateSnapshot["groups"] = [];
  const standaloneWidgets: CanvasStateSnapshot["standaloneWidgets"] = [];
  const sectionState = useWidgetSectionStore.getState().sections;

  for (const item of canvasItems) {
    if (item.payload.type === "widget_group") {
      const sectionFilters = sectionState[item.payload.groupId];
      const filters: CanvasStateSnapshot["groups"][0]["filters"] =
        sectionFilters
          ? {
              dateRange:
                sectionFilters.periodSelection?.preset ||
                (sectionFilters.dateRange
                  ? `${sectionFilters.dateRange.start} to ${sectionFilters.dateRange.end}`
                  : `${sectionFilters.year}`),
              dateField: sectionFilters.dateField || undefined,
              branch:
                sectionFilters.branch !== "all"
                  ? sectionFilters.branch
                  : undefined,
              loanOfficer:
                sectionFilters.loanOfficer !== "all"
                  ? sectionFilters.loanOfficer
                  : undefined,
            }
          : undefined;

      const groupItems =
        item.payload.items ??
        item.payload.widgetIds?.map((defId: string) => ({
          kind: "registry" as const,
          defId,
        })) ??
        [];
      const widgets: CanvasStateSnapshot["groups"][0]["widgets"] = [];

      function itemKey(groupItem: GroupWidgetItem, idx: number): string {
        if (groupItem.kind === "registry") return `${groupItem.defId}__${idx}`;
        return `cohi__${groupItem.id}__${idx}`;
      }

      groupItems.forEach((groupItem: GroupWidgetItem, idx: number) => {
        const key = itemKey(groupItem, idx);
        if (groupItem.kind === "registry") {
          const def = getWidgetDefinition(groupItem.defId);
          widgets.push({
            id: key,
            kind: "registry",
            defId: groupItem.defId,
            name: def?.name,
          });
        } else {
          widgets.push({
            id: key,
            kind: "cohi",
            title: groupItem.title,
            sql: groupItem.sql,
          });
        }
      });

      groups.push({
        groupId: item.payload.groupId,
        layoutId: item.i,
        title: item.payload.title,
        sectionType: item.payload.sectionType,
        widgetIds: item.payload.widgetIds,
        widgets: widgets.length > 0 ? widgets : undefined,
        widgetLayouts: item.payload.widgetLayouts,
        filters,
      });
    } else {
      const isCohiWidget = item.payload.type === "cohi_widget";
      const cohiPayload = isCohiWidget ? (item.payload as Record<string, unknown>) : undefined;
      standaloneWidgets.push({
        id: item.i,
        type: item.payload.type,
        title:
          "title" in item.payload
            ? (item.payload as { title?: string }).title
            : undefined,
        sourceType: cohiPayload?.sourceType as string | undefined,
        sourceSessionId: cohiPayload?.sourceSessionId as string | undefined,
        sourceArtifactId: cohiPayload?.sourceArtifactId as string | undefined,
        artifactCapabilities: cohiPayload?.artifactCapabilities as
          | Record<string, unknown>
          | undefined,
        filterConfig: cohiPayload?.filterConfig as Record<string, unknown> | undefined,
        savedFilters: cohiPayload?.savedFilters as Record<string, unknown> | undefined,
        sql: cohiPayload?.sql as string | undefined,
        sourceDashboard: cohiPayload?.sourceDashboard as string | undefined,
        selected: item.i === selectedWidgetId,
      });
    }
  }

  const dataSnapshot = useCanvasDataStore.getState().getSnapshot();
  const widgetData = dataSnapshot.map((entry) => ({
    itemId: entry.itemId,
    widgetName: entry.widgetName,
    category: entry.category,
    data: entry.data,
  }));

  return {
    groups,
    standaloneWidgets,
    totalItems: canvasItems.length,
    widgetData: widgetData.length > 0 ? widgetData : undefined,
  };
}
