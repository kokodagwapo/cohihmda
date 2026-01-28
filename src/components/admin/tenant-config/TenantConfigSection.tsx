/**
 * Tenant Configuration Section
 * Self-service mapping tool for lender admins
 * Manages field mappings, range rules, filters, and scoring weights
 * Note: Personas/user profiles are managed in Roles & Permissions section
 */

import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { 
  Database, 
  Ruler, 
  Filter, 
  BarChart3, 
  Loader2,
  RefreshCw,
  Settings2,
  Link2
} from 'lucide-react';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useAdminTenant } from '@/contexts/AdminTenantContext';
import { FieldDictionaryTab } from './FieldDictionaryTab';
import { FieldMappingTab } from './FieldMappingTab';
import { RangeRulesTab } from './RangeRulesTab';
import { FilterBuilderTab } from './FilterBuilderTab';
import { ScoringWeightsTab } from './ScoringWeightsTab';

export function TenantConfigSection() {
  const { toast } = useToast();
  const { user } = useAuth();
  
  // Use admin tenant context
  const { selectedTenantId, isTenantAdmin, currentTenantName } = useAdminTenant();
  const [activeTab, setActiveTab] = useState('mapping');
  const [loading, setLoading] = useState(false);
  
  // Data states
  const [customFields, setCustomFields] = useState<any[]>([]);
  const [rangeRules, setRangeRules] = useState<any[]>([]);
  const [filters, setFilters] = useState<any[]>([]);
  const [scoringWeights, setScoringWeights] = useState<Record<string, any[]>>({});
  const [complexityComponents, setComplexityComponents] = useState<Record<string, any[]>>({});
  const [losConnections, setLosConnections] = useState<any[]>([]);

  // Load all data
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [fieldsRes, rulesRes, filtersRes, salesWeightsRes, opsWeightsRes, complexityRes, losRes] = await Promise.all([
        api.request<{ fields: any[] }>('/api/tenant-config/fields'),
        api.request<{ rules: any[] }>('/api/tenant-config/range-rules'),
        api.request<{ filters: any[] }>('/api/tenant-config/filters'),
        api.request<{ weights: Record<string, any[]> }>('/api/tenant-config/scoring-weights/sales'),
        api.request<{ weights: Record<string, any[]> }>('/api/tenant-config/scoring-weights/operations'),
        api.request<{ components: Record<string, any[]> }>('/api/tenant-config/complexity'),
        api.request<{ connections: any[] }>('/api/los/connections'),
      ]);
      
      setCustomFields(fieldsRes.fields || []);
      setRangeRules(rulesRes.rules || []);
      setFilters(filtersRes.filters || []);
      setScoringWeights({
        sales: salesWeightsRes.weights?.default || [],
        operations: opsWeightsRes.weights?.default || [],
      });
      setComplexityComponents(complexityRes.components || {});
      setLosConnections(losRes.connections || []);
    } catch (error: any) {
      console.error('Error loading tenant config:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to load configuration data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const tabs = [
    { id: 'mapping', label: 'Field Mapping', icon: Link2, count: null },
    { id: 'fields', label: 'Custom Fields', icon: Database, count: customFields.length },
    { id: 'ranges', label: 'Range Rules', icon: Ruler, count: rangeRules.length },
    { id: 'filters', label: 'Saved Filters', icon: Filter, count: filters.length },
    { id: 'scoring', label: 'Scoring Weights', icon: BarChart3, count: null },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="space-y-6"
    >
      {/* Header */}
      <Card className="border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Settings2 className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              <div>
                <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                  Data Configuration
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  {isTenantAdmin 
                    ? 'Manage field mappings, guideline rules, filters, and scoring for your organization'
                    : 'Configure tenant data mappings, rules, and scoring weights'}
                </CardDescription>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              disabled={loading}
              className="font-light"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-5 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.id}
              value={tab.id}
              className="flex items-center gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-slate-700 font-light"
            >
              <tab.icon className="h-4 w-4" />
              <span className="hidden sm:inline">{tab.label}</span>
              {tab.count !== null && tab.count > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {tab.count}
                </Badge>
              )}
            </TabsTrigger>
          ))}
        </TabsList>

        {loading ? (
          <Card className="border-slate-200 dark:border-slate-700">
            <CardContent className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </CardContent>
          </Card>
        ) : (
          <>
            <TabsContent value="mapping">
              <FieldMappingTab
                losConnections={losConnections}
                onRefresh={loadData}
              />
            </TabsContent>

            <TabsContent value="fields">
              <FieldDictionaryTab
                fields={customFields}
                onRefresh={loadData}
              />
            </TabsContent>

            <TabsContent value="ranges">
              <RangeRulesTab
                rules={rangeRules}
                onRefresh={loadData}
              />
            </TabsContent>

            <TabsContent value="filters">
              <FilterBuilderTab
                filters={filters}
                onRefresh={loadData}
              />
            </TabsContent>

            <TabsContent value="scoring">
              <ScoringWeightsTab
                weights={scoringWeights}
                complexityComponents={complexityComponents}
                onRefresh={loadData}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </motion.div>
  );
}

export default TenantConfigSection;
