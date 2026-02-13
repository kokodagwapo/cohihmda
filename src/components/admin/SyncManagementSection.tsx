import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  Play,
  Building2,
  Search,
  Filter,
  Database,
} from 'lucide-react';

interface SyncConnection {
  id: string;
  name: string;
  los_type: string;
  connection_method: string;
  sync_enabled: boolean;
  sync_frequency: string;
  last_synced_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  last_loan_modified_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  loan_count: number;
}

interface SchedulerInfo {
  interval_minutes: number;
  next_run_estimate: string;
}

const FREQUENCY_OPTIONS = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily (2 AM)' },
  { value: 'weekly', label: 'Weekly (Mon 2 AM)' },
];

function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getStatusBadge(status: string | null, isActive: boolean) {
  if (!isActive) {
    return (
      <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-600">
        Inactive
      </Badge>
    );
  }
  switch (status) {
    case 'success':
      return (
        <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Success
        </Badge>
      );
    case 'in_progress':
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-0">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Syncing
        </Badge>
      );
    case 'failed':
    case 'error':
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0">
          <XCircle className="h-3 w-3 mr-1" />
          Failed
        </Badge>
      );
    case 'partial':
      return (
        <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Partial
        </Badge>
      );
    case 'interrupted':
      return (
        <Badge className="bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 border-0">
          <AlertTriangle className="h-3 w-3 mr-1" />
          Interrupted
        </Badge>
      );
    case 'pending':
      return (
        <Badge className="bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-400 border-0">
          <Clock className="h-3 w-3 mr-1" />
          Pending
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-slate-500 border-slate-300 dark:border-slate-600">
          {status || 'No sync yet'}
        </Badge>
      );
  }
}

