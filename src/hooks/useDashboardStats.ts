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
      const data = await api.request<DashboardStatsData>(url);
      
      // Check if we got valid data - accept any response with expected structure
      if (data && (data.total !== undefined || data.active !== undefined)) {
        setStatsData(data);
      } else if (data && typeof data === 'object') {
        // If we got a response but it's malformed, still try to use it
        setStatsData(data);
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
      } else if (error.message?.includes('not found') || error.message?.includes('404') || error.message?.includes('Tenant not found')) {
        // Stats endpoint doesn't exist or tenant not found - silently use fallback
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
      const data = await api.request<LOSFunnelData>('/api/loans/funnel');
      
      // Check if we got valid data
      if (data && (data.loansStarted?.units !== undefined || data.stillActive?.units !== undefined)) {
        setFunnelData(data);
      } else {
        setFunnelData(null);
      }
    } catch (error: any) {
      // Silently handle common errors
      if (error.message?.includes('Unauthorized') || 
          error.message?.includes('401') ||
          error.message?.includes('timed out') || 
          error.message?.includes('timeout') ||
          error.message?.includes('not found') ||
          error.message?.includes('Tenant not found')) {
        setFunnelData(null);
      } else {
        console.error('Failed to fetch funnel data:', error.message);
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

