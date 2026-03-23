import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface DashboardInsightEvidenceRef {
  widgetId: string;
  role: "primary" | "supporting";
  target?: { type: "row" | "series" | "cell"; label: string };
  /** When present, the actual data value from the widget at generation time (e.g. "MTD: 12 units") */
  value?: string;
}

export interface DashboardInsightFilterContext {
  datePeriod?: string;
  channelGroup?: string;
  /** For Leaderboard deep-link from Loan Complexity (or other) insights */
  leaderName?: string;
  [key: string]: unknown;
}

/** One row of supporting data by time period (for evidence table in the UI). */
export interface SupportingDataByPeriodRow {
  period: string;
  periodLabel?: string;
  averagePullThrough?: number;
  totalUnits?: number;
  totalVolume?: number;
  topPerformerName?: string;
  topPerformerUnits?: number;
  topPerformerVolume?: number;
  /** Loan complexity: portfolio WA complexity */
  portfolioWaComplexity?: number;
  /** Loan complexity: same cohort as complexity (application-date window) */
  portfolioPullThrough?: number;

  // Company Scorecard (tier + entity metrics)
  wac?: number;
  originatedUnits?: number;
  originatedUnitsPct?: number;
  withdrawnUnits?: number;
  withdrawnUnitsPct?: number;
  deniedUnits?: number;
  deniedUnitsPct?: number;
  waFico?: number;
  waLtv?: number;
  waDti?: number;
  conventionalQualifiedPercent?: number;
  governmentQualifiedPercent?: number;
}

export interface SupportingData {
  byPeriod?: SupportingDataByPeriodRow[];
}

export interface DashboardInsightItem {
  id?: number;
  headline: string;
  understory: string;
  sentiment: "positive" | "warning" | "critical" | "neutral";
  severity_score: number;
  cited_numbers: string[];
  what_changed: string;
  why: string;
  business_impact: string;
  risk_if_ignored: string;
  recommended_action: string;
  owner: string;
  scope: "page" | "widget";
  filter_context: DashboardInsightFilterContext;
  evidence_refs: DashboardInsightEvidenceRef[];
  escalate: boolean;
  sourcePageId: string;
  sourcePageName: string;
  /** Snapshot of by-period metrics for evidence table (e.g. MTD/LM/QTD). */
  supporting_data?: SupportingData;
}

export interface UseDashboardInsightsResult {
  insights: DashboardInsightItem[];
  generatedAt: string | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Fetch stored dashboard insights for a page and filter set.
 * Maps Leaderboard timeframe to API datePeriod (e.g. mtd, qtd, ytd).
 */
export function useDashboardInsights(
  pageId: string,
  filters: DashboardInsightFilterContext,
  options?: { enabled?: boolean; tenantId?: string | null }
): UseDashboardInsightsResult {
  const [insights, setInsights] = useState<DashboardInsightItem[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const enabled = options?.enabled !== false;

  const fetchInsights = useCallback(async () => {
    if (!pageId || !enabled) {
      setInsights([]);
      setGeneratedAt(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("pageId", pageId);
      if (filters.datePeriod) params.set("datePeriod", String(filters.datePeriod));
      if (filters.channelGroup) params.set("channelGroup", String(filters.channelGroup));
      if (options?.tenantId) params.set("tenant_id", options.tenantId);
      const url = `/api/dashboard-insights?${params.toString()}`;
      const data = await api.request<{ insights: DashboardInsightItem[]; generatedAt: string | null }>(url);
      setInsights(Array.isArray(data?.insights) ? data.insights : []);
      setGeneratedAt(data?.generatedAt ?? null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to load insights";
      setError(message);
      setInsights([]);
      setGeneratedAt(null);
    } finally {
      setLoading(false);
    }
  }, [pageId, filters.datePeriod, filters.channelGroup, enabled, options?.tenantId]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return { insights, generatedAt, loading, error, refresh: fetchInsights };
}
