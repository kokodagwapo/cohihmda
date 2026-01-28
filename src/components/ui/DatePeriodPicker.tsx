/**
 * DatePeriodPicker - Reusable date period selector component
 * 
 * Provides year selection (YTD for current year, full year for past years),
 * rolling period selection, and custom date range selection.
 * 
 * Matches the date filter logic from the legacy Qlik apps:
 * - Current year: YTD (Jan 1 to today)
 * - Past years: Full year (Jan 1 to Dec 31)
 * - Rolling 12/13 months: From first of month N months ago to today
 * - Custom: User-selected date range
 */

import { useState, useMemo, useCallback } from 'react';
import { format, subMonths, startOfMonth } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Rolling period types matching Qlik flags
export type RollingPeriod = 'rolling12' | 'rolling13';

// Types
export interface DateRange {
  start: string; // YYYY-MM-DD format
  end: string;   // YYYY-MM-DD format
}

export interface DatePeriodPickerProps {
  /** Currently selected year */
  year: number;
  /** Callback when year changes */
  onYearChange: (year: number) => void;
  /** Callback when date range changes (includes calculated range based on year/custom selection) */
  onDateRangeChange?: (range: DateRange) => void;
  /** Number of years to show (default: 4, going back from current year) */
  yearsToShow?: number;
  /** Optional className for the container */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'default';
  /** Label text (default: "Period:") */
  label?: string;
  /** Whether to show the label */
  showLabel?: boolean;
}

// Generate years from current year down
const generateYears = (count: number): number[] => {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: count }, (_, i) => currentYear - i);
};

