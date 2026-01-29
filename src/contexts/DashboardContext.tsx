import React, { createContext, useContext, useState, useCallback, ReactNode, useMemo } from 'react';

/**
 * Dashboard date filter types
 */
export type DateFilterType = 'today' | 'mtd' | 'ytd' | 'custom';

/**
 * Custom date range for when dateFilter is 'custom'
 */
export interface CustomDateRange {
  start: Date | null;
  end: Date | null;
}

/**
 * Dashboard context state
 */
interface DashboardContextState {
  // Date filtering
  dateFilter: DateFilterType;
  setDateFilter: (filter: DateFilterType) => void;
  customDateRange: CustomDateRange;
  setCustomDateRange: (range: CustomDateRange) => void;
  
  // Tenant selection (for multi-tenant scenarios)
  selectedTenantId: string | null;
  setSelectedTenantId: (tenantId: string | null) => void;
  
  // Channel selection
  selectedChannel: string | null;
  setSelectedChannel: (channel: string | null) => void;
  
  // Current year for reporting
  year: number;
  setYear: (year: number) => void;
}

const DashboardContext = createContext<DashboardContextState | undefined>(undefined);

interface DashboardProviderProps {
  children: ReactNode;
  initialDateFilter?: DateFilterType;
  initialTenantId?: string | null;
  initialChannel?: string | null;
  initialYear?: number;
}

/**
 * DashboardProvider - Provides shared dashboard state to avoid prop drilling
 * 
 * Wrap your dashboard components with this provider:
 * ```tsx
 * <DashboardProvider initialDateFilter="mtd">
 *   <ExecutiveDashboard />
 *   <ClosingFalloutForecast />
 *   <LeaderBoardSection />
 * </DashboardProvider>
 * ```
 * 
 * Then use the hook in child components:
 * ```tsx
 * const { dateFilter, selectedTenantId } = useDashboard();
 * ```
 */
export const DashboardProvider: React.FC<DashboardProviderProps> = ({
  children,
  initialDateFilter = 'mtd',
  initialTenantId = null,
  initialChannel = null,
  initialYear = new Date().getFullYear(),
}) => {
  const [dateFilter, setDateFilter] = useState<DateFilterType>(initialDateFilter);
  const [customDateRange, setCustomDateRange] = useState<CustomDateRange>({ start: null, end: null });
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(initialTenantId);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(initialChannel);
  const [year, setYear] = useState<number>(initialYear);

  // Memoize callbacks to prevent unnecessary re-renders
  const handleSetDateFilter = useCallback((filter: DateFilterType) => {
    setDateFilter(filter);
  }, []);

  const handleSetCustomDateRange = useCallback((range: CustomDateRange) => {
    setCustomDateRange(range);
  }, []);

  const handleSetSelectedTenantId = useCallback((tenantId: string | null) => {
    setSelectedTenantId(tenantId);
  }, []);

  const handleSetSelectedChannel = useCallback((channel: string | null) => {
    setSelectedChannel(channel);
  }, []);

  const handleSetYear = useCallback((newYear: number) => {
    setYear(newYear);
  }, []);

  // Memoize the context value to prevent unnecessary re-renders
  const value = useMemo<DashboardContextState>(() => ({
    dateFilter,
    setDateFilter: handleSetDateFilter,
    customDateRange,
    setCustomDateRange: handleSetCustomDateRange,
    selectedTenantId,
    setSelectedTenantId: handleSetSelectedTenantId,
    selectedChannel,
    setSelectedChannel: handleSetSelectedChannel,
    year,
    setYear: handleSetYear,
  }), [
    dateFilter,
    handleSetDateFilter,
    customDateRange,
    handleSetCustomDateRange,
    selectedTenantId,
    handleSetSelectedTenantId,
    selectedChannel,
    handleSetSelectedChannel,
    year,
    handleSetYear,
  ]);

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
};

/**
 * Hook to access dashboard context
 * 
 * @throws Error if used outside of DashboardProvider
 * 
 * Usage:
 * ```tsx
 * const { dateFilter, selectedTenantId, setDateFilter } = useDashboard();
 * ```
 */
export const useDashboard = (): DashboardContextState => {
  const context = useContext(DashboardContext);
  if (context === undefined) {
    throw new Error('useDashboard must be used within a DashboardProvider');
  }
  return context;
};

/**
 * Optional hook that returns undefined if not within provider
 * Useful for components that can work both inside and outside the provider
 */
export const useDashboardOptional = (): DashboardContextState | undefined => {
  return useContext(DashboardContext);
};

export default DashboardContext;
