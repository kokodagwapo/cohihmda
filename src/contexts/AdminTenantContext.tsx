/**
 * AdminTenantContext
 * 
 * Centralized tenant selection management for admin sections.
 * - Auto-sets tenant for tenant_admin users (locked to their tenant)
 * - Provides tenant selector for platform admins (super_admin, platform_admin)
 * - Syncs with global useTenantStore for site-wide persistence
 */

import React, { createContext, useContext, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useTenantStore } from '@/stores/tenantStore';

/**
 * Tenant info for the selector
 */
export interface AdminTenant {
  id: string;
  name: string;
  slug?: string;
  status?: string;
}

/**
 * Admin tenant context state and methods
 */
interface AdminTenantContextType {
  // Current selected tenant (auto-set for tenant_admin, selectable for platform admin)
  selectedTenantId: string | null;
  setSelectedTenantId: (id: string | null) => void;
  
  // Tenant list (for platform admin selector)
  tenants: AdminTenant[];
  tenantsLoading: boolean;
  loadTenants: () => Promise<void>;
  
  // Role flags
  isTenantAdmin: boolean;
  isPlatformAdmin: boolean;
  
  // Current tenant info
  currentTenantName: string | null;
  
  // Helper to get tenant name by ID
  getTenantName: (id: string | null) => string | null;
}

const AdminTenantContext = createContext<AdminTenantContextType | undefined>(undefined);

interface AdminTenantProviderProps {
  children: ReactNode;
}

export function AdminTenantProvider({ children }: AdminTenantProviderProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Use global tenant store for persistence across pages
  const { selectedTenantId: globalSelectedTenantId, setSelectedTenantId: setGlobalSelectedTenantId } = useTenantStore();
  
  // Role determination - use null checks to handle logged out state
  const isTenantAdmin = user?.role === 'tenant_admin';
  const isPlatformAdmin = user?.role === 'super_admin' || user?.role === 'platform_admin';
  
  // Tenant list state (for platform admin selector)
  const [tenants, setTenants] = React.useState<AdminTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = React.useState(false);
  
  // Selected tenant - use global store value, but tenant_admins always use their own tenant
  const selectedTenantId = isTenantAdmin && user?.tenant_id 
    ? user.tenant_id 
    : globalSelectedTenantId;
  
  // Load tenants list (for platform admin selector)
  const loadTenants = useCallback(async () => {
    if (!isPlatformAdmin || !user) return;
    
    try {
      setTenantsLoading(true);
      const response = await api.request<{ tenants: AdminTenant[] } | AdminTenant[]>('/api/tenants');
      // Handle both response formats
      const tenantsList = Array.isArray(response) ? response : (response as any).tenants || [];
      setTenants(tenantsList);
    } catch (error: any) {
      console.error('[AdminTenantContext] Error loading tenants:', error);
      toast({
        title: 'Error',
        description: 'Failed to load tenants list',
        variant: 'destructive',
      });
    } finally {
      setTenantsLoading(false);
    }
  }, [isPlatformAdmin, user, toast]);
  
  // Setter that prevents tenant admins from changing tenant
  // Uses the global store for persistence
  const setSelectedTenantId = useCallback((id: string | null) => {
    if (isTenantAdmin) {
      // Tenant admins cannot change tenant - always use their assigned tenant
      console.warn('[AdminTenantContext] Tenant admin cannot change tenant selection');
      return;
    }
    // Update global store - this persists across pages
    setGlobalSelectedTenantId(id);
  }, [isTenantAdmin, setGlobalSelectedTenantId]);
  
  // Load tenants list when platform admin accesses admin
  useEffect(() => {
    if (isPlatformAdmin && user) {
      loadTenants();
    }
  }, [isPlatformAdmin, user, loadTenants]);
  
  // Get current tenant name
  const getTenantName = useCallback((id: string | null): string | null => {
    if (!id) return null;
    
    // For tenant admins, use the user's tenant_name
    if (isTenantAdmin && user?.tenant_name && id === user.tenant_id) {
      return user.tenant_name;
    }
    
    // For platform admins, look up in tenants list
    const tenant = tenants.find(t => t.id === id);
    return tenant?.name || null;
  }, [isTenantAdmin, user?.tenant_name, user?.tenant_id, tenants]);
  
  const currentTenantName = getTenantName(selectedTenantId);
  
  const value: AdminTenantContextType = {
    selectedTenantId,
    setSelectedTenantId,
    tenants,
    tenantsLoading,
    loadTenants,
    isTenantAdmin,
    isPlatformAdmin,
    currentTenantName,
    getTenantName,
  };
  
  return (
    <AdminTenantContext.Provider value={value}>
      {children}
    </AdminTenantContext.Provider>
  );
}

/**
 * Hook to access admin tenant context
 * Must be used within AdminTenantProvider
 */
export function useAdminTenant(): AdminTenantContextType {
  const context = useContext(AdminTenantContext);
  if (context === undefined) {
    throw new Error('useAdminTenant must be used within an AdminTenantProvider');
  }
  return context;
}

/**
 * Optional hook that returns null if not within provider (for components that may be used outside admin)
 */
export function useAdminTenantOptional(): AdminTenantContextType | null {
  return useContext(AdminTenantContext) || null;
}

export default AdminTenantContext;
