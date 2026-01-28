import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export const useLOSConnections = () => {
  const { toast } = useToast();
  const [losConnections, setLosConnections] = useState<any[]>([]);
  const [losTypes, setLosTypes] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLosData = useCallback(async (tenantId?: string | null) => {
    setLoading(true);
    try {
      setError(null);
      const url = tenantId 
        ? `/api/los/connections?tenant_id=${tenantId}`
        : '/api/los/connections';
      
      const [typesData, connectionsData] = await Promise.all([
        api.request<{ types: any }>('/api/los/types'),
        api.request<{ connections: any[] }>(url),
      ]);
      console.log('[useLOSConnections] Loaded data:', {
        typesCount: Object.keys(typesData.types || {}).length,
        connectionsCount: connectionsData.connections?.length || 0,
        connections: connectionsData.connections,
      });
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

  const testConnection = useCallback(async (connectionId: string, tenantId?: string) => {
    try {
      const url = tenantId 
        ? `/api/los/connections/${connectionId}/test?tenant_id=${tenantId}`
        : `/api/los/connections/${connectionId}/test`;
      
      const result = await api.request<{ success: boolean; message?: string; error?: string }>(
        url,
        { method: 'POST' }
      );
      toast({
        title: result.success ? 'Success' : 'Warning',
        description: result.message || result.error || 'Connection test completed.',
        variant: result.success ? 'default' : 'destructive',
      });
      return result;
    } catch (error: any) {
      console.error('Error testing connection:', error);
      toast({
        title: 'Error',
        description: error.message || error.error || 'Failed to test connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [toast]);

  const syncConnection = useCallback(async (connectionId: string, tenantId?: string, clearDatabase: boolean = false, testMode: boolean = false, limit?: number) => {
    try {
      const params = new URLSearchParams();
      if (tenantId) params.append('tenant_id', tenantId);
      if (clearDatabase) params.append('clearDatabase', 'true');
      if (clearDatabase) params.append('fullSync', 'true'); // Full sync when clearing
      if (testMode) params.append('testMode', 'true');
      if (limit) params.append('limit', limit.toString());
      
      const url = `/api/los/connections/${connectionId}/sync${params.toString() ? '?' + params.toString() : ''}`;
      
      const result = await api.request<{ success: boolean; message: string; synced: number }>(
        url,
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

  const createConnection = useCallback(async (connectionData: any, tenantId?: string) => {
    try {
      const url = tenantId 
        ? `/api/los/connections?tenant_id=${tenantId}`
        : '/api/los/connections';
      
      const response = await api.request<{ connection: any }>(url, {
        method: 'POST',
        body: JSON.stringify(connectionData),
      });
      toast({
        title: 'Success',
        description: 'LOS connection created successfully.',
      });
      await loadLosData(tenantId);
      return response.connection; // Return created connection
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

  const updateConnection = useCallback(async (connectionId: string, updates: any, tenantId?: string) => {
    try {
      const url = tenantId 
        ? `/api/los/connections/${connectionId}?tenant_id=${tenantId}`
        : `/api/los/connections/${connectionId}`;
      
      await api.request(url, {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      toast({
        title: 'Success',
        description: 'LOS connection updated successfully.',
      });
      await loadLosData(tenantId);
    } catch (error: any) {
      console.error('Error updating connection:', error);
      toast({
        title: 'Update Failed',
        description: error.message || error.error || 'Failed to update LOS connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadLosData, toast]);

  const deleteConnection = useCallback(async (connectionId: string, tenantId?: string) => {
    try {
      const url = tenantId 
        ? `/api/los/connections/${connectionId}?tenant_id=${tenantId}`
        : `/api/los/connections/${connectionId}`;
      
      await api.request(url, {
        method: 'DELETE',
      });
      toast({
        title: 'Success',
        description: 'LOS connection deleted successfully.',
      });
      await loadLosData(tenantId);
    } catch (error: any) {
      console.error('Error deleting connection:', error);
      toast({
        title: 'Delete Failed',
        description: error.message || error.error || 'Failed to delete LOS connection.',
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
    updateConnection,
    deleteConnection,
  };
};

