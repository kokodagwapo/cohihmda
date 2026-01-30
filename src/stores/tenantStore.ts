import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type TenantState = {
  /** 
   * Selected tenant ID for super_admin users viewing another tenant's data.
   * null means "use default/own tenant" 
   */
  selectedTenantId: string | null;
  
  /** 
   * Set the selected tenant ID.
   * Pass null to reset to default (own tenant).
   */
  setSelectedTenantId: (tenantId: string | null) => void;
  
  /**
   * Clear tenant selection (reset to default)
   */
  clearTenantSelection: () => void;
};

/**
 * Global tenant selection store
 * 
 * Used by super_admin and platform_admin users to view other tenants' data.
 * Persists selection in localStorage so it survives page refreshes.
 * 
 * Components that use this:
 * - Dashboard (TenantSelector)
 * - Navigation (ChannelSelector - needs tenant context for channels API)
 * - Various dashboard components that fetch tenant-specific data
 */
export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      selectedTenantId: null,
      setSelectedTenantId: (tenantId) => set({ selectedTenantId: tenantId }),
      clearTenantSelection: () => set({ selectedTenantId: null }),
    }),
    {
      name: 'cohi-tenant-selection',
    }
  )
);
