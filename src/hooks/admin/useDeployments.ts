import { useState, useCallback } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export const useDeployments = () => {
  const { toast } = useToast();
  const [deployments, setDeployments] = useState<any[]>([]);
  const [syncEvents, setSyncEvents] = useState<any[]>([]);
  const [deploymentsLoading, setDeploymentsLoading] = useState(false);
  const [syncEventsLoading, setSyncEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDeployments = useCallback(async () => {
    setDeploymentsLoading(true);
    try {
      setError(null);
      const deploymentsData = await api.request<{ instances: any[] }>('/api/deployments');
      setDeployments(deploymentsData.instances || []);
    } catch (error: any) {
      console.error('Error loading deployments:', error);
      setError(error.message || 'Failed to load deployment instances');
      toast({
        title: 'Error',
        description: error.message || 'Failed to load deployment instances.',
        variant: 'destructive',
      });
    } finally {
      setDeploymentsLoading(false);
    }
  }, [toast]);

  const loadSyncEvents = useCallback(async () => {
    setSyncEventsLoading(true);
    try {
      const syncData = await api.request<{ syncs: any[] }>('/api/deployments/sync/status');
      setSyncEvents(syncData.syncs || []);
    } catch (error: any) {
      console.error('Error loading sync events:', error);
    } finally {
      setSyncEventsLoading(false);
    }
  }, []);

  const provision = useCallback(async (provisionData: {
    instance_name: string;
    cloud_provider: 'aws' | 'azure' | 'gcp';
    cloud_region: string;
  }) => {
    try {
      await api.request('/api/deployments/provision', {
        method: 'POST',
        body: JSON.stringify({
          instance_type: 'cloud',
          ...provisionData,
        }),
      });
      toast({
        title: 'Success',
        description: 'Cloud instance provisioning started.',
      });
      await loadDeployments();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to provision instance.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadDeployments, toast]);

  const register = useCallback(async (registerData: {
    instance_name: string;
    ip_address: string;
    hostname: string;
    version: string;
  }) => {
    try {
      await api.request('/api/deployments/register', {
        method: 'POST',
        body: JSON.stringify(registerData),
      });
      toast({
        title: 'Success',
        description: 'On-premise instance registered successfully.',
      });
      await loadDeployments();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to register instance.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadDeployments, toast]);

  const startSync = useCallback(async (syncData: {
    target_instance_id: string;
    sync_type: 'full' | 'incremental' | 'realtime';
  }) => {
    try {
      await api.request('/api/deployments/sync/start', {
        method: 'POST',
        body: JSON.stringify(syncData),
      });
      toast({
        title: 'Success',
        description: 'Sync operation started.',
      });
      await loadSyncEvents();
      await loadDeployments();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to start sync.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadSyncEvents, loadDeployments, toast]);

  const failover = useCallback(async (targetInstanceId: string) => {
    try {
      await api.request('/api/deployments/failover', {
        method: 'POST',
        body: JSON.stringify({ target_instance_id: targetInstanceId }),
      });
      toast({
        title: 'Success',
        description: 'Failover completed successfully.',
      });
      await loadDeployments();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to trigger failover.',
        variant: 'destructive',
      });
      throw error;
    }
  }, [loadDeployments, toast]);

  return {
    deployments,
    syncEvents,
    deploymentsLoading,
    syncEventsLoading,
    error,
    loadDeployments,
    loadSyncEvents,
    provision,
    register,
    startSync,
    failover,
  };
};

