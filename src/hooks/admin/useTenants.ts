import { useState, useCallback, useRef } from "react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

export interface Tenant {
  id: string;
  name: string;
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

  const deleteTenant = useCallback(
    async (tenantId: string) => {
      try {
        await api.request(`/api/admin/tenants/${tenantId}`, {
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
    loadTenants,
    createTenant,
    updateTenant,
    deleteTenant,
  };
};
