import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";

export const SYNC_WEEKDAY_OPTIONS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

export const SYNC_HOUR_OPTIONS = Array.from({ length: 24 }, (_, hour) => hour);
export const SYNC_MINUTE_OPTIONS = Array.from({ length: 60 }, (_, minute) => minute);
export const SYNC_ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const SYNC_BUSINESS_WEEKDAYS = [1, 2, 3, 4, 5];

export const SYNC_SCHEDULER_TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "Eastern (America/New_York)" },
  { value: "America/Chicago", label: "Central (America/Chicago)" },
  { value: "America/Denver", label: "Mountain (America/Denver)" },
  { value: "America/Los_Angeles", label: "Pacific (America/Los_Angeles)" },
  { value: "UTC", label: "UTC" },
] as const;

function schedulerTimezoneSelectOptions(
  current?: string | null,
): Array<{ value: string; label: string }> {
  const cur = (current && current.trim()) || "America/New_York";
  if (SYNC_SCHEDULER_TIMEZONE_OPTIONS.some((o) => o.value === cur)) {
    return [...SYNC_SCHEDULER_TIMEZONE_OPTIONS];
  }
  return [{ value: cur, label: `${cur} (custom)` }, ...SYNC_SCHEDULER_TIMEZONE_OPTIONS];
}

function normalizeNumbers(values: number[] | null | undefined, fallback: number[]): number[] {
  return Array.isArray(values) && values.length > 0
    ? [...new Set(values.map(Number))].sort((a, b) => a - b)
    : fallback;
}

/** e.g. 8:05 AM (locale-formatted) */
export function formatClockSlot(hour: number, minute: number): string {
  const d = new Date(2000, 0, 1, hour, minute);
  return d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

type RunAtTimeDraft = { hour: number; minute: number; runInsights: boolean };

function parseRunAtTimes(raw: unknown): RunAtTimeDraft[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const out: RunAtTimeDraft[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const hour = Number(rec.hour);
    const minute = Number(rec.minute);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) continue;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) continue;
    out.push({
      hour,
      minute,
      runInsights: rec.runInsights === true || rec.run_insights === true,
    });
  }
  out.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  return out;
}

function describeSchedule(
  runAtTimes: RunAtTimeDraft[],
  weekdays: number[],
  timezone: string,
): string {
  const dayLabel =
    weekdays.length === 7
      ? "every day"
      : weekdays.length === 5 && SYNC_BUSINESS_WEEKDAYS.every((day) => weekdays.includes(day))
        ? "Mon–Fri"
        : SYNC_WEEKDAY_OPTIONS.filter((day) => weekdays.includes(day.value))
            .map((day) => day.label)
            .join(", ") || "no days";

  const timesLabel =
    runAtTimes.length > 0
      ? runAtTimes
          .map((t) => `${formatClockSlot(t.hour, t.minute)}${t.runInsights ? " + insights" : ""}`)
          .join(", ")
      : "No run times selected";
  return `${timesLabel} · ${dayLabel} (${timezone})`;
}

export interface SyncScheduleDialogConnection {
  id: string;
  name: string;
  tenant_name?: string;
  scheduler_timezone?: string | null;
  sync_allowed_weekdays?: number[] | null;
  sync_run_at_times?: unknown;
  sync_business_days_only?: boolean | null;
  is_active?: boolean;
}

export interface SyncSchedulePatch {
  scheduler_timezone: string;
  sync_allowed_weekdays: number[];
  sync_business_days_only: boolean;
  sync_run_at_times: RunAtTimeDraft[];
}

interface SyncScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connection: SyncScheduleDialogConnection | null;
  saving?: boolean;
  onSave: (patch: SyncSchedulePatch) => Promise<void> | void;
}

