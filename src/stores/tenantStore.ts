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
 * Call once after login/auth.
 * - Platform staff: leave selection untouched (they pick a tenant in the UI).
 * - Tenant users: set selectedTenantId to their own tenant so every page
 *   that reads from the store gets a valid value without per-page fallbacks.
 */
export function enforcePlatformOnly(userRole: string | undefined, tenantId?: string | null) {
  if (!PLATFORM_ROLES.has(userRole || "")) {
    if (tenantId) {
      useTenantStore.getState().setSelectedTenantId(tenantId);
    } else {
      useTenantStore.getState().clearTenantSelection();
    }
  }
}
