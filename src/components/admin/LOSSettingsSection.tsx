import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Link2, RefreshCw, Play, Plus, Pause, Edit, Globe, CheckCircle2, XCircle, Clock, Network } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

interface LOSSettingsSectionProps {
  losConnections: any[];
  losTypes: any;
  loading: boolean;
  onTest: (connectionId: string) => Promise<any>;
  onSync: (connectionId: string) => Promise<any>;
  onToggle: (connectionId: string, isActive: boolean) => Promise<any>;
  onCreate: (data: any) => Promise<any>;
}

export const LOSSettingsSection = ({
  losConnections,
  losTypes,
  loading,
  onTest,
  onSync,
  onToggle,
  onCreate,
}: LOSSettingsSectionProps) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [newConnectionOpen, setNewConnectionOpen] = useState(false);

  const handleTestConnection = async (connectionId: string) => {
    try {
      await onTest(connectionId);
      toast({
        title: 'Connection Test',
        description: 'Connection test completed successfully.',
      });
    } catch (error) {
      toast({
        title: 'Test Failed',
        description: 'Failed to test connection.',
        variant: 'destructive',
      });
    }
  };

  const handleSyncConnection = async (connectionId: string) => {
    try {
      await onSync(connectionId);
      toast({
        title: 'Sync Started',
        description: 'Connection sync has been initiated.',
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

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                LOS Connections
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                Manage Loan Origination System integrations
              </CardDescription>
            </div>
            <Button 
              size="sm" 
              className="font-extralight"
              onClick={() => setNewConnectionOpen(true)}
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
          ) : losConnections.length === 0 ? (
            <div className="text-center py-8">
              <Link2 className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light mb-2">No LOS connections configured</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light">Create a connection to start syncing loan data</p>
            </div>
          ) : (
            <div className="space-y-4">
              {losConnections && Array.isArray(losConnections) && losConnections.length > 0 ? losConnections.map((connection) => (
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
                          onClick={() => handleSyncConnection(connection.id)}
                          title="Sync Now"
                        >
                          <RefreshCw className="h-4 w-4" />
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
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                          onClick={() => {
                            toast({
                              title: 'Edit Connection',
                              description: 'Use the Settings page to edit LOS connections.',
                            });
                            navigate('/settings');
                          }}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
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
    </motion.div>
  );
};

