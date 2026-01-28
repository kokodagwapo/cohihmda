import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

export interface DateRange {
  startDate: string;
  endDate: string;
}

export interface OpsOverviewData {
  avgCycleTime?: {
    current: number;
    target: number;
  };
  activePipeline?: {
    count: number;
    volume: number;
  };
  processingEfficiency?: {
    current: number;
    target: number;
  };
  turnTimeByStage?: {
    appToLock: {
      actual: number;
      target: number;
    };
    lockToCTC: {
      actual: number;
      target: number;
    };
    ctcToFunding: {
      actual: number;
      target: number;
    };
  };
}

export const useOpsData = (
  dateRange?: DateRange,
  selectedTenantId?: string | null,
  selectedChannel?: string | null
) => {
  const [opsData, setOpsData] = useState<OpsOverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchOpsOverview = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        // No token - set data to null and stop loading
        setOpsData(null);
        setLoading(false);
        return;
      }
      
      try {
        // Build query parameters
        const params = new URLSearchParams();
        if (dateRange?.startDate) params.append('startDate', dateRange.startDate);
        if (dateRange?.endDate) params.append('endDate', dateRange.endDate);
        if (selectedTenantId) params.append('tenant_id', selectedTenantId);
        if (selectedChannel) params.append('channel_group', selectedChannel);
        
        const queryString = params.toString();
        const url = `/api/loans/operations-overview${queryString ? `?${queryString}` : ''}`;
        
        console.log('🔍 Fetching operations overview from', url);
        const data = await api.request<OpsOverviewData>(url);
        console.log('📊 Operations overview data from API:', data);
        setOpsData(data);
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
          // User not authenticated - set data to null without logging error
          setOpsData(null);
        } else {
          console.warn('Failed to fetch operations overview data:', error);
          setOpsData(null);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchOpsOverview();
  }, [dateRange?.startDate, dateRange?.endDate, selectedTenantId, selectedChannel]);

  return { opsData, loading };
};

