import { useState } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Loader2, 
  Cloud, 
  RefreshCw, 
  Server, 
  Plus, 
  Network,
  AlertCircle,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { api } from '@/lib/api';

interface DeploymentSectionProps {
  deployments: any[];
  syncEvents: any[];
  deploymentsLoading: boolean;
  syncEventsLoading: boolean;
  onProvision: (data: any) => Promise<any>;
  onRegister: (data: any) => Promise<any>;
  onSync: (data: any) => Promise<any>;
  onFailover: (instanceId: string) => Promise<any>;
}

export const DeploymentSection = ({
  deployments,
  syncEvents,
  deploymentsLoading,
  syncEventsLoading,
  onProvision,
  onSync,
  onFailover,
}: DeploymentSectionProps) => {
  const { toast } = useToast();
  
  // Provision Cloud Modal State
  const [provisionModalOpen, setProvisionModalOpen] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [provisionForm, setProvisionForm] = useState({
    instance_name: '',
    cloud_provider: 'aws' as 'aws' | 'azure' | 'gcp',
    cloud_region: '',
  });

  // Register On-Premise Modal State
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registerForm, setRegisterForm] = useState({
    instance_name: '',
    ip_address: '',
    hostname: '',
    version: '',
  });

  // Sync Modal State
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncForm, setSyncForm] = useState({
    target_instance_id: '',
    sync_type: 'incremental' as 'full' | 'incremental' | 'realtime',
  });

  const handleProvision = async () => {
    setProvisioning(true);
    try {
      await onProvision(provisionForm);
      toast({
        title: 'Provisioning Started',
        description: 'Cloud instance is being provisioned. This may take a few minutes.',
      });
      setProvisionModalOpen(false);
      setProvisionForm({ instance_name: '', cloud_provider: 'aws', cloud_region: '' });
    } catch (error: any) {
      toast({
        title: 'Provisioning Failed',
        description: error.message || 'Failed to provision cloud instance.',
        variant: 'destructive',
      });
    } finally {
      setProvisioning(false);
    }
  };

  const handleRegister = async () => {
    setRegistering(true);
    try {
      await api.request('/api/admin/deployments/register', {
        method: 'POST',
        body: JSON.stringify(registerForm),
      });
      toast({
        title: 'Instance Registered',
        description: 'On-premise instance has been registered successfully.',
      });
      setRegisterModalOpen(false);
      setRegisterForm({ instance_name: '', ip_address: '', hostname: '', version: '' });
    } catch (error: any) {
      toast({
        title: 'Registration Failed',
        description: error.message || 'Failed to register on-premise instance.',
        variant: 'destructive',
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleStartSync = async () => {
    setSyncing(true);
    try {
      await onSync(syncForm);
      toast({
        title: 'Sync Started',
        description: 'Data synchronization has been initiated.',
      });
      setSyncModalOpen(false);
      setSyncForm({ target_instance_id: '', sync_type: 'incremental' });
    } catch (error: any) {
      toast({
        title: 'Sync Failed',
        description: error.message || 'Failed to start sync operation.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const handleFailover = async (deploymentId: string) => {
    if (confirm('Are you sure you want to initiate failover to this instance?')) {
      try {
        await onFailover(deploymentId);
        toast({
          title: 'Failover Initiated',
          description: 'Failover process has been started.',
        });
      } catch (error: any) {
        toast({
          title: 'Failover Failed',
          description: error.message || 'Failed to initiate failover.',
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
      {/* Deployment Instances */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Deployment Instances
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Manage cloud and on-premise deployment instances
              </CardDescription>
            </div>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              size="sm"
              className="font-extralight"
              disabled={deploymentsLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${deploymentsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {deploymentsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : deployments.length === 0 ? (
            <div className="text-center py-12">
              <Cloud className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
                No deployment instances found
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light mt-2 mb-4">
                Deploy instances via API or register on-premise installations
              </p>
              <div className="flex gap-2 justify-center">
                <Dialog open={provisionModalOpen} onOpenChange={setProvisionModalOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="font-extralight"
                      onClick={() => setProvisionModalOpen(true)}
                    >
                      <Plus className="h-4 w-4 mr-2" />
                      Provision Cloud
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Provision Cloud Instance</DialogTitle>
                      <DialogDescription>
                        Create a new cloud deployment instance on AWS, Azure, or GCP
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="instance_name">Instance Name</Label>
                        <Input
                          id="instance_name"
                          value={provisionForm.instance_name}
                          onChange={(e) => setProvisionForm({ ...provisionForm, instance_name: e.target.value })}
                          placeholder="e.g., Primary Cloud Instance"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cloud_provider">Cloud Provider</Label>
                        <Select
                          value={provisionForm.cloud_provider}
                          onValueChange={(value: 'aws' | 'azure' | 'gcp') => 
                            setProvisionForm({ ...provisionForm, cloud_provider: value })
                          }
                        >
                          <SelectTrigger id="cloud_provider">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="aws">AWS</SelectItem>
                            <SelectItem value="azure">Azure</SelectItem>
                            <SelectItem value="gcp">Google Cloud Platform</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="cloud_region">Region</Label>
                        <Input
                          id="cloud_region"
                          value={provisionForm.cloud_region}
                          onChange={(e) => setProvisionForm({ ...provisionForm, cloud_region: e.target.value })}
                          placeholder="e.g., us-east-1, eu-west-1, us-west-2"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setProvisionModalOpen(false)}
                        className="font-extralight"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleProvision}
                        disabled={provisioning || !provisionForm.instance_name || !provisionForm.cloud_region}
                        className="font-extralight"
                      >
                        {provisioning ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Provisioning...
                          </>
                        ) : (
                          'Provision Instance'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>

                <Dialog open={registerModalOpen} onOpenChange={setRegisterModalOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      className="font-extralight"
                      onClick={() => setRegisterModalOpen(true)}
                    >
                      <Server className="h-4 w-4 mr-2" />
                      Register On-Premise
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                      <DialogTitle>Register On-Premise Instance</DialogTitle>
                      <DialogDescription>
                        Register an on-premise installation for hybrid deployment
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="register_instance_name">Instance Name</Label>
                        <Input
                          id="register_instance_name"
                          value={registerForm.instance_name}
                          onChange={(e) => setRegisterForm({ ...registerForm, instance_name: e.target.value })}
                          placeholder="e.g., Branch Office Server"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="ip_address">IP Address (Optional)</Label>
                        <Input
                          id="ip_address"
                          value={registerForm.ip_address}
                          onChange={(e) => setRegisterForm({ ...registerForm, ip_address: e.target.value })}
                          placeholder="e.g., 192.168.1.100"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="hostname">Hostname (Optional)</Label>
                        <Input
                          id="hostname"
                          value={registerForm.hostname}
                          onChange={(e) => setRegisterForm({ ...registerForm, hostname: e.target.value })}
                          placeholder="e.g., server.company.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="version">Version (Optional)</Label>
                        <Input
                          id="version"
                          value={registerForm.version}
                          onChange={(e) => setRegisterForm({ ...registerForm, version: e.target.value })}
                          placeholder="e.g., 2.0.1"
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        variant="outline"
                        onClick={() => setRegisterModalOpen(false)}
                        className="font-extralight"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={handleRegister}
                        disabled={registering || !registerForm.instance_name}
                        className="font-extralight"
                      >
                        {registering ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Registering...
                          </>
                        ) : (
                          'Register Instance'
                        )}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {deployments && Array.isArray(deployments) && deployments.length > 0 ? deployments.map((deployment) => (
                <Card key={deployment.id} className="border-slate-200 dark:border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h3 className="text-base font-extralight text-slate-900 dark:text-white">
                            {deployment.instance_name || 'Unnamed Instance'}
                          </h3>
                          <Badge
                            variant="outline"
                            className={
                              deployment.instance_type === 'cloud'
                                ? 'border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300'
                                : 'border-slate-200 text-slate-700 dark:border-slate-700 dark:text-slate-300'
                            }
                          >
                            {deployment.instance_type === 'cloud' ? 'Cloud' : 'On-Premise'}
                          </Badge>
                          {deployment.status === 'active' ? (
                            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0">
                              Active
                            </Badge>
                          ) : (
                            <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0">
                              {deployment.status || 'Unknown'}
                            </Badge>
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 dark:text-slate-400 font-light">
                          {deployment.cloud_provider && (
                            <div>
                              <span className="font-medium">Provider:</span> {deployment.cloud_provider.toUpperCase()}
                            </div>
                          )}
                          {deployment.cloud_region && (
                            <div>
                              <span className="font-medium">Region:</span> {deployment.cloud_region}
                            </div>
                          )}
                          {deployment.hostname && (
                            <div>
                              <span className="font-medium">Hostname:</span> {deployment.hostname}
                            </div>
                          )}
                          {deployment.ip_address && (
                            <div>
                              <span className="font-medium">IP:</span> {deployment.ip_address}
                            </div>
                          )}
                          {deployment.version && (
                            <div>
                              <span className="font-medium">Version:</span> {deployment.version}
                            </div>
                          )}
                          {deployment.created_at && (
                            <div>
                              <span className="font-medium">Created:</span>{' '}
                              {new Date(deployment.created_at).toLocaleDateString()}
                            </div>
                          )}
                          {deployment.last_sync_at && (
                            <div>
                              <span className="font-medium">Last Sync:</span>{' '}
                              {new Date(deployment.last_sync_at).toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {deployment.status === 'active' && deployments.length > 1 && (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              className="font-extralight text-xs"
                              onClick={() => {
                                setSyncForm({ target_instance_id: deployment.id, sync_type: 'incremental' });
                                setSyncModalOpen(true);
                              }}
                            >
                              <Network className="h-3 w-3 mr-1" />
                              Sync
                            </Button>
                            {deployment.instance_type === 'cloud' && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="font-extralight text-xs text-rose-600 hover:text-rose-700"
                                onClick={() => handleFailover(deployment.id)}
                              >
                                <AlertCircle className="h-3 w-3 mr-1" />
                                Failover
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync Management */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Sync Management
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                Start sync operations between instances
              </CardDescription>
            </div>
            <Dialog open={syncModalOpen} onOpenChange={setSyncModalOpen}>
              <DialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="font-extralight"
                  onClick={() => setSyncModalOpen(true)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Start Sync
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                  <DialogTitle>Start Sync Operation</DialogTitle>
                  <DialogDescription>
                    Sync data from primary instance to a target instance
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label htmlFor="sync_target">Target Instance</Label>
                    <Select
                      value={syncForm.target_instance_id}
                      onValueChange={(value) => setSyncForm({ ...syncForm, target_instance_id: value })}
                    >
                      <SelectTrigger id="sync_target">
                        <SelectValue placeholder="Select target instance" />
                      </SelectTrigger>
                      <SelectContent>
                        {deployments && Array.isArray(deployments) ? deployments
                          .filter(d => d && d.status === 'active')
                          .map((deployment) => (
                            <SelectItem key={deployment.id} value={deployment.id}>
                              {deployment.instance_name} ({deployment.instance_type === 'cloud' ? 'Cloud' : 'On-Premise'})
                            </SelectItem>
                          )) : null}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sync_type">Sync Type</Label>
                    <Select
                      value={syncForm.sync_type}
                      onValueChange={(value: 'full' | 'incremental' | 'realtime') =>
                        setSyncForm({ ...syncForm, sync_type: value })
                      }
                    >
                      <SelectTrigger id="sync_type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="full">Full Sync - Complete data synchronization</SelectItem>
                        <SelectItem value="incremental">Incremental Sync - Only changed data</SelectItem>
                        <SelectItem value="realtime">Real-time Sync - Continuous synchronization</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setSyncModalOpen(false)}
                    className="font-extralight"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleStartSync}
                    disabled={syncing || !syncForm.target_instance_id}
                    className="font-extralight"
                  >
                    {syncing ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Starting...
                      </>
                    ) : (
                      'Start Sync'
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
      </Card>

      {/* Sync Events History */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
                Sync Events History
              </CardTitle>
              <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light mt-1">
                History of sync operations between instances
              </CardDescription>
            </div>
            <Button
              onClick={() => window.location.reload()}
              variant="outline"
              size="sm"
              className="font-extralight"
              disabled={syncEventsLoading}
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${syncEventsLoading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {syncEventsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : syncEvents.length === 0 ? (
            <div className="text-center py-12">
              <Network className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" />
              <p className="text-sm text-slate-500 dark:text-slate-400 font-light">
                No sync events found
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-500 font-light mt-2">
                Sync events will appear here after sync operations are started
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {syncEvents && Array.isArray(syncEvents) && syncEvents.length > 0 ? syncEvents.map((event) => (
                <Card key={event.id} className="border-slate-200 dark:border-slate-700">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge
                            variant="outline"
                            className={
                              event.status === 'completed'
                                ? 'border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300'
                                : event.status === 'failed'
                                ? 'border-rose-200 text-rose-700 dark:border-rose-800 dark:text-rose-300'
                                : 'border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300'
                            }
                          >
                            {event.sync_type || 'incremental'}
                          </Badge>
                          <Badge
                            className={
                              event.status === 'completed'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0'
                                : event.status === 'failed'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 border-0'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 border-0'
                            }
                          >
                            {event.status || 'pending'}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-xs text-slate-500 dark:text-slate-400 font-light">
                          {event.records_synced !== null && event.records_synced !== undefined && (
                            <div>
                              <span className="font-medium">Records:</span> {event.records_synced}
                            </div>
                          )}
                          {event.started_at && (
                            <div>
                              <span className="font-medium">Started:</span>{' '}
                              {new Date(event.started_at).toLocaleString()}
                            </div>
                          )}
                          {event.completed_at && (
                            <div>
                              <span className="font-medium">Completed:</span>{' '}
                              {new Date(event.completed_at).toLocaleString()}
                            </div>
                          )}
                          {event.error_message && (
                            <div className="col-span-2">
                              <span className="font-medium text-rose-600">Error:</span>{' '}
                              <span className="text-rose-600">{event.error_message}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deployment Options */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <CardTitle className="text-lg font-thin text-slate-900 dark:text-white tracking-tight">
            Deployment Options
          </CardTitle>
          <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
            Available deployment methods and configurations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-start gap-3">
              <Cloud className="h-5 w-5 text-blue-500 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-base font-extralight text-slate-900 dark:text-white mb-1">Cloud Deployment</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Deploy on AWS, Azure, or GCP. Managed infrastructure with automatic scaling.
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-start gap-3">
              <Server className="h-5 w-5 text-slate-500 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-base font-extralight text-slate-900 dark:text-white mb-1">On-Premise Deployment</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Install on your own infrastructure. Full control with hybrid sync support.
                </p>
              </div>
            </div>
          </div>
          <div className="p-4 border border-slate-200 dark:border-slate-700 rounded-lg">
            <div className="flex items-start gap-3">
              <Network className="h-5 w-5 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <h4 className="text-base font-extralight text-slate-900 dark:text-white mb-1">Hybrid Deployment</h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 font-light">
                  Combine cloud and on-premise instances with real-time data synchronization.
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
