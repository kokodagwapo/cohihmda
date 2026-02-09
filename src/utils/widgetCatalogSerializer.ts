/**
 * Widget Catalog Serializer
 *
 * Serializes the widget registry into a compact text format (~2-3 KB)
 * suitable for injection into LLM prompts. This gives Cohi awareness
 * of all 67+ existing widgets across 9 dashboard groups.
 */

import {
  getAllWidgets,
  getWidgetGroups,
  getWidgetsByGroup,
} from '@/components/widgets/registry';

/**
 * Serialize the full widget catalog into an LLM-friendly text block.
 * Cached after first call since the registry is static.
 */
let _cached: string | null = null;

export function serializeWidgetCatalog(): string {
  if (_cached) return _cached;

  const groups = getWidgetGroups();
  const lines: string[] = ['## AVAILABLE DASHBOARD WIDGETS\n'];

  for (const group of groups) {
    const widgets = getWidgetsByGroup(group);
    lines.push(`### ${group} (${widgets.length} widgets)`);
    for (const w of widgets) {
      lines.push(
        `- ${w.id}: "${w.name}" [${w.category}] source=${w.dataSource}`
      );
    }
    lines.push('');
  }

  lines.push(`Total: ${getAllWidgets().length} widgets across ${groups.length} dashboard groups.`);

  _cached = lines.join('\n');
  return _cached;
}

/**
 * Get a compact JSON summary of the catalog (for structured contexts).
 */
export function getWidgetCatalogJson(): {
  groups: { name: string; widgets: { id: string; name: string; category: string; dataSource: string }[] }[];
  totalWidgets: number;
} {
  const groups = getWidgetGroups();
  return {
    groups: groups.map((g) => ({
      name: g,
      widgets: getWidgetsByGroup(g).map((w) => ({
        id: w.id,
        name: w.name,
        category: w.category,
        dataSource: w.dataSource,
      })),
    })),
    totalWidgets: getAllWidgets().length,
  };
}
