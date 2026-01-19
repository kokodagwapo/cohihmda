import { useState, useMemo } from 'react';
import { format } from 'date-fns';
import { DateRange } from 'react-day-picker';

export type DateFilter = 'today' | 'mtd' | 'ytd' | 'custom';

export interface UseDashboardFiltersReturn {
  dateFilter: DateFilter;
  setDateFilter: (filter: DateFilter) => void;
  customDateRange: DateRange | undefined;
  setCustomDateRange: (range: DateRange | undefined) => void;
  customDateLabel: string;
  customDatePopoverOpen: boolean;
  setCustomDatePopoverOpen: (open: boolean) => void;
  currentYear: number;
  handleCustomRangeSelect: (range?: DateRange) => void;
}

export function useDashboardFilters(): UseDashboardFiltersReturn {
  const [dateFilter, setDateFilter] = useState<DateFilter>('ytd');
  const [customDateRange, setCustomDateRange] = useState<DateRange | undefined>(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 29); // default last 30 days
    return {
      from: start,
      to: end
    };
  });
  const [customDatePopoverOpen, setCustomDatePopoverOpen] = useState(false);
  const currentYear = useMemo(() => new Date().getFullYear(), []);

  const customDateLabel = useMemo(() => {
    if (customDateRange?.from && customDateRange?.to) {
      return `${format(customDateRange.from, 'MMM d, yyyy')} – ${format(customDateRange.to, 'MMM d, yyyy')}`;
    }
    return 'Select range';
  }, [customDateRange]);

  const handleCustomRangeSelect = (range?: DateRange) => {
    setCustomDateRange(range);
    if (range?.from && range?.to) {
      setDateFilter('custom');
    }
  };

  return {
    dateFilter,
    setDateFilter,
    customDateRange,
    setCustomDateRange,
    customDateLabel,
    customDatePopoverOpen,
    setCustomDatePopoverOpen,
    currentYear,
    handleCustomRangeSelect
  };
}

