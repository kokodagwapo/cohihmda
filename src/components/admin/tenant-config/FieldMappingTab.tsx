/**
 * Field Mapping Tab
 * Wrapper for Encompass field mapping functionality
 * Allows tenant admins to configure which LOS fields map to Coheus aliases
 * 
 * Sub-tabs:
 * - Default Fields: Standard Coheus field mappings
 * - Additional Fields: Client-defined custom fields that add columns to loans table
 * - Population Stats: Data completeness metrics for all loan fields
 */

import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { 
  Link2, 
  AlertCircle,
  Clock,
  Loader2,
  Settings2,
  PlusCircle,
  Database,
  Sparkles,
  Zap,
  Save,
  RefreshCw,
  CheckCircle2 as CheckIcon,
  AlertTriangle as AlertIcon,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { EncompassFieldMapping } from '@/components/encompass/EncompassFieldMapping';
import { FieldMappingWizardDialog } from '@/components/encompass/FieldMappingWizard';
import { AdditionalFieldsTab } from './AdditionalFieldsTab';
import { FieldPopulationStats } from '@/components/admin/FieldPopulationStats';
import { OnboardingPanel } from '@/components/onboarding/OnboardingPanel';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';
import { api } from '@/lib/api';

interface FieldMappingTabProps {
  losConnections: any[];
  onRefresh: () => void;
}

interface WebhookConfig {
  id: string;
  webhook_enabled: boolean;
  webhook_mode: 'priority_only' | 'all_changes';
  webhook_priority_field_ids: string[] | null;
  webhook_priority_field_limit: number | null;
  webhook_reconciliation_enabled: boolean;
}

interface WebhookStatsResponse {
  queue: Array<{ status: string; count: number }>;
  events24h: Array<{ status: string; count: number }>;
}

export function FieldMappingTab({ losConnections, onRefresh }: FieldMappingTabProps) {
  const { toast } = useToast();
  
  // Use admin tenant context for tenant ID and platform-admin check
  const { selectedTenantId, isTenantAdmin, isPlatformAdmin } = useAdminTenant();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    losConnections.length > 0 ? losConnections[0].id : null
  );
  const [activeSubTab, setActiveSubTab] = useState<'default' | 'additional' | 'population'>('default');
  const [showWizard, setShowWizard] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [webhookConfig, setWebhookConfig] = useState<WebhookConfig | null>(null);
  const [webhookFieldText, setWebhookFieldText] = useState('');
  const [loadingWebhookConfig, setLoadingWebhookConfig] = useState(false);
  const [savingWebhookConfig, setSavingWebhookConfig] = useState(false);
  const [webhookStats, setWebhookStats] = useState<WebhookStatsResponse | null>(null);
  const [loadingWebhookStats, setLoadingWebhookStats] = useState(false);
  const [webhookSectionOpen, setWebhookSectionOpen] = useState(false);
  const [reconciling, setReconciling] = useState(false);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessResult, setReadinessResult] = useState<any | null>(null);

  // Get the selected connection
  const selectedConnection = losConnections.find(c => c.id === selectedConnectionId);

  // Filter to only show Encompass connections (field mapping is specific to Encompass currently)
  const encompassConnections = losConnections.filter(c => c.los_type === 'encompass');

  useEffect(() => {
    if (encompassConnections.length === 0) {
      setSelectedConnectionId(null);
      return;
    }
    const hasSelectedEncompass = encompassConnections.some(c => c.id === selectedConnectionId);
    if (!hasSelectedEncompass) {
      setSelectedConnectionId(encompassConnections[0].id);
    }
  }, [encompassConnections, selectedConnectionId]);

  const tenantQuery = selectedTenantId ? `?tenant_id=${encodeURIComponent(selectedTenantId)}` : '';

  const loadWebhookConfig = useCallback(async () => {
    if (!selectedConnectionId) return;
    setLoadingWebhookConfig(true);
    try {
      const response = await api.request<WebhookConfig>(
        `/api/encompass/webhook-config/${selectedConnectionId}${tenantQuery}`
      );
      setWebhookConfig(response);
      const ids = Array.isArray(response.webhook_priority_field_ids)
        ? response.webhook_priority_field_ids
        : [];
      setWebhookFieldText(ids.join(', '));
    } catch (error: any) {
      setWebhookConfig(null);
      setWebhookFieldText('');
      toast({
        title: 'Webhook Config Unavailable',
        description: error.message || 'Failed to load webhook config',
        variant: 'destructive',
      });
    } finally {
      setLoadingWebhookConfig(false);
    }
  }, [selectedConnectionId, tenantQuery, toast]);

  const loadWebhookStats = useCallback(async () => {
    if (!selectedConnectionId) return;
    setLoadingWebhookStats(true);
    try {
      const response = await api.request<WebhookStatsResponse>(
        `/api/encompass/webhook-stats/${selectedConnectionId}${tenantQuery}`
      );
      setWebhookStats(response);
    } catch (error: any) {
      toast({
        title: 'Stats Unavailable',
        description: error.message || 'Failed to load webhook stats',
        variant: 'destructive',
      });
    } finally {
      setLoadingWebhookStats(false);
    }
  }, [selectedConnectionId, tenantQuery, toast]);

  useEffect(() => {
    if (!selectedConnectionId || !selectedTenantId) {
      setWebhookConfig(null);
      setWebhookStats(null);
      return;
    }
    loadWebhookConfig();
    loadWebhookStats();
  }, [selectedConnectionId, selectedTenantId, loadWebhookConfig, loadWebhookStats]);

  const handleSaveWebhookConfig = async () => {
    if (!selectedConnectionId || !webhookConfig) return;
    const ids = webhookFieldText
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    setSavingWebhookConfig(true);
    try {
      const payload = {
        webhook_enabled: webhookConfig.webhook_enabled,
        webhook_mode: webhookConfig.webhook_mode,
        webhook_priority_field_limit: webhookConfig.webhook_priority_field_limit || 20,
        webhook_reconciliation_enabled: webhookConfig.webhook_reconciliation_enabled,
        webhook_priority_field_ids: ids,
      };
      const response = await api.request<{ success: boolean; config: WebhookConfig }>(
        `/api/encompass/webhook-config/${selectedConnectionId}${tenantQuery}`,
        {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }
      );
      setWebhookConfig(response.config);
      toast({
        title: 'Saved',
        description: 'Webhook priority field configuration updated.',
      });
      await loadWebhookStats();
    } catch (error: any) {
      toast({
        title: 'Save Failed',
        description: error.message || 'Failed to save webhook config',
        variant: 'destructive',
      });
    } finally {
      setSavingWebhookConfig(false);
    }
  };

  const handleRunReconciliation = async () => {
    if (!selectedConnectionId) return;
    setReconciling(true);
    try {
      await api.request(`/api/encompass/reconcile/${selectedConnectionId}${tenantQuery}`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      toast({
        title: 'Reconciliation Started',
        description: 'Incremental reconciliation completed for this connection.',
      });
      await loadWebhookStats();
    } catch (error: any) {
      toast({
        title: 'Reconciliation Failed',
        description: error.message || 'Failed to run reconciliation',
        variant: 'destructive',
      });
    } finally {
      setReconciling(false);
    }
  };

  const handleRunReadiness = async () => {
    if (!selectedConnectionId) return;
    setReadinessLoading(true);
    try {
      const result = await api.request<any>(
        `/api/encompass/v3-readiness/${selectedConnectionId}${tenantQuery}`
      );
      setReadinessResult(result);
      const hasErrors = result?.errors && Object.keys(result.errors).length > 0;
      toast({
        title: hasErrors ? 'V3 Readiness (Partial)' : 'V3 Readiness Passed',
        description: hasErrors
          ? `Some checks failed: ${Object.entries(result.errors).map(([k, v]) => `${k}: ${v}`).join('; ')}`
          : `Fields ${result?.readiness?.fields ?? 0}, Loans ${result?.readiness?.sampleLoans ?? 0}, Users ${result?.readiness?.users ?? 0}`,
        ...(hasErrors ? { variant: 'destructive' as const } : {}),
      });
    } catch (error: any) {
      setReadinessResult(null);
      toast({
        title: 'V3 Readiness Failed',
        description: error.message || 'Readiness check failed',
        variant: 'destructive',
      });
    } finally {
      setReadinessLoading(false);
    }
  };

  const getSyncStatusBadge = (connection: any) => {
    if (!connection.last_sync_status) return null;
    
    switch (connection.last_sync_status) {
      case 'success':
        return (
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            <CheckIcon className="h-3 w-3 mr-1" />
            Synced
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="outline" className="text-red-600 border-red-300">
            <AlertCircle className="h-3 w-3 mr-1" />
            Error
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-amber-600 border-amber-300">
            <Clock className="h-3 w-3 mr-1" />
            {connection.last_sync_status}
          </Badge>
        );
    }
  };

  return (
    <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg font-thin text-slate-900 dark:text-white flex items-center gap-2">
              <Link2 className="h-5 w-5" />
              Field Mapping
            </CardTitle>
            <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
              Configure how LOS fields map to Coheus data fields
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Connection Selector (if multiple connections) */}
        {encompassConnections.length === 0 ? (
          <div className="text-center py-12">
            <Link2 className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-4" strokeWidth={1.5} />
            <p className="text-sm text-slate-500 dark:text-slate-400 font-light mb-2">
              No LOS connections configured
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 font-light">
              {isTenantAdmin 
                ? 'Please contact your administrator to set up a LOS connection'
                : 'Create a LOS connection in the LOS Settings section first'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Connection Selector */}
            {encompassConnections.length > 1 && (
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  LOS Connection:
                </label>
                <Select
                  value={selectedConnectionId || ''}
                  onValueChange={setSelectedConnectionId}
                >
                  <SelectTrigger className="w-[300px] font-light">
                    <SelectValue placeholder="Select connection" />
                  </SelectTrigger>
                  <SelectContent>
                    {encompassConnections.map((conn) => (
                      <SelectItem key={conn.id} value={conn.id}>
                        <div className="flex items-center gap-2">
                          {conn.name}
                          {conn.is_active ? (
                            <Badge variant="secondary" className="text-xs">Active</Badge>
                          ) : (
                            <Badge variant="outline" className="text-xs text-slate-400">Inactive</Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Connection Info */}
            {selectedConnection && (
              <div className="flex items-center gap-4 p-4 bg-slate-50 dark:bg-slate-800/30 rounded-lg">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="font-medium text-slate-900 dark:text-white">
                      {selectedConnection.name}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {selectedConnection.los_type}
                    </Badge>
                    {selectedConnection.is_active ? (
                      <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-0 text-xs">
                        Active
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Inactive</Badge>
                    )}
                    {getSyncStatusBadge(selectedConnection)}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Last synced: {selectedConnection.last_synced_at 
                      ? new Date(selectedConnection.last_synced_at).toLocaleString()
                      : 'Never'}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    onClick={() => setShowOnboarding(true)}
                  >
                    <Zap className="h-4 w-4 mr-2" />
                    Run Onboarding Analysis
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setShowWizard(true)}
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Setup Wizard
                  </Button>
                </div>
              </div>
            )}

            {/* Webhook Priority Field Configuration — platform admin only, collapsed by default */}
            {isPlatformAdmin && selectedConnection && selectedConnection.los_type === 'encompass' && (
              <Collapsible open={webhookSectionOpen} onOpenChange={setWebhookSectionOpen}>
                <div className="p-4 border rounded-lg bg-slate-50/60 dark:bg-slate-900/20 space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <CollapsibleTrigger className="flex items-center gap-2 text-left hover:opacity-80">
                      {webhookSectionOpen ? (
                        <ChevronDown className="h-4 w-4 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-slate-500 shrink-0" />
                      )}
                      <div>
                        <h4 className="text-sm font-medium text-slate-900 dark:text-white">
                          Webhook Priority Field Configuration
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Configure high-value fieldchange subscriptions (platform admin only).
                        </p>
                      </div>
                    </CollapsibleTrigger>
                    {webhookSectionOpen && (
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={loadWebhookStats}
                          disabled={loadingWebhookStats}
                        >
                          <RefreshCw className={`h-4 w-4 mr-2 ${loadingWebhookStats ? 'animate-spin' : ''}`} />
                          Refresh Stats
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleRunReadiness}
                          disabled={readinessLoading}
                        >
                          {readinessLoading ? (
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          ) : (
                            <CheckIcon className="h-4 w-4 mr-2" />
                          )}
                          V3 Readiness
                        </Button>
                      </div>
                    )}
                  </div>

                  <CollapsibleContent>
                {loadingWebhookConfig ? (
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading webhook configuration...
                  </div>
                ) : webhookConfig ? (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">Webhook Enabled</label>
                        <Select
                          value={webhookConfig.webhook_enabled ? 'enabled' : 'disabled'}
                          onValueChange={(value) =>
                            setWebhookConfig({
                              ...webhookConfig,
                              webhook_enabled: value === 'enabled',
                            })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="enabled">Enabled</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">Webhook Mode</label>
                        <Select
                          value={webhookConfig.webhook_mode}
                          onValueChange={(value) =>
                            setWebhookConfig({
                              ...webhookConfig,
                              webhook_mode: value as 'priority_only' | 'all_changes',
                            })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="priority_only">Priority Only</SelectItem>
                            <SelectItem value="all_changes">All Changes</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">Priority Field Limit (1-50)</label>
                        <Input
                          className="mt-1"
                          type="number"
                          min={1}
                          max={50}
                          value={webhookConfig.webhook_priority_field_limit || 20}
                          onChange={(e) =>
                            setWebhookConfig({
                              ...webhookConfig,
                              webhook_priority_field_limit: Number(e.target.value || 20),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-600 dark:text-slate-400">Reconciliation</label>
                        <Select
                          value={webhookConfig.webhook_reconciliation_enabled ? 'enabled' : 'disabled'}
                          onValueChange={(value) =>
                            setWebhookConfig({
                              ...webhookConfig,
                              webhook_reconciliation_enabled: value === 'enabled',
                            })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="enabled">Enabled</SelectItem>
                            <SelectItem value="disabled">Disabled</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-600 dark:text-slate-400">
                        Priority Field IDs (comma-separated)
                      </label>
                      <Input
                        className="mt-1"
                        value={webhookFieldText}
                        onChange={(e) => setWebhookFieldText(e.target.value)}
                        placeholder="2, 3, 4, 19, 364, 748, 761..."
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Used for `fieldchange` acceleration. Non-priority fields are still covered by reconciliation polling.
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button onClick={handleSaveWebhookConfig} disabled={savingWebhookConfig}>
                        {savingWebhookConfig ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <Save className="h-4 w-4 mr-2" />
                        )}
                        Save Webhook Config
                      </Button>
                      <Button variant="outline" onClick={handleRunReconciliation} disabled={reconciling}>
                        {reconciling ? (
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4 mr-2" />
                        )}
                        Run Reconciliation
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 rounded border bg-white dark:bg-slate-900">
                        <p className="text-xs text-slate-500 mb-2">Queue Status</p>
                        {webhookStats?.queue?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {webhookStats.queue.map((row) => (
                              <Badge key={row.status} variant="outline">
                                {row.status}: {row.count}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">No queue data yet</p>
                        )}
                      </div>
                      <div className="p-3 rounded border bg-white dark:bg-slate-900">
                        <p className="text-xs text-slate-500 mb-2">Events (last 24h)</p>
                        {webhookStats?.events24h?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {webhookStats.events24h.map((row) => (
                              <Badge key={row.status} variant="outline">
                                {row.status}: {row.count}
                              </Badge>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-slate-400">No event data yet</p>
                        )}
                      </div>
                    </div>

                    {readinessResult && (
                      <div className={`p-3 rounded border ${readinessResult.success ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'}`}>
                        <div className="flex items-center gap-2">
                          {readinessResult.success ? (
                            <CheckIcon className="h-4 w-4 text-emerald-600" />
                          ) : (
                            <AlertIcon className="h-4 w-4 text-amber-600" />
                          )}
                          <span className={`text-sm font-medium ${readinessResult.success ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
                            V3 readiness check {readinessResult.success ? 'passed' : 'partial'}
                          </span>
                          <span className="text-xs text-slate-500">{readinessResult.elapsedMs}ms</span>
                        </div>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          Fields: {readinessResult?.readiness?.fields ?? 0}, Custom Fields: {readinessResult?.readiness?.customFields ?? 0}, Users: {readinessResult?.readiness?.users ?? 0}, Sample Loans: {readinessResult?.readiness?.sampleLoans ?? 0}, Folders: {readinessResult?.readiness?.folders ?? 0}.
                        </p>
                        {readinessResult.errors && Object.keys(readinessResult.errors).length > 0 && (
                          <div className="mt-2 space-y-1">
                            {Object.entries(readinessResult.errors).map(([key, msg]) => (
                              <p key={key} className="text-xs text-red-600 dark:text-red-400">
                                {key}: {String(msg)}
                              </p>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
                    <AlertIcon className="h-4 w-4" />
                    Webhook config not available for this connection.
                  </div>
                )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            )}

            {/* Onboarding Analysis Panel */}
            {showOnboarding && selectedConnectionId && selectedTenantId && (
              <OnboardingPanel
                connectionId={selectedConnectionId}
                tenantId={selectedTenantId}
                connectionName={selectedConnection?.name}
                onComplete={() => {
                  setShowOnboarding(false);
                  onRefresh();
                  toast({
                    title: 'Onboarding Complete',
                    description: 'Configuration has been applied. Review your field mappings below.',
                  });
                }}
              />
            )}

            {/* Sub-tabs for Default Fields, Additional Fields, and Population Stats */}
            {selectedConnectionId && selectedTenantId && (
              <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as 'default' | 'additional' | 'population')} className="w-full">
                <TabsList className="grid w-full grid-cols-3 mb-6">
                  <TabsTrigger value="default" className="flex items-center gap-2">
                    <Settings2 className="h-4 w-4" />
                    Default Fields
                  </TabsTrigger>
                  <TabsTrigger value="additional" className="flex items-center gap-2">
                    <PlusCircle className="h-4 w-4" />
                    Additional Fields
                  </TabsTrigger>
                  <TabsTrigger value="population" className="flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    Population Stats
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="default" className="mt-0">
                  <EncompassFieldMapping
                    losConnectionId={selectedConnectionId}
                    tenantId={selectedTenantId}
                  />
                </TabsContent>

                <TabsContent value="additional" className="mt-0">
                  <AdditionalFieldsTab
                    losConnectionId={selectedConnectionId}
                    tenantId={selectedTenantId}
                    onRefresh={onRefresh}
                  />
                </TabsContent>

                <TabsContent value="population" className="mt-0">
                  <FieldPopulationStats
                    tenantId={selectedTenantId}
                    losConnectionId={selectedConnectionId}
                  />
                </TabsContent>
              </Tabs>
            )}
          </div>
        )}

        {/* Field Mapping Wizard Dialog */}
        {selectedConnectionId && selectedTenantId && (
          <FieldMappingWizardDialog
            open={showWizard}
            onOpenChange={setShowWizard}
            losConnectionId={selectedConnectionId}
            tenantId={selectedTenantId}
            connectionName={selectedConnection?.name}
            onComplete={() => {
              setShowWizard(false);
              onRefresh();
              toast({
                title: 'Wizard Complete',
                description: 'Field mappings have been configured',
              });
            }}
            onCancel={() => setShowWizard(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}
