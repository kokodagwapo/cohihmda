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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export const SYNC_FREQUENCY_OPTIONS = [
  { value: "hourly", label: "Hourly" },
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
] as const;

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
export const SYNC_ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];
export const SYNC_BUSINESS_WEEKDAYS = [1, 2, 3, 4, 5];
export const SYNC_ALL_HOURS = SYNC_HOUR_OPTIONS;
export const SYNC_BUSINESS_HOURS = Array.from({ length: 10 }, (_, index) => index + 8);

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

function formatHourLabel(hour: number): string {
  if (hour === 0) return "12a";
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return "12p";
  return `${hour - 12}p`;
}

function formatRangeSummary(values: number[], all: number[], formatter: (value: number) => string): string {
  if (values.length === all.length) return "All";
  if (values.length === 0) return "None";
  if (values.length <= 4) return values.map(formatter).join(", ");
  return `${formatter(values[0])}–${formatter(values[values.length - 1])}`;
}

function describeSchedule(
  weekdays: number[],
  hours: number[],
  timezone: string,
  frequency: string,
): string {
  const dayLabel =
    weekdays.length === 7
      ? "every day"
      : weekdays.length === 5 && SYNC_BUSINESS_WEEKDAYS.every((day) => weekdays.includes(day))
        ? "Mon–Fri"
        : SYNC_WEEKDAY_OPTIONS.filter((day) => weekdays.includes(day.value))
            .map((day) => day.label)
            .join(", ") || "no days";
  const hourLabel = formatRangeSummary(hours, SYNC_ALL_HOURS, formatHourLabel);
  const freqLabel =
    SYNC_FREQUENCY_OPTIONS.find((option) => option.value === frequency)?.label ?? frequency;
  return `${freqLabel} · ${dayLabel} · ${hourLabel} (${timezone})`;
}

export interface SyncScheduleDialogConnection {
  id: string;
  name: string;
  tenant_name?: string;
  sync_frequency?: string | null;
  scheduler_timezone?: string | null;
  sync_allowed_weekdays?: number[] | null;
  sync_allowed_hours?: number[] | null;
  sync_business_days_only?: boolean | null;
  is_active?: boolean;
}

export interface SyncSchedulePatch {
  sync_frequency: string;
  scheduler_timezone: string;
  sync_allowed_weekdays: number[];
  sync_allowed_hours: number[];
  sync_business_days_only: boolean;
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
  const [frequency, setFrequency] = useState<string>("daily");
  const [timezone, setTimezone] = useState<string>("America/New_York");
  const [weekdays, setWeekdays] = useState<number[]>(SYNC_ALL_WEEKDAYS);
  const [hours, setHours] = useState<number[]>(SYNC_ALL_HOURS);

  useEffect(() => {
    if (!connection || !open) return;
    setFrequency(connection.sync_frequency || "daily");
    setTimezone(connection.scheduler_timezone || "America/New_York");
    setWeekdays(normalizeNumbers(connection.sync_allowed_weekdays, SYNC_ALL_WEEKDAYS));
    setHours(normalizeNumbers(connection.sync_allowed_hours, SYNC_ALL_HOURS));
  }, [connection, open]);

  const timezoneOptions = useMemo(
    () => schedulerTimezoneSelectOptions(timezone),
    [timezone],
  );

  const summary = useMemo(
    () => describeSchedule(weekdays, hours, timezone, frequency),
    [weekdays, hours, timezone, frequency],
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

  const toggleHour = (value: number) => {
    setHours((current) => {
      const has = current.includes(value);
      if (has && current.length === 1) return current;
      const next = has
        ? current.filter((item) => item !== value)
        : [...current, value].sort((a, b) => a - b);
      return next;
    });
  };

  const handleSave = async () => {
    const businessDaysOnly =
      weekdays.length === 5 && SYNC_BUSINESS_WEEKDAYS.every((day) => weekdays.includes(day));
    await onSave({
      sync_frequency: frequency,
      scheduler_timezone: timezone,
      sync_allowed_weekdays: [...weekdays].sort((a, b) => a - b),
      sync_allowed_hours: [...hours].sort((a, b) => a - b),
      sync_business_days_only: businessDaysOnly,
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
                . Manual syncs always run on demand.
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
                Frequency
              </Label>
              <Select value={frequency} onValueChange={setFrequency} disabled={disabledInputs}>
                <SelectTrigger className="h-9 text-xs font-light">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SYNC_FREQUENCY_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-slate-500 font-light">
                How often to check whether this connection is due for a sync.
              </p>
            </div>

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
                Days and hours below are interpreted in this timezone.
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

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-medium text-slate-800 dark:text-slate-200">
                Allowed hours
              </Label>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-light"
                  onClick={() => setHours(SYNC_ALL_HOURS)}
                  disabled={disabledInputs}
                  type="button"
                >
                  All hours
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs font-light"
                  onClick={() => setHours(SYNC_BUSINESS_HOURS)}
                  disabled={disabledInputs}
                  type="button"
                >
                  8a–5p
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-12 gap-1.5">
              {SYNC_HOUR_OPTIONS.map((hour) => {
                const active = hours.includes(hour);
                return (
                  <Button
                    key={hour}
                    type="button"
                    variant={active ? "default" : "outline"}
                    size="sm"
                    className="h-8 text-xs font-light"
                    onClick={() => toggleHour(hour)}
                    disabled={disabledInputs || (active && hours.length === 1)}
                  >
                    {formatHourLabel(hour)}
                  </Button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 font-light">
              Each button is one local hour (e.g. <code>9a</code> = 09:00–09:59).
            </p>
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
          <Button type="button" onClick={handleSave} disabled={disabledInputs}>
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
  formatHourLabel,
};