export function SyncScheduleDialog({
  open,
  onOpenChange,
  connection,
  saving = false,
  onSave,
}: SyncScheduleDialogProps) {
  const [timezone, setTimezone] = useState<string>("America/New_York");
  const [weekdays, setWeekdays] = useState<number[]>(SYNC_ALL_WEEKDAYS);
  const [runAtTimes, setRunAtTimes] = useState<RunAtTimeDraft[]>([]);

  useEffect(() => {
    if (!connection || !open) return;
    setTimezone(connection.scheduler_timezone || "America/New_York");
    setWeekdays(normalizeNumbers(connection.sync_allowed_weekdays, SYNC_ALL_WEEKDAYS));
    const parsed = parseRunAtTimes(connection.sync_run_at_times);
    setRunAtTimes(
      parsed.length > 0
        ? parsed
        : [
            { hour: 8, minute: 0, runInsights: false },
            { hour: 18, minute: 0, runInsights: false },
          ],
    );
  }, [connection, open]);

  const timezoneOptions = useMemo(
    () => schedulerTimezoneSelectOptions(timezone),
    [timezone],
  );

  const summary = useMemo(
    () => describeSchedule(runAtTimes, weekdays, timezone),
    [runAtTimes, weekdays, timezone],
  );

  const toggleWeekday = (value: number) => {
    setWeekdays((current) => {
      const has = current.includes(value);
      if (has && current.length === 1) return current;
      const next = has
        ? current.filter((item) => item !== value)
        : [...current, value].sort((a, b) => a - b);
      return next;
    });
  };

  const updateRunAtRow = (index: number, next: RunAtTimeDraft) => {
    setRunAtTimes((rows) => {
      const copy = [...rows];
      copy[index] = next;
      return copy.sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    });
  };

  const handleSave = async () => {
    const businessDaysOnly =
      weekdays.length === 5 && SYNC_BUSINESS_WEEKDAYS.every((day) => weekdays.includes(day));
    await onSave({
      scheduler_timezone: timezone,
      sync_allowed_weekdays: [...weekdays].sort((a, b) => a - b),
      sync_business_days_only: businessDaysOnly,
      sync_run_at_times: runAtTimes.map((t) => ({
        hour: t.hour,
        minute: t.minute,
        runInsights: t.runInsights,
      })),
    });
  };

  const disabledInputs = saving || connection?.is_active === false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(100vw-1.5rem,44rem)] max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit sync schedule</DialogTitle>
          <DialogDescription>
            {connection ? (
              <>
                Configure when the scheduler runs <strong>{connection.name}</strong>
                {connection.tenant_name ? (
                  <>
                    {" "}
                    for <strong>{connection.tenant_name}</strong>
                  </>
                ) : null}
                . Pick explicit clock times for multiple runs per day (e.g. twice daily). Manual
                sync always runs on demand.
                Enable insights on the specific run times that should also refresh generated insights.
              </>
            ) : (
              "Configure when this connection syncs automatically."
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-xs text-slate-600 dark:text-slate-300 font-light">
            <span className="font-medium text-slate-700 dark:text-slate-200">Preview:</span> {summary}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Timezone
              </Label>
              <Select value={timezone} onValueChange={setTimezone} disabled={disabledInputs}>
                <SelectTrigger className="h-9 text-xs font-light">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timezoneOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 font-light">
                Weekdays and run times use this timezone for each tenant connection.
              </p>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Allowed days
              </Label>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-light"
                  onClick={() => setWeekdays(SYNC_ALL_WEEKDAYS)}
                  disabled={disabledInputs}
                  type="button"
                >
                  Every day
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-light"
                  onClick={() => setWeekdays(SYNC_BUSINESS_WEEKDAYS)}
                  disabled={disabledInputs}
                  type="button"
                >
                  Weekdays
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SYNC_WEEKDAY_OPTIONS.map((day) => {
                const active = weekdays.includes(day.value);
                return (
                  <Button
                    key={day.value}
                    type="button"
                    variant={active ? "default" : "outline"}
                    size="sm"
                    className="h-8 min-w-12 text-xs font-light"
                    onClick={() => toggleWeekday(day.value)}
                    disabled={disabledInputs || (active && weekdays.length === 1)}
                  >
                    {day.label}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/30 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  Run at specific times
                </Label>
                <p className="text-[11px] text-slate-500 font-light mt-1 max-w-xl">
                  Add one row per run (e.g. twice daily: morning and evening). The platform scheduler
                  wakes every <strong>15 minutes</strong>; each run fires in the 15-minute window that
                  starts at the time you pick.
                </p>
              </div>
              <div className="flex flex-wrap gap-1 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="h-7 text-xs font-light"
                  disabled={disabledInputs}
                  onClick={() =>
                    setRunAtTimes([
                      { hour: 8, minute: 0, runInsights: false },
                      { hour: 18, minute: 0, runInsights: false },
                    ])
                  }
                >
                  Preset: 8AM &amp; 6PM
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  type="button"
                  className="h-7 text-xs font-light gap-1"
                  disabled={disabledInputs || runAtTimes.length >= 24}
                  onClick={() =>
                    setRunAtTimes((r) => [...r, { hour: 9, minute: 0, runInsights: false }])
                  }
                >
                  <Plus className="h-3 w-3" />
                  Add time
                </Button>
              </div>
            </div>

            {runAtTimes.length === 0 ? (
              <p className="text-xs text-red-600 dark:text-red-400 font-light">
                Add at least one run time before saving.
              </p>
            ) : (
              <ul className="space-y-2">
                {runAtTimes.map((row, index) => (
                  <li
                    key={`${row.hour}-${row.minute}-${index}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <Select
                      value={String(row.hour)}
                      onValueChange={(v) =>
                        updateRunAtRow(index, { ...row, hour: Number(v) })
                      }
                      disabled={disabledInputs}
                    >
                      <SelectTrigger className="h-9 w-[88px] text-xs font-light">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[min(60vh,280px)]">
                        {SYNC_HOUR_OPTIONS.map((h) => (
                          <SelectItem key={h} value={String(h)} className="text-xs">
                            {String(h).padStart(2, "0")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="text-slate-400 text-xs">:</span>
                    <Select
                      value={String(row.minute)}
                      onValueChange={(v) =>
                        updateRunAtRow(index, { ...row, minute: Number(v) })
                      }
                      disabled={disabledInputs}
                    >
                      <SelectTrigger className="h-9 w-[88px] text-xs font-light">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-h-[min(60vh,280px)]">
                        {SYNC_MINUTE_OPTIONS.map((m) => (
                          <SelectItem key={m} value={String(m)} className="text-xs">
                            {String(m).padStart(2, "0")}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="ml-1 flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700">
                      <Switch
                        checked={row.runInsights}
                        onCheckedChange={(checked) =>
                          updateRunAtRow(index, { ...row, runInsights: checked })
                        }
                        disabled={disabledInputs}
                        className="data-[state=checked]:bg-violet-500"
                      />
                      <span className="text-xs font-light text-slate-600 dark:text-slate-300">
                        Run insights
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-9 w-9 p-0 text-slate-500"
                      disabled={disabledInputs}
                      title="Remove time"
                      onClick={() =>
                        setRunAtTimes((r) => r.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={disabledInputs || runAtTimes.length === 0}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving…
              </>
            ) : (
              "Save schedule"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export const syncScheduleHelpers = {
  describeSchedule,
  normalizeNumbers,
  formatClockSlot,
};
