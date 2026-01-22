import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { api } from '@/lib/api';
import { Loader2, Link2, RefreshCw, Play, Plus, Pause, Edit, Globe, CheckCircle2, XCircle, Clock, Network, Building2, BarChart3, Folder, Trash2, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CreateLOSConnectionDialog } from './CreateLOSConnectionDialog';
import { EncompassFieldMapping } from '@/components/encompass/EncompassFieldMapping';
import { LoanDetailsTable } from './LoanDetailsTable';
import { FieldPopulationStats } from './FieldPopulationStats';

interface LOSSettingsSectionProps {
  losConnections: any[];
  losTypes: any;
  loading: boolean;
  tenants?: Array<{ id: string; name: string }>;
  selectedTenantId?: string | null;
  tenantMetrics?: {
    connections: {
      total_connections: number;
      active_connections: number;
      successful_syncs: number;
      failed_syncs: number;
      in_progress_syncs: number;
      last_sync_time: string | null;
    };
    loans: {
      total_loans: number;
      loans_this_month: number;
      loans_this_year: number;
    };
    users: {
      total_users: number;
    };
  } | null;
  loadingMetrics?: boolean;
  onTest: (connectionId: string, tenantId?: string) => Promise<any>;
  onSync: (connectionId: string, tenantId?: string, clearDatabase?: boolean, testMode?: boolean, limit?: number) => Promise<any>;
  onToggle: (connectionId: string, isActive: boolean) => Promise<any>;
  onCreate: (data: any, tenantId?: string) => Promise<any>;
  onUpdate?: (connectionId: string, updates: any, tenantId?: string) => Promise<any>;
  onDelete?: (connectionId: string, tenantId?: string) => Promise<any>;
  onTenantChange?: (tenantId: string | null) => void;
  onLoadMetrics?: (tenantId: string) => Promise<void>;
}

