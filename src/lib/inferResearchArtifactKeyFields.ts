import type { VisualizationConfig } from "@/hooks/useCohiChat";

/**
 * Derive `key_fields` for `research_artifacts` from viz config + optional explicit keys.
 */
export function inferResearchArtifactKeyFields(
  vizConfig: VisualizationConfig,
  explicit?: string[] | null,
): string[] {
  if (explicit?.length) return [...new Set(explicit.filter(Boolean))];
  const keys = new Set<string>();
  const vc = vizConfig as Record<string, unknown>;
  const add = (v: unknown) => {
    if (typeof v === "string" && v.trim()) keys.add(v.trim());
  };
  add(vc.xKey);
  add(vc.yKey);
  add(vc.nameKey);
  add(vc.valueKey);
  const yKeys = vc.yKeys;
  if (Array.isArray(yKeys)) {
    for (const y of yKeys) add(y);
  }
  const pivot = vc.pivotConfig as Record<string, unknown> | undefined;
  if (pivot) {
    add(pivot.rowKey);
    add(pivot.columnKey);
    add(pivot.valueKey);
  }
  const tableCols = (vc.tableConfig as { columns?: { key?: string }[] } | undefined)?.columns;
  if (Array.isArray(tableCols)) {
    for (const c of tableCols) {
      if (c?.key && typeof c.key === "string") keys.add(c.key);
    }
  }
  return Array.from(keys);
}
