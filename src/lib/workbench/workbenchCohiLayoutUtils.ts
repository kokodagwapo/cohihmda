/**
 * Shared layout helpers for Cohi workbench widget actions.
 */

import { computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import {
  createLayoutItem,
  type CanvasLayoutItem,
  type SectionType,
  type WidgetFilterConfig,
  type WidgetFilterState,
} from "@/components/workbench/canvas/types";

export function filterConfigToInitialState(
  fc: WidgetFilterConfig | undefined,
): WidgetFilterState | undefined {
  if (!fc || !fc.filterable) return undefined;
  const state: WidgetFilterState = {};
  if (fc.dateColumn && fc.dateColumn !== "application_date") {
    state.dateField = fc.dateColumn;
  }
  if (fc.defaultPreset) {
    try {
      computePresetDateRange(fc.defaultPreset as Parameters<typeof computePresetDateRange>[0]);
      state.preset = fc.defaultPreset;
    } catch {
      /* unknown preset */
    }
  }
  return Object.keys(state).length > 0 ? state : undefined;
}

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

  const groupSavedFilters =
    filterConfig.filterable && filterConfig.dateColumn
      ? {
          dateField: filterConfig.dateColumn,
          ...(filterConfig.defaultPreset
            ? { periodSelection: { preset: filterConfig.defaultPreset as "L12M" } }
            : {}),
        }
      : undefined;

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
