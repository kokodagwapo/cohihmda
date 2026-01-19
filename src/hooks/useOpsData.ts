import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

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

export const useOpsData = () => {
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
        const data = await api.request<OpsOverviewData>('/api/loans/operations-overview');
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
  }, []);

  return { opsData, loading };
};