export const LOSSettingsSection = ({
  losConnections,
  losTypes,
  loading,
  tenants = [],
  selectedTenantId: propSelectedTenantId,
  tenantMetrics,
  loadingMetrics = false,
  onTest,
  onSync,
  onToggle,
  onCreate,
  onUpdate,
  onDelete,
  onTenantChange,
  onLoadMetrics,
}: LOSSettingsSectionProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [newConnectionOpen, setNewConnectionOpen] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState<string | null>(propSelectedTenantId || null);
  const [fieldMappingConnectionId, setFieldMappingConnectionId] = useState<string | null>(null);
  const [folderSelectionConnectionId, setFolderSelectionConnectionId] = useState<string | null>(null);
  const [clearingDatabase, setClearingDatabase] = useState(false);

  // Check URL params for connection and tab
  useEffect(() => {
    const connectionId = searchParams.get('connection');
    const tab = searchParams.get('tab');
    if (connectionId && tab === 'field-mapping') {
      setFieldMappingConnectionId(connectionId);
    } else {
      setFieldMappingConnectionId(null);
    }
  }, [searchParams]);

  // Sync selectedTenantId with prop
  useEffect(() => {
    if (propSelectedTenantId !== undefined) {
      setSelectedTenantId(propSelectedTenantId);
    }
  }, [propSelectedTenantId]);

  const handleTestConnection = async (connectionId: string) => {
    if (!selectedTenantId) {
      toast({
        title: 'Error',
        description: 'Please select a tenant first',
        variant: 'destructive',
      });
      return;
    }
    try {
      await onTest(connectionId, selectedTenantId);
    } catch (error) {
      // Error already handled by onTest callback
    }
  };

  const handleFieldMappingClick = (connectionId: string) => {
    if (!selectedTenantId) {
      toast({
        title: 'Error',
        description: 'Please select a tenant first',
        variant: 'destructive',
      });
      return;
    }
    console.log('Opening field mapping for connection:', connectionId, 'tenant:', selectedTenantId);
    setSearchParams({ section: 'los', connection: connectionId, tab: 'field-mapping' });
    setFieldMappingConnectionId(connectionId);
  };

  const handleCloseFieldMapping = () => {
    setSearchParams({ section: 'los' });
    setFieldMappingConnectionId(null);
  };

  const handleSyncConnection = async (connectionId: string, clearDatabase: boolean = false, testMode: boolean = false) => {
    try {
      if (clearDatabase) {
        // Confirm before clearing database
        const confirmed = window.confirm(
          'This will DELETE ALL LOANS in the database and perform a full sync. This action cannot be undone. Are you sure?'
        );
        if (!confirmed) return;
      }
      await onSync(connectionId, selectedTenantId || undefined, clearDatabase, testMode);
      toast({
        title: 'Sync Started',
        description: clearDatabase 
          ? 'Database cleared and full sync initiated.' 
          : testMode
            ? 'Test sync initiated (limited records).'
            : 'Connection sync has been initiated.',
      });
    } catch (error) {
      toast({
        title: 'Sync Failed',
        description: 'Failed to start sync.',
        variant: 'destructive',
      });
    }
  };

  const handleToggleConnection = async (connectionId: string, isActive: boolean) => {
    try {
      await onToggle(connectionId, !isActive);
      toast({
        title: 'Connection Updated',
        description: `Connection has been ${isActive ? 'deactivated' : 'activated'}.`,
      });
    } catch (error) {
      toast({
        title: 'Update Failed',
        description: 'Failed to update connection status.',
        variant: 'destructive',
      });
    }
  };

  const handleTenantChange = async (tenantId: string) => {
    setSelectedTenantId(tenantId);
    if (onTenantChange) {
      onTenantChange(tenantId);
    }
    if (onLoadMetrics && tenantId) {
      await onLoadMetrics(tenantId);
    }
  };

  const handleClearTenant = () => {
    setSelectedTenantId(null);
    if (onTenantChange) {
      onTenantChange(null);
    }
  };

  const handleClearDatabase = async () => {
    if (!selectedTenantId) {
      toast({
        title: 'Error',
        description: 'Please select a tenant first',
        variant: 'destructive',
      });
      return;
    }
    
    const confirmed = window.confirm(
      '⚠️ WARNING: This will DELETE ALL LOANS from the database for this tenant.\n\n' +
      'This action cannot be undone. You will need to re-sync all data from Encompass.\n\n' +
      'Are you absolutely sure you want to continue?'
    );
    
    if (!confirmed) return;
    
    // Double confirmation for safety
    const doubleConfirmed = window.confirm(
      'FINAL CONFIRMATION\n\n' +
      'You are about to delete ALL loan data. Type "delete" in your mind and click OK to proceed.'
    );
    
    if (!doubleConfirmed) return;
    
    setClearingDatabase(true);
    try {
      const response = await api.request<{ success: boolean; deleted: number; message: string }>(
        `/api/los/clear-loans?tenant_id=${selectedTenantId}`,
        { method: 'DELETE' }
      );
      
      toast({
        title: 'Database Cleared',
        description: response.message || `Deleted ${response.deleted} loans`,
      });
      
      // Refresh metrics
      if (onLoadMetrics && selectedTenantId) {
        await onLoadMetrics(selectedTenantId);
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to clear database',
        variant: 'destructive',
      });
    } finally {
      setClearingDatabase(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Tenant Selector */}
      {tenants && tenants.length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Select Tenant
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Choose a tenant to manage their LOS connections
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Select
                value={selectedTenantId || ''}
                onValueChange={handleTenantChange}
              >
                <SelectTrigger className="w-full max-w-md font-light">
                  <SelectValue placeholder="Select a tenant..." />
                </SelectTrigger>
                <SelectContent>
                  {tenants.map((tenant) => (
                    <SelectItem key={tenant.id} value={tenant.id}>
                      {tenant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTenantId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearTenant}
                  className="font-extralight"
                >
                  Clear Selection
                </Button>
              )}
            </div>
            {selectedTenantId && (
              <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 font-light">
                Managing connections for: {tenants.find(t => t.id === selectedTenantId)?.name || 'Selected Tenant'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tenant Metrics */}
      {selectedTenantId && tenantMetrics && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Tenant Metrics
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 border-red-300 hover:border-red-400 dark:border-red-700 dark:hover:border-red-600"
                onClick={handleClearDatabase}
                disabled={clearingDatabase}
              >
                {clearingDatabase ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Clearing...
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 mr-2" />
                    Clear All Loans
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loadingMetrics ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="text-sm text-slate-500 dark:text-slate-400 font-light mb-1">Connections</div>
                  <div className="text-2xl font-thin text-slate-900 dark:text-white">
                    {tenantMetrics.connections.active_connections} / {tenantMetrics.connections.total_connections}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    {tenantMetrics.connections.successful_syncs} successful, {tenantMetrics.connections.failed_syncs} failed
                  </div>
                </div>
                <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="text-sm text-slate-500 dark:text-slate-400 font-light mb-1">Loans</div>
                  <div className="text-2xl font-thin text-slate-900 dark:text-white">
                    {tenantMetrics.loans.total_loans}
                  </div>
                  <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                    {tenantMetrics.loans.loans_this_month} this month, {tenantMetrics.loans.loans_this_year} this year
                  </div>
                </div>
                <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
                  <div className="text-sm text-slate-500 dark:text-slate-400 font-light mb-1">Users</div>
                  <div className="text-2xl font-thin text-slate-900 dark:text-white">
                    {tenantMetrics.users.total_users}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                LOS Connections
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                {selectedTenantId 
                  ? `Manage Loan Origination System integrations for selected tenant`
                  : 'Select a tenant above to manage their LOS connections'}
              </CardDescription>
            </div>
            {selectedTenantId && (
              <Button 
                size="sm" 
                className="font-extralight"
                onClick={() => setNewConnectionOpen(true)}
              >
                <Plus className="h-4 w-4 mr-2" />
                New Connection
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : !losConnections || !Array.isArray(losConnections) || losConnections.length === 0 ? (
            <div className="text-center py-8">
              <Link2 className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light mb-2">No LOS connections configured</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light">Create a connection to start syncing loan data</p>
            </div>
          ) : (
            <div className="space-y-4">
              {losConnections && Array.isArray(losConnections) && losConnections.length > 0 && (
                losConnections.map((connection) => (
                  <Card key={connection.id} className="border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-3 mb-2">
                            <h3 className="text-base font-extralight text-slate-900 dark:text-white">
                              {connection.name}
                            </h3>
                            <Badge 
                              variant="outline" 
                              className="text-base font-extralight border-slate-300 dark:border-slate-600"
                            >
                              {losTypes[connection.los_type]?.name || connection.los_type}
                            </Badge>
                            {connection.is_active ? (
                              <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                                Active
                              </Badge>
                            ) : (
                              <Badge variant="default" className="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 border-0">
                                Inactive
                              </Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm font-extralight text-slate-600 dark:text-slate-400">
                            <div>
                              <span className="text-slate-500 dark:text-slate-500">Method:</span>
                              <span className="ml-2 capitalize">{connection.connection_method}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 dark:text-slate-500">Environment:</span>
                              <span className="ml-2 capitalize">{connection.api_environment || 'N/A'}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 dark:text-slate-500">Sync:</span>
                              <span className="ml-2 capitalize">{connection.sync_frequency || 'N/A'}</span>
                            </div>
                            <div>
                              <span className="text-slate-500 dark:text-slate-500">Last Sync:</span>
                              <span className="ml-2">
                                {connection.last_synced_at 
                                  ? new Date(connection.last_synced_at).toLocaleDateString()
                                  : 'Never'}
                              </span>
                            </div>
                          </div>
                          {connection.last_sync_status && (
                            <div className="mt-2 flex items-center gap-2">
                              <span className="text-base font-extralight text-slate-500 dark:text-slate-500">Status:</span>
                              {connection.last_sync_status === 'success' ? (
                                <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Success
                                </Badge>
                              ) : connection.last_sync_status === 'error' ? (
                                <Badge variant="default" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Error
                                </Badge>
                              ) : (
                                <Badge variant="default" className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {connection.last_sync_status}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleTestConnection(connection.id)}
                            title="Test Connection"
                          >
                            <Network className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleSyncConnection(connection.id, false, false)}
                            title="Sync Now"
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
                            onClick={() => handleSyncConnection(connection.id, false, true)}
                            title="Test Mode (Limited Records)"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                            onClick={() => handleSyncConnection(connection.id, true, false)}
                            title="Full Sync & Clear Database"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => handleToggleConnection(connection.id, connection.is_active)}
                            title={connection.is_active ? "Deactivate" : "Activate"}
                          >
                            {connection.is_active ? (
                              <Pause className="h-4 w-4" />
                            ) : (
                              <Play className="h-4 w-4" />
                            )}
                          </Button>
                          {connection.los_type === 'encompass' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => setFolderSelectionConnectionId(connection.id)}
                                title="Manage Folders"
                              >
                                <Folder className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleFieldMappingClick(connection.id)}
                                title="Configure Field Mapping"
                              >
                                <Link2 className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                          {onUpdate && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => {
                                // TODO: Open edit dialog
                                toast({
                                  title: 'Edit Connection',
                                  description: 'Edit functionality coming soon. For now, delete and recreate the connection.',
                                });
                              }}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {onDelete && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                              onClick={async () => {
                                if (confirm('Are you sure you want to delete this connection?')) {
                                  try {
                                    await onDelete(connection.id, selectedTenantId || undefined);
                                  } catch (error) {
                                    // Error handled by onDelete
                                  }
                                }
                              }}
                              title="Delete"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Field Population Statistics */}
      {selectedTenantId && losConnections && losConnections.length > 0 && (
        <FieldPopulationStats 
          tenantId={selectedTenantId} 
          losConnectionId={losConnections[0].id}
        />
      )}

      {/* Supported LOS Types */}
      {Object.keys(losTypes).length > 0 && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <CardHeader>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
              Supported LOS Systems
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Available Loan Origination System integrations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(losTypes).map(([key, config]: [string, any]) => (
                <div
                  key={key}
                  className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800/30"
                >
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-base font-extralight text-slate-900 dark:text-white">
                      {config.name || key}
                    </h4>
                    <Badge variant="outline" className="text-base font-extralight border-slate-300 dark:border-slate-600">
                      {config.authType || 'N/A'}
                    </Badge>
                  </div>
                  {config.documentation && (
                    <a
                      href={config.documentation}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 font-light flex items-center gap-1"
                    >
                      <Globe className="h-3 w-3" />
                      Documentation
                    </a>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Connection Dialog */}
      <CreateLOSConnectionDialog
        open={newConnectionOpen}
        onOpenChange={setNewConnectionOpen}
        losTypes={losTypes}
        onCreate={async (data) => {
          const result = await onCreate(data, selectedTenantId || undefined);
          return result; // Return created connection
        }}
        tenantId={selectedTenantId || undefined}
      />

      {/* Folder Selection Dialog */}
      {folderSelectionConnectionId && selectedTenantId && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Manage Loan Folders
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFolderSelectionConnectionId(null)}
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Select which Encompass folders to sync loans from
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FolderSelectionDialog
              connectionId={folderSelectionConnectionId}
              tenantId={selectedTenantId}
              onClose={() => setFolderSelectionConnectionId(null)}
            />
          </CardContent>
        </Card>
      )}

      {/* Field Mapping Dialog/Modal */}
      {fieldMappingConnectionId && selectedTenantId && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)] mt-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Field Mapping
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCloseFieldMapping}
              >
                Close
              </Button>
            </div>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Configure Encompass field ID mappings for this connection
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EncompassFieldMapping
              losConnectionId={fieldMappingConnectionId}
              tenantId={selectedTenantId}
              onMappingChange={() => {
                // Reload connections or show success message
                toast({
                  title: 'Success',
                  description: 'Field mapping updated successfully',
                });
              }}
            />
          </CardContent>
        </Card>
      )}

      {/* Loan Details Table */}
      <LoanDetailsTable tenantId={selectedTenantId} />
    </motion.div>
  );
};

// Folder Selection Component
function FolderSelectionDialog({ 
  connectionId, 
  tenantId, 
  onClose 
}: { 
  connectionId: string; 
  tenantId: string; 
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [availableFolders, setAvailableFolders] = useState<Array<{ folderName: string }>>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingConnection, setLoadingConnection] = useState(true);

  // Load connection data and folders
  useEffect(() => {
    const loadData = async () => {
      setLoadingConnection(true);
      try {
        // Load connection to get current selected folders
        const connectionResponse = await api.request<{ connections: any[] }>(
          `/api/los/connections?tenant_id=${tenantId}`
        );
        const connection = connectionResponse.connections?.find((c: any) => c.id === connectionId);
        if (connection?.encompass_selected_folders) {
          const folders = Array.isArray(connection.encompass_selected_folders) 
            ? connection.encompass_selected_folders 
            : (typeof connection.encompass_selected_folders === 'string' 
                ? JSON.parse(connection.encompass_selected_folders || '[]')
                : []);
          setSelectedFolders(folders);
        }
        
        // Load available folders
        await loadFolders();
      } catch (error: any) {
        console.error('Error loading connection data:', error);
        toast({
          title: 'Error',
          description: 'Failed to load connection data',
          variant: 'destructive',
        });
      } finally {
        setLoadingConnection(false);
      }
    };
    
    loadData();
  }, [connectionId, tenantId, toast]);

  const loadFolders = async () => {
    setLoadingFolders(true);
    try {
      const response = await api.request<{ folders: Array<{ folderName: string }> }>(
        `/api/encompass/folders/${connectionId}?tenant_id=${tenantId}`
      );
      setAvailableFolders(response.folders || []);
    } catch (error: any) {
      console.error('Error loading folders:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load folders',
        variant: 'destructive',
      });
    } finally {
      setLoadingFolders(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.request(`/api/los/connections/${connectionId}?tenant_id=${tenantId}`, {
        method: 'PUT',
        body: JSON.stringify({
          encompass_selected_folders: selectedFolders,
        }),
      });
      toast({
        title: 'Success',
        description: 'Folders saved successfully',
      });
      onClose();
    } catch (error: any) {
      console.error('Error saving folders:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to save folders',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loadingConnection) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-medium text-slate-700 dark:text-slate-300">Loan Folders</h4>
          <p className="text-xs text-slate-500 mt-1">
            Select which Encompass folders to sync loans from
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={loadFolders}
          disabled={loadingFolders}
        >
          {loadingFolders ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading...
            </>
          ) : (
            <>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh Folders
            </>
          )}
        </Button>
      </div>

      {availableFolders.length > 0 ? (
        <div className="space-y-2 max-h-[300px] overflow-y-auto border rounded-md p-3">
          {availableFolders.map((folder) => (
            <div key={folder.folderName} className="flex items-center space-x-2">
              <Checkbox
                id={`folder-${folder.folderName}`}
                checked={selectedFolders.includes(folder.folderName)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    setSelectedFolders([...selectedFolders, folder.folderName]);
                  } else {
                    setSelectedFolders(selectedFolders.filter((f) => f !== folder.folderName));
                  }
                }}
              />
              <Label
                htmlFor={`folder-${folder.folderName}`}
                className="text-sm font-normal cursor-pointer flex-1"
              >
                {folder.folderName}
              </Label>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-sm text-slate-500 text-center py-4 border rounded-md">
          {loadingFolders ? 'Loading folders...' : 'No folders available. Click "Refresh Folders" to load.'}
        </div>
      )}

      {selectedFolders.length > 0 && (
        <div className="text-xs text-slate-600 dark:text-slate-400 p-2 bg-slate-50 dark:bg-slate-800 rounded">
          <strong>Selected ({selectedFolders.length}):</strong> {selectedFolders.join(', ')}
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button variant="outline" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Save Folders
        </Button>
      </div>
    </div>
  );
}
