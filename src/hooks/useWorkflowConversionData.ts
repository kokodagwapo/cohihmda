import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";

export interface SeriesPoint {
  period: string;
  leftCount: number;
  rightCount: number;
  conversionPercent: number | null;
  avgTurnTimeDays: number | null;
}

export interface SegmentResult {
  from: string;
  to: string;
  leftCount: number;
  rightCount: number;
  conversionPercent: number | null;
  avgTurnTimeDays: number | null;
  series: SeriesPoint[];
}

export interface WorkflowConversionData {
  segments: SegmentResult[];
}

export type WorkflowConversionMetric = "conversion" | "turn_time";
export type WorkflowGrouping = "workflow" | "individual";

export interface UseWorkflowConversionDataParams {
  startDate: string;
  endDate: string;
  segments: { from: string; to: string }[];
  metric: WorkflowConversionMetric;
  grouping?: WorkflowGrouping;
  selectedTenantId?: string | null;
  channelGroup?: string | null;
}

export function useWorkflowConversionData({
  startDate,
  endDate,
  segments,
  metric,
  grouping = "workflow",
  selectedTenantId,
  channelGroup,
}: UseWorkflowConversionDataParams): {
  data: WorkflowConversionData | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<WorkflowConversionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!startDate || !endDate || segments.length === 0) {
      setData({ segments: segments.map((s) => ({ ...s, leftCount: 0, rightCount: 0, conversionPercent: null, avgTurnTimeDays: null, series: [] })) });
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("startDate", startDate);
      params.set("endDate", endDate);
      params.set("segments", JSON.stringify(segments));
      params.set("metric", metric);
      params.set("grouping", grouping);
      if (selectedTenantId) params.set("tenant_id", selectedTenantId);
      if (channelGroup && channelGroup !== "All") params.set("channel_group", channelGroup);
      const res = await api.request<WorkflowConversionData>(
        `/api/dashboard/workflow-conversion?${params.toString()}`
      );
      setData(res);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Failed to load workflow conversion data";
      setError(message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, segments, metric, grouping, selectedTenantId, channelGroup]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
