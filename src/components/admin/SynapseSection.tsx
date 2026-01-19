import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  Zap, 
  RefreshCw, 
  Plus, 
  Link2, 
  Eye, 
  Trash2, 
  CheckCircle2,
  XCircle,
  Clock,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

interface SynapseSectionProps {
  vendorConnections: any[];
  vendorCatalog: any;
  loading: boolean;
  onTest: (connectionId: string) => Promise<any>;
  onCreate: (data: any) => Promise<any>;
  onRefresh: () => Promise<any>;
}

export const SynapseSection = ({
  vendorConnections,
  loading,
  onRefresh,
}: SynapseSectionProps) => {
  const { toast } = useToast();
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [viewingLogsFor, setViewingLogsFor] = useState<string | null>(null);

  const handleTest = async (connectionId: string) => {
    try {
      await api.request(`/api/synapse/connections/${connectionId}/test`, {
        method: 'POST',
      });
      toast({
        title: 'Connection Test',
        description: 'Connection test completed successfully.',
      });
    } catch (error: any) {
      toast({
        title: 'Test Failed',
        description: error.message || 'Failed to test connection.',
        variant: 'destructive',
      });
    }
  };

  const handleSync = async (connectionId: string) => {
    try {
      await api.request(`/api/synapse/connections/${connectionId}/sync`, {
        method: 'POST',
      });
      toast({
        title: 'Sync Started',
        description: 'Reading from LOS-synced loan data and pushing to vendor.',
      });
      await onRefresh();
    } catch (error: any) {
      toast({
        title: 'Sync Failed',
        description: error.message || 'Failed to start synchronization.',
        variant: 'destructive',
      });
    }
  };

  const handleViewLogs = async (connectionId: string) => {
    setViewingLogsFor(connectionId);
    setLoadingLogs(true);
    try {
      const logsData = await api.request<{ logs: any[] }>(`/api/synapse/connections/${connectionId}/logs`);
      // Handle logs display (could show in a modal or separate component)
      toast({
        title: 'Logs Retrieved',
        description: `Found ${logsData.logs?.length || 0} log entries.`,
      });
    } catch (error: any) {
      toast({
        title: 'Failed to Load Logs',
        description: error.message || 'Failed to load sync logs.',
        variant: 'destructive',
      });
    } finally {
      setLoadingLogs(false);
      setViewingLogsFor(null);
    }
  };

  const handleDelete = async (connectionId: string) => {
    if (confirm('Are you sure you want to delete this connection?')) {
      try {
        await api.request(`/api/synapse/connections/${connectionId}`, {
          method: 'DELETE',
        });
        toast({
          title: 'Connection Deleted',
          description: 'Vendor connection has been removed.',
        });
        await onRefresh();
      } catch (error: any) {
        toast({
          title: 'Deletion Failed',
          description: error.message || 'Failed to delete connection.',
          variant: 'destructive',
        });
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Value Proposition Card */}
      <Card className="border-slate-200 dark:border-slate-700 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/40 rounded-lg">
              <Zap className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                Synapse Connect - Universal Connector
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Reuse your LOS-synced loan data for vendor integrations. No redundant API development needed.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">Active Connections</div>
              <div className="text-2xl font-light text-slate-900 dark:text-white">
                {vendorConnections && Array.isArray(vendorConnections) ? vendorConnections.filter(c => c.connection_status === 'active').length : 0}
              </div>
            </div>
            <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">By Category</div>
              <div className="text-base font-extralight text-slate-900 dark:text-white">
                Accounting: {vendorConnections && Array.isArray(vendorConnections) ? vendorConnections.filter(c => c.vendor_category === 'accounting' && c.connection_status === 'active').length : 0} |
                Capital Markets: {vendorConnections && Array.isArray(vendorConnections) ? vendorConnections.filter(c => c.vendor_category === 'capital_markets' && c.connection_status === 'active').length : 0} |
                Servicing: {vendorConnections && Array.isArray(vendorConnections) ? vendorConnections.filter(c => c.vendor_category === 'servicing' && c.connection_status === 'active').length : 0}
              </div>
            </div>
            <div className="p-4 bg-white/60 dark:bg-slate-800/40 rounded-lg border border-slate-200 dark:border-slate-700">
              <div className="text-base font-extralight text-slate-500 dark:text-slate-400 mb-1">Data Source</div>
              <div className="text-base font-extralight text-slate-900 dark:text-white flex items-center gap-2">
                <Link2 className="h-4 w-4" />
                LOS-synced loan data
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Vendor Connections */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Vendor Connections
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Connect to Accounting, Capital Markets, and Servicing vendors using your existing LOS data
              </CardDescription>
            </div>
            <Button
              size="sm"
              className="font-extralight"
              onClick={() => {
                toast({
                  title: 'Create Connection',
                  description: 'Connection creation dialog would open here.',
                });
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Connection
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : vendorConnections.length === 0 ? (
            <div className="text-center py-8">
              <Zap className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light mb-2">No vendor connections configured</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light">Create a connection to start syncing loan data to vendors</p>
            </div>
          ) : (
            <div className="space-y-4">
              {vendorConnections && Array.isArray(vendorConnections) && vendorConnections.length > 0 ? vendorConnections.map((connection) => (
                <Card key={connection.id} className="border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="text-base font-extralight text-slate-900 dark:text-white">
                            {connection.vendor_name}
                          </h4>
                          <Badge 
                            variant="outline" 
                            className={`text-sm font-extralight ${
                              connection.connection_status === 'active' 
                                ? 'border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-300'
                                : connection.connection_status === 'error'
                                ? 'border-red-300 text-red-700 dark:border-red-700 dark:text-red-300'
                                : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400'
                            }`}
                          >
                            {connection.connection_status}
                          </Badge>
                          <Badge variant="outline" className="text-base font-extralight border-slate-300 dark:border-slate-600">
                            {connection.vendor_category?.replace('_', ' ') || connection.vendor_category}
                          </Badge>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-500 font-light space-y-1">
                          <p>Connection Type: {connection.connection_type?.replace('_', ' ') || connection.connection_type}</p>
                          <p>Sync: {connection.sync_enabled ? `${connection.sync_frequency}` : 'Disabled'}</p>
                          {connection.last_synced_at && (
                            <p>Last Sync: {new Date(connection.last_synced_at).toLocaleString()}</p>
                          )}
                          {connection.last_sync_status && (
                            <div className="flex items-center gap-2 mt-1">
                              <span>Status:</span>
                              {connection.last_sync_status === 'success' ? (
                                <Badge variant="default" className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs h-5">
                                  <CheckCircle2 className="h-3 w-3 mr-1" />
                                  Success
                                </Badge>
                              ) : connection.last_sync_status === 'failed' ? (
                                <Badge variant="default" className="bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 border-0 text-xs h-5">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Failed
                                </Badge>
                              ) : (
                                <Badge variant="default" className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0 text-xs h-5">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {connection.last_sync_status}
                                </Badge>
                              )}
                            </div>
                          )}
                          {connection.vendor_api_endpoint && (
                            <p className="truncate max-w-md" title={connection.vendor_api_endpoint}>
                              Endpoint: {connection.vendor_api_endpoint}
                            </p>
                          )}
                          {connection.connection_type === 'vendor_initiated' && connection.vendor_webhook_url && (
                            <p className="truncate max-w-md text-xs" title={connection.vendor_webhook_url}>
                              Webhook: {connection.vendor_webhook_url}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-extralight text-xs"
                          onClick={() => handleTest(connection.id)}
                        >
                          <Eye className="h-3 w-3 mr-1" />
                          Test
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-extralight text-xs"
                          onClick={() => handleSync(connection.id)}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Sync
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-extralight text-xs"
                          onClick={() => handleViewLogs(connection.id)}
                          disabled={loadingLogs && viewingLogsFor === connection.id}
                        >
                          {loadingLogs && viewingLogsFor === connection.id ? (
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                          ) : (
                            <Eye className="h-3 w-3 mr-1" />
                          )}
                          Logs
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="font-extralight text-xs text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                          onClick={() => handleDelete(connection.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
};

