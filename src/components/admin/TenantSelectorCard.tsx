/**
 * TenantSelectorCard
 *
 * Global tenant selector for platform admins.
 * Shows a dropdown to select which tenant's data to view/manage.
 * Hidden for tenant admins (they're auto-locked to their tenant).
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Loader2, RefreshCw } from "lucide-react";
import { useAdminTenant } from "@/contexts/AdminTenantContext";

interface TenantSelectorCardProps {
  /** Show as compact inline selector instead of full card */
  compact?: boolean;
  /** Show refresh button */
  showRefresh?: boolean;
  /** Additional class name */
  className?: string;
  /** Display variant: 'default' for standard, 'prominent' for larger tenant context mode display */
  variant?: "default" | "prominent";
}

export function TenantSelectorCard({
  compact = false,
  showRefresh = true,
  className = "",
  variant = "default",
}: TenantSelectorCardProps) {
  const {
    selectedTenantId,
    setSelectedTenantId,
    tenants,
    tenantsLoading,
    loadTenants,
    isPlatformAdmin,
    isTenantAdmin,
    currentTenantName,
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
          value={selectedTenantId || "__all__"}
          onValueChange={(value) =>
            setSelectedTenantId(value === "__all__" ? null : value)
          }
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
            <SelectItem value="__all__">All Tenants</SelectItem>
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

  // Prominent version for tenant context mode — compact single-row bar for platform admins
  if (variant === "prominent") {
    return (
      <Card
        className={`border-emerald-200/60 dark:border-emerald-700/50 bg-gradient-to-r from-emerald-50/50 via-white to-teal-50/50 dark:from-emerald-900/10 dark:via-slate-800/50 dark:to-teal-900/10 shadow-sm ${className}`}
      >
        <div className="px-4 py-3 flex flex-wrap items-center gap-3 gap-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300 whitespace-nowrap">
              Tenant
            </span>
          </div>
          <Select
            value={selectedTenantId || "__none__"}
            onValueChange={(value) =>
              setSelectedTenantId(value === "__none__" ? null : value)
            }
            disabled={tenantsLoading}
          >
            <SelectTrigger className="w-full min-w-[180px] max-w-[280px] h-9 text-sm font-normal border-emerald-200 dark:border-emerald-700 focus:ring-emerald-500">
              {tenantsLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Loading...</span>
                </div>
              ) : (
                <SelectValue placeholder="Select tenant..." />
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">
                <span className="text-slate-500">— Select tenant —</span>
              </SelectItem>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  <div className="flex items-center gap-2">
                    <span>{tenant.name}</span>
                    {tenant.status && tenant.status !== "active" && (
                      <Badge variant="outline" className="text-xs">
                        {tenant.status}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {showRefresh && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => loadTenants()}
              disabled={tenantsLoading}
              className="h-8 w-8 p-0 text-slate-500 hover:text-slate-700"
            >
              {tenantsLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {selectedTenantId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelectedTenantId(null)}
              className="h-8 text-xs font-normal whitespace-nowrap border-slate-300 dark:border-slate-600"
            >
              Clear
            </Button>
          )}
          {selectedTenantId && currentTenantName && (
            <span className="text-xs text-emerald-700 dark:text-emerald-300 font-medium truncate max-w-[200px] sm:max-w-none">
              Managing: {currentTenantName}
            </span>
          )}
          {!selectedTenantId && tenants.length > 0 && (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Select a tenant to manage
            </span>
          )}
        </div>
      </Card>
    );
  }

  // Default full card version
  return (
    <Card
      className={`border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] ${className}`}
    >
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
            value={selectedTenantId || "__none__"}
            onValueChange={(value) =>
              setSelectedTenantId(value === "__none__" ? null : value)
            }
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
              <SelectItem value="__none__">
                <span className="text-slate-500">-- Select a tenant --</span>
              </SelectItem>
              {tenants.map((tenant) => (
                <SelectItem key={tenant.id} value={tenant.id}>
                  <div className="flex items-center gap-2">
                    <span>{tenant.name}</span>
                    {tenant.status && tenant.status !== "active" && (
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
