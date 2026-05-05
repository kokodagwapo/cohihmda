import React, { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { DatePeriodPicker, computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import type { PeriodSelection, PeriodPreset } from "@/components/ui/DatePeriodPicker";
import {
  DEFAULT_WORKFLOW_SEGMENTS,
  isOrderValidWithMilestones,
} from "@/lib/workflowConversionMilestones";
import { useWorkflowMilestones } from "@/hooks/useWorkflowMilestones";
import { useWorkflowConversionData, type WorkflowConversionMetric, type WorkflowGrouping, type SegmentResult } from "@/hooks/useWorkflowConversionData";
import {
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  ComposedChart,
  Tooltip,
} from "recharts";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { AlertCircle, Check, ChevronsUpDown, Loader2, Maximize2, Minus, Plus, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { WorkflowSegmentLoansModal } from "@/components/views/WorkflowSegmentLoansModal";
import type { WorkflowSegmentLoanFilter } from "@/hooks/useWorkflowConversionSegmentLoans";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import { api } from "@/lib/api";
import {
  useDashboardInsights,
  type DashboardInsightItem,
} from "@/hooks/useDashboardInsights";
import { DashboardInsightsStrip } from "@/components/dashboard/DashboardInsightsStrip";
import { useWorkflowConversionBookmarks } from "@/hooks/useWorkflowConversionBookmarks";
import {
  stateToWorkflowBookmarkPayload,
  workflowBookmarkPayloadToState,
  formatWorkflowBookmarkPeriodLabel,
  workflowBookmarkCalculationLabel,
  workflowBookmarkGroupingLabel,
  formatWorkflowBookmarkMilestonesLine,
  type WorkflowConversionBookmark,
} from "@/utils/workflowConversionBookmarks";

const PERIOD_PRESETS: PeriodPreset[] = [
  "mtd",
  "last-month",
  "qtd",
  "last-quarter",
  "ytd",
  "last-year",
];

const INVALID_MESSAGE =
  "Please select two different date stages (From and To must differ).";

/** Maps stored insight filter_context.datePeriod to DatePeriodPicker presets (aligned with loan complexity). */
const INSIGHT_DATE_PERIOD_TO_PRESET: Record<string, PeriodPreset> = {
  mtd: "mtd",
  qtd: "qtd",
  ytd: "ytd",
  lm: "last-month",
  lq: "last-quarter",
  ly: "last-year",
};

function segmentAnchorLabel(
  fromId: string,
  toId: string,
  milestones: { id: string; label: string }[]
): string {
  const a = milestones.find((m) => m.id === fromId)?.label ?? fromId;
  const b = milestones.find((m) => m.id === toId)?.label ?? toId;
  return `${a} → ${b}`;
}

function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(now, "yyyy-MM-dd"),
  };
}

function makeBookmarkId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `bookmark_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Persisted state for the workflow conversion widget (survives canvas save/reload). */
export interface WorkflowConversionSavedState {
  segments?: { from: string; to: string }[];
  calculationType?: WorkflowConversionMetric;
  grouping?: WorkflowGrouping;
  periodSelection?: PeriodSelection;
}

export interface WorkflowConversionViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
  /** When true, show +/- buttons to add/remove cards (workbench only). */
  embeddedInWorkbench?: boolean;
  /** Restored state from saved canvas (period, segments, calculation type, grouping). */
  initialState?: WorkflowConversionSavedState;
  /** Called when state changes (debounced) so the parent can persist it. */
  onStateChange?: (state: WorkflowConversionSavedState) => void;
  /** When set (workbench group), group filters (branch, loan officer, dynamic filters) are applied to data. */
  groupId?: string | null;
  /** Report data to canvasDataStore for PowerPoint export. */
  onDataReady?: (payload: unknown) => void;
}

const DEBOUNCE_MS = 300;
const PAGE_STATE_STORAGE_KEY = "cohi-workflow-conversion-page-state-v1";

interface WorkflowConversionPageStateSnapshot {
  payload: ReturnType<typeof stateToWorkflowBookmarkPayload>;
  selectedBookmarkId: string | null;
}

function makePageStateStorageScopeKey(
  selectedTenantId?: string | null,
  selectedChannel?: string | null,
): string {
  const tenant = selectedTenantId ?? "default-tenant";
  const channel = selectedChannel ?? "all";
  return `${tenant}::${channel}`;
}

function safeReadPageStateSnapshot(
  scopeKey: string,
): WorkflowConversionPageStateSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PAGE_STATE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, WorkflowConversionPageStateSnapshot>;
    const candidate = parsed?.[scopeKey];
    if (!candidate || typeof candidate !== "object" || !candidate.payload) return null;
    return {
      payload: candidate.payload,
      selectedBookmarkId: typeof candidate.selectedBookmarkId === "string" ? candidate.selectedBookmarkId : null,
    };
  } catch {
    return null;
  }
}

function safeWritePageStateSnapshot(
  scopeKey: string,
  snapshot: WorkflowConversionPageStateSnapshot,
) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(PAGE_STATE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, WorkflowConversionPageStateSnapshot>) : {};
    parsed[scopeKey] = snapshot;
    window.localStorage.setItem(PAGE_STATE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore localStorage write failures
  }
}

export function WorkflowConversionView({
  selectedTenantId,
  selectedChannel,
  embeddedInWorkbench = false,
  initialState,
  onStateChange,
  groupId,
  onDataReady,
}: WorkflowConversionViewProps) {
  const defaultPeriod: PeriodSelection = useMemo(() => {
    const range = getDefaultDateRange();
    return { type: "preset", preset: "mtd", dateRange: range };
  }, []);
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(
    () => initialState?.periodSelection ?? defaultPeriod
  );
  const [calculationType, setCalculationType] = useState<WorkflowConversionMetric>(
    () => initialState?.calculationType ?? "conversion"
  );
  const [grouping, setGrouping] = useState<WorkflowGrouping>(
    () => initialState?.grouping ?? "workflow"
  );
  const [segments, setSegments] = useState<{ from: string; to: string }[]>(() =>
    initialState?.segments && initialState.segments.length > 0
      ? [...initialState.segments]
      : [...DEFAULT_WORKFLOW_SEGMENTS]
  );

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFirstMountRef = useRef(true);

  const [generateLoading, setGenerateLoading] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [pendingInsightWidgetId, setPendingInsightWidgetId] = useState<string | null>(null);
  const [bookmarksModalOpen, setBookmarksModalOpen] = useState(false);
  const [saveBookmarkOpen, setSaveBookmarkOpen] = useState(false);
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false);
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<string | null>(null);
  const [saveBookmarkName, setSaveBookmarkName] = useState("");
  const [editingBookmarkId, setEditingBookmarkId] = useState<string | null>(null);
  const [editingBookmarkName, setEditingBookmarkName] = useState("");
  const [bookmarkRestoreWarning, setBookmarkRestoreWarning] = useState<string | null>(null);
  const stateHydratedRef = useRef(false);
  const lastHydratedScopeRef = useRef<string | null>(null);
  const pageStateScopeKey = useMemo(
    () => makePageStateStorageScopeKey(selectedTenantId, selectedChannel),
    [selectedTenantId, selectedChannel],
  );

  const {
    bookmarks,
    isLoading: bookmarksLoading,
    saveAll: saveAllBookmarks,
  } = useWorkflowConversionBookmarks();

  const dashboardInsightFilters = useMemo(() => ({}), []);
  const {
    insights: dashboardInsights,
    generatedAt: dashboardInsightsGeneratedAt,
    loading: dashboardInsightsLoading,
    refresh: refreshDashboardInsights,
  } = useDashboardInsights("workflow-conversion", dashboardInsightFilters, {
    tenantId: selectedTenantId,
    enabled: !embeddedInWorkbench,
  });

  const dateRange = periodSelection.dateRange;
  const { milestones, loading: milestonesLoading, error: milestonesError } = useWorkflowMilestones(selectedTenantId);

  const handleGenerateInsights = useCallback(async () => {
    setGenerateLoading(true);
    setGenerateError(null);
    try {
      const tenantParam = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : "";
      await api.request<{
        insights: DashboardInsightItem[];
        count: number;
        pageId: string;
        pageName: string;
        generationBatch: string;
      }>(`/api/dashboard-insights/generate${tenantParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageId: "workflow-conversion",
          filters: {},
        }),
      });
      await refreshDashboardInsights();
    } catch (err: unknown) {
      setGenerateError(
        err instanceof Error ? err.message : "We couldn't generate insights right now. Please try again later."
      );
    } finally {
      setGenerateLoading(false);
    }
  }, [refreshDashboardInsights, selectedTenantId]);

  const handleShowInsight = useCallback(
    (insight: DashboardInsightItem) => {
      const fc = insight.filter_context ?? {};
      const datePeriod = typeof fc.datePeriod === "string" ? fc.datePeriod.toLowerCase() : null;
      const preset = datePeriod ? INSIGHT_DATE_PERIOD_TO_PRESET[datePeriod] : undefined;
      if (preset) {
        setPeriodSelection({
          type: "preset",
          preset,
          dateRange: computePresetDateRange(preset),
        });
      }

      const calc = fc.calculationType;
      if (calc === "conversion" || calc === "turn_time") {
        setCalculationType(calc as WorkflowConversionMetric);
      }

      setGrouping("workflow");
      setSegments([...DEFAULT_WORKFLOW_SEGMENTS]);

      let scrollId: string | null = null;
      for (const ref of insight.evidence_refs ?? []) {
        if (ref.widgetId?.startsWith("workflow-conversion-segment-")) {
          scrollId = ref.widgetId;
          break;
        }
      }
      if (
        !scrollId &&
        typeof fc.segmentIndex === "number" &&
        fc.segmentIndex >= 0 &&
        fc.segmentIndex <= 5
      ) {
        scrollId = `workflow-conversion-segment-${Math.floor(fc.segmentIndex)}`;
      }
      const norm = (s: string) => s.trim().replace(/\s+/g, " ");
      const tryLabel = (label: string | undefined) => {
        if (!label) return;
        const want = norm(label);
        const idx = DEFAULT_WORKFLOW_SEGMENTS.findIndex(
          (seg) => norm(segmentAnchorLabel(seg.from, seg.to, milestones)) === want
        );
        if (idx >= 0) scrollId = `workflow-conversion-segment-${idx}`;
      };
      if (!scrollId && typeof fc.segmentLabel === "string") tryLabel(fc.segmentLabel);
      if (!scrollId) tryLabel(insight.evidence_refs?.[0]?.target?.label);

      setPendingInsightWidgetId(scrollId);
    },
    [milestones]
  );

  const handleDashboardInsightFeedback = useCallback(
    async (insightId: number, rating: 1 | -1, tags?: string[], comment?: string) => {
      try {
        await api.submitDashboardInsightFeedback(insightId, rating, tags, comment, selectedTenantId);
        return true;
      } catch {
        return false;
      }
    },
    [selectedTenantId]
  );

  useEffect(() => {
    if (!onStateChange) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onStateChange({
        segments: segments.length > 0 ? segments : undefined,
        calculationType,
        grouping,
        periodSelection,
      });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [segments, calculationType, grouping, periodSelection, onStateChange]);

  const groupFilters = useWidgetSectionStore((s) => (groupId ? s.getFilters(groupId) : null));
  const dimensionFilters = useMemo((): Array<{ column: string; value: string }> | undefined => {
    if (!groupFilters) return undefined;
    const dims: Array<{ column: string; value: string }> = [];
    if (groupFilters.branch && groupFilters.branch !== "all") {
      dims.push({ column: "branch", value: groupFilters.branch });
    }
    if (groupFilters.loanOfficer && groupFilters.loanOfficer !== "all") {
      dims.push({ column: "loan_officer", value: groupFilters.loanOfficer });
    }
    (groupFilters.dynamicFilters || []).forEach((df) => {
      if (df.value && df.value !== "all") dims.push({ column: df.column, value: df.value });
    });
    return dims.length > 0 ? dims : undefined;
  }, [groupFilters?.branch, groupFilters?.loanOfficer, groupFilters?.dynamicFilters]);

  const { data, loading, error } = useWorkflowConversionData({
    startDate: dateRange.start,
    endDate: dateRange.end,
    segments,
    metric: calculationType,
    grouping,
    selectedTenantId,
    channelGroup: selectedChannel,
    dimensionFilters,
  });

  const milestoneIdSet = useMemo(() => new Set(milestones.map((milestone) => milestone.id)), [milestones]);

  useEffect(() => {
    if (lastHydratedScopeRef.current !== pageStateScopeKey) {
      stateHydratedRef.current = false;
      lastHydratedScopeRef.current = pageStateScopeKey;
    }
    // Wait until milestones are loaded before validating/restoring saved segment pairs.
    // Otherwise an empty milestone set makes valid saved pairs look "invalid" and resets to defaults.
    if (embeddedInWorkbench || stateHydratedRef.current || milestonesLoading) return;
    const snapshot = safeReadPageStateSnapshot(pageStateScopeKey);
    if (!snapshot) {
      stateHydratedRef.current = true;
      return;
    }
    const restore = workflowBookmarkPayloadToState(
      snapshot.payload,
      milestoneIdSet,
      defaultPeriod,
    );
    setPeriodSelection(restore.state.periodSelection);
    setCalculationType(restore.state.calculationType);
    setGrouping(restore.state.grouping);
    setSegments(restore.state.segments);
    setSelectedBookmarkId(snapshot.selectedBookmarkId);
    setBookmarkRestoreWarning(
      restore.hadInvalidMilestones
        ? "Some saved milestone steps are unavailable and were reset."
        : null,
    );
    stateHydratedRef.current = true;
  }, [embeddedInWorkbench, pageStateScopeKey, milestoneIdSet, defaultPeriod, milestonesLoading]);

  const bookmarkMilestoneLabel = useCallback(
    (milestoneId: string) => milestones.find((m) => m.id === milestoneId)?.label ?? milestoneId,
    [milestones],
  );

  const currentBookmarkPayload = useMemo(
    () =>
      stateToWorkflowBookmarkPayload({
        segments,
        calculationType,
        grouping,
        periodSelection,
      }),
    [segments, calculationType, grouping, periodSelection],
  );

  useEffect(() => {
    if (embeddedInWorkbench || !stateHydratedRef.current) return;
    safeWritePageStateSnapshot(pageStateScopeKey, {
      payload: currentBookmarkPayload,
      selectedBookmarkId,
    });
  }, [embeddedInWorkbench, pageStateScopeKey, currentBookmarkPayload, selectedBookmarkId]);

  const selectedBookmark = useMemo(
    () => bookmarks.find((bookmark) => bookmark.id === selectedBookmarkId) ?? null,
    [bookmarks, selectedBookmarkId],
  );

  const bookmarkInSync = useMemo(() => {
    if (!selectedBookmark) return false;
    return JSON.stringify(selectedBookmark.payload) === JSON.stringify(currentBookmarkPayload);
  }, [selectedBookmark, currentBookmarkPayload]);

  const saveBookmarksAndMaybeSelect = useCallback(
    async (nextBookmarks: WorkflowConversionBookmark[], nextSelected?: string | null) => {
      await saveAllBookmarks(nextBookmarks);
      if (typeof nextSelected !== "undefined") {
        setSelectedBookmarkId(nextSelected);
      }
    },
    [saveAllBookmarks],
  );

  const applyBookmark = useCallback(
    (bookmark: WorkflowConversionBookmark) => {
      const restore = workflowBookmarkPayloadToState(
        bookmark.payload,
        milestoneIdSet,
        defaultPeriod,
      );
      setPeriodSelection(restore.state.periodSelection);
      setCalculationType(restore.state.calculationType);
      setGrouping(restore.state.grouping);
      setSegments(restore.state.segments);
      setSelectedBookmarkId(bookmark.id);
      setBookmarkRestoreWarning(
        restore.hadInvalidMilestones
          ? "Some milestone steps in this bookmark are unavailable and were skipped."
          : null,
      );
      setBookmarksModalOpen(false);
    },
    [defaultPeriod, milestoneIdSet],
  );

  const handleCreateBookmark = useCallback(async () => {
    const trimmedName = saveBookmarkName.trim();
    if (!trimmedName) return;
    const now = new Date().toISOString();
    const bookmark: WorkflowConversionBookmark = {
      id: makeBookmarkId(),
      name: trimmedName,
      payload: currentBookmarkPayload,
      createdAt: now,
      updatedAt: now,
    };
    await saveBookmarksAndMaybeSelect([...bookmarks, bookmark], bookmark.id);
    setSaveBookmarkOpen(false);
    setSaveBookmarkName("");
  }, [saveBookmarkName, currentBookmarkPayload, saveBookmarksAndMaybeSelect, bookmarks]);

  const handleOverwriteSelectedBookmark = useCallback(async () => {
    if (!selectedBookmark) return;
    const now = new Date().toISOString();
    const next = bookmarks.map((bookmark) =>
      bookmark.id === selectedBookmark.id
        ? { ...bookmark, payload: currentBookmarkPayload, updatedAt: now }
        : bookmark,
    );
    await saveBookmarksAndMaybeSelect(next, selectedBookmark.id);
    setOverwriteModalOpen(false);
  }, [selectedBookmark, bookmarks, currentBookmarkPayload, saveBookmarksAndMaybeSelect]);

  const handleDeleteBookmark = useCallback(
    async (bookmarkId: string) => {
      const next = bookmarks.filter((bookmark) => bookmark.id !== bookmarkId);
      const nextSelected = selectedBookmarkId === bookmarkId ? null : selectedBookmarkId;
      await saveBookmarksAndMaybeSelect(next, nextSelected);
    },
    [bookmarks, selectedBookmarkId, saveBookmarksAndMaybeSelect],
  );

  const handleRenameBookmark = useCallback(
    async (bookmarkId: string, nextName: string) => {
      const trimmed = nextName.trim();
      if (!trimmed) return;
      const existing = bookmarks.find((bookmark) => bookmark.id === bookmarkId);
      if (!existing || existing.name === trimmed) {
        setEditingBookmarkId(null);
        setEditingBookmarkName("");
        return;
      }
      const now = new Date().toISOString();
      const next = bookmarks.map((bookmark) =>
        bookmark.id === bookmarkId ? { ...bookmark, name: trimmed, updatedAt: now } : bookmark,
      );
      await saveBookmarksAndMaybeSelect(next);
      setEditingBookmarkId(null);
      setEditingBookmarkName("");
    },
    [bookmarks, saveBookmarksAndMaybeSelect],
  );

  const updateSegment = useCallback((index: number, field: "from" | "to", value: string) => {
    setSegments((prev) => {
      const next = prev.map((s, i) => (i === index ? { ...s, [field]: value } : s));
      if (grouping !== "workflow") return next;
      // In workflow mode, keep the chain in sync: segment[i].to === segment[i+1].from
      if (field === "to" && index + 1 < next.length) {
        next[index + 1] = { ...next[index + 1], from: value };
      } else if (field === "from" && index > 0) {
        next[index - 1] = { ...next[index - 1], to: value };
      }
      return next;
    });
  }, [grouping]);

  const resetToDefault = useCallback(() => {
    setPeriodSelection({
      type: "preset",
      preset: "mtd",
      dateRange: computePresetDateRange("mtd"),
    });
    setCalculationType("conversion");
    setGrouping("workflow");
    setSegments([...DEFAULT_WORKFLOW_SEGMENTS]);
    setSelectedBookmarkId(null);
    setBookmarkRestoreWarning(null);
  }, []);

  const maxCardsCap = Math.max(1, (milestones?.length ?? 20) - 1);

  const addCard = useCallback(() => {
    setSegments((prev) => {
      if (prev.length === 0 && milestones.length >= 2) {
        return [{ from: milestones[0].id, to: milestones[1].id }];
      }
      if (prev.length === 0) return [DEFAULT_WORKFLOW_SEGMENTS[0]];
      if (grouping === "workflow" && prev.length >= maxCardsCap) return prev;
      const last = prev[prev.length - 1];
      if (grouping === "individual" || milestones.length < 2) {
        return [...prev, { ...DEFAULT_WORKFLOW_SEGMENTS[0] }];
      }
      const fromIdx = milestones.findIndex((m) => m.id === last.to);
      const nextId = fromIdx >= 0 && fromIdx < milestones.length - 1 ? milestones[fromIdx + 1].id : milestones[1]?.id;
      return [...prev, { from: last.to, to: nextId ?? last.to }];
    });
  }, [grouping, milestones, maxCardsCap]);

  const removeCard = useCallback(() => {
    setSegments((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);

  const canAddCard =
    segments.length > 0 &&
    (grouping === "individual" || segments.length < maxCardsCap);
  const canRemoveCard = segments.length > 1;

  const getFromOptions = useCallback(
    (index: number) => {
      const currentTo = segments[index]?.to;
      return currentTo
        ? milestones.filter((m) => m.id !== currentTo)
        : milestones;
    },
    [milestones, segments],
  );
  const getToOptions = useCallback(
    (fromId: string) => milestones.filter((m) => m.id !== fromId),
    [milestones],
  );

  const segmentResults = data?.segments ?? [];

  useEffect(() => {
    if (!onDataReady || loading || segmentResults.length === 0) return;
    const labelOf = (id: string) => milestones.find((m) => m.id === id)?.label ?? id;
    const formatPeriodLabel = (value: unknown) => {
      if (typeof value !== 'string' || !value) return String(value ?? '');
      if (value.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const [y, m, d] = value.split('-').map(Number);
        return format(new Date(y, m - 1, d), 'M/d');
      }
      return value;
    };
    const columns = [
      { key: 'segment', label: 'Segment', align: 'left' as const },
      { key: 'left', label: 'From Count', align: 'right' as const },
      { key: 'right', label: 'To Count', align: 'right' as const },
      { key: 'metric', label: calculationType === 'conversion' ? 'Conversion %' : 'Avg Turn Time (days)', align: 'right' as const },
    ];
    const rows = segments.map((seg, i) => {
      const r = segmentResults[i];
      return {
        segment: `${labelOf(seg.from)} → ${labelOf(seg.to)}`,
        left: r ? r.leftCount.toLocaleString() : '—',
        right: r ? r.rightCount.toLocaleString() : '—',
        metric: r
          ? calculationType === 'conversion'
            ? `${(r.conversionPercent ?? 0).toFixed(1)}%`
            : `${(r.avgTurnTimeDays ?? 0).toFixed(1)}`
          : '—',
      };
    });
    const charts = segments.map((seg, i) => {
      const result = segmentResults[i];
      const fromLabel = labelOf(seg.from);
      const toLabel = labelOf(seg.to);
      const metricKey =
        calculationType === 'conversion' ? 'conversionPercent' : 'avgTurnTimeDays';
      const metricLabel =
        calculationType === 'conversion' ? 'Conversion %' : 'Avg Turn Time';
      return {
        title: `${fromLabel} → ${toLabel}`,
        chartType: 'combo',
        xKey: 'period',
        yKeys: ['leftCount', 'rightCount'],
        lineKey: metricKey,
        colors: ['#1e40af', '#10b981'],
        lineColor: '#475569',
        seriesNames: [fromLabel, toLabel, metricLabel],
        primaryAxisLabel: 'Units',
        secondaryAxisLabel: metricLabel,
        data:
          result?.series?.map((point) => ({
            period: formatPeriodLabel(point.period),
            leftCount: point.leftCount ?? 0,
            rightCount: point.rightCount ?? 0,
            conversionPercent: point.conversionPercent ?? 0,
            avgTurnTimeDays: point.avgTurnTimeDays ?? 0,
          })) ?? [],
      };
    }).filter((chart) => chart.data.length > 0);
    onDataReady({ columns, rows, charts, title: 'Workflow Conversion' });
  }, [onDataReady, loading, segmentResults, segments, calculationType, milestones]);

  useEffect(() => {
    if (!pendingInsightWidgetId || loading || milestonesLoading || typeof document === "undefined") return;
    const el = document.getElementById(pendingInsightWidgetId);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.add("ring-2", "ring-amber-400", "ring-offset-2");
    setTimeout(() => el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2"), 3000);
    setPendingInsightWidgetId(null);
  }, [pendingInsightWidgetId, loading, milestonesLoading]);

  return (
    <div className="space-y-4">
      {/* Toolbar – compact style when embedded in workbench to match other widget filter bars */}
      <div
        className={
          embeddedInWorkbench
            ? "flex flex-wrap items-center gap-1.5 px-2.5 pb-1.5"
            : "flex flex-wrap items-center gap-4"
        }
      >
        <div className="flex items-center gap-1.5">
          <span
            className={
              embeddedInWorkbench
                ? "text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5"
                : "text-sm font-medium text-slate-600 dark:text-slate-400"
            }
          >
            Period
          </span>
          <DatePeriodPicker
            year={new Date().getFullYear()}
            onYearChange={() => {}}
            presets={PERIOD_PRESETS}
            showYears={false}
            onPeriodChange={setPeriodSelection}
            periodSelectionFromStore={periodSelection}
            defaultPreset="mtd"
            showLabel={false}
            size="sm"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={
              embeddedInWorkbench
                ? "text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5"
                : "text-sm font-medium text-slate-600 dark:text-slate-400"
            }
          >
            Calculation
          </span>
          <Select
            value={calculationType}
            onValueChange={(v) => setCalculationType(v as WorkflowConversionMetric)}
          >
            <SelectTrigger
              className={embeddedInWorkbench ? "h-7 w-[120px] text-xs" : "w-[180px]"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conversion">Conversion %</SelectItem>
              <SelectItem value="turn_time">Turn Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={
              embeddedInWorkbench
                ? "text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5"
                : "text-sm font-medium text-slate-600 dark:text-slate-400"
            }
          >
            Grouping
          </span>
          <Select
            value={grouping}
            onValueChange={(v) => setGrouping(v as WorkflowGrouping)}
          >
            <SelectTrigger
              className={embeddedInWorkbench ? "h-7 w-[100px] text-xs" : "w-[140px]"}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workflow">Workflow</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {embeddedInWorkbench && (
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400 mr-0.5">Cards</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={removeCard}
              disabled={!canRemoveCard}
              aria-label="Remove last card"
            >
              <Minus className="h-3 w-3" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={addCard}
              disabled={!canAddCard}
              aria-label="Add card"
            >
              <Plus className="h-3 w-3" />
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={resetToDefault}
          className={cn(
            "gap-1.5",
            embeddedInWorkbench && "!h-7 !py-0 !min-h-0 px-2.5 text-xs",
          )}
        >
          <RotateCcw className={embeddedInWorkbench ? "h-2.5 w-2.5" : "h-3.5 w-3.5"} />
          Reset to Default
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setBookmarksModalOpen(true)}
          className={cn(
            "gap-1.5",
            embeddedInWorkbench && "!h-7 !py-0 !min-h-0 px-2.5 text-xs",
          )}
        >
          Bookmarks
        </Button>
        <Button
          type="button"
          variant={selectedBookmark && bookmarkInSync ? "secondary" : "default"}
          size="sm"
          onClick={() => {
            if (selectedBookmark && !bookmarkInSync) {
              setOverwriteModalOpen(true);
              return;
            }
            if (selectedBookmark && bookmarkInSync) return;
            setSaveBookmarkName("");
            setSaveBookmarkOpen(true);
          }}
          disabled={selectedBookmark != null && bookmarkInSync}
          className={cn(embeddedInWorkbench && "!h-7 !py-0 !min-h-0 px-2.5 text-xs")}
        >
          {selectedBookmark && bookmarkInSync ? "Saved" : "Save"}
        </Button>
        {selectedBookmark && (
          <Badge className="bg-sky-600 text-white hover:bg-sky-600">
            {selectedBookmark.name}
            <button
              type="button"
              aria-label="Clear selected bookmark"
              className="ml-1 rounded-full p-0.5 hover:bg-white/20"
              onClick={() => setSelectedBookmarkId(null)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        )}
      </div>

      {bookmarkRestoreWarning && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {bookmarkRestoreWarning}
        </div>
      )}

      {(error || milestonesError) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {milestonesError ?? error}
        </div>
      )}

      {!embeddedInWorkbench && (
        <DashboardInsightsStrip
          insights={dashboardInsights}
          generatedAt={dashboardInsightsGeneratedAt}
          loading={dashboardInsightsLoading}
          generating={generateLoading}
          generateError={generateError}
          onClearGenerateError={() => setGenerateError(null)}
          onShowInsight={handleShowInsight}
          onGenerate={handleGenerateInsights}
          onRefreshInsights={refreshDashboardInsights}
          showGenerateButton
          showFeedback
          onSubmitFeedback={handleDashboardInsightFeedback}
          dateFilter="ytd"
          selectedTenantId={selectedTenantId}
        />
      )}

      {milestonesLoading && milestones.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading date options…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {segments.map((seg, index) => (
            <div
              key={index}
              id={`workflow-conversion-segment-${index}`}
              className="scroll-mt-24 min-w-0"
            >
              <WorkflowSegmentCard
                index={index}
                segment={seg}
                result={segmentResults[index]}
                dateRange={dateRange}
                calculationType={calculationType}
                loading={loading}
                milestones={milestones}
                fromOptions={getFromOptions(index)}
                getToOptions={getToOptions}
                onFromChange={(value) => updateSegment(index, "from", value)}
                onToChange={(value) => updateSegment(index, "to", value)}
                selectedTenantId={selectedTenantId}
                selectedChannel={selectedChannel}
                segments={segments}
                grouping={grouping}
                dimensionFilters={dimensionFilters}
              />
            </div>
          ))}
        </div>
      )}

      <Dialog open={bookmarksModalOpen} onOpenChange={setBookmarksModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Bookmarks</DialogTitle>
            <DialogDescription>Saved Workflow Conversion bookmarks.</DialogDescription>
          </DialogHeader>
          {bookmarksLoading ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">Loading bookmarks...</p>
          ) : bookmarks.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No bookmarks saved yet.</p>
          ) : (
            <div className="space-y-2 max-h-[360px] overflow-auto">
              {bookmarks.map((bookmark) => (
                <div
                  key={bookmark.id}
                  className="flex items-start justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 p-2"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {editingBookmarkId === bookmark.id ? (
                      <Input
                        value={editingBookmarkName}
                        onChange={(event) => setEditingBookmarkName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            handleRenameBookmark(bookmark.id, editingBookmarkName);
                          } else if (event.key === "Escape") {
                            setEditingBookmarkId(null);
                            setEditingBookmarkName("");
                          }
                        }}
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                        {bookmark.name}
                      </p>
                    )}
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-0.5">
                      <p>
                        <span className="font-medium text-slate-600 dark:text-slate-300">Period:</span>{" "}
                        {formatWorkflowBookmarkPeriodLabel(bookmark.payload.period)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-600 dark:text-slate-300">Calculation:</span>{" "}
                        {workflowBookmarkCalculationLabel(bookmark.payload.calculationType)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-600 dark:text-slate-300">Grouping:</span>{" "}
                        {workflowBookmarkGroupingLabel(bookmark.payload.groupingType)}
                      </p>
                      <p>
                        <span className="font-medium text-slate-600 dark:text-slate-300">Milestones:</span>{" "}
                        {formatWorkflowBookmarkMilestonesLine(bookmark.payload, bookmarkMilestoneLabel)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {editingBookmarkId === bookmark.id ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => handleRenameBookmark(bookmark.id, editingBookmarkName)}
                      >
                        Save
                      </Button>
                    ) : (
                      <Button type="button" size="sm" variant="outline" onClick={() => applyBookmark(bookmark)}>
                        Apply
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditingBookmarkId(bookmark.id);
                        setEditingBookmarkName(bookmark.name);
                      }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="text-red-600 hover:text-red-700"
                      onClick={() => handleDeleteBookmark(bookmark.id)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              onClick={() => {
                setSaveBookmarkName("");
                setSaveBookmarkOpen(true);
              }}
            >
              Save Current as Bookmark
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={saveBookmarkOpen} onOpenChange={setSaveBookmarkOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Bookmark</DialogTitle>
            <DialogDescription>Save the current Workflow Conversion setup as a bookmark.</DialogDescription>
          </DialogHeader>
          <Input
            value={saveBookmarkName}
            onChange={(event) => setSaveBookmarkName(event.target.value)}
            placeholder="Bookmark name"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                handleCreateBookmark();
              }
            }}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSaveBookmarkOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleCreateBookmark} disabled={!saveBookmarkName.trim()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={overwriteModalOpen} onOpenChange={setOverwriteModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update bookmark?</DialogTitle>
            <DialogDescription>
              Your current configuration differs from the selected bookmark.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setOverwriteModalOpen(false);
                setSaveBookmarkName("");
                setSaveBookmarkOpen(true);
              }}
            >
              Create New Bookmark
            </Button>
            <Button type="button" onClick={handleOverwriteSelectedBookmark}>
              Update Selected Bookmark
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface WorkflowSegmentCardProps {
  index: number;
  segment: { from: string; to: string };
  result: SegmentResult | undefined;
  dateRange: { start: string; end: string };
  calculationType: WorkflowConversionMetric;
  loading: boolean;
  milestones: { id: string; label: string }[];
  fromOptions: { id: string; label: string }[];
  getToOptions: (fromId: string) => { id: string; label: string }[];
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
  segments: { from: string; to: string }[];
  grouping: WorkflowGrouping;
  chartHeight?: number;
  showFullscreenButton?: boolean;
  onFullscreenClick?: () => void;
  onCloseFullscreen?: () => void;
  dimensionFilters?: Array<{ column: string; value: string }>;
}

/** True when range is ≤31 days (backend uses day bucket); else months. */
function isDailyBucket(dateRange: { start: string; end: string }): boolean {
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return days <= 31;
}

function WorkflowSegmentCard({
  index,
  segment,
  result,
  dateRange,
  calculationType,
  loading,
  milestones,
  fromOptions,
  getToOptions,
  onFromChange,
  onToChange,
  selectedTenantId,
  selectedChannel,
  segments,
  grouping,
  chartHeight = 280,
  showFullscreenButton = false,
  onFullscreenClick,
  onCloseFullscreen,
  dimensionFilters,
}: WorkflowSegmentCardProps) {
  const [loansModalOpen, setLoansModalOpen] = React.useState(false);
  const [loansModalFilter, setLoansModalFilter] = React.useState<WorkflowSegmentLoanFilter | null>(null);
  const [fromOpen, setFromOpen] = React.useState(false);
  const [toOpen, setToOpen] = React.useState(false);

  const valid = isOrderValidWithMilestones(segment.from, segment.to, milestones);
  const fromLabel = fromOptions.find((m) => m.id === segment.from)?.label ?? segment.from;
  const toOptions = getToOptions(segment.from);
  const toLabel = toOptions.find((m) => m.id === segment.to)?.label ?? segment.to;

  const leftCount = result?.leftCount ?? 0;
  const rightCount = result?.rightCount ?? 0;
  const conversionPercent = result?.conversionPercent ?? null;
  const avgTurnTimeDays = result?.avgTurnTimeDays ?? null;
  const series = result?.series ?? [];

  const xAxisLabel = isDailyBucket(dateRange) ? "Days" : "Months";

  const openLoansModal = (filter: WorkflowSegmentLoanFilter) => {
    setLoansModalFilter(filter);
    setLoansModalOpen(true);
  };

  return (
    <Card className="flex min-h-[460px] flex-col overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-700/50 dark:bg-slate-900/50">
      <CardHeader className="h-[48px] shrink-0 px-4 py-2">
        <div className="flex h-[36px] items-center justify-center gap-2">
          <Popover open={fromOpen} onOpenChange={setFromOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={fromOpen}
                className="h-9 w-[140px] justify-between text-sm font-normal"
              >
                <span className="truncate">{fromLabel}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-0" align="center">
              <Command>
                <CommandInput placeholder="Search stage..." />
                <CommandList>
                  <CommandEmpty>No stage found.</CommandEmpty>
                  <CommandGroup>
                    {fromOptions.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.label}
                        onSelect={() => {
                          onFromChange(m.id);
                          setFromOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", segment.from === m.id ? "opacity-100" : "opacity-0")} />
                        {m.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <span className="text-slate-500 dark:text-slate-400">→</span>
          <Popover open={toOpen} onOpenChange={setToOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={toOpen}
                disabled={toOptions.length === 0}
                className="h-9 w-[140px] justify-between text-sm font-normal"
              >
                <span className="truncate">{toLabel}</span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] p-0" align="center">
              <Command>
                <CommandInput placeholder="Search stage..." />
                <CommandList>
                  <CommandEmpty>No stage found.</CommandEmpty>
                  <CommandGroup>
                    {toOptions.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.label}
                        onSelect={() => {
                          onToChange(m.id);
                          setToOpen(false);
                        }}
                      >
                        <Check className={cn("mr-2 h-4 w-4", segment.to === m.id ? "opacity-100" : "opacity-0")} />
                        {m.label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 px-2 pb-3 pt-0">
        {/* KPIs - fixed height so chart starts at same position in every card */}
        <div className="grid h-[64px] shrink-0 grid-cols-3 items-center gap-2 text-center">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {fromLabel} Files
            </p>
            <p className="text-lg font-semibold text-blue-600 dark:text-blue-400">
              {loading ? "—" : valid ? leftCount.toLocaleString() : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {calculationType === "conversion" ? "Conversion %" : "Avg Days"}
            </p>
            <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
              {loading ? "—" : valid ? (calculationType === "conversion" ? (conversionPercent != null ? `${conversionPercent}%` : "—") : (avgTurnTimeDays != null ? avgTurnTimeDays : "—")) : "—"}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              {toLabel} Files
            </p>
            <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
              {loading ? "—" : valid ? rightCount.toLocaleString() : "—"}
            </p>
          </div>
        </div>

        {/* Initial / Fallout / Pull-Through buttons */}
        {valid && (
          <div className="flex flex-wrap items-center justify-center gap-2 shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => openLoansModal("initial")}
            >
              Initial
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-red-50 border-red-200 text-red-800 hover:bg-red-100 hover:text-red-900 dark:bg-red-950/40 dark:border-red-800/60 dark:text-red-200 dark:hover:bg-red-900/50"
              onClick={() => openLoansModal("fallout")}
            >
              Fallout
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-200 dark:hover:bg-emerald-900/50"
              onClick={() => openLoansModal("pull-through")}
            >
              Pull-Through
            </Button>
          </div>
        )}

        {/* Chart or message - fixed height so same in every card, bottom-aligned */}
        <div
          className={cn(
            "mt-auto w-full shrink-0 rounded-lg border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/30",
          )}
          style={{ minHeight: chartHeight, maxHeight: chartHeight, height: chartHeight }}
        >
          {!valid ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-sm text-slate-500 dark:text-slate-400">
              <AlertCircle className="h-8 w-8 shrink-0" />
              <p className="max-w-[220px]">{INVALID_MESSAGE}</p>
            </div>
          ) : loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : series.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              No data for this period
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={series}
                margin={{ top: 24, right: 18, left: 18, bottom: 24 }}
                barCategoryGap="12%"
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => {
                    if (!v) return "";
                    if (typeof v === "string" && v.length === 10 && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
                      const [y, m, d] = v.split("-").map(Number);
                      return format(new Date(y, m - 1, d), "M/d");
                    }
                    if (typeof v === "string" && v.length === 10) return format(new Date(v), "M/d");
                    return String(v);
                  }}
                  label={{ value: xAxisLabel, position: "insideBottom", offset: -4, fontSize: 11 }}
                  height={32}
                />
                <YAxis
                  yAxisId="left"
                  width={28}
                  tick={{ fontSize: 10 }}
                  label={{ value: "Units", angle: -90, position: "insideLeft", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={28}
                  tick={{ fontSize: 10 }}
                  domain={calculationType === "conversion" ? [0, 100] : undefined}
                  label={{
                    value: calculationType === "conversion" ? "Conversion %" : "Avg. Turn Time",
                    angle: 90,
                    position: "insideRight",
                    fontSize: 11,
                  }}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload;
                    const periodLabel =
                      typeof p.period === "string" &&
                      p.period.length === 10 &&
                      /^\d{4}-\d{2}-\d{2}$/.test(p.period)
                        ? (() => {
                            const [y, m, d] = p.period.split("-").map(Number);
                            return format(new Date(y, m - 1, d), "M/d/yyyy");
                          })()
                        : String(p.period);
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white p-2 shadow dark:border-slate-700 dark:bg-slate-800">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{periodLabel}</p>
                        <p className="text-xs">{fromLabel}: {p.leftCount}</p>
                        <p className="text-xs">{toLabel}: {p.rightCount}</p>
                        {calculationType === "conversion" && p.conversionPercent != null && (
                          <p className="text-xs">Conversion: {p.conversionPercent}%</p>
                        )}
                        {calculationType === "turn_time" && p.avgTurnTimeDays != null && (
                          <p className="text-xs">Avg days: {p.avgTurnTimeDays}</p>
                        )}
                      </div>
                    );
                  }}
                />
                <Bar yAxisId="left" dataKey="leftCount" fill="rgb(30 64 175)" name={fromLabel} stackId="a" radius={[0, 0, 0, 0]} />
                <Bar yAxisId="left" dataKey="rightCount" fill="rgb(16 185 129)" name={toLabel} stackId="a" radius={[0, 0, 0, 0]} />
                {calculationType === "conversion" ? (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="conversionPercent"
                    stroke="rgb(71 85 105)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Conversion %"
                  />
                ) : (
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="avgTurnTimeDays"
                    stroke="rgb(71 85 105)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    name="Avg Days"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>

      <WorkflowSegmentLoansModal
        open={loansModalOpen}
        onOpenChange={setLoansModalOpen}
        filter={loansModalFilter}
        fromLabel={fromLabel}
        toLabel={toLabel}
        startDate={dateRange.start}
        endDate={dateRange.end}
        segments={segments}
        grouping={grouping}
        segmentIndex={index}
        selectedTenantId={selectedTenantId}
        channelGroup={selectedChannel}
        dimensionFilters={dimensionFilters}
      />
    </Card>
  );
}
