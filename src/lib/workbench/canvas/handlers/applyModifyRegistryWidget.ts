/**
 * Pure reducer for modify_registry_widget on a widget_group payload.
 */
import type { GroupWidgetItem } from "@/components/workbench/canvas/types";
import type { ModifyRegistryWidgetAction } from "@/types/widgetActions";
import { groupWidgetItemKey } from "@/lib/workbench/resolveGroupWidgetItem";

export type RegistryGroupPayloadShape = {
  type: "widget_group";
  groupId: string;
  widgetIds: string[];
  items?: GroupWidgetItem[];
  widgetLayouts?: Record<string, { x: number; y: number; w: number; h: number }>;
};

export function normalizeRegistryGroupItems(
  payload: RegistryGroupPayloadShape,
): GroupWidgetItem[] {
  if (Array.isArray(payload.items)) return [...payload.items];
  return (payload.widgetIds ?? []).map((defId) => ({
    kind: "registry" as const,
    defId,
  }));
}

export function applyModifyRegistryWidget(
  payload: RegistryGroupPayloadShape,
  action: Pick<ModifyRegistryWidgetAction, "widgetId" | "configOverrides">,
): { payload: RegistryGroupPayloadShape; found: boolean; isRegistry: boolean } {
  const itemsList = normalizeRegistryGroupItems(payload);
  const targetIdx = itemsList.findIndex(
    (it, i) =>
      it.kind === "registry" &&
      (groupWidgetItemKey(it, i) === action.widgetId || it.defId === action.widgetId),
  );
  if (targetIdx < 0) {
    return { payload, found: false, isRegistry: false };
  }
  const target = itemsList[targetIdx];
  if (target.kind !== "registry") {
    return { payload, found: true, isRegistry: false };
  }
  const updatedItems = itemsList.map((it, i) =>
    i === targetIdx && it.kind === "registry"
      ? {
          ...it,
          config: {
            ...(it.config ?? {}),
            ...action.configOverrides,
          },
        }
      : it,
  );
  return {
    payload: { ...payload, items: updatedItems },
    found: true,
    isRegistry: true,
  };
}