export const SyncManagementSection = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [connections, setConnections] = useState<SyncConnection[]>([]);
  const [scheduler, setScheduler] = useState<SchedulerInfo | null>(null);
  const [totalTenants, setTotalTenants] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTenant, setFilterTenant] = useState<string>('all');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [triggeringIds, setTriggeringIds] = useState<Set<string>>(new Set());

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.request<{
        connections: SyncConnection[];
        scheduler: SchedulerInfo;
        total_tenants: number;
      }>('/api/admin/sync-management');

      setConnections(response.connections);
      setScheduler(response.scheduler);
      setTotalTenants(response.total_tenants);
    } catch (error: any) {
      console.error('Error loading sync management data:', error);
      toast({
        title: 'Error',
        description: 'Failed to load sync management data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleToggleSync = async (connection: SyncConnection) => {
    const newEnabled = !connection.sync_enabled;
    setUpdatingIds(prev => new Set(prev).add(connection.id));

    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          sync_enabled: newEnabled,
        }),
      });

      setConnections(prev =>
        prev.map(c =>
          c.id === connection.id ? { ...c, sync_enabled: newEnabled } : c
        )
      );

      toast({
        title: newEnabled ? 'Auto-sync enabled' : 'Auto-sync disabled',
        description: `${connection.name} (${connection.tenant_name})`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update sync setting',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(connection.id);
        return next;
      });
    }
  };

  const handleFrequencyChange = async (connection: SyncConnection, frequency: string) => {
    setUpdatingIds(prev => new Set(prev).add(connection.id));

    try {
      await api.request(`/api/admin/sync-management/${connection.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
          sync_frequency: frequency,
        }),
      });

      setConnections(prev =>
        prev.map(c =>
          c.id === connection.id ? { ...c, sync_frequency: frequency } : c
        )
      );

      toast({
        title: 'Schedule updated',
        description: `${connection.name} set to ${frequency}`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update schedule',
        variant: 'destructive',
      });
    } finally {
      setUpdatingIds(prev => {
        const next = new Set(prev);
        next.delete(connection.id);
        return next;
      });
    }
  };

  const handleTriggerSync = async (connection: SyncConnection) => {
    setTriggeringIds(prev => new Set(prev).add(connection.id));

    try {
      await api.request(`/api/admin/sync-management/${connection.id}/trigger`, {
        method: 'POST',
        body: JSON.stringify({
          tenant_id: connection.tenant_id,
        }),
      });

      // Update local state to show in_progress
      setConnections(prev =>
        prev.map(c =>
          c.id === connection.id ? { ...c, last_sync_status: 'in_progress' } : c
        )
      );

      toast({
        title: 'Sync triggered',
        description: `Sync started for ${connection.name} (${connection.tenant_name})`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to trigger sync',
        variant: 'destructive',
      });
    } finally {
      setTriggeringIds(prev => {
        const next = new Set(prev);
        next.delete(connection.id);
        return next;
      });
    }
  };

  // Derive unique tenant names for the filter dropdown
  const tenantNames = [...new Set(connections.map(c => c.tenant_name))].sort();

  // Filter connections
  const filteredConnections = connections.filter(c => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      if (
        !c.name.toLowerCase().includes(term) &&
        !c.tenant_name.toLowerCase().includes(term) &&
        !c.los_type.toLowerCase().includes(term)
      ) {
        return false;
      }
    }
    if (filterTenant !== 'all' && c.tenant_name !== filterTenant) return false;
    if (filterStatus === 'enabled' && !c.sync_enabled) return false;
    if (filterStatus === 'disabled' && c.sync_enabled) return false;
    if (filterStatus === 'error' && c.last_sync_status !== 'failed' && c.last_sync_status !== 'error') return false;
    return true;
  });

  // Summary stats
  const stats = {
    total: connections.length,
    autoSyncEnabled: connections.filter(c => c.sync_enabled).length,
    activeConnections: connections.filter(c => c.is_active).length,
    failedSyncs: connections.filter(c => c.last_sync_status === 'failed' || c.last_sync_status === 'error').length,
    totalLoans: connections.reduce((sum, c) => sum + (c.loan_count || 0), 0),
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Section Header */}
      <div className="flex items-center justify-between p-6 rounded-2xl bg-gradient-to-br from-cyan-50 via-white to-blue-50 dark:from-slate-800/50 dark:to-slate-900/50 border border-cyan-200/40 dark:border-slate-700/50 shadow-lg shadow-cyan-500/10">
        <div>
          <h2 className="text-4xl font-thin text-slate-900 dark:text-white tracking-tight mb-2">
            Sync Management
          </h2>
          <p className="text-base text-slate-600 dark:text-slate-400 font-extralight tracking-wide">
            Manage LOS connection sync schedules across all tenants
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={loadData}
          disabled={loading}
          className="font-light"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Tenants</div>
            <div className="text-2xl font-thin text-slate-900 dark:text-white mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : totalTenants}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Connections</div>
            <div className="text-2xl font-thin text-slate-900 dark:text-white mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : `${stats.activeConnections} / ${stats.total}`}
            </div>
            <div className="text-xs text-slate-400 mt-0.5">active / total</div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Auto-Sync On</div>
            <div className="text-2xl font-thin text-emerald-600 dark:text-emerald-400 mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats.autoSyncEnabled}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Failed Syncs</div>
            <div className={`text-2xl font-thin mt-1 ${stats.failedSyncs > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-white'}`}>
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats.failedSyncs}
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4">
            <div className="text-sm text-slate-500 dark:text-slate-400 font-light">Total Loans</div>
            <div className="text-2xl font-thin text-slate-900 dark:text-white mt-1">
              {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : stats.totalLoans.toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Scheduler Info */}
      {scheduler && (
        <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
          <CardContent className="p-4 flex items-center gap-4">
            <Clock className="h-5 w-5 text-slate-400" />
            <div className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Scheduler runs every <span className="font-medium text-slate-900 dark:text-white">{scheduler.interval_minutes} minutes</span>.
              {' '}Connections are synced when overdue based on their configured frequency.
            </div>
          </CardContent>
        </Card>
      )}

      {/* Connections Table */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight flex items-center gap-2">
            <Database className="h-5 w-5" />
            All Connections
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            {filteredConnections.length} connection{filteredConnections.length !== 1 ? 's' : ''} shown
          </CardDescription>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <div className="relative flex-1 min-w-[200px] max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search connections..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 h-9 text-sm font-light"
              />
            </div>
            <Select value={filterTenant} onValueChange={setFilterTenant}>
              <SelectTrigger className="w-[180px] h-9 text-sm font-light">
                <Building2 className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                <SelectValue placeholder="All tenants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Tenants</SelectItem>
                {tenantNames.map(name => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[160px] h-9 text-sm font-light">
                <Filter className="h-3.5 w-3.5 mr-1.5 text-slate-400" />
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="enabled">Auto-Sync On</SelectItem>
                <SelectItem value="disabled">Auto-Sync Off</SelectItem>
                <SelectItem value="error">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredConnections.length === 0 ? (
            <div className="text-center py-12">
              <Database className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
                {connections.length === 0
                  ? 'No LOS connections found across any tenant'
                  : 'No connections match your filters'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="font-light text-xs">Tenant</TableHead>
                    <TableHead className="font-light text-xs">Connection</TableHead>
                    <TableHead className="font-light text-xs">Type</TableHead>
                    <TableHead className="font-light text-xs">Loans</TableHead>
                    <TableHead className="font-light text-xs">Last Sync</TableHead>
                    <TableHead className="font-light text-xs">Status</TableHead>
                    <TableHead className="font-light text-xs">Schedule</TableHead>
                    <TableHead className="font-light text-xs text-center">Auto-Sync</TableHead>
                    <TableHead className="font-light text-xs text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredConnections.map((connection) => (
                    <TableRow key={`${connection.tenant_id}-${connection.id}`} className="group">
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Building2 className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="text-sm font-light text-slate-700 dark:text-slate-300 truncate max-w-[140px]">
                            {connection.tenant_name}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-light text-slate-900 dark:text-white">
                          {connection.name}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs font-light capitalize">
                          {connection.los_type}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-light text-slate-600 dark:text-slate-400">
                          {(connection.loan_count || 0).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-light text-slate-600 dark:text-slate-400" title={connection.last_synced_at || 'Never'}>
                          {formatRelativeTime(connection.last_synced_at)}
                        </div>
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(connection.last_sync_status, connection.is_active)}
                        {connection.last_sync_error && (connection.last_sync_status === 'failed' || connection.last_sync_status === 'error' || connection.last_sync_status === 'interrupted') && (
                          <div className="text-xs text-red-500 dark:text-red-400 mt-1 max-w-[200px] truncate" title={connection.last_sync_error}>
                            {connection.last_sync_error}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={connection.sync_frequency || 'daily'}
                          onValueChange={(val) => handleFrequencyChange(connection, val)}
                          disabled={updatingIds.has(connection.id)}
                        >
                          <SelectTrigger className="w-[130px] h-8 text-xs font-light">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FREQUENCY_OPTIONS.map(opt => (
                              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-center">
                        <Switch
                          checked={connection.sync_enabled}
                          onCheckedChange={() => handleToggleSync(connection)}
                          disabled={updatingIds.has(connection.id) || !connection.is_active}
                          className="data-[state=checked]:bg-emerald-500"
                        />
                      </TableCell>
                      <TableCell className="text-center">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => handleTriggerSync(connection)}
                          disabled={
                            triggeringIds.has(connection.id) ||
                            connection.last_sync_status === 'in_progress' ||
                            !connection.is_active
                          }
                          title="Trigger sync now"
                        >
                          {triggeringIds.has(connection.id) || connection.last_sync_status === 'in_progress' ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Play className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};
