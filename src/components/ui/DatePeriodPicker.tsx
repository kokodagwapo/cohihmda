/**
 * DatePeriodPicker - Reusable date period selector component
 * 
 * Provides configurable period presets:
 * - Year selection (YTD for current year, full year for past years)
 * - Rolling periods (3/6/12/13 months)
 * - Standard presets (MTD, QTD, YTD, last-month, last-quarter, last-year)
 * - Custom date range via calendar popover
 *
 * All presets compute a concrete DateRange { start, end } so downstream
 * consumers always receive YYYY-MM-DD strings.
 */

import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  format,
  subMonths,
  subQuarters,
  subYears,
  startOfMonth,
  startOfQuarter,
  startOfYear,
  endOfMonth,
  endOfQuarter,
  endOfYear,
} from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Shared types – importable by other modules
// ---------------------------------------------------------------------------

/** Legacy rolling period type (kept for backward compat) */
export type RollingPeriod = 'rolling12' | 'rolling13';

export interface DateRange {
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
}

/** All supported period presets */
export type PeriodPreset =
  | 'rolling-3'
  | 'rolling-6'
  | 'rolling-12'
  | 'rolling-13'
  | 'mtd'
  | 'qtd'
  | 'ytd'
  | 'last-month'
  | 'last-quarter'
  | 'last-year'
  | 'trailing-12';

/** Structured output that carries both the semantic selection and the computed range */
export interface PeriodSelection {
  type: 'year' | 'preset' | 'custom';
  preset?: PeriodPreset;
  year?: number;
  dateRange: DateRange;
}

// ---------------------------------------------------------------------------
// Preset metadata (label + date-fns calculation)
// ---------------------------------------------------------------------------

interface PresetMeta {
  label: string;
  title: string;
  computeRange: () => DateRange;
}

const fmtDate = (d: Date) => format(d, 'yyyy-MM-dd');

const PRESET_META: Record<PeriodPreset, PresetMeta> = {
  'rolling-3':  { label: '3 Mo',  title: 'Rolling 3 months',  computeRange: () => ({ start: fmtDate(startOfMonth(subMonths(new Date(), 3))),  end: fmtDate(new Date()) }) },
  'rolling-6':  { label: '6 Mo',  title: 'Rolling 6 months',  computeRange: () => ({ start: fmtDate(startOfMonth(subMonths(new Date(), 6))),  end: fmtDate(new Date()) }) },
  'rolling-12': { label: 'L12M',  title: 'Rolling 12 months', computeRange: () => ({ start: fmtDate(startOfMonth(subMonths(new Date(), 12))), end: fmtDate(new Date()) }) },
  'rolling-13': { label: 'L13M',  title: 'Rolling 13 months (Qlik default for TTS)', computeRange: () => ({ start: fmtDate(startOfMonth(subMonths(new Date(), 13))), end: fmtDate(new Date()) }) },
  'mtd':          { label: 'MTD',   title: 'Month to date',     computeRange: () => ({ start: fmtDate(startOfMonth(new Date())),                               end: fmtDate(new Date()) }) },
  'qtd':          { label: 'QTD',   title: 'Quarter to date',   computeRange: () => ({ start: fmtDate(startOfQuarter(new Date())),                              end: fmtDate(new Date()) }) },
  'ytd':          { label: 'YTD',   title: 'Year to date',      computeRange: () => ({ start: fmtDate(startOfYear(new Date())),                                end: fmtDate(new Date()) }) },
  'last-month':   { label: 'LM',    title: 'Last month',        computeRange: () => { const d = subMonths(new Date(), 1);   return { start: fmtDate(startOfMonth(d)),   end: fmtDate(endOfMonth(d)) }; } },
  'last-quarter': { label: 'LQ',    title: 'Last quarter',      computeRange: () => { const d = subQuarters(new Date(), 1); return { start: fmtDate(startOfQuarter(d)), end: fmtDate(endOfQuarter(d)) }; } },
  'last-year':    { label: 'LY',    title: 'Last year',         computeRange: () => { const d = subYears(new Date(), 1);    return { start: fmtDate(startOfYear(d)),    end: fmtDate(endOfYear(d)) }; } },
  'trailing-12':  { label: 'T12',   title: 'Trailing 12 months', computeRange: () => ({ start: fmtDate(startOfMonth(subMonths(new Date(), 12))), end: fmtDate(new Date()) }) },
};

