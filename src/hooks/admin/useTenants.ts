import { useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export interface Tenant {
  id: string;
  name: string;
  slug?: string;
  status?: string;
  is_demo?: boolean;
  source_tenant_id?: string | null;
  source_tenant_name?: string | null;
  last_refreshed_at?: string | null;
  auto_refresh?: boolean;
  created_at: string;
  updated_at: string;
}

export const useTenants = () => {
  const { toast } = useToast();
  // Use ref to avoid toast causing re-renders
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Use new management database endpoint
      const response = await api.request<{ tenants: Tenant[] } | Tenant[]>(
        "/api/tenants"
      );
      // Handle both response formats: { tenants: [] } or []
      const tenantsList = Array.isArray(response)
        ? response
        : (response as any).tenants || [];
      setTenants(tenantsList);
    } catch (error: any) {
      console.error("Error loading tenants:", error);
      setError(error.message || "Failed to load tenants");
      toastRef.current({
        title: "Error",
        description: error.message || "Failed to load tenants.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, []); // No dependencies - toast accessed via ref

  const createTenant = useCallback(
    async (tenantData: any) => {
      try {
        // Use new management database endpoint with full provisioning
        const deploymentType = tenantData.deployment_type || "cloud";

        // Base data - always required
        const fullTenantData: any = {
          name: tenantData.name,
          slug:
            tenantData.slug ||
            tenantData.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
          deployment_type: deploymentType,
        };

        // For non-cloud deployments, include database credentials
        // For cloud deployments, the backend uses its own environment variables
        if (deploymentType !== "cloud") {
          fullTenantData.database_host = tenantData.database_host;
          fullTenantData.database_port = tenantData.database_port || 5432;
          fullTenantData.database_user = tenantData.database_user;
          fullTenantData.database_password = tenantData.database_password;
        }

        await api.request("/api/tenants", {
          method: "POST",
          body: JSON.stringify(fullTenantData),
        });
        toastRef.current({
          title: "Success",
          description: "Tenant created successfully",
        });
        await loadTenants();
      } catch (error: any) {
        console.error("Error creating tenant:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to create tenant",
          variant: "destructive",
        });
        throw error;
      }
    },
    [loadTenants]
  );

  const updateTenant = useCallback(
    async (tenantId: string, tenantData: Partial<Tenant>) => {
      try {
        await api.request(`/api/admin/tenants/${tenantId}`, {
          method: "PUT",
          body: JSON.stringify(tenantData),
        });
        toastRef.current({
          title: "Success",
          description: "Tenant updated successfully",
        });
        await loadTenants();
      } catch (error: any) {
        console.error("Error updating tenant:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to update tenant",
          variant: "destructive",
        });
        throw error;
      }
    },
    [loadTenants]
  );

  const [duplicating, setDuplicating] = useState(false);
  const [duplicationProgress, setDuplicationProgress] = useState<string | null>(null);
  const [refreshingDemoTenantId, setRefreshingDemoTenantId] = useState<string | null>(null);

  const duplicateTenant = useCallback(
    async (
      tenantId: string,
      name: string,
      slug: string,
      options?: { autoRefresh?: boolean },
    ) => {
      try {
        setDuplicating(true);
        setDuplicationProgress("Starting duplication...");

        // 1. Start the async job (returns 202 immediately)
        const startResult = await api.request<{ jobSlug: string }>(`/api/tenants/${tenantId}/duplicate`, {
          method: "POST",
          body: JSON.stringify({
            name,
            slug,
            auto_refresh: options?.autoRefresh ?? false,
          }),
        });

        const jobSlug = startResult.jobSlug || slug;
        setDuplicationProgress("Copying data (this may take a few minutes)...");

        // 2. Poll for completion
        let attempts = 0;
        const maxAttempts = 120; // 10 minutes max (5s intervals)
        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          attempts++;

          try {
            const status = await api.request<{
              status: 'running' | 'completed' | 'failed';
              elapsedSeconds?: number;
              result?: any;
              error?: string;
            }>(`/api/tenants/duplication-status/${jobSlug}`);

            if (status.status === 'completed') {
              toastRef.current({
                title: "Success",
                description: `Tenant duplicated successfully as "${name}" with anonymized data`,
              });
              await loadTenants();
              return status.result;
            }

            if (status.status === 'failed') {
              throw new Error(status.error || 'Duplication failed');
            }

            // Still running — update progress
            const elapsed = status.elapsedSeconds || (attempts * 5);
            setDuplicationProgress(`Copying data... (${elapsed}s elapsed)`);
          } catch (pollError: any) {
            // 404 means the job was already cleaned up (shouldn't happen while running)
            if (pollError.message?.includes('404') || pollError.message?.includes('No duplication job')) {
              throw new Error('Duplication job disappeared unexpectedly');
            }
            throw pollError;
          }
        }

        throw new Error('Duplication timed out after 10 minutes');
      } catch (error: any) {
        console.error("Error duplicating tenant:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to duplicate tenant",
          variant: "destructive",
        });
        throw error;
      } finally {
        setDuplicating(false);
        setDuplicationProgress(null);
      }
    },
    [loadTenants]
  );

  const refreshDemoTenant = useCallback(
    async (tenantId: string) => {
      try {
        setRefreshingDemoTenantId(tenantId);

        const startResult = await api.request<{ jobId: string }>(
          `/api/tenants/${tenantId}/refresh`,
          { method: "POST" },
        );

        const jobId = startResult.jobId;
        let attempts = 0;
        const maxAttempts = 120;
        while (attempts < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
          attempts += 1;

          const status = await api.request<{
            status: "running" | "completed" | "failed";
            elapsedSeconds?: number;
            error?: string;
          }>(`/api/tenants/refresh-status/${jobId}`);

          if (status.status === "completed") {
            toastRef.current({
              title: "Success",
              description: "Demo tenant refreshed from source data",
            });
            await loadTenants();
            return;
          }
          if (status.status === "failed") {
            throw new Error(status.error || "Demo tenant refresh failed");
          }

        }

        throw new Error("Refresh timed out after 10 minutes");
      } catch (error: any) {
        console.error("Error refreshing demo tenant:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to refresh demo tenant",
          variant: "destructive",
        });
        throw error;
      } finally {
        setRefreshingDemoTenantId(null);
      }
    },
    [loadTenants],
  );

  const updateDemoSettings = useCallback(
    async (tenantId: string, autoRefresh: boolean) => {
      try {
        await api.request(`/api/tenants/${tenantId}/demo-settings`, {
          method: "PATCH",
          body: JSON.stringify({ auto_refresh: autoRefresh }),
        });
        await loadTenants();
      } catch (error: any) {
        console.error("Error updating demo settings:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to update demo settings",
          variant: "destructive",
        });
        throw error;
      }
    },
    [loadTenants],
  );

  const deleteTenant = useCallback(
    async (tenantId: string) => {
      try {
        await api.request(`/api/tenants/${tenantId}`, {
          method: "DELETE",
        });
        toastRef.current({
          title: "Success",
          description: "Tenant deleted successfully",
        });
        await loadTenants();
      } catch (error: any) {
        console.error("Error deleting tenant:", error);
        toastRef.current({
          title: "Error",
          description: error.message || "Failed to delete tenant",
          variant: "destructive",
        });
        throw error;
      }
    },
    [loadTenants]
  );

  return {
    tenants,
    loading,
    error,
    duplicating,
    duplicationProgress,
    refreshingDemoTenantId,
    loadTenants,
    createTenant,
    updateTenant,
    deleteTenant,
    duplicateTenant,
    refreshDemoTenant,
    updateDemoSettings,
  };
};
