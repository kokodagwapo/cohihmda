import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const PLATFORM_ROLES = new Set(["super_admin", "platform_admin", "support", "admin"]);

type TenantState = {
  selectedTenantId: string | null;
  setSelectedTenantId: (tenantId: string | null) => void;
  clearTenantSelection: () => void;
};

/**
 * Global tenant selection store.
 *
 * Only platform staff (super_admin, platform_admin, support) should set a
 * non-null value. The setter is intentionally a simple state update — callers
 * that are NOT platform staff must not invoke it with another tenant's ID.
 *
 * {@link enforcePlatformOnly} can be called at app startup to wipe any stale
 * selection that a non-platform user might have in localStorage.
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

/**
 * Call once after login/auth to ensure a non-platform user never has a stale
 * tenant override sitting in localStorage.
 */
export function enforcePlatformOnly(userRole: string | undefined) {
  if (!PLATFORM_ROLES.has(userRole || "")) {
    useTenantStore.getState().clearTenantSelection();
  }
}
