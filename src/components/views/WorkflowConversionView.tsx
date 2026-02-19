import React, { useState, useCallback, useMemo } from "react";
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
import { DatePeriodPicker } from "@/components/ui/DatePeriodPicker";
import type { PeriodSelection, PeriodPreset } from "@/components/ui/DatePeriodPicker";
import {
  WORKFLOW_MILESTONES_ORDER,
  DEFAULT_WORKFLOW_SEGMENTS,
  isOrderValid,
  getMilestonesAfter,
  type WorkflowMilestone,
} from "@/lib/workflowConversionMilestones";
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
import { AlertCircle, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

const PERIOD_PRESETS: PeriodPreset[] = [
  "mtd",
  "last-month",
  "qtd",
  "last-quarter",
  "ytd",
  "last-year",
];

const INVALID_MESSAGE =
  "Please select milestones so the earlier stage is on the left and the later stage on the right.";

function getDefaultDateRange(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start: format(start, "yyyy-MM-dd"),
    end: format(now, "yyyy-MM-dd"),
  };
}

export interface WorkflowConversionViewProps {
  selectedTenantId?: string | null;
  selectedChannel?: string | null;
}

export function WorkflowConversionView({
  selectedTenantId,
  selectedChannel,
}: WorkflowConversionViewProps) {
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(() => {
    const range = getDefaultDateRange();
    return { type: "preset", preset: "mtd", dateRange: range };
  });
  const [calculationType, setCalculationType] = useState<WorkflowConversionMetric>("conversion");
  const [grouping, setGrouping] = useState<WorkflowGrouping>("workflow");
  const [segments, setSegments] = useState<{ from: string; to: string }[]>(() => [
    ...DEFAULT_WORKFLOW_SEGMENTS,
  ]);

  const dateRange = periodSelection.dateRange;
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
    setSegments((prev) => {
      const next = prev.map((s, i) => (i === index ? { ...s, [field]: value } : s));
      if (grouping !== "workflow") return next;
      if (field === "to" && index < next.length - 1) {
        const nextFrom = value;
        const optionsAfter = getMilestonesAfter(nextFrom);
        const currentTo = next[index + 1].to;
        const toIsValid = optionsAfter.some((m) => m.id === currentTo);
        next[index + 1] = {
          ...next[index + 1],
          from: nextFrom,
          to: toIsValid ? currentTo : optionsAfter[0]?.id ?? currentTo,
        };
      }
      if (field === "from" && index > 0) {
        next[index - 1] = { ...next[index - 1], to: value };
        const optionsAfter = getMilestonesAfter(value);
        const currentTo = next[index].to;
        const toIsValid = optionsAfter.some((m) => m.id === currentTo);
        if (!toIsValid && optionsAfter.length > 0) {
          next[index] = { ...next[index], to: optionsAfter[0].id };
        }
      }
      return next;
    });
  }, [grouping]);

  const resetToDefault = useCallback(() => {
    setSegments([...DEFAULT_WORKFLOW_SEGMENTS]);
  }, []);

  const fromOptions = useMemo(() => WORKFLOW_MILESTONES_ORDER.slice(0, -1), []);
  const getToOptions = useCallback((fromId: string) => getMilestonesAfter(fromId), []);

  const segmentResults = data?.segments ?? [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Period</span>
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
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Calculation</span>
          <Select
            value={calculationType}
            onValueChange={(v) => setCalculationType(v as WorkflowConversionMetric)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="conversion">Conversion %</SelectItem>
              <SelectItem value="turn_time">Turn Time</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Grouping</span>
          <Select
            value={grouping}
            onValueChange={(v) => setGrouping(v as WorkflowGrouping)}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="workflow">Workflow</SelectItem>
              <SelectItem value="individual">Individual</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={resetToDefault}
          className="gap-1.5 ml-auto"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Reset to Default
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          {error}
        </div>
      )}

      {/* 2x3 Grid */}
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
            fromOptions={fromOptions}
            getToOptions={getToOptions}
            onFromChange={(value) => updateSegment(index, "from", value)}
            onToChange={(value) => updateSegment(index, "to", value)}
          />
        ))}
      </div>
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
  fromOptions: WorkflowMilestone[];
  getToOptions: (fromId: string) => WorkflowMilestone[];
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
}

/** True when range is ≤31 days (backend uses day bucket); else months. */
function isDailyBucket(dateRange: { start: string; end: string }): boolean {
  const start = new Date(dateRange.start);
  const end = new Date(dateRange.end);
  const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  return days <= 31;
}

function WorkflowSegmentCard({
  segment,
  result,
  dateRange,
  calculationType,
  loading,
  fromOptions,
  getToOptions,
  onFromChange,
  onToChange,
}: WorkflowSegmentCardProps) {
  const valid = isOrderValid(segment.from, segment.to);
  const fromLabel = fromOptions.find((m) => m.id === segment.from)?.label ?? segment.from;
  const toOptions = getToOptions(segment.from);
  const toLabel = toOptions.find((m) => m.id === segment.to)?.label ?? segment.to;

  const leftCount = result?.leftCount ?? 0;
  const rightCount = result?.rightCount ?? 0;
  const conversionPercent = result?.conversionPercent ?? null;
  const avgTurnTimeDays = result?.avgTurnTimeDays ?? null;
  const series = result?.series ?? [];

  const xAxisLabel = isDailyBucket(dateRange) ? "Days" : "Months";

  return (
    <Card className="flex min-h-[420px] flex-col overflow-hidden border-slate-200/80 bg-white shadow-sm dark:border-slate-700/50 dark:bg-slate-900/50">
      <CardHeader className="h-[48px] shrink-0 px-4 py-2">
        <div className="flex h-[36px] items-center justify-center gap-2">
          <Select value={segment.from} onValueChange={onFromChange}>
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {fromOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="text-slate-500 dark:text-slate-400">→</span>
          <Select
            value={segment.to}
            onValueChange={onToChange}
            disabled={toOptions.length === 0}
          >
            <SelectTrigger className="h-9 w-[140px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {toOptions.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-2 px-4 pb-3 pt-0">
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

        {/* Chart or message - fixed height so same in every card, bottom-aligned */}
        <div className="mt-auto h-[280px] min-h-[280px] max-h-[280px] w-full shrink-0 rounded-lg border border-slate-100 bg-slate-50/50 dark:border-slate-800 dark:bg-slate-900/30">
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
                margin={{ top: 10, right: 46, left: 46, bottom: 28 }}
                barCategoryGap="12%"
                barGap={2}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200 dark:stroke-slate-700" />
                <XAxis
                  dataKey="period"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => {
                    if (!v) return "";
                    if (v.length === 10) return format(new Date(v), "M/d");
                    return v;
                  }}
                  label={{ value: xAxisLabel, position: "insideBottom", offset: -4, fontSize: 11 }}
                  height={32}
                />
                <YAxis
                  yAxisId="left"
                  width={42}
                  tick={{ fontSize: 10 }}
                  label={{ value: "Units", angle: -90, position: "insideLeft", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  width={42}
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
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white p-2 shadow dark:border-slate-700 dark:bg-slate-800">
                        <p className="text-xs font-medium text-slate-600 dark:text-slate-300">{p.period}</p>
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
    </Card>
  );
}
