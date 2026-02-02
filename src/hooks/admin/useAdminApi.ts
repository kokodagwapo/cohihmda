/**
 * useAdminApi Hook
 * 
 * Provides tenant-aware API request helpers for admin sections.
 * Automatically includes tenant_id for platform admins when a tenant is selected.
 */

import { useCallback } from 'react';
import { api } from '@/lib/api';
import { useAdminTenant } from '@/contexts/AdminTenantContext';
import { useAuth } from '@/contexts/AuthContext';

interface RequestOptions extends RequestInit {
  body?: string | FormData;
}

interface AdminApiHelpers {
  /**
   * Make a tenant-aware API request
   * Automatically appends tenant_id for platform admins
   */
  request: <T = any>(url: string, options?: RequestOptions) => Promise<T>;
  
  /**
   * Build a URL with tenant_id query param if needed
   */
  buildUrl: (baseUrl: string, params?: Record<string, string | undefined>) => string;
  
  /**
   * Get the current tenant ID for API calls
   */
  getTenantId: () => string | null;
  
  /**
   * Check if tenant context is available
   */
  hasTenantContext: boolean;
}

export function useAdminApi(): AdminApiHelpers {
  const { selectedTenantId, isPlatformAdmin } = useAdminTenant();
  const { user } = useAuth();
  
  // Get the effective tenant ID
  const getTenantId = useCallback((): string | null => {
    // For platform admins, use selected tenant
    if (isPlatformAdmin) {
      return selectedTenantId;
    }
    // For tenant admins/users, use their tenant
    return user?.tenant_id || null;
  }, [isPlatformAdmin, selectedTenantId, user?.tenant_id]);
  
  const hasTenantContext = getTenantId() !== null;
  
  /**
   * Build URL with tenant_id if needed
   */
  const buildUrl = useCallback((baseUrl: string, params?: Record<string, string | undefined>): string => {
    const url = new URL(baseUrl, window.location.origin);
    
    // Add tenant_id for platform admins
    const tenantId = getTenantId();
    if (isPlatformAdmin && tenantId) {
      url.searchParams.set('tenant_id', tenantId);
    }
    
    // Add any additional params
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          url.searchParams.set(key, value);
        }
      });
    }
    
    return url.pathname + url.search;
  }, [getTenantId, isPlatformAdmin]);
  
  /**
   * Make a tenant-aware API request
   */
  const request = useCallback(async <T = any>(url: string, options?: RequestOptions): Promise<T> => {
    const tenantId = getTenantId();
    
    // For GET requests, append tenant_id to URL
    if (!options?.method || options.method === 'GET') {
      const finalUrl = buildUrl(url);
      return api.request<T>(finalUrl, options);
    }
    
    // For POST/PUT/DELETE, add tenant_id to body
    if (isPlatformAdmin && tenantId && options?.body) {
      try {
        const body = JSON.parse(options.body as string);
        body.tenant_id = tenantId;
        return api.request<T>(url, {
          ...options,
          body: JSON.stringify(body),
        });
      } catch {
        // Body isn't JSON, just make the request as-is
        return api.request<T>(url, options);
      }
    }
    
    // For POST without body, create body with tenant_id
    if (isPlatformAdmin && tenantId && !options?.body && options?.method !== 'GET') {
      return api.request<T>(url, {
        ...options,
        body: JSON.stringify({ tenant_id: tenantId }),
      });
    }
    
    return api.request<T>(url, options);
  }, [getTenantId, isPlatformAdmin, buildUrl]);
  
  return {
    request,
    buildUrl,
    getTenantId,
    hasTenantContext,
  };
}

export default useAdminApi;