/** Compute the DateRange for a given preset */
export function computePresetDateRange(preset: PeriodPreset): DateRange {
  return PRESET_META[preset].computeRange();
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DatePeriodPickerProps {
  /** Currently selected year (used for year buttons and backward compat) */
  year: number;
  /** Callback when year changes (backward compat) */
  onYearChange: (year: number) => void;
  /** Callback when date range changes (backward compat - fires for every selection type) */
  onDateRangeChange?: (range: DateRange) => void;
  /** NEW: Callback with full period selection (type + preset + dateRange) */
  onPeriodChange?: (selection: PeriodSelection) => void;
  /** NEW: Which preset buttons to show before the year buttons. Default: ['rolling-13', 'rolling-12'] */
  presets?: PeriodPreset[];
  /** NEW: Whether to show year buttons. Default: true */
  showYears?: boolean;
  /** Number of years to show (default: 4) */
  yearsToShow?: number;
  /** Optional className for the container */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'default';
  /** Label text (default: "Period:") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
  /** NEW: Initially selected preset (optional) */
  defaultPreset?: PeriodPreset;
  /** Show an "All" option (no date filter); when selected, onAllSelect is used */
  showAllOption?: boolean;
  /** Called when user selects "All" (clear date filter) */
  onAllSelect?: () => void;
  /** Current period from store so we can show "All" as active when undefined */
  periodSelectionFromStore?: PeriodSelection | null;
}

// Generate years from current year down
const generateYears = (count: number): number[] => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => currentYear - i);
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DatePeriodPicker = ({
  year,
  onYearChange,
  onDateRangeChange,
  onPeriodChange,
  presets,
  showYears = true,
  yearsToShow = 4,
  className,
  size = 'default',
  label = 'Period:',
  showLabel = true,
  defaultPreset,
  showAllOption,
  onAllSelect,
  periodSelectionFromStore,
}: DatePeriodPickerProps) => {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => generateYears(yearsToShow), [yearsToShow]);

  // Effective presets – default to legacy rolling 13/12 when not specified
  const effectivePresets = presets ?? ['rolling-13', 'rolling-12'];

  // Active selection state: when "All" is the store state, never show year/preset as selected
  const [activeType, setActiveType] = useState<'year' | 'preset' | 'custom'>(() =>
    showAllOption && periodSelectionFromStore == null ? 'preset' : defaultPreset ? 'preset' : 'year',
  );
  const [activePreset, setActivePreset] = useState<PeriodPreset | null>(() =>
    showAllOption && periodSelectionFromStore == null ? null : defaultPreset ?? null,
  );
  const [customDateRange, setCustomDateRange] = useState<{ start: Date | null; end: Date | null }>({
    start: null,
    end: null,
  });

  // When "All" is selected (store has no period), keep internal state so no year/preset appears active
  useEffect(() => {
    if (showAllOption && periodSelectionFromStore == null) {
      setActiveType('preset');
      setActivePreset(null);
    }
  }, [showAllOption, periodSelectionFromStore]);

  // Sync active selection from store when periodSelectionFromStore is provided (e.g. workbench actors)
  useEffect(() => {
    if (periodSelectionFromStore == null) return;
    if (periodSelectionFromStore.type === 'preset' && periodSelectionFromStore.preset) {
      setActiveType('preset');
      setActivePreset(periodSelectionFromStore.preset);
    } else if (periodSelectionFromStore.type === 'year' && periodSelectionFromStore.year != null) {
      setActiveType('year');
      setActivePreset(null);
    } else if (periodSelectionFromStore.type === 'custom') {
      setActiveType('custom');
      setActivePreset(null);
      if (periodSelectionFromStore.dateRange?.start && periodSelectionFromStore.dateRange?.end) {
        setCustomDateRange({
          start: new Date(periodSelectionFromStore.dateRange.start),
          end: new Date(periodSelectionFromStore.dateRange.end),
        });
      }
    }
  }, [periodSelectionFromStore?.type, periodSelectionFromStore?.preset, periodSelectionFromStore?.year, periodSelectionFromStore?.dateRange?.start, periodSelectionFromStore?.dateRange?.end]);

  // ---- Notification helpers ------------------------------------------------

  const notify = useCallback(
    (selection: PeriodSelection) => {
      onDateRangeChange?.(selection.dateRange);
      onPeriodChange?.(selection);
    },
    [onDateRangeChange, onPeriodChange],
  );

  // ---- Handlers ------------------------------------------------------------

  const handleYearSelect = (selectedYear: number) => {
    setActiveType('year');
    setActivePreset(null);
    onYearChange(selectedYear);

    const today = new Date();
    const isCurrentYear = selectedYear === today.getFullYear();
    const dateRange: DateRange = {
      start: `${selectedYear}-01-01`,
      end: isCurrentYear ? fmtDate(today) : `${selectedYear}-12-31`,
    };
    notify({ type: 'year', year: selectedYear, dateRange });
  };

  const handlePresetSelect = (preset: PeriodPreset) => {
    setActiveType('preset');
    setActivePreset(preset);
    const dateRange = computePresetDateRange(preset);
    notify({ type: 'preset', preset, dateRange });
  };

  const handleCustomDateSelect = (range: { from?: Date; to?: Date } | undefined) => {
    const newRange = { start: range?.from || null, end: range?.to || null };
    setCustomDateRange(newRange);
    if (range?.from && range?.to) {
      setActiveType('custom');
      setActivePreset(null);
      const dateRange: DateRange = {
        start: fmtDate(range.from),
        end: fmtDate(range.to),
      };
      notify({ type: 'custom', dateRange });
    }
  };

  const handleClearCustom = () => {
    setCustomDateRange({ start: null, end: null });
    setActivePreset(null);
    setActiveType('year');
    const today = new Date();
    const isCurrentYear = year === today.getFullYear();
    const dateRange: DateRange = {
      start: `${year}-01-01`,
      end: isCurrentYear ? fmtDate(today) : `${year}-12-31`,
    };
    notify({ type: 'year', year, dateRange });
  };

  // ---- Styling helpers -----------------------------------------------------

  const buttonClasses =
    size === 'sm'
      ? 'px-2 py-1 text-[10px] sm:px-2.5 sm:py-1.5 sm:text-xs'
      : 'px-2.5 py-1.5 sm:px-3 md:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm';

  const labelClasses = size === 'sm' ? 'text-[9px] sm:text-[10px]' : 'text-[10px] sm:text-xs';

  // When "All" is selected in the store, only "All" should appear active (override year/preset/custom)
  const allSelected = Boolean(showAllOption && periodSelectionFromStore == null);
  const isActive = (type: 'year' | 'preset' | 'custom', value?: number | PeriodPreset) => {
    if (allSelected) return false;
    if (type === 'year') return activeType === 'year' && year === value;
    if (type === 'preset') return activeType === 'preset' && activePreset === value;
    return activeType === 'custom';
  };

  const btnCn = (active: boolean) =>
    cn(
      buttonClasses,
      'font-medium rounded-md transition-all whitespace-nowrap touch-manipulation',
      active
        ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm'
        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300',
    );

  // ---- Render --------------------------------------------------------------

  return (
    <div className={cn('flex items-center gap-1.5 sm:gap-2 flex-wrap', className)}>
      {showLabel && (
        <span className={cn('text-slate-400 dark:text-slate-500 whitespace-nowrap', labelClasses)}>
          {label}
        </span>
      )}

      <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg overflow-x-auto">
        {/* Preset buttons */}
        {effectivePresets.map((preset) => {
          const meta = PRESET_META[preset];
          return (
            <button
              key={preset}
              onClick={() => handlePresetSelect(preset)}
              className={btnCn(isActive('preset', preset))}
              title={meta.title}
            >
              {meta.label}
            </button>
          );
        })}

        {/* Separator between presets and years (only if both are shown) */}
        {effectivePresets.length > 0 && showYears && (
          <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-0.5" />
        )}

        {/* Year buttons */}
        {showYears &&
          availableYears.map((y) => (
            <button
              key={y}
              onClick={() => handleYearSelect(y)}
              className={btnCn(isActive('year', y))}
            >
              {y === currentYear ? `${y} YTD` : y}
            </button>
          ))}

        {/* Custom Date Picker */}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                btnCn(isActive('custom')),
                'flex items-center gap-1',
              )}
            >
              <CalendarIcon
                className={
                  size === 'sm' ? 'w-2.5 h-2.5 sm:w-3 sm:h-3' : 'w-3 h-3 sm:w-3.5 sm:h-3.5'
                }
              />
              {activeType === 'custom' && customDateRange.start && customDateRange.end ? (
                <span className="hidden sm:inline">
                  {format(customDateRange.start, 'MMM d')} -{' '}
                  {format(customDateRange.end, 'MMM d, yyyy')}
                </span>
              ) : (
                <span className="hidden sm:inline">Custom</span>
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="end">
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={customDateRange.start || new Date(year, 0)}
              selected={{
                from: customDateRange.start || undefined,
                to: customDateRange.end || undefined,
              }}
              onSelect={handleCustomDateSelect}
              numberOfMonths={2}
            />
          </PopoverContent>
        </Popover>

        {/* All (no date filter) — e.g. for Loan Detail */}
        {showAllOption && onAllSelect && (
          <>
            <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-0.5" />
            <button
              type="button"
              onClick={onAllSelect}
              className={cn(
                btnCn(periodSelectionFromStore == null),
                'flex items-center gap-1',
              )}
              title="All time (no date filter)"
            >
              All
            </button>
          </>
        )}
      </div>

      {/* Clear custom date button */}
      {activeType === 'custom' && (customDateRange.start || customDateRange.end) && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClearCustom}
          className={size === 'sm' ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-6 w-6 sm:h-7 sm:w-7'}
        >
          <X
            className={
              size === 'sm' ? 'h-2.5 w-2.5 sm:h-3 sm:w-3' : 'h-3 w-3 sm:h-3.5 sm:w-3.5'
            }
          />
        </Button>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Hook – useDatePeriodState (backward-compatible + enhanced)
// ---------------------------------------------------------------------------

export const useDatePeriodState = (initialYear?: number) => {
  const currentYear = new Date().getFullYear();
  const [year, setYearRaw] = useState(initialYear || currentYear);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date();
    const y = initialYear || currentYear;
    return {
      start: `${y}-01-01`,
      end: y === currentYear ? fmtDate(today) : `${y}-12-31`,
    };
  });
  const [periodSelection, setPeriodSelection] = useState<PeriodSelection>(() => {
    const today = new Date();
    const y = initialYear || currentYear;
    return {
      type: 'year',
      year: y,
      dateRange: {
        start: `${y}-01-01`,
        end: y === currentYear ? fmtDate(today) : `${y}-12-31`,
      },
    };
  });

  const handleYearChange = useCallback((newYear: number) => {
    setYearRaw(newYear);
    const today = new Date();
    const isCurrentYear = newYear === today.getFullYear();
    const range: DateRange = {
      start: `${newYear}-01-01`,
      end: isCurrentYear ? fmtDate(today) : `${newYear}-12-31`,
    };
    setDateRange(range);
    setPeriodSelection({ type: 'year', year: newYear, dateRange: range });
  }, []);

  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  const handlePeriodChange = useCallback((selection: PeriodSelection) => {
    setDateRange(selection.dateRange);
    setPeriodSelection(selection);
    if (selection.year != null) setYearRaw(selection.year);
  }, []);

  return {
    year,
    setYear: handleYearChange,
    dateRange,
    setDateRange: handleDateRangeChange,
    periodSelection,
    setPeriodSelection: handlePeriodChange,
  };
};

export default DatePeriodPicker;
