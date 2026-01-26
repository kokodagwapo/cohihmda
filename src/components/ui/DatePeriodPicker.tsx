/**
 * DatePeriodPicker - Reusable date period selector component
 * 
 * Provides year selection (YTD for current year, full year for past years)
 * and custom date range selection.
 * 
 * Matches the date filter logic from the legacy Qlik apps:
 * - Current year: YTD (Jan 1 to today)
 * - Past years: Full year (Jan 1 to Dec 31)
 * - Custom: User-selected date range
 */

import { useState, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { Calendar as CalendarIcon, X } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  
  // Date filter type: 'year' or 'custom'
  const [dateFilterType, setDateFilterType] = useState<'year' | 'custom'>('year');
  const [customDateRange, setCustomDateRange] = useState<{ start: Date | null; end: Date | null }>({ 
    start: null, 
    end: null 
  });

  // Calculate the effective date range based on selection
  const calculateDateRange = useCallback((
    filterType: 'year' | 'custom',
    selectedYear: number,
    customRange: { start: Date | null; end: Date | null }
  ): DateRange => {
    if (filterType === 'custom' && customRange.start && customRange.end) {
      return {
        start: customRange.start.toISOString().split('T')[0],
        end: customRange.end.toISOString().split('T')[0],
      };
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
  }, []);

  // Notify parent of date range changes
  const notifyDateRangeChange = useCallback((
    filterType: 'year' | 'custom',
    selectedYear: number,
    customRange: { start: Date | null; end: Date | null }
  ) => {
    if (onDateRangeChange) {
      const range = calculateDateRange(filterType, selectedYear, customRange);
      onDateRangeChange(range);
    }
  }, [calculateDateRange, onDateRangeChange]);

  // Handle year button click
  const handleYearSelect = (selectedYear: number) => {
    setDateFilterType('year');
    onYearChange(selectedYear);
    notifyDateRangeChange('year', selectedYear, customDateRange);
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
      notifyDateRangeChange('custom', year, newRange);
    }
  };

  // Clear custom date range
  const handleClearCustom = () => {
    setCustomDateRange({ start: null, end: null });
    setDateFilterType('year');
    notifyDateRangeChange('year', year, { start: null, end: null });
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
