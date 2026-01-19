import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { LOSFunnelData } from '@/lib/losSchema';

export interface DashboardStatsData {
  total?: number;
  active?: number;
  closed?: number;
  locked?: number;
  avgCycleTime?: number;
  pullThroughRate?: number;
  creditPulls?: number;
  totalVolume?: number;
  activeVolume?: number;
  closedVolume?: number;
  lockedVolume?: number;
  avgLoanAmount?: number;
  avgInterestRate?: number;
  byLoanType?: Record<string, {
    count?: number;
    loans?: any[];
  }>;
  byStatus?: Record<string, {
    count?: number;
  }>;
}

export const useDashboardStats = (
  dateFilter: 'today' | 'mtd' | 'ytd' | 'custom',
  year: number = 2025
) => {
  const [statsData, setStatsData] = useState<DashboardStatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [funnelData, setFunnelData] = useState<LOSFunnelData | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(true);

  // Fetch stats data for Business Overview
  const fetchStatsData = async (forceRefresh = false) => {
    if (forceRefresh) {
      setStatsLoading(true);
    }
    
    // Check if user has a valid token before making API call
    const token = localStorage.getItem('auth_token');
    if (!token) {
      // No token - set data to null and stop loading
      setStatsData(null);
      setStatsLoading(false);
      return;
    }
    
    try {
      // Build URL with query parameters - respect dateFilter prop, default to 'all' to show all imported data
      const filterParam = dateFilter === 'custom' ? 'all' : dateFilter; // 'custom' not supported by API
      const url = `/api/loans/stats?dateFilter=${filterParam}&_t=${Date.now()}`; // Add timestamp to prevent caching
      console.log('🔍 Fetching stats from:', url, 'dateFilter prop:', dateFilter);
      const data = await api.request<DashboardStatsData>(url);
      console.log('📊 Stats data from API:', JSON.stringify({
        total: data.total,
        active: data.active,
        closed: data.closed,
        locked: data.locked,
        avgCycleTime: data.avgCycleTime,
        pullThroughRate: data.pullThroughRate,
        creditPulls: data.creditPulls,
        totalVolume: data.totalVolume,
        activeVolume: data.activeVolume,
        closedVolume: data.closedVolume
      }, null, 2));
      
      // Check if we got valid data - accept any response with expected structure
      if (data && (data.total !== undefined || data.active !== undefined)) {
        console.log('✅ Setting statsData:', data);
        // Set statsData with the API response - zeros are valid (means no loans)
        setStatsData(data);
      } else {
        console.warn('⚠️ API returned data but it appears empty or invalid:', data);
        // If we got a response but it's malformed, still try to use it
        if (data && typeof data === 'object') {
          setStatsData(data);
        }
      }
    } catch (error: any) {
      // Handle unauthorized errors silently (user not logged in)
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        // User not authenticated - set data to null without logging error
        setStatsData(null);
      } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
        // For timeout errors, log as warning since component has fallback handling
        console.warn('⚠️ Stats data request timed out, using fallback:', error.message);
        setStatsData(null);
      } else {
        console.error('❌ Failed to fetch stats data from API:', error);
        console.error('Error details:', {
          message: error.message,
          stack: error.stack
        });
        setStatsData(null);
      }
    } finally {
      setStatsLoading(false);
    }
  };

  // Fetch funnel data
  const fetchFunnelData = async () => {
    // Check if user has a valid token before making API call
    const token = localStorage.getItem('auth_token');
    if (!token) {
      // No token - set data to null and stop loading
      setFunnelData(null);
      setFunnelLoading(false);
      return;
    }
    
    try {
      setFunnelLoading(true);
      console.log('🔍 Fetching funnel data from /api/loans/funnel');
      const data = await api.request<LOSFunnelData>('/api/loans/funnel');
      console.log('📈 Funnel data from API:', JSON.stringify({
        loansStarted: data.loansStarted?.units,
        stillActive: data.stillActive?.units,
        originated: data.originated?.units,
        falloutWithdrawn: data.falloutWithdrawn?.units,
        falloutDenied: data.falloutDenied?.units,
        loansStartedVolume: data.loansStarted?.volume,
        stillActiveVolume: data.stillActive?.volume,
        originatedVolume: data.originated?.volume
      }, null, 2));
      
      // Check if we got valid data
      if (data && (data.loansStarted?.units !== undefined || data.stillActive?.units !== undefined)) {
        setFunnelData(data);
      } else {
        console.warn('⚠️ API returned funnel data but it appears empty or invalid:', data);
        setFunnelData(null);
      }
    } catch (error: any) {
      // Handle unauthorized errors silently (user not logged in)
      if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
        // User not authenticated - set data to null without logging error
        setFunnelData(null);
      } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
        // For timeout errors, log as warning since component has fallback handling
        console.warn('⚠️ Funnel data request timed out, using fallback:', error.message);
        setFunnelData(null);
      } else {
        console.error('❌ Failed to fetch funnel data from API:', error);
        console.error('Error details:', {
          message: error.message,
          stack: error.stack
        });
        setFunnelData(null);
      }
    } finally {
      setFunnelLoading(false);
    }
  };

  // Fetch stats data when dateFilter changes
  useEffect(() => {
    fetchStatsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateFilter]);

  // Fetch funnel data when year changes
  useEffect(() => {
    fetchFunnelData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  return {
    statsData,
    statsLoading,
    funnelData,
    funnelLoading,
    refreshStats: () => fetchStatsData(true),
    refreshFunnel: fetchFunnelData
  };
};

