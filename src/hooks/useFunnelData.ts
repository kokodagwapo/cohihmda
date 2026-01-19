import { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { LOSFunnelData } from '@/lib/losSchema';

export const useFunnelData = (year: number) => {
  const [funnelData, setFunnelData] = useState<LOSFunnelData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchFunnelData = async () => {
      // Check if user has a valid token before making API call
      const token = localStorage.getItem('auth_token');
      if (!token) {
        // No token - set data to null and stop loading
        setFunnelData(null);
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        const data = await api.request<LOSFunnelData>(`/api/loans/funnel?year=${year.toString()}`);
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
  }, [year]);

  return { funnelData, loading };
};

