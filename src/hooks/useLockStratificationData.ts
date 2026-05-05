/**
 * Hook for Lock Stratification Dashboard data.
 * Fetches KPIs, interest rate distribution, milestone chart/pivot,
 * days-to-expiration, and pull-through data.
 */

import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export type LockedFilter = "active_locked" | "active_not_locked" | "all_active";
export type MeasureFilter = "volume" | "units" | "wac" | "wa_fico";
export type MilestoneGroupBy = "current_milestone" | "investor" | "branch" | "broker_lender" | "lo" | "ae";
export type PullThroughPeriod = "30" | "60" | "90" | "120" | "ytd";

export interface LockStratFilters {
  locked: LockedFilter;
  measure: MeasureFilter;
}

export interface LockStratKPIs {
  units: number;
  volume: number;
  avgBalance: number;
  avgDaysActive: number;
  wac: number;
  waFico: number;
  waLtv: number;
  waDti: number;
  labelPrefix: string;
}

export interface InterestRateBucket {
  bucket: string;
  value: number;
}

/** Drill state for Interest Rates chart: 0 = 1% buckets, 1 = 0.125% in a 1% range, 2 = individual rates in a 0.125% range */
export type InterestRateDrill =
  | { level: 0 }
  | { level: 1; min: number; max: number }
  | { level: 2; min: number; max: number };

export interface MilestoneChartRow {
  group: string;
  expirationBucket: string;
  value: number;
}

export interface MilestonePivotChild {
  bucket: string;
  units: number;
  volume: number;
  pct: number;
}

export interface MilestonePivotRow {
  group: string;
  units: number;
  volume: number;
  pct: number;
  children: MilestonePivotChild[];
}

export interface DaysToExpirationRow {
  bucket: string;
  units: number;
  volume: number;
  wac: number;
  avgDaysActive: number;
}

export interface PullThroughMonthBar {
  month: string;
  monthNum: number;
  lockedOriginated: number;
  lockedWithdrawn: number;
  lockedDenied: number;
}

export interface PullThroughData {
  originatedPct: number;
  withdrawnPct: number;
  deniedPct: number;
  bars: PullThroughMonthBar[];
}

function buildBaseParams(
  filters: LockStratFilters,
  tenantId?: string | null,
  channel?: string | null
): URLSearchParams {
  const p = new URLSearchParams();
  if (tenantId) p.set("tenant_id", tenantId);
  if (channel) p.set("channel", channel);
  p.set("locked", filters.locked);
  p.set("measure", filters.measure);
  return p;
}

