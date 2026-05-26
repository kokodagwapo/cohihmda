import type { CanvasLayoutItem } from "@/components/workbench/canvas/types";
import { getWidgetDefinition } from "@/components/widgets/registry";

/** True when the user has not set a meaningful canvas name yet. */
export function isDefaultWorkbenchCanvasTitle(title: string): boolean {
  const t = title.trim().toLowerCase();
  return (
    !t ||
    t === "untitled canvas" ||
    t === "untitled" ||
    t === "new canvas"
  );
}

/**
 * Derive a display title from widgets/groups on the canvas (first save of a new board).
 */
export function suggestCanvasTitleFromLayout(items: CanvasLayoutItem[]): string {
  const names: string[] = [];

  for (const it of items) {
    const payload = it.payload;
    if (payload.type === "widget_group") {
      const title = payload.title?.trim();
      if (title && !/^cohi dashboard$/i.test(title)) {
        names.push(title);
      }
      continue;
    }
    if (payload.type === "cohi_widget") {
      const title = payload.title?.trim();
      if (title) names.push(title);
      continue;
    }
    if (payload.type === "registry_widget") {
      const def = getWidgetDefinition(payload.definitionId);
      if (def?.group) names.push(def.group);
      else if (def?.name) names.push(def.name);
    }
  }

  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (unique.length === 0) return "Workbench canvas";
  if (unique.length === 1) return unique[0];
  if (unique.length === 2) return `${unique[0]} & ${unique[1]}`;
  return `${unique[0]} + ${unique.length - 1} more`;
}
