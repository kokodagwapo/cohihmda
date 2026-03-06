/**
 * Tenant Configuration Section
 * Renders a single config area: field mapping, revenue, scoring, or data transfer.
 * Each area is a separate admin sidebar section.
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
import { Button } from "@/components/ui/button";
import {
  Calculator,
  BarChart3,
  Loader2,
  RefreshCw,
  Settings2,
  Link2,
  Building2,
  ArrowLeftRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useAdminTenant } from "@/contexts/AdminTenantContext";
import { FieldMappingTab } from "./FieldMappingTab";
import { RevenueFormulaTab } from "./RevenueFormulaTab";
import { ScoringWeightsTab } from "./ScoringWeightsTab";
import { LegacyConfigImportTab } from "./LegacyConfigImportTab";
import { TenantConfigTransferDialog } from "./TenantConfigTransferDialog";

const SECTION_META: Record<
  string,
  { title: string; description: string; icon: typeof Link2 }
> = {
  mapping: {
    title: "Field Mapping",
    description: "Map LOS fields to Coheus columns and configure sync",
    icon: Link2,
  },
  revenue: {
    title: "Revenue",
    description: "Define revenue and margin calculation formulas",
    icon: Calculator,
  },
  scoring: {
    title: "Scoring & Weights",
    description: "Scorecard weights, loan complexity, and unit targets",
    icon: BarChart3,
  },
  transfer: {
    title: "Import / Export",
    description: "Legacy config import and tenant config transfer",
    icon: ArrowLeftRight,
  },
};

export type TenantConfigSectionId =
  | "mapping"
  | "revenue"
  | "scoring"
  | "transfer";

export interface TenantConfigSectionProps {
  section: TenantConfigSectionId;
}

export function TenantConfigSection({ section }: TenantConfigSectionProps) {
  const { toast } = useToast();
  const { selectedTenantId, isTenantAdmin, isPlatformAdmin } = useAdminTenant();
  const [loading, setLoading] = useState(false);
  const [initialLoadDone, setInitialLoadDone] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);

  const [scoringWeights, setScoringWeights] = useState<Record<string, any[]>>(
    {}
  );
  const [complexityComponents, setComplexityComponents] = useState<
    Record<string, any[]>
  >({});
  const [staffingUnitTargets, setStaffingUnitTargets] = useState<{
    processor: number;
    underwriter: number;
    closer: number;
    other: number;
  } | null>(null);
  const [opsActorConfig, setOpsActorConfig] = useState<Record<
    string,
    { outputDateField: string; turnTimeStartField: string; turnTimeEndField: string }
  > | null>(null);
  const [availableDateColumns, setAvailableDateColumns] = useState<string[]>([]);
  const [losConnections, setLosConnections] = useState<any[]>([]);

  const needsLos = section === "mapping" || section === "transfer";
  const needsScoring = section === "scoring";

  const loadData = useCallback(async () => {
    if (!isTenantAdmin && !selectedTenantId) {
      setLosConnections([]);
      setScoringWeights({});
      setComplexityComponents({});
      setStaffingUnitTargets(null);
      setInitialLoadDone(false);
      return;
    }

    setLoading(true);
    try {
      const tenantParam = selectedTenantId
        ? `?tenant_id=${selectedTenantId}`
        : "";

      const promises: Promise<unknown>[] = [];
      if (needsLos) {
        promises.push(
          api.request<{ connections: any[] }>(`/api/los/connections${tenantParam}`)
        );
      }
      if (needsScoring) {
        promises.push(
          api.request<{ weights: Record<string, any[]> }>(
            `/api/tenant-config/scoring-weights/sales${tenantParam}`
          ),
          api.request<{ weights: Record<string, any[]> }>(
            `/api/tenant-config/scoring-weights/operations${tenantParam}`
          ),
          api.request<{ components: Record<string, any[]> }>(
            `/api/tenant-config/complexity${tenantParam}`
          ),
          api.request<{
            processor: number;
            underwriter: number;
            closer: number;
            other: number;
          }>(`/api/tenant-config/staffing-unit-targets${tenantParam}`),
          api.request<{ configs: Record<string, { outputDateField: string; turnTimeStartField: string; turnTimeEndField: string }> }>(
            `/api/tenant-config/operations-actor-config${tenantParam}`
          ),
          api.request<{ columns: string[] }>(
            `/api/tenant-config/available-date-columns${tenantParam}`
          )
        );
      }

      const results = await Promise.all(promises);
      let idx = 0;
      if (needsLos) {
        const losRes = results[idx++] as { connections: any[] };
        setLosConnections(losRes?.connections || []);
      }
      if (needsScoring) {
        const [
          salesWeightsRes,
          opsWeightsRes,
          complexityRes,
          staffingTargetsRes,
          opsActorConfigRes,
          availableDateColumnsRes,
        ] = results.slice(idx) as [
          { weights: Record<string, any[]> },
          { weights: Record<string, any[]> },
          { components: Record<string, any[]> },
          { processor: number; underwriter: number; closer: number; other: number },
          { configs: Record<string, { outputDateField: string; turnTimeStartField: string; turnTimeEndField: string }> },
          { columns: string[] },
        ];
        setScoringWeights({
          sales: salesWeightsRes?.weights?.default || [],
          operations: opsWeightsRes?.weights?.default || [],
        });
        setComplexityComponents(complexityRes?.components || {});
        setStaffingUnitTargets(staffingTargetsRes ?? null);
        setOpsActorConfig(opsActorConfigRes?.configs ?? null);
        setAvailableDateColumns(availableDateColumnsRes?.columns ?? []);
      }
      setInitialLoadDone(true);
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
  }, [toast, selectedTenantId, isTenantAdmin, section, needsLos, needsScoring]);

  useEffect(() => {
    loadData();
  }, [loadData, selectedTenantId]);

  const meta = SECTION_META[section];
  const Icon = meta.icon;

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
            <div className="flex items-center gap-3">
              <Icon className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
              <div>
                <CardTitle className="text-xl font-thin text-slate-900 dark:text-white tracking-tight">
                  {meta.title}
                </CardTitle>
                <CardDescription className="text-sm text-slate-600 dark:text-slate-400 font-light">
                  {meta.description}
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {section === "transfer" && isPlatformAdmin && selectedTenantId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTransferDialogOpen(true)}
                  className="font-light"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                  <span className="ml-2">Export / Import</span>
                </Button>
              )}
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
          </div>
        </CardHeader>
      </Card>

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
                Use the tenant selector above to choose which organization to
                manage.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {(isTenantAdmin || selectedTenantId) && (
        <>
          {loading && !initialLoadDone ? (
            <Card className="border-slate-200 dark:border-slate-700">
              <CardContent className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </CardContent>
            </Card>
          ) : (
            <>
              {section === "mapping" && (
                <FieldMappingTab
                  losConnections={losConnections}
                  onRefresh={loadData}
                />
              )}
              {section === "revenue" && <RevenueFormulaTab onRefresh={loadData} />}
              {section === "scoring" && (
                <ScoringWeightsTab
                  weights={scoringWeights}
                  complexityComponents={complexityComponents}
                  staffingUnitTargets={staffingUnitTargets}
                  opsActorConfig={opsActorConfig}
                  availableDateColumns={availableDateColumns}
                  onRefresh={loadData}
                />
              )}
              {section === "transfer" && (
                <LegacyConfigImportTab tenantId={selectedTenantId || ""} />
              )}
            </>
          )}
        </>
      )}

      {section === "transfer" && isPlatformAdmin && (
        <TenantConfigTransferDialog
          open={transferDialogOpen}
          onOpenChange={setTransferDialogOpen}
          losConnections={losConnections}
        />
      )}
    </motion.div>
  );
}

export default TenantConfigSection;