export interface UseLockStratificationDataResult {
  kpis: LockStratKPIs | null;
  interestRates: InterestRateBucket[];
  milestoneChart: MilestoneChartRow[];
  milestonePivot: { rows: MilestonePivotRow[]; totals: { units: number; volume: number } };
  daysToExpiration: DaysToExpirationRow[];
  pullThrough: PullThroughData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLockStratificationData(
  filters: LockStratFilters,
  options: {
    tenantId?: string | null;
    selectedChannel?: string | null;
    milestoneGroupBy: MilestoneGroupBy;
    pullThroughPeriod: PullThroughPeriod;
    interestRateDrill?: InterestRateDrill;
    expirationBucket?: string | null;
    selectedGroupBy?: MilestoneGroupBy | null;
    selectedGroupValue?: string | null;
  }
): UseLockStratificationDataResult {
  const [kpis, setKpis] = useState<LockStratKPIs | null>(null);
  const [interestRates, setInterestRates] = useState<InterestRateBucket[]>([]);
  const [milestoneChart, setMilestoneChart] = useState<MilestoneChartRow[]>([]);
  const [milestonePivot, setMilestonePivot] = useState<{ rows: MilestonePivotRow[]; totals: { units: number; volume: number } }>({ rows: [], totals: { units: 0, volume: 0 } });
  const [daysToExpiration, setDaysToExpiration] = useState<DaysToExpirationRow[]>([]);
  const [pullThrough, setPullThrough] = useState<PullThroughData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const effectiveChannel =
    options.selectedChannel != null && options.selectedChannel !== "All"
      ? options.selectedChannel
      : undefined;

  const fetchAll = useCallback(async () => {
    const base = buildBaseParams(filters, options.tenantId, effectiveChannel);
    const drill = options.interestRateDrill;

    // Apply the rate range as a global filter on ALL endpoints when drilled
    if (drill && drill.level >= 1) {
      base.set("rate_min", String(drill.min));
      base.set("rate_max", String(drill.max));
    }
    if (options.expirationBucket) {
      base.set("expiration_bucket", options.expirationBucket);
    }
    if (options.selectedGroupBy && options.selectedGroupValue) {
      base.set("selected_group_by", options.selectedGroupBy);
      base.set("selected_group_value", options.selectedGroupValue);
    }

    try {
      setLoading(true);
      setError(null);

      const milestoneParams = new URLSearchParams(base);
      milestoneParams.set("group_by", options.milestoneGroupBy);

      const pivotParams = new URLSearchParams(base);
      pivotParams.set("group_by", options.milestoneGroupBy);

      const pullParams = new URLSearchParams(base);
      pullParams.set("period", options.pullThroughPeriod);

      const rateParams = new URLSearchParams(base);
      if (drill && drill.level === 1) {
        rateParams.set("drill_min", String(drill.min));
        rateParams.set("drill_max", String(drill.max));
        rateParams.set("increment", "0.125");
      } else if (drill && drill.level === 2) {
        rateParams.set("drill_min", String(drill.min));
        rateParams.set("drill_max", String(drill.max));
        rateParams.set("increment", "rate");
      }

      const [kpiRes, rateRes, chartRes, pivotRes, daysRes, pullRes] = await Promise.all([
        api.request<LockStratKPIs>(`/api/lock-stratification/kpis?${base.toString()}`),
        api.request<{ buckets: InterestRateBucket[] }>(`/api/lock-stratification/interest-rates?${rateParams.toString()}`),
        api.request<{ rows: MilestoneChartRow[] }>(`/api/lock-stratification/milestone-chart?${milestoneParams.toString()}`),
        api.request<{ rows: MilestonePivotRow[]; totals: { units: number; volume: number } }>(`/api/lock-stratification/milestone-pivot?${pivotParams.toString()}`),
        api.request<{ rows: DaysToExpirationRow[] }>(`/api/lock-stratification/days-to-expiration?${base.toString()}`),
        api.request<PullThroughData>(`/api/lock-stratification/pull-through?${pullParams.toString()}`),
      ]);

      setKpis(kpiRes as LockStratKPIs);
      setInterestRates((rateRes as { buckets: InterestRateBucket[] }).buckets ?? []);
      setMilestoneChart((chartRes as { rows: MilestoneChartRow[] }).rows ?? []);
      setMilestonePivot({
        rows: (pivotRes as { rows: MilestonePivotRow[]; totals: { units: number; volume: number } }).rows ?? [],
        totals: (pivotRes as { rows: MilestonePivotRow[]; totals: { units: number; volume: number } }).totals ?? { units: 0, volume: 0 },
      });
      setDaysToExpiration((daysRes as { rows: DaysToExpirationRow[] }).rows ?? []);
      setPullThrough(pullRes as PullThroughData);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load lock stratification data";
      setError(msg);
      setKpis(null);
      setInterestRates([]);
      setMilestoneChart([]);
      setMilestonePivot({ rows: [], totals: { units: 0, volume: 0 } });
      setDaysToExpiration([]);
      setPullThrough(null);
    } finally {
      setLoading(false);
    }
  }, [
    filters.locked,
    filters.measure,
    options.tenantId,
    effectiveChannel,
    options.milestoneGroupBy,
    options.pullThroughPeriod,
    options.interestRateDrill,
    options.expirationBucket,
    options.selectedGroupBy,
    options.selectedGroupValue,
  ]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  return {
    kpis,
    interestRates,
    milestoneChart,
    milestonePivot,
    daysToExpiration,
    pullThrough,
    loading,
    error,
    refetch: fetchAll,
  };
}
