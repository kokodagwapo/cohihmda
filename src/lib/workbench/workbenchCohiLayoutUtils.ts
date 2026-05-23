/**
 * Shared layout helpers for Cohi workbench widget actions.
 */

import {
  createLayoutItem,
  type CanvasLayoutItem,
  type SectionType,
  type WidgetFilterConfig,
} from "@/components/workbench/canvas/types";
import {
  buildGroupSavedFiltersFromFilterConfig,
  filterConfigToInitialState,
} from "@/lib/workbench/workbenchPresetMapping";

export { filterConfigToInitialState } from "@/lib/workbench/workbenchPresetMapping";

export function wrapCohiWidgetInGroup(
  action: {
    sql: string;
    title: string;
    config: Record<string, unknown>;
    explanation?: string;
    filterConfig?: WidgetFilterConfig;
    allowLowSamplePullThrough?: boolean;
  },
  idx: string,
  pos: { x: number; y: number; w: number; h: number },
): CanvasLayoutItem {
  const groupId = `cohi-group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const widgetId = `cohi-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`;
  const filterConfig: WidgetFilterConfig = action.filterConfig ?? {
    filterable: true,
    dateColumn: "application_date",
  };
  const initialFilters = filterConfigToInitialState(filterConfig);
  const groupSavedFilters = buildGroupSavedFiltersFromFilterConfig(filterConfig);

  return createLayoutItem(
    groupId,
    "widget_group",
    {
      type: "widget_group" as const,
      groupId,
      title: action.title,
      sectionType: "company-scorecard" as SectionType,
      widgetIds: [],
      items: [
        {
          kind: "cohi" as const,
          id: widgetId,
          sql: action.sql,
          title: action.title,
          vizConfig: action.config,
          explanation: action.explanation,
          filterConfig,
          allowLowSamplePullThrough: !!action.allowLowSamplePullThrough,
          savedFilters: initialFilters,
        },
      ],
      filterSync: true,
      ...(groupSavedFilters ? { savedFilters: groupSavedFilters } : {}),
    },
    pos,
  );
}
