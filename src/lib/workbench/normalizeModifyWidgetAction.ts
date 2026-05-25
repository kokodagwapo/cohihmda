/**
 * Normalize legacy modify_registry_widget actions to unified modify_widget shape.
 */
import type {
  ModifyRegistryWidgetAction,
  ModifyWidgetAction,
  RegistryModifyWidgetAction,
  WidgetAction,
} from "@/types/widgetActions";

export function isRegistryModifyAction(
  action: ModifyWidgetAction | ModifyRegistryWidgetAction,
): action is ModifyRegistryWidgetAction | RegistryModifyWidgetAction {
  if (action.type === "modify_registry_widget") return true;
  return (
    action.type === "modify_widget" &&
    (action.target === "registry" ||
      (!!action.groupId && !!action.widgetId && !!action.configPatch))
  );
}

export function normalizeRegistryModifyAction(
  action: ModifyWidgetAction | ModifyRegistryWidgetAction,
): RegistryModifyWidgetAction {
  if (action.type === "modify_registry_widget") {
    const legacy = action as ModifyRegistryWidgetAction & { chartType?: string };
    const base =
      legacy.configOverrides && Object.keys(legacy.configOverrides).length > 0
        ? { ...legacy.configOverrides }
        : {};
    const configPatch = legacy.chartType
      ? { ...base, chartType: legacy.chartType }
      : base;
    return {
      type: "modify_widget",
      target: "registry",
      groupId: legacy.groupId,
      widgetId: legacy.widgetId,
      configPatch,
      explanation: legacy.explanation,
    };
  }
  const unified = action as ModifyWidgetAction & { chartType?: string };
  const base = unified.configPatch ? { ...unified.configPatch } : {};
  const configPatch = unified.chartType
    ? { ...base, chartType: unified.chartType }
    : base;
  return {
    type: "modify_widget",
    target: "registry",
    groupId: unified.groupId!,
    widgetId: unified.widgetId!,
    configPatch,
    explanation: unified.explanation,
  };
}

/** Map legacy action types to unified modify_widget where applicable. */
export function normalizeWidgetActionsForExecution(
  actions: WidgetAction[],
): WidgetAction[] {
  return actions.map((a) => {
    if (a.type === "modify_registry_widget") {
      return normalizeRegistryModifyAction(a);
    }
    return a;
  });
}
