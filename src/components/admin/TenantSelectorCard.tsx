/**
 * TenantSelectorCard
 * 
 * Global tenant selector for platform admins.
 * Shows a dropdown to select which tenant's data to view/manage.
 * Hidden for tenant admins (they're auto-locked to their tenant).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Building2, Loader2, RefreshCw } from 'lucide-react';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

interface TenantSelectorCardProps {
  /** Show as compact inline selector instead of full card */
  compact?: boolean;
  /** Show refresh button */
  showRefresh?: boolean;
  /** Additional class name */
  className?: string;
}

export function TenantSelectorCard({ 
  compact = false, 
  showRefresh = true,
  className = '' 
}: TenantSelectorCardProps) {
  const { 
    selectedTenantId, 
    setSelectedTenantId, 
    tenants, 
    tenantsLoading,
    loadTenants,
    isPlatformAdmin,
    isTenantAdmin,
    currentTenantName 
  } = useAdminTenant();
  
  // Don't render for tenant admins - they're locked to their tenant
  if (isTenantAdmin) {
    return null;
  }
  
  // Don't render if not a platform admin
  if (!isPlatformAdmin) {
    return null;
  }
  
  // Compact inline version
  if (compact) {
    return (
      <div className={`flex items-center gap-2 ${className}`}>
        <Building2 className="h-4 w-4 text-slate-400" />
        <Select
          value={selectedTenantId || ''}
          onValueChange={(value) => setSelectedTenantId(value || null)}
          disabled={tenantsLoading}
        >
          <SelectTrigger className="w-[200px] font-light">
            {tenantsLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SelectValue placeholder="Select tenant..." />
            )}
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Tenants</SelectItem>
            {tenants.map((tenant) => (
              <SelectItem key={tenant.id} value={tenant.id}>
                {tenant.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedTenantId && currentTenantName && (
          <Badge variant="secondary" className="font-light text-xs">
            {currentTenantName}
          </Badge>
        )}
      </div>
    );
  }
  
  // Full card version
  return (
    <Card className={`border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${className}`}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-500" />
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Select Tenant
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Choose a tenant to manage their data and settings
              </CardDescription>
            </div>
          </div>
          {showRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadTenants()}
              disabled={tenantsLoading}
              className="h-8 w-8 p-0"
            >
              {tenantsLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <Select
            value={selectedTenantId || ''}
            onValueChange={(value) => setSelectedTenantId(value || null)}
            disabled={tenantsLoading}
          >
            <SelectTrigger className="w-full max-w-md font-light">
              {tenantsLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Loading tenants...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select a tenant..." />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">
                <span className="text-slate-500">-- Select a tenant --</span>
              </SelectItem>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  <div className="flex items-center gap-2">
                    <span>{tenant.name}</span>
                    {tenant.status && tenant.status !== 'active' && (
                      <Badge variant="outline" className="text-xs">
                        {tenant.status}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {selectedTenantId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedTenantId(null)}
              className="font-extralight whitespace-nowrap"
            >
              Clear Selection
            </Button>
          )}
        </div>
        
        {selectedTenantId && currentTenantName && (
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-light">
            Managing: {currentTenantName}
          </p>
        )}
        
        {!selectedTenantId && tenants.length > 0 && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 font-light">
            Select a tenant above to view and manage their data
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default TenantSelectorCard;
