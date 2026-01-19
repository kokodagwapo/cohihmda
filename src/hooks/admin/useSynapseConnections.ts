import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export const useSynapseConnections = () => {
  const { toast } = useToast();
  const [vendorConnections, setVendorConnections] = useState<any[]>([]);
  const [vendorCatalog, setVendorCatalog] = useState<any>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSynapseData = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      const [vendorsData, connectionsData] = await Promise.all([
        api.request<{ vendors: any }>('/api/synapse/vendors'),
        api.request<{ connections: any[] }>('/api/synapse/connections'),
      ]);
      setVendorCatalog(vendorsData.vendors || {});
      setVendorConnections(connectionsData.connections || []);
    } catch (error: any) {
      console.error('Error loading Synapse Connect data:', error);
      setError(error.message || 'Failed to load vendor connections');
      toast({
        title: 'Error',
        description: error.message || 'Failed to load vendor connections.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const testConnection = useCallback(async (connectionId: string) => {
    try {
      const result = await api.request<{ success: boolean; message: string }>(
        `/api/synapse/connections/${connectionId}/test`,
        { method: 'POST' }
      );
      toast({
        title: result.success ? 'Success' : 'Warning',
        description: result.message || 'Connection test completed.',
        variant: result.success ? 'default' : 'destructive',
      });
      return result;
    } catch (error: any) {
      console.error('Error testing vendor connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to test vendor connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [toast]);

  const createConnection = useCallback(async (connectionData: any) => {
    try {
      await api.request('/api/synapse/connections', {
        method: 'POST',
        body: JSON.stringify(connectionData),
      });
      toast({
        title: 'Success',
        description: 'Vendor connection created successfully.',
      });
      await loadSynapseData();
    } catch (error: any) {
      console.error('Error creating vendor connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to create vendor connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadSynapseData, toast]);

  const deleteConnection = useCallback(async (connectionId: string) => {
    try {
      await api.request(`/api/synapse/connections/${connectionId}`, {
        method: 'DELETE',
      });
      toast({
        title: 'Success',
        description: 'Vendor connection deleted successfully.',
      });
      await loadSynapseData();
    } catch (error: any) {
      console.error('Error deleting vendor connection:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete vendor connection.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadSynapseData, toast]);

  return {
    vendorConnections,
    vendorCatalog,
    loading,
    error,
    loadSynapseData,
    testConnection,
    createConnection,
    deleteConnection,
  };
};

