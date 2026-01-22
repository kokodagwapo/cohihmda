import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Building2 } from 'lucide-react';
import { useTenants } from '@/hooks/admin/useTenants';
import { api } from '@/lib/api';

interface TenantSelectorProps {
  selectedTenantId: string | null;
  onTenantChange: (tenantId: string | null) => void;
  userRole?: string;
  compact?: boolean; // Compact mode for header placement
}

export const TenantSelector = ({ selectedTenantId, onTenantChange, userRole, compact = false }: TenantSelectorProps) => {
  const { tenants, loading, loadTenants } = useTenants();
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Check if user is admin first, then load tenants
  useEffect(() => {
    const checkUserRole = async () => {
      try {
        const userData = await api.getCurrentUser();
        setCurrentUser(userData.user);
        setCurrentUserRole(userData.user?.role || null);
        setAuthError(null);
        console.log('[TenantSelector] Current user:', userData.user);
        
        // Load tenants if user is admin
        const isAdmin = userData.user?.role === 'super_admin' || 
                       userData.user?.role === 'tenant_admin' || 
                       userData.user?.role === 'admin';
        if (isAdmin) {
          console.log('[TenantSelector] User is admin, loading tenants...');
          loadTenants();
        }
      } catch (error: any) {
        console.error('[TenantSelector] Error fetching user role:', error);
        setAuthError(error.message || 'Not authenticated');
        setCurrentUserRole(null);
      }
    };
    checkUserRole();
  }, [loadTenants]);

  const isAdmin = currentUserRole === 'super_admin' || currentUserRole === 'tenant_admin' || 
                 currentUserRole === 'admin' || // 'admin' maps to 'super_admin' in RBAC
                 userRole === 'super_admin' || userRole === 'tenant_admin';

  // Show debug info
  console.log('[TenantSelector] Debug:', {
    currentUserRole,
    userRole,
    isAdmin,
    currentUser: currentUser ? { email: currentUser.email, role: currentUser.role } : null,
    authError,
    tenantsCount: tenants?.length || 0,
    tenants: tenants?.map(t => ({ id: t.id, name: t.name })) || []
  });

  // Non-admin users don't see the selector
  if (!isAdmin) {
    // In compact mode, just return null
    if (compact) return null;
    
    // In full mode, show debug message
    return (
      <Card className="border-amber-200 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 mb-6">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-amber-900 dark:text-amber-100">
            Tenant Selector (Admin Only)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-amber-800 dark:text-amber-200 mb-2">
            The tenant selector is only visible to <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 rounded">super_admin</code> or <code className="px-1 py-0.5 bg-amber-100 dark:bg-amber-900 rounded">tenant_admin</code> users.
          </p>
          <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1 mt-3">
            <p><strong>Current Status:</strong></p>
            <ul className="list-disc list-inside ml-2 space-y-1">
              <li>Logged in: {currentUser ? 'Yes' : 'No'}</li>
              <li>Email: {currentUser?.email || 'Not available'}</li>
              <li>Role: {currentUserRole || 'Not available'}</li>
              {authError && <li>Error: {authError}</li>}
            </ul>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Compact mode for header placement
  if (compact) {
    const selectedTenantName = tenants.find(t => t.id === selectedTenantId)?.name;
    
    return (
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Viewing:</span>
        </div>
        <Select
          value={selectedTenantId || '__default__'}
          onValueChange={(value) => {
            if (value === '__default__') {
              onTenantChange(null);
            } else {
              onTenantChange(value);
            }
          }}
          disabled={loading}
        >
          <SelectTrigger className="w-48 h-8 text-sm font-light">
            <SelectValue placeholder={loading ? "Loading..." : "Select tenant..."} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__default__">My Tenant (Default)</SelectItem>
            {tenants && Array.isArray(tenants) && tenants.length > 0 ? (
              tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </SelectItem>
              ))
            ) : (
              !loading && <SelectItem value="__no_tenants__" disabled>No tenants available</SelectItem>
            )}
          </SelectContent>
        </Select>
        {selectedTenantId && selectedTenantName && (
          <>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              ⚠️ {selectedTenantName}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onTenantChange(null)}
              className="h-7 px-2 text-xs font-light text-slate-500 hover:text-slate-700"
            >
              Clear
            </Button>
          </>
        )}
      </div>
    );
  }

  // Full card mode
  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] mb-6">
      <CardHeader>
        <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Tenant Selection
        </CardTitle>
        <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
          Select a tenant to view their insights and analytics
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Select
            value={selectedTenantId || '__default__'}
            onValueChange={(value) => {
              if (value === '__default__') {
                onTenantChange(null);
              } else {
                onTenantChange(value);
              }
            }}
            disabled={loading}
          >
            <SelectTrigger className="w-full max-w-md font-light">
              <SelectValue placeholder={loading ? "Loading tenants..." : "Select a tenant..."} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__default__">My Tenant (Default)</SelectItem>
              {tenants && Array.isArray(tenants) && tenants.length > 0 ? (
                tenants.map((tenant) => (
                  <SelectItem key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </SelectItem>
                ))
              ) : (
                !loading && <SelectItem value="__no_tenants__" disabled>No tenants available</SelectItem>
              )}
            </SelectContent>
          </Select>
          {selectedTenantId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onTenantChange(null)}
              className="font-extralight"
            >
              Clear Selection
            </Button>
          )}
        </div>
        {selectedTenantId && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-light">
            ⚠️ You are viewing data for: {tenants.find(t => t.id === selectedTenantId)?.name || 'Selected Tenant'}
          </p>
        )}
      </CardContent>
    </Card>
  );
};
