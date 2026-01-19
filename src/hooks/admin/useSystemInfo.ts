import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export interface SystemInfo {
  database: {
    version: string;
    uptime: string;
  };
  server: {
    environment: string;
    port: string;
    nodeVersion: string;
  };
  features: {
    ragEnabled: boolean;
    costTrackingEnabled: boolean;
    hybridSyncEnabled: boolean;
  };
}

export const useSystemInfo = () => {
  const { toast } = useToast();
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSystemInfo = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.request<SystemInfo>('/api/admin/system');
      setSystemInfo(data);
    } catch (error: any) {
      console.error('Error loading system info:', error);
      setError(error.message || 'Failed to load system information');
      // Set fallback data
      setSystemInfo({
        database: { version: 'Unknown', uptime: 'Unknown' },
        server: { 
          environment: import.meta.env.MODE || 'development', 
          port: '3001', 
          nodeVersion: 'Unknown' 
        },
        features: { 
          ragEnabled: false, 
          costTrackingEnabled: false, 
          hybridSyncEnabled: false 
        },
      });
      toast({
        title: 'Warning',
        description: 'Could not load complete system information.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    systemInfo,
    loading,
    error,
    loadSystemInfo,
  };
};

