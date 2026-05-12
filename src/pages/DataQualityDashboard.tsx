import { useState, useEffect, useCallback, useMemo } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertTriangle, Database, Gauge, Loader2 } from "lucide-react";
import { TopTieringLayout } from "@/components/layout/TopTieringLayout";
import { TopTieringTopBar } from "@/components/layout/TopTieringTopBar";
import { DataQualityHeader } from "@/components/data-quality/DataQualityHeader";
import { WarningsView } from "@/components/data-quality/WarningsView";
import { FieldHealthView } from "@/components/data-quality/FieldHealthView";
import { RangesView } from "@/components/data-quality/RangesView";
import type {
  DataQualityMetrics,
  DataQualityWarning,
  GroupedWarningSummary,
  StatusInconsistency,
  StatusDistribution,
  CrucialFieldStageGroup,
  RangeAnalysis,
  WarningGroup,
} from "@/components/data-quality/types";
import { useTenantStore } from "@/stores/tenantStore";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { useSearchParams } from "react-router-dom";
import { useDashboardFilterAnalytics } from "@/hooks/useDashboardFilterAnalytics";
import { DASHBOARD_PAGE_KEYS } from "@/lib/dashboardPageKeys";

export default function DataQualityDashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { selectedTenantId: storeTenantId } = useTenantStore();
  const tenantId = storeTenantId ?? user?.tenant_id ?? null;

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState("warnings");
  const [searchParams] = useSearchParams();

  const [metrics, setMetrics] = useState<DataQualityMetrics | null>(null);
  const [warnings, setWarnings] = useState<DataQualityWarning[]>([]);
  const [groupedSummary, setGroupedSummary] = useState<Record<string, GroupedWarningSummary>>({});
  const [statusInconsistencies, setStatusInconsistencies] = useState<StatusInconsistency[]>([]);
  const [stageGroups, setStageGroups] = useState<{
    universal: CrucialFieldStageGroup;
    originated: CrucialFieldStageGroup;
    processing: CrucialFieldStageGroup;
  } | null>(null);
  const [crucialFieldsTotalLoans, setCrucialFieldsTotalLoans] = useState(0);
  const [rangeAnalysis, setRangeAnalysis] = useState<RangeAnalysis | null>(null);

  const loadMetrics = useCallback(async () => {
    const response = await api.request<{
      success: boolean;
      metrics: {
        total_loans: number;
        loans_with_issues: number;
        total_issues: number;
        quality_score: number;
        critical_issues: number;
        warning_issues: number;
        info_issues: number;
        status_inconsistencies?: number;
        date_sequence_issues?: number;
        issues_by_group?: Record<string, number>;
      };
    }>(`/api/data-quality/metrics?tenant_id=${tenantId}`);

    if (response.success && response.metrics) {
      setMetrics({
        total_loans: response.metrics.total_loans,
        loans_with_issues: response.metrics.loans_with_issues,
        total_issues: response.metrics.total_issues,
        critical_issues: response.metrics.critical_issues,
        warning_issues: response.metrics.warning_issues,
        info_issues: response.metrics.info_issues,
        quality_score: response.metrics.quality_score,
        status_inconsistencies: response.metrics.status_inconsistencies,
        date_sequence_issues: response.metrics.date_sequence_issues,
        issues_by_group: response.metrics.issues_by_group as Record<WarningGroup, number>,
      });
    }
  }, [tenantId]);

  const loadWarnings = useCallback(async () => {
    const response = await api.request<{
      success: boolean;
      warnings: DataQualityWarning[];
      groupedSummary: Record<string, GroupedWarningSummary>;
    }>(`/api/data-quality/warnings-grouped?tenant_id=${tenantId}`);

    if (response.success) {
      setWarnings(response.warnings || []);
      setGroupedSummary(response.groupedSummary || {});
    }
  }, [tenantId]);

  const loadStatusInconsistencies = useCallback(async () => {
    const response = await api.request<{
      success: boolean;
      inconsistencies: StatusInconsistency[];
      statusDistribution: StatusDistribution[];
      statusGroupTotals: Record<string, number>;
    }>(`/api/data-quality/status-inconsistencies?tenant_id=${tenantId}`);

    if (response.success) {
      setStatusInconsistencies(response.inconsistencies || []);
    }
  }, [tenantId]);

  const loadCrucialFields = useCallback(async () => {
    const response = await api.request<{
      success: boolean;
      stageGroups: {
        universal: CrucialFieldStageGroup;
        originated: CrucialFieldStageGroup;
        processing: CrucialFieldStageGroup;
      };
      totalLoans: number;
    }>(`/api/data-quality/crucial-fields-status?tenant_id=${tenantId}`);

    if (response.success && response.stageGroups) {
      setStageGroups(response.stageGroups);
      setCrucialFieldsTotalLoans(response.totalLoans || 0);
    }
  }, [tenantId]);

  const loadRangeAnalysis = useCallback(async () => {
    const response = await api.request<{
      success: boolean;
      rangeAnalysis: RangeAnalysis;
    }>(`/api/data-quality/range-analysis?tenant_id=${tenantId}`);

    if (response.success && response.rangeAnalysis) {
      setRangeAnalysis(response.rangeAnalysis);
    }
  }, [tenantId]);

  const loadAll = useCallback(async () => {
    try {
      await Promise.all([
        loadMetrics(),
        loadWarnings(),
        loadStatusInconsistencies(),
        loadCrucialFields(),
        loadRangeAnalysis(),
      ]);
    } catch {
      toast({
        title: "Error",
        description: "Failed to load data quality information",
        variant: "destructive",
      });
    }
  }, [loadMetrics, loadWarnings, loadStatusInconsistencies, loadCrucialFields, loadRangeAnalysis, toast]);

  useEffect(() => {
    if (!tenantId) return;
    setLoading(true);
    loadAll().finally(() => setLoading(false));
  }, [tenantId, loadAll]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
    toast({ title: "Refreshed", description: "Data quality metrics updated" });
  };

  const totalWarningCount = warnings.reduce((s, w) => s + w.count, 0);
  const deepLinkTab = searchParams.get("tab");
  const highlightedWarningId = searchParams.get("warning") || undefined;

  useEffect(() => {
    if (deepLinkTab === "warnings" || deepLinkTab === "field-health" || deepLinkTab === "ranges") {
      setActiveTab(deepLinkTab);
      return;
    }
    if (highlightedWarningId) {
      setActiveTab("warnings");
    }
  }, [deepLinkTab, highlightedWarningId]);

  const dataQualityFilterAnalytics = useMemo(
    () => ({
      active_tab: activeTab,
      deeplink_tab: deepLinkTab,
      highlight_warning: Boolean(highlightedWarningId),
    }),
    [activeTab, deepLinkTab, highlightedWarningId],
  );
  useDashboardFilterAnalytics(DASHBOARD_PAGE_KEYS.data_quality, dataQualityFilterAnalytics);

  return (
    <TopTieringLayout>
      <div className="flex flex-col min-h-[calc(100vh-4rem)]">
        <TopTieringTopBar title="Data Quality" />
        <main className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-6">
          <div className="max-w-[1600px] mx-auto space-y-6">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : (
              <>
                <DataQualityHeader
                  metrics={metrics}
                  onRefresh={handleRefresh}
                  refreshing={refreshing}
                />

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                  <TabsList className="grid w-full grid-cols-3 h-auto max-w-md">
                    <TabsTrigger
                      value="warnings"
                      className="flex items-center gap-1.5 py-2"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>Warnings</span>
                      {totalWarningCount > 0 && (
                        <span className="ml-1 text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
                          {totalWarningCount.toLocaleString()}
                        </span>
                      )}
                    </TabsTrigger>
                    <TabsTrigger
                      value="field-health"
                      className="flex items-center gap-1.5 py-2"
                    >
                      <Database className="h-3.5 w-3.5" />
                      <span>Field Health</span>
                    </TabsTrigger>
                    <TabsTrigger
                      value="ranges"
                      className="flex items-center gap-1.5 py-2"
                    >
                      <Gauge className="h-3.5 w-3.5" />
                      <span>Ranges</span>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="warnings" className="mt-6">
                    <WarningsView
                      warnings={warnings}
                      groupedSummary={groupedSummary}
                      statusInconsistencies={statusInconsistencies}
                      tenantId={tenantId}
                      highlightedWarningId={highlightedWarningId}
                    />
                  </TabsContent>

                  <TabsContent value="field-health" className="mt-6">
                    <FieldHealthView
                      stageGroups={stageGroups}
                      totalLoans={crucialFieldsTotalLoans}
                      tenantId={tenantId}
                    />
                  </TabsContent>

                  <TabsContent value="ranges" className="mt-6">
                    <RangesView rangeAnalysis={rangeAnalysis} />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </main>
      </div>
    </TopTieringLayout>
  );
}
