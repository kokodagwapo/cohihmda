import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export const useLOSConnections = () => {
  const { toast } = useToast();
  const [losConnections, setLosConnections] = useState<any[]>([]);
  const [losTypes, setLosTypes] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLosData = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const [typesData, connectionsData] = await Promise.all([
        api.request<{ types: any }>('/api/los/types'),
        api.request<{ connections: any[] }>('/api/los/connections'),
      ]);
      setLosTypes(typesData.types || {});
      setLosConnections(connectionsData.connections || []);
    } catch (error: any) {
      console.error('Error loading LOS data:', error);
      setError(error.message || 'Failed to load LOS connections');
      toast({
        title: 'Error',
        description: error.message || 'Failed to load LOS connections.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const testConnection = useCallback(async (connectionId: string) => {
    try {
      const result = await api.request<{ success: boolean; message: string }>(
        `/api/los/connections/${connectionId}/test`,
        { method: 'POST' }
      );
      toast({
        title: result.success ? 'Success' : 'Warning',
        description: result.message || 'Connection test completed.',
        variant: result.success ? 'default' : 'destructive',
      });
      return result;
    } catch (error: any) {
      console.error('Error testing connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to test connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [toast]);

  const syncConnection = useCallback(async (connectionId: string) => {
    try {
      const result = await api.request<{ success: boolean; message: string; synced: number }>(
        `/api/los/connections/${connectionId}/sync`,
        { method: 'POST' }
      );
      toast({
        title: 'Success',
        description: result.message || `Synced ${result.synced || 0} loans successfully.`,
      });
      return result;
    } catch (error: any) {
      console.error('Error syncing connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to sync connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [toast]);

  const toggleConnection = useCallback(async (connectionId: string, isActive: boolean) => {
    try {
      await api.request(`/api/los/connections/${connectionId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: isActive }),
      });
      toast({
        title: 'Success',
        description: `Connection ${isActive ? 'enabled' : 'disabled'} successfully.`,
      });
      await loadLosData();
    } catch (error: any) {
      console.error('Error toggling connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to update connection status.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadLosData, toast]);

  const createConnection = useCallback(async (connectionData: any) => {
    try {
      await api.request('/api/los/connections', {
        method: 'POST',
        body: JSON.stringify(connectionData),
      });
      toast({
        title: 'Success',
        description: 'LOS connection created successfully.',
      });
      await loadLosData();
    } catch (error: any) {
      console.error('Error creating connection:', error);
      toast({
        title: 'Creation Failed',
        description: error.message || error.error || 'Failed to create LOS connection. Please check your inputs.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadLosData, toast]);

  return {
    losConnections,
    losTypes,
    loading,
    error,
    loadLosData,
    testConnection,
    syncConnection,
    toggleConnection,
    createConnection,
  };
};

