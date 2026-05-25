/**
 * Pure reducer for modify_widget on top-level cohi_widget or grouped cohi items.
 */
import type { CanvasLayoutItem, GroupWidgetItem } from "@/components/workbench/canvas/types";
import type { ModifyWidgetAction } from "@/types/widgetActions";
import type { VisualizationConfig } from "@/hooks/useCohiChat";
import { resolveGroupWidgetItemIndex } from "@/lib/workbench/resolveGroupWidgetItem";
import type { WidgetActionReducerOutcome } from "./widgetActionReducerTypes";

export type ModifyWidgetContext = {
  editingWidgetId?: string | null;
};

export function mergeVizConfigForModify(
  existingViz: Record<string, unknown>,
  action: Pick<ModifyWidgetAction, "changes" | "sql">,
): { mergedViz: Record<string, unknown>; shouldPersistVizConfig: boolean } {
  const hasSql = !!(action.sql && String(action.sql).trim());
  const changes = action.changes as Partial<typeof existingViz> & {
    tableConfig?: Record<string, unknown>;
  };
  const mergedVizBase =
    action.changes && Object.keys(action.changes).length > 0
      ? {
          ...existingViz,
          ...action.changes,
          ...(changes.tableConfig
            ? {
                tableConfig: {
                  ...(
                    existingViz as { tableConfig?: Record<string, unknown> }
                  ).tableConfig,
                  ...changes.tableConfig,
                },
              }
            : {}),
        }
      : existingViz;
  const isLikelyTableWidget =
    (existingViz as { type?: string }).type === "table" ||
    !!(existingViz as { tableConfig?: unknown }).tableConfig;
  const shouldRefreshTableColumnsFromData = hasSql && isLikelyTableWidget;
  const mergedViz = (() => {
    if (!shouldRefreshTableColumnsFromData) return mergedVizBase;
    const tableConfig = (
      mergedVizBase as { tableConfig?: Record<string, unknown> }
    ).tableConfig;
    if (!tableConfig || typeof tableConfig !== "object") return mergedVizBase;
    const { columns: _dropColumns, ...restTableConfig } = tableConfig as {
      columns?: unknown;
      [key: string]: unknown;
    };
    return {
      ...(mergedVizBase as Record<string, unknown>),
      tableConfig:
        Object.keys(restTableConfig).length > 0 ? restTableConfig : undefined,
    };
  })();
  const shouldPersistVizConfig =
    (action.changes && Object.keys(action.changes).length > 0) ||
    shouldRefreshTableColumnsFromData;
  return { mergedViz, shouldPersistVizConfig };
}

function applyCohiItemUpdates(
  groupItem: Extract<GroupWidgetItem, { kind: "cohi" }>,
  action: ModifyWidgetAction,
): Extract<GroupWidgetItem, { kind: "cohi" }> {
  const existingViz = (groupItem.vizConfig || {}) as Record<string, unknown>;
  const { mergedViz, shouldPersistVizConfig } = mergeVizConfigForModify(
    existingViz,
    action,
  );
  return {
    ...groupItem,
    ...(action.sql ? { sql: action.sql } : {}),
    ...(action.title ? { title: action.title } : {}),
    ...(shouldPersistVizConfig
      ? { vizConfig: mergedViz as VisualizationConfig }
      : {}),
  };
}

export function applyModifyWidget(
  items: CanvasLayoutItem[],
  action: ModifyWidgetAction,
  context?: ModifyWidgetContext,
): WidgetActionReducerOutcome {
  const targetIdx = items.findIndex((it) => it.i === action.instanceId);
  const editingWidgetId = context?.editingWidgetId ?? null;

  if (
    editingWidgetId &&
    action.instanceId !== editingWidgetId &&
    targetIdx < 0
  ) {
    return {
      items,
      result: "invalid",
      toast: {
        title: "Wrong widget",
        description:
          "Cohi tried to modify a widget that isn't on this canvas. Select the widget and use Edit with Cohi, or ask using its title.",
        variant: "destructive",
      },
    };
  }

  const hasSql = !!(action.sql && String(action.sql).trim());
  const hasChanges = action.changes && Object.keys(action.changes).length > 0;
  const hasTitle = !!(action.title && String(action.title).trim());
  if (!hasSql && !hasChanges && !hasTitle) {
    return {
      items,
      result: "invalid",
      toast: {
        title: "No changes applied",
        description:
          "Cohi didn't provide SQL or config changes. Try asking to remove a column or change the query explicitly.",
        variant: "destructive",
      },
    };
  }

  if (hasSql) {
    const trimmed = String(action.sql).trim();
    const upper = trimmed.toUpperCase();
    if (!upper.startsWith("SELECT") && !upper.startsWith("WITH")) {
      return {
        items,
        result: "invalid",
        toast: {
          title: "Invalid SQL",
          description:
            "Widget SQL must start with SELECT or WITH. The change was not applied.",
          variant: "destructive",
        },
      };
    }
  }

  if (targetIdx >= 0) {
    const target = items[targetIdx];
    if (target.payload.type !== "cohi_widget") {
      return {
        items,
        result: "invalid",
        toast: {
          title: "Cannot modify",
          description: "Only SQL-backed widgets can be modified via chat",
          variant: "destructive",
        },
      };
    }

    const existingViz = (target.payload.vizConfig || {}) as Record<
      string,
      unknown
    >;
    const { mergedViz, shouldPersistVizConfig } = mergeVizConfigForModify(
      existingViz,
      action,
    );
    const updated = [...items];
    updated[targetIdx] = {
      ...target,
      payload: {
        ...target.payload,
        ...(action.sql ? { sql: action.sql } : {}),
        ...(action.title ? { title: action.title } : {}),
        ...(shouldPersistVizConfig
          ? { vizConfig: mergedViz as typeof target.payload.vizConfig }
          : {}),
      },
    };
    return {
      items: updated,
      result: "ok",
      toast: {
        title: "Widget updated",
        description:
          action.explanation?.substring(0, 80) || "Changes applied",
      },
    };
  }

  let modifiedGrouped = false;
  const updatedItems = items.map((layoutItem) => {
    if (
      layoutItem.payload.type !== "widget_group" ||
      !Array.isArray((layoutItem.payload as { items?: unknown }).items)
    ) {
      return layoutItem;
    }
    const payload = layoutItem.payload as { items: GroupWidgetItem[] } & typeof layoutItem.payload;
    const matchIdx = resolveGroupWidgetItemIndex(
      payload.items,
      action.instanceId,
    );
    const nextGroupItems = payload.items.map((groupItem, idx) => {
      if (groupItem.kind !== "cohi" || idx !== matchIdx) {
        return groupItem;
      }
      modifiedGrouped = true;
      return applyCohiItemUpdates(groupItem, action);
    });
    if (!modifiedGrouped) return layoutItem;
    return {
      ...layoutItem,
      payload: {
        ...layoutItem.payload,
        items: nextGroupItems,
      },
    };
  });

  if (modifiedGrouped) {
    return {
      items: updatedItems,
      result: "ok",
      toast: {
        title: "Widget updated",
        description:
          action.explanation?.substring(0, 80) || "Changes applied",
      },
    };
  }

  return {
    items,
    result: "not_found",
    toast: {
      title: "Widget not found",
      description: `No widget with id ${action.instanceId}`,
      variant: "destructive",
    },
  };
}
