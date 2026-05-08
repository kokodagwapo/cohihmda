/**
 * Filter structured workbench actions to known types (COHI-393 baseline).
 */

const KNOWN_ACTION_TYPES = new Set([
  "add_existing_widget",
  "create_widget",
  "create_canvas",
  "modify_widget",
  "delete_widget",
  "suggest_dashboard",
  "modify_group",
  "modify_registry_widget",
  "create_dashboard",
  "convert_to_sql_widget",
  "explain_widget",
  "explain_schema",
  "query_data",
  "generate_report",
]);

export function filterKnownWidgetActions(items: unknown[]): unknown[] {
  if (!Array.isArray(items)) return [];
  return items.filter(
    (x) =>
      x !== null &&
      typeof x === "object" &&
      "type" in x &&
      KNOWN_ACTION_TYPES.has(String((x as { type: unknown }).type)),
  );
}
