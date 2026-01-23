/**
 * AdminTenantContext
 * 
 * Centralized tenant selection management for admin sections.
 * - Auto-sets tenant for tenant_admin users (locked to their tenant)
 * - Provides tenant selector for platform admins (super_admin, platform_admin)
 * - Single source of truth for current tenant across all admin sections
 */

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

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
  
  // Track previous user ID to detect user changes (login/logout)
  const [prevUserId, setPrevUserId] = useState<string | null>(null);
  
  // Role determination - use null checks to handle logged out state
  const isTenantAdmin = user?.role === 'tenant_admin';
  const isPlatformAdmin = user?.role === 'super_admin' || user?.role === 'platform_admin';
  
  // Tenant list state (for platform admin selector)
  const [tenants, setTenants] = useState<AdminTenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  
  // Selected tenant state
  // For tenant admins, this is auto-set to their tenant_id
  // For platform admins, this starts as null and can be changed
  const [selectedTenantId, setSelectedTenantIdInternal] = useState<string | null>(null);
  
  // Reset all state when user changes (login/logout/switch user)
  useEffect(() => {
    const currentUserId = user?.id || null;
    
    if (currentUserId !== prevUserId) {
      console.log('[AdminTenantContext] User changed, resetting state', { 
        from: prevUserId, 
        to: currentUserId,
        newRole: user?.role 
      });
      
      // Clear all state
      setTenants([]);
      setTenantsLoading(false);
      
      // Set tenant based on new user's role
      if (!user) {
        // Logged out - clear everything
        setSelectedTenantIdInternal(null);
      } else if (user.role === 'tenant_admin' && user.tenant_id) {
        // Tenant admin - set to their tenant
        setSelectedTenantIdInternal(user.tenant_id);
      } else {
        // Platform admin or other - start with no tenant selected
        setSelectedTenantIdInternal(null);
      }
      
      setPrevUserId(currentUserId);
    }
  }, [user?.id, user?.role, user?.tenant_id, prevUserId]);
  
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
  const setSelectedTenantId = useCallback((id: string | null) => {
    if (isTenantAdmin) {
      // Tenant admins cannot change tenant - always use their assigned tenant
      console.warn('[AdminTenantContext] Tenant admin cannot change tenant selection');
      return;
    }
    setSelectedTenantIdInternal(id);
  }, [isTenantAdmin]);
  
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
