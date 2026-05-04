import { format } from "date-fns";
import type { PeriodSelection } from "@/components/ui/DatePeriodPicker";
import { getPeriodPresetMeta } from "@/components/ui/DatePeriodPicker";
import type { WorkflowConversionMetric, WorkflowGrouping } from "@/hooks/useWorkflowConversionData";
import { DEFAULT_WORKFLOW_SEGMENTS } from "@/lib/workflowConversionMilestones";

export interface WorkflowConversionBookmarkPayload {
  cardCount: number;
  milestoneGroups: Array<[string, string]>;
  calculationType: "conversion_percent" | "turntime";
  groupingType: "workflow" | "individual";
  period: PeriodSelection;
}

export interface WorkflowConversionBookmark {
  id: string;
  name: string;
  payload: WorkflowConversionBookmarkPayload;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowConversionStateLike {
  segments: { from: string; to: string }[];
  calculationType: WorkflowConversionMetric;
  grouping: WorkflowGrouping;
  periodSelection: PeriodSelection;
}

export interface BookmarkRestoreResult {
  state: WorkflowConversionStateLike;
  hadInvalidMilestones: boolean;
}

const CALC_TO_BOOKMARK: Record<WorkflowConversionMetric, WorkflowConversionBookmarkPayload["calculationType"]> = {
  conversion: "conversion_percent",
  turn_time: "turntime",
};

const CALC_FROM_BOOKMARK: Record<WorkflowConversionBookmarkPayload["calculationType"], WorkflowConversionMetric> = {
  conversion_percent: "conversion",
  turntime: "turn_time",
};

function normalizeSegments(segments: { from: string; to: string }[]): { from: string; to: string }[] {
  return segments
    .filter((segment) => Boolean(segment?.from) && Boolean(segment?.to))
    .map((segment) => ({ from: segment.from, to: segment.to }));
}

function isPeriodSelection(value: unknown): value is PeriodSelection {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PeriodSelection>;
  if (!candidate.dateRange || typeof candidate.dateRange !== "object") return false;
  if (typeof candidate.dateRange.start !== "string" || typeof candidate.dateRange.end !== "string") return false;
  if (candidate.type === "year") return typeof candidate.year === "number";
  if (candidate.type === "preset" || candidate.type === "custom") return true;
  return false;
}

function formatYmdAsDisplay(ymd: string): string {
  if (!ymd || ymd.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const [y, m, d] = ymd.split("-").map(Number);
  return format(new Date(y, m - 1, d), "M/d/yyyy");
}

/** Human-readable period line for bookmark subtitles (uses stored date range when present). */
export function formatWorkflowBookmarkPeriodLabel(period: PeriodSelection): string {
  const { start, end } = period.dateRange;
  const rangeStr =
    start && end ? `${formatYmdAsDisplay(start)} – ${formatYmdAsDisplay(end)}` : "";

  if (period.type === "preset" && period.preset) {
    const { title } = getPeriodPresetMeta(period.preset);
    return rangeStr ? `${title} (${rangeStr})` : title;
  }
  if (period.type === "year" && period.year != null) {
    const base = `Year ${period.year}`;
    return rangeStr ? `${base} (${rangeStr})` : base;
  }
  if (period.type === "custom") {
    return rangeStr ? `Custom (${rangeStr})` : "Custom range";
  }
  return rangeStr || "Period";
}

export function workflowBookmarkCalculationLabel(
  calculationType: WorkflowConversionBookmarkPayload["calculationType"],
): string {
  return calculationType === "turntime" ? "Turn Time" : "Conversion %";
}

export function workflowBookmarkGroupingLabel(
  groupingType: WorkflowConversionBookmarkPayload["groupingType"],
): string {
  return groupingType === "individual" ? "Individual" : "Workflow";
}

/**
 * Ordered milestone ids for bookmark display: workflow chains omit duplicate handoffs;
 * individual lists every endpoint of every pair.
 */
export function milestoneIdsForBookmarkSubtitle(payload: WorkflowConversionBookmarkPayload): string[] {
  const pairs = (payload.milestoneGroups || []).filter(
    (pair): pair is [string, string] =>
      Array.isArray(pair) &&
      pair.length === 2 &&
      typeof pair[0] === "string" &&
      typeof pair[1] === "string",
  );
  if (pairs.length === 0) return [];

  if (payload.groupingType === "individual") {
    return pairs.flatMap(([from, to]) => [from, to]);
  }

  const out: string[] = [pairs[0][0]];
  for (const [, to] of pairs) {
    out.push(to);
  }
  return out;
}

export function formatWorkflowBookmarkMilestonesLine(
  payload: WorkflowConversionBookmarkPayload,
  labelOf: (milestoneId: string) => string,
): string {
  const ids = milestoneIdsForBookmarkSubtitle(payload);
  if (ids.length === 0) return "—";
  return ids.map((id) => labelOf(id)).join(", ");
}

export function stateToWorkflowBookmarkPayload(state: WorkflowConversionStateLike): WorkflowConversionBookmarkPayload {
  const normalized = normalizeSegments(state.segments);
  const groups = normalized.map((segment) => [segment.from, segment.to] as [string, string]);
  return {
    cardCount: groups.length,
    milestoneGroups: groups,
    calculationType: CALC_TO_BOOKMARK[state.calculationType] ?? "conversion_percent",
    groupingType: state.grouping === "individual" ? "individual" : "workflow",
    period: state.periodSelection,
  };
}

export function normalizeWorkflowBookmarks(raw: unknown): WorkflowConversionBookmark[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is WorkflowConversionBookmark => {
      if (!item || typeof item !== "object") return false;
      const bookmark = item as Partial<WorkflowConversionBookmark>;
      if (typeof bookmark.id !== "string" || typeof bookmark.name !== "string") return false;
      if (!bookmark.payload || typeof bookmark.payload !== "object") return false;
      const payload = bookmark.payload as Partial<WorkflowConversionBookmarkPayload>;
      if (!Array.isArray(payload.milestoneGroups)) return false;
      if (!isPeriodSelection(payload.period)) return false;
      return true;
    })
    .map((bookmark) => {
      const payload = bookmark.payload;
      const milestoneGroups = Array.isArray(payload.milestoneGroups)
        ? payload.milestoneGroups.filter(
            (pair): pair is [string, string] =>
              Array.isArray(pair) &&
              pair.length === 2 &&
              typeof pair[0] === "string" &&
              typeof pair[1] === "string",
          )
        : [];
      const cardCount = typeof payload.cardCount === "number" && Number.isFinite(payload.cardCount)
        ? Math.max(0, Math.floor(payload.cardCount))
        : milestoneGroups.length;
      const calculationType = payload.calculationType === "turntime" ? "turntime" : "conversion_percent";
      const groupingType = payload.groupingType === "individual" ? "individual" : "workflow";
      const period: PeriodSelection = isPeriodSelection(payload.period)
        ? payload.period
        : {
            type: "preset",
            preset: "mtd",
            dateRange: { start: "", end: "" },
          };
      return {
        id: bookmark.id,
        name: bookmark.name,
        createdAt: typeof bookmark.createdAt === "string" ? bookmark.createdAt : new Date().toISOString(),
        updatedAt: typeof bookmark.updatedAt === "string" ? bookmark.updatedAt : new Date().toISOString(),
        payload: {
          cardCount,
          milestoneGroups,
          calculationType,
          groupingType,
          period,
        },
      };
    });
}

export function workflowBookmarkPayloadToState(
  payload: WorkflowConversionBookmarkPayload,
  validMilestoneIds: Set<string>,
  defaultPeriodSelection: PeriodSelection,
): BookmarkRestoreResult {
  const fallbackSegments = [...DEFAULT_WORKFLOW_SEGMENTS];
  let hadInvalidMilestones = false;

  const candidatePairs = Array.isArray(payload.milestoneGroups) ? payload.milestoneGroups : [];
  const validatedSegments = candidatePairs
    .filter((pair): pair is [string, string] => Array.isArray(pair) && pair.length === 2)
    .map(([from, to]) => {
      const valid = validMilestoneIds.has(from) && validMilestoneIds.has(to) && from !== to;
      if (!valid) hadInvalidMilestones = true;
      return valid ? { from, to } : null;
    })
    .filter((segment): segment is { from: string; to: string } => segment !== null);

  const targetCount = typeof payload.cardCount === "number" && payload.cardCount > 0
    ? Math.floor(payload.cardCount)
    : validatedSegments.length;
  const baseSegments = validatedSegments.length > 0 ? validatedSegments : fallbackSegments;
  const segments = baseSegments.slice(0, Math.max(1, targetCount));
  const period = isPeriodSelection(payload.period) ? payload.period : defaultPeriodSelection;

  return {
    state: {
      segments,
      calculationType: CALC_FROM_BOOKMARK[payload.calculationType] ?? "conversion",
      grouping: payload.groupingType === "individual" ? "individual" : "workflow",
      periodSelection: period,
    },
    hadInvalidMilestones,
  };
}
