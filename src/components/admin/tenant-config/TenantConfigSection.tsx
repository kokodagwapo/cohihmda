/**
 * Tenant Configuration Section
 * Self-service mapping tool for lender admins
 * Manages field mappings, filters, and scoring weights
 * Note: Personas/user profiles are managed in Access & Permissions section
 */

import { useState, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Calculator,
  BarChart3,
  Loader2,
  RefreshCw,
  Settings2,
  Link2,
  Building2,
  Upload,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { FieldMappingTab } from "./FieldMappingTab";
import { RevenueFormulaTab } from "./RevenueFormulaTab";
import { ScoringWeightsTab } from "./ScoringWeightsTab";
import { LegacyConfigImportTab } from "./LegacyConfigImportTab";

export function TenantConfigSection() {
  const { toast } = useToast();

  // Use admin tenant context
  const { selectedTenantId, isTenantAdmin, currentTenantName } =
    useAdminTenant();
  const [activeTab, setActiveTab] = useState("mapping");
  const [loading, setLoading] = useState(false);

  // Data states
  const [scoringWeights, setScoringWeights] = useState<Record<string, any[]>>(
    {}
  );
  const [complexityComponents, setComplexityComponents] = useState<
    Record<string, any[]>
  >({});
  const [losConnections, setLosConnections] = useState<any[]>([]);

  // Load all data
  const loadData = useCallback(async () => {
    // For platform admins, require a tenant to be selected
    if (!isTenantAdmin && !selectedTenantId) {
      setLosConnections([]);
      setScoringWeights({});
      setComplexityComponents({});
      return;
    }

    setLoading(true);
    try {
      // Build tenant query param for platform admins
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";

      const [salesWeightsRes, opsWeightsRes, complexityRes, losRes] =
        await Promise.all([
          api.request<{ weights: Record<string, any[]> }>(
            `/api/tenant-config/scoring-weights/sales${tenantParam}`
          ),
          api.request<{ weights: Record<string, any[]> }>(
            `/api/tenant-config/scoring-weights/operations${tenantParam}`
          ),
          api.request<{ components: Record<string, any[]> }>(
            `/api/tenant-config/complexity${tenantParam}`
          ),
          api.request<{ connections: any[] }>(
            `/api/los/connections${tenantParam}`
          ),
        ]);

      setScoringWeights({
        sales: salesWeightsRes.weights?.default || [],
        operations: opsWeightsRes.weights?.default || [],
      });
      setComplexityComponents(complexityRes.components || {});
      setLosConnections(losRes.connections || []);
    } catch (error: any) {
      console.error("Error loading tenant config:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to load configuration data",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast, selectedTenantId, isTenantAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData, selectedTenantId]);

  const tabs = [
    { id: "mapping", label: "Field Mapping", icon: Link2, count: null },
    {
      id: "calculations",
      label: "Revenue Calculations",
      icon: Calculator,
      count: null,
    },
    { id: "scoring", label: "Scoring Weights", icon: BarChart3, count: null },
    { id: "import", label: "Legacy Import", icon: Upload, count: null },
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
                    ? "Manage field mappings, guideline rules, filters, and scoring for your organization"
                    : "Configure tenant data mappings, rules, and scoring weights"}
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

      {/* No tenant selected message for platform admins */}
      {!isTenantAdmin && !selectedTenantId && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <CardContent className="flex items-center gap-4 py-8">
            <Building2
              className="h-12 w-12 text-amber-500 dark:text-amber-400"
              strokeWidth={1.5}
            />
            <div>
              <h3 className="text-lg font-medium text-amber-900 dark:text-amber-100">
                Select a Tenant
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Use the tenant selector above to choose which organization's
                configuration to manage.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Tabs - only show when tenant is selected (or for tenant admins) */}
      {(isTenantAdmin || selectedTenantId) && (
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="space-y-4"
        >
          <TabsList className="grid w-full grid-cols-4 gap-2 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
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

              <TabsContent value="calculations">
                <RevenueFormulaTab onRefresh={loadData} />
              </TabsContent>

              <TabsContent value="scoring">
                <ScoringWeightsTab
                  weights={scoringWeights}
                  complexityComponents={complexityComponents}
                  onRefresh={loadData}
                />
              </TabsContent>

              <TabsContent value="import">
                <LegacyConfigImportTab tenantId={selectedTenantId || ""} />
              </TabsContent>
            </>
          )}
        </Tabs>
      )}
    </motion.div>
  );
}

export default TenantConfigSection;
