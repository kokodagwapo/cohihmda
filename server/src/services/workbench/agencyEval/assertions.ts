export type WorkbenchActionLike = {
  type?: string;
  groupId?: string;
  widgetId?: string;
  operations?: Array<{ op?: string; defId?: string; widgetId?: string }>;
  configOverrides?: Record<string, unknown>;
};

export function expectActionType(
  actions: WorkbenchActionLike[],
  type: string,
): void {
  const found = actions.some((a) => a.type === type);
  if (!found) {
    throw new Error(`Expected action type "${type}", got ${actions.map((a) => a.type).join(", ")}`);
  }
}

export function expectChartType(
  actions: WorkbenchActionLike[],
  chartType: string,
): void {
  const hit = actions.find(
    (a) =>
      a.type === "modify_registry_widget" &&
      a.configOverrides?.chartType === chartType,
  );
  if (!hit) {
    throw new Error(`Expected modify_registry_widget chartType=${chartType}`);
  }
}

export function expectGroupOpRemove(
  actions: WorkbenchActionLike[],
  widgetIdFragment: string,
): void {
  const needle = widgetIdFragment.toLowerCase();
  const hit = actions.some(
    (a) =>
      a.type === "modify_group" &&
      a.operations?.some(
        (o) =>
          o.op === "remove" &&
          String(o.widgetId ?? "").toLowerCase().includes(needle),
      ),
  );
  if (!hit) {
    throw new Error(`Expected modify_group remove containing "${widgetIdFragment}"`);
  }
}

export function expectGroupOpAddRegistry(
  actions: WorkbenchActionLike[],
  defId: string,
): void {
  const hit = actions.some(
    (a) =>
      a.type === "modify_group" &&
      a.operations?.some((o) => o.op === "add_registry" && o.defId === defId),
  );
  if (!hit) {
    throw new Error(`Expected add_registry ${defId}`);
  }
}

export function expectNoCreateWidget(actions: WorkbenchActionLike[]): void {
  if (actions.some((a) => a.type === "create_widget" || a.type === "create_dashboard")) {
    throw new Error("Expected no create_widget/create_dashboard actions");
  }
}
