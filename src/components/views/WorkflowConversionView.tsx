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
import { DatePeriodPicker } from "@/components/ui/DatePeriodPicker";
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
import { WorkflowSegmentLoansModal } from "@/components/views/WorkflowSegmentLoansModal";
import type { WorkflowSegmentLoanFilter } from "@/hooks/useWorkflowConversionSegmentLoans";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { useWidgetSectionStore } from "@/stores/widgetSectionStore";
import type { SectionFilters } from "@/stores/widgetSectionStore";
import { useTenantStore } from "@/stores/tenantStore";
import { useFilterPresetStore, type FilterPreset } from "@/stores/filterPresetStore";
import { computePresetDateRange } from "@/components/ui/DatePeriodPicker";
import {
  AddFilterPicker,
  GroupFilterBookmarkButton,
  DynamicDimensionFilter,
} from "@/components/widgets/components/WidgetGroup";

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

function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(now, "yyyy-MM-dd"),
  };
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
}

const DEBOUNCE_MS = 300;

export function WorkflowConversionView({
  selectedTenantId,
  selectedChannel,
  embeddedInWorkbench = false,
  initialState,
  onStateChange,
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

  const dateRange = periodSelection.dateRange;
  const { milestones, loading: milestonesLoading, error: milestonesError } = useWorkflowMilestones(selectedTenantId);
  const { data, loading, error } = useWorkflowConversionData({
    startDate: dateRange.start,
    endDate: dateRange.end,
    segments,
    metric: calculationType,
    grouping,
    selectedTenantId,
    channelGroup: selectedChannel,
  });

  const updateSegment = useCallback((index: number, field: "from" | "to", value: string) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }, []);

  const resetToDefault = useCallback(() => {
    setSegments([...DEFAULT_WORKFLOW_SEGMENTS]);
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
        {groupId && filters && (
          <>
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
            {(filters.dynamicFilters || []).map((df) => (
              <DynamicDimensionFilter
                key={df.column}
                entry={df}
                tenantId={tenantIdForEdit}
                onChange={(value) => updateDynamicFilter(groupId, df.column, value)}
                onRemove={() => removeDynamicFilter(groupId, df.column)}
              />
            ))}
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
            <AddFilterPicker
              groupId={groupId}
              existingColumns={(filters.dynamicFilters || []).map((f) => f.column)}
              onAdd={(col, label) => addDynamicFilter(groupId, { column: col, label, value: "all" })}
            />
            <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />
            <GroupFilterBookmarkButton
              filters={filters}
              onApplyPreset={handleApplyGroupPreset}
            />
          </>
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
      </div>

      {(error || milestonesError) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {milestonesError ?? error}
        </div>
      )}

      {milestonesLoading && milestones.length === 0 ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500 dark:text-slate-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading date options…
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {segments.map((seg, index) => (
            <WorkflowSegmentCard
              key={index}
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
            />
          ))}
        </div>
      )}
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
                        <p className="text-xs">Left: {p.leftCount}</p>
                        <p className="text-xs">Right: {p.rightCount}</p>
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
                <Bar yAxisId="left" dataKey="leftCount" fill="rgb(30 64 175)" name="Left" stackId="a" radius={[0, 0, 0, 0]} />
                <Bar yAxisId="left" dataKey="rightCount" fill="rgb(16 185 129)" name="Right" stackId="a" radius={[0, 0, 0, 0]} />
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
      />
    </Card>
  );
}
