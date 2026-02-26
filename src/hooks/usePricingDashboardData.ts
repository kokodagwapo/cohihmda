/**
 * Hook for Pricing Dashboard data.
 * Fetches KPIs, report rows, detail rows, and entity/actor options.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type PricingEntityType = "branch" | "broker_lender_name" | "channel" | "investor";
export type PricingActorType = "loan_officer" | "account_executive";
export type PricingDateRange = "all" | "mtd" | "lm" | "qtd" | "ytd" | "ly";
export type PricingLoanFunding = "funded" | "closed";
export type PricingLoanStatus = "all" | "active" | "funded";
export type PricingLockStatus = "locked" | "not_locked" | "total";

export interface PricingDashboardFilters {
  channel?: string | null;
  entityType: PricingEntityType;
  /** When set, entity filter is applied to this column (e.g. filter by Branch 1000 while grouping by Broker Lender Name) */
  entityFilterType?: PricingEntityType;
  entityValue: string;
  actorType: PricingActorType;
  /** When set, actor filter is applied to this column */
  actorFilterType?: PricingActorType;
  actorValue: string;
  dateRange: PricingDateRange;
  loanFunding: PricingLoanFunding;
  loanStatus: PricingLoanStatus;
  lockStatus: PricingLockStatus;
}

export interface PricingKPIs {
  units: number;
  volume: number;
  pipelineMargin: number;
  pricingDollars: number;
  labelPrefix: string;
}

export interface PricingReportRow {
  entityName: string;
  actorName: string;
  units: number;
  volume: number;
  loanPricingDollars: number;
  pricingMargin: number;
  cdLenderCredits: number;
  purchaseAdviceSellAmount: number;
  line800TotalBorrowerPaidAmount: number;
  feesAppraisalFeeBorr: number;
  line800TotalSellerPaidAmount: number;
  feesInterestBorr: number;
  purchaseAdvExpectedIntPymtFromInvestor: number;
  purchaseAdviceExpctdPayout1Amt: number;
  purchaseAdviceExpctdPayout2Amt: number;
  purchaseAdviceExpctdPayout3Amt: number;
  lenderCredits: number;
}

export interface PricingDetailRow {
  entityName: string;
  actorName: string;
  loanNumber: string | null;
  applicationDate: string | null;
  lockExpirationDate: string | null;
  fundingDate: string | null;
  closingDate: string | null;
  currentLoanStatus: string | null;
  volume: number | null;
  loanPricingDollars: number;
  pricingMargin: number;
  cdLenderCredits: number | null;
  purchaseAdviceSellAmount: number | null;
  line800TotalBorrowerPaidAmount: number | null;
  feesAppraisalFeeBorr: number | null;
  line800TotalSellerPaidAmount: number | null;
  feesInterestBorr: number | null;
  purchaseAdvExpectedIntPymtFromInvestor: number | null;
  purchaseAdviceExpctdPayout1Amt: number | null;
  purchaseAdviceExpctdPayout2Amt: number | null;
  purchaseAdviceExpctdPayout3Amt: number | null;
  lenderCredits: number | null;
}

function buildParams(filters: PricingDashboardFilters, tenantId?: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (tenantId) p.set("tenant_id", tenantId);
  if (filters.channel) p.set("channel", filters.channel);
  p.set("entity_type", filters.entityType);
  if (filters.entityFilterType) p.set("entity_filter_type", filters.entityFilterType);
  p.set("entity_value", filters.entityValue);
  p.set("actor_type", filters.actorType);
  if (filters.actorFilterType) p.set("actor_filter_type", filters.actorFilterType);
  p.set("actor_value", filters.actorValue);
  p.set("date_range", filters.dateRange);
  p.set("loan_funding", filters.loanFunding);
  p.set("loan_status", filters.loanStatus);
  p.set("lock_status", filters.lockStatus);
  return p;
}

