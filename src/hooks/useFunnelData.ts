import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { LOSFunnelData } from '@/lib/losSchema';

export interface FunnelDataFilters {
  loan_officer_id?: string;
  branch?: string;
  loan_type?: string;
  channel?: string;
  // channelGroup uses consolidated channel (Retail, TPO, etc.) matching Qlik logic
  channelGroup?: string;
}

export interface FunnelDateFilter {
  type: 'year' | 'custom';
  year?: number;
  startDate?: string; // ISO date string (YYYY-MM-DD)
  endDate?: string;   // ISO date string (YYYY-MM-DD)
}

export const useFunnelData = (
  dateFilter: FunnelDateFilter,
  selectedTenantId?: string | null,
  additionalFilters?: FunnelDataFilters
) => {
  const [funnelData, setFunnelData] = useState<LOSFunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFunnelData = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        // No token - set data to null and stop loading
        console.log('[useFunnelData] No token, skipping fetch');
        setFunnelData(null);
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        
        // Build URL with date filters, tenant_id and additional filters
        const params = new URLSearchParams();
        
        // Handle date filtering - either year or custom range
        if (dateFilter.type === 'year' && dateFilter.year) {
          params.append('year', dateFilter.year.toString());
        } else if (dateFilter.type === 'custom' && dateFilter.startDate && dateFilter.endDate) {
          params.append('startDate', dateFilter.startDate);
          params.append('endDate', dateFilter.endDate);
        }
        
        if (selectedTenantId) params.append('tenant_id', selectedTenantId);
        if (additionalFilters?.loan_officer_id) params.append('loan_officer_id', additionalFilters.loan_officer_id);
        if (additionalFilters?.branch) params.append('branch', additionalFilters.branch);
        if (additionalFilters?.loan_type) params.append('loan_type', additionalFilters.loan_type);
        if (additionalFilters?.channel) params.append('channel', additionalFilters.channel);
        if (additionalFilters?.channelGroup) params.append('channel_group', additionalFilters.channelGroup);
        
        console.log('[useFunnelData] Fetching funnel data:', { dateFilter, selectedTenantId, channelGroup: additionalFilters?.channelGroup, params: params.toString() });
        const data = await api.request<LOSFunnelData>(`/api/loans/funnel?${params.toString()}`);
        console.log('[useFunnelData] Received funnel data:', {
          loansStarted: data?.loansStarted?.units,
          stillActive: data?.stillActive?.units,
          originated: data?.originated?.units,
        });
        setFunnelData(data);
      } catch (error: any) {
        // Handle unauthorized errors silently (user not logged in)
        if (error.message?.includes('Unauthorized') || error.message?.includes('401')) {
          // User not authenticated - set data to null without logging error
          setFunnelData(null);
        } else if (error.message?.includes('timed out') || error.message?.includes('timeout')) {
          // For timeout errors, log as warning since component has zero data fallback
          console.warn('Funnel data request timed out, using zero data fallback:', error.message);
          setFunnelData(null);
        } else {
          console.error('Error fetching funnel data:', error);
          setFunnelData(null);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchFunnelData();
  }, [dateFilter.type, dateFilter.year, dateFilter.startDate, dateFilter.endDate, selectedTenantId, additionalFilters?.loan_officer_id, additionalFilters?.branch, additionalFilters?.loan_type, additionalFilters?.channel, additionalFilters?.channelGroup]);

  return { funnelData, loading };
};

