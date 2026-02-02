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

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Link2, 
  AlertCircle,
  CheckCircle2,
  Clock,
  Loader2,
  Settings2,
  PlusCircle,
  Database,
  Sparkles
} from 'lucide-react';
import { EncompassFieldMapping } from '@/components/encompass/EncompassFieldMapping';
import { FieldMappingWizardDialog } from '@/components/encompass/FieldMappingWizard';
import { AdditionalFieldsTab } from './AdditionalFieldsTab';
import { FieldPopulationStats } from '@/components/admin/FieldPopulationStats';
import { useToast } from '@/hooks/use-toast';
import { useAdminTenant } from '@/contexts/AdminTenantContext';

interface FieldMappingTabProps {
  losConnections: any[];
  onRefresh: () => void;
}

export function FieldMappingTab({ losConnections, onRefresh }: FieldMappingTabProps) {
  const { toast } = useToast();
  
  // Use admin tenant context for tenant ID
  const { selectedTenantId, isTenantAdmin } = useAdminTenant();
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(
    losConnections.length > 0 ? losConnections[0].id : null
  );
  const [activeSubTab, setActiveSubTab] = useState<'default' | 'additional' | 'population'>('default');
  const [showWizard, setShowWizard] = useState(false);

  // Get the selected connection
  const selectedConnection = losConnections.find(c => c.id === selectedConnectionId);

  // Filter to only show Encompass connections (field mapping is specific to Encompass currently)
  const encompassConnections = losConnections.filter(c => c.los_type === 'encompass');

  const handleMappingChange = () => {
    toast({
      title: 'Success',
      description: 'Field mapping updated successfully',
    });
    onRefresh();
  };

  const getSyncStatusBadge = (connection: any) => {
    if (!connection.last_sync_status) return null;
    
    switch (connection.last_sync_status) {
      case 'success':
        return (
          <Badge variant="outline" className="text-emerald-600 border-emerald-300">
            <CheckCircle2 className="h-3 w-3 mr-1" />
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
                <Button
                  variant="outline"
                  onClick={() => setShowWizard(true)}
                  className="shrink-0"
                >
                  <Sparkles className="h-4 w-4 mr-2" />
                  Setup Wizard
                </Button>
              </div>
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
                    onMappingChange={handleMappingChange}
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