export interface UsePricingDashboardDataResult {
  kpis: PricingKPIs | null;
  reportRows: PricingReportRow[];
  reportTotals: Partial<PricingReportRow>;
  detailRows: PricingDetailRow[];
  detailTotals: Partial<PricingDetailRow>;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function usePricingDashboardData(
  filters: PricingDashboardFilters,
  options: {
    reportType: "loan_officer_report" | "entity_report";
    detailType: "loan_officer_detail" | "entity_detail";
    /** Tenant ID for API (required for platform staff; use selectedTenantId || user?.tenant_id) */
    tenantId?: string | null;
    /** Global channel from nav (overrides filters.channel so request always reflects current selection) */
    selectedChannel?: string | null;
  }
): UsePricingDashboardDataResult {
  const [kpis, setKpis] = useState<PricingKPIs | null>(null);
  const [reportRows, setReportRows] = useState<PricingReportRow[]>([]);
  const [reportTotals, setReportTotals] = useState<Partial<PricingReportRow>>({});
  const [detailRows, setDetailRows] = useState<PricingDetailRow[]>([]);
  const [detailTotals, setDetailTotals] = useState<Partial<PricingDetailRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveChannel =
    options.selectedChannel != null && options.selectedChannel !== "All"
      ? options.selectedChannel
      : filters.channel ?? undefined;

  const fetchAll = useCallback(async () => {
    const tenantId = options.tenantId;
    const filtersWithChannel: PricingDashboardFilters = {
      ...filters,
      channel: effectiveChannel,
    };
    const base = buildParams(filtersWithChannel, tenantId);
    try {
      setLoading(true);
      setError(null);
      const dataReqs = [
        api.request<PricingKPIs>(`/api/pricing-dashboard/kpis?${base.toString()}`),
        api.request<{ rows: PricingReportRow[]; totals: Partial<PricingReportRow> }>(
          `/api/pricing-dashboard/report?${base.toString()}&report_type=${options.reportType}`
        ),
        api.request<{ rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> }>(
          `/api/pricing-dashboard/detail?${base.toString()}&report_type=${options.detailType}`
        ),
      ];
      const results = await Promise.all(dataReqs);
      setKpis(results[0] as PricingKPIs);
      const reportRes = results[1] as { rows: PricingReportRow[]; totals: Partial<PricingReportRow> };
      const detailRes = results[2] as { rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> };
      setReportRows(reportRes.rows ?? []);
      setReportTotals(reportRes.totals ?? {});
      setDetailRows(detailRes.rows ?? []);
      setDetailTotals(detailRes.totals ?? {});
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load pricing dashboard data";
      setError(msg);
      setKpis(null);
      setReportRows([]);
      setReportTotals({});
      setDetailRows([]);
      setDetailTotals({});
    } finally {
      setLoading(false);
    }
  }, [
    effectiveChannel,
    filters.entityType,
    filters.entityFilterType,
    filters.entityValue,
    filters.actorType,
    filters.actorFilterType,
    filters.actorValue,
    filters.dateRange,
    filters.loanFunding,
    filters.loanStatus,
    filters.lockStatus,
    options.reportType,
    options.detailType,
    options.tenantId,
  ]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    kpis,
    reportRows,
    reportTotals,
    detailRows,
    detailTotals,
    loading,
    error,
    refetch: fetchAll,
  };
}

/** Combined result for workbench: KPIs + all 4 tables (Loan Officer Report/Detail, Entity Report/Detail). */
export interface PricingDashboardWorkbenchData {
  kpis: PricingKPIs | null;
  loanOfficerReport: { rows: PricingReportRow[]; totals: Partial<PricingReportRow> };
  entityReport: { rows: PricingReportRow[]; totals: Partial<PricingReportRow> };
  loanOfficerDetail: { rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> };
  entityDetail: { rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> };
  loading: boolean;
  error: string | null;
}

/** Fetches KPIs + all 4 pricing tables in one go for workbench (5 API calls). */
export function usePricingDashboardWorkbenchData(
  filters: PricingDashboardFilters,
  options: { tenantId?: string | null; selectedChannel?: string | null }
): PricingDashboardWorkbenchData {
  const [state, setState] = useState<PricingDashboardWorkbenchData>({
    kpis: null,
    loanOfficerReport: { rows: [], totals: {} },
    entityReport: { rows: [], totals: {} },
    loanOfficerDetail: { rows: [], totals: {} },
    entityDetail: { rows: [], totals: {} },
    loading: true,
    error: null,
  });

  const effectiveChannel =
    options.selectedChannel != null && options.selectedChannel !== "All"
      ? options.selectedChannel
      : filters.channel ?? undefined;

  const fetchAll = useCallback(async () => {
    const tenantId = options.tenantId;
    const filtersWithChannel: PricingDashboardFilters = {
      ...filters,
      channel: effectiveChannel,
    };
    const base = buildParams(filtersWithChannel, tenantId);
    try {
      setState((s) => ({ ...s, loading: true, error: null }));
      const [kpisRes, reportLORes, reportEntityRes, detailLORes, detailEntityRes] = await Promise.all([
        api.request<PricingKPIs>(`/api/pricing-dashboard/kpis?${base.toString()}`),
        api.request<{ rows: PricingReportRow[]; totals: Partial<PricingReportRow> }>(
          `/api/pricing-dashboard/report?${base.toString()}&report_type=loan_officer_report`
        ),
        api.request<{ rows: PricingReportRow[]; totals: Partial<PricingReportRow> }>(
          `/api/pricing-dashboard/report?${base.toString()}&report_type=entity_report`
        ),
        api.request<{ rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> }>(
          `/api/pricing-dashboard/detail?${base.toString()}&report_type=loan_officer_detail`
        ),
        api.request<{ rows: PricingDetailRow[]; totals: Partial<PricingDetailRow> }>(
          `/api/pricing-dashboard/detail?${base.toString()}&report_type=entity_detail`
        ),
      ]);
      setState({
        kpis: kpisRes as PricingKPIs,
        loanOfficerReport: { rows: (reportLORes as any).rows ?? [], totals: (reportLORes as any).totals ?? {} },
        entityReport: { rows: (reportEntityRes as any).rows ?? [], totals: (reportEntityRes as any).totals ?? {} },
        loanOfficerDetail: { rows: (detailLORes as any).rows ?? [], totals: (detailLORes as any).totals ?? {} },
        entityDetail: { rows: (detailEntityRes as any).rows ?? [], totals: (detailEntityRes as any).totals ?? {} },
        loading: false,
        error: null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load pricing dashboard data";
      setState((s) => ({
        ...s,
        kpis: null,
        loanOfficerReport: { rows: [], totals: {} },
        entityReport: { rows: [], totals: {} },
        loanOfficerDetail: { rows: [], totals: {} },
        entityDetail: { rows: [], totals: {} },
        loading: false,
        error: msg,
      }));
    }
  }, [
    effectiveChannel,
    filters.entityType,
    filters.entityFilterType,
    filters.entityValue,
    filters.actorType,
    filters.actorFilterType,
    filters.actorValue,
    filters.dateRange,
    filters.loanFunding,
    filters.loanStatus,
    filters.lockStatus,
    options.tenantId,
  ]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return state;
}