export const DatePeriodPicker = ({
  year,
  onYearChange,
  onDateRangeChange,
  yearsToShow = 4,
  className,
  size = 'default',
  label = 'Period:',
  showLabel = true,
}: DatePeriodPickerProps) => {
  const currentYear = new Date().getFullYear();
  const availableYears = useMemo(() => generateYears(yearsToShow), [yearsToShow]);
  
  // Date filter type: 'year', 'rolling', or 'custom'
  const [dateFilterType, setDateFilterType] = useState<'year' | 'rolling' | 'custom'>('year');
  const [rollingPeriod, setRollingPeriod] = useState<RollingPeriod | null>(null);
  const [customDateRange, setCustomDateRange] = useState<{ start: Date | null; end: Date | null }>({ 
    start: null, 
    end: null 
  });

  // Calculate rolling period date range (matches Qlik's Rolling12MonthFlag / Rolling13MonthFlag)
  // Qlik formula: AddMonths(MonthEnd(vMaxDate), -N, 1) to vMaxDate
  // This means: First day of month N months ago to today
  const calculateRollingDateRange = useCallback((months: number): DateRange => {
    const today = new Date();
    const startDate = startOfMonth(subMonths(today, months));
    return {
      start: format(startDate, 'yyyy-MM-dd'),
      end: format(today, 'yyyy-MM-dd'),
    };
  }, []);

  // Calculate the effective date range based on selection
  const calculateDateRange = useCallback((
    filterType: 'year' | 'rolling' | 'custom',
    selectedYear: number,
    customRange: { start: Date | null; end: Date | null },
    rolling: RollingPeriod | null
  ): DateRange => {
    if (filterType === 'custom' && customRange.start && customRange.end) {
      return {
        start: customRange.start.toISOString().split('T')[0],
        end: customRange.end.toISOString().split('T')[0],
      };
    }
    
    if (filterType === 'rolling' && rolling) {
      const months = rolling === 'rolling12' ? 12 : 13;
      return calculateRollingDateRange(months);
    }
    
    // For year-based filtering
    const startOfYear = `${selectedYear}-01-01`;
    const today = new Date();
    const isCurrentYear = selectedYear === today.getFullYear();
    
    // For current year: use YTD (Jan 1 to today)
    // For past years: use full year (Jan 1 to Dec 31)
    const endDate = isCurrentYear 
      ? today.toISOString().split('T')[0]
      : `${selectedYear}-12-31`;
    
    return {
      start: startOfYear,
      end: endDate,
    };
  }, [calculateRollingDateRange]);

  // Notify parent of date range changes
  const notifyDateRangeChange = useCallback((
    filterType: 'year' | 'rolling' | 'custom',
    selectedYear: number,
    customRange: { start: Date | null; end: Date | null },
    rolling: RollingPeriod | null = null
  ) => {
    if (onDateRangeChange) {
      const range = calculateDateRange(filterType, selectedYear, customRange, rolling);
      onDateRangeChange(range);
    }
  }, [calculateDateRange, onDateRangeChange]);

  // Handle year button click
  const handleYearSelect = (selectedYear: number) => {
    setDateFilterType('year');
    setRollingPeriod(null);
    onYearChange(selectedYear);
    notifyDateRangeChange('year', selectedYear, customDateRange, null);
  };

  // Handle rolling period selection
  const handleRollingSelect = (period: RollingPeriod) => {
    setDateFilterType('rolling');
    setRollingPeriod(period);
    notifyDateRangeChange('rolling', year, customDateRange, period);
  };

  // Handle custom date range selection
  const handleCustomDateSelect = (range: { from?: Date; to?: Date } | undefined) => {
    const newRange = {
      start: range?.from || null,
      end: range?.to || null,
    };
    setCustomDateRange(newRange);
    
    if (range?.from && range?.to) {
      setDateFilterType('custom');
      setRollingPeriod(null);
      notifyDateRangeChange('custom', year, newRange, null);
    }
  };

  // Clear custom date range
  const handleClearCustom = () => {
    setCustomDateRange({ start: null, end: null });
    setRollingPeriod(null);
    setDateFilterType('year');
    notifyDateRangeChange('year', year, { start: null, end: null }, null);
  };

  // Size-based classes
  const buttonClasses = size === 'sm' 
    ? 'px-2 py-1 text-[10px] sm:px-2.5 sm:py-1.5 sm:text-xs'
    : 'px-2.5 py-1.5 sm:px-3 md:px-4 sm:py-2 text-[11px] sm:text-xs md:text-sm';

  const labelClasses = size === 'sm'
    ? 'text-[9px] sm:text-[10px]'
    : 'text-[10px] sm:text-xs';

  return (
    <div className={cn('flex items-center gap-1.5 sm:gap-2 flex-wrap', className)}>
      {showLabel && (
        <span className={cn('text-slate-400 dark:text-slate-500 whitespace-nowrap', labelClasses)}>
          {label}
        </span>
      )}
      
      <div className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 bg-slate-100 dark:bg-slate-800/50 rounded-lg overflow-x-auto">
        {/* Rolling period buttons - matches Qlik Rolling12MonthFlag / Rolling13MonthFlag */}
        <button 
          onClick={() => handleRollingSelect('rolling13')} 
          className={cn(
            buttonClasses,
            'font-medium rounded-md transition-all whitespace-nowrap touch-manipulation',
            dateFilterType === 'rolling' && rollingPeriod === 'rolling13'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          )}
          title="Rolling 13 months (Qlik default for TTS)"
        >
          L13M
        </button>
        <button 
          onClick={() => handleRollingSelect('rolling12')} 
          className={cn(
            buttonClasses,
            'font-medium rounded-md transition-all whitespace-nowrap touch-manipulation',
            dateFilterType === 'rolling' && rollingPeriod === 'rolling12'
              ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
              : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
          )}
          title="Rolling 12 months"
        >
          L12M
        </button>

        {/* Separator */}
        <div className="w-px h-4 bg-slate-300 dark:bg-slate-600 mx-0.5" />

        {/* Year buttons */}
        {availableYears.map(y => (
          <button 
            key={y} 
            onClick={() => handleYearSelect(y)} 
            className={cn(
              buttonClasses,
              'font-medium rounded-md transition-all whitespace-nowrap touch-manipulation',
              dateFilterType === 'year' && year === y 
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            )}
          >
            {y === currentYear ? `${y} YTD` : y}
          </button>
        ))}
        
        {/* Custom Date Picker */}
        <Popover>
          <PopoverTrigger asChild>
            <button 
              className={cn(
                buttonClasses,
                'font-medium rounded-md transition-all whitespace-nowrap touch-manipulation flex items-center gap-1',
                dateFilterType === 'custom' 
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
              )}
            >
              <CalendarIcon className={size === 'sm' ? 'w-2.5 h-2.5 sm:w-3 sm:h-3' : 'w-3 h-3 sm:w-3.5 sm:h-3.5'} />
              {dateFilterType === 'custom' && customDateRange.start && customDateRange.end ? (
                <span className="hidden sm:inline">
                  {format(customDateRange.start, 'MMM d')} - {format(customDateRange.end, 'MMM d, yyyy')}
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
      </div>
      
      {/* Clear custom date button */}
      {dateFilterType === 'custom' && (customDateRange.start || customDateRange.end) && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClearCustom}
          className={size === 'sm' ? 'h-5 w-5 sm:h-6 sm:w-6' : 'h-6 w-6 sm:h-7 sm:w-7'}
        >
          <X className={size === 'sm' ? 'h-2.5 w-2.5 sm:h-3 sm:w-3' : 'h-3 w-3 sm:h-3.5 sm:w-3.5'} />
        </Button>
      )}
    </div>
  );
};

/**
 * Hook to use DatePeriodPicker state externally
 * Useful when you need to access the date range without using the component
 */
export const useDatePeriodState = (initialYear?: number) => {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(initialYear || currentYear);
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const today = new Date();
    return {
      start: `${year}-01-01`,
      end: year === currentYear ? today.toISOString().split('T')[0] : `${year}-12-31`,
    };
  });

  const handleYearChange = useCallback((newYear: number) => {
    setYear(newYear);
    // Auto-calculate date range for year selection
    const today = new Date();
    const isCurrentYear = newYear === today.getFullYear();
    setDateRange({
      start: `${newYear}-01-01`,
      end: isCurrentYear ? today.toISOString().split('T')[0] : `${newYear}-12-31`,
    });
  }, []);

  const handleDateRangeChange = useCallback((range: DateRange) => {
    setDateRange(range);
  }, []);

  return {
    year,
    setYear: handleYearChange,
    dateRange,
    setDateRange: handleDateRangeChange,
  };
};

export default DatePeriodPicker;
